import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const file = (path) => new URL(path, root)

test('marketplace usa o plugin do próprio repositório e versão semântica', async () => {
  const marketplace = JSON.parse(await readFile(file('.claude-plugin/marketplace.json'), 'utf8'))
  const manifest = JSON.parse(await readFile(file('.claude-plugin/plugin.json'), 'utf8'))
  const releaseIdentity = JSON.parse(await readFile(file('contratos/atualizacao/integridade.json'), 'utf8'))
  const packageManifest = JSON.parse(await readFile(file('package.json'), 'utf8'))
  assert.equal(marketplace.plugins[0].source, './')
  assert.equal(manifest.name, 'omni')
  assert.equal(manifest.version, '0.22.0')
  assert.equal(packageManifest.version, manifest.version)
  assert.equal(releaseIdentity.identity.version, manifest.version)
  assert.ok(Number.isFinite(Date.parse(releaseIdentity.identity.releaseAuditScopeStartedAt)))
  assert.equal(Object.hasOwn(manifest, 'releaseFingerprint'), false)
})

test('runtime, schema e manifesto concordam sobre as versões', async () => {
  const schema = JSON.parse(await readFile(file('contratos/memoria/schema.json'), 'utf8'))
  const migrations = JSON.parse(await readFile(file('contratos/memoria/migrations.json'), 'utf8'))
  const contextSchema = JSON.parse(await readFile(file('contratos/contexto/schema.json'), 'utf8'))
  const retrieval = JSON.parse(await readFile(file('contratos/contexto/recuperacao.json'), 'utf8'))
  const garbageCollection = JSON.parse(
    await readFile(file('contratos/memoria/garbage-collection.json'), 'utf8')
  )
  const shortcutPolicy = JSON.parse(
    await readFile(file('contratos/aprendizado/atalhos.json'), 'utf8')
  )
  const improvementPolicy = JSON.parse(
    await readFile(file('contratos/aprendizado/autoaperfeicoamento.json'), 'utf8')
  )
  const failurePolicy = JSON.parse(
    await readFile(file('contratos/aprendizado/falhas.json'), 'utf8')
  )
  const failureSchema = JSON.parse(
    await readFile(file('contratos/aprendizado/falhas.schema.json'), 'utf8')
  )
  const dailyScan = JSON.parse(
    await readFile(file('contratos/aprendizado/varredura-diaria.json'), 'utf8')
  )
  const systemAuditPolicy = JSON.parse(
    await readFile(file('contratos/operacao/auditoria-sistema.json'), 'utf8')
  )
  const promotionResultSchema = JSON.parse(
    await readFile(file('contratos/eval/resultado-personalidade.schema.json'), 'utf8')
  )
  assert.equal(schema.properties.schemaVersion.const, 4)
  assert.equal(migrations.currentSchemaVersion, 4)
  assert.deepEqual(
    migrations.migrations.map((migration) => [migration.from, migration.to]),
    [[1, 2], [2, 3], [3, 4]]
  )
  assert.equal(garbageCollection.policy, 'memory-gc-safe-v1')
  assert.equal(garbageCollection.semanticConsolidation.automaticMerge, false)
  assert.equal(garbageCollection.archive.automaticPermanentDeletion, false)
  assert.equal(shortcutPolicy.policy, 'shortcut-learning-v4')
  assert.equal(shortcutPolicy.activationSuccessfulRuns, 1)
  assert.equal(shortcutPolicy.validationSuccessfulRuns, 3)
  assert.equal(shortcutPolicy.activeInactivityDays, 30)
  assert.equal(shortcutPolicy.validatedInactivityDays, 90)
  assert.equal(shortcutPolicy.automaticPortablePromotion, false)
  assert.equal(shortcutPolicy.verifiedObservations.source, 'audit-self-correction')
  assert.equal(shortcutPolicy.verifiedObservations.requireSessionBinding, true)
  assert.equal(shortcutPolicy.verifiedObservations.requireExecutionBinding, true)
  assert.equal(shortcutPolicy.verifiedObservations.requirePatternBinding, true)
  assert.equal(shortcutPolicy.verifiedObservations.requireSemanticBinding, true)
  assert.equal(shortcutPolicy.verifiedObservations.requireActionFamily, true)
  assert.equal(shortcutPolicy.storeRawOutcome, false)
  assert.equal(improvementPolicy.pipeline, 'self-improvement-v1')
  assert.equal(improvementPolicy.scope, 'new-capability-admission-only')
  assert.deepEqual(improvementPolicy.destinations, [
    'discard', 'memory', 'operational-rule', 'procedure', 'routing', 'hook',
    'runtime-fix', 'personality', 'eval', 'capability'
  ])
  assert.equal(improvementPolicy.implementationRoutes['runtime-fix'], 'runtime-change')
  assert.equal(improvementPolicy.requiresOwnerApproval, true)
  assert.equal(improvementPolicy.ownerApprovalScope, 'new-capability-only')
  assert.equal(improvementPolicy.automaticOperationalCorrection, true)
  assert.equal(improvementPolicy.ordinaryCorrectionOwnerApprovalRequired, false)
  assert.equal(improvementPolicy.ordinaryCorrectionAutomaticRelease, true)
  assert.equal(improvementPolicy.gitAutomationRestrictionScope, 'new-capability-admission-only')
  assert.equal(improvementPolicy.automaticPersonalityEvaluation, true)
  assert.equal(improvementPolicy.requiresPortableConfirmation, true)
  assert.equal(improvementPolicy.requiresRoleFitConfirmation, true)
  assert.equal(improvementPolicy.skillAdmissionQuestions.length, 5)
  assert.equal(improvementPolicy.automaticPromotion, false)
  assert.equal(improvementPolicy.automaticPromotionScope, 'new-capability-disabled-until-owner-admission')
  assert.equal(improvementPolicy.automaticGitCommit, false)
  assert.equal(improvementPolicy.automaticGitPush, false)
  assert.equal(failurePolicy.policy, 'failure-learning-v3')
  assert.equal(failureSchema.properties.schemaVersion.const, 6)
  assert.equal(failurePolicy.minimumPatternOccurrences, 3)
  assert.equal(failurePolicy.minimumSuccessfulFixTests, 2)
  assert.equal(failurePolicy.maximumFixTestsPerPattern, 20)
  assert.equal(failurePolicy.requireDistinctEvidence, true)
  assert.equal(failurePolicy.verifiedFixTests.source, 'audit-self-correction')
  assert.equal(failurePolicy.verifiedFixTests.requireAfterAnalysis, true)
  assert.equal(failurePolicy.verifiedFixTests.requireDistinctActions, true)
  assert.equal(failurePolicy.verifiedFixTests.requireDistinctExecutions, true)
  assert.equal(failurePolicy.verifiedFixTests.requireConsistentStrategy, true)
  assert.equal(failurePolicy.verifiedFixTests.requireConsistentCriterion, true)
  assert.equal(failurePolicy.verifiedFixTests.requireAutomationJob, true)
  assert.equal(failurePolicy.verifiedFixTests.requirePatternBinding, true)
  assert.equal(failurePolicy.verifiedFixTests.requireHypothesisBinding, true)
  assert.equal(failurePolicy.verifiedFixTests.requireDispatchBeforeVerification, true)
  assert.equal(failurePolicy.verifiedFixTests.requireExplicitCommandBinding, true)
  assert.equal(failurePolicy.verifiedFixTests.requireActionFamilyBinding, true)
  assert.equal(failurePolicy.verifiedFixTests.storeRawOutcome, false)
  assert.equal(failurePolicy.diagnosticSignature.version, 'failure-signature-v2')
  assert.equal(failurePolicy.diagnosticSignature.storeRawCommand, false)
  assert.equal(failurePolicy.diagnosticSignature.storeRawPath, false)
  assert.equal(failurePolicy.diagnosticSignature.storeRawToolInput, false)
  assert.equal(failurePolicy.automaticGlobalRule, false)
  assert.equal(failurePolicy.automaticPromotion, false)
  assert.equal(failurePolicy.storeRawError, false)
  assert.equal(failurePolicy.storeRawTestOutcome, false)
  assert.equal(systemAuditPolicy.findings.includes('historical-unresolved-turn-findings'), false)
  assert.equal(systemAuditPolicy.turnFindingLifecycle.recoverable.severity, 'error')
  assert.equal(systemAuditPolicy.turnFindingLifecycle.recoverable.survivesSessionAndReleaseBoundary, true)
  assert.equal(systemAuditPolicy.turnFindingLifecycle.recoverable.retestAutomatically, true)
  assert.equal(systemAuditPolicy.turnFindingLifecycle.recoverable.terminalArchiveWithoutCounterproof, false)
  assert.equal(failurePolicy.automaticCandidateValidation.enabled, true)
  assert.equal(failurePolicy.automaticCandidateValidation.executorCapability, 'failure-validation')
  assert.equal(failurePolicy.automaticCandidateValidation.transport, 'adapter-owned')
  assert.equal(failurePolicy.automaticCandidateValidation.requiresOwnerPrompt, false)
  assert.equal(failurePolicy.automaticCandidateValidation.dispatchGuarantee, 'required-until-started-event')
  assert.equal(failurePolicy.automaticCandidateValidation.realStartEventRequired, true)
  assert.equal(failurePolicy.automaticCandidateValidation.startEvidence, 'neutral-delegation-started')
  assert.equal(failurePolicy.automaticCandidateValidation.stopGateRequiresStart, true)
  assert.equal(failurePolicy.automaticCandidateValidation.retryableFailureDisposition, 'requeue-different-strategy')
  assert.equal(failurePolicy.automaticCandidateValidation.terminalBlockedState, false)
  assert.equal(failurePolicy.automaticCandidateValidation.ownerDecisionOnlyForConcreteAuthorityExpansion, true)
  assert.ok(failurePolicy.automaticCandidateValidation.ownerAuthorityEffects.includes('remote-write'))
  assert.ok(failurePolicy.automaticCandidateValidation.ownerAuthorizationRequiredFor.includes('ação destrutiva'))
  assert.equal(dailyScan.contract, 'omni-daily-activity-scan-v1')
  assert.equal(dailyScan.privacy.storeRawConversation, false)
  assert.equal(dailyScan.privacy.storeRawToolResults, false)
  assert.equal(dailyScan.requestedWorkflow.publishOnlyPortableArtifacts, true)
  assert.equal(dailyScan.requestedWorkflow.requireGreenGatesBeforeCommit, true)
  assert.equal(dailyScan.requestedWorkflow.requireOriginMainConfirmation, true)
  assert.ok(dailyScan.report.requiredSections.includes('eligible-for-publication'))
  assert.ok(dailyScan.report.requiredSections.includes('actually-published'))
  assert.equal(promotionResultSchema.properties.schemaVersion.const, 1)
  assert.equal(promotionResultSchema.additionalProperties, false)
  assert.equal(contextSchema.properties.schemaVersion.const, 4)
  assert.deepEqual(contextSchema.properties.routing.properties.selected.enum, ['fast', 'deep'])
  assert.equal(retrieval.algorithm, 'hybrid-local-v1')
  assert.equal(
    Object.values(retrieval.weights).reduce((sum, value) => sum + value, 0),
    1
  )
})

