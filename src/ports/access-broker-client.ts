import type { CredentialMetadata, CredentialObservation } from '../core/access/credential.js'

/** A local, authenticated boundary. It resolves database credentials internally and never returns them. */
export interface AccessBrokerClient {
  health(): Promise<{ readonly protocol: 'omni-access-broker-v1'; readonly status: 'ready' | 'degraded' }>
  readCredentialVersion(credentialId: string, version: number): Promise<CredentialMetadata | null>
  recordCredentialObservation(event: CredentialObservation, expectedRevision: number): Promise<
    | { readonly outcome: 'recorded' | 'duplicate'; readonly credential: CredentialMetadata }
    | { readonly outcome: 'conflict' | 'version-not-found' }
  >
}
