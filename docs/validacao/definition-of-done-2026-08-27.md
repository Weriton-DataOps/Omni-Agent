# Definition of Done geral — rodada reservada

**Data da verificação:** 27/08/2026
**Estado:** reservado; nenhum item comportamental foi aprovado antecipadamente.

## Preparação

- [ ] árvore-fonte limpa ou alterações da rodada identificadas;
- [ ] versão instalada do plugin corresponde à versão sob teste;
- [ ] sessão de teste começa com casa local controlada e sem dados pessoais no corpus;
- [ ] `npm.cmd run check` verde;
- [ ] `npm.cmd test` verde;
- [ ] `claude plugin validate .` verde.

## Conversa e personalidade

- [ ] personalidade-base v1 aparece sem recitação do contrato;
- [ ] diálogo tem personalidade imediatamente reconhecível, com presença, calor e iniciativa;
- [ ] humor, sarcasmo e analogias aparecem integrados ao raciocínio, sem virar piada pronta;
- [ ] inteligência aparece em conexões, efeitos de segunda ordem, opinião fundamentada e ângulos originais;
- [ ] resposta permanece proporcional ao pedido sem perder intensidade de voz;
- [ ] risco imediato recebe primeiro a ação crítica, sem apagar a personalidade do restante da resposta;
- [ ] Omni compara pedido, ação e resultado antes de concluir;
- [ ] pedido claro produz ação em vez de oferta genérica;
- [ ] correção do proprietário muda o turno seguinte.

## Contexto e memória

- [ ] duas ou mais preferências na mesma mensagem são registradas individualmente;
- [ ] declaração estável entra confirmada sem pergunta cerimonial;
- [ ] inferência incerta permanece candidata;
- [ ] preferência confirmada reaparece quando relevante em outra sessão;
- [ ] objetivo e passo atual sustentam uma retomada;
- [ ] dados privados, conversa e segredos permanecem fora do Git.

## Delegação ponta a ponta

- [ ] Omni escolhe a sessão/projeto correto;
- [ ] prompt completo fica visível no destino;
- [ ] executor começa sem cobranças repetidas;
- [ ] estado passa por `prepared`, `visible` e `running`;
- [ ] conversa central continua disponível durante o trabalho;
- [ ] bloqueio recebe tentativa de destravamento;
- [ ] conclusão retorna resultado e evidência concisos;
- [ ] sessão ou janela criada para a tarefa é encerrada;
- [ ] tarefa pertencente a outra sessão volta ao executor adequado.

## Aprendizado e evolução

- [ ] correção real cria observação de falha automaticamente;
- [ ] repetição cria melhoria operacional pronta;
- [ ] execução bem-sucedida cria observação de atalho;
- [ ] varredura diária recupera uma lacuna simulada e ignora uma evidência já capturada pelo hook;
- [ ] segunda varredura do mesmo corpus não altera nenhum contador;
- [ ] relatório da varredura não contém conversa, resultado de ferramenta, erro ou segredo bruto;
- [ ] destino da melhoria corresponde à natureza do aprendizado;
- [ ] regra operacional vira regra, procedimento vira procedimento e eval vira caso de eval;
- [ ] skill nasce somente quando o aprendizado for uma capacidade;
- [ ] promoção altera a árvore-fonte canônica e passa nos gates;
- [ ] versão publicada contém apenas aprendizado portátil;
- [ ] atualização do plugin traz somente as mudanças da versão;
- [ ] memória pessoal permanece local após a atualização.

## Evidência da rodada

Registrar aqui, amanhã:

- versão/commit testado:
- instalação do plugin:
- sessão principal:
- sessão delegada:
- casos executados:
- falhas encontradas:
- correções aplicadas:
- decisão final: **pendente**.
