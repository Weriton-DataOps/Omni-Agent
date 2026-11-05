# F1, plano 1: fundação da casa e memória no `omni.db` — plano de implementação

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** o `omni.db` (SQLite embutido) vira a fonte da memória do Omni, e o `memory.json` passa a ser a projeção dele, idêntica byte a byte à de hoje. Tudo isso sem servidor, sem dependência nova e sem derrubar o Omni quando falta o banco.

**Arquitetura:** quatro módulos novos em `runtime/casa/` (banco, esquemas, projeção e loja da memória), costurados em `runtime/memoria.mjs`. Toda carga reconcilia arquivo e banco pelo hash. Toda gravação entra primeiro no banco, numa transação `BEGIN IMMEDIATE`, e depois no arquivo, por escrita atômica. Com o banco fora do ar, a falha vira uma linha em `degradacoes.jsonl` e a memória continua no arquivo, como sempre foi.

**Tecnologia:** `node:sqlite` (`DatabaseSync`, carregado por `process.getBuiltinModule`), Node ≥ 22.13 (o CI usa 22; a máquina do Weriton, 24) e `node:test`. Nenhuma dependência npm nova.

**Desenho:** [Casa única: Omni, Overcore e Oráculo](../specs/2026-11-04-casa-unica-tres-agentes-design.md): §3.1 (portabilidade), §3.5 (muitas sessões), §3.6 (a memória no `omni.db`) e §6 (fases e provas).

**Situação em 05/11/2026:** entregue. T1 a T10 feitas e publicadas no `origin/casa-sqlite-f1`: `124c516` (fundação), `c375b59` (memória) e `6947443` (registro do push e da CI), commits de 04/11. O PR sai no plano 8.

---

## Escopo: a F1 em oito planos

A F1 do desenho (§6) entrega `nucleo.db`, `omni.db` e `cofre.db`, os importadores, a projeção `.md` e o card Cofre. É coisa demais para um plano só. Cada plano abaixo fecha com software funcionando e provado.

| # | Plano | Desenho | Estado |
|---|---|---|---|
| 1 | **Este:** fundação da casa + memória no `omni.db` | §3, §3.1, §3.5, §3.6 | entregue |
| 2 | [Documentos `.md` da memória do Claude Code como projeção (tabela `documentos`)](2026-11-05-f1-plano-2-documentos-md.md) | §3.2 | entregue |
| 3 | Aprendizado, falhas e feedback no `omni.db`, com importador | §4.2, §6 | a escrever |
| 4 | Cofre (`cofre.db`): importação dos `.dpapi`, inventário só com os nomes do Credential Manager, ponte DPAPI, CLI, exportação e importação com scrypt + AES-256-GCM | §8; prova em §8.5 | a escrever |
| 5 | Card Cofre na ilha, falando pela API do Omni | §8.2, §3.4 | a escrever |
| 6 | Núcleo (`nucleo.db`): agentes e máquinas | §4.2 | a escrever |
| 7 | Diagnóstico que lê `degradacoes.jsonl` | §3.6 | a escrever |
| 8 | Release 0.26.0: `contratos/atualizacao/integridade.json` com o fingerprint novo, versão nova, PR (merge só com o ok do Weriton) | — | a escrever |

## Regra de congelamento das migrações

A v1 do `omni.db` congela no merge ou na release, o que acontecer primeiro. O motivo: `scripts/activate-omni-learning.mjs`, `scripts/validate-omni-memory.mjs` e o controller do omni-desktop importam `runtime/memoria.mjs` direto do checkout. Depois do merge, qualquer um deles cria um `omni.db` real com a v1. Daí em diante, mudança de esquema entra como migração nova (v2, v3…), nunca como edição da v1. A tabela `_migracoes` recusa migração alterada depois de aplicada (mutante 7 do Apêndice A).

As v1 de `nucleo.db` e `cofre.db` seguem revisáveis até os planos 6 e 4, porque o código deste plano só abre o banco `omni`.

## Mapa de arquivos

| Arquivo | Responsabilidade | Importa |
|---|---|---|
| `runtime/casa/esquemas.mjs` (novo) | Definição dos três bancos (`BANCOS`): `omni` v1 (memorias, memoria_meta, documentos), `cofre` v1 (credenciais, usos), `nucleo` v1 (agentes, maquinas); tabelas internas `_diario` (com gatilhos), `_projecoes` e `_importacoes` | nada |
| `runtime/casa/banco.mjs` (novo) | Carga do `node:sqlite`, pasta do banco, abertura com pragmas, migrações com hash em `_migracoes`, `transacao` em `BEGIN IMMEDIATE`, `comBanco`/`comBancoDaCasa` (abre, usa, fecha), `uuidv7`, `registrarDegradacao` | `esquemas.mjs` |
| `runtime/casa/projecao.mjs` (novo) | `lerSeExistir`, `situacaoDaProjecao` (vazio, atual, sem-arquivo, defasada, externa), `registrarProjecao`, `escreverAtomico` | `banco.mjs` |
| `runtime/casa/loja-memoria.mjs` (novo) | Memória ↔ linhas: `ARQUIVO_MEMORIA`, `RAIAS`, `textoDaMemoria`, `shaDaMemoriaNoBanco`, `lerMemoriaDoBanco`, `contarMemoriaNoBanco`, `gravarMemoriaNoBanco`, `salvarMemoria`, `ingerirMemoria` | `banco.mjs`, `projecao.mjs` |
| `runtime/memoria.mjs` (modificado, +139 −30) | Reconciliação a cada carga, gravação banco → arquivo, degradação; a API pública não muda e toda função continua recebendo a `casa` explícita | `casa/banco.mjs`, `casa/loja-memoria.mjs`, `casa/projecao.mjs` (e o lock de `dist`, que já existia) |
| `testes/casa-banco.test.mjs` (novo) | 21 testes: fundação (T1) e projeção (T2) | — |
| `testes/casa-loja-memoria.test.mjs` (novo) | 8 testes da loja (T3) | — |
| `testes/memoria-casa.test.mjs` (novo) | 21 testes da costura em `memoria.mjs` (T4) | — |
| `package.json` (T7) | `node --check` dos quatro módulos da casa no `npm run check` | — |

Nenhum módulo de `runtime/casa/` importa `runtime/memoria.mjs` ou pacote npm. Fora da cadeia acima, só entram módulos `node:*`.

## O que o executor precisa saber antes de rodar qualquer coisa

1. **Ler a memória também grava.** Com a reconciliação, até uma carga cria e ingere o `omni.db`. Uma carga feita com a casa de produção (`%APPDATA%\omni`) criaria `%LOCALAPPDATA%\omni\casa`. Seis portas de entrada caem em `casaDoOmni()` quando ninguém passa a casa: `runtime/cli.mjs:100`, `runtime/hook-contexto.mjs:174`, `runtime/hook-reconciliacao.mjs:123`, `runtime/hook-release-loaded.mjs:17`, `runtime/hook-varredura.mjs:59` e `runtime/release-gate.mjs:23`. Teste nunca roda contra a casa real. Ler as contagens dela, sem passar pelo `memoria.mjs`, pode.
2. **Auditoria de vazamento (04/11): limpa.** Nenhum caminho do `npm run verify` cria `%LOCALAPPDATA%\omni\casa`:
   - os testes usam `OMNI_HOME` temporário, `casa` explícita ou dependências simuladas;
   - a única chamada com o `process.env` puro, `testes/cli.test.mjs:261` (comando `personalidade`), não chega à memória;
   - mesmo assim, T8 e T9 conferem a pasta antes e depois.
3. **Teste vermelho de nascença.** O teste "contrato canônico declara a versão e exatamente o fingerprint do payload" (`testes/integridade-release.test.mjs:165`) já falha na base `b4d82fc`. A falha entra pelo lado `3e710b4` do merge, porque no `main` (`c8a4bec`) a CI passa nesse teste (T10, passo 6). É o único da suíte que compara com a raiz real do repositório (os outros usam fixture), e o plano 8 conserta. Como o `npm test` encadeia com `&&`, essa falha esconde os testes de `.test-dist`, o `test:dist` e o `verify:build`. Por isso T9 roda os três à parte.
4. **Empacotamento.**
   - `scripts/check-package.mjs` varre `runtime/**/*.mjs` e só barra import `../dist/` que não existe; os módulos da casa não importam `dist`.
   - `runtime/integridade-release.mjs` monta o payload varrendo as `PAYLOAD_ROOTS`, e `runtime` está entre elas. Então `runtime/casa/*` entra na instalação sem configuração e o fingerprint muda (veja o item 3).
   - `verificarCoberturaEntrypoints` lê os `node --check` do `package.json`. As entradas novas do T7 apontam para arquivos do payload.
