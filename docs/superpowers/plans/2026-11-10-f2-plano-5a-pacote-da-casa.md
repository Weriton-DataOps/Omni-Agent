# F2, plano 5a: o pacote da casa (exportar, importar, verificar)

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use superpowers:executing-plans para executar tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** levar o `nucleo.db` e o `omni.db` desta máquina para outra com prova de 100% de contagem e hash por tabela (§5 do desenho), sem mexer no cofre.

**Arquitetura:**
- `runtime/casa/pacote-casa.mjs` é puro: retrato por tabela, exportação por `VACUUM INTO`, conferência e importação.
- `runtime/executor.mjs` é a linha de comando (`exportar`, `importar`, `verificar`), com as mesmas convenções do `nucleo.mjs` e do `cofre.mjs`.
- O `scripts/omni-instalar.ps1` do plano 5b chama este executor. Aqui não há PowerShell.

**Tecnologia:** Node ≥ 22 com `node:sqlite` e `node:test`.

**Desenho:** [Casa única](../specs/2026-11-04-casa-unica-tres-agentes-design.md), §4.2 e §5. Plano mestre: [F2](2026-11-09-f2-casa-instalavel.md), linha 5a.

---

## Decisões

1. **O pacote é uma pasta**, não um zip, com três arquivos: `nucleo.db`, `omni.db` e `manifesto.json`.
   - O zip fica com o 5b, se precisar.
   - Uma pasta deixa o `verificar --pacote` abrir os bancos sem extrair nada.
2. **O cofre fica fora do pacote.**
   - O blob DPAPI só abre na máquina que o cifrou.
   - O cofre já tem o próprio pacote cifrado (`cofre.mjs exportar` e `importar-pacote`), e o 5b o põe na mesma pasta.
3. **Retrato de uma tabela:** sha256 de um cabeçalho com os nomes das colunas, seguido de uma linha por registro.
   - Cada linha é `quote(c1) || ',' || quote(c2) ...`, na ordem do `table_info`.
   - As linhas vêm ordenadas pela chave primária, ou por todas as colunas quando não há chave.
   - Entram todas as tabelas fora de `sqlite_%`, inclusive `_migracoes` e `_diario`.
   - O `quote()` do SQLite escapa aspas e escreve blob em hexadecimal, então a serialização não é ambígua.
4. **A cópia sai por `VACUUM INTO`**, uma fotografia consistente mesmo com o hook escrevendo ao lado.
   - A cópia sai em rollback journal, um arquivo só, sem `-wal`. Medido em 10/11: com a casa em WAL (cabeçalho 2/2), o `VACUUM INTO` já grava 1/1, então não há `PRAGMA journal_mode` a mais; o teste confere os bytes 18 e 19 do cabeçalho.
5. **A importação confere três vezes:**
   - o pacote contra o próprio manifesto (sha256 do arquivo e retrato de cada tabela);
   - a cópia na casa contra o manifesto, antes de qualquer migração;
   - e só então abre pelo `abrirBanco`, que aplica as migrações mais novas que este Omni conhecer.
6. **A importação nunca apaga.**
   - Casa com banco recusa (`casa-existente`).
   - Com `--substituir`, o banco atual vai inteiro para `antes-de-importar-<carimbo>` antes da cópia, e qualquer falha devolve tudo.
   - No Windows, banco aberto por outro processo não deixa renomear: a recusa é `casa-ocupada`, sem meia troca.
7. **Pacote com migração mais nova** que este Omni recusa (`pacote-mais-novo`): primeiro atualizar, depois importar.
8. **O `verificar --pacote` compara a casa viva com o manifesto.**
   - Ele é a prova logo depois da importação.
   - Se a máquina nova tiver migração mais nova, a `_migracoes` diverge por desenho. Por isso a importação faz a conferência que vale antes de migrar e devolve as migrações aplicadas.

## Arquivos

- Criar `runtime/casa/pacote-casa.mjs`.
- Criar `runtime/executor.mjs`.
- Criar `testes/casa-pacote.test.mjs` e `testes/executor-cli.test.mjs`.
- Modificar `package.json`: `node --check` dos dois arquivos novos no `check`.
- Release 0.31.0 em `.claude-plugin/plugin.json`, `package.json`, `package-lock.json`, `contratos/atualizacao/releases.json` e `contratos/atualizacao/integridade.json`.

---

### Tarefa 1: retrato e comparação

**Arquivos:** criar `runtime/casa/pacote-casa.mjs` e `testes/casa-pacote.test.mjs`.

- [ ] **Teste vermelho.** Em `testes/casa-pacote.test.mjs`:

