# Casa única: Omni, Overcore e Oráculo — desenho

> 04/11/2026. Origem: brief do Weriton por áudio (WhatsApp), repassado pela sessão omni-38, e as
> respostas dele na sessão do PC no mesmo dia.
> Estado: **aprovado** em 04/11 ("perfeito em tudo / pode rodar"). F1 em execução; plano em
> `docs/superpowers/plans/2026-11-04-f1-casa-sqlite.md`.

## 0. Decisões tomadas

| # | Decisão | Estado |
|---|---|---|
| 1 | Actions mora no Oráculo | **sim** (Weriton, 04/11) |
| 2 | Interface de cada agente mora no repo dele; a ilha acessa e integra | **sim** (adendo, 04/11) |
| 3 | WhatsApp mora no Omni; Overcore não tem WhatsApp e fala com o Omni, que traduz e encaminha | **sim** (04/11) |
| 4 | Banco sem dependência externa: SQLite embutido (`node:sqlite`), um arquivo por agente (§3) | **sim** (04/11) |
| 5 | Overcore Studio não é arquivado; a interface do Overcore nasce aos poucos e pode aproveitar peças dele (§7) | **sim** (04/11) |
| 6 | Cofre de credenciais no Omni, gerenciado pela ilha, continuando no DPAPI | **sim** (04/11), desenho em §8 |
| 7 | Várias sessões gravando e consultando ao mesmo tempo | respondido pela medição (§3.5) |
| 8 | Postgres dedicado do Omni (`127.0.0.1:5433`) | **aberto**: segue ligado em F1; desligar ou não é decisão de F2 (§3.7) |

## 1. O que existe hoje (medido em 04/11, não suposto)

| Peça | Onde mora | Como guarda estado |
|---|---|---|
| Omni (agente + plugin) | repo `Weriton-DataOps/Omni-Agent` | JSON em `%APPDATA%\omni`: `memory/memory.json` (431 confirmadas, 73 candidatas, 13 no arquivo morto; 606 KB), `learning/*.json` (15 MB; `live-coverage` 7,7 MB, `failures` 4,4 MB), `feedback/`, `runtime/` (571 arquivos) |
| Postgres do Omni | serviço dedicado em `127.0.0.1:5433`, banco `omni` | schemas `omni_meta`, `identity`, `memory`, `operations`, `access`, `audit`, `learning`; só o broker (pipe `omni-access-broker-v8`) fala com ele. Recebe o espelho da memória, o aprendizado operacional e as missões; o contexto lê de volta só as missões ativas, com queda para o arquivo local |
| Memória do Claude Code | `~\.claude\projects\...\memory\*.md` | 50 arquivos `.md` + `MEMORY.md` (o harness lê do disco) |
| Ilha | `Omni\apps\omni-ilha` | lê o disco dos outros agentes direto; **usa o Electron 33 emprestado do omni-desktop** |
| Overcore | repo `Weriton-DataOps/Overcore` | Postgres 18 local (`overcore` db, porta 5432), 9 migrações SQL; usa `jsonb` (28×), `timestamptz` (26×) e travas advisory (5×) |
| Overcore Studio | repo `Weriton-DataOps/overcore-studio` | parado desde 21/08; contém o omni-pessoal descontinuado |
| Oráculo | `Documents\Oracle`, **sem git e sem remote** | `.md` em `state/`, `registry/projects.yaml` |
| Actions | `Documents\Actions` (33 pontos) + `%APPDATA%\omni\actions` | `.md` por ponto, `projetos.md`, logs |
| WhatsApp | `%APPDATA%\omni\whatsapp` (1,6 GB) | **já usa SQLite** (`data/main.sqlite`) + JSON (aprovações, delegações) |
| Credenciais | `%APPDATA%\omni\access\*.dpapi` e o Gerenciador de Credenciais do Windows (logins do Postgres 5433, alvos `Omni/PostgreSQL/dedicated-5433/*`) | DPAPI, **presa à máquina por construção** |

Leitura: o estado está espalhado em JSON e `.md` que cada componente lê do jeito dele, e a ilha
espia a pasta do Oráculo e dispara script do Overcore. Funciona, mas o acoplamento é por
fechadura arrombada, não por porta.

