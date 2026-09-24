// Actual renderer + preload + main IPC registration. Only external adapters are isolated.
import { _electron as electron } from 'playwright'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, cp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
const appPath = resolve(import.meta.dirname, '..'), root = resolve(appPath, '../..')
const directory = await mkdtemp(join(appPath, 'out/returns-ui-'))
const home = join(directory, 'data'), cwd = join(directory, 'project')
await mkdir(cwd, { recursive: true })
await build({ entryPoints: ['src/main/store.ts', 'src/main/result-delivery.ts'], absWorkingDir: appPath, outdir: join(directory, 'helpers'), outExtension: { '.js': '.mjs' }, bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'error' })
const { Store } = await import(pathToFileURL(join(directory, 'helpers/store.mjs')))
const { ResultDeliveryQueue } = await import(pathToFileURL(join(directory, 'helpers/result-delivery.mjs')))
const store = new Store(join(home, 'desktop')); await store.load()
const central = store.get(await store.create(cwd)); central.primary = true
const current = store.get(await store.create(cwd, 'external')), previous = store.get(await store.create(cwd, 'external')), forwarded = store.get(await store.create(cwd, 'external'))
const sessions = [current, previous, forwarded].map((c, i) => {
  c.host = 'vscode'; c.sessionId = randomUUID(); c.editorProjectionVersion = 2; c.title = ['VS Code · Atual', 'VS Code · Anterior', 'VS Code · Encaminhado'][i]
  return { sessionId: c.sessionId, name: ['atual-test', 'anterior-test', 'encaminhado-test'][i], cwd, address: 'uds:test-only', pid: process.pid }
})
const makeReturn = (c, title, at) => { const evidence = randomUUID(); return { id: `editor-response:${c.sessionId}:${evidence}`, sessionId: c.sessionId, evidenceId: evidence, turnId: randomUUID(), at, objective: title, report: title + ' — evidência sintética', deliveryState: 'ready' } }
current.editorReturn = makeReturn(current, 'Resultado atual correto', '2026-09-14T17:53:00.000Z')
const legacyId = randomUUID()
const imageId = randomUUID()
const imageDirectory = join(home, 'desktop', 'attachments', current.id)
await mkdir(imageDirectory, { recursive: true })
await writeFile(join(imageDirectory, imageId + '.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64'))
current.messages.push({ id: randomUUID(), role: 'user', text: '', channel: 'text', at: '', attachments: [{ id: imageId, kind: 'image', name: 'teste.png', mime: 'image/png', size: 68 }] })
current.editorRequests = [{ id: legacyId, at: '2026-09-14T12:00:00.000Z', text: 'Retorno do pedido encaminhado', status: 'completed', report: 'Relato do pedido', deliveryState: 'ready' }]
previous.editorReturn = makeReturn(previous, 'Resultado anterior preservado', '2026-09-14T13:00:00.000Z')
previous.editorRequests = [{ id: randomUUID(), at: '2026-09-14T15:00:00.000Z', text: 'Pedido ainda aguardando', status: 'received', originConversationId: previous.id, targetSessionId: previous.sessionId }]
const forwardedId = randomUUID()
forwarded.editorRequests = [{ id: forwardedId, at: '2026-09-14T18:10:00.000Z', text: 'Resultado encaminhado correto', status: 'completed', report: 'Relato encaminhado', evidenceId: randomUUID(), deliveryState: 'ready', deliveryConversationId: forwarded.id }]
const summary = title => '## Resultado\n\n' + title + '\n\n## Evidência\n\n' + 'Verificação sintética do fluxo da sessão, sem ação externa. '.repeat(18) + '\n\n## Situação final\n\nResumo pronto antes do clique.'
const queue = new ResultDeliveryQueue(store, async (_c, title) => summary(title), () => {}, new Map())
await queue.prepare(current.editorReturn.id); await queue.prepare(previous.editorReturn.id); await queue.prepare(legacyId); await queue.prepare(forwardedId); await store.save()
const runtime = `export const home=${JSON.stringify(home)}, root=${JSON.stringify(root)};
export const startRuntime=async()=>{}, voiceAvailable=async()=>false;
export const broker=async()=>({health:async()=>({status:'ready'}),listActiveMissions:async()=>[]});
export const executionBroker=broker;
export const moduleAt=async()=>({lerMemoria:async()=>({confirmed:[],candidates:[]}),sincronizarMemoriaDuravel:async()=>{},sincronizarMissoesDuraveis:async()=>{},sincronizarAprendizadoOperacional:async()=>{}});
export const claudeExecutable=async()=>{throw Error('Modelo não permitido no teste')};
export const mintVoiceToken=claudeExecutable, transcribeAudio=claudeExecutable;`
const editors = `export const sameWorkspace=(a,b)=>a.toLowerCase()===b.toLowerCase();
export const editorSessions=async()=>globalThis.__testOffline?[]:${JSON.stringify(sessions)};
export const readEditor=async session=>({messages:[],observations:[],relayInbox:[],execution:{state:session.sessionId===${JSON.stringify(current.sessionId)} && !globalThis.__testFinished?'running':'idle'},subagents:session.sessionId===${JSON.stringify(current.sessionId)}?Array.from({length:5},(_,i)=>({id:'agent:'+session.sessionId+':child'+i,parentId:'session:'+session.sessionId,title:'Verificação '+(i+1),state:i===0&&!globalThis.__testFinished?'running':'completed',objective:'Objetivo de teste '+(i+1),result:'Resultado do filho '+(i+1),tokens:1234+i,tokenScope:'last-call',model:'Modelo de teste',durationMs:65000+i,startedAt:'2026-09-15T10:00:00Z',evidenceId:'evidence-'+i})):[]});
export const editorHistory=async()=>[];
export const relayToEditor=async()=>{globalThis.__testRelays=(globalThis.__testRelays||0)+1};`
const harness = join(directory, 'app')
await build({ entryPoints: ['src/main/index.ts'], absWorkingDir: appPath, outfile: join(harness, 'main/index.js'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'error', plugins: [{ name: 'isolated-adapters', setup(b) {
  b.onResolve({ filter: /^\.\/runtime$/ }, () => ({ path: 'runtime', namespace: 'fixture' }))
  b.onResolve({ filter: /^\.\/vscode-sessions$/ }, () => ({ path: 'editors', namespace: 'fixture' }))
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'runtime' ? runtime : editors, loader: 'js' }))
} }] })
await cp(join(appPath, 'out/preload'), join(harness, 'preload'), { recursive: true })
await cp(process.env.OMNI_TEST_RENDERER_DIR || join(appPath, 'out/renderer'), join(harness, 'renderer'), { recursive: true })
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS
const app = await electron.launch({ executablePath: require('electron'), args: [join(harness, 'main/index.js')], env, timeout: 30000 })
try {
  const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message))
  const card = name => page.locator('button.activity.source-vscode').filter({ hasText: name })
  const currentCard = card('atual-test'), previousCard = card('anterior-test'), forwardedCard = card('encaminhado-test')
  await currentCard.waitFor(); await previousCard.waitFor(); await forwardedCard.waitFor()
  const composerOnly = process.argv.includes('--composer')
  let initialLength = 0, elapsed = 0
  if (!composerOnly) {
  assert.equal(await page.locator('.receive-result, .activity-card-returns').count(), 0, 'nenhum botão ou lista de retornos')
  assert.match(await currentCard.getAttribute('class'), /running/)
  assert.equal(await currentCard.locator('.activity-return').count(), 0)
  const runningStyle = await currentCard.locator('.activity-status').evaluate(el => ({ animation: getComputedStyle(el).animationName, color: getComputedStyle(el).backgroundColor }))
  assert.equal(runningStyle.animation, 'activity-breathe')
  await currentCard.click()
  assert.equal(await page.locator('.quick-reveal').count(), 0, 'azul abre chat sem entregar resposta anterior')
  assert.equal(await page.locator('.thinking-indicator').count(), 0)
  await app.evaluate(() => { globalThis.__testFinished = true })
  await currentCard.locator('.activity-return').waitFor({ timeout: 15000 })
  const mapTrigger = page.getByRole('button', { name: /Mapa de agentes: .*atual-test/ })
  assert.equal(await mapTrigger.innerText(), '⑂', 'o card mostra apenas o símbolo azul do mapa')
  await mapTrigger.click()
  const mapDialog = page.getByRole('dialog', { name: 'Mapa de agentes' })
  await mapDialog.waitFor()
  assert.equal(await mapDialog.locator('.agent-node').count(), 6)
  await mapDialog.getByRole('button', { name: /Verificação 3/ }).click()
  assert.match(await mapDialog.locator('.agent-map-details').innerText(), /Objetivo de teste 3/)
  assert.match(await mapDialog.locator('.agent-map-details').innerText(), /Resultado do filho 3/)
  assert.equal(await currentCard.locator('.activity-return').count(), 1, 'mapa não consome resumo')
  assert.equal((await page.evaluate(() => window.omni.snapshot())).conversations.find(c => c.id === current.id).messages.filter(m => /^editor-response:/.test(m.id)).length, 0)
  await page.screenshot({ path: join(directory, 'agent-map.png') })
  await page.keyboard.press('Escape')
  await mapDialog.waitFor({ state: 'detached' })
  assert.equal(await mapTrigger.evaluate(el => document.activeElement === el), true, 'foco retorna ao card')
  const greenStyle = await currentCard.locator('.activity-return').evaluate(el => ({ animation: getComputedStyle(el).animationName, color: getComputedStyle(el).backgroundColor }))
  assert.equal(greenStyle.animation, 'none'); assert.notEqual(greenStyle.color, runningStyle.color)
  const start = Date.now()
  await currentCard.click()
  await page.locator('.quick-reveal').waitFor()
  await page.waitForFunction(() => (document.querySelector('.quick-reveal')?.textContent?.length || 0) > 20)
  initialLength = (await page.locator('.quick-reveal').innerText()).length
  assert.ok(initialLength < summary('Resultado atual correto').length / 2, 'não exibe tudo de uma vez')
  // The intended smooth upward glide and type-on start together. Only compare
  // anchoring after that glide settles; comparing its first/last frames tests
  // the animation itself as a defect. Keep the early reveal assertion above.
  await page.waitForFunction(() => {
    const container = document.querySelector('.messages')
    const target = container?.querySelector('.quick-reveal')?.closest('article')
    if (!container || !target) return false
    const top = target.getBoundingClientRect().top - container.getBoundingClientRect().top
    const before = window.__testRevealScroll
    const at = performance.now()
    if (!before || Math.abs(before.top - top) >= 1) { window.__testRevealScroll = { top, at }; return false }
    return at - before.at > 120 && top >= 0 && top < container.clientHeight
  }, undefined, { timeout: 2000 })
  const pinnedTop = await page.locator('.messages').evaluate((container) => {
    const reveal = container.querySelector('.quick-reveal')?.closest('article')
    return reveal ? reveal.getBoundingClientRect().top - container.getBoundingClientRect().top : null
  })
  await page.waitForTimeout(250)
  const pinnedTopAfterReveal = await page.locator('.messages').evaluate((container) => {
    const reveal = container.querySelector('.quick-reveal')?.closest('article')
    return reveal ? reveal.getBoundingClientRect().top - container.getBoundingClientRect().top : null
  })
  assert.ok(pinnedTop !== null && pinnedTopAfterReveal !== null && Math.abs(pinnedTopAfterReveal - pinnedTop) < 2, `a transcrição mantém o início do retorno fixo (${pinnedTop} -> ${pinnedTopAfterReveal})`)
  const first = await page.evaluate(() => window.omni.snapshot())
  assert.equal(first.conversations.find(c => c.id === current.id).messages.at(-1).text, summary('Resultado atual correto'), 'texto completo já persistido durante animação')
  assert.equal(await page.locator('.thinking-indicator').count(), 0)
  assert.equal(await currentCard.locator('.activity-return').count(), 1, 'o retorno direto não consome o relatório antigo ainda não lido')
  // Several clicks in quick succession must not redirect or mix sessions.
  await forwardedCard.click()
  await page.locator('.quick-reveal').waitFor()
  assert.match(await page.locator('.chat-context').innerText(), /Encaminhado/)
  assert.equal(await page.locator('.thinking-indicator').count(), 0)
  await page.locator('.quick-reveal').waitFor({ state: 'detached', timeout: 5000 })
  assert.match(await page.locator('.messages').innerText(), /Resultado encaminhado correto/)
  assert.doesNotMatch(await page.locator('.messages').innerText(), /Resultado atual correto/)
  await currentCard.click()
  await page.waitForFunction(() => document.querySelector('.messages')?.textContent?.includes('Retorno do pedido encaminhado'))
  await page.waitForFunction(() => document.querySelectorAll('.quick-reveal').length === 0, undefined, { timeout: 5000 })
  assert.match(await page.locator('.messages').innerText(), /Resultado atual correto/)
  assert.match(await page.locator('.messages').innerText(), /Retorno do pedido encaminhado/, 'clique explícito entrega o histórico não lido, sem misturar com a resposta direta anterior')
  assert.equal(await currentCard.locator('.activity-return').count(), 0, 'depois de ambos lidos o card deixa de anunciar retorno')
  elapsed = Date.now() - start
  await currentCard.click()
  assert.equal(await page.locator('.quick-reveal').count(), 0, 'reclique não repete digitação')
  await previousCard.click()
  assert.equal(await previousCard.locator('.activity-return').count(), 0)
  assert.doesNotMatch(await page.locator('.messages').innerText(), /Resultado anterior preservado/)
  assert.equal(await page.locator('[role=alert]').count(), 0)
  const after = await page.evaluate(() => window.omni.snapshot())
  const delivered = id => after.conversations.find(c => c.id === id).messages.filter(m => /^editor-(?:report|response):/.test(m.id))
  assert.equal(after.conversations.find(c => c.primary).messages.length, 0)
  assert.deepEqual(delivered(current.id).map(m => m.text), [summary('Resultado atual correto'), summary('Retorno do pedido encaminhado')])
  assert.deepEqual(delivered(forwarded.id).map(m => m.text), [summary('Resultado encaminhado correto')])
  assert.equal(delivered(previous.id).length, 0)
  assert.equal(after.conversations.filter(c => c.kind === 'task').length, 0)
  assert.equal(await app.evaluate(() => globalThis.__testRelays || 0), 0)
  await page.evaluate(id => window.omni.releaseResult(id), forwardedId)
  const invalid = await page.evaluate(() => window.omni.releaseResult('../inválido').then(() => '', error => error.message))
  assert.match(invalid, /Identificador de retorno inválido/)
  await page.reload(); await currentCard.waitFor(); await currentCard.click()
  assert.equal(await page.locator('.quick-reveal').count(), 0)
  assert.equal(await currentCard.locator('.activity-return').count(), 0)
  assert.deepEqual(errors, [])
  } else {
    await currentCard.click()
  }
  const composer = page.getByRole('textbox', { name: 'Mensagem para o Omni' })
  const typed = 'Texto integral de teste. '.repeat(320)
  await composer.fill(typed)
  assert.equal(await composer.inputValue(), typed, 'editar o campo não anexa o rascunho inteiro')
  assert.equal(await page.locator('.attachment-chip.text').count(), 0)
  const originalDraft = 'Minha pergunta já escrita.\nPreserve também esta instrução.'
  await composer.fill(originalDraft)
  // Synthetic clipboard events exercise the actual renderer listener without
  // reading or overwriting the owner's operating-system clipboard.
  const paste = (text, start = 0, end = start) => composer.evaluate((input, data) => {
    input.focus(); input.setSelectionRange(data.start, data.end)
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', data.text)
    const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true })
    input.dispatchEvent(event)
    return { prevented: event.defaultPrevented, selection: [input.selectionStart, input.selectionEnd] }
  }, { text, start, end })
  const pasted = []
  for (const [start, end] of [[0, 0], [12, 12], [0, originalDraft.length], [7, 21]]) {
    const text = `Conversa colada ${pasted.length + 1}.\r\n`.repeat(400)
    pasted.push(text)
    const result = await paste(text, start, end)
    assert.equal(result.prevented, true)
    assert.deepEqual(result.selection, [start, end], 'cursor e seleção preservados')
    assert.equal(await composer.inputValue(), originalDraft, 'instrução anterior nunca entra no anexo')
    assert.equal(await page.locator('.attachment-chip.text').count(), pasted.length)
  }
  assert.equal((await paste('Complemento curto', 12, 12)).prevented, false, 'colagem curta segue a edição nativa')
  await paste('x'.repeat(256001))
  assert.equal(await composer.inputValue(), originalDraft)
  assert.equal(await page.locator('.attachment-chip.text').count(), 4)
  assert.match(await page.getByRole('alert').innerText(), /não foi anexado/)
  while (pasted.length < 8) { const text = `Mais contexto ${pasted.length}. `.repeat(500); pasted.push(text); await paste(text) }
  await paste('Texto excedente. '.repeat(500))
  assert.equal(await page.locator('.attachment-chip.text').count(), 8)
  assert.equal(await composer.inputValue(), originalDraft)
  assert.match(await page.getByRole('alert').innerText(), /rascunho foi preservado/)
  // Real renderer -> preload -> IPC, but no worker, model or external write.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('omni:send-attachments')
    ipcMain.handle('omni:send-attachments', (_event, id, text, channel, attachments) => {
      if (globalThis.__testOffline) throw new Error('Sessão indisponível no cenário isolado')
      globalThis.__testComposerSend = { id, text, channel, attachments }
    })
  })
  await composer.press('Enter')
  await page.waitForFunction(() => document.querySelectorAll('.attachment-chip.text').length === 0)
  const sent = await app.evaluate(() => globalThis.__testComposerSend)
  assert.equal(sent.text, originalDraft)
  assert.deepEqual(sent.attachments.map(attachment => attachment.text), pasted, 'IPC recebe apenas cada texto colado, integral e separado')
  assert.equal(await composer.inputValue(), '')
  const thumbnail = page.locator('.message-image')
  await thumbnail.waitFor()
  assert.ok(await thumbnail.evaluate(image => image.complete && image.naturalWidth > 0), 'a imagem real aparece sem cartão IMG')
  await composer.fill('Pedido preservado se a sessão sair.')
  await app.evaluate(() => { globalThis.__testOffline = true })
  await composer.press('Enter')
  await page.getByRole('alert').waitFor()
  assert.equal(await composer.inputValue(), 'Pedido preservado se a sessão sair.')
  assert.equal(await app.evaluate(() => globalThis.__testRelays || 0), 0)
  await app.evaluate(() => { globalThis.__testOffline = false })
  await page.screenshot({ path: join(directory, 'verified.png') })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify(composerOnly
    ? { ok: true, path: 'colagem -> rascunho preservado -> anexos separados -> preload -> IPC', selections: 4, exactAttachments: 8, limitsPreserveDraft: true, noRelay: true, directory }
    : { ok: true, path: 'card -> preload -> IPC -> resumo persistido -> digitação rápida', initialVisibleCharacters: initialLength, multipleCardsVerifiedMs: elapsed, noReturnButtons: true, runningBlueReadyGreen: true, currentFirstHistoricalUnreadPreserved: true, noRelay: true, noThinking: true, directory }))
} finally { await app.close() }
