import assert from 'node:assert/strict'
import test from 'node:test'

import { extrairPrazo, extrairProximaAcao } from '../runtime/tempo-linguagem.mjs'

// Quinta-feira, 24/09/2026, meio-dia local.
const AGORA = new Date(2026, 8, 24, 12, 0, 0)
const dia = (iso) => iso?.slice(0, 10)

test('data explicita DD/MM sem palavra-gatilho', () => {
  assert.equal(dia(extrairPrazo('fechar a proposta 30/09', AGORA)), '2026-09-30')
})

test('DD/MM/AAAA explicito', () => {
  assert.equal(dia(extrairPrazo('evento em 15/12/2026', AGORA)), '2026-12-15')
})

test('relativo exige gatilho de prazo', () => {
  assert.equal(dia(extrairPrazo('entregar amanha', AGORA)), '2026-09-25')
  assert.equal(dia(extrairPrazo('depois de amanha tem prazo', AGORA)), '2026-09-26')
  assert.equal(extrairPrazo('amanha eu acordo cedo', AGORA), null, 'sem cue nao captura')
})

test('em N dias/semanas com gatilho', () => {
  assert.equal(dia(extrairPrazo('prazo em 3 dias', AGORA)), '2026-09-27')
  assert.equal(dia(extrairPrazo('vence em 2 semanas', AGORA)), '2026-10-08')
})

test('dia do mes rola para o proximo mes se ja passou', () => {
  assert.equal(dia(extrairPrazo('ate o dia 30', AGORA)), '2026-09-30')
  assert.equal(dia(extrairPrazo('para o dia 3', AGORA)), '2026-10-03')
})

test('dia da semana pega a proxima ocorrencia', () => {
  // quinta e hoje; "sexta" = amanha (25); "quinta" = +7 (01/10)
  assert.equal(dia(extrairPrazo('entregar ate sexta', AGORA)), '2026-09-25')
  assert.equal(dia(extrairPrazo('prazo quinta', AGORA)), '2026-10-01')
})

test('texto sem prazo retorna null', () => {
  assert.equal(extrairPrazo('preciso revisar o painel', AGORA), null)
  assert.equal(extrairPrazo('', AGORA), null)
})

test('proxima acao declarada explicitamente', () => {
  assert.equal(extrairProximaAcao('o proximo passo e definir os criterios do auditor'), 'definir os criterios do auditor')
  assert.equal(extrairProximaAcao('falta testar a conexao com o banco. depois seguimos'), 'testar a conexao com o banco')
})

test('sem declaracao de proxima acao retorna null', () => {
  assert.equal(extrairProximaAcao('acho o assunto interessante'), null)
  assert.equal(extrairProximaAcao(''), null)
})
