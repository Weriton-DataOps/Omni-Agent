# Revisão: coordenação do Omni e origem das mensagens

Data: 10/09/2026. Escopo: leitura do código, dos vínculos reais do Desktop e dos históricos Claude indicados pelo proprietário. Nenhum comando enviado a projetos, nenhum histórico apagado e nenhuma alteração funcional aplicada nesta revisão.

## Conclusão

O Desktop implementou espelhamento de histórico e um mensageiro de envio único. Isso não reproduz o Omni como coordenador que interpreta o pedido, conversa com a sessão do projeto, acompanha o trabalho, verifica o retorno e apresenta uma síntese para decisão. As correções anteriores de fila e navegação não resolvem essa lacuna.

## Sessões reais localizadas

As conversas coordenadoras relevantes estão em `C:\Users\wp.santos\.claude\projects\C--Users-wp-santos`, não apenas no diretório de históricos do repositório Omni.

| Sessão coordenadora | Evidência observada |
| --- | --- |
| `80d3ce6d-6694-4dca-98c4-7e221a3b182d` | Ativação explícita `/omni:omni`, expansão do plugin 0.22.0, 26 chamadas SendMessage. Em 04/09 cobrou o inventário da sessão `growth-95`, recebeu a resposta e revisou a orientação ao proprietário com base no que o executor mediu. |
| `ca657505-d1c4-464c-ba60-c4d5ebbfc6b3` | 25 chamadas SendMessage. Em 03/09 assinou aviso de término de `station-61`, cobrou SHA e resultado do deploy, confrontou o estado e discutiu a divergência de homolog antes de encaminhar a nova decisão do proprietário. |
| `5f12d737-37e4-45ee-8829-ee0d21321b6c` | 80 chamadas SendMessage. Em 08/09 cobrou o andamento de `dw-7-8f`; após o retorno, apresentou comparação antes/depois, pendências separadas e consequência para o proprietário. |

Na primeira sessão, referências verificáveis: linhas 4–5 (ativação), 2388 (cobrança), 2406 (retorno `cross-session-message` de Growth, marcado `isMeta: true`) e 2417 (orientação revisada). Na sessão Station: linhas 1949 (observação), 1986 (estado sem alegar conclusão antecipada), 2058 (verificação e decisão), 2078 (encaminhamento da decisão). Na sessão DW7: linha 3570 (síntese após retorno).

As contagens são de chamadas registradas nos arquivos, não de tarefas concluídas nem de provas independentes de sucesso. Essas sessões também contêm erros e correções: servem como evidência do fluxo de coordenação, não como modelo a copiar integralmente.

## Achados confirmados

### 1. A seleção não é apresentada nos cards

`src/renderer/main.tsx:246`: ActivityGroup recebe atividades, mas não recebe a conversa selecionada; não aplica classe de seleção nem `aria-current`. A marcação `selected` existe apenas dentro do menu de conversas. O botão principal mantém o título do central, mas também não diferencia visualmente quando esse central está ou não sendo visto.

### 2. Resumo interno atribuído ao proprietário

No Growth selecionado (`growth-eb`, sessão `7820293f-a250-448c-b336-a2c7ee59bd70`), o primeiro item importado é a mensagem `9f2382c8-3878-4ea1-8ae7-ee39294c6b64`, de 16.851 caracteres. No transcript original, linha 8254, ela contém `isCompactSummary: true` e o timestamp de 02/09. Não é um comando novo escrito pelo proprietário.

`src/main/vscode-sessions.ts:28` filtra apenas mensagens de subagentes. A projeção não classifica compactação, mensagens internas, contexto de ferramentas e a origem das mensagens entre sessões. `main.tsx` chama qualquer papel `user` de “VOCÊ” e qualquer `assistant` de “Omni”. Isso perde a distinção entre pessoa, sistema, executor e coordenador.

As 13 mensagens do chat `growth-eb` estão sem horário (`at: ""`) na cópia do Desktop. O leitor procura timestamp dentro de `message`, enquanto o transcript original o possui no envelope. O histórico antigo aparece sem contexto temporal ou sinalização de proveniência.

### 3. Espelhamento não é acompanhamento

`src/main/controller.ts:61` relê periodicamente históricos externos e substitui a lista do chat. Não há delimitação pelo pedido atual, síntese do retorno, verificação de conclusão ou separação entre evidência bruta e conversa de decisão. O histórico real existe, mas sua presença não prova que responde ao comando atual.

### 4. O mensageiro encerra depois do envio

