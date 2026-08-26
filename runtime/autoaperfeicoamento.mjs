import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { access, mkdir, open, readFile, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, sep } from 'node:path'

import { lerAtalhos } from './atalhos.mjs'
import { pareceConterSegredo } from './memoria.mjs'

export const SELF_IMPROVEMENT_SCHEMA_VERSION = 1
export const SELF_IMPROVEMENT_PIPELINE_VERSION = 1

const POLICY_PATH = new URL('../contratos/aprendizado/autoaperfeicoamento.json', import.meta.url)
const STATUS = new Set(['draft', 'evaluated', 'approved', 'rejected', 'materialized-pending-version'])

function agora(value) {
  return value ? new Date(value).toISOString() : new Date().toISOString()
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
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
    !policy.destinations.includes('discard') ||
    !policy.destinations.includes('memory') ||
    !policy.destinations.includes('capability') ||
    !Number.isInteger(policy.minimumSuccessfulRuns) ||
    policy.minimumSuccessfulRuns < 4 ||
    policy.requiresIndependentValidation !== true ||
    policy.requiresOwnerApproval !== true ||
    policy.requiresPortableConfirmation !== true ||
    policy.automaticPromotion !== false ||
    policy.automaticGitCommit !== false ||
    policy.automaticGitPush !== false ||
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

export function classificarAprendizado({ useful, reusable }) {
  if (useful !== true) return 'discard'
  if (reusable !== true) return 'memory'
  return 'capability'
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
    'Verifique o resultado antes de declarar sucesso. Se a verificação falhar, pare e reporte a falha.',
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

function avaliar(shortcut, proposal, policy, evaluatedAt) {
  const gates = [
    { id: 'source-still-validated', passed: shortcut?.status === 'validated' && shortcut?.validation?.status === 'passed' },
    { id: 'independent-validation', passed: Boolean(shortcut?.validation?.observationId) },
    { id: 'minimum-successful-runs', passed: shortcut?.successCount >= policy.minimumSuccessfulRuns },
    { id: 'shortcut-removes-steps', passed: shortcut?.shortcutSteps?.length < shortcut?.baselineSteps?.length },
    { id: 'source-snapshot-current', passed: shortcut?.updatedAt === proposal.source.updatedAt },
    { id: 'capability-draft-complete', passed: Boolean(proposal.draft?.capability?.name && proposal.draft?.skill?.instructions?.length >= 4) },
    { id: 'no-automatic-promotion', passed: policy.automaticPromotion === false }
  ]
  return {
    protocol: 'self-improvement-eval-v1',
    passed: gates.every((gate) => gate.passed),
    gates,
    evaluatedAt
  }
}

export async function avaliarMelhoria(casa, id, { now } = {}) {
  const policy = await lerPolitica()
  const shortcuts = await lerAtalhos(casa)
  const evaluatedAt = agora(now)
  const release = await adquirirTrava(casa)
  try {
    const loaded = await carregar(casa, policy)
    const proposal = loaded.store.proposals.find((item) => item.id === id)
    if (!proposal) return { result: 'not-found', proposal: null }
    if (proposal.status === 'rejected' || proposal.status === 'materialized-pending-version') {
      return { result: 'closed', proposal }
    }
    const shortcut = shortcuts.shortcuts.find((item) => item.id === proposal.source.id)
    proposal.evaluation = avaliar(shortcut, proposal, policy, evaluatedAt)
    proposal.status = proposal.evaluation.passed ? 'evaluated' : 'draft'
    proposal.approval = null
    proposal.updatedAt = evaluatedAt
    await gravar(casa, loaded.store, policy)
    return { result: proposal.evaluation.passed ? 'passed' : 'failed', proposal }
  } finally {
    await release()
  }
}

export async function decidirMelhoria(casa, id, decision, { portable = false, now } = {}) {
  const policy = await lerPolitica()
  const decidedAt = agora(now)
  const release = await adquirirTrava(casa)
  try {
    const loaded = await carregar(casa, policy)
    const proposal = loaded.store.proposals.find((item) => item.id === id)
    if (!proposal) return { result: 'not-found', proposal: null }
    if (proposal.status === 'materialized-pending-version') return { result: 'closed', proposal }
    if (decision === 'reject') {
      proposal.status = 'rejected'
      proposal.approval = { decision: 'rejected', portable: false, decidedAt }
    } else {
      if (proposal.status !== 'evaluated' || proposal.evaluation?.passed !== true) {
        return { result: 'not-ready', proposal }
      }
      if (portable !== true) return { result: 'portable-confirmation-required', proposal }
      proposal.status = 'approved'
      proposal.approval = { decision: 'approved', portable: true, decidedAt }
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
      successfulRuns: proposal.source.successCount,
      validationStatus: proposal.source.validationStatus
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
  const shortcuts = await lerAtalhos(casa)
  const release = await adquirirTrava(casa)
  try {
    const loaded = await carregar(casa, policy)
    const proposal = loaded.store.proposals.find((item) => item.id === id)
    if (!proposal) return { result: 'not-found', proposal: null }
    if (proposal.status !== 'approved' || proposal.approval?.portable !== true) {
      return { result: 'not-approved', proposal }
    }
    const shortcut = shortcuts.shortcuts.find((item) => item.id === proposal.source.id)
    const reevaluation = avaliar(shortcut, proposal, policy, agora(now))
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
