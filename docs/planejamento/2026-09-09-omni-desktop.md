# Omni Desktop — primeira implantação

Escopo autorizado: interface de texto e voz usando Claude/VS Code, com a base existente do
Omni. Overcore expressamente adiado.

Implementado em `apps/omni-desktop`: janela de três áreas, histórico, seleção de projeto,
listagem/retomada de sessões, streaming, interrupção, permissões na interface, supervisor
silencioso, estado do broker, contagem da memória compartilhada e missões PostgreSQL.
Extensão local do VS Code instalada e atalho Omni Desktop criado.

O primeiro teste real de chat respondeu `Omni conectado`. Na inspeção posterior, a entrega
do contexto por hooks ainda não tinha evidência suficiente. O fluxo foi corrigido para
carregar o contexto explicitamente antes de chamar o provedor. Seis testes locais passaram,
incluindo essa ordem, retomada, canais texto/voz, sincronização, concorrência e persistência.
O teste de janela confirmou preload restrito, ausência de Node no renderer, ausência da API
antiga do Studio e leitura de missões pelo broker. Realtime conectou via WebRTC com áudio
sintético; isso não equivale a um teste perceptivo de microfone/alto-falante do proprietário.

O novo teste externo com contexto canônico foi bloqueado pela revisão automática de
aprovação: a autorização histórica cobre conteúdo privado do plugin, mas foi considerada
insuficiente para envio de memória privada ao Claude. Nenhuma repetição desse envio foi
feita após a rejeição. É necessária autorização específica para fechar esse gate real.

Readback posterior, somente leitura: a janela produtiva foi encontrada no Windows e trazida
à frente. Ela já exibia uma conversa `oi Omni`, iniciada fora do teste automatizado desta
rodada, com resposta do Claude, 46 memórias confirmadas, 7 candidatas, missão PostgreSQL e
eventos de contexto, Stop, ferramentas e subagente. Isso comprova uso vivo do caminho canônico;
não representa repetição do teste bloqueado nem uma aprovação inferida para novos envios.
O atalho inicialmente mantinha a janela escondida; o launcher foi corrigido para mostrar
o Electron, mantendo só o iniciador em segundo plano. A tela abre antes da espera pelo broker.

Limites explícitos desta versão:

- a passagem real para o terminal do VS Code ainda requer readback ponta a ponta;
- memória durável mantém o modelo existente de cache local com importação idempotente;
  restauração automática do cache a partir do PostgreSQL não foi implementada;
- crachá não foi convertido integralmente em políticas de ferramenta do SDK;
- o broker de voz protege a chave e registra metadados locais, mas ainda não unifica suas
  observações com a tabela transacional do crachá;
- histórico visual local e missões PostgreSQL são entidades distintas;
- fechar a janela mantém o aplicativo na bandeja; não promete execução com o Windows desligado;
- não houve publicação nem atualização da versão instalada do plugin nesta rodada.

O pacote Desktop é 0.1.0 em desenvolvimento. O núcleo/plugin continua 0.22.2.

Verificação final: oito testes locais passaram. Os dois testes adicionais da ponte comprovam
resolução do executável instalado, argumentos separados, vínculo da sessão e rejeição de
solicitação expirada, usando terminal simulado. Isso não substitui o readback de um terminal real.

## Retorno da identidade do Omni pessoal

Implementado nesta continuação: marca visível Omni com O maiúsculo, paleta petróleo/musgo/bronze,
três colunas preservadas, scrollbars escuras, painel Realtime com a matéria WebGL original e
som sintetizado Subdivisão sincronizado à liberação da sessão. Adicionados Ctrl+Enter, toque e
pressão longa de Ctrl+0, Ctrl+9, Esc e ajuda visível dos atalhos. Ditado vai ao rascunho;
o broker fixo transcreve WebM em memória sem expor a chave DPAPI à interface.

Validação: build/TypeScript e 11 testes locais passaram. Smoke `--design` passou com mídia
sintética, token/transcrição simulados e rede interceptada. Verificou nome Omni, abertura 3D,
dez osciladores do som original, encerramento dos contextos e tracks, pausa de microfone,
ordem de soltura das teclas, cancelamento, ditado no rascunho e calibração. Nenhuma mensagem
foi enviada ao Claude, nem áudio real à OpenAI nesse teste. O broker de transcrição teve
validação de entrada e sintaxe, mas ainda não uma chamada real de transcrição nesta rodada.

Janela produtiva reiniciada isoladamente após confirmar estado completed e rascunho vazio.
Readback: marca Omni, botão Atalhos, 46 memórias confirmadas, 7 candidatas e missão existentes.
SHA-256 do histórico antes/depois idêntico: BFDDC3A4BC693EB92D9D2925AD0734A0F0868A8EC9B89D31FEF6A401ED94E07A.
Runtime e PostgreSQL não foram parados. Não houve publicação do plugin nem integração Overcore.
