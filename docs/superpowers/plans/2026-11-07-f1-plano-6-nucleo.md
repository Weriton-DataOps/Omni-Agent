# F1, plano 6: núcleo da casa (nucleo.db) — plano de implementação

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** o `nucleo.db` da casa (§4.2): o catálogo dos agentes, onde cada um está instalado e as máquinas que a casa conhece, com o `executor/agente.json` de cada agente validado antes de entrar. O executor de cada agente (F2 e F3) registra o agente depois de instalar e o retira ao desinstalar, pela linha de comando do núcleo.

**Arquitetura:** a v1 do `nucleo.db` em `runtime/casa/esquemas.mjs` (`maquinas`, `agentes` e `instalacoes`, com as travas em CHECK e o diário em cada tabela), uma loja nova (`runtime/casa/loja-nucleo.mjs`) que valida o manifesto e grava o catálogo, as instalações e as máquinas, e uma CLI nova (`runtime/nucleo.mjs`) que fala JSON numa linha, com códigos de saída fixos. O banco abre pelo `comBancoDaCasa` do plano 2, que cria a casa e roda as migrações.

**Tecnologia:** `node:sqlite`, Node ≥ 22.13, `node:test`, `node:util` (`parseArgs`). Nenhuma dependência npm nova.

**Desenho:** [Casa única: Omni, Overcore e Oráculo](../specs/2026-11-04-casa-unica-tres-agentes-design.md): §4.2 (o `agente.json` e o núcleo), §4 (passos 3 e 9 do executor), §3 e §3.1 (SQLite e portabilidade), §3.8 (o precedente do id natural), §2 (cada agente dono do seu banco) e §6 (a F1 inclui o núcleo).

**Situação em 08/11/2026:** entregue no commit `25d0160`, enviado ao ramo `casa-sqlite-f1`, com o CI no esperado: Linux verde e Windows vermelho só no `:165`, com 889 testes. A Preparação e as tarefas 1 a 4 foram executadas em 07/11, e a T5 em 08/11. Na T1, 24 testes verdes e 17 mutantes; na T2, 60 testes verdes e 63 mutantes; na T3, 9 testes verdes e 30 mutantes, e o furo do `check` fechado para a loja e a CLI; todos esses mutantes vermelhos pela asserção. Na T4, o verify com 889 testes e só o vermelho de nascença `:165`, e o `.test-dist`, o `test:dist` e o `verify:build` verdes à parte. A execução teve desvios de ordem, declarados no item 13 do executor e nos resultados.

---

## Posição na F1

