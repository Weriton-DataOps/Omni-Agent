// CLI do cofre, comandos do plano 5: lixeira, edição, rotação, histórico, saúde e o caminho do dono
// (revelar pelo descritor 3 e copiar), com casa temporária, ponte, presença e canal de mentira. Nenhum
// teste chama o Windows Hello nem toca a área de transferência: os dois que rodam o arquivo direto
// param antes da presença, numa casa sem credencial.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { comBancoDaCasa } from '../runtime/casa/banco.mjs'
import { usarCredencial } from '../runtime/casa/loja-cofre.mjs'
import { canalDoDono, rodarCofre } from '../runtime/cofre.mjs'

const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const LIMPA_EM = '2026-11-07T12:00:30.000Z'

// A ponte de mentira da CL, com a cópia: abre o blob, zera o que abriu e devolve a resposta combinada.
function ponteFalsa({ copia = { ok: true, limpaEm: LIMPA_EM } } = {}) {
  const chamadas = { selar: 0, abrir: 0, copiar: 0 }
  const prefixo = Buffer.from('FALSO:')
  const xor = (bytes) => { const saida = Buffer.from(bytes); for (let i = 0; i < saida.length; i++) saida[i] ^= 0x5a; return saida }
  const abrirUm = (blob) => {
    const bytes = blob instanceof Uint8Array ? Buffer.from(blob) : null
    if (!bytes || !bytes.subarray(0, prefixo.length).equals(prefixo)) return { ok: false, erro: 'CryptographicException' }
    return { ok: true, valor: xor(bytes.subarray(prefixo.length)) }
  }
  return {
    chamadas,
    selar(valores) { chamadas.selar += 1; return valores.map((valor) => Buffer.concat([prefixo, xor(valor)])) },
    abrir(blobs) { chamadas.abrir += 1; return blobs.map(abrirUm) },
    abrirParaAreaDeTransferencia(blob) {
      chamadas.copiar += 1
      const aberto = abrirUm(blob)
      if (aberto.ok) aberto.valor.fill(0)
      return copia
    }
  }
}
function presencaFalsa(resposta = { ok: true, motivo: 'ok' }) {
  const mensagens = []
  return { mensagens, verificar(mensagem) { mensagens.push(mensagem); if (resposta instanceof Error) throw resposta; return resposta } }
}
function canalFalso(aberto) {
  const escritos = []; const originais = []
  return { escritos, originais, aberto: () => aberto, escrever(bytes) { escritos.push(Buffer.from(bytes)); originais.push(bytes) } }
}

function saidaFalsa() { return { texto: '', write(t) { this.texto += t; return true } } }
const entrada = (texto) => Readable.from([Buffer.from(texto, 'utf8')])
const ultimaLinha = (saida) => JSON.parse(saida.texto.trim().split('\n').at(-1))
async function comCasa(uso) {
  const casa = mkdtempSync(join(tmpdir(), 'omni-cofre-gestao-'))
  const env = { ...process.env, OMNI_HOME: casa, OMNI_CASA_BANCO: join(casa, 'casa') }
  try { return await uso(casa, env) } finally { rmSync(casa, { recursive: true, force: true }) }
}
async function rodar(env, argv, { stdin = '', ponte, presenca, canal = canalFalso(false) } = {}) {
  const saida = saidaFalsa(); const erro = saidaFalsa()
  const codigo = await rodarCofre(argv, { entrada: entrada(stdin), saida, erro, env, ponte, presenca, canal })
  return { codigo, saida, erro }
}
const cadastrar = (env, ponte, nome, valor) => rodar(env, ['cadastrar', '--nome', nome, '--tipo', 'senha'], { stdin: `${valor}\n`, ponte })
const noCofre = (casa, env, uso) => comBancoDaCasa(casa, 'cofre', uso, env)
const usos = (casa, env) => noCofre(casa, env, (db) => db.prepare('SELECT id, agente, motivo, resultado FROM usos ORDER BY rowid').all().map((linha) => ({ ...linha })))
async function recusa(env, argv, opcoes = {}) {
  const r = await rodar(env, argv, opcoes)
  assert.equal(r.codigo, 3, JSON.stringify(argv))
  return ultimaLinha(r.saida)
}
async function usoErrado(env, argv, opcoes = {}) {
  const r = await rodar(env, argv, opcoes)
  assert.equal(r.codigo, 2, JSON.stringify(argv))
  assert.ok(r.erro.texto.includes('uso: node runtime/cofre.mjs'))
  assert.equal(r.saida.texto, '')
  return r
}

