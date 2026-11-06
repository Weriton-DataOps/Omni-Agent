# F1, plano 3: estados de aprendizado e feedback no `omni.db` — plano de implementação

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** os oito estados JSON de aprendizado e feedback da casa (`learning/*.json` e `feedback/*.json`) passam a viver no `omni.db`. O banco vira a fonte e o arquivo vira a projeção dele, sem mudar o formato que os módulos e a loja TypeScript conhecem, sem dependência nova e sem derrubar nada quando falta o banco.

**Arquitetura:** a loja fica em `runtime/casa/loja-estados.mjs`. Cada estado vira um esqueleto (o documento com as coleções vazias) mais um registro por item de coleção, com id natural e ordem pela regra da cauda; a recomposição volta byte a byte e é conferida por hash. A ponte fica em `runtime/estados.mjs`: `carregarTextoDoEstado` e `gravarTextoDoEstado` substituem o `readFile`/`rename` dos seis módulos JS e decidem por três hashes (disco, banco vivo e a base desta máquina). Leitura do arquivo, decisão, cópia, projeção e base acontecem dentro do mesmo `BEGIN IMMEDIATE`, sob a trava que cada módulo já segura. `reconciliarEstados`, no fim da varredura diária, importa os estados que ainda não têm linha e espelha os dois da loja TypeScript sob a trava dela. A migração v3 cria `estados`, `estado_registros` e `_estados_no_disco`.

**Tecnologia:** `node:sqlite`, Node ≥ 22.13 (o CI usa 22; a máquina do Weriton, 24), `node:test` e o lock de arquivo que já existe em `dist/`. Nenhuma dependência npm nova.

**Desenho:** [Casa única: Omni, Overcore e Oráculo](../specs/2026-11-04-casa-unica-tres-agentes-design.md): §4.2 (migração inicial de `learning/` e `feedback/`), §3.1 (portabilidade), §3.5 (muitas sessões), §3.6 (o molde: a memória no `omni.db`), §3.8 (estados JSON como projeção, escrito por este plano) e §6 (fases e provas).

**Situação em 05/11/2026:** entregue. T1 a T11 feitas e publicadas no `origin/casa-sqlite-f1`: `673e2bb` (módulos, suítes, o §3.8 do desenho e os planos), commit de 05/11. O PR sai no plano 8.

---

## Posição na F1

