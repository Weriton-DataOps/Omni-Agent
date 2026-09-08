import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import {
  caminhoDaTelemetriaAutocorrecao,
  lerTelemetriaAutocorrecao,
  registrarTelemetriaAutocorrecao
} from '../runtime/telemetria-autocorrecao.mjs'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const RECONCILIATION = [
  'failure-automation',
  'delegation-reconciliation',
  'historical-turn-reconciliation'
]
const MAINTENANCE = [
  'daily-scan',
  'system-audit',
  'personality-eval',
  'operational-release'
]

function stage(stageId, status = 'fulfilled') {
  return status === 'fulfilled'
    ? { stage: stageId, status, resultFingerprint: HASH_A }
    : { stage: stageId, status, errorFingerprint: HASH_B }
}

function stages(ids, rejected = []) {
  return ids.map((stageId) => stage(stageId, rejected.includes(stageId) ? 'rejected' : 'fulfilled'))
}

function privacy() {
  return {
    rawConversationStored: false,
    rawToolDataStored: false,
    rawPathsStored: false,
    rawErrorsStored: false
  }
}

async function writeStore(casa, value) {
  const path = caminhoDaTelemetriaAutocorrecao(casa)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  return path
}

test('telemetria v2 persiste perfil exato e somente fingerprints', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-self-repair-telemetry-'))
  try {
    const run = await registrarTelemetriaAutocorrecao(casa, {
      profile: 'reconciliation',
      event: 'SessionStart',
      at: '2026-08-31T20:00:00.000Z',
      stages: stages(RECONCILIATION, ['historical-turn-reconciliation']).reverse()
    })
    assert.equal(run.profile, 'reconciliation')
    assert.equal(run.status, 'degraded')
    assert.equal(run.completedStages, 2)
    assert.equal(run.failedStages, 1)
    assert.deepEqual(run.stages.map((item) => item.stage), RECONCILIATION)

    const store = await lerTelemetriaAutocorrecao(casa)
    assert.equal(store.schemaVersion, 2)
    assert.equal(store.runs.length, 1)
    assert.equal(store.legacyRuns.length, 0)
    assert.equal(store.runs[0].stages[2].errorFingerprint, HASH_B)
    const raw = await readFile(caminhoDaTelemetriaAutocorrecao(casa), 'utf8')
    assert.equal(raw.includes('erro bruto que nao pode persistir'), false)
    assert.equal(raw.includes(casa), false)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('registro recusa perfil com etapa ausente, extra ou duplicada', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-self-repair-strict-'))
  try {
    await assert.rejects(registrarTelemetriaAutocorrecao(casa, {
      profile: 'reconciliation',
      event: 'Stop',
      stages: stages(RECONCILIATION.slice(1))
    }), /sem etapas obrigatorias/)

    await assert.rejects(registrarTelemetriaAutocorrecao(casa, {
      profile: 'reconciliation',
      event: 'Stop',
      stages: [...stages(RECONCILIATION), stage('daily-scan')]
    }), /nao pertence ao perfil/)

    await assert.rejects(registrarTelemetriaAutocorrecao(casa, {
      profile: 'maintenance',
      event: 'Stop',
      stages: [...stages(MAINTENANCE), stage('system-audit')]
    }), /duplicada/)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('migração v1 classifica conjuntos exatos e isola legado sem mascarar perfis', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-self-repair-migration-'))
  const timestamp = '2026-08-31T20:00:00.000Z'
  try {
    const path = await writeStore(casa, {
      schemaVersion: 1,
      store: {
        id: 'omni-local-self-repair-telemetry',
        createdAt: timestamp,
        updatedAt: timestamp
      },
      runs: [
        {
          id: 'self-repair-run-classified1',
          event: 'SessionStart',
          executedAt: timestamp,
          status: 'healthy',
          completedStages: 99,
          failedStages: 0,
          stages: stages(RECONCILIATION, ['failure-automation']).reverse(),
          privacy: privacy()
        },
        {
          id: 'self-repair-run-maintenance1',
          event: 'Stop',
          executedAt: timestamp,
          status: 'degraded',
          completedStages: 0,
          failedStages: 99,
          stages: stages(MAINTENANCE),
          privacy: privacy()
        },
        {
          id: 'self-repair-run-oldseven01',
          event: 'Stop',
          executedAt: timestamp,
          status: 'healthy',
          completedStages: 7,
          failedStages: 0,
          stages: stages([...RECONCILIATION, ...MAINTENANCE]),
          privacy: privacy()
        },
        {
          id: 'self-repair-run-unclassified1',
          event: 'Stop',
          executedAt: timestamp,
          status: 'healthy',
          completedStages: 2,
          failedStages: 0,
          stages: [
            stage('segredo-bruto-no-id-da-etapa'),
            stage('system-audit', 'rejected')
          ],
          privacy: privacy()
        }
      ]
    })

    const migrated = await lerTelemetriaAutocorrecao(casa)
    assert.equal(migrated.schemaVersion, 2)
    assert.equal(migrated.runs.length, 2)
    assert.equal(migrated.runs[0].profile, 'reconciliation')
    assert.equal(migrated.runs[0].status, 'degraded')
    assert.equal(migrated.runs[0].completedStages, 2)
    assert.equal(migrated.runs[0].failedStages, 1)
    assert.equal(migrated.runs[1].profile, 'maintenance')
    assert.equal(migrated.runs[1].status, 'healthy')
    assert.equal(migrated.runs[1].completedStages, 4)
    assert.equal(migrated.runs[1].failedStages, 0)
    assert.equal(migrated.legacyRuns.length, 2)
    assert.equal(migrated.legacyRuns[0].profile, 'legacy-unclassified')
    assert.equal(migrated.legacyRuns[0].status, 'legacy-unclassified')
    assert.equal(migrated.legacyRuns[0].stages.length, 7)
    assert.deepEqual(
      migrated.legacyRuns[1].stages.map((item) => item.stage),
      ['legacy-unknown', 'system-audit']
    )
    assert.equal(migrated.legacyRuns[1].completedStages, 1)
    assert.equal(migrated.legacyRuns[1].failedStages, 1)
    const raw = await readFile(path, 'utf8')
    assert.equal(raw.includes('segredo-bruto-no-id-da-etapa'), false)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('status e contagens de v2 são recalculados e persistidos a partir das etapas', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-self-repair-derived-'))
  const timestamp = '2026-08-31T20:00:00.000Z'
  try {
    const path = await writeStore(casa, {
      schemaVersion: 2,
      store: {
        id: 'omni-local-self-repair-telemetry',
        createdAt: timestamp,
        updatedAt: timestamp
      },
      runs: [{
        id: 'self-repair-run-derived01',
        profile: 'reconciliation',
        event: 'Stop',
        executedAt: timestamp,
        status: 'healthy',
        completedStages: 88,
        failedStages: 0,
        stages: stages(RECONCILIATION, ['delegation-reconciliation']),
        privacy: privacy()
      }],
      legacyRuns: []
    })

    const store = await lerTelemetriaAutocorrecao(casa)
    assert.equal(store.runs[0].status, 'degraded')
    assert.equal(store.runs[0].completedStages, 2)
    assert.equal(store.runs[0].failedStages, 1)
    const persisted = JSON.parse(await readFile(path, 'utf8'))
    assert.equal(persisted.runs[0].status, 'degraded')
    assert.equal(persisted.runs[0].completedStages, 2)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('JSON inválido é quarentenado no mesmo diretório e substituído sob leitura', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-self-repair-invalid-'))
  try {
    const path = await writeStore(casa, '{ "schemaVersion": 2, "segredo": "NAO-COPIAR" ')
    const store = await lerTelemetriaAutocorrecao(casa)
    assert.equal(store.schemaVersion, 2)
    assert.deepEqual(store.runs, [])
    assert.deepEqual(store.legacyRuns, [])

    const replacement = JSON.parse(await readFile(path, 'utf8'))
    assert.equal(replacement.schemaVersion, 2)
    assert.equal(JSON.stringify(replacement).includes('NAO-COPIAR'), false)
    const entries = await readdir(dirname(path))
    assert.equal(entries.some((name) => name.startsWith('self-repair-runs.json.quarantine-invalid-json-')), true)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('schema futuro e conjunto v2 inválido são quarentenados sem envenenar leituras', async () => {
  for (const scenario of [
    {
      name: 'future-schema',
      value: { schemaVersion: 99, raw: 'SEGREDO-FUTURO' }
    },
    {
      name: 'invalid-v2',
      value: {
        schemaVersion: 2,
        store: {
          id: 'omni-local-self-repair-telemetry',
          createdAt: '2026-08-31T20:00:00.000Z',
          updatedAt: '2026-08-31T20:00:00.000Z'
        },
        runs: [{
          id: 'self-repair-run-missing01',
          profile: 'reconciliation',
          event: 'Stop',
          executedAt: '2026-08-31T20:00:00.000Z',
          status: 'healthy',
          completedStages: 2,
          failedStages: 0,
          stages: stages(RECONCILIATION.slice(1)),
          privacy: privacy()
        }],
        legacyRuns: []
      }
    }
  ]) {
    const casa = await mkdtemp(join(tmpdir(), `omni-self-repair-${scenario.name}-`))
    try {
      const path = await writeStore(casa, scenario.value)
      const first = await lerTelemetriaAutocorrecao(casa)
      const second = await lerTelemetriaAutocorrecao(casa)
      assert.equal(first.schemaVersion, 2)
      assert.deepEqual(first.runs, [])
      assert.deepEqual(second, first)
      const entries = await readdir(dirname(path))
      assert.equal(entries.some((name) => name.startsWith(`self-repair-runs.json.quarantine-${scenario.name}-`)), true)
    } finally {
      await rm(casa, { recursive: true, force: true })
    }
  }
})
