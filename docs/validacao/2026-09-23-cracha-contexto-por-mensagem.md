# Crachá: contexto privado vinculado à mensagem

## Diagnóstico

O chip representava um slot temporário da conversa, não um anexo consumido pelo envio.
O coordenador consultava esse slot depois de enfileirar a mensagem. Isso deixava o chip
no compositor e permitia que um novo rascunho substituísse o contexto de um pedido anterior.
Além disso, `planConflict` recusava qualquer delegação enquanto houvesse anexo privado,
mesmo para a parte pública e independente da tarefa.

Outro problema: receber contexto não gerava recibo de cadastro, mas a resposta livre
podia dizer que acessos estavam guardados. O estado anterior não distinguia essas etapas.

## Alterações verificadas

- Identificador opaco por anexo; recebimento atômico por conversa e mensagem.
- Conteúdo original continua temporariamente na memória privada do processo principal.
- O compositor perde o anexo após aceitação. O histórico recebe apenas ID, tamanho e estado.
- Recibos distinguem recebido, contexto considerado, gravação confirmada, complemento,
  falha e indisponibilidade. “Considerado” significa contexto seguro processado pelo
  coordenador, não credencial usada ou conteúdo integral entregue ao modelo.
- Rascunho seguinte não é consumido pelo pedido anterior. Falha anterior à persistência
  devolve o mesmo anexo ao rascunho e remove o turno não aceito.
- Anexo expirado impede envio silencioso e preserva a mensagem digitada.
- Recebimento não valida nem cadastra automaticamente. O contexto seguro omite também
  valores não rotulados, que a antiga expressão de mascaramento podia deixar passar.
- Modelo continua sem receber valores originais e usa sessão sem persistência.
- A parte pública pode ser delegada sem encaminhar o anexo privado.
- Respostas privadas são conferidas antes da publicação para barrar afirmações de
  armazenamento/validação conhecidas sem recibo. Essa regra cobre padrões testados,
  não é uma prova de correção semântica de toda formulação possível do modelo.
- Recolher a janela não descarta anexos já recebidos para tratamento. Atualização do
  aplicativo aguarda tratamento, descarte ou expiração do contexto temporário.
- Ordem explícita posterior de cadastro pode referenciar o anexo privado recente,
  na mesma conversa e enquanto ele ainda estiver disponível. Isso não amplia o escopo
  do acesso nem confirma que o conector pode utilizá-lo.

## Uso por outra sessão: limite confirmado, não implementado nesta entrega

Foram inspecionados `src/adapters/windows/node-access-broker-client.ts`,
`scripts/omni-access-broker.ps1`, `scripts/omni-credential-verification.ps1` e o intake.
Existem cadastro, metadados, observações e verificação privada de alguns provedores.
O teste de PostgreSQL é uma prova de acesso de leitura, não um executor de SQL do projeto.

Não foi encontrada emissão/resgate de uma referência de uso limitada à sessão e tarefa,
injeção de credencial no executor, túnel SSH ou execução SQL do projeto pelo Crachá.
Uma referência de metadados do cadastro não oferece essas capacidades.

O coordenador agora recebe a matriz tipada da implementação a cada chamada, com
essas capacidades ausentes marcadas explicitamente. Isso evita depender de memória
ou de relatos antigos para descrever o que o Crachá pode fazer.

**Esta correção não entrega a ponte de uso pelo executor.** Ela exige implementação
própria: emissão por objetivo/operação/destino, prazo, consumo restrito, revogação,
adaptação confiável para cada provedor e recibo de execução sem retorno de segredo.
Não foi criado um identificador que apenas aparentasse dar acesso.

## Testes e aplicação local

- TypeScript e build aprovados.
- `npm test`: 238 testes, 238 aprovados.
- `npm run test:private-context-ui`: aprovado usando main, preload, IPC e renderer reais,
  com modelo e serviços externos simulados, sem credenciais reais.
- UI: anexo sai após envio; novo anexo permanece; envio só com anexo funciona; recibo
  acompanha a mensagem; dados sintéticos não entram em chat, snapshot, arquivo ou prompt;
  expiração preserva o texto e mostra erro.
- `node scripts/document-ui.mjs`: leitor Markdown continua aprovado.
- Captura inspecionada: `apps/omni-desktop/out/document-ui-0efVYL/private-context.png`.
- Recibo local observado: `fc91bb15e611`, aplicado em `2026-09-23T20:25:37.303Z`.

Nenhuma senha real foi lida ou exibida; nenhuma conexão SSH ou operação em banco de
projeto foi tentada. Sem commit, push ou deploy remoto.
