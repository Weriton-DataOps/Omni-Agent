# F2, plano 3: a API do Omni — plano de implementação

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** criar o `node runtime/servir.mjs --porta <n>`. Ele serve a API local do Omni (`/v1/saude` e a campainha `/v1/despachos`) e supervisiona o `servir` dos agentes instalados nesta máquina.

**Arquitetura:**
- Quatro peças, cada uma num arquivo:
  - a loja dos despachos (SQL puro sobre o `omni.db`, migração v5);
  - a API HTTP (`node:http`, só 127.0.0.1, token em toda rota);
  - o supervisor (`child_process.spawn`, lê a 1ª linha, backoff, recusa permanente);
  - a entrada `runtime/servir.mjs`, que liga as três e obedece ao contrato de 05/11.
- A API abre e fecha o banco a cada pedido: ela não segura o `omni.db`, e os hooks continuam escrevendo nele direto.

**Tecnologia:** Node ≥ 24 (`node:sqlite`, `node:http`, `node:test`, `node:child_process`). Nenhuma dependência nova.

**Desenho:**
- [Casa única](../specs/2026-11-04-casa-unica-tres-agentes-design.md), §3.5 regra 3 e §4.2;
- [plano mestre da F2](2026-11-09-f2-casa-instalavel.md), linha 3;
- contratos de 05/11 com o Oráculo e o Overcore.

**Ramo:** `casa-f2-p3`, no worktree `Omni-casa-f1`, criado de `origin/main` `142d7f6` (release 0.27.1).

---

## O contrato que este plano cumpre (05/11)

**`servir --porta 0`:**
- escuta só em 127.0.0.1, com token em toda rota;
- a 1ª linha do stdout é `{"ok":true,"porta":n}` e só sai depois de escutar; o log vai para o stderr;
- stdin fechado encerra o processo.

**Recusas na subida:**
- saída 2 (uso) é permanente;
- saída 1 com `{"ok":false,"erro":…,"recusa":true}` também é permanente;
- só uma falha sem `recusa` entra em backoff.

**Leitura da 1ª linha:** `JSON.parse` e campos por nome (`ok`, `porta`, `erro`, `recusa`); campo a mais é tolerado.

**Chamadas à API:**
- o cliente chama `http://127.0.0.1:<porta>`; `localhost` recebe 421;
- o token é comparado com `timingSafeEqual`;
- corpo acima de 64 KB recebe 413; o 500 sai sem pilha;
- `GET /v1/saude` sem token recebe 401.

**Campainha:**
- o Omni expõe `POST /v1/despachos {agente, execucao}`, que responde 202 e é idempotente pelo id;
- a fila do agente é a verdade: o recibo do Omni é só o aviso de que há trabalho lá.

**Ambiente do agente:**
- o supervisor passa `OMNI_API=http://127.0.0.1:<porta>/v1` e `OMNI_API_TOKEN` por env;
- passa `--actions` e `--oracle` só quando o caminho não é o padrão (neste plano, nunca); `--logs`, jamais.

**Lido no Oráculo** (`f3/lote-d` `d3d4050`, só leitura):
- o `servir` dele exige `OMNI_API` e `OMNI_API_TOKEN` juntos;
- a campainha dele manda `{agente:'oraculo', execucao}`, onde `execucao` tem o formato `\d{8}-\d{6}-[0-9a-f]{4}`;
- sem os hashes `tela` e `visita` instalados, ele recusa com `recusa:true`.

## Fora deste plano (vai para o plano 4, já anotado no plano mestre)

**Plano 4:**
- o provedor de tokens `tela` e `visita` por agente, a partir do `cofre.db`;
- o `chamar(agente, metodo, rota, corpo)` do supervisor para o IPC `agente:api`;
- o carteiro: ler os despachos `recebido`, `GET` na fila do agente, `assumir` e entregar à sessão.

**Plano 5:** gerar os tokens e instalar os hashes nos agentes (`instalar --tela/--visita`) é trabalho do executor.

**Memória pela API (§3.5 regra 3):** fica para depois da F2. Os hooks precisam funcionar com a API fora do ar, então continuam abrindo o `omni.db` direto (o `BEGIN IMMEDIATE` já serializa a escrita).

## Mapa de arquivos

| Arquivo | Papel |
|---|---|
| `runtime/casa/esquemas.mjs` (mudar) | migração v5 do `omni.db`: tabela `despachos` |
| `runtime/casa/loja-despachos.mjs` (novo) | validar, registrar (idempotente) e listar despachos |
| `runtime/casa/loja-nucleo.mjs` (mudar) | `listarServidores`: instalados nesta máquina com modo `servir` |
| `runtime/casa/api-omni.mjs` (novo) | o servidor HTTP: host, token, corpo, rotas |
| `runtime/casa/supervisor.mjs` (novo) | sobe, vigia e para o `servir` de cada agente |
| `runtime/servir.mjs` (novo) | a entrada: uso, token, porta, 1ª linha, stdin |
| `testes/fixtures/agente-falso.mjs` (novo) | agente de mentira, modo por `AGENTE_FALSO_MODO` |
| `testes/fixtures/chamar-api.mjs` (novo) | `chamar` (HTTP com host e token) e `ate` (espera condição) |
| `testes/casa-loja-despachos.test.mjs` (novo) | loja e CHECK da v5 |
| `testes/casa-api-omni.test.mjs` (novo) | API em processo |
| `testes/casa-supervisor.test.mjs` (novo) | supervisor com processos reais do agente falso |
| `testes/casa-servir.test.mjs` (novo) | a entrada como processo, ponta a ponta com a campainha |
| `testes/casa-banco.test.mjs` (mudar) | a lista de tabelas e a de versões ganham a v5 |
| `testes/casa-loja-nucleo.test.mjs` (mudar) | teste do `listarServidores` |
| `package.json` (mudar) | `node --check` dos quatro módulos novos |

Os arquivos novos aparecem inteiros abaixo, cada um depois de uma linha **Arquivo completo `caminho`**. Na execução, extrair o bloco para o caminho, sem redigitar.

---

### Tarefa 1: migração v5 e a loja dos despachos

**Arquivos:** `runtime/casa/esquemas.mjs`, `runtime/casa/loja-despachos.mjs`, `testes/casa-loja-despachos.test.mjs` e `testes/casa-banco.test.mjs`.

- [ ] **Passo 1: escrever o teste que falha.**

**Arquivo completo `testes/casa-loja-despachos.test.mjs`**

```js
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { comBancoDaCasa } from '../runtime/casa/banco.mjs'
import { DespachoError, listarDespachos, registrarDespacho, validarDespacho } from '../runtime/casa/loja-despachos.mjs'

const EXECUCAO = '20261109-120000-abcd'

function comOmni(uso) {
  const casa = mkdtempSync(join(tmpdir(), 'omni-despachos-'))
  try {
    return comBancoDaCasa(casa, 'omni', uso)
  } finally {
    try { rmSync(casa, { recursive: true, force: true }) } catch { /* sobra temporária */ }
  }
}

test('o mesmo toque duas vezes vira um recibo só', () => {
  comOmni((db) => {
    const opcoes = { maquina: 'pc', agora: '2026-11-09T12:00:00.000Z' }
    assert.deepEqual(registrarDespacho(db, { agente: 'oraculo', execucao: EXECUCAO }, opcoes), { id: `oraculo/${EXECUCAO}`, novo: true })
    assert.deepEqual(registrarDespacho(db, { agente: 'oraculo', execucao: EXECUCAO, extra: 1 }, opcoes), { id: `oraculo/${EXECUCAO}`, novo: false })
    const lista = listarDespachos(db)
    assert.equal(lista.length, 1)
    assert.deepEqual(lista[0], {
      id: `oraculo/${EXECUCAO}`, agente: 'oraculo', execucao: EXECUCAO, estado: 'recebido', tentativas: 0, detalhe: null,
      recebido_em: '2026-11-09T12:00:00.000Z', atualizado_em: '2026-11-09T12:00:00.000Z'
    })
  })
})

test('agente e execucao fora do formato são recusados sem gravar', () => {
  const ruins = [
    null, [], 'texto', {},
    { agente: 'Oraculo', execucao: EXECUCAO },
    { agente: 'oraculo' },
    { agente: 'oraculo', execucao: 'a/b' },
    { agente: 'oraculo', execucao: '-comeca-com-hifen' },
    { agente: 'oraculo', execucao: 'x'.repeat(129) },
    { agente: 'a'.repeat(41), execucao: EXECUCAO },
    { agente: 'oraculo', execucao: 12 }
  ]
  for (const corpo of ruins) assert.throws(() => validarDespacho(corpo), DespachoError, JSON.stringify(corpo))
  comOmni((db) => {
    for (const corpo of ruins) assert.throws(() => registrarDespacho(db, corpo), DespachoError)
    assert.equal(db.prepare('SELECT count(*) AS n FROM despachos').get().n, 0)
  })
})

test('listar filtra por estado, recusa estado desconhecido e respeita o teto', () => {
  comOmni((db) => {
    for (const n of [1, 2, 3]) registrarDespacho(db, { agente: 'oraculo', execucao: `e${n}` }, { maquina: 'pc', agora: `2026-11-09T12:00:0${n}.000Z` })
    assert.deepEqual(listarDespachos(db, { limite: 2 }).map((d) => d.execucao), ['e1', 'e2'])
    assert.deepEqual(listarDespachos(db, { estado: 'assumido' }), [])
    assert.throws(() => listarDespachos(db, { estado: 'qualquer' }), DespachoError)
  })
})

test('o banco recusa id que não bate com agente e execução', () => {
  comOmni((db) => {
    assert.throws(() => db.prepare(`INSERT INTO despachos (id, agente, execucao, recebido_em, atualizado_em, origem_maquina)
      VALUES ('outro/x', 'oraculo', 'x', 't', 't', 'pc')`).run(), /CHECK/)
  })
})
```

