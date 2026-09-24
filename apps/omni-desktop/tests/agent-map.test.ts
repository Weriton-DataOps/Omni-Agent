import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectSubagents, readSubagentMap } from '../src/main/subagent-map'
import { buildAgentMaps } from '../src/main/agent-maps'
const session = '11111111-1111-4111-8111-111111111111'
const at = '2026-09-15T10:00:00.000Z', later = '2026-09-15T10:02:00.000Z'
const record = (id: string, type: string, content: unknown, stop?: string): any => ({ uuid: id, type, timestamp: at, sessionId: session, agentId: 'child1', isSidechain: true, message: { content, stop_reason: stop } })
const owner = record('owner', 'user', 'Conferir o projeto.')
const tool = record('tool', 'assistant', [{ type: 'tool_use', name: 'Read', id: 'read', input: { secret: 'RAW_TOOL_SECRET' } }], 'tool_use')
const final = { ...record('final', 'assistant', [{ type: 'text', text: 'Resultado comprovado.' }], 'end_turn'), timestamp: later }
const call: any = { uuid: 'call', type: 'assistant', timestamp: at, message: { content: [{ type: 'tool_use', id: 'spawn', name: 'Agent', input: { description: 'Validar projeto', prompt: 'Objetivo autorizado', run_in_background: true } }] } }
const launch: any = { uuid: 'launch', type: 'user', timestamp: at, message: { content: [{ type: 'tool_result', tool_use_id: 'spawn', content: 'não exibir bruto' }] }, toolUseResult: { agentId: 'child1', status: 'async_launched' } }
test('mapa correlaciona título e pai reais; silêncio não encerra filho e end_turn encerra', () => {
  let node = projectSubagents(session, [call, launch], new Map([['child1', [owner, tool]]]))[0]
  assert.equal(node.title, 'Validar projeto'); assert.equal(node.parentId, `session:${session}`)
  assert.equal(node.state, 'running'); assert.equal(node.endedAt, undefined)
  node = projectSubagents(session, [call, launch], new Map([['child1', [owner, tool, final]]]))[0]
  assert.equal(node.state, 'completed'); assert.equal(node.result, 'Resultado comprovado.'); assert.equal(node.durationMs, 120000)
  assert.doesNotMatch(JSON.stringify(node), /RAW_TOOL_SECRET|não exibir bruto/)
})
test('filhos do mesmo workspace não cruzam sessões e raciocínio não aparece', () => {
  const thinking = record('think', 'assistant', [{ type: 'thinking', thinking: 'PRIVATE_REASONING' }])
  const wrong = { ...final, agentId: 'child2', sessionId: 'other' }
  const nodes = projectSubagents(session, [], new Map([['child1', [owner, thinking]], ['child2', [wrong]]]))
  assert.equal(nodes.length, 1); assert.equal(nodes[0].state, 'running')
  assert.doesNotMatch(JSON.stringify(nodes), /PRIVATE_REASONING|Resultado comprovado/)
})
test('contagem de tokens deduplica blocos da mesma mensagem e não inventa métricas ausentes', () => {
  const a = { ...tool, message: { ...tool.message, id: 'same-message', usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 100 } } }
  const b = { ...final, message: { ...final.message, id: 'same-message', usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 100 } } }
  assert.equal(projectSubagents(session, [], new Map([['child1', [owner, a, b]]]))[0].tokens, 130)
  const previousMessage = { ...a, uuid: 'earlier', message: { ...a.message, id: 'earlier-message' } }
  assert.equal(projectSubagents(session, [], new Map([['child1', [owner, previousMessage, a, b]]]))[0].tokens, 130, 'contexto de chamadas anteriores não é somado ao último uso')
  assert.equal(projectSubagents(session, [], new Map([['child1', [owner, final]]]))[0].tokens, undefined)
})
test('retomada posterior vence recibo antigo; falha e interrupção têm estados próprios', () => {
  const done = { ...launch, timestamp: later, toolUseResult: { agentId: 'child1', status: 'completed', totalTokens: 77 } }
  const resumed = { ...tool, timestamp: '2026-09-15T11:00:00Z' }
  assert.equal(projectSubagents(session, [call, done], new Map([['child1', [owner, final, resumed]]]))[0].state, 'running')
  const failed = { ...done, toolUseResult: { agentId: 'child1', status: 'failed' } }
  assert.equal(projectSubagents(session, [call, failed], new Map())[0].state, 'failed')
  const cancel = { ...record('cancel', 'user', '[Request interrupted by user]'), timestamp: later }
  assert.equal(projectSubagents(session, [], new Map([['child1', [owner, tool, cancel]]]))[0].state, 'interrupted')
})
test('subagente de subagente aponta para seu pai real', () => {
  const innerCall = { ...call, agentId: 'child1', sessionId: session }
  const innerLaunch = { ...launch, agentId: 'child1', sessionId: session, toolUseResult: { agentId: 'child2', status: 'async_launched' } }
  const nodes = projectSubagents(session, [call, launch], new Map([['child1', [owner, innerCall, innerLaunch]], ['child2', [{ ...owner, agentId: 'child2' }, { ...final, agentId: 'child2' }]]]))
  assert.equal(nodes.find(n => n.id.endsWith(':child2'))?.parentId, `agent:${session}:child1`)
})
test('leitor usa pasta da sessão, tolera append incompleto e não usa pasta global do projeto', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-agent-map-'))
  try {
    const parent = join(dir, `${session}.jsonl`)
    await mkdir(join(dir, session, 'subagents'), { recursive: true })
    await mkdir(join(dir, 'subagents'))
    await writeFile(join(dir, session, 'subagents', 'agent-child1.jsonl'), [owner, final].map(r => JSON.stringify(r)).join('\n') + '\n{')
    await writeFile(join(dir, 'subagents', 'agent-unrelated.jsonl'), JSON.stringify({ ...owner, agentId: 'unrelated' }))
    const nodes = await readSubagentMap(session, parent, [])
    assert.equal(nodes.length, 1); assert.equal(nodes[0].state, 'completed')
  } finally { await rm(dir, { recursive: true }) }
})
test('mapa Omni agrupa tarefas e filhos internos sem transformar sessões VS Code em filhos locais', () => {
  const central: any = { id: 'central', kind: 'central', title: 'Omni', phase: 'idle' }
  const task: any = { id: 'task', kind: 'task', title: 'Auditoria', phase: 'running', sessionId: session, parentConversationId: 'central' }
  const external: any = { id: 'external', kind: 'external', title: 'VS Code', sessionId: 'different' }
  const children = new Map([[session, projectSubagents(session, [call, launch], new Map([['child1', [owner, tool]]]))]])
  const maps = buildAgentMaps([central, task, external], children, new Map())
  const map = maps.find(m => m.conversationId === 'central')!
  assert.equal(map.nodes.length, 3); assert.equal(map.nodes[2].parentId, 'conversation:task')
  assert.equal(map.nodes[0].state, 'running'); assert.equal(maps.some(m => m.conversationId === 'external'), false)
})
