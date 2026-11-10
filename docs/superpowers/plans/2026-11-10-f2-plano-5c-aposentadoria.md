# F2, plano 5c — tarefas dos agentes no agendador e aposentadoria da pilha velha

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** as `tarefas` que cada agente declara no `agente.json` viram tarefas do Agendador do Windows apontando para a versão instalada do Omni, um lançador único as roda (roteiro com o Claude Code ou comando simples), a ilha ganha o botão de instalar no card apagado, e a pilha velha do Actions (visita em PowerShell, módulos da ilha que liam o depósito direto) sai do repo.

**Architecture:** `listarTarefas` no `nucleo.db` diz o que está instalado nesta máquina; `runtime/tarefa-agente.mjs` (`listar` e `rodar`) resolve raiz, porta e token como as mãos do Actions fazem hoje (os resolvedores saem das `maos-actions.mjs` para `runtime/casa/acesso-agente.mjs`), preenche o roteiro e roda o `claude -p` escondido, com trava, teto e log; `scripts/omni-tarefas.ps1` registra e confere as tarefas do Windows a partir do `listar`; o `omni-instalar.ps1` e a ilha chamam esse script. A ponte do WhatsApp passa a disparar a visita pelo lançador novo.

**Tech Stack:** Node 24 (`node:sqlite`, `node:test`), PowerShell 5.1 (`ScheduledTasks`), Electron 33 (ilha), `claude -p`.

---

## O desenho, em uma tela

- **Nome da tarefa do Windows:** `"<Prefixo> - <agente> - <id>"` (prefixo `Omni` na máquina real, outro nos testes e provas).
- **Ação:** `wscript.exe "<versao>\scripts\omni-tarefa.vbs" <agente> <id> agendada`. O `.vbs` roda, sem janela, `node "<versao>\runtime\tarefa-agente.mjs" rodar <agente> <id> --motivo <motivo>` com o node do `OMNI_NODE` ou do PATH.
- **Gatilho:**
  - `quando.diaria "HH:MM"` vira `-Daily -At HH:MM`.
  - `quando.acada "PT<n>M|PT<n>H"` vira `-Once` agora+intervalo, repetindo pelo intervalo.
  - `seAtrasada` vira `-StartWhenAvailable`.
  - `-MultipleInstances IgnoreNew`.
  - Limite de execução: 45 min para lançador, 10 min para comando.
- **Poda:** o `registrar` só apaga tarefa cujo nome casa com `^<Prefixo> - [a-z][a-z0-9-]* - [a-z][a-z0-9-]*$` e cuja ação contém `omni-tarefa.vbs`. A tarefa do vigia do WhatsApp e a `Omni Actions - visita` antiga nunca casam (a antiga sai à mão no plano 6).
- **`rodar` com lançador:**
  - Lê `<raiz do agente>/<roteiro>`, que precisa ficar dentro da raiz.
  - Preenche só as variáveis declaradas; variável declarada sem valor é erro.
  - As variáveis são:

    | Variável | Valor |
    |---|---|
    | `MOTIVO` | o motivo do disparo |
    | `VISITA` | `yyyy-MM-dd-HHmm`, com `-ss` quando o registro já existe |
    | `HOJE` | `dd/MM/yyyy` |
    | `ACTIONS` | `--seco`, ou `OMNI_ACTIONS`, ou `%USERPROFILE%\Documents\Actions` |
    | `OMNI` | raiz da versão do Omni |
    | `<AGENTE>` (maiúsculas, hífen vira `_`) | raiz do agente |

  - Se o agente serve (modo `servir`), põe `<AGENTE>_API` e `<AGENTE>_TOKEN` (token `visita`) no ambiente. Espera o `servir.json` ficar vivo até 5 min, a corrida do logon.
  - Ambiente do filho:
    - `OMNI_VISITA_ID` e `OMNI_ACTIONS`;
    - `OMNI_VISITA_SECO=1` no seco;
    - sem `ELECTRON_RUN_AS_NODE`.
  - O `claude -p --output-format json` roda com as mesmas ferramentas liberadas e barradas da visita velha, `--add-dir` do Actions, do Omni e do agente e cwd no Actions, recebendo a ordem pelo stdin.
