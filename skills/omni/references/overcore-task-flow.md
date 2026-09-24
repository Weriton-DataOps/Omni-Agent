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
Para inspecionar uma pasta exata, use `kind: "workspace"` e seu URI `file:///C:/.../contratos`:
o alvo é literal, sem acrescentar subpastas e sem ampliar a autorização. `kind: "repository"`
aponta a raiz de um repositório e inspeciona sua subpasta `contratos`; se já terminar em
`contratos`, essa pasta é usada diretamente. A inspeção é não recursiva.

Cada premissa em `context.assumptions` é um objeto, nunca uma string:
`{"id":"assumption-scope","statement":"A análise deve cobrir somente esta pasta.","impactIfFalse":"O conjunto de arquivos inspecionados mudaria."}`.
Uma confirmação vale enquanto o conteúdo da premissa permanecer igual, inclusive em novas revisões.
Use `[]` quando o pedido já trouxer o escopo definido, sem inventar premissas.

O resultado de inspeção entrega `result.report = {mediaType,content,digest}`. Apresente esse conteúdo
ao proprietário; o cliente confere o SHA-256 antes de aceitar a entrega. Um digest isolado ou um
resumo do runtime não substitui o relatório. Critérios analíticos precisam de avaliação própria;
JSON legível não prova mapa nem análise de inconsistências. HTTP 400 de validação inclui o campo
rejeitado e o motivo, sem expor credenciais.
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

## Acompanhamento sem ruído e prova operacional

`follow` devolve `notification.changed` e `notification.ownerUpdate`. Quando for `silent`,
continue observando sem narrar cada consulta. O monitor emite somente mudanças de estado,
decisões, falhas ou resultado; horário da consulta e contador de polling não são novidade.
Use um único acompanhamento por fluxo e encerre-o no estado terminal. Se o proprietário
pedir status, responda com o estado observado, mesmo que não tenha mudado.

Na inspeção não recursiva, o critério operacional suportado é:
`Nenhum arquivo diretamente na pasta inspecionada foi criado, alterado ou removido durante a execução.`
O Overcore comprova esse critério com snapshots e telemetria, não com a palavra do modelo.
Mantenha a restrição de leitura; não retire o critério para obter sucesso. A prova cobre
entradas diretas da pasta, não alterações internas em subpastas nem outros projetos.

## Versão desta sessão

A marca `<omni-runtime-carregado>` do hook informa versão, integridade e momento da observação
da raiz realmente executada neste turno. É distinta da versão instalada e da invocação manual
de um operador. O registro por sessão fica em `runtime/loaded-sessions/<sha256-da-sessao>.json`.
Sem essa marca/readback, diga que a carga é desconhecida: ausência de SessionStart novo ou
datas do cache não provam, sozinhas, uma versão antiga. Após recarregar o host e retomar a
mesma conversa, confira a próxima marca. Isso não exige descartar o histórico da conversa.
