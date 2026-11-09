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
      **N · PRA VOCÊ** (ver a janela Actions abaixo). Clicar recolhe a ilha e abre a janela Actions.
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

**A janela Actions é a mesa de decisão (21/10).** É uma janela comum: tem foco, aparece na barra de
tarefas e usa barra de título própria. Lê o depósito `Documents\Actions` (ou `OMNI_ACTIONS`): os pontos e
o `projetos.md`. Desenho completo em `docs\superpowers\specs\2026-10-21-actions-organizador-design.md`.

- **Aba Ideias:** à esquerda a mesa, nesta ordem:
  - **Pra você**: veredito vencido com a proposta da visita, teste pronto, entrega vencida, item
    proposto e ponto com cabeçalho quebrado;
  - **Com potencial**: ▲ a ▲▲▲ com o motivo;
  - **Em andamento**: semente, em teste e dormente, até 6 por coluna;
  - **Não deram certo**: arquivados com motivo;
  - **Última visita**.

  À direita fica o ponto aberto, com os quatro botões de veredito em cima (vira projeto · entra em… ·
  arquiva · dorme). Arquivar exige motivo, que já vem preenchido pela proposta; dormir exige data.
- **Aba Projetos:** um card por projeto, com o próximo marco e os dias que faltam, checklist clicável,
  ⚠ a 7 dias ou menos, vermelho vencido, "sem data ⚠" e as ideias ligadas. Item "(proposto pelo Omni)"
  tem ✓/✕. Projeto com **Plano de origem** é espelhado: o check grava lá. Plano sumido deixa o card só
  leitura, com aviso.
- **Escrita:** a janela escreve. Todo pedido passa pelo main (`actions:veredito`, `actions:visto`,
  `actions:item`), e o `escrita.js` faz a gravação:
  - só aceita `pontos\*.md`, `projetos.md` e os planos de origem listados;
  - grava de forma atômica, debaixo da trava `.trava` (quem perde tenta de novo uma vez);
  - mantém o histórico só de acréscimo;
  - recusa ponto com cabeçalho ilegível;
  - recusa marcar item se a linha mudou desde a leitura.
- **Card da ilha:** com decisão pendente, mostra **N · PRA VOCÊ** e as linhas do que pede, acende âmbar,
  e a face dá uma olhada para o card quando o número sobe. Isso acontece só com a ilha aberta.
  **Fechada, nada sinaliza** (pedido dele, 21/10): o notch fica como sempre. Sem nada pendente, o card
  volta a ser o depósito: total e os três mais mexidos.
- **Arquivos:**
  - `pontos.js`: o leitor do ciclo (Estágio, Prazo do veredito, Potencial, Proposta, Pra você, Veredito);
  - `projetos.js`: lê o `projetos.md` e os planos de origem;
  - `mesa.js`: monta a mesa;
  - `escrita.js`: as gravações;
  - `actions.html`, `actions.js`, `actions-preload.js`: a janela (sandbox, nenhuma navegação).
- **IPCs:** os da janela Actions só aceitam a própria janela, e os da ilha só respondem à ilha.
- **Executar (22/10):** a caixa "mandar executar" fica no ponto aberto e em cada card de projeto
  ("executar…"). Ali ele aprova, ajusta ou diz como conduzir.
  - **Gravação:** a tela grava `Actions\execucoes\<id>.json` (`execucoes.js`), e o main chama, escondido e
    destacado, o `scripts\omni-actions-despachar.mjs`.
  - **Quem recebe:** o despacho escolhe a sessão do VS Code que vai receber o trabalho:
    1. a aberta na **Pasta** do projeto (`projetos.md`), a ociosa primeiro;
    2. senão, a do Actions;
    3. senão, a ociosa mais nova do Omni.
  - **Entrega:** o despacho monta o pedido (instrução, contexto do ponto e do projeto, regras, como
    devolver) e o entrega pelo canal entre sessões, com uma sessão curta só com Read + SendMessage.
  - **Devolução:** a sessão executora devolve com `omni-actions.mjs execucao <id> --estado
    andando|concluida|bloqueada|falhou`.
  - **Aba Execuções:** mostra estado, sessão, pedido e linha do tempo, e relê o disco a cada 5 s e ao
    entrar na aba. Bloqueada tem caixa de resposta, que volta para a mesma sessão. "Sem sessão" e
    "falhou" têm "mandar de novo". Bloqueada, sem sessão, falhou e concluída não vista sobem para o PRA
    VOCÊ.
  - **Overcore:** quando estiver pronto, ele toma o lugar da sessão. A aba Execuções é o embrião da
    janela dele.
- **Período e ordem (22/10):** no topo ficam os botões *chegou hoje · mexido hoje · 7 dias · tudo* e a
  ordem (*mais novos · último toque · prazo · potencial*), lembrados entre aberturas.
  - **Com período escolhido:** a mesa abre com a lista do que entrou nele, e as colunas mostram tudo,
    sem limite de 6.
  - **Em "tudo":** a seção **Chegaram agora** (hoje e ontem) fica logo depois do Pra você, e todo ponto
    recente leva o selo NOVO. O que acabou de chegar nunca fica enterrado.
  - **O que não tem data** (item de projeto) só aparece em "tudo".
  - **Aba Execuções:** também respeita o período.
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
  janela Actions existindo, mesmo minimizada, o Windows engole o botão-baixo na ilha, e sem o par não há
  `click`. O teste é pelo retângulo porque o refresh de 2 s troca os nós por baixo do ponteiro.

Usa o Electron já instalado em `..\omni-desktop\node_modules`; não tem `npm install` nem build.

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