- **`rodar` com comando:** roda `cmd.exe /d /s /c <comando>` na raiz do agente, escondido, sem token.
- **Trava:** `<pasta do banco>/tarefas/<agente>-<id>.trava` com o pid. Se o dono estiver vivo, o estado é `pulada`; se o dono morreu, a trava é sobra.
- **Teto:** 30 min para lançador e 10 min para comando (`--teto-min` muda), com `taskkill /T /F`.
- **Estados e saída:**

  | Estado | Saída |
  |---|---|
  | `concluida` | 0 |
  | `pulada` | 0 |
  | `falhou` | 1 |
  | `interrompida` | 3 |

  - A última linha do stdout é o JSON `{ok, agente, id, estado, ...}`.
  - O log vai para `<pasta do banco>/tarefas/tarefas.log`, uma linha JSON por rodada.
  - Quando o roteiro declara `VISITA` e `ACTIONS` e o registro `visitas/<VISITA>.md` não apareceu, o lançador grava um registro mínimo com o estado e os 300 primeiros caracteres do resultado.
- **Divergente** (manifesto instalado ≠ catálogo): o `listar` mostra a tarefa marcada, o `registrar` pula e o `rodar` recusa.

## Arquivos

| Arquivo | O quê |
|---|---|
| `runtime/casa/loja-nucleo.mjs` | + `listarTarefas(db, {maquina})` |
| `runtime/casa/acesso-agente.mjs` (novo) | `ErroDeAcesso`, `arquivoServir`, `portaDoAgente`, `tokenVisita`; saem das `maos-actions.mjs` |
| `runtime/maos-actions.mjs` | passa a importar de `acesso-agente.mjs` |
| `runtime/casa/entregar-sessao.mjs` | exporta `matarArvore` e `resultadoDoClaude` |
| `runtime/casa/tarefas.mjs` (novo) | puros: `nomeDaTarefa`, `variavelDoAgente`, `idDaVisita`, `hojeBr`, `preencherRoteiro`, `argumentosDoClaude` |
| `runtime/tarefa-agente.mjs` (novo) | CLI `listar` e `rodar` |
| `scripts/omni-tarefa.vbs` (novo) | lançador sem janela |
| `scripts/omni-tarefas.ps1` (novo) | `registrar` e `verificar` `-Prefixo` |
| `scripts/omni-instalar.ps1` | chama `omni-tarefas.ps1` no `Instalar-Comum` e no `verificar` |
| `apps/omni-ilha/instalar-agente.js` (novo) + `main.js`, `preload.js`, `renderer.js` | botão INSTALAR do card apagado |
| `servicos/whatsapp/omni/ponte.mjs` | `chamarVisita` usa o lançador novo |
| `scripts/omni-actions.mjs` | fica só com os comandos de WhatsApp |
| apagar | `apps/omni-ilha/{pontos,mesa,escrita,projetos,execucoes}.js`, `scripts/omni-actions-visita.{ps1,vbs,md}`, `scripts/omni-actions-agendar.ps1` |
| testes | `casa-loja-nucleo`, `casa-tarefas` (novo), `casa-tarefa-agente` (novo), `omni-tarefas-ps1` (novo), `ilha-instalar-agente` (novo), `actions-whatsapp` (novo, herda reação e cota), `actions-organizador` (sai) |

---

### Task 1: `listarTarefas` e os puros de `tarefas.mjs`

**Files:** Modify `runtime/casa/loja-nucleo.mjs`; Create `runtime/casa/tarefas.mjs`; Test `testes/casa-loja-nucleo.test.mjs`, `testes/casa-tarefas.test.mjs`.

- [x] **Teste vermelho de `listarTarefas`** (em `casa-loja-nucleo.test.mjs`):
  - o `completo()` instalado em `pc` devolve as duas tarefas dele com `agente`, `raiz`, `divergente:false` e os campos da tarefa;
  - o `minimo()` não contribui;
  - outra máquina devolve `[]`;
  - uma versão nova registrada em `outra` marca `divergente:true`;
  - os campos do manifesto não sobrescrevem `agente` nem `raiz`.