5. **`dist` com fim de linha fantasma.** Todo `build:ts` regera `dist/` com CRLF. Ele roda dentro do `verify`, do `pretest` (que o `npm test` dispara sozinho) e do `test:dist`. Antes de commitar:
   - `git diff --ignore-cr-at-eol --stat -- dist` tem de sair vazio;
   - em seguida, `git checkout -- dist`.
6. **O typecheck não enxerga `runtime/`.** O `tsc` cobre só `src/**/*.ts`. Em `runtime/casa`, quem garante são o `node --check` (T7) e os testes.
7. **Node 22.** Lá o runner precisa de `--test-reporter=spec` para imprimir o nome dos testes, e o `node:sqlite` emite um ExperimentalWarning. A casa cala só esse aviso (mutante 12).
8. **Shell.** Os comandos estão em PowerShell, na raiz do worktree. Cada bloco redefine `$rascunho`, a pasta de trabalho fora do repo. Arquivos auxiliares são criados com editor, nunca com heredoc.
9. **Fim de linha no `src` gerado.** O `.gitattributes` manda `eol=lf` em `src/adapters/overcore/generated/**`. O `verify:generated`, primeiro passo do `check`, compara o contrato gerado byte a byte.
   - O problema: num worktree com `core.autocrlf=true`, o checkout pode ignorar o atributo e gravar CRLF (`git ls-files --eol` mostra `i/lf w/crlf`). O `check` cai com "Contrato gerado está desatualizado" sem nada desatualizado de verdade.
   - O conserto, reversível porque o conteúdo vem do índice: apagar `src/adapters/overcore/generated/authorization-contract-v1.ts` e rodar `git checkout -- src/adapters/overcore/generated/authorization-contract-v1.ts`. Depois disso, o `ls-files --eol` mostra `w/lf`.
   - Aconteceu no worktree desta F1 em 04/11. O job Windows do CI só chega ao `npm test` se o `check` passar, e a T10 confere isso.
10. **`%TEMP%` em formato curto.** Nesta máquina o `$env:TEMP` vem no formato 8.3, com `~1` no nome da pasta do usuário.
   - Git, tar, node, `Get-Content`, `Out-File` e `Select-String` aceitam esse caminho. O `Push-Location` e o `Remove-Item` do PowerShell 5.1 recusam, com "Não existe um objeto no caminho especificado".
   - Sem `-ErrorAction Stop`, o bloco segue rodando na pasta em que estava. Em 04/11 a primeira prova isolada do commit 1 rodou assim, dentro do worktree, e o 29/29 dela não provava nada.
   - O conserto: `$rascunho` sai de `$env:LOCALAPPDATA`, que vem no formato longo; os cmdlets de pasta levam `-ErrorAction Stop`; e a prova imprime a pasta corrente e para se ela não for a extração.
11. **Identidade dos commits.** O repositório é da conta `Weriton-DataOps`, e os commits saem com a identidade dela: nome `Weriton-DataOps` e o e-mail vinculado à conta, o mesmo dos commits dela no `origin/main`.
   - O git global da máquina tem a identidade da empresa, que vale para os repos da GR. Aqui a identidade vai no próprio comando (`git -c user.name=… -c user.email=… commit`), sem mexer na config, que é compartilhada por todos os worktrees.
   - Em 04/11 o commit 1 saiu primeiro com a identidade da empresa. O Weriton corrigiu antes do push; o commit foi desfeito com `git reset --soft HEAD~1` e refeito. O merge de base com o `origin/main` também tinha saído com ela e foi regravado com a mesma árvore e os mesmos pais (`git commit-tree`); os SHAs citados neste plano já são os da regravação.

---

## Tarefas feitas (T1 a T6)

### Task 1: fundação do banco

**Arquivos:** `runtime/casa/esquemas.mjs`, `runtime/casa/banco.mjs`, `testes/casa-banco.test.mjs` (17 dos 21 testes)

- [x] Testes verdes, com dente provado pela mutação (T5: mutantes 1 a 13 e 59 a 64).
- [x] Implementação:
  - pragmas na ordem do §3.6 (`busy_timeout=5000`; WAL com insistência na virada; `synchronous=NORMAL`; `foreign_keys=ON`);
  - migrações com hash e releitura dentro da trava;
  - `transacao` em `BEGIN IMMEDIATE`, que recusa trabalho assíncrono;
  - conexão que fecha sempre.
- [x] Testes:
  - OMNI_CASA_SEM_SQLITE=1 desliga o banco com erro identificavel
  - so o aviso experimental do sqlite e calado
  - pasta do banco: variavel manda, casa de producao vai para o Local, as outras guardam dentro
  - pasta do banco reconhece a casa de producao sem diferenciar maiusculas no Windows (pulado fora do Windows)
  - uuid v7 tem formato, carimbo de tempo e ordem
  - transacao confirma, desfaz no erro e recusa trabalho assincrono
  - comBanco fecha a conexao sempre, inclusive quando o uso devolve promessa
  - migracoes sao idempotentes e recusam migracao alterada depois de aplicada
  - pragmas da casa valem em toda conexao
  - processos que abrem o banco ao mesmo tempo aplicam cada migracao uma vez so
  - gravadores concorrentes em processos separados esperam a vez e nao perdem linha
  - transacao que le e depois grava espera a vez em vez de devolver ocupado
  - cada banco da casa abre com as tabelas do desenho
  - diario anota insercao, mudanca de versao e remocao; arrumacao de ordem nao vira trafego
  - registro de degradacao guarda operacao e erro, nunca trecho de conteudo
  - falha ao anotar a degradacao nunca vira a segunda falha
  - abrirBanco fecha a conexao quando a migracao falha

### Task 2: projeção

**Arquivos:** `runtime/casa/projecao.mjs`, `testes/casa-banco.test.mjs` (4 testes)

- [x] Testes verdes, com dente provado pela mutação (mutantes 14 a 16):
  - situacao da projecao cobre vazio, externa, sem-arquivo, atual e defasada
  - registrar a mesma projecao de novo nao duplica nem troca o papel
  - escrita atomica cria a pasta, substitui o arquivo e nao deixa temporario
  - lerSeExistir devolve null so para arquivo ausente

### Task 3: loja da memória

**Arquivos:** `runtime/casa/loja-memoria.mjs`, `testes/casa-loja-memoria.test.mjs` (8 testes)

- [x] Testes verdes, com dente provado pela mutação (mutantes 17 a 25 e 49 a 57):
  - banco sem memoria devolve null, hash nulo e contagem zerada
  - ida e volta devolve o mesmo texto byte a byte, inclusive a ordem das chaves
  - colunas de busca saem do registro e, no arquivo morto, do snapshot
  - mudanca de conteudo sobe a versao; mudanca so de ordem nao sobe e nao vai ao diario
  - registro que sai vira lapide, volta ressuscitado e a lapide nao e reenterrada
  - promover candidata muda a raia na mesma linha
  - id repetido e registro sem id nao se perdem e ganham identidade estavel
  - raia ausente continua ausente e raia que nao e lista e recusada sem gravar pela metade

### Task 4: costura em `runtime/memoria.mjs`

**Arquivos:** `runtime/memoria.mjs`, `testes/memoria-casa.test.mjs` (21 testes; dois laços geram 2 + 3 deles)

