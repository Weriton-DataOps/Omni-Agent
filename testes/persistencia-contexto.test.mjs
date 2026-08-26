import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  caminhoDaPersistenciaContexto,
  registrarCheckpoint,
  registrarDescoberta
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
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
