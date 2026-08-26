# Admissão de capacidades e skills

Este contrato é o funil específico para aprendizados cuja natureza real é uma **nova capacidade**.
Regras operacionais, procedimentos, roteamento, personalidade, hooks e casos de eval seguem o ciclo
operacional em `contratos/operacao/ciclo.json` e `runtime/evolucao.mjs`; portanto, deixam de passar
por este gate de skill.

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
```

`materialized-pending-version` significa que os artefatos foram criados na árvore-fonte, mas ainda
precisam passar pelos gates do repositório, receber versão, commit e publicação. O runtime nunca faz
commit ou push.

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
