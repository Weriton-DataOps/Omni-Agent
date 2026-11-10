# F2, plano 4c: pareamento duplo do WhatsApp — plano de implementação

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** numa máquina recém-instalada, a ilha leva o Weriton pelos dois pareamentos do WhatsApp, na ordem: primeiro o número pessoal (só leitura), depois o do bot (conversa). Cada QR diz para que serve o número antes do escaneio. O card só fica verde quando os dois estão pareados e o pessoal está provado como só leitura.

**Arquitetura:**
- O laço do `parear.mjs` vira o módulo puro `servicos/whatsapp/omni/pareamento.mjs`, com a API, o relógio, a espera e o gravador de arquivos injetados. Os testes usam uma API falsa: nenhum teste toca o serviço real (127.0.0.1:2785) nem o cofre.
- O `parear.mjs` vira uma CLI fina com dois modos:
  - sem `--json`, a página `pareamento.html` de sempre, porque o caminho manual não pode quebrar;
  - com `--json`, linhas JSON no stdout, uma por evento.
- "Só leitura provado" é o que o `chaves.mjs` já faz: cria as chaves com escopo e prova que envio e terceiros são recusados na sessão pessoal. Essa prova vira o módulo `chaves-escopo.mjs` e grava `pareamento.json`, só com o resultado, sem chave nem número inteiro.
- O passo `fechar` roda depois dos dois pareamentos.
- A ilha roda os três passos em sequência (`pessoal` → `bot` → `fechar`) num processo à parte, com o Node do sistema (`OMNI_NODE` ou o do PATH, como o `casa-servir.js`). O pareador (`pareamento-ilha.js`) só repassa campos de uma lista fechada.
- O QR aparece numa janela própria, "Parear WhatsApp", aberta pelo botão do card.
  - **Desvio consciente do "QR dentro do card" do mestre.** O card tem duas linhas (cerca de 60 px), e um QR precisa de pelo menos 200 px para a câmera ler. Por isso a janela é aberta pelo card.
  - Com `OMNI_ILHA_PAREAR=1`, a ilha abre a janela sozinha ao subir. É o passo 8 do executor (§4), que o plano 5 liga.

**Tecnologia:** Node ≥ 24 (`node:test`, `node:http`), Electron 33.4.11 da ilha (CommonJS, testado por `createRequire`).

**Desenho:** [Casa única](../specs/2026-11-04-casa-unica-tres-agentes-design.md) §4 (passo 8) e §4.1; [plano mestre da F2](2026-11-09-f2-casa-instalavel.md), linha 4c.

**Fora daqui:**
- **Plano 5:** subir o serviço do WhatsApp numa máquina limpa e criar a chave admin no cofre. Neste plano, serviço fora ou admin ausente viram motivo na tela, nunca exceção.
- **Plano 6:** escanear de verdade. Pela regra do mestre, o ensaio nunca escaneia QR: a prova deste plano usa um serviço falso.

**Sem release do plugin:** `servicos/` e `apps/` não estão nas raízes da release (adaptadores, contratos, dist, hooks, runtime, scripts e skills). A impressão digital não muda, e o fechamento é PR, CI verde e merge. A ilha real desta máquina só recebe isto na instalação do plano 6.

**Regras de segurança deste plano:**
- Nenhum evento, arquivo ou log carrega o número inteiro: só os 4 últimos dígitos (`fone4`).
  - A exceção é o `dono.txt`. Ele já guarda o número do dono hoje e passa a ser escrito a partir do pessoal pareado, se não existir.
- Nenhuma chave sai do processo da CLI. O pareador da ilha descarta toda linha que não esteja na lista fechada.
- A janela de pareamento usa `setContentProtection(true)`: o QR é credencial enquanto vale.
- A prova recusa rodar se a base apontar para a porta 2785.

---

## Arquivos