- [x] **Implementação:**
  ```js
  export function listarTarefas(db, { maquina = maquinaAtual() } = {}) {
    return db.prepare(`SELECT i.agente, i.raiz, i.manifesto_sha256, a.manifesto, a.manifesto_sha256 AS sha_catalogo
      FROM instalacoes i JOIN agentes a ON a.id = i.agente AND a.apagado_em IS NULL
      WHERE i.maquina = ? AND i.apagado_em IS NULL ORDER BY i.agente`).all(maquina).flatMap((l) =>
      (JSON.parse(l.manifesto).tarefas ?? []).map((t) => ({ ...t, agente: l.agente, raiz: l.raiz, divergente: l.sha_catalogo !== l.manifesto_sha256 })))
  }
  ```
- [x] **Testes vermelhos dos puros** (`casa-tarefas.test.mjs`):
  - `nomeDaTarefa('Omni','oraculo','actions-visita') === 'Omni - oraculo - actions-visita'`;
  - `variavelDoAgente('meu-agente') === 'MEU_AGENTE'`;
  - `idDaVisita(new Date(2026,10,10,7,5,9)) === '2026-11-10-0705'`;
  - `hojeBr(...) === '10/11/2026'`;
  - `preencherRoteiro('a {{X}} b {{Y}} {{Z}}', ['X','Y'], {X:'1',Y:'2'}) === 'a 1 b 2 {{Z}}'`, porque só troca as declaradas;
  - com `Y` sem valor, lança `ErroDeTarefa` com código `variavel-sem-valor` e o nome `Y` na mensagem;
  - um valor com `{{Y}}` dentro não é reprocessado;
  - `argumentosDoClaude([...pastas])` começa com `-p --output-format json`, traz as ferramentas liberadas e barradas da visita velha e um `--add-dir` por pasta.
- [x] Implementar, ver verde, commit `feat(casa): listarTarefas e os puros das tarefas dos agentes`.

### Task 2: `runtime/tarefa-agente.mjs` (`listar`, `rodar`)

**Files:**
- Create: `runtime/casa/acesso-agente.mjs`, `runtime/tarefa-agente.mjs`, `testes/fixtures/claude-falso.mjs`.
- Modify: `runtime/maos-actions.mjs`, `runtime/casa/entregar-sessao.mjs`.
- Test: `testes/casa-tarefa-agente.test.mjs`.

O `testes/fixtures/claude-falso.mjs` lê o stdin, grava `{argv, cwd, env:{ORACULO_API, ORACULO_TOKEN, OMNI_VISITA_ID, OMNI_ACTIONS, OMNI_VISITA_SECO, ELECTRON_RUN_AS_NODE}, ordem}` em `CLAUDE_FALSO_REGISTRO`. Conforme `CLAUDE_FALSO_MODO`, ele:
- `ok`: escreve `visitas/<id>.md` e sai 0 com `{"result":"Resumo: feito"}`;
- `sem-registro`: sai 0 sem escrever o registro;
- `erro`: sai 2;
- `dorme`: fica 60 s.

O teste injeta `iniciar = (exe, args, o) => spawn(process.execPath, [FALSO, ...args], o)`.

- [x] **Testes vermelhos**, com casa temporária, `ponteFalsa`, Oráculo falso registrado com a tarefa `actions-visita` (roteiro com `{{MOTIVO}} {{VISITA}} {{HOJE}} {{ACTIONS}} {{ORACULO}} {{OMNI}}`) e `servir.json` com `process.pid`:
  1. **`listar`:** devolve `{ok:true, tarefas:[...]}` com as tarefas do nucleo.
  2. **`rodar` de ponta a ponta:** sai 0 com `estado:'concluida'`.
     - A ordem chega pelo stdin, sem `{{`, com o motivo e as raízes.
     - O ambiente leva `ORACULO_API` com a porta, `ORACULO_TOKEN` igual ao sha do token visita, `OMNI_VISITA_ID`, `OMNI_ACTIONS` e nenhum `ELECTRON_RUN_AS_NODE`.
     - O cwd é a pasta Actions.
     - O cofre registra o uso `tarefa oraculo/actions-visita`.
     - O token nunca aparece no stdout nem no log.
     - O log ganha uma linha `concluida`.
  3. **`--seco <pasta>`:** a ordem começa com `VISITA A SECO`, `OMNI_VISITA_SECO=1` e `ACTIONS` = a pasta seca.
  4. **Trava de dono vivo:** gera `pulada` e saída 0 sem chamar o claude.
  5. **Trava de pid morto:** roda normalmente, e a trava some no fim.
  6. **Teto:** `--teto-min` minúsculo (opção `tetoMs` injetada) com o modo `dorme` gera `interrompida`, saída 3 e o registro mínimo gravado.
  7. **Sem registro:** o modo `sem-registro` gera `concluida` e o registro mínimo com `sem registro`.
  8. **Claude falhou:** o modo `erro` gera `falhou`, saída 1.
  9. **Recusas** (saída 1, JSON com `erro`, claude nunca chamado):
     - tarefa inexistente;
     - agente divergente;
     - roteiro fora da raiz (`../x.md`);
     - servir fora do ar depois da espera (opção `esperaMs` injetada);
     - argumento desconhecido.
  10. **Comando:** a tarefa `comando: 'node -e "require(\'fs\').writeFileSync(\'feito.txt\',\'1\')"'` roda na raiz do agente, gera `concluida`, e o ambiente não leva token.
