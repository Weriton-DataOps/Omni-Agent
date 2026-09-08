import { createHash } from 'node:crypto';
export class NodeWorkspaceEvidenceFingerprinter {
    fingerprint(value) {
        return createHash('sha256').update(value, 'utf8').digest('hex');
    }
}
