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

A proteção vem do escopo, não só do segredo. Provado com testes negativos: leitura tentando enviar, envio para outro destino e envio pela sessão pessoal são recusados (HTTP 401/403), e nenhuma mensagem recusada chegou a sair.

## Ponte WhatsApp ↔ sessões (`omni/ponte.mjs`)

- Mensagem do dono ao bot, sem citação → a sessão central do Omni responde (sessão persistente no repositório do Omni).
- Resposta citando uma mensagem assinada por uma sessão → aquela sessão responde. Sessões do Weriton (ex.: VS Code) respondem numa cópia (`--fork-session`), para não alterar o histórico da janela.
- Só mensagens recebidas do número do dono acionam sessões; qualquer outro contato é ignorado.
- As sessões rodam sem ninguém para aprovar permissões: o que pediria aprovação é recusado.
- `/pausa` suspende a ponte; `/volta` retoma. Corte total: desconectar o aparelho no celular do bot.
- O livro `ponte-ledger.jsonl` registra qual sessão assinou cada mensagem; o log não guarda conteúdo.

## Pasta `omni/` (nossa, não veio do projeto original)

- `omni/iniciar.ps1` — sobe serviço e ponte em segundo plano, sem duplicar instância. Chamado no logon por um atalho na pasta Inicializar do Windows.
- `omni/config.mjs` — caminhos, sessões, dono, chaves do cofre e envio ao dono.
- `omni/cofre.ps1` e `omni/cofre.mjs` — leitura e gravação no Gerenciador de Credenciais; o segredo passa só por stdin/stdout.
- `omni/parear.mjs` — QR vivo para parear (`--bot` para a sessão do bot).
- `omni/chaves.mjs` — recria as chaves com escopo, grava no cofre e prova cada uma pelos dois lados.
- `omni/mcp.mjs` — servidor MCP: ferramentas de leitura e `enviar_para_weriton`, assinada com projeto e id da sessão.
- `omni/ponte.mjs` — a ponte; `--simular "texto" [--citar <id>]` testa sem mensagem real.

## Alterações nossas

1. **`src/main.ts` — escuta só em `127.0.0.1`.** O original chamava `app.listen(port)` sem host, o que no Node abre todas as interfaces de rede. Agora o padrão é `127.0.0.1`; `BIND_HOST=0.0.0.0` reabre de propósito.
2. **`package.json` — `better-sqlite3` fixado em `12.11.1`** (o original pedia `^13.0.3`). A 13 traz binário N-API, mas não tem script de instalação, e o npm roda `node-gyp rebuild` sozinho, o que exige Visual Studio no Windows. A 12.11.1 baixa o binário pronto para Node 24 (win32-x64) e está dentro do `^12.0.0` que o TypeORM 1.1.1 declara suportar. O código não usa APIs exclusivas da 13.

Desligado pela configuração local, sem mudar código: consulta de releases (`UPDATE_CHECK_ENABLED=false`) e catálogo de plugins do projeto original (`PLUGIN_CATALOG_URL` apontado para endereço inexistente).
