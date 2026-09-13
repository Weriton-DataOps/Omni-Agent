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
- Resultados finais entram na conversa originadora automaticamente. Cards indicam execucao e
  revisao; a central fica livre. Cada correcao preserva objetivo, origem, executor e tentativa.
- Cancelamentos impedem retomada. Repeticao sem progresso ou tres correcoes sem conclusao
  interrompem reenvios automaticos e produzem um relato do bloqueio real.
- Um chat de sessao VS Code e controle remoto da sessao vinculada. A execucao permanece nela.
- O retorno de um editor e correlacionado pelo `editor-request-id` e aparece na conversa originadora,
  mesmo que a caixa tecnica de entrada seja a sessao Omni no VS Code.
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
