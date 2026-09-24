# Ciclo de aprendizado — correção e ativação local

## Entrega

Núcleo local 0.23.3. Conhecimento útil não passa mais pela fila de publicação de código. As cinco melhorias antigas foram ativadas como memórias e os respectivos jobs passaram de `awaiting-release` para `learned`, com recibo contendo o ID da memória. Os artefatos e seu histórico de instalação foram preservados; não foram falsamente declarados código carregado.

Além das cinco antigas, outras oito lições recorrentes elegíveis foram ativadas. O critério automático aceita procedimentos, observações de comportamento e casos de avaliação recorrentes, com origem registrada; não promove uma alteração de código nem concede autorização operacional.

## Funcionamento implementado

- Resultados avaliados geram episódios com projeto, data, proveniência, validade e distinção entre relato e verificação independente. O coordenador pode selecionar até três trechos literais fundamentados no relato e vinculados a ferramentas observadas, sem chamada adicional ao modelo.
- Relatos antigos têm recuperação automática, em lotes de até oito por ciclo. A retomada não reenvia tarefas nem executa o relato.
- Gravação local precede a sincronização com PostgreSQL. Falha no banco mantém o aprendizado utilizável e pendente de sincronização. Falha individual recebe backoff de cinco minutos e não impede processar os demais registros.
- A mesma evidência não multiplica registros. Senhas, tokens reconhecíveis e tentativas de transformar relato em autorização são recusados.
- Memórias de projeto são consultadas no projeto correto. Confirmações curtas e supervisão recuperam contexto pelo briefing completo; os IDs aplicados ficam nos eventos do Desktop.
- Uma recusa `Not authorized` e um `EXIT: 1` não são tratados como sucesso só porque o wrapper do shell terminou sem erro. Evidências anteriores seguem na supervisão e instruções idênticas não são reenviadas.
- Predecessores de uma correção saem da contagem de pedidos ativos, sem apagar seu histórico.
- O coordenador sem ferramentas não reserva despacho de automação que depois descartaria. A reserva permanece com contextos executores capazes de consumir o despacho.

## Provas no estado real

Ativação por `scripts/activate-omni-learning.mjs --live --session=18b43508-8e59-4818-9f8b-af14e5d86053`:

- 13 lições operacionais ativadas, incluindo os cinco jobs antigos.
- Dois episódios distintos da sessão Tracking recuperados; relatos de falha repetidos consolidaram a mesma memória.
- Sincronização inicial: 79 entradas, nenhuma falha. Consulta SQL independente em transação somente leitura confirmou 79 IDs solicitados e 79 encontrados.
- Consulta sobre GA4/Hub recuperou no contexto os episódios `mem-8fd3611c-4635-44d3-a0f3-ab41ca88ddeb` e `mem-b80930d1-7d6b-40e9-b09c-8a255577db0d`.
- Depois da atualização, o aplicativo gravou sozinho recibos `learningReceipt.synchronized=true` para resultados antigos de Reengenharia e GR_Dados. Isso confirma execução do caminho integrado, não apenas do script de recuperação.
- Conferência final: 42 recibos de resultados sincronizados automaticamente; 13 jobs em `learned`, nenhum em `awaiting-release`. Após a recuperação, nova consulta SQL confirmou **117 de 117 memórias ativas** no PostgreSQL.
- Build final `88005617f7fc` aplicada em 23/09/2026 às 16:47:23 BRT, com processos Electron reabertos às 16:47:23–24. Identidade do núcleo `0.23.3` com integridade `verified`.

Backup anterior à ativação: `C:\Users\wp.santos\AppData\Roaming\omni\backups\learning-2026-09-23T19-36-21-178Z`. Nenhuma tarefa foi reenviada e nenhum histórico foi apagado.

## Validação

- Desktop: 222 testes aprovados; typecheck e build aprovados. Inclui recuperação após falha do banco, isolamento de registro defeituoso, idempotência, não repetição de tarefas, evidência entre rodadas e contagem de predecessores.
- Runtime: execução ampla de 457 testes, com 455 aprovados inicialmente. Os dois restantes eram a identidade do payload alterado e a expectativa antiga de que a varredura não confirmasse a nova lição automática. A identidade foi atualizada para 0.23.3 e o teste foi ajustado para exigir o novo aprendizado.
- Reteste conjunto de integridade, versão, varredura e aprendizado: 30/30 aprovados. A suíte ampla não foi repetida integralmente depois desses ajustes.
- `npm run check` e `npm run package:check` aprovados; contrato, arquitetura e tipos conferidos.

## Limites preservados

Aprender um procedimento não significa executá-lo, nem é prova de que uma alteração de código foi instalada. Testes, controle de escopo, proteção de trabalho existente e negativas reais de acesso continuam valendo. Relatos aprendidos são dados atribuídos e temporais, não fatos eternos nem instruções superiores às preferências atuais.

Esta entrega é local. Não houve commit, push, deploy remoto ou instalação do plugin em outros hosts. A atualização do Desktop usa o mecanismo local de atualização automática já habilitado.
