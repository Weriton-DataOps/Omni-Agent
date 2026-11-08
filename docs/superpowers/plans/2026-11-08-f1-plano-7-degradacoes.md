# F1, plano 7: diagnóstico que lê degradacoes.jsonl — plano de implementação

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** o diagnóstico do Omni passa a dizer se a casa está degradando (§3.6): quantas vezes cada operação caiu para o arquivo, quando foi a última e com que erro, sem abrir o banco e sem criar nada.

**Arquitetura:** um leitor novo (`runtime/casa/degradacoes.mjs`) que lê só a cauda do `degradacoes.jsonl` gravado pelo `registrarDegradacao` do `banco.mjs`, na mesma pasta do banco (`pastaDoBanco`), aceita só as linhas com a forma exata que o gravador escreve e devolve um resumo por operação. O `diagnosticarRuntime` de `runtime/diagnostico.mjs` ganha o campo `degradacoes`, lido com o mesmo `env` do diagnóstico.

**Tecnologia:** Node ≥ 22.13, `node:fs/promises` (`open`), `node:test`. Nenhuma dependência npm nova; o leitor não usa `node:sqlite`.

**Desenho:** [Casa única: Omni, Overcore e Oráculo](../specs/2026-11-04-casa-unica-tres-agentes-design.md): §3.6 ("Degradação, nunca queda": o registro, as operações da memória e o que cada linha leva), §3.8 (as operações dos estados) e §3 (a pasta do banco fora do Roaming).

**Situação em 08/11/2026:** PreparaÃ§Ã£o e tarefas 1 a 3 executadas, e a T4 em curso. Na T1, 9 testes verdes e 38 mutantes, 37 vermelhos pela asserÃ§Ã£o e 1 declarado equivalente; na T2, 5 testes verdes e 3 mutantes vermelhos, e o furo do `check` fechado para o leitor e o diagnÃ³stico. Na T3, o verify com 899 testes e sÃ³ o vermelho de nascenÃ§a `:165`, e o `.test-dist`, o `test:dist` e o `verify:build` verdes Ã  parte. A execuÃ§Ã£o teve desvios de ordem, declarados no item 11 do executor e nos resultados.

---

## Posição na F1

