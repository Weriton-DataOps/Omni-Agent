# Ponte de autoridade Omni ↔ Overcore

## Responsabilidades

```text
Overcore                         Omni
--------                         ----
monta o plano                    avalia o crachá
emite o pedido     -- HTTP -->   aplica sua autoridade
valida a decisão  <-- JSON --   permite, restringe ou nega
faz enforcement                 não executa a tarefa
```

O núcleo `runtime/decisor-autoridade.mjs` não conhece Overcore, banco, SDK ou Task Manager. Ele
avalia um envelope neutro: teto concedido, ações, efeitos, risco e controles.

O arquivo `adaptadores/overcore-authority-http.mjs` é a única peça específica da integração. Ele:

1. recebe `AuthorizationRequest v1` por HTTP em loopback;
2. confirma destino e fingerprint;
3. projeta o pedido para o envelope neutro;
4. pede a decisão ao núcleo do Omni;
5. devolve `AuthorizationDecision v1` com fingerprint novo.

Nenhuma memória, personalidade, conversa ou estado privado do Omni atravessa essa fronteira.

## Primeiro corte

O primeiro gate permite apenas:

- leitura explicitamente concedida para o recurso exato;
- montagem interna do relatório;
- risco baixo e nenhum efeito material;
- controles pedidos preservados integralmente;
- decisão temporária de no máximo cinco minutos.

Escrita, publicação, segredo, privilégio, custo e risco acima de baixo são negados neste corte. Isso
não limita a autoridade futura do Omni: apenas mantém a primeira integração proporcional ao teste
somente leitura aprovado pelo proprietário.

## Transporte local

- endpoint: `POST /v1/authority/evaluate`;
- host: sempre `127.0.0.1`;
- porta padrão: `47832`, configurável no adaptador;
- autenticação: token efêmero ou segredo local com no mínimo 16 caracteres;
- o adaptador não persiste o corpo recebido nem a decisão bruta.
