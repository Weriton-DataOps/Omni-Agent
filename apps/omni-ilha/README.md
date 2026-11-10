# omni-ilha — demo descartável

Ilha no topo-centro da tela: recolhida é só a face do Omni (`omni-face.png`, a mesma do ícone das janelas e
do atalho); o hover espia (o poço alarga) e, parado em cima por 0,2 s ou com um clique, abre o menu. É uma maquete do "Omni Desktop" do
ponto `Actions\pontos\omni-desktop.md`, não produto. Pode ser apagada sem afetar o `omni-desktop`.

- **Subir:** `.\iniciar.ps1` (nasce recolhida) ou `.\iniciar.ps1 -Aberta` (nasce aberta e só recolhe
  depois de o ponteiro entrar e sair)
- **Fechar:** o × com a ilha aberta, ou `.\fechar.ps1`
- **Esc** recolhe, só enquanto ela está aberta com o ponteiro em cima (atalho global registrado e
  retirado na hora; fora disso o Esc é do seu app)

## Duas abas: Início e Chat

Desde 19/10 a ilha aberta segue a linguagem do notch do Coucou (github.com/Louis-CFM/coucou; código MIT,
mas nome, personagem, ícones e sons são reservados e nada disso foi usado). O cabeçalho tem as abas à
esquerda, a face no centro e o × à direita. Cada aba tem a sua altura, e trocar de aba leva o poço até
ela na mesma mola de abrir.

- **Início (350 px), em três colunas desde 21/10** (290 px + o resto dividido ao meio). Cada coluna rola
  sozinha pela roda do mouse se o conteúdo passar da altura; a página nunca rola inteira.
  - **Esquerda, a máquina num pedaço de céu** (cabe nos 300 px da coluna e nunca rola): a face do Omni flutuando, o nome da máquina, há quanto
    tempo está ligada, nº de processos e quanto a própria ilha come. Medidores na ordem disco C:, CPU
    (com a linha das últimas 40 leituras) e um bloco da RAM que junta Memória e "Quem come a RAM" (os 4
    programas mais pesados, somando todas as instâncias). Barra âmbar a partir de 75% e vermelha a partir
    de 90%. Fundo de nebulosa com o
    céu estrelado do `ceu.js` (estrelas cintilando e uma estrela cadente de vez em quando; só anima com a
    ilha aberta). Os números vêm do `sistema.js` (`os` do Node e `tasklist` assíncrono, cache de 8 s).
  - **Centro, os cards de integração:**
    - **Actions**, no molde de um card de integração: ícone de caixa à esquerda; "Actions · Depósito"; o número
      de pontos grande em mono; os três pontos mais mexidos, com ponto colorido pelo Status e o tempo
      relativo à direita. O primeiro pulsa se foi mexido há menos de 1 h. Com decisão pendente vira
      **N · PRA VOCÊ**. Clicar recolhe a ilha e abre o depósito na janela do Oráculo (ver abaixo).
    - **Oráculo:** VIGIANDO / PARADO, a última vigia e os três projetos mais recentes. Clicar na cabeça do
      card abre o painel do Oráculo.
    - **Sem o Oráculo instalado** os dois cards ficam apagados, com INSTALAR no rótulo e "–" no número, e o
      clique não abre nada. Com a casa ou o Oráculo fora do ar, mostram FORA DO AR e o motivo.
    - **WhatsApp:** NO AR / PAUSADA / PARADA / AUSENTE, mensagens de hoje contadas pela API (enviadas,
      recebidas e a terceiros), sessões do Claude com o MCP do WhatsApp ligado, conexão do número do Omni e
      do seu WhatsApp, chaves do serviço, chave e crédito da OpenAI, transcrição local, falhas do dia e o
      último sinal. Os dois cards têm a mesma altura (metade da coluna) e no máximo 3 linhas: avisos
      (âmbar) primeiro, com "+N avisos" se passar; ↑enviadas ↓recebidas e as sessões ficam ao lado do
      número grande, e a lista inteira vai no title do card. Ícone de balão, verde quando no ar. Conexões,
      chaves e crédito vêm do `saude.json`, gravado pela sonda `servicos\whatsapp\omni\saude.mjs` num
      processo à parte que a ilha dispara (escondido, um por vez) quando o arquivo passa de 1 min: a ilha
      não abre cofre nem segura chave, e nada de conteúdo de mensagem. Crédito da OpenAI não tem consulta
      gratuita: vale o último uso real da voz no `ponte.log`.
  - **Direita, Sessões:** uma pílula por sessão viva (até 12), com o ícone `>_` na cor do estado, o nome e
    o que ela está fazendo, e o resumo "N rodando · N esperando · N prontas". Clicar numa pílula abre o
    Chat nela.
