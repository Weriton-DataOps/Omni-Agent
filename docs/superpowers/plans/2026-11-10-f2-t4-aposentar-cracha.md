# F2, T4: aposentar o Crachá, o broker e o PG 5433 no código

> **Para agentes:** use superpowers:executing-plans. Caixas `- [ ]` marcam o progresso.

**Objetivo:** apagar do repositório o `apps/omni-desktop` (o Crachá) e tudo que só existia para ele, para o broker de acesso ou para o PostgreSQL 5433. Ficam as peças que o 6b ainda usa para importar, conferir e desligar.

**Decisão:** o Weriton autorizou aposentar o `apps/omni-desktop` junto com o broker e o PG em 10/11/2026.

**Arquitetura:** desde o plano 1 da F2 o runtime grava missões, aprendizado e memória no `omni.db`. A ilha tem Electron próprio desde o 5b2 (`apps/omni-ilha/iniciar.ps1`). O cofre da F1 tem testadores próprios (`runtime/casa/testadores-cofre.mjs`). O grafo do broker em `src/` é fechado: as portas, os adaptadores e os contratos de credencial só se importam entre si e nos testes deles.

**Release:** 0.36.0.

---

## O que sai

**Aplicativo:** `apps/omni-desktop/` (125 arquivos rastreados).

**Scripts do broker e do logon:**
- `omni-access-broker.ps1`
- `start-omni-access-broker.ps1`, `start-user-omni-access-broker.ps1`, `stop-omni-access-broker.ps1`
- `install-omni-access-broker-service.ps1`, `elevate-install-omni-access-broker-service.ps1`, `interactive-install-omni-access-broker-service.ps1`, `start-install-omni-access-broker-service.ps1`
- `protect-omni-access-broker-credential.ps1`
- `start-omni-private-executor.ps1`
- `start-user-omni-runtime.ps1`, `start-user-omni-runtime-hidden.vbs`
- `install-user-omni-startup.ps1`, `install-user-omni-runtime-tasks.ps1`

**Scripts do PG:**
- `provision-omni-postgresql.ps1`, `initialize-dedicated-omni-postgresql.ps1`, `start-dedicated-omni-postgresql.ps1`
- `apply-omni-postgresql-migration.ps1`, `probe-postgresql-admin-elevated.ps1`
- `read-omni-database.ps1`, `new-omni-database-observer.ps1`

**Scripts do Crachá:**
- `omni-credential-execution.ps1`, `omni-credential-verification.ps1`, `omni-credential-write-ops.ps1`
- `omni-realtime-token.ps1` (único consumidor: `apps/omni-desktop/src/main/runtime.ts`)
- `start-omni-desktop-hidden.vbs`, `install-omni-desktop-shortcut.ps1`

**TypeScript (e o `dist` correspondente):**
- `src/adapters/windows/node-access-broker-client.ts`, `src/adapters/postgresql/broker-credential-metadata-repository.ts`
- `src/ports/access-broker-client.ts`, `src/ports/credential-metadata-repository.ts`
- `src/ports/durable-memory-client.ts`, `src/ports/durable-mission-client.ts`, `src/ports/durable-operational-learning-client.ts`
- `src/contracts/credential-execution.ts`, `src/contracts/credential-metadata.ts`, `src/core/access/credential.ts`

**Adaptador do PG:** `adaptadores/postgresql/` (README e migrações 001 a 005).

**Testes:**
- `testes/access-broker.typescript.test.ts`, `testes/credential-lifecycle.typescript.test.ts`
- `testes/private-executor-integration.test.mjs`, `testes/ssh-executor.test.mjs`, `testes/postgres-access.integration.mjs`
- `testes/credential-execution-broker.test.ps1`, `testes/credential-verification-broker.test.ps1`, `testes/credential-verification-transaction.rollback.ps1`, `testes/credential-write-ops.test.ps1`

**Contrato:** `contratos/interface/omni-desktop.json` e a entrada dele no `contratos/catalogo-contratos.json`.

## O que fica

