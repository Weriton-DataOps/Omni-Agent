export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export interface JsonObject {
  [key: string]: JsonValue
}

function normalize(value: unknown): JsonValue {
  if (value === undefined) return null
  if (Array.isArray(value)) return value.map(normalize)
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const normalized: JsonObject = {}
    for (const key of Object.keys(source).sort()) {
      const item = source[key]
      if (item !== undefined) normalized[key] = normalize(item)
    }
    return normalized
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new TypeError(`Valor não serializável como JSON: ${typeof value}.`)
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value))
}
