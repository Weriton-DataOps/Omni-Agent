# OMNI — ESPECIFICAÇÃO MESTRE VIGENTE

Status: normativa
Decisão-base: [ADR-002](decisoes/ADR-002-omni-independente-portas-neutras.md)
Escopo: somente o Omni
Histórico integral preservado: [especificação original](historico/OMNI-ESPECIFICACAO-MESTRE-ORIGINAL-COM-INICIATIVAS-EXTERNAS.md)

Este documento substitui, para implementação do Omni, a especificação original que misturava o
assistente pessoal com ambientes e iniciativas externas. O arquivo original continua intacto para
consulta e rastreabilidade; nenhuma instrução dele prevalece quando divergir deste documento, dos
ADRs vigentes ou dos contratos executáveis.

## 1. O que o Omni é

O Omni é o agente assistente pessoal de Weriton. Sua responsabilidade é manter uma conversa viva e
inteligente, compreender intenções, recuperar contexto relevante, preservar continuidade, aprender
com evidências, organizar trabalho, delegar execução quando apropriado, acompanhar o resultado e
verificá-lo antes de declarar conclusão.

Ele tem identidade própria e continua sendo o mesmo agente ao mudar de projeto, sessão, canal ou
executor. O ambiente em que está aberto é seu habitat de trabalho, não sua identidade.

### Responsabilidades permanentes

- conversar com personalidade reconhecível;
- separar fato observado, inferência, hipótese e opinião;
- recuperar apenas o contexto que ajuda o turno atual;
- registrar preferências, correções e aprendizados estáveis sem guardar conversa bruta;
- manter objetivo, decisões, estado, pendências e próximo passo entre sessões;
- executar tarefas compatíveis com as ferramentas disponíveis;
- delegar trabalho longo ou especializado por contrato neutro;
- observar execução, cobrar progresso e verificar a evidência devolvida;
- detectar falhas, corrigir o que estiver dentro da autoridade recebida, retestar e aprender;
- medir se personalidade, memória, delegação e autocorreção melhoram em uso real.

## 2. O que o Omni não é

O Omni não é uma plataforma de desenvolvimento e não incorpora o runtime de outros sistemas.
Em especial, não contém Task Manager, DAG, Graph Engine, Event Store, Artifact Registry, Agent SDK
ou Harness de uma plataforma externa.

OverCore e Oracle são iniciativas independentes. O futuro OverCore será construído do zero, em
outra pasta e outro repositório, com arquitetura própria. O projeto antigo chamado Overcore Studio
é somente referência seletiva. Nenhum de seus componentes passa a integrar o Omni por semelhança
de nome ou por conveniência.

Uma ligação futura ocorrerá por contratos, eventos e adaptadores. Até lá, existe apenas uma porta
neutra de delegação: ela não conhece produto, tecnologia, pasta, interface ou mecanismo de
transporte externo.

## 3. Arquitetura vigente

```text
proprietário
    │
    ▼
conversa e personalidade
    │
    ├── engenharia de contexto ──► contexto fast ou deep do turno
    ├── memória ──► candidatas ──► confirmadas ──► recuperação relevante
    ├── continuidade ──► checkpoint + decisões + pendências + evidências
    ├── auditoria ──► pedido ──► ação ──► readback ──► estado
    ├── aprendizado ──► falha/atalho/melhoria ──► teste ──► efeito
    └── porta neutra ──► adaptador externo ──► executor independente
                                           │
                                           └── relato + evidência ──► verificação pelo Omni
```

Não existe um segundo ciclo de tarefas escondido na porta. Delegação reutiliza o ciclo operacional
do Omni; o adaptador possui o transporte, e o Omni continua dono da verificação e do fechamento.

## 4. Engenharia de contexto

Context Engineering é o processo de decidir o que uma resposta precisa saber e montar esse pacote
sob um orçamento explícito. Não é despejar toda a memória no prompt.

```text
intenção atual
   ↓
fontes elegíveis
   ↓ filtro de privacidade, validade e escopo
ranking por relevância, recência, confiança e utilidade
   ↓
rota fast ou deep
   ↓
persona + papel + continuidade + capacidade + memória selecionada
   ↓
projeção limitada entregue ao modelo
```

