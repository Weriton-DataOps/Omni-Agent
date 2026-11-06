# F1, plano 2: documentos `.md` da memória do Claude Code no `omni.db` — plano de implementação

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** os `.md` de `~/.claude/projects/<projeto>/memory/` entram na tabela `documentos` do `omni.db`, e o banco vira a fonte; a pasta passa a ser a projeção dele. Tudo isso sem servidor, sem dependência nova, sem apagar arquivo do disco e sem derrubar a varredura quando falta o banco.

**Arquitetura:** a loja fica em `runtime/casa/loja-documentos.mjs` e a reconciliação em `runtime/documentos-md.mjs`. A reconciliação fotografa o disco e decide, documento a documento, por três hashes (disco, banco vivo e a base que os dois tiveram em comum nesta máquina), numa transação `BEGIN IMMEDIATE`. A escrita no disco acontece fora da transação, relendo o hash antes de cada arquivo, e a base é confirmada numa segunda transação curta. Uma trava por casa impede duas passadas ao mesmo tempo. A migração v2 cria a tabela da base, `_documentos_no_disco`, e o gatilho fica no fim de `varrerAtividadesDoDia`, depois do estado da varredura salvo.

**Tecnologia:** `node:sqlite`, Node ≥ 22.13 (o CI usa 22; a máquina do Weriton, 24), `node:test`, `TextDecoder` com `fatal` e `ignoreBOM`, e o lock de arquivo que já existe em `dist/`. Nenhuma dependência npm nova.

**Desenho:** [Casa única: Omni, Overcore e Oráculo](../specs/2026-11-04-casa-unica-tres-agentes-design.md): §3.2 (a memória do Claude Code vira projeção), §3.1 (portabilidade), §3.5 (muitas sessões), §3.6 (o molde: a memória no `omni.db`) e §6 (fases e provas).

**Situação em 05/11/2026:** entregue. T1 a T10 feitas e publicadas no `origin/casa-sqlite-f1`: `3f4d1f4` (módulos, suítes e os dois planos), commit de 05/11. O PR sai no plano 8.

---

## Posição na F1