- [ ] **Passo 2: rodar e ver o vermelho.**

Rodar `node --test testes/casa-loja-despachos.test.mjs`. Esperado: falha ao importar `../runtime/casa/loja-despachos.mjs` (`ERR_MODULE_NOT_FOUND`).

- [ ] **Passo 3: acrescentar a v5 no fim de `MIGRACOES_OMNI` em `runtime/casa/esquemas.mjs`.**

O código entra logo depois do fechamento `}` da v4, antes do `]`:

```js
  },
  // v5 (plano 3 da F2): a campainha dos agentes. Cada POST /v1/despachos vira um recibo; o id é
  // agente/execucao, então o mesmo toque repetido não duplica. A fila do agente é a verdade: isto é só
  // o aviso de que há trabalho lá. Dado operacional desta máquina, sem diário de sincronização.
  {
    versao: 5,
    nome: 'despachos da campainha',
    sql: `CREATE TABLE despachos (
  id TEXT PRIMARY KEY,
  agente TEXT NOT NULL CHECK (${slug('agente')}),
  execucao TEXT NOT NULL CHECK (length(execucao) BETWEEN 1 AND 128 AND execucao NOT GLOB '*[^A-Za-z0-9._:-]*'),
  estado TEXT NOT NULL DEFAULT 'recebido' CHECK (estado IN ('recebido', 'assumido', 'recusado', 'falhou')),
  tentativas INTEGER NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  detalhe TEXT CHECK (detalhe IS NULL OR length(detalhe) <= 300),
  recebido_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  origem_maquina TEXT NOT NULL CHECK (${maquinaValida('origem_maquina')}),
  CHECK (id = agente || '/' || execucao)
);
CREATE INDEX despachos_recebidos ON despachos (recebido_em) WHERE estado = 'recebido';`
  }
```

`slug` e `maquinaValida` estão nas linhas 57 e 59, antes do `MIGRACOES_OMNI`, na linha 100.

- [ ] **Passo 4: criar a loja.**

**Arquivo completo `runtime/casa/loja-despachos.mjs`**

```js
// Campainha dos agentes (contrato de 05/11): o agente avisa que há execução nova na fila dele com
// POST /v1/despachos {agente, execucao}. A fila do agente é a verdade; aqui fica só o recibo,
// idempotente pelo id agente/execucao. Quem entrega a execução a uma sessão (o carteiro) é do plano 4.
import { agoraIso, maquinaAtual } from './banco.mjs'

export const AGENTE = /^[a-z][a-z0-9-]{0,39}$/
export const EXECUCAO = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
export const ESTADOS = Object.freeze(['recebido', 'assumido', 'recusado', 'falhou'])
export const LIMITE_LISTA = 100

export class DespachoError extends Error {
  constructor(mensagem) {
    super(mensagem)
    this.name = 'DespachoError'
    this.code = 'dados-invalidos'
  }
}

const objeto = (valor) => valor !== null && typeof valor === 'object' && !Array.isArray(valor)

export function validarDespacho(corpo) {
  if (!objeto(corpo)) throw new DespachoError('O corpo precisa ser um objeto JSON.')
  const { agente, execucao } = corpo
  if (typeof agente !== 'string' || !AGENTE.test(agente)) {
    throw new DespachoError('agente: minúsculas, dígitos e hífen, começando por letra, até 40.')
  }
  if (typeof execucao !== 'string' || !EXECUCAO.test(execucao)) {
    throw new DespachoError('execucao: até 128 caracteres entre letras, dígitos, ponto, dois-pontos, sublinhado e hífen.')
  }
  return { agente, execucao, id: `${agente}/${execucao}` }
}

export function registrarDespacho(db, corpo, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  const { agente, execucao, id } = validarDespacho(corpo)
  const r = db.prepare(`INSERT INTO despachos (id, agente, execucao, recebido_em, atualizado_em, origem_maquina)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`).run(id, agente, execucao, agora, agora, maquina)
  return { id, novo: Number(r.changes) === 1 }
}

export function listarDespachos(db, { estado = 'recebido', limite = LIMITE_LISTA } = {}) {
  if (!ESTADOS.includes(estado)) throw new DespachoError(`estado: ${ESTADOS.join(', ')}.`)
  const n = Number.isInteger(limite) ? Math.min(Math.max(limite, 1), LIMITE_LISTA) : LIMITE_LISTA
  return db.prepare(`SELECT id, agente, execucao, estado, tentativas, detalhe, recebido_em, atualizado_em
    FROM despachos WHERE estado = ? ORDER BY recebido_em, id LIMIT ?`).all(estado, n).map((linha) => ({ ...linha }))
}
```

- [ ] **Passo 5: atualizar `testes/casa-banco.test.mjs`.**
  - Na lista `omni` das tabelas (linha 282), entra `'despachos'` entre `'aprendizado_eventos'` e `'documentos'`.
  - As duas asserções `[1, 2, 3, 4]` (linhas 365 e 384) viram `[1, 2, 3, 4, 5]`.

- [ ] **Passo 6: rodar e ver o verde.**

Rodar `node --test testes/casa-loja-despachos.test.mjs testes/casa-banco.test.mjs`. Esperado: 4 testes novos passando e todo o `casa-banco` verde.

- [ ] **Passo 7: mutante.**

Trocar `ON CONFLICT (id) DO NOTHING` por nada.

Esperado: o 1º teste fica vermelho, com `UNIQUE constraint failed` lançado pela segunda chamada. Isso não é a asserção `novo: false`, mas o teste prova que o duplicado não grava. Para ver a asserção, mudar `Number(r.changes) === 1` para `true`: o `deepEqual` do segundo recibo fica vermelho.

Desfazer o mutante e rodar de novo, verde.

- [ ] **Passo 8: commit.**

```powershell
git add runtime/casa/esquemas.mjs runtime/casa/loja-despachos.mjs testes/casa-loja-despachos.test.mjs testes/casa-banco.test.mjs
$em = git log -1 --format=%ae origin/main
git -c user.name=Weriton-DataOps -c user.email=$em commit -m "feat(casa): despachos da campainha na v5 do omni.db"
```

---

### Tarefa 2: `listarServidores` na loja do núcleo

**Arquivos:** `runtime/casa/loja-nucleo.mjs` e `testes/casa-loja-nucleo.test.mjs`.

- [ ] **Passo 1: teste que falha.**

Acrescentar `listarServidores` ao import da loja e este teste no fim de `testes/casa-loja-nucleo.test.mjs`:

```js
test('listarServidores entrega quem tem o modo servir nesta máquina, marca divergência e deixa o omni de fora', () => {
  comNucleo((db) => {
    const quieto = { ...minimo(), agente: 'quieto', executor: { comando: 'node q.mjs', modos: ['instalar'] } }
    const omni = { ...minimo(), agente: 'omni', executor: { comando: 'node runtime/servir.mjs', modos: ['servir'] } }
    for (const manifesto of [completo(), quieto, omni]) registrarAgente(db, bytes(manifesto), { ...OPCOES, raiz: RAIZ })
    assert.deepEqual(listarServidores(db, { maquina: 'pc' }), [
      { agente: 'exemplo', raiz: RAIZ, comando: 'node executor/exemplo-executor.mjs', divergente: false }
    ])
    assert.deepEqual(listarServidores(db, { maquina: 'outra' }), [])
    // Outra máquina registra uma versão nova: o catálogo muda e a instalação daqui fica para trás.
    registrarAgente(db, bytes({ ...completo(), versao: '0.4.0' }), { ...OPCOES, maquina: 'outra', raiz: RAIZ, agora: 't1' })
    assert.deepEqual(listarServidores(db, { maquina: 'pc' }).map((s) => [s.agente, s.divergente]), [['exemplo', true]])
  })
})
```

