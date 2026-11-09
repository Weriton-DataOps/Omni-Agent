# F2, plano 1: banco único — missões e livro de aprendizado no `omni.db`

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** missões e livro de aprendizado operacional passam a morar no `omni.db`, com o histórico do Postgres 5433 importado com 100% de cobertura. O espelho da memória para o PG morre. Depois deste plano, nenhum código do runtime fala com o 5433.

**Arquitetura:**
- Migração v4 do `omni.db` com quatro tabelas:
  - `missoes` e `aprendizado_achados`, dado vivo, com diário;
  - `missao_eventos` e `aprendizado_eventos`, só de acréscimo, como `usos` no cofre.
- Loja nova `runtime/casa/loja-operacao.mjs`, com as mesmas regras do broker:
  - missão só muda com versão mais nova (`atualizado_em` maior), e cada mudança deixa um evento;
  - achado não regride (`ultimo_visto_em`), e o evento tem id natural.
- Os dois sincronizadores da `hook-varredura` e a leitura de missões do contexto trocam o broker pela loja.
- O importador lê o 5433 só em leitura, por `psql` em transação `READ ONLY`, grava um JSON datado em `%LOCALAPPDATA%\omni\backup` e importa de forma idempotente, com o mais novo vencendo.

**Tecnologia:** `node:sqlite` (Node ≥ 22.13), `node:test`, PowerShell 5.1 + `psql` 18 para a exportação.

**Desenho:** §3.7 e a decisão 8 (fechada em 09/11/2026: "manter só o sqlite"). Plano mestre: [F2](2026-11-09-f2-casa-instalavel.md).

---

## O que o executor precisa saber

- **Missões fantasmas.** O PG tem missões que o arquivo local já podou (retenção de 100 sessões, `slice(-100)` por ordem de chegada) e que ficaram `in-progress`. O contexto lê essas missões como ativas para sempre.
  - `encerrarMissoesPodadas` cancela só as **comprovadamente podadas**: ativas, ausentes do ciclo local e com `criado_em` anterior ao `startedAt` da sessão mais antiga que sobrou.
  - Com o ciclo vazio (máquina nova), não toca em nada.
  - O evento de encerramento é `reconciled`.
- **Ids de evento.**
  - Os importados mantêm o id do PG.
  - Os novos usam `mission-event-` + md5(`id` + `atualizado_em` ISO).
  - Não colidem: só nasce evento quando chega versão mais nova que a gravada.
- **Datas.** Tudo vira ISO UTC com milissegundos e `Z` (`new Date(x).toISOString()`). A comparação de texto vale como comparação de tempo.
- **SQLite fora do ar.** O estágio da varredura vira `rejected` (já anotado pela varredura) e o contexto cai para o ciclo local, como fazia com o broker.
- **Ordem do corte.** O importador é idempotente e o mais novo vence, então ele pode rodar antes ou depois da release instalada. O 5433 segue ligado até o plano 6.
- **Privacidade.** O JSON da exportação tem os objetivos das missões. Fica só em `%LOCALAPPDATA%\omni\backup`, nunca no repo. O script só imprime contagens.

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `runtime/casa/esquemas.mjs` | modificar | v4 do `omni.db` |
| `runtime/casa/loja-operacao.mjs` | criar | gravar, listar e encerrar missões; gravar achados; importar e verificar o dump do PG |
| `runtime/sincronizacao-missoes-duraveis.mjs` | reescrever | ciclo local → `missoes` |
| `runtime/sincronizacao-aprendizado-operacional.mjs` | modificar | ciclo local → `aprendizado_achados` |
| `runtime/contexto.mjs` | modificar | missões ativas lidas do `omni.db` |
| `runtime/hook-contexto.mjs` | modificar | sai o componente `sincronizacao-memoria-duravel` |
| `runtime/sincronizacao-memoria-duravel.mjs` e `testes/sincronizacao-memoria-duravel.test.mjs` | apagar | espelho morto |
| `scripts/omni-exportar-5433.ps1` | criar | dump JSON só leitura do 5433 |
| `scripts/omni-importar-5433.mjs` | criar | importa o dump, verifica e imprime só contagens |
| `testes/casa-loja-operacao.test.mjs` | criar | loja, migração e importador |
| `testes/sincronizacao-missoes-duraveis.test.mjs` | criar | sincronizador e contexto contra `omni.db` temporário |
| `testes/hook-contexto.test.mjs`, `testes/memoria-coordenador.test.mjs` | modificar | saem os remendos no protótipo do broker |

