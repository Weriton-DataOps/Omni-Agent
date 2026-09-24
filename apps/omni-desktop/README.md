# Omni Desktop

Aplicativo local Electron + React + TypeScript. Usa Claude autenticado e o projeto selecionado,
o runtime canônico em `../../runtime`, o cache compartilhado em `%APPDATA%/omni`, e o PostgreSQL
exclusivo através do broker existente. O Overcore não é iniciado nem chamado.

## Operação

O atalho **Omni Desktop** inicia a janela sem console. O processo principal verifica/inicia o
runtime existente. Fechar a janela a esconde na bandeja; Encerrar Omni cancela as rodadas,
preserva o histórico e encerra o aplicativo. PostgreSQL e broker continuam disponíveis aos
outros clientes do Omni.

O card **Chat central** volta ao Omni. Cards de projeto abrem uma conversa de coordenação
vinculada ao ID da sessão Claude real. A seleção fica destacada e o alvo aparece numa linha
compacta acima do chat. O histórico do editor é uma consulta separada, com autor/horário;
compactações, instruções internas e mensagens técnicas não são tratadas como falas do usuário.
Nenhum transcript é apagado. A projeção anterior fica arquivada localmente na migração.

Quando há filhos, o acesso **N subagente(s) · ver mapa** abre a árvore da sessão, com
objetivo, estado, última ferramenta registrada, resposta final e métricas disponíveis.
O chat central também oferece o mapa das tarefas do Omni. Abrir o mapa é somente consulta:
não cria agentes, não envia comandos e não consome o resumo do card. Detalhes técnicos em
[Mapa de agentes](docs/agent-map.md).

### Execuções e continuidade de trabalho

A lateral esquerda mantém a sessão atual e o acesso ao histórico no topo. Abaixo dela,
o painel **Execuções** mostra tarefas ativas ou aguardando retorno, por origem:
**Omni**, **VS Code**, **Overcore** e **Oracle**. Overcore e Oracle são marcados como
indisponíveis até que seus contratos de integração existam; não representam trabalho
inventado. O coordenador interpreta pedidos em uma fila persistida sem bloquear a caixa de
texto. Conversa simples recebe resposta; trabalho local vai a um subagente; trabalho de projeto
é encaminhado exclusivamente à sessão validada. O coordenador não tem ferramentas de execução.

O plano de encaminhamento é interno. A confirmação curta identifica o executor realmente
registrado e distingue criação/envio de recebimento ou execução. Uma troca de formulação do
modelo não pode anunciar um subagente e disparar outra sessão. Conversas sem execução recebem
uma geração própria em streaming após o planejamento. Resumos de execução são preparados antes
do clique no card e apresentados com digitação visual rápida. Inventário de metadados de contas é tarefa
pessoal da máquina, não alteração no repositório Omni; segredos continuam no intake/broker.

Pedidos externos mantêm ID, conversa de origem autorizadora, chat de destino, sessão destinatária, estado e evidência do
retorno. O mensageiro envia uma vez; o monitor observa confirmações e relatos correlacionados
no histórico real. O pedido encaminhado, o acompanhamento e a síntese liberada no card aparecem
no chat da sessão VS Code chamada. A central conserva a confirmação curta do encaminhamento.
Subagentes locais continuam retornando à conversa mãe. Envio não significa execução,
e relato não é verificação independente. Sessão desconectada e entrega incerta são explícitas.
O Omni avalia cada retorno automaticamente. Se faltar execução ou uma informação que o
executor pode obter dentro do pedido autorizado, envia uma correção ao mesmo subagente ou
sessão e publica uma atualização no chat de destino. O card volta a indicar execução;
a central permanece livre. O resumo final fica pronto antes do clique no próprio card verde do agente ou
da sessão, sem botão de retorno. A ordem dos cliques define a sequência dos textos em cada destino; não há entrega automática
nem painel separado no composer. Relatos originais ficam disponíveis nos detalhes. Cancelamentos
impedem retomada automática. As tentativas
são persistidas, limitadas a três correções e interrompidas se o mesmo relato voltar sem
avanço. O limite não impede reconhecer sucesso na última tentativa. Apenas decisões novas
indispensáveis voltam ao proprietário; uma pausa operacional é informada sem pedir novamente
a autorização original.

