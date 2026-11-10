# F2, plano 4a: `chamar`, carteiro e mãos do Actions

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use superpowers:executing-plans. Os passos usam caixas (`- [ ]`). Cada tarefa é TDD: o teste nasce vermelho pela asserção, o código o deixa verde, e o commit só sai depois do verde lido.

**Objetivo:** o `servir` do Omni passa a falar com os agentes em nome da ilha (`POST /v1/agentes/:agente/chamar`) e a entregar à sessão do VS Code o trabalho que a fila do Actions, no Oráculo, manda (o carteiro). A sessão devolve o estado pelas mãos do Actions, sem ver token.

**Arquitetura:**
- Os tokens `tela` e `visita` de cada agente nascem no Omni e moram no `cofre.db` (`api/<agente>/tela` e `api/<agente>/visita`, tipo `token`, autorizado só o agente `omni`). O agente recebe só o sha256, pelo `instalar --stdin` dele (o executor do plano 5 faz isso).
- O `servir` abre cada token uma vez, quando precisa, e o guarda na memória até sair. Cada abertura vira uma linha em `usos` no cofre.
- O `chamar` confere a rota contra o `interface.rotas` do `agente.json` (método, padrão e escopo) antes de pôr o token. Recusa volta com `status: 0`, o contrato do IPC `agente:api`.
- A API do Omni passa a ter dois tokens: o da ilha (`OMNI_API_TOKEN`, vale tudo) e o dos agentes (aleatório, só na memória). O dos agentes só toca a campainha e lê a saúde: um agente não chama outro agente pela porta do Omni.
- O carteiro acorda pela campainha, ao subir e a cada 60 s. Ele lê a fila do agente (a verdade), e para cada execução escolhe a sessão, `assumir` (409 = outro levou), entrega e registra o recibo em `despachos`.
- `apps/` não entra na release (as raízes são adaptadores, contratos, dist, hooks, runtime, scripts e skills). As peças puras do despachante da ilha (`escolherDestino`, `montarPedido`, `sessoesVivas`) mudam para `runtime/casa/`; o despachante antigo e o `execucoes.js` local saem no plano 4b, quando a ilha passa a usar o painel do Oráculo.

**Tecnologia:** Node ≥ 24 (`node:sqlite`, `node:http`, `node:test`), a ponte DPAPI do F1 (`runtime/casa/dpapi.mjs`), o `claude.exe -p` só com `Read`, `SendMessage` e `ListAgents` para a entrega (o mesmo caminho provado em 28/09).

**Contratos usados (05/11, memória `contratos-casa-f2-f3`, conferidos no Oráculo `f3/lote-d` `d3d4050`):**
- leitura do Oráculo devolve o objeto cru; escrita devolve `{ok, dados}`;
- `GET /v1/actions/execucoes?estado=pendente` → `{execucoes}` (pendente = `na fila`, a mais antiga primeiro);
- `GET /v1/actions/execucoes/:id` → a execução (`{id, slug, projeto, instrucao, estado, destino, eventos, ...}`, forma da ilha);
- `GET /v1/projetos` → `{arquivo, projetos}`; `GET /v1/actions/pontos/:slug` → o ponto com `texto`;
- `POST /v1/actions/execucoes/:id/assumir {sessao}` (visita) → 200 `{ok, dados:{id, estado:'enviada', destino}}`, 409 se não está `na fila`;
- `POST /v1/actions/execucoes/:id/estado {estado, nota, destino?}` (visita);
- `scripts/actions/omni-actions.mjs` do Oráculo lê `ORACULO_API` e `ORACULO_TOKEN` (visita) e tem `execucao <id> --estado ... --nota ...` e `ponto <slug>`.

---

## Arquivos

