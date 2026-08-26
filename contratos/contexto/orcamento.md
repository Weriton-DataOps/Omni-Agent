# Orçamento de contexto

As seções 32 e 42 são aplicadas por `context-budget-v1`.

```text
mandatory → highPriority → relevant → optional
```

Cada categoria possui cota própria dentro do limite fast ou deep. Espaço disponível não é motivo para
carregar conteúdo: capacidade sem relação com a intenção é descartada antes da projeção. Fast é um
subconjunto da mesma fotografia deep.

O diagnóstico registra alocação, uso e itens descartados sem copiar memória pessoal adicional.
