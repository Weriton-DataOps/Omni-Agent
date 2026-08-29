import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { abrirTurnoAuditoria, registrarAcaoAuditoria } from '../runtime/auditoria-autocorrecao.mjs'
import { lerAtalhos } from '../runtime/atalhos.mjs'
import { lerCicloOperacional } from '../runtime/ciclo-operacional.mjs'
import { lerFalhas } from '../runtime/falhas.mjs'
import { lerMemoria } from '../runtime/memoria.mjs'
import { observarPrompt } from '../runtime/observador.mjs'
import { processarExperiencia } from '../runtime/pipeline-memoria.mjs'
import { configurarRepositorioCanonico } from '../runtime/evolucao.mjs'
import {
  caminhoDaCoberturaAoVivo,
  caminhoDaVarredura,
  lerEstadoVarredura,
  registrarCoberturaAoVivo,
  varrerAtividadesDoDia
} from '../runtime/varredura-diaria.mjs'

function inicializarGit(repo) {
  for (const args of [
    ['init'],
    ['config', 'user.email', 'omni-tests@example.invalid'],
    ['config', 'user.name', 'Omni Tests'],
    ['config', 'core.autocrlf', 'false'],
    ['add', '.'],
    ['commit', '-m', 'fixture baseline']
  ]) {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true })
    assert.equal(result.status, 0, result.stderr || result.stdout)
  }
}

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
    for (let index = 1; index <= 4; index += 1) {
      const openedAt = `2026-08-26T${String(10 + index).padStart(2, '0')}:00:00-03:00`
      const verifiedAt = `2026-08-26T${String(10 + index).padStart(2, '0')}:00:01-03:00`
      await abrirTurnoAuditoria(home, {
        session_id: 'session-omni',
        prompt: `Implemente a atividade verificada ${index}.`
      }, { at: openedAt })
      await registrarAcaoAuditoria(home, {
        hook_event_name: 'PostToolUse',
        session_id: 'session-omni',
        tool_use_id: `bash-${index}`,
        tool_name: 'Bash',
        tool_input: { command: 'node --test testes/varredura-diaria.test.mjs' },
        cwd: 'C:\\projetos\\teste'
      }, { at: verifiedAt })
    }

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

