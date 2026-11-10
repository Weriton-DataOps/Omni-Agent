# F2, plano 4b: a ilha na casa — plano de implementação

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** a ilha deixa de ler os arquivos dos agentes e passa a falar com eles só pela casa. Ela sobe o `servir` do Omni, monta o painel de cada agente pela `interface` do `agente.json` dele e leva cada pedido da tela pelo IPC `agente:api`.

**Arquitetura:**
- O `servir` ganha `GET /v1/agentes`, só para o token da ilha. A rota devolve os agentes instalados nesta máquina que declaram `interface`, com a versão e o estado do supervisor.
- A ilha (Electron 33, Node 20, sem `node:sqlite`, §3.4) sobe o `servir` com o Node do sistema, conferido pela mesma sonda do cofre, e com um `OMNI_API_TOKEN` aleatório. O token mora só no processo principal: nunca vai ao renderer nem a log.
- Cada janela de agente fica presa ao agente que ela carregou. O `agente:api` recusa, com `status: 0`, um pedido em nome de outro agente.
- A navegação fica restrita a `file://` dentro da pasta da interface. `window.open` é sempre negado.
- Os cards do Actions e do Oráculo leem o Oráculo pelo `agente:api` (`/v1/actions/resumo` e `/v1/oraculo/resumo`). Se o agente não está instalado, o card aparece apagado com "instalar", nunca com erro (§2). O clique do "instalar" chega no plano 5.

**Tecnologia:** Node ≥ 24 (`node:test`, `node:http`), Electron 33.4.11 próprio da ilha, CommonJS no lado da ilha (testado por `createRequire`).

**Desenho:** [Casa única](../specs/2026-11-04-casa-unica-tres-agentes-design.md) §2 e §3.4; [plano mestre da F2](2026-11-09-f2-casa-instalavel.md), linha 4b.

**Fora daqui:**
- **Plano 5:** a pilha antiga da visita das 7h (`pontos.js`, `mesa.js`, `escrita.js`, `projetos.js`, `execucoes.js`, `scripts/omni-actions*.mjs`), que só sai quando o executor registrar a `actions-visita` do Oráculo; o clique do "instalar"; e a guarda contra dois `servir` na mesma casa.
- **Plano 4c:** o card do WhatsApp com pareamento duplo.
- **F4:** o Overcore segue pelo caminho antigo (`overcore.js` → `scripts/omni-overcore.mjs`) até a F4 registrá-lo na casa.

**Consequência aceita:** nesta máquina, até o plano 6 instalar o Oráculo na casa real, os cards do Actions e do Oráculo ficam apagados. A visita das 7h segue funcionando pela pilha antiga.

---

## Arquivos

| Arquivo | Papel |
|---|---|
| `runtime/casa/loja-nucleo.mjs` | + `listarInterfaces(db)`: instalados (menos o omni) com `interface`, versão e divergência |
| `runtime/casa/api-omni.mjs` | + `GET /v1/agentes` (opção `interfaces`), só para a ilha |
| `runtime/servir.mjs` | liga `interfaces` com o estado do supervisor |
| `apps/omni-ilha/cofre.js` | exporta `SONDA` e `falhaDaSonda` para o `casa-servir.js` |
| `apps/omni-ilha/casa-servir.js` (novo) | sobe o `servir` com o Node do sistema, guarda o token e expõe `chamar` |
| `apps/omni-ilha/agente-api.js` (novo) | valida o pedido do `agente:api`, prende a janela ao agente e repassa ao chamar |
| `apps/omni-ilha/agentes.js` (novo) | monta a lista de painéis (contenção de caminho, conhecidos ausentes) e a política de navegação |
| `apps/omni-ilha/main.js` | janela de agente, `agente:api`, cards pelo `agente:api`, `abrir-actions` → painel do Oráculo; sai a janela Actions local |
| `apps/omni-ilha/renderer.js`, `index.html` | card apagado com "instalar" |
| `apps/omni-ilha/package.json`, `package-lock.json`, `iniciar.ps1` | Electron 33.4.11 próprio |
| removidos | `apps/omni-ilha/actions.html`, `actions.js`, `actions-preload.js`, `oracle.js`, `scripts/omni-actions-despachar.mjs`, subcomando `execucao` do `scripts/omni-actions.mjs` |
| testes | `casa-loja-nucleo`, `casa-api-omni`, `casa-servir` (estendidos); `ilha-casa-servir`, `ilha-agente-api`, `ilha-agentes` (novos); `actions-organizador` (sai o teste do `execucao`) |

