import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'

// Real packaged renderer + preload, isolated mock main: no model, provider,
// broker, Windows vault, production history, or credentials are contacted.
const require = createRequire(import.meta.url)
const appPath = resolve(import.meta.dirname, '..')
const out = join(appPath, 'out')
await mkdir(out, { recursive: true })
const fixture = await mkdtemp(join(out, 'credential-smoke-'))
const home = join(fixture, 'home')
const harness = join(fixture, 'main.cjs')
const secret = 'QA_ONLY_SYNTHETIC_CREDENTIAL_83B0C_NOT_REAL'
const input = `token vercel, token: ${secret}, conta: qa@example.invalid, expira em 90 dias`
const conversation = {
  id: '11111111-1111-4111-8111-111111111111', kind: 'central', primary: true,
  title: 'Chat central', workspace: appPath, sessionId: null, messages: [], events: [],
  phase: 'idle', updatedAt: new Date().toISOString(),
}
await writeFile(harness, `
const { app, BrowserWindow, ipcMain } = require('electron')
const home = ${JSON.stringify(home)}
app.setPath('userData', home)
const state = globalThis.credentialFixture = {
  prepare: 0, test: 0, save: 0, discard: 0,
  outcome: 'invalid-token', existing: null, disposition: 'created',
  holdTest: false, pendingTest: null, passed: false, inputHadSecret: false,
}
const snapshot = {
  conversations: [${JSON.stringify(conversation)}], permissions: [],
  state: { broker: 'ready', voice: false, memory: { confirmed: 0, candidates: 0 },
    missions: [], synchronization: 'Ambiente de teste isolado', activities: [] },
}
ipcMain.handle('omni:snapshot', () => snapshot)
ipcMain.handle('omni:credential-prepare', (_event, text) => {
  state.prepare++; state.passed = false
  state.inputHadSecret = typeof text === 'string' && text.includes(${JSON.stringify(secret)})
  if (!state.inputHadSecret) throw new Error('Expected synthetic input only')
  return { id: 'draft-' + state.prepare, service: 'vercel', kind: 'token',
    expiresAt: '2026-12-10T12:00:00.000Z', missing: [], existing: state.existing }
})
ipcMain.handle('omni:credential-test', async (_event, id) => {
  if (!/^draft-\\d+$/.test(id)) throw new Error('Expected temporary handle')
  state.test++
  const outcome = state.outcome
  if (state.holdTest) await new Promise(resolve => { state.pendingTest = resolve })
  state.passed = outcome === 'authenticated'
  return { outcome, checkedAt: '2026-09-11T12:00:00.000Z', method: 'synthetic-test',
    summary: state.passed ? 'Acesso confirmado no teste sintético.' : 'A credencial não foi aceita no teste sintético.' }
})
ipcMain.handle('omni:credential-save', (_event, id) => {
  if (!/^draft-\\d+$/.test(id) || !state.passed) throw new Error('Save blocked without successful authentication')
  state.save++
  return { version: state.disposition === 'reused' ? 1 : 2, status: 'active',
    disposition: state.disposition, checkedAt: '2026-09-11T12:00:00.000Z' }
})
ipcMain.handle('omni:credential-discard', () => { state.discard++; state.passed = false })
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1320, height: 850, useContentSize: true, show: false,
    backgroundColor: '#101317', webPreferences: { contextIsolation: true, sandbox: true,
      nodeIntegration: false, preload: ${JSON.stringify(join(out, 'preload/index.cjs'))} } })
  window.setMenuBarVisibility(false)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  await window.loadFile(${JSON.stringify(join(out, 'renderer/index.html'))})
  window.showInactive()
})
app.on('window-all-closed', () => app.quit())
`, 'utf8')

