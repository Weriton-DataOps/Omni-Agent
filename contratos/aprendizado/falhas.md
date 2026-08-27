# Aprendizado com bugs e falhas

Este contrato implementa somente a seção 26 da especificação mestre.

```text
ação → falha real → assinatura em hash
                    ↓
          1–2 evidências distintas ─► observing
                    ↓ 3 ocorrências
                 candidate
                    ↓
          causa raiz + hipótese
                    ↓
        2 testes de correção consistentes
                    ↓
                   eval
                    ↓
      proposta no pipeline da seção 25
```

## Regras

- repetição do mesmo identificador de execução é deduplicada;
- uma falha isolada nunca cria regra, memória, procedimento ou skill;
- somente três ocorrências distintas da mesma ação, classe e assinatura formam um padrão candidato;
- a assinatura v2 separa ferramenta, classe, código de saída, família do comando, contexto e família segura do erro;
- caminhos, argumentos variáveis e entradas sensíveis são normalizados ou resumidos em hash antes da assinatura;
- o mesmo `Exit code 1` em `git`, `npm`, PowerShell ou outro contexto não forma um único padrão genérico;
- causa raiz e hipótese são registradas separadamente e não podem conter segredo;
- dois testes reais, distintos, bem-sucedidos e com resultado consistente são exigidos;
- uma candidata agenda automaticamente um subagente em segundo plano, sem nova pergunta ao proprietário;
- o trabalho é idempotente, tem lease e no máximo um candidato é reivindicado por turno;
- consistência compara o mesmo critério de aceitação; resumos reais podem variar entre execuções;
- diagnóstico e testes locais/reversíveis são autônomos; destruição, escrita remota, custo e nova
  permissão bloqueiam o trabalho e voltam ao proprietário;
- teste falho ou inconsistente devolve o padrão ao estado analisado;
- nova ocorrência após o eval invalida o resultado anterior;
- erro bruto, stack trace, comando completo e resultado bruto não são persistidos;
- eval aprovado gera somente proposta no pipeline 25, ainda sujeita a portabilidade e aprovação humana.

O estado vive em `%APPDATA%\omni\learning\failures.json` ou `OMNI_HOME`. O Git contém apenas política,
schema, runtime e testes.
