# F2: a casa instalável — plano mestre

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar cada sub-plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** instalar o Omni do zero numa máquina limpa com um executor e trazer os dados desta máquina com 100% de contagem e hash. O Omni passa a ter um banco só (SQLite), e o Postgres 5433 sai de cena.

**Arquitetura:**
- Decisão 8 fechada em 09/11/2026: "faça o recomendado para o banco, manter só o sqlite". Missões e livro de aprendizado vão para o `omni.db`, e o espelho da memória morre, porque a memória já mora lá.
- A API local do Omni (`omni servir`, 127.0.0.1 + token) passa a ser a dona do `omni.db` para quem não é hook. Ela supervisiona o `servir` dos agentes e serve a ilha pelo IPC `agente:api`.
- A ilha ganha Electron próprio.
- O executor `omni-instalar.ps1` instala, exporta, importa, atualiza e verifica.

**Tecnologia:** Node ≥ 24 com `node:sqlite`, `node:http` e `node:test`; Electron 33.4.11 só na ilha (ele não abre banco: §3.4); PowerShell 5.1 no executor; GitHub Releases na conta Weriton-DataOps.

**Desenho:** [Casa única](../specs/2026-11-04-casa-unica-tres-agentes-design.md), §3.4, §3.7, §4, §4.1, §4.2, §5 e §6 (linha F2). Contratos combinados com o Oráculo e o Overcore em 05/11 (memória `contratos-casa-f2-f3`).

