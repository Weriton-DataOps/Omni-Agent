import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
const app = resolve(import.meta.dirname, '..')
const extraSuites = ['resolution', 'markdown-document', 'external-task', 'private-context', 'executor-access', 'private-persistence', 'credential-organizer']
const suites = ['audit-regressions', 'store', 'controller', 'editor-session', 'agent-map', 'ipc-identifiers', 'card-return', 'coordinator', 'coordinator-stream', 'execution-trace', 'result-delivery', 'message-text', 'supervision', 'authority-blocks', 'bridge', 'audio', 'transcription', 'credential-parser', 'credential-intake', 'update-service']
suites.push(...extraSuites)
await build({ entryPoints: suites.map(name => `tests/${name}.test.${name === 'message-text' ? 'tsx' : 'ts'}`), outdir: 'out/tests', outExtension: { '.js': '.mjs' }, absWorkingDir: app, bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'error' })
const result = spawnSync(process.execPath, ['--test', ...suites.map(name => `out/tests/${name}.test.mjs`)], { cwd: app, stdio: 'inherit', windowsHide: true })
process.exitCode = result.status ?? 1
