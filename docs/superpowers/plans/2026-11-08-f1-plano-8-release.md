# F1, plano 8: release 0.26.0

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** fechar a F1 numa release: versão 0.26.0 nos metadados, o fingerprint do payload gravado no contrato, a entrada no histórico, o verify inteiro verde e o PR do ramo `casa-sqlite-f1` para o `main`.

**Architecture:** nenhum código novo. A release só toca os cinco arquivos de metadado (`.claude-plugin/plugin.json`, `package.json`, `package-lock.json`, `contratos/atualizacao/integridade.json` e `contratos/atualizacao/releases.json`). Os três primeiros não estão nas raízes do payload, e os dois do contrato estão na lista `excluded`: por isso trocar a versão não muda o fingerprint, e o valor que o plano 7 calculou é o que entra.

**Tech Stack:** Node 22 (`node:test`), `runtime/integridade-release.mjs` (`calcularFingerprintPayload`), `npm run verify`, GitHub CLI.

---

**Situação em 08/11/2026:** Entregue no commit `3c2b8ae`, com a versão 0.26.0 nos cinco arquivos de metadado e o fingerprint `278ef6bb2382771b7e6c10010b7f119686cc29d3030fee42f0ffb01459bc1d2d` no contrato. O verify inteiro ficou verde, sem o vermelho de nascença. O CI ficou verde nos dois jobs, e o PR #4 está aberto. O merge espera o Weriton.

Planos anteriores: [plano 1](2026-11-04-f1-casa-sqlite.md) (o escopo da F1 está na tabela dele) e [plano 7](2026-11-08-f1-plano-7-degradacoes.md), cuja T3 deixou o único vermelho do verify no `testes/integridade-release.test.mjs:165` e calculou o `expected` `278ef6bb2382771b7e6c10010b7f119686cc29d3030fee42f0ffb01459bc1d2d`.

## Decisões

1. **Versão 0.26.0, não 0.25.6.** A F1 traz capacidade nova (três bancos, cofre, núcleo, diagnóstico), não só correção.
2. **O fingerprint vem do código, nunca digitado.** Ele é recalculado por `calcularFingerprintPayload` antes da troca e conferido contra o do plano 7; o script só grava se os dois baterem, e o mesmo cálculo depois da troca tem de dar o mesmo valor.
3. **O `packages[""].version` do `package-lock.json` sobe junto.** Ele ficou em `0.25.2` desde a 0.25.3, porque as três releases seguintes só trocaram a linha 3 do lock. O npm grava as duas; o lock volta a ser o que o `npm install` geraria.
4. **O script de versão edita texto, não reserializa o JSON,** e para se algum trecho não aparecer exatamente o número de vezes esperado: rodado de novo, ele recusa tudo e não grava nada. O fecho do `releases.json` existe antes e depois da troca, então uma guarda própria recusa a versão que já está no histórico.
5. **O histórico em português sem acento,** como as entradas da 0.25.x, e sem endereço, conta, telefone ou pasta de usuário: o repositório é público.
6. **O `release-gate` (`npm run release:gate`, chamado no `prepack`) fica fora.** Ele audita a casa real do Omni (`casaDoOmni()`), e nenhum plano da F1 toca a casa real; a guarda `Test-Path "$env:LOCALAPPDATA\omni\casa"` segue `False` do começo ao fim.
7. **O PR leva o ramo inteiro,** pela conta dona do repositório: os 29 commits que já estavam fora do `main` antes deste plano (os 15 dos planos 1 a 7, os três consertos de fila e varredura, os 10 do ramo `omni-agenda-e-correcoes` que entraram pelo merge de base e esse merge) e os dois deste plano. **O merge fica com o Weriton**, como merge commit, nunca rebase nem squash.

## Mapa de arquivos