| Arquivo | Papel |
|---|---|
| `runtime/casa/credenciais-agente.mjs` (novo) | gera e guarda os tokens do agente; devolve o sha256; abre o token para o `servir` |
| `runtime/casa/chamar-agente.mjs` (novo) | confere a rota no manifesto e chama o agente em 127.0.0.1 |
| `runtime/casa/loja-nucleo.mjs` | `listarServidores` devolve também `rotas` |
| `runtime/casa/api-omni.mjs` | dois tokens; rota `POST /v1/agentes/:agente/chamar`; `aoDespachar` depois do recibo |
| `runtime/casa/loja-despachos.mjs` | `marcarDespacho` (o carteiro anota o destino do recibo) |
| `runtime/casa/sessoes-vivas.mjs` (novo) | porte do `registroDeSessoes`/`sessoesVivas` da ilha |
| `runtime/casa/pedido-execucao.mjs` (novo) | porte do `escolherDestino`/`montarPedido`, devolvendo pelas mãos do Actions |
| `runtime/casa/entregar-sessao.mjs` (novo) | porte do `entregar` do despachante (claude.exe -p, Read + SendMessage) |
| `runtime/casa/carteiro.mjs` (novo) | a rodada: fila → destino → assumir → entregar → recibo |
| `runtime/casa/supervisor.mjs` | `aoMudar` para o `servir` regravar o `servir.json` |
| `runtime/maos-actions.mjs` (novo) | a sessão executora devolve por aqui: porta do `servir.json`, token visita do cofre, roda o script do Oráculo |
| `runtime/servir.mjs` | liga tudo: tokens, chamador, carteiro, `servir.json` |
| `testes/fixtures/agente-falso.mjs` | modo `actions`: serve a fila com conferência de token e escopo |

## Tarefas

### T1. Tokens do agente no cofre

`runtime/casa/credenciais-agente.mjs`:
- `PAPEIS = ['tela', 'visita']`, `nomeDoToken(agente, papel)` → `api/<agente>/<papel>`.
- `garantirTokensDoAgente(db, ponte, agente, {gerar, maquina, agora})` → `{tela, visita, novos}`: cria o que falta (32 bytes aleatórios em base64url, tipo `token`, `agentes: ['omni']`, serviço `API do <agente>`), e para o que já existe abre e calcula o sha256. Nunca devolve o valor. Agente fora do formato, `omni` ou `dono` → `TypeError`.
- `tokenDoAgente(db, ponte, agente, papel, motivo, opcoes)` → texto, via `usarCredencial` com agente `omni`; zera o `Buffer` depois de converter.

Testes (`testes/casa-credenciais-agente.test.mjs`, ponte falsa do `casa-loja-cofre.test.mjs`):
- [x] cria os dois na 1ª vez (`novos` = os dois), devolve sha256 hex de 64 e diferentes entre si; a 2ª chamada não cria nada e devolve os mesmos sha256;
- [x] o sha256 devolvido é o do valor que o `tokenDoAgente` abre; cada abertura grava um uso `entregue` para o agente `omni`;
- [x] a credencial guardada não autoriza outro agente (`usarCredencial` com `oraculo` → `agente-sem-acesso`);
- [x] agente `omni`, `dono` ou `Oráculo` → `TypeError`; papel fora da lista → `TypeError`.

### T2. `chamar`: rota conferida no manifesto

`listarServidores` devolve `rotas` (o `interface.rotas` do manifesto, `[]` sem interface).

`runtime/casa/chamar-agente.mjs`:
- `rotaDeclarada(rotas, metodo, caminho)` → a rota do manifesto que casa (método igual e `new RegExp(padrao)` no caminho sem a query) ou `null`.
- `ROTA = /^\/v1\/[A-Za-z0-9._~%\/-]*(\?[A-Za-z0-9._~%=&-]*)?$/`, e mais duas recusas: `..` e `//` no caminho.
- `criarChamador({ servidores, token, limiteMs = 10_000, limiteResposta = 4 MiB })`:
  - `servidores()` → `[{agente, porta, rotas}]` só dos que estão no ar;
  - `token(agente, papel)` → texto (pode lançar);
  - devolve `chamar(agente, metodo, rota, corpo, {papel = 'tela'})` → `Promise<{status, corpo}>`.
