# Auditorias do Omni — 26/08/2026

Data civil: 26/08/2026, fuso `America/Sao_Paulo`. Este é o inventário canônico das auditorias
realizadas no primeiro dia do ciclo de observação. Horários gravados como 27/08 em alguns stores
estão em UTC e ainda pertencem ao dia 26 no fuso local.

## Veredito do dia

O núcleo determinístico está saudável e as conexões funcionam no plugin instalado. O smoke isolado
provou injeção de contexto, sessão, delegação, prompt visível, evidência, conclusão e aprendizado de
atalho no mesmo ciclo. A principal lacuna encontrada foi operacional: a sessão real permaneceu aberta
enquanto várias versões foram instaladas e, por isso, seus hooks antigos não registraram atividades
novas. Essa sessão não é evidência válida da versão atual até executar **Restart** em `/plugin`.

Não estão aprovados ainda: consistência da personalidade em conversas longas, delegação completa na
interface real após recarga e qualidade dos evals produzidos por observação de respostas.

## Auditorias de repositório, pacote e instalação

| ID | Auditoria | Resultado | Evidência |
|---|---|---|---|
| AUD-01 | identidade do repositório e branch | passou | `main`, origem canônica configurada |
| AUD-02 | árvore limpa e sincronização local/remota | passou na conferência final do bloco | `git status`, HEAD local e remoto |
| AUD-03 | fronteiras do Omni contra outras iniciativas | passou | ADR-001 e contratos sem ativar integrações externas |
| AUD-04 | contaminação do plugin por estruturas antigas | passou | manifesto, pacote e árvore pública inspecionados |
| AUD-05 | manifesto do plugin | passou | nome, versão, repositório e campos obrigatórios válidos |
| AUD-06 | schemas e JSONs do pacote | passou | parsing e gates do pacote |
| AUD-07 | sintaxe do runtime | passou repetidamente durante o dia | `npm run check` |
| AUD-08 | suíte automatizada completa | passou repetidamente durante o dia | `npm test`; resultado final registrado na seção de fechamento |
| AUD-09 | instalação e cache do plugin | passou | versão instalada comparada à fonte |
| AUD-10 | detecção de versão desatualizada | passou | estado `current` na versão 0.19.0 antes do fechamento |
| AUD-11 | atualização com saída mínima | passou | somente anterior, instalada, mudanças e recarga quando aplicável |
| AUD-12 | mecanismo correto de recarga | passou no contrato; pendente na sessão real | VS Code usa `/plugin` → **Restart** |

## Auditorias de identidade, conversa e contexto

| ID | Auditoria | Resultado | Evidência |
|---|---|---|---|
| AUD-13 | personalidade-base v1 canônica | passou estruturalmente | manifesto, núcleo e contrato ativos |
| AUD-14 | injeção da personalidade por turno | passou em teste e smoke | contexto retornado pelo hook |
| AUD-15 | intensidade de humor, sarcasmo e analogias | implementada; validação humana pendente | contrato 0.17.0 e conversas observadas |
| AUD-16 | personalidade em respostas reais | parcial | ainda houve respostas frias e genéricas |
| AUD-17 | classificação de intenção | passou automaticamente | testes do pipeline de memória/contexto |
| AUD-18 | recuperação híbrida e ranking | passou automaticamente | testes de recuperação |
| AUD-19 | projeções `fast` e `deep` | passou automaticamente | testes de contexto |
| AUD-20 | orçamento de contexto | passou automaticamente | corte e seleção cobertos por teste |
| AUD-21 | seleção de capacidade e roteamento | passou automaticamente | suíte de contexto e contrato core |
| AUD-22 | continuidade cognitiva entre turnos | passou estruturalmente; uso prolongado pendente | contexto vivo e memória recuperada |
| AUD-23 | limites do papel do Omni | passou | especialista temporário por delegação, iniciativas independentes |