| Arquivo | O que muda |
|---|---|
| `.claude-plugin/plugin.json` | `version` 0.25.5 → 0.26.0 |
| `package.json` | `version` 0.25.5 → 0.26.0 |
| `package-lock.json` | `version` da raiz 0.25.5 → 0.26.0 e `packages[""].version` 0.25.2 → 0.26.0 |
| `contratos/atualizacao/integridade.json` | `identity.version` e `identity.releaseFingerprint` |
| `contratos/atualizacao/releases.json` | entrada nova 0.26.0, com nove mudanças |
| `docs/superpowers/plans/2026-11-04-f1-casa-sqlite.md` | linha 8 do escopo: "entregue" |
| `docs/superpowers/plans/2026-11-08-f1-plano-8-release.md` | este plano |

## Executor

1. Tudo roda da raiz do repositório, no ramo `casa-sqlite-f1`; `$rascunho` é `Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'`.
2. Antes e depois de cada tarefa, a guarda `Test-Path "$env:LOCALAPPDATA\omni\casa"` dá `False`.
3. Uma suíte pesada por vez; o verify só roda com o worktree no estado final dos metadados.
4. Commit só depois do verde lido; push e PR pela conta `Weriton-DataOps`, que volta à conta anterior no `finally`.
5. **Desvio:** o script de versão rodou na execução real com a raiz do repositório escrita por extenso; a cópia abaixo usa `process.cwd()`, que dá a mesma raiz quando roda dela, e ganhou a guarda do histórico (decisão 4) depois da primeira rodada, que é a que gravou. As duas versões gravam o mesmo resultado; a segunda rodada da cópia final recusou tudo, como esperado.

## Tarefa 1: versão e fingerprint

- [x] **Passo 1: ver o vermelho.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
node --test --test-concurrency=1 testes/integridade-release.test.mjs testes/pacote.test.mjs *> "$rascunho\p8-antes.txt"; "saida: $LASTEXITCODE"
Get-Content "$rascunho\p8-antes.txt" -Encoding UTF8 | Select-String -Pattern '(tests|pass|fail) \d+\s*$|✖' | ForEach-Object { $_.Line }
```

Esperado: `saida: 1`; `tests 17`, `pass 16`, `fail 1`, e a única falha é "contrato canônico declara a versão e exatamente o fingerprint do payload".

Resultado (08/11): `saida: 1`; `tests 17`, `pass 16`, `fail 1`, só a falha esperada; `False`.

- [x] **Passo 2: o script de versão** (fica no `$rascunho`, não no repositório).

```js rascunho=versao-p8.mjs
// Release 0.26.0: troca a versao nos cinco arquivos de metadado, grava o fingerprint no contrato e abre a
// entrada no historico. Edita o texto (nao reserializa) e grava em LF. Para se algum trecho nao aparecer
// exatamente o numero de vezes esperado. Roda da raiz do repositorio; rodar de novo para no primeiro trecho.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const WT = process.cwd()
const DE = '0.25.5'
const PARA = '0.26.0'
const FP_DE = '3c60182bbef281d96b6782d614482b5e7459ce036468233c29eb6f1af3ef3df3'
const FP_PARA = process.argv[2]
if (!/^[a-f0-9]{64}$/.test(FP_PARA ?? '')) throw new Error('uso: node versao.mjs <fingerprint>')

const MUDANCAS = [
  'Casa SQLite do Omni (F1): runtime/casa abre os bancos embutidos (node:sqlite) com WAL, busy_timeout e BEGIN IMMEDIATE; omni.db passa a ser a fonte da memoria, e memory.json e os .md da memoria do Claude Code viram projecoes dele. Migracoes versionadas e recusadas se editadas depois de aplicadas.',
  'Estados de aprendizado e feedback (os oito JSON de learning/ e feedback/) entram no omni.db pela migracao v3, com importador que nao apaga a origem.',
  'Cofre (cofre.db): importa os .dpapi sem apagar nada, inventaria so os nomes do Credential Manager, sela por DPAPI e exporta e importa em pacote scrypt + AES-256-GCM; CLI runtime/cofre.mjs e card Cofre na ilha falando por ela.',
  'Nucleo (nucleo.db): catalogo de agentes, instalacoes e maquinas, com a loja runtime/casa/loja-nucleo.mjs e a CLI runtime/nucleo.mjs.',
  'Diagnostico ganha o campo degradacoes: le so a cauda (ate 256 KiB) do degradacoes.jsonl da casa e resume por operacao, sem abrir o banco nem criar pasta.',
  'Memoria e feedback de personalidade ganham fila no processo antes da trava de arquivo, e a varredura diaria nao cancela mais quando o placar cai.',
  'Ilha: versionada no repositorio (bancada de fora), vigia do topo reafirma o always-on-top a cada 2 s, e a janela do Actions deixa de abrir vazia.',
  'WhatsApp: a ponte guarda o arquivo de audio encaminhado, a vigia religa o servico, pedido parado avisa sozinho e envio a terceiros autorizado por sessao do PC fica ancorado no transcript.',
  'Despacho: o portao de sessao viva impede o executor de nascer no turno do dono; a vassoura de worktrees passa a ser versionada e poupa trabalho em curso.'
]

