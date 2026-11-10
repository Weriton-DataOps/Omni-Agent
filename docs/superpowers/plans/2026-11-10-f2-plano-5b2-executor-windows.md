# F2, plano 5b-2: o executor do Windows

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** um arquivo só, `scripts/omni-instalar.ps1`, instala o Omni numa máquina Windows a partir de um commit, sem `Documents\Omni` em lugar nenhum.
- Baixa ou empacota a versão, confere a impressão digital e a guarda em `%LOCALAPPDATA%\omni\versoes\<sha>`.
- Cria a casa e instala os agentes pelo `executor.mjs` (plano 5b-1).
- Prepara a ilha com Electron próprio e o serviço WhatsApp e cria os atalhos.
- Registra a tarefa do vigia e o plugin no Claude Code.
- Leva a chave admin do WhatsApp do `.api-key` para o cofre do Windows.
- Abre a ilha já pedindo o pareamento.

**Arquitetura:**
- O script é casca. O que é regra (impressão digital, casa, agentes) é Node e já tem teste.
- O script fica com o que é do Windows: zip, `npm ci`, atalho `.lnk`, Agendador de Tarefas, `claude plugin` e cofre.
- Cada programa de fora entra por variável de ambiente, para os testes trocarem por falsos:
  - `OMNI_INSTALAR_NODE`;
  - `OMNI_INSTALAR_NPM`;
  - `OMNI_INSTALAR_CLAUDE`;
  - `OMNI_INSTALAR_COFRE` (o `cofre.ps1` do WhatsApp);
  - `OMNI_INSTALAR_URL` (molde da URL do zip, com `{sha}`).
- Saída: o log vai para o stderr. A última linha do stdout é um JSON `{ok, modo, sha, versao, passos:[{passo, ok, detalhe}]}`.
- Códigos de saída: 0 ok, 1 falha, 2 uso errado.

**Tecnologia:** PowerShell 5.1 (o do Windows, sem módulo extra) e Node ≥ 24. Os testes são `node:test`, chamando `powershell.exe -File` com pastas temporárias.

**Desenho:** [Casa única](../specs/2026-11-04-casa-unica-tres-agentes-design.md), §4 (passos 1, 2, 4, 5, 8 e 9) e §4.1. Plano mestre: [F2](2026-11-09-f2-casa-instalavel.md), linha 5b-2.

**Situação em 10/11/2026:**
- O ramo `casa-f2-p5b2` sai de `origin/main` em `be7d549`, o merge do PR #14 (5b-1, release 0.32.0, instalada e `verified`).
- Este plano acrescenta à linha 5b-1 do plano mestre o número do PR e o sha do merge.

---

## O que já existe e este plano usa (lido no código em 10/11)

- **`runtime/executor.mjs`:**
  - comandos `exportar --saida`, `importar --pacote [--substituir]`, `verificar [--pacote]`, `instalar` e `instalar-agente --raiz`;
  - códigos de saída: 0 ok, 2 uso, 3 recusa, 1 falha.
- **`runtime/integridade-release.mjs`:**
  - `verificarIntegridadeRelease(raiz)` confere o `contratos/atualizacao/integridade.json` contra o payload;
  - `lerIdentidadeRelease(raiz)` lê a versão;
  - a impressão digital é de texto canônico, então o CRLF do Windows não a muda.
- **`runtime/nucleo.mjs`, `casaDoNucleo(env)`:** usa `OMNI_HOME`, senão `%APPDATA%\omni`.
- **`runtime/casa/banco.mjs`, `pastaDoBanco`:** para a casa real, o banco fica em `%LOCALAPPDATA%\omni\casa`.
- **`apps/omni-ilha/iniciar.ps1 -SoPreparar`:**
  - garante o `electron.exe` depois do `npm ci`, completando a extração que o Node 24 deixa pela metade;
  - a ilha acha o Omni em `path.join(__dirname, '..', '..')` (`casa-servir.js:22`), que é a própria versão.
