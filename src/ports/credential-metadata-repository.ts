import type { CredentialMetadata, CredentialObservation } from '../core/access/credential.js'

/** Only the trusted credential service may use this port. It never accepts or returns a secret. */
export interface CredentialMetadataRepository {
  readVersion(credentialId: string, version: number): Promise<CredentialMetadata | null>
  /** One transaction: unique eventId + expected revision + updated version. Preserve rejected/stale events in audit. */
  recordObservation(event: CredentialObservation, expectedRevision: number): Promise<
    | { readonly outcome: 'recorded' | 'duplicate'; readonly credential: CredentialMetadata }
    | { readonly outcome: 'conflict' | 'version-not-found' }
  >
}
