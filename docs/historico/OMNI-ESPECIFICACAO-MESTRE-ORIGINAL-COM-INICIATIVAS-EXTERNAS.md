# OMNI — ESPECIFICAÇÃO MESTRE DE CONTEXT ENGINEERING, MEMORY E INTELIGÊNCIA OPERACIONAL

> **Decisão de escopo vigente:** o [ADR-001](decisoes/ADR-001-fronteiras-iniciativas.md) prevalece na
> aplicação desta especificação. Omni, Oracle e OverCore são iniciativas independentes; as seções
> 31 e 36–38 não fazem parte do núcleo do Omni, e a seção 35 está adiada por decisão do proprietário.

## 1. Objetivo

O objetivo desta fase é construir o **Omni como um agente pessoal inteligente, leve, persistente e onipresente**, capaz de conversar naturalmente, compreender contexto, acessar capacidades distribuídas, delegar trabalho e aprender continuamente sem transformar a própria janela de contexto em um depósito gigantesco de informações.

O princípio central é:

> **O Omni não deve ficar mais inteligente carregando cada vez mais informação dentro do contexto. Ele deve ficar mais inteligente porque sabe onde encontrar a informação certa, quando recuperá-la, como utilizá-la, quem pode executar determinada tarefa, quais capacidades existem e como transformar experiências válidas em memória, procedimentos e novas capacidades.**

O sistema deve priorizar **capacidade de recuperação, decisão, delegação e execução**, e não acúmulo indiscriminado de contexto.

---

# 2. Papel do Omni

O Omni é o **agente pessoal e interface cognitiva do usuário**.

Ele não é o executor principal de todas as tarefas.

Ele deve permanecer disponível enquanto outras tarefas estão sendo executadas.

O Omni deve:

* conversar;
* interpretar intenção;
* manter o contexto conversacional imediato;
* acessar memória relevante;
* recuperar conhecimento sob demanda;
* descobrir capacidades disponíveis;
* decidir entre execução rápida e execução profunda;
* delegar tarefas para o OverCore;
* consultar o estado de tarefas;
* receber eventos do Oracle;
* solicitar decisões ao usuário;
* informar resultados;
* aprender com experiências validadas.

O Omni deve evitar assumir trabalhos longos diretamente.

Quando uma tarefa exigir investigação, execução complexa, programação, múltiplas etapas, vários agentes ou uso prolongado de ferramentas, o Omni deve transformar a intenção em uma tarefa e delegá-la ao sistema de execução.

---

# 3. Arquitetura geral

A arquitetura deve permanecer conceitualmente separada nas seguintes camadas:

```text
                         USER
                           │
                           ▼
                         OMNI
                           │
             ┌─────────────┼─────────────┐
             │             │             │
        Conversation     Router        Context
             │             │             │
             │       ┌─────┴─────┐       │
             │       ▼           ▼       │
             │     FAST         DEEP     │
             │       │           │       │
             │       ▼           ▼       │
             │    RESPONSE     HARNESS   │
             │                   │       │
             │                   ▼       │
             │               OVERCORE    │
             │                   │       │
             │              GRAPH ENGINE │
             │                   │       │
             │              AGENT REGISTRY
             │                   │
             │         ┌─────────┼─────────┐
             │         ▼         ▼         ▼
             │      AGENT A   AGENT B   AGENT C
             │         │         │         │
             │       Skill     Skill     Skill
             │       Model     Model     Model
             │       Tools     Tools     Tools
             │
             └──────────────────────────────►
                       Memory / Knowledge /
                       Capabilities / Procedures
```

O Oracle permanece como camada de observação:

```text
Oracle
  ↓
events / signals / observations
  ↓
Omni / Task State / Harness
```

---

# 4. Context Engineering

## 4.1 Princípio central

O contexto de cada inferência deve ser **montado dinamicamente**.

Nunca presumir que tudo que o Omni sabe precisa estar dentro do prompt.

O contexto deve ser tratado como um recurso limitado.

A pergunta correta não é:

> "O que podemos colocar no contexto?"

A pergunta correta é:

> "O que este turno precisa saber para tomar a melhor decisão?"

---

# 5. Context Assembly Pipeline

Antes de cada inferência importante, o sistema deve montar o contexto através de um pipeline.

