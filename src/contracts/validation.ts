export class ContractValidationError extends Error {
  constructor(
    readonly path: string,
    message: string
  ) {
    super(`${path}: ${message}`)
    this.name = 'ContractValidationError'
  }
}

export function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContractValidationError(path, 'objeto esperado')
  }
  return value as Record<string, unknown>
}

export function closedRecord(value: unknown, path: string, allowedKeys: readonly string[]): Record<string, unknown> {
  const result = record(value, path)
  const allowed = new Set(allowedKeys)
  const unknownKey = Object.keys(result).find((key) => !allowed.has(key))
  if (unknownKey) throw new ContractValidationError(`${path}.${unknownKey}`, 'campo desconhecido')
  return result
}

export function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ContractValidationError(path, 'texto não vazio esperado')
  }
  return value
}

export function matchingString(value: unknown, path: string, pattern: RegExp): string {
  const result = nonEmptyString(value, path)
  if (!pattern.test(result)) throw new ContractValidationError(path, 'formato inválido')
  return result
}

export function array(value: unknown, path: string, bounds: { min?: number; max?: number } = {}): unknown[] {
  if (!Array.isArray(value)) throw new ContractValidationError(path, 'lista esperada')
  if (bounds.min !== undefined && value.length < bounds.min) {
    throw new ContractValidationError(path, `mínimo de ${bounds.min} itens`)
  }
  if (bounds.max !== undefined && value.length > bounds.max) {
    throw new ContractValidationError(path, `máximo de ${bounds.max} itens`)
  }
  return value
}

export function integer(value: unknown, path: string, bounds: { min?: number; max?: number } = {}): number {
  if (!Number.isInteger(value)) throw new ContractValidationError(path, 'inteiro esperado')
  const result = value as number
  if (bounds.min !== undefined && result < bounds.min) throw new ContractValidationError(path, `mínimo ${bounds.min}`)
  if (bounds.max !== undefined && result > bounds.max) throw new ContractValidationError(path, `máximo ${bounds.max}`)
  return result
}

export function oneOf<const T extends readonly string[]>(value: unknown, path: string, allowed: T): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new ContractValidationError(path, `valor esperado: ${allowed.join(', ')}`)
  }
  return value as T[number]
}

export function uniqueStrings(
  value: unknown,
  path: string,
  options: { min?: number; max?: number; allowed?: readonly string[]; pattern?: RegExp } = {}
): string[] {
  const values = array(value, path, options).map((item, index) => {
    const itemPath = `${path}[${index}]`
    const result = options.pattern
      ? matchingString(item, itemPath, options.pattern)
      : nonEmptyString(item, itemPath)
    if (options.allowed && !options.allowed.includes(result)) {
      throw new ContractValidationError(itemPath, `valor esperado: ${options.allowed.join(', ')}`)
    }
    return result
  })
  if (new Set(values).size !== values.length) throw new ContractValidationError(path, 'itens duplicados')
  return values
}

export function dateTime(value: unknown, path: string): string {
  const result = nonEmptyString(value, path)
  if (!/^\d{4}-\d{2}-\d{2}T/.test(result) || !Number.isFinite(Date.parse(result))) {
    throw new ContractValidationError(path, 'data ISO 8601 inválida')
  }
  return result
}
