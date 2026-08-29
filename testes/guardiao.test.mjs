import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  classificarComandoLeitura,
  decidirPreToolUse,
  detectarFormaHistorica,
  saidaHook
} from '../runtime/guardiao.mjs'
import {
  abrirTurnoAuditoria,
  caminhoDaAuditoriaAutocorrecao
} from '../runtime/auditoria-autocorrecao.mjs'
import {
  caminhosPasse,
  criarPasse,
  emitirPasse,
  executarCli,
  lerCofre,
  normalizarAlvo,
  obterOuCriarChave,
  verificarPasse
} from '../runtime/passe.mjs'

function ambiente(t) {
  const base = mkdtempSync(join(tmpdir(), 'omni-guardiao-'))
  const casa = join(base, 'casa')
  const alvo = join(base, 'projeto')
  const fora = join(base, 'fora')
  const caminhos = caminhosPasse({ casa })
  t.after(() => rmSync(base, { recursive: true, force: true }))
  return { base, casa, alvo, fora, caminhos }
}

const agora = Date.parse('2026-08-28T12:00:00.000Z')

async function credenciar(contexto, sobrescrever = {}, { abrirTurno = true } = {}) {
  const dados = {
    sessao: 'sessao-1',
    agente: 'agente-1',
    autoridade: 'authority-owner-1',
    objetivo: 'Inspecionar o repositório sem alterá-lo.',
    alvos: [contexto.alvo],
    ambiente: contexto.alvo,
    efeitos: ['read'],
    minutos: 60,
    ...sobrescrever
  }
  if (abrirTurno) {
    await abrirTurnoAuditoria(contexto.casa, {
      session_id: dados.sessao,
      prompt: dados.objetivo
    }, { at: agora })
  }
  return emitirPasse(dados, { caminhos: contexto.caminhos, agora })
}

function entrada(contexto, command = 'git status', extras = {}) {
  return {
    session_id: 'sessao-1',
    agent_id: 'agente-1',
    tool_name: 'Bash',
    cwd: contexto.alvo,
    tool_input: { command, cwd: contexto.alvo },
    ...extras
  }
}

test('formas historicamente ruins abstêm com orientação e nunca negam', () => {
  const casos = [
    ['Bash', "cat > arquivo <<'EOF'\ntexto\nEOF"],
    ['Bash', 'cd /tmp/projeto && git status'],
    ['PowerShell', 'Write-Output "valor $(Get-Date)"'],
    ['PowerShell', '@"\ntexto\n"@']
  ]
  for (const [ferramenta, command] of casos) {
    const forma = detectarFormaHistorica(ferramenta, command)
    assert.ok(forma)
    const resultado = decidirPreToolUse({ tool_name: ferramenta, tool_input: { command } })
    assert.equal(resultado.decision, 'abstain')
    assert.ok(resultado.guidance)
    const saida = saidaHook(resultado)
    assert.equal(saida.hookSpecificOutput.permissionDecision, undefined)
    assert.match(saida.systemMessage, /Omni guardião/)
  }
})

test('passe v2 válido libera somente leitura simples dentro do envelope', async (t) => {
  const contexto = ambiente(t)
  await credenciar(contexto)
  const resultado = decidirPreToolUse(entrada(contexto), { caminhos: contexto.caminhos, agora: agora + 1000 })
  assert.equal(resultado.decision, 'allow')
  assert.equal(resultado.authorityId, 'authority-owner-1')
  assert.equal(saidaHook(resultado).hookSpecificOutput.permissionDecision, 'allow')
})

test('passe sem turno auditado ativo nunca libera leitura', async (t) => {
  const contexto = ambiente(t)
  await credenciar(contexto, {}, { abrirTurno: false })
  const resultado = decidirPreToolUse(
    entrada(contexto),
    { caminhos: contexto.caminhos, agora: agora + 1000 }
  )
  assert.equal(resultado.decision, 'abstain')
})

