import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { comBancoDaCasa, sha256, transacao } from '../runtime/casa/banco.mjs'
import {
  contarMemoriaNoBanco,
  gravarMemoriaNoBanco,
  lerMemoriaDoBanco,
  shaDaMemoriaNoBanco,
  textoDaMemoria
} from '../runtime/casa/loja-memoria.mjs'

function registro(id, texto, extra = {}) {
  return { id, type: 'preference', text: texto, status: 'confirmed', ...extra }
}

function documento({ confirmed = [], candidates = [], archive = [] } = {}) {
  return {
    schemaVersion: 4,
    store: { id: 'omni-local-memory', createdAt: '2026-11-04T00:00:00.000Z', updatedAt: '2026-11-04T00:00:00.000Z' },
    confirmed,
    candidates,
    archive
  }
}

function comOmni(uso) {
  const casa = mkdtempSync(join(tmpdir(), 'omni-casa-memoria-'))
  try {
    return comBancoDaCasa(casa, 'omni', uso)
  } finally {
    rmSync(casa, { recursive: true, force: true })
  }
}

const gravar = (db, memoria, opcoes) => transacao(db, () => gravarMemoriaNoBanco(db, memoria, opcoes))
const linha = (db, id) => db.prepare('SELECT * FROM memorias WHERE id = ?').get(id)
const diario = (db) => db.prepare('SELECT linha, operacao, versao FROM _diario ORDER BY seq').all()
  .map((anotacao) => `${anotacao.linha}:${anotacao.operacao}:${anotacao.versao}`)
const nada = { inseridas: 0, alteradas: 0, reordenadas: 0, apagadas: 0 }

test('banco sem memoria devolve null, hash nulo e contagem zerada', () => {
  comOmni((db) => {
    assert.equal(lerMemoriaDoBanco(db), null)
    assert.equal(shaDaMemoriaNoBanco(db), null)
    assert.deepEqual(contarMemoriaNoBanco(db), { confirmed: 0, candidates: 0, archive: 0 })
  })
})

test('ida e volta devolve o mesmo texto byte a byte, inclusive a ordem das chaves', () => {
  const memoria = {
    candidates: [registro('c1', 'candidata com acento: ação e emoji 🚀')],
    schemaVersion: 4,
    confirmed: [
      registro('m1', 'primeira'),
      { type: 'fact', text: 'sem id' },
      registro('m2', 'segunda', { evidence: [{ kind: 'x', recordedAt: '2026-11-04T00:00:00.000Z' }], usageCount: 3, nada: null })
    ],
    store: { id: 'omni-local-memory', aninhado: { b: 1, a: [1, 2, { z: null }] } },
    archive: [{ id: 'arc-1', memoryId: 'm0', action: 'superseded', snapshot: { id: 'm0', type: 'fact', text: 'antiga' } }],
    extra: 'campo desconhecido preservado'
  }
  comOmni((db) => {
    const texto = textoDaMemoria(memoria)
    const gravado = gravar(db, memoria)
    assert.equal(gravado.texto, texto)
    assert.equal(gravado.sha, sha256(texto))
    assert.deepEqual(gravado.contagens, { ...nada, inseridas: 5 })
    assert.equal(shaDaMemoriaNoBanco(db), sha256(texto))
    const lida = lerMemoriaDoBanco(db)
    assert.equal(textoDaMemoria(lida), texto)
    assert.deepEqual(Object.keys(lida), ['candidates', 'schemaVersion', 'confirmed', 'store', 'archive', 'extra'])
    assert.deepEqual(contarMemoriaNoBanco(db), { confirmed: 3, candidates: 1, archive: 1 })
  })
})

test('colunas de busca saem do registro e, no arquivo morto, do snapshot', () => {
  const memoria = documento({
    confirmed: [registro('m1', 'texto um')],
    archive: [{ id: 'arc-1', memoryId: 'm0', snapshot: { type: 'fact', text: 'antiga' } }]
  })
  comOmni((db) => {
    gravar(db, memoria, { maquina: 'pc-teste', agora: '2026-11-04T10:00:00.000Z' })
    const m1 = linha(db, 'm1')
    assert.deepEqual(
      [m1.raia, m1.ordem, m1.tipo, m1.texto, m1.origem_maquina, m1.criado_em, m1.atualizado_em, m1.versao, m1.apagado_em],
      ['confirmed', 0, 'preference', 'texto um', 'pc-teste', '2026-11-04T10:00:00.000Z', '2026-11-04T10:00:00.000Z', 1, null]
    )
    assert.equal(m1.corpo, JSON.stringify(memoria.confirmed[0]))
    const arquivado = linha(db, 'arc-1')
    assert.deepEqual([arquivado.raia, arquivado.tipo, arquivado.texto], ['archive', 'fact', 'antiga'])
  })
})

