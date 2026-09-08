import { createHash } from 'node:crypto';
import { lstat, open, readdir, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { NodeLocalJsonStore } from '../local-json/node-local-json-store.js';
import { isExpectedClaudeTranscript, isPrimaryClaudeScope, scopeIdentity } from './host-input.js';
const MAX_ACTIVE_SESSION_MARKERS = 256;
const MAX_ACTIVE_SCOPE_MARKERS = 64;
const MAX_TRANSCRIPT_SAMPLE_BYTES = 2 * 1_024 * 1_024;
const MAX_TRANSCRIPT_LINES = 8_192;
const MAX_TRANSCRIPT_LINE_BYTES = 128 * 1_024;
function sanitizedError(error) {
    const record = error !== null && typeof error === 'object'
        ? error
        : null;
    const name = typeof record?.name === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,39}$/u.test(record.name)
        ? record.name
        : 'Error';
    const code = typeof record?.code === 'string' && /^[A-Z0-9_-]{1,40}$/u.test(record.code)
        ? record.code
        : null;
    return code ? `${name}/${code}` : name;
}
function sessionMarkerPaths(input, environment, home) {
    if (!isPrimaryClaudeScope(input) || typeof input.session_id !== 'string' || !input.session_id)
        return [];
    const id = createHash('sha256').update(input.session_id, 'utf8').digest('hex');
    const directories = [];
    if (typeof environment.CLAUDE_PLUGIN_DATA === 'string' && isAbsolute(environment.CLAUDE_PLUGIN_DATA)) {
        directories.push(join(environment.CLAUDE_PLUGIN_DATA, 'active-sessions'));
    }
    if (isAbsolute(home))
        directories.push(join(home, 'runtime', 'active-sessions'));
    return [...new Set(directories)].map((directory) => join(directory, `${id}.json`));
}
async function readTranscriptSample(file) {
    const before = await lstat(file);
    if (!before.isFile() || before.isSymbolicLink())
        return null;
    const handle = await open(file, 'r');
    try {
        const current = await handle.stat();
        if (!current.isFile() || current.dev !== before.dev || current.ino !== before.ino)
            return null;
        const readAt = async (length, position) => {
            const buffer = Buffer.allocUnsafe(length);
            const { bytesRead } = await handle.read(buffer, 0, length, position);
            return buffer.subarray(0, bytesRead).toString('utf8');
        };
        if (current.size <= MAX_TRANSCRIPT_SAMPLE_BYTES) {
            return { head: await readAt(current.size, 0), tail: '' };
        }
        const half = Math.floor(MAX_TRANSCRIPT_SAMPLE_BYTES / 2);
        const [headRaw, tailRaw] = await Promise.all([
            readAt(half, 0),
            readAt(half, Math.max(0, current.size - half))
        ]);
        const headBoundary = headRaw.lastIndexOf('\n');
        const tailBoundary = tailRaw.indexOf('\n');
        return {
            head: headBoundary >= 0 ? headRaw.slice(0, headBoundary + 1) : '',
            tail: tailBoundary >= 0 ? tailRaw.slice(tailBoundary + 1) : ''
        };
    }
    finally {
        await handle.close();
    }
}
function lineConfirmsActivation(line, sessionId) {
    const normalized = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (!normalized.trim() || Buffer.byteLength(normalized, 'utf8') > MAX_TRANSCRIPT_LINE_BYTES)
        return false;
    try {
        return recordConfirmsActivation(JSON.parse(normalized), sessionId);
    }
    catch {
        return false;
    }
}
function sampleConfirmsActivation(sample, sessionId) {
    const perSide = Math.floor(MAX_TRANSCRIPT_LINES / 2);
    let start = 0;
    for (let count = 0; count < perSide && start <= sample.head.length; count += 1) {
        const boundary = sample.head.indexOf('\n', start);
        const end = boundary >= 0 ? boundary : sample.head.length;
        if (lineConfirmsActivation(sample.head.slice(start, end), sessionId))
            return true;
        if (boundary < 0)
            break;
        start = boundary + 1;
    }
    let end = sample.tail.length;
    for (let count = 0; count < perSide && end > 0; count += 1) {
        const boundary = sample.tail.lastIndexOf('\n', end - 1);
        const startOfLine = boundary + 1;
        if (lineConfirmsActivation(sample.tail.slice(startOfLine, end), sessionId))
            return true;
        end = boundary;
    }
    return false;
}
function scopeMarkerPath(input, home) {
    const id = scopeIdentity(input);
    return id && isAbsolute(home) ? join(home, 'runtime', 'active-scopes', `${id}.json`) : null;
}
async function limitMarkers(currentFiles, limit) {
    const current = new Set(currentFiles);
    const directories = [...new Set(currentFiles.map((file) => dirname(file)))];
    for (const directory of directories) {
        try {
            const names = (await readdir(directory, { withFileTypes: true }))
                .filter((item) => item.isFile() && /^[a-f0-9]{64}\.json$/u.test(item.name))
                .map((item) => join(directory, item.name));
            if (names.length <= limit)
                continue;
            const ordered = (await Promise.all(names.map(async (file) => ({
                file,
                mtimeMs: (await stat(file)).mtimeMs
            })))).sort((left, right) => left.mtimeMs - right.mtimeMs || left.file.localeCompare(right.file));
            let excess = names.length - limit;
            for (const item of ordered) {
                if (excess <= 0)
                    break;
                if (current.has(item.file))
                    continue;
                await rm(item.file, { force: true });
                excess -= 1;
            }
        }
        catch {
            // Retention is best-effort and cannot block personality activation.
        }
    }
}
export class ClaudeActivationStore {
    home;
    environment;
    markers;
    constructor(home, environment, markers = new NodeLocalJsonStore()) {
        this.home = home;
        this.environment = environment;
        this.markers = markers;
    }
    async activate(input, options = {}) {
        const failures = [];
        let written = 0;
        const files = sessionMarkerPaths(input, this.environment, this.home);
        const content = { schemaVersion: 1, activatedAt: new Date().toISOString() };
        for (const [index, file] of files.entries()) {
            try {
                await this.markers.write(file, content);
                written += 1;
            }
            catch (error) {
                failures.push({
                    nome: `estado-sessao-${index === 0 ? 'primario' : 'alternativo'}`,
                    mensagem: sanitizedError(error)
                });
            }
        }
        await limitMarkers(files, MAX_ACTIVE_SESSION_MARKERS);
        if (options.persistScope) {
            const scope = await this.activateScope(input);
            written += scope.gravados;
            failures.push(...scope.falhas);
        }
        return { gravados: written, falhas: failures };
    }
    async isSessionActive(input) {
        const failures = [];
        for (const [index, file] of sessionMarkerPaths(input, this.environment, this.home).entries()) {
            try {
                const state = await this.markers.read(file);
                if (state === null)
                    continue;
                if (state !== null && typeof state === 'object' && !Array.isArray(state) &&
                    state.schemaVersion === 1) {
                    return { ativa: true, falhas: failures };
                }
                failures.push({
                    nome: `estado-sessao-${index === 0 ? 'primario' : 'alternativo'}`,
                    mensagem: 'marcador com schemaVersion inesperada'
                });
            }
            catch (error) {
                const code = error !== null && typeof error === 'object'
                    ? error.code
                    : null;
                if (code !== 'ENOENT') {
                    failures.push({
                        nome: `estado-sessao-${index === 0 ? 'primario' : 'alternativo'}`,
                        mensagem: sanitizedError(error)
                    });
                }
            }
        }
        return { ativa: false, falhas: failures };
    }
    async isScopeActive(input) {
        const file = scopeMarkerPath(input, this.home);
        if (!file)
            return { ativa: false, falhas: [] };
        try {
            const state = await this.markers.read(file);
            if (state === null)
                return { ativa: false, falhas: [] };
            const record = state !== null && typeof state === 'object' && !Array.isArray(state)
                ? state
                : null;
            if (record?.schemaVersion === 1 && record.activationPolicy === 'cwd-opt-in') {
                return { ativa: true, falhas: [] };
            }
            return {
                ativa: false,
                falhas: [{ nome: 'estado-escopo-persistente', mensagem: 'marcador com contrato inesperado' }]
            };
        }
        catch (error) {
            const code = error !== null && typeof error === 'object'
                ? error.code
                : null;
            return code === 'ENOENT'
                ? { ativa: false, falhas: [] }
                : { ativa: false, falhas: [{ nome: 'estado-escopo-persistente', mensagem: sanitizedError(error) }] };
        }
    }
    async persistActiveSessionScope(input) {
        if (!scopeMarkerPath(input, this.home))
            return [];
        const state = await this.isScopeActive(input);
        if (state.ativa)
            return state.falhas;
        const activation = await this.activateScope(input);
        return [...state.falhas, ...activation.falhas];
    }
    async activateScope(input) {
        const file = scopeMarkerPath(input, this.home);
        if (!file)
            return { gravados: 0, falhas: [] };
        try {
            await this.markers.write(file, {
                schemaVersion: 1,
                activationPolicy: 'cwd-opt-in',
                activatedAt: new Date().toISOString()
            });
            await limitMarkers([file], MAX_ACTIVE_SCOPE_MARKERS);
            return { gravados: 1, falhas: [] };
        }
        catch (error) {
            return {
                gravados: 0,
                falhas: [{ nome: 'estado-escopo-persistente', mensagem: sanitizedError(error) }]
            };
        }
    }
    async transcriptConfirmsActivation(input) {
        const file = input.transcript_path;
        if (!isExpectedClaudeTranscript(input) ||
            typeof input.session_id !== 'string' || !input.session_id ||
            typeof file !== 'string')
            return false;
        try {
            const sample = await readTranscriptSample(file);
            return sample !== null && sampleConfirmsActivation(sample, input.session_id);
        }
        catch {
            // Missing or unreadable transcript never activates another session.
        }
        return false;
    }
}
function recordConfirmsActivation(value, sessionId) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return false;
    const record = value;
    const message = record.message !== null && typeof record.message === 'object' && !Array.isArray(record.message)
        ? record.message
        : null;
    const origin = record.origin !== null && typeof record.origin === 'object' && !Array.isArray(record.origin)
        ? record.origin
        : null;
    if (record.type !== 'user' || message?.role !== 'user' || origin?.kind !== 'human' ||
        record.isSidechain === true || record.isMeta === true ||
        (record.sessionId ?? record.session_id) !== sessionId || typeof message?.content !== 'string')
        return false;
    return /^<command-message>(?:omni:)?omni<\/command-message>\r?\n<command-name>\/(?:omni:)?omni<\/command-name>(?:\r?\n<command-args>[\s\S]*<\/command-args>)?$/iu.test(message.content.trim());
}
