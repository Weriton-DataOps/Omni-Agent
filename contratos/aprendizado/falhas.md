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
- cada teste precisa apontar para uma ação de verificação bem-sucedida da auditoria, posterior à análise e ao pedido de despacho;
- ação, trabalho, padrão, geração da evidência e hipótese formam um vínculo único; evidência de outro padrão ou de outra hipótese é recusada;
- cada comando de verificação recebe o marcador SHA seguro emitido por `falha-evidencias`; uma verificação posterior sem esse marcador não é elegível;
- uma candidata cria deterministicamente um trabalho e uma solicitação na porta neutra, sem nova pergunta ao proprietário;
- o adaptador torna o briefing visível e o trabalho continua obrigatório até um evento neutro `started` confirmar o início real; pedido de despacho não conta como execução;
- nomes de ferramenta, transporte e eventos do host pertencem ao adaptador; o núcleo conhece apenas capacidade, `delegationId` e estados do protocolo neutro;
- o `Stop` impede encerramento enquanto o despacho obrigatório ainda não começou, sem transformar a pendência em bloqueio terminal;
- o trabalho é idempotente, tem lease e no máximo um candidato é despachado por turno;
- falha técnica ou lease vencida reenfileira o trabalho com estratégia materialmente diferente;
- consistência compara o mesmo critério de aceitação; resumos reais podem variar entre execuções;
- diagnóstico, correção e testes locais/reversíveis são autônomos; somente uma expansão concreta de
  autoridade — destruição, escrita remota, chamada paga, nova permissão ou privilégio — cria
  `needs-owner`, sempre com efeito e alvo identificados;
- teste falho ou inconsistente devolve o padrão ao estado analisado;
- nova ocorrência após o eval invalida o resultado anterior;
- alegações legadas de sucesso sem esse vínculo migram para histórico não verificado e deixam de contar para o eval;
- erro bruto, stack trace, comando completo e resultado bruto não são persistidos;
- eval aprovado fecha a correção local e gera uma proposta separada quando houver aprendizado
  realmente portável; não transforma automaticamente um defeito específico em regra global.

O estado vive em `%APPDATA%\omni\learning\failures.json` ou `OMNI_HOME`. O Git contém apenas política,
schema, runtime e testes.
