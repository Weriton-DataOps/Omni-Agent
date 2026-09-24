import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { NodeDocumentFingerprinter } from '../dist/adapters/node/node-document-fingerprinter.js'
import { buildHookTurnContext } from '../dist/application/build-turn-context/build-hook-context.js'
import { executarFluxoOvercore, contextoFluxosOvercore, observarFluxosOvercore, notificacaoFluxoOvercore } from '../runtime/overcore-task-flow.mjs'

test('configuração privada, contexto por turno e observação retomam a mesma tarefa sem executar a fila', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'omni-flow-runtime-'))
  const fp = new NodeDocumentFingerprinter(), calls = []
  const token = 'private-test-token-not-in-context'
  let request, done = false
  const server = createServer(async (req, res) => {
    calls.push(`${req.method} ${req.url}`)
    assert.equal(req.headers.authorization, `Bearer ${token}`)
    let response
    if (req.url === '/v1/preflight') {
      const parts = []; for await (const part of req) parts.push(part)
      const { draft } = JSON.parse(Buffer.concat(parts))
      request = { ...draft, requestId: 'request-runtime-test', idempotencyKey: draft.executionIdempotencyKey }
      response = { reportId: 'report-runtime-test', draftId: draft.draftId, draftRevision: draft.revision, draftFingerprint: fp.fingerprint(draft), status: 'ready', requiredDecisions: [], checks: [] }
    } else if (req.url.endsWith('/admit')) response = { reportId: 'report-runtime-test', taskId: 'task-runtime-test' }
    else response = { taskId: 'task-runtime-test', status: done ? 'succeeded' : 'running', request,
      result: done ? { resultId: 'result-runtime-test', taskId: 'task-runtime-test', requestId: request.requestId, requestFingerprint: fp.fingerprint(request), status: 'succeeded', summary: 'Verificado.', criteria: [], evidence: [] } : null }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(response))
  })
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const config = join(directory, 'Overcore'); await mkdir(config)
    await writeFile(join(config, 'runtime.json'), JSON.stringify({ host: '127.0.0.1', port: server.address().port }))
    await writeFile(join(config, 'client-private.json'), JSON.stringify({ schemaVersion: 1, localToken: token }))
    const env = { LOCALAPPDATA: directory }, session = 'owner-runtime-test'
    assert.equal(await contextoFluxosOvercore(directory, session, env, 'Bom dia, vamos conversar.'), null)
    assert.match(await contextoFluxosOvercore(directory, session, env, 'Peça ao Overcore uma inspeção.'), /PORTA DE TAREFAS/)
    const flow = await executarFluxoOvercore(directory, session, { operation: 'prepare', input: { objective: 'Inspecionar alvo declarado.', context: {}, discoveryAuthority: {}, availableExecutionAuthority: {} } }, 'turn-runtime-one', env)
    assert.equal(flow.notification.ownerUpdate,'report-change')
    const repeated=await executarFluxoOvercore(directory,session,{operation:'follow',flowId:flow.flowId},null,env)
    assert.equal(repeated.notification.ownerUpdate,'silent')
    const context = await contextoFluxosOvercore(directory, session, env)
    const assembled = buildHookTurnContext({ persona: null, projection: '', externalTasks: context + '\n' + 'Excesso auxiliar.'.repeat(1500) })
    assert.ok(assembled.characters <= 9500)
    assert.match(assembled.text, new RegExp(flow.flowId))
    assert.doesNotMatch(assembled.text, new RegExp(token))
    done = true
    const before = calls.length
    const [result] = await observarFluxosOvercore(directory, session, env)
    assert.equal(result.status, 'succeeded'); assert.equal(result.taskId, flow.taskId)
    assert.deepEqual(calls.slice(before), ['GET /v1/tasks/task-runtime-test'])
    await observarFluxosOvercore(directory, session, env)
    assert.equal(calls.length, before + 1, 'Resultado terminal em cache não reinicia polling')
    assert.deepEqual(await observarFluxosOvercore(directory, 'another-session', env), [])
    assert.ok(calls.every(call => !call.includes('work-once')))
  } finally {
    await new Promise(resolve => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
})

test('acompanhamento silencia horário/contador e sinaliza decisão ou resultado novo', () => {
  const running={taskId:'task-one',status:'running',checkedAt:'before',decisions:[]}
  assert.equal(notificacaoFluxoOvercore(running,{...running,checkedAt:'after',poll:9}).changed,false)
  const terminal={...running,status:'succeeded',result:{resultId:'result-one'}}
  assert.equal(notificacaoFluxoOvercore(running,terminal).changed,true)
  assert.equal(notificacaoFluxoOvercore(terminal,{...terminal,checkedAt:'later'}).ownerUpdate,'silent')
  assert.equal(notificacaoFluxoOvercore(running,{...running,status:'blocked',decisions:[{decisionId:'need-owner'}]}).changed,true)
})
