# Auditoria do diálogo, comandos e autocorreção do Omni — 12/09/2026

## Resultado

O problema observado não é apenas de redação. O Omni reconheceu trabalho incompleto, mas nem sempre manteve o objetivo completo como compromisso executável. Em alguns casos ele próprio estreitou o briefing, encerrou com pendências operacionais ou prometeu uma continuação que ficou sem despacho. A mesma arquitetura permitiu uma resposta de conversa informar estado antigo de uma tarefa já concluída.

Há autocorreção funcionando: duas rodadas da Gaia receberam correções automáticas com evidências e publicação relatada. Isso não equivale ao fechamento do objetivo inteiro. O retorno sobre a versão foi marcado `complete` enquanto reconhecia uma falha remanescente do verificador; o problema da fila interna terminou em `decision` com `needsOwner=false`, sem nova execução registrada.

## Escopo e limites da evidência

- Inspeção em 12/09/2026, aproximadamente 23:44–23:57 BRT. Horários dos eventos abaixo estão em UTC; `2026-09-13T02:xxZ` corresponde a 12/09, 23:xx BRT.
- Fonte principal: `%APPDATA%/omni/desktop/conversations.json`, versão 1, 33 conversas inventariadas. A janela de 11–12/09 BRT contém 139 mensagens de conversas com conteúdo: central 71, Growth 34, Site Barretos 22 e Station 12. Houve leitura seletiva dos pedidos e retornos relacionados a execução, validação, entrega, autorização, pendências e personalidade, não auditoria exaustiva de cada fala.
- Conversa central: `ceb921ed-78b9-41fe-8738-ef96e724947d`; sessão associada: `397ac524-3c85-44ee-a17a-7a847aacdd93`. Inspecionados também os estados de 12 tarefas recentes Gaia/Atelier.
- Fontes de estado: `learning/failure-automation.json`, `runs/operational-cycle.json`, `runs/operational-improvement-automation.json`, `feedback/personality-feedback.json`, `memory/memory.json`, sob `%APPDATA%/omni`.
- Fontes de implementação: coordenador, controller, supervisão, contrato do corpo e módulos de aprendizado indicados abaixo. As linhas descrevem a base lida antes das alterações concorrentes desta rodada; os nomes de métodos são referências estáveis.
- Não foram executados comandos nos projetos Gaia, Growth ou Station, nem consultado o GitHub nesta auditoria. Hashes e publicações citados aqui são evidência do que o Omni relatou e guardou, não uma nova conferência remota. Não foram copiados tokens, senhas, anexos nem transcrições completas.
- O contrato atual reserva Overcore/Oracle como integrações futuras, com `actions: []`. Não se presume que exista transporte operacional para eles.

## 1. O que já foi reconhecido e não fechou sozinho

### A1 — Verificador da Gaia: defeito conhecido foi adiado pelo próprio briefing

Em `2026-09-13T01:37:08.094Z`, pedido `0bc216a0-87b6-42a7-b8b9-5f23b982d05a`, o proprietário pediu a atualização da Gaia e um comando que avisasse se a cópia do PC estava desatualizada. Em `02:31:25.464Z`, pedido `b7473fe2-671e-4019-9059-e2fc6376005c`, mostrou que outro PC continuava sem reconhecer a atualização.

O plano `coord:b7473fe2-671e-4019-9059-e2fc6376005c`, às `02:32:14.588Z`, pediu o bump e a publicação, mas acrescentou que um defeito do verificador deveria ser relatado, sem conserto. O retorno `report:9da685da-e218-4963-b163-5fec969519ca`, às `02:34:59.243Z`, informou `plugin.json` remoto em `0.3.0`, hash `19a72708`, e declarou que o script continuava sem comparar a versão do manifesto, deixando isso para outra rodada.

O estado persistido confirma `phase=completed`, `review.action=complete`, `withinScope=true`, `needsOwner=false`. A sessão executora foi `5b2952ef-e541-43b0-bd75-cfd39352db31`.

**Diagnóstico:** o defeito foi identificado, mas o Omni inseriu uma restrição operacional que não vinha como limitação nova do proprietário. O critério necessário era o outro PC detectar corretamente a atualização; publicar um número sozinho não comprova esse comportamento. Isso pede preservação do objetivo original e teste do caminho de consumo da versão. Não é motivo para inventar um novo release ou alterar algo fora do projeto autorizado.

