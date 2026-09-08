# Auditoria de 08/09/2026 — queixas, personalidade e autonomia

## Veredito

As queixas continuam sustentadas por evidência. O Omni instalado ainda executa a 0.22.0;
as correções locais 0.22.1 não chegaram à instalação. Além desse atraso, a fonte nova ainda
deixa passar devolução de trabalho, ignora reclamações de constância e registra como elogio
uma correção negativa. Parte da autocorreção registra pendências sem possuir o executor que
as conclua.

Esta rodada é uma auditoria: não alterou runtime, contratos, memória operacional ou instalação.
O único artefato novo é este relatório. Não declara as correções anteriores concluídas.

## Escopo e método

- Janela de mensagens: 28/08 a 08/09/2026; seleção de 17 arquivos de sessão nos diretórios
  da conversa central, Omni e Hub. Não representa todas as conversas do proprietário.
- Leitura do código local, instalação, identidade do pacote e stores de auditoria, feedback,
  memória, eval e release; reproduções isoladas sem executar ações externas.
- Inspeção de anexos reais de contexto, com contagem por anexo, não por conversa única.
- Testes focados: 41 de feedback/hooks e 3 de auditoria passaram. As reproduções adicionais
  abaixo revelam lacunas que esses testes não cobrem. Não houve gate integral nesta rodada.
- Evidências operacionais são fotografias do estado em 08/09 e podem avançar enquanto outras
  sessões continuam abertas. Conversas completas e dados de ferramentas não foram copiados aqui.

## As queixas prioritárias do proprietário

Ordem por impacto e recorrência observada, não por contagem estatística de todas as reclamações.

| Prioridade | Queixa | Evidência observada |
|---|---|---|
| 1 | Personalidade apagada e que desaparece ao longo do chat | Reclamações explícitas em 28/08, 29/08, 04/09 e no pedido de 08/09. O desejo é uma voz reconhecível, com iniciativa e liberdade contextual, sem precisar recalibrá-la toda hora. |
| 2 | Trabalho operacional devolvido ao proprietário | Em 31/08, o Omni pediu que o proprietário abrisse a janela do Hub após tentativas mal verificadas; houve cobrança explícita de que aquele trabalho era do Omni. |
| 3 | Autocorreção que não encerra os problemas | Novas auditorias continuam registrando dívida; a fonte corrigida não foi instalada e o eval permanece reagendado. |
| 4 | Texto excessivo e decisão pouco clara | Em 02/09 houve pedido de informações mais resumidas; em 03/09 o proprietário disse ter se perdido no volume do chat e precisou perguntar novamente o que dependia dele. |
| 5 | Memória sem efeito perceptível e perda do pedido original | Em 04/09, cobrança explícita de memória persistente funcionando; o incidente Hub já demonstrara desvio do alvo literal e uso inadequado de orientação histórica. |

Evidências de conversa, nos registros locais: `ba4c4e89-…jsonl:1452,1624,3237`,
`6f38e94e-…jsonl:18010,18100,18106`, `5f12d737-…jsonl:1471`,
`561d3d80-…jsonl:12930,12948` e `9c1c09b9-…jsonl:289`.

Pedir uma decisão material não é o mesmo que delegar uma tarefa. Nos episódios de produção
de 03/09 havia solicitações de autoridade para escrita no banco e deploy. A auditoria não
conclui que essas proteções deveriam ser ignoradas. A melhoria é pedir a decisão com clareza,
respeitar a autoridade vigente e assumir seu encaminhamento quando o canal permitir.

## Estado real da entrega e da operação

