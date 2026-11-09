// CLI do cofre (§8.1, §8.3, §8.4): rodarCofre com casa temporária e ponte de mentira; um spawn real
// do executar com filho node; e o arquivo rodando direto.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { comBancoDaCasa } from '../runtime/casa/banco.mjs'
import { usarCredencial } from '../runtime/casa/loja-cofre.mjs'
import { SEM_TESTE_SENTINEL } from '../runtime/casa/testadores-cofre.mjs'
import { casaDoCofre, rodarCofre } from '../runtime/cofre.mjs'
import { casaDoOmni } from '../runtime/memoria.mjs'

const RAIZ = fileURLToPath(new URL('..', import.meta.url))

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

function saidaFalsa() { return { texto: '', write(t) { this.texto += t; return true } } }
const entrada = (texto) => Readable.from([Buffer.from(texto, 'utf8')])
const ultimaLinha = (saida) => JSON.parse(saida.texto.trim().split('\n').at(-1))
async function comCasa(uso) {
  const casa = mkdtempSync(join(tmpdir(), 'omni-cofre-cli-'))
  const env = { ...process.env, OMNI_HOME: casa, OMNI_CASA_BANCO: join(casa, 'casa') }
  try { return await uso(casa, env) } finally { rmSync(casa, { recursive: true, force: true }) }
}
async function rodar(env, argv, { stdin = '', ponte, fetch, executar } = {}) {
  const saida = saidaFalsa(); const erro = saidaFalsa()
  const codigo = await rodarCofre(argv, { entrada: entrada(stdin), saida, erro, env, ponte, fetch, executar })
  return { codigo, saida, erro }
}

test('uso errado sai com 2, mostra o uso e nunca ecoa o argumento', async () => comCasa(async (casa, env) => {
  const ok = await rodar(env, ['listar'])
  assert.equal(ok.codigo, 0)
  assert.deepEqual(ultimaLinha(ok.saida), [])
  for (const argv of [[], ['voar'], ['cadastrar', '--nome', 'x'], ['listar', '--segredo-no-argumento']]) {
    const r = await rodar(env, argv)
    assert.equal(r.codigo, 2, JSON.stringify(argv))
    assert.ok(r.erro.texto.includes('uso: node runtime/cofre.mjs'))
    assert.ok(!r.erro.texto.includes('segredo-no-argumento'))
    assert.equal(r.saida.texto, '')
  }
}))

test('a casa do cofre é a mesma casa do Omni', () => {
  for (const env of [{ OMNI_HOME: 'rel/x' }, { APPDATA: 'C:\\A' }, {}]) assert.equal(casaDoCofre(env), casaDoOmni(env), JSON.stringify(env))
})

test('cadastrar lê o valor só da primeira linha do stdin e não o devolve na saída', async () => comCasa(async (casa, env) => {
  const ponte = ponteFalsa()
  const r = await rodar(env, ['cadastrar', '--nome', 'servico-a', '--tipo', 'senha', '--agentes', 'omni, oraculo'], { stdin: 'valor-secreto-cli\r\nsegunda linha ignorada\n', ponte })
  assert.equal(r.codigo, 0)
  assert.ok(!r.saida.texto.includes('valor-secreto-cli'))
  assert.deepEqual(ultimaLinha(r.saida).credencial.agentes, ['omni', 'oraculo'])
  const valor = comBancoDaCasa(casa, 'cofre', (db) => usarCredencial(db, ponte, { nome: 'servico-a', agente: 'omni', motivo: 'teste da cli' }).valor, env)
  assert.equal(valor.toString('utf8'), 'valor-secreto-cli')
}))