test('mudanca de conteudo sobe a versao; mudanca so de ordem nao sobe e nao vai ao diario', () => {
  comOmni((db) => {
    gravar(db, documento({ confirmed: [registro('a', 'A'), registro('b', 'B')] }))
    const reordenado = gravar(db, documento({ confirmed: [registro('b', 'B'), registro('a', 'A')] }))
    assert.deepEqual(reordenado.contagens, { ...nada, reordenadas: 2 })
    assert.deepEqual([linha(db, 'a').ordem, linha(db, 'a').versao], [1, 1])
    assert.deepEqual(lerMemoriaDoBanco(db).confirmed.map((r) => r.id), ['b', 'a'])
    assert.deepEqual(diario(db), ['a:I:1', 'b:I:1'])

    const mudado = gravar(db, documento({ confirmed: [registro('b', 'B'), registro('a', 'A editado')] }))
    assert.deepEqual(mudado.contagens, { ...nada, alteradas: 1 })
    assert.deepEqual([linha(db, 'a').versao, linha(db, 'a').texto], [2, 'A editado'])
    assert.deepEqual(diario(db), ['a:I:1', 'b:I:1', 'a:U:2'])

    assert.deepEqual(gravar(db, documento({ confirmed: [registro('b', 'B'), registro('a', 'A editado')] })).contagens, nada)
    assert.deepEqual(diario(db), ['a:I:1', 'b:I:1', 'a:U:2'])
  })
})

test('registro que sai vira lapide, volta ressuscitado e a lapide nao e reenterrada', () => {
  comOmni((db) => {
    gravar(db, documento({ confirmed: [registro('a', 'A'), registro('b', 'B')] }))
    const saiu = gravar(db, documento({ confirmed: [registro('a', 'A')] }), { agora: '2026-11-04T11:00:00.000Z', maquina: 'pc-2' })
    assert.deepEqual(saiu.contagens, { ...nada, apagadas: 1 })
    assert.deepEqual(
      [linha(db, 'b').apagado_em, linha(db, 'b').versao, linha(db, 'b').origem_maquina],
      ['2026-11-04T11:00:00.000Z', 2, 'pc-2']
    )
    assert.deepEqual(lerMemoriaDoBanco(db).confirmed.map((r) => r.id), ['a'])
    assert.deepEqual(contarMemoriaNoBanco(db), { confirmed: 1, candidates: 0, archive: 0 })

    const voltou = gravar(db, documento({ confirmed: [registro('a', 'A'), registro('b', 'B')] }))
    assert.deepEqual(voltou.contagens, { ...nada, alteradas: 1 })
    assert.deepEqual([linha(db, 'b').apagado_em, linha(db, 'b').versao], [null, 3])
    assert.deepEqual(lerMemoriaDoBanco(db).confirmed.map((r) => r.id), ['a', 'b'])

    gravar(db, documento({ confirmed: [registro('a', 'A')] }))
    assert.deepEqual(gravar(db, documento({ confirmed: [registro('a', 'A')] })).contagens, nada)
    assert.equal(linha(db, 'b').versao, 4)
    assert.deepEqual(diario(db), ['a:I:1', 'b:I:1', 'b:U:2', 'b:U:3', 'b:U:4'])
  })
})

test('promover candidata muda a raia na mesma linha', () => {
  comOmni((db) => {
    gravar(db, documento({ candidates: [registro('c1', 'talvez')] }))
    const promovida = gravar(db, documento({ confirmed: [registro('c1', 'talvez')] }))
    assert.deepEqual(promovida.contagens, { ...nada, alteradas: 1 })
    assert.deepEqual([linha(db, 'c1').raia, linha(db, 'c1').versao], ['confirmed', 2])
    assert.deepEqual(contarMemoriaNoBanco(db), { confirmed: 1, candidates: 0, archive: 0 })
  })
})

test('id repetido e registro sem id nao se perdem e ganham identidade estavel', () => {
  const semId = { type: 'fact', text: 'sem id' }
  const memoria = documento({
    confirmed: [registro('x', 'primeiro x'), registro('x', 'segundo x'), semId, { ...semId }],
    candidates: [registro('x', 'x nas candidatas')]
  })
  comOmni((db) => {
    gravar(db, memoria)
    assert.equal(textoDaMemoria(lerMemoriaDoBanco(db)), textoDaMemoria(memoria))
    assert.deepEqual(contarMemoriaNoBanco(db), { confirmed: 4, candidates: 1, archive: 0 })
    const ids = db.prepare('SELECT id FROM memorias ORDER BY id').all().map((l) => l.id)
    assert.deepEqual(ids, [`confirmed#${sha256(JSON.stringify(semId)).slice(0, 16)}`, 'confirmed#2', 'x', 'x#2', 'x#3'].sort())
    assert.deepEqual(gravar(db, memoria).contagens, nada)
  })
})

test('raia ausente continua ausente e raia que nao e lista e recusada sem gravar pela metade', () => {
  const semArquivoMorto = { schemaVersion: 4, confirmed: [registro('a', 'A')], candidates: [] }
  comOmni((db) => {
    gravar(db, semArquivoMorto)
    assert.equal(Object.hasOwn(lerMemoriaDoBanco(db), 'archive'), false)
    assert.equal(textoDaMemoria(lerMemoriaDoBanco(db)), textoDaMemoria(semArquivoMorto))
    assert.throws(() => gravar(db, { schemaVersion: 4, confirmed: [registro('b', 'B')], candidates: {} }), /Raia candidates da memória não é lista/)
    assert.equal(textoDaMemoria(lerMemoriaDoBanco(db)), textoDaMemoria(semArquivoMorto))
    assert.equal(linha(db, 'b'), undefined)
  })
})
