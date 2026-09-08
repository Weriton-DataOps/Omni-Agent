import assert from 'node:assert/strict'
import test from 'node:test'

import {
  abrirProjetoNoVscode,
  resolverAlvoProjetoVscode,
  resolverCodeCmd,
  resolverPlanoCliVscode,
  statusConfirmaWorkspace
} from '../dist/adapters/vscode/workspace-vscode.js'

test('dist de producao abre workspace pelo contrato TypeScript emitido', () => {
  assert.equal(typeof abrirProjetoNoVscode, 'function')
  assert.equal(typeof resolverAlvoProjetoVscode, 'function')
  assert.equal(typeof resolverCodeCmd, 'function')
  assert.equal(typeof resolverPlanoCliVscode, 'function')
  assert.equal(typeof statusConfirmaWorkspace, 'function')

  const wrapper = 'C:\\VSCode\\bin\\code.cmd'
  const executable = 'C:\\VSCode\\Code.exe'
  const cli = 'C:\\VSCode\\stable\\resources\\app\\out\\cli.js'
  const calls = []
  const dependencies = {
    platform: 'win32',
    env: { OMNI_VSCODE_CLI: wrapper },
    stat: () => ({ isDirectory: () => true }),
    exists: (path) => [wrapper, executable, cli].includes(path),
    readText: () => [
      '@echo off',
      'set ELECTRON_RUN_AS_NODE=1',
      '"%~dp0..\\Code.exe" "%~dp0..\\stable\\resources\\app\\out\\cli.js" %*'
    ].join('\r\n'),
    run: (command, args, options) => {
      calls.push({ command, args, options })
      return args.at(-1) === '--status'
        ? { status: 0, stdout: 'Window (C:\\hub-wp)', stderr: '' }
        : { status: 0, stdout: '', stderr: '' }
    }
  }
  const result = abrirProjetoNoVscode({
    literalTarget: 'Hub',
    expectedRepository: 'C:\\hub-wp'
  }, dependencies)
  assert.equal(result.state, 'workspace-opened')
  assert.equal(result.expectedRepositoryVerified, true)
  assert.equal(result.claudePanelOpened, false)
  assert.equal(result.sessionVisible, false)
  assert.equal(result.briefingDelivered, false)
  assert.equal(result.executable, executable)
  assert.deepEqual(result.prefixArgs, [cli])
  assert.deepEqual(calls.map(({ args }) => args), [
    [cli, '--new-window', 'C:\\hub-wp'],
    [cli, '--status']
  ])
  assert.ok(calls.every(({ options }) =>
    options.shell === false &&
    options.env.ELECTRON_RUN_AS_NODE === '1' &&
    options.env.VSCODE_DEV === ''
  ))
  assert.ok(calls.every(({ command }) => !command.toLowerCase().endsWith('.cmd')))
  assert.equal(statusConfirmaWorkspace('Window (C:\\hub-wp-old)', 'C:\\hub-wp', 'win32'), false)
  assert.equal(statusConfirmaWorkspace('Window (/srv/Hub)', '/srv/hub', 'linux'), false)
})
