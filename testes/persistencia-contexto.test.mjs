import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import {
  caminhoDaPersistenciaContexto,
  lerPersistenciaContexto,
  registrarCheckpoint,
  registrarDescoberta,
  resolverDescoberta
} from '../runtime/persistencia-contexto.mjs'

const task = {
  objective: 'validar o núcleo do Omni por conversa',
  scope: ['contexto e memória'],
  nonGoals: ['construir interface'],
  requirements: ['preservar personalidade'],
  successCriteria: ['respostas consistentes'],
  definitionOfDone: ['eval sem regressão'],
  knownConstraints: ['nenhuma conversa bruta persistida']
}

test('checkpoint comprime estado estruturado sem guardar conversa nem id bruto', async () => {
  const home = await mkdtemp(join(tmpdir(), 'omni-checkpoint-'))
  try {
    const recorded = await registrarCheckpoint(home, {
      runId: 'sessao-privada-123', task,
      state: {
        summary: 'x'.repeat(1200),
        decisions: ['interface adiada'],
        openTasks: ['conversar com o Omni'],
        eventRefs: ['evento-1'], artifactRefs: ['artefato-1'], memoryRefs: ['memoria-1']
      }
    })
    assert.equal(recorded.checkpoint.state.summary.length, 800)
    assert.equal(recorded.checkpoint.compression.rawConversationStored, false)
    const raw = await readFile(caminhoDaPersistenciaContexto(home), 'utf8')
    assert.doesNotMatch(raw, /sessao-privada-123/)
    assert.match(recorded.checkpoint.runFingerprint, /^[a-f0-9]{64}$/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('checkpoint recusa conversa bruta inclusive em campo aninhado', async () => {
  const home = await mkdtemp(join(tmpdir(), 'omni-checkpoint-'))
  try {
    await assert.rejects(registrarCheckpoint(home, {
      runId: 'sessao-1', task,
      state: { summary: 'estado atual válido', decisions: [], messages: ['fala privada'] }
    }), /conversa bruta/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('definição de tarefa incompleta não vira checkpoint', async () => {
  const home = await mkdtemp(join(tmpdir(), 'omni-checkpoint-'))
  try {
    await assert.rejects(registrarCheckpoint(home, {
      runId: 'sessao-1', task: { objective: 'fazer algo' }, state: { summary: 'estado atual' }
    }), /Escopo/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('descoberta fora do DoD vai ao backlog e nunca é implementada automaticamente', async () => {
  const home = await mkdtemp(join(tmpdir(), 'omni-backlog-'))
  try {
    const optional = await registrarDescoberta(home, {
      title: 'nova interface', reason: 'ideia futura', source: 'conversa'
    })
    assert.equal(optional.result, 'backlog')
    assert.equal(optional.discovery.implemented, false)
    const required = await registrarDescoberta(home, {
      title: 'corrigir regressão', reason: 'bloqueia o DoD', source: 'eval',
      requiredForDefinitionOfDone: true
    })
    assert.equal(required.result, 'required-for-dod')
    assert.equal(required.discovery.implemented, false)

    const resolved = await resolverDescoberta(home, optional.discovery.id, {
      resolution: 'correção implementada e coberta por teste automatizado'
    })
    assert.equal(resolved.result, 'resolved')
    assert.equal(resolved.discovery.implemented, true)
    const store = await lerPersistenciaContexto(home)
    assert.equal(store.backlog.length, 1)
    assert.equal(store.resolvedDiscoveries.length, 1)
    assert.match(store.resolvedDiscoveries[0].resolution, /teste automatizado/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('store v1 migra com backup antes de ganhar histórico de resoluções', async () => {
  const home = await mkdtemp(join(tmpdir(), 'omni-context-migration-'))
  try {
    const path = caminhoDaPersistenciaContexto(home)
    await mkdir(dirname(path), { recursive: true })
    const source = `${JSON.stringify({
      schemaVersion: 1,
      store: {
        id: 'omni-local-structured-context',
        createdAt: '2030-01-01T00:00:00Z',
        updatedAt: '2030-01-01T00:00:00Z'
      },
      checkpoints: [],
      backlog: []
    }, null, 2)}\n`
    await writeFile(path, source, 'utf8')
    const store = await lerPersistenciaContexto(home)
    assert.equal(store.schemaVersion, 2)
    assert.deepEqual(store.resolvedDiscoveries, [])
    const files = await readdir(dirname(path))
    const backup = files.find((name) => name.includes('.before-v1-to-v2.') && name.endsWith('.backup'))
    assert.ok(backup)
    assert.equal(await readFile(join(dirname(path), backup), 'utf8'), source)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
