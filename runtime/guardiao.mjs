#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { dirname, parse, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolverTurnoAtivoAuditoriaSync } from './auditoria-autocorrecao.mjs'

import {
  OBJECTIVE_FINGERPRINT_ALGORITHM,
  caminhosPasse,
  fingerprint,
  fingerprintAlvo,
  fingerprintAmbiente,
  lerCofre,
  normalizarAlvo,
  verificarPasse
} from './passe.mjs'

const FORMAS_HISTORICAS = Object.freeze([
  {
    id: 'bash-heredoc-write',
    ferramenta: /^Bash$/i,
    teste: (comando) => /(^|[\s;|&])(cat|tee)\s*>{1,2}/i.test(comando) && /<<-?\s*['"]?[A-Za-z_]/.test(comando),
    orientacao: 'Forma historicamente instável: prefira a ferramenta de edição para o arquivo e execute-o separadamente.'
  },
  {
    id: 'bash-cd-chain',
    ferramenta: /^Bash$/i,
    teste: (comando) => /(^|[\s;]|&&|\|\|)cd\s+[^;&|]+?\s*(&&|;)/i.test(comando),
    orientacao: 'Forma historicamente instável: use caminho absoluto ou `git -C <repo>` em uma única operação.'
  },
  {
    id: 'powershell-expandable-subexpression',
    ferramenta: /^PowerShell$/i,
    teste: (comando) => /"[^"]*\$\([^)]*\)[^"]*"/.test(comando),
    orientacao: 'Forma historicamente instável: calcule o valor antes e passe a variável simples, ou use texto literal.'
  },
  {
    id: 'powershell-expandable-herestring',
    ferramenta: /^PowerShell$/i,
    teste: (comando) => /@"\r?\n/.test(comando),
    orientacao: "Forma historicamente instável: prefira here-string literal @'...'@ e uma operação separada."
  }
])

const GIT_LEITURA = new Set(['status', 'log', 'show', 'diff', 'rev-parse', 'ls-files'])
const COMANDOS_SEM_ALVO = new Set(['pwd', 'date', 'get-date'])
const COMANDOS_LISTAGEM = new Set(['ls', 'dir', 'tree', 'get-childitem'])
const COMANDOS_ARQUIVO = new Set([
  'cat', 'head', 'tail', 'stat', 'wc',
  'get-content', 'get-item', 'test-path', 'resolve-path'
])
const EXECUTAVEIS_BASH = new Set([
  'git', 'rg', 'pwd', 'date', 'ls', 'dir', 'tree', 'cat', 'head', 'tail', 'stat', 'wc'
])
const EXECUTAVEIS_POWERSHELL = new Set([
  'git', 'rg', 'get-date', 'get-childitem', 'get-content', 'get-item', 'test-path', 'resolve-path'
])

export function detectarFormaHistorica(ferramenta, comando) {
  if (!comando) return null
  for (const regra of FORMAS_HISTORICAS) {
    try {
      if (regra.ferramenta.test(String(ferramenta ?? '')) && regra.teste(comando)) {
        return { id: regra.id, guidance: regra.orientacao }
      }
    } catch {
      // Detector defeituoso se abstém junto com o guardião; nunca cria um bloqueio.
    }
  }
  return null
}

export function comandoDe(entrada) {
  const alvo = entrada?.tool_input
  if (typeof alvo === 'string') return alvo
  if (alvo && typeof alvo === 'object') {
    for (const campo of ['command', 'cmd', 'script']) {
      if (typeof alvo[campo] === 'string') return alvo[campo]
    }
  }
  return ''
}

function ambienteDe(entrada) {
  for (const valor of [entrada?.tool_input?.cwd, entrada?.cwd]) {
    if (typeof valor === 'string' && valor.trim()) return valor.trim()
  }
  return ''
}