```text
USER INPUT
    ↓
INTENT
    ↓
TASK / CONVERSATION CLASSIFICATION
    ↓
CONTEXT RETRIEVAL
    ↓
MEMORY RETRIEVAL
    ↓
KNOWLEDGE RETRIEVAL
    ↓
CAPABILITY DISCOVERY
    ↓
CURRENT STATE
    ↓
RELEVANT HISTORY
    ↓
TOOLS / ACCESS
    ↓
POLICIES / GUARDRAILS
    ↓
CONTEXT ASSEMBLY
    ↓
MODEL
```

Somente aquilo que for relevante deve entrar na janela.

---

# 6. Tipos de contexto

O Omni não deve tratar tudo como "memória".

Devem existir categorias distintas.

## 6.1 Conversational Context

É o contexto imediato da conversa.

Exemplo:

```text
Usuário:
"Sobre o que a gente falou agora há pouco..."
```

Esse contexto pode ser temporário.

Não deve ser automaticamente transformado em memória permanente.

---

## 6.2 Current State

Representa o que está acontecendo agora.

Exemplo:

```text
Task 4821
status = running

Coder Agent
progress = 72%

Frontend Agent
status = waiting

Oracle
event = postgres_connection_saturation
```

Current State não deve ser tratado como memória histórica.

---

## 6.3 User Memory

Informações persistentes sobre o usuário.

Exemplo:

```text
user/
├── preferences/
├── habits/
├── profile/
└── working_style/
```

Exemplos:

* preferências;
* hábitos;
* estilo de trabalho;
* decisões persistentes;
* preferências de comunicação.

---

## 6.4 Project Memory

Contexto persistente específico de um projeto.

```text
projects/
├── omni/
├── overcore/
├── growth/
└── other-projects/
```

Não carregar todos os projetos em todas as conversas.

Selecionar o projeto relevante.

---

## 6.5 Episodic Memory

Registra eventos relevantes.

```text
episodic/
├── what_happened
├── important_events
└── significant_interactions
```

Não registrar cada conversa banal.

Somente episódios que tenham valor futuro.

---

## 6.6 Semantic Memory

Conhecimento aprendido e validado.

```text
semantic/
├── learned_facts
├── validated_patterns
└── domain_knowledge
```

Exemplo:

> "Neste ambiente, o serviço X usa PostgreSQL na porta Y."

---

## 6.7 Procedural Memory

Esta é uma camada crítica para o Omni.

Ela registra **como fazer coisas**.

```text
procedural/
├── procedures
├── workflows
├── shortcuts
└── playbooks
```

Exemplo:

```text
procedure:
server_latency_diagnosis

normal_path:
CPU → RAM → Processes → PostgreSQL → Connections

optimized_path:
PostgreSQL → Connections

confidence:
0.91

evidence:
18 successful executions
```

O sistema deve aprender procedimentos e atalhos, não somente fatos.

---

# 7. Knowledge / RAG

Conhecimento não deve ser colocado inteiro no contexto.

O Omni deve possuir uma camada de conhecimento consultável.

```text
Knowledge
├── documentation
├── architecture
├── code
├── infrastructure
├── procedures
├── manuals
├── decisions
└── project knowledge
```

Fluxo:

```text
Omni
 ↓
"Preciso saber X"
 ↓
Knowledge Retrieval
 ↓
relevantes encontrados
 ↓
resumo / evidência
 ↓
contexto temporário
 ↓
modelo
```

O conhecimento deve ser recuperado **sob demanda**.

O Omni não precisa memorizar a documentação.

Ele precisa saber:

> **onde procurar.**

---

# 8. Capability Engineering

O Omni também precisa ter um catálogo de capacidades.

```text
Capabilities
├── filesystem
├── terminal
├── browser
├── postgres
├── docker
├── github
├── servers
├── monitoring
├── deployment
├── scheduling
├── messaging
├── OverCore
└── custom capabilities
```

Cada capacidade deve possuir metadados:

```text
name
description
when_to_use
when_not_to_use
inputs
outputs
risk
permissions
latency
cost
required_tools
recommended_agent
```

O Omni deve consultar esse catálogo.

Não carregar todas as ferramentas e todos os comandos no contexto em todos os turnos.

---

# 9. Agents, Skills, Models e Tools

No sistema atual, cada agente possui sua própria configuração.

Exemplo:

```text
Agent
├── Instructions
├── Model
├── Skill
├── Tools
├── Permissions
└── Evals
```