- [ ] **Passo 2: ver o vermelho.**

Rodar `node --test --test-name-pattern=listarServidores testes/casa-loja-nucleo.test.mjs`. Esperado: `SyntaxError`, porque o export `listarServidores` não existe.

- [ ] **Passo 3: implementar no fim de `runtime/casa/loja-nucleo.mjs`.**

```js
// Quem o supervisor do Omni sobe nesta máquina: instalado aqui, com o modo servir no manifesto do
// catálogo. Instalação com manifesto diferente do catálogo sai marcada (divergente) e não sobe:
// o comando que o catálogo diz pode não ser o que está no disco. O Omni não supervisiona a si mesmo.
export function listarServidores(db, { maquina = maquinaAtual() } = {}) {
  return db.prepare(`SELECT i.agente, i.raiz, i.manifesto_sha256, a.manifesto, a.manifesto_sha256 AS sha_catalogo
    FROM instalacoes i JOIN agentes a ON a.id = i.agente AND a.apagado_em IS NULL
    WHERE i.maquina = ? AND i.apagado_em IS NULL AND i.agente <> 'omni' ORDER BY i.agente`).all(maquina).flatMap((l) => {
    const executor = JSON.parse(l.manifesto).executor
    if (!executor?.modos?.includes('servir')) return []
    return [{ agente: l.agente, raiz: l.raiz, comando: executor.comando, divergente: l.sha_catalogo !== l.manifesto_sha256 }]
  })
}
```

- [ ] **Passo 4: ver o verde do arquivo inteiro.**

Rodar `node --test testes/casa-loja-nucleo.test.mjs`. Esperado: todos passando.

- [ ] **Passo 5: mutante.**

Trocar `l.sha_catalogo !== l.manifesto_sha256` por `false`. Esperado: vermelho no último `deepEqual` (`['exemplo', false]`). Desfazer.

- [ ] **Passo 6: commit** com a mensagem `feat(casa): o núcleo diz quem o supervisor sobe`.

---

### Tarefa 3: a API do Omni

**Arquivos:** `runtime/casa/api-omni.mjs`, `testes/fixtures/chamar-api.mjs` e `testes/casa-api-omni.test.mjs`.

- [ ] **Passo 1: o auxiliar de teste.**

**Arquivo completo `testes/fixtures/chamar-api.mjs`**

```js
// Auxiliares dos testes da API: chamar com host e token explícitos (o cliente da casa sempre fala
// com 127.0.0.1) e esperar uma condição sem dormir um tempo fixo.
import assert from 'node:assert/strict'
import { request } from 'node:http'

export function chamar(porta, metodo, rota, { corpo, token, host = `127.0.0.1:${porta}` } = {}) {
  return new Promise((resolver, rejeitar) => {
    const dados = corpo === undefined ? undefined : Buffer.from(typeof corpo === 'string' ? corpo : JSON.stringify(corpo))
    const headers = { host, connection: 'close' }
    if (token) headers.authorization = `Bearer ${token}`
    if (dados) {
      headers['content-type'] = 'application/json'
      headers['content-length'] = dados.length
    }
    const req = request({ host: '127.0.0.1', port: porta, method: metodo, path: rota, headers, agent: false }, (res) => {
      const partes = []
      res.on('data', (parte) => partes.push(parte))
      res.on('end', () => {
        const texto = Buffer.concat(partes).toString('utf8')
        let json = null
        try { json = JSON.parse(texto) } catch { /* corpo não JSON fica em texto */ }
        resolver({ status: res.statusCode, corpo: json, texto, headers: res.headers })
      })
    })
    req.on('error', rejeitar)
    if (dados) req.write(dados)
    req.end()
  })
}

export async function ate(condicao, ms = 8_000) {
  const limite = Date.now() + ms
  while (Date.now() < limite) {
    if (await condicao()) return
    await new Promise((resolver) => setTimeout(resolver, 25))
  }
  assert.fail('a condição não chegou no prazo')
}
```

- [ ] **Passo 2: o teste que falha.**

**Arquivo completo `testes/casa-api-omni.test.mjs`**

```js
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { LIMITE_CORPO, criarApiOmni } from '../runtime/casa/api-omni.mjs'
import { chamar } from './fixtures/chamar-api.mjs'

const TOKEN = 'token-de-teste-123'
const EXECUCAO = '20261109-120000-abcd'

async function subir(t, { banco } = {}) {
  const casa = mkdtempSync(join(tmpdir(), 'omni-api-'))
  const env = { ...process.env, OMNI_CASA_BANCO: banco?.(casa) ?? join(casa, 'banco') }
  const servidor = criarApiOmni({
    casa, token: TOKEN, versao: '9.9.9', iniciadoEm: '2026-11-09T12:00:00.000Z', env,
    agentes: () => [{ agente: 'exemplo', estado: 'no-ar' }]
  })
  await new Promise((resolver) => servidor.listen(0, '127.0.0.1', resolver))
  t.after(async () => {
    servidor.closeAllConnections()
    await new Promise((resolver) => servidor.close(resolver))
    try { rmSync(casa, { recursive: true, force: true }) } catch { /* sobra temporária */ }
  })
  return servidor.address().port
}

test('saúde responde com token: agente, versão, início e o estado dos agentes', async (t) => {
  const porta = await subir(t)
  const r = await chamar(porta, 'GET', '/v1/saude', { token: TOKEN })
  assert.equal(r.status, 200)
  assert.equal(r.headers['cache-control'], 'no-store')
  assert.deepEqual(r.corpo, { ok: true, agente: 'omni', versao: '9.9.9', iniciado_em: '2026-11-09T12:00:00.000Z', agentes: [{ agente: 'exemplo', estado: 'no-ar' }] })
})

test('sem token, token errado ou de outro tamanho: 401', async (t) => {
  const porta = await subir(t)
  for (const token of [undefined, 'token-de-teste-124', 'x', `${TOKEN}${TOKEN}`]) {
    const r = await chamar(porta, 'GET', '/v1/saude', { token })
    assert.equal(r.status, 401, String(token))
    assert.equal(r.corpo.ok, false)
  }
})

test('localhost recebe 421 mesmo com o token certo', async (t) => {
  const porta = await subir(t)
  const r = await chamar(porta, 'GET', '/v1/saude', { token: TOKEN, host: `localhost:${porta}` })
  assert.equal(r.status, 421)
})

test('a campainha é idempotente: 202 novo, 202 repetido e um recibo só', async (t) => {
  const porta = await subir(t)
  const corpo = { agente: 'oraculo', execucao: EXECUCAO }
  const primeiro = await chamar(porta, 'POST', '/v1/despachos', { token: TOKEN, corpo })
  assert.equal(primeiro.status, 202)
  assert.deepEqual(primeiro.corpo, { ok: true, id: `oraculo/${EXECUCAO}`, novo: true })
  const repetido = await chamar(porta, 'POST', '/v1/despachos', { token: TOKEN, corpo })
  assert.equal(repetido.status, 202)
  assert.equal(repetido.corpo.novo, false)
  const lista = await chamar(porta, 'GET', '/v1/despachos?estado=recebido', { token: TOKEN })
  assert.equal(lista.status, 200)
  assert.deepEqual(lista.corpo.despachos.map((d) => d.id), [`oraculo/${EXECUCAO}`])
})

test('corpo inválido recebe 400 e não grava', async (t) => {
  const porta = await subir(t)
  for (const corpo of ['{', '[]', JSON.stringify({ agente: 'oraculo' }), JSON.stringify({ agente: 'oraculo', execucao: 'a/b' })]) {
    const r = await chamar(porta, 'POST', '/v1/despachos', { token: TOKEN, corpo })
    assert.equal(r.status, 400, corpo)
  }
  assert.equal((await chamar(porta, 'GET', '/v1/despachos?estado=bobagem', { token: TOKEN })).status, 400)
  assert.deepEqual((await chamar(porta, 'GET', '/v1/despachos', { token: TOKEN })).corpo.despachos, [])
})

test('corpo acima de 64 KB recebe 413', async (t) => {
  const porta = await subir(t)
  const corpo = JSON.stringify({ agente: 'oraculo', execucao: EXECUCAO, enchimento: 'x'.repeat(LIMITE_CORPO) })
  const r = await chamar(porta, 'POST', '/v1/despachos', { token: TOKEN, corpo })
  assert.equal(r.status, 413)
  assert.deepEqual((await chamar(porta, 'GET', '/v1/despachos', { token: TOKEN })).corpo.despachos, [])
})

test('rota desconhecida recebe 404 e método errado 405 com Allow', async (t) => {
  const porta = await subir(t)
  assert.equal((await chamar(porta, 'GET', '/v1/nada', { token: TOKEN })).status, 404)
  const r = await chamar(porta, 'DELETE', '/v1/saude', { token: TOKEN })
  assert.equal(r.status, 405)
  assert.equal(r.headers.allow, 'GET')
  assert.equal((await chamar(porta, 'PUT', '/v1/despachos', { token: TOKEN })).headers.allow, 'GET, POST')
})

test('banco fora do ar vira 500 sem pilha e sem caminho', async (t) => {
  // A pasta do banco aponta para um arquivo: abrir o omni.db falha de verdade.
  const porta = await subir(t, { banco: (casa) => { const arquivo = join(casa, 'nao-e-pasta'); writeFileSync(arquivo, 'x'); return arquivo } })
  const r = await chamar(porta, 'POST', '/v1/despachos', { token: TOKEN, corpo: { agente: 'oraculo', execucao: EXECUCAO } })
  assert.equal(r.status, 500)
  assert.deepEqual(r.corpo, { ok: false, erro: 'falha interna' })
})

test('criar a API com token fora do formato é recusado', () => {
  for (const token of [undefined, '', 'com espaço', 'x'.repeat(513)]) {
    assert.throws(() => criarApiOmni({ casa: tmpdir(), token, versao: null }), TypeError, String(token))
  }
})
```