- **`apps/omni-ilha/main.js:290`:** com `OMNI_ILHA_PAREAR=1`, abre o pareamento na primeira subida.
- **`servicos/whatsapp`:**
  - o código fica na versão;
  - dados, config, logs e `data/.api-key` ficam em `%APPDATA%\omni\whatsapp`, que é o diretório de trabalho do `iniciar.ps1`;
  - o `dist/` não está no git, então precisa de `npm ci` e `npm run build` (`nest build`).
- **`servicos/whatsapp/omni/cofre.ps1`:** `-Acao ler|gravar|apagar -Nome <nome>`, com o segredo só pelo stdin e o stdout. A saída 2 de `ler` significa "não existe".
  - O nome admin é `omni/whatsapp/admin` (`cofre.mjs:11`).
- **Hoje, nesta máquina (medido em 10/11):**
  - a tarefa `Omni - vigia do WhatsApp`, de 5 em 5 minutos, chama `wscript "…\Documents\Omni\servicos\whatsapp\omni\vigia-servico.vbs"`;
  - esse `.vbs` tem `Documents\Omni` e `C:\Program Files\nodejs\node.exe` chumbados;
  - o atalho do logon `Omni WhatsApp.lnk` aponta para `conhost.exe --headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File "…\Documents\Omni\servicos\whatsapp\omni\iniciar.ps1"`;
  - o `Omni Ilha.lnk` da área de trabalho usa o Electron do `omni-desktop`.
- **O marketplace `omni-hub`** é o git `https://github.com/Weriton-DataOps/Omni-Agent.git`, e o plugin é `omni@omni-hub`.
- **Não há GitHub Release nem tag no repo.**
  - A versão é obtida por commit: o zip de `https://codeload.github.com/Weriton-DataOps/Omni-Agent/zip/<sha>` (pasta interna `Omni-Agent-<sha>/`), ou, com `-Origem`, o `git archive --prefix=Omni-Agent-<sha>/` de um repo local.
  - A prova de que veio o que devia é a impressão digital do payload, não o hash do zip: o GitHub não garante zip byte a byte igual.

## Mapa de arquivos

| Arquivo | Papel |
|---|---|
| `runtime/executor.mjs` | Comando novo `release`: confere a integridade da própria raiz e devolve `{ok, versao, fingerprint}` |
| `scripts/omni-instalar.ps1` (novo) | A casca: modos `instalar`, `atualizar`, `importar`, `exportar` e `verificar` |
| `servicos/whatsapp/omni/vigia-servico.vbs` | Caminho do `.mjs` relativo ao próprio `.vbs`; node do `OMNI_NODE` ou do PATH |
| `testes/executor-release.test.mjs` (novo) | O comando `release` numa cópia boa e numa adulterada |
| `testes/omni-instalar.test.mjs` (novo) | O script inteiro com programas falsos, pasta base temporária e tarefa com prefixo de teste |
| `testes/vigia-vbs.test.mjs` (novo) | Nenhum `.vbs` ou `.ps1` de lançamento da versão tem caminho de usuário chumbado |

---

### Tarefa 1: `executor.mjs release`

**Arquivos:** `runtime/executor.mjs`; teste novo `testes/executor-release.test.mjs`.

- [ ] **Passo 1: teste vermelho.**
  - Copiar o payload da raiz do repo (as pastas de `PAYLOAD_ROOTS` mais `.claude-plugin`) para uma pasta temporária com `cpSync`.
  - Selar a cópia: gravar no `integridade.json` dela a impressão digital calculada sobre ela mesma. Sem isso, o teste ficaria vermelho em todo ramo que mexe no payload antes do bump.
  - Rodar `node <copia>/runtime/executor.mjs release` e conferir saída 0, com JSON `{ok:true, versao:<a do package.json>, fingerprint:/^[a-f0-9]{64}$/}`.
  - Acrescentar uma linha a `<copia>/runtime/servir.mjs` e rodar de novo: saída 3 e `{ok:false, codigo:'integridade'}`.

```js
test('release confere a impressão digital da própria raiz', async (t) => {
  const copia = copiarPayload(t)
  const boa = rodar(copia, ['release'])
  assert.equal(boa.status, 0)
  assert.equal(boa.json.versao, PACOTE.version)
  assert.match(boa.json.fingerprint, /^[a-f0-9]{64}$/)
  appendFileSync(join(copia, 'runtime', 'servir.mjs'), '\n// adulterado\n')
  const ruim = rodar(copia, ['release'])
  assert.equal(ruim.status, 3)
  assert.equal(ruim.json.codigo, 'integridade')
})
```

