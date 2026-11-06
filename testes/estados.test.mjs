import assert from 'node:assert/strict'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import test from 'node:test'

import { observePersonalityContinuity, readPersonalityContinuity } from '../dist/adapters/local-json/personality-continuity-store.js'
import { arquivoDoBanco, comBancoDaCasa, pastaDoBanco, sha256 } from '../runtime/casa/banco.mjs'
import { baseNoDisco, gravarEstado, recomporEstado, shaDoEstado } from '../runtime/casa/loja-estados.mjs'
import { lerSeExistir } from '../runtime/casa/projecao.mjs'
import { avaliarEstrutura, avaliarTexto, carregarTextoDoEstado, gravarTextoDoEstado, reconciliarEstados } from '../runtime/estados.mjs'

const ANTIGO = new Date('2020-01-01T00:00:00Z')
const REL = 'learning/shortcuts.json'
const VERSAO = 4
const SO_NO_WINDOWS = process.platform !== 'win32' && 'rename sobre arquivo somente leitura só falha no Windows'

// Validador mínimo no lugar do validador real dos atalhos, que entra na T4.
function validar(doc) {
  if (!Array.isArray(doc.shortcuts)) throw new Error('shortcuts ausente')
}
const AVALIACAO = { versao: VERSAO, validar }
const canonico = (valor) => `${JSON.stringify(valor, null, 2)}\n`
const doc = (n, extra = {}) => ({
  schemaVersion: VERSAO,
  store: { updatedAt: `2026-11-05T00:00:0${n}.000Z` },
  shortcuts: Array.from({ length: n }, (_, i) => ({ id: `s${i}` })),
  ...extra
})

const casaNova = () => mkdtempSync(join(tmpdir(), 'omni-estados-'))
const apagar = (casa) => rmSync(casa, { recursive: true, force: true })
const arquivoDe = (casa, rel = REL) => join(casa, ...rel.split('/'))

// Arquivo semeado com mtime antigo: se a ponte o reescrever, o mtime muda.
function semear(casa, texto, rel = REL) {
  const arquivo = arquivoDe(casa, rel)
  mkdirSync(dirname(arquivo), { recursive: true })
  writeFileSync(arquivo, texto)
  utimesSync(arquivo, ANTIGO, ANTIGO)
  return arquivo
}
const intocado = (arquivo) => statSync(arquivo).mtimeMs === ANTIGO.getTime()

function degradacoes(casa) {
  const texto = lerSeExistir(join(pastaDoBanco(casa, {}), 'degradacoes.jsonl'))
  return texto === null ? [] : texto.trim().split('\n').map((linha) => JSON.parse(linha).operacao)
}
// Abre o banco (e o cria se faltar): só depois que a ponte já o criou, ou quando o teste quer um.
const noBanco = (casa, rel = REL) =>
  comBancoDaCasa(casa, 'omni', (db) => ({ sha: shaDoEstado(db, rel), base: baseNoDisco(db, rel) }), {})
const gravarNoBanco = (casa, texto, rel = REL) => comBancoDaCasa(casa, 'omni', (db) => gravarEstado(db, rel, texto), {})
function copias(casa, tipo, rel = REL) {
  const arquivo = arquivoDe(casa, rel)
  const prefixo = `${basename(arquivo)}.${tipo}.`
  return readdirSync(dirname(arquivo)).filter((nome) => nome.startsWith(prefixo))
}
const carregar = (casa, opcoes = {}) => carregarTextoDoEstado(casa, REL, { ...AVALIACAO, env: {}, ...opcoes })
const gravar = (casa, texto, opcoes = {}) => gravarTextoDoEstado(casa, REL, texto, { env: {}, ...opcoes })

