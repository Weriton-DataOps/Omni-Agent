#!/usr/bin/env node
// Omni — a mão do Omni no Overcore (22/10). A ilha não segura o token do Overcore: chama este processo,
// que lê o descritor local (%LOCALAPPDATA%\Overcore\runtime.json + client-private.json, criados pelo
// launcher do Overcore), fala com a API em loopback e devolve só os dados. Nunca imprime o token.
// Uso (saída JSON):
//   execucoes              lista (GET /v1/executions?limit=50) + saúde do runtime
//   detalhe <id>           uma execução (GET /v1/executions/{id})
//   retomar <id>           POST /v1/tasks/{id}/resume   (só se a execução pede resposta e oferece resume)
//   cancelar <id>          POST /v1/tasks/{id}/cancel
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PASTA = join(process.env.LOCALAPPDATA || '', 'Overcore')
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,120}$/
const sair = (obj, codigo = 0) => { process.stdout.write(JSON.stringify(obj)); process.exit(codigo) }

function descritor() {
  let rt
  try { rt = JSON.parse(readFileSync(join(PASTA, 'runtime.json'), 'utf8')) } catch { return { erro: 'o Overcore nunca subiu nesta máquina (sem runtime.json)' } }
  if (rt.host !== '127.0.0.1' || !Number.isInteger(rt.port)) return { erro: 'descritor do Overcore inválido' }
  try { process.kill(rt.pid, 0) } catch (e) { if (e.code === 'ESRCH') return { erro: 'o Overcore está desligado', desde: rt.startedAt } }
  let token = process.env.OVERCORE_LOCAL_TOKEN
  if (!token) { try { token = JSON.parse(readFileSync(join(PASTA, 'client-private.json'), 'utf8')).localToken } catch { /* abaixo */ } }
  if (typeof token !== 'string' || token.length < 16) return { erro: 'sem credencial local do Overcore' }
  return { base: `http://127.0.0.1:${rt.port}`, token, desde: rt.startedAt, pid: rt.pid }
}

async function chamar(d, metodo, caminho) {
  const r = await fetch(d.base + caminho, { method: metodo, headers: { authorization: `Bearer ${d.token}`, 'content-type': 'application/json' }, body: metodo === 'POST' ? '{}' : undefined, signal: AbortSignal.timeout(8000) })
  let corpo = null
  try { corpo = await r.json() } catch { /* sem corpo */ }
  return { status: r.status, corpo }
}

const [, , cmd, id] = process.argv
const d = descritor()
if (d.erro) sair({ ok: false, desligado: true, erro: d.erro, desde: d.desde || null })
try {
  if (cmd === 'execucoes') {
    const r = await chamar(d, 'GET', '/v1/executions?limit=50')
    if (r.status !== 200) sair({ ok: false, erro: `API respondeu ${r.status}` }, 1)
    sair({ ok: true, runtime: { porta: Number(new URL(d.base).port), desde: d.desde, pid: d.pid }, ...r.corpo })
  }
  if (!ID.test(String(id || ''))) sair({ ok: false, erro: 'id inválido' }, 1)
  if (cmd === 'detalhe') {
    const r = await chamar(d, 'GET', `/v1/executions/${encodeURIComponent(id)}`)
    // a API embrulha: { viewVersion, observedAt, execution }
    sair(r.status === 200 ? { ok: true, execucao: r.corpo?.execution ?? r.corpo } : { ok: false, erro: r.status === 404 ? 'execução não encontrada' : `API respondeu ${r.status}` }, r.status === 200 ? 0 : 1)
  }
  if (cmd === 'retomar' || cmd === 'cancelar') {
    // só o que a própria execução oferece: a rota vem do block.answer, não é montada aqui à toa
    const det = await chamar(d, 'GET', `/v1/executions/${encodeURIComponent(id)}`)
    if (det.status !== 200) sair({ ok: false, erro: 'execução não encontrada' }, 1)
    const ex = det.corpo?.execution ?? det.corpo
    const rota = cmd === 'retomar' ? ex?.block?.answer?.resume : ex?.block?.answer?.cancel || (ex?.terminal ? null : `POST /v1/tasks/${id}/cancel`)
    if (!rota) sair({ ok: false, erro: cmd === 'retomar' ? 'esta execução não oferece retomar' : 'esta execução já terminou' }, 1)
    const [metodo, caminho] = String(rota).split(' ')
    if (metodo !== 'POST' || !/^\/v1\/tasks\/[^/]+\/(resume|cancel)$/.test(caminho)) sair({ ok: false, erro: 'rota inesperada do Overcore' }, 1)
    const r = await chamar(d, 'POST', caminho)
    sair({ ok: r.status === 202, status: r.status, aviso: cmd === 'retomar' ? 'o 202 não garante o desbloqueio; a tela relê' : undefined, erro: r.status === 202 ? undefined : r.corpo?.error || `API respondeu ${r.status}` }, r.status === 202 ? 0 : 1)
  }
  sair({ ok: false, erro: 'comando: execucoes | detalhe <id> | retomar <id> | cancelar <id>' }, 1)
} catch (e) {
  sair({ ok: false, erro: e.name === 'TimeoutError' ? 'o Overcore não respondeu em 8 s' : String(e.message || e) }, 1)
}
