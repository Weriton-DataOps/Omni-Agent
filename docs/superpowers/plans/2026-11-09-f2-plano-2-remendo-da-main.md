# F2, plano 2: remendo da main

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use superpowers:executing-plans para executar tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** a main passa a conter tudo o que o Omni de verdade usa: a ilha deixa de chamar arquivos que só existem no checkout desta máquina. Também entram os quatro commits do ramo esquecido e o trabalho do WhatsApp que ficou um mês sem commit.

**Arquitetura:**
- Um ramo, `casa-f2-p2`, criado de `origin/main` `226f285`, e um PR.
- O ramo `omni-agenda-e-correcoes` entra por merge, nunca por rebase.
- Os arquivos soltos são copiados do checkout principal (`Documents\Omni`) para o worktree, revisados, limpos de dado pessoal e testados.
- O checkout principal não recebe commit.

**Tecnologia:** Node 24 (`node:test`), PowerShell 5.1, VBScript dos atalhos agendados.

**Plano mestre:** [F2: a casa instalável](2026-11-09-f2-casa-instalavel.md), linha 2.

---

## Medido em 09/11/2026 (não suposto)

**Ramo `omni-agenda-e-correcoes`:**
- 4 commits que não estão na main: `b7eb2d0` e `6dfe8a2` (Sentinel), `b327625` (DNS da VPN) e `0327c8f` (ponte sobrevive ao próprio reinício).
- Está no origin e fica 35 commits atrás da `origin/main`. A base comum é `3e710b4`.
- Nenhum arquivo do ramo foi mexido pela main desde a base, então o merge não tem conflito.
- Varredura de dado pessoal:
  - os telefones dos testes são fictícios (DDD 00 ou número errado de propósito);
  - sobra o usuário de rede do Weriton na 1ª linha de `servicos/sentinel/triagem.md`.

**Trabalho não commitado no checkout principal** (12 arquivos, de 09/10 a 07/11):
- `.gitignore`, `PROVENIENCIA.md`;
- `config.mjs`, `formato.mjs`, `ponte.mjs`, `relatorio.mjs`, `terceiros.mjs` e `vigia-pedidos.mjs` do WhatsApp;
- `baileys-events.ts` e o spec dele;
- `testes/vigia-pedidos.test.mjs`;
- e a remoção de `servicos/whatsapp/omni/mcp.mjs`.

A remoção é acidente, não mudança:
- nada substituiu o arquivo;
- o `PROVENIENCIA.md` ainda o descreve;
- o MCP `whatsapp` do Claude Code aponta para ele.

Desde então o MCP do WhatsApp cai com CONNECTION_CLOSED em toda sessão nova. O Windows recusa recriar esse nome exato na pasta, com "acesso negado", inclusive em maiúsculas, e qualquer outro nome grava normal. Nenhum processo do usuário segura handle na pasta; o que segura é do sistema. O plano não leva a remoção; o arquivo segue igual ao da main.

**Arquivos fora do git que a ilha chama:**
- `scripts/omni-actions.mjs`, chamado por `escrita.js`, `execucoes.js` e `mesa.js`;
- `scripts/omni-actions-despachar.mjs`, chamado por `execucoes.js` e `main.js`;
- `scripts/omni-overcore.mjs`, chamado por `main.js` e `overcore.js`;
- `servicos/whatsapp/omni/saude.mjs`, chamado por `whatsapp.js`.

Dependências deles que também estão fora do git:
- `servicos/whatsapp/omni/aprovacoes.mjs`, importado por `omni-actions.mjs`;
- `servicos/whatsapp/omni/saude-openai.ps1`, chamado por `saude.mjs`.

**Outros arquivos soltos do Omni sem dado pessoal:**
- a visita do Actions: `omni-actions-visita.{md,ps1,vbs}` e `omni-actions-agendar.ps1`;
- `vigia-sessoes.{mjs,vbs}` e `transcrever-local.py` do WhatsApp;
- `omni-credential-write-ops.ps1` com o teste `.ps1` dele, e `omni-guardar-chave-da-area-de-transferencia.ps1`;
- as duas especificações em `docs/superpowers/specs/`, que o plano mestre já linka.

