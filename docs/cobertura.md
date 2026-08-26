# Cobertura real do Omni

Atualizado em 26/08/2026. Este documento separa código existente de comportamento ainda sujeito a
teste humano.

## Implementado e coberto por teste automatizado

- personalidade-base v1 escolhida pelo manifesto e injetada por turno;
- memória local, atômica, versionada, com filtro técnico de segredos;
- várias unidades de aprendizado extraídas da mesma mensagem;
- declaração estável e explícita do proprietário confirmada automaticamente;
- recuperação híbrida e ranking de memória confirmada;
- projeções fast/deep com orçamento;
- contexto estruturado formal e estado operacional vivo;
- sensores de mensagem, ferramenta bem-sucedida, falha de ferramenta, subagente, conclusão de tarefa,
  fim de resposta e fim de sessão;
- correções do proprietário alimentando falhas e candidatas de melhoria no mesmo turno;
- delegação com estados `prepared → visible → running → blocked/completed → closed`;
- conclusão de subagente alimentando evidência e observação de atalho;
- melhoria operacional classificada por destino: regra, procedimento, roteamento, personalidade, hook,
  eval ou capacidade;
- materialização revisável no artefato correspondente, sem converter todo aprendizado em skill;
- configuração local da árvore-fonte e materialização automática de melhoria repetida;
- dados pessoais e conversa bruta fora do Git;
- atualização do plugin, evals determinísticos existentes e gates de schema.

## Implementado, aguardando validação comportamental

- prompt realmente visível em outra sessão na interface usada pelo proprietário;
- executor iniciado, acompanhado, destravado e encerrado de ponta a ponta;
- conversa central permanecendo disponível durante execução longa;
- personalidade v1 perceptível e consistente em muitas conversas reais;
- analogias, humor e iniciativa na intensidade desejada;
- aprendizado repetido materializado no repositório canônico e refletido após atualização do plugin;
- comparação pedido × ação × resultado reduzindo vacilos reais;
- observação de respostas gerando evals úteis sem falsos positivos.

Esses itens formam o Definition of Done reservado para 27/08/2026 em
[`validacao/definition-of-done-2026-08-27.md`](validacao/definition-of-done-2026-08-27.md).

## Adiado pelo proprietário

- interface, chat e Realtime;
- catálogo completo de projetos;
- integrações com iniciativas externas;
- rodada humana final de personalidade.

Nenhum item adiado deve ser apresentado como funcional. Nenhum item comportamental deve ser marcado
como aprovado antes da rodada de amanhã.
