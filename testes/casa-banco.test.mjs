import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import {
  BancoIndisponivelError,
  ESPERA_OCUPADO_MS,
  abrirBanco,
  arquivoDoBanco,
  carregarSqlite,
  comBanco,
  comBancoDaCasa,
  ehAvisoExperimentalDoSqlite,
  pastaDoBanco,
  registrarDegradacao,
  sha256,
  sqliteDisponivel,
  transacao,
  uuidv7
} from '../runtime/casa/banco.mjs'
import { BANCOS } from '../runtime/casa/esquemas.mjs'
import {
  escreverAtomico,
  lerSeExistir,
  registrarProjecao,
  situacaoDaProjecao
} from '../runtime/casa/projecao.mjs'

const URL_DO_BANCO = new URL('../runtime/casa/banco.mjs', import.meta.url).href

function casaTemporaria() {
  return mkdtempSync(join(tmpdir(), 'omni-casa-banco-'))
}

// Faxina de melhor esforço: erro aqui mascararia a asserção que falhou. Conexão vazada tem
// asserção própria nos testes de fechamento.
function apagar(casa) {
  try {
    rmSync(casa, { recursive: true, force: true })
  } catch {
    // Sobra pasta temporária; o teste que importa já disse o motivo.
  }
}

function tabelas(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((linha) => linha.name)
}

function rodarFilho(codigo, env) {
  return new Promise((resolver, rejeitar) => {
    const filho = spawn(process.execPath, ['--input-type=module', '-e', codigo], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    let saida = ''
    let erro = ''
    filho.stdout.on('data', (pedaco) => { saida += pedaco })
    filho.stderr.on('data', (pedaco) => { erro += pedaco })
    filho.on('error', rejeitar)
    filho.on('close', (codigoDeSaida) => resolver({ codigo: codigoDeSaida, saida, erro }))
  })
}

// Os filhos esperam até o mesmo instante para abrir o banco: a largada sai junta de verdade.
const LARGADA = `const espera = Number(process.env.OMNI_TESTE_LARGADA) - Date.now()
if (espera > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, espera)`

test('OMNI_CASA_SEM_SQLITE=1 desliga o banco com erro identificavel', () => {
  assert.throws(
    () => carregarSqlite({ OMNI_CASA_SEM_SQLITE: '1' }),
    (erro) => erro instanceof BancoIndisponivelError && erro.code === 'OMNI_CASA_SQLITE_INDISPONIVEL'
  )
  assert.equal(sqliteDisponivel({ OMNI_CASA_SEM_SQLITE: '1' }), false)
  assert.equal(sqliteDisponivel({}), true)
  assert.equal(typeof carregarSqlite({}).DatabaseSync, 'function')
})

test('so o aviso experimental do sqlite e calado', () => {
  const mensagem = 'SQLite is an experimental feature and might change at any time'
  assert.equal(ehAvisoExperimentalDoSqlite(mensagem, 'ExperimentalWarning'), true)
  assert.equal(ehAvisoExperimentalDoSqlite(mensagem, { type: 'ExperimentalWarning' }), true)
  const nomeado = new Error(mensagem)
  nomeado.name = 'ExperimentalWarning'
  assert.equal(ehAvisoExperimentalDoSqlite(nomeado), true)
  assert.equal(ehAvisoExperimentalDoSqlite('The Fetch API is an experimental feature', 'ExperimentalWarning'), false)
  assert.equal(ehAvisoExperimentalDoSqlite(mensagem, 'DeprecationWarning'), false)
  assert.equal(ehAvisoExperimentalDoSqlite(mensagem), false)
})

test('pasta do banco: variavel manda, casa de producao vai para o Local, as outras guardam dentro', () => {
  const appdata = resolve('C:/teste/Roaming')
  const local = resolve('C:/teste/Local')
  const env = { APPDATA: appdata, LOCALAPPDATA: local }
  assert.equal(pastaDoBanco(join(appdata, 'omni'), env), join(local, 'omni', 'casa'))
  assert.equal(pastaDoBanco(resolve('C:/outra/casa-do-omni'), env), join(resolve('C:/outra/casa-do-omni'), 'casa'))
  assert.equal(pastaDoBanco(join(appdata, 'omni'), { APPDATA: appdata }), join(appdata, 'omni', 'casa'))
  assert.equal(
    pastaDoBanco(join(appdata, 'omni'), { ...env, OMNI_CASA_BANCO: 'C:/banco/aqui' }),
    resolve('C:/banco/aqui')
  )
})

test('pasta do banco reconhece a casa de producao sem diferenciar maiusculas no Windows', { skip: process.platform !== 'win32' }, () => {
  const env = { APPDATA: 'C:\\Users\\Alguem\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\Alguem\\AppData\\Local' }
  assert.equal(
    pastaDoBanco('c:\\users\\ALGUEM\\appdata\\roaming\\OMNI', env),
    join(env.LOCALAPPDATA, 'omni', 'casa')
  )
})

test('uuid v7 tem formato, carimbo de tempo e ordem', () => {
  const formato = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  const instante = Date.UTC(2026, 10, 4, 12, 0, 0, 123)
  const id = uuidv7(instante)
  assert.match(id, formato)
  assert.equal(Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16), instante)
  assert.ok(uuidv7(instante) < uuidv7(instante + 1))
  assert.notEqual(uuidv7(instante), uuidv7(instante))
})

