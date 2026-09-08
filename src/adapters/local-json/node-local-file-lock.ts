import { randomUUID } from 'node:crypto'
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  utimes
} from 'node:fs/promises'
import { dirname } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const CONTENTION_CODES = new Set(['EEXIST', 'EACCES', 'EPERM'])

export interface NodeLocalFileLockOptions {
  acquisitionTimeoutMs?: number
  retryDelayMs?: number
  staleLockMs?: number
  heartbeatMs?: number
  recoverStaleLocks?: boolean
  timeoutMessage?: string
}

interface LockDocument {
  token: string
  pid: number
  acquiredAt: string
}

export interface LocalFileLockHandle {
  readonly path: string
  readonly token: string
  release(): Promise<void>
}

export class LocalJsonLockTimeoutError extends Error {
  constructor(
    readonly path: string,
    readonly timeoutMs: number,
    message = `Nao foi possivel adquirir o lock de ${path} em ${timeoutMs} ms.`
  ) {
    super(message)
    this.name = 'LocalJsonLockTimeoutError'
  }
}

function errorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object' || !('code' in error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

export function isLockContentionError(error: unknown): boolean {
  const code = errorCode(error)
  return code !== undefined && CONTENTION_CODES.has(code)
}

function isMissing(error: unknown): boolean {
  return errorCode(error) === 'ENOENT'
}

function parseLockDocument(value: string): LockDocument | null {
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const candidate = parsed as Record<string, unknown>
    if (
      typeof candidate.token !== 'string' ||
      typeof candidate.pid !== 'number' ||
      typeof candidate.acquiredAt !== 'string'
    ) return null
    return { token: candidate.token, pid: candidate.pid, acquiredAt: candidate.acquiredAt }
  } catch {
    return null
  }
}

export class NodeLocalFileLock {
  private readonly acquisitionTimeoutMs: number
  private readonly retryDelayMs: number
  private readonly staleLockMs: number
  private readonly heartbeatMs: number
  private readonly recoverStaleLocks: boolean
  private readonly timeoutMessage: string | undefined

  constructor(options: NodeLocalFileLockOptions = {}) {
    this.acquisitionTimeoutMs = options.acquisitionTimeoutMs ?? 5_000
    this.retryDelayMs = options.retryDelayMs ?? 15
    this.staleLockMs = options.staleLockMs ?? 30_000
    this.heartbeatMs = options.heartbeatMs ?? Math.max(250, Math.floor(this.staleLockMs / 3))
    this.recoverStaleLocks = options.recoverStaleLocks ?? true
    this.timeoutMessage = options.timeoutMessage
    if (this.acquisitionTimeoutMs <= 0 || this.retryDelayMs <= 0 || this.staleLockMs <= 0 || this.heartbeatMs <= 0) {
      throw new RangeError('Tempos do lock local precisam ser positivos.')
    }
    if (this.heartbeatMs >= this.staleLockMs) {
      throw new RangeError('Heartbeat do lock precisa ocorrer antes de ele ser considerado stale.')
    }
    if (this.timeoutMessage !== undefined && this.timeoutMessage.length === 0) {
      throw new RangeError('Mensagem de timeout do lock nao pode ser vazia.')
    }
  }

  async acquire(lockPath: string): Promise<LocalFileLockHandle> {
    await mkdir(dirname(lockPath), { recursive: true })
    const deadline = Date.now() + this.acquisitionTimeoutMs
    while (true) {
      const token = randomUUID()
      const document: LockDocument = { token, pid: process.pid, acquiredAt: new Date().toISOString() }
      try {
        const handle = await open(lockPath, 'wx', 0o600)
        try {
          await handle.writeFile(`${JSON.stringify(document)}\n`, 'utf8')
          await handle.sync()
        } catch (error: unknown) {
          await handle.close().catch(() => undefined)
          await this.removeCreatedLock(lockPath, deadline)
          throw error
        }
        await handle.close()
        return this.heldLock(lockPath, token)
      } catch (error: unknown) {
        if (!isLockContentionError(error)) throw error
        if (this.recoverStaleLocks) await this.recoverStale(lockPath)
        if (Date.now() >= deadline) {
          throw new LocalJsonLockTimeoutError(lockPath, this.acquisitionTimeoutMs, this.timeoutMessage)
        }
        await this.waitBeforeRetry(deadline)
      }
    }
  }

