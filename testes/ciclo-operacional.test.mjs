import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  atualizarDelegacao,
  caminhoDoCiclo,
  fingerprintSemanticoMelhoria,
  lerCicloOperacional,
  marcarMelhoriaOperacional,
  observarDelegacao,
  prepararDelegacao,
  prepararDelegacaoVisivelIdempotente,
  proporMelhoriaOperacional
} from '../runtime/ciclo-operacional.mjs'
import {
  abrirTurnoAuditoria,
  registrarAcaoAuditoria,
  registrarDelegacaoAuditoria
} from '../runtime/auditoria-autocorrecao.mjs'
import {
  configurarRepositorioCanonico,
  lerRepositorioCanonico,
  materializarMelhoriaConfigurada
} from '../runtime/evolucao.mjs'

test('preparo visível idempotente não duplica delegação nem alega execução', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-cycle-visible-idempotent-'))
  const input = {
    target: 'background-subagent',
    prompt: 'Valide a falha local e entregue somente evidências verificáveis.',
    sessionId: 'session-visible-idempotent',
    idempotencyKey: 'failure-dispatch:failure-job-example',
    visibilityEvidence: 'hook-context-visible:failure-job-example',
    authority: {
      source: 'owner-intent',
      turnFingerprint: 'a'.repeat(64)
    }
  }
  try {
    const first = await prepararDelegacaoVisivelIdempotente(casa, input)
    const second = await prepararDelegacaoVisivelIdempotente(casa, {
      ...input,
      authority: {
        source: 'owner-intent',
        turnFingerprint: 'b'.repeat(64)
      }
    })
    const cycle = await lerCicloOperacional(casa)
    assert.equal(first.result, 'visible')
    assert.equal(second.result, 'duplicate')
    assert.equal(second.delegation.id, first.delegation.id)
    assert.equal(cycle.delegations.length, 1)
    assert.equal(cycle.delegations[0].state, 'visible')
    assert.equal(cycle.delegations[0].agentFingerprint, null)
    assert.deepEqual(
      cycle.delegations[0].transitionHistory.map((item) => item.to),
      ['prepared', 'visible']
    )
    assert.doesNotMatch(JSON.stringify(cycle), /Valide a falha local/)
    await assert.rejects(
      prepararDelegacaoVisivelIdempotente(casa, {
        ...input,
        prompt: 'Execute outro trabalho com a mesma chave.'
      }),
      /chave de idempotencia conflita/i
    )
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

async function home() {
  return mkdtemp(join(tmpdir(), 'omni-cycle-'))
}

async function registrarRelatoAuditado(casa, sessionId, agentId, target) {
  await abrirTurnoAuditoria(casa, {
    session_id: sessionId,
    prompt: 'Execute e verifique a tarefa delegada.'
  })
  return registrarDelegacaoAuditoria(casa, {
    session_id: sessionId,
    agent_id: agentId,
    agent_type: 'executor',
    agent_transcript_path: target,
    cwd: casa
  }, 'reported')
}

async function registrarReadbackAuditado(casa, sessionId, target, suffix = '1', cwd = casa) {
  return registrarAcaoAuditoria(casa, {
    hook_event_name: 'PostToolUse',
    session_id: sessionId,
    tool_use_id: `readback-delegacao-${suffix}`,
    tool_name: 'Read',
    tool_input: { file_path: target },
    cwd
  })
}

test('delegação percorre FSM verificável e herda liberdade responsável sem guardar intenção bruta', async () => {
  const casa = await home()
  try {
    const prepared = await prepararDelegacao(casa, {
      target: 'sessao do projeto X',
      prompt: 'Implemente a correção, rode os testes e mostre a evidência.',
      sessionId: 'main-1',
      authority: {
        intent: 'corrigir e publicar o componente X',
        scope: 'repositorio X e homologacao X',
        effects: ['editar', 'testar', 'publicar'],
        risk: {
          reversibility: 'compensable',
          reach: 'single-scoped-target',
          data: 'project',
          mode: 'prepare-and-proceed'
        }
      }
    })
    const id = prepared.delegation.id
    assert.equal(prepared.delegation.authorityEnvelope.inherited, true)
    assert.equal(prepared.delegation.authorityEnvelope.risk.reversibility, 'compensable')
    assert.match(prepared.delegation.authorityFingerprint, /^[a-f0-9]{64}$/)

    await atualizarDelegacao(casa, id, 'visible', { evidence: 'ui-prompt-visible-1' })
    await atualizarDelegacao(casa, id, 'running', {
      evidence: 'agent-start-1',
      checkpoint: 'snapshot-before-change-1',
      rollback: 'restore-snapshot-1'
    })
    const auditReport = await registrarRelatoAuditado(casa, 'main-1', 'agent-main-1', 'artefato-X')
    const reported = await atualizarDelegacao(casa, id, 'reported', {
      summary: 'Correção aplicada e testes verdes.',
      evidence: 'run-123',
      auditActionId: auditReport.action.id,
      auditEvidenceId: auditReport.evidence.id
    })
    assert.equal(reported.delegation.visiblePromptConfirmed, true)
    assert.equal(reported.delegation.state, 'reported')
    assert.equal(reported.delegation.verificationEvidenceFingerprint, null)
    assert.match(reported.delegation.reportEvidenceFingerprint, /^[a-f0-9]{64}$/)
    assert.match(reported.delegation.checkpointFingerprint, /^[a-f0-9]{64}$/)
    assert.match(reported.delegation.rollbackFingerprint, /^[a-f0-9]{64}$/)
    await assert.rejects(atualizarDelegacao(casa, id, 'closed'), /reported -> closed/)
    const auditVerification = await registrarReadbackAuditado(casa, 'main-1', 'artefato-X')
    await atualizarDelegacao(casa, id, 'verified', {
      summary: 'Resultado comparado com o pedido e aprovado.',
      auditActionId: auditVerification.action.id,
      auditEvidenceId: auditVerification.evidence.id
    })
    await atualizarDelegacao(casa, id, 'closed')
    const store = await lerCicloOperacional(casa)
    assert.equal(store.delegations[0].state, 'closed')
    assert.equal(store.delegations[0].finalOutcome, 'verified')
    assert.deepEqual(
      store.delegations[0].transitionHistory.map((item) => item.to),
      ['prepared', 'visible', 'running', 'reported', 'verified', 'closed']
    )
    assert.equal(JSON.stringify(store).includes('Implemente a correção, rode os testes'), false)
    assert.equal(JSON.stringify(store).includes('corrigir e publicar o componente X'), false)
    assert.equal(JSON.stringify(store).includes('repositorio X e homologacao X'), false)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('FSM recusa atalhos de estado e exige evidência real', async () => {
  const casa = await home()
  try {
    const { delegation } = await prepararDelegacao(casa, {
      target: 'executor',
      prompt: 'Faça a tarefa e devolva prova.',
      sessionId: 'main-fsm'
    })
    assert.equal(delegation.authorityEnvelope.source, 'delegation-briefing')
    assert.equal(delegation.authorityEnvelope.inherited, false)
    await assert.rejects(
      atualizarDelegacao(casa, delegation.id, 'running', { evidence: 'agent-1' }),
      /prepared -> running/
    )
    await assert.rejects(
      atualizarDelegacao(casa, delegation.id, 'visible'),
      /evidencia explicita/
    )
    await atualizarDelegacao(casa, delegation.id, 'visible', { evidence: 'visible-1' })
    await assert.rejects(
      atualizarDelegacao(casa, delegation.id, 'reported', {
        summary: 'Relato prematuro.',
        evidence: 'report-1'
      }),
      /visible -> reported/
    )
    await atualizarDelegacao(casa, delegation.id, 'running', { evidence: 'agent-1' })
    await assert.rejects(
      atualizarDelegacao(casa, delegation.id, 'reported', { summary: 'Sem prova.' }),
      /evidencia explicita/
    )
    const store = await lerCicloOperacional(casa)
    assert.equal(store.delegations[0].state, 'running')
    assert.equal(store.delegations[0].reportEvidenceFingerprint, null)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('bloqueio volta ao ciclo e pode retomar com nova evidência', async () => {
  const casa = await home()
  try {
    const { delegation } = await prepararDelegacao(casa, {
      target: 'executor',
      prompt: 'Valide a integração.',
      sessionId: 'main-blocked'
    })
    await atualizarDelegacao(casa, delegation.id, 'visible', { evidence: 'visible-blocked' })
    await atualizarDelegacao(casa, delegation.id, 'running', { evidence: 'agent-blocked' })
    const blocked = await atualizarDelegacao(casa, delegation.id, 'blocked', {
      reason: 'O executor precisa de contexto adicional do Omni.',
      evidence: 'blocked-event-1'
    })
    assert.equal(blocked.delegation.state, 'blocked')
    assert.match(blocked.delegation.reasonFingerprint, /^[a-f0-9]{64}$/)
    const resumed = await atualizarDelegacao(casa, delegation.id, 'running', {
      evidence: 'agent-resumed-1'
    })
    assert.equal(resumed.delegation.state, 'running')
    assert.equal(resumed.delegation.reasonFingerprint, null)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('SubagentStop produz relato, nunca sucesso; execução sem ciclo verificável falha', async () => {
  const casa = await home()
  try {
    const untrackedStart = await observarDelegacao(casa, {
      state: 'running',
      sessionId: 'main-untracked',
      agentId: 'agent-untracked',
      agentType: 'executor'
    })
    assert.equal(untrackedStart.delegation.state, 'failed')
    assert.equal(untrackedStart.delegation.visiblePromptConfirmed, false)
    const untrackedStop = await observarDelegacao(casa, {
      state: 'completed',
      sessionId: 'main-untracked',
      agentId: 'agent-untracked',
      agentType: 'executor',
      evidence: 'transcript-untracked',
      summary: 'O executor apresentou um relato.'
    })
    assert.equal(untrackedStop.delegation.state, 'failed')
    assert.equal(untrackedStop.delegation.verificationEvidenceFingerprint, null)

    const { delegation } = await prepararDelegacao(casa, {
      target: 'executor',
      prompt: 'Execute o trabalho rastreado.',
      sessionId: 'main-tracked'
    })
    await atualizarDelegacao(casa, delegation.id, 'visible', { evidence: 'visible-tracked' })
    const started = await observarDelegacao(casa, {
      state: 'running',
      sessionId: 'main-tracked',
      agentId: 'agent-tracked',
      agentType: 'executor'
    })
    assert.equal(started.delegation.state, 'running')
    const stopped = await observarDelegacao(casa, {
      state: 'completed',
      sessionId: 'main-tracked',
      agentId: 'agent-tracked',
      agentType: 'executor',
      evidence: 'transcript-tracked',
      summary: 'O executor relatou testes verdes.'
    })
    assert.equal(stopped.delegation.state, 'reported')
    assert.equal(stopped.delegation.finalOutcome, null)
    assert.equal(stopped.delegation.verificationEvidenceFingerprint, null)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('contrato de autoridade usa risco como preparo e restringe nova decisão a expansão material', async () => {
  const authority = JSON.parse(
    await readFile(new URL('../contratos/operacao/autoridade.json', import.meta.url), 'utf8')
  )
  const cycle = JSON.parse(
    await readFile(new URL('../contratos/operacao/ciclo.json', import.meta.url), 'utf8')
  )
  assert.equal(authority.contract, 'omni-responsible-freedom-v1')
  assert.equal(authority.authority.delegationCarriesAuthority, true)
  assert.equal(authority.authority.publicDelegationRequiresActiveAuditedTurn, true)
  assert.equal(authority.authority.parentFingerprintMustResolveExistingAuthority, true)
  assert.equal(authority.ownerDecisionWhen.length, 3)
  assert.match(authority.risk.principle, /checkpoint.*rollback.*compensacao.*verificacao/i)
  assert.equal(cycle.delegation.subagentStopProduces, 'reported')
  assert.deepEqual(cycle.delegation.successStates, ['verified'])
  assert.equal(cycle.delegation.closedSuccessRequiresOutcome, 'verified')
  assert.equal(cycle.delegation.reportedIsNotSuccess, true)
  assert.equal(cycle.delegation.verifiedRequiresAuditActionAndEvidence, true)
  assert.equal(cycle.delegation.verificationMustFollowReport, true)
  assert.equal(cycle.delegation.verificationMustMatchAuditedObject, true)
})

test('autoridade e evidências inválidas são recusadas em vez de truncadas ou presumidas', async () => {
  const casa = await home()
  try {
    await assert.rejects(
      prepararDelegacao(casa, {
        target: 'executor',
        prompt: 'Execute com autoridade inválida.',
        authority: { source: 'fonte-inventada' }
      }),
      /Fonte da autoridade fora do contrato/
    )
    await assert.rejects(
      prepararDelegacao(casa, {
        target: 'executor',
        prompt: 'Execute com risco inválido.',
        authority: { risk: { reversibility: 'magica' } }
      }),
      /Reversibilidade fora do contrato/
    )
    await assert.rejects(
      prepararDelegacao(casa, {
        target: 'executor',
        prompt: 'Execute com autoridade permanente sem origem.',
        authority: { source: 'standing-authority' }
      }),
      /exige fingerprint da autoridade anterior/
    )

    const { delegation } = await prepararDelegacao(casa, {
      target: 'executor',
      prompt: 'Execute com evidência verificável.',
      sessionId: 'main-evidence'
    })
    await assert.rejects(
      atualizarDelegacao(casa, delegation.id, 'visible', { evidence: 'x'.repeat(2001) }),
      /excede 2000 caracteres/
    )
    await atualizarDelegacao(casa, delegation.id, 'visible', { evidence: 'visible-evidence' })
    await atualizarDelegacao(casa, delegation.id, 'running', { evidence: 'running-evidence' })
    await atualizarDelegacao(casa, delegation.id, 'reported', {
      summary: 'Relato recebido.',
      evidence: 'same-evidence'
    })
    await assert.rejects(
      atualizarDelegacao(casa, delegation.id, 'verified', {
        summary: 'Tentativa de verificar com o próprio relato.',
        evidence: 'same-evidence'
      }),
      /Acao de verificacao da auditoria|nao aceita evidencia textual/
    )
    const store = await lerCicloOperacional(casa)
    assert.equal(store.delegations[0].state, 'reported')
    assert.equal(store.delegations[0].verificationEvidenceFingerprint, null)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('autoridade herdada resolve um pai real e recusa fingerprint inventado', async () => {
  const casa = await home()
  try {
    await assert.rejects(
      prepararDelegacao(casa, {
        target: 'executor-filho',
        prompt: 'Continue dentro da autoridade anterior.',
        sessionId: 'main-parent',
        authority: {
          source: 'inherited-authority',
          inherited: true,
          parentFingerprint: 'a'.repeat(64)
        }
      }),
      /nao resolve uma autoridade herdavel existente/
    )
    const parent = await prepararDelegacao(casa, {
      target: 'executor-pai',
      prompt: 'Execute o objetivo autorizado pelo proprietario.',
      sessionId: 'main-parent',
      authority: { source: 'owner-intent', inherited: true }
    })
    const child = await prepararDelegacao(casa, {
      target: 'executor-filho',
      prompt: 'Continue dentro da autoridade anterior.',
      sessionId: 'main-parent',
      authority: {
        source: 'inherited-authority',
        inherited: true,
        parentFingerprint: parent.delegation.authorityFingerprint
      }
    })
    assert.equal(
      child.delegation.authorityEnvelope.parentFingerprint,
      parent.delegation.authorityFingerprint
    )
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('verified exige readback auditado posterior ao relato e do mesmo objeto', async () => {
  const casa = await home()
  const sessionId = 'main-audit-proof'
  try {
    await abrirTurnoAuditoria(casa, {
      session_id: sessionId,
      prompt: 'Delegue e verifique o artefato A.'
    })
    const beforeReport = await registrarReadbackAuditado(casa, sessionId, 'artefato-A', 'before')
    const prepared = await prepararDelegacao(casa, {
      target: 'executor',
      prompt: 'Altere o artefato A.',
      sessionId
    })
    const id = prepared.delegation.id
    await atualizarDelegacao(casa, id, 'visible', { evidence: 'visible-audit-proof' })
    await atualizarDelegacao(casa, id, 'running', { evidence: 'running-audit-proof' })
    const report = await registrarDelegacaoAuditoria(casa, {
      session_id: sessionId,
      agent_id: 'agent-audit-proof',
      agent_type: 'executor',
      agent_transcript_path: 'artefato-A',
      cwd: casa
    }, 'reported')
    await atualizarDelegacao(casa, id, 'reported', {
      summary: 'Relato do artefato A recebido.',
      evidence: 'report-audit-proof',
      auditActionId: report.action.id,
      auditEvidenceId: report.evidence.id
    })
    await assert.rejects(
      atualizarDelegacao(casa, id, 'verified', {
        summary: 'Readback anterior nao vale.',
        auditActionId: beforeReport.action.id,
        auditEvidenceId: beforeReport.evidence.id
      }),
      /posterior ao relato/
    )
    const wrongTarget = await registrarReadbackAuditado(
      casa,
      sessionId,
      'artefato-B',
      'wrong',
      join(casa, 'outro-escopo')
    )
    await assert.rejects(
      atualizarDelegacao(casa, id, 'verified', {
        summary: 'Readback de outro artefato nao vale.',
        auditActionId: wrongTarget.action.id,
        auditEvidenceId: wrongTarget.evidence.id
      }),
      /mesmo objeto auditado/
    )
    const valid = await registrarReadbackAuditado(casa, sessionId, 'artefato-A', 'valid')
    const verified = await atualizarDelegacao(casa, id, 'verified', {
      summary: 'Artefato A lido depois do relato.',
      auditActionId: valid.action.id,
      auditEvidenceId: valid.evidence.id
    })
    assert.equal(verified.delegation.state, 'verified')
    assert.equal(verified.delegation.verificationAuditActionId, valid.action.id)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('delegação legada fechada permanece histórica sem ganhar verificação retroativa', async () => {
  const casa = await home()
  try {
    const timestamp = '2026-08-27T12:00:00.000Z'
    const path = caminhoDoCiclo(casa)
    await mkdir(join(casa, 'runs'), { recursive: true })
    await writeFile(path, `${JSON.stringify({
      schemaVersion: 1,
      store: { id: 'omni-local-operational-cycle', createdAt: timestamp, updatedAt: timestamp },
      sessions: [],
      delegations: [{
        id: 'delegation-legacy-closed',
        sessionFingerprint: 'a'.repeat(64),
        target: 'executor legado',
        promptSummary: 'Prompt legado',
        promptFingerprint: 'b'.repeat(64),
        state: 'closed',
        visiblePromptConfirmed: true,
        evidenceFingerprint: 'c'.repeat(64),
        resultSummary: 'Resultado legado',
        createdAt: timestamp,
        updatedAt: timestamp
      }],
      events: [],
      improvementCandidates: []
    }, null, 2)}\n`, 'utf8')

    const store = await lerCicloOperacional(casa)
    const legacy = store.delegations[0]
    assert.equal(legacy.state, 'closed')
    assert.equal(legacy.finalOutcome, 'legacy-unverified')
    assert.equal(legacy.legacyUnverified, true)
    assert.equal(legacy.verificationEvidenceFingerprint, null)
    assert.equal(legacy.visiblePromptConfirmed, false)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('melhoria repetida escolhe artefato coerente em vez de criar skill para tudo', async () => {
  const casa = await home()
  const repo = await mkdtemp(join(tmpdir(), 'omni-source-'))
  try {
    await mkdir(join(repo, '.git'))
    await mkdir(join(repo, 'contratos', 'operacao'), { recursive: true })
    await mkdir(join(repo, 'contratos', 'eval'), { recursive: true })
    await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'omni-agent' }))
    await writeFile(join(repo, 'contratos', 'operacao', 'regras-aprendidas.json'), JSON.stringify({ schemaVersion: 1, contract: 'omni-learned-rules-v1', rules: [] }))
    await writeFile(join(repo, 'contratos', 'operacao', 'procedimentos-aprendidos.json'), JSON.stringify({ schemaVersion: 1, contract: 'omni-learned-procedures-v1', procedures: [] }))
    await writeFile(join(repo, 'contratos', 'eval', 'casos-aprendidos.json'), JSON.stringify({ schemaVersion: 1, contract: 'omni-learned-eval-cases-v1', cases: [] }))

    const input = {
      category: 'owner-correction',
      destination: 'operational-rule',
      statement: 'Exibir o prompt completo na sessão de destino.'
    }
    await proporMelhoriaOperacional(casa, input)
    const ready = await proporMelhoriaOperacional(casa, input)
    assert.equal(ready.candidate.status, 'ready')
    await configurarRepositorioCanonico(casa, repo)
    assert.equal((await lerRepositorioCanonico(casa)).sourceRepository, repo)
    const result = await materializarMelhoriaConfigurada(casa, ready.candidate.id)
    assert.equal(result.result, 'materialized-pending-release')
    const rules = JSON.parse(await readFile(join(repo, 'contratos', 'operacao', 'regras-aprendidas.json'), 'utf8'))
    assert.equal(rules.rules.length, 1)
    assert.equal(rules.rules[0].destination, 'operational-rule')
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})

test('melhoria legada materialized migra sem alegar release instalada', async () => {
  const casa = await home()
  const timestamp = '2026-08-27T12:00:00.000Z'
  try {
    await mkdir(join(casa, 'runs'), { recursive: true })
    await writeFile(caminhoDoCiclo(casa), `${JSON.stringify({
      schemaVersion: 1,
      store: { id: 'omni-local-operational-cycle', createdAt: timestamp, updatedAt: timestamp },
      sessions: [],
      delegations: [],
      events: [],
      improvementCandidates: [{
        id: 'improvement-legacy-materialized',
        fingerprint: 'a'.repeat(64),
        category: 'owner-correction',
        destination: 'operational-rule',
        statement: 'Verificar a instalacao antes de declarar efeito.',
        status: 'materialized',
        occurrences: 3,
        artifact: 'C:\\fonte\\contratos\\operacao\\regras-aprendidas.json',
        materializedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp
      }]
    }, null, 2)}\n`, 'utf8')
    const migrated = (await lerCicloOperacional(casa)).improvementCandidates[0]
    assert.equal(migrated.status, 'materialized-pending-release')
    assert.equal(migrated.artifact, 'contratos/operacao/regras-aprendidas.json')
    assert.equal(migrated.artifactRef.kind, 'portable-entry')
    assert.equal(migrated.installedReadback, null)
    assert.equal(migrated.transitionHistory.at(-1).kind, 'legacy-migration')
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('leitura recusa supersessao v2 corrompida sem rebaixar ou apagar evidencia', async () => {
  const casa = await home()
  try {
    const input = {
      category: 'owner-correction',
      destination: 'operational-rule',
      statement: 'Preservar a prova terminal sem migracao destrutiva.'
    }
    await proporMelhoriaOperacional(casa, input)
    const ready = await proporMelhoriaOperacional(casa, input)
    const artifactRef = {
      kind: 'portable-entry',
      path: 'contratos/operacao/regras-aprendidas.json',
      collection: 'rules',
      entryId: ready.candidate.id,
      semanticFingerprint: fingerprintSemanticoMelhoria(ready.candidate),
      contentFingerprint: null
    }
    await marcarMelhoriaOperacional(casa, ready.candidate.id, {
      status: 'materialized-pending-release',
      artifactRef
    })
    await marcarMelhoriaOperacional(casa, ready.candidate.id, {
      status: 'superseded',
      supersededBy: {
        proof: 'explicit-merged-candidate',
        replacementCandidateId: 'improvement-replacement-corruption-test',
        canonicalEntryId: ready.candidate.id,
        path: artifactRef.path,
        collection: artifactRef.collection,
        semanticFingerprint: 'c'.repeat(64),
        artifactFingerprint: 'd'.repeat(64),
        version: '1.2.3',
        payloadFingerprint: 'e'.repeat(64),
        verifiedAt: '2026-08-28T20:00:00.000Z'
      }
    })

    const path = caminhoDoCiclo(casa)
    const store = JSON.parse(await readFile(path, 'utf8'))
    store.improvementCandidates[0].supersededBy.payloadFingerprint = 'corrompido'
    const corrupted = `${JSON.stringify(store, null, 2)}\n`
    await writeFile(path, corrupted, 'utf8')

    await assert.rejects(lerCicloOperacional(casa), /fora do contrato v1/)
    assert.equal(await readFile(path, 'utf8'), corrupted)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('janela longa de transicoes preserva os marcos canonicos da delegacao', async () => {
  const casa = await home()
  try {
    const prepared = await prepararDelegacao(casa, {
      target: 'executor-longo',
      prompt: 'Execute ciclos de correcao e verificacao sem perder a cadeia.',
      sessionId: 'main-long-cycle',
      authority: { source: 'owner-intent', effects: ['corrigir'], inherited: true }
    })
    const id = prepared.delegation.id
    await atualizarDelegacao(casa, id, 'visible', { evidence: 'visible-long' })
    await atualizarDelegacao(casa, id, 'running', { evidence: 'run-long-0' })
    for (let index = 0; index < 26; index += 1) {
      await atualizarDelegacao(casa, id, 'reported', {
        summary: `Relato intermediario ${index}.`,
        evidence: `report-long-${index}`
      })
      await atualizarDelegacao(casa, id, 'running', { evidence: `run-long-${index + 1}` })
    }
    const auditReport = await registrarRelatoAuditado(casa, 'main-long-cycle', 'agent-long', 'artefato-longo')
    await atualizarDelegacao(casa, id, 'reported', {
      summary: 'Relato final do ciclo longo.',
      evidence: 'report-long-final',
      auditActionId: auditReport.action.id,
      auditEvidenceId: auditReport.evidence.id
    })
    const auditVerification = await registrarReadbackAuditado(
      casa,
      'main-long-cycle',
      'artefato-longo',
      'long-final'
    )
    await atualizarDelegacao(casa, id, 'verified', {
      summary: 'Resultado final verificado de forma independente.',
      auditActionId: auditVerification.action.id,
      auditEvidenceId: auditVerification.evidence.id
    })
    await atualizarDelegacao(casa, id, 'closed')

    const store = await lerCicloOperacional(casa)
    const item = store.delegations.find((candidate) => candidate.id === id)
    assert.equal(item.state, 'closed')
    assert.equal(item.transitionHistory.length, 50)
    assert.equal(item.visiblePromptConfirmed, true)
    assert.match(item.visibilityEvidenceFingerprint, /^[a-f0-9]{64}$/)
    assert.match(item.executionEvidenceFingerprint, /^[a-f0-9]{64}$/)
    assert.match(item.reportEvidenceFingerprint, /^[a-f0-9]{64}$/)
    assert.match(item.verificationEvidenceFingerprint, /^[a-f0-9]{64}$/)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})
