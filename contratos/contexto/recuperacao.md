# Contrato de recuperação de memória

A seção 22 da especificação mestre é implementada por um ranking híbrido local. Nenhuma memória é
enviada a um serviço de embeddings e nenhuma chamada paga é necessária.

```text
intenção atual
      ↓
normalização + conceitos locais
      ↓
compatibilidade de escopo
      ↓
relevância semântica e lexical
      ↓
recência + frequência + confiança + importância + contexto
      ↓
ranking único
      ├── top 4  → fast
      └── top 10 → deep
```

## Regras

- somente memórias confirmadas participam;
- memória expirada ou de projeto/tarefa/ambiente diferente é excluída antes do ranking;
- metadados fortes não tornam uma memória irrelevante elegível: primeiro ela precisa atingir o
  `minimumIntentMatch`;
- fast e deep são recortes do mesmo ranking, nunca buscas independentes;
- empates são resolvidos por identificador para produzir resultado repetível;
- cada seleção incrementa `usageCount` de forma atômica, sem alterar a data semântica da memória;
- o diagnóstico registra identificadores e componentes da pontuação, nunca o texto integral da
  memória;
- o léxico em `recuperacao.json` é versionado e pode crescer por evidência, sem misturar dados
  pessoais ao código.

## Limite da versão v1

`hybrid-local-v1` usa conceitos explícitos, raízes morfológicas e similaridade textual. Ele reconhece
sinônimos declarados sem depender de rede. Embeddings neurais poderão ser adicionados como outro
provedor, mas não são fingidos nem necessários para considerar esta etapa funcional.

