# Conversa → Overcore

Ação: `overcore --sessao <sessão Omni> --idempotencia <id estável do pedido> --entrada <arquivo JSON absoluto>`.
O Omni prepara o arquivo de entrada; o proprietário responde em linguagem natural, sem escrever JSON.
Credenciais não entram no documento. A conexão usa o descritor local do serviço e `OVERCORE_LOCAL_TOKEN`
ou `%LOCALAPPDATA%/Overcore/client-private.json` criado pelo launcher local;
`OVERCORE_URL` é uma opção de teste/endpoint explícito, somente HTTP loopback literal.

## Preparar

```json
{
  "operation": "prepare",
  "input": {
    "objective": "Objetivo literal, com seus limites",
    "context": { "summary": "Contexto pertinente", "references": [], "assumptions": [] },
    "knownConstraints": [],
    "knownAcceptanceCriteria": [],
    "discoveryAuthority": { "mode": "inspect-only", "grants": [] },
    "availableExecutionAuthority": {
      "mode": "proceed-within-scope", "grants": [],
      "expansionBoundaries": ["destructive", "irreversible", "financial", "privilege-expansion", "external-publication", "secret-access"]
    }
  }
}
```

Preencha referências e grants apenas para alvos/efeitos do pedido. Referência: `{refId,uri,kind,sensitivity}`.
Exemplo de descoberta: `{resourceRef:"ref-project",operations:[{name:"filesystem.read",effect:"read"}]}`.
Execução: `{resourceRef:"ref-project",operations:["filesystem.read"]}`. Identificadores têm no mínimo
8 caracteres. Escrever exige autorização e capacidade concretas; nenhum grant coringa.

O orçamento local padrão tem proveniência gerada pelo runtime: cinco minutos, uma tentativa,
paralelismo um e teto estimado SDK USD 0,75. O Preflight continua limitado a 60 segundos.
Critérios/saída ausentes permanecem ausentes; não chute informações para obter `ready`.

## Responder e continuar

```json
{
  "operation": "answer", "flowId": "flow-ID-DEVOLVIDO",
  "input": {
    "reportId": "RELATORIO-DEVOLVIDO",
    "answers": [{ "decisionId": "DECISAO-REAL", "optionId": "OPCAO-ESCOLHIDA" }],
    "changes": {
      "context": { "summary": "Contexto completo incorporando as respostas", "references": [], "assumptions": [] },
      "knownAcceptanceCriteria": [],
      "executionHints": { "expectedOutputKind": "no-artifact" }
    }
  }
}
```

Os nomes em maiúsculas são marcadores didáticos, não IDs executáveis. Responda cada decisão uma vez.
`changes` substitui os campos fornecidos integralmente: preserve referências, restrições e contexto
válidos. Materialize somente as escolhas efetivas. Um "ok" ambíguo não autoriza selecionar todas as
recomendações. Uma intenção nova usa chave nova; uma resposta usa o mesmo fluxo.

`ready` admite automaticamente o pedido já autorizado. Autoridade do plano continua sendo avaliada
pelo Omni. A admissão não é conclusão: consulte `{operation:"follow",flowId}` e leia o resultado.
Cancelamento explícito: `{operation:"cancel",flowId}`. Lista da conversa: `{operation:"list"}`.
Timeout: repita a mesma ação/entrada ou `follow`, nunca gere outra chave para contornar a incerteza.

O Desktop observa tarefas admitidas e apresenta retornos no chat de origem. No plugin, a sessão usa
`follow` durante o acompanhamento e ao retomar; o hook não executa tarefas nem abre polling infinito.
O estado corrente vem do Overcore; o arquivo local é só vínculo/cache recuperável, fora do Git.