`src/main/vscode-sessions.ts:50` instrui explicitamente o processo a enviar uma única mensagem e encerrar após a confirmação. O mecanismo normal não mantém um coordenador recebendo retornos; `notify_when_idle` está apenas no caminho de teste de disponibilidade.

`sendToEditor` registra `sent` e fase `editor`, mas não percorre estados de início remoto, relato, verificação e entrega. Existe um caso real no Desktop: pedido `9af4cdba-a85c-41d1-81da-86f331c2e3b3`, para `growth-f0`, marcado como enviado às 14:51 UTC; a cópia contém somente o pedido e a sessão não constava mais no registro ativo inspecionado. Isso não permite concluir se o projeto executou ou não; demonstra que o Desktop não fechou nem explicou esse ciclo.

### 5. O central foi reduzido a despachante

`src/main/controller.ts:190` desvia todo envio do central diretamente para `delegate`. Essa rotina cria um executor e acrescenta uma confirmação fixa. `consumeTask` copia o resultado do executor para o central. Nenhuma dessas etapas realiza a interpretação e a síntese que o proprietário espera do Omni coordenador.

O runtime já define uma porta neutra de delegação e diferencia entrega, início, relato e verificação (`runtime/porta-delegacao.mjs`). O caminho externo do Desktop não usa esse ciclo. As instruções canônicas do Omni, seção “Execução e delegação”, também exigem acompanhamento e retorno em poucas linhas.

### 6. Os testes anteriores não mediram o contrato completo

O smoke comprovou existência de mensagens, abertura sem minimizar, consumo de card e isolamento do relatório. Não verificou ausência de compactações, atribuição de autor, identificação do chat ativo, acompanhamento remoto ou síntese útil. A consulta de disponibilidade não substitui uma tarefa real acompanhada até a entrega.

## Correção arquitetural necessária

1. **Identidade visual:** central e card da sessão selecionada claramente identificados; projeto, sessão e situação visíveis sem reintroduzir um cabeçalho grande.
2. **Origem dos dados:** classificar pessoa, Omni, executor e sistema; ocultar compactações e contexto técnico da conversa normal. Histórico bruto acessível separadamente, sem apagar os arquivos originais.
3. **Omni coordenador persistente:** compreender o pedido e manter o vínculo com a decisão e o contexto do proprietário. O trabalho demorado vai para executores; a conversa continua disponível.
4. **Delegação correlacionada:** cada pedido deve registrar origem, sessão destinatária, ID do pedido, escopo autorizado, evidências e estado. Não escolher destinatário apenas pelo nome do projeto nem pelo chat que estiver selecionado na hora do retorno.
5. **Acompanhamento real:** separar “enviado”, “recebido”, “executando”, “bloqueado”, “relatado” e “verificado”. Aguardar retorno sem reenvio duplicado; sessão indisponível significa situação desconhecida/indisponível, não sucesso nem fracasso presumido.
6. **Síntese pelo Omni:** apresentar o que foi feito, o que foi verificado, o que falta, a recomendação e a decisão material que cabe ao proprietário. Detalhes do executor ficam disponíveis sob demanda. Não produzir uma nova decisão autorizativa por mera interpretação do relato.
7. **Fila já combinada:** relatórios de subagentes aguardam clique; ao consumir, entram escritos no central de origem e o card desaparece. Isso é independente do histórico das sessões de projeto.
8. **Teste comportamental de aceite:** comando ao Growth correto, navegação para Station durante a execução, retorno ligado ao pedido original, síntese no destino correto e nenhuma mensagem interna atribuída ao proprietário. Também testar interrupção, reconexão e reinício sem perder a correlação.

Overcore e Oracle continuam fora da integração atual. Essa revisão não autoriza enviar comandos para esses sistemas nem alterar projetos externos.

## Achado histórico adicional — personalidade

Na sessão `80d3ce6d…`, o mesmo evento de entrada recebeu contexto de Gaia (linha 2407) e Omni (linha 2408). Isso merece isolamento em uma revisão de personalidade, mas não prova contaminação atual. Na configuração global consultada agora, o único plugin habilitado entre esses dois é `omni@omni-hub`; não foi encontrada habilitação de Gaia nessa configuração.

## Estado desta rodada

Diagnóstico concluído e evidências registradas. O código funcional, as sessões abertas, o banco e os históricos permaneceram inalterados. A arquitetura de coordenação descrita acima ainda precisa de implementação e validação ponta a ponta; não é declarada pronta por esta revisão.