- [ ] **Passo 2:** rodar e ver vermelho, porque `release` ainda é comando desconhecido (saída 2).
- [ ] **Passo 3: implementar.**

```js
case 'release': {
  lerOpcoes(resto, {})
  const raiz = fileURLToPath(new URL('..', import.meta.url))
  const r = await verificarIntegridadeRelease(raiz)
  if (r.status !== 'verified') { escrever({ ok: false, codigo: 'integridade', estado: r.status }); return 3 }
  escrever({ ok: true, versao: r.releaseVersion, fingerprint: r.fingerprint })
  return 0
}
```

  `verificarIntegridadeRelease` devolve `status`, `fingerprint` e `releaseVersion` (lido em `runtime/integridade-release.mjs:272`). Acrescentar ao `USO` a linha `release   (confere a impressão digital desta versão)`.
- [ ] **Passo 4:** ver o teste verde. Rodar o mutante `status !== 'verified'` → `false`: precisa matar o caso adulterado.

### Tarefa 2: esqueleto, pré-requisitos e versão em `versoes\<sha>`

**Arquivos:** `scripts/omni-instalar.ps1`; teste novo `testes/omni-instalar.test.mjs`.

- [ ] **Passo 1: teste vermelho.**
  - Usar `-Origem <este repo> -Sha <HEAD> -Base <tmp> -SemIlha -SemWhatsApp -SemTarefas -SemPlugin -NaoAbrir -SemWinget` e o `OMNI_HOME` temporário.
  - Esperar saída 0 e `<tmp>\versoes\<sha>\runtime\executor.mjs` presente.
  - Esperar `<tmp>\versoes\atual.json` com `{sha, versao}` e o passo `versao` com `ok:true`.
  - Na segunda vez, o passo `versao` traz `detalhe:'já instalada'`, e o mtime do `executor.mjs` não muda.
  - Com `-Sha` de um commit que não existe: saída 1, sem pasta `versoes\<sha>` e sem `atual.json`.
- [ ] **Passo 2:** rodar e ver vermelho, porque o script ainda não existe.
- [ ] **Passo 3: implementar.**
  - **`param`:**
    - `[ValidateSet('instalar','atualizar','importar','exportar','verificar')] $Modo='instalar'` (posição 0);
    - `$Sha`, `$Origem`, `$Base` (padrão `%LOCALAPPDATA%\omni`), `[string[]]$Agente`, `$Pacote`, `$Saida`, `$PrefixoTarefa='Omni'`, `$PastaAtalhos`, `$PastaInicializar`;
    - os switches `-SemIlha`, `-SemWhatsApp`, `-SemTarefas`, `-SemPlugin`, `-NaoAbrir` e `-SemWinget`.
  - **Pré-requisitos:** `node -p process.versions.node` ≥ 24, `git` só com `-Origem`, e `claude` só sem `-SemPlugin`.
    - Se faltar um e houver `winget` sem `-SemWinget`: `winget install --id OpenJS.NodeJS -e --silent --accept-source-agreements --accept-package-agreements` (`Git.Git` para o git). Depois, nova checagem.
    - Se ainda faltar: falha com o nome do que falta.
  - **`Obter-Versao`:**
    - pasta temporária `versoes\.<sha>.baixando`;
    - com `-Origem`: `git -C $Origem archive --format=zip --prefix=Omni-Agent-$Sha/ -o <tmp>.zip $Sha`;
    - sem ela: `Invoke-WebRequest` da URL (`OMNI_INSTALAR_URL` ou a do codeload, com `{sha}` trocado);
    - `tar.exe -xf` para a temporária;
    - `node <tmp>\Omni-Agent-<sha>\runtime\executor.mjs release` precisa sair 0;
    - só então `Move-Item` para `versoes\<sha>` e `atual.json`. Em qualquer falha, `Remove-Item` da temporária e saída 1.
  - **Já instalada:** `versoes\<sha>` existe e o `release` dela sai 0 → pula.
