# Omni Desktop

Aplicativo local Electron + React + TypeScript. Usa Claude autenticado e o projeto selecionado,
o runtime canônico em `../../runtime`, o cache compartilhado em `%APPDATA%/omni`, e o PostgreSQL
exclusivo através do broker existente. O Overcore não é iniciado nem chamado.

## Operação

O atalho **Omni Desktop** inicia a janela sem console. O processo principal verifica/inicia o
runtime existente. Fechar a janela a esconde na bandeja; Encerrar Omni cancela as rodadas,
preserva o histórico e encerra o aplicativo. PostgreSQL e broker continuam disponíveis aos
outros clientes do Omni.

A conversa permite escolher o projeto antes do primeiro envio, retomar uma sessão Claude
desse projeto e acompanhar texto em streaming. O mesmo sessionId é usado nos turnos seguintes.
A ponte local `omni-local.omni-desktop-bridge` abre a sessão em um terminal Claude dentro do VS Code.
O handoff usa nonce descartável, valida o vínculo no histórico local e mantém lease para
impedir escrita simultânea pelo Desktop. A extensão resolve o executável Claude instalado,
sem receber comandos arbitrários da URI. Para reimportar falas feitas no terminal, use
Retomar sessão Claude após encerrar a sessão no terminal.

### Execuções e continuidade de trabalho

A lateral esquerda mantém a sessão atual e o acesso ao histórico no topo. Abaixo dela,
o painel **Execuções** mostra tarefas ativas ou aguardando retorno, por origem:
**Omni**, **VS Code**, **Overcore** e **Oracle**. Overcore e Oracle são marcados como
indisponíveis até que seus contratos de integração existam; não representam trabalho
inventado. Uma mensagem enviada enquanto uma conversa do Omni estiver ocupada abre uma
nova tarefa paralela no mesmo projeto, preservando a conversa anterior e mantendo o chat
pronto para a próxima instrução.

A extensão VS Code 0.1.1 registra a cada quatro segundos as janelas e as sessões Omni
que ela abriu, em um arquivo local efêmero. O Desktop só aceita registros recentes e
apresenta o workspace e a quantidade de sessões no painel. Depois de atualizar a
extensão, uma janela VS Code já em execução precisa ser recarregada uma vez para ativar
essa versão; nenhuma credencial, conteúdo de conversa ou comando é gravado nesse registro.

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

O crachá existente continua no runtime. A integração Claude usa o modo normal de permissões,
configuração do projeto e decisões por chamada na interface. Não há bypass de permissões nem
tradução automática de todo o crachá para regras do SDK nesta versão.

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
