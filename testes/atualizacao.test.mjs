import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

function trustedIntegrity(version, fingerprint = 'a'.repeat(64)) {
  return {
    status: 'verified',
    versionMatchesManifest: true,
    releaseVersion: version,
    manifestVersion: version,
    fingerprint,
    declaredFingerprint: fingerprint
  }
}

const emptyReadback = async () => ({ result: 'checked', verified: 0 })

async function pluginCarregadoNaVersao(version) {
  const root = await mkdtemp(join(tmpdir(), 'omni-update-'))
  await mkdir(join(root, '.claude-plugin'), { recursive: true })
  await writeFile(
    join(root, '.claude-plugin', 'plugin.json'),
    `${JSON.stringify({ name: 'omni', version })}\n`,
    'utf8'
  )
  return root
}

function runner({ before = '0.19.0', after = '0.20.0', marketplace = canonicalMarketplace, installPath } = {}) {
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
            enabled: true,
            ...(pluginListCalls > 1 && installPath ? { installPath } : {})
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
  const loadedRoot = await pluginCarregadoNaVersao('0.19.0')
  try {
    const fake = runner({ installPath: 'C:\\installed\\omni-0.20.0' })
    const result = await atualizarPlugin({
    casa: 'C:\\omni-test',
    pluginRoot: loadedRoot,
    run: fake.run,
    resolveCli: async () => 'claude-test',
    checkVersion: async () => ({ latestVersion: '0.20.0', status: 'outdated' }),
    readChanges: async () => [{ version: '0.20.0', change: 'Mudança testada.' }],
    verifyInstalledIntegrity: async () => trustedIntegrity('0.20.0'),
    recordInstalledReadback: emptyReadback,
    recordOperationalReadback: emptyReadback
  })

  assert.equal(result.status, 'updated')
  assert.equal(result.previousInstalledVersion, '0.19.0')
  assert.equal(result.installedVersion, '0.20.0')
  assert.equal(result.installedFingerprint, 'a'.repeat(64))
  assert.equal(result.installedRoot, 'C:\\installed\\omni-0.20.0')
  assert.equal(result.reloadRequired, true)
  assert.equal(result.applyInstructions.vscode.command, '/plugin')
  assert.equal(result.applyInstructions.vscode.action, 'Clique em Restart.')
  assert.equal(result.applyInstructions.terminal.command, '/reload-plugins')
  assert.equal(result.applyInstructions.preservesSession, true)
  assert.deepEqual(result.verifiedBy, ['claude-plugin-list', 'installed-root-integrity', 'github-release-contract', 'payload-fingerprint'])
  assert.deepEqual(result.changes, [{ version: '0.20.0', change: 'Mudança testada.' }])
    assert.ok(fake.calls.some(({ args }) => args.includes('update') && args.includes('omni@omni-hub')))
  } finally {
    await rm(loadedRoot, { recursive: true, force: true })
  }
})

test('versão atual é validada sem pedir nova sessão', async () => {
  const loadedRoot = await pluginCarregadoNaVersao('0.19.2')
  try {
    const fake = runner({ before: '0.19.2', after: '0.19.2' })
    const result = await atualizarPlugin({
    casa: 'C:\\omni-test',
    pluginRoot: loadedRoot,
    run: fake.run,
    resolveCli: async () => 'claude-test',
    checkVersion: async () => ({ latestVersion: '0.19.2', status: 'current' }),
    verifyInstalledIntegrity: async () => trustedIntegrity('0.19.2'),
    recordInstalledReadback: emptyReadback,
    recordOperationalReadback: emptyReadback
  })

  assert.equal(result.status, 'current')
  assert.equal(result.reloadRequired, false)
  assert.equal(result.applyInstructions, null)
    assert.deepEqual(result.changes, [])
  } finally {
    await rm(loadedRoot, { recursive: true, force: true })
  }
})

test('atualizacao confirma os dois readbacks somente com release integra', async () => {
  const loadedRoot = await pluginCarregadoNaVersao('0.19.0')
  try {
    const fake = runner({ installPath: 'C:\\installed\\omni-0.20.0' })
    const calls = []
    const fingerprint = 'a'.repeat(64)
    const result = await atualizarPlugin({
      casa: 'C:\\omni-test',
      pluginRoot: loadedRoot,
      run: fake.run,
      resolveCli: async () => 'claude-test',
      checkVersion: async () => ({
        latestVersion: '0.20.0',
        installedVersion: '0.20.0',
        installedFingerprint: fingerprint,
        installedDeclaredFingerprint: fingerprint,
        installedIntegrity: 'verified',
        status: 'current-verified'
      }),
      verifyInstalledIntegrity: async () => trustedIntegrity('0.20.0', fingerprint),
      readChanges: async () => [{ version: '0.20.0', change: 'Readback conectado.' }],
      recordInstalledReadback: async (_casa, input) => {
        calls.push({ kind: 'capability', input })
        return { result: 'checked', verified: 2 }
      },
      recordOperationalReadback: async (_casa, input) => {
        calls.push({ kind: 'operational', input })
        return { result: 'checked', verified: 3 }
      }
    })
    assert.deepEqual(calls.map((item) => item.kind), ['capability', 'operational'])
    assert.ok(calls.every((item) => item.input.payloadFingerprint === fingerprint))
    assert.deepEqual(result.learningReadback, {
      verifiedArtifacts: 5,
      capabilityArtifacts: 2,
      operationalArtifacts: 3
    })
  } finally {
    await rm(loadedRoot, { recursive: true, force: true })
  }
})