Este é o plano 2 dos oito da F1 ([escopo no plano 1](2026-11-04-f1-casa-sqlite.md#escopo-a-f1-em-oito-planos)). O plano 1 entregou a casa SQLite e a memória do Omni no `omni.db`, e deixou pronta, ainda sem uso, a tabela `documentos`, com diário e lápide. Este plano é a "projeção `.md`" que a F1 promete.

## Mapa de arquivos

| Arquivo | Responsabilidade | Importa |
|---|---|---|
| `runtime/casa/esquemas.mjs` (modificado, +14) | Migração v2 do `omni`: `_documentos_no_disco` (máquina, id com chave estrangeira para `documentos`, hash, carimbo) | nada |
| `runtime/casa/loja-documentos.mjs` (novo, 88 linhas) | Id natural e segmento seguro (`idDoDocumento`, `partesDoId`, `segmentoValido`, `nomeDeDocumentoMd`); leitura (`documentosNoBanco`, `confirmadosNoDisco`, `conteudoDoDocumento`); escrita (`gravarDocumento`, `apagarDocumento`, `confirmarNoDisco`, `esquecerNoDisco`, `registrarImportacaoDeDocumentos`) | `banco.mjs` |
| `runtime/documentos-md.mjs` (novo, 250 linhas) | `pastaDeProjetosDoClaude`, `projetarDocumentos` e `reconciliarDocumentosMd` | `casa/banco.mjs`, `casa/loja-documentos.mjs`, `casa/projecao.mjs` e o lock de `dist` |
| `runtime/casa/banco.mjs` (+2 −1) | `mesmoCaminho` passa a ser exportada | — |
| `runtime/varredura-diaria.mjs` (+14 −1) | Gatilho: reconcilia depois do estado salvo; falha vira degradação | `casa/banco.mjs` (`registrarDegradacao`) e `documentos-md.mjs` |
| `testes/casa-loja-documentos.test.mjs` (novo, 181 linhas) | 7 testes da loja (T2) | — |
| `testes/documentos-md.test.mjs` (novo, 549 linhas) | 22 testes da reconciliação (T3) | — |
| `testes/casa-banco.test.mjs` (+21 −2) | Tabelas com a v2 e a subida v1 → v2 (T1) | — |
| `testes/varredura-diaria.test.mjs` (+97 −1) | 3 testes do gatilho (T4) | — |
| `package.json` (+1 −1) | `node --check` dos dois módulos novos no `npm run check` (T5) | — |

Nenhum módulo novo importa `runtime/memoria.mjs` ou pacote npm.

Siglas usadas neste plano: CL = `testes/casa-loja-documentos.test.mjs`, CB = `testes/casa-banco.test.mjs`, DM = `testes/documentos-md.test.mjs` e VD = `testes/varredura-diaria.test.mjs`. O número que segue a sigla é a linha do teste no arquivo.

## Migração v2 e congelamento

A v1 do `omni.db` ainda não congelou ([regra no plano 1](2026-11-04-f1-casa-sqlite.md#regra-de-congelamento-das-migrações)), porque não houve merge nem release. Mas ela já está publicada no `origin/casa-sqlite-f1`, e qualquer checkout desse ramo pode ter criado um `omni.db` v1. Editar a v1 faria o `_migracoes` recusar esse banco. Por isso a tabela nova entra como v2, e o CB 297 prova a subida de v1 para v2.

`_documentos_no_disco` é interna e não tem gatilho de diário: guarda estado local de cada máquina, não dado a sincronizar. A v2 congela formalmente junto com a v1, no merge ou na release. Mas, publicada desde o `3f4d1f4`, ela já está no caso da v1 descrito acima: o próximo plano que mexer no esquema do `omni.db` entra como v3.

## O que o executor precisa saber antes de rodar qualquer coisa

1. **Casa de produção e memória real.** `pastaDeProjetosDoClaude(casa)` devolve `~/.claude/projects` só para a casa de produção (`%APPDATA%\omni`, comparada por `mesmoCaminho`, que no Windows não diferencia maiúsculas). Qualquer outra casa usa `<casa>\claude\projects`. Os testes rodam com casa temporária e passam `projectsRoot` temporária. Teste nunca lê nem toca a memória real; a prova real (T7) trabalha numa cópia.
2. **Guarda.** `Test-Path "$env:LOCALAPPDATA\omni\casa"` dá `False` antes e depois de cada rodada (T6 a T9).
3. **Gatilho em produção.** A varredura roda no SessionStart e no Stop, assíncrona, com limite de 900 s (`hooks/hooks.json:23-25` e `:152-154`). Ela só passa do not-due uma vez a cada 60 min (`contratos/aprendizado/varredura-diaria.json:4`; `runtime/varredura-diaria.mjs:811-814`), e a passada not-due não reconcilia. Então um `.md` novo entra no banco na primeira varredura que passar do not-due, uns 60 min depois da anterior, desde que alguma sessão comece ou termine; e a primeira passada, com o banco vazio, só ingere. Nada disso vale em produção antes do plano 8, porque o plugin instalado roda do cache.
4. **Vermelho de nascença `:165`.** É o mesmo do plano 1 (item 3 de lá). Arquivo novo em `runtime/` muda o fingerprint do payload: o contrato guarda `3c60182bbef2…`, e o calculado agora é `3ae80f14…`. O plano 8 regenera. (Corrigido no plano 3: a linha 173 do teste passa o contrato como `actual`.)
5. **Empacotamento.** `documentos-md.mjs` é o primeiro módulo novo da F1 a importar `dist` (`dist/adapters/local-json/node-local-file-lock.js`, que existe e é versionado), e o `check-package` passa. O `verificarCoberturaEntrypoints` (`runtime/integridade-release.mjs:152`) lê os `node --check` do `package.json`, e as duas entradas novas do T5 apontam para arquivos do payload.
6. **Grafo de import.** Quatro módulos importam a varredura: `runtime/cli.mjs`, `runtime/hook-varredura.mjs`, `runtime/hook-contexto.mjs` e `runtime/auditoria-sistema.mjs`. Os quatro passam a carregar `documentos-md.mjs` e o lock. Por isso o T8 inclui `hook-varredura.test.mjs` e `auditoria-sistema.test.mjs`.
7. **`dist` com fim de linha fantasma:** item 5 do plano 1 (`git diff --ignore-cr-at-eol --stat -- dist` vazio e `git checkout -- dist` antes do commit).
8. **O typecheck não enxerga `runtime/`:** item 6 do plano 1. Aqui quem garante são o `node --check` (T5) e os testes.
9. **Node 22:** item 7 do plano 1 (`--test-reporter=spec` e o ExperimentalWarning). A prova real rodou nos dois Nodes.
10. **Shell:** itens 8 e 10 do plano 1 (`$rascunho` sai de `$env:LOCALAPPDATA`). O reporter do `node --test` imprime `ℹ tests N`, por isso os padrões de busca terminam em `\s*$` e não ancoram no começo da linha.
11. **Identidade:** item 11 do plano 1.
12. **Linux e `CLAUDE_CONFIG_DIR`.** Sem `APPDATA`, nenhuma casa é a de produção: a pasta é `<casa>/claude/projects`, e a passada sai `sem-projetos` se ela não existir. O `CLAUDE_CONFIG_DIR` é ignorado, como já é na varredura (`runtime/varredura-diaria.mjs:800`). A CI Linux não roda as suítes `.mjs` de `testes/`: o job dela faz `contracts:check`, `architecture:check`, `typecheck`, `test:dist` e três suítes TypeScript portáteis. Quem roda CL, CB, DM e VD é o job Windows (`npm run verify`). Mesmo assim, o DM 529 pula fora do Windows a parte que depende de maiúscula e minúscula.

## Desenho da reconciliação

**Id natural.** Cada `.md` vira o documento `claude-projects/<projeto>/memory/<nome>.md`, com o caminho relativo à pasta de projetos do Claude Code. `partesDoId` só devolve projeto e nome quando o id é exatamente o que `idDoDocumento` produziria. Segmento com barra, barra invertida, dois-pontos, nulo, `.` ou `..` é recusado, então nenhum id vindo do banco escreve fora de `memory/`. Ressalva: o nome do projeto deriva do caminho do repositório em cada máquina; casar projetos entre máquinas fica para a sincronização (§3.1).

**Decisão, por documento.** D é o hash do arquivo no disco; B, o do documento vivo no banco; C, a base desta máquina.

| Disco (D) | Banco vivo (B) | Base (C) | Decisão |
|---|---|---|---|
| x | x | qualquer | em dia; C passa a x se era outro |
| x | y | x | o banco andou e o disco não: projeta y, relendo o hash antes; C passa a y na segunda transação |
| x | nenhum (novo ou lápide) | qualquer | ingere: documento novo ou ressurreição; C = x |
| x | y | outro, ou nenhum | edição externa, ou os dois andaram: ingere x com versão nova (o disco vence); C = x |
| nenhum | nenhum | presente | esquece C |
| nenhum | y | y, e `memory/` ainda tem algum `.md` | lápide no banco e esquece C |
| nenhum | y | outro, ou `memory/` sem nenhum `.md` | projeta y |

Demais regras:
- projeto que sumiu do disco, ou `memory/` que não pôde ser lida, fica intocado: nem lápide, nem projeção;
- item com nome `.md` que não é arquivo, não pôde ser lido ou não é UTF-8 válido fica intocado e conta em `pulados`; ocultos e não-`.md` ficam fora;
- a F1 nunca apaga arquivo do disco; lápide existe só no banco;
- a trava `runs/documentos-md.lock`, dentro da casa, espera 250 ms; a segunda passada desiste com `em-andamento`, e a próxima varredura refaz;
- a projeção que encontra no disco um hash diferente do que a decisão viu pula o arquivo (`pulados`), e a próxima passada decide de novo;
- resultados: `sem-banco`, `sem-projetos`, `em-andamento`, `degradada` e `concluida`; contagens: `lidos`, `atuais`, `ingeridos`, `apagados`, `projetados` e `pulados`;
- degradações em `degradacoes.jsonl`: `documentos.ler`, `documentos.codificacao`, `documentos.projetar`, `documentos.banco` e `documentos.varredura`, nunca com texto de memória (DM 388);
- `_importacoes` (tipo `documentos-md`, fonte `claude-projects`) ganha uma linha só quando a passada ingeriu ou apagou.

**Desvios do desenho**
1. O §3.2 pede a reconciliação "no hook de fim de sessão e na varredura diária". Aqui ela roda só na varredura, que já é disparada no SessionStart e no Stop, com a cadência de 60 min do item 3. O `hook-reconciliacao` (síncrono, 30 s) ficou de fora: ligar a reconciliação nele exigiria mexer em `SELF_REPAIR_PROFILES` (`src/core/repair/self-repair-run.ts:14`), no `dist` e na telemetria, e o ganho seria só de latência.
2. O §3.6 é o molde, com uma diferença. Na memória do Omni, uma projeção velha que o próprio banco escreveu e que volta ao disco perde para o banco. Nos `.md` não há histórico de projeções, só a base C: voltar um arquivo a um texto antigo é edição, e o disco vence (DM 167).
3. Os `.md` dos pontos do Actions, que o §3.2 também menciona, ficam fora: o Actions mora no Oráculo, e nenhum dos oito planos da F1 o cobre.

---

## Tarefas feitas (T1 a T9)

### Task 1: migração v2

**Arquivos:** `runtime/casa/esquemas.mjs`, `testes/casa-banco.test.mjs` (2 testes)

- [x] Migração v2 do `omni`, depois da v1:

```sql
CREATE TABLE _documentos_no_disco (
  maquina TEXT NOT NULL,
  id TEXT NOT NULL REFERENCES documentos (id),
  sha256 TEXT NOT NULL,
  em TEXT NOT NULL,
  PRIMARY KEY (maquina, id)
);
```

- [x] Testes verdes:
  - cada banco da casa abre com as tabelas do desenho (CB 278)
  - omni.db da v1 sobe para a v2 sem perder documento e a base por maquina exige documento existente (CB 297)
- [x] Dente provado pela mutação no CB 297 (mutante 1). O CB 278, a lista de tabelas, ficou sem mutante dedicado.

### Task 2: loja dos documentos

**Arquivos:** `runtime/casa/loja-documentos.mjs`, `testes/casa-loja-documentos.test.mjs` (7 testes)

- [x] API, no mapa de arquivos. `gravarDocumento` devolve `novo`, `igual`, `alterado` ou `ressuscitado`, e toda mudança sobe a versão e anota `origem_maquina`. `apagarDocumento` faz a lápide uma vez só.
- [x] Testes verdes, com dente provado pela mutação (mutantes 1 a 8):
  - id do documento so aceita &lt;projeto&gt;/memory/&lt;nome&gt;.md com segmentos seguros (CL 46)
  - partesDoId devolve projeto e nome so para id bem formado (CL 63)
  - gravar, repetir, alterar, apagar e ressuscitar sobem a versao e anotam o diario (CL 82)
  - base comum por maquina: confirmar troca o hash, esquecer vale so para a maquina e nada entra no diario (CL 120)
  - base comum de documento que nao existe e recusada pela chave estrangeira (CL 137)
  - documentosNoBanco lista so ids da memoria do Claude, com projeto, nome, hash e lapide (CL 146)
  - registrarImportacaoDeDocumentos grava tipo, fonte, hash, contagens e carimbo (CL 165)
- [x] Sem mutante dedicado: CL 120, 146 e 165.

### Task 3: reconciliação

**Arquivos:** `runtime/documentos-md.mjs`, `runtime/casa/banco.mjs` (`mesmoCaminho` exportada), `testes/documentos-md.test.mjs` (22 testes)

- [x] Implementação: a tabela de decisão e as regras de "Desenho da reconciliação", em `reconciliarDocumentosMd(casa, { projectsRoot, env })`. A `projectsRoot` só existe para teste.
- [x] Testes verdes, com dente provado pela mutação (mutantes 2, 3, 5, 7 e 9 a 25; o 26 é equivalente):
  - primeira passada ingere os .md de memory/ de cada projeto e ignora o resto (DM 91)
  - passada sem mudanca nao escreve no disco, nao sobe versao nem registra importacao (DM 127)
  - edicao externa no disco vira versao nova no banco e o arquivo fica como esta (DM 145)
  - voltar o arquivo a um texto antigo e edicao legitima, nao copia defasada (DM 167)
  - banco adiante projeta a versao nova no disco byte a byte e a passada seguinte fica em dia (DM 186)
  - disco e banco mudaram desde a ultima passada: o disco vence e vira versao nova (DM 204)
  - disco e banco chegam ao mesmo texto por caminhos diferentes: fica em dia e a base acompanha (DM 222)
  - apagar um .md com irmaos vivos vira lapide no banco e o arquivo nao volta (DM 242)
  - arquivo apagado depois que o banco andou volta com a versao do banco, sem lapide (DM 264)
  - lapide feita fora da reconciliacao so esquece a base desta maquina (DM 284)
  - arquivo recriado depois da lapide ressuscita o documento com versao nova (DM 307)
  - memory/ apagada inteira ou sem nenhum .md volta do banco byte a byte, com BOM e tudo (DM 328)
  - projeto apagado inteiro nao e recriado nem vira lapide (DM 358)
  - sem SQLite a reconciliacao nao abre banco, nao trava e nao toca no disco (DM 375)
  - banco ilegivel degrada sem vazar texto de memoria e sem tocar no disco (DM 388)
  - projecao rele o hash antes de escrever e nao atropela escrita concorrente (DM 404)
  - arquivo que nao e UTF-8 valido fica intocado e nao vira lapide (DM 434)
  - pasta com nome de .md fica intocada e nao vira lapide (DM 454)
  - id malformado no banco e ignorado e nada e escrito fora de memory/ (DM 469)
  - reconciliacao concorrente sai como em-andamento sem abrir o banco (DM 497)
  - pasta de projetos ausente ou que nao e pasta nao cria trava nem banco (DM 516)
  - raiz padrao: a casa de producao usa ~/.claude/projects e qualquer outra casa usa a propria pasta (DM 529)
- [x] Sem mutante dedicado: DM 91 (primeira passada) e DM 388 (banco ilegível).

### Task 4: gatilho na varredura diária

**Arquivos:** `runtime/varredura-diaria.mjs`, `testes/varredura-diaria.test.mjs` (3 testes)

- [x] Depois de `await salvar(casa, store)`, no fim de `varrerAtividadesDoDia`, com `registrarDegradacao` e `reconciliarDocumentosMd` importados no topo:

```js
await salvar(casa, store)
// Os .md da memória do Claude Code entram no omni.db depois do estado da varredura salvo:
// falha aqui vira degradação anotada e nunca desfaz a varredura (plano 2 da F1). A pasta é a
// da casa, não a projectsRoot: a origem dos JSONL pode ser outra (diagnóstico, --origem) e
// não pode redirecionar a projeção.
let documentos
try {
  documentos = await reconciliarDocumentosMd(casa)
} catch (erro) {
  registrarDegradacao(casa, 'documentos.varredura', erro)
  documentos = { resultado: 'degradada' }
}
return { result: 'completed', scan, documentos }
```

A passada not-due sai antes e não reconcilia.

- [x] Testes verdes, com dente provado pela mutação (mutantes 27 a 30):
  - varredura concluida reconcilia os .md da memoria da casa, nao os da origem dos JSONL (VD 465)
  - varredura automatica fora do horario nao reconcilia os .md (VD 491)
  - reconciliacao que rejeita vira degradacao anotada e nao desfaz a varredura (VD 528). A falha é injetada por uma pasta no lugar da trava, `runs/documentos-md.lock`, com data de 2020: a trava velha é recuperada, a recuperação dá `EISDIR` e a aquisição rejeita.
- [x] As quatro suítes juntas:

```powershell
node --test --test-concurrency=1 --test-reporter=spec testes/casa-banco.test.mjs testes/casa-loja-documentos.test.mjs testes/documentos-md.test.mjs testes/varredura-diaria.test.mjs
```

Resultado (05/11): 63/63, em 14 s.

### Task 5: `node --check` dos módulos novos no `npm run check`

O `node --check` de um módulo não segue import, e nenhum `node --check` do script `check` citava os dois arquivos novos. Sem esta tarefa, um erro de sintaxe neles passaria pelo `check` e só apareceria quando algum teste carregasse o módulo.

**Arquivos:**
- Modificar: `package.json:26` (script `check`)
- Auxiliar fora do repo: `$rascunho\mutante-sintaxe.mjs`

- [x] **Passo 1: criar o mutante de sintaxe** em `$rascunho\mutante-sintaxe.mjs`. É o do plano 1 (T7), agora com o arquivo como argumento:

```js
// Quebra a sintaxe de um arquivo do runtime, roda `npm run check` e restaura o arquivo sempre.
// Uso: node mutante-sintaxe.mjs <raiz-do-repo> [arquivo relativo, padrão runtime/casa/banco.mjs]
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const raiz = resolve(process.argv[2] ?? '.')
const relativo = process.argv[3] ?? 'runtime/casa/banco.mjs'
const caminho = join(raiz, relativo)
const nome = basename(relativo).replace(/[.]/g, '\\.')
const original = readFileSync(caminho)
const hash = (conteudo) => createHash('sha256').update(conteudo).digest('hex')
const antes = hash(original)
try {
  writeFileSync(caminho, Buffer.concat([original, Buffer.from('\nexport const = 1\n')]))
  const r = spawnSync('npm run check', { cwd: raiz, encoding: 'utf8', shell: true, windowsHide: true })
  const saida = `${r.stdout}\n${r.stderr}`
  const aponta = saida.split('\n').find((linha) => new RegExp(`${nome}:\\d+`).test(linha))
  console.log(`${relativo}: status ${r.status}; SyntaxError: ${/SyntaxError/.test(saida)}; aponta: ${aponta?.trim() ?? '(nenhuma linha cita o arquivo)'}`)
} finally {
  writeFileSync(caminho, original)
  console.log(`restaurado: ${hash(readFileSync(caminho)) === antes} (${antes.slice(0, 12)})`)
}
```

- [x] **Passo 2: editar o `package.json`.** Na linha 26, trocar o trecho único

```
node --check runtime/casa/loja-memoria.mjs && 
```

por

```
node --check runtime/casa/loja-memoria.mjs && node --check runtime/casa/loja-documentos.mjs && node --check runtime/documentos-md.mjs && 
```

(com o espaço final).

- [x] **Passo 3: o mutante morre no lugar certo, nos dois arquivos**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
node "$rascunho\mutante-sintaxe.mjs" . runtime/casa/loja-documentos.mjs
node "$rascunho\mutante-sintaxe.mjs" . runtime/documentos-md.mjs
```

Esperado: nos dois, `status 1; SyntaxError: true`, a linha acrescentada apontada e `restaurado: true`.

Resultado (05/11), igual ao esperado:
- `runtime/casa/loja-documentos.mjs: status 1; SyntaxError: true; aponta: …\runtime\casa\loja-documentos.mjs:90`, com `restaurado: true (70019037fdef)`;
- `runtime/documentos-md.mjs: status 1; SyntaxError: true; aponta: …\runtime\documentos-md.mjs:252`, com `restaurado: true (6244e452faec)`.

As linhas 90 e 252 são a do `export const = 1` acrescentado.

- [x] **Passo 4: `check` limpo passa.** Passou dentro do verify do T9, porque o `npm test` só começa depois do `check`.

A rodada "antes da edição" (a que mostra o furo) não foi refeita aqui. O furo vale pelo T7 do plano 1, que o mostrou com o `banco.mjs`: o mecanismo é o mesmo.

### Task 6: mutação

**Auxiliares fora do repo:**
- `$rascunho\gerar-mutantes-p2.mjs` (Apêndice C) grava a lista dos 30 mutantes em `mutantes-p2.json`.
- `$rascunho\mutantes.mjs` é o executor do plano 1, chamado com a lista (`node mutantes.mjs <lista.json>`). Para cada mutante:
  - confere que o trecho aparece uma vez só no arquivo alvo; senão, marca `??` e conta como sobrevivente;
  - guarda uma cópia do original e aplica a troca respeitando o fim de linha do arquivo;
  - roda `node --test --test-concurrency=1` nas suítes do mutante e restaura o original;
  - imprime `vermelho`, com cada teste que caiu e a primeira linha do erro dele, ou `SOBREVIVEU`.

  Ele não vai a documento porque traz o caminho local do worktree.
- `$rascunho\tabela-mutantes-p2.mjs` monta a tabela do Apêndice A a partir da lista e da saída do executor. Derruba a tabela se alguma morte não for `AssertionError`, se um teste não estiver nas quatro suítes ou se um sobrevivente não estiver na lista de equivalentes.

- [x] **Passo 1: guarda e hashes antes** (`Test-Path "$env:LOCALAPPDATA\omni\casa"` → `False`; `Get-FileHash` dos quatro arquivos de runtime).
- [x] **Passo 2: gerar, rodar e tabelar**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
node "$rascunho\gerar-mutantes-p2.mjs"
node "$rascunho\mutantes.mjs" "$rascunho\mutantes-p2.json" *> "$rascunho\mutantes-p2.saida.txt"; "saida: $LASTEXITCODE"
node "$rascunho\tabela-mutantes-p2.mjs"
```

Esperado: `30 mutantes gravados`; `saida: 1`, porque o equivalente conta como sobrevivente; e `30 linhas: 29 vermelhos, 1 equivalente(s); testes mapeados: 63`.

Resultado (05/11): igual ao esperado. Os 30 mutantes nos quatro arquivos de runtime deram 29 vermelhos por asserção e 1 equivalente (o 26), em 95 s, sem nenhuma morte no setup.

- [x] **Passo 3: guarda e hashes depois.** Resultado (05/11): guarda `False`; hashes dos quatro arquivos iguais aos de antes (`ebd463293840`, `70019037fdef`, `6244e452faec` e `4863fbaf5326`).

### Task 7: prova com a memória real

O script do Apêndice B copia só os `.md` de cada `memory/` real para uma pasta temporária (recusa pasta dentro da memória ou da casa real) e mede seis passos com uma casa descartável. Imprime só contagens, hashes e tempos, nunca texto nem nome de projeto, e apaga a pasta no fim.

- [x] **Passo 1: guarda antes** (`Test-Path "$env:LOCALAPPDATA\omni\casa"` → `False`)

- [x] **Passo 2: rodar nos dois Nodes**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
node "$rascunho\prova-documentos-real.mjs" .
& $node22 "$rascunho\prova-documentos-real.mjs" .
```

(`$node22` é o `node.exe` de um Node 22, fora do PATH.) Esperado: toda conferência `ok`, `pasta da prova removida: true` e saída 0.

Resultado (05/11): todas as conferências `ok` nos dois Nodes. Cópia: 49 projetos, 964 `.md`, nenhum ilegível, 2.410.511 bytes, agregado `8b416dd017d9`.

| Passo | Node 24.17.0 | Node 22.23.4 |
|---|---|---|
| 1. primeira passada (ingestão) | 446 ms | 463 ms |
| 2. segunda passada (em dia) | 216 ms | 222 ms |
| 3. `memory/` do maior projeto apagada (437 `.md`) | 2037 ms | 1001 ms |
| 4. edição externa num arquivo | 230 ms | 215 ms |
| 5. um arquivo apagado com irmãos vivos | 240 ms | 214 ms |
| 6. passada seguinte | 205 ms | 206 ms |

Passo a passo:
- 1: diário com 964 inserções, uma importação, base com 964 registros, e hash agregado e bytes do banco iguais aos da cópia.
- 2: nada ingerido, projetado ou apagado, e nenhum arquivo reescrito (mtime igual).
- 3: os 437 voltam byte a byte e os outros 527 ficam em dia, sem lápide; as importações seguem em 1.
- 4: uma versão 2 e a segunda importação.
- 5: uma lápide, o arquivo não volta, terceira importação.
- 6: em dia de novo, diário `{"I":964,"U":2}` e `integrity_check` ok.

Nos dois Nodes:
- `omni.db` com 4.079.616 bytes, WAL zerado, nenhuma degradação e a pasta da prova removida;
- a diferença do passo 3 entre os Nodes é, provavelmente, ruído de disco (inferência, não medida).

- [x] **Passo 3: guarda depois** (`False`)

### Task 8: sinal rápido

As suítes da casa, da memória, do contexto, do CLI e do pacote, mais as duas que passaram a carregar a reconciliação pelo grafo de import (item 6).

- [x] **Passo 1: guarda antes** (`Test-Path "$env:LOCALAPPDATA\omni\casa"` → `False`)
- [x] **Passo 2: suítes**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
node --test --test-concurrency=1 --test-reporter=spec testes/casa-banco.test.mjs testes/casa-loja-memoria.test.mjs testes/casa-loja-documentos.test.mjs testes/documentos-md.test.mjs testes/memoria-casa.test.mjs testes/memoria.test.mjs testes/memoria-coordenador.test.mjs testes/manutencao-memoria.test.mjs testes/pipeline-memoria.test.mjs testes/recuperacao.test.mjs testes/contexto.test.mjs testes/hook-contexto.test.mjs testes/aprendizado-resultados.test.mjs testes/atalhos.test.mjs testes/pacote.test.mjs testes/recibos-evolucao-veto.test.mjs testes/sincronizacao-memoria-duravel.test.mjs testes/varredura-diaria.test.mjs testes/hook-varredura.test.mjs testes/auditoria-sistema.test.mjs testes/cli.test.mjs *> "$rascunho\t8.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t8.txt" -Pattern '(tests|pass|fail|cancelled|skipped|duration_ms) [\d.]+\s*$'
```

Esperado: `saida: 0` e `fail 0`.

Resultado (05/11): 236/236 nas 21 suítes, sem falha, em 91 s. Rodou por um auxiliar que chama o mesmo `node --test --test-concurrency=1` com as mesmas suítes e resume os totais. A conta: os 181 do T8 do plano 1, mais CL 7, DM 22, `hook-varredura` 8, `auditoria-sistema` 14, CB 1 e VD 3. O vermelho conhecido (`:165`) não está nesta lista; ele aparece no T9.

- [x] **Passo 3: guarda depois** (`False`)

### Task 9: verify completo

Uma suíte pesada por vez. Rodar em segundo plano e ler a saída só no fim.

- [x] **Passo 1: guarda antes** (`Test-Path "$env:LOCALAPPDATA\omni\casa"` → `False`)

- [x] **Passo 2: verify**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
npm run verify *> "$rascunho\verify-p2.txt"; "saida: $LASTEXITCODE" | Out-File -Append -Encoding utf8 "$rascunho\verify-p2.txt"
```

- [x] **Passo 3: ler o verify**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
Select-String -Path "$rascunho\verify-p2.txt" -Pattern '(tests|pass|fail|cancelled|skipped|duration_ms) [\d.]+\s*$', '\.test\.mjs:\d+:\d+', '^saida: '
```

Esperado:
- `tests 645`, `pass 640`, `fail 1`, `skipped 4`;
- a única falha listada é `testes\integridade-release.test.mjs:165`;
- `saida: 1`.

Resultado (05/11): os três itens iguais ao esperado, com `cancelled 0`, em 418 s.
- `contracts:check`: `{"ok":true,"contracts":43,"roots":["contratos","src"]}`.
- `architecture:check`: `{"ok":true,"sourceFiles":59,"typescriptFiles":57}`.
- `package:check`: `{"ok":true,"distFiles":59,"runtimeDependencies":0}`.

Base de comparação, o verify do plano 1: 612 testes. Os 33 a mais são CL 7, CB 1, DM 22 e VD 3.

- [x] **Passo 4: o que a falha conhecida mascara, rodado à parte**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
node --test --test-concurrency=1 .test-dist/testes/*.test.js *> "$rascunho\t9-test-dist-p2.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t9-test-dist-p2.txt" -Pattern '(tests|pass|fail) \d+\s*$'
npm run test:dist *> "$rascunho\t9-dist-production-p2.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t9-dist-production-p2.txt" -Pattern '(tests|pass|fail) \d+\s*$'
npm run verify:build *> "$rascunho\t9-verify-build-p2.txt"; "saida: $LASTEXITCODE"
```

Esperado: as três com `saida: 0`, e as duas suítes com `fail 0`.

Resultado (05/11), as três com saída 0:
- `.test-dist`: 55/55;
- `test:dist`: 1/1;
- `verify:build`: `{"ok":true,"files":59}`.

- [x] **Passo 5: devolver o `dist` e conferir o que sobra**

```powershell
git diff --ignore-cr-at-eol --stat -- dist
git checkout -- dist
git status --short
```

Esperado: o `diff` sai vazio, e o `status` mostra só os dez itens deste plano.

Resultado (05/11): o `diff` imprimiu só os avisos de LF para CRLF, sem nenhuma linha de `--stat`. Depois do `checkout`, o `status` mostrou:
- seis `M`: `package.json`, `runtime/casa/banco.mjs`, `runtime/casa/esquemas.mjs`, `runtime/varredura-diaria.mjs`, `testes/casa-banco.test.mjs` e `testes/varredura-diaria.test.mjs`;
- quatro `??`: os dois módulos novos e as duas suítes novas.

- [x] **Passo 6: guarda depois** (`False`)

---

## Tarefa da entrega (T10)

### Task 10: commit, push e CI

Um commit só: os módulos, as suítes e o `package.json` só fazem sentido juntos, e o commit leva os dois planos (este e a atualização do plano 1).

- [x] **Passo 1: identidade** (item 11 do plano 1):

```powershell
$email = git log origin/main --author='Weriton-DataOps' -1 --format='%ae'
if (-not $email) { throw 'sem commit da Weriton-DataOps no origin/main' }
$identidade = @('-c', 'user.name=Weriton-DataOps', '-c', "user.email=$email")
"identidade: Weriton-DataOps <$email>"
```

Esperado: `Weriton-DataOps` com o e-mail vinculado à conta. Resultado (05/11): igual ao esperado, com o e-mail lido do `origin/main` e passado só no comando, sem mexer na config.

- [x] **Passo 2: commit.** Mensagem em `$rascunho\commit-p2.txt`, criada com editor, sem acento:

```
feat(casa): documentos .md da memoria do Claude Code no omni.db

Os .md de ~/.claude/projects/<projeto>/memory/ entram na tabela
documentos e o banco vira a fonte; a pasta passa a ser projecao. A
reconciliacao compara tres hashes por documento (disco, banco vivo e
a base que os dois tiveram em comum nesta maquina, na tabela nova
_documentos_no_disco, migracao v2): arquivo novo ou editado fora e
ingerido com versao nova, arquivo apagado com irmaos vira lapide,
memory/ perdida volta do banco byte a byte e a projecao rele o hash
antes de escrever. Nada e apagado do disco. Roda na varredura diaria,
depois do estado dela salvo; falha vira degradacao anotada.

Provas: 63/63 nas quatro suites; 30 mutantes, 29 vermelhos por
assercao e 1 equivalente; memoria real copiada (964 .md) com banco e
copia no mesmo hash agregado, em Node 22 e 24. Sinal rapido: 236/236
em 21 suites. Verify completo: 645 testes, 640 verdes, 4 pulados e 1
vermelho, o fingerprint de integridade-release.test.mjs:165, o mesmo
do plano 1; .test-dist 55/55, test:dist 1/1 e verify:build ok.

Desenho: docs/superpowers/specs/2026-11-04-casa-unica-tres-agentes-design.md
Plano: docs/superpowers/plans/2026-11-05-f1-plano-2-documentos-md.md

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$email = git log origin/main --author='Weriton-DataOps' -1 --format='%ae'
if (-not $email) { throw 'sem commit da Weriton-DataOps no origin/main' }
$identidade = @('-c', 'user.name=Weriton-DataOps', '-c', "user.email=$email")
git add runtime/casa/banco.mjs runtime/casa/esquemas.mjs runtime/casa/loja-documentos.mjs runtime/documentos-md.mjs runtime/varredura-diaria.mjs package.json testes/casa-banco.test.mjs testes/casa-loja-documentos.test.mjs testes/documentos-md.test.mjs testes/varredura-diaria.test.mjs docs/superpowers/plans/2026-11-04-f1-casa-sqlite.md docs/superpowers/plans/2026-11-05-f1-plano-2-documentos-md.md
git diff --cached --stat
git @identidade commit -F "$rascunho\commit-p2.txt"
git log -1 --format='%h | autor %an | committer %cn | pai %p'
git status --short
```

Esperado:
- doze arquivos no `--stat`;
- autor e committer `Weriton-DataOps`, pai `6947443`;
- mensagem só ASCII, sem BOM nem CR;
- `status` vazio.

Resultado (05/11): `3f4d1f4`, doze arquivos, 2120 inserções e 10 remoções, autor e committer `Weriton-DataOps`, pai `6947443`, mensagem só ASCII, sem BOM nem CR, e `status` vazio. A mensagem gravada é o `commit-p2.txt` byte a byte, conferida pelo `git cat-file commit HEAD`. Comparar a saída do `git log` passada por `Out-String` dá diferença falsa, porque o PowerShell junta as linhas com CRLF.

- [x] **Passo 3: push pela conta dona do repo**, fora do sandbox do agente (T10, passo 5, do plano 1). O ramo já tem upstream, então o push vai sem `-u`:

```powershell
gh auth switch --user Weriton-DataOps
try { git push origin casa-sqlite-f1 } finally { gh auth switch --user wp-grgroup }
gh auth status --active
git ls-remote origin refs/heads/casa-sqlite-f1
git rev-parse HEAD
```

Esperado: push aceito, `wp-grgroup` ativa de novo e o SHA remoto igual ao local.

Resultado (05/11): `6947443..3f4d1f4` aceito; `3f4d1f4` no `origin/casa-sqlite-f1`, igual ao local, e `wp-grgroup` ativa.

- [x] **Passo 4: CI**

```powershell
gh run list --branch casa-sqlite-f1 --limit 5
```

Esperado:
- "Linux / Node 22 / portable core" verde (ele não roda as suítes deste plano; item 12);
- "Windows / Node 22 / full verification" vermelho só no `:165`, com 645 testes: 640 verdes, 4 pulados e 1 vermelho. Os números são lidos no log do job pela API (`gh api repos/Weriton-DataOps/Omni-Agent/actions/jobs/<id>/logs`), porque o `gh run view --log-failed` volta vazio.

Resultado (05/11), na run do push, em `3f4d1f4`:
- "Linux / Node 22 / portable core" verde;
- "Windows / Node 22 / full verification" vermelho, com 645 testes: 640 verdes, 4 pulados e 1 vermelho, o "contrato canônico declara a versão e exatamente o fingerprint do payload" (`:165`). São os números do verify local (T9), lidos no log do job pela API.

- [x] **Passo 5: registrar o resultado.**
  - Marcar esta tarefa com os resultados.
  - Trocar a "Situação" para entregue e a linha 2 do escopo do plano 1 para "entregue".
  - Commit `docs(plano): …` com a mesma identidade, push e CI de novo.

Resultado (05/11): os três itens no commit `docs(plano): registra push e CI do plano 2 da F1`. O push e a CI desse commit não aparecem aqui, porque este registro viaja dentro dele.

Este plano não abre PR. O PR sai no plano 8, com a release.

---

## Autorrevisão contra o desenho

Os números entre parênteses são linhas do Apêndice A.

**§3.2, a memória do Claude Code vira projeção**
- O banco é a fonte e a pasta, projeção:
  - ingestão: DM 91 e DM 145 (5, 9);
  - regeneração: DM 186 (20, 25), DM 328 (10, 19, 20) e DM 264 (11, 25).
- Apagar é lápide: DM 242 (13). Recriar é ressurreição: DM 307 (5, 7).
- Projeto apagado inteiro fica como está: DM 358 (12).
- Importação registrada só quando a passada muda algo: DM 127 (20).
- Gatilho na varredura: VD 465, 491 e 528 (27 a 30). O hook de fim de sessão e os `.md` do Actions: desvios 1 e 3.

**§3.6, o molde**
- Mesma reconciliação por hash, com a diferença do desvio 2: voltar a um texto antigo é edição, DM 167 (5, 9).

**§3.1, portabilidade**
- Id natural, sem caminho absoluto: CL 46 e 63 (2 a 4).
- `versao` e `origem_maquina` em toda mudança: CL 82 (5 a 8).
- Lápide: CL 82 (8) e DM 242 (13). Diário: CL 82.
- Base por máquina, fora do diário: CL 120, com a chave estrangeira em CL 137 e CB 297 (1).
- Em dia acerta a base: DM 222 (14). Lápide feita fora só esquece a base desta máquina: DM 284 (13, 15, 20).

**§3.5, muitas sessões**
- Uma passada por vez: DM 497 (21).
- `BEGIN IMMEDIATE` na decisão: herdado do plano 1 (`transacao`).
- Releitura antes de escrever, sem atropelar a sessão que gravou no meio-tempo: DM 404 (16).
- Base confirmada só depois da escrita, numa segunda transação: DM 186 e 264 (25).

**Segurança de caminho:** DM 469 (2, 3) e CL 63 (2 a 4).

**Robustez**
- Arquivo que não é texto UTF-8, ou que não é arquivo: DM 434 e 454 (17, 18).
- BOM preservado: DM 328 (19).
- Banco ilegível sem vazar texto: DM 388.
- Sem SQLite: DM 375 (23).
- Sem pasta de projetos: DM 516 (22).
- Casa de produção: DM 529 (24).
- Falha que não derruba a varredura: VD 528 (30).

**§6, prova da F1:** a memória real copiada, ingerida e regenerada byte a byte nos dois Nodes (T7).

---

## Apêndice A: mutantes (T6)

30 mutantes: 29 vermelhos por asserção e 1 equivalente (o 26). A tabela foi gerada por script a partir da lista de mutantes (Apêndice C) e da saída do executor. A coluna da direita traz o teste que ficou vermelho e a asserção que o derrubou.
- "`equal` no caso": os laços de casos inválidos do CL usam o próprio caso como mensagem da asserção.
- `throws` sem exceção: o mutante 1 tira a chave estrangeira, e a inserção que devia falhar passa.
- `doesNotReject`: os mutantes 21, 29 e 30 fazem a passada ou a varredura rejeitar onde o teste exige que não rejeite.
- Nenhuma morte por setup, `ENOENT` ou `TypeError`: o gerador da tabela recusa mensagem que não seja `AssertionError`.
- O 26 é equivalente: com `fatal: true` e `ignoreBOM: true`, o texto decodificado reencoda nos mesmos bytes, então o hash da string é o mesmo dos bytes.

Siglas: CL = `testes/casa-loja-documentos.test.mjs`, CB = `testes/casa-banco.test.mjs`, DM = `testes/documentos-md.test.mjs`, VD = `testes/varredura-diaria.test.mjs`.

| # | Mutante | Arquivo | Teste que ficou vermelho — asserção |
|---|---|---|---|
| 1 | esquemas: FK de _documentos_no_disco removida | `casa/esquemas.mjs` | CB omni.db da v1 sobe para a v2 sem perder documento e a base por maquina exige documento existente — `throws` sem exceção<br>CL base comum de documento que nao existe e recusada pela chave estrangeira — `throws` sem exceção |
| 2 | loja: segmento aceita barra invertida | `casa/loja-documentos.mjs` | CL id do documento so aceita &lt;projeto&gt;/memory/&lt;nome&gt;.md com segmentos seguros — `equal` no caso `"p\\q" \| "a.md"`<br>CL partesDoId devolve projeto e nome so para id bem formado — `equal` no caso `"claude-projects/proj/memory/a\\..\\..\\b.md"`<br>DM id malformado no banco e ignorado e nada e escrito fora de memory/ — `deepEqual` |
| 3 | loja: segmento aceita dois-pontos | `casa/loja-documentos.mjs` | CL id do documento so aceita &lt;projeto&gt;/memory/&lt;nome&gt;.md com segmentos seguros — `equal` no caso `"C:" \| "a.md"`<br>CL partesDoId devolve projeto e nome so para id bem formado — `equal` no caso `"claude-projects/proj/memory/C:a.md"`<br>DM id malformado no banco e ignorado e nada e escrito fora de memory/ — `deepEqual` |
| 4 | loja: segmento aceita .. | `casa/loja-documentos.mjs` | CL id do documento so aceita &lt;projeto&gt;/memory/&lt;nome&gt;.md com segmentos seguros — `equal` no caso `".." \| "a.md"`<br>CL partesDoId devolve projeto e nome so para id bem formado — `equal` no caso `"claude-projects/../memory/a.md"` |
| 5 | loja: alteracao sem versao+1 | `casa/loja-documentos.mjs` | CL gravar, repetir, alterar, apagar e ressuscitar sobem a versao e anotam o diario — `deepEqual`<br>DM edicao externa no disco vira versao nova no banco e o arquivo fica como esta — `equal`<br>DM voltar o arquivo a um texto antigo e edicao legitima, nao copia defasada — `equal`<br>DM disco e banco mudaram desde a ultima passada: o disco vence e vira versao nova — `equal`<br>DM arquivo recriado depois da lapide ressuscita o documento com versao nova — `equal` |
| 6 | loja: mesmo hash vivo vira alteracao | `casa/loja-documentos.mjs` | CL gravar, repetir, alterar, apagar e ressuscitar sobem a versao e anotam o diario — `equal` |
| 7 | loja: ressurreicao sem desmarcar a lapide | `casa/loja-documentos.mjs` | CL gravar, repetir, alterar, apagar e ressuscitar sobem a versao e anotam o diario — `deepEqual`<br>DM arquivo recriado depois da lapide ressuscita o documento com versao nova — `equal` |
| 8 | loja: lapide repetida sobe versao | `casa/loja-documentos.mjs` | CL gravar, repetir, alterar, apagar e ressuscitar sobem a versao e anotam o diario — `equal` |
| 9 | md: C===D sempre verdadeiro (projeta em vez de ingerir) | `documentos-md.mjs` | DM edicao externa no disco vira versao nova no banco e o arquivo fica como esta — `deepEqual`<br>DM voltar o arquivo a um texto antigo e edicao legitima, nao copia defasada — `deepEqual`<br>DM disco e banco mudaram desde a ultima passada: o disco vence e vira versao nova — `deepEqual` |
| 10 | md: lapide sem exigir irmao .md | `documentos-md.mjs` | DM memory/ apagada inteira ou sem nenhum .md volta do banco byte a byte, com BOM e tudo — `deepEqual` |
| 11 | md: lapide sem exigir C===B | `documentos-md.mjs` | DM arquivo apagado depois que o banco andou volta com a versao do banco, sem lapide — `deepEqual` |
| 12 | md: projeto apagado volta a existir | `documentos-md.mjs` | DM projeto apagado inteiro nao e recriado nem vira lapide — `deepEqual` |
| 13 | md: lapide contada como viva | `documentos-md.mjs` | DM apagar um .md com irmaos vivos vira lapide no banco e o arquivo nao volta — `deepEqual`<br>DM lapide feita fora da reconciliacao so esquece a base desta maquina — `deepEqual` |
| 14 | md: em dia sem acertar C | `documentos-md.mjs` | DM disco e banco chegam ao mesmo texto por caminhos diferentes: fica em dia e a base acompanha — `equal` |
| 15 | md: lapide de fora sem esquecer C | `documentos-md.mjs` | DM lapide feita fora da reconciliacao so esquece a base desta maquina — `equal` |
| 16 | md: projecao sem reler o hash | `documentos-md.mjs` | DM projecao rele o hash antes de escrever e nao atropela escrita concorrente — `deepEqual` |
| 17 | md: sem os intocados | `documentos-md.mjs` | DM arquivo que nao e UTF-8 valido fica intocado e nao vira lapide — `deepEqual`<br>DM pasta com nome de .md fica intocada e nao vira lapide — `deepEqual` |
| 18 | md: decodificador sem fatal | `documentos-md.mjs` | DM arquivo que nao e UTF-8 valido fica intocado e nao vira lapide — `deepEqual` |
| 19 | md: decodificador come o BOM | `documentos-md.mjs` | DM memory/ apagada inteira ou sem nenhum .md volta do banco byte a byte, com BOM e tudo — `deepEqual` |
| 20 | md: _importacoes registrada sempre | `documentos-md.mjs` | DM passada sem mudanca nao escreve no disco, nao sobe versao nem registra importacao — `equal`<br>DM banco adiante projeta a versao nova no disco byte a byte e a passada seguinte fica em dia — `equal`<br>DM lapide feita fora da reconciliacao so esquece a base desta maquina — `equal`<br>DM memory/ apagada inteira ou sem nenhum .md volta do banco byte a byte, com BOM e tudo — `equal` |
| 21 | md: sem o em-andamento | `documentos-md.mjs` | DM reconciliacao concorrente sai como em-andamento sem abrir o banco — `doesNotReject` |
| 22 | md: sem-projetos so depois da trava | `documentos-md.mjs` | DM pasta de projetos ausente ou que nao e pasta nao cria trava nem banco — `deepEqual` |
| 23 | md: sem conferir o SQLite | `documentos-md.mjs` | DM sem SQLite a reconciliacao nao abre banco, nao trava e nao toca no disco — `deepEqual` |
| 24 | md: casa de producao comparada com === | `documentos-md.mjs` | DM raiz padrao: a casa de producao usa ~/.claude/projects e qualquer outra casa usa a propria pasta — `equal` |
| 25 | md: sem confirmar C depois da projecao | `documentos-md.mjs` | DM banco adiante projeta a versao nova no disco byte a byte e a passada seguinte fica em dia — `equal`<br>DM arquivo apagado depois que o banco andou volta com a versao do banco, sem lapide — `equal` |
| 26 | md: sha da string (equivalente esperado) | `documentos-md.mjs` | sobreviveu — equivalente: com `fatal: true` e `ignoreBOM: true` o texto decodificado reencoda nos mesmos bytes, então `sha256(conteudo)` é igual a `sha256(bytes)` |
| 27 | vd: varredura sem reconciliar | `varredura-diaria.mjs` | VD varredura concluida reconcilia os .md da memoria da casa, nao os da origem dos JSONL — `equal`<br>VD varredura automatica fora do horario nao reconcilia os .md — `equal`<br>VD reconciliacao que rejeita vira degradacao anotada e nao desfaz a varredura — `deepEqual` |
| 28 | vd: varredura repassa projectsRoot | `varredura-diaria.mjs` | VD varredura concluida reconcilia os .md da memoria da casa, nao os da origem dos JSONL — `deepEqual`<br>VD varredura automatica fora do horario nao reconcilia os .md — `equal` |
| 29 | vd: reconcilia antes do not-due | `varredura-diaria.mjs` | VD varredura concluida reconcilia os .md da memoria da casa, nao os da origem dos JSONL — `equal`<br>VD varredura automatica fora do horario nao reconcilia os .md — `equal`<br>VD reconciliacao que rejeita vira degradacao anotada e nao desfaz a varredura — `doesNotReject` |
| 30 | vd: varredura sem o try/catch da reconciliacao | `varredura-diaria.mjs` | VD reconciliacao que rejeita vira degradacao anotada e nao desfaz a varredura — `doesNotReject` |

## Apêndice B: script da prova com a memória real (T7)

Uso: `node prova-documentos-real.mjs <raiz-do-repo>`, com o arquivo fora do repositório. Ele só lê os `.md` de `~/.claude/projects/*/memory/`. Todo o resto acontece numa cópia descartável, e a saída traz só contagens, hashes e tempos.

```js
// Prova do plano 2 da F1 com a memória real do Claude Code, numa cópia descartável. Nunca escreve
// em ~/.claude/projects nem em %APPDATA%\omni: copia os .md de cada memory/ para uma pasta
// temporária e mede ingestão, passada em dia, regeneração de uma memory/ apagada, edição externa,
// lápide e a passada seguinte. Imprime só contagens, hashes e tempos; nenhum texto, nenhum nome.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'

const raiz = pathToFileURL(join(resolve(process.argv[2] ?? '.'), 'runtime') + sep).href
const md = await import(`${raiz}documentos-md.mjs`)
const banco = await import(`${raiz}casa/banco.mjs`)
const loja = await import(`${raiz}casa/loja-documentos.mjs`)

delete process.env.OMNI_CASA_BANCO
delete process.env.OMNI_CASA_SEM_SQLITE

const real = join(homedir(), '.claude', 'projects')
const casaReal = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'omni')
const normal = (caminho) => {
  try {
    return realpathSync.native(caminho).toLowerCase()
  } catch {
    return resolve(caminho).toLowerCase()
  }
}
const dentro = (filho, pai) => {
  const r = relative(normal(pai), normal(filho))
  return r === '' || (!r.startsWith('..') && !isAbsolute(r))
}

const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'omni-prova-docs-')))
if (dentro(base, real) || dentro(base, casaReal) || dentro(real, base)) {
  rmSync(base, { recursive: true, force: true })
  throw new Error('pasta da prova caiu dentro da memória ou da casa real')
}
const casa = join(base, 'casa')
const copia = join(base, 'copia')
mkdirSync(casa)
mkdirSync(copia)

