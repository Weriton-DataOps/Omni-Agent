import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
const app = resolve(import.meta.dirname, '..')
const suites = ['store', 'controller', 'coordinator', 'supervision', 'bridge', 'audio', 'transcription', 'credential-parser', 'credential-intake']
await build({ entryPoints: suites.map(name => `tests/${name}.test.ts`), outdir: 'out/tests', outExtension: { '.js': '.mjs' }, absWorkingDir: app, bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'error' })
const result = spawnSync(process.execPath, ['--test', ...suites.map(name => `out/tests/${name}.test.mjs`)], { cwd: app, stdio: 'inherit', windowsHide: true })
process.exitCode = result.status ?? 1