```js
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { carregarSqlite } from '../runtime/casa/banco.mjs'
import { compararRetratos, retratoDoBanco, retratoDaTabela } from '../runtime/casa/pacote-casa.mjs'

const { DatabaseSync } = carregarSqlite()
function comPasta(uso) {
  const pasta = mkdtempSync(join(tmpdir(), 'omni-pacote-'))
  try { return uso(pasta) } finally { rmSync(pasta, { recursive: true, force: true }) }
}
function banco(sql) { const db = new DatabaseSync(':memory:'); db.exec(sql); return db }

test('retrato não depende da ordem de inserção', () => {
  const a = banco("CREATE TABLE t (id TEXT PRIMARY KEY, v TEXT); INSERT INTO t VALUES ('b', 'dois'), ('a', 'um')")
  const b = banco("CREATE TABLE t (id TEXT PRIMARY KEY, v TEXT); INSERT INTO t VALUES ('a', 'um'), ('b', 'dois')")
  assert.deepEqual(retratoDaTabela(a, 't'), retratoDaTabela(b, 't'))
  assert.equal(retratoDaTabela(a, 't').linhas, 2)
})

test('retrato muda com um valor só, com a mesma contagem', () => {
  const a = banco("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t VALUES (1, 'x')")
  const b = banco("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t VALUES (1, 'y')")
  assert.equal(retratoDaTabela(a, 't').linhas, retratoDaTabela(b, 't').linhas)
  assert.notEqual(retratoDaTabela(a, 't').sha256, retratoDaTabela(b, 't').sha256)
})

test('retrato separa NULL de texto, blob de texto e vírgula dentro do valor', () => {
  const casos = ["(1, NULL)", "(1, 'NULL')", "(1, X'6869')", "(1, 'hi')", "(1, 'a,b')"]
  const hashes = casos.map((valores) => retratoDaTabela(banco(`CREATE TABLE t (id INTEGER PRIMARY KEY, v); INSERT INTO t VALUES ${valores}`), 't').sha256)
  assert.equal(new Set(hashes).size, casos.length)
})

test('retrato muda quando a coluna muda de nome com os mesmos valores', () => {
  const a = banco("CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT); INSERT INTO t VALUES (1, 'x')")
  const b = banco("CREATE TABLE t (id INTEGER PRIMARY KEY, b TEXT); INSERT INTO t VALUES (1, 'x')")
  assert.notEqual(retratoDaTabela(a, 't').sha256, retratoDaTabela(b, 't').sha256)
})

test('tabela sem chave primária ordena por todas as colunas', () => {
  const a = banco("CREATE TABLE t (x, y); INSERT INTO t VALUES (2, 'b'), (1, 'a')")
  const b = banco("CREATE TABLE t (x, y); INSERT INTO t VALUES (1, 'a'), (2, 'b')")
  assert.deepEqual(retratoDaTabela(a, 't'), retratoDaTabela(b, 't'))
})

test('retrato do banco cobre as tabelas do usuário e a última migração', () => {
  const db = banco(`CREATE TABLE _migracoes (versao INTEGER PRIMARY KEY, nome TEXT, sha256 TEXT, aplicada_em TEXT);
    INSERT INTO _migracoes VALUES (1, 'a', 'x', 'y'), (3, 'b', 'x', 'y');
    CREATE TABLE "nome com ""aspas""" (seq INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT); INSERT INTO "nome com ""aspas""" (v) VALUES ('z')`)
  const r = retratoDoBanco(db)
  assert.equal(r.migracao, 3)
  assert.deepEqual(Object.keys(r.tabelas), ['_migracoes', 'nome com "aspas"'])
  assert.equal(r.tabelas['nome com "aspas"'].linhas, 1)
})

test('comparar aponta tabela faltando, sobrando e diferente', () => {
  const esperado = { tabelas: { a: { linhas: 1, sha256: '1' }, b: { linhas: 2, sha256: '2' }, c: { linhas: 0, sha256: '3' } } }
  const real = { tabelas: { a: { linhas: 1, sha256: '1' }, b: { linhas: 2, sha256: 'x' }, d: { linhas: 0, sha256: '4' } } }
  assert.deepEqual(compararRetratos(esperado, real), [
    { tabela: 'b', esperado: { linhas: 2, sha256: '2' }, real: { linhas: 2, sha256: 'x' } },
    { tabela: 'c', esperado: { linhas: 0, sha256: '3' }, real: null },
    { tabela: 'd', esperado: null, real: { linhas: 0, sha256: '4' } }
  ])
  assert.deepEqual(compararRetratos(esperado, esperado), [])
})
```

- [ ] Rodar `node --test --test-reporter=spec testes/casa-pacote.test.mjs`. Esperado: falha de importação (`pacote-casa.mjs` não existe).
- [ ] **Implementação mínima.** Criar `runtime/casa/pacote-casa.mjs`:

```js
// Pacote da casa (§4.2, §5): retrato por tabela, exportação por VACUUM INTO e importação conferida.
// O pacote é uma pasta com nucleo.db, omni.db e manifesto.json. O cofre não entra: o blob DPAPI só
// abre na máquina que o cifrou, e o cofre já tem o próprio pacote cifrado (cofre.mjs exportar).
import { createHash } from 'node:crypto'

const ident = (nome) => `"${String(nome).replaceAll('"', '""')}"`

// sha256 do cabeçalho de colunas e de uma linha por registro, na ordem da chave primária (ou de
// todas as colunas). O quote() escapa aspas e escreve blob em hexadecimal: sem ambiguidade.
export function retratoDaTabela(db, tabela) {
  const colunas = db.prepare(`PRAGMA table_info(${ident(tabela)})`).all()
  const chave = colunas.filter((coluna) => coluna.pk > 0).sort((a, b) => a.pk - b.pk)
  const ordem = (chave.length > 0 ? chave : colunas).map((coluna) => ident(coluna.name)).join(', ')
  const linha = colunas.map((coluna) => `quote(${ident(coluna.name)})`).join(` || ',' || `)
  const hash = createHash('sha256').update(`${colunas.map((coluna) => coluna.name).join(',')}\n`)
  const linhas = db.prepare(`SELECT ${linha} AS l FROM ${ident(tabela)} ORDER BY ${ordem}`).all()
  for (const { l } of linhas) hash.update(`${l}\n`)
  return { linhas: linhas.length, sha256: hash.digest('hex') }
}

// O retrato inteiro sai de uma leitura só, para o hook que escreve ao lado não partir a foto.
export function retratoDoBanco(db) {
  db.exec('BEGIN')
  try {
    const nomes = db.prepare(`SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name`)
      .all().map((linha) => linha.name)
    const tabelas = Object.fromEntries(nomes.map((nome) => [nome, retratoDaTabela(db, nome)]))
    const migracao = nomes.includes('_migracoes') ? db.prepare('SELECT MAX(versao) AS v FROM _migracoes').get().v ?? 0 : 0
    return { migracao, tabelas }
  } finally {
    db.exec('COMMIT')
  }
}