### A2 — Trabalho interno `failure-learning`: a correção diagnosticou uma rota impossível e parou

Na tarefa `47da039f-46d6-419f-8090-4d156e2e1d91`, sessão `4d61b4da-56f2-47f9-9c37-1060cce62718`, houve três correções automáticas. O retorno `report:47da039f-46d6-419f-8090-4d156e2e1d91`, às `02:29:25.877Z`, diz que reenviar mensagens à mesma sessão não aciona o evento `SubagentStart` exigido pela fila. O Omni afirma que o desbloqueio é dele e não exige decisão do proprietário, mas o estado termina `failed/settled`, avaliação `decision`, `needsOwner=false`.

Readback direto dos arquivos de estado:

| Trabalho | Estado encontrado | O que falta provar |
| --- | --- | --- |
| `failure-job-7f7b7aa2-8ab1-4cd9-ab22-94c7b826aaf0` | `queued`, 4 tentativas, `dispatchState=requested`, sem executor; despacho expirava às `02:41:42.249Z` | Um executor realmente iniciado pela rota compatível, testes de correção e fechamento legítimo |
| `failure-job-b6fef482-6d4c-49e4-a39d-1a3230213a68` | `queued`, 0 tentativas, `dispatchState=not-requested` | Despacho e execução; é outro padrão, não uma segunda cópia do primeiro |

A fila completa tinha 20 entradas: 15 `superseded`, 3 `completed`, 2 `queued`. Portanto, a frase “sem ação sua” não veio acompanhada de fechamento ou execução seguinte no estado consultado.

O vínculo exigido é real: `adaptarInicioSubagenteClaude` confere sessão/delegação e chama `confirmarInicioAutomacaoFalha` (`runtime/adaptador-claude-delegacao.mjs:195–238`); o hook entra por `runtime/hook-contexto.mjs:275`; o início exige fingerprint, delegação e prazo compatíveis (`runtime/automacao-falhas.mjs:757–779`). O contrato exige duas execuções distintas de correção (`contratos/aprendizado/falhas.json:15`). A solução não pode ser marcar JSON como `running/completed` ou inventar recibo. Deve existir transporte compatível e uma retomada persistente de responsabilidade do Omni.

### A3 — Melhorias aprendidas continuam em etapas intermediárias

O ciclo operacional continha 22 candidatos: 5 `installed-verified`, 11 `ready`, 5 `observing`, 1 `superseded`. Os 11 `ready` estavam sem `artifactRef` e sem `materializedAt`:

| ID abreviado | Melhoria reconhecida | Ocorrências |
| --- | --- | ---: |
| `b5cc79fb` | Responder com concisão, presença e contexto | 16 |
| `42972d5e` | Consolidar delegação e acompanhamento | 10 |
| `97654812` | Consolidar alteração e verificação de artefatos | 15 |
| `885d0542` | Agir diante de ordem executável e só pedir ajuda por autoridade real ausente | 3 |
| `5205cfb5` | Mudar perceptivelmente uma entrega rejeitada | 3 |
| `cfd7bba1` | Distinguir timeout de processo ativo e bloqueio real | 2 |
| `3fdd3f05` | Corrigir voz genérica | 2 |
| `8edbcdf7` | Preservar voz aprovada sem fórmula repetida | 8 |
| `9f00e011` | Corrigir o caso de autonomia sem devolver operação ao dono | 4 |
| `335d9212` | Corrigir fidelidade ao pedido sem expansão | 3 |
| `b8d7883b` | Corrigir fechamento do relatório com estado e evidência | 3 |

Há cinco jobs de melhoria em `awaiting-release`. O ligado a `improvement-de188886-d352-47dd-9014-c25c615e3268` registra 81 tentativas de release. Os cinco candidatos `installed-verified` têm readback de instalação, mas nenhum `loadedReadback` no estado consultado. Isso não demonstra que o conteúdo não foi carregado por nenhum caminho; demonstra que esses registros não comprovam a aplicação na sessão ativa.

