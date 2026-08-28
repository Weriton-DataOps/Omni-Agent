import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

import { lerAtalhos, registrarObservacaoAtalho } from './atalhos.mjs'
import { lerCicloOperacional, proporMelhoriaOperacional } from './ciclo-operacional.mjs'
import { lerFalhas } from './falhas.mjs'
import { lerMemoria, pareceConterSegredo, registrarMemoriaAnalisada } from './memoria.mjs'
import { assinaturaDiagnosticaFalha, observarFerramenta, observarPrompt } from './observador.mjs'
import { analisarExperiencias } from './pipeline-memoria.mjs'
import { materializarMelhoriaConfigurada } from './evolucao.mjs'
import { fingerprintObjetivo } from './passe.mjs'

export const DAILY_SCAN_SCHEMA_VERSION = 2
const CONTRACT_PATH = new URL('../contratos/aprendizado/varredura-diaria.json', import.meta.url)

function agora(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString()
}

function hash(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex')
}

function dataLocal(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function validarData(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) throw new Error('A data precisa usar YYYY-MM-DD.')
  const parsed = new Date(`${value}T12:00:00`)
  if (Number.isNaN(parsed.getTime()) || dataLocal(parsed) !== value) throw new Error('Data de varredura invalida.')
  return value
}

function textoSeguro(value, maximum = 1000) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (!text || pareceConterSegredo(text)) return null
  return text.slice(0, maximum)
}

async function contrato() {
  const value = JSON.parse(await readFile(CONTRACT_PATH, 'utf8'))
  if (
    value?.schemaVersion !== 1 ||
    value.contract !== 'omni-daily-activity-scan-v1' ||
    !Number.isInteger(value.automaticIntervalMinutes) ||
    !Number.isInteger(value.maximumFilesPerScan) ||
    value.requestedWorkflow?.publishOnlyPortableArtifacts !== true ||
    value.requestedWorkflow?.requireGreenGatesBeforeCommit !== true ||
    value.requestedWorkflow?.requireOriginMainConfirmation !== true ||
    value.localMaterialization?.attemptReadyCandidates !== true ||
    value.localMaterialization?.effectiveOnlyAfter !== 'installed-verified' ||
    value.localMaterialization?.countsAsRelease !== false ||
    value.localMaterialization?.countsAsPublication !== false ||
    !Array.isArray(value.localMaterialization?.reportedResults) ||
    !Array.isArray(value.report?.requiredSections) ||
    !value.report.requiredSections.includes('eligible-for-publication') ||
    !value.report.requiredSections.includes('actually-published') ||
    value.privacy?.storeRawConversation !== false ||
    value.privacy?.storeRawToolResults !== false
  ) throw new Error('Contrato da varredura diaria fora da versao 1.')
  return value
}

export function caminhoDaVarredura(casa) {
  if (!isAbsolute(casa ?? '')) throw new Error('A casa da varredura precisa ser absoluta.')
  return join(casa, 'learning', 'daily-scan.json')
}

export function caminhoDaCoberturaAoVivo(casa) {
  if (!isAbsolute(casa ?? '')) throw new Error('A casa da cobertura ao vivo precisa ser absoluta.')
  return join(casa, 'learning', 'live-coverage.json')
}

function vazio(at = agora()) {
  return {
    schemaVersion: DAILY_SCAN_SCHEMA_VERSION,
    store: { id: 'omni-local-daily-scan', createdAt: at, updatedAt: at },
    lastAutomaticCheckAt: null,
    activatedSessionFingerprints: [],
    fileCursors: [],
    capturedLiveEvidence: [],
    processedEvidence: [],
    scans: []
  }
}

function migrarV1(store) {
  return {
    ...structuredClone(store),
    schemaVersion: DAILY_SCAN_SCHEMA_VERSION,
    activatedSessionFingerprints: [],
    fileCursors: []
  }
}

