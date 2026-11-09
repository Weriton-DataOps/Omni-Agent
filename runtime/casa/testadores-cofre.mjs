// Testadores do cofre (§8.5): um teste ao vivo por tipo de credencial, que diz se o valor ainda abre
// a porta do serviço. O detalhe nunca leva o valor, e o valor só é aberto quando há testador. O
// Sentinel não tem teste automático: toda chamada vira log do lado deles. Conexão postgres:// vai ao
// testador de fio (postgres-fio.mjs), que recusa url fora do loopback ou com senha antes de abrir o valor.
import { alvoPostgres, testarPostgres } from './postgres-fio.mjs'

export const SEM_TESTE_SENTINEL = 'sem teste automático: toda chamada vira log do lado deles'
async function testarOpenai(valor, { fetch, limiteMs }) {
  let resposta
  try {
    resposta = await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${valor.toString('utf8').trim()}` }, signal: AbortSignal.timeout(limiteMs) })
  } catch (erro) {
    return { ok: null, detalhe: `sem resposta (${erro?.name ?? 'erro'})` }
  }
  try { await resposta.body?.cancel?.() } catch {}
  const detalhe = `HTTP ${resposta.status}`
  if (resposta.ok) return { ok: true, detalhe }
  if (resposta.status === 401 || resposta.status === 403) return { ok: false, detalhe }
  return { ok: null, detalhe }
}
const TESTADORES = new Map([['chave-api/openai', testarOpenai]])

// O valor só existe durante o teste e sai zerado, dê o que der.
async function comValor(obterValor, uso) {
  const valor = obterValor()
  try {
    return await uso(valor)
  } finally {
    valor.fill(0)
  }
}

export async function testarCredencial(credencial, obterValor, { fetch = globalThis.fetch, limiteMs = 10_000, net, tls } = {}) {
  if (credencial.servico === 'sentinel') return { ok: null, detalhe: SEM_TESTE_SENTINEL }
  if (credencial.tipo === 'conexao' && /^postgres(?:ql)?:\/\//i.test(credencial.url ?? '')) {
    const alvo = alvoPostgres(credencial.url, credencial.usuario)
    if (alvo.erro) return { ok: null, detalhe: alvo.erro }
    return comValor(obterValor, (valor) => testarPostgres(alvo, valor, { net, tls, limiteMs }))
  }
  const chave = `${credencial.tipo}/${credencial.servico ?? '-'}`
  const testador = TESTADORES.get(chave)
  if (!testador) return { ok: null, detalhe: `sem testador para ${chave}` }
  return comValor(obterValor, (valor) => testador(valor, { fetch, limiteMs }))
}
