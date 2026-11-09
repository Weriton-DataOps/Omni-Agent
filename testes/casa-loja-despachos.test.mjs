import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { comBancoDaCasa } from '../runtime/casa/banco.mjs'
import { DespachoError, listarDespachos, registrarDespacho, validarDespacho } from '../runtime/casa/loja-despachos.mjs'

const EXECUCAO = '20261109-120000-abcd'

function comOmni(uso) {
  const casa = mkdtempSync(join(tmpdir(), 'omni-despachos-'))
  try {
    return comBancoDaCasa(casa, 'omni', uso)
  } finally {
    try { rmSync(casa, { recursive: true, force: true }) } catch { /* sobra temporária */ }
  }
}

test('o mesmo toque duas vezes vira um recibo só', () => {
  comOmni((db) => {
    const opcoes = { maquina: 'pc', agora: '2026-11-09T12:00:00.000Z' }
    assert.deepEqual(registrarDespacho(db, { agente: 'oraculo', execucao: EXECUCAO }, opcoes), { id: `oraculo/${EXECUCAO}`, novo: true })
    assert.deepEqual(registrarDespacho(db, { agente: 'oraculo', execucao: EXECUCAO, extra: 1 }, opcoes), { id: `oraculo/${EXECUCAO}`, novo: false })
    const lista = listarDespachos(db)
    assert.equal(lista.length, 1)
    assert.deepEqual(lista[0], {
      id: `oraculo/${EXECUCAO}`, agente: 'oraculo', execucao: EXECUCAO, estado: 'recebido', tentativas: 0, detalhe: null,
      recebido_em: '2026-11-09T12:00:00.000Z', atualizado_em: '2026-11-09T12:00:00.000Z'
    })
  })
})

test('agente e execucao fora do formato são recusados sem gravar', () => {
  const ruins = [
    null, [], 'texto', {},
    { agente: 'Oraculo', execucao: EXECUCAO },
    { agente: 'oraculo' },
    { agente: 'oraculo', execucao: 'a/b' },
    { agente: 'oraculo', execucao: '-comeca-com-hifen' },
    { agente: 'oraculo', execucao: 'x'.repeat(129) },
    { agente: 'a'.repeat(41), execucao: EXECUCAO },
    { agente: 'oraculo', execucao: 12 }
  ]
  for (const corpo of ruins) assert.throws(() => validarDespacho(corpo), DespachoError, JSON.stringify(corpo))
  comOmni((db) => {
    for (const corpo of ruins) assert.throws(() => registrarDespacho(db, corpo), DespachoError)
    assert.equal(db.prepare('SELECT count(*) AS n FROM despachos').get().n, 0)
  })
})

test('listar filtra por estado, recusa estado desconhecido e respeita o teto', () => {
  comOmni((db) => {
    for (const n of [1, 2, 3]) registrarDespacho(db, { agente: 'oraculo', execucao: `e${n}` }, { maquina: 'pc', agora: `2026-11-09T12:00:0${n}.000Z` })
    assert.deepEqual(listarDespachos(db, { limite: 2 }).map((d) => d.execucao), ['e1', 'e2'])
    assert.deepEqual(listarDespachos(db, { estado: 'assumido' }), [])
    assert.throws(() => listarDespachos(db, { estado: 'qualquer' }), DespachoError)
  })
})

test('o banco recusa id que não bate com agente e execução', () => {
  comOmni((db) => {
    assert.throws(() => db.prepare(`INSERT INTO despachos (id, agente, execucao, recebido_em, atualizado_em, origem_maquina)
      VALUES ('outro/x', 'oraculo', 'x', 't', 't', 'pc')`).run(), /CHECK/)
  })
})
