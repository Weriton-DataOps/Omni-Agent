import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { diagnosticarRuntime } from '../runtime/diagnostico.mjs'
import { consultarCapacidadesOvercore } from '../runtime/overcore-task-flow.mjs'
import { abrirTurnoAuditoria, registrarAcaoAuditoria } from '../runtime/auditoria-autocorrecao.mjs'
import { verificarIntegridadeRelease } from '../runtime/integridade-release.mjs'
import { tratarHook } from '../runtime/hook-contexto.mjs'
import { caminhoDaAutomacaoFalhas, sincronizarAutomacaoFalhas } from '../runtime/automacao-falhas.mjs'
import { registrarFalha } from '../runtime/falhas.mjs'

async function ambiente() {
  const raiz = await mkdtemp(join(tmpdir(), 'omni-diagnostic-hook-'))
  return { raiz, env: { ...process.env, OMNI_HOME: join(raiz, 'omni-home'), CLAUDE_PLUGIN_DATA: join(raiz, 'plugin-data') } }
}

test('diagnostico legado cabe inteiro com personalidade e evidencias no hook real', async () => {
  const { raiz, env } = await ambiente()
  const session_id = 'sessao-diagnostico-legado'
  try {
    await tratarHook({ hook_event_name: 'UserPromptSubmit', session_id, prompt: '/omni:omni' }, env)
    for (let n = 0; n < 3; n++) await registrarFalha(env.OMNI_HOME, {
      agent: 'omni', action: 'executar Bash', failureClass: 'permission',
      signature: 'diagnostico legado sem recibo', evidenceId: `legacy-proof-${n}` })
    const store = await sincronizarAutomacaoFalhas(env.OMNI_HOME)
    Object.assign(store.jobs[0], { state: 'needs-owner', authorityFingerprint: 'a'.repeat(64),
      reasonClass: 'owner-authority', requiredEffectFingerprint: 'b'.repeat(64),
      targetFingerprint: 'c'.repeat(64), attempts: 6, strategyFingerprints: ['d'.repeat(64)] })
    await writeFile(caminhoDaAutomacaoFalhas(env.OMNI_HOME), JSON.stringify(store))
    const output = await tratarHook({ hook_event_name: 'UserPromptSubmit', session_id, prompt: 'continue o trabalho' }, env)
    const context = output.hookSpecificOutput.additionalContext
    assert.ok(context.length <= 9500)
    assert.match(context, /diagnóstico local somente leitura/)
    assert.match(context, /PERSONALIDADE omni-persona-v3-candidate/)
    assert.match(context, /<\/failure-dispatch-briefing>/)
  } finally { await rm(raiz, { recursive: true, force: true }) }
})

test('diagnostico canonico integro conta como leitura e comando anexado nao herda excecao', async () => {
  const home = await mkdtemp(join(tmpdir(), 'omni-diagnostic-audit-'))
  try {
    const root = fileURLToPath(new URL('../', import.meta.url))
    const integrity = await verificarIntegridadeRelease(root)
    const session = 'diagnostic-audit-test'
    await abrirTurnoAuditoria(home, { session_id: session, prompt: 'verifique estado' })
    const command = `powershell -NoProfile -ExecutionPolicy Bypass -File "${join(root, 'scripts', 'omni.ps1')}" diagnostico --sessao ${session}`
    const record = suffix => registrarAcaoAuditoria(home, { session_id: session,
      hook_event_name: 'PostToolUse', tool_use_id: `diagnostic-${suffix}`, tool_name: 'Bash',
      tool_input: { command: command + suffix } })
    assert.equal((await record('')).action.effect, integrity.status === 'verified' ? 'verification' : 'execution')
    assert.equal((await record('; Set-Content arquivo.txt alterado')).action.effect, 'mutation')
    assert.notEqual((await record(' | node -e "console.log(1)"')).action.effect, 'verification')
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('diagnostico sem store nao cria nada nem inventa sessao carregada', async () => {
  const home = await mkdtemp(join(tmpdir(), 'omni-diagnostic-'))
  try {
    const result = await diagnosticarRuntime(home, fileURLToPath(new URL('../', import.meta.url)), 'session-missing', {})
    assert.equal(result.loadedSession, null)
    assert.equal(result.failures.readOnly, true)
    assert.equal(result.overcore.status, 'unverified')
    assert.deepEqual(await readdir(home), [])
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('capacidade atual e prova de tarefa sao distintas; endpoint ausente continua desconhecido', async () => {
  let healthy = true
  const server = createServer((req, res) => {
    assert.equal(req.url, '/v1/capabilities')
    assert.equal(req.method, 'GET')
    assert.equal(req.headers.authorization, 'Bearer token-diagnostic-test-only')
    res.writeHead(healthy ? 200 : 404, { 'content-type': 'application/json' })
    res.end(JSON.stringify(healthy ? { service: 'overcore-task-manager', protocolVersion: 1,
      scope: 'runtime-capabilities-not-task-success', startedAt: new Date().toISOString(),
      capabilities: ['inspection-direct-entries-snapshot-and-tool-telemetry-v1', 'unknown-instruction'] } : {}))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const env = { OVERCORE_LOCAL_TOKEN: 'token-diagnostic-test-only', OVERCORE_URL: `http://127.0.0.1:${server.address().port}` }
    const result = await consultarCapacidadesOvercore(env)
    assert.equal(result.status, 'observed')
    assert.equal(result.provesTaskSuccess, false)
    assert.deepEqual(result.capabilities, ['inspection-direct-entries-snapshot-and-tool-telemetry-v1'])
    healthy = false
    assert.equal((await consultarCapacidadesOvercore(env)).status, 'unverified')
  } finally { await new Promise(resolve => server.close(resolve)) }
})
