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
  reconciliarTurnosPendentesAuditoria,
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
    assert.match(opened.context, /AUDITORIA E AUTOCORREÇÃO INTERNAS OBRIGATÓRIAS/)
    assert.match(opened.context, /nunca o repasse ao proprietário como comando ou checklist/i)

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
    ['quero isso corrigido', 'mutation'],
    ['quero o projeto hub corrigido', 'mutation'],
    ['já pode implementar o ajuste', 'mutation'],
    ['faz as correções mapeadas', 'mutation'],
    ['abre o VS Code do projeto hub', 'execution'],
    ['roda os testes do projeto', 'execution'],
    ['precis fazer algumas correções do Omni', 'mutation'],
    ['então verifique o resultado', 'inspection'],
    ['leve isso em consideração para fazer a correção', 'mutation'],
    ['pedi pra ele mesmo fazer uma autoavaliação, leve em consideração isso também pra fazer a correção', 'mutation'],
    ['mão na massa', 'execution']
  ]
  try {
    for (const [text, kind] of cases) {
      const opened = await abrirTurnoAuditoria(casa, prompt(`sessao-${kind}-${text.length}`, text))
      assert.equal(opened.turn.requestKind, kind, text)
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

test('mutação sem leitura posterior bloqueia uma vez e permanece recuperavel sem loop', async () => {
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
    assert.equal(second.result, 'repair-deferred')
    assert.equal(second.decision, null)
    assert.equal(second.recoverable, true)
    assert.equal(second.turn.state, 'repairing')
    assert.equal(second.turn.closedAt, null)
    assert.ok(second.turn.findings.every((item) => item.state === 'open'))
    assert.ok(second.turn.corrections.every((item) => item.state === 'requested'))
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

test('novo prompt e SessionEnd preservam turno interrompido como trabalho recuperavel', async () => {
  const casa = await home()
  const privateMarker = 'NAO-GRAVAR-CONVERSA-ABANDONADA-9182'
  try {
    await abrirTurnoAuditoria(casa, prompt('sessao-novo-prompt', `corrija o arquivo ${privateMarker}`))
    await abrirTurnoAuditoria(casa, prompt('sessao-novo-prompt', 'agora verifique outra coisa'))

    await abrirTurnoAuditoria(casa, prompt('sessao-encerrada', 'execute a tarefa pendente'))
    await encerrarSessaoAuditoria(casa, { session_id: 'sessao-encerrada' })

    const store = await lerAuditoriaAutocorrecao(casa)
    const abandoned = store.turns.filter((item) =>
      item.findings.some((finding) => finding.code === 'turn-interrupted-recovery')
    )
    assert.equal(abandoned.length, 2)
    for (const turn of abandoned) {
      assert.equal(turn.state, 'repairing')
      assert.equal(turn.closedAt, null)
      assert.ok(turn.findings.some((item) => item.code === 'turn-interrupted-recovery' && item.state === 'open'))
      assert.ok(turn.corrections.some((item) => item.state === 'requested'))
      assert.ok(turn.commitments.every((item) => item.state === 'open'))
      assert.equal(turn.recovery.state, 'queued')
      assert.equal(
        turn.findings.filter((item) => item.code === 'turn-interrupted-recovery').length,
        1
      )
    }
    const stored = await readFile(caminhoDaAuditoriaAutocorrecao(casa), 'utf8')
    assert.equal(stored.includes(privateMarker), false)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('formas factuais próximas dos verbos operacionais continuam conversa', async () => {
  const casa = await home()
  const cases = [
    'quero entender como isso foi corrigido',
    'faz sentido usar TypeScript nessa arquitetura?',
    'o VS Code abre o projeto automaticamente?',
    'o build roda em Windows?',
    'qual comando abre o VS Code?'
  ]
  try {
    for (const [index, text] of cases.entries()) {
      const opened = await abrirTurnoAuditoria(casa, prompt(`sessao-factual-${index}`, text))
      assert.equal(opened.turn.requestKind, 'conversation', text)
      assert.deepEqual(opened.turn.commitments.map((item) => item.kind), ['answer-current-request'])
    }
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('gate recusa devolver ao proprietário trabalho operacional já autorizado', async () => {
  const casa = await home()
  const answers = [
    'Execute os testes e abra o VS Code para conferir.',
    'Pendências:\n- Rode os testes\n- Abra o VS Code.',
    'Roda os testes e abre o VS Code.',
    'Faça as correções restantes.',
    'Faz as correções restantes.',
    'Você pode executar os testes agora.',
    'Você deve abrir o VS Code para conferir.',
    'Você precisa rodar os testes.',
    'Você tem que verificar a instalação.',
    'Agora é só rodar os testes.'
  ]
  try {
    for (const [index, answer] of answers.entries()) {
      const session = `sessao-trabalho-devolvido-ao-dono-${index}`
      await abrirTurnoAuditoria(casa, prompt(session, 'corrija o contrato e confira o resultado'))
      await registrarAcaoAuditoria(casa, tool(session, {
        id: `edit-owner-transfer-${index}`,
        name: 'Edit',
        input: { file_path: 'contrato.json', old_string: 'a', new_string: 'b' }
      }))
      await registrarAcaoAuditoria(casa, tool(session, {
        id: `read-owner-transfer-${index}`,
        name: 'Read',
        input: { file_path: 'contrato.json' }
      }))

      const result = await auditarParada(casa, {
        session_id: session,
        last_assistant_message: answer
      })
      assert.equal(result.decision, 'block', answer)
      assert.ok(
        result.turn.findings.some((item) => item.code === 'authorized-work-returned-to-owner'),
        answer
      )
      assert.match(result.reason, /o Omni retoma o trabalho já autorizado/i)
      assert.match(result.reason, /nunca deve virar comando ou checklist para o proprietário/i)
    }
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('gate não confunde descrição de estado com ordem ao proprietário', async () => {
  const casa = await home()
  const answers = [
    'O worker roda os testes e abre o VS Code; eu verifico o resultado.',
    'Faz sentido manter esse comportamento; a correção foi verificada.'
  ]
  try {
    for (const [index, answer] of answers.entries()) {
      const session = `sessao-sem-falso-imperativo-${index}`
      await abrirTurnoAuditoria(casa, prompt(session, 'corrija o contrato e confira o resultado'))
      await registrarAcaoAuditoria(casa, tool(session, {
        id: `edit-sem-falso-${index}`,
        name: 'Edit',
        input: { file_path: 'contrato.json', old_string: 'a', new_string: 'b' }
      }))
      await registrarAcaoAuditoria(casa, tool(session, {
        id: `read-sem-falso-${index}`,
        name: 'Read',
        input: { file_path: 'contrato.json' }
      }))
      const result = await auditarParada(casa, {
        session_id: session,
        last_assistant_message: answer
      })
      assert.equal(result.result, 'verified', answer)
      assert.equal(result.decision, null, answer)
    }
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('SessionStart reconcilia turno orfao sem fingir que fingerprints permitem reexecutar a acao', async () => {
  const casa = await home()
  const session = 'sessao-interrompida-reconciliacao'
  try {
    await abrirTurnoAuditoria(casa, prompt(session, 'corrija o arquivo contrato.json'))
    await registrarAcaoAuditoria(casa, tool(session, {
      id: 'write-before-session-end',
      name: 'Write',
      input: { file_path: 'contrato.json', content: '{}' }
    }))
    await auditarParada(casa, {
      session_id: session,
      last_assistant_message: 'A alteracao foi aplicada.'
    })
    await encerrarSessaoAuditoria(casa, { session_id: session })

    const reconciled = await reconciliarTurnosPendentesAuditoria(casa, {
      hook_event_name: 'SessionStart',
      session_id: 'sessao-nova-reconciliacao'
    }, { at: '2026-08-31T15:00:00.000Z' })
    assert.equal(reconciled.result, 'reconciled')
    assert.ok(reconciled.summary.historicalUnverifiable >= 1)
    assert.ok(reconciled.summary.ownerReconfirmationRequired >= 1)

    const stored = await lerAuditoriaAutocorrecao(casa)
    const historical = stored.turns[0]
    assert.equal(historical.state, 'blocked')
    assert.equal(historical.recovery.state, 'owner-reconfirmation-required')
    assert.equal(historical.actions.length, 1)
    assert.equal(
      historical.findings.find((item) => item.code === 'mutation-without-readback').state,
      'historical-unverifiable'
    )
    assert.equal(
      historical.findings.find((item) => item.code === 'turn-interrupted-recovery').state,
      'owner-reconfirmation-required'
    )
    assert.equal(
      historical.findings.filter((item) => item.code === 'turn-interrupted-recovery').length,
      1
    )
    assert.ok(historical.findings.every((item) => !['open', 'unresolved'].includes(item.state)))

    const repeated = await reconciliarTurnosPendentesAuditoria(casa, {
      hook_event_name: 'SessionStart',
      session_id: 'sessao-nova-reconciliacao'
    }, { at: '2026-08-31T15:01:00.000Z' })
    assert.equal(repeated.result, 'unchanged')
    assert.equal(repeated.summary.terminalized, 0)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('migracao consolida marcadores legados duplicados de interrupcao sem perder a pendencia canonica', async () => {
  const casa = await home()
  try {
    await abrirTurnoAuditoria(casa, prompt('sessao-interrupcao-duplicada', 'execute o build'))
    await encerrarSessaoAuditoria(casa, { session_id: 'sessao-interrupcao-duplicada' })
    const path = caminhoDaAuditoriaAutocorrecao(casa)
    const legacy = JSON.parse(await readFile(path, 'utf8'))
    const turn = legacy.turns[0]
    const canonical = turn.findings.find((item) => item.code === 'turn-interrupted-recovery')
    const duplicate = {
      ...canonical,
      id: 'audit-finding-legacy-duplicate',
      fingerprint: 'a'.repeat(64),
      detectedAt: '2026-08-30T10:00:00.000Z',
      updatedAt: '2026-08-30T10:00:00.000Z'
    }
    turn.findings.unshift(duplicate)
    turn.corrections.unshift({
      ...turn.corrections.find((item) => item.findingFingerprint === canonical.fingerprint),
      id: 'audit-correction-legacy-duplicate',
      findingFingerprint: duplicate.fingerprint,
      createdAt: duplicate.detectedAt,
      updatedAt: duplicate.updatedAt
    })
    await writeFile(path, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8')

    const migrated = await lerAuditoriaAutocorrecao(casa)
    const interruptions = migrated.turns[0].findings.filter((item) =>
      item.code === 'turn-interrupted-recovery'
    )
    assert.equal(interruptions.length, 2)
    assert.equal(interruptions.filter((item) => ['open', 'unresolved'].includes(item.state)).length, 1)
    assert.equal(interruptions.filter((item) => item.state === 'superseded').length, 1)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('pedido repetido reivindica pendencia duravel e so a supersede apos nova verificacao', async () => {
  const casa = await home()
  const value = 'confira o manifesto plugin.json'
  try {
    await abrirTurnoAuditoria(casa, prompt('sessao-original', value))
    await auditarParada(casa, {
      session_id: 'sessao-original',
      last_assistant_message: 'Ainda nao conferi.'
    })
    await encerrarSessaoAuditoria(casa, { session_id: 'sessao-original' })
    await reconciliarTurnosPendentesAuditoria(casa, {
      hook_event_name: 'SessionStart',
      session_id: 'sessao-retomada'
    })

    const opened = await abrirTurnoAuditoria(casa, prompt('sessao-retomada', value))
    assert.equal(opened.recovery.claimed.length, 1)
    assert.match(opened.context, /RETOMADA DURAVEL/)
    assert.match(opened.context, /nunca vira ordem ou checklist para o proprietario/i)
    assert.equal(opened.turn.actions.length, 0)

    let stored = await lerAuditoriaAutocorrecao(casa)
    const historical = stored.turns.find((item) => item.id === opened.recovery.claimed[0].turnId)
    assert.equal(historical.recovery.state, 'claimed')
    assert.equal(historical.state, 'blocked')

    await registrarAcaoAuditoria(casa, tool('sessao-retomada', {
      id: 'fresh-readback',
      name: 'Read',
      input: { file_path: 'plugin.json' }
    }))
    const verified = await auditarParada(casa, {
      session_id: 'sessao-retomada',
      last_assistant_message: 'Manifesto conferido no estado real.'
    })
    assert.equal(verified.result, 'verified')
    assert.deepEqual(verified.supersededRecoveryTurnIds, [historical.id])

    stored = await lerAuditoriaAutocorrecao(casa)
    const superseded = stored.turns.find((item) => item.id === historical.id)
    assert.equal(superseded.recovery.state, 'superseded')
    assert.ok(superseded.findings.every((item) =>
      ['corrected', 'superseded'].includes(item.state)
    ))
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('pedido diferente nao reivindica nem reabre pendencia que exige o proprietario', async () => {
  const casa = await home()
  try {
    await abrirTurnoAuditoria(casa, prompt('sessao-antiga', 'execute o build'))
    await auditarParada(casa, { session_id: 'sessao-antiga', last_assistant_message: 'Nao executei.' })
    await encerrarSessaoAuditoria(casa, { session_id: 'sessao-antiga' })
    await reconciliarTurnosPendentesAuditoria(casa, { session_id: 'sessao-nova' })

    const opened = await abrirTurnoAuditoria(casa, prompt('sessao-nova', 'execute os testes'))
    assert.deepEqual(opened.recovery.claimed, [])
    const stored = await lerAuditoriaAutocorrecao(casa)
    const historical = stored.turns[0]
    assert.equal(historical.recovery.state, 'owner-reconfirmation-required')
    assert.ok(historical.findings.every((item) => !['open', 'unresolved'].includes(item.state)))
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
    assert.match(submit.hookSpecificOutput.additionalContext, /AUDITORIA E AUTOCORREÇÃO INTERNAS OBRIGATÓRIAS/)

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
    assert.equal(store.turns[0].state, 'repairing')
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

test('turno bloqueado legado com pendencia migra para reparo retomavel', async () => {
  const casa = await home()
  const session = 'sessao-migracao-reparo'
  try {
    await abrirTurnoAuditoria(casa, prompt(session, 'corrija o arquivo legado'))
    await auditarParada(casa, {
      session_id: session,
      last_assistant_message: 'Ainda nao executei.'
    })
    const path = caminhoDaAuditoriaAutocorrecao(casa)
    const legacy = JSON.parse(await readFile(path, 'utf8'))
    const turn = legacy.turns[0]
    turn.state = 'blocked'
    turn.closedAt = '2026-08-28T18:00:00.000Z'
    for (const commitment of turn.commitments) commitment.state = 'blocked'
    for (const finding of turn.findings) finding.state = 'unresolved'
    for (const correction of turn.corrections) correction.state = 'failed'
    await writeFile(path, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8')

    const migrated = await lerAuditoriaAutocorrecao(casa)
    assert.equal(migrated.turns[0].state, 'repairing')
    assert.equal(migrated.turns[0].closedAt, null)
    assert.ok(migrated.turns[0].commitments.every((item) => item.state === 'open'))
    assert.ok(migrated.turns[0].findings.every((item) => item.state === 'open'))
    assert.ok(migrated.turns[0].corrections.every((item) => item.state === 'requested'))
    assert.equal(migrated.turns[0].recovery.state, 'queued')
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('turno legado sem algoritmo do objetivo termina como historico nao verificavel', async () => {
  const casa = await home()
  try {
    await abrirTurnoAuditoria(casa, prompt('sessao-legada-sem-binding', 'execute a tarefa antiga'))
    await auditarParada(casa, {
      session_id: 'sessao-legada-sem-binding',
      last_assistant_message: 'A tarefa nao foi executada.'
    })
    await encerrarSessaoAuditoria(casa, { session_id: 'sessao-legada-sem-binding' })

    const path = caminhoDaAuditoriaAutocorrecao(casa)
    const legacy = JSON.parse(await readFile(path, 'utf8'))
    delete legacy.turns[0].requestFingerprintAlgorithm
    delete legacy.turns[0].recovery
    await writeFile(path, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8')

    const reconciled = await reconciliarTurnosPendentesAuditoria(casa, {
      hook_event_name: 'SessionStart',
      session_id: 'sessao-depois-do-legado'
    })
    assert.equal(reconciled.result, 'reconciled')
    const stored = await lerAuditoriaAutocorrecao(casa)
    assert.equal(stored.turns[0].recovery.state, 'historical-unverifiable')
    assert.ok(stored.turns[0].findings.every((item) => item.state === 'historical-unverifiable'))
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
