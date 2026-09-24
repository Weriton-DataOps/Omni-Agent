# Ponte Crachá → executor: validação de fechamento

## Resultado

Implementada a entrega automática de uma referência temporária ao executor vinculado. O cliente da sessão chama o Desktop, que solicita ao broker privado a conexão SSH e a execução de `psql` no servidor. As senhas não entram no briefing público. O broker de execução é separado do broker de memória.

Isso fornece um canal SSH gerenciado, não uma porta TCP ou um terminal irrestrito. As operações disponíveis são `postgres.catalog` e `postgres.freshness`, somente leitura. SQL arbitrário e escritas dos roteiros DW.2–DW.6 não estão implementados por estes adaptadores.

## Verificação nesta retomada

| Verificação | Resultado |
| --- | --- |
| `apps/omni-desktop`: `npm test` | 243 testes aprovados, nenhum ignorado ou falho. |
| `apps/omni-desktop`: `npm run check` | Tipagem aprovada. |
| `node --test testes/ssh-executor.test.mjs testes/private-executor-integration.test.mjs` | 4 testes aprovados, nenhum ignorado ou falho. |
| `testes/credential-execution-broker.test.ps1` | 17 verificações aprovadas com dados fictícios. |
| `testes/credential-verification-broker.test.ps1` | 27 verificações aprovadas com dados fictícios. |
| Broker instalado, pipe `omni-private-executor-v1` | Respondeu com `postgres.catalog` e `postgres.freshness`. |
| Integridade do núcleo 0.24.1 | `verified` na consulta de fechamento. |
| Build Desktop | Bundle principal gerado em 23/09/2026 às 21:19:36 UTC; recibo local de atualização aplicado às 21:22:51 UTC, versão `75624140d5de`. |

O teste integrado atravessa o cliente Node, o pipe autenticado do Windows, o broker PowerShell, o worker e um servidor SSH real de loopback. Esse servidor **emula a saída do psql**: não comprova acesso, permissões, PostgreSQL real nem dados de produção. Nenhuma operação foi enviada ao servidor do proprietário nesta validação.

A suíte completa do núcleo não é declarada aprovada: na execução anterior houve falha transitória de bloqueio de arquivo e mudança concorrente de integridade. As verificações afetadas passaram quando repetidas isoladamente. Esta tabela registra somente o que foi novamente executado nesta retomada.

## Impedimento restante para provar o uso real

A consulta somente de metadados ao Crachá retornou quatro registros: Google Cloud, portal, PostgreSQL local do access-broker e Vercel. **Não retornou registros SSH nem PG25.** Isso não prova ausência em qualquer outro local ou em um anexo temporário, mas não confirma a afirmação anterior de que esses dois acessos estavam cadastrados no Crachá. Nenhum valor secreto foi lido ou exibido.

É necessário fornecer novamente o acesso pelo painel privado Crachá da conversa correta, ou indicar referências exatas já cadastradas e disponíveis. O formato e os modos de autenticação estão em [Uso pelo executor](../integracoes/cracha-executor.md). A chave do servidor deve corresponder ao `known_hosts` ou a um fingerprint obtido por canal confiável.

O critério de conclusão em produção é receber um resultado real de `postgres.catalog` e, após escolher uma coluna temporal existente, de `postgres.freshness` na sessão vinculada. Preparar a ponte não deve ser apresentado como conexão ou cadastro concluído.