- Recusas com `status: 0` e `corpo: {ok:false, erro}`: agente fora do ar ou desconhecido; rota fora do formato; rota não declarada; escopo da rota diferente do papel (rota `qualquer` aceita os dois); token indisponível; sem resposta no prazo; resposta acima do limite; conexão recusada.
- Chama `http://127.0.0.1:<porta><rota>` com `Host: 127.0.0.1:<porta>`, `Bearer`, `connection: close`, JSON quando há corpo. A resposta volta como `{status, corpo}`, com o JSON lido ou `null`.

Testes (`testes/casa-chamar-agente.test.mjs`, servidor http de verdade na porta 0 que anota o que recebeu):
- [x] GET declarado `qualquer` vai com o token tela; POST `visita` com `papel: 'visita'` vai com o token visita e o corpo JSON;
- [x] POST `visita` pedido com papel tela → status 0, o servidor não recebe nada;
- [x] rota não declarada, método diferente, `..`, `//`, sem `/v1/` → status 0 sem tráfego;
- [x] agente fora do ar → status 0; token que lança → status 0 sem vazar a mensagem do cofre;
- [x] servidor que não responde → status 0 no prazo; resposta grande → status 0;
- [x] a query passa (`?estado=pendente`) e o padrão confere só o caminho.

### T3. API do Omni: dois tokens e `POST /v1/agentes/:agente/chamar`

`criarApiOmni({ ..., tokenAgentes, chamar, aoDespachar })`:
- token da ilha: todas as rotas; token dos agentes: só `GET /v1/saude` e `POST /v1/despachos`; qualquer outra rota com ele → 403;
- `POST /v1/agentes/:agente/chamar {metodo, rota, corpo}` → 200 `{status, corpo}` com o que o `chamar(agente, metodo, rota, corpo, {papel:'tela'})` devolveu; corpo sem `metodo`/`rota` texto → 400; método diferente de POST → 405; agente fora do formato → 404;
- depois do recibo da campainha, `aoDespachar({agente, execucao, novo})` (erro dele vai para a degradação e não muda o 202).

Testes (`testes/casa-api-omni.test.mjs`, novos casos):
- [x] token dos agentes: saúde 200, campainha 202, `chamar` 403;
- [x] token da ilha no `chamar` repassa agente, método, rota e corpo, papel `tela`, e devolve `{status, corpo}`;
- [x] corpo inválido 400; GET no `chamar` 405;
- [x] a campainha chama `aoDespachar` com o recibo; `aoDespachar` que lança não muda o 202.

### T4. Recibo do carteiro

`marcarDespacho(db, {agente, execucao, estado, detalhe}, {maquina, agora})`: upsert pelo id `agente/execucao`; estado da lista; `detalhe` até 300 (cortado); `tentativas + 1` a cada marca; devolve a linha.

Testes (`testes/casa-loja-despachos.test.mjs`):
- [x] marca recibo existente (estado, detalhe, tentativas 1) e cria o que não existia (o carteiro achou na fila sem campainha);
- [x] estado fora da lista → `DespachoError`; detalhe longo é cortado em 300.

### T5. Peças puras do carteiro

`runtime/casa/sessoes-vivas.mjs`: `sessoesVivas({pasta = ~/.claude/sessions, vivo})` → as interativas com processo vivo, forma `{sessionId, nome, cwd, status, pid, kind, startedAt}`.

`runtime/casa/pedido-execucao.mjs`:
- `escolherDestino(sessoes, {pastaProjeto, pastaActions, pastaOmni, excluir})`: porte literal;
- `montarPedido(ex, {projeto, ponto, maos, resposta})`: porte, com duas trocas: o ponto se lê por `node "<maos>" ponto <slug>` (ele mora no banco do Oráculo), e a devolução é `node "<maos>" execucao <id> --estado ...`.

Testes (`testes/casa-pedido-execucao.test.mjs`): os dois testes da ilha (`actions-organizador.test.mjs`) portados, mais um registro falso de sessões (pid vivo, pid morto, arquivo meio escrito, sessão não interativa).

