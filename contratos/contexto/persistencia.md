# Persistência estruturada e compressão

As seções 33, 34, 43 e 44 usam a política `structured-context-persistence-v1` com store v2.

```text
conversa / execução
       ↓ extrair somente estrutura
Task → Run → State → Events → Artifacts → Memory references
       ↓
checkpoint limitado
```

Checkpoint não é resumo livre de uma conversa inteira. Ele exige objetivo, escopo, non-goals,
requisitos, critérios, Definition of Done e restrições; preserva estado, decisões, pendências e apenas
referências para eventos, artefatos e memórias.

Campos de transcript, mensagens ou conversa bruta são recusados. Descoberta fora do DoD vai para
backlog local e nunca é implementada como efeito do registro. Quando o trabalho é comprovadamente
concluído, uma resolução explícita a retira da fila e a preserva em `resolvedDiscoveries`; a migração
do store v1 cria backup antes de qualquer alteração.
