# Manutenção e ciclo de vida da memória

Este contrato implementa a seção 23 da especificação mestre sem transformar limpeza em perda
silenciosa.

## Regra de segurança

```text
memória ativa
   ├── expiração explícita ─────────────────────► arquivo local
   ├── candidata antiga, fraca e isolada ──────► arquivo local
   ├── duplicata textual exata ─────────────────► consolida + arquiva a sobra
   ├── semelhança aproximada ───────────────────► proposta; não altera sozinha
   └── atualização/obsolescência/consolidação ─► somente por decisão explícita
```

O arquivo local preserva o registro completo, a ação, a razão, o instante e o eventual substituto.
Não existe exclusão permanente automática. Memória confirmada sem `expiresAt` nunca é aposentada
automaticamente.

Antes da primeira migração para o formato v4, o runtime cria ao lado do store uma cópia local
`memory.json.before-v*-to-v4.*.backup`. O backup nunca entra no Git.

## Manutenção automática

A verificação ocorre no máximo uma vez a cada 24 horas quando a memória é aberta. Ela pode:

1. arquivar itens cujo prazo explícito terminou;
2. arquivar candidatas com pelo menos 90 dias, uma única ocorrência e importância de até `0.6`;
3. unir somente duplicatas textuais exatas do mesmo tipo e escopo;
4. detectar grupos parecidos e apresentá-los como propostas de consolidação.

Uma proposta semântica nunca vira fato, procedimento ou preferência por conta própria.

## Operações explícitas

- atualizar cria um substituto e arquiva a versão anterior;
- marcar como obsoleta retira da recuperação, preservando o histórico;
- consolidar exige ao menos dois IDs, um texto canônico e escopo comum;
- descartar candidata passa a registrá-la no arquivo em vez de apagá-la.

O conteúdo continua exclusivamente no store local. O Git recebe apenas esta política, o schema, o
runtime e os testes.
