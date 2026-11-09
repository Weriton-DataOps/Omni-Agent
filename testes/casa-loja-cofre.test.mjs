// Loja do cofre (§8.1, §8.3, §8.4) sobre o cofre.db de uma casa temporária, com a ponte de mentira:
// esquema com CHECKs, cadastro, uso com registro, teste, importação da pasta .dpapi, inventário do
// Gerenciador e o pacote entre duas máquinas.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { comBancoDaCasa, sha256 } from '../runtime/casa/banco.mjs'
import { cadastrarCredencial, credencialPorNome, exportarCofre, importarPacoteCofre, importarPastaDpapi, listarCredenciais, registrarInventarioWindows, registrarTeste, usarCredencial } from '../runtime/casa/loja-cofre.mjs'
import { selarPacote } from '../runtime/casa/pacote-cofre.mjs'

const RAPIDO = { N: 2 ** 14, r: 8, p: 1 }
const FRASE = 'frase-mestra de teste'
const QUANDO = { maquina: 'maquina-a', agora: '2026-11-06T03:00:00.000Z' }

// Ponte de mentira: "sela" com uma marca e um XOR; só abre o que tem a marca dela. Outra marca é
// outra máquina: o blob de uma não abre na outra. Trata null e Uint8Array como a ponte real trataria.
function ponteFalsa(marca = 'FALSO:') {
  const chamadas = { selar: 0, abrir: 0 }
  const prefixo = Buffer.from(marca)
  const xor = (bytes) => { const saida = Buffer.from(bytes); for (let i = 0; i < saida.length; i++) saida[i] ^= 0x5a; return saida }
  return {
    chamadas,
    selar(valores) { chamadas.selar += 1; return valores.map((valor) => Buffer.concat([prefixo, xor(valor)])) },
    abrir(blobs) {
      chamadas.abrir += 1
      return blobs.map((blob) => {
        const bytes = blob instanceof Uint8Array ? Buffer.from(blob) : null
        if (!bytes || !bytes.subarray(0, prefixo.length).equals(prefixo)) return { ok: false, erro: 'CryptographicException' }
        return { ok: true, valor: xor(bytes.subarray(prefixo.length)) }
      })
    }
  }
}
// Casa temporária; o cofre.db mora dentro dela (env vazio: nenhum OMNI_CASA_BANCO do ambiente desvia o banco).
function comCasa(uso) {
  const casa = mkdtempSync(join(tmpdir(), 'omni-loja-cofre-'))
  try { return uso(casa) } finally { rmSync(casa, { recursive: true, force: true }) }
}
const comCofre = (casa, uso) => comBancoDaCasa(casa, 'cofre', uso, {})
// Linhas do node:sqlite têm protótipo nulo: o espalhamento vira objeto comum para o deepEqual.
const usos = (db) => db.prepare('SELECT nome, agente, sessao, motivo, resultado, credencial_id, id FROM usos ORDER BY rowid').all().map((linha) => ({ ...linha }))
const importacoes = (db) => db.prepare('SELECT tipo, fonte, contagens FROM _importacoes ORDER BY rowid').all().map((linha) => ({ ...linha, contagens: JSON.parse(linha.contagens) }))