O caminho fixo da máquina aparece nos `.vbs`, nos `-agendar.ps1` e nos `.md` de rotina.

**Fora do git por natureza:**

| Arquivo | Por quê |
|---|---|
| `scripts/omni-equipedev.{mjs,ps1,vbs}` e `omni-equipedev-agendar.ps1` | Têm e-mail e nome de colegas |
| `scripts/omni-perfis-*` | O coletor tem e-mail, telefone e nome de terceiros |
| `apps/omni-ilha/bancada/` | 484 arquivos, 1,6 GB de arte da cabeça do Omni |
| `.suite-full.txt` | Saída antiga de suíte |
| `testes/omni-overcore-mao.test.mjs` | Regra da casa: nunca entra |

**Payload da release:** `scripts/` está em `PAYLOAD_ROOTS` (`runtime/integridade-release.mjs`). Arquivo novo ali muda o fingerprint, então o plano fecha com a release 0.27.1.

**Notas do plano 1** (registradas aqui porque o arquivo do plano 1 é marcado neste ramo):
- `memoriasSoNoPostgres: 2416`: o 5433 tem 2.839 ids de memória e o `omni.db` tem 546. O plano 6 explica essa diferença antes de desligar o 5433.
- 1.487 missões ativas é número suspeito, o defeito herdado das missões podadas. O plano 3 ou o 6 decide a limpeza.
- Sessões ainda na 0.26.2 seguem gravando no 5433 até reiniciar. Quando todas estiverem na 0.27.x, export e import rodam de novo (idempotentes, o mais novo vence).

---

### Tarefa 1: o ramo esquecido entra

**Arquivos:** os 11 do ramo e `servicos/sentinel/triagem.md`.

- [ ] **1.1** No worktree, `git merge --no-ff omni-agenda-e-correcoes` com autor e committer Weriton-DataOps. Esperado: sem conflito.
- [ ] **1.2** Em `servicos/sentinel/triagem.md`, linha 1, trocar o usuário de rede por "o Weriton". O resto do prompt fica igual.
- [ ] **1.3** Rodar `node --test testes/sentinel-checagem.test.mjs testes/whatsapp-dns-rapido.test.mjs`. Esperado: todos pass, totais lidos.
- [ ] **1.4** Commit: `fix(sentinel): prompt da triagem sem o usuario de rede`.

### Tarefa 2: o WhatsApp um mês depois

**Arquivos:**
- os 11 modificados listados acima, sem o `mcp.mjs`;
- novos: `aprovacoes.mjs`, `saude.mjs`, `saude-openai.ps1`, `vigia-sessoes.mjs`, `vigia-sessoes.vbs` e `transcrever-local.py`.

- [ ] **2.1** Conferir que a versão base de cada modificado no worktree é igual à do HEAD do checkout principal (`git hash-object` contra `git rev-parse omni-agenda-e-correcoes:<arquivo>`). Só então copiar. Se alguma divergir, parar e reconciliar à mão.
- [ ] **2.2** Copiar os modificados e os novos do checkout principal para o worktree.
- [ ] **2.3** Em `vigia-sessoes.vbs`, trocar o caminho fixo pela pasta do próprio script (`CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)`).
- [ ] **2.4** Rodar a varredura de dado pessoal nos 17 arquivos. Esperado: só falsos positivos já classificados (expressões regulares de `vigia-pedidos.mjs` e do teste dele, e o e-mail de exemplo do spec do Baileys).
- [ ] **2.5** Rodar `node --test testes/vigia-pedidos.test.mjs` e `node --check` nos `.mjs` novos. Rodar o spec do Baileys pelo runner do serviço (`servicos/whatsapp`), se o `node_modules` dele existir; se não existir, registrar como não rodado.
- [ ] **2.6** Commit: `feat(whatsapp): saude, aprovacoes, vigia de sessoes e o trabalho parado desde outubro`.