const falhas = []
function trocar(rel, pares) {
  const caminho = join(WT, rel)
  let texto = readFileSync(caminho, 'utf8').replace(/\r\n/g, '\n')
  for (const [de, para, vezes] of pares) {
    const n = texto.split(de).length - 1
    if (n !== vezes) { falhas.push(`${rel}: ${JSON.stringify(de)} aparece ${n} vez(es), esperado ${vezes}`); continue }
    texto = texto.split(de).join(para)
  }
  return [caminho, texto]
}

const v = (x) => `"version": "${x}"`
const entrada = `    },\n    {\n      ${v(PARA)},\n      "changes": [\n${MUDANCAS.map((m) => `        ${JSON.stringify(m)}`).join(',\n')}\n      ]\n    }\n  ]\n}\n`
const saidas = [
  trocar('.claude-plugin/plugin.json', [[v(DE), v(PARA), 1]]),
  trocar('package.json', [[v(DE), v(PARA), 1]]),
  trocar('package-lock.json', [[`"name": "omni-agent",\n  ${v(DE)},`, `"name": "omni-agent",\n  ${v(PARA)},`, 1],
    [`"": {\n      "name": "omni-agent",\n      ${v('0.25.2')},`, `"": {\n      "name": "omni-agent",\n      ${v(PARA)},`, 1]]),
  trocar('contratos/atualizacao/integridade.json', [[v(DE), v(PARA), 1], [`"releaseFingerprint": "${FP_DE}"`, `"releaseFingerprint": "${FP_PARA}"`, 1]]),
  trocar('contratos/atualizacao/releases.json', [['    }\n  ]\n}\n', entrada, 1]])
]
// O fecho do historico existe antes e depois da troca: sem esta guarda, so ele duplicaria a entrada.
if (readFileSync(join(WT, 'contratos/atualizacao/releases.json'), 'utf8').includes(v(PARA))) falhas.push(`releases.json: a ${PARA} ja existe`)
if (falhas.length) { for (const f of falhas) console.log(`FALHA ${f}`); process.exit(1) }
for (const [caminho, texto] of saidas) { JSON.parse(texto); writeFileSync(caminho, texto) }
console.log(`gravados ${saidas.length} arquivos; mudancas: ${MUDANCAS.length}`)
```

- [x] **Passo 3: calcular, conferir e gravar.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$calc = "import { calcularFingerprintPayload } from './runtime/integridade-release.mjs'; console.log((await calcularFingerprintPayload(process.cwd())).fingerprint)"
$fp = node --input-type=module -e $calc
'igual ao do plano 7: ' + ($fp -eq '278ef6bb2382771b7e6c10010b7f119686cc29d3030fee42f0ffb01459bc1d2d')
if ($fp -eq '278ef6bb2382771b7e6c10010b7f119686cc29d3030fee42f0ffb01459bc1d2d') { node "$rascunho\versao-p8.mjs" $fp }
'depois igual: ' + ((node --input-type=module -e $calc) -eq $fp)
git diff --numstat
```

