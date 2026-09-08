# Implantação do Omni — memória, personalidade, autonomia e Crachá

Data: 08/09/2026. Estado: execução autorizada e iniciada; correções locais e fundação do Crachá
implementadas e verificadas localmente. Implantação produtiva, bootstrap e prova no host ainda pendentes.

## Execução em andamento

O proprietário autorizou executar este plano em 08/09. O
[registro de execução](2026-09-08-execucao-implantacao-omni.md) distingue fonte/testes, instalação
e estado efetivamente carregado. Ele é o ponto de retomada; critérios de aceite abaixo continuam
valendo e não foram reduzidos para declarar conclusão.

- F0: baseline e candidata isolados com manifesto verificável; trabalho anterior preservado.
- F1: correções locais de feedback/continuidade, intenção, retorno ao proprietário, segundo Stop,
  contexto pós-ferramenta, captura inicial e eval por snapshot. Instalação/readback pendentes.
- C0/C1: ciclo de saúde/validade tipado e migration inicial de metadados, RLS e auditoria testados
  em PostgreSQL descartável. Nenhum login, segredo ou schema criado no banco existente.
- F2/F3/F4/C2: migração do conteúdo, broker/cofre, concessões, worker durável e busca medida ainda
  não ativados. Dívida histórica não foi marcada como corrigida sem evidência.
- F5: envio ao Claude autorizado pelo proprietário, até US$ 0,75 por chamada; seis hooks da
  candidata executaram no host real, mas a inferência encontrou quota de sessão (custo US$ 0).
  Prova comportamental e instalação continuam pendentes; evidências no registro de execução.

O bootstrap produtivo depende de recuperar a entrada administrativa no contexto Windows correto:
`Overcore.PostgreSQL.Admin` foi localizada na documentação original, mas não existe no cofre da
conta atual segundo `CredReadW`. A consulta da própria sessão criadora também não comprovou a entrega.
Não redefinir senha, reiniciar serviço compartilhado ou reaproveitar credencial de outro projeto.

## Objetivo e decisões registradas

O Omni deve manter uma voz reconhecível ao longo da conversa, incorporar correções do proprietário,
recuperar o contexto certo e concluir ações autorizadas sem devolvê-las como trabalho operacional.
Este plano reúne a auditoria de 08/09, a sessão Claude de 04/09 sobre PostgreSQL e as ideias da Ada.

Decisões expressas do proprietário nesta conversa:

- corrigir os problemas da auditoria;
- adotar missões duráveis: decisão registrada como **aprovada**;
- aproveitar conceitos da Ada com implementação própria, sem copiar seu conjunto de código/dados;
- incluir o **Crachá**, ainda não construído, para centralizar os acessos que o Omni usa e oferece;
- usar PostgreSQL como base do Crachá, com uma camada própria de controle de acesso no banco;
- permitir que melhorias apliquem e materializem permissões já concedidas pelo proprietário,
  sem repetir aprovação, preservando escopo, validade e rastreabilidade;
- registrar vencimento e perda de funcionamento de cada credencial/token, com verificação e motivo;
- consolidar antes o planejamento de implantação.

Definição recuperada da sessão de 04/09: Git guarda a engenharia do Omni; PostgreSQL + JSON guardam
o conteúdo que melhora seu contexto; correções devem valer entre sessões sem aguardar rotina diária.
A recomendação abaixo concretiza essa definição. Não significa que o banco ou a migração estejam prontos.

Responsável pela execução deste plano: Omni e os executores acionados por suas portas existentes.
Weriton fornece decisões materiais quando indispensáveis; não opera comandos, migrations ou checklists.

## Arquitetura recomendada para a memória

**Duas camadas: conteúdo canônico e projeções para uso.** PostgreSQL é a única fonte oficial do
conteúdo de memória após a migração. JSON, texto indexado e vetores são cópias derivadas com revisão
conhecida. Isso não inclui segredos nem transforma memória em fonte de autorização do Crachá.

| Camada | Conteúdo e papel | Regra de consistência |
|---|---|---|
| 1. Conteúdo canônico — PostgreSQL do Omni | Memórias, correções, regras/procedimentos aprendidos, calibração de personalidade, exemplos aprovados e suas evidências | Escrita transacional; revisão por item; origem e escopo; substituições explícitas; uma autoridade de escrita |
| 2. Projeções de uso — cache JSON + índices | Perfil ativo, memórias relevantes, contexto de retomada, FTS/trigram e embeddings derivados | Cada projeção identifica a revisão de origem; pode ser reconstruída; nunca substitui silenciosamente a fonte |
| Engenharia — Git, fora das duas camadas de conteúdo | TypeScript, schemas, migrations, políticas, persona-base e exemplos sintéticos de teste | Só mudança estrutural exige build/release; conteúdo pessoal aprendido permanece fora do pacote |

O estado de missões e recibos também pode morar no mesmo banco dedicado, mas em tabelas operacionais
separadas. Não vira memória semântica nem é incluído automaticamente no contexto/RAG.

Fluxo de uso previsto:

```text
pedido ou correção
  → extrair intenção/fatos e validar origem, escopo e evidência
  → PostgreSQL: conteúdo + revisão + notificação pendente, na mesma transação
  → atualizar projeção JSON e índices por revisão
  → hook: persona ativa por leitura direta + memória relevante por busca
  → resposta/ação observada → evidência de uso e efeito
```

### Onde hospedar e como buscar

Começar no PostgreSQL local, em banco próprio `omni`, com credencial de aplicação própria. O serviço
`postgresql-x64-18` foi observado em execução nesta rodada; acesso, banco, extensões e permissões
ainda precisam de inventário técnico. Não usar as tabelas/credenciais de aplicação do Overcore.

Premissa inicial: sessões nesta máquina, sem requisito confirmado de sincronização entre dispositivos.
As portas permitem migrar a hospedagem depois. Supabase/PostgreSQL remoto fica como evolução de
implantação quando houver necessidade concreta; o hook continuará com cache local. Não se prevê
replicação bidirecional entre dois bancos mestres nem dependência de internet em cada ferramenta.