## 2. Os três agentes e quem é dono de quê

```text
                    ┌──────────────────── OMNI (repo Omni-Agent) ────────────────────┐
                    │  ILHA = casa que integra todas as interfaces                    │
                    │   ├─ painéis do Omni (sessões, WhatsApp, máquina, chat)         │
                    │   ├─ encaixe do Oráculo  ◄── interface/ do repo Oráculo         │
                    │   │    └─ Actions (mora no Oráculo)                             │
                    │   └─ encaixe do Overcore ◄── interface/ do repo Overcore        │
                    │  memória, aprendizado, personalidade, WhatsApp, autoridade      │
                    └─────────────────────────────────────────────────────────────────┘
        OVERCORE (repo Overcore)                       ORÁCULO (repo novo: Oraculo)
        execução de tarefas, plano, autorização,       projetos, estado operacional,
        evidência; interface própria; sem WhatsApp     observabilidade, dados; Actions
```

Regra de fronteira: **a ilha nunca lê as entranhas de outro agente**. Cada agente entrega um
módulo `interface/` (HTML/JS carregado pela ilha) e uma API local; a ilha só monta o módulo e
fala pela API.

**Simetria:** cada um dos três tem repo próprio com a própria interface dentro. O que sai de
`apps/omni-ilha`:

| Hoje na ilha | Vai para |
|---|---|
| `oracle.js`, `oraculo/` (arte e vídeo) | repo Oráculo, `interface/` |
| `actions.html/.js`, `pontos.js`, `projetos.js`, `execucoes.js`, `escrita.js`, `actions-preload.js` | repo Oráculo, `interface/actions/` |
| `overcore.html/.js`, `overcore-janela.js`, `overcore-preload.js`, `nucleo/` (arte) | repo Overcore, `interface/` |
| casca, chat, sessões, WhatsApp, máquina (`sistema.js`, `ceu.js`), face e motor do Omni | **fica** na ilha |

A ilha guarda só um *encaixe* por agente: consulta o registro do núcleo para saber o que está
instalado e onde está o módulo, abre a janela ou painel e entrega um preload estreito. Agente
não instalado vira card apagado com "instalar", nunca erro.

**WhatsApp é do Omni, e só do Omni.** O Overcore não fala com o WhatsApp: manda eventos ao Omni
pela API, e o Omni decide o que vale a pena, traduz para gente e encaminha. Um canal só para o
celular, com um porteiro só.

## 3. Um lugar só, sem servidor: SQLite embutido

**Como o software de verdade guarda memória:** Chrome e Edge (histórico, cookies), Firefox
(`places.sqlite`), o WhatsApp do celular (`msgstore.db`), Signal, iMessage (`chat.db`), o catálogo
do Lightroom e o estado do VS Code (`state.vscdb`) usam SQLite. É um banco SQL completo que mora
**dentro do programa**, sem serviço, porta, usuário ou instalação: o banco é um arquivo. O próprio
serviço de WhatsApp do Omni já usa (`main.sqlite`).

**O Omni não precisa instalar nada:** o Node 24 desta máquina já traz `node:sqlite` (SQLite
3.53), verificado em 04/11. Dependência externa: zero. O Node 22 também serve a partir da 22.13
(módulo sem flag; o aviso experimental que ele emite é calado só para o sqlite): as suítes da
casa passaram no 22.23.4, a versão que o CI usa, em 04/11.

**Layout:** uma pasta, um arquivo por agente.

```text
%LOCALAPPDATA%\omni\casa\
  nucleo.db     registro de agentes e módulos instalados, máquinas
  omni.db       memórias, aprendizado, falhas, feedback de personalidade, sessões,
                delegações, ledger do WhatsApp
  cofre.db      credenciais e usos (§8)
  oraculo.db    projetos, estado operacional, Actions (pontos, ciclo, vereditos, visitas, entregas)
  overcore.db   (F4, ver §3.3)
```

Cada arquivo carrega as próprias tabelas de serviço: `_migracoes`, `_diario` (§3.1) e, onde há
projeção em disco, `_projecoes` e `_importacoes` (§3.6).

