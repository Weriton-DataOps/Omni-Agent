# Proveniência — serviço WhatsApp do Omni

Cópia congelada do projeto **OpenWA**, trazida para dentro do Omni sem vínculo com o repositório original.

| Campo | Valor |
| --- | --- |
| Origem | `github.com/rmyndharis/OpenWA` |
| Commit copiado | `036dd70f9632546a00400d121659dc97f811ffb2` (versão 0.23.7) |
| Data da cópia | 2026-09-28 |
| Licença | MIT — o aviso de copyright original está preservado em `LICENSE` |

## O que é esta cópia

- Não é fork, submódulo nem dependência: não há `.git`, remote ou atualização automática. Mudanças no projeto original não chegam aqui.
- Atualizar é uma decisão deliberada: baixar um commit novo, comparar e substituir de propósito.
- Removido por não fazer parte da execução: `.github`, `charts`, `test`, `sdk`, arquivos Docker, `CHANGELOG`, `CONTRIBUTING`, `CODE_OF_CONDUCT`, `SECURITY` e a pasta `docs` (exceto `docs-mcp/24-mcp-integration.md`).
- O código em `src/`, `scripts/` e `dashboard/` está como veio. Qualquer alteração nossa deve ser registrada abaixo.

## Como o Omni usa

- Motor Baileys (WebSocket, sem Chromium), escutando só em `127.0.0.1:2785`.
- MCP ligado em modo **somente leitura** (`MCP_READONLY` fica verdadeiro).
- Dados pessoais (sessão do WhatsApp, banco SQLite, mídia) ficam fora do repositório, em `%APPDATA%\omni\whatsapp`.
- A configuração local (`.env`) nunca entra no git. As chaves ficam no Gerenciador de Credenciais do Windows.
- MCP registrado no Claude Code no escopo de usuário com o nome `whatsapp`, como servidor **stdio** (`omni/mcp.mjs`). A configuração do Claude Code não guarda chave nenhuma.

## Duas sessões, dois papéis

| Sessão | Número | Papel | Arquivo |
| --- | --- | --- | --- |
| pessoal | o celular do Weriton | o Omni **lê** as mensagens dele; nada é enviado por ela | `%APPDATA%\omni\whatsapp\sessao.id` |
| bot | segundo número, do Omni | canal de conversa: recebe comandos do Weriton e responde | `%APPDATA%\omni\whatsapp\sessao-bot.id` |

Fluxo único: **bot → número pessoal do Weriton**, e ele responde dali. Nenhuma mensagem sai pela sessão pessoal, nem para ele mesmo. O número do dono (único contato que o bot escuta e o único com quem ele fala) está em `%APPDATA%\omni\whatsapp\dono.txt`, fora do git.

## Chaves (no cofre do Windows)

| Chave (cofre) | Papel | Escopo |
| --- | --- | --- |
| `omni/whatsapp/admin` | admin | tudo; só para scripts de manutenção (`chaves.mjs`, `parear.mjs`) |
| `omni/whatsapp/leitura` | viewer | as duas sessões, só leitura; a API recusa envio a este papel |
| `omni/whatsapp/envio` | operator | só a sessão do bot e só a conversa com o dono |
| `omni/whatsapp/terceiros` | operator | só a sessão do bot, qualquer conversa; usada apenas por `terceiros.mjs`, que exige autorização pontual |

A proteção vem do escopo, não só do segredo. Provado com testes negativos: leitura tentando enviar, envio para outro destino e envio pela sessão pessoal são recusados (HTTP 401/403), e nenhuma mensagem recusada chegou a sair.

## Ponte WhatsApp ↔ sessões (`omni/ponte.mjs`)