Este é o plano 7 dos oito da F1 ([escopo no plano 1](2026-11-04-f1-casa-sqlite.md#escopo-a-f1-em-oito-planos)). O plano 6 deixou o núcleo da casa (`25d0160`). Desde o plano 1, toda operação da casa que cai para o arquivo anota uma linha em `degradacoes.jsonl`; até aqui ninguém lia esse registro. Este plano é o leitor, e o diagnóstico é o único consumidor.

Fica fora deste plano:
- rodar o registro: ele cresce só com falhas, e uma casa saudável não escreve nele. A leitura limitada à cauda (decisão 3) protege o diagnóstico de um registro grande; apagar ou girar linhas antigas é uma escrita, e o diagnóstico é só leitura;
- mostrar as degradações na ilha. O resumo sai pelo `diagnostico` da CLI do Omni; o card que o mostraria depende do `servir` da F2;
- avisar o Weriton quando uma operação degrada muito. Isso é política de alerta, e mora nos vigias, não no diagnóstico;
- a ativação na casa real, que só acontece depois do merge, com o ok do Weriton.

## Decisões (dentro do desenho, sem autoridade nova)

1. **Só leitura, e nada criado.** O leitor abre só o próprio arquivo, em modo `r`. Registro ausente devolve o resumo vazio com `registro: 'ausente'`, e a pasta do banco não é criada: o diagnóstico de uma casa sem banco não pode ser o que cria o banco. Nada de `node:sqlite`: o leitor serve também onde o SQLite não existe, e é lá que a degradação mais acontece (mutante 22 da T1; CD 1, DG 3 e DG 4).
2. **A pasta é a do gravador.** O caminho sai do `pastaDoBanco(casa, env)` do `banco.mjs`, o mesmo que o `registrarDegradacao` usa, com o `OMNI_CASA_BANCO` e a regra da casa de produção. O diagnóstico passa o próprio `env` adiante (mutante 24 da T1 e 40 e 41 da T2; CD 9 e DG 4).
3. **Só a cauda, de até 256 KiB** (`LIMITE_LEITURA`), numa leitura só. Para saber se a cauda começa no meio de uma linha, o leitor lê também o byte anterior a ela: se não for `\n`, a primeira linha da cauda está cortada e é descartada inteira, nunca contada como inválida. A última linha sem `\n` no fim também fica de fora quando a cauda inteira é ela. O resumo diz o tamanho do arquivo (`bytes`) e se a leitura foi cortada (`truncado`) (mutantes 01 e 16 a 20 da T1; CD 5 a 7).
4. **Uma linha só vale com a forma exata do gravador.** `em` tem de voltar idêntica do `toISOString`, que é como o gravador escreve a data: isso recusa de uma vez o que não é texto, o que não é data e a data sem os milissegundos. `operacao` é texto de até 60 caracteres no formato `familia.acao` (`^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$`), que casa todas as operações gravadas hoje (`memoria.*`, `estado.*`, `estados.varredura`, `documentos.*`, `cofre.cli`, `nucleo.cli`, `contadores.varredura`). O resto é inválido: conta em `linhasInvalidas` e não entra no resumo. Linha em branco não conta para nada (mutantes 03 a 06, 12 a 14, 26, 27 e 38 da T1; CD 4).
5. **Nada sai que o gravador não escreva.** Cada linha válida é refeita só com a data, a operação, o código e o erro: campo a mais nunca sai. `codigo` fora do formato dos códigos de erro do Node e do SQLite (`^[A-Z][A-Z0-9_]{0,39}$`) vira `null`; `erro` que não é texto vira `''`, e o texto é cortado em 300 caracteres, o mesmo limite do gravador. Uma linha inválida nunca ecoa trecho dela (mutantes 07 a 11 da T1; CD 3 e CD 4).
6. **O resumo.** `linhas`, `linhasInvalidas`, `nas24h` (a fronteira das 24 horas conta) e `ultimaEm`; por operação, `total`, `nas24h`, `primeiraEm`, `ultimaEm`, `ultimoCodigo` e `ultimoErro`. A ordem do arquivo não importa, porque o relógio de duas máquinas pode ir e voltar; no empate de data, vence a linha mais adiante no arquivo, que é a gravada por último. As operações saem da mais recente para a mais antiga. O relógio padrão é o de agora, e o teste fixa o seu (mutantes 02, 25 e 28 a 37 da T1; CD 2 e CD 3).
7. **Ilegível nunca lança.** Pasta no lugar do arquivo, falta de permissão ou qualquer erro de leitura devolve o resumo vazio com `registro: 'ilegivel'` e o código do erro, quando ele é texto. O diagnóstico não pode cair por causa do registro de quedas (mutantes 15 e 23 da T1; CD 8).
8. **O diagnóstico ganha `degradacoes`.** O campo entra logo depois de `failures`, sem mudar nenhum outro; o `diagnosticarRuntime` continua sem migração, sincronização nem escrita (mutantes 39 a 41 da T2; DG 3 e DG 4).
9. **O fechamento do arquivo é declarado equivalente.** Tirar o `fh.close()` não é visto por nenhum teste: no Windows o libuv abre com `FILE_SHARE_DELETE`, a casa temporária é apagada mesmo com o arquivo aberto, e o coletor de lixo fecha o descritor depois. O `finally` fica, porque é o certo, e a tabela registra o mutante 21 como equivalente.
10. **O `check` alcança os dois módulos.** A T2 acrescenta `runtime/casa/degradacoes.mjs` e `runtime/diagnostico.mjs` ao `node --check` do `npm run check`, com o furo visto antes e fechado depois. O `runtime/diagnostico.mjs` já existia e também não estava lá.

## Mapa de arquivos

| Arquivo | Responsabilidade | Tarefa | Importa |
|---|---|---|---|
| `runtime/casa/degradacoes.mjs` (novo) | `lerDegradacoes` e `LIMITE_LEITURA` | T1 | `node:fs/promises`, `node:path`, `./banco.mjs` |
| `runtime/diagnostico.mjs` (modificado) | O campo `degradacoes` no `diagnosticarRuntime` | T2 | `./casa/degradacoes.mjs` (novo) |
| `package.json` (modificado) | `node --check` do leitor e do diagnóstico no `npm run check` | T2 | — |
| `testes/casa-degradacoes.test.mjs` (novo) | CD, 9 testes | T1 | — |
| `testes/diagnostico.test.mjs` (modificado) | DG, de 4 para 5 testes | T2 | — |
| `docs/superpowers/plans/2026-11-04-f1-casa-sqlite.md` (modificado) | Linha 7 do escopo | T4 | — |

- O leitor importa do `banco.mjs` só o `pastaDoBanco`. O `banco.mjs` carrega o `node:sqlite` sob demanda, então importar o leitor não abre banco nenhum.
- `runtime/` entra no payload; `testes/` fica fora.
- Siglas: CD = `testes/casa-degradacoes.test.mjs` e DG = `testes/diagnostico.test.mjs`. "CD 3" é o terceiro teste da CD: o número é sempre a posição no arquivo.
- A T1 acrescenta 9 testes (CD): o verify passa de 889 para 898. A T2 acrescenta 1 (DG 4, e o DG 3 passa a conferir o registro ausente): 899 (T3, Passo 1).

## O que o executor precisa saber antes de rodar qualquer coisa

1. **Casa real intocável.** A CD e o DG gravam e leem numa casa temporária, com `env` vazio ou com o `OMNI_CASA_BANCO` dentro dela.
2. **Guarda.** `Test-Path "$env:LOCALAPPDATA\omni\casa"` dá `False` antes e depois de cada rodada (T1 a T3).
3. **Vermelho de nascença `:165`.** Arquivo novo em `runtime/` muda o fingerprint do payload. A T3 anota o valor calculado e o plano 8 regenera o contrato.
4. **As checagens do repositório não alcançam os módulos** (plano 4, item 9). A T2 fecha o furo para os dois (decisão 10).
5. **Fim de linha.** Arquivo novo é escrito com LF (o extrator grava LF), e antes do commit nenhum arquivo deste plano pode ter CR (T4).
6. **O código mora no plano** (plano 4, item 16). Nenhum plano anterior emitiu o `runtime/diagnostico.mjs`, o `testes/diagnostico.test.mjs` nem o `package.json`, então nenhum `--conferir` antigo passa a dar `DIVERGE` por causa deste. O `package.json` muda por troca de trecho, como nos planos 4 e 6.
7. **Shell:** item 10 do plano 2. `$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'` em todas as tarefas. Cada chamada do PowerShell é um processo novo, então cada bloco redeclara o que usa.
8. **Identidade:** item 11 do plano 2.
9. **CI:** o log do job vermelho vem por `gh api repos/<dono>/<repo>/actions/jobs/<job>/logs` (plano 4, T9).
10. **Dados de teste fictícios.** O repositório é público: as linhas de teste usam operações e erros inventados, e o "segredo" que a CD procura no resultado é o texto `segredo-ficticio`.
11. **A execução real teve desvios de ordem**, todos sem efeito no código que entra no commit:
    - os quatro arquivos foram escritos direto no worktree, e não extraídos do plano, que ainda não existia; o vermelho de cada tarefa foi visto no worktree, antes do módulo da tarefa. O plano foi montado depois a partir deles, e o `--conferir` da T4 prova que os blocos são os arquivos;
    - o vermelho da T2 foi visto antes de as asserções do DG ganharem o `?.`: DG 3 e DG 4 caíram por `TypeError`, e não pela asserção. Com o `?.`, o mesmo vermelho cai por `AssertionError`, e os três mutantes da T2 provam isso;
    - a primeira rodada de mutantes da T1 deixou três sobreviventes (o relógio padrão, o limite medido pelo próprio export e o fechamento do arquivo) e duas mortes por exceção, e não pela asserção. A CD ganhou a linha antiga do CD 3, a conferência do `LIMITE_LEITURA` no CD 5 e o `assert.doesNotReject` no CD 4; o módulo perdeu uma checagem de data e outra de lista que eram equivalentes, e passou a ler a cauda numa leitura só. A rodada oficial é a dos arquivos deste plano, com o 21 declarado equivalente (decisão 9);
    - as listas de mutantes foram geradas por script, e os hashes antes e depois de cada rodada foram conferidos no terminal, sem o arquivo de hashes no `$rascunho`;
    - o `--conferir` de cada tarefa não rodou, porque o plano ainda não existia: ele roda inteiro na T4;
    - os dois arquivos que já existiam (o diagnóstico e o DG) estavam com CRLF no worktree, pela conversão do checkout, e o extrator compara byte a byte: na T4 eles passaram a LF, sem mudança no índice, e a lista da T2 ganhou o `\n` final.

## Ferramentas

O extrator grava no repositório os blocos `arquivo=` e no `$rascunho` os blocos `rascunho=`. É o mesmo dos planos 3 a 6, sem mudança, e o executor de mutantes é o do plano 4, também sem mudança: a primeira linha do comentário ainda diz "plano 4" porque o arquivo é o mesmo, byte a byte. A tabela é a do plano 6 com as siglas deste plano.

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

```js rascunho=tabela-mutantes-p7.mjs
// Monta a tabela de mutantes do plano 7 a partir de <lista>.json e <lista>.saida.jsonl e grava <lista>.tabela.md.
// Uso: node tabela-mutantes-p7.mjs <lista.json>. Derruba a tabela (saída 1) se faltar linha, se um mutante não
// ficar vermelho sem estar declarado equivalente (campo equivalente da lista, com a razão), se uma queda não for
// AssertionError com ERR_ASSERTION ou se vier de suíte fora das do mutante.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [listaArg] = process.argv.slice(2)
if (!listaArg) { console.error('uso: node tabela-mutantes-p7.mjs <lista.json>'); process.exit(2) }
const caminhoLista = resolve(listaArg)
const lista = JSON.parse(readFileSync(caminhoLista, 'utf8'))
const linhas = readFileSync(caminhoLista.replace(/\.json$/, '.saida.jsonl'), 'utf8').split('\n').filter(Boolean).map((linha) => JSON.parse(linha))
const EQUIVALENTES = new Map(lista.filter((m) => typeof m.equivalente === 'string').map((m) => [m.nome, m.equivalente]))
const SIGLAS = new Map([
  ['testes/casa-degradacoes.test.mjs', 'CD'], ['testes/diagnostico.test.mjs', 'DG']
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
$plano = 'docs\superpowers\plans\2026-11-08-f1-plano-7-degradacoes.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --conferir --so extrair-do-plano.mjs mutantes.mjs; "saida: $LASTEXITCODE"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `igual extrair-do-plano.mjs`, `igual mutantes.mjs`, `saida: 0` e `False`. Se o extrator não estiver no `$rascunho`, ele é criado à mão com o bloco acima e conferido de novo.

Resultado (08/11): os dois já estavam no `$rascunho`, iguais aos do plano 6; a conferência contra este plano roda na T4 (executor, item 11). `False`.

### Task 1: o leitor do registro

**Arquivos:** criar `testes/casa-degradacoes.test.mjs` (CD, 9 testes) e `runtime/casa/degradacoes.mjs`.

- [x] **Passo 1: o teste.**

```js arquivo=testes/casa-degradacoes.test.mjs
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { registrarDegradacao } from '../runtime/casa/banco.mjs'
import { LIMITE_LEITURA, lerDegradacoes } from '../runtime/casa/degradacoes.mjs'

// Casa temporária e env vazio: o registro mora em <casa>\casa e a casa real nunca é tocada.
async function comCasa(uso) {
  const casa = mkdtempSync(join(tmpdir(), 'omni-degradacoes-'))
  try { await uso(casa) } finally { rmSync(casa, { recursive: true, force: true }) }
}
const registroDa = (casa) => join(casa, 'casa', 'degradacoes.jsonl')
function gravar(arquivo, linhas) {
  mkdirSync(dirname(arquivo), { recursive: true })
  writeFileSync(arquivo, linhas.map((linha) => `${typeof linha === 'string' ? linha : JSON.stringify(linha)}\n`).join(''))
}
const AGORA = new Date('2026-11-08T12:00:00.000Z')
const vazio = (registro, codigo = null) => ({ registro, codigo, bytes: 0, truncado: false, linhas: 0, linhasInvalidas: 0, nas24h: 0, ultimaEm: null, operacoes: [] })

test('registro ausente devolve o resumo vazio e nao cria a pasta do banco', () => comCasa(async (casa) => {
  assert.deepEqual(await lerDegradacoes(casa, {}), vazio('ausente'))
  assert.deepEqual(readdirSync(casa), [])
}))

test('resume por operacao com a ultima falha de cada uma e as das ultimas 24 horas', () => comCasa(async (casa) => {
  gravar(registroDa(casa), [
    { em: '2026-11-08T09:00:00.000Z', operacao: 'estado.gravar', codigo: null, erro: 'disco cheio' },
    { em: '2026-11-06T10:00:00.000Z', operacao: 'memoria.carregar', codigo: 'SQLITE_BUSY', erro: 'database is locked' },
    { em: '2026-11-08T11:00:00.000Z', operacao: 'memoria.carregar', codigo: 'SQLITE_CANTOPEN', erro: 'unable to open database file' },
    { em: '2026-11-07T11:59:59.999Z', operacao: 'estado.gravar', codigo: 'ENOSPC', erro: 'sem espaco' },
    { em: '2026-11-07T12:00:00.000Z', operacao: 'estado.gravar', codigo: 'ENOSPC', erro: 'sem espaco' },
    { em: '2026-11-08T11:00:00.000Z', operacao: 'memoria.carregar', codigo: 'SQLITE_BUSY', erro: 'database is locked' }
  ])
  assert.deepEqual(await lerDegradacoes(casa, {}, { agora: AGORA }), {
    registro: 'presente', codigo: null, bytes: statSync(registroDa(casa)).size, truncado: false,
    linhas: 6, linhasInvalidas: 0, nas24h: 4, ultimaEm: '2026-11-08T11:00:00.000Z',
    operacoes: [
      { operacao: 'memoria.carregar', total: 3, nas24h: 2, primeiraEm: '2026-11-06T10:00:00.000Z', ultimaEm: '2026-11-08T11:00:00.000Z', ultimoCodigo: 'SQLITE_BUSY', ultimoErro: 'database is locked' },
      { operacao: 'estado.gravar', total: 3, nas24h: 2, primeiraEm: '2026-11-07T11:59:59.999Z', ultimaEm: '2026-11-08T09:00:00.000Z', ultimoCodigo: null, ultimoErro: 'disco cheio' }
    ]
  })
}))

test('le o que o registrarDegradacao grava, sem trecho do texto lido', () => comCasa(async (casa) => {
  registrarDegradacao(casa, 'memoria.carregar', Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' }), {})
  let quebra
  try { JSON.parse('{"segredo-ficticio": ') } catch (erro) { quebra = erro }
  registrarDegradacao(casa, 'estado.gravar', quebra, {})
  // Uma linha antiga que só fica fora das 24 horas se o relógio padrão for o de agora.
  writeFileSync(registroDa(casa), `${JSON.stringify({ em: '2020-01-01T00:00:00.000Z', operacao: 'nucleo.cli', codigo: null, erro: 'antiga' })}\n`, { flag: 'a' })
  const resumo = await lerDegradacoes(casa, {})
  assert.deepEqual([resumo.registro, resumo.linhas, resumo.linhasInvalidas, resumo.nas24h], ['presente', 3, 0, 2])
  const porNome = resumo.operacoes.map(({ operacao, total, ultimoCodigo, ultimoErro }) => ({ operacao, total, ultimoCodigo, ultimoErro }))
  porNome.sort((a, b) => a.operacao.localeCompare(b.operacao))
  assert.deepEqual(porNome, [
    { operacao: 'estado.gravar', total: 1, ultimoCodigo: null, ultimoErro: 'JSON inválido' },
    { operacao: 'memoria.carregar', total: 1, ultimoCodigo: 'SQLITE_BUSY', ultimoErro: 'database is locked' },
    { operacao: 'nucleo.cli', total: 1, ultimoCodigo: null, ultimoErro: 'antiga' }
  ])
  assert.equal(JSON.stringify(resumo).includes('segredo-ficticio'), false)
}))

test('linha fora do formato do gravador conta como invalida e nada alem dos quatro campos sai', () => comCasa(async (casa) => {
  const opLonga = `a.${'b'.repeat(58)}`
  gravar(registroDa(casa), [
    '{quebrado',
    '[1]',
    'null',
    { em: 'ontem', operacao: 'memoria.carregar', codigo: null, erro: '' },
    { em: '2026-13-01T00:00:00.000Z', operacao: 'memoria.carregar', codigo: null, erro: '' },
    { em: '2026-11-08T10:00:00Z', operacao: 'memoria.carregar', codigo: null, erro: '' },
    { em: '2026-11-08T10:00:00.000Z', operacao: 'Memoria.carregar', codigo: null, erro: '' },
    { em: '2026-11-08T10:00:00.000Z', operacao: 'memoria', codigo: null, erro: '' },
    { em: '2026-11-08T10:00:00.000Z', operacao: `${opLonga}b`, codigo: null, erro: '' },
    { em: '2026-11-08T10:00:00.000Z', operacao: ['estado.gravar'], codigo: null, erro: '' },
    '',
    '   ',
    { em: '2026-11-08T10:00:00.000Z', operacao: 'estado.gravar', codigo: 'minusculo', erro: 'x'.repeat(400), trecho: 'segredo-ficticio' },
    { em: '2026-11-08T09:00:00.000Z', operacao: 'estado.copia', codigo: ['SQLITE_BUSY'], erro: { texto: 'segredo-ficticio' } },
    { em: '2026-11-08T08:00:00.000Z', operacao: opLonga, codigo: `S${'Q'.repeat(39)}`, erro: 'ok' },
    { em: '2026-11-08T07:00:00.000Z', operacao: 'estado.projetar', codigo: `E${'X'.repeat(40)}`, erro: 'longo' }
  ])
  // Linha ruim nunca derruba a leitura: ela só é contada.
  const leitura = lerDegradacoes(casa, {}, { agora: AGORA })
  await assert.doesNotReject(leitura)
  const resumo = await leitura
  assert.deepEqual([resumo.linhas, resumo.linhasInvalidas, resumo.nas24h, resumo.ultimaEm], [4, 10, 4, '2026-11-08T10:00:00.000Z'])
  const uma = (operacao, em, ultimoCodigo, ultimoErro) => ({ operacao, total: 1, nas24h: 1, primeiraEm: em, ultimaEm: em, ultimoCodigo, ultimoErro })
  assert.deepEqual(resumo.operacoes, [
    uma('estado.gravar', '2026-11-08T10:00:00.000Z', null, 'x'.repeat(300)),
    uma('estado.copia', '2026-11-08T09:00:00.000Z', null, ''),
    uma(opLonga, '2026-11-08T08:00:00.000Z', `S${'Q'.repeat(39)}`, 'ok'),
    uma('estado.projetar', '2026-11-08T07:00:00.000Z', null, 'longo')
  ])
  const texto = JSON.stringify(resumo)
  assert.equal(texto.includes('segredo-ficticio') || texto.includes('quebrado'), false)
}))

test('registro maior que o limite le so a cauda e descarta a linha cortada', () => comCasa(async (casa) => {
  assert.equal(LIMITE_LEITURA, 256 * 1024)
  const linhas = [{ em: '2026-11-08T08:00:00.000Z', operacao: 'memoria.carregar', codigo: null, erro: 'x'.repeat(LIMITE_LEITURA) }]
  for (let i = 0; i < 3; i++) linhas.push({ em: `2026-11-08T1${i}:00:00.000Z`, operacao: 'estado.gravar', codigo: null, erro: `falha ${i}` })
  gravar(registroDa(casa), linhas)
  const resumo = await lerDegradacoes(casa, {}, { agora: AGORA })
  assert.deepEqual([resumo.bytes, resumo.truncado, resumo.linhas, resumo.linhasInvalidas], [statSync(registroDa(casa)).size, true, 3, 0])
  assert.deepEqual(resumo.operacoes.map(({ operacao, total, ultimoErro }) => [operacao, total, ultimoErro]), [['estado.gravar', 3, 'falha 2']])
}))

test('cauda que comeca no inicio de uma linha nao perde essa linha', () => comCasa(async (casa) => {
  const TAMANHO = 128
  assert.equal(LIMITE_LEITURA % TAMANHO, 0)
  const base = { em: '2026-11-08T10:00:00.000Z', operacao: 'estado.gravar', codigo: null }
  const vaga = TAMANHO - 1 - JSON.stringify({ ...base, erro: '' }).length
  const linhas = [{ em: '2026-11-08T09:00:00.000Z', operacao: 'memoria.carregar', codigo: null, erro: 'antes da cauda' }]
  for (let i = 0; i < LIMITE_LEITURA / TAMANHO; i++) linhas.push({ ...base, erro: String(i).padStart(vaga, '0') })
  gravar(registroDa(casa), linhas)
  const resumo = await lerDegradacoes(casa, {}, { agora: AGORA })
  assert.deepEqual([resumo.truncado, resumo.linhas, resumo.linhasInvalidas], [true, LIMITE_LEITURA / TAMANHO, 0])
  assert.deepEqual(resumo.operacoes.map(({ operacao, total }) => [operacao, total]), [['estado.gravar', LIMITE_LEITURA / TAMANHO]])
}))

test('ultima linha maior que o limite e sem quebra nao vira linha invalida', () => comCasa(async (casa) => {
  gravar(registroDa(casa), [{ em: '2026-11-08T09:00:00.000Z', operacao: 'memoria.carregar', codigo: null, erro: 'inteira' }])
  writeFileSync(registroDa(casa), 'x'.repeat(LIMITE_LEITURA + 10), { flag: 'a' })
  assert.deepEqual(await lerDegradacoes(casa, {}, { agora: AGORA }),
    { ...vazio('presente'), bytes: statSync(registroDa(casa)).size, truncado: true })
}))

test('registro que nao e arquivo fica ilegivel e a leitura nao lanca', () => comCasa(async (casa) => {
  mkdirSync(registroDa(casa), { recursive: true })
  assert.deepEqual(await lerDegradacoes(casa, {}), vazio('ilegivel', 'EISDIR'))
}))

test('OMNI_CASA_BANCO aponta a pasta do registro', () => comCasa(async (casa) => {
  const outra = join(casa, 'outra')
  gravar(join(outra, 'degradacoes.jsonl'), [{ em: '2026-11-08T09:00:00.000Z', operacao: 'cofre.cli', codigo: null, erro: 'falha' }])
  const resumo = await lerDegradacoes(casa, { OMNI_CASA_BANCO: outra }, { agora: AGORA })
  assert.deepEqual([resumo.registro, resumo.linhas, resumo.operacoes.map((op) => op.operacao)], ['presente', 1, ['cofre.cli']])
  assert.equal((await lerDegradacoes(casa, {})).registro, 'ausente')
}))
```

- [x] **Passo 2: extrair o teste e ver o vermelho.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-08-f1-plano-7-degradacoes.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so testes/casa-degradacoes.test.mjs
node --test --test-concurrency=1 --test-reporter=spec testes/casa-degradacoes.test.mjs *> "$rascunho\p7-t1-vermelho.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\p7-t1-vermelho.txt" -Pattern 'ERR_MODULE_NOT_FOUND', '(tests|pass|fail) \d+\s*$'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `gravado testes/casa-degradacoes.test.mjs`, `saida: 1`, `ERR_MODULE_NOT_FOUND` (o leitor ainda não existe), `tests 1`, `pass 0` e `fail 1`: o arquivo inteiro cai ao carregar; `False`.

Resultado (08/11), visto no worktree (executor, item 11): `saida: 1`, `ERR_MODULE_NOT_FOUND` apontando `runtime/casa/degradacoes.mjs`, `tests 1`, `pass 0`, `fail 1`; `False`.

- [x] **Passo 3: o módulo** (decisões 1 a 7 e 9).

```js arquivo=runtime/casa/degradacoes.mjs
// Leitura do registro de degradações da casa (desenho §3.6), só para o diagnóstico. Quem grava é o
// registrarDegradacao do banco.mjs. Nada é criado nem aberto além do próprio arquivo, e nada sai que
// o gravador não escreva: cada linha é refeita só com data, operação, código e erro.
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { pastaDoBanco } from './banco.mjs'

export const LIMITE_LEITURA = 256 * 1024
const DIA_MS = 24 * 60 * 60 * 1000
const OPERACAO = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/
const CODIGO = /^[A-Z][A-Z0-9_]{0,39}$/

function vazio(registro, codigo = null) {
  return { registro, codigo, bytes: 0, truncado: false, linhas: 0, linhasInvalidas: 0, nas24h: 0, ultimaEm: null, operacoes: [] }
}

// Uma linha só conta se tiver a forma exata que o gravador escreve; o resto vira null e é contado
// como inválido, sem que nenhum trecho dela saia.
function linhaDoRegistro(texto) {
  let dado
  try { dado = JSON.parse(texto) } catch { return null }
  // A data só vale se voltar idêntica do toISOString, que é como o gravador a escreve: isso recusa
  // de uma vez o que não é texto, o que não é data e a data sem os milissegundos.
  const quando = Date.parse(dado?.em)
  if (Number.isNaN(quando) || new Date(quando).toISOString() !== dado.em) return null
  const { em, operacao, codigo, erro } = dado
  if (typeof operacao !== 'string' || operacao.length > 60 || !OPERACAO.test(operacao)) return null
  return { em, quando, operacao,
    codigo: typeof codigo === 'string' && CODIGO.test(codigo) ? codigo : null,
    erro: typeof erro === 'string' ? erro.slice(0, 300) : '' }
}

// Lê no máximo os últimos LIMITE_LEITURA bytes. O byte anterior à cauda diz se ela começa no meio
// de uma linha: se começa, essa linha cortada é descartada inteira.
async function lerCauda(arquivo) {
  const fh = await open(arquivo, 'r')
  try {
    const info = await fh.stat()
    if (!info.isFile()) throw Object.assign(new Error('o registro não é um arquivo'), { code: 'EISDIR' })
    const inicio = Math.max(0, info.size - LIMITE_LEITURA)
    const desde = inicio > 0 ? inicio - 1 : 0
    const buffer = Buffer.alloc(info.size - desde)
    const { bytesRead } = await fh.read(buffer, 0, buffer.length, desde)
    let cauda = buffer.subarray(0, bytesRead)
    if (inicio > 0) {
      const quebra = cauda.indexOf(0x0a)
      cauda = quebra < 0 ? cauda.subarray(cauda.length) : cauda.subarray(quebra + 1)
    }
    return { bytes: info.size, truncado: inicio > 0, texto: cauda.toString('utf8') }
  } finally {
    await fh.close()
  }
}

export async function lerDegradacoes(casa, env = process.env, { agora = new Date() } = {}) {
  let cauda
  try { cauda = await lerCauda(join(pastaDoBanco(casa, env), 'degradacoes.jsonl')) }
  catch (erro) {
    if (erro?.code === 'ENOENT') return vazio('ausente')
    return vazio('ilegivel', typeof erro?.code === 'string' ? erro.code : null)
  }
  const desde = agora.getTime() - DIA_MS
  const porOperacao = new Map()
  const resumo = { ...vazio('presente'), bytes: cauda.bytes, truncado: cauda.truncado }
  let ultima = null
  for (const texto of cauda.texto.split('\n')) {
    if (texto.trim() === '') continue
    const linha = linhaDoRegistro(texto)
    if (!linha) { resumo.linhasInvalidas++; continue }
    resumo.linhas++
    const recente = linha.quando >= desde
    if (recente) resumo.nas24h++
    if (!ultima || linha.quando > ultima.quando) ultima = linha
    let op = porOperacao.get(linha.operacao)
    if (!op) {
      op = { operacao: linha.operacao, total: 0, nas24h: 0, primeira: linha, ultima: linha }
      porOperacao.set(linha.operacao, op)
    }
    op.total++
    if (recente) op.nas24h++
    if (linha.quando < op.primeira.quando) op.primeira = linha
    // Empate na data: vence a linha mais adiante no arquivo, que é a gravada por último.
    if (linha.quando >= op.ultima.quando) op.ultima = linha
  }
  resumo.ultimaEm = ultima ? ultima.em : null
  resumo.operacoes = [...porOperacao.values()]
    .sort((a, b) => b.ultima.quando - a.ultima.quando)
    .map((op) => ({ operacao: op.operacao, total: op.total, nas24h: op.nas24h,
      primeiraEm: op.primeira.em, ultimaEm: op.ultima.em,
      ultimoCodigo: op.ultima.codigo, ultimoErro: op.ultima.erro }))
  return resumo
}
```

- [x] **Passo 4: extrair o módulo e ver o verde.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-08-f1-plano-7-degradacoes.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so runtime/casa/degradacoes.mjs
node --check runtime/casa/degradacoes.mjs; "check: $LASTEXITCODE"
node --test --test-concurrency=1 --test-reporter=spec testes/casa-degradacoes.test.mjs *> "$rascunho\p7-t1-verde.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\p7-t1-verde.txt" -Pattern '(tests|pass|fail) \d+\s*$'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `gravado runtime/casa/degradacoes.mjs`, `check: 0`, `tests 9`, `pass 9`, `fail 0`, `saida: 0` e `False`.

Resultado (08/11): `check: 0`, `tests 9`, `pass 9`, `fail 0`, `saida: 0` e `False`.

**Mutação.** Trinta e oito mutantes, todos no leitor: o limite e o dia (01 e 02), a forma da linha (03 a 14), a leitura da cauda (15 a 21), a casa e o relógio (22 a 25) e o resumo (26 a 38). Cada um tem o trecho exato (uma vez só no arquivo), a troca e as suítes que devem matá-lo. O executor aplica um por vez, roda as suítes do mutante pelo `run()` do `node:test`, restaura sempre e anota cada teste que caiu. A tabela derruba a rodada se um mutante sobreviver sem estar declarado equivalente, se uma queda não for `AssertionError` com `ERR_ASSERTION` ou se vier de suíte fora das do mutante: mutante que morre no setup não prova nada. O 21 é o único declarado equivalente (decisão 9). Não há mapa previsto: a tabela do Apêndice A, gerada da rodada, é o registro de onde cada um caiu.

```json rascunho=mutantes-p7-t1.json
[
 {
  "nome": "01 limite dobra",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "256 * 1024",
  "para": "512 * 1024",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "02 dia com 25 horas",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "24 * 60 * 60 * 1000",
  "para": "25 * 60 * 60 * 1000",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "03 operacao com 61",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "operacao.length > 60",
  "para": "operacao.length > 61",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "04 operacao sem ponto",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "[a-z0-9-]+)+$/",
  "para": "[a-z0-9-]+)*$/",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "05 operacao maiuscula",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "/^[a-z][a-z0-9-]*",
  "para": "/^[a-zA-Z][a-z0-9-]*",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "06 operacao em lista",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "typeof operacao !== 'string' || ",
  "para": "",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "07 codigo com 41",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "{0,39}",
  "para": "{0,40}",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "08 codigo minusculo",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "/^[A-Z][A-Z0-9_]",
  "para": "/^[a-zA-Z][a-zA-Z0-9_]",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "09 codigo em lista",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "typeof codigo === 'string' && ",
  "para": "",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "10 erro com 400",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "erro.slice(0, 300)",
  "para": "erro.slice(0, 400)",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "11 erro objeto ecoado",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "erro.slice(0, 300) : ''",
  "para": "erro.slice(0, 300) : String(erro)",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "12 data sem NaN",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "Number.isNaN(quando) || ",
  "para": "",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "13 data sem ida e volta",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": " || new Date(quando).toISOString() !== dado.em",
  "para": "",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "14 linha null",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "Date.parse(dado?.em)",
  "para": "Date.parse(dado.em)",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "15 pasta passa por arquivo",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "if (!info.isFile())",
  "para": "if (false)",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "16 cauda sem o byte anterior",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "inicio > 0 ? inicio - 1 : 0",
  "para": "inicio",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "17 corta sem truncar",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "if (inicio > 0) {",
  "para": "if (inicio >= 0) {",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "18 linha sem quebra fica",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "cauda.subarray(cauda.length)",
  "para": "cauda",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "19 truncado nunca",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "truncado: inicio > 0",
  "para": "truncado: false",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "20 bytes lidos no lugar do tamanho",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "bytes: info.size",
  "para": "bytes: bytesRead",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "21 arquivo nao fecha",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "await fh.close()",
  "para": "void 0",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ],
  "equivalente": "arquivo esquecido aberto nao se ve no teste: o libuv abre com FILE_SHARE_DELETE e o GC fecha"
 },
 {
  "nome": "22 ausente vira ilegivel",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "if (erro?.code === 'ENOENT') return vazio('ausente')",
  "para": "",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "23 ilegivel sem codigo",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "vazio('ilegivel', typeof erro?.code === 'string' ? erro.code : null)",
  "para": "vazio('ilegivel')",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "24 ignora o env",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "pastaDoBanco(casa, env)",
  "para": "pastaDoBanco(casa)",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "25 agora em 1970",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "agora = new Date() }",
  "para": "agora = new Date(0) }",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "26 linha em branco conta",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "texto.trim() === ''",
  "para": "texto === ''",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "27 invalida nao conta",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "resumo.linhasInvalidas++; ",
  "para": "",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "28 fronteira das 24h",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "linha.quando >= desde",
  "para": "linha.quando > desde",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "29 resumo conta tudo nas 24h",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "if (recente) resumo.nas24h++",
  "para": "resumo.nas24h++",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "30 operacao conta tudo nas 24h",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "if (recente) op.nas24h++",
  "para": "op.nas24h++",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "31 ultima geral vira a primeira",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "linha.quando > ultima.quando",
  "para": "linha.quando < ultima.quando",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "32 primeira vira a ultima",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "linha.quando < op.primeira.quando",
  "para": "linha.quando > op.primeira.quando",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "33 empate fica com a primeira",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "linha.quando >= op.ultima.quando",
  "para": "linha.quando > op.ultima.quando",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "34 ordem crescente",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "b.ultima.quando - a.ultima.quando",
  "para": "a.ultima.quando - b.ultima.quando",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "35 ultimaEm indefinida",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "ultima ? ultima.em : null",
  "para": "ultima?.em",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "36 total em dobro",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "op.total++",
  "para": "op.total += 2",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "37 codigo da primeira",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "ultimoCodigo: op.ultima.codigo",
  "para": "ultimoCodigo: op.primeira.codigo",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 },
 {
  "nome": "38 linha valida nao conta",
  "arquivo": "runtime/casa/degradacoes.mjs",
  "de": "resumo.linhas++",
  "para": "void 0",
  "teste": [
   "testes/casa-degradacoes.test.mjs"
  ]
 }
]
```

- [x] **Passo 5: extrair a lista e a tabela, e anotar os hashes.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-08-f1-plano-7-degradacoes.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so mutantes.mjs tabela-mutantes-p7.mjs mutantes-p7-t1.json
$alvos = 'runtime/casa/degradacoes.mjs', 'testes/casa-degradacoes.test.mjs'
$alvos | ForEach-Object { $_ + ' ' + (Get-FileHash $_ -Algorithm SHA256).Hash.Substring(0, 12) } | Set-Content -Encoding utf8 "$rascunho\hashes-antes-p7-t1.txt"
Get-Content "$rascunho\hashes-antes-p7-t1.txt"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `igual mutantes.mjs`, `gravado tabela-mutantes-p7.mjs`, `gravado mutantes-p7-t1.json`, as duas linhas de hash e `False`.

Resultado (08/11): a lista e a tabela gravadas no `$rascunho` por script; os hashes `DBEB06099842` (leitor) e `483543A4470E` (CD), anotados no terminal (executor, item 11).

- [x] **Passo 6: rodar, em segundo plano.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
node "$rascunho\mutantes.mjs" "$rascunho\mutantes-p7-t1.json" *> "$rascunho\mutantes-p7-t1.txt"; "saida: $LASTEXITCODE"
```

Esperado: a última linha de `mutantes-p7-t1.txt` é `38 mutantes em … s; fora do vermelho: 1` (o 21), e `saida: 1`, porque o executor sai 1 com qualquer sobrevivente, declarado ou não. Quem julga o equivalente é a tabela, no passo seguinte.

Resultado (08/11): `38 mutantes em 10 s; fora do vermelho: 1`, o 21, e `saida: 1`; as 38 linhas no `mutantes-p7-t1.saida.jsonl`.

- [x] **Passo 7: a tabela, os hashes e a guarda.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$alvos = 'runtime/casa/degradacoes.mjs', 'testes/casa-degradacoes.test.mjs'
node "$rascunho\tabela-mutantes-p7.mjs" "$rascunho\mutantes-p7-t1.json"; "saida: $LASTEXITCODE"
$depois = $alvos | ForEach-Object { $_ + ' ' + (Get-FileHash $_ -Algorithm SHA256).Hash.Substring(0, 12) }
Compare-Object (Get-Content "$rascunho\hashes-antes-p7-t1.txt") $depois
git status --short
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `38 linhas: 37 vermelhos, 1 equivalente(s); testes mapeados: …`, nenhuma linha `PROBLEMA` e `saida: 0`; o `Compare-Object` calado; no status, `?? runtime/casa/degradacoes.mjs` e `?? testes/casa-degradacoes.test.mjs`; e `False`. A tabela gerada (`$rascunho\mutantes-p7-t1.tabela.md`) entra no Apêndice A.

Resultado (08/11): `38 linhas: 37 vermelhos, 1 equivalente(s); testes mapeados: 56`, nenhuma linha `PROBLEMA` e `saida: 0`; os hashes depois iguais aos de antes (`DBEB06099842` e `483543A4470E`); `False`. A tabela está no Apêndice A.

### Task 2: o diagnóstico e o `check`

**Arquivos:** re-emitir `testes/diagnostico.test.mjs` inteiro (DG, de 4 para 5 testes) e `runtime/diagnostico.mjs` inteiro; trocar um trecho do `package.json`. O DG 3 passa a conferir o registro ausente, e o DG 4, novo, grava duas degradações em duas pastas e confere que o diagnóstico lê a do `env` dele e não cria nada além dos registros.

- [x] **Passo 1: o teste.**

```js arquivo=testes/diagnostico.test.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { diagnosticarRuntime } from '../runtime/diagnostico.mjs'
import { consultarCapacidadesOvercore } from '../runtime/overcore-task-flow.mjs'
import { abrirTurnoAuditoria, registrarAcaoAuditoria } from '../runtime/auditoria-autocorrecao.mjs'
import { verificarIntegridadeRelease } from '../runtime/integridade-release.mjs'
import { tratarHook } from '../runtime/hook-contexto.mjs'
import { caminhoDaAutomacaoFalhas, sincronizarAutomacaoFalhas } from '../runtime/automacao-falhas.mjs'
import { registrarFalha } from '../runtime/falhas.mjs'
import { registrarDegradacao } from '../runtime/casa/banco.mjs'

async function ambiente() {
  const raiz = await mkdtemp(join(tmpdir(), 'omni-diagnostic-hook-'))
  return { raiz, env: { ...process.env, OMNI_HOME: join(raiz, 'omni-home'), CLAUDE_PLUGIN_DATA: join(raiz, 'plugin-data') } }
}

test('diagnostico legado cabe inteiro com personalidade e evidencias no hook real', async () => {
  const { raiz, env } = await ambiente()
  const session_id = 'sessao-diagnostico-legado'
  try {
    await tratarHook({ hook_event_name: 'UserPromptSubmit', session_id, prompt: '/omni:omni' }, env)
    for (let n = 0; n < 3; n++) await registrarFalha(env.OMNI_HOME, {
      agent: 'omni', action: 'executar Bash', failureClass: 'permission',
      signature: 'diagnostico legado sem recibo', evidenceId: `legacy-proof-${n}` })
    const store = await sincronizarAutomacaoFalhas(env.OMNI_HOME)
    Object.assign(store.jobs[0], { state: 'needs-owner', authorityFingerprint: 'a'.repeat(64),
      reasonClass: 'owner-authority', requiredEffectFingerprint: 'b'.repeat(64),
      targetFingerprint: 'c'.repeat(64), attempts: 6, strategyFingerprints: ['d'.repeat(64)] })
    await writeFile(caminhoDaAutomacaoFalhas(env.OMNI_HOME), JSON.stringify(store))
    const output = await tratarHook({ hook_event_name: 'UserPromptSubmit', session_id, prompt: 'continue o trabalho' }, env)
    const context = output.hookSpecificOutput.additionalContext
    assert.ok(context.length <= 9500)
    assert.match(context, /diagnóstico local somente leitura/)
    assert.match(context, /PERSONALIDADE omni-persona-v3-candidate/)
    assert.match(context, /<\/failure-dispatch-briefing>/)
  } finally { await rm(raiz, { recursive: true, force: true }) }
})

test('diagnostico canonico integro conta como leitura e comando anexado nao herda excecao', async () => {
  const home = await mkdtemp(join(tmpdir(), 'omni-diagnostic-audit-'))
  try {
    const root = fileURLToPath(new URL('../', import.meta.url))
    const integrity = await verificarIntegridadeRelease(root)
    const session = 'diagnostic-audit-test'
    await abrirTurnoAuditoria(home, { session_id: session, prompt: 'verifique estado' })
    const command = `powershell -NoProfile -ExecutionPolicy Bypass -File "${join(root, 'scripts', 'omni.ps1')}" diagnostico --sessao ${session}`
    const record = suffix => registrarAcaoAuditoria(home, { session_id: session,
      hook_event_name: 'PostToolUse', tool_use_id: `diagnostic-${suffix}`, tool_name: 'Bash',
      tool_input: { command: command + suffix } })
    assert.equal((await record('')).action.effect, integrity.status === 'verified' ? 'verification' : 'execution')
    assert.equal((await record('; Set-Content arquivo.txt alterado')).action.effect, 'mutation')
    assert.notEqual((await record(' | node -e "console.log(1)"')).action.effect, 'verification')
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('diagnostico sem store nao cria nada nem inventa sessao carregada', async () => {
  const home = await mkdtemp(join(tmpdir(), 'omni-diagnostic-'))
  try {
    const result = await diagnosticarRuntime(home, fileURLToPath(new URL('../', import.meta.url)), 'session-missing', {})
    assert.equal(result.loadedSession, null)
    assert.equal(result.failures.readOnly, true)
    assert.equal(result.overcore.status, 'unverified')
    assert.equal(result.degradacoes?.registro, 'ausente')
    assert.deepEqual(await readdir(home), [])
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('diagnostico resume as degradacoes da casa sem abrir o banco', async () => {
  const home = await mkdtemp(join(tmpdir(), 'omni-diagnostic-degradacoes-'))
  try {
    const root = fileURLToPath(new URL('../', import.meta.url))
    const resumo = ({ degradacoes }) => [degradacoes?.registro, degradacoes?.operacoes?.map(({ operacao, total, ultimoCodigo, ultimoErro }) => ({ operacao, total, ultimoCodigo, ultimoErro }))]
    registrarDegradacao(home, 'memoria.carregar', Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' }), {})
    assert.deepEqual(resumo(await diagnosticarRuntime(home, root, 'session-missing', {})),
      ['presente', [{ operacao: 'memoria.carregar', total: 1, ultimoCodigo: 'SQLITE_BUSY', ultimoErro: 'database is locked' }]])
    // O env do diagnóstico chega à leitura: OMNI_CASA_BANCO troca a pasta do registro.
    const env = { OMNI_CASA_BANCO: join(home, 'banco') }
    registrarDegradacao(home, 'cofre.cli', new Error('cofre fechado'), env)
    assert.deepEqual(resumo(await diagnosticarRuntime(home, root, 'session-missing', env)),
      ['presente', [{ operacao: 'cofre.cli', total: 1, ultimoCodigo: null, ultimoErro: 'cofre fechado' }]])
    // Só os registros existem: o diagnóstico não cria o omni.db nem outra coisa na casa para lê-los.
    assert.deepEqual((await readdir(home)).sort(), ['banco', 'casa'])
    assert.deepEqual(await readdir(join(home, 'casa')), ['degradacoes.jsonl'])
    assert.deepEqual(await readdir(join(home, 'banco')), ['degradacoes.jsonl'])
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('capacidade atual e prova de tarefa sao distintas; endpoint ausente continua desconhecido', async () => {
  let healthy = true
  const server = createServer((req, res) => {
    assert.equal(req.url, '/v1/capabilities')
    assert.equal(req.method, 'GET')
    assert.equal(req.headers.authorization, 'Bearer token-diagnostic-test-only')
    res.writeHead(healthy ? 200 : 404, { 'content-type': 'application/json' })
    res.end(JSON.stringify(healthy ? { service: 'overcore-task-manager', protocolVersion: 1,
      scope: 'runtime-capabilities-not-task-success', startedAt: new Date().toISOString(),
      capabilities: ['inspection-direct-entries-snapshot-and-tool-telemetry-v1', 'unknown-instruction'] } : {}))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const env = { OVERCORE_LOCAL_TOKEN: 'token-diagnostic-test-only', OVERCORE_URL: `http://127.0.0.1:${server.address().port}` }
    const result = await consultarCapacidadesOvercore(env)
    assert.equal(result.status, 'observed')
    assert.equal(result.provesTaskSuccess, false)
    assert.deepEqual(result.capabilities, ['inspection-direct-entries-snapshot-and-tool-telemetry-v1'])
    healthy = false
    assert.equal((await consultarCapacidadesOvercore(env)).status, 'unverified')
  } finally { await new Promise(resolve => server.close(resolve)) }
})
```

- [x] **Passo 2: extrair o teste e ver o vermelho.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-08-f1-plano-7-degradacoes.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so testes/diagnostico.test.mjs
node --test --test-concurrency=1 --test-reporter=spec testes/diagnostico.test.mjs *> "$rascunho\p7-t2-vermelho.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\p7-t2-vermelho.txt" -Pattern 'AssertionError|TypeError', '(tests|pass|fail) \d+\s*$'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `gravado testes/diagnostico.test.mjs`, `saida: 1`, `tests 5`, `pass 3` e `fail 2`: o DG 3 e o DG 4 caem pela asserção, porque o diagnóstico ainda não tem `degradacoes`; `False`.

Resultado (08/11), visto no worktree antes do `?.` (executor, item 11): `saida: 1`, `tests 5`, `pass 3`, `fail 2`; o DG 3 e o DG 4 com `TypeError` na leitura de `degradacoes`; `False`.

- [x] **Passo 3: o módulo** (decisão 8).

```js arquivo=runtime/diagnostico.mjs
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { diagnosticarAutomacaoFalhas } from './automacao-falhas.mjs'
import { lerDegradacoes } from './casa/degradacoes.mjs'
import { lerIdentidadeRelease } from './integridade-release.mjs'
import { consultarCapacidadesOvercore, consultarEvidenciasOvercore } from './overcore-task-flow.mjs'

