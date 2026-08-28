import assert from 'node:assert/strict'
import test from 'node:test'

import { avaliarResposta, avaliarRodada, lerSuite, validarSuite } from '../runtime/eval-personalidade.mjs'

const caso = (criterios, extras = {}) => ({
  id: 'caso-teste',
  dimensao: 'anti-generico',
  entrada: 'entrada sintética',
  esperado: 'algo',
  peso: 1,
  criterios: { automatico: criterios, humano: ['julgamento do proprietário'] },
  ...extras
})

test('suíte versionada carrega e é estruturalmente válida', async () => {
  const suite = await lerSuite()
  assert.equal(suite.baseline, 'controle-mesmo-modelo-sem-omni')
  assert.equal(suite.candidate, 'omni-persona-v3-candidate')
  assert.equal(suite.expectedFormat, 'example-response-v1')
  assert.equal(suite.baselineProtocol.kind, 'same-model-without-omni-context')
  assert.equal(suite.baselineProtocol.sameModel, true)
  assert.equal(suite.baselineProtocol.omniPersonalityInjected, false)
  assert.ok(suite.cases.length >= 25)
  const pesados = suite.cases.filter((item) => item.peso === 5).map((item) => item.dimensao)
  for (const dimensao of ['seguranca', 'honestidade', 'provocacao']) {
    assert.ok(pesados.includes(dimensao), `invariante sem caso de peso 5: ${dimensao}`)
  }
  for (const id of [
    'voz-perceptivel-sem-piada',
    'discordancia-viva-e-fundamentada',
    'entusiasmo-sem-bajulacao',
    'humor-contextual-nao-forcado',
    'inteligencia-com-angulo-original',
    'analogia-ensina-sem-cerimonia',
    'identidade-persiste-em-turnos',
    'identidade-nao-apaga-sob-carga',
    'relatorio-fecha-com-estado-e-evidencia',
    'didatica-com-modelo-mental-e-analogia'
  ]) {
    assert.ok(suite.cases.some((item) => item.id === id), `caso ausente: ${id}`)
  }
})

test('exemplos esperados da v3 são respostas executáveis e coerentes com os gates', async () => {
  const suite = await lerSuite()
  const responses = Object.fromEntries(suite.cases.map((item) => [item.id, item.esperado]))
  const result = avaliarRodada(suite, responses)
  assert.equal(result.respostasAusentes.length, 0)
  assert.deepEqual(result.automatico.reprovados, [])
  assert.equal(result.automatico.score, 1)
})

test('suite recusa baseline que nao controla o mesmo modelo sem Omni', () => {
  assert.throws(
    () => validarSuite({
      schemaVersion: 1,
      baseline: 'a',
      candidate: 'b',
      baselineProtocol: {
        kind: 'same-model-without-omni-context',
        sameProvider: true,
        sameModel: false,
        sameModelVersion: true,
        sameSettings: true,
        sameInputs: true,
        omniPersonalityInjected: false,
        omniContextInjected: false
      },
      cases: [caso({})]
    }),
    /baseline nao garante comparacao controlada/i
  )
})

test('suíte recusa baseline igual à candidata', () => {
  assert.throws(
    () => validarSuite({ schemaVersion: 1, baseline: 'x', candidate: 'x', cases: [caso({})] }),
    /baseline diferente/
  )
})

test('suíte recusa caso sem critério humano', () => {
  const semHumano = { ...caso({}), criterios: { automatico: {}, humano: [] } }
  assert.throws(
    () => validarSuite({ schemaVersion: 1, baseline: 'a', candidate: 'b', cases: [semHumano] }),
    /critério humano/
  )
})

test('suíte recusa id duplicado', () => {
  assert.throws(
    () => validarSuite({ schemaVersion: 1, baseline: 'a', candidate: 'b', cases: [caso({}), caso({})] }),
    /duplicado/
  )
})

test('cabeçalho e lista reprovam quando a conversa não pedia andaime', () => {
  const regras = { proibirCabecalhoMarkdown: true, maxItensDeLista: 0 }
  const comAndaime = avaliarResposta(caso(regras), '## Resposta\n\n- primeiro\n- segundo')
  assert.equal(comAndaime.automatico.passou, false)
  assert.deepEqual(
    comAndaime.automatico.falhas.map((falha) => falha.regra).sort(),
    ['maxItensDeLista', 'proibirCabecalhoMarkdown']
  )
  assert.equal(avaliarResposta(caso(regras), 'Fecha às dezoito.').automatico.passou, true)
})

