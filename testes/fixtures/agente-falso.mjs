// Agente de mentira para os testes do supervisor e do servir. O comportamento vem de AGENTE_FALSO_MODO:
//   no-ar (padrão) escuta de verdade, anuncia a porta e só sai quando o stdin fecha;
//   uso sai 2; recusa anuncia {"recusa":true} e sai 1; cai sai 1 sem anunciar; mudo nunca anuncia.
// AGENTE_FALSO_REGISTRO recebe uma linha por subida (argumentos, OMNI_API, se veio token e a pasta).
// AGENTE_FALSO_CAMPAINHA: antes de anunciar, toca POST {OMNI_API}/despachos com essa execução.
// actions: um Oráculo de mentira com a fila do Actions em memória. Antes de anunciar, prova o que o
// token recebido do Omni alcança (saúde e chamar); cada pedido HTTP vira uma linha em
// AGENTE_FALSO_HTTP com o sha256 do Bearer (nunca o valor). Criar uma execução toca a campainha.
import { createHash } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { createServer } from 'node:http'

const modo = process.env.AGENTE_FALSO_MODO ?? 'no-ar'
const registro = process.env.AGENTE_FALSO_REGISTRO
if (registro) {
  appendFileSync(registro, `${JSON.stringify({ argv: process.argv.slice(2), api: process.env.OMNI_API ?? null, token: Boolean(process.env.OMNI_API_TOKEN), cwd: process.cwd() })}\n`)
}
const anunciar = (linha) => process.stdout.write(`${JSON.stringify(linha)}\n`)

if (process.argv.slice(2).join(' ') !== 'servir --porta 0' || modo === 'uso') {
  process.stderr.write('uso: agente-falso servir --porta 0\n')
  process.exit(2)
} else if (modo === 'recusa') {
  anunciar({ ok: false, erro: 'sem credencial da api', recusa: true })
  process.exit(1)
} else if (modo === 'cai') {
  process.stderr.write('caiu de propósito\n')
  process.exit(1)
} else if (modo === 'actions') {
  actions()
} else if (modo === 'mudo') {
  process.stdin.resume()
  process.stdin.on('end', () => process.exit(0))
  setInterval(() => {}, 1_000)
} else {
  const servidor = createServer((_req, res) => res.end('{}'))
  servidor.listen(0, '127.0.0.1', async () => {
    const execucao = process.env.AGENTE_FALSO_CAMPAINHA
    if (execucao) {
      const resposta = await fetch(`${process.env.OMNI_API}/despachos`, {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.OMNI_API_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ agente: 'falso', execucao })
      })
      process.stderr.write(`campainha ${resposta.status}\n`)
    }
    anunciar({ ok: true, porta: servidor.address().port, extra: 'campo a mais é tolerado' })
  })
  process.stdin.resume()
  process.stdin.on('end', () => {
    servidor.close()
    process.exit(0)
  })
}

function actions() {
  const sha = (texto) => createHash('sha256').update(String(texto ?? ''), 'utf8').digest('hex')
  const anotar = (objeto) => { if (process.env.AGENTE_FALSO_HTTP) appendFileSync(process.env.AGENTE_FALSO_HTTP, `${JSON.stringify(objeto)}\n`) }
  const omni = (metodo, rota, corpo) => fetch(`${process.env.OMNI_API}${rota}`, {
    method: metodo,
    headers: { authorization: `Bearer ${process.env.OMNI_API_TOKEN}`, 'content-type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo)
  }).then((r) => r.status, () => 0)
  const execucoes = new Map()
  // AGENTE_FALSO_FILA: execução já na fila quando o agente sobe (sem campainha).
  if (process.env.AGENTE_FALSO_FILA) {
    const id = process.env.AGENTE_FALSO_FILA
    execucoes.set(id, { id, estado: 'na fila', instrucao: 'parada desde antes', projeto: null, slug: null, destino: null, eventos: [] })
  }
  const responder =(res, status, corpo) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(corpo)) }
  const servidor = createServer((req, res) => {
    const partes = []
    req.on('data', (p) => partes.push(p))
    req.on('end', async () => {
      let corpo = null
      try { corpo = JSON.parse(Buffer.concat(partes).toString('utf8')) } catch { /* sem corpo */ }
      const url = new URL(req.url, 'http://127.0.0.1')
      const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1] ?? null
      anotar({ metodo: req.method, rota: req.url, token: bearer === null ? null : sha(bearer) })
      const alvo = /^\/v1\/actions\/execucoes\/([A-Za-z0-9-]+)(\/assumir|\/estado)?$/.exec(url.pathname)
      if (url.pathname === '/v1/actions/mesa') return responder(res, 200, { raiz: process.cwd(), projetos: [] })
      if (url.pathname === '/v1/actions/execucoes' && req.method === 'GET') {
        const todas = [...execucoes.values()]
        return responder(res, 200, { execucoes: url.searchParams.get('estado') === 'pendente' ? todas.filter((e) => e.estado === 'na fila').map((e) => ({ id: e.id })) : todas })
      }
      if (url.pathname === '/v1/actions/execucoes' && req.method === 'POST') {
        const id = process.env.AGENTE_FALSO_EXECUCAO ?? '20261109-120000-abcd'
        execucoes.set(id, { id, estado: 'na fila', instrucao: corpo?.instrucao ?? '', projeto: null, slug: null, destino: null, eventos: [] })
        responder(res, 200, { ok: true, dados: { id } })
        anotar({ campainha: await omni('POST', '/despachos', { agente: 'falso', execucao: id }) })
        return undefined
      }
      const ex = alvo && execucoes.get(alvo[1])
      if (!ex) return responder(res, 404, { ok: false, erro: 'não achei' })
      if (!alvo[2]) return responder(res, 200, ex)
      if (alvo[2] === '/assumir') {
        if (ex.estado !== 'na fila') return responder(res, 409, { ok: false, erro: `já ${ex.estado}` })
        Object.assign(ex, { estado: 'assumida', sessao: corpo?.sessao ?? null })
        return responder(res, 200, { ok: true, dados: ex })
      }
      Object.assign(ex, { estado: corpo?.estado, destino: corpo?.destino ?? ex.destino })
      ex.eventos.push({ estado: corpo?.estado, nota: corpo?.nota })
      return responder(res, 200, { ok: true, dados: ex })
    })
  })
  servidor.listen(0, '127.0.0.1', async () => {
    // O que o token entregue pelo Omni alcança: a saúde sim, o chamar não.
    anotar({ inicio: { token: sha(process.env.OMNI_API_TOKEN), saude: await omni('GET', '/saude'), chamar: await omni('POST', '/agentes/falso/chamar', { metodo: 'GET', rota: '/v1/actions/mesa' }) } })
    anunciar({ ok: true, porta: servidor.address().port })
  })
  process.stdin.resume()
  process.stdin.on('end', () => {
    servidor.close()
    process.exit(0)
  })
}
