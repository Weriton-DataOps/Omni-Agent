import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validarSuite } from './eval-personalidade.mjs'

const raiz = dirname(dirname(fileURLToPath(import.meta.url)))
const cache = new Map()

function caminhoInterno(diretorio, contrato) {
  if (typeof contrato !== 'string' || !contrato.trim() || isAbsolute(contrato)) {
    throw new Error('Manifesto da personalidade declara contrato inválido.')
  }
  const caminho = resolve(diretorio, contrato)
  const trecho = relative(diretorio, caminho)
  if (!trecho || trecho === '..' || trecho.startsWith(`..${sep}`) || isAbsolute(trecho)) {
    throw new Error('Contrato da personalidade saiu do diretório permitido.')
  }
  if (extname(caminho).toLowerCase() !== '.md') {
    throw new Error('Contrato da personalidade precisa ser Markdown.')
  }
  return caminho
}

function extrairNucleo(markdown) {
  const bloco = markdown.match(/## Núcleo textual\s+```text\s*([\s\S]*?)```/i)
  if (!bloco) throw new Error('Núcleo textual da personalidade não encontrado.')
  return bloco[1].trim()
}

const STATUS_CANDIDATA = 'active-candidate-pending-evals'
const STATUS_PROMOVIDA = 'approved'
const HASH_SHA256 = /^[a-f0-9]{64}$/

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

function exigirChavesExatas(object, expected, label) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) {
    throw new Error(`${label} não é um objeto válido.`)
  }
  const allowed = new Set(expected)
  const extras = Object.keys(object).filter((key) => !allowed.has(key))
  if (extras.length > 0) throw new Error(`${label} contém campos não permitidos: ${extras.join(', ')}.`)
}

function caminhoDaEvidencia(pluginRoot, path) {
  if (typeof path !== 'string' || !path.trim() || isAbsolute(path)) {
    throw new Error('Registro de promoção declara evidência inválida.')
  }
  const allowed = resolve(pluginRoot, 'contratos', 'eval', 'resultados')
  const target = resolve(pluginRoot, path)
  const trecho = relative(allowed, target)
  if (!trecho || trecho === '..' || trecho.startsWith(`..${sep}`) || isAbsolute(trecho)) {
    throw new Error('Evidência da promoção saiu do diretório permitido.')
  }
  if (extname(target).toLowerCase() !== '.json') {
    throw new Error('Evidência da promoção precisa ser JSON.')
  }
  return target
}

export function validarPromocao(manifesto) {
  const status = manifesto?.status
  if (status !== STATUS_CANDIDATA && status !== STATUS_PROMOVIDA) {
    throw new Error('Status da personalidade não é reconhecido.')
  }
  if (typeof manifesto.id !== 'string' || !/^omni-persona-v\d+-candidate$/.test(manifesto.id)) {
    throw new Error('Identificador versionado da personalidade é inválido.')
  }
  const promovida = status === STATUS_PROMOVIDA

  const promocao = manifesto.promotion ?? null
  if (!promovida) {
    if (promocao !== null) throw new Error('Candidata não pode declarar promoção.')
    return manifesto
  }

  if (!promocao || typeof promocao !== 'object') {
    throw new Error('Personalidade promovida exige registro da rodada de eval.')
  }
  exigirChavesExatas(promocao, ['roundId', 'decidedAt', 'decidedBy', 'evidence'], 'Registro de promoção')
  for (const campo of ['roundId', 'decidedAt', 'decidedBy']) {
    if (typeof promocao[campo] !== 'string' || !promocao[campo].trim()) {
      throw new Error(`Registro de promoção sem ${campo}.`)
    }
  }
  if (Number.isNaN(Date.parse(promocao.decidedAt))) {
    throw new Error('Registro de promoção com data inválida.')
  }
  if (
    typeof promocao.evidence?.path !== 'string' ||
    !HASH_SHA256.test(promocao.evidence?.sha256 ?? '')
  ) {
    throw new Error('Promoção exige referência e SHA-256 da evidência.')
  }
  exigirChavesExatas(promocao.evidence, ['path', 'sha256'], 'Referência da evidência')
  return manifesto
}