- [ ] **Passo 4:** ver verde. O mutante "move antes de conferir o release" precisa ser morto pelo caso do sha inexistente com payload adulterado. Gravar no teste uma `-Origem` falsa: um repo temporário com um commit cujo `runtime/servir.mjs` foi alterado.

### Tarefa 3: casa e agentes

- [ ] **Passo 1: teste vermelho.** Na mesma montagem, mais `-Agente <agente falso>`. Reaproveitar o agente falso de `testes/executor-instalar.test.mjs`, movendo `agenteFalso` e o `FALSO` para `testes/apoio/agente-falso.mjs`.
  - Esperar os passos `casa` e `agente:falso` com `ok:true`.
  - Esperar `nucleo.db` com o Omni e o `falso` instalados.
  - Na segunda vez, os dois passos com `ok:true`, e o `agente:falso` com `detalhe` dizendo `sem mudança`.
- [ ] **Passo 2:** vermelho.
- [ ] **Passo 3: implementar.**
  - `Rodar-Executor 'instalar'` e, para cada `-Agente`, `Rodar-Executor 'instalar-agente' '--raiz' <pasta>`. Lê a última linha JSON.
  - Saída 3 do executor vira `ok:false`, com o `codigo` dele no `detalhe`. O script para ali com saída 1.
  - O node usado é `OMNI_INSTALAR_NODE` ou o do PATH, o mesmo do pré-requisito.
- [ ] **Passo 4:** verde. O mutante "ignora o código de saída do executor" precisa morrer num agente que recusa (o modo `recusar` do falso).

### Tarefa 4: ilha, serviço WhatsApp e atalhos

- [ ] **Passo 1: teste vermelho.**
  - Usar um npm falso: um `.cmd` que grava os argumentos e a pasta em `npm.log` e cria `node_modules\electron\dist\electron.exe` vazio.
  - Usar `-PastaAtalhos <tmp>\atalhos` e `-PastaInicializar <tmp>\inicializar`.
  - **Ilha:** `npm.log` com `ci` em `versoes\<sha>\apps\omni-ilha`, e `Omni Ilha.lnk` em `atalhos`, com alvo `conhost.exe` e argumentos contendo `versoes\<sha>\apps\omni-ilha\iniciar.ps1`.
  - **WhatsApp:** `npm.log` com `ci` e `run build` em `versoes\<sha>\servicos\whatsapp`, e `Omni WhatsApp.lnk` em `inicializar`, apontando para `versoes\<sha>\servicos\whatsapp\omni\iniciar.ps1`.
  - Nenhum argumento de atalho com `Documents\Omni`.
- [ ] **Passo 2:** vermelho.
- [ ] **Passo 3: implementar.**
  - **`Preparar-Ilha`:** `npm ci` em `apps\omni-ilha`, depois `powershell -File iniciar.ps1 -SoPreparar`. A preparação não roda quando o npm é falso, porque o teste confere só o `electron.exe`.
  - **`Preparar-WhatsApp`:** `npm ci` e `npm run build` em `servicos\whatsapp`.
  - **`Criar-Atalho $pasta $nome $ps1`:** `WScript.Shell.CreateShortcut`, com `TargetPath = $env:SystemRoot\System32\conhost.exe` e `Arguments = '--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $ps1 + '"'`, igual ao atalho do WhatsApp de hoje.
  - **Pastas padrão:**
    - `[Environment]::GetFolderPath('Desktop')` mais `Programs`, para a ilha;
    - `[Environment]::GetFolderPath('Startup')`, para o WhatsApp.
- [ ] **Passo 4:** verde.

### Tarefa 5: o vigia sem caminho chumbado e a tarefa agendada

**Arquivos:** `servicos/whatsapp/omni/vigia-servico.vbs`; teste novo `testes/vigia-vbs.test.mjs`; `scripts/omni-instalar.ps1`.

