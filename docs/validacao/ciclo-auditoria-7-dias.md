# Ciclo de auditoria do Omni — 7 dias

Período inicial: 26/08/2026 a 01/09/2026, no fuso `America/Sao_Paulo`. O ciclo pode continuar por
mais dias se os resultados ainda variarem ou revelarem lacunas.

## Regra da rodada diária

1. confirmar repositório, versão instalada e recarga da interface;
2. registrar estado inicial do Omni;
3. executar os gates determinísticos e o smoke das conexões;
4. usar o Omni em conversa e em ao menos uma tarefa real com delegação, quando houver tarefa adequada;
5. executar a varredura do dia e conferir deduplicação, privacidade e aprendizado;
6. registrar somente evals realmente medidos;
7. comparar estado inicial e final, sem interpretar ausência de evidência como aprovação;
8. anotar regressões, falsos positivos, bloqueios e correções feitas.

## Painel dos dias

| Dia | Data | Gates | Conexões | Conversa | Delegação real | Varredura | Evals | Veredito |
|---:|---|---|---|---|---|---|---|---|
| 1 | 26/08/2026 | 150/150 | smoke 0.19.1 aprovado | observada | pendente após recarga | 4 rodadas | 16 casos | baseline |
| 2 | 27/08/2026 | — | — | — | — | — | — | — |
| 3 | 28/08/2026 | — | — | — | — | — | — | — |
| 4 | 29/08/2026 | — | — | — | — | — | — | — |
| 5 | 30/08/2026 | — | — | — | — | — | — | — |
| 6 | 31/08/2026 | — | — | — | — | — | — | — |
| 7 | 01/09/2026 | — | — | — | — | — | — | — |

## Critério para encerrar ou prolongar

O ciclo fecha depois de sete dias somente se não houver regressão de segurança ou privacidade, os
gates permanecerem verdes, as conexões produzirem evidência real e os testes comportamentais forem
estáveis. Caso contrário, prolongar por blocos de três dias, mantendo a mesma bateria para preservar
comparabilidade.

O inventário completo do primeiro dia está em
[`auditorias-2026-08-26.md`](auditorias-2026-08-26.md).
