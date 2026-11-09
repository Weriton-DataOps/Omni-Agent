// Apoio das suítes do testador de Postgres (não é suíte: sem .test. no nome). Um servidor de mentira
// que fala o protocolo de fio v3 em 127.0.0.1, porta 0, confere SCRAM-SHA-256 e MD5 de verdade e
// encena os desvios que o cliente tem de recusar. Registra cada mensagem e os bytes brutos recebidos.
import assert from 'node:assert/strict'
import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:net'

export const PRAZO = 5_000
const NONCE_ALHEIO = 'nonce-alheio-que-nao-estende-o-do-cliente'

// Corre o corpo contra um relógio: teste que pendura vira asserção ('o teste pendurou'), não suíte
// presa. O depois roda sempre; fechar o servidor também destrava a conversa do cliente.
export async function semPendurar(corpo, depois = async () => {}) {
  let relogio
  const prazo = new Promise((resolver) => { relogio = setTimeout(resolver, PRAZO, 'pendurou') })
  try {
    assert.equal(await Promise.race([corpo().then(() => 'terminou'), prazo]), 'terminou', 'o teste pendurou')
  } finally {
    clearTimeout(relogio)
    await depois()
  }
}

export async function comServidorFalso(opcoes, corpo) {
  const pg = await servidorPostgresFalso(opcoes)
  await semPendurar(() => corpo(pg), () => pg.fechar())
}

// net de mentira: registra cada pedido de conexão e responde como porta fechada (ECONNREFUSED), sem
// lançar, para que um cliente que fure a guarda caia na asserção e não num erro solto.
export function netEspiao() {
  const conexoes = []
  return {
    conexoes,
    connect(opcoes) {
      conexoes.push({ host: opcoes?.host, porta: opcoes?.port })
      const socket = new EventEmitter()
      Object.assign(socket, {
        destroyed: false,
        writable: false,
        destroy() { socket.destroyed = true; return socket },
        end(...argumentos) { argumentos.find((a) => typeof a === 'function')?.(); return socket },
        write() { return false },
        pause() { return socket },
        resume() { return socket }
      })
      process.nextTick(() => socket.emit('error', Object.assign(new Error('connect ECONNREFUSED (espião)'), { code: 'ECONNREFUSED' })))
      return socket
    }
  }
}

// Opções: auth ('scram' padrão, 'md5', 'trust', 'texto', 'gss', 'sasl-plus'); senha ('senha-sintetica');
// ssl ('N', 'S' ou 'S+extra': o S e um erro no mesmo write); iteracoes (1000); scram {nonceAlheio,
// assinaturaFalsa, pularFinal, salVazio, extensao}; mudo (cala depois do startup); fecharAposStartup;
// erroAposAuth (SQLSTATE depois do AuthenticationOk); selectVolta ('1'); mensagemErro (o campo M).
export async function servidorPostgresFalso(opcoes = {}) {
  const config = { auth: 'scram', senha: 'senha-sintetica', ssl: 'N', iteracoes: 1000, scram: {}, ...opcoes }
  const conexoes = []
  const servidor = createServer((socket) => atender(socket, config, conexoes))
  await new Promise((resolver) => servidor.listen(0, '127.0.0.1', resolver))
  return {
    porta: servidor.address().port,
    conexoes,
    opcoes: config,
    fim(i = 0) {
      assert.ok(conexoes[i], `a conexão ${i} não chegou ao servidor falso`)
      return conexoes[i].fechada
    },
    async fechar() {
      for (const conexao of conexoes) conexao.socket.destroy()
      await new Promise((resolver) => servidor.close(resolver))
    }
  }
}

const int16 = (n) => { const b = Buffer.alloc(2); b.writeInt16BE(n); return b }
const int32 = (n) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b }
const textoC = (texto) => Buffer.from(`${texto}\0`, 'utf8')
const lerTextoC = (corpo, inicio = 0) => corpo.toString('utf8', inicio, corpo.indexOf(0, inicio))
function mensagem(tipo, ...partes) {
  const corpo = Buffer.concat(partes)
  return Buffer.concat([Buffer.from(tipo, 'latin1'), int32(corpo.length + 4), corpo])
}
const autenticacao = (codigo, ...dados) => mensagem('R', int32(codigo), ...dados)
const erro = (codigo, texto) => mensagem('E', Buffer.from('S'), textoC('FATAL'), Buffer.from('V'), textoC('FATAL'),
  Buffer.from('C'), textoC(codigo), Buffer.from('M'), textoC(texto ?? 'falha sintetica'), Buffer.alloc(1))
