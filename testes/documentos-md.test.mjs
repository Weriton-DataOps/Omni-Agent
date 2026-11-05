// Documentos .md da memória do Claude Code no omni.db (plano 2 da F1): o banco é a fonte e a
// pasta memory/ de cada projeto é projeção reconciliada por três hashes — disco, banco e o último
// que os dois tiveram em comum nesta máquina. Tudo roda numa casa temporária com a pasta de
// projetos dentro dela; o ~/.claude/projects real nunca é lido.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { acquireLocalFileLock } from '../dist/adapters/local-json/node-local-file-lock.js'
import { arquivoDoBanco, comBancoDaCasa, pastaDoBanco, sha256 } from '../runtime/casa/banco.mjs'
import { lerSeExistir } from '../runtime/casa/projecao.mjs'
import { pastaDeProjetosDoClaude, projetarDocumentos, reconciliarDocumentosMd } from '../runtime/documentos-md.mjs'

// Arquivo de teste nasce com mtime antigo: qualquer regravação o traz para agora.
const ANTIGO = new Date('2020-01-01T00:00:00Z')
const ZERADAS = Object.freeze({ lidos: 0, atuais: 0, ingeridos: 0, apagados: 0, projetados: 0, pulados: 0 })

function casaNova() {
  const casa = mkdtempSync(join(tmpdir(), 'omni-documentos-md-'))
  return { casa, raiz: join(casa, 'projetos') }
}

// Faxina de melhor esforço: erro aqui mascararia a asserção que falhou.
function apagar(casa) {
  try {
    rmSync(casa, { recursive: true, force: true })
  } catch {
    // Sobra pasta temporária; o teste que importa já disse o motivo.
  }
}

const idDe = (projeto, nome) => `claude-projects/${projeto}/memory/${nome}`
const caminhoDe = (raiz, projeto, nome) => join(raiz, projeto, 'memory', nome)
const intocado = (caminho) => statSync(caminho).mtimeMs === ANTIGO.getTime()
const contagens = (parcial) => ({ ...ZERADAS, ...parcial })

function escreverMd(raiz, projeto, nome, conteudo) {
  const caminho = caminhoDe(raiz, projeto, nome)
  mkdirSync(join(raiz, projeto, 'memory'), { recursive: true })
  writeFileSync(caminho, conteudo)
  utimesSync(caminho, ANTIGO, ANTIGO)
  return caminho
}

// Outra ponta (a ilha, outra máquina) muda o documento direto no banco, subindo a versão.
function avancarBanco(casa, id, texto) {
  comBancoDaCasa(casa, 'omni', (db) => {
    db.prepare('UPDATE documentos SET conteudo = ?, sha256 = ?, bytes = ?, versao = versao + 1 WHERE id = ?')
      .run(texto, sha256(texto), Buffer.byteLength(texto), id)
  })
}

function documentos(casa) {
  return comBancoDaCasa(casa, 'omni', (db) => new Map(
    db.prepare('SELECT id, formato, conteudo, sha256, bytes, versao, apagado_em FROM documentos ORDER BY id').all()
      .map(({ id, ...linha }) => [id, { ...linha }])
  ))
}

function confirmados(casa) {
  return comBancoDaCasa(casa, 'omni', (db) => new Map(
    db.prepare('SELECT id, sha256 FROM _documentos_no_disco ORDER BY id').all().map((linha) => [linha.id, linha.sha256])
  ))
}

function importacoes(casa) {
  return comBancoDaCasa(casa, 'omni', (db) => db.prepare('SELECT tipo, fonte, fonte_sha256, contagens FROM _importacoes ORDER BY rowid').all()
    .map((linha) => ({ ...linha, contagens: JSON.parse(linha.contagens) })))
}

function degradacoes(casa) {
  const texto = lerSeExistir(join(pastaDoBanco(casa), 'degradacoes.jsonl'))
  return texto === null ? [] : texto.trim().split('\n').map((linha) => JSON.parse(linha))
}

function listarRecursivo(pasta) {
  return readdirSync(pasta, { recursive: true }).map(String).sort()
}

// Onde o contrato é "não falha", a rejeição vira asserção, não tropeço.
async function semRejeitar(promessa) {
  let valor
  await assert.doesNotReject(async () => { valor = await promessa })
  return valor
}

const reconciliar = (casa, raiz, opcoes = {}) => semRejeitar(reconciliarDocumentosMd(casa, { projectsRoot: raiz, ...opcoes }))

