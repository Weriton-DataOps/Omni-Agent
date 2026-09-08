import { createHash } from 'node:crypto';
import { canonicalJson } from '../../core/shared/json.js';
function sha256(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
export class NodeDocumentFingerprinter {
    fingerprint(value) {
        return { algorithm: 'sha256-jcs-v1', value: sha256(canonicalJson(value)) };
    }
    stableId(prefix, seed) {
        return `${prefix}-${sha256(seed).slice('sha256:'.length, 'sha256:'.length + 24)}`;
    }
}