  async run<T>(lockPath: string, operation: () => T | Promise<T>): Promise<T> {
    const lock = await this.acquire(lockPath)
    try {
      return await operation()
    } finally {
      await lock.release()
    }
  }

  private heldLock(lockPath: string, token: string): LocalFileLockHandle {
    let released = false
    let heartbeatWork = Promise.resolve()
    const heartbeat = setInterval(() => {
      if (released) return
      heartbeatWork = heartbeatWork
        .then(() => this.refreshOwnedLock(lockPath, token))
        .catch(() => undefined)
    }, this.heartbeatMs)
    heartbeat.unref()
    return {
      path: lockPath,
      token,
      release: async (): Promise<void> => {
        if (released) return
        released = true
        clearInterval(heartbeat)
        await heartbeatWork
        await this.removeOwnedLock(lockPath, token)
      }
    }
  }

  private async refreshOwnedLock(lockPath: string, token: string): Promise<void> {
    try {
      const current = parseLockDocument(await readFile(lockPath, 'utf8'))
      if (current?.token !== token) return
      const now = new Date()
      await utimes(lockPath, now, now)
    } catch (error: unknown) {
      if (!isMissing(error) && !isLockContentionError(error)) throw error
    }
  }

  private async removeOwnedLock(lockPath: string, token: string): Promise<void> {
    const deadline = Date.now() + this.acquisitionTimeoutMs
    while (true) {
      try {
        const current = parseLockDocument(await readFile(lockPath, 'utf8'))
        if (current?.token !== token) return
        await rm(lockPath)
        return
      } catch (error: unknown) {
        if (isMissing(error)) return
        if (!isLockContentionError(error)) throw error
        if (Date.now() >= deadline) return
        await this.waitBeforeRetry(deadline)
      }
    }
  }

  private async removeCreatedLock(lockPath: string, deadline: number): Promise<void> {
    while (true) {
      try {
        await rm(lockPath, { force: true })
        return
      } catch (error: unknown) {
        if (isMissing(error)) return
        if (!isLockContentionError(error) || Date.now() >= deadline) return
        await this.waitBeforeRetry(deadline)
      }
    }
  }

  private async recoverStale(lockPath: string): Promise<boolean> {
    try {
      const before = await stat(lockPath)
      if (Date.now() - before.mtimeMs < this.staleLockMs) return false
      const document = parseLockDocument(await readFile(lockPath, 'utf8'))
      const acquiredAt = document === null ? Number.NaN : Date.parse(document.acquiredAt)
      if (Number.isFinite(acquiredAt) && Date.now() - acquiredAt < this.staleLockMs) return false
      const after = await stat(lockPath)
      if (
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.mtimeMs !== after.mtimeMs ||
        before.size !== after.size
      ) return false
      const quarantine = `${lockPath}.stale.${randomUUID()}`
      try {
        await rename(lockPath, quarantine)
      } catch (error: unknown) {
        if (isMissing(error) || isLockContentionError(error)) return false
        throw error
      }
      await rm(quarantine, { force: true })
      return true
    } catch (error: unknown) {
      if (isMissing(error) || isLockContentionError(error)) return false
      throw error
    }
  }

  private async waitBeforeRetry(deadline: number): Promise<void> {
    await delay(Math.max(1, Math.min(this.retryDelayMs, deadline - Date.now())))
  }
}

export async function acquireLocalFileLock(
  lockPath: string,
  options: NodeLocalFileLockOptions = {}
): Promise<LocalFileLockHandle> {
  return new NodeLocalFileLock(options).acquire(lockPath)
}

export async function withLocalFileLock<T>(
  lockPath: string,
  operation: () => T | Promise<T>,
  options: NodeLocalFileLockOptions = {}
): Promise<T> {
  return new NodeLocalFileLock(options).run(lockPath, operation)
}
