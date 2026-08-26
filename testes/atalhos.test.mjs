import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import {
  caminhoDosAtalhos,
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

test('tres resultados consecutivos criam candidato e uma nova execucao o valida sem promover', async () => {
  const casa = await casaTemporaria('omni-shortcut-')
  try {
    const first = await registrarObservacaoAtalho(casa, base, { now: '2030-01-01T10:00:00Z' })
    const second = await registrarObservacaoAtalho(casa, base, { now: '2030-01-02T10:00:00Z' })
    const third = await registrarObservacaoAtalho(casa, base, { now: '2030-01-03T10:00:00Z' })

    assert.equal(first.result, 'observing')
    assert.equal(second.result, 'observing')
    assert.equal(third.result, 'candidate')
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
    assert.equal(failed.result, 'validation-failed')
    assert.equal(failed.shortcut.status, 'observing')
    assert.equal(failed.shortcut.validation.status, 'failed')
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
    assert.equal(store.shortcuts[0].status, 'candidate')

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
    const future = '{"schemaVersion":2,"store":{"id":"future"},"shortcuts":[]}\n'
    await writeFile(path, future, 'utf8')
    await assert.rejects(lerAtalhos(casa), /mais novo que este plugin/i)
    assert.equal(await readFile(path, 'utf8'), future)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})
