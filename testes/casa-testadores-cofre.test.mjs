// Testadores do cofre (§8.5): OpenAI por GET /v1/models com fetch de mentira; Sentinel nunca testa;
// tipo sem testador nem abre o valor. Conexão postgres:// vai ao fio só em loopback e sem senha na url,
// e o resultado do teste ao vivo (servidor falso) volta gravado no cofre.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { comBancoDaCasa } from '../runtime/casa/banco.mjs'
import { cadastrarCredencial, credencialPorNome, registrarTeste, rotacionarCredencial, usarCredencial } from '../runtime/casa/loja-cofre.mjs'
import { SO_LOOPBACK, URL_COM_SENHA } from '../runtime/casa/postgres-fio.mjs'
import { SEM_TESTE_SENTINEL, testarCredencial } from '../runtime/casa/testadores-cofre.mjs'
import { comServidorFalso, netEspiao } from './casa-postgres-falso.mjs'

const QUANDO = { maquina: 'maquina-a', agora: '2026-11-06T03:00:00.000Z' }

function fetchFalso(resposta, chamadas) {
  return async (url, opcoes) => {
    chamadas.push({ url, opcoes })
    if (resposta instanceof Error) throw resposta
    return { ok: resposta.status >= 200 && resposta.status < 300, status: resposta.status, body: null }
  }
}

// Ponte de mentira (a mesma da casa-loja-cofre): "sela" com uma marca e um XOR; só abre o que tem a marca dela.
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

test('OpenAI: GET /v1/models com o Bearer aparado; 200 é ok e o valor é zerado', async () => {
  const chamadas = []
  const valor = Buffer.from(' sk-teste-123 \n')
  let aberturas = 0
  const r = await testarCredencial({ tipo: 'chave-api', servico: 'openai' }, () => { aberturas += 1; return valor }, { fetch: fetchFalso({ status: 200 }, chamadas) })
  assert.deepEqual(r, { ok: true, detalhe: 'HTTP 200' })
  assert.equal(aberturas, 1)
  assert.equal(chamadas.length, 1)
  assert.equal(chamadas[0].url, 'https://api.openai.com/v1/models')
  assert.equal(chamadas[0].opcoes.headers.authorization, 'Bearer sk-teste-123')
  assert.ok(chamadas[0].opcoes.signal instanceof AbortSignal)
  assert.ok(valor.every((b) => b === 0), 'o valor foi zerado')
  assert.ok(!r.detalhe.includes('sk-teste'))
})

test('OpenAI: 401 e 403 são falha; 500 e rede caída ficam sem veredito', async () => {
  const testar = (resposta) => testarCredencial({ tipo: 'chave-api', servico: 'openai' }, () => Buffer.from('sk-x'), { fetch: fetchFalso(resposta, []) })
  assert.deepEqual(await testar({ status: 401 }), { ok: false, detalhe: 'HTTP 401' })
  assert.deepEqual(await testar({ status: 403 }), { ok: false, detalhe: 'HTTP 403' })
  assert.deepEqual(await testar({ status: 500 }), { ok: null, detalhe: 'HTTP 500' })
  assert.deepEqual(await testar(new TypeError('fetch failed')), { ok: null, detalhe: 'sem resposta (TypeError)' })
})

test('Sentinel nunca é testado: nem abre o valor, nem chama a rede', async () => {
  const chamadas = []
  let aberturas = 0
  const r = await testarCredencial({ tipo: 'chave-api', servico: 'sentinel' }, () => { aberturas += 1; return Buffer.from('x') }, { fetch: fetchFalso({ status: 200 }, chamadas) })
  assert.deepEqual(r, { ok: null, detalhe: SEM_TESTE_SENTINEL })
  assert.deepEqual([aberturas, chamadas.length], [0, 0])
})

test('tipo sem testador não abre o valor', async () => {
  let aberturas = 0
  const obter = () => { aberturas += 1; return Buffer.from('x') }
  assert.deepEqual(await testarCredencial({ tipo: 'conexao', servico: 'postgres' }, obter), { ok: null, detalhe: 'sem testador para conexao/postgres' })
  assert.deepEqual(await testarCredencial({ tipo: 'senha', servico: null }, obter), { ok: null, detalhe: 'sem testador para senha/-' })
  assert.equal(aberturas, 0)
})