async function backupAntesDaMigracao(path, raw, version) {
  const backup = `${path}.v${version}.backup`
  try {
    await writeFile(backup, raw, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
  }
}

function validarStore(store, path) {
  if (
    store?.schemaVersion !== DAILY_SCAN_SCHEMA_VERSION ||
    store.store?.id !== 'omni-local-daily-scan' ||
    !Number.isFinite(Date.parse(store.store?.createdAt)) ||
    !Number.isFinite(Date.parse(store.store?.updatedAt)) ||
    !(store.lastAutomaticCheckAt === null || Number.isFinite(Date.parse(store.lastAutomaticCheckAt))) ||
    !Array.isArray(store.activatedSessionFingerprints) ||
    !store.activatedSessionFingerprints.every((item) => /^[a-f0-9]{64}$/.test(item)) ||
    !Array.isArray(store.fileCursors) ||
    !store.fileCursors.every((item) =>
      /^[a-f0-9]{64}$/.test(item?.pathFingerprint ?? '') &&
      Number.isInteger(item?.offset) && item.offset >= 0 &&
      Number.isInteger(item?.size) && item.size >= 0 &&
      typeof item?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date)
    ) ||
    !Array.isArray(store.capturedLiveEvidence) ||
    !store.capturedLiveEvidence.every((item) => /^[a-f0-9]{64}$/.test(item)) ||
    !Array.isArray(store.processedEvidence) ||
    !store.processedEvidence.every((item) => /^[a-f0-9]{64}$/.test(item)) ||
    !Array.isArray(store.scans)
  ) throw new Error(`Estado da varredura diaria fora do contrato v1: ${path}`)
}

async function travar(casa) {
  const directory = join(casa, 'learning')
  await mkdir(directory, { recursive: true })
  const path = join(directory, 'daily-scan.lock')
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const handle = await open(path, 'wx')
      return async () => {
        await handle.close()
        await unlink(path).catch(() => undefined)
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const age = Date.now() - (await stat(path).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs
      if (age > 120_000) await unlink(path).catch(() => undefined)
      await new Promise((resolveWait) => setTimeout(resolveWait, 100))
    }
  }
  throw new Error('A varredura diaria ja esta em execucao.')
}

async function carregar(casa) {
  const path = caminhoDaVarredura(casa)
  try {
    const raw = await readFile(path, 'utf8')
    let store = JSON.parse(raw)
    if (store.schemaVersion > DAILY_SCAN_SCHEMA_VERSION) {
      throw new Error(`Varredura diaria v${store.schemaVersion} e mais nova que este plugin.`)
    }
    if (store.schemaVersion === 1) {
      await backupAntesDaMigracao(path, raw, 1)
      store = migrarV1(store)
    }
    validarStore(store, path)
    return store
  } catch (error) {
    if (error?.code === 'ENOENT') return vazio()
    throw error
  }
}