- **Chat (250 px):**
  - À esquerda, o ícone `>_`, o projeto e o id da sessão. O `i/n ›` passa para a próxima sessão.
  - Abaixo, o que ela está fazendo e as últimas 4 ferramentas: ✓ feita, ✗ erro, ! esperando você e o
    spinner na que está rodando.
  - À direita, a última edição (Edit, MultiEdit ou Write) como diff, com a aba do arquivo, +N −M e a hora.
  - Atualiza a cada 2 s enquanto a ilha está aberta.
- **A barra "Responder à sessão…" é só a forma.** Ela não envia nada, porque a ilha não pega foco e
  ainda falta decidir se a mensagem vai para a sessão aberta ou abre uma nova.

**Ícones (21/10):** uma placa arredondada com um glifo de traço, no lugar da antiga fagulha-mascote, para
a face do Omni não se repetir. Caixa no Actions, balão no WhatsApp e `>_` nas sessões e no Chat. A cor
segue o estado: verde-água rodando, âmbar esperando, azul pronta, cinza ociosa, laranja no Actions.

**Um Omni só, que voa (21/10):** recolhida, a face mora no notch. Quando a Início se revela, ela decola
do centro num arco rápido (480 ms) até a coluna da máquina, inclinada para o lado de destino, com um
rastro de vento atrás. No pouso há uma amassada, um anel, faíscas e um clarão. Fechar ou ir para o Chat
traz a face de volta ao notch, mais rápido (240 ms). As duas faces nunca aparecem juntas: no ar, só o
clone `#voo` está visível. Com `prefers-reduced-motion` ela só troca de lugar, sem voo.

