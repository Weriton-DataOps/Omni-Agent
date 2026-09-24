/** Implemented capabilities, not a promise of connectivity or access authority. */
export class PrivateAccessInputError extends Error {}
export const privateAccessCapabilities = {
  privateAttachment: { storage: 'temporary-main-process-memory', binding: 'conversation-and-message', rawInChat: false, rawInModel: false, automaticValidation: false },
  vault: { registration: true, metadataLookup: true, verificationOnRequest: true },
  verificationAdapters: ['postgresql-read-only-select', 'github-authenticated-user', 'vercel-authenticated-user', 'windows-domain-network-logon'],
  executor: { scopedUseReference: true, credentialInjection: 'trusted-broker-only', operations: ['postgres.catalog', 'postgres.freshness'], sshTunnel: 'managed-ssh-channel-with-remote-psql', sshPostgresModes: ['password', 'sudo-postgres'], arbitrarySql: false, writes: false, ttlMinutes: 30, secretInBrief: false }
} as const

/** Attaching alone is not permission to connect. Only the owner's own execution request counts. */
export function authorizesPrivateExecution(text: string): boolean {
  const value = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/\b(?:nao|nunca|sem)\b[^.!?;\n]{0,60}\b(?:use|usar|utiliz\w*|conect\w*|execut\w*|test\w*|valid\w*)\b/.test(value) || /\bsem\s+(?:conexao|acesso ao banco)\b/.test(value)) return false
  if (/^\s*(?:como\b|por que\b|explique\b|quero saber\b|me mostre como\b)/.test(value) || /\b(?:apenas|somente|so)\s+(?:para\s+)?contexto\b/.test(value)) return false
  return /\b(?:use|usar|utilize|utilizar|conecte|conectar|execute|executar|consulte|consultar|inspecione|investigue|organize)\b/.test(value) && /\b(?:cracha|credencia\w*|acessos?|banco|postgres\w*|base de dados)\b/.test(value)
}

/** A received attachment is not a receipt of storage, verification or use. */
export function privateReceiptReply(text: string): string {
  const affirmative = text.split(/[.!?\n]/).some(part => {
    const value = part.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    const statements = [/(?:ja\s+)?(?:guardei|salvei|cadastrei|validei|testei)\b/g, /(?:acessos?|credenciais?|anexos?|dados|chaves?|senhas?)\b[^.;\n]{0,100}\b(?:estao|esta|ficam|ficou|foram|foi)\s+(?:ja\s+)?(?:guardad[oa]s?|salv[oa]s?|cadastrad[oa]s?|validad[oa]s?|testad[oa]s?)\b/g]
    return statements.some(pattern => [...value.matchAll(pattern)].some(match => !/\b(?:nao|nunca|nem|sem)\s+(?:os?\s+|as?\s+)?$/.test(value.slice(0, match.index))))
  })
  return affirmative ? 'Recebi o anexo privado como contexto desta mensagem. Isso não confirma gravação no cofre, validação ou uso pela sessão. Não houve recibo dessas operações nesta rodada.' : text
}