function analisarLexico(comando, ferramenta) {
  const tokens = []
  let atual = ''
  let aspas = null
  let escapado = false
  for (let indice = 0; indice < comando.length; indice += 1) {
    const caractere = comando[indice]
    if (escapado) {
      atual += caractere
      escapado = false
      continue
    }
    if (aspas === "'") {
      if (caractere === "'") {
        if (/^PowerShell$/i.test(ferramenta) && comando[indice + 1] === "'") {
          atual += "'"
          indice += 1
        } else {
          aspas = null
        }
      } else {
        atual += caractere
      }
      continue
    }
    if (aspas === '"') {
      if (caractere === '"') {
        aspas = null
        continue
      }
      if (caractere === '`' || caractere === '$') return { seguro: false, motivo: 'interpolação dinâmica' }
      if (caractere === '\\' && /^Bash$/i.test(ferramenta)) {
        escapado = true
        continue
      }
      atual += caractere
      continue
    }
    if (caractere === "'" || caractere === '"') {
      aspas = caractere
      continue
    }
    if (caractere === '\\' && /^Bash$/i.test(ferramenta)) {
      escapado = true
      continue
    }
    if (/\s/.test(caractere)) {
      if (caractere === '\n' || caractere === '\r') return { seguro: false, motivo: 'mais de uma linha' }
      if (atual) {
        tokens.push(atual)
        atual = ''
      }
      continue
    }
    if (';&|<>`'.includes(caractere)) return { seguro: false, motivo: 'encadeamento ou redirecionamento' }
    if (caractere === '$' || (caractere === '%' && /%[^%]+%/.test(comando.slice(indice)))) {
      return { seguro: false, motivo: 'expansão dinâmica' }
    }
    if (/^PowerShell$/i.test(ferramenta) && '(),@'.includes(caractere)) {
      return { seguro: false, motivo: 'expressão dinâmica do PowerShell' }
    }
    atual += caractere
  }
  if (aspas || escapado) return { seguro: false, motivo: 'citação incompleta' }
  if (atual) tokens.push(atual)
  return tokens.length ? { seguro: true, tokens } : { seguro: false, motivo: 'comando vazio' }
}

function nomeExecutavel(token) {
  const nome = String(token ?? '').trim().toLowerCase()
  return /^[a-z][a-z0-9-]*$/.test(nome) ? nome : null
}

function temDinamismo(token) {
  return /[*?\[\]{}]/.test(String(token ?? '')) || String(token ?? '').includes('\0')
}

function caminhoAbsolutoSeguro(valor, cwd) {
  const texto = String(valor ?? '')
  if (!texto || temDinamismo(texto) || /^~(?:[\\/]|$)/.test(texto)) return null
  // Providers do PowerShell (Env:, Registry:, Cert:, Function:...) não são caminhos de arquivo.
  if (/^[A-Za-z][\w.-]*:/.test(texto) && !/^[A-Za-z]:[\\/]/.test(texto)) return null
  try {
    return normalizarAlvo(texto, { cwd })
  } catch {
    return null
  }
}

function analisarGit(tokens, cwd) {
  let indice = 1
  let raiz = cwd
  if (tokens[indice] === '--no-pager') indice += 1
  if (tokens[indice] === '-C') {
    raiz = caminhoAbsolutoSeguro(tokens[indice + 1], cwd)
    if (!raiz) return null
    indice += 2
  }
  const subcomando = String(tokens[indice] ?? '').toLowerCase()
  const argumentos = tokens.slice(indice + 1)
  if (!subcomando) return null
  if (GIT_LEITURA.has(subcomando)) {
    if (argumentos.some((arg) => /^--(?:no-index|ext-diff|textconv|output(?:=|$)|exec(?:=|$))/i.test(arg))) return null
    return { effectClass: 'read', targets: [raiz], operation: `git ${subcomando}` }
  }
  if (subcomando === 'config') {
    const inicio = argumentos[0] === '--local' ? 1 : 0
    if (argumentos[inicio] !== '--get' || !argumentos[inicio + 1] || argumentos.length !== inicio + 2) return null
    return { effectClass: 'read', targets: [raiz], operation: 'git config --get' }
  }
  if (subcomando === 'branch') {
    const permitidos = new Set(['--show-current', '--list', '-a', '-r', '-v', '-vv', '--no-color'])
    if (argumentos.some((arg) => !permitidos.has(arg))) return null
    return { effectClass: 'read', targets: [raiz], operation: 'git branch' }
  }
  if (subcomando === 'remote') {
    const forma = argumentos.join(' ')
    if (!(forma === '' || forma === '-v' || /^get-url(?: --all)? [^\s]+$/.test(forma))) return null
    return { effectClass: 'read', targets: [raiz], operation: 'git remote' }
  }
  return null
}