test('varredura tenta candidatas prontas e relata materialização local sem fingir release ou publicação', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omni-daily-materialization-'))
  const home = join(root, 'home')
  const projects = join(root, 'projects')
  const repo = join(root, 'repo')
  const sessionId = 'session-materialization'
  const correction = 'Mais uma vez você passou a ordem sem deixar o prompt visível na outra sessão.'
  const routing = 'Você pegou uma função que não era dele e deveria ter passado para a sessão correta.'
  try {
    await mkdir(projects, { recursive: true })
    await mkdir(join(repo, 'contratos', 'operacao'), { recursive: true })
    await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'omni-agent' }), 'utf8')
    await writeFile(join(repo, 'contratos', 'operacao', 'regras-aprendidas.json'), JSON.stringify({
      schemaVersion: 1,
      contract: 'omni-learned-rules-v1',
      rules: []
    }), 'utf8')
    inicializarGit(repo)
    await configurarRepositorioCanonico(home, repo)
    await writeFile(join(projects, 'materialization.jsonl'), [
      registro(sessionId, 'activation', '2026-08-28T09:00:00-03:00', 'user', '<command-name>/omni:omni</command-name>'),
      registro(sessionId, 'correction-1', '2026-08-28T09:01:00-03:00', 'user', correction),
      registro(sessionId, 'answer-1', '2026-08-28T09:02:00-03:00', 'assistant', [{ type: 'text', text: 'Entendido.' }]),
      registro(sessionId, 'correction-2', '2026-08-28T09:03:00-03:00', 'user', correction),
      registro(sessionId, 'answer-2', '2026-08-28T09:04:00-03:00', 'assistant', [{ type: 'text', text: 'Registrado.' }]),
      registro(sessionId, 'routing-1', '2026-08-28T09:05:00-03:00', 'user', routing),
      registro(sessionId, 'answer-3', '2026-08-28T09:06:00-03:00', 'assistant', [{ type: 'text', text: 'Entendido.' }]),
      registro(sessionId, 'routing-2', '2026-08-28T09:07:00-03:00', 'user', routing),
      registro(sessionId, 'answer-4', '2026-08-28T09:08:00-03:00', 'assistant', [{ type: 'text', text: 'Registrado.' }])
    ].join('\n') + '\n', 'utf8')

    const result = await varrerAtividadesDoDia(home, {
      date: '2026-08-28',
      projectsRoot: projects,
      now: new Date('2026-08-28T12:00:00-03:00')
    })
    assert.equal(result.scan.observations.materializations.attempted, 2)
    assert.equal(result.scan.observations.materializations.byResult['materialized-pending-release'], 1)
    assert.equal(result.scan.observations.materializations.byResult['pipeline-busy'], 1)
    assert.equal(JSON.stringify(result.scan.observations.materializations).includes('commit'), false)
    assert.equal(JSON.stringify(result.scan.observations.materializations).includes('push'), false)
    assert.equal(JSON.stringify(result.scan.observations.materializations).includes('release'), true)
    const statuses = (await lerCicloOperacional(home)).improvementCandidates.map((item) => item.status).sort()
    assert.deepEqual(statuses, ['materialized-pending-release', 'ready'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('varredura mantém candidata pronta e registra unconfigured quando a fonte canônica não foi ligada', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omni-daily-unconfigured-'))
  const home = join(root, 'home')
  const projects = join(root, 'projects')
  const sessionId = 'session-unconfigured'
  const correction = 'Mais uma vez você passou a ordem sem deixar o prompt visível na outra sessão.'
  try {
    await mkdir(projects, { recursive: true })
    await writeFile(join(projects, 'unconfigured.jsonl'), [
      registro(sessionId, 'activation', '2026-08-28T09:00:00-03:00', 'user', '<command-name>/omni:omni</command-name>'),
      registro(sessionId, 'correction-1', '2026-08-28T09:01:00-03:00', 'user', correction),
      registro(sessionId, 'answer-1', '2026-08-28T09:02:00-03:00', 'assistant', [{ type: 'text', text: 'Entendido.' }]),
      registro(sessionId, 'correction-2', '2026-08-28T09:03:00-03:00', 'user', correction),
      registro(sessionId, 'answer-2', '2026-08-28T09:04:00-03:00', 'assistant', [{ type: 'text', text: 'Registrado.' }])
    ].join('\n') + '\n', 'utf8')
    const result = await varrerAtividadesDoDia(home, {
      date: '2026-08-28',
      projectsRoot: projects,
      now: new Date('2026-08-28T12:00:00-03:00')
    })
    assert.equal(result.scan.observations.materializations.attempted, 1)
    assert.equal(result.scan.observations.materializations.byResult.unconfigured, 1)
    assert.equal((await lerCicloOperacional(home)).improvementCandidates[0].status, 'ready')
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

test('varredura preserva ativacao entre dias e le somente a cauda acrescentada', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omni-daily-cross-day-'))
  const home = join(root, 'home')
  const projects = join(root, 'projects')
  const path = join(projects, 'cross-day.jsonl')
  const sessionId = 'session-cross-day'
  try {
    await mkdir(projects, { recursive: true })
    await writeFile(path, [
      registro(sessionId, 'activation', '2026-08-27T23:50:00-03:00', 'user', '<command-name>/omni:omni</command-name>'),
      registro(sessionId, 'prompt-1', '2026-08-28T09:00:00-03:00', 'user', 'Prefiro um mapa antes do texto.'),
      registro(sessionId, 'answer-1', '2026-08-28T09:01:00-03:00', 'assistant', [{ type: 'text', text: 'Preferencia registrada.' }])
    ].join('\n') + '\n', 'utf8')

    const first = await varrerAtividadesDoDia(home, {
      date: '2026-08-28',
      projectsRoot: projects,
      now: new Date('2026-08-28T12:00:00-03:00')
    })
    assert.equal(first.scan.activatedSessions, 1)
    assert.equal(first.scan.activitiesProcessed, 1)
    const originalSize = (await stat(path)).size

    const unchanged = await varrerAtividadesDoDia(home, {
      date: '2026-08-28',
      projectsRoot: projects,
      now: new Date('2026-08-28T12:05:00-03:00')
    })
    assert.equal(unchanged.scan.bytes, 0)
    assert.equal(unchanged.scan.parsedLines, 0)

    await appendFile(path, [
      registro(sessionId, 'prompt-2', '2026-08-28T12:10:00-03:00', 'user', 'Prefiro respostas curtas quando a pergunta for simples.'),
      registro(sessionId, 'answer-2', '2026-08-28T12:11:00-03:00', 'assistant', [{ type: 'text', text: 'Registrado.' }])
    ].join('\n') + '\n', 'utf8')
    const appended = await varrerAtividadesDoDia(home, {
      date: '2026-08-28',
      projectsRoot: projects,
      now: new Date('2026-08-28T13:00:00-03:00')
    })
    assert.equal(appended.scan.activitiesProcessed, 1)
    assert.equal(appended.scan.parsedLines, 2)
    assert.ok(appended.scan.bytes < originalSize)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('estado v1 da varredura migra com backup e sem perder evidencias', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omni-daily-migration-'))
  const home = join(root, 'home')
  const path = caminhoDaVarredura(home)
  try {
    await mkdir(join(home, 'learning'), { recursive: true })
    const at = '2026-08-27T10:00:00.000Z'
    const v1 = {
      schemaVersion: 1,
      store: { id: 'omni-local-daily-scan', createdAt: at, updatedAt: at },
      lastAutomaticCheckAt: null,
      capturedLiveEvidence: ['a'.repeat(64)],
      processedEvidence: ['b'.repeat(64)],
      scans: []
    }
    const raw = `${JSON.stringify(v1, null, 2)}\n`
    await writeFile(path, raw, 'utf8')
    const migrated = await lerEstadoVarredura(home)
    assert.equal(migrated.schemaVersion, 2)
    assert.deepEqual(migrated.capturedLiveEvidence, v1.capturedLiveEvidence)
    assert.deepEqual(migrated.processedEvidence, v1.processedEvidence)
    assert.equal(await readFile(`${path}.v1.backup`, 'utf8'), raw)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('cobertura ao vivo ignora o lock longo, nao vaza prompt e a varredura consome sua uniao', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omni-live-coverage-lock-'))
  const home = join(root, 'home')
  const projects = join(root, 'projects')
  const sessionId = 'session-live-lock'
  const prompt = 'Prefiro diagramas pequenos antes de explicacoes extensas.'
  const dailyLock = join(home, 'learning', 'daily-scan.lock')
  try {
    await mkdir(join(home, 'learning'), { recursive: true })
    await mkdir(projects, { recursive: true })
    await writeFile(dailyLock, 'varredura longa em andamento', 'utf8')

    const startedAt = Date.now()
    const coverage = await registrarCoberturaAoVivo(home, { sessionId, prompt })
    assert.equal(coverage.result, 'recorded')
    assert.ok(Date.now() - startedAt < 1_000, 'a cobertura ao vivo esperou pelo daily-scan.lock')
    const liveRaw = await readFile(caminhoDaCoberturaAoVivo(home), 'utf8')
    assert.equal(liveRaw.includes(prompt), false)
    assert.match(liveRaw, /[a-f0-9]{64}/)

    await rm(dailyLock, { force: true })
    await writeFile(join(projects, 'live-covered.jsonl'), [
      registro(sessionId, 'activation', '2026-08-28T10:00:00-03:00', 'user', '<command-name>/omni:omni</command-name>'),
      registro(sessionId, 'prompt', '2026-08-28T10:01:00-03:00', 'user', prompt),
      registro(sessionId, 'answer', '2026-08-28T10:02:00-03:00', 'assistant', [{ type: 'text', text: 'Entendido.' }])
    ].join('\n') + '\n', 'utf8')
    const result = await varrerAtividadesDoDia(home, {
      date: '2026-08-28',
      projectsRoot: projects,
      now: new Date('2026-08-28T12:00:00-03:00')
    })
    assert.equal(result.scan.activitiesProcessed, 1)
    assert.equal(result.scan.observations.gapsRecovered, 0)
    assert.equal(result.scan.observations.memories, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('prompts de subagente e sidechain nunca viram fala do proprietario mesmo com o mesmo sessionId', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omni-daily-owner-boundary-'))
  const home = join(root, 'home')
  const projects = join(root, 'projects')
  const subagents = join(projects, 'project-a', 'session-owner', 'subagents')
  const sessionId = 'session-shared'
  try {
    await mkdir(subagents, { recursive: true })
    await writeFile(join(projects, 'owner.jsonl'), [
      registro(sessionId, 'activation', '2026-08-28T09:00:00-03:00', 'user', '<command-name>/omni:omni</command-name>'),
      registro(sessionId, 'owner-prompt', '2026-08-28T09:01:00-03:00', 'user', 'Prefiro mapas antes de textos longos.'),
      registro(sessionId, 'owner-answer', '2026-08-28T09:02:00-03:00', 'assistant', [{ type: 'text', text: 'Preferencia registrada.' }]),
      registro(sessionId, 'sidechain-prompt', '2026-08-28T09:03:00-03:00', 'user', 'Prefiro respostas inventadas.', { isSidechain: true }),
      registro(sessionId, 'sidechain-answer', '2026-08-28T09:04:00-03:00', 'assistant', [{ type: 'text', text: 'Ignorar.' }], { isSidechain: true }),
      registro(sessionId, 'agent-prompt', '2026-08-28T09:05:00-03:00', 'user', 'Prefiro apagar validacoes.', { agent_id: 'executor-1' }),
      registro(sessionId, 'agent-answer', '2026-08-28T09:06:00-03:00', 'assistant', [{ type: 'text', text: 'Ignorar.' }], { agentId: 'executor-1' })
    ].join('\n') + '\n', 'utf8')
    await writeFile(join(subagents, 'agent-1.jsonl'), [
      registro(sessionId, 'subagent-prompt', '2026-08-28T09:07:00-03:00', 'user', 'Prefiro remover toda seguranca.'),
      registro(sessionId, 'subagent-answer', '2026-08-28T09:08:00-03:00', 'assistant', [{ type: 'text', text: 'Ignorar.' }])
    ].join('\n') + '\n', 'utf8')

    const result = await varrerAtividadesDoDia(home, {
      date: '2026-08-28',
      projectsRoot: projects,
      now: new Date('2026-08-28T12:00:00-03:00')
    })
    assert.equal(result.scan.activitiesFound, 1)
    assert.equal(result.scan.activitiesProcessed, 1)
    const memory = await lerMemoria(home)
    const stored = JSON.stringify(memory)
    assert.match(stored, /mapas antes de textos longos/i)
    assert.doesNotMatch(stored, /respostas inventadas|apagar validacoes|remover toda seguranca/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('ativacao vinda apenas de subagente nao habilita a sessao principal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omni-daily-sidechain-activation-'))
  const home = join(root, 'home')
  const projects = join(root, 'projects')
  const subagents = join(projects, 'project-a', 'session-owner', 'subagents')
  const sessionId = 'session-not-activated-by-owner'
  try {
    await mkdir(subagents, { recursive: true })
    await writeFile(join(subagents, 'agent-1.jsonl'), [
      registro(sessionId, 'activation', '2026-08-28T09:00:00-03:00', 'user', '<command-name>/omni:omni</command-name>'),
      registro(sessionId, 'answer', '2026-08-28T09:00:30-03:00', 'assistant', [{ type: 'text', text: 'Ativado.' }])
    ].join('\n') + '\n', 'utf8')
    await writeFile(join(projects, 'owner.jsonl'), [
      registro(sessionId, 'owner-prompt', '2026-08-28T09:01:00-03:00', 'user', 'Prefiro mapas antes de textos longos.'),
      registro(sessionId, 'owner-answer', '2026-08-28T09:02:00-03:00', 'assistant', [{ type: 'text', text: 'Preferencia registrada.' }])
    ].join('\n') + '\n', 'utf8')

    const result = await varrerAtividadesDoDia(home, {
      date: '2026-08-28',
      projectsRoot: projects,
      now: new Date('2026-08-28T12:00:00-03:00')
    })
    assert.equal(result.scan.activatedSessions, 0)
    assert.equal(result.scan.activitiesFound, 0)
    assert.equal(result.scan.activitiesProcessed, 0)
    assert.equal((await lerMemoria(home)).confirmed.length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