test('apagar, lixeira, restaurar e esvaziar-lixeira', async () => comCasa(async (casa, env) => {
  const ponte = ponteFalsa()
  await cadastrar(env, ponte, 'servico-a', 'valor-a')
  const apagado = await rodar(env, ['apagar', '--nome', 'servico-a'])
  assert.equal(apagado.codigo, 0)
  const { ok, id, apagado_em: apagadoEm } = ultimaLinha(apagado.saida)
  assert.equal(ok, true)
  assert.deepEqual(ultimaLinha((await rodar(env, ['listar'])).saida), [])
  assert.deepEqual(ultimaLinha((await rodar(env, ['lixeira'])).saida).map((c) => [c.id, c.nome, c.apagado_em]), [[id, 'servico-a', apagadoEm]])
  assert.equal((await recusa(env, ['apagar', '--nome', 'servico-a'])).codigo, 'inexistente')
  assert.deepEqual(ultimaLinha((await rodar(env, ['esvaziar-lixeira'])).saida), { ok: true, apagadas: 0 })
  const volta = await rodar(env, ['restaurar', '--id', id])
  assert.equal(volta.codigo, 0)
  assert.deepEqual([ultimaLinha(volta.saida).ok, ultimaLinha(volta.saida).credencial?.id], [true, id])
  assert.deepEqual(ultimaLinha((await rodar(env, ['lixeira'])).saida), [])
  assert.equal((await recusa(env, ['restaurar', '--id', 'nao-e-id'])).codigo, 'dados-invalidos')
  await rodar(env, ['apagar', '--nome', 'servico-a'])
  noCofre(casa, env, (db) => db.prepare('UPDATE credenciais SET apagado_em = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', id))
  assert.deepEqual(ultimaLinha((await rodar(env, ['esvaziar-lixeira'])).saida), { ok: true, apagadas: 1 })
  assert.deepEqual(ultimaLinha((await rodar(env, ['lixeira'])).saida), [])
  for (const argv of [['apagar'], ['restaurar'], ['lixeira', '--tudo'], ['esvaziar-lixeira', '--forca']]) await usoErrado(env, argv)
}))

test('editar recebe as mudanças em JSON e devolve a credencial', async () => comCasa(async (casa, env) => {
  const ponte = ponteFalsa()
  await cadastrar(env, ponte, 'servico-a', 'valor-a')
  const mudancas = { servico: 'fal', agentes: ['omni', 'oraculo'], validade: '2027-01-01T00:00:00.000Z' }
  const r = await rodar(env, ['editar', '--nome', 'servico-a', '--mudancas', JSON.stringify(mudancas)])
  assert.equal(r.codigo, 0)
  const { ok, credencial } = ultimaLinha(r.saida)
  assert.deepEqual([ok, credencial.servico, credencial.agentes, credencial.validade, credencial.versao], [true, 'fal', ['omni', 'oraculo'], '2027-01-01T00:00:00.000Z', 2])
  const torto = await usoErrado(env, ['editar', '--nome', 'servico-a', '--mudancas', '{torto'])
  assert.ok(!torto.erro.texto.includes('torto'))
  await usoErrado(env, ['editar', '--nome', 'servico-a'])
  assert.equal((await recusa(env, ['editar', '--nome', 'servico-a', '--mudancas', '[]'])).codigo, 'dados-invalidos')
  assert.equal((await recusa(env, ['editar', '--nome', 'servico-a', '--mudancas', '{"nome":"outro"}'])).codigo, 'dados-invalidos')
  assert.equal((await recusa(env, ['editar', '--nome', 'servico-a', '--mudancas', '{"agentes":["dono"]}'])).codigo, 'agente-reservado')
  assert.equal((await recusa(env, ['editar', '--nome', 'nao-existe', '--mudancas', '{}'])).codigo, 'inexistente')
}))