**A face no notch (21/10):** ela mora na `.casca`, por cima do poço, e cabe inteira dentro dele: 32 px num
bico justo de 36×34. O bico de 44×40 sobrava em volta e a versão de 42 px, que passava da borda, foi
testada e descartada. Recolhido, o notch é
grafite (#1c1f26 → #2b2f38) com um fio de luz embaixo, e as faixas laterais acompanham. A variável
`--clara` apaga esse grafite para o preto nos primeiros 160 px de abertura. O voo parte e chega pela
âncora `.ancora-notch` do `.conteudo`.

**A face olha o cursor (21/10):** onde estiver, na coluna ou no notch, ela vira a cabeça de verdade para
o ponteiro: guinada até 20° e aceno até 12°. As poses saem do giro curto aprovado
(`bancada\caricatura\v3\anim\vira\curto\`, só lido). Cada uma foi renderizada sobre preto e sobre branco, e a
diferença dá o alfa exato. São 153 poses de 128 px em `giro\g_<i>_<j>.png`: `i` vai de −20° a 20° em passos
de 2,5° e `j` de −12° a 12° em passos de 3°. `g_8_4` é a de frente e veste as três faces (notch, coluna e
voo). A ilha troca o `src` pela pose mais próxima, andando 18% do que falta a cada quadro. O flutuar e o
pouso continuam no `transform`. Fora da forma, a face do notch segue o cursor pela tela inteira: a sonda
do clique-passante já lê a posição e o main a repassa (IPC `cursor`) quando ela anda 3 px ou mais. Longe,
o alcance é maior (520 × 360 px até o giro máximo); em cima da ilha, 150 × 120. Ao chegar na pose, o laço
de quadros dorme até o próximo movimento: cursor parado custa zero quadros. Com `prefers-reduced-motion`
fica de frente. O ícone das janelas e o atalho continuam na `omni-face.png`.

O diff nunca mostra o conteúdo de arquivo sensível (`.env`, `secret`, `credenc`, `senha`, `token`,
`.pem`, `.key`, `id_rsa`, `pgpass`). Nesses casos aparece "conteúdo oculto". O transcript só é lido
dentro de `~/.claude/projects` e todo texto entra no DOM por `textContent`.

**Actions e Oráculo moram no Oráculo (09/11, F2 plano 4b).** A ilha não lê nem grava mais o depósito: a
mesa de decisão, a escrita, o despacho e a aba Execuções são do Oráculo, e a ilha só abre a janela dele.

- **A casa:** no `whenReady` a ilha sobe o `servir` do Omni (`casa-servir.js`) e para no `will-quit`; o
  `servir` também sai sozinho quando a ilha morre (stdin fechado). O token fica no processo do main.
- **Os cards:** `paineis.js` pergunta à casa quem está instalado (`GET /v1/agentes`) e pede o resumo em
  nome do Oráculo (`/v1/oraculo/resumo` e `/v1/actions/resumo`).
- **A janela do agente:** uma por agente, com o `preload` dele, `sandbox` e `contextIsolation`. Carrega
  o `modulo` do manifesto, ou o `actions/actions.html` do Oráculo quando vem do card do Actions. Navegação
  só dentro da pasta do agente (`podeNavegar`); janela nova é negada.
- **`agente:api`:** a janela fala com a casa por este IPC. O agente permitido sai do mapa
  `webContents.id → agente`, só do quadro principal; pedido de outra janela ou em nome de outro agente
  volta `status: 0` sem tráfego.
- **Ainda no repo até o plano 5:** `pontos.js`, `projetos.js`, `mesa.js`, `escrita.js` e `execucoes.js`,
  usados só pelo `scripts\omni-actions.mjs` da visita.
- **Overcore (22/10):** card próprio na coluna do meio (ícone de três nós), entre Actions e WhatsApp:
  - **Card:** NO AR / DESLIGADO, quantas execuções rodam ou pedem você e as duas primeiras. Com três
    cards, cada um mostra no máximo 2 linhas.
  - **Clique:** abre a **janela própria do Overcore** (`overcore.html`, `overcore-janela.js`,
    `overcore-preload.js`), separada do Actions a pedido dele. A janela lista as execuções: primeiro o
    que pede você, depois o que roda, depois as terminadas.
    - Filtros: *todas · pede você · em andamento · terminadas*, com contagem.
    - Cada execução mostra estado, repositório → branch, passo, agentes ativos e resumo.
    - Bloqueio mostra a pergunta e os botões *liberei, pode retomar* e *cancelar*.
    - *Detalhe* mostra as transições e as evidências.
    - A janela relê a cada 4 s quando está em foco.
    - Com o Overcore desligado, aparece o botão *ligar*, que usa o `start-local.mjs` do Overcore.
  - **O token nunca entra na ilha.** `overcore.js` chama `scripts\omni-overcore.mjs` num processo à parte.
    Ele lê `%LOCALAPPDATA%\Overcore\runtime.json` e `client-private.json` e só executa a rota de
    retomar/cancelar que a própria execução oferece.
- **Pílulas de sessão:** mostram o nome entre sessões ("overcore-3e", "omni-24"), lido de
  `~/.claude/sessions/<pid>.json` (só processo vivo). É o nome para dizer "manda para a X".
- **A visita:** quem mexe no depósito quando ele não está olhando é a visita
  (`scripts\omni-actions-visita.ps1`, tarefa agendada das 7h), sempre por `scripts\omni-actions.mjs`.

## Visual

Notch preto. Em 19/10 a linguagem do Coucou entrou no lugar do Skeu com vidro; a versão anterior ficou no
scratchpad da sessão. Os tokens vêm do `style.css` do port Windows dele:

- **Poço:** preto puro, só com uma sombra embaixo.
- **Cards:** #141518, raio 20, fio interno branco a 3,5% e um brilho radial que sobe da base na cor do
  card (laranja no Actions, índigo no Chat).
- **Abas:** 30×22, raio 11; a ligada fica em #1d1f23.
- **Texto:** #f5f6f8, com cinzas #9398a1, #8e939c e #6b7079.
- **Estados:** verde #22c55e, âmbar #f5a524, vermelho #f4505e, ciano #22d3ee e índigo #6366f1.
- **Troca de aba:** fade com scale(.97) e a curva cubic-bezier(.3, 1.2, .4, 1), que passa um pouco do
  ponto.
- **Faixa:** lê `--poco-*` do `index.html`, agora sem granulado e sem traço, e fica mais transparente até
  a ponta.

## Comportamento

- A janela tem tamanho fixo e nunca anima: 1308 de largura (900 da ilha mais as faixas) e altura igual à
  da aba mais alta mais 36, hoje 386. Quem anima é a forma dentro dela, num
  `requestAnimationFrame`. Abrir é mola (resposta 0,36 s, amortecimento 0,8); fechar é
  cubic-bezier(.45, 0, .2, 1) em 230 ms. Voltar no meio reverte de onde a forma está.
- O conteúdo tem largura fixa e só é recortado pelo poço: abas e cards não andam nem refluem. Eles
  entram quando o poço passa de 88% da largura e somem antes de ele encolher.
- Clique-passante: o main lê o cursor (~31 ms perto da ilha, ~62 ms longe; é o grão do timer do Windows)
  e só captura dentro da forma visível. Faixa e área transparente nunca pegam clique.
- Carência ao sair: 0,12 s (aberta por hover) ou 0,35 s (aberta por clique); voltar sobre a forma que
  ainda encolhe reabre. Passar de raspão não abre.
  Arrastar janela/arquivo até o topo também não: abrir por hover exige que o mouse seja da ilha.
- Nunca pega foco (`focusable:false`): o cursor de texto do seu app continua onde estava.
- Clique é "toque": soltar o botão dentro do retângulo do elemento (`pointerup`), e não `click`. Com a
  janela de um agente existindo, mesmo minimizada, o Windows engole o botão-baixo na ilha, e sem o par não há
  `click`. O teste é pelo retângulo porque o refresh de 2 s troca os nós por baixo do ponteiro.

Tem o próprio Electron 33.4.11 (`npm ci` nesta pasta; a raiz e o CI não instalam). No Node 24 o
postinstall do pacote morre calado no meio da extração e deixa a `dist` só com o `LICENSES`; o
`iniciar.ps1` completa a extração pelo `tar.exe`, a partir do zip que o `npm ci` já deixou no cache
(`iniciar.ps1 -SoPreparar` faz só isso e sai). Não tem build.

## De onde vem o dado

Dos transcripts em `%USERPROFILE%\.claude\projects\*\*.jsonl` alterados nas últimas 3 h. Só o final de
cada arquivo é lido (256 KB para o estado, 512 KB para o passo a passo).

| Estado | Regra |
|---|---|
| esperando você | turno encerrado com pergunta nos últimos 280 caracteres, ou ferramenta chamada sem resultado há mais de 45 s (provável pedido de permissão) |
| rodando | ferramenta em andamento há menos de 45 s, ou resultado de ferramenta ou pedido seu ainda sem resposta |
| concluiu | turno encerrado sem pergunta, há menos de 10 min |
| ociosa | sem escrita há mais de 10 min |

A regra de "esperando você" é heurística: um comando longo também fica mais de 45 s sem resultado.

## Armadilha conhecida

Terminais e agentes rodando dentro do VS Code herdam `ELECTRON_RUN_AS_NODE=1`. Com isso, o Electron
roda como Node puro e não abre janela. O `iniciar.ps1` limpa essa variável antes de subir.

## Fora desta demo

Som, enviar mensagem pelo chat, responder permissão pela ilha, sessões fora de `~/.claude/projects`, ligação
com o Overcore, bandeja do sistema e início com o Windows. A versão de verdade vai para o `omni-desktop`
(electron-vite + React + TypeScript).