Este é o plano 6 dos oito da F1 ([escopo no plano 1](2026-11-04-f1-casa-sqlite.md#escopo-a-f1-em-oito-planos)). O plano 5 deixou o card do cofre na ilha (`45f3977`). Este plano dá à casa o registro de quem mora nela.

O HEAD tinha uma v1 provisória do núcleo, de antes deste plano: `agentes` sem travas e `maquinas` sem diário, sem a tabela de instalações. Ela é reescrita aqui como v1, e não vira v2: nenhuma casa real abriu o `nucleo.db`, porque a ativação só vem depois do merge, e não houve merge nem release desde que ela entrou. A v1 deste plano congela no push da T5; dali em diante, mudança de esquema no núcleo é a v2.

Fica fora deste plano:
- o executor de cada agente, com os modos (F2 para o Omni, F3 para o Overcore e o Oráculo). O núcleo só registra e retira; quem instala é o executor;
- o `servir` e as rotas `/v1/*` (F2). O manifesto já descreve a interface e as rotas, mas nada as serve;
- a ilha ler o núcleo e acender os painéis instalados (passo 9 do §4), que depende da F2;
- a sincronização entre máquinas. O esquema já está pronto para ela (decisões 1, 2 e 11), mas o transporte é de outra fase;
- a ativação na casa real, que só acontece depois do merge, com o ok do Weriton.

## Decisões (dentro do desenho, sem autoridade nova)

1. **Sem chave estrangeira.** As três tabelas não se referenciam: a sincronização entre máquinas vai aplicar linhas em qualquer ordem, e uma instalação pode chegar antes do agente do catálogo. A listagem junta com `LEFT JOIN`, e o agente que falta no catálogo aparece com `versaoNoCatalogo` nulo. Cada tabela tem o diário, como as outras da casa (mutantes 14 e 15 da T1).
2. **Ids naturais, no precedente do §3.8.** O agente é o próprio nome (slug); a máquina é o hostname em minúsculas, o mesmo `maquinaAtual()` do `banco.mjs` que já assina `origem_maquina`; a instalação é `maquina/agente`. A barra separa os dois, então ela é proibida no nome da máquina (CHECK e loja). Duas máquinas que registram o mesmo agente geram a mesma linha de catálogo, sem UUID a reconciliar. A instalação só aceita máquina e agente válidos e raiz não vazia (mutantes 09 a 13, 16 e 17 da T1 e 49 da T2).
3. **O nome do agente é um slug de até 40 caracteres** (`^[a-z][a-z0-9-]{0,39}$`), no CHECK e na loja. A loja reserva `dono`, `nucleo`, `cofre` e `casa`: `dono` é o agente do caminho do dono no cofre (plano 5, decisão 5), e os outros três são nomes de banco e de pasta da própria casa (mutantes 06 a 08 da T1 e 01 da T2).
4. **O banco do agente é `<agente>.db` ou nada.** `banco` é obrigatório no manifesto, `null` quando o agente não tem banco. Com banco, `migracoes` é obrigatório e é um caminho relativo; sem banco, `migracoes` não existe. O CHECK do catálogo repete a regra do nome (mutantes 01 da T1 e 03 a 06 da T2). Cada agente é dono do seu banco (§2), e o nome fixo impede um agente de declarar o banco de outro.
5. **O manifesto.** Lido de `executor/agente.json` na raiz do agente, que tem de ser absoluta, até 256 KiB (`LIMITE_MANIFESTO`). O BOM do começo é tirado antes do `JSON.parse`. O sha256 é dos bytes crus, para bater com o arquivo no disco; o texto gravado é o `JSON.stringify` do objeto lido. Campo a mais é tolerado, para um agente novo não quebrar um núcleo velho; campo errado é recusado com `manifesto-invalido` e a lista dos problemas, que diz o campo e a regra e nunca ecoa o valor. O CHECK do catálogo exige JSON de objeto e sha de 64 caracteres. O `registrar` também recusa raiz relativa (mutantes 02 a 05 da T1 e 42 a 48 da T2).
6. **Os formatos.** `versao` é semver. `requer.node` é `>=N[.N[.N]]`, e `requer.agentes` é uma lista de `<agente>>=N[.N[.N]]`, um por agente. `executor`, quando existe, tem `comando` (texto não vazio) e `modos`, uma lista sem repetir dentre `instalar`, `importar`, `exportar`, `atualizar` e `verificar` (os do §4.2) e `servir` (a F2, pelos contratos da casa). `interface`, quando existe, tem `modulo` (um `.html`), `preload` opcional (um `.js`), `painel` até 40 caracteres, `api` fixa em `http://127.0.0.1:{porta}/v1` e `rotas`, que exigem a `api`, cada uma com `metodo` (GET, POST, PATCH, PUT ou DELETE), `padrao` (expressão que compila, de `^/v1/` até `$`) e `escopo` (`qualquer`, `tela` ou `visita`). Todo caminho é relativo à raiz do agente: até 260 caracteres, barra normal, sem `/` no começo, sem unidade e sem `..` (mutantes 02 e 07 a 27 da T2).
7. **Tarefas como objetos.** O §4.2 mostra `tarefas` como strings; aqui elas seguem os contratos da casa para a F2: `id` (slug, sem repetir), `quando` com exatamente um entre `diaria` (`HH:MM`) e `acada` (`PT<n>M` ou `PT<n>H`, n ≥ 1), `seAtrasada` booleano e exatamente um entre `comando` e `lancador`. O `lancador` só pode ser `omni`, com um `roteiro` relativo e `variaveis` opcionais em MAIÚSCULAS (mutantes 28 a 39 da T2).
8. **Credenciais só como nomes.** `credenciais` é a lista, sem repetir, dos nomes no cofre que o agente vai pedir, no formato dos nomes do cofre. O manifesto nunca traz valor de credencial (mutantes 40 e 41 da T2).
9. **Catálogo e instalação.** O catálogo é de todas as máquinas e o último registrado vence. A instalação é por máquina, com a raiz e o sha do manifesto. Registrar o mesmo manifesto na mesma raiz não sobe versão nem muda linha: a idempotência é pelo sha dos bytes, que já muda com a `versao` do agente. Mudou a raiz ou o sha, sobe a versão. O resultado diz o que mudou (`mudou: { agente, instalacao }`), para o executor saber se fez alguma coisa (mutantes 50, 52 e 53 da T2).
10. **Retirar põe lápide só na instalação.** `retirar` marca `apagado_em` na instalação desta máquina e sobe a versão; o catálogo fica, porque outra máquina pode ter o agente. Retirar o que não está instalado dá `inexistente`. Registrar de novo revive a instalação, e revive também o catálogo com lápide que tenha vindo de outra máquina (mutantes 51, 54 e 58 da T2).
11. **Máquinas e o relógio local.** Registrar um agente toca a máquina na mesma transação. `nome` (o hostname como o sistema dá) e `sistema` (o `platform()`) que mudam, ou a lápide, sobem a versão; senão só o `visto_em` muda. O `visto_em` é relógio local: atualizá-lo não sobe a versão e não vira tráfego de sincronização (mutantes 55 a 57 da T2).
12. **A listagem avisa quando o catálogo diverge.** `listarInstalados` devolve, por agente instalado nesta máquina (ou na máquina pedida), a versão instalada, o banco e a versão no catálogo, com `catalogoDiverge` quando o sha da instalação difere do do catálogo vivo: outra máquina registrou uma versão diferente, e esta precisa atualizar. `listarMaquinas` conta só as instalações vivas de cada máquina (mutantes 59 a 63 da T2).
13. **A CLI.** `runtime/nucleo.mjs` com `verificar`, `registrar`, `retirar`, `listar`, `maquinas` e `maquina`. A saída é JSON numa linha. Os códigos de saída são 0 ok, 2 uso errado (com o uso no stderr), 3 recusa do núcleo (com `{ ok: false, codigo, erro, erros }` no stdout) e 1 falha inesperada, que vai para `degradacoes.jsonl` com a operação `nucleo.cli`. As opções são estritas e o erro de opção nunca ecoa o argumento. `verificar` confere o manifesto sem abrir o banco. `registrar` e `retirar` valem só para esta máquina; `listar --maquina` lê as linhas de outra. A raiz relativa vale a partir da pasta atual (mutantes 01 a 25 e 29 e 30 da T3).
14. **`casaDoNucleo` repete a regra do `casaDoOmni`.** O `casaDoOmni` mora em `runtime/memoria.mjs`, e a CLI do núcleo não carrega a memória do Omni para achar a casa. A NC 2 prova que as duas dão a mesma casa nos três casos (`OMNI_HOME` relativo, `APPDATA` e nenhum dos dois), e os mutantes 26 a 28 da T3 a derrubam.

## Mapa de arquivos

| Arquivo | Responsabilidade | Tarefa | Importa |
|---|---|---|---|
| `runtime/casa/esquemas.mjs` (modificado) | A v1 do `nucleo.db`: `maquinas`, `agentes` e `instalacoes`, com as travas em CHECK e o diário | T1 | — |
| `runtime/casa/loja-nucleo.mjs` (novo) | `validarManifesto`, `lerManifesto`, `registrarMaquina`, `registrarAgente`, `retirarAgente`, `listarInstalados` e `listarMaquinas`; `NucleoError`, `MODOS` e `LIMITE_MANIFESTO` | T2 | `node:fs`, `node:os`, `node:path`, `./banco.mjs` |
| `runtime/nucleo.mjs` (novo) | A CLI do núcleo e o `casaDoNucleo` | T3 | `node:os`, `node:path`, `node:url`, `node:util`, `./casa/banco.mjs`, `./casa/loja-nucleo.mjs` |
| `package.json` (modificado) | `node --check` da loja e da CLI no `npm run check` | T3 | — |
| `testes/casa-banco.test.mjs` (modificado) | CB, de 23 para 24 testes | T1 | — |
| `testes/casa-loja-nucleo.test.mjs` (novo) | LN, 60 testes | T2 | — |
| `testes/nucleo-cli.test.mjs` (novo) | NC, 9 testes | T3 | — |
| `docs/superpowers/plans/2026-11-04-f1-casa-sqlite.md` (modificado) | Linha 6 do escopo | T5 | — |

- Nenhum módulo novo importa `runtime/memoria.mjs` nem pacote npm. A NC importa o `casaDoOmni` só para comparar (decisão 14).
- `runtime/` entra no payload; `testes/` fica fora.
- Siglas: CB = `testes/casa-banco.test.mjs`, LN = `testes/casa-loja-nucleo.test.mjs` e NC = `testes/nucleo-cli.test.mjs`. "LN 3" é o terceiro teste da LN: o número é sempre a posição no arquivo. Os testes LN 2 a LN 51 saem de uma tabela de recusas (`manifesto recusado: <caso>`), um teste por caso.
- A T1 acrescenta 1 teste (CB 14, e o CB 13 passa a conferir as tabelas do núcleo): o verify passa de 819 para 820. A T2 acrescenta 60 (LN): 880. A T3 acrescenta 9 (NC): 889 (T4, Passo 1).

## O que o executor precisa saber antes de rodar qualquer coisa

1. **Casa real intocável.** O CB e a LN abrem o banco numa casa temporária com `env` vazio; a NC roda a CLI com `OMNI_HOME` dentro da casa temporária.
2. **Guarda.** `Test-Path "$env:LOCALAPPDATA\omni\casa"` dá `False` antes e depois de cada rodada (T1 a T4).
3. **Transação não reentrante e síncrona** (`runtime/casa/banco.mjs`). `registrarAgente` toca a máquina dentro da própria transação, por isso o `tocarMaquina` não abre outra; a CLI usa o banco só de forma síncrona, dentro do `comBancoDaCasa`.
4. **Vermelho de nascença `:165`.** Arquivo novo em `runtime/` muda o fingerprint do payload. A T4 anota o valor calculado e o plano 8 regenera o contrato.
5. **Payload.** `runtime/nucleo.mjs` é autoexecutável, como `runtime/cofre.mjs`, e fica coberto pelo `verificarCoberturaEntrypoints`; a loja entra no payload por morar em `runtime/`.
6. **As checagens do repositório não alcançam os módulos novos** (plano 4, item 9). A T3 acrescenta a loja e a CLI ao `node --check` do `npm run check`, com o furo visto antes e fechado depois.
7. **Fim de linha.** Arquivo novo é escrito com LF (o extrator grava LF), e antes do commit nenhum arquivo deste plano pode ter CR (T5).
8. **O código mora no plano** (plano 4, item 16). Este plano não re-emite nenhum bloco de plano anterior, então nenhum `--conferir` antigo passa a dar `DIVERGE` por causa dele, salvo o do `runtime/casa/esquemas.mjs` e o do `testes/casa-banco.test.mjs`, que daqui em diante valem por este plano.
9. **Shell:** item 10 do plano 2. `$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'` em todas as tarefas. Cada chamada do PowerShell é um processo novo, então cada bloco redeclara o que usa, e o que precisa atravessar passos vai para um arquivo no `$rascunho`.
10. **Identidade:** item 11 do plano 2.
11. **CI:** o `gh run view --log-failed` volta vazio nesses jobs; o log vem por `gh api repos/<dono>/<repo>/actions/jobs/<job>/logs` (plano 4, T9). No PowerShell 5.1, um filtro jq com aspas internas chega ao `gh` sem as aspas: filtrar o JSON no próprio PowerShell.
12. **Dados de teste fictícios.** O repositório é público: nada de host, porta, IP, usuário, pasta ou nome real de máquina em teste, plano ou commit. A NC usa o hostname da própria máquina só em memória, para comparar, e nunca o imprime.
13. **A execução real teve desvios de ordem**, todos sem efeito no código que entra no commit:
    - o `mutantes.mjs` não estava no `$rascunho` e foi re-extraído do plano 5 (Preparação); as rodadas usaram uma cópia idêntica;
    - os módulos foram escritos antes de o vermelho de cada tarefa ser visto. O vermelho foi visto depois, numa cópia do HEAD (`git archive` com o `tar.exe`), só com o teste novo da tarefa e o que ela pressupõe: na T1, o CB novo sobre o esquema do HEAD; na T2, o esquema novo e a LN; na T3, a loja, a NC e o `dist` e o `package.json` do HEAD;
    - o furo do `check` "antes" foi visto no worktree, com o `package.json` do HEAD posto de volta por um instante e o atual guardado ao lado; na volta, o hash do atual foi conferido;
    - os hashes antes e depois de cada rodada de mutantes não foram anotados, e os `.txt` das rodadas não ficaram; a restauração foi provada depois, com as cópias dos originais guardadas pelo executor iguais, pelo hash, aos arquivos atuais. Nenhuma suíte foi mutada;
    - as listas de mutantes estavam em CRLF e foram normalizadas para LF, com as tabelas geradas de novo iguais;
    - o `--conferir` de cada tarefa não rodou, porque o plano ainda não existia: ele roda inteiro na T5;
    - o verify da T4 foi salvo fora do `$rascunho`, na pasta temporária da sessão.

## Ferramentas

O extrator grava no repositório os blocos `arquivo=` e no `$rascunho` os blocos `rascunho=`. É o mesmo dos planos 3 a 5, sem mudança, e o executor de mutantes é o do plano 4, também sem mudança: a primeira linha do comentário ainda diz "plano 4" porque o arquivo é o mesmo, byte a byte. A tabela é a do plano 5 com as siglas deste plano.

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

```js rascunho=mutantes.mjs
// Executor de mutantes do plano 4 da F1. Roda da raiz do repositório (o cwd), sem caminho local.
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

```js rascunho=tabela-mutantes-p6.mjs
// Monta a tabela de mutantes do plano 6 a partir de <lista>.json e <lista>.saida.jsonl e grava <lista>.tabela.md.
// Uso: node tabela-mutantes-p6.mjs <lista.json>. Derruba a tabela (saída 1) se faltar linha, se um mutante não
// ficar vermelho sem estar declarado equivalente (campo equivalente da lista, com a razão), se uma queda não for
// AssertionError com ERR_ASSERTION ou se vier de suíte fora das do mutante.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [listaArg] = process.argv.slice(2)
if (!listaArg) { console.error('uso: node tabela-mutantes-p6.mjs <lista.json>'); process.exit(2) }
const caminhoLista = resolve(listaArg)
const lista = JSON.parse(readFileSync(caminhoLista, 'utf8'))
const linhas = readFileSync(caminhoLista.replace(/\.json$/, '.saida.jsonl'), 'utf8').split('\n').filter(Boolean).map((linha) => JSON.parse(linha))
const EQUIVALENTES = new Map(lista.filter((m) => typeof m.equivalente === 'string').map((m) => [m.nome, m.equivalente]))
const SIGLAS = new Map([
  ['testes/casa-loja-nucleo.test.mjs', 'LN'], ['testes/nucleo-cli.test.mjs', 'NC'], ['testes/casa-banco.test.mjs', 'CB']
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
writeFileSync(caminhoLista.replace(/\.json$/, '.tabela.md'), `${tabela.join('\n')}\n`)
for (const problema of problemas) console.log(`PROBLEMA ${problema}`)
console.log(`${lista.length} linhas: ${vermelhos} vermelhos, ${EQUIVALENTES.size} equivalente(s); testes mapeados: ${mapeados}`)
process.exitCode = problemas.length > 0 ? 1 : 0
```

## Tarefas

### Preparação

- [x] **Passo 1: rascunho, extrator, executor de mutantes e guarda.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
New-Item -ItemType Directory -Force $rascunho | Out-Null
$plano = 'docs\superpowers\plans\2026-11-07-f1-plano-6-nucleo.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --conferir --so extrair-do-plano.mjs mutantes.mjs; "saida: $LASTEXITCODE"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `igual extrair-do-plano.mjs`, `igual mutantes.mjs`, `saida: 0` e `False`. Se o extrator não estiver no `$rascunho`, ele é criado à mão com o bloco acima e conferido de novo.

Resultado (07/11): o plano ainda não existia, e a conferência foi contra o plano 5, de onde os dois blocos vêm iguais. O `mutantes.mjs` faltava no `$rascunho`: `gravado mutantes.mjs`; depois, `igual extrair-do-plano.mjs`, `igual mutantes.mjs`, `saida: 0` e `False`.

### Task 1: o esquema do núcleo

**Arquivos:** re-emitir `testes/casa-banco.test.mjs` inteiro (CB, de 23 para 24 testes) e `runtime/casa/esquemas.mjs` inteiro. O CB 13 passa a conferir as três tabelas do núcleo, e o CB 14, novo, prova cada trava do esquema com uma escrita que o CHECK recusa e uma que ele aceita, e o diário de cada tabela. A v1 provisória do HEAD é reescrita como v1 (Posição).

- [x] **Passo 1: o teste.**

```js arquivo=testes/casa-banco.test.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import {
  BancoIndisponivelError,
  ESPERA_OCUPADO_MS,
  abrirBanco,
  arquivoDoBanco,
  carregarSqlite,
  comBanco,
  comBancoDaCasa,
  ehAvisoExperimentalDoSqlite,
  pastaDoBanco,
  registrarDegradacao,
  sha256,
  sqliteDisponivel,
  transacao,
  uuidv7
} from '../runtime/casa/banco.mjs'
import { BANCOS, MIGRACOES_OMNI } from '../runtime/casa/esquemas.mjs'
import {
  escreverAtomico,
  lerSeExistir,
  registrarProjecao,
  situacaoDaProjecao
} from '../runtime/casa/projecao.mjs'

const URL_DO_BANCO = new URL('../runtime/casa/banco.mjs', import.meta.url).href

function casaTemporaria() {
  return mkdtempSync(join(tmpdir(), 'omni-casa-banco-'))
}

// Faxina de melhor esforço: erro aqui mascararia a asserção que falhou. Conexão vazada tem
// asserção própria nos testes de fechamento.
function apagar(casa) {
  try {
    rmSync(casa, { recursive: true, force: true })
  } catch {
    // Sobra pasta temporária; o teste que importa já disse o motivo.
  }
}

function tabelas(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((linha) => linha.name)
}

function rodarFilho(codigo, env) {
  return new Promise((resolver, rejeitar) => {
    const filho = spawn(process.execPath, ['--input-type=module', '-e', codigo], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    let saida = ''
    let erro = ''
    filho.stdout.on('data', (pedaco) => { saida += pedaco })
    filho.stderr.on('data', (pedaco) => { erro += pedaco })
    filho.on('error', rejeitar)
    filho.on('close', (codigoDeSaida) => resolver({ codigo: codigoDeSaida, saida, erro }))
  })
}

// Os filhos esperam até o mesmo instante para abrir o banco: a largada sai junta de verdade.
const LARGADA = `const espera = Number(process.env.OMNI_TESTE_LARGADA) - Date.now()
if (espera > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, espera)`

test('OMNI_CASA_SEM_SQLITE=1 desliga o banco com erro identificavel', () => {
  assert.throws(
    () => carregarSqlite({ OMNI_CASA_SEM_SQLITE: '1' }),
    (erro) => erro instanceof BancoIndisponivelError && erro.code === 'OMNI_CASA_SQLITE_INDISPONIVEL'
  )
  assert.equal(sqliteDisponivel({ OMNI_CASA_SEM_SQLITE: '1' }), false)
  assert.equal(sqliteDisponivel({}), true)
  assert.equal(typeof carregarSqlite({}).DatabaseSync, 'function')
})

test('so o aviso experimental do sqlite e calado', () => {
  const mensagem = 'SQLite is an experimental feature and might change at any time'
  assert.equal(ehAvisoExperimentalDoSqlite(mensagem, 'ExperimentalWarning'), true)
  assert.equal(ehAvisoExperimentalDoSqlite(mensagem, { type: 'ExperimentalWarning' }), true)
  const nomeado = new Error(mensagem)
  nomeado.name = 'ExperimentalWarning'
  assert.equal(ehAvisoExperimentalDoSqlite(nomeado), true)
  assert.equal(ehAvisoExperimentalDoSqlite('The Fetch API is an experimental feature', 'ExperimentalWarning'), false)
  assert.equal(ehAvisoExperimentalDoSqlite(mensagem, 'DeprecationWarning'), false)
  assert.equal(ehAvisoExperimentalDoSqlite(mensagem), false)
})

test('pasta do banco: variavel manda, casa de producao vai para o Local, as outras guardam dentro', () => {
  const appdata = resolve('C:/teste/Roaming')
  const local = resolve('C:/teste/Local')
  const env = { APPDATA: appdata, LOCALAPPDATA: local }
  assert.equal(pastaDoBanco(join(appdata, 'omni'), env), join(local, 'omni', 'casa'))
  assert.equal(pastaDoBanco(resolve('C:/outra/casa-do-omni'), env), join(resolve('C:/outra/casa-do-omni'), 'casa'))
  assert.equal(pastaDoBanco(join(appdata, 'omni'), { APPDATA: appdata }), join(appdata, 'omni', 'casa'))
  assert.equal(
    pastaDoBanco(join(appdata, 'omni'), { ...env, OMNI_CASA_BANCO: 'C:/banco/aqui' }),
    resolve('C:/banco/aqui')
  )
})

test('pasta do banco reconhece a casa de producao sem diferenciar maiusculas no Windows', { skip: process.platform !== 'win32' }, () => {
  const env = { APPDATA: 'C:\\Users\\Alguem\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\Alguem\\AppData\\Local' }
  assert.equal(
    pastaDoBanco('c:\\users\\ALGUEM\\appdata\\roaming\\OMNI', env),
    join(env.LOCALAPPDATA, 'omni', 'casa')
  )
})

test('uuid v7 tem formato, carimbo de tempo e ordem', () => {
  const formato = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  const instante = Date.UTC(2026, 10, 4, 12, 0, 0, 123)
  const id = uuidv7(instante)
  assert.match(id, formato)
  assert.equal(Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16), instante)
  assert.ok(uuidv7(instante) < uuidv7(instante + 1))
  assert.notEqual(uuidv7(instante), uuidv7(instante))
})

test('transacao confirma, desfaz no erro e recusa trabalho assincrono', () => {
  const casa = casaTemporaria()
  try {
    comBanco(join(casa, 't.db'), [{ versao: 1, nome: 't', sql: 'CREATE TABLE t (v INTEGER)' }], (db) => {
      assert.equal(transacao(db, () => { db.exec('INSERT INTO t VALUES (1)'); return 'ok' }), 'ok')
      assert.throws(() => transacao(db, () => {
        db.exec('INSERT INTO t VALUES (2)')
        throw new Error('falhou no meio')
      }), /falhou no meio/)
      assert.throws(() => transacao(db, () => {
        db.exec('INSERT INTO t VALUES (3)')
        return Promise.resolve()
      }), /não pode ser assíncrona/)
      assert.deepEqual(db.prepare('SELECT v FROM t ORDER BY v').all().map((linha) => linha.v), [1])
      // Nenhuma transação ficou pendurada: abrir outra não reclama de transação dentro de transação.
      assert.doesNotThrow(() => { db.exec('BEGIN'); db.exec('ROLLBACK') })
    })
  } finally {
    apagar(casa)
  }
})

test('comBanco fecha a conexao sempre, inclusive quando o uso devolve promessa', () => {
  const casa = casaTemporaria()
  try {
    let capturado
    assert.equal(comBanco(join(casa, 'a.db'), [], (db) => { capturado = db; return 7 }), 7)
    assert.throws(() => capturado.prepare('SELECT 1'), /not open/)
    assert.throws(
      () => comBanco(join(casa, 'a.db'), [], (db) => { capturado = db; return Promise.resolve(1) }),
      /não pode ser assíncrono/
    )
    assert.throws(() => capturado.prepare('SELECT 1'), /not open/)
    // Sem conexão pendurada, o Windows deixa apagar a pasta inteira.
    assert.doesNotThrow(() => rmSync(casa, { recursive: true }))
    assert.equal(existsSync(casa), false)
  } finally {
    apagar(casa)
  }
})

test('migracoes sao idempotentes e recusam migracao alterada depois de aplicada', () => {
  const casa = casaTemporaria()
  const arquivo = join(casa, 'm.db')
  const migracoes = [
    { versao: 1, nome: 'a', sql: 'CREATE TABLE a (id INTEGER PRIMARY KEY)' },
    { versao: 2, nome: 'b', sql: 'CREATE TABLE b (id INTEGER PRIMARY KEY)' }
  ]
  try {
    comBanco(arquivo, migracoes, () => {})
    const registradas = comBanco(arquivo, migracoes, (db) => db.prepare('SELECT versao, sha256 FROM _migracoes ORDER BY versao').all())
    assert.deepEqual(registradas.map((linha) => [linha.versao, linha.sha256]), migracoes.map((m) => [m.versao, sha256(m.sql)]))
    const alterada = [migracoes[0], { ...migracoes[1], sql: 'CREATE TABLE b (id TEXT PRIMARY KEY)' }]
    assert.throws(() => comBanco(arquivo, alterada, () => {}), /Migração 2 \(b\) mudou depois de aplicada/)
  } finally {
    apagar(casa)
  }
})

test('pragmas da casa valem em toda conexao', () => {
  const casa = casaTemporaria()
  try {
    comBanco(join(casa, 'p.db'), [], (db) => {
      assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal')
      assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout, ESPERA_OCUPADO_MS)
      assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1)
      assert.equal(db.prepare('PRAGMA synchronous').get().synchronous, 1)
    })
  } finally {
    apagar(casa)
  }
})

test('processos que abrem o banco ao mesmo tempo aplicam cada migracao uma vez so', async () => {
  const casa = casaTemporaria()
  const arquivo = join(casa, 'corrida.db')
  const codigo = `import { comBanco } from ${JSON.stringify(URL_DO_BANCO)}
${LARGADA}
const migracoes = [
  { versao: 1, nome: 'a', sql: 'CREATE TABLE a (id INTEGER PRIMARY KEY)' },
  { versao: 2, nome: 'b', sql: 'CREATE TABLE b (id INTEGER PRIMARY KEY)' }
]
const n = comBanco(process.env.OMNI_TESTE_ARQUIVO, migracoes, (db) => db.prepare('SELECT COUNT(*) AS n FROM _migracoes').get().n)
process.stdout.write(String(n))`
  try {
    const env = { OMNI_TESTE_ARQUIVO: arquivo, OMNI_TESTE_LARGADA: String(Date.now() + 1_500) }
    const filhos = await Promise.all(Array.from({ length: 6 }, () => rodarFilho(codigo, env)))
    for (const filho of filhos) {
      assert.equal(filho.codigo, 0, filho.erro)
      assert.equal(filho.saida, '2')
    }
    comBanco(arquivo, [], (db) => {
      assert.deepEqual(db.prepare('SELECT versao FROM _migracoes ORDER BY versao').all().map((linha) => linha.versao), [1, 2])
      assert.deepEqual(tabelas(db), ['_migracoes', 'a', 'b'])
    })
  } finally {
    apagar(casa)
  }
})

test('gravadores concorrentes em processos separados esperam a vez e nao perdem linha', async () => {
  const casa = casaTemporaria()
  const arquivo = join(casa, 'fila.db')
  const codigo = `import { comBanco, transacao } from ${JSON.stringify(URL_DO_BANCO)}
${LARGADA}
const migracoes = [{ versao: 1, nome: 'fila', sql: 'CREATE TABLE fila (quem TEXT NOT NULL, n INTEGER NOT NULL)' }]
for (let n = 0; n < 25; n += 1) {
  comBanco(process.env.OMNI_TESTE_ARQUIVO, migracoes, (db) => transacao(db, () => {
    db.prepare('INSERT INTO fila (quem, n) VALUES (?, ?)').run(String(process.pid), n)
  }))
}`
  try {
    const env = { OMNI_TESTE_ARQUIVO: arquivo, OMNI_TESTE_LARGADA: String(Date.now() + 1_500) }
    const filhos = await Promise.all(Array.from({ length: 4 }, () => rodarFilho(codigo, env)))
    for (const filho of filhos) assert.equal(filho.codigo, 0, filho.erro)
    comBanco(arquivo, [], (db) => {
      const porProcesso = db.prepare('SELECT quem, COUNT(*) AS n FROM fila GROUP BY quem').all()
      assert.equal(porProcesso.length, 4)
      for (const linha of porProcesso) assert.equal(linha.n, 25)
    })
  } finally {
    apagar(casa)
  }
})

test('transacao que le e depois grava espera a vez em vez de devolver ocupado', async () => {
  const casa = casaTemporaria()
  const arquivo = join(casa, 'contador.db')
  // O pai migra antes da largada: a corrida dos filhos fica só no ler-e-gravar da transação.
  comBanco(arquivo, [{ versao: 1, nome: 'contador', sql: 'CREATE TABLE contador (id INTEGER PRIMARY KEY, valor INTEGER NOT NULL); INSERT INTO contador (id, valor) VALUES (1, 0)' }], () => {})
  const codigo = `import { comBanco, esperar, transacao } from ${JSON.stringify(URL_DO_BANCO)}
${LARGADA}
comBanco(process.env.OMNI_TESTE_ARQUIVO, [], (db) => {
  for (let n = 0; n < 25; n += 1) {
    transacao(db, () => {
      const { valor } = db.prepare('SELECT valor FROM contador WHERE id = 1').get()
      esperar(2)
      db.prepare('UPDATE contador SET valor = ? WHERE id = 1').run(valor + 1)
    })
  }
})`
  try {
    const env = { OMNI_TESTE_ARQUIVO: arquivo, OMNI_TESTE_LARGADA: String(Date.now() + 1_500) }
    const filhos = await Promise.all(Array.from({ length: 4 }, () => rodarFilho(codigo, env)))
    for (const filho of filhos) assert.equal(filho.codigo, 0, filho.erro)
    comBanco(arquivo, [], (db) => {
      assert.equal(db.prepare('SELECT valor FROM contador WHERE id = 1').get().valor, 100)
    })
  } finally {
    apagar(casa)
  }
})

test('cada banco da casa abre com as tabelas do desenho', () => {
  const casa = casaTemporaria()
  const esperadas = {
    nucleo: ['_diario', '_migracoes', 'agentes', 'instalacoes', 'maquinas', 'sqlite_sequence'],
    omni: ['_diario', '_documentos_no_disco', '_estados_no_disco', '_importacoes', '_migracoes', '_projecoes', 'documentos', 'estado_registros', 'estados', 'memoria_meta', 'memorias', 'sqlite_sequence'],
    cofre: ['_diario', '_importacoes', '_migracoes', '_projecoes', 'credenciais', 'sqlite_sequence', 'usos']
  }
  try {
    assert.deepEqual(Object.keys(BANCOS), Object.keys(esperadas))
    for (const nome of Object.keys(BANCOS)) {
      assert.deepEqual(comBancoDaCasa(casa, nome, tabelas), esperadas[nome], nome)
      assert.equal(arquivoDoBanco(casa, nome), join(casa, 'casa', BANCOS[nome].arquivo))
    }
    assert.throws(() => arquivoDoBanco(casa, 'oraculo'), /Banco desconhecido na casa: oraculo/)
  } finally {
    apagar(casa)
  }
})

test('nucleo.db guarda catalogo, instalacoes e maquinas com as travas do desenho', () => {
  const casa = casaTemporaria()
  const sha = 'a'.repeat(64)
  const vivo = ['pc', 't0', 't0']
  try {
    comBancoDaCasa(casa, 'nucleo', (db) => {
      const maquina = db.prepare(`INSERT INTO maquinas (id, nome, sistema, visto_em, origem_maquina, criado_em, atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
      maquina.run('pc', 'PC', 'win32', 't0', ...vivo)
      assert.throws(() => maquina.run('PC-2', 'PC-2', 'win32', 't0', ...vivo), /CHECK/)
      assert.throws(() => maquina.run('', 'vazio', 'win32', 't0', ...vivo), /CHECK/)
      assert.throws(() => maquina.run('pc/b', 'barra', 'win32', 't0', ...vivo), /CHECK/)

      const agente = db.prepare(`INSERT INTO agentes (id, versao_agente, banco, manifesto, manifesto_sha256, origem_maquina, criado_em, atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      agente.run('exemplo', '0.3.0', 'exemplo.db', '{"agente":"exemplo"}', sha, ...vivo)
      agente.run('sem-banco', '1.0.0', null, '{}', sha, ...vivo)
      assert.throws(() => agente.run('outro', '1.0.0', 'exemplo.db', '{}', sha, ...vivo), /CHECK/)
      assert.throws(() => agente.run('lista', '1.0.0', null, '[]', sha, ...vivo), /CHECK/)
      assert.throws(() => agente.run('quebrado', '1.0.0', null, '{', sha, ...vivo), /CHECK/)
      assert.throws(() => agente.run('curto', '1.0.0', null, '{}', 'abc', ...vivo), /CHECK/)
      for (const id of ['Maiusculo', '9inicio', 'com_sub', 'a'.repeat(41), '']) {
        assert.throws(() => agente.run(id, '1.0.0', null, '{}', sha, ...vivo), /CHECK/, id)
      }
      agente.run('a'.repeat(40), '1.0.0', null, '{}', sha, ...vivo)

      const instalacao = db.prepare(`INSERT INTO instalacoes (id, maquina, agente, raiz, versao_agente, manifesto_sha256, origem_maquina, criado_em, atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      instalacao.run('pc/exemplo', 'pc', 'exemplo', 'C:/agentes/exemplo', '0.3.0', sha, ...vivo)
      assert.throws(() => instalacao.run('pc/outro', 'pc', 'exemplo', 'C:/x', '1.0.0', sha, ...vivo), /CHECK/)
      assert.throws(() => instalacao.run('pc/Errado', 'pc', 'Errado', 'C:/x', '1.0.0', sha, ...vivo), /CHECK/)
      assert.throws(() => instalacao.run('PC/exemplo', 'PC', 'exemplo', 'C:/x', '1.0.0', sha, ...vivo), /CHECK/)
      assert.throws(() => instalacao.run('pc/b/exemplo', 'pc/b', 'exemplo', 'C:/x', '1.0.0', sha, ...vivo), /CHECK/)
      assert.throws(() => instalacao.run('pc/sem-raiz', 'pc', 'sem-raiz', '', '1.0.0', sha, ...vivo), /CHECK/)
      assert.throws(() => instalacao.run('pc/curto', 'pc', 'curto', 'C:/x', '1.0.0', 'abc', ...vivo), /CHECK/)
      assert.throws(() => instalacao.run('pc/exemplo', 'pc', 'exemplo', 'C:/y', '0.3.0', sha, ...vivo), /UNIQUE|PRIMARY/)
      // Sem chave estrangeira: a sincronizacao aplica as linhas em qualquer ordem.
      instalacao.run('notebook/sem-catalogo', 'notebook', 'sem-catalogo', '/opt/agentes/x', '1.0.0', sha, 'notebook', 't0', 't0')

      // visto_em e relogio local: atualizar so ele nao sobe a versao e nao vai ao diario.
      db.prepare('UPDATE maquinas SET visto_em = ? WHERE id = ?').run('t1', 'pc')
      db.prepare('UPDATE maquinas SET nome = ?, versao = versao + 1 WHERE id = ?').run('PC novo', 'pc')
      db.prepare('UPDATE instalacoes SET apagado_em = ?, versao = versao + 1 WHERE id = ?').run('t2', 'pc/exemplo')
      const diario = db.prepare('SELECT tabela, linha, operacao, versao FROM _diario ORDER BY seq').all()
      assert.deepEqual(diario.map((l) => `${l.tabela}:${l.linha}:${l.operacao}:${l.versao}`), [
        'maquinas:pc:I:1',
        'agentes:exemplo:I:1',
        'agentes:sem-banco:I:1',
        `agentes:${'a'.repeat(40)}:I:1`,
        'instalacoes:pc/exemplo:I:1',
        'instalacoes:notebook/sem-catalogo:I:1',
        'maquinas:pc:U:2',
        'instalacoes:pc/exemplo:U:2'
      ])
    })
  } finally {
    apagar(casa)
  }
})

test('omni.db da v1 sobe para a v2 sem perder documento e a base por maquina exige documento existente', () => {
  const casa = casaTemporaria()
  try {
    comBanco(arquivoDoBanco(casa, 'omni'), [MIGRACOES_OMNI[0]], (db) => {
      db.exec(`INSERT INTO documentos (id, formato, conteudo, sha256, bytes, origem_maquina, criado_em, atualizado_em)
        VALUES ('claude-projects/p/memory/a.md', 'md', 'a', 'sha-a', 1, 'pc', 't0', 't0')`)
    })
    comBancoDaCasa(casa, 'omni', (db) => {
      assert.deepEqual(db.prepare('SELECT versao FROM _migracoes ORDER BY versao').all().map((linha) => linha.versao), [1, 2, 3])
      assert.equal(db.prepare('SELECT conteudo FROM documentos WHERE id = ?').get('claude-projects/p/memory/a.md').conteudo, 'a')
      const inserir = db.prepare('INSERT INTO _documentos_no_disco (maquina, id, sha256, em) VALUES (?, ?, ?, ?)')
      inserir.run('pc', 'claude-projects/p/memory/a.md', 'sha-a', 't1')
      assert.throws(() => inserir.run('pc', 'claude-projects/p/memory/nada.md', 'x', 't1'), /FOREIGN KEY/)
    })
  } finally {
    apagar(casa)
  }
})

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

test('diario anota insercao, mudanca de versao e remocao; arrumacao de ordem nao vira trafego', () => {
  const casa = casaTemporaria()
  try {
    comBancoDaCasa(casa, 'omni', (db) => {
      db.exec(`INSERT INTO memorias (id, raia, ordem, corpo, origem_maquina, criado_em, atualizado_em)
        VALUES ('m1', 'confirmed', 0, '{}', 'pc', 't0', 't0')`)
      db.exec("UPDATE memorias SET ordem = 5 WHERE id = 'm1'")
      db.exec(`UPDATE memorias SET corpo = '{"a":1}', versao = versao + 1 WHERE id = 'm1'`)
      db.exec("DELETE FROM memorias WHERE id = 'm1'")
      const diario = db.prepare('SELECT tabela, linha, operacao, versao FROM _diario ORDER BY seq').all()
      assert.deepEqual(
        diario.map((linha) => `${linha.tabela}:${linha.linha}:${linha.operacao}:${linha.versao}`),
        ['memorias:m1:I:1', 'memorias:m1:U:2', 'memorias:m1:D:2']
      )
    })
  } finally {
    apagar(casa)
  }
})

test('situacao da projecao cobre vazio, externa, sem-arquivo, atual e defasada', () => {
  const casa = casaTemporaria()
  try {
    comBancoDaCasa(casa, 'omni', (db) => {
      const arquivo = 'memory/memory.json'
      assert.equal(situacaoDaProjecao(db, arquivo, null, null), 'vazio')
      assert.equal(situacaoDaProjecao(db, arquivo, 'aaa', null), 'externa')
      assert.equal(situacaoDaProjecao(db, arquivo, null, 'bbb'), 'sem-arquivo')
      assert.equal(situacaoDaProjecao(db, arquivo, 'bbb', 'bbb'), 'atual')
      assert.equal(situacaoDaProjecao(db, arquivo, 'aaa', 'bbb'), 'externa')
      registrarProjecao(db, arquivo, 'aaa', 'escrita')
      assert.equal(situacaoDaProjecao(db, arquivo, 'aaa', 'bbb'), 'defasada')
      // O histórico é por arquivo: o mesmo hash em outro arquivo continua desconhecido.
      assert.equal(situacaoDaProjecao(db, 'outro.json', 'aaa', 'bbb'), 'externa')
    })
  } finally {
    apagar(casa)
  }
})

test('registrar a mesma projecao de novo nao duplica nem troca o papel', () => {
  const casa = casaTemporaria()
  try {
    comBancoDaCasa(casa, 'omni', (db) => {
      registrarProjecao(db, 'memory/memory.json', 'aaa', 'ingerida')
      registrarProjecao(db, 'memory/memory.json', 'aaa', 'escrita')
      const linhas = db.prepare('SELECT papel FROM _projecoes').all()
      assert.deepEqual(linhas.map((linha) => linha.papel), ['ingerida'])
    })
  } finally {
    apagar(casa)
  }
})

test('escrita atomica cria a pasta, substitui o arquivo e nao deixa temporario', () => {
  const casa = casaTemporaria()
  try {
    const caminho = join(casa, 'sub', 'dados.json')
    escreverAtomico(caminho, 'primeiro')
    escreverAtomico(caminho, 'segundo')
    assert.equal(readFileSync(caminho, 'utf8'), 'segundo')
    assert.deepEqual(readdirSync(join(casa, 'sub')), ['dados.json'])
  } finally {
    apagar(casa)
  }
})

test('lerSeExistir devolve null so para arquivo ausente', () => {
  const casa = casaTemporaria()
  try {
    assert.equal(lerSeExistir(join(casa, 'nada.json')), null)
    writeFileSync(join(casa, 'algo.json'), 'conteudo')
    assert.equal(lerSeExistir(join(casa, 'algo.json')), 'conteudo')
    assert.throws(() => lerSeExistir(casa), (erro) => erro.code === 'EISDIR')
  } finally {
    apagar(casa)
  }
})

test('registro de degradacao guarda operacao e erro, nunca trecho de conteudo', () => {
  const casa = casaTemporaria()
  try {
    let invalido
    try {
      // O V8 cita um trecho do texto nesta mensagem ("egredo": texto da me...): é o vazamento a barrar.
      JSON.parse('{"segredo": texto da memoria}')
    } catch (erro) {
      invalido = erro
    }
    registrarDegradacao(casa, 'memoria.carregar', invalido)
    const ocupado = Object.assign(new Error('database is locked'), { code: 'ERR_SQLITE_ERROR' })
    registrarDegradacao(casa, 'memoria.gravar', ocupado)
    const linhas = readFileSync(join(casa, 'casa', 'degradacoes.jsonl'), 'utf8').trim().split('\n').map((linha) => JSON.parse(linha))
    assert.deepEqual(linhas.map(({ operacao, codigo, erro }) => ({ operacao, codigo, erro })), [
      { operacao: 'memoria.carregar', codigo: null, erro: 'JSON inválido' },
      { operacao: 'memoria.gravar', codigo: 'ERR_SQLITE_ERROR', erro: 'database is locked' }
    ])
    assert.doesNotMatch(readFileSync(join(casa, 'casa', 'degradacoes.jsonl'), 'utf8'), /egredo|texto da/)
    for (const linha of linhas) assert.ok(!Number.isNaN(Date.parse(linha.em)))
  } finally {
    apagar(casa)
  }
})

test('falha ao anotar a degradacao nunca vira a segunda falha', () => {
  const casa = casaTemporaria()
  try {
    writeFileSync(join(casa, 'arquivo'), 'x')
    assert.doesNotThrow(() => registrarDegradacao(casa, 'x', new Error('y'), { OMNI_CASA_BANCO: join(casa, 'arquivo', 'sub') }))
  } finally {
    apagar(casa)
  }
})

test('abrirBanco fecha a conexao quando a migracao falha', () => {
  const casa = casaTemporaria()
  try {
    assert.throws(() => abrirBanco(join(casa, 'quebrado.db'), [{ versao: 1, nome: 'ruim', sql: 'CREATE TABLE (' }]), /syntax error/)
    // No Windows, arquivo com conexão aberta não apaga: é a prova de que a falha fechou o banco.
    assert.doesNotThrow(() => rmSync(join(casa, 'quebrado.db')))
    assert.equal(existsSync(join(casa, 'quebrado.db')), false)
  } finally {
    apagar(casa)
  }
})
```

- [x] **Passo 2: extrair o teste e ver o vermelho.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-07-f1-plano-6-nucleo.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so testes/casa-banco.test.mjs
node --test --test-concurrency=1 --test-reporter=spec testes/casa-banco.test.mjs *> "$rascunho\p6-t1-vermelho.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\p6-t1-vermelho.txt" -Pattern 'AssertionError|has no column named', '(tests|pass|fail) \d+\s*$'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `gravado testes/casa-banco.test.mjs`, `saida: 1`, `tests 24`, `pass 22` e `fail 2`: o CB 13 cai pela asserção das tabelas do `nucleo`, e o CB 14 cai porque a v1 provisória não tem as colunas novas; `False`.

Resultado (07/11), visto numa cópia do HEAD (executor, item 13): `saida: 1`, `tests 24`, `pass 22`, `fail 2`; o CB 13 com `AssertionError [ERR_ASSERTION]` na conferência do `nucleo`, e o CB 14 com `table maquinas has no column named sistema`; `False`.

- [x] **Passo 3: o módulo.** Os esquemas inteiros, com os planos 2 a 4 dentro; o que muda é só o `MIGRACOES_NUCLEO` e o comentário dele (decisões 1 a 5 e 11).

```js arquivo=runtime/casa/esquemas.mjs
// Migrações numeradas de cada arquivo da casa. Migração aplicada nunca muda: o banco guarda o
// sha256 do SQL e recusa abrir se o texto divergir. Mudança de esquema = migração nova no fim.
//
// Toda tabela de dado vivo nasce pronta para a sincronização entre máquinas (§3.1): id texto
// (UUID v7 ou id natural estável), origem_maquina, criado_em, atualizado_em, versao, lápide em
// apagado_em e gatilhos que registram cada mudança no _diario do próprio arquivo. (Gatilho
// persistente do SQLite não grava em outro arquivo anexado; por isso o diário é por arquivo.)
// Toda mudança que importa sobe a versao; o diário só anota UPDATE quando a versao muda, e a
// arrumação local (como a ordem de exibição) não vira tráfego de sincronização.

const VIVO = `origem_maquina TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  versao INTEGER NOT NULL DEFAULT 1,
  apagado_em TEXT`

const DIARIO = `CREATE TABLE _diario (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  tabela TEXT NOT NULL,
  linha TEXT NOT NULL,
  operacao TEXT NOT NULL CHECK (operacao IN ('I', 'U', 'D')),
  versao INTEGER,
  em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);`

export function gatilhosDeDiario(tabela) {
  const linha = (lado, op) => `INSERT INTO _diario (tabela, linha, operacao, versao) VALUES ('${tabela}', ${lado}.id, '${op}', ${lado}.versao);`
  return `
CREATE TRIGGER ${tabela}_diario_i AFTER INSERT ON ${tabela} BEGIN ${linha('NEW', 'I')} END;
CREATE TRIGGER ${tabela}_diario_u AFTER UPDATE ON ${tabela} WHEN NEW.versao IS NOT OLD.versao BEGIN ${linha('NEW', 'U')} END;
CREATE TRIGGER ${tabela}_diario_d AFTER DELETE ON ${tabela} BEGIN ${linha('OLD', 'D')} END;`
}

// Projeção em arquivo (§3.2): o banco é a fonte; o arquivo é cópia gerada para quem ainda lê
// do disco. _projecoes guarda o hash de cada versão que o banco escreveu ou ingeriu; o hash da
// versão corrente mora junto do próprio dado (memoria_meta.texto_sha256, documentos.sha256,
// credenciais.blob_sha256). Hash desconhecido no disco é escrita externa a ingerir.
const PROJECOES = `CREATE TABLE _projecoes (
  arquivo TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  papel TEXT NOT NULL CHECK (papel IN ('escrita', 'ingerida')),
  em TEXT NOT NULL,
  PRIMARY KEY (arquivo, sha256)
);`

const IMPORTACOES = `CREATE TABLE _importacoes (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,
  fonte TEXT NOT NULL,
  fonte_sha256 TEXT NOT NULL,
  contagens TEXT NOT NULL,
  origem_maquina TEXT NOT NULL,
  feita_em TEXT NOT NULL
);`

// Nome de agente: o mesmo formato do cofre (minúscula, dígito e hífen; começa por letra; até 40).
const slug = (coluna) => `length(${coluna}) BETWEEN 1 AND 40 AND ${coluna} GLOB '[a-z]*' AND ${coluna} NOT GLOB '*[^a-z0-9-]*'`
// Máquina: o hostname em minúsculas, sem barra (a barra separa máquina e agente no id da instalação).
const maquinaValida = (coluna) => `length(${coluna}) BETWEEN 1 AND 253 AND ${coluna} = lower(${coluna}) AND ${coluna} NOT GLOB '*/*'`

// nucleo.db (§4.2): quem é cada agente (catálogo, igual em toda máquina: o último registrado
// vence), onde ele está instalado (cada máquina grava só as próprias linhas) e quais máquinas a
// casa conhece. Sem chave estrangeira entre as tabelas: a sincronização aplica em qualquer ordem.
// maquinas.visto_em é relógio local: atualizá-lo não sobe a versao e não vira tráfego.
export const MIGRACOES_NUCLEO = [
  {
    versao: 1,
    nome: 'catalogo de agentes, instalacoes e maquinas',
    sql: `${DIARIO}
CREATE TABLE maquinas (
  id TEXT PRIMARY KEY CHECK (${maquinaValida('id')}),
  nome TEXT NOT NULL,
  sistema TEXT NOT NULL,
  visto_em TEXT NOT NULL,
  ${VIVO}
);
${gatilhosDeDiario('maquinas')}
CREATE TABLE agentes (
  id TEXT PRIMARY KEY CHECK (${slug('id')}),
  versao_agente TEXT NOT NULL,
  banco TEXT CHECK (banco IS NULL OR banco = id || '.db'),
  manifesto TEXT NOT NULL CHECK (CASE WHEN json_valid(manifesto) THEN json_type(manifesto) = 'object' ELSE 0 END),
  manifesto_sha256 TEXT NOT NULL CHECK (length(manifesto_sha256) = 64),
  ${VIVO}
);
${gatilhosDeDiario('agentes')}
CREATE TABLE instalacoes (
  id TEXT PRIMARY KEY CHECK (id = maquina || '/' || agente),
  maquina TEXT NOT NULL CHECK (${maquinaValida('maquina')}),
  agente TEXT NOT NULL CHECK (${slug('agente')}),
  raiz TEXT NOT NULL CHECK (length(raiz) > 0),
  versao_agente TEXT NOT NULL,
  manifesto_sha256 TEXT NOT NULL CHECK (length(manifesto_sha256) = 64),
  ${VIVO}
);
${gatilhosDeDiario('instalacoes')}`
  }
]

export const MIGRACOES_OMNI = [
  {
    versao: 1,
    nome: 'memoria, documentos e projecoes',
    sql: `${DIARIO}
${PROJECOES}
${IMPORTACOES}
CREATE TABLE memorias (
  id TEXT PRIMARY KEY,
  raia TEXT NOT NULL CHECK (raia IN ('confirmed', 'candidates', 'archive')),
  ordem INTEGER NOT NULL,
  tipo TEXT,
  texto TEXT,
  corpo TEXT NOT NULL,
  ${VIVO}
);
CREATE INDEX memorias_por_raia ON memorias (raia, ordem) WHERE apagado_em IS NULL;
${gatilhosDeDiario('memorias')}
CREATE TABLE memoria_meta (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
CREATE TABLE documentos (
  id TEXT PRIMARY KEY,
  formato TEXT NOT NULL CHECK (formato IN ('json', 'md', 'texto')),
  conteudo TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  ${VIVO}
);
${gatilhosDeDiario('documentos')}`
  },
  // v2 (plano 2 da F1): base comum do merge de três vias dos .md, por máquina — o hash que banco
  // e disco tinham em comum na última reconciliação. Tabela interna, sem diário: é estado local
  // de cada máquina, não dado a sincronizar.
  {
    versao: 2,
    nome: 'documentos no disco por maquina',
    sql: `CREATE TABLE _documentos_no_disco (
  maquina TEXT NOT NULL,
  id TEXT NOT NULL REFERENCES documentos (id),
  sha256 TEXT NOT NULL,
  em TEXT NOT NULL,
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

// A v1 do cofre foi revista no plano 4 (guarda dpapi | gerenciador-windows; blob nulo no inventário só de nomes) e congela com o push dele: mudança daí em diante é migração nova.
export const MIGRACOES_COFRE = [
  {
    versao: 1,
    nome: 'credenciais e usos',
    sql: `${DIARIO}
${PROJECOES}
${IMPORTACOES}
CREATE TABLE credenciais (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('senha', 'token', 'chave-api', 'conexao', 'conta-servico', 'ssh', 'outro')),
  servico TEXT,
  url TEXT,
  usuario TEXT,
  notas TEXT,
  etiquetas TEXT NOT NULL DEFAULT '[]',
  agentes TEXT NOT NULL DEFAULT '["omni"]',
  validade TEXT,
  rotacionar_dias INTEGER,
  ultimo_teste_em TEXT,
  ultimo_teste_ok INTEGER,
  ultimo_teste_detalhe TEXT,
  guarda TEXT NOT NULL CHECK (guarda IN ('dpapi', 'gerenciador-windows')),
  alvo_windows TEXT,
  blob BLOB,
  blob_sha256 TEXT,
  ${VIVO},
  CHECK ((guarda = 'gerenciador-windows') = (alvo_windows IS NOT NULL)),
  CHECK ((guarda = 'dpapi') = (blob IS NOT NULL)),
  CHECK ((blob IS NULL) = (blob_sha256 IS NULL)),
  CHECK (CASE WHEN json_valid(agentes) THEN json_type(agentes) = 'array' ELSE 0 END),
  CHECK (CASE WHEN json_valid(etiquetas) THEN json_type(etiquetas) = 'array' ELSE 0 END)
);
CREATE UNIQUE INDEX credenciais_nome_vivo ON credenciais (nome) WHERE apagado_em IS NULL;
${gatilhosDeDiario('credenciais')}
CREATE TABLE usos (
  id TEXT PRIMARY KEY,
  credencial_id TEXT,
  nome TEXT NOT NULL,
  agente TEXT NOT NULL,
  sessao TEXT,
  motivo TEXT NOT NULL,
  resultado TEXT NOT NULL,
  em TEXT NOT NULL,
  origem_maquina TEXT NOT NULL
);
CREATE INDEX usos_por_credencial ON usos (credencial_id, em);`
  }
]

export const BANCOS = Object.freeze({
  nucleo: Object.freeze({ arquivo: 'nucleo.db', migracoes: MIGRACOES_NUCLEO }),
  omni: Object.freeze({ arquivo: 'omni.db', migracoes: MIGRACOES_OMNI }),
  cofre: Object.freeze({ arquivo: 'cofre.db', migracoes: MIGRACOES_COFRE })
})
```

- [x] **Passo 4: extrair o módulo e ver o verde.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-07-f1-plano-6-nucleo.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so runtime/casa/esquemas.mjs
node --check runtime/casa/esquemas.mjs; "check: $LASTEXITCODE"
node --test --test-concurrency=1 --test-reporter=spec testes/casa-banco.test.mjs *> "$rascunho\p6-t1-verde.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\p6-t1-verde.txt" -Pattern '(tests|pass|fail) \d+\s*$'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `gravado runtime/casa/esquemas.mjs`, `check: 0`, `tests 24`, `pass 24`, `fail 0`, `saida: 0` e `False`.

Resultado (07/11): `tests 24`, `pass 24`, `fail 0`, `saida: 0` e `False`.

**Mutação.** Dezessete mutantes, todos no esquema, cada um desligando uma trava ou um diário. Cada um tem o trecho exato (uma vez só no arquivo), a troca e as suítes que devem matá-lo. O executor aplica um por vez, roda as suítes do mutante pelo `run()` do `node:test`, restaura sempre e anota cada teste que caiu. A tabela derruba a rodada se um mutante sobreviver sem estar declarado equivalente, se uma queda não for `AssertionError` com `ERR_ASSERTION` ou se vier de suíte fora das do mutante: mutante que morre no setup não prova nada. Não há mapa previsto: a tabela do Apêndice A, gerada da rodada, é o registro de onde cada um caiu.

```json rascunho=mutantes-p6-t1.json
[
  {"nome":"01 catalogo aceita banco de outro agente","arquivo":"runtime/casa/esquemas.mjs","de":"banco TEXT CHECK (banco IS NULL OR banco = id || '.db'),","para":"banco TEXT,","teste":["testes/casa-banco.test.mjs"]},
  {"nome":"02 manifesto aceita lista","arquivo":"runtime/casa/esquemas.mjs","de":"THEN json_type(manifesto) = 'object' ELSE","para":"THEN json_type(manifesto) IN ('object', 'array') ELSE","teste":["testes/casa-banco.test.mjs"]},
  {"nome":"03 manifesto quebrado passa","arquivo":"runtime/casa/esquemas.mjs","de":"= 'object' ELSE 0 END","para":"= 'object' ELSE 1 END","teste":["testes/casa-banco.test.mjs"]},
  {"nome":"04 catalogo aceita sha curto","arquivo":"runtime/casa/esquemas.mjs","de":"CHECK (length(manifesto_sha256) = 64),\n  ${VIVO}\n);\n${gatilhosDeDiario('agentes')}","para":"CHECK (length(manifesto_sha256) > 0),\n  ${VIVO}\n);\n${gatilhosDeDiario('agentes')}","teste":["testes/casa-banco.test.mjs"]},
  {"nome":"05 instalacao aceita sha curto","arquivo":"runtime/casa/esquemas.mjs","de":"CHECK (length(manifesto_sha256) = 64),\n  ${VIVO}\n);\n${gatilhosDeDiario('instalacoes')}","para":"CHECK (length(manifesto_sha256) > 0),\n  ${VIVO}\n);\n${gatilhosDeDiario('instalacoes')}","teste":["testes/casa-banco.test.mjs"]},
  {"nome":"06 agente pode comecar por digito","arquivo":"runtime/casa/esquemas.mjs","de":"${coluna} GLOB '[a-z]*'","para":"${coluna} GLOB '*'","teste":["testes/casa-banco.test.mjs"]},
  {"nome":"07 agente aceita qualquer caractere","arquivo":"runtime/casa/esquemas.mjs","de":" AND ${coluna} NOT GLOB '*[^a-z0-9-]*'","para":"","teste":["testes/casa-banco.test.mjs"]},
  {"nome":"08 agente com 41 caracteres","arquivo":"runtime/casa/esquemas.mjs","de":"BETWEEN 1 AND 40","para":"BETWEEN 1 AND 41","teste":["testes/casa-banco.test.mjs"]},
  {"nome":"09 maquina aceita maiuscula","arquivo":"runtime/casa/esquemas.mjs","de":" AND ${coluna} = lower(${coluna})","para":"","teste":["testes/casa-banco.test.mjs"]},
  {"nome":"10 maquina aceita barra","arquivo":"runtime/casa/esquemas.mjs","de":" AND ${coluna} NOT GLOB '*/*'","para":"","teste":["testes/casa-banco.test.mjs"]},
  {"nome":"11 maquina vazia","arquivo":"runtime/casa/esquemas.mjs","de":"BETWEEN 1 AND 253","para":"BETWEEN 0 AND 253","teste":["testes/casa-banco.test.mjs"]},
  {"nome":"12 id da instalacao livre","arquivo":"runtime/casa/esquemas.mjs","de":"CHECK (id = maquina || '/' || agente)","para":"CHECK (length(id) > 0)","teste":["testes/casa-banco.test.mjs"]},
  {"nome":"13 raiz vazia","arquivo":"runtime/casa/esquemas.mjs","de":"CHECK (length(raiz) > 0)","para":"CHECK (length(raiz) >= 0)","teste":["testes/casa-banco.test.mjs"]},
  {"nome":"14 maquinas sem diario","arquivo":"runtime/casa/esquemas.mjs","de":"${gatilhosDeDiario('maquinas')}","para":"","teste":["testes/casa-banco.test.mjs"]},
  {"nome":"15 instalacoes sem diario","arquivo":"runtime/casa/esquemas.mjs","de":"${gatilhosDeDiario('instalacoes')}","para":"","teste":["testes/casa-banco.test.mjs"]},
  {"nome":"16 instalacao sem trava de maquina","arquivo":"runtime/casa/esquemas.mjs","de":"maquina TEXT NOT NULL CHECK (${maquinaValida('maquina')}),","para":"maquina TEXT NOT NULL,","teste":["testes/casa-banco.test.mjs"]},
  {"nome":"17 instalacao sem trava de agente","arquivo":"runtime/casa/esquemas.mjs","de":"agente TEXT NOT NULL CHECK (${slug('agente')}),","para":"agente TEXT NOT NULL,","teste":["testes/casa-banco.test.mjs"]}
]
```

- [x] **Passo 5: extrair a lista e a tabela, e anotar os hashes.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-07-f1-plano-6-nucleo.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so mutantes.mjs tabela-mutantes-p6.mjs mutantes-p6-t1.json
$alvos = 'runtime/casa/esquemas.mjs', 'testes/casa-banco.test.mjs'
$alvos | ForEach-Object { $_ + ' ' + (Get-FileHash $_ -Algorithm SHA256).Hash.Substring(0, 12) } | Set-Content -Encoding utf8 "$rascunho\hashes-antes-p6-t1.txt"
Get-Content "$rascunho\hashes-antes-p6-t1.txt"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `igual mutantes.mjs`, `gravado tabela-mutantes-p6.mjs`, `gravado mutantes-p6-t1.json`, as duas linhas de hash e `False`.

Resultado (07/11): a lista e a tabela foram gravadas no `$rascunho`; os hashes não foram anotados (executor, item 13).

- [x] **Passo 6: rodar, em segundo plano.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
node "$rascunho\mutantes.mjs" "$rascunho\mutantes-p6-t1.json" *> "$rascunho\mutantes-p6-t1.txt"; "saida: $LASTEXITCODE"
```

Esperado: a última linha de `mutantes-p6-t1.txt` é `17 mutantes em … s; fora do vermelho: 0`, e `saida: 0`.

Resultado (07/11): os 17 vermelhos, com as 17 linhas no `mutantes-p6-t1.saida.jsonl`; o `.txt` e o tempo não ficaram (executor, item 13).

- [x] **Passo 7: a tabela, os hashes e a guarda.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-07-f1-plano-6-nucleo.md'
$alvos = 'runtime/casa/esquemas.mjs', 'testes/casa-banco.test.mjs'
node "$rascunho\tabela-mutantes-p6.mjs" "$rascunho\mutantes-p6-t1.json"; "saida: $LASTEXITCODE"
$depois = $alvos | ForEach-Object { $_ + ' ' + (Get-FileHash $_ -Algorithm SHA256).Hash.Substring(0, 12) }
Compare-Object (Get-Content "$rascunho\hashes-antes-p6-t1.txt") $depois
git status --short
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --conferir; "saida: $LASTEXITCODE"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `17 linhas: 17 vermelhos, 0 equivalente(s); testes mapeados: 17`, nenhuma linha `PROBLEMA` e `saida: 0`; o `Compare-Object` calado; no status, ` M runtime/casa/esquemas.mjs`, ` M testes/casa-banco.test.mjs` e `?? docs/superpowers/plans/2026-11-07-f1-plano-6-nucleo.md`, além dos ` M dist/…` de fim de linha; os `igual` dos blocos já extraídos e `saida: 0`; e `False`. A tabela gerada (`$rascunho\mutantes-p6-t1.tabela.md`) entra no Apêndice A.

Resultado (07/11): `17 linhas: 17 vermelhos, 0 equivalente(s); testes mapeados: 17`, nenhuma linha `PROBLEMA` e `saida: 0`. Os hashes e o `--conferir` ficaram para depois (executor, item 13): o esquema guardado pelo executor antes da rodada tem o mesmo hash do atual, e o `--conferir` roda na T5. A tabela está no Apêndice A.

### Task 2: a loja do núcleo

**Arquivos:** criar `testes/casa-loja-nucleo.test.mjs` (LN, 60 testes) e `runtime/casa/loja-nucleo.mjs`. A LN abre o `nucleo.db` numa casa temporária e prova o manifesto mínimo e o completo, a idempotência pelo sha, a mudança de raiz e de manifesto, o catálogo com o último vencendo, a lápide e a revivência, as máquinas e o `visto_em`, a listagem por máquina com o `catalogoDiverge`, a leitura do arquivo (raiz absoluta, falta e limite) e, numa tabela, cinquenta manifestos que precisam ser recusados, um teste por caso, cada um conferindo que sai um problema só, e do campo esperado. O manifesto que nem é objeto JSON tem teste próprio, que confere que o conteúdo não aparece no erro.

- [x] **Passo 1: o teste.**

```js arquivo=testes/casa-loja-nucleo.test.mjs
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { comBancoDaCasa, sha256 } from '../runtime/casa/banco.mjs'
import {
  LIMITE_MANIFESTO,
  NucleoError,
  lerManifesto,
  listarInstalados,
  listarMaquinas,
  registrarAgente,
  registrarMaquina,
  retirarAgente,
  validarManifesto
} from '../runtime/casa/loja-nucleo.mjs'

// Manifestos de exemplo no formato dos agentes da casa; nenhum é cópia de agente real.
function completo() {
  return {
    agente: 'exemplo',
    versao: '0.3.0',
    banco: 'exemplo.db',
    migracoes: 'migrations/',
    requer: { node: '>=24', agentes: ['omni>=0.26'] },
    executor: { comando: 'node executor/exemplo-executor.mjs', modos: ['instalar', 'importar', 'exportar', 'atualizar', 'verificar', 'servir'] },
    interface: {
      modulo: 'interface/index.html',
      preload: 'interface/preload.js',
      painel: 'Exemplo',
      api: 'http://127.0.0.1:{porta}/v1',
      rotas: [
        { metodo: 'GET', padrao: '^/v1/itens$', escopo: 'qualquer' },
        { metodo: 'PATCH', padrao: '^/v1/itens/[^/]+$', escopo: 'tela' }
      ]
    },
    tarefas: [
      { id: 'visita', lancador: 'omni', roteiro: 'roteiros/visita.md', variaveis: ['MOTIVO', 'HOJE'], quando: { diaria: '07:00' }, seAtrasada: true },
      { id: 'vigia', comando: 'node vigia.mjs', quando: { acada: 'PT15M' }, seAtrasada: false }
    ],
    credenciais: ['exemplo/api'],
    anotacao: { livre: 'campo a mais e tolerado' }
  }
}

function minimo() {
  return { agente: 'segundo', versao: '0.1.0', banco: null, requer: {}, tarefas: [], credenciais: [] }
}

const bytes = (objeto) => Buffer.from(JSON.stringify(objeto, null, 2), 'utf8')
const OPCOES = { maquina: 'pc', nome: 'PC', sistema: 'win32', agora: 't0' }
const RAIZ = resolve(tmpdir(), 'agentes-exemplo', 'exemplo')

function recusa(texto) {
  try {
    validarManifesto(texto)
  } catch (falha) {
    assert.ok(falha instanceof NucleoError, String(falha))
    assert.equal(falha.code, 'manifesto-invalido')
    return falha.erros
  }
  assert.fail('o manifesto deveria ter sido recusado')
}

function casaTemporaria() {
  return mkdtempSync(join(tmpdir(), 'omni-casa-nucleo-'))
}

function apagar(casa) {
  try {
    rmSync(casa, { recursive: true, force: true })
  } catch {
    // Sobra pasta temporária; a asserção que importa já falou.
  }
}

function comNucleo(uso) {
  const casa = casaTemporaria()
  try {
    return comBancoDaCasa(casa, 'nucleo', uso)
  } finally {
    apagar(casa)
  }
}

const diario = (db) => db.prepare('SELECT tabela, linha, operacao, versao FROM _diario ORDER BY seq').all()
  .map((l) => `${l.tabela}:${l.linha}:${l.operacao}:${l.versao}`)

test('manifesto completo e minimo passam; o sha e dos bytes crus e o texto gravado e o objeto lido', () => {
  const crus = bytes(completo())
  const lido = validarManifesto(crus)
  assert.equal(lido.sha256, sha256(crus))
  assert.deepEqual(lido.manifesto, completo())
  assert.equal(lido.texto, JSON.stringify(completo()))
  assert.deepEqual(validarManifesto(bytes(minimo())).manifesto, minimo())

  const comBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(completo()).replaceAll(',', ',\r\n'))])
  let outro
  assert.doesNotThrow(() => { outro = validarManifesto(comBom) })
  assert.notEqual(outro.sha256, lido.sha256)
  assert.equal(outro.texto, lido.texto)
  assert.equal(validarManifesto(JSON.stringify(minimo())).texto, JSON.stringify(minimo()))
})

const RECUSAS = [
  ['agente ausente', (m) => { delete m.agente }, 'agente'],
  ['agente maiusculo', (m) => { m.agente = 'Exemplo'; m.banco = 'Exemplo.db' }, 'agente'],
  ['agente reservado', (m) => { m.agente = 'cofre'; m.banco = 'cofre.db' }, 'agente'],
  ['versao fora do semver', (m) => { m.versao = '1.0' }, 'versao'],
  ['banco de outro agente', (m) => { m.banco = 'outro.db' }, 'banco'],
  ['banco ausente', (m) => { delete m.banco }, 'banco'],
  ['banco sem migracoes', (m) => { delete m.migracoes }, 'migracoes'],
  ['migracoes sem banco', (m) => { m.banco = null }, 'migracoes'],
  ['migracoes absoluta', (m) => { m.migracoes = '/migrations/' }, 'migracoes'],
  ['migracoes que sobe', (m) => { m.migracoes = 'a/../../fora/' }, 'migracoes'],
  ['migracoes com barra invertida', (m) => { m.migracoes = 'a\\b' }, 'migracoes'],
  ['migracoes com unidade', (m) => { m.migracoes = 'C:migrations/' }, 'migracoes'],
  ['requer ausente', (m) => { delete m.requer }, 'requer'],
  ['node fora do formato', (m) => { m.requer.node = '^24' }, 'requer.node'],
  ['agente requerido sem versao', (m) => { m.requer.agentes = ['omni'] }, 'requer.agentes'],
  ['agente requerido repetido', (m) => { m.requer.agentes = ['omni>=0.26', 'omni>=0.27'] }, 'requer.agentes'],
  ['executor sem comando', (m) => { m.executor.comando = '' }, 'executor.comando'],
  ['modo desconhecido', (m) => { m.executor.modos = ['instalar', 'apagar'] }, 'executor.modos'],
  ['modos vazio', (m) => { m.executor.modos = [] }, 'executor.modos'],
  ['modo repetido', (m) => { m.executor.modos = ['instalar', 'instalar'] }, 'executor.modos'],
  ['modulo que nao e html', (m) => { m.interface.modulo = 'interface/index.js' }, 'interface.modulo'],
  ['modulo absoluto', (m) => { m.interface.modulo = '/interface/index.html' }, 'interface.modulo'],
  ['preload que nao e js', (m) => { m.interface.preload = 'interface/preload.ts' }, 'interface.preload'],
  ['painel longo', (m) => { m.interface.painel = 'x'.repeat(41) }, 'interface.painel'],
  ['api em localhost', (m) => { m.interface.api = 'http://localhost:{porta}/v1' }, 'interface.api'],
  ['rotas sem api', (m) => { delete m.interface.api }, 'interface.api'],
  ['rota sem ancora final', (m) => { m.interface.rotas[0].padrao = '^/v1/itens' }, 'interface.rotas[0].padrao'],
  ['rota fora do v1', (m) => { m.interface.rotas[0].padrao = '^/v2/itens$' }, 'interface.rotas[0].padrao'],
  ['rota que nao compila', (m) => { m.interface.rotas[1].padrao = '^/v1/(itens$' }, 'interface.rotas[1].padrao'],
  ['metodo desconhecido', (m) => { m.interface.rotas[0].metodo = 'HEAD' }, 'interface.rotas[0].metodo'],
  ['escopo desconhecido', (m) => { m.interface.rotas[1].escopo = 'todos' }, 'interface.rotas[1].escopo'],
  ['tarefas ausente', (m) => { delete m.tarefas }, 'tarefas'],
  ['tarefa sem id', (m) => { delete m.tarefas[0].id }, 'tarefas[0].id'],
  ['tarefa com id fora do formato', (m) => { m.tarefas[0].id = 'Visita' }, 'tarefas[0].id'],
  ['tarefa com id repetido', (m) => { m.tarefas[1].id = 'visita' }, 'tarefas[1].id'],
  ['tarefa com diaria e acada', (m) => { m.tarefas[0].quando = { diaria: '07:00', acada: 'PT1H' } }, 'tarefas[0].quando'],
  ['tarefa sem quando', (m) => { delete m.tarefas[1].quando }, 'tarefas[1].quando'],
  ['hora fora do relogio', (m) => { m.tarefas[0].quando = { diaria: '24:00' } }, 'tarefas[0].quando'],
  ['intervalo zero', (m) => { m.tarefas[1].quando = { acada: 'PT0M' } }, 'tarefas[1].quando'],
  ['intervalo em segundos', (m) => { m.tarefas[1].quando = { acada: 'PT30S' } }, 'tarefas[1].quando'],
  ['seAtrasada que nao e booleano', (m) => { m.tarefas[0].seAtrasada = 'sim' }, 'tarefas[0].seAtrasada'],
  ['tarefa com comando e lancador', (m) => { m.tarefas[0].comando = 'node x.mjs' }, 'tarefas[0]'],
  ['tarefa sem comando nem lancador', (m) => { delete m.tarefas[1].comando }, 'tarefas[1]'],
  ['lancador que nao e o omni', (m) => { m.tarefas[0].lancador = 'outro' }, 'tarefas[0].lancador'],
  ['roteiro absoluto', (m) => { m.tarefas[0].roteiro = 'C:/roteiros/visita.md' }, 'tarefas[0].roteiro'],
  ['variavel minuscula', (m) => { m.tarefas[0].variaveis = ['hoje'] }, 'tarefas[0].variaveis'],
  ['variavel repetida', (m) => { m.tarefas[0].variaveis = ['HOJE', 'HOJE'] }, 'tarefas[0].variaveis'],
  ['credenciais ausente', (m) => { delete m.credenciais }, 'credenciais'],
  ['credencial fora do formato', (m) => { m.credenciais = ['-exemplo'] }, 'credenciais'],
  ['credencial repetida', (m) => { m.credenciais = ['a', 'a'] }, 'credenciais']
]

for (const [caso, mexer, campo] of RECUSAS) {
  test(`manifesto recusado: ${caso}`, () => {
    const m = completo()
    mexer(m)
    const erros = recusa(bytes(m))
    assert.equal(erros.length, 1, erros.join(' | '))
    assert.ok(erros[0].startsWith(`${campo}:`), erros[0])
  })
}

test('manifesto que nao e objeto JSON e recusado sem ecoar o conteudo', () => {
  for (const texto of ['{"agente":', '[]', 'null', '"exemplo"']) {
    assert.deepEqual(recusa(texto), ['manifesto: precisa ser um objeto JSON'], texto)
  }
  const m = completo()
  m.agente = 'VALOR-QUE-NAO-VOLTA'
  m.executor.comando = 42
  const erros = recusa(bytes(m))
  assert.deepEqual(erros.map((e) => e.split(':')[0]), ['agente', 'executor.comando'])
  assert.ok(!erros.join(' ').includes('VALOR-QUE-NAO-VOLTA'))
})

test('lerManifesto le executor/agente.json da raiz absoluta e recusa o que nao serve', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'omni-raiz-agente-'))
  try {
    assert.throws(() => lerManifesto(raiz), (falha) => falha instanceof NucleoError && falha.code === 'sem-manifesto')
    mkdirSync(join(raiz, 'executor'))
    writeFileSync(join(raiz, 'executor', 'agente.json'), bytes(completo()))
    assert.deepEqual(lerManifesto(raiz), bytes(completo()))
    assert.throws(() => lerManifesto('relativa/exemplo'), (falha) => falha instanceof NucleoError && falha.code === 'dados-invalidos')
    writeFileSync(join(raiz, 'executor', 'agente.json'), Buffer.alloc(LIMITE_MANIFESTO + 1, 0x20))
    assert.throws(() => lerManifesto(raiz), (falha) => falha instanceof NucleoError && falha.code === 'manifesto-grande')
  } finally {
    apagar(raiz)
  }
})

test('registrar e idempotente: o mesmo manifesto na mesma raiz nao sobe versao nem gera diario', () => {
  comNucleo((db) => {
    const primeiro = registrarAgente(db, bytes(completo()), { ...OPCOES, raiz: RAIZ })
    assert.deepEqual(primeiro, { agente: 'exemplo', versao: '0.3.0', maquina: 'pc', mudou: { agente: true, instalacao: true } })
    const antes = diario(db)
    assert.deepEqual(antes, ['maquinas:pc:I:1', 'agentes:exemplo:I:1', 'instalacoes:pc/exemplo:I:1'])

    const segundo = registrarAgente(db, bytes(completo()), { ...OPCOES, raiz: RAIZ, agora: 't1' })
    assert.deepEqual(segundo.mudou, { agente: false, instalacao: false })
    assert.deepEqual(diario(db), antes)
    assert.equal(db.prepare('SELECT visto_em FROM maquinas WHERE id = ?').get('pc').visto_em, 't1')

    const catalogo = db.prepare('SELECT * FROM agentes WHERE id = ?').get('exemplo')
    assert.equal(catalogo.banco, 'exemplo.db')
    assert.equal(catalogo.manifesto, JSON.stringify(completo()))
    assert.equal(catalogo.manifesto_sha256, sha256(bytes(completo())))
    assert.equal(catalogo.origem_maquina, 'pc')
  })
})

test('manifesto novo sobe a versao do catalogo e da instalacao; raiz nova sobe so a instalacao', () => {
  comNucleo((db) => {
    registrarAgente(db, bytes(completo()), { ...OPCOES, raiz: RAIZ })
    const novo = completo()
    novo.versao = '0.3.1'
    assert.deepEqual(registrarAgente(db, bytes(novo), { ...OPCOES, raiz: RAIZ, agora: 't1' }).mudou, { agente: true, instalacao: true })
    const outraRaiz = resolve(tmpdir(), 'agentes-exemplo', 'movido')
    assert.deepEqual(registrarAgente(db, bytes(novo), { ...OPCOES, raiz: outraRaiz, agora: 't2' }).mudou, { agente: false, instalacao: true })
    assert.equal(db.prepare('SELECT atualizado_em FROM agentes WHERE id = ?').get('exemplo').atualizado_em, 't1')
    // Mesmo semver, manifesto diferente: o sha muda e as duas linhas sobem.
    novo.credenciais = ['exemplo/api', 'exemplo/outra']
    assert.deepEqual(registrarAgente(db, bytes(novo), { ...OPCOES, raiz: outraRaiz, agora: 't3' }).mudou, { agente: true, instalacao: true })
    assert.deepEqual(diario(db).slice(3), [
      'agentes:exemplo:U:2', 'instalacoes:pc/exemplo:U:2', 'instalacoes:pc/exemplo:U:3', 'agentes:exemplo:U:3', 'instalacoes:pc/exemplo:U:4'
    ])
    const [instalado] = listarInstalados(db, { maquina: 'pc' })
    assert.equal(instalado.raiz, outraRaiz)
    assert.equal(instalado.versao, '0.3.1')
    assert.equal(instalado.catalogoDiverge, false)
  })
})

test('cada maquina tem a propria instalacao; o catalogo e de todas e o ultimo registrado vence', () => {
  comNucleo((db) => {
    registrarAgente(db, bytes(completo()), { ...OPCOES, raiz: RAIZ })
    const novo = completo()
    novo.versao = '0.4.0'
    const notebook = { maquina: 'notebook', nome: 'Notebook', sistema: 'linux', agora: 't1', raiz: '/opt/agentes/exemplo' }
    assert.equal(registrarAgente(db, bytes(novo), notebook).maquina, 'notebook')
    registrarAgente(db, bytes(minimo()), notebook)

    assert.deepEqual(listarInstalados(db, { maquina: 'pc' }), [
      { agente: 'exemplo', raiz: RAIZ, versao: '0.3.0', banco: 'exemplo.db', versaoNoCatalogo: '0.4.0', catalogoDiverge: true, atualizado_em: 't0' }
    ])
    assert.deepEqual(listarInstalados(db, { maquina: 'notebook' }).map((i) => [i.agente, i.versao, i.catalogoDiverge]), [
      ['exemplo', '0.4.0', false],
      ['segundo', '0.1.0', false]
    ])
    assert.deepEqual(listarMaquinas(db), [
      { id: 'notebook', nome: 'Notebook', sistema: 'linux', visto_em: 't1', agentes: 2 },
      { id: 'pc', nome: 'PC', sistema: 'win32', visto_em: 't0', agentes: 1 }
    ])
  })
})

test('retirar poe lapide so na instalacao desta maquina; reinstalar revive a linha', () => {
  comNucleo((db) => {
    registrarAgente(db, bytes(completo()), { ...OPCOES, raiz: RAIZ })
    registrarAgente(db, bytes(completo()), { maquina: 'notebook', nome: 'Notebook', sistema: 'linux', agora: 't0', raiz: '/opt/agentes/exemplo' })
    assert.deepEqual(retirarAgente(db, 'exemplo', { maquina: 'pc', agora: 't1' }), { agente: 'exemplo', maquina: 'pc', retirado: true })
    assert.deepEqual(listarInstalados(db, { maquina: 'pc' }), [])
    assert.equal(listarInstalados(db, { maquina: 'notebook' }).length, 1)
    assert.equal(listarMaquinas(db).find((m) => m.id === 'pc').agentes, 0)
    const lapide = db.prepare('SELECT apagado_em, versao FROM instalacoes WHERE id = ?').get('pc/exemplo')
    assert.deepEqual({ ...lapide }, { apagado_em: 't1', versao: 2 })
    assert.equal(db.prepare('SELECT apagado_em FROM agentes WHERE id = ?').get('exemplo').apagado_em, null)

    assert.throws(() => retirarAgente(db, 'exemplo', { maquina: 'pc', agora: 't2' }), (falha) => falha instanceof NucleoError && falha.code === 'inexistente')
    assert.throws(() => retirarAgente(db, 'nunca-houve', { maquina: 'pc' }), (falha) => falha instanceof NucleoError && falha.code === 'inexistente')
    assert.throws(() => retirarAgente(db, 'Errado', { maquina: 'pc' }), (falha) => falha instanceof NucleoError && falha.code === 'dados-invalidos')

    assert.deepEqual(registrarAgente(db, bytes(completo()), { ...OPCOES, raiz: RAIZ, agora: 't3' }).mudou, { agente: false, instalacao: true })
    const revivida = db.prepare('SELECT apagado_em, versao FROM instalacoes WHERE id = ?').get('pc/exemplo')
    assert.deepEqual({ ...revivida }, { apagado_em: null, versao: 3 })
  })
})

test('lapide no catalogo vinda de outra maquina e revivida quando alguem registra de novo', () => {
  comNucleo((db) => {
    registrarAgente(db, bytes(completo()), { ...OPCOES, raiz: RAIZ })
    db.prepare("UPDATE agentes SET apagado_em = 't1', versao = versao + 1 WHERE id = 'exemplo'").run()
    assert.equal(listarInstalados(db, { maquina: 'pc' })[0].versaoNoCatalogo, null)
    assert.deepEqual(registrarAgente(db, bytes(completo()), { ...OPCOES, raiz: RAIZ, agora: 't2' }).mudou, { agente: true, instalacao: false })
    const catalogo = db.prepare('SELECT apagado_em, versao FROM agentes WHERE id = ?').get('exemplo')
    assert.deepEqual({ ...catalogo }, { apagado_em: null, versao: 3 })
    assert.equal(listarInstalados(db, { maquina: 'pc' })[0].versaoNoCatalogo, '0.3.0')
  })
})

test('registrar recusa raiz relativa e manifesto invalido sem gravar nada', () => {
  comNucleo((db) => {
    assert.throws(() => registrarAgente(db, bytes(completo()), { ...OPCOES, raiz: 'agentes/exemplo' }), (falha) => falha instanceof NucleoError && falha.code === 'dados-invalidos')
    const m = completo()
    m.versao = 'x'
    assert.throws(() => registrarAgente(db, bytes(m), { ...OPCOES, raiz: RAIZ }), (falha) => falha instanceof NucleoError && falha.code === 'manifesto-invalido')
    assert.deepEqual(diario(db), [])
  })
})

test('registrarMaquina so sobe a versao quando nome ou sistema mudam', () => {
  comNucleo((db) => {
    assert.deepEqual(registrarMaquina(db, OPCOES), { maquina: 'pc', mudou: true })
    assert.deepEqual(registrarMaquina(db, { ...OPCOES, agora: 't1' }), { maquina: 'pc', mudou: false })
    assert.deepEqual(registrarMaquina(db, { ...OPCOES, sistema: 'linux', agora: 't2' }), { maquina: 'pc', mudou: true })
    assert.deepEqual(registrarMaquina(db, { ...OPCOES, sistema: 'linux', nome: 'PC-NOVO', agora: 't3' }), { maquina: 'pc', mudou: true })
    assert.deepEqual(diario(db), ['maquinas:pc:I:1', 'maquinas:pc:U:2', 'maquinas:pc:U:3'])
    assert.deepEqual(listarMaquinas(db), [{ id: 'pc', nome: 'PC-NOVO', sistema: 'linux', visto_em: 't3', agentes: 0 }])
    assert.throws(() => registrarMaquina(db, { ...OPCOES, maquina: 'PC' }), (falha) => falha instanceof NucleoError && falha.code === 'dados-invalidos')
  })
})
```

- [x] **Passo 2: extrair o teste e ver o vermelho.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-07-f1-plano-6-nucleo.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so testes/casa-loja-nucleo.test.mjs
node --test --test-concurrency=1 --test-reporter=spec testes/casa-loja-nucleo.test.mjs *> "$rascunho\p6-t2-vermelho.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\p6-t2-vermelho.txt" -Pattern 'Cannot find module', '(tests|pass|fail) \d+\s*$'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `gravado testes/casa-loja-nucleo.test.mjs`, `saida: 1`, o `ERR_MODULE_NOT_FOUND` de `runtime/casa/loja-nucleo.mjs`, `tests 1`, `pass 0`, `fail 1` e `False`.

Resultado (07/11), visto numa cópia do HEAD com o esquema novo (executor, item 13): `saida: 1`, `ERR_MODULE_NOT_FOUND` (`Cannot find module` da `loja-nucleo.mjs`), `tests 1`, `pass 0`, `fail 1` e `False`.

- [x] **Passo 3: o módulo.** A loja inteira (decisões 2 a 12).

```js arquivo=runtime/casa/loja-nucleo.mjs
// Loja do núcleo (§4.2): o catálogo de agentes, as instalações e as máquinas no nucleo.db.
// O manifesto de cada agente é o executor/agente.json do repo dele; aqui ele é validado (campo a mais
// é tolerado, campo errado é recusado com a lista dos problemas, sem ecoar o valor) e registrado.
// O catálogo é de todas as máquinas (o último registrado vence); a instalação é por máquina e cada
// máquina grava só as próprias linhas. Registrar o mesmo manifesto na mesma raiz não sobe versão.
import { readFileSync, statSync } from 'node:fs'
import { hostname, platform } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

import { agoraIso, maquinaAtual, sha256, transacao } from './banco.mjs'

export const MODOS = Object.freeze(['instalar', 'importar', 'exportar', 'atualizar', 'verificar', 'servir'])
export const LIMITE_MANIFESTO = 256 * 1024
export const ARQUIVO_MANIFESTO = join('executor', 'agente.json')

const AGENTE = /^[a-z][a-z0-9-]{0,39}$/
const RESERVADOS = new Set(['dono', 'nucleo', 'cofre', 'casa'])
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/
const VERSAO_MINIMA = '\\d+(\\.\\d+){0,2}'
const NODE = new RegExp(`^>=${VERSAO_MINIMA}$`)
const REQUER_AGENTE = new RegExp(`^([a-z][a-z0-9-]{0,39})>=${VERSAO_MINIMA}$`)
const VARIAVEL = /^[A-Z][A-Z0-9_]*$/
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/
const INTERVALO = /^PT[1-9]\d*[MH]$/
const NOME_CREDENCIAL = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/
const METODOS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE'])
const ESCOPOS = new Set(['qualquer', 'tela', 'visita'])
const API = 'http://127.0.0.1:{porta}/v1'
const LIMITE_TEXTO = 500
const LIMITE_PAINEL = 40

export class NucleoError extends Error {
  constructor(codigo, mensagem, erros = []) {
    super(mensagem)
    this.name = 'NucleoError'
    this.code = codigo
    this.erros = erros
  }
}

const objeto = (valor) => valor !== null && typeof valor === 'object' && !Array.isArray(valor)
const texto = (valor, max = LIMITE_TEXTO) => typeof valor === 'string' && valor.length > 0 && valor.length <= max
const unicos = (lista) => new Set(lista).size === lista.length

// Caminho dentro do repo do agente: relativo, com barra normal, sem subir e sem unidade.
function relativo(valor) {
  return texto(valor, 260) && !valor.includes('\\') && !valor.startsWith('/') && !/^[A-Za-z]:/.test(valor) &&
    !valor.split('/').includes('..')
}

function compila(padrao) {
  try {
    new RegExp(padrao)
    return true
  } catch {
    return false
  }
}

function listaDe(valor, formato) {
  return Array.isArray(valor) && valor.every((item) => typeof item === 'string' && formato.test(item)) && unicos(valor)
}

function conferirInterface(i, erros) {
  if (!objeto(i)) { erros.push('interface: precisa ser um objeto'); return }
  if (!relativo(i.modulo) || !i.modulo.endsWith('.html')) erros.push('interface.modulo: caminho relativo de um .html')
  if (i.preload !== undefined && (!relativo(i.preload) || !i.preload.endsWith('.js'))) erros.push('interface.preload: caminho relativo de um .js')
  if (i.painel !== undefined && !texto(i.painel, LIMITE_PAINEL)) erros.push(`interface.painel: texto de 1 a ${LIMITE_PAINEL} caracteres`)
  if (i.api !== undefined && i.api !== API) erros.push(`interface.api: precisa ser ${API}`)
  if (i.rotas === undefined) return
  if (!Array.isArray(i.rotas)) { erros.push('interface.rotas: precisa ser uma lista'); return }
  if (i.api === undefined) erros.push('interface.api: obrigatoria quando ha rotas')
  i.rotas.forEach((rota, n) => {
    const onde = `interface.rotas[${n}]`
    if (!objeto(rota)) { erros.push(`${onde}: precisa ser um objeto`); return }
    if (!METODOS.has(rota.metodo)) erros.push(`${onde}.metodo: GET, POST, PATCH, PUT ou DELETE`)
    const padrao = rota.padrao
    if (!texto(padrao) || !padrao.startsWith('^/v1/') || !padrao.endsWith('$') || !compila(padrao)) {
      erros.push(`${onde}.padrao: expressao que compila, de ^/v1/ ate $`)
    }
    if (!ESCOPOS.has(rota.escopo)) erros.push(`${onde}.escopo: qualquer, tela ou visita`)
  })
}

function conferirTarefa(tarefa, n, ids, erros) {
  const onde = `tarefas[${n}]`
  if (!objeto(tarefa)) { erros.push(`${onde}: precisa ser um objeto`); return }
  if (typeof tarefa.id !== 'string' || !AGENTE.test(tarefa.id)) erros.push(`${onde}.id: minusculas, digitos e hifen, comecando por letra`)
  else if (ids.has(tarefa.id)) erros.push(`${onde}.id: repetido`)
  else ids.add(tarefa.id)
  const quando = tarefa.quando
  const diaria = objeto(quando) && quando.diaria !== undefined
  const acada = objeto(quando) && quando.acada !== undefined
  if (diaria === acada || (diaria && !HORA.test(String(quando.diaria))) || (acada && !INTERVALO.test(String(quando.acada)))) {
    erros.push(`${onde}.quando: exatamente um entre diaria (HH:MM) e acada (PT<n>M ou PT<n>H)`)
  }
  if (typeof tarefa.seAtrasada !== 'boolean') erros.push(`${onde}.seAtrasada: precisa ser booleano`)
  const temComando = tarefa.comando !== undefined
  const temLancador = tarefa.lancador !== undefined
  if (temComando === temLancador) { erros.push(`${onde}: exatamente um entre comando e lancador`); return }
  if (temComando) {
    if (!texto(tarefa.comando)) erros.push(`${onde}.comando: texto nao vazio`)
    return
  }
  if (tarefa.lancador !== 'omni') erros.push(`${onde}.lancador: so o omni lanca roteiro`)
  if (!relativo(tarefa.roteiro)) erros.push(`${onde}.roteiro: caminho relativo`)
  if (tarefa.variaveis !== undefined && !listaDe(tarefa.variaveis, VARIAVEL)) erros.push(`${onde}.variaveis: nomes em MAIUSCULAS, sem repetir`)
}

function conferir(m) {
  const erros = []
  const agenteValido = typeof m.agente === 'string' && AGENTE.test(m.agente) && !RESERVADOS.has(m.agente)
  if (!agenteValido) erros.push('agente: minusculas, digitos e hifen, comecando por letra, ate 40, fora dos nomes reservados')
  if (typeof m.versao !== 'string' || !SEMVER.test(m.versao)) erros.push('versao: precisa ser semver')
  if (m.banco === undefined) erros.push('banco: obrigatorio (null quando o agente nao tem banco)')
  else if (m.banco !== null && agenteValido && m.banco !== `${m.agente}.db`) erros.push('banco: precisa ser <agente>.db')
  if (m.banco === null && m.migracoes !== undefined) erros.push('migracoes: so existe quando ha banco')
  if (typeof m.banco === 'string' && !relativo(m.migracoes)) erros.push('migracoes: caminho relativo, obrigatorio quando ha banco')

  if (!objeto(m.requer)) erros.push('requer: precisa ser um objeto')
  else {
    if (m.requer.node !== undefined && (typeof m.requer.node !== 'string' || !NODE.test(m.requer.node))) erros.push('requer.node: no formato >=N[.N[.N]]')
    const agentes = m.requer.agentes
    if (agentes !== undefined && (!listaDe(agentes, REQUER_AGENTE) || !unicos(agentes.map((a) => REQUER_AGENTE.exec(a)[1])))) {
      erros.push('requer.agentes: lista de <agente>>=N[.N[.N]], um por agente')
    }
  }

  if (m.executor !== undefined) {
    if (!objeto(m.executor)) erros.push('executor: precisa ser um objeto')
    else {
      if (!texto(m.executor.comando)) erros.push('executor.comando: texto nao vazio')
      const modos = m.executor.modos
      if (!Array.isArray(modos) || modos.length === 0 || !modos.every((modo) => MODOS.includes(modo)) || !unicos(modos)) {
        erros.push(`executor.modos: lista sem repetir dentre ${MODOS.join(', ')}`)
      }
    }
  }
  if (m.interface !== undefined) conferirInterface(m.interface, erros)

  if (!Array.isArray(m.tarefas)) erros.push('tarefas: precisa ser uma lista')
  else {
    const ids = new Set()
    m.tarefas.forEach((tarefa, n) => conferirTarefa(tarefa, n, ids, erros))
  }
  if (!listaDe(m.credenciais, NOME_CREDENCIAL)) erros.push('credenciais: lista de nomes do cofre, sem repetir')
  return erros
}

// Recebe os bytes do agente.json (ou o texto). O sha é dos bytes crus; o texto gravado é o objeto lido.
export function validarManifesto(conteudo) {
  const crus = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(String(conteudo), 'utf8')
  let manifesto
  try {
    manifesto = JSON.parse(crus.toString('utf8').replace(/^\uFEFF/, ''))
  } catch {
    manifesto = undefined
  }
  const erros = objeto(manifesto) ? conferir(manifesto) : ['manifesto: precisa ser um objeto JSON']
  if (erros.length > 0) throw new NucleoError('manifesto-invalido', `Manifesto recusado: ${erros.length} problema(s).`, erros)
  return { manifesto, sha256: sha256(crus), texto: JSON.stringify(manifesto) }
}

export function lerManifesto(raiz) {
  if (typeof raiz !== 'string' || !isAbsolute(raiz)) throw new NucleoError('dados-invalidos', 'A raiz do agente precisa ser um caminho absoluto.')
  const arquivo = join(raiz, ARQUIVO_MANIFESTO)
  let tamanho
  try {
    tamanho = statSync(arquivo).size
  } catch {
    throw new NucleoError('sem-manifesto', `Não há ${ARQUIVO_MANIFESTO} na raiz informada.`)
  }
  if (tamanho > LIMITE_MANIFESTO) throw new NucleoError('manifesto-grande', `O manifesto passa de ${LIMITE_MANIFESTO} bytes.`)
  return readFileSync(arquivo)
}

function conferirMaquina(maquina) {
  if (typeof maquina !== 'string' || maquina.length === 0 || maquina.length > 253 || maquina !== maquina.toLowerCase() || maquina.includes('/')) {
    throw new NucleoError('dados-invalidos', 'Nome de máquina inválido.')
  }
}

// Sem transação própria: roda dentro da de quem chama.
function tocarMaquina(db, { maquina, nome, sistema, agora }) {
  const atual = db.prepare('SELECT nome, sistema, apagado_em FROM maquinas WHERE id = ?').get(maquina)
  if (!atual) {
    db.prepare(`INSERT INTO maquinas (id, nome, sistema, visto_em, origem_maquina, criado_em, atualizado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(maquina, nome, sistema, agora, maquina, agora, agora)
    return true
  }
  if (atual.nome !== nome || atual.sistema !== sistema || atual.apagado_em !== null) {
    db.prepare(`UPDATE maquinas SET nome = ?, sistema = ?, visto_em = ?, origem_maquina = ?, atualizado_em = ?, apagado_em = NULL,
      versao = versao + 1 WHERE id = ?`).run(nome, sistema, agora, maquina, agora, maquina)
    return true
  }
  db.prepare('UPDATE maquinas SET visto_em = ? WHERE id = ?').run(agora, maquina)
  return false
}

const daMaquina = ({ maquina = maquinaAtual(), nome = hostname(), sistema = platform(), agora = agoraIso() } = {}) =>
  ({ maquina, nome, sistema, agora })

export function registrarMaquina(db, opcoes = {}) {
  const m = daMaquina(opcoes)
  conferirMaquina(m.maquina)
  return { maquina: m.maquina, mudou: transacao(db, () => tocarMaquina(db, m)) }
}

export function registrarAgente(db, conteudo, opcoes = {}) {
  const m = daMaquina(opcoes)
  conferirMaquina(m.maquina)
  if (typeof opcoes.raiz !== 'string' || !isAbsolute(opcoes.raiz)) throw new NucleoError('dados-invalidos', 'A raiz do agente precisa ser um caminho absoluto.')
  const raiz = resolve(opcoes.raiz)
  const { manifesto, sha256: sha, texto: json } = validarManifesto(conteudo)
  const { agente, versao } = manifesto
  const { maquina, agora } = m
  const mudou = transacao(db, () => {
    tocarMaquina(db, m)
    let catalogo = false
    const noCatalogo = db.prepare('SELECT manifesto_sha256, apagado_em FROM agentes WHERE id = ?').get(agente)
    if (!noCatalogo) {
      db.prepare(`INSERT INTO agentes (id, versao_agente, banco, manifesto, manifesto_sha256, origem_maquina, criado_em, atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(agente, versao, manifesto.banco, json, sha, maquina, agora, agora)
      catalogo = true
    } else if (noCatalogo.manifesto_sha256 !== sha || noCatalogo.apagado_em !== null) {
      db.prepare(`UPDATE agentes SET versao_agente = ?, banco = ?, manifesto = ?, manifesto_sha256 = ?, origem_maquina = ?, atualizado_em = ?,
        apagado_em = NULL, versao = versao + 1 WHERE id = ?`).run(versao, manifesto.banco, json, sha, maquina, agora, agente)
      catalogo = true
    }
    let instalacao = false
    const id = `${maquina}/${agente}`
    // O sha dos bytes já muda com a versão: comparar a versão à parte seria redundante.
    const instalada = db.prepare('SELECT raiz, manifesto_sha256, apagado_em FROM instalacoes WHERE id = ?').get(id)
    if (!instalada) {
      db.prepare(`INSERT INTO instalacoes (id, maquina, agente, raiz, versao_agente, manifesto_sha256, origem_maquina, criado_em, atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, maquina, agente, raiz, versao, sha, maquina, agora, agora)
      instalacao = true
    } else if (instalada.raiz !== raiz || instalada.manifesto_sha256 !== sha || instalada.apagado_em !== null) {
      db.prepare(`UPDATE instalacoes SET raiz = ?, versao_agente = ?, manifesto_sha256 = ?, origem_maquina = ?, atualizado_em = ?,
        apagado_em = NULL, versao = versao + 1 WHERE id = ?`).run(raiz, versao, sha, maquina, agora, id)
      instalacao = true
    }
    return { agente: catalogo, instalacao }
  })
  return { agente, versao, maquina, mudou }
}

export function retirarAgente(db, agente, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  if (typeof agente !== 'string' || !AGENTE.test(agente)) throw new NucleoError('dados-invalidos', 'Nome de agente inválido.')
  conferirMaquina(maquina)
  const id = `${maquina}/${agente}`
  transacao(db, () => {
    const r = db.prepare(`UPDATE instalacoes SET apagado_em = ?, origem_maquina = ?, atualizado_em = ?, versao = versao + 1
      WHERE id = ? AND apagado_em IS NULL`).run(agora, maquina, agora, id)
    if (r.changes !== 1) throw new NucleoError('inexistente', 'O agente não está instalado nesta máquina.')
  })
  return { agente, maquina, retirado: true }
}

export function listarInstalados(db, { maquina = maquinaAtual() } = {}) {
  return db.prepare(`SELECT i.agente, i.raiz, i.versao_agente, i.manifesto_sha256, i.atualizado_em,
      a.banco, a.versao_agente AS versao_catalogo, a.manifesto_sha256 AS sha_catalogo
    FROM instalacoes i LEFT JOIN agentes a ON a.id = i.agente AND a.apagado_em IS NULL
    WHERE i.maquina = ? AND i.apagado_em IS NULL ORDER BY i.agente`).all(maquina).map((l) => ({
    agente: l.agente,
    raiz: l.raiz,
    versao: l.versao_agente,
    banco: l.banco ?? null,
    versaoNoCatalogo: l.versao_catalogo ?? null,
    catalogoDiverge: l.sha_catalogo !== l.manifesto_sha256,
    atualizado_em: l.atualizado_em
  }))
}

export function listarMaquinas(db) {
  return db.prepare(`SELECT m.id, m.nome, m.sistema, m.visto_em,
      (SELECT count(*) FROM instalacoes i WHERE i.maquina = m.id AND i.apagado_em IS NULL) AS agentes
    FROM maquinas m WHERE m.apagado_em IS NULL ORDER BY m.id`).all().map((l) => ({ ...l }))
}
```

- [x] **Passo 4: extrair o módulo e ver o verde.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-07-f1-plano-6-nucleo.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so runtime/casa/loja-nucleo.mjs
node --check runtime/casa/loja-nucleo.mjs; "check: $LASTEXITCODE"
node --test --test-concurrency=1 --test-reporter=spec testes/casa-loja-nucleo.test.mjs *> "$rascunho\p6-t2-verde.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\p6-t2-verde.txt" -Pattern '(tests|pass|fail) \d+\s*$'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `gravado runtime/casa/loja-nucleo.mjs`, `check: 0`, `tests 60`, `pass 60`, `fail 0`, `saida: 0` e `False`.

Resultado (07/11): `tests 60`, `pass 60`, `fail 0`, `saida: 0` e `False`.

**Mutação.** Sessenta e três mutantes, todos na loja: os 45 primeiros no manifesto e os 18 últimos na leitura, no registro e na listagem. Cada um tem o trecho exato (uma vez só no arquivo), a troca e as suítes que devem matá-lo. O executor aplica um por vez, roda as suítes do mutante pelo `run()` do `node:test`, restaura sempre e anota cada teste que caiu. A tabela derruba a rodada se um mutante sobreviver sem estar declarado equivalente, se uma queda não for `AssertionError` com `ERR_ASSERTION` ou se vier de suíte fora das do mutante: mutante que morre no setup não prova nada. Não há mapa previsto: a tabela do Apêndice B, gerada da rodada, é o registro de onde cada um caiu.

```json rascunho=mutantes-p6-t2.json
[
  {"nome":"01 nome reservado aceito","arquivo":"runtime/casa/loja-nucleo.mjs","de":" && !RESERVADOS.has(m.agente)","para":"","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"02 versao fora do semver aceita","arquivo":"runtime/casa/loja-nucleo.mjs","de":"!SEMVER.test(m.versao)","para":"m.versao.length === 0","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"03 banco de outro agente aceito","arquivo":"runtime/casa/loja-nucleo.mjs","de":"m.banco !== `${m.agente}.db`","para":"false","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"04 banco conferido com agente invalido","arquivo":"runtime/casa/loja-nucleo.mjs","de":"m.banco !== null && agenteValido && ","para":"m.banco !== null && ","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"05 migracoes sem banco aceitas","arquivo":"runtime/casa/loja-nucleo.mjs","de":"m.banco === null && m.migracoes !== undefined","para":"m.banco === null && false","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"06 banco sem migracoes aceito","arquivo":"runtime/casa/loja-nucleo.mjs","de":"typeof m.banco === 'string' && !relativo(m.migracoes)","para":"typeof m.banco === 'string' && m.migracoes === 0","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"07 caminho com barra invertida aceito","arquivo":"runtime/casa/loja-nucleo.mjs","de":"!valor.includes('\\\\') && ","para":"","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"08 caminho absoluto aceito","arquivo":"runtime/casa/loja-nucleo.mjs","de":"!valor.startsWith('/') && ","para":"","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"09 caminho com unidade aceito","arquivo":"runtime/casa/loja-nucleo.mjs","de":"!/^[A-Za-z]:/.test(valor) &&","para":"true &&","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"10 caminho que sobe aceito","arquivo":"runtime/casa/loja-nucleo.mjs","de":"!valor.split('/').includes('..')","para":"true","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"11 requer.node livre","arquivo":"runtime/casa/loja-nucleo.mjs","de":"!NODE.test(m.requer.node)","para":"false","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"12 agente requerido sem versao","arquivo":"runtime/casa/loja-nucleo.mjs","de":"`^([a-z][a-z0-9-]{0,39})>=${VERSAO_MINIMA}$`","para":"`^([a-z][a-z0-9-]{0,39})(>=${VERSAO_MINIMA})?$`","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"13 agente requerido repetido","arquivo":"runtime/casa/loja-nucleo.mjs","de":" || !unicos(agentes.map((a) => REQUER_AGENTE.exec(a)[1]))","para":"","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"14 comando vazio aceito","arquivo":"runtime/casa/loja-nucleo.mjs","de":"if (!texto(m.executor.comando))","para":"if (typeof m.executor.comando !== 'string')","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"15 modos vazio aceito","arquivo":"runtime/casa/loja-nucleo.mjs","de":"modos.length === 0 || ","para":"","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"16 modo desconhecido aceito","arquivo":"runtime/casa/loja-nucleo.mjs","de":"!modos.every((modo) => MODOS.includes(modo)) || ","para":"","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"17 modo repetido aceito","arquivo":"runtime/casa/loja-nucleo.mjs","de":" || !unicos(modos))","para":")","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"18 modulo que nao e html","arquivo":"runtime/casa/loja-nucleo.mjs","de":" || !i.modulo.endsWith('.html')","para":"","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"19 preload que nao e js","arquivo":"runtime/casa/loja-nucleo.mjs","de":" || !i.preload.endsWith('.js')","para":"","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"20 painel sem limite","arquivo":"runtime/casa/loja-nucleo.mjs","de":"!texto(i.painel, LIMITE_PAINEL)","para":"!texto(i.painel)","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"21 api em qualquer host","arquivo":"runtime/casa/loja-nucleo.mjs","de":"i.api !== API","para":"!i.api.startsWith('http://')","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"22 rotas sem api","arquivo":"runtime/casa/loja-nucleo.mjs","de":"if (i.api === undefined) erros.push","para":"if (false) erros.push","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"23 rota sem ancora final","arquivo":"runtime/casa/loja-nucleo.mjs","de":" || !padrao.endsWith('$')","para":"","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"24 rota fora do v1","arquivo":"runtime/casa/loja-nucleo.mjs","de":"!padrao.startsWith('^/v1/')","para":"!padrao.startsWith('^/')","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"25 rota que nao compila","arquivo":"runtime/casa/loja-nucleo.mjs","de":" || !compila(padrao)","para":"","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"26 metodo livre","arquivo":"runtime/casa/loja-nucleo.mjs","de":"!METODOS.has(rota.metodo)","para":"typeof rota.metodo !== 'string'","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"27 escopo livre","arquivo":"runtime/casa/loja-nucleo.mjs","de":"!ESCOPOS.has(rota.escopo)","para":"typeof rota.escopo !== 'string'","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"28 id de tarefa fora do formato","arquivo":"runtime/casa/loja-nucleo.mjs","de":"!AGENTE.test(tarefa.id)","para":"tarefa.id.length === 0","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"29 id de tarefa repetido","arquivo":"runtime/casa/loja-nucleo.mjs","de":"else if (ids.has(tarefa.id))","para":"else if (false)","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"30 diaria e acada juntas","arquivo":"runtime/casa/loja-nucleo.mjs","de":"diaria === acada ||","para":"(!diaria && !acada) ||","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"31 hora fora do relogio","arquivo":"runtime/casa/loja-nucleo.mjs","de":"const HORA = /^([01]\\d|2[0-3]):[0-5]\\d$/","para":"const HORA = /^\\d\\d:\\d\\d$/","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"32 intervalo zero","arquivo":"runtime/casa/loja-nucleo.mjs","de":"const INTERVALO = /^PT[1-9]\\d*[MH]$/","para":"const INTERVALO = /^PT\\d+[MH]$/","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"33 intervalo em segundos","arquivo":"runtime/casa/loja-nucleo.mjs","de":"const INTERVALO = /^PT[1-9]\\d*[MH]$/","para":"const INTERVALO = /^PT[1-9]\\d*[MHS]$/","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"34 seAtrasada nao booleano","arquivo":"runtime/casa/loja-nucleo.mjs","de":"typeof tarefa.seAtrasada !== 'boolean'","para":"tarefa.seAtrasada === undefined","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"35 comando e lancador juntos","arquivo":"runtime/casa/loja-nucleo.mjs","de":"if (temComando === temLancador)","para":"if (!temComando && !temLancador)","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"36 nem comando nem lancador","arquivo":"runtime/casa/loja-nucleo.mjs","de":"if (temComando === temLancador)","para":"if (temComando && temLancador)","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"37 lancador de outro agente","arquivo":"runtime/casa/loja-nucleo.mjs","de":"if (tarefa.lancador !== 'omni')","para":"if (typeof tarefa.lancador !== 'string')","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"38 roteiro absoluto","arquivo":"runtime/casa/loja-nucleo.mjs","de":"if (!relativo(tarefa.roteiro))","para":"if (!texto(tarefa.roteiro))","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"39 variavel fora do formato","arquivo":"runtime/casa/loja-nucleo.mjs","de":"!listaDe(tarefa.variaveis, VARIAVEL)","para":"!Array.isArray(tarefa.variaveis)","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"40 lista com repeticao","arquivo":"runtime/casa/loja-nucleo.mjs","de":" && unicos(valor)","para":"","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"41 credencial fora do formato","arquivo":"runtime/casa/loja-nucleo.mjs","de":"!listaDe(m.credenciais, NOME_CREDENCIAL)","para":"!Array.isArray(m.credenciais)","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"42 manifesto que nao e objeto","arquivo":"runtime/casa/loja-nucleo.mjs","de":"objeto(manifesto) ? conferir(manifesto)","para":"manifesto ? conferir(manifesto)","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"43 BOM recusado","arquivo":"runtime/casa/loja-nucleo.mjs","de":".replace(/^\\uFEFF/, '')","para":"","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"44 sha do texto e nao dos bytes","arquivo":"runtime/casa/loja-nucleo.mjs","de":"sha256: sha256(crus)","para":"sha256: sha256(JSON.stringify(manifesto))","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"45 texto gravado cru","arquivo":"runtime/casa/loja-nucleo.mjs","de":"texto: JSON.stringify(manifesto) }","para":"texto: crus.toString('utf8') }","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"46 lerManifesto aceita raiz relativa","arquivo":"runtime/casa/loja-nucleo.mjs","de":"if (typeof raiz !== 'string' || !isAbsolute(raiz)) throw","para":"if (typeof raiz !== 'string') throw","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"47 manifesto sem limite de tamanho","arquivo":"runtime/casa/loja-nucleo.mjs","de":"if (tamanho > LIMITE_MANIFESTO)","para":"if (tamanho > LIMITE_MANIFESTO + 1)","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"48 registrar aceita raiz relativa","arquivo":"runtime/casa/loja-nucleo.mjs","de":"typeof opcoes.raiz !== 'string' || !isAbsolute(opcoes.raiz)","para":"typeof opcoes.raiz !== 'string'","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"49 maquina maiuscula aceita","arquivo":"runtime/casa/loja-nucleo.mjs","de":" || maquina !== maquina.toLowerCase()","para":"","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"50 catalogo sobe sempre","arquivo":"runtime/casa/loja-nucleo.mjs","de":"noCatalogo.manifesto_sha256 !== sha ||","para":"true ||","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"51 catalogo com lapide nao revive","arquivo":"runtime/casa/loja-nucleo.mjs","de":" || noCatalogo.apagado_em !== null","para":"","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"52 raiz nova ignorada","arquivo":"runtime/casa/loja-nucleo.mjs","de":"instalada.raiz !== raiz || ","para":"","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"53 manifesto novo ignorado na instalacao","arquivo":"runtime/casa/loja-nucleo.mjs","de":" || instalada.manifesto_sha256 !== sha","para":"","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"54 instalacao com lapide nao revive","arquivo":"runtime/casa/loja-nucleo.mjs","de":" || instalada.apagado_em !== null","para":"","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"55 nome da maquina ignorado","arquivo":"runtime/casa/loja-nucleo.mjs","de":"atual.nome !== nome || ","para":"","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"56 sistema da maquina ignorado","arquivo":"runtime/casa/loja-nucleo.mjs","de":" || atual.sistema !== sistema","para":"","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"57 visto_em parado","arquivo":"runtime/casa/loja-nucleo.mjs","de":"db.prepare('UPDATE maquinas SET visto_em = ? WHERE id = ?').run(agora, maquina)","para":"void 0","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"58 retirar duas vezes","arquivo":"runtime/casa/loja-nucleo.mjs","de":"WHERE id = ? AND apagado_em IS NULL`).run(agora","para":"WHERE id = ?`).run(agora","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"59 listar mostra lapide","arquivo":"runtime/casa/loja-nucleo.mjs","de":"WHERE i.maquina = ? AND i.apagado_em IS NULL","para":"WHERE i.maquina = ?","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"60 listar mistura maquinas","arquivo":"runtime/casa/loja-nucleo.mjs","de":"WHERE i.maquina = ? AND","para":"WHERE ? IS NOT NULL AND","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"61 catalogo nunca diverge","arquivo":"runtime/casa/loja-nucleo.mjs","de":"catalogoDiverge: l.sha_catalogo !== l.manifesto_sha256","para":"catalogoDiverge: false","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"62 maquina conta lapide","arquivo":"runtime/casa/loja-nucleo.mjs","de":"i.maquina = m.id AND i.apagado_em IS NULL","para":"i.maquina = m.id","teste":["testes/casa-loja-nucleo.test.mjs"]},
  {"nome":"63 catalogo com lapide aparece","arquivo":"runtime/casa/loja-nucleo.mjs","de":"ON a.id = i.agente AND a.apagado_em IS NULL","para":"ON a.id = i.agente","teste":["testes/casa-loja-nucleo.test.mjs"]}
]
```

- [x] **Passo 5: extrair a lista e a tabela, e anotar os hashes.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-07-f1-plano-6-nucleo.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so mutantes.mjs tabela-mutantes-p6.mjs mutantes-p6-t2.json
$alvos = 'runtime/casa/loja-nucleo.mjs', 'testes/casa-loja-nucleo.test.mjs'
$alvos | ForEach-Object { $_ + ' ' + (Get-FileHash $_ -Algorithm SHA256).Hash.Substring(0, 12) } | Set-Content -Encoding utf8 "$rascunho\hashes-antes-p6-t2.txt"
Get-Content "$rascunho\hashes-antes-p6-t2.txt"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `igual mutantes.mjs`, `igual tabela-mutantes-p6.mjs`, `gravado mutantes-p6-t2.json`, as duas linhas de hash e `False`.

Resultado (07/11): a lista gravada no `$rascunho`; os hashes não foram anotados (executor, item 13).

- [x] **Passo 6: rodar, em segundo plano.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
node "$rascunho\mutantes.mjs" "$rascunho\mutantes-p6-t2.json" *> "$rascunho\mutantes-p6-t2.txt"; "saida: $LASTEXITCODE"
```

Esperado: a última linha de `mutantes-p6-t2.txt` é `63 mutantes em … s; fora do vermelho: 0`, e `saida: 0`.

Resultado (07/11): os 63 vermelhos, com as 63 linhas no `mutantes-p6-t2.saida.jsonl`; o `.txt` e o tempo não ficaram (executor, item 13).

- [x] **Passo 7: a tabela, os hashes e a guarda.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-07-f1-plano-6-nucleo.md'
$alvos = 'runtime/casa/loja-nucleo.mjs', 'testes/casa-loja-nucleo.test.mjs'
node "$rascunho\tabela-mutantes-p6.mjs" "$rascunho\mutantes-p6-t2.json"; "saida: $LASTEXITCODE"
$depois = $alvos | ForEach-Object { $_ + ' ' + (Get-FileHash $_ -Algorithm SHA256).Hash.Substring(0, 12) }
Compare-Object (Get-Content "$rascunho\hashes-antes-p6-t2.txt") $depois
git status --short
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --conferir; "saida: $LASTEXITCODE"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `63 linhas: 63 vermelhos, 0 equivalente(s); testes mapeados: 79`, nenhuma linha `PROBLEMA` e `saida: 0`; o `Compare-Object` calado; no status, as linhas da T1 mais `?? runtime/casa/loja-nucleo.mjs` e `?? testes/casa-loja-nucleo.test.mjs`; os `igual` dos blocos já extraídos e `saida: 0`; e `False`. A tabela gerada (`$rascunho\mutantes-p6-t2.tabela.md`) entra no Apêndice B.

Resultado (07/11): `63 linhas: 63 vermelhos, 0 equivalente(s); testes mapeados: 79`, nenhuma linha `PROBLEMA` e `saida: 0`. A loja guardada pelo executor antes da rodada tem o hash do atual (`41616a88a4e8`, o mesmo que a T3 confere no furo), e o `--conferir` roda na T5 (executor, item 13). A tabela está no Apêndice B.

### Task 3: a linha de comando do núcleo

**Arquivos:** criar `testes/nucleo-cli.test.mjs` (NC, 9 testes) e `runtime/nucleo.mjs`, e acrescentar a loja e a CLI ao `check` do `package.json`. A NC roda a CLI em processo (pelo `rodarNucleo`, com stdout e stderr de mentira) e uma vez pela linha de comando, numa casa temporária, e prova os códigos de saída, o uso sem eco, o ciclo registrar, listar, máquinas e retirar, a recusa sem gravar, a máquina, a falha inesperada nas degradações, a casa igual à do Omni e a raiz relativa.

- [x] **Passo 1: o teste.**

```js arquivo=testes/nucleo-cli.test.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { casaDoOmni } from '../runtime/memoria.mjs'
import { casaDoNucleo, rodarNucleo } from '../runtime/nucleo.mjs'

const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const MAQUINA = hostname().toLowerCase()

function saidaFalsa() { return { texto: '', write(t) { this.texto += t; return true } } }
const ultimaLinha = (saida) => JSON.parse(saida.texto.trim().split('\n').at(-1))
async function comCasa(uso) {
  const casa = mkdtempSync(join(tmpdir(), 'omni-nucleo-cli-'))
  const env = { ...process.env, OMNI_HOME: casa, OMNI_CASA_BANCO: join(casa, 'casa') }
  try { return await uso(casa, env) } finally { rmSync(casa, { recursive: true, force: true }) }
}
async function rodar(env, argv) {
  const saida = saidaFalsa(); const erro = saidaFalsa()
  const codigo = await rodarNucleo(argv, { saida, erro, env })
  return { codigo, saida, erro }
}
// Um agente de mentira dentro da casa de teste: <casa>/agentes/<nome>/executor/agente.json.
function agente(casa, manifesto, nome = 'exemplo') {
  const raiz = join(casa, 'agentes', nome)
  mkdirSync(join(raiz, 'executor'), { recursive: true })
  writeFileSync(join(raiz, 'executor', 'agente.json'), typeof manifesto === 'string' ? manifesto : JSON.stringify(manifesto, null, 2))
  return raiz
}
const minimo = (versao = '0.1.0') => ({ agente: 'exemplo', versao, banco: null, requer: {}, tarefas: [], credenciais: [] })
const bancoDoNucleo = (casa) => join(casa, 'casa', 'nucleo.db')

test('uso errado sai com 2, mostra o uso e nunca ecoa o argumento', async () => comCasa(async (casa, env) => {
  for (const argv of [[], ['sumir'], ['registrar'], ['verificar', '--raiz', ''], ['retirar'], ['listar', '--segredo=valor-que-nao-volta'], ['listar', 'solto']]) {
    const r = await rodar(env, argv)
    assert.equal(r.codigo, 2, JSON.stringify(argv))
    assert.match(r.erro.texto, /uso: node runtime\/nucleo\.mjs/)
    assert.equal(r.saida.texto, '')
    assert.ok(!r.erro.texto.includes('valor-que-nao-volta'))
  }
  assert.match((await rodar(env, ['registrar'])).erro.texto, /^falta --raiz/)
  assert.match((await rodar(env, ['retirar'])).erro.texto, /^falta --agente/)
  assert.match((await rodar(env, [])).erro.texto, /^falta o comando/)
  assert.match((await rodar(env, ['sumir'])).erro.texto, /^comando desconhecido/)
  assert.ok(!existsSync(bancoDoNucleo(casa)))
}))

test('casaDoNucleo é a mesma casa do Omni', () => {
  for (const env of [{ OMNI_HOME: 'rel/x' }, { APPDATA: 'C:\\A' }, {}]) assert.equal(casaDoNucleo(env), casaDoOmni(env), JSON.stringify(env))
})

test('verificar confere o manifesto sem abrir o banco', async () => comCasa(async (casa, env) => {
  const raiz = agente(casa, minimo())
  const ok = await rodar(env, ['verificar', '--raiz', raiz])
  assert.equal(ok.codigo, 0, ok.erro.texto)
  const linha = ultimaLinha(ok.saida)
  assert.deepEqual({ ok: linha.ok, agente: linha.agente, versao: linha.versao }, { ok: true, agente: 'exemplo', versao: '0.1.0' })
  assert.match(linha.sha256, /^[0-9a-f]{64}$/)

  const ruim = await rodar(env, ['verificar', '--raiz', agente(casa, { ...minimo(), versao: 'um' }, 'ruim')])
  assert.equal(ruim.codigo, 3)
  const recusa = ultimaLinha(ruim.saida)
  assert.equal(recusa.ok, false)
  assert.equal(recusa.codigo, 'manifesto-invalido')
  assert.equal(recusa.erros?.length, 1)
  assert.match(recusa.erros[0], /^versao:/)

  const sem = await rodar(env, ['verificar', '--raiz', join(casa, 'nada')])
  assert.equal(sem.codigo, 3)
  assert.equal(ultimaLinha(sem.saida).codigo, 'sem-manifesto')
  assert.deepEqual(ultimaLinha(sem.saida).erros, [])
  assert.ok(!existsSync(bancoDoNucleo(casa)), 'verificar não cria o nucleo.db')
}))

test('registrar, listar, maquinas e retirar fazem o ciclo da instalação', async () => comCasa(async (casa, env) => {
  const raiz = agente(casa, minimo())
  const primeiro = await rodar(env, ['registrar', '--raiz', raiz])
  assert.equal(primeiro.codigo, 0, primeiro.erro.texto)
  assert.deepEqual(ultimaLinha(primeiro.saida), { ok: true, agente: 'exemplo', versao: '0.1.0', maquina: MAQUINA, mudou: { agente: true, instalacao: true } })
  const de_novo = await rodar(env, ['registrar', '--raiz', raiz])
  assert.deepEqual(ultimaLinha(de_novo.saida).mudou, { agente: false, instalacao: false })

  const lista = await rodar(env, ['listar'])
  assert.equal(lista.codigo, 0)
  const instalados = ultimaLinha(lista.saida)
  assert.equal(instalados.length, 1)
  assert.deepEqual({ agente: instalados[0].agente, raiz: instalados[0].raiz, versao: instalados[0].versao, diverge: instalados[0].catalogoDiverge },
    { agente: 'exemplo', raiz, versao: '0.1.0', diverge: false })
  assert.deepEqual(ultimaLinha((await rodar(env, ['listar', '--maquina', 'outra-maquina'])).saida), [])

  const maquinas = ultimaLinha((await rodar(env, ['maquinas'])).saida)
  assert.deepEqual(maquinas.map((m) => [m.id, m.agentes]), [[MAQUINA, 1]])

  const retirado = await rodar(env, ['retirar', '--agente', 'exemplo'])
  assert.equal(retirado.codigo, 0)
  assert.deepEqual(ultimaLinha(retirado.saida), { ok: true, agente: 'exemplo', maquina: MAQUINA, retirado: true })
  assert.deepEqual(ultimaLinha((await rodar(env, ['listar'])).saida), [])
  const outra_vez = await rodar(env, ['retirar', '--agente', 'exemplo'])
  assert.equal(outra_vez.codigo, 3)
  assert.equal(ultimaLinha(outra_vez.saida).codigo, 'inexistente')
}))

test('registrar recusa manifesto inválido sem gravar nada', async () => comCasa(async (casa, env) => {
  const r = await rodar(env, ['registrar', '--raiz', agente(casa, '[1, 2]')])
  assert.equal(r.codigo, 3)
  assert.deepEqual(ultimaLinha(r.saida).erros, ['manifesto: precisa ser um objeto JSON'])
  assert.deepEqual(ultimaLinha((await rodar(env, ['listar'])).saida), [])
  assert.deepEqual(ultimaLinha((await rodar(env, ['maquinas'])).saida), [])
}))

test('maquina registra esta máquina e só muda na primeira vez', async () => comCasa(async (casa, env) => {
  const primeira = await rodar(env, ['maquina'])
  assert.equal(primeira.codigo, 0)
  assert.deepEqual(ultimaLinha(primeira.saida), { ok: true, maquina: MAQUINA, mudou: true })
  assert.deepEqual(ultimaLinha((await rodar(env, ['maquina'])).saida), { ok: true, maquina: MAQUINA, mudou: false })
}))

test('falha inesperada sai com 1 e fica anotada nas degradações', async () => comCasa(async (casa, env) => {
  mkdirSync(bancoDoNucleo(casa), { recursive: true })   // uma pasta no lugar do arquivo: o banco não abre
  const r = await rodar(env, ['listar'])
  assert.equal(r.codigo, 1)
  assert.match(r.erro.texto, /^falha inesperada no núcleo:/)
  const anotadas = join(casa, 'casa', 'degradacoes.jsonl')
  assert.ok(existsSync(anotadas), 'a falha inesperada fica anotada')
  const linhas = readFileSync(anotadas, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.deepEqual(linhas.map((l) => l.operacao), ['nucleo.cli'])
}))

test('roda direto pela linha de comando', async () => comCasa(async (casa, env) => {
  const raiz = agente(casa, minimo('1.2.3'))
  const r = spawnSync(process.execPath, [join(RAIZ, 'runtime', 'nucleo.mjs'), 'registrar', '--raiz', raiz], { env, encoding: 'utf8', windowsHide: true, timeout: 60_000 })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /"versao":"1\.2\.3"/)
  assert.equal(JSON.parse(r.stdout.trim()).versao, '1.2.3')
  const uso = spawnSync(process.execPath, [join(RAIZ, 'runtime', 'nucleo.mjs')], { env, encoding: 'utf8', windowsHide: true, timeout: 60_000 })
  assert.equal(uso.status, 2)
}))

test('a raiz relativa vale a partir da pasta atual', async () => comCasa(async (casa, env) => {
  agente(casa, minimo('2.0.0'), 'relativa')
  const r = spawnSync(process.execPath, [join(RAIZ, 'runtime', 'nucleo.mjs'), 'registrar', '--raiz', join('agentes', 'relativa')], { cwd: casa, env, encoding: 'utf8', windowsHide: true, timeout: 60_000 })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /"ok":true/)
  const [instalado] = ultimaLinha((await rodar(env, ['listar'])).saida)
  assert.equal(instalado.raiz.toLowerCase(), join(casa, 'agentes', 'relativa').toLowerCase())
}))
```

- [x] **Passo 2: extrair o teste e ver o vermelho.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-07-f1-plano-6-nucleo.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so testes/nucleo-cli.test.mjs
node --test --test-concurrency=1 --test-reporter=spec testes/nucleo-cli.test.mjs *> "$rascunho\p6-t3-vermelho.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\p6-t3-vermelho.txt" -Pattern 'Cannot find module', '(tests|pass|fail) \d+\s*$'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `gravado testes/nucleo-cli.test.mjs`, `saida: 1`, o `ERR_MODULE_NOT_FOUND` de `runtime/nucleo.mjs`, `tests 1`, `pass 0`, `fail 1` e `False`.

Resultado (07/11), visto numa cópia do HEAD com a loja e a NC (executor, item 13): `saida: 1`, `Cannot find module` do `nucleo.mjs`, `tests 1`, `pass 0`, `fail 1` e `False`.

- [x] **Passo 3: o módulo.** A CLI inteira (decisões 13 e 14).

```js arquivo=runtime/nucleo.mjs
// Linha de comando do núcleo da casa (§4.2): o catálogo de agentes, onde cada um está instalado
// e as máquinas que a casa conhece. O executor de cada agente chama o registrar depois de instalar
// e o retirar ao desinstalar; o verificar confere o executor/agente.json sem abrir o banco.
// Cada máquina grava só as próprias linhas: o registrar e o retirar valem para esta máquina.
// A saída é JSON numa linha. Códigos de saída: 0 ok; 2 uso errado; 3 recusa do núcleo;
// 1 falha inesperada (vai para degradacoes.jsonl).
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { comBancoDaCasa, registrarDegradacao } from './casa/banco.mjs'
import {
  NucleoError, lerManifesto, listarInstalados, listarMaquinas, registrarAgente, registrarMaquina, retirarAgente, validarManifesto
} from './casa/loja-nucleo.mjs'

const USO = `uso: node runtime/nucleo.mjs <comando> [opções]
  verificar --raiz <pasta do agente>   (confere executor/agente.json; não grava)
  registrar --raiz <pasta do agente>   (catálogo e instalação nesta máquina)
  retirar --agente <nome>   (desinstalação nesta máquina)
  listar [--maquina <m>]   (agentes instalados; padrão: esta máquina)
  maquinas
  maquina   (registra esta máquina)`
class UsoError extends Error {}

export function casaDoNucleo(env = process.env) {
  if (env.OMNI_HOME) return resolve(env.OMNI_HOME)
  if (env.APPDATA) return join(env.APPDATA, 'omni')
  return join(homedir(), '.omni')
}

function lerOpcoes(argumentos, opcoes, obrigatorias = []) {
  let lidas
  try { lidas = parseArgs({ args: argumentos, options: opcoes, strict: true, allowPositionals: false }).values }
  catch (erro) { throw new UsoError(`opções inválidas (${erro.code ?? erro.name})`) }   // nunca ecoa o argumento
  for (const nome of obrigatorias) if (lidas[nome] === undefined || lidas[nome] === '') throw new UsoError(`falta --${nome}`)
  return lidas
}

export async function rodarNucleo(argv, { saida = process.stdout, erro = process.stderr, env = process.env } = {}) {
  const casa = casaDoNucleo(env)
  const comNucleo = (uso) => comBancoDaCasa(casa, 'nucleo', uso, env)   // uso síncrono
  const escrever = (objeto) => saida.write(`${JSON.stringify(objeto)}\n`)
  const [comando, ...resto] = argv
  try {
    switch (comando) {
      case 'verificar': {
        const o = lerOpcoes(resto, { raiz: { type: 'string' } }, ['raiz'])
        const { manifesto, sha256 } = validarManifesto(lerManifesto(resolve(o.raiz)))
        escrever({ ok: true, agente: manifesto.agente, versao: manifesto.versao, sha256 }); return 0
      }
      case 'registrar': {
        const o = lerOpcoes(resto, { raiz: { type: 'string' } }, ['raiz'])
        const raiz = resolve(o.raiz)
        const conteudo = lerManifesto(raiz)
        escrever({ ok: true, ...comNucleo((db) => registrarAgente(db, conteudo, { raiz })) }); return 0
      }
      case 'retirar': {
        const o = lerOpcoes(resto, { agente: { type: 'string' } }, ['agente'])
        escrever({ ok: true, ...comNucleo((db) => retirarAgente(db, o.agente)) }); return 0
      }
      case 'listar': {
        const o = lerOpcoes(resto, { maquina: { type: 'string' } })
        escrever(comNucleo((db) => listarInstalados(db, o.maquina === undefined ? {} : { maquina: o.maquina }))); return 0
      }
      case 'maquinas': { lerOpcoes(resto, {}); escrever(comNucleo((db) => listarMaquinas(db))); return 0 }
      case 'maquina': { lerOpcoes(resto, {}); escrever({ ok: true, ...comNucleo((db) => registrarMaquina(db)) }); return 0 }
      default: throw new UsoError(comando === undefined ? 'falta o comando' : 'comando desconhecido')
    }
  } catch (falha) {
    if (falha instanceof UsoError) { erro.write(`${falha.message}\n${USO}\n`); return 2 }
    if (falha instanceof NucleoError) { escrever({ ok: false, codigo: falha.code, erro: falha.message, erros: falha.erros }); return 3 }
    registrarDegradacao(casa, 'nucleo.cli', falha, env)
    erro.write(`falha inesperada no núcleo: ${String(falha?.message ?? falha).slice(0, 300)}\n`)
    return 1
  }
}

const direto = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (direto) process.exitCode = await rodarNucleo(process.argv.slice(2))
```

- [x] **Passo 4: extrair o módulo e ver o verde.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-07-f1-plano-6-nucleo.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so runtime/nucleo.mjs
node --check runtime/nucleo.mjs; "check: $LASTEXITCODE"
node --test --test-concurrency=1 --test-reporter=spec testes/nucleo-cli.test.mjs *> "$rascunho\p6-t3-verde.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\p6-t3-verde.txt" -Pattern '(tests|pass|fail) \d+\s*$'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `gravado runtime/nucleo.mjs`, `check: 0`, `tests 9`, `pass 9`, `fail 0`, `saida: 0` e `False`.

Resultado (07/11): `tests 9`, `pass 9`, `fail 0`, `saida: 0` e `False`.

- [x] **Passo 5: ver o furo do `check`.** O mutante de sintaxe do plano 4 acrescenta uma linha que não compila no fim do arquivo, roda o `npm run check` e restaura. Antes de mexer no `package.json`, o `check` não vê nenhum dos dois módulos novos.

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
node "$rascunho\extrair-do-plano.mjs" docs\superpowers\plans\2026-11-06-f1-plano-4-cofre.md . $rascunho --so mutante-sintaxe.mjs
foreach ($alvo in 'runtime/casa/loja-nucleo.mjs', 'runtime/nucleo.mjs') { node "$rascunho\mutante-sintaxe.mjs" . $alvo }
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `igual mutante-sintaxe.mjs` e, nos dois, `status 0; SyntaxError: false; aponta: (nenhuma linha cita o arquivo)` e `restaurado: true`; `False`.

Resultado (07/11), com o `package.json` do HEAD posto de volta por um instante (executor, item 13): nos dois, `status 0; SyntaxError: false; aponta: (nenhuma linha cita o arquivo)` e `restaurado: true`, com os hashes `41616a88a4e8` e `595a398715c3` conferidos na volta; `False`.

- [x] **Passo 6: fechar o furo.** No `package.json`, no script `check`, trocar

```text
node --check runtime/cofre.mjs && node --check runtime/casa/presenca.mjs
```

por

```text
node --check runtime/cofre.mjs && node --check runtime/casa/loja-nucleo.mjs && node --check runtime/nucleo.mjs && node --check runtime/casa/presenca.mjs
```

O trecho aparece uma vez só no arquivo, e a troca é a única mudança do `package.json` neste plano.

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$alvos = 'runtime/casa/loja-nucleo.mjs', 'runtime/nucleo.mjs'
foreach ($alvo in $alvos) { 'linhas de ' + $alvo + ': ' + (Get-Content $alvo).Count; node "$rascunho\mutante-sintaxe.mjs" . $alvo }
npm run check *> "$rascunho\p6-t3-check.txt"; "saida: $LASTEXITCODE"
git diff --numstat -- package.json
foreach ($a in @('package.json') + $alvos) { $a + ' CR: ' + ([IO.File]::ReadAllText((Resolve-Path $a)).Split([char]13).Count - 1) }
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `linhas de runtime/casa/loja-nucleo.mjs: 279` e `linhas de runtime/nucleo.mjs: 80`; nos dois, `status 1; SyntaxError: true`, apontando a linha logo depois do fim do arquivo, e `restaurado: true`; `saida: 0` no `check` sem mutante; `1	1	package.json`; CR 0 nos três; `False`.

Resultado (07/11): as linhas 279 e 80; `status 1; SyntaxError: true`, apontando `loja-nucleo.mjs:281` e `nucleo.mjs:82`, e `restaurado: true` com os mesmos hashes do Passo 5; `saida: 0`; `1	1	package.json`; CR 0 nos três; `False`.

**Mutação.** Trinta mutantes, todos na CLI: os códigos de saída e as degradações (01 a 09), as opções (10 a 16), os comandos (17 a 25), a casa (26 a 28) e a execução direta (29 e 30). Cada um tem o trecho exato (uma vez só no arquivo), a troca e as suítes que devem matá-lo. O executor aplica um por vez, roda as suítes do mutante pelo `run()` do `node:test`, restaura sempre e anota cada teste que caiu. A tabela derruba a rodada se um mutante sobreviver sem estar declarado equivalente, se uma queda não for `AssertionError` com `ERR_ASSERTION` ou se vier de suíte fora das do mutante: mutante que morre no setup não prova nada. Não há mapa previsto: a tabela do Apêndice C, gerada da rodada, é o registro de onde cada um caiu.

```json rascunho=mutantes-p6-t3.json
[
  {"nome":"01 uso errado sai com 1","arquivo":"runtime/nucleo.mjs","de":"erro.write(`${falha.message}\\n${USO}\\n`); return 2","para":"erro.write(`${falha.message}\\n${USO}\\n`); return 1","teste":["testes/nucleo-cli.test.mjs"]},
  {"nome":"02 uso some do stderr","arquivo":"runtime/nucleo.mjs","de":"erro.write(`${falha.message}\\n${USO}\\n`)","para":"erro.write(`${falha.message}\\n`)","teste":["testes/nucleo-cli.test.mjs"]},
  {"nome":"03 recusa sai com 1","arquivo":"runtime/nucleo.mjs","de":"erros: falha.erros }); return 3","para":"erros: falha.erros }); return 1","teste":["testes/nucleo-cli.test.mjs"]},
  {"nome":"04 recusa sem a lista de erros","arquivo":"runtime/nucleo.mjs","de":"erro: falha.message, erros: falha.erros }","para":"erro: falha.message }","teste":["testes/nucleo-cli.test.mjs"]},
  {"nome":"05 codigo da recusa troca","arquivo":"runtime/nucleo.mjs","de":"codigo: falha.code, erro","para":"codigo: falha.name, erro","teste":["testes/nucleo-cli.test.mjs"]},
  {"nome":"06 falha inesperada sai com 3","arquivo":"runtime/nucleo.mjs","de":"slice(0, 300)}\\n`)\n    return 1","para":"slice(0, 300)}\\n`)\n    return 3","teste":["testes/nucleo-cli.test.mjs"]},
  {"nome":"07 degradacao com outra operacao","arquivo":"runtime/nucleo.mjs","de":"'nucleo.cli'","para":"'cofre.cli'","teste":["testes/nucleo-cli.test.mjs"]},
  {"nome":"08 degradacao nao anotada","arquivo":"runtime/nucleo.mjs","de":"    registrarDegradacao(casa, 'nucleo.cli', falha, env)\n","para":"","teste":["testes/nucleo-cli.test.mjs"]},
  {"nome":"09 mensagem da falha inesperada","arquivo":"runtime/nucleo.mjs","de":"falha inesperada no núcleo:","para":"falha no núcleo:","teste":["testes/nucleo-cli.test.mjs"]},
  {"nome":"10 falta o comando vira desconhecido","arquivo":"runtime/nucleo.mjs","de":"comando === undefined ? 'falta o comando' : ","para":"comando === undefined ? 'comando desconhecido' : ","teste":["testes/nucleo-cli.test.mjs"]},
  {"nome":"11 opcao estranha aceita","arquivo":"runtime/nucleo.mjs","de":"strict: true","para":"strict: false","teste":["testes/nucleo-cli.test.mjs"]},
  {"nome":"12 posicional aceito","arquivo":"runtime/nucleo.mjs","de":"allowPositionals: false","para":"allowPositionals: true","teste":["testes/nucleo-cli.test.mjs"]},
  {"nome":"13 obrigatoria vazia aceita","arquivo":"runtime/nucleo.mjs","de":"lidas[nome] === undefined || lidas[nome] === ''","para":"lidas[nome] === undefined","teste":["testes/nucleo-cli.test.mjs"]},
  {"nome":"14 verificar sem raiz obrigatoria","arquivo":"runtime/nucleo.mjs","de":"['raiz'])\n        const { manifesto","para":"[])\n        const { manifesto","teste":["testes/nucleo-cli.test.mjs"]},
  {"nome":"15 registrar sem raiz obrigatoria","arquivo":"runtime/nucleo.mjs","de":"['raiz'])\n        const raiz","para":"[])\n        const raiz","teste":["testes/nucleo-cli.test.mjs"]},
  {"nome":"16 retirar sem agente obrigatorio","arquivo":"runtime/nucleo.mjs","de":"{ agente: { type: 'string' } }, ['agente'])","para":"{ agente: { type: 'string' } }, [])","teste":["testes/nucleo-cli.test.mjs"]},
  {"nome":"17 verificar abre o banco","arquivo":"runtime/nucleo.mjs","de":"= validarManifesto(lerManifesto(resolve(o.raiz)))","para":"= comNucleo(() => validarManifesto(lerManifesto(resolve(o.raiz))))","teste":["testes/nucleo-cli.test.mjs"]},
  {"nome":"18 verificar sem sha","arquivo":"runtime/nucleo.mjs","de":"versao: manifesto.versao, sha256 }","para":"versao: manifesto.versao }","teste":["testes/nucleo-cli.test.mjs"]},
  {"nome":"19 verificar troca o agente","arquivo":"runtime/nucleo.mjs","de":"agente: manifesto.agente,","para":"agente: manifesto.versao,","teste":["testes/nucleo-cli.test.mjs"]},
  {"nome":"20 raiz relativa nao resolvida","arquivo":"runtime/nucleo.mjs","de":"const raiz = resolve(o.raiz)","para":"const raiz = o.raiz","teste":["testes/nucleo-cli.test.mjs"]},
  {"nome":"21 registrar sem ok","arquivo":"runtime/nucleo.mjs","de":"escrever({ ok: true, ...comNucleo((db) => registrarAgente","para":"escrever({ ...comNucleo((db) => registrarAgente","teste":["testes/nucleo-cli.test.mjs"]},
  {"nome":"22 retirar sem o resultado","arquivo":"runtime/nucleo.mjs","de":"escrever({ ok: true, ...comNucleo((db) => retirarAgente(db, o.agente)) })","para":"comNucleo((db) => retirarAgente(db, o.agente)); escrever({ ok: true })","teste":["testes/nucleo-cli.test.mjs"]},
  {"nome":"23 listar ignora a maquina","arquivo":"runtime/nucleo.mjs","de":"o.maquina === undefined ? {} : { maquina: o.maquina }","para":"{}","teste":["testes/nucleo-cli.test.mjs"]},
  {"nome":"24 maquinas vazia","arquivo":"runtime/nucleo.mjs","de":"escrever(comNucleo((db) => listarMaquinas(db)))","para":"escrever([])","teste":["testes/nucleo-cli.test.mjs"]},
  {"nome":"25 maquina sempre muda","arquivo":"runtime/nucleo.mjs","de":"...comNucleo((db) => registrarMaquina(db)) }","para":"...comNucleo((db) => registrarMaquina(db)), mudou: true }","teste":["testes/nucleo-cli.test.mjs"]},
  {"nome":"26 casa ignora OMNI_HOME relativo","arquivo":"runtime/nucleo.mjs","de":"if (env.OMNI_HOME) return resolve(env.OMNI_HOME)","para":"if (env.OMNI_HOME) return env.OMNI_HOME","teste":["testes/nucleo-cli.test.mjs"]},
  {"nome":"27 casa em outra pasta do APPDATA","arquivo":"runtime/nucleo.mjs","de":"if (env.APPDATA) return join(env.APPDATA, 'omni')","para":"if (env.APPDATA) return join(env.APPDATA, 'nucleo')","teste":["testes/nucleo-cli.test.mjs"]},
  {"nome":"28 sem APPDATA cai fora do home","arquivo":"runtime/nucleo.mjs","de":"return join(homedir(), '.omni')","para":"return join(homedir(), 'omni')","teste":["testes/nucleo-cli.test.mjs"]},
  {"nome":"29 execucao direta le o argv errado","arquivo":"runtime/nucleo.mjs","de":"rodarNucleo(process.argv.slice(2))","para":"rodarNucleo(process.argv.slice(1))","teste":["testes/nucleo-cli.test.mjs"]},
  {"nome":"30 execucao direta desligada","arquivo":"runtime/nucleo.mjs","de":"if (direto) process.exitCode","para":"if (!direto) process.exitCode","teste":["testes/nucleo-cli.test.mjs"]}
]
```

- [x] **Passo 7: extrair a lista e a tabela, e anotar os hashes.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-07-f1-plano-6-nucleo.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so mutantes.mjs tabela-mutantes-p6.mjs mutantes-p6-t3.json
$alvos = 'runtime/nucleo.mjs', 'testes/nucleo-cli.test.mjs', 'package.json'
$alvos | ForEach-Object { $_ + ' ' + (Get-FileHash $_ -Algorithm SHA256).Hash.Substring(0, 12) } | Set-Content -Encoding utf8 "$rascunho\hashes-antes-p6-t3.txt"
Get-Content "$rascunho\hashes-antes-p6-t3.txt"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `igual mutantes.mjs`, `igual tabela-mutantes-p6.mjs`, `gravado mutantes-p6-t3.json`, as três linhas de hash e `False`.

Resultado (07/11): a lista gravada no `$rascunho`; os hashes não foram anotados (executor, item 13).

- [x] **Passo 8: rodar, em segundo plano.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
node "$rascunho\mutantes.mjs" "$rascunho\mutantes-p6-t3.json" *> "$rascunho\mutantes-p6-t3.txt"; "saida: $LASTEXITCODE"
```

Esperado: a última linha de `mutantes-p6-t3.txt` é `30 mutantes em … s; fora do vermelho: 0`, e `saida: 0`.

Resultado (07/11): os 30 vermelhos, com as 30 linhas no `mutantes-p6-t3.saida.jsonl`; o `.txt` e o tempo não ficaram (executor, item 13).

- [x] **Passo 9: a tabela, os hashes e a guarda.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-07-f1-plano-6-nucleo.md'
$alvos = 'runtime/nucleo.mjs', 'testes/nucleo-cli.test.mjs', 'package.json'
node "$rascunho\tabela-mutantes-p6.mjs" "$rascunho\mutantes-p6-t3.json"; "saida: $LASTEXITCODE"
$depois = $alvos | ForEach-Object { $_ + ' ' + (Get-FileHash $_ -Algorithm SHA256).Hash.Substring(0, 12) }
Compare-Object (Get-Content "$rascunho\hashes-antes-p6-t3.txt") $depois
git status --short
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --conferir; "saida: $LASTEXITCODE"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `30 linhas: 30 vermelhos, 0 equivalente(s); testes mapeados: 38`, nenhuma linha `PROBLEMA` e `saida: 0`; o `Compare-Object` calado; no status, as linhas da T2 mais ` M package.json`, `?? runtime/nucleo.mjs` e `?? testes/nucleo-cli.test.mjs`; os doze `igual` e `saida: 0`; e `False`. A tabela gerada (`$rascunho\mutantes-p6-t3.tabela.md`) entra no Apêndice C.

Resultado (07/11): `30 linhas: 30 vermelhos, 0 equivalente(s); testes mapeados: 38`, nenhuma linha `PROBLEMA` e `saida: 0`. A CLI guardada pelo executor antes da rodada tem o hash do atual (`595a398715c3`), e o `--conferir` roda na T5 (executor, item 13). A tabela está no Apêndice C.

### Task 4: verify, `.test-dist` e `dist`

Uma suíte pesada por vez. Nenhum arquivo do repositório muda nesta tarefa; o `dist` que o build reescreve volta no fim, e só se a diferença for de fim de linha. Não há rodada de afetadas à parte, como no plano 5: o esquema é importado pelo `banco.mjs`, que alcança as suítes da casa inteira, e o verify já roda todas.

- [x] **Passo 1: verify, em segundo plano.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
npm run verify *> "$rascunho\verify-p6.txt"; "saida: $LASTEXITCODE" | Out-File -Append -Encoding utf8 "$rascunho\verify-p6.txt"
Select-String -Path "$rascunho\verify-p6.txt" -Pattern '(tests|pass|fail|cancelled|skipped|duration_ms) [\d.]+\s*$', '\.test\.mjs:\d+:\d+', '^saida: ', '^\s+(actual|expected): ', '^\{"ok"'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado:
- `tests 889`, `pass 884`, `fail 1`, `cancelled 0` e `skipped 4`; a única falha é `testes\integridade-release.test.mjs:165`, que cai na linha 173;
- `actual` e `expected` com 64 dígitos hexadecimais cada: o `actual` é o contrato (`3c60182bbef2…`, o mesmo dos planos 4 e 5), o `expected` é o calculado com este plano, diferente do `bc1169aef098…` do plano 5, porque o payload de `runtime/` mudou. Ele fica anotado no resultado para o plano 8, que grava o contrato;
- cinco linhas `{"ok":true,…}`, como no plano 5: este plano não muda TypeScript;
- `saida: 1`;
- `False`.

Base: o verify do plano 5, com 819 testes. Os 70 deste plano são CB 1, LN 60 e NC 9.

Resultado (07/11): `tests 889`, `pass 884`, `fail 1`, `cancelled 0` e `skipped 4`, em 464 s. A única falha é a `testes\integridade-release.test.mjs:165`, que cai na linha 173: `actual` `3c60182bbef281d96b6782d614482b5e7459ce036468233c29eb6f1af3ef3df3` (o contrato) e `expected` `56f4f79a2e4a2264811856408df404583a13ced81ad04372d6b9fe29509dcc57` (o calculado com este plano, que o plano 8 grava). Saíram as cinco linhas `{"ok":true,…}`, e `saida: 1`. O arquivo do verify ficou fora do `$rascunho` (executor, item 13). A guarda deu `False`.

- [x] **Passo 2: o que a falha conhecida mascara, rodado à parte.** O `npm test` para no primeiro `node --test` vermelho, então o `.test-dist`, o `test:dist` e o `verify:build` não rodam dentro do verify.

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
node --test --test-concurrency=1 .test-dist/testes/*.test.js *> "$rascunho\p6-t4-test-dist.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\p6-t4-test-dist.txt" -Pattern '(tests|pass|fail) \d+\s*$'
npm run test:dist *> "$rascunho\p6-t4-dist-production.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\p6-t4-dist-production.txt" -Pattern '(tests|pass|fail) \d+\s*$'
npm run verify:build *> "$rascunho\p6-t4-verify-build.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\p6-t4-verify-build.txt" -Pattern '^\{"ok"'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: as três com `saida: 0`; `.test-dist` 55/55, `test:dist` 1/1 e `{"ok":true,"files":59}`, os mesmos números do plano 5; `False`.

Resultado (07/11): as três com `saida: 0`: `.test-dist` com `tests 55`, `pass 55` e `fail 0`; `test:dist` com `tests 1`, `pass 1` e `fail 0`; `verify:build` com `{"ok":true,"files":59}`; `False`.

- [x] **Passo 3: devolver o `dist` e a guarda.** O `checkout` só roda se o `--stat` sem CR vier vazio: diferença de conteúdo no `dist` é defeito a investigar, não sobra a descartar.

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-07-f1-plano-6-nucleo.md'
$stat = @(git diff --ignore-cr-at-eol --stat -- dist)
'linhas de stat: ' + $stat.Count
if ($stat.Count -eq 0) { git checkout -- dist; 'checkout: ' + $LASTEXITCODE } else { $stat }
git status --short
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --conferir > "$rascunho\p6-conferir.txt"; "saida: $LASTEXITCODE"
'igual: ' + @(Select-String -Path "$rascunho\p6-conferir.txt" -Pattern '^igual ').Count + ', outros: ' + @(Select-String -Path "$rascunho\p6-conferir.txt" -Pattern '^igual ' -NotMatch).Count
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `linhas de stat: 0` e `checkout: 0`; o `status` com as sete linhas das tarefas 1 a 3 e nenhuma em `dist/`: três `M` (`package.json`, o esquema e o CB) e quatro `??` (a loja, a CLI, a LN e a NC), além deste plano; `igual: 12, outros: 0` e `saida: 0`; `False`.

Resultado (07/11): `linhas de stat: 0` e `checkout: 0`; o `status` com as três `M` e as quatro `??`, nenhuma linha em `dist/`; `False`. O `--conferir` ficou para a T5, porque o plano ainda não existia (executor, item 13).

### Task 5: commit, push, CI e registro

Um commit só: o esquema, a loja, a CLI, as suítes e o `package.json` só fazem sentido juntos, e o commit leva este plano e a linha 6 do escopo no plano 1. Antes dele, o `--conferir` que as tarefas não rodaram (executor, item 13).

- [x] **Passo 1: conferir o plano e trocar a linha 6 do escopo.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-07-f1-plano-6-nucleo.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so tabela-mutantes-p6.mjs mutantes-p6-t1.json mutantes-p6-t2.json mutantes-p6-t3.json
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --conferir > "$rascunho\p6-conferir.txt"; "saida: $LASTEXITCODE"
'igual: ' + @(Select-String -Path "$rascunho\p6-conferir.txt" -Pattern '^igual ').Count + ', outros: ' + @(Select-String -Path "$rascunho\p6-conferir.txt" -Pattern '^igual ' -NotMatch).Count
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: as quatro `gravado` ou `igual`; `igual: 12, outros: 0` e `saida: 0`; `False`.

Depois, em `docs/superpowers/plans/2026-11-04-f1-casa-sqlite.md`, trocar

```markdown
| 6 | Núcleo (`nucleo.db`): agentes e máquinas | §4.2 | a escrever |
```

por

```markdown
| 6 | [Núcleo (`nucleo.db`): agentes e máquinas](2026-11-07-f1-plano-6-nucleo.md) | §4.2 | entregue |
```

Resultado (08/11): as quatro `gravado`; `igual: 12, outros: 0` e `saida: 0`; `False`. Antes, a primeira montagem do plano passou pela conferência das referências de mutantes: três decisões citavam faixas erradas (o 39 é de tarefa e não de formato, o 48 é da raiz e o 62 é da listagem de máquinas) e os mutantes 13 a 17 da T1 não tinham decisão; a montagem foi refeita com as faixas certas e o `--conferir` deu os mesmos 12 `igual`. A linha 6 do escopo trocada.

- [x] **Passo 2: varredura, CR e commit.** Autor e committer Weriton-DataOps, com o e-mail dos commits dela no `origin/main`, passado no comando e nunca impresso; mensagem em UTF-8 sem BOM, em `$rascunho\msg-p6.txt`. A varredura olha só as linhas adicionadas no índice e imprime o número do padrão e o arquivo, nunca a linha: o que ela acha é investigado antes do commit, e o falso positivo fica declarado no resultado. Os padrões moram em `$rascunho\padroes-p6.txt`, um por linha, fora do repositório, porque escritos aqui eles seriam o próprio vazamento: a lista do montador deste plano (redes internas, domínio e usuário da empresa, pastas de usuário, os números do WhatsApp e o provedor), mais e-mail com domínio real, celular brasileiro e nomes de produto instalados na máquina. O CR é conferido no índice (`i/…` do `ls-files --eol`), que é o que vai ao repositório.

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$arquivos = 'package.json', 'runtime/casa/esquemas.mjs', 'runtime/casa/loja-nucleo.mjs', 'runtime/nucleo.mjs', 'testes/casa-banco.test.mjs', 'testes/casa-loja-nucleo.test.mjs', 'testes/nucleo-cli.test.mjs', 'docs/superpowers/plans/2026-11-07-f1-plano-6-nucleo.md', 'docs/superpowers/plans/2026-11-04-f1-casa-sqlite.md'
'arquivos: ' + $arquivos.Count
git add -- $arquivos
git status --short
'fora de i/lf: ' + @(git ls-files --eol -- $arquivos | Where-Object { $_ -notmatch '^i/lf\s' }).Count
$padroes = @(Get-Content "$rascunho\padroes-p6.txt" | Where-Object { $_ })
'padroes: ' + $padroes.Count
$atual = ''
$achados = foreach ($linha in (git diff --cached --unified=0 -- $arquivos)) {
  if ($linha -like '+++ b/*') { $atual = $linha.Substring(6); continue }
  if ($linha -notlike '+*') { continue }
  for ($i = 0; $i -lt $padroes.Count; $i++) { if ($linha -match $padroes[$i]) { 'padrao ' + ($i + 1) + '  em  ' + $atual } }
}
'achados: ' + @($achados).Count
$achados | Group-Object | ForEach-Object { $_.Count.ToString() + '  ' + $_.Name }
```

Esperado: `arquivos: 9`; o `status` com os 9 no índice (quatro `M ` e cinco `A `) e nenhuma outra linha fora de ` M dist/…`; `fora de i/lf: 0`; `padroes:` com a contagem do arquivo, maior que 0; `achados: 0`, ou só falsos positivos explicados um a um no resultado. Com achado real, para aqui: o arquivo volta à tarefa dele, e esta tarefa recomeça.

Com a varredura limpa, o commit:

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$email = git log origin/main --author='Weriton-DataOps' -1 --format='%ae'
if (-not $email) { throw 'sem commit da Weriton-DataOps no origin/main' }
git -c user.name=Weriton-DataOps -c "user.email=$email" commit -F "$rascunho\msg-p6.txt"
git log -1 --format='%h %p %an %cn %s'
git show --stat --format='' HEAD | Select-Object -Last 1
git status --short
```

Esperado: autor e committer `Weriton-DataOps`; 9 arquivos; o `status` só com os ` M dist/…` de fim de linha, se houver.

Resultado (08/11): `arquivos: 9`; o `status` com os 9 no índice (quatro `M` e cinco `A`) e nenhuma outra linha; `fora de i/lf: 0`; `padroes: 14`, provados antes por uma sonda com um texto inventado por padrão, que casou o padrão de cada um e nada no texto neutro; `achados: 1`, o padrão 12 neste plano: é a frase acima que descreve a lista de padrões, sem nome nenhum, falso positivo. Commit `25d0160`, pai `c38af18`, autor e committer `Weriton-DataOps`, `9 files changed, 3513 insertions(+), 13 deletions(-)`; o `status` vazio.

- [x] **Passo 3: push e CI.** A conta do push é a dona do repositório; a conta que estava ativa é lida antes da troca e volta no `finally`.

```powershell
$antes = gh api user --jq .login
gh auth switch --user Weriton-DataOps; try { git push origin casa-sqlite-f1 } finally { gh auth switch --user $antes }
gh api user --jq .login
git ls-remote origin casa-sqlite-f1
git rev-parse HEAD
```

Depois, o CI do ramo pela conta Weriton-DataOps, com o token só na variável do processo e removido no `finally`. Esperado: a última linha do `gh api user` igual à primeira (a conta voltou); o mesmo SHA no `ls-remote` e no `HEAD`; o job Linux verde e o Windows vermelho só no `:165` (item 4), com o mesmo par `actual`/`expected` da T4, Passo 1, e 889 testes. O log do job vermelho vem pela API do job (executor, item 11).

Resultado (08/11): a conta lida antes da troca voltou no `finally`; push `c38af18..25d0160`, com o mesmo SHA no `ls-remote` e no `HEAD`. No CI, o job `Linux / Node 22 / portable core` verde e o `Windows / Node 22 / full verification` vermelho só no `:165`, que cai na linha 173, com o mesmo par `actual`/`expected` da T4, Passo 1; `tests 889`, `pass 884`, `fail 1`, `cancelled 0` e `skipped 4`.

- [x] **Passo 4: registrar.** A "Situação" deste plano passa a "entregue", com o hash do commit, e os resultados entram nos passos. Esse registro vai num segundo commit, `docs(plano): registra push e CI do plano 6 da F1`, como nos planos 3 a 5, com o mesmo push do Passo 3.

Resultado (08/11): a Situação e os passos 1 a 3 desta tarefa registrados neste segundo commit. A frase do Passo 2 que descrevia a lista de padrões foi reescrita sem a palavra que dava o falso positivo do padrão 12; a varredura deste commit deu `achados: 0`.

## Autorrevisão contra o desenho

| Desenho | Onde está |
|---|---|
| §4.2: o `agente.json` com `agente`, `versao`, `banco`, `migracoes`, `requer`, `interface`, `tarefas` e `credenciais` | Decisões 3 a 8; T2 |
| §4.2: os modos `instalar`, `importar`, `exportar`, `atualizar` e `verificar`, com contrato idempotente | Decisões 6 e 9; o núcleo valida os modos e registra sem repetir; o executor que os roda é da F2 e da F3 |
| §4, passo 3: a pasta `casa\` com o `nucleo.db` e as migrações | T1; o `comBancoDaCasa` do plano 2 cria e migra |
| §4, passo 9: `verificar` | O `verificar` da CLI confere o manifesto (decisão 13); a saúde de cada agente e os painéis da ilha ficam para a F2 (Posição) |
| §3 e §3.1: SQLite, diário em cada tabela e aplicação em qualquer ordem | Decisões 1, 2 e 11; T1 |
| §3.8: o precedente do id natural | Decisão 2 |
| §2: cada agente dono do seu banco | Decisão 4 |

Desvios e notas:
- As tarefas do manifesto são objetos, e não as strings do §4.2, pelos contratos da casa para a F2 (decisão 7).
- O modo `servir` entra na lista do §4.2, também pelos contratos da F2 (decisão 6).
- `interface.preload` e `interface.rotas` não estão no §4.2; vêm da ilha e do `servir` (decisão 6).
- `executor.comando` não está no §4.2: é como o núcleo sabe chamar o executor do agente (decisão 6).
- Id natural no lugar do UUID v7 das outras tabelas da casa, no precedente do §3.8 (decisão 2).
- Sem chave estrangeira entre as tabelas do núcleo (decisão 1).
- Os nomes `dono`, `nucleo`, `cofre` e `casa` ficam reservados (decisão 3).
- A v1 provisória do HEAD é reescrita como v1, sem v2 (Posição).
- O `visto_em` é relógio local e não sobe versão (decisão 11).
- `requer.agentes` aceita um requisito por agente (decisão 6).
- `casaDoNucleo` repete a regra do `casaDoOmni` em vez de importá-lo (decisão 14).
- A execução teve desvios de ordem: vermelhos vistos numa cópia do HEAD depois da mutação, hashes das rodadas não anotados e o `--conferir` só na T5 (executor, item 13).

## Apêndice A: mutantes da T1

A tabela abaixo é a saída do `tabela-mutantes-p6.mjs` na rodada oficial da T1.

| # | Mutante | Arquivo | Teste que ficou vermelho — asserção |
|---|---|---|---|
| 1 | catalogo aceita banco de outro agente | `casa/esquemas.mjs` | CB nucleo.db guarda catalogo, instalacoes e maquinas com as travas do desenho — `throws` sem exceção |
| 2 | manifesto aceita lista | `casa/esquemas.mjs` | CB nucleo.db guarda catalogo, instalacoes e maquinas com as travas do desenho — `throws` sem exceção |
| 3 | manifesto quebrado passa | `casa/esquemas.mjs` | CB nucleo.db guarda catalogo, instalacoes e maquinas com as travas do desenho — `throws` sem exceção |
| 4 | catalogo aceita sha curto | `casa/esquemas.mjs` | CB nucleo.db guarda catalogo, instalacoes e maquinas com as travas do desenho — `throws` sem exceção |
| 5 | instalacao aceita sha curto | `casa/esquemas.mjs` | CB nucleo.db guarda catalogo, instalacoes e maquinas com as travas do desenho — `throws` sem exceção |
| 6 | agente pode comecar por digito | `casa/esquemas.mjs` | CB nucleo.db guarda catalogo, instalacoes e maquinas com as travas do desenho — `throws` sem exceção |
| 7 | agente aceita qualquer caractere | `casa/esquemas.mjs` | CB nucleo.db guarda catalogo, instalacoes e maquinas com as travas do desenho — `throws` sem exceção |
| 8 | agente com 41 caracteres | `casa/esquemas.mjs` | CB nucleo.db guarda catalogo, instalacoes e maquinas com as travas do desenho — `throws` sem exceção |
| 9 | maquina aceita maiuscula | `casa/esquemas.mjs` | CB nucleo.db guarda catalogo, instalacoes e maquinas com as travas do desenho — `throws` sem exceção |
| 10 | maquina aceita barra | `casa/esquemas.mjs` | CB nucleo.db guarda catalogo, instalacoes e maquinas com as travas do desenho — `throws` sem exceção |
| 11 | maquina vazia | `casa/esquemas.mjs` | CB nucleo.db guarda catalogo, instalacoes e maquinas com as travas do desenho — `throws` sem exceção |
| 12 | id da instalacao livre | `casa/esquemas.mjs` | CB nucleo.db guarda catalogo, instalacoes e maquinas com as travas do desenho — `throws` sem exceção |
| 13 | raiz vazia | `casa/esquemas.mjs` | CB nucleo.db guarda catalogo, instalacoes e maquinas com as travas do desenho — `throws` sem exceção |
| 14 | maquinas sem diario | `casa/esquemas.mjs` | CB nucleo.db guarda catalogo, instalacoes e maquinas com as travas do desenho — `deepEqual` |
| 15 | instalacoes sem diario | `casa/esquemas.mjs` | CB nucleo.db guarda catalogo, instalacoes e maquinas com as travas do desenho — `deepEqual` |
| 16 | instalacao sem trava de maquina | `casa/esquemas.mjs` | CB nucleo.db guarda catalogo, instalacoes e maquinas com as travas do desenho — `throws` sem exceção |
| 17 | instalacao sem trava de agente | `casa/esquemas.mjs` | CB nucleo.db guarda catalogo, instalacoes e maquinas com as travas do desenho — `throws` sem exceção |

## Apêndice B: mutantes da T2

A tabela abaixo é a saída do `tabela-mutantes-p6.mjs` na rodada oficial da T2.

| # | Mutante | Arquivo | Teste que ficou vermelho — asserção |
|---|---|---|---|
| 1 | nome reservado aceito | `casa/loja-nucleo.mjs` | LN manifesto recusado: agente reservado — `fail` |
| 2 | versao fora do semver aceita | `casa/loja-nucleo.mjs` | LN manifesto recusado: versao fora do semver — `fail`<br>LN registrar recusa raiz relativa e manifesto invalido sem gravar nada — `throws` sem exceção |
| 3 | banco de outro agente aceito | `casa/loja-nucleo.mjs` | LN manifesto recusado: banco de outro agente — `fail` |
| 4 | banco conferido com agente invalido | `casa/loja-nucleo.mjs` | LN manifesto recusado: agente ausente — `equal` ("agente: minusculas, digitos e hifen, comecando por letra, ate 40, fora dos nomes reservados \| banco: precisa ser &lt;agente>.db")<br>LN manifesto que nao e objeto JSON e recusado sem ecoar o conteudo — `deepEqual` |
| 5 | migracoes sem banco aceitas | `casa/loja-nucleo.mjs` | LN manifesto recusado: migracoes sem banco — `fail` |
| 6 | banco sem migracoes aceito | `casa/loja-nucleo.mjs` | LN manifesto recusado: banco sem migracoes — `fail`<br>LN manifesto recusado: migracoes absoluta — `fail`<br>LN manifesto recusado: migracoes que sobe — `fail`<br>LN manifesto recusado: migracoes com barra invertida — `fail`<br>LN manifesto recusado: migracoes com unidade — `fail` |
| 7 | caminho com barra invertida aceito | `casa/loja-nucleo.mjs` | LN manifesto recusado: migracoes com barra invertida — `fail` |
| 8 | caminho absoluto aceito | `casa/loja-nucleo.mjs` | LN manifesto recusado: migracoes absoluta — `fail`<br>LN manifesto recusado: modulo absoluto — `fail` |
| 9 | caminho com unidade aceito | `casa/loja-nucleo.mjs` | LN manifesto recusado: migracoes com unidade — `fail`<br>LN manifesto recusado: roteiro absoluto — `fail` |
| 10 | caminho que sobe aceito | `casa/loja-nucleo.mjs` | LN manifesto recusado: migracoes que sobe — `fail` |
| 11 | requer.node livre | `casa/loja-nucleo.mjs` | LN manifesto recusado: node fora do formato — `fail` |
| 12 | agente requerido sem versao | `casa/loja-nucleo.mjs` | LN manifesto recusado: agente requerido sem versao — `fail` |
| 13 | agente requerido repetido | `casa/loja-nucleo.mjs` | LN manifesto recusado: agente requerido repetido — `fail` |
| 14 | comando vazio aceito | `casa/loja-nucleo.mjs` | LN manifesto recusado: executor sem comando — `fail` |
| 15 | modos vazio aceito | `casa/loja-nucleo.mjs` | LN manifesto recusado: modos vazio — `fail` |
| 16 | modo desconhecido aceito | `casa/loja-nucleo.mjs` | LN manifesto recusado: modo desconhecido — `fail` |
| 17 | modo repetido aceito | `casa/loja-nucleo.mjs` | LN manifesto recusado: modo repetido — `fail` |
| 18 | modulo que nao e html | `casa/loja-nucleo.mjs` | LN manifesto recusado: modulo que nao e html — `fail` |
| 19 | preload que nao e js | `casa/loja-nucleo.mjs` | LN manifesto recusado: preload que nao e js — `fail` |
| 20 | painel sem limite | `casa/loja-nucleo.mjs` | LN manifesto recusado: painel longo — `fail` |
| 21 | api em qualquer host | `casa/loja-nucleo.mjs` | LN manifesto recusado: api em localhost — `fail` |
| 22 | rotas sem api | `casa/loja-nucleo.mjs` | LN manifesto recusado: rotas sem api — `fail` |
| 23 | rota sem ancora final | `casa/loja-nucleo.mjs` | LN manifesto recusado: rota sem ancora final — `fail` |
| 24 | rota fora do v1 | `casa/loja-nucleo.mjs` | LN manifesto recusado: rota fora do v1 — `fail` |
| 25 | rota que nao compila | `casa/loja-nucleo.mjs` | LN manifesto recusado: rota que nao compila — `fail` |
| 26 | metodo livre | `casa/loja-nucleo.mjs` | LN manifesto recusado: metodo desconhecido — `fail` |
| 27 | escopo livre | `casa/loja-nucleo.mjs` | LN manifesto recusado: escopo desconhecido — `fail` |
| 28 | id de tarefa fora do formato | `casa/loja-nucleo.mjs` | LN manifesto recusado: tarefa com id fora do formato — `fail` |
| 29 | id de tarefa repetido | `casa/loja-nucleo.mjs` | LN manifesto recusado: tarefa com id repetido — `fail` |
| 30 | diaria e acada juntas | `casa/loja-nucleo.mjs` | LN manifesto recusado: tarefa com diaria e acada — `fail` |
| 31 | hora fora do relogio | `casa/loja-nucleo.mjs` | LN manifesto recusado: hora fora do relogio — `fail` |
| 32 | intervalo zero | `casa/loja-nucleo.mjs` | LN manifesto recusado: intervalo zero — `fail` |
| 33 | intervalo em segundos | `casa/loja-nucleo.mjs` | LN manifesto recusado: intervalo em segundos — `fail` |
| 34 | seAtrasada nao booleano | `casa/loja-nucleo.mjs` | LN manifesto recusado: seAtrasada que nao e booleano — `fail` |
| 35 | comando e lancador juntos | `casa/loja-nucleo.mjs` | LN manifesto recusado: tarefa com comando e lancador — `fail` |
| 36 | nem comando nem lancador | `casa/loja-nucleo.mjs` | LN manifesto recusado: tarefa sem comando nem lancador — `equal` ("tarefas[1].lancador: so o omni lanca roteiro \| tarefas[1].roteiro: caminho relativo") |
| 37 | lancador de outro agente | `casa/loja-nucleo.mjs` | LN manifesto recusado: lancador que nao e o omni — `fail` |
| 38 | roteiro absoluto | `casa/loja-nucleo.mjs` | LN manifesto recusado: roteiro absoluto — `fail` |
| 39 | variavel fora do formato | `casa/loja-nucleo.mjs` | LN manifesto recusado: variavel minuscula — `fail`<br>LN manifesto recusado: variavel repetida — `fail` |
| 40 | lista com repeticao | `casa/loja-nucleo.mjs` | LN manifesto recusado: variavel repetida — `fail`<br>LN manifesto recusado: credencial repetida — `fail` |
| 41 | credencial fora do formato | `casa/loja-nucleo.mjs` | LN manifesto recusado: credencial fora do formato — `fail`<br>LN manifesto recusado: credencial repetida — `fail` |
| 42 | manifesto que nao e objeto | `casa/loja-nucleo.mjs` | LN manifesto que nao e objeto JSON e recusado sem ecoar o conteudo — `deepEqual` ("[]") |
| 43 | BOM recusado | `casa/loja-nucleo.mjs` | LN manifesto completo e minimo passam; o sha e dos bytes crus e o texto gravado e o objeto lido — `doesNotThrow` |
| 44 | sha do texto e nao dos bytes | `casa/loja-nucleo.mjs` | LN manifesto completo e minimo passam; o sha e dos bytes crus e o texto gravado e o objeto lido — `equal`<br>LN registrar e idempotente: o mesmo manifesto na mesma raiz nao sobe versao nem gera diario — `equal` |
| 45 | texto gravado cru | `casa/loja-nucleo.mjs` | LN manifesto completo e minimo passam; o sha e dos bytes crus e o texto gravado e o objeto lido — `equal`<br>LN registrar e idempotente: o mesmo manifesto na mesma raiz nao sobe versao nem gera diario — `equal` |
| 46 | lerManifesto aceita raiz relativa | `casa/loja-nucleo.mjs` | LN lerManifesto le executor/agente.json da raiz absoluta e recusa o que nao serve — `throws` com outro erro |
| 47 | manifesto sem limite de tamanho | `casa/loja-nucleo.mjs` | LN lerManifesto le executor/agente.json da raiz absoluta e recusa o que nao serve — `throws` sem exceção |
| 48 | registrar aceita raiz relativa | `casa/loja-nucleo.mjs` | LN registrar recusa raiz relativa e manifesto invalido sem gravar nada — `throws` sem exceção |
| 49 | maquina maiuscula aceita | `casa/loja-nucleo.mjs` | LN registrarMaquina so sobe a versao quando nome ou sistema mudam — `throws` com outro erro |
| 50 | catalogo sobe sempre | `casa/loja-nucleo.mjs` | LN registrar e idempotente: o mesmo manifesto na mesma raiz nao sobe versao nem gera diario — `deepEqual`<br>LN manifesto novo sobe a versao do catalogo e da instalacao; raiz nova sobe so a instalacao — `deepEqual`<br>LN retirar poe lapide so na instalacao desta maquina; reinstalar revive a linha — `deepEqual` |
| 51 | catalogo com lapide nao revive | `casa/loja-nucleo.mjs` | LN lapide no catalogo vinda de outra maquina e revivida quando alguem registra de novo — `deepEqual` |
| 52 | raiz nova ignorada | `casa/loja-nucleo.mjs` | LN manifesto novo sobe a versao do catalogo e da instalacao; raiz nova sobe so a instalacao — `deepEqual` |
| 53 | manifesto novo ignorado na instalacao | `casa/loja-nucleo.mjs` | LN manifesto novo sobe a versao do catalogo e da instalacao; raiz nova sobe so a instalacao — `deepEqual` |
| 54 | instalacao com lapide nao revive | `casa/loja-nucleo.mjs` | LN retirar poe lapide so na instalacao desta maquina; reinstalar revive a linha — `deepEqual` |
| 55 | nome da maquina ignorado | `casa/loja-nucleo.mjs` | LN registrarMaquina so sobe a versao quando nome ou sistema mudam — `deepEqual` |
| 56 | sistema da maquina ignorado | `casa/loja-nucleo.mjs` | LN registrarMaquina so sobe a versao quando nome ou sistema mudam — `deepEqual` |
| 57 | visto_em parado | `casa/loja-nucleo.mjs` | LN registrar e idempotente: o mesmo manifesto na mesma raiz nao sobe versao nem gera diario — `equal` |
| 58 | retirar duas vezes | `casa/loja-nucleo.mjs` | LN retirar poe lapide so na instalacao desta maquina; reinstalar revive a linha — `throws` sem exceção |
| 59 | listar mostra lapide | `casa/loja-nucleo.mjs` | LN retirar poe lapide so na instalacao desta maquina; reinstalar revive a linha — `deepEqual` |
| 60 | listar mistura maquinas | `casa/loja-nucleo.mjs` | LN cada maquina tem a propria instalacao; o catalogo e de todas e o ultimo registrado vence — `deepEqual`<br>LN retirar poe lapide so na instalacao desta maquina; reinstalar revive a linha — `deepEqual` |
| 61 | catalogo nunca diverge | `casa/loja-nucleo.mjs` | LN cada maquina tem a propria instalacao; o catalogo e de todas e o ultimo registrado vence — `deepEqual` |
| 62 | maquina conta lapide | `casa/loja-nucleo.mjs` | LN retirar poe lapide so na instalacao desta maquina; reinstalar revive a linha — `equal` |
| 63 | catalogo com lapide aparece | `casa/loja-nucleo.mjs` | LN lapide no catalogo vinda de outra maquina e revivida quando alguem registra de novo — `equal` |

## Apêndice C: mutantes da T3

A tabela abaixo é a saída do `tabela-mutantes-p6.mjs` na rodada oficial da T3.

| # | Mutante | Arquivo | Teste que ficou vermelho — asserção |
|---|---|---|---|
| 1 | uso errado sai com 1 | `nucleo.mjs` | NC uso errado sai com 2, mostra o uso e nunca ecoa o argumento — `equal` ("[]")<br>NC roda direto pela linha de comando — `equal` |
| 2 | uso some do stderr | `nucleo.mjs` | NC uso errado sai com 2, mostra o uso e nunca ecoa o argumento — `match` |
| 3 | recusa sai com 1 | `nucleo.mjs` | NC verificar confere o manifesto sem abrir o banco — `equal`<br>NC registrar, listar, maquinas e retirar fazem o ciclo da instalação — `equal`<br>NC registrar recusa manifesto inválido sem gravar nada — `equal` |
| 4 | recusa sem a lista de erros | `nucleo.mjs` | NC verificar confere o manifesto sem abrir o banco — `equal`<br>NC registrar recusa manifesto inválido sem gravar nada — `deepEqual` |
| 5 | codigo da recusa troca | `nucleo.mjs` | NC verificar confere o manifesto sem abrir o banco — `equal`<br>NC registrar, listar, maquinas e retirar fazem o ciclo da instalação — `equal` |
| 6 | falha inesperada sai com 3 | `nucleo.mjs` | NC falha inesperada sai com 1 e fica anotada nas degradações — `equal` |
| 7 | degradacao com outra operacao | `nucleo.mjs` | NC falha inesperada sai com 1 e fica anotada nas degradações — `deepEqual` |
| 8 | degradacao nao anotada | `nucleo.mjs` | NC falha inesperada sai com 1 e fica anotada nas degradações — `ok` ("a falha inesperada fica anotada") |
| 9 | mensagem da falha inesperada | `nucleo.mjs` | NC falha inesperada sai com 1 e fica anotada nas degradações — `match` |
| 10 | falta o comando vira desconhecido | `nucleo.mjs` | NC uso errado sai com 2, mostra o uso e nunca ecoa o argumento — `match` |
| 11 | opcao estranha aceita | `nucleo.mjs` | NC uso errado sai com 2, mostra o uso e nunca ecoa o argumento — `equal` ("["listar","--segredo=valor-que-nao-volta"]") |
| 12 | posicional aceito | `nucleo.mjs` | NC uso errado sai com 2, mostra o uso e nunca ecoa o argumento — `equal` ("["listar","solto"]") |
| 13 | obrigatoria vazia aceita | `nucleo.mjs` | NC uso errado sai com 2, mostra o uso e nunca ecoa o argumento — `equal` ("["verificar","--raiz",""]") |
| 14 | verificar sem raiz obrigatoria | `nucleo.mjs` | NC uso errado sai com 2, mostra o uso e nunca ecoa o argumento — `equal` ("["verificar","--raiz",""]") |
| 15 | registrar sem raiz obrigatoria | `nucleo.mjs` | NC uso errado sai com 2, mostra o uso e nunca ecoa o argumento — `equal` ("["registrar"]") |
| 16 | retirar sem agente obrigatorio | `nucleo.mjs` | NC uso errado sai com 2, mostra o uso e nunca ecoa o argumento — `equal` ("["retirar"]") |
| 17 | verificar abre o banco | `nucleo.mjs` | NC verificar confere o manifesto sem abrir o banco — `ok` ("verificar não cria o nucleo.db") |
| 18 | verificar sem sha | `nucleo.mjs` | NC verificar confere o manifesto sem abrir o banco — `match` |
| 19 | verificar troca o agente | `nucleo.mjs` | NC verificar confere o manifesto sem abrir o banco — `deepEqual` |
| 20 | raiz relativa nao resolvida | `nucleo.mjs` | NC a raiz relativa vale a partir da pasta atual — `equal` ("{"ok":false,"codigo":"dados-invalidos","erro":"A raiz do agente precisa ser um caminho absoluto.","erros":[]}") |
| 21 | registrar sem ok | `nucleo.mjs` | NC registrar, listar, maquinas e retirar fazem o ciclo da instalação — `deepEqual`<br>NC a raiz relativa vale a partir da pasta atual — `match` |
| 22 | retirar sem o resultado | `nucleo.mjs` | NC registrar, listar, maquinas e retirar fazem o ciclo da instalação — `deepEqual` |
| 23 | listar ignora a maquina | `nucleo.mjs` | NC registrar, listar, maquinas e retirar fazem o ciclo da instalação — `deepEqual` |
| 24 | maquinas vazia | `nucleo.mjs` | NC registrar, listar, maquinas e retirar fazem o ciclo da instalação — `deepEqual` |
| 25 | maquina sempre muda | `nucleo.mjs` | NC maquina registra esta máquina e só muda na primeira vez — `deepEqual` |
| 26 | casa ignora OMNI_HOME relativo | `nucleo.mjs` | NC casaDoNucleo é a mesma casa do Omni — `equal` ("{"OMNI_HOME":"rel/x"}") |
| 27 | casa em outra pasta do APPDATA | `nucleo.mjs` | NC casaDoNucleo é a mesma casa do Omni — `equal` ("{"APPDATA":"C:\\A"}") |
| 28 | sem APPDATA cai fora do home | `nucleo.mjs` | NC casaDoNucleo é a mesma casa do Omni — `equal` ("{}") |
| 29 | execucao direta le o argv errado | `nucleo.mjs` | NC roda direto pela linha de comando — `equal` ("comando desconhecido")<br>NC a raiz relativa vale a partir da pasta atual — `equal` ("comando desconhecido") |
| 30 | execucao direta desligada | `nucleo.mjs` | NC roda direto pela linha de comando — `match`<br>NC a raiz relativa vale a partir da pasta atual — `match` |