O OverCore deve saber qual agente possui qual conjunto de capacidades.

O Omni não deve precisar conhecer cada agente individualmente em profundidade.

Ele consulta o Agent Registry.

```text
Task
 ↓
OverCore
 ↓
Agent Registry
 ↓
best candidate
 ↓
Agent
 ├── Skill
 ├── Model
 ├── Tools
 └── Permissions
```

---

# 10. Access Engineering

O Omni deve ser capaz de trabalhar com diferentes ambientes.

Exemplos:

```text
Workstation Empresa
PC Casa
Servidor 7
OverCore Station
outros ambientes autorizados
```

Cada ambiente deve ser tratado como um recurso identificado.

```text
Environment
├── identity
├── location
├── capabilities
├── connectivity
├── permissions
├── available_agents
└── health
```

O Omni deve conseguir descobrir:

> "Onde essa tarefa pode ser executada?"

e não assumir que tudo está no computador atual.

---

# 11. Fast Path

O Omni possui um caminho rápido para comunicação natural.

Arquitetura:

```text
VOICE
 ↓
REALTIME
 ↓
FAST ROUTER
 ↓
GPT-REALTIME
 ↓
RESPONSE
```

Esse caminho deve ser usado para:

* conversa;
* perguntas simples;
* comandos conhecidos;
* pequenas decisões;
* consulta de estado;
* respostas rápidas.

Não carregar o sistema inteiro neste caminho.

A prioridade é:

> **baixa latência + contexto mínimo necessário.**

---

# 12. Deep Path

Quando o pedido exige:

* investigação;
* múltiplas etapas;
* desenvolvimento;
* execução prolongada;
* análise profunda;
* múltiplos agentes;
* uso de ferramentas;
* acesso remoto;
* planejamento;

o Router deve encaminhar para o caminho profundo.

```text
VOICE / CHAT
 ↓
OMNI
 ↓
ROUTER
 ↓
DEEP
 ↓
HARNESS
 ↓
OVERCORE
 ↓
GRAPH
 ↓
AGENTS
 ↓
TOOLS
 ↓
RESULT
 ↓
OMNI
```

O cérebro profundo pode usar Claude no stack atual.

O Omni não deve ficar bloqueado durante esse processamento.

Ele deve voltar imediatamente ao estado disponível.

---

# 13. Chat sem Realtime

Deve existir também uma interface de conversa não realtime.

Ela utiliza a mesma arquitetura cognitiva do Omni.

A diferença é a interface de entrada/saída.

```text
Chat
 ↓
Omni
 ↓
Router
 ↓
Fast / Deep
```

Não criar três inteligências diferentes.

Realtime, Chat e outras interfaces devem compartilhar:

* memória;
* contexto;
* capabilities;
* estado;
* task system;
* personalidade;
* conhecimento.

Somente a interface e o caminho de inferência podem variar.

---

# 14. Router

O Router é responsável por decidir o caminho da intenção.

Exemplo:

```text
USER
 ↓
ROUTER
 ├── conversation
 ├── known_command
 ├── state_query
 ├── memory_query
 ├── knowledge_query
 ├── task
 ├── investigation
 └── emergency
```

Depois:

```text
known_command
    ↓
FAST

complex_task
    ↓
DEEP

state_query
    ↓
Task State

knowledge_query
    ↓
RAG

memory_query
    ↓
Memory
```

O Router não executa a tarefa.

Ele decide **qual mecanismo deve tratar a solicitação**.

---

# 15. Task Manager

Toda tarefa longa deve possuir uma identidade própria.

```text
TASK-4821

objective
status
priority
scope
created_at
updated_at
owner
graph
agents
environment
workspace
sandbox
artifacts
decisions
events
result
```

O Omni cria ou consulta Tasks.

O Omni não precisa ficar executando a Task.

---

# 16. Task State Manager

Deve responder:

> "Como essa tarefa está agora?"

Estados possíveis:

```text
queued
planning
running
waiting
blocked
needs_user
completed
failed
cancelled
```

O Omni deve consultar este estado antes de responder sobre uma tarefa.

Nunca deduzir estado apenas pelo histórico da conversa.

---

# 17. Event Store

Deve responder:

> "O que aconteceu?"

Registrar eventos estruturados:

```text
TaskCreated
TaskStarted
AgentSelected
WorkspaceCreated
SandboxCreated
ToolCalled
ToolCompleted
FileChanged
CommandExecuted
AgentBlocked
EvaluationStarted
EvaluationPassed
HumanApprovalRequested
HumanApprovalGranted
TaskCompleted
TaskFailed
```

Isso permite reconstruir posteriormente o histórico de uma tarefa.

---

# 18. Artifact Registry

Deve responder:

> "O que foi produzido?"

Registrar:

```text
files
reports
logs
builds
artifacts
screenshots
datasets
outputs
```

O Omni deve ser capaz de localizar artefatos posteriormente sem precisar reconstruir a tarefa inteira.

---

# 19. Decision Log

Decisões humanas importantes devem ser persistidas.

Exemplo:

```text
decision:
Use PostgreSQL instead of Redis.

decided_by:
user

reason:
existing infrastructure

task:
4821

timestamp:
...
```

O Omni deve conseguir responder posteriormente:

> "Por que tomamos essa decisão?"

---

# 20. Memory Engineering

Memory Engineering deve ser implementado como sistema próprio.

Não transformar todo resultado de toda conversa em memória.

Cada candidato à memória deve passar por classificação.

```text
experience
 ↓
analyze
 ↓
candidate
 ↓
classify
 ├── transient
 ├── episodic
 ├── semantic
 ├── procedural
 ├── preference
 ├── capability
 └── discard
```

---

# 21. Memory Write Pipeline

Uma experiência não deve ser gravada diretamente.

```text
Experience
 ↓
Extract
 ↓
Classify
 ↓
Validate
 ↓
Score
 ↓
Store
```

Cada memória deve possuir metadados:

```text
type
source
timestamp
confidence
evidence
scope
project
last_validated
usage_count
expiration
```

Memórias críticas devem exigir evidência maior.

---

# 22. Memory Retrieval

Nunca recuperar "toda a memória".

O sistema deve buscar por relevância.

```text
Current Intent
      ↓
Memory Query
      ↓
Relevant memories
      ↓
rank
      ↓
select
      ↓
context
```

A recuperação deve considerar:

* relevância semântica;
* projeto;
* recência;
* frequência;
* confiança;
* importância;
* contexto atual.

---

# 23. Memory Garbage Collection

Memória também precisa ser limpa.

Memórias podem:

* expirar;
* ser atualizadas;
* ser consolidadas;
* ser marcadas como obsoletas;
* ser descartadas.

Não criar uma memória nova toda vez que o mesmo fato aparecer.

O sistema deve consolidar:

```text
100 episódios semelhantes
        ↓
pattern
        ↓
semantic/procedural memory
```

---

# 24. Learning Shortcuts

Uma parte importante do crescimento do Omni será aprender atalhos.

Exemplo:

Primeira execução:

```text
CPU
 ↓
RAM
 ↓
Processes
 ↓
Postgres
 ↓
Connections
```

Após várias execuções:

```text
Postgres
 ↓
Connections
```

O sistema deve registrar isso como **procedural learning**, depois validar.

Não promover imediatamente.

---

# 25. Self-Improvement Pipeline

A arquitetura deve seguir o conceito demonstrado no pipeline:

```text
EXPERIÊNCIA
      ↓
RESULTADO
      ↓
ANALISAR
      ↓
┌────────────┬────────────┬────────────┐
transient    useful       reusable
    ↓           ↓             ↓
 discard      memory       capability
                              ↓
                            skill
                              ↓
                         evaluation
                              ↓
                           promote
```

Essa estrutura deve ser expandida para incluir:

```text
learning
shortcuts
bug fixes
new knowledge
new procedures
new capabilities
failure patterns
agent improvements
```

---

# 26. Bug / Failure Learning

Falhas também devem entrar no pipeline.

```text
Agent
 ↓
Action
 ↓
Failure
 ↓
Analyze
 ↓
Root Cause
 ↓
Fix / Hypothesis
 ↓
Test
 ↓
Eval
 ↓
Promote
```

Não transformar uma única falha em regra global.

O sistema deve procurar padrões.

---

# 27. Agent Improvement

Um agente não deve simplesmente ficar melhor porque recebe mais contexto.

Ele pode melhorar através de:

```text
better instructions
better tool definitions
better skill
better procedure
better routing
better context retrieval
better recovery
better evals
better model selection
```

O sistema deve medir melhoria.

---

# 28. Evals

Evals são essenciais para o Omni.

O objetivo não é perguntar:

> "Esse agente parece inteligente?"

O objetivo é medir:

> **"Ele executa corretamente este tipo de tarefa?"**

Criar uma suíte de avaliação para:

```text
Conversation
Intent Classification
Routing
Memory Retrieval
Knowledge Retrieval
Capability Selection
Tool Selection
Task Creation
Task State
Planning
Execution
Recovery
Safety
Learning
```

---

# 29. Eval Structure

Cada Eval deve possuir:

```text
input
context
expected behavior
allowed behavior
forbidden behavior
success criteria
evidence
score
```

Exemplo:

```text
INPUT:
"Abra a webcam."

EXPECTED:
known command
→ direct execution

FORBIDDEN:
send to deep brain unnecessarily

SUCCESS:
command executed
latency < threshold
correct tool selected
```

Outro:

```text
INPUT:
"Analise por que o servidor está lento."

EXPECTED:
deep path
→ harness
→ OverCore
→ appropriate agents

FAIL:
simple conversational response
```

---

# 30. Evals históricos

O sistema deve manter histórico de desempenho.

Exemplo:

```text
Agent:
Coder

success_rate:
94%

tool_accuracy:
97%

recovery_rate:
81%

average_latency:
...

cost:
...

sample_count:
...
```

O OverCore pode usar esses dados para escolher agentes.

---

# 31. Agent Selection

O sistema deve aprender quais agentes performam melhor em quais tipos de tarefa.

Mas não assumir que um único agente deverá absorver tudo.

Utilizar critérios como:

```text
capability_match
historical_success
task_similarity
latency
cost
risk
recovery_rate
```

O sistema pode descobrir que determinados agentes podem ser consolidados futuramente, mas isso deve ser uma decisão baseada em evidência.

---

# 32. Context Budgeting

Toda execução deve possuir um orçamento de contexto.

Separar:

```text
mandatory
high_priority
relevant
optional
```

Nunca preencher o contexto até o limite apenas porque existe espaço.

Priorizar:

```text
current task
current decision
current state
relevant memories
relevant knowledge
relevant tools
relevant history
```

Descartar informação que não influencia a decisão atual.

---

# 33. Context Compression

Quando histórico se tornar grande:

```text
raw conversation
 ↓
summary
 ↓
structured state
 ↓
important decisions
 ↓
open tasks
```

Não simplesmente carregar toda a conversa.

---

# 34. Context Persistence ≠ Infinite Conversation

Persistência não significa uma única thread infinita.

Utilizar:

```text
Task
 ↓
Run / Conversation
 ↓
State
 ↓
Events
 ↓
Artifacts
 ↓
Memory
```

O sistema deve preservar conhecimento de maneira estruturada.

---

# 35. Harness

O Harness deve controlar:

```text
execution
state
context
tools
permissions
guardrails
retry
timeout
checkpoint
recovery
sandbox
workspace
observability
human approval
```

O Omni não deve controlar diretamente todos esses mecanismos.

Ele solicita.

O Harness executa.

---

# 36. OverCore

O OverCore continua sendo a estação/centro de produção e orquestração.

Responsabilidades:

```text
Task Planning
Graph Engine
Agent Registry
Skill Registry
Model Policy
Execution
Workspace Management
Sandbox Management
Evaluation
Integration
```

O OverCore não deve ser confundido com o Omni.

---

# 37. Graph Engine

O Graph Engine representa:

```text
nodes = tasks / agents / operations

edges = dependencies
```

Exemplo:

```text
SPEC
 ├── FRONTEND
 ├── API
 └── DATABASE
       ↓
      TEST
       ↓
     REVIEW
       ↓
     DEPLOY
```

Tarefas independentes devem poder executar em paralelo.

Dependências devem bloquear somente aquilo que realmente depende delas.

---

# 38. Oracle

Oracle é a camada de percepção e observabilidade.

Ele não precisa ser o executor principal.

Deve observar:

```text
servers
databases
jobs
queues
logs
metrics
agents
tasks
health
```

E gerar eventos/sinais.

```text
Oracle
 ↓
Event
 ↓
Classifier
 ↓
normal / anomaly
 ↓
Omni / Harness
```

---

# 39. Onipresença do Omni

O Omni deve ser considerado **available** enquanto outras tarefas estiverem rodando.

Exemplo:

```text
Omni = AVAILABLE

Coder = RUNNING
Frontend Agent = RUNNING
Database Agent = RUNNING
Oracle = OBSERVING
Research Agent = WAITING
```

O Omni não deve ficar ocupado aguardando o Coder.

Ele deve conseguir:

* conversar;
* iniciar outra tarefa;
* consultar outra tarefa;
* receber eventos;
* pedir decisões;
* mudar de projeto;
* voltar posteriormente à tarefa anterior.

---

# 40. Princípio fundamental de arquitetura

Não centralizar inteligência dentro do Omni.

Centralizar **coordenação** no Omni.

O Omni deve saber:

> quem sabe;

> onde está;

> como consultar;

> como executar;

> quem deve executar;

> como verificar;

> o que precisa ser lembrado.

Ele não precisa armazenar tudo nem saber executar tudo diretamente.

---

# 41. Princípio de evolução

Sempre que o sistema descobrir algo novo, responder:

```text
Isso é:
├── memória?
├── conhecimento?
├── procedimento?
├── capacidade?
├── skill?
├── bug?
├── shortcut?
├── preferência?
└── algo temporário?
```

Somente depois decidir onde armazenar.

Nunca despejar informação indiscriminadamente na memória do Omni.

---

# 42. Regra anti-context-bloat

Nunca resolver perda de capacidade simplesmente adicionando mais contexto.

Se o Omni não sabe algo:

1. verificar se existe memória relevante;
2. verificar knowledge/RAG;
3. verificar capabilities;
4. verificar procedures;
5. verificar task state;
6. verificar agentes disponíveis;
7. verificar ferramentas;
8. só então considerar aumentar o contexto permanente.

Pergunta central:

> **"Estamos precisando de mais informação no contexto ou de um mecanismo melhor para encontrar a informação certa?"**

Na dúvida, preferir o mecanismo de recuperação.

---

# 43. Regra anti-scope-creep

Durante uma tarefa, se o agente descobrir uma oportunidade de melhoria que não pertence ao objetivo atual:

```text
Discovery
 ↓
registrar
 ↓
backlog
 ↓
NÃO IMPLEMENTAR
```

A menos que a nova descoberta seja necessária para cumprir a Definition of Done.

Isso evita que uma tarefa vire uma árvore infinita de ramificações.

---

# 44. Definition of Done

Toda tarefa complexa deve possuir:

```text
Objective
Scope
Non-goals
Requirements
Success Criteria
Definition of Done
Known Constraints
```

O Evaluator deve avaliar a implementação contra esses critérios.

Descobertas fora do escopo devem ser registradas, não automaticamente implementadas.

---

# 45. Objetivo final

O Omni deve evoluir de:

```text
LLM com contexto
```

para:

```text
AGENT COM ACESSO A UM SISTEMA COGNITIVO DISTRIBUÍDO
```

O sistema completo deve permitir que o Omni:

```text
converse
 ↓
entenda
 ↓
recupere contexto
 ↓
consulte memória
 ↓
consulte conhecimento
 ↓
descubra capacidades
 ↓
escolha caminho
 ↓
delegue
 ↓
acompanhe
 ↓
receba eventos
 ↓
avalie
 ↓
aprenda
 ↓
melhore
```

Sem precisar colocar toda a inteligência dentro da janela de contexto.

---

# 46. Princípio final

O Omni deve seguir este princípio:

> **Não tente lembrar de tudo. Saiba onde encontrar tudo.**

E mais:

> **Não tente fazer tudo. Saiba quem ou o que deve fazer cada coisa.**

E:

> **Não transforme cada experiência em memória. Transforme experiências validadas em conhecimento, procedimento, capacidade ou aprendizado útil.**

E:

> **Não fique mais inteligente apenas porque ficou maior. Fique mais inteligente porque ficou melhor organizado.**

A arquitetura deve priorizar:

```text
RELEVÂNCIA
↓
RECUPERAÇÃO
↓
DECISÃO
↓
DELEGAÇÃO
↓
EXECUÇÃO
↓
VERIFICAÇÃO
↓
APRENDIZADO
```

O resultado esperado é um Omni que consegue trabalhar sobre múltiplos projetos, ambientes, máquinas, agentes, ferramentas e modelos sem carregar todos esses detalhes o tempo inteiro dentro do próprio contexto.

O Omni deve carregar **a capacidade de navegar pelo sistema**.

Essa é a base da Context Engineering desta implementação.