- [ ] **Passo 3: ver o vermelho.**

Rodar `node --test testes/casa-api-omni.test.mjs`. Esperado: `ERR_MODULE_NOT_FOUND` em `api-omni.mjs`.

- [ ] **Passo 4: implementar.**

**Arquivo completo `runtime/casa/api-omni.mjs`**

```js
// API local do Omni (§3.5 regra 3; contratos de 05/11). Só 127.0.0.1 e token em toda rota: o Host
// precisa ser exatamente 127.0.0.1:<porta> (localhost recebe 421, o que fecha a porta a DNS rebinding),
// e o token é comparado pelo sha256 com timingSafeEqual (mesmo tamanho sempre, sem vazar comprimento).
// Cada pedido abre o omni.db, trabalha e fecha: a API não segura o banco, e os hooks seguem escrevendo
// nele direto. Erro inesperado vira 500 sem pilha; o detalhe vai para degradacoes.jsonl.
import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'

import { agoraIso, comBancoDaCasa, registrarDegradacao } from './banco.mjs'
import { DespachoError, listarDespachos, registrarDespacho } from './loja-despachos.mjs'

export const LIMITE_CORPO = 64 * 1024
export const TOKEN = /^[\x21-\x7e]{1,512}$/

class CorpoGrande extends Error {}
class JsonInvalido extends Error {}

const resumo = (texto) => createHash('sha256').update(texto, 'utf8').digest()

function responder(res, status, corpo, extras = {}) {
  if (res.headersSent) return
  const texto = JSON.stringify(corpo)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(texto),
    ...extras
  })
  res.end(texto)
}

// Lê o corpo inteiro, mas guarda só até o limite: o resto é drenado e descartado, para a resposta
// 413 chegar inteira ao cliente (fechar com dado não lido vira RST no Windows e o cliente perde o 413).
function lerCorpo(req) {
  return new Promise((resolver, rejeitar) => {
    const partes = []
    let total = 0
    req.on('data', (parte) => {
      total += parte.length
      if (total <= LIMITE_CORPO) partes.push(parte)
    })
    req.on('end', () => {
      if (total > LIMITE_CORPO) { rejeitar(new CorpoGrande()); return }
      try {
        resolver(JSON.parse(Buffer.concat(partes).toString('utf8')))
      } catch {
        rejeitar(new JsonInvalido())
      }
    })
    req.on('error', rejeitar)
  })
}

export function criarApiOmni({ casa, token, versao, agentes = () => [], env = process.env, iniciadoEm = agoraIso() }) {
  if (typeof token !== 'string' || !TOKEN.test(token)) throw new TypeError('Token da API fora do formato.')
  const esperado = resumo(token)

  const servidor = createServer((req, res) => {
    atender(req, res).catch((erro) => {
      registrarDegradacao(casa, 'api.omni', erro, env)
      responder(res, 500, { ok: false, erro: 'falha interna' }, { connection: 'close' })
    })
  })
  servidor.headersTimeout = 5_000
  servidor.requestTimeout = 10_000

  function autorizado(cabecalho) {
    const achado = /^Bearer (\S+)$/.exec(cabecalho ?? '')
    return achado !== null && timingSafeEqual(resumo(achado[1] ?? ''), esperado)
  }

  function noBanco(uso) {
    return comBancoDaCasa(casa, 'omni', uso, env)
  }

  async function despachos(req, res, url) {
    if (req.method === 'GET') {
      const limite = url.searchParams.has('limite') ? Number(url.searchParams.get('limite')) : undefined
      const estado = url.searchParams.get('estado') ?? 'recebido'
      const lista = noBanco((db) => listarDespachos(db, limite === undefined ? { estado } : { estado, limite }))
      return responder(res, 200, { ok: true, despachos: lista })
    }
    if (req.method !== 'POST') return responder(res, 405, { ok: false, erro: 'Método não aceito.' }, { allow: 'GET, POST' })
    let corpo
    try {
      corpo = await lerCorpo(req)
    } catch (erro) {
      if (erro instanceof CorpoGrande) return responder(res, 413, { ok: false, erro: `Corpo acima de ${LIMITE_CORPO} bytes.` }, { connection: 'close' })
      if (erro instanceof JsonInvalido) return responder(res, 400, { ok: false, erro: 'O corpo não é JSON válido.' })
      throw erro
    }
    const recibo = noBanco((db) => registrarDespacho(db, corpo))
    return responder(res, 202, { ok: true, ...recibo })
  }

  async function atender(req, res) {
    const porta = servidor.address()?.port
    if (req.headers.host !== `127.0.0.1:${porta}`) {
      return responder(res, 421, { ok: false, erro: 'Use http://127.0.0.1:<porta>.' }, { connection: 'close' })
    }
    if (!autorizado(req.headers.authorization)) {
      return responder(res, 401, { ok: false, erro: 'Token ausente ou inválido.' }, { connection: 'close' })
    }
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${porta}`)
    try {
      if (url.pathname === '/v1/saude') {
        if (req.method !== 'GET') return responder(res, 405, { ok: false, erro: 'Método não aceito.' }, { allow: 'GET' })
        return responder(res, 200, { ok: true, agente: 'omni', versao, iniciado_em: iniciadoEm, agentes: agentes() })
      }
      if (url.pathname === '/v1/despachos') return await despachos(req, res, url)
    } catch (erro) {
      if (erro instanceof DespachoError) return responder(res, 400, { ok: false, erro: erro.message })
      throw erro
    }
    return responder(res, 404, { ok: false, erro: 'Rota desconhecida.' })
  }

  return servidor
}
```

- [ ] **Passo 5: ver o verde.**

Rodar `node --test testes/casa-api-omni.test.mjs`. Esperado: 9 de 9 passando.

- [ ] **Passo 6: mutantes**, um por vez, cada um desfeito depois:
  - `req.headers.host !== …` vira `false`: vermelho no teste do 421;
  - `timingSafeEqual(…)` vira `true`: vermelho no teste do 401;
  - `total > LIMITE_CORPO` vira `false` no `end`: vermelho no teste do 413.

- [ ] **Passo 7: commit** com a mensagem `feat(casa): API local do Omni com saúde e campainha`.

---

### Tarefa 4: o supervisor

**Arquivos:** `runtime/casa/supervisor.mjs`, `testes/fixtures/agente-falso.mjs` e `testes/casa-supervisor.test.mjs`.

- [ ] **Passo 1: o agente falso.**

**Arquivo completo `testes/fixtures/agente-falso.mjs`**

```js
// Agente de mentira para os testes do supervisor e do servir. O comportamento vem de AGENTE_FALSO_MODO:
//   no-ar (padrão) escuta de verdade, anuncia a porta e só sai quando o stdin fecha;
//   uso sai 2; recusa anuncia {"recusa":true} e sai 1; cai sai 1 sem anunciar; mudo nunca anuncia.
// AGENTE_FALSO_REGISTRO recebe uma linha por subida (argumentos, OMNI_API, se veio token e a pasta).
// AGENTE_FALSO_CAMPAINHA: antes de anunciar, toca POST {OMNI_API}/despachos com essa execução.
import { appendFileSync } from 'node:fs'
import { createServer } from 'node:http'