function extrairPowerShell(tokens, cwd, nome) {
  const switches = new Set(['-raw', '-force', '-name', '-recurse', '-file', '-directory'])
  const comValor = new Set(['-totalcount', '-tail', '-filter', '-include', '-exclude', '-depth'])
  const caminhos = []
  for (let indice = 1; indice < tokens.length; indice += 1) {
    const token = tokens[indice]
    const chave = token.toLowerCase()
    if (chave === '-literalpath' || chave === '-path') {
      const valor = tokens[++indice]
      const caminho = caminhoAbsolutoSeguro(valor, cwd)
      if (!caminho) return null
      caminhos.push(caminho)
      continue
    }
    if (switches.has(chave)) continue
    if (comValor.has(chave)) {
      if (tokens[++indice] === undefined) return null
      continue
    }
    if (token.startsWith('-')) return null
    const caminho = caminhoAbsolutoSeguro(token, cwd)
    if (!caminho) return null
    caminhos.push(caminho)
  }
  if (!caminhos.length && (COMANDOS_LISTAGEM.has(nome) || nome === 'get-item')) caminhos.push(normalizarAlvo(cwd))
  if (!caminhos.length) return null
  return caminhos
}

function extrairPosix(tokens, cwd, nome) {
  const caminhos = []
  let depoisDoSeparador = false
  for (let indice = 1; indice < tokens.length; indice += 1) {
    const token = tokens[indice]
    if (token === '--') {
      depoisDoSeparador = true
      continue
    }
    if (!depoisDoSeparador && /^-(?:n|c|b|q|s|v|h|H|L|P|a|A|l|d|R|r|t|u|S|1)+$/.test(token)) continue
    if (!depoisDoSeparador && /^(?:-n|-c|--lines|--bytes|max-depth)$/.test(token)) {
      if (tokens[++indice] === undefined) return null
      continue
    }
    if (!depoisDoSeparador && token.startsWith('-')) return null
    const caminho = caminhoAbsolutoSeguro(token, cwd)
    if (!caminho) return null
    caminhos.push(caminho)
  }
  if (!caminhos.length && COMANDOS_LISTAGEM.has(nome)) caminhos.push(normalizarAlvo(cwd))
  if (!caminhos.length) return null
  return caminhos
}