| Arquivo | Papel |
|---|---|
| `servicos/whatsapp/omni/pareamento.mjs` (novo) | `parearSessao(opcoes)`: o laço de um pareamento, puro, com eventos |
| `servicos/whatsapp/omni/chaves-escopo.mjs` (novo) | `provisionarChaves(opcoes)`: cria as 3 chaves com escopo e devolve as provas |
| `servicos/whatsapp/omni/parear.mjs` | CLI fina: `--papel pessoal\|bot\|fechar`, `--bot` (sinônimo), `--json`, `--chave-stdin` |
| `servicos/whatsapp/omni/chaves.mjs` | passa a usar `chaves-escopo.mjs`, com a mesma saída de hoje |
| `servicos/whatsapp/omni/config.mjs` | `BASE` aceita `OMNI_WHATSAPP_BASE` |
| `apps/omni-ilha/whatsapp.js` | lê `pareamento.json` e devolve `pareamento` no `lerWhatsapp` |
| `apps/omni-ilha/whatsapp-vista.js` (novo) | `vistaPareamento(w)`: pareado, falta-pessoal, falta-bot, falta-prova ou sem-servico, com a ação |
| `apps/omni-ilha/pareamento-ilha.js` (novo) | `criarPareador({ gerar, node, script, env, enviar })`: os 3 passos em ordem, a lista fechada e o cancelamento |
| `apps/omni-ilha/pareamento.html`, `pareamento-preload.js`, `pareamento-janela.js` (novos) | a janela "Parear WhatsApp" |
| `apps/omni-ilha/main.js`, `preload.js`, `renderer.js`, `index.html` | `abrirPareamento`, IPC `whatsapp:parear*`, botão no card, `OMNI_ILHA_PAREAR` |
| testes | `whatsapp-pareamento`, `whatsapp-chaves-escopo`, `whatsapp-parear-cli`, `ilha-whatsapp-vista`, `ilha-pareador` (novos) |

---

### Tarefa 1: `parearSessao`, o laço puro

**Arquivos:** `servicos/whatsapp/omni/pareamento.mjs`; teste `testes/whatsapp-pareamento.test.mjs`.

Assinatura:

```js
// api(metodo, caminho, corpo?) → { ok, status, dados }   (lança ou status 0 = serviço fora)
// papel: 'pessoal' | 'bot'
// ids: { ler(papel) → string|null, gravar(papel, id) }
// dono: { ler() → string|null, gravar(numero) }          (só o pessoal grava, e só se não houver)
// emitir(evento)                                          (objeto; a CLI serializa)
// esperar(ms), agora() → ms, qrImagem(codigo) → Promise<dataURL>, prazoMs (padrão 10 min)
export async function parearSessao({ api, papel, ids, dono, emitir, esperar, agora, qrImagem, prazoMs }) → { ok, motivo?, fone4? }
```

Eventos (lista fechada, igual à do pareador da ilha):
- `{ evento: 'sessao', papel }`;
- `{ evento: 'qr', papel, qr: 'data:image/png;base64,…', estado }`;
- `{ evento: 'estado', papel, estado }`;
- `{ evento: 'pareado', papel, fone4 }`;
- `{ evento: 'fim', papel, ok, motivo? }`.

Os motivos são estes: `servico-fora`, `sem-pessoal`, `mesmo-numero`, `caiu`, `acao-necessaria`, `prazo` e `admin-ausente`. O último só vem da CLI.

- [ ] **Teste vermelho.** A API falsa é um roteiro de estados por sessão e anota toda chamada:

```js
function apiFalsa({ sessoes = {}, lista = [], criar = 'novo-id', fones = {}, servicoFora = false } = {}) {
  const chamadas = []
  const roteiro = Object.fromEntries(Object.entries(sessoes).map(([id, estados]) => [id, [...estados]]))
  const api = async (metodo, caminho, corpo) => {
    chamadas.push(`${metodo} ${caminho}`)
    if (servicoFora) return { ok: false, status: 0, dados: null }
    if (metodo === 'GET' && caminho === '/api/sessions') return { ok: true, status: 200, dados: lista }
    if (metodo === 'POST' && caminho === '/api/sessions') { roteiro[criar] ??= ['qr_ready', 'ready']; return { ok: true, status: 201, dados: { id: criar, name: corpo.name } } }
    const m = /^\/api\/sessions\/([^/]+)(\/.*)?$/.exec(caminho)
    const id = m[1], resto = m[2] || ''
    const fila = roteiro[id]
    if (metodo === 'GET' && !resto) { const status = fila.length > 1 ? fila.shift() : fila[0]; return { ok: true, status: 200, dados: { status, phone: status === 'ready' ? fones[id] : null, lastError: 'motivo do serviço' } } }
    if (metodo === 'GET' && resto === '/qr') return { ok: true, status: 200, dados: { qrCode: `codigo-${chamadas.length >> 2}` } }
    return { ok: true, status: 200, dados: {} } // start, logout
  }
  return { api, chamadas }
}
const base = (extra) => {
  const eventos = []; const gravados = {}; let donoGravado = null
  return {
    eventos, gravados, get dono() { return donoGravado },
    opcoes: {
      ids: { ler: (p) => extra.ids?.[p] ?? null, gravar: (p, id) => { gravados[p] = id } },
      dono: { ler: () => extra.donoAtual ?? null, gravar: (n) => { donoGravado = n } },
      emitir: (e) => eventos.push(e), esperar: async () => {}, agora: (() => { let t = 0; return () => (t += 3000) })(),
      qrImagem: async (c) => `data:image/png;base64,${Buffer.from(c).toString('base64')}`, prazoMs: 10 * 60_000,
      ...extra.opcoes,
    },
  }
}
```

Casos, um `test` cada:
1. Pessoal com id existente, com a sequência `initializing`, `qr_ready`, `qr_ready` e `ready` (fone `5562999991234`):
   - devolve `{ ok: true, fone4: '1234' }`;
   - emite `sessao`, pelo menos um `qr` com `data:image/png;base64,` e `pareado` com `fone4: '1234'`;
   - grava o `dono` com `5562999991234`, porque não havia.
2. Já havia `dono`: não regrava.
3. QR igual não é reemitido. Com o mesmo `qrCode` em duas leituras, há só um `qr`.
4. Bot sem id e sem sessão `omni-bot` na lista: faz `POST /api/sessions` com `{ name: 'omni-bot' }` e grava o id. Se `omni-bot` já está na lista, reaproveita e não cria.
5. Pessoal sem id: cria `omni-pessoal` (mesma regra).
6. Bot com o pessoal ainda sem id, ou com a sessão pessoal fora de `ready`: devolve `{ ok: false, motivo: 'sem-pessoal' }` e nenhuma chamada toca o id do bot.
7. Bot pareou com o mesmo número do pessoal: `mesmo-numero`, mais um `POST /api/sessions/<bot>/logout`. Escanear com o celular errado deixa o pessoal como aparelho conectado duas vezes, e o logout desfaz isso.
8. Com a sequência `disconnected`, `failed`, `disconnected` e `disconnected`, a sessão é reiniciada 3 vezes (3 `POST …/start` além do inicial). Na 4ª queda, devolve `caiu`.
9. `action_required` devolve `acao-necessaria`, e o motivo do serviço vai cortado em 200 caracteres no evento `fim`.
10. O relógio passa de `prazoMs` sem `ready`: `prazo`.
11. Serviço fora (status 0 em tudo): `servico-fora`, sem lançar exceção.
12. Varredura de vazamento: em todos os eventos de todos os casos acima, `JSON.stringify(eventos)` não contém 8 dígitos seguidos.

- [ ] **Vermelho visto** pela asserção, não por import ausente. Primeiro um `pareamento.mjs` com `export async function parearSessao() { return { ok: false } }`.
- [ ] **Implementação**, levando o laço de hoje do `parear.mjs`:
  - estados `created`, `initializing`, `qr_ready`, `authenticating`, `ready`, `disconnected`, `failed` e `action_required`;
  - `start` só se não está `ready`;
  - pausa de 3 s entre leituras;
  - QR que já vem `data:image` passa direto; o resto vai pelo `qrImagem`.
  - O bot confere o pessoal (`ids.ler('pessoal')` e `GET` com `status === 'ready'`) antes de qualquer chamada à sessão dele. No `ready`, compara o `phone` só de dígitos com o do pessoal.