// Mesmo critério do runtime: fatal e ignoreBOM. Arquivo que não decodifica fica intocado lá
// e fora do agregado aqui.
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const legivel = (bytes) => {
  try {
    utf8.decode(bytes)
    return true
  } catch {
    return false
  }
}
const ordem = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
const agregado = (pares) => banco.sha256(JSON.stringify([...pares].sort(ordem)))

// Fotografia da cópia: [id, sha256 dos bytes] de cada .md legível.
function disco() {
  const pares = []
  for (const projeto of readdirSync(copia)) {
    let nomes
    try {
      nomes = readdirSync(join(copia, projeto, 'memory'))
    } catch {
      continue
    }
    for (const nome of nomes) {
      const id = loja.idDoDocumento(projeto, nome)
      if (!id) continue
      const bytes = readFileSync(join(copia, projeto, 'memory', nome))
      if (legivel(bytes)) pares.push([id, banco.sha256(bytes)])
    }
  }
  return pares
}

const noBanco = () =>
  banco.comBancoDaCasa(casa, 'omni', (db) => {
    const vivos = db
      .prepare("SELECT id, sha256 FROM documentos WHERE apagado_em IS NULL AND id LIKE 'claude-projects/%'")
      .all()
      .map((linha) => [linha.id, linha.sha256])
    return {
      vivos: vivos.length,
      sha: agregado(vivos),
      lapides: db.prepare('SELECT COUNT(*) AS n FROM documentos WHERE apagado_em IS NOT NULL').get().n,
      bytes: db.prepare('SELECT COALESCE(SUM(bytes), 0) AS n FROM documentos WHERE apagado_em IS NULL').get().n,
      versoes: Object.fromEntries(db.prepare('SELECT versao, COUNT(*) AS n FROM documentos GROUP BY versao ORDER BY versao').all().map((l) => [l.versao, l.n])),
      base: db.prepare('SELECT COUNT(*) AS n FROM _documentos_no_disco').get().n,
      importacoes: db.prepare("SELECT COUNT(*) AS n FROM _importacoes WHERE tipo = 'documentos-md'").get().n,
      diario: Object.fromEntries(db.prepare("SELECT operacao, COUNT(*) AS n FROM _diario WHERE tabela = 'documentos' GROUP BY operacao ORDER BY operacao").all().map((l) => [l.operacao, l.n])),
      integridade: db.prepare('PRAGMA integrity_check').get().integrity_check
    }
  })