Esperado: `igual ao do plano 7: True`; `gravados 5 arquivos; mudancas: 9`; `depois igual: True`; o `numstat` com `1 1` no `plugin.json` e no `package.json`, `2 2` no `integridade.json` e no lock, e `14 0` no `releases.json`.

Resultado (08/11): `igual ao do plano 7: True`; `gravados 5 arquivos; mudancas: 9`; `depois igual: True`; o `numstat` exatamente o esperado. Rodado de novo, o script deu `saida: 1` com seis `FALHA` de trecho ausente e a do histórico (`a 0.26.0 ja existe`), e o `git diff` ficou igual; `False`.

- [x] **Passo 4: o verde.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
node --test --test-concurrency=1 testes/integridade-release.test.mjs testes/pacote.test.mjs testes/release-operacional.test.mjs testes/release-autonoma.test.mjs *> "$rascunho\p8-depois.txt"; "saida: $LASTEXITCODE"
Get-Content "$rascunho\p8-depois.txt" -Encoding UTF8 | Select-String -Pattern '(tests|pass|fail|skipped) \d+\s*$|✖' | ForEach-Object { $_.Line }
```

Esperado: `saida: 0`; `tests 38`, `pass 38`, `fail 0`, `skipped 0`.

Resultado (08/11): `saida: 0`; `tests 38`, `pass 38`, `fail 0`, `skipped 0`; `False`.

## Tarefa 2: o verify inteiro

- [x] **Passo 1:**

```powershell
npm run verify *> "$env:TEMP\omni-p8-verify.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$env:TEMP\omni-p8-verify.txt" -Pattern '^ℹ (tests|pass|fail|cancelled|skipped) \d+', '^\{"ok":true' | ForEach-Object { $_.Line }
```

Esperado: `saida: 0`; as duas suítes do `npm test` sem falha (899 testes em `testes/` e 55 em `.test-dist`, com 4 pulados na primeira), o `test:dist` verde e as cinco linhas `{"ok":true,…}`.

Resultado (08/11): `saida: 0`, em 483 s. `testes/`: `tests 899`, `pass 895`, `fail 0`, `cancelled 0` e `skipped 4`; `.test-dist`: `tests 55`, `pass 55`, `fail 0`; `test:dist`: `tests 1`, `pass 1`, `fail 0`; as cinco linhas `{"ok":true,…}` e o `{"ok":true,"files":59}`. O `:165` passou: é o primeiro verify da F1 sem falha. O rebuild deixou o `dist/` como modificado só no fim de linha (`git diff --stat -- dist` com 0 linhas), e o `git checkout -- dist` o devolveu com saída 0. O arquivo do verify ficou na pasta temporária da sessão, não no caminho do bloco. A guarda deu `False` antes e depois.

## Tarefa 3: commit, push e CI

- [x] **Passo 1: trocar a linha 8 do escopo no plano 1**, de `| 8 | Release 0.26.0: … | — | a escrever |` para o link deste plano com "entregue".

- [x] **Passo 2: varredura e commit.** Os padrões da varredura moram em `$rascunho\padroes-p6.txt`, fora do repositório; ela olha só as linhas adicionadas no índice e imprime o número do padrão e o arquivo, nunca a linha.

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$arquivos = '.claude-plugin/plugin.json', 'package.json', 'package-lock.json', 'contratos/atualizacao/integridade.json', 'contratos/atualizacao/releases.json', 'docs/superpowers/plans/2026-11-04-f1-casa-sqlite.md', 'docs/superpowers/plans/2026-11-08-f1-plano-8-release.md'
git add -- $arquivos
git status --short
'fora de i/lf: ' + @(git ls-files --eol -- $arquivos | Where-Object { $_ -notmatch '^i/lf\s' }).Count
$padroes = @(Get-Content "$rascunho\padroes-p6.txt" | Where-Object { $_ })
$achados = foreach ($linha in (git diff --cached --unified=0 -- $arquivos)) { if ($linha -notlike '+*' -or $linha -like '+++ *') { continue }; for ($i = 0; $i -lt $padroes.Count; $i++) { if ($linha -match $padroes[$i]) { 'padrao ' + ($i + 1) } } }
'achados: ' + @($achados).Count
$email = git log origin/main --author='Weriton-DataOps' -1 --format='%ae'
git -c user.name=Weriton-DataOps -c ('user.email=' + $email) commit -F "$rascunho\msg-p8.txt"
```

