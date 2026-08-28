#!/usr/bin/env node

import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from 'node:crypto'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, normalize, parse, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const CONTRATO_PASSE = 'omni-authority-credential-v2'
export const OBJECTIVE_FINGERPRINT_ALGORITHM = 'omni-authority-objective-v1'
export const CLASSES_EFEITO = Object.freeze([
  'read',
  'execute',
  'write',
  'network',
  'remote-write',
  'destructive',
  'financial',
  'privilege'
])
export const EFEITOS_MATERIAIS = Object.freeze([
  'write',
  'network',
  'remote-write',
  'destructive',
  'financial',
  'privilege'
])

const MAX_MINUTOS = 480
const LOCK_EXPIRA_MS = 30_000

export function casaPadrao(env = process.env, home = homedir()) {
  return env.APPDATA ? join(env.APPDATA, 'omni') : join(home, '.omni')
}

export function caminhosPasse({ casa = casaPadrao() } = {}) {
  const config = join(casa, 'config')
  return {
    casa,
    config,
    chave: join(config, 'credencial-chave-v2'),
    cofre: join(config, 'passes-v2.json'),
    lock: join(config, 'passes-v2.lock'),
    legado: join(config, 'passes.json')
  }
}

function jsonCanonico(valor) {
  if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(',')}]`
  if (valor && typeof valor === 'object') {
    return `{${Object.keys(valor).sort().map((chave) => (
      `${JSON.stringify(chave)}:${jsonCanonico(valor[chave])}`
    )).join(',')}}`
  }
  return JSON.stringify(valor)
}

function textoCanonico(valor) {
  if (typeof valor === 'string') return valor.replace(/\r\n/g, '\n').trim().replace(/[ \t]+/g, ' ')
  return jsonCanonico(valor)
}

export function fingerprint(valor) {
  return createHash('sha256').update(textoCanonico(valor), 'utf8').digest('hex')
}

export function fingerprintObjetivo(valor) {
  return fingerprint(valor)
}

function pareceCaminhoWindows(valor) {
  return /^[A-Za-z]:[\\/]/.test(String(valor ?? '')) || /^\\\\/.test(String(valor ?? ''))
}

export function normalizarAlvo(valor, { cwd = process.cwd() } = {}) {
  const bruto = String(valor ?? '').trim()
  if (!bruto || bruto.includes('\0')) throw new Error('Alvo ausente ou inválido.')
  let absoluto = isAbsolute(bruto) || pareceCaminhoWindows(bruto) ? normalize(bruto) : resolve(cwd, bruto)
  try {
    absoluto = realpathSync.native(absoluto)
  } catch {
    // O emissor pode preparar autoridade antes de o alvo existir. A resolução lexical continua fechada.
  }
  absoluto = normalize(absoluto)
  const raiz = parseRaiz(absoluto)
  if (absoluto !== raiz) absoluto = absoluto.replace(/[\\/]+$/, '')
  return process.platform === 'win32' || pareceCaminhoWindows(absoluto)
    ? absoluto.toLocaleLowerCase('en-US')
    : absoluto
}

function parseRaiz(caminho) {
  const correspondenciaWindows = String(caminho).match(/^[A-Za-z]:[\\/]/)
  if (correspondenciaWindows) return `${caminho.slice(0, 2)}\\`
  if (String(caminho).startsWith('\\\\')) {
    const partes = String(caminho).split(/[\\/]+/).filter(Boolean)
    return partes.length >= 2 ? `\\\\${partes[0]}\\${partes[1]}\\` : caminho
  }
  return parse(caminho).root
}

export function fingerprintAlvo(valor, opcoes) {
  return fingerprint(normalizarAlvo(valor, opcoes))
}

export function fingerprintAmbiente(valor) {
  return fingerprintAlvo(valor)
}

function exigirTexto(nome, valor, { minimo = 1, maximo = 500 } = {}) {
  const texto = String(valor ?? '').trim()
  if (texto.length < minimo || texto.length > maximo) {
    throw new Error(`${nome} precisa ter entre ${minimo} e ${maximo} caracteres.`)
  }
  return texto
}

function normalizarEfeitos(efeitos) {
  const lista = [...new Set((Array.isArray(efeitos) ? efeitos : String(efeitos ?? '').split(','))
    .map((item) => String(item).trim().toLowerCase())
    .filter(Boolean))].sort()
  if (!lista.length) throw new Error('Ao menos uma classe de efeito é obrigatória.')
  const invalida = lista.find((item) => !CLASSES_EFEITO.includes(item))
  if (invalida) throw new Error(`Classe de efeito desconhecida: ${invalida}.`)
  return lista
}

function chaveBuffer(chave) {
  if (Buffer.isBuffer(chave)) {
    if (chave.length < 32) throw new Error('A chave de credencial precisa ter ao menos 32 bytes.')
    return chave
  }
  const texto = String(chave ?? '').trim()
  const buffer = /^[a-f0-9]{64,}$/i.test(texto) && texto.length % 2 === 0
    ? Buffer.from(texto, 'hex')
    : Buffer.from(texto, 'utf8')
  if (buffer.length < 32) throw new Error('A chave de credencial precisa ter ao menos 32 bytes.')
  return buffer
}

export function corpoAssinatura(passe) {
  return jsonCanonico({
    schemaVersion: passe.schemaVersion,
    contract: passe.contract,
    id: passe.id,
    authorityId: passe.authorityId,
    sessionHash: passe.sessionHash,
    agentId: passe.agentId,
    objectiveFingerprint: passe.objectiveFingerprint,
    targetFingerprints: passe.targetFingerprints,
    environmentFingerprint: passe.environmentFingerprint,
    effectClasses: passe.effectClasses,
    checkpointFingerprint: passe.checkpointFingerprint,
    rollbackFingerprint: passe.rollbackFingerprint,
    issuedAt: passe.issuedAt,
    expiresAt: passe.expiresAt
  })
}

export function assinarPasse(passe, chave) {
  return createHmac('sha256', chaveBuffer(chave))
    .update(corpoAssinatura(passe), 'utf8')
    .digest('hex')
}

function assinaturaIgual(recebida, esperada) {
  if (!/^[a-f0-9]{64}$/i.test(String(recebida ?? ''))) return false
  const esquerda = Buffer.from(recebida, 'hex')
  const direita = Buffer.from(esperada, 'hex')
  return esquerda.length === direita.length && timingSafeEqual(esquerda, direita)
}

export function validarEstruturaPasse(passe) {
  if (!passe || passe.schemaVersion !== 2 || passe.contract !== CONTRATO_PASSE) return false
  const textos = [
    'id', 'authorityId', 'sessionHash', 'agentId', 'objectiveFingerprint',
    'environmentFingerprint', 'issuedAt', 'expiresAt', 'signature'
  ]
  if (textos.some((campo) => typeof passe[campo] !== 'string' || !passe[campo])) return false
  if (passe.id.length > 300 || passe.authorityId.length > 300 || passe.agentId.length > 300) return false
  for (const campo of ['sessionHash', 'objectiveFingerprint', 'environmentFingerprint']) {
    if (!/^[a-f0-9]{64}$/i.test(passe[campo])) return false
  }
  if (!Array.isArray(passe.targetFingerprints) || passe.targetFingerprints.length === 0) return false
  if (!Array.isArray(passe.effectClasses) || passe.effectClasses.length === 0) return false
  if (passe.targetFingerprints.some((item) => !/^[a-f0-9]{64}$/i.test(item))) return false
  if (passe.effectClasses.some((item) => !CLASSES_EFEITO.includes(item))) return false
  if (new Set(passe.targetFingerprints).size !== passe.targetFingerprints.length) return false
  if (new Set(passe.effectClasses).size !== passe.effectClasses.length) return false
  if (passe.effectClasses.join('|') !== [...passe.effectClasses].sort().join('|')) return false
  const emitido = Date.parse(passe.issuedAt)
  const expira = Date.parse(passe.expiresAt)
  if (!Number.isFinite(emitido) || !Number.isFinite(expira)) return false
  if (expira <= emitido || expira - emitido > MAX_MINUTOS * 60_000) return false
  const material = passe.effectClasses.some((item) => EFEITOS_MATERIAIS.includes(item))
  if (material && (!passe.checkpointFingerprint || !passe.rollbackFingerprint)) return false
  if (material && (
    !/^[a-f0-9]{64}$/i.test(passe.checkpointFingerprint) ||
    !/^[a-f0-9]{64}$/i.test(passe.rollbackFingerprint)
  )) return false
  if (!material && (
    passe.checkpointFingerprint !== null || passe.rollbackFingerprint !== null
  )) return false
  return true
}

export function verificarPasse(passe, chave, { agora = Date.now() } = {}) {
  try {
    if (!validarEstruturaPasse(passe)) return false
    if (Date.parse(passe.issuedAt) > Number(agora) + 60_000) return false
    if (Date.parse(passe.expiresAt) <= Number(agora)) return false
    return assinaturaIgual(passe.signature, assinarPasse(passe, chave))
  } catch {
    return false
  }
}

export function criarPasse({
  sessao,
  agente,
  autoridade,
  objetivo,
  alvos,
  ambiente,
  efeitos = ['read'],
  minutos = 60,
  checkpoint,
  rollback
}, {
  chave,
  agora = Date.now(),
  id = `passe-${randomUUID()}`
} = {}) {
  const sessionId = exigirTexto('Sessão', sessao, { maximo: 1000 })
  const agentId = exigirTexto('Agente', agente, { maximo: 300 })
  const authorityId = exigirTexto('Authority ID', autoridade, { maximo: 300 })
  const objetivoLimpo = exigirTexto('Objetivo', objetivo, { minimo: 3, maximo: 5000 })
  const ambienteLimpo = exigirTexto('Ambiente', ambiente, { maximo: 2000 })
  const listaAlvos = [...new Set((Array.isArray(alvos) ? alvos : [alvos])
    .map((item) => String(item ?? '').trim()).filter(Boolean))]
  if (!listaAlvos.length) throw new Error('Ao menos um alvo é obrigatório.')
  const effectClasses = normalizarEfeitos(efeitos)
  const duracao = Number(minutos)
  if (!Number.isFinite(duracao) || duracao < 1 || duracao > MAX_MINUTOS) {
    throw new Error(`A validade precisa estar entre 1 e ${MAX_MINUTOS} minutos.`)
  }
  const material = effectClasses.some((item) => EFEITOS_MATERIAIS.includes(item))
  if (material && (!String(checkpoint ?? '').trim() || !String(rollback ?? '').trim())) {
    throw new Error('Efeito material exige checkpoint e rollback/compensação antes da emissão.')
  }
  const issuedAt = new Date(Number(agora)).toISOString()
  const passe = {
    schemaVersion: 2,
    contract: CONTRATO_PASSE,
    id: exigirTexto('ID do passe', id, { maximo: 300 }),
    authorityId,
    sessionHash: fingerprint(sessionId),
    agentId,
    objectiveFingerprint: fingerprintObjetivo(objetivoLimpo),
    targetFingerprints: [...new Set(
      listaAlvos.map((alvo) => fingerprintAlvo(alvo, { cwd: ambienteLimpo }))
    )].sort(),
    environmentFingerprint: fingerprintAmbiente(ambienteLimpo),
    effectClasses,
    checkpointFingerprint: material ? fingerprint(exigirTexto('Checkpoint', checkpoint, { maximo: 5000 })) : null,
    rollbackFingerprint: material ? fingerprint(exigirTexto('Rollback', rollback, { maximo: 5000 })) : null,
    issuedAt,
    expiresAt: new Date(Number(agora) + duracao * 60_000).toISOString()
  }
  passe.signature = assinarPasse(passe, chave)
  return passe
}

function cofreVazio() {
  return { schemaVersion: 2, contract: CONTRATO_PASSE, passes: [] }
}

export function lerCofre(caminho) {
  if (!existsSync(caminho)) return cofreVazio()
  const parsed = JSON.parse(readFileSync(caminho, 'utf8'))
  if (parsed?.schemaVersion !== 2 || parsed?.contract !== CONTRATO_PASSE || !Array.isArray(parsed?.passes)) {
    throw new Error('Cofre v2 inválido; o cofre legado foi preservado e não será reinterpretado.')
  }
  return parsed
}

function chaveExistente(caminho) {
  const valor = readFileSync(caminho, 'utf8').trim()
  chaveBuffer(valor)
  return valor
}

export function obterOuCriarChave(caminho) {
  mkdirSync(dirname(caminho), { recursive: true })
  try {
    return chaveExistente(caminho)
  } catch (erro) {
    if (erro?.code !== 'ENOENT') throw erro
  }
  const nova = randomBytes(32).toString('hex')
  let descritor
  try {
    descritor = openSync(caminho, 'wx', 0o600)
    writeFileSync(descritor, nova, 'utf8')
    closeSync(descritor)
    descritor = undefined
    return nova
  } catch (erro) {
    if (descritor !== undefined) closeSync(descritor)
    if (erro?.code === 'EEXIST') return chaveExistente(caminho)
    throw erro
  }
}

function gravarAtomico(caminho, valor) {
  mkdirSync(dirname(caminho), { recursive: true })
  const temporario = `${caminho}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporario, `${JSON.stringify(valor, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    renameSync(temporario, caminho)
  } finally {
    try { if (existsSync(temporario)) unlinkSync(temporario) } catch { /* limpeza best effort */ }
  }
}

const esperar = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

async function comLock(caminho, operacao, { timeoutMs = 5000 } = {}) {
  mkdirSync(dirname(caminho), { recursive: true })
  const inicio = Date.now()
  let descritor
  while (descritor === undefined) {
    try {
      descritor = openSync(caminho, 'wx', 0o600)
      writeFileSync(descritor, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), 'utf8')
    } catch (erro) {
      if (erro?.code !== 'EEXIST') throw erro
      try {
        if (Date.now() - statSync(caminho).mtimeMs > LOCK_EXPIRA_MS) unlinkSync(caminho)
      } catch (inspecao) {
        if (inspecao?.code !== 'ENOENT') throw inspecao
      }
      if (Date.now() - inicio >= timeoutMs) throw new Error('Tempo esgotado aguardando o lock do cofre v2.')
      await esperar(10)
    }
  }
  try {
    return await operacao()
  } finally {
    closeSync(descritor)
    try { unlinkSync(caminho) } catch (erro) { if (erro?.code !== 'ENOENT') throw erro }
  }
}

async function persistirPasse(passe, { caminhos, agora }) {
  await comLock(caminhos.lock, async () => {
    const cofre = lerCofre(caminhos.cofre)
    cofre.passes = cofre.passes.filter((item) => Date.parse(item?.expiresAt ?? 0) > Number(agora))
    cofre.passes.push(passe)
    gravarAtomico(caminhos.cofre, cofre)
  })
  return passe
}

export async function emitirPasse(dados, {
  caminhos = caminhosPasse(),
  agora = Date.now(),
  id
} = {}) {
  const chave = obterOuCriarChave(caminhos.chave)
  const passe = criarPasse(dados, { chave, agora, id })
  return persistirPasse(passe, { caminhos, agora })
}

export function listarPasses({ caminhos = caminhosPasse() } = {}) {
  return lerCofre(caminhos.cofre).passes
}

export async function revogarPasse(id, {
  todos = false,
  caminhos = caminhosPasse()
} = {}) {
  return comLock(caminhos.lock, async () => {
    const cofre = lerCofre(caminhos.cofre)
    const antes = cofre.passes.length
    cofre.passes = todos ? [] : cofre.passes.filter((item) => item.id !== id)
    gravarAtomico(caminhos.cofre, cofre)
    return { revoked: antes - cofre.passes.length, remaining: cofre.passes.length }
  })
}

function opcoesCli(args) {
  const opcoes = {}
  const posicionais = []
  for (let indice = 0; indice < args.length; indice += 1) {
    const atual = args[indice]
    if (!atual.startsWith('--')) {
      posicionais.push(atual)
      continue
    }
    const nome = atual.slice(2)
    if (nome === 'todos') {
      opcoes.todos = true
      continue
    }
    const valor = args[indice + 1]
    if (valor === undefined || valor.startsWith('--')) throw new Error(`Falta valor para --${nome}.`)
    indice += 1
    if (nome === 'alvo') opcoes.alvo = [...(opcoes.alvo ?? []), valor]
    else opcoes[nome] = valor
  }
  return { opcoes, posicionais }
}

export async function executarCli(args = process.argv.slice(2), dependencias = {}) {
  const [acao = 'listar', ...resto] = args
  const { opcoes, posicionais } = opcoesCli(resto)
  if (acao === 'emitir') {
    const passe = await emitirPasse({
      sessao: opcoes.sessao,
      agente: opcoes.agente,
      autoridade: opcoes.autoridade,
      objetivo: opcoes.objetivo,
      alvos: opcoes.alvo,
      ambiente: opcoes.ambiente,
      efeitos: opcoes.efeito ?? 'read',
      minutos: opcoes.minutos ?? 60,
      checkpoint: opcoes.checkpoint,
      rollback: opcoes.rollback
    }, dependencias)
    return { action: 'emitir', pass: passe }
  }
  if (acao === 'listar') return { action: 'listar', passes: listarPasses(dependencias) }
  if (acao === 'revogar') {
    if (!opcoes.todos && !posicionais[0]) throw new Error('Informe o ID do passe ou --todos.')
    return {
      action: 'revogar',
      ...(await revogarPasse(posicionais[0], { ...dependencias, todos: opcoes.todos }))
    }
  }
  throw new Error('Ações: emitir | listar | revogar.')
}

function imprimirResultado(resultado) {
  if (resultado.action === 'emitir') {
    console.log(`passe emitido : ${resultado.pass.id}`)
    console.log(`autoridade    : ${resultado.pass.authorityId}`)
    console.log(`efeitos       : ${resultado.pass.effectClasses.join(', ')}`)
    console.log(`expira em     : ${resultado.pass.expiresAt}`)
    return
  }
  if (resultado.action === 'listar') {
    if (!resultado.passes.length) return console.log('nenhum passe v2 emitido')
    for (const passe of resultado.passes) {
      console.log(`${passe.id} agente=${passe.agentId} efeitos=${passe.effectClasses.join('/')} expira=${passe.expiresAt}`)
    }
    return
  }
  console.log(`revogados: ${resultado.revoked} | restantes: ${resultado.remaining}`)
}

const direto = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (direto) {
  executarCli()
    .then(imprimirResultado)
    .catch((erro) => {
      process.stderr.write(`${erro.message}\n`)
      process.exitCode = 1
    })
}