- [ ] **Verde lido:** `node --test testes/whatsapp-pareamento.test.mjs`, com 12 de 12 pelo nome. Depois, um mutante: tirar a checagem `mesmo-numero` deixa o caso 7 vermelho pela asserção.
- [ ] **Commit:** `feat(whatsapp): laço de pareamento puro, com eventos e guarda do número trocado`.

### Tarefa 2: `provisionarChaves` e o `pareamento.json`

**Arquivos:** `servicos/whatsapp/omni/chaves-escopo.mjs`, `chaves.mjs`; teste `testes/whatsapp-chaves-escopo.test.mjs`.

```js
// api(metodo, caminho, corpo?, chave?) → { status, j }; segredos: { gravar(nome, valor), ler(nome) }; NOMES do cofre.mjs
export async function provisionarChaves({ api, pessoal, bot, dono, segredos, nomes, log = () => {}, so = 'todas' }) → { ok, provas: [{ rotulo, status, esperado, ok }] }
export function resumoSoLeitura(provas) → { ok, recusas, falhas: [rotulo] }   // ok só se TODAS as provas passaram
```

As provas são as 9 que o `chaves.mjs` imprime hoje, com os mesmos rótulos:
- `[leitura lê a sessão pessoal]` → 200
- `[leitura lê a sessão do bot]` → 200
- `[leitura tenta enviar]` → 401 ou 403
- `[envio: bot → dono]` → 201
- `[envio: bot → outro destino]` → 401 ou 403
- `[envio pela sessão pessoal]` → 401 ou 403
- `[terceiros lê a sessão do bot]` → 200
- `[terceiros envia pela sessão pessoal]` → 401 ou 403
- `[terceiros lê a sessão pessoal]` → 401 ou 403

- [ ] **Teste vermelho.** A API falsa responde por chave e rota, respeitando `allowedSessions` e `allowedChats` do corpo de criação:
  1. Serviço correto: `ok: true`, 9 provas `ok`, o `gravar` recebe as 3 chaves com os nomes do cofre, e `resumoSoLeitura` volta `{ ok: true, recusas: 5, falhas: [] }`.
  2. Serviço que deixa o envio sair pela sessão pessoal (201): `ok: false`, e `falhas` contém `[envio pela sessão pessoal]`.
  3. Nenhum `log` e nenhuma prova contém o valor de uma chave (as chaves falsas são `chave-<nome>-<aleatório>`, e a busca é pelo valor).
  4. As chaves antigas com os mesmos nomes são revogadas antes de criar (`POST …/revoke` para cada uma ativa).
- [ ] **Vermelho visto.**
- [ ] **Implementação:**
  - mover a lógica do `chaves.mjs` para o módulo;
  - o `chaves.mjs` passa a montar `api`, `segredos` e `nomes` reais e imprimir as linhas com o mesmo formato (`rotulo.padEnd(38) HTTP n ✔`);
  - o `--terceiros` vira `so: 'terceiros'`.
- [ ] **Verde lido:** o teste novo mais `node --check servicos/whatsapp/omni/chaves.mjs`. Um mutante: aceitar 201 como recusa deixa o caso 2 vermelho.
- [ ] **Commit:** `refactor(whatsapp): chaves com escopo viram módulo e devolvem as provas`.

### Tarefa 3: a CLI `parear.mjs`

**Arquivos:** `servicos/whatsapp/omni/parear.mjs`, `config.mjs`; teste `testes/whatsapp-parear-cli.test.mjs`.