test('esquema: os CHECKs amarram guarda, alvo, blob e as listas JSON', () => comCasa((casa) => comCofre(casa, (db) => {
  const inserir = db.prepare('INSERT INTO credenciais (id, nome, tipo, etiquetas, agentes, guarda, alvo_windows, blob, blob_sha256, origem_maquina, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  let n = 0
  const tentar = (mudanca) => {
    const c = { tipo: 'outro', etiquetas: '[]', agentes: '["omni"]', guarda: 'dpapi', alvo_windows: null, blob: Buffer.from('x'), blob_sha256: 'h', ...mudanca }
    n += 1
    inserir.run(`id-${n}`, `nome-${n}`, c.tipo, c.etiquetas, c.agentes, c.guarda, c.alvo_windows, c.blob, c.blob_sha256, 'maquina-a', QUANDO.agora, QUANDO.agora)
  }
  const recusas = {
    'guarda desconhecida': { guarda: 'cofre-x' },
    'gerenciador sem alvo': { guarda: 'gerenciador-windows', blob: null, blob_sha256: null },
    'dpapi sem blob': { blob: null, blob_sha256: null },
    'dpapi com alvo': { alvo_windows: 'Omni/x' },
    'blob sem hash': { blob_sha256: null },
    'agentes fora de lista': { agentes: '{}' },
    'etiquetas fora de JSON': { etiquetas: 'x' }
  }
  for (const [caso, mudanca] of Object.entries(recusas)) assert.throws(() => tentar(mudanca), { message: /CHECK constraint failed/ }, caso)
  tentar({})
  tentar({ guarda: 'gerenciador-windows', alvo_windows: 'Omni/y', blob: null, blob_sha256: null })
  assert.equal(db.prepare('SELECT count(*) AS n FROM credenciais').get().n, 2)
})))

test('cadastro: sela pela ponte, guarda só metadados em claro e recusa o que não presta', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  const c = cadastrarCredencial(db, ponte, { nome: 'servico-a', tipo: 'chave-api', servico: 'openai', etiquetas: ['ia'], agentes: ['omni', 'oraculo'] }, 'valor-a', QUANDO)
  assert.equal(c.nome, 'servico-a')
  assert.equal(c.guarda, 'dpapi')
  assert.deepEqual(c.agentes, ['omni', 'oraculo'])
  assert.deepEqual(c.etiquetas, ['ia'])
  assert.equal(c.versao, 1)
  assert.equal(c.origem_maquina, 'maquina-a')
  assert.equal('blob' in c, false)
  assert.equal(ponte.chamadas.selar, 1)
  assert.deepEqual(listarCredenciais(db), [c])
  const { blob, blob_sha256: hash } = db.prepare('SELECT blob, blob_sha256 FROM credenciais WHERE nome = ?').get('servico-a')
  assert.ok(!Buffer.from(blob).includes('valor-a'), 'o blob não leva o valor em claro')
  assert.equal(hash, sha256(Buffer.from(blob)))
  assert.throws(() => cadastrarCredencial(db, ponte, { nome: 'servico-a', tipo: 'senha' }, 'outro', QUANDO), { name: 'CofreError', code: 'ja-existe' })
  assert.equal(ponte.chamadas.selar, 1)
  assert.throws(() => cadastrarCredencial(db, ponte, { nome: 'com espaco', tipo: 'senha' }, 'v', QUANDO), { code: 'dados-invalidos' })
  assert.throws(() => cadastrarCredencial(db, ponte, { nome: 'servico-b', tipo: 'cartao' }, 'v', QUANDO), { code: 'dados-invalidos' })
  assert.throws(() => cadastrarCredencial(db, ponte, { nome: 'servico-b', tipo: 'senha', agentes: ['Omni'] }, 'v', QUANDO), { code: 'dados-invalidos' })
  assert.throws(() => cadastrarCredencial(db, ponte, { nome: 'servico-b', tipo: 'senha' }, '', QUANDO), { code: 'valor-vazio' })
  assert.equal(listarCredenciais(db).length, 1)
})))

test('uso: entrega só a agente autorizado e registra cada pedido, entregue ou recusado, sem o valor', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  cadastrarCredencial(db, ponte, { nome: 'servico-a', tipo: 'senha' }, 'valor-secreto-a', QUANDO)
  registrarInventarioWindows(db, [{ alvo: 'Omni/gerenciada', usuario: 'u', tipo: 1, persistencia: 2 }], QUANDO)
  const pedido = (nome, agente = 'omni') => ({ nome, agente, motivo: 'teste da loja', sessao: 'sessao-1' })
  assert.throws(() => usarCredencial(db, ponte, pedido('nao-existe'), QUANDO), { name: 'CofreError', code: 'inexistente' })
  assert.throws(() => usarCredencial(db, ponte, pedido('servico-a', 'overcore'), QUANDO), { code: 'agente-sem-acesso' })
  assert.throws(() => usarCredencial(db, ponte, pedido('Omni/gerenciada'), QUANDO), { code: 'gerenciador-windows' })
  const quebrada = { ...ponte, abrir() { throw new Error('ponte caiu') } }
  assert.throws(() => usarCredencial(db, quebrada, pedido('servico-a'), QUANDO), { message: 'ponte caiu' })
  assert.throws(() => usarCredencial(db, ponteFalsa('OUTRO:'), pedido('servico-a'), QUANDO), { code: 'nao-abriu' })
  const { valor, usoId } = usarCredencial(db, ponte, pedido('servico-a'), QUANDO)
  assert.equal(valor.toString('utf8'), 'valor-secreto-a')
  const linhas = usos(db)
  assert.deepEqual(linhas.map((u) => u.resultado), ['recusado-inexistente', 'recusado-agente', 'recusado-gerenciador', 'falhou-abrir', 'falhou-abrir', 'entregue'])
  assert.equal(linhas.at(-1).id, usoId)
  assert.equal(linhas[0].credencial_id, null)
  const ultimo = linhas.at(-1)
  assert.deepEqual({ agente: ultimo.agente, sessao: ultimo.sessao, motivo: ultimo.motivo }, { agente: 'omni', sessao: 'sessao-1', motivo: 'teste da loja' })
  assert.ok(!JSON.stringify(linhas).includes('valor-secreto-a'), 'nenhum uso leva o valor')
  assert.throws(() => usarCredencial(db, ponte, { nome: 'servico-a', agente: 'omni', motivo: ' ' }, QUANDO), { code: 'dados-invalidos' })
})))

