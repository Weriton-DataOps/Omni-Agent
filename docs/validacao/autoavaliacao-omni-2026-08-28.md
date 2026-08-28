# Autoavaliação do Omni — confronto com evidência

Data: 28/08/2026
Estado: diagnóstico incorporado; correções técnicas implementadas; observação comportamental reservada.

Adendo técnico: o readback posterior revelou dois falsos pendentes históricos. A `0.20.1` passou a
encerrar a skill formalmente retirada como `retracted` e a preferência antiga incorporada pela regra
canônica como `superseded`. Nenhum dos dois recebe aprovação ou `installed-verified` por atalho.

## O que o próprio Omni reconheceu

O Omni afirmou que a personalidade canônica é reinjetada em cada turno, mas sua aderência cai sob
carga; que a suíte de personalidade existia sem execução contra conversa real; e que o circuito de
feedback estava desenhado, porém desconectado. Também descreveu permissões em três faixas e propôs
manter um conjunto vermelho permanentemente bloqueado.

## O que a evidência confirmou

- O contrato ativo é realmente carregado pelo hook em cada `UserPromptSubmit` da sessão ativada.
- Não havia rodada válida da personalidade ativa sobre conversa real. A rodada registrada era de
  outro núcleo e os ensaios recentes feitos por subagentes eram respostas idealizadas em scratchpad.
- Correções do proprietário viravam texto, candidatas ou skills sem garantir alteração no runtime,
  gate, release, instalação e reteste real.
- A aderência não pode ser inferida da presença do prompt. Injeção mede disponibilidade; somente uma
  conversa observada mede comportamento.

## Onde a autoavaliação foi insuficiente

1. **“Rodar os casos sintéticos” não fecha o eval.** A suíte agora tem 26 casos, incluindo as quatro
   correções desta autoavaliação. Eles continuam úteis como regressão sintética,
   mas não demonstram voz persistente, memória entre sessões, delegação ou correção em uso real.
2. **“Promover depois da rodada” é cedo demais.** Promoção exige proveniência do plugin instalado,
   transcritos reais, revisão do proprietário e todos os gates comportamentais.
3. **A leitura da faixa vermelha misturou negação e abstenção.** No hook instalado, quatro formas de
   comando eram realmente negadas, enquanto a lista `JAMAIS` apenas deixava de conceder `allow` e
   devolvia a decisão ao host. O substituto canônico elimina `deny` histórico e liga credenciais a
   sessão, agente, objetivo, alvo, ambiente e efeito; sua ativação muda uma fronteira global e, por
   isso, permanece separada até autorização explícita.
4. **O texto dizia que o guardião já resolveria depois do restart sem prova final.** Fonte, instalação,
   versão e fingerprint precisam coincidir antes dessa conclusão.

## Correções derivadas

- A suíte sintética permanece como teste de regressão, não como prova de personalidade aprovada.
- O gate `omni-real-behavior-v1` exige duas sessões reais, oito ou mais turnos, correção do dono,
  ferramenta, delegação, memória entre sessões, identidade da release instalada e revisão humana.
- A auditoria passa a distinguir: `detectado`, `corrigido`, `verificado` e `observado-em-uso`.
  Reconhecer a falha nunca mais equivale a fechá-la.
- Autoridade acompanha o objetivo e a delegação dentro do mesmo envelope. Risco é tratado por método,
  não por recusa automática; expansão material, novo privilégio/custo ou efeito irrecuperável exige
  uma nova decisão.

## Regra de fechamento

Esta autoavaliação só será considerada aprendida quando a correção estiver no runtime, coberta por
teste, versionada, publicada, instalada com o mesmo fingerprint e aprovada numa conversa real. Até
lá, ela é evidência diagnóstica — valiosa, mas não um troféu de papelão.

## Proveniência desta autoavaliação

- origem: `self-report` produzido pelo próprio Omni;
- SHA-256 do anexo recebido: `8457f64a90e95bade6f626a94d1b759b50d795287b61955ea47054ffb4378672`;
- função: gerar hipóteses e casos de regressão;
- poder de aprovação: nenhum;
- alegações confirmadas externamente: reinjeção do contrato no hook e ausência de rodada confiável;
- alegações corrigidas: a suíte não tem mais 22 nem 25 casos, mas 26;
- alegações não aceitas como prova: score próprio, autoria do proprietário, aderência comportamental e
  estado do guardião.

O runtime agora registra a rodada como `unverified-claim` enquanto não houver verificação
criptográfica interna de recibos e de uma identidade externa do proprietário. Callback fornecido pelo
chamador também é apenas alegação: não produz `passed` nem promoção. Recibos alegados precisam ser
distintos e ter bindings explícitos, e qualquer `passed` histórico não revalidável é rebaixado para
`unverified-legacy-claim`. Um hash preserva integridade; não transforma o autor da autoavaliação no seu
próprio juiz.
