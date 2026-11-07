// O card do cofre na ilha (F1, plano 5, T7): quando ler e o que mostrar. Módulo puro, sem DOM e sem processo:
// o relógio é um número que a prova passa, e o resumo é o objeto que a mão devolveria.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { deveLer, vistaDoCard, INTERVALO_MS, PISO_ABERTURA_MS, MAX_LINHAS } = require('../apps/omni-ilha/cofre-card.js')

const T0 = 1_800_000_000_000
const MIN = 60 * 1000

test('CC: os prazos são 5 min aberta e 1 min entre aberturas; o card mostra 2 linhas', () => {
  assert.equal(INTERVALO_MS, 5 * MIN)
  assert.equal(PISO_ABERTURA_MS, MIN)
  assert.equal(MAX_LINHAS, 2)
})

test('CC: lendo, nunca lê de novo, nem nunca lido', () => {
  assert.equal(deveLer({ agora: T0, lidoEm: null, lendo: true, motivo: 'abriu' }), false)
  assert.equal(deveLer({ agora: T0, lidoEm: T0 - 10 * MIN, lendo: true, motivo: 'relogio' }), false)
})

test('CC: nunca lido, lê pelos dois motivos', () => {
  assert.equal(deveLer({ agora: T0, lidoEm: null, lendo: false, motivo: 'abriu' }), true)
  assert.equal(deveLer({ agora: T0, lidoEm: undefined, lendo: false, motivo: 'relogio' }), true)
})

test('CC: ao abrir, relê só depois de 1 min da última leitura', () => {
  assert.equal(deveLer({ agora: T0, lidoEm: T0 - (MIN - 1000), lendo: false, motivo: 'abriu' }), false)
  assert.equal(deveLer({ agora: T0, lidoEm: T0 - MIN, lendo: false, motivo: 'abriu' }), true)
})

test('CC: aberta, o relógio relê só a cada 5 min', () => {
  assert.equal(deveLer({ agora: T0, lidoEm: T0 - MIN, lendo: false, motivo: 'relogio' }), false)
  assert.equal(deveLer({ agora: T0, lidoEm: T0 - (5 * MIN - 1000), lendo: false, motivo: 'relogio' }), false)
  assert.equal(deveLer({ agora: T0, lidoEm: T0 - 5 * MIN, lendo: false, motivo: 'relogio' }), true)
})

test('CC: relógio que voltou ou leitura sem número relê em vez de esperar', () => {
  assert.equal(deveLer({ agora: T0, lidoEm: T0 + 10 * MIN, lendo: false, motivo: 'relogio' }), true)
  assert.equal(deveLer({ agora: T0, lidoEm: Number.NaN, lendo: false, motivo: 'relogio' }), true)
})

test('CC: sem alertas, o card mostra o total e "nada a olhar"', () => {
  assert.deepEqual(vistaDoCard({ ok: true, total: 9, alertas: 0, primeiros: [] }),
    { estado: 'ok', numero: '9', rotulo: 'CREDENCIAIS', detalhe: 'nada a olhar', erro: '', linhas: [] })
})

test('CC: uma credencial vai no singular', () => {
  const v = vistaDoCard({ ok: true, total: 1, alertas: 0, primeiros: [] })
  assert.equal(v.numero, '1')
  assert.equal(v.rotulo, 'CREDENCIAL')
  assert.equal(vistaDoCard({ ok: true, total: 0, alertas: 0, primeiros: [] }).rotulo, 'CREDENCIAIS')
})

test('CC: um alerta vira estado de alerta com a linha da regra', () => {
  assert.deepEqual(vistaDoCard({ ok: true, total: 4, alertas: 1, primeiros: [{ regra: 'vence', nome: 'correio/smtp' }] }),
    { estado: 'alerta', numero: '4', rotulo: 'CREDENCIAIS', detalhe: '1 alerta', erro: '', linhas: [{ nome: 'correio/smtp', regra: 'vence' }] })
})

test('CC: vários alertas mostram só as 2 primeiras linhas, com o rótulo de cada regra', () => {
  const v = vistaDoCard({ ok: true, total: 9, alertas: 4, primeiros: [
    { regra: 'sem-uso', nome: 'banco-teste/leitura' },
    { regra: 'teste-falhou', nome: 'fila/token-ingestao' },
    { regra: 'agente-nunca-usou', nome: 'relatorios/conta-servico' },
  ] })
  assert.equal(v.estado, 'alerta')
  assert.equal(v.detalhe, '4 alertas')
  assert.deepEqual(v.linhas, [{ nome: 'banco-teste/leitura', regra: 'sem uso' }, { nome: 'fila/token-ingestao', regra: 'teste falhou' }])
  assert.equal(vistaDoCard({ ok: true, total: 2, alertas: 1, primeiros: [{ regra: 'agente-nunca-usou', nome: 'a/b' }] }).linhas[0].regra, 'agente parado')
})

test('CC: regra que o card não conhece passa crua', () => {
  assert.deepEqual(vistaDoCard({ ok: true, total: 1, alertas: 1, primeiros: [{ regra: 'nova-regra', nome: 'x/y' }] }).linhas,
    [{ nome: 'x/y', regra: 'nova-regra' }])
})

test('CC: falha da mão vira estado de erro com o detalhe do código e o texto inteiro à parte', () => {
  assert.deepEqual(vistaDoCard({ ok: false, codigo: 'tempo', erro: 'o cofre não respondeu em 20 s' }),
    { estado: 'erro', numero: '–', rotulo: 'CREDENCIAIS', detalhe: 'sem resposta', erro: 'o cofre não respondeu em 20 s', linhas: [] })
  assert.equal(vistaDoCard({ ok: false, codigo: 'sem-node', erro: 'x' }).detalhe, 'sem Node')
  assert.equal(vistaDoCard({ ok: false, codigo: 'ilegivel', erro: 'x' }).detalhe, 'resposta ilegível')
})

test('CC: código que o card não conhece, ou resposta nula, vira "sem leitura"', () => {
  const v = vistaDoCard({ ok: false, codigo: 'novo-codigo' })
  assert.equal(v.estado, 'erro')
  assert.equal(v.detalhe, 'sem leitura')
  assert.equal(v.erro, '')
  const n = vistaDoCard(null)
  assert.equal(n.estado, 'erro')
  assert.equal(n.detalhe, 'sem leitura')
  assert.deepEqual(n.linhas, [])
})