test('rotacionar lê o valor novo só da primeira linha do stdin e não o devolve', async () => comCasa(async (casa, env) => {
  const ponte = ponteFalsa()
  await cadastrar(env, ponte, 'servico-a', 'valor-velho')
  const r = await rodar(env, ['rotacionar', '--nome', 'servico-a'], { stdin: 'valor-novo\r\nsegunda linha ignorada\n', ponte })
  assert.equal(r.codigo, 0)
  assert.ok(!r.saida.texto.includes('valor-novo'))
  assert.deepEqual([ultimaLinha(r.saida).ok, ultimaLinha(r.saida).credencial.versao], [true, 2])
  const valor = noCofre(casa, env, (db) => usarCredencial(db, ponte, { nome: 'servico-a', agente: 'omni', motivo: 'teste da rotacao' }).valor)
  assert.equal(valor.toString('utf8'), 'valor-novo')
  assert.equal((await recusa(env, ['rotacionar', '--nome', 'servico-a'], { stdin: '\n', ponte })).codigo, 'valor-vazio')
  assert.equal((await recusa(env, ['rotacionar', '--nome', 'nao-existe'], { stdin: 'v\n', ponte })).codigo, 'inexistente')
  await usoErrado(env, ['rotacionar'], { stdin: 'v\n', ponte })
  const noArgumento = await usoErrado(env, ['rotacionar', '--nome', 'servico-a', '--valor', 'segredo-no-argumento'], { ponte })
  assert.ok(!noArgumento.erro.texto.includes('segredo-no-argumento'))
}))

test('historico por nome ou por id, do mais novo ao mais velho, com limite; vale na lixeira', async () => comCasa(async (casa, env) => {
  const ponte = ponteFalsa()
  await cadastrar(env, ponte, 'servico-a', 'valor-a')
  for (const motivo of ['primeiro', 'segundo']) noCofre(casa, env, (db) => usarCredencial(db, ponte, { nome: 'servico-a', agente: 'omni', motivo }).valor.fill(0))
  const porNome = ultimaLinha((await rodar(env, ['historico', '--nome', 'servico-a'])).saida)
  assert.equal(porNome.ok, true)
  assert.deepEqual(porNome.usos.map((u) => [u.motivo, u.resultado]), [['segundo', 'entregue'], ['primeiro', 'entregue']])
  const [{ id }] = ultimaLinha((await rodar(env, ['listar'])).saida)
  assert.deepEqual(ultimaLinha((await rodar(env, ['historico', '--id', id])).saida), porNome)
  assert.deepEqual(ultimaLinha((await rodar(env, ['historico', '--id', id, '--limite', '1'])).saida).usos.map((u) => u.motivo), ['segundo'])
  for (const limite of ['0', 'abc', '501']) assert.equal((await recusa(env, ['historico', '--id', id, '--limite', limite])).codigo, 'dados-invalidos', limite)
  await rodar(env, ['apagar', '--nome', 'servico-a'])
  assert.equal((await recusa(env, ['historico', '--nome', 'servico-a'])).codigo, 'inexistente')
  assert.deepEqual(ultimaLinha((await rodar(env, ['historico', '--id', id])).saida), porNome)
  await usoErrado(env, ['historico'])
  await usoErrado(env, ['historico', '--id', id, '--nome', 'servico-a'])
}))