- [x] Testes verdes, com dente provado pela mutação (mutantes 26 a 48 e 58):
  - gravar leva a memoria ao banco e o arquivo vira projecao exata da versao do banco
  - memoria em dia carrega sem reescrever o arquivo
  - escrita de versao antiga do plugin direto no arquivo e ingerida e sobrevive a gravacao seguinte
  - arquivo editado fora do formato canonico e ingerido e reescrito; a copia velha que volta nao reentra
  - projecao velha que o proprio banco escreveu volta e o banco vence
  - arquivo apagado volta do banco byte a byte
  - arquivo invalido (JSON quebrado / fora do contrato) com banco populado: o banco vence e o invalido fica guardado ao lado (2)
  - arquivo invalido sem memoria no banco continua sendo erro e nada e tocado
  - versao futura no arquivo com banco populado e recusada sem tocar arquivo nem banco
  - com OMNI_CASA_SEM_SQLITE=1 a memoria volta ao arquivo puro e o banco ingere quando volta
  - banco quebrado nao derruba a memoria: grava no arquivo, anota a degradacao e o banco consertado ingere
  - memoria v1 migra com banco: um backup so, banco com a versao migrada e importacao registrada
  - sessoes em processos separados gravando juntas nao perdem registro e o arquivo fecha com o banco
  - memoria de plugin mais novo no banco (projecao em dia / sem arquivo / arquivo quebrado) e recusada sem reescrever projecao nem banco (3)
  - ingestao que falha carrega do arquivo, anota a degradacao e tenta de novo na carga seguinte
  - gravacao que falha no meio desfaz o banco inteiro e o arquivo leva a versao ate o banco voltar
  - projecao que nao sai nao perde a gravacao: o banco guarda e a carga seguinte reescreve o arquivo (pulado fora do Windows)
  - sem banco e sem projecao a gravacao falha para quem chamou (pulado fora do Windows)

### Task 5: mutação

- [x] 64 mutantes nos cinco arquivos, 0 sobreviventes. Cada um aplica uma troca única no código e roda as suítes da casa. A tabela do Apêndice A saiu do resultado do executor por script; ninguém digitou nada à mão. Ela mostra, para cada mutante, o teste que ficou vermelho e a asserção que o derrubou.
- [x] Regra da metodologia: mutante que morre no setup não prova nada. A classificação seguiu a mensagem exata de cada morte.
- [x] Achado da rodada: o mutante "transacao sem IMMEDIATE" só morria por corrida no setup da migração. Pela regra acima, isso não vale. Daí nasceu o teste dedicado "transacao que le e depois grava espera a vez em vez de devolver ocupado":
  - o pai migra antes da largada, então a única corrida que sobra é o ler e gravar da transação;
  - quatro processos fazem 25 incrementos cada, e o contador tem de fechar em 100.
- [x] Prova isolada desse mutante: trocado `BEGIN IMMEDIATE` por `BEGIN` e rodado só o teste dedicado, três vezes. Deu 3/3 vermelhos, com `Error: database is locked` na linha do `UPDATE` (`[eval1]:9`). O arquivo foi restaurado e conferido pelo sha256.

### Task 6: prova com a memória real

- [x] O script do Apêndice B copia o `memory.json` real para uma casa temporária (recusa casa dentro da real) e mede cinco passos. Imprime só contagens, hashes e tempos, nunca texto de memória, e apaga a cópia no fim.
- [x] Resultado (04/11): todas as conferências "ok" nos dois Nodes.

  | | Node 24.17.0 | Node 22.23.4 |
  |---|---|---|
  | 1. primeira carga (ingestão) | 110 ms | 121 ms |
  | 2. segunda carga (em dia) | 19 ms | 21 ms |
  | 3. arquivo apagado (regeneração) | 46 ms | 24 ms |
  | 4. gravação (`lembrarExplicitamente`) | 79 ms | 56 ms |
  | 5. base: carga só do arquivo (sem banco) | 12 ms | 13 ms |

  Memória original: 431 confirmadas, 73 candidatas e 13 arquivadas (606.257 bytes).
  - Manutenção não rodou e o diário registrou 517 inserções.
  - O banco guardou o texto original byte a byte, e o arquivo regenerado saiu igual ao real, byte a byte.
  - As confirmadas foram de 431 para 432 depois da gravação, e o `integrity_check` deu ok.
  - O `omni.db` ficou com 958.464 bytes, WAL zerado e nenhuma degradação.
- [x] As três suítes da casa, rodadas de novo nos dois Nodes, deram 50/50.

---

## Tarefas da entrega (T7 a T10)

### Task 7: `node --check` dos módulos da casa no `npm run check`

O `tsc` não olha `runtime/`, e `node --check runtime/memoria.mjs` não segue import. Hoje, um erro de sintaxe em `runtime/casa/*.mjs` passa pelo `npm run check` e só aparece quando algum teste carrega o módulo.

**Arquivos:**
- Modificar: `package.json:26` (script `check`)
- Auxiliar fora do repo: `$rascunho\mutante-sintaxe.mjs`

- [x] **Passo 1: criar o mutante de sintaxe** em `$rascunho\mutante-sintaxe.mjs`:

```js
// Quebra a sintaxe de runtime/casa/banco.mjs, roda `npm run check` e restaura o arquivo sempre.
// Uso: node mutante-sintaxe.mjs <raiz-do-repo>
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const raiz = resolve(process.argv[2] ?? '.')
const caminho = join(raiz, 'runtime', 'casa', 'banco.mjs')
const original = readFileSync(caminho)
const hash = (conteudo) => createHash('sha256').update(conteudo).digest('hex')
const antes = hash(original)
try {
  writeFileSync(caminho, Buffer.concat([original, Buffer.from('\nexport const = 1\n')]))
  const r = spawnSync('npm run check', { cwd: raiz, encoding: 'utf8', shell: true, windowsHide: true })
  const saida = `${r.stdout}\n${r.stderr}`
  const aponta = saida.split('\n').find((linha) => /casa[\\/]banco\.mjs:\d+/.test(linha))
  console.log(`status ${r.status}; SyntaxError: ${/SyntaxError/.test(saida)}; aponta: ${aponta?.trim() ?? '(nenhuma linha cita banco.mjs)'}`)
} finally {
  writeFileSync(caminho, original)
  console.log(`restaurado: ${hash(readFileSync(caminho)) === antes} (${antes.slice(0, 12)})`)
}
```

- [x] **Passo 2: ver o furo, antes da edição.** Pré-condição: o `check` sem mutante tem de sair 0. Se ele cair no `verify:generated`, veja o item 9 das orientações.

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
node "$rascunho\mutante-sintaxe.mjs" .
```

Esperado: `status 0; SyntaxError: false; aponta: (nenhuma linha cita banco.mjs)` e `restaurado: true (fe84dafef5cd)`. O `check` aceita um `banco.mjs` quebrado.

- [x] **Passo 3: editar o `package.json`.** Na linha 26, trocar o trecho único

```
node --check runtime/memoria.mjs && 
```

por

```
node --check runtime/memoria.mjs && node --check runtime/casa/banco.mjs && node --check runtime/casa/esquemas.mjs && node --check runtime/casa/projecao.mjs && node --check runtime/casa/loja-memoria.mjs && 
```

(com o espaço final, que separa do `node --check runtime/contexto.mjs` seguinte).

- [x] **Passo 4: `check` limpo passa**

```powershell
npm run check; "saida: $LASTEXITCODE"
```

Esperado: `saida: 0`.

- [x] **Passo 5: o mutante agora morre no lugar certo**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
node "$rascunho\mutante-sintaxe.mjs" .
```

Esperado: `status 1; SyntaxError: true; aponta: …runtime\casa\banco.mjs:250` e `restaurado: true (fe84dafef5cd)`. A linha 250 é a do `export const = 1` acrescentado. O sha256 completo do `banco.mjs` restaurado é `fe84dafef5cd07e050c5becd7e1daff8d36ef254d0de9d002f3c5f5810139bae`.

Resultado (04/11), nos três pontos igual ao esperado:
- antes da edição, `status 0; SyntaxError: false`;
- depois, o `check` limpo deu `saida: 0`;
- o mutante deu `status 1; SyntaxError: true; aponta: …\runtime\casa\banco.mjs:250`, com `restaurado: true (fe84dafef5cd)`.

### Task 8: sinal rápido

Roda as suítes que tocam memória, contexto, CLI e pacote em pouco mais de um minuto, antes do verify completo.

- [x] **Passo 1: guarda antes**

```powershell
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `False`.

- [x] **Passo 2: suítes da memória e vizinhas**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
node --test --test-concurrency=1 --test-reporter=spec testes/casa-banco.test.mjs testes/casa-loja-memoria.test.mjs testes/memoria-casa.test.mjs testes/memoria.test.mjs testes/memoria-coordenador.test.mjs testes/manutencao-memoria.test.mjs testes/pipeline-memoria.test.mjs testes/recuperacao.test.mjs testes/contexto.test.mjs testes/hook-contexto.test.mjs testes/aprendizado-resultados.test.mjs testes/atalhos.test.mjs testes/pacote.test.mjs testes/recibos-evolucao-veto.test.mjs testes/sincronizacao-memoria-duravel.test.mjs testes/varredura-diaria.test.mjs testes/cli.test.mjs *> "$rascunho\t8.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t8.txt" -Pattern '(tests|pass|fail|skipped) \d+\s*$'
```

