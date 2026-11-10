# F2, plano 6a — troca do WhatsApp, conferência do Crachá e desligamento do 5433 em roteiro

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** deixar em código, testado e com release, tudo o que a instalação real (plano 6b) vai executar nesta máquina:
- a troca do serviço e da ponte do WhatsApp para a versão instalada;
- a conferência das credenciais do Crachá contra o cofre;
- o desligamento do 5433 com cópia datada, em roteiro que primeiro só mostra o que faria.

**Architecture:**
- **Troca do WhatsApp:** o `omni-instalar.ps1` ganha `Trocar-WhatsApp`. A função lê o `servico.pid` e o `ponte.pid` da pasta de dados e para só o processo cuja linha de comando é do WhatsApp do Omni e de outra raiz que não a da versão nova. Depois o `iniciar.ps1` da versão nova sobe os dois.
- **Crachá e 5433:** dois scripts novos, `scripts/omni-conferir-cracha.mjs` (só leitura) e `scripts/omni-desligar-5433.ps1`. O desligamento tem modo `-Executar` explícito; sem ele, só lista o plano.

**Tech Stack:** PowerShell 5.1, Node 24 (`node:test`, `node:sqlite`), `psql`/`pg_ctl` do PostgreSQL 18 da máquina.

---

## Medido em 10/11/2026 (substitui as suposições da linha 6 do plano mestre)

**Tarefas do PG:** `OmniPostgreSQL5433` e `OmniAccessBroker` já não existem no Agendador.

**Quem sobe o PG e o broker:**
- O lançador é o atalho `Omni Runtime.lnk` da pasta Inicializar.
- O PG roda assim: `postgres.exe -D Documents\Omni\runtime\postgresql-5433\data -p 5433 -h 127.0.0.1`.
- O broker é o `start-user-omni-access-broker.ps1`, no pipe `omni-access-broker-v8`.

**Quem ainda usa o PG e o broker:**
- O plugin (hooks, runtime, skills, executor) já não fala com nenhum dos dois.
- O único consumidor vivo é o `apps/omni-desktop` (o Crachá), fechado desde 21/10. Ele:
  - lê credenciais e missões pelo broker;
  - roda o executor SSH privado, que é o próprio `omni-access-broker.ps1` em outro pipe;
  - carrega `runtime/sincronizacao-memoria-duravel.mjs`, que não existe mais, ou seja, já está quebrado.

**Crachá:**
- O PG guarda 5 linhas em `access.credential_versions` e 3 em `audit.credential_events`. São metadados.
- O segredo de cada uma mora no Gerenciador de Credenciais, em `Omni/UserCredential/<x>`, citado como `credential-ref:windows-<x>`.
- O `omni-exportar-5433.ps1` não leva `access.*` nem `audit.*`.

**WhatsApp:**
- Todos os componentes usam a mesma pasta de dados, `%APPDATA%\omni\whatsapp`:
  - `config.mjs`;
  - a ilha;
  - o `vigia-pedidos`;
  - o `iniciar.ps1`.
- Não há mudança de pasta a fazer.
- Hoje o `atualizar` deixa o serviço rodando da versão velha, que então fica presa e escapa da poda.
- O `instalar` encontra a porta 2785 ocupada pelo serviço do `Documents\Omni` e o deixa lá.

## Tarefas

### T1: troca do WhatsApp no `instalar` e no `atualizar`

**Files:**
- Modify: `scripts/omni-instalar.ps1`. Entra a função nova `Trocar-WhatsApp`, chamada nos modos `instalar` e `atualizar`.
- Test: `testes/omni-instalar.test.mjs`.