Esperado: os 7 arquivos no índice e nenhuma outra linha; `fora de i/lf: 0`; `achados: 0`; autor e committer `Weriton-DataOps`.

Resultado (08/11): Commit `3c2b8ae`, filho do `5848313`, com autor e committer `Weriton-DataOps`: `7 files changed, 228 insertions(+), 7 deletions(-)`. Antes dele, o índice tinha só os 7 arquivos, `fora de i/lf: 0` e `achados: 0`; depois, o `git status --short` ficou vazio.

- [x] **Passo 3: push e CI.**

```powershell
$antes = gh api user --jq .login
gh auth switch --user Weriton-DataOps; try { git push origin casa-sqlite-f1 } finally { gh auth switch --user $antes }
```

Esperado: a conta volta; o mesmo SHA no `ls-remote` e no `HEAD`; **os dois jobs verdes**, pela primeira vez desde o merge de base: o Linux (`portable core`) e o Windows (`full verification`, com o `:165` agora passando).

Resultado (08/11): A conta voltou, e `ls-remote` e `HEAD` deram o mesmo SHA: `5848313..3c2b8ae  casa-sqlite-f1 -> casa-sqlite-f1`. O push dentro do sandbox do agente caiu no helper de credencial (`could not read Username`), como já tinha acontecido no plano 1. Passou fora dele, com zero processos do MSYS vivos. O run `Omni CI` do `3c2b8ae` terminou com `success`, e os **dois jobs ficaram verdes**: `Linux / Node 22 / portable core` em 11 s e `Windows / Node 22 / full verification` em 9 min 13 s. É o primeiro CI todo verde da F1.

## Tarefa 4: PR e registro

- [x] **Passo 1: o PR** de `casa-sqlite-f1` para `main`, pela conta `Weriton-DataOps`, com o título `release 0.26.0: casa SQLite do Omni (F1)`. O corpo resume as mudanças do histórico, lista os oito planos e diz que o merge espera o Weriton.

Resultado (08/11): PR #4 aberto pela `Weriton-DataOps`, de `casa-sqlite-f1` para `main`, com o título `release 0.26.0: casa SQLite do Omni (F1)`, estado `OPEN`, `MERGEABLE` e 30 commits (este registro soma o 31º). O corpo resume as nove mudanças do histórico, a tabela dos oito planos, a prova e a regra de congelamento, e diz que o merge espera o Weriton, por merge commit. A varredura do corpo deu `achados: 0`. Nenhum merge foi feito.

- [x] **Passo 2: registrar.** A Situação deste plano passa a "entregue", e os resultados entram nos passos, num segundo commit, `docs(plano): registra push, CI e PR do plano 8 da F1`, com push.

Resultado (08/11): Os resultados entram neste plano pelo `montar.mjs` sem `--provisorio`, que exige os seis resultados e recusa marcador sobrando, CR, acento estragado e dado proibido. O `--conferir` do bloco da T1 deu `igual versao-p8.mjs`. O commit `docs(plano): registra push, CI e PR do plano 8 da F1` leva só este arquivo e vai com push para o ramo do PR #4. O SHA dele fica no `git log` do ramo.

## Autorrevisão

- Cobertura: a linha 8 do escopo do plano 1 pede o fingerprint novo no contrato (T1), a versão nova (T1) e o PR com merge só com o ok do Weriton (T4, decisão 7).
- Nenhum arquivo de código muda; o verify inteiro roda mesmo assim, porque é o que o CI roda.
- A regra de congelamento do plano 1 passa a valer no merge: depois dele, mudança de esquema no `omni.db` é migração nova (v4 em diante), e no `cofre.db` e no `nucleo.db`, v2 em diante.
