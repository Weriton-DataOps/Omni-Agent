import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { access, mkdir, open, readFile, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve, sep } from 'node:path'

import { lerAtalhos } from './atalhos.mjs'
import { lerFalhas } from './falhas.mjs'
import { pareceConterSegredo } from './memoria.mjs'
import { verificarIntegridadeRelease } from './integridade-release.mjs'

export const SELF_IMPROVEMENT_SCHEMA_VERSION = 1
export const SELF_IMPROVEMENT_PIPELINE_VERSION = 1

const POLICY_PATH = new URL('../contratos/aprendizado/autoaperfeicoamento.json', import.meta.url)
const STATUS = new Set(['draft', 'evaluated', 'approved', 'rejected', 'materialized-pending-version', 'retracted'])
const RETRACTED_AUDIT_STATUS = 'retracted-replaced-by-runtime-fix'

function agora(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString()
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function resolverSkillInstalada(pluginRoot, portablePath) {
  if (
    typeof portablePath !== 'string' ||
    !/^skills\/[a-z0-9][a-z0-9-]{1,80}\/SKILL\.md$/.test(portablePath) ||
    isAbsolute(portablePath) ||
    portablePath.split('/').includes('..')
  ) {
    throw new Error('O readback exige caminho portatil de skill dentro do payload instalado.')
  }
  const canonicalRoot = await realpath(resolve(pluginRoot))
  const target = await realpath(join(canonicalRoot, ...portablePath.split('/')))
  if (target !== canonicalRoot && !target.startsWith(`${canonicalRoot}${sep}`)) {
    throw new Error('O readback recusou artefato fora da raiz instalada.')
  }
  return target
}

function caminhoAuditoriaValido(portablePath) {
  return typeof portablePath === 'string' &&
    /^contratos\/aprendizado\/promocoes\/[a-z0-9][a-z0-9-]{1,80}\.json$/.test(portablePath) &&
    !isAbsolute(portablePath) &&
    !portablePath.split('/').includes('..')
}

async function resolverAuditoriaInstalada(pluginRoot, portablePath) {
  if (!caminhoAuditoriaValido(portablePath)) {
    throw new Error('O readback exige auditPath portatil e canonico dentro do payload instalado.')
  }
  const canonicalRoot = await realpath(resolve(pluginRoot))
  const target = await realpath(join(canonicalRoot, ...portablePath.split('/')))
  if (target !== canonicalRoot && !target.startsWith(`${canonicalRoot}${sep}`)) {
    throw new Error('O readback recusou auditoria fora da raiz instalada.')
  }
  return target
}

function caminhoSubstitutoValido(value, prefix) {
  return typeof value === 'string' &&
    value.startsWith(`${prefix}/`) &&
    !isAbsolute(value) &&
    !value.includes('\\') &&
    !value.split('/').some((part) => !part || part === '.' || part === '..')
}

async function resolverSubstitutoInstalado(pluginRoot, portablePath, prefix) {
  if (!caminhoSubstitutoValido(portablePath, prefix)) {
    throw new Error('A retracao instalada referencia substituto fora do payload canonico.')
  }
  const canonicalRoot = await realpath(resolve(pluginRoot))
  const target = await realpath(join(canonicalRoot, ...portablePath.split('/')))
  if (target !== canonicalRoot && !target.startsWith(`${canonicalRoot}${sep}`)) {
    throw new Error('A retracao instalada referencia substituto fora da raiz instalada.')
  }
  return target
}

async function confirmarRetiradaInstalada(pluginRoot, proposal, audit) {
  const originalSkill = proposal.promotion?.artifacts?.skill
  try {
    await resolverSkillInstalada(pluginRoot, originalSkill)
    throw new Error('A retracao instalada ainda contem a skill declarada como retirada.')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const canonicalRoot = await realpath(resolve(pluginRoot))
  const catalogPath = await realpath(
    join(canonicalRoot, 'contratos', 'capacidades', 'catalogo.json')
  )
  if (catalogPath !== canonicalRoot && !catalogPath.startsWith(`${canonicalRoot}${sep}`)) {
    throw new Error('A retracao instalada referencia catalogo fora da raiz instalada.')
  }
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
  if (!Array.isArray(catalog.capabilities)) {
    throw new Error('O catalogo instalado de capacidades e invalido.')
  }
  const catalogEntry = audit.artifacts?.retractedCatalogEntry
  if (catalog.capabilities.some((item) => item?.name === catalogEntry || item?.id === catalogEntry)) {
    throw new Error('A retracao instalada ainda contem a capacidade declarada como retirada.')
  }
}

function retracaoValida(proposal) {
  if (proposal?.status !== 'retracted') return true
  const retraction = proposal.promotion?.retraction
  return Boolean(
    proposal.promotion?.status === 'retracted' &&
      retraction?.status === RETRACTED_AUDIT_STATUS &&
      typeof retraction.reason === 'string' &&
      retraction.reason.trim().length >= 10 &&
      Number.isFinite(Date.parse(retraction.retractedAt)) &&
      caminhoSubstitutoValido(retraction.replacedBy?.runtime, 'runtime') &&
      Array.isArray(retraction.replacedBy?.tests) &&
      retraction.replacedBy.tests.length > 0 &&
      retraction.replacedBy.tests.every((item) => caminhoSubstitutoValido(item, 'testes')) &&
      caminhoAuditoriaValido(retraction.evidence?.auditPath) &&
      retraction.evidence.auditPath === proposal.promotion.auditPath &&
      /^[a-f0-9]{64}$/.test(retraction.evidence?.auditSha256 ?? '') &&
      retraction.evidence?.preserved === true &&
      retraction.evidence?.source?.kind === proposal.source?.kind &&
      retraction.evidence?.source?.id === proposal.source?.id &&
      retraction.evidence?.evaluation?.protocol === proposal.evaluation?.protocol &&
      retraction.evidence?.evaluation?.passed === true &&
      retraction.evidence?.retractedArtifact?.skill === proposal.promotion?.artifacts?.skill &&
      retraction.evidence?.retractedArtifact?.skillSha256 === proposal.promotion?.artifacts?.skillSha256 &&
      retraction.evidence?.retractedArtifact?.catalogEntry === proposal.draft?.capability?.name &&
      /^[a-f0-9]{64}$/.test(retraction.evidence?.retractedArtifact?.skillSha256 ?? '') &&
      typeof retraction.observedInstalledRelease?.version === 'string' &&
      /^[a-f0-9]{64}$/.test(retraction.observedInstalledRelease?.payloadFingerprint ?? '') &&
      Number.isFinite(Date.parse(retraction.observedInstalledRelease?.verifiedAt))
  )
}

function slug(value) {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 44)
    .replace(/-+$/g, '')
  if (normalized.length < 3) throw new Error('O objetivo não produz um nome portátil válido.')
  return `learned-${normalized}`
}

function storeVazio(now = agora()) {
  return {
    schemaVersion: SELF_IMPROVEMENT_SCHEMA_VERSION,
    store: { id: 'omni-local-self-improvement', createdAt: now, updatedAt: now },
    proposals: []
  }
}

export function caminhoDoAutoaperfeicoamento(casa) {
  if (!isAbsolute(casa)) throw new Error('A casa do autoaperfeiçoamento precisa ser absoluta.')
  return join(casa, 'learning', 'self-improvement.json')
}

function propostaValida(item, policy) {
  return Boolean(
    item &&
      typeof item.id === 'string' &&
      item.id.startsWith('improvement-') &&
      policy.categories.includes(item.category) &&
      policy.destinations.includes(item.destination) &&
      STATUS.has(item.status) &&
      item.source &&
      item.draft &&
      (item.evaluation === null || typeof item.evaluation === 'object') &&
      (item.approval === null || typeof item.approval === 'object') &&
      (item.promotion === null || typeof item.promotion === 'object') &&
      retracaoValida(item) &&
      Number.isFinite(Date.parse(item.createdAt)) &&
      Number.isFinite(Date.parse(item.updatedAt))
  )
}

async function lerPolitica() {
  const policy = JSON.parse(await readFile(POLICY_PATH, 'utf8'))
  if (
    policy?.schemaVersion !== SELF_IMPROVEMENT_PIPELINE_VERSION ||
    policy.pipeline !== 'self-improvement-v1' ||
    !Array.isArray(policy.categories) ||
    !Array.isArray(policy.destinations) ||
    policy.scope !== 'new-capability-admission-only' ||
    !policy.destinations.includes('discard') ||
    !policy.destinations.includes('memory') ||
    !policy.destinations.includes('capability') ||
    !Number.isInteger(policy.minimumSuccessfulRuns) ||
    policy.minimumSuccessfulRuns < 4 ||
    policy.requiresIndependentValidation !== true ||
    policy.requiresOwnerApproval !== true ||
    policy.ownerApprovalScope !== 'new-capability-only' ||
    policy.requiresPortableConfirmation !== true ||
    policy.requiresRoleFitConfirmation !== true ||
    policy.automaticOperationalCorrection !== true ||
    policy.ordinaryCorrectionHandledBy !== 'omni-operational-improvement-automation-v1' ||
    policy.ordinaryCorrectionOwnerApprovalRequired !== false ||
    policy.ordinaryCorrectionAutomaticRelease !== true ||
    policy.personalityHandledBy !== 'omni-controlled-personality-eval-v1' ||
    policy.automaticPersonalityEvaluation !== true ||
    !Array.isArray(policy.skillAdmissionQuestions) ||
    policy.skillAdmissionQuestions.length !== 5 ||
    !policy.skillAdmissionQuestions.every((question) => typeof question === 'string' && question.length > 20) ||
    policy.automaticPromotion !== false ||
    policy.automaticPromotionScope !== 'new-capability-disabled-until-owner-admission' ||
    policy.automaticGitCommit !== false ||
    policy.automaticGitPush !== false ||
    policy.gitAutomationRestrictionScope !== 'new-capability-admission-only' ||
    policy.storeRawOutcome !== false
  ) {
    throw new Error('Política de autoaperfeiçoamento fora do contrato seguro v1.')
  }
  return policy
}

function validarStore(store, path, policy) {
  if (
    store?.schemaVersion !== SELF_IMPROVEMENT_SCHEMA_VERSION ||
    store.store?.id !== 'omni-local-self-improvement' ||
    !Number.isFinite(Date.parse(store.store?.createdAt)) ||
    !Number.isFinite(Date.parse(store.store?.updatedAt)) ||
    !Array.isArray(store.proposals) ||
    !store.proposals.every((item) => propostaValida(item, policy))
  ) {
    throw new Error(`Autoaperfeiçoamento fora do contrato v1: ${path}`)
  }
}

async function adquirirTrava(casa) {
  const directory = join(casa, 'learning')
  await mkdir(directory, { recursive: true })
  const lockPath = join(directory, 'self-improvement.lock')
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx')
      return async () => {
        await handle.close()
        await unlink(lockPath).catch(() => undefined)
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const age = Date.now() - (await stat(lockPath).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs
      if (age > 10_000) await unlink(lockPath).catch(() => undefined)
      await new Promise((resolveWait) => setTimeout(resolveWait, 50))
    }
  }
  throw new Error('O pipeline de autoaperfeiçoamento está ocupado por outra escrita.')
}

async function carregar(casa, policy) {
  const path = caminhoDoAutoaperfeicoamento(casa)
  try {
    const store = JSON.parse(await readFile(path, 'utf8'))
    if (store.schemaVersion > SELF_IMPROVEMENT_SCHEMA_VERSION) {
      throw new Error(`Autoaperfeiçoamento v${store.schemaVersion} é mais novo que este plugin.`)
    }
    validarStore(store, path, policy)
    return { store, initialized: false }
  } catch (error) {
    if (error?.code === 'ENOENT') return { store: storeVazio(), initialized: true }
    throw error
  }
}

async function gravar(casa, store, policy) {
  const path = caminhoDoAutoaperfeicoamento(casa)
  const temporary = `${path}.${process.pid}.novo`
  store.store.updatedAt = agora()
  validarStore(store, path, policy)
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

export function classificarAprendizado({ useful, reusable, nature = null }) {
  if (useful !== true) return 'discard'
  if (reusable !== true) return 'memory'
  if (['operational-rule', 'procedure', 'routing', 'hook', 'runtime-fix', 'personality', 'eval', 'capability'].includes(nature)) {
    return nature
  }
  return 'capability'
}

export function classificarDestinoFalha(pattern) {
  const text = [
    pattern?.action,
    pattern?.failureClass,
    pattern?.analysis?.rootCause,
    pattern?.analysis?.hypothesis
  ].filter(Boolean).join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/personalidade|humor|sarcasmo|analogia|voz generica/.test(text)) return 'personality'
  if (/\beval\b|avaliador|caso de teste comportamental/.test(text)) return 'eval'
  if (/\bhook\b|userprompt|posttool|subagentstop|sessionend/.test(text)) return 'hook'
  if (/roteamento|router|escolha de modelo|selecao de agente/.test(text)) return 'routing'
  if (/runtime|codigo|cli|detector|regex|sensor|observador|schema|fila|cursor|versao/.test(text)) return 'runtime-fix'
  if (/procedimento|sequencia|passo a passo|comando recorrente/.test(text)) return 'procedure'
  return 'operational-rule'
}

export async function lerAutoaperfeicoamento(casa) {
  const policy = await lerPolitica()
  const release = await adquirirTrava(casa)
  try {
    const loaded = await carregar(casa, policy)
    if (loaded.initialized) await gravar(casa, loaded.store, policy)
    return loaded.store
  } finally {
    await release()
  }
}

function criarRascunho(shortcut) {
  const name = slug(shortcut.goal)
  const description = `Aplicar o procedimento validado para ${shortcut.goal}.`
  const instructions = [
    `Use esta skill somente quando o objetivo for: ${shortcut.goal}.`,
    'Execute a sequência validada, sem acrescentar etapas por hábito:',
    ...shortcut.shortcutSteps.map((step, index) => `${index + 1}. ${step}`),
    'Verifique o resultado antes de declarar sucesso. Se a verificação falhar, diagnostique a causa, mude materialmente a estratégia e reteste; devolva ao proprietário somente uma expansão real de autoridade, alvo, efeito irreversível ou acesso ausente.',
    'Não exponha memória, evidência local ou implementação interna do Omni.'
  ]
  const allText = [name, description, ...instructions].join('\n')
  if (pareceConterSegredo(allText)) throw new Error('O rascunho parece conter segredo e não pode ser promovido.')
  return {
    capability: {
      name,
      description,
      when_to_use: [shortcut.goal],
      when_not_to_use: ['fora do objetivo declarado', 'sem possibilidade de verificar o resultado'],
      inputs: ['contexto da tarefa'],
      outputs: ['resultado verificado'],
      risk: 'medium',
      permissions: [],
      latency: 'procedure-dependent',
      cost: 'tool-dependent',
      required_tools: [],
      recommended_agent: 'omni'
    },
    skill: { name, description, instructions }
  }
}

function criarRascunhoFalha(pattern, destination) {
  const name = slug(`recuperar ${pattern.action}`)
  const description = `Aplicar a recuperação validada para falha de ${pattern.action}.`
  const instructions = [
    `Use esta skill somente quando a ação for: ${pattern.action}.`,
    `Classe de falha reconhecida: ${pattern.failureClass}.`,
    `Causa raiz validada: ${pattern.analysis.rootCause}.`,
    `Correção validada: ${pattern.analysis.hypothesis}.`,
    'Execute a correção e repita a verificação que comprovou o resultado.',
    'Se a falha reaparecer, pare: não trate este procedimento como regra válida.',
    'Não exponha evidência local, memória ou implementação interna do Omni.'
  ]
  const allText = [name, description, ...instructions].join('\n')
  if (pareceConterSegredo(allText)) throw new Error('O rascunho parece conter segredo e não pode ser promovido.')
  const portable = {
    capability: {
      name,
      description,
      when_to_use: [`falha ${pattern.failureClass} durante ${pattern.action}`],
      when_not_to_use: ['falha diferente do padrão validado', 'sem possibilidade de repetir a verificação'],
      inputs: ['contexto da falha', 'estado da ação'],
      outputs: ['recuperação verificada'],
      risk: 'medium',
      permissions: [],
      latency: 'procedure-dependent',
      cost: 'tool-dependent',
      required_tools: [],
      recommended_agent: 'omni'
    },
    skill: { name, description, instructions }
  }
  if (destination === 'capability') return portable
  return {
    implementation: {
      kind: destination,
      targetHint: destination === 'hook' ? 'runtime/hook-contexto.mjs' :
        destination === 'personality' ? 'contratos/personalidade' :
          destination === 'eval' ? 'contratos/eval' : 'runtime',
      rootCause: pattern.analysis.rootCause,
      proposedChange: pattern.analysis.hypothesis,
      requiredGates: ['patch', 'regression-test', 'full-suite', 'release-fingerprint', 'installed-readback', 'real-observation']
    }
  }
}

export async function proporMelhoriaDeAtalho(casa, shortcutId, { now } = {}) {
  const shortcuts = await lerAtalhos(casa)
  const shortcut = shortcuts.shortcuts.find((item) => item.id === shortcutId)
  if (!shortcut) return { result: 'source-not-found', proposal: null }
  if (shortcut.status !== 'validated' || shortcut.validation?.status !== 'passed') {
    return { result: 'source-not-validated', proposal: null }
  }
  const policy = await lerPolitica()
  const recordedAt = agora(now)
  const release = await adquirirTrava(casa)
  try {
    const loaded = await carregar(casa, policy)
    const existing = loaded.store.proposals.find(
      (item) => item.source.kind === 'shortcut' && item.source.id === shortcut.id && item.source.updatedAt === shortcut.updatedAt
    )
    if (existing) return { result: 'existing', proposal: existing }
    const proposal = {
      id: `improvement-${randomUUID()}`,
      category: 'shortcut',
      destination: classificarAprendizado({ useful: true, reusable: true }),
      status: 'draft',
      source: {
        kind: 'shortcut',
        id: shortcut.id,
        updatedAt: shortcut.updatedAt,
        goal: shortcut.goal,
        scope: shortcut.scope,
        baselineSteps: shortcut.baselineSteps,
        shortcutSteps: shortcut.shortcutSteps,
        successCount: shortcut.successCount,
        validationStatus: shortcut.validation.status,
        outcomeFingerprint: shortcut.outcomeFingerprint
      },
      draft: criarRascunho(shortcut),
      evaluation: null,
      approval: null,
      promotion: null,
      createdAt: recordedAt,
      updatedAt: recordedAt
    }
    loaded.store.proposals.push(proposal)
    await gravar(casa, loaded.store, policy)
    return { result: 'draft', proposal }
  } finally {
    await release()
  }
}

export async function proporMelhoriaDeFalha(casa, patternId, { now } = {}) {
  const failures = await lerFalhas(casa)
  const pattern = failures.patterns.find((item) => item.id === patternId)
  if (!pattern) return { result: 'source-not-found', proposal: null }
  if (pattern.status !== 'evaluated' || pattern.evaluation?.passed !== true) {
    return { result: 'source-not-validated', proposal: null }
  }
  const policy = await lerPolitica()
  const recordedAt = agora(now)
  const release = await adquirirTrava(casa)
  try {
    const loaded = await carregar(casa, policy)
    const existing = loaded.store.proposals.find(
      (item) => item.source.kind === 'failure-pattern' && item.source.id === pattern.id && item.source.updatedAt === pattern.updatedAt
    )
    if (existing) return { result: 'existing', proposal: existing }
    const successfulFixTests = pattern.fixTests.filter((item) => item.success && item.consistent).length
    const destination = classificarDestinoFalha(pattern)
    const proposal = {
      id: `improvement-${randomUUID()}`,
      category: 'failure-pattern',
      destination,
      status: 'draft',
      source: {
        kind: 'failure-pattern',
        id: pattern.id,
        updatedAt: pattern.updatedAt,
        agent: pattern.agent,
        action: pattern.action,
        failureClass: pattern.failureClass,
        occurrences: pattern.occurrences,
        rootCause: pattern.analysis.rootCause,
        hypothesis: pattern.analysis.hypothesis,
        successfulFixTests,
        evaluationStatus: pattern.evaluation.passed ? 'passed' : 'failed'
      },
      draft: criarRascunhoFalha(pattern, destination),
      evaluation: null,
      approval: null,
      promotion: null,
      createdAt: recordedAt,
      updatedAt: recordedAt
    }
    loaded.store.proposals.push(proposal)
    await gravar(casa, loaded.store, policy)
    return { result: 'draft', proposal }
  } finally {
    await release()
  }
}

function avaliar(source, proposal, policy, evaluatedAt) {
  const gates = proposal.source.kind === 'shortcut'
    ? [
        { id: 'source-still-validated', passed: source?.status === 'validated' && source?.validation?.status === 'passed' },
        { id: 'independent-validation', passed: Boolean(source?.validation?.observationId) },
        { id: 'minimum-successful-runs', passed: source?.successCount >= policy.minimumSuccessfulRuns },
        { id: 'shortcut-removes-steps', passed: source?.shortcutSteps?.length < source?.baselineSteps?.length },
        { id: 'source-snapshot-current', passed: source?.updatedAt === proposal.source.updatedAt }
      ]
    : [
        { id: 'failure-pattern-evaluated', passed: source?.status === 'evaluated' && source?.evaluation?.passed === true },
        { id: 'repeated-failure-evidence', passed: source?.occurrences >= 3 },
        { id: 'root-cause-and-fix-recorded', passed: Boolean(source?.analysis?.rootCause && source?.analysis?.hypothesis) },
        { id: 'repeated-fix-tests', passed: source?.fixTests?.filter((item) => item.success && item.consistent).length >= 2 },
        { id: 'source-snapshot-current', passed: source?.updatedAt === proposal.source.updatedAt }
      ]
  gates.push(
    {
      id: 'implementation-route-complete',
      passed: proposal.destination === 'capability'
        ? Boolean(proposal.draft?.capability?.name && proposal.draft?.skill?.instructions?.length >= 4)
        : Boolean(proposal.draft?.implementation?.kind === proposal.destination && proposal.draft?.implementation?.requiredGates?.length >= 4)
    },
    { id: 'no-automatic-promotion', passed: policy.automaticPromotion === false }
  )
  return {
    protocol: 'self-improvement-eval-v1',
    passed: gates.every((gate) => gate.passed),
    gates,
    evaluatedAt
  }
}

export async function avaliarMelhoria(casa, id, { now } = {}) {
  const policy = await lerPolitica()
  const [shortcuts, failures] = await Promise.all([lerAtalhos(casa), lerFalhas(casa)])
  const evaluatedAt = agora(now)
  const release = await adquirirTrava(casa)
  try {
    const loaded = await carregar(casa, policy)
    const proposal = loaded.store.proposals.find((item) => item.id === id)
    if (!proposal) return { result: 'not-found', proposal: null }
    if (['rejected', 'materialized-pending-version', 'retracted'].includes(proposal.status)) {
      return { result: 'closed', proposal }
    }
    const source = proposal.source.kind === 'shortcut'
      ? shortcuts.shortcuts.find((item) => item.id === proposal.source.id)
      : failures.patterns.find((item) => item.id === proposal.source.id)
    proposal.evaluation = avaliar(source, proposal, policy, evaluatedAt)
    proposal.status = proposal.evaluation.passed ? 'evaluated' : 'draft'
    proposal.approval = null
    proposal.updatedAt = evaluatedAt
    await gravar(casa, loaded.store, policy)
    return { result: proposal.evaluation.passed ? 'passed' : 'failed', proposal }
  } finally {
    await release()
  }
}

export async function decidirMelhoria(casa, id, decision, { portable = false, roleFit = false, now } = {}) {
  const policy = await lerPolitica()
  const decidedAt = agora(now)
  const release = await adquirirTrava(casa)
  try {
    const loaded = await carregar(casa, policy)
    const proposal = loaded.store.proposals.find((item) => item.id === id)
    if (!proposal) return { result: 'not-found', proposal: null }
    if (['materialized-pending-version', 'retracted'].includes(proposal.status)) return { result: 'closed', proposal }
    if (decision === 'reject') {
      proposal.status = 'rejected'
      proposal.approval = { decision: 'rejected', portable: false, roleFit: false, decidedAt }
    } else {
      if (proposal.status !== 'evaluated' || proposal.evaluation?.passed !== true) {
        return { result: 'not-ready', proposal }
      }
      if (portable !== true) return { result: 'portable-confirmation-required', proposal }
      if (roleFit !== true) return {
        result: 'role-fit-confirmation-required',
        questions: policy.skillAdmissionQuestions,
        proposal
      }
      proposal.status = 'approved'
      proposal.approval = { decision: 'approved', portable: true, roleFit: true, decidedAt }
    }
    proposal.updatedAt = decidedAt
    await gravar(casa, loaded.store, policy)
    return { result: proposal.status, proposal }
  } finally {
    await release()
  }
}

function conteudoDaSkill(proposal) {
  const skill = proposal.draft.skill
  return `---\ndescription: ${JSON.stringify(skill.description)}\nargument-hint: "[contexto da execução]"\n---\n\n# ${skill.name}\n\n${skill.instructions.join('\n\n')}\n`
}

async function materializarNoRepositorio(repoRoot, proposal) {
  if (!isAbsolute(repoRoot)) throw new Error('O repositório de destino precisa ser um caminho absoluto.')
  const manifestPath = join(repoRoot, '.claude-plugin', 'plugin.json')
  const catalogPath = join(repoRoot, 'contratos', 'capacidades', 'catalogo.json')
  const canonicalRoot = await realpath(repoRoot)
  const protectedPaths = [
    manifestPath,
    catalogPath,
    join(repoRoot, 'skills'),
    join(repoRoot, 'contratos', 'aprendizado')
  ]
  for (const protectedPath of protectedPaths) {
    const resolved = await realpath(protectedPath)
    if (resolved !== canonicalRoot && !resolved.startsWith(`${canonicalRoot}${sep}`)) {
      throw new Error('O destino contém caminho que escapa da árvore-fonte canônica.')
    }
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
  if (manifest?.name !== 'omni' || catalog?.schemaVersion !== 1 || !Array.isArray(catalog.capabilities)) {
    throw new Error('O destino não é a árvore-fonte canônica do Omni.')
  }
  const name = proposal.draft.capability.name
  const skillDirectory = join(repoRoot, 'skills', name)
  const skillPath = join(skillDirectory, 'SKILL.md')
  const auditDirectory = join(repoRoot, 'contratos', 'aprendizado', 'promocoes')
  const auditPath = join(auditDirectory, `${name}.json`)
  for (const target of [skillDirectory, auditPath]) {
    await access(target).then(
      () => { throw new Error(`Artefato de promoção já existe: ${target}`) },
      (error) => { if (error?.code !== 'ENOENT') throw error }
    )
  }
  if (catalog.capabilities.some((item) => item.name === name)) {
    throw new Error(`A capacidade ${name} já existe no catálogo.`)
  }
  const git = spawnSync('git', ['-C', repoRoot, 'status', '--porcelain', '--', 'contratos/capacidades/catalogo.json'], {
    encoding: 'utf8', windowsHide: true
  })
  if (git.status !== 0 || git.stdout.trim()) {
    throw new Error('O catálogo possui alterações pendentes; a promoção foi recusada para não sobrescrevê-las.')
  }
  const skillContent = conteudoDaSkill(proposal)
  const capability = proposal.draft.capability
  const nextCatalog = { ...catalog, capabilities: [...catalog.capabilities, capability] }
  const audit = {
    schemaVersion: 1,
    id: proposal.id,
    category: proposal.category,
    source: {
      kind: proposal.source.kind,
      id: proposal.source.id,
      evidenceCount: proposal.source.successCount ?? proposal.source.occurrences,
      validationStatus: proposal.source.validationStatus ?? proposal.source.evaluationStatus
    },
    evaluation: proposal.evaluation,
    approval: proposal.approval,
    artifacts: {
      skill: `skills/${name}/SKILL.md`,
      skillSha256: hash(skillContent),
      capabilityCatalog: 'contratos/capacidades/catalogo.json'
    },
    status: 'materialized-pending-version'
  }
  const temporaryCatalog = `${catalogPath}.${process.pid}.novo`
  try {
    await mkdir(skillDirectory, { recursive: false })
    await mkdir(auditDirectory, { recursive: true })
    await writeFile(skillPath, skillContent, { encoding: 'utf8', flag: 'wx' })
    await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    await writeFile(temporaryCatalog, `${JSON.stringify(nextCatalog, null, 2)}\n`, 'utf8')
    await rename(temporaryCatalog, catalogPath)
  } catch (error) {
    await unlink(temporaryCatalog).catch(() => undefined)
    await rm(skillDirectory, { recursive: true, force: true }).catch(() => undefined)
    await unlink(auditPath).catch(() => undefined)
    throw error
  }
  return {
    status: 'materialized-pending-version',
    artifacts: audit.artifacts,
    auditPath: `contratos/aprendizado/promocoes/${name}.json`
  }
}

export async function promoverMelhoria(casa, id, repoRoot, { now } = {}) {
  const policy = await lerPolitica()
  const [shortcuts, failures] = await Promise.all([lerAtalhos(casa), lerFalhas(casa)])
  const release = await adquirirTrava(casa)
  try {
    const loaded = await carregar(casa, policy)
    const proposal = loaded.store.proposals.find((item) => item.id === id)
    if (!proposal) return { result: 'not-found', proposal: null }
    if (proposal.status === 'retracted') return { result: 'closed', proposal }
    if (
      proposal.status !== 'approved' ||
      proposal.approval?.portable !== true ||
      proposal.approval?.roleFit !== true
    ) {
      return { result: 'not-approved', proposal }
    }
    if (proposal.destination !== 'capability') {
      return {
        result: 'implementation-route-required',
        route: proposal.draft?.implementation ?? null,
        proposal
      }
    }
    const source = proposal.source.kind === 'shortcut'
      ? shortcuts.shortcuts.find((item) => item.id === proposal.source.id)
      : failures.patterns.find((item) => item.id === proposal.source.id)
    const reevaluation = avaliar(source, proposal, policy, agora(now))
    if (!reevaluation.passed) {
      proposal.status = 'draft'
      proposal.evaluation = reevaluation
      proposal.approval = null
      proposal.updatedAt = reevaluation.evaluatedAt
      await gravar(casa, loaded.store, policy)
      return { result: 'source-regressed', proposal }
    }
    const promotion = await materializarNoRepositorio(repoRoot, proposal)
    proposal.status = promotion.status
    proposal.promotion = { ...promotion, materializedAt: agora(now), automaticCommit: false, automaticPush: false }
    proposal.updatedAt = proposal.promotion.materializedAt
    await gravar(casa, loaded.store, policy)
    return { result: proposal.status, proposal }
  } finally {
    await release()
  }
}

async function lerRetracaoInstalada(pluginRoot, proposal, {
  version,
  payloadFingerprint,
  verifiedAt
}) {
  const auditPath = proposal.promotion?.auditPath
  if (typeof auditPath !== 'string') return null
  let canonicalAuditPath
  try {
    canonicalAuditPath = await resolverAuditoriaInstalada(pluginRoot, auditPath)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  const raw = await readFile(canonicalAuditPath, 'utf8')
  let audit
  try {
    audit = JSON.parse(raw)
  } catch {
    throw new Error('O auditPath instalado nao contem JSON valido.')
  }
  if (audit?.status !== RETRACTED_AUDIT_STATUS) return null

  const replacementRuntime = audit.artifacts?.replacementRuntime
  const replacementTests = Array.isArray(audit.artifacts?.replacementTests)
    ? audit.artifacts.replacementTests
    : [audit.artifacts?.replacementTests].filter(Boolean)
  const originalSkill = proposal.promotion?.artifacts?.skill
  const originalSkillSha256 = proposal.promotion?.artifacts?.skillSha256
  if (
    audit.schemaVersion !== 1 ||
    audit.id !== proposal.id ||
    audit.source?.kind !== proposal.source?.kind ||
    audit.source?.id !== proposal.source?.id ||
    audit.evaluation?.protocol !== proposal.evaluation?.protocol ||
    audit.evaluation?.passed !== true ||
    typeof originalSkill !== 'string' ||
    !/^skills\/[a-z0-9][a-z0-9-]{1,80}\/SKILL\.md$/.test(originalSkill) ||
    !/^[a-f0-9]{64}$/.test(originalSkillSha256 ?? '') ||
    audit.artifacts?.retractedSkill !== originalSkill ||
    audit.artifacts?.retractedSkillSha256 !== originalSkillSha256 ||
    audit.artifacts?.retractedCatalogEntry !== proposal.draft?.capability?.name ||
    typeof audit.retraction?.reason !== 'string' ||
    audit.retraction.reason.trim().length < 10 ||
    audit.retraction?.preservesEvidence !== true ||
    !Number.isFinite(Date.parse(audit.retraction?.retractedAt)) ||
    !caminhoSubstitutoValido(replacementRuntime, 'runtime') ||
    replacementTests.length === 0 ||
    !replacementTests.every((item) => caminhoSubstitutoValido(item, 'testes'))
  ) {
    throw new Error('A retracao instalada nao corresponde integralmente a proposta materializada.')
  }
  await confirmarRetiradaInstalada(pluginRoot, proposal, audit)
  await Promise.all([
    resolverSubstitutoInstalado(pluginRoot, replacementRuntime, 'runtime'),
    ...replacementTests.map((item) => resolverSubstitutoInstalado(pluginRoot, item, 'testes'))
  ])

  return {
    status: RETRACTED_AUDIT_STATUS,
    reason: audit.retraction.reason,
    retractedAt: audit.retraction.retractedAt,
    replacedBy: {
      runtime: replacementRuntime,
      tests: [...replacementTests]
    },
    evidence: {
      auditPath,
      auditSha256: hash(raw),
      preserved: true,
      source: audit.source,
      evaluation: audit.evaluation,
      retractedArtifact: {
        skill: audit.artifacts.retractedSkill,
        skillSha256: audit.artifacts.retractedSkillSha256,
        catalogEntry: audit.artifacts.retractedCatalogEntry
      }
    },
    observedInstalledRelease: {
      version,
      payloadFingerprint,
      verifiedAt
    }
  }
}

export async function registrarReadbackInstalado(casa, {
  pluginRoot,
  version,
  payloadFingerprint,
  now
} = {}) {
  if (!isAbsolute(pluginRoot ?? '')) throw new Error('O plugin instalado precisa usar caminho absoluto.')
  if (typeof version !== 'string' || !version.trim()) throw new Error('A versao instalada e obrigatoria.')
  if (!/^[a-f0-9]{64}$/.test(payloadFingerprint ?? '')) {
    throw new Error('O readback exige fingerprint verificado do payload instalado.')
  }
  let integrity
  try {
    integrity = await verificarIntegridadeRelease(pluginRoot)
  } catch {
    throw new Error('O readback exige release instalada integra, identificada e da mesma versao.')
  }
  if (
    integrity.status !== 'verified' ||
    integrity.versionMatchesManifest !== true ||
    integrity.releaseVersion !== version ||
    integrity.fingerprint !== payloadFingerprint ||
    integrity.declaredFingerprint !== payloadFingerprint
  ) {
    throw new Error('O readback exige release instalada integra, identificada e da mesma versao.')
  }
  const policy = await lerPolitica()
  const verifiedAt = agora(now)
  const release = await adquirirTrava(casa)
  try {
    const loaded = await carregar(casa, policy)
    let verified = 0
    let retracted = 0
    for (const proposal of loaded.store.proposals) {
      if (proposal.status !== 'materialized-pending-version') continue
      const retraction = await lerRetracaoInstalada(pluginRoot, proposal, {
        version,
        payloadFingerprint,
        verifiedAt
      })
      if (retraction) {
        proposal.status = 'retracted'
        proposal.promotion = {
          ...proposal.promotion,
          status: 'retracted',
          retraction
        }
        proposal.updatedAt = verifiedAt
        retracted += 1
        continue
      }
      const skill = proposal.promotion?.artifacts?.skill
      const expected = proposal.promotion?.artifacts?.skillSha256
      if (typeof skill !== 'string' || !/^[a-f0-9]{64}$/.test(expected ?? '')) continue
      let raw
      try {
        raw = await readFile(await resolverSkillInstalada(pluginRoot, skill), 'utf8')
      } catch (error) {
        if (error?.code === 'ENOENT') continue
        throw error
      }
      if (hash(raw) !== expected) continue
      proposal.promotion.installedReadback = {
        verified: true,
        version,
        payloadFingerprint,
        artifactFingerprint: expected,
        verifiedAt
      }
      proposal.updatedAt = verifiedAt
      verified += 1
    }
    if (verified > 0 || retracted > 0) await gravar(casa, loaded.store, policy)
    return { result: 'checked', verified, retracted, version, payloadFingerprint }
  } finally {
    await release()
  }
}
