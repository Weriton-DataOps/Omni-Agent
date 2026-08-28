# Auditoria do Omni — 28/08/2026

Esta rodada transforma as falhas observadas nas conversas reais em circuitos executáveis. Ela não
promove antecipadamente a personalidade e não confunde diagnóstico, correção, teste e observação em
uso.

## Autoavaliação confrontada

| ID | Verificação | Resultado |
|---|---|---|
| AUD-73 | personalidade é reinjetada em cada turno | confirmado |
| AUD-74 | injeção garante aderência | falso; depende de conversa real |
| AUD-75 | suíte sintética prova personalidade persistente | falso; serve como regressão |
| AUD-76 | correções do proprietário fechavam o ciclo | falha confirmada |
| AUD-77 | faixa vermelha do guardião era bloqueio integral | descrição imprecisa; parte negava formato e parte apenas se abstinha; fonte v2 pronta, ativação pendente |
| AUD-78 | release instalada podia ser identificada sem ambiguidade | lacuna confirmada; fingerprint acrescentado |

## Auditoria e autocorreção

| ID | Verificação | Resultado |
|---|---|---|
| AUD-79 | pedido executável sem ação é detectado | coberto |
| AUD-80 | mutação sem leitura posterior é detectada | coberto |
| AUD-81 | falha de ferramenta sem nova estratégia é detectada | coberto |
| AUD-82 | repetição da mesma estratégia falha é interrompida | coberto |
| AUD-83 | conclusão sem evidência é recusada | coberto |
| AUD-84 | correção acontece no mesmo turno sem loop infinito | um bloqueio máximo, coberto |
| AUD-85 | ledger preserva conversa, entrada e saída brutas | não persiste; coberto |
| AUD-86 | ordens naturais com prefixos como “já”, “então” e “leve isso em consideração” | coberto |

## Delegação e autoridade

| ID | Verificação | Resultado |
|---|---|---|
| AUD-87 | prompt precisa ficar visível no destino | contrato e FSM cobertos |
| AUD-88 | `SubagentStop` equivale a sucesso | falso; agora produz `reported` |
| AUD-89 | relato pode fechar trabalho sem leitura independente | recusado |
| AUD-90 | `closed` sozinho prova sucesso | falso; exige resultado `verified` |
| AUD-91 | executor não rastreado pode parecer execução normal | falso; aparece como falha de governança |
| AUD-92 | legado recebe prova retroativa | recusado; permanece `legacy-unverified` |
| AUD-93 | autoridade acompanha a delegação | envelope por intenção, escopo, efeitos e risco |
| AUD-94 | risco gera proibição genérica | substituído por preparo, checkpoint, rollback e verificação dentro do escopo |
| AUD-95 | expansão material pode ser presumida | recusada; exige nova decisão |

## Aprendizado conectado

| ID | Verificação | Resultado |
|---|---|---|
| AUD-96 | correção de autoria incerta vira aprendizado | recusada |
| AUD-97 | mesma falha cria vários trabalhos ativos | corrigido por geração e coalescência |
| AUD-98 | job obsoleto continua executável | supersedido |
| AUD-99 | falha do próprio executor volta à fila infinitamente | excluída |
| AUD-100 | dois testes reutilizam a mesma evidência | recusado; IDs independentes |
| AUD-101 | todo aprendizado vira skill | corrigido; destino segue a natureza |
| AUD-102 | correção de runtime vira skill fictícia | removida e retraída |
| AUD-103 | regras semânticas duplicadas chegam ao contexto | deduplicadas |
| AUD-104 | varredura reprocessa o corpus inteiro | corrigida por cursor incremental e backup |

## Evals, integridade e auditoria sistêmica

| ID | Verificação | Resultado |
|---|---|---|
| AUD-105 | conversa de scratchpad vale como comportamento real | recusada |
| AUD-106 | uma sessão prova memória entre sessões | recusada |
| AUD-107 | gate real exige conversa, correção, ferramenta, delegação e revisão humana | implementado |
| AUD-108 | eval real armazena conversa | não; somente fingerprints, métricas e proveniência |
| AUD-109 | mesma versão com payload diferente passa despercebida | corrigido pelo contrato canônico de versão + fingerprint da release |
| AUD-110 | auditoria sistêmica duplica fotografias iguais | corrigido por fingerprint de estado |
| AUD-111 | auditorias concorrentes corrompem o histórico | protegido por lock e escrita atômica |
| AUD-112 | fila duplicada pode ser reparada automaticamente | reparo local idempotente coberto |
| AUD-113 | ausência de eval real fica invisível | agora vira achado explícito |
| AUD-114 | métricas de crescimento existem | correção, recorrência, evidência, delegação, personalidade e efeito do aprendizado |