---

### Tarefa 1: `listarInterfaces` no núcleo

**Arquivos:** `runtime/casa/loja-nucleo.mjs`; teste em `testes/casa-loja-nucleo.test.mjs`.

- [x] **Teste vermelho:**

```js
test('listarInterfaces entrega os instalados com interface, sem o omni, com versão e divergência', () => {
  comNucleo((db) => {
    const semTela = { ...minimo(), agente: 'semtela', executor: { comando: 'node s.mjs', modos: ['servir'] } }
    const omni = { ...minimo(), agente: 'omni', interface: { modulo: 'x.html' } }
    for (const m of [completo(), semTela, omni]) registrarAgente(db, bytes(m), { ...OPCOES, raiz: RAIZ })
    assert.deepEqual(listarInterfaces(db, { maquina: 'pc' }), [
      { agente: 'exemplo', versao: '0.3.0', raiz: RAIZ, modulo: 'interface/index.html', preload: 'interface/preload.js', painel: 'Exemplo', divergente: false }
    ])
    assert.deepEqual(listarInterfaces(db, { maquina: 'outra' }), [])
    registrarAgente(db, bytes({ ...completo(), versao: '0.4.0' }), { ...OPCOES, maquina: 'outra', raiz: RAIZ, agora: 't1' })
    assert.equal(listarInterfaces(db, { maquina: 'pc' })[0].divergente, true)
  })
})
```

- [x] Rodar `node --test testes/casa-loja-nucleo.test.mjs`: falha com `listarInterfaces is not a function`.
- [x] **Implementação:** a mesma consulta do `listarServidores`; `flatMap` só com `manifesto.interface`; `preload` e `painel` viram `null` quando faltam; a versão vem da instalação (`i.versao_agente`).
- [x] Verde lido.

### Tarefa 2: `GET /v1/agentes`

**Arquivos:** `runtime/casa/api-omni.mjs`; `runtime/servir.mjs`; testes em `testes/casa-api-omni.test.mjs` e `testes/casa-servir.test.mjs`.

- [x] **Testes vermelhos (api):**
  - Com a opção `interfaces: () => [{ agente: 'exemplo', estado: 'no-ar' }]`, `GET /v1/agentes` com o token da ilha → 200 `{ ok: true, agentes: [...] }`.
  - `POST /v1/agentes` → 405 com `allow: GET`.
  - O token dos agentes → 403.
  - Sem a opção, a rota responde `{ ok: true, agentes: [] }`.
- [x] **Teste vermelho (servir):** o teste que já registra um agente com `interface` e o sobe pelo supervisor também lê `GET /v1/agentes`. Ele espera `agente`, `versao`, `raiz`, `modulo`, `estado: 'no-ar'` e a porta do supervisor ausente da resposta (a ilha não fala direto com o agente).
- [x] **Implementação:**
  - `criarApiOmni({ interfaces = () => [] })`;
  - rota `/v1/agentes` antes do 404;
  - no `servir`, `listarInterfaces` lido uma vez na subida, junto com o `listarServidores`;
  - `interfaces: () => lista.map((i) => ({ ...i, estado: estadoDe(i.agente) }))`, com `estadoDe` = `supervisor.estado().find(...)?.estado ?? 'sem-servir'`.
- [x] Verde lido nos dois arquivos. Resultado: 62/62 no núcleo, 16/16 na API, 88/88 com o servir; typecheck limpo.

### Tarefa 3: a ilha sobe a casa (`casa-servir.js`)

**Arquivos:** `apps/omni-ilha/cofre.js` (exporta `SONDA`, `falhaDaSonda`); `apps/omni-ilha/casa-servir.js`; teste `testes/ilha-casa-servir.test.mjs`.