Este é o plano 3 dos oito da F1 ([escopo no plano 1](2026-11-04-f1-casa-sqlite.md#escopo-a-f1-em-oito-planos)). Os planos 1 e 2 puseram no `omni.db` a memória do Omni e os `.md` da memória do Claude Code. Este põe o resto da migração inicial do §4.2: os estados de `learning/` e `feedback/`. O "importador" que o escopo promete é a primeira carga de cada estado; a varredura diária importa o que nenhum módulo carregou.

## Mapa de arquivos

| Arquivo | Responsabilidade | Importa |
|---|---|---|
| `runtime/casa/esquemas.mjs` (modificado) | Migração v3 do `omni`: `estados`, `estado_registros` e `_estados_no_disco` | nada |
| `runtime/casa/loja-estados.mjs` (novo) | Catálogo dos oito estados; decomposição (`decompor`, `linhasDe`, `planejarOrdem`); leitura (`shaDoEstado`, `baseNoDisco`, `recomporEstado`, `contarEstado`); escrita (`escreverEstado`, `gravarEstado`, `importarEstado`, `confirmarEstadoNoDisco`, `registrarImportacaoDeEstado`); `docCanonico` | `banco.mjs` |
| `runtime/estados.mjs` (novo) | A ponte: `carregarTextoDoEstado`, `gravarTextoDoEstado`, `reconciliarEstados`, `avaliarTexto` e `avaliarEstrutura` | `casa/banco.mjs`, `casa/loja-estados.mjs`, `casa/projecao.mjs` e o lock de `dist` |
| `runtime/falhas.mjs` (modificado) | `load` e `save` pela ponte | `estados.mjs` |
| `runtime/automacao-falhas.mjs` (modificado) | `load` e `save` pela ponte; `lerAutomacaoFalhas` segue no arquivo | `estados.mjs` |
| `runtime/autoaperfeicoamento.mjs` (modificado) | `carregar` e `gravar` pela ponte | `estados.mjs` |
| `runtime/atalhos.mjs` (modificado) | `carregar` e `gravar` pela ponte; o backup de migração de esquema continua | `estados.mjs` |
| `runtime/recibos-evolucao.mjs` (modificado) | Trava nova (`learning/evolution-receipts.lock`); carga e escrita pela ponte sob ela; os leitores seguem no arquivo | `estados.mjs` |
| `runtime/feedback-personalidade.mjs` (modificado) | Carga sob a trava e escrita pela ponte; os leitores seguem no arquivo | `estados.mjs` |
| `runtime/varredura-diaria.mjs` (modificado) | Gatilho: `reconciliarEstados` depois dos documentos; falha vira degradação | `estados.mjs` |
| `package.json` (modificado) | `node --check` dos dois módulos novos e do `recibos-evolucao` no `npm run check` (T6) | — |
| `testes/casa-banco.test.mjs` (modificado) | Tabelas com a v3 e a subida v2 → v3 (T1) | — |
| `testes/casa-loja-estados.test.mjs` (novo) | 16 testes da loja (T2) | — |
| `testes/estados.test.mjs` (novo) | 23 testes da ponte (T3) | — |
| `testes/estados-modulos.test.mjs` (novo) | Os seis módulos pela ponte e a trava dos recibos (T4) | — |
| `testes/feedback-personalidade.test.mjs` (modificado) | A casa ganha a pasta `casa` quando há SQLite (T4) | — |
| `testes/varredura-diaria.test.mjs` (modificado) | 3 testes do gatilho (T5) | — |

Nenhum módulo novo importa `runtime/memoria.mjs` ou pacote npm, e nenhum arquivo de `dist/` muda.

Siglas usadas neste plano: CB = `testes/casa-banco.test.mjs`, CE = `testes/casa-loja-estados.test.mjs`, ES = `testes/estados.test.mjs`, EM = `testes/estados-modulos.test.mjs`, FP = `testes/feedback-personalidade.test.mjs` e VD = `testes/varredura-diaria.test.mjs`. Nos arquivos que já existem, o número que segue a sigla é a linha do teste; nos três novos, é a posição do teste na lista da tarefa (ES 14 é o 14º teste do ES).

## Migração v3 e congelamento

A v2 do `omni.db` ainda não congelou ([regra no plano 1](2026-11-04-f1-casa-sqlite.md#regra-de-congelamento-das-migrações)), mas está publicada no `origin/casa-sqlite-f1` desde o `3f4d1f4`, e qualquer checkout desse ramo pode ter criado um `omni.db` v2. Por isso as tabelas novas entram como v3, e o teste novo do CB prova a subida de v2 para v3.

`estados` e `estado_registros` são dado vivo: têm as colunas de sincronização do §3.1, diário e lápide. `_estados_no_disco` é interna e não tem diário, como a `_documentos_no_disco`: guarda estado local de cada máquina, não dado a sincronizar. O próximo plano que mexer no esquema do `omni.db` entra como v4.

## O que o executor precisa saber antes de rodar qualquer coisa

1. **Casa real intocável.** Os testes usam casa temporária (`mkdtemp`). Como ela não é `%APPDATA%\omni`, o banco fica em `<casa>\casa\omni.db` (`pastaDoBanco`, `runtime/casa/banco.mjs:79`). Nenhum teste lê ou toca a casa real; a prova (T8) trabalha numa cópia dos oito arquivos, apagada no fim.
2. **Guarda.** `Test-Path "$env:LOCALAPPDATA\omni\casa"` dá `False` antes e depois de cada rodada (T6 a T10).
3. **Transação não reentrante.** `transacao` (`runtime/casa/banco.mjs:114`) abre `BEGIN IMMEDIATE` e não aceita outra dentro. Por isso `escreverEstado`, `importarEstado` e `confirmarEstadoNoDisco` não abrem transação: quem chama segura a dele. `gravarEstado` abre a sua e serve aos testes da loja; a ponte usa `escreverEstado` dentro da própria transação, nunca `gravarEstado`.
4. **Gatilhos em produção.** Os seis módulos passam pela ponte em toda carga e escrita, então cada estado entra no banco na primeira vez que o módulo carrega com o código novo. A varredura roda no SessionStart e no Stop, assíncrona, com limite de 900 s (`hooks/hooks.json:23-25` e `:152-154`), e só passa do not-due uma vez a cada 60 min (`contratos/aprendizado/varredura-diaria.json:4`; `runtime/varredura-diaria.mjs:811-814`). Ela importa o que nenhum módulo carregou e espelha as duas lojas TypeScript. Nada disso vale em produção antes do plano 8, porque o plugin instalado roda do cache.
5. **Cópia `.antes-da-casa`.** A primeira importação de cada estado guarda, ao lado do arquivo, os bytes originais em `<arquivo>.antes-da-casa.<carimbo>`, criado com `wx`. Na casa real isso soma uns 6 MB (o `failures.json` sozinho tem 4,5 MB). Nada apaga essas cópias; o diagnóstico do plano 7 pode listá-las.
6. **Vermelho de nascença `:165`.** É o do plano 1 (item 3 de lá) e do plano 2 (item 4). Arquivo novo em `runtime/` muda o fingerprint do payload. A T10 anota o valor calculado, e o plano 8 regenera o contrato.
7. **Empacotamento.** `estados.mjs` importa `dist/adapters/local-json/node-local-file-lock.js`, como o `documentos-md.mjs` do plano 2 (item 5 de lá). As três entradas novas do `node --check` (T6) apontam para arquivos do payload, que o `verificarCoberturaEntrypoints` (`runtime/integridade-release.mjs:152`) confere.
8. **Grafo de import.** Todo importador dos seis módulos passa a carregar `estados.mjs`, a loja e o lock:

   | Módulo | Importado por |
   |---|---|
   | `recibos-evolucao` | autoaperfeicoamento, cli, evolucao, executor-eval-personalidade, hook-contexto, pipeline-memoria |
   | `feedback-personalidade` | cli, executor-eval-personalidade, hook-contexto, observador |
   | `autoaperfeicoamento` | atualizacao, auditoria-sistema, cli |
   | `automacao-falhas` | adaptador-claude-delegacao, auditoria-sistema, cli, diagnostico, hook-contexto, hook-reconciliacao |
   | `falhas` | auditoria-sistema, autoaperfeicoamento, automacao-falhas, cli, observador, varredura-diaria |
   | `atalhos` | autoaperfeicoamento, cli, contexto, varredura-diaria |

   Por isso a T9 não escolhe suíte à mão: o `afetadas-p3.mjs` segue o grafo a partir dos dez arquivos de `runtime/` que este plano muda e acha as suítes diretas e as indiretas, como atualizacao, evolucao, adaptador-claude-delegacao, hook-reconciliacao e pipeline-memoria.
9. **`dist` com fim de linha fantasma:** item 7 do plano 2.
10. **O typecheck não enxerga `runtime/`:** item 8 do plano 2. Aqui quem garante são o `node --check` (T6) e os testes.
11. **Node 22:** item 9 do plano 2. A prova (T8) roda nos dois Nodes.
12. **Shell:** item 10 do plano 2. `$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'`, recriado na preparação.
13. **Fim de linha.** Esta máquina tem `core.autocrlf=true`, mas runtime, testes, planos e `package.json` são LF no repositório. Arquivo novo é escrito com LF (o extrator grava LF), e antes do commit nenhum arquivo deste plano pode ter CR (T11).
14. **O código mora no plano.** Cada bloco que vai inteiro para o repositório abre com `arquivo=<caminho>`; cada script de apoio, com `rascunho=<nome>`. O extrator (seção "Ferramentas") grava os blocos no destino, e `--conferir` prova no fim que o repositório e o plano dizem a mesma coisa. Edição pontual em arquivo existente aparece como trecho de antes e depois, e é feita à mão.
15. **Teste de projeção que falha só no Windows.** O ES 18 deixa o arquivo somente leitura (`chmodSync` 0o444) para o `rename` falhar, o que só acontece no Windows; nos outros sistemas ele pula. Leva uns 2 s, porque o `escreverAtomico` tenta de novo o `rename` por 2 s antes de desistir.
16. **Erros de sistema de arquivos no Windows** (sondados): arquivo no lugar de uma pasta do caminho dá `ENOENT`, que `lerSeExistir` trata como ausente; pasta no lugar do arquivo dá `EISDIR`, que propaga; `DatabaseSync` sobre uma pasta dá `ERR_SQLITE_ERROR: unable to open database file`. Os testes de banco quebrado usam uma pasta chamada `omni.db`.
17. **CI Linux:** item 12 do plano 2. A CI Linux não roda as suítes `.mjs`; quem roda CB, CE, ES, EM, FP, VD e as suítes dos módulos é o job Windows (`npm run verify`).
18. **Identidade:** item 11 do plano 2.

## Desenho dos estados

**Catálogo.** Oito estados, cada um com um dono que carrega e grava:

| Estado | Dono | Modo | Chave natural especial | Esquema |
|---|---|---|---|---|
| `learning/failures.json` | `falhas.mjs` | p2 | — | 6 |
| `learning/failure-automation.json` | `automacao-falhas.mjs` | p2 | — | 5 |
| `learning/self-improvement.json` | `autoaperfeicoamento.mjs` | p2 | — | 1 |
| `learning/shortcuts.json` | `atalhos.mjs` | p2 | — | 4 |
| `learning/evolution-receipts.json` | `recibos-evolucao.mjs` | p2 | — | 1 |
| `feedback/personality-feedback.json` | `feedback-personalidade.mjs` | p2 | `lastResponses` por `sessionFingerprint` | 1 |
| `feedback/personality-continuity.json` | loja TS do `dist` | espelho | `observations` por `fingerprint` | 1 |
| `feedback/personality-owner-directions.json` | loja TS do `dist` | espelho | `observations` por `fingerprint` | 1 |

"p2" quer dizer que o estado segue o molde do plano 2 (base por máquina) e que o dono passa pela ponte. "espelho" quer dizer que o dono é a loja TS, que este plano não muda; o banco a acompanha na varredura (desvio 3). Ficam fora `learning/daily-scan.json`, o estado da própria varredura que dispara a reconciliação, e `learning/live-coverage.json`, reescrito por inteiro (8 MB) várias vezes por hora. Fora de `learning/` e `feedback/`, `audits/self-correction.json` e `runs/operational-cycle.json` têm o mesmo padrão do live-coverage; os três pedem um plano próprio.

**Decomposição.** O documento vira um esqueleto: o objeto com cada coleção (valor de topo que é array) trocada por `[]` e, quando há `store.updatedAt` texto, esse campo trocado por `null`. O `store.updatedAt` vira o relógio da linha: é local de cada máquina, não sobe versão e não vai ao diário. Cada item de coleção vira uma linha de `estado_registros`, com id `<estado>|<coleção>|<chave>`. A chave é natural: o campo indicado no catálogo; senão `id`, quando é texto; senão o próprio item, quando é texto de até 200 caracteres; senão `h:` mais 32 hex do sha256 do item serializado. Chave repetida ganha `#1`, `#2`… até achar uma livre (`['x','x','x#1']` vira `x`, `x#1`, `x#1#1`), então a chave é única dentro da coleção. Nome de coleção com `|` é recusado.

**Ordem.** Regra da cauda (`planejarOrdem`): enquanto a ordem gravada dos itens cresce, cada um mantém a sua; da primeira quebra em diante, eles recebem maior+1, maior+2… Append no fim não mexe em ninguém; mover um item mexe nele e nos que vêm depois da quebra.

| Caso | Ordens gravadas (u = sem linha) | Ordens novas |
|---|---|---|
| append no fim | `[0,1,2,u]` | `[0,1,2,3]` |
| item movido para o fim | `[0,2,3,1]` | `[0,2,3,4]` |
| inserção no meio | `[0,u,1,2]` | `[0,3,4,5]` |
| remoção no início | `[1,2,3]` | `[1,2,3]` |
| importação | `[u,u,u]` | `[0,1,2]` |

**Recomposição.** `recomporEstado` remonta o documento (esqueleto, relógio e registros por coleção e ordem), serializa com `JSON.stringify(doc, null, 2)` mais `\n` e confere o sha256 contra `texto_sha256`; divergência lança. Isso só fecha porque os seis módulos e a loja TS escrevem exatamente essa forma canônica (conferido no `dist`). A escrita recusa texto fora dela (`docCanonico`), e a importação normaliza antes de gravar.

**Avaliação do texto do disco** (`avaliarTexto`, com a versão e o validador do dono):
- `quebrada`: não é JSON, não é objeto ou não tem `schemaVersion` inteiro;
- `futura`: `schemaVersion` maior que a do dono;
- `fora-do-contrato`: mesma versão, recusada pelo validador do dono;
- `ok`: mesma versão e válida, ou versão menor, que o próprio dono migra.

**Decisão, por estado.** B é a linha viva no banco; D, o arquivo no disco; a base é o sha256 da forma canônica que esta máquina confirmou por último em disco (`_estados_no_disco`).

| B | D | Decisão |
|---|---|---|
| nenhuma | ausente | `vazia`: devolve `null` |
| nenhuma | não ok | `intocada`: devolve o arquivo, nada entra no banco |
| nenhuma | ok | `importada`: forma canônica no banco, cópia `.antes-da-casa`, base confirmada; devolve o arquivo |
| presente | ausente | `projetada`: recompõe (lança se divergir), escreve o arquivo e confirma a base |
| presente | sha(D) = B | `atual`: confirma a base se ela era outra |
| presente | quebrado | `socorrida`: cópia `.invalida`, degradação e projeção; vira `intocada` se a recomposição não estiver ok ou se a cópia falhar |
| presente | canônico(D) = B | `atual` |
| presente | canônico(D) = base | `defasada`: projeta B |
| presente | futuro ou fora do contrato | `intocada` |
| presente | qualquer outro caso | `ingerida`: o disco vence, a forma canônica entra no banco e a base vira ela |

Demais regras:
- a decisão inteira acontece numa transação `BEGIN IMMEDIATE`, com o arquivo lido dentro dela (desvio 16);
- a F1 nunca põe lápide em estado: apagar o arquivo faz o banco projetá-lo de volta;
- sem SQLite (`OMNI_CASA_SEM_SQLITE=1` ou Node sem `node:sqlite`), a ponte lê e escreve só o arquivo, como antes deste plano;
- sem arquivo e sem `omni.db`, a carga devolve `null` sem criar banco;
- banco que não abre: a carga registra `estado.carregar` e devolve o arquivo, mas, sem arquivo, lança em vez de devolver `null` (desvio 11);
- a escrita (`gravarTextoDoEstado`) grava o estado, projeta e confirma a base na mesma transação. Falha da projeção registra `estado.projetar` e deixa o banco à frente, e a próxima carga projeta (`defasada`). Falha do banco, inclusive texto fora da forma canônica, registra `estado.gravar` e escreve o arquivo direto se ele ainda não foi escrito, e a próxima carga ingere;
- a varredura importa os estados p2 que não têm linha (`sem-arquivo`, `presente`, `importada`, `intocada` ou `degradada`) e roda a decisão inteira nos dois espelhos, sob a trava da loja TS; sem SQLite, sai `sem-banco`;
- degradações em `degradacoes.jsonl`: `estado.carregar`, `estado.gravar`, `estado.projetar`, `estado.copia`, `estado.arquivo-invalido`, `estado.espelho` e `estados.varredura`, sempre sem conteúdo de estado;
- `_importacoes` (tipo `estados`, fonte = o caminho relativo do estado, sha256 dos bytes originais, contagens por coleção) ganha uma linha na primeira importação de cada estado.

**Desvios do desenho**
1. **Base por máquina, não `_projecoes`.** O molde do §3.6 decide pela tabela `_projecoes`: texto que o banco projetou e que volta ao disco perde para o banco. Aqui a decisão usa a base por máquina, como os `.md` do plano 2. O motivo é um teste que já existe: `testes/autoaperfeicoamento.test.mjs` grava no disco, por fora do módulo, uma versão alterada do estado (por volta da linha 365) e depois restaura o texto anterior (por volta da 376). Com `_projecoes`, o texto restaurado seria reconhecido como projeção antiga e sobrescrito. Com a base, voltar o arquivo a um texto antigo é edição, e o disco vence. O relógio também não serve de juiz: é local e muda em toda escrita. A base não tem diário, porque só a `failure-automation` escreve umas 1.800 vezes por dia.
2. **`_importacoes` só na primeira importação.** As ingestões seguintes (o disco vence) não registram, pelo mesmo volume.
3. **Modo espelho para as lojas TS.** `personality-continuity` e `personality-owner-directions` são escritos pela loja do `dist` (`dist/adapters/local-json/personality-continuity-store.js`), e mudar o `dist` exige o build e o plano 8. O banco as espelha na varredura, sob a mesma trava de arquivo que a loja usa (`<arquivo>.lock`, com as opções padrão dela), e com as regras do validador dela: `schemaVersion` 1, exatamente as duas chaves, `observations` com até 100 itens. A loja continua lendo e gravando o arquivo; o banco projeta de volta se ele sumir ou quebrar.
4. **Cópia `.antes-da-casa`.** É a cópia datada do §4.2 ("os arquivos originais ficam congelados com cópia datada até a prova passar"), com uma diferença: o original não congela. Depois da importação o banco é a fonte e pode projetar por cima do arquivo, então os bytes de antes ficam guardados ao lado, e nada apaga a cópia (item 5 do executor).
5. **Versão futura e fora do contrato ficam intocadas.** Um arquivo escrito por uma versão mais nova do Omni, ou recusado pelo validador do dono, não entra no banco nem é sobrescrito: o dono recebe o texto como está e reage como sempre reagiu. `atalhos:192`, `falhas:575`, `autoaperfeicoamento:444` e `FP 382-383` semeiam versão futura e esperam o erro do módulo.
6. **A fonte volta sem reescrita.** Na importação e no `atual` pela forma canônica, o dono recebe o texto do disco como estava. O arquivo só é reescrito quando o banco projeta (`projetada`, `defasada`, `socorrida`) ou quando o dono grava.
7. **`defasada` sem cópia nem degradação.** O texto do arquivo é o que esta máquina já confirmou; não há o que guardar.
8. **Leitores puros seguem no arquivo.** `lerAutomacaoFalhas`, `lerFeedbackPersonalidade`, `resumirFeedbackPersonalidade`, `lerRecibos`, `recibosAtivos` e `resumoParaRadar` leem o arquivo sem trava e sem banco, como antes, e também as duas leituras da automação por fora do dono: `verificarJobNoHistorico`, nas falhas, e a foto de antes da `auditoria-sistema`. A projeção mantém o arquivo em dia, e passar leitura sem trava pelo `BEGIN IMMEDIATE` só serializaria os hooks.
9. **A varredura só importa os p2.** Para eles, `reconciliarEstados` importa quem não tem linha, conferindo só a estrutura (`avaliarEstrutura`: objeto JSON com `schemaVersion` inteiro), porque a varredura não conhece o validador de cada dono. Ingestão e projeção ficam para a próxima carga do dono, sob a trava dele.
10. **Mudar a ordem sobe versão.** O §3.1 diz que arrumação local não vira tráfego. Aqui a ordem é parte do documento (o corte de 100 recibos e de 100 observações guarda os mais novos pela posição), então mexer nela sobe a versão do registro movido. A regra da cauda mantém o número de registros movidos no mínimo.
11. **Sem arquivo e sem banco, falha.** Devolver `null` faria o dono começar um estado vazio e gravá-lo por cima do que o banco guarda.
12. **`importarEstado` sem transação própria.** Quem chama segura o `BEGIN IMMEDIATE` (item 3 do executor), e a ida e volta é conferida dentro dela: se a recomposição divergir, a importação inteira desfaz.
13. **Sem cópia, sem socorro.** O socorro só reescreve um arquivo quebrado depois de guardar os bytes dele em `.invalida.<carimbo>`. Se a cópia falhar, o arquivo fica intocado e o dono recebe o texto quebrado, como antes deste plano.
14. **A trava do `dist` entra por import estático.** Todo importador de `estados.mjs` carrega o lock, mesmo quando não espelha nada. É o custo do plano 2, e um import dinâmico esconderia a dependência do `check-package`.
15. **Os recibos ganham trava.** `recibos-evolucao` lia, acrescentava e gravava sem trava, então duas sessões registrando ao mesmo tempo perdiam um recibo. A ponte exige que a carga e a escrita aconteçam sob a trava do dono, e os recibos ganham `learning/evolution-receipts.lock`, no molde da trava das falhas: `open` com `wx`, 40 tentativas a cada 50 ms e trava velha apagada depois de 10 s.
16. **Leitura, decisão, cópia, projeção e base no mesmo `BEGIN IMMEDIATE`.** O plano 2 projeta fora da transação, relendo o hash antes de cada arquivo. Aqui isso abriria duas corridas. A primeira é atualização perdida: o processo A lê o arquivo (X) e espera o banco enquanto B grava Y e confirma a base Y. Como o busy handler do SQLite dorme em degraus de até 100 ms, A pode acordar depois e, vendo X diferente do banco e da base, ingerir X por cima de Y. A segunda é base errada: uma projeção fora da transação pode deixar o arquivo com Y e a base com Z, e a próxima carga ingere Y por cima de Z. As travas dos donos já separam duas cargas do mesmo dono, mas são recuperadas como velhas depois de 10 s, e a varredura não as segura. Com o arquivo lido dentro da transação, quem decide vê o disco e o banco do mesmo instante. O custo é a trava de escrita do banco presa durante a leitura e a escrita do arquivo: uns 10 a 40 ms para os 4,5 MB do `failures.json`, e até 2 s quando o `rename` precisa de novas tentativas. Na escrita, a decomposição e a comparação dos registros também correm sob a trava, e a escrita inteira do `failures.json` levou uns 130 ms na prova com os estados reais (T8).
17. **Id natural, não UUID v7.** O §3.1 pede `id` UUID v7 em toda tabela de dado vivo. Aqui o id do estado é o caminho relativo (`learning/failures.json`) e o do registro é `<estado>|<coleção>|<chave>`. Duas máquinas que importam o mesmo estado chegam aos mesmos ids, e o changeset da F5 casa as linhas em vez de duplicá-las; com UUID v7, cada importação inventaria ids próprios para os mesmos itens. O plano 2 fez o mesmo com os documentos, e a autorrevisão de lá pôs o id natural na conta do §3.1 sem chamá-lo de desvio. A linha de `_importacoes` continua com UUID v7.

**Notas**
- `escreverAtomico` cria o arquivo com modo 0o600; no Linux, a permissão do estado passa a ser só do dono do processo.
- `texto_sha256` e o relógio são desta máquina; a F5 recalcula os dois ao aplicar mudanças de outra.
- Não há chave estrangeira entre `estado_registros` e `estados`: a F5 aplica as linhas em qualquer ordem. A `_estados_no_disco` tem, porque base sem estado é erro local.
- Os módulos continuam com as próprias travas, validadores e migrações de esquema; a ponte só troca de onde vem o texto e para onde ele vai.

**Medições (05/11/2026, cópia da casa real e sonda de 20 min de uso normal).** O protótipo fez ida e volta byte a byte nas dez lojas JSON de `learning/` e `feedback/`. Uma escrita que muda só o relógio acrescentou 0 linhas ao `_diario`, e cada escrita levou de 13 a 89 ms. Na sonda, 4 de 4 escritas seguidas da `failure-automation` mudaram só o `store.updatedAt`.

| Estado | Versões novas em 20 min | Maior tamanho |
|---|---|---|
| `learning/failures.json` | 0 | 4,5 MB |
| `learning/failure-automation.json` | 25 | 194 kB |
| `learning/self-improvement.json` | 0 | 1,16 MB |
| `learning/shortcuts.json` | 0 | 27 kB |
| `learning/evolution-receipts.json` | 0 | 40 kB |
| `feedback/personality-feedback.json` | 0 | 131 kB |
| `feedback/personality-continuity.json` | 0 | 198 B |
| `feedback/personality-owner-directions.json` | 0 | 406 B |
| fora: `learning/daily-scan.json` | 4 | 791 kB |
| fora: `learning/live-coverage.json` | 18 | 7,9 MB |
| fora: `audits/self-correction.json` | 30 | 5,5 MB |
| fora: `runs/operational-cycle.json` | 53 | 1,2 MB |

## Ferramentas

O extrator grava no repositório os blocos `arquivo=` e no `$rascunho` os blocos `rascunho=`. Ele não extrai a si mesmo antes de existir: na preparação ele é criado à mão, e o `--conferir` da T10 prova que a cópia é igual a este bloco.

````js rascunho=extrair-do-plano.mjs
// Extrai do plano os blocos marcados com arquivo=<caminho> (código do repo) ou rascunho=<nome>.
// Uso: node extrair-do-plano.mjs <plano.md> <raiz-do-repo> <rascunho> [--conferir] [--so <caminho>...]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, normalize } from 'node:path'
const [plano, raiz, rascunho, ...resto] = process.argv.slice(2)
if (!plano || !raiz || !rascunho) { console.error('uso: node extrair-do-plano.mjs <plano.md> <raiz-do-repo> <rascunho> [--conferir] [--so <caminho>...]'); process.exit(2) }
const conferir = resto.includes('--conferir')
const so = resto.includes('--so') ? resto.slice(resto.indexOf('--so') + 1).filter((a) => !a.startsWith('--')) : null
const texto = readFileSync(plano, 'utf8').replace(/\r\n/g, '\n')
const bloco = /^(`{3,})(\w+) (arquivo|rascunho)=(\S+)\n([\s\S]*?)^\1$/gm
let divergiu = false; let achados = 0
for (const [, , , tipo, alvo, corpo] of texto.matchAll(bloco)) {
  if (so && !so.includes(alvo)) continue
  achados += 1
  let destino
  if (tipo === 'arquivo') { if (isAbsolute(alvo) || normalize(alvo).split(/[\\/]/).includes('..')) throw new Error(`caminho fora da raiz: ${alvo}`); destino = join(raiz, alvo) }
  else { if (/[\\/]/.test(alvo)) throw new Error(`rascunho é só nome, sem pasta: ${alvo}`); destino = join(rascunho, alvo) }
  const conteudo = `${corpo.replace(/\n+$/, '')}\n`
  let atual = null
  try { atual = readFileSync(destino, 'utf8') } catch (erro) { if (erro.code !== 'ENOENT') throw erro }
  if (conferir) { const estado = atual === null ? 'AUSENTE' : atual === conteudo ? 'igual' : 'DIVERGE'; if (estado !== 'igual') divergiu = true; console.log(`${estado} ${alvo}`); continue }
  if (atual === conteudo) { console.log(`igual ${alvo}`); continue }
  mkdirSync(dirname(destino), { recursive: true }); writeFileSync(destino, conteudo); console.log(`gravado ${alvo}`)
}
if (so && achados !== so.length) { console.error(`--so pediu ${so.length}, o plano tem ${achados}`); process.exit(1) }
process.exit(divergiu ? 1 : 0)
````

## Tarefas

### Preparação

- [x] **Passo 1: rascunho, extrator e guarda.** Criar `$rascunho\extrair-do-plano.mjs` à mão, com o bloco da seção "Ferramentas", e conferir:

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
New-Item -ItemType Directory -Force $rascunho | Out-Null
$plano = 'docs\superpowers\plans\2026-11-05-f1-plano-3-estados-aprendizado-feedback.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --conferir --so extrair-do-plano.mjs
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `igual extrair-do-plano.mjs`, saída 0 e `False`.

Resultado (05/11): `igual extrair-do-plano.mjs`, saída 0 e `False`.

### Task 1: migração v3

**Arquivos:** modificar `runtime/casa/esquemas.mjs` (fim da v2) e o CB (linhas 282 e 305, mais um teste antes do CB 316). O CB 217 continua `[1, 2]`: aquele teste usa migrações próprias, não as do `omni`.

- [x] **Passo 1: testes vermelhos no CB.** No CB 282, a lista do `omni` ganha as três tabelas:

```js
    omni: ['_diario', '_documentos_no_disco', '_importacoes', '_migracoes', '_projecoes', 'documentos', 'memoria_meta', 'memorias', 'sqlite_sequence'],
```

vira

```js
    omni: ['_diario', '_documentos_no_disco', '_estados_no_disco', '_importacoes', '_migracoes', '_projecoes', 'documentos', 'estado_registros', 'estados', 'memoria_meta', 'memorias', 'sqlite_sequence'],
```

O CB 297 (subida v1 → v2) abre o banco com todas as migrações, então passa a esperar `[1, 2, 3]`. O trecho trocado tem duas linhas, porque a primeira sozinha também aparece no CB 217:

```js
      assert.deepEqual(db.prepare('SELECT versao FROM _migracoes ORDER BY versao').all().map((linha) => linha.versao), [1, 2])
      assert.equal(db.prepare('SELECT conteudo FROM documentos WHERE id = ?').get('claude-projects/p/memory/a.md').conteudo, 'a')
```

vira

```js
      assert.deepEqual(db.prepare('SELECT versao FROM _migracoes ORDER BY versao').all().map((linha) => linha.versao), [1, 2, 3])
      assert.equal(db.prepare('SELECT conteudo FROM documentos WHERE id = ?').get('claude-projects/p/memory/a.md').conteudo, 'a')
```

Teste novo, logo antes de `test('diario anota insercao, mudanca de versao e remocao; arrumacao de ordem nao vira trafego', () => {`:

```js
test('omni.db da v2 sobe para a v3 sem perder documento; estado e registro vao ao diario e a base exige estado', () => {
  const casa = casaTemporaria()
  try {
    comBanco(arquivoDoBanco(casa, 'omni'), [MIGRACOES_OMNI[0], MIGRACOES_OMNI[1]], (db) => {
      db.exec(`INSERT INTO documentos (id, formato, conteudo, sha256, bytes, origem_maquina, criado_em, atualizado_em)
        VALUES ('claude-projects/p/memory/a.md', 'md', 'a', 'sha-a', 1, 'pc', 't0', 't0')`)
    })
    comBancoDaCasa(casa, 'omni', (db) => {
      assert.deepEqual(db.prepare('SELECT versao FROM _migracoes ORDER BY versao').all().map((linha) => linha.versao), [1, 2, 3])
      assert.equal(db.prepare('SELECT conteudo FROM documentos WHERE id = ?').get('claude-projects/p/memory/a.md').conteudo, 'a')
      db.exec(`INSERT INTO estados (id, esqueleto, texto_sha256, relogio, origem_maquina, criado_em, atualizado_em)
        VALUES ('learning/shortcuts.json', '{}', 'sha-e', NULL, 'pc', 't0', 't0')`)
      db.exec(`INSERT INTO estado_registros (id, arquivo, colecao, ordem, sha256, corpo, origem_maquina, criado_em, atualizado_em)
        VALUES ('learning/shortcuts.json|shortcuts|s1', 'learning/shortcuts.json', 'shortcuts', 0, 'sha-r', '{}', 'pc', 't0', 't0')`)
      const inserir = db.prepare('INSERT INTO _estados_no_disco (maquina, id, sha256, em) VALUES (?, ?, ?, ?)')
      inserir.run('pc', 'learning/shortcuts.json', 'sha-e', 't1')
      assert.throws(() => inserir.run('pc', 'learning/nada.json', 'x', 't1'), /FOREIGN KEY/)
      const diario = db.prepare("SELECT tabela, linha, operacao FROM _diario WHERE tabela <> 'documentos' ORDER BY seq").all()
      assert.deepEqual(
        diario.map((linha) => `${linha.tabela}:${linha.linha}:${linha.operacao}`),
        ['estados:learning/shortcuts.json:I', 'estado_registros:learning/shortcuts.json|shortcuts|s1:I']
      )
    })
  } finally {
    apagar(casa)
  }
})
```

- [x] **Passo 2: ver o vermelho.**

```powershell
node --test --test-concurrency=1 --test-reporter=spec testes/casa-banco.test.mjs *> "$rascunho\t1-vermelho.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t1-vermelho.txt" -Pattern '(tests|pass|fail) \d+\s*$'
```

Esperado: saída 1 e três falhas pela asserção. No CB 278, a lista de tabelas; no CB 297 e no teste novo, `[1, 2]` contra `[1, 2, 3]`.

Resultado (05/11): igual ao esperado: 23 testes, 20 verdes e 3 vermelhos, o CB 278, o CB 297 e o teste novo (CB 316), em 7,7 s.

- [x] **Passo 3: a migração.** Em `runtime/casa/esquemas.mjs`, a v2 fecha a lista do `omni`. Trocar o trecho único

```js
  PRIMARY KEY (maquina, id)
);`
  }
]

export const MIGRACOES_COFRE = [
```

por

```js
  PRIMARY KEY (maquina, id)
);`
  },
  // v3 (plano 3 da F1): estados de aprendizado e feedback (learning/*.json, feedback/*.json).
  // estados guarda o documento sem as coleções (esqueleto), o hash do texto inteiro e o relógio
  // (store.updatedAt, local de cada máquina, não sobe versão); cada item de coleção vira uma linha
  // de estado_registros, para a F5 trafegar só o que mudou. Aqui a ordem é parte do documento e
  // sobe versão. Sem chave estrangeira entre as duas: a F5 aplica em qualquer ordem.
  // _estados_no_disco é a base por máquina (como _documentos_no_disco): interna, sem diário.
  {
    versao: 3,
    nome: 'estados de aprendizado e feedback',
    sql: `CREATE TABLE estados (
  id TEXT PRIMARY KEY,
  esqueleto TEXT NOT NULL,
  texto_sha256 TEXT NOT NULL,
  relogio TEXT,
  ${VIVO}
);
${gatilhosDeDiario('estados')}
CREATE TABLE estado_registros (
  id TEXT PRIMARY KEY,
  arquivo TEXT NOT NULL,
  colecao TEXT NOT NULL,
  ordem INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  corpo TEXT NOT NULL,
  ${VIVO}
);
CREATE INDEX estado_registros_por_colecao ON estado_registros (arquivo, colecao, ordem) WHERE apagado_em IS NULL;
${gatilhosDeDiario('estado_registros')}
CREATE TABLE _estados_no_disco (
  maquina TEXT NOT NULL,
  id TEXT NOT NULL REFERENCES estados (id),
  sha256 TEXT NOT NULL,
  em TEXT NOT NULL,
  PRIMARY KEY (maquina, id)
);`
  }
]

export const MIGRACOES_COFRE = [
```

- [x] **Passo 4: ver o verde.**

```powershell
node --test --test-concurrency=1 --test-reporter=spec testes/casa-banco.test.mjs *> "$rascunho\t1-verde.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t1-verde.txt" -Pattern '(tests|pass|fail) \d+\s*$'
```

Esperado: saída 0, `fail 0` e um teste a mais que antes.

Resultado (05/11): igual ao esperado: 23 de 23, em 7,6 s, os 22 de antes e o teste novo.

### Task 2: loja dos estados

**Arquivos:** criar `testes/casa-loja-estados.test.mjs` (CE, 16 testes) e `runtime/casa/loja-estados.mjs`. O CE prova a loja sozinha, sem ponte e sem arquivo de estado: decomposição, chave, ordem, ida e volta, diário, lápide, importação e recusas. Cada teste abre um banco novo numa casa temporária, com `env` vazio para nenhum `OMNI_CASA_BANCO` do ambiente desviar o banco.

- [x] **Passo 1: o CE.**

```js arquivo=testes/casa-loja-estados.test.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { comBancoDaCasa, sha256 } from '../runtime/casa/banco.mjs'
import {
  CATALOGO,
  baseNoDisco,
  confirmarEstadoNoDisco,
  contarEstado,
  decompor,
  docCanonico,
  gravarEstado,
  importarEstado,
  linhasDe,
  planejarOrdem,
  recomporEstado,
  shaDoEstado
} from '../runtime/casa/loja-estados.mjs'

const REL = 'learning/self-improvement.json'
const canonico = (doc) => `${JSON.stringify(doc, null, 2)}\n`
const idDe = (chave, colecao = 'proposals', rel = REL) => `${rel}|${colecao}|${chave}`
const ultimaDoDiario = (db) => db.prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM _diario').get().n
const diarioDesde = (db, marca) => db.prepare('SELECT tabela, linha, operacao FROM _diario WHERE seq > ? ORDER BY seq').all(marca)
  .map((linha) => `${linha.tabela}:${linha.linha}:${linha.operacao}`)
const versoes = (db, rel = REL) => Object.fromEntries(db.prepare('SELECT id, versao FROM estado_registros WHERE arquivo = ?').all(rel)
  .map((linha) => [linha.id.split('|').at(-1), linha.versao]))

// Casa temporária com o banco dentro dela; env vazio para nenhum OMNI_CASA_BANCO do ambiente
// desviar o banco para fora.
function comCasa(uso) {
  const casa = mkdtempSync(join(tmpdir(), 'omni-loja-estados-'))
  try {
    return comBancoDaCasa(casa, 'omni', uso, {})
  } finally {
    rmSync(casa, { recursive: true, force: true })
  }
}

test('decompor troca colecoes por [] e o relogio por null, sem mexer na entrada', () => {
  const doc = { schemaVersion: 1, store: { createdAt: 'c', updatedAt: 'u' }, proposals: [{ id: 'p1' }], meta: { n: 1 } }
  const antes = JSON.stringify(doc)
  const { esqueleto, relogio, colecoes } = decompor(doc)
  assert.equal(esqueleto, JSON.stringify({ schemaVersion: 1, store: { createdAt: 'c', updatedAt: null }, proposals: [], meta: { n: 1 } }))
  assert.equal(relogio, 'u')
  assert.deepEqual(colecoes, [['proposals', [{ id: 'p1' }]]])
  assert.equal(JSON.stringify(doc), antes)
  assert.equal(decompor({ schemaVersion: 1 }).relogio, null)
  assert.equal(decompor({ schemaVersion: 1, store: { updatedAt: null } }).relogio, null)
  assert.throws(() => decompor([]), /objeto JSON/)
  assert.throws(() => decompor(null), /objeto JSON/)
  assert.throws(() => decompor({ 'a|b': [] }), /\|/)
})

test('linhasDe tira a chave do campo do catalogo, do id, do texto ou do hash, sem repetir', () => {
  const chaves = (itens, campo) => linhasDe(itens, campo).map((linha) => linha.chave)
  const hash = (corpo) => `h:${sha256(corpo).slice(0, 32)}`
  assert.deepEqual(chaves([{ sessionFingerprint: 's1', id: 'i1' }, { id: 'i2' }], 'sessionFingerprint'), ['s1', 'i2'])
  assert.deepEqual(chaves([{ id: 'i1' }, 'texto', 7, null, { sem: 'id' }]), ['i1', 'texto', hash('7'), hash('null'), hash('{"sem":"id"}')])
  assert.deepEqual(chaves(['x', 'x', 'x#1']), ['x', 'x#1', 'x#1#1'])
  const longo = 'y'.repeat(201)
  assert.deepEqual(chaves([longo, 'y'.repeat(200)]), [hash(JSON.stringify(longo)), 'y'.repeat(200)])
  assert.equal(linhasDe([{ id: 'i1', v: [1, 'á'] }])[0].corpo, '{"id":"i1","v":[1,"á"]}')
})

test('planejarOrdem mantem a ordem enquanto ela cresce e manda o resto para o fim', () => {
  const u = undefined
  assert.deepEqual(planejarOrdem([0, 1, 2, u]), [0, 1, 2, 3])
  assert.deepEqual(planejarOrdem([0, 2, 3, 1]), [0, 2, 3, 4])
  assert.deepEqual(planejarOrdem([0, u, 1, 2]), [0, 3, 4, 5])
  assert.deepEqual(planejarOrdem([1, 2, 3]), [1, 2, 3])
  assert.deepEqual(planejarOrdem([u, u, u]), [0, 1, 2])
  assert.deepEqual(planejarOrdem([]), [])
})

test('gravar e recompor devolvem o mesmo texto, byte a byte', () => comCasa((db) => {
  const doc = JSON.parse('{"schemaVersion":1,"store":{"createdAt":"c","updatedAt":"u"},"proposals":[{"id":"p1","texto":"ação ✓ 🚀","passos":[{"a":[1,2]}]},{"id":"p2"}],"vazia":[],"tags":["x","x"],"__proto__":{"y":1},"aninhado":{"lista":[1,2],"__proto__":[3]}}')
  const texto = canonico(doc)
  gravarEstado(db, REL, texto)
  assert.equal(recomporEstado(db, REL), texto)
  assert.equal(shaDoEstado(db, REL), sha256(texto))
  assert.deepEqual(contarEstado(db, REL), { proposals: 2, vazia: 0, tags: 2 })
}))

test('mudar so o relogio troca hash e relogio sem subir versao nem escrever no diario', () => comCasa((db) => {
  const doc = { schemaVersion: 1, store: { updatedAt: 't0' }, proposals: [{ id: 'p1' }] }
  gravarEstado(db, REL, canonico(doc))
  const marca = ultimaDoDiario(db)
  const depois = { ...doc, store: { updatedAt: 't1' } }
  gravarEstado(db, REL, canonico(depois))
  assert.deepEqual(diarioDesde(db, marca), [])
  const linha = db.prepare('SELECT versao, relogio, texto_sha256 FROM estados WHERE id = ?').get(REL)
  assert.deepEqual({ ...linha }, { versao: 1, relogio: 't1', texto_sha256: sha256(canonico(depois)) })
  assert.equal(recomporEstado(db, REL), canonico(depois))
}))

test('item mudado e item novo no fim viram U e I so dessas linhas', () => comCasa((db) => {
  gravarEstado(db, REL, canonico({ schemaVersion: 1, proposals: [{ id: 'p1' }, { id: 'p2' }] }))
  const marca = ultimaDoDiario(db)
  gravarEstado(db, REL, canonico({ schemaVersion: 1, proposals: [{ id: 'p1' }, { id: 'p2', v: 2 }, { id: 'p3' }] }))
  assert.deepEqual(diarioDesde(db, marca), [`estado_registros:${idDe('p2')}:U`, `estado_registros:${idDe('p3')}:I`])
  assert.deepEqual(versoes(db), { p1: 1, p2: 2, p3: 1 })
}))

test('item removido vira lapide: corpo e hash vazios, apagado_em e versao nova', () => comCasa((db) => {
  gravarEstado(db, REL, canonico({ schemaVersion: 1, proposals: [{ id: 'p1' }, { id: 'p2' }] }), { agora: 't0' })
  const marca = ultimaDoDiario(db)
  gravarEstado(db, REL, canonico({ schemaVersion: 1, proposals: [{ id: 'p2' }] }), { agora: 't1' })
  const lapide = db.prepare('SELECT corpo, sha256, apagado_em, atualizado_em, versao FROM estado_registros WHERE id = ?').get(idDe('p1'))
  assert.deepEqual({ ...lapide }, { corpo: '', sha256: '', apagado_em: 't1', atualizado_em: 't1', versao: 2 })
  assert.deepEqual(diarioDesde(db, marca), [`estado_registros:${idDe('p1')}:U`])
}))

test('item que volta ressuscita a lapide: criado_em fica, versao sobe e o corpo volta', () => comCasa((db) => {
  gravarEstado(db, REL, canonico({ schemaVersion: 1, proposals: [{ id: 'p1' }] }), { agora: 't0' })
  gravarEstado(db, REL, canonico({ schemaVersion: 1, proposals: [] }), { agora: 't1' })
  const marca = ultimaDoDiario(db)
  gravarEstado(db, REL, canonico({ schemaVersion: 1, proposals: [{ id: 'p1' }] }), { agora: 't2' })
  const linha = db.prepare('SELECT criado_em, atualizado_em, apagado_em, versao, corpo FROM estado_registros WHERE id = ?').get(idDe('p1'))
  assert.deepEqual({ ...linha }, { criado_em: 't0', atualizado_em: 't2', apagado_em: null, versao: 3, corpo: '{"id":"p1"}' })
  assert.deepEqual(diarioDesde(db, marca), [`estado_registros:${idDe('p1')}:U`])
}))

test('reordenar muda so quem saiu da ordem crescente', () => comCasa((db) => {
  gravarEstado(db, REL, canonico({ schemaVersion: 1, proposals: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }))
  const marca = ultimaDoDiario(db)
  const texto = canonico({ schemaVersion: 1, proposals: [{ id: 'a' }, { id: 'c' }, { id: 'b' }] })
  gravarEstado(db, REL, texto)
  assert.deepEqual(diarioDesde(db, marca), [`estado_registros:${idDe('b')}:U`])
  assert.equal(recomporEstado(db, REL), texto)
}))

test('o mesmo documento duas vezes nao escreve nada; chave nova no esqueleto sobe a versao do estado', () => comCasa((db) => {
  const doc = { schemaVersion: 1, proposals: [{ id: 'p1' }] }
  gravarEstado(db, REL, canonico(doc))
  const marca = ultimaDoDiario(db)
  gravarEstado(db, REL, canonico(doc))
  assert.deepEqual(diarioDesde(db, marca), [])
  gravarEstado(db, REL, canonico({ ...doc, policy: { limite: 3 } }))
  assert.deepEqual(diarioDesde(db, marca), [`estados:${REL}:U`])
  assert.equal(db.prepare('SELECT versao FROM estados WHERE id = ?').get(REL).versao, 2)
}))

test('importar guarda a forma canonica, anota a fonte original e confirma a base da maquina', () => comCasa((db) => {
  const fonte = '{"schemaVersion":1,"proposals":[{"id":"p1"},{"id":"p2"}],"vazia":[]}'
  const canonica = canonico(JSON.parse(fonte))
  assert.equal(importarEstado(db, REL, fonte, { maquina: 'pc-a', agora: 't9' }), 'importada')
  assert.equal(shaDoEstado(db, REL), sha256(canonica))
  assert.equal(baseNoDisco(db, REL, 'pc-a'), sha256(canonica))
  assert.equal(recomporEstado(db, REL), canonica)
  const anotadas = db.prepare('SELECT tipo, fonte, fonte_sha256, contagens, origem_maquina, feita_em FROM _importacoes').all()
    .map((linha) => ({ ...linha }))
  assert.deepEqual(anotadas, [{
    tipo: 'estados', fonte: REL, fonte_sha256: sha256(fonte), contagens: '{"proposals":2,"vazia":0}', origem_maquina: 'pc-a', feita_em: 't9'
  }])
  assert.equal(importarEstado(db, REL, fonte, { maquina: 'pc-a', agora: 't10' }), 'presente')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM _importacoes').get().n, 1)
}))

test('estado apagado some da leitura, e importar de novo o ressuscita', () => comCasa((db) => {
  const fonte = canonico({ schemaVersion: 1, proposals: [{ id: 'p1' }] })
  importarEstado(db, REL, fonte)
  db.prepare("UPDATE estados SET apagado_em = 't1', versao = versao + 1 WHERE id = ?").run(REL)
  assert.equal(shaDoEstado(db, REL), null)
  assert.throws(() => recomporEstado(db, REL), /não está no banco/)
  assert.equal(importarEstado(db, REL, fonte), 'importada')
  const linha = db.prepare('SELECT apagado_em, versao FROM estados WHERE id = ?').get(REL)
  assert.deepEqual({ ...linha }, { apagado_em: null, versao: 3 })
  assert.equal(recomporEstado(db, REL), fonte)
}))

test('gravar recusa texto fora da forma canonica e estado fora do catalogo, sem escrever nada', () => comCasa((db) => {
  assert.throws(() => gravarEstado(db, REL, '{"schemaVersion":1}'), /forma canônica/)
  assert.throws(() => docCanonico(REL, '{"schemaVersion":1}\n'), /forma canônica/)
  assert.throws(() => gravarEstado(db, 'learning/daily-scan.json', canonico({ schemaVersion: 1 })), /fora do catálogo/)
  assert.throws(() => gravarEstado(db, 'constructor', canonico({ schemaVersion: 1 })), /fora do catálogo/)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM estados').get().n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM _diario').get().n, 0)
  assert.equal(Object.keys(CATALOGO).length, 8)
}))

test('recompor recusa registro adulterado e registro de colecao que o esqueleto nao tem', () => comCasa((db) => {
  gravarEstado(db, REL, canonico({ schemaVersion: 1, proposals: [{ id: 'p1' }] }))
  const adulterar = db.prepare('UPDATE estado_registros SET corpo = ?, colecao = ? WHERE id = ?')
  adulterar.run('{"id":"p1","x":1}', 'proposals', idDe('p1'))
  assert.throws(() => recomporEstado(db, REL), /divergiu/)
  adulterar.run('{"id":"p1"}', 'fantasma', idDe('p1'))
  assert.throws(() => recomporEstado(db, REL), /coleção que o esqueleto não tem: fantasma/)
}))

test('a base e por maquina, exige o estado e nao vai ao diario', () => comCasa((db) => {
  gravarEstado(db, REL, canonico({ schemaVersion: 1, proposals: [] }))
  const marca = ultimaDoDiario(db)
  confirmarEstadoNoDisco(db, REL, 'sha-a', { maquina: 'pc-a', agora: 't1' })
  confirmarEstadoNoDisco(db, REL, 'sha-b', { maquina: 'pc-b', agora: 't1' })
  confirmarEstadoNoDisco(db, REL, 'sha-a2', { maquina: 'pc-a', agora: 't2' })
  assert.equal(baseNoDisco(db, REL, 'pc-a'), 'sha-a2')
  assert.equal(baseNoDisco(db, REL, 'pc-b'), 'sha-b')
  assert.equal(baseNoDisco(db, REL, 'pc-c'), null)
  assert.throws(() => confirmarEstadoNoDisco(db, 'learning/failures.json', 'x', { maquina: 'pc-a' }), /FOREIGN KEY/)
  assert.deepEqual(diarioDesde(db, marca), [])
}))

test('chave declarada no catalogo vira o id do registro', () => comCasa((db) => {
  const feedback = 'feedback/personality-feedback.json'
  const continuidade = 'feedback/personality-continuity.json'
  gravarEstado(db, feedback, canonico({ schemaVersion: 1, lastResponses: [{ sessionFingerprint: 's1', id: 'x' }] }))
  gravarEstado(db, continuidade, canonico({ schemaVersion: 1, observations: [{ fingerprint: 'f1', id: 'y' }] }))
  const ids = db.prepare('SELECT id FROM estado_registros ORDER BY id').all().map((linha) => linha.id)
  assert.deepEqual(ids, [idDe('f1', 'observations', continuidade), idDe('s1', 'lastResponses', feedback)])
}))
```

Extrair só o CE:

```powershell
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so testes/casa-loja-estados.test.mjs
```

Esperado: `gravado testes/casa-loja-estados.test.mjs`.

Resultado (05/11): `gravado testes/casa-loja-estados.test.mjs`.

- [x] **Passo 2: ver o vermelho.**

```powershell
node --test --test-concurrency=1 --test-reporter=spec testes/casa-loja-estados.test.mjs *> "$rascunho\t2-vermelho.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t2-vermelho.txt" -Pattern '(tests|pass|fail) \d+\s*$', 'ERR_MODULE_NOT_FOUND'
```

Esperado: saída 1. O arquivo não carrega (`ERR_MODULE_NOT_FOUND` de `runtime/casa/loja-estados.mjs`), e o `node --test` conta isso como uma falha. A prova de que cada asserção morde vem da mutação (T7).

Resultado (05/11): igual ao esperado: 1 teste, 0 verdes e 1 vermelho, com o `ERR_MODULE_NOT_FOUND` de `runtime/casa/loja-estados.mjs`, em 0,16 s.

- [x] **Passo 3: a loja.**

```js arquivo=runtime/casa/loja-estados.mjs
// Estados de aprendizado e feedback no omni.db (plano 3 da F1, §4.2 e §6 do desenho).
// Cada estado (learning/*.json, feedback/*.json) vira uma linha de `estados`, com o esqueleto (o
// documento com as coleções vazias e o relógio zerado), e uma linha de `estado_registros` por
// item de coleção. Só a forma canônica (JSON.stringify(doc, null, 2) + '\n') entra e sai:
// recompor confere o sha256 do texto inteiro e recusa divergência.
import { agoraIso, maquinaAtual, sha256, transacao, uuidv7 } from './banco.mjs'

// p2: o dono passa pela ponte (runtime/estados.mjs). espelho: o dono é a loja TS do dist, e o
// banco a acompanha na varredura. chaves: coleção cujo item tem chave natural própria.
export const CATALOGO = Object.freeze({
  'learning/failures.json': { modo: 'p2' },
  'learning/failure-automation.json': { modo: 'p2' },
  'learning/self-improvement.json': { modo: 'p2' },
  'learning/shortcuts.json': { modo: 'p2' },
  'learning/evolution-receipts.json': { modo: 'p2' },
  'feedback/personality-feedback.json': { modo: 'p2', chaves: { lastResponses: 'sessionFingerprint' } },
  'feedback/personality-continuity.json': { modo: 'espelho', chaves: { observations: 'fingerprint' } },
  'feedback/personality-owner-directions.json': { modo: 'espelho', chaves: { observations: 'fingerprint' } }
})

function definicaoDo(rel) {
  if (!Object.hasOwn(CATALOGO, rel)) throw new Error(`Estado fora do catálogo: ${rel}`)
  return CATALOGO[rel]
}

function objetoSimples(valor) {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor)
}

const idDoRegistro = (rel, colecao, chave) => `${rel}|${colecao}|${chave}`

// Esqueleto: o documento com cada coleção (valor de topo que é array) trocada por [] e o
// store.updatedAt texto trocado por null. O relógio sai à parte: é local de cada máquina.
export function decompor(doc) {
  if (!objetoSimples(doc)) throw new Error('Estado precisa ser objeto JSON.')
  const colecoes = []
  const esqueleto = Object.fromEntries(Object.entries(doc).map(([chave, valor]) => {
    if (!Array.isArray(valor)) return [chave, valor]
    if (chave.includes('|')) throw new Error(`Coleção com "|" no nome não vira registro: ${chave}`)
    colecoes.push([chave, valor])
    return [chave, []]
  }))
  const relogio = typeof doc.store?.updatedAt === 'string' ? doc.store.updatedAt : null
  if (relogio !== null) esqueleto.store = { ...doc.store, updatedAt: null }
  return { esqueleto: JSON.stringify(esqueleto), relogio, colecoes }
}

// Chave natural do item: o campo do catálogo; senão o id texto; senão o próprio texto (até 200
// caracteres); senão h: + 32 hex do sha256 do item. Repetida ganha #1, #2… até achar uma livre
// (['x','x','x#1'] → x, x#1, x#1#1), então a chave é única na coleção.
export function linhasDe(itens, campoChave) {
  const usadas = new Set()
  return itens.map((item) => {
    const corpo = JSON.stringify(item) // os itens vêm de JSON.parse: sempre serializam
    let base
    if (campoChave && typeof item?.[campoChave] === 'string') base = item[campoChave]
    else if (typeof item?.id === 'string') base = item.id
    else if (typeof item === 'string' && item.length <= 200) base = item
    else base = `h:${sha256(corpo).slice(0, 32)}`
    let chave = base
    for (let n = 1; usadas.has(chave); n += 1) chave = `${base}#${n}`
    usadas.add(chave)
    return { chave, corpo }
  })
}

// Regra da cauda: enquanto a ordem gravada cresce, o item a mantém; da primeira quebra em diante,
// maior+1, maior+2… Append no fim não mexe em ninguém.
export function planejarOrdem(gravadas) {
  let maior = -1
  for (const ordem of gravadas) if (ordem !== undefined && ordem > maior) maior = ordem
  let ultima = -Infinity
  let quebrou = false
  return gravadas.map((ordem) => {
    if (!quebrou && ordem !== undefined && ordem > ultima) {
      ultima = ordem
      return ordem
    }
    quebrou = true
    maior += 1
    return maior
  })
}

export function shaDoEstado(db, rel) {
  return db.prepare('SELECT texto_sha256 FROM estados WHERE id = ? AND apagado_em IS NULL').get(rel)?.texto_sha256 ?? null
}

export function baseNoDisco(db, rel, maquina = maquinaAtual()) {
  return db.prepare('SELECT sha256 FROM _estados_no_disco WHERE maquina = ? AND id = ?').get(maquina, rel)?.sha256 ?? null
}

export function confirmarEstadoNoDisco(db, rel, sha, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  db.prepare(`INSERT INTO _estados_no_disco (maquina, id, sha256, em) VALUES (?, ?, ?, ?)
    ON CONFLICT (maquina, id) DO UPDATE SET sha256 = excluded.sha256, em = excluded.em`).run(maquina, rel, sha, agora)
}

// Grava um documento já validado; texto é a forma canônica dele. Sem transação própria (transacao
// não é reentrante): quem chama segura o BEGIN IMMEDIATE. Sobe versão só o que mudou: registro
// novo, mudado, movido ou apagado, e o esqueleto. Mudança só do relógio não vai ao diário.
export function escreverEstado(db, rel, doc, texto, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  const definicao = definicaoDo(rel)
  const { esqueleto, relogio, colecoes } = decompor(doc)
  const vivos = new Map(db.prepare('SELECT id, ordem, sha256 FROM estado_registros WHERE arquivo = ? AND apagado_em IS NULL')
    .all(rel).map((linha) => [linha.id, linha]))
  const inserir = db.prepare(`INSERT INTO estado_registros (id, arquivo, colecao, ordem, sha256, corpo, origem_maquina, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET ordem = excluded.ordem, sha256 = excluded.sha256, corpo = excluded.corpo,
      origem_maquina = excluded.origem_maquina, atualizado_em = excluded.atualizado_em, versao = versao + 1, apagado_em = NULL`)
  const mudar = db.prepare(`UPDATE estado_registros SET ordem = ?, sha256 = ?, corpo = ?, origem_maquina = ?, atualizado_em = ?,
    versao = versao + 1 WHERE id = ?`)
  const apagar = db.prepare(`UPDATE estado_registros SET corpo = '', sha256 = '', origem_maquina = ?, atualizado_em = ?, apagado_em = ?,
    versao = versao + 1 WHERE id = ?`)
  const vistos = new Set()
  for (const [colecao, itens] of colecoes) {
    const linhas = linhasDe(itens, definicao.chaves?.[colecao]).map((linha) => ({ ...linha, id: idDoRegistro(rel, colecao, linha.chave) }))
    const ordens = planejarOrdem(linhas.map((linha) => vivos.get(linha.id)?.ordem))
    linhas.forEach((linha, i) => {
      vistos.add(linha.id)
      const sha = sha256(linha.corpo)
      const atual = vivos.get(linha.id)
      // Sem linha viva: registro novo ou lápide que ressuscita (o upsert preserva criado_em).
      if (!atual) inserir.run(linha.id, rel, colecao, ordens[i], sha, linha.corpo, maquina, agora, agora)
      else if (atual.sha256 !== sha || atual.ordem !== ordens[i]) mudar.run(ordens[i], sha, linha.corpo, maquina, agora, linha.id)
    })
  }
  for (const id of vivos.keys()) if (!vistos.has(id)) apagar.run(maquina, agora, agora, id)
  const textoSha = sha256(texto)
  const linha = db.prepare('SELECT esqueleto, apagado_em FROM estados WHERE id = ?').get(rel)
  if (!linha) {
    db.prepare(`INSERT INTO estados (id, esqueleto, texto_sha256, relogio, origem_maquina, criado_em, atualizado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(rel, esqueleto, textoSha, relogio, maquina, agora, agora)
  } else if (linha.esqueleto !== esqueleto || linha.apagado_em !== null) {
    db.prepare(`UPDATE estados SET esqueleto = ?, texto_sha256 = ?, relogio = ?, origem_maquina = ?, atualizado_em = ?,
      versao = versao + 1, apagado_em = NULL WHERE id = ?`).run(esqueleto, textoSha, relogio, maquina, agora, rel)
  } else {
    // Mesmo esqueleto: hash e relógio acompanham, sem versão e sem diário.
    db.prepare('UPDATE estados SET texto_sha256 = ?, relogio = ? WHERE id = ?').run(textoSha, relogio, rel)
  }
}

// Remonta o documento (esqueleto, relógio e registros por coleção e ordem) e confere o sha256 do
// texto inteiro contra texto_sha256: divergência lança, nunca devolve texto que o banco não gravou.
export function recomporEstado(db, rel) {
  const linha = db.prepare('SELECT esqueleto, relogio, texto_sha256 FROM estados WHERE id = ? AND apagado_em IS NULL').get(rel)
  if (!linha) throw new Error(`Estado ${rel} não está no banco.`)
  const doc = JSON.parse(linha.esqueleto)
  if (linha.relogio !== null) doc.store.updatedAt = linha.relogio
  const registros = db.prepare('SELECT colecao, corpo FROM estado_registros WHERE arquivo = ? AND apagado_em IS NULL ORDER BY colecao, ordem')
    .all(rel)
  for (const registro of registros) {
    if (!Array.isArray(doc[registro.colecao])) {
      throw new Error(`Registro de ${rel} aponta coleção que o esqueleto não tem: ${registro.colecao}.`)
    }
    doc[registro.colecao].push(JSON.parse(registro.corpo))
  }
  const texto = `${JSON.stringify(doc, null, 2)}\n`
  if (sha256(texto) !== linha.texto_sha256) throw new Error(`Recomposição de ${rel} divergiu do texto gravado.`)
  return texto
}

// Itens vivos por coleção; coleção vazia no esqueleto conta 0.
export function contarEstado(db, rel) {
  const { esqueleto } = db.prepare('SELECT esqueleto FROM estados WHERE id = ?').get(rel)
  const contagens = new Map(Object.entries(JSON.parse(esqueleto)).filter(([, valor]) => Array.isArray(valor)).map(([chave]) => [chave, 0]))
  const porColecao = db.prepare('SELECT colecao, COUNT(*) AS n FROM estado_registros WHERE arquivo = ? AND apagado_em IS NULL GROUP BY colecao')
    .all(rel)
  for (const { colecao, n } of porColecao) contagens.set(colecao, n)
  return Object.fromEntries(contagens)
}

export function registrarImportacaoDeEstado(db, rel, { fonteSha, contagens, maquina = maquinaAtual(), agora = agoraIso() }) {
  db.prepare('INSERT INTO _importacoes (id, tipo, fonte, fonte_sha256, contagens, origem_maquina, feita_em) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(uuidv7(), 'estados', rel, fonteSha, JSON.stringify(contagens), maquina, agora)
}

// Primeira carga de um estado. Sem transação própria. A fonte original pode vir compacta: o banco
// guarda a forma canônica, a base desta máquina vira o hash dela e _importacoes anota o hash da
// fonte original. Estado já presente não é reimportado.
export function importarEstado(db, rel, fonte, opcoes = {}) {
  if (shaDoEstado(db, rel) !== null) return 'presente'
  const doc = JSON.parse(fonte)
  const canonica = `${JSON.stringify(doc, null, 2)}\n`
  escreverEstado(db, rel, doc, canonica, opcoes)
  recomporEstado(db, rel) // lança se a ida e volta divergir
  registrarImportacaoDeEstado(db, rel, { fonteSha: sha256(fonte), contagens: contarEstado(db, rel), ...opcoes })
  confirmarEstadoNoDisco(db, rel, sha256(canonica), opcoes)
  return 'importada'
}

// Só a forma canônica entra: os seis módulos e a loja TS já gravam assim, e só com ela o hash
// da recomposição fecha.
export function docCanonico(rel, texto) {
  const doc = JSON.parse(texto)
  if (`${JSON.stringify(doc, null, 2)}\n` !== texto) throw new Error(`Estado ${rel} fora da forma canônica.`)
  return doc
}

// Escrita direta, em transação própria (testes e prova). A ponte usa escreverEstado dentro da
// transação dela, junto com a projeção.
export function gravarEstado(db, rel, texto, opcoes = {}) {
  const doc = docCanonico(rel, texto)
  transacao(db, () => escreverEstado(db, rel, doc, texto, opcoes))
}
```

Extrair a loja:

```powershell
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so runtime/casa/loja-estados.mjs
```

Esperado: `gravado runtime/casa/loja-estados.mjs`.

Resultado (05/11): `gravado runtime/casa/loja-estados.mjs`.

- [x] **Passo 4: ver o verde.**

```powershell
node --test --test-concurrency=1 --test-reporter=spec testes/casa-loja-estados.test.mjs *> "$rascunho\t2-verde.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t2-verde.txt" -Pattern '(tests|pass|fail|skipped) \d+\s*$'
```

Esperado: saída 0, `tests 16`, `pass 16`, `fail 0` e `skipped 0`.

Resultado (05/11): igual ao esperado: 16 de 16, em 0,7 s.

- [x] **Passo 5: finais de linha e guarda.**

```powershell
foreach ($f in 'runtime\casa\loja-estados.mjs', 'testes\casa-loja-estados.test.mjs') { $f + ': ' + ([IO.File]::ReadAllBytes((Resolve-Path $f)) | Where-Object { $_ -eq 13 }).Count }
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `0` nos dois arquivos e `False`.

Resultado (05/11): `0` nos dois arquivos e `False`.

### Task 3: ponte dos estados

**Arquivos:** criar `testes/estados.test.mjs` (ES, 23 testes) e `runtime/estados.mjs` (a ponte). O ES prova a tabela de decisão linha por linha, mais a escrita, as degradações, a varredura e o espelho contra a loja TS real do `dist`. As linhas p2 usam `learning/shortcuts.json` com um validador mínimo (`shortcuts` tem de ser array), porque o validador real dos atalhos só entra na T4. Todo arquivo semeado ganha mtime de 2020: se a ponte reescrever o arquivo, o mtime muda, e é assim que o teste separa "devolveu o texto" de "reescreveu o arquivo". O teste 18 só roda no Windows, onde o `rename` sobre arquivo somente leitura falha, e leva uns 2 s, o prazo das novas tentativas do `escreverAtomico`.

- [x] **Passo 1: o ES.**

```js arquivo=testes/estados.test.mjs
import assert from 'node:assert/strict'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import test from 'node:test'

import { observePersonalityContinuity, readPersonalityContinuity } from '../dist/adapters/local-json/personality-continuity-store.js'
import { arquivoDoBanco, comBancoDaCasa, pastaDoBanco, sha256 } from '../runtime/casa/banco.mjs'
import { baseNoDisco, gravarEstado, recomporEstado, shaDoEstado } from '../runtime/casa/loja-estados.mjs'
import { lerSeExistir } from '../runtime/casa/projecao.mjs'
import { avaliarEstrutura, avaliarTexto, carregarTextoDoEstado, gravarTextoDoEstado, reconciliarEstados } from '../runtime/estados.mjs'

const ANTIGO = new Date('2020-01-01T00:00:00Z')
const REL = 'learning/shortcuts.json'
const VERSAO = 4
const SO_NO_WINDOWS = process.platform !== 'win32' && 'rename sobre arquivo somente leitura só falha no Windows'

// Validador mínimo no lugar do validador real dos atalhos, que entra na T4.
function validar(doc) {
  if (!Array.isArray(doc.shortcuts)) throw new Error('shortcuts ausente')
}
const AVALIACAO = { versao: VERSAO, validar }
const canonico = (valor) => `${JSON.stringify(valor, null, 2)}\n`
const doc = (n, extra = {}) => ({
  schemaVersion: VERSAO,
  store: { updatedAt: `2026-11-05T00:00:0${n}.000Z` },
  shortcuts: Array.from({ length: n }, (_, i) => ({ id: `s${i}` })),
  ...extra
})

const casaNova = () => mkdtempSync(join(tmpdir(), 'omni-estados-'))
const apagar = (casa) => rmSync(casa, { recursive: true, force: true })
const arquivoDe = (casa, rel = REL) => join(casa, ...rel.split('/'))

// Arquivo semeado com mtime antigo: se a ponte o reescrever, o mtime muda.
function semear(casa, texto, rel = REL) {
  const arquivo = arquivoDe(casa, rel)
  mkdirSync(dirname(arquivo), { recursive: true })
  writeFileSync(arquivo, texto)
  utimesSync(arquivo, ANTIGO, ANTIGO)
  return arquivo
}
const intocado = (arquivo) => statSync(arquivo).mtimeMs === ANTIGO.getTime()

function degradacoes(casa) {
  const texto = lerSeExistir(join(pastaDoBanco(casa, {}), 'degradacoes.jsonl'))
  return texto === null ? [] : texto.trim().split('\n').map((linha) => JSON.parse(linha).operacao)
}
// Abre o banco (e o cria se faltar): só depois que a ponte já o criou, ou quando o teste quer um.
const noBanco = (casa, rel = REL) =>
  comBancoDaCasa(casa, 'omni', (db) => ({ sha: shaDoEstado(db, rel), base: baseNoDisco(db, rel) }), {})
const gravarNoBanco = (casa, texto, rel = REL) => comBancoDaCasa(casa, 'omni', (db) => gravarEstado(db, rel, texto), {})
function copias(casa, tipo, rel = REL) {
  const arquivo = arquivoDe(casa, rel)
  const prefixo = `${basename(arquivo)}.${tipo}.`
  return readdirSync(dirname(arquivo)).filter((nome) => nome.startsWith(prefixo))
}
const carregar = (casa, opcoes = {}) => carregarTextoDoEstado(casa, REL, { ...AVALIACAO, env: {}, ...opcoes })
const gravar = (casa, texto, opcoes = {}) => gravarTextoDoEstado(casa, REL, texto, { env: {}, ...opcoes })

test('vazia: sem arquivo e sem linha devolve null, e sem banco não cria banco', () => {
  const casa = casaNova()
  try {
    assert.equal(carregar(casa), null)
    assert.equal(existsSync(pastaDoBanco(casa, {})), false)
    comBancoDaCasa(casa, 'omni', () => {}, {})
    assert.equal(carregar(casa), null)
    assert.equal(existsSync(arquivoDe(casa)), false)
    assert.deepEqual(degradacoes(casa), [])
  } finally {
    apagar(casa)
  }
})

test('intocada sem linha: arquivo quebrado, de versão futura ou fora do contrato não entra no banco', () => {
  const textos = ['xx{', canonico(doc(1, { schemaVersion: VERSAO + 1 })), canonico({ schemaVersion: VERSAO, store: {} })]
  for (const texto of textos) {
    const casa = casaNova()
    try {
      const arquivo = semear(casa, texto)
      assert.equal(carregar(casa), texto)
      assert.ok(intocado(arquivo))
      assert.deepEqual(noBanco(casa), { sha: null, base: null })
      assert.deepEqual(copias(casa, 'antes-da-casa'), [])
      assert.deepEqual(degradacoes(casa), [])
    } finally {
      apagar(casa)
    }
  }
})

test('importada: a fonte compacta volta como está, ganha cópia e o banco guarda a forma canônica', () => {
  const casa = casaNova()
  try {
    const fonte = JSON.stringify(doc(2))
    const arquivo = semear(casa, fonte)
    assert.equal(carregar(casa), fonte)
    assert.ok(intocado(arquivo))
    const guardadas = copias(casa, 'antes-da-casa')
    assert.equal(guardadas.length, 1)
    assert.equal(readFileSync(join(dirname(arquivo), guardadas[0]), 'utf8'), fonte)
    const sha = sha256(canonico(doc(2)))
    assert.deepEqual(noBanco(casa), { sha, base: sha })
    const importacoes = () => comBancoDaCasa(casa, 'omni', (db) =>
      db.prepare("SELECT fonte, fonte_sha256 FROM _importacoes WHERE tipo = 'estados'").all().map((linha) => ({ ...linha })), {})
    assert.deepEqual(importacoes(), [{ fonte: REL, fonte_sha256: sha256(fonte) }])
    assert.equal(carregar(casa), fonte)
    assert.ok(intocado(arquivo))
    assert.equal(copias(casa, 'antes-da-casa').length, 1)
    assert.equal(importacoes().length, 1)
    assert.deepEqual(degradacoes(casa), [])
  } finally {
    apagar(casa)
  }
})

test('projetada: sem arquivo e com linha, o banco reescreve o disco e confirma a base', () => {
  const casa = casaNova()
  try {
    const texto = canonico(doc(2))
    gravarNoBanco(casa, texto)
    assert.equal(carregar(casa), texto)
    assert.equal(readFileSync(arquivoDe(casa), 'utf8'), texto)
    assert.deepEqual(noBanco(casa), { sha: sha256(texto), base: sha256(texto) })
    assert.deepEqual(copias(casa, 'antes-da-casa'), [])
    assert.deepEqual(degradacoes(casa), [])
  } finally {
    apagar(casa)
  }
})

test('atual: arquivo igual ao banco, ou com a mesma forma canônica, fica como está e a base perdida volta', () => {
  const casa = casaNova()
  try {
    const texto = canonico(doc(2))
    gravarNoBanco(casa, texto)
    const arquivo = semear(casa, texto)
    assert.deepEqual(noBanco(casa), { sha: sha256(texto), base: null })
    assert.equal(carregar(casa), texto)
    assert.ok(intocado(arquivo))
    assert.deepEqual(noBanco(casa), { sha: sha256(texto), base: sha256(texto) })
    const compacta = JSON.stringify(doc(2))
    semear(casa, compacta)
    comBancoDaCasa(casa, 'omni', (db) => db.exec('DELETE FROM _estados_no_disco'), {})
    assert.equal(carregar(casa), compacta)
    assert.ok(intocado(arquivo))
    assert.deepEqual(noBanco(casa), { sha: sha256(texto), base: sha256(texto) })
    assert.deepEqual(degradacoes(casa), [])
  } finally {
    apagar(casa)
  }
})

test('socorrida: arquivo quebrado com linha válida vira cópia .invalida e o banco reprojeta', () => {
  const casa = casaNova()
  try {
    const texto = canonico(doc(2))
    gravarNoBanco(casa, texto)
    const arquivo = semear(casa, 'xx{')
    assert.equal(carregar(casa), texto)
    assert.equal(readFileSync(arquivo, 'utf8'), texto)
    const guardadas = copias(casa, 'invalida')
    assert.equal(guardadas.length, 1)
    assert.equal(readFileSync(join(dirname(arquivo), guardadas[0]), 'utf8'), 'xx{')
    assert.deepEqual(noBanco(casa), { sha: sha256(texto), base: sha256(texto) })
    assert.deepEqual(degradacoes(casa), ['estado.arquivo-invalido'])
  } finally {
    apagar(casa)
  }
})

test('socorro barrado: banco fora do contrato não substitui o arquivo quebrado', () => {
  const casa = casaNova()
  try {
    gravarNoBanco(casa, canonico({ schemaVersion: VERSAO, store: { updatedAt: '2026-11-05T00:00:00.000Z' } }))
    const arquivo = semear(casa, 'xx{')
    assert.equal(carregar(casa), 'xx{')
    assert.ok(intocado(arquivo))
    assert.deepEqual(copias(casa, 'invalida'), [])
    assert.deepEqual(degradacoes(casa), [])
  } finally {
    apagar(casa)
  }
})

test('sem cópia, sem socorro: se a cópia .invalida não sai, o arquivo quebrado fica', (t) => {
  const casa = casaNova()
  try {
    const texto = canonico(doc(2))
    gravarNoBanco(casa, texto)
    const arquivo = semear(casa, 'xx{')
    t.mock.method(Date.prototype, 'toISOString', () => '2026-01-01T00:00:00.000Z')
    const ocupada = `${arquivo}.invalida.20260101000000000`
    writeFileSync(ocupada, 'ocupada')
    assert.equal(carregar(casa), 'xx{')
    assert.ok(intocado(arquivo))
    assert.equal(readFileSync(ocupada, 'utf8'), 'ocupada')
    assert.deepEqual(noBanco(casa), { sha: sha256(texto), base: null })
    assert.deepEqual(degradacoes(casa), ['estado.copia'])
  } finally {
    apagar(casa)
  }
})

test('defasada: arquivo na versão que o banco já superou recebe a versão do banco', () => {
  for (const noDisco of [canonico(doc(1)), JSON.stringify(doc(1))]) {
    const casa = casaNova()
    try {
      const arquivo = semear(casa, canonico(doc(1)))
      assert.equal(carregar(casa), canonico(doc(1)))
      gravarNoBanco(casa, canonico(doc(2)))
      semear(casa, noDisco)
      assert.equal(carregar(casa), canonico(doc(2)))
      assert.equal(readFileSync(arquivo, 'utf8'), canonico(doc(2)))
      assert.deepEqual(noBanco(casa), { sha: sha256(canonico(doc(2))), base: sha256(canonico(doc(2))) })
      assert.deepEqual(copias(casa, 'invalida'), [])
      assert.deepEqual(degradacoes(casa), [])
    } finally {
      apagar(casa)
    }
  }
})

test('ingerida: escrita externa válida entra no banco e o arquivo fica como está', () => {
  const casa = casaNova()
  try {
    const arquivo = semear(casa, canonico(doc(1)))
    assert.equal(carregar(casa), canonico(doc(1)))
    const externa = JSON.stringify(doc(3))
    semear(casa, externa)
    assert.equal(carregar(casa), externa)
    assert.ok(intocado(arquivo))
    const sha = sha256(canonico(doc(3)))
    assert.deepEqual(noBanco(casa), { sha, base: sha })
    assert.equal(comBancoDaCasa(casa, 'omni', (db) => recomporEstado(db, REL), {}), canonico(doc(3)))
    assert.deepEqual(degradacoes(casa), [])
  } finally {
    apagar(casa)
  }
})

test('com linha, arquivo de versão futura ou fora do contrato fica intocado e o banco não muda', () => {
  for (const texto of [canonico(doc(3, { schemaVersion: VERSAO + 1 })), canonico({ schemaVersion: VERSAO, store: {} })]) {
    const casa = casaNova()
    try {
      const atual = canonico(doc(1))
      semear(casa, atual)
      assert.equal(carregar(casa), atual)
      const arquivo = semear(casa, texto)
      assert.equal(carregar(casa), texto)
      assert.ok(intocado(arquivo))
      assert.deepEqual(noBanco(casa), { sha: sha256(atual), base: sha256(atual) })
      assert.deepEqual(degradacoes(casa), [])
    } finally {
      apagar(casa)
    }
  }
})

test('avaliarTexto e avaliarEstrutura', () => {
  for (const texto of ['xx{', '[]', 'null', '"texto"', '{"store":{}}', '{"schemaVersion":"4"}', '{"schemaVersion":4.5}']) {
    assert.equal(avaliarTexto(texto, AVALIACAO), 'quebrada', texto)
    assert.equal(avaliarEstrutura(texto), false, texto)
  }
  assert.equal(avaliarTexto(JSON.stringify(doc(1, { schemaVersion: VERSAO + 1 })), AVALIACAO), 'futura')
  assert.equal(avaliarTexto('{"schemaVersion":4}', AVALIACAO), 'fora-do-contrato')
  assert.equal(avaliarTexto('{"schemaVersion":3}', AVALIACAO), 'ok')
  assert.equal(avaliarTexto(JSON.stringify(doc(1)), AVALIACAO), 'ok')
  assert.equal(avaliarEstrutura('{"schemaVersion":99}'), true)
  assert.equal(avaliarEstrutura(JSON.stringify(doc(1))), true)
})

test('sem SQLite: carga e escrita só no arquivo, sem banco', () => {
  const casa = casaNova()
  const env = { OMNI_CASA_SEM_SQLITE: '1' }
  try {
    assert.equal(carregar(casa, { env }), null)
    const texto = canonico(doc(2))
    gravar(casa, texto, { env })
    assert.equal(readFileSync(arquivoDe(casa), 'utf8'), texto)
    assert.equal(carregar(casa, { env }), texto)
    assert.equal(existsSync(pastaDoBanco(casa, {})), false)
  } finally {
    apagar(casa)
  }
})

test('estado que é pasta: o erro de leitura sobe antes de abrir o banco', () => {
  const casa = casaNova()
  try {
    mkdirSync(arquivoDe(casa), { recursive: true })
    assert.throws(() => carregar(casa), { code: 'EISDIR' })
    assert.equal(existsSync(pastaDoBanco(casa, {})), false)
  } finally {
    apagar(casa)
  }
})

test('banco que não abre: com arquivo a ponte segue no disco; sem arquivo recusa começar vazio', () => {
  const casa = casaNova()
  try {
    mkdirSync(arquivoDoBanco(casa, 'omni', {}), { recursive: true })
    assert.throws(() => carregar(casa), /recusa começar vazio/)
    const texto = canonico(doc(1))
    const arquivo = semear(casa, texto)
    assert.equal(carregar(casa), texto)
    assert.ok(intocado(arquivo))
    gravar(casa, canonico(doc(2)))
    assert.equal(readFileSync(arquivo, 'utf8'), canonico(doc(2)))
    assert.deepEqual(degradacoes(casa), ['estado.carregar', 'estado.carregar', 'estado.gravar'])
  } finally {
    apagar(casa)
  }
})

test('escrita: banco e arquivo recebem o mesmo texto e a base acompanha', () => {
  const casa = casaNova()
  try {
    const texto = canonico(doc(2))
    gravar(casa, texto)
    assert.equal(readFileSync(arquivoDe(casa), 'utf8'), texto)
    assert.deepEqual(noBanco(casa), { sha: sha256(texto), base: sha256(texto) })
    assert.equal(comBancoDaCasa(casa, 'omni', (db) => recomporEstado(db, REL), {}), texto)
    assert.equal(carregar(casa), texto)
    assert.deepEqual(copias(casa, 'antes-da-casa'), [])
    assert.deepEqual(degradacoes(casa), [])
  } finally {
    apagar(casa)
  }
})

test('escrita fora da forma canônica: vai ao arquivo, não ao banco, e a degradação fica anotada', () => {
  const casa = casaNova()
  try {
    const compacta = JSON.stringify(doc(2))
    gravar(casa, compacta)
    assert.equal(readFileSync(arquivoDe(casa), 'utf8'), compacta)
    assert.equal(existsSync(arquivoDoBanco(casa, 'omni', {})), false)
    assert.deepEqual(degradacoes(casa), ['estado.gravar'])
  } finally {
    apagar(casa)
  }
})

test('falha de projeção: o banco fica à frente e a carga seguinte projeta', { skip: SO_NO_WINDOWS }, () => {
  const casa = casaNova()
  const arquivo = arquivoDe(casa)
  try {
    gravar(casa, canonico(doc(1)))
    chmodSync(arquivo, 0o444)
    gravar(casa, canonico(doc(2)))
    assert.equal(readFileSync(arquivo, 'utf8'), canonico(doc(1)))
    assert.deepEqual(noBanco(casa), { sha: sha256(canonico(doc(2))), base: sha256(canonico(doc(1))) })
    assert.deepEqual(degradacoes(casa), ['estado.projetar'])
    chmodSync(arquivo, 0o666)
    assert.equal(carregar(casa), canonico(doc(2)))
    assert.equal(readFileSync(arquivo, 'utf8'), canonico(doc(2)))
    assert.deepEqual(noBanco(casa), { sha: sha256(canonico(doc(2))), base: sha256(canonico(doc(2))) })
  } finally {
    if (existsSync(arquivo)) chmodSync(arquivo, 0o666)
    apagar(casa)
  }
})

test('fora do catálogo p2: estado desconhecido, espelho ou nome herdado de Object é recusado', () => {
  const casa = casaNova()
  try {
    for (const rel of ['learning/inventado.json', 'feedback/personality-continuity.json', 'constructor', '__proto__']) {
      assert.throws(() => carregarTextoDoEstado(casa, rel, { ...AVALIACAO, env: {} }), /fora do catálogo p2/)
      assert.throws(() => gravarTextoDoEstado(casa, rel, canonico(doc(1)), { env: {} }), /fora do catálogo p2/)
    }
    assert.deepEqual(readdirSync(casa), [])
  } finally {
    apagar(casa)
  }
})

test('varredura em casa vazia: nada a importar, sem banco e sem pasta feedback', async () => {
  const casa = casaNova()
  try {
    assert.deepEqual(await reconciliarEstados(casa, { env: {} }), {
      resultado: 'feita',
      arquivos: {
        'learning/failures.json': 'sem-arquivo',
        'learning/failure-automation.json': 'sem-arquivo',
        'learning/self-improvement.json': 'sem-arquivo',
        'learning/shortcuts.json': 'sem-arquivo',
        'learning/evolution-receipts.json': 'sem-arquivo',
        'feedback/personality-feedback.json': 'sem-arquivo',
        'feedback/personality-continuity.json': 'vazia',
        'feedback/personality-owner-directions.json': 'vazia'
      }
    })
    assert.deepEqual(readdirSync(casa), [])
    assert.deepEqual(await reconciliarEstados(casa, { env: { OMNI_CASA_SEM_SQLITE: '1' } }), { resultado: 'sem-banco', arquivos: {} })
  } finally {
    apagar(casa)
  }
})

test('varredura p2: importa o que falta uma vez só e deixa o quebrado como está', async () => {
  const casa = casaNova()
  try {
    const fonte = JSON.stringify(doc(2))
    const arquivo = semear(casa, fonte)
    const quebrado = semear(casa, 'xx{', 'learning/failures.json')
    const primeira = await reconciliarEstados(casa, { env: {} })
    assert.equal(primeira.arquivos[REL], 'importada')
    assert.equal(primeira.arquivos['learning/failures.json'], 'intocada')
    assert.ok(intocado(arquivo))
    assert.ok(intocado(quebrado))
    const sha = sha256(canonico(doc(2)))
    assert.deepEqual(noBanco(casa), { sha, base: sha })
    assert.deepEqual(noBanco(casa, 'learning/failures.json'), { sha: null, base: null })
    const segunda = await reconciliarEstados(casa, { env: {} })
    assert.equal(segunda.arquivos[REL], 'presente')
    assert.equal(segunda.arquivos['learning/failures.json'], 'intocada')
    assert.equal(copias(casa, 'antes-da-casa').length, 1)
    assert.deepEqual(copias(casa, 'antes-da-casa', 'learning/failures.json'), [])
    assert.deepEqual(degradacoes(casa), [])
  } finally {
    apagar(casa)
  }
})

test('espelho: a loja TS de continuidade e o banco andam juntos', async () => {
  const casa = casaNova()
  const rel = 'feedback/personality-continuity.json'
  const arquivo = arquivoDe(casa, rel)
  const varrer = async () => (await reconciliarEstados(casa, { env: {} })).arquivos[rel]
  try {
    await observePersonalityContinuity(casa, 'Sua personalidade não está constante.', '2026-11-05T00:00:00.000Z')
    assert.equal(await varrer(), 'importada')
    assert.equal(await varrer(), 'atual')
    const duas = canonico({
      schemaVersion: 1,
      observations: [
        { fingerprint: 'a'.repeat(64), recordedAt: '2026-11-05T00:00:00.000Z' },
        { fingerprint: 'b'.repeat(64), recordedAt: '2026-11-05T00:00:01.000Z' }
      ]
    })
    writeFileSync(arquivo, duas)
    assert.equal(await varrer(), 'ingerida')
    assert.equal(comBancoDaCasa(casa, 'omni', (db) => recomporEstado(db, rel), {}), duas)
    rmSync(arquivo)
    assert.equal(await varrer(), 'projetada')
    assert.equal(readFileSync(arquivo, 'utf8'), duas)
    writeFileSync(arquivo, 'xx{')
    await assert.rejects(readPersonalityContinuity(casa))
    assert.equal(await varrer(), 'socorrida')
    assert.deepEqual(await readPersonalityContinuity(casa), ['maintain-personality-continuity'])
    assert.equal(copias(casa, 'invalida', rel).length, 1)
    assert.deepEqual(degradacoes(casa), ['estado.arquivo-invalido'])
  } finally {
    apagar(casa)
  }
})

test('varredura com pasta no lugar do arquivo: o estado degrada e os outros seguem', async () => {
  const casa = casaNova()
  try {
    mkdirSync(arquivoDe(casa, 'learning/failures.json'), { recursive: true })
    mkdirSync(arquivoDe(casa, 'feedback/personality-continuity.json'), { recursive: true })
    semear(casa, canonico(doc(1)))
    const { resultado, arquivos } = await reconciliarEstados(casa, { env: {} })
    assert.equal(resultado, 'feita')
    assert.equal(arquivos['learning/failures.json'], 'degradada')
    assert.equal(arquivos['feedback/personality-continuity.json'], 'degradada')
    assert.equal(arquivos[REL], 'importada')
    assert.deepEqual(degradacoes(casa), ['estados.varredura', 'estado.espelho'])
  } finally {
    apagar(casa)
  }
})
```

```powershell
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so testes/estados.test.mjs
```

Esperado: `gravado testes/estados.test.mjs`.

Resultado (05/11): `gravado testes/estados.test.mjs`.

- [x] **Passo 2: ver o vermelho.**

```powershell
node --test --test-concurrency=1 --test-reporter=spec testes/estados.test.mjs *> "$rascunho\t3-vermelho.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t3-vermelho.txt" -Pattern '(tests|pass|fail) \d+\s*$', 'ERR_MODULE_NOT_FOUND'
```

Esperado: saída 1. O arquivo não carrega (`ERR_MODULE_NOT_FOUND` de `runtime/estados.mjs`), e o `node --test` conta isso como uma falha.

Resultado (05/11): igual ao esperado: 1 teste, 0 verdes e 1 vermelho, com o `ERR_MODULE_NOT_FOUND` de `runtime/estados.mjs`, em 0,17 s.

- [x] **Passo 3: a ponte.**

```js arquivo=runtime/estados.mjs
// Ponte entre os donos dos estados de aprendizado e feedback e o omni.db (plano 3 da F1).
// Os seis módulos JS (modo p2) carregam e gravam por aqui. A loja TS do dist (modo espelho) segue
// no arquivo, e a varredura a acompanha. Quem vence entre arquivo e banco sai da tabela de decisão
// do plano, sempre dentro do BEGIN IMMEDIATE, com o arquivo lido sob a trava do banco (desvio 16).
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { acquireLocalFileLock } from '../dist/adapters/local-json/node-local-file-lock.js'
import { arquivoDoBanco, comBancoDaCasa, registrarDegradacao, sha256, sqliteDisponivel, transacao } from './casa/banco.mjs'
import {
  CATALOGO,
  baseNoDisco,
  confirmarEstadoNoDisco,
  docCanonico,
  escreverEstado,
  importarEstado,
  recomporEstado,
  shaDoEstado
} from './casa/loja-estados.mjs'
import { escreverAtomico, lerSeExistir } from './casa/projecao.mjs'

// Contrato v1 da loja TS de continuidade (dist/adapters/local-json/personality-continuity-store.js).
const VERSAO_DO_ESPELHO = 1

const carimbo = () => new Date().toISOString().replace(/[^0-9]/g, '')

function objetoSimples(valor) {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor)
}

// CATALOGO[rel]?.modo: 'constructor' e '__proto__' dão undefined e são recusados.
function caminhoDoEstado(casa, rel, modo) {
  if (CATALOGO[rel]?.modo !== modo) throw new Error(`Estado fora do catálogo ${modo}: ${rel}`)
  return join(casa, ...rel.split('/'))
}

// Estrutura mínima de um estado: objeto JSON com schemaVersion inteiro.
export function avaliarEstrutura(texto) {
  try {
    const doc = JSON.parse(texto)
    return objetoSimples(doc) && Number.isInteger(doc.schemaVersion)
  } catch {
    return false
  }
}

// quebrada | futura | fora-do-contrato | ok. Versão menor é ok: o dono migra.
export function avaliarTexto(texto, { versao, validar }) {
  let doc
  try {
    doc = JSON.parse(texto)
  } catch {
    return 'quebrada'
  }
  if (!objetoSimples(doc) || !Number.isInteger(doc.schemaVersion)) return 'quebrada'
  if (doc.schemaVersion > versao) return 'futura'
  if (doc.schemaVersion < versao) return 'ok'
  try {
    validar(doc) // o doc não volta a ser usado: o validador do dono pode mexer nele
  } catch {
    return 'fora-do-contrato'
  }
  return 'ok'
}

function validarEspelho(doc) {
  if (Object.keys(doc).sort().join(',') !== 'observations,schemaVersion' || doc.schemaVersion !== VERSAO_DO_ESPELHO ||
      !Array.isArray(doc.observations) || doc.observations.length > 100) {
    throw new Error('Espelho de personalidade fora do contrato v1.')
  }
}

// A tabela de decisão do plano. Roda dentro do BEGIN IMMEDIATE e não toca o disco: devolve o plano
// { acao, devolver, projetar?, copia? } para reconciliar executar.
function decidir(db, rel, fonte, avaliacao) {
  const noBanco = shaDoEstado(db, rel)
  if (noBanco === null) {
    if (fonte === null) return { acao: 'vazia', devolver: null }
    if (avaliarTexto(fonte, avaliacao) !== 'ok') return { acao: 'intocada', devolver: fonte }
    importarEstado(db, rel, fonte)
    return { acao: 'importada', devolver: fonte, copia: 'antes-da-casa' }
  }
  if (fonte === null) return { acao: 'projetada', devolver: recomporEstado(db, rel), projetar: true }
  const base = baseNoDisco(db, rel)
  if (sha256(fonte) === noBanco) {
    if (base !== noBanco) confirmarEstadoNoDisco(db, rel, noBanco)
    return { acao: 'atual', devolver: fonte }
  }
  const situacao = avaliarTexto(fonte, avaliacao)
  if (situacao === 'quebrada') {
    const texto = recomporEstado(db, rel)
    return avaliarTexto(texto, avaliacao) === 'ok'
      ? { acao: 'socorrida', devolver: texto, projetar: true, copia: 'invalida' }
      : { acao: 'intocada', devolver: fonte }
  }
  const doc = JSON.parse(fonte)
  const canonica = `${JSON.stringify(doc, null, 2)}\n`
  const shaCanonica = sha256(canonica)
  if (shaCanonica === noBanco) {
    if (base !== noBanco) confirmarEstadoNoDisco(db, rel, noBanco)
    return { acao: 'atual', devolver: fonte }
  }
  if (shaCanonica === base) return { acao: 'defasada', devolver: recomporEstado(db, rel), projetar: true }
  if (situacao !== 'ok') return { acao: 'intocada', devolver: fonte } // futura ou fora do contrato
  escreverEstado(db, rel, doc, canonica)
  confirmarEstadoNoDisco(db, rel, shaCanonica)
  return { acao: 'ingerida', devolver: fonte }
}

function copiar(casa, destino, texto, env) {
  try {
    writeFileSync(destino, texto, { flag: 'wx' })
    return true
  } catch (erro) {
    registrarDegradacao(casa, 'estado.copia', erro, env)
    return false
  }
}

function projetar(casa, db, rel, arquivo, texto, env) {
  try {
    escreverAtomico(arquivo, texto)
  } catch (erro) {
    registrarDegradacao(casa, 'estado.projetar', erro, env)
    return
  }
  confirmarEstadoNoDisco(db, rel, sha256(texto))
}

// Tudo dentro do BEGIN IMMEDIATE: o arquivo é lido, decidido, copiado e projetado com a trava do
// banco na mão, para nenhuma escrita de outro processo cair entre a leitura e a decisão (desvio 16).
function reconciliar(casa, db, rel, arquivo, avaliacao, env) {
  const fonte = lerSeExistir(arquivo)
  const plano = decidir(db, rel, fonte, avaliacao)
  if (plano.copia === 'antes-da-casa') copiar(casa, `${arquivo}.antes-da-casa.${carimbo()}`, fonte, env)
  if (plano.copia === 'invalida') {
    // Sem cópia, sem socorro (desvio 13).
    if (!copiar(casa, `${arquivo}.invalida.${carimbo()}`, fonte, env)) return { acao: 'intocada', devolver: fonte }
    registrarDegradacao(casa, 'estado.arquivo-invalido', new Error(`${rel} quebrado no disco; cópia guardada e o banco assumiu.`), env)
  }
  if (plano.projetar) projetar(casa, db, rel, arquivo, plano.devolver, env)
  return plano
}

// Carga de um estado p2, sob a trava do dono. Devolve o texto que o dono deve interpretar, ou null
// quando não há estado em lugar nenhum.
export function carregarTextoDoEstado(casa, rel, { versao, validar, env = process.env } = {}) {
  const arquivo = caminhoDoEstado(casa, rel, 'p2')
  const fonte = lerSeExistir(arquivo) // EISDIR e afins sobem antes de abrir o banco
  if (!sqliteDisponivel(env)) return fonte
  if (fonte === null && !existsSync(arquivoDoBanco(casa, 'omni', env))) return null // não cria banco à toa
  try {
    return comBancoDaCasa(casa, 'omni', (db) =>
      transacao(db, () => reconciliar(casa, db, rel, arquivo, { versao, validar }, env)).devolver, env)
  } catch (erro) {
    registrarDegradacao(casa, 'estado.carregar', erro, env)
    if (fonte === null) throw new Error(`Estado ${rel} sem arquivo e sem leitura do banco: recusa começar vazio.`, { cause: erro })
    return fonte
  }
}

// Escrita de um estado p2, sob a trava do dono: banco, arquivo e base na mesma transação.
export function gravarTextoDoEstado(casa, rel, texto, { env = process.env } = {}) {
  const arquivo = caminhoDoEstado(casa, rel, 'p2')
  if (!sqliteDisponivel(env)) {
    escreverAtomico(arquivo, texto)
    return
  }
  let noDisco = false
  try {
    const doc = docCanonico(rel, texto)
    comBancoDaCasa(casa, 'omni', (db) => transacao(db, () => {
      escreverEstado(db, rel, doc, texto)
      try {
        escreverAtomico(arquivo, texto)
      } catch (erro) {
        registrarDegradacao(casa, 'estado.projetar', erro, env)
        return
      }
      noDisco = true
      confirmarEstadoNoDisco(db, rel, sha256(texto))
    }), env)
  } catch (erro) {
    registrarDegradacao(casa, 'estado.gravar', erro, env)
    if (!noDisco) escreverAtomico(arquivo, texto)
  }
}

// Varredura dos oito estados: os p2 só importam o que não tem linha; os espelhos rodam a decisão
// inteira sob a trava da loja TS. Falha num estado degrada só ele.
export async function reconciliarEstados(casa, { env = process.env } = {}) {
  if (!sqliteDisponivel(env)) return { resultado: 'sem-banco', arquivos: {} }
  const arquivos = {}
  for (const [rel, { modo }] of Object.entries(CATALOGO)) {
    try {
      arquivos[rel] = modo === 'p2' ? importarSeAusente(casa, rel, env) : await espelhar(casa, rel, env)
    } catch (erro) {
      registrarDegradacao(casa, modo === 'p2' ? 'estados.varredura' : 'estado.espelho', erro, env)
      arquivos[rel] = 'degradada'
    }
  }
  return { resultado: 'feita', arquivos }
}

function importarSeAusente(casa, rel, env) {
  const arquivo = caminhoDoEstado(casa, rel, 'p2')
  if (!existsSync(arquivo)) return 'sem-arquivo'
  return comBancoDaCasa(casa, 'omni', (db) => transacao(db, () => {
    if (shaDoEstado(db, rel) !== null) return 'presente'
    const fonte = lerSeExistir(arquivo)
    if (fonte === null) return 'sem-arquivo'
    if (!avaliarEstrutura(fonte)) return 'intocada'
    const feito = importarEstado(db, rel, fonte)
    if (feito === 'importada') copiar(casa, `${arquivo}.antes-da-casa.${carimbo()}`, fonte, env)
    return feito
  }), env)
}

function linhaNoBanco(casa, rel, env) {
  return existsSync(arquivoDoBanco(casa, 'omni', env)) &&
    comBancoDaCasa(casa, 'omni', (db) => shaDoEstado(db, rel) !== null, env)
}

async function espelhar(casa, rel, env) {
  const arquivo = caminhoDoEstado(casa, rel, 'espelho')
  // Sem arquivo e sem linha não há o que espelhar, e a trava criaria a pasta feedback/ à toa.
  if (lerSeExistir(arquivo) === null && !linhaNoBanco(casa, rel, env)) return 'vazia'
  const trava = await acquireLocalFileLock(`${arquivo}.lock`, {}) // a mesma trava e as mesmas opções da loja TS
  try {
    const avaliacao = { versao: VERSAO_DO_ESPELHO, validar: validarEspelho }
    return comBancoDaCasa(casa, 'omni', (db) =>
      transacao(db, () => reconciliar(casa, db, rel, arquivo, avaliacao, env)).acao, env)
  } finally {
    await trava.release()
  }
}
```

```powershell
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so runtime/estados.mjs
```

Esperado: `gravado runtime/estados.mjs`.

Resultado (05/11): `gravado runtime/estados.mjs`.

- [x] **Passo 4: ver o verde.**

```powershell
node --test --test-concurrency=1 --test-reporter=spec testes/estados.test.mjs *> "$rascunho\t3-verde.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t3-verde.txt" -Pattern '(tests|pass|fail|skipped) \d+\s*$'
```

Esperado: saída 0, `tests 23`, `pass 23`, `fail 0` e `skipped 0` no Windows. No Linux, o teste da falha de projeção pula (`pass 22`, `skipped 1`).

Resultado (05/11): igual ao esperado no Windows: 23 de 23, em 4,3 s. O caso do Linux não roda aqui nem na CI (item 17).

- [x] **Passo 5: finais de linha e guarda.**

```powershell
foreach ($f in 'runtime\estados.mjs', 'testes\estados.test.mjs') { $f + ': ' + ([IO.File]::ReadAllBytes((Resolve-Path $f)) | Where-Object { $_ -eq 13 }).Count }
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `0` nos dois arquivos e `False`.

Resultado (05/11): `0` nos dois arquivos e `False`.

### Task 4: os seis donos pela ponte

**Arquivos:** criar `testes/estados-modulos.test.mjs` (EM, 8 testes); modificar `runtime/falhas.mjs`, `runtime/automacao-falhas.mjs`, `runtime/autoaperfeicoamento.mjs`, `runtime/atalhos.mjs`, `runtime/recibos-evolucao.mjs`, `runtime/feedback-personalidade.mjs` e `testes/feedback-personalidade.test.mjs` (FP 239). Cada dono mantém a trava, o validador e as migrações de esquema; só a carga e a escrita trocam o `readFile` e o `rename` pela ponte. `lerFalhas` e `lerAtalhos` carregam sob a trava e passam pela ponte; os leitores puros do desvio 8 não mudam. O EM prova cada dono em duas voltas. Na primeira, a escrita passa pelo `omni.db`: o hash do banco e a base batem com o arquivo. Na segunda, com o arquivo quebrado (`xx{`), a carga do dono socorre pelo banco (uma cópia `.invalida.` e a degradação `estado.arquivo-invalido`) e o dono segue. Os dois últimos testes provam a trava nova dos recibos (desvio 15): presa, a escrita espera; velha, a escrita a apaga e segue. As seis suítes dos donos somam 63 testes antes e depois; só o FP 239 muda, porque a casa do teste ganha a pasta `casa` do banco. Os sete arquivos modificados estão em CRLF no disco desta máquina e passam a LF antes das trocas (item 13 do executor).

- [x] **Passo 1: o EM.** Os donos não recebem `env`: chamam a ponte com `process.env`, e o EM olha o banco com o mesmo `env`. Sem `node:sqlite` (ou com `OMNI_CASA_SEM_SQLITE=1`), os seis testes de dono pulam; os dois da trava rodam sempre.

```js arquivo=testes/estados-modulos.test.mjs
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import test from 'node:test'

import { prepararAtalhos } from '../runtime/atalhos.mjs'
import { lerAutoaperfeicoamento } from '../runtime/autoaperfeicoamento.mjs'
import { sincronizarAutomacaoFalhas } from '../runtime/automacao-falhas.mjs'
import { arquivoDoBanco, comBancoDaCasa, pastaDoBanco, sha256, sqliteDisponivel } from '../runtime/casa/banco.mjs'
import { baseNoDisco, shaDoEstado } from '../runtime/casa/loja-estados.mjs'
import { lerSeExistir } from '../runtime/casa/projecao.mjs'
import { registrarFalha } from '../runtime/falhas.mjs'
import { registrarUltimaRespostaPersonalidade } from '../runtime/feedback-personalidade.mjs'
import { registrarRecibo } from '../runtime/recibos-evolucao.mjs'

// Os donos chamam a ponte com process.env, sem como receber outro; o teste olha o banco com o
// mesmo env, e numa casa temporária a pasta do banco é <casa>\casa.
const ENV = process.env
const ANTIGO = new Date('2020-01-01T00:00:00Z')
const SEM_SQLITE = !sqliteDisponivel(ENV) && 'Node sem node:sqlite: a ponte fica só no arquivo'
const RECIBO = { kind: 'procedure', summary: 'procedimento valido', reason: 'motivo', revert: { strategy: 'contract-revert', ref: 'c1' } }
const IDENTIDADE = { personaId: 'omni-persona-v3-candidate', releaseFingerprint: 'a'.repeat(64) }
const casaNova = () => mkdtempSync(join(tmpdir(), 'omni-estados-modulos-'))
const apagar = (casa) => rmSync(casa, { recursive: true, force: true })
const arquivoDe = (casa, rel) => join(casa, ...rel.split('/'))
function degradacoes(casa) {
  const texto = lerSeExistir(join(pastaDoBanco(casa, ENV), 'degradacoes.jsonl'))
  return texto === null ? [] : texto.trim().split('\n').map((linha) => JSON.parse(linha).operacao)
}
const noBanco = (casa, rel) =>
  comBancoDaCasa(casa, 'omni', (db) => ({ sha: shaDoEstado(db, rel), base: baseNoDisco(db, rel) }), ENV)

// Primeira volta: a escrita do dono passa pelo omni.db (hash do banco e base iguais ao arquivo).
// Segunda volta: com o arquivo quebrado, a carga do dono socorre pelo banco e o dono segue.
async function provarModulo(rel, escrever) {
  const casa = casaNova()
  try {
    await escrever(casa)
    const arquivo = arquivoDe(casa, rel)
    assert.ok(existsSync(arquivoDoBanco(casa, 'omni', ENV)), 'o dono gravou sem passar pelo omni.db')
    const primeiro = noBanco(casa, rel)
    assert.equal(primeiro.sha, sha256(readFileSync(arquivo, 'utf8')))
    assert.equal(primeiro.base, primeiro.sha)
    writeFileSync(arquivo, 'xx{')
    await escrever(casa)
    const texto = readFileSync(arquivo, 'utf8')
    assert.doesNotThrow(() => JSON.parse(texto))
    const depois = noBanco(casa, rel)
    assert.equal(depois.sha, sha256(texto))
    assert.equal(depois.base, depois.sha)
    const prefixo = `${basename(arquivo)}.invalida.`
    assert.equal(readdirSync(dirname(arquivo)).filter((nome) => nome.startsWith(prefixo)).length, 1)
    assert.ok(degradacoes(casa).includes('estado.arquivo-invalido'))
  } finally {
    apagar(casa)
  }
}

test('falhas: registrarFalha grava pelo omni.db e socorre o arquivo quebrado', { skip: SEM_SQLITE }, async () => {
  let n = 0
  await provarModulo('learning/failures.json', (casa) => registrarFalha(casa, {
    agent: 'omni',
    action: 'consultar disponibilidade do banco',
    failureClass: 'dependency',
    signature: 'ECONNREFUSED ao abrir conexao do Postgres',
    evidenceId: `em-${++n}`
  }))
})

test('automação de falhas: sincronizarAutomacaoFalhas grava pelo omni.db e socorre o arquivo quebrado', { skip: SEM_SQLITE }, () =>
  provarModulo('learning/failure-automation.json', (casa) => sincronizarAutomacaoFalhas(casa)))

test('autoaperfeiçoamento: lerAutoaperfeicoamento grava pelo omni.db e socorre o arquivo quebrado', { skip: SEM_SQLITE }, () =>
  provarModulo('learning/self-improvement.json', (casa) => lerAutoaperfeicoamento(casa)))

test('atalhos: prepararAtalhos grava pelo omni.db e socorre o arquivo quebrado', { skip: SEM_SQLITE }, () =>
  provarModulo('learning/shortcuts.json', (casa) => prepararAtalhos(casa)))

test('recibos: registrarRecibo grava pelo omni.db e socorre o arquivo quebrado', { skip: SEM_SQLITE }, () =>
  provarModulo('learning/evolution-receipts.json', (casa) => registrarRecibo(casa, RECIBO)))

test('feedback: registrarUltimaRespostaPersonalidade grava pelo omni.db e socorre o arquivo quebrado', { skip: SEM_SQLITE }, () =>
  provarModulo('feedback/personality-feedback.json', (casa) =>
    registrarUltimaRespostaPersonalidade(casa, { sessionId: 'sessao-em', answer: 'resposta do omni', ...IDENTIDADE })))

test('recibos: a escrita espera a trava presa', async () => {
  const casa = casaNova()
  try {
    const trava = join(casa, 'learning', 'evolution-receipts.lock')
    mkdirSync(dirname(trava), { recursive: true })
    writeFileSync(trava, '')
    let terminou = false
    const escrita = registrarRecibo(casa, RECIBO).then((recibo) => { terminou = true; return recibo })
    await new Promise((resolver) => setTimeout(resolver, 150))
    assert.equal(terminou, false, 'registrarRecibo passou por cima da trava')
    rmSync(trava)
    const recibo = await escrita
    assert.equal(existsSync(trava), false, 'a trava ficou no disco depois da escrita')
    const store = JSON.parse(readFileSync(join(casa, 'learning', 'evolution-receipts.json'), 'utf8'))
    assert.deepEqual(store.receipts.map((item) => item.id), [recibo.id])
  } finally {
    apagar(casa)
  }
})

test('recibos: trava velha é apagada e a escrita segue', async () => {
  const casa = casaNova()
  try {
    const trava = join(casa, 'learning', 'evolution-receipts.lock')
    mkdirSync(dirname(trava), { recursive: true })
    writeFileSync(trava, '')
    utimesSync(trava, ANTIGO, ANTIGO)
    await assert.doesNotReject(registrarRecibo(casa, RECIBO))
    assert.equal(existsSync(trava), false, 'a trava velha ficou no disco')
  } finally {
    apagar(casa)
  }
})
```

```powershell
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so testes/estados-modulos.test.mjs
```

Esperado: `gravado testes/estados-modulos.test.mjs`.

Resultado (05/11): `gravado testes/estados-modulos.test.mjs`.

- [x] **Passo 2: ver o vermelho e medir a linha de base.** A base sai antes de qualquer troca.

```powershell
node --test --test-concurrency=1 --test-reporter=spec testes/estados-modulos.test.mjs *> "$rascunho\t4-vermelho.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t4-vermelho.txt" -Pattern '(tests|pass|fail|skipped) \d+\s*$'
Select-String -Path "$rascunho\t4-vermelho.txt" -Pattern 'o dono gravou sem passar pelo omni.db|passou por cima da trava|a trava velha ficou no disco' | ForEach-Object { $_.Line.Trim() } | Sort-Object -Unique
$donos = 'falhas', 'automacao-falhas', 'autoaperfeicoamento', 'atalhos', 'recibos-evolucao', 'feedback-personalidade'
foreach ($s in $donos) {
  node --test --test-concurrency=1 --test-reporter=spec "testes/$s.test.mjs" *> "$rascunho\t4-base-$s.txt"; "$s saida: $LASTEXITCODE"
  Select-String -Path "$rascunho\t4-base-$s.txt" -Pattern '(tests|pass|fail|skipped) \d+\s*$'
}
```

Esperado no EM: saída 1, `tests 8`, `pass 0`, `fail 8` e `skipped 0`, e três linhas únicas, uma por mensagem: os seis testes de dono caem em `o dono gravou sem passar pelo omni.db`, a trava presa em `registrarRecibo passou por cima da trava` e a velha em `a trava velha ficou no disco`. Na base: falhas 13, automacao-falhas 12, autoaperfeicoamento 8, atalhos 8, recibos-evolucao 7 e feedback-personalidade 15, 63 ao todo, todas com `fail 0`, `skipped 0` e saída 0.

Resultado (05/11): igual ao esperado. No EM, 8 testes, 0 verdes e 8 vermelhos, com as três mensagens: seis vezes `o dono gravou sem passar pelo omni.db`, uma `registrarRecibo passou por cima da trava` e uma `a trava velha ficou no disco`. Na base, 13, 12, 8, 8, 7 e 15, 63 ao todo, todos verdes.

- [x] **Passo 3: os finais de linha.** Os sete arquivos modificados passam a LF sem BOM antes das trocas, para que os trechos do Passo 4 casem byte a byte. O conteúdo não muda.

```powershell
$lf = 'runtime/falhas.mjs', 'runtime/automacao-falhas.mjs', 'runtime/autoaperfeicoamento.mjs', 'runtime/atalhos.mjs', 'runtime/recibos-evolucao.mjs', 'runtime/feedback-personalidade.mjs', 'testes/feedback-personalidade.test.mjs'
foreach ($f in $lf) {
  $b = [IO.File]::ReadAllBytes((Resolve-Path $f))
  if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { throw "$f tem BOM" }
  [IO.File]::WriteAllText((Resolve-Path $f), [Text.Encoding]::UTF8.GetString($b).Replace("`r`n", "`n"), (New-Object Text.UTF8Encoding $false))
}
git diff --stat -- $lf 2>&1 | ForEach-Object { "$_" }
```

Esperado: nenhuma linha de estatística, só os avisos `LF will be replaced by CRLF`. O repositório já guarda esses arquivos em LF.

Resultado (05/11): nenhuma linha de estatística, só os avisos de LF.

- [x] **Passo 4: as trocas.** Todo trecho é único no seu arquivo, salvo onde se diz o contrário.

**(a) `runtime/falhas.mjs`.** Trocar o trecho único

```js
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { lerAuditoriaAutocorrecao } from './auditoria-autocorrecao.mjs'
import { pareceConterSegredo } from './memoria.mjs'
```

por

```js
import { mkdir, open, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { lerAuditoriaAutocorrecao } from './auditoria-autocorrecao.mjs'
import { carregarTextoDoEstado, gravarTextoDoEstado } from './estados.mjs'
import { pareceConterSegredo } from './memoria.mjs'
```

e o trecho único do `load` e do `save`

```js
async function load(casa, policy) {
  const path = caminhoDasFalhas(casa)
  try {
    const raw = await readFile(path, 'utf8')
    let store = JSON.parse(raw)
    if (store.schemaVersion > FAILURE_STORE_SCHEMA_VERSION) {
      throw new Error(`Aprendizado de falhas v${store.schemaVersion} é mais novo que este plugin.`)
    }
    if ([1, 2, 3, 4, 5].includes(store.schemaVersion)) {
      await backupBeforeMigration(path, raw, store.schemaVersion)
      if (store.schemaVersion === 1) store = migrateV1(store)
      if (store.schemaVersion === 2) store = migrateV2(store)
      if (store.schemaVersion === 3) store = migrateV3(store)
      if (store.schemaVersion === 4) store = migrateV4(store)
      if (store.schemaVersion === 5) store = migrateV5(store)
    }
    validateStore(store, path, policy)
    return { store, initialized: false, migrated: store.schemaVersion !== JSON.parse(raw).schemaVersion }
  } catch (error) {
    if (error?.code === 'ENOENT') return { store: emptyStore(), initialized: true }
    throw error
  }
}

async function save(casa, store, policy) {
  const path = caminhoDasFalhas(casa)
  const temporary = `${path}.${process.pid}.novo`
  store.store.updatedAt = now()
  validateStore(store, path, policy)
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}
```

por

```js
// Carga sob a trava (acquireLock), pela ponte do omni.db. Sem estado em lugar nenhum, a ponte
// devolve null e o dono começa vazio; a migração de esquema segue aqui, com o backup.
async function load(casa, policy) {
  const path = caminhoDasFalhas(casa)
  const raw = carregarTextoDoEstado(casa, 'learning/failures.json', {
    versao: FAILURE_STORE_SCHEMA_VERSION,
    validar: (doc) => validateStore(doc, path, policy)
  })
  if (raw === null) return { store: emptyStore(), initialized: true }
  let store = JSON.parse(raw)
  if (store.schemaVersion > FAILURE_STORE_SCHEMA_VERSION) {
    throw new Error(`Aprendizado de falhas v${store.schemaVersion} é mais novo que este plugin.`)
  }
  if ([1, 2, 3, 4, 5].includes(store.schemaVersion)) {
    await backupBeforeMigration(path, raw, store.schemaVersion)
    if (store.schemaVersion === 1) store = migrateV1(store)
    if (store.schemaVersion === 2) store = migrateV2(store)
    if (store.schemaVersion === 3) store = migrateV3(store)
    if (store.schemaVersion === 4) store = migrateV4(store)
    if (store.schemaVersion === 5) store = migrateV5(store)
  }
  validateStore(store, path, policy)
  return { store, initialized: false, migrated: store.schemaVersion !== JSON.parse(raw).schemaVersion }
}

// Escrita pela ponte: banco, arquivo e base na mesma transação.
async function save(casa, store, policy) {
  const path = caminhoDasFalhas(casa)
  store.store.updatedAt = now()
  validateStore(store, path, policy)
  gravarTextoDoEstado(casa, 'learning/failures.json', `${JSON.stringify(store, null, 2)}\n`)
}
```

**(b) `runtime/automacao-falhas.mjs`.** Trocar o trecho único

```js
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
```

por

```js
import { mkdir, open, readFile, stat, unlink, writeFile } from 'node:fs/promises'
```

o trecho único

```js
import { lerAuditoriaAutocorrecao } from './auditoria-autocorrecao.mjs'
```

por

```js
import { lerAuditoriaAutocorrecao } from './auditoria-autocorrecao.mjs'
import { carregarTextoDoEstado, gravarTextoDoEstado } from './estados.mjs'
```

o trecho único do `load`

```js
async function load(casa) {
  const path = caminhoDaAutomacaoFalhas(casa)
  try {
    const raw = await readFile(path, 'utf8')
    let store = JSON.parse(raw)
    if (store.schemaVersion > FAILURE_AUTOMATION_SCHEMA_VERSION) {
      throw new Error(`Automação de falhas v${store.schemaVersion} é mais nova que este plugin.`)
    }
    if ([1, 2, 3].includes(store.schemaVersion)) {
      await backupBeforeMigration(path, raw, store.schemaVersion)
      store = migrateLegacy(store)
    }
    if (store.schemaVersion === 4) {
      // Version boundary prevents an old hook from dispatching a diagnostic job
      // with the pre-v5 execute envelope. Existing attempts/bindings stay intact.
      await backupBeforeMigration(path, raw, 4)
      store = { ...store, schemaVersion: FAILURE_AUTOMATION_SCHEMA_VERSION }
    }
    validateStore(store, path)
    return store
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyStore()
    throw error
  }
}
```

por

```js
// Carga sob a trava (lock), pela ponte do omni.db; lerAutomacaoFalhas segue no arquivo (desvio 8).
async function load(casa) {
  const path = caminhoDaAutomacaoFalhas(casa)
  const raw = carregarTextoDoEstado(casa, 'learning/failure-automation.json', {
    versao: FAILURE_AUTOMATION_SCHEMA_VERSION,
    validar: (doc) => validateStore(doc, path)
  })
  if (raw === null) return emptyStore()
  let store = JSON.parse(raw)
  if (store.schemaVersion > FAILURE_AUTOMATION_SCHEMA_VERSION) {
    throw new Error(`Automação de falhas v${store.schemaVersion} é mais nova que este plugin.`)
  }
  if ([1, 2, 3].includes(store.schemaVersion)) {
    await backupBeforeMigration(path, raw, store.schemaVersion)
    store = migrateLegacy(store)
  }
  if (store.schemaVersion === 4) {
    // Version boundary prevents an old hook from dispatching a diagnostic job
    // with the pre-v5 execute envelope. Existing attempts/bindings stay intact.
    await backupBeforeMigration(path, raw, 4)
    store = { ...store, schemaVersion: FAILURE_AUTOMATION_SCHEMA_VERSION }
  }
  validateStore(store, path)
  return store
}
```

e o trecho único do `save`

```js
async function save(casa, store) {
  const path = caminhoDaAutomacaoFalhas(casa)
  const temporary = `${path}.${process.pid}.novo`
  store.store.updatedAt = now()
  validateStore(store, path)
  await mkdir(join(casa, 'learning'), { recursive: true })
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}
```

por

```js
// Escrita pela ponte: banco, arquivo e base na mesma transação.
async function save(casa, store) {
  const path = caminhoDaAutomacaoFalhas(casa)
  store.store.updatedAt = now()
  validateStore(store, path)
  gravarTextoDoEstado(casa, 'learning/failure-automation.json', `${JSON.stringify(store, null, 2)}\n`)
}
```

**(c) `runtime/autoaperfeicoamento.mjs`.** A linha 3, dos imports de `node:fs/promises`, não muda: os outros nomes seguem em uso fora do `gravar`. Trocar o trecho único

```js
import { lerAtalhos } from './atalhos.mjs'
import { lerFalhas } from './falhas.mjs'
```

por

```js
import { lerAtalhos } from './atalhos.mjs'
import { carregarTextoDoEstado, gravarTextoDoEstado } from './estados.mjs'
import { lerFalhas } from './falhas.mjs'
```

e o trecho único do `carregar` e do `gravar`

```js
async function carregar(casa, policy) {
  const path = caminhoDoAutoaperfeicoamento(casa)
  try {
    const store = JSON.parse(await readFile(path, 'utf8'))
    if (store.schemaVersion > SELF_IMPROVEMENT_SCHEMA_VERSION) {
      throw new Error(`Autoaperfeiçoamento v${store.schemaVersion} é mais novo que este plugin.`)
    }
    validarStore(store, path, policy)
    return { store, initialized: false }
  } catch (error) {
    if (error?.code === 'ENOENT') return { store: storeVazio(), initialized: true }
    throw error
  }
}

async function gravar(casa, store, policy) {
  const path = caminhoDoAutoaperfeicoamento(casa)
  const temporary = `${path}.${process.pid}.novo`
  store.store.updatedAt = agora()
  validarStore(store, path, policy)
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}
```

por

```js
// Carga sob a trava (adquirirTrava), pela ponte do omni.db.
async function carregar(casa, policy) {
  const path = caminhoDoAutoaperfeicoamento(casa)
  const texto = carregarTextoDoEstado(casa, 'learning/self-improvement.json', {
    versao: SELF_IMPROVEMENT_SCHEMA_VERSION,
    validar: (doc) => validarStore(doc, path, policy)
  })
  if (texto === null) return { store: storeVazio(), initialized: true }
  const store = JSON.parse(texto)
  if (store.schemaVersion > SELF_IMPROVEMENT_SCHEMA_VERSION) {
    throw new Error(`Autoaperfeiçoamento v${store.schemaVersion} é mais novo que este plugin.`)
  }
  validarStore(store, path, policy)
  return { store, initialized: false }
}

// Escrita pela ponte: banco, arquivo e base na mesma transação.
async function gravar(casa, store, policy) {
  const path = caminhoDoAutoaperfeicoamento(casa)
  store.store.updatedAt = agora()
  validarStore(store, path, policy)
  gravarTextoDoEstado(casa, 'learning/self-improvement.json', `${JSON.stringify(store, null, 2)}\n`)
}
```

**(d) `runtime/atalhos.mjs`.** Trocar o trecho único

```js
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { pareceConterSegredo } from './memoria.mjs'
import { lerAuditoriaAutocorrecao } from './auditoria-autocorrecao.mjs'
```

por

```js
import { mkdir, open, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { pareceConterSegredo } from './memoria.mjs'
import { lerAuditoriaAutocorrecao } from './auditoria-autocorrecao.mjs'
import { carregarTextoDoEstado, gravarTextoDoEstado } from './estados.mjs'
```

e o trecho único do `carregar` e do `gravar`

```js
async function carregar(casa, policy) {
  const path = caminhoDosAtalhos(casa)
  try {
    const source = await readFile(path, 'utf8')
    const parsed = JSON.parse(source)
    let store = parsed.schemaVersion === 1 ? migrarV1(source, policy) : parsed
    if (store.schemaVersion === 2) store = migrarV2(store)
    if (store.schemaVersion === 3) store = migrarV3(store)
    if (store.schemaVersion > SHORTCUT_STORE_SCHEMA_VERSION) {
      throw new Error(`Aprendizado v${store.schemaVersion} é mais novo que este plugin.`)
    }
    validarStore(store, path)
    return {
      store,
      initialized: false,
      migratedFrom: parsed.schemaVersion < SHORTCUT_STORE_SCHEMA_VERSION ? parsed.schemaVersion : null,
      source
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { store: storeVazio(), initialized: true, migratedFrom: null, source: null }
    }
    throw error
  }
}

async function gravar(casa, store) {
  const path = caminhoDosAtalhos(casa)
  const temporary = `${path}.${process.pid}.novo`
  store.store.updatedAt = new Date().toISOString()
  validarStore(store, path)
  await mkdir(join(casa, 'learning'), { recursive: true })
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}
```

por

```js
// Carga sob a trava (adquirirTrava), pela ponte do omni.db.
async function carregar(casa, policy) {
  const path = caminhoDosAtalhos(casa)
  const source = carregarTextoDoEstado(casa, 'learning/shortcuts.json', {
    versao: SHORTCUT_STORE_SCHEMA_VERSION,
    validar: (doc) => validarStore(doc, path)
  })
  if (source === null) return { store: storeVazio(), initialized: true, migratedFrom: null, source: null }
  const parsed = JSON.parse(source)
  let store = parsed.schemaVersion === 1 ? migrarV1(source, policy) : parsed
  if (store.schemaVersion === 2) store = migrarV2(store)
  if (store.schemaVersion === 3) store = migrarV3(store)
  if (store.schemaVersion > SHORTCUT_STORE_SCHEMA_VERSION) {
    throw new Error(`Aprendizado v${store.schemaVersion} é mais novo que este plugin.`)
  }
  validarStore(store, path)
  return {
    store,
    initialized: false,
    migratedFrom: parsed.schemaVersion < SHORTCUT_STORE_SCHEMA_VERSION ? parsed.schemaVersion : null,
    source
  }
}

// Escrita pela ponte: banco, arquivo e base na mesma transação.
async function gravar(casa, store) {
  const path = caminhoDosAtalhos(casa)
  store.store.updatedAt = new Date().toISOString()
  validarStore(store, path)
  gravarTextoDoEstado(casa, 'learning/shortcuts.json', `${JSON.stringify(store, null, 2)}\n`)
}
```

**(e) `runtime/recibos-evolucao.mjs`.** Trocar o trecho único

```js
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
```

por

```js
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'

import { carregarTextoDoEstado, gravarTextoDoEstado } from './estados.mjs'
```

o trecho único do `gravarAtomico`

```js
async function gravarAtomico(caminho, store, at) {
  store.store.updatedAt = agora(at)
  if (store.receipts.length > RETENCAO_MAXIMA) {
    store.receipts = store.receipts.slice(store.receipts.length - RETENCAO_MAXIMA)
  }
  await mkdir(join(caminho, '..'), { recursive: true })
  const temp = `${caminho}.${process.pid}.novo`
  await writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  await rename(temp, caminho)
  return store
}
```

por

```js
// Trava no molde das falhas (desvio 15): open com wx, 40 tentativas a cada 50 ms; trava com mais
// de 10 s é de escrita morta. O caminho sai de caminhoDosRecibos, que recusa casa relativa antes
// de criar pasta.
async function adquirirTrava(casa) {
  const pasta = dirname(caminhoDosRecibos(casa))
  await mkdir(pasta, { recursive: true })
  const caminhoDaTrava = join(pasta, 'evolution-receipts.lock')
  for (let tentativa = 0; tentativa < 40; tentativa += 1) {
    try {
      const handle = await open(caminhoDaTrava, 'wx')
      return async () => {
        await handle.close()
        await unlink(caminhoDaTrava).catch(() => undefined)
      }
    } catch (erro) {
      if (erro?.code !== 'EEXIST') throw erro
      const idade = Date.now() - (await stat(caminhoDaTrava).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs
      if (idade > 10_000) await unlink(caminhoDaTrava).catch(() => undefined)
      await new Promise((resolver) => setTimeout(resolver, 50))
    }
  }
  throw new Error('Os recibos de evolução estão ocupados por outra escrita.')
}

// Carga dos escritores, sob a trava, pela ponte do omni.db. lerRecibos segue no arquivo (desvio 8).
function carregarSobTrava(casa) {
  const caminho = caminhoDosRecibos(casa)
  const texto = carregarTextoDoEstado(casa, 'learning/evolution-receipts.json', {
    versao: RECIBOS_SCHEMA_VERSION,
    validar: (doc) => validarStore(doc, caminho)
  })
  return texto === null ? storeVazio() : validarStore(JSON.parse(texto), caminho)
}

function gravar(casa, store, at) {
  store.store.updatedAt = agora(at)
  if (store.receipts.length > RETENCAO_MAXIMA) {
    store.receipts = store.receipts.slice(store.receipts.length - RETENCAO_MAXIMA)
  }
  gravarTextoDoEstado(casa, 'learning/evolution-receipts.json', `${JSON.stringify(store, null, 2)}\n`)
  return store
}
```

e o trecho único dos escritores, do fim do `registrarRecibo` ao fim do `marcarRevertido`

```js
  const caminho = caminhoDosRecibos(casa)
  const store = await lerRecibos(casa)
  store.receipts.push(recibo)
  await gravarAtomico(caminho, store, at)
  return recibo
}

export async function vetarRecibo(casa, id, { at } = {}) {
  const caminho = caminhoDosRecibos(casa)
  const store = await lerRecibos(casa)
  const recibo = store.receipts.find((item) => item.id === id)
  if (!recibo) return { result: 'not-found', id }
  if (recibo.status === 'vetoed') return { result: 'already-vetoed', recibo }
  recibo.status = 'vetoed'
  recibo.vetoedAt = agora(at)
  await gravarAtomico(caminho, store, at)
  // O chamador executa a reversão real guiado por recibo.revert e marca 'reverted' depois.
  return { result: 'vetoed', recibo }
}

export async function marcarRevertido(casa, id, { at } = {}) {
  const caminho = caminhoDosRecibos(casa)
  const store = await lerRecibos(casa)
  const recibo = store.receipts.find((item) => item.id === id)
  if (!recibo) return { result: 'not-found', id }
  recibo.status = 'reverted'
  if (!recibo.vetoedAt) recibo.vetoedAt = agora(at)
  await gravarAtomico(caminho, store, at)
  return { result: 'reverted', recibo }
}
```

por

```js
  const release = await adquirirTrava(casa)
  try {
    const store = carregarSobTrava(casa)
    store.receipts.push(recibo)
    gravar(casa, store, at)
  } finally {
    await release()
  }
  return recibo
}

export async function vetarRecibo(casa, id, { at } = {}) {
  const release = await adquirirTrava(casa)
  try {
    const store = carregarSobTrava(casa)
    const recibo = store.receipts.find((item) => item.id === id)
    if (!recibo) return { result: 'not-found', id }
    if (recibo.status === 'vetoed') return { result: 'already-vetoed', recibo }
    recibo.status = 'vetoed'
    recibo.vetoedAt = agora(at)
    gravar(casa, store, at)
    // O chamador executa a reversão real guiado por recibo.revert e marca 'reverted' depois.
    return { result: 'vetoed', recibo }
  } finally {
    await release()
  }
}

export async function marcarRevertido(casa, id, { at } = {}) {
  const release = await adquirirTrava(casa)
  try {
    const store = carregarSobTrava(casa)
    const recibo = store.receipts.find((item) => item.id === id)
    if (!recibo) return { result: 'not-found', id }
    recibo.status = 'reverted'
    if (!recibo.vetoedAt) recibo.vetoedAt = agora(at)
    gravar(casa, store, at)
    return { result: 'reverted', recibo }
  } finally {
    await release()
  }
}
```

**(f) `runtime/feedback-personalidade.mjs`.** Trocar o trecho único

```js
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
```

por

```js
import { readFile } from 'node:fs/promises'
```

o trecho único

```js
import { hasContinuityComplaint, hasExplicitPersistentPersonalityDirective, normalizeOwnerText } from '../dist/core/personality/owner-feedback.js'
```

por

```js
import { hasContinuityComplaint, hasExplicitPersistentPersonalityDirective, normalizeOwnerText } from '../dist/core/personality/owner-feedback.js'
import { carregarTextoDoEstado, gravarTextoDoEstado } from './estados.mjs'
```

o trecho único do `load`

```js
async function load(casa) {
  const path = caminhoDoFeedbackPersonalidade(casa)
  try {
    return validateStore(JSON.parse(await readFile(path, 'utf8')), path)
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyStore()
    throw error
  }
}
```

por

```js
// Leitura pura, sem trava e sem banco (desvio 8).
async function lerArquivo(casa) {
  const path = caminhoDoFeedbackPersonalidade(casa)
  try {
    return validateStore(JSON.parse(await readFile(path, 'utf8')), path)
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyStore()
    throw error
  }
}

// Carga dos escritores, sob a trava, pela ponte do omni.db.
function carregarSobTrava(casa) {
  const path = caminhoDoFeedbackPersonalidade(casa)
  const texto = carregarTextoDoEstado(casa, 'feedback/personality-feedback.json', {
    versao: PERSONALITY_FEEDBACK_SCHEMA_VERSION,
    validar: (doc) => validateStore(doc, path)
  })
  return texto === null ? emptyStore() : validateStore(JSON.parse(texto), path)
}
```

o trecho único do `save`

```js
async function save(casa, store, at = now()) {
  const path = caminhoDoFeedbackPersonalidade(casa)
  const temporary = `${path}.${process.pid}.${randomUUID()}.novo`
  store.store.updatedAt = at
  validateStore(store, path)
  try {
    await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
    await rename(temporary, path)
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}
```

por

```js
// Escrita pela ponte: banco, arquivo e base na mesma transação.
async function save(casa, store, at = now()) {
  const path = caminhoDoFeedbackPersonalidade(casa)
  store.store.updatedAt = at
  validateStore(store, path)
  gravarTextoDoEstado(casa, 'feedback/personality-feedback.json', `${JSON.stringify(store, null, 2)}\n`)
}
```

e as chamadas, nesta ordem, porque o recuo de dois espaços também casa dentro do de quatro. Primeiro, as duas ocorrências (as duas cargas sob `acquireLock`, nos dois escritores) de

```js
    const store = await load(casa)
```

viram

```js
    const store = carregarSobTrava(casa)
```

Depois, o trecho, agora único,

```js
  const store = await load(casa)
```

vira

```js
  const store = await lerArquivo(casa)
```

e o trecho único

```js
  return load(casa)
```

vira

```js
  return lerArquivo(casa)
```

A trava `acquireLock` não muda.

**(g) `testes/feedback-personalidade.test.mjs`.** Trocar o trecho único

```js
import test from 'node:test'

import {
  caminhoDoFeedbackPersonalidade,
```

por

```js
import test from 'node:test'

import { sqliteDisponivel } from '../runtime/casa/banco.mjs'
import {
  caminhoDoFeedbackPersonalidade,
```

e o trecho único do FP 239

```js
    assert.deepEqual(await readdir(casa), ['feedback'])
```

por

```js
    assert.deepEqual((await readdir(casa)).sort(), sqliteDisponivel() ? ['casa', 'feedback'] : ['feedback'])
```

- [x] **Passo 5: ver o verde.**

```powershell
node --test --test-concurrency=1 --test-reporter=spec testes/estados-modulos.test.mjs *> "$rascunho\t4-verde.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t4-verde.txt" -Pattern '(tests|pass|fail|skipped) \d+\s*$'
$donos = 'falhas', 'automacao-falhas', 'autoaperfeicoamento', 'atalhos', 'recibos-evolucao', 'feedback-personalidade'
foreach ($s in $donos) {
  node --test --test-concurrency=1 --test-reporter=spec "testes/$s.test.mjs" *> "$rascunho\t4-$s.txt"; "$s saida: $LASTEXITCODE"
  Select-String -Path "$rascunho\t4-$s.txt" -Pattern '(tests|pass|fail|skipped) \d+\s*$'
}
```

Esperado: no EM, saída 0, `tests 8`, `pass 8`, `fail 0` e `skipped 0` (sem `node:sqlite`, 6 pulam). Nas seis suítes, os números da base do Passo 2, todas com `fail 0`, `skipped 0` e saída 0.

Resultado (05/11): igual ao esperado: no EM, 8 de 8, em 1,2 s; nas seis suítes, os números da base, todas verdes. O tempo somado das seis subiu de 18,5 s para 35,8 s, porque agora cada carga e cada escrita dos donos abre o `omni.db`.

- [x] **Passo 6: imports, finais de linha, guarda e conferência.** O conferidor olha, nos seis donos, se cada nome importado ainda tem uso e se os nomes tirados do import sumiram do arquivo.

```js rascunho=t4-imports.mjs
// Confere, nos seis donos, que todo nome importado ainda é usado e que os nomes tirados do
// import sumiram do arquivo.
import { readFileSync } from 'node:fs'
const donos = ['falhas', 'automacao-falhas', 'autoaperfeicoamento', 'atalhos', 'recibos-evolucao', 'feedback-personalidade']
const removidos = {
  falhas: ['rename'],
  'automacao-falhas': ['rename'],
  atalhos: ['rename'],
  'recibos-evolucao': ['rename', 'writeFile'],
  'feedback-personalidade': ['rename', 'unlink', 'writeFile']
}
let problemas = 0
for (const dono of donos) {
  const texto = readFileSync(`runtime/${dono}.mjs`, 'utf8')
  for (const [linha, nomes] of texto.matchAll(/^import \{ ([^}]+) \} from '[^']+'$/gm)) {
    const resto = texto.split(linha).join('')
    for (const nome of nomes.split(',').map((item) => item.trim().split(/\s+as\s+/).at(-1))) {
      if (!new RegExp(`\\b${nome}\\b`).test(resto)) { problemas += 1; console.log(`sem uso: ${dono} ${nome}`) }
    }
  }
  for (const nome of removidos[dono] ?? []) {
    if (new RegExp(`\\b${nome}\\b`).test(texto)) { problemas += 1; console.log(`ainda usado: ${dono} ${nome}`) }
  }
}
console.log(problemas === 0 ? 'imports: ok' : `imports: ${problemas} problemas`)
process.exit(problemas === 0 ? 0 : 1)
```

```powershell
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so t4-imports.mjs
node "$rascunho\t4-imports.mjs"; "saida: $LASTEXITCODE"
$t4 = 'testes\estados-modulos.test.mjs', 'runtime\falhas.mjs', 'runtime\automacao-falhas.mjs', 'runtime\autoaperfeicoamento.mjs', 'runtime\atalhos.mjs', 'runtime\recibos-evolucao.mjs', 'runtime\feedback-personalidade.mjs', 'testes\feedback-personalidade.test.mjs'
foreach ($f in $t4) { $f + ': ' + ([IO.File]::ReadAllBytes((Resolve-Path $f)) | Where-Object { $_ -eq 13 }).Count }
Test-Path "$env:LOCALAPPDATA\omni\casa"
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --conferir --so testes/estados-modulos.test.mjs t4-imports.mjs
```

Esperado: `gravado t4-imports.mjs`; `imports: ok` e saída 0 (antes da T4, o mesmo conferidor não achava nenhum import sem uso); `0` nos oito arquivos; `False`; e `igual` nos dois blocos.

Resultado (05/11): `gravado t4-imports.mjs`, `imports: ok` com saída 0, `0` nos oito arquivos, `False` e `igual` nos dois blocos.

### Task 5: o gatilho na varredura

**Arquivos:** modificar `runtime/varredura-diaria.mjs` (o import de `reconciliarEstados` entra depois da linha 17, e o `return` do fim, linha 920, ganha `estados`) e `testes/varredura-diaria.test.mjs` (VD, três testes no fim, com os ajudantes). Com o estado da varredura salvo e os documentos reconciliados, a varredura chama `reconciliarEstados(casa)`: importa os p2 que nenhum dono carregou e roda a decisão nos dois espelhos (desvios 3 e 9). A passada not-due sai antes e não chama. O primeiro teste confere o placar inteiro de uma varredura sem atividade. Falhas e atalhos chegam `presente`, porque a própria varredura os carrega pela ponte do dono antes do gatilho (T4). Recibos (p2) e continuidade (espelho), semeados no disco, saem `importada`, e o resto sai `sem-arquivo` ou `vazia`. O segundo prova que a passada not-due não reconcilia; o terceiro, que um estado quebrado degrada sozinho, sem desfazer a varredura. Como os testes de documentos do VD, os três não pulam sem `node:sqlite`. O VD vai de 12 para 15 testes. Os dois arquivos estão em CRLF no disco desta máquina e passam a LF antes das trocas (item 13 do executor).

**Sem try/catch na varredura.** Os documentos do plano 2 têm um, porque `reconciliarDocumentosMd` rejeita (VD 528). `reconciliarEstados` não rejeita: degrada cada estado no próprio try (ES 23), e `sqliteDisponivel` e `registrarDegradacao` não lançam. Um catch em volta seria código que nenhum teste alcança, e o mutante que o tirasse sobreviveria. Quem amarra o contrato do lado da varredura é o terceiro teste: se `reconciliarEstados` um dia rejeitar, a varredura rejeita junto e o `doesNotReject` fica vermelho. A pasta que esse teste põe no lugar dos recibos só tropeça no gatilho. Com projetos vazios, nada mais na varredura lê os recibos: o `recibosAtivos` do autoaperfeiçoamento só roda quando há proposta, e proposta só nasce de atividade validada.

- [x] **Passo 1: a linha de base do VD.** Sai antes de qualquer troca. O VD não rodou na T4, e a varredura já carrega falhas e atalhos pela ponte; se a base não der 12 de 12, a regressão é da T4 e se resolve antes de seguir.

```powershell
node --test --test-concurrency=1 --test-reporter=spec testes/varredura-diaria.test.mjs *> "$rascunho\t5-base.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t5-base.txt" -Pattern '(tests|pass|fail|skipped) \d+\s*$'
```

Esperado: saída 0, `tests 12`, `pass 12`, `fail 0` e `skipped 0`.

Resultado (05/11): igual ao esperado: 12 de 12, em 6,4 s.

- [x] **Passo 2: os finais de linha.** Os dois arquivos passam a LF sem BOM, para que os trechos dos Passos 3 e 5 casem byte a byte. O conteúdo não muda.

```powershell
$lf = 'runtime/varredura-diaria.mjs', 'testes/varredura-diaria.test.mjs'
foreach ($f in $lf) {
  $b = [IO.File]::ReadAllBytes((Resolve-Path $f))
  if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { throw "$f tem BOM" }
  [IO.File]::WriteAllText((Resolve-Path $f), [Text.Encoding]::UTF8.GetString($b).Replace("`r`n", "`n"), (New-Object Text.UTF8Encoding $false))
}
git diff --stat -- $lf 2>&1 | ForEach-Object { "$_" }
```

Esperado: nenhuma linha de estatística, só os avisos `LF will be replaced by CRLF`.

Resultado (05/11): nenhuma linha de estatística, só os avisos de LF.

- [x] **Passo 3: os testes.** Trocar o trecho único do fim do VD

```js
    assert.deepEqual(anotadas.map((linha) => linha.operacao), ['documentos.varredura'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
```

por

```js
    assert.deepEqual(anotadas.map((linha) => linha.operacao), ['documentos.varredura'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Plano 3 da F1: depois dos documentos, a varredura põe no omni.db os estados de learning/ e
// feedback/ que nenhum dono carregou. Falhas e atalhos, que a própria varredura carrega antes,
// chegam pela ponte do dono e aparecem como presentes; a continuidade é espelho da loja TS.
const RECIBOS = 'learning/evolution-receipts.json'
const CONTINUIDADE = 'feedback/personality-continuity.json'
const recibosVazios = () => ({
  schemaVersion: 1,
  store: { id: 'omni-evolution-receipts', createdAt: '2026-08-27T10:00:00.000Z', updatedAt: '2026-08-27T10:00:00.000Z' },
  receipts: []
})
const continuidadeVazia = () => ({ schemaVersion: 1, observations: [] })
async function semearEstado(home, rel, doc) {
  const [pasta, nome] = rel.split('/')
  await mkdir(join(home, pasta), { recursive: true })
  await writeFile(join(home, pasta, nome), `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
}
function estadosNoBanco(home) {
  return comBancoDaCasa(home, 'omni', (db) => db.prepare('SELECT id FROM estados ORDER BY id').all().map((linha) => linha.id))
}

test('varredura concluida poe no omni.db os estados que nenhum dono carregou', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omni-daily-estados-'))
  const home = join(root, 'home')
  const projects = join(root, 'projects')
  try {
    await mkdir(projects, { recursive: true })
    await semearEstado(home, RECIBOS, recibosVazios())
    await semearEstado(home, CONTINUIDADE, continuidadeVazia())
    const result = await varrerAtividadesDoDia(home, {
      date: '2026-08-28',
      projectsRoot: projects,
      now: new Date('2026-08-28T12:00:00-03:00')
    })
    assert.equal(result.result, 'completed')
    assert.deepEqual(Object.keys(result), ['result', 'scan', 'documentos', 'estados'], 'a varredura concluida nao devolveu os estados')
    assert.deepEqual(result.estados, {
      resultado: 'feita',
      arquivos: {
        'learning/failures.json': 'presente',
        'learning/failure-automation.json': 'sem-arquivo',
        'learning/self-improvement.json': 'sem-arquivo',
        'learning/shortcuts.json': 'presente',
        [RECIBOS]: 'importada',
        'feedback/personality-feedback.json': 'sem-arquivo',
        [CONTINUIDADE]: 'importada',
        'feedback/personality-owner-directions.json': 'vazia'
      }
    })
    assert.deepEqual(estadosNoBanco(home), [CONTINUIDADE, RECIBOS, 'learning/failures.json', 'learning/shortcuts.json'])
    assert.equal((await lerEstadoVarredura(home)).scans.at(-1).estados, undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('varredura automatica fora do horario nao reconcilia os estados', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omni-daily-estados-due-'))
  const home = join(root, 'home')
  const projects = join(root, 'projects')
  try {
    await mkdir(projects, { recursive: true })
    await semearEstado(home, RECIBOS, recibosVazios())
    const primeira = await varrerAtividadesDoDia(home, {
      date: '2026-08-28',
      projectsRoot: projects,
      automatic: true,
      now: new Date('2026-08-28T12:00:00-03:00')
    })
    assert.equal(primeira.result, 'completed')
    assert.equal(primeira.estados?.arquivos[RECIBOS], 'importada', 'a primeira passada nao importou os recibos')
    await semearEstado(home, CONTINUIDADE, continuidadeVazia())
    const segunda = await varrerAtividadesDoDia(home, {
      date: '2026-08-28',
      projectsRoot: projects,
      automatic: true,
      now: new Date('2026-08-28T12:05:00-03:00')
    })
    assert.equal(segunda.result, 'not-due')
    assert.equal(segunda.estados, undefined)
    assert.equal(estadosNoBanco(home).includes(CONTINUIDADE), false, 'a passada not-due reconciliou a continuidade')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Uma pasta no lugar dos recibos faz a importação tropeçar em EISDIR: o estado degrada, a
// continuidade segue e a varredura conclui com o estado salvo e a degradação anotada.
test('estado que falha na varredura vira degradacao anotada e nao desfaz a varredura', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omni-daily-estados-falha-'))
  const home = join(root, 'home')
  const projects = join(root, 'projects')
  try {
    await mkdir(projects, { recursive: true })
    await mkdir(join(home, 'learning', 'evolution-receipts.json'), { recursive: true })
    await semearEstado(home, CONTINUIDADE, continuidadeVazia())
    let result
    await assert.doesNotReject(async () => {
      result = await varrerAtividadesDoDia(home, {
        date: '2026-08-28',
        projectsRoot: projects,
        now: new Date('2026-08-28T12:00:00-03:00')
      })
    })
    assert.equal(result.result, 'completed')
    assert.equal(result.estados?.arquivos[RECIBOS], 'degradada', 'os recibos quebrados nao viraram degradacao')
    assert.equal(result.estados.arquivos[CONTINUIDADE], 'importada')
    assert.equal((await lerEstadoVarredura(home)).scans.length, 1)
    const anotadas = (await readFile(join(pastaDoBanco(home), 'degradacoes.jsonl'), 'utf8')).trim().split('\n').map((linha) => JSON.parse(linha))
    assert.deepEqual(anotadas.map((linha) => linha.operacao), ['estados.varredura'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
```

- [x] **Passo 4: ver o vermelho.**

```powershell
node --test --test-concurrency=1 --test-reporter=spec testes/varredura-diaria.test.mjs *> "$rascunho\t5-vermelho.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t5-vermelho.txt" -Pattern '(tests|pass|fail|skipped) \d+\s*$'
Select-String -Path "$rascunho\t5-vermelho.txt" -Pattern 'a varredura concluida nao devolveu os estados|a primeira passada nao importou os recibos|os recibos quebrados nao viraram degradacao' | ForEach-Object { $_.Line.Trim() } | Sort-Object -Unique
```

Esperado: saída 1, `tests 15`, `pass 12`, `fail 3` e `skipped 0`, e três linhas únicas, uma por mensagem: o primeiro teste cai em `a varredura concluida nao devolveu os estados`, o segundo em `a primeira passada nao importou os recibos` e o terceiro em `os recibos quebrados nao viraram degradacao`. Os 12 de antes seguem verdes.

Resultado (05/11): igual ao esperado: 15 testes, 12 verdes e 3 vermelhos, em 10,0 s, cada vermelho com a sua mensagem.

- [x] **Passo 5: a troca na varredura.** Trocar o trecho único

```js
import { registrarDegradacao } from './casa/banco.mjs'
import { reconciliarDocumentosMd } from './documentos-md.mjs'
```

por

```js
import { registrarDegradacao } from './casa/banco.mjs'
import { reconciliarDocumentosMd } from './documentos-md.mjs'
import { reconciliarEstados } from './estados.mjs'
```

e o trecho único

```js
    return { result: 'completed', scan, documentos }
```

por

```js
    // Os estados de learning/ e feedback/ entram no omni.db depois dos documentos (plano 3 da F1):
    // a varredura importa os p2 que nenhum dono carregou e acompanha os dois espelhos. Sem
    // try/catch: reconciliarEstados degrada cada estado no próprio try e não rejeita.
    const estados = await reconciliarEstados(casa)
    return { result: 'completed', scan, documentos, estados }
```

- [x] **Passo 6: ver o verde.**

```powershell
node --test --test-concurrency=1 --test-reporter=spec testes/varredura-diaria.test.mjs *> "$rascunho\t5-verde.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t5-verde.txt" -Pattern '(tests|pass|fail|skipped) \d+\s*$'
```

Esperado: saída 0, `tests 15`, `pass 15`, `fail 0` e `skipped 0`.

Resultado (05/11): igual ao esperado: 15 de 15, em 9,7 s.

- [x] **Passo 7: diff, finais de linha e guarda.**

```powershell
$t5 = 'runtime/varredura-diaria.mjs', 'testes/varredura-diaria.test.mjs'
git diff --numstat -- $t5 2>&1 | ForEach-Object { "$_" }
foreach ($f in $t5) { $f + ': ' + ([IO.File]::ReadAllBytes((Resolve-Path $f)) | Where-Object { $_ -eq 13 }).Count }
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `6 1` na varredura e `114 0` no VD, com os avisos de LF; `0` nos dois arquivos; e `False`.

Resultado (05/11): `6 1` na varredura e `114 0` no VD, com os avisos de LF; `0` nos dois arquivos; e `False`.

### Task 6: `node --check` dos módulos novos e do `recibos-evolucao`

O `node --check` de um módulo não segue import (T5 do plano 2), e o `npm run check` roda duas listas dele: a do `precheck` (linha 11 do `package.json`), que o npm dispara antes, e a do `check` (linha 26). Nenhuma das duas cita os dois módulos novos nem o `recibos-evolucao`, o único dos seis donos que já ficava de fora. Sem esta tarefa, um erro de sintaxe neles passaria pelo `check` e só apareceria quando algum teste carregasse o módulo. A regra: todo arquivo do `runtime/` que este plano cria ou altera passa pelo `node --check`. Os onze módulos do `runtime/` que seguem fora das duas listas não são deste plano e ficam como estão.

**Arquivos:**
- Modificar: `package.json:26` (script `check`), que passa de CRLF a LF antes da troca (item 13 do executor).
- Auxiliar fora do repo: `$rascunho\mutante-sintaxe.mjs`. É o do plano 2 com duas mudanças: o arquivo vira argumento obrigatório, e a citação exige a barra antes do nome, porque `estados.mjs` é o fim de `loja-estados.mjs`.

- [x] **Passo 1: o fim de linha.** O `package.json` passa a LF sem BOM, para que o trecho do Passo 4 case byte a byte. O conteúdo não muda.

```powershell
$f = 'package.json'
$b = [IO.File]::ReadAllBytes((Resolve-Path $f))
if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { throw "$f tem BOM" }
[IO.File]::WriteAllText((Resolve-Path $f), [Text.Encoding]::UTF8.GetString($b).Replace("`r`n", "`n"), (New-Object Text.UTF8Encoding $false))
git diff --stat -- $f 2>&1 | ForEach-Object { "$_" }
```

Esperado: nenhuma linha de estatística, só o aviso `LF will be replaced by CRLF`.

Resultado (05/11): nenhuma linha de estatística, só o aviso de LF.

- [x] **Passo 2: o mutante de sintaxe.** Acrescenta uma linha em branco e um `export const = 1` no fim do arquivo pedido, roda `npm run check` e restaura o arquivo, sempre.

```js rascunho=mutante-sintaxe.mjs
// Quebra a sintaxe de um arquivo do runtime, roda `npm run check` e restaura o arquivo sempre.
// Uso: node mutante-sintaxe.mjs <raiz-do-repo> <arquivo relativo>
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const [raizArg, relativo] = process.argv.slice(2)
if (!raizArg || !relativo) { console.error('uso: node mutante-sintaxe.mjs <raiz-do-repo> <arquivo relativo>'); process.exit(2) }
const raiz = resolve(raizArg)
const caminho = join(raiz, relativo)
// A barra antes do nome evita que estados.mjs case com uma linha de loja-estados.mjs.
const cita = new RegExp(`[\\\\/]${basename(relativo).replace(/[.]/g, '\\.')}:\\d+`)
const original = readFileSync(caminho)
const hash = (conteudo) => createHash('sha256').update(conteudo).digest('hex')
const antes = hash(original)
try {
  writeFileSync(caminho, Buffer.concat([original, Buffer.from('\nexport const = 1\n')]))
  const r = spawnSync('npm run check', { cwd: raiz, encoding: 'utf8', shell: true, windowsHide: true })
  const saida = `${r.stdout}\n${r.stderr}`
  const aponta = saida.split('\n').find((linha) => cita.test(linha))
  console.log(`${relativo}: status ${r.status}; SyntaxError: ${/SyntaxError/.test(saida)}; aponta: ${aponta?.trim() ?? '(nenhuma linha cita o arquivo)'}`)
} finally {
  writeFileSync(caminho, original)
  console.log(`restaurado: ${hash(readFileSync(caminho)) === antes} (${antes.slice(0, 12)})`)
}
```

```powershell
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so mutante-sintaxe.mjs
```

Esperado: `gravado mutante-sintaxe.mjs`.

Resultado (05/11): `gravado mutante-sintaxe.mjs`.

- [x] **Passo 3: o furo, antes da troca.**

```powershell
$alvos = 'runtime/casa/loja-estados.mjs', 'runtime/estados.mjs', 'runtime/recibos-evolucao.mjs'
foreach ($alvo in $alvos) { node "$rascunho\mutante-sintaxe.mjs" . $alvo }
```

Esperado, nos três: `status 0; SyntaxError: false; aponta: (nenhuma linha cita o arquivo)` e `restaurado: true`. O `check` deixa passar o módulo quebrado, porque nenhum passo dele lê `runtime/` antes dos `node --check`: o `architecture:check` varre `src/` e `testes/*.ts`, o `contracts:check` e o `verify:generated` leem JSON, e o typecheck não enxerga `runtime/` (item 10). Um `status 1` sem `SyntaxError` quer dizer que o `check` já estava vermelho por outro motivo, e isso se resolve antes de seguir.

Resultado (05/11): igual ao esperado nos três, com `restaurado: true` nos hashes de antes (`82b6b259deea`, `24f853523c72` e `faa0cbeaa236`, os mesmos da T7).

- [x] **Passo 4: a troca.** Na linha 26 do `package.json`, trocar o trecho único

```
node --check runtime/documentos-md.mjs && 
```

por

```
node --check runtime/documentos-md.mjs && node --check runtime/casa/loja-estados.mjs && node --check runtime/estados.mjs && node --check runtime/recibos-evolucao.mjs && 
```

(com o espaço final).

- [x] **Passo 5: o mutante morre no lugar certo.**

```powershell
$alvos = 'runtime/casa/loja-estados.mjs', 'runtime/estados.mjs', 'runtime/recibos-evolucao.mjs'
foreach ($alvo in $alvos) { node "$rascunho\mutante-sintaxe.mjs" . $alvo }
```

Esperado, nos três: `status 1; SyntaxError: true`, a linha do `export const = 1` apontada e `restaurado: true`. Os arquivos têm 204, 236 e 224 linhas, e o mutante acrescenta duas, então as apontadas são `loja-estados.mjs:206`, `estados.mjs:238` e `recibos-evolucao.mjs:226`.

Resultado (05/11): igual ao esperado: `status 1; SyntaxError: true`, apontando `loja-estados.mjs:206`, `estados.mjs:238` e `recibos-evolucao.mjs:226`, e `restaurado: true` nos mesmos hashes.

- [x] **Passo 6: `check` limpo, diff, fim de linha e guarda.**

```powershell
npm run check *> "$rascunho\t6-check.txt"; "saida: $LASTEXITCODE"
git diff --numstat -- package.json 2>&1 | ForEach-Object { "$_" }
'package.json: ' + ([IO.File]::ReadAllBytes((Resolve-Path 'package.json')) | Where-Object { $_ -eq 13 }).Count
Test-Path "$env:LOCALAPPDATA\omni\casa"
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --conferir --so mutante-sintaxe.mjs
```

Esperado: saída 0; `1 1` no `package.json`, com o aviso de LF; `0`; `False`; e `igual mutante-sintaxe.mjs`.

Resultado (05/11): igual ao esperado. O `check` limpo passa pelos 43 contratos, pelas 59 fontes (57 em TypeScript) e pelo typecheck sem erro.

### Task 7: mutação

Um teste só prova alguma coisa se um mutante o deixa vermelho pela asserção. Morte no setup, por `TypeError` ou por arquivo que não carrega não conta. São 47 mutantes nos dez arquivos de runtime que este plano cria ou altera:
- 3 no esquema v3;
- 16 na loja;
- 18 na ponte;
- 6 nos donos, um por dono, cada um gravando sem passar pelo `omni.db`;
- 2 na trava dos recibos;
- 2 no gatilho da varredura.

Cada mutante roda só as suítes dos testes que devem matá-lo. Nenhum arquivo do repositório muda nesta tarefa.

**Auxiliares fora do repo:**
- `$rascunho\gerar-mutantes-p3.mjs` grava a lista dos 47 mutantes em `mutantes-p3.json`, ao lado dele.
- `$rascunho\mutantes.mjs` é um executor novo. Ele roda da raiz do repositório e não traz caminho local, por isso mora no plano. Para cada mutante:
  - confere que o trecho aparece uma vez só no arquivo alvo; senão, marca `??`;
  - guarda o original em `original-<arquivo>`, ao lado da lista, e aplica a troca respeitando o fim de linha do arquivo;
  - roda as suítes do mutante pelo `run()` do `node:test`, que entrega cada falha com o erro de verdade: nome, código, operador e mensagem;
  - restaura o original no `finally` e também no Ctrl+C;
  - anota cada teste que caiu em `mutantes-p3.saida.jsonl`.

  Ele sai 1 se algum mutante não ficar vermelho.
- `$rascunho\tabela-mutantes-p3.mjs` monta a tabela do Apêndice A a partir da lista e da saída. Ele derruba a tabela em quatro casos:
  - falta uma linha;
  - um mutante não fica vermelho e não está na lista de equivalentes;
  - uma queda não é `AssertionError` com `ERR_ASSERTION`;
  - uma queda vem de suíte fora das do mutante.

Ficaram fora da lista os mutantes que morreriam fora da asserção ou que não mudam nada:

| Mutante descartado | Por quê |
|---|---|
| `relogio NOT NULL` | `SqliteError` |
| chave repetida sem sufixo | erro no CE 4, com `tags` repetidas |
| lápide sem o `\|\| apagado_em` | erro no CE 12 |
| relógio que não volta na recomposição, `ORDER BY` trocado e `maior` sem cálculo | erro `divergiu` |
| carga dos donos direto do arquivo | `SyntaxError` no socorro |
| trava dos recibos solta sem apagar o arquivo | erro `ocupados` no EM 5 |
| `if (!noDisco)` removido ou invertido | `ENOENT` no ES 17 |
| `catch` da carga relançando | erro no ES 15 |
| carga sem SQLite | a morte muda de teste para teste e nem sempre vem da asserção |
| `reconciliarEstados` rejeitando | `EISDIR` no ES 23 |
| gatilho com `projectsRoot` | equivalente |

- [x] **Passo 1: os três auxiliares.**

```js rascunho=gerar-mutantes-p3.mjs
// Gera mutantes-p3.json (Apêndice A do plano 3 da F1). Cada trecho aparece uma vez só no arquivo alvo.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CB = 'testes/casa-banco.test.mjs'
const CE = 'testes/casa-loja-estados.test.mjs'
const ES = 'testes/estados.test.mjs'
const EM = 'testes/estados-modulos.test.mjs'
const VD = 'testes/varredura-diaria.test.mjs'
const ESQ = 'runtime/casa/esquemas.mjs'
const LOJA = 'runtime/casa/loja-estados.mjs'
const PONTE = 'runtime/estados.mjs'
const VAR = 'runtime/varredura-diaria.mjs'
const RECIBOS = 'runtime/recibos-evolucao.mjs'

// O dono grava só no arquivo: a ponte recebe um env sem SQLite. O void abre a linha porque, sem
// ponto e vírgula, um "(" grudaria na chamada de cima (validateStore(...)(...), TypeError).
const semBanco = (numero, dono, arquivo, rel) => ({
  nome: `${numero} ${dono}: grava sem o omni.db`,
  arquivo,
  de: `gravarTextoDoEstado(casa, '${rel}', `,
  para: `void ((c, r, t) => gravarTextoDoEstado(c, r, t, { env: { OMNI_CASA_SEM_SQLITE: '1' } }))(casa, '${rel}', `,
  teste: [EM]
})

const lista = [
  { nome: '01 esquemas: FK de _estados_no_disco removida', arquivo: ESQ, de: '  id TEXT NOT NULL REFERENCES estados (id),', para: '  id TEXT NOT NULL,', teste: [CB, CE] },
  { nome: '02 esquemas: estado_registros sem diario', arquivo: ESQ, de: "${gatilhosDeDiario('estado_registros')}", para: '', teste: [CB, CE] },
  { nome: '03 esquemas: estados sem diario', arquivo: ESQ, de: "${gatilhosDeDiario('estados')}", para: '', teste: [CB, CE] },
  { nome: '04 loja: catalogo aceita chave herdada', arquivo: LOJA, de: '!Object.hasOwn(CATALOGO, rel)', para: '!(rel in CATALOGO)', teste: [CE] },
  { nome: '05 loja: relogio fica no esqueleto', arquivo: LOJA, de: 'if (relogio !== null) esqueleto.store', para: 'if (false) esqueleto.store', teste: [CE] },
  { nome: '06 loja: chave declarada ignorada', arquivo: LOJA, de: "if (campoChave && typeof item?.[campoChave] === 'string') base = item[campoChave]", para: 'if (false) base = item[campoChave]', teste: [CE] },
  { nome: '07 loja: sufixo da chave repetida comeca em #2', arquivo: LOJA, de: 'chave = `${base}#${n}`', para: 'chave = `${base}#${n + 1}`', teste: [CE] },
  { nome: '08 loja: texto de 200 caracteres vira hash', arquivo: LOJA, de: 'item.length <= 200', para: 'item.length < 200', teste: [CE] },
  { nome: '09 loja: ordem ignora a quebra da cauda', arquivo: LOJA, de: 'if (!quebrou && ordem !== undefined && ordem > ultima) {', para: 'if (ordem !== undefined && ordem > ultima) {', teste: [CE] },
  { nome: '10 loja: ordem nova nao regrava o registro', arquivo: LOJA, de: 'atual.sha256 !== sha || atual.ordem !== ordens[i]', para: 'atual.sha256 !== sha', teste: [CE] },
  { nome: '11 loja: registro que saiu nao vira lapide', arquivo: LOJA, de: 'if (!vistos.has(id)) apagar.run', para: 'if (false) apagar.run', teste: [CE] },
  { nome: '12 loja: esqueleto regravado sempre', arquivo: LOJA, de: '} else if (linha.esqueleto !== esqueleto || linha.apagado_em !== null) {', para: '} else if (true) {', teste: [CE] },
  { nome: '13 loja: recomposicao sem conferir o hash', arquivo: LOJA, de: 'if (sha256(texto) !== linha.texto_sha256) throw', para: 'if (false) throw', teste: [CE] },
  { nome: '14 loja: importacao repetida nao reconhece o presente', arquivo: LOJA, de: "if (shaDoEstado(db, rel) !== null) return 'presente'", para: "if (false) return 'presente'", teste: [CE] },
  { nome: '15 loja: importacao anota o hash da canonica', arquivo: LOJA, de: 'fonteSha: sha256(fonte)', para: 'fonteSha: sha256(canonica)', teste: [CE] },
  { nome: '16 loja: importacao nao confirma a base', arquivo: LOJA, de: '  confirmarEstadoNoDisco(db, rel, sha256(canonica), opcoes)\n', para: '', teste: [CE] },
  { nome: '17 loja: forma canonica nao exigida', arquivo: LOJA, de: '!== texto) throw', para: '!== texto && false) throw', teste: [CE, ES] },
  { nome: '18 loja: estado apagado conta como presente', arquivo: LOJA, de: "'SELECT texto_sha256 FROM estados WHERE id = ? AND apagado_em IS NULL'", para: "'SELECT texto_sha256 FROM estados WHERE id = ?'", teste: [CE] },
  { nome: '19 loja: contagem sem as colecoes do esqueleto', arquivo: LOJA, de: 'const contagens = new Map(Object.entries(JSON.parse(esqueleto)).filter(([, valor]) => Array.isArray(valor)).map(([chave]) => [chave, 0]))', para: 'const contagens = new Map()', teste: [CE] },
  { nome: '20 ponte: estado do outro modo aceito', arquivo: PONTE, de: 'if (CATALOGO[rel]?.modo !== modo) throw', para: 'if (!CATALOGO[rel]) throw', teste: [ES] },
  { nome: '21 ponte: versao futura vai ao validador', arquivo: PONTE, de: "  if (doc.schemaVersion > versao) return 'futura'\n", para: '', teste: [ES] },
  { nome: '22 ponte: versao antiga vai ao validador', arquivo: PONTE, de: "  if (doc.schemaVersion < versao) return 'ok'\n", para: '', teste: [ES] },
  { nome: '23 ponte: importacao sem a copia antes-da-casa', arquivo: PONTE, de: "{ acao: 'importada', devolver: fonte, copia: 'antes-da-casa' }", para: "{ acao: 'importada', devolver: fonte }", teste: [ES] },
  { nome: '24 ponte: base perdida nao volta com o texto igual', arquivo: PONTE, de: '  if (sha256(fonte) === noBanco) {\n    if (base !== noBanco)', para: '  if (sha256(fonte) === noBanco) {\n    if (false)', teste: [ES] },
  { nome: '25 ponte: arquivo defasado vira ingestao', arquivo: PONTE, de: 'if (shaCanonica === base) return', para: 'if (false) return', teste: [ES] },
  { nome: '26 ponte: ingestao nao confirma a base', arquivo: PONTE, de: '  confirmarEstadoNoDisco(db, rel, shaCanonica)\n', para: '', teste: [ES] },
  { nome: '27 ponte: futura ou fora do contrato vira ingestao', arquivo: PONTE, de: "if (situacao !== 'ok') return", para: 'if (false) return', teste: [ES] },
  { nome: '28 ponte: socorro sem validar a recomposicao', arquivo: PONTE, de: "return avaliarTexto(texto, avaliacao) === 'ok'", para: 'return true', teste: [ES] },
  { nome: '29 ponte: socorro sem a copia do arquivo quebrado', arquivo: PONTE, de: "fonte, env)) return { acao: 'intocada', devolver: fonte }", para: "fonte, env) && false) return { acao: 'intocada', devolver: fonte }", teste: [ES] },
  { nome: '30 ponte: socorro sem degradacao anotada', arquivo: PONTE, de: "registrarDegradacao(casa, 'estado.arquivo-invalido', ", para: "void (casa, 'estado.arquivo-invalido', ", teste: [ES] },
  { nome: '31 ponte: projecao nao confirma a base', arquivo: PONTE, de: '    return\n  }\n  confirmarEstadoNoDisco(db, rel, sha256(texto))\n}', para: '    return\n  }\n}', teste: [ES] },
  { nome: '32 ponte: carga sem estado cria o banco', arquivo: PONTE, de: "if (fonte === null && !existsSync(arquivoDoBanco(casa, 'omni', env))) return null", para: 'if (false) return null', teste: [ES] },
  { nome: '33 ponte: banco ilegivel e sem arquivo comeca vazio', arquivo: PONTE, de: 'if (fonte === null) throw new Error(', para: 'if (false) throw new Error(', teste: [ES] },
  { nome: '34 ponte: escrita nao confirma a base', arquivo: PONTE, de: '      noDisco = true\n      confirmarEstadoNoDisco(db, rel, sha256(texto))', para: '      noDisco = true', teste: [ES] },
  { nome: '35 ponte: falha p2 da varredura anotada como espelho', arquivo: PONTE, de: "modo === 'p2' ? 'estados.varredura' : 'estado.espelho'", para: "'estado.espelho'", teste: [ES, VD] },
  { nome: '36 ponte: varredura importa estrutura quebrada', arquivo: PONTE, de: "if (!avaliarEstrutura(fonte)) return 'intocada'", para: "if (false) return 'intocada'", teste: [ES] },
  { nome: '37 ponte: espelho vazio ganha trava e banco', arquivo: PONTE, de: 'if (lerSeExistir(arquivo) === null && !linhaNoBanco(casa, rel, env)) return', para: 'if (false) return', teste: [ES] },
  semBanco('38', 'falhas', 'runtime/falhas.mjs', 'learning/failures.json'),
  semBanco('39', 'automacao de falhas', 'runtime/automacao-falhas.mjs', 'learning/failure-automation.json'),
  semBanco('40', 'autoaperfeicoamento', 'runtime/autoaperfeicoamento.mjs', 'learning/self-improvement.json'),
  semBanco('41', 'atalhos', 'runtime/atalhos.mjs', 'learning/shortcuts.json'),
  semBanco('42', 'recibos', RECIBOS, 'learning/evolution-receipts.json'),
  semBanco('43', 'feedback', 'runtime/feedback-personalidade.mjs', 'feedback/personality-feedback.json'),
  { nome: '44 recibos: trava aberta sem exclusividade', arquivo: RECIBOS, de: "open(caminhoDaTrava, 'wx')", para: "open(caminhoDaTrava, 'w')", teste: [EM] },
  { nome: '45 recibos: trava velha nunca apagada', arquivo: RECIBOS, de: 'if (idade > 10_000) await unlink', para: 'if (false) await unlink', teste: [EM] },
  { nome: '46 vd: varredura concluida sem reconciliar os estados', arquivo: VAR, de: '    const estados = await reconciliarEstados(casa)', para: "    const estados = { resultado: 'feita', arquivos: {} }", teste: [VD] },
  { nome: '47 vd: estados reconciliados antes de olhar o horario', arquivo: VAR, de: '    const store = await carregar(casa)\n    if (automatic && !force && store.lastAutomaticCheckAt) {', para: '    const store = await carregar(casa)\n    await reconciliarEstados(casa)\n    if (automatic && !force && store.lastAutomaticCheckAt) {', teste: [VD] }
]
writeFileSync(join(import.meta.dirname, 'mutantes-p3.json'), JSON.stringify(lista, null, 2))
console.log(`${lista.length} mutantes gravados`)
```

```js rascunho=mutantes.mjs
// Executor de mutantes do plano 3 da F1. Roda da raiz do repositório (o cwd), sem caminho local.
// Uso: node mutantes.mjs <lista.json>. Para cada mutante: exige o trecho uma vez só no arquivo, guarda o
// original ao lado da lista, aplica a troca, roda as suítes pelo run() do node:test, restaura sempre e
// anota cada teste que caiu em <lista>.saida.jsonl (UTF-8 sem BOM). Sai 1 se algum mutante não ficar vermelho.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { run } from 'node:test'

const [listaArg] = process.argv.slice(2)
if (!listaArg) { console.error('uso: node mutantes.mjs <lista.json>'); process.exit(2) }
const raiz = process.cwd()
const lista = JSON.parse(readFileSync(listaArg, 'utf8'))
const pasta = dirname(resolve(listaArg))
const saida = resolve(listaArg).replace(/\.json$/, '.saida.jsonl')
writeFileSync(saida, '')

let aplicado = null // { caminho, original } enquanto um mutante está no disco
const restaurar = () => { if (aplicado) { writeFileSync(aplicado.caminho, aplicado.original); aplicado = null } }
for (const sinal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sinal, () => { restaurar(); process.exit(130) })

const primeiraLinha = (valor) => String(valor ?? '').split('\n')[0]
const inicio = Date.now()
let foraDoVermelho = 0
for (const m of lista) {
  const caminho = resolve(raiz, m.arquivo)
  const original = readFileSync(caminho, 'utf8')
  const fim = original.includes('\r\n') ? (texto) => texto.replace(/\r?\n/g, '\r\n') : (texto) => texto
  const de = fim(m.de)
  const para = fim(m.para)
  const vezes = original.split(de).length - 1
  const linha = { nome: m.nome, arquivo: m.arquivo, teste: m.teste }
  if (vezes !== 1) {
    Object.assign(linha, { resultado: '??', vezes })
  } else {
    const quedas = []
    writeFileSync(join(pasta, `original-${m.arquivo.replaceAll('/', '_')}`), original)
    aplicado = { caminho, original }
    try {
      writeFileSync(caminho, original.replace(de, () => para))
      for await (const evento of run({ files: m.teste.map((suite) => resolve(raiz, suite)), concurrency: 1 })) {
        if (evento.type !== 'test:fail') continue
        const erro = evento.data.details?.error
        if (erro?.failureType === 'subtestsFailed') continue
        const causa = erro?.cause ?? erro
        quedas.push({
          teste: evento.data.name,
          suite: relative(raiz, evento.data.file ?? '').replaceAll('\\', '/'),
          nome: causa?.name ?? null,
          codigo: causa?.code ?? null,
          operador: causa?.operator ?? null,
          mensagem: primeiraLinha(causa?.message ?? causa)
        })
      }
    } finally {
      restaurar()
    }
    Object.assign(linha, { resultado: quedas.length > 0 ? 'vermelho' : 'SOBREVIVEU', quedas })
  }
  if (linha.resultado !== 'vermelho') foraDoVermelho += 1
  writeFileSync(saida, `${JSON.stringify(linha)}\n`, { flag: 'a' })
  console.log(`${linha.resultado} ${m.nome}`)
  for (const queda of linha.quedas ?? []) console.log(`  ${queda.suite} > ${queda.teste}: ${queda.nome} ${queda.operador ?? '-'} ${queda.mensagem}`)
}
console.log(`${lista.length} mutantes em ${Math.round((Date.now() - inicio) / 1000)} s; fora do vermelho: ${foraDoVermelho}`)
process.exitCode = foraDoVermelho > 0 ? 1 : 0
```

```js rascunho=tabela-mutantes-p3.mjs
// Monta a tabela do Apêndice A do plano 3 a partir de mutantes-p3.json e mutantes-p3.saida.jsonl.
// Derruba a tabela (saída 1) se faltar linha, se um mutante não ficar vermelho sem estar na lista de
// equivalentes, se uma queda não for AssertionError com ERR_ASSERTION ou se vier de suíte fora das do mutante.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const pasta = import.meta.dirname
const lista = JSON.parse(readFileSync(join(pasta, 'mutantes-p3.json'), 'utf8'))
const linhas = readFileSync(join(pasta, 'mutantes-p3.saida.jsonl'), 'utf8').split('\n').filter(Boolean).map((linha) => JSON.parse(linha))
const EQUIVALENTES = new Map() // nome do mutante → razão; vazia enquanto nenhum for declarado
const SIGLAS = new Map([
  ['testes/casa-banco.test.mjs', 'CB'],
  ['testes/casa-loja-estados.test.mjs', 'CE'],
  ['testes/estados.test.mjs', 'ES'],
  ['testes/estados-modulos.test.mjs', 'EM'],
  ['testes/varredura-diaria.test.mjs', 'VD']
])
const PADRAO = { strictEqual: 'Expected values to be strictly equal', deepStrictEqual: 'Expected values to be strictly deep-equal', '==': 'The expression evaluated to a falsy value' }
const NOME = { strictEqual: 'equal', deepStrictEqual: 'deepEqual', '==': 'ok' }
const celula = (texto) => texto.replaceAll('|', '\\|').replaceAll('<', '&lt;')
function assercao({ operador, mensagem }) {
  if (operador === 'throws') return mensagem.startsWith('Missing expected exception') ? '`throws` sem exceção' : '`throws` com outro erro'
  if (operador === 'rejects') return mensagem.startsWith('Missing expected rejection') ? '`rejects` sem rejeição' : '`rejects` com outro erro'
  const nome = NOME[operador] ?? operador
  const propria = PADRAO[operador] && !mensagem.startsWith(PADRAO[operador])
  return propria ? `\`${nome}\` ("${celula(mensagem)}")` : `\`${nome}\``
}
const problemas = []
if (linhas.length !== lista.length) problemas.push(`saida com ${linhas.length} linhas para ${lista.length} mutantes`)
const tabela = ['| # | Mutante | Arquivo | Teste que ficou vermelho — asserção |', '|---|---|---|---|']
let vermelhos = 0
let mapeados = 0
lista.forEach((m, i) => {
  const linha = linhas[i]
  const [numero, ...descricao] = m.nome.split(' ')
  const arquivo = `\`${m.arquivo.replace(/^runtime\//, '')}\``
  if (!linha || linha.nome !== m.nome) { problemas.push(`${m.nome}: sem linha na saida`); return }
  if (linha.resultado !== 'vermelho') {
    if (linha.resultado === 'SOBREVIVEU' && EQUIVALENTES.has(m.nome)) {
      tabela.push(`| ${Number(numero)} | ${celula(descricao.join(' '))} | ${arquivo} | sobreviveu — equivalente: ${EQUIVALENTES.get(m.nome)} |`)
    } else problemas.push(`${m.nome}: ${linha.resultado}${linha.vezes === undefined ? '' : ` (trecho ${linha.vezes} vez(es))`}`)
    return
  }
  vermelhos += 1
  const mortes = linha.quedas.map((queda) => {
    if (queda.nome !== 'AssertionError' || queda.codigo !== 'ERR_ASSERTION') problemas.push(`${m.nome}: ${queda.suite} > ${queda.teste} caiu por ${queda.nome} (${queda.mensagem})`)
    if (!m.teste.includes(queda.suite)) problemas.push(`${m.nome}: ${queda.suite} fora das suites do mutante`)
    mapeados += 1
    return `${SIGLAS.get(queda.suite) ?? queda.suite} ${celula(queda.teste)} — ${assercao(queda)}`
  })
  tabela.push(`| ${Number(numero)} | ${celula(descricao.join(' '))} | ${arquivo} | ${mortes.join('<br>')} |`)
})
writeFileSync(join(pasta, 'tabela-mutantes-p3.md'), `${tabela.join('\n')}\n`)
for (const problema of problemas) console.log(`PROBLEMA ${problema}`)
console.log(`${lista.length} linhas: ${vermelhos} vermelhos, ${EQUIVALENTES.size} equivalente(s); testes mapeados: ${mapeados}`)
process.exitCode = problemas.length > 0 ? 1 : 0
```

```powershell
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so gerar-mutantes-p3.mjs mutantes.mjs tabela-mutantes-p3.mjs
```

Esperado: `gravado` nos três.

Resultado (05/11): `gravado` nos três. Depois do conserto do Passo 3, o gerador foi extraído de novo (`gravado gerar-mutantes-p3.mjs`).

- [x] **Passo 2: guarda e hashes antes.** Os doze primeiros dígitos do SHA-256 de cada um dos dez alvos vão para `t7-hashes-antes.txt`.

```powershell
Test-Path "$env:LOCALAPPDATA\omni\casa"
$alvos = 'runtime/casa/esquemas.mjs', 'runtime/casa/loja-estados.mjs', 'runtime/estados.mjs', 'runtime/falhas.mjs', 'runtime/automacao-falhas.mjs', 'runtime/autoaperfeicoamento.mjs', 'runtime/atalhos.mjs', 'runtime/recibos-evolucao.mjs', 'runtime/feedback-personalidade.mjs', 'runtime/varredura-diaria.mjs'
$alvos | ForEach-Object { '{0} {1}' -f (Get-FileHash $_ -Algorithm SHA256).Hash.Substring(0, 12).ToLower(), $_ } | Set-Content "$rascunho\t7-hashes-antes.txt"
Get-Content "$rascunho\t7-hashes-antes.txt"
```

Esperado: `False` e as dez linhas, entre elas `82b6b259deea runtime/casa/loja-estados.mjs`, `24f853523c72 runtime/estados.mjs` e `faa0cbeaa236 runtime/recibos-evolucao.mjs`.

Resultado (05/11): `False` e as dez linhas, com os três hashes esperados.

- [x] **Passo 3: gerar, rodar e tabelar.** O executor leva uns 5 minutos. Quem roda por agente o deixa em segundo plano, porque um tempo-limite que mate o processo no meio deixaria um mutante no disco. Se isso acontecer, o `original-*` ao lado da lista devolve o arquivo, e o Passo 4 confere.

```powershell
node "$rascunho\gerar-mutantes-p3.mjs"
node "$rascunho\mutantes.mjs" "$rascunho\mutantes-p3.json" *> "$rascunho\mutantes-p3.saida.txt"; "saida: $LASTEXITCODE"
node "$rascunho\tabela-mutantes-p3.mjs"
```

Esperado:
- `47 mutantes gravados`;
- `saida: 0`;
- `47 linhas: 47 vermelhos, 0 equivalente(s); testes mapeados: 76`, sem nenhuma linha `PROBLEMA`.

Um `??`, um `SOBREVIVEU` ou um `PROBLEMA` se investiga antes de seguir. O certo é corrigir o mutante ou o teste, nunca a expectativa às cegas. Se o total de testes mapeados sair diferente de 76, cada diferença se explica no resultado.

Resultado (05/11): igual ao esperado na segunda rodada, em 165 s, e cada mutante caiu exatamente nos testes previstos no desenho, sem nenhuma troca.

A primeira rodada (152 s) deu `saida: 0`, mas a tabela saiu com seis `PROBLEMA` e 77 testes mapeados:
- Os mutantes 38 a 41 e 43 abriam a linha com `(`. Sem ponto e vírgula, esse `(` grudava na linha de cima, `validateStore(store, path)` ou `validarStore(store, path)`, e o JS lia `validateStore(...)(...)`. A morte era `TypeError`, que não conta.
- O 77º era o EM 2. Ele caía pelo mesmo `TypeError` no 38, porque a `sincronizarAutomacaoFalhas` passa pela `lerFalhas`.
- O 42 escapou porque, no recibos, a linha de cima é um `}`.

O gerador passou a abrir o trecho com `void`. Como a ponte devolve `undefined`, o efeito é o mesmo, e o `void` vale em qualquer posição, até depois de um `return`. Com o gerador extraído de novo, os seis morreram pela asserção, no EM 1 ao 6, um cada.

- [x] **Passo 4: guarda e hashes depois.**

```powershell
$alvos = 'runtime/casa/esquemas.mjs', 'runtime/casa/loja-estados.mjs', 'runtime/estados.mjs', 'runtime/falhas.mjs', 'runtime/automacao-falhas.mjs', 'runtime/autoaperfeicoamento.mjs', 'runtime/atalhos.mjs', 'runtime/recibos-evolucao.mjs', 'runtime/feedback-personalidade.mjs', 'runtime/varredura-diaria.mjs'
$depois = $alvos | ForEach-Object { '{0} {1}' -f (Get-FileHash $_ -Algorithm SHA256).Hash.Substring(0, 12).ToLower(), $_ }
Compare-Object (Get-Content "$rascunho\t7-hashes-antes.txt") $depois
Test-Path "$env:LOCALAPPDATA\omni\casa"
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --conferir --so gerar-mutantes-p3.mjs mutantes.mjs tabela-mutantes-p3.mjs
```

Esperado: nenhuma linha do `Compare-Object`, `False` e `igual` nos três auxiliares.

Resultado (05/11): depois de cada rodada, nenhuma linha do `Compare-Object`, `False` e `igual` nos três.

- [x] **Passo 5: a tabela no plano.** O conteúdo de `$rascunho\tabela-mutantes-p3.md` vira o Apêndice A deste plano, com a legenda das siglas. Resultado (05/11): Apêndice A.

### Task 8: prova com os estados reais

Os testes provam as regras com estados pequenos, montados à mão. A prova roda o mesmo código nos oito estados reais, com o peso de verdade: o `failures.json` de 4,5 MB e uns 4 mil registros ao todo. O script do bloco abaixo copia só os oito arquivos do catálogo para uma pasta temporária e mede nove passos numa casa descartável. Ele lê a casa real sem trava e sem escrever nada nela, recusa pasta da prova dentro de `%APPDATA%\omni` ou de `%LOCALAPPDATA%\omni`, imprime só contagens, hashes curtos e tempos, nunca texto nem valor, e apaga a pasta no fim. Nenhum arquivo do repositório muda nesta tarefa.

A cópia só aceita arquivo na forma canônica: se a leitura pegar uma escrita da sessão viva no meio, ela relê, até 10 vezes, a cada 100 ms. A `failure-automation` muda umas 25 vezes em 20 min (tabela das medições), por isso as contagens saem da cópia na hora, e as duas rodadas podem copiar estados diferentes.

Os nove passos:
1. **A varredura importa os oito.** `reconciliarEstados` devolve `importada` nos oito. O banco recompõe cada arquivo byte a byte, com as contagens da cópia, o relógio à parte, base igual ao hash e versão 1. Cada arquivo ganha uma `.antes-da-casa` com os bytes originais e fica intocado. O `_importacoes` tem uma linha por arquivo, e o diário, só as inserções: 8 estados e um registro por item de coleção.
2. **A segunda varredura não muda nada:** `presente` nos p2 e `atual` nos espelhos. Diário, importações, cópias e arquivos ficam iguais.
3. **A carga pela ponte, um dono por vez,** com a versão exportada pelo dono e um validador que só conta chamadas. Cada carga devolve o texto do arquivo sem validar nada, porque o hash bate e a decisão para em `atual`. O tempo sai por arquivo.
4. **A escrita que muda só o relógio,** nos seis p2: `store.updatedAt` novo, pela `gravarTextoDoEstado`. Nenhuma linha nova no diário, estado e registros seguem na versão 1, e relógio, hash e base acompanham. O tempo sai por arquivo, para comparar com os 13 a 89 ms do protótipo (medições).
5. **A edição de um padrão:** o `updatedAt` do padrão do meio do `failures.json` recebe o relógio do Passo 4. O diário ganha exatamente um `U`, o desse registro. Os demais registros e o estado seguem na versão 1.
6. **O `shortcuts.json` apagado volta pela carga:** a `carregarTextoDoEstado` devolve o texto e recria o arquivo byte a byte, sem validar e sem diário.
7. **O `failures.json` quebrado (`xx{`), lido pelo dono real.** A `lerFalhas`, com a política e o validador de verdade, recebe o estado do banco, com o padrão editado. O arquivo volta byte a byte, os bytes quebrados vão para uma `.invalida` e o `degradacoes.jsonl` ganha uma linha, `estado.arquivo-invalido`.
8. **O espelho `personality-owner-directions.json` apagado volta pela varredura:** `projetada` nele, `atual` no outro espelho e `presente` nos p2.
9. **Fechamento.** `integrity_check` e `foreign_key_check` limpos. Nos oito, arquivo, recomposição, hash e base batem. Registros vivos = itens da cópia, nenhuma lápide. O diário tem as inserções do Passo 1 e o `U` do Passo 5, e a única degradação é a do Passo 7. O script imprime o tamanho do `omni.db`, do WAL e do `degradacoes.jsonl`.

**Auxiliar fora do repo:** `$rascunho\prova-estados.mjs`. Roda da raiz do repositório e importa os módulos de `runtime/` por ela.

```js rascunho=prova-estados.mjs
// Prova da T8: os oito estados reais, copiados para uma casa descartável, passam pela casa SQLite.
// Uso, da raiz do repositório: node prova-estados.mjs .
// A casa real só é lida, para a cópia, sem trava e sem escrita. Imprime só contagens, hashes
// curtos e tempos, nunca texto nem valor, e apaga a pasta da prova no fim.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as esperar } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

delete process.env.OMNI_CASA_BANCO
delete process.env.OMNI_CASA_SEM_SQLITE
const raiz = pathToFileURL(join(resolve(process.argv[2] ?? '.'), 'runtime') + sep).href
const banco = await import(`${raiz}casa/banco.mjs`)
const loja = await import(`${raiz}casa/loja-estados.mjs`)
const estados = await import(`${raiz}estados.mjs`)
const falhas = await import(`${raiz}falhas.mjs`)
const { FAILURE_AUTOMATION_SCHEMA_VERSION } = await import(`${raiz}automacao-falhas.mjs`)
const { SELF_IMPROVEMENT_SCHEMA_VERSION } = await import(`${raiz}autoaperfeicoamento.mjs`)
const { SHORTCUT_STORE_SCHEMA_VERSION } = await import(`${raiz}atalhos.mjs`)
const { RECIBOS_SCHEMA_VERSION } = await import(`${raiz}recibos-evolucao.mjs`)
const { PERSONALITY_FEEDBACK_SCHEMA_VERSION } = await import(`${raiz}feedback-personalidade.mjs`)

const F = 'learning/failures.json'
const S = 'learning/shortcuts.json'
const O = 'feedback/personality-owner-directions.json'
// A versão que cada dono p2 exporta; os espelhos são v1.
const VERSOES = {
  [F]: falhas.FAILURE_STORE_SCHEMA_VERSION,
  'learning/failure-automation.json': FAILURE_AUTOMATION_SCHEMA_VERSION,
  'learning/self-improvement.json': SELF_IMPROVEMENT_SCHEMA_VERSION,
  [S]: SHORTCUT_STORE_SCHEMA_VERSION,
  'learning/evolution-receipts.json': RECIBOS_SCHEMA_VERSION,
  'feedback/personality-feedback.json': PERSONALITY_FEEDBACK_SCHEMA_VERSION
}
const rels = Object.keys(loja.CATALOGO)
const donos = rels.filter((rel) => loja.CATALOGO[rel].modo === 'p2')

const casaReal = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'omni')
const bancoReal = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'omni')
const normal = (caminho) => { try { return realpathSync.native(caminho).toLowerCase() } catch { return resolve(caminho).toLowerCase() } }
const dentro = (filho, pai) => { const r = relative(normal(pai), normal(filho)); return r === '' || (!r.startsWith('..') && !isAbsolute(r)) }
const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'omni-prova-p3-')))
const casa = join(base, 'casa')
if ([casaReal, bancoReal].some((real) => dentro(base, real) || dentro(real, base)) || !dentro(banco.pastaDoBanco(casa), base)) {
  rmSync(base, { recursive: true, force: true })
  throw new Error('pasta da prova caiu dentro da casa real, ou o banco cairia fora dela')
}

const sha = banco.sha256
const arq = (rel) => join(casa, ...rel.split('/'))
const ler = (caminho) => { try { return readFileSync(caminho, 'utf8') } catch (erro) { if (erro.code === 'ENOENT') return null; throw erro } }
const canonico = (texto) => { try { return `${JSON.stringify(JSON.parse(texto), null, 2)}\n` === texto } catch { return false } }
const colecoesDe = (texto) => Object.fromEntries(Object.entries(JSON.parse(texto)).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length]))
const soma = (porColecao) => Object.values(porColecao).reduce((total, n) => total + n, 0)
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const ordenado = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
const mesmo = (a, b) => igual(ordenado(a), ordenado(b))
const porModo = (doDono, doEspelho) => Object.fromEntries(rels.map((rel) => [rel, loja.CATALOGO[rel].modo === 'p2' ? doDono : doEspelho]))
const marcas = () => Object.fromEntries(rels.map((rel) => [rel, statSync(arq(rel)).mtimeMs]))
const noDisco = () => Object.fromEntries(rels.map((rel) => [rel, ler(arq(rel))]))
const copias = (rel, tipo) => readdirSync(dirname(arq(rel))).filter((nome) => nome.startsWith(`${basename(arq(rel))}.${tipo}.`))
  .map((nome) => readFileSync(join(dirname(arq(rel)), nome), 'utf8'))
const degradacoes = () => (ler(join(banco.pastaDoBanco(casa), 'degradacoes.jsonl')) ?? '').split('\n').filter(Boolean)
  .map((linha) => JSON.parse(linha).operacao)
const confere = (condicao, texto, detalhe) => {
  console.log(`${condicao ? 'ok   ' : 'FALHA'} ${texto}${!condicao && detalhe !== undefined ? ` ${JSON.stringify(detalhe)}` : ''}`)
  if (!condicao) process.exitCode = 1
}
async function medir(passo, rotulo, executar) {
  const inicio = performance.now()
  const resultado = await executar()
  console.log(`Passo ${passo}: ${rotulo.padEnd(44)} ${(performance.now() - inicio).toFixed(0).padStart(6)} ms`)
  return resultado
}
const porArquivo = (tempos) => { for (const [rel, ms] of Object.entries(tempos)) console.log(`   ${rel.padEnd(44)} ${ms.toFixed(1).padStart(7)} ms`) }

const noBanco = (uso) => banco.comBancoDaCasa(casa, 'omni', uso)
// Cada estado como o banco o vê: hash, relógio, versão, base desta máquina, recomposição,
// contagens e quantos registros vivos há em cada versão.
const estadosNoBanco = () => noBanco((db) => Object.fromEntries(rels.map((rel) => {
  const linha = db.prepare('SELECT texto_sha256, relogio, versao FROM estados WHERE id = ? AND apagado_em IS NULL').get(rel)
  if (!linha) return [rel, null]
  const versoes = db.prepare('SELECT versao, COUNT(*) AS n FROM estado_registros WHERE arquivo = ? AND apagado_em IS NULL GROUP BY versao').all(rel)
  return [rel, {
    sha: linha.texto_sha256,
    relogio: linha.relogio,
    versao: linha.versao,
    base: loja.baseNoDisco(db, rel),
    texto: loja.recomporEstado(db, rel),
    contagens: loja.contarEstado(db, rel),
    versoes: Object.fromEntries(versoes.map((l) => [l.versao, l.n]))
  }]
})))
const geral = () => noBanco((db) => ({
  diario: Object.fromEntries(db.prepare('SELECT tabela, operacao, COUNT(*) AS n FROM _diario GROUP BY tabela, operacao').all()
    .map((l) => [`${l.tabela}:${l.operacao}`, l.n])),
  atualizados: db.prepare("SELECT linha FROM _diario WHERE operacao = 'U' ORDER BY seq").all().map((l) => l.linha),
  importacoes: db.prepare("SELECT fonte, fonte_sha256, contagens FROM _importacoes WHERE tipo = 'estados'").all()
    .map((l) => ({ fonte: l.fonte, sha: l.fonte_sha256, contagens: JSON.parse(l.contagens) })),
  vivos: db.prepare('SELECT COUNT(*) AS n FROM estado_registros WHERE apagado_em IS NULL').get().n,
  lapides: db.prepare(`SELECT (SELECT COUNT(*) FROM estados WHERE apagado_em IS NOT NULL)
    + (SELECT COUNT(*) FROM estado_registros WHERE apagado_em IS NOT NULL) AS n`).get().n,
  bases: db.prepare('SELECT COUNT(*) AS n FROM _estados_no_disco WHERE maquina = ?').get(banco.maquinaAtual()).n,
  integridade: db.prepare('PRAGMA integrity_check').get().integrity_check,
  orfas: db.prepare('PRAGMA foreign_key_check').all().length
}))

try {
  // A cópia: só os oito do catálogo e só na forma canônica. Leitura que pega uma escrita da sessão
  // viva no meio é refeita, até 10 vezes, a cada 100 ms.
  const copia = {}
  let leituras = 0
  for (const rel of rels) {
    let texto = null
    for (let tentativa = 1; texto === null; tentativa += 1) {
      leituras += 1
      const lido = readFileSync(join(casaReal, ...rel.split('/')), 'utf8')
      if (canonico(lido)) texto = lido
      else if (tentativa === 10) throw new Error(`${rel} fora da forma canônica em 10 leituras`)
      else await esperar(100)
    }
    mkdirSync(dirname(arq(rel)), { recursive: true })
    writeFileSync(arq(rel), texto)
    copia[rel] = texto
  }
  const contagens = Object.fromEntries(rels.map((rel) => [rel, colecoesDe(copia[rel])]))
  const total = rels.reduce((n, rel) => n + soma(contagens[rel]), 0)
  const bytes = rels.reduce((n, rel) => n + Buffer.byteLength(copia[rel]), 0)
  const agregado = sha(rels.map((rel) => `${rel} ${sha(copia[rel])}`).join('\n'))
  console.log(`node ${process.versions.node}; cópia: ${rels.length} estados, ${total} registros, ${bytes} bytes, ${leituras} leituras; agregado ${agregado.slice(0, 12)}`)
  for (const rel of rels) {
    const resumo = Object.entries(contagens[rel]).map(([colecao, n]) => `${colecao} ${n}`).join(', ')
    console.log(`   ${rel.padEnd(44)} ${String(Buffer.byteLength(copia[rel])).padStart(8)} B  v${JSON.parse(copia[rel]).schemaVersion}  ${resumo}`)
  }
  confere(igual([...donos].sort(), Object.keys(VERSOES).sort()), 'os seis p2 do catálogo têm a versão exportada pelo dono')
  confere(rels.every((rel) => JSON.parse(copia[rel]).schemaVersion === (VERSOES[rel] ?? 1)), 'cada cópia está na versão do dono (1 nos espelhos)')
  const versao1 = (rel) => (soma(contagens[rel]) === 0 ? {} : { 1: soma(contagens[rel]) })
  const marcas0 = marcas()

  const r1 = await medir(1, 'a varredura importa os oito', () => estados.reconciliarEstados(casa))
  confere(r1.resultado === 'feita' && mesmo(r1.arquivos, porModo('importada', 'importada')), 'importada nos oito', r1.arquivos)
  const b1 = estadosNoBanco()
  confere(rels.every((rel) => b1[rel]?.sha === sha(copia[rel]) && b1[rel].texto === copia[rel]), 'hash e recomposição byte a byte iguais à cópia, nos oito')
  confere(rels.every((rel) => mesmo(b1[rel].contagens, contagens[rel]) && mesmo(b1[rel].versoes, versao1(rel))),
    'contagens da cópia e registros na versão 1, nos oito')
  confere(rels.every((rel) => b1[rel].relogio === (JSON.parse(copia[rel]).store?.updatedAt ?? null) && b1[rel].base === b1[rel].sha && b1[rel].versao === 1),
    'relógio à parte, base = hash e estado na versão 1, nos oito')
  confere(rels.every((rel) => igual(copias(rel, 'antes-da-casa'), [copia[rel]])), 'uma .antes-da-casa por arquivo, com os bytes originais')
  confere(mesmo(marcas(), marcas0) && igual(noDisco(), copia), 'os oito arquivos intocados (bytes e mtime)')
  const g1 = geral()
  confere(g1.importacoes.length === 8 && rels.every((rel) => {
    const linha = g1.importacoes.find((i) => i.fonte === rel)
    return linha?.sha === sha(copia[rel]) && mesmo(linha.contagens, contagens[rel])
  }), '_importacoes: uma por arquivo, com o hash da fonte e as contagens')
  const diario1 = { 'estados:I': 8, 'estado_registros:I': total }
  confere(mesmo(g1.diario, diario1), `diário: 8 estados e ${total} registros inseridos`, g1.diario)
  confere(g1.bases === 8 && g1.integridade === 'ok' && g1.orfas === 0 && degradacoes().length === 0,
    '8 bases, integrity_check ok, nenhuma chave órfã, nenhuma degradação')

  const r2 = await medir(2, 'a segunda varredura não muda nada', () => estados.reconciliarEstados(casa))
  confere(mesmo(r2.arquivos, porModo('presente', 'atual')), 'presente nos p2, atual nos espelhos', r2.arquivos)
  const g2 = geral()
  confere(mesmo(g2.diario, diario1) && g2.importacoes.length === 8 && rels.every((rel) => copias(rel, 'antes-da-casa').length === 1),
    'diário, importações e cópias estáveis', g2.diario)
  confere(mesmo(marcas(), marcas0) && igual(noDisco(), copia), 'arquivos intocados')

  let validacoes = 0
  const validar = () => { validacoes += 1 }
  const carga = {}
  const devolvidos = await medir(3, 'a carga pela ponte, um dono por vez', () => Object.fromEntries(donos.map((rel) => {
    const inicio = performance.now()
    const texto = estados.carregarTextoDoEstado(casa, rel, { versao: VERSOES[rel], validar })
    carga[rel] = performance.now() - inicio
    return [rel, texto]
  })))
  porArquivo(carga)
  confere(donos.every((rel) => devolvidos[rel] === copia[rel]), 'cada carga devolve o texto do arquivo')
  confere(validacoes === 0, 'nenhuma validação: o hash bate e a decisão para em atual')
  confere(mesmo(geral().diario, diario1) && mesmo(marcas(), marcas0), 'diário e arquivos intocados')

  const textos4 = {}
  const relogios4 = {}
  const escrita = {}
  await medir(4, 'a escrita que muda só o relógio, nos seis', () => {
    for (const rel of donos) {
      const doc = JSON.parse(copia[rel])
      const agora = new Date().toISOString()
      doc.store.updatedAt = agora === doc.store.updatedAt ? new Date(Date.parse(agora) + 1).toISOString() : agora
      relogios4[rel] = doc.store.updatedAt
      textos4[rel] = `${JSON.stringify(doc, null, 2)}\n`
      const inicio = performance.now()
      estados.gravarTextoDoEstado(casa, rel, textos4[rel])
      escrita[rel] = performance.now() - inicio
    }
  })
  porArquivo(escrita)
  const b4 = estadosNoBanco()
  confere(donos.every((rel) => textos4[rel] !== copia[rel] && ler(arq(rel)) === textos4[rel]), 'arquivo = texto novo, diferente da cópia, nos seis')
  confere(donos.every((rel) => b4[rel].sha === sha(textos4[rel]) && b4[rel].base === b4[rel].sha && b4[rel].texto === textos4[rel]),
    'hash, base e recomposição acompanham, nos seis')
  confere(donos.every((rel) => b4[rel].relogio === relogios4[rel] && b4[rel].versao === 1 && mesmo(b4[rel].versoes, versao1(rel))),
    'relógio novo no banco; estado e registros seguem na versão 1')
  confere(mesmo(geral().diario, diario1), 'nenhuma linha nova no diário')

  const docF = JSON.parse(textos4[F])
  const k = Math.floor(docF.patterns.length / 2)
  const registroEditado = `${F}|patterns|${loja.linhasDe(docF.patterns)[k].chave}`
  const antes5 = docF.patterns[k].updatedAt
  docF.patterns[k].updatedAt = relogios4[F]
  const texto5 = `${JSON.stringify(docF, null, 2)}\n`
  await medir(5, 'a edição de um padrão no failures.json', () => estados.gravarTextoDoEstado(casa, F, texto5))
  const b5 = estadosNoBanco()
  const g5 = geral()
  confere(antes5 !== relogios4[F] && ler(arq(F)) === texto5 && b5[F].texto === texto5 && b5[F].base === sha(texto5),
    'arquivo, recomposição e base com o padrão editado')
  confere(mesmo(g5.diario, { ...diario1, 'estado_registros:U': 1 }) && igual(g5.atualizados, [registroEditado]),
    'diário: um U, o do padrão editado', g5.diario)
  confere(mesmo(b5[F].versoes, { 1: soma(contagens[F]) - 1, 2: 1 }) && b5[F].versao === 1 && b5[F].relogio === relogios4[F],
    'um registro na versão 2, os demais e o estado na 1, relógio igual')

  unlinkSync(arq(S))
  validacoes = 0
  const t6 = await medir(6, 'o shortcuts.json apagado volta pela carga', () => estados.carregarTextoDoEstado(casa, S, { versao: VERSOES[S], validar }))
  confere(t6 === textos4[S] && ler(arq(S)) === textos4[S], 'a carga devolve e recria o arquivo byte a byte')
  confere(estadosNoBanco()[S].base === sha(textos4[S]) && validacoes === 0 && mesmo(geral().diario, g5.diario), 'base confirmada, sem validação, sem diário')

  writeFileSync(arq(F), 'xx{')
  const doc7 = await medir(7, 'o failures.json quebrado, lido pelo dono', () => falhas.lerFalhas(casa))
  confere(doc7.patterns.length === docF.patterns.length && doc7.patterns[k].updatedAt === relogios4[F], 'o dono recebe o estado do banco, com o padrão editado')
  confere(ler(arq(F)) === texto5 && estadosNoBanco()[F].base === sha(texto5), 'o arquivo volta byte a byte e a base acompanha')
  confere(igual(copias(F, 'invalida'), ['xx{']), 'uma .invalida com os bytes quebrados')
  confere(igual(degradacoes(), ['estado.arquivo-invalido']), 'uma degradação: estado.arquivo-invalido')
  confere(mesmo(geral().diario, g5.diario) && !existsSync(join(casa, 'learning', 'failures.lock')), 'diário intocado e trava do dono solta')

  unlinkSync(arq(O))
  const r8 = await medir(8, 'o espelho apagado volta pela varredura', () => estados.reconciliarEstados(casa))
  confere(mesmo(r8.arquivos, { ...porModo('presente', 'atual'), [O]: 'projetada' }), 'projetada no apagado, atual no outro espelho, presente nos p2', r8.arquivos)
  confere(ler(arq(O)) === copia[O] && estadosNoBanco()[O].base === sha(copia[O]), 'o espelho volta byte a byte e a base acompanha')

  console.log('Fechamento:')
  const finais = { ...copia, ...textos4, [F]: texto5 }
  const b9 = estadosNoBanco()
  const g9 = geral()
  confere(rels.every((rel) => {
    const texto = ler(arq(rel))
    return texto === finais[rel] && b9[rel].texto === texto && b9[rel].sha === sha(texto) && b9[rel].base === b9[rel].sha
  }), 'nos oito: arquivo = esperado = recomposição, e hash = base')
  confere(g9.integridade === 'ok' && g9.orfas === 0, 'integrity_check ok e nenhuma chave órfã')
  confere(g9.vivos === total && g9.lapides === 0 && g9.bases === 8, `${total} registros vivos, nenhuma lápide, 8 bases`)
  confere(mesmo(g9.diario, { ...diario1, 'estado_registros:U': 1 }), `diário final: ${8 + total} inserções e 1 atualização`, g9.diario)
  confere(igual(degradacoes(), ['estado.arquivo-invalido']), 'degradações: só a do Passo 7')
  const pasta = banco.pastaDoBanco(casa)
  const tamanho = (nome) => { try { return statSync(join(pasta, nome)).size } catch { return 0 } }
  console.log(`   omni.db ${tamanho('omni.db')} bytes + wal ${tamanho('omni.db-wal')}; degradações: ${tamanho('degradacoes.jsonl')} bytes`)
} catch (erro) {
  process.exitCode = 1
  const onde = String(erro?.stack ?? '').split('\n').find((linha) => linha.trim().startsWith('at ')) ?? ''
  console.log(`ERRO ${erro?.name ?? 'Error'}${erro?.code ? ` ${erro.code}` : ''}: ${erro instanceof SyntaxError ? 'JSON inválido' : String(erro?.message ?? erro).slice(0, 300)} ${onde.trim()}`)
} finally {
  rmSync(base, { recursive: true, force: true, maxRetries: 5 })
  console.log(`pasta da prova removida: ${!existsSync(base)}`)
}
```

- [x] **Passo 1: extrair.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-05-f1-plano-3-estados-aprendizado-feedback.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so prova-estados.mjs
```

Esperado: `gravado prova-estados.mjs`. Resultado (05/11): `gravado prova-estados.mjs`, e o `node --check` passou limpo.

- [x] **Passo 2: guarda antes.** `Test-Path "$env:LOCALAPPDATA\omni\casa"` dá `False`. Resultado (05/11): `False`.

- [x] **Passo 3: rodar nos dois Nodes.**

```powershell
node "$rascunho\prova-estados.mjs" .
& $node22 "$rascunho\prova-estados.mjs" .
```

(`$node22` é o `node.exe` de um Node 22, fora do PATH.) Esperado: toda conferência `ok`, `pasta da prova removida: true` e saída 0 nas duas.

Resultado (05/11): saída 0 e todas as conferências `ok` nos dois Nodes. Cada cópia tinha 8 estados, 4062 registros e 6.225.408 bytes, lidos sem releitura (8 leituras); o `failures.json` tinha 3300 padrões. Tamanhos e contagens foram iguais nas duas rodadas, mas o agregado mudou (`019bf779b108` e `50756febe8ff`): a sessão viva reescreveu ao menos um arquivo entre elas, sem mudar o tamanho.

| Passo | Node 24.17.0 | Node 22.23.4 |
|---|---|---|
| 1. a varredura importa os oito | 1173 ms | 732 ms |
| 2. a segunda varredura | 54 ms | 46 ms |
| 3. a carga pela ponte, nos seis | 79 ms | 93 ms |
| 4. a escrita só do relógio, nos seis | 305 ms | 278 ms |
| 5. a edição de um padrão | 148 ms | 131 ms |
| 6. o `shortcuts.json` apagado volta | 22 ms | 18 ms |
| 7. o `failures.json` quebrado, lido pelo dono | 194 ms | 173 ms |
| 8. o espelho apagado volta | 73 ms | 55 ms |

Por arquivo, em ms:

| Arquivo | Carga (3), Node 24 | Carga (3), Node 22 | Escrita (4), Node 24 | Escrita (4), Node 22 |
|---|---|---|---|---|
| `failures.json` | 43,5 | 55,3 | 131,0 | 129,1 |
| `failure-automation.json` | 6,7 | 5,5 | 23,4 | 19,5 |
| `self-improvement.json` | 14,3 | 18,4 | 49,0 | 45,2 |
| `shortcuts.json` | 4,1 | 3,8 | 24,1 | 15,0 |
| `evolution-receipts.json` | 5,2 | 4,8 | 21,1 | 16,3 |
| `personality-feedback.json` | 5,6 | 4,8 | 27,9 | 17,9 |

Passo a passo:
- 1: `importada` nos oito. Hash, recomposição byte a byte, contagens e relógio iguais aos da cópia; base igual ao hash; estado e registros na versão 1. Uma `.antes-da-casa` por arquivo, com os bytes originais, e os oito arquivos intocados (bytes e mtime). Oito linhas no `_importacoes` e, no diário, 8 + 4062 inserções.
- 2: `presente` nos p2 e `atual` nos espelhos; diário, importações, cópias e arquivos iguais.
- 3: cada carga devolveu o texto do arquivo, com 0 validações.
- 4: nenhuma linha nova no diário, relógio novo no banco, estado e registros na versão 1. Cinco escritas ficaram entre 15 e 49 ms, dentro dos 13 a 89 ms do protótipo; a do `failures.json` levou 131 e 129 ms. O item 16 do desenho estimava de 10 a 40 ms para ler e gravar o arquivo com a trava do banco presa, mas a decomposição e a comparação dos 3300 registros também correm sob ela. O item agora traz a medida.
- 5: um `U` no diário, o do padrão editado; 3299 registros na versão 1 e um na 2; o estado segue na 1.
- 6: o `shortcuts.json` voltou byte a byte, sem validação e sem diário.
- 7: a `lerFalhas` recebeu os 3300 padrões, com o editado. O arquivo voltou byte a byte, a `.invalida` guardou os bytes `xx{`, o `degradacoes.jsonl` ganhou uma linha `estado.arquivo-invalido` e a `failures.lock` foi solta.
- 8: `projetada` no espelho apagado, `atual` no outro e `presente` nos p2; o espelho voltou byte a byte.
- Fechamento: `integrity_check` ok, nenhuma chave órfã, 4062 registros vivos, nenhuma lápide, 8 bases, diário com 4070 inserções e 1 atualização, e só a degradação do Passo 7.

Nos dois Nodes:
- `omni.db` com 8.613.888 bytes, WAL zerado, `degradacoes.jsonl` com 171 bytes e a pasta da prova removida;
- o Passo 1 levou 1173 ms no Node 24, que rodou primeiro, e 732 ms no 22; a causa da diferença não foi medida.

- [x] **Passo 4: guarda depois.** `Test-Path "$env:LOCALAPPDATA\omni\casa"` dá `False`. Resultado (05/11): `False`, e nenhuma pasta `omni-prova-p3-*` sobrou no `%TEMP%`.

### Task 9: as suítes afetadas

A lista sai do grafo, não da mão. O `afetadas-p3.mjs` parte dos dez arquivos de `runtime/` que este plano muda e devolve cada suíte que carrega um deles: direta, quando a suíte importa ou cita o arquivo, e indireta, quando chega a ele por outro módulo. O esquema v3 entra pelo `banco.mjs`, então toda suíte que abre o `omni.db` aparece, inclusive as da memória e dos documentos, e a `integridade-release` vem junto, com o vermelho de nascença `:165` (item 6). Processo filho com caminho montado em pedaços escapa do grafo, e por isso a T10 roda tudo. Nenhum arquivo do repositório muda nesta tarefa.

**Auxiliar fora do repo:** `$rascunho\afetadas-p3.mjs`. Roda da raiz do repositório.

```js rascunho=afetadas-p3.mjs
// Lista as suítes testes/*.test.mjs que carregam um módulo tocado pelo plano 3, direta ou
// indiretamente. Segue imports relativos (from, import de efeito, import() e new URL com texto
// literal); na suíte, um caminho runtime/*.mjs citado em texto também conta. dist/ fica de fora:
// o plano não o muda. Uso, da raiz do repositório: node afetadas-p3.mjs [--lista]
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const raiz = process.cwd()
const tocados = ['casa/esquemas', 'casa/loja-estados', 'estados', 'falhas', 'automacao-falhas', 'autoaperfeicoamento',
  'atalhos', 'recibos-evolucao', 'feedback-personalidade', 'varredura-diaria'].map((m) => resolve(raiz, 'runtime', `${m}.mjs`))
const especificador = /\bfrom\s*(['"])(\.{1,2}\/[^'"]+)\1|\bimport\s*\(?\s*(['"])(\.{1,2}\/[^'"]+)\3|new URL\(\s*(['"])(\.{1,2}\/[^'"]+)\5\s*,\s*import\.meta\.url/g
const citado = /\bruntime\/[\w./-]+\.m?js\b/g

const naArvore = (arquivo) => /\.(mjs|js)$/.test(arquivo) && existsSync(arquivo) &&
  !relative(raiz, arquivo).split(sep).some((parte) => parte === 'dist' || parte === 'node_modules' || parte === '..')

function dependencias(arquivo, comCitacoes) {
  const texto = readFileSync(arquivo, 'utf8')
  const achados = new Set()
  for (const m of texto.matchAll(especificador)) {
    achados.add(resolve(dirname(arquivo), (m[2] ?? m[4] ?? m[6]).replace(/[?#].*$/, '')))
  }
  if (comCitacoes) for (const [caminho] of texto.matchAll(citado)) achados.add(resolve(raiz, caminho))
  return [...achados].filter(naArvore)
}

// O grafo inteiro a partir das suítes; depois, de trás para frente a partir dos tocados.
const suites = readdirSync(join(raiz, 'testes')).filter((n) => n.endsWith('.test.mjs')).sort()
  .map((nome) => ({ nome, deps: dependencias(join(raiz, 'testes', nome), true) }))
const quemImporta = new Map()
const visto = new Set()
const fila = suites.flatMap((s) => s.deps)
while (fila.length > 0) {
  const arquivo = fila.pop()
  if (visto.has(arquivo)) continue
  visto.add(arquivo)
  for (const dep of dependencias(arquivo, false)) {
    if (!quemImporta.has(dep)) quemImporta.set(dep, new Set())
    quemImporta.get(dep).add(arquivo)
    fila.push(dep)
  }
}
const alcancam = new Set(tocados)
const volta = [...tocados]
while (volta.length > 0) {
  for (const importador of quemImporta.get(volta.pop()) ?? []) {
    if (!alcancam.has(importador)) {
      alcancam.add(importador)
      volta.push(importador)
    }
  }
}

const diretas = suites.filter((s) => s.deps.some((d) => tocados.includes(d))).map((s) => s.nome)
const indiretas = suites.filter((s) => !diretas.includes(s.nome) && s.deps.some((d) => alcancam.has(d))).map((s) => s.nome)
if (process.argv.includes('--lista')) {
  for (const nome of [...diretas, ...indiretas]) console.log(`testes/${nome}`)
} else {
  console.log(`diretas ${diretas.length}: ${diretas.map((n) => n.replace('.test.mjs', '')).join(', ')}`)
  console.log(`indiretas ${indiretas.length}: ${indiretas.map((n) => n.replace('.test.mjs', '')).join(', ')}`)
}
```

- [x] **Passo 1: extrair e listar.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-05-f1-plano-3-estados-aprendizado-feedback.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so afetadas-p3.mjs
node --check "$rascunho\afetadas-p3.mjs"
node "$rascunho\afetadas-p3.mjs"
```

Esperado: `gravado afetadas-p3.mjs`, o `node --check` calado e duas linhas.
- `diretas 26`: acao-subagente-hook-real, atalhos, auditoria-setembro, auditoria-sistema, autoaperfeicoamento, automacao-falhas, automacao-melhorias, casa-banco, casa-loja-estados, cli, contexto, continuacao-fila, diagnostico, estados-modulos, estados, executor-eval-personalidade, falhas, feedback-personalidade, hook-contexto, observador, pacote, proatividade-falhas, recibos-evolucao-veto, recibos-evolucao, teto-tentativas-falha e varredura-diaria.
- `indiretas 29`: acao-subagente-auditoria, adaptador-claude-delegacao, aprendizado-resultados, atualizacao, auditoria-autocorrecao, auditoria-desktop, casa-loja-documentos, casa-loja-memoria, ciclo-operacional, documentos-md, evolucao, historico-evals, hook-reconciliacao, hook-varredura, integridade-release, manutencao-memoria, memoria-casa, memoria-coordenador, memoria, objetivo-sessao, persistencia-contexto, pipeline-memoria, porta-delegacao, recuperacao, release-autonoma, release-operacional, release-session, sincronizacao-aprendizado-operacional e sincronizacao-memoria-duravel.

Resultado (05/11): `gravado afetadas-p3.mjs`, o `node --check` calado e as duas linhas exatamente como acima.

- [x] **Passo 2: guarda antes.** `Test-Path "$env:LOCALAPPDATA\omni\casa"` dá `False`. Resultado (05/11): `False`.

- [x] **Passo 3: rodar.** Uma rodada só, em segundo plano; a saída é lida no fim.

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$suites = @(node "$rascunho\afetadas-p3.mjs" --lista)
'suites: ' + $suites.Count
node --test --test-concurrency=1 --test-reporter=spec @suites *> "$rascunho\t9.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t9.txt" -Pattern '(tests|pass|fail|cancelled|skipped|duration_ms) [\d.]+\s*$', '\.test\.mjs:\d+:\d+'
```

Esperado: `suites: 55`, `saida: 1`, `fail 1` e `cancelled 0`, com a única falha em `testes\integridade-release.test.mjs:165`.

Resultado (05/11): igual ao esperado, em 426 s. Foram 547 testes: 546 passaram, 1 falhou, nenhum cancelado e nenhum pulado. O único vermelho é o contrato canônico do `:165`, que cai na asserção da linha 173. É o vermelho de nascença do item 6.

- [x] **Passo 4: guarda depois.** `Test-Path "$env:LOCALAPPDATA\omni\casa"` dá `False`. Resultado (05/11): `False`.

### Task 10: verify completo

Uma suíte pesada por vez: o verify só começa depois que a T9 termina. Ele roda em segundo plano, e a saída é lida no fim. Além dos totais, esta tarefa anota o fingerprint calculado do `:165` (item 6) e prova que o plano e o repositório dizem a mesma coisa (item 14). Nenhum arquivo do repositório muda: o `dist` que o build reescreve volta no Passo 5.

- [x] **Passo 1: guarda antes.** `Test-Path "$env:LOCALAPPDATA\omni\casa"` dá `False`. Resultado (05/11): `False`.

- [x] **Passo 2: verify.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
npm run verify *> "$rascunho\verify-p3.txt"; "saida: $LASTEXITCODE" | Out-File -Append -Encoding utf8 "$rascunho\verify-p3.txt"
```

Resultado (05/11): rodou em segundo plano e terminou em 427 s.

- [x] **Passo 3: ler o verify.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
Select-String -Path "$rascunho\verify-p3.txt" -Pattern '(tests|pass|fail|cancelled|skipped|duration_ms) [\d.]+\s*$', '\.test\.mjs:\d+:\d+', '^saida: ', '^\s+(actual|expected): ', '^\{"ok"'
```

Esperado:
- `tests 696`, `pass 691`, `fail 1`, `cancelled 0` e `skipped 4`;
- a única falha listada é `testes\integridade-release.test.mjs:165`;
- `actual` e `expected` com 64 dígitos hexadecimais cada. A linha 173 passa o contrato primeiro (`assert.equal(contract.identity.releaseFingerprint, actual.fingerprint)`), então o `actual` é o que `contratos/atualizacao/integridade.json` guarda (`3c60182bbef2…`), e o `expected` é o calculado, que o plano 8 grava no contrato;
- cinco linhas `{"ok":true,…}` com os números do plano 2: `contracts:check` (43 contratos) e `architecture:check` (59 fontes, 57 em TypeScript) duas vezes cada, porque o `check` repete os dois, e `package:check` (59 arquivos em `dist`, nenhuma dependência de execução) uma vez;
- `saida: 1`.

Base de comparação, o verify do plano 2: 645 testes. Os 51 a mais são CE 16, ES 23, EM 8, CB 1 e VD 3.

Resultado (05/11): 696 testes, como previsto, mas com um vermelho a mais: 690 passaram, 2 falharam, nenhum cancelado e 4 pulados, com `saida: 1`.
- O `:165` caiu como previsto, na linha 173. O `actual`, o contrato, é `3c60182bbef281d96b6782d614482b5e7459ce036468233c29eb6f1af3ef3df3`; o `expected`, o calculado com este plano, é `be11ab3853c007566bbd4d71c94a423a87ca94e7f3459b4da1b3366b42a8f17f`. É esse o valor que o plano 8 grava no contrato.
- O vermelho a mais é `testes\evolucao.test.mjs:348`, e não é asserção. O `rename` de `runtime/evolucao.mjs:269` deu `EPERM` ao trocar o `contratos/eval/casos-aprendidos.json` do repositório temporário do teste, escrito milissegundos antes. No Windows, esse é o sinal de outro processo segurando o destino. O caminho não passa por nenhum arquivo deste plano: os estados ficam na pasta `home` do teste, e o repositório é a pasta vizinha. Esse `rename` não tenta de novo, ao contrário do `escreverAtomico` (`runtime/casa/projecao.mjs:44-62`), que insiste por 2 s em `EPERM`, `EBUSY` e `EACCES`. A suíte passou na T9 com o código deste plano e, sozinha, passou três vezes seguidas, 11 de 11 em cada uma, com o comando abaixo. A nova tentativa no `rename` da evolução fica fora deste plano.
- As cinco linhas `{"ok":true,…}` vieram com os números esperados.

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
foreach ($rodada in 1..3) {
  node --test --test-concurrency=1 testes/evolucao.test.mjs *> "$rascunho\t10-evolucao-$rodada.txt"
  $saida = $LASTEXITCODE
  $totais = Select-String -Path "$rascunho\t10-evolucao-$rodada.txt" -Pattern '(tests|pass|fail|cancelled|skipped) \d+\s*$' | ForEach-Object { ($_.Line -replace '^\S+\s+', '').Trim() }
  'rodada ' + $rodada + ': saida ' + $saida + ' | ' + ($totais -join ', ')
}
```

- [x] **Passo 4: o que a falha conhecida mascara, rodado à parte.** O `npm test` para no primeiro vermelho (`&&`), então o `.test-dist`, o `test:dist` e o `verify:build` não rodam dentro do verify.

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
node --test --test-concurrency=1 .test-dist/testes/*.test.js *> "$rascunho\t10-test-dist-p3.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t10-test-dist-p3.txt" -Pattern '(tests|pass|fail) \d+\s*$'
npm run test:dist *> "$rascunho\t10-dist-production-p3.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t10-dist-production-p3.txt" -Pattern '(tests|pass|fail) \d+\s*$'
npm run verify:build *> "$rascunho\t10-verify-build-p3.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t10-verify-build-p3.txt" -Pattern '^\{"ok"'
```

Esperado: as três com `saida: 0`; `.test-dist` 55/55 e `test:dist` 1/1, os números do plano 2, porque este plano não muda `src/` nem os testes TypeScript; e `{"ok":true,"files":59}`.

Resultado (05/11): igual ao esperado: as três com `saida: 0`, `.test-dist` 55/55, `test:dist` 1/1 e `{"ok":true,"files":59}`.

- [x] **Passo 5: devolver o `dist` e conferir o que sobra.**

```powershell
git diff --ignore-cr-at-eol --stat -- dist
git checkout -- dist
git status --short
```

Esperado: o `diff` sem nenhuma linha de `--stat`, só com os avisos de LF (item 9), e o `status` com os 18 itens deste plano: doze `M` (o `package.json`, os oito módulos de `runtime/` e as suítes CB, FP e VD) e seis `??` (este plano, os dois módulos novos e as três suítes novas).

Resultado (05/11): igual ao esperado: só os avisos de LF, nenhuma linha de `--stat` e os 18 itens no `status`.

- [x] **Passo 6: o plano e o repositório dizem a mesma coisa.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-05-f1-plano-3-estados-aprendizado-feedback.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --conferir; "saida: $LASTEXITCODE"
```

Esperado: treze linhas `igual`, uma por bloco: os cinco `arquivo=` e os oito `rascunho=` (extrair-do-plano.mjs, t4-imports.mjs, mutante-sintaxe.mjs, gerar-mutantes-p3.mjs, mutantes.mjs, tabela-mutantes-p3.mjs, prova-estados.mjs e afetadas-p3.mjs). E `saida: 0`.

Resultado (05/11): as treze linhas `igual`, na ordem do plano, e `saida: 0`.

- [x] **Passo 7: guarda depois.** `Test-Path "$env:LOCALAPPDATA\omni\casa"` dá `False`. Resultado (05/11): `False`.

### Task 11: o desenho, commit, push e CI

Um commit só: os módulos, as suítes e o `package.json` só fazem sentido juntos, e o commit leva os documentos: este plano, o §3.8 novo do desenho, a linha 3 do escopo do plano 1 e a correção do item 4 do plano 2.

- [x] **Passo 1: o §3.8 no desenho.** O cabeçalho deste plano promete o §3.8, e ele entra aqui, à mão (item 14), em `docs/superpowers/specs/2026-11-04-casa-unica-tres-agentes-design.md`, entre o fim do §3.7 e o §4. A largura das linhas segue a prosa do §3.6, que não passa de 98 caracteres.

Antes:

```markdown
§5. É uma dependência externa a menos, que é o pedido de origem. Até essa decisão, nada é
desligado.

## 4. O executor
```

Depois:

```markdown
§5. É uma dependência externa a menos, que é o pedido de origem. Até essa decisão, nada é
desligado.

### 3.8 Estados de aprendizado e feedback no `omni.db`

Os oito estados JSON de `learning/` e `feedback/` seguem o molde do §3.6: o `omni.db` é a fonte
e o arquivo é a projeção, escrita byte a byte como o dono sempre gravou
(`JSON.stringify(doc, null, 2)` e a quebra de linha final). São as falhas, a automação de
falhas, o autoaperfeiçoamento, os atalhos, os recibos de evolução e o feedback de
personalidade, cujos seis donos em JavaScript carregam e gravam pela ponte
(`runtime/estados.mjs`), mais a continuidade e as direções do dono, escritas pela loja
TypeScript do `dist`, que fica como está e é espelhada pela varredura.

**Como guarda.** Cada estado vira um esqueleto em `estados` (o documento com as coleções vazias)
e um registro por item em `estado_registros`. As duas tabelas são dado vivo e entram na migração
v3, com duas exceções ao §3.1. O id é natural, não UUID v7: o do estado é o caminho relativo
(`learning/failures.json`) e o do registro é `<estado>|<coleção>|<chave>`, para que duas
máquinas que importam o mesmo estado cheguem aos mesmos ids e a F5 case as linhas em vez de
duplicá-las. E mudar a ordem sobe a versão do registro movido, porque aqui a ordem é parte do
documento: os recibos e os jobs encerrados da automação guardam só os 200 mais novos, contados
por posição. A regra da cauda, que só renumera da primeira quebra em diante, mantém os movidos
no mínimo. A chave é o campo indicado no catálogo; senão o `id`, quando é texto; senão o
próprio item, quando é texto de até 200 caracteres; senão `h:` e 32 dígitos hexadecimais do
sha256 do item. Chave repetida ganha `#1`, `#2` e assim por diante. A recomposição é conferida
por hash. O `store.updatedAt` é o relógio local da linha: não sobe versão nem vai ao diário.
Item que sai da coleção vira lápide; o estado inteiro, não: arquivo apagado volta do banco.

**Três hashes decidem.** Disco, banco vivo e a base desta máquina, guardada em
`_estados_no_disco`: interna e sem diário, porque é estado local de cada máquina, não dado a
sincronizar. As decisões são `vazia`, `intocada`, `importada`, `projetada`, `atual`,
`socorrida`, `defasada` e `ingerida`. A diferença para o §3.6 é a base por máquina no lugar da
`_projecoes`: voltar o arquivo a um texto antigo é edição, e o disco vence. O relógio não serve
de juiz, porque muda em toda escrita.

**Uma transação, sob a trava do dono.** Leitura do arquivo, decisão, cópia, projeção e base
acontecem no mesmo `BEGIN IMMEDIATE`, para que quem decide veja o disco e o banco do mesmo
instante. Os donos já tinham trava; os recibos de evolução ganham a sua
(`learning/evolution-receipts.lock`). O custo é a trava de escrita do banco presa enquanto o
arquivo é lido e escrito: de 10 a 40 ms na leitura do `failures.json` de 4,5 MB e uns 130 ms na
escrita inteira dele. Os leitores sem trava seguem no arquivo, que a projeção mantém em dia.

**Primeira importação.** Acontece na primeira carga de cada dono com o código novo. Os bytes de
antes ficam ao lado, em `<arquivo>.antes-da-casa.<carimbo>`: é a cópia datada do §4.2, mas o
original não congela, porque o banco passa a projetar por cima dele. `_importacoes` ganha uma
linha só nessa primeira vez; as ingestões seguintes não registram. A varredura diária importa os
estados que nenhum dono carregou e espelha os dois da loja TypeScript sob a trava dela.

**Degradação, nunca queda.** As operações em `degradacoes.jsonl` são `estado.carregar`,
`estado.gravar`, `estado.projetar`, `estado.copia`, `estado.arquivo-invalido`, `estado.espelho`
e `estados.varredura`, sempre sem conteúdo de estado. Arquivo quebrado com linha no banco é
guardado em `.invalida.<carimbo>`, e só então o banco projeta, se o que ele guarda passa no
validador do dono; se a cópia falhar, nada é tocado. Versão mais nova ou fora do contrato do
dono fica intocada: o dono recebe o texto como está. Sem arquivo e com banco que não abre, a
carga lança, porque devolver vazio faria o dono gravar um estado novo por cima do que o banco
guarda. Sem SQLite, volta a ser só o arquivo.

**Fora, por enquanto.** `learning/daily-scan.json` é o estado da própria varredura que dispara a
reconciliação. `learning/live-coverage.json` (8 MB, reescrito várias vezes por hora),
`audits/self-correction.json` e `runs/operational-cycle.json` têm o mesmo padrão de reescrita
inteira e frequente; os três pedem um plano próprio.

## 4. O executor
```

```powershell
$desenho = 'docs\superpowers\specs\2026-11-04-casa-unica-tres-agentes-design.md'
$linhas = [IO.File]::ReadAllLines((Resolve-Path $desenho))
$ini = [Array]::IndexOf($linhas, '### 3.8 Estados de aprendizado e feedback no `omni.db`')
$fim = [Array]::IndexOf($linhas, '## 4. O executor')
$larguras = $linhas[$ini..($fim - 1)] | ForEach-Object { $_.Length }
$maior = ($larguras | Measure-Object -Maximum).Maximum
'secao: linhas ' + ($ini + 1) + ' a ' + $fim + ', maior largura ' + $maior
'antes dela: ' + $linhas[$ini - 2]
$bytes = [IO.File]::ReadAllBytes((Resolve-Path $desenho))
'CR: ' + [Linq.Enumerable]::Count([byte[]]$bytes, [Func[byte,bool]]{ param($b) $b -eq 13 })
'titulos 3.8: ' + @(Select-String -Path $desenho -Pattern '^### 3\.8 ').Count
```

Esperado: `secao: linhas 307 a 364, maior largura 96`; `antes dela: desligado.`; `CR: 0`; e `titulos 3.8: 1`.

Resultado (05/11): as quatro linhas como esperado, e o §3.8 do desenho é igual, byte a byte, ao bloco acima. Antes de gravar, cada fato do texto foi conferido no código, e o rascunho errava um número: o corte é de 200 itens, não de 100 (`RETENCAO_MAXIMA` em `runtime/recibos-evolucao.mjs:21` e o `slice(-200)` dos jobs encerrados em `runtime/automacao-falhas.mjs:607`). Na mesma conferência entrou o sufixo `#n` da chave repetida (`linhasDe`, `runtime/casa/loja-estados.mjs:51-63`). Também foram conferidos o id do registro (`:30`), a trava dos recibos (`runtime/recibos-evolucao.mjs:105`) e as sete operações de degradação (`runtime/estados.mjs`).

- [x] **Passo 2: os outros documentos**, também à mão.

Plano 1, linha 25, a linha 3 do escopo. Antes:

```markdown
| 3 | Aprendizado, falhas e feedback no `omni.db`, com importador | §4.2, §6 | a escrever |
```

Depois:

```markdown
| 3 | [Estados de aprendizado e feedback no `omni.db`, com importador](2026-11-05-f1-plano-3-estados-aprendizado-feedback.md) | §3.8, §4.2, §6 | em execução |
```

Plano 2, linha 51, o item 4 do executor. Ele trocou os papéis do `actual` e do `expected`: a linha 173 do teste passa o contrato primeiro (T10 deste plano). Antes:

```markdown
4. **Vermelho de nascença `:165`.** É o mesmo do plano 1 (item 3 de lá). Arquivo novo em `runtime/` muda o fingerprint do payload: o calculado agora é `3c60182bbef2…`, e o contrato espera `3ae80f14…`. O plano 8 regenera.
```

Depois:

```markdown
4. **Vermelho de nascença `:165`.** É o mesmo do plano 1 (item 3 de lá). Arquivo novo em `runtime/` muda o fingerprint do payload: o contrato guarda `3c60182bbef2…`, e o calculado agora é `3ae80f14…`. O plano 8 regenera. (Corrigido no plano 3: a linha 173 do teste passa o contrato como `actual`.)
```

Este plano, linha 13, a "Situação". Antes:

```markdown
**Situação em 05/11/2026:** a executar.
```

Depois:

```markdown
**Situação em 05/11/2026:** T1 a T10 feitas e provadas no ramo `casa-sqlite-f1` (base `ecbd4df`). T11 (o §3.8, commit, push e CI) em execução.
```

```powershell
$plano = 'docs\superpowers\plans\2026-11-05-f1-plano-3-estados-aprendizado-feedback.md'
'plano 1, linha 25: ' + [IO.File]::ReadAllLines((Resolve-Path 'docs\superpowers\plans\2026-11-04-f1-casa-sqlite.md'))[24]
'plano 2, linha 51: ' + [IO.File]::ReadAllLines((Resolve-Path 'docs\superpowers\plans\2026-11-05-f1-plano-2-documentos-md.md'))[50]
'plano 3, linha 13: ' + [IO.File]::ReadAllLines((Resolve-Path $plano))[12]
```

Esperado: as três linhas com o texto de "Depois". A conferência é por número de linha, porque os blocos acima repetem o texto.

Resultado (05/11): as três linhas com o texto de "Depois", e nenhum dos três arquivos com CR.

- [x] **Passo 3: stage e conferências.** O `add` é explícito: nada de outra sessão entra.

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-05-f1-plano-3-estados-aprendizado-feedback.md'
git add runtime/casa/esquemas.mjs runtime/casa/loja-estados.mjs runtime/estados.mjs runtime/falhas.mjs runtime/automacao-falhas.mjs runtime/autoaperfeicoamento.mjs runtime/atalhos.mjs runtime/recibos-evolucao.mjs runtime/feedback-personalidade.mjs runtime/varredura-diaria.mjs package.json testes/casa-banco.test.mjs testes/casa-loja-estados.test.mjs testes/estados.test.mjs testes/estados-modulos.test.mjs testes/feedback-personalidade.test.mjs testes/varredura-diaria.test.mjs docs/superpowers/specs/2026-11-04-casa-unica-tres-agentes-design.md docs/superpowers/plans/2026-11-04-f1-casa-sqlite.md docs/superpowers/plans/2026-11-05-f1-plano-2-documentos-md.md docs/superpowers/plans/2026-11-05-f1-plano-3-estados-aprendizado-feedback.md
git diff --cached --stat
foreach ($arquivo in @(git diff --cached --name-only)) {
  $bytes = [IO.File]::ReadAllBytes((Resolve-Path $arquivo))
  $cr = [Linq.Enumerable]::Count([byte[]]$bytes, [Func[byte,bool]]{ param($b) $b -eq 13 })
  $bom = ($bytes.Length -ge 3) -and ($bytes[0] -eq 0xEF) -and ($bytes[1] -eq 0xBB) -and ($bytes[2] -eq 0xBF)
  $arquivo + ': CR ' + $cr + ', BOM ' + $bom
}
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --conferir; 'saida: ' + $LASTEXITCODE
git status --short
```

Esperado: 21 arquivos no `--stat`; `CR 0, BOM False` nos 21 (item 13); treze `igual` e `saida: 0`; e, no `status`, quinze `M ` e seis `A `, nada fora do stage.

Resultado (05/11): 21 arquivos, 5849 inserções e 137 remoções; `CR 0, BOM False` nos 21; as treze linhas `igual` e `saida: 0`; quinze `M ` e seis `A `, nada fora do stage. Fora do roteiro, uma varredura das 5849 linhas adicionadas não achou caminho de usuário, IP, telefone nem e-mail, fora o `noreply` do Co-Authored-By.

- [x] **Passo 4: a mensagem do commit.** Vai em `$rascunho\commit-p3.txt`, sem acento:

```
feat(casa): estados de aprendizado e feedback no omni.db

Os oito estados JSON de learning/ e feedback/ passam a viver no
omni.db (migracao v3: estados, estado_registros e _estados_no_disco);
o arquivo vira projecao byte a byte. Os seis modulos JS carregam e
gravam pela ponte (runtime/estados.mjs), que decide por tres hashes
(disco, banco vivo e a base desta maquina) dentro de um BEGIN
IMMEDIATE, sob a trava do dono; os recibos de evolucao ganham trava
propria. A varredura diaria importa os estados sem linha e espelha os
dois da loja TS. Banco fora do ar vira degradacao, nunca queda; a
primeira importacao guarda os bytes originais em .antes-da-casa.

Provas: CB 23/23, CE 16/16, ES 23/23, EM 8/8 e VD 15/15; 47 mutantes,
todos vermelhos por assercao; estados reais copiados (8 estados, 4062
registros) com ida e volta conferida em Node 22 e 24. Suites afetadas
pelo grafo de import: 55 suites, 547 testes, 546 verdes e 1 vermelho,
o fingerprint de integridade-release.test.mjs:165. Verify completo:
696 testes, 690 verdes, 4 pulados e 2 vermelhos: o mesmo :165 e um
EPERM em runtime/evolucao.mjs:269, um rename sem nova tentativa
(evolucao.test.mjs:348), fora do codigo deste plano; a suite passou
na T9 e sozinha 3 de 3. .test-dist 55/55, test:dist 1/1 e
verify:build ok.

Desenho: docs/superpowers/specs/2026-11-04-casa-unica-tres-agentes-design.md
Plano: docs/superpowers/plans/2026-11-05-f1-plano-3-estados-aprendizado-feedback.md

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$bytes = [IO.File]::ReadAllBytes((Join-Path $rascunho 'commit-p3.txt'))
'fora do ASCII: ' + [Linq.Enumerable]::Count([byte[]]$bytes, [Func[byte,bool]]{ param($b) $b -gt 127 })
'CR: ' + [Linq.Enumerable]::Count([byte[]]$bytes, [Func[byte,bool]]{ param($b) $b -eq 13 })
```

Esperado: `fora do ASCII: 0`, o que também exclui BOM, e `CR: 0`.

Resultado (05/11): `fora do ASCII: 0` e `CR: 0`. São 27 linhas, iguais ao bloco acima byte a byte, e só as duas de caminho passam de 72 caracteres (76 e 83).

- [x] **Passo 5: identidade e commit** (item 18). O e-mail sai do `origin/main` e vai só no comando, sem mexer na config e sem aparecer na saída.

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$email = git log origin/main --author='Weriton-DataOps' -1 --format='%ae'
if (-not $email) { throw 'sem commit da Weriton-DataOps no origin/main' }
$identidade = @('-c', 'user.name=Weriton-DataOps', '-c', "user.email=$email")
git @identidade commit -F (Join-Path $rascunho 'commit-p3.txt')
git log -1 --format='%h | autor %an | committer %cn | pai %p'
$autor = (git log -1 --format='%ae') -ceq $email
$committer = (git log -1 --format='%ce') -ceq $email
'e-mails conferem: ' + ($autor -and $committer)
git status --short
$saida = Join-Path $rascunho 'commit-p3-cat.txt'
Start-Process git -ArgumentList 'cat-file', 'commit', 'HEAD' -NoNewWindow -Wait -RedirectStandardOutput $saida
$bruto = [IO.File]::ReadAllText($saida)
$corpo = $bruto.Substring($bruto.IndexOf("`n`n") + 2)
'mensagem igual: ' + ($corpo -ceq [IO.File]::ReadAllText((Join-Path $rascunho 'commit-p3.txt')))
```

Esperado: 21 arquivos na linha do commit; `<sha> | autor Weriton-DataOps | committer Weriton-DataOps | pai ecbd4df`; `e-mails conferem: True`; `status` vazio; e `mensagem igual: True`. A comparação é pelo `git cat-file`, porque o `Out-String` junta as linhas com CRLF e dá diferença falsa (T10 do plano 2).

Resultado (05/11): `673e2bb`, 21 arquivos, 5849 inserções e 137 remoções; `673e2bb | autor Weriton-DataOps | committer Weriton-DataOps | pai ecbd4df`; `e-mails conferem: True`; `status` vazio; e `mensagem igual: True`.

- [x] **Passo 6: push pela conta dona do repo**, fora do sandbox do agente. O ramo já tem upstream, então o push vai sem `-u`:

```powershell
gh auth switch --user Weriton-DataOps
try { git push origin casa-sqlite-f1 } finally { gh auth switch --user wp-grgroup }
gh auth status --active
git ls-remote origin refs/heads/casa-sqlite-f1
git rev-parse HEAD
```

Esperado: `ecbd4df..<sha>` aceito, `wp-grgroup` ativa de novo e o SHA remoto igual ao local.

Resultado (05/11): `ecbd4df..673e2bb` aceito, `wp-grgroup` ativa de novo, e remoto e local em `673e2bb`.

- [x] **Passo 7: CI**

```powershell
gh run list --repo Weriton-DataOps/Omni-Agent --branch casa-sqlite-f1 --limit 5
```

Esperado:
- "Linux / Node 22 / portable core" verde (ele não roda as suítes `.mjs`; item 17);
- "Windows / Node 22 / full verification" vermelho só no `:165`, com 696 testes: 691 verdes, 4 pulados e 1 vermelho. Os números saem do log do job pela API (`gh api repos/Weriton-DataOps/Omni-Agent/actions/jobs/<id>/logs`), porque o `gh run view --log-failed` volta vazio. Se o `EPERM` de `evolucao.test.mjs:348` (T10) reaparecer, ele entra no Resultado como veio.

Resultado (05/11): "Linux / Node 22 / portable core" verde e "Windows / Node 22 / full verification" vermelho só no `:165`, com 696 testes: 691 verdes, 4 pulados e 1 vermelho. A asserção que cai é a da linha 173, com o contrato `3c60182bbef2…` no `actual` e o calculado `be11ab3853c0…` no `expected`, o mesmo par da máquina local. O `EPERM` de `evolucao.test.mjs:348` não reapareceu: o log não tem nenhuma linha com `EPERM`.

- [x] **Passo 8: registrar o resultado.** Os passos desta tarefa ganham o que saiu. A linha 13 deste plano vira "**Situação em 05/11/2026:** entregue. T1 a T11 feitas e publicadas no `origin/casa-sqlite-f1`: `<sha do Passo 5>` (módulos, suítes, o §3.8 do desenho e os planos), commit de 05/11. O PR sai no plano 8.", e a linha 25 do plano 1 troca "em execução" por "entregue". Depois, um commit só com os dois planos, pela identidade do Passo 5, e push e CI como nos Passos 6 e 7. O push e a CI desse segundo commit não aparecem aqui, porque este registro viaja dentro dele.

A mensagem vai em `$rascunho\commit-p3-registro.txt`, sem acento, com os números que a CI do Passo 7 der:

```
docs(plano): registra push e CI do plano 3 da F1

Push de casa-sqlite-f1 pela conta Weriton-DataOps (<sha do Passo 5>)
e CI do push: Linux verde; Windows com 696 testes, 691 verdes, 4
pulados e 1 vermelho, o fingerprint de integridade-release.test.mjs:165.
O plano 3 fica entregue, aqui e no escopo do plano 1.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
git add docs/superpowers/plans/2026-11-04-f1-casa-sqlite.md docs/superpowers/plans/2026-11-05-f1-plano-3-estados-aprendizado-feedback.md
$email = git log origin/main --author='Weriton-DataOps' -1 --format='%ae'
if (-not $email) { throw 'sem commit da Weriton-DataOps no origin/main' }
$identidade = @('-c', 'user.name=Weriton-DataOps', '-c', "user.email=$email")
git @identidade commit -F (Join-Path $rascunho 'commit-p3-registro.txt')
git log -1 --format='%h | autor %an | committer %cn | pai %p'
git status --short
```

Esperado: dois arquivos no commit, autor e committer `Weriton-DataOps`, pai o SHA do Passo 5 e `status` vazio.

Resultado (05/11): todos os passos desta tarefa têm o que saiu; a linha 13 deste plano e a linha 25 do plano 1 estão com o texto novo; nenhum `- [ ]` ficou no plano; o `--conferir` deu treze `igual`; e os dois planos estão sem CR. O commit, o push e a CI deste registro ficam fora daqui, porque ele viaja dentro do commit.

Este plano não abre PR. O PR sai no plano 8, com a release.

## Autorrevisão contra o desenho

Os números entre parênteses são os mutantes do Apêndice A.

**§4.2, a migração inicial de `learning/` e `feedback/`**
- O importador é a primeira carga de cada dono: CE 11 (14 a 16, 19), ES 3 (23) e EM 1 a 6 (38 a 43).
- A varredura importa o que nenhum dono carregou: ES 21 (36), VD 578 e 613 (46, 47).
- Os dois espelhos da loja TS andam com o banco: ES 22 (30) e desvio 3.
- A cópia datada é a `.antes-da-casa`: ES 3 (23) e desvio 4.
- `_importacoes` só na primeira importação: CE 11 (14, 15) e desvio 2.

**§3.1, portabilidade**
- Id natural, não UUID v7 (desvio 17 e §3.8): a chave sai do catálogo, do `id`, do texto ou do hash, sem repetir, CE 2 e 16 (6 a 8).
- `versao` em toda mudança, lápide e ressurreição: CE 6 a 8 e 12 (2, 11, 12, 18).
- Diário por gatilho: CB 316 e CE 6 a 10 (2, 3).
- O relógio não sobe versão nem vai ao diário: CE 5 (5, 12).
- A ordem sobe versão, com o mínimo de registros movidos: CE 3 e 9 (9, 10), desvio 10 e §3.8.
- Base por máquina, fora do diário e presa ao estado pela chave estrangeira: CB 316 e CE 15 (1).

**§3.5, muitas sessões**
- Leitura, decisão, cópia, projeção e base no mesmo `BEGIN IMMEDIATE`: desvio 16, com a `transacao` do plano 1.
- A trava do dono: EM 7 e 8 (44, 45); os recibos ganham a sua (desvio 15).
- Transação curta, sem rede nem modelo dentro.

**§3.6, o molde**
- As decisões: ES 1 a 12 (21 a 32), com a base por máquina no lugar da `_projecoes` (desvio 1).
- Byte a byte, conferido por hash: CE 4 e 14 (13, 19).
- Forma canônica: CE 13 e ES 17 (17). Fora do catálogo: CE 13 (4) e ES 19 (20).
- Arquivo quebrado com banco populado vira `.invalida` e o banco projeta: ES 6 (30, 31); socorro barrado: ES 7 (28); sem cópia, sem socorro: ES 8 (29).
- Versão mais nova ou fora do contrato fica intocada: ES 2 e 11 (21, 27), desvio 5 e FP 382-383.
- Banco primeiro, arquivo depois, e a falha de projeção: ES 16 e 18 (25, 31, 34).
- Degradação anotada com a operação: ES 6, 17, 22 e 23 (17, 30, 35); sem conteúdo, pelo `registrarDegradacao` do plano 1 (CB 423).
- Sem SQLite: ES 13. Banco que não abre: ES 15 (33). Sem arquivo e sem banco, lança: desvio 11.

**§3.8:** escrito pela T11 (Passo 1).

**§6, prova da F1:** os estados reais copiados (T8: 8 estados, 4062 registros), com ida e volta conferida nos dois Nodes.

**Robustez**
- Estado que é pasta: ES 14.
- Pasta no lugar do arquivo na varredura: ES 23 (35).
- Casa vazia e varredura p2: ES 20 e 21 (36, 37).
- Falha que não derruba a varredura: VD 645 (35, 46, 47).

## Apêndice A: mutantes (T7)

47 mutantes, todos vermelhos por asserção, nenhum equivalente. Cada um caiu exatamente nos testes previstos no desenho, num total de 76 mortes. A tabela foi gerada por script a partir da lista (o gerador está no Passo 1 da T7) e da saída do executor. A coluna da direita traz o teste que ficou vermelho e a asserção que o derrubou. Quando a asserção tem mensagem própria, ela vem entre parênteses.
- `deepEqual` (43) e `equal` (20) são a maioria: o teste compara o banco, o diário, a base ou o arquivo com o valor exato.
- `throws` sem exceção (7): o mutante tira uma recusa (a chave estrangeira, a chave herdada do catálogo, a conferência do hash, a forma canônica, o estado do outro modo ou o banco ilegível sem arquivo), e a operação que devia falhar passa.
- `ok` (5): no 38 e do 40 ao 43, o dono grava sem criar o `omni.db`, e a primeira asserção do EM o pega. No 39 o banco já existe, porque a `sincronizarAutomacaoFalhas` passa pela `lerFalhas`, e quem cai é o `equal` do hash.
- `doesNotReject` (1): o 45 deixa a trava velha dos recibos no lugar, e a escrita rejeita onde o teste exige que siga.
- Nenhuma morte por setup, `TypeError` ou arquivo que não carrega: o gerador da tabela recusa queda que não seja `AssertionError` com `ERR_ASSERTION`. Foi essa recusa que pegou, na primeira rodada, os `TypeError` do Passo 3.

Siglas: CB = `testes/casa-banco.test.mjs`, CE = `testes/casa-loja-estados.test.mjs`, ES = `testes/estados.test.mjs`, EM = `testes/estados-modulos.test.mjs`, VD = `testes/varredura-diaria.test.mjs`.

| # | Mutante | Arquivo | Teste que ficou vermelho — asserção |
|---|---|---|---|
| 1 | esquemas: FK de _estados_no_disco removida | `casa/esquemas.mjs` | CB omni.db da v2 sobe para a v3 sem perder documento; estado e registro vao ao diario e a base exige estado — `throws` sem exceção<br>CE a base e por maquina, exige o estado e nao vai ao diario — `throws` sem exceção |
| 2 | esquemas: estado_registros sem diario | `casa/esquemas.mjs` | CB omni.db da v2 sobe para a v3 sem perder documento; estado e registro vao ao diario e a base exige estado — `deepEqual`<br>CE item mudado e item novo no fim viram U e I so dessas linhas — `deepEqual`<br>CE item removido vira lapide: corpo e hash vazios, apagado_em e versao nova — `deepEqual`<br>CE item que volta ressuscita a lapide: criado_em fica, versao sobe e o corpo volta — `deepEqual`<br>CE reordenar muda so quem saiu da ordem crescente — `deepEqual` |
| 3 | esquemas: estados sem diario | `casa/esquemas.mjs` | CB omni.db da v2 sobe para a v3 sem perder documento; estado e registro vao ao diario e a base exige estado — `deepEqual`<br>CE o mesmo documento duas vezes nao escreve nada; chave nova no esqueleto sobe a versao do estado — `deepEqual` |
| 4 | loja: catalogo aceita chave herdada | `casa/loja-estados.mjs` | CE gravar recusa texto fora da forma canonica e estado fora do catalogo, sem escrever nada — `throws` sem exceção |
| 5 | loja: relogio fica no esqueleto | `casa/loja-estados.mjs` | CE decompor troca colecoes por [] e o relogio por null, sem mexer na entrada — `equal`<br>CE mudar so o relogio troca hash e relogio sem subir versao nem escrever no diario — `deepEqual` |
| 6 | loja: chave declarada ignorada | `casa/loja-estados.mjs` | CE linhasDe tira a chave do campo do catalogo, do id, do texto ou do hash, sem repetir — `deepEqual`<br>CE chave declarada no catalogo vira o id do registro — `deepEqual` |
| 7 | loja: sufixo da chave repetida comeca em #2 | `casa/loja-estados.mjs` | CE linhasDe tira a chave do campo do catalogo, do id, do texto ou do hash, sem repetir — `deepEqual` |
| 8 | loja: texto de 200 caracteres vira hash | `casa/loja-estados.mjs` | CE linhasDe tira a chave do campo do catalogo, do id, do texto ou do hash, sem repetir — `deepEqual` |
| 9 | loja: ordem ignora a quebra da cauda | `casa/loja-estados.mjs` | CE planejarOrdem mantem a ordem enquanto ela cresce e manda o resto para o fim — `deepEqual` |
| 10 | loja: ordem nova nao regrava o registro | `casa/loja-estados.mjs` | CE reordenar muda so quem saiu da ordem crescente — `deepEqual` |
| 11 | loja: registro que saiu nao vira lapide | `casa/loja-estados.mjs` | CE item removido vira lapide: corpo e hash vazios, apagado_em e versao nova — `deepEqual`<br>CE item que volta ressuscita a lapide: criado_em fica, versao sobe e o corpo volta — `deepEqual` |
| 12 | loja: esqueleto regravado sempre | `casa/loja-estados.mjs` | CE mudar so o relogio troca hash e relogio sem subir versao nem escrever no diario — `deepEqual`<br>CE item mudado e item novo no fim viram U e I so dessas linhas — `deepEqual`<br>CE item removido vira lapide: corpo e hash vazios, apagado_em e versao nova — `deepEqual`<br>CE item que volta ressuscita a lapide: criado_em fica, versao sobe e o corpo volta — `deepEqual`<br>CE reordenar muda so quem saiu da ordem crescente — `deepEqual`<br>CE o mesmo documento duas vezes nao escreve nada; chave nova no esqueleto sobe a versao do estado — `deepEqual` |
| 13 | loja: recomposicao sem conferir o hash | `casa/loja-estados.mjs` | CE recompor recusa registro adulterado e registro de colecao que o esqueleto nao tem — `throws` sem exceção |
| 14 | loja: importacao repetida nao reconhece o presente | `casa/loja-estados.mjs` | CE importar guarda a forma canonica, anota a fonte original e confirma a base da maquina — `equal` |
| 15 | loja: importacao anota o hash da canonica | `casa/loja-estados.mjs` | CE importar guarda a forma canonica, anota a fonte original e confirma a base da maquina — `deepEqual` |
| 16 | loja: importacao nao confirma a base | `casa/loja-estados.mjs` | CE importar guarda a forma canonica, anota a fonte original e confirma a base da maquina — `equal` |
| 17 | loja: forma canonica nao exigida | `casa/loja-estados.mjs` | CE gravar recusa texto fora da forma canonica e estado fora do catalogo, sem escrever nada — `throws` sem exceção<br>ES escrita fora da forma canônica: vai ao arquivo, não ao banco, e a degradação fica anotada — `equal` |
| 18 | loja: estado apagado conta como presente | `casa/loja-estados.mjs` | CE estado apagado some da leitura, e importar de novo o ressuscita — `equal` |
| 19 | loja: contagem sem as colecoes do esqueleto | `casa/loja-estados.mjs` | CE gravar e recompor devolvem o mesmo texto, byte a byte — `deepEqual`<br>CE importar guarda a forma canonica, anota a fonte original e confirma a base da maquina — `deepEqual` |
| 20 | ponte: estado do outro modo aceito | `estados.mjs` | ES fora do catálogo p2: estado desconhecido, espelho ou nome herdado de Object é recusado — `throws` sem exceção |
| 21 | ponte: versao futura vai ao validador | `estados.mjs` | ES intocada sem linha: arquivo quebrado, de versão futura ou fora do contrato não entra no banco — `deepEqual`<br>ES com linha, arquivo de versão futura ou fora do contrato fica intocado e o banco não muda — `deepEqual`<br>ES avaliarTexto e avaliarEstrutura — `equal` |
| 22 | ponte: versao antiga vai ao validador | `estados.mjs` | ES avaliarTexto e avaliarEstrutura — `equal` |
| 23 | ponte: importacao sem a copia antes-da-casa | `estados.mjs` | ES importada: a fonte compacta volta como está, ganha cópia e o banco guarda a forma canônica — `equal` |
| 24 | ponte: base perdida nao volta com o texto igual | `estados.mjs` | ES atual: arquivo igual ao banco, ou com a mesma forma canônica, fica como está e a base perdida volta — `deepEqual` |
| 25 | ponte: arquivo defasado vira ingestao | `estados.mjs` | ES defasada: arquivo na versão que o banco já superou recebe a versão do banco — `equal`<br>ES falha de projeção: o banco fica à frente e a carga seguinte projeta — `equal` |
| 26 | ponte: ingestao nao confirma a base | `estados.mjs` | ES ingerida: escrita externa válida entra no banco e o arquivo fica como está — `deepEqual` |
| 27 | ponte: futura ou fora do contrato vira ingestao | `estados.mjs` | ES com linha, arquivo de versão futura ou fora do contrato fica intocado e o banco não muda — `deepEqual` |
| 28 | ponte: socorro sem validar a recomposicao | `estados.mjs` | ES socorro barrado: banco fora do contrato não substitui o arquivo quebrado — `equal` |
| 29 | ponte: socorro sem a copia do arquivo quebrado | `estados.mjs` | ES sem cópia, sem socorro: se a cópia .invalida não sai, o arquivo quebrado fica — `equal` |
| 30 | ponte: socorro sem degradacao anotada | `estados.mjs` | ES socorrida: arquivo quebrado com linha válida vira cópia .invalida e o banco reprojeta — `deepEqual`<br>ES espelho: a loja TS de continuidade e o banco andam juntos — `deepEqual` |
| 31 | ponte: projecao nao confirma a base | `estados.mjs` | ES projetada: sem arquivo e com linha, o banco reescreve o disco e confirma a base — `deepEqual`<br>ES socorrida: arquivo quebrado com linha válida vira cópia .invalida e o banco reprojeta — `deepEqual`<br>ES defasada: arquivo na versão que o banco já superou recebe a versão do banco — `deepEqual`<br>ES falha de projeção: o banco fica à frente e a carga seguinte projeta — `deepEqual` |
| 32 | ponte: carga sem estado cria o banco | `estados.mjs` | ES vazia: sem arquivo e sem linha devolve null, e sem banco não cria banco — `equal` |
| 33 | ponte: banco ilegivel e sem arquivo comeca vazio | `estados.mjs` | ES banco que não abre: com arquivo a ponte segue no disco; sem arquivo recusa começar vazio — `throws` sem exceção |
| 34 | ponte: escrita nao confirma a base | `estados.mjs` | ES escrita: banco e arquivo recebem o mesmo texto e a base acompanha — `deepEqual`<br>ES falha de projeção: o banco fica à frente e a carga seguinte projeta — `deepEqual` |
| 35 | ponte: falha p2 da varredura anotada como espelho | `estados.mjs` | ES varredura com pasta no lugar do arquivo: o estado degrada e os outros seguem — `deepEqual`<br>VD estado que falha na varredura vira degradacao anotada e nao desfaz a varredura — `deepEqual` |
| 36 | ponte: varredura importa estrutura quebrada | `estados.mjs` | ES varredura p2: importa o que falta uma vez só e deixa o quebrado como está — `equal` |
| 37 | ponte: espelho vazio ganha trava e banco | `estados.mjs` | ES varredura em casa vazia: nada a importar, sem banco e sem pasta feedback — `deepEqual` |
| 38 | falhas: grava sem o omni.db | `falhas.mjs` | EM falhas: registrarFalha grava pelo omni.db e socorre o arquivo quebrado — `ok` ("o dono gravou sem passar pelo omni.db") |
| 39 | automacao de falhas: grava sem o omni.db | `automacao-falhas.mjs` | EM automação de falhas: sincronizarAutomacaoFalhas grava pelo omni.db e socorre o arquivo quebrado — `equal` |
| 40 | autoaperfeicoamento: grava sem o omni.db | `autoaperfeicoamento.mjs` | EM autoaperfeiçoamento: lerAutoaperfeicoamento grava pelo omni.db e socorre o arquivo quebrado — `ok` ("o dono gravou sem passar pelo omni.db") |
| 41 | atalhos: grava sem o omni.db | `atalhos.mjs` | EM atalhos: prepararAtalhos grava pelo omni.db e socorre o arquivo quebrado — `ok` ("o dono gravou sem passar pelo omni.db") |
| 42 | recibos: grava sem o omni.db | `recibos-evolucao.mjs` | EM recibos: registrarRecibo grava pelo omni.db e socorre o arquivo quebrado — `ok` ("o dono gravou sem passar pelo omni.db") |
| 43 | feedback: grava sem o omni.db | `feedback-personalidade.mjs` | EM feedback: registrarUltimaRespostaPersonalidade grava pelo omni.db e socorre o arquivo quebrado — `ok` ("o dono gravou sem passar pelo omni.db") |
| 44 | recibos: trava aberta sem exclusividade | `recibos-evolucao.mjs` | EM recibos: a escrita espera a trava presa — `equal` ("registrarRecibo passou por cima da trava") |
| 45 | recibos: trava velha nunca apagada | `recibos-evolucao.mjs` | EM recibos: trava velha é apagada e a escrita segue — `doesNotReject` |
| 46 | vd: varredura concluida sem reconciliar os estados | `varredura-diaria.mjs` | VD varredura concluida poe no omni.db os estados que nenhum dono carregou — `deepEqual`<br>VD varredura automatica fora do horario nao reconcilia os estados — `equal` ("a primeira passada nao importou os recibos")<br>VD estado que falha na varredura vira degradacao anotada e nao desfaz a varredura — `equal` ("os recibos quebrados nao viraram degradacao") |
| 47 | vd: estados reconciliados antes de olhar o horario | `varredura-diaria.mjs` | VD varredura concluida poe no omni.db os estados que nenhum dono carregou — `deepEqual`<br>VD varredura automatica fora do horario nao reconcilia os estados — `equal` ("a primeira passada nao importou os recibos")<br>VD estado que falha na varredura vira degradacao anotada e nao desfaz a varredura — `equal` |