## Fechamento das conexões descobertas na revisão

| ID | Verificação | Resultado |
|---|---|---|
| AUD-115 | autoavaliação do Omni pode aprovar a si mesma | recusado; origem `self-report` e estado `unverified-claim` |
| AUD-116 | rodada de personalidade é acionável pelo operador | conectada ao CLI, PowerShell, estado e auditoria sistêmica |
| AUD-117 | varredura assíncrona pode bloquear personalidade/contexto | corrigido por spool e lock exclusivos da cobertura ao vivo |
| AUD-118 | prompt de subagente pode parecer fala do proprietário | recusado por caminho, sidechain e identidade de agente |
| AUD-119 | comando indireto de escrita passa como execução comum | corrigido; mutação exige efeito compatível e readback vinculado |
| AUD-120 | dois testes de falha podem ser autodeclarados | corrigido; evidência precisa vir de ação de verificação observada |
| AUD-121 | `hook`, `routing` ou `runtime-fix` viram regra textual ativa | recusado; ficam `implementation-required` até patch e gates |
| AUD-122 | materializações concorrentes perdem artefatos | corrigido com lock do repositório e escrita atômica |
| AUD-123 | autoridade herdada existia só no contrato | conectada ao comando público, prompt visível e FSM |
| AUD-124 | UUID JSONL e `reviewer: owner` bastam como prova | recusado; raiz/sessão são validadas e recibos confiáveis continuam obrigatórios |
| AUD-125 | trigger `before-release` não executava auditoria | conectado ao `prepack` e ao comando `release:gate` |
| AUD-126 | janela longa de transições apaga marcos da delegação | validação passa a usar fingerprints canônicos, não presença na janela |
| AUD-127 | melhoria materializada conta como efeito antes da instalação | corrigido; só conta após readback do artefato instalado |
| AUD-128 | `StopFailure` escapava do gate por turno | corrigido; usa a mesma auditoria antes de encerrar |
| AUD-129 | `parentFingerprint` arbitrário fingia autoridade herdada | corrigido; precisa resolver envelope herdável existente no ciclo |
| AUD-130 | `owner-intent` público aceitava qualquer identificador de sessão | corrigido; exige turno ativo registrado pelo hook e guarda somente seu fingerprint |
| AUD-131 | texto livre diferente do relato promovia delegação a `verified` | corrigido; exige ação e `state-readback` reais da auditoria, posteriores e do mesmo objeto |
| AUD-132 | `rawPromptPersisted: false` ocultava que o prompt sai em `dispatch` | renomeado para `rawPromptPersistedInOmniState`; persistência local e transporte ficaram distintos |
| AUD-133 | `dispatch-requested` prova que o subagente começou | falso; o runtime entrega o briefing e o host precisa iniciar o executor |
| AUD-134 | `varredura-dia` executa gates, commit e push | falso; termina no scan, deduplicação e aprendizado local; o restante é orquestração do host com evidência |
| AUD-135 | `atualizar` produz e publica uma release | falso; instala a release já publicada, valida integridade e executa readback |
| AUD-136 | eval real pode produzir aprovação confiável hoje | falso; sem raiz interna e identidade externa, toda rodada permanece `unverified-*` |
| AUD-137 | guardião v2 está ativo porque fonte e testes existem | falso; não há `PreToolUse` no plugin e a ativação segue pendente de autorização |
| AUD-138 | FSM de delegação prova execução ponta a ponta | falso; prova transições e invariantes, não o início pelo host nem a interface real |
| AUD-139 | toda memória aceita nasce candidata | corrigido no contrato; declaração explícita estável pode ser confirmada automaticamente |
| AUD-140 | todo destino de melhoria pode ser materializado como texto | falso; declarativos materializam, mudança de código fica `implementation-required` |
| AUD-141 | `before-release` intercepta qualquer commit ou push | falso; está ligado somente ao `prepack` e ao comando manual `release:gate` |
| AUD-142 | reiniciar ativa o guardião v2 por si só | falso; restart apenas recarrega o pacote instalado, e o manifesto ainda não contém `PreToolUse` |
| AUD-143 | teste de uma falha pode validar outra hipótese ou geração | corrigido; cada evidência carrega binding SHA-256 do job, padrão, geração e hipótese |
| AUD-144 | evidência legada ou bypass de teste pode promover falha/atalho | corrigido; legado sem binding é rebaixado e os bypasses de produção foram removidos |
| AUD-145 | melhoria pronta ou arquivo materializado já conta como aprendizado efetivo | falso; o ciclo é monotônico e somente `installed-verified` produz efeito |
| AUD-146 | arquivo preexistente prova que uma correção de código foi implementada | falso; exige mutação auditada e readback posterior do mesmo artefato |
| AUD-147 | a varredura pode ocultar candidata sem materialização | corrigido; relata `unconfigured`, `implementation-required` ou `materialized-pending-release` |
| AUD-148 | pedido conversacional como “faça uma analogia” exige ferramenta | corrigido; conversa e operação foram separadas, preservando auditoria para build, código e inspeção |
| AUD-149 | versão listada pelo host basta para confirmar atualização | falso; exige raiz instalada, versão, payload e fingerprint íntegros relidos da instalação |
| AUD-150 | nome parecido com executável seguro, `rg -f` externo ou passe de objetivo antigo pode receber auto-allow | corrigido na fonte e nos testes; guardião continua inativo |
| AUD-151 | comparação de versão simples ordena corretamente prerelease e metadata | corrigido conforme precedência SemVer; metadata não altera a ordem |
| AUD-152 | ação irrelevante no mesmo turno pode satisfazer o pedido atual | corrigido; exige família de ação compatível e vínculo com alvo ou fingerprint do pedido |
| AUD-153 | `dispatch-requested` pode anteceder o preparo da delegação | corrigido; o ciclo chega a `prepared` e `visible` antes de solicitar o início ao host |
| AUD-154 | simples menção ou elogio à personalidade pode virar falha aprendida | corrigido; o sensor exige feedback negativo inequívoco do proprietário |
| AUD-155 | marcador correto em teste irrelevante valida falha ou atalho | corrigido; marcador é só correlação e precisa coincidir também com a família de verificação esperada |
| AUD-156 | gate de release pode validar uma casa artificial e esconder o estado real | recusado; o gate foi executado contra `%APPDATA%\omni`, sem erros e sem conversa bruta |
| AUD-157 | suíte verde basta sem conferir o pacote do plugin | falso; `npm pack --dry-run` e `claude plugin validate .` foram executados com sucesso |
| AUD-158 | skill retraída deve continuar eternamente como materializada sem readback | corrigido na `0.20.1`; a release instalada reconcilia o registro como `retracted`, preserva a prova e não fabrica instalação da skill |
| AUD-159 | entrada antiga incorporada por uma regra canônica deve continuar pendente | corrigido na `0.20.1`; substituição explícita e relida na release encerra a antiga como `superseded`, sem contá-la como efeito |
| AUD-160 | registro de retração e arquivos substitutos bastam mesmo se a skill continuar ativa | recusado; a reconciliação exige ausência real da skill e da entrada no catálogo instalado |
| AUD-161 | prova `superseded` inválida pode ser rebaixada e apagada numa leitura | corrigido; somente formato legado migra, enquanto estado v2 inválido falha fechado sem sobrescrever o arquivo |

