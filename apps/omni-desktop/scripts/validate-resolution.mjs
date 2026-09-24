import { build } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const app = resolve(import.meta.dirname, '..')
const outfile = resolve(app, 'out/resolution-validation.mjs')
await build({ entryPoints: [resolve(app, 'scripts/validate-resolution.ts')], outfile, bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'error' })
await import(pathToFileURL(outfile).href)
