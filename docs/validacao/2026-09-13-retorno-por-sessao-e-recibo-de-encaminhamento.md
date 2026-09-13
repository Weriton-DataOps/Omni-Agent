# Retorno por sessão e confirmação do encaminhamento

## Problemas encontrados

- Pedidos iniciados na central usavam `originConversationId` também como destino do relatório. O chat do card executor podia permanecer vazio.
- O texto livre de um plano era publicado antes da validação, mas o despacho usava a ação da saída estruturada final. Duas versões do plano podiam anunciar um subagente e selecionar uma sessão VS Code.
- Aberturas concorrentes de sessões no mesmo workspace podiam reutilizar o mesmo card ainda sem vínculo. A caixa técnica de retorno também dependia de ter uma conversa aberta.
- Uma falha antes do início de `send` podia deixar um subagente marcado como executando.

## Mudanças

`originConversationId` continua identificando a origem da autorização. `deliveryConversationId` identifica a conversa de apresentação: o card da sessão VS Code chamada ou a conversa mãe de um subagente local. Pedido encaminhado e correções ficam no destino; a entrega longa permanece manual, pelo card, em uma fila por destino.

O plano permanece interno. A confirmação operacional vem de um recibo tipado do pedido/subagente realmente registrado e distingue registro, envio, recebimento e conclusão. Contradições explícitas entre a rota declarada e a ação exigem uma revisão antes de qualquer execução; a checagem não escolhe outro executor. Um recibo persistido prevalece na retomada, sem reenviar o mesmo pedido.

Conversas sem execução recebem uma geração pública própria após o planejamento; relatórios continuam em streaming real. Não há temporizador de digitação. Inventários pessoais de metadados da máquina são distintos de alterações no código do projeto Omni. Segredos continuam fora desse fluxo, no intake/broker.

O vínculo VS Code é serializado e validado por sessão, não apenas por workspace. A coleta de uma caixa técnica conhecida não depende do clique no card. Falhas de preparação entram no caminho limitado de revisão, com estado de falha preservado.

## Verificação

- Suíte final: **109 testes aprovados**, tipagem e build de produção concluídas. Os smokes `thinking-smoke.mjs` e `result-queue-smoke.mjs` passaram.
- Prévia somente em memória do histórico real: 34 conversas, oito pedidos pendentes com destino correto, cinco projeções de contexto sem duplicar cadeias; mensagens da central preservadas. Nenhum histórico foi regravado pela prévia.
- Testes automatizados cobrem isolamento entre sessões, fila por destino, origem preservada, migração idempotente, falhas de revisão e de preparação, planos contraditórios, retomada e streaming público.
- Smoke visual isolado usa dados fictícios e as classes reais de apresentação: encaminhamento atribuído ao Omni, retorno no chat VS Code, círculo de resposta, rascunho preservado e vários retornos serializados.

Não houve teste de credencial real nem publicação em projetos externos nesta validação. Uma caixa técnica encerrada antes do reinício, sem vínculo persistido, não é reconstruída automaticamente. Overcore continua dependente de um adaptador real; o placeholder não executa trabalho.