Contrato:
- `node parear.mjs [--papel pessoal|bot|fechar] [--bot] [--json] [--chave-stdin]`.
- `--bot` é o mesmo que `--papel bot`. O padrão é `pessoal`.
- `--chave-stdin`: a chave admin vem da 1ª linha do stdin, não do cofre. É o caminho dos testes; quem tem a chave já fala com a API de qualquer jeito.
- `--json`: uma linha JSON por evento. Sem ele, a página `pareamento.html` de hoje, escrita pelo mesmo `emitir`.
- `--papel fechar`:
  - lê os dois ids e o `dono`, roda `provisionarChaves` e grava `pareamento.json` de forma atômica (`.tmp` + `rename`);
  - o arquivo é `{ em, pessoal: { fone4 }, bot: { fone4 }, soLeitura: { ok, recusas, falhas, em } }`;
  - emite `{ evento: 'fechado', soLeitura: { ok, recusas, falhas } }` e `fim`.
- Saída 0 com `ok`, 2 sem `ok`, 1 em erro inesperado.
- O `qrcode` passa a ser carregado só quando um QR não vem como `data:image` (o worktree não tem `servicos/whatsapp/node_modules`).
- `config.mjs`: `export const BASE = process.env.OMNI_WHATSAPP_BASE || 'http://127.0.0.1:2785'`.

- [ ] **Teste vermelho.** Um serviço falso em `node:http` numa porta 0, com o `APPDATA` temporário:
  1. `--json --chave-stdin --papel pessoal`:
     - o serviço confere o cabeçalho `X-API-Key` igual ao do stdin;
     - o QR já sai como `data:image/png;base64,…`;
     - a saída tem as linhas `sessao`, `qr`, `pareado` e `fim` com `ok: true`, e o código é 0;
     - `sessao.id` e `dono.txt` foram gravados no `APPDATA` temporário.
  2. `--papel bot` com o pessoal pareado: `fim` com `ok: true`, `sessao-bot.id` gravado.
  3. `--papel fechar`:
     - `pareamento.json` com `soLeitura.ok: true` e os dois `fone4`;
     - nenhum arquivo do `APPDATA` temporário contém as chaves que o serviço falso emitiu;
     - a saída também não as contém.
  4. Serviço que aceita envio pela pessoal: `fechar` sai com 2, e `soLeitura.ok` vem `false`.
  5. Sem `--json`: `pareamento.html` existe e contém "Parear o seu WhatsApp pessoal" ou "✅ Pareado", e a saída não tem linha JSON.
  6. Guarda: com `OMNI_WHATSAPP_BASE` em `:2785`, o próprio teste aborta antes de rodar. A asserção fica na preparação, com mensagem explícita.
- [ ] **Vermelho visto.**
- [ ] **Implementação.**
- [ ] **Verde lido** e `node --check` nos 3 arquivos.
- [ ] **Commit:** `feat(whatsapp): parear.mjs com --json, --papel fechar e chave pelo stdin`.

### Tarefa 4: o card sabe o que falta

**Arquivos:** `apps/omni-ilha/whatsapp.js`, `apps/omni-ilha/whatsapp-vista.js`; teste `testes/ilha-whatsapp-vista.test.mjs`.

```js
// w = lerWhatsapp(...): { instalado, servico, ponte, saude: { sessoes: { bot, pessoal } } | null, pareamento: {...} | null }
vistaPareamento(w) → { estado: 'pareado'|'falta-pessoal'|'falta-bot'|'falta-prova'|'sem-servico'|'ausente', acao: 'parear'|null, texto }
```

| Situação | Estado | Ação | Texto |
|---|---|---|---|
| `!w.instalado` | `ausente` | `parear` | "parear os dois números" |
| `!w.servico` | `sem-servico` | `null` | "serviço do WhatsApp parado" |
| pessoal sem `ready` | `falta-pessoal` | `parear` | "falta parear o seu WhatsApp (1 de 2)" |
| bot sem `ready` | `falta-bot` | `parear` | "falta parear o número do Omni (2 de 2)" |
| sem `pareamento.json` ou `soLeitura.ok !== true` | `falta-prova` | `parear` | "o seu número ainda não foi provado só leitura" |
| tudo certo | `pareado` | `null` | — |