test('conexão postgres:// fora do loopback ou com senha na url nem abre o valor; outro esquema ou tipo não vai ao fio', async () => {
  const net = netEspiao()
  let aberturas = 0
  const obter = () => { aberturas += 1; return Buffer.from('senha-sintetica') }
  const testar = (tipo, url) => testarCredencial({ tipo, servico: 'postgres', url, usuario: 'leitor-teste' }, obter, { net })
  assert.deepEqual(await testar('conexao', 'postgres://192.0.2.10:6543/banco-teste'), { ok: null, detalhe: SO_LOOPBACK })
  assert.deepEqual(await testar('conexao', 'postgresql://leitor-teste:segredo@127.0.0.1:6543/banco-teste'), { ok: null, detalhe: URL_COM_SENHA })
  assert.deepEqual(await testar('conexao', 'mysql://leitor-teste@127.0.0.1:6543/banco-teste'), { ok: null, detalhe: 'sem testador para conexao/postgres' })
  assert.deepEqual(await testar('senha', 'postgres://127.0.0.1:6543/banco-teste'), { ok: null, detalhe: 'sem testador para senha/postgres' })
  assert.deepEqual([aberturas, net.conexoes.length], [0, 0])
})

test('conexão postgres://: o valor sai do cofre só para o fio, volta zerado e o resultado fica gravado, antes e depois da rotação', async () => {
  const casa = mkdtempSync(join(tmpdir(), 'omni-testadores-'))
  const comCofre = (uso) => comBancoDaCasa(casa, 'cofre', uso, {})
  const ponte = ponteFalsa()
  try {
    await comServidorFalso({}, async (pg) => {
      comCofre((db) => { cadastrarCredencial(db, ponte, { nome: 'banco-teste', tipo: 'conexao', servico: 'postgres', url: `postgres://127.0.0.1:${pg.porta}/banco-teste`, usuario: 'leitor-teste' }, 'senha-sintetica', QUANDO) })
      const abertos = []
      // O uso do banco é síncrono: o valor é aberto antes do primeiro await do testador, com a conexão aberta.
      const testar = async () => {
        let pendente
        comCofre((db) => {
          const credencial = credencialPorNome(db, 'banco-teste')
          const obter = () => {
            const { valor } = usarCredencial(db, ponte, { nome: 'banco-teste', agente: 'omni', motivo: 'teste do cofre' }, QUANDO)
            abertos.push(valor)
            return valor
          }
          pendente = testarCredencial(credencial, obter)
        })
        const resultado = await pendente
        const gravada = comCofre((db) => { registrarTeste(db, 'banco-teste', resultado, QUANDO.agora); return credencialPorNome(db, 'banco-teste') })
        return { resultado, gravada }
      }
      const certo = await testar()
      assert.deepEqual(certo.resultado, { ok: true, detalhe: 'SELECT 1 respondido (SCRAM-SHA-256, sem TLS)' })
      assert.deepEqual([certo.gravada.ultimo_teste_ok, certo.gravada.ultimo_teste_em, certo.gravada.ultimo_teste_detalhe], [true, QUANDO.agora, certo.resultado.detalhe])
      comCofre((db) => { rotacionarCredencial(db, ponte, 'banco-teste', 'senha-errada', QUANDO) })
      const errado = await testar()
      assert.deepEqual(errado.resultado, { ok: false, detalhe: 'senha recusada (28P01)' })
      assert.deepEqual([errado.gravada.ultimo_teste_ok, errado.gravada.ultimo_teste_em, errado.gravada.ultimo_teste_detalhe], [false, QUANDO.agora, 'senha recusada (28P01)'])
      assert.equal(abertos.length, 2)
      assert.ok(abertos.every((valor) => valor.every((byte) => byte === 0)), 'o valor foi zerado')
    })
  } finally {
    rmSync(casa, { recursive: true, force: true })
  }
})