Por que um arquivo por agente e não um só:
- **Instalação independente.** O executor de cada agente cria o próprio arquivo, que é a forma
  concreta do "cada agente procura o database e instala as dependências dele ali". Desinstalar o
  agente é apagar um arquivo.
- **Trava por arquivo.** O SQLite tem um escritor por vez *por arquivo*. Com arquivos separados,
  a ponte do WhatsApp gravando não espera o Overcore, e vice-versa.
- **Consulta cruzada continua possível:** `ATTACH 'oraculo.db'` junta os arquivos numa consulta
  quando for preciso.

Configuração obrigatória: modo WAL (leitores não bloqueiam o escritor), `busy_timeout` de
alguns segundos e `foreign_keys=ON`. Migrações SQL numeradas por arquivo, com tabela
`_migracoes`, no mesmo molde das do Overcore.

`%LOCALAPPDATA%` e não `%APPDATA%`: o Roaming pode ser sincronizado pelo perfil do domínio. Um
arquivo de banco aberto não pode estar em pasta que outro processo copia por baixo.

**Fica fora do banco, de propósito:**
- **Segredos.** DPAPI não sai da máquina, e isso é recurso, não defeito. O banco guarda só o
  *nome* da credencial (`access/fal`), nunca o valor. Máquina nova = o executor pede o recadastro.
- **Sessão do WhatsApp** (credenciais do Baileys) e mídia: arquivo local, com referência no banco.
- **Código:** git. **Logs brutos e transcripts:** disco, com resumo e hash no banco.

### 3.1 Portabilidade: mover é fácil, *fundir* é o que custa

Mover é copiar a pasta `casa` (via `VACUUM INTO` ou backup online, nunca copiando o arquivo
aberto). Juntar duas máquinas que gravaram é outra história. Por isso, **desde a primeira
migração**, toda tabela de dado vivo leva:

- `id` texto UUID v7 (ordenável por tempo), nunca autoincremento;
- `origem_maquina`, `criado_em`, `atualizado_em`, `versao`;
- `apagado_em` (lápide) em vez de `DELETE` físico;
- gatilhos que gravam cada mudança no `_diario` do próprio arquivo: inserção, apagamento e toda
  atualização que sobe a `versao`. Arrumação local, como mudar só a ordem, não sobe a versão e
  não vai ao diário. O diário não fica centralizado no `nucleo.db` porque gatilho persistente do
  SQLite não escreve em arquivo anexado.

O SQLite tem de fábrica a extensão *session*, que gera um **changeset** (o diff das mudanças) e o
aplica em outro banco com tratamento de conflito; o `node:sqlite` já a expõe. Quando o segundo
PC chegar, a sincronização é trocar changesets, não inventar protocolo. O uso fica para depois,
mas o formato nasce pronto.

**Proibido:** o banco vivo no OneDrive ou em drive de rede. A trava do SQLite não sobrevive à
sincronização de nuvem, e o resultado é corrupção. O OneDrive pode carregar o *pacote de
exportação*, nunca a pasta `casa`.

### 3.2 A memória do Claude Code vira projeção

O harness do Claude Code lê `memory/*.md` do disco, e as sessões gravam lá com `Write`. Não dá
para arrancar isso. Então **o banco é a fonte e a pasta é uma projeção** gerada a partir dele. Um
passo de reconciliação (no hook de fim de sessão e na varredura diária) ingere para o banco os
`.md` novos ou alterados pelo harness e regenera a pasta. O mesmo mecanismo serve aos `.md` dos
pontos do Actions, se ele quiser manter a leitura em arquivo. A primeira projeção a rodar foi a
do próprio `memory.json` do Omni (§3.6), e é dela que sai o molde.

### 3.3 E o Overcore?

Hoje ele depende de Postgres instalado, que é justamente a dependência externa que o Weriton não
quer. A troca para SQLite é viável, mas não é gratuita:
- `jsonb` → JSON em texto mais as funções `json_*` do SQLite;
- `timestamptz` → texto ISO-8601 em UTC;
- travas advisory e `FOR UPDATE SKIP LOCKED` → `BEGIN IMMEDIATE`. O escritor único do SQLite
  substitui a trava, e o lease fica mais simples, não mais complexo.

