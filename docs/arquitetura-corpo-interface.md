# Corpo do Omni Desktop

O Omni Desktop e o corpo local do Omni: apresenta conversa, voz, fila de subagentes e controles de
sessoes externas. Ele nao altera a identidade do Omni nem vira uma segunda fonte de memoria.

## Contrato e estado vivo

`contratos/interface/omni-desktop.json` declara as superficies, a divisao de responsabilidade e os
limites. `body-contract.ts` valida esse contrato e monta, a cada turno do coordenador, uma projecao
tipada do estado atual: conversa ativa, sessoes vinculadas, execucoes relevantes, pedidos ao editor e
disponibilidade de voz.

O modelo recebe a projecao sem segredos, credenciais, transcricoes brutas, pixels, CSS ou DOM. Logo,
ele sabe que tem um corpo e o que pode fazer nele, mas nao inventa botao, card ou estado visual.

## Regras de interacao

- O chat central coordena e avalia retornos automaticamente. Pendencias operacionais dentro do
  pedido autorizado voltam ao mesmo executor com uma correcao concreta; o proprietario recebe
  uma atualizacao no chat, sem precisar consumir o card para liberar o proximo passo.
- Resultados finais longos aguardam **Receber retorno**, exclusivamente no card do agente ou
  da sessao. Nao ha pre-autorizacao nem painel separado no composer. Cada clique enfileira a
  apresentacao no chat de destino, sem intercalar duas entregas nesse chat. Correcoes operacionais
  continuam automaticas, com avisos curtos. Cards permanecem navegaveis.
- `ResultDeliveryQueue` separa autorizacao de leitura da autorizacao de execucao e preserva a
  ordem dos cliques. O reinicio deixa uma entrega interrompida disponivel para novo clique.
  Preferencias legadas de entrega automatica sao removidas e nunca disparam uma entrega.
  O mesmo ciclo atende subagentes e VS Code; um futuro adaptador Overcore precisa se vincular
  ao contrato de origem/resultado, nao simular despacho por um placeholder.
- O plano estruturado permanece interno ate ser validado. Confirmacoes operacionais curtas
  nascem do recibo real de despacho, com executor e estado tipados; registrar nao significa
  receber, executar ou concluir. Uma frase do plano nao pode anunciar outra rota.
- Respostas de conversa e relatorios aparecem nos deltas reais de geracao, sem temporizador
  de digitacao. A conversa recebe geracao propria apos a decisao de nao executar; nunca se
  anima um rascunho pronto. Instrucoes internas ficam ocultas e historico nao e reanimado.
  O circulo giratorio acompanha a preparacao e geracao da resposta, inclusive a sintese final
  liberada pelo card. Nao permanece girando apenas porque um executor delegado esta ativo.
  Markdown parcial e apresentado ja formatado durante a chegada do texto, sem cursor artificial.
- O briefing completo e persistido em `Supervision.executionBrief`, junto ao pedido original.
  A revisao considera compromissos pertinentes e nao encerra pendencias operacionais necessarias.
  Relatorios distinguem estado local, commit, push, merge e deploy quando exigidos pelo pedido.
- Cancelamentos impedem retomada. Repeticao sem progresso ou tres correcoes sem conclusao
  interrompem reenvios automaticos e produzem um relato do bloqueio real.
- Um chat de sessao VS Code e controle remoto da sessao vinculada. A execucao permanece nela.
- Na central, inventario autorizado de metadados locais do cofre/Cracha/contas e tarefa
  pessoal do Omni, mesmo com seu repositorio aberto no VS Code. Alterar codigo e trabalho
  do projeto. Cadastro e teste de segredos continuam no intake/broker, fora da inferencia.
- Pedido encaminhado, acompanhamento e retorno de um editor aparecem no chat do card da sessao
  executora, identificado por `deliveryConversationId`. A central conserva a confirmacao curta do
  encaminhamento. `originConversationId` preserva a origem da autorizacao e a correlacao continua
  pelo `editor-request-id`; a caixa tecnica de entrada nao determina o destino visual.
- Subagentes locais continuam entregando na conversa mae. Pedidos VS Code pendentes legados
  recebem o destino e o contexto de encaminhamento sem repetir mensagens ou mover historicos
  ja entregues. Duas sessoes do mesmo workspace mantem conversas e retornos separados.
- Overcore e Oracle permanecem apenas superficies futuras ate seus contratos de integracao existirem.
- A interface informa capacidade e estado; ela nunca concede nova autoridade nem chama relato externo
  de verificacao independente.

## Entrada de acessos no Crachá

A tela do Crachá recebe credenciais em um campo visível e conversa temporária. O texto bruto
nunca vira mensagem do modelo nem memória: atravessa somente a ponte local para o processo
principal e o broker confiável. A tela recebe um identificador temporário e o resultado do teste.
Guardar exige autenticação verificada; o broker confere novamente na escrita, guarda o segredo
no cofre do Windows e registra somente metadados e observações no PostgreSQL. Tipos sem conector
ficam pendentes, sem receber estado de acesso validado.

Fluxo e verificações: [recepção segura do Crachá](validacao/2026-09-11-cracha-recepcao-segura.md).