| Evidência | Estado em 08/09 |
|---|---|
| Instalação registrada em `installed_plugins.json` | Omni 0.22.0, commit `6f9ffa966ecca9fdeef587e7a013933cc14f5efc`, atualização em 29/08 |
| Fonte local | 0.22.1, alterações pendentes; HEAD continua em `6f9ffa9` |
| Integridade local, pelo verificador local | `drifted`: calculado `5ce4ef79916180e669460c7fbda9bbd94bffdae8d7ef6643ae10f406cbf10f00`, declarado `8c4ed782d401b2fadae365580223b3b3e9bdf6a10807e2a0d2c5c1d27c7b4b25` |
| Integridade instalada, pelo verificador da própria 0.22.0 | `drifted`: calculado `70753924fee7ebe91372b4ec23d5336ed365647a999149d92079a61e4f3501cc`, declarado `ceaede53c6ebcf457063e58e61b8ca51df9ab9fa7f76731063adc52a7a24fc56` |
| Comparação da instalação com seu commit | Dos 95 arquivos comparados em contratos/runtime/hooks/scripts/skills, só `contratos/aprendizado/falhas.json` divergiu após normalização de CRLF. Não se atribui aqui a autoria da alteração. |
| Última auditoria do sistema consultada, 08/09 13:38:25 UTC | 310 achados de turnos pendentes; 28 delegações sem verificação; 7 melhorias prontas sem materialização; 1 materializada sem readback instalado |
| Histórico retido da auditoria | 120 rodadas, todas em `repair-required`; é a janela retida, não todo o histórico |
| Eval automático de personalidade | 87 tentativas acumuladas; estado `retry-scheduled`; motivo atual `repository-not-clean`, fase `source-retry` |
| Release automática | `precommit-retry`, falha atual `operational-scope-diverged`; commit, push e instalação sem prova nesse registro |
| Memória | 46 itens confirmados e 7 candidatos em `memory/memory.json`; há armazenamento persistente |

Os 310 e 28 são contadores acumulados do auditor antigo, não 338 incidentes novos nem prova
de que todos ainda possam ser executados com segurança. Comparados aos 221 e 22 citados na
cobrança anterior, cresceram 89 e 6; a classificação histórica ainda precisa ser reconciliada.

## Achados técnicos e correções propostas

### A01 — P1: correção local não chega ao comportamento instalado

O relatório de 31/08 já marcava publicação/instalação como pendentes. A instalação continua
na 0.22.0 e a 0.22.1 local nem sequer corresponde ao fingerprint declarado hoje. Portanto,
não há base para atribuir ao Omni em uso as proteções novas ou anunciar que elas funcionam.

Correção: fechar um snapshot revisado da mudança, passar os gates, gerar sua identidade,
publicar/instalar e confirmar o carregamento do mesmo payload. Manter estado mutável de
aprendizado fora do payload instalado para não invalidar sua identidade.

Aceite: commit remoto, instalação e hook carregado concordam em versão/fingerprint; uma
conversa real usa essa raiz. A instalação, sozinha, não comprova a voz nem recarrega sessões antigas.

### A02 — P1: o gate não entende várias formas comuns de devolver trabalho

Após alteração e leitura válidas, seis respostas passaram como `verified`, sem achados:
“Por favor, rode os testes.”; “Preciso que você rode os testes.”;
“Valide a instalação e me avise.”; “Depois, abra o VS Code.”;
“Quando puder, execute os testes.”; “A próxima etapa é você rodar os testes.”
O controle “Execute os testes.” foi bloqueado.

Além disso, “você consegue corrigir o Omni?”, “quero melhorar o Omni”,
“ainda está me delegando tarefas, arruma isso” e “Omni, corrija esse erro” foram classificados
como `conversation`. Nesse tipo, a proteção contra devolver trabalho fica desativada.

