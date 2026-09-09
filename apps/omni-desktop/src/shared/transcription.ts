export const TRANSCRIPTION_MODEL = 'gpt-4o-transcribe'
const phantoms = ['obrigado por assistir', 'legendas pela comunidade', 'amara.org', 'inscreva-se', 'subscribe']
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

export function correctTranscript(value: string): string {
  let text = value.trim()
  text = text.replace(/(^|[,;]\s*)homem\b/giu, '$1Omni')
  text = text.replace(/^palomino\b/iu, 'Fala Omni')
  text = text.replace(/^(amme|amne|amni|amy|omny|homni|ômni|ohmni|omini)\b/iu, 'Omni')
  text = text.replace(/(^|[,;.!?]\s*)(fala|ei|oi|olá|ola)([,!]?\s+)(amme|amne|amni|amy|omny|homni|ômni|ohmni|omini|homem)\b/giu, '$1$2$3Omni')
  return text.replace(/\b(overcor|uovokor|ovokor|over core|ovecor)\b/giu, 'OverCore')
}

export function rejectTranscript(value: string): string | null {
  const text = value.trim()
  if (!text) return 'não houve fala reconhecível'
  const plain = normalize(text)
  if (phantoms.some(phrase => plain.includes(normalize(phrase)))) return 'a transcrição pareceu um resíduo de silêncio'
  const letters = [...text].filter(char => /\p{L}/u.test(char))
  if (letters.length >= 2 && letters.filter(char => (char.codePointAt(0) ?? 0) > 0x2af).length / letters.length > .3) return 'a transcrição veio em um alfabeto inesperado'
  return null
}

export function transcriptForUse(value: unknown): { text: string; reason: string | null } {
  if (typeof value !== 'string') return { text: '', reason: 'a transcrição não retornou texto' }
  const text = correctTranscript(value)
  return { text, reason: rejectTranscript(text) }
}

export function transcriptionConfidence(logprobs: unknown): { accepted: boolean; reason: string | null } {
  // Alguns eventos Realtime não trazem logprobs; as outras guardas ainda valem.
  if (!Array.isArray(logprobs) || logprobs.length === 0) return { accepted: true, reason: null }
  const values = logprobs.map(item => typeof item === 'object' && item !== null ? Number((item as { logprob?: unknown }).logprob) : NaN).filter(value => Number.isFinite(value)).slice(0, 512)
  if (!values.length) return { accepted: false, reason: 'a confiança da transcrição veio inválida' }
  const average = values.reduce((sum, value) => sum + Math.min(0, Math.max(-100, value)), 0) / values.length
  const weak = values.filter(value => Math.exp(Math.min(0, value)) < .1).length / values.length
  if (weak > .25) return { accepted: false, reason: 'muitos trechos da fala estavam incertos' }
  if (Math.exp(average) < .75) return { accepted: false, reason: 'a fala não ficou nítida o suficiente' }
  return { accepted: true, reason: null }
}
