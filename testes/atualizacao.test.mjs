import assert from 'node:assert/strict'
import test from 'node:test'

import { atualizarPlugin, localizarClaudeCli } from '../runtime/atualizacao.mjs'

const canonicalMarketplace = [
  {
    name: 'omni-hub',
    source: 'git',
    url: 'https://github.com/Weriton-DataOps/Omni-Agent.git'
  }
]

function success(value = '') {
  return {
    status: 0,
    stdout: typeof value === 'string' ? value : JSON.stringify(value),
    stderr: ''
  }
}

function runner({ before = '0.11.0', after = '0.12.0', marketplace = canonicalMarketplace } = {}) {
  const calls = []
  let pluginListCalls = 0
  return {
    calls,
    run(executable, args) {
      calls.push({ executable, args })
      if (args.join(' ') === 'plugin marketplace list --json') return success(marketplace)
      if (args.join(' ') === 'plugin list --json') {
        pluginListCalls += 1
        return success([
          {
            id: 'omni@omni-hub',
            version: pluginListCalls === 1 ? before : after,
            scope: 'user',
            enabled: true
          }
        ])
      }
      if (args.join(' ') === 'plugin marketplace update omni-hub') return success('updated')
      if (args.join(' ') === 'plugin update omni@omni-hub --scope user --yes') {
        return success('updated')
      }
      return { status: 1, stdout: '', stderr: `comando inesperado: ${args.join(' ')}` }
    }
  }
}

test('atualiza, valida e orienta a aplicação conforme a interface', async () => {
  const fake = runner()
  const result = await atualizarPlugin({
    casa: 'C:\\omni-test',
    run: fake.run,
    resolveCli: async () => 'claude-test',
    checkVersion: async () => ({ latestVersion: '0.12.0', status: 'outdated' })
  })

  assert.equal(result.status, 'updated')
  assert.equal(result.previousInstalledVersion, '0.11.0')
  assert.equal(result.installedVersion, '0.12.0')
  assert.equal(result.reloadRequired, true)
  assert.equal(result.applyInstructions.vscode.command, '/plugin')
  assert.equal(result.applyInstructions.vscode.action, 'Clique em Restart.')
  assert.equal(result.applyInstructions.terminal.command, '/reload-plugins')
  assert.equal(result.applyInstructions.preservesSession, true)
  assert.deepEqual(result.verifiedBy, ['claude-plugin-list', 'github-manifest'])
  assert.ok(fake.calls.some(({ args }) => args.includes('update') && args.includes('omni@omni-hub')))
})

test('versão atual é validada sem pedir nova sessão', async () => {
  const fake = runner({ before: '0.11.0', after: '0.11.0' })
  const result = await atualizarPlugin({
    casa: 'C:\\omni-test',
    run: fake.run,
    resolveCli: async () => 'claude-test',
    checkVersion: async () => ({ latestVersion: '0.11.0', status: 'current' })
  })

  assert.equal(result.status, 'current')
  assert.equal(result.reloadRequired, false)
  assert.equal(result.applyInstructions, null)
})

test('recusa marketplace com a identidade certa apontando para outro repositório', async () => {
  const fake = runner({
    marketplace: [{ name: 'omni-hub', source: 'git', url: 'https://example.com/falso.git' }]
  })
  await assert.rejects(
    atualizarPlugin({
      casa: 'C:\\omni-test',
      run: fake.run,
      resolveCli: async () => 'claude-test'
    }),
    /não aponta para o repositório oficial/
  )
  assert.equal(fake.calls.length, 1)
})

test('localizador respeita executável explícito validado', async () => {
  const calls = []
  const executable = await localizarClaudeCli({
    env: { OMNI_CLAUDE_CLI: 'C:\\Claude\\claude.exe' },
    run(candidate, args) {
      calls.push({ candidate, args })
      return success('2.1.245')
    }
  })
  assert.equal(executable, 'C:\\Claude\\claude.exe')
  assert.deepEqual(calls[0].args, ['--version'])
})