test('primeira passada ingere os .md de memory/ de cada projeto e ignora o resto', async () => {
  const { casa, raiz } = casaNova()
  try {
    const arquivos = {
      [idDe('proj-a', 'a.md')]: escreverMd(raiz, 'proj-a', 'a.md', '# A\nprimeiro\n'),
      [idDe('proj-a', 'b.md')]: escreverMd(raiz, 'proj-a', 'b.md', 'acentuação e emoji 🚀\n'),
      [idDe('proj-b', 'c.md')]: escreverMd(raiz, 'proj-b', 'c.md', 'linha com CRLF\r\n')
    }
    escreverMd(raiz, 'proj-a', 'notas.txt', 'nao e md')
    escreverMd(raiz, 'proj-a', '.oculto.md', 'oculto')
    writeFileSync(join(raiz, 'proj-a', 'README.md'), 'fora de memory/')
    mkdirSync(join(raiz, 'proj-a', 'memory', 'sub'))
    writeFileSync(join(raiz, 'proj-a', 'memory', 'sub', 'x.md'), 'subpasta')

    assert.deepEqual(await reconciliar(casa, raiz), { resultado: 'concluida', contagens: contagens({ lidos: 3, ingeridos: 3 }) })

    const banco = documentos(casa)
    const base = confirmados(casa)
    assert.deepEqual([...banco.keys()], Object.keys(arquivos).sort())
    for (const [id, caminho] of Object.entries(arquivos)) {
      const bytes = readFileSync(caminho)
      assert.deepEqual(banco.get(id), {
        formato: 'md', conteudo: bytes.toString('utf8'), sha256: sha256(bytes), bytes: bytes.length, versao: 1, apagado_em: null
      }, id)
      assert.equal(base.get(id), sha256(bytes), id)
      assert.ok(intocado(caminho), `${id} não pode ser regravado na ingestão`)
    }
    const fonte = sha256(JSON.stringify(Object.keys(arquivos).sort().map((id) => [id, sha256(readFileSync(arquivos[id]))])))
    assert.deepEqual(importacoes(casa), [
      { tipo: 'documentos-md', fonte: 'claude-projects', fonte_sha256: fonte, contagens: { lidos: 3, ingeridos: 3, apagados: 0 } }
    ])
  } finally {
    apagar(casa)
  }
})

test('passada sem mudanca nao escreve no disco, nao sobe versao nem registra importacao', async () => {
  const { casa, raiz } = casaNova()
  try {
    const caminhos = [
      escreverMd(raiz, 'proj-a', 'a.md', 'a\n'),
      escreverMd(raiz, 'proj-a', 'b.md', 'b\n'),
      escreverMd(raiz, 'proj-b', 'c.md', 'c\n')
    ]
    await reconciliar(casa, raiz)
    assert.deepEqual(await reconciliar(casa, raiz), { resultado: 'concluida', contagens: contagens({ lidos: 3, atuais: 3 }) })
    for (const caminho of caminhos) assert.ok(intocado(caminho), caminho)
    assert.deepEqual([...documentos(casa).values()].map((linha) => linha.versao), [1, 1, 1])
    assert.equal(importacoes(casa).length, 1)
  } finally {
    apagar(casa)
  }
})

test('edicao externa no disco vira versao nova no banco e o arquivo fica como esta', async () => {
  const { casa, raiz } = casaNova()
  try {
    escreverMd(raiz, 'proj', 'a.md', 'texto 1\n')
    await reconciliar(casa, raiz)
    const caminho = escreverMd(raiz, 'proj', 'a.md', 'texto 2, editado à mão\n')
    assert.deepEqual(await reconciliar(casa, raiz), { resultado: 'concluida', contagens: contagens({ lidos: 1, ingeridos: 1 }) })
    const linha = documentos(casa).get(idDe('proj', 'a.md'))
    assert.equal(linha.conteudo, 'texto 2, editado à mão\n')
    assert.equal(linha.sha256, sha256(readFileSync(caminho)))
    assert.equal(linha.versao, 2)
    assert.equal(confirmados(casa).get(idDe('proj', 'a.md')), sha256(readFileSync(caminho)))
    assert.ok(intocado(caminho))
    assert.deepEqual(importacoes(casa).map((item) => item.contagens), [
      { lidos: 1, ingeridos: 1, apagados: 0 },
      { lidos: 1, ingeridos: 1, apagados: 0 }
    ])
  } finally {
    apagar(casa)
  }
})

