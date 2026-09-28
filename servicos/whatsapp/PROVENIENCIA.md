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
- MCP registrado no Claude Code no escopo de usuário com o nome `whatsapp`, como servidor **stdio** (`omni/mcp.mjs`). A configuração do Claude Code não guarda chave nenhuma.

## Chaves (todas presas à sessão pareada)

| Chave | Papel | Escopo | Onde fica |
| --- | --- | --- | --- |
| admin | admin | tudo | `%APPDATA%\omni\whatsapp\data\.api-key` |
| leitura | viewer | só leitura; a API recusa envio a este papel | `%APPDATA%\omni\whatsapp\leitura.key` |
| envio | operator | só a conversa do próprio número do dono | `%APPDATA%\omni\whatsapp\envio.key` |

A proteção vem do escopo, não do segredo: mesmo lida por alguém, a chave de leitura não envia e a de envio só fala com o dono. Provado com testes negativos (HTTP 403).

## Pasta `omni/` (nossa, não veio do projeto original)

- `omni/iniciar.ps1` — sobe o serviço em segundo plano. Não abre uma segunda instância se já houver uma escutando.
- `omni/parear.mjs` — vigia do QR para parear de novo, caso o celular desconecte a sessão.
- `omni/chaves.mjs` — recria as chaves de leitura e envio com escopo e as prova, inclusive pelo lado negativo.
- `omni/mcp.mjs` — servidor MCP: repassa as ferramentas de leitura e oferece `enviar_para_weriton`, que assina com a identidade da sessão (projeto e id). É aviso de mão única.

## Pendente de autorização do proprietário

Bloqueados pelo classificador de segurança do Claude Code; não foram contornados.

- **Inicialização automática no logon** ("persistência não autorizada").
- **Chave de admin no Gerenciador de Credenciais do Windows** ("persistência não autorizada"). Segue no arquivo acima.
- **Ponte WhatsApp → sessões** ("agente inseguro"): mensagem do dono acionando uma sessão, e resposta citando uma mensagem voltando para a sessão que a assinou. Na prática é um controle remoto do computador via WhatsApp.

## Alterações nossas

1. **`src/main.ts` — escuta só em `127.0.0.1`.** O original chamava `app.listen(port)` sem host, o que no Node abre todas as interfaces de rede. Agora o padrão é `127.0.0.1`; `BIND_HOST=0.0.0.0` reabre de propósito.
2. **`package.json` — `better-sqlite3` fixado em `12.11.1`** (o original pedia `^13.0.3`). A 13 traz binário N-API, mas não tem script de instalação, e o npm roda `node-gyp rebuild` sozinho, o que exige Visual Studio no Windows. A 12.11.1 baixa o binário pronto para Node 24 (win32-x64) e está dentro do `^12.0.0` que o TypeORM 1.1.1 declara suportar. O código não usa APIs exclusivas da 13.

Desligado pela configuração local, sem mudar código: consulta de releases (`UPDATE_CHECK_ENABLED=false`) e catálogo de plugins do projeto original (`PLUGIN_CATALOG_URL` apontado para endereço inexistente).