Proposta: **a porta de armazenamento do Overcore ganha um adaptador SQLite em F4**, e a suíte
dele roda nos dois motores até o verde. O Postgres sai do executor só quando o SQLite passar.
Até lá, o executor do Overcore detecta o Postgres existente e o usa.

### 3.4 A ilha precisa de Electron novo

O Electron 33 (Node 20) que a ilha pega emprestado **não tem** `node:sqlite` (verificado em 04/11).
O Electron próprio da ilha (F2) tem de ser uma versão com Node ≥ 22.13. Alternativa sem amarrar
a versão: a ilha não abre o banco e pergunta tudo à API do Omni, como já faz com o Overcore. A
segunda opção é a recomendada, pela regra de fronteira.

### 3.5 Muitas sessões ao mesmo tempo

Medido em 04/11 nesta máquina (`node:sqlite`, WAL, `busy_timeout=5000`, cada processo em laço
fechado de 500 operações; script em `scratchpad/bench`):

| Carga | Tempo total | Gravações | Leituras | Pior espera na gravação | Pior leitura | Integridade |
|---|---|---|---|---|---|---|
| 8 processos gravando + 8 lendo | 1,2 s | 4.000 ok, 0 falha | 4.000 ok, 0 falha | 0,9 s | 2,8 ms | ok |
| 20 processos gravando + 20 lendo | 2,8 s | 10.000 ok, 0 falha | 10.000 ok, 0 falha | 2,0 s | 4,2 ms | ok |

Como funciona:
- **Leitura nunca espera.** No WAL, cada leitor enxerga uma fotografia consistente do banco e
  não entra em fila nenhuma, nem com 20 gravando.
- **Gravação entra numa fila de uma pista.** Cada gravação leva frações de milissegundo; o
  `busy_timeout` faz a sessão esperar a vez em vez de falhar. Foram ~3.600 gravações por segundo
  sustentadas. A espera de até 2 s só aparece no teste de martelo (40 processos disparando juntos
  sem respirar). Uma sessão de agente grava algumas vezes por minuto, porque cada turno do
  modelo leva segundos.

Regras que mantêm a fila curta (viram teste em F1):
1. Transação curta. **Nunca segurar uma transação aberta durante chamada de modelo, rede ou
   ferramenta.** É o único jeito real de travar o banco.
2. Gravação sempre com `BEGIN IMMEDIATE`. Começar lendo e depois promover para escrita pode
   devolver `SQLITE_BUSY` sem respeitar o `busy_timeout`.
3. As sessões falam com a API do agente, que é a dona do arquivo; não abrem o `.db` por conta
   própria. A fila passa a morar num processo só, e a regra de fronteira vale também para o banco.
   **Em F1 a memória ainda não passa pela API:** cada processo (hook, CLI, sessão) abre o
   `omni.db` dentro de `memory/memory.lock`, a mesma trava que já serializa toda carga e gravação
   da memória (§3.6), e é essa trava que faz a fila de uma pista. A regra 3 passa a valer para a
   memória em F2, quando a API do Omni assume o arquivo.

Onde o SQLite deixaria de servir: muitas máquinas gravando no mesmo arquivo pela rede, ou um
serviço web com milhares de usuários simultâneos. Nenhum dos dois está no horizonte. Os dois PCs
são resolvidos por changesets (§3.1), não por banco compartilhado.

### 3.6 A memória do Omni no `omni.db` (primeira entrega de F1)

O `omni.db` é a fonte da memória e `memory.json` é a projeção dele, escrita byte a byte igual ao
que o Omni sempre gravou (`JSON.stringify(memória, null, 2)` e a quebra de linha final). Quem
ainda lê o arquivo (versões antigas do plugin no cache, scripts, a ilha) continua lendo.

**Como guarda.** Cada registro de `confirmed`, `candidates` e `archive` vira uma linha de
`memorias` (raia, ordem, tipo, texto e o corpo JSON intacto); o resto do documento fica num
esqueleto em `memoria_meta`. Gravar é escrever a diferença: linha nova entra, linha mudada sobe
a `versao`, linha que saiu vira lápide e lápide que volta ressuscita.