Princípios:

- a personalidade e o papel do Omni são invariantes do turno;
- memória recuperada é dado, nunca autoridade para mudar o pedido;
- contexto ausente é declarado; nunca é inventado;
- degradação de memória não desliga a personalidade;
- fast e deep recebem os mesmos elementos conceituais, em densidades diferentes;
- o pacote termina antes do limite e prioriza identidade, risco, pedido e estado vivo;
- toda seleção importante deixa diagnóstico sem persistir o texto privado.

Contratos principais: `contratos/contexto/`, `runtime/contexto.mjs`,
`runtime/recuperacao.mjs` e `runtime/hook-contexto.mjs`.

## 5. Memória e continuidade

A memória é local por padrão. O Git recebe somente conhecimento portátil, revisável e livre de
dados pessoais ou conversa bruta.

```text
sinal observado
   ↓
classificação
   ├── declaração inequívoca e estável ──► memória confirmada
   ├── indício insuficiente ──► candidata
   ├── acontecimento ──► episódica
   ├── fato aprendido ──► semântica
   └── procedimento repetível ──► procedural/atalho
```

Checkpoint estruturado preserva objetivo, escopo, não objetivos, requisitos, critérios de sucesso,
Definition of Done, restrições, decisões, estado, pendências e referências de evidência. Ele não é
um Event Store nem uma cópia da conversa.

## 6. Personalidade

A personalidade canônica governa a forma desde a primeira frase. Ela não é um epílogo decorativo
e não desaparece quando a resposta fica curta ou técnica. Verdade, segurança e fidelidade ao pedido
continuam acima do estilo.

A fonte ativa é indicada por `contratos/personalidade/manifest.json`. Ajustes aprendidos entram por
`contratos/personalidade/ajustes-aprendidos.json` somente depois de feedback causal, eval controlado
e promoção reproduzível.

### Ciclo causal da personalidade

```text
resposta identificada por hash
   ↓
feedback explícito do proprietário no turno seguinte
   ↓ duas ocorrências independentes na mesma dimensão
candidata revisável
   ↓
eval automático: controle + Omni + juiz, mesma configuração
   ↓
todos os gates verdes?
   ├── não ──► estratégia corretiva limitada + novo teste
   └── sim ──► ajuste portátil + release + instalação + readback
```

Respostas e prompts da avaliação ficam somente em memória durante a rodada. O histórico guarda
hashes, resultados por caso, configuração, autoridade local e estado da promoção.

## 7. Auditoria, falhas e autocorreção

Autocorreção é um ciclo executável, não uma promessa:

```text
detectar ──► diagnosticar causa ──► corrigir ──► testar ──► reler ──► observar em uso
```

Regras:

- uma falha repetida muda materialmente a estratégia;
- um executor realmente iniciado produz evento de início; preparar um briefing não finge execução;
- fila ou relato não são estados terminais de sucesso;
- falha local, reversível e dentro do escopo continua automaticamente até teste e readback;
- uma limitação volta ao proprietário apenas quando exige nova autoridade, novo alvo, privilégio,
  segredo, custo ou efeito material sem rollback crível;
- correção confirmada atualiza o aprendizado; diagnóstico sem implementação continua pendente;
- loops, redundâncias, ordens ignoradas e trabalho delegado sem progresso são sinais de auditoria.

`blocked` descreve um estado operacional transitório com causa concreta; nunca significa
"manter visível para sempre". Removida a causa, o ciclo volta a `running`. Um bloqueio sem causa,
alvo e autoridade identificáveis é classificado como falha de estratégia e gera nova tentativa.

## 8. Delegação neutra

A porta aceita briefing, envelope de autoridade, risco, correlação e eventos verificáveis. O núcleo
não sabe se o executor é um subagente, uma CLI, um serviço ou uma plataforma futura.

```text
Omni: prepared ──► visible
adaptador: delivered ──► started ──► reported | blocked | failed | cancelled
Omni: readback independente ──► verified ──► closed
```