test('saude sem duplicata não abre blob; com --duplicatas, abre numa chamada e devolve só os nomes', async () => comCasa(async (casa, env) => {
  const ponte = ponteFalsa()
  await cadastrar(env, ponte, 'servico-a', 'mesmo-valor')
  await cadastrar(env, ponte, 'servico-b', 'mesmo-valor')
  await cadastrar(env, ponte, 'servico-c', 'outro-valor')
  const r = await rodar(env, ['saude'], { ponte })
  assert.equal(r.codigo, 0)
  assert.deepEqual(ultimaLinha(r.saida), { ok: true, total: 3, alertas: [], duplicatas: null })
  assert.equal(ponte.chamadas.abrir, 0)
  const d = await rodar(env, ['saude', '--duplicatas'], { ponte })
  assert.equal(d.codigo, 0)
  assert.deepEqual(ultimaLinha(d.saida), { ok: true, total: 3, alertas: [], duplicatas: { pares: [['servico-a', 'servico-b']], naoAbriram: [] } })
  assert.equal(ponte.chamadas.abrir, 1)
  assert.ok(!d.saida.texto.includes('mesmo-valor'))
  await usoErrado(env, ['saude', '--duplicatas=sim'], { ponte })
}))

test('revelar sem o canal recusa antes de pedir a presença e antes de abrir o blob', async () => comCasa(async (casa, env) => {
  const ponte = ponteFalsa()
  await cadastrar(env, ponte, 'teste-hello', 'valor-revelado')
  const presenca = presencaFalsa()
  const antes = usos(casa, env)
  assert.deepEqual(await recusa(env, ['revelar', '--nome', 'teste-hello'], { ponte, presenca, canal: canalFalso(false) }), {
    ok: false, codigo: 'sem-canal', erro: 'O revelar entrega o valor só pelo descritor 3, e ele não está aberto.'
  })
  assert.deepEqual(presenca.mensagens, [])
  assert.equal(ponte.chamadas.abrir, 0)
  assert.deepEqual(usos(casa, env), antes)
}))

test('revelar com o canal: o valor sai só pelo canal e é zerado; recusa, inexistente e presença que quebra', async () => comCasa(async (casa, env) => {
  const ponte = ponteFalsa()
  await cadastrar(env, ponte, 'teste-hello', 'valor-revelado')
  const presenca = presencaFalsa(); const canal = canalFalso(true)
  const r = await rodar(env, ['revelar', '--nome', 'teste-hello'], { ponte, presenca, canal })
  assert.equal(r.codigo, 0)
  const linha = ultimaLinha(r.saida)
  assert.deepEqual(Object.keys(linha), ['ok', 'nome', 'usoId'])
  assert.deepEqual([linha.ok, linha.nome], [true, 'teste-hello'])
  assert.deepEqual(canal.escritos.map((bytes) => bytes.toString('utf8')), ['valor-revelado'])
  assert.ok(canal.originais[0].every((byte) => byte === 0), 'o valor entregue ao canal foi zerado')
  assert.ok(!r.saida.texto.includes('valor-revelado') && !r.erro.texto.includes('valor-revelado'))
  assert.deepEqual(presenca.mensagens, ['Omni: mostrar a credencial teste-hello'])
  assert.deepEqual(usos(casa, env).at(-1), { id: linha.usoId, agente: 'dono', motivo: 'ver', resultado: 'revelado-ao-dono' })

  const cancelado = canalFalso(true)
  assert.deepEqual(await recusa(env, ['revelar', '--nome', 'teste-hello'], { ponte, presenca: presencaFalsa({ ok: false, motivo: 'cancelado' }), canal: cancelado }), {
    ok: false, codigo: 'sem-presenca', erro: 'A presença do dono não foi confirmada (cancelado).'
  })
  assert.deepEqual(cancelado.escritos, [])
  const ninguem = presencaFalsa()
  assert.equal((await recusa(env, ['revelar', '--nome', 'nao-existe'], { ponte, presenca: ninguem, canal: canalFalso(true) })).codigo, 'inexistente')
  assert.deepEqual(ninguem.mensagens, [])

  const quebrado = canalFalso(true)
  const q = await rodar(env, ['revelar', '--nome', 'teste-hello'], { ponte, presenca: presencaFalsa(new Error('hello quebrou')), canal: quebrado })
  assert.equal(q.codigo, 1)
  assert.ok(q.erro.texto.includes('falha inesperada no cofre: hello quebrou'))
  assert.deepEqual(quebrado.escritos, [])
  assert.equal(usos(casa, env).at(-1).resultado, 'recusado-presenca')
  const semNome = presencaFalsa()
  await usoErrado(env, ['revelar'], { ponte, presenca: semNome, canal: canalFalso(true) })
  assert.deepEqual(semNome.mensagens, [])
}))