**Situação em 09/11/2026:**
- Ramo `casa-f2`, criado de `origin/main` `ad609a2` (release 0.26.2).
- F1 inteira mesclada (PR #4). Única sobra: a parte B da T8 (Windows Hello real), que depende do PIN do Weriton.

---

## Escopo: a F2 em seis planos

| # | Plano | Desenho | Estado |
|---|---|---|---|
| 1 | [Banco único: missões e livro de aprendizado no `omni.db`, importador do 5433, fim do espelho da memória](2026-11-09-f2-plano-1-banco-unico.md) | §3.7, decisão 8 | entregue: PR #7 (`226f285`), release 0.27.0 |
| 2 | Remendo da main: a ilha chama `servicos/whatsapp/omni/saude.mjs`, `scripts/omni-overcore.mjs` e `scripts/omni-actions-despachar.mjs`, que não estão no git; os quatro `*-agendar.ps1` também não estão. Trazer, testar e versionar | — | entregue: [plano](2026-11-09-f2-plano-2-remendo-da-main.md), PR #8 (`142d7f6`), release 0.27.1 |
| 3 | API do Omni: `runtime/servir.mjs --porta <n>`, `/v1/saude`, `POST /v1/despachos` (202, idempotente pelo id, tabela `despachos` na v5 do `omni.db`) e supervisor do `servir` dos agentes. O supervisor lê o `agente.json` do `nucleo.db`, sobe `servir --porta 0`, lê a 1ª linha `{"ok":true,"porta":n}`, reinicia com backoff e trata saída 2 ou `recusa:true` como falha permanente | §3.5 regra 3, §4.2, contratos 05/11 | entregue: PR #9, release 0.28.0, [plano](2026-11-09-f2-plano-3-api-do-omni.md) |
| 4a | Lado do `servir`: tokens `tela` e `visita` de cada agente gerados no `cofre.db` (o agente recebe só o sha256), `POST /v1/agentes/:agente/chamar` com a rota conferida no `interface.rotas` do manifesto, token próprio dos agentes (só campainha e saúde), carteiro (fila do agente → sessão → `assumir` → entrega → recibo em `despachos`) e `runtime/maos-actions.mjs` para a sessão devolver o estado sem ver token. Release 0.29.0 | §3.4, §8.3, contratos 05/11 | entregue: [plano](2026-11-09-f2-plano-4a-chamar-e-carteiro.md), PR #10 (`437bff0`), release 0.29.0 |
| 4b | Ilha na casa: Electron próprio (`apps/omni-ilha/package.json` com `electron@33.4.11`), a ilha sobe o `servir` com o Node do sistema e um `OMNI_API_TOKEN` que nunca chega ao renderer, `GET /v1/agentes` (só a ilha) com a `interface` de cada agente instalado, IPC `agente:api` → `POST /v1/agentes/:agente/chamar` preso ao agente da janela, painéis montados pelo `interface` do `agente.json` com navegação só dentro da pasta da interface, cards do Actions e do Oráculo pelo `agente:api` (agente ausente vira card apagado com "instalar", nunca erro). Saem a janela Actions local (`actions.html`/`.js`/`-preload.js`), o `oracle.js`, o `scripts/omni-actions-despachar.mjs` e o subcomando `execucao` do `omni-actions.mjs`. Release 0.30.0 | §2, §3.4 | entregue: [plano](2026-11-09-f2-plano-4b-ilha-na-casa.md), PR #11 (`6197c0b`), release 0.30.0 |
| 4c | WhatsApp com pareamento duplo: pessoal primeiro, bot depois, com o QR dentro do card (modo de linhas JSON do `parear.mjs`, API falsa nos testes, nunca a sessão real) | §4.1 | [plano](2026-11-10-f2-plano-4c-pareamento-duplo.md) (o QR mora numa janela aberta pelo card: o card tem duas linhas) |
| 5 | Executor: `executor/agente.json` do Omni e `scripts/omni-instalar.ps1` com `instalar`, `importar`, `exportar`, `atualizar` e `verificar`. Exportação do `nucleo.db` e do `omni.db` por `VACUUM INTO`, com manifesto de contagem e hash por tabela; o cofre segue no pacote cifrado que já existe. Tarefas agendadas registradas pelo executor, apontando para a versão instalada (fim dos caminhos fixos em `Documents\Omni`). A visita das 7h passa a ser a `actions-visita` do manifesto do Oráculo (`lancador: omni`), e só então saem a pilha antiga da ilha (`pontos.js`, `mesa.js`, `escrita.js`, `projetos.js`, `execucoes.js`) e os `scripts/omni-actions*`. O botão "instalar" do card apagado chama o executor. Guarda contra dois `servir` na mesma casa. Workflow de release com zip e SHA | §4, §4.2 | a detalhar |
| 6 | Prova do §5 no Windows Sandbox (habilitar pede admin e reinício: decisão do Weriton na hora), instalação real neste PC com backup datado, release e desligamento do 5433: cópia datada de `runtime\postgresql-5433\data`, remoção das tarefas `OmniPostgreSQL5433` e `OmniAccessBroker` e aposentadoria do broker e dos scripts do PG. Conferência das 5 versões de credencial do Crachá contra o cofre | §5 | a detalhar |

Cada plano fecha com software funcionando, verde lido, commit Weriton-DataOps, PR, merge com CI verde e, quando muda comportamento do runtime, release.

## Medido em 09/11/2026 (não suposto)

**Postgres 5433:**
- Vivo: pid escutando em 127.0.0.1:5433, banco `omni` com 29 MB.
- Contagens: `memory.entries` 2.839, `memory.import_receipts` 19.301, `operations.missions` 1.628, `operations.mission_events` 10.580, `learning.improvement_findings` 1.236, `learning.improvement_events` 2.165, `access.credential_versions` 5 e `audit.credential_events` 3.

**O que só existe no PG:**
- o histórico de missões além das 100 sessões locais;
- o histórico do livro de aprendizado além dos 100 candidatos locais;
- os metadados das 5 versões de credencial do Crachá.

Os segredos do Crachá estão no Gerenciador de Credenciais (`Omni/UserCredential/*`), e o `inventario-windows` do cofre já pega esses alvos.

**O que é só espelho:**
- a memória, que tem como fonte a tabela `memorias` do `omni.db`;
- as missões e o aprendizado vivos, que vêm de `runs/operational-cycle.json`.

**Correção ao §3.7 do desenho:** só o espelho da memória passa pelo `tentarComponente` do hook de contexto. Missões e aprendizado rodam na `hook-varredura` (SessionStart/Stop, assíncrona, sob o lock de manutenção).

**Defeito herdado:** o PG guarda missões podadas do arquivo local que ficaram `in-progress`. Elas aparecem no contexto como missões ativas para sempre.

**Ilha:**
- usa o Electron do `apps/omni-desktop`, que não tem `node_modules` neste worktree;
- não existem `agente:api`, `/v1/saude`, `/v1/despachos`, supervisor, `executor/` do Omni nem workflow de release;
- não há tag nem release no GitHub.

**Agentes:**
- O Oráculo já tem `executor/agente.json` 0.3.0 com `servir` e preload chamando `agente:api`, no ramo `f3/lote-d`, fora da main dele.
- O Overcore tem `executor/agente.json` 0.1.0 nos ramos F4, também fora da main dele.

## Ordem e dependências

1 → 2 → 3 → 4a → 4b → 4c → 5 → 6.

- O plano 3 depende do 1, porque a `despachos` entra como v5 depois da v4.
- O plano 4 depende do 3, porque o IPC `agente:api` precisa do supervisor.
- O plano 5 depende de 1 a 4, porque o executor instala o que existe.
- O plano 6 depende de tudo.
- A F3 (Oráculo) e a F4 (Overcore) seguem com as sessões donas. O plano 6 só exige que o `servir` deles responda; se a main deles ainda não tiver o executor, a prova usa o ramo que tiver, registrado com o SHA.

## Regras que valem em todos os planos

- Migração aplicada nunca muda: esquema novo é migração nova no fim (`_migracoes` confere o sha256).
- TDD com o vermelho visto pela asserção; commit só depois do verde lido; typecheck faz parte do verde.
- Uma suíte pesada por vez.
- `git diff --ignore-cr-at-eol --stat -- dist` vazio antes de commitar: o `dist` tem ruído de fim de linha.
- TEMP em formato 8.3 quebra caminho: rascunho em `$env:LOCALAPPDATA\omni\rascunho`.
- Commit com autor e committer Weriton-DataOps, passados no próprio comando.
- O 5433 só é desligado no plano 6, depois do §5 verde. Até lá, ele segue ligado e intocado (só leitura).
- No ensaio da instalação, nunca escanear QR do WhatsApp: risco de mexer na sessão real do bot.
