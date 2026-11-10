// Plano 4c, T6: a máquina de telas da janela "Parear WhatsApp". Pura: recebe o estado e um evento (do
// pareador ou do clique) e devolve o estado seguinte, com o efeito que a janela deve pedir ao main.
// Regra do §4.1: o papel do número aparece antes do QR, e o QR só depois do clique em "mostrar o QR".
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { inicial, aplicar, textoDoMotivo } = require('../apps/omni-ilha/pareamento-telas.js')

const QR = 'data:image/png;base64,iVBORw0KGgo='
const rodar = (...eventos) => eventos.reduce((est, e) => aplicar(est, e), inicial())

test('começa apresentando o SEU número, sem QR e sem processo', () => {
  const est = inicial()
  assert.equal(est.tela, 'apresentar-pessoal')
  assert.equal(est.qr, null)
  assert.equal(est.efeito, null)
})

test('"mostrar o QR" leva ao QR do pessoal e pede o passo pessoal', () => {
  const est = rodar({ clique: 'mostrar-qr' })
  assert.equal(est.tela, 'qr-pessoal')
  assert.deepEqual(est.efeito, { passo: 'pessoal' })
  assert.equal(est.qr, null, 'o QR só chega pelo pareador')
})

test('QR do pareador só aparece na tela de QR do mesmo papel', () => {
  assert.equal(rodar({ evento: 'qr', papel: 'pessoal', qr: QR }).qr, null, 'antes do clique o QR não entra')
  assert.equal(rodar({ clique: 'mostrar-qr' }, { evento: 'qr', papel: 'bot', qr: QR }).qr, null)
  assert.equal(rodar({ clique: 'mostrar-qr' }, { evento: 'qr', papel: 'pessoal', qr: QR }).qr, QR)
})

test('pessoal pareado → apresenta o número do Omni, sem QR e sem pedir passo', () => {
  const est = rodar({ clique: 'mostrar-qr' }, { evento: 'qr', papel: 'pessoal', qr: QR },
    { evento: 'pareado', papel: 'pessoal', fone4: '1234' }, { evento: 'fim', papel: 'pessoal', ok: true })
  assert.equal(est.tela, 'apresentar-bot')
  assert.equal(est.qr, null)
  assert.equal(est.efeito, null)
  assert.equal(est.fone4.pessoal, '1234')
})

test('no bot, "mostrar o QR" pede o passo bot; bot pareado vai a provando e pede o fechar', () => {
  let est = rodar({ clique: 'mostrar-qr' }, { evento: 'fim', papel: 'pessoal', ok: true }, { clique: 'mostrar-qr' })
  assert.equal(est.tela, 'qr-bot')
  assert.deepEqual(est.efeito, { passo: 'bot' })
  est = aplicar(est, { evento: 'qr', papel: 'bot', qr: QR })
  assert.equal(est.qr, QR)
  est = aplicar(aplicar(est, { evento: 'pareado', papel: 'bot', fone4: '5678' }), { evento: 'fim', papel: 'bot', ok: true })
  assert.equal(est.tela, 'provando')
  assert.deepEqual(est.efeito, { passo: 'fechar' })
  assert.equal(est.qr, null)
})

test('fechar provado → pronto com os dois finais e as recusas', () => {
  const est = rodar({ clique: 'mostrar-qr' }, { evento: 'pareado', papel: 'pessoal', fone4: '1234' }, { evento: 'fim', papel: 'pessoal', ok: true },
    { clique: 'mostrar-qr' }, { evento: 'pareado', papel: 'bot', fone4: '5678' }, { evento: 'fim', papel: 'bot', ok: true },
    { evento: 'fechado', papel: 'fechar', soLeitura: { ok: true, recusas: 5, falhas: [] } }, { evento: 'fim', papel: 'fechar', ok: true })
  assert.equal(est.tela, 'pronto')
  assert.deepEqual(est.fone4, { pessoal: '1234', bot: '5678' })
  assert.equal(est.soLeitura.recusas, 5)
})

