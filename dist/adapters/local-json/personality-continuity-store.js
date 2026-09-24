import { createHash } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { hasContinuityComplaint, hasExplicitPersistentPersonalityDirective, normalizeOwnerText } from '../../core/personality/owner-feedback.js';
import { NodeLocalJsonStore } from './node-local-json-store.js';
const store = new NodeLocalJsonStore();
function validDirective(value) {
    return typeof value === 'string' && /^[a-z][a-z0-9-]{2,80}$/u.test(value);
}
function parse(value) {
    if (value === null)
        return { schemaVersion: 2, observations: [] };
    if (typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid continuity store.');
    const item = value;
    if (![1, 2].includes(item.schemaVersion) || Object.keys(item).length !== 2 || !Array.isArray(item.observations) || item.observations.length > 100) {
        throw new Error('Unsupported continuity store.');
    }
    const observations = item.observations.map((raw) => {
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
            throw new Error('Invalid continuity observation.');
        const row = raw;
        const legacy = item.schemaVersion === 1 && Object.keys(row).length === 2;
        if ((!legacy && Object.keys(row).length !== 3) || typeof row.fingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(row.fingerprint) || typeof row.recordedAt !== 'string' || !Number.isFinite(Date.parse(row.recordedAt)) || (!legacy && (!Array.isArray(row.directives) || row.directives.length !== new Set(row.directives).size || !row.directives.every(validDirective))))
            throw new Error('Invalid continuity observation.');
        return { fingerprint: row.fingerprint, recordedAt: row.recordedAt, directives: legacy ? ['maintain-personality-continuity'] : row.directives };
    });
    return { schemaVersion: 2, observations };
}
function location(home) {
    if (!isAbsolute(home))
        throw new Error('Continuity home must be absolute.');
    return join(home, 'feedback', 'personality-continuity.json');
}
export async function observePersonalityContinuity(home, feedback, at, directives = []) {
    const continuityComplaint = hasContinuityComplaint(feedback);
    const explicitPersistentDirective = hasExplicitPersistentPersonalityDirective(feedback);
    if (!continuityComplaint && !explicitPersistentDirective)
        return;
    const recordedAt = new Date(at ?? Date.now()).toISOString();
    const fingerprint = createHash('sha256').update(normalizeOwnerText(feedback)).digest('hex');
    await store.update(location(home), current => {
        const state = parse(current);
        const normalizedDirectives = [...new Set(directives.filter(validDirective))];
        const effectiveDirectives = normalizedDirectives.length > 0 ? normalizedDirectives : ['maintain-personality-continuity'];
        const existing = state.observations.find(row => row.fingerprint === fingerprint);
        if (existing) {
            existing.recordedAt = recordedAt;
            existing.directives = [...new Set([...existing.directives, ...effectiveDirectives])];
        }
        else
            state.observations.push({ fingerprint, recordedAt, directives: effectiveDirectives });
        return { schemaVersion: 2, observations: state.observations.slice(-100) };
    });
}
export async function readPersonalityContinuity(home) {
    return [...new Set(parse(await store.read(location(home))).observations.flatMap(row => row.directives))];
}
