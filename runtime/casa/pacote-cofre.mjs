// Pacote do cofre (§8.4): conteúdo cifrado por frase-mestra para viajar de máquina. O scrypt deriva a
// chave e o AES-256-GCM cifra e autentica; o cabeçalho (formato, versão, parâmetros, sal, iv) vai em
// claro e entra como AAD. Os parâmetros lidos do pacote são conferidos antes de derivar, para um
// pacote forjado não pedir memória sem fim. String do JS não se zera; os Buffers sim.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

export const FORMATO_PACOTE = 'omni-cofre-pacote'
export const FRASE_MINIMA = 12
export const PARAMETROS_PADRAO = Object.freeze({ N: 2 ** 17, r: 8, p: 1 })

export class PacoteCofreError extends Error {
  constructor(codigo, mensagem) {
    super(mensagem)
    this.name = 'PacoteCofreError'
    this.code = codigo
  }
}

const NAO_E_PACOTE = 'O arquivo não é um pacote do cofre.'
const aad = (cabecalho) => Buffer.from(cabecalho, 'utf8')

export function conferirParametros(parametros) {
  const { N, r, p } = parametros ?? {}
  const potencia = Number.isInteger(N) && N >= 2 ** 14 && N <= 2 ** 18 && (N & (N - 1)) === 0
  if (!potencia || !Number.isInteger(r) || r < 1 || r > 8 || !Number.isInteger(p) || p < 1 || p > 4) {
    throw new PacoteCofreError('parametros', 'Parâmetros do scrypt fora dos limites do cofre.')
  }
}

export function conferirFrase(frase) {
  if (typeof frase !== 'string' || [...frase.normalize('NFC')].length < FRASE_MINIMA) {
    throw new PacoteCofreError('frase-curta', `A frase-mestra precisa de pelo menos ${FRASE_MINIMA} caracteres.`)
  }
}

function derivar(frase, sal, { N, r, p }) {
  const bytes = Buffer.from(frase.normalize('NFC'), 'utf8')
  try {
    return scryptSync(bytes, sal, 32, { N, r, p, maxmem: 128 * N * r + 16 * 1024 * 1024 })
  } finally {
    bytes.fill(0)
  }
}

export function selarPacote(conteudo, frase, parametros = PARAMETROS_PADRAO) {
  conferirFrase(frase)
  conferirParametros(parametros)
  const { N, r, p } = parametros
  const sal = randomBytes(16)
  const iv = randomBytes(12)
  const cabecalho = JSON.stringify({ formato: FORMATO_PACOTE, versao: 1, kdf: { nome: 'scrypt', N, r, p, sal: sal.toString('base64') }, cifra: { nome: 'aes-256-gcm', iv: iv.toString('base64') } })
  const chave = derivar(frase, sal, parametros)
  const claro = Buffer.from(JSON.stringify(conteudo), 'utf8')
  try {
    const cifra = createCipheriv('aes-256-gcm', chave, iv)
    cifra.setAAD(aad(cabecalho))
    const dados = Buffer.concat([cifra.update(claro), cifra.final()])
    return `${JSON.stringify({ cabecalho, dados: dados.toString('base64'), etiqueta: cifra.getAuthTag().toString('base64') }, null, 2)}\n`
  } finally {
    chave.fill(0)
    claro.fill(0)
  }
}

export function abrirPacote(texto, frase) {
  conferirFrase(frase)
  let externo
  let cab
  try {
    externo = JSON.parse(texto)
    cab = typeof externo?.cabecalho === 'string' ? JSON.parse(externo.cabecalho) : null
  } catch {
    throw new PacoteCofreError('formato', NAO_E_PACOTE)
  }
  const ok = cab?.formato === FORMATO_PACOTE && cab.versao === 1 && cab.kdf?.nome === 'scrypt' && cab.cifra?.nome === 'aes-256-gcm' &&
    typeof cab.kdf.sal === 'string' && typeof cab.cifra.iv === 'string' && typeof externo.dados === 'string' && typeof externo.etiqueta === 'string'
  if (!ok) throw new PacoteCofreError('formato', NAO_E_PACOTE)
  conferirParametros(cab.kdf)
  const sal = Buffer.from(cab.kdf.sal, 'base64')
  const iv = Buffer.from(cab.cifra.iv, 'base64')
  const etiqueta = Buffer.from(externo.etiqueta, 'base64')
  if (sal.length !== 16 || iv.length !== 12 || etiqueta.length !== 16) throw new PacoteCofreError('formato', NAO_E_PACOTE)
  const chave = derivar(frase, sal, cab.kdf)
  let claro
  try {
    const decifra = createDecipheriv('aes-256-gcm', chave, iv, { authTagLength: 16 })
    decifra.setAAD(aad(externo.cabecalho))
    decifra.setAuthTag(etiqueta)
    claro = Buffer.concat([decifra.update(Buffer.from(externo.dados, 'base64')), decifra.final()])
  } catch {
    throw new PacoteCofreError('frase-ou-pacote', 'Frase errada ou pacote adulterado.')
  } finally {
    chave.fill(0)
  }
  try {
    return JSON.parse(claro.toString('utf8'))
  } catch {
    throw new PacoteCofreError('formato', 'O conteúdo do pacote não é JSON.')
  } finally {
    claro.fill(0)
  }
}
