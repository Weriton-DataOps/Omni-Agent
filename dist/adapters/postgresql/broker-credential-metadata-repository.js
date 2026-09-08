/** Every credential observation crosses the local broker as one audited compare-and-swap transaction. */
export class BrokerCredentialMetadataRepository {
    broker;
    constructor(broker) {
        this.broker = broker;
    }
    readVersion(credentialId, version) {
        return this.broker.readCredentialVersion(credentialId, version);
    }
    recordObservation(event, expectedRevision) {
        return this.broker.recordCredentialObservation(event, expectedRevision);
    }
}
