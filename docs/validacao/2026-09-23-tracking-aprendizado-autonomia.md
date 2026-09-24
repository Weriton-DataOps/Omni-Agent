# Auditoria do Tracking: memória, condução e autocorreção

Data: 23/09/2026. Sessão Claude: `18b43508-8e59-4818-9f8b-af14e5d86053`. Card Omni: `b891e5dd-8791-4e65-81f4-6a4d5d538f8a` (`tracking-21`).

Auditoria somente leitura do estado real, transcript, código e PostgreSQL. Nenhum pedido reenviado, permissão alterada, memória cadastrada ou automação disparada. Este relatório é o único arquivo criado nesta auditoria. Não foram enviados históricos a modelos externos; não foram lidos blocos de raciocínio privado nem valores de credenciais.

## Conclusão executiva

O Hub foi publicado. O Omni consultou memória e executou supervisão, mas não consolidou os fatos e lições desta execução em memória operacional reutilizável. A autocorreção também produziu duas rodadas desnecessárias por uma regra determinística incorreta. O autoaprimoramento possui uma fila bloqueada: registrar achados no PostgreSQL não significa que eles foram implementados ou carregados.

A validação anterior comprovou persistência e recuperação das preferências, mas foi insuficiente para comprovar o aprendizado de uma tarefa real e a distinção entre negativa do executor e falha de autorização do serviço externo.

## 1. Resultado real do Hub

O relato final correlaciona o workflow `35903205879`, o deployment `dpl_GwqH8xTRLenSqFgNR4uKhcQMY8zq` e o commit `30dab140c184f71a2604f44deed71947ffc9acb3`.

Conferência independente e anônima dos endpoints públicos em **23/09/2026, 15:43:51 BRT**:

- `https://hub.grgroup.org/api/versao`: HTTP 200, commit `30dab140c184f71a2604f44deed71947ffc9acb3`.
- `https://hub.grgroup.org/`: HTTP 200, contém `G-V1MJ663RGJ` no HTML.
- Cabeçalho CSP permite o domínio googletagmanager.

Isso confirma o código publicado e a presença da instrumentação; **não comprova eventos recebidos no GA4**, consentimento, precisão das conversões ou ausência de bloqueadores. O vínculo workflow/deployment vem da evidência registrada pelo executor, não de uma nova consulta autenticada ao GitHub/Vercel nesta auditoria.

Permanece o risco de outro deployment substituir o GA4 caso publique uma versão sem a alteração. Não foi provado que o auto-deploy da Vercel está ligado. Um comentário de workflow não prova uma configuração remota. Serra Madre continua pendente segundo o relato, fora desta verificação pública do Hub.

## 2. O que aconteceu nas últimas rodadas

Horários abaixo em BRT, 23/09/2026.

| Rodada | Ocorrência verificada |
| --- | --- |
| 15:09–15:12, `7052ebe5` | A CLI executou `vercel --prod`. O processo de deploy devolveu `Not authorized` e `EXIT: 1`. Não foi negativa do classificador do Claude. |
| 15:12–15:14, `72de9d7d` | O Omni alegou divergência inexistente. O executor explicou que a recusa era da API da Vercel e distinguiu a rodada anterior das consultas atuais. |
| 15:14–15:16, `235ec94a` | O Omni mandou a mesma conferência outra vez. O executor explicitou que o briefing era idêntico e, nesta rodada, encontrou o workflow oficial no repositório. |
| 15:31–15:35, `15b269b4` | Depois da autorização específica para a rota GitHub Actions, o executor disparou o workflow usando autenticação já existente. O relato apontou a publicação. |
| 15:36–15:37, `c36c3435` | O Omni pediu autonomamente o ID do novo deployment que faltava no briefing. O executor o recuperou sem novo deploy; a supervisão concluiu. |