- [ ] **Passo 1: teste vermelho.**
  - **`vigia-vbs.test.mjs`:** lê `vigia-servico.vbs` e `apps/omni-ilha/iniciar.ps1` e exige zero ocorrências de `Users\`, `Documents\Omni` e `Program Files\nodejs`. Hoje o `.vbs` falha nas duas últimas.
  - **`omni-instalar.test.mjs`:**
    - com `-PrefixoTarefa ('OmniTeste' + aleatório)` e sem `-SemTarefas`, a tarefa `<prefixo> - vigia do WhatsApp` existe;
    - a ação dela é `wscript.exe` com o argumento `"<base>\versoes\<sha>\servicos\whatsapp\omni\vigia-servico.vbs"`;
    - o gatilho repete de 5 em 5 minutos;
    - o `finally` do teste remove a tarefa e confere que sumiu.
- [ ] **Passo 2:** vermelho.
- [ ] **Passo 3: implementar.**

```vbs
' Lança o vigia do serviço WhatsApp sem piscar janela a cada 5 minutos.
' O .mjs mora ao lado deste arquivo, na versão instalada; o node vem do OMNI_NODE ou do PATH.
Dim shell, fso, pasta, node
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
pasta = fso.GetParentFolderName(WScript.ScriptFullName)
node = shell.ExpandEnvironmentStrings("%OMNI_NODE%")
If node = "%OMNI_NODE%" Or node = "" Then node = "node.exe"
shell.Run """" & node & """ """ & pasta & "\vigia-servico.mjs""", 0, False
```

  **`Registrar-Tarefas`:**
  - ação `New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + $vbs + '"')`;
  - gatilho `New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)`;
  - as mesmas regras do `omni-actions-agendar.ps1`, com `-ExecutionTimeLimit` de 10 minutos;
  - principal `Interactive`/`Limited`;
  - `Register-ScheduledTask -Force`.

  A visita das 7h fica para o 5c, que a move para o manifesto do Oráculo.
- [ ] **Passo 4:** verde. Conferir pelo Agendador que nenhuma tarefa `OmniTeste*` sobrou.

### Tarefa 6: plugin no Claude Code

- [ ] **Passo 1: teste vermelho.**
  - Usar um `claude` falso: um `.cmd` que grava os argumentos em `claude.log` e responde ao `plugin marketplace list` com um texto sem `omni-hub`.
  - Sem `-SemPlugin`, o log precisa ter, nesta ordem:
    - `plugin marketplace add https://github.com/Weriton-DataOps/Omni-Agent.git` (a URL, como o `omni-hub` desta máquina, que é fonte Git e não GitHub);
    - `plugin install omni@omni-hub --scope user`.
  - Com o falso respondendo `omni-hub` no `list` e `omni@omni-hub` no `plugin list`:
    - nada de `add`;
    - `plugin marketplace update omni-hub`;
    - `plugin update omni@omni-hub --scope user`.
- [ ] **Passo 2:** vermelho.
- [ ] **Passo 3: implementar.** `Instalar-Plugin` com as duas ramificações. O executável é `OMNI_INSTALAR_CLAUDE`, senão `claude` do PATH, senão `%APPDATA%\npm\claude.cmd`.
- [ ] **Passo 4:** verde.

### Tarefa 7: chave admin do WhatsApp e ilha aberta

- [ ] **Passo 1: teste vermelho.**
  - Usar um cofre falso: um `.ps1` com os mesmos parâmetros do `cofre.ps1`. Ele guarda em `<tmp>\cofre\<nome com / trocado>.txt`, e o `ler` sai 2 quando o arquivo não existe.
  - Fazer `OMNI_INSTALAR_WHATSAPP_DADOS=<tmp>\wa` com `data\.api-key`, e tirar o `-SemWhatsApp` com o npm falso.
  - **Admin:** o cofre falso fica com `omni/whatsapp/admin` igual ao conteúdo do `.api-key`.
  - **Sem vazamento:** a saída inteira do script não contém o valor.
  - **Segunda vez:** com o cofre já preenchido, o passo diz `já no cofre` e não regrava (mtime igual).
  - **Sem `.api-key`:** o passo fica `ok:false` com `detalhe:'serviço ainda não gerou a chave'`. Nesse caso o script não falha: o pareamento pela ilha ainda funciona sem ela.
