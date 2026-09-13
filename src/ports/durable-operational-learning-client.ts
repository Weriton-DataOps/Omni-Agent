/**
 * Sanitized operational-learning evidence. This contract deliberately carries
 * fingerprints and controlled labels only: never a conversation, command,
 * attachment, credential, filesystem path, or raw executor output.
 */
export interface DurableOperationalLearningFinding {
  readonly eventId: string
  readonly findingId: string
  readonly candidateFingerprint: string
  readonly category: string
  readonly destination: 'operational-rule' | 'procedure' | 'routing' | 'hook' | 'runtime-fix' | 'personality' | 'eval' | 'capability'
  readonly state: 'observing' | 'ready' | 'implementation-required' | 'materialized-pending-release' | 'installed-verified' | 'loaded-verified' | 'superseded'
  readonly occurrences: number
  readonly statementFingerprint: string
  readonly sourceFingerprint: string
  readonly artifactFingerprint: string | null
  readonly releaseVersion: string | null
  readonly observedAt: string
}

/** An authenticated, replay-safe persistence boundary for sanitized audit findings. */
export interface DurableOperationalLearningClient {
  recordOperationalLearningFinding(input: DurableOperationalLearningFinding): Promise<'recorded' | 'duplicate'>
}