### T6. Entrega à sessão

`runtime/casa/entregar-sessao.mjs`: `entregar(nome, arquivoPedido, {claude, pastaPedidos, cwd, limiteMs = 10 min, iniciar = spawn, env})` → `{ok}` ou `{ok:false, motivo}`. A ordem vai pelo stdin; ENVIADO sem FALHOU é sucesso; tira `ELECTRON_RUN_AS_NODE` do ambiente do filho; passou do prazo mata a árvore (`taskkill /T /F`).

Testes (`testes/casa-entregar-sessao.test.mjs`, `claude` falso em `testes/fixtures/claude-falso.mjs`): ENVIADO → ok; FALHOU → motivo; saída vazia → motivo; prazo curto → `passou de`; a ordem recebida cita o arquivo e o nome; o filho não vê `ELECTRON_RUN_AS_NODE`.

### T7. O carteiro

`criarCarteiro({ chamar, agentes, sessoes, entregar, gravarPedido, marcar, maos, pastaActions, pastaOmni, log, intervaloMs = 60_000 })`:
- `agentes()` → nomes dos agentes com fila (o manifesto declara `POST /v1/actions/execucoes/<id>/assumir` com escopo `visita`: `temFila(rotas)` usa o `rotaDeclarada`);
- `tocar(agente)`: agenda uma rodada; rodada em curso → marca para repetir uma vez ao fim (nunca duas em paralelo para o mesmo agente);
- `iniciar()`: varre todos agora e a cada `intervaloMs` (timer `unref`); `parar()`: para o timer e espera a rodada em curso;
- rodada: `GET /v1/actions/execucoes?estado=pendente` (papel visita); a mesa uma vez por rodada (`GET /v1/actions/mesa`: `raiz` é a pasta do Actions e `projetos` os do `projetos.md`, com pasta, fase, dor e itens; o `/v1/projetos` é o registro do Oráculo, outra coisa); para cada uma, `GET` da execução (fora da fila → recibo `recusado`, sem tocar), projeto pelo nome sem caixa, ponto (`GET /v1/actions/pontos/:slug`, `null` se não 200), resposta (o último evento com `resposta`, só quando já houve destino);
- destino: a mesma sessão do `destino.nome` se viva, senão `escolherDestino`; sem destino → `POST estado {estado:'sem sessão', nota}` e recibo `falhou` com o detalhe;
- `assumir {sessao: nome}`: 409 → recibo `recusado` (outra mão levou); outro erro → recibo `falhou`;
- 200 → `gravarPedido(id, texto)` → `entregar(nome, arquivo)`; ok → `POST estado {estado:'enviada', nota:'entregue a X (motivo)', destino:{nome, cwd, motivo}}` e recibo `assumido`; falha → `POST estado {estado:'falhou', nota}` e recibo `falhou`;
- exceção em uma execução não derruba a rodada: vira log e recibo `falhou`.

Testes (`testes/casa-carteiro.test.mjs`, `chamar` falso em memória que imita a fila do Oráculo):
- [x] fila com uma: escolhe a sessão da pasta do projeto, assume, entrega com o pedido gravado, marca `enviada` e recibo `assumido`;
- [x] sem sessão viva → `sem sessão`, sem `assumir`, recibo `falhou`;
- [x] 409 no assumir → nada é entregue, recibo `recusado`;
- [x] entrega falha → `falhou` com o motivo;
- [x] resposta a execução já entregue volta para a mesma sessão, com o pedido "Resposta do Weriton";
- [x] dois toques durante a rodada viram uma repetição só; `parar` espera a rodada;
- [x] agente sem a rota de assumir fica fora de `agentes()`.

### T8. Mãos do Actions

`runtime/casa/supervisor.mjs`: `aoMudar()` opcional, chamado quando um agente entra no ar ou sai dele.

`runtime/servir.mjs` grava `<pasta do banco>/servir.json` = `{pid, porta, agentes:[{agente, porta}]}` (sem token) ao subir e a cada `aoMudar`, e apaga ao sair.