test('registrarTeste: grava resultado e data sem mexer na versão nem no diário', () => comCasa((casa) => comCofre(casa, (db) => {
  cadastrarCredencial(db, ponteFalsa(), { nome: 'servico-a', tipo: 'senha' }, 'v', QUANDO)
  const diario = () => db.prepare('SELECT count(*) AS n FROM _diario').get().n
  const antes = diario()
  registrarTeste(db, 'servico-a', { ok: false, detalhe: 'x'.repeat(400) }, '2026-11-06T04:00:00.000Z')
  let c = credencialPorNome(db, 'servico-a')
  assert.equal(c.ultimo_teste_ok, false)
  assert.equal(c.ultimo_teste_detalhe.length, 300)
  assert.equal(c.ultimo_teste_em, '2026-11-06T04:00:00.000Z')
  assert.equal(c.versao, 1)
  assert.equal(diario(), antes)
  registrarTeste(db, 'servico-a', { ok: null })
  assert.equal(credencialPorNome(db, 'servico-a').ultimo_teste_ok, null)
  registrarTeste(db, 'servico-a', { ok: true, detalhe: 'HTTP 200' })
  c = credencialPorNome(db, 'servico-a')
  assert.deepEqual([c.ultimo_teste_ok, c.ultimo_teste_detalhe], [true, 'HTTP 200'])
  assert.throws(() => registrarTeste(db, 'nao-existe', { ok: true }), { code: 'inexistente' })
  assert.throws(() => registrarTeste(db, 'servico-a', { ok: 'sim' }), { code: 'dados-invalidos' })
})))

test('importação da pasta .dpapi: abre antes de gravar, classifica, não duplica e nunca apaga o original', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  const pasta = join(casa, 'access')
  mkdirSync(pasta, { recursive: true })
  const [blobA, blobB, blobBNovo] = ponte.selar([Buffer.from('valor-a'), Buffer.from('valor-b'), Buffer.from('valor-b-novo')])
  writeFileSync(join(pasta, 'a.dpapi'), blobA)
  writeFileSync(join(pasta, 'b.dpapi'), blobB)
  writeFileSync(join(pasta, 'lixo.dpapi'), 'nao e dpapi')
  writeFileSync(join(pasta, 'com espaco.dpapi'), blobA)
  writeFileSync(join(pasta, 'x.txt'), 'fora')
  const arquivos = readdirSync(pasta).sort()
  const classificacao = { a: { tipo: 'chave-api', servico: 'openai' } }
  const r1 = importarPastaDpapi(db, ponte, pasta, { classificacao, ...QUANDO })
  assert.equal(r1.importadas, 2)
  assert.deepEqual(r1.resultados, [
    { nome: 'a', resultado: 'importada' },
    { nome: 'b', resultado: 'importada' },
    { nome: 'com espaco', resultado: 'nome-invalido' },
    { nome: 'lixo', resultado: 'nao-abriu' }
  ])
  const a = credencialPorNome(db, 'a')
  const b = credencialPorNome(db, 'b')
  assert.deepEqual([a.tipo, a.servico, b.tipo, b.servico], ['chave-api', 'openai', 'outro', null])
  const usar = (nome) => usarCredencial(db, ponte, { nome, agente: 'omni', motivo: 'teste da importacao' }, QUANDO).valor.toString('utf8')
  assert.equal(usar('a'), 'valor-a')
  writeFileSync(join(pasta, 'b.dpapi'), blobBNovo)
  const r2 = importarPastaDpapi(db, ponte, pasta, QUANDO)
  assert.equal(r2.importadas, 0)
  assert.deepEqual(r2.resultados, [
    { nome: 'a', resultado: 'ja-importada' },
    { nome: 'b', resultado: 'divergente' },
    { nome: 'com espaco', resultado: 'nome-invalido' },
    { nome: 'lixo', resultado: 'nao-abriu' }
  ])
  assert.equal(usar('b'), 'valor-b')
  assert.deepEqual(readdirSync(pasta).sort(), arquivos)
  assert.deepEqual(importacoes(db).map((i) => i.contagens), [
    { 'nome-invalido': 1, importada: 2, 'nao-abriu': 1 },
    { 'ja-importada': 1, divergente: 1, 'nome-invalido': 1, 'nao-abriu': 1 }
  ])
  assert.throws(() => importarPastaDpapi(db, ponte, pasta, { classificacao: { a: { tipo: 'cartao' } } }), { code: 'classificacao-invalida' })
  assert.throws(() => importarPastaDpapi(db, ponte, pasta, { classificacao: [] }), { code: 'classificacao-invalida' })
})))

