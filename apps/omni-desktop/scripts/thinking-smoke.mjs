import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'

// Isolated renderer with fake IPC: never sends a command to a live session.
const directory = resolve(import.meta.dirname, '../out/renderer')
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1320, height: 850 } })
  await page.route('http://omni.test/**', async route => {
    const path = new URL(route.request().url()).pathname
    const file = path === '/' ? 'index.html' : path.slice(1)
    const contentType = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'
    await route.fulfill({ body: await readFile(join(directory, file)), contentType })
  })
  await page.addInitScript(() => {
    const central = { id: 'central', title: 'Chat central', primary: true, kind: 'central', phase: 'idle', workspace: '.', sessionId: null, messages: [], events: [], coordinationTurns: [] }
    const project = { ...central, id: 'project', kind: 'external', primary: false, editorRequests: [{ id: 'old', status: 'received', originConversationId: 'central', text: 'Antigo', at: '' }] }
    const snapshot = { conversations: [central, project], state: { broker: 'ready', voice: false, activities: [], synchronization: 'Conectado' }, permissions: [] }
    let change = () => {}
    window.omni = {
      snapshot: async () => structuredClone(snapshot),
      onChange: callback => { change = callback; return () => {} },
      acknowledgeReturns: async () => {},
      send: () => new Promise(resolve => {
        window.acceptTestSend = () => {
          central.coordinationTurns.push({ id: 'new', state: 'planning', text: 'Novo pedido', at: '' })
          change(structuredClone(snapshot)); resolve()
        }
      })
    }
    window.delegateTestSend = () => {
      project.editorRequests.push({ id: 'new', status: 'sending', originConversationId: 'central', text: 'Novo pedido', at: '' })
      change(structuredClone(snapshot))
    }
    window.confirmTestSend = () => {
      central.messages.push({ id: 'coord:new', role: 'assistant', text: 'Encaminhei ao subagente. Continuo disponível.', at: '', channel: 'text' })
      change(structuredClone(snapshot))
    }
  })
  await page.goto('http://omni.test/')
  const input = page.locator('textarea').first()
  await input.fill('Novo pedido')
  await input.press('Enter')
  await page.locator('.thinking-indicator').waitFor()
  assert.equal(await input.isEnabled(), true)
  assert.equal(await page.locator('.thinking-ring').evaluate(e => getComputedStyle(e).animationName), 'thinking-spin')
  await page.evaluate(() => window.acceptTestSend())
  await page.locator('.thinking-indicator').waitFor()
  await input.fill('Posso continuar escrevendo')
  await page.evaluate(() => window.delegateTestSend())
  await page.locator('.thinking-indicator').waitFor()
  await page.evaluate(() => window.confirmTestSend())
  await page.locator('.thinking-indicator').waitFor({ state: 'detached' })
  assert.equal(await input.inputValue(), 'Posso continuar escrevendo')
  console.log('PASS: indicator covers send and dispatch, clears with confirmation while executor remains active; composer stays editable.')
} finally { await browser.close() }
