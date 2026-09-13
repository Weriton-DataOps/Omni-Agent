# Correção do coordenador do Omni Desktop — 10/09/2026

## Implementado

- Card selecionado com destaque e `aria-current`; central com nome fixo, distinto do projeto.
- Identificação compacta da conversa, sessão e disponibilidade, sem recuperar o cabeçalho grande.
- Conversa com o Omni separada de “Histórico do VS Code”. Histórico com autor/horário, sem compactações, contexto de comandos ou mensagens técnicas atribuídas ao proprietário.
- Migração não destrutiva: a projeção antiga de mensagens externas fica em `archivedMessages`; os transcripts Claude originais não são alterados.
- Coordenador sem ferramentas de execução, recebendo contexto canônico do Omni e histórico da conversa. Respostas simples não geram subagentes; decisões/briefings usam saída estruturada validada.
- Fila persistente de planejamento; novos comandos podem ser recebidos enquanto outro está sendo organizado. Cada plano é salvo antes de produzir efeitos.
- Destino de projeto vinculado ao ID real; conversa externa não pode escolher outro editor nem iniciar executor local. Growth mantém a pasta canônica.
- Pedido externo persistido antes do envio, com origem, alvo, ID e estado. Tentativa registrada nunca é reenviada automaticamente depois de reinício ou entrega incerta.
- Monitor lê o retorno real correlacionado, distinguindo enviado, recebido, relatado e sintetizado; ausência da sessão é sinalizada sem inventar desfecho.
- Síntese pelo Omni na conversa de origem, incluindo evidência informada, pendência e recomendação. Relato do executor não é rotulado como verificação independente.
- Subagentes locais recebem síntese antes de ficarem prontos; o clique entrega no central de origem com escrita progressiva e remove o card. Relatório original permanece consultável.

## Validação

23 testes automatizados passaram, incluindo: conteúdo interno não vira mensagem do usuário; origem/horário preservados; plano inválido e troca de sessão rejeitados; fila de dois comandos; consumo idempotente; retorno somente na origem; migração preservando o histórico anterior; reinício marcando tentativa de envio como incerta.

Smoke Electron em armazenamento isolado passou: histórico real do Omni acessível sob demanda; card selecionado; janela não minimizada; relatório local animado somente no central; sem repetição ao voltar ao histórico. Design e áudio foram testados com mídia simulada, sem envio real de áudio.

O cenário real de leitura do Growth também passou: seleção visível, histórico separado, nenhuma compactação exibida e autoria/horário presentes. A navegação ignora respostas atrasadas de cliques anteriores.

## Aplicação local

Build atualizada carregada pelo launcher silencioso após verificar ausência de tarefas ativas no Desktop. Foi preservada a cópia `conversations.before-coordinator-20260910.json` na mesma pasta protegida do histórico, antes da migração. Os processos e projetos do VS Code não foram encerrados ou modificados.

### Teste externo real e limitado

Uma sessão Claude exclusiva de teste foi criada sem ferramentas, sem acesso a memória privada no prompt e com orçamento máximo de US$ 0,75. Planejamento, mensageiro e síntese também têm teto de US$ 0,75 por chamada. Nenhuma tarefa foi enviada às sessões reais Growth/Station/Omni.

A primeira tentativa mostrou uma falha do parser: confirmação e relatório na mesma mensagem eram reconhecidos somente como confirmação. O receptor respondeu corretamente, mas o ciclo não fechou. A falha foi corrigida e ganhou regressão automatizada.

A segunda tentativa concluiu o ciclo real: planejamento → envio → retorno → síntese exclusivamente na origem. Sessão de teste: `db836ba6-358a-4854-8efd-e9ac85681faa`; pedido: `0d39fc9a-291c-427d-b257-bbfe006bac29`. O resultado 56 foi verificado pelo teste; as outras conversas permaneceram sem mensagens. Receptor encerrado ao fim; nenhum projeto real usado como alternativa.

## Limites explícitos

- A observação utiliza o protocolo de retorno fornecido no briefing. Ausência de relatório correlacionado não é convertida em sucesso, mesmo que existam outros textos no histórico.
- A síntese avalia evidências apresentadas, mas não fornece uma verificação universal independente de deploys, bancos ou efeitos externos. A interface deixa essa diferença explícita.
- A fila de coordenação é persistida no armazenamento do Desktop. Esta mudança não migra conversas para PostgreSQL nem conecta esse novo fluxo a todos os eventos da porta neutra operacional do runtime.
- Não foram ativados Overcore ou Oracle, alteradas credenciais ou feitas correções no conteúdo de memória do banco.
- Não foi desligada nenhuma proteção da sessão destinatária. A autoridade e os limites da tarefa externa continuam pertencendo à sessão que executa.