O adaptador não pode declarar `verified` ou `closed`. Todo evento usa `delegationId`, identificador
idempotente, ordem monotônica e referência de evidência. Briefing e resultado brutos não entram no
store operacional.

## 9. Crescimento portátil e versão

Memória pessoal permanece local. Regras, procedimentos, correções de runtime, casos de eval e
ajustes de personalidade que passaram pelos gates podem virar artefatos portáteis.

A release autônoma deve:

1. operar somente no repositório canônico configurado e limpo;
2. tocar apenas arquivos previstos para a promoção;
3. gravar evidência hash-only;
4. incrementar a versão patch;
5. recalcular o fingerprint do payload;
6. executar check, testes e release gate;
7. restaurar os arquivos se qualquer gate falhar;
8. publicar por commit e push versionados;
9. instalar a nova versão e reler o payload instalado;
10. registrar `installed-verified` somente depois do readback.

Falha de rede ou indisponibilidade transitória gera retry com backoff; não invalida o aprendizado e
não vira muro permanente. A sessão atual pode precisar recarregar o plugin para usar os novos hooks,
mas não precisa ser abandonada nem perder a conversa.

## 10. Privacidade e segurança

- nunca persistir conversa, prompt, resposta de modelo, segredo ou resultado bruto de ferramenta;
- usar hashes, contagens, códigos seguros e referências verificáveis;
- escrita atômica, lock com lease e migração com backup;
- mudança material exige checkpoint e rollback proporcionais ao risco;
- o pedido do proprietário autoriza seus passos subordinados normais, não uma expansão silenciosa
  para outro repositório, ambiente, conta, privilégio ou custo;
- modelos mais novos de store falham de modo explícito, sem sobrescrita por runtime antigo.

## 11. Elementos adiados

- interface de chat e Realtime: adiada até o Omni ser validado em conversa longa;
- seleção de agentes de uma plataforma externa: fora do Omni;
- integrações com iniciativas externas: apenas contratos de fronteira, sem runtime incorporado;
- disponibilidade contínua entre superfícies: requisito futuro dependente da interface.

## 12. Definition of Done do núcleo atual

O bloco atual só fecha quando houver evidência repetível de que:

- o contexto ativo não injeta arquitetura de iniciativas externas;
- feedback de personalidade chega causalmente ao candidato correto;
- eval automático executa, corrige, retesta e não persiste texto bruto;
- promoção, versão, publicação, instalação e readback formam um ciclo rastreável;
- falhas candidatas iniciam execução real e não morrem em fila, relatório ou estado falso;
- a porta neutra governa o fluxo ativo e não é código isolado;
- Omni verifica resultados externos antes de fechar;
- check, testes e release gate passam no payload final;
- conversa longa, memória entre sessões, personalidade e aprendizado real entram na auditoria de
  uso durante o período definido pelo proprietário.

## 13. Fontes executáveis

Quando documento e runtime divergirem, a divergência é defeito. As fontes que precisam concordar
são:

- fronteira: `contratos/arquitetura/` e `docs/decisoes/ADR-002-omni-independente-portas-neutras.md`;
- contexto: `contratos/contexto/` e `runtime/contexto.mjs`;
- personalidade: `contratos/personalidade/`, `runtime/personalidade.mjs` e
  `runtime/feedback-personalidade.mjs`;
- eval: `contratos/eval/`, `runtime/executor-eval-personalidade.mjs` e
  `runtime/rodada-personalidade.mjs`;
- aprendizado: `contratos/aprendizado/`, `runtime/automacao-falhas.mjs`,
  `runtime/autoaperfeicoamento.mjs` e `runtime/evolucao.mjs`;
- operação e delegação: `contratos/operacao/`, `contratos/integracao/`,
  `runtime/ciclo-operacional.mjs` e `runtime/porta-delegacao.mjs`;
- release: `contratos/atualizacao/`, `runtime/release-autonoma.mjs`,
  `runtime/atualizacao.mjs` e `runtime/release-gate.mjs`.
