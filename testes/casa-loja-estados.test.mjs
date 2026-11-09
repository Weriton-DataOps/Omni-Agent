import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { comBancoDaCasa, sha256 } from '../runtime/casa/banco.mjs'
import {
  CATALOGO,
  baseNoDisco,
  confirmarEstadoNoDisco,
  contarEstado,
  decompor,
  docCanonico,
  gravarEstado,
  importarEstado,
  linhasDe,
  planejarOrdem,
  recomporEstado,
  shaDoEstado
} from '../runtime/casa/loja-estados.mjs'

const REL = 'learning/self-improvement.json'
const canonico = (doc) => `${JSON.stringify(doc, null, 2)}\n`
const idDe = (chave, colecao = 'proposals', rel = REL) => `${rel}|${colecao}|${chave}`
const ultimaDoDiario = (db) => db.prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM _diario').get().n
const diarioDesde = (db, marca) => db.prepare('SELECT tabela, linha, operacao FROM _diario WHERE seq > ? ORDER BY seq').all(marca)
  .map((linha) => `${linha.tabela}:${linha.linha}:${linha.operacao}`)
const versoes = (db, rel = REL) => Object.fromEntries(db.prepare('SELECT id, versao FROM estado_registros WHERE arquivo = ?').all(rel)
  .map((linha) => [linha.id.split('|').at(-1), linha.versao]))

// Casa temporária com o banco dentro dela; env vazio para nenhum OMNI_CASA_BANCO do ambiente
// desviar o banco para fora.
function comCasa(uso) {
  const casa = mkdtempSync(join(tmpdir(), 'omni-loja-estados-'))
  try {
    return comBancoDaCasa(casa, 'omni', uso, {})
  } finally {
    rmSync(casa, { recursive: true, force: true })
  }
}

test('decompor troca colecoes por [] e o relogio por null, sem mexer na entrada', () => {
  const doc = { schemaVersion: 1, store: { createdAt: 'c', updatedAt: 'u' }, proposals: [{ id: 'p1' }], meta: { n: 1 } }
  const antes = JSON.stringify(doc)
  const { esqueleto, relogio, colecoes } = decompor(doc)
  assert.equal(esqueleto, JSON.stringify({ schemaVersion: 1, store: { createdAt: 'c', updatedAt: null }, proposals: [], meta: { n: 1 } }))
  assert.equal(relogio, 'u')
  assert.deepEqual(colecoes, [['proposals', [{ id: 'p1' }]]])
  assert.equal(JSON.stringify(doc), antes)
  assert.equal(decompor({ schemaVersion: 1 }).relogio, null)
  assert.equal(decompor({ schemaVersion: 1, store: { updatedAt: null } }).relogio, null)
  assert.throws(() => decompor([]), /objeto JSON/)
  assert.throws(() => decompor(null), /objeto JSON/)
  assert.throws(() => decompor({ 'a|b': [] }), /\|/)
})

test('linhasDe tira a chave do campo do catalogo, do id, do texto ou do hash, sem repetir', () => {
  const chaves = (itens, campo) => linhasDe(itens, campo).map((linha) => linha.chave)
  const hash = (corpo) => `h:${sha256(corpo).slice(0, 32)}`
  assert.deepEqual(chaves([{ sessionFingerprint: 's1', id: 'i1' }, { id: 'i2' }], 'sessionFingerprint'), ['s1', 'i2'])
  assert.deepEqual(chaves([{ id: 'i1' }, 'texto', 7, null, { sem: 'id' }]), ['i1', 'texto', hash('7'), hash('null'), hash('{"sem":"id"}')])
  assert.deepEqual(chaves(['x', 'x', 'x#1']), ['x', 'x#1', 'x#1#1'])
  const longo = 'y'.repeat(201)
  assert.deepEqual(chaves([longo, 'y'.repeat(200)]), [hash(JSON.stringify(longo)), 'y'.repeat(200)])
  assert.equal(linhasDe([{ id: 'i1', v: [1, 'á'] }])[0].corpo, '{"id":"i1","v":[1,"á"]}')
})

