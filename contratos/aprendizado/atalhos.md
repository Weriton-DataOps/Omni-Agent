# Aprendizado de atalhos

Este contrato implementa a seção 24 da especificação mestre.

```text
execução concluída e verificada
             ↓
    1 sucesso → active
             ↓
o atalho relevante entra no contexto e já pode ser usado
             ↓
    3 sucessos → validated
             ↓
proposta portátil separada, sem promoção automática para o Git

desuso ou falhas repetidas → archive
```

## Regras

- a identidade é `escopo + família operacional`; verbos do pedido e lista exata de ferramentas não fragmentam a rotina;
- o primeiro sucesso real e verificável torna o atalho localmente ativo, em estágio probatório;
- três sucessos consistentes o validam, sem criar automaticamente memória, verbo, skill ou capacidade portátil;
- atalhos ativos e relevantes entram no contexto do turno, e o uso é contabilizado;
- verificação do resultado nunca pode ser removida pelo atalho;
- uma falha suspende o uso; duas falhas ou inconsistências arquivam o atalho;
- itens em observação expiram após 14 dias; ativos após 30 dias sem sucesso ou uso; validados após 90 dias;
- a migração v1 → v2 consolida identidades fragmentadas e cria backup antes de alterar o estado local;
- resultado bruto não é persistido: somente SHA-256, duração opcional e metadados;
- possível segredo é recusado antes de criar o store.

O estado vive em `%APPDATA%\omni\learning\shortcuts.json` ou `OMNI_HOME`. O Git contém política,
schema, runtime e testes; a promoção para artefato portátil continua sendo outro ciclo.