test('copiar devolve só o uso e a hora da limpeza, nunca o valor', async () => comCasa(async (casa, env) => {
  const ponte = ponteFalsa()
  await cadastrar(env, ponte, 'teste-hello', 'valor-copiado')
  const presenca = presencaFalsa()
  const r = await rodar(env, ['copiar', '--nome', 'teste-hello'], { ponte, presenca })
  assert.equal(r.codigo, 0)
  const linha = ultimaLinha(r.saida)
  assert.deepEqual(linha, { ok: true, nome: 'teste-hello', usoId: linha.usoId, limpaEm: LIMPA_EM })
  assert.equal(typeof linha.usoId, 'string')
  assert.ok(!r.saida.texto.includes('valor-copiado') && !r.erro.texto.includes('valor-copiado'))
  assert.equal(ponte.chamadas.copiar, 1)
  assert.deepEqual(presenca.mensagens, ['Omni: copiar a credencial teste-hello'])
  assert.deepEqual(usos(casa, env).at(-1), { id: linha.usoId, agente: 'dono', motivo: 'copiar', resultado: 'copiado-ao-dono' })
  assert.deepEqual(await recusa(env, ['copiar', '--nome', 'teste-hello'], { ponte: ponteFalsa({ copia: { ok: false, erro: 'ocupada' } }), presenca }), {
    ok: false, codigo: 'nao-copiou', erro: 'teste-hello não foi copiada (ocupada).'
  })
  const naoConfirmou = ponteFalsa()
  assert.equal((await recusa(env, ['copiar', '--nome', 'teste-hello'], { ponte: naoConfirmou, presenca: presencaFalsa({ ok: false, motivo: 'tempo' }) })).codigo, 'sem-presenca')
  assert.equal(naoConfirmou.chamadas.copiar, 0)
}))

test('canalDoDono: arquivo aberto é canal, dispositivo não; escrever entrega tudo e fecha o descritor', () => comCasa(async (casa) => {
  const arquivo = join(casa, 'canal.bin')
  const canal = canalDoDono(openSync(arquivo, 'w'))
  assert.equal(canal.aberto(), true)
  canal.escrever(Buffer.from('valor pelo canal'))
  assert.equal(canal.aberto(), false, 'escrever fecha o descritor')
  assert.equal(readFileSync(arquivo, 'utf8'), 'valor pelo canal')
  const nulo = openSync(process.platform === 'win32' ? '\\\\.\\NUL' : '/dev/null', 'w')
  try { assert.equal(canalDoDono(nulo).aberto(), false, 'um dispositivo aberto, como o console, não é o canal') } finally { closeSync(nulo) }
}))

test('o arquivo roda direto: revelar sem o fd 3 dá sem-canal; com o fd 3 em pipe, chega ao cofre', () => comCasa(async (casa, env) => {
  const cofre = join(RAIZ, 'runtime', 'cofre.mjs')
  const opcoes = { env, encoding: 'utf8', windowsHide: true, timeout: 60_000 }
  const sem = spawnSync(process.execPath, [cofre, 'revelar', '--nome', 'nao-existe'], opcoes)
  assert.equal(sem.status, 3, sem.stderr)
  assert.equal(JSON.parse(sem.stdout.trim()).codigo, 'sem-canal')
  const com = spawnSync(process.execPath, [cofre, 'revelar', '--nome', 'nao-existe'], { ...opcoes, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] })
  assert.equal(com.status, 3, com.stderr)
  assert.equal(JSON.parse(com.stdout.trim()).codigo, 'inexistente')
}))
