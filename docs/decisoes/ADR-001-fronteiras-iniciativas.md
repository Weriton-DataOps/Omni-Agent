# ADR-001 — Fronteiras entre as iniciativas

**Status:** aprovado pelo proprietário em 26/ago/2026.

## Decisão

Omni, Oracle e OverCore são iniciativas independentes. Nenhuma delas é camada interna de outra.

```text
Omni                         Oracle                       OverCore
agente pessoal               agente observador           ambiente de desenvolvimento
executor e suporte           vigilante e reportador      baseado no Agent SDK
       │                            │                            │
chat/realtime depois         superfícies depois          sistema de desenvolvimento depois
       └──────────────── contratos de integração futuros ───────┘
```

### Omni

- único agente ativo neste repositório;
- personalidade, conversa, memória, contexto, execução pessoal, capacidades, skills e aprendizado;
- receberá chat e Realtime somente depois de extensa validação conversacional do núcleo;
- não contém código, memória, runtime ou responsabilidades das outras iniciativas.

### Oracle

- iniciativa e repositório próprios;
- agente observador, vigilante e reportador;
- futuramente receberá conectores para servidores, bancos e outras superfícies de observabilidade.

### OverCore

- iniciativa e repositório próprios;
- ambiente de desenvolvimento no Agent SDK;
- futuramente reunirá agentes, skills e modelos maduros em um sistema de desenvolvimento.

## Aplicação à especificação mestre

| Seções | Decisão neste repositório |
|---|---|
| 27–30 | adaptar exclusivamente ao Omni |
| 31 | fora do escopo: seleção entre agentes não pertence ao Omni atual |
| 32–34 | implementar no núcleo do Omni |
| 35 | adiar até aprovação da validação conversacional; não iniciar interface agora |
| 36–37 | fora do escopo; pertencem à iniciativa OverCore |
| 38 | fora do escopo; pertence à iniciativa Oracle |
| 39 | manter como requisito do Omni, com implementação dependente da interface futura |
| 40–46 | invariantes e critérios de fechamento do Omni |

## Integrações futuras

As amarrações serão feitas somente depois da maturidade independente, por contratos, eventos e
adaptadores explícitos. Não haverá compartilhamento acidental de memória, código interno ou identidade.