- [x] **Teste vermelho**, com um caso por linha da tabela. Mais estes:
  - a ordem de checagem: pessoal caído e bot caído dá `falta-pessoal`;
  - `pareamento.json` com `soLeitura.ok: true`, mas `fone4` do pessoal diferente do da sonda (alguém pareou outro número depois): `falta-prova`.
- [x] **Vermelho visto:** 14 de 14 pela asserção.
- [x] **Implementação:**
  - `lerWhatsapp` lê `pareamento.json` (falha de leitura vira `null`);
  - o renderer usa `vistaPareamento` e só pinta `ligada` (verde) com `estado === 'pareado'`;
  - nos outros estados com o serviço no ar, o card fica âmbar (`pausada` reaproveitada como `falta`, classe nova `falta` no CSS com `--cor: var(--ambar)`) e a 2ª linha vira o texto, com um botão "parear" (`ponte.abrirPareamento()`).
- [x] **Verde lido:** 14 de 14, e 32 de 32 com `ilha-cofre-card` e `ilha-agentes`. Os 4 mutantes morreram, cada um no seu caso: prova sem `ok`, `fone4` trocado, ordem pessoal/bot, `conferindo` virando `pareado`.
- [x] **Commit:** `c68b05d`.

**Desvios da execução (T4):**
1. **A sonda não vê sessão nenhuma numa máquina nova.** A chave de leitura só nasce no `fechar`, e o `saude.json` não traz `sessoes` sem o bot. Por isso a vista decide primeiro pelos arquivos:
   - `ids.pessoal` e `ids.bot` vêm do `existsSync` de `sessao.id` e `sessao-bot.id`;
   - depois vem a prova do `pareamento.json`;
   - só então a sonda confirma o `ready` e o `fone4`.
   Entre o `fechar` e a primeira sonda o estado é `conferindo`: âmbar, sem ação, com o texto "conferindo as duas sessões".
2. **`ausente` fica sem ação.** Sem a pasta do WhatsApp também não há serviço, e parear daria só `servico-fora`. O texto é "WhatsApp não instalado".
3. **O alvo é o card inteiro, não um botão.** As linhas são refeitas a cada 2 s, e um botão dentro delas trocaria de nó embaixo do ponteiro (o mesmo motivo do `tocar` por retângulo). Quando `acao === 'parear'`, o card inteiro chama `ponte.abrirPareamento()`, e a 2ª linha mostra o texto com "parear ›".
4. **A vista é calculada no main.** O renderer não tem `require`, então `lerWhatsapp` devolve `vista` pronta.

### Tarefa 5: o pareador da ilha

**Arquivos:** `apps/omni-ilha/pareamento-ilha.js`; teste `testes/ilha-pareador.test.mjs`.

```js
// gerar(node, args, opcoes) → processo-filho (spawn injetado); enviar(evento) → janela
criarPareador({ gerar, node, script, env, enviar }) → { iniciar(), cancelar(), estado() }
```

- [ ] **Teste vermelho.** O `gerar` falso devolve um `EventEmitter` com `stdout` (`PassThrough`) e `kill()`:
  1. `iniciar()` roda `pessoal`. Com `fim ok` do pessoal, roda `bot`; com `fim ok` do bot, roda `fechar`. Os `args` saem nessa ordem e sempre com `--json`.
  2. `fim` com `ok: false` em qualquer passo para a sequência, e o passo seguinte não roda.
  3. Lista fechada:
     - só `sessao`, `qr`, `estado`, `pareado`, `fechado` e `fim` chegam ao `enviar`, e só com os campos `evento`, `papel`, `qr`, `estado`, `fone4`, `ok`, `motivo` e `soLeitura` (`ok`, `recusas`, `falhas`);
     - `qr` que não começa com `data:image/png;base64,` é descartado;
     - uma linha `{"evento":"qr","chave":"x"}` chega sem `chave`;
     - linha que não é JSON, ou evento fora da lista, não chega.
  4. `iniciar()` com um pareamento em curso não abre outro processo (um por vez).
  5. `cancelar()` chama `kill()` no processo em curso, e a sequência não continua.
  6. Processo que sai sem `fim`: o `enviar` recebe `{ evento: 'fim', papel, ok: false, motivo: 'saiu' }`.
  7. O `env` do filho não carrega `OMNI_API_TOKEN` (a ilha guarda o token da casa no processo principal).
