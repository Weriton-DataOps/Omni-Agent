---
description: "Aplicar a recuperação validada para falha de executar fielmente o pedido atual."
argument-hint: "[contexto da execução]"
---

# learned-recuperar-executar-fielmente-o-pedido-atual

Use esta skill somente quando a ação for: executar fielmente o pedido atual.

Classe de falha reconhecida: logic.

Causa raiz validada: O padrao vem da deteccao, nao do comportamento: a regra request-unfaithful do observador casa qualquer prompt de papel user que contenha nao foi ou nao era, sem checar autoria. Das 6 evidencias reconstruidas, 4 sao mensagens entre sessoes de outros agentes e 2 sao falas do dono sobre outro assunto. As 2 correcoes reais de fidelidade do dia nao foram detectadas. Precisao 0 de 6 e cobertura 0 de 2..

Correção validada: Trocar a regra por detector-fidelidade-v2: descartar prompt cuja origem nao seja o proprietario, pelo marcador de mensagem entre sessoes e blocos de sistema, e exigir enunciado corretivo dirigido ao agente. No mesmo corpus deve dar 0 deteccoes entre sessoes, 0 nas 6 evidencias atuais e 2 nas 2 correcoes reais..

Execute a correção e repita a verificação que comprovou o resultado.

Se a falha reaparecer, pare: não trate este procedimento como regra válida.

Não exponha evidência local, memória ou implementação interna do Omni.
