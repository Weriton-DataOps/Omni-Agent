import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { NodeWorkspaceProcess } from '../src/adapters/vscode/node-workspace-process.js'
import {
  abrirProjetoNoVscode,
  resolverAlvoProjetoVscode,
  resolverPlanoCliVscode,
  statusConfirmaWorkspace
} from '../src/adapters/vscode/workspace-vscode.js'
import {
  parseOpenWorkspaceRequest,
  WorkspaceInputValidationError
} from '../src/core/workspace/workspace.js'

const directory = () => ({ isDirectory: () => true })
const windowsWrapper = 'C:\\VSCode\\bin\\code.cmd'
const windowsExecutable = 'C:\\VSCode\\Code.exe'
const windowsCli = 'C:\\VSCode\\stable\\resources\\app\\out\\cli.js'
const windowsWrapperContent = [
  '@echo off',
  'set ELECTRON_RUN_AS_NODE=1',
  '"%~dp0..\\Code.exe" "%~dp0..\\stable\\resources\\app\\out\\cli.js" %*'
].join('\r\n')

function windowsCliDependencies() {
  return {
    env: { OMNI_VSCODE_CLI: windowsWrapper },
    exists: (path: string) => [windowsWrapper, windowsExecutable, windowsCli].includes(path),
    readText: () => windowsWrapperContent
  }
}

test('entrada unknown e alvo exigem literal ou alias explicito sem cwd fallback', () => {
  const privateValue = 'C:\\segredo-do-proprietario'
  const invalid = parseOpenWorkspaceRequest({
    literalTarget: privateValue,
    reuseWindow: 'sim'
  })
  assert.equal(invalid.ok, false)
  assert.doesNotMatch(JSON.stringify(invalid), /segredo-do-proprietario/iu)

  assert.throws(
    () => abrirProjetoNoVscode({ literalTarget: privateValue, reuseWindow: 'sim' }, {
      platform: 'win32',
      stat: directory
    }),
    (error: unknown) => error instanceof WorkspaceInputValidationError &&
      !error.message.includes(privateValue)
  )

  const hub = resolverAlvoProjetoVscode('Projeto Hub', {
    platform: 'win32',
    env: {},
    stat: directory
  })
  assert.equal(hub.canonicalPath.toLowerCase(), 'c:\\hub-wp')
  assert.equal(hub.resolution, 'explicit-alias')
  assert.equal(hub.cwdFallbackUsed, false)
  assert.throws(
    () => resolverAlvoProjetoVscode('projeto-nao-mapeado', {
      platform: 'win32',
      env: { PWD: 'C:\\nao-pode-virar-fallback' },
      stat: directory
    }),
    /cwd nunca e usado como fallback/iu
  )
})

test('comparacao de workspace e case-insensitive no Windows e sensivel no POSIX', () => {
  assert.equal(statusConfirmaWorkspace('Window (C:\\HUB-WP)', 'C:\\hub-wp', 'win32'), true)
  assert.equal(statusConfirmaWorkspace('Window (C:\\hub-wp-old)', 'C:\\hub-wp', 'win32'), false)
  assert.equal(statusConfirmaWorkspace('Window (/srv/Hub)', '/srv/hub', 'linux'), false)
  assert.equal(statusConfirmaWorkspace('Window (/srv/hub)', '/srv/hub', 'linux'), true)
  assert.equal(statusConfirmaWorkspace('Window (/srv/hub-old)', '/srv/hub', 'linux'), false)
})

test('adapter de processo envia argv literal e fixa shell false', () => {
  const calls: Array<{
    executable: string
    args: readonly string[]
    options: {
      readonly encoding: 'utf8'
      readonly windowsHide: true
      readonly shell: false
      readonly env: NodeJS.ProcessEnv
      readonly timeout: 15_000
      readonly maxBuffer: 2_097_152
    }
  }> = []
  const process = new NodeWorkspaceProcess((executable, args, options) => {
    calls.push({ executable, args, options })
    return { status: 0, stdout: '', stderr: '' }
  })
  const result = process.run('C:\\VS Code\\Code.exe', [
    'C:\\VS Code\\resources\\app\\out\\cli.js',
    '--new-window',
    'C:\\hub-wp & calc.exe'
  ], { ELECTRON_RUN_AS_NODE: '1' })
  assert.equal(result.status, 0)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.executable, 'C:\\VS Code\\Code.exe')
  assert.deepEqual(calls[0]?.args, [
    'C:\\VS Code\\resources\\app\\out\\cli.js',
    '--new-window',
    'C:\\hub-wp & calc.exe'
  ])
  assert.equal(calls[0]?.options.shell, false)
  assert.equal(calls[0]?.options.env.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(calls[0]?.options.env.VSCODE_DEV, undefined)
  assert.equal(calls[0]?.options.timeout, 15_000)
  assert.equal(calls[0]?.options.maxBuffer, 2_097_152)
})