test('plugin contém somente o núcleo declarado', async () => {
  await assert.rejects(stat(file('app')), { code: 'ENOENT' })
  await assert.rejects(stat(file('cerebro')), { code: 'ENOENT' })
  await assert.rejects(stat(file('plugin')), { code: 'ENOENT' })
  await assert.rejects(stat(file('.claude')), { code: 'ENOENT' })
  await assert.rejects(stat(file('memory')), { code: 'ENOENT' })
  await stat(file('runtime/cli.mjs'))
  await stat(file('runtime/hook-contexto.mjs'))
  await stat(file('runtime/pipeline-memoria.mjs'))
  await stat(file('runtime/recuperacao.mjs'))
  await stat(file('runtime/eval-personalidade.mjs'))
  await stat(file('runtime/rodada-personalidade.mjs'))
  await stat(file('runtime/release-gate.mjs'))
  await stat(file('runtime/eval-comportamental.mjs'))
  await stat(file('runtime/personalidade.mjs'))
  await stat(file('runtime/atalhos.mjs'))
  await stat(file('runtime/autoaperfeicoamento.mjs'))
  await stat(file('runtime/falhas.mjs'))
  await stat(file('runtime/automacao-falhas.mjs'))
  await stat(file('runtime/automacao-melhorias.mjs'))
  await stat(file('runtime/porta-delegacao.mjs'))
  await stat(file('runtime/adaptador-claude-delegacao.mjs'))
  await stat(file('contratos/operacao/automacao-melhorias.json'))
  await stat(file('runtime/versao.mjs'))
  await stat(file('runtime/atualizacao.mjs'))
  await stat(file('contratos/atualizacao/releases.json'))
  await stat(file('runtime/historico-evals.mjs'))
  await stat(file('runtime/persistencia-contexto.mjs'))
  await stat(file('runtime/ciclo-operacional.mjs'))
  await stat(file('runtime/observador.mjs'))
  await stat(file('runtime/evolucao.mjs'))
  await stat(file('runtime/varredura-diaria.mjs'))
  await stat(file('runtime/auditoria-autocorrecao.mjs'))
  await stat(file('runtime/auditoria-sistema.mjs'))
  await stat(file('runtime/integridade-release.mjs'))
  await stat(file('runtime/passe.mjs'))
  await stat(file('runtime/guardiao.mjs'))
  await stat(file('runtime/hook-varredura.mjs'))
  await stat(file('contratos/operacao/ciclo.json'))
  await stat(file('contratos/operacao/regras-aprendidas.json'))
  await stat(file('contratos/operacao/procedimentos-aprendidos.json'))
  await stat(file('contratos/memoria/garbage-collection.json'))
  await stat(file('contratos/memoria/garbage-collection.md'))
  await stat(file('contratos/aprendizado/atalhos.json'))
  await stat(file('contratos/aprendizado/atalhos.schema.json'))
  await stat(file('contratos/aprendizado/atalhos.md'))
  await stat(file('contratos/aprendizado/autoaperfeicoamento.json'))
  await stat(file('contratos/aprendizado/autoaperfeicoamento.schema.json'))
  await stat(file('contratos/aprendizado/autoaperfeicoamento.md'))
  await stat(file('contratos/aprendizado/falhas.json'))
  await stat(file('contratos/aprendizado/falhas.schema.json'))
  await stat(file('contratos/aprendizado/falhas.md'))
  await stat(file('contratos/aprendizado/varredura-diaria.json'))
  await stat(file('contratos/eval/resultado-personalidade.schema.json'))
  await stat(file('contratos/eval/resultados/README.md'))
  await stat(file('contratos/eval/omni-core.json'))
  await stat(file('contratos/eval/historico.schema.json'))
  await stat(file('contratos/contexto/orcamento.json'))
  await stat(file('contratos/contexto/persistencia.json'))
  await stat(file('contratos/arquitetura/escopo.json'))
  await stat(file('contratos/arquitetura/invariantes.json'))
  await stat(file('hooks/hooks.json'))
  await stat(file('contratos/personalidade/omni-persona-v1.md'))
  await stat(file('contratos/personalidade/omni-persona-v2.md'))
  await stat(file('contratos/personalidade/omni-persona-v3.md'))
})

