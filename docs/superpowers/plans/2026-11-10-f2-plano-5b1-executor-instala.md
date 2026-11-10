# F2, plano 5b-1: o executor instala (lado Node)

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** o `runtime/executor.mjs` passa a instalar.
- `instalar` cria a casa (os três bancos, com as migrações) e registra o próprio Omni no `nucleo.db` a partir do `executor/agente.json` dele.
- `instalar-agente --raiz <pasta>` instala outro agente: confere os requisitos, gera os tokens `tela` e `visita` no cofre, entrega os sha256 ao `instalar --stdin` do agente e só registra no núcleo depois que ele aceita.
- O `servir` recusa subir quando já há outro vivo na mesma casa.

**Arquitetura:**
- A lógica mora em `runtime/casa/instalar-casa.mjs`, que é Node puro e testável. O `executor.mjs` só lê as opções e escreve o JSON.
- O `scripts/omni-instalar.ps1` do plano 5b-2 vai ser casca fina sobre estes comandos. Ele fica com o que é do Windows: release em zip com SHA em `versoes\<sha>`, `npm ci` da ilha, plugin, tarefas agendadas, chave admin do WhatsApp e a ilha aberta com `OMNI_ILHA_PAREAR=1`.

**Tecnologia:** Node ≥ 24 (`node:sqlite`, `node:child_process`, `node:test`).

**Desenho:** [Casa única](../specs/2026-11-04-casa-unica-tres-agentes-design.md), §4 (passos 3 e 6), §4.2 e §8.3. Plano mestre: [F2](2026-11-09-f2-casa-instalavel.md), linha 5b.

