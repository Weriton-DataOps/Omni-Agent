# Contrato de regressão do chat e VS Code

- Um novo turno entre sessões atualiza a fronteira de execução. O envelope técnico não vira pedido do proprietário e seu texto não concede autorização.
- Respostas públicas da própria sessão são resumidas mesmo após mensagens de pares. Notificações de tarefas não trocam o objetivo.
- Conclusão natural só se associa ao pedido correlacionado ainda vigente; novo pedido, mensagem de par ou compactação invalida a associação anterior.
- O clique relê a sessão e recusa evidência obsoleta ou execução em andamento, inclusive pedidos encaminhados. Não faz inferência nem reenvia trabalho.
- Anexos de texto chegam ao planejamento e resposta direta. Execução recebe conteúdo e referência integral; imagens chegam como blocos de visão ao coordenador e arquivo legível ao executor.
- Anexo ilegível bloqueia o encaminhamento, em vez de enviar um rótulo vazio. Correções conservam os anexos originais.
- Texto maior que 6.000 caracteres vira anexo no compositor imediatamente. Limites não descartam o rascunho. Envio recusado restaura o conteúdo sem sobrescrever nova edição.
- Atalho com projeto nomeado nunca herda caminho de outro projeto. Referência ao histórico só é permitida em expressões deícticas como “lá”, usando mensagens do proprietário.
- “Recebido” não equivale a executando. Tickets sem relatório ficam em espera; a execução do card vem da telemetria da sessão.
- A auditoria periódica ingere o estado do Desktop no ciclo operacional existente. Evidências são deduplicadas por hash e o PostgreSQL recebe somente a projeção sanitizada do broker.
- Melhorias `ready` continuam sujeitas a baseline limpa, testes, recibo de instalação e leitura da versão carregada. Não são sucesso automático.
- Overcore sem adaptador configurado continua indisponível: nunca há fallback silencioso para outro executor.

Regressões: `npm test`, `npm run check`, `npm run test:returns-ui` no Desktop; `node --test testes/auditoria-desktop.test.mjs testes/varredura-diaria.test.mjs` no núcleo.

## Verificação de 2026-09-16

- Desktop: 166 testes aprovados, typecheck e build concluídos.
- Núcleo: 443 testes de runtime e 45 testes TypeScript aprovados.
- Interface isolada: clique no card, resumo previamente persistido, revelação rápida, azul/verde, retorno mais recente, anexos e rascunho preservado; sem novo relay nem inferência no clique.
- Leitura das sessões reais confirmou a recuperação de um retorno recente anteriormente substituído por evidência antiga. Nenhuma tarefa real foi reenviada para validar.
- Build local confirmada pelo recibo de aplicação; isso não comprova publicação no Git nem atualização de plugins em outros hosts.
- Núcleo local 0.23.2 com fingerprint verificado. Metadados de release em ordem cronológica, sem duplicação.
- Ausência de telemetria é estado indisponível, não ociosidade nem conclusão.
- Integração do Overcore ainda depende de adaptador. Trabalhos históricos aguardando release continuam pendentes, sem fechamento artificial.