/** No migration, synchronization, cache refresh, dispatch or paid model call. */
export async function diagnosticarRuntime(casa, pluginRoot, sessionId, env = process.env) {
  let loaded = null
  if (typeof sessionId === 'string' && sessionId.length > 0 && sessionId.length <= 500) {
    const id = createHash('sha256').update(sessionId).digest('hex')
    try { loaded = JSON.parse(await readFile(join(casa, 'runtime', 'loaded-sessions', `${id}.json`), 'utf8')) }
    catch (error) { if (error?.code !== 'ENOENT') throw error }
  }
  return { ok: true, readOnly: true, queriedAt: new Date().toISOString(),
    operator: await lerIdentidadeRelease(pluginRoot),
    loadedSession: loaded, loadedSessionIsHistoricalObservation: true,
    failures: await diagnosticarAutomacaoFalhas(casa),
    degradacoes: await lerDegradacoes(casa, env),
    overcore: await consultarCapacidadesOvercore(env),
    overcoreValidation: await consultarEvidenciasOvercore(env) }
}
```

- [x] **Passo 4: extrair o módulo e ver o verde.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-08-f1-plano-7-degradacoes.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so runtime/diagnostico.mjs
node --check runtime/diagnostico.mjs; "check: $LASTEXITCODE"
node --test --test-concurrency=1 --test-reporter=spec testes/diagnostico.test.mjs *> "$rascunho\p7-t2-verde.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\p7-t2-verde.txt" -Pattern '(tests|pass|fail) \d+\s*$'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `gravado runtime/diagnostico.mjs`, `check: 0`, `tests 5`, `pass 5`, `fail 0`, `saida: 0` e `False`.

Resultado (08/11): `check: 0`, `tests 5`, `pass 5`, `fail 0`, `saida: 0` e `False`. Nenhuma outra suíte lê a forma do diagnóstico; o único chamador é o `diagnostico` da CLI do Omni (`runtime/cli.mjs`), com o `process.env` padrão.

- [x] **Passo 5: ver o furo do `check`.** O mutante de sintaxe do plano 4 acrescenta uma linha que não compila no fim do arquivo, roda o `npm run check` e restaura. Antes de mexer no `package.json`, o `check` não vê nenhum dos dois módulos.

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
node "$rascunho\extrair-do-plano.mjs" docs\superpowers\plans\2026-11-06-f1-plano-4-cofre.md . $rascunho --so mutante-sintaxe.mjs
foreach ($alvo in 'runtime/casa/degradacoes.mjs', 'runtime/diagnostico.mjs') { node "$rascunho\mutante-sintaxe.mjs" . $alvo }
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `igual mutante-sintaxe.mjs` e, nos dois, `status 0; SyntaxError: false; aponta: (nenhuma linha cita o arquivo)` e `restaurado: true`; `False`.

Resultado (08/11): nos dois, `status 0; SyntaxError: false; aponta: (nenhuma linha cita o arquivo)` e `restaurado: true`; `False`.

- [x] **Passo 6: fechar o furo** (decisão 10). No `package.json`, no script `check`, trocar

```text
node --check runtime/casa/presenca.mjs
```

por

```text
node --check runtime/casa/presenca.mjs && node --check runtime/casa/degradacoes.mjs && node --check runtime/diagnostico.mjs
```

O trecho aparece uma vez só no arquivo, e a troca é a única mudança do `package.json` neste plano.

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$alvos = 'runtime/casa/degradacoes.mjs', 'runtime/diagnostico.mjs'
foreach ($alvo in $alvos) { 'linhas de ' + $alvo + ': ' + (Get-Content $alvo).Count; node "$rascunho\mutante-sintaxe.mjs" . $alvo }
npm run check *> "$rascunho\p7-t2-check.txt"; "saida: $LASTEXITCODE"
git diff --numstat -- package.json
foreach ($a in @('package.json') + $alvos) { $a + ' CR: ' + ([IO.File]::ReadAllText((Resolve-Path $a)).Split([char]13).Count - 1) }
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `linhas de runtime/casa/degradacoes.mjs: 92` e `linhas de runtime/diagnostico.mjs: 24`; nos dois, `status 1; SyntaxError: true`, apontando a linha logo depois do fim do arquivo, e `restaurado: true`; `saida: 0` no `check` sem mutante; `1	1	package.json`; CR 0 nos três; `False`.

Resultado (08/11): as linhas 92 e 24; `status 1; SyntaxError: true`, apontando `degradacoes.mjs:94` e `diagnostico.mjs:26`, e `restaurado: true`; `saida: 0`; `1	1	package.json`; CR 0 no `package.json` e no leitor. O `runtime/diagnostico.mjs` e o DG estavam com CRLF no worktree, porque o checkout converte o fim de linha, e com LF no índice; na T4 eles foram normalizados para LF, com o `git diff --numstat` igual antes e depois e o DG e os mutantes da T2 rodados de novo (executor, item 11); `False`.

**Mutação.** Três mutantes no diagnóstico: sem o campo (39), sem o `env` (40) e com a raiz do plugin no lugar da casa (41). Mesmas regras da T1.

```json rascunho=mutantes-p7-t2.json
[
    {
        "nome":  "39 diagnostico sem degradacoes",
        "arquivo":  "runtime/diagnostico.mjs",
        "de":  "    degradacoes: await lerDegradacoes(casa, env),\n",
        "para":  "",
        "teste":  [
                      "testes/diagnostico.test.mjs"
                  ]
    },
    {
        "nome":  "40 diagnostico ignora o env",
        "arquivo":  "runtime/diagnostico.mjs",
        "de":  "lerDegradacoes(casa, env)",
        "para":  "lerDegradacoes(casa)",
        "teste":  [
                      "testes/diagnostico.test.mjs"
                  ]
    },
    {
        "nome":  "41 diagnostico le a raiz do plugin",
        "arquivo":  "runtime/diagnostico.mjs",
        "de":  "lerDegradacoes(casa, env)",
        "para":  "lerDegradacoes(pluginRoot, env)",
        "teste":  [
                      "testes/diagnostico.test.mjs"
                  ]
    }
]
```

- [x] **Passo 7: extrair a lista, rodar e tabelar.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-08-f1-plano-7-degradacoes.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so mutantes-p7-t2.json
$alvos = 'runtime/diagnostico.mjs', 'testes/diagnostico.test.mjs'
$antes = $alvos | ForEach-Object { $_ + ' ' + (Get-FileHash $_ -Algorithm SHA256).Hash.Substring(0, 12) }
node "$rascunho\mutantes.mjs" "$rascunho\mutantes-p7-t2.json" *> "$rascunho\mutantes-p7-t2.txt"; "saida: $LASTEXITCODE"
node "$rascunho\tabela-mutantes-p7.mjs" "$rascunho\mutantes-p7-t2.json"; "saida: $LASTEXITCODE"
$depois = $alvos | ForEach-Object { $_ + ' ' + (Get-FileHash $_ -Algorithm SHA256).Hash.Substring(0, 12) }
Compare-Object $antes $depois
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `gravado mutantes-p7-t2.json`; `saida: 0` no executor; `3 linhas: 3 vermelhos, 0 equivalente(s); testes mapeados: …`, nenhuma linha `PROBLEMA` e `saida: 0`; o `Compare-Object` calado; `False`. A tabela entra no Apêndice B.

Resultado (08/11): os 3 vermelhos; `3 linhas: 3 vermelhos, 0 equivalente(s); testes mapeados: 4` e `saida: 0`; os hashes `FC9ECA3CAEF5` (diagnóstico) e `4B982087A372` (DG) iguais antes e depois. Depois da normalização para LF (Passo 6), a rodada foi repetida: `3 mutantes em 4 s; fora do vermelho: 0`, a mesma tabela, e os hashes `2582CDB87594` e `11C5C3280CF5` iguais antes e depois; `False`. A tabela está no Apêndice B.

### Task 3: verify, `.test-dist` e `dist`

Uma suíte pesada por vez. Nenhum arquivo do repositório muda nesta tarefa; o `dist` que o build reescreve volta no fim, e só se a diferença for de fim de linha.

- [x] **Passo 1: verify, em segundo plano.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
npm run verify *> "$rascunho\verify-p7.txt"; "saida: $LASTEXITCODE" | Out-File -Append -Encoding utf8 "$rascunho\verify-p7.txt"
Select-String -Path "$rascunho\verify-p7.txt" -Pattern '(tests|pass|fail|cancelled|skipped|duration_ms) [\d.]+\s*$', '\.test\.mjs:\d+:\d+', '^saida: ', '^\s+(actual|expected): ', '^\{"ok"'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado:
- `tests 899`, `pass 894`, `fail 1`, `cancelled 0` e `skipped 4`; a única falha é `testes\integridade-release.test.mjs:165`, que cai na linha 173;
- `actual` e `expected` com 64 dígitos hexadecimais cada: o `actual` é o contrato (`3c60182bbef2…`, o mesmo dos planos 4 a 6), o `expected` é o calculado com este plano, diferente do `56f4f79a2e4a…` do plano 6, porque o payload de `runtime/` mudou. Ele fica anotado no resultado para o plano 8, que grava o contrato;
- cinco linhas `{"ok":true,…}`, como no plano 6: este plano não muda TypeScript;
- `saida: 1`;
- `False`.

Base: o verify do plano 6, com 889 testes. Os 10 deste plano são CD 9 e DG 1.

Resultado (08/11): `tests 899`, `pass 894`, `fail 1`, `cancelled 0` e `skipped 4`, em 455 s. A Ãºnica falha Ã© a `testes\integridade-release.test.mjs:165`, que cai na linha 173: `actual` `3c60182bbef281d96b6782d614482b5e7459ce036468233c29eb6f1af3ef3df3` (o contrato) e `expected` `278ef6bb2382771b7e6c10010b7f119686cc29d3030fee42f0ffb01459bc1d2d` (o calculado com este plano, que o plano 8 grava). SaÃ­ram as cinco linhas `{"ok":true,â€¦}`, e a saÃ­da foi 1. O arquivo do verify ficou fora do `$rascunho`, na pasta temporÃ¡ria da sessÃ£o. A guarda deu `False` antes e depois.

- [x] **Passo 2: o que a falha conhecida mascara, rodado à parte.** O `npm test` para no primeiro `node --test` vermelho, então o `.test-dist`, o `test:dist` e o `verify:build` não rodam dentro do verify.

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
node --test --test-concurrency=1 .test-dist/testes/*.test.js *> "$rascunho\p7-t3-test-dist.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\p7-t3-test-dist.txt" -Pattern '(tests|pass|fail) \d+\s*$'
npm run test:dist *> "$rascunho\p7-t3-dist-production.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\p7-t3-dist-production.txt" -Pattern '(tests|pass|fail) \d+\s*$'
npm run verify:build *> "$rascunho\p7-t3-verify-build.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\p7-t3-verify-build.txt" -Pattern '^\{"ok"'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: as três com `saida: 0`; `.test-dist` 55/55, `test:dist` 1/1 e `{"ok":true,"files":59}`, os mesmos números do plano 6; `False`.

Resultado (08/11): as trÃªs com `saida: 0`: `.test-dist` com `tests 55`, `pass 55` e `fail 0`; `test:dist` com `tests 1`, `pass 1` e `fail 0`; `verify:build` com `{"ok":true,"files":59}`; `False`.

- [x] **Passo 3: devolver o `dist` e a guarda.** O `checkout` só roda se o `--stat` sem CR vier vazio: diferença de conteúdo no `dist` é defeito a investigar, não sobra a descartar.

```powershell
$stat = @(git diff --ignore-cr-at-eol --stat -- dist)
'linhas de stat: ' + $stat.Count
if ($stat.Count -eq 0) { git checkout -- dist; 'checkout: ' + $LASTEXITCODE } else { $stat }
git status --short
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `linhas de stat: 0` e `checkout: 0`; o `status` com as cinco linhas das tarefas 1 e 2 e nenhuma em `dist/`: três `M` (`package.json`, o diagnóstico e o DG) e duas `??` (o leitor e a CD), além deste plano; `False`.