async function salvar(casa, store) {
  const path = caminhoDaVarredura(casa)
  const temporary = `${path}.${process.pid}.novo`
  store.store.updatedAt = agora()
  validarStore(store, path)
  await mkdir(join(casa, 'learning'), { recursive: true })
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

function coberturaVazia(at = agora()) {
  return {
    schemaVersion: 1,
    store: { id: 'omni-local-live-coverage', createdAt: at, updatedAt: at },
    fingerprints: []
  }
}

function validarCobertura(store, path) {
  if (
    store?.schemaVersion !== 1 ||
    store.store?.id !== 'omni-local-live-coverage' ||
    !Number.isFinite(Date.parse(store.store?.createdAt)) ||
    !Number.isFinite(Date.parse(store.store?.updatedAt)) ||
    !Array.isArray(store.fingerprints) ||
    !store.fingerprints.every((item) => /^[a-f0-9]{64}$/.test(item))
  ) throw new Error(`Estado da cobertura ao vivo fora do contrato v1: ${path}`)
}

async function carregarCobertura(casa) {
  const path = caminhoDaCoberturaAoVivo(casa)
  try {
    const store = JSON.parse(await readFile(path, 'utf8'))
    validarCobertura(store, path)
    return store
  } catch (error) {
    if (error?.code === 'ENOENT') return coberturaVazia()
    throw error
  }
}

async function salvarCobertura(casa, store) {
  const path = caminhoDaCoberturaAoVivo(casa)
  const temporary = `${path}.${process.pid}.${randomUUID()}.novo`
  store.store.updatedAt = agora()
  validarCobertura(store, path)
  await mkdir(join(casa, 'learning'), { recursive: true })
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

function diretorioDaFilaDeCobertura(casa) {
  return join(casa, 'learning', 'live-coverage-pending')
}

async function enfileirarCobertura(casa, fingerprints) {
  const directory = diretorioDaFilaDeCobertura(casa)
  await mkdir(directory, { recursive: true })
  const results = await Promise.all(fingerprints.map(async (fingerprint) => {
    try {
      // O nome contem apenas o SHA-256. Nenhum prompt, resultado ou identificador bruto e persistido.
      await writeFile(join(directory, `${fingerprint}.pending`), '', { flag: 'wx' })
      return true
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      return false
    }
  }))
  return results.filter(Boolean).length
}

async function listarCoberturaPendente(casa) {
  try {
    const entries = await readdir(diretorioDaFilaDeCobertura(casa), { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && /^[a-f0-9]{64}\.pending$/.test(entry.name))
      .map((entry) => entry.name.slice(0, 64))
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

async function tentarTravarCobertura(casa) {
  const directory = join(casa, 'learning')
  await mkdir(directory, { recursive: true })
  const path = join(directory, 'live-coverage.lock')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(path, 'wx')
      return async () => {
        await handle.close()
        await unlink(path).catch(() => undefined)
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const age = Date.now() - (await stat(path).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs
      if (age <= 15_000) return null
      await unlink(path).catch(() => undefined)
    }
  }
  return null
}

async function compactarCoberturaPendente(casa) {
  const release = await tentarTravarCobertura(casa)
  if (!release) return { result: 'queued', added: 0 }
  try {
    const [store, pending] = await Promise.all([
      carregarCobertura(casa),
      listarCoberturaPendente(casa)
    ])
    const known = new Set(store.fingerprints)
    const before = known.size
    for (const fingerprint of pending) known.add(fingerprint)
    store.fingerprints = [...known]
    await salvarCobertura(casa, store)
    await Promise.all(pending.map((fingerprint) =>
      unlink(join(diretorioDaFilaDeCobertura(casa), `${fingerprint}.pending`)).catch(() => undefined)
    ))
    return { result: known.size > before ? 'recorded' : 'duplicate', added: known.size - before }
  } finally {
    await release()
  }
}

async function lerCoberturaAoVivo(casa) {
  const [store, pending] = await Promise.all([
    carregarCobertura(casa),
    listarCoberturaPendente(casa)
  ])
  return [...new Set([...store.fingerprints, ...pending])]
}

export async function lerEstadoVarredura(casa) {
  const release = await travar(casa)
  try {
    const store = await carregar(casa)
    await salvar(casa, store)
    return store
  } finally {
    await release()
  }
}

export async function registrarCoberturaAoVivo(casa, { sessionId, prompt, toolUseId } = {}) {
  const fingerprints = []
  if (typeof prompt === 'string' && prompt.trim()) {
    fingerprints.push(hash(`prompt:${sessionId}:${hash(prompt.trim())}`))
  }
  if (typeof toolUseId === 'string' && toolUseId) fingerprints.push(hash(toolUseId))
  if (!fingerprints.length) return { result: 'ignored', added: 0 }
  try {
    const queued = await enfileirarCobertura(casa, fingerprints)
    const compacted = await compactarCoberturaPendente(casa)
    return {
      result: compacted.result,
      added: compacted.result === 'queued' ? queued : compacted.added
    }
  } catch {
    // Cobertura e telemetria auxiliar: uma falha local nunca pode derrubar UserPromptSubmit.
    return { result: 'unavailable', added: 0 }
  }
}

function cursorInicial(file, cursors, targetDate) {
  const pathFingerprint = hash(file.path.toLowerCase())
  const previous = cursors.find((item) => item.pathFingerprint === pathFingerprint)
  const reusable = previous && previous.date <= targetDate && file.size >= previous.offset
  return {
    pathFingerprint,
    start: reusable ? previous.offset : 0
  }
}

async function listarJsonl(root, policy, cursors, targetDate) {
  const candidates = []
  async function visit(directory) {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'EACCES') return
      throw error
    }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'tool-results') await visit(path)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
      const info = await stat(path)
      candidates.push({ path, size: info.size, modifiedAt: info.mtime.toISOString() })
    }
  }
  await visit(root)
  candidates.sort((left, right) => Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt))
  const files = []
  let totalBytes = 0
  for (const file of candidates) {
    if (files.length >= policy.maximumFilesPerScan) break
    const cursor = cursorInicial(file, cursors, targetDate)
    const unreadBytes = file.size - cursor.start
    if (unreadBytes === 0) continue
    if (totalBytes + unreadBytes > policy.maximumBytesPerScan) continue
    files.push({ ...file, ...cursor, unreadBytes })
    totalBytes += unreadBytes
  }
  return { files, totalBytes }
}