test('executar entrega o valor ao filho só pelo ambiente e devolve o código dele', async () => comCasa(async (casa, env) => {
  const ponte = ponteFalsa()
  await rodar(env, ['cadastrar', '--nome', 'servico-a', '--tipo', 'senha'], { stdin: 'valor-do-filho\n', ponte })
  const filho = join(casa, 'filho.mjs')
  writeFileSync(filho, [
    "import { createHash } from 'node:crypto'",
    "import { writeFileSync } from 'node:fs'",
    "const sha = createHash('sha256').update(process.env.SEGREDO_TESTE ?? '').digest('hex')",
    'writeFileSync(process.env.FILHO_SAIDA, JSON.stringify({ sha, argv: process.argv.slice(2) }))',
    'process.exit(7)'
  ].join('\n'))
  const saidaFilho = join(casa, 'filho.json')
  const r = await rodar({ ...env, FILHO_SAIDA: saidaFilho }, ['executar', '--nome', 'servico-a', '--variavel', 'SEGREDO_TESTE', '--motivo', 'teste do executar', '--', process.execPath, filho, 'um', 'dois'], { ponte })
  assert.equal(r.codigo, 7)
  const visto = JSON.parse(readFileSync(saidaFilho, 'utf8'))
  assert.equal(visto.sha, createHash('sha256').update('valor-do-filho').digest('hex'))
  assert.deepEqual(visto.argv, ['um', 'dois'])
  assert.ok(!r.saida.texto.includes('valor-do-filho'))
  const ultimo = comBancoDaCasa(casa, 'cofre', (db) => ({ ...db.prepare('SELECT resultado, motivo FROM usos ORDER BY rowid DESC LIMIT 1').get() }), env)
  assert.deepEqual(ultimo, { resultado: 'entregue', motivo: 'teste do executar' })
}))

test('executar recusa agente sem acesso antes de criar o filho', async () => comCasa(async (casa, env) => {
  const ponte = ponteFalsa()
  await rodar(env, ['cadastrar', '--nome', 'servico-a', '--tipo', 'senha'], { stdin: 'v\n', ponte })
  let rodou = false
  const executar = () => { rodou = true; throw new Error('o filho não devia nascer') }
  const r = await rodar(env, ['executar', '--nome', 'servico-a', '--variavel', 'X', '--motivo', 'teste', '--agente', 'overcore', '--', 'qualquer'], { ponte, executar })
  assert.equal(r.codigo, 3)
  assert.deepEqual(ultimaLinha(r.saida), { ok: false, codigo: 'agente-sem-acesso', erro: 'O agente overcore não tem acesso a servico-a.' })
  assert.equal(rodou, false)
}))

test('exportar não sobrescreve, apaga o pacote que falhou, e o pacote volta noutra casa', async () => comCasa(async (casa, env) => {
  const ponte = ponteFalsa()
  await rodar(env, ['cadastrar', '--nome', 'servico-a', '--tipo', 'senha'], { stdin: 'valor-a\n', ponte })
  const pacote = join(casa, 'cofre.pacote.json')
  const frase = 'frase-mestra da cli\n'
  const r = await rodar(env, ['exportar', '--saida', pacote], { stdin: frase, ponte })
  assert.equal(r.codigo, 0)
  const linha = ultimaLinha(r.saida)
  assert.deepEqual([linha.ok, linha.credenciais, linha.recadastrar], [true, 1, 0])
  assert.equal(linha.saida, pacote)
  const texto = readFileSync(pacote, 'utf8')
  assert.ok(!texto.includes('valor-a'))
  const repetido = await rodar(env, ['exportar', '--saida', pacote], { stdin: frase, ponte })
  assert.equal(repetido.codigo, 3)
  assert.equal(ultimaLinha(repetido.saida).codigo, 'saida-existe')
  assert.equal(readFileSync(pacote, 'utf8'), texto)
  const curta = join(casa, 'curta.json')
  const r2 = await rodar(env, ['exportar', '--saida', curta], { stdin: 'curta\n', ponte })
  assert.equal(r2.codigo, 3)
  assert.equal(ultimaLinha(r2.saida).codigo, 'frase-curta')
  assert.equal(existsSync(curta), false)
  const outra = join(casa, 'outra')
  mkdirSync(outra)
  const envOutra = { ...env, OMNI_HOME: outra, OMNI_CASA_BANCO: join(outra, 'casa') }
  const pb = ponteFalsa('OUTRO:')
  const errada = await rodar(envOutra, ['importar-pacote', '--arquivo', pacote], { stdin: 'frase errada da cli\n', ponte: pb })
  assert.equal(errada.codigo, 3)
  assert.equal(ultimaLinha(errada.saida).codigo, 'frase-ou-pacote')
  const certa = await rodar(envOutra, ['importar-pacote', '--arquivo', pacote], { stdin: frase, ponte: pb })
  assert.equal(certa.codigo, 0)
  assert.equal(ultimaLinha(certa.saida).importadas, 1)
}))

