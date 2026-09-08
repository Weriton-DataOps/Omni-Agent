# Auditoria — autocorreção histórica entre sessões

Data: 2026-08-31

## Incidente

O gate acumulava achados de turnos em `repairing`, delegações sem verificação e releases antigas sem
distinguir trabalho executável de histórico sem prova. A auditoria detectava a dívida, mas o executor
de parada só podia reavaliar o turno ativo. Ao encerrar a sessão, a pendência permanecia no store sem
um worker capaz de reivindicá-la.

## Causa

- a autocorreção era limitada ao turno ativo;
- o `SessionStart` não possuía reconciliador histórico síncrono;
- expiração de jobs podia perder o vínculo antes de terminalizar a delegação;
- o gate tratava todo estado diferente de sucesso como dívida ativa;
- falhas da manutenção assíncrona não possuíam histórico próprio observável.

## Correção

- fila durável de turnos com claim pelo mesmo fingerprint de objetivo;
- supersessão somente depois de execução e readback novos;
- estados honestos para histórico irrecuperável ou dependente de reconfirmação;
- reconciliação global de delegações com lease, cancelamento e arquivo não certificável;
- etapa leve de reconciliação em `SessionStart` e `Stop`, com três etapas e lock próprio;
- manutenção lenta com quatro etapas e single-flight separado, sem repetir a reconciliação;
- telemetria hash-only por perfil, com migração do schema anterior e quarentena de store inválido;
- métricas separadas para acionável, aguardando prova, terminal sem sucesso e histórico.

## Invariantes

1. Fingerprint histórico não autoriza reexecutar ação.
2. Relato não equivale a verificação.
3. Arquivar não equivale a sucesso.
4. Evento tardio não reabre estado terminal.
5. Nenhum store novo persiste conversa, erro, ferramenta ou caminho bruto.
6. Hooks de manutenção e reconciliação nunca emitem trabalho operacional para o proprietário.
7. O pedido corrente mantém prioridade; dívida sem relação permanece com worker interno ou fila durável.

## Evidência exigida

- testes de retomada após `SessionEnd` e novo `SessionStart`;
- teste de pedido repetido que só fecha o histórico depois do gate atual;
- migração e deduplicação de interrupções legadas;
- cancelamento de delegação órfã sem perder binding ativo;
- rejeição de evento tardio para delegação arquivada;
- teste de telemetria sem conteúdo bruto;
- verificação completa do pacote e fingerprint final.
