// Fundação da casa do Omni em SQLite embutido (node:sqlite): sem servidor, porta nem instalação.
// Desenho: docs/superpowers/specs/2026-11-04-casa-unica-tres-agentes-design.md (§3).
//
// Regras que mantêm a fila de gravação curta (§3.5):
// 1. transação curta, síncrona, nunca aberta durante chamada de modelo, rede ou ferramenta;
// 2. gravação sempre em BEGIN IMMEDIATE (ler e promover depois devolve SQLITE_BUSY sem esperar);
// 3. toda conexão fecha ao fim do uso; ninguém segura o arquivo aberto à toa.
import { createHash, randomBytes } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { hostname } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { BANCOS } from './esquemas.mjs'

export const ESPERA_OCUPADO_MS = 5_000

export class BancoIndisponivelError extends Error {
  constructor(motivo) {
    super(`SQLite embutido indisponível: ${motivo}`)
    this.name = 'BancoIndisponivelError'
    this.code = 'OMNI_CASA_SQLITE_INDISPONIVEL'
  }
}

let moduloSqlite

// Node 22 emite ExperimentalWarning ao carregar node:sqlite (como string + tipo, objeto de
// opções ou Error nomeado); Node 24 não emite mais. Só esse aviso é calado.
export function ehAvisoExperimentalDoSqlite(aviso, tipoOuOpcoes) {
  const tipo = typeof tipoOuOpcoes === 'string' ? tipoOuOpcoes : tipoOuOpcoes?.type ?? aviso?.name
  return tipo === 'ExperimentalWarning' && /sqlite/i.test(String(aviso?.message ?? aviso))
}

// Carrega node:sqlite sem sujar o stderr dos hooks. Electron 33 (Node 20) não tem o módulo.
export function carregarSqlite(env = process.env) {
  if (env.OMNI_CASA_SEM_SQLITE === '1') {
    throw new BancoIndisponivelError('desligado por OMNI_CASA_SEM_SQLITE=1')
  }
  if (moduloSqlite === undefined) {
    const emitir = process.emitWarning
    process.emitWarning = function filtrarAvisoDoSqlite(aviso, ...resto) {
      if (ehAvisoExperimentalDoSqlite(aviso, resto[0])) return
      return emitir.call(process, aviso, ...resto)
    }
    try {
      moduloSqlite = typeof process.getBuiltinModule === 'function'
        ? process.getBuiltinModule('node:sqlite') ?? null
        : null
    } catch {
      moduloSqlite = null
    } finally {
      process.emitWarning = emitir
    }
  }
  if (moduloSqlite === null) {
    throw new BancoIndisponivelError(`Node ${process.versions.node} não traz node:sqlite`)
  }
  return moduloSqlite
}

export function sqliteDisponivel(env = process.env) {
  try {
    carregarSqlite(env)
    return true
  } catch {
    return false
  }
}

// Caminhos absolutos já resolvidos; no Windows, maiúscula e minúscula são o mesmo caminho.
export function mesmoCaminho(a, b) {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

// Onde moram os arquivos .db. A casa de produção (%APPDATA%\omni) guarda o banco em
// %LOCALAPPDATA%\omni\casa: o Roaming pode ser copiado pelo perfil do domínio, e banco aberto
// não pode morar em pasta que outro processo copia por baixo (§3). Qualquer outra casa
// (teste, casa alternativa) guarda o banco dentro dela, em <casa>\casa.
export function pastaDoBanco(casa, env = process.env) {
  if (env.OMNI_CASA_BANCO) return resolve(env.OMNI_CASA_BANCO)
  const absoluta = resolve(casa)
  if (env.APPDATA && env.LOCALAPPDATA && mesmoCaminho(absoluta, resolve(env.APPDATA, 'omni'))) {
    return join(env.LOCALAPPDATA, 'omni', 'casa')
  }
  return join(absoluta, 'casa')
}

export function sha256(conteudo) {
  return createHash('sha256').update(conteudo).digest('hex')
}

export function agoraIso() {
  return new Date().toISOString()
}

export function maquinaAtual() {
  return hostname().toLowerCase()
}

// UUID v7 (RFC 9562): 48 bits de milissegundos + aleatório; ordena por tempo de criação.
export function uuidv7(agoraMs = Date.now()) {
  const bytes = randomBytes(16)
  let ms = BigInt(agoraMs)
  for (let i = 5; i >= 0; i -= 1) {
    bytes[i] = Number(ms & 0xffn)
    ms >>= 8n
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const h = bytes.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export function transacao(db, trabalho) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const resultado = trabalho()
    if (resultado !== null && typeof resultado?.then === 'function') {
      throw new Error('Transação do banco não pode ser assíncrona: abriria a trava durante espera externa.')
    }
    db.exec('COMMIT')
    return resultado
  } catch (erro) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // A transação já pode ter sido desfeita pelo próprio SQLite.
    }
    throw erro
  }
}

