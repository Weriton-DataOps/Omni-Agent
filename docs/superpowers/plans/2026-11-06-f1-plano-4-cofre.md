# F1, plano 4: cofre no `cofre.db` — plano de implementação

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** o cofre do Omni no `cofre.db`: valor selado pela DPAPI do usuário, metadados em claro, todo pedido de uso registrado (entregue ou recusado, nunca com o valor), importação dos `.dpapi` soltos, inventário só com os nomes do Gerenciador de Credenciais do Windows, teste ao vivo por tipo e um pacote cifrado por frase-mestra para levar o cofre a outra máquina.

**Arquitetura:** cinco módulos novos. `runtime/casa/pacote-cofre.mjs` sela e abre o pacote (scrypt + AES-256-GCM, com o cabeçalho autenticado como AAD). `runtime/casa/dpapi.mjs` é a ponte para a DPAPI e para o Gerenciador, num PowerShell 5.1 filho que recebe o script por `-EncodedCommand` e os valores pelo stdin. `runtime/casa/loja-cofre.mjs` grava no `cofre.db`: a ponte roda antes, fora da transação, e a transação só grava. `runtime/casa/testadores-cofre.mjs` testa ao vivo o que tem testador. `runtime/cofre.mjs` é a linha de comando: segredo só pelo stdin, entrega ao processo filho por variável de ambiente, saída em JSON sem valor.

**Tecnologia:** `node:sqlite`, Node ≥ 22.13 (o CI usa 22; a máquina do Weriton, 24), `node:test`, `node:crypto` (scrypt, AES-256-GCM) e o PowerShell 5.1 do Windows (`ProtectedData`, `CredEnumerateW`). Nenhuma dependência npm nova.

**Desenho:** [Casa única: Omni, Overcore e Oráculo](../specs/2026-11-04-casa-unica-tres-agentes-design.md): §8.1 (onde fica), §8.3 (uso pelos agentes), §8.4 (máquina nova) e §8.5 (prova). O §8.2, o card na ilha, é o plano 5.

**Situação em 06/11/2026:** entregue. T1 a T9 feitas e publicadas no `origin/casa-sqlite-f1`: `ef87498` (módulos, suítes, esquema, `package.json` e os planos), commit de 06/11. O PR sai no plano 8.

---

## Posição na F1