Resultado (08/11): `linhas de stat: 0` e `checkout: 0`; o `status` com as trÃªs `M` e as duas `??`, nenhuma linha em `dist/`; `False`.

### Task 4: commit, push, CI e registro

Um commit só: o leitor, o diagnóstico, as suítes e o `package.json` só fazem sentido juntos, e o commit leva este plano e a linha 7 do escopo no plano 1. Antes dele, o `--conferir` que as tarefas não rodaram (executor, item 11).

- [x] **Passo 1: conferir o plano e trocar a linha 7 do escopo.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-08-f1-plano-7-degradacoes.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --conferir > "$rascunho\p7-conferir.txt"; "saida: $LASTEXITCODE"
'igual: ' + @(Select-String -Path "$rascunho\p7-conferir.txt" -Pattern '^igual ').Count + ', outros: ' + @(Select-String -Path "$rascunho\p7-conferir.txt" -Pattern '^igual ' -NotMatch).Count
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `igual: 9, outros: 0` e `saida: 0`; `False`.

Depois, em `docs/superpowers/plans/2026-11-04-f1-casa-sqlite.md`, trocar

```markdown
| 7 | Diagnóstico que lê `degradacoes.jsonl` | §3.6 | a escrever |
```

por

```markdown
| 7 | [Diagnóstico que lê `degradacoes.jsonl`](2026-11-08-f1-plano-7-degradacoes.md) | §3.6 | entregue |
```

