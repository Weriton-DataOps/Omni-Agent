import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import electron from 'electron'
const app = resolve(import.meta.dirname, '..')
await build({ entryPoints: [join(app, 'scripts/private-context-smoke.ts')], outfile: join(app, 'out/private-context-smoke.cjs'), bundle: true, packages: 'external', platform: 'node', format: 'cjs', logLevel: 'error' })
const directory = await mkdtemp(join(app, 'out/private-context-dpapi-'))
try {
  for (const phase of ['write', 'read']) {
    const env = { ...process.env, OMNI_PRIVATE_TEST_DIR: directory, OMNI_PRIVATE_TEST_PHASE: phase }
    delete env.ELECTRON_RUN_AS_NODE
    const result = spawnSync(electron, [join(app, 'out/private-context-smoke.cjs')], { env, windowsHide: true, timeout: 20000, encoding: 'utf8' })
    for (const line of result.stdout.split(/\r?\n/).filter(l => l.startsWith('{'))) console.log(line)
    if (result.status !== 0) throw Error('DPAPI process test failed, private output suppressed.')
  }
} finally {
  if (!resolve(directory).startsWith(join(app, 'out') + '\\')) throw Error('Invalid fixture cleanup path')
  await rm(directory, { recursive: true, force: true })
}