**Regras:**
- Lê `<dados>\servico.pid` e `<dados>\ponte.pid` (o `OMNI_INSTALAR_WHATSAPP_DADOS` vale também aqui).
- Um processo só é parado quando as três condições valem:
  - ele existe;
  - a linha de comando contém `servicos\whatsapp\dist\main.js` (serviço) ou `servicos\whatsapp\omni\ponte.mjs` (ponte);
  - essa linha não contém `<raiz da versão>\servicos\whatsapp\`.
- Para a ponte primeiro, depois o serviço, com `taskkill /T /F`, e espera a saída por até 15 s.
- Grava o passo `whatsapp-trocado`, com o que parou, e só quando parou algo.
- **No `instalar`** (sem `-NaoAbrir`): troca e depois `Subir-WhatsApp`, como antes.
- **No `atualizar`:** só sobe a versão nova se parou alguma coisa. Quem não estava rodando continua parado (o vigia sobe pela versão nova). A troca vem antes da poda, para a versão velha sair livre.
- A ponte sobrevive ao próprio reinício desde `0327c8f`: o pedido em curso é retomado.

- [x] **Teste vermelho:** o `atualizar` de A para B, com serviço e ponte falsos (`node -e` com o caminho de A na linha de comando), para os dois e roda o `iniciar.ps1` de B (um falso commitado na origem, que só anota o `$PSScriptRoot`).
- [x] **Segundo teste:** um pid reaproveitado por outro programa, e uma ponte que já roda da versão atual, ficam vivos, sem passo `whatsapp-trocado` e sem subir nada.
- [x] **Terceiro teste:** o `instalar` sem `-NaoAbrir` troca um serviço que roda de fora de `versoes` (o caso desta máquina, que roda de `Documents\Omni`).
- [x] Implementar e ler o verde. Rodar o arquivo inteiro.
- [x] Mutantes, que precisam morrer pela asserção:
  - tirar o filtro da raiz atual;
  - tirar o filtro da marca da linha de comando.
- [x] Commit.

### T2: conferência do Crachá

**Files:**
- Create: `scripts/omni-conferir-cracha.mjs`.
- Test: `testes/omni-conferir-cracha.test.mjs`.

**Entrada e leitura:**
- Recebe um JSON exportado do PG por `psql` no 6b. O próprio script monta e mostra a consulta, que é só leitura.
- Consulta: `select ... from access.credential_versions` e `audit.credential_events`, sem coluna de segredo. O PG não guarda segredo, só o `secret_ref`.
- O inventário vem do `inventariarGerenciador` do cofre, que lista os alvos `Omni/*`.

**Saída:** um relatório com uma linha por versão:
- serviço;
- alvo;
- `no-gerenciador` ou `ausente`;
- `no-cofre.db` ou `fora`.

Valores nunca aparecem. A saída é 0 quando tudo existe no Gerenciador.

**Destino:** o JSON e o relatório vão para o backup datado do 6b, nunca para o repo.

- [x] **Teste vermelho:** com exportação e inventário falsos, a versão ausente sai 1 e é nomeada.
- [x] **Teste:** um `secret_ref` fora do formato `credential-ref:windows-<x>` vira `formato-desconhecido`, e nunca é tratado como ok.
- [x] Implementar, ler o verde e commitar.

### T3: `scripts/omni-desligar-5433.ps1`

**Files:**
- Create: `scripts/omni-desligar-5433.ps1`.
- Test: `testes/omni-desligar-5433.test.mjs`. O teste usa pastas temporárias, processos falsos, `pg_ctl` falso e um atalho temporário. Nunca toca o 5433 real.

**Parâmetros e segurança:**
- Parâmetros: `-Dados <pasta data>`, `-Backup <pasta>` e `-Inicializar <pasta>`, **obrigatórios e sem padrão**: quem roda diz onde, sempre. Opcionais: `-Desativados` (padrão `%APPDATA%\omni\atalhos-desativados`), `-Casa <OMNI_HOME>`, `-PgCtl <exe>` (sem ele, acha o `pg_ctl.exe` ao lado do `postgres.exe` que roda com aquela pasta data), `-Porta` (5433), `-Broker` (`omni-access-broker`) e `-Executar`.
- Trava fechado: `$ErrorActionPreference = 'Stop'` e um `trap` que sai 1 antes do passo seguinte. Faltou parâmetro, ou `-Dados` sem `PG_VERSION`: sai 2 sem tocar em nada, mesmo com `-Executar`.
- Sem `-Executar`, só imprime o plano em JSON (recibo, porta, PIDs do broker, para onde vai a cópia e o atalho) e sai 0, sem mexer em nada.
- Achado na escrita: no PowerShell `$broker` e `$Broker` são a mesma variável, e o `[string]` do parâmetro achatava a lista de PIDs. A lista se chama `$processosBroker`.

**Pré-condição:** o `omni.db` da casa tem o recibo `postgres-5433` na `_importacoes`, lido por `node scripts/omni-importar-5433.mjs --recibo [--casa]` (só leitura; sai 0 com recibo e 3 sem). Sem esse recibo, o script recusa com saída 3.

**Passos com `-Executar`, na ordem que deixa o caminho de volta aberto até o fim:**
1. Para o broker (cliente do PG) pelo processo cuja linha de comando contém `<Broker>.ps1`, com `taskkill /T /F`, e confere que morreu.
2. `pg_ctl stop -D <dados> -m fast -w`; espera a porta fechar e o `postmaster.pid` sumir.
3. Copia `<dados>` para `<Backup>\postgresql-5433-<yyyyMMdd-HHmmss>` e confere contagem de arquivos e tamanho total iguais aos da origem. Se não conferir, sai 1 e o atalho fica onde está: o próximo logon sobe tudo de novo.
4. Só então move o `Omni Runtime.lnk` de `<Inicializar>` para `<Desativados>`. É o mesmo padrão de quando o desktop foi fechado, e é reversível.
5. Nunca apaga a pasta `data` original. O apagamento fica para depois da instalação real verde, à mão.

- [x] **Teste vermelho:** sem `-Executar`, nada muda: a pasta, o atalho e os processos continuam iguais.
- [x] **Teste:** uso errado (pasta data falsa, `-Inicializar` faltando) sai 2 sem tocar em nada, com e sem `-Executar`.
- [x] **Teste:** sem o recibo, sai 3.
- [x] **Teste:** com `-Executar`, a cópia confere, o atalho foi movido, o broker falso morreu e um processo não relacionado continuou vivo.
- [x] Implementar, ler o verde e commitar.

### T4: aposentar o código do broker e do PG

Depende de uma decisão do Weriton: apagar o `apps/omni-desktop` (o Crachá), que é o único consumidor. Sem essa decisão, T4 fica para depois e o 6b só desliga, sem apagar código.

Com a decisão, T4 apaga:
- `apps/omni-desktop`;
- os `scripts/*broker*`, `start-user-omni-runtime*`, `install-user-omni-startup.ps1`, `install-user-omni-runtime-tasks.ps1` e os scripts de provisão do PG;
- `src/adapters/windows/node-access-broker-client.ts`, `src/adapters/postgresql/`, `adaptadores/postgresql/` e os testes deles.

O importador (`omni-importar-5433`) e o `postgres-fio` do cofre ficam.

### T5: release 0.35.0

- [ ] Bump, selo refeito, suíte inteira em segundo plano, `typecheck`, `check` e o `dist` sem diff.
- [ ] PR, CI verde, merge, `plugin update` e o selo conferido.

## Fica para o 6b (máquina)

1. **Prova do §5 no Windows Sandbox**, que precisa de admin e reinício para ser habilitado (decisão do Weriton). A chave admin só aparece numa máquina limpa, porque aqui o serviço real ocupa a 2785.
2. **Backup datado** da casa, do cofre e da pasta do WhatsApp. Depois, o `omni-instalar.ps1 instalar` real, que troca o serviço do `Documents\Omni` para a versão instalada.
3. **Crachá:** exportar o PG com `psql` (só leitura) e rodar a conferência do T2.
4. **5433:** `omni-desligar-5433.ps1`, primeiro sem `-Executar` e depois com ele.
5. **Tarefas:** desregistrar a `Omni Actions - visita` real e conferir o Python da `oraculo-vigia`.
