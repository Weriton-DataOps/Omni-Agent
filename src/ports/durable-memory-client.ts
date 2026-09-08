export interface DurableMemoryEntry {
  readonly id: string
  readonly lane: 'confirmed' | 'candidate'
  readonly type: 'preference' | 'episodic' | 'semantic' | 'procedural' | 'objective' | 'capability'
  readonly scopeType: 'user' | 'project' | 'task' | 'environment'
  readonly scopeId: string | null
  readonly projectId: string | null
  readonly textFingerprint: string
  readonly payload: Readonly<Record<string, unknown>>
  readonly sourceUpdatedAt: string
}

/** Bounded, idempotent import into the durable layer. The local JSON state remains the working cache. */
export interface DurableMemoryClient {
  importMemoryBatch(input: {
    readonly importId: string
    readonly sourceFingerprint: string
    readonly entries: readonly DurableMemoryEntry[]
  }): Promise<'applied' | 'duplicate'>
}
