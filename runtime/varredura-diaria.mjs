import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'

import { lerAtalhos, registrarObservacaoAtalho, validarAtalho } from './atalhos.mjs'
import { lerCicloOperacional, proporMelhoriaOperacional } from './ciclo-operacional.mjs'
import { lerFalhas } from './falhas.mjs'
import { lerMemoria, pareceConterSegredo, registrarMemoriaAnalisada } from './memoria.mjs'
import { observarFerramenta, observarPrompt } from './observador.mjs'
import { analisarExperiencias } from './pipeline-memoria.mjs'

export const DAILY_SCAN_SCHEMA_VERSION = 1
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
    value.privacy?.storeRawConversation !== false ||
    value.privacy?.storeRawToolResults !== false
  ) throw new Error('Contrato da varredura diaria fora da versao 1.')
  return value
}

export function caminhoDaVarredura(casa) {
  if (!isAbsolute(casa ?? '')) throw new Error('A casa da varredura precisa ser absoluta.')
  return join(casa, 'learning', 'daily-scan.json')
}

function vazio(at = agora()) {
  return {
    schemaVersion: DAILY_SCAN_SCHEMA_VERSION,
    store: { id: 'omni-local-daily-scan', createdAt: at, updatedAt: at },
    lastAutomaticCheckAt: null,
    capturedLiveEvidence: [],
    processedEvidence: [],
    scans: []
  }
}

