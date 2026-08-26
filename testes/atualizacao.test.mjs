import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  atualizarPlugin,
  lerMudancasAtualizacao,
  localizarClaudeCli,
  resumirAtualizacaoPublica
} from '../runtime/atualizacao.mjs'

const pluginRoot = fileURLToPath(new URL('../', import.meta.url))

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

function runner({ before = '0.13.0', after = '0.14.0', marketplace = canonicalMarketplace } = {}) {
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
    checkVersion: async () => ({ latestVersion: '0.14.0', status: 'outdated' }),
    readChanges: async () => [{ version: '0.14.0', change: 'Mudança testada.' }]
  })

  assert.equal(result.status, 'updated')
  assert.equal(result.previousInstalledVersion, '0.13.0')
  assert.equal(result.installedVersion, '0.14.0')
  assert.equal(result.reloadRequired, true)
  assert.equal(result.applyInstructions.vscode.command, '/plugin')
  assert.equal(result.applyInstructions.vscode.action, 'Clique em Restart.')
  assert.equal(result.applyInstructions.terminal.command, '/reload-plugins')
  assert.equal(result.applyInstructions.preservesSession, true)
  assert.deepEqual(result.verifiedBy, ['claude-plugin-list', 'github-manifest'])
  assert.deepEqual(result.changes, [{ version: '0.14.0', change: 'Mudança testada.' }])
  assert.ok(fake.calls.some(({ args }) => args.includes('update') && args.includes('omni@omni-hub')))
})

test('versão atual é validada sem pedir nova sessão', async () => {
  const fake = runner({ before: '0.13.1', after: '0.13.1' })
  const result = await atualizarPlugin({
    casa: 'C:\\omni-test',
    run: fake.run,
    resolveCli: async () => 'claude-test',
    checkVersion: async () => ({ latestVersion: '0.13.1', status: 'current' })
  })

  assert.equal(result.status, 'current')
  assert.equal(result.reloadRequired, false)
  assert.equal(result.applyInstructions, null)
  assert.deepEqual(result.changes, [])
})

test('registro retorna somente mudanças entre a versão anterior e a instalada', async () => {
  const changes = await lerMudancasAtualizacao(pluginRoot, '0.13.0', '0.13.1')
  assert.deepEqual(changes, [
    {
      version: '0.13.1',
      change: 'O comando atualizar agora mostra somente a versão e o que foi atualizado.'
    }
  ])
})

test('resumo público contém somente transição, mudanças e recarga necessária', () => {
  const summary = resumirAtualizacaoPublica({
    status: 'updated',
    previousInstalledVersion: '0.13.0',
    installedVersion: '0.13.1',
    changes: [{ version: '0.13.1', change: 'Saída de atualização simplificada.' }],
    reloadRequired: true,
    repository: 'não deve aparecer',
    verifiedBy: ['interno']
  })
  assert.deepEqual(Object.keys(summary), ['status', 'transition', 'changes', 'reload'])
  assert.equal(JSON.stringify(summary).includes('não deve aparecer'), false)
  assert.deepEqual(summary.changes, ['Saída de atualização simplificada.'])
  assert.equal(summary.reload.preservesSession, true)
  assert.deepEqual(
    resumirAtualizacaoPublica({ status: 'current' }),
    { status: 'current', message: 'Nenhuma atualização disponível.' }
  )
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
