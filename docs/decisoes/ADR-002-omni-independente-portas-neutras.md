# ADR-002 — Omni independente e portas neutras de delegação

**Status:** aprovado pelo proprietário em 29/ago/2026. Este ADR complementa e, em caso de conflito,
prevalece sobre o ADR-001 e sobre a especificação mestre.

## Decisão

O Omni é um agente assistente pessoal independente. Ele conversa, preserva continuidade, organiza,
delega, observa, acompanha, verifica e aprende. Seu repositório contém apenas identidade, contexto,
memória, aprendizado, auditoria e o ciclo local necessário para acompanhar suas próprias delegações.

O futuro OverCore será construído do zero, passo a passo, em outra pasta e em repositório próprio.
`Overcore Studio` é referência histórica somente leitura: não é fonte canônica, dependência de
runtime, pacote, workspace nem destino de alterações do Omni. A tecnologia e a arquitetura do novo
OverCore serão decididas durante sua própria construção.

Task Manager, DAG/Graph Engine, Event Store, Artifact Registry, Agent SDK e Harness não pertencem ao
Omni. Se existirem no futuro, pertencem ao ambiente externo de desenvolvimento e execução.

A única fronteira de execução do Omni é uma porta neutra de solicitação e retorno. Transporte e
tecnologia pertencem a adaptadores. `omni-operational-cycle-v1` permanece o único ciclo de
delegação; adaptadores não mantêm outro FSM nem outro store.

Um executor externo pode confirmar entrega e início, relatar progresso, bloquear, falhar, cancelar
ou devolver resultado. Ele nunca produz `verified` ou `closed`: somente o Omni, após readback
independente da evidência, pode verificar e fechar uma delegação.

## Papel do Omni diante do futuro OverCore

Quando ambos tiverem uma base aceitável, o Omni poderá:

1. transformar uma intenção em briefing neutro;
2. enviá-lo por um adaptador escolhido;
3. continuar disponível para conversa;
4. observar progresso e bloqueios;
5. receber resultado e referências de evidência;
6. fazer verificação independente proporcional;
7. devolver a situação ao proprietário.

O Omni não planeja nem administra o funcionamento interno do OverCore, não compartilha sua memória
pessoal e não absorve os registros operacionais daquele ambiente.

## Aplicação à especificação mestre

As seções 15–18, 31 e 35–38 são referência externa e não normativa para o núcleo do Omni. Toda
menção direta a OverCore, Harness, SDK, Task Manager, DAG, Event Store ou Artifact Registry fica
subordinada a este ADR.