async function* linhasJsonl(path, start = 0) {
  const stream = createReadStream(path, { start })
  let pending = Buffer.alloc(0)
  let pendingStart = start
  let nextOffset = start
  for await (const chunkValue of stream) {
    const chunk = Buffer.isBuffer(chunkValue) ? chunkValue : Buffer.from(chunkValue)
    if (pending.length === 0) pendingStart = nextOffset
    nextOffset += chunk.length
    const buffer = pending.length ? Buffer.concat([pending, chunk]) : chunk
    let lineStart = 0
    for (let index = 0; index < buffer.length; index += 1) {
      if (buffer[index] !== 0x0a) continue
      let line = buffer.subarray(lineStart, index)
      if (line.at(-1) === 0x0d) line = line.subarray(0, -1)
      yield {
        text: line.toString('utf8'),
        startOffset: pendingStart + lineStart,
        endOffset: pendingStart + index + 1
      }
      lineStart = index + 1
    }
    pending = buffer.subarray(lineStart)
    pendingStart += lineStart
  }
  if (pending.length) {
    yield { text: pending.toString('utf8'), startOffset: pendingStart, endOffset: nextOffset }
  }
}

function conteudos(message) {
  if (typeof message?.content === 'string') return [{ type: 'text', text: message.content }]
  return Array.isArray(message?.content) ? message.content : []
}

function timestampDaLinha(record, fallback) {
  const value = record?.timestamp
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : fallback
}

function ativaOmni(text) {
  return /<command-name>\/(?:omni:)?omni<\/command-name>|<command-message>(?:omni:)?omni<\/command-message>/i.test(text ?? '')
}

function registroEhSubagente(record, file) {
  if (/(?:^|[\\/])subagents(?:[\\/]|$)/i.test(String(file ?? ''))) return true
  const scopes = [record, record?.message, record?.metadata, record?.message?.metadata, record?.context]
    .filter((item) => item && typeof item === 'object')
  const verdadeiro = (value) => value === true || String(value ?? '').toLowerCase() === 'true'
  const preenchido = (value) => value !== undefined && value !== null && String(value).trim() !== ''
  for (const scope of scopes) {
    if (
      verdadeiro(scope.isSidechain) ||
      verdadeiro(scope.is_sidechain) ||
      verdadeiro(scope.sidechain) ||
      preenchido(scope.agentId) ||
      preenchido(scope.agent_id) ||
      preenchido(scope.sourceAgentId) ||
      preenchido(scope.source_agent_id) ||
      preenchido(scope.parentAgentId) ||
      preenchido(scope.parent_agent_id) ||
      preenchido(scope.teammateId) ||
      preenchido(scope.teammate_id) ||
      /^(?:subagent|sidechain|teammate)$/i.test(String(scope.source ?? scope.origin ?? '').trim())
    ) return true
  }
  return /^(?:subagent|sidechain|teammate-message|agent-message)$/i.test(String(record?.type ?? ''))
}

function origemDoPrompt(record, content, file) {
  const value = String(content?.text ?? '').trim()
  if (
    registroEhSubagente(record, file) ||
    record?.isMeta === true ||
    record?.message?.isMeta === true ||
    /^(?:<\/?(?:system-reminder|teammate-message|task-notification|tool-result|command-message|command-name)\b|\[tool result\])/i.test(value)
  ) return 'non-owner'
  return 'owner-transcript'
}