test('importação do texto hex do ConvertFrom-SecureString: abre, passa o UTF-16LE para UTF-8, re-sela e reconhece o arquivo na volta', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  const pasta = join(casa, 'access')
  mkdirSync(pasta, { recursive: true })
  // O PowerShell grava o blob como texto hex; aqui com BOM, maiúsculas e CRLF, que o leitor tolera.
  const comoTexto = (blob) => `﻿${blob.toString('hex').toUpperCase()}\r\n`
  const [blobS, blobImpar, blobSolta, blobNovo] = ponte.selar([Buffer.from('valor-ç-s', 'utf16le'), Buffer.from('abc'), Buffer.from([0x00, 0xd8]), Buffer.from('valor-novo', 'utf16le')])
  writeFileSync(join(pasta, 's.dpapi'), comoTexto(blobS))
  writeFileSync(join(pasta, 'impar.dpapi'), comoTexto(blobImpar))
  writeFileSync(join(pasta, 'solta.dpapi'), comoTexto(blobSolta))
  writeFileSync(join(pasta, 'meio.dpapi'), `${blobS.toString('hex')}zz`)
  const original = readFileSync(join(pasta, 's.dpapi'))
  const usar = () => usarCredencial(db, ponte, { nome: 's', agente: 'omni', motivo: 'teste do texto hex' }, QUANDO).valor.toString('utf8')
  const r1 = importarPastaDpapi(db, ponte, pasta, QUANDO)
  assert.equal(r1.importadas, 1)
  assert.deepEqual(r1.resultados, [
    { nome: 'impar', resultado: 'nao-abriu' },
    { nome: 'meio', resultado: 'nao-abriu' },
    { nome: 's', resultado: 'importada' },
    { nome: 'solta', resultado: 'nao-abriu' }
  ])
  assert.equal(usar(), 'valor-ç-s')
  assert.equal(credencialPorNome(db, 's').blob_sha256, sha256(ponte.selar([Buffer.from('valor-ç-s', 'utf8')])[0]))
  assert.deepEqual(db.prepare('SELECT arquivo, sha256, papel FROM _projecoes').all().map((linha) => ({ ...linha })), [{ arquivo: 'access/s.dpapi', sha256: sha256(original), papel: 'ingerida' }])
  const r2 = importarPastaDpapi(db, ponte, pasta, QUANDO)
  assert.deepEqual(r2.resultados.filter((r) => r.nome === 's'), [{ nome: 's', resultado: 'ja-importada' }])
  assert.ok(readFileSync(join(pasta, 's.dpapi')).equals(original))
  writeFileSync(join(pasta, 's.dpapi'), comoTexto(blobNovo))
  const r3 = importarPastaDpapi(db, ponte, pasta, QUANDO)
  assert.deepEqual(r3.resultados.filter((r) => r.nome === 's'), [{ nome: 's', resultado: 'divergente' }])
  assert.equal(usar(), 'valor-ç-s')
})))

