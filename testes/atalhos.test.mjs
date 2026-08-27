import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import {
  caminhoDosAtalhos,
  executarManutencaoAtalhos,
  lerAtalhos,
  registrarObservacaoAtalho,
  validarAtalho
} from '../runtime/atalhos.mjs'
import { lerMemoria } from '../runtime/memoria.mjs'

const base = {
  goal: 'diagnosticar conexoes do Postgres',
  baselineSteps: ['CPU', 'RAM', 'Processos', 'Postgres', 'Conexoes'],
  shortcutSteps: ['Postgres', 'Conexoes'],
  outcome: 'gargalo de conexoes confirmado',
  success: true,
  scope: { type: 'user' }
}

async function casaTemporaria(prefix) {
  return mkdtemp(join(tmpdir(), prefix))
}

test('primeiro sucesso ativa o atalho e tres o validam sem promover para o Git', async () => {
  const casa = await casaTemporaria('omni-shortcut-')
  try {
    const first = await registrarObservacaoAtalho(casa, base, { now: '2030-01-01T10:00:00Z' })
    const second = await registrarObservacaoAtalho(casa, base, { now: '2030-01-02T10:00:00Z' })
    const third = await registrarObservacaoAtalho(casa, base, { now: '2030-01-03T10:00:00Z' })

    assert.equal(first.result, 'active')
    assert.equal(second.result, 'active')
    assert.equal(third.result, 'validated')
    assert.equal(third.shortcut.consecutiveSuccesses, 3)
    assert.equal(third.promotion, 'not-performed')

    const validation = await validarAtalho(
      casa,
      third.shortcut.id,
      { outcome: base.outcome, success: true, durationMs: 850 },
      { now: '2030-01-04T10:00:00Z' }
    )
    assert.equal(validation.result, 'validated')
    assert.equal(validation.shortcut.validation.status, 'passed')
    assert.equal(validation.promotion, 'not-performed')

    const memory = await lerMemoria(casa)
    assert.equal(memory.confirmed.length, 0)
    assert.equal(memory.candidates.length, 0)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('resultado inconsistente ou falho reinicia a evidencia e desfaz validacao', async () => {
  const casa = await casaTemporaria('omni-shortcut-reset-')
  try {
    await registrarObservacaoAtalho(casa, base)
    await registrarObservacaoAtalho(casa, base)
    const inconsistent = await registrarObservacaoAtalho(casa, {
      ...base,
      outcome: 'resultado diferente embora a execucao tenha terminado'
    })
    assert.equal(inconsistent.result, 'observing')
    assert.equal(inconsistent.shortcut.consecutiveSuccesses, 0)
    assert.equal(inconsistent.shortcut.inconsistentCount, 1)

    await registrarObservacaoAtalho(casa, base)
    await registrarObservacaoAtalho(casa, base)
    const candidate = await registrarObservacaoAtalho(casa, base)
    const failed = await validarAtalho(casa, candidate.shortcut.id, {
      outcome: 'a verificacao final falhou',
      success: false
    })
    assert.equal(failed.result, 'archived')
    assert.equal(failed.shortcut.status, 'observing')
    assert.equal(failed.shortcut.validation.status, 'failed')
    assert.equal((await lerAtalhos(casa)).shortcuts.length, 0)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('store nao grava resultado bruto, recusa segredo e consolida concorrencia', async () => {
  const casa = await casaTemporaria('omni-shortcut-safe-')
  try {
    await Promise.all(Array.from({ length: 6 }, () => registrarObservacaoAtalho(casa, base)))
    const store = await lerAtalhos(casa)
    assert.equal(store.shortcuts.length, 1)
    assert.equal(store.shortcuts[0].observations.length, 6)
    assert.equal(store.shortcuts[0].status, 'validated')

    const raw = await readFile(caminhoDosAtalhos(casa), 'utf8')
    assert.equal(raw.includes(base.outcome), false)

    const segredoSintetico = ['sk', 'proj', 'abcdefghijklmnopqrstuvwxyz123456'].join('-')
    await assert.rejects(
      registrarObservacaoAtalho(casa, { ...base, outcome: segredoSintetico }),
      /segredo/i
    )
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('atalho precisa ser menor e runtime antigo recusa store futuro sem sobrescrever', async () => {
  const casa = await casaTemporaria('omni-shortcut-version-')
  try {
    await assert.rejects(
      registrarObservacaoAtalho(casa, { ...base, shortcutSteps: [...base.baselineSteps] }),
      /remover ao menos uma etapa/i
    )

    const path = caminhoDosAtalhos(casa)
    await mkdir(dirname(path), { recursive: true })
    const future = '{"schemaVersion":3,"store":{"id":"future"},"shortcuts":[],"archive":[]}\n'
    await writeFile(path, future, 'utf8')
    await assert.rejects(lerAtalhos(casa), /mais novo que este plugin/i)
    assert.equal(await readFile(path, 'utf8'), future)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('identidade ignora o verbo do pedido e mantem verificacao no atalho', async () => {
  const casa = await casaTemporaria('omni-shortcut-family-')
  try {
    await registrarObservacaoAtalho(casa, { ...base, goal: 'corrigir: delegar e acompanhar uma execucao' })
    await registrarObservacaoAtalho(casa, { ...base, goal: 'validar: delegar e acompanhar uma execucao' })
    const store = await lerAtalhos(casa)
    assert.equal(store.shortcuts.length, 1)
    assert.equal(store.shortcuts[0].family, 'delegar e acompanhar uma execucao')
    assert.ok(store.shortcuts[0].shortcutSteps.includes('verificar o resultado'))
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('atalho sem uso expira para arquivo e falhas repetidas tambem arquivam', async () => {
  const casa = await casaTemporaria('omni-shortcut-decay-')
  try {
    await registrarObservacaoAtalho(casa, base, { now: '2030-01-01T10:00:00Z' })
    const decayed = await executarManutencaoAtalhos(casa, { now: '2030-02-02T10:00:00Z' })
    assert.equal(decayed.actions.length, 1)
    assert.equal((await lerAtalhos(casa)).archive[0].reason, 'inactive')

    await registrarObservacaoAtalho(casa, base, { now: '2030-02-03T10:00:00Z' })
    await registrarObservacaoAtalho(
      casa,
      { ...base, success: false, outcome: 'falhou uma vez' },
      { now: '2030-02-04T10:00:00Z' }
    )
    const archived = await registrarObservacaoAtalho(
      casa,
      { ...base, success: false, outcome: 'falhou de novo' },
      { now: '2030-02-05T10:00:00Z' }
    )
    assert.equal(archived.result, 'archived')
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('migracao v1 cria backup, generaliza familias operacionais e consolida duplicatas', async () => {
  const casa = await casaTemporaria('omni-shortcut-migration-')
  try {
    const path = caminhoDosAtalhos(casa)
    await mkdir(dirname(path), { recursive: true })
    const observation = (suffix, at) => ({
      id: `obs-${suffix}`,
      recordedAt: at,
      success: true,
      consistent: true,
      outcomeFingerprint: 'a'.repeat(64),
      durationMs: null
    })
    const shortcut = (suffix, goal, scopeId, at) => ({
      id: `shortcut-${suffix}`,
      goal,
      scope: { type: 'project', id: scopeId },
      baselineSteps: ['interpretar', 'Agent', 'verificar', 'reportar'],
      shortcutSteps: ['Agent', 'reportar'],
      status: 'observing',
      outcomeFingerprint: 'a'.repeat(64),
      consecutiveSuccesses: 1,
      successCount: 1,
      failureCount: 0,
      inconsistentCount: 0,
      observations: [observation(suffix, at)],
      validation: null,
      createdAt: at,
      updatedAt: at
    })
    const source = `${JSON.stringify({
      schemaVersion: 1,
      store: {
        id: 'omni-local-shortcut-learning',
        createdAt: '2030-01-01T00:00:00Z',
        updatedAt: '2030-01-03T00:00:00Z'
      },
      shortcuts: [
        shortcut('one', 'corrigir: delegar e acompanhar uma execucao', 'C:\\projeto-a', '2030-01-01T00:00:00Z'),
        shortcut('two', 'validar: delegar e acompanhar uma execucao', 'C:\\projeto-b', '2030-01-02T00:00:00Z'),
        shortcut('three', 'implementar: delegar e acompanhar uma execucao', 'C:\\projeto-c', '2030-01-03T00:00:00Z')
      ]
    }, null, 2)}\n`
    await writeFile(path, source, 'utf8')

    const store = await lerAtalhos(casa)
    assert.equal(store.schemaVersion, 2)
    assert.equal(store.shortcuts.length, 1)
    assert.equal(store.shortcuts[0].scope.type, 'user')
    assert.equal(store.shortcuts[0].status, 'validated')
    assert.equal(store.shortcuts[0].successCount, 3)
    assert.deepEqual(store.shortcuts[0].shortcutSteps.slice(-2), ['verificar o resultado', 'reportar'])
    assert.equal(store.archive.length, 2)
    const files = await readdir(dirname(path))
    const backup = files.find((name) => name.includes('.before-v1-to-v2.') && name.endsWith('.backup'))
    assert.ok(backup)
    assert.equal(await readFile(join(dirname(path), backup), 'utf8'), source)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})
