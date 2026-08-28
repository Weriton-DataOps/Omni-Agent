import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { abrirTurnoAuditoria, registrarAcaoAuditoria } from '../runtime/auditoria-autocorrecao.mjs'
import {
  caminhoDosAtalhos,
  executarManutencaoAtalhos,
  lerAtalhos,
  registrarObservacaoAtalho as registrarObservacaoAtalhoReal,
  validarAtalho as validarAtalhoReal,
  vinculoVerificacaoAtalho
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

let executionSequence = 0

async function evidenciaReal(casa, input, { now } = {}) {
  executionSequence += 1
  const sessionId = `shortcut-session-${executionSequence}`
  const executionId = `shortcut-tool-${executionSequence}`
  const at = now ?? new Date(Date.UTC(2030, 0, 1, 10, 0, executionSequence)).toISOString()
  const stable = input.success !== false && input.outcome === base.outcome
  const binding = vinculoVerificacaoAtalho(input)
  const verificationCommand = stable
    ? 'node --test testes/atalhos.test.mjs'
    : `node --test testes/atalhos.test.mjs --test-name-pattern variante-${executionSequence}`
  const command = `${verificationCommand} # omni-shortcut-binding:${binding}`
  await abrirTurnoAuditoria(casa, {
    session_id: sessionId,
    prompt: 'Verifique o resultado real do procedimento.'
  }, { at: new Date(Date.parse(at) - 1_000).toISOString() })
  await registrarAcaoAuditoria(casa, {
    hook_event_name: 'PostToolUse',
    session_id: sessionId,
    tool_use_id: executionId,
    tool_name: 'Bash',
    tool_input: { command },
    cwd: 'C:\\projetos\\teste'
  }, { at })
  return { sessionId, executionId }
}

async function registrarObservacaoAtalho(casa, input, options = {}) {
  const evidence = await evidenciaReal(casa, input, options)
  const { outcome: _outcome, success: _success, ...safe } = input
  return registrarObservacaoAtalhoReal(casa, { ...safe, ...evidence })
}

async function validarAtalho(casa, id, input, options = {}) {
  const evidence = await evidenciaReal(casa, { ...base, ...input }, options)
  const { outcome: _outcome, success: _success, ...safe } = input
  return validarAtalhoReal(casa, id, { ...safe, ...evidence })
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

test('git status com o vinculo correto nao valida um atalho de diagnostico', async () => {
  const casa = await casaTemporaria('omni-shortcut-wrong-family-')
  try {
    const sessionId = 'shortcut-wrong-family-session'
    const executionId = 'shortcut-wrong-family-tool'
    const binding = vinculoVerificacaoAtalho(base)
    await abrirTurnoAuditoria(casa, {
      session_id: sessionId,
      prompt: 'Verifique o diagnostico antes de aprender o atalho.'
    }, { at: '2030-01-01T10:00:00.000Z' })
    await registrarAcaoAuditoria(casa, {
      hook_event_name: 'PostToolUse',
      session_id: sessionId,
      tool_use_id: executionId,
      tool_name: 'Bash',
      tool_input: { command: `git status # omni-shortcut-binding:${binding}` },
      cwd: 'C:\\projetos\\teste'
    }, { at: '2030-01-01T10:00:01.000Z' })
    const { outcome: _outcome, success: _success, ...safe } = base
    const result = await registrarObservacaoAtalhoReal(casa, { ...safe, sessionId, executionId })
    assert.equal(result.result, 'unverified-action')
    assert.equal(result.shortcut, null)
    assert.equal((await lerAtalhos(casa)).shortcuts.length, 0)
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

    await assert.rejects(
      registrarObservacaoAtalhoReal(casa, { ...base, sessionId: 'sessao', executionId: 'execucao' }),
      /autodeclarados/i
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
    const future = '{"schemaVersion":5,"store":{"id":"future"},"shortcuts":[],"archive":[]}\n'
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
    assert.equal(store.schemaVersion, 4)
    assert.equal(store.shortcuts.length, 1)
    assert.equal(store.shortcuts[0].scope.type, 'user')
    assert.equal(store.shortcuts[0].status, 'observing')
    assert.equal(store.shortcuts[0].successCount, 0)
    assert.equal(store.shortcuts[0].legacyUnverifiedObservations.length, 3)
    assert.deepEqual(store.shortcuts[0].shortcutSteps.slice(-2), ['verificar o resultado', 'reportar'])
    assert.equal(store.archive.length, 2)
    const files = await readdir(dirname(path))
    const backup = files.find((name) => name.includes('.before-v1-to-v4.') && name.endsWith('.backup'))
    assert.ok(backup)
    assert.equal(await readFile(join(dirname(path), backup), 'utf8'), source)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})
