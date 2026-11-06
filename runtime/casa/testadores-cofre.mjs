// Testadores do cofre (§8.5): um teste ao vivo por tipo de credencial, que diz se o valor ainda abre
// a porta do serviço. O detalhe nunca leva o valor, e o valor só é aberto quando há testador. O
// Sentinel não tem teste automático: toda chamada vira log do lado deles. O de Postgres entra no plano 5.
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
export async function testarCredencial(credencial, obterValor, { fetch = globalThis.fetch, limiteMs = 10_000 } = {}) {
  if (credencial.servico === 'sentinel') return { ok: null, detalhe: SEM_TESTE_SENTINEL }
  const chave = `${credencial.tipo}/${credencial.servico ?? '-'}`
  const testador = TESTADORES.get(chave)
  if (!testador) return { ok: null, detalhe: `sem testador para ${chave}` }
  const valor = obterValor()
  try {
    return await testador(valor, { fetch, limiteMs })
  } finally {
    valor.fill(0)
  }
}