## Tasks

### T1: migração v4

- [x] Teste em `testes/casa-loja-operacao.test.mjs`. Abre a casa temporária e confere que `_migracoes` tem a v4, que as quatro tabelas existem e que `missoes` recusa `estado = 'completed'` com `fechada_em` nulo.
- [x] Rodar `node --test testes/casa-loja-operacao.test.mjs`. **Esperado:** vermelho na falta da tabela `missoes`.
- [x] Acrescentar a v4 em `MIGRACOES_OMNI`, com o SQL deste trecho:

```sql
CREATE TABLE missoes (
  id TEXT PRIMARY KEY CHECK (id GLOB 'mission-?*'),
  objetivo TEXT NOT NULL CHECK (length(objetivo) BETWEEN 3 AND 800),
  estado TEXT NOT NULL CHECK (estado IN ('open', 'in-progress', 'blocked', 'completed', 'cancelled')),
  prioridade INTEGER NOT NULL CHECK (prioridade BETWEEN 0 AND 100),
  corpo TEXT NOT NULL CHECK (json_valid(corpo)),
  fechada_em TEXT,
  <VIVO>,
  CHECK ((estado IN ('completed', 'cancelled')) = (fechada_em IS NOT NULL))
);
CREATE INDEX missoes_ativas ON missoes (estado, prioridade DESC, atualizado_em DESC) WHERE apagado_em IS NULL;
<gatilhos de diário de missoes>
CREATE TABLE missao_eventos (
  id TEXT PRIMARY KEY CHECK (id GLOB 'mission-event-?*'),
  missao_id TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('created', 'updated', 'blocked', 'resumed', 'completed', 'cancelled', 'reconciled')),
  corpo TEXT NOT NULL CHECK (json_valid(corpo)),
  em TEXT NOT NULL,
  origem_maquina TEXT NOT NULL
);
CREATE INDEX missao_eventos_por_missao ON missao_eventos (missao_id, em);
CREATE TABLE aprendizado_achados (
  id TEXT PRIMARY KEY CHECK (id GLOB 'improvement-?*'),
  impressao_candidato TEXT NOT NULL,
  categoria TEXT NOT NULL,
  destino TEXT NOT NULL,
  estado TEXT NOT NULL,
  ocorrencias INTEGER NOT NULL CHECK (ocorrencias BETWEEN 1 AND 1000000),
  impressao_enunciado TEXT NOT NULL,
  impressao_fonte TEXT NOT NULL,
  impressao_artefato TEXT,
  versao_release TEXT,
  primeiro_visto_em TEXT NOT NULL,
  ultimo_visto_em TEXT NOT NULL,
  <VIVO>,
  CHECK (ultimo_visto_em >= primeiro_visto_em)
);
<gatilhos de diário de aprendizado_achados>
CREATE TABLE aprendizado_eventos (
  id TEXT PRIMARY KEY CHECK (id GLOB 'learning-event-?*'),
  achado_id TEXT NOT NULL,
  estado TEXT NOT NULL,
  ocorrencias INTEGER NOT NULL,
  impressao_fonte TEXT NOT NULL,
  impressao_artefato TEXT,
  versao_release TEXT,
  em TEXT NOT NULL,
  origem_maquina TEXT NOT NULL
);
CREATE INDEX aprendizado_eventos_por_achado ON aprendizado_eventos (achado_id, em);
```