Este é o plano 4 dos oito da F1 ([escopo no plano 1](2026-11-04-f1-casa-sqlite.md#escopo-a-f1-em-oito-planos)). Os planos 1 a 3 deixaram o `omni.db` vivo (memória, documentos, estados) e o `cofre.db` só no papel: a v1 dele existe em `runtime/casa/esquemas.mjs`, mas nenhum código abre o banco `cofre`. Este plano revê essa v1, escreve o código que a usa e prova tudo com a DPAPI de verdade, em cópias.

Fica fora deste plano:
- o card do Cofre na ilha e o testador de Postgres (plano 5);
- o broker por pipe e o cadastro pelo `agente.json` (F2: §8.3 e o item 3 do §8.4);
- a ativação na casa real, que só acontece depois do merge, com o ok do Weriton e com cópia datada dos originais (§8.1);
- os consumidores atuais dos `.dpapi`, que continuam lendo os originais como hoje.

## Mapa de arquivos

| Arquivo | Responsabilidade | Tarefa | Importa |
|---|---|---|---|
| `runtime/casa/pacote-cofre.mjs` (novo) | Pacote da §8.4: `selarPacote`, `abrirPacote`, `FRASE_MINIMA`, `PacoteCofreError` | T1 | `node:crypto` |
| `runtime/casa/dpapi.mjs` (novo) | Ponte: `criarPonteDpapi()` com `selar`, `abrir` e `inventario`, num PowerShell 5.1 filho | T2 | `node:child_process`, `node:path` |
| `runtime/casa/loja-cofre.mjs` (novo) | Loja do `cofre.db`: cadastro, uso com registro, importação dos `.dpapi`, inventário, teste, exportação e importação do pacote | T3 | `node:fs`, `node:path`, `./banco.mjs`, `./pacote-cofre.mjs` |
| `runtime/casa/testadores-cofre.mjs` (novo) | Teste ao vivo por serviço; o Sentinel nunca | T4 | nada |
| `runtime/cofre.mjs` (novo) | Linha de comando (`listar`, `cadastrar`, `importar-dpapi`, `inventario-windows`, `exportar`, `importar-pacote`, `testar`, `executar`) | T5 | módulos do Node, os quatro acima e `./casa/banco.mjs` |
| `runtime/casa/esquemas.mjs` (modificado) | Revisão da v1 do cofre | T3 | — |
| `package.json` (modificado) | `node --check` dos cinco módulos novos no `npm run check` | T5 | — |
| `testes/casa-pacote-cofre.test.mjs` (novo) | PC, 9 testes | T1 | — |
| `testes/casa-dpapi.test.mjs` (novo) | DP, 8 testes | T2 | — |
| `testes/casa-loja-cofre.test.mjs` (novo) | LC, 9 testes | T3 | — |
| `testes/casa-testadores-cofre.test.mjs` (novo) | TC, 4 testes | T4 | — |
| `testes/cofre-cli.test.mjs` (novo) | CL, 9 testes | T5 | — |
| `docs/superpowers/plans/2026-11-04-f1-casa-sqlite.md` (modificado) | Linha 4 do escopo | T9 | — |

- Nenhum módulo novo importa `runtime/memoria.mjs` nem pacote npm, e nenhum arquivo de `dist/` muda.
- `casaDoCofre` repete as três linhas de `casaDoOmni` (`runtime/memoria.mjs:52-56`); o CL 2 prova que as duas coincidem.
- Siglas: PC = `testes/casa-pacote-cofre.test.mjs`, DP = `testes/casa-dpapi.test.mjs`, LC = `testes/casa-loja-cofre.test.mjs`, TC = `testes/casa-testadores-cofre.test.mjs`, CL = `testes/cofre-cli.test.mjs` e CB = `testes/casa-banco.test.mjs`. Nos arquivos novos, o número que segue a sigla é a posição do teste (LC 3 é o 3º teste da LC); no CB, que já existe, é a linha.
- São 40 testes novos: o verify passa de 696 para 736 (eram 39 e 735 até a T7 acrescentar o LC 10).

## Revisão da v1 do cofre e congelamento

A v1 do `cofre.db` segue revisável até este plano ([regra no plano 1](2026-11-04-f1-casa-sqlite.md#regra-de-congelamento-das-migrações)): nenhum código abria o banco `cofre`, então não existe `cofre.db` em máquina nenhuma. A revisão:
- `cifra` vira `guarda` (`dpapi` ou `gerenciador-windows`), e entra `alvo_windows`. O inventário do Gerenciador guarda só o nome do alvo; o valor fica no Windows.
- `blob` e `blob_sha256` passam a aceitar nulo, porque a credencial do Gerenciador não tem blob aqui.
- Os CHECKs amarram as três coisas: `alvo_windows` existe se, e só se, a guarda é o Gerenciador; `blob` existe se, e só se, a guarda é `dpapi`; `blob` e `blob_sha256` são nulos juntos. `agentes` e `etiquetas` precisam ser listas JSON, conferidas com `CASE`, para que um texto que não é JSON caia no CHECK em vez de lançar erro de função.
- As tabelas não mudam: a lista do cofre no CB 283 continua a mesma.
- Os nomes das colunas seguem o resto da casa: `criado_em` e `rotacionar_dias`.
- Os gatilhos de diário ficam. Eles anotam só id e versão, nunca o blob, e o UPDATE só entra quando a versão muda; por isso `registrarTeste`, que não sobe a versão, não vira tráfego. Replicar o blob por changeset não serviria: a DPAPI amarra o blob ao usuário da máquina que o selou. A viagem entre máquinas é o pacote (§8.4). O `_projecoes` guarda só o hash de cada `.dpapi` ingerido (papel `ingerida`), para que a segunda importação reconheça o arquivo; isso nasceu na T7, com o texto hex do `ConvertFrom-SecureString`.

A v1 congela com o push deste plano: daí em diante, mudança no esquema do cofre é migração nova (v2).

## O que o executor precisa saber antes de rodar qualquer coisa

1. **Casa real intocável.** A LC abre o banco numa casa temporária com `env` vazio, para nenhum `OMNI_CASA_BANCO` do ambiente desviar o banco. A CL usa `OMNI_HOME` e `OMNI_CASA_BANCO` dentro da casa temporária. A prova (T7) copia os `.dpapi` para o `$rascunho` e apaga a cópia no fim; os originais só são lidos.
2. **Guarda.** `Test-Path "$env:LOCALAPPDATA\omni\casa"` dá `False` antes e depois de cada rodada (T1 a T8).
3. **Transação não reentrante e síncrona** (`runtime/casa/banco.mjs:114` e `:209`). A ponte (cerca de 1 s por chamada) fica fora da transação, mas dentro da conexão, salvo no `inventario-windows`, que chama a ponte antes de abrir o banco. O fetch do `testar` fica fora da conexão: o `obterValor` abre a dele, devolve o valor e fecha antes do teste ao vivo.
4. **Segredo nunca em argv, log, saída, erro ou coluna em claro.** O script da ponte vai por `-EncodedCommand` e os valores pelo stdin; a CLI lê o segredo na primeira linha do stdin; o filho do `executar` recebe o valor pelo env. Os Buffers são zerados depois do uso. String do JS não se zera, e isso fica declarado: o `valor_b64` dentro do pacote aberto e o env do filho são strings.
5. **Dados reais só como contagem.** A classificação dos `.dpapi` reais mora só em `$rascunho\classificacao-p4.json`, nunca no repositório nem neste plano.
6. **O Sentinel nunca é testado ao vivo:** toda chamada vira log do lado deles. O testador recusa (TC 3, mutante 12) e a prova não o chama.
7. **Vermelho de nascença `:165`.** Arquivo novo em `runtime/` muda o fingerprint do payload. A T8 anota o valor calculado e o plano 8 regenera o contrato.
8. **Payload e autoexecutável.** `runtime/cofre.mjs` lê `process.argv[1]`, então o `runtime/integridade-release.mjs:145` o marca como autoexecutável, e o `verificarCoberturaEntrypoints` (`:152`) exige que ele esteja no payload. Ele está, por morar em `runtime/`. A pasta `testes/` fica fora do payload.
9. **As checagens do repositório não alcançam os módulos novos:** o `check-architecture` só varre `src/` e `testes/*.ts`. Quem garante a sintaxe é o `node --check` que a T5 acrescenta ao `npm run check`, e quem garante o comportamento são os testes.
10. **Grafo de imports.** A T8 não escolhe suíte à mão: o `afetadas-p4.mjs` segue o grafo a partir dos seis arquivos de `runtime/` que este plano cria ou muda.
11. **`dist` com fim de linha fantasma:** item 7 do plano 2.
12. **O typecheck não enxerga `runtime/`:** item 8 do plano 2.
13. **Node 22.** A prova e as cinco suítes rodam também no Node 22, porque o CI usa 22. O zip oficial da 22.23.4 vai para `$rascunho\node22`, conferido pelo sha256 `cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20`, e é apagado no fim da T7. Sem rede, só o 24, e isso fica declarado.
14. **Shell:** item 10 do plano 2. `$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'`.
15. **Fim de linha.** Arquivo novo é escrito com LF (o extrator grava LF), e antes do commit nenhum arquivo deste plano pode ter CR (T9).
16. **O código mora no plano.** Cada bloco que vai inteiro para o repositório abre com `arquivo=<caminho>`; cada script de apoio, com `rascunho=<nome>`. O extrator grava os blocos no destino, e `--conferir` prova no fim que o repositório e o plano dizem a mesma coisa. Edição pontual em arquivo existente aparece como trecho de antes e depois, e é feita à mão.
17. **PowerShell 5.1 com `-EncodedCommand`,** sondado em 06/11. Um argumento depois dele faz o processo sair com 4294770688 e mostrar a ajuda ("um comando já foi especificado com -Command ou -EncodedCommand"). Por isso o mutante 07 não é "o valor como argumento", que morreria por qualquer teste, e sim o vazamento silencioso do valor num comentário `<# … #>` dentro do script, que só o DP 4 pega. E `$null` vira `""` num parâmetro `string` do C#; por isso o filtro `Omni/*` do inventário está fixo no C#, e a loja ainda confere o prefixo (mutante 08).
18. **CI Linux:** item 12 do plano 2. DP 1 a 3 pulam fora do Windows. Na CI Windows, o Gerenciador pode vir vazio (erro 1168, nenhum alvo), e o DP 3 passa assim mesmo.
19. **Identidade:** item 11 do plano 2.

## Ferramentas

O extrator grava no repositório os blocos `arquivo=` e no `$rascunho` os blocos `rascunho=`. É o mesmo do plano 3, sem mudança: a preparação confere a cópia que já está no `$rascunho` contra este bloco.

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

- [x] **Passo 1: rascunho, extrator e guarda.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
New-Item -ItemType Directory -Force $rascunho | Out-Null
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-4-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --conferir --so extrair-do-plano.mjs; "saida: $LASTEXITCODE"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `igual extrair-do-plano.mjs`, `saida: 0` e `False`. Se o extrator não estiver no `$rascunho`, ele é criado à mão com o bloco acima e conferido de novo.

Resultado (06/11): o `$rascunho` tinha sido limpo depois do plano 3 e o extrator não estava lá. Ele foi criado com as linhas do bloco acima (LF, UTF-8 sem BOM), e a conferência deu `igual extrair-do-plano.mjs` com `saida: 0`. A guarda deu `False`.

### Task 1: pacote do cofre

**Arquivos:** criar `testes/casa-pacote-cofre.test.mjs` (PC, 9 testes) e `runtime/casa/pacote-cofre.mjs`. O PC prova o pacote sozinho, sem banco e sem ponte: ida e volta, frase errada, cabeçalho adulterado, parâmetros forjados recusados antes de derivar e a frase mínima de 12 caracteres. Os testes usam o scrypt com `N = 2^14`, para não levar segundos cada.

- [x] **Passo 1: o teste.**

```js arquivo=testes/casa-pacote-cofre.test.mjs
// Pacote do cofre (§8.4): ida e volta, frase errada, adulteração e limites do scrypt.
import assert from 'node:assert/strict'
import test from 'node:test'

import { abrirPacote, PARAMETROS_PADRAO, selarPacote } from '../runtime/casa/pacote-cofre.mjs'

// N=2**14 deixa a suíte rápida; o padrão (2**17) roda uma vez só, na ida e volta.
const RAPIDO = { N: 2 ** 14, r: 8, p: 1 }
const FRASE = 'frase-mestra de teste'
const CONTEUDO = { formato: 'teste', itens: [{ nome: 'x', valor_b64: Buffer.from('segredo-do-pacote').toString('base64') }] }

// Troca o cabeçalho do pacote e devolve o texto externo de novo.
function comCabecalho(texto, mudar) {
  const externo = JSON.parse(texto)
  externo.cabecalho = mudar(externo.cabecalho)
  return JSON.stringify(externo)
}
const erro = (code) => ({ name: 'PacoteCofreError', code })

test('ida e volta: o pacote abre com a mesma frase, no rápido e no padrão', () => {
  assert.deepEqual(abrirPacote(selarPacote(CONTEUDO, FRASE, RAPIDO), FRASE), CONTEUDO)
  const padrao = selarPacote(CONTEUDO, FRASE)
  assert.equal(JSON.parse(JSON.parse(padrao).cabecalho).kdf.N, PARAMETROS_PADRAO.N)
  assert.deepEqual(abrirPacote(padrao, FRASE), CONTEUDO)
})

test('nada em claro: nem o valor, nem o base64 dele, nem a frase', () => {
  const texto = selarPacote(CONTEUDO, FRASE, RAPIDO)
  assert.ok(!texto.includes('segredo-do-pacote'), 'o valor não aparece')
  assert.ok(!texto.includes(CONTEUDO.itens[0].valor_b64), 'o base64 do valor não aparece')
  assert.ok(!texto.includes(FRASE), 'a frase não aparece')
})

test('frase errada não abre', () => {
  const texto = selarPacote(CONTEUDO, FRASE, RAPIDO)
  assert.throws(() => abrirPacote(texto, 'outra frase-mestra qualquer'), erro('frase-ou-pacote'))
})

test('dados adulterados não abrem', () => {
  const externo = JSON.parse(selarPacote(CONTEUDO, FRASE, RAPIDO))
  const dados = Buffer.from(externo.dados, 'base64')
  dados[0] ^= 1
  externo.dados = dados.toString('base64')
  assert.throws(() => abrirPacote(JSON.stringify(externo), FRASE), erro('frase-ou-pacote'))
})

test('o cabeçalho é autenticado: um espaço a mais derruba a abertura', () => {
  const texto = selarPacote(CONTEUDO, FRASE, RAPIDO)
  const mexido = comCabecalho(texto, (c) => c.replace('"versao":1', '"versao": 1'))
  assert.notEqual(JSON.parse(mexido).cabecalho, JSON.parse(texto).cabecalho)
  assert.throws(() => abrirPacote(mexido, FRASE), erro('frase-ou-pacote'))
})

test('os parâmetros do pacote são conferidos antes de derivar a chave (r antes de N)', () => {
  const texto = selarPacote(CONTEUDO, FRASE, RAPIDO)
  // r=9 vem primeiro: sem a conferência, ele deriva rápido e cai em frase-ou-pacote, não em parametros.
  assert.throws(() => abrirPacote(comCabecalho(texto, (c) => c.replace('"r":8', '"r":9')), FRASE), erro('parametros'))
  assert.throws(() => abrirPacote(comCabecalho(texto, (c) => c.replace('"N":16384', '"N":524288')), FRASE), erro('parametros'))
})

test('frase-mestra: mínimo de 12 caracteres, contados depois do NFC', () => {
  assert.throws(() => selarPacote(CONTEUDO, 'a'.repeat(11), RAPIDO), erro('frase-curta'))
  assert.deepEqual(abrirPacote(selarPacote(CONTEUDO, 'a'.repeat(12), RAPIDO), 'a'.repeat(12)), CONTEUDO)
  // 'e' + acento combinante vira um caractere só no NFC: 11 deles ainda são curtos.
  assert.throws(() => selarPacote(CONTEUDO, 'e\u0301'.repeat(11), RAPIDO), erro('frase-curta'))
  // A mesma frase digitada composta ou decomposta abre o mesmo pacote.
  assert.deepEqual(abrirPacote(selarPacote(CONTEUDO, '\u00e9'.repeat(12), RAPIDO), 'e\u0301'.repeat(12)), CONTEUDO)
  assert.throws(() => selarPacote(CONTEUDO, null, RAPIDO), erro('frase-curta'))
})

test('selar recusa parâmetros fora dos limites', () => {
  for (const parametros of [{ N: 2 ** 13, r: 8, p: 1 }, { N: 2 ** 14 + 1, r: 8, p: 1 }, { N: 2 ** 14, r: 9, p: 1 }, { N: 2 ** 14, r: 8, p: 5 }]) {
    assert.throws(() => selarPacote(CONTEUDO, FRASE, parametros), erro('parametros'), JSON.stringify(parametros))
  }
})

test('o que não é pacote é recusado como formato', () => {
  assert.throws(() => abrirPacote('isso não é json', FRASE), erro('formato'))
  assert.throws(() => abrirPacote('{}', FRASE), erro('formato'))
  const texto = selarPacote(CONTEUDO, FRASE, RAPIDO)
  const salCurto = comCabecalho(texto, (c) => { const cab = JSON.parse(c); cab.kdf.sal = Buffer.alloc(8).toString('base64'); return JSON.stringify(cab) })
  assert.throws(() => abrirPacote(salCurto, FRASE), erro('formato'))
})
```

- [x] **Passo 2: extrair o teste e ver o vermelho.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-4-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so testes/casa-pacote-cofre.test.mjs
node --test --test-concurrency=1 --test-reporter=spec testes/casa-pacote-cofre.test.mjs *> "$rascunho\t1-vermelho.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t1-vermelho.txt" -Pattern 'ERR_MODULE_NOT_FOUND', '(tests|pass|fail) \d+\s*$'
```

Esperado: `gravado testes/casa-pacote-cofre.test.mjs`, `saida: 1` e `ERR_MODULE_NOT_FOUND` apontando `runtime/casa/pacote-cofre.mjs`.

Resultado (06/11): `gravado testes/casa-pacote-cofre.test.mjs`, `saida: 1` e `ERR_MODULE_NOT_FOUND` em `runtime\casa\pacote-cofre.mjs`.

- [x] **Passo 3: o módulo.**

```js arquivo=runtime/casa/pacote-cofre.mjs
// Pacote do cofre (§8.4): conteúdo cifrado por frase-mestra para viajar de máquina. O scrypt deriva a
// chave e o AES-256-GCM cifra e autentica; o cabeçalho (formato, versão, parâmetros, sal, iv) vai em
// claro e entra como AAD. Os parâmetros lidos do pacote são conferidos antes de derivar, para um
// pacote forjado não pedir memória sem fim. String do JS não se zera; os Buffers sim.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

export const FORMATO_PACOTE = 'omni-cofre-pacote'
export const FRASE_MINIMA = 12
export const PARAMETROS_PADRAO = Object.freeze({ N: 2 ** 17, r: 8, p: 1 })

export class PacoteCofreError extends Error {
  constructor(codigo, mensagem) {
    super(mensagem)
    this.name = 'PacoteCofreError'
    this.code = codigo
  }
}

const NAO_E_PACOTE = 'O arquivo não é um pacote do cofre.'
const aad = (cabecalho) => Buffer.from(cabecalho, 'utf8')

export function conferirParametros(parametros) {
  const { N, r, p } = parametros ?? {}
  const potencia = Number.isInteger(N) && N >= 2 ** 14 && N <= 2 ** 18 && (N & (N - 1)) === 0
  if (!potencia || !Number.isInteger(r) || r < 1 || r > 8 || !Number.isInteger(p) || p < 1 || p > 4) {
    throw new PacoteCofreError('parametros', 'Parâmetros do scrypt fora dos limites do cofre.')
  }
}

export function conferirFrase(frase) {
  if (typeof frase !== 'string' || [...frase.normalize('NFC')].length < FRASE_MINIMA) {
    throw new PacoteCofreError('frase-curta', `A frase-mestra precisa de pelo menos ${FRASE_MINIMA} caracteres.`)
  }
}

function derivar(frase, sal, { N, r, p }) {
  const bytes = Buffer.from(frase.normalize('NFC'), 'utf8')
  try {
    return scryptSync(bytes, sal, 32, { N, r, p, maxmem: 128 * N * r + 16 * 1024 * 1024 })
  } finally {
    bytes.fill(0)
  }
}

export function selarPacote(conteudo, frase, parametros = PARAMETROS_PADRAO) {
  conferirFrase(frase)
  conferirParametros(parametros)
  const { N, r, p } = parametros
  const sal = randomBytes(16)
  const iv = randomBytes(12)
  const cabecalho = JSON.stringify({ formato: FORMATO_PACOTE, versao: 1, kdf: { nome: 'scrypt', N, r, p, sal: sal.toString('base64') }, cifra: { nome: 'aes-256-gcm', iv: iv.toString('base64') } })
  const chave = derivar(frase, sal, parametros)
  const claro = Buffer.from(JSON.stringify(conteudo), 'utf8')
  try {
    const cifra = createCipheriv('aes-256-gcm', chave, iv)
    cifra.setAAD(aad(cabecalho))
    const dados = Buffer.concat([cifra.update(claro), cifra.final()])
    return `${JSON.stringify({ cabecalho, dados: dados.toString('base64'), etiqueta: cifra.getAuthTag().toString('base64') }, null, 2)}\n`
  } finally {
    chave.fill(0)
    claro.fill(0)
  }
}

export function abrirPacote(texto, frase) {
  conferirFrase(frase)
  let externo
  let cab
  try {
    externo = JSON.parse(texto)
    cab = typeof externo?.cabecalho === 'string' ? JSON.parse(externo.cabecalho) : null
  } catch {
    throw new PacoteCofreError('formato', NAO_E_PACOTE)
  }
  const ok = cab?.formato === FORMATO_PACOTE && cab.versao === 1 && cab.kdf?.nome === 'scrypt' && cab.cifra?.nome === 'aes-256-gcm' &&
    typeof cab.kdf.sal === 'string' && typeof cab.cifra.iv === 'string' && typeof externo.dados === 'string' && typeof externo.etiqueta === 'string'
  if (!ok) throw new PacoteCofreError('formato', NAO_E_PACOTE)
  conferirParametros(cab.kdf)
  const sal = Buffer.from(cab.kdf.sal, 'base64')
  const iv = Buffer.from(cab.cifra.iv, 'base64')
  const etiqueta = Buffer.from(externo.etiqueta, 'base64')
  if (sal.length !== 16 || iv.length !== 12 || etiqueta.length !== 16) throw new PacoteCofreError('formato', NAO_E_PACOTE)
  const chave = derivar(frase, sal, cab.kdf)
  let claro
  try {
    const decifra = createDecipheriv('aes-256-gcm', chave, iv, { authTagLength: 16 })
    decifra.setAAD(aad(externo.cabecalho))
    decifra.setAuthTag(etiqueta)
    claro = Buffer.concat([decifra.update(Buffer.from(externo.dados, 'base64')), decifra.final()])
  } catch {
    throw new PacoteCofreError('frase-ou-pacote', 'Frase errada ou pacote adulterado.')
  } finally {
    chave.fill(0)
  }
  try {
    return JSON.parse(claro.toString('utf8'))
  } catch {
    throw new PacoteCofreError('formato', 'O conteúdo do pacote não é JSON.')
  } finally {
    claro.fill(0)
  }
}
```

- [x] **Passo 4: extrair o módulo e ver o verde.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-4-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so runtime/casa/pacote-cofre.mjs
node --test --test-concurrency=1 --test-reporter=spec testes/casa-pacote-cofre.test.mjs *> "$rascunho\t1-verde.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t1-verde.txt" -Pattern '(tests|pass|fail) \d+\s*$'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `gravado runtime/casa/pacote-cofre.mjs`, `tests 9`, `pass 9`, `fail 0`, `saida: 0` e `False`.

Resultado (06/11): `gravado runtime/casa/pacote-cofre.mjs`, `tests 9`, `pass 9`, `fail 0`, `saida: 0` (1,5 s) e `False`.

### Task 2: ponte DPAPI

**Arquivos:** criar `testes/casa-dpapi.test.mjs` (DP, 8 testes) e `runtime/casa/dpapi.mjs`. DP 1 a 3 usam a DPAPI e o Gerenciador de verdade, com valores de teste e sem imprimir nada do Gerenciador; pulam fora do Windows (item 18). DP 4 a 8 usam um executor falso no lugar do PowerShell: o valor nunca vai no script nem no argv (DP 4, mutante 07), a saída é conferida linha a linha e erro do filho vira erro da ponte sem o valor.

- [x] **Passo 1: o teste.**

```js arquivo=testes/casa-dpapi.test.mjs
// Ponte DPAPI do cofre (§8.1): a real no Windows (ida e volta, lixo, inventário) e a de mentira para
// o protocolo (o segredo fora do argumento, contagem de linhas, mensagens de erro).
import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'

import { criarPonteDpapi, powershellPadrao } from '../runtime/casa/dpapi.mjs'

const NO_WINDOWS = { skip: process.platform !== 'win32' ? 'a DPAPI só existe no Windows' : false }
function executorFalso(resposta, chamadas) {
  return (comando, args, opcoes) => { chamadas.push({ comando, args, opcoes }); return { status: 0, stdout: '', stderr: '', ...resposta } }
}
const decodificarScript = (args) => Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le')
const erroDaPonte = (message) => ({ name: 'PonteDpapiError', code: 'OMNI_COFRE_PONTE', message })

test('DPAPI real: sela e abre de volta, com acento, ideograma e valor grande', NO_WINDOWS, () => {
  const ponte = criarPonteDpapi()
  const valores = ['abc', 'ção ü 日本 — teste', 'x'.repeat(5000)].map((v) => Buffer.from(v, 'utf8'))
  const blobs = ponte.selar(valores)
  assert.equal(blobs.length, 3)
  blobs.forEach((blob, i) => assert.ok(!blob.equals(valores[i]), `o blob ${i} não é o valor`))
  const abertos = ponte.abrir(blobs)
  assert.deepEqual(abertos.map((a) => a.ok), [true, true, true])
  abertos.forEach((a, i) => assert.ok(a.valor.equals(valores[i]), `o item ${i} volta igual`))
})

test('DPAPI real: lixo falha sozinho e não derruba o vizinho', NO_WINDOWS, () => {
  const ponte = criarPonteDpapi()
  const [blob] = ponte.selar([Buffer.from('vizinho bom')])
  const [lixo, bom] = ponte.abrir([Buffer.from([0, 0, 0]), blob])
  assert.deepEqual(lixo, { ok: false, erro: 'CryptographicException' })
  assert.equal(bom.ok, true)
  assert.equal(bom.valor.toString('utf8'), 'vizinho bom')
})

test('Gerenciador real: o inventário só traz alvos Omni/ e só metadados', NO_WINDOWS, () => {
  const itens = criarPonteDpapi().inventariarGerenciador()
  assert.ok(Array.isArray(itens))
  for (const item of itens) {
    assert.deepEqual(Object.keys(item).sort(), ['alvo', 'persistencia', 'tipo', 'usuario'])
    assert.ok(item.alvo.toLowerCase().startsWith('omni/'), 'todo alvo do inventário começa com Omni/')
  }
})

test('o segredo nunca vai no argumento nem no script: só no stdin', () => {
  const segredo = 'segredo-que-nao-pode-vazar'
  const b64 = Buffer.from(segredo, 'utf8').toString('base64')
  const chamadas = []
  const ponte = criarPonteDpapi({ executar: executorFalso({ stdout: 'ok QUJD\r\n' }, chamadas), powershell: 'ps-falso.exe' })
  const [blob] = ponte.selar([Buffer.from(segredo, 'utf8')])
  assert.equal(blob.toString('utf8'), 'ABC')
  assert.equal(chamadas.length, 1)
  const { comando, args, opcoes } = chamadas[0]
  assert.equal(comando, 'ps-falso.exe')
  assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand'])
  assert.equal(args.length, 4)
  assert.ok(args.every((a) => !a.includes(segredo) && !a.includes(b64)), 'nenhum argumento leva o valor')
  const script = decodificarScript(args)
  assert.ok(!script.includes(segredo), 'o valor não vai no script')
  assert.ok(!script.includes(b64), 'o valor em base64 não vai no script')
  assert.equal(opcoes.input, `selar\n${b64}\n`)
  assert.equal(opcoes.windowsHide, true)
})

test('listas vazias não chamam o PowerShell; o caminho padrão sai do SystemRoot', () => {
  const chamadas = []
  const ponte = criarPonteDpapi({ executar: executorFalso({}, chamadas) })
  assert.deepEqual(ponte.abrir([]), [])
  assert.deepEqual(ponte.selar([]), [])
  assert.equal(chamadas.length, 0)
  assert.equal(powershellPadrao({ SystemRoot: 'D:\\Win' }), join('D:\\Win', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
  assert.ok(powershellPadrao({}).startsWith('C:\\Windows'))
})

test('a ponte recusa resposta fora do protocolo, contagem errada e filho que falhou', () => {
  const um = [Buffer.from('a')]
  const com = (resposta) => criarPonteDpapi({ executar: executorFalso(resposta, []) })
  assert.throws(() => com({ stdout: 'talvez\n' }).abrir(um), erroDaPonte('a ponte DPAPI respondeu fora do protocolo'))
  assert.throws(() => com({ stdout: 'ok QQ==\nok QQ==\n' }).abrir(um), erroDaPonte('a ponte DPAPI devolveu 2 linha(s) para 1 item(ns)'))
  assert.throws(() => com({ status: 1, stderr: 'detalhe do filho' }).abrir(um), erroDaPonte('a ponte DPAPI saiu com 1'))
  assert.throws(() => com({ error: Object.assign(new Error('spawn falhou'), { code: 'ENOENT' }), status: null }).abrir(um), erroDaPonte('a ponte DPAPI não rodou: ENOENT'))
})

test('valor vazio não se sela, falha da DPAPI no selar vira erro e só bytes entram', () => {
  const chamadas = []
  const ponte = criarPonteDpapi({ executar: executorFalso({}, chamadas) })
  assert.throws(() => ponte.selar([Buffer.from('a'), Buffer.alloc(0)]), erroDaPonte('valor vazio não se sela'))
  assert.equal(chamadas.length, 0)
  const falha = criarPonteDpapi({ executar: executorFalso({ stdout: 'falha CryptographicException\n' }, []) })
  assert.throws(() => falha.selar([Buffer.from('a')]), erroDaPonte('a DPAPI não selou: CryptographicException'))
  assert.throws(() => ponte.abrir(['texto não é bytes']), erroDaPonte('a ponte DPAPI só aceita bytes'))
})

test('inventário: decodifica alvo e usuário, pula alvo vazio e recusa linha torta', () => {
  const b = (texto) => Buffer.from(texto, 'utf8').toString('base64')
  const chamadas = []
  const stdout = `cred ${b('Omni/um')} ${b('usuario-um')} 1 2\r\ncred ${b('Omni/dois')} - 1 3\r\ncred - - 1 2\r\n`
  const itens = criarPonteDpapi({ executar: executorFalso({ stdout }, chamadas) }).inventariarGerenciador()
  assert.deepEqual(itens, [
    { alvo: 'Omni/um', usuario: 'usuario-um', tipo: 1, persistencia: 2 },
    { alvo: 'Omni/dois', usuario: null, tipo: 1, persistencia: 3 }
  ])
  assert.equal(chamadas[0].opcoes.input, '')
  assert.ok(decodificarScript(chamadas[0].args).includes('CredEnumerateW("Omni/*", 0'))
  const torta = criarPonteDpapi({ executar: executorFalso({ stdout: 'cred um dois\n' }, []) })
  assert.throws(() => torta.inventariarGerenciador(), { name: 'PonteDpapiError', message: 'o inventário respondeu fora do protocolo' })
})
```

- [x] **Passo 2: extrair o teste e ver o vermelho.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-4-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so testes/casa-dpapi.test.mjs
node --test --test-concurrency=1 --test-reporter=spec testes/casa-dpapi.test.mjs *> "$rascunho\t2-vermelho.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t2-vermelho.txt" -Pattern 'ERR_MODULE_NOT_FOUND', '(tests|pass|fail) \d+\s*$'
```

Esperado: `gravado testes/casa-dpapi.test.mjs`, `saida: 1` e `ERR_MODULE_NOT_FOUND` apontando `runtime/casa/dpapi.mjs`.

Resultado (06/11): `gravado testes/casa-dpapi.test.mjs`, `saida: 1` e `ERR_MODULE_NOT_FOUND` em `runtime\casa\dpapi.mjs`.

- [x] **Passo 3: o módulo.**

```js arquivo=runtime/casa/dpapi.mjs
// Ponte DPAPI do cofre (§8.1): sela e abre valores com a DPAPI do usuário do Windows
// (ProtectedData, escopo CurrentUser) num PowerShell 5.1 filho, e lista os alvos Omni/* do
// Gerenciador de Credenciais do Windows sem ler o segredo deles.
// O segredo nunca vai no argumento do processo: o script vai em -EncodedCommand e os valores
// entram pelo stdin, um por linha, em base64. A resposta vem uma linha por item, "ok <base64>" ou
// "falha <TipoDoErro>", e a ponte confere a contagem. O stderr do filho nunca entra em mensagem.
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

export class PonteDpapiError extends Error {
  constructor(mensagem) {
    super(mensagem)
    this.name = 'PonteDpapiError'
    this.code = 'OMNI_COFRE_PONTE'
  }
}

const SCRIPT_CIFRA = String.raw`$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Security
$linhas = [Console]::In.ReadToEnd() -split "\r?\n"
$operacao = $linhas[0]
if ($operacao -ne 'selar' -and $operacao -ne 'abrir') { [Console]::Error.WriteLine('operacao desconhecida'); exit 2 }
$escopo = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
$saida = New-Object System.Text.StringBuilder
for ($i = 1; $i -lt $linhas.Length; $i++) {
  $linha = $linhas[$i]
  if ($linha -eq '') { continue }
  $entrada = $null; $resultado = $null
  try {
    $entrada = [Convert]::FromBase64String($linha)
    if ($operacao -eq 'selar') { $resultado = [System.Security.Cryptography.ProtectedData]::Protect($entrada, $null, $escopo) }
    else { $resultado = [System.Security.Cryptography.ProtectedData]::Unprotect($entrada, $null, $escopo) }
    [void]$saida.Append('ok ').Append([Convert]::ToBase64String($resultado)).Append([char]10)
  } catch {
    $e = $_.Exception; if ($e.InnerException) { $e = $e.InnerException }
    [void]$saida.Append('falha ').Append($e.GetType().Name).Append([char]10)
  } finally {
    if ($null -ne $entrada) { [Array]::Clear($entrada, 0, $entrada.Length) }
    if ($null -ne $resultado) { [Array]::Clear($resultado, 0, $resultado.Length) }
  }
}
[Console]::Out.Write($saida.ToString())
`

const SCRIPT_INVENTARIO = String.raw`$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Text;
public static class OmniInventarioCofre {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct CREDENTIAL { public int Flags; public int Type; public IntPtr TargetName; public IntPtr Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName; }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CredEnumerateW(string filter, int flags, out int count, out IntPtr credentials);
  [DllImport("advapi32.dll")] private static extern void CredFree(IntPtr buffer);
  private static string B64(IntPtr ptr) { string texto = ptr == IntPtr.Zero ? null : Marshal.PtrToStringUni(ptr); return string.IsNullOrEmpty(texto) ? "-" : Convert.ToBase64String(Encoding.UTF8.GetBytes(texto)); }
  public static string Listar() {
    int quantos; IntPtr lista;
    if (!CredEnumerateW("Omni/*", 0, out quantos, out lista)) { int erro = Marshal.GetLastWin32Error(); if (erro == 1168) return ""; throw new System.ComponentModel.Win32Exception(erro); }
    try {
      StringBuilder saida = new StringBuilder();
      for (int i = 0; i < quantos; i++) {
        IntPtr item = Marshal.ReadIntPtr(lista, i * IntPtr.Size);
        CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(item, typeof(CREDENTIAL));
        saida.Append("cred ").Append(B64(c.TargetName)).Append(' ').Append(B64(c.UserName)).Append(' ').Append(c.Type).Append(' ').Append(c.Persist).Append('\n');
      }
      return saida.ToString();
    } finally { CredFree(lista); }
  }
}
'@
[Console]::Out.Write([OmniInventarioCofre]::Listar())
`

export function powershellPadrao(env = process.env) {
  return join(env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

const codificar = (script) => Buffer.from(script, 'utf16le').toString('base64')
const linhasDe = (saida) => saida.split('\n').map((linha) => linha.replace(/\r$/, '')).filter((linha) => linha !== '')

function comoBuffer(item) {
  if (Buffer.isBuffer(item)) return item
  if (item instanceof Uint8Array) return Buffer.from(item.buffer, item.byteOffset, item.byteLength)
  throw new PonteDpapiError('a ponte DPAPI só aceita bytes')
}

export function criarPonteDpapi({ executar = spawnSync, powershell = powershellPadrao(), limiteMs = 30_000 } = {}) {
  function rodar(script, entrada) {
    const resultado = executar(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', codificar(script)], {
      input: entrada, encoding: 'utf8', windowsHide: true, timeout: limiteMs, maxBuffer: 16 * 1024 * 1024
    })
    if (resultado.error) throw new PonteDpapiError(`a ponte DPAPI não rodou: ${resultado.error.code ?? resultado.error.name}`)
    if (resultado.status !== 0) throw new PonteDpapiError(`a ponte DPAPI saiu com ${resultado.status}`)
    return linhasDe(resultado.stdout ?? '')
  }
  function cifrar(operacao, itens) {
    const bytes = itens.map(comoBuffer)
    if (bytes.length === 0) return []
    const entrada = `${operacao}\n${bytes.map((b) => (b.length === 0 ? '-' : b.toString('base64'))).join('\n')}\n`
    const linhas = rodar(SCRIPT_CIFRA, entrada)
    if (linhas.length !== bytes.length) throw new PonteDpapiError(`a ponte DPAPI devolveu ${linhas.length} linha(s) para ${bytes.length} item(ns)`)
    return linhas.map((linha) => {
      const ok = /^ok ([A-Za-z0-9+/=]*)$/.exec(linha)
      if (ok) return { ok: true, valor: Buffer.from(ok[1], 'base64') }
      const falha = /^falha (\w+)$/.exec(linha)
      if (falha) return { ok: false, erro: falha[1] }
      throw new PonteDpapiError('a ponte DPAPI respondeu fora do protocolo')
    })
  }
  return {
    selar(valores) {
      const bytes = valores.map(comoBuffer)
      if (bytes.some((b) => b.length === 0)) throw new PonteDpapiError('valor vazio não se sela')
      const resultados = cifrar('selar', bytes)
      const falha = resultados.find((r) => !r.ok)
      if (falha) throw new PonteDpapiError(`a DPAPI não selou: ${falha.erro}`)
      return resultados.map((r) => r.valor)
    },
    abrir(blobs) { return cifrar('abrir', blobs) },
    inventariarGerenciador() {
      const texto = (campo) => (campo === '-' ? null : Buffer.from(campo, 'base64').toString('utf8'))
      return rodar(SCRIPT_INVENTARIO, '').flatMap((linha) => {
        const partes = /^cred ([A-Za-z0-9+/=]+|-) ([A-Za-z0-9+/=]+|-) (\d+) (\d+)$/.exec(linha)
        if (!partes) throw new PonteDpapiError('o inventário respondeu fora do protocolo')
        const alvo = texto(partes[1])
        return alvo === null ? [] : [{ alvo, usuario: texto(partes[2]), tipo: Number(partes[3]), persistencia: Number(partes[4]) }]
      })
    }
  }
}
```

- [x] **Passo 4: extrair o módulo e ver o verde.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-4-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so runtime/casa/dpapi.mjs
node --test --test-concurrency=1 --test-reporter=spec testes/casa-dpapi.test.mjs *> "$rascunho\t2-verde.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t2-verde.txt" -Pattern '(tests|pass|fail|skipped) \d+\s*$'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `gravado runtime/casa/dpapi.mjs`, `tests 8`, `pass 8`, `fail 0`, `skipped 0` (nesta máquina, que é Windows), `saida: 0` e `False`.

Resultado (06/11): `gravado runtime/casa/dpapi.mjs`, `tests 8`, `pass 8`, `fail 0`, `skipped 0`, `saida: 0` (5,2 s, quase tudo nos três PowerShell de verdade) e `False`.

### Task 3: loja do cofre e revisão da v1

**Arquivos:** criar `testes/casa-loja-cofre.test.mjs` (LC, 9 testes) e `runtime/casa/loja-cofre.mjs`; modificar `runtime/casa/esquemas.mjs` (a v1 do cofre). A LC prova a loja com uma ponte de mentira, que "sela" com uma marca e um XOR e só abre o que tem a marca dela; outra marca faz o papel de outra máquina. Cadastro e recusa de duplicado, uso entregue e recusado (agente fora da lista, credencial do Gerenciador, blob que não abre), registro em `usos` sem o valor, importação da pasta `.dpapi` que abre antes de gravar e nunca apaga o original, divergente contado à parte, inventário que só guarda `Omni/*`, teste que não sobe versão, e a ida e volta do pacote entre duas "máquinas".

- [x] **Passo 1: o teste.**

```js arquivo=testes/casa-loja-cofre.test.mjs
// Loja do cofre (§8.1, §8.3, §8.4) sobre o cofre.db de uma casa temporária, com a ponte de mentira:
// esquema com CHECKs, cadastro, uso com registro, teste, importação da pasta .dpapi, inventário do
// Gerenciador e o pacote entre duas máquinas.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { comBancoDaCasa, sha256 } from '../runtime/casa/banco.mjs'
import { cadastrarCredencial, credencialPorNome, exportarCofre, importarPacoteCofre, importarPastaDpapi, listarCredenciais, registrarInventarioWindows, registrarTeste, usarCredencial } from '../runtime/casa/loja-cofre.mjs'
import { selarPacote } from '../runtime/casa/pacote-cofre.mjs'

const RAPIDO = { N: 2 ** 14, r: 8, p: 1 }
const FRASE = 'frase-mestra de teste'
const QUANDO = { maquina: 'maquina-a', agora: '2026-11-06T03:00:00.000Z' }

// Ponte de mentira: "sela" com uma marca e um XOR; só abre o que tem a marca dela. Outra marca é
// outra máquina: o blob de uma não abre na outra. Trata null e Uint8Array como a ponte real trataria.
function ponteFalsa(marca = 'FALSO:') {
  const chamadas = { selar: 0, abrir: 0 }
  const prefixo = Buffer.from(marca)
  const xor = (bytes) => { const saida = Buffer.from(bytes); for (let i = 0; i < saida.length; i++) saida[i] ^= 0x5a; return saida }
  return {
    chamadas,
    selar(valores) { chamadas.selar += 1; return valores.map((valor) => Buffer.concat([prefixo, xor(valor)])) },
    abrir(blobs) {
      chamadas.abrir += 1
      return blobs.map((blob) => {
        const bytes = blob instanceof Uint8Array ? Buffer.from(blob) : null
        if (!bytes || !bytes.subarray(0, prefixo.length).equals(prefixo)) return { ok: false, erro: 'CryptographicException' }
        return { ok: true, valor: xor(bytes.subarray(prefixo.length)) }
      })
    }
  }
}
// Casa temporária; o cofre.db mora dentro dela (env vazio: nenhum OMNI_CASA_BANCO do ambiente desvia o banco).
function comCasa(uso) {
  const casa = mkdtempSync(join(tmpdir(), 'omni-loja-cofre-'))
  try { return uso(casa) } finally { rmSync(casa, { recursive: true, force: true }) }
}
const comCofre = (casa, uso) => comBancoDaCasa(casa, 'cofre', uso, {})
// Linhas do node:sqlite têm protótipo nulo: o espalhamento vira objeto comum para o deepEqual.
const usos = (db) => db.prepare('SELECT nome, agente, sessao, motivo, resultado, credencial_id, id FROM usos ORDER BY rowid').all().map((linha) => ({ ...linha }))
const importacoes = (db) => db.prepare('SELECT tipo, fonte, contagens FROM _importacoes ORDER BY rowid').all().map((linha) => ({ ...linha, contagens: JSON.parse(linha.contagens) }))

test('esquema: os CHECKs amarram guarda, alvo, blob e as listas JSON', () => comCasa((casa) => comCofre(casa, (db) => {
  const inserir = db.prepare('INSERT INTO credenciais (id, nome, tipo, etiquetas, agentes, guarda, alvo_windows, blob, blob_sha256, origem_maquina, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  let n = 0
  const tentar = (mudanca) => {
    const c = { tipo: 'outro', etiquetas: '[]', agentes: '["omni"]', guarda: 'dpapi', alvo_windows: null, blob: Buffer.from('x'), blob_sha256: 'h', ...mudanca }
    n += 1
    inserir.run(`id-${n}`, `nome-${n}`, c.tipo, c.etiquetas, c.agentes, c.guarda, c.alvo_windows, c.blob, c.blob_sha256, 'maquina-a', QUANDO.agora, QUANDO.agora)
  }
  const recusas = {
    'guarda desconhecida': { guarda: 'cofre-x' },
    'gerenciador sem alvo': { guarda: 'gerenciador-windows', blob: null, blob_sha256: null },
    'dpapi sem blob': { blob: null, blob_sha256: null },
    'dpapi com alvo': { alvo_windows: 'Omni/x' },
    'blob sem hash': { blob_sha256: null },
    'agentes fora de lista': { agentes: '{}' },
    'etiquetas fora de JSON': { etiquetas: 'x' }
  }
  for (const [caso, mudanca] of Object.entries(recusas)) assert.throws(() => tentar(mudanca), { message: /CHECK constraint failed/ }, caso)
  tentar({})
  tentar({ guarda: 'gerenciador-windows', alvo_windows: 'Omni/y', blob: null, blob_sha256: null })
  assert.equal(db.prepare('SELECT count(*) AS n FROM credenciais').get().n, 2)
})))

test('cadastro: sela pela ponte, guarda só metadados em claro e recusa o que não presta', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  const c = cadastrarCredencial(db, ponte, { nome: 'servico-a', tipo: 'chave-api', servico: 'openai', etiquetas: ['ia'], agentes: ['omni', 'oraculo'] }, 'valor-a', QUANDO)
  assert.equal(c.nome, 'servico-a')
  assert.equal(c.guarda, 'dpapi')
  assert.deepEqual(c.agentes, ['omni', 'oraculo'])
  assert.deepEqual(c.etiquetas, ['ia'])
  assert.equal(c.versao, 1)
  assert.equal(c.origem_maquina, 'maquina-a')
  assert.equal('blob' in c, false)
  assert.equal(ponte.chamadas.selar, 1)
  assert.deepEqual(listarCredenciais(db), [c])
  const { blob, blob_sha256: hash } = db.prepare('SELECT blob, blob_sha256 FROM credenciais WHERE nome = ?').get('servico-a')
  assert.ok(!Buffer.from(blob).includes('valor-a'), 'o blob não leva o valor em claro')
  assert.equal(hash, sha256(Buffer.from(blob)))
  assert.throws(() => cadastrarCredencial(db, ponte, { nome: 'servico-a', tipo: 'senha' }, 'outro', QUANDO), { name: 'CofreError', code: 'ja-existe' })
  assert.equal(ponte.chamadas.selar, 1)
  assert.throws(() => cadastrarCredencial(db, ponte, { nome: 'com espaco', tipo: 'senha' }, 'v', QUANDO), { code: 'dados-invalidos' })
  assert.throws(() => cadastrarCredencial(db, ponte, { nome: 'servico-b', tipo: 'cartao' }, 'v', QUANDO), { code: 'dados-invalidos' })
  assert.throws(() => cadastrarCredencial(db, ponte, { nome: 'servico-b', tipo: 'senha', agentes: ['Omni'] }, 'v', QUANDO), { code: 'dados-invalidos' })
  assert.throws(() => cadastrarCredencial(db, ponte, { nome: 'servico-b', tipo: 'senha' }, '', QUANDO), { code: 'valor-vazio' })
  assert.equal(listarCredenciais(db).length, 1)
})))

test('uso: entrega só a agente autorizado e registra cada pedido, entregue ou recusado, sem o valor', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  cadastrarCredencial(db, ponte, { nome: 'servico-a', tipo: 'senha' }, 'valor-secreto-a', QUANDO)
  registrarInventarioWindows(db, [{ alvo: 'Omni/gerenciada', usuario: 'u', tipo: 1, persistencia: 2 }], QUANDO)
  const pedido = (nome, agente = 'omni') => ({ nome, agente, motivo: 'teste da loja', sessao: 'sessao-1' })
  assert.throws(() => usarCredencial(db, ponte, pedido('nao-existe'), QUANDO), { name: 'CofreError', code: 'inexistente' })
  assert.throws(() => usarCredencial(db, ponte, pedido('servico-a', 'overcore'), QUANDO), { code: 'agente-sem-acesso' })
  assert.throws(() => usarCredencial(db, ponte, pedido('Omni/gerenciada'), QUANDO), { code: 'gerenciador-windows' })
  const quebrada = { ...ponte, abrir() { throw new Error('ponte caiu') } }
  assert.throws(() => usarCredencial(db, quebrada, pedido('servico-a'), QUANDO), { message: 'ponte caiu' })
  assert.throws(() => usarCredencial(db, ponteFalsa('OUTRO:'), pedido('servico-a'), QUANDO), { code: 'nao-abriu' })
  const { valor, usoId } = usarCredencial(db, ponte, pedido('servico-a'), QUANDO)
  assert.equal(valor.toString('utf8'), 'valor-secreto-a')
  const linhas = usos(db)
  assert.deepEqual(linhas.map((u) => u.resultado), ['recusado-inexistente', 'recusado-agente', 'recusado-gerenciador', 'falhou-abrir', 'falhou-abrir', 'entregue'])
  assert.equal(linhas.at(-1).id, usoId)
  assert.equal(linhas[0].credencial_id, null)
  const ultimo = linhas.at(-1)
  assert.deepEqual({ agente: ultimo.agente, sessao: ultimo.sessao, motivo: ultimo.motivo }, { agente: 'omni', sessao: 'sessao-1', motivo: 'teste da loja' })
  assert.ok(!JSON.stringify(linhas).includes('valor-secreto-a'), 'nenhum uso leva o valor')
  assert.throws(() => usarCredencial(db, ponte, { nome: 'servico-a', agente: 'omni', motivo: ' ' }, QUANDO), { code: 'dados-invalidos' })
})))

test('registrarTeste: grava resultado e data sem mexer na versão nem no diário', () => comCasa((casa) => comCofre(casa, (db) => {
  cadastrarCredencial(db, ponteFalsa(), { nome: 'servico-a', tipo: 'senha' }, 'v', QUANDO)
  const diario = () => db.prepare('SELECT count(*) AS n FROM _diario').get().n
  const antes = diario()
  registrarTeste(db, 'servico-a', { ok: false, detalhe: 'x'.repeat(400) }, '2026-11-06T04:00:00.000Z')
  let c = credencialPorNome(db, 'servico-a')
  assert.equal(c.ultimo_teste_ok, false)
  assert.equal(c.ultimo_teste_detalhe.length, 300)
  assert.equal(c.ultimo_teste_em, '2026-11-06T04:00:00.000Z')
  assert.equal(c.versao, 1)
  assert.equal(diario(), antes)
  registrarTeste(db, 'servico-a', { ok: null })
  assert.equal(credencialPorNome(db, 'servico-a').ultimo_teste_ok, null)
  registrarTeste(db, 'servico-a', { ok: true, detalhe: 'HTTP 200' })
  c = credencialPorNome(db, 'servico-a')
  assert.deepEqual([c.ultimo_teste_ok, c.ultimo_teste_detalhe], [true, 'HTTP 200'])
  assert.throws(() => registrarTeste(db, 'nao-existe', { ok: true }), { code: 'inexistente' })
  assert.throws(() => registrarTeste(db, 'servico-a', { ok: 'sim' }), { code: 'dados-invalidos' })
})))

test('importação da pasta .dpapi: abre antes de gravar, classifica, não duplica e nunca apaga o original', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  const pasta = join(casa, 'access')
  mkdirSync(pasta, { recursive: true })
  const [blobA, blobB, blobBNovo] = ponte.selar([Buffer.from('valor-a'), Buffer.from('valor-b'), Buffer.from('valor-b-novo')])
  writeFileSync(join(pasta, 'a.dpapi'), blobA)
  writeFileSync(join(pasta, 'b.dpapi'), blobB)
  writeFileSync(join(pasta, 'lixo.dpapi'), 'nao e dpapi')
  writeFileSync(join(pasta, 'com espaco.dpapi'), blobA)
  writeFileSync(join(pasta, 'x.txt'), 'fora')
  const arquivos = readdirSync(pasta).sort()
  const classificacao = { a: { tipo: 'chave-api', servico: 'openai' } }
  const r1 = importarPastaDpapi(db, ponte, pasta, { classificacao, ...QUANDO })
  assert.equal(r1.importadas, 2)
  assert.deepEqual(r1.resultados, [
    { nome: 'a', resultado: 'importada' },
    { nome: 'b', resultado: 'importada' },
    { nome: 'com espaco', resultado: 'nome-invalido' },
    { nome: 'lixo', resultado: 'nao-abriu' }
  ])
  const a = credencialPorNome(db, 'a')
  const b = credencialPorNome(db, 'b')
  assert.deepEqual([a.tipo, a.servico, b.tipo, b.servico], ['chave-api', 'openai', 'outro', null])
  const usar = (nome) => usarCredencial(db, ponte, { nome, agente: 'omni', motivo: 'teste da importacao' }, QUANDO).valor.toString('utf8')
  assert.equal(usar('a'), 'valor-a')
  writeFileSync(join(pasta, 'b.dpapi'), blobBNovo)
  const r2 = importarPastaDpapi(db, ponte, pasta, QUANDO)
  assert.equal(r2.importadas, 0)
  assert.deepEqual(r2.resultados, [
    { nome: 'a', resultado: 'ja-importada' },
    { nome: 'b', resultado: 'divergente' },
    { nome: 'com espaco', resultado: 'nome-invalido' },
    { nome: 'lixo', resultado: 'nao-abriu' }
  ])
  assert.equal(usar('b'), 'valor-b')
  assert.deepEqual(readdirSync(pasta).sort(), arquivos)
  assert.deepEqual(importacoes(db).map((i) => i.contagens), [
    { 'nome-invalido': 1, importada: 2, 'nao-abriu': 1 },
    { 'ja-importada': 1, divergente: 1, 'nome-invalido': 1, 'nao-abriu': 1 }
  ])
  assert.throws(() => importarPastaDpapi(db, ponte, pasta, { classificacao: { a: { tipo: 'cartao' } } }), { code: 'classificacao-invalida' })
  assert.throws(() => importarPastaDpapi(db, ponte, pasta, { classificacao: [] }), { code: 'classificacao-invalida' })
})))

test('importação do texto hex do ConvertFrom-SecureString: abre, passa o UTF-16LE para UTF-8, re-sela e reconhece o arquivo na volta', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  const pasta = join(casa, 'access')
  mkdirSync(pasta, { recursive: true })
  // O PowerShell grava o blob como texto hex; aqui com BOM, maiúsculas e CRLF, que o leitor tolera.
  const comoTexto = (blob) => `﻿${blob.toString('hex').toUpperCase()}\r\n`
  const [blobS, blobImpar, blobSolta, blobNovo] = ponte.selar([Buffer.from('valor-ç-s', 'utf16le'), Buffer.from('abc'), Buffer.from([0x00, 0xd8]), Buffer.from('valor-novo', 'utf16le')])
  writeFileSync(join(pasta, 's.dpapi'), comoTexto(blobS))
  writeFileSync(join(pasta, 'impar.dpapi'), comoTexto(blobImpar))
  writeFileSync(join(pasta, 'solta.dpapi'), comoTexto(blobSolta))
  writeFileSync(join(pasta, 'meio.dpapi'), `${blobS.toString('hex')}zz`)
  const original = readFileSync(join(pasta, 's.dpapi'))
  const usar = () => usarCredencial(db, ponte, { nome: 's', agente: 'omni', motivo: 'teste do texto hex' }, QUANDO).valor.toString('utf8')
  const r1 = importarPastaDpapi(db, ponte, pasta, QUANDO)
  assert.equal(r1.importadas, 1)
  assert.deepEqual(r1.resultados, [
    { nome: 'impar', resultado: 'nao-abriu' },
    { nome: 'meio', resultado: 'nao-abriu' },
    { nome: 's', resultado: 'importada' },
    { nome: 'solta', resultado: 'nao-abriu' }
  ])
  assert.equal(usar(), 'valor-ç-s')
  assert.equal(credencialPorNome(db, 's').blob_sha256, sha256(ponte.selar([Buffer.from('valor-ç-s', 'utf8')])[0]))
  assert.deepEqual(db.prepare('SELECT arquivo, sha256, papel FROM _projecoes').all().map((linha) => ({ ...linha })), [{ arquivo: 'access/s.dpapi', sha256: sha256(original), papel: 'ingerida' }])
  const r2 = importarPastaDpapi(db, ponte, pasta, QUANDO)
  assert.deepEqual(r2.resultados.filter((r) => r.nome === 's'), [{ nome: 's', resultado: 'ja-importada' }])
  assert.ok(readFileSync(join(pasta, 's.dpapi')).equals(original))
  writeFileSync(join(pasta, 's.dpapi'), comoTexto(blobNovo))
  const r3 = importarPastaDpapi(db, ponte, pasta, QUANDO)
  assert.deepEqual(r3.resultados.filter((r) => r.nome === 's'), [{ nome: 's', resultado: 'divergente' }])
  assert.equal(usar(), 'valor-ç-s')
})))

test('inventário do Gerenciador: só Omni/, só o nome, sem blob, e ausente contado, nunca apagado', () => comCasa((casa) => comCofre(casa, (db) => {
  cadastrarCredencial(db, ponteFalsa(), { nome: 'Omni/ja-no-cofre', tipo: 'senha' }, 'v', QUANDO)
  const entradas = [
    { alvo: 'Omni/PostgreSQL/admin', usuario: 'postgres', tipo: 1, persistencia: 2 },
    { alvo: 'omni/minusculo', usuario: null, tipo: 1, persistencia: 2 },
    { alvo: 'Omni/ja-no-cofre', usuario: null, tipo: 1, persistencia: 2 },
    { alvo: 'Omni/com espaco', usuario: null, tipo: 1, persistencia: 2 },
    { alvo: 'Outro/Programa', usuario: 'alguem', tipo: 1, persistencia: 2 }
  ]
  const r1 = registrarInventarioWindows(db, entradas, QUANDO)
  assert.deepEqual({ inventariadas: r1.inventariadas, ausentes: r1.ausentes, ignoradas: r1.ignoradas }, { inventariadas: 2, ausentes: 0, ignoradas: 1 })
  assert.deepEqual(r1.resultados.map((r) => r.resultado), ['inventariada', 'inventariada', 'conflito', 'nome-invalido'])
  const linha = { ...db.prepare("SELECT guarda, alvo_windows, blob, blob_sha256, usuario FROM credenciais WHERE nome = 'Omni/PostgreSQL/admin'").get() }
  assert.deepEqual(linha, { guarda: 'gerenciador-windows', alvo_windows: 'Omni/PostgreSQL/admin', blob: null, blob_sha256: null, usuario: 'postgres' })
  assert.equal(credencialPorNome(db, 'omni/minusculo').guarda, 'gerenciador-windows')
  assert.equal(credencialPorNome(db, 'Outro/Programa'), null)
  const r2 = registrarInventarioWindows(db, entradas.slice(0, 1), QUANDO)
  assert.deepEqual({ inventariadas: r2.inventariadas, ausentes: r2.ausentes, ignoradas: r2.ignoradas }, { inventariadas: 0, ausentes: 1, ignoradas: 0 })
  assert.deepEqual(r2.resultados, [{ nome: 'Omni/PostgreSQL/admin', resultado: 'ja-inventariada' }])
  assert.deepEqual(importacoes(db).map((i) => i.contagens), [
    { inventariada: 2, conflito: 1, 'nome-invalido': 1, ignoradas: 1, ausentes: 0 },
    { 'ja-inventariada': 1, ignoradas: 0, ausentes: 1 }
  ])
  assert.throws(() => registrarInventarioWindows(db, 'nao e lista', QUANDO), { code: 'dados-invalidos' })
})))

test('pacote entre duas máquinas: exporta de A, importa em B re-selado pela ponte de B, com uso registrado', () => comCasa((casaA) => comCasa((casaB) => {
  const pa = ponteFalsa('FALSO:')
  const pb = ponteFalsa('OUTRO:')
  const exportado = comCofre(casaA, (db) => {
    cadastrarCredencial(db, pa, { nome: 'servico-a', tipo: 'chave-api', servico: 'openai', etiquetas: ['ia'], notas: 'nota a' }, 'valor-a', QUANDO)
    cadastrarCredencial(db, pa, { nome: 'servico-b', tipo: 'senha', agentes: ['omni', 'overcore'] }, 'valor-b', QUANDO)
    registrarInventarioWindows(db, [{ alvo: 'Omni/gerenciada', usuario: 'u', tipo: 1, persistencia: 2 }], QUANDO)
    const r = exportarCofre(db, pa, FRASE, { parametros: RAPIDO, ...QUANDO })
    assert.deepEqual([r.credenciais, r.recadastrar], [2, 1])
    assert.deepEqual(usos(db).map((u) => `${u.nome}:${u.resultado}:${u.agente}:${u.motivo}`), ['servico-a:exportada:omni:exportacao do cofre', 'servico-b:exportada:omni:exportacao do cofre'])
    for (const valor of ['valor-a', 'valor-b']) {
      assert.ok(!r.texto.includes(valor) && !r.texto.includes(Buffer.from(valor).toString('base64')), `${valor} não aparece no pacote`)
    }
    return { texto: r.texto, metadados: listarCredenciais(db).filter((c) => c.guarda === 'dpapi') }
  })
  comCofre(casaB, (db) => {
    const quandoB = { maquina: 'maquina-b', agora: QUANDO.agora }
    const r = importarPacoteCofre(db, pb, exportado.texto, FRASE, quandoB)
    assert.equal(r.importadas, 2)
    assert.deepEqual(r.recadastrar, [{ nome: 'Omni/gerenciada', alvo_windows: 'Omni/gerenciada', usuario: 'u' }])
    const usar = (nome) => usarCredencial(db, pb, { nome, agente: 'omni', motivo: 'teste do pacote' }, quandoB).valor.toString('utf8')
    assert.equal(usar('servico-a'), 'valor-a')
    assert.equal(usar('servico-b'), 'valor-b')
    const campos = ['nome', 'tipo', 'servico', 'url', 'usuario', 'notas', 'etiquetas', 'agentes', 'validade', 'rotacionar_dias']
    const so = (c) => Object.fromEntries(campos.map((k) => [k, c[k]]))
    assert.deepEqual(listarCredenciais(db).map(so), exportado.metadados.map(so))
    assert.deepEqual(listarCredenciais(db).map((c) => c.origem_maquina), ['maquina-b', 'maquina-b'])
    assert.deepEqual(importacoes(db).map((i) => `${i.tipo}:${i.fonte}`), ['pacote:pacote'])
    const deNovo = importarPacoteCofre(db, pb, exportado.texto, FRASE, quandoB)
    assert.equal(deNovo.importadas, 0)
    assert.deepEqual(deNovo.resultados.map((x) => x.resultado), ['ja-existe', 'ja-existe'])
    const { blob } = db.prepare("SELECT blob FROM credenciais WHERE nome = 'servico-a'").get()
    assert.ok(Buffer.from(blob).subarray(0, 6).equals(Buffer.from('OUTRO:')), 'o blob em B é da ponte de B')
  })
})))

test('exportação que não abre tudo não exporta nada e registra a falha; frase curta nem abre', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  cadastrarCredencial(db, ponte, { nome: 'servico-a', tipo: 'senha' }, 'valor-a', QUANDO)
  cadastrarCredencial(db, ponteFalsa('OUTRO:'), { nome: 'servico-b', tipo: 'senha' }, 'valor-b', QUANDO)
  assert.throws(() => exportarCofre(db, ponte, FRASE, { parametros: RAPIDO, ...QUANDO }), { name: 'CofreError', code: 'nao-abriu', message: '1 credencial(is) não abriram nesta máquina; nada foi exportado.' })
  assert.deepEqual(usos(db).map((u) => `${u.nome}:${u.resultado}`), ['servico-b:falhou-abrir'])
  const antes = ponte.chamadas.abrir
  assert.throws(() => exportarCofre(db, ponte, 'curta', QUANDO), { name: 'PacoteCofreError', code: 'frase-curta' })
  assert.equal(ponte.chamadas.abrir, antes)
})))

test('pacote importado: frase errada não grava nada, conteúdo de outro formato é recusado, item ruim é pulado', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  const conteudo = {
    formato: 'omni-cofre-conteudo', versao: 1, origem_maquina: 'maquina-a', exportado_em: QUANDO.agora,
    credenciais: [
      { nome: 'boa', tipo: 'senha', valor_b64: Buffer.from('valor-bom').toString('base64') },
      { nome: 'ruim', tipo: 'cartao', valor_b64: Buffer.from('x').toString('base64') },
      { nome: 'vazia', tipo: 'senha', valor_b64: '' }
    ],
    recadastrar: []
  }
  const texto = selarPacote(conteudo, FRASE, RAPIDO)
  assert.throws(() => importarPacoteCofre(db, ponte, texto, 'outra frase-mestra qualquer', QUANDO), { name: 'PacoteCofreError', code: 'frase-ou-pacote' })
  assert.equal(importacoes(db).length, 0)
  assert.throws(() => importarPacoteCofre(db, ponte, selarPacote({ ...conteudo, formato: 'outro' }, FRASE, RAPIDO), FRASE, QUANDO), { name: 'CofreError', code: 'pacote-invalido' })
  const r = importarPacoteCofre(db, ponte, texto, FRASE, QUANDO)
  assert.equal(r.importadas, 1)
  assert.deepEqual(r.resultados, [{ nome: 'ruim', resultado: 'invalida' }, { nome: 'vazia', resultado: 'invalida' }, { nome: 'boa', resultado: 'importada' }])
  assert.equal(usarCredencial(db, ponte, { nome: 'boa', agente: 'omni', motivo: 'teste do pacote' }, QUANDO).valor.toString('utf8'), 'valor-bom')
})))
```

- [x] **Passo 2: extrair o teste e ver o vermelho.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-4-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so testes/casa-loja-cofre.test.mjs
node --test --test-concurrency=1 --test-reporter=spec testes/casa-loja-cofre.test.mjs *> "$rascunho\t3-vermelho.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t3-vermelho.txt" -Pattern 'ERR_MODULE_NOT_FOUND', '(tests|pass|fail) \d+\s*$'
```

Esperado: `gravado testes/casa-loja-cofre.test.mjs`, `saida: 1` e `ERR_MODULE_NOT_FOUND` apontando `runtime/casa/loja-cofre.mjs`.

Resultado (06/11): `gravado testes/casa-loja-cofre.test.mjs`, `saida: 1` e `ERR_MODULE_NOT_FOUND` em `runtime\casa\loja-cofre.mjs`.

- [x] **Passo 3: a revisão da v1 no esquema.** Em `runtime/casa/esquemas.mjs`, dentro da v1 do cofre, trocar o trecho

```js
  cifra TEXT NOT NULL DEFAULT 'dpapi-usuario',
  blob BLOB NOT NULL,
  blob_sha256 TEXT NOT NULL,
  ${VIVO}
);
CREATE UNIQUE INDEX credenciais_nome_vivo ON credenciais (nome) WHERE apagado_em IS NULL;
```

por

```js
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
```

e, logo acima de `export const MIGRACOES_COFRE = [`, acrescentar a linha

```js
// A v1 do cofre foi revista no plano 4 (guarda dpapi | gerenciador-windows; blob nulo no inventário só de nomes) e congela com o push dele: mudança daí em diante é migração nova.
```

As colunas da tabela, na ordem, ficam `id, nome, tipo, servico, url, usuario, notas, etiquetas, agentes, validade, rotacionar_dias, ultimo_teste_em, ultimo_teste_ok, ultimo_teste_detalhe, guarda, alvo_windows, blob, blob_sha256` e as cinco do `VIVO`, e a loja expõe todas menos `blob` e `apagado_em` (`COLUNAS_PUBLICAS`).

Resultado (06/11): feito com o Edit, numstat `11	4	runtime/casa/esquemas.mjs`, CR 0.

- [x] **Passo 4: o módulo.**

```js arquivo=runtime/casa/loja-cofre.mjs
// Loja do cofre (§8.1, §8.3, §8.4): credenciais no cofre.db, com o valor selado pela DPAPI do
// usuário e só metadados em claro. Quem abre ou sela o valor é a ponte (runtime/casa/dpapi.mjs),
// sempre fora da transação; a transação só grava. Todo pedido de uso vira linha em usos, entregue ou
// recusado, e nenhuma linha leva o valor. As credenciais do Gerenciador de Credenciais do Windows
// entram só como inventário (guarda gerenciador-windows, sem blob): o cofre sabe que existem, não as abre.
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { agoraIso, maquinaAtual, sha256, transacao, uuidv7 } from './banco.mjs'
import { abrirPacote, conferirFrase, conferirParametros, PARAMETROS_PADRAO, selarPacote } from './pacote-cofre.mjs'
import { registrarProjecao, situacaoDaProjecao } from './projecao.mjs'

export const TIPOS = Object.freeze(['senha', 'token', 'chave-api', 'conexao', 'conta-servico', 'ssh', 'outro'])
const NOME = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/
const AGENTE = /^[a-z][a-z0-9-]{0,39}$/
const ETIQUETA = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,59}$/u
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
const LIMITE_DETALHE = 300
const COLUNAS_PUBLICAS = 'id, nome, tipo, servico, url, usuario, notas, etiquetas, agentes, validade, rotacionar_dias, ultimo_teste_em, ultimo_teste_ok, ultimo_teste_detalhe, guarda, alvo_windows, blob_sha256, origem_maquina, criado_em, atualizado_em, versao'
const SEM_METADADOS = Object.freeze({ url: null, usuario: null, notas: null, etiquetas: [], agentes: ['omni'], validade: null, rotacionar_dias: null })

export class CofreError extends Error {
  constructor(codigo, mensagem) {
    super(mensagem)
    this.name = 'CofreError'
    this.code = codigo
  }
}

function texto(valor, campo, { obrigatorio = false, max = 2000 } = {}) {
  if (valor === undefined || valor === null || valor === '') {
    if (obrigatorio) throw new CofreError('dados-invalidos', `Falta o campo ${campo}.`)
    return null
  }
  if (typeof valor !== 'string' || valor.length > max) throw new CofreError('dados-invalidos', `Campo ${campo} inválido.`)
  return valor
}

function lista(valor, campo, padrao, formato) {
  if (valor === undefined || valor === null) return [...padrao]
  if (!Array.isArray(valor) || valor.some((item) => typeof item !== 'string' || !formato.test(item)) || new Set(valor).size !== valor.length) {
    throw new CofreError('dados-invalidos', `Campo ${campo} inválido.`)
  }
  return [...valor]
}

function normalizarDados(dados) {
  const d = dados ?? {}
  const nome = texto(d.nome, 'nome', { obrigatorio: true, max: 200 })
  if (!NOME.test(nome)) throw new CofreError('dados-invalidos', 'Campo nome inválido.')
  if (!TIPOS.includes(d.tipo)) throw new CofreError('dados-invalidos', 'Campo tipo inválido.')
  const validade = texto(d.validade, 'validade', { max: 40 })
  if (validade !== null && Number.isNaN(Date.parse(validade))) throw new CofreError('dados-invalidos', 'Campo validade inválido.')
  const rotacionar = d.rotacionar_dias ?? null
  if (rotacionar !== null && (!Number.isInteger(rotacionar) || rotacionar < 1 || rotacionar > 3650)) throw new CofreError('dados-invalidos', 'Campo rotacionar_dias inválido.')
  return {
    nome, tipo: d.tipo,
    servico: texto(d.servico, 'servico', { max: 100 }), url: texto(d.url, 'url'),
    usuario: texto(d.usuario, 'usuario', { max: 200 }), notas: texto(d.notas, 'notas'),
    etiquetas: lista(d.etiquetas, 'etiquetas', [], ETIQUETA), agentes: lista(d.agentes, 'agentes', ['omni'], AGENTE),
    validade, rotacionar_dias: rotacionar
  }
}

function comoBytes(valor) {
  if (typeof valor === 'string') return Buffer.from(valor, 'utf8')
  if (valor instanceof Uint8Array) return Buffer.from(valor)
  throw new CofreError('dados-invalidos', 'O valor da credencial precisa ser texto ou bytes.')
}

// node:sqlite devolve linha com protótipo nulo e BLOB como Uint8Array; o espalhamento vira objeto comum.
function deLinha(linha) {
  if (!linha) return null
  return { ...linha, etiquetas: JSON.parse(linha.etiquetas), agentes: JSON.parse(linha.agentes), ultimo_teste_ok: linha.ultimo_teste_ok === null ? null : linha.ultimo_teste_ok === 1 }
}

const metadados = (c) => ({ nome: c.nome, tipo: c.tipo, servico: c.servico, url: c.url, usuario: c.usuario, notas: c.notas, etiquetas: c.etiquetas, agentes: c.agentes, validade: c.validade, rotacionar_dias: c.rotacionar_dias })
const porNome = (db, nome) => db.prepare('SELECT id, guarda, blob_sha256 FROM credenciais WHERE nome = ? AND apagado_em IS NULL').get(nome)
const jaExiste = (nome) => new CofreError('ja-existe', `Já existe uma credencial com o nome ${nome}.`)
function contar(resultados) { const contagens = {}; for (const { resultado } of resultados) contagens[resultado] = (contagens[resultado] ?? 0) + 1; return contagens }

function inserir(db, c) {
  db.prepare(`INSERT INTO credenciais (id, nome, tipo, servico, url, usuario, notas, etiquetas, agentes, validade, rotacionar_dias, guarda, alvo_windows, blob, blob_sha256, origem_maquina, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(uuidv7(Date.parse(c.agora)), c.nome, c.tipo, c.servico, c.url, c.usuario, c.notas, JSON.stringify(c.etiquetas), JSON.stringify(c.agentes), c.validade, c.rotacionar_dias, c.guarda, c.alvo_windows, c.blob, c.blob === null ? null : sha256(c.blob), c.maquina, c.agora, c.agora)
}
function registrarImportacao(db, { tipo, fonte, fonteSha256, contagens, maquina, agora }) {
  db.prepare('INSERT INTO _importacoes (id, tipo, fonte, fonte_sha256, contagens, origem_maquina, feita_em) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(uuidv7(Date.parse(agora)), tipo, fonte, fonteSha256, JSON.stringify(contagens), maquina, agora)
}
function registrarUso(db, { credencialId, nome, agente, sessao, motivo, resultado, maquina, agora }) {
  const id = uuidv7(Date.parse(agora))
  db.prepare('INSERT INTO usos (id, credencial_id, nome, agente, sessao, motivo, resultado, em, origem_maquina) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, credencialId, nome, agente, sessao, motivo, resultado, agora, maquina)
  return id
}

export function listarCredenciais(db) { return db.prepare(`SELECT ${COLUNAS_PUBLICAS} FROM credenciais WHERE apagado_em IS NULL ORDER BY nome`).all().map(deLinha) }
export function credencialPorNome(db, nome) { return deLinha(db.prepare(`SELECT ${COLUNAS_PUBLICAS} FROM credenciais WHERE nome = ? AND apagado_em IS NULL`).get(nome)) }

export function cadastrarCredencial(db, ponte, dados, valor, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  const c = normalizarDados(dados)
  const bytes = comoBytes(valor)
  try {
    if (bytes.length === 0) throw new CofreError('valor-vazio', 'O valor da credencial está vazio.')
    if (porNome(db, c.nome)) throw jaExiste(c.nome)
    const [blob] = ponte.selar([bytes])
    return transacao(db, () => {
      if (porNome(db, c.nome)) throw jaExiste(c.nome)
      inserir(db, { ...c, guarda: 'dpapi', alvo_windows: null, blob, maquina, agora })
      return credencialPorNome(db, c.nome)
    })
  } finally {
    bytes.fill(0)
  }
}

export function usarCredencial(db, ponte, pedido, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  const { nome, agente, motivo, sessao = null } = pedido ?? {}
  const valido = typeof nome === 'string' && NOME.test(nome) && typeof agente === 'string' && AGENTE.test(agente) &&
    typeof motivo === 'string' && motivo.trim() !== '' && motivo.length <= 300 && (sessao === null || (typeof sessao === 'string' && sessao.length <= 200))
  if (!valido) throw new CofreError('dados-invalidos', 'Pedido de uso inválido: nome, agente e motivo são obrigatórios.')
  const registrar = (credencialId, resultado) => registrarUso(db, { credencialId, nome, agente, sessao, motivo, resultado, maquina, agora })
  const linha = db.prepare('SELECT id, agentes, guarda, blob FROM credenciais WHERE nome = ? AND apagado_em IS NULL').get(nome)
  if (!linha) {
    registrar(null, 'recusado-inexistente')
    throw new CofreError('inexistente', `Não há credencial com o nome ${nome}.`)
  }
  if (!JSON.parse(linha.agentes).includes(agente)) {
    registrar(linha.id, 'recusado-agente')
    throw new CofreError('agente-sem-acesso', `O agente ${agente} não tem acesso a ${nome}.`)
  }
  if (linha.guarda !== 'dpapi') {
    registrar(linha.id, 'recusado-gerenciador')
    throw new CofreError('gerenciador-windows', `${nome} mora no Gerenciador de Credenciais do Windows; o cofre só tem o nome.`)
  }
  let aberto
  try {
    [aberto] = ponte.abrir([linha.blob])
  } catch (erro) {
    registrar(linha.id, 'falhou-abrir')
    throw erro
  }
  if (!aberto?.ok) {
    registrar(linha.id, 'falhou-abrir')
    throw new CofreError('nao-abriu', `${nome} não abriu nesta máquina (${aberto?.erro ?? 'sem resposta'}).`)
  }
  try {
    return { valor: aberto.valor, usoId: registrar(linha.id, 'entregue') }
  } catch (erro) {
    aberto.valor.fill(0)
    throw erro
  }
}

export function registrarTeste(db, nome, { ok, detalhe }, agora = agoraIso()) {
  if (ok !== true && ok !== false && ok !== null) throw new CofreError('dados-invalidos', 'Resultado de teste inválido.')
  const corte = detalhe === undefined || detalhe === null ? null : String(detalhe).slice(0, LIMITE_DETALHE)
  const r = db.prepare('UPDATE credenciais SET ultimo_teste_em = ?, ultimo_teste_ok = ?, ultimo_teste_detalhe = ? WHERE nome = ? AND apagado_em IS NULL')
    .run(agora, ok === null ? null : ok ? 1 : 0, corte, nome)
  if (r.changes !== 1) throw new CofreError('inexistente', `Não há credencial com o nome ${nome}.`)
}

function conferirClassificacao(classificacao) {
  if (classificacao === null || typeof classificacao !== 'object' || Array.isArray(classificacao)) throw new CofreError('classificacao-invalida', 'A classificação precisa ser um objeto nome → {tipo, servico}.')
  for (const [nome, classe] of Object.entries(classificacao)) {
    const ok = NOME.test(nome) && classe !== null && typeof classe === 'object' && TIPOS.includes(classe.tipo) &&
      (classe.servico === undefined || classe.servico === null || (typeof classe.servico === 'string' && classe.servico.length <= 100))
    if (!ok) throw new CofreError('classificacao-invalida', `Classificação inválida para ${nome}.`)
  }
}

// O ConvertFrom-SecureString do PowerShell (sem -Key) grava o blob da DPAPI como texto hex, e o valor
// selado ali dentro é UTF-16LE. Arquivo que é todo texto hex (BOM e espaço nas pontas tolerados) vem
// desse formato: o blob sai do hex, e o valor só vale se for UTF-16LE bem formado. Ele vira UTF-8 e é
// selado de novo, para o cofre guardar um formato só.
const HEX = /^(?:[0-9a-f]{2})+$/i
function blobDoTextoHex(bytes) {
  const texto = bytes.toString('latin1').replace(/^\xEF\xBB\xBF/, '').trim()
  return HEX.test(texto) ? Buffer.from(texto, 'hex') : null
}
function utf16ParaUtf8(valor) {
  if (valor.length % 2 !== 0) return null
  const texto = valor.toString('utf16le')
  return texto.isWellFormed() ? Buffer.from(texto, 'utf8') : null
}

// O .dpapi é projeção do cofre (§3.2): o hash de cada arquivo ingerido fica em _projecoes, sob
// access/<arquivo>, venha da pasta que vier. Na volta, arquivo igual ao blob guardado ou já ingerido
// é já-importada; hash nunca visto é divergente, e o banco não é sobrescrito.
export function importarPastaDpapi(db, ponte, pasta, { classificacao = {}, maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  conferirClassificacao(classificacao)
  const fonte = resolve(pasta)
  const arquivos = readdirSync(fonte, { withFileTypes: true }).filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.dpapi')).map((e) => e.name).sort()
  const resultados = []; const impressoes = []; const candidatas = []
  for (const arquivo of arquivos) {
    const nome = arquivo.slice(0, -'.dpapi'.length)
    if (!NOME.test(nome)) { resultados.push({ nome, resultado: 'nome-invalido' }); continue }
    const bruto = readFileSync(join(fonte, arquivo))
    const sha = sha256(bruto)
    const chave = `access/${arquivo}`
    impressoes.push(`${nome}:${sha}\n`)
    const atual = porNome(db, nome)
    if (atual) {
      const situacao = situacaoDaProjecao(db, chave, sha, atual.blob_sha256)
      resultados.push({ nome, resultado: situacao === 'atual' || situacao === 'defasada' ? 'ja-importada' : 'divergente' }); continue
    }
    const hex = blobDoTextoHex(bruto)
    candidatas.push({ nome, chave, sha, blob: hex ?? bruto, textoHex: hex !== null })
  }
  const abertos = candidatas.length === 0 ? [] : ponte.abrir(candidatas.map((c) => c.blob))
  const convertidos = []
  candidatas.forEach((c, i) => {
    if (abertos[i]?.ok !== true) return
    const valor = abertos[i].valor
    const utf8 = c.textoHex ? utf16ParaUtf8(valor) : null
    valor.fill(0)
    if (!c.textoHex) c.abre = true
    else if (utf8) { c.abre = true; c.convertido = convertidos.push(utf8) - 1 }
  })
  try {
    const selados = convertidos.length === 0 ? [] : ponte.selar(convertidos)
    for (const c of candidatas) if (c.convertido !== undefined) c.blob = selados[c.convertido]
  } finally { for (const v of convertidos) v.fill(0) }
  const importadas = transacao(db, () => {
    let n = 0
    for (const c of candidatas) {
      if (!c.abre) { resultados.push({ nome: c.nome, resultado: 'nao-abriu' }); continue }
      if (porNome(db, c.nome)) { resultados.push({ nome: c.nome, resultado: 'ja-existe' }); continue }
      const classe = Object.hasOwn(classificacao, c.nome) ? classificacao[c.nome] : { tipo: 'outro', servico: null }
      inserir(db, { ...SEM_METADADOS, nome: c.nome, tipo: classe.tipo, servico: classe.servico ?? null, guarda: 'dpapi', alvo_windows: null, blob: c.blob, maquina, agora })
      registrarProjecao(db, c.chave, c.sha, 'ingerida')
      resultados.push({ nome: c.nome, resultado: 'importada' }); n += 1
    }
    registrarImportacao(db, { tipo: 'dpapi', fonte, fonteSha256: sha256(impressoes.sort().join('')), contagens: contar(resultados), maquina, agora })
    return n
  })
  resultados.sort((a, b) => (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0))
  return { importadas, resultados }   // nunca apaga os originais
}

const ehDoOmni = (alvo) => typeof alvo === 'string' && alvo.toLowerCase().startsWith('omni/')

export function registrarInventarioWindows(db, entradas, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  if (!Array.isArray(entradas)) throw new CofreError('dados-invalidos', 'O inventário precisa ser uma lista.')
  const doOmni = entradas.filter((entrada) => ehDoOmni(entrada?.alvo))
  const ignoradas = entradas.length - doOmni.length
  const resultados = []; const vistos = new Set()
  const { inventariadas, ausentes } = transacao(db, () => {
    let n = 0
    for (const { alvo, usuario } of doOmni) {
      vistos.add(alvo)
      if (!NOME.test(alvo)) { resultados.push({ nome: alvo, resultado: 'nome-invalido' }); continue }
      const atual = porNome(db, alvo)
      if (atual) { resultados.push({ nome: alvo, resultado: atual.guarda === 'gerenciador-windows' ? 'ja-inventariada' : 'conflito' }); continue }
      inserir(db, { ...SEM_METADADOS, nome: alvo, tipo: 'outro', servico: null, usuario: typeof usuario === 'string' && usuario.length <= 200 ? usuario : null, guarda: 'gerenciador-windows', alvo_windows: alvo, blob: null, maquina, agora })
      resultados.push({ nome: alvo, resultado: 'inventariada' }); n += 1
    }
    const fora = db.prepare("SELECT alvo_windows FROM credenciais WHERE guarda = 'gerenciador-windows' AND apagado_em IS NULL").all().filter((l) => !vistos.has(l.alvo_windows)).length
    registrarImportacao(db, { tipo: 'gerenciador-windows', fonte: 'Credential Manager', fonteSha256: sha256([...vistos].sort().join('\n')), contagens: { ...contar(resultados), ignoradas, ausentes: fora }, maquina, agora })
    return { inventariadas: n, ausentes: fora }
  })
  return { inventariadas, ausentes, ignoradas, resultados }   // ausentes contados, nunca apagados
}

export function exportarCofre(db, ponte, frase, { parametros = PARAMETROS_PADRAO, maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  conferirFrase(frase)
  conferirParametros(parametros)
  const linhas = db.prepare(`SELECT ${COLUNAS_PUBLICAS}, blob FROM credenciais WHERE apagado_em IS NULL ORDER BY nome`).all().map(deLinha)
  const doCofre = linhas.filter((linha) => linha.guarda === 'dpapi')
  const recadastrar = linhas.filter((linha) => linha.guarda === 'gerenciador-windows').map((linha) => ({ ...metadados(linha), alvo_windows: linha.alvo_windows }))
  const abertos = doCofre.length === 0 ? [] : ponte.abrir(doCofre.map((linha) => linha.blob))
  const uso = (linha, resultado) => registrarUso(db, { credencialId: linha.id, nome: linha.nome, agente: 'omni', sessao: null, motivo: 'exportacao do cofre', resultado, maquina, agora })
  try {
    const falhas = doCofre.filter((_, i) => !abertos[i]?.ok)
    if (falhas.length > 0) {
      transacao(db, () => { for (const linha of falhas) uso(linha, 'falhou-abrir') })
      throw new CofreError('nao-abriu', `${falhas.length} credencial(is) não abriram nesta máquina; nada foi exportado.`)
    }
    const conteudo = { formato: 'omni-cofre-conteudo', versao: 1, origem_maquina: maquina, exportado_em: agora,
      credenciais: doCofre.map((linha, i) => ({ ...metadados(linha), valor_b64: abertos[i].valor.toString('base64') })), recadastrar }
    const texto = selarPacote(conteudo, frase, parametros)
    transacao(db, () => { for (const linha of doCofre) uso(linha, 'exportada') })
    return { texto, credenciais: doCofre.length, recadastrar: recadastrar.length }
  } finally {
    for (const aberto of abertos) if (aberto?.ok) aberto.valor.fill(0)
  }
}

export function importarPacoteCofre(db, ponte, texto, frase, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  const conteudo = abrirPacote(texto, frase)
  if (conteudo?.formato !== 'omni-cofre-conteudo' || conteudo.versao !== 1 || !Array.isArray(conteudo.credenciais) || !Array.isArray(conteudo.recadastrar)) {
    throw new CofreError('pacote-invalido', 'O pacote não traz um cofre do Omni.')
  }
  const resultados = []; const candidatas = []
  for (const item of conteudo.credenciais) {
    let c
    try { c = normalizarDados(item) } catch (erro) {
      if (!(erro instanceof CofreError)) throw erro
      resultados.push({ nome: typeof item?.nome === 'string' ? item.nome : null, resultado: 'invalida' }); continue
    }
    const valor = typeof item.valor_b64 === 'string' && BASE64.test(item.valor_b64) ? Buffer.from(item.valor_b64, 'base64') : null
    if (!valor || valor.length === 0) { resultados.push({ nome: c.nome, resultado: 'invalida' }); continue }
    if (porNome(db, c.nome)) { valor.fill(0); resultados.push({ nome: c.nome, resultado: 'ja-existe' }); continue }
    candidatas.push({ ...c, valor })
  }
  let blobs = []
  try { blobs = candidatas.length === 0 ? [] : ponte.selar(candidatas.map((c) => c.valor)) } finally { for (const c of candidatas) c.valor.fill(0) }
  const recadastrar = conteudo.recadastrar.map((item) => ({ nome: item?.nome ?? null, alvo_windows: item?.alvo_windows ?? null, usuario: item?.usuario ?? null }))
  const importadas = transacao(db, () => {
    let n = 0
    candidatas.forEach((c, i) => {
      if (porNome(db, c.nome)) { resultados.push({ nome: c.nome, resultado: 'ja-existe' }); return }
      inserir(db, { ...c, guarda: 'dpapi', alvo_windows: null, blob: blobs[i], maquina, agora })
      resultados.push({ nome: c.nome, resultado: 'importada' }); n += 1
    })
    registrarImportacao(db, { tipo: 'pacote', fonte: 'pacote', fonteSha256: sha256(texto), contagens: contar(resultados), maquina, agora })
    return n
  })
  return { importadas, resultados, recadastrar }
}
```

- [x] **Passo 5: extrair o módulo e ver o verde, com o CB junto.** O CB abre o `cofre.db` com a v1 revista e confere a lista de tabelas (CB 283).

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-4-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so runtime/casa/loja-cofre.mjs
node --test --test-concurrency=1 --test-reporter=spec testes/casa-loja-cofre.test.mjs testes/casa-banco.test.mjs *> "$rascunho\t3-verde.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t3-verde.txt" -Pattern '(tests|pass|fail) \d+\s*$'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `gravado runtime/casa/loja-cofre.mjs`, `tests 32` (LC 9 e CB 23), `pass 32`, `fail 0`, `saida: 0` e `False`.

Resultado (06/11): `gravado runtime/casa/loja-cofre.mjs`, `tests 32`, `pass 32`, `fail 0`, `skipped 0`, `saida: 0` (8,6 s) e `False`.

### Task 4: testadores

**Arquivos:** criar `testes/casa-testadores-cofre.test.mjs` (TC, 4 testes) e `runtime/casa/testadores-cofre.mjs`. O TC usa um `fetch` falso: o testador da OpenAI e o do fal chamam o endereço certo com o cabeçalho certo e zeram o valor depois (TC 1, mutante 13); serviço sem testador devolve "sem testador" sem abrir o valor; o Sentinel é recusado sem chamar o `fetch` (TC 3, mutante 12); e o detalhe do resultado nunca leva o valor.

- [x] **Passo 1: o teste.**

```js arquivo=testes/casa-testadores-cofre.test.mjs
// Testadores do cofre (§8.5): OpenAI por GET /v1/models com fetch de mentira; Sentinel nunca testa;
// tipo sem testador nem abre o valor.
import assert from 'node:assert/strict'
import test from 'node:test'

import { SEM_TESTE_SENTINEL, testarCredencial } from '../runtime/casa/testadores-cofre.mjs'

function fetchFalso(resposta, chamadas) {
  return async (url, opcoes) => {
    chamadas.push({ url, opcoes })
    if (resposta instanceof Error) throw resposta
    return { ok: resposta.status >= 200 && resposta.status < 300, status: resposta.status, body: null }
  }
}

test('OpenAI: GET /v1/models com o Bearer aparado; 200 é ok e o valor é zerado', async () => {
  const chamadas = []
  const valor = Buffer.from(' sk-teste-123 \n')
  let aberturas = 0
  const r = await testarCredencial({ tipo: 'chave-api', servico: 'openai' }, () => { aberturas += 1; return valor }, { fetch: fetchFalso({ status: 200 }, chamadas) })
  assert.deepEqual(r, { ok: true, detalhe: 'HTTP 200' })
  assert.equal(aberturas, 1)
  assert.equal(chamadas.length, 1)
  assert.equal(chamadas[0].url, 'https://api.openai.com/v1/models')
  assert.equal(chamadas[0].opcoes.headers.authorization, 'Bearer sk-teste-123')
  assert.ok(chamadas[0].opcoes.signal instanceof AbortSignal)
  assert.ok(valor.every((b) => b === 0), 'o valor foi zerado')
  assert.ok(!r.detalhe.includes('sk-teste'))
})

test('OpenAI: 401 e 403 são falha; 500 e rede caída ficam sem veredito', async () => {
  const testar = (resposta) => testarCredencial({ tipo: 'chave-api', servico: 'openai' }, () => Buffer.from('sk-x'), { fetch: fetchFalso(resposta, []) })
  assert.deepEqual(await testar({ status: 401 }), { ok: false, detalhe: 'HTTP 401' })
  assert.deepEqual(await testar({ status: 403 }), { ok: false, detalhe: 'HTTP 403' })
  assert.deepEqual(await testar({ status: 500 }), { ok: null, detalhe: 'HTTP 500' })
  assert.deepEqual(await testar(new TypeError('fetch failed')), { ok: null, detalhe: 'sem resposta (TypeError)' })
})

test('Sentinel nunca é testado: nem abre o valor, nem chama a rede', async () => {
  const chamadas = []
  let aberturas = 0
  const r = await testarCredencial({ tipo: 'chave-api', servico: 'sentinel' }, () => { aberturas += 1; return Buffer.from('x') }, { fetch: fetchFalso({ status: 200 }, chamadas) })
  assert.deepEqual(r, { ok: null, detalhe: SEM_TESTE_SENTINEL })
  assert.deepEqual([aberturas, chamadas.length], [0, 0])
})

test('tipo sem testador não abre o valor', async () => {
  let aberturas = 0
  const obter = () => { aberturas += 1; return Buffer.from('x') }
  assert.deepEqual(await testarCredencial({ tipo: 'conexao', servico: 'postgres' }, obter), { ok: null, detalhe: 'sem testador para conexao/postgres' })
  assert.deepEqual(await testarCredencial({ tipo: 'senha', servico: null }, obter), { ok: null, detalhe: 'sem testador para senha/-' })
  assert.equal(aberturas, 0)
})
```

- [x] **Passo 2: extrair o teste e ver o vermelho.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-4-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so testes/casa-testadores-cofre.test.mjs
node --test --test-concurrency=1 --test-reporter=spec testes/casa-testadores-cofre.test.mjs *> "$rascunho\t4-vermelho.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t4-vermelho.txt" -Pattern 'ERR_MODULE_NOT_FOUND', '(tests|pass|fail) \d+\s*$'
```

Esperado: `gravado testes/casa-testadores-cofre.test.mjs`, `saida: 1` e `ERR_MODULE_NOT_FOUND` apontando `runtime/casa/testadores-cofre.mjs`.

Resultado (06/11): `gravado testes/casa-testadores-cofre.test.mjs`, `saida: 1` e `ERR_MODULE_NOT_FOUND` em `runtime\casa\testadores-cofre.mjs`.

- [x] **Passo 3: o módulo.**

```js arquivo=runtime/casa/testadores-cofre.mjs
// Testadores do cofre (§8.5): um teste ao vivo por tipo de credencial, que diz se o valor ainda abre
// a porta do serviço. O detalhe nunca leva o valor, e o valor só é aberto quando há testador. O
// Sentinel não tem teste automático: toda chamada vira log do lado deles. O de Postgres entra no plano 5.
export const SEM_TESTE_SENTINEL = 'sem teste automático: toda chamada vira log do lado deles'
async function testarOpenai(valor, { fetch, limiteMs }) {
  let resposta
  try {
    resposta = await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${valor.toString('utf8').trim()}` }, signal: AbortSignal.timeout(limiteMs) })
  } catch (erro) {
    return { ok: null, detalhe: `sem resposta (${erro?.name ?? 'erro'})` }
  }
  try { await resposta.body?.cancel?.() } catch {}
  const detalhe = `HTTP ${resposta.status}`
  if (resposta.ok) return { ok: true, detalhe }
  if (resposta.status === 401 || resposta.status === 403) return { ok: false, detalhe }
  return { ok: null, detalhe }
}
const TESTADORES = new Map([['chave-api/openai', testarOpenai]])
export async function testarCredencial(credencial, obterValor, { fetch = globalThis.fetch, limiteMs = 10_000 } = {}) {
  if (credencial.servico === 'sentinel') return { ok: null, detalhe: SEM_TESTE_SENTINEL }
  const chave = `${credencial.tipo}/${credencial.servico ?? '-'}`
  const testador = TESTADORES.get(chave)
  if (!testador) return { ok: null, detalhe: `sem testador para ${chave}` }
  const valor = obterValor()
  try {
    return await testador(valor, { fetch, limiteMs })
  } finally {
    valor.fill(0)
  }
}
```

- [x] **Passo 4: extrair o módulo e ver o verde.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-4-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so runtime/casa/testadores-cofre.mjs
node --test --test-concurrency=1 --test-reporter=spec testes/casa-testadores-cofre.test.mjs *> "$rascunho\t4-verde.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t4-verde.txt" -Pattern '(tests|pass|fail) \d+\s*$'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `gravado runtime/casa/testadores-cofre.mjs`, `tests 4`, `pass 4`, `fail 0`, `saida: 0` e `False`.

Resultado (06/11): `gravado runtime/casa/testadores-cofre.mjs`, `tests 4`, `pass 4`, `fail 0`, `skipped 0`, `saida: 0` e `False`.

### Task 5: linha de comando e `node --check`

**Arquivos:** criar `testes/cofre-cli.test.mjs` (CL, 9 testes) e `runtime/cofre.mjs`; modificar `package.json` (o `check`). A CL roda o `rodarCofre` numa casa temporária com a ponte de mentira (a mesma `ponteFalsa` da LC, copiada: os testes não têm auxiliar compartilhado), mais um spawn real do `executar` com um filho `node` e o arquivo rodando direto. Prova: uso errado sai 2 sem ecoar argumento; `casaDoCofre` coincide com `casaDoOmni` (CL 2); o `cadastrar` lê o valor do stdin; o `executar` entrega pelo env e nunca pelo argv do filho (CL 4, mutante 11); a recusa do agente sai 3 (CL 5, mutante 01); o `exportar` recusa sobrescrever (CL 6, mutante 10); o `testar` do Sentinel recusa (CL 7, mutante 12); a frase curta é recusada depois de abrir o arquivo, que então é apagado; e o `importar-dpapi` lê a classificação com BOM.

- [x] **Passo 1: o teste.**

```js arquivo=testes/cofre-cli.test.mjs
// CLI do cofre (§8.1, §8.3, §8.4): rodarCofre com casa temporária e ponte de mentira; um spawn real
// do executar com filho node; e o arquivo rodando direto.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { comBancoDaCasa } from '../runtime/casa/banco.mjs'
import { usarCredencial } from '../runtime/casa/loja-cofre.mjs'
import { SEM_TESTE_SENTINEL } from '../runtime/casa/testadores-cofre.mjs'
import { casaDoCofre, rodarCofre } from '../runtime/cofre.mjs'
import { casaDoOmni } from '../runtime/memoria.mjs'

const RAIZ = fileURLToPath(new URL('..', import.meta.url))

// Ponte de mentira: "sela" com uma marca e um XOR; só abre o que tem a marca dela. Outra marca é
// outra máquina: o blob de uma não abre na outra. Trata null e Uint8Array como a ponte real trataria.
function ponteFalsa(marca = 'FALSO:') {
  const chamadas = { selar: 0, abrir: 0 }
  const prefixo = Buffer.from(marca)
  const xor = (bytes) => { const saida = Buffer.from(bytes); for (let i = 0; i < saida.length; i++) saida[i] ^= 0x5a; return saida }
  return {
    chamadas,
    selar(valores) { chamadas.selar += 1; return valores.map((valor) => Buffer.concat([prefixo, xor(valor)])) },
    abrir(blobs) {
      chamadas.abrir += 1
      return blobs.map((blob) => {
        const bytes = blob instanceof Uint8Array ? Buffer.from(blob) : null
        if (!bytes || !bytes.subarray(0, prefixo.length).equals(prefixo)) return { ok: false, erro: 'CryptographicException' }
        return { ok: true, valor: xor(bytes.subarray(prefixo.length)) }
      })
    }
  }
}

function saidaFalsa() { return { texto: '', write(t) { this.texto += t; return true } } }
const entrada = (texto) => Readable.from([Buffer.from(texto, 'utf8')])
const ultimaLinha = (saida) => JSON.parse(saida.texto.trim().split('\n').at(-1))
async function comCasa(uso) {
  const casa = mkdtempSync(join(tmpdir(), 'omni-cofre-cli-'))
  const env = { ...process.env, OMNI_HOME: casa, OMNI_CASA_BANCO: join(casa, 'casa') }
  try { return await uso(casa, env) } finally { rmSync(casa, { recursive: true, force: true }) }
}
async function rodar(env, argv, { stdin = '', ponte, fetch, executar } = {}) {
  const saida = saidaFalsa(); const erro = saidaFalsa()
  const codigo = await rodarCofre(argv, { entrada: entrada(stdin), saida, erro, env, ponte, fetch, executar })
  return { codigo, saida, erro }
}

test('uso errado sai com 2, mostra o uso e nunca ecoa o argumento', async () => comCasa(async (casa, env) => {
  const ok = await rodar(env, ['listar'])
  assert.equal(ok.codigo, 0)
  assert.deepEqual(ultimaLinha(ok.saida), [])
  for (const argv of [[], ['voar'], ['cadastrar', '--nome', 'x'], ['listar', '--segredo-no-argumento']]) {
    const r = await rodar(env, argv)
    assert.equal(r.codigo, 2, JSON.stringify(argv))
    assert.ok(r.erro.texto.includes('uso: node runtime/cofre.mjs'))
    assert.ok(!r.erro.texto.includes('segredo-no-argumento'))
    assert.equal(r.saida.texto, '')
  }
}))

test('a casa do cofre é a mesma casa do Omni', () => {
  for (const env of [{ OMNI_HOME: 'rel/x' }, { APPDATA: 'C:\\A' }, {}]) assert.equal(casaDoCofre(env), casaDoOmni(env), JSON.stringify(env))
})

test('cadastrar lê o valor só da primeira linha do stdin e não o devolve na saída', async () => comCasa(async (casa, env) => {
  const ponte = ponteFalsa()
  const r = await rodar(env, ['cadastrar', '--nome', 'servico-a', '--tipo', 'senha', '--agentes', 'omni, oraculo'], { stdin: 'valor-secreto-cli\r\nsegunda linha ignorada\n', ponte })
  assert.equal(r.codigo, 0)
  assert.ok(!r.saida.texto.includes('valor-secreto-cli'))
  assert.deepEqual(ultimaLinha(r.saida).credencial.agentes, ['omni', 'oraculo'])
  const valor = comBancoDaCasa(casa, 'cofre', (db) => usarCredencial(db, ponte, { nome: 'servico-a', agente: 'omni', motivo: 'teste da cli' }).valor, env)
  assert.equal(valor.toString('utf8'), 'valor-secreto-cli')
}))

test('executar entrega o valor ao filho só pelo ambiente e devolve o código dele', async () => comCasa(async (casa, env) => {
  const ponte = ponteFalsa()
  await rodar(env, ['cadastrar', '--nome', 'servico-a', '--tipo', 'senha'], { stdin: 'valor-do-filho\n', ponte })
  const filho = join(casa, 'filho.mjs')
  writeFileSync(filho, [
    "import { createHash } from 'node:crypto'",
    "import { writeFileSync } from 'node:fs'",
    "const sha = createHash('sha256').update(process.env.SEGREDO_TESTE ?? '').digest('hex')",
    'writeFileSync(process.env.FILHO_SAIDA, JSON.stringify({ sha, argv: process.argv.slice(2) }))',
    'process.exit(7)'
  ].join('\n'))
  const saidaFilho = join(casa, 'filho.json')
  const r = await rodar({ ...env, FILHO_SAIDA: saidaFilho }, ['executar', '--nome', 'servico-a', '--variavel', 'SEGREDO_TESTE', '--motivo', 'teste do executar', '--', process.execPath, filho, 'um', 'dois'], { ponte })
  assert.equal(r.codigo, 7)
  const visto = JSON.parse(readFileSync(saidaFilho, 'utf8'))
  assert.equal(visto.sha, createHash('sha256').update('valor-do-filho').digest('hex'))
  assert.deepEqual(visto.argv, ['um', 'dois'])
  assert.ok(!r.saida.texto.includes('valor-do-filho'))
  const ultimo = comBancoDaCasa(casa, 'cofre', (db) => ({ ...db.prepare('SELECT resultado, motivo FROM usos ORDER BY rowid DESC LIMIT 1').get() }), env)
  assert.deepEqual(ultimo, { resultado: 'entregue', motivo: 'teste do executar' })
}))

test('executar recusa agente sem acesso antes de criar o filho', async () => comCasa(async (casa, env) => {
  const ponte = ponteFalsa()
  await rodar(env, ['cadastrar', '--nome', 'servico-a', '--tipo', 'senha'], { stdin: 'v\n', ponte })
  let rodou = false
  const executar = () => { rodou = true; throw new Error('o filho não devia nascer') }
  const r = await rodar(env, ['executar', '--nome', 'servico-a', '--variavel', 'X', '--motivo', 'teste', '--agente', 'overcore', '--', 'qualquer'], { ponte, executar })
  assert.equal(r.codigo, 3)
  assert.deepEqual(ultimaLinha(r.saida), { ok: false, codigo: 'agente-sem-acesso', erro: 'O agente overcore não tem acesso a servico-a.' })
  assert.equal(rodou, false)
}))

test('exportar não sobrescreve, apaga o pacote que falhou, e o pacote volta noutra casa', async () => comCasa(async (casa, env) => {
  const ponte = ponteFalsa()
  await rodar(env, ['cadastrar', '--nome', 'servico-a', '--tipo', 'senha'], { stdin: 'valor-a\n', ponte })
  const pacote = join(casa, 'cofre.pacote.json')
  const frase = 'frase-mestra da cli\n'
  const r = await rodar(env, ['exportar', '--saida', pacote], { stdin: frase, ponte })
  assert.equal(r.codigo, 0)
  const linha = ultimaLinha(r.saida)
  assert.deepEqual([linha.ok, linha.credenciais, linha.recadastrar], [true, 1, 0])
  assert.equal(linha.saida, pacote)
  const texto = readFileSync(pacote, 'utf8')
  assert.ok(!texto.includes('valor-a'))
  const repetido = await rodar(env, ['exportar', '--saida', pacote], { stdin: frase, ponte })
  assert.equal(repetido.codigo, 3)
  assert.equal(ultimaLinha(repetido.saida).codigo, 'saida-existe')
  assert.equal(readFileSync(pacote, 'utf8'), texto)
  const curta = join(casa, 'curta.json')
  const r2 = await rodar(env, ['exportar', '--saida', curta], { stdin: 'curta\n', ponte })
  assert.equal(r2.codigo, 3)
  assert.equal(ultimaLinha(r2.saida).codigo, 'frase-curta')
  assert.equal(existsSync(curta), false)
  const outra = join(casa, 'outra')
  mkdirSync(outra)
  const envOutra = { ...env, OMNI_HOME: outra, OMNI_CASA_BANCO: join(outra, 'casa') }
  const pb = ponteFalsa('OUTRO:')
  const errada = await rodar(envOutra, ['importar-pacote', '--arquivo', pacote], { stdin: 'frase errada da cli\n', ponte: pb })
  assert.equal(errada.codigo, 3)
  assert.equal(ultimaLinha(errada.saida).codigo, 'frase-ou-pacote')
  const certa = await rodar(envOutra, ['importar-pacote', '--arquivo', pacote], { stdin: frase, ponte: pb })
  assert.equal(certa.codigo, 0)
  assert.equal(ultimaLinha(certa.saida).importadas, 1)
}))

test('testar: OpenAI vai à rede com o Bearer e grava o resultado; Sentinel nunca; inexistente é recusa', async () => comCasa(async (casa, env) => {
  const ponte = ponteFalsa()
  await rodar(env, ['cadastrar', '--nome', 'chave-openai', '--tipo', 'chave-api', '--servico', 'openai'], { stdin: 'sk-teste\n', ponte })
  await rodar(env, ['cadastrar', '--nome', 'chave-sentinel', '--tipo', 'chave-api', '--servico', 'sentinel'], { stdin: 'st-teste\n', ponte })
  const chamadas = []
  const fetch = async (url, opcoes) => { chamadas.push({ url, autorizacao: opcoes.headers.authorization }); return { ok: true, status: 200, body: null } }
  const r = await rodar(env, ['testar', '--nome', 'chave-openai'], { ponte, fetch })
  assert.equal(r.codigo, 0)
  assert.deepEqual(ultimaLinha(r.saida), { ok: true, nome: 'chave-openai', teste: { ok: true, detalhe: 'HTTP 200' } })
  assert.deepEqual(chamadas, [{ url: 'https://api.openai.com/v1/models', autorizacao: 'Bearer sk-teste' }])
  const lista = ultimaLinha((await rodar(env, ['listar'])).saida)
  const openai = lista.find((c) => c.nome === 'chave-openai')
  assert.deepEqual([openai.ultimo_teste_ok, openai.ultimo_teste_detalhe], [true, 'HTTP 200'])
  const s = await rodar(env, ['testar', '--nome', 'chave-sentinel'], { ponte, fetch })
  assert.deepEqual(ultimaLinha(s.saida), { ok: true, nome: 'chave-sentinel', teste: { ok: null, detalhe: SEM_TESTE_SENTINEL } })
  assert.equal(chamadas.length, 1)
  assert.equal((await rodar(env, ['testar', '--nome', 'nao-existe'], { ponte, fetch })).codigo, 3)
}))

test('importar-dpapi pela CLI: pasta padrão da casa e classificação com BOM', async () => comCasa(async (casa, env) => {
  const ponte = ponteFalsa()
  mkdirSync(join(casa, 'access'))
  const [blob] = ponte.selar([Buffer.from('valor-a')])
  writeFileSync(join(casa, 'access', 'servico-a.dpapi'), blob)
  const classificacao = join(casa, 'classificacao.json')
  writeFileSync(classificacao, `\uFEFF${JSON.stringify({ 'servico-a': { tipo: 'chave-api', servico: 'fal' } })}`)
  const r = await rodar(env, ['importar-dpapi', '--classificacao', classificacao], { ponte })
  assert.equal(r.codigo, 0)
  assert.deepEqual(ultimaLinha(r.saida), { ok: true, importadas: 1, resultados: [{ nome: 'servico-a', resultado: 'importada' }] })
  const [c] = ultimaLinha((await rodar(env, ['listar'])).saida)
  assert.deepEqual([c.tipo, c.servico], ['chave-api', 'fal'])
  const torta = join(casa, 'torta.json')
  writeFileSync(torta, '{ isso não é json')
  assert.equal((await rodar(env, ['importar-dpapi', '--classificacao', torta], { ponte })).codigo, 2)
}))

test('o arquivo roda direto: node runtime/cofre.mjs listar', () => comCasa(async (casa, env) => {
  const r = spawnSync(process.execPath, [join(RAIZ, 'runtime', 'cofre.mjs'), 'listar'], { env, encoding: 'utf8', windowsHide: true, timeout: 60_000 })
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(JSON.parse(r.stdout.trim()), [])
}))
```

- [x] **Passo 2: extrair o teste e ver o vermelho.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-4-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so testes/cofre-cli.test.mjs
node --test --test-concurrency=1 --test-reporter=spec testes/cofre-cli.test.mjs *> "$rascunho\t5-vermelho.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t5-vermelho.txt" -Pattern 'ERR_MODULE_NOT_FOUND', '(tests|pass|fail) \d+\s*$'
```

Esperado: `gravado testes/cofre-cli.test.mjs`, `saida: 1` e `ERR_MODULE_NOT_FOUND` apontando `runtime/cofre.mjs`.

Resultado (06/11): `gravado testes/cofre-cli.test.mjs`, `saida: 1` e `ERR_MODULE_NOT_FOUND` em `runtime\cofre.mjs`.

- [x] **Passo 3: o módulo.**

```js arquivo=runtime/cofre.mjs
// Linha de comando do cofre do Omni (§8.1, §8.3, §8.4). Segredo nunca entra por argumento: o valor
// da credencial e a frase-mestra chegam pela primeira linha do stdin, e o executar entrega o valor
// ao processo filho numa variável de ambiente. O stdin só é tocado por quem lê; no executar ele
// fica intocado e o filho o herda. A saída é JSON numa linha e nunca leva o valor.
// Códigos de saída: 0 ok; 2 uso errado; 3 recusa do cofre; 1 falha inesperada (vai para degradacoes.jsonl).
import { spawn } from 'node:child_process'
import { closeSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { comBancoDaCasa, registrarDegradacao } from './casa/banco.mjs'
import { criarPonteDpapi } from './casa/dpapi.mjs'
import { CofreError, cadastrarCredencial, credencialPorNome, exportarCofre, importarPacoteCofre, importarPastaDpapi, listarCredenciais, registrarInventarioWindows, registrarTeste, usarCredencial } from './casa/loja-cofre.mjs'
import { PacoteCofreError } from './casa/pacote-cofre.mjs'
import { testarCredencial } from './casa/testadores-cofre.mjs'

const USO = `uso: node runtime/cofre.mjs <comando> [opções]
  listar
  cadastrar --nome <n> --tipo <t> [--servico <s>] [--url <u>] [--usuario <u>] [--notas <n>] [--agentes <a,b>]   (valor pelo stdin)
  importar-dpapi [--pasta <pasta>] [--classificacao <arquivo.json>]
  inventario-windows
  exportar --saida <arquivo>   (frase-mestra pelo stdin)
  importar-pacote --arquivo <arquivo>   (frase-mestra pelo stdin)
  testar --nome <n>
  executar --nome <n> --variavel <VAR> --motivo <m> [--agente omni] [--sessao <s>] -- <comando> [args...]`
const VARIAVEL = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const LIMITE_LINHA = 64 * 1024
class UsoError extends Error {}

export function casaDoCofre(env = process.env) {
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
async function linhaDaEntrada(entrada) {
  const pedacos = []; let total = 0
  try {
    for await (const pedaco of entrada) {
      const bytes = Buffer.isBuffer(pedaco) ? pedaco : Buffer.from(pedaco)
      pedacos.push(bytes); total += bytes.length
      if (bytes.includes(10)) break
      if (total > LIMITE_LINHA) throw new UsoError('a linha do stdin passou de 64 KB')
    }
    const tudo = Buffer.concat(pedacos)
    try {
      let fim = tudo.indexOf(10); if (fim === -1) fim = tudo.length
      if (fim > 0 && tudo[fim - 1] === 13) fim -= 1
      const inicio = tudo[0] === 0xef && tudo[1] === 0xbb && tudo[2] === 0xbf ? 3 : 0
      return Buffer.from(tudo.subarray(inicio, Math.max(inicio, fim)))
    } finally { tudo.fill(0) }
  } finally { for (const pedaco of pedacos) pedaco.fill(0) }
}
function lerClassificacao(arquivo) {
  if (arquivo === undefined) return {}
  try { return JSON.parse(readFileSync(arquivo, 'utf8').replace(/^\uFEFF/, '')) } catch { throw new UsoError('não consegui ler a classificação (JSON)') }
}

export async function rodarCofre(argv, { entrada, saida = process.stdout, erro = process.stderr, env = process.env, ponte, fetch = globalThis.fetch, executar = spawn } = {}) {
  const casa = casaDoCofre(env)
  let ponteViva = ponte
  const daPonte = () => (ponteViva ??= criarPonteDpapi())
  const comCofre = (uso) => comBancoDaCasa(casa, 'cofre', uso, env)   // uso síncrono
  const lerLinha = () => linhaDaEntrada(entrada ?? process.stdin)
  const escrever = (objeto) => saida.write(`${JSON.stringify(objeto)}\n`)
  const [comando, ...resto] = argv
  try {
    switch (comando) {
      case 'listar': { lerOpcoes(resto, {}); escrever(comCofre((db) => listarCredenciais(db))); return 0 }
      case 'cadastrar': {
        const o = lerOpcoes(resto, { nome: { type: 'string' }, tipo: { type: 'string' }, servico: { type: 'string' }, url: { type: 'string' }, usuario: { type: 'string' }, notas: { type: 'string' }, agentes: { type: 'string' } }, ['nome', 'tipo'])
        const valor = await lerLinha()
        try {
          const dados = { nome: o.nome, tipo: o.tipo, servico: o.servico, url: o.url, usuario: o.usuario, notas: o.notas, agentes: o.agentes === undefined ? undefined : o.agentes.split(',').map((a) => a.trim()).filter(Boolean) }
          escrever({ ok: true, credencial: comCofre((db) => cadastrarCredencial(db, daPonte(), dados, valor)) })
          return 0
        } finally { valor.fill(0) }
      }
      case 'importar-dpapi': {
        const o = lerOpcoes(resto, { pasta: { type: 'string' }, classificacao: { type: 'string' } })
        const classificacao = lerClassificacao(o.classificacao)
        const r = comCofre((db) => importarPastaDpapi(db, daPonte(), o.pasta ?? join(casa, 'access'), { classificacao }))
        escrever({ ok: true, importadas: r.importadas, resultados: r.resultados }); return 0
      }
      case 'inventario-windows': {
        lerOpcoes(resto, {})
        const entradas = daPonte().inventariarGerenciador()   // fora da conexão
        escrever({ ok: true, ...comCofre((db) => registrarInventarioWindows(db, entradas)) }); return 0
      }
      case 'exportar': {
        const o = lerOpcoes(resto, { saida: { type: 'string' } }, ['saida'])
        const destino = resolve(o.saida)
        const fraseBytes = await lerLinha()
        let descritor = null; let gravado = false
        try {
          try { descritor = openSync(destino, 'wx', 0o600) } catch (falha) {
            if (falha.code === 'EEXIST') throw new CofreError('saida-existe', 'O arquivo de saída já existe; o cofre não sobrescreve pacote.')
            throw falha
          }
          const r = comCofre((db) => exportarCofre(db, daPonte(), fraseBytes.toString('utf8')))
          writeSync(descritor, r.texto); gravado = true
          escrever({ ok: true, saida: destino, credenciais: r.credenciais, recadastrar: r.recadastrar }); return 0
        } finally {
          fraseBytes.fill(0)
          if (descritor !== null) closeSync(descritor)
          if (descritor !== null && !gravado) rmSync(destino, { force: true })
        }
      }
      case 'importar-pacote': {
        const o = lerOpcoes(resto, { arquivo: { type: 'string' } }, ['arquivo'])
        let texto
        try { texto = readFileSync(o.arquivo, 'utf8') } catch { throw new UsoError('não consegui ler o pacote') }
        const fraseBytes = await lerLinha()
        try { escrever({ ok: true, ...comCofre((db) => importarPacoteCofre(db, daPonte(), texto, fraseBytes.toString('utf8'))) }); return 0 }
        finally { fraseBytes.fill(0) }
      }
      case 'testar': {
        const o = lerOpcoes(resto, { nome: { type: 'string' } }, ['nome'])
        const credencial = comCofre((db) => credencialPorNome(db, o.nome))
        if (!credencial) throw new CofreError('inexistente', `Não há credencial com o nome ${o.nome}.`)
        const obterValor = () => comCofre((db) => usarCredencial(db, daPonte(), { nome: o.nome, agente: 'omni', motivo: 'teste do cofre' }).valor)
        const resultado = await testarCredencial(credencial, obterValor, { fetch })   // fetch fora da conexão
        comCofre((db) => registrarTeste(db, o.nome, resultado))
        escrever({ ok: true, nome: o.nome, teste: resultado }); return 0
      }
      case 'executar': {
        const separador = resto.indexOf('--')
        if (separador === -1 || separador === resto.length - 1) throw new UsoError('falta o comando depois de --')
        const o = lerOpcoes(resto.slice(0, separador), { nome: { type: 'string' }, variavel: { type: 'string' }, motivo: { type: 'string' }, agente: { type: 'string' }, sessao: { type: 'string' } }, ['nome', 'variavel', 'motivo'])
        if (!VARIAVEL.test(o.variavel)) throw new UsoError('variável de ambiente inválida')
        const [programa, ...argumentos] = resto.slice(separador + 1)
        const { valor } = comCofre((db) => usarCredencial(db, daPonte(), { nome: o.nome, agente: o.agente ?? 'omni', motivo: o.motivo, sessao: o.sessao ?? null }))
        let filhoEnv
        try { filhoEnv = { ...env, [o.variavel]: valor.toString('utf8') } } finally { valor.fill(0) }
        return await new Promise((resolver) => {
          const filho = executar(programa, argumentos, { stdio: 'inherit', env: filhoEnv, windowsHide: true, shell: false })
          filho.on('error', () => resolver(1))
          filho.on('exit', (codigo, sinal) => resolver(codigo ?? (sinal ? 1 : 0)))
        })
      }
      default: throw new UsoError(comando === undefined ? 'falta o comando' : 'comando desconhecido')
    }
  } catch (falha) {
    if (falha instanceof UsoError) { erro.write(`${falha.message}\n${USO}\n`); return 2 }
    if (falha instanceof CofreError || falha instanceof PacoteCofreError) { escrever({ ok: false, codigo: falha.code, erro: falha.message }); return 3 }
    registrarDegradacao(casa, 'cofre.cli', falha, env)
    erro.write(`falha inesperada no cofre: ${String(falha?.message ?? falha).slice(0, 300)}\n`)
    return 1
  }
}

const direto = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (direto) process.exitCode = await rodarCofre(process.argv.slice(2))
```

- [x] **Passo 4: extrair o módulo e ver o verde.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-4-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so runtime/cofre.mjs
node --test --test-concurrency=1 --test-reporter=spec testes/cofre-cli.test.mjs *> "$rascunho\t5-verde.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t5-verde.txt" -Pattern '(tests|pass|fail) \d+\s*$'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `gravado runtime/cofre.mjs`, `tests 9`, `pass 9`, `fail 0`, `saida: 0` e `False`.

Resultado (06/11): `gravado runtime/cofre.mjs`, `tests 9`, `pass 9`, `fail 0`, `skipped 0`, `saida: 0` (1,8 s) e `False`.

- [x] **Passo 5: o furo do `check`.** O `npm run check` ainda não olha os módulos novos (item 9). O `mutante-sintaxe.mjs` acrescenta uma linha inválida no fim de um arquivo, roda o `check` e restaura o arquivo sempre.

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
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-4-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so mutante-sintaxe.mjs
$alvos = 'runtime/casa/dpapi.mjs', 'runtime/casa/pacote-cofre.mjs', 'runtime/casa/loja-cofre.mjs', 'runtime/casa/testadores-cofre.mjs', 'runtime/cofre.mjs'
foreach ($alvo in $alvos) { node "$rascunho\mutante-sintaxe.mjs" . $alvo }
```

Esperado: para cada um dos cinco, `status 0; SyntaxError: false` e `restaurado: true`. É o furo: sintaxe quebrada passa no `check`.

Resultado (06/11): os cinco com `status 0; SyntaxError: false; aponta: (nenhuma linha cita o arquivo)` e `restaurado: true`, com os hashes de volta (dpapi `23651e8acde0`, pacote `c5b2edcf4515`, loja `72372b53b345`, testadores `400fa4882807`, cofre `f1d2217ac149`).

- [x] **Passo 6: fechar o furo.** No `package.json`, no script `check`, trocar

```text
node --check runtime/recibos-evolucao.mjs &&node --check runtime/contexto.mjs
```

por

```text
node --check runtime/recibos-evolucao.mjs && node --check runtime/casa/dpapi.mjs && node --check runtime/casa/pacote-cofre.mjs && node --check runtime/casa/loja-cofre.mjs && node --check runtime/casa/testadores-cofre.mjs && node --check runtime/cofre.mjs &&node --check runtime/contexto.mjs
```

O `&&node` colado do fim já estava assim e fica como está, para o diff mudar só o necessário.

Resultado (06/11): feito com o Edit; a linha ficou igual à do bloco acima.

- [x] **Passo 7: a morte e o verde do `check`.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-4-cofre.md'
$alvos = 'runtime/casa/dpapi.mjs', 'runtime/casa/pacote-cofre.mjs', 'runtime/casa/loja-cofre.mjs', 'runtime/casa/testadores-cofre.mjs', 'runtime/cofre.mjs'
foreach ($alvo in $alvos) { 'linhas de ' + $alvo + ': ' + (Get-Content $alvo).Count; node "$rascunho\mutante-sintaxe.mjs" . $alvo }
npm run check *> "$rascunho\t5-check.txt"; "saida: $LASTEXITCODE"
git diff --numstat -- package.json
foreach ($a in @('package.json') + $alvos) { $a + ' CR: ' + ([IO.File]::ReadAllText((Resolve-Path $a)).Split([char]13).Count - 1) }
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --conferir --so mutante-sintaxe.mjs; "saida: $LASTEXITCODE"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: para cada alvo, `status 1; SyntaxError: true`, apontando a linha (total + 2) do próprio arquivo, e `restaurado: true`; o `npm run check` com `saida: 0`; numstat `1	1	package.json`; CR 0 nos seis; `igual mutante-sintaxe.mjs` com `saida: 0`; e `False`.

Resultado (06/11): os cinco com `status 1; SyntaxError: true`, apontando a linha total + 2 (dpapi 130 → 132, pacote 102 → 104, loja 283 → 285, testadores 30 → 32, cofre 161 → 163), e `restaurado: true` com os mesmos hashes do Passo 5; o `npm run check` com `saida: 0`; numstat `1	1	package.json`; CR 0 nos seis; `igual mutante-sintaxe.mjs` com `saida: 0`; e `False`.

### Task 6: mutação

Dezoito mutantes: catorze da rodada da T6 e quatro (15 a 18) que a T7 acrescentou junto com o leitor do texto hex do `ConvertFrom-SecureString`. Cada um tem o trecho exato (uma vez só no arquivo), a troca e as suítes que devem matá-lo. O executor aplica um por vez, roda as suítes do mutante pelo `run()` do `node:test`, restaura sempre e anota cada teste que caiu. A tabela derruba a rodada se um mutante sobreviver sem estar declarado equivalente, se uma queda não for `AssertionError` com `ERR_ASSERTION` ou se vier de suíte fora das do mutante: mutante que morre no setup não prova nada.

```js rascunho=gerar-mutantes-p4.mjs
// Gera mutantes-p4.json: os 18 mutantes do plano 4, cada um com o trecho exato (uma vez só no arquivo), a troca e as suítes que devem matá-lo.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PC = 'testes/casa-pacote-cofre.test.mjs'
const DP = 'testes/casa-dpapi.test.mjs'
const LC = 'testes/casa-loja-cofre.test.mjs'
const TC = 'testes/casa-testadores-cofre.test.mjs'
const CL = 'testes/cofre-cli.test.mjs'
const LOJA = 'runtime/casa/loja-cofre.mjs'
const PACOTE = 'runtime/casa/pacote-cofre.mjs'
const PONTE = 'runtime/casa/dpapi.mjs'
const TESTADORES = 'runtime/casa/testadores-cofre.mjs'
const CLI = 'runtime/cofre.mjs'

const lista = [
  { nome: '01 recusa do agente desligada', arquivo: LOJA, de: 'if (!JSON.parse(linha.agentes).includes(agente)) {', para: 'if (false) {', teste: [LC, CL] },
  { nome: '02 recusa do agente sem registro em usos', arquivo: LOJA, de: "registrar(linha.id, 'recusado-agente')", para: "void 'recusado-agente'", teste: [LC] },
  { nome: '03 credencial do Gerenciador entregue como DPAPI', arquivo: LOJA, de: "if (linha.guarda !== 'dpapi') {", para: 'if (false) {', teste: [LC] },
  { nome: '04 cabeçalho fora da autenticação', arquivo: PACOTE, de: "const aad = (cabecalho) => Buffer.from(cabecalho, 'utf8')", para: 'const aad = () => Buffer.alloc(0)', teste: [PC] },
  { nome: '05 parâmetros do pacote não conferidos ao abrir', arquivo: PACOTE, de: 'conferirParametros(cab.kdf)', para: 'void cab.kdf', teste: [PC] },
  { nome: '06 frase mínima de 11', arquivo: PACOTE, de: 'export const FRASE_MINIMA = 12', para: 'export const FRASE_MINIMA = 11', teste: [PC] },
  { nome: '07 segredo da ponte no comando codificado', arquivo: PONTE, de: "'-EncodedCommand', codificar(script)]", para: "'-EncodedCommand', codificar(`${script}\\n<#${entrada}#>`)]", teste: [DP] },
  { nome: '08 inventário sem o filtro Omni/', arquivo: LOJA, de: "const ehDoOmni = (alvo) => typeof alvo === 'string' && alvo.toLowerCase().startsWith('omni/')", para: "const ehDoOmni = (alvo) => typeof alvo === 'string'", teste: [LC] },
  { nome: '09 divergente contado como já importado', arquivo: LOJA, de: "situacao === 'atual' || situacao === 'defasada' ? 'ja-importada' : 'divergente'", para: "'ja-importada'", teste: [LC] },
  { nome: '10 exportar sobrescreve o pacote', arquivo: CLI, de: "openSync(destino, 'wx', 0o600)", para: "openSync(destino, 'w', 0o600)", teste: [CL] },
  { nome: '11 segredo no argumento do filho', arquivo: CLI, de: 'executar(programa, argumentos, {', para: 'executar(programa, [...argumentos, filhoEnv[o.variavel]], {', teste: [CL] },
  { nome: '12 Sentinel sem a guarda', arquivo: TESTADORES, de: "credencial.servico === 'sentinel'", para: 'false', teste: [TC, CL] },
  { nome: '13 valor do teste não zerado', arquivo: TESTADORES, de: 'valor.fill(0)', para: 'void valor', teste: [TC] },
  { nome: '14 pacote sem conferir o formato do conteúdo', arquivo: LOJA, de: "conteudo?.formato !== 'omni-cofre-conteudo' ||", para: 'false ||', teste: [LC] },
  { nome: '15 texto hex do SecureString não reconhecido', arquivo: LOJA, de: "return HEX.test(texto) ? Buffer.from(texto, 'hex') : null", para: 'return null', teste: [LC] },
  { nome: '16 texto hex gravado sem re-selar em UTF-8', arquivo: LOJA, de: 'c.blob = selados[c.convertido]', para: 'void selados[c.convertido]', teste: [LC] },
  { nome: '17 arquivo já ingerido contado como divergente', arquivo: LOJA, de: "situacao === 'atual' || situacao === 'defasada' ?", para: "situacao === 'atual' ?", teste: [LC] },
  { nome: '18 UTF-16LE de tamanho ímpar aceito', arquivo: LOJA, de: 'if (valor.length % 2 !== 0) return null', para: 'if (false) return null', teste: [LC] }
]
writeFileSync(join(import.meta.dirname, 'mutantes-p4.json'), `${JSON.stringify(lista, null, 2)}\n`)
console.log(`${lista.length} mutantes gravados`)
```

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

```js rascunho=tabela-mutantes-p4.mjs
// Monta a tabela do Apêndice A do plano 4 a partir de mutantes-p4.json e mutantes-p4.saida.jsonl.
// Derruba a tabela (saída 1) se faltar linha, se um mutante não ficar vermelho sem estar na lista de
// equivalentes, se uma queda não for AssertionError com ERR_ASSERTION ou se vier de suíte fora das do mutante.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const pasta = import.meta.dirname
const lista = JSON.parse(readFileSync(join(pasta, 'mutantes-p4.json'), 'utf8'))
const linhas = readFileSync(join(pasta, 'mutantes-p4.saida.jsonl'), 'utf8').split('\n').filter(Boolean).map((linha) => JSON.parse(linha))
const EQUIVALENTES = new Map() // nome do mutante → razão; vazia enquanto nenhum for declarado
const SIGLAS = new Map([
  ['testes/casa-pacote-cofre.test.mjs', 'PC'],
  ['testes/casa-dpapi.test.mjs', 'DP'],
  ['testes/casa-loja-cofre.test.mjs', 'LC'],
  ['testes/casa-testadores-cofre.test.mjs', 'TC'],
  ['testes/cofre-cli.test.mjs', 'CL'],
  ['testes/casa-banco.test.mjs', 'CB']
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
writeFileSync(join(pasta, 'tabela-mutantes-p4.md'), `${tabela.join('\n')}\n`)
for (const problema of problemas) console.log(`PROBLEMA ${problema}`)
console.log(`${lista.length} linhas: ${vermelhos} vermelhos, ${EQUIVALENTES.size} equivalente(s); testes mapeados: ${mapeados}`)
process.exitCode = problemas.length > 0 ? 1 : 0
```

Mapa previsto de mutante para teste:

| Mutante | Morre em | Como cai |
|---|---|---|
| 01 | LC 3 e CL 5 | `throws` sem exceção; no CL 5, o executar falso lança, vira degradação e sai 1≠3 |
| 02 | LC 3 | deepEqual dos usos |
| 03 | LC 3 | `throws` com outro erro (`nao-abriu`) |
| 04 | PC 5 | `throws` sem exceção |
| 05 | PC 6 | |
| 06 | PC 7 | |
| 07 | DP 4 | `ok` ("o valor em base64 não vai no script") |
| 08 | LC 6 | |
| 09 | LC 5 e LC 10 | deepEqual (`ja-importada` no lugar de `divergente`) |
| 10 | CL 6 | 0≠3 |
| 11 | CL 4 | |
| 12 | TC 3 e CL 7 | |
| 13 | TC 1 | |
| 14 | LC 9 | |
| 15 | LC 10 | `equal` das importadas (0≠1) |
| 16 | LC 10 | `equal` do valor (UTF-16LE no lugar de UTF-8) |
| 17 | LC 10 | deepEqual da segunda passada (`divergente` no lugar de `ja-importada`) |
| 18 | LC 10 | `equal` das importadas (2≠1) |

- [x] **Passo 1: extrair, gerar a lista e anotar os hashes.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-4-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so gerar-mutantes-p4.mjs mutantes.mjs tabela-mutantes-p4.mjs
node "$rascunho\gerar-mutantes-p4.mjs"
$alvos = 'runtime/casa/dpapi.mjs', 'runtime/casa/pacote-cofre.mjs', 'runtime/casa/loja-cofre.mjs', 'runtime/casa/testadores-cofre.mjs', 'runtime/cofre.mjs'
$antes = $alvos | ForEach-Object { $_ + ' ' + (Get-FileHash $_ -Algorithm SHA256).Hash.Substring(0, 12) }
$antes
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: três `gravado` (ou `igual`), `18 mutantes gravados` (`14` na rodada da T6, antes dos quatro da T7), cinco hashes e `False`.

Resultado (06/11): três `gravado`, `14 mutantes gravados`, os cinco hashes (dpapi `23651E8ACDE0`, pacote `C5B2EDCF4515`, loja `72372B53B345`, testadores `400FA4882807`, cofre `F1D2217AC149`) e `False`. Os hashes foram gravados também em `$rascunho\hashes-antes-p4.txt`: cada chamada do PowerShell é um processo novo, e o `$antes` não sobrevive até o Passo 3.

- [x] **Passo 2: rodar, em segundo plano.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
node "$rascunho\mutantes.mjs" "$rascunho\mutantes-p4.json" *> "$rascunho\mutantes-p4.txt"; "saida: $LASTEXITCODE"
```

Esperado: `18 mutantes em … s; fora do vermelho: 0` (`14` na rodada da T6) e `saida: 0`.

Resultado (06/11): `14 mutantes em 36 s; fora do vermelho: 0` e `saida: 0`.

- [x] **Passo 3: a tabela, os hashes e a guarda.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-4-cofre.md'
node "$rascunho\tabela-mutantes-p4.mjs"; "saida: $LASTEXITCODE"
$depois = $alvos | ForEach-Object { $_ + ' ' + (Get-FileHash $_ -Algorithm SHA256).Hash.Substring(0, 12) }
Compare-Object $antes $depois
git status --short
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --conferir; "saida: $LASTEXITCODE"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `18 linhas: 18 vermelhos, 0 equivalente(s)` (`14` na rodada da T6), nenhuma linha `PROBLEMA`, `saida: 0`; o `Compare-Object` calado (os cinco arquivos voltaram byte a byte); todos os blocos `igual`; e `False`. A tabela gerada (`$rascunho\tabela-mutantes-p4.md`) entra no Apêndice A.

Resultado (06/11): `14 linhas: 14 vermelhos, 0 equivalente(s); testes mapeados: 16`, nenhuma linha `PROBLEMA` e `saida: 0`. Toda queda foi `AssertionError` com `ERR_ASSERTION`, só nas suítes do mutante, e o mapa previsto bateu nos catorze. O `Compare-Object` ficou calado (com o `$antes` relido do arquivo) e o `status` mostrou dois `M` e onze `??`. A conferência deu os quinze blocos já extraídos `igual` e três `AUSENTE` (`filho-prova.mjs`, `prova-p4.mjs` e `afetadas-p4.mjs`, que só se extraem na T7 e na T8), daí `saida: 1`; a expectativa de "todos `igual`" valia só depois da T8. Guarda: `False`.

### Task 7: prova com a DPAPI de verdade

A §8.5 pede: todos os `.dpapi` abrem; um teste ao vivo por tipo; um pacote exportado e importado abre as mesmas credenciais. A prova faz isso em duas casas temporárias dentro do `$rascunho`, com a CLI de verdade e a DPAPI de verdade, a partir de cópias dos `.dpapi` reais. Ela imprime só contagens e booleanos: nunca nome, valor ou hash de credencial, nem o total do Gerenciador. O filho do `executar` compara o valor recebido pelo env com o esperado, que chega a ele pelo stdin em base64, e responde só `igual` ou `diferente`. Para o `.dpapi` em texto hex do `ConvertFrom-SecureString`, que a ponte não abre cru, o esperado vem do próprio PowerShell (`ConvertTo-SecureString`): um oráculo que não passa pelo leitor do cofre. Uma segunda passada do `importar-dpapi` confere que nada volta como `divergente`.

```js rascunho=filho-prova.mjs
// Filho da prova do plano 4: compara o valor recebido em OMNI_PROVA_VALOR com o base64 esperado que chega pelo stdin. Imprime só "igual" ou "diferente".
import { readFileSync } from 'node:fs'
const esperado = readFileSync(0, 'utf8').trim()
const recebido = Buffer.from(process.env.OMNI_PROVA_VALOR ?? '', 'utf8').toString('base64')
console.log(recebido === esperado && esperado !== '' ? 'igual' : 'diferente')
```

```js rascunho=prova-p4.mjs
// Prova do plano 4 com a DPAPI e o Gerenciador de verdade, em casas temporárias dentro do rascunho.
// Só leitura nos .dpapi originais (são copiados). Imprime só contagens e booleanos: nunca nome, valor
// nem hash de credencial, nem o total do Gerenciador.
// Uso: node prova-p4.mjs <raiz-do-repo> <rascunho>
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [raizArg, rascunhoArg] = process.argv.slice(2)
if (!raizArg || !rascunhoArg) { console.error('uso: node prova-p4.mjs <raiz-do-repo> <rascunho>'); process.exit(2) }
const raiz = resolve(raizArg)
const rascunho = resolve(rascunhoArg)
const modulo = (relativo) => import(pathToFileURL(join(raiz, relativo)).href)
const { comBancoDaCasa } = await modulo('runtime/casa/banco.mjs')
const { criarPonteDpapi, powershellPadrao } = await modulo('runtime/casa/dpapi.mjs')
const { listarCredenciais, usarCredencial } = await modulo('runtime/casa/loja-cofre.mjs')

const origem = join(process.env.APPDATA, 'omni', 'access')
const pasta = join(rascunho, `prova-p4-${Date.now()}`)
const casa1 = join(pasta, 'casa1')
const casa2 = join(pasta, 'casa2')
const cli = join(raiz, 'runtime', 'cofre.mjs')
const filho = join(rascunho, 'filho-prova.mjs')
const ponte = criarPonteDpapi()
const envDe = (casa) => ({ ...process.env, OMNI_HOME: casa, OMNI_CASA_BANCO: join(casa, 'casa') })
function cofre(casa, args, input = '') {
  const r = spawnSync(process.execPath, [cli, ...args], { input, env: envDe(casa), encoding: 'utf8', windowsHide: true, timeout: 120_000 })
  const ultima = ((r.stdout ?? '').trim().split('\n').at(-1) ?? '').trim()
  let json = null
  try { json = JSON.parse(ultima) } catch {}
  return { status: r.status, json, ultima }
}
const usar = (casa, nome) => comBancoDaCasa(casa, 'cofre', (db) => usarCredencial(db, ponte, { nome, agente: 'omni', motivo: 'prova do plano 4' }).valor, envDe(casa))
const blobs = (casa) => comBancoDaCasa(casa, 'cofre', (db) => new Map(db.prepare("SELECT nome, blob FROM credenciais WHERE guarda = 'dpapi' AND apagado_em IS NULL").all().map((l) => [l.nome, Buffer.from(l.blob)])), envDe(casa))

// Oráculo independente para o .dpapi em texto hex do ConvertFrom-SecureString, que a ponte não abre cru:
// o próprio PowerShell o abre com ConvertTo-SecureString e devolve o valor em UTF-8, em base64, pelo stdout.
// Não passa pelo leitor do cofre, e o valor nunca é impresso.
const SECURE = "$ErrorActionPreference = 'Stop'; $t = [Console]::In.ReadToEnd().Trim(); $s = ConvertTo-SecureString $t; [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([Net.NetworkCredential]::new('', $s).Password)))"
function peloSecureString(caminho) {
  const r = spawnSync(powershellPadrao(), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(SECURE, 'utf16le').toString('base64')], { input: readFileSync(caminho, 'utf8').replace(/^﻿/, ''), encoding: 'utf8', windowsHide: true, timeout: 60_000 })
  const saida = (r.stdout ?? '').trim()
  return r.status === 0 && saida !== '' ? Buffer.from(saida, 'base64') : null
}

let esperados = new Map()
try {
  mkdirSync(join(casa1, 'access'), { recursive: true })
  mkdirSync(casa2, { recursive: true })
  const arquivos = readdirSync(origem).filter((n) => n.toLowerCase().endsWith('.dpapi')).sort()
  for (const arquivo of arquivos) copyFileSync(join(origem, arquivo), join(casa1, 'access', arquivo))
  console.log(`1. copiados: ${arquivos.length} .dpapi`)
  const imp = cofre(casa1, ['importar-dpapi', '--classificacao', join(rascunho, 'classificacao-p4.json')])
  console.log(`2. importar-dpapi: status ${imp.status}, importadas ${imp.json?.importadas}/${arquivos.length}`)
  const nomes = arquivos.map((a) => a.slice(0, -'.dpapi'.length))
  const abertos = ponte.abrir(arquivos.map((a) => readFileSync(join(origem, a))))
  esperados = new Map(nomes.map((nome, i) => [nome, abertos[i].ok ? abertos[i].valor : peloSecureString(join(origem, arquivos[i]))]))
  const crus = abertos.filter((a) => a.ok).length
  const pelaSecure = nomes.filter((nome, i) => !abertos[i].ok && esperados.get(nome) !== null).length
  let entregues = 0
  for (const nome of nomes) {
    const esperado = esperados.get(nome)
    if (!esperado) continue
    const r = cofre(casa1, ['executar', '--nome', nome, '--variavel', 'OMNI_PROVA_VALOR', '--motivo', 'prova do plano 4', '--', process.execPath, filho], esperado.toString('base64'))
    if (r.status === 0 && r.ultima === 'igual') entregues += 1
  }
  console.log(`3. executar: esperados ${crus} abertos crus e ${pelaSecure} pelo ConvertTo-SecureString; entregues iguais ${entregues}/${nomes.length}`)
  const frase = randomBytes(24).toString('base64url')
  const pacote = join(pasta, 'cofre.pacote.json')
  const exp = cofre(casa1, ['exportar', '--saida', pacote], `${frase}\n`)
  const texto = readFileSync(pacote, 'utf8')
  let emClaro = 0
  for (const valor of esperados.values()) if (valor && (texto.includes(valor.toString('utf8')) || texto.includes(valor.toString('base64')))) emClaro += 1
  console.log(`4. exportar: status ${exp.status}, credenciais ${exp.json?.credenciais}, valores em claro no pacote: ${emClaro}`)
  const impPacote = cofre(casa2, ['importar-pacote', '--arquivo', pacote], `${frase}\n`)
  let iguais = 0
  for (const nome of nomes) { try { const v = usar(casa2, nome); if (esperados.get(nome)?.equals(v)) iguais += 1; v.fill(0) } catch {} }
  const b1 = blobs(casa1); const b2 = blobs(casa2)
  const diferentes = [...b1.keys()].filter((nome) => b2.has(nome) && !b1.get(nome).equals(b2.get(nome))).length
  console.log(`5. importar-pacote: status ${impPacote.status}, importadas ${impPacote.json?.importadas}; iguais após pacote ${iguais}/${nomes.length}; blobs diferentes entre as casas ${diferentes}/${nomes.length}`)
  const inv1 = cofre(casa1, ['inventario-windows'])
  const inv2 = cofre(casa1, ['inventario-windows'])
  const novas = (inv2.json?.resultados ?? []).filter((r) => r.resultado === 'inventariada').length
  console.log(`6. inventario-windows: status ${inv1.status}/${inv2.status}, ok ${inv1.json?.ok}/${inv2.json?.ok}; segunda passada sem novas: ${inv2.json?.inventariadas === 0 && novas === 0}`)
  const openai = comBancoDaCasa(casa1, 'cofre', (db) => listarCredenciais(db).filter((c) => c.servico === 'openai').map((c) => c.nome), envDe(casa1))
  for (const nome of openai) {
    const t = cofre(casa1, ['testar', '--nome', nome])
    console.log(`7. testar (openai): status ${t.status}, ok ${t.json?.teste?.ok}, ${t.json?.teste?.detalhe}`)
  }
  const imp2 = cofre(casa1, ['importar-dpapi', '--classificacao', join(rascunho, 'classificacao-p4.json')])
  const jaImportadas = (imp2.json?.resultados ?? []).filter((r) => r.resultado === 'ja-importada').length
  console.log(`8. importar-dpapi de novo: status ${imp2.status}, importadas ${imp2.json?.importadas}, já importadas ${jaImportadas}/${arquivos.length}`)
} finally {
  for (const valor of esperados.values()) valor?.fill(0)
  rmSync(pasta, { recursive: true, force: true })
  console.log(`limpeza: pasta da prova removida: ${!existsSync(pasta)}`)
}
```

O "usuário limpo" da §8.5 aqui é a segunda casa, vazia, no mesmo usuário do Windows: prova o caminho do pacote (frase-mestra, abrir, re-selar), não um perfil novo do Windows. O usuário limpo de verdade fica com o Weriton, na ativação.

- [x] **Passo 1: guarda antes e a classificação.** `Test-Path "$env:LOCALAPPDATA\omni\casa"` dá `False`. A classificação dos `.dpapi` reais (nome → `{tipo, servico}`) é escrita à mão em `$rascunho\classificacao-p4.json` e nunca entra no repositório nem neste plano (item 5).

Resultado (06/11): `False`; a classificação tem dez entradas e mora só no `$rascunho`.

- [x] **Passo 2: a prova no Node 24.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-4-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so filho-prova.mjs prova-p4.mjs
node --version
node "$rascunho\prova-p4.mjs" . $rascunho; "saida: $LASTEXITCODE"
```

Esperado, com N = número de `.dpapi`:
1. `copiados: N .dpapi`;
2. `importar-dpapi: status 0, importadas N/N`;
3. `executar: esperados C abertos crus e H pelo ConvertTo-SecureString; entregues iguais N/N`, com C + H = N;
4. `exportar: status 0, credenciais N, valores em claro no pacote: 0`;
5. `importar-pacote: status 0, importadas N; iguais após pacote N/N; blobs diferentes entre as casas N/N` (a segunda casa re-sela: o blob muda, o valor não);
6. `inventario-windows: status 0/0, ok true/true; segunda passada sem novas: true`;
7. uma linha por credencial da OpenAI: `testar (openai): status 0, ok true, …`;
8. `importar-dpapi de novo: status 0, importadas 0, já importadas N/N` (o texto hex também: o hash do arquivo ficou em `_projecoes`);
9. `limpeza: pasta da prova removida: true` e `saida: 0`.

Resultado (06/11), primeira rodada: 9/10. `copiados: 10`; `importadas 9/10`; `entregues iguais 9/10`; `exportar: status 0, credenciais 9, valores em claro no pacote: 0`; `importar-pacote: status 0, importadas 9; iguais após pacote 9/10; blobs diferentes entre as casas 9/10`; `inventario-windows: status 0/0, ok true/true; segunda passada sem novas: true`; `testar (openai): status 0, ok true, HTTP 200`; limpeza `true`; `saida: 0`; 43 s. A prova cumpriu o papel dela: achou um formato que nenhum teste conhecia.

Diagnóstico, com um script só de leitura no `$rascunho` que imprime índice, tipo, tamanho e formato (nunca nome, valor ou hash): uma das dez credenciais, de tipo `outro`, estava gravada como texto hex do `ConvertFrom-SecureString`, isto é, o blob da DPAPI escrito em hexadecimal, com o valor selado em UTF-16LE. A ponte só abre blob cru, e esse arquivo dava `CryptographicException`; tirado do hex, abria, e o valor era UTF-16LE. As outras nove eram blob cru. Nenhum script do repositório grava esse formato; quem o gravou fica como pergunta para o Weriton. O cofre passa a ler o formato, e daqui em diante só a CLI grava.

Correção, com TDD:
1. O LC 10 (T3) ficou vermelho: `tests 10, pass 9, fail 1`, `AssertionError` `0 !== 1` nas importadas.
2. A `importarPastaDpapi` (T3) aprendeu o formato. Arquivo que é todo texto hex (BOM, maiúsculas e espaço nas pontas tolerados) vira blob; o valor só vale se for UTF-16LE bem formado, passa para UTF-8 e é selado de novo. O hash do arquivo ingerido fica em `_projecoes` (`access/<arquivo>`, papel `ingerida`), e a volta usa a `situacaoDaProjecao`: arquivo igual ao blob guardado ou já ingerido é `ja-importada`; hash nunca visto é `divergente`, e o banco não é sobrescrito.
3. Verde: LC + CB `tests 33, pass 33, fail 0` (9,6 s); as cinco suítes `tests 40, pass 40, fail 0`.
4. A T6 rodou de novo, com quatro mutantes a mais (15 a 18) e o 09 ajustado ao código novo: `18 mutantes em 59 s; fora do vermelho: 0` e `18 linhas: 18 vermelhos, 0 equivalente(s); testes mapeados: 21`. O mapa previsto bateu nos dezoito (o 09 cai agora também no LC 10). Os cinco arquivos voltaram byte a byte: a loja em `21F9D45BF7A7`, os outros quatro com os hashes da T6. Guarda: `False`.

Segunda rodada, no Node 24 (`v24.17.0`), já com o oráculo do `ConvertTo-SecureString` e a segunda passada: `copiados: 10`; `importadas 10/10`; `esperados 9 abertos crus e 1 pelo ConvertTo-SecureString; entregues iguais 10/10`; `exportar: status 0, credenciais 10, valores em claro no pacote: 0`; `importar-pacote: status 0, importadas 10; iguais após pacote 10/10; blobs diferentes entre as casas 10/10`; `inventario-windows: status 0/0, ok true/true; segunda passada sem novas: true`; `testar (openai): status 0, ok true, HTTP 200`; `importar-dpapi de novo: status 0, importadas 0, já importadas 10/10`; limpeza `true`; `saida: 0`; 37 s. Guarda antes e depois: `False`.

- [x] **Passo 3: Node 22.** Baixar o zip oficial, conferir o sha256 (item 13) e rodar a prova e as cinco suítes nele.

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$zip = Join-Path $rascunho 'node22.zip'
Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.23.4/node-v22.23.4-win-x64.zip' -OutFile $zip -UseBasicParsing
(Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -eq 'cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20'
Expand-Archive -Path $zip -DestinationPath (Join-Path $rascunho 'node22') -Force
$node22 = Join-Path $rascunho 'node22\node-v22.23.4-win-x64\node.exe'
& $node22 --version
& $node22 "$rascunho\prova-p4.mjs" . $rascunho; "saida: $LASTEXITCODE"
& $node22 --test --test-concurrency=1 --test-reporter=spec testes/casa-pacote-cofre.test.mjs testes/casa-dpapi.test.mjs testes/casa-loja-cofre.test.mjs testes/casa-testadores-cofre.test.mjs testes/cofre-cli.test.mjs *> "$rascunho\t7-node22.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t7-node22.txt" -Pattern '(tests|pass|fail|skipped) \d+\s*$'
```

Esperado: `True`, `v22.23.4`, a prova com as mesmas linhas do Passo 2 e `saida: 0`; as suítes com `tests 40`, `pass 40`, `fail 0` e `saida: 0` (eram 39 antes do LC 10, que a T7 acrescentou).

Resultado (06/11): `True` e `v22.23.4`; a prova com as mesmas linhas da segunda rodada do Passo 2, 10/10 em tudo, e `saida: 0` (41 s); as cinco suítes com `tests 40`, `pass 40`, `fail 0`, `skipped 0` e `saida: 0` (12 s).

- [x] **Passo 4: limpar e guarda depois.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
Remove-Item -Recurse -Force (Join-Path $rascunho 'node22'), (Join-Path $rascunho 'node22.zip')
Get-ChildItem $rascunho -Filter 'prova-p4-*' | Measure-Object | Select-Object -ExpandProperty Count
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `0` pastas de prova sobrando e `False`. O `classificacao-p4.json` fica no `$rascunho` até o fim da F1 e sai com ele.

Resultado (06/11): a limpeza rodou num `finally`, na mesma chamada do Passo 3: `node22` e o zip removidos, `0` pastas de prova e `False`.

### Task 8: suítes afetadas e verify

Uma suíte pesada por vez: o verify só começa depois que as afetadas terminam. Nenhum arquivo do repositório muda nesta tarefa; o `dist` que o build reescreve volta no fim.

```js rascunho=afetadas-p4.mjs
// Lista as suítes testes/*.test.mjs que carregam um módulo tocado pelo plano 4, direta ou
// indiretamente. Segue imports relativos (from, import de efeito, import() e new URL com texto
// literal); na suíte, um caminho runtime/*.mjs citado em texto também conta. dist/ fica de fora:
// o plano não o muda. Uso, da raiz do repositório: node afetadas-p4.mjs [--lista]
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const raiz = process.cwd()
const tocados = ['casa/esquemas', 'casa/dpapi', 'casa/pacote-cofre', 'casa/loja-cofre', 'casa/testadores-cofre', 'cofre'].map((m) => resolve(raiz, 'runtime', `${m}.mjs`))
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
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-4-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so afetadas-p4.mjs
node "$rascunho\afetadas-p4.mjs"
```

Esperado: duas linhas, `diretas` e `indiretas`. As diretas incluem as cinco suítes novas e o CB; as indiretas, toda suíte que abre a casa pelo `banco.mjs` e o `esquemas.mjs`.

Resultado (06/11): `diretas 6` (`casa-banco`, `casa-dpapi`, `casa-loja-cofre`, `casa-pacote-cofre`, `casa-testadores-cofre` e `cofre-cli`) e `indiretas 54`, com a `integridade-release` entre elas: 60 suítes.

- [x] **Passo 2: rodar as afetadas, em segundo plano.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$suites = @(node "$rascunho\afetadas-p4.mjs" --lista)
'suites: ' + $suites.Count
node --test --test-concurrency=1 --test-reporter=spec @suites *> "$rascunho\t8-afetadas.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t8-afetadas.txt" -Pattern '(tests|pass|fail|cancelled|skipped|duration_ms) [\d.]+\s*$', '\.test\.mjs:\d+:\d+'
```

Esperado: `fail 0`, ou só o vermelho de nascença `:165` se a `integridade-release` estiver na lista (item 7).

Resultado (06/11): `suites: 60`, `tests 587`, `pass 586`, `fail 1`, `cancelled 0`, `skipped 0` e `saida: 1`, em 9,5 min. A única falha é o vermelho de nascença: `contrato canônico declara a versão e exatamente o fingerprint do payload`, em `testes\integridade-release.test.mjs:165`, que cai na linha 173, com `actual` e `expected` de 64 dígitos hexadecimais cada. A guarda deu `False`.

- [x] **Passo 3: verify, em segundo plano.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
npm run verify *> "$rascunho\verify-p4.txt"; "saida: $LASTEXITCODE" | Out-File -Append -Encoding utf8 "$rascunho\verify-p4.txt"
Select-String -Path "$rascunho\verify-p4.txt" -Pattern '(tests|pass|fail|cancelled|skipped|duration_ms) [\d.]+\s*$', '\.test\.mjs:\d+:\d+', '^saida: ', '^\s+(actual|expected): ', '^\{"ok"'
```

Esperado:
- `tests 736`, `fail 1`, `cancelled 0` e `skipped 4`; a única falha é `testes\integridade-release.test.mjs:165`, que cai na linha 173;
- `actual` e `expected` com 64 dígitos hexadecimais cada: o `actual` é o contrato (`3c60182bbef2…`), o `expected` é o calculado com este plano, que o plano 8 grava;
- cinco linhas `{"ok":true,…}`, como no plano 3;
- `saida: 1`.

Base: o verify do plano 3, com 696 testes. Os 40 a mais são PC 9, DP 8, LC 10, TC 4 e CL 9 (eram 39 até a T7 acrescentar o LC 10). A `testes\evolucao.test.mjs:348` já caiu uma vez por `EPERM` de outro processo (plano 3, T10); se cair de novo, ela roda sozinha três vezes.

Resultado (06/11): `tests 736`, `pass 731`, `fail 1`, `cancelled 0` e `skipped 4`, em 491 s. A única falha é a `testes\integridade-release.test.mjs:165`, que cai na linha 173, com `actual` `3c60182bbef2…` (o contrato) e `expected` `07e0ba25deda…`, os dois com 64 dígitos hexadecimais. Saíram as cinco linhas `{"ok":true,…}` (contratos 43 duas vezes, fontes 59 duas vezes e `distFiles` 59 com 0 dependências de runtime) e `saida: 1`. A `evolucao.test.mjs:348` passou desta vez. A guarda deu `False`.

- [x] **Passo 4: o que a falha conhecida mascara, rodado à parte.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
node --test --test-concurrency=1 .test-dist/testes/*.test.js *> "$rascunho\t8-test-dist-p4.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t8-test-dist-p4.txt" -Pattern '(tests|pass|fail) \d+\s*$'
npm run test:dist *> "$rascunho\t8-dist-production-p4.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t8-dist-production-p4.txt" -Pattern '(tests|pass|fail) \d+\s*$'
npm run verify:build *> "$rascunho\t8-verify-build-p4.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t8-verify-build-p4.txt" -Pattern '^\{"ok"'
```

Esperado: as três com `saida: 0`; `.test-dist` 55/55, `test:dist` 1/1 e `{"ok":true,"files":59}`.

Resultado (06/11): as três com `saida: 0`, em 35 s: `.test-dist` com `tests 55`, `pass 55` e `fail 0`; `test:dist` com `tests 1`, `pass 1` e `fail 0`; `verify:build` com `{"ok":true,"files":59}`. A guarda deu `False`.

- [x] **Passo 5: devolver o `dist`, conferir o plano e a guarda.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-4-cofre.md'
git diff --ignore-cr-at-eol --stat -- dist
git checkout -- dist
git status --short
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --conferir; "saida: $LASTEXITCODE"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: nenhuma linha de `--stat`; o `status` com dois `M` (`package.json` e `runtime/casa/esquemas.mjs`) e onze `??` (este plano, os cinco módulos e as cinco suítes); todos os blocos `igual` com `saida: 0`; e `False`.

Resultado (06/11): o `--stat` não trouxe nenhuma linha de diff, só os avisos de LF para CRLF da cópia de trabalho; o `checkout` saiu com 0. O `status` trouxe três `M`, e não dois: além do `package.json` e do `runtime/casa/esquemas.mjs`, o plano 1, cuja linha 4 a T9, Passo 1, já trocou. Vieram também os onze `??`. Os 18 blocos deram `igual`, com `saida: 0`, e a guarda deu `False`.

### Task 9: commit, push, CI e registro

Um commit só: os módulos, as suítes, o esquema e o `package.json` só fazem sentido juntos, e o commit leva este plano e a linha 4 do escopo no plano 1.

- [x] **Passo 1: a linha 4 do escopo.** Em `docs/superpowers/plans/2026-11-04-f1-casa-sqlite.md`, trocar

```markdown
| 4 | Cofre (`cofre.db`): importação dos `.dpapi`, inventário só com os nomes do Credential Manager, ponte DPAPI, CLI, exportação e importação com scrypt + AES-256-GCM | §8; prova em §8.5 | a escrever |
```

por

```markdown
| 4 | [Cofre (`cofre.db`): importação dos `.dpapi`, inventário só com os nomes do Credential Manager, ponte DPAPI, CLI, exportação e importação com scrypt + AES-256-GCM](2026-11-06-f1-plano-4-cofre.md) | §8; prova em §8.5 | entregue |
```

Resultado (06/11): feito com o Edit; a linha 26 do plano 1 ficou igual à do bloco acima.

- [x] **Passo 2: CR e commit.** Autor e committer Weriton-DataOps, com o e-mail dos commits dela no `origin/main`, passado no comando e nunca impresso; mensagem em UTF-8 sem BOM.

```powershell
$arquivos = 'package.json', 'runtime/casa/esquemas.mjs', 'runtime/casa/pacote-cofre.mjs', 'runtime/casa/dpapi.mjs', 'runtime/casa/loja-cofre.mjs', 'runtime/casa/testadores-cofre.mjs', 'runtime/cofre.mjs', 'testes/casa-pacote-cofre.test.mjs', 'testes/casa-dpapi.test.mjs', 'testes/casa-loja-cofre.test.mjs', 'testes/casa-testadores-cofre.test.mjs', 'testes/cofre-cli.test.mjs', 'docs/superpowers/plans/2026-11-06-f1-plano-4-cofre.md', 'docs/superpowers/plans/2026-11-04-f1-casa-sqlite.md'
foreach ($a in $arquivos) { $cr = [IO.File]::ReadAllText((Resolve-Path $a)).Split([char]13).Count - 1; if ($cr -ne 0) { $a + ' CR: ' + $cr } }
git add -- $arquivos
git status --short
$email = git log origin/main --author='Weriton-DataOps' -1 --format='%ae'
if (-not $email) { throw 'sem commit da Weriton-DataOps no origin/main' }
git -c user.name=Weriton-DataOps -c "user.email=$email" commit -F "$env:LOCALAPPDATA\Temp\omni-f1\msg-p4.txt"
git log -1 --format='%h %an %cn %s'
```

Esperado: nenhuma linha de CR, os catorze arquivos no índice, o commit com autor e committer Weriton-DataOps.

Resultado (06/11): nenhuma linha de CR, e os catorze arquivos no índice, sem mais nada. Uma varredura das linhas adicionadas no índice, atrás do que não pode ir a repositório público, não achou nada real: o único achado foi um falso positivo de padrão, numa palavra comum. Commit `ef87498`, pai `9badd6a`, autor e committer `Weriton-DataOps`, com o mesmo e-mail dos commits dela no `origin/main`: 14 arquivos, 4103 inserções e 6 remoções, e `status` limpo depois.

- [x] **Passo 3: push e CI.** A conta do push é a dona do repositório, e a `wp-grgroup` volta no `finally`.

```powershell
gh auth switch --user Weriton-DataOps; try { git push origin casa-sqlite-f1 } finally { gh auth switch --user wp-grgroup }
```

Depois, o CI do ramo pela conta Weriton-DataOps, com o token só na variável do processo e removido no `finally`. Esperado: o job Linux verde e o Windows vermelho só no `:165` (item 7).

Resultado (06/11): push `9badd6a..ef87498` pela conta Weriton-DataOps, com a `wp-grgroup` de volta no `finally`; o `ls-remote` deu o mesmo SHA do ramo local. Na CI, "Linux / Node 22 / portable core" ficou verde e "Windows / Node 22 / full verification" vermelho só no `:165`, no passo "Verify source, contracts, package and tests": 736 testes, 731 verdes, 4 pulados e 1 vermelho (`not ok 475`). A asserção que cai é a da linha 173, com o contrato `3c60182bbef2…` no `actual` e o calculado `07e0ba25deda…` no `expected`, o mesmo par da máquina local. Antes dos testes vieram as cinco linhas `{"ok":true,…}`: contratos 43 duas vezes, fontes 59 duas vezes e `distFiles` 59 com 0 dependências de runtime. O log não tem nenhuma linha com `EPERM`. Para esse job, o `gh run view --log-failed` voltou vazio, e o log inteiro veio pela API do job (`gh api repos/<dono>/<repo>/actions/jobs/<job>/logs`).

- [x] **Passo 4: registrar.** A "Situação" deste plano passa a "entregue", com o hash do commit, e os resultados entram nos passos. Esse registro vai num segundo commit, `docs(plano): registra push e CI do plano 4 da F1`, como no plano 3.

Resultado (06/11): a Situação e os resultados dos Passos 2 e 3 estão no commit `docs(plano): registra push e CI do plano 4 da F1`. O push e a CI desse commit não aparecem aqui, porque este registro viaja dentro dele.

## Autorrevisão contra o desenho

| Desenho | Onde está |
|---|---|
| §8.1: `casa\cofre.db` separado do `omni.db`, tabelas `credenciais` e `usos` | v1 revista (T3); `BANCOS.cofre` já existia |
| §8.1: o valor nunca entra no registro de uso | `usos` não tem coluna de valor; LC 3 confere os registros |
| §8.1: DPAPI CurrentUser | ponte (T2); DP 1 e 2 com a DPAPI de verdade |
| §8.1: importa os `.dpapi`; a importação nunca apaga; os originais ficam | `importarPastaDpapi` (T3), LC 5 e LC 10 (texto hex do `ConvertFrom-SecureString`, T7); prova, linhas 1, 2 e 8 (T7) |
| §8.1: os originais ficam, com cópia datada, até o cofre provar que abre todos | a ativação real fica depois do merge, com o ok do Weriton; aqui só cópias |
| §8.3: confere os agentes autorizados, entrega por variável de ambiente e registra | `usarCredencial` (T3), LC 3; `executar` (T5), CL 4 e CL 5; prova, linha 3 |
| §8.3: o valor nunca passa pelo modelo nem pelo log | saída JSON sem valor (T5); DP 4; prova, linha 4 |
| §8.4, itens 1 e 2: frase-mestra (scrypt + AES-256-GCM), decifra e re-sela | `pacote-cofre` (T1); `exportarCofre` e `importarPacoteCofre` (T3), LC 9; prova, linha 5 |
| §8.4: a frase não é guardada | a CLI lê do stdin e não grava (T5) |
| §8.5: todos abrem; um teste ao vivo por tipo; pacote abre as mesmas credenciais | prova (T7) |

Desvios e notas:
- O inventário traz só nomes, e o filtro `Omni/*` mora no C# (item 17).
- A v1 do cofre foi revista, com `CASE` no JSON, e congela com o push.
- Os gatilhos de diário ficam: anotam só id e versão, o UPDATE só entra quando a versão muda, e o blob viaja pelo pacote. O `_projecoes` guarda só o hash de cada `.dpapi` ingerido (papel `ingerida`), desde a T7.
- Os nomes seguem a casa: `criado_em` e `rotacionar_dias`.
- Não há `concluirUso`: o registro do uso é feito na hora da entrega ou da recusa.
- O teste ao vivo não sobe a versão, e o valor só é aberto quando há testador.
- A entrega é por variável de ambiente. O pipe e o broker ficam para a F2.
- O §8.2 é o plano 5; o item 3 do §8.4 é a F2.
- O desenho fala em oito `.dpapi`; hoje são dez.
- O "cofre" do `guardiao.mjs` e do `passe.mjs` é outra coisa e não muda.
- Os originais ficam intocados e os consumidores atuais não mudam.
- A CLI não importa `memoria.mjs`; recusa sobrescrever; não ecoa argumento; um `.cmd` precisa de `cmd /c`; lê o stdin só quando precisa; a variável do programa se chama `programa`; e a frase curta só é recusada depois de abrir o arquivo, que então é apagado.
- String do JS não se zera (item 4).
- As checagens do repositório não alcançam os módulos novos (item 9).
- O PowerShell recusa argumento depois do `-EncodedCommand`, e por isso o mutante 07 é o vazamento silencioso (item 17).
- O Node 22 é baixado de novo para a prova e apagado depois (item 13).
- Ficam com outros: o testador de Postgres (plano 5); a conta de serviço do Google; o Sentinel, nunca; o usuário limpo do Windows (Weriton); e a ativação real depois do merge, com o ok dele e a cópia datada.

## Apêndice A: mutantes (T6 e T7)

A tabela abaixo é a saída do `tabela-mutantes-p4.mjs` na rodada da T7, que refez os catorze mutantes da T6 e acrescentou os quatro do texto hex do `ConvertFrom-SecureString` (15 a 18). Na rodada da T6, o 09 caía só no LC 5; o LC 10 nasceu na T7.

| # | Mutante | Arquivo | Teste que ficou vermelho — asserção |
|---|---|---|---|
| 1 | recusa do agente desligada | `casa/loja-cofre.mjs` | LC uso: entrega só a agente autorizado e registra cada pedido, entregue ou recusado, sem o valor — `throws` sem exceção<br>CL executar recusa agente sem acesso antes de criar o filho — `equal` |
| 2 | recusa do agente sem registro em usos | `casa/loja-cofre.mjs` | LC uso: entrega só a agente autorizado e registra cada pedido, entregue ou recusado, sem o valor — `deepEqual` |
| 3 | credencial do Gerenciador entregue como DPAPI | `casa/loja-cofre.mjs` | LC uso: entrega só a agente autorizado e registra cada pedido, entregue ou recusado, sem o valor — `throws` com outro erro |
| 4 | cabeçalho fora da autenticação | `casa/pacote-cofre.mjs` | PC o cabeçalho é autenticado: um espaço a mais derruba a abertura — `throws` sem exceção |
| 5 | parâmetros do pacote não conferidos ao abrir | `casa/pacote-cofre.mjs` | PC os parâmetros do pacote são conferidos antes de derivar a chave (r antes de N) — `throws` com outro erro |
| 6 | frase mínima de 11 | `casa/pacote-cofre.mjs` | PC frase-mestra: mínimo de 12 caracteres, contados depois do NFC — `throws` sem exceção |
| 7 | segredo da ponte no comando codificado | `casa/dpapi.mjs` | DP o segredo nunca vai no argumento nem no script: só no stdin — `ok` ("o valor em base64 não vai no script") |
| 8 | inventário sem o filtro Omni/ | `casa/loja-cofre.mjs` | LC inventário do Gerenciador: só Omni/, só o nome, sem blob, e ausente contado, nunca apagado — `deepEqual` |
| 9 | divergente contado como já importado | `casa/loja-cofre.mjs` | LC importação da pasta .dpapi: abre antes de gravar, classifica, não duplica e nunca apaga o original — `deepEqual`<br>LC importação do texto hex do ConvertFrom-SecureString: abre, passa o UTF-16LE para UTF-8, re-sela e reconhece o arquivo na volta — `deepEqual` |
| 10 | exportar sobrescreve o pacote | `cofre.mjs` | CL exportar não sobrescreve, apaga o pacote que falhou, e o pacote volta noutra casa — `equal` |
| 11 | segredo no argumento do filho | `cofre.mjs` | CL executar entrega o valor ao filho só pelo ambiente e devolve o código dele — `deepEqual` |
| 12 | Sentinel sem a guarda | `casa/testadores-cofre.mjs` | TC Sentinel nunca é testado: nem abre o valor, nem chama a rede — `deepEqual`<br>CL testar: OpenAI vai à rede com o Bearer e grava o resultado; Sentinel nunca; inexistente é recusa — `deepEqual` |
| 13 | valor do teste não zerado | `casa/testadores-cofre.mjs` | TC OpenAI: GET /v1/models com o Bearer aparado; 200 é ok e o valor é zerado — `ok` ("o valor foi zerado") |
| 14 | pacote sem conferir o formato do conteúdo | `casa/loja-cofre.mjs` | LC pacote importado: frase errada não grava nada, conteúdo de outro formato é recusado, item ruim é pulado — `throws` sem exceção |
| 15 | texto hex do SecureString não reconhecido | `casa/loja-cofre.mjs` | LC importação do texto hex do ConvertFrom-SecureString: abre, passa o UTF-16LE para UTF-8, re-sela e reconhece o arquivo na volta — `equal` |
| 16 | texto hex gravado sem re-selar em UTF-8 | `casa/loja-cofre.mjs` | LC importação do texto hex do ConvertFrom-SecureString: abre, passa o UTF-16LE para UTF-8, re-sela e reconhece o arquivo na volta — `equal` |
| 17 | arquivo já ingerido contado como divergente | `casa/loja-cofre.mjs` | LC importação do texto hex do ConvertFrom-SecureString: abre, passa o UTF-16LE para UTF-8, re-sela e reconhece o arquivo na volta — `deepEqual` |
| 18 | UTF-16LE de tamanho ímpar aceito | `casa/loja-cofre.mjs` | LC importação do texto hex do ConvertFrom-SecureString: abre, passa o UTF-16LE para UTF-8, re-sela e reconhece o arquivo na volta — `equal` |
