# Persistência estruturada e compressão

As seções 33, 34, 43 e 44 usam a política `structured-context-persistence-v1` com store v2.

```text
conversa / execução
       ↓ extrair somente estrutura
Trabalho → Checkpoint → Estado → Referências de evidência e memória
       ↓
checkpoint limitado
```

Esses registros pertencem somente à continuidade do assistente. Eles não formam um Task Manager,
um Event Store, um Artifact Registry nem o runtime de uma plataforma externa. Os campos legados
`runFingerprint`, `eventRefs` e `artifactRefs` são identificadores hash-only de compatibilidade para
checkpoint/readback; não autorizam incorporar as camadas sugeridas por seus nomes.

Checkpoint não é resumo livre de uma conversa inteira. Ele exige objetivo, escopo, non-goals,
requisitos, critérios, Definition of Done e restrições; preserva estado, decisões, pendências e apenas
referências para eventos, artefatos e memórias.

Campos de transcript, mensagens ou conversa bruta são recusados. Descoberta fora do DoD vai para
backlog local e nunca é implementada como efeito do registro. Quando o trabalho é comprovadamente
concluído, uma resolução explícita a retira da fila e a preserva em `resolvedDiscoveries`; a migração
do store v1 cria backup antes de qualquer alteração.
