export interface DurableMission {
  readonly id: string
  readonly objective: string
  readonly state: 'open' | 'in-progress' | 'blocked' | 'completed' | 'cancelled'
  readonly priority: number
  readonly payload: Readonly<Record<string, unknown>>
  readonly createdAt: string
  readonly updatedAt: string
  readonly closedAt: string | null
}

export interface DurableMissionClient {
  upsertMission(input: DurableMission): Promise<'applied' | 'duplicate'>
  listActiveMissions(): Promise<readonly DurableMission[]>
}