test('planejarOrdem mantem a ordem enquanto ela cresce e manda o resto para o fim', () => {
  const u = undefined
  assert.deepEqual(planejarOrdem([0, 1, 2, u]), [0, 1, 2, 3])
  assert.deepEqual(planejarOrdem([0, 2, 3, 1]), [0, 2, 3, 4])
  assert.deepEqual(planejarOrdem([0, u, 1, 2]), [0, 3, 4, 5])
  assert.deepEqual(planejarOrdem([1, 2, 3]), [1, 2, 3])
  assert.deepEqual(planejarOrdem([u, u, u]), [0, 1, 2])
  assert.deepEqual(planejarOrdem([]), [])
})

test('gravar e recompor devolvem o mesmo texto, byte a byte', () => comCasa((db) => {
  const doc = JSON.parse('{"schemaVersion":1,"store":{"createdAt":"c","updatedAt":"u"},"proposals":[{"id":"p1","texto":"ação ✓ 🚀","passos":[{"a":[1,2]}]},{"id":"p2"}],"vazia":[],"tags":["x","x"],"__proto__":{"y":1},"aninhado":{"lista":[1,2],"__proto__":[3]}}')
  const texto = canonico(doc)
  gravarEstado(db, REL, texto)
  assert.equal(recomporEstado(db, REL), texto)
  assert.equal(shaDoEstado(db, REL), sha256(texto))
  assert.deepEqual(contarEstado(db, REL), { proposals: 2, vazia: 0, tags: 2 })
}))

test('mudar so o relogio troca hash e relogio sem subir versao nem escrever no diario', () => comCasa((db) => {
  const doc = { schemaVersion: 1, store: { updatedAt: 't0' }, proposals: [{ id: 'p1' }] }
  gravarEstado(db, REL, canonico(doc))
  const marca = ultimaDoDiario(db)
  const depois = { ...doc, store: { updatedAt: 't1' } }
  gravarEstado(db, REL, canonico(depois))
  assert.deepEqual(diarioDesde(db, marca), [])
  const linha = db.prepare('SELECT versao, relogio, texto_sha256 FROM estados WHERE id = ?').get(REL)
  assert.deepEqual({ ...linha }, { versao: 1, relogio: 't1', texto_sha256: sha256(canonico(depois)) })
  assert.equal(recomporEstado(db, REL), canonico(depois))
}))

test('item mudado e item novo no fim viram U e I so dessas linhas', () => comCasa((db) => {
  gravarEstado(db, REL, canonico({ schemaVersion: 1, proposals: [{ id: 'p1' }, { id: 'p2' }] }))
  const marca = ultimaDoDiario(db)
  gravarEstado(db, REL, canonico({ schemaVersion: 1, proposals: [{ id: 'p1' }, { id: 'p2', v: 2 }, { id: 'p3' }] }))
  assert.deepEqual(diarioDesde(db, marca), [`estado_registros:${idDe('p2')}:U`, `estado_registros:${idDe('p3')}:I`])
  assert.deepEqual(versoes(db), { p1: 1, p2: 2, p3: 1 })
}))

test('item removido vira lapide: corpo e hash vazios, apagado_em e versao nova', () => comCasa((db) => {
  gravarEstado(db, REL, canonico({ schemaVersion: 1, proposals: [{ id: 'p1' }, { id: 'p2' }] }), { agora: 't0' })
  const marca = ultimaDoDiario(db)
  gravarEstado(db, REL, canonico({ schemaVersion: 1, proposals: [{ id: 'p2' }] }), { agora: 't1' })
  const lapide = db.prepare('SELECT corpo, sha256, apagado_em, atualizado_em, versao FROM estado_registros WHERE id = ?').get(idDe('p1'))
  assert.deepEqual({ ...lapide }, { corpo: '', sha256: '', apagado_em: 't1', atualizado_em: 't1', versao: 2 })
  assert.deepEqual(diarioDesde(db, marca), [`estado_registros:${idDe('p1')}:U`])
}))