Contrato: `criarCasa({ spawn, env, raiz, limiteMs })` → `{ iniciar(), chamar(metodo, rota, corpo), parar(), estado() }`.
- `iniciar()` roda a sonda do Node (`OMNI_NODE` ou `node`, com `ELECTRON_RUN_AS_NODE=1` só na sonda). Depois sobe `node --disable-warning=ExperimentalWarning <raiz>/runtime/servir.mjs --porta 0` com `stdio: ['pipe','pipe','pipe']`, `windowsHide`, o env sem `ELECTRON_RUN_AS_NODE` e com `OMNI_API_TOKEN`. Lê a 1ª linha e resolve `{ ok: true, porta }` ou `{ ok: false, erro }`.
- `iniciar()` é memoizado; falha ou saída do filho limpa a memória, e o próximo `chamar` tenta de novo.
- `chamar` faz HTTP em `127.0.0.1:<porta>` com `Bearer <token>` e devolve `{ status, corpo }`. Casa fora do ar vira `{ status: 0, corpo: { ok: false, erro } }`.
- `parar()` fecha o stdin e espera a saída por até 5 s (depois, `kill`).
- `estado()` → `{ porta, pid, erro }`, sem token.

- [x] **Testes vermelhos:**
  1. Casa de verdade em pasta temporária (`OMNI_NODE=process.execPath`, `OMNI_HOME` e `OMNI_CASA_BANCO` temporários): `chamar('GET','/v1/saude')` sobe sozinho e devolve 200 com `agente: 'omni'`; `estado()` não traz o token; `parar()` → o filho sai 0.
  2. Spawn falso com a sonda respondendo Electron: `iniciar()` → `{ ok: false }` com "Electron"; o `servir` nunca é chamado; `chamar` → `status: 0`.
  3. Spawn falso com a 1ª linha `{"ok":false,"erro":"omni.db indisponível"}`: `iniciar()` → `{ ok: false, erro: 'omni.db indisponível' }`; uma 2ª chamada sobe de novo (duas subidas contadas).
  4. O env do `servir` não tem `ELECTRON_RUN_AS_NODE`; o da sonda tem.
- [x] Implementação e verde lido. Resultado: 6/6 em `ilha-casa-servir`, 10/10 no cofre; 7 mutantes, 7 mortos pela asserção.

### Tarefa 4: `agente-api.js` e `agentes.js`

**Arquivos:** `apps/omni-ilha/agente-api.js`, `apps/omni-ilha/agentes.js`; testes `testes/ilha-agente-api.test.mjs` e `testes/ilha-agentes.test.mjs`.

`criarAgenteApi({ chamar })` → `pedir(entrada, { permitido })`:
- `entrada` precisa ser objeto, com `agente` em `/^[a-z][a-z0-9-]{0,39}$/`, `metodo` em `GET|POST|PATCH|PUT|DELETE` e `rota` em texto que começa com `/` e tem até 2048 caracteres.
- `entrada.agente !== permitido` → `{ status: 0, corpo: { ok: false, erro } }`, sem tráfego.
- `corpo` `null`/`undefined` não vai. Fora isso, precisa ser objeto JSON de até 60 KB.
- O pedido vai como `POST /v1/agentes/<agente>/chamar` com `{ metodo, rota, corpo? }`. O 200 devolve o `{ status, corpo }` do agente. Qualquer outro status vira `status: 0` com o `erro` do Omni.

`agentes.js`:
- `CONHECIDOS = [{ agente: 'oraculo', nome: 'Oráculo' }]`.
- `montarAgentes(lista, { existe })`:
  - resolve `modulo` e `preload` contra a `raiz`, e recusa o que sai dela (`path.relative` com `..` ou absoluto) ou não existe;
  - divergente não monta;
  - cada conhecido que falta vira `{ agente, nome, instalado: false }`.
- `podeNavegar(url, pasta)`: só `file:` cujo caminho fica dentro da `pasta`.