Esperado: `saida: 0` e `fail 0`. Anotar o total lido. O `cli.test.mjs` entra porque dispara o CLI de verdade, com `OMNI_HOME` temporário, e exercita o banco de ponta a ponta.

Resultado (04/11): `saida: 0`; `tests 181`, `pass 181`, `fail 0`, `skipped 0`, em 77 s.

- [x] **Passo 3: o vermelho conhecido, sozinho**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
node --test --test-concurrency=1 --test-reporter=spec testes/integridade-release.test.mjs *> "$rascunho\t8-integridade.txt"
Select-String -Path "$rascunho\t8-integridade.txt" -Pattern '(tests|pass|fail) \d+\s*$', 'integridade-release\.test\.mjs:165'
```

Esperado: `fail 1`, e a única falha é a da linha 165 (o fingerprint, já vermelho na base).

Resultado (04/11): `tests 6`, `pass 5`, `fail 1`. A única falha é `testes\integridade-release.test.mjs:165:1`, "contrato canônico declara a versão e exatamente o fingerprint do payload".

- [x] **Passo 4: guarda depois**

```powershell
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `False`.

Resultado (04/11): `False` antes e depois das duas rodadas.

### Task 9: verify completo

Uma suíte pesada por vez. Em 04/11 o verify levou 450 s neste worktree. Rodar em segundo plano e ler a saída só no fim.

- [x] **Passo 1: guarda antes** (`Test-Path "$env:LOCALAPPDATA\omni\casa"` → `False`)

- [x] **Passo 2: verify**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
npm run verify *> "$rascunho\verify.txt"; "saida: $LASTEXITCODE" | Out-File -Append -Encoding utf8 "$rascunho\verify.txt"
```

- [x] **Passo 3: ler o verify**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
Select-String -Path "$rascunho\verify.txt" -Pattern '(tests|pass|fail|skipped) \d+\s*$', '\.test\.mjs:\d+:\d+', '^saida: '
```

Esperado:
- `tests 612`, `pass 607`, `fail 1`, `skipped 4`;
- a única falha listada é `testes\integridade-release.test.mjs:165`;
- `saida: 1`.

Resultado (04/11): os três itens iguais ao esperado, em 450 s.
- `contracts:check` e `architecture:check` deram `ok` duas vezes, uma no verify e outra dentro do `check`.
- O `package:check` deu `{"ok":true,"distFiles":59,"runtimeDependencies":0}`.

O `npm test` só começa depois que `contracts:check`, `architecture:check`, `check`, `build:ts` e `package:check` passam, porque estão encadeados com `&&`. Chegar às contagens já prova esses cinco. Base de comparação, `b4d82fc`: 562 testes, 557 aprovados, 1 falha, 4 pulados. Os 50 a mais são os da casa.

