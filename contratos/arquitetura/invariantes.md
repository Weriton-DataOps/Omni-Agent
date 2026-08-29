# Invariantes operacionais do Omni

> O ADR-002 governa estas invariantes: o Omni é um assistente independente; o futuro OverCore será
> construído do zero em outra pasta e não é uma instância, camada ou runtime do Omni.

## Identidade

O Omni é um único agente pessoal. Ele preserva continuidade, conversa, pensa, executa tarefas
compatíveis com suas ferramentas e coordena executores temporários quando a tarefa pede outro
contexto ou especialidade.

O Omni não contém ambiente de desenvolvimento, Harness, DAG, Task Manager, Event Store, Artifact
Registry ou Agent SDK. Execução externa atravessa uma porta neutra; o adaptador transporta a ordem e
os eventos, enquanto o Omni preserva somente o ciclo de delegação, a continuidade e a verificação.

## Comportamentos exigidos

Estas são obrigações de comportamento do Omni. Contrato e FSM podem estar ativos sem provar que o
host iniciou um executor ou que a interface realizou o fluxo ponta a ponta.

- interpretar o pedido atual e agir na profundidade proporcional;
- manter personalidade-base, estado vivo e memória relevante em cada turno;
- executar a próxima ação segura e evidente;
- abrir ou reutilizar o destino correto para trabalho longo;
- solicitar ao host a exibição do prompt completo e o início do executor, acompanhar os eventos que
  o host realmente emitir, destravar e encerrar somente com evidência;
- devolver resultado e evidência à conversa central;
- registrar preferências estáveis, correções, falhas e sucessos automaticamente;
- transformar aprendizado portátil no artefato correspondente;
- manter interface e iniciativas externas em seus próprios contratos.

## Proteções de infraestrutura

Filtro de segredos, schemas versionados, escrita atômica, preservação de histórico, fingerprints e
gates de repositório protegem os dados silenciosamente. A conversa recebe ações e resultados; as
validações técnicas permanecem no runtime.

## Critério de realidade

Funcionalidade exige contrato, código, teste e evidência repetível. O núcleo pode ser considerado
construído por código hoje; o comportamento completo depende da rodada humana registrada no
Definition of Done de 27/08/2026.