**Reconciliação a cada carga.** O banco sabe o hash da versão corrente e guarda em `_projecoes`
o hash de toda versão que já escreveu ou ingeriu. O hash do arquivo no disco decide:

| Situação | Quando | O que acontece |
|---|---|---|
| `vazio` | banco sem memória e sem arquivo | começa do zero, como sempre |
| `atual` | o arquivo é a versão corrente do banco | lê e segue; nada é reescrito |
| `sem-arquivo` | o arquivo sumiu | o banco vence e reescreve a projeção byte a byte |
| `defasada` | hash de uma versão anterior que o banco já conhece (a escrita do arquivo falhou depois do commit, ou voltou uma cópia velha) | o banco vence e reescreve a projeção |
| `externa` | hash nunca visto (plugin antigo gravando direto, edição à mão, gravação com o banco fora do ar, primeira importação) | o arquivo é ingerido numa transação e registrado em `_importacoes`; fora do formato canônico, é reescrito nele |

`_projecoes` nunca é podada: podar abriria a porta para uma cópia muito velha voltar como
`externa` e ser ingerida por cima do banco.

**Arquivo ilegível** (JSON quebrado ou fora do contrato): com banco populado, o banco vence, a
cópia ilegível fica ao lado como `memory.json.invalida.<carimbo>` e a degradação é anotada. Com
o banco vazio, continua sendo erro e nada é tocado, como antes. Memória de uma versão mais nova
do plugin, no arquivo ou no banco, é sempre erro, nunca degradação: reescrever a projeção com o
que este plugin não entende apagaria o que o plugin novo gravou.

**Gravação.** Banco primeiro (a diferença e o registro da projeção numa transação `BEGIN
IMMEDIATE`), arquivo depois (temporário e rename). Falhou só o banco: o arquivo leva a versão e
o banco a ingere quando voltar. Falhou só o arquivo: o banco tem tudo e a carga seguinte
reescreve a projeção. Quem chamou só recebe erro quando nenhum dos dois guardou.

**Degradação, nunca queda.** Banco fora do ar não derruba o Omni: a memória segue no arquivo e o
evento vai para `degradacoes.jsonl`, na pasta do banco, com as operações `memoria.carregar`,
`memoria.gravar`, `memoria.projetar`, `memoria.ingerir` e `memoria.arquivo-invalido`. Cada linha
leva data, operação e o código e a mensagem do erro, nunca trecho de memória nem segredo. Erro de
JSON vira só "JSON inválido", porque a mensagem do parser traz pedaço do texto lido.

**Sem SQLite** (Electron 33, Node anterior à 22.13 ou `OMNI_CASA_SEM_SQLITE=1`): a memória volta
a ser só o arquivo, exatamente como era, e a pasta do banco nem é criada. Quando o SQLite volta,
o arquivo aparece como `externa` e é ingerido.

**Onde mora o banco.** A casa de produção (`%APPDATA%\omni`) guarda o banco em
`%LOCALAPPDATA%\omni\casa`. Qualquer outra casa (testes, casa alternativa) guarda em
`<casa>\casa`, e `OMNI_CASA_BANCO` aponta outra pasta.

**Abertura.** `busy_timeout=5000`, WAL, `synchronous=NORMAL` e `foreign_keys=ON`, nessa ordem.
Migrações numeradas com hash em `_migracoes`: migração alterada depois de aplicada é recusada.
Processos que abrem juntos um banco recém-criado podem receber `SQLITE_BUSY` na virada para WAL,
que o `busy_timeout` não cobre; ali a abertura tenta de novo, com espera crescente e sorteada, até
o mesmo prazo. Toda conexão fecha ao fim do uso: no Windows, conexão esquecida aberta impede
apagar a pasta.

**Invariante de trava.** Toda carga e gravação de memória, desta versão e das anteriores,
acontece dentro de `memory/memory.lock`. Por isso a ingestão não confere de novo o hash do banco
dentro da transação: ninguém mexe na memória entre a leitura do arquivo e a gravação.