## Auditorias de memória e persistência

| ID | Auditoria | Resultado | Evidência |
|---|---|---|---|
| AUD-24 | escrita atômica e schema da memória | passou | testes de memória e migração |
| AUD-25 | filtro de segredos | passou | entradas sensíveis recusadas nos testes |
| AUD-26 | ausência de conversa bruta nos stores | passou | flags `rawConversationStored: false` e inspeção dos formatos |
| AUD-27 | múltiplos aprendizados na mesma mensagem | passou | pipeline processa unidades separadas |
| AUD-28 | confirmação de declaração estável | passou | memória confirmada sem pergunta cerimonial |
| AUD-29 | manutenção, arquivo e esquecimento | passou automaticamente | testes de manutenção e itens arquivados |
| AUD-30 | persistência estruturada | passou automaticamente | checkpoint recusa conversa e exige definição completa |
| AUD-31 | migração do contexto estruturado | passou | backup v1→v2 e testes de migração |
| AUD-32 | backlog e resolução de descobertas | passou | duas descobertas resolvidas, backlog aberto igual a zero |
| AUD-33 | checkpoint em atividade real | lacuna encontrada | zero checkpoints antes desta rodada de fechamento |

## Auditorias dos sensores e do ciclo operacional

| ID | Auditoria | Resultado | Evidência |
|---|---|---|---|
| AUD-34 | cobertura dos hooks | passou automaticamente | mensagem, ferramenta, falha, subagente, tarefa, resposta e sessão |
| AUD-35 | captura de eventos ao vivo | passou | 240 eventos no estado local antes do fechamento |
| AUD-36 | sessão operacional | passou | uma sessão ativada e estado vivo persistido |
| AUD-37 | contrato de delegação | passou automaticamente | estados preparado, visível, executando, concluído/bloqueado e fechado |
| AUD-38 | conexão instalada ponta a ponta | passou em smoke isolado | contexto, 1 sessão, 1 delegação concluída, visibilidade e evidência |
| AUD-39 | delegação na sessão real | inconclusiva | zero delegações porque a sessão não recarregou hooks novos |
| AUD-40 | rastreio de ferramentas/subagentes já usados | lacuna explicada | atividades existiam no transcript, mas a versão antiga não as observou |
| AUD-41 | detecção de sessão com plugin antigo | passou no diagnóstico | versão instalada mudou durante a vida da sessão |

## Quatro varreduras diárias executadas

| ID | Execução | Encontradas | Processadas | Já conhecidas | Resultado |
|---|---|---:|---:|---:|---|
| AUD-42 | `daily-scan-858586da…` | 159 | 151 | 8 | recuperou 183 lacunas; criou 19 padrões, 7 atalhos e 6 melhorias |
| AUD-43 | `daily-scan-aece2ef1…` | 159 | 0 | 159 | provou deduplicação e idempotência |
| AUD-44 | `daily-scan-7e3f71e1…` | 163 | 4 | 159 | recuperou 3 lacunas; nenhuma duplicação nos totais |
| AUD-45 | `daily-scan-60e211d5…` | 165 | 2 | 163 | zero lacunas e zero alterações indevidas |

As quatro rodadas analisaram somente sessões ativadas pelo Omni. O store reteve fingerprints e
contagens, sem copiar a conversa ou resultados brutos.

## Auditorias de falhas, atalhos e autoaperfeiçoamento