- Mensagem do dono ao bot, sem citação → a sessão central do Omni responde (sessão persistente no repositório do Omni).
- Resposta citando uma mensagem assinada por uma sessão → aquela sessão responde. Sessões do Weriton (ex.: VS Code) respondem numa cópia (`--fork-session`), para não alterar o histórico da janela.
- Só mensagens recebidas do número do dono acionam sessões; qualquer outro contato é ignorado.
- Sessões acionadas pelo número do dono rodam com as ferramentas liberadas por lista (`--allowedTools`), no modo `default`, por decisão explícita dele em 28/09/2026. Em `bypassPermissions` os recados da central para as janelas do VS Code (modos acceptEdits/auto) ficavam segurados esperando aprovação na tela. Comando endereçado a um projeto vai para a janela aberta dele (SendMessage); resposta citada a mensagem de janela também. Sem janela aberta, `delegado.mjs`.
- `/pausa` suspende a ponte; `/volta` retoma. Corte total: desconectar o aparelho no celular do bot.
- O livro `ponte-ledger.jsonl` registra qual sessão assinou cada mensagem; o log não guarda conteúdo.
- Toda mensagem recebe na hora um aviso curto ("⏳ Recebi, verificando…") e, se algo falhar, o erro. Ao ligar, a ponte recupera mensagens do dono dos últimos 30 min ainda sem resposta.
- Áudio do dono é transcrito (OpenAI `gpt-4o-transcribe`); imagem é salva em `%APPDATA%\omni\whatsapp\midia` (apagada após 7 dias) e aberta pela sessão.
- Escrito ou áudio é decidido pela ponte (`omni/formato.mjs`), não pelo modelo, nesta ordem: pedido explícito ("em áudio" / "por escrito"), espelho (áudio recebido volta em áudio), padrão escrito. Numa resposta em áudio, o que é para copiar ou consultar (código, comando, link, caminho, número, lista, detalhe além de ~1 min de fala) vai escrito logo depois. Avisos e erros são sempre escritos. Voz `verse` a 1,25x (`gpt-4o-mini-tts`, ogg/opus).
- O MCP `whatsapp` continua sendo a cerca de envio: lê, fala com o dono e só manda para terceiros com a autorização pontual de `terceiros.mjs`, independentemente das permissões da sessão.

- Mensagens seguidas do dono esperam 5 s de silêncio e viram um pedido só (ex.: áudio encaminhado + instrução sobre ele), com um aviso só.
- "Fala dele" é o que ele digita ou grava (tipo `voice`). Áudio encaminhado ou arquivo (tipo `audio`) é conteúdo de outra pessoa: vai para análise, nunca como pedido, espelho de áudio ou autorização. O serviço não expõe a marca "encaminhada"; a distinção é pelo tipo.

## Envio a terceiros (`omni/terceiros.mjs`)

Definido pelo Weriton em 28/09/2026: o bot pode mandar mensagem a outra pessoa da agenda dele, sempre com autorização pontual. Ferramenta MCP `enviar_para_contato`. Travas no código:

- a autorização é uma mensagem dele (texto ou áudio gravado), no chat do bot, com no máximo 2 h, que pede o envio e nomeia a pessoa (ou responde "pode" a uma mensagem do bot que nomeia);
- nome parcial vale se, pela agenda e pela conversa dos últimos 3 dias, apontar para a mesma pessoa; ambíguo não envia e devolve as opções;
- uso único (`terceiros-ledger.jsonl`); conversa com a pessoa mudou depois do pedido → para e pede pedido novo;
- sai do número do bot, com a chave `omni/whatsapp/terceiros` (operator, só a sessão do bot), abrindo com "Aqui é o Omni, assistente do Weriton."; ele recebe a confirmação do texto enviado;
- quem recebe e responde ganha um aviso fixo de canal só informativo (no máximo 1 a cada 12 h) e a resposta é repassada ao Weriton.

## Voz (`omni/voz.ps1`)

Usa a chave OpenAI do Omni desktop (DPAPI, `%APPDATA%\omni\access\openai-realtime.dpapi`). Entrada e saída só por stdin/stdout em base64; a chave não sai do processo. O MCP oferece `transcrever_audio` para qualquer sessão ler áudios de conversas e grupos.