- [ ] **Passo 2:** vermelho.
- [ ] **Passo 3: implementar.**
  - **`Guardar-ChaveAdmin`:**
    - `ler` sai 0 → pula;
    - `.api-key` ausente → espera até 180 s se o serviço foi iniciado neste run, senão desiste;
    - senão `gravar`, com o valor só pelo stdin do processo.
  - **Subir o serviço:** o script chama o `servicos\whatsapp\omni\iniciar.ps1` da versão (idempotente) antes de esperar a chave. Isso só acontece sem `-NaoAbrir`, porque os testes nunca sobem o serviço de verdade.
  - **Abrir a ilha:** sem `-NaoAbrir`, `$env:OMNI_ILHA_PAREAR='1'` e `Start-Process` do `iniciar.ps1` da ilha.
- [ ] **Passo 4:** verde. O mutante "imprime o detalhe com o valor" precisa morrer pela asserção de vazamento.

### Tarefa 8: `atualizar`, `importar`, `exportar` e `verificar`

- [ ] **Passo 1: teste vermelho.**
  - **`verificar`**, depois de um `instalar`:
    - os passos `release` (da versão atual), `casa` (`executor verificar`), `atalhos` e `tarefas` (quando houver), todos `ok`;
    - com `atual.json` apontando para um sha sem pasta: saída 1.
  - **`atualizar`:**
    - partindo de uma `-Origem` com dois commits, instala o primeiro e atualiza para o segundo;
    - `atual.json` passa a ser o segundo e os atalhos apontam para ele;
    - as duas pastas ficam (a anterior é o caminho de volta);
    - um terceiro `atualizar` apaga a mais antiga, e ficam só a atual e a anterior.
  - **`exportar -Saida`** e **`importar -Pacote`:** repassam ao `executor.mjs` da versão atual e devolvem o JSON dele no passo.
- [ ] **Passo 2:** vermelho.
- [ ] **Passo 3: implementar.**
  - `atualizar` = `Obter-Versao`, mais os passos idempotentes do `instalar` (casa, ilha, WhatsApp, atalhos, tarefas e plugin), mais a poda das versões. `atualizar` não reabre a ilha nem pede pareamento.
  - O cofre do Omni (`runtime/cofre.mjs exportar|importar`) fica fora deste modo. A frase-mestra é digitada na ilha (§8.4), e o card Cofre já faz isso.
- [ ] **Passo 4:** verde.

### Tarefa 9: prova, release, PR e instalação

- [ ] **Passo 1:** suíte inteira, `npm run typecheck` e `npm run check` lidos; `dist` limpo.
- [ ] **Passo 2: prova nesta máquina, sem tocar a casa real.**
  - **Montagem:**
    - `-Base` e `OMNI_HOME` temporários, e `-Origem` = este repo no commit do PR;
    - o Oráculo de verdade (cópia por `git archive`) como `-Agente`;
    - npm de verdade, para a ilha e o WhatsApp (pode levar minutos);
    - `-PrefixoTarefa OmniProva`, um cofre falso e `-SemPlugin`. O plugin real já está instalado e não entra no ensaio.
  - **Conferências:**
    - `electron.exe` da ilha presente;
    - `dist\main.js` do WhatsApp presente;
    - tarefa com o caminho da versão;
    - `verificar` todo verde.
  - **Limpeza:** remover a tarefa e a pasta. O serviço WhatsApp não sobe (`-NaoAbrir`), e nenhum QR é gerado.
- [ ] **Passo 3:** a release 0.33.0 (as `NOTAS`, o `executor/agente.json` e a impressão digital), PR, CI verde e merge.
- [ ] **Passo 4:** `plugin update`. Conferir a raiz instalada `verified` 0.33.0, com `scripts/omni-instalar.ps1` presente.
  - A instalação real nesta máquina é o plano 6: troca as tarefas e os atalhos de `Documents\Omni` com backup datado.

## Fora deste plano

- **GitHub Release com o `omni-instalar.ps1` anexo e o sha carimbado:** fica para o plano 6, quando houver a primeira instalação de verdade. Até lá, o `-Sha` é passado na mão.
- **Tarefas declaradas pelos agentes (`tarefas` do manifesto):** a `actions-visita` do Oráculo fica para o 5c.
- **As chaves com escopo do WhatsApp (`chaves.mjs`):** dependem das duas sessões pareadas, então vêm depois do pareamento pela ilha (plano 4c).