test('testar: OpenAI vai à rede com o Bearer e grava o resultado; Sentinel nunca; inexistente é recusa', async () => comCasa(async (casa, env) => {
  const ponte = ponteFalsa()
  await rodar(env, ['cadastrar', '--nome', 'chave-openai', '--tipo', 'chave-api', '--servico', 'openai'], { stdin: 'sk-teste\n', ponte })
  await rodar(env, ['cadastrar', '--nome', 'chave-sentinel', '--tipo', 'chave-api', '--servico', 'sentinel'], { stdin: 'st-teste\n', ponte })
  const chamadas = []
  const fetch = async (url, opcoes) => { chamadas.push({ url, autorizacao: opcoes.headers.authorization }); return { ok: true, status: 200, body: null } }
  const r = await rodar(env, ['testar', '--nome', 'chave-openai'], { ponte, fetch })
  assert.equal(r.codigo, 0)
  assert.deepEqual(ultimaLinha(r.saida), { ok: true, nome: 'chave-openai', teste: { ok: true, detalhe: 'HTTP 200' } })
  assert.deepEqual(chamadas, [{ url: 'https://api.openai.com/v1/models', autorizacao: 'Bearer sk-teste' }])
  const lista = ultimaLinha((await rodar(env, ['listar'])).saida)
  const openai = lista.find((c) => c.nome === 'chave-openai')
  assert.deepEqual([openai.ultimo_teste_ok, openai.ultimo_teste_detalhe], [true, 'HTTP 200'])
  const s = await rodar(env, ['testar', '--nome', 'chave-sentinel'], { ponte, fetch })
  assert.deepEqual(ultimaLinha(s.saida), { ok: true, nome: 'chave-sentinel', teste: { ok: null, detalhe: SEM_TESTE_SENTINEL } })
  assert.equal(chamadas.length, 1)
  assert.equal((await rodar(env, ['testar', '--nome', 'nao-existe'], { ponte, fetch })).codigo, 3)
}))

test('importar-dpapi pela CLI: pasta padrão da casa e classificação com BOM', async () => comCasa(async (casa, env) => {
  const ponte = ponteFalsa()
  mkdirSync(join(casa, 'access'))
  const [blob] = ponte.selar([Buffer.from('valor-a')])
  writeFileSync(join(casa, 'access', 'servico-a.dpapi'), blob)
  const classificacao = join(casa, 'classificacao.json')
  writeFileSync(classificacao, `\uFEFF${JSON.stringify({ 'servico-a': { tipo: 'chave-api', servico: 'fal' } })}`)
  const r = await rodar(env, ['importar-dpapi', '--classificacao', classificacao], { ponte })
  assert.equal(r.codigo, 0)
  assert.deepEqual(ultimaLinha(r.saida), { ok: true, importadas: 1, resultados: [{ nome: 'servico-a', resultado: 'importada' }] })
  const [c] = ultimaLinha((await rodar(env, ['listar'])).saida)
  assert.deepEqual([c.tipo, c.servico], ['chave-api', 'fal'])
  const torta = join(casa, 'torta.json')
  writeFileSync(torta, '{ isso não é json')
  assert.equal((await rodar(env, ['importar-dpapi', '--classificacao', torta], { ponte })).codigo, 2)
}))

test('o arquivo roda direto: node runtime/cofre.mjs listar', () => comCasa(async (casa, env) => {
  const r = spawnSync(process.execPath, [join(RAIZ, 'runtime', 'cofre.mjs'), 'listar'], { env, encoding: 'utf8', windowsHide: true, timeout: 60_000 })
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(JSON.parse(r.stdout.trim()), [])
}))