function novaAtividade(record, content, file, lineNumber, startOffset = 0) {
  const prompt = textoSeguro(content.text, 4000)
  if (!prompt || prompt.startsWith('<')) return null
  const origin = origemDoPrompt(record, content, file)
  if (origin !== 'owner-transcript') return null
  const sessionId = record.sessionId ?? record.session_id
  const evidence = hash(`${sessionId ?? file}:${record.uuid ?? lineNumber}:user`)
  return {
    evidence,
    origin,
    startOffset,
    sessionId: String(sessionId ?? hash(file)),
    cwd: textoSeguro(record.cwd, 500),
    prompt,
    projectId: textoSeguro(record.cwd, 500),
    tools: [],
    toolById: new Map(),
    toolFamilyById: new Map(),
    failures: [],
    finalAnswerLength: 0,
    startedAt: timestampDaLinha(record, new Date().toISOString()),
    updatedAt: timestampDaLinha(record, new Date().toISOString()),
    complete: false
  }
}

function aplicarLinha(activity, record) {
  if (!activity) return
  activity.updatedAt = timestampDaLinha(record, activity.updatedAt)
  for (const content of conteudos(record.message)) {
    if (record.message?.role === 'assistant' && content.type === 'tool_use') {
      const name = textoSeguro(content.name, 100) ?? 'Tool'
      activity.tools.push({ name, id: content.id ?? null })
      if (content.id) {
        activity.toolById.set(content.id, name)
        const diagnostic = assinaturaDiagnosticaFalha({
          tool_name: name,
          tool_input: content.input,
          cwd: activity.cwd,
          error: 'execution failed'
        })
        activity.toolFamilyById.set(
          content.id,
          diagnostic.match(/(?:^|\|)family=([^|]+)/)?.[1] ?? `${name.toLowerCase()}:input-unavailable`
        )
      }
    }
    if (record.message?.role === 'user' && content.type === 'tool_result' && content.is_error === true) {
      const raw = typeof content.content === 'string' ? content.content : JSON.stringify(content.content ?? '')
      activity.failures.push({
        toolUseId: content.tool_use_id ?? hash(`${activity.evidence}:${activity.failures.length}`),
        toolName: activity.toolById.get(content.tool_use_id) ?? 'Tool',
        toolInputFamily: activity.toolFamilyById.get(content.tool_use_id) ?? null,
        error: textoSeguro(raw.split(/\r?\n/)[0], 300) ?? 'falha registrada sem conteudo bruto'
      })
    }
    if (record.message?.role === 'assistant' && content.type === 'text') {
      const answer = textoSeguro(content.text, 4000)
      if (answer) activity.finalAnswerLength = answer.length
    }
  }
}

async function extrairAtividades(files, targetDate, settleMinutes, now, initialActivated = []) {
  const activities = []
  const activatedSessions = new Set(initialActivated)
  const cursorUpdates = []
  let parsedLines = 0
  let invalidLines = 0
  const settledBefore = now.getTime() - settleMinutes * 60_000
  for (const file of files) {
    const current = new Map()
    let lineNumber = 0
    let invalidOffset = null
    for await (const line of linhasJsonl(file.path, file.start)) {
      lineNumber += 1
      if (!line.text.trim()) continue
      let record
      try {
        record = JSON.parse(line.text)
        parsedLines += 1
      } catch {
        invalidLines += 1
        invalidOffset = invalidOffset === null ? line.startOffset : Math.min(invalidOffset, line.startOffset)
        continue
      }
      const timestamp = timestampDaLinha(record, file.modifiedAt)
      const sessionId = String(record.sessionId ?? record.session_id ?? hash(file.path))
      const activityKey = `${file.path}:${sessionId}`
      const userTexts = conteudos(record.message).filter(
        (content) => record.message?.role === 'user' && content.type === 'text' && typeof content.text === 'string'
      )
      for (const content of userTexts) {
        if (ativaOmni(content.text)) {
          if (!registroEhSubagente(record, file.path)) activatedSessions.add(hash(sessionId))
          continue
        }
        if (dataLocal(timestamp) !== targetDate) continue
        const activity = novaAtividade(record, content, file.path, lineNumber, line.startOffset)
        if (!activity) continue
        const previous = current.get(activityKey)
        if (previous) {
          previous.complete = previous.finalAnswerLength > 0
          if (previous.complete) activities.push(previous)
        }
        current.set(activityKey, activity)
      }
      if (dataLocal(timestamp) !== targetDate) continue
      aplicarLinha(current.get(activityKey), record)
    }
    let safeOffset = file.size
    for (const activity of current.values()) {
      activity.complete = activity.finalAnswerLength > 0 && Date.parse(activity.updatedAt) <= settledBefore
      if (activity.complete) activities.push(activity)
      else safeOffset = Math.min(safeOffset, activity.startOffset)
    }
    if (invalidOffset !== null) safeOffset = Math.min(safeOffset, invalidOffset)
    cursorUpdates.push({
      pathFingerprint: file.pathFingerprint,
      offset: safeOffset,
      size: file.size,
      date: targetDate
    })
  }
  return {
    activities: activities.filter((activity) => activatedSessions.has(hash(activity.sessionId))),
    parsedLines,
    invalidLines,
    activatedSessions: activatedSessions.size,
    activatedSessionFingerprints: [...activatedSessions],
    cursorUpdates
  }
}

