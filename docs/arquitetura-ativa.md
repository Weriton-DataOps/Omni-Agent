# Arquitetura ativa do Omni

## Desenho geral

```text
                               REPOSITÓRIO CANÔNICO
                    personalidade · contratos · runtime · testes
                                      ▲
                                      │ promoção versionada
                                      │
USUÁRIO ─► SKILL ─► HOOKS ─► OBSERVADOR ─► CICLO OPERACIONAL LOCAL
                         │         │           ├─ sessões
                         │         │           ├─ delegações
                         │         │           ├─ eventos
                         │         │           └─ melhorias candidatas
                         │         │
                         │         ├─ memória
                         │         ├─ falhas
                         │         ├─ atalhos
                         │         └─ evals
                         ▼
                 ENGENHARIA DE CONTEXTO
        personalidade + regras + estado + memória + capacidades
                         │
                    FAST ou DEEP
                         │
                      RESPOSTA
```

```text
HOOKS EM TEMPO REAL ───────────────► aprendizado imediato
          │
          └── VARREDURA DIÁRIA ───► compara fingerprints
                                      ├─ ignora o que já foi capturado
                                      ├─ recupera lacunas
                                      └─ agrupa rotinas repetidas
```

O repositório distribui comportamento portátil. A casa `%APPDATA%\omni` guarda memória pessoal,
estado de execução, evidências resumidas e fingerprints. Conversas, erros e resultados brutos ficam
fora do Git.

## Fonte de cada responsabilidade

| Responsabilidade | Fonte |
|---|---|
| identidade ativa | `contratos/personalidade/manifest.json` |
| papel operacional | `contratos/arquitetura/invariantes.json` |
| sensores | `hooks/hooks.json` + `runtime/observador.mjs` |
| ciclo vivo | `runtime/ciclo-operacional.mjs` |
| contexto por turno | `runtime/contexto.mjs` + `runtime/hook-contexto.mjs` |
| memória | `runtime/memoria.mjs` + `runtime/pipeline-memoria.mjs` |
| falhas e atalhos | `runtime/falhas.mjs` + `runtime/atalhos.mjs` |
| evolução portável | `runtime/evolucao.mjs` |
| conferência diária | `runtime/varredura-diaria.mjs` + `runtime/hook-varredura.mjs` |
| regras aprendidas | `contratos/operacao/regras-aprendidas.json` |
| procedimentos aprendidos | `contratos/operacao/procedimentos-aprendidos.json` |
| casos aprendidos de eval | `contratos/eval/casos-aprendidos.json` |
| atualização | `runtime/versao.mjs` + `runtime/atualizacao.mjs` |

## Turno normal

```text
mensagem
  ├─ extrai todos os sinais persistentes
  ├─ detecta correção do proprietário
  ├─ atualiza objetivo e passo vivos
  └─ monta contexto
       ├─ personalidade-base v1
       ├─ regras operacionais canônicas e aprendidas
       ├─ estado relevante
       ├─ memória confirmada ranqueada
       └─ capacidades relevantes
            ↓
        rota fast/deep
            ↓
          resposta
```

Declarações claras como preferência, regra ou procedimento podem ser confirmadas no mesmo turno.
Inferências menos claras continuam candidatas. O filtro de segredo e a escrita atômica são proteções
do runtime, sem ocupar o diálogo com recusas preventivas.

## Delegação

```text
pedido longo/especializado
        ↓
briefing preparado
        ↓
prompt visível no destino
        ↓
executor running ── bloqueio real ─► contexto adicional
        ↓
resultado + evidência
        ↓
resumo na conversa central
        ↓
sessão fechada
```

Cada transição fica no store local sem guardar o prompt integral. O hook de subagente confirma início
e conclusão, injeta o contrato de execução no destino e transforma uma conclusão verificada em
observação de procedimento. O teste da interface completa permanece no DoD de amanhã.

## Aprendizado e evolução

```text
preferência clara ───────────────────────► memória confirmada
correção do proprietário ────────────────► falha + melhoria candidata
falha de ferramenta ─────────────────────► padrão por assinatura
conclusão verificada ────────────────────► atalho observado
resposta fraca detectável ───────────────► candidata de personalidade/eval

melhoria repetida
        ↓ classificar natureza
  ┌─────┼─────────┬─────────┬─────────┐
regra  procedimento  roteamento  personalidade  eval/capacidade
  └─────┴─────────┴─────────┴─────────┘
        ↓
artefato correto no repositório
        ↓
check + testes + revisão + versão + commit + publicação
```

A promoção operacional exige evidência repetida, mas dispensa uma cerimônia conversacional. Uma
configuração local indica a árvore-fonte canônica; quando a candidata fica pronta, o runtime verifica
repositório, formato, segredo e destino e materializa automaticamente. O Git recebe somente a regra
geral; a experiência privada permanece local.

A conferência diária lê os JSONL locais do Claude Code por streaming, considera somente sessões em
que `/omni:omni` foi ativado e não copia conversas, resultados ou erros para seu próprio estado. O
ledger guarda apenas fingerprints, contadores e relatórios. Assim, uma interrupção ou hook ausente
deixa de ser um buraco permanente sem transformar a mesma execução em duas evidências.

## Estado da interface

Interface, chat e Realtime seguem fora da arquitetura ativa. Primeiro o núcleo será validado por
conversa real; depois os canais consumirão os mesmos elementos de contexto em projeções próprias.