test('abertura verifica expectedRepository e relata somente estados observados', () => {
  const calls: Array<{
    readonly executable: string
    readonly args: readonly string[]
    readonly shell: false
    readonly electronRunAsNode: string | undefined
    readonly vscodeDev: string | undefined
  }> = []
  const options = {
    platform: 'win32' as const,
    ...windowsCliDependencies(),
    stat: directory,
    run: (command: string, args: readonly string[], processOptions: {
      readonly shell: false
      readonly env: NodeJS.ProcessEnv
    }) => {
      calls.push({
        executable: command,
        args,
        shell: processOptions.shell,
        electronRunAsNode: processOptions.env.ELECTRON_RUN_AS_NODE,
        vscodeDev: processOptions.env.VSCODE_DEV
      })
      return args.at(-1) === '--status'
        ? { status: 0, stdout: 'Window (C:\\HUB-WP)', stderr: '' }
        : { status: 0, stdout: '', stderr: '' }
    }
  }
  const opened = abrirProjetoNoVscode({
    literalTarget: 'Hub',
    expectedRepository: 'c:\\HUB-wp'
  }, options)
  assert.equal(opened.state, 'workspace-opened')
  assert.equal(opened.success, true)
  assert.equal(opened.expectedRepositoryVerified, true)
  assert.equal(opened.claudePanelOpened, false)
  assert.equal(opened.sessionVisible, false)
  assert.equal(opened.briefingDelivered, false)
  assert.equal(opened.executable, windowsExecutable)
  assert.deepEqual(opened.prefixArgs, [windowsCli])
  assert.deepEqual(calls.map(({ args }) => args), [
    [windowsCli, '--new-window', 'C:\\hub-wp'],
    [windowsCli, '--status']
  ])
  assert.ok(calls.every(({ executable: command, shell, electronRunAsNode, vscodeDev }) =>
    !command.toLowerCase().endsWith('.cmd') &&
    shell === false && electronRunAsNode === '1' && vscodeDev === ''
  ))

  calls.length = 0
  const refused = abrirProjetoNoVscode({
    literalTarget: 'Hub',
    expectedRepository: 'C:\\hub-wp-old'
  }, options)
  assert.equal(refused.state, 'blocked')
  assert.equal(refused.reason, 'target-does-not-match-expected-repository')
  assert.equal(refused.expectedRepositoryVerified, false)
  assert.equal(calls.length, 0)

  const unsupported = abrirProjetoNoVscode({
    literalTarget: 'Hub',
    startClaudeSession: true
  }, options)
  assert.equal(unsupported.state, 'blocked')
  assert.equal(unsupported.reason, 'claude-session-requires-supported-vscode-integration')
  assert.equal(unsupported.claudePanelOpened, false)
  assert.equal(unsupported.sessionVisible, false)
  assert.equal(unsupported.briefingDelivered, false)
  assert.equal(calls.length, 0)
})

test('expectedRepository POSIX exige mesma capitalizacao e status nao aceita prefixo', () => {
  const executable = '/usr/local/bin/code'
  const calls: string[][] = []
  const options = {
    platform: 'linux' as const,
    env: { OMNI_VSCODE_CLI: executable },
    stat: directory,
    exists: () => true,
    run: (_command: string, args: readonly string[]) => {
      calls.push([...args])
      return args[0] === '--status'
        ? { status: 0, stdout: 'Window (/srv/hub-old)', stderr: '' }
        : { status: 0, stdout: '', stderr: '' }
    }
  }
  const refused = abrirProjetoNoVscode({
    literalTarget: '/srv/hub',
    expectedRepository: '/srv/Hub'
  }, options)
  assert.equal(refused.state, 'blocked')
  assert.equal(calls.length, 0)

  const requested = abrirProjetoNoVscode({ literalTarget: '/srv/hub' }, options)
  assert.equal(requested.state, 'workspace-open-requested')
  assert.equal(requested.success, false)
  assert.equal(requested.verification, 'code-status-without-exact-path')
})

test('interpreta wrapper Windows real e executa diagnostico nativo sem shell', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omni-vscode-wrapper-'))
  const installation = join(root, 'Microsoft VS Code')
  const wrapper = join(installation, 'bin', 'code.cmd')
  const executable = join(installation, 'Code.exe')
  const cli = join(installation, 'build-id', 'resources', 'app', 'out', 'cli.js')
  try {
    await mkdir(join(installation, 'bin'), { recursive: true })
    await mkdir(join(installation, 'build-id', 'resources', 'app', 'out'), { recursive: true })
    await writeFile(executable, '', 'utf8')
    await writeFile(cli, '', 'utf8')
    await writeFile(wrapper, [
      '@echo off',
      'set ELECTRON_RUN_AS_NODE=1',
      '"%~dp0..\\Code.exe" "%~dp0..\\build-id\\resources\\app\\out\\cli.js" %*'
    ].join('\r\n'), 'utf8')

    const plan = resolverPlanoCliVscode({
      platform: 'win32',
      env: { OMNI_VSCODE_CLI: wrapper }
    })
    assert.equal(plan.source, 'windows-cmd-wrapper')
    assert.equal(plan.executable.toLowerCase(), executable.toLowerCase())
    assert.deepEqual(plan.prefixArgs.map((item) => item.toLowerCase()), [cli.toLowerCase()])
    assert.deepEqual(plan.environment, { VSCODE_DEV: '', ELECTRON_RUN_AS_NODE: '1' })

    const diagnostic = new NodeWorkspaceProcess().run(
      globalThis.process.execPath,
      ['-e', 'process.stdout.write(process.env.ELECTRON_RUN_AS_NODE ?? "")'],
      plan.environment
    )
    assert.equal(diagnostic.status, 0, diagnostic.stderr)
    assert.equal(diagnostic.stdout, '1')

    await writeFile(wrapper, [
      '@echo off',
      '"%~dp0..\\..\\Windows\\System32\\Code.exe" "%~dp0..\\build-id\\resources\\app\\out\\cli.js" %*'
    ].join('\r\n'), 'utf8')
    assert.throws(
      () => resolverPlanoCliVscode({
        platform: 'win32',
        env: { OMNI_VSCODE_CLI: wrapper }
      }),
      /sair da instalacao esperada/iu
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
