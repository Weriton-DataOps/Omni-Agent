# Cobertura real do Omni

Atualizado em 28/08/2026. Este documento separa código existente de comportamento ainda sujeito a
teste humano.

## Implementado e coberto por teste automatizado

- personalidade v3 candidata escolhida pelo manifesto, injetada desde a ativação e reforçada após ferramentas;
- memória local, atômica, versionada, com filtro técnico de segredos;
- várias unidades de aprendizado extraídas da mesma mensagem;
- declaração estável e explícita do proprietário confirmada automaticamente;
- recuperação híbrida e ranking de memória confirmada;
- projeções fast/deep com orçamento;
- contexto estruturado formal e estado operacional vivo;
- sensores de mensagem, ferramenta bem-sucedida, falha de ferramenta, subagente, conclusão de tarefa,
  fim de resposta e fim de sessão;
- conferência diária assíncrona, limitada às sessões ativadas pelo Omni, com deduplicação contra os
  sensores em tempo real;
- recuperação de lacunas em memória, falhas e melhorias, mais agrupamento de rotinas repetidas em
  famílias de atalhos;
- primeiro sucesso verificado tornando o atalho local efetivo, três sucessos validando-o e
  falha ou desuso permitindo suspensão e arquivamento;
- correções do proprietário alimentando falhas e candidatas de melhoria no mesmo turno;
- delegação com estados `prepared → visible → running → reported → verified → closed`, além de
  bloqueio, falha e cancelamento explícitos;
- relato de subagente separado de verificação independente; `verified` exige ação/readback auditados,
  posteriores ao relato e do mesmo objeto, sem fabricar sucesso ou atalho;
- envelope de autoridade herdado por intenção, alvo, efeito e risco, vinculado ao turno ativo no
  caminho público e a um pai existente quando herdado, com checkpoint e rollback para alteração
  material reversível;
- auditoria obrigatória por turno, com um único bloqueio de correção e proteção contra loop;
- auditoria sistêmica idempotente na abertura/encerramento, com reparos locais reversíveis e métricas;
- melhoria operacional classificada por destino: regra, procedimento, roteamento, personalidade, hook,
  eval ou capacidade;
- materialização revisável dos destinos declarativos, sem converter todo aprendizado em skill;
- configuração local da árvore-fonte; destinos declarativos repetidos podem ser materializados,
  enquanto roteamento, hook, correção de runtime e capacidade ficam em `implementation-required`;
- dados pessoais e conversa bruta fora do Git;
- atualização do plugin com identidade canônica em `contratos/atualizacao/integridade.json`,
  integridade do payload, cache compatível, evals determinísticos e gates de schema;
- avaliador comportamental que valida transcritos reais em raiz confiável, release instalada, bindings
  internos e revisão viva local sem persistir conversa bruta; só aprova quando todos os gates passam;
- contratos e testes determinísticos de checkpoint, delegação, eval parcial e recarga da versão
  instalada; comportamento ponta a ponta permanece abaixo.

## Implementado, aguardando validação comportamental

- prompt realmente visível em outra sessão na interface usada pelo proprietário;
- executor iniciado, acompanhado, destravado e encerrado de ponta a ponta;
- conversa central permanecendo disponível durante execução longa;
- personalidade v1 perceptível e consistente em muitas conversas reais; injeção por turno já está
  provada, aderência ainda não;
- analogias, humor e iniciativa na intensidade desejada;
- aprendizado repetido materializado no repositório canônico e refletido após atualização do plugin;
- comparação pedido × ação × resultado reduzindo vacilos reais no uso prolongado;
- observação de respostas gerando evals úteis sem falsos positivos;
- varredura de um dia real aumentando apenas campos sustentados por evidência e sem duplicar hooks;
- checkpoint e delegação aparecendo no estado de uma sessão real depois da recarga do plugin.

## Infraestrutura implementada, ativação ou confiança pendente

- guardião canônico v2: fonte e testes prontos, sem ligação a `PreToolUse` em `hooks/hooks.json`; sua
  ativação depende de autorização explícita para mudar a fronteira global. Qualquer guardião antigo
  configurado fora deste repositório é estado externo e precisa ser conferido separadamente;
- promoção confiável da personalidade: o executor e o juiz automáticos usam bindings locais
  controlados; o eval comportamental separado ainda exige a revisão viva do proprietário e todos os
  sinais reais previstos no Definition of Done.

Os itens comportamentais e as pendências de ativação acima permanecem no Definition of Done iniciado
em 27/08/2026 em
[`validacao/definition-of-done-2026-08-27.md`](validacao/definition-of-done-2026-08-27.md).

## Adiado pelo proprietário

- interface, chat e Realtime;
- catálogo completo de projetos;
- integrações com iniciativas externas;
- promoção final da personalidade, até existir raiz confiável e o gate acumular evidência suficiente.

Nenhum item adiado deve ser apresentado como funcional. Nenhum item comportamental deve ser marcado
como aprovado antes de uma rodada confiável registrada pelo gate comportamental.