`runtime/maos-actions.mjs <comando> [argumentos]`:
- o Actions mora no agente `oraculo`; a raiz vem do `nucleo.db` (`listarServidores`), a porta do `servir.json` (pid vivo), o token visita do cofre (`tokenDoAgente`, motivo `mãos do Actions: <comando>`);
- roda `<raiz>/scripts/actions/omni-actions.mjs` com o Node atual, `ORACULO_API=http://127.0.0.1:<porta>/v1` e `ORACULO_TOKEN` no ambiente, stdio herdado, e sai com o código dele;
- sem `servir.json`, pid morto, agente sem porta, script ausente ou cofre sem token → `{"ok":false,"erro":...}` no stdout e saída 1. O token nunca aparece em saída nem em erro.

Testes (`testes/casa-maos-actions.test.mjs`, `rodarMaos(argv, {env, ponte, iniciar})` no mesmo processo, script falso do Oráculo que imprime os argumentos e se recebeu token):
- [x] passa os argumentos, `ORACULO_API` com a porta do `servir.json` e o token visita certo;
- [x] cada falha da lista acima dá `ok:false` e saída 1, sem token na saída.

### T9. O `servir` liga tudo

`rodarServir(argv, {..., ponte})`:
- `tokenAgentes` aleatório para o supervisor (no lugar do token da ilha);
- `token(agente, papel)` abre do cofre uma vez (memória por agente e papel); ponte DPAPI preguiçosa;
- `chamar` com `servidores()` vindo do `supervisor.estado()` mais as `rotas` do núcleo;
- carteiro com `marcar` no `omni.db`, pedidos em `<OMNI_HOME>/actions/pedidos`, entrega real (`entregar-sessao`) a não ser que `OMNI_CARTEIRO=seco` (aí grava o pedido e não entrega; usado na prova);
- campainha → `carteiro.tocar(agente)`; ao parar, `carteiro.parar()` antes do supervisor.

Testes (`testes/casa-servir.test.mjs`, novos casos no mesmo processo com ponte falsa e o agente falso no modo `actions`):
- [x] o agente sobe com o token dos agentes, não com o da ilha; a campainha dele dá 202 e o `chamar` dele dá 403;
- [x] a ilha chama `GET /v1/actions/execucoes` do agente pelo `chamar` e recebe a fila; o agente falso viu o token tela;
- [x] com `OMNI_CARTEIRO=seco`, a campainha faz o carteiro assumir com o token visita e gravar o pedido; o recibo fica `assumido`;
- [x] o `servir.json` aparece com a porta do agente e some ao sair.

### T10. Prova, release 0.29.0 e instalação

- [ ] Mutantes: um por regra que protege (escopo do papel, rota não declarada, token dos agentes no `chamar`, 409 vira `recusado`, `aoMudar`). Cada um tem de morrer pela asserção.
- [ ] Prova com o Oráculo de verdade (cópia do `f3/lote-d`, banco temporário):
  - instala os sha256 dos tokens gerados pelo `garantirTokensDoAgente` com o `instalar --stdin` dele;
  - sobe o `servir` do Omni numa casa temporária (`OMNI_CARTEIRO=seco`), cria uma execução pela rota tela do Oráculo através do `chamar` e confere que o carteiro assumiu, que o pedido foi gravado e que o `maos-actions.mjs execucao <id> --estado concluida` mudou o estado no Oráculo.
  - Nenhuma entrega a sessão real.
- [ ] `npm run check` e `npm test` verdes lidos; release 0.29.0 (bump com as notas); PR; merge com CI verde; instalação e verificação da 0.29.0; `servir` instalado sobe na casa real e responde saúde.

## Fora deste plano (4b)

Electron próprio da ilha, IPC `agente:api` → `POST /v1/agentes/:agente/chamar`, painéis pelo `interface` do manifesto, `oracle:resumo` pelo `agente:api`, retirada do despachante antigo e do `execucoes.js` local, card do WhatsApp com pareamento duplo e fumaça em Electron de verdade.
