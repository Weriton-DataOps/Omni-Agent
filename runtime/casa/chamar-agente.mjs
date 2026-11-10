// O chamar (§3.4): a ilha e o carteiro falam com um agente pelo Omni, que guarda os tokens. Antes de
// pôr o Bearer, o Omni confere a rota contra o interface.rotas do agente.json (método, padrão no
// caminho sem a query, escopo igual ao papel ou "qualquer"). Recusa nunca chega ao agente e volta
// como { status: 0, corpo: { ok: false, erro } }, o contrato do IPC agente:api.
import { request } from 'node:http'

const PAPEIS = new Set(['tela', 'visita'])
const METODOS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE'])
const ROTA = /^\/v1\/[A-Za-z0-9._~%/-]*(\?[A-Za-z0-9._~%=&-]*)?$/

export function rotaDeclarada(rotas, metodo, caminho) {
  if (!Array.isArray(rotas)) return null
  return rotas.find((r) => r?.metodo === metodo && typeof r.padrao === 'string' && new RegExp(r.padrao).test(caminho)) ?? null
}

const recusa = (erro) => ({ status: 0, corpo: { ok: false, erro } })

function conferir(rotas, metodo, rota, papel) {
  if (!PAPEIS.has(papel)) return 'papel desconhecido'
  if (!METODOS.has(metodo)) return 'método não aceito'
  if (typeof rota !== 'string' || !ROTA.test(rota)) return 'rota fora do formato'
  const caminho = rota.split('?')[0]
  if (caminho.includes('..') || caminho.includes('//')) return 'rota fora do formato'
  const declarada = rotaDeclarada(rotas, metodo, caminho)
  if (!declarada) return `${metodo} ${caminho} não está nas rotas do agente`
  if (declarada.escopo !== 'qualquer' && declarada.escopo !== papel) return `rota do escopo ${declarada.escopo}, pedida com o papel ${papel}`
  return null
}

function http({ porta, metodo, rota, token, corpo, limiteMs, limiteResposta }) {
  return new Promise((resolver) => {
    let feito = false
    const fim = (r) => { if (!feito) { feito = true; resolver(r) } }
    const dados = corpo === undefined ? null : Buffer.from(JSON.stringify(corpo), 'utf8')
    const cabecalhos = { host: `127.0.0.1:${porta}`, authorization: `Bearer ${token}`, connection: 'close', accept: 'application/json' }
    if (dados) Object.assign(cabecalhos, { 'content-type': 'application/json', 'content-length': dados.length })
    const req = request({ host: '127.0.0.1', port: porta, method: metodo, path: rota, headers: cabecalhos }, (res) => {
      const partes = []
      let tamanho = 0
      res.on('data', (p) => {
        tamanho += p.length
        if (tamanho > limiteResposta) { fim(recusa('resposta grande demais')); req.destroy(); return }
        partes.push(p)
      })
      res.on('end', () => {
        let lido = null
        try { lido = JSON.parse(Buffer.concat(partes).toString('utf8')) } catch { lido = null }
        fim({ status: res.statusCode, corpo: lido })
      })
      res.on('error', () => fim(recusa('a resposta do agente caiu no meio')))
    })
    req.setTimeout(limiteMs, () => { fim(recusa(`o agente não respondeu no prazo de ${limiteMs} ms`)); req.destroy() })
    req.on('error', (erro) => fim(recusa(`o agente não atendeu (${erro.code ?? 'erro de conexão'})`)))
    req.end(dados ?? undefined)
  })
}

export function criarChamador({ servidores, token, limiteMs = 10_000, limiteResposta = 4 * 1024 * 1024 }) {
  return async function chamar(agente, metodo, rota, corpo, { papel = 'tela' } = {}) {
    const alvo = servidores().find((s) => s.agente === agente)
    if (!alvo || !Number.isInteger(alvo.porta)) return recusa(`o agente ${agente} não está no ar`)
    const problema = conferir(alvo.rotas, metodo, rota, papel)
    if (problema) return recusa(problema)
    let valor
    // A mensagem do cofre fica de fora: ela pode citar nome e máquina, e a ilha só precisa saber que falhou.
    try { valor = token(agente, papel) } catch { return recusa(`o token ${papel} do agente ${agente} não abriu`) }
    if (typeof valor !== 'string' || valor === '') return recusa(`o token ${papel} do agente ${agente} não abriu`)
    return http({ porta: alvo.porta, metodo, rota, token: valor, corpo, limiteMs, limiteResposta })
  }
}
