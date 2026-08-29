# Auditoria de fechamento — papel, autocorreção e autonomia

Data: 29/08/2026  
Escopo: Omni  
Estado: em validação final

## Objetivo

Verificar e corrigir os pontos que faziam o Omni confundir seu papel com uma plataforma externa,
avaliar sem corrigir, preparar sem executar, versionar sem publicar ou manter falhas em estados sem
saída operacional.

## Fronteira confirmada

- Omni: assistente pessoal independente; conversa, contexto, memória, continuidade, aprendizado,
  auditoria, delegação e verificação.
- OverCore: iniciativa externa futura, construída do zero em pasta e repositório próprios.
- Oracle: iniciativa externa independente.
- Ligação futura: contratos/eventos/adaptadores por porta neutra; nenhum runtime externo dentro do
  Omni.

## Bloqueadores encontrados

| ID | Bloqueador | Consequência anterior | Correção exigida |
|---|---|---|---|
| AUT-01 | Porta neutra existia sem governar os fluxos ativos | contrato decorativo e acoplamento ao host | passar preparação e eventos reais pela porta |
| AUT-02 | Fila aceitava preparo como se fosse execução | tentativas zeradas ou trabalho parado | somente evento real `started` confirma início |
| AUT-03 | Falha técnica podia terminar como bloqueio | autocorreção morria sem nova estratégia | retry automático e materialmente diferente |
| AUT-04 | Eval falho consumia o gatilho para sempre | autoavaliação sem autocorreção | reabrir por fonte/estratégia e retestar |
| AUT-05 | Código do juiz descartava a causa segura | nenhuma direção para o reparo | preservar reason code seguro e derivar correção limitada |
| AUT-06 | Só feedback negativo disparava eval | aprovação do proprietário não consolidava comportamento bom | processar sinais positivos e negativos |
| AUT-07 | Promoção parava em arquivo local | Git, plugin instalado e sessão continuavam antigos | versão, commit, push, instalação e readback idempotentes |
| AUT-08 | Regras ativas citavam arquitetura externa | Omni recebia responsabilidade que não era dele | tornar prompt ativo neutro e manter fronteira nos ADRs |
| AUT-09 | Especificação mestre misturava iniciativas | instrução antiga podia vencer por volume | preservar original como histórico e criar mestre Omni-only |
| AUT-10 | Gate de skill parecia bloquear todo aprendizado | proteção de nova capacidade confundida com trava geral | limitar aprovação humana somente à admissão de nova skill |
| AUT-11 | `implementation-required` não iniciava executor | melhoria detectada ficava esperando intervenção manual | criar automação pela porta neutra e exigir início real |
| AUT-12 | Auditoria encerrava falha técnica como estado terminal | achado continuava visível, mas nunca voltava a agir | migrar bloqueio técnico para `repairing`, com nova estratégia e evidência |
| AUT-13 | Atualizador podia tratar a fonte como instalação | readback falso aceitava pacote que o host não carregou | exigir raiz, versão e fingerprint do plugin realmente instalado |
| AUT-14 | Correção operacional terminava antes da publicação | arquivo local mudava, mas o Omni em uso continuava antigo | release operacional automática até `installed-verified` |
| AUT-15 | Filas de falha e melhoria podiam disputar o mesmo repositório | mutações concorrentes, baselines inválidos e loops | arbitrar um despacho e serializar até conclusão instalada |
| AUT-16 | Contexto do hook usava argumentos posicionais desalinhados | blocos trocados e possível `[object Object]` no prompt | opções nomeadas e teste sentinela de ordem e serialização |
| AUT-17 | Eval podia ler o cache instalado e publicar outra fonte | aprovação não provava o conteúdo efetivamente lançado | separar raiz de política e raiz canônica, vincular fingerprint e revalidar a fonte |
| AUT-18 | Lock de release não tinha lease | queda do processo podia bloquear toda evolução futura | lease, recuperação de órfão e token de propriedade do lock |
| AUT-19 | Materialização portátil ocorria antes do baseline | a própria correção contaminava a fotografia inicial | capturar baseline limpo antes de qualquer escrita |
| AUT-20 | Jobs antigos sem baseline não tinham saída segura | retry cego ou fila permanente | recuperar por readback/artefato único; classificar o irrecuperável sem fingir release |
| AUT-21 | `correction-exhausted` parava a personalidade | a mesma falha era diagnosticada sem conserto sistêmico | gerar candidata de runtime hash-only e encaminhar ao ciclo operacional |
| AUT-22 | Orçamento fast cortava papel e personalidade | regras centrais desapareciam justamente na conversa rápida | compactar invariantes para que identidade, voz, delegação e autocorreção caibam juntas |
| AUT-23 | Catálogo tratava correção comum como nova skill | aprovação do proprietário parecia necessária para tudo | separar admissão de capacidade dos ciclos autônomos já autorizados |
| AUT-24 | Uma exceção no começo da varredura abortava eval e release | falha recorrente causava starvation silenciosa da autonomia | isolar as cinco etapas em sequência e continuar com erro somente por fingerprint |
| AUT-25 | Achado operacional antigo bloqueava a release da própria correção | deadlock entre reparar o runtime e publicar o reparo | manter o erro aberto e retestável, mas liberar somente esse caso recuperável no gate |

## Evidências obrigatórias antes de fechar

- `npm run check`;
- suíte completa;
- gate de release;
- teste de contexto ativo sem nomes/arquitetura externa;
- teste de falha → retry → execução real → verificação;
- teste de feedback → candidata → eval → correção → reteste;
- teste de versão → publicação → instalação → readback, com adaptadores simulados;
- verificação do repositório oficial limpo, commit publicado e plugin atualizado.

## Critério de encerramento

Esta auditoria só muda para `fechada` depois de todos os testes locais, gate de release, fingerprint
canônico, commit/push, instalação e readback passarem. O eval pago de personalidade não é fabricado
durante o build: o hook instalado o agenda automaticamente diante do bootstrap ou de nova evidência.
Qualidade percebida em conversa longa continua sendo medida no DoD comportamental, sem reabrir os
muros técnicos removidos nesta rodada.

## Limite da prova desta rodada

Os testes automatizados provam contrato, estado, idempotência e integração. A qualidade da voz em
conversa longa continua no DoD comportamental da auditoria de uso. Uma rodada paga de modelo não é
simulada como aprovação real: quando executada pelo hook instalado, seus recibos e resultados entram
no histórico local sem texto bruto.