function validarStore(store, path) {
  if (
    store?.schemaVersion !== 1 ||
    store.store?.id !== 'omni-local-daily-scan' ||
    !Number.isFinite(Date.parse(store.store?.createdAt)) ||
    !Number.isFinite(Date.parse(store.store?.updatedAt)) ||
    !(store.lastAutomaticCheckAt === null || Number.isFinite(Date.parse(store.lastAutomaticCheckAt))) ||
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
    const store = JSON.parse(await readFile(path, 'utf8'))
    if (store.schemaVersion > DAILY_SCAN_SCHEMA_VERSION) {
      throw new Error(`Varredura diaria v${store.schemaVersion} e mais nova que este plugin.`)
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
  const policy = await contrato()
  const release = await travar(casa)
  try {
    const store = await carregar(casa)
    const known = new Set(store.capturedLiveEvidence)
    const before = known.size
    for (const fingerprint of fingerprints) known.add(fingerprint)
    store.capturedLiveEvidence = [...known].slice(-policy.maximumProcessedEvidence)
    await salvar(casa, store)
    return { result: known.size > before ? 'recorded' : 'duplicate', added: known.size - before }
  } finally {
    await release()
  }
}

async function listarJsonl(root, policy) {
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
    if (totalBytes + file.size > policy.maximumBytesPerScan) continue
    files.push(file)
    totalBytes += file.size
  }
  return { files, totalBytes }
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

function novaAtividade(record, content, file, lineNumber) {
  const prompt = textoSeguro(content.text, 4000)
  if (!prompt || prompt.startsWith('<')) return null
  const sessionId = record.sessionId ?? record.session_id
  const evidence = hash(`${sessionId ?? file}:${record.uuid ?? lineNumber}:user`)
  return {
    evidence,
    sessionId: String(sessionId ?? hash(file)),
    cwd: textoSeguro(record.cwd, 500),
    prompt,
    projectId: textoSeguro(record.cwd, 500),
    tools: [],
    toolById: new Map(),
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
      if (content.id) activity.toolById.set(content.id, name)
    }
    if (record.message?.role === 'user' && content.type === 'tool_result' && content.is_error === true) {
      const raw = typeof content.content === 'string' ? content.content : JSON.stringify(content.content ?? '')
      activity.failures.push({
        toolUseId: content.tool_use_id ?? hash(`${activity.evidence}:${activity.failures.length}`),
        toolName: activity.toolById.get(content.tool_use_id) ?? 'Tool',
        error: textoSeguro(raw.split(/\r?\n/)[0], 300) ?? 'falha registrada sem conteudo bruto'
      })
    }
    if (record.message?.role === 'assistant' && content.type === 'text') {
      const answer = textoSeguro(content.text, 4000)
      if (answer) activity.finalAnswerLength = answer.length
    }
  }
}

async function extrairAtividades(files, targetDate, settleMinutes, now) {
  const activities = []
  const current = new Map()
  const activatedSessions = new Set()
  let parsedLines = 0
  let invalidLines = 0
  for (const file of files) {
    const stream = createReadStream(file.path, { encoding: 'utf8' })
    const reader = createInterface({ input: stream, crlfDelay: Infinity })
    let lineNumber = 0
    for await (const line of reader) {
      lineNumber += 1
      if (!line.trim()) continue
      let record
      try {
        record = JSON.parse(line)
        parsedLines += 1
      } catch {
        invalidLines += 1
        continue
      }
      const timestamp = timestampDaLinha(record, file.modifiedAt)
      if (dataLocal(timestamp) !== targetDate) continue
      const sessionId = String(record.sessionId ?? record.session_id ?? hash(file.path))
      const activityKey = `${file.path}:${sessionId}`
      const userTexts = conteudos(record.message).filter(
        (content) => record.message?.role === 'user' && content.type === 'text' && typeof content.text === 'string'
      )
      for (const content of userTexts) {
        if (ativaOmni(content.text)) {
          activatedSessions.add(sessionId)
          continue
        }
        const previous = current.get(activityKey)
        if (previous) {
          previous.complete = previous.finalAnswerLength > 0
          if (previous.complete) activities.push(previous)
        }
        const activity = novaAtividade(record, content, file.path, lineNumber)
        if (activity) current.set(activityKey, activity)
      }
      aplicarLinha(current.get(activityKey), record)
    }
  }
  const settledBefore = now.getTime() - settleMinutes * 60_000
  for (const activity of current.values()) {
    activity.complete = activity.finalAnswerLength > 0 && Date.parse(activity.updatedAt) <= settledBefore
    if (activity.complete) activities.push(activity)
  }
  return {
    activities: activities.filter((activity) => activatedSessions.has(activity.sessionId)),
    parsedLines,
    invalidLines,
    activatedSessions: activatedSessions.size
  }
}

function mesmoAtalho(item, input) {
  return item.goal === input.goal &&
    JSON.stringify(item.baselineSteps) === JSON.stringify(input.baselineSteps) &&
    JSON.stringify(item.shortcutSteps) === JSON.stringify(input.shortcutSteps)
}

function entradaAtalho(activity) {
  const tools = activity.tools
    .map(({ name }) => name.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 80))
    .filter(Boolean)
  if (!tools.length || activity.failures.length || activity.finalAnswerLength === 0) return null
  const unique = tools.filter((name, index) => tools.indexOf(name) === index).slice(0, 12)
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
  const normalized = activity.prompt
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  const intent = [
    ['corrigir', /\b(?:corrig|consert|ajust|resolve|repar)/],
    ['validar', /\b(?:valid|verific|test|confir)/],
    ['implementar', /\b(?:implement|cri|constru|adicion|inclu)/],
    ['analisar', /\b(?:analis|avali|investig|diagnostic|procure a causa)/],
    ['organizar', /\b(?:organiz|reorgan|estrutur)/],
    ['consultar', /\b(?:consult|busc|pesquis|liste|mostre)/]
  ].find(([, pattern]) => pattern.test(normalized))?.[0] ?? 'executar'
  const goal = intent === 'executar' ? family : `${intent}: ${family}`
  return {
    goal,
    baselineSteps: ['interpretar o objetivo', ...unique, 'verificar o resultado', 'reportar'],
    shortcutSteps: [...unique, 'reportar'],
    outcome: 'atividade concluida com evidencia local',
    success: true,
    scope: activity.projectId ? { type: 'project', id: activity.projectId } : { type: 'user' }
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
  const results = { memories: 0, failures: 0, shortcuts: 0, improvements: 0, gapsRecovered: 0 }
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
      prompt: activity.prompt
    })
    results.failures += promptObservation.corrections.length
    results.improvements += promptObservation.corrections.length
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
      error: failure.error
    })
    if (observed.failure?.pattern) results.failures += 1
    results.gapsRecovered += 1
  }

  const shortcutInput = entradaAtalho(activity)
  if (shortcutInput) {
    const store = await lerAtalhos(casa)
    const existing = store.shortcuts.find((item) => mesmoAtalho(item, shortcutInput))
    const learned = existing?.status === 'candidate'
      ? await validarAtalho(casa, existing.id, shortcutInput)
      : await registrarObservacaoAtalho(casa, shortcutInput)
    if (learned.shortcut) results.shortcuts += 1
    if (learned.result === 'candidate' || learned.result === 'validated') {
      const improvement = await proporMelhoriaOperacional(casa, {
        category: 'verified-daily-procedure',
        destination: 'procedure',
        statement: `Consolidar o procedimento verificado para: ${shortcutInput.goal}`
      })
      if (improvement.candidate) results.improvements += 1
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
    const listed = await listarJsonl(root, policy)
    const extracted = await extrairAtividades(listed.files, targetDate, policy.settleMinutes, now)
    const processed = new Set(store.processedEvidence)
    const pendingByEvidence = new Map()
    for (const activity of extracted.activities) {
      if (!processed.has(activity.evidence) && !pendingByEvidence.has(activity.evidence)) {
        pendingByEvidence.set(activity.evidence, activity)
      }
    }
    const pending = [...pendingByEvidence.values()]
    const coverage = coberturaDoCiclo(await lerCicloOperacional(casa), store.capturedLiveEvidence)
    const observations = { memories: 0, failures: 0, shortcuts: 0, improvements: 0, gapsRecovered: 0 }
    for (const activity of pending) {
      const result = await processarAtividade(casa, activity, coverage)
      for (const key of Object.keys(observations)) observations[key] += result[key]
      processed.add(activity.evidence)
    }
    store.processedEvidence = [...processed].slice(-policy.maximumProcessedEvidence)
    const after = await contadores(casa)
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
