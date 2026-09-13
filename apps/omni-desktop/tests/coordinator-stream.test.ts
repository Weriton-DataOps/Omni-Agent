import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CoordinatorTextStream, conciseNotice, partialReply } from '../src/main/coordinator-stream'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Options, query } from '@anthropic-ai/claude-agent-sdk'
import { Coordinator } from '../src/main/coordinator'
import { Store } from '../src/main/store'

const delta = (text: string, index = 0) => ({ type: 'stream_event', event: { type: 'content_block_delta', index, delta: { type: 'text_delta', text } } })
const messageStart = () => ({ type: 'stream_event', event: { type: 'message_start' } })

test('JSON parcial só expõe reply do nível principal, sem instrução ou campos internos', () => {
  assert.equal(partialReply('{"instruction":"segredo: \\"reply\\": \\"falso\\"", "reply":"Olá'), 'Olá')
  assert.equal(partialReply('{"nested":{"reply":"falso"},"reply":"Correto'), 'Correto')
  assert.equal(partialReply('{"other":[{"reply":"falso"},3],"reply":"Sim'), 'Sim')
  assert.equal(partialReply('{"action":"project","instruction":"Não exibir"'), null)
  assert.equal(partialReply('Vou pensar no próximo passo.'), null)
  assert.equal(partialReply('{"reply":null'), null)
})

test('escapes JSON fragmentados aguardam bytes suficientes e preservam quebras de linha', () => {
  const chunks = ['{"reply":"Ol', '\\u00', 'e1\\n', '\\uD83D', '\\uDE80', ' e fim"}']
  const visible: (string | null)[] = []
  let text = ''
  for (const chunk of chunks) { text += chunk; visible.push(partialReply(text)) }
  assert.deepEqual(visible, ['Ol', 'Ol', 'Olá\n', 'Olá\n', 'Olá\n🚀', 'Olá\n🚀 e fim'])
  assert.equal(partialReply('{"reply":"ok\\'), 'ok')
  assert.equal(partialReply('{"reply":"ok\\q'), null)
})

test('reply aparece nos deltas reais do StructuredOutput antes do resultado final', () => {
  const visible: string[] = []
  const stream = new CoordinatorTextStream(true, text => visible.push(text))
  stream.consume(delta('Pensamento intermediário que não é a resposta.'))
  stream.consume({ type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', name: 'StructuredOutput' } } })
  for (const partial_json of ['{"reply":"Vou conferir', ' a sessão.","instruction":"NÃO EXIBIR","action":"project"}']) {
    stream.consume({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json } } })
  }
  assert.deepEqual(visible, ['Vou conferir', 'Vou conferir a sessão.'])
  stream.finish('Outra formulação final, que não deve trocar o texto já lido.')
  assert.equal(visible.length, 2)
})

test('texto comum é acumulado em tempo real, sem duplicar blocos ou eco do result', () => {
  const visible: string[] = []
  const stream = new CoordinatorTextStream(false, text => visible.push(text))
  stream.consume(delta('Resultado'))
  assert.deepEqual(visible, ['Resultado'])
  stream.consume(delta(' verificado.'))
  stream.consume({ ...delta('IGNORAR'), parent_tool_use_id: 'subagent' })
  stream.finish('Resultado verificado.')
  assert.deepEqual(visible, ['Resultado', 'Resultado verificado.'])
  const fallback: string[] = []
  const withoutDeltas = new CoordinatorTextStream(false, text => fallback.push(text))
  withoutDeltas.finish('Retorno sem eventos parciais do provedor.')
  assert.deepEqual(fallback, ['Retorno sem eventos parciais do provedor.'])
})

test('saída JSON textual também mantém reply progressivo e não vaza chaves vizinhas', () => {
  const visible: string[] = []
  const stream = new CoordinatorTextStream(true, text => visible.push(text))
  stream.consume(delta('{"reply":"Primeira'))
  stream.consume(delta(' frase.","instruction":"NÃO EXIBIR"}'))
  assert.deepEqual(visible, ['Primeira', 'Primeira frase.'])
  assert.ok(conciseNotice('Um aviso operacional. '.repeat(40)).length <= 320)
})