test('voltar o arquivo a um texto antigo e edicao legitima, nao copia defasada', async () => {
  const { casa, raiz } = casaNova()
  try {
    escreverMd(raiz, 'proj', 'a.md', 'texto 1\n')
    await reconciliar(casa, raiz)
    escreverMd(raiz, 'proj', 'a.md', 'texto 2\n')
    await reconciliar(casa, raiz)
    const caminho = escreverMd(raiz, 'proj', 'a.md', 'texto 1\n')
    assert.deepEqual(await reconciliar(casa, raiz), { resultado: 'concluida', contagens: contagens({ lidos: 1, ingeridos: 1 }) })
    const linha = documentos(casa).get(idDe('proj', 'a.md'))
    assert.equal(linha.conteudo, 'texto 1\n')
    assert.equal(linha.versao, 3)
    assert.equal(readFileSync(caminho, 'utf8'), 'texto 1\n')
    assert.ok(intocado(caminho))
  } finally {
    apagar(casa)
  }
})

test('banco adiante projeta a versao nova no disco byte a byte e a passada seguinte fica em dia', async () => {
  const { casa, raiz } = casaNova()
  try {
    const caminho = escreverMd(raiz, 'proj', 'a.md', 'texto 1\n')
    await reconciliar(casa, raiz)
    const novo = 'segunda versão\r\nvinda do banco 🚀\r\n'
    avancarBanco(casa, idDe('proj', 'a.md'), novo)
    assert.deepEqual(await reconciliar(casa, raiz), { resultado: 'concluida', contagens: contagens({ lidos: 1, projetados: 1 }) })
    assert.deepEqual(readFileSync(caminho), Buffer.from(novo, 'utf8'))
    assert.equal(confirmados(casa).get(idDe('proj', 'a.md')), sha256(novo))
    assert.equal(documentos(casa).get(idDe('proj', 'a.md')).versao, 2)
    assert.equal(importacoes(casa).length, 1)
    assert.deepEqual(await reconciliar(casa, raiz), { resultado: 'concluida', contagens: contagens({ lidos: 1, atuais: 1 }) })
  } finally {
    apagar(casa)
  }
})

test('disco e banco mudaram desde a ultima passada: o disco vence e vira versao nova', async () => {
  const { casa, raiz } = casaNova()
  try {
    escreverMd(raiz, 'proj', 'a.md', 'texto 1\n')
    await reconciliar(casa, raiz)
    avancarBanco(casa, idDe('proj', 'a.md'), 'do banco\n')
    const caminho = escreverMd(raiz, 'proj', 'a.md', 'do disco\n')
    assert.deepEqual(await reconciliar(casa, raiz), { resultado: 'concluida', contagens: contagens({ lidos: 1, ingeridos: 1 }) })
    const linha = documentos(casa).get(idDe('proj', 'a.md'))
    assert.equal(linha.conteudo, 'do disco\n')
    assert.equal(linha.versao, 3)
    assert.equal(readFileSync(caminho, 'utf8'), 'do disco\n')
    assert.ok(intocado(caminho))
  } finally {
    apagar(casa)
  }
})

test('disco e banco chegam ao mesmo texto por caminhos diferentes: fica em dia e a base acompanha', async () => {
  const { casa, raiz } = casaNova()
  try {
    escreverMd(raiz, 'proj', 'a.md', 'texto 1\n')
    await reconciliar(casa, raiz)
    avancarBanco(casa, idDe('proj', 'a.md'), 'texto 2\n')
    const caminho = escreverMd(raiz, 'proj', 'a.md', 'texto 2\n')
    assert.deepEqual(await reconciliar(casa, raiz), { resultado: 'concluida', contagens: contagens({ lidos: 1, atuais: 1 }) })
    assert.equal(confirmados(casa).get(idDe('proj', 'a.md')), sha256('texto 2\n'))
    assert.ok(intocado(caminho))
    // Com a base em dia, o banco que anda de novo é projetado, e não atropelado pelo disco.
    avancarBanco(casa, idDe('proj', 'a.md'), 'texto 3\n')
    assert.deepEqual(await reconciliar(casa, raiz), { resultado: 'concluida', contagens: contagens({ lidos: 1, projetados: 1 }) })
    assert.equal(readFileSync(caminho, 'utf8'), 'texto 3\n')
    assert.equal(documentos(casa).get(idDe('proj', 'a.md')).versao, 3)
  } finally {
    apagar(casa)
  }
})

