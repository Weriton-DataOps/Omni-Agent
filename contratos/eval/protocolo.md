# Protocolo de eval de personalidade v1

Implementa as seções 28 e 29 da especificação mestre para o único uso que hoje tem gate real: decidir
se uma personalidade candidata pode ser promovida.

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
camada humana ──────► julgamento do proprietário ──► promove ou recusa
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
proprietário revisa os critérios humanos
        ↓
decisão registrada no manifesto da personalidade
```

A geração das respostas não roda em `npm test` e não pertence a este runtime: exige modelo, custa
dinheiro e não é determinística. O que o repositório garante é a integridade da suíte e a pontuação
reprodutível de respostas já capturadas.

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
4. a decisão e a data entram no manifesto da personalidade.

Score automático maior sem revisão humana não promove nada. Ele apenas mostra que a candidata não
quebrou nenhuma regra objetiva.

## Fronteira

A suíte contém entradas sintéticas escritas para o teste. Conversa real, log e conteúdo pessoal não
entram aqui — a fronteira é a mesma da política de memória.
