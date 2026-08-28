import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  abrirTurnoAuditoria,
  auditarParada,
  caminhoDaAuditoriaAutocorrecao,
  encerrarSessaoAuditoria,
  lerAuditoriaAutocorrecao,
  registrarAcaoAuditoria,
  registrarDelegacaoAuditoria
} from '../runtime/auditoria-autocorrecao.mjs'
import { tratarHook } from '../runtime/hook-contexto.mjs'

async function home(prefix = 'omni-audit-') {
  return mkdtemp(join(tmpdir(), prefix))
}

const prompt = (session_id, value) => ({ session_id, prompt: value })

const tool = (session_id, {
  id,
  name = 'Read',
  input = { file_path: 'arquivo.md' },
  failed = false,
  cwd
}) => ({
  hook_event_name: failed ? 'PostToolUseFailure' : 'PostToolUse',
  session_id,
  tool_use_id: id,
  tool_name: name,
  tool_input: input,
  ...(cwd ? { cwd } : {})
})

test('ledger guarda pedido, compromissos e fingerprints sem texto bruto', async () => {
  const casa = await home()
  const session = 'sessao-privada'
  const raw = 'corrija o arquivo com o marcador SUPER-PRIVADO-9381'
  try {
    const opened = await abrirTurnoAuditoria(casa, prompt(session, raw), { at: '2026-08-28T12:00:00.000Z' })
    assert.equal(opened.result, 'opened')
    assert.equal(opened.turn.requestKind, 'mutation')
    assert.deepEqual(opened.turn.commitments.map((item) => item.kind), [
      'answer-current-request',
      'perform-requested-work',
      'verify-real-state'
    ])
    assert.match(opened.context, /AUDITORIA E AUTOCORREÇÃO OBRIGATÓRIAS/)

    await registrarAcaoAuditoria(casa, tool(session, {
      id: 'private-write',
      name: 'Write',
      input: { file_path: `C:\\privado\\${raw}.txt`, content: raw }
    }))
    const stored = await readFile(caminhoDaAuditoriaAutocorrecao(casa), 'utf8')
    assert.equal(stored.includes(raw), false)
    assert.equal(stored.includes('SUPER-PRIVADO-9381'), false)
    assert.equal(stored.includes(session), false)
    assert.match(stored, /requestFingerprint/)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('formas naturais de ordem em português abrem compromisso executável', async () => {
  const casa = await home()
  const cases = [
    ['faça essa correção', 'mutation'],
    ['faça o ajuste', 'mutation'],
    ['faça uma verificação', 'inspection'],
    ['pode verificar o estado agora', 'inspection'],
    ['quero que implemente o ajuste', 'mutation'],
    ['já pode implementar o ajuste', 'mutation'],
    ['então verifique o resultado', 'inspection'],
    ['leve isso em consideração para fazer a correção', 'mutation'],
    ['pedi pra ele mesmo fazer uma autoavaliação, leve em consideração isso também pra fazer a correção', 'mutation'],
    ['mão na massa', 'execution']
  ]
  try {
    for (const [text, kind] of cases) {
      const opened = await abrirTurnoAuditoria(casa, prompt(`sessao-${kind}-${text.length}`, text))
      assert.equal(opened.turn.requestKind, kind)
      assert.ok(opened.turn.commitments.some((item) => item.kind === 'verify-real-state'))
    }
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('produção textual e análise discursiva não exigem ferramenta, mas trabalho operacional continua auditado', async () => {
  const casa = await home()
  const conversational = [
    'faça um teste de humor',
    'faça uma analogia',
    'faça um resumo',
    'analise esta ideia',
    'avalie minha hipótese',
    'compare estas opções'
  ]
  try {
    for (const [index, text] of conversational.entries()) {
      const session = `sessao-conversa-${index}`
      const opened = await abrirTurnoAuditoria(casa, prompt(session, text))
      assert.equal(opened.turn.requestKind, 'conversation', text)
      const stopped = await auditarParada(casa, {
        session_id: session,
        last_assistant_message: 'Aqui está a resposta textual pedida.'
      })
      assert.equal(stopped.result, 'verified', text)
      assert.equal(stopped.decision, null, text)
    }

    for (const [index, text] of [
      'faça o build',
      'faça essa correção',
      'rode os testes',
      'analise o código deste repositório',
      'compare o estado real da instalação',
      'analise a última conversa',
      'avalie o transcrito',
      'compare as últimas mensagens'
    ].entries()) {
      const session = `sessao-operacional-${index}`
      const opened = await abrirTurnoAuditoria(casa, prompt(session, text))
      assert.notEqual(opened.turn.requestKind, 'conversation', text)
      const stopped = await auditarParada(casa, {
        session_id: session,
        last_assistant_message: 'Resposta sem executar o trabalho.'
      })
      assert.equal(stopped.decision, 'block', text)
      assert.ok(stopped.turn.findings.some((item) => item.code === 'requested-action-not-executed'), text)
    }
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('mutação sem leitura posterior bloqueia uma vez e não entra em loop', async () => {
  const casa = await home()
  const session = 'sessao-stop-once'
  try {
    await abrirTurnoAuditoria(casa, prompt(session, 'corrija o arquivo agora'))
    await registrarAcaoAuditoria(casa, tool(session, { id: 'edit-1', name: 'Edit', input: { file_path: 'x', old_string: 'a', new_string: 'b' } }))

    const first = await auditarParada(casa, {
      session_id: session,
      last_assistant_message: 'Pronto, corrigi e está funcionando.'
    })
    assert.equal(first.result, 'repair-required')
    assert.equal(first.decision, 'block')
    assert.equal(first.turn.stopBlocksIssued, 1)
    assert.ok(first.turn.findings.some((item) => item.code === 'mutation-without-readback'))

    const second = await auditarParada(casa, {
      session_id: session,
      stop_hook_active: true,
      last_assistant_message: 'Pronto, corrigi e está funcionando.'
    })
    assert.equal(second.result, 'blocked')
    assert.equal(second.decision, null)
    assert.equal(second.turn.stopBlocksIssued, 1)
    assert.equal(
      new Set(second.turn.findings.map((item) => item.fingerprint)).size,
      second.turn.findings.length
    )
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('correção orientada é idempotente e só fecha depois de verificação real', async () => {
  const casa = await home()
  const session = 'sessao-reparo'
  try {
    await abrirTurnoAuditoria(casa, prompt(session, 'altere o contrato e confira o resultado'))
    await registrarAcaoAuditoria(casa, tool(session, { id: 'write-1', name: 'Write', input: { file_path: 'contrato.json', content: '{}' } }))
    const first = await auditarParada(casa, {
      session_id: session,
      last_assistant_message: 'Feito.'
    })
    assert.equal(first.decision, 'block')
    const correctionIds = first.turn.corrections.map((item) => item.id)

    await registrarAcaoAuditoria(casa, tool(session, { id: 'read-1', name: 'Read', input: { file_path: 'contrato.json' } }))
    const final = await auditarParada(casa, {
      session_id: session,
      stop_hook_active: true,
      last_assistant_message: 'Alteração verificada no estado real.'
    })
    assert.equal(final.result, 'verified')
    assert.equal(final.decision, null)
    assert.deepEqual(final.turn.corrections.map((item) => item.id), correctionIds)
    assert.ok(final.turn.corrections.every((item) => item.state === 'verified'))
    assert.ok(final.turn.findings.every((item) => item.state === 'corrected'))
    assert.ok(final.turn.commitments.every((item) => item.state === 'fulfilled'))
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('leitura de outro alvo não finge verificar a mutação', async () => {
  const casa = await home()
  const session = 'sessao-alvo-divergente'
  try {
    await abrirTurnoAuditoria(casa, prompt(session, 'altere o arquivo A e confira o resultado'))
    await registrarAcaoAuditoria(casa, tool(session, {
      id: 'write-a',
      name: 'Write',
      input: { file_path: 'A.md', content: 'novo' }
    }))
    await registrarAcaoAuditoria(casa, tool(session, {
      id: 'read-b',
      name: 'Read',
      input: { file_path: 'B.md' }
    }))
    const result = await auditarParada(casa, {
      session_id: session,
      last_assistant_message: 'Corrigi, ficou pronto.'
    })
    assert.equal(result.decision, 'block')
    assert.ok(result.turn.findings.some((item) => item.code === 'mutation-without-readback'))
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('pedido de mutacao nao fecha quando a unica acao foi git status', async () => {
  const casa = await home()
  const session = 'sessao-mutacao-so-status'
  try {
    await abrirTurnoAuditoria(casa, prompt(session, 'corrija o arquivo quebrado'))
    const recorded = await registrarAcaoAuditoria(casa, tool(session, {
      id: 'status-only',
      name: 'Bash',
      input: { command: 'git status --short', cwd: 'C:\\repo' }
    }))
    assert.equal(recorded.action.effect, 'verification')

    const result = await auditarParada(casa, {
      session_id: session,
      last_assistant_message: 'Corrigi, feito.'
    })
    assert.equal(result.decision, 'block')
    assert.ok(result.turn.findings.some((item) => item.code === 'requested-action-not-executed'))
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('executores indiretos e geradores sao tratados como mutacao que exige readback', async () => {
  const casa = await home()
  const commands = [
    'node scripts/generate.mjs',
    'python scripts/generate.py',
    "sed -i 's/a/b/' arquivo.txt",
    'git apply mudanca.patch',
    'npm run generate'
  ]
  try {
    for (const [index, command] of commands.entries()) {
      const session = `sessao-mutacao-indireta-${index}`
      await abrirTurnoAuditoria(casa, prompt(session, 'aplique a alteracao solicitada'))
      const recorded = await registrarAcaoAuditoria(casa, tool(session, {
        id: `indirect-${index}`,
        name: 'Bash',
        input: { command, cwd: 'C:\\repo' }
      }))
      assert.equal(recorded.action.effect, 'mutation', command)
      const result = await auditarParada(casa, {
        session_id: session,
        last_assistant_message: 'Alteracao aplicada.'
      })
      assert.equal(result.decision, 'block', command)
      assert.ok(result.turn.findings.some((item) => item.code === 'mutation-without-readback'), command)
    }
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('mutacao indireta sem alvo recusa leitura arbitraria e aceita readback de escopo', async () => {
  const casa = await home()
  const session = 'sessao-mutacao-sem-alvo'
  try {
    await abrirTurnoAuditoria(casa, prompt(session, 'execute o script scripts/generate.mjs e confira'))
    await registrarAcaoAuditoria(casa, tool(session, {
      id: 'generator',
      name: 'Bash',
      input: { command: 'node scripts/generate.mjs', cwd: 'C:\\repo' }
    }))
    await registrarAcaoAuditoria(casa, tool(session, {
      id: 'unrelated-read',
      name: 'Read',
      input: { file_path: 'outro-arquivo.md', cwd: 'C:\\repo' }
    }))

    const first = await auditarParada(casa, {
      session_id: session,
      last_assistant_message: 'Corrigi os artefatos.'
    })
    assert.equal(first.decision, 'block')
    assert.ok(first.turn.findings.some((item) => item.code === 'mutation-without-readback'))

    await registrarAcaoAuditoria(casa, tool(session, {
      id: 'scope-readback',
      name: 'Bash',
      input: { command: 'git diff --stat -- scripts/generate.mjs', cwd: 'C:\\repo' }
    }))
    const final = await auditarParada(casa, {
      session_id: session,
      stop_hook_active: true,
      last_assistant_message: 'Estado do repositorio conferido apos a geracao.'
    })
    assert.equal(final.result, 'verified')
    assert.ok(final.turn.findings.every((item) => item.state === 'corrected'))
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('novo prompt e SessionEnd registram turno abandonado como unresolved', async () => {
  const casa = await home()
  const privateMarker = 'NAO-GRAVAR-CONVERSA-ABANDONADA-9182'
  try {
    await abrirTurnoAuditoria(casa, prompt('sessao-novo-prompt', `corrija o arquivo ${privateMarker}`))
    await abrirTurnoAuditoria(casa, prompt('sessao-novo-prompt', 'agora verifique outra coisa'))

    await abrirTurnoAuditoria(casa, prompt('sessao-encerrada', 'execute a tarefa pendente'))
    await encerrarSessaoAuditoria(casa, { session_id: 'sessao-encerrada' })

    const store = await lerAuditoriaAutocorrecao(casa)
    const abandoned = store.turns.filter((item) =>
      item.findings.some((finding) => finding.code === 'turn-abandoned')
    )
    assert.equal(abandoned.length, 2)
    for (const turn of abandoned) {
      assert.equal(turn.state, 'blocked')
      assert.ok(turn.findings.some((item) => item.code === 'turn-abandoned' && item.state === 'unresolved'))
      assert.ok(turn.corrections.some((item) => item.state === 'failed'))
      assert.ok(turn.commitments.every((item) => item.state === 'blocked'))
    }
    const stored = await readFile(caminhoDaAuditoriaAutocorrecao(casa), 'utf8')
    assert.equal(stored.includes(privateMarker), false)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('pedido executável sem ação é detectado antes da alegação de conclusão', async () => {
  const casa = await home()
  const session = 'sessao-sem-acao'
  try {
    await abrirTurnoAuditoria(casa, prompt(session, 'verifique a versão instalada'))
    const result = await auditarParada(casa, {
      session_id: session,
      last_assistant_message: 'Pronto, a versão está correta.'
    })
    assert.equal(result.decision, 'block')
    assert.ok(result.turn.findings.some((item) => item.code === 'requested-action-not-executed'))
    assert.ok(result.turn.findings.some((item) => item.code === 'completion-claim-without-evidence'))
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('inspeção por leitura é evidência real suficiente para fechar', async () => {
  const casa = await home()
  const session = 'sessao-inspecao'
  try {
    await abrirTurnoAuditoria(casa, prompt(session, 'confira o manifesto do plugin'))
    await registrarAcaoAuditoria(casa, tool(session, {
      id: 'read-manifest',
      name: 'Read',
      input: { file_path: 'plugin.json' }
    }))
    const result = await auditarParada(casa, {
      session_id: session,
      last_assistant_message: 'Conferi o manifesto e encontrei o estado pedido.'
    })
    assert.equal(result.result, 'verified')
    assert.equal(result.turn.evidence[0].kind, 'state-readback')
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('estratégia falha repetida é deduplicada e exige abordagem diferente', async () => {
  const casa = await home()
  const session = 'sessao-estrategia'
  const sameInput = { command: 'comando-inexistente --check' }
  try {
    await abrirTurnoAuditoria(casa, prompt(session, 'execute a verificação necessária'))
    await registrarAcaoAuditoria(casa, tool(session, { id: 'bash-1', name: 'Bash', input: sameInput, failed: true }))
    await registrarAcaoAuditoria(casa, tool(session, { id: 'bash-2', name: 'Bash', input: sameInput, failed: true }))
    const result = await auditarParada(casa, { session_id: session, last_assistant_message: 'Não consegui.' })
    assert.equal(result.decision, 'block')
    assert.equal(result.turn.findings.filter((item) => item.code === 'repeated-failed-strategy').length, 1)
    assert.match(result.reason, /estratégia materialmente diferente|mesma estratégia/i)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('relato de subagente não equivale a resultado verificado', async () => {
  const casa = await home()
  const session = 'sessao-delegada'
  const transcript = join(casa, 'agente-1.jsonl')
  const agent = {
    session_id: session,
    agent_id: 'agente-1',
    agent_type: 'general-purpose',
    agent_transcript_path: transcript,
    cwd: casa
  }
  try {
    await abrirTurnoAuditoria(casa, prompt(session, 'delegue a inspeção e confira o resultado'))
    await registrarDelegacaoAuditoria(casa, agent, 'running')
    await registrarDelegacaoAuditoria(casa, agent, 'reported')
    const first = await auditarParada(casa, { session_id: session, last_assistant_message: 'O agente concluiu.' })
    assert.equal(first.decision, 'block')
    assert.ok(first.turn.findings.some((item) => item.code === 'delegation-without-independent-verification'))

    await registrarAcaoAuditoria(casa, tool(session, {
      id: 'read-agent-result',
      name: 'Read',
      input: { file_path: transcript },
      cwd: casa
    }))
    const final = await auditarParada(casa, {
      session_id: session,
      stop_hook_active: true,
      last_assistant_message: 'Resultado delegado conferido independentemente.'
    })
    assert.equal(final.result, 'verified')
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('hook injeta a auditoria e usa o gate de Stop sem segundo bloqueio', async () => {
  const raiz = await home('omni-audit-hook-')
  const env = {
    ...process.env,
    OMNI_HOME: join(raiz, 'omni-home'),
    CLAUDE_PLUGIN_DATA: join(raiz, 'plugin-data')
  }
  const session_id = 'sessao-hook-audit'
  try {
    await tratarHook({ hook_event_name: 'UserPromptSubmit', session_id, prompt: '/omni:omni', cwd: raiz }, env)
    const submit = await tratarHook({
      hook_event_name: 'UserPromptSubmit',
      session_id,
      prompt: 'corrija o arquivo de teste',
      cwd: raiz
    }, env)
    assert.match(submit.hookSpecificOutput.additionalContext, /AUDITORIA E AUTOCORREÇÃO OBRIGATÓRIAS/)

    await tratarHook(tool(session_id, { id: 'edit-hook', name: 'Edit' }), env)
    const first = await tratarHook({
      hook_event_name: 'Stop',
      session_id,
      last_assistant_message: 'Pronto, corrigi.'
    }, env)
    assert.equal(first.decision, 'block')

    const second = await tratarHook({
      hook_event_name: 'Stop',
      session_id,
      stop_hook_active: true,
      last_assistant_message: 'Pronto, corrigi.'
    }, env)
    assert.equal(second.suppressOutput, true)
    const store = await lerAuditoriaAutocorrecao(env.OMNI_HOME)
    assert.equal(store.turns[0].stopBlocksIssued, 1)
    assert.equal(store.turns[0].state, 'blocked')
  } finally {
    await rm(raiz, { recursive: true, force: true })
  }
})

test('schema futuro é recusado sem sobrescrever o estado', async () => {
  const casa = await home()
  try {
    await abrirTurnoAuditoria(casa, prompt('sessao-futura', 'explique o estado'))
    const path = caminhoDaAuditoriaAutocorrecao(casa)
    const future = JSON.parse(await readFile(path, 'utf8'))
    future.schemaVersion = 2
    await writeFile(path, `${JSON.stringify(future, null, 2)}\n`, 'utf8')
    await assert.rejects(() => lerAuditoriaAutocorrecao(casa), /mais nova/)
    assert.equal(JSON.parse(await readFile(path, 'utf8')).schemaVersion, 2)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('mutacao e readback de objeto alheio nao satisfazem o pedido atual', async () => {
  const casa = await home()
  const session = 'sessao-binding-objeto-alheio'
  try {
    await abrirTurnoAuditoria(casa, prompt(session, 'corrija o arquivo principal.json'))
    await registrarAcaoAuditoria(casa, tool(session, {
      id: 'write-unrelated',
      name: 'Write',
      input: { file_path: 'outro.json', content: '{}' }
    }))
    await registrarAcaoAuditoria(casa, tool(session, {
      id: 'read-unrelated',
      name: 'Read',
      input: { file_path: 'outro.json' }
    }))
    const stopped = await auditarParada(casa, {
      session_id: session,
      last_assistant_message: 'Corrigi e conferi.'
    })
    assert.equal(stopped.decision, 'block')
    assert.ok(stopped.turn.findings.some((item) => item.code === 'requested-action-not-executed'))
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('marker colado em git status nao satisfaz build solicitado', async () => {
  const casa = await home()
  const session = 'sessao-marker-status-nao-e-build'
  try {
    const opened = await abrirTurnoAuditoria(casa, prompt(session, 'execute o build'))
    await registrarAcaoAuditoria(casa, tool(session, {
      id: 'fake-build-status',
      name: 'Bash',
      input: {
        command: `git status --short # omni-request-binding:${opened.turn.requestFingerprint}`,
        cwd: 'C:\\repo'
      }
    }))
    const rejected = await auditarParada(casa, {
      session_id: session,
      last_assistant_message: 'Build concluido.'
    })
    assert.equal(rejected.decision, 'block')
    assert.ok(rejected.turn.findings.some((item) => item.code === 'requested-action-not-executed'))
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('familia estrutural e marcador vinculam build real sem aceitar prova generica', async () => {
  const casa = await home()
  const session = 'sessao-build-vinculado'
  try {
    const opened = await abrirTurnoAuditoria(casa, prompt(session, 'execute o build'))
    await registrarAcaoAuditoria(casa, tool(session, {
      id: 'real-build',
      name: 'Bash',
      input: {
        command: `npm.cmd run build # omni-request-binding:${opened.turn.requestFingerprint}`,
        cwd: 'C:\\repo'
      }
    }))
    await registrarAcaoAuditoria(casa, tool(session, {
      id: 'build-readback',
      name: 'Bash',
      input: { command: 'git diff --stat', cwd: 'C:\\repo' }
    }))
    const accepted = await auditarParada(casa, {
      session_id: session,
      last_assistant_message: 'Build executado e estado conferido.'
    })
    assert.equal(accepted.result, 'verified')
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})