Resultado (08/11): `saida: 0` e `igual: 9, outros: 0`; `False`. A linha 7 do escopo do plano 1 trocada, com `1	1` no `git diff --numstat`.

- [x] **Passo 2: varredura, CR e commit.** Autor e committer Weriton-DataOps, com o e-mail dos commits dela no `origin/main`, passado no comando e nunca impresso; mensagem em UTF-8 sem BOM, em `$rascunho\msg-p7.txt`. A varredura olha só as linhas adicionadas no índice e imprime o número do padrão e o arquivo, nunca a linha: o que ela acha é investigado antes do commit, e o falso positivo fica declarado no resultado. Os padrões moram em `$rascunho\padroes-p6.txt`, os mesmos do plano 6, fora do repositório, porque escritos aqui eles seriam o próprio vazamento. O CR é conferido no índice (`i/…` do `ls-files --eol`), que é o que vai ao repositório.

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$arquivos = 'package.json', 'runtime/casa/degradacoes.mjs', 'runtime/diagnostico.mjs', 'testes/casa-degradacoes.test.mjs', 'testes/diagnostico.test.mjs', 'docs/superpowers/plans/2026-11-08-f1-plano-7-degradacoes.md', 'docs/superpowers/plans/2026-11-04-f1-casa-sqlite.md'
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

