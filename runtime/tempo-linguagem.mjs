// Extrai prazo e proxima acao de linguagem natural pt-BR, para alimentar o eixo
// de tempo das missoes (migration 005) sem o proprietario preencher formulario.
// Conservador de proposito: so captura com sinal claro; na duvida, retorna null.

const DIAS_SEMANA = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado']
const CUE_PRAZO = /\b(?:ate|prazo|vence|vencimento|entregar|entrega|deadline|para\s+(?:o\s+dia|amanha|hoje|segunda|terca|quarta|quinta|sexta|sabado|domingo)|no\s+dia)\b/

function normalizar(texto) {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

// Offset aritmetico: deixa o Date.UTC rolar (d+14 vira outro mes normalmente).
function fimDoDia(ano, mes, dia) {
  return new Date(Date.UTC(ano, mes, dia, 23, 59, 59))
}
// Data explicita: valida o round-trip para rejeitar 31/02 e afins.
function fimValidado(ano, mes, dia) {
  const data = fimDoDia(ano, mes, dia)
  if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes || data.getUTCDate() !== dia) return null
  return data
}

/** Retorna ISO (fim do dia) do prazo declarado, ou null. `agora` ancora o relativo. */
export function extrairPrazo(texto, agora = new Date()) {
  const base = normalizar(texto)
  if (!base.trim()) return null
  const hoje = new Date(agora)
  const y = hoje.getFullYear(), m = hoje.getMonth(), d = hoje.getDate()

  // Data explicita DD/MM ou DD/MM/AAAA dispensa palavra-gatilho.
  const explicita = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(base)
  if (explicita) {
    const dia = Number(explicita[1]), mes = Number(explicita[2]) - 1
    let ano = explicita[3] ? Number(explicita[3]) : y
    if (explicita[3] && explicita[3].length === 2) ano += 2000
    const data = fimValidado(ano, mes, dia)
    if (data && (explicita[3] || data.getTime() >= fimDoDia(y, m, d).getTime() - 86_400_000)) return data.toISOString()
  }

  const temCue = CUE_PRAZO.test(base)
  if (!temCue) return null

  if (/\bdepois de amanha\b/.test(base)) return fimDoDia(y, m, d + 2)?.toISOString() ?? null
  if (/\bamanha\b/.test(base)) return fimDoDia(y, m, d + 1)?.toISOString() ?? null
  if (/\bhoje\b/.test(base)) return fimDoDia(y, m, d)?.toISOString() ?? null

  const emN = /\bem\s+(\d{1,3})\s+(dia|dias|semana|semanas|mes|meses)\b/.exec(base)
  if (emN) {
    const n = Number(emN[1])
    if (/semana/.test(emN[2])) return fimDoDia(y, m, d + n * 7)?.toISOString() ?? null
    if (/mes/.test(emN[2])) return fimDoDia(y, m + n, d)?.toISOString() ?? null
    return fimDoDia(y, m, d + n)?.toISOString() ?? null
  }

  const diaDoMes = /\b(?:dia|ate o dia|no dia|para o dia)\s+(\d{1,2})\b/.exec(base)
  if (diaDoMes) {
    const dia = Number(diaDoMes[1])
    let mes = m, ano = y
    if (dia < d) { mes += 1; if (mes > 11) { mes = 0; ano += 1 } }
    return fimDoDia(ano, mes, dia)?.toISOString() ?? null
  }

  for (let i = 0; i < DIAS_SEMANA.length; i += 1) {
    if (new RegExp(`\\b${DIAS_SEMANA[i]}(?:-feira)?\\b`).test(base)) {
      const alvo = i
      let delta = (alvo - hoje.getDay() + 7) % 7
      if (delta === 0) delta = 7 // "sexta" dita hoje = a proxima sexta
      return fimDoDia(y, m, d + delta)?.toISOString() ?? null
    }
  }
  return null
}

const CUE_PROXIMA = /(?:proxim[ao]\s+(?:passo|acao)|proxima etapa|falta(?:\s+so)?|preciso ainda|ainda preciso|o que falta e)\s*(?:e|eh|:|\bde\b)?\s*/

/** Retorna a proxima acao declarada explicitamente, ou null. */
export function extrairProximaAcao(texto) {
  const bruto = String(texto ?? '')
  const base = normalizar(bruto)
  const match = CUE_PROXIMA.exec(base)
  if (!match) return null
  const inicio = match.index + match[0].length
  // Recorta no texto original (preserva acentos/caixa), ate pontuacao forte.
  const trecho = bruto.slice(inicio).split(/[.!?\r\n]/)[0].trim()
  return trecho.length >= 3 ? trecho.slice(0, 200) : null
}
