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