test('fim ok do fechar sem soLeitura ok não vira pronto', () => {
  const est = rodar({ evento: 'fechado', papel: 'fechar', soLeitura: { ok: false, recusas: 4, falhas: ['x'] } }, { evento: 'fim', papel: 'fechar', ok: true })
  assert.equal(est.tela, 'erro')
  assert.equal(est.motivo, 'nao-provado')
})

test('fim sem sucesso → erro com motivo, detalhe e o papel para tentar de novo', () => {
  const est = rodar({ clique: 'mostrar-qr' }, { evento: 'fim', papel: 'pessoal', ok: true }, { clique: 'mostrar-qr' },
    { evento: 'qr', papel: 'bot', qr: QR }, { evento: 'fim', papel: 'bot', ok: false, motivo: 'mesmo-numero' })
  assert.equal(est.tela, 'erro')
  assert.equal(est.motivo, 'mesmo-numero')
  assert.equal(est.papelErro, 'bot')
  assert.equal(est.qr, null)
  assert.match(textoDoMotivo(est.motivo), /celular do número do Omni/)
})

test('"tentar de novo" volta à apresentação do papel que falhou; o fechar volta direto a provando', () => {
  const doBot = aplicar(rodar({ evento: 'fim', papel: 'bot', ok: false, motivo: 'prazo' }), { clique: 'tentar' })
  assert.equal(doBot.tela, 'apresentar-bot')
  assert.equal(doBot.efeito, null)
  assert.equal(doBot.motivo, null)
  const doPessoal = aplicar(rodar({ evento: 'fim', papel: 'pessoal', ok: false, motivo: 'prazo' }), { clique: 'tentar' })
  assert.equal(doPessoal.tela, 'apresentar-pessoal')
  const doFechar = aplicar(rodar({ evento: 'fim', papel: 'fechar', ok: false, motivo: 'chaves', detalhe: 'criar x: HTTP 500' }), { clique: 'tentar' })
  assert.equal(doFechar.tela, 'provando')
  assert.deepEqual(doFechar.efeito, { passo: 'fechar' })
})

test('o efeito vale uma vez: o evento seguinte limpa', () => {
  const est = aplicar(rodar({ clique: 'mostrar-qr' }), { evento: 'estado', papel: 'pessoal', estado: 'qr_ready' })
  assert.equal(est.efeito, null)
  assert.equal(est.estadoSessao, 'qr_ready')
})

test('"voltar" no QR volta à apresentação do mesmo papel, sem QR e sem pedir passo', () => {
  const doPessoal = rodar({ clique: 'mostrar-qr' }, { evento: 'qr', papel: 'pessoal', qr: QR }, { clique: 'voltar' })
  assert.equal(doPessoal.tela, 'apresentar-pessoal')
  assert.equal(doPessoal.qr, null)
  assert.equal(doPessoal.efeito, null)
  const doBot = rodar({ evento: 'fim', papel: 'pessoal', ok: true }, { clique: 'mostrar-qr' }, { evento: 'qr', papel: 'bot', qr: QR }, { clique: 'voltar' })
  assert.equal(doBot.tela, 'apresentar-bot')
  assert.equal(doBot.qr, null)
  assert.equal(rodar({ clique: 'voltar' }).tela, 'apresentar-pessoal', 'fora do QR o voltar não faz nada')
})

test('clique fora de lugar não muda nada', () => {
  const est = rodar({ clique: 'tentar' })
  assert.equal(est.tela, 'apresentar-pessoal')
  assert.equal(rodar({ clique: 'mostrar-qr' }, { clique: 'mostrar-qr' }).efeito, null, 'segundo clique não pede outro processo')
})

test('textos dos motivos: conhecidos em português, desconhecido não some', () => {
  assert.match(textoDoMotivo('nao-provado'), /não consegui provar que o seu número é só leitura/i)
  assert.match(textoDoMotivo('servico-fora'), /serviço do WhatsApp/)
  assert.match(textoDoMotivo('sem-node'), /Node/)
  assert.match(textoDoMotivo('xyz'), /xyz/)
})