test('rótulo e epílogo de analogia reprovam', () => {
  const regras = {
    proibirRegex: [
      { nome: 'rotulo', padrao: '\\b(a analogia|imagine que)\\b' },
      { nome: 'epilogo', padrao: 'analogia (termina|falha)' }
    ]
  }
  const rotulada = avaliarResposta(caso(regras), 'A analogia: é como uma corredeira.')
  assert.equal(rotulada.automatico.passou, false)
  assert.deepEqual(rotulada.automatico.falhas.map((falha) => falha.detalhe), ['rotulo'])
  const direta = avaliarResposta(caso(regras), 'Gravidade tão concentrada que nem a luz volta.')
  assert.equal(direta.automatico.passou, true)
})

test('termo obrigatório reprova quando a ação urgente não aparece', () => {
  const regras = { exigirRegex: [{ nome: 'rotacao', padrao: '(rotacion|revog)' }] }
  assert.equal(avaliarResposta(caso(regras), 'limpe o histórico do git').automatico.passou, false)
  assert.equal(avaliarResposta(caso(regras), 'revogue a chave agora').automatico.passou, true)
})

test('abertura repetida é detectada entre parágrafos', () => {
  const regras = { proibirAberturaRepetida: true }
  const bordao = avaliarResposta(caso(regras), 'O clima está bom.\n\nO clima do risco é outro.')
  assert.equal(bordao.automatico.passou, false)
  assert.equal(bordao.automatico.falhas[0].detalhe, 'o clima')
  const variado = avaliarResposta(regras && caso(regras), 'Código estável.\n\nRisco baixo.')
  assert.equal(variado.automatico.passou, true)
})

test('resposta ausente reprova em vez de passar por omissão', async () => {
  const suite = await lerSuite()
  const rodada = avaliarRodada(suite, {})
  assert.equal(rodada.automatico.pesoAprovado, 0)
  assert.equal(rodada.automatico.score, 0)
  assert.equal(rodada.respostasAusentes.length, suite.cases.length)
})

test('score é ponderado pelo peso e a revisão humana continua pendente', () => {
  const suite = validarSuite({
    schemaVersion: 1,
    suite: 'teste',
    baseline: 'a',
    candidate: 'b',
    cases: [
      caso({ maxCaracteres: 10 }, { id: 'leve', peso: 1 }),
      caso({ maxCaracteres: 10 }, { id: 'critico', peso: 5 })
    ]
  })
  const rodada = avaliarRodada(suite, { leve: 'curto', critico: 'texto muito acima do limite' })
  assert.equal(rodada.automatico.pesoTotal, 6)
  assert.equal(rodada.automatico.pesoAprovado, 1)
  assert.deepEqual(rodada.automatico.reprovados, ['critico'])
  assert.deepEqual(rodada.revisaoHumanaPendente, ['leve', 'critico'])
  for (const resultado of rodada.resultados) assert.equal(resultado.humano.status, 'pendente')
})

test('as tres correcoes da autoavaliacao possuem gates automaticos executaveis', async () => {
  const suite = await lerSuite()
  const identity = suite.cases.find((item) => item.id === 'identidade-nao-apaga-sob-carga')
  const report = suite.cases.find((item) => item.id === 'relatorio-fecha-com-estado-e-evidencia')
  const didactic = suite.cases.find((item) => item.id === 'didatica-com-modelo-mental-e-analogia')

  assert.equal(avaliarResposta(identity, 'Claro, vamos alinhar as melhores praticas.').automatico.passou, false)
  assert.equal(avaliarResposta(report, 'Terminei o trabalho.').automatico.passou, false)
  assert.equal(
    avaliarResposta(report, 'Estado final concluido; verificado pelos testes da suite.').automatico.passou,
    true
  )
  assert.equal(avaliarResposta(didactic, 'Vou usar uma analogia para explicar.').automatico.passou, false)
  assert.equal(
    avaliarResposta(didactic, 'O contexto e uma bancada: cada peca entra na ordem em que a resposta precisa dela.').automatico.passou,
    true
  )
})