test('vazia: sem arquivo e sem linha devolve null, e sem banco não cria banco', () => {
  const casa = casaNova()
  try {
    assert.equal(carregar(casa), null)
    assert.equal(existsSync(pastaDoBanco(casa, {})), false)
    comBancoDaCasa(casa, 'omni', () => {}, {})
    assert.equal(carregar(casa), null)
    assert.equal(existsSync(arquivoDe(casa)), false)
    assert.deepEqual(degradacoes(casa), [])
  } finally {
    apagar(casa)
  }
})

test('intocada sem linha: arquivo quebrado, de versão futura ou fora do contrato não entra no banco', () => {
  const textos = ['xx{', canonico(doc(1, { schemaVersion: VERSAO + 1 })), canonico({ schemaVersion: VERSAO, store: {} })]
  for (const texto of textos) {
    const casa = casaNova()
    try {
      const arquivo = semear(casa, texto)
      assert.equal(carregar(casa), texto)
      assert.ok(intocado(arquivo))
      assert.deepEqual(noBanco(casa), { sha: null, base: null })
      assert.deepEqual(copias(casa, 'antes-da-casa'), [])
      assert.deepEqual(degradacoes(casa), [])
    } finally {
      apagar(casa)
    }
  }
})

test('importada: a fonte compacta volta como está, ganha cópia e o banco guarda a forma canônica', () => {
  const casa = casaNova()
  try {
    const fonte = JSON.stringify(doc(2))
    const arquivo = semear(casa, fonte)
    assert.equal(carregar(casa), fonte)
    assert.ok(intocado(arquivo))
    const guardadas = copias(casa, 'antes-da-casa')
    assert.equal(guardadas.length, 1)
    assert.equal(readFileSync(join(dirname(arquivo), guardadas[0]), 'utf8'), fonte)
    const sha = sha256(canonico(doc(2)))
    assert.deepEqual(noBanco(casa), { sha, base: sha })
    const importacoes = () => comBancoDaCasa(casa, 'omni', (db) =>
      db.prepare("SELECT fonte, fonte_sha256 FROM _importacoes WHERE tipo = 'estados'").all().map((linha) => ({ ...linha })), {})
    assert.deepEqual(importacoes(), [{ fonte: REL, fonte_sha256: sha256(fonte) }])
    assert.equal(carregar(casa), fonte)
    assert.ok(intocado(arquivo))
    assert.equal(copias(casa, 'antes-da-casa').length, 1)
    assert.equal(importacoes().length, 1)
    assert.deepEqual(degradacoes(casa), [])
  } finally {
    apagar(casa)
  }
})

test('projetada: sem arquivo e com linha, o banco reescreve o disco e confirma a base', () => {
  const casa = casaNova()
  try {
    const texto = canonico(doc(2))
    gravarNoBanco(casa, texto)
    assert.equal(carregar(casa), texto)
    assert.equal(readFileSync(arquivoDe(casa), 'utf8'), texto)
    assert.deepEqual(noBanco(casa), { sha: sha256(texto), base: sha256(texto) })
    assert.deepEqual(copias(casa, 'antes-da-casa'), [])
    assert.deepEqual(degradacoes(casa), [])
  } finally {
    apagar(casa)
  }
})

test('atual: arquivo igual ao banco, ou com a mesma forma canônica, fica como está e a base perdida volta', () => {
  const casa = casaNova()
  try {
    const texto = canonico(doc(2))
    gravarNoBanco(casa, texto)
    const arquivo = semear(casa, texto)
    assert.deepEqual(noBanco(casa), { sha: sha256(texto), base: null })
    assert.equal(carregar(casa), texto)
    assert.ok(intocado(arquivo))
    assert.deepEqual(noBanco(casa), { sha: sha256(texto), base: sha256(texto) })
    const compacta = JSON.stringify(doc(2))
    semear(casa, compacta)
    comBancoDaCasa(casa, 'omni', (db) => db.exec('DELETE FROM _estados_no_disco'), {})
    assert.equal(carregar(casa), compacta)
    assert.ok(intocado(arquivo))
    assert.deepEqual(noBanco(casa), { sha: sha256(texto), base: sha256(texto) })
    assert.deepEqual(degradacoes(casa), [])
  } finally {
    apagar(casa)
  }
})

