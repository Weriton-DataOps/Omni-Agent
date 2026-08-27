import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { lerAtalhos } from '../runtime/atalhos.mjs'
import { lerCicloOperacional } from '../runtime/ciclo-operacional.mjs'
import { lerFalhas } from '../runtime/falhas.mjs'
import { lerMemoria } from '../runtime/memoria.mjs'
import { observarPrompt } from '../runtime/observador.mjs'
import { processarExperiencia } from '../runtime/pipeline-memoria.mjs'
import { lerEstadoVarredura, varrerAtividadesDoDia } from '../runtime/varredura-diaria.mjs'

function registro(sessionId, uuid, timestamp, role, content, extra = {}) {
  return JSON.stringify({
    type: role,
    uuid,
    timestamp,
    cwd: 'C:\\projetos\\teste',
    sessionId,
    message: { role, content },
    ...extra
  })
}

function transcriptOmni(sessionId, date = '2026-08-26') {
  const lines = []
  let sequence = 0
  const time = () => `${date}T${String(10 + Math.floor(sequence / 60)).padStart(2, '0')}:${String(sequence++ % 60).padStart(2, '0')}:00-03:00`
  const user = (text) => lines.push(registro(sessionId, `user-${sequence}`, time(), 'user', text))
  const answer = (text = 'Concluido com evidencia.') => lines.push(registro(sessionId, `assistant-${sequence}`, time(), 'assistant', [{ type: 'text', text }]))
  const success = (index) => {
    user(`Implemente a atividade verificada ${index}.`)
    lines.push(registro(sessionId, `tools-${sequence}`, time(), 'assistant', [
      { type: 'tool_use', id: `read-${index}`, name: 'Read', input: {} },
      { type: 'tool_use', id: `bash-${index}`, name: 'Bash', input: {} }
    ]))
    lines.push(registro(sessionId, `results-${sequence}`, time(), 'user', [
      { type: 'tool_result', tool_use_id: `read-${index}`, content: 'ok' },
      { type: 'tool_result', tool_use_id: `bash-${index}`, content: 'ok' }
    ]))
    answer()
  }

  lines.push(registro(sessionId, 'activation', time(), 'user', '<command-message>omni:omni</command-message>\n<command-name>/omni:omni</command-name>'))
  user('Prefiro mapas antes de textos longos.')
  answer()
  user('Mais uma vez voce passou a ordem sem deixar o prompt visivel na outra sessao.')
  answer()
  user('Verifique a tarefa com falha.')
  lines.push(registro(sessionId, 'tool-failure-call', time(), 'assistant', [
    { type: 'tool_use', id: 'tool-failure-1', name: 'Bash', input: {} }
  ]))
  lines.push(registro(sessionId, 'tool-failure-result', time(), 'user', [
    { type: 'tool_result', tool_use_id: 'tool-failure-1', is_error: true, content: 'Exit code 1: permission denied' }
  ]))
  answer('Falha identificada.')
  for (let index = 1; index <= 4; index += 1) success(index)
  return `${lines.join('\n')}\n`
}

test('varredura recupera lacunas do Omni, aprende rotina repetida e nao duplica evidencia', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omni-daily-scan-'))
  const home = join(root, 'home')
  const projects = join(root, 'projects')
  try {
    await mkdir(projects, { recursive: true })
    await writeFile(join(projects, 'omni.jsonl'), transcriptOmni('session-omni'), 'utf8')
    await writeFile(join(projects, 'omni-duplicado.jsonl'), transcriptOmni('session-omni'), 'utf8')
    await writeFile(
      join(projects, 'fora-do-omni.jsonl'),
      `${registro('session-common', 'u1', '2026-08-26T12:00:00-03:00', 'user', 'Prefiro guardar isto.')}` +
        `\n${registro('session-common', 'a1', '2026-08-26T12:01:00-03:00', 'assistant', [{ type: 'text', text: 'Certo.' }])}\n`,
      'utf8'
    )

    const first = await varrerAtividadesDoDia(home, {
      date: '2026-08-26',
      projectsRoot: projects,
      now: new Date('2026-08-26T22:00:00-03:00')
    })
    assert.equal(first.result, 'completed')
    assert.equal(first.scan.activatedSessions, 1)
    assert.equal(first.scan.activitiesFound, 14)
    assert.equal(first.scan.activitiesProcessed, 7)
    assert.equal(first.scan.activitiesAlreadyKnown, 7)
    assert.ok(first.scan.observations.gapsRecovered >= 7)
    assert.equal(first.scan.changes.shortcuts, 1)

    const [memory, failures, shortcuts, cycle] = await Promise.all([
      lerMemoria(home),
      lerFalhas(home),
      lerAtalhos(home),
      lerCicloOperacional(home)
    ])
    assert.equal(memory.confirmed.length, 1)
    assert.ok(failures.patterns.length >= 2)
    assert.equal(shortcuts.shortcuts.length, 1)
    assert.equal(shortcuts.shortcuts[0].status, 'validated')
    assert.ok(cycle.improvementCandidates.length >= 2)

    const counts = {
      memory: memory.confirmed.length + memory.candidates.length,
      failures: failures.patterns.length,
      shortcuts: shortcuts.shortcuts.length,
      improvements: cycle.improvementCandidates.length
    }
    const second = await varrerAtividadesDoDia(home, {
      date: '2026-08-26',
      projectsRoot: projects,
      now: new Date('2026-08-26T22:05:00-03:00')
    })
    assert.equal(second.scan.activitiesProcessed, 0)
    assert.deepEqual(second.scan.after, {
      memory: { confirmed: counts.memory, candidates: 0 },
      failures: counts.failures,
      shortcuts: counts.shortcuts,
      operationalImprovements: counts.improvements
    })
    const audit = await lerEstadoVarredura(home)
    assert.equal(JSON.stringify(audit).includes('Prefiro mapas'), false)
    assert.equal(audit.scans.every((scan) => scan.rawConversationStored === false), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('varredura reconhece o que o hook ja capturou e nao reforca a mesma memoria', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omni-daily-covered-'))
  const home = join(root, 'home')
  const projects = join(root, 'projects')
  const sessionId = 'session-covered'
  const prompt = 'Prefiro analogias curtas antes de explicacoes longas.'
  try {
    await mkdir(projects, { recursive: true })
    await processarExperiencia(home, prompt)
    await observarPrompt(home, { session_id: sessionId, cwd: 'C:\\projetos\\teste', prompt })
    await writeFile(
      join(projects, 'covered.jsonl'),
      [
        registro(sessionId, 'activation', '2026-08-26T10:00:00-03:00', 'user', '<command-name>/omni:omni</command-name>'),
        registro(sessionId, 'prompt', '2026-08-26T10:01:00-03:00', 'user', prompt),
        registro(sessionId, 'answer', '2026-08-26T10:02:00-03:00', 'assistant', [{ type: 'text', text: 'Entendido.' }])
      ].join('\n') + '\n',
      'utf8'
    )
    const result = await varrerAtividadesDoDia(home, {
      date: '2026-08-26',
      projectsRoot: projects,
      now: new Date('2026-08-26T22:00:00-03:00')
    })
    assert.equal(result.scan.activitiesProcessed, 1)
    assert.equal(result.scan.observations.gapsRecovered, 0)
    assert.equal(result.scan.observations.memories, 0)
    assert.equal((await lerMemoria(home)).confirmed[0].occurrences, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