- [x] **Vermelho visto:** 14 de 14. São 13 pela asserção e 1 `TypeError` do esboço (`enviados[0]` vazio).
- [x] **Implementação.** Leitura por linha, com acumulador de pedaços, e um limite de 1 MB por linha (um QR em PNG tem cerca de 10 KB). Estes pontos vão além do plano:
  - `continuar()`, que é o ajuste da T6;
  - `iniciar(desde)`, para o "tentar de novo" voltar ao passo que falhou;
  - `detalhe` na lista fechada, com os números mascarados de novo;
  - motivo `sem-node` quando o Node não existe;
  - `chaveStdin` opcional, só para a prova;
  - o papel do evento é o do passo em curso, não o que o filho diz;
  - a cauda de uma linha gigante é descartada junto com ela.
- [x] **Verde lido:** 14 de 14, e 9 de 9 mutantes mortos, cada um no seu teste:
  - token da casa herdado;
  - prefixo do QR;
  - papel vindo do filho;
  - cancelar sem marca;
  - cauda da linha gigante. Este sobreviveu na 1ª rodada, e o teste passou a usar uma cauda com JSON válido;
  - `sem-node`;
  - `continuar()` pedido cedo;
  - detalhe sem máscara;
  - dois processos ao mesmo tempo.
- [x] **Commit:** `feat(ilha): pareador roda pessoal, bot e fechar com lista fechada de eventos`.

### Tarefa 6: a janela "Parear WhatsApp"

**Arquivos:** `apps/omni-ilha/pareamento.html`, `pareamento-preload.js`, `pareamento-janela.js`, `main.js`, `preload.js`, `renderer.js`, `index.html`.

- [ ] `main.js`:
  - `abrirPareamento()` segue o molde do `abrirCofre`: uma só janela, `setContentProtection(true)`, `window.open` negado e navegação negada;
  - IPC `whatsapp:parear-iniciar` e `whatsapp:parear-cancelar`, conferidos por `daJanelaPareamento`;
  - os eventos do pareador vão por `janelaPareamento.webContents.send('whatsapp:pareamento', e)`;
  - fechar a janela chama `cancelar()`;
  - `abrir-pareamento` vem da ilha (`daIlha`), e com `OMNI_ILHA_PAREAR=1` a janela abre depois do `pronta`;
  - o gancho de teste ganha `abrirPareamento` e `janelaPareamento`.
- [ ] `pareamento-preload.js` expõe `window.pareamento = { iniciar, cancelar, aoEvento(cb) }`. Só repassa o dado, nunca o evento do Electron.
- [ ] `pareamento-janela.js`: uma máquina de telas, na ordem:
  1. `apresentar-pessoal`: "1 de 2 · o SEU WhatsApp". Explica que o Omni só lê e nunca envia por ele. Botão "mostrar o QR".
  2. `qr-pessoal`: o QR, com "No SEU celular: WhatsApp → Aparelhos conectados → Conectar um aparelho".
  3. `apresentar-bot`: "2 de 2 · o número do Omni". Diz que é por ele que o Omni conversa com você, e manda escanear com o celular do NÚMERO DO OMNI, não com o seu. Botão "mostrar o QR".
  4. `qr-bot`.
  5. `provando`: "conferindo que o seu número é só leitura".
  6. `pronto`: os dois `fone4`, "pessoal só leitura · provado (5 recusas)".
  7. `erro`: o motivo em português. Os textos ficam num mapa: `mesmo-numero` é "você escaneou o QR do bot com o seu próprio celular; desfiz o pareamento, escaneie com o celular do número do Omni". Botão "tentar de novo".
  - O QR só aparece depois do clique em "mostrar o QR". É a regra do §4.1: o papel do número vem antes do escaneio.
  - Pausar entre o pessoal e o bot pede um ajuste: o pareador emite o `fim` do pessoal, e a janela só pede o `bot` com o clique. Por isso `criarPareador` ganha `continuar()`, e a sequência para depois de cada `fim ok` até a janela chamar `continuar()`. O teste do T5, caso 1, passa a chamar `continuar()` entre os passos. Esta mudança entra no T5, antes do commit dele.