test('socorrida: arquivo quebrado com linha válida vira cópia .invalida e o banco reprojeta', () => {
  const casa = casaNova()
  try {
    const texto = canonico(doc(2))
    gravarNoBanco(casa, texto)
    const arquivo = semear(casa, 'xx{')
    assert.equal(carregar(casa), texto)
    assert.equal(readFileSync(arquivo, 'utf8'), texto)
    const guardadas = copias(casa, 'invalida')
    assert.equal(guardadas.length, 1)
    assert.equal(readFileSync(join(dirname(arquivo), guardadas[0]), 'utf8'), 'xx{')
    assert.deepEqual(noBanco(casa), { sha: sha256(texto), base: sha256(texto) })
    assert.deepEqual(degradacoes(casa), ['estado.arquivo-invalido'])
  } finally {
    apagar(casa)
  }
})

test('socorro barrado: banco fora do contrato não substitui o arquivo quebrado', () => {
  const casa = casaNova()
  try {
    gravarNoBanco(casa, canonico({ schemaVersion: VERSAO, store: { updatedAt: '2026-11-05T00:00:00.000Z' } }))
    const arquivo = semear(casa, 'xx{')
    assert.equal(carregar(casa), 'xx{')
    assert.ok(intocado(arquivo))
    assert.deepEqual(copias(casa, 'invalida'), [])
    assert.deepEqual(degradacoes(casa), [])
  } finally {
    apagar(casa)
  }
})

test('sem cópia, sem socorro: se a cópia .invalida não sai, o arquivo quebrado fica', (t) => {
  const casa = casaNova()
  try {
    const texto = canonico(doc(2))
    gravarNoBanco(casa, texto)
    const arquivo = semear(casa, 'xx{')
    t.mock.method(Date.prototype, 'toISOString', () => '2026-01-01T00:00:00.000Z')
    const ocupada = `${arquivo}.invalida.20260101000000000`
    writeFileSync(ocupada, 'ocupada')
    assert.equal(carregar(casa), 'xx{')
    assert.ok(intocado(arquivo))
    assert.equal(readFileSync(ocupada, 'utf8'), 'ocupada')
    assert.deepEqual(noBanco(casa), { sha: sha256(texto), base: null })
    assert.deepEqual(degradacoes(casa), ['estado.copia'])
  } finally {
    apagar(casa)
  }
})

test('defasada: arquivo na versão que o banco já superou recebe a versão do banco', () => {
  for (const noDisco of [canonico(doc(1)), JSON.stringify(doc(1))]) {
    const casa = casaNova()
    try {
      const arquivo = semear(casa, canonico(doc(1)))
      assert.equal(carregar(casa), canonico(doc(1)))
      gravarNoBanco(casa, canonico(doc(2)))
      semear(casa, noDisco)
      assert.equal(carregar(casa), canonico(doc(2)))
      assert.equal(readFileSync(arquivo, 'utf8'), canonico(doc(2)))
      assert.deepEqual(noBanco(casa), { sha: sha256(canonico(doc(2))), base: sha256(canonico(doc(2))) })
      assert.deepEqual(copias(casa, 'invalida'), [])
      assert.deepEqual(degradacoes(casa), [])
    } finally {
      apagar(casa)
    }
  }
})

test('ingerida: escrita externa válida entra no banco e o arquivo fica como está', () => {
  const casa = casaNova()
  try {
    const arquivo = semear(casa, canonico(doc(1)))
    assert.equal(carregar(casa), canonico(doc(1)))
    const externa = JSON.stringify(doc(3))
    semear(casa, externa)
    assert.equal(carregar(casa), externa)
    assert.ok(intocado(arquivo))
    const sha = sha256(canonico(doc(3)))
    assert.deepEqual(noBanco(casa), { sha, base: sha })
    assert.equal(comBancoDaCasa(casa, 'omni', (db) => recomporEstado(db, REL), {}), canonico(doc(3)))
    assert.deepEqual(degradacoes(casa), [])
  } finally {
    apagar(casa)
  }
})

