import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const file = (path) => new URL(path, root)

test('marketplace usa o plugin do próprio repositório e versão semântica', async () => {
  const marketplace = JSON.parse(await readFile(file('.claude-plugin/marketplace.json'), 'utf8'))
  const manifest = JSON.parse(await readFile(file('.claude-plugin/plugin.json'), 'utf8'))
  const packageManifest = JSON.parse(await readFile(file('package.json'), 'utf8'))
  assert.equal(marketplace.plugins[0].source, './')
  assert.equal(manifest.name, 'omni')
  assert.equal(manifest.version, '0.17.0')
  assert.equal(packageManifest.version, manifest.version)
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
  const dailyScan = JSON.parse(
    await readFile(file('contratos/aprendizado/varredura-diaria.json'), 'utf8')
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
  assert.equal(shortcutPolicy.policy, 'shortcut-learning-v1')
  assert.equal(shortcutPolicy.minimumConsecutiveSuccesses, 3)
  assert.equal(shortcutPolicy.validationRunsRequired, 1)
  assert.equal(shortcutPolicy.automaticPromotion, false)
  assert.equal(shortcutPolicy.storeRawOutcome, false)
  assert.equal(improvementPolicy.pipeline, 'self-improvement-v1')
  assert.deepEqual(improvementPolicy.destinations, ['discard', 'memory', 'capability'])
  assert.equal(improvementPolicy.requiresOwnerApproval, true)
  assert.equal(improvementPolicy.requiresPortableConfirmation, true)
  assert.equal(improvementPolicy.requiresRoleFitConfirmation, true)
  assert.equal(improvementPolicy.skillAdmissionQuestions.length, 5)
  assert.equal(improvementPolicy.automaticPromotion, false)
  assert.equal(improvementPolicy.automaticGitCommit, false)
  assert.equal(improvementPolicy.automaticGitPush, false)
  assert.equal(failurePolicy.policy, 'failure-learning-v1')
  assert.equal(failurePolicy.minimumPatternOccurrences, 3)
  assert.equal(failurePolicy.minimumSuccessfulFixTests, 2)
  assert.equal(failurePolicy.maximumFixTestsPerPattern, 20)
  assert.equal(failurePolicy.requireDistinctEvidence, true)
  assert.equal(failurePolicy.automaticGlobalRule, false)
  assert.equal(failurePolicy.automaticPromotion, false)
  assert.equal(failurePolicy.storeRawError, false)
  assert.equal(failurePolicy.storeRawTestOutcome, false)
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
  await stat(file('runtime/personalidade.mjs'))
  await stat(file('runtime/atalhos.mjs'))
  await stat(file('runtime/autoaperfeicoamento.mjs'))
  await stat(file('runtime/falhas.mjs'))
  await stat(file('runtime/versao.mjs'))
  await stat(file('runtime/atualizacao.mjs'))
  await stat(file('contratos/atualizacao/releases.json'))
  await stat(file('runtime/historico-evals.mjs'))
  await stat(file('runtime/persistencia-contexto.mjs'))
  await stat(file('runtime/ciclo-operacional.mjs'))
  await stat(file('runtime/observador.mjs'))
  await stat(file('runtime/evolucao.mjs'))
  await stat(file('runtime/varredura-diaria.mjs'))
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
  assert.equal(invariants.boundaries.agentOrchestration, 'active-with-visible-prompt-and-evidence')
})

test('hook injeta contexto por turno somente após ativação do Omni', async () => {
  const hooks = JSON.parse(await readFile(file('hooks/hooks.json'), 'utf8'))
  assert.ok(hooks.hooks.SessionStart)
  assert.ok(hooks.hooks.UserPromptSubmit)
  assert.ok(hooks.hooks.UserPromptExpansion)
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
  const dailyStart = hooks.hooks.SessionStart[0].hooks[0]
  assert.deepEqual(dailyStart.args, ['${CLAUDE_PLUGIN_ROOT}/runtime/hook-varredura.mjs'])
  assert.equal(dailyStart.async, true)
  assert.ok(hooks.hooks.Stop[0].hooks.some((hook) => hook.args?.[0]?.endsWith('hook-varredura.mjs')))
})

test('personalidade-base v1 é a fonte ativa e canais externos continuam planejados', async () => {
  const persona = JSON.parse(await readFile(file('contratos/personalidade/manifest.json'), 'utf8'))
  const contract = await readFile(
    new URL(persona.contract, file('contratos/personalidade/manifest.json')),
    'utf8'
  )
  assert.equal(persona.id, 'omni-persona-v1-candidate')
  assert.equal(persona.status, 'active-candidate-pending-evals')
  assert.equal(persona.promotion, null)
  assert.deepEqual(await readdir(file('contratos/eval/resultados/')), ['README.md'])
  assert.equal(persona.supersedes, null)
  assert.equal(persona.channels.plugin, 'active')
  assert.equal(persona.channels.chat, 'planned')
  assert.equal(persona.channels.realtime, 'planned')
  const nucleo = contract.match(/## Núcleo textual\s+```text\s*([\s\S]*?)```/i)[1]
  assert.match(nucleo, /Inventor Cúmplice/)
  assert.match(nucleo, /INDEPENDÊNCIA INTELECTUAL/)
  assert.match(nucleo, /REFERÊNCIAS E ANALOGIAS/)
  assert.match(nucleo, /EXPRESSÃO/)
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

test('a candidata v2 permanece disponível para eval comparativo futuro', async () => {
  const persona = JSON.parse(await readFile(file('contratos/personalidade/manifest.json'), 'utf8'))
  const candidate = await readFile(file('contratos/personalidade/omni-persona-v2.md'), 'utf8')
  assert.equal(persona.supersedes, null)
  assert.match(candidate, /PERSONALIDADE omni-persona-v2-candidate/)
})

test('contexto ativo não carrega nomes ou caminhos estranhos ao Omni', async () => {
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
    'contratos/personalidade/omni-persona-v1.md',
    'contratos/personalidade/omni-persona-v2.md'
  ]
  const active = (
    await Promise.all(activeFiles.map((path) => readFile(file(path), 'utf8')))
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
  assert.match(skill, /consulte\s+silenciosamente `personalidade` e `estado`/is)
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