test('apagar um .md com irmaos vivos vira lapide no banco e o arquivo nao volta', async () => {
  const { casa, raiz } = casaNova()
  try {
    const a = escreverMd(raiz, 'proj', 'a.md', 'a apagar\n')
    escreverMd(raiz, 'proj', 'b.md', 'b fica\n')
    await reconciliar(casa, raiz)
    rmSync(a)
    assert.deepEqual(await reconciliar(casa, raiz), { resultado: 'concluida', contagens: contagens({ lidos: 1, atuais: 1, apagados: 1 }) })
    const linha = documentos(casa).get(idDe('proj', 'a.md'))
    assert.notEqual(linha.apagado_em, null)
    assert.equal(linha.conteudo, 'a apagar\n')
    assert.equal(linha.versao, 2)
    assert.equal(confirmados(casa).has(idDe('proj', 'a.md')), false)
    assert.deepEqual(importacoes(casa).map((item) => item.contagens).at(-1), { lidos: 1, ingeridos: 0, apagados: 1 })
    assert.equal(existsSync(a), false)
    assert.deepEqual(await reconciliar(casa, raiz), { resultado: 'concluida', contagens: contagens({ lidos: 1, atuais: 1 }) })
    assert.equal(existsSync(a), false)
  } finally {
    apagar(casa)
  }
})

test('arquivo apagado depois que o banco andou volta com a versao do banco, sem lapide', async () => {
  const { casa, raiz } = casaNova()
  try {
    const a = escreverMd(raiz, 'proj', 'a.md', 'a 1\n')
    escreverMd(raiz, 'proj', 'b.md', 'b\n')
    await reconciliar(casa, raiz)
    avancarBanco(casa, idDe('proj', 'a.md'), 'a 2\n')
    rmSync(a)
    // Apagar a versão velha não derruba a nova: a do banco volta.
    assert.deepEqual(await reconciliar(casa, raiz), { resultado: 'concluida', contagens: contagens({ lidos: 1, atuais: 1, projetados: 1 }) })
    assert.equal(readFileSync(a, 'utf8'), 'a 2\n')
    const linha = documentos(casa).get(idDe('proj', 'a.md'))
    assert.equal(linha.apagado_em, null)
    assert.equal(linha.versao, 2)
    assert.equal(confirmados(casa).get(idDe('proj', 'a.md')), sha256('a 2\n'))
  } finally {
    apagar(casa)
  }
})

test('lapide feita fora da reconciliacao so esquece a base desta maquina', async () => {
  const { casa, raiz } = casaNova()
  try {
    const a = escreverMd(raiz, 'proj', 'a.md', 'a\n')
    escreverMd(raiz, 'proj', 'b.md', 'b\n')
    await reconciliar(casa, raiz)
    // Outra ponta apaga a.md no banco, e o arquivo também sumiu daqui.
    comBancoDaCasa(casa, 'omni', (db) => {
      db.prepare("UPDATE documentos SET apagado_em = 'em outra ponta', versao = versao + 1 WHERE id = ?").run(idDe('proj', 'a.md'))
    })
    rmSync(a)
    assert.deepEqual(await reconciliar(casa, raiz), { resultado: 'concluida', contagens: contagens({ lidos: 1, atuais: 1 }) })
    assert.equal(confirmados(casa).has(idDe('proj', 'a.md')), false)
    const linha = documentos(casa).get(idDe('proj', 'a.md'))
    assert.equal(linha.apagado_em, 'em outra ponta')
    assert.equal(linha.versao, 2)
    assert.equal(existsSync(a), false)
    assert.equal(importacoes(casa).length, 1)
  } finally {
    apagar(casa)
  }
})

