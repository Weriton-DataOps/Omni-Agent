/** Keep quoted examples and attributed third-party speech out of owner learning. */
export function ownerStatement(value: string): string {
  return value
    .replace(/```[\s\S]*?```/gu, '')
    .replace(/^\s*>.*$/gmu, '')
    .replace(/[“"]([^”"\n]*)[”"]/gu, (_match, content: string) => /^(?:[A-Za-z]:[\\/]|\/|\\\\)\S+$/u.test(content) ? content : '')
    .replace(/\b(?:o cliente|a cliente|ele|ela|o documento|o teste)\s+(?:disse|diz|escreveu|pediu|afirma)(?:\s+que)?[^.!?;\n]*/giu, '')
}

export function normalizeOwnerText(value: string): string {
  return ownerStatement(value).normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().replace(/\s+/gu, ' ').trim()
}

export function hasContinuityComplaint(value: string): boolean {
  const text = normalizeOwnerText(value)
  if (/^(?:explique|defina|compare|no teste|no exemplo|use|escreva|nao diga)\b/u.test(text)) return false
  return /\b(?:personalidade|sua voz|seu jeito)\b[^.!?;]{0,80}\b(?:nao\s+(?:(?:e|esta|fica|se mantem)\s+)?(?:constante|persistente|consistente)|(?:esta|fica|continua)\s+oscilando|some|desaparece|perde a constancia)\b/u.test(text)
    && !/\bnao\s+(?:esta|fica|continua)\s+oscilando\b/u.test(text)
}