- [ ] `pareamento.html`:
  - CSS com tokens no `:root`, a mesma paleta escura do cofre (`#11141a`) e o verde do WhatsApp só no QR pronto;
  - o QR a 280 px num fundo branco com margem;
  - nada de emoji como ícone;
  - revisão `anti-slop-review` sobre as fotos da Tarefa 7.
- [ ] `index.html` e `renderer.js`: o botão "parear" na 2ª linha do card quando `acao === 'parear'`; `preload.js` ganha `abrirPareamento`.
- [ ] **Verde lido:** a suíte da ilha (`ilha-*`), `node --check` nos JS novos e o typecheck.
- [ ] **Commit:** `feat(ilha): janela Parear WhatsApp com o papel de cada número antes do QR`.

### Tarefa 7: prova na bancada, com um serviço falso

**Rascunho:** `$env:LOCALAPPDATA\omni\rascunho\p4c`. O script da prova fica na pasta de rascunho da sessão, não no repo.

O cenário:
- o serviço falso em `node:http`, porta 0, com o roteiro `pessoal: qr_ready → ready` e `bot: qr_ready → ready`, as chaves com escopo e as recusas certas;
- o `APPDATA` temporário com a chave admin entregue por `--chave-stdin` (o pareador da ilha ganha `chaveStdin` opcional só para a prova; sem ele, a CLI lê o cofre);
- `OMNI_WHATSAPP_BASE` apontando para o serviço falso; a prova aborta se a porta for 2785;
- a ilha real escondida, com o gancho.

As caixas:
- [ ] Com `OMNI_ILHA_PAREAR=1`, a janela abre sozinha e a tela é `apresentar-pessoal`, sem QR no DOM.
- [ ] "mostrar o QR" → aparece um `img` com `data:image/png` e o texto do SEU celular.
- [ ] O pessoal fica `ready` → `apresentar-bot`, com o texto do NÚMERO DO OMNI e sem QR no DOM.
- [ ] O bot fica `ready` → `provando` → `pronto`, com os dois `fone4` e "5 recusas".
- [ ] O card da ilha fica `ligada` (verde) só depois do `pronto`. Antes dele, fica `falta`, com o texto da Tarefa 4.
- [ ] Cenário trocado: o bot pareia com o fone do pessoal → tela `erro` com o texto de `mesmo-numero`, mais um `logout` no serviço falso.
- [ ] Cenário de envio vazando: o serviço aceita envio pela pessoal → `erro` com "não consegui provar que o seu número é só leitura", e o card não fica verde.
- [ ] Vazamento: as chaves do serviço falso e o número inteiro não aparecem na saída da ilha, nos arquivos do `APPDATA` temporário nem no DOM (`document.body.innerHTML`).
- [ ] Fotos (`capturePage`) de cada tela, mais a revisão `anti-slop-review`, com as correções aplicadas.
- [ ] Resultado registrado aqui, com a contagem de OK e FALHOU.

### Tarefa 8: fechamento

- [ ] Suíte inteira (`npm test`) em segundo plano, lida até o total; `dist` sem ruído.
- [ ] Integridade 6 de 6, para confirmar que a impressão digital não mudou (nada nas raízes da release).
- [ ] Commit Weriton-DataOps, PR, CI verde e merge (`--merge --match-head-commit`).
- [ ] Linha 4c do mestre marcada como entregue, com o desvio da janela anotado.