**Situação em 10/11/2026:**
- Ramo `casa-f2-p5b`, criado de `origin/main` `d01bad2` (PR #13, release 0.31.0).

---

## O que já existe e este plano usa (lido no código em 10/11)

- **`runtime/casa/banco.mjs`.**
  - `comBancoDaCasa(casa, nome, uso, env)` abre o banco e aplica as migrações pendentes.
  - A tabela `_migracoes` guarda `versao`, `nome`, `sha256` e `aplicada_em`.
  - `pastaDoBanco` segue o `OMNI_CASA_BANCO`.
- **`runtime/casa/esquemas.mjs`:** `BANCOS = {nucleo, omni, cofre}`, cada um com `{arquivo, migracoes}`.
- **`runtime/casa/loja-nucleo.mjs`.**
  - Exporta `lerManifesto(raiz)`, que devolve os bytes, e `validarManifesto(bytes)`, que devolve `{manifesto, sha256, texto}`.
  - Exporta `registrarAgente(db, bytes, {raiz})`, que devolve `{agente, versao, maquina, mudou:{agente, instalacao}}`, e `listarInstalados(db)`.
  - `NucleoError` tem `code` e `erros`.
  - `omni` não é nome reservado no núcleo.
- **`runtime/casa/credenciais-agente.mjs`.**
  - `garantirTokensDoAgente(db, ponte, agente)` devolve `{tela, visita, novos}`, só com os sha256. É idempotente: na segunda vez, `novos` vem `[]`.
  - `omni` é reservado ali: o Omni não tem token de si mesmo.
  - `tokenDoAgente(db, ponte, agente, papel, motivo)` abre o valor.
- **`runtime/casa/supervisor.mjs`:** `partirComando(comando)` devolve `{programa, argumentos}` e troca `node` pelo `process.execPath`.
- **`runtime/casa/dpapi.mjs`:** `criarPonteDpapi()`. Nos testes entra a ponte falsa de `testes/casa-credenciais-agente.test.mjs:16-29`, um XOR com prefixo.
- **`runtime/casa/sessoes-vivas.mjs`:** `processoVivo(pid)`.
- **`runtime/maos-actions.mjs`:** `arquivoServir(casa, env)`, que é o `servir.json` na pasta do banco.
- **O Oráculo (`executor/oraculo-executor.mjs`, só leitura).** Contrato: `instalar --stdin` lê o JSON `{"tela":"<sha256>","visita":"<sha256>"}`.
  - O manifesto dele declara `requer: {node: ">=24", agentes: ["omni>=0.26"]}` e `executor.comando: "node executor/oraculo-executor.mjs"`.
- **`runtime/integridade-release.mjs`:** `PAYLOAD_ROOTS` não tem `executor/`. Sem essa raiz, o manifesto do Omni ficaria fora da impressão digital.

## Mapa de arquivos

| Arquivo | Papel |
|---|---|
| `executor/agente.json` (novo) | Manifesto do Omni: banco `omni.db`, modos do executor, sem `servir` (o Omni não se supervisiona) |
| `runtime/integridade-release.mjs` | `executor` entra no payload, opcional como `adaptadores` |
| `runtime/casa/instalar-casa.mjs` (novo) | `instalarCasa`, `requisitosFaltando`, `instalarAgente`, `InstalarError` |
| `runtime/executor.mjs` | Comandos `instalar` e `instalar-agente`; `InstalarError` e `NucleoError` viram saída 3 |
| `runtime/servir.mjs` | Guarda: `servir.json` com pid vivo de outro processo → recusa |
| `testes/omni-manifesto.test.mjs` (novo) | O manifesto do Omni passa no `validarManifesto` e acompanha a versão do `package.json` |
| `testes/executor-instalar.test.mjs` (novo) | `instalar` e `instalar-agente`, com agente falso de verdade (processo filho) e ponte falsa |
| `testes/casa-servir.test.mjs` | Dois `servir` na mesma casa; `servir.json` órfão não trava |

---

### Tarefa 1: o manifesto do Omni

**Arquivos:**
- Criar: `executor/agente.json`
- Modificar: `runtime/integridade-release.mjs:7-15`
- Teste: `testes/omni-manifesto.test.mjs`

- [x] **Passo 1: teste que falha**

```js
// O manifesto do próprio Omni (F2, plano 5b-1): é por ele que o instalar registra o Omni no núcleo.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { lerManifesto, validarManifesto } from '../runtime/casa/loja-nucleo.mjs'

const RAIZ = resolve(import.meta.dirname, '..')

test('o executor/agente.json do Omni passa na validação do núcleo', () => {
  const { manifesto } = validarManifesto(lerManifesto(RAIZ))
  assert.equal(manifesto.agente, 'omni')
  assert.equal(manifesto.banco, 'omni.db')
  assert.equal(manifesto.executor.comando, 'node runtime/executor.mjs')
  assert.deepEqual(manifesto.executor.modos, ['instalar', 'importar', 'exportar', 'verificar'])
  assert.equal(manifesto.executor.modos.includes('servir'), false, 'o Omni não se supervisiona')
})

test('a versão do manifesto acompanha a do package.json', () => {
  const pacote = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8'))
  assert.equal(validarManifesto(lerManifesto(RAIZ)).manifesto.versao, pacote.version)
})
```

- [x] **Passo 2: ver vermelho.** Rodar `node --test --test-reporter=spec testes/omni-manifesto.test.mjs`. Esperado: os dois falham com `NucleoError` `sem-manifesto`.

- [x] **Passo 3: o manifesto.** Criar `executor/agente.json`:

```json
{
  "agente": "omni",
  "versao": "0.31.0",
  "banco": "omni.db",
  "migracoes": "runtime/casa/esquemas.mjs",
  "requer": {
    "node": ">=24"
  },
  "executor": {
    "comando": "node runtime/executor.mjs",
    "modos": [
      "instalar",
      "importar",
      "exportar",
      "verificar"
    ]
  },
  "tarefas": [],
  "credenciais": []
}
```

Escolhas:
- **Sem `atualizar`**, porque ele chega no 5b-2 junto do zip.
- **`tarefas` vazias.** A visita das 7h passa para o manifesto do Oráculo no 5c. O vigia do WhatsApp entra no 5b-2, quando o zip levar o `servicos/`.

- [x] **Passo 4: payload.** Em `runtime/integridade-release.mjs`, acrescentar à `PAYLOAD_ROOTS`, depois de `dist`:

```js
  { path: 'executor', required: false },
```

- [x] **Passo 5: ver verde.** Rodar o teste novo e também `node --test --test-reporter=spec testes/integridade-release.test.mjs` (ou o arquivo que importa `calcularFingerprintPayload`, achado por Grep).

A impressão digital declarada vai divergir até o bump da T5. Isso é esperado: anotar o nome do teste que acusa e seguir.

- [x] **Passo 6: commit.** Mensagem: `feat(executor): manifesto do Omni e executor/ no payload da release`.

---

### Tarefa 2: `instalar` cria a casa e registra o Omni

**Arquivos:**
- Criar: `runtime/casa/instalar-casa.mjs`
- Modificar: `runtime/executor.mjs`
- Teste: `testes/executor-instalar.test.mjs`

- [x] **Passo 1: teste que falha.** Criar `testes/executor-instalar.test.mjs`:

```js
// O executor instala (F2, plano 5b-1): a casa com os três bancos e o Omni registrado no núcleo, e os
// outros agentes com tokens no cofre, sha256 entregue ao instalar --stdin deles e registro só depois.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { arquivoDoBanco, comBancoDaCasa } from '../runtime/casa/banco.mjs'
import { credencialPorNome } from '../runtime/casa/loja-cofre.mjs'
import { tokenDoAgente } from '../runtime/casa/credenciais-agente.mjs'
import { BANCOS } from '../runtime/casa/esquemas.mjs'
import { listarInstalados } from '../runtime/casa/loja-nucleo.mjs'
import { rodarExecutor } from '../runtime/executor.mjs'

const RAIZ = resolve(import.meta.dirname, '..')
const VERSAO = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')).version

function ponteFalsa(marca = 'FALSO:') {
  const prefixo = Buffer.from(marca)
  const xor = (bytes) => { const saida = Buffer.from(bytes); for (let i = 0; i < saida.length; i++) saida[i] ^= 0x5a; return saida }
  return {
    selar(valores) { return valores.map((valor) => Buffer.concat([prefixo, xor(valor)])) },
    abrir(blobs) {
      return blobs.map((blob) => {
        const bytes = blob instanceof Uint8Array ? Buffer.from(blob) : null
        if (!bytes || !bytes.subarray(0, prefixo.length).equals(prefixo)) return { ok: false, erro: 'CryptographicException' }
        return { ok: true, valor: xor(bytes.subarray(prefixo.length)) }
      })
    }
  }
}

function casaTemporaria(t, extra = {}) {
  const pasta = mkdtempSync(join(tmpdir(), 'omni-instalar-'))
  t.after(() => rmSync(pasta, { recursive: true, force: true }))
  return { pasta, env: { ...process.env, OMNI_HOME: pasta, OMNI_CASA_BANCO: join(pasta, 'banco'), ...extra } }
}

async function rodar(argv, env, opcoes = {}) {
  let saida = ''
  let erro = ''
  const codigo = await rodarExecutor(argv, {
    env, saida: { write: (t) => { saida += t } }, erro: { write: (t) => { erro += t } }, ...opcoes
  })
  return { codigo, json: saida ? JSON.parse(saida) : null, erro }
}

const maxima = (nome) => Math.max(...BANCOS[nome].migracoes.map((m) => m.versao))

test('instalar cria os três bancos migrados e registra o Omni com a raiz da release', async (t) => {
  const { pasta, env } = casaTemporaria(t)
  const r = await rodar(['instalar'], env)
  assert.equal(r.codigo, 0, r.erro)
  assert.equal(r.json.ok, true)
  for (const nome of ['nucleo', 'omni', 'cofre']) {
    assert.ok(existsSync(arquivoDoBanco(pasta, nome, env)), `${nome}.db criado`)
    assert.equal(r.json.bancos[nome].migracao, maxima(nome))
  }
  assert.equal(r.json.omni.versao, VERSAO)
  assert.deepEqual(r.json.omni.mudou, { agente: true, instalacao: true })
  const instalados = comBancoDaCasa(pasta, 'nucleo', (db) => listarInstalados(db), env)
  assert.deepEqual(instalados.map((i) => [i.agente, i.raiz]), [['omni', RAIZ]])
})

test('instalar de novo não muda nada', async (t) => {
  const { env } = casaTemporaria(t)
  assert.equal((await rodar(['instalar'], env)).codigo, 0)
  const segunda = await rodar(['instalar'], env)
  assert.equal(segunda.codigo, 0)
  assert.deepEqual(segunda.json.omni.mudou, { agente: false, instalacao: false })
})
```

- [x] **Passo 2: ver vermelho.** Rodar `node --test --test-reporter=spec testes/executor-instalar.test.mjs`. Esperado: saída 2 (`comando desconhecido`) na asserção `r.codigo, 0`.

- [x] **Passo 3: implementação.** Criar `runtime/casa/instalar-casa.mjs`:

```js
// Instalação da casa e dos agentes (§4 passos 3 e 6, §4.2, §8.3). O instalarCasa cria os três bancos
// (as migrações vêm do comBancoDaCasa) e registra o Omni pelo próprio executor/agente.json.
// O instalarAgente confere os requisitos, gera os tokens tela e visita no cofre, entrega só os sha256
// ao instalar --stdin do agente e só registra no núcleo depois que ele aceita: agente que recusa não
// entra na lista do supervisor.
import { spawnSync } from 'node:child_process'

import { comBancoDaCasa } from './banco.mjs'
import { garantirTokensDoAgente } from './credenciais-agente.mjs'
import { BANCOS } from './esquemas.mjs'
import { lerManifesto, listarInstalados, registrarAgente, validarManifesto } from './loja-nucleo.mjs'
import { partirComando } from './supervisor.mjs'

export class InstalarError extends Error {
  constructor(codigo, mensagem) {
    super(mensagem)
    this.name = 'InstalarError'
    this.code = codigo
  }
}

const ultimaMigracao = (db) => db.prepare('SELECT max(versao) AS v FROM _migracoes').get().v
const daMaquina = ({ maquina, agora }) => ({ ...(maquina ? { maquina } : {}), ...(agora ? { agora } : {}) })

export function instalarCasa(casa, raizOmni, { env = process.env, maquina, agora } = {}) {
  const bancos = {}
  for (const nome of Object.keys(BANCOS)) bancos[nome] = { migracao: comBancoDaCasa(casa, nome, ultimaMigracao, env) }
  const bytes = lerManifesto(raizOmni)
  if (validarManifesto(bytes).manifesto.agente !== 'omni') throw new InstalarError('manifesto-alheio', 'O manifesto da raiz do Omni não é do agente omni.')
  const r = comBancoDaCasa(casa, 'nucleo', (db) => registrarAgente(db, bytes, { raiz: raizOmni, ...daMaquina({ maquina, agora }) }), env)
  return { bancos, omni: { versao: r.versao, mudou: r.mudou } }
}
```

Em `runtime/executor.mjs`:
- importar `instalarCasa` e `InstalarError` de `./casa/instalar-casa.mjs` e `NucleoError` de `./casa/loja-nucleo.mjs`;
- acrescentar ao `USO` a linha `  instalar   (cria a casa com os três bancos e registra o Omni desta release)`;
- acrescentar o caso:

```js
      case 'instalar': {
        lerOpcoes(resto, {})
        escrever({ ok: true, ...instalarCasa(casa, RAIZ, { env }) })
        return 0
      }
```

- no `catch`, antes do registro de degradação:

```js
    if (falha instanceof InstalarError || falha instanceof NucleoError) {
      escrever({ ok: false, codigo: falha.code, erro: falha.message, ...(falha.erros ? { erros: falha.erros } : {}) })
      return 3
    }
```

- trocar o comentário do topo para "exportar, importar, verificar e instalar; o atualizar chega com o zip da release (plano 5b-2)".

- [x] **Passo 4: ver verde.** Os dois testes passam, e `testes/executor-cli.test.mjs` continua 5/5.

- [x] **Passo 5: mutante.**
  - Trocar `raiz: raizOmni` por `raiz: casa`: o primeiro teste tem de ficar vermelho na asserção da raiz.
  - Desfazer o mutante.

- [x] **Passo 6: commit.** Mensagem: `feat(executor): instalar cria a casa e registra o Omni`.

---

### Tarefa 3: `instalar-agente` com tokens e registro depois do aceite

**Arquivos:**
- Modificar: `runtime/casa/instalar-casa.mjs`
- Modificar: `runtime/executor.mjs`
- Teste: `testes/executor-instalar.test.mjs`

- [x] **Passo 1: testes que falham.** Acrescentar a `testes/executor-instalar.test.mjs`:

```js
// Agente falso de verdade: grava em recebido.json o argv e o stdin, ou sai com FALSO_SAIR.
const FALSO = `import { readFileSync, writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
if (process.env.FALSO_SAIR) { process.stderr.write('recusei'); process.exit(Number(process.env.FALSO_SAIR)) }
const entrada = args.includes('--stdin') ? readFileSync(0, 'utf8') : null
writeFileSync('recebido.json', JSON.stringify({ args, entrada }))
process.stdout.write('{"ok":true}\\n')
`

function agenteFalso(t, mudar = (m) => m) {
  const raiz = mkdtempSync(join(tmpdir(), 'omni-agente-falso-'))
  t.after(() => rmSync(raiz, { recursive: true, force: true }))
  mkdirSync(join(raiz, 'executor'))
  writeFileSync(join(raiz, 'executor', 'falso.mjs'), FALSO)
  const manifesto = mudar({
    agente: 'falso', versao: '1.0.0', banco: null, requer: { node: '>=24', agentes: ['omni>=0.26'] },
    executor: { comando: 'node executor/falso.mjs', modos: ['instalar', 'servir'] }, tarefas: [], credenciais: []
  })
  writeFileSync(join(raiz, 'executor', 'agente.json'), JSON.stringify(manifesto, null, 2))
  return raiz
}
const recebido = (raiz) => JSON.parse(readFileSync(join(raiz, 'recebido.json'), 'utf8'))
const sha = (texto) => createHash('sha256').update(texto, 'utf8').digest('hex')
const instalados = (pasta, env) => comBancoDaCasa(pasta, 'nucleo', (db) => listarInstalados(db), env).map((i) => i.agente)

test('instalar-agente gera os tokens, entrega só os sha256 ao instalar --stdin e registra', async (t) => {
  const { pasta, env } = casaTemporaria(t)
  const raiz = agenteFalso(t)
  const ponte = ponteFalsa()
  const r = await rodar(['instalar-agente', '--raiz', raiz], env, { ponte })
  assert.equal(r.codigo, 0, r.erro)
  assert.equal(r.json.agente, 'falso')
  assert.deepEqual(r.json.tokens, { novos: ['tela', 'visita'] })
  assert.deepEqual(r.json.mudou, { agente: true, instalacao: true })
  const { args, entrada } = recebido(raiz)
  assert.deepEqual(args, ['instalar', '--stdin'])
  const valores = comBancoDaCasa(pasta, 'cofre', (db) => ({
    tela: tokenDoAgente(db, ponte, 'falso', 'tela', 'teste'), visita: tokenDoAgente(db, ponte, 'falso', 'visita', 'teste')
  }), env)
  assert.deepEqual(JSON.parse(entrada), { tela: sha(valores.tela), visita: sha(valores.visita) })
  assert.ok(!entrada.includes(valores.tela) && !entrada.includes(valores.visita), 'o token em si nunca vai ao agente')
  assert.ok(!JSON.stringify(r.json).includes(sha(valores.tela)), 'nem o sha256 sai na saída do executor')
  assert.deepEqual(instalados(pasta, env), ['falso'])
})

test('instalar-agente de novo reaproveita os tokens e entrega os mesmos sha256', async (t) => {
  const { env } = casaTemporaria(t)
  const raiz = agenteFalso(t)
  const ponte = ponteFalsa()
  await rodar(['instalar-agente', '--raiz', raiz], env, { ponte })
  const primeira = recebido(raiz).entrada
  const r = await rodar(['instalar-agente', '--raiz', raiz], env, { ponte })
  assert.equal(r.codigo, 0, r.erro)
  assert.deepEqual(r.json.tokens, { novos: [] })
  assert.deepEqual(r.json.mudou, { agente: false, instalacao: false })
  assert.equal(recebido(raiz).entrada, primeira)
})

test('agente sem servir não ganha token e o instalar dele vai sem --stdin', async (t) => {
  const { pasta, env } = casaTemporaria(t)
  const raiz = agenteFalso(t, (m) => ({ ...m, executor: { ...m.executor, modos: ['instalar'] } }))
  const r = await rodar(['instalar-agente', '--raiz', raiz], env, { ponte: ponteFalsa() })
  assert.equal(r.codigo, 0, r.erro)
  assert.equal(r.json.tokens, null)
  assert.deepEqual(recebido(raiz), { args: ['instalar'], entrada: null })
  assert.equal(comBancoDaCasa(pasta, 'cofre', (db) => credencialPorNome(db, 'api/falso/tela'), env) ?? null, null)
})

test('agente que recusa o instalar não entra no núcleo', async (t) => {
  const { pasta, env } = casaTemporaria(t, { FALSO_SAIR: '3' })
  const raiz = agenteFalso(t)
  const r = await rodar(['instalar-agente', '--raiz', raiz], env, { ponte: ponteFalsa() })
  assert.equal(r.codigo, 3)
  assert.equal(r.json.codigo, 'agente-recusou')
  assert.match(r.json.erro, /saiu com 3/)
  assert.deepEqual(instalados(pasta, env), [])
})

test('requisito não atendido para antes de token, agente e registro', async (t) => {
  const { pasta, env } = casaTemporaria(t)
  const raiz = agenteFalso(t, (m) => ({ ...m, requer: { node: '>=24', agentes: ['omni>=99'] } }))
  const r = await rodar(['instalar-agente', '--raiz', raiz], env, { ponte: ponteFalsa() })
  assert.equal(r.codigo, 3)
  assert.equal(r.json.codigo, 'requisito')
  assert.match(r.json.erro, /omni>=99/)
  assert.equal(existsSync(join(raiz, 'recebido.json')), false)
  assert.equal(comBancoDaCasa(pasta, 'cofre', (db) => credencialPorNome(db, 'api/falso/tela'), env) ?? null, null)
  assert.deepEqual(instalados(pasta, env), [])
})

test('requer outro agente: só passa quando ele está instalado na versão pedida', async (t) => {
  const { env } = casaTemporaria(t)
  const base = agenteFalso(t)
  assert.equal((await rodar(['instalar-agente', '--raiz', base], env, { ponte: ponteFalsa() })).codigo, 0)
  const exige = (versao) => agenteFalso(t, (m) => ({ ...m, agente: 'dependente', requer: { agentes: [`falso>=${versao}`] } }))
  const recusado = await rodar(['instalar-agente', '--raiz', exige('2')], env, { ponte: ponteFalsa() })
  assert.equal(recusado.json.codigo, 'requisito')
  assert.equal((await rodar(['instalar-agente', '--raiz', exige('1.0')], env, { ponte: ponteFalsa() })).codigo, 0)
})

test('o Omni não se instala como agente, e manifesto inválido sai 3 com os erros', async (t) => {
  const { env } = casaTemporaria(t)
  const omni = await rodar(['instalar-agente', '--raiz', RAIZ], env, { ponte: ponteFalsa() })
  assert.equal(omni.codigo, 3)
  assert.equal(omni.json.codigo, 'agente-omni')
  const torto = agenteFalso(t, (m) => ({ ...m, versao: 'um' }))
  const r = await rodar(['instalar-agente', '--raiz', torto], env, { ponte: ponteFalsa() })
  assert.equal(r.codigo, 3)
  assert.equal(r.json.codigo, 'manifesto-invalido')
  assert.ok(r.json.erros.some((e) => e.startsWith('versao')))
})

test('instalar-agente sem --raiz é uso errado', async (t) => {
  const { env } = casaTemporaria(t)
  const r = await rodar(['instalar-agente'], env)
  assert.equal(r.codigo, 2)
  assert.match(r.erro, /falta --raiz/)
})
```

- [x] **Passo 2: ver vermelho.** Esperado: os oito falham, com saída 2 (`comando desconhecido`) na primeira asserção de código.

- [x] **Passo 3: implementação.** Acrescentar a `runtime/casa/instalar-casa.mjs`:

```js
// '>=N[.N[.N]]': compara número a número; o que falta na versão conta como 0 e o sufixo -pre é ignorado.
function atende(versao, minimo) {
  const a = String(versao).split('-')[0].split('.').map(Number)
  const b = minimo.replace(/^>=/, '').split('.').map(Number)
  for (let i = 0; i < b.length; i++) {
    const x = a[i] ?? 0
    if (x !== b[i]) return x > b[i]
  }
  return true
}

export function requisitosFaltando(requer = {}, { node, omni, instalados }) {
  const faltas = []
  if (requer.node && !atende(node, requer.node)) faltas.push(`node${requer.node}`)
  for (const pedido of requer.agentes ?? []) {
    const [, agente, minimo] = /^([a-z][a-z0-9-]*)(>=.+)$/.exec(pedido)
    const versao = agente === 'omni' ? omni : instalados.find((i) => i.agente === agente)?.versao
    if (!versao || !atende(versao, minimo)) faltas.push(pedido)
  }
  return faltas
}

const LIMITE_LOG = 300

export function instalarAgente(casa, raiz, {
  env = process.env, ponte, versaoOmni, versaoNode = process.versions.node, executar = spawnSync, log = () => {}, maquina, agora
} = {}) {
  const bytes = lerManifesto(raiz)
  const { manifesto } = validarManifesto(bytes)
  const { agente } = manifesto
  if (agente === 'omni') throw new InstalarError('agente-omni', 'O Omni se instala pelo instalar, não pelo instalar-agente.')
  const opcoes = daMaquina({ maquina, agora })
  const instalados = comBancoDaCasa(casa, 'nucleo', (db) => listarInstalados(db, opcoes), env)
  const faltas = requisitosFaltando(manifesto.requer, { node: versaoNode, omni: versaoOmni, instalados })
  if (faltas.length > 0) throw new InstalarError('requisito', `Requisito não atendido: ${faltas.join(', ')}.`)

  const modos = manifesto.executor?.modos ?? []
  // Só agente com API (servir) tem token: é com ele que a ilha e o carteiro chamam.
  const tokens = modos.includes('servir')
    ? comBancoDaCasa(casa, 'cofre', (db) => garantirTokensDoAgente(db, ponte(), agente, opcoes), env)
    : null
  if (modos.includes('instalar')) {
    const { programa, argumentos } = partirComando(manifesto.executor.comando)
    const r = executar(programa, [...argumentos, 'instalar', ...(tokens ? ['--stdin'] : [])], {
      cwd: raiz, env, encoding: 'utf8', timeout: 120_000, windowsHide: true,
      input: tokens ? JSON.stringify({ tela: tokens.tela, visita: tokens.visita }) : ''
    })
    if (r.error || r.status !== 0) {
      log(`instalar do ${agente}: ${String(r.stderr ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITE_LOG)}`)
      throw new InstalarError('agente-recusou', `O instalar do ${agente} saiu com ${r.error ? (r.error.code ?? 'erro') : r.status}.`)
    }
  }
  const registro = comBancoDaCasa(casa, 'nucleo', (db) => registrarAgente(db, bytes, { raiz, ...opcoes }), env)
  return { agente, versao: manifesto.versao, tokens: tokens ? { novos: tokens.novos } : null, mudou: registro.mudou }
}
```

Em `runtime/executor.mjs`:
- importar `instalarAgente` e `criarPonteDpapi` (de `./casa/dpapi.mjs`);
- `rodarExecutor` ganha a opção `ponte = null`;
- acrescentar ao `USO` a linha `  instalar-agente --raiz <pasta>   (requisitos, tokens no cofre, instalar --stdin do agente e registro no núcleo)`;
- acrescentar o caso:

```js
      case 'instalar-agente': {
        const o = lerOpcoes(resto, { raiz: { type: 'string' } }, ['raiz'])
        let aberta = ponte
        const r = instalarAgente(casa, resolve(o.raiz), {
          env, versaoOmni: versaoDoOmni(), ponte: () => (aberta ??= criarPonteDpapi()),
          log: (texto) => erro.write(`${texto}\n`)
        })
        escrever({ ok: true, ...r })
        return 0
      }
```

- [x] **Passo 4: ver verde.** Os 10 testes do arquivo passam, e `testes/executor-cli.test.mjs` continua 5/5.

- [x] **Passo 5: mutantes.** Cada um tem de cair vermelho numa asserção; depois, desfazer.
  1. Registrar antes de chamar o `instalar` do agente: cai "agente que recusa…".
  2. Mandar `{tela: valor}` cru no lugar do sha256 (trocar `tokens.tela` por `tokenDoAgente(...)`): cai a asserção "o token em si nunca vai ao agente". Basta o mutante de pensamento se a costura não permitir; registrar no PR.
  3. `atende` devolvendo `true` sempre: cai "requisito não atendido…".
  4. Tirar o `modos.includes('servir')`: cai "agente sem servir…".

- [x] **Passo 6: commit.** Mensagem: `feat(executor): instalar-agente entrega o sha256 dos tokens e registra depois do aceite`.

---

### Tarefa 4: um `servir` por casa

**Arquivos:**
- Modificar: `runtime/servir.mjs:103-130`
- Teste: `testes/casa-servir.test.mjs`

O risco é concreto. Dois `servir` na mesma casa disputam o `servir.json` e cada um sobe a sua cópia de cada agente, então o Oráculo roda em dobro, com dois carteiros entregando a mesma fila. A ilha só sobe um, mas a ilha aberta duas vezes, ou um teste manual com ela aberta, sobe o segundo.

A guarda lê o `servir.json`. Se o `pid` for de outro processo vivo, o novo `servir` recusa com `recusa:true` e saída 1, e não abre porta nem banco. Um `servir.json` órfão, de processo morto, não trava nada.

Risco aceito: dois `servir` nascidos no mesmo milissegundo passam pela guarda antes de qualquer um gravar. Fechar isso pediria trava de arquivo exclusiva, e o caso real (a ilha) já é instância única.

- [x] **Passo 1: testes que falham.** Acrescentar a `testes/casa-servir.test.mjs`:

```js
test('segundo servir na mesma casa recusa e não derruba o primeiro', async (t) => {
  const { pasta, env } = pastaTemporaria(t)
  const a = subirServir(t, env)
  const linhaA = await a.primeira()
  assert.equal(linhaA.ok, true)
  const b = subirServir(t, env)
  const linhaB = await b.primeira()
  assert.deepEqual({ ok: linhaB.ok, recusa: linhaB.recusa }, { ok: false, recusa: true })
  assert.match(linhaB.erro, /já há um servir no ar nesta casa/)
  assert.equal(await b.fim, 1)
  assert.equal((await chamar(linhaA.porta, 'GET', '/v1/saude', { token: TOKEN })).status, 200)
  assert.equal(JSON.parse(readFileSync(arquivoServir(pasta, env), 'utf8')).pid, a.filho.pid)
})

test('servir.json órfão (processo morto) não impede a subida', async (t) => {
  const { pasta, env } = pastaTemporaria(t)
  const morto = spawn(process.execPath, ['-e', '0'], { windowsHide: true })
  await new Promise((resolver) => morto.on('close', resolver))
  const arquivo = arquivoServir(pasta, env)
  mkdirSync(dirname(arquivo), { recursive: true })
  writeFileSync(arquivo, JSON.stringify({ pid: morto.pid, porta: 1, agentes: [] }))
  const s = subirServir(t, env)
  assert.equal((await s.primeira()).ok, true)
  assert.equal(JSON.parse(readFileSync(arquivo, 'utf8')).pid, s.filho.pid)
})
```

Acrescentar `mkdirSync` e `writeFileSync` ao import de `node:fs`, e `dirname` ao de `node:path`.

- [x] **Passo 2: ver vermelho.** O primeiro teste falha em `linhaB.ok` (vem `true`). O segundo pode passar já agora: ele é a cerca do mutante "recusar sempre que houver arquivo".

- [x] **Passo 3: implementação.** Em `runtime/servir.mjs`:
  - importar `processoVivo` de `./casa/sessoes-vivas.mjs`;
  - `rodarServir` ganha a opção `vivo = processoVivo`;
  - mover `const servirJson = arquivoServir(casa, env)` para logo depois do bloco que lê porta e token;
  - logo abaixo dele:

```js
  // Um servir por casa: dois supervisionariam cada agente em dobro, com dois carteiros na mesma fila.
  if (outroServirNoAr(servirJson, vivo)) {
    linha({ ok: false, erro: 'já há um servir no ar nesta casa', recusa: true })
    return 1
  }
```

  - e a função, acima de `rodarServir`:

```js
function outroServirNoAr(arquivo, vivo) {
  let pid
  try { pid = JSON.parse(readFileSync(arquivo, 'utf8')).pid } catch { return false }
  return Number.isInteger(pid) && pid !== process.pid && vivo(pid)
}
```

  - apagar a declaração antiga do `servirJson`, perto da linha 183.

- [x] **Passo 4: ver verde.** Rodar `node --test --test-reporter=spec testes/casa-servir.test.mjs` inteiro.

- [x] **Passo 5: mutantes.**
  - Tirar o `vivo(pid)`: cai "servir.json órfão…".
  - Tirar a guarda inteira: cai "segundo servir…".

- [x] **Passo 6: commit.** Mensagem: `fix(servir): um servir por casa; o segundo recusa sem derrubar o primeiro`.

---

### Tarefa 5: prova, verde inteiro, release 0.32.0

- [x] **Passo 1: prova com o Oráculo de verdade (só leitura no repo dele).** Usar o mesmo molde do plano 3, T6.
  - **Pasta:** `%LOCALAPPDATA%\omni\rascunho\prova-p5b1-<hora>`.
  - **Antes e depois:** conferir `git -C <Oracle> status --porcelain`, que tem de ficar igual.
  - **Raiz:** a raiz registrada é uma cópia por `git archive HEAD` + `tar` dentro da pasta. `OMNI_ACTIONS` aponta para uma pasta vazia, e `OMNI_HOME` e `OMNI_CASA_BANCO` ficam na pasta da prova.
  - **Rodar `instalar`:** `node runtime/executor.mjs instalar`. Esperado: `ok:true`, com as três migrações.
  - **Rodar `instalar-agente`:** `node runtime/executor.mjs instalar-agente --raiz <cópia>`, com a ponte DPAPI real. O cofre é o da pasta, nunca o real. Esperado: `ok:true` e `novos: ["tela","visita"]`.
  - **Subir o servir:** `node runtime/servir.mjs --porta 0`. Esperado:
    - `GET /v1/saude` mostra `oraculo` `no-ar`;
    - um segundo `servir` recusa;
    - fechar o stdin encerra os dois processos.
  - **Fechar:** anotar no PR, sem token, sha256 nem caminho pessoal, e apagar a pasta.

- [x] **Passo 2: plano mestre.**
  - A linha 5b vira 5b-1 (este plano, entregue) e 5b-2 (o `omni-instalar.ps1`: zip com SHA, ilha, plugin, tarefas, chave do WhatsApp, `atualizar`).
  - Marcar as caixas deste plano.

- [x] **Passo 3: suíte inteira**, uma pesada por vez.
  - Rodar `npm test`, com a saída num arquivo de rascunho, e ler o total: pass, fail e skip. As 7 falhas conhecidas de `omni-trava-guarda` (`sh.exe`) não contam, desde que o arquivo sozinho passe.
  - Rodar `npm run typecheck` e `npm run check`.
  - Conferir que `git diff --ignore-cr-at-eol --stat -- dist` vem vazio e rodar `git checkout -q -- dist`.

- [x] **Passo 4: bump para 0.32.0.**
  - Os cinco lugares de sempre: `plugin.json`, `package.json`, `package-lock.json`, `releases.json` e `integridade.json`.
  - Mais o `executor/agente.json`, cuja `versao` é vigiada pelo teste da T1.
  - A impressão digital vem por último, com o payload já bumpado.
  - Ler o verde dos testes de integridade e do manifesto.

- [ ] **Passo 5: commit, PR, CI, merge.**
  - Commit `chore(release): 0.32.0`, como Weriton-DataOps.
  - PR com as provas.
  - CI verde lido, depois `gh pr merge --merge --match-head-commit`.

- [ ] **Passo 6: instalar e conferir.**
  - Rodar `plugin marketplace update omni-hub` e `plugin update omni@omni-hub --scope user`.
  - Conferir a integridade da raiz instalada, que tem de vir `verified` em 0.32.0, com `executor/agente.json` presente.
  - Rodar `executor.mjs verificar` na casa real: só leitura e nunca cria banco.
  - Não rodar `instalar` na casa real: a instalação real é do plano 6.
