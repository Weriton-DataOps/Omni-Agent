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
                         │         │           ├─ delegações verificáveis
                         │         │           ├─ eventos
                         │         │           └─ melhorias candidatas
                         │         │
                         │         ├─ memória
                         │         ├─ falhas
                         │         ├─ atalhos
                         │         └─ evals
                         │
                         └─ AUDITORIA DO TURNO
                              pedido → ação → evidência → estado
                                      │ divergência
                                      └─ solicita correção no mesmo turno
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
                                      ├─ agrupa rotinas repetidas
                                      └─ audita a saúde do sistema
```

O repositório distribui comportamento portátil. A casa `%APPDATA%\omni` guarda memória pessoal,
estado de execução, evidências resumidas e fingerprints. Conversas, erros e resultados brutos ficam
fora do Git.

## Fonte de cada responsabilidade

| Responsabilidade | Fonte |
|---|---|
| identidade ativa | `contratos/personalidade/manifest.json` |
| identidade verificável da release | `contratos/atualizacao/integridade.json` |
| papel operacional | `contratos/arquitetura/invariantes.json` |
| sensores | `hooks/hooks.json` + `runtime/observador.mjs` |
| ciclo vivo | `runtime/ciclo-operacional.mjs` |
| autoridade responsável | `contratos/operacao/autoridade.json` |
| auditoria e autocorreção por turno | `runtime/auditoria-autocorrecao.mjs` |
| auditoria sistêmica | `runtime/auditoria-sistema.mjs` |
| contexto por turno | `runtime/contexto.mjs` + `runtime/hook-contexto.mjs` |
| feedback e ajuste da personalidade | `runtime/feedback-personalidade.mjs` + `runtime/observador.mjs` |
| memória | `runtime/memoria.mjs` + `runtime/pipeline-memoria.mjs` |
| falhas e atalhos | `runtime/falhas.mjs` + `runtime/atalhos.mjs` |
| evolução portável | `runtime/evolucao.mjs` |
| conferência diária | `runtime/varredura-diaria.mjs` + `runtime/hook-varredura.mjs` |
| regras aprendidas | `contratos/operacao/regras-aprendidas.json` |
| procedimentos aprendidos | `contratos/operacao/procedimentos-aprendidos.json` |
| casos aprendidos de eval | `contratos/eval/casos-aprendidos.json` |
| eval sobre conversas reais | `runtime/eval-comportamental.mjs` |
| atualização | `runtime/versao.mjs` + `runtime/atualizacao.mjs` |

O manifesto `.claude-plugin/plugin.json` contém somente metadados aceitos pelo Claude Code. A versão
e o fingerprint usados para provar uma release são lidos do contrato de integridade; a versão do
manifesto público precisa coincidir com ele. Como o próprio contrato fica fora do payload calculado,
o fingerprint pode ser atualizado sem criar uma dependência circular.

## Turno normal

```text
mensagem
  ├─ extrai todos os sinais persistentes
  ├─ detecta correção do proprietário
  ├─ atualiza objetivo e passo vivos
  └─ monta contexto
       ├─ personalidade v3 candidata + ajuste explícito do último voto
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

O desenho abaixo é o fluxo contratual. O runtime prepara, registra estados e exige o despacho; o
adaptador do ambiente realiza o início material do executor. `dispatch-requested` só vira execução
quando o host realmente cria o executor e os sensores observam o evento `started`; ausência desse
evento mantém o trabalho recuperável e provoca nova tentativa, em vez de encerrar o caso em silêncio.

```text
pedido longo/especializado
        ↓
briefing preparado
        ↓
prompt visível no destino
        ↓
executor running ── bloqueio real ─► nova estratégia no mesmo envelope
        ↓
relato (`reported`)
        ↓
verificação independente (`verified`)
        ↓
resumo na conversa central
        ↓
fechamento (`closed`, resultado verificado)
```

Cada transição fica no store local sem guardar o prompt integral. O executor herda um envelope com
intenção, escopo, efeitos e risco em fingerprints. `SubagentStop` registra somente o relato; atalho e
sucesso dependem de ação e evidência reais da auditoria, posteriores ao relato e ligadas ao mesmo
objeto. No caminho público, `owner-intent` referencia o turno ativo da sessão; autoridade herdada
referencia um envelope existente, nunca um fingerprint solto. O teste da interface completa permanece
no DoD humano.

A porta neutra governa a preparação e todos os eventos externos ativos. Cada request é idempotente e
gera um `delegationId`; o adaptador de host apenas transporta esse ID, converte entrega, início e relato
para o protocolo e rejeita eventos sem correlação. O executor que emitiu `started` fica vinculado ao
ciclo, e outro executor não pode reutilizar o mesmo ID. Tecnologia e nomes de hooks ficam no adaptador,
nunca no núcleo da automação de falhas.

## Aprendizado e evolução

```text
preferência clara ───────────────────────► memória confirmada
correção do proprietário ────────────────► falha + melhoria candidata
falha de ferramenta ─────────────────────► padrão por assinatura
conclusão verificada ────────────────────► atalho observado
resposta fraca detectável ───────────────► candidata de personalidade/eval
voto explícito sobre a resposta ─────────► ajuste reversível do próximo turno + candidata revisável

melhoria repetida
        ↓ classificar natureza
  ┌─────┼─────────┬─────────┬─────────┐
regra  procedimento  roteamento  runtime/hook  personalidade  eval/capacidade
  └─────┴─────────┴─────────┴─────────┘
        ↓
artefato correto no repositório
        ↓
check + testes + revisão + versão + commit + publicação
```

A promoção operacional exige evidência repetida, mas dispensa uma cerimônia conversacional. Uma
configuração local indica a árvore-fonte canônica. Quando uma candidata declarativa fica pronta, o
runtime verifica repositório, formato, segredo e destino e pode materializá-la. Roteamento, hook,
correção de runtime e capacidade ficam em `implementation-required` até patch e gates. O Git recebe
somente a regra geral; a experiência privada permanece local.

A conferência diária lê os JSONL locais do Claude Code por streaming, considera somente sessões em
que `/omni:omni` foi ativado e não copia conversas, resultados ou erros para seu próprio estado. O
ledger guarda apenas fingerprints, contadores e relatórios. Assim, uma interrupção ou hook ausente
deixa de ser um buraco permanente sem transformar a mesma execução em duas evidências.

O eval sintético continua protegendo regressões de forma. O eval comportamental real exige duas
sessões instaladas e verificadas, conversa longa, correção do proprietário, uso de ferramenta,
delegação, memória entre sessões, revisão viva do proprietário e recibos vinculados e revalidados
internamente. Não existe pedágio de identidade externa: no modelo local de um único proprietário, a
raiz de confiança é formada pela release instalada, pelos transcritos em raiz confiável, pelos
bindings de sessão e pela revisão local explícita. Presença do prompt prova disponibilidade; somente
o conjunto completo de gates prova aderência comportamental.

## Estado da interface

Interface, chat e Realtime seguem fora da arquitetura ativa. Primeiro o núcleo será validado por
conversa real; depois os canais consumirão os mesmos elementos de contexto em projeções próprias.
