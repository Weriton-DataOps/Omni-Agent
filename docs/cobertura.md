# Cobertura da especificação mestre

## Funcional e testado

- personalidade v2 candidata ativa, com v1 preservada como linha de base;
- suíte de eval de personalidade versionada, com camada automática determinística sobre respostas
  capturadas e revisão humana obrigatória antes de qualquer promoção;
- gate de promoção com ID estável, evidência versionada, SHA-256, scores recalculados e recusa de
  resultados incompletos ou incompatíveis com a suíte;
- memória confirmada e candidata;
- confirmação e descarte de candidatas;
- pipeline determinístico de extração, classificação, validação e pontuação;
- descarte de conversa comum e contexto explicitamente transitório;
- consolidação de evidências repetidas por ocorrência;
- recusa de possíveis segredos;
- escrita atômica e concorrente;
- inicialização local e migração versionada sem perda;
- proteção contra downgrade do schema de memória;
- deduplicação;
- recuperação semântica local e lexical por intenção;
- ranking por escopo, recência, frequência, confiança, importância e contexto atual;
- seleção única com recortes fast/deep e diagnóstico sem conteúdo pessoal;
- manutenção automática diária com expiração explícita e triagem conservadora de candidatas;
- arquivo local auditável, sem exclusão permanente automática;
- atualização, obsolescência e consolidação explícitas com preservação das versões anteriores;
- consolidação automática apenas de duplicatas exatas e propostas semânticas sujeitas à decisão humana;
- fotografia canônica;
- projeções fast e deep com orçamento;
- ativação isolada e montagem de contexto em cada turno do Claude Code;
- catálogo mínimo de capacidades;
- skill do Claude Code.
- detecção de versão desatualizada com ETag e fallback offline;
- atualização explícita com validação da origem, da instalação e recarga na mesma sessão;
- aprendizado local de atalhos com três sucessos consecutivos, validação independente e regressão
  segura diante de falha ou resultado inconsistente;
- armazenamento de atalhos sem resultado bruto, sem segredo e sem promoção automática;
- classificação de autoaperfeiçoamento entre descarte, memória e capacidade;
- proposta de capacidade a partir de atalho validado, com eval repetível e revalidação contra regressão;
- aprovação explícita de portabilidade e materialização auditável de skill e capacidade na árvore-fonte;
- proibição estrutural de commit, push e promoção automática pelo runtime;

## Contratado, ainda incompleto

- gates de versão, commit e publicação dos artefatos materializados;
- captura e análise especializada de bugs e padrões de falha da seção 26;
- estado conversacional e histórico de sessões;
- catálogo de projetos;
- geração das respostas de eval por modelo, registro da revisão humana e observatório;
- adaptação para outros canais.

Nada desta segunda lista deve ser apresentado como funcional antes de possuir código, teste e
evidência repetível.