Houve autonomia útil na última conferência: o proprietário não precisou buscar o ID. A descoberta do workflow deveria ter ocorrido na inspeção inicial da forma oficial de publicação, antes da sequência de hipóteses sobre deploy manual, Git e máquina de terceiros.

Trocar de mecanismo/identidade após uma negativa real de acesso não deve ser tratado como autorização implícita para contornar a recusa. A autorização específica da rota alternativa foi uma decisão legítima; o atraso na investigação e as duas conferências falsas foram desperdício evitável.

## 3. Defeito confirmado na supervisão — ainda presente

Arquivos: `apps/omni-desktop/src/shared/return-evidence.ts`, `src/main/editor-evidence.ts` e `src/main/coordinator.ts`.

O comando de publicação foi envolvido por um shell com `tail` e `echo` do código de saída. O resultado da ferramenta tinha `is_error=false`, embora o texto mostrasse `EXIT: 1` e a recusa da Vercel. A trilha registrou `operation=publish, outcome=returned`.

`reportEvidenceGaps` procura palavras de recusa no relato e exige uma chamada de publicação com `outcome=denied`. Esse estado é atribuído a negativas do classificador/permissão da ferramenta, não a toda falha devolvida pela aplicação. Assim, a existência real da chamada com uma falha remota foi interpretada como ausência de uma recusa comprovada.

Na rodada seguinte, o relato explica a recusa **da rodada anterior**. O verificador olha somente a trilha atual, de consultas, e gera o mesmo alerta. Ele não resolve negação textual, referência temporal nem a cadeia de evidências dos pedidos anteriores. O retorno determinístico ocorre antes da análise pelo modelo; aumentar a qualidade do prompt não evita esse caminho.

Reprodução somente leitura com os dados persistidos confirmou o mesmo alerta nos dois pedidos. A regra foi introduzida na correção anterior de supervisão: corrigia o caso de uma consulta negada narrada como deploy, mas não cobria este caso de falha real da API nem referência histórica.

As duas rodadas de conferência produziram **6 chamadas ao modelo do executor, 8.118 tokens de saída, 30.593 de criação de cache e 5.337.938 de leitura de cache**, somados por ID único de resposta dentro dos intervalos correlacionados. Não incluem o coordenador Omni, não são cálculo de cobrança e leitura de cache não equivale a tokens novos cobrados à tarifa cheia. A segunda rodada encontrou uma informação útil, apesar de ter sido disparada pelo falso alerta.

## 4. Memória: consultada, mas sem consolidar a experiência

Leitura independente do PostgreSQL local, banco `omni`, porta 5433, em transação somente leitura:

- **62/62 registros ativos encontrados**: 54 confirmados e 8 candidatos no cache local.
- Inventário histórico SQL: 284 linhas e 80 fingerprints de texto distintos; essas linhas não equivalem a 284 lições únicas.
- Preferências de concisão e condução existem e têm uso contabilizado. A reprodução somente leitura do ranking recuperou ambas para as frases recentes.
- Eventos do card comprovam consultas com 2–7 memórias aplicadas. Não é correto afirmar que a recuperação de memória nunca rodou.
- As quatro últimas mensagens do proprietário registraram **zero novas memórias extraídas**. Isso é esperado para frases como “regra liberada”, mas não substitui extrair o aprendizado do resultado da tarefa.
- Não há, no conjunto ativo nem no arquivo local de memórias arquivadas, fatos sobre `30dab14`, o workflow de deploy, a recusa `Not authorized` ou a execução `35903205879`.
- O estado estruturado compartilhado tem somente dois checkpoints, o último de 27/08, e nenhum desses fatos do Tracking.

O pipeline automático aprende principalmente declarações do proprietário com padrões de linguagem. Não há etapa no encerramento de `summarizeRequest` que transforme evidência validada do executor em fato de projeto, procedimento ou lição verificável. A auditoria do Desktop cobre quatro classes fixas de falhas, mas não cobre esses falsos alertas, hipóteses equivocadas de deploy ou estratégia que resolveu o pedido.

