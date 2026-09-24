/** A model interprets intent; this contract only bounds the concrete private action. */
export const privateOperations = ['postgres.catalog', 'postgres.freshness'] as const
export type PrivateOperation = typeof privateOperations[number]
export interface PrivateAction {
  action: 'inventory' | 'store' | 'use';
  sourceTurnId: string | null;
  operations: PrivateOperation[];
  authorizationQuote: string | null;
  persist?: boolean;
}
export const privateActionSchema = {
  type: ['object', 'null'], additionalProperties: false,
  required: ['action', 'sourceTurnId', 'operations', 'authorizationQuote'],
  properties: {
    action: { type: 'string', enum: ['inventory', 'store', 'use'] },
    sourceTurnId: { type: ['string', 'null'] },
    operations: { type: 'array', maxItems: 2, uniqueItems: true, items: { type: 'string', enum: [...privateOperations] } },
    authorizationQuote: { type: ['string', 'null'] }
    , persist: { type: 'boolean' }
  }
} as const
export function validatePrivateAction(value: unknown): PrivateAction | null {
  if (value === undefined || value === null) return null // Old plans never acquire private authority.
  if (typeof value !== 'object' || Array.isArray(value)) throw Error('Ação privada inválida.')
  const p = value as PrivateAction
  if (Object.keys(p).some(k => !['action', 'sourceTurnId', 'operations', 'authorizationQuote', 'persist'].includes(k)) || (p.persist !== undefined && typeof p.persist !== 'boolean') ||
      !['inventory', 'store', 'use'].includes(p.action) ||
      !(p.sourceTurnId === null || (typeof p.sourceTurnId === 'string' && p.sourceTurnId.length > 0 && p.sourceTurnId.length <= 100)) ||
      !Array.isArray(p.operations) || p.operations.length > 2 || new Set(p.operations).size !== p.operations.length || p.operations.some(op => !privateOperations.includes(op)) ||
      !(p.authorizationQuote === null || (typeof p.authorizationQuote === 'string' && p.authorizationQuote.trim().length > 0 && p.authorizationQuote.length <= 4000))) throw Error('Ação privada inválida.')
  if (p.action === 'inventory' ? p.sourceTurnId !== null || p.authorizationQuote !== null || p.operations.length !== 0
    : !p.sourceTurnId || !p.authorizationQuote || (p.action === 'use' ? !p.operations.length : p.operations.length !== 0)) throw Error('Escopo da ação privada inválido.')
  return { ...p, operations: [...p.operations] }
}
export function validatePrivateActionContext(action: PrivateAction | null | undefined, ownerText: string, sources: string[]): void {
  if (!action || action.action === 'inventory') return
  if (!sources.includes(action.sourceTurnId!) || !ownerText.includes(action.authorizationQuote!)) {
    throw Error('A ação privada precisa de um anexo desta conversa e de autorização citada da mensagem atual do proprietário.')
  }
}
