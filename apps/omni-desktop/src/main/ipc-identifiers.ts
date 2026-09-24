const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
const resultPattern = new RegExp('^(?:' + uuid + '|editor-response:' + uuid + ':' + uuid + ')$', 'i')
/** Only IDs issued by result tickets. The delivery queue checks existence and destination. */
export function resultId(value: unknown): string {
  if (typeof value !== 'string' || !resultPattern.test(value)) throw new Error('Identificador de retorno inválido.')
  return value
}