- [x] **Extrair `acesso-agente.mjs`:** `portaDoAgente(casa, env, vivo, agente)` e `tokenVisita(casa, env, ponte, agente, motivo)` saem das `maos-actions.mjs`. A suíte `casa-maos-actions` segue verde e sem mudar asserção.
- [x] Implementar `rodarTarefa(argv, {env, saida, casa, ponte, iniciar, vivo, agora, tetoMs, esperaMs, raizOmni})`, ver verde, commit `feat(casa): tarefa-agente lista e roda as tarefas dos agentes`.

### Task 3: `omni-tarefa.vbs` e `omni-tarefas.ps1`

**Files:** Create `scripts/omni-tarefa.vbs`, `scripts/omni-tarefas.ps1`; Test `testes/omni-tarefas-ps1.test.mjs`.

O `.vbs` recebe `agente id motivo` e roda `node "<pasta>\..\runtime\tarefa-agente.mjs" rodar <agente> <id> --motivo <motivo>` com `Run ..., 0, True`, usando o node do `OMNI_NODE` ou o `node` do PATH. Ele espera o lançador e sai com o código dele (2 sem os três argumentos), para o `LastTaskResult` do Agendador mostrar o resultado de verdade; o teto de 30 min do lançador fica abaixo dos 45 min da tarefa.

`omni-tarefas.ps1 -Modo registrar|verificar -Prefixo <p> [-Raiz <versao>]` tem este contrato:
- roda `node <Raiz>\runtime\tarefa-agente.mjs listar`;
- `registrar` cria ou atualiza com `-Force` cada tarefa não divergente e poda as órfãs do mesmo prefixo que apontam para `omni-tarefa.vbs`;
- `verificar` confere que cada tarefa existe, aponta para o `.vbs` desta raiz e tem o gatilho certo;
- a última linha é o JSON `{ok, modo, registradas, podadas, puladas, divergencias}`; sai 0 ou 1.

- [x] **Testes vermelhos** (só Windows; prefixo `OmniTeste<aleatório>`; `Unregister-ScheduledTask` no `finally`; casa temporária com dois agentes falsos instalados):
  1. **`registrar`** cria as duas tarefas:
     - a diária vira `Daily 07:00` com `StartWhenAvailable` true;
     - a `acada` vira repetição `PT15M` com `StartWhenAvailable` false;
     - a ação é `wscript.exe` com `"<raiz>\scripts\omni-tarefa.vbs" <agente> <id> agendada`;
     - nenhuma das duas rodou (`LastTaskResult` 267011).
  2. **`verificar`** sai 0 com `ok:true`.
  3. **Divergência e poda:** uma tarefa à mão `<Prefixo> - velho - x` com ação no `omni-tarefa.vbs` é podada, e `<Prefixo> - vigia do WhatsApp` fica.
  4. **Agente divergente** sai em `puladas` e não é registrado.
  5. **Tarefa adulterada:** se a ação for mudada para outro `.vbs`, o `verificar` sai 1 e aponta qual tarefa.
- [x] Implementar, ver verde, commit `feat(executor): tarefas dos agentes no agendador do Windows`.

### Task 4: o instalador registra e confere as tarefas

