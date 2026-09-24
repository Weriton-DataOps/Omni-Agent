# Leitor Markdown independente no Omni Desktop

## Resultado

Referências `.md` do chat agora abrem um leitor em uma janela independente do Omni.
O chat permanece aberto com seu rascunho. Não é necessário abrir o VS Code, iniciar
um servidor de documentos ou regenerar respostas antigas.

O leitor permite visualizar o Markdown formatado ou original, atualizar a leitura
do arquivo e fechar com botão ou Escape. Renderiza títulos, tabelas, listas com
continuação e hierarquia, citações e código. Reabrir o documento reutiliza sua janela.

## Escopo e origem

- Caminhos relativos, absolutos dentro do projeto, links Markdown e referências entre crases.
- A pasta pertence à conversa de origem do relatório, não necessariamente ao chat onde ele aparece.
- Links internos para outros documentos usam a pasta do arquivo como base, mantendo a raiz autorizada.
- Arquivo ausente gera erro explícito, sem pesquisar outras pastas por semelhança de nome.
- Conferido no estado local: a sessão `53060f5c-0037-43d7-8187-dbd7e2da8745` aponta para
  `C:\Users\wp.santos\Documents\Reengenharia_station_growth`; o documento
  `planejamentos/fase1-station.md` existe e tem 15.011 bytes. Seu início foi lido para
  conferir tabelas e listas reais. Nenhum arquivo desse projeto foi alterado.

## Segurança

Leitura de Markdown UTF-8 de até 2 MB, sem escrita, envio ao modelo ou persistência em memória.
Validação da raiz e do destino real; travessia, UNC explícito e symlinks externos rejeitados.
Janela com sandbox, contextIsolation, sem Node no renderer e preload restrito ao leitor.
IPC valida remetente, frame e URL da janela. HTML permanece texto escapado; imagens remotas
não são carregadas. Links HTTP(S) só abrem por clique explícito, após validação do protocolo.

Decisões apoiadas na documentação oficial: [segurança no Electron](https://www.electronjs.org/docs/latest/tutorial/security).

## Verificação realizada

- `npm run check`: aprovado.
- `npm test`: **228 testes aprovados, zero falhas**.
- `npm run test:document-ui`: aprovado com janela Electron real e provedores externos isolados.
- E2E confirma link de resposta antiga, origem do executor diferente do chat central, janela
  independente, rascunho preservado, tabela renderizada, HTML inerte, ausência da API do chat
  no leitor, links relativos, reutilização de janela, releitura, erro de arquivo ausente,
  rejeição de saída do projeto e fechamento por Escape.
- Capturas inspecionadas: `apps/omni-desktop/out/document-ui-AFFMrb/document-reader.png`
  e `document-link.png`. Artefatos locais de teste, ignorados pelo Git.
- Build aplicada automaticamente pelo Desktop: recibo `57f7c6c136ec`, em
  `2026-09-23T20:00:14.817Z`; processo Electron reaberto às 17:00:15 (São Paulo).

### Checagem adicional, fora do fluxo do leitor

O teste antigo `node scripts/returns-ui.mjs` falhou na asserção de posição fixa durante
a animação de rolagem. Reproduziu também usando o renderer salvo às 13:35, anterior
a esta alteração (`out/returns-ui-B84vNb/app/renderer`): posição 215 → 134 em 250 ms.
Essa checagem não está aprovada; não é tratada como regressão comprovada dos links.
A animação de retorno não foi alterada nesta entrega. O script aceita
`OMNI_TEST_RENDERER_DIR` apenas para permitir essa comparação de teste.

Sem commit, push, publicação remota ou alteração das conversas reais pelo teste.