function analisarRg(tokens, cwd) {
  const proibidas = tokens.some((token) => /^--(?:pre|pre-glob|hostname-bin|type-add)(?:=|$)/.test(token))
  if (proibidas) return null
  const flagsSemValor = new Set(['-n', '--line-number', '-i', '--ignore-case', '-s', '--case-sensitive', '-F', '--fixed-strings', '--hidden', '-l', '--files-with-matches', '--files'])
  const flagsComValor = new Set(['-g', '--glob', '-t', '--type', '-T', '--type-not', '-m', '--max-count'])
  const flagsArquivo = new Set(['-f', '--file'])
  const posicionais = []
  const arquivosDePadrao = []
  let modoArquivos = false
  for (let indice = 1; indice < tokens.length; indice += 1) {
    const token = tokens[indice]
    if (token === '--files') modoArquivos = true
    if (flagsSemValor.has(token)) continue
    if (flagsArquivo.has(token)) {
      const valor = tokens[++indice]
      if (valor === undefined || valor === '-') return null
      const caminho = caminhoAbsolutoSeguro(valor, cwd)
      if (!caminho) return null
      arquivosDePadrao.push(caminho)
      continue
    }
    if (token.startsWith('--file=')) {
      const valor = token.slice('--file='.length)
      if (!valor || valor === '-') return null
      const caminho = caminhoAbsolutoSeguro(valor, cwd)
      if (!caminho) return null
      arquivosDePadrao.push(caminho)
      continue
    }
    if (flagsComValor.has(token)) {
      if (tokens[++indice] === undefined) return null
      continue
    }
    if (token.startsWith('-')) return null
    posicionais.push(token)
  }
  const usaArquivoDePadrao = arquivosDePadrao.length > 0
  const alvos = modoArquivos || usaArquivoDePadrao ? posicionais : posicionais.slice(1)
  if (!modoArquivos && !usaArquivoDePadrao && !posicionais[0]) return null
  const resolvidos = (alvos.length ? alvos : [cwd]).map((alvo) => caminhoAbsolutoSeguro(alvo, cwd))
  if (resolvidos.some((alvo) => !alvo)) return null
  return { effectClass: 'read', targets: [...arquivosDePadrao, ...resolvidos], operation: 'rg' }
}

export function classificarComandoLeitura(ferramenta, comando, cwd) {
  if (!/^(Bash|PowerShell)$/i.test(String(ferramenta ?? '')) || !cwd) return null
  const lexico = analisarLexico(String(comando ?? ''), ferramenta)
  if (!lexico.seguro) return null
  const [primeiro] = lexico.tokens
  const nome = nomeExecutavel(primeiro)
  const executaveis = /^PowerShell$/i.test(ferramenta) ? EXECUTAVEIS_POWERSHELL : EXECUTAVEIS_BASH
  if (!nome || !executaveis.has(nome)) return null
  if (nome === 'git') return analisarGit(lexico.tokens, cwd)
  if (COMANDOS_SEM_ALVO.has(nome) && lexico.tokens.length === 1) {
    return { effectClass: 'read', targets: [normalizarAlvo(cwd)], operation: nome }
  }
  if (nome === 'rg') return analisarRg(lexico.tokens, cwd)
  if (COMANDOS_LISTAGEM.has(nome) || COMANDOS_ARQUIVO.has(nome)) {
    const powerShell = nome.startsWith('get-') || nome === 'test-path' || nome === 'resolve-path'
    const targets = powerShell
      ? extrairPowerShell(lexico.tokens, cwd, nome)
      : extrairPosix(lexico.tokens, cwd, nome)
    return targets ? { effectClass: 'read', targets, operation: nome } : null
  }
  return null
}

export function fingerprintsAncestrais(alvo) {
  const fingerprints = []
  let atual = normalizarAlvo(alvo)
  while (true) {
    fingerprints.push(fingerprint(atual))
    const pai = dirname(atual)
    if (pai === atual || parse(atual).root === atual) break
    atual = pai
  }
  return fingerprints
}

export function alvoDentroDoEnvelope(alvo, targetFingerprints) {
  const permitidos = new Set(targetFingerprints)
  return fingerprintsAncestrais(alvo).some((item) => permitidos.has(item))
}

