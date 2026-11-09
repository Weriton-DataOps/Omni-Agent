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

export function criarApiOmni({ casa, token, versao, agentes = () => [], env = process.env, iniciadoEm = agoraIso() }) {
  if (typeof token !== 'string' || !TOKEN.test(token)) throw new TypeError('Token da API fora do formato.')
  const esperado = resumo(token)

  const servidor = createServer((req, res) => {
    atender(req, res).catch((erro) => {
      registrarDegradacao(casa, 'api.omni', erro, env)
      responder(res, 500, { ok: false, erro: 'falha interna' }, { connection: 'close' })
    })
  })
  servidor.headersTimeout = 5_000
  servidor.requestTimeout = 10_000

  function autorizado(cabecalho) {
    const achado = /^Bearer (\S+)$/.exec(cabecalho ?? '')
    return achado !== null && timingSafeEqual(resumo(achado[1] ?? ''), esperado)
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
    return responder(res, 202, { ok: true, ...recibo })
  }

  async function atender(req, res) {
    const porta = servidor.address()?.port
    if (req.headers.host !== `127.0.0.1:${porta}`) {
      return responder(res, 421, { ok: false, erro: 'Use http://127.0.0.1:<porta>.' }, { connection: 'close' })
    }
    if (!autorizado(req.headers.authorization)) {
      return responder(res, 401, { ok: false, erro: 'Token ausente ou inválido.' }, { connection: 'close' })
    }
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${porta}`)
    try {
      if (url.pathname === '/v1/saude') {
        if (req.method !== 'GET') return responder(res, 405, { ok: false, erro: 'Método não aceito.' }, { allow: 'GET' })
        return responder(res, 200, { ok: true, agente: 'omni', versao, iniciado_em: iniciadoEm, agentes: agentes() })
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