test('com linha, arquivo de versão futura ou fora do contrato fica intocado e o banco não muda', () => {
  for (const texto of [canonico(doc(3, { schemaVersion: VERSAO + 1 })), canonico({ schemaVersion: VERSAO, store: {} })]) {
    const casa = casaNova()
    try {
      const atual = canonico(doc(1))
      semear(casa, atual)
      assert.equal(carregar(casa), atual)
      const arquivo = semear(casa, texto)
      assert.equal(carregar(casa), texto)
      assert.ok(intocado(arquivo))
      assert.deepEqual(noBanco(casa), { sha: sha256(atual), base: sha256(atual) })
      assert.deepEqual(degradacoes(casa), [])
    } finally {
      apagar(casa)
    }
  }
})

test('avaliarTexto e avaliarEstrutura', () => {
  for (const texto of ['xx{', '[]', 'null', '"texto"', '{"store":{}}', '{"schemaVersion":"4"}', '{"schemaVersion":4.5}']) {
    assert.equal(avaliarTexto(texto, AVALIACAO), 'quebrada', texto)
    assert.equal(avaliarEstrutura(texto), false, texto)
  }
  assert.equal(avaliarTexto(JSON.stringify(doc(1, { schemaVersion: VERSAO + 1 })), AVALIACAO), 'futura')
  assert.equal(avaliarTexto('{"schemaVersion":4}', AVALIACAO), 'fora-do-contrato')
  assert.equal(avaliarTexto('{"schemaVersion":3}', AVALIACAO), 'ok')
  assert.equal(avaliarTexto(JSON.stringify(doc(1)), AVALIACAO), 'ok')
  assert.equal(avaliarEstrutura('{"schemaVersion":99}'), true)
  assert.equal(avaliarEstrutura(JSON.stringify(doc(1))), true)
})

test('sem SQLite: carga e escrita só no arquivo, sem banco', () => {
  const casa = casaNova()
  const env = { OMNI_CASA_SEM_SQLITE: '1' }
  try {
    assert.equal(carregar(casa, { env }), null)
    const texto = canonico(doc(2))
    gravar(casa, texto, { env })
    assert.equal(readFileSync(arquivoDe(casa), 'utf8'), texto)
    assert.equal(carregar(casa, { env }), texto)
    assert.equal(existsSync(pastaDoBanco(casa, {})), false)
  } finally {
    apagar(casa)
  }
})

test('estado que é pasta: o erro de leitura sobe antes de abrir o banco', () => {
  const casa = casaNova()
  try {
    mkdirSync(arquivoDe(casa), { recursive: true })
    assert.throws(() => carregar(casa), { code: 'EISDIR' })
    assert.equal(existsSync(pastaDoBanco(casa, {})), false)
  } finally {
    apagar(casa)
  }
})

test('banco que não abre: com arquivo a ponte segue no disco; sem arquivo recusa começar vazio', () => {
  const casa = casaNova()
  try {
    mkdirSync(arquivoDoBanco(casa, 'omni', {}), { recursive: true })
    assert.throws(() => carregar(casa), /recusa começar vazio/)
    const texto = canonico(doc(1))
    const arquivo = semear(casa, texto)
    assert.equal(carregar(casa), texto)
    assert.ok(intocado(arquivo))
    gravar(casa, canonico(doc(2)))
    assert.equal(readFileSync(arquivo, 'utf8'), canonico(doc(2)))
    assert.deepEqual(degradacoes(casa), ['estado.carregar', 'estado.carregar', 'estado.gravar'])
  } finally {
    apagar(casa)
  }
})

