import { normalizeOwnerText, ownerStatement } from '../personality/owner-feedback.js';
export function isTransientMemory(text) {
    return /\b(?:so nesta sessao|somente nesta sessao|so agora|hoje apenas|temporariamente|so (?:pra|para) (?:conferir|testar|ver)|aqui so|agora apenas)\b/u.test(normalizeOwnerText(text));
}
export function declaredProjectFact(value) {
    const text = ownerStatement(value).trim();
    if (!text || /\?|\b(?:talvez|se fosse|poderia|acho que)\b/iu.test(text))
        return null;
    const normalized = normalizeOwnerText(text);
    const database = normalized.match(/^o banco (?:do|da|de) ([\p{L}\d_.-]+) (?:usa|utiliza|e) (?:postgresql|postgres|mysql|sqlite|sql server)\b/u);
    const location = text.match(/^(?:O|A)\s+(?:projeto\s+)?([\p{L}\d_.-]+)\s+(?:fica|está|esta)\s+em\s+(?:[A-Za-z]:[\\/]|\/|\\\\)\S+/iu);
    const project = database?.[1] ?? location?.[1]?.toLowerCase();
    return project ? { project, text } : null;
}
export function hasUnattributedOwnerContent(text) {
    return ownerStatement(text).trim().length > 0;
}