Cada chamada Claude de planejamento, envio ou síntese mantém teto de US$ 0,75. A tarefa na
sessão externa mantém os limites e permissões dessa sessão, não os do mensageiro. O teste
`node scripts/live-coordination.mjs` cria um receptor isolado sem ferramentas, também limitado
a US$ 0,75, e testa cálculo, envio, retorno e síntese sem tocar em projetos reais.

O monitor detecta sessões Claude abertas no VS Code e vincula cada UUID ao seu chat sem
clique prévio. O histórico da sessão informa execução e respostas: azul pulsante durante
execução, verde fixo somente após preparar o resumo novo. A leitura apaga o verde; o card
não reapresenta retornos antigos. Uma janela de projeto sem Claude não vira card de sessão.
A extensão continua registrando janelas para ações diretas no editor, sem conteúdo de conversa
ou credenciais nesses registros.

## Contexto e dados

Cada envio ativa a sessão do Omni e executa `tratarHook(UserPromptSubmit)` antes da inferência.
A projeção canônica entra no system prompt; ausência de contexto interrompe o envio. Hooks
de ferramentas, parada e subagentes são encaminhados ao runtime pelo SDK. O modo de voz
transcreve e envia pela mesma operação de conversa; Realtime narra a resposta do Claude.

Memórias confirmadas/candidatas são níveis de confiança. Cache local/PostgreSQL são os
locais de armazenamento. A interface preserva os dois conceitos existentes: o cache atual
é usado para seleção e extração, e as entradas são sincronizadas de forma idempotente ao
PostgreSQL. Não foi criada outra memória cognitiva para a interface. Missões são lidas do
broker. Histórico visual completo fica em `%APPDATA%/omni/desktop/conversations.json`.

O supervisor não declara a migração inversa PostgreSQL → cache de memória implementada:
essa capacidade não existe no broker atual. A perda do cache exige restauração própria,
apesar da cópia durável existente. Esse limite é anterior à interface.

O crachá existente continua no runtime. O Omni Desktop opera como o agente pessoal local já
autorizado pelo proprietário: comandos e ferramentas do Claude não voltam à interface como
cartões de permissão por chamada. A autorização persistente é aplicada pelo SDK no processo
local do Omni; permissões do navegador seguem separadas e continuam restritas ao microfone da
própria janela confiável.

## Voz

`scripts/provision-omni-realtime.ps1 -FromStudio` importa uma única vez a chave existente para
um blob DPAPI CurrentUser, com ACL exclusiva da conta. O arquivo original é preservado.
`scripts/omni-realtime-token.ps1` é um broker de processo único, com destino/modelo fixos;
somente o client secret de 60 segundos sai dele. A chave permanente não entra no renderer,
no contexto Claude nem no banco de conversas. Auditoria guarda apenas data, operação e resultado.
Esse broker de voz é separado do broker PostgreSQL; unificar metadados de voz no crachá
transacional ainda requer uma integração adicional.

O microfone permanece desabilitado até confirmar a configuração da sessão Realtime.
VAD não gera respostas automáticas. Áudio não é gravado; fechar a voz encerra as tracks e a
conexão. A chamada é encerrada após 15 minutos. O teto de US$ 0,75 aplica-se às rodadas Claude;
o Realtime é medido por uso e não possui teto monetário garantido neste aplicativo.

### Identidade e atalhos

O nome visível é **Omni**. A estrutura de três colunas permanece, com a paleta petróleo,
musgo e bronze do Omni pessoal. A matéria WebGL e o som sintetizado “Subdivisão” foram
adaptados da versão local `Overcore Studio/apps/omni-pessoal`; não há dependência em execução
nem contrato de integração com o Overcore. A semente cresce quando chega `session.updated`,
reage ao áudio de saída e libera recursos ao fechar. Movimento reduzido é respeitado;
sem WebGL permanece uma representação estática.

- Ctrl+Enter: mostrar/recolher Omni (se não ocupado por outro aplicativo).
- Ctrl+0: toque abre/fecha Realtime; segurar por 250 ms inicia ditado.
- Soltar Ctrl+0: transcrever no rascunho, sem enviar automaticamente ao Claude.
- Ctrl+9: calibrar ruído ambiente do ditado por 1,5 s; piso salvo localmente.
- Enter envia; Shift+Enter insere nova linha; Esc fecha painel/cancela ditado/recolhe janela.