test('nova mensagem do provedor continua o streaming sem congelar no primeiro prefixo', () => {
  const visible: string[] = []
  const stream = new CoordinatorTextStream(false, text => visible.push(text))
  stream.consume(messageStart()); stream.consume(delta('**Crachá'))
  stream.consume(messageStart()); stream.consume(delta('O acesso '))
  assert.equal(stream.text, '**Crachá\n\nO acesso ')
  stream.consume(delta('foi conferido e registrado.'))
  const aggregated = '**Crachá\n\nO acesso foi conferido e registrado.'
  assert.equal(stream.text, aggregated)
  const count = visible.length
  stream.finish('O acesso foi conferido e registrado.')
  stream.finish(aggregated)
  assert.equal(stream.text, aggregated); assert.equal(visible.length, count)
})

test('resultado final pode estender somente o último segmento sem apagar mensagens anteriores', () => {
  const visible: string[] = []
  const stream = new CoordinatorTextStream(false, text => visible.push(text))
  stream.consume(messageStart()); stream.consume(delta('Primeira mensagem.'))
  stream.consume(messageStart()); stream.consume(delta('Segunda mensagem'))
  stream.finish('Segunda mensagem concluída.')
  assert.equal(stream.text, 'Primeira mensagem.\n\nSegunda mensagem concluída.')
  stream.finish('Primeira mensagem.\n\nSegunda mensagem concluída.')
  assert.equal(visible.length, 3)
})

test('repetição idêntica do último texto não duplica o conteúdo já exibido', () => {
  const visible: string[] = []
  const stream = new CoordinatorTextStream(false, text => visible.push(text))
  stream.consume(messageStart()); stream.consume(delta('Primeira.'))
  stream.consume(messageStart()); stream.consume(delta('Segunda.'))
  stream.consume(messageStart()); stream.consume(delta('Seg')); stream.consume(delta('unda.'))
  stream.finish('Segunda.')
  assert.equal(stream.text, 'Primeira.\n\nSegunda.'); assert.equal(visible.length, 2)
})

test('novo message_start mantém planos estruturados isolados da concatenação textual', () => {
  const visible: string[] = []
  const stream = new CoordinatorTextStream(true, text => visible.push(text))
  stream.consume(messageStart()); stream.consume(delta('{"reply":"Vou conferir."}'))
  stream.consume(messageStart()); stream.consume(delta('{"reply":"Outro plano.","instruction":"NÃO EXIBIR"}'))
  stream.finish('Outro plano.')
  assert.deepEqual(visible, ['Vou conferir.'])
})

test('plano de execução fica oculto e a confirmação nasce apenas do subagente realmente vinculado', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-coord-stream-'))
  try {
    const store = new Store(dir); await store.load(); const origin = store.get(await store.create(dir))
    let release!: () => void
    const finalGate = new Promise<void>(resolve => { release = resolve })
    let firstDelta!: () => void
    const planning = new Promise<void>(resolve => { firstDelta = resolve })
    let dispatched = 0
    let done!: () => void
    const finished = new Promise<void>(resolve => { done = resolve })
    const fake = (async function* ({ options }: { options: Options }) {
      assert.equal(options.includePartialMessages, true)
      yield delta('{"reply":"Vou conferir o pedido.')
      firstDelta()
      await finalGate
      yield delta('","action":"local","sessionId":null,"instruction":"Conferir e demonstrar o resultado."}')
      yield { type: 'result', subtype: 'success', is_error: false, result: '', structured_output: { reply: 'Vou conferir o pedido.', action: 'local', sessionId: null, instruction: 'Conferir e demonstrar o resultado.' } }
    }) as unknown as typeof query
    const ports = { sessions: async () => [], relay: async () => {}, open: async () => origin.id, local: async (parent: string, _text: string, turnId: string) => {
      dispatched++; const id = await store.create(dir, 'task', parent); const child = store.get(id); child.originTurnId = turnId; child.title = 'Conferência local'; return id
    }, context: async () => 'Omni', executable: async () => 'test.exe' }
    const coordinator = new Coordinator(store, () => {
      if (origin.coordinationTurns?.[0]?.state === 'done') done()
    }, ports, fake)
    await coordinator.enqueue(origin, 'Confira o pedido', 'text')
    await planning
    assert.equal(dispatched, 0)
    assert.equal(origin.messages.length, 1)
    release(); await finished
    assert.equal(dispatched, 1)
    assert.equal(origin.messages.at(-1)!.streaming, false)
    assert.match(origin.messages.at(-1)!.text, /card Conferência local/)
    assert.doesNotMatch(origin.messages.at(-1)!.text, /Vou conferir o pedido|assumiu/)
    await store.save()
  } finally { await rm(dir, { recursive: true }) }
})

