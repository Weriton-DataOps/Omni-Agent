# Auditoria e correção do roteamento do Omni Desktop — 10/09/2026

## Contrato implementado

### Entrega visual ao clicar — ajuste posterior

O relatório recém-consumido aparece progressivamente no central, com o aviso “Escrevendo resultado do subagente…” e depois “Resultado recebido no chat central”. A animação é somente visual: o texto inteiro já está persistido. Há opção de mostrar tudo, respeito à preferência de movimento reduzido e nenhuma repetição da animação ao retornar ao histórico. O teste Electron verifica texto inicialmente parcial, armazenamento completo durante a escrita, confirmação de chegada, isolamento e ausência de replay.

- O card principal abre o chat central, separado das conversas externas.
- Pedidos no central criam tarefas filhas. O central fica disponível enquanto o subagente trabalha.
- A borda esquerda azul anima durante a execução. Sucesso recebe check; falha/interrupção recebe indicação distinta, nunca check de sucesso.
- O resultado fica na fila até o clique. O clique entrega o relatório exclusivamente ao chat central de origem, navega até ele e persiste o consumo. Repetir o clique não duplica a mensagem. O histórico da tarefa é preservado, embora o card desapareça.
- Selecionar outro chat durante a execução não muda o destinatário do resultado.
- Cards do VS Code identificam sessões Claude reais por ID e diretório. O histórico é lido da sessão e atualizado periodicamente. Clicar não abre/minimiza janelas.
- Comandos dessas conversas usam SendMessage para a sessão vinculada. O processo local é somente mensageiro: não recebe ferramentas de execução nem usa um agente local como alternativa quando a sessão está ausente.
- Projeto aberto sem Claude ativo não é apresentado como uma conversa operacional. Overcore e Oracle continuam sem integração, conforme o escopo combinado.

## Causas encontradas

1. O envio em conversa externa seguia o mesmo executor local usado pelo Omni. Associar somente o diretório do projeto não ligava a conversa à sessão do editor.
2. O cadastro da extensão informava principalmente projetos abertos e sessões criadas por seu próprio handoff, não todas as sessões Claude ativas.
3. O renderer misturava ações de cards e podia delegar novamente durante um envio em conversa externa. O tratamento assíncrono também podia alterar a navegação após o usuário trocar de chat.
4. Texto intermediário e relatório final de tarefas não tinham separação explícita. Agora `resultText` guarda a entrega final, quando disponibilizada pelo executor.

## Evidência das sessões e interação anterior

Foram identificadas sessões `claude-vscode` vivas para Omni (`60e8c289…`, `omni-0b`) e Station (`d145f2f2…`, `station-5a`). A leitura retornou respectivamente 40 e 68 mensagens. Não foi encontrada sessão Claude ativa do Overcore na inspeção, embora seu projeto estivesse aberto.

A varredura dos históricos encontrou SendMessage em sessões dos projetos Growth, Station, Hub e DW7. Exemplos do Growth: sessões `7820293f…` e `2c65c611…`, com respostas para `wp-santos-f9` e `wp-santos-77` sobre estado de cards e evidências da LP. Isso demonstra o padrão de interação entre sessões pedido pelo proprietário. Não foi encontrado SendMessage no transcript atual `60e8c289…` do Omni; não se atribui a ele essa evidência.

O transporte segue o recurso oficial de mensagens entre sessões do Claude, mantendo os controles de recebimento do destino: https://code.claude.com/docs/en/cross-session-messaging . Não são lidas chaves de autenticação das sessões nem implementado um desvio do protocolo privado.

## Validação

- 18 testes automatizados passaram: isolamento central/externo, consumo idempotente, persistência, bloqueio de execução local em conversa externa, destinatário/conteúdo fixados pelo mensageiro e recusa de envio duplicado, entre os testes anteriores.
- Teste Electron com armazenamento isolado: abrir conversa externa, clicar em tarefa concluída, verificar relatório somente no central, card removido, conversa externa intacta e consumo gravado em disco.
- Readback real no mesmo teste: card `omni-0b` abriu 40 mensagens da sessão correta e a janela não foi minimizada.
- A sessão real Omni confirmou uma consulta SendMessage de disponibilidade (`notify_when_idle`, sem `message`). Esse teste verifica o canal, mas não executa uma tarefa no editor.
- Ainda não houve teste ponta a ponta com uma tarefa real enviada ao editor e sua conclusão. Não confundir entrega ao canal com conclusão do trabalho remoto.
- A build final passou no TypeScript e no smoke de design/áudio simulado. O smoke de roteamento/readback foi repetido com sucesso após a última alteração. A instância anterior do Desktop foi reiniciada pelo launcher silencioso somente após conferir ausência de conversas em execução ou aguardando permissão; nenhum processo do VS Code foi encerrado.

O mensageiro tem limite de US$ 0,75 por chamada e não repete automaticamente envios sem confirmação. O trabalho remoto pertence à sessão do VS Code e às permissões dela; o limite do mensageiro não constitui limite de custo do trabalho remoto.

## Inventário real do PostgreSQL — somente leitura

Consulta via `scripts/read-omni-database.ps1`, credencial obtida da entrada específica do cofre sem exibir a senha, transação READ ONLY encerrada com ROLLBACK. Banco `omni`, porta 5433, aproximadamente 9 MB.

| Conteúdo | Quantidade |
| --- | ---: |
| Memórias confirmadas | 129 |
| Memórias candidatas | 3 |
| Registros de importação | 238 |
| Missões | 1 |
| Eventos de missão | 1 |
| Versões de credencial | 1 |
| Eventos de credencial | 2 |

As confirmadas são 109 preferências, 12 semânticas, 7 procedurais e 1 objetivo; as candidatas são 3 procedurais. A missão “Concluir a implantação durável do Omni.” permanece `in-progress`. A credencial PostgreSQL está cadastrada como ativa e sem vencimento. Migrations 001, 002 e 003 constam aplicadas.

**Achado pendente:** memórias reais contêm frases idênticas a fixtures de `testes/hook-contexto.test.mjs`, incluindo “Prefiro mapas antes de explicações longas” e a série numerada “evidência detalhada”. A sincronização de uma casa de teste com o broker real é uma causa provável: `runtime/sincronizacao-memoria-duravel.mjs` instancia o cliente do broker sem distinguir essa origem. A correspondência textual foi verificada; a cadeia completa de cada importação ainda não foi reconstruída. Não foram apagadas, recategorizadas ou deduplicadas memórias nesta rodada.

O PostgreSQL guarda memória/missões; os chats do Desktop continuam no armazenamento local `desktop/conversations.json`, e os chats do editor são lidos do histórico Claude. Esta correção não migra conversas para o banco nem altera credenciais/schema.
