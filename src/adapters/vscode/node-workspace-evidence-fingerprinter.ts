import { createHash } from 'node:crypto'

import type { WorkspaceEvidenceFingerprinter } from '../../ports/workspace-evidence-fingerprinter.js'

export class NodeWorkspaceEvidenceFingerprinter implements WorkspaceEvidenceFingerprinter {
  fingerprint(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex')
  }
}