function entradaAtalho(activity) {
  const tools = activity.tools
    .map(({ name, id }) => ({
      name: name.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 80),
      id: typeof id === 'string' && id ? id : null
    }))
    .filter(({ name }) => Boolean(name))
  if (!tools.length || activity.failures.length || activity.finalAnswerLength === 0) return null
  const names = tools.map(({ name }) => name)
  const unique = names.filter((name, index) => names.indexOf(name) === index).slice(0, 12)
  const toolSet = new Set(unique.map((name) => name.toLowerCase()))
  const hasAny = (...names) => names.some((name) => toolSet.has(name.toLowerCase()))
  const delegatedAndObserved = hasAny('Agent') ||
    (hasAny('SendMessage') && hasAny('ListAgents', 'TaskOutput', 'TaskUpdate'))
  const family = delegatedAndObserved
    ? 'delegar e acompanhar uma execucao'
    : hasAny('Write', 'Edit') && hasAny('Bash', 'PowerShell')
      ? 'alterar e verificar artefatos'
      : hasAny('Read', 'Grep', 'Glob') && hasAny('Bash', 'PowerShell')
        ? 'investigar e verificar artefatos'
        : null
  if (!family) return null
  return {
    goal: family,
    baselineSteps: ['interpretar o objetivo', ...unique, 'verificar o resultado', 'reportar'],
    shortcutSteps: [...unique, 'verificar o resultado', 'reportar'],
    sessionId: activity.sessionId,
    verificationExecutionIds: tools.map(({ id }) => id).filter(Boolean).reverse(),
    scope: { type: 'user' }
  }
}

function coberturaDoCiclo(cycle, capturedLiveEvidence = []) {
  return new Set([
    ...cycle.events.map((event) => event.evidenceFingerprint),
    ...capturedLiveEvidence
  ])
}

function promptFoiCapturado(cobertura, activity) {
  return cobertura.has(hash(`prompt:${activity.sessionId}:${hash(activity.prompt)}`))
}

function ferramentaFoiCapturada(cobertura, toolUseId) {
  return cobertura.has(hash(toolUseId))
}

