import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '../../..')
const appPath = resolve(import.meta.dirname, '..')
await mkdir(join(appPath, 'out'), { recursive: true })
const home = await mkdtemp(join(appPath, 'out/smoke-home-'))
const env = { ...process.env, OMNI_HOME: home, OMNI_SOURCE_ROOT: root }
delete env.ELECTRON_RUN_AS_NODE
delete env.NODE_OPTIONS
const app = await electron.launch({ executablePath: require('electron'), args: [appPath, ...(process.argv.includes('--voice') || process.argv.includes('--design') ? ['--use-fake-device-for-media-stream'] : [])], env, timeout: 120000 })
try {
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.getByRole('heading', { name: 'O que vamos fazer?' }).waitFor({ timeout: 60000 })
  const exposed = await page.evaluate(() => ({ methods: Object.keys(window.omni).sort(), node: typeof window.require, studio: typeof window.studio }))
  assert.equal(exposed.node, 'undefined'); assert.equal(exposed.studio, 'undefined')
  assert.equal(exposed.methods.length, 14)
  await page.getByRole('button', { name: '＋ Nova sessão' }).click()
  assert.equal((await page.evaluate(() => window.omni.snapshot())).conversations.length, 2)
  await page.getByRole('button', { name: 'Retomar sessão Claude' }).click()
  await page.getByText('Sessões deste projeto', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Fechar ×' }).click()
  if (process.argv.includes('--design')) {
    // Isolated test process only: no minting, microphone audio or private memory leaves the app.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('omni:voice')
      ipcMain.handle('omni:voice', () => ({ value: 'test-only', expiresAt: 0 }))
      ipcMain.removeHandler('omni:transcribe')
      ipcMain.handle('omni:transcribe', () => new Promise(resolve => setTimeout(() => resolve('Ditado de teste'), 300)))
    })
    await page.route('https://api.openai.com/**', route => route.fulfill({ status: 200, body: 'test-sdp' }))
    await page.evaluate(() => {
      window.__soundNotes = 0
      window.__audioContexts = []
      window.__micStreams = []
      const OriginalContext = window.AudioContext
      window.AudioContext = class extends OriginalContext {
        constructor(...args) { super(...args); window.__audioContexts.push(this) }
        createOscillator() { window.__soundNotes++; return super.createOscillator() }
      }
      const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = async (...args) => { const stream = await getUserMedia(...args); window.__micStreams.push(stream); return stream }
      window.RTCPeerConnection = class {
        connectionState = 'new'
        addTrack() {}
        createDataChannel() {
          const channel = { readyState: 'open', onopen: null, onmessage: null,
            send: () => setTimeout(() => channel.onmessage?.({ data: JSON.stringify({ type: 'session.updated' }) }), 10), close() {} }
          this.channel = channel
          return channel
        }
        async createOffer() { return { type: 'offer', sdp: 'test' } }
        async setLocalDescription() {}
        async setRemoteDescription() { this.channel.onopen?.() }
        close() {}
      }
    })
    assert.equal(await page.locator('.brand>div').evaluate(e => e.firstChild.textContent), 'Omni')
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight), false)
    await page.getByRole('button', { name: 'Atalhos' }).click()
    await page.getByText('Do seu jeito.').waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.shortcut-help').count(), 0)
    await page.getByRole('button', { name: 'Configurações de áudio' }).click()
    await page.getByRole('heading', { name: 'Escutar e responder do jeito certo.' }).waitFor()
    await page.getByRole('combobox', { name: 'Microfone' }).waitFor()
    await page.getByRole('combobox', { name: 'Saída de áudio' }).waitFor()
    await page.getByRole('combobox', { name: 'Voz do Omni' }).selectOption('marin')
    assert.equal(await page.getByRole('combobox', { name: 'Voz do Omni' }).inputValue(), 'marin')
    await page.getByRole('button', { name: 'Fechar configurações de áudio' }).click()
    assert.equal(await page.locator('.audio-settings').count(), 0)
    await page.screenshot({ path: join(appPath, 'out/desktop-smoke.png') })
    await page.keyboard.press('Control+0')
    await page.locator('.realtime[data-ready=true]').waitFor({ timeout: 15000 })
    await page.getByRole('button', { name: 'Pausar microfone' }).click()
    await page.getByText('Microfone pausado', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Ativar microfone' }).click()
    await page.waitForTimeout(1900)
    await page.screenshot({ path: join(appPath, 'out/realtime-smoke.png') })
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.realtime').count(), 0)
    await page.getByRole('textbox', { name: 'Mensagem para o Omni' }).waitFor()
    assert.equal(await page.evaluate(() => window.__soundNotes), 10)
    assert.equal(await page.evaluate(() => window.__audioContexts.every(c => c.state === 'closed')), true)
    assert.equal(await page.evaluate(() => window.__micStreams.every(s => s.getTracks().every(t => t.readyState === 'ended'))), true)
    // Key-up of Control first must still close exactly once, with no stuck recording.
    await page.keyboard.press('Control+0')
    await page.locator('.realtime').waitFor()
    await page.keyboard.down('Control'); await page.keyboard.down('0'); await page.keyboard.up('Control'); await page.keyboard.up('0')
    assert.equal(await page.locator('.realtime').count(), 0)
    await page.keyboard.down('Control'); await page.keyboard.down('0')
    await page.getByText('Ouvindo… solte Ctrl + 0 quando terminar', { exact: true }).waitFor()
    await page.locator('.composer .voice-wave').waitFor()
    assert.equal(await page.getByRole('textbox', { name: 'Mensagem para o Omni' }).count(), 0)
    assert.equal(await page.locator('.realtime').count(), 0)
    await page.keyboard.press('Escape'); await page.keyboard.up('0'); await page.keyboard.up('Control')
    await page.getByRole('textbox', { name: 'Mensagem para o Omni' }).waitFor()
    await page.keyboard.down('Control'); await page.keyboard.down('0')
    await page.getByText('Ouvindo… solte Ctrl + 0 quando terminar', { exact: true }).waitFor()
    await page.waitForTimeout(2500)
    await page.keyboard.up('0'); await page.keyboard.up('Control')
    await page.getByText('Transcrevendo…', { exact: true }).waitFor()
    await page.locator('.dictation-feedback.transcribing .voice-wave').waitFor()
    assert.equal(await page.getByRole('textbox', { name: 'Mensagem para o Omni' }).count(), 0)
    await page.getByRole('textbox', { name: 'Mensagem para o Omni' }).waitFor()
    assert.equal(await page.getByRole('textbox', { name: 'Mensagem para o Omni' }).inputValue(), 'Ditado de teste')
    await page.keyboard.press('Control+9')
    await page.waitForTimeout(1700)
    assert.equal((await page.evaluate(() => window.omni.snapshot())).conversations.every(c => c.messages.length === 0), true)
  }
  if (process.argv.includes('--live')) {
    await page.getByRole('textbox', { name: 'Mensagem para o Omni' }).fill('Teste de integração autorizado: responda somente "Omni conectado". Não execute ferramentas nem altere arquivos.')
    await page.getByRole('textbox', { name: 'Mensagem para o Omni' }).press('Enter')
    const deadline = Date.now() + 120000
    while (!['completed', 'failed'].includes((await page.evaluate(() => window.omni.snapshot())).conversations[0].phase)) {
      if (Date.now() > deadline) throw new Error('Claude não concluiu dentro de 120 segundos.')
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    const result = await page.evaluate(() => window.omni.snapshot())
    assert.equal(result.conversations[0].phase, 'completed')
    assert.ok(result.conversations[0].sessionId)
    assert.match(result.conversations[0].messages.at(-1).text, /Omni conectado/i)
    await page.getByRole('textbox', { name: 'Mensagem para o Omni' }).waitFor()
    await page.getByText('Rodada concluída', { exact: true }).first().waitFor()
  }
  if (process.argv.includes('--voice')) {
    await page.keyboard.press('Control+0')
    await page.locator('.realtime[data-ready=true]').waitFor({ timeout: 45000 })
    await page.getByRole('button', { name: 'Fechar Realtime' }).click()
    await page.getByRole('textbox', { name: 'Mensagem para o Omni' }).waitFor()
  }
  await page.screenshot({ path: join(appPath, 'out/desktop-smoke.png'), fullPage: true })
  assert.deepEqual(errors, [])
  await writeFile(join(appPath, 'out/smoke-result.json'), JSON.stringify({ ok: true, live: process.argv.includes('--live'), voice: process.argv.includes('--voice'), exposed, home }, null, 2))
  console.log(JSON.stringify({ ok: true, live: process.argv.includes('--live'), screenshot: 'out/desktop-smoke.png' }))
} finally { await app.close() }
