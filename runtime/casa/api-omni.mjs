// API local do Omni (§3.5 regra 3; contratos de 05/11). Só 127.0.0.1 e token em toda rota: o Host
// precisa ser exatamente 127.0.0.1:<porta> (localhost recebe 421, o que fecha a porta a DNS rebinding),
// e o token é comparado pelo sha256 com timingSafeEqual (mesmo tamanho sempre, sem vazar comprimento).
// Cada pedido abre o omni.db, trabalha e fecha: a API não segura o banco, e os hooks seguem escrevendo
// nele direto. Erro inesperado vira 500 sem pilha; o detalhe vai para degradacoes.jsonl.
import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'

import { agoraIso, comBancoDaCasa, registrarDegradacao } from './banco.mjs'
import { DespachoError, listarDespachos, registrarDespacho } from './loja-despachos.mjs'

export const LIMITE_CORPO = 64 * 1024
export const TOKEN = /^[\x21-\x7e]{1,512}$/

class CorpoGrande extends Error {}
class JsonInvalido extends Error {}

const resumo = (texto) => createHash('sha256').update(texto, 'utf8').digest()

function responder(res, status, corpo, extras = {}) {
  if (res.headersSent) return
  const texto = JSON.stringify(corpo)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(texto),
    ...extras
  })
  res.end(texto)
}

// Lê o corpo inteiro, mas guarda só até o limite: o resto é drenado e descartado, para a resposta
// 413 chegar inteira ao cliente (fechar com dado não lido vira RST no Windows e o cliente perde o 413).
function lerCorpo(req) {
  return new Promise((resolver, rejeitar) => {
    const partes = []
    let total = 0
    req.on('data', (parte) => {
      total += parte.length
      if (total <= LIMITE_CORPO) partes.push(parte)
    })
    req.on('end', () => {
      if (total > LIMITE_CORPO) { rejeitar(new CorpoGrande()); return }
      try {
        resolver(JSON.parse(Buffer.concat(partes).toString('utf8')))
      } catch {
        rejeitar(new JsonInvalido())
      }
    })
    req.on('error', rejeitar)
  })
}

// Dois tokens (plano 4a): o da ilha vale em toda rota; o dos agentes, que o supervisor entrega a cada
// servir, só lê a saúde e toca a campainha. Um agente não usa o chamar para falar com outro agente.
const ROTAS_DOS_AGENTES = new Set(['GET /v1/saude', 'POST /v1/despachos'])
const CHAMAR = /^\/v1\/agentes\/([a-z][a-z0-9-]{0,39})\/chamar$/