test('passe do objetivo anterior nao pode ser reutilizado em outro turno', async (t) => {
  const contexto = ambiente(t)
  await credenciar(contexto)
  await abrirTurnoAuditoria(contexto.casa, {
    session_id: 'sessao-1',
    prompt: 'Leia outro assunto dentro do mesmo repositorio.'
  }, { at: agora + 500 })
  const resultado = decidirPreToolUse(
    entrada(contexto),
    { caminhos: contexto.caminhos, agora: agora + 1000 }
  )
  assert.equal(resultado.decision, 'abstain')
})

test('turno legado sem algoritmo de objetivo permanece legivel, mas fail-closed', async (t) => {
  const contexto = ambiente(t)
  await credenciar(contexto)
  const path = caminhoDaAuditoriaAutocorrecao(contexto.casa)
  const store = JSON.parse(readFileSync(path, 'utf8'))
  delete store.turns[0].requestFingerprintAlgorithm
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  const resultado = decidirPreToolUse(
    entrada(contexto),
    { caminhos: contexto.caminhos, agora: agora + 1000 }
  )
  assert.equal(resultado.decision, 'abstain')
})

test('binding de agente é estrito: ausente ou divergente abstém', async (t) => {
  const contexto = ambiente(t)
  await credenciar(contexto)
  const semAgente = entrada(contexto)
  delete semAgente.agent_id
  assert.equal(
    decidirPreToolUse(semAgente, { caminhos: contexto.caminhos, agora: agora + 1000 }).decision,
    'abstain'
  )
  assert.equal(
    decidirPreToolUse(
      entrada(contexto, 'git status', { agent_id: 'outro-agente' }),
      { caminhos: contexto.caminhos, agora: agora + 1000 }
    ).decision,
    'abstain'
  )
})

test('sessão chamada Omni não recebe atalho de escrita ou execução', (t) => {
  const contexto = ambiente(t)
  for (const command of ['node --version', 'Set-Content arquivo.txt valor', 'git status']) {
    const resultado = decidirPreToolUse({
      session_id: 'omni',
      agent_id: 'omni',
      tool_name: command.startsWith('Set-') ? 'PowerShell' : 'Bash',
      cwd: contexto.alvo,
      tool_input: { command, cwd: contexto.alvo }
    }, { caminhos: contexto.caminhos, agora })
    assert.equal(resultado.decision, 'abstain')
  }
})

test('encadeamento e redirecionamento nunca entram no auto-allow', async (t) => {
  const contexto = ambiente(t)
  await credenciar(contexto)
  for (const command of [
    'git status && git log -1',
    'git status; git log -1',
    'git log > log.txt',
    'git status | head -1',
    'git status\ngit log -1'
  ]) {
    assert.equal(
      decidirPreToolUse(entrada(contexto, command), { caminhos: contexto.caminhos, agora: agora + 1000 }).decision,
      'abstain'
    )
  }
})

test('alvo fora e ambiente diferente do envelope abstêm para o host', async (t) => {
  const contexto = ambiente(t)
  await credenciar(contexto)
  const fora = decidirPreToolUse({
    session_id: 'sessao-1',
    agent_id: 'agente-1',
    tool_name: 'PowerShell',
    cwd: contexto.alvo,
    tool_input: {
      command: `Get-Content -LiteralPath "${join(contexto.fora, 'segredo.txt')}"`,
      cwd: contexto.alvo
    }
  }, { caminhos: contexto.caminhos, agora: agora + 1000 })
  assert.equal(fora.decision, 'abstain')

  const ambienteDivergente = entrada(contexto)
  ambienteDivergente.cwd = contexto.fora
  ambienteDivergente.tool_input.cwd = contexto.fora
  assert.equal(
    decidirPreToolUse(ambienteDivergente, { caminhos: contexto.caminhos, agora: agora + 1000 }).decision,
    'abstain'
  )
})