function normalizarMemoria(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function memoriaJaCapturadaNoDia(memory, analysis, scope, activityDate) {
  return [...memory.confirmed, ...memory.candidates].some((item) =>
    item.type === analysis.type &&
    item.scope?.type === scope.type &&
    (item.scope?.id ?? null) === (scope.id ?? null) &&
    normalizarMemoria(item.text) === normalizarMemoria(analysis.text) &&
    item.evidence.some((evidence) =>
      evidence.kind === 'daily-scan-evidence' && dataLocal(evidence.recordedAt) === activityDate
    )
  )
}

async function contadores(casa) {
  const [memory, failures, shortcuts, cycle] = await Promise.all([
    lerMemoria(casa),
    lerFalhas(casa),
    lerAtalhos(casa),
    lerCicloOperacional(casa)
  ])
  return {
    memory: { confirmed: memory.confirmed.length, candidates: memory.candidates.length },
    failures: failures.patterns.length,
    shortcuts: shortcuts.shortcuts.length,
    operationalImprovements: cycle.improvementCandidates.length
  }
}

async function processarAtividade(casa, activity, cobertura) {
  const results = {
    memories: 0,
    failures: 0,
    shortcuts: 0,
    improvements: 0,
    gapsRecovered: 0,
    materializations: []
  }
  const recordMaterialization = (metadata, materialization) => {
    if (!materialization) return
    results.materializations.push({
      candidateId: metadata?.candidateId ?? materialization.candidateId ?? materialization.candidate?.id ?? null,
      destination: metadata?.destination ?? materialization.destination ?? materialization.candidate?.destination ?? null,
      candidateStatus: metadata?.candidateStatus ?? materialization.candidate?.status ?? null,
      result: materialization.result
    })
  }
  const promptCaptured = promptFoiCapturado(cobertura, activity)
  if (!promptCaptured) {
    const analyses = analisarExperiencias(activity.prompt)
    for (const analysis of analyses.filter((item) => item.result === 'validated')) {
      const useProject = activity.projectId && ['objective', 'episodic', 'semantic', 'capability'].includes(analysis.type)
      const scope = useProject ? { type: 'project', id: activity.projectId } : { type: 'user' }
      const memory = await lerMemoria(casa)
      if (memoriaJaCapturadaNoDia(memory, analysis, scope, dataLocal(activity.startedAt))) continue
      const stored = await registrarMemoriaAnalisada(casa, {
        ...analysis,
        scope,
        source: 'daily-activity-scan-v1',
        evidenceKind: 'daily-scan-evidence'
      })
      if (stored.memory) results.memories += 1
    }

    const promptObservation = await observarPrompt(casa, {
      session_id: activity.sessionId,
      cwd: activity.cwd,
      prompt: activity.prompt,
      origin: activity.origin
    })
    results.failures += promptObservation.corrections.length
    results.improvements += promptObservation.corrections.length
    for (const correction of promptObservation.corrections) {
      recordMaterialization(correction, correction.materialization)
    }
    results.gapsRecovered += 1
  }

  for (const failure of activity.failures) {
    if (ferramentaFoiCapturada(cobertura, failure.toolUseId)) continue
    const observed = await observarFerramenta(casa, {
      hook_event_name: 'PostToolUseFailure',
      session_id: activity.sessionId,
      cwd: activity.cwd,
      tool_use_id: failure.toolUseId,
      tool_name: failure.toolName,
      tool_input_family: failure.toolInputFamily,
      error: failure.error
    })
    if (observed.failure?.pattern) results.failures += 1
    recordMaterialization(observed, observed.materialization)
    results.gapsRecovered += 1
  }

  const shortcutInput = entradaAtalho(activity)
  if (shortcutInput) {
    let learned = null
    for (const executionId of shortcutInput.verificationExecutionIds) {
      const candidate = await registrarObservacaoAtalho(casa, {
        goal: shortcutInput.goal,
        baselineSteps: shortcutInput.baselineSteps,
        shortcutSteps: shortcutInput.shortcutSteps,
        sessionId: shortcutInput.sessionId,
        executionId,
        scope: shortcutInput.scope
      }, {
        // A varredura deriva o atalho do mesmo pedido que originou a ação. O
        // hash do pedido liga essa prova histórica ao turno real sem guardar a
        // conversa nem aceitar uma ação genérica de outra solicitação.
        sourceRequestFingerprint: fingerprintObjetivo(activity.prompt)
      })
      if (candidate.result === 'unverified-action') continue
      learned = candidate
      break
    }
    if (!learned) return results
    if (learned.shortcut) results.shortcuts += 1
    if (learned.result === 'validated') {
      const improvement = await proporMelhoriaOperacional(casa, {
        category: 'verified-daily-procedure',
        destination: 'procedure',
        statement: `Consolidar o procedimento verificado para: ${shortcutInput.goal}`
      })
      if (improvement.candidate) results.improvements += 1
      if (improvement.candidate?.status === 'ready') {
        const materialization = await materializarMelhoriaConfigurada(casa, improvement.candidate.id)
        recordMaterialization({
          candidateId: improvement.candidate.id,
          destination: improvement.candidate.destination,
          candidateStatus: materialization.candidate?.status ?? improvement.candidate.status
        }, materialization)
      }
    }
  }
  return results
}

export async function varrerAtividadesDoDia(casa, {
  date = dataLocal(),
  projectsRoot = join(homedir(), '.claude', 'projects'),
  force = false,
  automatic = false,
  now = new Date()
} = {}) {
  const targetDate = validarData(date)
  const root = resolve(projectsRoot)
  const policy = await contrato()
  const release = await travar(casa)
  try {
    const store = await carregar(casa)
    if (automatic && !force && store.lastAutomaticCheckAt) {
      const elapsed = now.getTime() - Date.parse(store.lastAutomaticCheckAt)
      if (elapsed < policy.automaticIntervalMinutes * 60_000) {
        return { result: 'not-due', date: targetDate, nextCheckInMinutes: Math.ceil((policy.automaticIntervalMinutes * 60_000 - elapsed) / 60_000) }
      }
    }
    if (automatic) store.lastAutomaticCheckAt = now.toISOString()
    const before = await contadores(casa)
    const cycle = await lerCicloOperacional(casa)
    const activated = new Set([
      ...store.activatedSessionFingerprints,
      ...cycle.sessions.map((session) => session.sessionFingerprint)
    ])
    const listed = await listarJsonl(root, policy, store.fileCursors, targetDate)
    const extracted = await extrairAtividades(
      listed.files,
      targetDate,
      policy.settleMinutes,
      now,
      activated
    )
    const processed = new Set(store.processedEvidence)
    const pendingByEvidence = new Map()
    for (const activity of extracted.activities) {
      if (!processed.has(activity.evidence) && !pendingByEvidence.has(activity.evidence)) {
        pendingByEvidence.set(activity.evidence, activity)
      }
    }
    const pending = [...pendingByEvidence.values()]
    const liveCoverage = await lerCoberturaAoVivo(casa)
    const coverage = coberturaDoCiclo(cycle, [...store.capturedLiveEvidence, ...liveCoverage])
    const observationTotals = {
      memories: 0,
      failures: 0,
      shortcuts: 0,
      improvements: 0,
      gapsRecovered: 0,
      materializations: []
    }
    for (const activity of pending) {
      const result = await processarAtividade(casa, activity, coverage)
      for (const key of ['memories', 'failures', 'shortcuts', 'improvements', 'gapsRecovered']) {
        observationTotals[key] += result[key]
      }
      observationTotals.materializations.push(...result.materializations)
      processed.add(activity.evidence)
    }
    store.processedEvidence = [...processed].slice(-policy.maximumProcessedEvidence)
    store.activatedSessionFingerprints = extracted.activatedSessionFingerprints.slice(-policy.maximumProcessedEvidence)
    const cursors = new Map(store.fileCursors.map((item) => [item.pathFingerprint, item]))
    for (const cursor of extracted.cursorUpdates) cursors.set(cursor.pathFingerprint, cursor)
    store.fileCursors = [...cursors.values()].slice(-policy.maximumProcessedEvidence)
    const after = await contadores(casa)
    const materializationByResult = {}
    for (const item of observationTotals.materializations) {
      materializationByResult[item.result] = (materializationByResult[item.result] ?? 0) + 1
    }
    const observations = {
      memories: observationTotals.memories,
      failures: observationTotals.failures,
      shortcuts: observationTotals.shortcuts,
      improvements: observationTotals.improvements,
      gapsRecovered: observationTotals.gapsRecovered,
      materializations: {
        attempted: observationTotals.materializations.length,
        byResult: materializationByResult,
        candidates: observationTotals.materializations
      }
    }
    const scan = {
      id: `daily-scan-${randomUUID()}`,
      date: targetDate,
      source: 'claude-code-jsonl',
      files: listed.files.length,
      bytes: listed.totalBytes,
      parsedLines: extracted.parsedLines,
      invalidLines: extracted.invalidLines,
      activatedSessions: extracted.activatedSessions,
      activitiesFound: extracted.activities.length,
      activitiesProcessed: pending.length,
      activitiesAlreadyKnown: extracted.activities.length - pending.length,
      observations,
      before,
      after,
      changes: {
        confirmedMemories: after.memory.confirmed - before.memory.confirmed,
        candidateMemories: after.memory.candidates - before.memory.candidates,
        failurePatterns: after.failures - before.failures,
        shortcuts: after.shortcuts - before.shortcuts,
        operationalImprovements: after.operationalImprovements - before.operationalImprovements
      },
      rawConversationStored: false,
      completedAt: now.toISOString()
    }
    store.scans = [...store.scans, scan].slice(-policy.maximumScanHistory)
    await salvar(casa, store)
    return { result: 'completed', scan }
  } finally {
    await release()
  }
}