**Riscos aceitos.** Cada um exige duas falhas em sequência ou uma versão antiga do plugin
gravando, e vai sumindo conforme o cache de plugins antigos se renova:
1. *Atualização perdida.* A escrita do arquivo falha depois do commit e, antes de a carga
   seguinte repará-lo, um plugin antigo edita a cópia defasada e grava direto no arquivo. A
   edição dele chega como `externa` e vence. O que só existia na versão perdida e que ele não
   trazia vira lápide, com o conteúdo preservado na linha; um registro alterado nas duas pontas
   fica com a versão do plugin antigo.
2. *Memória recém-criada por cima da antiga.* `memory.json` apagado é recriado vazio por um
   plugin antigo, ou por esta versão com o banco fora do ar, e gravado. Na carga seguinte com
   banco, ele chega como `externa` e a ingestão transforma tudo o que o banco tinha em lápide.
   O conteúdo continua nas lápides; a restauração, por enquanto, é manual.
3. *Carga degradada sobre arquivo defasado.* Com o banco fora do ar na carga e de volta na
   gravação, uma edição feita sobre uma projeção defasada sobrescreve no banco a versão mais
   nova. É o risco 1 sem plugin antigo.
4. *Simulação que alinha.* A carga da manutenção em `dryRun` também passa pela reconciliação e
   pode ingerir um arquivo `externa` ou reescrever uma projeção defasada. Nenhum dos dois muda a
   memória que o banco guarda; só alinha as duas pontas.

### 3.7 O Postgres dedicado do Omni (5433)

Já existe e segue ligado em F1. Pela sincronização do hook de contexto, o broker grava lá o
espelho da memória (que agora sai do `omni.db`), o aprendizado operacional e as missões, e o
contexto lê de volta as missões ativas. Tudo isso passa pelo `tentarComponente` do hook: broker
fora do ar vira falha anotada, não hook quebrado.

O executor de F2 não instala Postgres. Numa máquina limpa, essas três sincronizações apenas
degradam. **Decisão aberta, para F2.** Recomendação: trazer as missões e o aprendizado
operacional para o `omni.db` e desligar o 5433 depois que a instalação limpa passar na prova do
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

Ele não baixa repo: baixa **um arquivo** (`omni-instalar.ps1`, anexo do GitHub Release) e roda.

```text
omni-instalar.ps1
 1. pré-requisitos: Node ≥ 24 e Git (winget se faltar), Claude Code logado. Sem banco para instalar.
 2. baixa a release do Omni (SHA fixo, verificado) para %LOCALAPPDATA%\omni\versoes\<sha>
 3. cria a pasta casa\ com nucleo.db e omni.db e roda as migrações
 4. instala a ilha COM Electron próprio (fim do empréstimo do omni-desktop) e o atalho
 5. registra as tarefas agendadas (vigia do WhatsApp, visita, varredura) e o plugin no Claude Code
 6. chama os sub-executores: Oráculo (obrigatório) e Overcore (padrão sim, pulável)
 7. cofre (§8): cria cofre.db; se houver pacote de cofre de outra máquina, importa com a
    frase-mestra digitada na ilha; senão lista as credenciais que os agentes declaram e pede o cadastro
 8. abre a ilha com o card do WhatsApp já na tela de pareamento (§4.1)
 9. `verificar`: cada agente responde saúde e a ilha acende os painéis instalados
```

### 4.1 Pareamento do WhatsApp, logo após a instalação

Ao terminar, o card do WhatsApp abre sozinho a tela de QR com **dois pareamentos, na ordem**:

| # | Número | Papel | Comportamento (igual ao de hoje) |
|---|---|---|---|
| 1 | o do Weriton (pessoal) | **só leitura** | o Omni visualiza as mensagens; nunca envia por ele |
| 2 | o do Omni (bot) | **conversa** | recebe e manda mensagens; é por ele que o Omni fala com o Weriton e, com autorização, com terceiros |

Cada QR mostra para que serve o número antes do escaneio, porque inverter os dois é o erro caro.
O card só fica verde quando os dois estão pareados, e o pessoal confirmado como só leitura. Hoje
isso é feito na mão com `parear.mjs --bot`; o card chama o mesmo caminho.

### 4.2 Contrato de agente

