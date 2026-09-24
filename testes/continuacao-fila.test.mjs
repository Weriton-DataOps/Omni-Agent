import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tratarHook } from '../runtime/hook-contexto.mjs'
import { registrarFalha, analisarPadraoFalha, vinculoVerificacaoFalha, testarCorrecaoFalha, avaliarPadraoFalha } from '../runtime/falhas.mjs'
import { lerAutomacaoFalhas, concluirAutomacaoFalha } from '../runtime/automacao-falhas.mjs'
import { registrarAcaoAuditoria } from '../runtime/auditoria-autocorrecao.mjs'

test('successful primary tool continues queue after completed job, without duplicates or dispatch inside subagent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omni-queue-continuity-'))
  const env = { ...process.env, OMNI_HOME: join(root, 'home'), CLAUDE_PLUGIN_DATA: join(root, 'data') }
  const session_id = 'queue-continuity'
  const tool = id => ({ hook_event_name: 'PostToolUse', session_id, tool_name: 'Read', tool_use_id: id, tool_input: { file_path: 'test.txt' } })
  try {
    await tratarHook({ hook_event_name: 'UserPromptSubmit', session_id, prompt: '/omni:omni' }, env)
    await tratarHook({ hook_event_name: 'UserPromptSubmit', session_id, prompt: 'execute os testes locais e corrija suas falhas' }, env)
    for (const suffix of ['first', 'second']) for (let i = 0; i < 3; i++) {
      await registrarFalha(env.OMNI_HOME, { agent: 'omni', action: `executar teste ${suffix}`, failureClass: 'tool-error',
        signature: `test failure ${suffix}`, evidenceId: `${suffix}-${i}` })
    }
    const child = await tratarHook({ ...tool('child'), agent_id: 'child-agent', agent_type: 'executor' }, env)
    assert.doesNotMatch(child.hookSpecificOutput?.additionalContext ?? '', /failure-dispatch-required/)
    const first = await tratarHook(tool('primary-one'), env)
    assert.match(first.hookSpecificOutput.additionalContext, /failure-dispatch-required/)
    const pending = await tratarHook(tool('primary-two'), env)
    assert.doesNotMatch(pending.hookSpecificOutput.additionalContext, /failure-dispatch-required/)
    let jobs = (await lerAutomacaoFalhas(env.OMNI_HOME)).jobs
    const job = jobs.find(j => j.dispatchState === 'requested')
    assert.equal(jobs.filter(j => j.dispatchState === 'requested').length, 1)
    await tratarHook({ hook_event_name: 'SubagentStart', session_id, agent_id: 'actual-executor', delegation_id: job.delegationId }, env)
    const busy = await tratarHook(tool('primary-busy'), env)
    assert.doesNotMatch(busy.hookSpecificOutput.additionalContext, /failure-dispatch-required/)
    const analysis = await analisarPadraoFalha(env.OMNI_HOME, job.patternId, { rootCause: 'test fixture dependency unavailable', hypothesis: 'verify dependency readiness first' })
    const binding = vinculoVerificacaoFalha(analysis.pattern, job.id)
    for (let i = 0; i < 2; i++) {
      const evidence = await registrarAcaoAuditoria(env.OMNI_HOME, { ...tool(`verified-${i}`), tool_name: 'Bash',
        tool_input: { command: `node --test test.mjs # omni-failure-binding:${binding}` } })
      await testarCorrecaoFalha(env.OMNI_HOME, job.patternId, { auditActionId: evidence.action.id,
        automationJobId: job.id, criterion: 'dependency responds and test exits successfully' })
    }
    assert.equal((await avaliarPadraoFalha(env.OMNI_HOME, job.patternId)).result, 'passed')
    assert.equal((await concluirAutomacaoFalha(env.OMNI_HOME, job.id, 'test-fixture-proof')).result, 'completed')
    const next = await tratarHook(tool('completion-readback'), env)
    assert.match(next.hookSpecificOutput.additionalContext, /failure-dispatch-required/)
    jobs = (await lerAutomacaoFalhas(env.OMNI_HOME)).jobs
    assert.equal(jobs.filter(j => j.state === 'completed').length, 1)
    assert.equal(jobs.filter(j => j.dispatchState === 'requested').length, 1)
    assert.notEqual(jobs.find(j => j.dispatchState === 'requested').id, job.id)
  } finally { await rm(root, { recursive: true, force: true }) }
})