Outra limitação: novos pedidos gravam como objetivo literal “regra liberada” ou “autorizado, mas o que eu preciso fazer?”. O briefing completo existe, mas a consulta de memória da supervisão usa esse objetivo curto. O ranking então pode recuperar preferências gerais ou regras de outro assunto, em vez do contexto específico da publicação. Não basta aumentar o número de memórias.

Os eventos atuais registram contagens, não os IDs aplicados por turno; portanto a reprodução do ranking é prova do comportamento atual, não prova retrospectiva exata de quais memórias entraram em cada chamada passada.

## 5. Autoaprimoramento: fila efetivamente bloqueada

Estado local do ciclo: 26 candidatos; 15 `ready`, 5 `observing`, 5 `installed-verified`, 1 `superseded`. Existem cinco jobs de automação em `awaiting-release`, nenhum deles com executor ativo vinculado. O mais antigo é de 29/08 e tem contador `releaseAttempts=100`.

`runtime/automacao-melhorias.mjs` serializa o pipeline e inclui `awaiting-release` entre os estados que impedem promover outro candidato. Portanto esses jobs bloqueiam a materialização de achados novos. O achado genérico de falhas de encaminhamento já acumulou 20 ocorrências, mas continua `ready`, sem artefato.

O repositório canônico configurado é o Omni atual. A automação exige baseline Git limpo; a árvore auditada tem 96 entradas de alterações. Essa proteção evita sobrescrever trabalho em andamento, mas falta uma recuperação operacional adequada — por exemplo, execução isolada com reconciliação verificável. Apagar alterações ou dispensar a verificação não é solução.

Há ainda uma desconexão no caminho Desktop: a chamada que captura a mensagem também pode preparar contexto de automação, mas seu texto é descartado em `drain`; as chamadas seguintes usam `contextOnly` e não carregam esse contexto. Isso é uma lacuna estrutural confirmada no código; não há prova de que um despacho específico dessa sessão tenha sido perdido por esse motivo.

## 6. Estados e comunicação continuam imprecisos

- Existem **9 pedidos `reported` com supervisão `settled` e sucessor já criado**. A interface conta todos como “em acompanhamento” porque filtra apenas `completed` e `blocked`. Eles não representam nove execuções ativas.
- A resposta após a correção ainda trouxe uma decisão de 2.119 caracteres, depois outro resumo. A resposta final repetiu provas, risco e outro projeto; não houve necessidade demonstrada de expandir todos esses dados para a pergunta “o que eu preciso fazer?”. A preferência está na memória, mas ainda não há avaliação de qualidade suficiente na saída real.
- O briefing novo voltou a interpretar “só o GA4” como autorização expressa de substituir a versão alheia. A regra nova de preservar o escopo está no prompt, mas o planejamento continuou reproduzindo uma interpretação antiga. O diagnóstico não toma isso como prova de autorização adicional.

## Prioridade recomendada para correção

1. Corrigir a classificação de resultados e o vínculo temporal da evidência; impedir reenvio da mesma conferência já respondida. Manter negativas reais de permissão como negativas.
2. Persistir, ao concluir cada tarefa, fatos de projeto e lições fundamentadas com proveniência, validade e estado de verificação. Recuperar pelo objetivo consolidado, não apenas pela última frase de confirmação.
3. Recuperar a fila de autoaprimoramento sem apagar trabalho: distinguir instalado/carregado, resolver jobs legados e permitir trabalho isolado verificável. Ligar o despacho do Desktop ao executor real.
4. Consolidar estado da tarefa e encerrar predecessores na apresentação. Avaliar concisão pelo que falta decidir, deixando o relatório detalhado disponível sem repeti-lo no chat.

Nenhuma dessas correções foi implementada nesta rodada de diagnóstico. O resultado publicado do Hub foi confirmado; o aprendizado operacional e a autocorreção ainda não estão completos de ponta a ponta.