- [x] Rodar o teste. **Esperado:** verde.

### T2: loja de missões

- [x] Testes de `gravarMissoes`:
  - insere a missão com evento `resumed` para `in-progress`;
  - reenviar com o mesmo `updatedAt` conta como duplicada, sem evento novo e sem subir a `versao`;
  - versão mais nova atualiza, sobe a `versao` e gera evento;
  - versão mais velha é ignorada;
  - missão inválida (id fora do padrão, objetivo < 3) conta como inválida e não derruba o lote.
- [x] Teste de `listarMissoesAtivas`: só `open`/`in-progress`/`blocked`, ordenadas por prioridade e depois por `atualizado_em` decrescente, com limite. O formato devolvido é igual ao do broker (`id`, `objective`, `state`, `priority`, `payload`, `createdAt`, `updatedAt`, `closedAt: null`).
- [x] Testes de `encerrarMissoesPodadas`:
  - cancela a ativa podada, com evento `reconciled`;
  - não cancela a que está no ciclo;
  - não cancela a ativa mais nova que a sessão mais antiga;
  - com ciclo vazio, não faz nada.
- [x] Ver o vermelho. Implementar em `runtime/casa/loja-operacao.mjs`. Ver o verde.

### T3: loja de achados

- [x] Testes de `gravarAchados`:
  - primeiro registro grava achado e evento;
  - mesmo `eventId` conta como duplicado;
  - evento mais novo atualiza o achado e sobe a `versao`;
  - evento mais velho grava o evento mas não regride o achado (igual à função `learning.record_improvement_finding`);
  - achado inválido conta como inválido.
- [x] Ver o vermelho, implementar, ver o verde.

### T4: importador e verificação

- [x] Testes de `importarDoPostgres(db, dump, { fonteSha256 })` com um dump de fixture:
  - 1ª vez: tudo novo, e uma linha em `_importacoes` com tipo `postgres-5433`;
  - 2ª vez: zero novos;
  - missão local mais nova que a do dump não é sobrescrita;
  - eventos são inseridos com o id do PG.
- [x] Testes de `verificarImportacao(db, dump)`:
  - `faltando` e `atrasadas` em zero depois da importação;
  - apagar uma linha deixa `faltando` = 1;
  - `memoriasSoNoPostgres` conta os ids de memória do dump ausentes em `memorias`.
- [x] Ver o vermelho, implementar, ver o verde.

### T5: sincronizadores e contexto

- [x] Teste `testes/sincronizacao-missoes-duraveis.test.mjs`:
  - casa temporária com `runs/operational-cycle.json` escrito pelo próprio `ciclo-operacional.mjs` (sessão aberta com objetivo);
  - `sincronizarMissoesDuraveis(casa)` grava em `missoes`;
  - `montarContexto(casa)` traz a missão do banco.
- [x] Teste: `sincronizarAprendizadoOperacional(casa)` com o ciclo sem candidatos devolve `empty`.
- [x] Ver o vermelho: hoje o sincronizador chama o broker.
- [x] Reescrever os dois sincronizadores e o `loadOperationalCycle` do `contexto.mjs` sobre `comBancoDaCasa(casa, 'omni', …)`. A função `criarAchadoOperacionalSanitizado` continua igual.
- [x] Ver o verde.

### T6: fim do espelho da memória