test('conversa usa deltas reais de uma resposta pública separada, sem reproduzir o plano', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-reply-stream-'))
  try {
    const store = new Store(dir); await store.load(); const origin = store.get(await store.create(dir))
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve })
    let firstText!: () => void; const first = new Promise<void>(resolve => { firstText = resolve })
    let done!: () => void; const finished = new Promise<void>(resolve => { done = resolve })
    let calls = 0
    const fake = (async function* ({ options }: { options: Options }) {
      calls++
      if (options.outputFormat) {
        yield delta('{"reply":"RASCUNHO INTERNO"}')
        yield { type: 'result', subtype: 'success', is_error: false, result: '', structured_output: { action: 'reply', reply: 'RASCUNHO INTERNO', sessionId: null, instruction: null } }
      } else {
        yield delta('Vamos organizar')
        await gate
        yield delta(' essa ideia.')
        yield { type: 'result', subtype: 'success', is_error: false, result: 'Vamos organizar essa ideia.' }
      }
    }) as unknown as typeof query
    const forbidden = async () => { throw new Error('Conversa não delega') }
    const coordinator = new Coordinator(store, () => {
      if (origin.messages.some(message => message.streaming && message.text === 'Vamos organizar')) firstText()
      if (origin.coordinationTurns?.[0]?.state === 'done') done()
    }, { sessions: async () => [], relay: forbidden, open: forbidden, local: forbidden, context: async () => 'Omni', executable: async () => 'test.exe' }, fake)
    await coordinator.enqueue(origin, 'Vamos conversar sobre organização', 'text')
    await first
    assert.equal(origin.messages.at(-1)!.text, 'Vamos organizar')
    assert.equal(origin.messages.at(-1)!.streaming, true)
    assert.equal(calls, 2)
    assert.equal(origin.messages.some(message => message.text.includes('RASCUNHO INTERNO')), false)
    release(); await finished
    assert.equal(origin.messages.at(-1)!.text, 'Vamos organizar essa ideia.')
    assert.equal(origin.messages.at(-1)!.streaming, false)
    await store.save()
  } finally { await rm(dir, { recursive: true }) }
})

test('síntese sob demanda entrega deltas reais antes de o modelo encerrar', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-summary-stream-'))
  try {
    const store = new Store(dir); await store.load(); const origin = store.get(await store.create(dir))
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve })
    let firstText!: () => void; const first = new Promise<void>(resolve => { firstText = resolve })
    const visible: string[] = []
    const fake = (async function* () {
      yield delta('O trabalho')
      await gate
      yield delta(' foi concluído.')
      yield { type: 'result', subtype: 'success', is_error: false, result: 'Outra formulação final não deve substituir o texto já lido.' }
    }) as unknown as typeof query
    const ports = { sessions: async () => [], relay: async () => {}, open: async () => origin.id, local: async () => 'child', context: async () => 'Omni', executable: async () => 'test.exe' }
    const coordinator = new Coordinator(store, () => {}, ports, fake)
    const pending = coordinator.summarize(origin, 'Pedido', 'Relato', 'completed', new AbortController(), text => { visible.push(text); firstText() })
    await first
    assert.deepEqual(visible, ['O trabalho'])
    release()
    assert.equal(await pending, 'O trabalho foi concluído.')
    assert.deepEqual(visible, ['O trabalho', 'O trabalho foi concluído.'])
  } finally { await rm(dir, { recursive: true }) }
})
