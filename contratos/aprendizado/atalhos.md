# Aprendizado de atalhos

Este contrato implementa a seção 24 da especificação mestre.

```text
execução observada
      ↓
resultado verificável, guardado somente como hash
      ↓
1–2 sucessos consistentes ─► observing
      ↓
3 sucessos consecutivos ───► candidate
      ↓
nova execução de validação ─► validated
      ↓
promoção ───────────────────► NÃO pertence à seção 24
```

## Regras

- o atalho precisa remover ao menos uma etapa da sequência de referência;
- plano, hipótese, exemplo didático e execução sem resultado não contam como evidência;
- três sucessos consecutivos com o mesmo tipo de resultado criam candidata;
- falha ou resultado inconsistente zera a sequência e retira o status de candidata/validada;
- uma candidata precisa passar por outra execução explícita de validação;
- validação não cria memória confirmada, verbo, skill ou capacidade;
- resultado bruto não é persistido: somente SHA-256, duração opcional e metadados;
- possível segredo é recusado antes de criar o store;
- todo estado vive localmente em `%APPDATA%\omni\learning\shortcuts.json` ou `OMNI_HOME`.

O Git contém a política, o schema, o runtime e os testes. Objetivos, etapas e observações reais ficam
na máquina do proprietário.