test('transacao confirma, desfaz no erro e recusa trabalho assincrono', () => {
  const casa = casaTemporaria()
  try {
    comBanco(join(casa, 't.db'), [{ versao: 1, nome: 't', sql: 'CREATE TABLE t (v INTEGER)' }], (db) => {
      assert.equal(transacao(db, () => { db.exec('INSERT INTO t VALUES (1)'); return 'ok' }), 'ok')
      assert.throws(() => transacao(db, () => {
        db.exec('INSERT INTO t VALUES (2)')
        throw new Error('falhou no meio')
      }), /falhou no meio/)
      assert.throws(() => transacao(db, () => {
        db.exec('INSERT INTO t VALUES (3)')
        return Promise.resolve()
      }), /não pode ser assíncrona/)
      assert.deepEqual(db.prepare('SELECT v FROM t ORDER BY v').all().map((linha) => linha.v), [1])
      // Nenhuma transação ficou pendurada: abrir outra não reclama de transação dentro de transação.
      assert.doesNotThrow(() => { db.exec('BEGIN'); db.exec('ROLLBACK') })
    })
  } finally {
    apagar(casa)
  }
})

test('comBanco fecha a conexao sempre, inclusive quando o uso devolve promessa', () => {
  const casa = casaTemporaria()
  try {
    let capturado
    assert.equal(comBanco(join(casa, 'a.db'), [], (db) => { capturado = db; return 7 }), 7)
    assert.throws(() => capturado.prepare('SELECT 1'), /not open/)
    assert.throws(
      () => comBanco(join(casa, 'a.db'), [], (db) => { capturado = db; return Promise.resolve(1) }),
      /não pode ser assíncrono/
    )
    assert.throws(() => capturado.prepare('SELECT 1'), /not open/)
    // Sem conexão pendurada, o Windows deixa apagar a pasta inteira.
    assert.doesNotThrow(() => rmSync(casa, { recursive: true }))
    assert.equal(existsSync(casa), false)
  } finally {
    apagar(casa)
  }
})

test('migracoes sao idempotentes e recusam migracao alterada depois de aplicada', () => {
  const casa = casaTemporaria()
  const arquivo = join(casa, 'm.db')
  const migracoes = [
    { versao: 1, nome: 'a', sql: 'CREATE TABLE a (id INTEGER PRIMARY KEY)' },
    { versao: 2, nome: 'b', sql: 'CREATE TABLE b (id INTEGER PRIMARY KEY)' }
  ]
  try {
    comBanco(arquivo, migracoes, () => {})
    const registradas = comBanco(arquivo, migracoes, (db) => db.prepare('SELECT versao, sha256 FROM _migracoes ORDER BY versao').all())
    assert.deepEqual(registradas.map((linha) => [linha.versao, linha.sha256]), migracoes.map((m) => [m.versao, sha256(m.sql)]))
    const alterada = [migracoes[0], { ...migracoes[1], sql: 'CREATE TABLE b (id TEXT PRIMARY KEY)' }]
    assert.throws(() => comBanco(arquivo, alterada, () => {}), /Migração 2 \(b\) mudou depois de aplicada/)
  } finally {
    apagar(casa)
  }
})