**Não confundir diagnóstico com inexistência de mecanismo:** existem consumidores de materialização em `runtime/auditoria-sistema.mjs:329`, `observador.mjs:361/391/451`, `varredura-diaria.mjs:783` e `executor-eval-personalidade.mjs:720`. O que não fechou são estas instâncias duráveis. Deve-se auditar a transição que mantém cada uma em `ready/awaiting-release`, com causa e ação executável, sem criar mais uma promessa genérica.

### A4 — Preferência de personalidade foi confirmada verbalmente sem novo registro comprovado

Pedido `fbe2614d-0eb3-463a-8135-14fe67b9cbe2`, às `02:34:42.764Z`, elogia a personalidade e pede mais Rick. `coord:fbe2614d-0eb3-463a-8135-14fe67b9cbe2`, às `02:35:08.103Z`, afirma que a direção foi anotada como preferência viva.

O armazenamento consultado contém 12 votos de personalidade; o último é de `2026-09-11T20:39:16.021Z`. Há três candidatos de feedback, atualizados pela última vez em 11/09. As três memórias confirmadas encontradas sobre Rick foram criadas/atualizadas em 28/08; não se encontrou novo registro correspondente à fala de 12/09 nessas coleções. A preferência antiga existe; a alegação de nova persistência não está comprovada.

O caminho do coordenador fornece ao hook os primeiros 400 caracteres do prompt de planejamento/revisão, e não necessariamente a mensagem literal do proprietário (`Coordinator.model` e `Controller.coordinatorContext`). Isso merece teste específico de captura de feedback e separação entre texto do usuário e instrução interna. Não basta a resposta dizer “anotado”.

## 2. O que deveria ter sido percebido mais cedo

### B1 — Faltou um contrato de conclusão do pedido inteiro

O pedido inicial `09bd7804-a8a7-4c97-8a47-8081c4b994d5`, às `01:08:18.020Z`, quer incorporar o Atelier à Gaia e encaminhar design ao agente. A mensagem `8f0c18da-2e56-40ad-aafe-f7ff74a2dae6`, às `01:20:54.610Z`, delimita método/agente/skills, sem virar sistema. A mensagem `20a27abf-8bb0-41aa-ab8d-9c2047c06f7d`, às `01:57:51.751Z`, autoriza subir tudo e trabalhar até ser possível testar.

Antes disso, os retornos `report:ee668a39-0b07-47c8-bde4-4c197643528e` (`01:33:44`) e `report:855b393d-b031-42bd-879a-2515cddf34a3` (`01:40:18`) devolveram lacunas conhecidas com chamadas “diz fecha”/“diz prova”. O teste real de roteamento já era parte de garantir funcionamento. Já o merge não deve ser tratado retroativamente como autorizado antes do pedido explícito de `01:57:51`; nem toda interação da sequência foi desnecessária.

A supervisão, na base inspecionada, guarda essencialmente `objective: turn.text` e recebe só as últimas cinco falas do proprietário na revisão. O objetivo pode virar “manda conferir” ou “continua”, enquanto o compromisso anterior permanece apenas no histórico truncado. Não há lista durável de critérios aceitos e evidências por critério (`shared/supervision.ts`; `Coordinator.dispatch/reviewReturn`; `Controller.delegate`).

**Melhoria:** conservar o objetivo consolidado, pedido de origem, alvo, limites, último briefing, critérios de conclusão e evidências já obtidas. “Continua”, “confere”, correção de detalhe e elogio não substituem o objetivo. Aceitar `complete` só quando os critérios do escopo estiverem satisfeitos; pendência operacional recuperável é continuação. Uma escolha nova do usuário continua sendo decisão.

### B2 — Orçamento repetidamente interrompeu o executor antes do fechamento

Nas 12 tarefas recentes relacionadas ao ciclo Gaia/Atelier: 7 estavam `failed`, 2 `interrupted`, 3 `completed`; as sete falhas contêm `error_max_budget_usd`, oito ocorrências nas mensagens dessas tarefas. Isso não atribui as duas interrupções ao orçamento nem permite concluir que nenhum efeito foi produzido.

`Controller.send` usa limite fixo de `0.75` por execução (`controller.ts:371`). O coordenador também usa limite `0.75` e três turnos (`coordinator.ts:64`). Os relatórios mostram trabalho produzido, mas prova/fechamento cortados pela rodada. Pedir “continua” ao proprietário não resolve o orçamento nem o checkpoint.