**Files:**
- Modify: `scripts/omni-instalar.ps1` (`Registrar-Tarefas`, `Verificar-Tarefas`).
- Test: o teste do instalador que já cobre `Registrar-Tarefas`, procurado por `vigia do WhatsApp` em `testes/`.

- [x] **Teste vermelho:** depois de `instalar` com o agente instalável falso (que passa a declarar uma tarefa `comando`), a tarefa `<Prefixo> - <agente> - <id>` existe, e o `verificar` traz o passo `tarefas-agentes ok`.
- [x] **Implementação:**
  - `Registrar-Tarefas` chama `omni-tarefas.ps1 registrar -Prefixo $PrefixoTarefa -Raiz $versao` depois do vigia;
  - `Verificar-Tarefas` chama o `verificar`;
  - a recusa entra no passo com o detalhe do JSON.
- [x] Ver verde, commit `feat(executor): instalar registra as tarefas dos agentes`.

### Task 5: botão INSTALAR no card apagado da ilha

**Files:**
- Create: `apps/omni-ilha/instalar-agente.js`.
- Modify: `apps/omni-ilha/main.js`, `preload.js`, `renderer.js`.
- Test: `testes/ilha-instalar-agente.test.mjs`.

`instalarAgente({agente, pasta, raizOmni, env, spawn, prefixo})` funciona assim:
- confere que `<pasta>/executor/agente.json` existe e que `agente` é o esperado, sem rodar nada quando não confere;
- roda `node <raizOmni>/runtime/executor.mjs instalar-agente --raiz <pasta>`, conferindo o `{ok}` da última linha;
- depois roda `powershell -File <raizOmni>/scripts/omni-tarefas.ps1 registrar -Prefixo <prefixo> -Raiz <raizOmni>`;
- devolve `{ok, erro?, tarefas?}`.

- [x] **Testes vermelhos com spawn injetado:**
  1. **Caminho feliz:** chama o executor e depois o registrar, nessa ordem e com esses argumentos.
  2. **Manifesto de outro agente:** devolve `ok:false` e não spawna nada.
  3. **Sem `agente.json`:** devolve `ok:false`.
  4. **Executor recusou:** devolve `ok:false` com o erro dele e não registra tarefas.
  5. **`ELECTRON_RUN_AS_NODE`:** não vai para o filho.
- [x] **No `main.js`:**
  - `ipcMain.handle('agente:instalar', (e, agente) => ...)`: o `dialog.showOpenDialog` escolhe a pasta, `instalarAgente` roda com o prefixo `Omni` e depois a ilha relê;
  - o `preload` expõe `instalarAgente(agente)`;
  - no `renderer`, o clique no card `ausente` chama `ponte.instalarAgente('oraculo')` e mostra o resultado no rótulo do card (`INSTALANDO…` e depois `INSTALADO` ou `FALHOU`).
- [x] Ver verde, commit `feat(ilha): instalar agente pelo card apagado`.

### Task 6: aposentar a pilha velha

**Files:**
- Modify: `servicos/whatsapp/omni/ponte.mjs:484-493`, `scripts/omni-actions.mjs`, `README.md`, `scripts/omni-instalar.ps1:337`.
- Delete: `apps/omni-ilha/{pontos,mesa,escrita,projetos,execucoes}.js`, `scripts/omni-actions-visita.{ps1,vbs,md}`, `scripts/omni-actions-agendar.ps1`.
- Test: `testes/actions-whatsapp.test.mjs` (novo), `testes/actions-organizador.test.mjs` (sai).

- [x] **Testes vermelhos:**
  - **ponte:** a ponte exporta `comandoDaVisita(motivo)`, que devolve `[process.execPath, [<raiz>/runtime/tarefa-agente.mjs, 'rodar', 'oraculo', 'actions-visita', '--motivo', motivo]]`; o teste falha enquanto aponta para o `.ps1`;
    - *Desvio registrado na execução:* a função mora em `servicos/whatsapp/omni/visita.mjs`, e a ponte importa de lá. Exportar da ponte obrigaria o teste a importá-la, e o import dela tem efeito colateral (`setInterval`, varredura, retomada de pedido). O teste vermelho foi o do depósito, pela asserção.
    - *Cota:* o teste velho gastava a cota com `propor-veredito`, que virou comando do depósito. Agora ela vale para o `avisar`: o teste novo prova a seco e a cota esgotada (2 avisos por dia).
  - **reação e cota:** os testes de `aprovacoes.mjs` e o `avisar` seco/cota passam para `actions-whatsapp.test.mjs`;
  - **comando do depósito:** `omni-actions.mjs mesa` responde `{ok:false, erro:'comando do depósito: use o omni-actions.mjs do Oráculo'}`.
