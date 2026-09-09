import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.NODE_OPTIONS
const cwd = fileURLToPath(new URL('..', import.meta.url))
const child = spawn(require('electron'), [cwd], { cwd, env, windowsHide: false, stdio: 'ignore' })
child.on('error', () => process.exit(1))
child.on('exit', code => process.exit(code ?? 1))