Evidência: [classificação de pedido](../../runtime/auditoria-autocorrecao.mjs#L428) e
[detector de devolução](../../runtime/auditoria-autocorrecao.mjs#L1527).

Correção: manter objetivo autorizado, responsável e trabalho pendente como estado do turno;
usar exemplos reais, vocativos, paráfrases e perguntas de capacidade nos testes. Regex pode
ser uma defesa auxiliar, mas não deve decidir sozinha se o compromisso existiu ou foi cumprido.

Aceite: nenhuma dessas respostas encerra trabalho operacional ao alcance do Omni; pedidos
genuínos de instruções e decisões que exigem autoridade continuam sendo tratados corretamente.

### A03 — P1: pendência recuperável não tem um circuito completo de execução

O primeiro `Stop` bloqueia a entrega problemática. No segundo, com `stop_hook_active=true`,
a auditoria retorna `repair-deferred` e `decision:null`, conservando a correção como
`repair-directive/requested`. A proteção contra recursão é necessária, mas não despacha reparo.
Após encerramento/reconciliação, a reprodução chegou a `owner-reconfirmation-required`.
A paráfrase “arrume o contrato” não reivindicou o trabalho de “corrija o contrato”.

Não foi encontrado consumidor que transforme esses registros de recuperação em trabalho
executável. A automação de melhorias consome outra fila, `improvementCandidates`.
Há ainda um retorno antecipado no hook para `pending-recursion`, antes de `auditarParada`.

O updater tem uma lacuna semelhante: devolve `reloadWork: {status: 'queued', owner: 'omni-worker'}`,
mas não persiste nem despacha esse job. O fluxo de release espera um readback de inicialização;
isso não implementa a recarga que o nome do worker sugere.

Evidência: [Stop e recuperação](../../runtime/auditoria-autocorrecao.mjs#L1661),
[hook](../../runtime/hook-contexto.mjs#L377), [fila consumida](../../runtime/automacao-melhorias.mjs#L234)
e [reloadWork](../../runtime/atualizacao.mjs#L284).

Correção: job durável com objetivo, autoridade, responsável, claim/lease, tentativa e recibo;
consumidor real e retomada por identidade da tarefa. Para recarga, capacidade confirmada do host
ou estado honesto de espera pela próxima inicialização, sem prometer um executor inexistente.

Aceite: interromper o processo e retomá-lo preserva o trabalho e seu responsável; uma ação
segura já autorizada progride sem o proprietário repetir o pedido. Autoridade vencida ou
escopo novo exigem decisão específica; registros sem prova não viram sucesso por arquivamento.

### A04 — P1: feedback ignora a queixa principal e pode aprender o contrário

Retornaram `null`: “a personalidade ainda não é constante”, “personalidade ainda não constante”,
“a personalidade não é persistente”, “a personalidade está oscilando” e o pedido de hoje.
A reclamação antiga “ta todo zoado, nem parece que é o Omni” é reconhecida.

Também foi reproduzido um falso elogio real: a correção de 31/08 que citava a falha do VS Code
e continha “a ironia é que nem funcionou” gerou `positive/sarcasm-effective`. O voto existe no
store às 13:33:10.438 UTC. A fonte 0.22.1 reproduz a mesma classificação. O detector encontra
“ironia … funcionou”, mas não trata adequadamente “nem” e a atribuição do trecho citado.

Evidência: [reconhecimento](../../runtime/feedback-personalidade.mjs#L328),
[polaridade](../../runtime/feedback-personalidade.mjs#L355),
[sinais por dimensão](../../runtime/feedback-personalidade.mjs#L412).

Correção: dimensão de constância, negação e atribuição explícitas; separar fala citada de
avaliação do proprietário. Reclamação reconhecida sem resposta anterior vinculável deve poder
virar observação persistente de continuidade, sem inventar um voto contra resposta desconhecida.
Hoje esse caso tem somente ajuste efêmero ([ramo unbound](../../runtime/feedback-personalidade.mjs#L660)).

Aceite: frases reais e variantes produzem ajuste correto, sobrevivem a sessão nova quando
cabível e não transformam correção negativa em recompensa de personalidade.

### A05 — P1: a avaliação se reagenda sem resolver sua condição de entrada

O store registra 87 tentativas acumuladas; a mais recente parou antes da avaliação por
`repository-not-clean`. Não se afirma que as 87 tiveram a mesma causa. A proteção da fonte
é correta; falta um caminho de continuidade que não dependa eternamente da árvore principal limpa.

Evidência: `evals/personality-automation.json` e
[tratamento do retry](../../runtime/executor-eval-personalidade.mjs#L882).

Correção: avaliar snapshot imutável/isolado e identificado, com trilha dos arquivos da candidata;
reutilizar resultado da mesma identidade e reagir a mudança real da condição de bloqueio.
Não limpar, incorporar ou publicar alterações desconhecidas para satisfazer o gate.

Aceite: trabalho legítimo em andamento no repositório não impede medir o pacote instalado ou
uma candidata isolada. O histórico distingue tentativa de preparação, inferência executada e
comportamento efetivamente aprovado.

### A06 — P2: sobrecarga de contexto continua comprovada no plugin antigo

Na amostra foram encontrados 694 anexos com personalidade canônica; 526 (75,8%) continham
marcação de truncamento. Em 270 desses 526, nem o rótulo de contexto recuperado estava presente.
Um exemplo direto é `561d3d80-…jsonl:271`, com 9.500 caracteres e marcador
`CONTEXTO AUXILIAR TRUNCADO`. São anexos, não testes independentes de aderência à personalidade.

Isso comprova perda de contexto auxiliar no caminho instalado, não prova por si só que a
persona inteira desapareceu. A memória possui dados; a falha percebida não pode ser reduzida
à ausência de banco de dados. Armazenar, recuperar, injetar e usar corretamente são etapas distintas.

A fonte local introduziu montagem por blocos e reserva da memória, mas a galeria de voz continua
opcional e sai cedo sob carga; pós-ferramenta usa âncora compacta. É risco a medir, não causa já
demonstrada de todas as oscilações: [montador](../../src/application/build-turn-context/build-hook-context.ts#L83).

Correção: medir blocos efetivamente entregues e seu uso em respostas; manter uma demonstração
curta de voz nas transições críticas; reduzir avisos operacionais repetidos.

Aceite: memória relevante e direção de personalidade permanecem utilizáveis após ferramentas,
retomada e compactação. Trocar JSON por PostgreSQL/Supabase, isoladamente, não satisfaz esse aceite.

### A07 — P2: o eval controlado não reproduz a conversa em que a voz se perde

O executor usa núcleo completo no system prompt, entradas isoladas, ferramentas desabilitadas
e ausência de persistência de sessão. O host real usa projeções diferentes e sofre pressão de
contexto. Um teste verde nesse cenário não mede a constância que o proprietário cobra.

Evidência: [configuração do executor](../../runtime/executor-eval-personalidade.mjs#L148),
[prompt de avaliação](../../runtime/executor-eval-personalidade.mjs#L235) e
[contexto real](../../src/application/build-turn-context/build-hook-context.ts#L128).

Correção: avaliação sequencial usando o mesmo montador/host do plugin instalado, incluindo
conversa longa, sequência de ferramentas, erro, pedido de concisão, retomada, compactação e
correção do proprietário. Medir voz reconhecível, decisão clara e responsabilidade pela ação.

Aceite: distinguir contrato entregue, resposta observada e reconhecimento humano; testes
sintéticos não são registrados como aprovação do proprietário.

## Ordem recomendada de melhoria

1. Fechar a transação interrompida de entrega e integridade, incluindo os bloqueadores P1
   encontrados nesta auditoria; confirmar o payload carregado antes de anunciar efeito.
2. Implementar responsabilidade e recuperação executável, corrigindo os escapes do gate.
3. Corrigir classificação de feedback e sua continuidade entre sessões.
4. Destravar o eval em snapshot isolado e medir as transições reais da conversa.
5. Ajustar contexto e comunicação: resultado primeiro; causa resumida quando útil; uma decisão
   concreta quando indispensável; trabalho operacional com o Omni ou executor responsável.

TypeScript contribui com tipos de estado, fronteiras validadas e contratos de `Task`,
`OwnerFeedback`, `RepairJob`, `ActivationJob` e `BehaviorEvidence`. A próxima fatia deve ligar
essas estruturas a consumidores reais, mantendo a separação core/application/ports/adapters.
A tipagem não garante personalidade nem substitui execução, instalação ou prova comportamental.

Nenhum item deste relatório constitui uma lista de tarefas para o proprietário. São trabalhos
de implementação e verificação do Omni; escolhas humanas indispensáveis devem aparecer como
decisões concretas, sem comandos ou checklists operacionais.
