import { createHash } from 'node:crypto'

import { canonicalJson } from '../../core/shared/json.js'
import type { DocumentFingerprint, DocumentFingerprinter } from '../../ports/document-fingerprinter.js'

function sha256(value: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

export class NodeDocumentFingerprinter implements DocumentFingerprinter {
  fingerprint(value: unknown): DocumentFingerprint {
    return { algorithm: 'sha256-jcs-v1', value: sha256(canonicalJson(value)) }
  }

  stableId(prefix: string, seed: string): string {
    return `${prefix}-${sha256(seed).slice('sha256:'.length, 'sha256:'.length + 24)}`
  }
}