- [x] Tirar do `hook-contexto.mjs` o import e o componente `sincronizacao-memoria-duravel`. `persistence` fica só com `recorded`.
- [x] Apagar `runtime/sincronizacao-memoria-duravel.mjs` e o teste dele.
- [x] Tirar os remendos de `NodeAccessBrokerClient.prototype` dos testes de `hook-contexto` e `memoria-coordenador`.
- [x] `grep -rn "NodeAccessBrokerClient" runtime` deve sair vazio.
- [x] `scripts/activate-omni-learning.mjs` e `scripts/validate-omni-memory.mjs` deixam de chamar o espelho: a memória já nasce no `omni.db`.
- Resto para o plano 6: `apps/omni-desktop` (fechado desde 21/10, fora do CI) ainda carrega `runtime/sincronizacao-memoria-duravel.mjs` em `syncMemory()` e fala com o broker. Sai junto com o broker; até lá, a falha cai no `catch` dele e marca `synchronizationPending`.

### T7: exportação e importação do 5433

- [x] `scripts/omni-exportar-5433.ps1 -Saida <arquivo>`:
  - mesmo molde do `read-omni-database.ps1`: credencial admin lida do Gerenciador de Credenciais por `CredRead`, `PGPASSWORD` só no ambiente do processo e `default_transaction_read_only=on`;
  - aborta se houver mais de um `owner_id`;
  - grava o JSON em UTF-8 sem BOM e imprime só as contagens.
- [x] `scripts/omni-importar-5433.mjs --arquivo <dump> [--casa <casa>]`: importa, verifica e imprime JSON só com contagens. Sai com 1 se `faltando` ou `atrasadas` ≠ 0.
- [x] Ensaio em casa temporária com `OMNI_CASA_BANCO` apontando para um rascunho, nunca para o banco real: contagens batem com as do PG medidas em 09/11 (1.628 / 10.580 / 1.236 / 2.165, ou maiores, porque o PG segue recebendo até a release).
- Ensaio de 09/11 (17h04): exportação 1.632 / 10.588 / 1.236 / 2.165 e 2.839 ids de memória; importação em 1 s, faltando = 0 e atrasadas = 0 nas quatro tabelas. Entre as missões vieram 4 de teste (`fechar a F2 do Omni` e `objetivo vivo`, criadas 2026-11-09T12:00Z) plantadas no PG pelo vermelho do T5 quando o sincronizador antigo ainda falava com o broker; são canceladas na casa real logo depois do import.

### T8: verde, commit, PR e release

- [x] `npm run typecheck`, depois `npm test`, uma suíte por vez, e ler o total. (09/11 17h43: typecheck 0; JS 916, 912 pass, 0 fail, 4 skipped; TS 55/55.)
- [x] `git diff --ignore-cr-at-eol --stat -- dist` vazio.
- [x] Commit Weriton-DataOps, push, PR, CI verde lido, merge `--merge --match-head-commit`.
- [x] Release 0.27.0 (versão, `releases.json`, `integridade.json`) e atualização do plugin. Depois, rodar o importador contra a casa real e ler `faltando = 0` e `atrasadas = 0`.

- Lição da primeira suíte cheia: o script `check` do `package.json` ainda listava `runtime/sincronizacao-memoria-duravel.mjs`. A cobertura de entrypoints da integridade lê esse script e acusou o arquivo apagado (`missing`, status `drifted`), o que derrubou dois testes que não falam de banco: o E2E do SessionStart (`no-loaded-release-match`) e a fila da eval (`source-unverifiable`). O módulo apagado saiu do `check` e `runtime/casa/loja-operacao.mjs` entrou. Apagar módulo do runtime exige procurar o nome também no `package.json`.

## Apêndice: mutantes

| # | Mutante | Teste que tem que avermelhar |
|---|---|---|
| 1 | `>=` → `>` na comparação de `atualizado_em` | reenviar o mesmo `updatedAt` conta como duplicada |
| 2 | evento sem `INSERT OR IGNORE` | 2ª importação zero novos |
| 3 | `encerrarMissoesPodadas` sem o corte por `criado_em` | não cancela a ativa mais nova que a sessão mais antiga |
| 4 | achado atualiza sem conferir `ultimo_visto_em` | evento mais velho não regride o achado |
| 5 | `listarMissoesAtivas` sem filtro de estado | só ativas |
