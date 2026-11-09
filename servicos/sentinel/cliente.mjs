// Omni — cliente do Sentinel (05/11/2026). O Sentinel é o catálogo dos sistemas da GR
// (https://sentinel.grgroup.org, repo gr-estrategia-org/osentinel); a chave do agente "Omni" é do Weriton.
//
// Por que cliente próprio e não o MCP deles: o MCP rodaria código do repo deles como o Weriton (lê o cofre
// DPAPI) e injeta o `instructions` e os recados no contexto. Aqui são poucas rotas, escritas à mão.
// O CERCO (decisão dele, 05/11): toda chamada vira linha em bots.ato_de_agente, inclusive GET. Então nada
// roda por sessão nem no automático além da checagem de recados em horário fixo (checagem.mjs);
// missões e declarar trabalho só quando ele mandar.
//
// A chave sai do cofre (%APPDATA%\omni\access\sentinel-agente.dpapi) por stdout de um powershell filho e
// mora só na memória do processo. Nunca vai para log, argumento ou mensagem.
// Node precisa de --use-system-ca para confiar no certificado do Sentinel na rede da GR.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const BASE = process.env.OMNI_SENTINEL_BASE || 'https://sentinel.grgroup.org'
export const COFRE = join(process.env.APPDATA || '', 'omni', 'access', 'sentinel-agente.dpapi')
const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
export const TETO_DO_TEXTO = 2000

let chaveEmMemoria = null
function chave() {
  if (chaveEmMemoria) return chaveEmMemoria
  if (process.env.OMNI_SENTINEL_CHAVE_TESTE) return process.env.OMNI_SENTINEL_CHAVE_TESTE
  if (!existsSync(COFRE)) throw new ErroDoSentinel('sem-chave', 0, `a chave do Sentinel não está no cofre (${COFRE})`)
  const script = "Add-Type -AssemblyName System.Security; $b = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($env:OMNI_COFRE), $null, 'CurrentUser'); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($b))"
  const r = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 30_000, env: { ...process.env, OMNI_COFRE: COFRE } })
  const valor = String(r.stdout || '').trim()
  if (r.status !== 0 || !/^sk_ag_/.test(valor)) throw new ErroDoSentinel('sem-chave', 0, 'o cofre não decifrou a chave do Sentinel')
  chaveEmMemoria = valor
  return valor
}

export class ErroDoSentinel extends Error {
  // tipo: chave-recusada (401, chave rotacionada) | transitorio (503 credencial-nao-verificavel, rede) |
  //       proibido (403) | recusado (4xx com motivo) | sem-chave
  constructor(tipo, status, mensagem) { super(mensagem); this.name = 'ErroDoSentinel'; this.tipo = tipo; this.status = status }
}

export function classificar(status, corpo) {
  const motivo = typeof corpo === 'object' && corpo ? (corpo.erro || corpo.error || corpo.motivo || corpo.message || '') : String(corpo || '')
  const texto = String(motivo).slice(0, 300)
  if (status === 401) return new ErroDoSentinel('chave-recusada', status, `o Sentinel recusou a chave (401): ${texto}`)
  if (status === 503 || status >= 500) return new ErroDoSentinel('transitorio', status, `Sentinel indisponível (${status}): ${texto}`)
  if (status === 403) return new ErroDoSentinel('proibido', status, `o Sentinel proibiu (403): ${texto}`)
  return new ErroDoSentinel('recusado', status, `o Sentinel recusou (${status}): ${texto}`)
}

// fetch injetável nos testes. Uma chamada = uma linha no log deles: quem chama decide se vale a pena.
export async function pedir(metodo, caminho, corpo, { buscar = fetch } = {}) {
  let r
  try {
    r = await buscar(BASE + caminho, {
      method: metodo,
      headers: { authorization: `Bearer ${chave()}`, ...(corpo ? { 'content-type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(30_000),
    })
  } catch (e) {
    throw new ErroDoSentinel('transitorio', 0, `sem resposta do Sentinel: ${e.cause?.code || e.message}`)
  }
  const t = await r.text()
  let j
  try { j = JSON.parse(t) } catch { j = t }
  if (!r.ok) throw classificar(r.status, j)
  return j
}

const ids = lista => {
  const limpos = [...new Set((lista || []).map(Number).filter(n => Number.isInteger(n) && n > 0))]
  if (!limpos.length || limpos.length > 50) throw new Error('ids: de 1 a 50 números')
  return limpos
}

// Caixa de recados. consumir=0 SEMPRE: sem ele o servidor marca tudo como lido na leitura.
export function recados({ limite = 50, situacao } = {}, opcoes) {
  const q = new URLSearchParams({ limite: String(limite), consumir: '0' })
  if (situacao) q.set('situacao', situacao)
  return pedir('GET', `/api/agente/recados?${q}`, null, opcoes)
}
export const marcarLidos = (lista, opcoes) => pedir('POST', '/api/agente/recados/lidos', { ids: ids(lista) }, opcoes)
export const marcarTratados = (lista, opcoes) => pedir('POST', '/api/agente/recados/tratados', { ids: ids(lista) }, opcoes)
export const cutucadasVistas = (lista, opcoes) => pedir('POST', '/api/agente/cutucadas/vistas', { ids: ids(lista) }, opcoes)

// Resposta a um recado. sozinho=true só quando o Omni respondeu sem o Weriton revisar; o servidor recusa
// se a política "responder sozinho" da chave estiver desligada (botão dele em /agentes/meu). Resposta que
// ele aprovou vai SEM a marca: mandar sem ela algo que ele não viu seria dizer que ele viu.
export function responder({ emRespostaA, texto, sozinho = false }, opcoes) {
  const corpo = String(texto || '').trim()
  if (!corpo) throw new Error('texto vazio')
  if (corpo.length > TETO_DO_TEXTO) throw new Error(`texto passa de ${TETO_DO_TEXTO} caracteres`)
  if (!Number.isInteger(Number(emRespostaA)) || Number(emRespostaA) <= 0) throw new Error('emRespostaA: id do recado')
  return pedir('POST', '/api/agente/recados', { emRespostaA: Number(emRespostaA), texto: corpo, ...(sozinho ? { sozinho: true } : {}) }, opcoes)
}

// Só a pedido dele (o cerco): nada chama estas duas sozinho.
export const missoes = opcoes => pedir('GET', '/api/agente/missoes', null, opcoes)
export const declararTrabalho = (corpo, opcoes) => pedir('POST', '/api/agente/trabalho', corpo, opcoes)
