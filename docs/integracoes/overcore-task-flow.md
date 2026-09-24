# Fluxo conversacional com o Overcore

O Omni conversa, reúne decisões e acompanha. O Overcore é o ambiente externo que prepara e executa
a tarefa. Esta ligação não incorpora seu Task Manager, SDK ou banco ao núcleo do Omni.

## Peças ligadas

- `src/adapters/overcore/task-flow.ts`: cliente HTTP, revisões, vínculo persistente, admissão e leitura.
- `runtime/overcore-task-flow.mjs`: porta compartilhada, contexto resumido e observação.
- `scripts/omni.ps1 overcore`: entrada do plugin; formato em `skills/omni/references/overcore-task-flow.md`.
- Hook por turno: recupera índice da conversa, mantendo a personalidade no orçamento de contexto.
- Desktop: coordenador envia `prepare/answer/follow/cancel/list`; observador retorna ao chat original.

Persistência local: `OMNI_HOME/runtime/external-task-flows` (normalmente `%APPDATA%/omni`). Não é
memória pessoal e não sobe ao Git. É o vínculo com o estado canônico no banco do Overcore.
Uma retomada usa os mesmos IDs; outra conversa não consegue responder/cancelar esse fluxo.

O resultado final vem da consulta à tarefa, com vínculo de identidade e fingerprint. Um erro HTTP
preserva o vínculo; não significa que a operação remota deixou de acontecer. Retome o mesmo fluxo.
No Desktop, retornos são deduplicados de forma persistente. No plugin, a sessão consulta o resultado;
o hook não gera loops de execução nem publica mensagens quando a sessão está fechada.

## Configuração local

O serviço externo precisa estar ativo. Seu launcher fica no projeto Overcore em `scripts/start-local.mjs`.
Ele utiliza o login Claude existente e a conexão PostgreSQL operacional, sem credenciais em mensagens.
O Omni resolve o endpoint por `%LOCALAPPDATA%/Overcore/runtime.json` e o token pelo arquivo privado
`client-private.json` na mesma pasta. `OVERCORE_URL`/`OVERCORE_LOCAL_TOKEN` podem substituir isso
em testes. O token não entra no contexto, nos documentos da tarefa nem no repo.

O runtime gera o orçamento padrão: cinco minutos, uma tentativa, paralelismo um, teto estimado SDK
USD 0,75, com fingerprint local. Não é uma prova de cobrança adicional da assinatura. Mudança de
orçamento deve preservar uma proveniência verdadeira. Permissões continuam limitadas ao pedido real.

## Validação e uso

Build local compilada; testes do cliente, contexto, retorno Desktop e integração real com PostgreSQL
e Claude OAuth passaram. O ensaio real usa escolhas roteirizadas, não mede personalidade nem garante
o acerto do roteador em toda conversa. Ainda cabe validar com o proprietário.

Na build Desktop nova, um teste simples é pedir:

> Peça ao Overcore para inspecionar somente os arquivos *.schema.json diretamente na subpasta
> contratos de C:\Users\wp.santos\Documents\Overcore, sem alterar arquivos. Quero primeiro as
> decisões que faltam para definir a verificação e a entrega.

Responda ao pacote no próprio chat. Depois das escolhas completas, deve aparecer o recibo da mesma
tarefa e, ao terminar, um único resultado verificado. Nenhuma nova sessão de projeto deve ser criada.

A versão carregada importa: aplicar a build local do Desktop mantém seu histórico, mas reinicia o
processo. Não reiniciamos sessões abertas nesta implementação. A release coordenada é instalada
separadamente do carregamento: somente um próximo `SessionStart` da mesma raiz, versão e
fingerprint confirma que o host passou a executar a versão nova.

### Fechamento técnico de 23/09/2026

- 43/43 testes focados passaram em execução serial: hook, composição de contexto e cliente
  Overcore TypeScript/runtime. O protocolo externo não ocupa conversas sem pedido/fluxo Overcore;
  briefings executáveis de autocorreção permanecem inteiros antes de índices recuperáveis.
- Os ensaios Electron isolados de retornos, colagem, leitor e contexto privado passaram.
- A release 0.24.1 consolida o fluxo externo, a correção do lock concorrente no Windows e o
  executor privado por Crachá. Sua instalação no cache é verificável pela versão e fingerprint;
  o carregamento continua sendo confirmado apenas pelo próximo `SessionStart`, sem encerrar
  sessões abertas para forçar esse efeito.
- Nenhuma sessão do proprietário foi encerrada manualmente. A preferência existente do Desktop
  de aplicar builds automaticamente foi preservada, não criada por esta integração.