Cada repo de agente traz o mesmo contrato, para o executor do Omni tratar todos igual:

```json
// executor/agente.json
{
  "agente": "oraculo",
  "versao": "0.1.0",
  "banco": "oraculo.db",
  "migracoes": "migrations/",
  "requer": { "node": ">=24", "agentes": ["omni>=0.26"] },
  "interface": { "modulo": "interface/index.html", "painel": "Oráculo", "api": "http://127.0.0.1:{porta}/v1" },
  "tarefas": ["oraculo-vigia", "actions-visita"],
  "credenciais": []
}
```

Modos do executor: `instalar` (banco vazio, pronto para receber), `importar <pacote>`,
`exportar`, `atualizar`, `verificar`. Idempotente: rodar duas vezes não estraga nada.

**Migração inicial** (máquina atual → banco): importadores de `memory.json`, `learning/*.json`,
`feedback/`, `memory/*.md`, `Actions/pontos`, `Oracle/state` e `registry/projects.yaml`. Os
arquivos originais ficam congelados com cópia datada até a prova passar.

## 5. Como se prova "funciona idêntico"

1. Exportar desta máquina, instalar do zero num alvo limpo (Windows Sandbox ou outro usuário do
   Windows) e importar.
2. `verificar` compara, por tabela, a contagem de linhas e o hash do conteúdo com o pacote: tem
   que bater 100%.
3. Fumaça real: a ilha abre, o card do WhatsApp pede os dois QR, o painel do Oráculo lista os
   projetos, o Overcore responde saúde e uma memória gravada no alvo aparece na projeção `.md`.

Sem os três verdes, não está pronto. "Deve funcionar" não conta.

## 6. Fases

| Fase | Entrega | Prova |
|---|---|---|
| F0 | este desenho + ok no SQLite | ok dele |
| F1 | `nucleo.db` + `omni.db` + `cofre.db`, importador da memória, do aprendizado e dos `.dpapi`, projeção `.md`, card Cofre na ilha; o Omni passa a ler e gravar no banco | contagens batem; as sessões seguem lendo a memória; todos os `.dpapi` abrem pelo cofre (§8.5) |
| F2 | executor do Omni (instalar/exportar/importar/verificar) + ilha com Electron próprio + pareamento duplo do WhatsApp no card | instalação limpa no Sandbox, §5 verde |
| F3 | repo `Oraculo` (git do `Documents\Oracle`), `oraculo.db`, Actions no banco, interface do Oráculo e do Actions saindo da ilha para o repo | pontos e vereditos idênticos; a ilha só monta o módulo e fala pela API |
| F4 | Overcore: adaptador SQLite, sub-executor, encaixe da interface na ilha | suíte do Overcore verde nos dois motores; o painel aparece montado pela ilha |
| F5 | sincronização entre dois PCs por changesets | (depois; o formato está pronto desde F1) |

## 7. Overcore Studio: em discussão

Fato: o Weriton ainda não construiu a interface do Overcore e vai construí-la aos poucos, subindo
para o GitHub e talvez aproveitando peças do Studio. Ninguém arquiva nada agora.

O que o desenho exige é só o **contrato**: seja onde for construída, a interface do Overcore
chega à ilha como um módulo `interface/` declarado no `agente.json` do Overcore. Isso deixa a
decisão do repo livre para esperar a interface tomar forma.

Recomendação (não decisão): construir direto em `Overcore/interface/`, puxando do Studio o que
servir. Assim nasce no lugar onde vai morar, sem um segundo repo para um agente só. Se ele
preferir o Studio como bancada, também funciona: o executor do Overcore passa a buscar a
interface lá.

Fora do escopo: Gaia e Michael (outros agentes dele). Não entram na casa até ele pedir.

## 8. Cofre: o gerenciador de acessos do Omni

Hoje: oito arquivos `.dpapi` soltos em `%APPDATA%\omni\access`, sem tipo, dono, serviço, validade
nem registro de uso (só o `realtime-audit.jsonl` do OpenAI). A cifra é boa; o que falta é o
gerenciador em volta dela.