export async function validarEvidenciaPromocao(
  manifesto,
  pluginRoot = raiz,
  { verificarEvidenciaConfiavel } = {}
) {
  validarPromocao(manifesto)
  if (manifesto.status !== STATUS_PROMOVIDA) return null

  const path = caminhoDaEvidencia(pluginRoot, manifesto.promotion.evidence.path)
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('Arquivo de evidência da promoção não foi encontrado.')
    throw error
  }
  if (sha256(raw) !== manifesto.promotion.evidence.sha256) {
    throw new Error('SHA-256 da evidência de promoção não confere.')
  }

  let evidence
  try {
    evidence = JSON.parse(raw)
  } catch {
    throw new Error('Evidência da promoção não contém JSON válido.')
  }
  exigirChavesExatas(
    evidence,
    [
      'schemaVersion',
      'roundId',
      'decidedAt',
      'decidedBy',
      'suiteSha256',
      'baseline',
      'candidate',
      'responseSets',
      'caseResults'
    ],
    'Evidência da promoção'
  )
  exigirChavesExatas(
    evidence.responseSets,
    ['baselineSha256', 'candidateSha256'],
    'Identificação dos conjuntos de respostas'
  )
  const suitePath = join(pluginRoot, 'contratos', 'eval', 'personalidade.json')
  const suiteRaw = await readFile(suitePath, 'utf8')
  const suite = validarSuite(JSON.parse(suiteRaw))
  if (
    evidence?.schemaVersion !== 1 ||
    evidence.roundId !== manifesto.promotion.roundId ||
    evidence.decidedAt !== manifesto.promotion.decidedAt ||
    evidence.decidedBy !== manifesto.promotion.decidedBy ||
    evidence.suiteSha256 !== sha256(suiteRaw) ||
    evidence.baseline !== suite.baseline ||
    evidence.candidate !== suite.candidate ||
    evidence.candidate !== manifesto.id
  ) {
    throw new Error('Evidência da promoção não corresponde ao manifesto ou à suíte ativa.')
  }
  if (
    !HASH_SHA256.test(evidence.responseSets?.baselineSha256 ?? '') ||
    !HASH_SHA256.test(evidence.responseSets?.candidateSha256 ?? '')
  ) {
    throw new Error('Evidência não identifica os dois conjuntos de respostas.')
  }
  if (!Array.isArray(evidence.caseResults) || evidence.caseResults.length !== suite.cases.length) {
    throw new Error('Evidência não cobre todos os casos da suíte.')
  }

  const byId = new Map()
  for (const result of evidence.caseResults) {
    exigirChavesExatas(
      result,
      ['id', 'weight', 'baselineAutomaticPassed', 'candidateAutomaticPassed', 'humanApproved'],
      'Resultado de caso'
    )
    if (typeof result?.id !== 'string' || byId.has(result.id)) {
      throw new Error('Evidência possui caso ausente, inválido ou duplicado.')
    }
    byId.set(result.id, result)
  }
  let totalWeight = 0
  let baselineApprovedWeight = 0
  let candidateApprovedWeight = 0
  for (const testCase of suite.cases) {
    const result = byId.get(testCase.id)
    if (
      !result ||
      result.weight !== testCase.peso ||
      typeof result.baselineAutomaticPassed !== 'boolean' ||
      typeof result.candidateAutomaticPassed !== 'boolean' ||
      result.humanApproved !== true
    ) {
      throw new Error(`Evidência incompleta ou sem aprovação humana em ${testCase.id}.`)
    }
    if (testCase.peso === 5 && !result.candidateAutomaticPassed) {
      throw new Error(`Promoção bloqueada por falha de peso máximo em ${testCase.id}.`)
    }
    totalWeight += testCase.peso
    if (result.baselineAutomaticPassed) baselineApprovedWeight += testCase.peso
    if (result.candidateAutomaticPassed) candidateApprovedWeight += testCase.peso
  }
  if (byId.size !== suite.cases.length) {
    throw new Error('Evidência contém casos que não pertencem à suíte.')
  }
  const baselineScore = Number((baselineApprovedWeight / totalWeight).toFixed(4))
  const candidateScore = Number((candidateApprovedWeight / totalWeight).toFixed(4))
  if (candidateScore < baselineScore) {
    throw new Error('Candidata não pode ser promovida abaixo da linha de base.')
  }
  if (typeof verificarEvidenciaConfiavel === 'function') {
    throw new Error(
      'Callback fornecido pelo chamador nao e raiz de confianca e nao pode autenticar uma promocao.'
    )
  }
  throw new Error([
    'Promocao indisponivel: o runtime ainda nao possui verificacao criptografica interna',
    'vinculada a uma identidade externa do proprietario.'
  ].join(' '))
}

async function carregar(pluginRoot, verificarEvidenciaConfiavel) {
  const diretorio = join(pluginRoot, 'contratos', 'personalidade')
  const manifesto = JSON.parse(await readFile(join(diretorio, 'manifest.json'), 'utf8'))
  if (
    manifesto?.schemaVersion !== 1 ||
    typeof manifesto.id !== 'string' ||
    !/^omni-persona-v\d+-candidate$/.test(manifesto.id)
  ) {
    throw new Error('Manifesto da personalidade é inválido.')
  }
  const contractPath = caminhoInterno(diretorio, manifesto.contract)
  const markdown = await readFile(contractPath, 'utf8')
  const nucleus = extrairNucleo(markdown)
  if (!nucleus.includes(`PERSONALIDADE ${manifesto.id}.`)) {
    throw new Error('Identidade do núcleo não corresponde ao manifesto.')
  }
  const promotionEvidence = await validarEvidenciaPromocao(
    manifesto,
    pluginRoot,
    { verificarEvidenciaConfiavel }
  )
  return { manifest: manifesto, markdown, nucleus, promotionEvidence }
}

export async function lerPersonalidadeAtiva({
  pluginRoot = raiz,
  useCache = true,
  verificarEvidenciaConfiavel
} = {}) {
  if (!useCache || verificarEvidenciaConfiavel) {
    return carregar(pluginRoot, verificarEvidenciaConfiavel)
  }
  if (!cache.has(pluginRoot)) {
    cache.set(
      pluginRoot,
      carregar(pluginRoot, undefined).catch((error) => {
        cache.delete(pluginRoot)
        throw error
      })
    )
  }
  return cache.get(pluginRoot)
}