test('fronteiras mantêm interface e iniciativas externas independentes do Omni', async () => {
  const scope = JSON.parse(await readFile(file('contratos/arquitetura/escopo.json'), 'utf8'))
  const invariants = JSON.parse(await readFile(file('contratos/arquitetura/invariantes.json'), 'utf8'))
  assert.deepEqual(scope.activeAgents, ['omni'])
  assert.deepEqual(scope.embeddedInitiatives, [])
  assert.equal(scope.sections['31'], 'out-of-scope-agent-selection')
  assert.equal(scope.sections['35'], 'deferred-interface')
  assert.equal(invariants.identity.agentCount, 1)
  assert.equal(invariants.availability.implemented, false)
  assert.equal(invariants.completion.conversationValidationRequiredBeforeInterface, true)
  assert.equal(invariants.scope.backlogExecution, 'prioritize-against-current-definition-of-done')
  assert.equal(
    invariants.boundaries.agentOrchestration,
    'neutral-delegation-port-with-adapter-owned-transport-and-evidence'
  )
})

test('hook injeta contexto por turno somente após ativação do Omni', async () => {
  const hooks = JSON.parse(await readFile(file('hooks/hooks.json'), 'utf8'))
  assert.ok(hooks.hooks.SessionStart)
  assert.ok(hooks.hooks.UserPromptSubmit)
  assert.ok(hooks.hooks.UserPromptExpansion)
  assert.ok(hooks.hooks.PreToolUse)
  assert.ok(hooks.hooks.PostToolUse)
  assert.ok(hooks.hooks.PostToolUseFailure)
  assert.ok(hooks.hooks.SubagentStart)
  assert.ok(hooks.hooks.SubagentStop)
  assert.ok(hooks.hooks.Stop)
  assert.ok(hooks.hooks.TaskCompleted)
  assert.ok(hooks.hooks.SessionEnd)
  const command = hooks.hooks.UserPromptSubmit[0].hooks[0]
  assert.equal(command.type, 'command')
  assert.equal(command.command, 'node')
  assert.deepEqual(command.args, ['${CLAUDE_PLUGIN_ROOT}/runtime/hook-contexto.mjs'])
  assert.equal(hooks.hooks.PreToolUse[0].matcher, 'Skill')
  assert.deepEqual(
    hooks.hooks.PreToolUse[0].hooks[0].args,
    ['${CLAUDE_PLUGIN_ROOT}/runtime/hook-contexto.mjs']
  )
  const dailyStart = hooks.hooks.SessionStart[0].hooks[0]
  assert.deepEqual(dailyStart.args, ['${CLAUDE_PLUGIN_ROOT}/runtime/hook-varredura.mjs'])
  assert.equal(dailyStart.async, true)
  assert.ok(hooks.hooks.Stop[0].hooks.some((hook) => hook.args?.[0]?.endsWith('hook-varredura.mjs')))
  const dailyRuntime = await readFile(file('runtime/hook-varredura.mjs'), 'utf8')
  assert.match(dailyRuntime, /processarReleasePendenteMelhoria/)
  assert.ok(hooks.hooks.Stop[0].hooks.some((hook) =>
    hook.args?.[0]?.endsWith('hook-varredura.mjs') && hook.async === true && hook.timeout >= 900
  ))
})

