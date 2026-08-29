# Admissão de capacidades e skills

Este contrato é o funil específico para aprendizados cuja natureza real é uma **nova capacidade**.
Regras operacionais, procedimentos, roteamento, personalidade, hooks e casos de eval seguem o ciclo
operacional em `contratos/operacao/ciclo.json` e `runtime/evolucao.mjs`; portanto, deixam de passar
por este gate de skill.

As confirmações do proprietário abaixo valem **somente para admitir uma nova capacidade/skill** no
papel do Omni. Elas não bloqueiam correção automática de runtime, aprendizado de falha, ajuste de
personalidade, eval, retry ou materialização de uma regra operacional já coberta pela autoridade do
pedido. Esses caminhos são automáticos e possuem seus próprios gates técnicos.

```text
experiência
    ↓ analisar utilidade e reutilização
    ├─ transitória ─────────────────────────► descarte
    ├─ útil, pessoal ou contextual ─────────► pipeline de memória
    └─ reutilizável e comprovada ───────────► proposta de capacidade
                                                  ↓
                                         skill em rascunho
                                                  ↓
                                         avaliação repetível
                                                  ↓
                                      aprovação do proprietário
                                                  ↓
                                      materialização versionável
```

## Estados

```text
draft → evaluated → approved → materialized-pending-version
   └───────────────→ rejected
                                  └→ retracted
```

`materialized-pending-version` significa que os artefatos de uma nova capacidade foram criados na
árvore-fonte, mas ainda precisam passar pelos gates e pelo fluxo versionado. A admissão de skill
continua explícita; isso não reduz a autonomia dos ciclos de correção operacional e personalidade.
Depois da instalação íntegra, o readback fica registrado dentro da promoção; isso não apaga a
proveniência do estado materializado.

`retracted` é terminal e só aparece quando a própria release instalada contém o registro canônico de
retração, identifica exatamente a proposta e o artefato retirado e prova os arquivos de runtime e de
teste que o substituíram. O estado preserva a evidência histórica, mas não cria `installedReadback`
para uma skill que deixou de existir.

## Gate para atalhos

Um atalho só entra no funil quando está `validated` na seção 24, possui a execução independente de
validação e totaliza ao menos quatro sucessos. A avaliação é refeita imediatamente antes da
materialização. Se o atalho regredir, a promoção é recusada.

O proprietário precisa confirmar explicitamente que o conteúdo é portátil e pode entrar no Git.
Também precisa confirmar que a capacidade pertence diretamente ao papel do Omni, apareceu num fluxo
real, não é apenas especialidade delegável e possui evidência repetível de utilidade. Nenhuma das
duas decisões pode ser inferida pelo modelo. A materialização produz:

- uma skill em `skills/learned-<nome>/SKILL.md`;
- uma entrada no catálogo canônico de capacidades;
- um registro auditável em `contratos/aprendizado/promocoes/`.

O estado das propostas permanece local em `%APPDATA%\omni\learning\self-improvement.json`. Resultado
bruto, conversa, credencial e memória pessoal não entram no pacote promovido.

As categorias de falha já pertencem à taxonomia, mas sua captura e análise especializada são assunto
da seção 26.