test('pragmas da casa valem em toda conexao', () => {
  const casa = casaTemporaria()
  try {
    comBanco(join(casa, 'p.db'), [], (db) => {
      assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal')
      assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout, ESPERA_OCUPADO_MS)
      assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1)
      assert.equal(db.prepare('PRAGMA synchronous').get().synchronous, 1)
    })
  } finally {
    apagar(casa)
  }
})

test('processos que abrem o banco ao mesmo tempo aplicam cada migracao uma vez so', async () => {
  const casa = casaTemporaria()
  const arquivo = join(casa, 'corrida.db')
  const codigo = `import { comBanco } from ${JSON.stringify(URL_DO_BANCO)}
${LARGADA}
const migracoes = [
  { versao: 1, nome: 'a', sql: 'CREATE TABLE a (id INTEGER PRIMARY KEY)' },
  { versao: 2, nome: 'b', sql: 'CREATE TABLE b (id INTEGER PRIMARY KEY)' }
]
const n = comBanco(process.env.OMNI_TESTE_ARQUIVO, migracoes, (db) => db.prepare('SELECT COUNT(*) AS n FROM _migracoes').get().n)
process.stdout.write(String(n))`
  try {
    const env = { OMNI_TESTE_ARQUIVO: arquivo, OMNI_TESTE_LARGADA: String(Date.now() + 1_500) }
    const filhos = await Promise.all(Array.from({ length: 6 }, () => rodarFilho(codigo, env)))
    for (const filho of filhos) {
      assert.equal(filho.codigo, 0, filho.erro)
      assert.equal(filho.saida, '2')
    }
    comBanco(arquivo, [], (db) => {
      assert.deepEqual(db.prepare('SELECT versao FROM _migracoes ORDER BY versao').all().map((linha) => linha.versao), [1, 2])
      assert.deepEqual(tabelas(db), ['_migracoes', 'a', 'b'])
    })
  } finally {
    apagar(casa)
  }
})

test('gravadores concorrentes em processos separados esperam a vez e nao perdem linha', async () => {
  const casa = casaTemporaria()
  const arquivo = join(casa, 'fila.db')
  const codigo = `import { comBanco, transacao } from ${JSON.stringify(URL_DO_BANCO)}
${LARGADA}
const migracoes = [{ versao: 1, nome: 'fila', sql: 'CREATE TABLE fila (quem TEXT NOT NULL, n INTEGER NOT NULL)' }]
for (let n = 0; n < 25; n += 1) {
  comBanco(process.env.OMNI_TESTE_ARQUIVO, migracoes, (db) => transacao(db, () => {
    db.prepare('INSERT INTO fila (quem, n) VALUES (?, ?)').run(String(process.pid), n)
  }))
}`
  try {
    const env = { OMNI_TESTE_ARQUIVO: arquivo, OMNI_TESTE_LARGADA: String(Date.now() + 1_500) }
    const filhos = await Promise.all(Array.from({ length: 4 }, () => rodarFilho(codigo, env)))
    for (const filho of filhos) assert.equal(filho.codigo, 0, filho.erro)
    comBanco(arquivo, [], (db) => {
      const porProcesso = db.prepare('SELECT quem, COUNT(*) AS n FROM fila GROUP BY quem').all()
      assert.equal(porProcesso.length, 4)
      for (const linha of porProcesso) assert.equal(linha.n, 25)
    })
  } finally {
    apagar(casa)
  }
})

