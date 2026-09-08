export interface DocumentFingerprint {
  algorithm: 'sha256-jcs-v1'
  value: `sha256:${string}`
}

export interface DocumentFingerprinter {
  fingerprint(value: unknown): DocumentFingerprint
  stableId(prefix: string, seed: string): string
}
