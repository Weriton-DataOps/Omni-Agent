import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

import {
  LocalJsonLockTimeoutError,
  NodeLocalJsonStore,
  acquireLocalFileLock,
  isLockContentionError,
  lockPathFor
} from '../src/adapters/local-json/node-local-json-store.js'

test('LocalJsonStore serializa updates concorrentes sem perder escrita', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'omni-local-json-'))
  const path = join(directory, 'state.json')
  const store = new NodeLocalJsonStore({
    acquisitionTimeoutMs: 5_000,
    retryDelayMs: 2,
    staleLockMs: 1_000,
    heartbeatMs: 100
  })
  try {
    await store.write(path, { count: 0 })
    await Promise.all(Array.from({ length: 24 }, (_, index) => store.update(path, async (current) => {
      await delay(index % 3)
      const count = current && typeof current === 'object' && !Array.isArray(current) && 'count' in current
        ? Number((current as { count: unknown }).count)
        : 0
      return { count: count + 1 }
    })))
    assert.deepEqual(await store.read(path), { count: 24 })
    assert.equal(await readFile(lockPathFor(path), 'utf8').then(() => true, () => false), false)
    assert.deepEqual((await readdir(directory)).sort(), ['state.json'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('LocalJsonStore recupera lock stale por token e rename antes de escrever', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'omni-stale-json-'))
  const path = join(directory, 'state.json')
  const lockPath = lockPathFor(path)
  const store = new NodeLocalJsonStore({
    acquisitionTimeoutMs: 2_000,
    retryDelayMs: 2,
    staleLockMs: 50,
    heartbeatMs: 10
  })
  try {
    await writeFile(path, '{"count":1}\n', 'utf8')
    await writeFile(lockPath, JSON.stringify({
      token: 'stale-token',
      pid: 999_999,
      acquiredAt: '2020-01-01T00:00:00.000Z'
    }), 'utf8')
    const old = new Date(Date.now() - 10_000)
    await utimes(lockPath, old, old)
    await store.update(path, () => ({ count: 2 }))
    assert.deepEqual(await store.read(path), { count: 2 })
    assert.deepEqual((await readdir(directory)).sort(), ['state.json'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('contenção de lock inclui erros transitórios do Windows', () => {
  for (const code of ['EEXIST', 'EACCES', 'EPERM']) {
    assert.equal(isLockContentionError(Object.assign(new Error(code), { code })), true)
  }
  assert.equal(isLockContentionError(Object.assign(new Error('missing'), { code: 'ENOENT' })), false)
})

test('file lock mantem token vivo por heartbeat e nao e roubado quando ultrapassa o stale', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'omni-heartbeat-lock-'))
  const path = join(directory, 'shared.lock')
  const first = await acquireLocalFileLock(path, {
    acquisitionTimeoutMs: 1_000,
    retryDelayMs: 2,
    staleLockMs: 300,
    heartbeatMs: 25
  })
  try {
    await delay(450)
    await assert.rejects(
      acquireLocalFileLock(path, {
        acquisitionTimeoutMs: 100,
        retryDelayMs: 2,
        staleLockMs: 300,
        heartbeatMs: 25
      }),
      LocalJsonLockTimeoutError
    )
    const document = JSON.parse(await readFile(path, 'utf8')) as { token: string }
    assert.equal(document.token, first.token)
  } finally {
    await first.release()
    await rm(directory, { recursive: true, force: true })
  }
})

test('release nunca remove lock cujo token passou a pertencer a outro escritor', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'omni-token-lock-'))
  const path = join(directory, 'shared.lock')
  const lock = await acquireLocalFileLock(path, {
    acquisitionTimeoutMs: 1_000,
    retryDelayMs: 2,
    staleLockMs: 1_000,
    heartbeatMs: 100
  })
  try {
    const replacement = {
      token: 'replacement-token',
      pid: process.pid,
      acquiredAt: new Date().toISOString()
    }
    await writeFile(path, `${JSON.stringify(replacement)}\n`, 'utf8')
    await lock.release()
    const current = JSON.parse(await readFile(path, 'utf8')) as { token: string }
    assert.equal(current.token, replacement.token)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