**Melhoria:** distinguir falha do trabalho de término da rodada por orçamento, preservar efeitos/evidências, adaptar a próxima etapa e reservar espaço para retorno. Qualquer alteração de política de custo deve ser explícita na configuração; não remover o limite silenciosamente. O mesmo retry sem progresso deve virar diagnóstico de capacidade/rota, com retomada interna quando viável.

### B3 — Mistura entre verificação desta rodada e estado total da entrega

`report:f0809b99-07a0-4d3a-b311-17bf60532e52`, `02:17:50.818Z`, abre com a entrega pronta, seguida de “Nada foi mexido — sem pull, push ou troca de conta”. O usuário pergunta em `d9452b89-1205-45aa-9fae-37801313f7ed`, `02:19:37.719Z`, se o trabalho não subiu.

O relatório precisava começar: “O trabalho já está no remoto; nesta rodada conferi o estado”. Deve identificar projeto/repositório, branch/PR/hash e separar “publicado anteriormente”, “conferido agora” e “pendente”. O hash `ad31a1f` mencionado depois não deve ser combinado com hashes da Gaia sem explicitar a qual repositório pertence. Esta auditoria não verificou essa identidade remotamente.

### B4 — Respostas simultâneas publicaram estado ultrapassado

O relatório final de publicação chegou às `02:34:59.243Z`. Nove segundos depois, a resposta ao elogio de personalidade afirmou que `plugin.json` ainda estava sendo alterado. O resultado e o planejamento seguem caminhos assíncronos e o plano foi construído com histórico anterior à chegada do resultado.

**Melhoria:** atualizar o estado antes de emitir afirmações operacionais, ou deixar o comentário de personalidade restrito à preferência. Status deve vir da tarefa vinculada, não ser repetido de uma fotografia antiga do histórico. Revisão/correção e liberação de relatório final são eventos distintos; a liberação dos textos longos deve respeitar a ordem escolhida pelo proprietário.

### B5 — O padrão reaparece nos chats externos

| Canal e evidência | O que aconteceu | Tratamento correto |
| --- | --- | --- |
| Growth, `coord:312a68ab-abae-4e89-b1ed-41c6b51f7e64`, `11/09 20:19:51Z` | Primeiro entregou PR no lugar do link utilizável; reconheceu o erro, mas ofereceu conferir a URL gerencial como nova opção | Critério de entrega deve incluir a URL do uso solicitado e checagem recuperável, com identificação explícita de PR/público/gerencial |
| Barretos, `coord:f90c4d03-4920-474c-b0c4-7782a7d7cbcb`, `11/09 20:08:28Z` | Informativo foi criado dentro do projeto; reconheceu que iria no upload seguinte e ofereceu ajuste de ignore | Artefato temporário pedido pelo usuário deve nascer fora do projeto; comparar destino e formato com o pedido antes de concluir |
| Station, `editor-report:a20c98c3-e218-4dd1-b852-e08be5a3ae77`, `11/09 20:17:02Z` | Descartou a premissa do token e perguntou o próximo caminho, embora a finalidade fosse restaurar/provar funcionamento | Prosseguir na verificação da finalidade já autorizada e explicar a premissa corrigida |
| Station, `editor-report:c337aa3e-cd10-4219-9099-b31a40cfca25`, `11/09 20:47:48Z` | Repetiu problema de segundo aval, mas também faltava número para disparo real de controle | Corrigir o transporte da autorização; pedir número é legítimo se não houver destino de teste autorizado no contexto. Não inventar destinatário |

Conversas externas: Growth `6fdecc30-8706-4259-a97c-e8e28fceacb7` / sessão `7820293f-a250-448c-b336-a2c7ee59bd70`; Barretos `6b294d09-ee32-4d67-8b13-16cdbb0ecb8d` / sessão `4cffec3a-aca4-4f85-9d63-d46f08e38003`; Station `5cf5291c-7314-42ff-b508-eaf82c4688f8` / sessão `d145f2f2-98e6-41f4-a9de-156027cce28d`.

## 3. Critérios de aceite para a correção estrutural

