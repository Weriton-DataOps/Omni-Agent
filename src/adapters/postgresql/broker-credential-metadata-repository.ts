import type { CredentialMetadata, CredentialObservation } from '../../core/access/credential.js'
import type { AccessBrokerClient } from '../../ports/access-broker-client.js'
import type { CredentialMetadataRepository } from '../../ports/credential-metadata-repository.js'

/** Every credential observation crosses the local broker as one audited compare-and-swap transaction. */
export class BrokerCredentialMetadataRepository implements CredentialMetadataRepository {
  constructor(private readonly broker: AccessBrokerClient) {}

  readVersion(credentialId: string, version: number): Promise<CredentialMetadata | null> {
    return this.broker.readCredentialVersion(credentialId, version)
  }

  recordObservation(event: CredentialObservation, expectedRevision: number): Promise<
    | { readonly outcome: 'recorded' | 'duplicate'; readonly credential: CredentialMetadata }
    | { readonly outcome: 'conflict' | 'version-not-found' }
  > {
    return this.broker.recordCredentialObservation(event, expectedRevision)
  }
}