Esperado: `arquivos: 7`; o `status` com os 7 no índice (quatro `M ` e três `A `) e nenhuma outra linha; `fora de i/lf: 0`; `padroes: 14`; `achados: 0`, ou só falsos positivos explicados um a um no resultado. Com achado real, para aqui: o arquivo volta à tarefa dele, e esta tarefa recomeça.

Com a varredura limpa, o commit:

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$email = git log origin/main --author='Weriton-DataOps' -1 --format='%ae'
if (-not $email) { throw 'sem commit da Weriton-DataOps no origin/main' }
git -c user.name=Weriton-DataOps -c "user.email=$email" commit -F "$rascunho\msg-p7.txt"
git log -1 --format='%h %p %an %cn %s'
git show --stat --format='' HEAD | Select-Object -Last 1
git status --short
```

Esperado: autor e committer `Weriton-DataOps`; 7 arquivos; o `status` vazio.

Resultado (08/11): a registrar.

- [x] **Passo 3: push e CI.** A conta do push é a dona do repositório; a conta que estava ativa é lida antes da troca e volta no `finally`.

```powershell
$antes = gh api user --jq .login
gh auth switch --user Weriton-DataOps; try { git push origin casa-sqlite-f1 } finally { gh auth switch --user $antes }
gh api user --jq .login
git ls-remote origin casa-sqlite-f1
git rev-parse HEAD
```

Depois, o CI do ramo pela conta Weriton-DataOps, com o token só na variável do processo e removido no `finally`. Esperado: a última linha do `gh api user` igual à primeira (a conta voltou); o mesmo SHA no `ls-remote` e no `HEAD`; o job Linux verde e o Windows vermelho só no `:165`, com o mesmo par `actual`/`expected` da T3, Passo 1, e 899 testes.

Resultado (08/11): a registrar.

- [x] **Passo 4: registrar.** A "Situação" deste plano passa a "entregue", com o hash do commit, e os resultados entram nos passos. Esse registro vai num segundo commit, `docs(plano): registra push e CI do plano 7 da F1`, como nos planos 3 a 6, com o mesmo push do Passo 3.

Resultado (08/11): a registrar.

## Autorrevisão contra o desenho

| Desenho | Onde está |
|---|---|
| §3.6: banco fora do ar não derruba o Omni, e o evento vai para `degradacoes.jsonl`, na pasta do banco | Decisões 1, 2 e 7; T1 |
| §3.6: cada linha leva data, operação, código e mensagem, nunca trecho de memória nem segredo | Decisões 4 e 5; CD 3 e CD 4 |
| §3.6: erro de JSON vira só "JSON inválido" | CD 3, com o `registrarDegradacao` de verdade |
| §3.6: sem SQLite, a pasta do banco nem é criada | Decisão 1: o leitor não usa `node:sqlite` e não cria a pasta; CD 1 e DG 4 |
| §3.8: as operações dos estados (`estado.*`, `estados.varredura`) | Decisão 4: o formato da operação casa todas |
| §3: a pasta do banco fora do Roaming | Decisão 2: a pasta é a do `pastaDoBanco` |
| Escopo do plano 1, linha 7: o diagnóstico lê o registro | Decisão 8; T2 |

Desvios e notas:
- O registro não é girado nem apagado: o diagnóstico é só leitura, e a cauda limitada protege a leitura (Posição; decisão 3).
- O código fora do formato dos códigos de erro vira `null` na leitura, embora o gravador aceite qualquer texto: um código que não é de erro não é dado que o diagnóstico precise mostrar (decisão 5).
- O fechamento do arquivo é o único mutante equivalente (decisão 9).
- O `runtime/diagnostico.mjs`, que já existia fora do `check`, entra nele junto com o leitor (decisão 10).
- A execução teve desvios de ordem: arquivos escritos no worktree antes do plano, o vermelho da T2 visto antes do `?.`, a primeira rodada de mutantes da T1 refeita depois de ajustar o teste e o módulo, o `--conferir` só na T4 e a normalização para LF do diagnóstico e do DG, com os mutantes da T2 refeitos (executor, item 11).

## Apêndice A: mutantes da T1

A tabela abaixo é a saída do `tabela-mutantes-p7.mjs` na rodada oficial da T1.

| # | Mutante | Arquivo | Teste que ficou vermelho — asserção |
|---|---|---|---|
| 1 | limite dobra | `casa/degradacoes.mjs` | CD registro maior que o limite le so a cauda e descarta a linha cortada — `equal` |
| 2 | dia com 25 horas | `casa/degradacoes.mjs` | CD resume por operacao com a ultima falha de cada uma e as das ultimas 24 horas — `deepEqual` |
| 3 | operacao com 61 | `casa/degradacoes.mjs` | CD linha fora do formato do gravador conta como invalida e nada alem dos quatro campos sai — `deepEqual` |
| 4 | operacao sem ponto | `casa/degradacoes.mjs` | CD linha fora do formato do gravador conta como invalida e nada alem dos quatro campos sai — `deepEqual` |
| 5 | operacao maiuscula | `casa/degradacoes.mjs` | CD linha fora do formato do gravador conta como invalida e nada alem dos quatro campos sai — `deepEqual` |
| 6 | operacao em lista | `casa/degradacoes.mjs` | CD linha fora do formato do gravador conta como invalida e nada alem dos quatro campos sai — `deepEqual` |
| 7 | codigo com 41 | `casa/degradacoes.mjs` | CD linha fora do formato do gravador conta como invalida e nada alem dos quatro campos sai — `deepEqual` |
| 8 | codigo minusculo | `casa/degradacoes.mjs` | CD linha fora do formato do gravador conta como invalida e nada alem dos quatro campos sai — `deepEqual` |
| 9 | codigo em lista | `casa/degradacoes.mjs` | CD linha fora do formato do gravador conta como invalida e nada alem dos quatro campos sai — `deepEqual` |
| 10 | erro com 400 | `casa/degradacoes.mjs` | CD linha fora do formato do gravador conta como invalida e nada alem dos quatro campos sai — `deepEqual` |
| 11 | erro objeto ecoado | `casa/degradacoes.mjs` | CD linha fora do formato do gravador conta como invalida e nada alem dos quatro campos sai — `deepEqual` |
| 12 | data sem NaN | `casa/degradacoes.mjs` | CD linha fora do formato do gravador conta como invalida e nada alem dos quatro campos sai — `doesNotReject` |
| 13 | data sem ida e volta | `casa/degradacoes.mjs` | CD linha fora do formato do gravador conta como invalida e nada alem dos quatro campos sai — `deepEqual` |
| 14 | linha null | `casa/degradacoes.mjs` | CD linha fora do formato do gravador conta como invalida e nada alem dos quatro campos sai — `doesNotReject` |
| 15 | pasta passa por arquivo | `casa/degradacoes.mjs` | CD registro que nao e arquivo fica ilegivel e a leitura nao lanca — `deepEqual` |
| 16 | cauda sem o byte anterior | `casa/degradacoes.mjs` | CD cauda que comeca no inicio de uma linha nao perde essa linha — `deepEqual` |
| 17 | corta sem truncar | `casa/degradacoes.mjs` | CD resume por operacao com a ultima falha de cada uma e as das ultimas 24 horas — `deepEqual`<br>CD le o que o registrarDegradacao grava, sem trecho do texto lido — `deepEqual`<br>CD linha fora do formato do gravador conta como invalida e nada alem dos quatro campos sai — `deepEqual`<br>CD OMNI_CASA_BANCO aponta a pasta do registro — `deepEqual` |
| 18 | linha sem quebra fica | `casa/degradacoes.mjs` | CD ultima linha maior que o limite e sem quebra nao vira linha invalida — `deepEqual` |
| 19 | truncado nunca | `casa/degradacoes.mjs` | CD registro maior que o limite le so a cauda e descarta a linha cortada — `deepEqual`<br>CD cauda que comeca no inicio de uma linha nao perde essa linha — `deepEqual`<br>CD ultima linha maior que o limite e sem quebra nao vira linha invalida — `deepEqual` |
| 20 | bytes lidos no lugar do tamanho | `casa/degradacoes.mjs` | CD registro maior que o limite le so a cauda e descarta a linha cortada — `deepEqual`<br>CD ultima linha maior que o limite e sem quebra nao vira linha invalida — `deepEqual` |
| 21 | arquivo nao fecha | `casa/degradacoes.mjs` | sobreviveu — equivalente: arquivo esquecido aberto nao se ve no teste: o libuv abre com FILE_SHARE_DELETE e o GC fecha |
| 22 | ausente vira ilegivel | `casa/degradacoes.mjs` | CD registro ausente devolve o resumo vazio e nao cria a pasta do banco — `deepEqual`<br>CD OMNI_CASA_BANCO aponta a pasta do registro — `equal` |
| 23 | ilegivel sem codigo | `casa/degradacoes.mjs` | CD registro que nao e arquivo fica ilegivel e a leitura nao lanca — `deepEqual` |
| 24 | ignora o env | `casa/degradacoes.mjs` | CD OMNI_CASA_BANCO aponta a pasta do registro — `deepEqual` |
| 25 | agora em 1970 | `casa/degradacoes.mjs` | CD le o que o registrarDegradacao grava, sem trecho do texto lido — `deepEqual` |
| 26 | linha em branco conta | `casa/degradacoes.mjs` | CD linha fora do formato do gravador conta como invalida e nada alem dos quatro campos sai — `deepEqual` |
| 27 | invalida nao conta | `casa/degradacoes.mjs` | CD linha fora do formato do gravador conta como invalida e nada alem dos quatro campos sai — `deepEqual` |
| 28 | fronteira das 24h | `casa/degradacoes.mjs` | CD resume por operacao com a ultima falha de cada uma e as das ultimas 24 horas — `deepEqual` |
| 29 | resumo conta tudo nas 24h | `casa/degradacoes.mjs` | CD resume por operacao com a ultima falha de cada uma e as das ultimas 24 horas — `deepEqual`<br>CD le o que o registrarDegradacao grava, sem trecho do texto lido — `deepEqual` |
| 30 | operacao conta tudo nas 24h | `casa/degradacoes.mjs` | CD resume por operacao com a ultima falha de cada uma e as das ultimas 24 horas — `deepEqual` |
| 31 | ultima geral vira a primeira | `casa/degradacoes.mjs` | CD resume por operacao com a ultima falha de cada uma e as das ultimas 24 horas — `deepEqual`<br>CD linha fora do formato do gravador conta como invalida e nada alem dos quatro campos sai — `deepEqual` |
| 32 | primeira vira a ultima | `casa/degradacoes.mjs` | CD resume por operacao com a ultima falha de cada uma e as das ultimas 24 horas — `deepEqual` |
| 33 | empate fica com a primeira | `casa/degradacoes.mjs` | CD resume por operacao com a ultima falha de cada uma e as das ultimas 24 horas — `deepEqual` |
| 34 | ordem crescente | `casa/degradacoes.mjs` | CD resume por operacao com a ultima falha de cada uma e as das ultimas 24 horas — `deepEqual`<br>CD linha fora do formato do gravador conta como invalida e nada alem dos quatro campos sai — `deepEqual` |
| 35 | ultimaEm indefinida | `casa/degradacoes.mjs` | CD ultima linha maior que o limite e sem quebra nao vira linha invalida — `deepEqual` |
| 36 | total em dobro | `casa/degradacoes.mjs` | CD resume por operacao com a ultima falha de cada uma e as das ultimas 24 horas — `deepEqual`<br>CD le o que o registrarDegradacao grava, sem trecho do texto lido — `deepEqual`<br>CD linha fora do formato do gravador conta como invalida e nada alem dos quatro campos sai — `deepEqual`<br>CD registro maior que o limite le so a cauda e descarta a linha cortada — `deepEqual`<br>CD cauda que comeca no inicio de uma linha nao perde essa linha — `deepEqual` |
| 37 | codigo da primeira | `casa/degradacoes.mjs` | CD resume por operacao com a ultima falha de cada uma e as das ultimas 24 horas — `deepEqual` |
| 38 | linha valida nao conta | `casa/degradacoes.mjs` | CD resume por operacao com a ultima falha de cada uma e as das ultimas 24 horas — `deepEqual`<br>CD le o que o registrarDegradacao grava, sem trecho do texto lido — `deepEqual`<br>CD linha fora do formato do gravador conta como invalida e nada alem dos quatro campos sai — `deepEqual`<br>CD registro maior que o limite le so a cauda e descarta a linha cortada — `deepEqual`<br>CD cauda que comeca no inicio de uma linha nao perde essa linha — `deepEqual`<br>CD OMNI_CASA_BANCO aponta a pasta do registro — `deepEqual` |

## Apêndice B: mutantes da T2

A tabela abaixo é a saída do `tabela-mutantes-p7.mjs` na rodada oficial da T2.

| # | Mutante | Arquivo | Teste que ficou vermelho — asserção |
|---|---|---|---|
| 39 | diagnostico sem degradacoes | `diagnostico.mjs` | DG diagnostico sem store nao cria nada nem inventa sessao carregada — `equal`<br>DG diagnostico resume as degradacoes da casa sem abrir o banco — `deepEqual` |
| 40 | diagnostico ignora o env | `diagnostico.mjs` | DG diagnostico resume as degradacoes da casa sem abrir o banco — `deepEqual` |
| 41 | diagnostico le a raiz do plugin | `diagnostico.mjs` | DG diagnostico resume as degradacoes da casa sem abrir o banco — `deepEqual` |
