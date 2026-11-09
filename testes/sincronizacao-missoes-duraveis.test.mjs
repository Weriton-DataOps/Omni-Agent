import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { comBancoDaCasa } from '../runtime/casa/banco.mjs'
import { gravarMissoes } from '../runtime/casa/loja-operacao.mjs'
import { lerCicloOperacional, observarEvento, proporMelhoriaOperacional } from '../runtime/ciclo-operacional.mjs'
import { montarContexto } from '../runtime/contexto.mjs'
import { sincronizarAprendizadoOperacional } from '../runtime/sincronizacao-aprendizado-operacional.mjs'
import { sincronizarMissoesDuraveis } from '../runtime/sincronizacao-missoes-duraveis.mjs'

// Casa temporária; o banco mora em <casa>\casa (env sem OMNI_CASA_BANCO).
async function comCasa(uso) {
  const casa = await mkdtemp(join(tmpdir(), 'omni-sync-missoes-'))
  const antes = process.env.OMNI_CASA_BANCO
  delete process.env.OMNI_CASA_BANCO
  try {
    return await uso(casa)
  } finally {
    if (antes !== undefined) process.env.OMNI_CASA_BANCO = antes
    await rm(casa, { recursive: true, force: true })
  }
}

const missoesNoBanco = (casa) => comBancoDaCasa(casa, 'omni', (db) =>
  db.prepare('SELECT id, objetivo, estado FROM missoes ORDER BY id').all().map((linha) => ({ ...linha })), {})

test('missões do ciclo local vão para o omni.db e o contexto lê de volta as ativas', async () => {
  await comCasa(async (casa) => {
    await observarEvento(casa, { eventType: 'user-prompt', sessionId: 'sessao-1', summary: 'plano 1 da F2', objective: 'fechar a F2 do Omni' }, { at: '2026-11-09T12:00:00.000Z' })
    const ciclo = await lerCicloOperacional(casa)
    const id = `mission-${ciclo.sessions[0].id.replace(/^session-/, '')}`

    const r = await sincronizarMissoesDuraveis(casa)
    assert.equal(r.result, 'synced')
    assert.equal(r.missions, 1)
    assert.deepEqual(missoesNoBanco(casa), [{ id, objetivo: 'fechar a F2 do Omni', estado: 'in-progress' }])

    const segunda = await sincronizarMissoesDuraveis(casa)
    assert.equal(segunda.duplicadas, 1)

    // Só o banco conhece esta missão, e ela é a mais recente: se o contexto a mostra, leu do banco.
    comBancoDaCasa(casa, 'omni', (db) => gravarMissoes(db, [{
      id: 'mission-so-no-banco', objective: 'objetivo que só o banco conhece', state: 'in-progress', priority: 70, payload: {},
      createdAt: '2026-11-09T12:30:00.000Z', updatedAt: '2026-11-09T13:00:00.000Z', closedAt: null
    }]), {})
    const contexto = await montarContexto(casa, { intent: 'qual o objetivo agora?' })
    assert.ok(JSON.stringify(contexto).includes('objetivo que só o banco conhece'), 'a missão ativa do banco chega ao contexto')
  })
})

test('missão podada do arquivo local é encerrada na sincronização', async () => {
  await comCasa(async (casa) => {
    await observarEvento(casa, { eventType: 'user-prompt', sessionId: 'sessao-viva', summary: 'passo', objective: 'objetivo vivo' }, { at: '2026-11-09T12:00:00.000Z' })
    comBancoDaCasa(casa, 'omni', (db) => gravarMissoes(db, [{
      id: 'mission-fantasma', objective: 'missão que o arquivo já podou', state: 'in-progress', priority: 70, payload: {},
      createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', closedAt: null
    }]), {})

    const r = await sincronizarMissoesDuraveis(casa)
    assert.equal(r.encerradas, 1)
    const fantasma = missoesNoBanco(casa).find((m) => m.id === 'mission-fantasma')
    assert.equal(fantasma.estado, 'cancelled')
  })
})

test('aprendizado: ciclo sem candidatos devolve empty e não abre o banco à toa', async () => {
  await comCasa(async (casa) => {
    assert.deepEqual(await sincronizarAprendizadoOperacional(casa), { result: 'empty', findings: 0 })
  })
})

test('aprendizado: candidato do ciclo vira achado no omni.db, só com impressões', async () => {
  await comCasa(async (casa) => {
    const statement = 'Conferir evidência da etapa e preservar efeitos existentes antes de repetir a execução.'
    const { candidate } = await proporMelhoriaOperacional(casa, { category: 'owner-correction', destination: 'procedure', statement })
    const r = await sincronizarAprendizadoOperacional(casa)
    assert.equal(r.result, 'synced')
    assert.equal(r.registrados, 1)
    const linha = comBancoDaCasa(casa, 'omni', (db) => ({ ...db.prepare('SELECT * FROM aprendizado_achados WHERE id = ?').get(candidate.id) }), {})
    assert.equal(linha.destino, 'procedure')
    assert.ok(!JSON.stringify(linha).includes(statement), 'o enunciado não entra no banco, só a impressão')
    assert.equal((await sincronizarAprendizadoOperacional(casa)).duplicados, 1)
  })
})
