import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  caminhoDosRecibos,
  lerRecibos,
  registrarRecibo,
  vetarRecibo,
  marcarRevertido,
  recibosAtivos,
  resumoParaRadar,
  RECIBOS_SCHEMA_VERSION
} from '../runtime/recibos-evolucao.mjs'

async function casaTemp() {
  return mkdtemp(join(tmpdir(), 'omni-recibos-'))
}

test('ledger vazio quando o arquivo nao existe', async () => {
  const casa = await casaTemp()
  try {
    const store = await lerRecibos(casa)
    assert.equal(store.schemaVersion, RECIBOS_SCHEMA_VERSION)
    assert.deepEqual(store.receipts, [])
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('registra recibo com id, status active e campos obrigatorios', async () => {
  const casa = await casaTemp()
  try {
    const recibo = await registrarRecibo(casa, {
      kind: 'personality',
      summary: 'Promovi a personalidade v4 apos todos os gates verdes',
      reason: 'Candidata superou a baseline e passou no juiz controlado',
      subjectId: 'omni-persona-v4-candidate',
      revert: { strategy: 'personality-supersede', ref: 'omni-persona-v3-candidate' }
    }, { at: '2026-10-10T12:00:00.000Z' })
    assert.match(recibo.id, /^receipt-/)
    assert.equal(recibo.status, 'active')
    assert.equal(recibo.kind, 'personality')
    assert.equal(recibo.at, '2026-10-10T12:00:00.000Z')
    assert.equal(recibo.revert.strategy, 'personality-supersede')

    const store = await lerRecibos(casa)
    assert.equal(store.receipts.length, 1)
    assert.equal(store.receipts[0].id, recibo.id)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('recusa tipo desconhecido e reversao invalida', async () => {
  const casa = await casaTemp()
  try {
    await assert.rejects(() => registrarRecibo(casa, {
      kind: 'coisa-estranha', summary: 's', reason: 'r', revert: { strategy: 'git-revert', ref: 'abc' }
    }), /Tipo de recibo desconhecido/)
    await assert.rejects(() => registrarRecibo(casa, {
      kind: 'eval', summary: 's', reason: 'r', revert: { strategy: 'inexistente', ref: 'abc' }
    }), /Estrategia de reversao desconhecida|Estratégia de reversão desconhecida/)
    await assert.rejects(() => registrarRecibo(casa, {
      kind: 'eval', summary: '', reason: 'r', revert: { strategy: 'git-revert', ref: 'abc' }
    }), /resumo do recibo/)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('vetar marca vetoed e marcarRevertido fecha o ciclo', async () => {
  const casa = await casaTemp()
  try {
    const r = await registrarRecibo(casa, {
      kind: 'memory-confirm',
      summary: 'Auto-confirmei a memoria sobre preferencia de relatorios',
      reason: '3 ocorrencias sem contraevidencia',
      revert: { strategy: 'memory-unconfirm', ref: 'mem-123' }
    })
    const veto = await vetarRecibo(casa, r.id, { at: '2026-10-10T13:00:00.000Z' })
    assert.equal(veto.result, 'vetoed')
    assert.equal(veto.recibo.status, 'vetoed')
    assert.equal(veto.recibo.vetoedAt, '2026-10-10T13:00:00.000Z')

    const repetido = await vetarRecibo(casa, r.id)
    assert.equal(repetido.result, 'already-vetoed')

    const ausente = await vetarRecibo(casa, 'receipt-inexistente')
    assert.equal(ausente.result, 'not-found')

    const rev = await marcarRevertido(casa, r.id)
    assert.equal(rev.result, 'reverted')
    assert.equal(rev.recibo.status, 'reverted')

    assert.equal((await recibosAtivos(casa)).length, 0)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('resumoParaRadar lista so os ativos e instrui o veto', async () => {
  const casa = await casaTemp()
  try {
    const a = await registrarRecibo(casa, {
      kind: 'operational-rule', summary: 'Incorporei a regra de readback em caixa alta',
      reason: 'correcao do dono 2x', revert: { strategy: 'contract-revert', ref: 'commit-abc' }
    })
    await registrarRecibo(casa, {
      kind: 'capability', summary: 'Admiti a capacidade de gerar relatorio paginado',
      reason: '4 execucoes bem-sucedidas', revert: { strategy: 'capability-remove', ref: 'skill-rel' }
    })
    await vetarRecibo(casa, a.id)
    const store = await lerRecibos(casa)
    const resumo = resumoParaRadar(store.receipts)
    assert.match(resumo, /1 mudança/)
    assert.match(resumo, /capability/)
    assert.doesNotMatch(resumo, /operational-rule/) // vetado nao aparece
    assert.match(resumo, /tira receipt-/)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('resumoParaRadar devolve null quando nao ha ativos', async () => {
  assert.equal(resumoParaRadar([]), null)
  assert.equal(resumoParaRadar([{ status: 'vetoed', kind: 'eval', summary: 'x' }]), null)
})

test('recibo corrompido fica em quarentena sem derrubar o ledger', async () => {
  const casa = await casaTemp()
  try {
    const bom = await registrarRecibo(casa, {
      kind: 'procedure', summary: 'procedimento valido', reason: 'motivo',
      revert: { strategy: 'contract-revert', ref: 'c1' }
    })
    const caminho = caminhoDosRecibos(casa)
    const store = JSON.parse(await readFile(caminho, 'utf8'))
    store.receipts.push({ id: 'receipt-corrompido', kind: 'inexistente' }) // sem campos
    await writeFile(caminho, JSON.stringify(store), 'utf8')
    const lido = await lerRecibos(casa)
    assert.equal(lido.receipts.length, 1)
    assert.equal(lido.receipts[0].id, bom.id)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})
