// Testador de Postgres do cofre (§8.5): o fio v3 contra o servidor falso de testes/casa-postgres-falso.mjs,
// em 127.0.0.1. SCRAM e MD5 de verdade, os desvios que o cliente recusa, o alvo só em loopback e a
// senha nunca no fio.
import assert from 'node:assert/strict'
import { createServer, Socket } from 'node:net'
import test from 'node:test'

import { MAX_ITERACOES, SO_LOOPBACK, URL_COM_SENHA, alvoPostgres, provaScram, testarPostgres } from '../runtime/casa/postgres-fio.mjs'
import { comServidorFalso, netEspiao, semPendurar } from './casa-postgres-falso.mjs'

const alvo = (pg) => ({ host: '127.0.0.1', porta: pg.porta, usuario: 'leitor-teste', banco: 'banco-teste' })
const SENHA = () => Buffer.from('senha-sintetica')
const tipos = (c) => c.registros.map((r) => r.tipo)
const pedidos = (c) => tipos(c).filter((t) => t === 'p' || t === 'Q')
const bytesDe = (c) => Buffer.concat(c.bytes)

// tls de mentira: devolve o próprio socket (TLS transparente) e, no próximo tique, emite o pronto ou o erro pedido.
function tlsFalso(codigoErro = null) {
  const chamadas = []
  return {
    chamadas,
    connect(opcoes) {
      chamadas.push({ ...opcoes, porta: opcoes.socket.remotePort })
      process.nextTick(() => {
        if (codigoErro) opcoes.socket.emit('error', Object.assign(new Error('tls falso'), { code: codigoErro }))
        else opcoes.socket.emit('secureConnect')
      })
      return opcoes.socket
    }
  }
}

test('provaScram reproduz o vetor do RFC 7677', async () => {
  const primeiraServidor = 'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096'
  const { final, assinatura } = await provaScram(Buffer.from('pencil'), 'rOprNGfwEbeRWgbNEkqO', 'n=user,r=rOprNGfwEbeRWgbNEkqO', primeiraServidor)
  assert.equal(final, 'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,p=dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=')
  assert.equal(assinatura.toString('base64'), '6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=')
})

test('SCRAM sem TLS: prova a senha sem mandá-la, a quebra de linha do fim não conta, SELECT 1 e Terminate', () => comServidorFalso({}, async (pg) => {
  const r = await testarPostgres(alvo(pg), Buffer.from('senha-sintetica\r\n'))
  assert.deepEqual(r, { ok: true, detalhe: 'SELECT 1 respondido (SCRAM-SHA-256, sem TLS)' })
  await pg.fim()
  const [c] = pg.conexoes
  assert.deepEqual(tipos(c), ['ssl', 'startup', 'p', 'p', 'Q', 'X'])
  assert.deepEqual(c.registros[1].params, { user: 'leitor-teste', database: 'banco-teste', application_name: 'omni-cofre' })
  assert.equal(c.registros[4].texto, 'SELECT 1')
  assert.ok(!bytesDe(c).includes('senha-sintetica'), 'a senha não passou pelo fio')
}))

test('SCRAM: senha errada é recusa (28P01); com caractere fora do ASCII a recusa fica inconclusiva', () => comServidorFalso({}, async (pg) => {
  assert.deepEqual(await testarPostgres(alvo(pg), Buffer.from('senha-errada')), { ok: false, detalhe: 'senha recusada (28P01)' })
  assert.deepEqual(await testarPostgres(alvo(pg), Buffer.from('senha-com-acento-é')), { ok: null, detalhe: 'senha recusada (28P01), mas a senha tem caractere fora do ASCII e o teste não faz SASLprep: inconclusivo' })
}))