test('providers, tilde e expressões do PowerShell não fingem ser caminhos do envelope', async (t) => {
  const contexto = ambiente(t)
  await credenciar(contexto)
  const casos = [
    ['PowerShell', 'Get-Content Env:\\OMNI_SECRET'],
    ['PowerShell', 'Get-Content Registry::HKEY_CURRENT_USER\\Software'],
    ['PowerShell', 'Get-Content arquivo.txt,@args'],
    ['Bash', 'cat ~/.ssh/id_rsa']
  ]
  for (const [tool_name, command] of casos) {
    const resultado = decidirPreToolUse({
      session_id: 'sessao-1',
      agent_id: 'agente-1',
      tool_name,
      cwd: contexto.alvo,
      tool_input: { command, cwd: contexto.alvo }
    }, { caminhos: contexto.caminhos, agora: agora + 1000 })
    assert.equal(resultado.decision, 'abstain')
  }
})

test('classificador aceita leitura com operador dentro de aspas, mas não interpolação', () => {
  const cwd = process.cwd()
  assert.ok(classificarComandoLeitura('Bash', 'git log --format="%h | %s"', cwd))
  assert.equal(classificarComandoLeitura('Bash', 'git show "$(whoami)"', cwd), null)
  assert.equal(classificarComandoLeitura('PowerShell', 'Get-Content "$env:TEMP\\x"', cwd), null)
})

test('classificador rejeita executavel com path, drive, extensao ou alias', () => {
  const cwd = process.cwd()
  for (const command of [
    './git.exe status',
    'C:\\Tools\\git.exe status',
    'git.exe status',
    'g status'
  ]) {
    assert.equal(classificarComandoLeitura('Bash', command, cwd), null, command)
  }
  assert.equal(classificarComandoLeitura('Bash', 'Get-Content arquivo.txt', cwd), null)
  for (const alias of ['cat arquivo.txt', 'ls', 'dir', 'pwd']) {
    assert.equal(classificarComandoLeitura('PowerShell', alias, cwd), null, alias)
  }
})

test('rg vincula cada arquivo de padrao ao envelope e distingue fixed-strings', () => {
  const cwd = process.cwd()
  const patterns = join(cwd, 'patterns.txt').replace(/\\/g, '/')
  const target = join(cwd, 'target').replace(/\\/g, '/')
  for (const command of [
    `rg -f "${patterns}" "${target}"`,
    `rg --file "${patterns}" "${target}"`,
    `rg --file="${patterns}" "${target}"`
  ]) {
    const result = classificarComandoLeitura('Bash', command, cwd)
    assert.deepEqual(result.targets, [normalizarAlvo(patterns), normalizarAlvo(target)])
  }
  const fixed = classificarComandoLeitura('Bash', `rg -F texto "${target}"`, cwd)
  assert.deepEqual(fixed.targets, [normalizarAlvo(target)])
})

test('rg nao pode ler arquivo de padrao fora do envelope do passe', async (t) => {
  const contexto = ambiente(t)
  await credenciar(contexto)
  const outside = join(contexto.fora, 'patterns.txt').replace(/\\/g, '/')
  const resultado = decidirPreToolUse(
    entrada(contexto, `rg -f ${outside} .`),
    { caminhos: contexto.caminhos, agora: agora + 1000 }
  )
  assert.equal(resultado.decision, 'abstain')
})

test('efeito material exige checkpoint e rollback antes da emissão', () => {
  const chave = 'a'.repeat(64)
  const dados = {
    sessao: 'sessao-1',
    agente: 'agente-1',
    autoridade: 'authority-1',
    objetivo: 'Atualizar um arquivo autorizado.',
    alvos: [process.cwd()],
    ambiente: process.cwd(),
    efeitos: ['write']
  }
  assert.throws(() => criarPasse(dados, { chave, agora }), /checkpoint e rollback/i)
  const passe = criarPasse({
    ...dados,
    checkpoint: 'sha256:antes',
    rollback: 'restaurar checkpoint sha256:antes'
  }, { chave, agora, id: 'passe-material' })
  assert.ok(passe.checkpointFingerprint)
  assert.ok(passe.rollbackFingerprint)
  assert.equal(verificarPasse(passe, chave, { agora: agora + 1000 }), true)
})

