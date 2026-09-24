# Continuidade da autocorreção e reaproveitamento de evidência

## Correções

- Parser Git separa opções globais de subcomando e alvo. Leitura reconhecida entra na família repository; escrita continua mutation. Shell composto/dinâmico não fornece prova positiva de leitura. Não altera permissões de ferramenta.
- PostToolUse da sessão principal consulta o árbitro. Job encerrado libera o próximo elegível sem exigir nova mensagem humana. Um executor running em qualquer fila impede novo despacho; pending não repete briefing em cada ferramenta. Backoff e autoridade concreta continuam respeitados.
- Eventos de subagente não iniciam outras automações. O despacho é instrução ao host, não execução já comprovada: somente SubagentStart confirma início. Sem evento do host não existe scheduler residente nem garantia de execução com a sessão fechada.
- Eval registra escopo funcional e performance não avaliada. Novas propostas e briefings de implementação (incluindo candidatas antigas) recebem essa distinção. Medições e avaliações anteriores permanecem históricas; não foram reescritas para fabricar sucesso.
- `overcore` com operation=evidence e `diagnostico` consultam GET autenticado /v1/validation-evidence. Comprovantes históricos do teste integrado têm hash do relatório conferido e quatro critérios aprovados. Nenhuma tarefa ou modelo é acionado.
- Contexto manda comparar lacuna e comprovante antes de propor reteste pago. Recibo não certifica runtime atual, não conclui outra tarefa e não substitui DoD comportamental. Dados locais não são publicados no Git.

## Entrega e limites

Release isolada 0.24.5 sobre 0.24.4. Alterações paralelas da 0.25.0 são preservadas na raiz canônica, sem publicação por esta rodada.
Testes usam casas temporárias; não dão baixa nos jobs reais. A confirmação comportamental ainda depende do próximo uso real pelo host.

## Verificação desta rodada

- Omni: 476 testes JavaScript, 472 aprovados e 4 ignorados; 54 TypeScript aprovados.
- Overcore: 106 aprovados. Consulta real entre os dois runtimes recuperou um recibo integrado aprovado sem chamar modelo.
- Build limpa e determinística, 59 arquivos dist; payload 216 arquivos com integridade verificada.
- Gate de release: sem erro bloqueante, mas mantém 38 achados de turno, 3 etapas degradadas de autocorreção, 14 melhorias sem materialização, 1 implementação requerida e evals comportamental/personalidade pendentes. Estes são achados gerais existentes, não baixa automática por esta correção.