export function aplicarMigracoes(db, migracoes) {
  db.exec(`CREATE TABLE IF NOT EXISTS _migracoes (
    versao INTEGER PRIMARY KEY,
    nome TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    aplicada_em TEXT NOT NULL
  )`)
  const aplicadas = new Map(
    db.prepare('SELECT versao, sha256 FROM _migracoes').all().map((linha) => [linha.versao, linha.sha256])
  )
  for (const migracao of migracoes) {
    const assinatura = sha256(migracao.sql)
    const conferir = (registrada) => {
      if (registrada !== assinatura) {
        throw new Error(`Migração ${migracao.versao} (${migracao.nome}) mudou depois de aplicada; crie uma migração nova.`)
      }
    }
    if (aplicadas.has(migracao.versao)) {
      conferir(aplicadas.get(migracao.versao))
      continue
    }
    transacao(db, () => {
      // Releitura dentro da trava: outro processo pode ter migrado enquanto esperávamos a vez.
      const outra = db.prepare('SELECT sha256 FROM _migracoes WHERE versao = ?').get(migracao.versao)
      if (outra) {
        conferir(outra.sha256)
        return
      }
      db.exec(migracao.sql)
      db.prepare('INSERT INTO _migracoes (versao, nome, sha256, aplicada_em) VALUES (?, ?, ?, ?)')
        .run(migracao.versao, migracao.nome, assinatura, agoraIso())
    })
  }
}

export function esperar(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

const SQLITE_BUSY = 5

// O busy_timeout não cobre tudo: quem já tem leitura aberta e precisa promover para escrita
// recebe SQLITE_BUSY na hora (esperar ali seria impasse). Acontece quando processos abrem um
// banco recém-criado juntos e todos tentam virá-lo para WAL. Nesses pontos, tenta de novo até
// o mesmo prazo do busy_timeout, com espera crescente e sorteada para os processos se desencontrarem.
function insistirSeOcupado(executar) {
  const limite = Date.now() + ESPERA_OCUPADO_MS
  for (let tentativa = 0; ; tentativa += 1) {
    try {
      return executar()
    } catch (erro) {
      if ((erro?.errcode & 0xff) !== SQLITE_BUSY || Date.now() >= limite) throw erro
      esperar(Math.min(5 * 2 ** tentativa, 100) * (0.5 + Math.random()))
    }
  }
}

export function abrirBanco(arquivo, migracoes = [], env = process.env) {
  const { DatabaseSync } = carregarSqlite(env)
  mkdirSync(dirname(arquivo), { recursive: true })
  const db = new DatabaseSync(arquivo)
  try {
    db.exec(`PRAGMA busy_timeout = ${ESPERA_OCUPADO_MS}`)
    insistirSeOcupado(() => db.exec('PRAGMA journal_mode = WAL'))
    db.exec('PRAGMA synchronous = NORMAL')
    db.exec('PRAGMA foreign_keys = ON')
    aplicarMigracoes(db, migracoes)
    return db
  } catch (erro) {
    db.close()
    throw erro
  }
}

// Abre, usa e fecha. No Windows, conexão esquecida aberta segura o arquivo e impede apagar a pasta.
// O uso é síncrono: uma promessa devolvida aqui seguiria usando a conexão depois do close.
export function comBanco(arquivo, migracoes, uso, env = process.env) {
  const db = abrirBanco(arquivo, migracoes, env)
  try {
    const resultado = uso(db)
    if (resultado !== null && typeof resultado?.then === 'function') {
      throw new Error('Uso do banco não pode ser assíncrono: a conexão fecha ao fim da chamada.')
    }
    return resultado
  } finally {
    db.close()
  }
}

export function arquivoDoBanco(casa, nome, env = process.env) {
  const definicao = BANCOS[nome]
  if (!definicao) throw new Error(`Banco desconhecido na casa: ${nome}`)
  return join(pastaDoBanco(casa, env), definicao.arquivo)
}

export function comBancoDaCasa(casa, nome, uso, env = process.env) {
  return comBanco(arquivoDoBanco(casa, nome, env), BANCOS[nome].migracoes, uso, env)
}

// Banco fora do ar não derruba o Omni: quem chama cai para o arquivo e anota aqui. O diagnóstico
// lê este registro; ele nunca leva conteúdo de memória nem segredo, só a operação e o erro.
export function registrarDegradacao(casa, operacao, erro, env = process.env) {
  try {
    const pasta = pastaDoBanco(casa, env)
    mkdirSync(pasta, { recursive: true })
    const linha = {
      em: agoraIso(),
      operacao,
      codigo: typeof erro?.code === 'string' ? erro.code : null,
      // A mensagem do JSON.parse traz trecho do texto lido; trecho de memória não vai para log.
      erro: erro instanceof SyntaxError ? 'JSON inválido' : String(erro?.message ?? erro).slice(0, 300)
    }
    appendFileSync(join(pasta, 'degradacoes.jsonl'), `${JSON.stringify(linha)}\n`, 'utf8')
  } catch {
    // Anotar a degradação nunca pode virar a segunda falha.
  }
}
