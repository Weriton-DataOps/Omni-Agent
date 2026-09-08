# PostgreSQL — fundação de acesso do Omni

Estado: migration aditiva e regras TypeScript preparadas; **não instalada no PostgreSQL de uso**.
O teste de integração cria outro cluster, sem alterar o serviço existente, usando apenas dados e
credenciais sintéticos. Não é alternativa de produção nem contorna o bootstrap no cofre do Windows.

`migrations/001-access-foundation.sql` estabelece:

- banco dedicado `omni` como precondição, transação e lock de migration;
- idempotência por ID e SHA-256 do arquivo; alteração de migration aplicada é recusada;
- roles sem login, superusuário, criação de roles ou bypass de RLS; nenhuma senha criada;
- schemas separados; apenas fundação de identidade, versões de credencial e eventos nesta migration;
- identidade RLS derivada de login autenticado e mapeamento administrativo, não de um parâmetro do cliente;
- ausência de mapeamento nega leitura/escrita; memória e operações não acessam `access` ou `audit`;
- metadados sem valor de segredo, distinção de validade desconhecida e validação de expiração;
- eventos deduplicados por proprietário e ID, sem UPDATE, DELETE ou TRUNCATE para as roles de aplicação.

A role `omni_access_admin` é uma capacidade do componente confiável, não do modelo. Ela **não** é
administradora de banco, schema ou identidade de login. O provisionador externo cria logins dedicados
e vincula cada um ao proprietário; um login único compartilhado por identidades distintas não atende
a este desenho. `NOLOGIN` representa role de grupo, não falta de autenticação na conexão final.

As regras em `src/core/access/credential.ts` e o decoder em `src/contracts/credential-metadata.ts`
correspondem aos metadados SQL. O adaptador de repositório deverá adicionar `owner_id` a partir de
sua identidade autenticada, normalizar timestamps UTC e fazer evento + CAS de revisão na mesma
transação. O SQL não substitui o verificador de provedor nem a revalidação de concessões antes de efeitos.

Ainda pendentes: provedor Windows sob identidade dedicada; conexão produtiva; adapter transacional
da porta `CredentialMetadataRepository`; catálogo de capacidades e concessões; materialização de
permissões já concedidas; credenciais usadas/oferecidas; consumidor de renovação com claim e
reconciliação. Nenhum serviço deve tratar esta fundação como C2 concluída.

Diagnóstico de bootstrap disponível ao executor: `scripts/probe-windows-credential.ps1 -Target`
recebe somente o nome explícito da entrada. Não lista o cofre, decodifica nem emite senha; devolve
`credential-not-found`/exit 2 na ausência, `credential-store-unavailable`/exit 3 para logon sem cofre,
e erro/exit 1 nos demais casos. Exit 0 significa somente metadados presentes: login PostgreSQL e
prontidão continuam não verificados. O processo chamador precisa preservar o código de saída.
Teste de integração explícito: `testes/windows-credential-probe.integration.mjs`, sem escrita no cofre.
Ele não é o `CredentialProvider`, não realiza provisionamento e não cria fronteira entre aplicações
executadas pela mesma identidade Windows.

## Bootstrap local realizado em 08/09/2026

O bootstrap autorizado criou o banco dedicado `omni`, aplicou `001-access-foundation` com checksum
`187c7ab75fea42f8ab8a74324bba74445e7e5a7e8c504c7a84f687f3afa5f6b1` e adicionou o login
`omni_access_broker`. Ele não é superusuário, não cria banco/roles, não ignora RLS e precisa ativar
explicitamente `omni_access_admin` por transação (`NOINHERIT`). O teste autenticado confirmou o
login e o mapeamento do proprietário.

A senha do login foi gerada localmente e está apenas no Gerenciador de Credenciais sob a identidade
administrativa que realizou o bootstrap, na referência `Omni/PostgreSQL/local/access-broker/v1`.
Ela não é visível para `GR\wp.santos`; isso foi confirmado por `CredReadW` sem decodificação do
segredo. A referência administrativa antiga `Overcore.PostgreSQL.Admin` continua separada e não
entra no runtime comum. Os recibos sanitizados estão em `out/implementation/`.

Limite preservado: ainda falta o serviço/broker local com identidade própria e canal autenticado.
O plugin comum não lê essa credencial, não recebe senha e não deve conectar diretamente como
`omni_access_broker` até essa borda ser implementada e verificada.

Verificação do executor: `testes/postgres-access.integration.mjs`. O executor fornece a localização
validada do PostgreSQL, cria e encerra a instância descartável e preserva somente o relatório em
`out/implementation`. Esse teste não pede operação manual do proprietário.

Referências: [RLS PostgreSQL 18](https://www.postgresql.org/docs/18/ddl-rowsecurity.html),
[inicialização de cluster](https://www.postgresql.org/docs/18/app-initdb.html) e
[distinção entre token inválido e escopo insuficiente](https://www.rfc-editor.org/rfc/rfc6750.html#section-3.1).

## Atualização — instância exclusiva e broker local

O bloqueio da credencial histórica de `GR\dados` foi removido sem alterar Overcore: o Omni passou a
usar seu próprio cluster em `127.0.0.1:5433`. A fundação foi aplicada e verificada com o login
mínimo `omni_access_broker`; o recibo sanitizado é
`out/implementation/omni-dedicated-postgresql-bootstrap-2026-09-08.json`.

O valor de runtime está somente no Gerenciador de Credenciais da identidade atual, na referência
`Omni/PostgreSQL/dedicated-5433/access-broker/v1`. O cliente TypeScript usa o pipe nomeado
`omni-access-broker-v4`; a ACL restringe o cliente ao SID do proprietário e o protocolo oferece
somente `health` e leitura de metadados. O teste autenticado devolveu `active` sem campo de senha,
token ou blob. Um atalho na Inicialização do usuário religa o PostgreSQL e o broker no logon, sem
armazenar senha no Windows Task Scheduler.

A migration `002-memory-and-missions` adiciona memória em duas camadas e missões RLS com eventos
append-only. A importação de memória pelo broker é limitada, idempotente por receipt e comprovada
por `applied` seguido de `duplicate`. O adapter transacional de observações e o cutover automático
dos hooks continuam no próximo corte; esta etapa não declara C2 concluído.