**Princípio:** o cofre mora no Omni e só no Omni. Overcore e Oráculo não têm cofre; pedem a
credencial *pelo nome* ao Omni, que decide, entrega ao processo e registra. Em toda máquina onde
o Omni for instalado, a credencial passada para ele mora no cofre daquela máquina.

### 8.1 Onde fica

```text
casa\cofre.db   ← arquivo separado, de propósito
  credenciais   id, nome, tipo, serviço/URL, usuário, notas, etiquetas, agentes autorizados,
                criada_em, validade, rotacionar_a_cada, último_teste (ok/falha), blob DPAPI
  usos          quando, qual agente/sessão, para quê, resultado     ← nunca o valor
```

- **Cifra:** continua DPAPI (CurrentUser), como hoje. O valor só existe em claro na memória do
  processo que vai usá-lo.
- **Arquivo separado do `omni.db`** porque assim exportar ou sincronizar a memória nunca carrega
  segredo por acidente. Dois cofres de porta diferente, não uma gaveta dentro da outra.
- Os `.dpapi` atuais entram por importação (F1), com o tipo e o serviço preenchidos. Os
  originais ficam com cópia datada até o cofre novo provar que abre todos.

### 8.2 A tela, no estilo do gerenciador de senhas do Google

Card **Cofre** na ilha:
- **Lista** com busca e filtro por tipo (senha, token, chave de API, string de conexão, conta de
  serviço, referência SSH), serviço, agente e situação.
- **Adicionar:** cola-se o valor na própria janela da ilha ou pela área de transferência (fluxo
  atual: clipboard → teste ao vivo → cofre). **Nunca pelo chat nem pelo WhatsApp.**
- **Ver o valor** exige a confirmação do Windows (Windows Hello ou PIN) a cada vez; o valor some
  da tela em 30 s.
- **Copiar** põe o valor na área de transferência e a limpa em 30 s.
- **Testar** faz a checagem ao vivo por tipo (login no banco, chamada mínima na API) e guarda
  ok/falha com a data.
- **Editar, rotacionar, apagar.** Apagar vai para uma lixeira datada de 30 dias.
- **Histórico:** quem usou, quando e para quê, por credencial.
- **Verificação de saúde** (o "Verificação de senha" do Google, adaptado): vencendo em 15 dias,
  falhou no último teste, sem uso há 90 dias, mesmo valor repetido em dois cadastros, dono
  autorizando um agente que nunca a usou.

### 8.3 Como os agentes usam

Overcore, Oráculo e as sessões pedem `credencial("dw01-postgres", motivo)` ao broker do Omni. O
broker confere se aquele agente está na lista de autorizados, entrega o valor ao processo
(variável de ambiente ou pipe) e grava o uso. O texto do valor nunca passa pelo modelo nem
aparece em log, saída de ferramenta ou mensagem. Continua valendo a regra de que chave privada e
frase-senha não passam por agente de IA.

### 8.4 Máquina nova

DPAPI não atravessa máquina, e isso protege: um `cofre.db` copiado sozinho é um tijolo
ilegível. Para levar as senhas a outro PC:
1. **Exportar cofre** na ilha: o Weriton digita uma **frase-mestra na janela da ilha** (nunca no
   chat). Sai um pacote cifrado com chave derivada dela (scrypt + AES-256-GCM, ambos no `crypto`
   do Node; zero dependência).
2. No PC novo, o executor (passo 7) pede o pacote e a frase na ilha, decifra e **re-sela tudo
   com o DPAPI da máquina nova**. O pacote pode ir pelo OneDrive, porque sem a frase é ruído.
3. Sem pacote, o executor lista o que os agentes instalados declaram em `credenciais` no
   `agente.json` e pede o cadastro pelo card.

A frase-mestra não é guardada em lugar nenhum. Esqueceu a frase, o pacote vira ruído, mas as
credenciais da máquina de origem continuam intactas lá.

### 8.5 Fase

O cofre entra em **F1**, junto com o `omni.db`, porque o executor de F2 depende dele. Prova:
todos os `.dpapi` atuais abrem pelo cofre novo, um teste ao vivo por tipo passa, e um pacote
exportado e importado num usuário limpo do Windows abre as mesmas credenciais (comparação por
hash, nunca exibindo o valor).