test('transacao que le e depois grava espera a vez em vez de devolver ocupado', async () => {
  const casa = casaTemporaria()
  const arquivo = join(casa, 'contador.db')
  // O pai migra antes da largada: a corrida dos filhos fica só no ler-e-gravar da transação.
  comBanco(arquivo, [{ versao: 1, nome: 'contador', sql: 'CREATE TABLE contador (id INTEGER PRIMARY KEY, valor INTEGER NOT NULL); INSERT INTO contador (id, valor) VALUES (1, 0)' }], () => {})
  const codigo = `import { comBanco, esperar, transacao } from ${JSON.stringify(URL_DO_BANCO)}
${LARGADA}
comBanco(process.env.OMNI_TESTE_ARQUIVO, [], (db) => {
  for (let n = 0; n < 25; n += 1) {
    transacao(db, () => {
      const { valor } = db.prepare('SELECT valor FROM contador WHERE id = 1').get()
      esperar(2)
      db.prepare('UPDATE contador SET valor = ? WHERE id = 1').run(valor + 1)
    })
  }
})`
  try {
    const env = { OMNI_TESTE_ARQUIVO: arquivo, OMNI_TESTE_LARGADA: String(Date.now() + 1_500) }
    const filhos = await Promise.all(Array.from({ length: 4 }, () => rodarFilho(codigo, env)))
    for (const filho of filhos) assert.equal(filho.codigo, 0, filho.erro)
    comBanco(arquivo, [], (db) => {
      assert.equal(db.prepare('SELECT valor FROM contador WHERE id = 1').get().valor, 100)
    })
  } finally {
    apagar(casa)
  }
})

test('cada banco da casa abre com as tabelas do desenho', () => {
  const casa = casaTemporaria()
  const esperadas = {
    nucleo: ['_diario', '_migracoes', 'agentes', 'maquinas', 'sqlite_sequence'],
    omni: ['_diario', '_importacoes', '_migracoes', '_projecoes', 'documentos', 'memoria_meta', 'memorias', 'sqlite_sequence'],
    cofre: ['_diario', '_importacoes', '_migracoes', '_projecoes', 'credenciais', 'sqlite_sequence', 'usos']
  }
  try {
    assert.deepEqual(Object.keys(BANCOS), Object.keys(esperadas))
    for (const nome of Object.keys(BANCOS)) {
      assert.deepEqual(comBancoDaCasa(casa, nome, tabelas), esperadas[nome], nome)
      assert.equal(arquivoDoBanco(casa, nome), join(casa, 'casa', BANCOS[nome].arquivo))
    }
    assert.throws(() => arquivoDoBanco(casa, 'oraculo'), /Banco desconhecido na casa: oraculo/)
  } finally {
    apagar(casa)
  }
})

test('diario anota insercao, mudanca de versao e remocao; arrumacao de ordem nao vira trafego', () => {
  const casa = casaTemporaria()
  try {
    comBancoDaCasa(casa, 'omni', (db) => {
      db.exec(`INSERT INTO memorias (id, raia, ordem, corpo, origem_maquina, criado_em, atualizado_em)
        VALUES ('m1', 'confirmed', 0, '{}', 'pc', 't0', 't0')`)
      db.exec("UPDATE memorias SET ordem = 5 WHERE id = 'm1'")
      db.exec(`UPDATE memorias SET corpo = '{"a":1}', versao = versao + 1 WHERE id = 'm1'`)
      db.exec("DELETE FROM memorias WHERE id = 'm1'")
      const diario = db.prepare('SELECT tabela, linha, operacao, versao FROM _diario ORDER BY seq').all()
      assert.deepEqual(
        diario.map((linha) => `${linha.tabela}:${linha.linha}:${linha.operacao}:${linha.versao}`),
        ['memorias:m1:I:1', 'memorias:m1:U:2', 'memorias:m1:D:2']
      )
    })
  } finally {
    apagar(casa)
  }
})

test('situacao da projecao cobre vazio, externa, sem-arquivo, atual e defasada', () => {
  const casa = casaTemporaria()
  try {
    comBancoDaCasa(casa, 'omni', (db) => {
      const arquivo = 'memory/memory.json'
      assert.equal(situacaoDaProjecao(db, arquivo, null, null), 'vazio')
      assert.equal(situacaoDaProjecao(db, arquivo, 'aaa', null), 'externa')
      assert.equal(situacaoDaProjecao(db, arquivo, null, 'bbb'), 'sem-arquivo')
      assert.equal(situacaoDaProjecao(db, arquivo, 'bbb', 'bbb'), 'atual')
      assert.equal(situacaoDaProjecao(db, arquivo, 'aaa', 'bbb'), 'externa')
      registrarProjecao(db, arquivo, 'aaa', 'escrita')
      assert.equal(situacaoDaProjecao(db, arquivo, 'aaa', 'bbb'), 'defasada')
      // O histórico é por arquivo: o mesmo hash em outro arquivo continua desconhecido.
      assert.equal(situacaoDaProjecao(db, 'outro.json', 'aaa', 'bbb'), 'externa')
    })
  } finally {
    apagar(casa)
  }
})