const env = { ...process.env, OMNI_HOME: home }
delete env.ELECTRON_RUN_AS_NODE
delete env.NODE_OPTIONS
const app = await electron.launch({ executablePath: require('electron'), args: [harness], env, timeout: 60000 })
const errors = []
const checks = []
try {
  const page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  const panel = page.locator('section.credential-settings')
  const thread = panel.locator('.credential-thread')
  const saveButton = panel.getByRole('button', { name: /^(Guardar no Crachá|Atualizar acesso)$/ })
  const open = async () => {
    await page.getByRole('button', { name: 'Crachá de acessos', exact: true }).click()
    await panel.getByRole('textbox', { name: 'Dados do acesso', exact: true }).waitFor()
  }
  const configure = values => app.evaluate((_electron, updates) => Object.assign(globalThis.credentialFixture, updates), values)
  const counts = () => app.evaluate(() => {
    const { prepare, test, save, discard, inputHadSecret } = globalThis.credentialFixture
    return { prepare, test, save, discard, inputHadSecret }
  })
  const waitForCount = async (field, value) => {
    const deadline = Date.now() + 10000
    while ((await counts())[field] < value) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${field} ${value}`)
      await new Promise(resolve => setTimeout(resolve, 40))
    }
  }
  const expectPrivate = async () => {
    const state = await page.evaluate(() => ({
      body: document.body.innerText,
      inputs: [...document.querySelectorAll('textarea,input')].map(element => element.value),
      local: Object.entries(localStorage), session: Object.entries(sessionStorage),
    }))
    assert.ok(!JSON.stringify(state).includes(secret), 'Submitted secret remained in UI/storage')
    const snapshot = await page.evaluate(() => window.omni.snapshot())
    assert.ok(!JSON.stringify(snapshot).includes(secret), 'Submitted secret reached normal chat history')
  }
  const submit = async () => {
    const textbox = panel.getByRole('textbox', { name: 'Dados do acesso', exact: true })
    await textbox.fill(input)
    assert.equal(await textbox.evaluate(element => getComputedStyle(element).webkitTextSecurity), 'none', 'Owner must be able to review the input before sending')
    await panel.getByRole('button', { name: 'Conferir acesso', exact: true }).click()
    await page.waitForFunction(() => ![...document.querySelectorAll('.credential-settings textarea')].some(element => element.value))
    await expectPrivate()
  }
  const assertLayout = async (width, height) => {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height })
    await page.waitForFunction(size => innerWidth === size.width && innerHeight === size.height, { width, height })
    const layout = await thread.evaluate(element => {
      const style = getComputedStyle(element)
      return {
        overflow: style.overflowY,
        width: element.clientWidth, scrollWidth: element.scrollWidth,
        pageWidth: document.documentElement.clientWidth, pageScrollWidth: document.documentElement.scrollWidth,
        messages: [...element.querySelectorAll('.credential-message')].map(message => {
          const rect = message.getBoundingClientRect()
          return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width }
        }),
      }
    })
    assert.ok(['auto', 'scroll'].includes(layout.overflow), 'Chat must have vertical scrolling')
    assert.ok(layout.scrollWidth <= layout.width + 1, `Chat overflows horizontally at ${width}px`)
    assert.ok(layout.pageScrollWidth <= layout.pageWidth + 1, `Page overflows horizontally at ${width}px`)
    assert.ok(layout.messages.length >= 2, 'Need multiple chat messages for layout regression')
    for (let i = 1; i < layout.messages.length; i++) {
      assert.ok(layout.messages[i].top >= layout.messages[i - 1].bottom - 1, `Messages are not vertically stacked at ${width}px`)
    }
    checks.push(`vertical-layout-${width}x${height}`)
  }

  await open()
  const initialMessages = await thread.locator('.credential-message').count()
  await submit()
  await panel.getByRole('button', { name: 'Tentar teste novamente', exact: true }).waitFor()
  assert.ok(await saveButton.count() === 0 || !(await saveButton.isEnabled()), 'Failed test must block save')
  assert.equal((await counts()).save, 0)
  checks.push('failed-authentication-blocks-save')
  await assertLayout(1320, 850)
  await assertLayout(960, 700)
  await configure({ outcome: 'authenticated' })
  await panel.getByRole('button', { name: 'Tentar teste novamente', exact: true }).click()
  await saveButton.waitFor()
  await assertLayout(1320, 850)
  await page.screenshot({ path: join(out, 'credential-smoke-desktop.png'), fullPage: true })
  await assertLayout(960, 700)
  await saveButton.scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(out, 'credential-smoke-compact.png'), fullPage: true })
  await saveButton.click()
  await waitForCount('save', 1)
  await panel.getByRole('button', { name: 'Conferir acesso', exact: true }).waitFor({ state: 'visible' })
  await expectPrivate()
  checks.push('successful-authentication-allows-save')

  await panel.getByRole('button', { name: 'Limpar conversa', exact: true }).click()
  assert.equal(await thread.locator('.credential-message').count(), initialMessages)
  await configure({ existing: { version: 1, status: 'active' }, disposition: 'reused' })
  await submit()
  await saveButton.waitFor()
  await saveButton.click()
  await waitForCount('save', 2)
  await panel.getByText(/já estava|já existe|mantid|mesma|reutiliz|sem criar|sem nova/i).first().waitFor()
  checks.push('duplicate-reused-without-new-version')
  await expectPrivate()

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1320, 850))
  await page.waitForFunction(() => innerWidth === 1320)
  const beforeClose = await counts()
  await panel.getByRole('button', { name: 'Fechar Crachá', exact: true }).click()
  await waitForCount('discard', beforeClose.discard + 1)
  await open()
  assert.equal(await thread.locator('.credential-message').count(), initialMessages, 'Reopening must start an empty temporary conversation')
  checks.push('close-clears-transient-conversation')

  await configure({ existing: null, holdTest: true })
  const beforePending = await counts()
  await submit()
  await waitForCount('test', beforePending.test + 1)
  await panel.getByRole('button', { name: 'Fechar Crachá', exact: true }).click()
  await open()
  await app.evaluate(() => {
    const fixture = globalThis.credentialFixture
    fixture.holdTest = false
    fixture.pendingTest?.()
    fixture.pendingTest = null
  })
  // The event is released explicitly; one short wait gives React a render cycle.
  await page.waitForTimeout(150)
  assert.equal(await thread.locator('.credential-message').count(), initialMessages, 'Late test completion resurrected a discarded conversation')
  assert.equal(await saveButton.count(), 0, 'Discarded test must not enable saving')
  await expectPrivate()
  checks.push('late-completion-does-not-resurrect-discarded-draft')

  const leaks = []
  const inspectPersisted = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await inspectPersisted(path)
      else if (entry.isFile()) {
        const bytes = await readFile(path).catch(() => null)
        if (bytes?.includes(Buffer.from(secret)) || bytes?.includes(Buffer.from(secret, 'utf16le'))) leaks.push(path)
      }
    }
  }
  await inspectPersisted(home)
  assert.deepEqual(leaks, [], 'Synthetic secret was persisted in Electron profile')
  assert.deepEqual(errors, [], 'Renderer errors occurred')
  checks.push('no-secret-in-profile-history-or-web-storage')
  const result = { ok: true, isolated: true, mockedProvider: true, checks, calls: await counts(),
    screenshots: ['out/credential-smoke-desktop.png', 'out/credential-smoke-compact.png'] }
  await writeFile(join(out, 'credential-smoke-result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally {
  await app.close()
}