const modo = process.env.AGENTE_FALSO_MODO ?? 'no-ar'
const registro = process.env.AGENTE_FALSO_REGISTRO
if (registro) {
  appendFileSync(registro, `${JSON.stringify({ argv: process.argv.slice(2), api: process.env.OMNI_API ?? null, token: Boolean(process.env.OMNI_API_TOKEN), cwd: process.cwd() })}\n`)
}
const anunciar = (linha) => process.stdout.write(`${JSON.stringify(linha)}\n`)

if (process.argv.slice(2).join(' ') !== 'servir --porta 0' || modo === 'uso') {
  process.stderr.write('uso: agente-falso servir --porta 0\n')
  process.exit(2)
} else if (modo === 'recusa') {
  anunciar({ ok: false, erro: 'sem credencial da api', recusa: true })
  process.exit(1)
} else if (modo === 'cai') {
  process.stderr.write('caiu de propósito\n')
  process.exit(1)
} else if (modo === 'mudo') {
  process.stdin.resume()
  process.stdin.on('end', () => process.exit(0))
  setInterval(() => {}, 1_000)
} else {
  const servidor = createServer((_req, res) => res.end('{}'))
  servidor.listen(0, '127.0.0.1', async () => {
    const execucao = process.env.AGENTE_FALSO_CAMPAINHA
    if (execucao) {
      const resposta = await fetch(`${process.env.OMNI_API}/despachos`, {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.OMNI_API_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ agente: 'falso', execucao })
      })
      process.stderr.write(`campainha ${resposta.status}\n`)
    }
    anunciar({ ok: true, porta: servidor.address().port, extra: 'campo a mais é tolerado' })
  })
  process.stdin.resume()
  process.stdin.on('end', () => {
    servidor.close()
    process.exit(0)
  })
}
```

- [ ] **Passo 2: o teste que falha.**

**Arquivo completo `testes/casa-supervisor.test.mjs`**

```js
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { criarSupervisor, esperaDoBackoff, partirComando } from '../runtime/casa/supervisor.mjs'
import { ate } from './fixtures/chamar-api.mjs'

const RAIZ = resolve(import.meta.dirname, '..')
const FALSO = 'node testes/fixtures/agente-falso.mjs'
const API = { url: 'http://127.0.0.1:9/v1', token: 'token-de-teste' }
const daquiA = (ms) => new Promise((resolver) => setTimeout(resolver, ms))