| ID | Auditoria | Resultado | Evidência |
|---|---|---|---|
| AUD-46 | extração de falhas da atividade diária | passou | 19 padrões distintos no estado local |
| AUD-47 | separação de assinaturas genéricas | passou após correção | Bash/PowerShell deixaram de fundir comandos heterogêneos |
| AUD-48 | ciclo completo de falha de personalidade | passou | 4 ocorrências, causa analisada, 2/2 testes e eval aprovado |
| AUD-49 | automação de validação de candidatas | passou estruturalmente | trabalho em segundo plano, sem nova autorização para teste seguro |
| AUD-50 | fila automática de falhas | parcial | 1 trabalho concluído e 5 bloqueados com causa identificada |
| AUD-51 | bloqueios por permissão | correto | SendMessage/Bash exigiam permissão real, não bypass |
| AUD-52 | bloqueios por assinatura genérica antiga | diagnosticado | grupos heterogêneos não poderiam gerar correção única segura |
| AUD-53 | bloqueio de worktree órfã | diagnosticado | destino indisponível exige relink ou recriação fora desta rodada |
| AUD-54 | coleta de atalhos do dia | passou | sete registros iniciais extraídos da atividade |
| AUD-55 | identidade das famílias de atalhos | passou após correção | duplicatas de delegação consolidadas com backup |
| AUD-56 | efeito após primeiro sucesso | passou | dois atalhos ativos e um validado |
| AUD-57 | validação após três sucessos | passou no contrato e testes | promoção local separada da promoção portátil |
| AUD-58 | consumo real de atalho pelo contexto | passou | família de delegação com `usageCount: 1` |
| AUD-59 | suspensão, arquivo e desuso | passou | quatro duplicatas arquivadas, histórico preservado |
| AUD-60 | propostas de autoaperfeiçoamento | passou na classificação | nove propostas: uma avaliada e oito operacionais |
| AUD-61 | roteamento por destino | passou | regra, procedimento, roteamento, personalidade, hook, eval ou capacidade |
| AUD-62 | promoção portátil e escrita no Git | passou na proteção | não ocorre por mero sucesso local; exige artefato e gates |

## Auditorias de eval

| ID | Auditoria | Resultado | Evidência |
|---|---|---|---|
| AUD-63 | contrato `omni-core-v1` | passou | 21 casos e pesos normalizados |
| AUD-64 | schema do histórico | passou | métricas e fingerprint sem evidência bruta |
| AUD-65 | comparação entre rodadas | passou automaticamente | melhoria, estabilidade e regressão de segurança cobertas |
| AUD-66 | coerência do caso de aprendizado de atalho | corrigida no fechamento | primeiro uso local, validação e promoção portátil agora separados |
| AUD-67 | histórico real de eval | lacuna encontrada | zero rodadas antes do fechamento |
| AUD-68 | baseline determinístico parcial | será gravado no fechamento | somente casos diretamente medidos por testes, custo zero |

## Auditoria das próprias sessões de trabalho

| ID | Auditoria | Resultado | Evidência |
|---|---|---|---|
| AUD-69 | sessão do repositório Omni | concluída | transcript local inspecionado sem copiá-lo ao Git |
| AUD-70 | sessão central de trabalho no VS Code | concluída | pedidos, ferramentas, subagentes e falhas confrontados com os stores |
| AUD-71 | correlação transcript × estado persistido | passou no diagnóstico | mostrou atividades sem registro por falta de recarga |
| AUD-72 | privacidade do inventário | passou | nenhum transcript, fala, segredo ou saída bruta versionado |

Também foram observadas verificações operacionais de um projeto externo durante a sessão central
(estado de trabalho, permissões, conectividade, banco, deploy e migrações). Elas não entram na bateria
do Omni e seus detalhes não são copiados para este repositório público. A existência dessa atividade,
porém, foi considerada nas auditorias de sensores, delegação, falhas e varredura acima.

## Alterações que nasceram das auditorias

| Commit | Resultado incorporado |
|---|---|
| `477c87e` | retorno de atualização simplificado |
| `683163e` | papel cognitivo e continuidade fixados |
| `426970f` | ciclo operacional e aprendizado conectados |
| `c34dddb` | auditoria diária adicionada |
| `10f1a76` | relatório completo da varredura obrigatório |
| `2186c5b` | personalidade em alta intensidade |
| `e8ba020` | validação automática de padrões de falha |
| `3dd2bc3` | evidência preservada ao fechar validação |
| `680614e` | assinaturas genéricas de falha separadas |
| `2f076f7` | atalhos efetivos, consolidados e esquecíveis |

