// Plano 4b, tarefa 4: a ilha monta os painéis pela interface do agente.json, com o caminho preso à raiz
// do agente, e a janela só navega dentro da pasta da interface.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const { montarAgentes, podeNavegar, CONHECIDOS } = require('../apps/omni-ilha/agentes.js')

const RAIZ = join('C:\\', 'agentes', 'oraculo')
const MODULO = join(RAIZ, 'interface', 'index.html')
const PRELOAD = join(RAIZ, 'interface', 'actions', 'actions-preload.js')
const existe = (lista) => (caminho) => lista.includes(caminho)
const ORACULO = { agente: 'oraculo', versao: '0.3.0', raiz: RAIZ, modulo: 'interface/index.html', preload: 'interface/actions/actions-preload.js', painel: 'Oráculo', divergente: false, estado: 'no-ar' }

test('o oraculo instalado monta com caminhos absolutos dentro da raiz', () => {
  assert.deepEqual(CONHECIDOS, [{ agente: 'oraculo', nome: 'Oráculo' }])
  assert.deepEqual(montarAgentes([ORACULO], { existe: existe([MODULO, PRELOAD]) }), [{
    agente: 'oraculo', nome: 'Oráculo', versao: '0.3.0', estado: 'no-ar', instalado: true,
    modulo: MODULO, preload: PRELOAD, pasta: join(RAIZ, 'interface')
  }])
})

test('sem preload, sem painel: monta com o nome do agente e preload nulo', () => {
  const nu = { ...ORACULO, agente: 'outro', preload: null, painel: null }
  const [montado] = montarAgentes([nu], { existe: existe([MODULO]) })
  assert.equal(montado.nome, 'outro')
  assert.equal(montado.preload, null)
})

test('conhecido ausente vira card de instalar; o que escapa da raiz, some ou diverge não monta', () => {
  const casos = [
    { ...ORACULO, modulo: '../fora.html' },
    { ...ORACULO, modulo: 'interface/../../fora.html' },
    { ...ORACULO, modulo: 'C:\\Windows\\win.ini' },
    { ...ORACULO, modulo: 'D:\\interface\\index.html' },
    { ...ORACULO, preload: '../preload.js' },
    { ...ORACULO, modulo: 'interface/sumiu.html' },
    { ...ORACULO, divergente: true },
    { ...ORACULO, agente: '../oraculo' },
    { ...ORACULO, modulo: 42 }
  ]
  for (const caso of casos) {
    assert.deepEqual(montarAgentes([caso], { existe: existe([MODULO, PRELOAD]) }), [{ agente: 'oraculo', nome: 'Oráculo', instalado: false }], JSON.stringify(caso))
  }
  assert.deepEqual(montarAgentes([], { existe: existe([]) }), [{ agente: 'oraculo', nome: 'Oráculo', instalado: false }])
  assert.deepEqual(montarAgentes(null, { existe: existe([]) }), [{ agente: 'oraculo', nome: 'Oráculo', instalado: false }])
})

test('podeNavegar: só file: dentro da pasta da interface', () => {
  const pasta = join(RAIZ, 'interface')
  const url = (caminho) => pathToFileURL(caminho).href
  assert.equal(podeNavegar(url(MODULO), pasta), true)
  assert.equal(podeNavegar(url(join(pasta, 'actions', 'actions.html')), pasta), true)
  assert.equal(podeNavegar(`${url(MODULO)}#ideias`, pasta), true)
  assert.equal(podeNavegar(url(join(RAIZ, 'executor', 'agente.json')), pasta), false)
  assert.equal(podeNavegar(url(join(RAIZ, 'interface-irma', 'x.html')), pasta), false)
  assert.equal(podeNavegar(`${url(pasta)}/%2e%2e/executor/agente.json`, pasta), false)
  assert.equal(podeNavegar(`${url(pasta)}/actions%5c..%5c..%5cexecutor%5cagente.json`, pasta), false)
  assert.equal(podeNavegar('https://exemplo.com/', pasta), false)
  assert.equal(podeNavegar('javascript:alert(1)', pasta), false)
  assert.equal(podeNavegar('file://servidor/compartilhado/x.html', pasta), false)
  assert.equal(podeNavegar('nada disso', pasta), false)
  assert.equal(podeNavegar(url(MODULO), null), false)
  assert.equal(podeNavegar('file:///D:/agentes/oraculo/interface/index.html', pasta), false, 'outro drive')
  // Painel nunca vem da rede, nem quando a pasta é um compartilhamento.
  assert.equal(podeNavegar('file://servidor/compartilhado/interface/x.html', '\\\\servidor\\compartilhado\\interface'), false)
})

test('outro drive não passa nem quando o arquivo existe', () => {
  assert.deepEqual(montarAgentes([{ ...ORACULO, modulo: 'D:\\interface\\index.html' }], { existe: () => true }), [{ agente: 'oraculo', nome: 'Oráculo', instalado: false }])
})