async function medir(rotulo, executar) {
  const inicio = performance.now()
  const resultado = await executar()
  console.log(`${rotulo.padEnd(48)} ${(performance.now() - inicio).toFixed(0).padStart(6)} ms`)
  console.log(`   ${resultado.resultado} ${JSON.stringify(resultado.contagens)}`)
  return resultado
}
const confere = (condicao, texto) => {
  console.log(`${condicao ? 'ok   ' : 'FALHA'} ${texto}`)
  if (!condicao) process.exitCode = 1
}
const reconciliar = () => md.reconciliarDocumentosMd(casa, { projectsRoot: copia })
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

try {
  // Cópia: só os .md de cada memory/ real, com o mesmo filtro de nome do runtime.
  const arquivos = []
  for (const entrada of readdirSync(real, { withFileTypes: true })) {
    if (!entrada.isDirectory() || !loja.segmentoValido(entrada.name)) continue
    let itens
    try {
      itens = readdirSync(join(real, entrada.name, 'memory'), { withFileTypes: true })
    } catch {
      continue
    }
    const mds = itens.filter((item) => item.isFile() && loja.idDoDocumento(entrada.name, item.name))
    if (mds.length === 0) continue
    mkdirSync(join(copia, entrada.name, 'memory'), { recursive: true })
    for (const item of mds) {
      const caminho = join(copia, entrada.name, 'memory', item.name)
      copyFileSync(join(real, entrada.name, 'memory', item.name), caminho)
      const bytes = readFileSync(caminho)
      arquivos.push({ projeto: entrada.name, caminho, bytes: bytes.length, legivel: legivel(bytes) })
    }
  }
  const legiveis = arquivos.filter((a) => a.legivel)
  const projetos = new Set(arquivos.map((a) => a.projeto)).size
  const N = legiveis.length
  const totalBytes = legiveis.reduce((soma, a) => soma + a.bytes, 0)
  const shaCopia = agregado(disco())
  console.log(`node ${process.versions.node}; cópia: ${projetos} projetos, ${arquivos.length} .md (${arquivos.length - N} ilegíveis), ${totalBytes} bytes; agregado ${shaCopia.slice(0, 12)}`)

  const r1 = await medir('1. primeira passada (ingestão)', reconciliar)
  const b1 = noBanco()
  confere(r1.resultado === 'concluida', 'resultado concluida')
  confere(r1.contagens.lidos === N && r1.contagens.pulados === arquivos.length - N, `leu ${N} e pulou só os ilegíveis`)
  confere(r1.contagens.ingeridos === N && r1.contagens.projetados === 0 && r1.contagens.apagados === 0, 'ingeriu tudo que leu, sem projetar nem apagar')
  confere(b1.vivos === N && b1.lapides === 0, `banco com ${b1.vivos} documentos vivos e nenhuma lápide`)
  confere(b1.sha === shaCopia, `hash agregado banco = cópia (${b1.sha.slice(0, 12)})`)
  confere(b1.bytes === totalBytes, `bytes no banco = bytes da cópia (${b1.bytes})`)
  confere(b1.base === N, 'base desta máquina para cada documento')
  confere(b1.importacoes === 1, 'uma importação registrada')
  confere(igual(b1.diario, { I: N }), `diário ${JSON.stringify(b1.diario)}: um I por documento`)

  const mtimes = new Map(legiveis.map((a) => [a.caminho, statSync(a.caminho).mtimeMs]))
  const r2 = await medir('2. segunda passada (em dia)', reconciliar)
  const b2 = noBanco()
  confere(igual(r2.contagens, { lidos: N, atuais: N, ingeridos: 0, apagados: 0, projetados: 0, pulados: arquivos.length - N }), 'tudo em dia: nada ingerido, projetado ou apagado')
  confere(legiveis.every((a) => statSync(a.caminho).mtimeMs === mtimes.get(a.caminho)), 'nenhum arquivo reescrito')
  confere(b2.importacoes === 1 && igual(b2.diario, b1.diario) && igual(b2.versoes, b1.versoes), 'nenhuma importação, versão ou linha de diário nova')

  // O projeto com mais arquivos perde a memory/ inteira; a passada tem de devolvê-la do banco.
  const porProjeto = new Map()
  for (const a of legiveis) porProjeto.set(a.projeto, [...(porProjeto.get(a.projeto) ?? []), a])
  const [maior, deles] = [...porProjeto].sort((a, b) => b[1].length - a[1].length)[0]
  const antes = new Map(deles.map((a) => [a.caminho, readFileSync(a.caminho)]))
  rmSync(join(copia, maior, 'memory'), { recursive: true, force: true })
  const r3 = await medir(`3. memory/ do maior projeto apagada (${deles.length} .md)`, reconciliar)
  const b3 = noBanco()
  confere(r3.contagens.projetados === deles.length && r3.contagens.atuais === N - deles.length, `projetou os ${deles.length} e o resto ficou em dia`)
  confere(r3.contagens.apagados === 0 && b3.lapides === 0, 'nenhuma lápide')
  confere(deles.every((a) => existsSync(a.caminho) && Buffer.compare(readFileSync(a.caminho), antes.get(a.caminho)) === 0), 'memory/ regenerada byte a byte')
  confere(agregado(disco()) === shaCopia && b3.sha === shaCopia, 'cópia e banco de volta ao agregado original')
  confere(b3.importacoes === 1, 'projeção não conta como importação')
  confere(b3.base === N, 'base desta máquina segue com um registro por documento')

  // Edição externa num arquivo de outro projeto: versão nova no banco, nada projetado.
  const alvo = legiveis.find((a) => a.projeto !== maior) ?? legiveis[0]
  appendFileSync(alvo.caminho, '\nProva F1: linha acrescentada só na cópia descartável.\n')
  const r4 = await medir('4. edição externa num arquivo', reconciliar)
  const b4 = noBanco()
  confere(r4.contagens.ingeridos === 1 && r4.contagens.projetados === 0 && r4.contagens.atuais === N - 1, 'a edição entra como versão nova; o resto em dia')
  confere(b4.versoes['2'] === 1, `versões ${JSON.stringify(b4.versoes)}`)
  confere(b4.importacoes === 2, 'segunda importação registrada')
  confere(b4.sha === agregado(disco()), 'banco = cópia depois da edição')

  // Arquivo apagado com irmãos vivos: lápide, e o arquivo não volta.
  const irmao = legiveis.find((a) => a !== alvo && a.projeto !== maior && porProjeto.get(a.projeto).length >= 2) ?? legiveis.find((a) => a !== alvo)
  unlinkSync(irmao.caminho)
  const r5 = await medir('5. um arquivo apagado com irmãos vivos', reconciliar)
  const b5 = noBanco()
  confere(r5.contagens.apagados === 1 && r5.contagens.projetados === 0 && b5.lapides === 1, 'vira lápide no banco')
  confere(!existsSync(irmao.caminho), 'o arquivo não volta')
  confere(b5.vivos === N - 1 && b5.sha === agregado(disco()), 'banco vivo = cópia depois da lápide')
  confere(b5.importacoes === 3 && b5.base === N - 1, 'terceira importação; base esquecida para a lápide')

  const r6 = await medir('6. passada seguinte', reconciliar)
  const b6 = noBanco()
  confere(igual(r6.contagens, { lidos: N - 1, atuais: N - 1, ingeridos: 0, apagados: 0, projetados: 0, pulados: arquivos.length - N }), 'em dia de novo, sem ressuscitar a lápide')
  confere(!existsSync(irmao.caminho) && b6.lapides === 1 && b6.importacoes === 3, 'lápide e importações estáveis')
  confere(igual(b6.diario, { I: N, U: 2 }), `diário ${JSON.stringify(b6.diario)}: N inserções, uma edição e uma lápide`)
  confere(b6.integridade === 'ok', `integrity_check: ${b6.integridade}`)

  const pasta = banco.pastaDoBanco(casa)
  const tamanho = (nome) => {
    try {
      return statSync(join(pasta, nome)).size
    } catch {
      return 0
    }
  }
  console.log(`   omni.db ${tamanho('omni.db')} bytes + wal ${tamanho('omni.db-wal')}; degradações: ${tamanho('degradacoes.jsonl')} bytes`)
  confere(tamanho('degradacoes.jsonl') === 0, 'nenhuma degradação anotada')
} finally {
  rmSync(base, { recursive: true, force: true })
  console.log(`pasta da prova removida: ${!existsSync(base)}`)
}
```

## Apêndice C: lista dos mutantes (T6)

Uso: `node gerar-mutantes-p2.mjs`, com o arquivo fora do repositório; grava `mutantes-p2.json` ao lado dele. Cada troca precisa aparecer exatamente uma vez no arquivo alvo; senão, o executor não a aplica.

```js
// Gera mutantes-p2.json (Apêndice A do plano 2 da F1). String.raw nos trechos com barra invertida.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CL = 'testes/casa-loja-documentos.test.mjs'
const CB = 'testes/casa-banco.test.mjs'
const DM = 'testes/documentos-md.test.mjs'
const VD = 'testes/varredura-diaria.test.mjs'
const ESQ = 'runtime/casa/esquemas.mjs'
const LOJA = 'runtime/casa/loja-documentos.mjs'
const MD = 'runtime/documentos-md.mjs'
const VAR = 'runtime/varredura-diaria.mjs'