test('personalidade v3 é a fonte ativa e canais externos continuam planejados', async () => {
  const persona = JSON.parse(await readFile(file('contratos/personalidade/manifest.json'), 'utf8'))
  const contract = await readFile(
    new URL(persona.contract, file('contratos/personalidade/manifest.json')),
    'utf8'
  )
  assert.equal(persona.id, 'omni-persona-v3-candidate')
  assert.equal(persona.status, 'active-candidate-pending-evals')
  assert.equal(persona.promotion, null)
  assert.deepEqual(await readdir(file('contratos/eval/resultados/')), ['README.md'])
  assert.equal(persona.supersedes, 'omni-persona-v1-candidate')
  assert.equal(persona.channels.plugin, 'active')
  assert.equal(persona.channels.chat, 'planned')
  assert.equal(persona.channels.realtime, 'planned')
  const nucleo = contract.match(/## Núcleo textual\s+```text\s*([\s\S]*?)```/i)[1]
  assert.match(nucleo, /Inventor Cúmplice/)
  assert.match(nucleo, /Motor Rick/)
  assert.match(nucleo, /INDEPENDÊNCIA/)
  assert.match(nucleo, /GALERIA/)
  assert.match(nucleo, /EIXO DE RESPEITO/)
})

test('o contrato declarado no manifesto é o que o hook consegue injetar', async () => {
  const manifestUrl = file('contratos/personalidade/manifest.json')
  const persona = JSON.parse(await readFile(manifestUrl, 'utf8'))
  const contract = await readFile(new URL(persona.contract, manifestUrl), 'utf8')
  const nucleo = contract.match(/## Núcleo textual\s+```text\s*([\s\S]*?)```/i)
  assert.ok(nucleo, 'núcleo textual do contrato ativo não casa com o extrator do hook')
  assert.match(nucleo[1], new RegExp(`PERSONALIDADE ${persona.id}`))

  const hook = await readFile(file('runtime/hook-contexto.mjs'), 'utf8')
  assert.doesNotMatch(hook, /omni-persona-v\d+\.md/, 'hook não pode fixar o contrato por caminho')
})

test('evidência aprendida de personalidade mora em eval e não em regra injetada', async () => {
  const rules = JSON.parse(await readFile(file('contratos/operacao/regras-aprendidas.json'), 'utf8'))
  const learned = JSON.parse(await readFile(file('contratos/eval/casos-aprendidos.json'), 'utf8'))
  assert.equal(rules.rules.some((item) => item.destination === 'personality'), false)
  const migrated = learned.cases.find((item) => item.id === 'improvement-0ac4a466-8d86-493e-954a-7cc8903ae9c3')
  assert.ok(migrated)
  assert.equal(migrated.readiness, 'covered-by-canonical-case')
  assert.equal(migrated.scenario.caseId, 'identidade-nao-apaga-sob-carga')
  assert.equal(migrated.evidence.occurrences, 2)
  assert.deepEqual(migrated.evidence.mergedCandidateIds, ['improvement-3d56ecba-172c-4927-8a6c-5b89c4707e77'])
})

test('a v2 permanece histórica e fora do alvo da suíte ativa', async () => {
  const persona = JSON.parse(await readFile(file('contratos/personalidade/manifest.json'), 'utf8'))
  const suite = JSON.parse(await readFile(file('contratos/eval/personalidade.json'), 'utf8'))
  const candidate = await readFile(file('contratos/personalidade/omni-persona-v2.md'), 'utf8')
  assert.equal(persona.supersedes, 'omni-persona-v1-candidate')
  assert.equal(suite.candidate, persona.id)
  assert.notEqual(suite.candidate, 'omni-persona-v2-candidate')
  assert.match(candidate, /histórica inativa/i)
  assert.match(candidate, /PERSONALIDADE omni-persona-v2-candidate/)
})

test('contexto ativo não carrega nomes ou caminhos estranhos ao Omni', async () => {
  const invariants = JSON.parse(await readFile(file('contratos/arquitetura/invariantes.json'), 'utf8'))
  const activeFiles = [
    'skills/omni/SKILL.md',
    'runtime/cli.mjs',
    'runtime/contexto.mjs',
    'runtime/hook-contexto.mjs',
    'runtime/pipeline-memoria.mjs',
    'runtime/recuperacao.mjs',
    'runtime/autoaperfeicoamento.mjs',
    'runtime/falhas.mjs',
    'runtime/versao.mjs',
    'runtime/memoria.mjs',
    'contratos/capacidades/catalogo.json',
    'contratos/personalidade/omni-persona-v3.md'
  ]
  const active = (
    [
      ...(await Promise.all(activeFiles.map((path) => readFile(file(path), 'utf8')))),
      JSON.stringify(invariants.operationalRole.promptRules)
    ]
  ).join('\n').toLowerCase()
  const forbidden = [
    ['over', 'core'].join(''),
    ['ora', 'cle'].join(''),
    ['over', 'core', ' studio'].join(''),
    ['omni', '-pessoal'].join('')
  ]
  for (const name of forbidden) assert.equal(active.includes(name), false, `referência ativa indevida: ${name}`)
})

test('skill começa em pt-BR e descreve ação, delegação e proteção técnica', async () => {
  const skill = await readFile(file('skills/omni/SKILL.md'), 'utf8')
  assert.match(skill, /Responda em português do Brasil/)
  assert.match(skill, /hook entrega a personalidade canônica já na ativação/is)
  assert.match(skill, /consulta não é pedágio para começar a conversar/is)
  assert.match(skill, /personalidade canônica indicada pelo manifesto/i)
  assert.match(skill, /v3 e o runtime da release corrente substituem qualquer instrução v1\/v2/i)
  assert.match(skill, /se um assistente genérico poderia dizer exatamente aquilo, reescreva/i)
  assert.doesNotMatch(skill, /personalidade-base v1/i)
  assert.match(skill, /torne o prompt completo visível na sessão de destino/)
  assert.match(skill, /inicie o executor/)
  assert.match(skill, /mantenha esta conversa central disponível/i)
  assert.match(skill, /O destino de uma melhoria segue sua natureza/)
  assert.match(skill, /runtime filtra segredos/)
  assert.match(skill, /Quando o pedido for exatamente `atualizar`/)
  assert.match(skill, /interface nativa do VS Code/)
  assert.match(skill, /execute automaticamente o ciclo completo/i)
  assert.match(skill, /Diferencie explicitamente “valeu subir” de “subiu”/i)
  assert.match(skill, /Nunca afirme publicação sem confirmar o commit remoto/i)
  assert.match(skill, /varredura automática de manutenção continua silenciosa/i)
})
