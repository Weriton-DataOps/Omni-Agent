import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  atualizarDelegacao,
  lerCicloOperacional,
  prepararDelegacao
} from '../runtime/ciclo-operacional.mjs'
import { lerFalhas } from '../runtime/falhas.mjs'
import {
  assinaturaDiagnosticaFalha,
  observarFerramenta,
  observarFimSubagente,
  observarInicioSubagente,
  observarPrompt
} from '../runtime/observador.mjs'
import { lerAtalhos } from '../runtime/atalhos.mjs'

async function home() {
  return mkdtemp(join(tmpdir(), 'omni-observer-'))
}

test('correção do proprietário alimenta falha e melhoria automaticamente', async () => {
  const casa = await home()
  try {
    await observarPrompt(casa, {
      session_id: 's1',
      prompt: 'Mais uma vez você passou a ordem sem deixar o prompt visível na outra sessão.'
    })
    const failures = await lerFalhas(casa)
    const cycle = await lerCicloOperacional(casa)
    assert.equal(failures.patterns.length, 1)
    assert.equal(cycle.improvementCandidates.length, 1)
    assert.equal(cycle.improvementCandidates[0].destination, 'operational-rule')
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('observador devolve o resultado real quando candidata pronta tenta materialização', async () => {
  const casa = await home()
  const input = {
    session_id: 's-materialization-result',
    prompt: 'Mais uma vez você passou a ordem sem deixar o prompt visível na outra sessão.'
  }
  try {
    await observarPrompt(casa, input)
    const observed = await observarPrompt(casa, input)
    const correction = observed.corrections[0]
    assert.equal(correction.candidateStatus, 'ready')
    assert.equal(correction.materialization.result, 'unconfigured')
    assert.match(correction.candidateId, /^improvement-/)
    assert.equal(correction.destination, 'operational-rule')
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('detector de fidelidade ignora estado factual e aceita somente correcao dirigida pelo proprietario', async () => {
  const casa = await home()
  try {
    for (const prompt of [
      'O deploy não foi concluído ontem.',
      'Esse relatório não era o final.',
      'A tarefa não foi executada pelo servidor.'
    ]) {
      const observed = await observarPrompt(casa, {
        session_id: `factual-${prompt.length}`,
        origin: 'owner-live',
        prompt
      })
      assert.equal(observed.corrections.some((item) => item.id === 'request-unfaithful'), false)
    }

    for (const prompt of [
      'Eu não pedi isso; refaça exatamente o solicitado.',
      'Isso não foi o que eu pedi.',
      'Seja mais fiel ao que eu falei.',
      'Você entendeu errado e executou outra coisa.'
    ]) {
      const observed = await observarPrompt(casa, {
        session_id: `correction-${prompt.length}`,
        origin: 'owner-transcript',
        prompt
      })
      assert.equal(observed.corrections.some((item) => item.id === 'request-unfaithful'), true)
    }
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('detector de personalidade exige feedback negativo inequívoco do proprietário', async () => {
  const casa = await home()
  try {
    const neutralOrPositive = [
      'Quero entender como funciona a personalidade do Omni.',
      'A personalidade ficou ótima e a resposta não está seca.',
      'O termo "personalidade seca" aparece no documento; o que significa?',
      'Você acha melhor humor seco ou sarcasmo?',
      'Faça uma pergunta sobre personalidade e analogias.',
      'O diálogo está claro e com boas analogias.'
    ]
    for (const [index, prompt] of neutralOrPositive.entries()) {
      const observed = await observarPrompt(casa, {
        session_id: `personality-neutral-${index}`,
        origin: 'owner-live',
        prompt
      })
      assert.equal(observed.corrections.some((item) => item.id === 'dry-personality'), false)
    }

    const negative = [
      'O diálogo ainda está frio e com poucas analogias.',
      'Você está muito seco e genérico nesta conversa.',
      'Não está seca, mas a resposta continua genérica.',
      'A personalidade não apareceu nesta resposta.',
      'Quero mais humor, sarcasmo e analogias no seu jeito de conversar.'
    ]
    for (const [index, prompt] of negative.entries()) {
      const observed = await observarPrompt(casa, {
        session_id: `personality-negative-${index}`,
        origin: 'owner-transcript',
        prompt
      })
      assert.equal(observed.corrections.some((item) => item.id === 'dry-personality'), true)
    }

    const foreign = await observarPrompt(casa, {
      session_id: 'personality-system',
      origin: 'system',
      prompt: 'O diálogo ainda está frio e sem vida.'
    })
    assert.equal(foreign.corrections.some((item) => item.id === 'dry-personality'), false)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('mensagem de sistema ou entre sessoes nunca vira correcao do proprietario', async () => {
  const casa = await home()
  try {
    for (const origin of ['system', 'inter-session', 'tool-result', 'unknown']) {
      const observed = await observarPrompt(casa, {
        session_id: `foreign-${origin}`,
        origin,
        prompt: 'Eu não pedi isso; você fez errado.'
      })
      assert.deepEqual(observed.corrections, [])
    }
    assert.equal((await lerFalhas(casa)).patterns.length, 0)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('falha de ferramenta é classificada sem guardar erro bruto', async () => {
  const casa = await home()
  try {
    const secret = ['ghp', 'abcdefghijklmnopqrstuvwxyz123456'].join('_')
    await observarFerramenta(casa, {
      hook_event_name: 'PostToolUseFailure',
      session_id: 's2',
      tool_use_id: 'tool-1',
      tool_name: 'Bash',
      error: `Exit code 1\n token=${secret}`
    })
    const cycle = await lerCicloOperacional(casa)
    const failures = await lerFalhas(casa)
    assert.equal(cycle.events.length, 1)
    assert.equal(JSON.stringify(cycle).includes(secret), false)
    assert.equal(JSON.stringify(failures).includes(secret), false)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('assinatura v2 separa famílias de comando com o mesmo Exit code 1', async () => {
  const casa = await home()
  try {
    for (const [index, command] of ['git status', 'git status', 'npm test'].entries()) {
      await observarFerramenta(casa, {
        hook_event_name: 'PostToolUseFailure',
        session_id: 's-family',
        tool_use_id: `family-${index}`,
        tool_name: 'Bash',
        tool_input: { command },
        cwd: 'C:\\projeto',
        error: 'Exit code 1'
      })
    }
    const failures = await lerFalhas(casa)
    assert.equal(failures.patterns.length, 2)
    assert.deepEqual(failures.patterns.map((pattern) => pattern.occurrences).sort(), [1, 2])
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('assinatura v2 estabiliza caminhos variáveis sem expor comando ou segredo', () => {
  const secret = ['ghp', 'abcdefghijklmnopqrstuvwxyz123456'].join('_')
  const first = assinaturaDiagnosticaFalha({
    tool_name: 'Bash',
    tool_input: { command: `robocopy C:\\tmp\\run-101 C:\\destino "${secret}"` },
    cwd: 'C:\\projeto',
    error: 'Exit code 1'
  })
  const second = assinaturaDiagnosticaFalha({
    tool_name: 'Bash',
    tool_input: { command: 'robocopy C:\\tmp\\run-202 C:\\destino "outro-valor"' },
    cwd: 'C:\\projeto',
    error: 'Exit code 1'
  })
  assert.equal(first, second)
  assert.equal(first.includes(secret), false)
  assert.equal(first.includes('C:\\tmp'), false)
})

test('assinatura v2 distingue contexto e ferramenta de mensageria', () => {
  const base = {
    tool_name: 'Bash',
    tool_input: { command: 'git status' },
    error: 'permission denied'
  }
  const projectA = assinaturaDiagnosticaFalha({ ...base, cwd: 'C:\\projeto-a' })
  const projectB = assinaturaDiagnosticaFalha({ ...base, cwd: 'C:\\projeto-b' })
  const message = assinaturaDiagnosticaFalha({
    tool_name: 'SendMessage',
    tool_input: { message: 'conteúdo privado', recipient: 'agente' },
    cwd: 'C:\\projeto-a',
    error: 'permission denied'
  })
  assert.notEqual(projectA, projectB)
  assert.notEqual(projectA, message)
  assert.equal(message.includes('conteúdo privado'), false)
})

test('SubagentStop sem delegação preparada não fabrica sucesso nem atalho', async () => {
  const casa = await home()
  try {
    await observarFimSubagente(casa, {
      session_id: 's3',
      agent_id: 'agent-1',
      agent_type: 'executor',
      agent_transcript_path: 'local-transcript.jsonl',
      last_assistant_message: 'Tarefa concluída com 12 testes verdes.'
    })
    const cycle = await lerCicloOperacional(casa)
    const shortcuts = await lerAtalhos(casa)
    assert.equal(cycle.delegations[0].state, 'failed')
    assert.equal(cycle.delegations[0].verificationEvidenceFingerprint, null)
    assert.equal(shortcuts.shortcuts.length, 0)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('observador preserva o FSM: início rastreado executa e parada apenas relata', async () => {
  const casa = await home()
  try {
    const { delegation } = await prepararDelegacao(casa, {
      target: 'executor temporario',
      prompt: 'Execute a validação e devolva evidência.',
      sessionId: 's-tracked'
    })
    await atualizarDelegacao(casa, delegation.id, 'visible', {
      evidence: 'prompt-visible-tracked'
    })
    const started = await observarInicioSubagente(casa, {
      session_id: 's-tracked',
      agent_id: 'agent-tracked',
      agent_type: 'executor',
      cwd: 'C:\\projeto'
    })
    assert.equal(started.result, 'running')
    const reported = await observarFimSubagente(casa, {
      session_id: 's-tracked',
      agent_id: 'agent-tracked',
      agent_type: 'executor',
      agent_transcript_path: 'tracked-transcript.jsonl',
      last_assistant_message: 'Validação executada e relatório entregue.',
      cwd: 'C:\\projeto'
    })
    assert.equal(reported.result, 'reported')

    const cycle = await lerCicloOperacional(casa)
    const tracked = cycle.delegations.find((item) => item.id === delegation.id)
    assert.equal(tracked.state, 'reported')
    assert.equal(tracked.verificationEvidenceFingerprint, null)
    assert.deepEqual(
      cycle.events
        .filter((item) => item.sessionFingerprint === tracked.sessionFingerprint)
        .map((item) => [item.eventType, item.status]),
      [['delegation-start', 'running'], ['delegation-report', 'reported']]
    )
    assert.equal((await lerAtalhos(casa)).shortcuts.length, 0)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('início sem preparação aparece como falha de governança, não como running', async () => {
  const casa = await home()
  try {
    const observed = await observarInicioSubagente(casa, {
      session_id: 's-untracked-start',
      agent_id: 'agent-untracked-start',
      agent_type: 'executor',
      cwd: 'C:\\projeto'
    })
    assert.equal(observed.result, 'failed')
    const cycle = await lerCicloOperacional(casa)
    assert.equal(cycle.delegations[0].state, 'failed')
    assert.equal(cycle.events.at(-1).status, 'failed')
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})