test('arquivo recriado depois da lapide ressuscita o documento com versao nova', async () => {
  const { casa, raiz } = casaNova()
  try {
    const a = escreverMd(raiz, 'proj', 'a.md', 'a\n')
    escreverMd(raiz, 'proj', 'b.md', 'b\n')
    await reconciliar(casa, raiz)
    rmSync(a)
    await reconciliar(casa, raiz)
    escreverMd(raiz, 'proj', 'a.md', 'a de volta\n')
    assert.deepEqual(await reconciliar(casa, raiz), { resultado: 'concluida', contagens: contagens({ lidos: 2, atuais: 1, ingeridos: 1 }) })
    const linha = documentos(casa).get(idDe('proj', 'a.md'))
    assert.equal(linha.apagado_em, null)
    assert.equal(linha.conteudo, 'a de volta\n')
    assert.equal(linha.versao, 3)
    assert.equal(confirmados(casa).get(idDe('proj', 'a.md')), sha256('a de volta\n'))
    assert.deepEqual(importacoes(casa).map((item) => item.contagens).at(-1), { lidos: 2, ingeridos: 1, apagados: 0 })
  } finally {
    apagar(casa)
  }
})

test('memory/ apagada inteira ou sem nenhum .md volta do banco byte a byte, com BOM e tudo', async () => {
  const { casa, raiz } = casaNova()
  try {
    const comBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# com BOM\n', 'utf8')])
    const a = escreverMd(raiz, 'proj-a', 'a.md', comBom)
    const b = escreverMd(raiz, 'proj-a', 'b.md', 'b\n')
    const c = escreverMd(raiz, 'proj-b', 'c.md', 'c\n')
    escreverMd(raiz, 'proj-b', 'notas.txt', 'sem md')
    await reconciliar(casa, raiz)

    rmSync(join(raiz, 'proj-a', 'memory'), { recursive: true })
    assert.deepEqual(await reconciliar(casa, raiz), { resultado: 'concluida', contagens: contagens({ lidos: 1, atuais: 1, projetados: 2 }) })
    assert.deepEqual(readFileSync(a), comBom)
    assert.deepEqual(readFileSync(b), Buffer.from('b\n'))
    assert.equal(confirmados(casa).get(idDe('proj-a', 'a.md')), sha256(comBom))

    // Sobrou só um .txt: a pasta não tem mais nenhum .md e o último apagado volta.
    rmSync(c)
    assert.deepEqual(await reconciliar(casa, raiz), { resultado: 'concluida', contagens: contagens({ lidos: 2, atuais: 2, projetados: 1 }) })
    assert.equal(readFileSync(c, 'utf8'), 'c\n')
    for (const linha of documentos(casa).values()) {
      assert.equal(linha.apagado_em, null)
      assert.equal(linha.versao, 1)
    }
    assert.equal(importacoes(casa).length, 1)
  } finally {
    apagar(casa)
  }
})

test('projeto apagado inteiro nao e recriado nem vira lapide', async () => {
  const { casa, raiz } = casaNova()
  try {
    escreverMd(raiz, 'proj-a', 'a.md', 'a\n')
    escreverMd(raiz, 'proj-b', 'c.md', 'c\n')
    await reconciliar(casa, raiz)
    rmSync(join(raiz, 'proj-a'), { recursive: true })
    assert.deepEqual(await reconciliar(casa, raiz), { resultado: 'concluida', contagens: contagens({ lidos: 1, atuais: 1 }) })
    assert.equal(existsSync(join(raiz, 'proj-a')), false)
    const linha = documentos(casa).get(idDe('proj-a', 'a.md'))
    assert.equal(linha.apagado_em, null)
    assert.equal(linha.versao, 1)
  } finally {
    apagar(casa)
  }
})

test('sem SQLite a reconciliacao nao abre banco, nao trava e nao toca no disco', async () => {
  const { casa, raiz } = casaNova()
  try {
    const caminho = escreverMd(raiz, 'proj', 'a.md', 'a\n')
    const resultado = await reconciliar(casa, raiz, { env: { ...process.env, OMNI_CASA_SEM_SQLITE: '1' } })
    assert.deepEqual(resultado, { resultado: 'sem-banco', contagens: contagens({}) })
    assert.deepEqual(readdirSync(casa), ['projetos'])
    assert.ok(intocado(caminho))
  } finally {
    apagar(casa)
  }
})

test('banco ilegivel degrada sem vazar texto de memoria e sem tocar no disco', async () => {
  const { casa, raiz } = casaNova()
  try {
    const caminho = escreverMd(raiz, 'proj', 'a.md', 'frase distintiva da memoria\n')
    mkdirSync(pastaDoBanco(casa), { recursive: true })
    writeFileSync(arquivoDoBanco(casa, 'omni'), 'isto nao e um banco sqlite. '.repeat(100), 'utf8')
    const resultado = await reconciliar(casa, raiz)
    assert.equal(resultado.resultado, 'degradada')
    assert.deepEqual(degradacoes(casa).map((linha) => linha.operacao), ['documentos.banco'])
    assert.doesNotMatch(readFileSync(join(pastaDoBanco(casa), 'degradacoes.jsonl'), 'utf8'), /distintiva/)
    assert.ok(intocado(caminho))
  } finally {
    apagar(casa)
  }
})