## Estado de fechamento

- gates determinísticos: `check`, 279/279 testes, `npm pack --dry-run` e `claude plugin validate .` verdes com o fingerprint final;
- publicação e instalação: a `0.20.0` foi confirmada no `origin/main` e relida da instalação; a correção `0.20.1` só será considerada concluída pela mesma confirmação externa e pelo novo readback;
- guardião v2: fonte canônica e testes prontos; troca do hook global não executada sem aprovação
  explícita da mudança de autorização;
- comportamento real: deliberadamente pendente de conversa do proprietário;
- promoção da personalidade: pendente; a autoavaliação é evidência diagnóstica, não aprovação.

O gate real ficou em `observing`, sem erros. Permaneceram como avisos — e não foram apagados para
embelezar a release — o DoD comportamental ausente, a confiança externa da personalidade pendente,
seis delegações históricas sem verificação e melhorias prontas ainda não materializadas. Os dois
avisos falsos de readback histórico foram separados e corrigidos na `0.20.1`. Os demais itens
seguem para a observação de uso; não invalidam os circuitos determinísticos desta versão.

O protocolo comparável continua em
[`ciclo-auditoria-7-dias.md`](ciclo-auditoria-7-dias.md). O roteiro humano continua em
[`definition-of-done-2026-08-27.md`](definition-of-done-2026-08-27.md).
