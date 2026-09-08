import { randomUUID } from 'node:crypto'
import {
  mkdir,
  open,
  readFile,
  rename,
  rm
} from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { canonicalJson, type JsonValue } from '../../core/shared/json.js'
import type { LocalJsonStore, LocalJsonUpdater } from '../../ports/local-json-store.js'
import {
  NodeLocalFileLock,
  isLockContentionError,
  type NodeLocalFileLockOptions
} from './node-local-file-lock.js'

export type NodeLocalJsonStoreOptions = NodeLocalFileLockOptions
export {
  LocalJsonLockTimeoutError,
  NodeLocalFileLock,
  acquireLocalFileLock,
  isLockContentionError,
  withLocalFileLock
} from './node-local-file-lock.js'
export type {
  LocalFileLockHandle,
  NodeLocalFileLockOptions
} from './node-local-file-lock.js'

function isMissing(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
}

export function lockPathFor(path: string): string {
  return `${path}.lock`
}

export class NodeLocalJsonStore implements LocalJsonStore {
  private readonly acquisitionTimeoutMs: number
  private readonly retryDelayMs: number
  private readonly fileLock: NodeLocalFileLock

  constructor(options: NodeLocalJsonStoreOptions = {}) {
    this.acquisitionTimeoutMs = options.acquisitionTimeoutMs ?? 5_000
    this.retryDelayMs = options.retryDelayMs ?? 15
    this.fileLock = new NodeLocalFileLock(options)
  }

  async read(path: string): Promise<unknown | null> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as unknown
    } catch (error: unknown) {
      if (isMissing(error)) return null
      throw error
    }
  }

  async write(path: string, value: JsonValue): Promise<void> {
    canonicalJson(value)
    const lock = await this.fileLock.acquire(lockPathFor(path))
    try {
      await this.atomicWrite(path, value)
    } finally {
      await lock.release()
    }
  }

  async update(path: string, updater: LocalJsonUpdater): Promise<JsonValue> {
    const lock = await this.fileLock.acquire(lockPathFor(path))
    try {
      const next = await updater(await this.read(path))
      canonicalJson(next)
      await this.atomicWrite(path, next)
      return next
    } finally {
      await lock.release()
    }
  }

  private async atomicWrite(path: string, value: JsonValue): Promise<void> {
    const directory = dirname(path)
    await mkdir(directory, { recursive: true })
    const temporary = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      const deadline = Date.now() + this.acquisitionTimeoutMs
      while (true) {
        try {
          await rename(temporary, path)
          break
        } catch (error: unknown) {
          if (!isLockContentionError(error) || Date.now() >= deadline) throw error
          await delay(this.retryDelayMs)
        }
      }
    } finally {
      await rm(temporary, { force: true })
    }
  }
}