A personalidade-base, ajustes ativos, correção atual e objetivo têm leitura direta por identidade e
revisão. Não dependem de similaridade vetorial. Fatos e procedimentos relevantes usam busca filtrada
por usuário/projeto/ambiente **antes** do ranking. Inicialmente FTS + busca de identificadores; depois
pgvector se melhorar os casos de paráfrase. PostgreSQL fornece busca textual e pgvector permite
combinar busca vetorial com ela. [PostgreSQL FTS](https://www.postgresql.org/docs/18/textsearch-intro.html),
[pgvector — busca híbrida](https://github.com/pgvector/pgvector#hybrid-search).

### Escrita imediata e qualidade do aprendizado

- Preferência/correção explícita e estável: aplicar no turno atual e persistir no escopo correto;
  passa por validação de origem, negação, atribuição e compatibilidade com o contrato do Omni.
- Ajuste como “sem piada agora”: somente sessão/turno; não reescreve a preferência duradoura.
- Fato informado pelo proprietário: guardar como declaração com proveniência; uma afirmação sobre
  estado externo não vira “verificada por ferramenta” sem observação correspondente.
- Fato observado por ferramenta: guardar resumo mínimo e referência verificável, com validade temporal.
- Inferência: candidata; não entra como instrução global. Promoção exige evidência independente e ausência
  de contradição, não só repetição da mesma resposta do modelo.
- Citação, exemplo de teste e fala de outra pessoa: preservar atribuição; não tratá-los como preferência
  ou autorização do proprietário.
- Nova correção substitui apenas conteúdo do mesmo assunto e escopo, por revisão. Um elogio genérico
  não anula a exigência específica de constância. Retração/expiração removem também cache e embedding.

Implementar extrator estruturado pela porta `MemoryExtractor`: caminho direto para declarações inequívocas
e extração assistida por modelo para casos ambíguos, com I/O validado e orçamento limitado. O trabalho
mais custoso acontece fora de `PostToolUse`; o hook não dispara uma inferência extra a cada ferramenta.

### Cache, falha e retomada

Com banco disponível: commit primeiro, atualização atômica do snapshot depois. Usar `revision`,
`schemaVersion`, horário e digest da projeção. Uma falha entre commit e cache é recuperada por outbox
transacional; sessões consultam revisão no início do turno e recebem invalidação pelo componente local.

Com banco indisponível: usar último perfil válido e memória cacheada com idade conhecida. Correção nova
pode ter efeito imediato na sessão, mas fica como evento **pendente de sincronização** em journal local
durável, com ID idempotente; não é anunciada como salva globalmente. O journal é fila de transporte,
não uma segunda base canônica. Reconciliação usa revisão esperada e registra conflito.

Para continuar após uma resposta curta ou reinício, o cache precisa conter persona-base suficiente;
não depender de um serviço de embeddings. Cache não concede autoridade nem confirma estado vivo de
produção. Operações com efeito não iniciam com coordenação/autoridade indisponíveis ou desatualizadas.

### Modelo de dados mínimo a detalhar nas migrations

| Grupo | Registros propostos |
|---|---|
| Conteúdo | `memories`, `learned_rules`, `learned_procedures`, `owner_feedback`, `personality_adjustments`, `voice_examples` |
| Proveniência | `content_revisions`, referências de evidência e episódios resumidos; conteúdo bruto não é requisito |
| Operação | projeção persistente do ciclo existente, tentativas, recibos, vínculos de autoridade e de reparo |
| Entrega | outbox de atualização de projeções/despacho/retorno; acknowledgements e deduplicação |
| Derivados | embeddings por item+revisão+modelo; revisão de snapshots e estatísticas de recuperação |

Campos comuns do conteúdo: ID, tipo, assunto, usuário, escopo, status, revisão, origem, evidência,
confiança, importância, validade, `supersedesId` e motivo de retração. Reaproveitar os IDs e enums
existentes onde possível, com migração explícita das diferenças.

Usar role proprietária de schema/migrations separada da aplicação. A aplicação não pode desabilitar
as proteções do diário de revisões. Segredos são acessados por um provedor de credenciais, fora de
conteúdo de memória, cache, embeddings e Git; eventual armazenamento cifrado no PostgreSQL segue as
regras do Crachá abaixo. Backup privado do conteúdo precisa ter restauração testada; cache não é backup.

## Crachá — identidade e acessos usados e oferecidos

Adição do proprietário em 08/09: o Crachá ainda não foi construído e é onde ficam todos os acessos
que o Omni vai usar e oferecer. Entra como componente lógico próprio deste planejamento, não como
mais uma memória ou arquivo de senhas. Centraliza catálogo, identidades, concessões e referências
de credenciais; os segredos permanecem sob um provedor de cofre apropriado.

Complemento do proprietário: preferir PostgreSQL para o Crachá por permitir uma camada adicional
de acesso. Direção adotada: PostgreSQL canônico para seu cadastro e concessões, com permissões
próprias no banco além da autorização aplicada pelo serviço. Cofre é uma fronteira lógica: não
exige necessariamente outro banco; valores sensíveis, se centralizados no PostgreSQL, seguem o
armazenamento cifrado descrito abaixo. Isso não autoriza importar credenciais nesta etapa.

O desenho não decide criar agora outro repositório, serviço remoto ou plataforma IAM genérica.
O Omni integra o Crachá por portas neutras; a implantação inicial pode usar adaptadores locais.
A identidade de acesso identifica um principal autenticado, não o perfil de personalidade.

### Duas direções, sem compartilhar uma chave mestra

| Direção | O que o Crachá precisa controlar |
|---|---|
| Acessos usados pelo Omni | Identidade/conexão com banco, APIs, repositórios, ferramentas e projetos; operações e recursos autorizados em cada ambiente; referência de credencial quando necessária |
| Acessos oferecidos pelo Omni | Quais clientes/agentes podem chamar cada capacidade ou consultar cada recurso explicitamente publicado; identidade individual, limites, validade, possibilidade de delegação e auditoria |

“Oferecer” não significa repassar a senha que o Omni usa. Acesso concedido a um executor é restrito
à capacidade, alvo e missão pertinentes; não abre automaticamente memória pessoal, cofre ou todos
os serviços conectados. A posse de uma chave, um pedido recebido ou uma capacidade no catálogo
não constitui autorização por si só. Serviço cadastrado mas desconectado não aparece como utilizável.

### Responsabilidades e armazenamento propostos

- **Catálogo e concessões:** identidades, conexões, capacidades consumidas/oferecidas, recursos,
  operações, ambientes, emissor e origem da autoridade, validade, versão e estado de revogação.
  Metadados privados no PostgreSQL, em schema próprio, separado da memória; role de aprendizado
  não altera concessões.
- **Cofre:** chaves, senhas e tokens acessados por provedor compatível com o host; catálogo e missões
  guardam referências opacas. O provedor pode usar cofre existente ou armazenamento cifrado no
  PostgreSQL, com a chave de proteção fora dele. Resolve o segredo somente no adaptador confiável.
  Não exportar valores para prompt, RAG, JSON de memória, briefing, CLI, logs ou Git. Não construir
  algoritmos criptográficos nem uma plataforma genérica de senhas como parte deste MVP.
- **Decisão e aplicação:** reutilizar `AuthorityEvaluator` e os contratos de autoridade, vinculando
  o pedido à identidade autenticada e à concessão recuperada da fonte confiável. O chamador pode
  solicitar escopo, não declarar o próprio teto como autoridade. Conferência final no adaptador/serviço
  que executa o efeito; texto de prompt ou parecer sem enforcement não basta.
- **Auditoria:** registrar quem, capacidade, recurso referenciado, missão, decisão, revisão da
  política e resultado, sem segredo ou corpo bruto. Acesso aos próprios registros também é controlado.

Aplicar privilégio mínimo, validação por chamada e ausência de concessão como ausência de autorização;
centralizar gestão e restringir o acesso aos segredos. Referências de implementação:
[OWASP — autorização](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) e
[OWASP — gestão de segredos](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html).

Memória pode lembrar que existe uma integração, mas o Crachá verifica a autoridade vigente antes
do uso. **Uma melhoria pode habilitar, reparar ou materializar permissões já concedidas**, inclusive
emitir uma autorização derivada quando coberta pela concessão de origem. Não é necessário pedir
novamente a autorização só porque faltava implementá-la tecnicamente. Conteúdo recuperado e feedback
não são, por si sós, novas fontes de autoridade: a rotina resolve a concessão original comprovada,
vigente e aplicável; não inventa nem amplia seu teto. A credencial PostgreSQL é resolvida antes da conexão:
não depende de ler o mesmo banco para descobrir como acessá-lo. Bootstrap mínimo fica protegido
fora do banco; migração de metadados não cria duas autoridades de escrita concorrentes.

Fluxo previsto para aprendizado que identifica um acesso autorizado mas não aplicado: localizar a
concessão de origem → comparar sujeito/recurso/operação/ambiente/prazo → aplicar pelo serviço do Crachá
com chave idempotente → verificar o acesso efetivo → registrar origem, mudança e resultado. A role
de memória continua sem escrita direta nas concessões; a melhoria chama uma porta autorizada.
Quando houver delegação, preservar o vínculo com a concessão-mãe e propagar sua revogação. Expansão
fora do teto ou origem não comprovada exige resolver essa lacuna, não supor autorização por semelhança.

### Camada adicional de acesso no PostgreSQL

No banco dedicado `omni`, propor schemas `memory`, `operations`, `access` e `audit`; `vault` somente
se houver segredos cifrados armazenados ali. Schemas organizam o isolamento, mas não o garantem
sozinhos: migrations concedem apenas os privilégios necessários em schemas, tabelas, sequências e
funções, inclusive nos defaults de objetos futuros. [Privilégios do PostgreSQL](https://www.postgresql.org/docs/18/ddl-priv.html).

- Conexão de memória/recuperação não lê o cofre nem escreve concessões; conexão de missões não
  altera diretamente o próprio teto. Pode solicitar sua materialização pelo Crachá dentro de uma
  concessão existente. Separar credenciais/pools por responsabilidade, não apenas nomes
  de schema com um único login de administrador por trás.
- O serviço do Crachá consulta concessões e decide. Emissão/revogação usa caminho administrativo
  autenticado e restrito; o usuário de banco de execução não possui esse poder nem pode assumir
  a role administrativa. Esse caminho aceita aplicação automática de autoridade já concedida,
  sem transformar cada aplicação em nova aprovação humana. O processo comum do modelo não recebe
  todas essas credenciais.
- Habilitar RLS nas tabelas compartilhadas por identidades/escopos, com políticas para leitura e
  escrita. Roles de aplicação não são donas das tabelas, superusuárias nem `BYPASSRLS`. Testar
  ausência de política e tentativas de mudança de escopo. Superusuários e `BYPASSRLS` ignoram RLS;
  donos normalmente também, a menos que se aplique `FORCE ROW LEVEL SECURITY`.
  [Limites e políticas de RLS](https://www.postgresql.org/docs/18/ddl-rowsecurity.html).
- Identidade/escopo de RLS vêm da autenticação confiável, nunca apenas de um campo que o modelo
  ou cliente escolheu. Se houver contexto por transação no pool, impedir SQL arbitrário nessa
  conexão e limpar o contexto ao devolvê-la; testar ausência de vazamento entre duas identidades.
- Acesso oferecido por API não entrega login PostgreSQL ao cliente. O serviço valida a operação,
  o banco restringe os dados e o executor confere a concessão antes do efeito. RLS não autoriza
  automaticamente uma chamada externa nem substitui a revogação do token naquele serviço.

Senhas/tokens reutilizáveis, se armazenados no PostgreSQL, serão cifrados antes de chegar ao banco,
por biblioteca/provedor estabelecido com criptografia autenticada e versão da chave. Chave de
proteção e credencial inicial de conexão ficam fora do banco e de seu backup. O provider terá
rotação e recuperação testadas; não enviar a chave junto com uma consulta SQL. Credenciais que
só precisam ser verificadas, e não recuperadas, terão tratamento próprio de verificação.
[OWASP — armazenamento criptográfico e separação de chaves](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html).

Limite explícito: privilégios/RLS não protegem contra quem administra todo o banco/SO; criptografia
com chave separada protege uma cópia isolada do banco, não um host comprometido com acesso à chave.
No primeiro corte, integrar o cofre do Windows para bootstrap conforme a definição abaixo. A opção de payload cifrado
em `vault` só entra após validar gestão de chaves e restore; o cadastro PostgreSQL não espera por ela.

### Validade e funcionamento de credenciais/tokens

Requisito do proprietário: cada credencial/token precisa registrar quando vence e quando deixa
de funcionar, mesmo antes do vencimento. Metadados no schema `access`, inclusive para credenciais
cujo segredo fica no Windows; não misturar validade do token com validade da concessão de autoridade.
Modelar por versão da credencial e por conta/provedor/ambiente; access token e refresh token são
registros relacionados com validades próprias. Os nomes abaixo são propostos para as migrations.

| Campos | Finalidade |
|---|---|
| `credential_id`, `version`, `secret_ref` | Identidade da versão observada e referência ao segredo; nunca o valor em texto aberto |
| `issued_at`, `expires_at`, `expiry_kind`, `expiry_source` | Emissão e vencimento; `expiry_kind`: `known`, `non_expiring` ou `unknown`; origem da informação de validade |
| `status`, `status_changed_at` | `unverified`, `active`, `expired`, `suspect`, `invalid`, `revoked`, `disabled` ou `replaced`, com instante da mudança |
| `last_checked_at`, `last_success_at` | Última verificação concluída e último uso autenticado bem-sucedido dessa versão no alvo correspondente |
| `unusable_since`, `last_failure_at`, `failure_code`, `evidence_ref` | Quando deixou de ser utilizável, última falha, motivo normalizado e referência de evidência sem resposta bruta/segredo |
| `revoked_at`, `replaced_by_id` | Revogação comprovada ou substituição por outra credencial, preservando o histórico |
| `renewal_mode`, `renew_before`, `next_check_at`, `next_retry_at` | Renovação disponível (`none`, `refresh`, `rotate`, `reauthenticate`), antecedência e próximos controles; execução pelo ciclo operacional existente |

Datas de instante em `timestamptz`, tratadas em UTC e apresentadas no fuso do proprietário.
`expires_at = NULL` não significa validade eterna: `unknown` distingue data não informada de
`non_expiring`, que requer informação explícita do provedor. Criar constraint: data obrigatória
para `known` e ausente nos outros dois casos. Emissão/expiração não podem ser contraditórias.
Para OAuth, aproveitar `expires_in` fornecido na emissão e registrar a base temporal e margem de
segurança; não adivinhar validade por costume. Um JWT somente decodificado não é evidência confiável.
[OAuth — resposta de emissão](https://www.rfc-editor.org/rfc/rfc6749.html#section-5.1).

Regras de uso e diagnóstico:

- Antes de cada uso, conferir a data e os estados impeditivos. O vencimento efetivo é calculado
  pela data, mesmo que um job ainda não tenha persistido `expired`; estado `active` antigo não o
  sobrepõe. Validade desconhecida exige verificação conforme o provedor, não promessa de uso eterno.
- Ao receber evidência de token rejeitado no provedor/alvo correto, interromper o uso dessa versão
  e registrar o motivo. Só marcar `revoked` se houver evidência de revogação; `invalid_token` sozinho
  não distingue token vencido, revogado ou inválido por outra causa. Relato ainda não verificado de
  que “não funciona” vira `suspect` e diagnóstico; desativação expressa pelo proprietário é imediata.
- Falta de permissão para uma operação é falha de autorização daquele acesso, não invalidação
  global do segredo. A especificação Bearer distingue `invalid_token` de `insufficient_scope`.
  Interpretar códigos conforme o adapter do provedor; não classificar todo HTTP 401/403 igualmente.
  [OAuth Bearer — erros](https://www.rfc-editor.org/rfc/rfc6750.html#section-3.1).
- Timeout, rede, limite de requisições ou falha do serviço registram indisponibilidade transitória
  da conexão/tentativa e retry limitado; não apagam um sucesso anterior nem provam credencial inválida.
  Registrar todos os eventos no histórico, não apenas sobrescrever o último erro.
- Avisar antes do vencimento pela política configurada, sem notificações repetitivas. Renovar
  automaticamente quando o provedor suportar e a autoridade já cobrir a operação; se depender de
  autenticação humana, registrar essa dependência e preservar a missão. Não insistir com token
  comprovadamente inválido nem ampliar o escopo para resolver rejeição.
- Atualizar somente a versão que originou a observação: falha tardia do token antigo não invalida
  o novo, e sucesso atrasado não reativa um token revogado/desativado/substituído. Renovação usa
  claim único e atualização por revisão; refresh com rotação e resultado incerto exige reconciliação,
  não repetição cega. Revalidar a concessão vigente depois da renovação.

Para a credencial inicial do PostgreSQL, o verificador pode falhar antes de acessar o cadastro:
registrar evento sanitizado em journal local protegido e sincronizá-lo quando a conexão voltar,
sem depender do banco para registrar a própria indisponibilidade. Não guardar a senha nesse journal
nem usar falha de login como autorização para tentar uma conta administrativa.

Aceite adicional: vencimento sem job disparado bloqueia uso; `unknown` não vira `non_expiring`;
revogação antes do vencimento impede próximo uso; rejeição confirmada fica registrada; falta de
escopo e timeout não invalidam todos os acessos; refresh autorizado retoma a missão sem nova
aprovação; refresh inválido para com causa clara; resultado de versão antiga não contamina a nova;
falha do bootstrap é registrada mesmo sem PostgreSQL. Testes usam relógio controlado e tokens sintéticos.

### Onde fica o acesso inicial ao PostgreSQL

Escolha de implantação Windows: **Gerenciador de Credenciais do Windows**, no contexto da identidade
que executará o componente confiável do Crachá. Ele guarda as credenciais de conexão por role,
acessadas pelo adaptador `CredentialProvider` antes de abrir o banco. Exemplo de nome lógico, ainda
não criado: `Omni/PostgreSQL/local/access-runtime`. A API de credenciais do Windows permite à aplicação
gerenciar esse material fora do PostgreSQL. [Microsoft — Credentials Management](https://learn.microsoft.com/en-us/windows/win32/secauthn/credentials-management).

- Configuração local de bootstrap: endereço, porta, banco, usuário técnico e nome da referência no
  cofre; nenhuma senha. Definir valores após inventário, sem presumir porta/role existentes.
- Cofre Windows: segredo da conexão inicial e credenciais distintas por responsabilidade. A chave
  que protege eventual `vault` é outra entrada, não a senha do PostgreSQL reutilizada como chave.
- PostgreSQL: cadastro da conexão e concessões para uso após a inicialização. A referência pode
  aparecer no Crachá, mas o primeiro acesso não depende de consultar o próprio banco.
- Administração/migrations: identidade separada e disponibilizada somente ao caminho autorizado de
  provisionamento; não inicializar o runtime comum com a senha de superusuário.

Na inicialização, o componente lê a referência local, obtém a credencial no cofre, abre uma conexão
limitada e carrega o Crachá; só então atende às missões. O bootstrap é a raiz mínima de confiança
protegida pelo Windows, não uma segunda cópia de todas as permissões. Se falhar, registrar dependência
indisponível; não trocar automaticamente para um login administrativo.

Para isolar o cofre do processo que executa ferramentas arbitrárias do modelo, prever identidade
Windows dedicada ao componente confiável, com comunicação local autenticada. Rodar ambos sob a
mesma conta não é isolamento de segredo por aplicativo. Validar o acesso não interativo e o perfil
da conta no logon/reinício; a criação dessa identidade pertence à implantação, não a esta edição.
Se for necessário um adapter DPAPI, usar escopo de usuário e proteção do arquivo, não o escopo de
máquina como atalho. A DPAPI normalmente vincula a descriptografia à identidade e ao computador;
o modo de máquina permite descriptografia por outros usuários locais.
[Microsoft — DPAPI](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata).

Recuperação da conta/cofre e da chave externa deve ser testada separadamente do backup PostgreSQL.
Trocar de máquina/conta não pode pressupor que copiar arquivos restaure a credencial. Não foi
consultada, criada ou alterada nenhuma entrada do cofre nesta rodada; nomes e fluxo são planejamento.

### Vínculo com missões e autonomia

1. Resolver identidade autenticada, conexão, capacidade e concessão vigente dentro do pedido aceito.
2. Criar autorização limitada por sujeito, destinatário, recurso/ambiente, operações, missão e prazo;
   só delegar se a concessão de origem permitir, sempre com escopo igual ou menor.
3. Revalidar no despacho, antes do efeito e em toda retomada/retry. Recibo de execução antiga ou
   snapshot de memória não prolonga autorização. Token/recibo precisa de integridade verificável e
   vínculo com o destinatário; fingerprint sozinho não autentica. Usar mecanismos estabelecidos.
4. Revogar bloqueia novos usos e próximos passos; comunicar aos consumidores e cancelar trabalho
   ainda não iniciado quando seguro. Efeito já aceito pelo serviço exige reconciliação, não uma
   promessa de desfazer instantaneamente. Falha na consulta de autorização não libera execução.

Renovação de credencial técnica pode ser automática quando já permitida; não renova a autoridade
da missão nem amplia seu escopo. Acesso já autorizado, mesmo ainda não configurado, pode ser
habilitado automaticamente pelos passos necessários cobertos pela concessão. O acesso disponível
deve ser usado sem pedir a mesma aprovação a cada turno. Ausência de autoridade, identidade/privilégio
fora do teto concedido ou autenticação humana indispensável gera uma decisão pontual e explicada;
Omni mantém a responsabilidade pelo
restante do trabalho. Não contornar MFA, consentimento ou limites do serviço para evitar uma pergunta.

### Base existente e corte de implantação

Há base na fonte: `omni-authority-credential-v2`, `omni-responsible-freedom-v1`, `AuthorityEvaluator`
e a ponte HTTP de autoridade para Overcore. O primeiro corte da ponte só admite leitura concedida
e montagem interna de relatório, com decisão de até cinco minutos. Isso não comprova Crachá,
cofre, emissão/revogação persistente ou identidade por cliente operacionais. A sessão atual não
testou a ponte instalada, não leu segredos e não concedeu acessos.

Reutilizar esses contratos com evolução versionada e compatibilidade explícita. A ponte não passa
a permitir escrita/publicação apenas porque o Crachá foi planejado. Não abrir endpoint público
nem criar conta/token de terceiros nesta etapa. Primeiro consumidor externo: adaptador local
autenticado, com uma capacidade de leitura escolhida e comprovada, mantendo Overcore independente.

Entregas do Crachá:

- **C0 / após F0, em paralelo à F1:** inventário sem segredos, fronteiras de confiança, modelo de
  identidade/concessão, portas TypeScript e bootstrap pelo Gerenciador de Credenciais do Windows,
  validando identidade do componente e inicialização sem consulta ao PostgreSQL. Testes com identidades
  sintéticas; nenhuma credencial encontrada é automaticamente importada ou usada.
- **C1 / integrado à F2:** persistência no PostgreSQL, schemas/roles distintos, RLS por escopo,
  conexão real de aplicação, auditoria e ciclo de credenciais. A conexão inicial usa o bootstrap C0;
  só depois grava os próprios metadados. Migrar autorizações existentes apenas com origem/escopo
  comprovados. Testar com logins de runtime, não apenas com o dono do banco; comprovar isolamento
  entre memória, missões e concessões, e entre duas identidades num mesmo pool.
  Incluir materialização idempotente de acesso já concedido, com origem resolvida e sem nova pergunta.
  Incluir os campos de validade/saúde por versão e os testes de classificação de falhas descritos
  acima; vencimento efetivo não pode depender da execução do consumidor periódico.
- **C2 / antes de ativar F3 e ampliar acessos oferecidos:** concessão restrita por missão, identidade
  de cada consumidor, verificação no executor, expiração/revogação, proteção contra replay e retorno
  auditado. Testes de retomada com concessão expirada ou revogada precisam passar antes do worker.
  Ligar verificação/renovação antecipada de credenciais ao ciclo durável, com deduplicação e retry
  limitado; distinguir credencial expirada de autoridade expirada ao retomar cada missão.

Aceite: execução já concedida funciona sem aprovação repetida; credencial válida sem concessão não
libera ação; troca de sujeito, destinatário, projeto, ambiente ou operação não amplia acesso;
revogação impede o próximo efeito; token antigo/reutilizado não contorna o vínculo; indisponibilidade
não vira permissão; segredos não aparecem no contexto nem nos artefatos de teste. Testar com valores
sintéticos identificáveis, sem vazar credenciais reais. Backup/rollback preservam revogações e não
reativam concessões antigas; recuperação de cofre é separada da restauração da memória.
Se o payload de segredo ficar em `vault`, backup do banco contém apenas sua forma cifrada; sem a
chave externa não deve ser possível recuperá-lo. Restore autorizado com a chave correta deve passar.
Regressão positiva obrigatória: melhoria identifica permissão concedida ainda não aplicada, aciona
o Crachá, configura acesso dentro do teto e o verifica sem pedir nova aprovação. Repetição não duplica
concessão; origem revogada/expirada ou escopo maior não passa. Testar também revogação da concessão-mãe.

## Missões duráveis: adoção aprovada, escopo do Omni preservado

“Missão” será a apresentação de um objetivo/delegação/reparo no **ciclo operacional já existente**.
Evoluir `omni-operational-cycle-v1`, com migração, em vez de criar outro estado concorrente.
O Omni acompanha seus compromissos e verifica resultado; o executor realiza o trabalho via porta neutra.
Overcore permanece externo. Diário operacional e outbox são persistência desse ciclo, não um novo
Task Manager, DAG ou plataforma genérica de Event Store dentro do Omni.

Antes do cutover, revisar ADR-002 e contratos de escopo para deixar essa fronteira inequívoca:
um único estado de domínio; transporte não decide conclusão; migração do store, não duplicação dele.
O Crachá fornece o vínculo de identidade e autorização vigente; a missão guarda a referência da
concessão, não a senha nem um poder permanente. Ativação autônoma depende dos testes C2.

Cada missão precisa de:

- ID estável, chave idempotente e envelope mínimo do objetivo aceito; paráfrase não cria outra tarefa
  quando a conversa aponta explicitamente para a mesma tarefa ativa;
- projeto/caminho literal, ambiente, efeitos permitidos, referência da autoridade e critérios de aceite;
- etapa, revisão, responsável, lease/epoch, próxima tentativa e limites de tempo/custo;
- evidências e efeito observado, resultado relatado, verificação independente e confirmação de entrega.

Hash sozinho não permite retomar execução. Guardar uma especificação mínima sanitizada e referências
a artefatos versionados, em armazenamento privado; não restaurar a conversa inteira nem guardar segredos.
Atualizar o contrato de privacidade para esse envelope explícito; telemetria continua sem conteúdo bruto.

Garantia pretendida: entrega ao menos uma vez, deduplicação e efeitos idempotentes onde possíveis.
Não prometer execução exatamente uma vez de efeitos externos. Lease vencido após escrita incerta
exige inspeção do efeito e compensação/reconciliação antes de nova tentativa. Resultado de epoch antigo
não pode substituir o estado atual. Terminal não reabre por evento atrasado.

O consumidor de reparos será executável e supervisionado. Na primeira implantação Windows: processo
local registrado para iniciar no logon, reinício após falha e tick limitado para trabalhos devidos,
com singleton/lease; hooks apenas sinalizam e consultam estado. O transporte aciona adaptador já
suportado, e a tarefa retorna à sessão de origem ou ao inbox durável quando ela estiver fechada.
Não depende de nova mensagem humana para recomeçar. O registro desse processo é parte da implantação.

Fila humana tem precedência sobre manutenção; definir concorrência e orçamento conservadores e
configuráveis. Uma falha repetida sem mudança de condição vira bloqueio interno diagnosticado, com
retry condicionado à recuperação, não uma nova tentativa cara só para mudar o contador.

Revisão independente é proporcional: verificação determinística para reparos simples; revisão separada
para mudança estrutural/ambígua, recebendo objetivo, diff e evidências sanitizadas. O crítico emite
parecer; somente o Omni fecha após readback. Não aprova sua própria mudança nem substitui prova por opinião.

## O que aproveitar de cada fonte

| Origem | Decisão no plano |
|---|---|
| Sessão Claude de 04/09 — Git/casca e PostgreSQL/conteúdo | Adotar; retirar regras/procedimentos aprendidos e calibração do caminho obrigatório de commit/release |
| Sessão — galeria rotativa | Preservar a implementação local e corrigir orçamento/continuidade; não recomeçar do zero |
| Sessão — extrator de fatos e escopo | Prioridade de implementação; a reprodução atual descarta fatos de PostgreSQL/caminho e aceita frases passageiras como candidatas |
| Sessão — pgvector | Camada de busca derivada; validar extensão/provedor e ganho antes de ativar; não bloqueia persistência nem correções comportamentais |
| Ada — missões, lease, epoch, idempotência, retorno com confirmação | Adotar conceitos no ciclo existente, em TypeScript; nenhuma cópia de store, configuração ou identidade |
| Ada — tentativa em bancada isolada e crítica por diff/evidência | Adotar para eval e mudanças estruturais; preservar trabalho em andamento e tentativa anterior |
| Ada — importância/domínio, índice reconstruível, busca híbrida medida | Adotar o método; calibrar com casos do Omni, sem importar pesos/modelo como verdade |
| Ada — episódios separados e captura mínima | Adotar; episódios ficam fora do contexto habitual, acesso somente por relevância e necessidade |
| Ada — dados pessoais no repositório, caminhos/SID fixos e hooks prontos | Não importar. O inventário anterior revelou arquivos/pointers de transcripts; isso não comprova, por si só, conteúdo bruto ou segredo ativo exposto. Não houve varredura de credenciais. |

Fontes Ada inspecionadas no commit `0451242b2abd58dbb6e56ff6cfe8a133f73e1135`:
[missões](https://github.com/rodkamout/ada/blob/0451242b2abd58dbb6e56ff6cfe8a133f73e1135/tools/ada-missions/README.md),
[store](https://github.com/rodkamout/ada/blob/0451242b2abd58dbb6e56ff6cfe8a133f73e1135/tools/ada-missions/store.mjs),
[rotinas e crítica](https://github.com/rodkamout/ada/blob/0451242b2abd58dbb6e56ff6cfe8a133f73e1135/tools/ada-missions/routines.mjs),
[índice local](https://github.com/rodkamout/ada/blob/0451242b2abd58dbb6e56ff6cfe8a133f73e1135/_ops/local-index/README.md).
São referência de desenho; resultados relatados pela Ada não são benchmarks do Omni.

## Etapas de implantação e dependências

### F0 — Consolidar a base e preparar execução isolada

Entrada: árvore local 0.22.1 com trabalho de várias sessões; instalação auditada 0.22.0; identidade divergente.

1. Inventariar alterações e separar o conjunto revisado desta entrega, preservando alterações externas.
2. Criar snapshot isolado identificado de fonte + diff selecionado + emit. Para avaliar WIP, o snapshot
   deve incluir explicitamente a candidata; worktree apenas de HEAD não contém essas alterações.
3. Capturar baseline de testes e corpus de regressão; identificar plugin instalado/carregado por sessão.
4. Ler estado atual do PostgreSQL e credencial disponível pelo mecanismo suportado do host. A sessão
   anterior terminou no acesso administrativo; não presumir que o banco `omni` foi criado.
5. Preparar migrations e ajuste documental de escopo/store único; alinhar catálogo e schemas.
6. Preparar C0: inventário dos acessos usados/oferecidos, autoridade já concedida e caminho seguro
   de bootstrap; não coletar valores de credenciais no inventário.

Aceite: snapshot reproduzível; diferença explicada; benchmark da versão instalada separado da candidata;
precondições de banco conhecidas. Nenhum commit é formado juntando indiscriminadamente a árvore suja.

### F1 — Corrigir personalidade, captura e devolução de tarefas

Depende de F0; entrega útil com o backend atual, sem esperar pgvector ou toda a migração.

- Corrigir feedback de constância/persistência, negação “nem funcionou”, citações e elogios genéricos;
  registrar observação não vinculada separadamente de voto em resposta específica.
- Corrigir intenção com vocativos, perguntas de capacidade, paráfrases e continuidade do pedido;
  conferir compromisso e responsável além da regex de imperativos.
- Fechar retorno antecipado que pula a auditoria. O segundo Stop não deve validar falha; enquanto
  F3 não estiver ativa, informar pendência real sem alegar que um worker fictício vai executá-la.
- Reservar núcleo compacto de voz + direção aprendida + exemplo curto nas transições relevantes,
  sem expulsar objetivo/correção ou repetir galeria grande após cada ferramenta.
- Iniciar captura estruturada de fatos/escopo e separar instrução transitória de memória estável.
- Execução VS Code preserva alvo literal e valida estados distintos: workspace, painel, sessão e briefing.
- Destravar eval de preparação usando snapshot F0; responder com resultado e decisão clara.

Aceite: casos A02/A04 falham antes e passam depois; exemplos de pedido de instruções/autoridade legítima
continuam válidos; a nova raiz passa smoke de voz e iniciativa. Cortar release comportamental própria
com instalação/readback, sem declarar A03 resolvido antes de existir seu consumidor.

### F2 — Memória canônica PostgreSQL + cache e aprendizado entre sessões

Depende de F0 e do bootstrap C0; integração final usa F1. Primeiro salto de banco sem dependência
de embeddings. C1 acompanha esta entrega, sem guardar segredos nas tabelas de memória.

- Provisionar banco e roles do Omni; migrations versionadas e idempotentes; adapter PostgreSQL atrás
  das portas. Reaproveitar tipos/IDs existentes e validar entradas desconhecidas.
- Integrar C1: metadados de acessos separados, roles de aprendizado e autoridade distintas,
  RLS nas tabelas compartilhadas, credencial de aplicação pelo cofre e teste de acesso efetivo no
  ambiente correto. Memória não ganha acesso ao schema `access` ou `vault` por compartilhar o banco.
- Persistir conteúdo, feedback, perfil ativo e revisão com outbox; conectar consumidores de conteúdo
  ao montador real, eliminando a exigência de release para aprender preferência/procedimento pessoal.
- Implementar cache atômico, revisão/invalidação e journal de contingência conforme este plano.
- Fazer importação de memória e aprendizado com classificação item a item; 46 confirmadas/7 candidatas
  são baseline da auditoria, não contagens fixas. Preservar origem, status, histórico e rejeições.
- Reclassificar o voto falso comprovado e recalcular efeitos derivados com trilha de retificação;
  não apagar ou inverter outros votos sem evidência.

Aceite: correção explícita aparece na sessão atual e na próxima sessão Omni ativa do mesmo escopo,
sem commit ou comando humano; concorrência não perde revisões; banco indisponível preserva voz e
registra sincronização pendente; restauração de backup reproduz dados e revisões.

### F3 — Missões, autocorreção executável e ativação honesta

Depende de F2 para o store operacional escolhido e de C2 antes de ativar o consumidor autônomo;
testes de contrato podem ser preparados após F0.

- Migrar o ciclo existente para a persistência transacional, com outbox/claim/epoch e um único escritor
  por fase do cutover. Reconciliar turnos, delegações, melhorias e respectivas autoridades.
- Ligar cada achado acionável a reparo com envelope e consumidor; supervisão real e retorno com recibo.
- Registrar leases/recibos de despacho; retomar trabalho pela identidade, sem exigir repetir frase.
- Integrar o Crachá no despacho/retomada e no executor: concessão mínima por missão, validade,
  revogação e impedimento de novos efeitos sem autoridade vigente; segredo nunca via briefing.
- Verificar efeito de escrita interrompida antes de retry; crítica proporcional e readback independente.
- Ativação: adaptador declara capacidade real de recarga. Se não puder recarregar com segurança,
  registrar espera por inicialização do host; hook da raiz nova confirma conclusão. Nunca fabricar
  `queued` de um worker ausente nem encerrar sessões em uso para produzir prova.
- Classificar dívida histórica: acionável, aguardando prova, substituída, falha terminal ou não
  verificável. Arquivar sem prova não conta como reparo; não reexecutar mutações antigas indiscriminadamente.

Aceite: matar o processo de teste após claim/despacho/efeito não perde tarefa nem duplica efeito; reparo
seguro retoma sem mensagem humana; executor antigo não sobrescreve resultado; retorno chega e é
confirmado. Contador saudável mede resultado verificado, não só encaminhamento para fila.

### F4 — Recuperação híbrida e medição de relevância

Depende de F2; não bloqueia a entrega da F3.

- Construir corpus PT-BR com fatos, identificadores exatos, paráfrases, escopos distintos, negações e
  memórias revogadas. Preservar holdout para não otimizar só os exemplos conhecidos.
- Comparar FTS/trigram com híbrido; escolher provedor/modelo de embeddings por ganho e custo no corpus.
  Preferir execução local compatível com a máquina, sem instalar modelo pesado sem medir capacidade.
- Jobs de embedding identificados por conteúdo/revisão/modelo; só recalcular mudanças; remover versões
  superadas. Começar busca exata no corpus pequeno; índice aproximado só com necessidade medida.
- Ordenar por relevância com influência limitada de importância/recência. Medir qualidade e custo
  em cada revisão; não importar os pesos publicados pela Ada.

Aceite: híbrido supera baseline em Recall@k/MRR no holdout sem regressão dos identificadores críticos;
escopo incorreto e item revogado nunca aparecem; desligar embedding mantém FTS/cache operacionais.
Se não houver ganho, manter FTS e registrar resultado: banco/autonomia não ficam esperando vetor.

### F5 — Prova comportamental, rollout e observação

É critério de toda release, com rodada integrada após F1–F3; comparar F4 quando ativada.

- Testar no host instalado: ativação, nova sessão, resume/clear/compact, conversa longa, sequência de
  ferramentas, falha, pedido de concisão e correção do proprietário.
- Testar Crachá nas duas direções: acesso usado, capacidade oferecida, isolamento por consumidor,
  concessão expirada/revogada, credencial rotacionada, segredo ausente e indisponibilidade do provedor.
- Medir perfil/versão entregues, resposta observada, memória utilizada e execução concluída. Separar
  julgamento automático de reconhecimento espontâneo do proprietário; não fabricar aprovação humana.
- Implantar por etapas: schemas aditivos → versão compatível → leitura sombra → corte de escritor
  → canário em sessão nova → ampliação. Autoridade do escritor identificada por versão/epoch.
- Sessões antigas permanecem visíveis como antigas. Antes de migrar, capturar delta dos stores
  legados; impedir nova divergência por um mecanismo testado de compatibilidade/quiescência. Não
  assumir que atualização do plugin encerra os processos antigos.
- Observar 24–48 horas de uso como janela proposta: recorrência, pendências, latência, divergência de
  cache, falhas de sync e retorno de missões. Esse período não exige teste manual do proprietário.

Aceite: cada release declara commit remoto, versão/fingerprint instalado e carregado, cobertura real e
pendências. Não chamar o plano completo de concluído antes de resolver achados ou documentar o limite
comprovado do host. Horas sem uso não contam como prova de constância em conversa.

## Critérios mensuráveis da implantação

Metas propostas, a calibrar pela baseline F0; não são resultados já alcançados.

| Comportamento | Verificação |
|---|---|
| Não devolver execução | Todos os casos A02 e novas paráfrases adversariais preservam responsabilidade; nenhuma falsa conclusão |
| Feedback correto | Queixa de constância reconhecida; “nem funcionou” não elogia; citação não vira preferência; elogio genérico não apaga correção específica |
| Memória efetiva | Fatos úteis recuperados, ruído transitório excluído; correção visível no próximo turno iniciado após commit no mesmo escopo |
| Contexto estável | Blocos críticos sem corte silencioso; voz observável nos checkpoints de nova sessão/compactação/pós-ferramenta |
| Latência | Meta inicial p95 ≤ 100 ms para leitura local do perfil; ≤ 500 ms para recuperação; orçamento explícito de fallback sem consumir o teto de 10 s do hook |
| Recuperação | Ensaios de crash, entrega duplicada, epoch antigo e efeito incerto; nenhuma perda ou repetição cega |
| Crachá | Materializa e usa acesso já concedido sem aprovação repetida; escopo/identidade conferidos em cada efeito; expiração/revogação inclusive da concessão-mãe respeitadas após retomada; nenhum segredo em memória/log/briefing |
| Saúde das credenciais | Vencimento, rejeição e motivo registrados por versão; timeout/escopo insuficiente não invalidam globalmente; renovação autorizada e nenhum uso de token expirado por atraso do scheduler |
| Eval útil | Preparação isolada não espera árvore principal limpa; mesma candidata/modelo/configuração; casos sequenciais e holdout |
| Fonte/instalação | Identidade de payload íntegra; nenhum aprendizado altera cache de código; sessões antigas não contam como validação da nova versão |

## Migração e rollback

1. Snapshot privado e export verificável de todos os stores de entrada; inventário por ID/status/hash.
2. Importação em staging PostgreSQL por item, com quarentena de entrada inválida e relatório de delta;
   cada repetição da importação é idempotente.
3. Leitura sombra compara resultados e escopo com o backend atual antes da troca.
4. Cutover controla escritor e versões antigas, incorpora deltas e produz recibo de revisão final.
5. Rollback de código deve continuar lendo o schema compatível ou receber export de **todas as novas
   revisões** antes de voltar ao JSON. Nunca restaurar só o backup inicial e perder aprendizado novo.
6. Reverter índices/cache por reconstrução; conteúdo canônico é preservado. Não remover campos/tabelas
   legados antes de provar migração, retorno e restauração.
7. No Crachá, preservar concessões e revogações mais recentes durante rollback; não restaurar uma
   autorização vencida como ativa. Restaurar política/identidade antes de reativar consumidores e
   testar separadamente a recuperação das referências ao cofre. Backup de memória não contém segredos.

Acesso administrativo ao PostgreSQL é dependência real. Primeiro usar credencial disponível em mecanismo
suportado. Se for inevitável uma redefinição ou reinício do serviço compartilhado, preparar impacto e
reversão e obter a autoridade específica pelo fluxo da ferramenta. Não buscar segredos em logs nem
devolver provisionamento ao proprietário. Este planejamento não reinicia o PostgreSQL.

## TypeScript e rastreabilidade

Novas regras puras em `src/core`; casos de uso em `src/application`; `MemoryRepository`,
`MemoryExtractor`, `PersonalityProfileStore`, `OperationalCycleStore`, `Outbox`, `ExecutorPort`,
`EvidenceReader`, `EmbeddingProvider` e `HostActivationPort` em portas; PostgreSQL/JSON/Claude/Windows
em adapters. Reutilizar as portas equivalentes já existentes. Migrations e schemas ficam no Git;
tipos/fixtures derivados têm geração determinística. `dist` é testado e fingerprintado após build.

Para o Crachá, reutilizar `AuthorityEvaluator` e acrescentar, conforme os casos de uso, portas
`AccessRegistry`, `IdentityVerifier`, `GrantRepository` e `CredentialProvider`. A última entrega
credenciais apenas ao adaptador confiável, nunca como ferramenta genérica para o modelo listar
segredos. O modelo pode propor e acionar a materialização de uma concessão; emissão/alteração exige
autoridade autenticada, que pode já existir e ser aplicada automaticamente pelo serviço do Crachá.
Enums de efeito já existentes devem ter conversão explícita e testada, sem interpretações mais
permissivas na ponte. Implementação em TypeScript não substitui enforcement fora do modelo.

O store usa transações curtas e controle de revisão; rede/modelo nunca ficam dentro de lock aberto.
PostgreSQL documenta a liberação de locks de linha ao terminar a transação, o que fundamenta essa
separação entre claim e execução. [Concorrência no PostgreSQL](https://www.postgresql.org/docs/18/explicit-locking.html#LOCKING-ROWS).

| Evidência anterior | Etapas responsáveis |
|---|---|
| A01 — entrega/identidade | F0, release F1 e F5 |
| A02 — devolução/classificação | F1; continuidade pela F3 |
| A03 — reparo e reload sem consumidor | F3, incluindo supervisão, retorno e limites do host |
| A04 — feedback ignorado/invertido | F1; persistência e retificação na F2 |
| A05 — eval preso na árvore suja | F0, F1, F5 |
| A06 — contexto truncado | F1, F2, F4, F5 |
| A07 — eval diferente da conversa real | F5 desde a primeira entrega comportamental |
| Sessão 04/09 — captura, escopo e conteúdo sem release | F1, F2, F4 |
| Incidente Hub — alvo literal/estado indevido | F1 e cenário de host em F5 |
| Inspiração Ada aprovada | F2–F4, no ciclo único do Omni |
| Crachá — acessos usados e oferecidos, ainda não construído | C0 após F0, C1 com F2, C2 como gate de F3; prova no host em F5 |

Documentos de origem: [auditoria de 08/09](../auditorias/2026-09-08-queixas-personalidade-autonomia.md),
[auditoria do incidente Hub](../auditorias/2026-08-31-personalidade-contexto-vscode.md),
[backlog TypeScript](../backlog/typescript-e-personalidade.md),
[ADR-002](../decisoes/ADR-002-omni-independente-portas-neutras.md) e
[ADR-003](../decisoes/ADR-003-typescript-emit-e-release-carregada.md).
Base do Crachá: [credenciais](../../contratos/operacao/credenciais.json),
[autoridade](../../contratos/operacao/autoridade.json),
[porta de avaliação](../../src/ports/authority-evaluator.ts) e
[ponte com Overcore](../integracoes/overcore-authority-provider.md).
Sessão de referência: `9c1c09b9-2fd0-4782-af70-c630f9a84f72`, “Memória do hub e autocorreção”, 04/09.

Sequência de valor: **primeiro corrigir a interação e preparar o Crachá; depois consolidar conteúdo e
acessos; ativar missões somente com autorização aplicada; então melhorar a busca onde houver ganho
medido.** Todos os marcos incluem verificação pelo Omni. Crachá entra no planejamento; nenhuma
credencial, concessão ou infraestrutura foi criada por esta atualização documental.