- [x] **Passo 4: o que a falha conhecida mascara, rodado à parte**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
node --test --test-concurrency=1 .test-dist/testes/*.test.js *> "$rascunho\t9-test-dist.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t9-test-dist.txt" -Pattern '(tests|pass|fail) \d+\s*$'
npm run test:dist *> "$rascunho\t9-dist-production.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t9-dist-production.txt" -Pattern '(tests|pass|fail) \d+\s*$'
npm run verify:build *> "$rascunho\t9-verify-build.txt"; "saida: $LASTEXITCODE"
```

Esperado: as três com `saida: 0`, e as duas suítes com `fail 0`.

Resultado (04/11), as três com saída 0:
- `.test-dist`: `tests 55`, `pass 55`, `fail 0`;
- `test:dist`: `tests 1`, `pass 1`, `fail 0`;
- `verify:build`: `{"ok":true,"files":59}`.

- [x] **Passo 5: devolver o `dist` e conferir o que sobra**

```powershell
git diff --ignore-cr-at-eol --stat -- dist
git checkout -- dist
git status --short
```

Esperado:
- o `diff` sai vazio;
- depois do `checkout`, o `status` mostra só `M package.json`, `M runtime/memoria.mjs`, `?? docs/superpowers/`, `?? runtime/casa/` e os três `?? testes/…` da casa.

Resultado (04/11):
- o `diff` imprimiu só os avisos de LF para CRLF, sem nenhuma linha de `--stat`;
- o `status` mostrou exatamente esses sete itens.

- [x] **Passo 6: guarda depois** (`Test-Path "$env:LOCALAPPDATA\omni\casa"` → `False`). Resultado (04/11): `False` em três momentos: antes do verify, depois das três rodadas à parte e depois do `checkout`.

### Task 10: dois commits, push e CI

O primeiro commit é a fundação, que fica de pé sozinha. O segundo liga a memória nela. Assim, cada commit passa nos próprios testes.

- [x] **Passo 1: identidade.** A identidade sai do histórico da conta e vai no próprio comando (item 11 de "O que o executor precisa saber"):

```powershell
$email = git log origin/main --author='Weriton-DataOps' -1 --format='%ae'
if (-not $email) { throw 'sem commit da Weriton-DataOps no origin/main' }
$identidade = @('-c', 'user.name=Weriton-DataOps', '-c', "user.email=$email")
"identidade: Weriton-DataOps <$email>"
```

Esperado: `Weriton-DataOps` com o e-mail vinculado à conta. Os passos 2 e 4 repetem as três primeiras linhas. Resultado (04/11): a primeira gravação usou o git global, com a identidade da empresa, e foi refeita com esta (item 11).

- [x] **Passo 2: commit 1, a fundação.** Mensagem em `$rascunho\commit1.txt`, criada com editor, sem acento (convenção dos commits deste repo):

```
feat(casa): fundacao SQLite embutida da casa do Omni

Abre a casa em node:sqlite, sem servidor nem dependencia nova: pragmas
na ordem do desenho (busy_timeout, WAL com insistencia na virada,
synchronous NORMAL, foreign_keys), migracoes com hash em _migracoes,
transacao sempre em BEGIN IMMEDIATE e conexao que fecha ao fim do uso.
Traz os esquemas v1 de omni, cofre e nucleo, a projecao (o arquivo como
espelho exato de uma versao do banco) e a loja da memoria (diferenca por
linha, lapide e ressurreicao, ordem das chaves preservada).

Banco fora do ar vira linha em degradacoes.jsonl, nunca queda. A casa de
producao guarda o banco em %LOCALAPPDATA%\omni\casa, fora do Roaming.
O npm run check passa a checar a sintaxe dos quatro modulos.

Desenho: docs/superpowers/specs/2026-11-04-casa-unica-tres-agentes-design.md
Plano: docs/superpowers/plans/2026-11-04-f1-casa-sqlite.md (T1-T3, T7)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$email = git log origin/main --author='Weriton-DataOps' -1 --format='%ae'
if (-not $email) { throw 'sem commit da Weriton-DataOps no origin/main' }
$identidade = @('-c', 'user.name=Weriton-DataOps', '-c', "user.email=$email")
git add runtime/casa/banco.mjs runtime/casa/esquemas.mjs runtime/casa/projecao.mjs runtime/casa/loja-memoria.mjs testes/casa-banco.test.mjs testes/casa-loja-memoria.test.mjs package.json docs/superpowers/specs/2026-11-04-casa-unica-tres-agentes-design.md docs/superpowers/plans/2026-11-04-f1-casa-sqlite.md
git diff --cached --stat
git @identidade commit -F "$rascunho\commit1.txt"
git log -1 --format='%h | autor %an | committer %cn'
```

Esperado: nove arquivos no `--stat`, `runtime/memoria.mjs` fora, e autor e committer `Weriton-DataOps`. Resultado (04/11): `124c516`, nove arquivos, 2445 inserções e 1 remoção, autor e committer `Weriton-DataOps`, pai `b4d82fc`, mensagem só ASCII, sem BOM nem CR. A primeira gravação, `31f8a6a`, saiu com a identidade da empresa e foi desfeita antes do push (item 11).

- [x] **Passo 3: provar o commit 1 isolado**, extraído sem o trabalho em curso:

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$x = Join-Path $rascunho 'commit1'
New-Item -ItemType Directory -Force $x | Out-Null
git archive --format=tar -o "$rascunho\commit1.tar" HEAD
tar -xf "$rascunho\commit1.tar" -C $x
foreach ($m in 'banco','esquemas','projecao','loja-memoria') { node --check "$x\runtime\casa\$m.mjs"; "check $m : $LASTEXITCODE" }
Push-Location -LiteralPath $x -ErrorAction Stop
$onde = (Get-Location).Path
"rodando em: $onde"
if ($onde -ne $x) { Pop-Location; throw 'a prova nao entrou na extracao' }
node --test --test-concurrency=1 --test-reporter=spec testes/casa-banco.test.mjs testes/casa-loja-memoria.test.mjs *> "$rascunho\commit1-testes.txt"; "saida testes: $LASTEXITCODE"
node scripts/check-package.mjs; "saida check-package: $LASTEXITCODE"
Pop-Location
Select-String -Path "$rascunho\commit1-testes.txt" -Pattern '(tests|pass|fail) \d+\s*$'
Remove-Item -LiteralPath $x, "$rascunho\commit1.tar" -Recurse -Force -ErrorAction Stop
'extracao apagada: ' + (-not (Test-Path -LiteralPath $x))
```

Esperado:
- `rodando em:` com a pasta da extração, nunca o worktree;
- os quatro `check … : 0`;
- `tests 29`, `pass 29`, `fail 0` e `saida testes: 0`;
- `{"ok":true,…}` e `saida check-package: 0`;
- `extracao apagada: True`.

Resultado (04/11), em `124c516`:
- `rodando em:` e o `process.cwd()` do node, os dois na extração;
- os quatro `check … : 0`;
- `tests 29`, `pass 29`, `fail 0`, `skipped 0` e `saida testes: 0`;
- `{"ok":true,"distFiles":59,"runtimeDependencies":0}` e `saida check-package: 0`;
- `runtime/memoria.mjs` da extração igual ao da base, e `testes/memoria-casa.test.mjs` fora dela;
- guarda `False` antes e depois, extração e tar apagados.

A primeira tentativa rodou no worktree por causa do caminho curto (item 10) e não vale.

- [x] **Passo 4: commit 2, a memória.** Antes, marcar neste plano as caixas já cumpridas. Mensagem em `$rascunho\commit2.txt`:

```
feat(memoria): omni.db vira a fonte da memoria e memory.json a projecao

Cada carga reconcilia arquivo e banco pelo hash: atual segue sem
reescrever, sem-arquivo e defasada o banco vence e reescreve a projecao,
externa (plugin antigo, edicao a mao, primeira importacao) e ingerida
numa transacao e registrada em _importacoes. Arquivo ilegivel com banco
populado fica guardado ao lado; memoria de plugin mais novo e sempre
erro. Gravacao vai ao banco primeiro e ao arquivo depois; quem chamou so
recebe erro quando nenhum dos dois guardou. Sem node:sqlite (ou com
OMNI_CASA_SEM_SQLITE=1) a memoria volta a ser so o arquivo.

Provas: 50/50 nas suites da casa em Node 22 e 24; 64 mutantes, nenhum
sobrevivente; memoria real copiada para casa descartavel com contagens e
bytes iguais (plano, T5 e T6). Sinal rapido: 181/181 em 17 suites (T8).
Verify completo: 612 testes, 607 verdes, 4 pulados e 1 vermelho, o
fingerprint de integridade-release.test.mjs:165, ja vermelho na base
b4d82fc; .test-dist 55/55, test:dist 1/1 e verify:build ok (T9).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$email = git log origin/main --author='Weriton-DataOps' -1 --format='%ae'
if (-not $email) { throw 'sem commit da Weriton-DataOps no origin/main' }
$identidade = @('-c', 'user.name=Weriton-DataOps', '-c', "user.email=$email")
git add runtime/memoria.mjs testes/memoria-casa.test.mjs docs/superpowers/plans/2026-11-04-f1-casa-sqlite.md
git diff --cached --stat
git @identidade commit -F "$rascunho\commit2.txt"
git log -1 --format='%h | autor %an | committer %cn'
git status --short
```

Esperado: três arquivos no `--stat`, e autor e committer `Weriton-DataOps`. Depois do commit, nada da F1 fica pendente no `status`.

- [x] **Passo 5: push pela conta dona do repo.** O repositório é da `Weriton-DataOps`, e a troca de conta no `gh` vale para a máquina inteira. Por isso a volta fica no `finally`, no mesmo comando:

```powershell
gh auth switch --user Weriton-DataOps
try { git push -u origin casa-sqlite-f1 } finally { gh auth switch --user wp-grgroup }
gh auth status --active
git ls-remote origin refs/heads/casa-sqlite-f1
git rev-parse HEAD
```

Esperado: push aceito, `wp-grgroup` ativa de novo e o SHA remoto igual ao local.

Resultado (04/11): `c375b59` no `origin/casa-sqlite-f1`, igual ao local, e `wp-grgroup` ativa.

A primeira tentativa rodou dentro do sandbox do agente e falhou antes de chegar ao GitHub:
- o helper de credencial do `gh` é um comando de shell (`!…`), e o git o roda pelo `sh.exe` do MSYS;
- o `sh.exe` não sobe no sandbox (`add_item … failed, errno 1`), e o git então cai em `could not read Username`.

O push passou com esse único comando rodando fora do sandbox.

- [x] **Passo 6: CI**

```powershell
gh run list --branch casa-sqlite-f1 --limit 5
```

Esperado:
- "Linux / Node 22 / portable core" verde;
- "Windows / Node 22 / full verification" vermelho só no teste do fingerprint, o mesmo da base. Para confirmar, ler o log do job pela API (`gh api repos/Weriton-DataOps/Omni-Agent/actions/jobs/<id>/logs`), porque o `gh run view --log-failed` volta vazio.

Resultado (04/11), na run do push, em `c375b59`:
- "Linux / Node 22 / portable core" verde;
- "Windows / Node 22 / full verification" vermelho, com 612 testes: 607 verdes, 4 pulados e 1 vermelho, o "contrato canônico declara a versão e exatamente o fingerprint do payload". São os números do verify local (T9), lidos no log do job pela API.

O vermelho não nasceu no `main`: a última run dele, em `c8a4bec`, está verde nos dois jobs. A falha entra pelo outro pai do merge de base, o `3e710b4` (ramo `omni-agenda-e-correcoes`). Na CI desse ramo o Windows cai antes dos testes, em `contracts:check` ("Contrato gerado está desatualizado"). No merge esse portão passa, porque a suíte chegou às contagens, e sobra só o fingerprint, que o plano 8 regenera com a release.

Este plano não abre PR. O PR sai no plano 8, com a release.

---

## Autorrevisão contra o desenho

Os números entre parênteses são linhas do Apêndice A.

**§3.5, muitas sessões**
- Regra 1 (transação curta, síncrona, nunca aberta durante espera externa): a transação e o `comBanco` recusam trabalho assíncrono (4, 5).
- Regra 2 (`BEGIN IMMEDIATE`): teste dedicado (59) e prova isolada de 3/3 (T5).
- Regra 3 (em F1, a fila de uma pista é o `memory/memory.lock`): "sessoes em processos separados gravando juntas nao perdem registro e o arquivo fecha com o banco".

**§3.6, a memória no `omni.db`**
- Como guarda, por linha, com versão, lápide e ressurreição: 17 a 25.
- Reconciliação:
  - estados da projeção: 14;
  - atual sem reescrever: "memoria em dia carrega sem reescrever o arquivo";
  - sem-arquivo: 45;
  - defasada: 46 e 58;
  - externa: 33, 48, 49 a 51 e 57.
- `_projecoes` nunca é podada: coberto pelo comportamento ("a copia velha que volta nao reentra", "projecao velha que o proprio banco escreveu volta e o banco vence"). Não há mutante de poda, porque o código não poda.
- Arquivo ilegível: 27, 30 e 31. Plugin mais novo: 26, 28, 29 e 47.
- Gravação, banco antes do arquivo, com as falhas de cada ponta: 41 a 44, 52, 55 e 56; rollback: 6.
- Degradação sem trecho de conteúdo: 2, 31, 35 e 38; anotar nunca é a segunda falha: teste próprio.
- Sem SQLite: 11, 39 e 40. Só o aviso do sqlite é calado: 12.
- Onde mora o banco: 8 e 9.
- Abertura:
  - pragmas: 60, 61, 62 e 64;
  - insistência na virada para WAL: 1;
  - espera de ocupado: 63;
  - migração com hash: 7;
  - conexão que fecha: 3 e 4.
- Ingestão que falha: 34, 35 e 55. Migração da memória v1 com backup: 36, 53 e 54.
- Riscos aceitos 1 a 4: documentados no desenho, sem teste, porque são aceitos de propósito.

**§3.1, portabilidade:** uuid v7: 10. Diário: 13. Lápides: 18 e 19. Reordenação não vira tráfego: 17.

**§6, prova da F1:**
- "contagens batem": T6;
- "as sessões seguem lendo a memória": T6, passo 3 (regenerado = `memory.json` real byte a byte), mais as suítes de memória e contexto no T8;
- "todos os `.dpapi` abrem pelo cofre": plano 4.

---

## Apêndice A: mutantes

64 mutantes, 0 sobreviventes. A tabela foi gerada por script a partir da saída do executor. A coluna da direita traz o teste que ficou vermelho e a asserção que o derrubou.
- `equal` no código de saída: o filho do teste morreu, e a linha onde caiu aparece entre parênteses.
- As linhas 27, 37 e 42 trazem a mensagem crua de `assert.rejects`: a classe de erro errada, ou a função de validação que devolveu falso.
- As linhas 32 e 57 tiveram mortes por `ENOENT` ou `TypeError` em alguns testes, mas também morreram por asserção em outros.
- O gerador troca caminho local por reticência, para não levar pasta de usuário a documento público.

| # | Mutante | Arquivo | Teste que ficou vermelho — asserção |
|---|---|---|---|
| 1 | sem insistencia no WAL | `casa/banco.mjs` | processos que abrem o banco ao mesmo tempo aplicam cada migracao uma vez so — `equal` no código de saída (filho caiu em `banco.mjs:195`)<br>gravadores concorrentes em processos separados esperam a vez e nao perdem linha — `equal` no código de saída (filho caiu em `banco.mjs:195`) |
| 2 | degradacao vaza trecho do JSON | `casa/banco.mjs` | registro de degradacao guarda operacao e erro, nunca trecho de conteudo — `deepEqual` |
| 3 | abrirBanco nao fecha no erro | `casa/banco.mjs` | abrirBanco fecha a conexao quando a migracao falha — `doesNotThrow` |
| 4 | comBanco nao fecha | `casa/banco.mjs` | comBanco fecha a conexao sempre, inclusive quando o uso devolve promessa — `throws` sem exceção |
| 5 | transacao aceita promessa | `casa/banco.mjs` | transacao confirma, desfaz no erro e recusa trabalho assincrono — `throws` sem exceção |
| 6 | transacao nao desfaz | `casa/banco.mjs` | transacao confirma, desfaz no erro e recusa trabalho assincrono — `deepEqual` |
| 7 | migracao alterada passa | `casa/banco.mjs` | migracoes sao idempotentes e recusam migracao alterada depois de aplicada — `throws` sem exceção |
| 8 | casa de producao no Roaming | `casa/banco.mjs` | pasta do banco: variavel manda, casa de producao vai para o Local, as outras guardam dentro — `equal`<br>pasta do banco reconhece a casa de producao sem diferenciar maiusculas no Windows — `equal` |
| 9 | caminho com maiuscula diferente | `casa/banco.mjs` | pasta do banco reconhece a casa de producao sem diferenciar maiusculas no Windows — `equal` |
| 10 | uuid versao 4 | `casa/banco.mjs` | uuid v7 tem formato, carimbo de tempo e ordem — `match` |
| 11 | variavel de desligar ignorada | `casa/banco.mjs` | OMNI_CASA_SEM_SQLITE=1 desliga o banco com erro identificavel — `throws` sem exceção |
| 12 | cala aviso de qualquer modulo | `casa/banco.mjs` | so o aviso experimental do sqlite e calado — `equal` |
| 13 | diario anota toda mudanca | `casa/esquemas.mjs` | diario anota insercao, mudanca de versao e remocao; arrumacao de ordem nao vira trafego — `deepEqual` |
| 14 | projecao conhecida vira externa | `casa/projecao.mjs` | situacao da projecao cobre vazio, externa, sem-arquivo, atual e defasada — `equal` |
| 15 | projecao repetida troca papel | `casa/projecao.mjs` | registrar a mesma projecao de novo nao duplica nem troca o papel — `deepEqual` |
| 16 | lerSeExistir engole todo erro | `casa/projecao.mjs` | lerSeExistir devolve null so para arquivo ausente — `throws` sem exceção |
| 17 | reordenar sobe versao | `casa/loja-memoria.mjs` | mudanca de conteudo sobe a versao; mudanca so de ordem nao sobe e nao vai ao diario — `deepEqual` |
| 18 | lapide nao ressuscita | `casa/loja-memoria.mjs` | registro que sai vira lapide, volta ressuscitado e a lapide nao e reenterrada — `deepEqual` |
| 19 | lapide reenterrada | `casa/loja-memoria.mjs` | registro que sai vira lapide, volta ressuscitado e a lapide nao e reenterrada — `deepEqual` |
| 20 | ordem das chaves perdida | `casa/loja-memoria.mjs` | ida e volta devolve o mesmo texto byte a byte, inclusive a ordem das chaves — `equal` |
| 21 | id repetido sobrescreve | `casa/loja-memoria.mjs` | id repetido e registro sem id nao se perdem e ganham identidade estavel — `equal` |
| 22 | arquivo morto sem snapshot | `casa/loja-memoria.mjs` | colunas de busca saem do registro e, no arquivo morto, do snapshot — `deepEqual` |
| 23 | leitura fora de ordem | `casa/loja-memoria.mjs` | ida e volta devolve o mesmo texto byte a byte, inclusive a ordem das chaves — `equal`<br>mudanca de conteudo sobe a versao; mudanca so de ordem nao sobe e nao vai ao diario — `deepEqual`<br>id repetido e registro sem id nao se perdem e ganham identidade estavel — `equal` |
| 24 | hash do texto nao gravado | `casa/loja-memoria.mjs` | ida e volta devolve o mesmo texto byte a byte, inclusive a ordem das chaves — `equal` |
| 25 | mudanca de raia ignorada | `casa/loja-memoria.mjs` | promover candidata muda a raia na mesma linha — `deepEqual` |
| 26 | M01 atual nao recusa arquivo que nao interpreta | `memoria.mjs` | memoria de plugin mais novo no banco (projecao em dia) e recusada sem reescrever projecao nem banco — `match` |
| 27 | M02 banco vazio com arquivo quebrado deixa o banco vencer | `memoria.mjs` | arquivo invalido sem memoria no banco continua sendo erro e nada e tocado — `The error is expected to be an instance of "SyntaxError". Re` |
| 28 | M03 versao futura no arquivo deixa o banco vencer | `memoria.mjs` | versao futura no arquivo com banco populado e recusada sem tocar arquivo nem banco — `rejects` sem rejeição |
| 29 | M04 banco vence sem validar a memoria dele | `memoria.mjs` | memoria de plugin mais novo no banco (sem arquivo) e recusada sem reescrever projecao nem banco — `match`<br>memoria de plugin mais novo no banco (arquivo quebrado) e recusada sem reescrever projecao nem banco — `match` |
| 30 | M05 arquivo quebrado nao fica guardado | `memoria.mjs` | arquivo invalido (JSON quebrado) com banco populado: o banco vence e o invalido fica guardado ao lado — `equal`<br>arquivo invalido (fora do contrato) com banco populado: o banco vence e o invalido fica guardado ao lado — `equal` |
| 31 | M06 arquivo quebrado nao anota degradacao | `memoria.mjs` | arquivo invalido (JSON quebrado) com banco populado: o banco vence e o invalido fica guardado ao lado — `deepEqual`<br>arquivo invalido (fora do contrato) com banco populado: o banco vence e o invalido fica guardado ao lado — `deepEqual` |
| 32 | M07 banco vence sem reescrever a projecao | `memoria.mjs` | arquivo editado fora do formato canonico e ingerido e reescrito; a copia velha que volta nao reentra — `equal`<br>projecao velha que o proprio banco escreveu volta e o banco vence — `equal`<br>arquivo apagado volta do banco byte a byte — `Error: ENOENT: no such file or directory, open …`<br>arquivo invalido (JSON quebrado) com banco populado: o banco vence e o invalido fica guardado ao lado — `equal`<br>arquivo invalido (fora do contrato) com banco populado: o banco vence e o invalido fica guardado ao lado — `equal`<br>projecao que nao sai nao perde a gravacao: o banco guarda e a carga seguinte reescreve o arquivo — `equal` |
| 33 | M08 ingestao nao reescreve texto fora do canonico | `memoria.mjs` | arquivo editado fora do formato canonico e ingerido e reescrito; a copia velha que volta nao reentra — `equal` |
| 34 | M09 ingestao que falha derruba a carga | `memoria.mjs` | ingestao que falha carrega do arquivo, anota a degradacao e tenta de novo na carga seguinte — `doesNotReject` |
| 35 | M10 ingestao que falha nao anota | `memoria.mjs` | ingestao que falha carrega do arquivo, anota a degradacao e tenta de novo na carga seguinte — `deepEqual` |
| 36 | M11 migracao ingerida sem backup | `memoria.mjs` | memoria v1 migra com banco: um backup so, banco com a versao migrada e importacao registrada — `equal` |
| 37 | M12 banco fora do ar derruba a carga | `memoria.mjs` | banco quebrado nao derruba a memoria: grava no arquivo, anota a degradacao e o banco consertado ingere — `doesNotReject`<br>sem banco e sem projecao a gravacao falha para quem chamou — `The validation function is expected to return "true". Receiv` |
| 38 | M13 carga degradada nao anota | `memoria.mjs` | banco quebrado nao derruba a memoria: grava no arquivo, anota a degradacao e o banco consertado ingere — `deepEqual`<br>sem banco e sem projecao a gravacao falha para quem chamou — `deepEqual` |
| 39 | M14 carga sem sqlite tenta o banco | `memoria.mjs` | com OMNI_CASA_SEM_SQLITE=1 a memoria volta ao arquivo puro e o banco ingere quando volta — `rejects` sem rejeição |
| 40 | M15 gravacao sem sqlite tenta o banco | `memoria.mjs` | com OMNI_CASA_SEM_SQLITE=1 a memoria volta ao arquivo puro e o banco ingere quando volta — `rejects` sem rejeição |
| 41 | M16 gravacao nao vai ao banco | `memoria.mjs` | gravar leva a memoria ao banco e o arquivo vira projecao exata da versao do banco — `equal`<br>escrita de versao antiga do plugin direto no arquivo e ingerida e sobrevive a gravacao seguinte — `deepEqual`<br>arquivo editado fora do formato canonico e ingerido e reescrito; a copia velha que volta nao reentra — `deepEqual`<br>projecao velha que o proprio banco escreveu volta e o banco vence — `deepEqual`<br>arquivo apagado volta do banco byte a byte — `equal`<br>arquivo invalido (JSON quebrado) com banco populado: o banco vence e o invalido fica guardado ao lado — `equal`<br>arquivo invalido (fora do contrato) com banco populado: o banco vence e o invalido fica guardado ao lado — `equal`<br>banco quebrado nao derruba a memoria: grava no arquivo, anota a degradacao e o banco consertado ingere — `deepEqual`<br>memoria v1 migra com banco: um backup so, banco com a versao migrada e importacao registrada — `equal`<br>sessoes em processos separados gravando juntas nao perdem registro e o arquivo fecha com o banco — `equal`<br>ingestao que falha carrega do arquivo, anota a degradacao e tenta de novo na carga seguinte — `equal`<br>gravacao que falha no meio desfaz o banco inteiro e o arquivo leva a versao ate o banco voltar — `deepEqual`<br>projecao que nao sai nao perde a gravacao: o banco guarda e a carga seguinte reescreve o arquivo — `equal`<br>sem banco e sem projecao a gravacao falha para quem chamou — `rejects` sem rejeição |
| 42 | M17 gravacao com banco quebrado derruba | `memoria.mjs` | banco quebrado nao derruba a memoria: grava no arquivo, anota a degradacao e o banco consertado ingere — `doesNotReject`<br>gravacao que falha no meio desfaz o banco inteiro e o arquivo leva a versao ate o banco voltar — `doesNotReject`<br>sem banco e sem projecao a gravacao falha para quem chamou — `The validation function is expected to return "true". Receiv` |
| 43 | M18 projecao que falha derruba a gravacao | `memoria.mjs` | projecao que nao sai nao perde a gravacao: o banco guarda e a carga seguinte reescreve o arquivo — `doesNotReject` |
| 44 | M19 nenhum guardou e ninguem fica sabendo | `memoria.mjs` | sem banco e sem projecao a gravacao falha para quem chamou — `rejects` sem rejeição |
| 45 | M20 sem-arquivo nao le o banco | `memoria.mjs` | arquivo apagado volta do banco byte a byte — `doesNotReject`<br>memoria de plugin mais novo no banco (sem arquivo) e recusada sem reescrever projecao nem banco — `match` |
| 46 | M21 defasada nao le o banco | `memoria.mjs` | arquivo editado fora do formato canonico e ingerido e reescrito; a copia velha que volta nao reentra — `doesNotReject`<br>projecao velha que o proprio banco escreveu volta e o banco vence — `doesNotReject`<br>projecao que nao sai nao perde a gravacao: o banco guarda e a carga seguinte reescreve o arquivo — `doesNotReject` |
| 47 | M22 versao futura nunca reconhecida | `memoria.mjs` | versao futura no arquivo com banco populado e recusada sem tocar arquivo nem banco — `rejects` sem rejeição |
| 48 | M23 ingestao registra o canonico como origem | `memoria.mjs` | arquivo editado fora do formato canonico e ingerido e reescrito; a copia velha que volta nao reentra — `equal`<br>memoria v1 migra com banco: um backup so, banco com a versao migrada e importacao registrada — `equal` |
| 49 | L01 ingerida registrada depois da escrita | `casa/loja-memoria.mjs` | escrita de versao antiga do plugin direto no arquivo e ingerida e sobrevive a gravacao seguinte — `equal` |
| 50 | L02 origem ingerida nao fica conhecida | `casa/loja-memoria.mjs` | escrita de versao antiga do plugin direto no arquivo e ingerida e sobrevive a gravacao seguinte — `equal`<br>arquivo editado fora do formato canonico e ingerido e reescrito; a copia velha que volta nao reentra — `equal`<br>memoria v1 migra com banco: um backup so, banco com a versao migrada e importacao registrada — `equal` |
| 51 | L03 canonico da ingestao nao fica conhecido | `casa/loja-memoria.mjs` | arquivo editado fora do formato canonico e ingerido e reescrito; a copia velha que volta nao reentra — `equal` |
| 52 | L04 salvar nao registra a escrita | `casa/loja-memoria.mjs` | gravar leva a memoria ao banco e o arquivo vira projecao exata da versao do banco — `equal`<br>projecao velha que o proprio banco escreveu volta e o banco vence — `deepEqual`<br>gravacao que falha no meio desfaz o banco inteiro e o arquivo leva a versao ate o banco voltar — `gravação desfeita por inteiro`<br>projecao que nao sai nao perde a gravacao: o banco guarda e a carga seguinte reescreve o arquivo — `deepEqual` |
| 53 | L05 importacao com o hash errado | `casa/loja-memoria.mjs` | memoria v1 migra com banco: um backup so, banco com a versao migrada e importacao registrada — `equal` |
| 54 | L06 contagens sem as raias | `casa/loja-memoria.mjs` | escrita de versao antiga do plugin direto no arquivo e ingerida e sobrevive a gravacao seguinte — `equal`<br>memoria v1 migra com banco: um backup so, banco com a versao migrada e importacao registrada — `equal` |
| 55 | L07 ingestao fora de transacao | `casa/loja-memoria.mjs` | ingestao que falha carrega do arquivo, anota a degradacao e tenta de novo na carga seguinte — `ingestão desfeita por inteiro` |
| 56 | L08 salvar fora de transacao | `casa/loja-memoria.mjs` | gravacao que falha no meio desfaz o banco inteiro e o arquivo leva a versao ate o banco voltar — `gravação desfeita por inteiro` |
| 57 | L09 ingestao sem registro de importacao | `casa/loja-memoria.mjs` | escrita de versao antiga do plugin direto no arquivo e ingerida e sobrevive a gravacao seguinte — `TypeError: Cannot read properties of undefined (reading 'tip`<br>arquivo editado fora do formato canonico e ingerido e reescrito; a copia velha que volta nao reentra — `equal`<br>com OMNI_CASA_SEM_SQLITE=1 a memoria volta ao arquivo puro e o banco ingere quando volta — `equal`<br>banco quebrado nao derruba a memoria: grava no arquivo, anota a degradacao e o banco consertado ingere — `equal`<br>memoria v1 migra com banco: um backup so, banco com a versao migrada e importacao registrada — `TypeError: Cannot read properties of undefined (reading 'fon`<br>ingestao que falha carrega do arquivo, anota a degradacao e tenta de novo na carga seguinte — `ingestão desfeita por inteiro` |
| 58 | M24 projecao defasada vira ingestao | `memoria.mjs` | arquivo editado fora do formato canonico e ingerido e reescrito; a copia velha que volta nao reentra — `deepEqual`<br>projecao velha que o proprio banco escreveu volta e o banco vence — `deepEqual`<br>projecao que nao sai nao perde a gravacao: o banco guarda e a carga seguinte reescreve o arquivo — `deepEqual` |
| 59 | transacao sem IMMEDIATE | `casa/banco.mjs` | transacao que le e depois grava espera a vez em vez de devolver ocupado — `equal` no código de saída (filho caiu em `[eval1]:9`) |
| 60 | synchronous FULL | `casa/banco.mjs` | pragmas da casa valem em toda conexao — `equal` |
| 61 | foreign_keys desligado | `casa/banco.mjs` | pragmas da casa valem em toda conexao — `equal` |
| 62 | busy_timeout zero na conexao | `casa/banco.mjs` | pragmas da casa valem em toda conexao — `equal`<br>gravadores concorrentes em processos separados esperam a vez e nao perdem linha — `equal` no código de saída (filho caiu em `banco.mjs:114`)<br>transacao que le e depois grava espera a vez em vez de devolver ocupado — `equal` no código de saída (filho caiu em `banco.mjs:114`) |
| 63 | espera de ocupado zerada | `casa/banco.mjs` | processos que abrem o banco ao mesmo tempo aplicam cada migracao uma vez so — `equal` no código de saída (filho caiu em `banco.mjs:195`)<br>gravadores concorrentes em processos separados esperam a vez e nao perdem linha — `equal` no código de saída (filho caiu em `banco.mjs:195`)<br>transacao que le e depois grava espera a vez em vez de devolver ocupado — `equal` no código de saída (filho caiu em `banco.mjs:114`) |
| 64 | journal DELETE em vez de WAL | `casa/banco.mjs` | pragmas da casa valem em toda conexao — `equal` |

## Apêndice B: script da prova com a memória real (T6)

Uso: `node prova-memoria-real.mjs <raiz-do-repo>`, com o arquivo fora do repositório. Ele só lê o `%APPDATA%\omni\memory\memory.json` real. Todo o resto acontece numa cópia descartável.

```js
// Prova de F1 com a memória real, numa cópia descartável. Nunca escreve em %APPDATA%\omni: copia
// memory.json para uma casa temporária e mede ingestão, carga em dia, regeneração e gravação.
// Imprime só contagens, hashes e tempos; nenhum texto de memória.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'

const raiz = pathToFileURL(join(resolve(process.argv[2] ?? '.'), 'runtime') + sep).href
const memoria = await import(`${raiz}memoria.mjs`)
const banco = await import(`${raiz}casa/banco.mjs`)
const loja = await import(`${raiz}casa/loja-memoria.mjs`)

delete process.env.OMNI_CASA_BANCO
delete process.env.OMNI_CASA_SEM_SQLITE

const casaReal = join(process.env.APPDATA, 'omni')
const real = join(casaReal, 'memory', 'memory.json')
const casa = mkdtempSync(join(tmpdir(), 'omni-prova-real-'))
if (casa.toLowerCase().startsWith(casaReal.toLowerCase())) throw new Error('casa da prova caiu dentro da casa real')
const arquivo = memoria.caminhoDaMemoria(casa)
mkdirSync(join(casa, 'memory'), { recursive: true })
copyFileSync(real, arquivo)
const original = readFileSync(arquivo, 'utf8')
const shaOriginal = banco.sha256(original)
const contagemOriginal = Object.fromEntries(loja.RAIAS.map((raia) => [raia, JSON.parse(original)[raia]?.length ?? 0]))

async function medir(rotulo, executar) {
  const inicio = performance.now()
  const resultado = await executar()
  console.log(`${rotulo.padEnd(44)} ${(performance.now() - inicio).toFixed(0).padStart(6)} ms`)
  return resultado
}
const noBanco = () => banco.comBancoDaCasa(casa, 'omni', (db) => ({
  sha: loja.shaDaMemoriaNoBanco(db),
  texto: loja.textoDaMemoria(loja.lerMemoriaDoBanco(db)),
  contagens: loja.contarMemoriaNoBanco(db),
  importacoes: db.prepare('SELECT COUNT(*) AS n FROM _importacoes').get().n,
  diario: Object.fromEntries(db.prepare('SELECT operacao, COUNT(*) AS n FROM _diario GROUP BY operacao').all().map((l) => [l.operacao, l.n])),
  integridade: db.prepare('PRAGMA integrity_check').get().integrity_check
}))
const confere = (condicao, texto) => {
  console.log(`${condicao ? 'ok   ' : 'FALHA'} ${texto}`)
  if (!condicao) process.exitCode = 1
}
const shaDoArquivo = () => banco.sha256(readFileSync(arquivo, 'utf8'))

try {
  console.log(`node ${process.versions.node}; original ${JSON.stringify(contagemOriginal)}, ${Buffer.byteLength(original)} bytes`)

  const p1 = await medir('1. primeira carga (ingestão)', () => memoria.prepararMemoria(casa))
  const b1 = noBanco()
  console.log(`   manutenção rodou: ${p1.maintenance.ran}; banco ${JSON.stringify(b1.contagens)}; diário ${JSON.stringify(b1.diario)}`)
  confere(b1.importacoes === 1, 'uma importação registrada')
  confere(b1.texto === loja.textoDaMemoria(p1.memory), 'banco remonta exatamente a memória carregada')
  confere(shaDoArquivo() === b1.sha, 'arquivo é a projeção da versão corrente do banco')
  if (!p1.maintenance.ran) {
    confere(b1.sha === shaOriginal, 'sem manutenção: banco guarda o texto original byte a byte')
    confere(JSON.stringify(b1.contagens) === JSON.stringify(contagemOriginal), 'contagens do banco = contagens do arquivo real')
  }

  const mtime = statSync(arquivo).mtimeMs
  const p2 = await medir('2. segunda carga (em dia)', () => memoria.prepararMemoria(casa))
  confere(!p2.maintenance.ran && statSync(arquivo).mtimeMs === mtime, 'carga em dia não reescreve o arquivo')
  confere(noBanco().importacoes === 1, 'carga em dia não reingere')

  const antes = noBanco().sha
  unlinkSync(arquivo)
  await medir('3. arquivo apagado (regeneração)', () => memoria.prepararMemoria(casa))
  confere(shaDoArquivo() === antes, 'arquivo regenerado byte a byte da versão do banco')
  if (!p1.maintenance.ran) confere(shaDoArquivo() === shaOriginal, 'regenerado = memory.json real, byte a byte')

  await medir('4. gravação (lembrarExplicitamente)', () => memoria.lembrarExplicitamente(casa, 'Prova F1: registro gravado só na cópia descartável.'))
  const b4 = noBanco()
  confere(b4.contagens.confirmed === b1.contagens.confirmed + 1, `confirmadas ${b1.contagens.confirmed} -> ${b4.contagens.confirmed}`)
  confere(shaDoArquivo() === b4.sha, 'depois da gravação, arquivo = banco')
  confere(b4.integridade === 'ok', `integrity_check: ${b4.integridade}`)

  process.env.OMNI_CASA_SEM_SQLITE = '1'
  await medir('5. base: carga só do arquivo (sem banco)', () => memoria.prepararMemoria(casa))
  delete process.env.OMNI_CASA_SEM_SQLITE

  const pasta = banco.pastaDoBanco(casa)
  const tamanho = (nome) => { try { return statSync(join(pasta, nome)).size } catch { return 0 } }
  console.log(`   omni.db ${tamanho('omni.db')} bytes + wal ${tamanho('omni.db-wal')}; degradações: ${tamanho('degradacoes.jsonl')} bytes`)
} finally {
  rmSync(casa, { recursive: true, force: true })
}
```
