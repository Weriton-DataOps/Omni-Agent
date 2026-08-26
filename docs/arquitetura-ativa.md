# Arquitetura ativa

## Regra central

Existe uma única fonte para cada responsabilidade:

| Responsabilidade | Fonte |
|---|---|
| identidade ativa | `contratos/personalidade/manifest.json` → contrato versionado |
| catálogo disponível | `contratos/capacidades/catalogo.json` |
| memória persistente | `%APPDATA%\omni\memory\memory.json` |
| seleção de contexto | `runtime/contexto.mjs` |
| recuperação e ranking de memória | `runtime/recuperacao.mjs` + `contratos/contexto/recuperacao.json` |
| escrita de memória | `runtime/memoria.mjs` |
| manutenção e ciclo de vida | `runtime/memoria.mjs` + `contratos/memoria/garbage-collection.json` |
| aprendizado local de atalhos | `runtime/atalhos.mjs` + `contratos/aprendizado/atalhos.json` |
| pipeline de autoaperfeiçoamento | `runtime/autoaperfeicoamento.mjs` + contrato versionado |
| aprendizado com falhas | `runtime/falhas.mjs` + `contratos/aprendizado/falhas.json` |
| injeção por turno | `hooks/hooks.json` + `runtime/hook-contexto.mjs` |
| detecção de atualização | `runtime/versao.mjs` |
| atualização explícita do plugin | `runtime/atualizacao.mjs` |
| entrada no Claude Code | `skills/omni/SKILL.md` |
| gate de promoção da personalidade | suíte + resultado com SHA-256 + `runtime/personalidade.mjs` |

## Contexto de uma resposta

```text
PERSONALIDADE ─┐
CAPACIDADES ───┼─► FOTOGRAFIA CANÔNICA ─┬─► FAST
MEMÓRIA ───────┘                         └─► DEEP
```

Fast e deep não são duas memórias. São duas projeções da mesma fotografia, com orçamentos diferentes.

```text
intenção → filtro de escopo → semântica local + lexical → ranking híbrido → top 4 fast / top 10 deep
```

O ranking só considera memória confirmada e exige relação mínima com a intenção antes de aplicar
recência, frequência, confiança e importância. Assim, metadados fortes não empurram lembranças sem
relação para o prompt.

## Ciclo da sessão no Claude Code

```text
/omni:omni
    ↓
ativa a sessão do Omni
    ↓
cada UserPromptSubmit
    ↓
intenção → memória relevante → projeção deep → contexto adicional → resposta
    ↓
SessionEnd remove somente a marca de ativação
```

O hook só injeta contexto nas sessões em que o Omni foi ativado. Ele não interfere nas demais
conversas do Claude Code. A memória permanece local quando a sessão termina.

## Escrita de memória

```text
mensagem comum ───────────────────────────────► descartar
instrução explicitamente temporária ─────────► usar sem persistir
sinal persistente ─► validar ─► pontuar ─────► candidata local
pedido `lembrar` ─► validar ─────────────────► confirmada local
candidata ─► proprietário confirma/descarta ─► decisão registrada
```

O contrato detalhado está em `contratos/memoria/pipeline-escrita.md`. O hook executa a análise, mas
nunca promove sozinho uma inferência para memória confirmada.

## Ciclo de vida da memória

```text
ativa ──┬── expirada ───────────────────────────────► arquivo local
        ├── candidata antiga, fraca e isolada ─────► arquivo local
        ├── duplicata exata ─► consolida ──────────► arquivo da sobra
        ├── semelhante ─────────────────────────────► proposta para o proprietário
        └── decisão explícita ─► atualiza/aposenta/consolida
```

A manutenção segura é conferida no máximo uma vez por dia ao abrir o store. Memória confirmada sem
prazo não é aposentada automaticamente, e nenhum registro arquivado sofre exclusão permanente
automática. Semelhança aproximada apenas gera uma proposta; o runtime não inventa sozinho o padrão
semântico ou procedural que a substituirá.

## Aprendizado de atalhos

```text
execução real + resultado verificado
              ↓
        observação local ── falha/inconsistência ──► reiniciar evidência
              ↓ 3 sucessos consecutivos
          candidata
              ↓ nova execução independente
           validada
              ╳ não promove nesta etapa
```

O store `%APPDATA%\omni\learning\shortcuts.json` guarda a sequência, os contadores e somente o hash
do resultado. O conteúdo bruto do resultado não é persistido. Um atalho validado não entra nas
projeções de contexto e não altera o Git: essa separação impede que repetição aparente se torne uma
capacidade falsa.

## Aprendizado com falhas

