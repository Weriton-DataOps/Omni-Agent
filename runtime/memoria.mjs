import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

const EMPTY = Object.freeze({ schemaVersion: 1, confirmed: [], candidates: [] })
const MAX_CONFIRMED = 500
const MAX_CANDIDATES = 100

export function casaDoOmni(env = process.env) {
  if (env.OMNI_HOME) return resolve(env.OMNI_HOME)
  if (env.APPDATA) return join(env.APPDATA, 'omni')
  return join(homedir(), '.omni')
}

export function caminhoDaMemoria(casa) {
  if (!isAbsolute(casa)) throw new Error('A casa da memória precisa ser um caminho absoluto.')
  return join(casa, 'memory', 'memory.json')
}

function normalizar(texto) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function pareceConterSegredo(texto) {
  const formatos = [
    /\bsk-(?:ant-)?[a-z0-9_-]{20,}\b/i,
    /\bgh[pousr]_[a-z0-9]{20,}\b/i,
    /\bAKIA[A-Z0-9]{16}\b/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
    /\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/i,
    /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:]+:[^\s@]+@/i
  ]
  if (formatos.some((padrao) => padrao.test(texto))) return true
  return /\b(?:senha|password|token|secret|api[_ -]?key|chave)\b\s*(?:é|e|:|=)\s*["']?[^\s,;"']{12,}/i.test(texto)
}

function registroValido(item, status) {
  return Boolean(
    item &&
      typeof item === 'object' &&
      typeof item.id === 'string' &&
      typeof item.text === 'string' &&
      typeof item.type === 'string' &&
      item.status === status &&
      item.scope &&
      typeof item.scope.type === 'string' &&
      typeof item.confidence === 'number' &&
      Array.isArray(item.evidence) &&
      typeof item.createdAt === 'string' &&
      typeof item.updatedAt === 'string'
  )
}

export async function lerMemoria(casa) {
  const arquivo = caminhoDaMemoria(casa)
  try {
    const dado = JSON.parse(await readFile(arquivo, 'utf8'))
    if (
      dado?.schemaVersion !== 1 ||
      !Array.isArray(dado.confirmed) ||
      !Array.isArray(dado.candidates) ||
      !dado.confirmed.every((item) => registroValido(item, 'confirmed')) ||
      !dado.candidates.every((item) => registroValido(item, 'candidate'))
    ) {
      throw new Error(`Memória fora do contrato v1: ${arquivo}`)
    }
    return dado
  } catch (erro) {
    if (erro?.code === 'ENOENT') return structuredClone(EMPTY)
    throw erro
  }
}

async function adquirirTrava(casa) {
  await mkdir(join(casa, 'memory'), { recursive: true })
  const trava = join(casa, 'memory', 'memory.lock')
  for (let tentativa = 0; tentativa < 40; tentativa += 1) {
    try {
      const handle = await open(trava, 'wx')
      return async () => {
        await handle.close()
        await unlink(trava).catch(() => undefined)
      }
    } catch (erro) {
      if (erro?.code !== 'EEXIST') throw erro
      const idade = Date.now() - (await stat(trava).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs
      if (idade > 10_000) await unlink(trava).catch(() => undefined)
      await new Promise((resolveWait) => setTimeout(resolveWait, 50))
    }
  }
  throw new Error('A memória está ocupada por outra escrita.')
}

async function gravar(casa, memoria) {
  const arquivo = caminhoDaMemoria(casa)
  const temporario = `${arquivo}.${process.pid}.novo`
  await mkdir(join(casa, 'memory'), { recursive: true })
  await writeFile(temporario, `${JSON.stringify(memoria, null, 2)}\n`, 'utf8')
  await rename(temporario, arquivo)
}

async function registrar(casa, entrada) {
  const text = entrada.text.trim()
  if (!text) return { result: 'ignored', memory: null }
  if (pareceConterSegredo(text)) {
    return { result: 'refused', memory: null, reason: 'possible-secret' }
  }

  const liberar = await adquirirTrava(casa)
  try {
    const memoria = await lerMemoria(casa)
    const key = `${entrada.scope.type}:${entrada.scope.id ?? ''}:${normalizar(text)}`
    const existente = [...memoria.confirmed, ...memoria.candidates].find(
      (item) => `${item.scope.type}:${item.scope.id ?? ''}:${normalizar(item.text)}` === key
    )
    if (existente) return { result: 'already-exists', memory: existente }

    const agora = new Date().toISOString()
    const item = {
      id: `mem-${randomUUID()}`,
      type: entrada.type,
      scope: entrada.scope,
      text,
      source: entrada.source,
      status: entrada.status,
      confidence: entrada.confidence,
      evidence: [{ kind: entrada.evidenceKind, recordedAt: agora }],
      createdAt: agora,
      updatedAt: agora,
      lastValidatedAt: entrada.status === 'confirmed' ? agora : null,
      usageCount: 0,
      expiresAt: null
    }
    if (item.status === 'confirmed') {
      memoria.confirmed = [...memoria.confirmed, item].slice(-MAX_CONFIRMED)
    } else {
      memoria.candidates = [...memoria.candidates, item].slice(-MAX_CANDIDATES)
    }
    await gravar(casa, memoria)
    return { result: item.status, memory: item }
  } finally {
    await liberar()
  }
}

export function lembrarExplicitamente(casa, text, type = 'semantic', scope = { type: 'user' }) {
  return registrar(casa, {
    text,
    type,
    scope,
    source: 'explicit-plugin-command',
    status: 'confirmed',
    confidence: 1,
    evidenceKind: 'explicit-request'
  })
}

export function proporLicao(casa, text, scope = { type: 'user' }) {
  return registrar(casa, {
    text,
    type: 'procedural',
    scope,
    source: 'plugin-lesson',
    status: 'candidate',
    confidence: 0.6,
    evidenceKind: 'lesson-proposal'
  })
}

export async function decidirCandidata(casa, id, decision) {
  const liberar = await adquirirTrava(casa)
  try {
    const memoria = await lerMemoria(casa)
    const candidata = memoria.candidates.find((item) => item.id === id)
    if (!candidata) return { result: 'not-found', memory: null }
    memoria.candidates = memoria.candidates.filter((item) => item.id !== id)
    if (decision === 'confirm') {
      const agora = new Date().toISOString()
      const confirmada = {
        ...candidata,
        status: 'confirmed',
        confidence: Math.max(0.9, candidata.confidence),
        updatedAt: agora,
        lastValidatedAt: agora,
        evidence: [...candidata.evidence, { kind: 'human-confirmation', recordedAt: agora }]
      }
      memoria.confirmed = [...memoria.confirmed, confirmada].slice(-MAX_CONFIRMED)
      await gravar(casa, memoria)
      return { result: 'confirmed', memory: confirmada }
    }
    await gravar(casa, memoria)
    return { result: 'discarded', memory: candidata }
  } finally {
    await liberar()
  }
}