test('SCRAM: servidor que não se prova ou foge do formato fica sem veredito e sem consulta', async () => {
  const casos = [
    [{ scram: { nonceAlheio: true } }, 'SCRAM recusado: nonce do servidor não estende o do cliente', 1],
    [{ scram: { assinaturaFalsa: true } }, 'o servidor não provou a assinatura SCRAM', 2],
    [{ scram: { pularFinal: true } }, 'o servidor não provou a assinatura SCRAM', 2],
    [{ scram: { salVazio: true } }, 'SCRAM recusado: sal inválido', 1],
    [{ scram: { extensao: true } }, 'SCRAM recusado: extensão obrigatória sem suporte', 1],
    [{ iteracoes: MAX_ITERACOES + 1 }, 'SCRAM recusado: iterações fora do limite', 1]
  ]
  for (const [opcoes, detalhe, respostas] of casos) {
    await comServidorFalso(opcoes, async (pg) => {
      assert.deepEqual(await testarPostgres(alvo(pg), SENHA()), { ok: null, detalhe }, JSON.stringify(opcoes))
      await pg.fim()
      assert.deepEqual(pedidos(pg.conexoes[0]), Array(respostas).fill('p'), JSON.stringify(opcoes))
    })
  }
})

test('MD5: a resposta da documentação prova a senha sem mandá-la; senha errada é recusa', () => comServidorFalso({ auth: 'md5' }, async (pg) => {
  assert.deepEqual(await testarPostgres(alvo(pg), SENHA()), { ok: true, detalhe: 'SELECT 1 respondido (MD5, sem TLS)' })
  assert.deepEqual(await testarPostgres(alvo(pg), Buffer.from('senha-errada')), { ok: false, detalhe: 'senha recusada (28P01)' })
  await pg.fim(0)
  assert.ok(!bytesDe(pg.conexoes[0]).includes('senha-sintetica'), 'a senha não passou pelo fio')
}))

test('trust, texto puro, GSS e SCRAM-PLUS: sem veredito, sem senha no fio e sem consulta', async () => {
  const casos = [
    ['trust', 'o servidor não pediu senha (trust): o teste não prova a credencial'],
    ['texto', 'o servidor pediu a senha em texto puro: recusado, a senha não foi enviada'],
    ['gss', 'método de autenticação sem suporte (código 7)'],
    ['sasl-plus', 'método SASL sem suporte']
  ]
  for (const [auth, detalhe] of casos) {
    await comServidorFalso({ auth }, async (pg) => {
      assert.deepEqual(await testarPostgres(alvo(pg), SENHA()), { ok: null, detalhe }, auth)
      await pg.fim()
      assert.deepEqual(pedidos(pg.conexoes[0]), [], auth)
      assert.ok(!bytesDe(pg.conexoes[0]).includes('senha-sintetica'), `${auth}: a senha não passou pelo fio`)
    })
  }
})

test('servidor mudo esgota o tempo e ainda recebe o Terminate; servidor que cai vira queda', async () => {
  await comServidorFalso({ mudo: true }, async (pg) => {
    assert.deepEqual(await testarPostgres(alvo(pg), SENHA(), { limiteMs: 200 }), { ok: null, detalhe: 'tempo esgotado' })
    await pg.fim()
    assert.equal(pg.conexoes[0].registros.at(-1).tipo, 'X')
  })
  await comServidorFalso({ fecharAposStartup: true }, async (pg) => {
    assert.deepEqual(await testarPostgres(alvo(pg), SENHA()), { ok: null, detalhe: 'a conexão caiu no meio da conversa' })
  })
})

