export interface ContextRetrievalQuery {
  readonly intent: string
  readonly projectId?: string
  readonly taskId?: string
  readonly environmentId?: string
}

export interface ShortcutSelectionQuery extends ContextRetrievalQuery {
  readonly limit: number
}

export interface TurnContextSources {
  loadMemory(home: string): Promise<unknown>
  loadCapabilityCatalog(): Promise<unknown>
  loadPersonality(): Promise<unknown>
  loadBudgetPolicy(): Promise<unknown>
  loadArchitecture(): Promise<unknown>
  loadStructuredContext(home: string): Promise<unknown>
  loadOperationalCycle(home: string): Promise<unknown>
  loadShortcuts(home: string): Promise<unknown>
  loadLearnedRules(): Promise<unknown>
  loadLearnedProcedures(): Promise<unknown>
  rankMemories(confirmed: readonly unknown[], query: ContextRetrievalQuery): Promise<unknown>
  selectShortcuts(store: unknown, intent: string, query: ShortcutSelectionQuery): readonly unknown[]
  recordMemoryUsage(home: string, ids: readonly string[]): Promise<unknown>
  recordShortcutUsage(home: string, ids: readonly string[]): Promise<unknown>
  shortHash(value: string): string
  now(): Date
}