const hmac = (chave, texto) => createHmac('sha256', chave).update(texto).digest()
const sha256 = (bytes) => createHash('sha256').update(bytes).digest()
const md5Hex = (...partes) => createHash('md5').update(Buffer.concat(partes)).digest('hex')
function paresDoStartup(corpo) {
  const pares = {}
  for (let i = 0; i < corpo.length && corpo[i] !== 0;) {
    const fimChave = corpo.indexOf(0, i)
    const fimValor = corpo.indexOf(0, fimChave + 1)
    pares[corpo.toString('utf8', i, fimChave)] = corpo.toString('utf8', fimChave + 1, fimValor)
    i = fimValor + 1
  }
  return pares
}

function atender(socket, config, conexoes) {
  const conexao = { socket, registros: [], bytes: [] }
  conexao.fechada = new Promise((resolver) => socket.once('close', resolver))
  conexoes.push(conexao)
  socket.on('error', () => {})
  const registrar = (tipo, extra = {}) => conexao.registros.push({ tipo, ...extra })
  const enviar = (...mensagens) => { if (!socket.destroyed && socket.writable) socket.write(Buffer.concat(mensagens)) }
  let encerrada = false
  const fatal = (codigo) => { enviar(erro(codigo, config.mensagemErro)); encerrada = true; socket.end() }
  let pendente = Buffer.alloc(0)
  let inicial = true
  let etapa = null
  let autenticada = false
  let usuario = null
  let sal = null
  let scram = null

  function autenticado() {
    autenticada = true
    etapa = null
    enviar(autenticacao(0))
    if (config.erroAposAuth) return fatal(config.erroAposAuth)
    enviar(mensagem('S', textoC('server_version'), textoC('18.0')), mensagem('K', int32(4242), int32(1234)), mensagem('Z', Buffer.from('I')))
  }
  function iniciarAutenticacao() {
    if (config.auth === 'trust') return autenticado()
    if (config.auth === 'gss') return enviar(autenticacao(7))
    if (config.auth === 'texto') { etapa = 'texto'; return enviar(autenticacao(3)) }
    if (config.auth === 'md5') { sal = randomBytes(4); etapa = 'md5'; return enviar(autenticacao(5, sal)) }
    const mecanismos = config.auth === 'sasl-plus' ? ['SCRAM-SHA-256-PLUS'] : ['SCRAM-SHA-256']
    scram = { mecanismos }
    etapa = 'sasl-inicial'
    enviar(autenticacao(10, ...mecanismos.map(textoC), Buffer.alloc(1)))
  }
  function primeiroPacote(pacote) {
    const codigo = pacote.readInt32BE(4)
    if (codigo === 80877103) {
      registrar('ssl')
      if (config.ssl === 'S+extra') return socket.write(Buffer.concat([Buffer.from('S'), erro('08P01', 'injetado antes do TLS')]))
      return socket.write(config.ssl === 'S' ? 'S' : 'N')
    }
    if (codigo === 80877104) { registrar('gssenc'); return socket.write('N') }
    if (codigo !== 196608) { registrar('desconhecido', { codigo }); return fatal('0A000') }
    const params = paresDoStartup(pacote.subarray(8))
    registrar('startup', { params })
    usuario = params.user
    inicial = false
    if (config.mudo) return
    if (config.fecharAposStartup) { encerrada = true; return socket.end() }
    iniciarAutenticacao()
  }
  function senhaDoCliente(corpo) {
    if (etapa === 'texto' || etapa === 'md5') {
      const dada = corpo.subarray(0, corpo.indexOf(0))
      const esperada = etapa === 'texto' ? Buffer.from(config.senha) : Buffer.from(`md5${md5Hex(Buffer.from(md5Hex(Buffer.from(config.senha), Buffer.from(usuario))), sal)}`)
      return dada.equals(esperada) ? autenticado() : fatal('28P01')
    }
    if (etapa === 'sasl-inicial') {
      const mecanismo = lerTextoC(corpo)
      if (!scram.mecanismos.includes(mecanismo)) return fatal('08P01')
      const inicio = Buffer.byteLength(mecanismo) + 1
      const dados = corpo.subarray(inicio + 4, inicio + 4 + corpo.readInt32BE(inicio)).toString('utf8')
      const nonceCliente = /^n,,n=[^,]*,r=([^,]+)$/.exec(dados)?.[1]
      if (!nonceCliente) return fatal('08P01')
      scram.primeiraCliente = dados.slice(3)
      scram.nonce = config.scram.nonceAlheio ? NONCE_ALHEIO : `${nonceCliente}${randomBytes(18).toString('base64')}`
      scram.sal = config.scram.salVazio ? Buffer.alloc(0) : randomBytes(16)
      scram.primeiraServidor = `${config.scram.extensao ? 'm=x,' : ''}r=${scram.nonce},s=${scram.sal.toString('base64')},i=${config.iteracoes}`
      etapa = 'sasl-final'
      return enviar(autenticacao(11, Buffer.from(scram.primeiraServidor)))
    }
    if (etapa === 'sasl-final') {
      const [, nonce, prova] = /^c=biws,r=([^,]+),p=([^,]+)$/.exec(corpo.toString('utf8')) ?? []
      if (nonce !== scram.nonce) return fatal('08P01')
      const salgada = pbkdf2Sync(Buffer.from(config.senha), scram.sal, config.iteracoes, 32, 'sha256')
      const guardada = sha256(hmac(salgada, 'Client Key'))
      const mensagemAuth = `${scram.primeiraCliente},${scram.primeiraServidor},c=biws,r=${nonce}`
      const assinaturaCliente = hmac(guardada, mensagemAuth)
      const recebida = Buffer.from(prova, 'base64')
      if (recebida.length !== 32) return fatal('28P01')
      const chaveCliente = Buffer.from(recebida.map((byte, k) => byte ^ assinaturaCliente[k]))
      if (!timingSafeEqual(sha256(chaveCliente), guardada)) return fatal('28P01')
      const chaveServidor = config.scram.assinaturaFalsa ? Buffer.from('chave-de-outro-servidor') : hmac(salgada, 'Server Key')
      if (!config.scram.pularFinal) enviar(autenticacao(12, Buffer.from(`v=${hmac(chaveServidor, mensagemAuth).toString('base64')}`)))
      return autenticado()
    }
    fatal('08P01')
  }
  function responderConsulta() {
    const valor = Buffer.from(config.selectVolta ?? '1')
    const descricao = Buffer.concat([int16(1), textoC('?column?'), int32(0), int16(0), int32(23), int16(4), int32(-1), int16(0)])
    enviar(mensagem('T', descricao), mensagem('D', int16(1), int32(valor.length), valor), mensagem('C', textoC('SELECT 1')), mensagem('Z', Buffer.from('I')))
  }
  function mensagemDoCliente(tipo, corpo) {
    if (tipo === 'X') { registrar('X'); encerrada = true; return socket.end() }
    if (tipo === 'p') { registrar('p'); return senhaDoCliente(corpo) }
    if (tipo === 'Q' && autenticada) { registrar('Q', { texto: lerTextoC(corpo) }); return responderConsulta() }
    registrar('fora-de-ordem', { tipo })
    fatal('08P01')
  }

  socket.on('data', (pedaco) => {
    conexao.bytes.push(Buffer.from(pedaco))
    pendente = Buffer.concat([pendente, pedaco])
    while (!encerrada) {
      if (inicial) {
        if (pendente.length < 8 || pendente.length < pendente.readInt32BE(0)) return
        const tamanho = pendente.readInt32BE(0)
        const pacote = pendente.subarray(0, tamanho)
        pendente = pendente.subarray(tamanho)
        primeiroPacote(pacote)
      } else {
        if (pendente.length < 5 || pendente.length < pendente.readInt32BE(1) + 1) return
        const tamanho = pendente.readInt32BE(1)
        const tipo = String.fromCharCode(pendente[0])
        const corpo = pendente.subarray(5, tamanho + 1)
        pendente = pendente.subarray(tamanho + 1)
        mensagemDoCliente(tipo, corpo)
      }
    }
  })
}
