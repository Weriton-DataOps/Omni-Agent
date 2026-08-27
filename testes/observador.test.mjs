import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { lerCicloOperacional } from '../runtime/ciclo-operacional.mjs'
import { lerFalhas } from '../runtime/falhas.mjs'
import {
  assinaturaDiagnosticaFalha,
  observarFerramenta,
  observarFimSubagente,
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

test('conclusão de subagente registra delegação e atalho observado', async () => {
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
    assert.equal(cycle.delegations[0].state, 'completed')
    assert.equal(shortcuts.shortcuts.length, 1)
    assert.equal(shortcuts.shortcuts[0].successCount, 1)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})
