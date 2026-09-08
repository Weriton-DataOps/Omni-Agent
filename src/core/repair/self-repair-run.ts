export const SELF_REPAIR_STAGE_IDS = [
  'daily-scan',
  'failure-automation',
  'delegation-reconciliation',
  'historical-turn-reconciliation',
  'system-audit',
  'personality-eval',
  'operational-release'
] as const

export type SelfRepairStageId = typeof SELF_REPAIR_STAGE_IDS[number]
export type SelfRepairStageStatus = 'fulfilled' | 'rejected'

export const SELF_REPAIR_PROFILES = {
  reconciliation: [
    'failure-automation',
    'delegation-reconciliation',
    'historical-turn-reconciliation'
  ],
  maintenance: [
    'daily-scan',
    'system-audit',
    'personality-eval',
    'operational-release'
  ]
} as const satisfies Record<string, readonly SelfRepairStageId[]>

export type SelfRepairProfile = keyof typeof SELF_REPAIR_PROFILES

export interface SelfRepairStageObservation {
  readonly stage: SelfRepairStageId
  readonly status: SelfRepairStageStatus
}

export interface SelfRepairRunSummary {
  readonly profile: SelfRepairProfile
  readonly status: 'healthy' | 'degraded'
  readonly completedStages: number
  readonly failedStages: number
  readonly failedStageIds: readonly SelfRepairStageId[]
}

const KNOWN_STAGE_IDS = new Set<string>(SELF_REPAIR_STAGE_IDS)

export function summarizeSelfRepairRun(
  profile: SelfRepairProfile,
  stages: readonly SelfRepairStageObservation[]
): SelfRepairRunSummary {
  const expectedStages = SELF_REPAIR_PROFILES[profile]
  if (!expectedStages) throw new Error(`Perfil de autocorrecao desconhecido: ${String(profile)}.`)
  const seen = new Set<string>()
  const observed = new Map<SelfRepairStageId, SelfRepairStageStatus>()

  for (const item of stages) {
    if (!KNOWN_STAGE_IDS.has(item.stage)) throw new Error(`Etapa de autocorrecao desconhecida: ${item.stage}.`)
    if (!(expectedStages as readonly string[]).includes(item.stage)) {
      throw new Error(`Etapa ${item.stage} nao pertence ao perfil ${profile}.`)
    }
    if (seen.has(item.stage)) throw new Error(`Etapa de autocorrecao duplicada: ${item.stage}.`)
    seen.add(item.stage)
    if (!['fulfilled', 'rejected'].includes(item.status)) {
      throw new Error(`Estado de etapa de autocorrecao desconhecido: ${String(item.status)}.`)
    }
    observed.set(item.stage, item.status)
  }

  const missingStageIds = expectedStages.filter((stage) => !observed.has(stage))
  if (missingStageIds.length > 0) {
    throw new Error(`Perfil ${profile} sem etapas obrigatorias: ${missingStageIds.join(', ')}.`)
  }

  const failedStageIds = expectedStages.filter((stage) => observed.get(stage) === 'rejected')
  const completedStages = expectedStages.length - failedStageIds.length

  return {
    profile,
    status: failedStageIds.length === 0 ? 'healthy' : 'degraded',
    completedStages,
    failedStages: failedStageIds.length,
    failedStageIds
  }
}
