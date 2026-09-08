const SECTION = /^##\s+(.+?)\s*$/u;
function slug(value) {
    const normalized = value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, '-')
        .replace(/^-|-$/gu, '');
    return normalized || 'section';
}
function compactCompleteLines(content, maximumLines) {
    const lines = content.split('\n');
    return lines.slice(0, Math.max(1, maximumLines)).join('\n').trim();
}
function sectionBlock(title, content, index) {
    const normalized = title
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/gu, '')
        .toUpperCase();
    const id = `projection:${slug(title)}:${index}`;
    if (normalized === 'RULES')
        return { kind: 'required', id, content };
    if (normalized.includes('CONFIRMED MEMORY')) {
        return { kind: 'compactable', id, content, compact: compactCompleteLines(content, 2), priority: 95 };
    }
    if (normalized.includes('WORK CONTINUITY')) {
        return { kind: 'compactable', id, content, compact: compactCompleteLines(content, 3), priority: 90 };
    }
    if (normalized.includes('LOCAL SHORTCUT')) {
        return { kind: 'compactable', id, content, compact: compactCompleteLines(content, 2), priority: 75 };
    }
    if (normalized.includes('CAPABILIT')) {
        return { kind: 'compactable', id, content, compact: compactCompleteLines(content, 2), priority: 60 };
    }
    return { kind: 'optional', id, content, priority: 30 };
}
export function projectionToContextBlocks(projection) {
    const normalized = projection.replace(/\r\n/gu, '\n').trim();
    if (!normalized) {
        return [{
                kind: 'required',
                id: 'projection:degraded',
                content: 'ESTADO DE CONTEXTO: DEGRADADO. Responda à intenção literal sem inventar memória ou estado ausente.'
            }];
    }
    const lines = normalized.split('\n');
    const preamble = [];
    const sections = [];
    let current = null;
    for (const line of lines) {
        const match = line.match(SECTION);
        if (match?.[1]) {
            current = { title: match[1], lines: [line] };
            sections.push(current);
        }
        else if (current) {
            current.lines.push(line);
        }
        else {
            preamble.push(line);
        }
    }
    const blocks = [{
            kind: 'required',
            id: 'projection:label',
            content: 'CONTEXTO RECUPERADO PARA ESTE TURNO:'
        }];
    if (sections.length === 0) {
        blocks.push({
            kind: 'compactable',
            id: 'projection:unstructured',
            content: normalized,
            compact: compactCompleteLines(normalized, 4),
            priority: 90
        });
        return blocks;
    }
    if (preamble.join('\n').trim()) {
        blocks.push({
            kind: 'required',
            id: 'projection:preamble',
            content: preamble.join('\n').trim()
        });
    }
    sections.forEach((section, index) => {
        blocks.push(sectionBlock(section.title, section.lines.join('\n').trim(), index));
    });
    return blocks;
}