test('escrita: banco e arquivo recebem o mesmo texto e a base acompanha', () => {
  const casa = casaNova()
  try {
    const texto = canonico(doc(2))
    gravar(casa, texto)
    assert.equal(readFileSync(arquivoDe(casa), 'utf8'), texto)
    assert.deepEqual(noBanco(casa), { sha: sha256(texto), base: sha256(texto) })
    assert.equal(comBancoDaCasa(casa, 'omni', (db) => recomporEstado(db, REL), {}), texto)
    assert.equal(carregar(casa), texto)
    assert.deepEqual(copias(casa, 'antes-da-casa'), [])
    assert.deepEqual(degradacoes(casa), [])
  } finally {
    apagar(casa)
  }
})

test('escrita fora da forma canônica: vai ao arquivo, não ao banco, e a degradação fica anotada', () => {
  const casa = casaNova()
  try {
    const compacta = JSON.stringify(doc(2))
    gravar(casa, compacta)
    assert.equal(readFileSync(arquivoDe(casa), 'utf8'), compacta)
    assert.equal(existsSync(arquivoDoBanco(casa, 'omni', {})), false)
    assert.deepEqual(degradacoes(casa), ['estado.gravar'])
  } finally {
    apagar(casa)
  }
})

test('falha de projeção: o banco fica à frente e a carga seguinte projeta', { skip: SO_NO_WINDOWS }, () => {
  const casa = casaNova()
  const arquivo = arquivoDe(casa)
  try {
    gravar(casa, canonico(doc(1)))
    chmodSync(arquivo, 0o444)
    gravar(casa, canonico(doc(2)))
    assert.equal(readFileSync(arquivo, 'utf8'), canonico(doc(1)))
    assert.deepEqual(noBanco(casa), { sha: sha256(canonico(doc(2))), base: sha256(canonico(doc(1))) })
    assert.deepEqual(degradacoes(casa), ['estado.projetar'])
    chmodSync(arquivo, 0o666)
    assert.equal(carregar(casa), canonico(doc(2)))
    assert.equal(readFileSync(arquivo, 'utf8'), canonico(doc(2)))
    assert.deepEqual(noBanco(casa), { sha: sha256(canonico(doc(2))), base: sha256(canonico(doc(2))) })
  } finally {
    if (existsSync(arquivo)) chmodSync(arquivo, 0o666)
    apagar(casa)
  }
})

test('fora do catálogo p2: estado desconhecido, espelho ou nome herdado de Object é recusado', () => {
  const casa = casaNova()
  try {
    for (const rel of ['learning/inventado.json', 'feedback/personality-continuity.json', 'constructor', '__proto__']) {
      assert.throws(() => carregarTextoDoEstado(casa, rel, { ...AVALIACAO, env: {} }), /fora do catálogo p2/)
      assert.throws(() => gravarTextoDoEstado(casa, rel, canonico(doc(1)), { env: {} }), /fora do catálogo p2/)
    }
    assert.deepEqual(readdirSync(casa), [])
  } finally {
    apagar(casa)
  }
})

test('varredura em casa vazia: nada a importar, sem banco e sem pasta feedback', async () => {
  const casa = casaNova()
  try {
    assert.deepEqual(await reconciliarEstados(casa, { env: {} }), {
      resultado: 'feita',
      arquivos: {
        'learning/failures.json': 'sem-arquivo',
        'learning/failure-automation.json': 'sem-arquivo',
        'learning/self-improvement.json': 'sem-arquivo',
        'learning/shortcuts.json': 'sem-arquivo',
        'learning/evolution-receipts.json': 'sem-arquivo',
        'feedback/personality-feedback.json': 'sem-arquivo',
        'feedback/personality-continuity.json': 'vazia',
        'feedback/personality-owner-directions.json': 'vazia'
      }
    })
    assert.deepEqual(readdirSync(casa), [])
    assert.deepEqual(await reconciliarEstados(casa, { env: { OMNI_CASA_SEM_SQLITE: '1' } }), { resultado: 'sem-banco', arquivos: {} })
  } finally {
    apagar(casa)
  }
})

