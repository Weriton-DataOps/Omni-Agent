# Pipeline de escrita de memória v1

Este contrato implementa as seções 20 e 21 da Especificação Mestre. Seu objetivo é aprender sem
transformar toda conversa em memória.

## Fluxo

```text
experiência do usuário
        ↓
extrair sinal persistente
        ↓
classificar
        ↓
validar privacidade, tamanho e escopo
        ↓
calcular confiança + importância + score
        ↓
descartar | transitória | recusar | armazenar candidata
```

## Classificação v1

| Tipo | Sinais de alta precisão |
|---|---|
| preferência | “prefiro”, “gosto de”, “quero que você” |
| procedural | “sempre que”, “quando eu disser”, “da próxima vez” |
| objetivo | “meu objetivo”, “quero construir”, “minha meta” |
| capability | “agora você consegue”, “funcionou quando” |
| semantic | “aprendi que”, “descobri que”, “fica definido” |
| episodic | “percebi que”, “na última vez”, “aconteceu quando” |

Ausência desses sinais produz descarte `no-memory-signal`. Frases marcadas como temporárias não são
persistidas. O classificador v1 é determinístico e prioriza precisão: é melhor deixar de sugerir uma
memória do que poluir o store.

## Validação e pontuação

- segredo aparente é recusado antes da criação do store;
- texto vazio, curto demais, longo demais ou comando é descartado;
- escopo precisa ser `user`, `project`, `task` ou `environment`;
- confiança estima a força do sinal linguístico;
- importância estima o valor operacional do tipo;
- score combina confiança, importância e especificidade;
- score abaixo de `0.60` não entra no store.

Uma inferência aceita nasce `candidate`. Declarações explícitas e estáveis do proprietário podem ser
confirmadas automaticamente quando o sinal e o score atingem o limiar do runtime; `lembrar` produz
confirmação direta e `confirmar` decide uma candidata existente. Repetições aumentam `occurrences`,
acrescentam evidência e reforçam o registro existente.

## Fronteira com o Git

```text
memória candidata/confirmada pessoal ──► store local

aprendizado reutilizável
    ↓ remover dados pessoais
    ↓ comprovar repetição e utilidade
    ↓ eval
    ↓ aprovação do proprietário
    └─► contrato, capacidade ou procedimento versionado no Git
```

O pipeline da seção 25 está ativo em `self-improvement-v1`. Ele aceita fonte reutilizável já validada,
executa eval, exige confirmação explícita de portabilidade e pode materializar artefatos revisáveis na
árvore-fonte. Nenhuma candidata executa `git commit` ou `git push`; versão e publicação continuam como
gates separados.