## Estado-base antes do fechamento

- memória: 15 confirmadas, 0 candidatas e 3 arquivadas;
- atalhos: 2 ativos, 1 validado e 4 arquivados;
- falhas: 19 padrões; 1 avaliado, 1 em teste/análise, 4 candidatas e 13 em observação;
- automação de falhas: 1 concluída e 5 bloqueadas;
- autoaperfeiçoamento: 9 propostas, 1 avaliada e 8 operacionais;
- ciclo operacional: 1 sessão, 0 delegações reais registradas e 240 eventos;
- contexto estruturado: 0 checkpoints, 0 itens de backlog e 2 descobertas resolvidas;
- varredura diária: 4 execuções e 157 evidências processadas;
- eval: 0 rodadas reais antes do fechamento;
- versão instalada: 0.19.0 e sem atualização disponível.

## Pendências honestas para o próximo dia

**Rodada reservada para 27/08/2026, no fim do dia.** Nenhum item abaixo deve ser esquecido ou
considerado aprovado antes da execução:

1. recarregar o plugin na sessão do VS Code;
2. executar uma delegação real e confirmar o ciclo inteiro no estado;
3. rodar o DoD comportamental: personalidade, conversa longa, memória entre sessões e aprendizado
   real, seguindo o roteiro em `definition-of-done-2026-08-27.md`;
4. confirmar que o checkpoint inicial/final aparece em trabalho não trivial;
5. verificar se evals observados permanecem úteis e sem falsos positivos;
6. acompanhar os cinco trabalhos de falha bloqueados sem contornar permissão ou ambiente ausente.

### Ponto de partida da auditoria de 27/08

A auditoria de amanhã começa a partir do diálogo que reservou a rodada para o fim do dia e definiu o
DoD comportamental como teste de uso real. O roteiro resumido que deve ser retomado é:

1. conversar naturalmente com o Omni por 8 a 12 turnos e observar personalidade, humor, analogias,
   raciocínio e iniciativa sem pedir que ele os encene;
2. declarar duas preferências numa sessão e conferir se o Omni as aplica em outra sessão quando forem
   relevantes, sem repeti-las;
3. corrigir um comportamento durante uma tarefa segura, repetir a mesma família de tarefa e verificar
   se o turno seguinte mudou;
4. conferir se memória, falhas, atalhos, evals e varredura registraram somente evidência válida, sem
   duplicar contadores, guardar conversa bruta ou enviar memória pessoal ao Git.

O início da rodada deve primeiro recuperar este ponto de partida, executar `/plugin` → **Restart** e
registrar o estado anterior. O roteiro detalhado e os campos de evidência continuam em
[`definition-of-done-2026-08-27.md`](definition-of-done-2026-08-27.md).

## Fechamento desta rodada

- sintaxe: aprovada;
- suíte: **150/150 testes aprovados**;
- manifesto do marketplace: validado pelo Claude Code 2.1.246;
- smoke do plugin instalado 0.19.0 e repetição na 0.19.1: contexto, sessão, delegação, visibilidade,
  evidência, conclusão e atalho conectados;
- persistência: checkpoints reais de início e encerramento registrados;
- eval: primeiro baseline determinístico parcial registrado, com 16 casos, 100% de sucesso, score
  médio 1, latência média observada de 165,375 ms e custo zero;
- privacidade: histórico manteve apenas fingerprints da evidência;
- versão 0.19.1 publicada no `origin/main`, instalada e validada; a sessão aberta ainda precisa de
  **Restart** para passar a usar os hooks novos.

O protocolo repetível está em [`ciclo-auditoria-7-dias.md`](ciclo-auditoria-7-dias.md).