export function compararRetratos(esperado, real) {
  const nomes = [...new Set([...Object.keys(esperado.tabelas), ...Object.keys(real.tabelas)])].sort()
  return nomes.flatMap((tabela) => {
    const e = esperado.tabelas[tabela] ?? null
    const r = real.tabelas[tabela] ?? null
    return e && r && e.linhas === r.linhas && e.sha256 === r.sha256 ? [] : [{ tabela, esperado: e, real: r }]
  })
}
```

- [ ] Rodar de novo. Esperado: 6 de 6.
- [ ] **Mutantes**, um por vez, cada um vermelho pela asserção:
  - tirar o `ORDER BY` → vermelho em "não depende da ordem";
  - hash só da contagem → vermelho em "muda com um valor só";
  - `quote(c)` trocado por `c` → vermelho em "separa NULL de texto";
  - `compararRetratos` só pelas chaves do esperado → vermelho em "comparar aponta".
- [ ] Commit `feat(casa): retrato por tabela para o pacote da casa`.

### Tarefa 2: exportar

**Arquivos:** `runtime/casa/pacote-casa.mjs` e `testes/casa-pacote.test.mjs`.

- [ ] **Teste vermelho.** Acrescentar ao teste (uma casa de teste com `OMNI_CASA_BANCO`):

```js
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { comBancoDaCasa, sha256 } from '../runtime/casa/banco.mjs'
import { exportarCasa } from '../runtime/casa/pacote-casa.mjs'

function comCasa(uso) {
  return comPasta((pasta) => {
    const casa = join(pasta, 'casa-origem')
    const env = { ...process.env, OMNI_HOME: casa, OMNI_CASA_BANCO: join(casa, 'casa') }
    return uso({ pasta, casa, env })
  })
}
// Semeia pelas lojas de verdade: linha válida pelo próprio dono da tabela, sem adivinhar coluna.
function semear(casa, env) {
  comBancoDaCasa(casa, 'nucleo', (db) => registrarMaquina(db, { maquina: 'origem', nome: 'origem', sistema: 'teste' }), env)
  comBancoDaCasa(casa, 'omni', (db) => registrarDespacho(db, { agente: 'oraculo', execucao: 'e1' }, { maquina: 'origem' }), env)
}

test('exportar grava os dois bancos e o manifesto que confere com eles', () => comCasa(({ pasta, casa, env }) => {
  semear(casa, env)
  const saida = join(pasta, 'pacote')
  const r = exportarCasa(casa, saida, { env, omni: '9.9.9', agora: '2026-11-10T00:00:00.000Z', maquina: 'origem' })
  assert.deepEqual(readdirSync(saida).sort(), ['manifesto.json', 'nucleo.db', 'omni.db'])
  const m = JSON.parse(readFileSync(join(saida, 'manifesto.json'), 'utf8'))
  assert.equal(m.formato, 'omni-casa-pacote'); assert.equal(m.versao, 1); assert.equal(m.omni, '9.9.9'); assert.equal(m.maquina, 'origem')
  for (const nome of ['nucleo', 'omni']) {
    const bytes = readFileSync(join(saida, `${nome}.db`))
    assert.equal(m.bancos[nome].sha256, sha256(bytes))
    // Bytes 18 e 19 do cabeçalho: 1 = rollback journal, 2 = WAL. Pacote é arquivo só, sem -wal.
    assert.deepEqual([bytes[18], bytes[19]], [1, 1], `${nome}.db saiu em WAL`)
    assert.ok(m.bancos[nome].migracao >= 1)
  }
  assert.equal(m.bancos.nucleo.tabelas.maquinas.linhas, 1)
  assert.equal(m.bancos.omni.tabelas.despachos.linhas, 1)
  assert.equal(r.bancos.omni.linhas, Object.values(m.bancos.omni.tabelas).reduce((s, t) => s + t.linhas, 0))
  assert.ok(!existsSync(join(saida, 'omni.db-wal')))
}))

test('exportar recusa pasta com arquivo e não toca nela', () => comCasa(({ pasta, casa, env }) => {
  const saida = join(pasta, 'cheia')
  mkdirSync(saida); writeFileSync(join(saida, 'algo.txt'), 'fica')
  assert.throws(() => exportarCasa(casa, saida, { env }), { code: 'saida-existe' })
  assert.deepEqual(readdirSync(saida), ['algo.txt'])
}))
```

  Imports: `registrarMaquina` de `runtime/casa/loja-nucleo.mjs` e `registrarDespacho` de `runtime/casa/loja-despachos.mjs`.
- [ ] Rodar. Esperado: falha porque `exportarCasa` não existe.
- [ ] **Implementação.** Acrescentar ao `pacote-casa.mjs`:

```js
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { BANCOS } from './esquemas.mjs'
import { ESPERA_OCUPADO_MS, agoraIso, carregarSqlite, comBancoDaCasa, maquinaAtual, sha256 } from './banco.mjs'

export const FORMATO_PACOTE = 'omni-casa-pacote'
export const BANCOS_DO_PACOTE = Object.freeze(['nucleo', 'omni'])
export const MANIFESTO = 'manifesto.json'

export class PacoteCasaError extends Error {
  constructor(codigo, mensagem, detalhes = {}) {
    super(mensagem)
    this.name = 'PacoteCasaError'
    this.code = codigo
    Object.assign(this, detalhes)
  }
}

// Arquivo de pacote ou cópia recém-chegada: sem migração, só leitura de fato.
function retratoDoArquivo(arquivo, env) {
  const { DatabaseSync } = carregarSqlite(env)
  const db = new DatabaseSync(arquivo)
  try {
    db.exec(`PRAGMA busy_timeout = ${ESPERA_OCUPADO_MS}`)
    return retratoDoBanco(db)
  } finally {
    db.close()
  }
}