O ditado tem limite de 60 s e 4 MB. Usa WebM em memória e o broker de destino fixo
`scripts/omni-transcribe.ps1`, sem arquivo temporário, segredo no renderer ou áudio nos logs.
A transcrição usa `gpt-4o-transcribe`, sem prompt de vocabulário. Antes de enviar o clipe,
o Omni aquece o microfone, exige nível acima do ruído calibrado, ao menos 1.200 bytes e corrige
somente confusões conhecidas de nomes. Resíduos conhecidos de silêncio e alfabetos inesperados
são descartados; no Realtime, logprobs fracos também interrompem o turno antes de chegar ao Claude.
Perder foco cancela a captura pendente; recolher a janela encerra também o Realtime.

O botão **Áudio** permite selecionar microfone, saída e voz. As preferências são locais ao
Omni Desktop. A saída selecionada alcança a narração Realtime e o som de abertura; novas
seleções de microfone/voz passam a valer na próxima abertura do Realtime.

Referência conferida com OpenAI Docs: https://developers.openai.com/api/docs/guides/speech-to-text

## Desenvolvimento e validação

## Documentos Markdown em janela independente

Referências locais como `planejamentos/fase1-station.md`, `[Plano](planejamentos/fase1-station.md)`
e caminhos `.md` entre crases viram links nas mensagens, inclusive no histórico já salvo.
O clique abre um leitor próprio do Omni, em outra janela, mantendo o chat e seu rascunho.
O leitor tem **Ver Markdown / Ver formatado**, **Atualizar** e **Fechar**; Escape fecha só o documento.
O arquivo é aberto somente para leitura; listas, tabelas, títulos e blocos de código são formatados.

A referência é resolvida na pasta da conversa de origem (inclusive quando o relatório de um
subagente aparece no chat central). Dentro do documento, links para outros `.md` são relativos
à pasta daquele arquivo. Reabrir o mesmo documento reutiliza a janela. Arquivos ausentes
geram uma mensagem explícita, sem procurar um homônimo em outro projeto.

O leitor aceita Markdown UTF-8 de até 2 MB dentro da pasta do projeto. Rejeita travessia e
links simbólicos para fora dela. Tem preload próprio, sandbox e isolamento de contexto;
não recebe a API do chat ou do Crachá, não executa HTML e não carrega imagens remotas.
Teste local isolado: `npm run test:document-ui` (main, IPC, preload e renderer reais).

## Atualização local pela interface

Em **Configurações > Atualizar**, o Desktop observa somente os arquivos já gerados pela
build local (`out/main`, `out/preload` e `out/renderer`). Ele não baixa pacote, não consulta
um servidor e não envia código ou conversas para fora.

Depois de `npm run build`, uma alteração precisa aparecer em duas leituras estáveis antes de
ficar disponível: isso evita reiniciar no meio de uma build que ainda está escrevendo arquivos.
Você pode usar **Atualizar agora**, ou habilitar a aplicação automática. Nos dois casos, o
Omni só reinicia quando não há resposta, encaminhamento ou entrega em andamento. A preferência
fica em `desktop/update-preferences.json`, fora do repositório.

`npm ci`, `npm run build`, `npm test`, `npm run smoke` e `npm start` nesta pasta.
O núcleo precisa manter `dist` construído. As dependências da interface são independentes
do pacote do plugin; não são adicionadas ao runtime produtivo do plugin.

`smoke -- --live` realiza inferência externa; `smoke -- --voice` usa mídia sintética em uma
conexão Realtime. Ambos exigem autorização apropriada. O smoke comum é local e não envia mensagens.
`npm run smoke -- --design` testa apresentação, abertura 3D, pausa do microfone, Ctrl+0,
Esc e calibração com mídia sintética, broker simulado e rede de voz interceptada.
Resultados e imagens ficam em `out/`, ignorado pelo Git. Os testes de controller injetam
provedor, módulos de contexto e banco simulados e não acessam os dados pessoais.

Referência de transporte: https://developers.openai.com/api/docs/guides/realtime-webrtc