### Tarefa 3: o que a ilha chama

**Arquivos:**
- `scripts/omni-actions.mjs`, `scripts/omni-actions-despachar.mjs`, `scripts/omni-overcore.mjs`;
- `scripts/omni-actions-visita.{md,ps1,vbs}`, `scripts/omni-actions-agendar.ps1`;
- `testes/actions-organizador.test.mjs`.

- [ ] **3.1** Copiar os arquivos para o worktree.
- [ ] **3.2** Trocar o caminho fixo da máquina pela pasta do script nos `.vbs` e no `.ps1` (`$PSScriptRoot`), e por `%USERPROFILE%` ou caminho relativo nos `.md`. O `-agendar.ps1` registra a tarefa apontando para a pasta de onde roda. O plano 5 troca tudo pelo executor.
- [ ] **3.3** Em `testes/actions-organizador.test.mjs`, trocar o número do dono por um fictício com DDD 00 (`5500999990000`). Os caminhos `C:\Users\x\...` já são fictícios.
- [ ] **3.4** Rodar `node --test testes/actions-organizador.test.mjs`. Esperado: todos pass, totais lidos.
- [ ] **3.5** Mutação: trocar a cota de vereditos de `omni-actions.mjs` de 2 para 3. O teste "cota" deve ficar vermelho pela asserção. Desfazer.
- [ ] **3.6** Commit: `feat(actions): organizador e despacho da ilha versionados`.

### Tarefa 4: o resto do Omni e as cercas

**Arquivos:**
- `scripts/omni-credential-write-ops.ps1` e `testes/credential-write-ops.test.ps1`;
- `scripts/omni-guardar-chave-da-area-de-transferencia.ps1`;
- as duas especificações;
- `.gitignore`.

- [ ] **4.1** Copiar e varrer.
- [ ] **4.2** Rodar `powershell -NoProfile -File testes/credential-write-ops.test.ps1`. Se falhar por depender da máquina, o teste fica fora e o motivo vai para o PR.
- [ ] **4.3** No `.gitignore`, acrescentar `apps/omni-ilha/bancada/` e `.suite-*.txt`.
- [ ] **4.4** No checkout principal, acrescentar à `.git/info/exclude` (local, não vai para o repo) os arquivos privados: `scripts/omni-equipedev*`, `scripts/omni-perfis-*` e `testes/omni-overcore-mao.test.mjs`.
- [ ] **4.5** Commit: `chore: cofre por linha de comando, especificacoes e cercas do repo`.

### Tarefa 5: release 0.27.1, verde, PR e merge

- [ ] **5.1** Marcar os itens 3 e 4 da T8 do plano 1 e anotar o que foi para as notas acima.
- [ ] **5.2** Bump 0.27.1:
  - `plugin.json`, `package.json`, `package-lock.json`;
  - `releases.json`, com a nota "a main traz o que a ilha chama; ramo do Sentinel e trabalho do WhatsApp";
  - `integridade.json` com o fingerprint recalculado.
- [ ] **5.3** `npm run typecheck`, então `npm test`. Esperado: 0 fail, totais lidos. Depois, `git diff --ignore-cr-at-eol --stat -- dist` vazio (`git checkout -- dist` se só tiver ruído).
- [ ] **5.4** Commit da release, push, PR para a main, CI lido, merge com `--merge --match-head-commit`.
- [ ] **5.5** Atualizar o plugin para a 0.27.1 e verificar a cópia instalada (`verified`, cobertura ok, fingerprint batendo).
- [ ] **5.6** Plano mestre: linha 2 "entregue".

## Depois deste plano

- O checkout principal continua no ramo `omni-agenda-e-correcoes` com o trabalho já versionado. Voltar para a main fica para quando o nome `mcp.mjs` destravar (reinício da máquina). Antes disso, o `git checkout main` falha ao recriar o arquivo.
- O MCP do WhatsApp volta quando o `mcp.mjs` for recriado no checkout principal.
