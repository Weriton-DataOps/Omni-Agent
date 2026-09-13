import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
const appPath = resolve(import.meta.dirname, '..')
const home = await mkdtemp(join(appPath, 'out/routing-smoke-'))
await mkdir(join(home, 'desktop'))
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333']
const message = (id, text) => ({ id, role: 'assistant', text, at: new Date().toISOString(), channel: 'text' })
const base = { workspace: appPath, sessionId: null, events: [], phase: 'idle', updatedAt: new Date().toISOString() }
const conversations = [
 { ...base, id: ids[0], title: 'Chat central', kind: 'central', primary: true, messages: [message('central-text', 'Conteúdo central preservado')] },
 { ...base, id: ids[1], title: 'Sessão externa isolada', kind: 'external', host: 'vscode', editorProjectionVersion: 2, messages: [message('external-text', 'Conteúdo exclusivo do editor')] },
 { ...base, id: ids[2], title: 'Subagente · tarefa de teste', kind: 'task', parentConversationId: ids[0], phase: 'completed', messages: [message('task-result', 'Relatório exclusivo do subagente')] }
]
await writeFile(join(home, 'desktop/conversations.json'), JSON.stringify({ version: 1, conversations }))
const env = { ...process.env, OMNI_HOME: home, OMNI_SOURCE_ROOT: resolve(appPath, '../..') }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: require('electron'), args: [appPath], env })
try {
 const page = await app.firstWindow()
 await page.getByText('Conteúdo central preservado', { exact: true }).waitFor()
 await page.getByRole('button', { name: 'Todas as conversas', exact: true }).click()
 await page.locator('.conversation-menu button').filter({ hasText: 'Sessão externa isolada' }).click()
 await page.getByText('Conteúdo exclusivo do editor', { exact: true }).waitFor()
 assert.equal(await page.getByText('Relatório exclusivo do subagente', { exact: true }).count(), 0)
 await page.locator('.activity.source-omni').filter({ hasText: 'tarefa de teste' }).click()
 await page.getByRole('status').filter({ hasText: 'Escrevendo resultado do subagente' }).waitFor()
 const partial = await page.locator('.report-delivery .message-text').innerText()
 assert.ok(!partial.includes('Relatório exclusivo do subagente'), 'A entrega deve aparecer progressivamente, não inteira no primeiro frame')
 assert.ok(!partial.includes('**'), 'A formatação deve ficar pronta desde a primeira letra')
 await page.screenshot({ path: join(appPath, 'out/subagent-delivery-writing.png') })
 const whileWriting = await page.evaluate(() => window.omni.snapshot())
 assert.ok(whileWriting.conversations.find(c => c.id === ids[0]).messages.at(-1).text.includes('Relatório exclusivo do subagente'), 'A animação não pode atrasar a persistência do texto completo')
 await page.locator('.messages').getByText('Relatório exclusivo do subagente', { exact: true }).waitFor()
 await page.getByRole('status').filter({ hasText: 'Resultado recebido no chat central' }).waitFor()
 assert.equal(await page.locator('.activity.source-omni').count(), 0)
 const snapshot = await page.evaluate(() => window.omni.snapshot())
 assert.equal(snapshot.conversations.find(c => c.id === ids[1]).messages.length, 1)
 assert.ok(snapshot.conversations.find(c => c.id === ids[2]).acknowledgedAt)
 assert.equal(await page.locator('.conversation-menu').count(), 0)
 await page.evaluate(id => window.omni.consumeTask(id), ids[2])
 assert.equal((await page.evaluate(() => window.omni.snapshot())).conversations.find(c => c.id === ids[0]).messages.length, 2)
 const disk = JSON.parse(await readFile(join(home, 'desktop/conversations.json'), 'utf8'))
 assert.ok(disk.conversations.find(c => c.id === ids[2]).acknowledgedAt)
 await page.getByRole('button', { name: 'Todas as conversas', exact: true }).click()
 await page.locator('.conversation-menu button').filter({ hasText: 'Sessão externa isolada' }).click()
 assert.equal(await page.locator('.report-delivery').count(), 0)
 await page.locator('.current-conversation').click()
 await page.locator('.messages').getByText('Relatório exclusivo do subagente', { exact: true }).waitFor()
 assert.equal(await page.locator('.report-delivery').count(), 0, 'Voltar ao histórico não deve repetir a animação')
 if (process.argv.includes('--live-readback')) {
   const card = page.locator('.activity.source-vscode').filter({ hasText: 'omni-0b' })
   await card.waitFor({ timeout: 30000 }); await card.click()
   await page.getByRole('button', { name: /Histórico do VS Code/ }).click()
   await page.waitForFunction(() => document.querySelector('.messages .message-text'))
   const readback = await page.evaluate(() => window.omni.snapshot())
   const external = readback.conversations.find(c => c.kind === 'external' && c.sessionId)
   assert.ok(external?.editorHistory.length > 0)
   assert.equal(external.messages.length, 0)
   assert.ok(!external.editorHistory.some(m => m.text.startsWith('This session is being continued')))
   assert.equal(await card.getAttribute('aria-current'), 'page')
   assert.equal(await page.locator('.current-conversation').getAttribute('aria-current'), null)
   assert.equal(await page.getByRole('alert').count(), 0)
   assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()), false)
   console.log(JSON.stringify({ liveHistoryRead: true, sessionId: external.sessionId, messages: external.editorHistory.length, selectedCard: true, internalMessagesHidden: true, windowNotMinimized: true }))
   const growthCard = page.locator('.activity.source-vscode').filter({ hasText: 'growth-eb' })
   if (await growthCard.count()) {
     await growthCard.click()
     await page.waitForFunction(() => document.querySelector('.activity[aria-current="page"]')?.textContent?.includes('growth-eb'))
     assert.equal(await growthCard.getAttribute('aria-current'), 'page')
     assert.equal(await page.locator('.messages').getByText(/This session is being continued/).count(), 0)
     await page.screenshot({ path: join(appPath, 'out/coordination-growth.png') })
     await page.getByRole('button', { name: /Histórico do VS Code/ }).click()
     const state = await page.evaluate(() => window.omni.snapshot())
     const growth = state.conversations.find(c => c.title.includes('growth-eb'))
     assert.ok(growth.editorHistory.length > 0)
     assert.ok(growth.editorHistory.every(m => m.at && m.author))
     assert.ok(!growth.editorHistory.some(m => /^(This session is being continued|Another Claude session sent)/.test(m.text)))
     console.log(JSON.stringify({ growthVerified: true, selected: true, historySeparated: true, internalMessagesHidden: true, timestampsAndAuthors: true }))
   }
 }
 console.log(JSON.stringify({ ok: true, externalUntouched: true, reportOnlyInCentral: true, consumedOnce: true, persisted: true, animatedDelivery: true, noReplay: true }))
} finally { await app.close() }