test('assinatura cobre autoridade, objetivo, alvo, ambiente, efeitos e agente', () => {
  const chave = 'b'.repeat(64)
  const passe = criarPasse({
    sessao: 'sessao-1',
    agente: 'agente-1',
    autoridade: 'authority-1',
    objetivo: 'Ler o projeto.',
    alvos: [process.cwd()],
    ambiente: process.cwd(),
    efeitos: ['read']
  }, { chave, agora, id: 'passe-assinado' })
  for (const alterar of [
    (item) => { item.authorityId = 'authority-2' },
    (item) => { item.objectiveFingerprint = '0'.repeat(64) },
    (item) => { item.targetFingerprints = ['0'.repeat(64)] },
    (item) => { item.environmentFingerprint = '0'.repeat(64) },
    (item) => { item.effectClasses = ['execute'] },
    (item) => { item.agentId = 'agente-2' }
  ]) {
    const adulterado = structuredClone(passe)
    alterar(adulterado)
    assert.equal(verificarPasse(adulterado, chave, { agora: agora + 1000 }), false)
  }
})

test('cofre v2 é atômico sob emissões concorrentes e preserva o legado', async (t) => {
  const contexto = ambiente(t)
  const legado = '{"schemaVersion":1,"passes":[{"id":"legado-intacto"}]}\n'
  mkdirSync(contexto.caminhos.config, { recursive: true })
  writeFileSync(contexto.caminhos.legado, legado, 'utf8')
  await Promise.all(Array.from({ length: 12 }, (_, indice) => credenciar(contexto, {
    sessao: `sessao-${indice}`,
    agente: `agente-${indice}`,
    objetivo: `Inspecionar o projeto no ciclo ${indice}.`
  })))
  const cofre = lerCofre(contexto.caminhos.cofre)
  assert.equal(cofre.schemaVersion, 2)
  assert.equal(cofre.passes.length, 12)
  assert.equal(new Set(cofre.passes.map((passe) => passe.id)).size, 12)
  assert.equal(readFileSync(contexto.caminhos.legado, 'utf8'), legado)
  assert.equal(existsSync(contexto.caminhos.lock), false)
})

test('CLI testável emite, lista e revoga sem expor valores brutos', async (t) => {
  const contexto = ambiente(t)
  const emitido = await executarCli([
    'emitir',
    '--sessao', 'sessao-cli',
    '--agente', 'agente-cli',
    '--autoridade', 'authority-cli',
    '--objetivo', 'Objetivo bruto que não deve ir ao cofre.',
    '--alvo', contexto.alvo,
    '--ambiente', contexto.alvo,
    '--efeito', 'read',
    '--minutos', '30'
  ], { caminhos: contexto.caminhos, agora, id: 'passe-cli' })
  assert.equal(emitido.pass.id, 'passe-cli')
  const listado = await executarCli(['listar'], { caminhos: contexto.caminhos })
  assert.equal(listado.passes.length, 1)
  const bruto = readFileSync(contexto.caminhos.cofre, 'utf8')
  assert.doesNotMatch(bruto, /Objetivo bruto/)
  assert.doesNotMatch(bruto, /sessao-cli/)
  assert.doesNotMatch(bruto, new RegExp(contexto.alvo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
  const revogado = await executarCli(['revogar', 'passe-cli'], { caminhos: contexto.caminhos })
  assert.deepEqual({ revoked: revogado.revoked, remaining: revogado.remaining }, { revoked: 1, remaining: 0 })
})

test('chave v2 é criada uma vez com entropia mínima e nunca entra no cofre', (t) => {
  const contexto = ambiente(t)
  const primeira = obterOuCriarChave(contexto.caminhos.chave)
  const segunda = obterOuCriarChave(contexto.caminhos.chave)
  assert.equal(primeira, segunda)
  assert.match(primeira, /^[a-f0-9]{64}$/)
  assert.notEqual(contexto.caminhos.chave, contexto.caminhos.cofre)
})
