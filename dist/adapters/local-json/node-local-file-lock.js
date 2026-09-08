import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat, utimes } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const CONTENTION_CODES = new Set(['EEXIST', 'EACCES', 'EPERM']);
export class LocalJsonLockTimeoutError extends Error {
    path;
    timeoutMs;
    constructor(path, timeoutMs, message = `Nao foi possivel adquirir o lock de ${path} em ${timeoutMs} ms.`) {
        super(message);
        this.path = path;
        this.timeoutMs = timeoutMs;
        this.name = 'LocalJsonLockTimeoutError';
    }
}
function errorCode(error) {
    if (error === null || typeof error !== 'object' || !('code' in error))
        return undefined;
    const code = error.code;
    return typeof code === 'string' ? code : undefined;
}
export function isLockContentionError(error) {
    const code = errorCode(error);
    return code !== undefined && CONTENTION_CODES.has(code);
}
function isMissing(error) {
    return errorCode(error) === 'ENOENT';
}
function parseLockDocument(value) {
    try {
        const parsed = JSON.parse(value);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
            return null;
        const candidate = parsed;
        if (typeof candidate.token !== 'string' ||
            typeof candidate.pid !== 'number' ||
            typeof candidate.acquiredAt !== 'string')
            return null;
        return { token: candidate.token, pid: candidate.pid, acquiredAt: candidate.acquiredAt };
    }
    catch {
        return null;
    }
}
export class NodeLocalFileLock {
    acquisitionTimeoutMs;
    retryDelayMs;
    staleLockMs;
    heartbeatMs;
    recoverStaleLocks;
    timeoutMessage;
    constructor(options = {}) {
        this.acquisitionTimeoutMs = options.acquisitionTimeoutMs ?? 5_000;
        this.retryDelayMs = options.retryDelayMs ?? 15;
        this.staleLockMs = options.staleLockMs ?? 30_000;
        this.heartbeatMs = options.heartbeatMs ?? Math.max(250, Math.floor(this.staleLockMs / 3));
        this.recoverStaleLocks = options.recoverStaleLocks ?? true;
        this.timeoutMessage = options.timeoutMessage;
        if (this.acquisitionTimeoutMs <= 0 || this.retryDelayMs <= 0 || this.staleLockMs <= 0 || this.heartbeatMs <= 0) {
            throw new RangeError('Tempos do lock local precisam ser positivos.');
        }
        if (this.heartbeatMs >= this.staleLockMs) {
            throw new RangeError('Heartbeat do lock precisa ocorrer antes de ele ser considerado stale.');
        }
        if (this.timeoutMessage !== undefined && this.timeoutMessage.length === 0) {
            throw new RangeError('Mensagem de timeout do lock nao pode ser vazia.');
        }
    }
    async acquire(lockPath) {
        await mkdir(dirname(lockPath), { recursive: true });
        const deadline = Date.now() + this.acquisitionTimeoutMs;
        while (true) {
            const token = randomUUID();
            const document = { token, pid: process.pid, acquiredAt: new Date().toISOString() };
            try {
                const handle = await open(lockPath, 'wx', 0o600);
                try {
                    await handle.writeFile(`${JSON.stringify(document)}\n`, 'utf8');
                    await handle.sync();
                }
                catch (error) {
                    await handle.close().catch(() => undefined);
                    await this.removeCreatedLock(lockPath, deadline);
                    throw error;
                }
                await handle.close();
                return this.heldLock(lockPath, token);
            }
            catch (error) {
                if (!isLockContentionError(error))
                    throw error;
                if (this.recoverStaleLocks)
                    await this.recoverStale(lockPath);
                if (Date.now() >= deadline) {
                    throw new LocalJsonLockTimeoutError(lockPath, this.acquisitionTimeoutMs, this.timeoutMessage);
                }
                await this.waitBeforeRetry(deadline);
            }
        }
    }
    async run(lockPath, operation) {
        const lock = await this.acquire(lockPath);
        try {
            return await operation();
        }
        finally {
            await lock.release();
        }
    }
    heldLock(lockPath, token) {
        let released = false;
        let heartbeatWork = Promise.resolve();
        const heartbeat = setInterval(() => {
            if (released)
                return;
            heartbeatWork = heartbeatWork
                .then(() => this.refreshOwnedLock(lockPath, token))
                .catch(() => undefined);
        }, this.heartbeatMs);
        heartbeat.unref();
        return {
            path: lockPath,
            token,
            release: async () => {
                if (released)
                    return;
                released = true;
                clearInterval(heartbeat);
                await heartbeatWork;
                await this.removeOwnedLock(lockPath, token);
            }
        };
    }
    async refreshOwnedLock(lockPath, token) {
        try {
            const current = parseLockDocument(await readFile(lockPath, 'utf8'));
            if (current?.token !== token)
                return;
            const now = new Date();
            await utimes(lockPath, now, now);
        }
        catch (error) {
            if (!isMissing(error) && !isLockContentionError(error))
                throw error;
        }
    }
    async removeOwnedLock(lockPath, token) {
        const deadline = Date.now() + this.acquisitionTimeoutMs;
        while (true) {
            try {
                const current = parseLockDocument(await readFile(lockPath, 'utf8'));
                if (current?.token !== token)
                    return;
                await rm(lockPath);
                return;
            }
            catch (error) {
                if (isMissing(error))
                    return;
                if (!isLockContentionError(error))
                    throw error;
                if (Date.now() >= deadline)
                    return;
                await this.waitBeforeRetry(deadline);
            }
        }
    }
    async removeCreatedLock(lockPath, deadline) {
        while (true) {
            try {
                await rm(lockPath, { force: true });
                return;
            }
            catch (error) {
                if (isMissing(error))
                    return;
                if (!isLockContentionError(error) || Date.now() >= deadline)
                    return;
                await this.waitBeforeRetry(deadline);
            }
        }
    }
    async recoverStale(lockPath) {
        try {
            const before = await stat(lockPath);
            if (Date.now() - before.mtimeMs < this.staleLockMs)
                return false;
            const document = parseLockDocument(await readFile(lockPath, 'utf8'));
            const acquiredAt = document === null ? Number.NaN : Date.parse(document.acquiredAt);
            if (Number.isFinite(acquiredAt) && Date.now() - acquiredAt < this.staleLockMs)
                return false;
            const after = await stat(lockPath);
            if (before.dev !== after.dev ||
                before.ino !== after.ino ||
                before.mtimeMs !== after.mtimeMs ||
                before.size !== after.size)
                return false;
            const quarantine = `${lockPath}.stale.${randomUUID()}`;
            try {
                await rename(lockPath, quarantine);
            }
            catch (error) {
                if (isMissing(error) || isLockContentionError(error))
                    return false;
                throw error;
            }
            await rm(quarantine, { force: true });
            return true;
        }
        catch (error) {
            if (isMissing(error) || isLockContentionError(error))
                return false;
            throw error;
        }
    }
    async waitBeforeRetry(deadline) {
        await delay(Math.max(1, Math.min(this.retryDelayMs, deadline - Date.now())));
    }
}
export async function acquireLocalFileLock(lockPath, options = {}) {
    return new NodeLocalFileLock(options).acquire(lockPath);
}
export async function withLocalFileLock(lockPath, operation, options = {}) {
    return new NodeLocalFileLock(options).run(lockPath, operation);
}
