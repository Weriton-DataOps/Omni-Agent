// Real main process, preload, renderer and file reader. External executors isolated.
import { _electron as electron } from 'playwright'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, cp, writeFile, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
const require = createRequire(import.meta.url)
const privateContextOnly = process.argv.includes('--private-context')
const appPath = resolve(import.meta.dirname, '..'), root = resolve(appPath, '../..')
const directory = await mkdtemp(join(appPath, 'out/document-ui-'))
const home = join(directory, 'data'), workspace = join(directory, 'executor'), centralPath = join(directory, 'central')
await mkdir(join(workspace, 'planejamentos'), { recursive: true }); await mkdir(centralPath)
const documentPath = join(workspace, 'planejamentos/fase1-station.md')
const text = '# Plano de implantação\n\nDocumento de teste do leitor do Omni.\n\n## Etapas\n\n| Etapa | Situação |\n| --- | --- |\n| Preparação | Concluída |\n| Execução | Em andamento |\n\n- Conferir a origem dos dados\n- Validar o resultado\n\n[Índice](../README.md) · [Ir às etapas](#etapas)\n\n```sh\necho "Código apenas para leitura"\n```\n\n<script>window.__unsafe=true</script>\n\n[Ausente](faltante.md)\n'
await writeFile(documentPath, text); await writeFile(join(workspace, 'README.md'), '# Índice\n\n[Plano](planejamentos/fase1-station.md#etapas)')
await build({ entryPoints: ['src/main/store.ts'], absWorkingDir: appPath, outdir: join(directory, 'helpers'), outExtension: { '.js': '.mjs' }, bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'error' })
const { Store } = await import(pathToFileURL(join(directory, 'helpers/store.mjs')))
const store = new Store(join(home, 'desktop')); await store.load()
const central = store.get(await store.create(centralPath)); central.primary = true
const child = store.get(await store.create(workspace, 'task')); child.parentConversationId = central.id; child.phase = 'completed'; child.acknowledgedAt = new Date().toISOString(); child.deliveryState = 'delivered'
central.messages.push({ id: `report:${child.id}`, role: 'assistant', text: '**O plano está em `planejamentos/fase1-station.md`**, com um `README.md` de índice.', at: new Date().toISOString(), channel: 'text' })
await store.save()
const runtime = `export const home=${JSON.stringify(home)}, root=${JSON.stringify(root)};
export const startRuntime=async()=>{}, voiceAvailable=async()=>false;
export const broker=async()=>({health:async()=>({status:'ready'}),listActiveMissions:async()=>[]});
export const executionBroker=broker;
export const moduleAt=async path=>path.includes('activation-store')?{ClaudeActivationStore:class {async activate(){return {gravados:1}}}}:path.includes('hook-contexto')?{tratarHook:async()=>({hookSpecificOutput:{additionalContext:'Contexto sintético de teste.'}})}:({lerMemoria:async()=>({confirmed:[],candidates:[]}),sincronizarMemoriaDuravel:async()=>{},sincronizarMissoesDuraveis:async()=>{},sincronizarAprendizadoOperacional:async()=>{}});
export const claudeExecutable=async()=>{${privateContextOnly ? "return 'synthetic-model.exe'" : "throw Error('Modelo não permitido no teste')"}};
export const mintVoiceToken=claudeExecutable, transcribeAudio=claudeExecutable;`
const model = `export const listSessions=async()=>[], getSessionMessages=async()=>[]; export async function* query({prompt,options}) {
  if(!${privateContextOnly}) throw Error('Inferência não permitida');
  (globalThis.__privatePrompts ||= []).push(prompt);
  await new Promise(resolve=>setTimeout(resolve,450));
  yield options.outputFormat ? {type:'result',subtype:'success',is_error:false,result:'',structured_output:{action:'reply',sessionId:null,instruction:null,reply:'Vou considerar o contexto privado.'}} : {type:'result',subtype:'success',is_error:false,result:'Recebi e considerei o contexto privado desta mensagem.'};
}`
const editors = `export const sameWorkspace=(a,b)=>a===b; export const editorSessions=async()=>[]; export const readEditor=async()=>({messages:[],observations:[],relayInbox:[],execution:{state:'idle'},subagents:[]}); export const editorHistory=async()=>[]; export const relayToEditor=async()=>{throw Error('Envio não permitido no teste')};`
const harness = join(directory, 'app')
await build({ entryPoints: ['src/main/index.ts'], absWorkingDir: appPath, outfile: join(harness, 'main/index.js'), bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'error', plugins: [{ name: 'isolated-adapters', setup(b) {
  b.onResolve({ filter: /^\.\/runtime$/ }, () => ({ path: 'runtime', namespace: 'fixture' }))
  b.onResolve({ filter: /^\.\/vscode-sessions$/ }, () => ({ path: 'editors', namespace: 'fixture' }))
  b.onResolve({ filter: /^@anthropic-ai\/claude-agent-sdk$/ }, () => ({ path: 'model', namespace: 'fixture' }))
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'runtime' ? runtime : args.path === 'model' ? model : editors, loader: 'js' }))
} }] })
await cp(join(appPath, 'out/preload'), join(harness, 'preload'), { recursive: true })
await cp(join(appPath, 'out/renderer'), join(harness, 'renderer'), { recursive: true })
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.ELECTRON_RENDERER_URL
const app = await electron.launch({ executablePath: require('electron'), args: [join(harness, 'main/index.js')], env, timeout: 30000 })
try {
  const chat = await app.firstWindow(), errors = []
  chat.on('pageerror', error => errors.push(error.message))
  if (privateContextOnly) {
    const composer = chat.getByRole('textbox', { name: 'Mensagem para o Omni' })
    await composer.waitFor()
    const attach = async content => {
      await chat.getByRole('button', { name: '◉ Crachá', exact: true }).click()
      const panel = chat.getByRole('dialog', { name: 'Anexo privado do Crachá' })
      await panel.getByRole('textbox', { name: 'Anexo privado para o Omni' }).fill(content)
      await panel.getByRole('button', { name: 'Anexar ao Omni', exact: true }).click()
      await panel.waitFor({ state: 'detached' })
    }
    const firstSecret = 'SYNTHETIC-PRIVATE-ALPHA', secondSecret = 'SYNTHETIC-PRIVATE-BETA'
    await attach(firstSecret)
    await chat.locator('.credential-attachment').waitFor()
    await composer.fill('Considere esse contexto privado no planejamento.')
    await composer.press('Enter')
    await chat.locator('.private-attachment-receipt').filter({ hasText: 'recebido pelo Omni' }).waitFor()
    await chat.locator('.credential-attachment').waitFor({ state: 'detached' })
    await attach(secondSecret)
    await chat.locator('.private-attachment-receipt').filter({ hasText: 'contexto considerado' }).waitFor()
    assert.equal(await chat.locator('.credential-attachment').count(), 1, 'novo anexo não é consumido pela resposta anterior')
    await composer.press('Enter')
    await chat.waitForFunction(() => [...document.querySelectorAll('.private-attachment-receipt')].filter(el => el.textContent.includes('contexto considerado')).length === 2)
    await chat.locator('.credential-attachment').waitFor({ state: 'detached' })
    const state = await chat.evaluate(() => window.omni.snapshot())
    assert.equal(state.conversations.find(c => c.primary).messages.filter(m => m.privateAttachment).length, 2)
    for (const secret of [firstSecret, secondSecret]) {
      assert.ok(!(await chat.locator('body').innerText()).includes(secret))
      assert.ok(!JSON.stringify(state).includes(secret))
      assert.ok(!(await readFile(join(home, 'desktop/conversations.json'), 'utf8')).includes(secret))
      assert.equal(await app.evaluate((_electron, value) => (globalThis.__privatePrompts || []).some(p => typeof p === 'string' && p.includes(value)), secret), false)
    }
    await attach('SYNTHETIC-PRIVATE-EXPIRED')
    await chat.evaluate(id => window.omni.discardCredentialAttachment(id), central.id)
    await composer.fill('Mensagem preservada quando o anexo expira.')
    await composer.press('Enter')
    await chat.getByRole('alert').waitFor()
    assert.equal(await composer.inputValue(), 'Mensagem preservada quando o anexo expira.')
    assert.match(await chat.getByRole('alert').innerText(), /mudou ou expirou|não está mais disponível/)
    assert.equal(await chat.locator('.private-attachment-receipt').count(), 2)
    await chat.screenshot({ path: join(directory, 'private-context.png') })
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ status: 'passed', path: 'Crachá -> envio -> IPC -> contexto por mensagem -> recibo', directory, rawSecretInChat: false, rawSecretInModel: false, nextDraftPreserved: true, expiredAttachmentPreservesMessage: true }))
  } else {
  const documentLink = chat.locator('.messages .document-link').filter({ hasText: 'planejamentos/fase1-station.md' })
  await documentLink.waitFor()
  await chat.getByRole('textbox', { name: 'Mensagem para o Omni' }).fill('Meu rascunho continua aqui')
  const windowOpened = app.waitForEvent('window'); await documentLink.click(); const reader = await windowOpened
  reader.on('pageerror', error => errors.push(error.message))
  await reader.getByRole('heading', { name: 'Plano de implantação', exact: true }).waitFor()
  assert.equal(await reader.locator('table tbody tr').count(), 2)
  assert.equal(await reader.evaluate(() => typeof window.omni), 'undefined', 'leitor não recebe API do chat/cofre')
  assert.equal(await reader.evaluate(() => typeof window.__unsafe), 'undefined')
  assert.equal(await reader.locator('.message-text script').count(), 0)
  assert.equal(await chat.getByRole('textbox', { name: 'Mensagem para o Omni' }).inputValue(), 'Meu rascunho continua aqui')
  assert.equal(await reader.locator('.document-toolbar p').innerText(), documentPath)
  await reader.getByRole('link', { name: 'Ir às etapas' }).click()
  await reader.getByRole('button', { name: 'Atualizar', exact: true }).click()
  await reader.getByRole('button', { name: 'Ver Markdown' }).click()
  assert.equal(await reader.locator('.document-source').textContent(), text)
  await reader.getByRole('button', { name: 'Ver formatado' }).click()
  await reader.getByRole('link', { name: 'Ausente' }).click()
  await reader.getByRole('alert').waitFor(); assert.match(await reader.getByRole('alert').innerText(), /Documento não encontrado/)
  const indexOpened = app.waitForEvent('window'); await reader.getByRole('link', { name: 'Índice', exact: true }).click(); const index = await indexOpened
  await index.getByRole('heading', { name: 'Índice', exact: true }).waitFor()
  await index.getByRole('link', { name: 'Plano', exact: true }).click()
  await reader.getByRole('heading', { name: 'Plano de implantação', exact: true }).waitFor()
  assert.equal(app.windows().length, 3, 'mesmo arquivo reutiliza a janela')
  await writeFile(documentPath, text.replace('Documento de teste', 'Documento atualizado'))
  await reader.getByRole('button', { name: 'Atualizar', exact: true }).click()
  await reader.getByText('Documento atualizado do leitor do Omni.', { exact: true }).waitFor()
  assert.equal(await readFile(documentPath, 'utf8'), text.replace('Documento de teste', 'Documento atualizado'), 'leitor não modifica o arquivo')
  const scopeError = await chat.evaluate(async id => { try { await window.omni.openDocument(id, '../executor/README.md'); return '' } catch (error) { return error.message } }, central.id)
  assert.match(scopeError, /fora da pasta/)
  await reader.evaluate(() => window.scrollTo(0, 0))
  await reader.screenshot({ path: join(directory, 'document-reader.png') })
  await chat.screenshot({ path: join(directory, 'document-link.png') })
  await index.close(); const closed = reader.waitForEvent('close')
  await reader.keyboard.press('Escape').catch(error => { if (!reader.isClosed()) throw error }); await closed
  assert.equal(await chat.getByRole('textbox', { name: 'Mensagem para o Omni' }).inputValue(), 'Meu rascunho continua aqui')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ status: 'passed', screenshots: directory, checks: ['link antigo', 'projeto do executor', 'janela independente', 'rascunho preservado', 'formatação e tabelas', 'HTML inerte', 'API isolada', 'links relativos', 'janela reutilizada', 'atualização', 'arquivo ausente', 'escopo', 'fechamento'] }))
  }
} finally { await app.close() }