test('bundle legado não pode ser declarado current nem produzir readback instalado', async () => {
  const loadedRoot = await pluginCarregadoNaVersao('0.19.2')
  try {
    const fake = runner({ before: '0.19.2', after: '0.19.2' })
    let called = false
    const recorder = async () => {
      called = true
      return { result: 'checked', verified: 99 }
    }
    await assert.rejects(atualizarPlugin({
      casa: 'C:\\omni-test',
      pluginRoot: loadedRoot,
      run: fake.run,
      resolveCli: async () => 'claude-test',
      verifyInstalledIntegrity: async () => ({
        status: 'legacy-unverifiable',
        versionMatchesManifest: true,
        releaseVersion: '0.19.2',
        fingerprint: 'b'.repeat(64),
        declaredFingerprint: null
      }),
      recordInstalledReadback: recorder,
      recordOperationalReadback: recorder
    }), /raiz realmente instalada não comprovou/)
    assert.equal(called, false)
  } finally {
    await rm(loadedRoot, { recursive: true, force: true })
  }
})

test('mesma versão com payload divergente não é aceita como atual', async () => {
  const loadedRoot = await pluginCarregadoNaVersao('0.19.2')
  const fake = runner({ before: '0.19.2', after: '0.19.2' })
  try {
    await assert.rejects(
      atualizarPlugin({
        casa: 'C:\\omni-test',
        pluginRoot: loadedRoot,
        run: fake.run,
        resolveCli: async () => 'claude-test',
        verifyInstalledIntegrity: async () => trustedIntegrity('0.19.2'),
        recordInstalledReadback: emptyReadback,
        recordOperationalReadback: emptyReadback,
        checkVersion: async () => ({
          latestVersion: '0.19.2', status: 'diverged'
        })
      }),
      /sem paridade de payload/
    )
  } finally {
    await rm(loadedRoot, { recursive: true, force: true })
  }
})

