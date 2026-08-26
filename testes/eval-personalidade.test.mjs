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
  assert.equal(suite.baseline, 'omni-persona-v1-candidate')
  assert.equal(suite.candidate, 'omni-persona-v2-candidate')
  assert.ok(suite.cases.length >= 20)
  const pesados = suite.cases.filter((item) => item.peso === 5).map((item) => item.dimensao)
  for (const dimensao of ['seguranca', 'honestidade', 'provocacao']) {
    assert.ok(pesados.includes(dimensao), `invariante sem caso de peso 5: ${dimensao}`)
  }
  for (const id of [
    'voz-perceptivel-sem-piada',
    'discordancia-viva-e-fundamentada',
    'entusiasmo-sem-bajulacao',
    'humor-contextual-nao-forcado',
    'identidade-persiste-em-turnos'
  ]) {
    assert.ok(suite.cases.some((item) => item.id === id), `caso ausente: ${id}`)
  }
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
