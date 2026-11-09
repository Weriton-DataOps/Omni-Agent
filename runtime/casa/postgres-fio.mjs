// Testador de Postgres do cofre (§8.5): fala o protocolo de fio do Postgres (v3) direto, sem
// dependência, e só em loopback: a porta local é o túnel SSH. Prova a credencial com SCRAM-SHA-256
// ou MD5 e um SELECT 1. Trust não prova nada e texto puro entregaria a senha: os dois ficam sem
// veredito. O detalhe nunca leva a senha, o usuário nem a mensagem do servidor, só o SQLSTATE.
import { createHash, createHmac, pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto'
import netPadrao from 'node:net'
import tlsPadrao from 'node:tls'
import { promisify } from 'node:util'

export const SO_LOOPBACK = 'só testo em loopback (127.0.0.1, ::1 ou localhost): suba o túnel e cadastre a url local'
export const URL_COM_SENHA = 'a url traz senha: tire a senha da url, ela mora no valor'
export const MAX_ITERACOES = 1_000_000

// Nome nunca é resolvido: localhost vira 127.0.0.1 aqui mesmo, e o resto do mundo fica de fora.
const LOOPBACK = new Map([['127.0.0.1', '127.0.0.1'], ['[::1]', '::1'], ['localhost', '127.0.0.1']])
const HOSTS_LOOPBACK = new Set(LOOPBACK.values())
const MAX_MENSAGEM = 1 << 20
const QUEDA = 'a conexão caiu no meio da conversa'
const VALOR_URL = 'o valor parece uma url; cadastre a senha no valor e a url no campo url'
const SSL_REQUEST = Buffer.from([0x00, 0x00, 0x00, 0x08, 0x04, 0xd2, 0x16, 0x2f])
const TERMINATE = Buffer.from([0x58, 0x00, 0x00, 0x00, 0x04])
const PREFIXOS_URL = ['postgres://', 'postgresql://'].map((prefixo) => Buffer.from(prefixo))
const DIGITOS_HEX = Buffer.from('0123456789abcdef')
const pbkdf2Assincrono = promisify(pbkdf2)

// Desfecho do protocolo que vira resultado: ok null (não deu para saber) ou false (senha recusada).
class FalhaFio extends Error {
  constructor(detalhe, ok = null) { super(detalhe); this.resultado = { ok, detalhe } }
}

// Da url da credencial ao alvo do teste. A senha nunca mora na url; o host tem de ser loopback.
export function alvoPostgres(url, usuario) {
  let u
  try { u = new URL(url) } catch { return { erro: 'url inválida' } }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') return { erro: 'a url não é postgres://' }
  if (u.password !== '') return { erro: URL_COM_SENHA }
  const host = LOOPBACK.get(u.hostname.toLowerCase())
  if (!host) return { erro: SO_LOOPBACK }
  const porta = u.port === '' ? 5432 : Number(u.port)
  if (porta < 1) return { erro: 'url inválida' }
  let doUrl, banco
  try {
    doUrl = decodeURIComponent(u.username)
    banco = decodeURIComponent(u.pathname.slice(1))
  } catch { return { erro: 'url inválida' } }
  const quem = usuario || doUrl
  if (!quem) return { erro: 'falta o usuário: preencha o campo usuario da credencial' }
  if (quem.includes('\0') || banco.includes('\0')) return { erro: 'o usuário ou o banco tem caractere nulo' }
  return { host, porta, usuario: quem, banco: banco || null }
}

// Testa a senha (o valor do cofre) contra o alvo. Todo desfecho do protocolo vira {ok, detalhe}: ok
// true (provou), false (o servidor recusou a senha) ou null (não deu para saber).
export async function testarPostgres(alvo, valor, { net = netPadrao, tls = tlsPadrao, limiteMs = 10_000 } = {}) {
  if (!HOSTS_LOOPBACK.has(alvo?.host)) return { ok: null, detalhe: SO_LOOPBACK }
  const senha = semQuebraFinal(valor)
  if (pareceUrl(senha)) return { ok: null, detalhe: VALOR_URL }
  const pilha = []
  let relogio
  const esgotou = new Promise((resolver) => { relogio = setTimeout(resolver, limiteMs, { ok: null, detalhe: 'tempo esgotado' }) })
  const conversa = conversar(alvo, senha, { net, tls, pilha })
  conversa.catch(() => {})
  try {
    return await Promise.race([conversa, esgotou])
  } finally {
    clearTimeout(relogio)
    encerrar(pilha)
  }
}

// Valor colado da área de transferência costuma trazer a quebra de linha do fim: ela não é senha.
function semQuebraFinal(valor) {
  let fim = valor.length
  while (fim > 0 && (valor[fim - 1] === 0x0a || valor[fim - 1] === 0x0d)) fim -= 1
  return valor.subarray(0, fim)
}
// Compara byte a byte, sem virar texto: as letras do prefixo aceitam maiúscula.
function pareceUrl(senha) {
  return PREFIXOS_URL.some((prefixo) => senha.length >= prefixo.length &&
    prefixo.every((byte, i) => (byte >= 0x61 && byte <= 0x7a ? senha[i] | 0x20 : senha[i]) === byte))
}

async function conversar(alvo, senha, { net, tls, pilha }) {
  try {
    const bruto = await aguardar(net.connect({ host: alvo.host, port: alvo.porta }), 'connect', pilha,
      (erro) => (erro?.code === 'ECONNREFUSED' ? 'sem conexão (ECONNREFUSED); o túnel está de pé?' : `sem conexão (${codigoSeguro(erro)})`))
    bruto.write(SSL_REQUEST)
    const resposta = await respostaAoSsl(bruto)
    let socket = bruto
    let comTls = false
    if (resposta === 'S') {
      // O túnel SSH já autentica o servidor de salto e cifra o caminho até ele, e a casa não tem a CA
      // do banco para conferir o certificado: o TLS aqui só atende ao pedido do servidor (hostssl).
      socket = await aguardar(tls.connect({ socket: bruto, rejectUnauthorized: false }), 'secureConnect', pilha,
        (erro) => `falha no TLS (${codigoSeguro(erro)})`)
      comTls = true
    } else if (resposta !== 'N') {
      throw new FalhaFio('resposta ao SSLRequest fora do protocolo')
    }
    const leitor = new Leitor(socket)
    socket.write(mensagemInicial(alvo))
    const metodo = await autenticar(socket, leitor, alvo, senha)
    return await provar(socket, leitor, metodo, senha, comTls)
  } catch (erro) {
    if (erro instanceof FalhaFio) return erro.resultado
    throw erro
  }
}

// Espera o evento de pronto de um socket; erro e queda viram FalhaFio. O socket entra na pilha antes,
// para o encerramento alcançar até o que não chegou a ficar pronto.
function aguardar(socket, evento, pilha, descreverErro) {
  const item = { socket, pronto: false }
  pilha.push(item)
  socket.on('error', () => {})
  return new Promise((resolver, rejeitar) => {
    const limpar = () => { socket.off(evento, aoPronto); socket.off('error', aoErro); socket.off('close', aoCair) }
    const aoPronto = () => { limpar(); item.pronto = true; resolver(socket) }
    const aoErro = (erro) => { limpar(); rejeitar(new FalhaFio(descreverErro(erro))) }
    const aoCair = () => { limpar(); rejeitar(new FalhaFio(QUEDA)) }
    socket.once(evento, aoPronto)
    socket.once('error', aoErro)
    socket.once('close', aoCair)
  })
}

// A resposta ao SSLRequest é um byte só. Byte a mais junto do 'S' seria texto injetado antes do TLS
// (o golpe do CVE-2021-23222 contra a libpq): recusa. O socket fica pausado para o próximo dono.
function respostaAoSsl(socket) {
  return new Promise((resolver, rejeitar) => {
    const limpar = () => { socket.pause(); socket.off('data', aoDado); socket.off('end', aoCair); socket.off('close', aoCair) }
    const aoDado = (pedaco) => {
      limpar()
      if (pedaco.length !== 1) rejeitar(new FalhaFio('resposta ao SSLRequest fora do protocolo'))
      else resolver(String.fromCharCode(pedaco[0]))
    }
    const aoCair = () => { limpar(); rejeitar(new FalhaFio(QUEDA)) }
    socket.on('data', aoDado)
    socket.once('end', aoCair)
    socket.once('close', aoCair)
  })
}

// Junta os pedaços do socket e entrega mensagens inteiras (tipo, Int32 de tamanho e corpo). Depois da
// queda, o que já chegou ainda é lido; só a falta de bytes vira FalhaFio.
class Leitor {
  #pedacos = []
  #tamanho = 0
  #caiu = false
  #acordar = null
  constructor(socket) {
    const cair = () => { this.#caiu = true; this.#sinal() }
    socket.on('data', (pedaco) => { this.#pedacos.push(pedaco); this.#tamanho += pedaco.length; this.#sinal() })
    socket.on('end', cair)
    socket.on('close', cair)
    socket.on('error', cair)
    socket.resume()
  }
  #sinal() { const acordar = this.#acordar; this.#acordar = null; acordar?.() }
  async #bytes(n) {
    while (this.#tamanho < n) {
      if (this.#caiu) throw new FalhaFio(QUEDA)
      await new Promise((resolver) => { this.#acordar = resolver })
    }
    const tudo = Buffer.concat(this.#pedacos, this.#tamanho)
    this.#pedacos = tudo.length > n ? [tudo.subarray(n)] : []
    this.#tamanho = tudo.length - n
    return tudo.subarray(0, n)
  }
  async mensagem() {
    const cabeca = await this.#bytes(5)
    const tamanho = cabeca.readInt32BE(1)
    if (tamanho < 4 || tamanho > MAX_MENSAGEM) throw new FalhaFio('mensagem fora do protocolo')
    return { tipo: String.fromCharCode(cabeca[0]), corpo: await this.#bytes(tamanho - 4) }
  }
}

const textoC = (texto) => Buffer.from(`${texto}\0`, 'utf8')
function mensagem(tipo, ...partes) {
  const corpo = Buffer.concat(partes)
  const cabeca = Buffer.alloc(5)
  cabeca.write(tipo, 0, 'latin1')
  cabeca.writeInt32BE(corpo.length + 4, 1)
  return Buffer.concat([cabeca, corpo])
}
// StartupMessage do protocolo 3.0 (196608): sem byte de tipo, pares chave/valor e um zero no fim.
function mensagemInicial({ usuario, banco }) {
  const pares = [['user', usuario], ...(banco ? [['database', banco]] : []), ['application_name', 'omni-cofre']]
  const corpo = Buffer.concat([...pares.flatMap(([chave, valor]) => [textoC(chave), textoC(valor)]), Buffer.alloc(1)])
  const cabeca = Buffer.alloc(8)
  cabeca.writeInt32BE(corpo.length + 8, 0)
  cabeca.writeInt32BE(196608, 4)
  return Buffer.concat([cabeca, corpo])
}

// Conduz a autenticação até o AuthenticationOk e devolve o método que provou a senha.
async function autenticar(socket, leitor, alvo, senha) {
  let metodo = null
  let scram = null
  for (;;) {
    const { tipo, corpo } = await leitor.mensagem()
    if (tipo === 'E') throw falhaDoServidor(corpo, metodo, senha)
    if (tipo === 'N') continue
    if (tipo !== 'R' || corpo.length < 4) throw new FalhaFio('mensagem fora do protocolo')
    const codigo = corpo.readInt32BE(0)
    const dados = corpo.subarray(4)
    if (codigo === 0) {
      if (!metodo) throw new FalhaFio('o servidor não pediu senha (trust): o teste não prova a credencial')
      if (scram && !scram.provada) throw new FalhaFio('o servidor não provou a assinatura SCRAM')
      return metodo
    }
    if (codigo === 3) throw new FalhaFio('o servidor pediu a senha em texto puro: recusado, a senha não foi enviada')
    if (codigo === 5 && dados.length === 4) {
      metodo = 'MD5'
      socket.write(mensagem('p', respostaMd5(senha, alvo.usuario, dados)))
    } else if (codigo === 10) {
      if (!dados.toString('utf8').split('\0').includes('SCRAM-SHA-256')) throw new FalhaFio('método SASL sem suporte')
      metodo = 'SCRAM-SHA-256'
      const nonce = randomBytes(18).toString('base64')
      scram = { nonce, primeira: `n=,r=${nonce}`, assinatura: null, provada: false }
      const inicial = Buffer.from(`n,,${scram.primeira}`)
      const tamanho = Buffer.alloc(4)
      tamanho.writeInt32BE(inicial.length)
      socket.write(mensagem('p', textoC('SCRAM-SHA-256'), tamanho, inicial))
    } else if (codigo === 11 && scram && !scram.assinatura) {
      const { final, assinatura } = await provaScram(senha, scram.nonce, scram.primeira, dados.toString('utf8'))
      scram.assinatura = assinatura
      socket.write(mensagem('p', Buffer.from(final)))
    } else if (codigo === 12 && scram?.assinatura && !scram.provada) {
      const verificador = dados.toString('utf8').split(',')[0]
      const recebida = verificador.startsWith('v=') ? Buffer.from(verificador.slice(2), 'base64') : Buffer.alloc(0)
      if (recebida.length !== scram.assinatura.length || !timingSafeEqual(recebida, scram.assinatura)) throw new FalhaFio('o servidor não provou a assinatura SCRAM')
      scram.provada = true
    } else {
      throw new FalhaFio(`método de autenticação sem suporte (código ${codigo})`)
    }
  }
}

// MD5 da documentação: 'md5' + md5(md5(senha ‖ usuário) em hex ‖ sal) em hex, sem copiar a senha.
// O md5(senha ‖ usuário) vale a senha nesse método (é o que o servidor guarda): sai zerado, nas duas formas.
function respostaMd5(senha, usuario, sal) {
  const bruto = createHash('md5').update(senha).update(usuario, 'utf8').digest()
  const interno = hex(bruto)
  const externo = hex(createHash('md5').update(interno).update(sal).digest())
  for (const segredo of [bruto, interno]) segredo.fill(0)
  return Buffer.concat([Buffer.from('md5'), externo, Buffer.alloc(1)])
}
function hex(bytes) {
  const saida = Buffer.alloc(bytes.length * 2)
  for (let i = 0; i < bytes.length; i++) {
    saida[2 * i] = DIGITOS_HEX[bytes[i] >> 4]
    saida[2 * i + 1] = DIGITOS_HEX[bytes[i] & 15]
  }
  return saida
}

const hmac = (chave, texto) => createHmac('sha256', chave).update(texto).digest()
// SCRAM-SHA-256 do lado do cliente (RFC 5802 e 7677), sem channel binding (c=biws). Confere a
// primeira mensagem do servidor antes de derivar a chave e zera as chaves derivadas no fim.
export async function provaScram(senha, nonceCliente, primeiraCliente, primeiraServidor) {
  const recusa = (motivo) => new FalhaFio(`SCRAM recusado: ${motivo}`)
  if (primeiraServidor.startsWith('m=')) throw recusa('extensão obrigatória sem suporte')
  const [r, s, i] = primeiraServidor.split(',')
  if (!r?.startsWith('r=') || !s?.startsWith('s=') || !i?.startsWith('i=')) throw recusa('mensagem do servidor fora do formato')
  const nonce = r.slice(2)
  if (!nonce.startsWith(nonceCliente) || nonce.length === nonceCliente.length) throw recusa('nonce do servidor não estende o do cliente')
  const sal = Buffer.from(s.slice(2), 'base64')
  if (sal.length === 0 || sal.toString('base64') !== s.slice(2)) throw recusa('sal inválido')
  const iteracoes = i.slice(2)
  if (!/^[1-9][0-9]*$/.test(iteracoes) || Number(iteracoes) > MAX_ITERACOES) throw recusa('iterações fora do limite')
  const salgada = await pbkdf2Assincrono(senha, sal, Number(iteracoes), 32, 'sha256')
  const chaveCliente = hmac(salgada, 'Client Key')
  const guardada = createHash('sha256').update(chaveCliente).digest()
  const chaveServidor = hmac(salgada, 'Server Key')
  const semProva = `c=biws,r=${nonce}`
  const autenticacao = `${primeiraCliente},${primeiraServidor},${semProva}`
  const assinaturaCliente = hmac(guardada, autenticacao)
  const prova = Buffer.alloc(32)
  for (let k = 0; k < 32; k++) prova[k] = chaveCliente[k] ^ assinaturaCliente[k]
  const assinatura = hmac(chaveServidor, autenticacao)
  for (const chave of [salgada, chaveCliente, guardada, chaveServidor]) chave.fill(0)
  return { final: `${semProva},p=${prova.toString('base64')}`, assinatura }
}

// ErrorResponse: só o SQLSTATE (campo C) entra no detalhe; a mensagem (M) pode citar usuário e banco.
function falhaDoServidor(corpo, metodo, senha) {
  const campo = campoDoErro(corpo, 0x43)
  const sqlstate = /^[0-9A-Z]{5}$/.test(campo) ? campo : 'inválido'
  if (sqlstate !== '28P01') return new FalhaFio(`erro do servidor (SQLSTATE ${sqlstate})`)
  // No SCRAM, servidor e libpq passam a senha pelo SASLprep, que só mexe fora do ASCII; o teste não o
  // repete, então com byte acima de 0x7F a recusa pode ser só a normalização: fica inconclusiva.
  if (metodo === 'SCRAM-SHA-256' && senha.some((byte) => byte > 0x7f)) {
    return new FalhaFio('senha recusada (28P01), mas a senha tem caractere fora do ASCII e o teste não faz SASLprep: inconclusivo')
  }
  return new FalhaFio('senha recusada (28P01)', false)
}
function campoDoErro(corpo, campo) {
  for (let i = 0; i < corpo.length && corpo[i] !== 0;) {
    const fim = corpo.indexOf(0, i + 1)
    if (fim < 0) return ''
    if (corpo[i] === campo) return corpo.subarray(i + 1, fim).toString('latin1')
    i = fim + 1
  }
  return ''
}

// Depois do AuthenticationOk vêm parâmetros até o ReadyForQuery; aí vai o SELECT 1, que tem de voltar 1.
async function provar(socket, leitor, metodo, senha, comTls) {
  await ateProntoParaConsulta(leitor, metodo, senha, ['S', 'K', 'N'])
  socket.write(mensagem('Q', textoC('SELECT 1')))
  let um = false
  await ateProntoParaConsulta(leitor, metodo, senha, ['T', 'C', 'N', 'S'], (corpo) => { um = linhaComUm(corpo) })
  if (!um) return { ok: null, detalhe: 'o SELECT 1 não voltou 1' }
  return { ok: true, detalhe: `SELECT 1 respondido (${metodo}, ${comTls ? 'TLS' : 'sem TLS'})` }
}
async function ateProntoParaConsulta(leitor, metodo, senha, ignorados, aoDado = null) {
  for (;;) {
    const { tipo, corpo } = await leitor.mensagem()
    if (tipo === 'Z') return
    if (tipo === 'E') throw falhaDoServidor(corpo, metodo, senha)
    if (tipo === 'D' && aoDado) aoDado(corpo)
    else if (!ignorados.includes(tipo)) throw new FalhaFio('mensagem fora do protocolo')
  }
}
// DataRow com uma coluna de um byte: o texto '1'.
const linhaComUm = (corpo) => corpo.length === 7 && corpo.readInt16BE(0) === 1 && corpo.readInt32BE(2) === 1 && corpo[6] === 0x31

// Fecha com educação quando dá: Terminate ('X') pelo socket de cima e, depois, derruba a pilha toda.
// Socket que não ficou pronto (conectando, TLS no meio) só é derrubado.
function encerrar(pilha) {
  const derrubar = () => { for (const { socket } of pilha) socket.destroy() }
  const topo = pilha.at(-1)
  if (!topo?.pronto || topo.socket.destroyed || !topo.socket.writable) return derrubar()
  topo.socket.end(TERMINATE, derrubar)
}

const codigoSeguro = (erro) => (typeof erro?.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(erro.code) ? erro.code : 'erro')
