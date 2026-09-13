import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalUpdateService } from '../src/main/update-service'

type Entry = { size: number; mtimeMs: number }
const deps = (files: Map<string, Entry>, now = () => new Date('2026-09-13T12:00:00.000Z')) => ({
  stat: async (path: string) => { const file = files.get(path); if (!file) throw new Error('not found'); return file },
  now
})

test('build local só fica disponível depois de duas leituras estáveis', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-update-'))
  try {
    const main = join(dir, 'main.js'), renderer = join(dir, 'renderer.html')
    const files = new Map([[main, { size: 10, mtimeMs: 1000 }], [renderer, { size: 20, mtimeMs: 1000 }]])
    const service = new LocalUpdateService([main, renderer], join(dir, 'preferences.json'), deps(files))
    assert.equal((await service.initialize()).state, 'current')
    files.set(main, { size: 11, mtimeMs: 2000 })
    assert.equal((await service.check()).state, 'current')
    const ready = await service.check()
    assert.equal(ready.state, 'available'); assert.ok(ready.availableVersion); assert.equal(service.canApply(), true)
    assert.equal(service.markApplying().state, 'applying')
  } finally { await rm(dir, { recursive: true }) }
})

test('build em escrita contínua não aparece como atualização até estabilizar', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-update-stable-'))
  try {
    const main = join(dir, 'main.js'), renderer = join(dir, 'renderer.html')
    const files = new Map([[main, { size: 10, mtimeMs: 1000 }], [renderer, { size: 20, mtimeMs: 1000 }]])
    const service = new LocalUpdateService([main, renderer], join(dir, 'preferences.json'), deps(files)); await service.initialize()
    files.set(main, { size: 11, mtimeMs: 2000 }); await service.check()
    files.set(renderer, { size: 21, mtimeMs: 3000 }); assert.equal((await service.check()).state, 'current')
    assert.equal((await service.check()).state, 'available')
  } finally { await rm(dir, { recursive: true }) }
})

test('a preferência de atualização automática persiste sem acessar a build', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-update-preferences-'))
  try {
    const main = join(dir, 'main.js'), renderer = join(dir, 'renderer.html'), preferences = join(dir, 'preferences.json')
    const files = new Map([[main, { size: 10, mtimeMs: 1000 }], [renderer, { size: 20, mtimeMs: 1000 }]])
    const service = new LocalUpdateService([main, renderer], preferences, deps(files)); await service.initialize(); await service.setAutoApply(true)
    const restored = new LocalUpdateService([main, renderer], preferences, deps(files)); assert.equal((await restored.initialize()).autoApply, true)
  } finally { await rm(dir, { recursive: true }) }
})

test('a confirmação de atualização só aparece depois de reabrir na build registrada', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-update-applied-'))
  try {
    const main = join(dir, 'main.js'), renderer = join(dir, 'renderer.html'), preferences = join(dir, 'preferences.json')
    const files = new Map([[main, { size: 10, mtimeMs: 1000 }], [renderer, { size: 20, mtimeMs: 1000 }]])
    const first = new LocalUpdateService([main, renderer], preferences, deps(files))
    await first.initialize(); files.set(main, { size: 11, mtimeMs: 2000 })
    await first.check(); await first.check(); await first.recordApplying(); first.markApplying()
    const reopened = new LocalUpdateService([main, renderer], preferences, deps(files))
    const status = await reopened.initialize()
    assert.ok(status.lastAppliedAt)
    assert.match(status.detail, /foi aplicada/i)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
