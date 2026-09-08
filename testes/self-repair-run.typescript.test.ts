import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SELF_REPAIR_PROFILES,
  summarizeSelfRepairRun,
  type SelfRepairStageObservation
} from '../src/core/repair/self-repair-run.js'

function observations(
  profile: keyof typeof SELF_REPAIR_PROFILES,
  rejected: readonly string[] = []
): SelfRepairStageObservation[] {
  return SELF_REPAIR_PROFILES[profile].map((stage) => ({
    stage,
    status: rejected.includes(stage) ? 'rejected' : 'fulfilled'
  }))
}

test('perfis exatos derivam saude e contagens em ordem canonica', () => {
  assert.deepEqual(summarizeSelfRepairRun('reconciliation', observations('reconciliation')), {
    profile: 'reconciliation',
    status: 'healthy',
    completedStages: 3,
    failedStages: 0,
    failedStageIds: []
  })

  assert.deepEqual(summarizeSelfRepairRun(
    'maintenance',
    observations('maintenance', ['daily-scan', 'system-audit']).reverse()
  ), {
    profile: 'maintenance',
    status: 'degraded',
    completedStages: 2,
    failedStages: 2,
    failedStageIds: ['daily-scan', 'system-audit']
  })
})

test('perfil recusa etapa ausente, extra, duplicada ou desconhecida', () => {
  assert.throws(() => summarizeSelfRepairRun(
    'reconciliation',
    observations('reconciliation').slice(1)
  ), /sem etapas obrigatorias/)

  assert.throws(() => summarizeSelfRepairRun('reconciliation', [
    ...observations('reconciliation'),
    { stage: 'daily-scan', status: 'fulfilled' }
  ]), /nao pertence ao perfil/)

  assert.throws(() => summarizeSelfRepairRun('maintenance', [
    ...observations('maintenance'),
    { stage: 'system-audit', status: 'rejected' }
  ]), /duplicada/)

  assert.throws(() => summarizeSelfRepairRun('maintenance', [
    ...observations('maintenance'),
    { stage: 'failure-automation', status: 'fulfilled' }
  ]), /nao pertence ao perfil/)

  assert.throws(() => summarizeSelfRepairRun('maintenance', [
    ...observations('maintenance').slice(1),
    { stage: 'unknown' as 'daily-scan', status: 'fulfilled' }
  ]), /desconhecida/)
})

test('perfil desconhecido falha fechado mesmo quando forjado pelo chamador', () => {
  assert.throws(() => summarizeSelfRepairRun(
    'legacy' as 'maintenance',
    observations('maintenance')
  ), /Perfil de autocorrecao desconhecido/)
})