test('inventário do Gerenciador: só Omni/, só o nome, sem blob, e ausente contado, nunca apagado', () => comCasa((casa) => comCofre(casa, (db) => {
  cadastrarCredencial(db, ponteFalsa(), { nome: 'Omni/ja-no-cofre', tipo: 'senha' }, 'v', QUANDO)
  const entradas = [
    { alvo: 'Omni/PostgreSQL/admin', usuario: 'postgres', tipo: 1, persistencia: 2 },
    { alvo: 'omni/minusculo', usuario: null, tipo: 1, persistencia: 2 },
    { alvo: 'Omni/ja-no-cofre', usuario: null, tipo: 1, persistencia: 2 },
    { alvo: 'Omni/com espaco', usuario: null, tipo: 1, persistencia: 2 },
    { alvo: 'Outro/Programa', usuario: 'alguem', tipo: 1, persistencia: 2 }
  ]
  const r1 = registrarInventarioWindows(db, entradas, QUANDO)
  assert.deepEqual({ inventariadas: r1.inventariadas, ausentes: r1.ausentes, ignoradas: r1.ignoradas }, { inventariadas: 2, ausentes: 0, ignoradas: 1 })
  assert.deepEqual(r1.resultados.map((r) => r.resultado), ['inventariada', 'inventariada', 'conflito', 'nome-invalido'])
  const linha = { ...db.prepare("SELECT guarda, alvo_windows, blob, blob_sha256, usuario FROM credenciais WHERE nome = 'Omni/PostgreSQL/admin'").get() }
  assert.deepEqual(linha, { guarda: 'gerenciador-windows', alvo_windows: 'Omni/PostgreSQL/admin', blob: null, blob_sha256: null, usuario: 'postgres' })
  assert.equal(credencialPorNome(db, 'omni/minusculo').guarda, 'gerenciador-windows')
  assert.equal(credencialPorNome(db, 'Outro/Programa'), null)
  const r2 = registrarInventarioWindows(db, entradas.slice(0, 1), QUANDO)
  assert.deepEqual({ inventariadas: r2.inventariadas, ausentes: r2.ausentes, ignoradas: r2.ignoradas }, { inventariadas: 0, ausentes: 1, ignoradas: 0 })
  assert.deepEqual(r2.resultados, [{ nome: 'Omni/PostgreSQL/admin', resultado: 'ja-inventariada' }])
  assert.deepEqual(importacoes(db).map((i) => i.contagens), [
    { inventariada: 2, conflito: 1, 'nome-invalido': 1, ignoradas: 1, ausentes: 0 },
    { 'ja-inventariada': 1, ignoradas: 0, ausentes: 1 }
  ])
  assert.throws(() => registrarInventarioWindows(db, 'nao e lista', QUANDO), { code: 'dados-invalidos' })
})))

test('pacote entre duas máquinas: exporta de A, importa em B re-selado pela ponte de B, com uso registrado', () => comCasa((casaA) => comCasa((casaB) => {
  const pa = ponteFalsa('FALSO:')
  const pb = ponteFalsa('OUTRO:')
  const exportado = comCofre(casaA, (db) => {
    cadastrarCredencial(db, pa, { nome: 'servico-a', tipo: 'chave-api', servico: 'openai', etiquetas: ['ia'], notas: 'nota a' }, 'valor-a', QUANDO)
    cadastrarCredencial(db, pa, { nome: 'servico-b', tipo: 'senha', agentes: ['omni', 'overcore'] }, 'valor-b', QUANDO)
    registrarInventarioWindows(db, [{ alvo: 'Omni/gerenciada', usuario: 'u', tipo: 1, persistencia: 2 }], QUANDO)
    const r = exportarCofre(db, pa, FRASE, { parametros: RAPIDO, ...QUANDO })
    assert.deepEqual([r.credenciais, r.recadastrar], [2, 1])
    assert.deepEqual(usos(db).map((u) => `${u.nome}:${u.resultado}:${u.agente}:${u.motivo}`), ['servico-a:exportada:omni:exportacao do cofre', 'servico-b:exportada:omni:exportacao do cofre'])
    for (const valor of ['valor-a', 'valor-b']) {
      assert.ok(!r.texto.includes(valor) && !r.texto.includes(Buffer.from(valor).toString('base64')), `${valor} não aparece no pacote`)
    }
    return { texto: r.texto, metadados: listarCredenciais(db).filter((c) => c.guarda === 'dpapi') }
  })
  comCofre(casaB, (db) => {
    const quandoB = { maquina: 'maquina-b', agora: QUANDO.agora }
    const r = importarPacoteCofre(db, pb, exportado.texto, FRASE, quandoB)
    assert.equal(r.importadas, 2)
    assert.deepEqual(r.recadastrar, [{ nome: 'Omni/gerenciada', alvo_windows: 'Omni/gerenciada', usuario: 'u' }])
    const usar = (nome) => usarCredencial(db, pb, { nome, agente: 'omni', motivo: 'teste do pacote' }, quandoB).valor.toString('utf8')
    assert.equal(usar('servico-a'), 'valor-a')
    assert.equal(usar('servico-b'), 'valor-b')
    const campos = ['nome', 'tipo', 'servico', 'url', 'usuario', 'notas', 'etiquetas', 'agentes', 'validade', 'rotacionar_dias']
    const so = (c) => Object.fromEntries(campos.map((k) => [k, c[k]]))
    assert.deepEqual(listarCredenciais(db).map(so), exportado.metadados.map(so))
    assert.deepEqual(listarCredenciais(db).map((c) => c.origem_maquina), ['maquina-b', 'maquina-b'])
    assert.deepEqual(importacoes(db).map((i) => `${i.tipo}:${i.fonte}`), ['pacote:pacote'])
    const deNovo = importarPacoteCofre(db, pb, exportado.texto, FRASE, quandoB)
    assert.equal(deNovo.importadas, 0)
    assert.deepEqual(deNovo.resultados.map((x) => x.resultado), ['ja-existe', 'ja-existe'])
    const { blob } = db.prepare("SELECT blob FROM credenciais WHERE nome = 'servico-a'").get()
    assert.ok(Buffer.from(blob).subarray(0, 6).equals(Buffer.from('OUTRO:')), 'o blob em B é da ponte de B')
  })
})))