- [x] **Testes vermelhos (agente-api):** pedido certo → POST no chamar com corpo sem `null`; agente de outra janela → status 0 sem chamar; método e rota inválidos → status 0; corpo grande → status 0; Omni 503 → status 0 com o erro; resposta 200 → `{ status, corpo }` do agente.
- [x] **Testes vermelhos (agentes):** contenção (`../fora.html`, absoluto, inexistente), divergente, conhecido ausente, `podeNavegar` (dentro, subpasta, fora, `https:`, `file:` com `..` codificado).
- [x] Implementação e verde lido. Resultado: 9/9; 16 mutantes, 16 mortos (três precisaram de caso novo: outro drive, painel na rede e 403 da casa com corpo de cara boa).

### Tarefa 5: o main da ilha passa a falar só com a casa

**Arquivos:** `apps/omni-ilha/main.js`, `preload.js`, `renderer.js`, `index.html`.

- [x] Sobe a casa no `whenReady` (`criarCasa`), com `parar()` no `will-quit`. Também sai pelo stdin quando a ilha morre.
- [x] `abrirAgente(agente, pagina)`: uma janela por agente, com o `preload` do agente (sandbox, contextIsolation), `loadFile(modulo)` ou de uma página dentro da pasta do agente, `will-navigate`/`will-redirect` pela `podeNavegar`, `setWindowOpenHandler` negado e o mapa `webContents.id → agente` para o `agente:api`.
- [x] `ipcMain.handle('agente:api', …)`: o `permitido` sai do mapa da janela que pediu, só do quadro principal, e janela desconhecida dá `status: 0`.
- [x] `oracle:resumo` → `GET /v1/oraculo/resumo`; `actions:resumo` → `GET /v1/actions/resumo`, ambos com `permitido: 'oraculo'` (em `paineis.js`). Agente não instalado vira `{ ausente: true }`. Casa fora ou erro do agente vira `ok: false` com o motivo, nunca `ausente`.
- [x] `abrir-actions` → `abrirAgente('oraculo', 'actions/actions.html')` (o depósito do Oráculo é página, não aba); a cabeça do card do Oráculo abre o painel por `abrir-oraculo`. Sem Oráculo instalado, nada abre.
- [x] Saem os `require` de `pontos`, `mesa`, `escrita`, `execucoes` e `oracle`, os `actions:*` da janela local, o `despachar` e o `abrirActions` antigo. O gancho de teste troca `janelaActions` por `janelaAgente(agente)` e passa a receber `casa`, `paineis` e `abrirAgente`.
- [x] Renderer: com `ausente`, os cards ganham a classe `ausente`, mostram "INSTALAR" no rótulo e "–" no número, e o clique não abre nada; casa fora mostra "FORA DO AR" com o motivo. O CSS do `.ausente` usa `opacity` e o cursor padrão.
  Resultado: `ilha-paineis` 7/7 (mutantes: três sobreviventes viraram caso novo ou linha apagada); ilha + organizador 73/73; fumaça no Electron escondido com casa vazia: casa sobe, os dois resumos `ausente`, `abrirAgente('oraculo')` falso sem janela, pedido sem dono recusado, saída 0.

### Tarefa 6: retirada do que ficou sem dono

- [x] Apagar `apps/omni-ilha/actions.html`, `actions.js`, `actions-preload.js`, `oracle.js` e `scripts/omni-actions-despachar.mjs`.
- [x] Tirar o subcomando `execucao` (e a linha do uso) do `scripts/omni-actions.mjs`, e o teste "sessão executora devolve pelo script" do `testes/actions-organizador.test.mjs`.
- [x] README da ilha: a seção do Actions passa a dizer que a janela é o painel do Oráculo pela casa.
- [x] `grep` sem referência viva a nenhum dos removidos.
  Resultado: sobra só histórico (planos, spec, `releases.json`) e o `actions-preload.js` do próprio Oráculo nos testes; o comentário do `execucoes.js` passa a dizer que ele fica só para o `mesa.js` até o plano 5. As mãos da casa (`maos-actions.mjs`) rodam o script do Oráculo, não este, então o `execucao` do Oráculo segue vivo. Ilha + organizador + mãos 81/81; fumaça repetida, saída 0.

### Tarefa 7: Electron próprio