test('registrar a mesma projecao de novo nao duplica nem troca o papel', () => {
  const casa = casaTemporaria()
  try {
    comBancoDaCasa(casa, 'omni', (db) => {
      registrarProjecao(db, 'memory/memory.json', 'aaa', 'ingerida')
      registrarProjecao(db, 'memory/memory.json', 'aaa', 'escrita')
      const linhas = db.prepare('SELECT papel FROM _projecoes').all()
      assert.deepEqual(linhas.map((linha) => linha.papel), ['ingerida'])
    })
  } finally {
    apagar(casa)
  }
})

test('escrita atomica cria a pasta, substitui o arquivo e nao deixa temporario', () => {
  const casa = casaTemporaria()
  try {
    const caminho = join(casa, 'sub', 'dados.json')
    escreverAtomico(caminho, 'primeiro')
    escreverAtomico(caminho, 'segundo')
    assert.equal(readFileSync(caminho, 'utf8'), 'segundo')
    assert.deepEqual(readdirSync(join(casa, 'sub')), ['dados.json'])
  } finally {
    apagar(casa)
  }
})

test('lerSeExistir devolve null so para arquivo ausente', () => {
  const casa = casaTemporaria()
  try {
    assert.equal(lerSeExistir(join(casa, 'nada.json')), null)
    writeFileSync(join(casa, 'algo.json'), 'conteudo')
    assert.equal(lerSeExistir(join(casa, 'algo.json')), 'conteudo')
    assert.throws(() => lerSeExistir(casa), (erro) => erro.code === 'EISDIR')
  } finally {
    apagar(casa)
  }
})

test('registro de degradacao guarda operacao e erro, nunca trecho de conteudo', () => {
  const casa = casaTemporaria()
  try {
    let invalido
    try {
      // O V8 cita um trecho do texto nesta mensagem ("egredo": texto da me...): é o vazamento a barrar.
      JSON.parse('{"segredo": texto da memoria}')
    } catch (erro) {
      invalido = erro
    }
    registrarDegradacao(casa, 'memoria.carregar', invalido)
    const ocupado = Object.assign(new Error('database is locked'), { code: 'ERR_SQLITE_ERROR' })
    registrarDegradacao(casa, 'memoria.gravar', ocupado)
    const linhas = readFileSync(join(casa, 'casa', 'degradacoes.jsonl'), 'utf8').trim().split('\n').map((linha) => JSON.parse(linha))
    assert.deepEqual(linhas.map(({ operacao, codigo, erro }) => ({ operacao, codigo, erro })), [
      { operacao: 'memoria.carregar', codigo: null, erro: 'JSON inválido' },
      { operacao: 'memoria.gravar', codigo: 'ERR_SQLITE_ERROR', erro: 'database is locked' }
    ])
    assert.doesNotMatch(readFileSync(join(casa, 'casa', 'degradacoes.jsonl'), 'utf8'), /egredo|texto da/)
    for (const linha of linhas) assert.ok(!Number.isNaN(Date.parse(linha.em)))
  } finally {
    apagar(casa)
  }
})

test('falha ao anotar a degradacao nunca vira a segunda falha', () => {
  const casa = casaTemporaria()
  try {
    writeFileSync(join(casa, 'arquivo'), 'x')
    assert.doesNotThrow(() => registrarDegradacao(casa, 'x', new Error('y'), { OMNI_CASA_BANCO: join(casa, 'arquivo', 'sub') }))
  } finally {
    apagar(casa)
  }
})

test('abrirBanco fecha a conexao quando a migracao falha', () => {
  const casa = casaTemporaria()
  try {
    assert.throws(() => abrirBanco(join(casa, 'quebrado.db'), [{ versao: 1, nome: 'ruim', sql: 'CREATE TABLE (' }]), /syntax error/)
    // No Windows, arquivo com conexão aberta não apaga: é a prova de que a falha fechou o banco.
    assert.doesNotThrow(() => rmSync(join(casa, 'quebrado.db')))
    assert.equal(existsSync(join(casa, 'quebrado.db')), false)
  } finally {
    apagar(casa)
  }
})