test('alvoPostgres: só loopback, sem senha na url e com usuário; o que fica de fora nem conecta', async () => {
  assert.deepEqual(alvoPostgres('postgres://leitor@127.0.0.1:6543/banco'), { host: '127.0.0.1', porta: 6543, usuario: 'leitor', banco: 'banco' })
  assert.deepEqual(alvoPostgres('postgresql://leitor%40x@LocalHost/b%20d'), { host: '127.0.0.1', porta: 5432, usuario: 'leitor@x', banco: 'b d' })
  assert.deepEqual(alvoPostgres('POSTGRES://[0:0:0:0:0:0:0:1]:7000', 'leitor'), { host: '::1', porta: 7000, usuario: 'leitor', banco: null })
  assert.deepEqual(alvoPostgres('postgres://leitor@127.0.0.1/banco', 'outro'), { host: '127.0.0.1', porta: 5432, usuario: 'outro', banco: 'banco' })
  const recusas = [
    ['postgres://leitor@192.0.2.10:6543/banco', SO_LOOPBACK],
    ['postgres://leitor@banco.invalid/banco', SO_LOOPBACK],
    ['postgres://leitor@127.1/banco', SO_LOOPBACK],
    ['postgres://leitor@[::ffff:127.0.0.1]/banco', SO_LOOPBACK],
    ['postgres://leitor@127.0.0.1./banco', SO_LOOPBACK],
    ['postgresql://leitor:segredo@127.0.0.1:6543/banco', URL_COM_SENHA],
    ['postgres://leitor:segredo@203.0.113.5/banco', URL_COM_SENHA],
    ['postgres://127.0.0.1:6543/banco', 'falta o usuário: preencha o campo usuario da credencial'],
    ['postgres://leitor@127.0.0.1:0/banco', 'url inválida'],
    ['postgres://leitor@127.0.0.1:99999/banco', 'url inválida'],
    ['mysql://leitor@127.0.0.1:6543/banco', 'a url não é postgres://'],
    ['nada disso', 'url inválida'],
    ['postgres://le%00itor@127.0.0.1/banco', 'o usuário ou o banco tem caractere nulo']
  ]
  for (const [url, erro] of recusas) assert.deepEqual(alvoPostgres(url), { erro }, url)
  const net = netEspiao()
  assert.deepEqual(await testarPostgres({ host: '192.0.2.10', porta: 6543, usuario: 'leitor', banco: null }, SENHA(), { net }), { ok: null, detalhe: SO_LOOPBACK })
  assert.deepEqual(await testarPostgres({ host: '127.0.0.1', porta: 6543, usuario: 'leitor', banco: null }, Buffer.from('PostgreSQL://u@127.0.0.1/x\n'), { net }), { ok: null, detalhe: 'o valor parece uma url; cadastre a senha no valor e a url no campo url' })
  assert.equal(net.conexoes.length, 0)
})

test('TLS: o S do servidor sobe o TLS sobre o mesmo socket sem conferir certificado; falha de TLS e byte injetado ficam sem veredito', async () => {
  await comServidorFalso({ ssl: 'S' }, async (pg) => {
    const tls = tlsFalso()
    assert.deepEqual(await testarPostgres(alvo(pg), SENHA(), { tls }), { ok: true, detalhe: 'SELECT 1 respondido (SCRAM-SHA-256, TLS)' })
    assert.equal(tls.chamadas.length, 1)
    const [chamada] = tls.chamadas
    assert.equal(chamada.rejectUnauthorized, false)
    assert.ok(chamada.socket instanceof Socket)
    assert.equal(chamada.porta, pg.porta)
  })
  await comServidorFalso({ ssl: 'S' }, async (pg) => {
    assert.deepEqual(await testarPostgres(alvo(pg), SENHA(), { tls: tlsFalso('ERR_SSL_WRONG_VERSION_NUMBER') }), { ok: null, detalhe: 'falha no TLS (ERR_SSL_WRONG_VERSION_NUMBER)' })
  })
  await comServidorFalso({ ssl: 'S+extra' }, async (pg) => {
    const tls = tlsFalso()
    assert.deepEqual(await testarPostgres(alvo(pg), SENHA(), { tls }), { ok: null, detalhe: 'resposta ao SSLRequest fora do protocolo' })
    assert.equal(tls.chamadas.length, 0)
  })
})

test('porta fechada: ECONNREFUSED vira a pergunta do túnel', () => semPendurar(async () => {
  const servidor = createServer()
  await new Promise((resolver) => servidor.listen(0, '127.0.0.1', resolver))
  const { port } = servidor.address()
  await new Promise((resolver) => servidor.close(resolver))
  assert.deepEqual(await testarPostgres({ host: '127.0.0.1', porta: port, usuario: 'leitor-teste', banco: null }, SENHA()), { ok: null, detalhe: 'sem conexão (ECONNREFUSED); o túnel está de pé?' })
}))

test('erro do servidor depois da senha leva só o SQLSTATE; SELECT 1 que não volta 1 fica sem veredito', async () => {
  await comServidorFalso({ erroAposAuth: '3D000', mensagemErro: 'o banco "banco-teste" não existe para leitor-teste' }, async (pg) => {
    assert.deepEqual(await testarPostgres(alvo(pg), SENHA()), { ok: null, detalhe: 'erro do servidor (SQLSTATE 3D000)' })
  })
  await comServidorFalso({ selectVolta: '2' }, async (pg) => {
    assert.deepEqual(await testarPostgres(alvo(pg), SENHA()), { ok: null, detalhe: 'o SELECT 1 não voltou 1' })
  })
})