- [x] **Implementação:**
  - emagrecer `omni-actions.mjs`: tirar os imports da ilha, deixar `RAIZ`, cota, `formatarData` em linha e só os comandos de WhatsApp;
  - repontar a ponte;
  - apagar os arquivos;
  - corrigir o README e o comentário.
- [x] **Conferências:**
  - `rg "pontos.js|mesa.js|escrita.js|omni-actions-visita|omni-actions-agendar" --glob '!docs/**'` vazio;
  - a suíte inteira, o typecheck e o check;
  - commit `refactor(actions): aposenta a pilha velha do Actions`.

### Task 7: prova real

- [x] **Instalação de prova** (molde `prova-p5b2.ps1`):
  - `omni-instalar.ps1 instalar` numa pasta temporária, com o Oráculo de verdade (cópia por `git archive`), `-PrefixoTarefa OmniProva` e as pastas de atalho temporárias;
  - conferir que `OmniProva - oraculo - actions-visita` existe (Daily 07:00, StartWhenAvailable) e nunca rodou.
- [x] **Visita a seco real:**
  - subir `runtime/servir.mjs` da versão de prova sem a ilha, com o stdin aberto;
  - rodar `node <versao>\runtime\tarefa-agente.mjs rodar oraculo actions-visita --motivo manual --seco <cópia do Actions> --teto-min 12`;
  - conferir o estado, o registro `visitas/<id>.md` na cópia e o token ausente do log;
  - o Actions real fica intacto.
- [x] **`finally`:** desregistrar `OmniProva*`, fechar o servir e conferir que as tarefas reais estão intactas.

*Medido na execução (10/11):*
- **1ª rodada:** o `instalar` recusou a versão com `integridade: drifted`, porque o selo ainda era o da 0.33.0. O bump da T8 subiu para antes da prova.
- **2ª rodada (`f38cce2`):**
  - O `instalar` saiu 0 em 316 s.
  - A visita a seco real terminou `concluida` em 472 s, e a própria visita achou um defeito: a seco, ela recebia a porta e o token `visita` do servir do agente, que fixa a raiz do Actions quando sobe. As mãos escreviam fora da cópia; numa máquina de verdade, no Actions real.
  - Conserto em `78ad9c6`: a seco, o `tarefa-agente` não entrega `ORACULO_API` nem `ORACULO_TOKEN`, não lê o token, e a ordem avisa que as mãos estão desligadas.
  - A segunda camada, as mãos recusarem quando a raiz servida não é a da visita, ficou com a sessão do Oráculo.
- **3ª rodada (`78ad9c6`):**
  - O `instalar` saiu 0 em 319 s.
  - `OmniProva - oraculo - actions-visita` estava Daily 07:00, com StartWhenAvailable e nunca rodada; `oraculo-vigia` ficou desligada logo no registro.
  - A visita a seco terminou `concluida` em 394 s, com o registro gravado na cópia e a raiz servida intocada.
  - Nenhum token apareceu nos logs, e o servir saiu sozinho ao fechar o stdin.
  - As tarefas reais e o Actions real ficaram intactos.
  - O diff do repo do Oráculo é só o trabalho em curso da sessão dele.

### Task 8: release 0.34.0 e entrega

- [x] Bump 0.33.0 → 0.34.0 nos seis lugares, notas no `releases.json` e a impressão digital por último (`f38cce2`; selo refeito em `78ad9c6`).
- [x] No plano-mestre `2026-11-09-f2-casa-instalavel.md`, a linha 5c vira entregue; a linha 6 ganha "desregistrar a tarefa real `Omni Actions - visita`".
- [ ] Suíte inteira, typecheck e check; depois PR, CI verde, merge e `plugin update`, com o selo conferido.
