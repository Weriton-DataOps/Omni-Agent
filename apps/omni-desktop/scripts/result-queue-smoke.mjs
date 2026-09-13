import { chromium } from 'playwright'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

// Source renderer + fake IPC only: no build, live agent or private history is used.
const appPath = resolve(import.meta.dirname, '..')
const server = await createServer({
  configFile: false,
  root: resolve(appPath, 'src/renderer'),
  plugins: [react()],
  server: { host: '127.0.0.1', port: 0 }
})
await server.listen()
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1320, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    const central = {
      id: 'central', title: 'Chat central', primary: true, kind: 'central', phase: 'idle',
      workspace: '.', sessionId: null, events: [], coordinationTurns: [],
      messages: [
        { id: 'editor:central', role: 'user', text: 'Confira a publicação e finalize as pendências do projeto.', at: '', channel: 'text' },
        { id: 'coord:1', role: 'assistant', text: 'A verificação encontrou um ajuste no manifesto. Encaminhei a correção e a conferência da versão publicada. O retorno completo fica no card até você recebê-lo.', at: '', channel: 'text' }
      ]
    }
    const project = { ...central, id: 'project', title: 'VS Code · Projeto', primary: false, kind: 'external', sessionId: 'editor', messages: [
      { id: 'editor-forwarded:editor:central', role: 'assistant', origin: 'omni', author: 'Omni · encaminhamento', requestId: 'editor:central', text: 'Pedido encaminhado pelo Omni.\n\nConfira a publicação e finalize as pendências do projeto.', at: '', channel: 'text' },
      { id: 'editor-ack:editor:central', role: 'assistant', origin: 'omni', text: 'Pedido registrado para a sessão do projeto; aguardando confirmação de recebimento. O acompanhamento e o retorno ficam neste chat.', at: '', channel: 'text' }
    ], editorRequests: [
      { id: 'editor:central', originConversationId: 'central', deliveryConversationId: 'project', text: 'Confira a publicação pedida na central.', status: 'reported', at: '', targetName: 'Projeto' },
      { id: 'editor:project', originConversationId: 'project', deliveryConversationId: 'project', text: 'Confira a validação pedida no projeto.', status: 'reported', at: '', targetName: 'Projeto' },
      { id: 'legacy', originConversationId: 'central', text: 'Pedido anterior sem campo de destino.', status: 'completed', at: '', targetName: 'Projeto' }
    ] }
    const snapshot = {
      conversations: [central, project], permissions: [],
      state: { broker: 'ready', voice: false, synchronization: 'Conectado', activities: [
        { id: 'ready', source: 'omni', status: 'ready', title: 'Publicação conferida', detail: 'Retorno pronto', conversationId: 'task-1', parentConversationId: 'central', outcome: 'completed' },
        { id: 'active', source: 'omni', status: 'running', title: 'Conferência do manifesto', detail: 'Em execução', conversationId: 'task-2', parentConversationId: 'central' },
        { id: 'editor', source: 'vscode', status: 'ready', title: 'VS Code · Projeto', conversationId: 'project', sessionId: 'editor', workspace: '.' },
        { id: 'overcore', source: 'overcore', status: 'unavailable', title: 'Overcore · Sessão offline', detail: 'Sessão desconectada', conversationId: 'overcore-run' }
      ] },
      results: [
        { id: 'task:1', title: 'Publicação conferida', source: 'omni', originConversationId: 'central', deliveryConversationId: 'central', conversationId: 'task-1', state: 'ready' },
        { id: 'task:2', title: 'Conferência do manifesto', source: 'omni', originConversationId: 'central', deliveryConversationId: 'central', conversationId: 'task-2', state: 'working' },
        { id: 'editor:central', title: 'Publicação pedida pela central', source: 'vscode', originConversationId: 'central', deliveryConversationId: 'project', conversationId: 'project', state: 'ready' },
        { id: 'editor:project', title: 'Validação pedida no projeto', source: 'vscode', originConversationId: 'project', deliveryConversationId: 'project', conversationId: 'project', state: 'ready' },
        { id: 'overcore:1', title: 'Conferência da sessão desconectada', source: 'overcore', originConversationId: 'central', deliveryConversationId: 'central', conversationId: 'overcore-run', state: 'ready' }
      ]
    }
    let change = () => {}
    const notify = () => change(structuredClone(snapshot))
    const resultById = id => snapshot.results.find(result => result.id === id)
    const destinationOf = result => snapshot.conversations.find(conversation => conversation.id === result.deliveryConversationId)
    const messageId = result => result.source === 'omni' ? 'report:' + result.conversationId : 'editor-report:' + result.id
    const queues = new Map()
    window.resultFixture = { failNextRelease: true, releaseCalls: [], started: [] }
    const begin = result => {
      window.resultFixture.started.push(result.id)
      const destination = destinationOf(result)
      destination.messages = destination.messages.filter(message => message.id !== messageId(result))
      // Editor delivery first prepares the response without a placeholder message.
      if (result.source !== 'vscode') destination.messages.push({ id: messageId(result), role: 'assistant', text: result.id === 'task:1' ? '' : 'Retorno de ' + result.title, at: '', channel: 'text', streaming: true })
    }
    const advance = result => {
      const queue = queues.get(result.deliveryConversationId) || []
      queue.shift()
      if (queue.length) begin(resultById(queue[0]))
    }
    window.omni = {
      snapshot: async () => structuredClone(snapshot),
      onChange: callback => { change = callback; return () => {} },
      acknowledgeReturns: async () => {},
      openVsCodeWorkspace: async () => 'project',
      releaseResult: async id => {
        window.resultFixture.releaseCalls.push(id)
        if (window.resultFixture.failNextRelease) {
          window.resultFixture.failNextRelease = false
          throw new Error('Falha temporária de entrega. Tente novamente.')
        }
        const result = resultById(id)
        result.state = 'delivering'
        const queue = queues.get(result.deliveryConversationId) || []
        queues.set(result.deliveryConversationId, queue)
        queue.push(id)
        if (queue.length === 1) begin(result)
        notify()
        return result.deliveryConversationId
      }
    }
    window.resultFixture.append = (id, text) => {
      const result = resultById(id)
      const destination = destinationOf(result)
      const message = destination.messages.find(message => message.id === messageId(result))
      if (message) message.text = text
      else destination.messages.push({ id: messageId(result), role: 'assistant', text, at: '', channel: 'text', streaming: true })
      notify()
    }
    window.resultFixture.failDelivery = id => {
      const result = resultById(id)
      const destination = destinationOf(result)
      const message = destination.messages.find(item => item.id === messageId(result))
      message.streaming = false
      message.interrupted = true
      destination.messages.push({ id: 'delivery-error', role: 'assistant', text: 'A síntese falhou. Preservei o relato e deixei o retorno disponível para tentar novamente.', at: '', channel: 'text' })
      result.state = 'ready'
      advance(result)
      notify()
    }
    window.resultFixture.finish = id => {
      const result = resultById(id)
      const destination = destinationOf(result)
      const message = destination.messages.find(item => item.id === messageId(result))
      message.streaming = false
      message.interrupted = false
      snapshot.results = snapshot.results.filter(item => item.id !== id)
      if (result.source === 'omni') snapshot.state.activities = snapshot.state.activities.filter(activity => activity.conversationId !== result.conversationId)
      const request = destination.editorRequests?.find(item => item.id === id)
      if (request) request.status = 'completed'
      advance(result)
      notify()
    }
  })
  await page.goto(server.resolvedUrls.local[0])
  await page.locator('.activity-card-returns').first().waitFor()
  assert.equal(await page.locator('.activity-card-return').count(), 4)
  assert.equal(await page.locator('.result-queue, .result-ticket, .composer-area .receive-result, input[type="checkbox"]').count(), 0)
  assert.equal(await page.locator('.request-tracker').count(), 0)
  const local = page.locator('.activity-card').filter({ has: page.locator('.activity.source-omni.ready') })
  const editor = page.locator('.activity-card').filter({ has: page.locator('.activity.source-vscode') })
  const offline = page.locator('.activity-card').filter({ has: page.locator('.activity.source-overcore') })
  assert.equal(await local.locator('.receive-result').count(), 1)
  assert.equal(await editor.locator('.activity-card-return').count(), 2)
  await editor.getByText('Publicação pedida pela central', { exact: true }).waitFor()
  await editor.getByText('Validação pedida no projeto', { exact: true }).waitFor()
  assert.equal(await offline.locator('.activity').isDisabled(), true)
  assert.equal(await offline.locator('.receive-result').isEnabled(), true)
  const background = await page.locator('.messages').evaluate(element => {
    const style = getComputedStyle(element)
    return { image: style.backgroundImage, attachment: style.backgroundAttachment, size: style.backgroundSize }
  })
  assert.match(background.image, /omni-chat-illustration/)
  assert.equal(background.attachment, 'scroll, scroll')
  assert.match(background.size, /contain/)
  await editor.locator('.activity').click()
  await page.locator('.chat-context').filter({ hasText: 'VS Code · Projeto' }).waitFor()
  const forwarded = page.locator('article.assistant').filter({ has: page.locator('.speaker').getByText('Omni · encaminhamento', { exact: true }) })
  await forwarded.getByText('Pedido encaminhado pelo Omni.', { exact: true }).waitFor()
  await forwarded.getByText('Confira a publicação e finalize as pendências do projeto.', { exact: true }).waitFor()
  assert.equal(await page.locator('.messages article.user').count(), 0)
  assert.deepEqual(await page.evaluate(async () => {
    const message = (await window.omni.snapshot()).conversations.find(item => item.id === 'project').messages[0]
    return { id: message.id, role: message.role, origin: message.origin, author: message.author }
  }), { id: 'editor-forwarded:editor:central', role: 'assistant', origin: 'omni', author: 'Omni · encaminhamento' })
  await page.getByText('Pedido registrado para a sessão do projeto; aguardando confirmação de recebimento. O acompanhamento e o retorno ficam neste chat.', { exact: true }).waitFor()
  assert.doesNotMatch(await page.locator('.messages').innerText(), /sessão assumiu/i)
  assert.equal(await page.locator('.request-tracker .request-progress').count(), 3)
  const activeCard = page.locator('.activity.source-omni.running')
  assert.equal(await activeCard.isEnabled(), true)
  assert.equal(await activeCard.getAttribute('aria-disabled'), null)
  await activeCard.click()
  await page.locator('.chat-context').filter({ hasText: 'Omni · Chat central' }).waitFor()
  assert.equal(await page.locator('.request-tracker').count(), 0)
  assert.deepEqual(await page.evaluate(() => window.resultFixture.releaseCalls), [])
  const input = page.getByRole('textbox', { name: 'Mensagem para o Omni' })
  await input.fill('Meu próximo comando continua aqui.')
  await local.getByRole('button', { name: 'Receber retorno: Publicação conferida', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Falha temporária' }).waitFor()
  assert.equal(await local.locator('.receive-result').isEnabled(), true)
  await local.locator('.activity').click()
  await page.locator('.report-delivery.writing').waitFor({ state: 'attached' })
  await page.locator('.thinking-indicator').waitFor()
  assert.equal(await page.locator('.thinking-ring').evaluate(e => getComputedStyle(e).animationName), 'thinking-spin')
  assert.equal(await page.locator('.report-delivery .message-text').count(), 0)
  await page.evaluate(() => window.resultFixture.append('task:1', '**Crachá'))
  assert.equal(await page.locator('.report-delivery strong').innerText(), 'Crachá')
  assert.equal(await page.locator('.report-delivery .message-text').innerText(), 'Crachá')
  assert.equal(await page.locator('.thinking-ring').count(), 1)
  assert.equal(await input.inputValue(), 'Meu próximo comando continua aqui.')
  assert.equal(await local.locator('.receive-result').isDisabled(), true)
  await page.evaluate(() => window.resultFixture.append('task:1', '**Crachá** conferido. Manifesto alinhado e teste concluído.'))
  assert.equal(await page.locator('.report-delivery .message-text').innerText(), 'Crachá conferido. Manifesto alinhado e teste concluído.')
  assert.equal(await page.locator('.report-delivery .message-text p').evaluate(e => getComputedStyle(e, '::after').content), 'none')
  assert.equal(await page.locator('.report-delivery .message-text').getAttribute('aria-busy'), 'true')
  await mkdir(resolve(appPath, 'out'), { recursive: true })
  await page.screenshot({ path: resolve(appPath, 'out/result-queue-smoke.png') })
  await page.evaluate(() => window.resultFixture.failDelivery('task:1'))
  await page.getByText('Entrega interrompida · disponível para retomar', { exact: true }).waitFor()
  assert.equal(await page.locator('.report-delivery.delivered, .message-text.streaming').count(), 0)
  await page.getByText('A síntese falhou. Preservei o relato e deixei o retorno disponível para tentar novamente.', { exact: true }).waitFor()
  await local.locator('.receive-result').click()
  await page.locator('.report-delivery.writing').waitFor({ state: 'attached' })
  await page.evaluate(() => window.resultFixture.append('task:1', 'Crachá conferido.'))
  await page.evaluate(() => window.resultFixture.finish('task:1'))
  await page.locator('.report-delivery.delivered').waitFor()
  await page.locator('.thinking-indicator').waitFor({ state: 'detached' })
  assert.equal(await page.locator('.message-text.streaming').count(), 0)
  assert.equal(await page.locator('.activity-card-return').count(), 3)
  await editor.getByRole('button', { name: 'Receber retorno: Publicação pedida pela central', exact: true }).click()
  await page.locator('.chat-context').filter({ hasText: 'VS Code · Projeto' }).waitFor()
  await page.locator('.thinking-indicator').waitFor()
  assert.equal(await page.locator('.report-delivery .message-text').count(), 0)
  assert.equal(await page.locator('.request-tracker .request-progress').count(), 3)
  await page.locator('.current-conversation').click()
  await page.locator('.chat-context').filter({ hasText: 'Omni · Chat central' }).waitFor()
  assert.equal(await page.locator('.thinking-indicator, .request-tracker').count(), 0)
  assert.equal(await page.evaluate(async () => (await window.omni.snapshot()).conversations.find(item => item.id === 'central').messages.some(message => message.id.startsWith('editor-report:'))), false)
  await editor.locator('.activity').click()
  await page.locator('.thinking-indicator').waitFor()
  await input.fill('Rascunho no projeto preservado entre retornos.')
  await editor.getByRole('button', { name: 'Receber retorno: Validação pedida no projeto', exact: true }).click()
  assert.equal(await input.inputValue(), 'Rascunho no projeto preservado entre retornos.')
  assert.equal(await page.evaluate(() => window.resultFixture.started.includes('editor:project')), false)
  assert.equal(await editor.locator('.receive-result:disabled').count(), 2)
  await page.evaluate(() => window.resultFixture.append('editor:central', 'Retorno de Publicação pedida pela central: versão publicada e conferida.'))
  await page.getByText('Retorno de Publicação pedida pela central: versão publicada e conferida.', { exact: true }).waitFor()
  assert.equal(await page.locator('.report-delivery.writing').count(), 1)
  assert.equal(await page.locator('.message-text.streaming').count(), 1)
  await page.screenshot({ path: resolve(appPath, 'out/result-destination-smoke.png') })
  await page.evaluate(() => window.resultFixture.finish('editor:central'))
  await page.locator('.message-text.streaming').waitFor({ state: 'detached' })
  await page.locator('.thinking-indicator').waitFor()
  assert.equal(await page.evaluate(() => window.resultFixture.started.includes('editor:project')), true)
  await page.evaluate(() => window.resultFixture.append('editor:project', 'Retorno de Validação pedida no projeto: testes concluídos.'))
  await page.getByText('Retorno de Validação pedida no projeto: testes concluídos.', { exact: true }).waitFor()
  assert.equal(await page.locator('.report-delivery.writing').count(), 1)
  assert.equal(await page.locator('.message-text.streaming').count(), 1)
  await page.evaluate(() => window.resultFixture.finish('editor:project'))
  await page.locator('.thinking-indicator').waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(async () => (await window.omni.snapshot()).conversations.find(item => item.id === 'central').messages.some(message => message.id.startsWith('editor-report:'))), false)
  assert.equal(await page.evaluate(async () => (await window.omni.snapshot()).conversations.find(item => item.id === 'project').messages.filter(message => message.id.startsWith('editor-report:')).length), 2)
  await page.locator('.current-conversation').click()
  await page.locator('.chat-context').filter({ hasText: 'Omni · Chat central' }).waitFor()
  await input.fill('Rascunho preservado ao receber da sessão offline.')
  await offline.locator('.receive-result').click()
  await page.getByText('Retorno de Conferência da sessão desconectada', { exact: true }).waitFor()
  assert.equal(await input.inputValue(), 'Rascunho preservado ao receber da sessão offline.')
  await page.evaluate(() => window.resultFixture.finish('overcore:1'))
  await page.locator('.activity-card-return').waitFor({ state: 'detached' })
  assert.deepEqual(await page.evaluate(() => window.resultFixture.releaseCalls), ['task:1', 'task:1', 'task:1', 'editor:central', 'editor:project', 'overcore:1'])
  assert.deepEqual(errors, [])
  console.log('PASS: VS Code return and tracker follow its card chat, including central-origin requests; shared-destination delivery serializes with no central spinner/report; manual cards, offline access, retry, streaming and drafts preserved.')
} finally {
  await browser.close()
  await server.close()
}