## Cota da API

O serviço limita requisições por IP, e tudo aqui vem de `127.0.0.1`: ponte, MCP e envio dividem a mesma cota. O padrão (1000/h) era esgotado pela ponte em ~25 min e cegava tudo, até as respostas. A configuração local sobe para `RATE_LIMIT_LONG_LIMIT=30000`, `RATE_LIMIT_MEDIUM_LIMIT=1000`, `RATE_LIMIT_SHORT_LIMIT=30` (o serviço só escuta em loopback). A ponte faz uma consulta por ciclo, sem mídia embutida, e as chamadas esperam e repetem em 429 (cota) e 409 (número reconectando).

## Pasta `omni/` (nossa, não veio do projeto original)

- `omni/iniciar.ps1` — sobe serviço e ponte em segundo plano, sem duplicar instância. Chamado no logon por um atalho na pasta Inicializar do Windows.
- `omni/config.mjs` — caminhos, sessões, dono, chaves do cofre e envio ao dono.
- `omni/cofre.ps1` e `omni/cofre.mjs` — leitura e gravação no Gerenciador de Credenciais; o segredo passa só por stdin/stdout.
- `omni/parear.mjs` — QR vivo para parear (`--bot` para a sessão do bot).
- `omni/chaves.mjs` — recria as chaves com escopo, grava no cofre e prova cada uma pelos dois lados.
- `omni/mcp.mjs` — servidor MCP: ferramentas de leitura, `transcrever_audio` e `enviar_para_weriton`, assinada com projeto e id da sessão.
- `omni/voz.ps1` — transcrição e síntese de voz pela OpenAI.
- `omni/formato.mjs` — critérios de escrito ou áudio e divisão da resposta em fala e parte escrita.
- `omni/avisar.mjs` — qualquer sessão fala com o Weriton pelo terminal (`node avisar.mjs "texto"`), para janelas abertas antes do MCP existir; assina com projeto e sessão.
- `omni/delegado.mjs` — delega trabalho a um projeto em segundo plano (sessão na pasta do projeto, permissões liberadas) e entrega o resultado no WhatsApp do dono; substitui o canal entre sessões, que segura recados em janelas de modo de permissão diferente.
- `omni/relatorio.mjs` — relatórios: HTML vira imagem ou PDF pelo Edge sem janela (perfil isolado) e segue ao dono pela ferramenta MCP `enviar_arquivo_para_weriton`; também manda .png/.jpg/.pdf prontos.
- `omni/terceiros.mjs` — envio a terceiros com autorização pontual, aviso informativo e repasse de respostas.
- `omni/ponte.mjs` — a ponte; `--simular "texto" [--citar <id>] [--audio <ogg>] [--imagem <arquivo>]` testa sem mensagem real.

## Alterações nossas

1. **`src/main.ts` — escuta só em `127.0.0.1`.** O original chamava `app.listen(port)` sem host, o que no Node abre todas as interfaces de rede. Agora o padrão é `127.0.0.1`; `BIND_HOST=0.0.0.0` reabre de propósito.
2. **`package.json` — `better-sqlite3` fixado em `12.11.1`** (o original pedia `^13.0.3`). A 13 traz binário N-API, mas não tem script de instalação, e o npm roda `node-gyp rebuild` sozinho, o que exige Visual Studio no Windows. A 12.11.1 baixa o binário pronto para Node 24 (win32-x64) e está dentro do `^12.0.0` que o TypeORM 1.1.1 declara suportar. O código não usa APIs exclusivas da 13.

Desligado pela configuração local, sem mudar código: consulta de releases (`UPDATE_CHECK_ENABLED=false`) e catálogo de plugins do projeto original (`PLUGIN_CATALOG_URL` apontado para endereço inexistente).
