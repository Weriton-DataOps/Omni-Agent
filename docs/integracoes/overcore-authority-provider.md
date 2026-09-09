# Ponte de autoridade Omni <-> Overcore

## Responsabilidades

```text
Overcore                         Omni
--------                         ----
monta o plano                    avalia o cracha
emite o pedido     -- HTTP -->   aplica a autoridade delegada
valida a decisao  <-- JSON --    permite, restringe ou nega
faz enforcement                 nao executa a tarefa
```

O nucleo de autoridade do Omni nao conhece banco, SDK ou Task Manager. Ele avalia
um envelope neutro: teto concedido, acoes, efeitos, risco e controles.

O adaptador HTTP local e a unica peca especifica da integracao. Ele confirma o
destino e o fingerprint do pedido, projeta-o para o nucleo e devolve uma decisao
vinculada. Nenhuma memoria, personalidade, conversa ou estado privado do Omni
atravessa essa fronteira.

## Escopo ativo

O Omni permite leitura explicitamente concedida para o recurso exato, montagem
interna de relatorio e uma unica classe de escrita:

- `filesystem.modify` sobre recurso explicitamente concedido;
- `effectMode: journaled` e `effectClass: reversible-change`;
- risco maximo e risco da acao iguais a `medium`;
- os quatro controles: `checkpoint-before-mutation`, `verify-after-effect`,
  `reconcile-before-retry` e `revocation-check-before-effect`.

Publicacao, segredo, privilegio, custo, efeito irreversivel e qualquer fronteira
de expansao continuam negados. Nao e permissao ampla de escrita: e o primeiro
corredor reversivel para o Harness do Overcore.

## Transporte local

- decisao inicial: `POST /v1/authority/evaluate`;
- revalidacao antes de cada efeito: `POST /v1/authority/revalidate-effect`;
- host: sempre `127.0.0.1`;
- porta padrao: `47832`, configuravel no adaptador;
- autenticacao: token local de no minimo 16 caracteres;
- o adaptador nao persiste o corpo recebido nem a decisao bruta.

Na revalidacao, o Overcore envia o pedido original e a ligacao exata do efeito:
`actionId`, `effectKey`, `resourceRef` e `operation`. O Omni reavalia a politica
e a expiracao imediatamente antes da escrita. Falha de rede, expiracao, mudanca
de plano ou negacao atual devem bloquear o efeito no Overcore.

O status `revoked` significa apenas "nao esta valido agora". Uma lista duravel
de revogacoes individuais continua sendo extensao futura; esta versao nao finge
que possui esse estado.
