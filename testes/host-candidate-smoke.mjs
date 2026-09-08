// Explicit opt-in: this test uses the real authenticated Claude host and a bounded paid inference.
// It does not install, publish, grant permissions, mutate a project, or simulate owner approval.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyCandidateSnapshot } from '../scripts/create-candidate-snapshot.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [executable, snapshot] = process.argv.slice(2)
assert.ok(isAbsolute(executable ?? '') && isAbsolute(snapshot ?? ''), 'CLI and snapshot need absolute paths')
const sourceFingerprint = await verifyCandidateSnapshot(snapshot)
const source = join(snapshot, 'source')
const identity = JSON.parse(await readFile(join(source, 'contratos', 'atualizacao', 'integridade.json'), 'utf8')).identity
const run = join(root, 'out', 'implementation', `host-smoke-${new Date().toISOString().replace(/[:.]/g, '-')}`)
const workspace = join(run, 'workspace')
const isolatedProfile = join(run, 'user')
await mkdir(workspace, { recursive: true })
await mkdir(join(isolatedProfile, '.claude', 'projects'), { recursive: true })
// The native host resolves its existing authenticated configuration; Omni's state and scanner are isolated.
const env = { ...process.env, OMNI_HOME: join(run, 'omni-home'), USERPROFILE: isolatedProfile, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR ?? join(process.env.USERPROFILE, '.claude') }
delete env.CLAUDECODE
const args = ['--print', '--output-format', 'stream-json', '--verbose', '--include-hook-events', '--plugin-dir', source, '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', '', '--no-chrome', '--no-session-persistence', '--permission-mode', 'dontAsk', '--max-budget-usd', '0.75', '--model', 'sonnet', '--effort', 'medium']
const prompt = '/omni:omni\nExplique em duas frases por que um teste que passou em cópia isolada não prova que a versão em uso foi corrigida.'
const child = spawn(executable, args, { cwd: workspace, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
let stdout = ''
let stderr = ''
let timedOut = false
const timer = setTimeout(() => { timedOut = true; child.kill() }, 120_000)
child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 4_000_000) child.kill() })
child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 1_000_000) child.kill() })
child.stdin.end(prompt)
const exit = await new Promise(resolveExit => {
  child.once('error', error => resolveExit({ code: null, errorCode: error.code ?? 'spawn-error' }))
  child.once('exit', (code, signal) => resolveExit({ code, signal }))
})
clearTimeout(timer)
const events = stdout.split(/\r?\n/u).flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
const init = events.find(event => event.type === 'system' && event.subtype === 'init')
const result = events.findLast(event => event.type === 'result')
const hookEvents = events.filter(event => event.type === 'system' && String(event.subtype).startsWith('hook_'))
const report = {
  schemaVersion: 1, kind: 'real-host-isolated-candidate-not-installed-release',
  sourceFingerprint, releaseFingerprint: identity.releaseFingerprint, version: identity.version,
  exit, timedOut, eventCount: events.length,
  plugins: init?.plugins ?? [], model: init?.model ?? null,
  hookEvents: hookEvents.map(event => ({ subtype: event.subtype, hookName: event.hook_name, hookEvent: event.hook_event, exitCode: event.exit_code, outcome: event.outcome,
    errorCodes: [...new Set(`${event.stderr ?? ''} ${event.stdout ?? ''}`.match(/\b(?:ERR_[A-Z_]+|EPERM|EACCES|ENOENT|MODULE_NOT_FOUND)\b/gu) ?? [])],
    failureCategories: ['Cannot find module', 'is not recognized', 'Permission denied', 'Access is denied', 'not found', 'SyntaxError', 'ReferenceError', 'TypeError'].filter(term => `${event.stderr ?? ''} ${event.stdout ?? ''}`.includes(term))
  })),
  result: result ? { subtype: result.subtype, isError: result.is_error, answer: result.result, costUsd: result.total_cost_usd, turns: result.num_turns } : null,
  stderrFingerprint: createHash('sha256').update(stderr).digest('hex'),
  // Sanitized categories only: never persist authentication messages, environment or arbitrary host output.
  failureCategories: ['authentication', 'permission', 'EPERM', 'EACCES', 'ENOENT', 'plugin', 'budget'].filter(term => new RegExp(term, 'i').test(stderr)),
  ownerApproval: false, installedReleaseVerified: false,
  snapshotStillIntact: await verifyCandidateSnapshot(snapshot) === sourceFingerprint
}
await writeFile(join(run, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify({ run, ...report }))
if (exit.code !== 0 || timedOut || result?.is_error || !init?.plugins?.some(plugin => plugin.name?.startsWith('omni'))) process.exitCode = 1