// interfaces (plano 4b): os painéis que a ilha monta, com o estado do supervisor; só a ilha lê.
export function criarApiOmni({ casa, token, tokenAgentes = null, versao, agentes = () => [], interfaces = () => [], chamar = null, aoDespachar = null, env = process.env, iniciadoEm = agoraIso() }) {
  if (typeof token !== 'string' || !TOKEN.test(token)) throw new TypeError('Token da API fora do formato.')
  if (tokenAgentes !== null && (typeof tokenAgentes !== 'string' || !TOKEN.test(tokenAgentes) || tokenAgentes === token)) {
    throw new TypeError('Token dos agentes fora do formato ou igual ao da ilha.')
  }
  const esperado = resumo(token)
  const esperadoAgentes = tokenAgentes === null ? null : resumo(tokenAgentes)

  const servidor = createServer((req, res) => {
    atender(req, res).catch((erro) => {
      registrarDegradacao(casa, 'api.omni', erro, env)
      responder(res, 500, { ok: false, erro: 'falha interna' }, { connection: 'close' })
    })
  })
  servidor.headersTimeout = 5_000
  servidor.requestTimeout = 10_000

  // Devolve quem é: 'ilha', 'agentes' ou null. As duas comparações rodam sempre (tempo igual).
  function quem(cabecalho) {
    const achado = /^Bearer (\S+)$/.exec(cabecalho ?? '')
    if (achado === null) return null
    const apresentado = resumo(achado[1])
    const ilha = timingSafeEqual(apresentado, esperado)
    const agente = esperadoAgentes !== null && timingSafeEqual(apresentado, esperadoAgentes)
    return ilha ? 'ilha' : agente ? 'agentes' : null
  }

  async function chamarAgente(req, res, agente) {
    if (req.method !== 'POST') return responder(res, 405, { ok: false, erro: 'Método não aceito.' }, { allow: 'POST' })
    let corpo
    try {
      corpo = await lerCorpo(req)
    } catch (erro) {
      if (erro instanceof CorpoGrande) return responder(res, 413, { ok: false, erro: `Corpo acima de ${LIMITE_CORPO} bytes.` }, { connection: 'close' })
      if (erro instanceof JsonInvalido) return responder(res, 400, { ok: false, erro: 'O corpo não é JSON válido.' })
      throw erro
    }
    const valido = corpo !== null && typeof corpo === 'object' && !Array.isArray(corpo) && typeof corpo.metodo === 'string' && typeof corpo.rota === 'string'
    if (!valido) return responder(res, 400, { ok: false, erro: 'O corpo precisa de metodo e rota em texto.' })
    if (typeof chamar !== 'function') return responder(res, 503, { ok: false, erro: 'O chamar não está ligado neste servir.' })
    const resposta = await chamar(agente, corpo.metodo, corpo.rota, corpo.corpo, { papel: 'tela' })
    return responder(res, 200, { status: resposta.status, corpo: resposta.corpo })
  }

  function noBanco(uso) {
    return comBancoDaCasa(casa, 'omni', uso, env)
  }

  async function despachos(req, res, url) {
    if (req.method === 'GET') {
      const limite = url.searchParams.has('limite') ? Number(url.searchParams.get('limite')) : undefined
      const estado = url.searchParams.get('estado') ?? 'recebido'
      const lista = noBanco((db) => listarDespachos(db, limite === undefined ? { estado } : { estado, limite }))
      return responder(res, 200, { ok: true, despachos: lista })
    }
    if (req.method !== 'POST') return responder(res, 405, { ok: false, erro: 'Método não aceito.' }, { allow: 'GET, POST' })
    let corpo
    try {
      corpo = await lerCorpo(req)
    } catch (erro) {
      if (erro instanceof CorpoGrande) return responder(res, 413, { ok: false, erro: `Corpo acima de ${LIMITE_CORPO} bytes.` }, { connection: 'close' })
      if (erro instanceof JsonInvalido) return responder(res, 400, { ok: false, erro: 'O corpo não é JSON válido.' })
      throw erro
    }
    const recibo = noBanco((db) => registrarDespacho(db, corpo))
    if (typeof aoDespachar === 'function') {
      try { aoDespachar({ agente: corpo.agente, execucao: corpo.execucao, ...recibo }) } catch (erro) { registrarDegradacao(casa, 'api.omni.campainha', erro, env) }
    }
    return responder(res, 202, { ok: true, ...recibo })
  }

  async function atender(req, res) {
    const porta = servidor.address()?.port
    if (req.headers.host !== `127.0.0.1:${porta}`) {
      return responder(res, 421, { ok: false, erro: 'Use http://127.0.0.1:<porta>.' }, { connection: 'close' })
    }
    const papel = quem(req.headers.authorization)
    if (papel === null) {
      return responder(res, 401, { ok: false, erro: 'Token ausente ou inválido.' }, { connection: 'close' })
    }
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${porta}`)
    if (papel === 'agentes' && !ROTAS_DOS_AGENTES.has(`${req.method} ${url.pathname}`)) {
      return responder(res, 403, { ok: false, erro: 'O token dos agentes só lê a saúde e toca a campainha.' }, { connection: 'close' })
    }
    const alvo = CHAMAR.exec(url.pathname)
    if (alvo) return await chamarAgente(req, res, alvo[1])
    try {
      if (url.pathname === '/v1/saude') {
        if (req.method !== 'GET') return responder(res, 405, { ok: false, erro: 'Método não aceito.' }, { allow: 'GET' })
        return responder(res, 200, { ok: true, agente: 'omni', versao, iniciado_em: iniciadoEm, agentes: agentes() })
      }
      if (url.pathname === '/v1/agentes') {
        if (req.method !== 'GET') return responder(res, 405, { ok: false, erro: 'Método não aceito.' }, { allow: 'GET' })
        return responder(res, 200, { ok: true, agentes: interfaces() })
      }
      if (url.pathname === '/v1/despachos') return await despachos(req, res, url)
    } catch (erro) {
      if (erro instanceof DespachoError) return responder(res, 400, { ok: false, erro: erro.message })
      throw erro
    }
    return responder(res, 404, { ok: false, erro: 'Rota desconhecida.' })
  }

  return servidor
}
