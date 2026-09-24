import { createHash } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { hasContinuityComplaint, hasExplicitPersistentPersonalityDirective, normalizeOwnerText } from '../../core/personality/owner-feedback.js';
import { NodeLocalJsonStore } from './node-local-json-store.js';
const store = new NodeLocalJsonStore();
function validFingerprint(value) {
    return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}
function validRecordedAt(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function validDirective(value) {
    return typeof value === 'string' && /^[a-z][a-z0-9-]{2,80}$/u.test(value);
}
function parseContinuity(value) {
    if (value === null)
        return { schemaVersion: 1, observations: [] };
    if (typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid continuity store.');
    const item = value;
    if (item.schemaVersion !== 1 || Object.keys(item).length !== 2 || !Array.isArray(item.observations) || item.observations.length > 100)
        throw new Error('Unsupported continuity store.');
    const observations = item.observations.map((raw) => {
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
            throw new Error('Invalid continuity observation.');
        const row = raw;
        if (Object.keys(row).length !== 2 || !validFingerprint(row.fingerprint) || !validRecordedAt(row.recordedAt))
            throw new Error('Invalid continuity observation.');
        return { fingerprint: row.fingerprint, recordedAt: row.recordedAt };
    });
    return { schemaVersion: 1, observations };
}
function parseDirections(value) {
    if (value === null)
        return { schemaVersion: 1, observations: [] };
    if (typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid personality direction store.');
    const item = value;
    if (item.schemaVersion !== 1 || Object.keys(item).length !== 2 || !Array.isArray(item.observations) || item.observations.length > 100)
        throw new Error('Unsupported personality direction store.');
    const observations = item.observations.map((raw) => {
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
            throw new Error('Invalid personality direction observation.');
        const row = raw;
        if (Object.keys(row).length !== 3 || !validFingerprint(row.fingerprint) || !validRecordedAt(row.recordedAt) || !Array.isArray(row.directives) || row.directives.length === 0 || row.directives.length !== new Set(row.directives).size || !row.directives.every(validDirective))
            throw new Error('Invalid personality direction observation.');
        return { fingerprint: row.fingerprint, recordedAt: row.recordedAt, directives: row.directives };
    });
    return { schemaVersion: 1, observations };
}
function location(home) {
    if (!isAbsolute(home))
        throw new Error('Continuity home must be absolute.');
    return join(home, 'feedback', 'personality-continuity.json');
}
function directionsLocation(home) {
    if (!isAbsolute(home))
        throw new Error('Continuity home must be absolute.');
    return join(home, 'feedback', 'personality-owner-directions.json');
}
export async function observePersonalityContinuity(home, feedback, at, directives = []) {
    const continuityComplaint = hasContinuityComplaint(feedback);
    const explicitPersistentDirective = hasExplicitPersistentPersonalityDirective(feedback);
    if (!continuityComplaint && !explicitPersistentDirective)
        return;
    const recordedAt = new Date(at ?? Date.now()).toISOString();
    const fingerprint = createHash('sha256').update(normalizeOwnerText(feedback)).digest('hex');
    if (continuityComplaint) {
        await store.update(location(home), current => {
            const state = parseContinuity(current);
            if (!state.observations.some(row => row.fingerprint === fingerprint))
                state.observations.push({ fingerprint, recordedAt });
            return { schemaVersion: 1, observations: state.observations.slice(-100) };
        });
    }
    if (explicitPersistentDirective) {
        const normalizedDirectives = [...new Set(directives.filter(validDirective))];
        if (normalizedDirectives.length === 0)
            return;
        await store.update(directionsLocation(home), current => {
            const state = parseDirections(current);
            const existing = state.observations.find(row => row.fingerprint === fingerprint);
            if (existing) {
                existing.recordedAt = recordedAt;
                existing.directives = [...new Set([...existing.directives, ...normalizedDirectives])];
            }
            else
                state.observations.push({ fingerprint, recordedAt, directives: normalizedDirectives });
            return { schemaVersion: 1, observations: state.observations.slice(-100) };
        });
    }
}
export async function readPersonalityContinuity(home) {
    const [continuity, directions] = await Promise.all([
        store.read(location(home)).then(parseContinuity),
        store.read(directionsLocation(home)).then(parseDirections)
    ]);
    return [...new Set([
            ...(continuity.observations.length > 0 ? ['maintain-personality-continuity'] : []),
            ...directions.observations.flatMap(row => row.directives)
        ])];
}