const travaDe = [
  '  let trava',
  '  try {',
  "    trava = await acquireLocalFileLock(join(casa, 'runs', 'documentos-md.lock'), TRAVA)",
  '  } catch (erro) {',
  "    if (erro?.name === 'LocalJsonLockTimeoutError') return { resultado: 'em-andamento', contagens }",
  '    throw erro',
  '  }'
].join('\n')

const tryCatchDaVarredura = [
  '    let documentos',
  '    try {',
  '      documentos = await reconciliarDocumentosMd(casa)',
  '    } catch (erro) {',
  "      registrarDegradacao(casa, 'documentos.varredura', erro)",
  "      documentos = { resultado: 'degradada' }",
  '    }'
].join('\n')

const lista = [
  { nome: '01 esquemas: FK de _documentos_no_disco removida', arquivo: ESQ, de: '  id TEXT NOT NULL REFERENCES documentos (id),', para: '  id TEXT NOT NULL,', teste: [CL, CB] },
  { nome: '02 loja: segmento aceita barra invertida', arquivo: LOJA, de: String.raw`!/[\\/:\0]/.test(segmento)`, para: String.raw`!/[/:\0]/.test(segmento)`, teste: [CL, DM] },
  { nome: '03 loja: segmento aceita dois-pontos', arquivo: LOJA, de: String.raw`!/[\\/:\0]/.test(segmento)`, para: String.raw`!/[\\/\0]/.test(segmento)`, teste: [CL, DM] },
  { nome: '04 loja: segmento aceita ..', arquivo: LOJA, de: "segmento !== '.' && segmento !== '..' &&", para: "segmento !== '.' &&", teste: [CL, DM] },
  { nome: '05 loja: alteracao sem versao+1', arquivo: LOJA, de: 'atualizado_em = ?, versao = versao + 1, apagado_em = NULL WHERE id = ?', para: 'atualizado_em = ?, apagado_em = NULL WHERE id = ?', teste: [CL, DM] },
  { nome: '06 loja: mesmo hash vivo vira alteracao', arquivo: LOJA, de: "if (atual.apagado_em === null && atual.sha256 === sha) return 'igual'", para: "if (false) return 'igual'", teste: [CL, DM] },
  { nome: '07 loja: ressurreicao sem desmarcar a lapide', arquivo: LOJA, de: 'versao = versao + 1, apagado_em = NULL WHERE id = ?', para: 'versao = versao + 1 WHERE id = ?', teste: [CL, DM] },
  { nome: '08 loja: lapide repetida sobe versao', arquivo: LOJA, de: 'WHERE id = ? AND apagado_em IS NULL', para: 'WHERE id = ?', teste: [CL, DM] },
  { nome: '09 md: C===D sempre verdadeiro (projeta em vez de ingerir)', arquivo: MD, de: '} else if (B !== null && C === D) {', para: '} else if (B !== null) {', teste: [DM] },
  { nome: '10 md: lapide sem exigir irmao .md', arquivo: MD, de: '} else if (projeto.temMd && C === B) {', para: '} else if (C === B) {', teste: [DM] },
  { nome: '11 md: lapide sem exigir C===B', arquivo: MD, de: '} else if (projeto.temMd && C === B) {', para: '} else if (projeto.temMd) {', teste: [DM] },
  { nome: '12 md: projeto apagado volta a existir', arquivo: MD, de: 'const projeto = partes ? disco.projetos.get(partes.projeto) : null', para: 'const projeto = partes ? (disco.projetos.get(partes.projeto) ?? { temMd: false }) : null', teste: [DM] },
  { nome: '13 md: lapide contada como viva', arquivo: MD, de: 'const B = banco?.vivo ? banco.sha : null', para: 'const B = banco?.sha ?? null', teste: [DM] },
  { nome: '14 md: em dia sem acertar C', arquivo: MD, de: 'if (C !== D) confirmarNoDisco(db, id, D, carimbo)', para: 'if (false) confirmarNoDisco(db, id, D, carimbo)', teste: [DM] },
  { nome: '15 md: lapide de fora sem esquecer C', arquivo: MD, de: 'if (C !== null) esquecerNoDisco(db, id, carimbo)', para: 'if (false) esquecerNoDisco(db, id, carimbo)', teste: [DM] },
  { nome: '16 md: projecao sem reler o hash', arquivo: MD, de: 'if ((atual === null ? null : sha256(atual)) !== projecao.esperado) {', para: 'if (false) {', teste: [DM] },
  { nome: '17 md: sem os intocados', arquivo: MD, de: 'if (!projeto || disco.intocados.has(id)) continue', para: 'if (!projeto) continue', teste: [DM] },
  { nome: '18 md: decodificador sem fatal', arquivo: MD, de: '{ fatal: true, ignoreBOM: true }', para: '{ fatal: false, ignoreBOM: true }', teste: [DM] },
  { nome: '19 md: decodificador come o BOM', arquivo: MD, de: '{ fatal: true, ignoreBOM: true }', para: '{ fatal: true, ignoreBOM: false }', teste: [DM] },
  { nome: '20 md: _importacoes registrada sempre', arquivo: MD, de: 'if (contagens.ingeridos + contagens.apagados > 0) {', para: 'if (true) {', teste: [DM] },
  { nome: '21 md: sem o em-andamento', arquivo: MD, de: "    if (erro?.name === 'LocalJsonLockTimeoutError') return { resultado: 'em-andamento', contagens }\n", para: '', teste: [DM] },
  { nome: '22 md: sem-projetos so depois da trava', arquivo: MD, de: "  if (!ehPasta(raiz)) return { resultado: 'sem-projetos', contagens }\n" + travaDe, para: travaDe + "\n  if (!ehPasta(raiz)) { await trava.release(); return { resultado: 'sem-projetos', contagens } }", teste: [DM] },
  { nome: '23 md: sem conferir o SQLite', arquivo: MD, de: "  if (!sqliteDisponivel(env)) return { resultado: 'sem-banco', contagens }\n", para: '', teste: [DM] },
  { nome: '24 md: casa de producao comparada com ===', arquivo: MD, de: "mesmoCaminho(absoluta, resolve(env.APPDATA, 'omni'))", para: "absoluta === resolve(env.APPDATA, 'omni')", teste: [DM] },
  { nome: '25 md: sem confirmar C depois da projecao', arquivo: MD, de: 'if (feitas.length > 0) {', para: 'if (false) {', teste: [DM] },
  { nome: '26 md: sha da string (equivalente esperado)', arquivo: MD, de: 'arquivos.set(id, { conteudo, sha: sha256(bytes), bytes: bytes.length })', para: 'arquivos.set(id, { conteudo, sha: sha256(conteudo), bytes: bytes.length })', teste: [DM] },
  { nome: '27 vd: varredura sem reconciliar', arquivo: VAR, de: '      documentos = await reconciliarDocumentosMd(casa)', para: "      documentos = { resultado: 'concluida', contagens: { lidos: 0, atuais: 0, ingeridos: 0, apagados: 0, projetados: 0, pulados: 0 } }", teste: [VD] },
  { nome: '28 vd: varredura repassa projectsRoot', arquivo: VAR, de: '      documentos = await reconciliarDocumentosMd(casa)', para: '      documentos = await reconciliarDocumentosMd(casa, { projectsRoot })', teste: [VD] },
  { nome: '29 vd: reconcilia antes do not-due', arquivo: VAR, de: '    const store = await carregar(casa)\n    if (automatic && !force && store.lastAutomaticCheckAt) {', para: '    const store = await carregar(casa)\n    await reconciliarDocumentosMd(casa)\n    if (automatic && !force && store.lastAutomaticCheckAt) {', teste: [VD] },
  { nome: '30 vd: varredura sem o try/catch da reconciliacao', arquivo: VAR, de: tryCatchDaVarredura, para: '    const documentos = await reconciliarDocumentosMd(casa)', teste: [VD] }
]
writeFileSync(join(import.meta.dirname, 'mutantes-p2.json'), JSON.stringify(lista, null, 2))
console.log(`${lista.length} mutantes gravados`)
```