1. Um retorno incompleto em subagente ou sessão VS Code preserva objetivo e executor, determina correção específica e a encaminha dentro do escopo; avisa em uma ou duas frases o que faltou e o que foi enviado.
2. Correção automática não consome a autorização de leitura do relatório final. A tarefa termina, o card sinaliza resultado pronto e o proprietário escolhe quando liberar o texto longo na conversa de origem. Resultados simultâneos não se intercalam.
3. Uma decisão `needsOwner=false` não produz pergunta operacional nem promessa sem responsável. Registra uma próxima ação executável ou um bloqueio real com evidência e condição de retomada. Rotas incompatíveis não recebem reenviamentos idênticos.
4. “Pronto” exige os critérios da entrega inteira. Para atualização/publicação: fonte efetiva da versão, identidade do remoto, readback publicado e comportamento do consumidor. Conferência local, commit, push, merge e disponibilidade para uso são estados diferentes.
5. Comentários de personalidade não retomam comandos nem repetem status antigo. Afirmação de preferência salva precisa de recibo do armazenamento apropriado; histórico de chat não é recibo de aprendizado.
6. O contrato vale para plataformas com integração ativa. Overcore deve reutilizar esse ciclo quando houver transporte/retorno vinculados; o placeholder não pode receber despacho simulado.

## 4. O que este relatório encerra e o que permanece aberto

Esta auditoria identifica causas e registra evidências. Não executou reparos na Gaia, não resolveu os dois jobs `failure-learning`, não promoveu os 11 candidatos `ready`, não fechou as cinco releases pendentes e não ativou Overcore. Esses estados devem continuar visíveis como pendências específicas até haver execução e readback.

As alterações da interface, apresentação gradual de texto, autorização de leitura do resultado final e aprimoramento da supervisão foram implementadas na rodada principal, validada em 13/09/2026, 00:06 BRT:

- Build e verificação TypeScript passaram; 69 testes automatizados passaram. Os provedores nos testes são simulados: isso comprova o fluxo e suas invariantes, não a qualidade de todas as futuras decisões do modelo.
- O teste visual com Edge confirmou fila por origem, pré-autorização de entrega, cards ativos navegáveis, retorno retido, retomada após erro, rascunho preservado, streaming sem atraso artificial e fundo original a 5% de visibilidade.
- O teste do bundle confirmou indicador desde o envio até o despacho/confirmacão e editor disponível enquanto o executor continua.
- A supervisão agora conserva briefing executivo e evidências de etapas anteriores; a revisão considera o objetivo integral e veta encerramento com pendência necessária. Isso é melhoria do contrato e das instruções de revisão, não uma prova determinística de que o modelo nunca encerrará incorretamente.
- A fila de entrega serializa relatórios por conversa. Correções continuam automáticas e curtas; relatórios completos aguardam liberação ou preferência explícita. Interrupção/reinício não vira sucesso nem antecipa revisão; decisões e falhas ficam disponíveis sem serem rotuladas como concluídas.
- O contrato do corpo foi atualizado para conhecer essas ações. Feedback de personalidade não pode alegar gravação sem recibo; o caminho durável de captura/instalação do aprendizado permanece parte dos achados acima.
- O Omni Desktop foi reaberto com a build de 00:05:49, após conferir zero tarefas locais, planejamentos ou revisões externas ativos. Processo novo confirmado às 00:06:16; histórico preservado. Nenhum deploy, push ou execução nos projetos externos foi feito por esta implementação.

A existência da auditoria e essas correções do Desktop não contam como fechamento dos jobs e melhorias duráveis inventariados acima. Overcore permanece sem transporte ativo.

### Ajuste após feedback de interface — 13/09

O proprietário rejeitou a marcação **Entregar ao concluir** e definiu o card como único controle da devolutiva final. O painel de retornos foi retirado do compositor. **Receber retorno** fica no próprio card do agente/sessão; as preferências antigas de entrega automática são removidas na migração. A fila interna continua serializando os cliques por origem, e as correções operacionais permanecem automáticas com avisos curtos.

Referência histórica: [auditoria de 08/09](../auditorias/2026-09-08-queixas-personalidade-autonomia.md) já apontava perda de responsabilidade/identidade do trabalho e registros sem execução. Foram rechecados os estados atuais acima; as contagens antigas não foram reutilizadas como fatos de hoje.