test('item que volta ressuscita a lapide: criado_em fica, versao sobe e o corpo volta', () => comCasa((db) => {
  gravarEstado(db, REL, canonico({ schemaVersion: 1, proposals: [{ id: 'p1' }] }), { agora: 't0' })
  gravarEstado(db, REL, canonico({ schemaVersion: 1, proposals: [] }), { agora: 't1' })
  const marca = ultimaDoDiario(db)
  gravarEstado(db, REL, canonico({ schemaVersion: 1, proposals: [{ id: 'p1' }] }), { agora: 't2' })
  const linha = db.prepare('SELECT criado_em, atualizado_em, apagado_em, versao, corpo FROM estado_registros WHERE id = ?').get(idDe('p1'))
  assert.deepEqual({ ...linha }, { criado_em: 't0', atualizado_em: 't2', apagado_em: null, versao: 3, corpo: '{"id":"p1"}' })
  assert.deepEqual(diarioDesde(db, marca), [`estado_registros:${idDe('p1')}:U`])
}))

test('reordenar muda so quem saiu da ordem crescente', () => comCasa((db) => {
  gravarEstado(db, REL, canonico({ schemaVersion: 1, proposals: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }))
  const marca = ultimaDoDiario(db)
  const texto = canonico({ schemaVersion: 1, proposals: [{ id: 'a' }, { id: 'c' }, { id: 'b' }] })
  gravarEstado(db, REL, texto)
  assert.deepEqual(diarioDesde(db, marca), [`estado_registros:${idDe('b')}:U`])
  assert.equal(recomporEstado(db, REL), texto)
}))

test('o mesmo documento duas vezes nao escreve nada; chave nova no esqueleto sobe a versao do estado', () => comCasa((db) => {
  const doc = { schemaVersion: 1, proposals: [{ id: 'p1' }] }
  gravarEstado(db, REL, canonico(doc))
  const marca = ultimaDoDiario(db)
  gravarEstado(db, REL, canonico(doc))
  assert.deepEqual(diarioDesde(db, marca), [])
  gravarEstado(db, REL, canonico({ ...doc, policy: { limite: 3 } }))
  assert.deepEqual(diarioDesde(db, marca), [`estados:${REL}:U`])
  assert.equal(db.prepare('SELECT versao FROM estados WHERE id = ?').get(REL).versao, 2)
}))

test('importar guarda a forma canonica, anota a fonte original e confirma a base da maquina', () => comCasa((db) => {
  const fonte = '{"schemaVersion":1,"proposals":[{"id":"p1"},{"id":"p2"}],"vazia":[]}'
  const canonica = canonico(JSON.parse(fonte))
  assert.equal(importarEstado(db, REL, fonte, { maquina: 'pc-a', agora: 't9' }), 'importada')
  assert.equal(shaDoEstado(db, REL), sha256(canonica))
  assert.equal(baseNoDisco(db, REL, 'pc-a'), sha256(canonica))
  assert.equal(recomporEstado(db, REL), canonica)
  const anotadas = db.prepare('SELECT tipo, fonte, fonte_sha256, contagens, origem_maquina, feita_em FROM _importacoes').all()
    .map((linha) => ({ ...linha }))
  assert.deepEqual(anotadas, [{
    tipo: 'estados', fonte: REL, fonte_sha256: sha256(fonte), contagens: '{"proposals":2,"vazia":0}', origem_maquina: 'pc-a', feita_em: 't9'
  }])
  assert.equal(importarEstado(db, REL, fonte, { maquina: 'pc-a', agora: 't10' }), 'presente')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM _importacoes').get().n, 1)
}))

