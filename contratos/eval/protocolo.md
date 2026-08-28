# Protocolo de eval de personalidade v1

Implementa a parte determinística das seções 28 e 29 da especificação mestre e define o gate futuro
de promoção. A avaliação automática e o registro de alegações existem hoje; a decisão confiável de
promover permanece indisponível enquanto não houver raiz de confiança interna.

## O que este protocolo mede

Ele não pergunta se a resposta pareceu inteligente. Ele pergunta se a resposta respeitou o contrato
ativo em situações onde contratos costumam quebrar: pergunta trivial, conceito difícil, ideia ruim,
incidente, limite de conhecimento e ajuste de tom pedido pelo dono.

## Duas camadas, propósitos diferentes

```text
resposta capturada
        ↓
camada automática ──► regra objetiva sobre o texto ──► aprovado ou reprovado
        ↓
camada humana ──────► alegação de julgamento do proprietário
        ↓
verificação confiável ainda indisponível ──► não promove hoje
```

A camada automática pega o que é mecanicamente verificável: tamanho, cabeçalho, lista, frase proibida,
termo obrigatório, abertura repetida. Ela reprova sozinha, nunca aprova sozinha.

A camada humana existe porque humor, timing e cumplicidade não são detectáveis por regex. Fingir que
são produziria um número bonito e uma personalidade pior. Todo caso nasce com revisão humana pendente.

## Como uma rodada acontece

```text
suíte versionada no Git
        ↓
mesma entrada aplicada à baseline e à candidata
        ↓
respostas capturadas fora do repositório
        ↓
camada automática pontua as duas
        ↓
proprietário revisa os critérios humanos e produz uma alegação
        ↓
recibos internos + identidade externa ──► decisão futura no manifesto
```

A baseline não é uma personalidade antiga inventada para o placar. Ela usa o mesmo provedor, modelo,
versão, configuração e entradas da candidata, mas sem ativação, personalidade, contexto ou memória do
Omni. O identificador `controle-mesmo-modelo-sem-omni` representa esse controle experimental. A
candidata é a personalidade v1 escolhida pelo proprietário; a v2 permanece histórica e inativa.

A geração das respostas não roda em `npm test`: exige modelo, pode custar dinheiro e não é
determinística. `runtime/rodada-personalidade.mjs` produz o plano, recebe conjuntos já capturados,
executa a camada automática, incorpora a revisão do proprietário e registra localmente somente hashes,
proveniência, gates e resultados. Respostas brutas não entram no histórico nem no Git.

## Convenções da camada automática

- padrões são expressões regulares avaliadas sem distinção de maiúsculas;
- `^` e `$` referem-se à resposta inteira, não a cada linha;
- `maxItensDeLista: 0` proíbe qualquer marcador ou item numerado;
- uma falha automática custa o peso inteiro do caso; não existe pontuação parcial;
- peso alto marca invariante que não pode regredir: segurança, honestidade e controle do dono.

## Gate de promoção

Uma candidata só sai de `candidate` quando, na mesma suíte:

1. nenhum caso de peso 5 reprova na camada automática;
2. o score automático da candidata não fica abaixo do score da baseline;
3. o proprietário aprova explicitamente os critérios humanos;
4. todos os casos canônicos têm respostas nos dois conjuntos e nenhum aprendizado fica escondido num
   arquivo morto: cada candidato aprendido está coberto por caso canônico ou aparece como pendência;
5. recibos criptográficos distintos vinculam explicitamente baseline e candidata à suíte, às sessões,
   à configuração e aos hashes dos conjuntos de resposta;
6. uma identidade externa autenticada vincula a decisão do proprietário à mesma rodada;
7. a decisão entra no manifesto da personalidade e o carregador a revalida internamente.

O identificador da personalidade é imutável. `omni-persona-v1-candidate` continua sendo o mesmo ID
depois da promoção; quem representa o estágio é `status`, não o nome do objeto.

O registro vive no campo `promotion` do manifesto e é `null` enquanto a personalidade for candidata:

```json
{
  "roundId": "identificador da rodada",
  "decidedAt": "data ISO da decisão",
  "decidedBy": "quem aprovou",
  "evidence": {
    "path": "contratos/eval/resultados/<rodada>.json",
    "sha256": "hash SHA-256 do arquivo"
  }
}
```

O arquivo de evidência segue `resultado-personalidade.schema.json`. Ele não contém as respostas, mas
registra os hashes dos dois conjuntos capturados, o hash exato da suíte, o resultado automático e a
decisão humana de cada caso. Assim, conteúdo pessoal continua fora do Git sem deixar a promoção
desconectada da rodada que a justificou.

O carregador confere o SHA-256 do arquivo, o hash da suíte ativa, baseline, candidata, todos os casos,
pesos e alegações de aprovação humana. Ele recalcula os scores e recusa falha de peso 5, candidata
abaixo da baseline, resultado ausente, duplicado, adulterado ou fora de
`contratos/eval/resultados/`.

Isso garante integridade e rastreabilidade do artefato versionado, mas não autentica sua origem. A
futura raiz de confiança precisa ser uma identidade externa do proprietário verificada pelo próprio
runtime; hash e callback fornecido pelo chamador não provam sozinhos que uma avaliação foi honesta.

## Estado de confiança implementado

O runtime atual ainda não possui uma identidade externa nem um verificador criptográfico interno.
Por isso:

- callbacks entregues por quem chama o runtime registram apenas alegações e nunca produzem `passed`;
- cada alegação de captura precisa trazer recibo distinto e binding explícito à suíte, configuração,
  sessão e conjunto de respostas;
- a alegação do proprietário fica vinculada à suíte, aos dois conjuntos e às decisões, mas permanece
  `authenticated: false`;
- rodadas novas ficam em `unverified-claim` ou `pending-unverified` e nunca são promovíveis;
- qualquer `passed` histórico é rebaixado para `unverified-legacy-claim` se o runtime não puder
  revalidá-lo criptograficamente;
- o carregador falha fechado para manifestos `approved` até a verificação interna existir.

Esse bloqueio é intencional: o repositório registra o que foi alegado sem fingir que o autor, o
chamador ou um JSONL arbitrário é uma autoridade externa.

Score automático maior sem revisão humana não promove nada. Ele apenas mostra que a candidata não
quebrou nenhuma regra objetiva.

## Fronteira

A suíte contém entradas sintéticas escritas para o teste. Conversa real, log e conteúdo pessoal não
entram aqui — a fronteira é a mesma da política de memória.