test('projecao rele o hash antes de escrever e nao atropela escrita concorrente', () => {
  const { casa, raiz } = casaNova()
  try {
    const caminho = escreverMd(raiz, 'proj', 'a.md', 'concorrente\n')
    const base = { id: idDe('proj', 'a.md'), projeto: 'proj', nome: 'a.md', conteudo: 'do banco\n', sha: sha256('do banco\n') }

    assert.deepEqual(projetarDocumentos(raiz, [{ ...base, esperado: sha256('outro texto\n') }], casa), { feitas: [], pulados: 1 })
    assert.equal(readFileSync(caminho, 'utf8'), 'concorrente\n')

    const certa = { ...base, esperado: sha256(readFileSync(caminho)) }
    assert.deepEqual(projetarDocumentos(raiz, [certa], casa), { feitas: [certa], pulados: 0 })
    assert.equal(readFileSync(caminho, 'utf8'), 'do banco\n')

    const nova = { ...base, id: idDe('proj', 'nova.md'), nome: 'nova.md', esperado: null }
    assert.deepEqual(projetarDocumentos(raiz, [nova], casa), { feitas: [nova], pulados: 0 })
    assert.equal(readFileSync(caminhoDe(raiz, 'proj', 'nova.md'), 'utf8'), 'do banco\n')
    // Esperava ausência, mas o arquivo apareceu nesse meio-tempo: fica o que está lá.
    assert.deepEqual(projetarDocumentos(raiz, [{ ...nova, conteudo: 'atrasado\n' }], casa), { feitas: [], pulados: 1 })
    assert.equal(readFileSync(caminhoDe(raiz, 'proj', 'nova.md'), 'utf8'), 'do banco\n')

    // Falha de disco vira degradação anotada e pulo, nunca exceção.
    mkdirSync(caminhoDe(raiz, 'proj', 'pasta.md'))
    const naPasta = { ...base, id: idDe('proj', 'pasta.md'), nome: 'pasta.md', esperado: null }
    assert.deepEqual(projetarDocumentos(raiz, [naPasta], casa), { feitas: [], pulados: 1 })
    assert.deepEqual(degradacoes(casa).map((linha) => linha.operacao), ['documentos.projetar'])
  } finally {
    apagar(casa)
  }
})

test('arquivo que nao e UTF-8 valido fica intocado e nao vira lapide', async () => {
  const { casa, raiz } = casaNova()
  try {
    escreverMd(raiz, 'proj', 'ruim.md', 'valido\n')
    escreverMd(raiz, 'proj', 'bom.md', 'bom\n')
    await reconciliar(casa, raiz)
    const invalido = Buffer.from([0xc3, 0x28])
    const caminho = escreverMd(raiz, 'proj', 'ruim.md', invalido)
    assert.deepEqual(await reconciliar(casa, raiz), { resultado: 'concluida', contagens: contagens({ lidos: 1, atuais: 1, pulados: 1 }) })
    assert.deepEqual(readFileSync(caminho), invalido)
    const linha = documentos(casa).get(idDe('proj', 'ruim.md'))
    assert.equal(linha.conteudo, 'valido\n')
    assert.equal(linha.versao, 1)
    assert.equal(linha.apagado_em, null)
    assert.deepEqual(degradacoes(casa).map((item) => item.operacao), ['documentos.codificacao'])
  } finally {
    apagar(casa)
  }
})

test('pasta com nome de .md fica intocada e nao vira lapide', async () => {
  const { casa, raiz } = casaNova()
  try {
    const caminho = escreverMd(raiz, 'proj', 'x.md', 'x\n')
    await reconciliar(casa, raiz)
    rmSync(caminho)
    mkdirSync(caminho)
    assert.deepEqual(await reconciliar(casa, raiz), { resultado: 'concluida', contagens: contagens({ pulados: 1 }) })
    assert.ok(statSync(caminho).isDirectory())
    assert.equal(documentos(casa).get(idDe('proj', 'x.md')).apagado_em, null)
  } finally {
    apagar(casa)
  }
})

