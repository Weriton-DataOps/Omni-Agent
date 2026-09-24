# Interpretação semântica antes da ação privada

## Correção

O coordenador não responde mais ao pedido de execução com uma busca automática disparada por palavras como “consulte”. Também foram removidos o cadastro automático disparado por verbos, o filtro textual que negava toda a execução ao encontrar “não execute” e os briefings fixos que substituíam o planejamento de delegações explícitas.

O modelo recebe a mensagem inteira, histórico, sessões, tarefas existentes, capacidades reais e referências dos anexos da conversa. Escolhe a ação principal e, quando necessária, uma ação privada estruturada: inventário, cadastro ou uso. O resultado da ferramenta privada retorna ao modelo como evidência para a resposta, não como texto pronto que substitui a conversa.

O código valida o contrato, a referência do anexo, a vinculação à conversa, o trecho de autorização da mensagem atual e as operações permitidas. Não usa vocabulário para determinar intenção. Citar um trecho não prova por si só o significado da autorização: a interpretação da mensagem inteira continua sendo responsabilidade do modelo. As restrições de destino, sigilo, revogação e operação continuam no runtime/broker.

Uma confirmação contextual pode selecionar o anexo de uma mensagem anterior desta conversa. Um rascunho privado ainda não enviado não é consumido. Uma permissão de catálogo não libera freshness: a ponte verifica a lista de operações do plano antes de resolver o acesso.

## Evidência

- 244 testes do Desktop aprovados; checagem de tipos e build aprovadas.
- Regressão usa o texto completo enviado ao usuário: leitura T1.1.1 autorizada e DW.2–DW.6 proibidas. O coordenador entrega o cliente da ponte, sem expor o documento privado.
- Cobertura de confirmação contextual, fonte de outra conversa recusada, operação fora do plano recusada, segredo ausente do prompt/briefing/Store e complemento no subagente existente.
- Interface Electron: `document-ui.mjs --private-context` passou. Segredo ausente de chat/modelo, próximo rascunho preservado e mensagem mantida quando o anexo expira. Artefatos: `apps/omni-desktop/out/document-ui-D6tXdH`.

### Modelo real, sem ferramentas ou acessos reais

O script opt-in `apps/omni-desktop/scripts/eval-private-intent.ts` executou o planejador real pela mesma classe Coordinator e pelo Claude instalado, com fontes fictícias. Relay, concessão e resposta final foram substituídos por fixtures; nenhum executor real ou banco foi acionado.

| Mensagem | Decisão observada |
| --- | --- |
| Texto completo: executar leitura T1.1.1, não executar DW.2–DW.6 | `project` + `use`, catálogo e freshness; uma entrega à porta simulada, nenhuma consulta de inventário. |
| Explicar como usar, não conectar/testar/guardar | `reply`, sem ação privada, concessão ou entrega. |
| “Pode seguir com essa leitura; deixe as alterações para depois”, após contexto com anexo anterior | `project` + `use`, reutilização do contexto privado; uma entrega à porta simulada, nenhuma consulta de inventário. |

São três observações reais, não garantia de acerto universal do modelo. Os demais testes de integração usam decisões simuladas para verificar deterministicamente o runtime.

## Build e limites

Bundle gerado em 24/09/2026 às 12:08:15 UTC. O mecanismo local de atualização registrou aplicação da build `67c3cfb576c7` às 12:08:25 UTC. A integridade do núcleo 0.24.1 retornou `verified`.

Esta mudança não cria credenciais ausentes, não comprova conexão ao servidor do proprietário e não adiciona escrita ou SQL arbitrário à ponte. Anexo temporário não é cadastro permanente. A leitura no servidor ainda depende de acesso privado válido, identidade SSH confirmada e permissões reais.
