import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
const app = resolve(import.meta.dirname, '..')
await build({ entryPoints: ['tests/store.test.ts', 'tests/controller.test.ts', 'tests/bridge.test.ts', 'tests/audio.test.ts', 'tests/transcription.test.ts'], outdir: 'out/tests', outExtension: { '.js': '.mjs' }, absWorkingDir: app, bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'error' })
const result = spawnSync(process.execPath, ['--test', 'out/tests/store.test.mjs', 'out/tests/controller.test.mjs', 'out/tests/bridge.test.mjs', 'out/tests/audio.test.mjs', 'out/tests/transcription.test.mjs'], { cwd: app, stdio: 'inherit', windowsHide: true })
process.exitCode = result.status ?? 1