test('exportação que não abre tudo não exporta nada e registra a falha; frase curta nem abre', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  cadastrarCredencial(db, ponte, { nome: 'servico-a', tipo: 'senha' }, 'valor-a', QUANDO)
  cadastrarCredencial(db, ponteFalsa('OUTRO:'), { nome: 'servico-b', tipo: 'senha' }, 'valor-b', QUANDO)
  assert.throws(() => exportarCofre(db, ponte, FRASE, { parametros: RAPIDO, ...QUANDO }), { name: 'CofreError', code: 'nao-abriu', message: '1 credencial(is) não abriram nesta máquina; nada foi exportado.' })
  assert.deepEqual(usos(db).map((u) => `${u.nome}:${u.resultado}`), ['servico-b:falhou-abrir'])
  const antes = ponte.chamadas.abrir
  assert.throws(() => exportarCofre(db, ponte, 'curta', QUANDO), { name: 'PacoteCofreError', code: 'frase-curta' })
  assert.equal(ponte.chamadas.abrir, antes)
})))

test('pacote importado: frase errada não grava nada, conteúdo de outro formato é recusado, item ruim é pulado', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  const conteudo = {
    formato: 'omni-cofre-conteudo', versao: 1, origem_maquina: 'maquina-a', exportado_em: QUANDO.agora,
    credenciais: [
      { nome: 'boa', tipo: 'senha', valor_b64: Buffer.from('valor-bom').toString('base64') },
      { nome: 'ruim', tipo: 'cartao', valor_b64: Buffer.from('x').toString('base64') },
      { nome: 'vazia', tipo: 'senha', valor_b64: '' }
    ],
    recadastrar: []
  }
  const texto = selarPacote(conteudo, FRASE, RAPIDO)
  assert.throws(() => importarPacoteCofre(db, ponte, texto, 'outra frase-mestra qualquer', QUANDO), { name: 'PacoteCofreError', code: 'frase-ou-pacote' })
  assert.equal(importacoes(db).length, 0)
  assert.throws(() => importarPacoteCofre(db, ponte, selarPacote({ ...conteudo, formato: 'outro' }, FRASE, RAPIDO), FRASE, QUANDO), { name: 'CofreError', code: 'pacote-invalido' })
  const r = importarPacoteCofre(db, ponte, texto, FRASE, QUANDO)
  assert.equal(r.importadas, 1)
  assert.deepEqual(r.resultados, [{ nome: 'ruim', resultado: 'invalida' }, { nome: 'vazia', resultado: 'invalida' }, { nome: 'boa', resultado: 'importada' }])
  assert.equal(usarCredencial(db, ponte, { nome: 'boa', agente: 'omni', motivo: 'teste do pacote' }, QUANDO).valor.toString('utf8'), 'valor-bom')
})))
