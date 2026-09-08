import { connect } from 'node:net';
import { parseCredentialMetadata } from '../../contracts/credential-metadata.js';
const PIPE_NAME = '\\\\.\\pipe\\omni-access-broker-v8';
const MAX_RESPONSE_BYTES = 64 * 1024;
const TIMESTAMP_KEYS = ['issuedAt', 'expiresAt', 'statusChangedAt', 'lastCheckedAt', 'lastSuccessAt', 'unusableSince', 'lastFailureAt', 'revokedAt', 'nextCheckAt', 'nextRetryAt'];
function record(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Access broker returned an invalid response.');
    return value;
}
function safeIdentifier(value, label) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(value))
        throw new Error(`${label} is invalid.`);
    return value;
}
function safeVersion(value) {
    if (!Number.isSafeInteger(value) || value < 1)
        throw new Error('Credential version is invalid.');
    return value;
}
function credentialObservation(value) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(value.eventId) || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(value.credentialId) || !Number.isSafeInteger(value.version) || value.version < 1 ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(value.providerRef) || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(value.accountRef) || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(value.environmentRef) ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(value.evidenceRef) || !['authenticated', 'invalid-token', 'revoked', 'insufficient-scope', 'timeout', 'unavailable', 'rate-limited', 'reported-not-working', 'disabled', 'replaced'].includes(value.kind) ||
        !Number.isFinite(Date.parse(value.startedAt)) || !Number.isFinite(Date.parse(value.completedAt)) || Date.parse(value.startedAt) > Date.parse(value.completedAt) ||
        (value.replacedById !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(value.replacedById)) || (value.kind === 'replaced' && (!value.replacedById || value.replacedById === value.credentialId))) {
        throw new Error('Credential observation is invalid.');
    }
    return value;
}
function memoryEntry(value) {
    if (!/^mem-[a-zA-Z0-9-]{1,160}$/u.test(value.id) || !/^[a-f0-9]{64}$/u.test(value.textFingerprint))
        throw new Error('Durable memory id or fingerprint is invalid.');
    if (!['confirmed', 'candidate'].includes(value.lane) || !['preference', 'episodic', 'semantic', 'procedural', 'objective', 'capability'].includes(value.type))
        throw new Error('Durable memory lane or type is invalid.');
    if (!['user', 'project', 'task', 'environment'].includes(value.scopeType) || (value.scopeType === 'user' ? value.scopeId !== null || value.projectId !== null : value.scopeId === null))
        throw new Error('Durable memory scope is invalid.');
    if ((value.scopeId !== null && !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(value.scopeId)) || (value.projectId !== null && !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(value.projectId)))
        throw new Error('Durable memory scope reference is invalid.');
    if (value.payload === null || Array.isArray(value.payload) || typeof value.payload !== 'object' || !Number.isFinite(Date.parse(value.sourceUpdatedAt)))
        throw new Error('Durable memory payload is invalid.');
    return value;
}
/** The trusted PowerShell host may serialize UTC as +00; contracts use canonical Z milliseconds. */
function canonicalizeBrokerCredential(value) {
    const source = record(value);
    const result = { ...source };
    for (const key of TIMESTAMP_KEYS) {
        if (result[key] === null)
            continue;
        if (typeof result[key] !== 'string')
            throw new Error(`Broker credential ${key} is invalid.`);
        const parsed = Date.parse(result[key]);
        if (!Number.isFinite(parsed))
            throw new Error(`Broker credential ${key} is invalid.`);
        result[key] = new Date(parsed).toISOString();
    }
    return result;
}
export class NodeAccessBrokerClient {
    pipeName;
    timeoutMs;
    constructor(pipeName = PIPE_NAME, timeoutMs = 1_500) {
        this.pipeName = pipeName;
        this.timeoutMs = timeoutMs;
        if (!/^\\\\\.\\pipe\\[a-zA-Z0-9._-]{1,120}$/u.test(pipeName))
            throw new Error('Access broker pipe name is invalid.');
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000)
            throw new Error('Access broker timeout is invalid.');
    }
    async health() {
        const response = await this.call({ operation: 'health' });
        if (response.protocol !== 'omni-access-broker-v1' || (response.status !== 'ready' && response.status !== 'degraded')) {
            throw new Error('Access broker health response is invalid.');
        }
        return { protocol: response.protocol, status: response.status };
    }
    async readCredentialVersion(credentialId, version) {
        const response = await this.call({ operation: 'credential.read', credentialId: safeIdentifier(credentialId, 'Credential id'), version: safeVersion(version) });
        if (response.found === false)
            return null;
        if (response.found !== true)
            throw new Error('Access broker credential response is invalid.');
        return parseCredentialMetadata(canonicalizeBrokerCredential(response.credential));
    }
    async recordCredentialObservation(event, expectedRevision) {
        const encoded = Buffer.from(JSON.stringify(credentialObservation(event)), 'utf8').toString('base64');
        if (encoded.length > 12_000)
            throw new Error('Credential observation exceeds the broker limit.');
        const response = await this.call({ operation: 'credential.observe', expectedRevision: safeVersion(expectedRevision), eventBase64: encoded });
        if (response.outcome === 'conflict' || response.outcome === 'version-not-found')
            return { outcome: response.outcome };
        if ((response.outcome !== 'recorded' && response.outcome !== 'duplicate') || typeof response.credentialJson !== 'string') {
            throw new Error('Access broker credential observation response is invalid.');
        }
        let rawCredential;
        try {
            rawCredential = JSON.parse(response.credentialJson);
        }
        catch {
            throw new Error('Access broker credential observation response is invalid.');
        }
        return { outcome: response.outcome, credential: parseCredentialMetadata(canonicalizeBrokerCredential(rawCredential)) };
    }
    async importMemoryBatch(input) {
        if (!/^memory-import-[a-zA-Z0-9-]{1,160}$/u.test(input.importId) || !/^[a-f0-9]{64}$/u.test(input.sourceFingerprint) || input.entries.length < 1 || input.entries.length > 64) {
            throw new Error('Durable memory import is invalid.');
        }
        const entries = input.entries.map(memoryEntry).map((entry) => ({
            id: entry.id,
            lane: entry.lane,
            type: entry.type,
            scope_type: entry.scopeType,
            scope_id: entry.scopeId,
            project_id: entry.projectId,
            text_fingerprint: entry.textFingerprint,
            payload: entry.payload,
            source_updated_at: entry.sourceUpdatedAt
        }));
        const encoded = Buffer.from(JSON.stringify(entries), 'utf8').toString('base64');
        if (encoded.length > 12_000)
            throw new Error('Durable memory import exceeds the broker batch limit.');
        const response = await this.call({ operation: 'memory.import', importId: input.importId, sourceFingerprint: input.sourceFingerprint, entriesBase64: encoded });
        if (response.result !== 'applied' && response.result !== 'duplicate')
            throw new Error('Access broker memory import response is invalid.');
        return response.result;
    }
    async upsertMission(input) {
        if (!/^mission-[a-zA-Z0-9-]{1,160}$/u.test(input.id) || input.objective.length < 3 || input.objective.length > 800 || !['open', 'in-progress', 'blocked', 'completed', 'cancelled'].includes(input.state) || !Number.isSafeInteger(input.priority) || input.priority < 0 || input.priority > 100 || input.payload === null || Array.isArray(input.payload) || typeof input.payload !== 'object' || !Number.isFinite(Date.parse(input.createdAt)) || !Number.isFinite(Date.parse(input.updatedAt)) || (input.closedAt !== null && !Number.isFinite(Date.parse(input.closedAt))) || ((input.state === 'completed' || input.state === 'cancelled') !== (input.closedAt !== null))) {
            throw new Error('Durable mission is invalid.');
        }
        const missionBase64 = Buffer.from(JSON.stringify(input), 'utf8').toString('base64');
        if (missionBase64.length > 12_000)
            throw new Error('Durable mission payload exceeds the broker limit.');
        const response = await this.call({ operation: 'mission.upsert', missionBase64 });
        if (response.result !== 'applied' && response.result !== 'duplicate')
            throw new Error('Access broker mission response is invalid.');
        return response.result;
    }
    async listActiveMissions() {
        const response = await this.call({ operation: 'mission.list-active' });
        if (typeof response.missionsJson !== 'string')
            throw new Error('Access broker mission list response is invalid.');
        let rawMissions;
        try {
            rawMissions = JSON.parse(response.missionsJson);
        }
        catch {
            throw new Error('Access broker mission list response is invalid.');
        }
        if (!Array.isArray(rawMissions))
            throw new Error('Access broker mission list response is invalid.');
        return rawMissions.map((raw) => {
            const value = record(raw);
            const mission = { id: String(value.id ?? ''), objective: String(value.objective ?? ''), state: value.state, priority: Number(value.priority), payload: record(value.payload), createdAt: String(value.createdAt ?? ''), updatedAt: String(value.updatedAt ?? ''), closedAt: value.closedAt === null ? null : String(value.closedAt ?? '') };
            if (!/^mission-[a-zA-Z0-9-]{1,160}$/u.test(mission.id) || !['open', 'in-progress', 'blocked'].includes(mission.state) || !Number.isSafeInteger(mission.priority) || !Number.isFinite(Date.parse(mission.createdAt)) || !Number.isFinite(Date.parse(mission.updatedAt)))
                throw new Error('Access broker mission list item is invalid.');
            return mission;
        });
    }
    async call(request) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const deadline = Date.now() + this.timeoutMs;
            let retryTimer;
            const finish = (error, response) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timeout);
                if (retryTimer !== undefined)
                    clearTimeout(retryTimer);
                if (error !== null)
                    reject(error);
                else
                    resolve(response);
            };
            const timeout = setTimeout(() => finish(new Error('Access broker timed out.')), this.timeoutMs);
            const attempt = () => {
                if (settled)
                    return;
                const socket = connect(this.pipeName);
                let received = '';
                let connected = false;
                const retry = () => {
                    socket.destroy();
                    if (settled)
                        return;
                    if (Date.now() >= deadline)
                        return finish(new Error('Access broker is unavailable.'));
                    retryTimer = setTimeout(attempt, 25);
                };
                socket.setEncoding('utf8');
                socket.once('connect', () => {
                    connected = true;
                    socket.write(`${JSON.stringify(request)}\n`);
                });
                socket.on('data', (chunk) => {
                    received += chunk;
                    if (Buffer.byteLength(received, 'utf8') > MAX_RESPONSE_BYTES)
                        return finish(new Error('Access broker response exceeds the limit.'));
                    const newline = received.indexOf('\n');
                    if (newline < 0)
                        return;
                    try {
                        const response = record(JSON.parse(received.slice(0, newline)));
                        if (response.ok !== true) {
                            const code = typeof response.code === 'string' && /^[a-z-]{1,64}$/u.test(response.code) ? response.code : 'unknown';
                            throw new Error(`Access broker rejected the request (${code}).`);
                        }
                        finish(null, response);
                    }
                    catch (error) {
                        finish(error instanceof Error ? error : new Error('Access broker response is invalid.'));
                    }
                });
                socket.once('error', retry);
                socket.once('end', () => {
                    if (!settled && connected && received.length === 0)
                        retry();
                    else if (!settled)
                        finish(new Error('Access broker closed without a response.'));
                });
            };
            attempt();
        });
    }
}