test('varredura p2: importa o que falta uma vez só e deixa o quebrado como está', async () => {
  const casa = casaNova()
  try {
    const fonte = JSON.stringify(doc(2))
    const arquivo = semear(casa, fonte)
    const quebrado = semear(casa, 'xx{', 'learning/failures.json')
    const primeira = await reconciliarEstados(casa, { env: {} })
    assert.equal(primeira.arquivos[REL], 'importada')
    assert.equal(primeira.arquivos['learning/failures.json'], 'intocada')
    assert.ok(intocado(arquivo))
    assert.ok(intocado(quebrado))
    const sha = sha256(canonico(doc(2)))
    assert.deepEqual(noBanco(casa), { sha, base: sha })
    assert.deepEqual(noBanco(casa, 'learning/failures.json'), { sha: null, base: null })
    const segunda = await reconciliarEstados(casa, { env: {} })
    assert.equal(segunda.arquivos[REL], 'presente')
    assert.equal(segunda.arquivos['learning/failures.json'], 'intocada')
    assert.equal(copias(casa, 'antes-da-casa').length, 1)
    assert.deepEqual(copias(casa, 'antes-da-casa', 'learning/failures.json'), [])
    assert.deepEqual(degradacoes(casa), [])
  } finally {
    apagar(casa)
  }
})

test('espelho: a loja TS de continuidade e o banco andam juntos', async () => {
  const casa = casaNova()
  const rel = 'feedback/personality-continuity.json'
  const arquivo = arquivoDe(casa, rel)
  const varrer = async () => (await reconciliarEstados(casa, { env: {} })).arquivos[rel]
  try {
    await observePersonalityContinuity(casa, 'Sua personalidade não está constante.', '2026-11-05T00:00:00.000Z')
    assert.equal(await varrer(), 'importada')
    assert.equal(await varrer(), 'atual')
    const duas = canonico({
      schemaVersion: 1,
      observations: [
        { fingerprint: 'a'.repeat(64), recordedAt: '2026-11-05T00:00:00.000Z' },
        { fingerprint: 'b'.repeat(64), recordedAt: '2026-11-05T00:00:01.000Z' }
      ]
    })
    writeFileSync(arquivo, duas)
    assert.equal(await varrer(), 'ingerida')
    assert.equal(comBancoDaCasa(casa, 'omni', (db) => recomporEstado(db, rel), {}), duas)
    rmSync(arquivo)
    assert.equal(await varrer(), 'projetada')
    assert.equal(readFileSync(arquivo, 'utf8'), duas)
    writeFileSync(arquivo, 'xx{')
    await assert.rejects(readPersonalityContinuity(casa))
    assert.equal(await varrer(), 'socorrida')
    assert.deepEqual(await readPersonalityContinuity(casa), ['maintain-personality-continuity'])
    assert.equal(copias(casa, 'invalida', rel).length, 1)
    assert.deepEqual(degradacoes(casa), ['estado.arquivo-invalido'])
  } finally {
    apagar(casa)
  }
})

test('varredura com pasta no lugar do arquivo: o estado degrada e os outros seguem', async () => {
  const casa = casaNova()
  try {
    mkdirSync(arquivoDe(casa, 'learning/failures.json'), { recursive: true })
    mkdirSync(arquivoDe(casa, 'feedback/personality-continuity.json'), { recursive: true })
    semear(casa, canonico(doc(1)))
    const { resultado, arquivos } = await reconciliarEstados(casa, { env: {} })
    assert.equal(resultado, 'feita')
    assert.equal(arquivos['learning/failures.json'], 'degradada')
    assert.equal(arquivos['feedback/personality-continuity.json'], 'degradada')
    assert.equal(arquivos[REL], 'importada')
    assert.deepEqual(degradacoes(casa), ['estados.varredura', 'estado.espelho'])
  } finally {
    apagar(casa)
  }
})
