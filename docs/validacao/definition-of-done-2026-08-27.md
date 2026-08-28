# Definition of Done geral — rodada reservada

**Data da verificação:** 27/08/2026
**Estado:** reservado; nenhum item comportamental foi aprovado antecipadamente.
**Horário planejado:** fim do dia.

> Adendo de 28/08/2026: a autoavaliação do Omni revelou que injeção da personalidade não prova
> aderência. O fechamento agora também exige o gate `omni-real-behavior-v1`, integridade da release
> instalada e evidência de autocorreção observada em uso.

## Caso inicial real

Depois da preparação e da recarga do plugin, iniciar a avaliação enviando exatamente:

> fica no bate bola com o dw e hub até concluir essa parte no hub do proprietário, quero só confeir a
> ui com a geração desse documento esta aberta, é só verificar pelas genelas abertas no windows

Essa frase está registrada como entrada do teste de 27/08. Não deve ser executada antecipadamente.
Avaliar compreensão do pedido, escolha das janelas/sessões, confirmação visual baseada em evidência,
coordenação sem invasão de função, continuidade até o resultado e presença da personalidade do Omni.

## Como executar o teste comportamental

Este não é outro teste de código. É uma conversa controlada para descobrir se o comportamento que os
contratos prometem aparece no uso real.

### 1. Personalidade e conversa longa

Depois de `/plugin` → **Restart**, ative o Omni e converse naturalmente por 8 a 12 turnos. Misture:

- uma pergunta simples;
- um problema técnico que exija raciocínio;
- um pedido claro que ele possa executar;
- uma discordância ou correção sua;
- um assunto em que uma analogia realmente ajude.

Observe se humor, sarcasmo, analogias, opinião e iniciativa aparecem naturalmente durante toda a
conversa. Não peça “faça uma piada” ou “use uma analogia”: o teste é saber se a personalidade nasce
sozinha, sem recitar o contrato e sem ficar caricata.

### 2. Memória entre sessões

Na primeira sessão, declare duas preferências estáveis na mesma mensagem, por exemplo:

> Prefiro mapas antes de textos longos e quero respostas diretas, sem cerimônia.

Converse mais alguns turnos e encerre. Em outra sessão, ative o Omni e faça um pedido em que essas
preferências sejam relevantes, sem repeti-las, por exemplo:

> Explique como as peças do Omni se conectam hoje.

O teste passa se ele aplicar mapa primeiro e objetividade porque recuperou a memória. Abrir outra
sessão aqui é parte do teste; não será uma exigência para cada atualização normal.

### 3. Aprendizado real

Dê uma tarefa segura e repetível. Se ele fizer de um jeito ruim, corrija com clareza. Depois peça a
mesma família de tarefa novamente e verifique se o turno seguinte já mudou. Ao final, conferir:

- a preferência ou correção entrou na memória/falhas;
- uma rotina bem-sucedida produziu observação de atalho;
- a varredura encontrou apenas o que os hooks deixaram escapar;
- uma segunda varredura não duplicou contadores;
- somente aprendizado portátil chegou ao Git; memória pessoal continuou local.

### 4. Evidência

Para cada bloco, anotar pedido, comportamento esperado, comportamento observado e `passou/falhou`.
Falha comportamental não deve ser corrigida durante a conversa de medição: primeiro registrar a
evidência; depois abrir a rodada de correção e repetir exatamente o mesmo caso.

O eval sintético de personalidade continua sendo regressão de forma. Ele não pode, sozinho, promover
a identidade nem substituir a conversa real.

## Preparação

- [ ] árvore-fonte limpa ou alterações da rodada identificadas;
- [ ] versão instalada do plugin corresponde à versão sob teste;
- [ ] sessão de teste começa com casa local controlada e sem dados pessoais no corpus;
- [ ] `npm.cmd run check` verde;
- [ ] `npm.cmd test` verde;
- [ ] `claude plugin validate .` verde.
- [ ] versão e fingerprint declarados em `contratos/atualizacao/integridade.json` coincidem com o
  manifesto público e o payload instalado;

## Conversa e personalidade

- [ ] personalidade v3 candidata aparece desde a primeira resposta, sem recitação do contrato;
- [ ] diálogo tem personalidade imediatamente reconhecível, com presença, calor e iniciativa;
- [ ] humor, sarcasmo e analogias aparecem integrados ao raciocínio, sem virar piada pronta;
- [ ] inteligência aparece em conexões, efeitos de segunda ordem, opinião fundamentada e ângulos originais;
- [ ] resposta permanece proporcional ao pedido sem perder intensidade de voz;
- [ ] risco imediato recebe primeiro a ação crítica, sem apagar a personalidade do restante da resposta;
- [ ] Omni compara pedido, ação e resultado antes de concluir;
- [ ] pedido claro produz ação em vez de oferta genérica;
- [ ] correção do proprietário muda o turno seguinte.
- [ ] voto explícito do proprietário ajusta a resposta seguinte, fica ligado ao turno por fingerprints
  e não persiste conversa bruta;
- [ ] resultado registrado pelo gate usa duas sessões reais, revisão explícita do proprietário,
  recibos criptográficos verificados internamente e identidade externa autenticada;

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
- [ ] `SubagentStop` aparece como `reported`, e não como sucesso;
- [ ] verificação independente leva a `verified` antes de `closed`;

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
- [ ] auditoria do turno detecta ação omitida, falha repetida e conclusão sem evidência;
- [ ] auditoria sistêmica não duplica a mesma fotografia de estado;
- [ ] relatório sistêmico mantém conversa, ferramentas, caminhos e segredos fora do store;

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
