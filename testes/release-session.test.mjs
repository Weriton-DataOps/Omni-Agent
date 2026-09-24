import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { observarRuntimeCarregado } from '../runtime/release-session.mjs'
import { tratarHookReleaseLoaded } from '../runtime/hook-release-loaded.mjs'

test('readback por sessão identifica o hook executado, inclusive retomada sem transação de release', async () => {
  const home=await mkdtemp(join(tmpdir(),'omni-loaded-session-'))
  const root=join(home,'plugin-old')
  const input={hook_event_name:'UserPromptSubmit',session_id:'owner-session-one'}
  try {
    const verify=async () => ({releaseVersion:'0.24.1',fingerprint:'a'.repeat(64),status:'verified'})
    const output=await tratarHookReleaseLoaded(input,{}, {casaDoOmni:()=>home,pluginRoot:root,observationDeps:{verify}})
    assert.equal(output.loadedPlugin.version,'0.24.1','Instalação mais nova não altera a raiz observada')
    assert.match(output.hookSpecificOutput.additionalContext,/omni-runtime-carregado/)
    const file=join(home,'runtime','loaded-sessions',output.loadedPlugin.sessionKey+'.json')
    assert.equal(JSON.parse(await readFile(file,'utf8')).version,'0.24.1')
    const reloaded=await observarRuntimeCarregado(input,home,join(home,'plugin-new'),{verify:async()=>({releaseVersion:'0.24.3',fingerprint:'b'.repeat(64),status:'verified'})})
    assert.equal(JSON.parse(await readFile(file,'utf8')).version,'0.24.3')
    assert.notEqual(reloaded.rootFingerprint,output.loadedPlugin.rootFingerprint)
    const drifted=await observarRuntimeCarregado(input,home,root,{verify:async()=>({releaseVersion:'0.24.3',status:'drifted'})})
    assert.equal(drifted.integrity,'drifted')
    assert.equal(await observarRuntimeCarregado({...input,hook_event_name:'PostToolUse'},home,root),null)
    assert.equal(await observarRuntimeCarregado({...input,session_id:undefined},home,root),null)
  } finally {await rm(home,{recursive:true,force:true})}
})
