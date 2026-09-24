import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { abrirTurnoAuditoria } from '../runtime/auditoria-autocorrecao.mjs'
import {
  bloquearAutomacaoFalha,
  confirmarInicioAutomacaoFalha,
  prepararDespachoAutomaticoFalha
} from '../runtime/automacao-falhas.mjs'
import { registrarFalha } from '../runtime/falhas.mjs'

const home = () => mkdtemp(join(tmpdir(), 'omni-teto-tentativas-'))

async function candidate(casa, suffix) {
  const failure = { agent: 'omni', action: 'executar Bash', failureClass: 'permission', signature: `permissao negada ${suffix}` }
  for (let index = 1; index <= 3; index += 1) await registrarFalha(casa, { ...failure, evidenceId: `${suffix}-run-${index}` })
}

test('teto de tentativas escala para needs-owner em vez de girar sem fim', async () => {
  const casa = await home()
  const sessionId = 'sessao-teto'
  try {
    await candidate(casa, 'estrutural')
    await abrirTurnoAuditoria(casa, { session_id: sessionId, prompt: 'corrija falhas locais recorrentes' })

    const resultados = []
    let escalou = false
    for (let ciclo = 1; ciclo <= 8 && !escalou; ciclo += 1) {
      const prep = await prepararDespachoAutomaticoFalha(casa, { sessionId })
      if (prep.result !== 'dispatch-required') { resultados.push(`prep:${prep.result}`); break }
      await confirmarInicioAutomacaoFalha(casa, { sessionId, delegationId: prep.delegation.id, executorId: `exec-${ciclo}` })
      const bloqueio = await bloquearAutomacaoFalha(casa, prep.job.id, `bloqueio persistente ${ciclo}`, {
        kind: 'retryable', evidenceId: `evid-${ciclo}`, strategy: `estrategia-diferente-${ciclo}`
      })
      resultados.push(bloqueio.result)
      if (bloqueio.result === 'needs-owner') {
        escalou = true
        assert.equal(bloqueio.job.state, 'needs-owner')
        assert.equal(bloqueio.job.reasonClass, 'owner-authority')
        assert.equal(bloqueio.job.nextAttemptAt, null)
        assert.equal(bloqueio.reason, 'retryable-exhausted')
      }
    }

    assert.equal(escalou, true, `esperava escalada; sequencia: ${resultados.join(', ')}`)
    const retries = resultados.filter((r) => r === 'retry-scheduled').length
    assert.ok(retries >= 1 && retries <= 5, `retries fora do teto: ${retries} (${resultados.join(', ')})`)
    // Depois de needs-owner nao ha novo despacho automatico.
    const depois = await prepararDespachoAutomaticoFalha(casa, { sessionId })
    assert.notEqual(depois.result, 'dispatch-required')
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})