```text
falha real + execução identificada
              ↓
 assinatura estável em SHA-256
              ↓ 3 evidências distintas
        padrão candidato
              ↓
    causa raiz + hipótese
              ↓ 2 testes consistentes
             eval
              ↓
 proposta no autoaperfeiçoamento
```

Uma falha isolada nunca altera o comportamento do Omni. Logs, stack traces, comandos e resultados
brutos não são guardados. Evidência repetida é deduplicada, teste falho bloqueia o eval e uma nova
ocorrência invalida a avaliação anterior. A proposta resultante continua sujeita à decisão de
portabilidade e aos gates da seção 25.

## Promoção do aprendizado

```text
experiência ─► analisar ─┬─► descartar
                        ├─► memória
                        └─► capacidade proposta
                                  ↓
                           skill em rascunho
                                  ↓
                           eval determinístico
                                  ↓
                    confirmação humana de portabilidade
                                  ↓
                    materialized-pending-version
                                  ↓
                     gates + versão + commit + publicação
```

O pipeline local nunca transforma observação em capacidade por conta própria. A materialização ainda
não é publicação: ela cria alterações revisáveis na árvore-fonte e para. O fluxo recusa cache e pacote
instalado como destino, reavalia a evidência imediatamente antes da escrita e preserva commit e push
como ações separadas do desenvolvimento.

## Versão publicada

```text
ativação → estado → versão instalada × manifesto público → silêncio ou aviso
pedido `atualizar` → validar origem → atualizar marketplace/plugin → validar → aplicar na interface
```

A consulta usa apenas metadados públicos e possui fallback local. Ela não lê nem transmite memória.
O atualizador só roda mediante pedido explícito e não reinicia o Claude nem cria outra sessão.
No VS Code, a aplicação acontece por `/plugin` → **Restart**; no terminal, por `/reload-plugins`.

## Separação entre projeto e dados

```text
Git                              Máquina local
──────────────────────────       ─────────────────────────
código e contratos              memória confirmada
schemas                         candidatas
testes                          estado operacional
documentação                    dados privados
```

Nenhum caminho absoluto da máquina faz parte dos contratos. A skill resolve seus próprios arquivos
por `${CLAUDE_PLUGIN_ROOT}` e a memória resolve sua casa por `OMNI_HOME` ou `%APPDATA%`.

## Atualização do plugin e memória

```text
Git / release do plugin                 %APPDATA%\omni
-----------------------                 --------------
schema + migrações -------┐
runtime novo -------------+--> valida versão --> migra atomicamente
contratos ----------------┘                        └--> preserva os registros
```

O Git distribui o modo de compreender e migrar a memória, não a memória pessoal. Uma versão antiga
do plugin recusa um arquivo criado por uma versão futura em vez de sobrescrevê-lo. Memórias antigas
só entram por importação explícita depois de classificação, escopo, evidência e revisão de segredos.

## Regra de relevância

Uma resposta só pode introduzir conteúdo vindo de:

1. pedido atual;
2. personalidade canônica;
3. memória confirmada selecionada;
4. capacidade declarada relevante.

A especificação mestre orienta a construção, mas não entra inteira no prompt de cada turno.

## Melhoria mensurável do único agente

```text
mesmo corpus → rodada anterior ─┐
                               ├→ comparar qualidade, segurança, latência e custo
mesmo corpus → rodada nova ─────┘                ↓
                                   melhorar / estável / regredir
```

A suíte `omni-core-v1` avalia o Omni, e não uma coleção de agentes. O histórico local guarda métricas
e fingerprints das evidências; não guarda as conversas usadas no teste. Segurança não pode regredir
mesmo que latência ou custo melhorem.

## Orçamento e persistência do contexto

O catálogo de capacidades é filtrado por intenção e não é despejado inteiro em toda resposta. Cada
projeção informa quanto foi alocado, usado, descartado e deixado livre.

```text
conversa e execução → classificar efeitos → checkpoint estruturado
                                           ├─ tarefa e DoD
                                           ├─ resumo do estado
                                           ├─ decisões e pendências
                                           └─ referências, nunca transcript
descoberta fora do DoD → backlog → decisão futura do proprietário
```

Checkpoint não é histórico de chat. Ele preserva apenas o estado necessário para retomar trabalho,
dentro de limites fixos. Conversa bruta, transcript e lista de mensagens são recusados pelo runtime.

## Fronteira atual

O repositório contém somente o Omni. A seção 31 não se aplica ao agente único; as seções 36–38
pertencem a iniciativas externas. A seção 35 e a implementação da presença contínua da seção 39
estão adiadas até o proprietário concluir a validação por muitas conversas.
