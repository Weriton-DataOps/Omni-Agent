import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { abrirTurnoAuditoria } from '../runtime/auditoria-autocorrecao.mjs'
import {
  bloquearAutomacaoFalha,
  caminhoDaAutomacaoFalhas,
  confirmarInicioAutomacaoFalha,
  exigirInicioDespachoAntesDaParada,
  prepararDespachoAutomaticoFalha,
  sincronizarAutomacaoFalhas
} from '../runtime/automacao-falhas.mjs'
import { registrarFalha } from '../runtime/falhas.mjs'

async function home() {
  return mkdtemp(join(tmpdir(), 'omni-proactive-failure-'))
}

async function candidate(casa, suffix = 'base') {
  const failure = {
    agent: 'omni',
    action: 'executar Bash',
    failureClass: 'permission',
    signature: `permissao negada ${suffix}`
  }
  for (let index = 1; index <= 3; index += 1) {
    await registrarFalha(casa, { ...failure, evidenceId: `${suffix}-run-${index}` })
  }
}

test('despacho ignorado continua obrigatorio e nao cria outro job', async () => {
  const casa = await home()
  try {
    await candidate(casa, 'persistent-dispatch')
    const sessionId = 'proactive-session'
    await abrirTurnoAuditoria(casa, { session_id: sessionId, prompt: 'corrija falhas locais' })
    const first = await prepararDespachoAutomaticoFalha(casa, {
      sessionId,
      executorId: 'host-model'
    })
    const second = await prepararDespachoAutomaticoFalha(casa, {
      sessionId,
      executorId: 'host-model'
    })

    assert.equal(first.result, 'dispatch-required')
    assert.equal(second.result, 'dispatch-required')
    assert.equal(second.job.id, first.job.id)
    assert.equal(second.job.delegationId, first.delegation.id)
    assert.equal(second.job.attempts, 0)
    assert.equal((await sincronizarAutomacaoFalhas(casa)).jobs.length, 1)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('Stop exige inicio real e SubagentStart libera o gate', async () => {
  const casa = await home()
  try {
    await candidate(casa, 'stop-gate')
    const sessionId = 'stop-gate-session'
    await abrirTurnoAuditoria(casa, { session_id: sessionId, prompt: 'investigue e corrija' })
    const dispatch = await prepararDespachoAutomaticoFalha(casa, {
      sessionId,
      executorId: 'host-model'
    })

    const blocked = await exigirInicioDespachoAntesDaParada(casa, { sessionId })
    assert.equal(blocked.decision, 'block')
    assert.match(blocked.reason, /failure-dispatch-not-started/)
    assert.match(blocked.reason, new RegExp(dispatch.job.id))

    const recursive = await exigirInicioDespachoAntesDaParada(casa, {
      sessionId,
      stopHookActive: true
    })
    assert.equal(recursive.result, 'pending-recursion')
    assert.equal(recursive.decision, null)
    assert.equal(recursive.job.state, 'queued')
    assert.equal(recursive.job.attempts, 0)

    const wrongStart = await confirmarInicioAutomacaoFalha(casa, {
      sessionId,
      delegationId: 'delegation-errada',
      agentId: 'untracked-agent'
    })
    assert.equal(wrongStart.result, 'ignored')

    const started = await confirmarInicioAutomacaoFalha(casa, {
      sessionId,
      delegationId: dispatch.delegation.id,
      agentId: 'real-background-agent'
    })
    assert.equal(started.result, 'started')
    assert.equal(started.job.attempts, 1)
    assert.equal(started.job.state, 'running')

    const released = await exigirInicioDespachoAntesDaParada(casa, { sessionId })
    assert.equal(released.decision, null)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('erro tecnico reagenda com outra estrategia; somente expansao concreta pede proprietario', async () => {
  const casa = await home()
  try {
    await candidate(casa, 'retry-not-wall')
    const sessionId = 'retry-session'
    await abrirTurnoAuditoria(casa, { session_id: sessionId, prompt: 'investigue e corrija' })
    const dispatch = await prepararDespachoAutomaticoFalha(casa, {
      sessionId,
      executorId: 'host-model'
    })
    await confirmarInicioAutomacaoFalha(casa, {
      sessionId,
      delegationId: dispatch.delegation.id,
      agentId: 'retry-agent'
    })

    const retry = await bloquearAutomacaoFalha(
      casa,
      dispatch.job.id,
      'a primeira estrategia nao localizou evidencia suficiente',
      { kind: 'retryable', evidenceId: 'audit-evidence-local-1', strategy: 'buscar pelo id da sessao' }
    )
    assert.equal(retry.result, 'retry-scheduled')
    assert.equal(retry.job.state, 'queued')
    assert.equal(retry.job.reasonClass, 'retryable')

    const nextDispatch = await prepararDespachoAutomaticoFalha(casa, {
      sessionId,
      executorId: 'host-model'
    })
    assert.equal(nextDispatch.result, 'dispatch-required')
    assert.notEqual(nextDispatch.delegation.id, dispatch.delegation.id)
    const restarted = await confirmarInicioAutomacaoFalha(casa, {
      sessionId,
      delegationId: nextDispatch.delegation.id,
      agentId: 'owner-boundary-agent'
    })
    assert.equal(restarted.result, 'started')
    assert.equal(restarted.job.attempts, 2)

    const repeatedStrategy = await bloquearAutomacaoFalha(
      casa,
      dispatch.job.id,
      'a mesma estratégia continuou sem localizar evidência',
      { kind: 'retryable', evidenceId: 'audit-evidence-local-2', strategy: 'buscar pelo id da sessao' }
    )
    assert.equal(repeatedStrategy.result, 'strategy-repeated')
    assert.equal(repeatedStrategy.job.state, 'running')

    await assert.rejects(
      bloquearAutomacaoFalha(
        casa,
        dispatch.job.id,
        'efeito vago não pode pedir o proprietário',
        { kind: 'owner-authority', effect: 'tool-error', target: 'alvo não classificado' }
      ),
      /taxonomia de autoridade/i
    )

    const owner = await bloquearAutomacaoFalha(
      casa,
      dispatch.job.id,
      'o proximo passo exige escrita em servico remoto',
      {
        kind: 'owner-authority',
        effect: 'remote-write',
        target: 'servico remoto fora do escopo atual'
      }
    )
    assert.equal(owner.result, 'needs-owner')
    assert.equal(owner.job.state, 'needs-owner')
    assert.match(owner.job.requiredEffectFingerprint, /^[a-f0-9]{64}$/)
    assert.match(owner.job.targetFingerprint, /^[a-f0-9]{64}$/)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('store v3 reabre bloqueio sem prova e preserva backup', async () => {
  const casa = await home()
  try {
    await candidate(casa, 'legacy-wall')
    const initial = await sincronizarAutomacaoFalhas(casa)
    const path = caminhoDaAutomacaoFalhas(casa)
    const legacy = structuredClone(initial)
    legacy.schemaVersion = 3
    legacy.jobs[0].state = 'blocked'
    legacy.jobs[0].attempts = 1
    legacy.jobs[0].reasonFingerprint = 'a'.repeat(64)
    for (const field of [
      'dispatchExpiresAt', 'dispatchSessionFingerprint', 'delegationId', 'authorityFingerprint',
      'legacyAttempts', 'startedAt', 'reasonClass', 'requiredEffectFingerprint', 'targetFingerprint',
      'nextAttemptAt', 'strategyFingerprints', 'stopBlocksIssued'
    ]) delete legacy.jobs[0][field]
    const raw = `${JSON.stringify(legacy, null, 2)}\n`
    await writeFile(path, raw, 'utf8')

    const migrated = await sincronizarAutomacaoFalhas(casa)
    assert.equal(migrated.schemaVersion, 4)
    assert.equal(migrated.jobs[0].state, 'queued')
    assert.equal(migrated.jobs[0].attempts, 0)
    assert.equal(migrated.jobs[0].legacyAttempts, 1)
    assert.equal(migrated.jobs[0].reasonClass, 'legacy-unverified')
    assert.equal(await readFile(`${path}.v3.backup`, 'utf8'), raw)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})