test('estado apagado some da leitura, e importar de novo o ressuscita', () => comCasa((db) => {
  const fonte = canonico({ schemaVersion: 1, proposals: [{ id: 'p1' }] })
  importarEstado(db, REL, fonte)
  db.prepare("UPDATE estados SET apagado_em = 't1', versao = versao + 1 WHERE id = ?").run(REL)
  assert.equal(shaDoEstado(db, REL), null)
  assert.throws(() => recomporEstado(db, REL), /não está no banco/)
  assert.equal(importarEstado(db, REL, fonte), 'importada')
  const linha = db.prepare('SELECT apagado_em, versao FROM estados WHERE id = ?').get(REL)
  assert.deepEqual({ ...linha }, { apagado_em: null, versao: 3 })
  assert.equal(recomporEstado(db, REL), fonte)
}))

test('gravar recusa texto fora da forma canonica e estado fora do catalogo, sem escrever nada', () => comCasa((db) => {
  assert.throws(() => gravarEstado(db, REL, '{"schemaVersion":1}'), /forma canônica/)
  assert.throws(() => docCanonico(REL, '{"schemaVersion":1}\n'), /forma canônica/)
  assert.throws(() => gravarEstado(db, 'learning/daily-scan.json', canonico({ schemaVersion: 1 })), /fora do catálogo/)
  assert.throws(() => gravarEstado(db, 'constructor', canonico({ schemaVersion: 1 })), /fora do catálogo/)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM estados').get().n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM _diario').get().n, 0)
  assert.equal(Object.keys(CATALOGO).length, 8)
}))

test('recompor recusa registro adulterado e registro de colecao que o esqueleto nao tem', () => comCasa((db) => {
  gravarEstado(db, REL, canonico({ schemaVersion: 1, proposals: [{ id: 'p1' }] }))
  const adulterar = db.prepare('UPDATE estado_registros SET corpo = ?, colecao = ? WHERE id = ?')
  adulterar.run('{"id":"p1","x":1}', 'proposals', idDe('p1'))
  assert.throws(() => recomporEstado(db, REL), /divergiu/)
  adulterar.run('{"id":"p1"}', 'fantasma', idDe('p1'))
  assert.throws(() => recomporEstado(db, REL), /coleção que o esqueleto não tem: fantasma/)
}))

test('a base e por maquina, exige o estado e nao vai ao diario', () => comCasa((db) => {
  gravarEstado(db, REL, canonico({ schemaVersion: 1, proposals: [] }))
  const marca = ultimaDoDiario(db)
  confirmarEstadoNoDisco(db, REL, 'sha-a', { maquina: 'pc-a', agora: 't1' })
  confirmarEstadoNoDisco(db, REL, 'sha-b', { maquina: 'pc-b', agora: 't1' })
  confirmarEstadoNoDisco(db, REL, 'sha-a2', { maquina: 'pc-a', agora: 't2' })
  assert.equal(baseNoDisco(db, REL, 'pc-a'), 'sha-a2')
  assert.equal(baseNoDisco(db, REL, 'pc-b'), 'sha-b')
  assert.equal(baseNoDisco(db, REL, 'pc-c'), null)
  assert.throws(() => confirmarEstadoNoDisco(db, 'learning/failures.json', 'x', { maquina: 'pc-a' }), /FOREIGN KEY/)
  assert.deepEqual(diarioDesde(db, marca), [])
}))

test('chave declarada no catalogo vira o id do registro', () => comCasa((db) => {
  const feedback = 'feedback/personality-feedback.json'
  const continuidade = 'feedback/personality-continuity.json'
  gravarEstado(db, feedback, canonico({ schemaVersion: 1, lastResponses: [{ sessionFingerprint: 's1', id: 'x' }] }))
  gravarEstado(db, continuidade, canonico({ schemaVersion: 1, observations: [{ fingerprint: 'f1', id: 'y' }] }))
  const ids = db.prepare('SELECT id FROM estado_registros ORDER BY id').all().map((linha) => linha.id)
  assert.deepEqual(ids, [idDe('f1', 'observations', continuidade), idDe('s1', 'lastResponses', feedback)])
}))
