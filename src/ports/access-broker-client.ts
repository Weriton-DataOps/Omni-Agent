import type { CredentialMetadata, CredentialObservation } from '../core/access/credential.js'

/** Safe inventory projection.  It intentionally has no secret or vault reference. */
export interface CredentialMetadataSummary {
  readonly credentialId: string
  readonly version: number
  readonly providerRef: string
  readonly accountRef: string
  readonly environmentRef: string
  readonly expiresAt: string | null
  readonly status: string
}

/** A local, authenticated boundary. It resolves database credentials internally and never returns them. */
export interface AccessBrokerClient {
  health(): Promise<{ readonly protocol: 'omni-access-broker-v1'; readonly status: 'ready' | 'degraded' }>
  /** Read-only, bounded inventory for the owner's local Crachá. Never returns a secret reference. */
  listCredentialMetadata(query?: string): Promise<readonly CredentialMetadataSummary[]>
  readCredentialVersion(credentialId: string, version: number): Promise<CredentialMetadata | null>
  recordCredentialObservation(event: CredentialObservation, expectedRevision: number): Promise<
    | { readonly outcome: 'recorded' | 'duplicate'; readonly credential: CredentialMetadata }
    | { readonly outcome: 'conflict' | 'version-not-found' }
  >
}