test('versão nova sem raiz instalada e raiz antiga não podem produzir updated', async () => {
  const loadedRoot = await pluginCarregadoNaVersao('0.19.0')
  try {
    const withoutRoot = runner({ before: '0.19.0', after: '0.20.0' })
    await assert.rejects(
      atualizarPlugin({
        casa: 'C:\\omni-test',
        pluginRoot: loadedRoot,
        run: withoutRoot.run,
        resolveCli: async () => 'claude-test'
      }),
      /não expôs uma raiz verificável/
    )

    const oldRoot = runner({ before: '0.19.0', after: '0.20.0', installPath: loadedRoot })
    await assert.rejects(
      atualizarPlugin({
        casa: 'C:\\omni-test',
        pluginRoot: loadedRoot,
        run: oldRoot.run,
        resolveCli: async () => 'claude-test',
        verifyInstalledIntegrity: async () => trustedIntegrity('0.19.0')
      }),
      /não expôs uma raiz verificável|não comprovou a versão/
    )
  } finally {
    await rm(loadedRoot, { recursive: true, force: true })
  }
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

test('registro da 0.14.0 traz somente o novo papel, continuidade e gate de skills', async () => {
  const changes = await lerMudancasAtualizacao(pluginRoot, '0.13.1', '0.14.0')
  assert.equal(changes.length, 3)
  assert.ok(changes.every((item) => item.version === '0.14.0'))
  assert.match(changes.map((item) => item.change).join(' '), /assistente cognitivo pessoal/i)
  assert.match(changes.map((item) => item.change).join(' '), /fast\/deep/i)
  assert.match(changes.map((item) => item.change).join(' '), /skills/i)
})

test('registro da 0.15.0 traz somente sensores, delegação, memória, evolução e personalidade-base', async () => {
  const changes = await lerMudancasAtualizacao(pluginRoot, '0.14.0', '0.15.0')
  assert.equal(changes.length, 5)
  assert.ok(changes.every((item) => item.version === '0.15.0'))
  const text = changes.map((item) => item.change).join(' ')
  assert.match(text, /ferramentas.*subagentes/i)
  assert.match(text, /delega[cç][aã]o rastre[aá]vel/i)
  assert.match(text, /v[aá]rios sinais por turno/i)
  assert.match(text, /regra.*procedimento.*eval/i)
  assert.match(text, /personalidade-base v1/i)
})

test('registro da 0.16.0 descreve a conferência diária sem conversa bruta', async () => {
  const changes = await lerMudancasAtualizacao(pluginRoot, '0.15.0', '0.16.0')
  assert.equal(changes.length, 3)
  assert.ok(changes.every((item) => item.version === '0.16.0'))
  const text = changes.map((item) => item.change).join(' ')
  assert.match(text, /varredura diária/i)
  assert.match(text, /atalhos.*melhoria operacional/i)
  assert.match(text, /sem conversa bruta/i)
})

test('registro da 0.16.1 fixa o ciclo e o relatório da varredura solicitada', async () => {
  const changes = await lerMudancasAtualizacao(pluginRoot, '0.16.0', '0.16.1')
  assert.equal(changes.length, 3)
  assert.ok(changes.every((item) => item.version === '0.16.1'))
  const text = changes.map((item) => item.change).join(' ')
  assert.match(text, /avalia[cç][aã]o.*materializa[cç][aã]o.*testes.*publica[cç][aã]o/i)
  assert.match(text, /valeu subir.*origin\/main/i)
  assert.match(text, /manutenção silenciosa/i)
})

test('registro da 0.17.0 descreve a personalidade em alta intensidade', async () => {
  const changes = await lerMudancasAtualizacao(pluginRoot, '0.16.1', '0.17.0')
  assert.equal(changes.length, 3)
  assert.ok(changes.every((item) => item.version === '0.17.0'))
  const text = changes.map((item) => item.change).join(' ')
  assert.match(text, /personalidade-base v1.*intensidade alta/i)
  assert.match(text, /inteligência.*humor.*sarcasmo.*analogias/i)
  assert.match(text, /genéricas e secas/i)
})

test('registro da 0.18.0 descreve a validação autônoma de falhas', async () => {
  const changes = await lerMudancasAtualizacao(pluginRoot, '0.17.0', '0.18.0')
  assert.equal(changes.length, 4)
  assert.ok(changes.every((item) => item.version === '0.18.0'))
  const text = changes.map((item) => item.change).join(' ')
  assert.match(text, /pedido.*despacho.*subagente.*sem nova pergunta/i)
  assert.match(text, /reserva idempotente.*lease/i)
  assert.match(text, /causa raiz.*dois testes.*eval/i)
  assert.match(text, /destrutivas.*escrita remota.*autoriza/i)
})

test('registro da 0.18.1 descreve o fechamento com evidência', async () => {
  const changes = await lerMudancasAtualizacao(pluginRoot, '0.18.0', '0.18.1')
  assert.equal(changes.length, 2)
  assert.ok(changes.every((item) => item.version === '0.18.1'))
  const text = changes.map((item) => item.change).join(' ')
  assert.match(text, /corrida.*eval.*fechamento/i)
  assert.match(text, /evidência final.*fingerprint/i)
})

test('registro da 0.18.2 descreve assinaturas diagnósticas discriminantes', async () => {
  const changes = await lerMudancasAtualizacao(pluginRoot, '0.18.1', '0.18.2')
  assert.equal(changes.length, 3)
  assert.ok(changes.every((item) => item.version === '0.18.2'))
  const text = changes.map((item) => item.change).join(' ')
  assert.match(text, /família real do comando.*contexto/i)
  assert.match(text, /sem persistir comando.*entrada da ferramenta/i)
  assert.match(text, /varredura diária/i)
})

test('registro da 0.19.0 descreve atalhos efetivos, consolidação e esquecimento', async () => {
  const changes = await lerMudancasAtualizacao(pluginRoot, '0.18.2', '0.19.0')
  assert.equal(changes.length, 5)
  assert.ok(changes.every((item) => item.version === '0.19.0'))
  const text = changes.map((item) => item.change).join(' ')
  assert.match(text, /primeiro sucesso.*contexto/i)
  assert.match(text, /identidades fragmentadas.*migração.*backup/i)
  assert.match(text, /desuso.*falhas repetidas/i)
  assert.match(text, /skill.*ciclo separado/i)
  assert.match(text, /fechar descobertas.*histórico.*backlog/i)
})

test('registro da 0.19.1 descreve o fechamento auditável das conexões', async () => {
  const changes = await lerMudancasAtualizacao(pluginRoot, '0.19.0', '0.19.1')
  assert.equal(changes.length, 3)
  assert.ok(changes.every((item) => item.version === '0.19.1'))
  const text = changes.map((item) => item.change).join(' ')
  assert.match(text, /checkpoint.*delegação.*eval parcial.*recarga/i)
  assert.match(text, /primeiro sucesso.*três sucessos.*promoção portátil/i)
  assert.match(text, /auditorias de 26\/08.*sete dias/i)
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

test('registro da 0.19.2 descreve o fim do diagnostico imutavel e do sucesso falso', async () => {
  const changes = await lerMudancasAtualizacao(pluginRoot, '0.19.1', '0.19.2')
  assert.equal(changes.length, 3)
  assert.ok(changes.every((item) => item.version === '0.19.2'))
  const text = changes.map((item) => item.change).join(' ')
  assert.match(text, /reanalise.*diagnostico errado.*medido/i)
  assert.match(text, /resultado real.*operacao que nao aconteceu/i)
  assert.match(text, /testes de regressao.*aceita antes.*recusada depois/i)
})