- `scripts/omni-exportar-5433.ps1`, `scripts/omni-importar-5433.mjs`, `scripts/omni-conferir-cracha.mjs` e `scripts/omni-desligar-5433.ps1`, porque o 6b usa os quatro. O `-Broker 'omni-access-broker'` do desligamento continua: é ele que acha o broker real para parar.
- `runtime/casa/postgres-fio.mjs`, que é o testador de Postgres do cofre e não tem relação com o 5433.
- `scripts/probe-windows-credential.ps1` e o teste de integração dele. É diagnóstico genérico do Gerenciador de Credenciais.
- `scripts/provision-omni-realtime.ps1`. O `openai-realtime.dpapi` que ele cria também serve para gerar arte.
- `/runtime/postgresql-5433/` no `.gitignore`.
- O histórico em `docs/validacao` e `docs/planejamento`. São registros datados e não se reescrevem.

## O que muda

**Contratos de arquitetura.** Deixam de afirmar que o desktop está ativo.
- `escopo.json`:
  - `interface.chat` passa a `claude-code-session-via-omni-plugin`;
  - `interface.realtime` passa a `retired-with-omni-desktop`;
  - `interface.section35` e `sections.35` passam a `omni-desktop-body-contract-retired`;
  - `sections.39` passa a `omni-ilha-interface-active`.
- `invariantes.json`:
  - `availability.continuousPresence` passa a `omni-ilha`;
  - o `reason` passa a dizer que a ilha é a interface única desde 21/10 e que o contrato de corpo do desktop foi aposentado em 10/11;
  - `excludedOrDeferredSections.35` passa a `omni-desktop-body-contract-retired`.
- `testes/pacote.test.mjs`: deixa de exigir `contratos/interface/omni-desktop.json` e passa a esperar `omni-desktop-body-contract-retired` na seção 35.

**Documentos vivos:**
- `README.md`: a interface local passa a ser a ilha.
- `docs/arquitetura-ativa.md`: o mesmo na tabela e no parágrafo do aplicativo.
- `docs/arquitetura-corpo-interface.md`: ganha uma nota no topo dizendo que é histórico.

**Comentário:** em `scripts/omni-conferir-cracha.mjs`, onde cita `scripts/omni-access-broker.ps1`, passa a dizer que o broker foi aposentado no T4.

**Plano 6a:** marcar as caixas do T5, feito na 0.35.0.

## Cuidado com a máquina

O atalho real `Omni Runtime.lnk` aponta para `Documents\Omni\scripts\start-user-omni-runtime-hidden.vbs`, no checkout principal. Apagar do repositório não muda esse checkout. Até o desligamento do 6b, **não atualizar o checkout principal**: o PG precisa subir no logon para o export do 6b.

---

### Tarefa 1: guarda da aposentadoria (vermelho)

**Arquivo:** `testes/aposentadoria-cracha.test.mjs`

- [x] Escrever três testes:
  1. Nenhum dos caminhos da seção "O que sai" existe.
  2. Nenhum arquivo rastreado em `runtime/`, `src/`, `scripts/`, `hooks/`, `executor/`, `apps/omni-ilha/` ou `package.json` cita `apps/omni-desktop`, `omni-access-broker-v` (o nome do pipe), `start-user-omni-runtime` ou `omni-credential-execution`. A exceção é a lista de arquivos que ficam.
  3. `escopo.json` e `invariantes.json` não dizem mais `omni-desktop-body-contract-active` nem `omni-desktop-interface-active`.
- [x] Rodar e ler o vermelho pela asserção. O esperado é o teste 1 nomear `apps/omni-desktop`.

### Tarefa 2: apagar e ajustar

- [x] `git rm -r -q` dos caminhos da seção "O que sai", incluindo os do `dist`.
- [x] Editar os contratos, o `pacote.test.mjs`, os documentos vivos e o comentário.
- [x] Rodar a guarda até ficar verde.
- [x] Rodar os mutantes, que devem deixar a guarda vermelha:
  - restaurar `scripts/omni-access-broker.ps1`;
  - devolver `omni-desktop-body-contract-active` ao `escopo.json`;
  - plantar `apps/omni-desktop` num comentário de `runtime/hook-contexto.mjs`.
- [x] Commitar.

### Tarefa 3: release 0.36.0

- [x] Bump nos seis lugares e o selo refeito.
- [x] Suíte inteira em segundo plano (1296 de 1296, 0 falhas), `typecheck`, `check` e o `dist` sem diff além das remoções.
- [x] PR, CI verde, merge, `plugin update` e o selo conferido.