- [x] `apps/omni-ilha/package.json`: `devDependencies: { "electron": "33.4.11" }` e `start: "electron ."`. O `package-lock.json` sai por `npm install` dentro de `apps/omni-ilha`, com o zip do cache.
- [x] `iniciar.ps1` aponta para `node_modules\electron\dist\electron.exe` da própria pasta e, se faltar, avisa com `npm ci`.
- [x] Conferir que o CI não toca `apps/` (o `npm ci` roda só na raiz) e que `node_modules/` está no `.gitignore`.
  Resultado: achado no caminho. No Node 24 o postinstall do electron 33 (`extract-zip`) sai com 0 em 1 s e deixa a `dist` só com o `LICENSES`; o zip baixado fica no cache. O `iniciar.ps1` passou a completar a extração pelo `tar.exe` (dist + `path.txt`, igual ao `install.js`) e ganhou `-SoPreparar`, que o instalador do plano 6 usa. Teste no rascunho com cache falso (`electron_config_cache`): 4/4, o velho 0/4 pela asserção, dois mutantes mortos (sem `path.txt`, sem `-SoPreparar`). O `electron.exe` extraído tem o mesmo hash do desktop. Fumaça com o binário próprio: saída 0. Raiz sem `workspaces`, `apps/` fora do `payloadRoots` da integridade, lock só no `registry.npmjs.org`. O README do `motor/` perdeu o caminho pessoal.

### Tarefa 8: prova de bancada com o Oráculo de verdade

Script no rascunho da sessão, nunca no repo, no molde da prova do 4a:
- uma casa temporária com a cópia do Oráculo (`f3/lote-d`), registrada e com os tokens;
- o Electron próprio com `OMNI_ILHA_ESCONDIDA=1` e `OMNI_ILHA_TESTE`.

- [x] A ilha sobe o `servir`, e o `GET /v1/agentes` lista o oraculo com o `modulo` dentro da raiz.
- [x] `abrirAgente('oraculo')` carrega `interface/index.html`, e o `window.oraculo.saude()` do painel volta 200.
- [x] O resumo do card (`actions:resumo` e `oracle:resumo`) chega com os números do Oráculo.
- [x] A navegação para `actions/actions.html` passa, e para fora da pasta é barrada.
- [x] Um pedido em nome de outro agente vindo da janela do oraculo dá `status: 0`.
- [x] Sem Oráculo registrado, os dois cards voltam `ausente`.
- [x] Nenhum token no log da ilha nem no do `servir`.
  Resultado (10/11): Oráculo `d3d4050` por `git archive`, ilha com o Electron próprio, 16 OK e 0 FALHOU, saída 0.
  - Lista: `interface\index.html` e o preload `interface\actions\actions-preload.js`, ambos dentro da raiz.
  - Resumos: Actions com 1 ponto e Oráculo com 5 projetos.
  - Janela: `saude()` volta 0.3.0 (migração 0005); o renderer não vê `require` nem `ipcRenderer`.
  - Navegação: `actions/actions.html` lista o ponto. O `location.href` para `win.ini` e o `abrirAgente('..\\..\\package.json')` deixam a página onde estava.
  - Porteiro: em nome do overcore volta 0 ("esta janela só fala com o próprio agente"); sem dono, 0; o próprio, 200.
  - Casa vazia (fumaça do T5 de novo): os dois cards voltam `ausente`, `abrirAgente` volta false e não abre janela.
  - Tokens: tela e visita não aparecem na saída da ilha nem nos 10 arquivos de texto da prova. A saída da ilha também não tem nada com a forma do token dela (43 base64url). O stderr do `servir` a ilha descarta sem guardar; o log dele foi conferido limpo na prova do 4a.

### Tarefa 9: release 0.30.0

- [ ] Suíte inteira (`npm test`) em segundo plano, lida até o total; `dist` sem ruído.
- [ ] Bump 0.29.0 → 0.30.0: `plugin.json`, `package.json`, `package-lock.json`, `releases.json` e `integridade.json`.
- [ ] Commit Weriton-DataOps, PR, CI verde, merge (`--merge --match-head-commit`), atualizar o plugin instalado, verificar a release instalada e subir o `servir` instalado na casa real (seco).
- [ ] Linha 4b do mestre marcada como entregue.