function preparar(t, modo, { agente = {}, opcoes = {} } = {}) {
  const pasta = mkdtempSync(join(tmpdir(), 'omni-supervisor-'))
  const registro = join(pasta, 'registro.jsonl')
  const logs = []
  const supervisor = criarSupervisor({
    agentes: [{ agente: 'falso', raiz: RAIZ, comando: FALSO, divergente: false, ...agente }],
    omniApi: API,
    env: { ...process.env, AGENTE_FALSO_MODO: modo, AGENTE_FALSO_REGISTRO: registro },
    log: (linha) => logs.push(linha),
    baseMs: 40, tetoMs: 160, subidaMs: 5_000, paradaMs: 3_000,
    ...opcoes
  })
  t.after(async () => {
    await supervisor.parar()
    try { rmSync(pasta, { recursive: true, force: true }) } catch { /* sobra temporária */ }
  })
  const subidas = () => (existsSync(registro) ? readFileSync(registro, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
  return { supervisor, subidas, logs, unico: () => supervisor.estado()[0] }
}

test('backoff dobra até o teto e o comando troca node pelo executável atual', () => {
  assert.deepEqual([1, 2, 3, 4, 9].map((n) => esperaDoBackoff(n, 40, 160)), [40, 80, 160, 160, 160])
  assert.deepEqual(partirComando('node executor/a.mjs', 'NODE'), { programa: 'NODE', argumentos: ['executor/a.mjs'] })
  assert.deepEqual(partirComando('  python   vigia.py ', 'NODE'), { programa: 'python', argumentos: ['vigia.py'] })
  assert.throws(() => partirComando('   '), TypeError)
})

test('sobe, lê a porta da 1ª linha, passa a API por env e para quando pedem', async (t) => {
  const { supervisor, subidas, unico } = preparar(t, 'no-ar')
  supervisor.iniciar()
  await ate(() => unico().estado === 'no-ar')
  const no = unico()
  assert.ok(Number.isInteger(no.porta) && no.porta > 0)
  assert.ok(Number.isInteger(no.pid))
  const [subida] = subidas()
  assert.deepEqual(subida.argv, ['servir', '--porta', '0'])
  assert.equal(subida.api, API.url)
  assert.equal(subida.token, true)
  assert.equal(resolve(subida.cwd).toLowerCase(), RAIZ.toLowerCase())
  await supervisor.parar()
  assert.equal(unico().estado, 'parado')
  assert.equal(unico().pid, null)
})

test('saída 2 é recusa permanente: uma subida só', async (t) => {
  const { supervisor, subidas, unico } = preparar(t, 'uso')
  supervisor.iniciar()
  await ate(() => unico().estado === 'recusado')
  assert.match(unico().erro, /saída 2/)
  await daquiA(400)
  assert.equal(subidas().length, 1)
})

test('recusa:true na 1ª linha é permanente e traz o erro do agente', async (t) => {
  const { supervisor, subidas, unico } = preparar(t, 'recusa')
  supervisor.iniciar()
  await ate(() => unico().estado === 'recusado')
  assert.equal(unico().erro, 'sem credencial da api')
  await daquiA(400)
  assert.equal(subidas().length, 1)
})

test('queda volta com espera dobrada, e parar corta o ciclo', async (t) => {
  const { supervisor, subidas, logs, unico } = preparar(t, 'cai')
  supervisor.iniciar()
  await ate(() => subidas().length >= 3)
  assert.ok(unico().falhas >= 2)
  assert.ok(logs.some((l) => /nova tentativa em 80 ms/.test(l)), logs.join('\n'))
  assert.ok(logs.some((l) => /caiu de propósito/.test(l)), 'o stderr do agente vai para o log')
  await supervisor.parar()
  const depois = subidas().length
  await daquiA(400)
  assert.equal(subidas().length, depois)
  assert.equal(unico().estado, 'parado')
})

test('sem a 1ª linha no prazo, mata e tenta de novo', async (t) => {
  const { supervisor, subidas, logs } = preparar(t, 'mudo', { opcoes: { subidaMs: 300 } })
  supervisor.iniciar()
  await ate(() => subidas().length >= 2)
  assert.ok(logs.some((l) => /sem a 1ª linha no prazo/.test(l)), logs.join('\n'))
})

test('manifesto divergente não sobe', async (t) => {
  const { supervisor, subidas, unico } = preparar(t, 'no-ar', { agente: { divergente: true } })
  supervisor.iniciar()
  await daquiA(300)
  assert.equal(unico().estado, 'manifesto-divergente')
  assert.equal(subidas().length, 0)
})

test('comando que não existe é recusa permanente', async (t) => {
  const { supervisor, unico } = preparar(t, 'no-ar', { agente: { comando: 'programa-que-nao-existe-omni x.mjs' } })
  supervisor.iniciar()
  await ate(() => unico().estado === 'recusado')
  assert.match(unico().erro, /não encontrado/)
})
```

- [ ] **Passo 3: ver o vermelho.**

Rodar `node --test testes/casa-supervisor.test.mjs`. Esperado: `ERR_MODULE_NOT_FOUND` em `supervisor.mjs`.

- [ ] **Passo 4: implementar.**

**Arquivo completo `runtime/casa/supervisor.mjs`**

```js
// Supervisor do `servir` dos agentes (contratos de 05/11). Para cada agente que o núcleo diz instalado
// aqui com o modo servir, sobe `<executor.comando> servir --porta 0` na raiz dele, com OMNI_API e
// OMNI_API_TOKEN no ambiente, lê a 1ª linha do stdout e mantém o processo de pé:
// - {"ok":true,"porta":n} põe no ar; campo a mais é tolerado;
// - saída 2 (uso), {"recusa":true} ou comando inexistente é recusa permanente: tentar de novo não
//   conserta configuração, e a ilha mostra o erro;
// - qualquer outra queda volta com espera dobrada até o teto; quem ficou de pé o bastante zera a conta;
// - parar fecha o stdin (o pedido de parada do contrato) e só mata quem passar do prazo.
import { spawn } from 'node:child_process'

export const ESTADOS = Object.freeze(['subindo', 'no-ar', 'esperando', 'recusado', 'manifesto-divergente', 'parando', 'parado'])
const LIMITE_LINHA = 4096
const LIMITE_ERRO = 300

export function esperaDoBackoff(falhas, baseMs, tetoMs) {
  return Math.min(baseMs * 2 ** Math.max(falhas - 1, 0), tetoMs)
}

// O comando do manifesto é "programa arg1 arg2", sem aspas (caminho com espaço não cabe aqui).
// "node" vira o executável que roda o Omni: a mesma versão, sem depender do PATH.
export function partirComando(comando, execPath = process.execPath) {
  const partes = String(comando ?? '').trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) throw new TypeError('Comando vazio.')
  return { programa: partes[0] === 'node' ? execPath : partes[0], argumentos: partes.slice(1) }
}

const curto = (texto) => String(texto ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITE_ERRO)

export function criarSupervisor({
  agentes, omniApi, env = process.env, iniciar = spawn, log = () => {},
  baseMs = 1_000, tetoMs = 60_000, estavelMs = 60_000, subidaMs = 15_000, paradaMs = 5_000, relogio = Date.now
}) {
  const vigias = agentes.map((a) => ({
    agente: a.agente, raiz: a.raiz, comando: a.comando,
    estado: a.divergente ? 'manifesto-divergente' : 'parado',
    porta: null, pid: null, falhas: 0, erro: null, desde: null, filho: null, timer: null
  }))
  let parando = false

  function recusar(v, motivo) {
    v.estado = 'recusado'
    v.erro = curto(motivo)
    v.desde = relogio()
    log(`${v.agente}: recusado (${v.erro}); sem nova tentativa`)
  }

  function subir(v) {
    v.timer = null
    if (parando) return
    v.estado = 'subindo'
    v.porta = null
    v.desde = relogio()
    let comando
    try {
      comando = partirComando(v.comando)
    } catch {
      recusar(v, 'comando vazio no manifesto')
      return
    }
    let filho
    try {
      filho = iniciar(comando.programa, [...comando.argumentos, 'servir', '--porta', '0'], {
        cwd: v.raiz,
        env: { ...env, OMNI_API: omniApi.url, OMNI_API_TOKEN: omniApi.token },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })
    } catch (erro) {
      recusar(v, `não subiu: ${erro?.message ?? erro}`)
      return
    }
    v.filho = filho
    v.pid = filho.pid ?? null

    let leu = false
    let buffer = ''
    let recusa = null
    let motivo = null
    let encerrado = false
    const prazo = setTimeout(() => {
      if (leu) return
      motivo = 'sem a 1ª linha no prazo'
      filho.kill()
    }, subidaMs)

    filho.stdout.setEncoding('utf8')
    filho.stdout.on('data', (pedaco) => {
      if (leu) return
      buffer += pedaco
      const fim = buffer.indexOf('\n')
      if (fim < 0) {
        if (buffer.length > LIMITE_LINHA) {
          leu = true
          motivo = '1ª linha grande demais'
          filho.kill()
        }
        return
      }
      leu = true
      clearTimeout(prazo)
      let linha = null
      try {
        linha = JSON.parse(buffer.slice(0, fim))
      } catch {
        linha = null
      }
      buffer = ''
      if (linha?.ok === true && Number.isInteger(linha.porta) && linha.porta > 0 && linha.porta < 65536) {
        v.estado = 'no-ar'
        v.porta = linha.porta
        v.erro = null
        v.desde = relogio()
        log(`${v.agente}: no ar na porta ${linha.porta}`)
        return
      }
      if (linha?.recusa === true) recusa = typeof linha.erro === 'string' ? linha.erro : 'recusou a subida'
      else motivo = linha === null ? '1ª linha não é JSON' : curto(linha.erro ?? '1ª linha sem ok')
      filho.kill()
    })

    let resto = ''
    filho.stderr.setEncoding('utf8')
    filho.stderr.on('data', (pedaco) => {
      resto += pedaco
      const linhas = resto.split(/\r?\n/)
      resto = linhas.pop() ?? ''
      for (const linha of linhas) if (linha.trim()) log(`${v.agente}: ${curto(linha)}`)
    })
    filho.stdin.on('error', () => {})

    const encerrar = (codigo, erroDeSubida) => {
      if (encerrado) return
      encerrado = true
      clearTimeout(prazo)
      const estavaNoAr = v.estado === 'no-ar'
      v.filho = null
      v.pid = null
      v.porta = null
      if (parando) {
        v.estado = 'parado'
        return
      }
      if (erroDeSubida?.code === 'ENOENT') { recusar(v, 'comando do executor não encontrado'); return }
      if (recusa !== null) { recusar(v, recusa); return }
      if (codigo === 2) { recusar(v, 'saída 2: uso inválido do servir'); return }
      const ficouDePe = estavaNoAr && relogio() - (v.desde ?? 0) >= estavelMs
      v.falhas = ficouDePe ? 1 : v.falhas + 1
      v.erro = motivo ?? (erroDeSubida ? curto(erroDeSubida.message) : `saiu com código ${codigo}`)
      const espera = esperaDoBackoff(v.falhas, baseMs, tetoMs)
      v.estado = 'esperando'
      v.desde = relogio()
      log(`${v.agente}: caiu (${v.erro}); nova tentativa em ${espera} ms`)
      v.timer = setTimeout(() => subir(v), espera)
    }
    filho.on('error', (erro) => encerrar(null, erro))
    filho.on('close', (codigo) => encerrar(codigo, null))
  }

  return {
    iniciar() {
      for (const v of vigias) if (v.estado === 'parado') subir(v)
    },
    parar() {
      parando = true
      return Promise.all(vigias.map((v) => {
        if (v.timer) {
          clearTimeout(v.timer)
          v.timer = null
        }
        if (v.estado === 'esperando' || v.estado === 'subindo' || v.estado === 'no-ar') v.estado = 'parado'
        const filho = v.filho
        if (!filho) return undefined
        v.estado = 'parando'
        return new Promise((resolver) => {
          const prazo = setTimeout(() => filho.kill(), paradaMs)
          filho.once('close', () => {
            clearTimeout(prazo)
            resolver(undefined)
          })
          filho.stdin.end()
        })
      }))
    },
    estado() {
      return vigias.map((v) => ({
        agente: v.agente, estado: v.estado, porta: v.porta, pid: v.pid, falhas: v.falhas, erro: v.erro,
        desde: v.desde === null ? null : new Date(v.desde).toISOString()
      }))
    }
  }
}
```

- [ ] **Passo 5: ver o verde.**

Rodar `node --test testes/casa-supervisor.test.mjs`. Esperado: 8 de 8 passando.

- [ ] **Passo 6: mutantes**, um por vez, cada um desfeito depois:
  - `codigo === 2` vira `codigo === 3`: vermelho em "saída 2 é recusa permanente", que passa a mais de uma subida ou estoura o prazo;
  - `if (recusa !== null) {…}` sai do código: vermelho em "recusa:true";
  - `if (parando) return` sai do `subir`: vermelho em "parar corta o ciclo".

  Na execução, este último mutante **sobreviveu** à primeira versão do teste. O `clearTimeout` do `parar` já impede a resubida pelo timer, então o guarda não aparecia. O guarda só pesa em `iniciar()` depois de `parar()`, e o teste passou a chamar isso: `4 !== 3`, vermelho.

  O vazio `''` não serve como troca no script de mutante: o PowerShell 5.1 descarta argumento vazio para executável nativo, então foi usado `/* sem recusa */`.

- [ ] **Passo 7: commit** com a mensagem `feat(casa): supervisor do servir dos agentes`.

---

### Tarefa 5: a entrada `runtime/servir.mjs`

**Arquivos:** `runtime/servir.mjs`, `testes/casa-servir.test.mjs` e `package.json`.

- [ ] **Passo 1: o teste que falha.**

**Arquivo completo `testes/casa-servir.test.mjs`**

```js
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { comBancoDaCasa } from '../runtime/casa/banco.mjs'
import { registrarAgente } from '../runtime/casa/loja-nucleo.mjs'
import { ate, chamar } from './fixtures/chamar-api.mjs'

const RAIZ = resolve(import.meta.dirname, '..')
const SERVIR = join(RAIZ, 'runtime', 'servir.mjs')
const TOKEN = 'token-de-teste-servir'
const VERSAO = JSON.parse(readFileSync(join(RAIZ, '.claude-plugin', 'plugin.json'), 'utf8')).version

function pastaTemporaria(t) {
  const pasta = mkdtempSync(join(tmpdir(), 'omni-servir-'))
  t.after(() => { try { rmSync(pasta, { recursive: true, force: true }) } catch { /* sobra temporária */ } })
  return { pasta, env: { ...process.env, OMNI_HOME: pasta, OMNI_CASA_BANCO: join(pasta, 'banco'), OMNI_API_TOKEN: TOKEN } }
}

function subirServir(t, env, args = ['--porta', '0']) {
  const filho = spawn(process.execPath, [SERVIR, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  let saida = ''
  let erros = ''
  filho.stdout.setEncoding('utf8').on('data', (p) => { saida += p })
  filho.stderr.setEncoding('utf8').on('data', (p) => { erros += p })
  const fim = new Promise((resolver) => filho.on('close', (codigo) => resolver(codigo)))
  t.after(async () => {
    if (filho.exitCode === null) filho.stdin.end()
    const prazo = setTimeout(() => filho.kill(), 5_000)
    await fim
    clearTimeout(prazo)
  })
  const primeira = async () => {
    await ate(() => saida.includes('\n'), 10_000)
    return JSON.parse(saida.slice(0, saida.indexOf('\n')))
  }
  return { filho, fim, primeira, erros: () => erros }
}

test('sobe, anuncia a porta só na 1ª linha, serve a saúde e sai 0 quando o stdin fecha', async (t) => {
  const { env } = pastaTemporaria(t)
  const s = subirServir(t, env)
  const linha = await s.primeira()
  assert.equal(linha.ok, true)
  assert.ok(Number.isInteger(linha.porta) && linha.porta > 0)
  const saude = await chamar(linha.porta, 'GET', '/v1/saude', { token: TOKEN })
  assert.equal(saude.status, 200)
  assert.equal(saude.corpo.versao, VERSAO)
  assert.deepEqual(saude.corpo.agentes, [])
  assert.equal((await chamar(linha.porta, 'GET', '/v1/saude')).status, 401)
  s.filho.stdin.end()
  assert.equal(await s.fim, 0)
  assert.match(s.erros(), /stdin fechou/)
})

test('--porta inválida sai 2 com a linha de erro', async (t) => {
  const { env } = pastaTemporaria(t)
  for (const args of [['--porta', 'abc'], ['--porta', '70000'], [], ['--porta', '0', '--outra', 'x']]) {
    const s = subirServir(t, env, args)
    assert.equal(await s.fim, 2, args.join(' '))
    assert.equal((await s.primeira()).ok, false)
  }
})

test('token fora do formato sai 2', async (t) => {
  const { env } = pastaTemporaria(t)
  const s = subirServir(t, { ...env, OMNI_API_TOKEN: 'com espaço' })
  assert.equal(await s.fim, 2)
})

test('porta ocupada sai 1 com recusa:true', async (t) => {
  const { env } = pastaTemporaria(t)
  const ocupante = createServer()
  await new Promise((resolver) => ocupante.listen(0, '127.0.0.1', resolver))
  t.after(() => new Promise((resolver) => ocupante.close(resolver)))
  const s = subirServir(t, env, ['--porta', String(ocupante.address().port)])
  assert.equal(await s.fim, 1)
  const linha = await s.primeira()
  assert.equal(linha.ok, false)
  assert.equal(linha.recusa, true)
})

test('supervisiona o agente do nucleo.db e o agente toca a campainha pela API', async (t) => {
  const { pasta, env } = pastaTemporaria(t)
  const manifesto = {
    agente: 'falso', versao: '0.0.1', banco: null, requer: { node: '>=24' },
    executor: { comando: 'node testes/fixtures/agente-falso.mjs', modos: ['servir'] }, tarefas: [], credenciais: []
  }
  comBancoDaCasa(pasta, 'nucleo', (db) => registrarAgente(db, JSON.stringify(manifesto), { raiz: RAIZ }), env)
  const execucao = '20261109-120000-abcd'
  const s = subirServir(t, { ...env, AGENTE_FALSO_MODO: 'no-ar', AGENTE_FALSO_CAMPAINHA: execucao })
  const { porta } = await s.primeira()
  let agentes = []
  await ate(async () => {
    agentes = (await chamar(porta, 'GET', '/v1/saude', { token: TOKEN })).corpo.agentes
    return agentes[0]?.estado === 'no-ar'
  }, 15_000)
  assert.equal(agentes[0].agente, 'falso')
  const lista = await chamar(porta, 'GET', '/v1/despachos', { token: TOKEN })
  assert.deepEqual(lista.corpo.despachos.map((d) => d.id), [`falso/${execucao}`])
  assert.match(s.erros(), /falso: campainha 202/)
  s.filho.stdin.end()
  assert.equal(await s.fim, 0)
})
```

- [ ] **Passo 2: ver o vermelho.**

Rodar `node --test testes/casa-servir.test.mjs`. Esperado: vermelho pela asserção. O processo sai 1, porque `runtime/servir.mjs` não existe, e a 1ª linha nunca chega: o `ate` estoura, ou `fim` fica em 1 onde se esperava 2.

- [ ] **Passo 3: implementar.**

**Arquivo completo `runtime/servir.mjs`**

```js
#!/usr/bin/env node
// `node runtime/servir.mjs --porta <n>`: a API local do Omni e o supervisor do servir dos agentes.
// Contrato de 05/11:
// - a 1ª linha do stdout é {"ok":true,"porta":n}, só depois de escutar; o log vai para o stderr;
// - stdin fechado encerra: para os agentes, fecha o servidor e sai 0;
// - saída 2 é uso (argumento ou token fora do formato); saída 1 com {"recusa":true} é recusa
//   permanente (porta ocupada ou proibida); saída 1 sem recusa é falha que vale tentar de novo.
// O token vem de OMNI_API_TOKEN (quem sobe o servir é quem precisa dele: a ilha, no plano 4). Sem
// ele, nasce um aleatório só na memória e nunca é impresso: a API fica para os agentes supervisionados.
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { TOKEN, criarApiOmni } from './casa/api-omni.mjs'
import { comBancoDaCasa, registrarDegradacao } from './casa/banco.mjs'
import { listarServidores } from './casa/loja-nucleo.mjs'
import { criarSupervisor } from './casa/supervisor.mjs'
import { casaDoNucleo } from './nucleo.mjs'

const USO = 'uso: node runtime/servir.mjs --porta <0-65535>   (token opcional em OMNI_API_TOKEN)'

class UsoError extends Error {}

function lerPorta(argv) {
  let valores
  try {
    ({ values: valores } = parseArgs({ args: argv, options: { porta: { type: 'string' } }, strict: true, allowPositionals: false }))
  } catch (falha) {
    throw new UsoError(String(falha?.message ?? falha))
  }
  const porta = valores.porta ?? ''
  if (!/^\d{1,5}$/.test(porta) || Number(porta) > 65535) throw new UsoError('--porta precisa ser um inteiro de 0 a 65535.')
  return Number(porta)
}

function versaoDoOmni() {
  try {
    return JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version ?? null
  } catch {
    return null
  }
}

function escutar(servidor, porta) {
  return new Promise((resolver, rejeitar) => {
    servidor.once('error', rejeitar)
    servidor.listen(porta, '127.0.0.1', () => {
      servidor.off('error', rejeitar)
      resolver(servidor.address().port)
    })
  })
}

export async function rodarServir(argv, {
  env = process.env, saida = process.stdout, erro = process.stderr, entrada = process.stdin, casa = casaDoNucleo(env)
} = {}) {
  const linha = (objeto) => saida.write(`${JSON.stringify(objeto)}\n`)
  const log = (texto) => erro.write(`[omni servir] ${texto}\n`)

  let porta
  let token
  try {
    porta = lerPorta(argv)
    token = env.OMNI_API_TOKEN ?? randomBytes(32).toString('base64url')
    if (!TOKEN.test(token)) throw new UsoError('OMNI_API_TOKEN fora do formato: de 1 a 512 caracteres visíveis, sem espaço.')
  } catch (falha) {
    if (!(falha instanceof UsoError)) throw falha
    erro.write(`${falha.message}\n${USO}\n`)
    linha({ ok: false, erro: falha.message })
    return 2
  }

  try {
    comBancoDaCasa(casa, 'omni', () => true, env)
  } catch (falha) {
    registrarDegradacao(casa, 'servir.omni-db', falha, env)
    linha({ ok: false, erro: 'omni.db indisponível' })
    return 1
  }
  let agentes = []
  try {
    agentes = comBancoDaCasa(casa, 'nucleo', (db) => listarServidores(db), env)
  } catch (falha) {
    registrarDegradacao(casa, 'servir.nucleo-db', falha, env)
    log('nucleo.db indisponível: a API sobe sem supervisionar agentes')
  }

  let supervisor = null
  const servidor = criarApiOmni({ casa, token, versao: versaoDoOmni(), agentes: () => supervisor?.estado() ?? [], env })
  let real
  try {
    real = await escutar(servidor, porta)
  } catch (falha) {
    const permanente = falha?.code === 'EADDRINUSE' || falha?.code === 'EACCES'
    linha(permanente
      ? { ok: false, erro: `porta ${porta} indisponível (${falha.code})`, recusa: true }
      : { ok: false, erro: 'não consegui escutar' })
    return 1
  }

  supervisor = criarSupervisor({ agentes, omniApi: { url: `http://127.0.0.1:${real}/v1`, token }, env, log })
  linha({ ok: true, porta: real })
  log(`API no ar em 127.0.0.1:${real}; ${agentes.length} agente(s) para supervisionar`)
  supervisor.iniciar()

  await new Promise((resolver) => {
    entrada.once('end', resolver)
    entrada.once('close', resolver)
    entrada.resume()
  })
  log('stdin fechou: parando')
  await supervisor.parar()
  servidor.closeAllConnections()
  await new Promise((resolver) => servidor.close(() => resolver(undefined)))
  return 0
}

const direto = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (direto) {
  try {
    process.exitCode = await rodarServir(process.argv.slice(2))
  } catch (falha) {
    process.stdout.write(`${JSON.stringify({ ok: false, erro: 'falha inesperada no servir' })}\n`)
    process.stderr.write(`${String(falha?.message ?? falha).slice(0, 300)}\n`)
    process.exitCode = 1
  }
}
```

- [ ] **Passo 4: ver o verde.**

Rodar `node --test testes/casa-servir.test.mjs`. Esperado: 5 de 5 passando.

- [ ] **Passo 5: mutante.**

Trocar `linha({ ok: true, porta: real })` de lugar com a linha de cima, de modo que a porta seja anunciada antes do supervisor existir. O teste continua verde, porque a API só consulta o supervisor depois. Isso não prova nada; o mutante que importa é outro:
- anunciar antes de escutar: mover a `linha` para antes do `await escutar(...)`, anunciando `porta`. Esperado: vermelho, porque a porta anunciada é 0 e a asserção `linha.porta > 0` falha;
- `recusa: true` sai da recusa: vermelho em "porta ocupada".

- [ ] **Passo 6: incluir os módulos no `check` do `package.json`.**

No fim do script `check`, acrescentar `&& node --check runtime/servir.mjs && node --check runtime/casa/api-omni.mjs && node --check runtime/casa/supervisor.mjs && node --check runtime/casa/loja-despachos.mjs`.

- [ ] **Passo 7: commit** com a mensagem `feat(casa): omni servir, a API local com o supervisor dos agentes`.

---

### Tarefa 6: prova com o Oráculo de verdade (só leitura no repo dele)

Nenhum arquivo do repo do Oráculo é escrito: todo banco e registro vai para uma pasta temporária via `OMNI_CASA_BANCO` e `OMNI_HOME`. Antes e depois, conferir `git -C <Oracle> status --porcelain`, que tem de ficar igual.

- [ ] **Passo 1: preparar a pasta.**
  - Criar uma pasta temporária em `%LOCALAPPDATA%\omni\rascunho\prova-p3-<hora>`.
  - Registrar o manifesto do Oráculo (`<Oracle>\executor\agente.json`, lido) num `nucleo.db` dessa pasta, com raiz `<Oracle>`. Usar `node runtime/nucleo.mjs registrar` ou um script de uma linha com `registrarAgente`.

- [ ] **Passo 2: subir sem credencial.**

Subir `node runtime/servir.mjs --porta 0` com `OMNI_CASA_BANCO` e `OMNI_HOME` na pasta. Esperado:
- a saúde mostra `oraculo` `recusado`, com o erro do Oráculo sobre a credencial da API;
- a recusa é permanente: uma subida só.

- [ ] **Passo 3: instalar os hashes e subir de novo.**
  - Gerar dois tokens aleatórios na memória (`tela` e `visita`) e rodar, na raiz do Oráculo e com a mesma pasta, `node executor/oraculo-executor.mjs instalar --stdin` com o JSON dos sha256.
  - Subir o `servir` de novo. Esperado: `oraculo` `no-ar` com porta.
  - Com o token `tela`, `GET http://127.0.0.1:<porta do oraculo>/v1/saude` responde 200.

- [ ] **Passo 4: encerrar e anotar.**
  - Fechar o stdin: o `servir` sai 0 e o processo do Oráculo some (conferir o pid).
  - Anotar o resultado no PR: estados, códigos e o SHA do Oráculo usado.
  - Apagar a pasta temporária.

---

### Tarefa 7: plano mestre, verde inteiro, release 0.28.0

- [ ] **Passo 1: plano mestre.**

Atualizar as linhas 3 e 4 do [plano mestre](2026-11-09-f2-casa-instalavel.md):
- a 3 aponta para este plano e para `runtime/servir.mjs`;
- a 4 ganha o provedor de tokens do `cofre.db`, o `chamar` do supervisor e o carteiro.

- [ ] **Passo 2: suíte inteira**, uma pesada por vez.
  - Rodar `npm test`, com a saída em `.suite-full.txt`, e ler o total: pass, fail e skip.
  - Rodar `npm run typecheck`.
  - Rodar `npm run check`.
  - Conferir `git diff --ignore-cr-at-eol --stat -- dist`. Se vier vazio, rodar `git checkout -- dist`.

- [ ] **Passo 3: bump para 0.28.0.**

Usar o script do padrão do 0.27.1:
- `plugin.json`, `package.json`, `package-lock.json`, `releases.json` (com a nota do que entrou) e `integridade.json`, com a impressão do payload recalculada;
- a fonte da versão continua sendo `.claude-plugin/plugin.json`;
- depois do bump, rodar de novo os testes de release e integridade.

- [ ] **Passo 4: commit, push, PR e merge.**
  - Commit com autor e committer Weriton-DataOps.
  - `gh auth switch --user Weriton-DataOps`, push do ramo `casa-f2-p3`, PR para `main`.
  - Esperar o CI com `gh pr checks <n> --watch --interval 30`.
  - Com tudo verde: `gh pr merge <n> --merge --match-head-commit <sha>`.
  - Voltar com `gh auth switch --user wp-grgroup`.

- [ ] **Passo 5: instalar e verificar.**
  - `claude plugin marketplace update omni-hub` e `claude plugin update omni@omni-hub --scope user`.
  - Verificar a raiz instalada 0.28.0 (integridade `verified`) e rodar `node <raiz>\runtime\servir.mjs --porta 0` com o banco de verdade, só para ler a 1ª linha e a saúde. Encerrar pelo stdin.
  - Nesta máquina, o `nucleo.db` real ainda não tem agentes registrados (isso é do plano 5): esperar `agentes: []`.

## Autorrevisão

**Cobertura do contrato:**

| Item do contrato | Onde está coberto |
|---|---|
| 127.0.0.1 só | `escutar` e teste 421 |
| Token em toda rota | `autorizado` antes de qualquer rota; testes 401 |
| 1ª linha só depois de escutar | mutante da Tarefa 5 |
| Log no stderr | `log` do `servir` |
| stdin fecha e encerra | testes do `servir` e do supervisor |
| Saída 2 permanente | supervisor e `servir` |
| `recusa:true` permanente | supervisor e `servir` (porta ocupada) |
| Backoff | `esperaDoBackoff` e teste da queda |
| Campo a mais tolerado | agente falso anuncia `extra` |
| `localhost` → 421 | teste 421 |
| `timingSafeEqual` | `autorizado` |
| 413 | teste 413 |
| 500 sem pilha | teste do banco fora do ar |
| `/v1/saude` sem token → 401 | teste 401 e teste do `servir` |
| Campainha 202 idempotente | API e ponta a ponta com o agente falso |
| `OMNI_API` e `OMNI_API_TOKEN` por env | registro do agente falso |
| Nunca `--logs` | o supervisor não passa argumento além de `servir --porta 0` |

**Sem marcador:** nenhum passo com "a definir". O que sai deste plano está nomeado acima, com o plano que o recebe.

**Nomes conferidos entre tarefas:**
- `listarServidores` devolve `{agente, raiz, comando, divergente}`, e `criarSupervisor` lê exatamente esses campos;
- `TOKEN` é exportado por `api-omni.mjs` e usado em `servir.mjs`;
- `ate` e `chamar` vêm de `testes/fixtures/chamar-api.mjs` nos três arquivos de teste.

**Risco conhecido:** o comando do manifesto é partido por espaço, então caminho com espaço dentro do comando não funciona. Os manifestos atuais (Oráculo e Overcore) usam caminho relativo sem espaço. Se aparecer um, o formato do manifesto ganha `argumentos` (lista) numa versão nova do contrato.
