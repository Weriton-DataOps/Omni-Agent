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
- fotografia canônica com papel operacional e limites de especialização obrigatórios;
- projeções fast e deep com orçamento e roteamento proporcional usado pelo hook;
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
- aprovação explícita de portabilidade e aderência ao papel antes da materialização auditável de skill;
- proibição estrutural de commit, push e promoção automática pelo runtime;
- captura local de falhas por assinatura criptográfica e evidência distinta, sem logs brutos;
- formação de padrão somente após três ocorrências, com deduplicação e escrita concorrente;
- análise separada de causa raiz e hipótese, seguida de dois testes consistentes da correção;
- eval de padrão de falha, invalidação por recorrência e encaminhamento seguro ao pipeline 25;
- suíte comparável do único agente Omni, com histórico local de qualidade, segurança, latência e custo;
- comparação antes/depois que bloqueia regressão de segurança;
- seleção de capacidades por intenção, orçamento por categoria e diagnóstico de descarte;
- checkpoint estruturado, comprimido e sem conversa bruta;
- backlog explícito para descobertas fora da Definition of Done;
- recuperação seletiva de checkpoint e backlog no contexto de uma resposta;
- invariantes verificáveis de identidade, contexto, escopo e fechamento;

## Raio-X desta revisão

| Requisito | Estado demonstrado |
|---|---|
| personalidade escolhida, carregada e injetada | implementado e utilizado |
| memória confirmada recuperada por relevância | implementado e utilizado |
| papel de assistente cognitivo e limites de especialidade | implementado e utilizado |
| fast/deep escolhidos por tarefa | implementado e utilizado |
| checkpoint e backlog alimentando retomada | implementado e utilizado seletivamente |
| aprendizado de atalhos e falhas | implementado, com promoção bloqueada por gates |
| admissão de nova skill pelo papel do Omni | implementado, exige confirmação humana |
| personalidade perceptível em conversa real | corpus ampliado; rodada humana ainda pendente |
| catálogo completo de projetos | contratado, ainda incompleto |
| integrações externas e interface | fora do escopo atual |

## Contratado, ainda incompleto

- gates de versão, commit e publicação dos artefatos materializados;
- histórico conversacional bruto (deliberadamente não usado como memória); a continuidade
  estruturada por checkpoints já é funcional;
- catálogo de projetos;
- geração das respostas de eval por modelo, registro da revisão humana e observatório;
- adaptação para outros canais.

Nada desta segunda lista deve ser apresentado como funcional antes de possuir código, teste e
evidência repetível.

## Deliberadamente fora ou adiado

- seção 31: seleção entre agentes; não se aplica ao Omni, que é um único agente;
- seção 35: interface; adiada pelo proprietário até ampla validação conversacional;
- seções 36–37: pertencem à iniciativa independente OverCore;
- seção 38: pertence à iniciativa independente Oracle;
- seção 39: presença contínua é requisito, mas depende da interface e ainda não é funcional.