test('id malformado no banco e ignorado e nada e escrito fora de memory/', async () => {
  const casa = mkdtempSync(join(tmpdir(), 'omni-documentos-md-'))
  const area = join(casa, 'area')
  const raiz = join(area, 'projetos')
  try {
    escreverMd(raiz, 'proj', 'a.md', 'a\n')
    await reconciliar(casa, raiz)
    const antes = listarRecursivo(area)
    const malformados = [
      'claude-projects/proj/memory/a\\..\\..\\..\\..\\fuga.md',
      'claude-projects/../memory/fuga.md',
      'claude-projects/proj/memory/sub/fuga.md',
      'claude-projects/proj/memoria/fuga.md',
      'claude-projects/proj/memory/.oculto.md',
      'claude-projects/proj/memory/C:fuga.md'
    ]
    comBancoDaCasa(casa, 'omni', (db) => {
      const inserir = db.prepare(`INSERT INTO documentos (id, formato, conteudo, sha256, bytes, origem_maquina, criado_em, atualizado_em)
        VALUES (?, 'md', 'fuga', ?, 4, 'pc', 't', 't')`)
      for (const id of malformados) inserir.run(id, sha256('fuga'))
    })
    assert.deepEqual(await reconciliar(casa, raiz), { resultado: 'concluida', contagens: contagens({ lidos: 1, atuais: 1 }) })
    assert.deepEqual(listarRecursivo(area), antes)
  } finally {
    apagar(casa)
  }
})

test('reconciliacao concorrente sai como em-andamento sem abrir o banco', async () => {
  const { casa, raiz } = casaNova()
  try {
    const caminho = escreverMd(raiz, 'proj', 'a.md', 'a\n')
    const trava = await acquireLocalFileLock(join(casa, 'runs', 'documentos-md.lock'), {
      acquisitionTimeoutMs: 1_000, retryDelayMs: 25, staleLockMs: 60_000, heartbeatMs: 5_000
    })
    try {
      assert.deepEqual(await reconciliar(casa, raiz), { resultado: 'em-andamento', contagens: contagens({}) })
      assert.equal(existsSync(pastaDoBanco(casa)), false)
      assert.ok(intocado(caminho))
    } finally {
      await trava.release()
    }
  } finally {
    apagar(casa)
  }
})

test('pasta de projetos ausente ou que nao e pasta nao cria trava nem banco', async () => {
  const { casa, raiz } = casaNova()
  try {
    assert.deepEqual(await reconciliar(casa, raiz), { resultado: 'sem-projetos', contagens: contagens({}) })
    assert.deepEqual(readdirSync(casa), [])
    writeFileSync(raiz, 'arquivo no lugar da pasta')
    assert.deepEqual(await reconciliar(casa, raiz), { resultado: 'sem-projetos', contagens: contagens({}) })
    assert.deepEqual(readdirSync(casa), ['projetos'])
  } finally {
    apagar(casa)
  }
})

test('raiz padrao: a casa de producao usa ~/.claude/projects e qualquer outra casa usa a propria pasta', async () => {
  const { casa } = casaNova()
  try {
    assert.equal(pastaDeProjetosDoClaude(casa, {}), join(casa, 'claude', 'projects'))
    // Só comparação de caminho: nada aqui lê a pasta real.
    const appdata = resolve('C:/teste/Roaming')
    const real = join(homedir(), '.claude', 'projects')
    assert.equal(pastaDeProjetosDoClaude(join(appdata, 'omni'), { APPDATA: appdata }), real)
    if (process.platform === 'win32') {
      assert.equal(pastaDeProjetosDoClaude(join(appdata.toUpperCase(), 'OMNI'), { APPDATA: appdata }), real)
    }
    assert.equal(pastaDeProjetosDoClaude(join(appdata, 'outra'), { APPDATA: appdata }), join(appdata, 'outra', 'claude', 'projects'))

    escreverMd(join(casa, 'claude', 'projects'), 'proj', 'a.md', 'a\n')
    const resultado = await semRejeitar(reconciliarDocumentosMd(casa))
    assert.deepEqual(resultado, { resultado: 'concluida', contagens: contagens({ lidos: 1, ingeridos: 1 }) })
    assert.deepEqual([...documentos(casa).keys()], [idDe('proj', 'a.md')])
  } finally {
    apagar(casa)
  }
})