function encontrarPasse(entrada, comando, cwd, {
  caminhos = caminhosPasse(),
  agora = Date.now()
} = {}) {
  const sessao = String(entrada?.session_id ?? '').trim()
  const agente = String(entrada?.agent_id ?? '').trim()
  if (!sessao || !agente || !comando || !cwd) return null
  let chave
  let cofre
  let turnoAtivo
  try {
    if (!existsSync(caminhos.chave) || !existsSync(caminhos.cofre)) return null
    chave = readFileSync(caminhos.chave, 'utf8').trim()
    cofre = lerCofre(caminhos.cofre)
    const casa = caminhos.casa ?? (caminhos.config ? dirname(caminhos.config) : null)
    if (!casa) return null
    turnoAtivo = resolverTurnoAtivoAuditoriaSync(casa, sessao)
  } catch {
    return null
  }
  const binding = turnoAtivo?.result === 'active' ? turnoAtivo.binding : null
  if (
    !binding ||
    binding.requestFingerprintAlgorithm !== OBJECTIVE_FINGERPRINT_ALGORITHM
  ) return null
  const sessionHash = fingerprint(sessao)
  if (binding.sessionFingerprint !== sessionHash) return null
  const environmentFingerprint = fingerprintAmbiente(cwd)
  for (const passe of cofre.passes) {
    if (!verificarPasse(passe, chave, { agora })) continue
    if (passe.sessionHash !== sessionHash) continue
    // Binding estrito: passe com agente e evento sem agente (ou outro agente) nunca coincidem.
    if (!passe.agentId || passe.agentId !== agente) continue
    if (passe.objectiveFingerprint !== binding.requestFingerprint) continue
    if (Date.parse(passe.issuedAt) < Date.parse(binding.openedAt)) continue
    if (!passe.effectClasses.includes('read')) continue
    if (passe.environmentFingerprint !== environmentFingerprint) continue
    if (!comando.targets.every((alvo) => alvoDentroDoEnvelope(alvo, passe.targetFingerprints))) continue
    return passe
  }
  return null
}

export function decidirPreToolUse(entrada, opcoes = {}) {
  const ferramenta = String(entrada?.tool_name ?? '')
  if (!/^(Bash|PowerShell)$/i.test(ferramenta)) {
    return { decision: 'abstain', reason: 'Ferramenta fora do contrato do guardião.' }
  }
  const comando = comandoDe(entrada)
  if (!comando) return { decision: 'abstain', reason: 'Comando ausente.' }
  const historica = detectarFormaHistorica(ferramenta, comando)
  if (historica) {
    return {
      decision: 'abstain',
      reason: `Forma histórica ${historica.id}.`,
      guidance: historica.guidance
    }
  }
  const cwd = ambienteDe(entrada)
  if (!cwd) return { decision: 'abstain', reason: 'Ambiente não informado pelo host.' }
  let leitura
  try {
    leitura = classificarComandoLeitura(ferramenta, comando, cwd)
  } catch {
    return { decision: 'abstain', reason: 'Comando não pôde ser classificado com segurança.' }
  }
  if (!leitura) {
    return { decision: 'abstain', reason: 'Apenas uma leitura única e verificável participa do auto-allow v1.' }
  }
  const passe = encontrarPasse(entrada, leitura, cwd, opcoes)
  if (!passe) return { decision: 'abstain', reason: 'Credencial v2 compatível não comprovada.' }
  return {
    decision: 'allow',
    reason: `Leitura ${leitura.operation} coberta pelo passe ${passe.id}.`,
    passId: passe.id,
    authorityId: passe.authorityId
  }
}

export function saidaHook(resultado) {
  if (resultado?.decision === 'allow') {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: resultado.reason
      }
    }
  }
  if (resultado?.guidance) {
    return {
      suppressOutput: false,
      systemMessage: `Omni guardião: ${resultado.guidance}`,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: resultado.guidance
      }
    }
  }
  // Ausência de permissionDecision é deliberada: a política do host continua soberana.
  return { suppressOutput: true }
}

function lerEntrada(stream = process.stdin) {
  return new Promise((resolvePromise) => {
    let dados = ''
    stream.setEncoding('utf8')
    stream.on('data', (parte) => { dados += parte })
    stream.on('end', () => resolvePromise(dados))
    stream.on('error', () => resolvePromise(''))
  })
}

export async function principal({ entradaStream = process.stdin, saidaStream = process.stdout } = {}) {
  const bruto = await lerEntrada(entradaStream)
  let entrada
  try { entrada = JSON.parse(bruto) } catch { entrada = null }
  const saida = entrada ? saidaHook(decidirPreToolUse(entrada)) : { suppressOutput: true }
  saidaStream.write(JSON.stringify(saida))
  return saida
}

const direto = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (direto) principal().catch(() => process.stdout.write(JSON.stringify({ suppressOutput: true })))
