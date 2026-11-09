// Loja dos documentos .md no omni.db (plano 2 da F1): formato do id, ciclo de gravação com
// versão e lápide, e a base comum por máquina (_documentos_no_disco) do merge de três vias.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { comBancoDaCasa, sha256 } from '../runtime/casa/banco.mjs'
import {
  PREFIXO,
  apagarDocumento,
  confirmadosNoDisco,
  confirmarNoDisco,
  conteudoDoDocumento,
  documentosNoBanco,
  esquecerNoDisco,
  gravarDocumento,
  idDoDocumento,
  partesDoId,
  registrarImportacaoDeDocumentos
} from '../runtime/casa/loja-documentos.mjs'

// Banco novo numa casa temporária; o uso é síncrono, como o de comBancoDaCasa.
function comCasa(uso) {
  const casa = mkdtempSync(join(tmpdir(), 'omni-loja-documentos-'))
  try {
    return comBancoDaCasa(casa, 'omni', uso)
  } finally {
    try {
      rmSync(casa, { recursive: true, force: true })
    } catch {
      // Sobra pasta temporária; o teste que importa já disse o motivo.
    }
  }
}

const ID = 'claude-projects/proj/memory/a.md'

function linhaDoDocumento(db, id = ID) {
  const linha = db.prepare(`SELECT formato, conteudo, sha256, bytes, versao, origem_maquina, criado_em, atualizado_em, apagado_em
    FROM documentos WHERE id = ?`).get(id)
  return linha ? { ...linha } : null
}

test('id do documento so aceita <projeto>/memory/<nome>.md com segmentos seguros', () => {
  assert.equal(PREFIXO, 'claude-projects')
  assert.equal(idDoDocumento('proj', 'a.md'), 'claude-projects/proj/memory/a.md')
  assert.equal(
    idDoDocumento('c--Users-x-Documents-Omni', 'nota com espaco.md'),
    'claude-projects/c--Users-x-Documents-Omni/memory/nota com espaco.md'
  )
  const invalidos = [
    ['', 'a.md'], ['.', 'a.md'], ['..', 'a.md'], ['p/q', 'a.md'], ['p\\q', 'a.md'], ['C:', 'a.md'], ['p\0', 'a.md'],
    ['proj', 'a.txt'], ['proj', '.a.md'], ['proj', '.md'], ['proj', 'x/a.md'], ['proj', 'a\\..\\b.md'],
    ['proj', 'C:a.md'], ['proj', 'a\0.md'], [undefined, 'a.md'], ['proj', undefined], ['proj', 42]
  ]
  for (const [projeto, nome] of invalidos) {
    assert.equal(idDoDocumento(projeto, nome), null, `${JSON.stringify(projeto)} | ${JSON.stringify(nome)}`)
  }
})

test('partesDoId devolve projeto e nome so para id bem formado', () => {
  assert.deepEqual(partesDoId('claude-projects/proj/memory/a.md'), { projeto: 'proj', nome: 'a.md' })
  const invalidos = [
    'claude-projects/proj/memory/sub/a.md',
    'outro/proj/memory/a.md',
    'claude-projects/proj/memoria/a.md',
    'claude-projects/../memory/a.md',
    'claude-projects/proj/memory/a\\..\\..\\b.md',
    'claude-projects//memory/a.md',
    'CLAUDE-PROJECTS/proj/memory/a.md',
    'claude-projects/proj/memory/a.txt',
    'claude-projects/proj/memory/C:a.md',
    42,
    null,
    undefined
  ]
  for (const id of invalidos) assert.equal(partesDoId(id), null, JSON.stringify(id))
})

test('gravar, repetir, alterar, apagar e ressuscitar sobem a versao e anotam o diario', () => {
  comCasa((db) => {
    const v1 = { id: ID, conteudo: 'um', sha: sha256('um'), bytes: 2 }
    const v2 = { id: ID, conteudo: 'dois ç', sha: sha256('dois ç'), bytes: 7 }
    assert.equal(gravarDocumento(db, v1, { maquina: 'pc-a', agora: 't0' }), 'novo')
    assert.deepEqual(linhaDoDocumento(db), {
      formato: 'md', conteudo: 'um', sha256: sha256('um'), bytes: 2, versao: 1,
      origem_maquina: 'pc-a', criado_em: 't0', atualizado_em: 't0', apagado_em: null
    })
    // O mesmo hash não é mudança: nem versão nova, nem carimbo de outra máquina.
    assert.equal(gravarDocumento(db, v1, { maquina: 'pc-b', agora: 't1' }), 'igual')
    assert.equal(linhaDoDocumento(db).versao, 1)
    assert.equal(linhaDoDocumento(db).origem_maquina, 'pc-a')
    assert.equal(gravarDocumento(db, v2, { maquina: 'pc-b', agora: 't2' }), 'alterado')
    assert.deepEqual(linhaDoDocumento(db), {
      formato: 'md', conteudo: 'dois ç', sha256: sha256('dois ç'), bytes: 7, versao: 2,
      origem_maquina: 'pc-b', criado_em: 't0', atualizado_em: 't2', apagado_em: null
    })
    // A lápide guarda o conteúdo: apagar é marcar, e só a primeira vez conta.
    assert.equal(apagarDocumento(db, ID, { maquina: 'pc-a', agora: 't3' }), true)
    assert.deepEqual(linhaDoDocumento(db), {
      formato: 'md', conteudo: 'dois ç', sha256: sha256('dois ç'), bytes: 7, versao: 3,
      origem_maquina: 'pc-a', criado_em: 't0', atualizado_em: 't3', apagado_em: 't3'
    })
    assert.equal(apagarDocumento(db, ID, { maquina: 'pc-b', agora: 't4' }), false)
    assert.equal(linhaDoDocumento(db).versao, 3)
    assert.equal(linhaDoDocumento(db).apagado_em, 't3')
    // O mesmo texto da lápide volta como ressurreição, não como 'igual'.
    assert.equal(gravarDocumento(db, v2, { maquina: 'pc-a', agora: 't5' }), 'ressuscitado')
    assert.deepEqual(linhaDoDocumento(db), {
      formato: 'md', conteudo: 'dois ç', sha256: sha256('dois ç'), bytes: 7, versao: 4,
      origem_maquina: 'pc-a', criado_em: 't0', atualizado_em: 't5', apagado_em: null
    })
    const diario = db.prepare("SELECT operacao, versao FROM _diario WHERE tabela = 'documentos' ORDER BY seq").all()
    assert.deepEqual(diario.map((linha) => `${linha.operacao}:${linha.versao}`), ['I:1', 'U:2', 'U:3', 'U:4'])
  })
})