export function resumirRetrato(retrato) {
  const tabelas = Object.values(retrato.tabelas)
  return { migracao: retrato.migracao, tabelas: tabelas.length, linhas: tabelas.reduce((soma, t) => soma + t.linhas, 0) }
}

export function exportarCasa(casa, saida, { env = process.env, omni = null, agora = agoraIso(), maquina = maquinaAtual() } = {}) {
  const destino = resolve(saida)
  const pastaNova = !existsSync(destino)
  if (!pastaNova && readdirSync(destino).length > 0) {
    throw new PacoteCasaError('saida-existe', 'A pasta de saída já tem arquivos; o pacote não sobrescreve.')
  }
  mkdirSync(destino, { recursive: true })
  const gravados = []
  try {
    const bancos = {}
    for (const nome of BANCOS_DO_PACOTE) {
      const arquivo = join(destino, BANCOS[nome].arquivo)
      gravados.push(arquivo)
      comBancoDaCasa(casa, nome, (db) => { db.prepare('VACUUM INTO ?').run(arquivo) }, env)
      bancos[nome] = { arquivo: BANCOS[nome].arquivo, ...retratoDoArquivo(arquivo, env), sha256: sha256(readFileSync(arquivo)) }
    }
    const manifesto = { formato: FORMATO_PACOTE, versao: 1, criado_em: agora, maquina, omni, bancos }
    gravados.push(join(destino, MANIFESTO))
    writeFileSync(join(destino, MANIFESTO), `${JSON.stringify(manifesto, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    return { saida: destino, bancos: Object.fromEntries(BANCOS_DO_PACOTE.map((nome) => [nome, resumirRetrato(bancos[nome])])) }
  } catch (erro) {
    for (const arquivo of gravados) rmSync(arquivo, { force: true })
    if (pastaNova) rmSync(destino, { recursive: true, force: true })
    throw erro
  }
}
```

- [ ] Rodar. Esperado: 9 de 9.
- [ ] **Mutantes:**
  - `sha256: 'x'` no manifesto → vermelho na asserção do sha256;
  - (executado em 10/11) sem `journal_mode = DELETE` ficou verde: o `VACUUM INTO` já grava em rollback. A linha saiu e a asserção do cabeçalho 1/1 guarda a propriedade;
  - sem a checagem de pasta cheia → vermelho em "recusa pasta com arquivo".
- [ ] Commit `feat(casa): exportar a casa por VACUUM INTO com manifesto por tabela`.

### Tarefa 3: conferir o pacote

- [ ] **Teste vermelho:**

```js
import { conferirPacote } from '../runtime/casa/pacote-casa.mjs'

function pacotePronto({ pasta, casa, env }) {
  semear(casa, env)
  const saida = join(pasta, 'pacote')
  exportarCasa(casa, saida, { env, omni: '9.9.9' })
  return saida
}
function mexer(arquivo, sql) { const db = new DatabaseSync(arquivo); try { db.exec(sql) } finally { db.close() } }

test('pacote íntegro confere', () => comCasa((c) => {
  assert.equal(conferirPacote(pacotePronto(c), { env: c.env }).formato, 'omni-casa-pacote')
}))

test('arquivo alterado só no cabeçalho cai pelo sha256', () => comCasa((c) => {
  const saida = pacotePronto(c)
  mexer(join(saida, 'omni.db'), 'PRAGMA user_version = 7')
  assert.throws(() => conferirPacote(saida, { env: c.env }), (e) => e.code === 'pacote-corrompido' && e.divergencias[0].banco === 'omni' && e.divergencias[0].arquivo === 'sha256')
}))

test('manifesto adulterado numa tabela cai pelo retrato', () => comCasa((c) => {
  const saida = pacotePronto(c)
  const caminho = join(saida, 'manifesto.json')
  const m = JSON.parse(readFileSync(caminho, 'utf8'))
  m.bancos.omni.tabelas.despachos.linhas = 2
  writeFileSync(caminho, JSON.stringify(m))
  assert.throws(() => conferirPacote(saida, { env: c.env }), (e) => e.code === 'pacote-corrompido' && e.divergencias.some((d) => d.tabela === 'despachos'))
}))

test('banco faltando e manifesto estranho são recusados', () => comCasa((c) => {
  const saida = pacotePronto(c)
  rmSync(join(saida, 'nucleo.db'))
  assert.throws(() => conferirPacote(saida, { env: c.env }), (e) => e.code === 'pacote-corrompido' && e.divergencias[0].arquivo === 'ausente')
  // Manifesto inteiro, só com o formato trocado: cai pelo formato, não por falta de campo.
  const m = JSON.parse(readFileSync(join(saida, 'manifesto.json'), 'utf8'))
  writeFileSync(join(saida, 'manifesto.json'), JSON.stringify({ ...m, formato: 'outro' }))
  assert.throws(() => conferirPacote(saida, { env: c.env }), { code: 'pacote-invalido' })
  rmSync(join(saida, 'manifesto.json'))
  assert.throws(() => conferirPacote(saida, { env: c.env }), { code: 'pacote-invalido' })
}))
```

- [ ] Rodar. Esperado: falha (`conferirPacote` não existe).
- [ ] **Implementação:**

```js
const HEX64 = /^[a-f0-9]{64}$/

function lerManifestoDoPacote(pasta) {
  let manifesto
  try { manifesto = JSON.parse(readFileSync(join(pasta, MANIFESTO), 'utf8')) }
  catch { throw new PacoteCasaError('pacote-invalido', 'Não achei um manifesto legível no pacote.') }
  const valido = manifesto?.formato === FORMATO_PACOTE && manifesto.versao === 1 &&
    BANCOS_DO_PACOTE.every((nome) => {
      const banco = manifesto.bancos?.[nome]
      return banco?.arquivo === BANCOS[nome].arquivo && HEX64.test(banco.sha256 ?? '') &&
        Number.isInteger(banco.migracao) && banco.tabelas !== null && typeof banco.tabelas === 'object'
    })
  if (!valido) throw new PacoteCasaError('pacote-invalido', 'O manifesto não descreve um pacote da casa do Omni.')
  return manifesto
}

export function conferirPacote(pasta, { env = process.env } = {}) {
  const origem = resolve(pasta)
  const manifesto = lerManifestoDoPacote(origem)
  const divergencias = []
  for (const nome of BANCOS_DO_PACOTE) {
    const esperado = manifesto.bancos[nome]
    const arquivo = join(origem, esperado.arquivo)
    if (!existsSync(arquivo)) { divergencias.push({ banco: nome, arquivo: 'ausente' }); continue }
    if (sha256(readFileSync(arquivo)) !== esperado.sha256) { divergencias.push({ banco: nome, arquivo: 'sha256' }); continue }
    for (const d of compararRetratos(esperado, retratoDoArquivo(arquivo, env))) divergencias.push({ banco: nome, ...d })
  }
  if (divergencias.length > 0) {
    throw new PacoteCasaError('pacote-corrompido', 'O pacote não confere com o próprio manifesto.', { divergencias })
  }
  return manifesto
}
```

- [ ] Rodar. Esperado: 13 de 13.
- [ ] **Mutantes:**
  - sem a checagem do sha256 → vermelho em "só no cabeçalho";
  - sem o retrato → vermelho em "manifesto adulterado";
  - sem a checagem do `formato` → vermelho em "manifesto estranho" (por isso o manifesto adulterado é inteiro, só com o formato trocado);
  - sem a checagem de arquivo ausente → vermelho em "banco faltando".
- [ ] Commit `feat(casa): conferir o pacote contra o manifesto`.

### Tarefa 4: importar

- [ ] **Teste vermelho:**

```js
import { importarCasa } from '../runtime/casa/pacote-casa.mjs'

const destinoDe = (pasta) => {
  const casa = join(pasta, 'casa-destino')
  return { casa, env: { ...process.env, OMNI_HOME: casa, OMNI_CASA_BANCO: join(casa, 'casa') } }
}

test('importar numa casa vazia traz tudo igual e fecha sem -wal', () => comCasa((c) => {
  const saida = pacotePronto(c)
  const d = destinoDe(c.pasta)
  const r = importarCasa(d.casa, saida, { env: d.env })
  assert.equal(r.importado, true); assert.equal(r.backup, null)
  const m = JSON.parse(readFileSync(join(saida, 'manifesto.json'), 'utf8'))
  for (const nome of ['nucleo', 'omni']) {
    const vivo = comBancoDaCasa(d.casa, nome, (db) => retratoDoBanco(db), d.env)
    assert.deepEqual(compararRetratos(m.bancos[nome], vivo), [], nome)
  }
  assert.equal(r.bancos.omni.linhas, Object.values(m.bancos.omni.tabelas).reduce((s, t) => s + t.linhas, 0))
}))

test('casa com banco recusa sem --substituir e não muda nada', () => comCasa((c) => {
  const saida = pacotePronto(c)
  const d = destinoDe(c.pasta)
  comBancoDaCasa(d.casa, 'omni', () => null, d.env)
  const antes = sha256(readFileSync(join(d.casa, 'casa', 'omni.db')))
  assert.throws(() => importarCasa(d.casa, saida, { env: d.env }), { code: 'casa-existente' })
  assert.equal(sha256(readFileSync(join(d.casa, 'casa', 'omni.db'))), antes)
}))

test('--substituir guarda o banco atual num backup datado antes de copiar', () => comCasa((c) => {
  const saida = pacotePronto(c)
  const d = destinoDe(c.pasta)
  comBancoDaCasa(d.casa, 'omni', (db) => registrarDespacho(db, { agente: 'oraculo', execucao: 'velho' }, { maquina: 'destino' }), d.env)
  const antes = sha256(readFileSync(join(d.casa, 'casa', 'omni.db')))
  const r = importarCasa(d.casa, saida, { env: d.env, substituir: true, agora: '2026-11-10T01:02:03.004Z' })
  assert.equal(r.backup, join(d.casa, 'casa', 'antes-de-importar-2026-11-10T01-02-03-004Z'))
  assert.equal(sha256(readFileSync(join(r.backup, 'omni.db'))), antes)
  const ids = comBancoDaCasa(d.casa, 'omni', (db) => db.prepare('SELECT id FROM despachos ORDER BY id').all().map((l) => l.id), d.env)
  assert.deepEqual(ids, ['oraculo/e1'])
}))

test('pacote com migração mais nova que este Omni é recusado', () => comCasa((c) => {
  const saida = pacotePronto(c)
  const caminho = join(saida, 'manifesto.json')
  mexer(join(saida, 'omni.db'), "INSERT INTO _migracoes (versao, nome, sha256, aplicada_em) VALUES (999, 'futura', 'x', 'y')")
  const m = JSON.parse(readFileSync(caminho, 'utf8'))
  const db = new DatabaseSync(join(saida, 'omni.db'))
  try { m.bancos.omni = { ...m.bancos.omni, ...retratoDoBanco(db) } } finally { db.close() }
  m.bancos.omni.sha256 = sha256(readFileSync(join(saida, 'omni.db')))
  writeFileSync(caminho, JSON.stringify(m))
  const d = destinoDe(c.pasta)
  assert.throws(() => importarCasa(d.casa, saida, { env: d.env }), { code: 'pacote-mais-novo' })
  assert.ok(!existsSync(join(d.casa, 'casa', 'omni.db')))
}))

test('banco aberto na casa vira casa-ocupada e nada muda', { skip: process.platform !== 'win32' }, () => comCasa((c) => {
  const saida = pacotePronto(c)
  const d = destinoDe(c.pasta)
  comBancoDaCasa(d.casa, 'nucleo', () => null, d.env)
  comBancoDaCasa(d.casa, 'omni', () => null, d.env)
  const aberto = new DatabaseSync(join(d.casa, 'casa', 'omni.db'))
  try {
    assert.throws(() => importarCasa(d.casa, saida, { env: d.env, substituir: true }), { code: 'casa-ocupada' })
    assert.ok(existsSync(join(d.casa, 'casa', 'nucleo.db')), 'o nucleo.db voltou do backup')
    assert.deepEqual(readdirSync(join(d.casa, 'casa')).filter((n) => n.startsWith('antes-de-importar')), [])
  } finally { aberto.close() }
}))
```

- [ ] Rodar. Esperado: falha (`importarCasa` não existe).
- [ ] **Implementação:**

```js
import { constants, copyFileSync, renameSync } from 'node:fs'
import { basename } from 'node:path'
import { pastaDoBanco } from './banco.mjs'

const SOBRAS = ['', '-wal', '-shm', '-journal']
const OCUPADO = new Set(['EBUSY', 'EPERM', 'EACCES'])

export function importarCasa(casa, pasta, { substituir = false, env = process.env, agora = agoraIso() } = {}) {
  const origem = resolve(pasta)
  const manifesto = conferirPacote(origem, { env })
  for (const nome of BANCOS_DO_PACOTE) {
    const conhecida = Math.max(0, ...BANCOS[nome].migracoes.map((m) => m.versao))
    if (manifesto.bancos[nome].migracao > conhecida) {
      throw new PacoteCasaError('pacote-mais-novo', `O pacote traz o ${nome}.db na migração ${manifesto.bancos[nome].migracao} e este Omni conhece até a ${conhecida}; atualize o Omni antes de importar.`)
    }
  }
  const pastaBanco = pastaDoBanco(casa, env)
  const existentes = BANCOS_DO_PACOTE
    .flatMap((nome) => SOBRAS.map((sufixo) => join(pastaBanco, `${BANCOS[nome].arquivo}${sufixo}`)))
    .filter((arquivo) => existsSync(arquivo))
  if (existentes.length > 0 && !substituir) {
    throw new PacoteCasaError('casa-existente', 'Esta casa já tem banco; com --substituir o atual vai para um backup datado antes da cópia.')
  }
  mkdirSync(pastaBanco, { recursive: true })
  const backup = existentes.length > 0 ? join(pastaBanco, `antes-de-importar-${agora.replace(/[:.]/g, '-')}`) : null
  const movidos = []
  const devolverBackup = () => {
    for (const [de, para] of movidos.reverse()) renameSync(para, de)
    if (backup) rmSync(backup, { recursive: true, force: true })
  }
  if (backup) {
    mkdirSync(backup)
    try {
      for (const de of existentes) {
        const para = join(backup, basename(de))
        renameSync(de, para)
        movidos.push([de, para])
      }
    } catch (erro) {
      devolverBackup()
      if (OCUPADO.has(erro.code)) {
        throw new PacoteCasaError('casa-ocupada', 'Um processo está com o banco da casa aberto; feche o Omni (servir, ilha e sessões) e tente de novo.')
      }
      throw erro
    }
  }
  const copiados = []
  try {
    const migracoes = {}
    for (const nome of BANCOS_DO_PACOTE) {
      const destino = join(pastaBanco, BANCOS[nome].arquivo)
      copiados.push(...SOBRAS.map((sufixo) => `${destino}${sufixo}`), `${destino}.importando`)
      copyFileSync(join(origem, manifesto.bancos[nome].arquivo), `${destino}.importando`, constants.COPYFILE_EXCL)
      renameSync(`${destino}.importando`, destino)
      const divergencias = compararRetratos(manifesto.bancos[nome], retratoDoArquivo(destino, env))
      if (divergencias.length > 0) {
        throw new PacoteCasaError('copia-divergente', 'A cópia na casa não bateu com o pacote; o banco anterior voltou.', { divergencias: divergencias.map((d) => ({ banco: nome, ...d })) })
      }
    }
    const bancos = {}
    for (const nome of BANCOS_DO_PACOTE) {
      bancos[nome] = comBancoDaCasa(casa, nome, (db) => resumirRetrato(retratoDoBanco(db)), env)
      migracoes[nome] = { pacote: manifesto.bancos[nome].migracao, casa: bancos[nome].migracao }
    }
    return { importado: true, backup, migracoes, bancos }
  } catch (erro) {
    for (const arquivo of copiados) rmSync(arquivo, { force: true })
    devolverBackup()
    throw erro
  }
}
```

  Juntar os `import` novos aos do topo do arquivo (`constants`, `copyFileSync`, `renameSync`, `basename` e `pastaDoBanco`).
- [ ] Rodar. Esperado: 17 de 17 no Windows.
- [ ] **Mutantes:**
  - sem a recusa `casa-existente` → vermelho em "recusa sem --substituir";
  - backup copiado em vez de movido → vermelho em "guarda o banco atual" pelo `deepEqual` dos ids;
  - sem `devolverBackup` no `catch` do renomear → vermelho em "casa-ocupada", porque o `nucleo.db` não volta;
  - sem a checagem de migração → vermelho em "mais novo".
- [ ] Commit `feat(casa): importar o pacote com backup datado e conferência antes de migrar`.

### Tarefa 5: linha de comando `runtime/executor.mjs`

- [ ] **Teste vermelho** em `testes/executor-cli.test.mjs`, no molde do `testes/nucleo-cli.test.mjs` (saída falsa, casa temporária, `rodarExecutor(argv, { saida, erro, env })`):

```js
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { comBancoDaCasa } from '../runtime/casa/banco.mjs'
import { rodarExecutor } from '../runtime/executor.mjs'

function saidaFalsa() { return { texto: '', write(t) { this.texto += t; return true } } }
const ultimaLinha = (saida) => JSON.parse(saida.texto.trim().split('\n').at(-1))
function comPasta(uso) {
  const pasta = mkdtempSync(join(tmpdir(), 'omni-executor-cli-'))
  try { return uso(pasta) } finally { rmSync(pasta, { recursive: true, force: true }) }
}
const casaEm = (pasta, nome) => {
  const casa = join(pasta, nome)
  return { casa, env: { ...process.env, OMNI_HOME: casa, OMNI_CASA_BANCO: join(casa, 'casa') } }
}
async function rodar(env, argv) {
  const saida = saidaFalsa(); const erro = saidaFalsa()
  return { codigo: await rodarExecutor(argv, { saida, erro, env }), saida, erro }
}

test('uso errado sai com 2 e nunca ecoa o argumento', async () => comPasta(async (pasta) => {
  const { env } = casaEm(pasta, 'a')
  for (const argv of [[], ['sumir'], ['exportar'], ['importar'], ['verificar', '--segredo=valor-que-nao-volta'], ['exportar', 'solto']]) {
    const r = await rodar(env, argv)
    assert.equal(r.codigo, 2, JSON.stringify(argv))
    assert.match(r.erro.texto, /uso: node runtime\/executor\.mjs/)
    assert.ok(!r.erro.texto.includes('valor-que-nao-volta'))
    assert.equal(r.saida.texto, '')
  }
}))

test('exportar, importar noutra casa e verificar contra o pacote: 100%', async () => comPasta(async (pasta) => {
  const a = casaEm(pasta, 'origem'); const b = casaEm(pasta, 'destino')
  comBancoDaCasa(a.casa, 'nucleo', () => null, a.env)
  const pacote = join(pasta, 'pacote')
  const ex = await rodar(a.env, ['exportar', '--saida', pacote])
  assert.equal(ex.codigo, 0, ex.erro.texto); assert.equal(ultimaLinha(ex.saida).ok, true)
  const im = await rodar(b.env, ['importar', '--pacote', pacote])
  assert.equal(im.codigo, 0, im.erro.texto); assert.equal(ultimaLinha(im.saida).importado, true)
  const ve = await rodar(b.env, ['verificar', '--pacote', pacote])
  assert.equal(ve.codigo, 0, ve.erro.texto)
  const v = ultimaLinha(ve.saida)
  assert.equal(v.ok, true); assert.deepEqual(v.divergencias, [])
  assert.equal(v.bancos.omni.integridade, 'ok')
}))

test('verificar aponta divergência com saída 3', async () => comPasta(async (pasta) => {
  const a = casaEm(pasta, 'origem')
  const pacote = join(pasta, 'pacote')
  await rodar(a.env, ['exportar', '--saida', pacote])
  comBancoDaCasa(a.casa, 'nucleo', (db) => registrarMaquina(db, { maquina: 'nova', nome: 'nova', sistema: 'teste' }), a.env)
  const ve = await rodar(a.env, ['verificar', '--pacote', pacote])
  assert.equal(ve.codigo, 3)
  const v = ultimaLinha(ve.saida)
  assert.equal(v.ok, false); assert.ok(v.divergencias.some((d) => d.banco === 'nucleo' && d.tabela === 'maquinas'))
}))

test('verificar sem banco não cria banco e diz que falta', async () => comPasta(async (pasta) => {
  const a = casaEm(pasta, 'vazia')
  const ve = await rodar(a.env, ['verificar'])
  assert.equal(ve.codigo, 3)
  assert.equal(ultimaLinha(ve.saida).bancos.omni.existe, false)
  assert.ok(!existsSync(join(a.casa, 'casa', 'omni.db')))
}))

test('recusas do pacote saem com 3 e o código no JSON', async () => comPasta(async (pasta) => {
  const a = casaEm(pasta, 'origem')
  const r = await rodar(a.env, ['importar', '--pacote', join(pasta, 'nao-existe')])
  assert.equal(r.codigo, 3)
  assert.deepEqual([ultimaLinha(r.saida).ok, ultimaLinha(r.saida).codigo], [false, 'pacote-invalido'])
}))
```

  Imports extras: `existsSync` de `node:fs` e `registrarMaquina` de `runtime/casa/loja-nucleo.mjs`.
- [ ] Rodar. Esperado: falha de importação (`executor.mjs` não existe).
- [ ] **Implementação** de `runtime/executor.mjs`:

```js
// Executor do Omni, parte do pacote da casa (§4.2, §5): exportar, importar e verificar o nucleo.db e
// o omni.db. O instalar e o atualizar chegam no plano 5b, que chama este mesmo arquivo.
// A saída é JSON numa linha. Códigos de saída: 0 ok; 2 uso errado; 3 recusa ou divergência;
// 1 falha inesperada (vai para degradacoes.jsonl).
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { arquivoDoBanco, comBancoDaCasa, registrarDegradacao } from './casa/banco.mjs'
import {
  BANCOS_DO_PACOTE, PacoteCasaError, compararRetratos, conferirPacote, exportarCasa, importarCasa, resumirRetrato, retratoDoBanco
} from './casa/pacote-casa.mjs'
import { casaDoNucleo } from './nucleo.mjs'

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)))
const USO = `uso: node runtime/executor.mjs <comando> [opções]
  exportar --saida <pasta>   (nucleo.db e omni.db por VACUUM INTO, com manifesto)
  importar --pacote <pasta> [--substituir]   (confere tudo antes; o banco atual vai para backup datado)
  verificar [--pacote <pasta>]   (integridade do SQLite; com --pacote, contagem e hash por tabela)`
class UsoError extends Error {}

function lerOpcoes(argumentos, opcoes, obrigatorias = []) {
  let lidas
  try { lidas = parseArgs({ args: argumentos, options: opcoes, strict: true, allowPositionals: false }).values }
  catch (erro) { throw new UsoError(`opções inválidas (${erro.code ?? erro.name})`) }   // nunca ecoa o argumento
  for (const nome of obrigatorias) if (lidas[nome] === undefined || lidas[nome] === '') throw new UsoError(`falta --${nome}`)
  return lidas
}

function versaoDoOmni() {
  try { return JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')).version ?? null } catch { return null }
}

// Verificar nunca cria banco: arquivo ausente é resposta, não convite.
function verificarCasa(casa, pacote, env) {
  const manifesto = pacote === undefined ? null : conferirPacote(pacote, { env })
  const bancos = {}; const divergencias = []
  for (const nome of BANCOS_DO_PACOTE) {
    if (!existsSync(arquivoDoBanco(casa, nome, env))) { bancos[nome] = { existe: false }; continue }
    const { integridade, retrato } = comBancoDaCasa(casa, nome, (db) => ({
      integridade: db.prepare('PRAGMA integrity_check').all().map((linha) => Object.values(linha)[0]).join('; '),
      retrato: retratoDoBanco(db)
    }), env)
    bancos[nome] = { existe: true, integridade, ...resumirRetrato(retrato) }
    if (manifesto) for (const d of compararRetratos(manifesto.bancos[nome], retrato)) divergencias.push({ banco: nome, ...d })
  }
  const ok = Object.values(bancos).every((b) => b.existe && b.integridade === 'ok') && divergencias.length === 0
  return { ok, bancos, ...(manifesto ? { pacote: { criado_em: manifesto.criado_em, omni: manifesto.omni }, divergencias } : {}) }
}

export async function rodarExecutor(argv, { saida = process.stdout, erro = process.stderr, env = process.env } = {}) {
  const casa = casaDoNucleo(env)
  const escrever = (objeto) => saida.write(`${JSON.stringify(objeto)}\n`)
  const [comando, ...resto] = argv
  try {
    switch (comando) {
      case 'exportar': {
        const o = lerOpcoes(resto, { saida: { type: 'string' } }, ['saida'])
        escrever({ ok: true, ...exportarCasa(casa, resolve(o.saida), { env, omni: versaoDoOmni() }) }); return 0
      }
      case 'importar': {
        const o = lerOpcoes(resto, { pacote: { type: 'string' }, substituir: { type: 'boolean' } }, ['pacote'])
        escrever({ ok: true, ...importarCasa(casa, resolve(o.pacote), { env, substituir: o.substituir === true }) }); return 0
      }
      case 'verificar': {
        const o = lerOpcoes(resto, { pacote: { type: 'string' } })
        const r = verificarCasa(casa, o.pacote === undefined ? undefined : resolve(o.pacote), env)
        escrever(r); return r.ok ? 0 : 3
      }
      default: throw new UsoError(comando === undefined ? 'falta o comando' : 'comando desconhecido')
    }
  } catch (falha) {
    if (falha instanceof UsoError) { erro.write(`${falha.message}\n${USO}\n`); return 2 }
    if (falha instanceof PacoteCasaError) {
      escrever({ ok: false, codigo: falha.code, erro: falha.message, ...(falha.divergencias ? { divergencias: falha.divergencias } : {}) }); return 3
    }
    registrarDegradacao(casa, 'executor.cli', falha, env)
    erro.write(`falha inesperada no executor: ${String(falha?.message ?? falha).slice(0, 300)}\n`)
    return 1
  }
}

const direto = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (direto) process.exitCode = await rodarExecutor(process.argv.slice(2))
```

- [ ] Rodar. Esperado: 5 de 5.
- [ ] **Mutantes:**
  - `verificar` sem a comparação → vermelho em "aponta divergência";
  - `verificar` abrindo banco ausente → vermelho em "não cria banco".
- [ ] Pôr `node --check runtime/casa/pacote-casa.mjs && node --check runtime/executor.mjs` no script `check` do `package.json`, logo depois do `runtime/maos-actions.mjs`.
- [ ] `npm run check` verde lido.
- [ ] Commit `feat(executor): exportar, importar e verificar a casa pela linha de comando`.

### Tarefa 6: prova na casa real (só leitura) e release 0.31.0

- [ ] **Prova sem tocar na casa real:**
  - `exportar` da casa real para `$env:LOCALAPPDATA\omni\rascunho\pacote-<carimbo>`. É só leitura: o `VACUUM INTO` lê.
  - `importar` numa casa temporária (`OMNI_HOME` e `OMNI_CASA_BANCO` no rascunho).
  - `verificar --pacote` na temporária. Esperado: `ok:true`, 0 divergências, contagens iguais às da casa real.
  - Apagar o rascunho no fim. O pacote tem memória dele e não fica largado.
- [ ] Suíte inteira (`npm test`) em segundo plano, lida até o total; `dist` sem ruído.
- [ ] Bump 0.30.0 → 0.31.0: `plugin.json`, `package.json`, `package-lock.json`, `releases.json` (notas) e `integridade.json` (impressão digital por `calcularFingerprintPayload`).
- [ ] Integridade e release verdes; commit `release: 0.31.0 ...` Weriton-DataOps; PR; CI verde; merge `--merge --match-head-commit`.
- [ ] Atualizar o plugin instalado para a 0.31.0 e verificar: integridade, impressão digital e `executor.mjs verificar` na casa real com `ok:true`.

## Fora deste plano

- **5b:** `scripts/omni-instalar.ps1` com `instalar`, `atualizar`, `importar` e `exportar`, onde o cofre entra pelo pacote cifrado. Também ficam com ele a release com zip e SHA, as tarefas agendadas, os tokens dos agentes, a chave admin do WhatsApp, a guarda contra dois `servir` e a ilha com `OMNI_ILHA_PAREAR=1`.
- **5c:** `actions-visita` pelo manifesto do Oráculo, saída da pilha antiga da ilha e o botão "instalar" chamando o executor.
