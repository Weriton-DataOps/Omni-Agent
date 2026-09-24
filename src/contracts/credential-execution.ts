/** Closed operation set: no executor-supplied SQL, shell, URL or connection target. */
export type CredentialExecutionOperation =
  | { kind: 'postgres.catalog'; page: number }
  | { kind: 'postgres.freshness'; schema: string; table: string; column: string }
export type CredentialExecutionLeaf = { credentialId: string; version: number } | { registration: {
  credentialId: string; providerRef: string; accountRef: string; environmentRef: string;
  token: string; expiresAt: string | null; renewalMode: 'none' | 'refresh' | 'rotate' | 'reauthenticate'
} }
export type CredentialExecutionSource = CredentialExecutionLeaf | { ssh: CredentialExecutionLeaf; database: CredentialExecutionLeaf; mode: 'password' | 'sudo-postgres' }
export interface CredentialExecutionResult {
  outcome: 'completed' | 'unsupported' | 'unavailable' | 'timeout' | 'denied' | 'host-key-required';
  operation: CredentialExecutionOperation['kind'];
  data: unknown;
}
export function credentialExecutionOperation(value: unknown): CredentialExecutionOperation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid private operation.')
  const item = value as Record<string, unknown>
  if (item.kind === 'postgres.catalog' && Object.keys(item).every(key => ['kind', 'page'].includes(key)) && Number.isInteger(item.page) && Number(item.page) >= 0 && Number(item.page) < 50) return { kind: item.kind, page: Number(item.page) }
  if (item.kind === 'postgres.freshness' && Object.keys(item).length === 4 && ['schema', 'table', 'column'].every(key => typeof item[key] === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/u.test(String(item[key])))) {
    return { kind: item.kind, schema: String(item.schema), table: String(item.table), column: String(item.column) }
  }
  throw new Error('Invalid private operation.')
}
