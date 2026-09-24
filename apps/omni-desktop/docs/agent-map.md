# Mapa de agentes

O acesso `N subagente(s) · ver mapa` no card abre um painel de consulta. O chat central tem acesso ao mapa das tarefas locais. O clique normal no card conserva a entrega do resumo preparado. Consultar o mapa não envia comandos, não inicia agentes, não libera retornos e não muda de conversa.

## Fontes e identidade

- VS Code: diretório exato `<projeto Claude>/<sessionId>/subagents/agent-<agentId>.jsonl`. Não usar a pasta global de subagentes do projeto nem associar pelo workspace.
- Cada registro precisa corresponder ao `sessionId` e `agentId` do arquivo. A árvore acompanha o ramo atual. Chamadas `Agent`/`Task` e seus recibos correlacionam título, objetivo e pai real; filhos aninhados mantêm a identidade composta.
- Omni: tarefas persistidas ligadas por `parentConversationId`, com os filhos internos de suas sessões Claude quando disponíveis.
- As projeções são locais e somente de leitura, separadas do contexto do modelo. Nunca transportam blocos de raciocínio, inputs/outputs brutos de ferramentas ou instruções ocultas. Objetivo e resposta final têm limites de tamanho; formatos comuns de tokens são ocultados.

## Estados e métricas

Execução segue eventos de início, ferramentas e resposta final; interrupção e falha têm estados próprios. Silêncio não conclui nem apaga agentes. Falha de leitura mostra estado não confirmado. Uma resposta pronta do filho não equivale à conclusão do pedido do pai; o pai continua responsável pela consolidação.

Datas e duração vêm dos eventos ou de duração explicitamente informada. Tokens mostram a última chamada com uso registrado (entrada, cache e saída, deduplicando os blocos do mesmo message ID), ou total explicitamente informado pelo executor, identificado separadamente. Não se somam repetidamente contextos reutilizados nem se inventa custo. Métricas ausentes são omitidas.

O painel mantém o pai à esquerda e os filhos à direita; seleção mostra detalhes. Escape fecha e devolve o foco. Movimento reduzido desativa pulsação. A árvore é rolável em telas pequenas.

Validação: `agent-map.test.ts` cobre vínculos, isolamento, métricas, falhas, interrupção, retomada e leitura de arquivos. `test:returns-ui` cobre abertura, cinco filhos, detalhes, Escape/foco e resumo ainda não consumido após consultar o mapa, junto às regressões dos cards.