test('base comum por maquina: confirmar troca o hash, esquecer vale so para a maquina e nada entra no diario', () => {
  comCasa((db) => {
    gravarDocumento(db, { id: ID, conteudo: 'um', sha: sha256('um'), bytes: 2 }, { maquina: 'pc-a', agora: 't0' })
    const diarioAntes = db.prepare('SELECT COUNT(*) AS n FROM _diario').get().n
    confirmarNoDisco(db, ID, 'sha-1', { maquina: 'pc-a', agora: 't1' })
    confirmarNoDisco(db, ID, 'sha-b', { maquina: 'pc-b', agora: 't1' })
    confirmarNoDisco(db, ID, 'sha-2', { maquina: 'pc-a', agora: 't2' })
    assert.deepEqual([...confirmadosNoDisco(db, 'pc-a')], [[ID, 'sha-2']])
    assert.deepEqual([...confirmadosNoDisco(db, 'pc-b')], [[ID, 'sha-b']])
    assert.equal(db.prepare('SELECT em FROM _documentos_no_disco WHERE maquina = ? AND id = ?').get('pc-a', ID).em, 't2')
    esquecerNoDisco(db, ID, { maquina: 'pc-a' })
    assert.deepEqual([...confirmadosNoDisco(db, 'pc-a')], [])
    assert.deepEqual([...confirmadosNoDisco(db, 'pc-b')], [[ID, 'sha-b']])
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM _diario').get().n, diarioAntes)
  })
})

test('base comum de documento que nao existe e recusada pela chave estrangeira', () => {
  comCasa((db) => {
    assert.throws(
      () => confirmarNoDisco(db, 'claude-projects/proj/memory/nada.md', 'sha', { maquina: 'pc-a', agora: 't' }),
      /FOREIGN KEY/
    )
  })
})

test('documentosNoBanco lista so ids da memoria do Claude, com projeto, nome, hash e lapide', () => {
  comCasa((db) => {
    const carimbo = { maquina: 'pc-a', agora: 't' }
    gravarDocumento(db, { id: 'claude-projects/proj/memory/a.md', conteudo: 'a', sha: sha256('a'), bytes: 1 }, carimbo)
    gravarDocumento(db, { id: 'claude-projects/proj/memory/b.md', conteudo: 'b', sha: sha256('b'), bytes: 1 }, carimbo)
    apagarDocumento(db, 'claude-projects/proj/memory/b.md', carimbo)
    const inserir = db.prepare(`INSERT INTO documentos (id, formato, conteudo, sha256, bytes, origem_maquina, criado_em, atualizado_em)
      VALUES (?, ?, ?, ?, 1, 'pc', 't', 't')`)
    inserir.run('claude-projects/proj/memory/sub/c.md', 'md', 'c', 'sha-c')
    inserir.run('outro/coisa.json', 'json', '{}', 'sha-d')
    assert.deepEqual(Object.fromEntries(documentosNoBanco(db)), {
      'claude-projects/proj/memory/a.md': { projeto: 'proj', nome: 'a.md', sha: sha256('a'), vivo: true },
      'claude-projects/proj/memory/b.md': { projeto: 'proj', nome: 'b.md', sha: sha256('b'), vivo: false }
    })
    assert.equal(conteudoDoDocumento(db, 'claude-projects/proj/memory/b.md'), 'b')
    assert.equal(conteudoDoDocumento(db, 'claude-projects/proj/memory/nada.md'), null)
  })
})

test('registrarImportacaoDeDocumentos grava tipo, fonte, hash, contagens e carimbo', () => {
  comCasa((db) => {
    registrarImportacaoDeDocumentos(db, { fonteSha: 'abc', contagens: { lidos: 2, ingeridos: 1, apagados: 1 }, maquina: 'pc-a', agora: 't9' })
    const linhas = db.prepare('SELECT id, tipo, fonte, fonte_sha256, contagens, origem_maquina, feita_em FROM _importacoes').all()
    assert.equal(linhas.length, 1)
    const { id, ...resto } = linhas[0]
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    assert.deepEqual(resto, {
      tipo: 'documentos-md',
      fonte: 'claude-projects',
      fonte_sha256: 'abc',
      contagens: '{"lidos":2,"ingeridos":1,"apagados":1}',
      origem_maquina: 'pc-a',
      feita_em: 't9'
    })
  })
})
