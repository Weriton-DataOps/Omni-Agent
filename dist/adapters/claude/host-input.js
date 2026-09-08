import { createHash } from 'node:crypto';
import { posix, win32 } from 'node:path';
export const CLAUDE_HOOK_EVENTS = [
    'SessionStart',
    'SessionEnd',
    'UserPromptSubmit',
    'UserPromptExpansion',
    'PreToolUse',
    'PostToolUse',
    'PostToolUseFailure',
    'SubagentStart',
    'SubagentStop',
    'Stop',
    'StopFailure',
    'TaskCompleted'
];
const STRING_FIELDS = [
    'session_id',
    'cwd',
    'prompt',
    'command_name',
    'tool_name',
    'source',
    'transcript_path',
    'agent_id',
    'agent_type',
    'delegation_id',
    'subagent_id',
    'tool_use_id',
    'reason',
    'task_id',
    'task_subject',
    'task_description'
];
const BOOLEAN_FIELDS = ['isSidechain', 'is_sidechain', 'stop_hook_active'];
function record(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
export function parseClaudeHookInput(value) {
    const input = record(value);
    if (!input)
        return { ok: false, issues: ['host-input:not-object'] };
    const event = input.hook_event_name;
    if (typeof event !== 'string' || !CLAUDE_HOOK_EVENTS.includes(event)) {
        return { ok: false, issues: ['hook_event_name:unknown-or-missing'] };
    }
    const issues = [];
    for (const field of STRING_FIELDS) {
        if (input[field] !== undefined && typeof input[field] !== 'string')
            issues.push(`${field}:expected-string`);
    }
    for (const field of BOOLEAN_FIELDS) {
        if (input[field] !== undefined && typeof input[field] !== 'boolean')
            issues.push(`${field}:expected-boolean`);
    }
    if (input.tool_input !== undefined && !record(input.tool_input))
        issues.push('tool_input:expected-object');
    if (issues.length > 0)
        return { ok: false, issues };
    return { ok: true, value: input };
}
export function isPrimaryClaudeScope(input) {
    if (input.isSidechain === true || input.is_sidechain === true)
        return false;
    return ['agent_id', 'agent_type', 'delegation_id', 'subagent_id'].every((field) => {
        const value = input[field];
        return typeof value !== 'string' || !value.trim();
    });
}
export function scopeIdentity(input, platform = process.platform) {
    if (!isPrimaryClaudeScope(input))
        return null;
    const pathApi = platform === 'win32' ? win32 : posix;
    if (typeof input.cwd !== 'string' || !input.cwd.trim() || !pathApi.isAbsolute(input.cwd))
        return null;
    let path = pathApi.resolve(input.cwd).normalize('NFC').replace(/\\/gu, '/');
    if (path.length > 3)
        path = path.replace(/\/+$/gu, '');
    if (platform === 'win32')
        path = path.toLowerCase();
    return createHash('sha256').update(path, 'utf8').digest('hex');
}
export function isExpectedClaudeTranscript(input, platform = process.platform) {
    if (!isPrimaryClaudeScope(input))
        return false;
    if (typeof input.session_id !== 'string' || !input.session_id.trim())
        return false;
    if (typeof input.transcript_path !== 'string' || !input.transcript_path.trim())
        return false;
    const pathApi = platform === 'win32' ? win32 : posix;
    if (!pathApi.isAbsolute(input.transcript_path) || pathApi.extname(input.transcript_path).toLowerCase() !== '.jsonl') {
        return false;
    }
    const expected = input.session_id.normalize('NFC');
    const actual = pathApi.basename(input.transcript_path, pathApi.extname(input.transcript_path)).normalize('NFC');
    return platform === 'win32' ? actual.toLowerCase() === expected.toLowerCase() : actual === expected;
}
export function isOmniActivationCommand(input) {
    if (!isPrimaryClaudeScope(input))
        return false;
    if (input.hook_event_name === 'UserPromptExpansion') {
        return /^(?:omni:)?omni$/u.test(input.command_name ?? '');
    }
    if (input.hook_event_name === 'UserPromptSubmit') {
        return /^\/(?:omni:)?omni(?:\s|$)/u.test((input.prompt ?? '').trim());
    }
    if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Skill')
        return false;
    const toolInput = input.tool_input;
    if (!toolInput)
        return false;
    const values = ['skill', 'name', 'command']
        .filter((field) => Object.hasOwn(toolInput, field))
        .map((field) => toolInput[field]);
    return values.length > 0 && values.every((item) => typeof item === 'string' && /^(?:omni:)?omni$/u.test(item.trim()));
}
