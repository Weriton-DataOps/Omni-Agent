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
- A configuração local (`.env`) e as chaves nunca entram no git.
- MCP registrado no Claude Code no escopo de usuário, com o nome `whatsapp` (`http://127.0.0.1:2785/mcp`). A chave é de papel `operator`, presa à sessão pareada.

## Pasta `omni/` (nossa, não veio do projeto original)

- `omni/iniciar.ps1` — sobe o serviço em segundo plano. Não abre uma segunda instância se já houver uma escutando.
- `omni/parear.mjs` — vigia do QR para parear de novo, caso o celular desconecte a sessão.
- Inicialização automática no logon do Windows **não está configurada**. Depende de autorização explícita do proprietário.

## Alterações nossas

1. **`src/main.ts` — escuta só em `127.0.0.1`.** O original chamava `app.listen(port)` sem host, o que no Node abre todas as interfaces de rede. Agora o padrão é `127.0.0.1`; `BIND_HOST=0.0.0.0` reabre de propósito.
2. **`package.json` — `better-sqlite3` fixado em `12.11.1`** (o original pedia `^13.0.3`). A 13 traz binário N-API, mas não tem script de instalação, e o npm roda `node-gyp rebuild` sozinho, o que exige Visual Studio no Windows. A 12.11.1 baixa o binário pronto para Node 24 (win32-x64) e está dentro do `^12.0.0` que o TypeORM 1.1.1 declara suportar. O código não usa APIs exclusivas da 13.

Desligado pela configuração local, sem mudar código: consulta de releases (`UPDATE_CHECK_ENABLED=false`) e catálogo de plugins do projeto original (`PLUGIN_CATALOG_URL` apontado para endereço inexistente).
