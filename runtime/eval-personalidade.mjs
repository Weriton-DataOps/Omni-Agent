import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = dirname(dirname(fileURLToPath(import.meta.url)))
const DIMENSOES = new Set([
  'anti-generico',
  'independencia',
  'seguranca',
  'honestidade',
  'identidade',
  'controle-do-dono',
  'provocacao'
])

function compilar(padrao, nome) {
  try {
    return new RegExp(padrao, 'i')
  } catch (erro) {
    throw new Error(`Padrão inválido em ${nome}: ${erro.message}`)
  }
}

function itensDeLista(texto) {
  return (texto.match(/^[ \t]*([-*+]|\d+[.)])[ \t]+/gm) ?? []).length
}

function aberturasRepetidas(texto) {
  const aberturas = texto
    .split(/\n\s*\n/)
    .map((paragrafo) => paragrafo.trim().toLowerCase().split(/\s+/).slice(0, 2).join(' '))
    .filter((abertura) => abertura.length > 0)
  const vistas = new Set()
  for (const abertura of aberturas) {
    if (vistas.has(abertura)) return abertura
    vistas.add(abertura)
  }
  return null
}

export function validarSuite(suite) {
  if (suite?.schemaVersion !== 1) throw new Error('Suíte de eval com schemaVersion inesperada.')
  if (suite.suite === 'personalidade' && suite.expectedFormat !== 'example-response-v1') {
    throw new Error('Suíte de personalidade precisa usar exemplos reais no campo esperado.')
  }
  if (!Array.isArray(suite.cases) || suite.cases.length === 0) {
    throw new Error('Suíte de eval sem casos.')
  }
  if (suite.baseline === suite.candidate) {
    throw new Error('Eval comparativo precisa de baseline diferente da candidata.')
  }
  if (suite.baselineProtocol !== undefined) {
    const protocol = suite.baselineProtocol
    if (
      protocol?.kind !== 'same-model-without-omni-context' ||
      protocol.sameProvider !== true ||
      protocol.sameModel !== true ||
      protocol.sameModelVersion !== true ||
      protocol.sameSettings !== true ||
      protocol.sameInputs !== true ||
      protocol.omniPersonalityInjected !== false ||
      protocol.omniContextInjected !== false
    ) {
      throw new Error('Protocolo da baseline nao garante comparacao controlada sem contexto do Omni.')
    }
  }
  const ids = new Set()
  for (const caso of suite.cases) {
    if (typeof caso.id !== 'string' || !caso.id) throw new Error('Caso sem id.')
    if (ids.has(caso.id)) throw new Error(`Caso duplicado: ${caso.id}`)
    ids.add(caso.id)
    if (!DIMENSOES.has(caso.dimensao)) throw new Error(`Dimensão desconhecida em ${caso.id}.`)
    if (!Number.isInteger(caso.peso) || caso.peso < 1) throw new Error(`Peso inválido em ${caso.id}.`)
    if (typeof caso.entrada !== 'string' || !caso.entrada.trim()) {
      throw new Error(`Caso ${caso.id} sem entrada.`)
    }
    if (typeof caso.esperado !== 'string' || !caso.esperado.trim()) {
      throw new Error(`Caso ${caso.id} sem exemplo esperado.`)
    }
    const automatico = caso.criterios?.automatico ?? {}
    for (const grupo of ['proibirRegex', 'exigirRegex']) {
      for (const regra of automatico[grupo] ?? []) compilar(regra.padrao, `${caso.id}/${regra.nome}`)
    }
    if (!Array.isArray(caso.criterios?.humano) || caso.criterios.humano.length === 0) {
      throw new Error(`Caso ${caso.id} precisa declarar ao menos um critério humano.`)
    }
  }
  return suite
}

export async function lerSuite({ pluginRoot = raiz } = {}) {
  const caminho = join(pluginRoot, 'contratos', 'eval', 'personalidade.json')
  return validarSuite(JSON.parse(await readFile(caminho, 'utf8')))
}

export function avaliarResposta(caso, texto) {
  const resposta = typeof texto === 'string' ? texto.trim() : ''
  const criterios = caso.criterios?.automatico ?? {}
  const falhas = []

  if (!resposta) falhas.push({ regra: 'resposta-vazia', detalhe: 'nenhuma resposta capturada' })

  if (Number.isInteger(criterios.maxCaracteres) && resposta.length > criterios.maxCaracteres) {
    falhas.push({
      regra: 'maxCaracteres',
      detalhe: `${resposta.length} > ${criterios.maxCaracteres}`
    })
  }

  if (criterios.proibirCabecalhoMarkdown && /^[ \t]{0,3}#{1,6}[ \t]+/m.test(resposta)) {
    falhas.push({ regra: 'proibirCabecalhoMarkdown', detalhe: 'cabeçalho markdown presente' })
  }

  if (Number.isInteger(criterios.maxItensDeLista)) {
    const total = itensDeLista(resposta)
    if (total > criterios.maxItensDeLista) {
      falhas.push({ regra: 'maxItensDeLista', detalhe: `${total} > ${criterios.maxItensDeLista}` })
    }
  }

  for (const regra of criterios.proibirRegex ?? []) {
    if (compilar(regra.padrao, `${caso.id}/${regra.nome}`).test(resposta)) {
      falhas.push({ regra: 'proibirRegex', detalhe: regra.nome })
    }
  }

  for (const regra of criterios.exigirRegex ?? []) {
    if (!compilar(regra.padrao, `${caso.id}/${regra.nome}`).test(resposta)) {
      falhas.push({ regra: 'exigirRegex', detalhe: regra.nome })
    }
  }

  if (criterios.proibirAberturaRepetida) {
    const repetida = aberturasRepetidas(resposta)
    if (repetida) falhas.push({ regra: 'proibirAberturaRepetida', detalhe: repetida })
  }

  return {
    id: caso.id,
    dimensao: caso.dimensao,
    peso: caso.peso,
    automatico: { passou: falhas.length === 0, falhas },
    humano: { status: 'pendente', criterios: caso.criterios.humano }
  }
}

export function avaliarRodada(suite, respostas) {
  const mapa = respostas instanceof Map ? respostas : new Map(Object.entries(respostas ?? {}))
  const resultados = suite.cases.map((caso) => avaliarResposta(caso, mapa.get(caso.id)))
  const pesoTotal = resultados.reduce((soma, item) => soma + item.peso, 0)
  const pesoAprovado = resultados
    .filter((item) => item.automatico.passou)
    .reduce((soma, item) => soma + item.peso, 0)
  const ausentes = suite.cases.filter((caso) => !mapa.has(caso.id)).map((caso) => caso.id)
  return {
    suite: suite.suite,
    persona: suite.candidate,
    baseline: suite.baseline,
    casos: resultados.length,
    respostasAusentes: ausentes,
    automatico: {
      pesoTotal,
      pesoAprovado,
      score: pesoTotal === 0 ? 0 : Number((pesoAprovado / pesoTotal).toFixed(4)),
      reprovados: resultados.filter((item) => !item.automatico.passou).map((item) => item.id)
    },
    revisaoHumanaPendente: resultados.map((item) => item.id),
    resultados
  }
}
