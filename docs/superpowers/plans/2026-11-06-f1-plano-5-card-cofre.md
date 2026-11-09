# F1, plano 5: card Cofre na ilha — plano de implementação

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhamento.

**Objetivo:** o card Cofre da ilha (§8.2): lista com busca e filtros, cadastro sem chat, ver e copiar atrás do Windows Hello com prazo de 30 s, teste ao vivo por tipo (Postgres incluído, só pelo túnel), editar, rotacionar, apagar para a lixeira de 30 dias, histórico por credencial e a verificação de saúde. A ilha não abre o banco: fala com a CLI do cofre.

**Arquitetura:** a loja do plano 4 ganha gestão (histórico, saúde, edição, rotação, lixeira) e o caminho do dono (ver e copiar), que só existe atrás de uma ponte de presença nova (`runtime/casa/presenca.mjs`, Windows Hello pelo PowerShell 5.1). A CLI `runtime/cofre.mjs` ganha os comandos; o valor revelado sai pelo descritor 3, nunca pelo stdout, e o copiado vai da ponte direto para a área de transferência. Na ilha, `apps/omni-ilha/cofre.js` é a mão: chama a CLI com o Node do sistema (≥ 22.13), porque o Electron emprestado é o 33, com Node 20 e sem `node:sqlite`. Uma janela própria (`cofre.html`) e um card no `index.html` usam a mão por IPC guardado por remetente.

**Tecnologia:** `node:sqlite`, Node ≥ 22.13 na CLI, Node 20 (Electron 33) na ilha, `node:test`, `node:net`/`node:tls`/`node:crypto` (protocolo do Postgres com SCRAM-SHA-256 e MD5, sem dependência), PowerShell 5.1 com WinRT (`UserConsentVerifier`) e .NET (`Clipboard`). Nenhuma dependência npm nova.

**Desenho:** [Casa única: Omni, Overcore e Oráculo](../specs/2026-11-04-casa-unica-tres-agentes-design.md): §8.2 (o card), §3.4 (a ilha não abre o banco; pergunta à API do Omni), §8.3 (o broker por pipe fica para a F2) e §6 (a F1 inclui o card).

**Situação em 07/11/2026:** entregue no commit `45f3977`, com o CI igual ao verify local; ficam pendentes do Weriton as partes B e C da T8. A Preparação e as tarefas 1 a 4 foram executadas, a T3 antes da T2, de que não depende: na T1, 54 testes verdes e 31 mutantes; na T3, 26 testes verdes e 32 mutantes; na T2, 28 testes verdes e 30 mutantes, que rodaram só com os testes falsos (executor, item 23); todos esses mutantes vermelhos pela asserção. Na T4, 19 testes verdes e 26 mutantes, 25 vermelhos pela asserção e 1 equivalente declarado, e o furo do `check` fechado para a presença e o fio. Na T5, 10 testes verdes e 31 mutantes, todos vermelhos pela asserção. Na T6, 9 testes verdes e 25 mutantes, todos vermelhos pela asserção, e a prova visual da janela com 23 conferências verdes. Na T7, 13 testes verdes e 20 mutantes, todos vermelhos pela asserção, e a prova visual do card com 14 conferências verdes. Na T8, a parte A verde nos Nodes 24 e 22 (17 conferências e 141 testes em cada); as partes B (Hello e área de transferência reais) e C (Postgres ao vivo) ficam abertas: a B porque o Hello responde indisponível nesta conta, sem PIN nem biometria, e a C porque espera o ok do Weriton. Na T9, as 11 suítes afetadas com 109 testes verdes, o verify com 819 testes e só o vermelho de nascença `:165`, e o `.test-dist`, o `test:dist` e o `verify:build` verdes à parte. Na T10, a varredura do índice com 0 achados, o commit `45f3977` pela conta dona e o CI com o Linux verde e o Windows vermelho só no `:165`, com 819 testes.

---

## Posição na F1

Este é o plano 5 dos oito da F1 ([escopo no plano 1](2026-11-04-f1-casa-sqlite.md#escopo-a-f1-em-oito-planos)). O plano 4 deixou o `cofre.db` vivo, com a v1 congelada no push (`ef87498`), a loja, a ponte DPAPI e a CLI. Este plano põe a cara do cofre na ilha.

A v1 congelada cobre o plano inteiro, sem migração: `validade`, `rotacionar_dias`, `ultimo_teste_*`, `versao` (rotação e edição), `apagado_em` (lixeira) e `usos` (histórico). `usos.resultado` é `TEXT NOT NULL` sem CHECK, então os resultados novos (`revelado-ao-dono`, `copiado-ao-dono`, `recusado-presenca`, `falhou-copiar`, `rotacionado`, `conferido-saude`) cabem nela. Se algo exigir esquema novo no cofre, é a v2.

Fica fora deste plano:
- o broker por pipe e as rotas `/v1/cofre/*` do `servir` (F2). As rotas vão manter as formas de resposta da mão deste plano, para a troca ser só de transporte;
- a ativação na casa real, que só acontece depois do merge, com o ok do Weriton e com cópia datada dos originais (§8.1);
- a prova ao vivo do Postgres com uma credencial real pelo túnel, que depende do ok do Weriton na hora da T8 e não segura o plano (a PG usa um servidor falso local).

## Decisões (dentro do desenho, sem autoridade nova)

1. **A mão chama a CLI com o Node do sistema.** `apps/omni-ilha/cofre.js` resolve o Node por `OMNI_NODE` ou pelo `PATH` e confere `process.versions.node ≥ 22.13` uma vez por sessão da ilha. Sem esse Node, o card mostra o motivo e falha fechado: nada de `process.execPath` (Node 20, sem `node:sqlite`). O §3.4 recomenda exatamente isso, a ilha perguntando em vez de abrir o banco.
2. **Ver exige presença a cada vez, dentro da CLI.** `revelar` chama a ponte de presença antes de abrir o blob. Se a checagem morasse na ilha, um agente rodaria a CLI no shell e pularia o Hello. O valor sai pelo descritor 3: um agente que roda a CLI captura stdout e stderr, não o fd 3. Sem fd 3 aberto, a CLI recusa antes de chamar o Hello, para não disparar pedido de digital à toa.
3. **Copiar também atrás do Hello.** É mais estrito que o §8.2, que só pede Hello para ver, e é reversível. Copiar entrega o mesmo segredo que ver.
4. **A área de transferência não é o Electron quem escreve.** O `clipboard.writeText` do Electron grava só texto, e o Windows guarda o texto no histórico do Win+V e na área de transferência na nuvem, onde os 30 s não alcançam. A ponte grava o valor com os formatos `ExcludeClipboardContentFromMonitorProcessing`, `CanIncludeInClipboardHistory = 0` e `CanUploadToCloudClipboard = 0`, os mesmos que os gerenciadores de senha usam. Ela anota o `GetClipboardSequenceNumber` logo depois de gravar, descarta o valor e, aos 30 s, limpa a área só se o número não mudou, isto é, se ninguém copiou outra coisa por cima. Assim a limpeza não precisa guardar o valor nem um hash dele. O processo de limpeza é um PowerShell destacado, que sobrevive à CLI. A T2 escreve isso com o `executar` injetado; a área de transferência real só é tocada na T8, com o Weriton. A resposta da ponte é `{ ok, limpaEm?, erro? }`.
5. **O dono não é um agente.** `revelar` e `copiar` registram o uso com `agente = 'dono'`. O nome `dono` passa no regex `AGENTE`, então fica reservado: `cadastrar` e `editar` recusam `dono` em `agentes` (`agente-reservado`), a importação do pacote marca como `invalida` o item que o traz, e `usarCredencial` recusa `agente = 'dono'` com `agente-sem-acesso`, registrado como `recusado-agente`. Sem isso, um cadastro com `dono` na lista abriria o valor a quem pedisse como `dono` pelo shell, sem Hello. Os mutantes 06 e 07 da T1 cobrem as duas recusas.
6. **Saúde com as cinco regras do §8.2.** São elas: vence em até 15 dias (ou já venceu); falhou no último teste; sem uso há 90 dias, contando só `entregue`, `revelado-ao-dono` e `copiado-ao-dono`; mesmo valor em dois cadastros; agente autorizado que nunca usou. O blob da DPAPI tem sal aleatório, então o valor igual não aparece no `blob_sha256`: a regra de duplicata abre os blobs numa chamada da ponte, compara em memória, zera os Buffers e devolve só os pares de nomes. Ela roda só quando pedida (`saude --duplicatas`) e registra `conferido-saude`, que a regra de 90 dias ignora. O card usa a saúde sem duplicata.
7. **Lixeira pelo `apagado_em`.** `apagar` marca a data e sobe a `versao`; `restaurar` volta se não houver credencial viva com o mesmo nome (`ja-existe`); `esvaziar-lixeira` apaga de vez só o que tem mais de 30 dias, e a janela chama isso ao abrir. O índice único de `nome` já é parcial (`WHERE apagado_em IS NULL`), o que permite recadastrar um nome que está na lixeira.
8. **Testador de Postgres sem dependência.** `node:net` e `node:tls`, com `SSLRequest`, SCRAM-SHA-256 e MD5, `SELECT 1` e `Terminate`. Só aceita loopback (`127.0.0.1`, `::1`, `localhost`): qualquer outro host é recusado antes de abrir o socket, com a mensagem de usar o túnel. O testador não conhece endereço da casa, e o teste prova a recusa sem nenhum `connect`, com endereços de documentação (RFC 5737) e nomes `.invalid`.
9. **A janela e o card seguem o molde do Overcore e do Actions:** `cofre.html` com `cofre-janela.js` e `cofre-preload.js`; os IPCs guardados por `daJanelaCofre` (e o resumo do card por `daIlha`); o card só mostra contagens e alertas e abre a janela. O valor só aparece na janela, no máximo por 30 s, e o renderer apaga o campo no fim do prazo.
10. **Cadastro sem chat.** O valor entra digitado ou colado num campo de senha da janela, ou pela área de transferência: nesse caso o main lê, manda para o stdin da CLI e limpa a área. O valor nunca passa pelo renderer do card, pelo chat nem pelo WhatsApp.
11. **Cada regra de saúde olha só onde faz sentido.** Vence (o já vencido entra) e teste que falhou valem para todas as guardas. Sem uso, agente que nunca usou e duplicata valem só para a guarda `dpapi`: a credencial do Gerenciador não passa pelo cofre e nunca teria uso registrado (mutante 17). A saída é `{ total, alertas, duplicatas }`: `total` conta as credenciais vivas, e os alertas são `{ regra: 'vence', nome, validade }`, `{ regra: 'teste-falhou', nome, em }`, `{ regra: 'sem-uso', nome, desde }` (`desde` é o último uso real ou, sem uso, o `criado_em`) e `{ regra: 'agente-nunca-usou', nome, agente }`. `duplicatas` é `{ pares, naoAbriram }` quando pedida e `null` quando não; pedida sem ponte, dá `dados-invalidos`.
12. **O agente que nunca usou ganha 90 dias de cadastro antes de virar alerta** (`CARENCIA_AGENTE`). O alerta só entra quando a credencial não está em sem-uso (`else if`), para a mesma credencial não acusar duas vezes, e conta só `entregue`: o dono vendo não é uso do agente. Limitação declarada: o agente acrescentado por edição conta a carência do `criado_em` da credencial, não do dia em que entrou na lista. Mutantes 13 e 18.
13. **O `omni` assina a manutenção.** A conferência de duplicatas registra `conferido-saude` (motivo `conferencia de duplicatas`) em cada credencial que abriu e `falhou-abrir` na que não abriu; a rotação registra `rotacionado` (motivo `rotacao`). Se a ponte lançar na conferência, o erro sobe sem registro. Os valores abertos são zerados no `finally` (mutante 05).
14. **Rotação.** Sela o valor novo fora da transação, sobe a versão e zera `ultimo_teste_*`, porque o teste antigo era do valor antigo (mutante 11). Recusa a guarda do Gerenciador com `gerenciador-windows` antes de chamar a ponte (mutante 21). O UPDATE confere `apagado_em IS NULL`: se a credencial foi apagada entre a leitura e a gravação, nenhuma linha muda e sai `inexistente`.
15. **Edição.** Só os campos de `EDITAVEIS` (`tipo`, `servico`, `url`, `usuario`, `notas`, `etiquetas`, `agentes`, `validade` e `rotacionar_dias`); qualquer outro dá `dados-invalidos` ("Campo(s) que não se editam: …"). Não há renomear: o nome é o endereço que os agentes pedem. A edição passa pelo `normalizarDados`, então `dono` em `agentes` dá `agente-reservado`. Edição que não muda nada devolve a credencial como está, sem subir a versão (mutante 16).
16. **Histórico por id, não por nome.** O nome de uma credencial apagada pode ser recadastrado, e o id não muda. `historicoCredencial(db, id, { limite = 50 })`, com limite de 1 a 500, do mais novo ao mais velho (`em DESC, rowid DESC`, mutante 19), devolve `em`, `agente`, `sessao`, `motivo` e `resultado`, nunca o valor. Vale para a credencial na lixeira; depois de esvaziada, dá `inexistente`, mas os usos ficam no banco.
17. **Import da pasta não ressuscita o apagado.** Um `.dpapi` cujo hash já foi ingerido, sem credencial viva com o nome, sai como `apagada` e não volta (mutante 12); valor novo no mesmo arquivo entra. O pacote fica fora dessa regra: importar um pacote é escolha explícita, com a frase-mestra.
18. **Sem `secure_delete`.** Esvaziar a lixeira apaga a linha, mas o blob pode sobrar em página livre do SQLite ou no WAL até ser reescrito. Ele continua selado pela DPAPI do usuário, e isso fica declarado em vez de pagar o `secure_delete` em toda escrita.
19. **Presença.** A loja recebe a presença como função síncrona que devolve `{ ok, motivo? }`. Presença ausente ou que não é função dá `dados-invalidos` sem registro; se ela lançar, registra `recusado-presenca` e o erro sobe; se `ok !== true`, registra `recusado-presenca` e lança `sem-presenca` (mutante 08). O motivo do uso é `ver` ou `copiar`, e o agente é `dono`. `recusado-inexistente` e `recusado-gerenciador` saem antes de chamar a presença (mutante 20): não se pede digital para o que não pode ser aberto.
20. **Cópia.** A ponte ganha `abrirParaAreaDeTransferencia(blob)`, que devolve `{ ok, limpaEm?, erro? }`. Se ela lançar ou devolver `ok` falso, a loja registra `falhou-copiar`; no `ok` falso, lança `nao-copiou`. `copiarAoDono` devolve só `{ usoId, limpaEm }`, com `limpaEm` nulo quando a ponte não informa: o valor não volta à loja.
21. **`agentes: []` é permitido:** a credencial que só o dono vê e copia, sem nenhum agente.
22. **Vocabulário de `usos.resultado`.** Os do plano 4 (`entregue`, `recusado-inexistente`, `recusado-agente`, `recusado-gerenciador`, `falhou-abrir`, `exportada`) e os novos (`revelado-ao-dono`, `copiado-ao-dono`, `recusado-presenca`, `falhou-copiar`, `rotacionado`, `conferido-saude`). Os códigos de erro novos da loja são `agente-reservado`, `sem-presenca` e `nao-copiou`.
23. **O veredito do Postgres tem três estados.** `ok: true` só quando a senha foi provada (SCRAM com a assinatura do servidor conferida, ou MD5) e o `SELECT 1` voltou `1`; o detalhe é `SELECT 1 respondido (<método>, TLS|sem TLS)`. `ok: false` só no SQLSTATE `28P01`, com o detalhe `senha recusada (28P01)`. Todo o resto é `ok: null`: trust (não prova nada), texto puro (recusado sem enviar a senha), GSS, SSPI e SCRAM-SHA-256-PLUS, servidor que não se prova, mensagem fora do protocolo, tempo esgotado (10 s, e o `Terminate` sai mesmo assim), queda, `ECONNREFUSED` (com a pergunta do túnel) e qualquer outro SQLSTATE. O detalhe leva só o método, o TLS e o SQLSTATE: nunca a senha, o usuário nem a mensagem do servidor, que pode citar usuário e banco.
24. **TLS sem conferir certificado.** O `SSLRequest` vai sempre. Com `S`, o TLS sobe sobre o mesmo socket com `rejectUnauthorized: false`: o túnel SSH já autentica o salto e cifra o caminho, e a casa não tem a CA do banco, então o TLS aqui só atende ao `hostssl` do servidor. Com `N`, segue sem TLS. Resposta ao `SSLRequest` com mais de um byte é recusada antes do TLS (o golpe do CVE-2021-23222 contra a libpq).
25. **A url e o valor.** A url não pode trazer senha (`URL_COM_SENHA`): a senha mora no valor. O usuário vem do campo `usuario` da credencial ou, sem ele, da url; o banco vem do caminho. Caractere nulo no usuário ou no banco é recusado. `localhost` vira `127.0.0.1` sem resolver nome. Valor com cara de url (`postgres://` ou `postgresql://`, maiúscula ou não) fica sem veredito, com o aviso de cadastrar a url no campo certo. LF e CR no fim do valor não contam: o valor colado costuma trazê-los. No SCRAM, a senha com byte acima de 0x7F torna o `28P01` inconclusivo, porque o servidor passa a senha pelo SASLprep e o teste não.
26. **SCRAM sem atalho.** O nonce do servidor tem de estender o do cliente; o sal tem de ser base64 canônico e não vazio; as iterações vão de 1 a 1.000.000 (`MAX_ITERACOES`), para um servidor hostil não prender a CPU; `m=` (extensão obrigatória) é recusado. A assinatura do servidor é comparada com `timingSafeEqual`, e o `AuthenticationOk` sem ela é recusado. As chaves derivadas e o intermediário do MD5 (que vale a senha nesse método) são zerados.
27. **O testador e a loja.** Só `tipo = 'conexao'` com url `postgres://` ou `postgresql://` vai ao fio. Url recusada volta `ok: null` sem abrir o valor. O valor aberto vai ao fio e é zerado no `finally` pelo mesmo `comValor` da OpenAI. Quem grava o resultado é o `registrarTeste` do plano 4, e a TC 6 prova o ciclo inteiro antes e depois da rotação.

## Mapa de arquivos

| Arquivo | Responsabilidade | Tarefa | Importa |
|---|---|---|---|
| `runtime/casa/loja-cofre.mjs` (modificado) | Gestão: `historicoCredencial`, `saudeCofre` (com a conferência de duplicatas), `editarCredencial`, `rotacionarCredencial`, `apagarCredencial`, `restaurarCredencial` (por id), `listarLixeira` e `esvaziarLixeira`; o caminho do dono: `revelarAoDono` e `copiarAoDono`; `dono` reservado; o import da pasta que não ressuscita o apagado | T1 | `node:fs`, `node:path`, `./banco.mjs`, `./pacote-cofre.mjs`, `./projecao.mjs` |
| `runtime/casa/presenca.mjs` (novo) | Ponte de presença: `criarPontePresenca()` com `disponivel()` e `verificar(mensagem)`, Windows Hello pelo PowerShell 5.1 | T2 | `node:child_process` |
| `runtime/casa/dpapi.mjs` (modificado) | `abrirParaAreaDeTransferencia(blob)`: abre e grava fora do histórico e da nuvem, com a limpeza destacada aos 30 s | T2 | — |
| `runtime/casa/postgres-fio.mjs` (novo) | Protocolo do Postgres sem dependência: `SSLRequest`, SCRAM-SHA-256, MD5, `SELECT 1` e `Terminate`, só em loopback | T3 | `node:net`, `node:tls`, `node:crypto`, `node:util` |
| `runtime/casa/testadores-cofre.mjs` (modificado) | `conexao` com URL `postgres://` vai para o testador de Postgres | T3 | `./postgres-fio.mjs` |
| `runtime/cofre.mjs` (modificado) | Comandos novos: `historico`, `saude`, `editar`, `rotacionar`, `apagar`, `restaurar`, `lixeira`, `esvaziar-lixeira`, `revelar` (fd 3) e `copiar` | T4 | `./casa/presenca.mjs` |
| `package.json` (modificado) | `node --check` de `presenca.mjs` e `postgres-fio.mjs` no `npm run check` | T4 | — |
| `apps/omni-ilha/cofre.js` (novo) | A mão: chama a CLI com o Node do sistema (≥ 22.13), com limites de tempo, e lê o fd 3 só no `revelar` | T5 | `node:child_process` |
| `apps/omni-ilha/cofre-ipc.js` (novo) | Os canais `cofre:*`: remetente, conversão do que vem do renderer, Buffer zerado, a área lida no main e limpa só se não mudou, o revelado com prazo e o resumo do card | T6 | — |
| `apps/omni-ilha/cofre.html`, `cofre-janela.js` e `cofre-preload.js` (novos) | A janela do cofre | T6 | `electron`, só no preload |
| `apps/omni-ilha/main.js` e `preload.js` (modificados, pela costura) | `abrirCofre`, a janela com `setContentProtection`, o `registrarIpcCofre`; `abrirCofre` e `resumoCofre` na `window.ilha` | T6 | `./cofre.js` e `./cofre-ipc.js`, só no main |
| `apps/omni-ilha/cofre-card.js` (novo) | O que o card decide: quando ler o resumo (`deveLer`) e o que mostrar dele (`vistaDoCard`); UMD, como o `olho.js` | T7 | — |
| `apps/omni-ilha/index.html` e `renderer.js` (modificados, pela costura) | O card Cofre: o cadeado, o tom, a marcação e o estilo, a leitura no ritmo do `cofre-card.js` e o toque que abre a janela | T7 | `cofre-card.js`, por `<script>` |
| `testes/casa-loja-cofre-gestao.test.mjs` (novo) | LG, 12 testes | T1 | — |
| `testes/casa-presenca.test.mjs` (novo) | PR, 6 testes | T2 | — |
| `testes/casa-dpapi.test.mjs` (modificado) | DP, de 8 para 13 testes | T2 | — |
| `testes/casa-postgres-fio.test.mjs` (novo) | PG, 11 testes | T3 | — |
| `testes/casa-postgres-falso.mjs` (novo) | Apoio da PG e da TC, sem `test()`: o servidor Postgres falso na porta 0 (SCRAM e MD5 do lado do servidor e os roteiros de falha), `comServidorFalso`, `netEspiao`, `semPendurar` e `PRAZO` | T3 | `node:assert`, `node:crypto`, `node:events`, `node:net` |
| `testes/casa-testadores-cofre.test.mjs` (modificado) | TC, de 4 para 6 testes | T3 | — |
| `testes/cofre-cli-gestao.test.mjs` (novo) | CG, 10 testes | T4 | — |
| `testes/ilha-cofre-mao.test.mjs` (novo) | MC, 10 testes | T5 | — |
| `testes/ilha-cofre-ipc.test.mjs` (novo) | IC, 9 testes | T6 | — |
| `testes/ilha-cofre-card.test.mjs` (novo) | CC, 13 testes | T7 | — |
| `docs/superpowers/plans/2026-11-04-f1-casa-sqlite.md` (modificado) | Linha 5 do escopo | T10 | — |

- Nenhum módulo novo importa `runtime/memoria.mjs` nem pacote npm.
- `runtime/` entra no payload; `apps/omni-ilha` e `testes/` ficam fora (conferido em 06/11). Não há molde de teste da ilha no ramo: a MC é a primeira suíte que testa um arquivo de `apps/omni-ilha`.
- Siglas: LG = `testes/casa-loja-cofre-gestao.test.mjs`, PR = `testes/casa-presenca.test.mjs`, PG = `testes/casa-postgres-fio.test.mjs`, CG = `testes/cofre-cli-gestao.test.mjs` MC = `testes/ilha-cofre-mao.test.mjs`, IC = `testes/ilha-cofre-ipc.test.mjs` e CC = `testes/ilha-cofre-card.test.mjs`, além das do plano 4 (PC, DP, LC, TC, CL e CB). "LG 3" é o terceiro teste da LG: o número é sempre a posição no arquivo. Na LC isso difere do plano 4, que chama de LC 10 o teste do texto hex acrescentado pela T7 de lá, embora ele seja o 6º do arquivo; o LC 6 a LC 9 de lá são o LC 7 a LC 10 daqui.
- A T1 acrescenta 12 testes (LG): o verify passa de 736 para 748. A T3 acrescenta 13 (PG 11 e TC 2): 761. A T2 acrescenta 11 (PR 6 e DP 5): 772. A T4 acrescenta 10 (CG): 782. A T5 acrescenta 10 (MC): 792. A T6 acrescenta 9 (IC): 801. A T7 acrescenta 13 (CC): 814. As tarefas seguintes somam os delas. A essa conta faltam os 5 testes que três correções acrescentaram ao ramo depois do plano 4 (`1e7c9c9`, `a98899e` e `ce08319`, em `feedback-personalidade`, `memoria` e `varredura-diaria`): a base no HEAD é 741, e o fim, 819 (T9, Passo 3). O apoio `testes/casa-postgres-falso.mjs` não casa com o `testes/*.test.mjs` do `npm test` e não conta como suíte.

## O que o executor precisa saber antes de rodar qualquer coisa

1. **Casa real intocável.** A LG abre o banco numa casa temporária com `env` vazio, como a LC; a CLI e a mão rodam com `OMNI_HOME` e `OMNI_CASA_BANCO` dentro da casa temporária.
2. **Guarda.** `Test-Path "$env:LOCALAPPDATA\omni\casa"` dá `False` antes e depois de cada rodada (T1 a T9).
3. **Transação não reentrante e síncrona** (`runtime/casa/banco.mjs:114` e `:209`). A ponte e a presença ficam fora da transação, mas dentro da conexão; a rotação sela antes de abrir a transação; o caminho do dono pede a presença e abre o blob sem transação aberta.
4. **Segredo nunca em argv, stdout, stderr, log, erro ou coluna em claro** (plano 4, item 4). O revelado sai pelo fd 3; o copiado não volta à CLI; o cadastrado e o rotacionado chegam pela primeira linha do stdin. Os Buffers são zerados depois do uso, inclusive os abertos para comparar duplicatas (mutante 05). String do JS não se zera, e isso fica declarado: o texto que a janela mostra por 30 s e o que a área de transferência guarda são strings.
5. **Nenhuma credencial real em prova deste plano.** A prova usa uma credencial fictícia (`teste-hello`, valor descartável) numa casa temporária. Ver ou copiar um segredo real só depois da ativação, com o ok do Weriton.
6. **Hello e área de transferência reais só na T8, com o Weriton:** três toques (ver com sucesso, ver cancelado, copiar com sucesso), com a janela de teste aberta e a ilha real intocada. A sondagem da T2 só chama o `CheckAvailabilityAsync`, que não abre diálogo. Nas suítes, a presença e a área de transferência são injetadas, e nada grava na área de transferência do Weriton fora da T8.
7. **Postgres.** O testador só aceita loopback (decisão 8). A PG usa um servidor falso na porta 0. O teste ao vivo com credencial real só com o ok do Weriton na hora, pelo túnel.
8. **O Sentinel continua sem teste ao vivo** (plano 4, item 6).
9. **Vermelho de nascença `:165`.** Arquivo novo em `runtime/` muda o fingerprint do payload. A T9 anota o valor calculado e o plano 8 regenera o contrato.
10. **Payload.** `runtime/cofre.mjs` continua autoexecutável e coberto pelo `verificarCoberturaEntrypoints` (plano 4, item 8); os módulos novos de `runtime/casa/` entram no payload por morar em `runtime/`.
11. **As checagens do repositório não alcançam os módulos novos** (plano 4, item 9). A T4 acrescenta `presenca.mjs` e `postgres-fio.mjs` ao `node --check` do `npm run check`.
12. **Grafo de imports.** A T9 não escolhe suíte à mão: o `afetadas-p5.mjs` segue o grafo a partir dos arquivos de `runtime/` que este plano cria ou muda.
13. **Node 22** (plano 4, item 13). A prova e as suítes rodam também no 22.23.4, conferido pelo sha256 `cbc74b5e…5f20` e apagado no fim da T8.
14. **Shell:** item 10 do plano 2. `$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'` até a T2, Passo 4; dali em diante, `'Temp\omni-f1b'` (T2, Passo 5). Cada chamada do PowerShell é um processo novo, então cada bloco redeclara o que usa, e o que precisa atravessar passos vai para um arquivo no `$rascunho`.
15. **Fim de linha.** Arquivo novo é escrito com LF (o extrator grava LF), e antes do commit nenhum arquivo deste plano pode ter CR (T10).
16. **O código mora no plano** (plano 4, item 16). O bloco da loja deste plano substitui o do plano 4: daqui em diante o `--conferir` do plano 4 dá `DIVERGE` em `runtime/casa/loja-cofre.mjs`, e a lista de mutantes do plano 4 fica como histórico. Os dez mutantes do plano 4 que miram a loja voltam na T1 (22 a 31): oito com o trecho igual e dois ajustados. O 22 desliga a recusa do agente e deixa de pé a do dono; o 24 aponta a guarda do uso, porque o trecho do plano 4 agora aparece duas vezes (no uso e no caminho do dono). O mesmo vale na T3 para `runtime/casa/testadores-cofre.mjs` e `testes/casa-testadores-cofre.test.mjs`: o `--conferir` do plano 4 dá `DIVERGE` neles, e os mutantes 12 e 13 do plano 4, que miram o testador, voltam como 29 e 17, com o trecho igual.
17. **PowerShell 5.1 com `-EncodedCommand`** (plano 4, item 17): vale também para a presença e para a cópia. Nenhum argumento depois dele, e a mensagem do Hello vai pelo stdin.
18. **CI Linux:** item 12 do plano 2. DP 1 a 3, DP 9, DP 10 e PR 1 pulam fora do Windows.
19. **Identidade:** item 11 do plano 2.
20. **Interface.** A janela e o card passam pelo anti-slop-review e pela prova visual. A prova abre só a janela do cofre num Electron de teste, com a casa temporária; a ilha real segue rodando, sem segunda instância.
21. **CI:** o `gh run view --log-failed` volta vazio nesses jobs; o log vem por `gh api repos/<dono>/<repo>/actions/jobs/<job>/logs` (plano 4, T9).
22. **Dados de teste fictícios.** O repositório é público: nada de host, porta, IP, usuário ou nome real de credencial em teste, plano ou commit.
23. **`OMNI_SO_FALSOS=1` na rodada de mutantes da T2.** Os mesmos seis testes do item 18 também pulam quando essa variável está ligada. Repetir a suíte em sequência com DPAPI, Gerenciador e área de transferência reais, um mutante atrás do outro, tem o perfil que uma proteção de endpoint pode barrar, e no ensaio a sessão caiu no meio da rodada. O executor do plano 4 segue igual: os filhos do `run()` herdam o ambiente, então basta ligar a variável antes de chamá-lo (T2, passo 6). Os reais rodam uma vez, no verde (T2, passo 4), e nenhum mutante da T2 depende deles para morrer.

## Ferramentas

O extrator grava no repositório os blocos `arquivo=` e no `$rascunho` os blocos `rascunho=`. É o mesmo dos planos 3 e 4, sem mudança, e o executor de mutantes é o do plano 4, também sem mudança: a primeira linha do comentário ainda diz "plano 4" porque o arquivo é o mesmo, byte a byte. A preparação confere as duas cópias que já estão no `$rascunho` contra estes blocos. A tabela é nova: recebe a lista por argumento e lê da própria lista os equivalentes (campo `equivalente`, com a razão), para servir a todas as tarefas deste plano.

````js rascunho=extrair-do-plano.mjs
// Extrai do plano os blocos marcados com arquivo=<caminho> (código do repo) ou rascunho=<nome>.
// Uso: node extrair-do-plano.mjs <plano.md> <raiz-do-repo> <rascunho> [--conferir] [--so <caminho>...]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, normalize } from 'node:path'
const [plano, raiz, rascunho, ...resto] = process.argv.slice(2)
if (!plano || !raiz || !rascunho) { console.error('uso: node extrair-do-plano.mjs <plano.md> <raiz-do-repo> <rascunho> [--conferir] [--so <caminho>...]'); process.exit(2) }
const conferir = resto.includes('--conferir')
const so = resto.includes('--so') ? resto.slice(resto.indexOf('--so') + 1).filter((a) => !a.startsWith('--')) : null
const texto = readFileSync(plano, 'utf8').replace(/\r\n/g, '\n')
const bloco = /^(`{3,})(\w+) (arquivo|rascunho)=(\S+)\n([\s\S]*?)^\1$/gm
let divergiu = false; let achados = 0
for (const [, , , tipo, alvo, corpo] of texto.matchAll(bloco)) {
  if (so && !so.includes(alvo)) continue
  achados += 1
  let destino
  if (tipo === 'arquivo') { if (isAbsolute(alvo) || normalize(alvo).split(/[\\/]/).includes('..')) throw new Error(`caminho fora da raiz: ${alvo}`); destino = join(raiz, alvo) }
  else { if (/[\\/]/.test(alvo)) throw new Error(`rascunho é só nome, sem pasta: ${alvo}`); destino = join(rascunho, alvo) }
  const conteudo = `${corpo.replace(/\n+$/, '')}\n`
  let atual = null
  try { atual = readFileSync(destino, 'utf8') } catch (erro) { if (erro.code !== 'ENOENT') throw erro }
  if (conferir) { const estado = atual === null ? 'AUSENTE' : atual === conteudo ? 'igual' : 'DIVERGE'; if (estado !== 'igual') divergiu = true; console.log(`${estado} ${alvo}`); continue }
  if (atual === conteudo) { console.log(`igual ${alvo}`); continue }
  mkdirSync(dirname(destino), { recursive: true }); writeFileSync(destino, conteudo); console.log(`gravado ${alvo}`)
}
if (so && achados !== so.length) { console.error(`--so pediu ${so.length}, o plano tem ${achados}`); process.exit(1) }
process.exit(divergiu ? 1 : 0)
````

```js rascunho=mutantes.mjs
// Executor de mutantes do plano 4 da F1. Roda da raiz do repositório (o cwd), sem caminho local.
// Uso: node mutantes.mjs <lista.json>. Para cada mutante: exige o trecho uma vez só no arquivo, guarda o
// original ao lado da lista, aplica a troca, roda as suítes pelo run() do node:test, restaura sempre e
// anota cada teste que caiu em <lista>.saida.jsonl (UTF-8 sem BOM). Sai 1 se algum mutante não ficar vermelho.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { run } from 'node:test'

const [listaArg] = process.argv.slice(2)
if (!listaArg) { console.error('uso: node mutantes.mjs <lista.json>'); process.exit(2) }
const raiz = process.cwd()
const lista = JSON.parse(readFileSync(listaArg, 'utf8'))
const pasta = dirname(resolve(listaArg))
const saida = resolve(listaArg).replace(/\.json$/, '.saida.jsonl')
writeFileSync(saida, '')

let aplicado = null // { caminho, original } enquanto um mutante está no disco
const restaurar = () => { if (aplicado) { writeFileSync(aplicado.caminho, aplicado.original); aplicado = null } }
for (const sinal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sinal, () => { restaurar(); process.exit(130) })

const primeiraLinha = (valor) => String(valor ?? '').split('\n')[0]
const inicio = Date.now()
let foraDoVermelho = 0
for (const m of lista) {
  const caminho = resolve(raiz, m.arquivo)
  const original = readFileSync(caminho, 'utf8')
  const fim = original.includes('\r\n') ? (texto) => texto.replace(/\r?\n/g, '\r\n') : (texto) => texto
  const de = fim(m.de)
  const para = fim(m.para)
  const vezes = original.split(de).length - 1
  const linha = { nome: m.nome, arquivo: m.arquivo, teste: m.teste }
  if (vezes !== 1) {
    Object.assign(linha, { resultado: '??', vezes })
  } else {
    const quedas = []
    writeFileSync(join(pasta, `original-${m.arquivo.replaceAll('/', '_')}`), original)
    aplicado = { caminho, original }
    try {
      writeFileSync(caminho, original.replace(de, () => para))
      for await (const evento of run({ files: m.teste.map((suite) => resolve(raiz, suite)), concurrency: 1 })) {
        if (evento.type !== 'test:fail') continue
        const erro = evento.data.details?.error
        if (erro?.failureType === 'subtestsFailed') continue
        const causa = erro?.cause ?? erro
        quedas.push({
          teste: evento.data.name,
          suite: relative(raiz, evento.data.file ?? '').replaceAll('\\', '/'),
          nome: causa?.name ?? null,
          codigo: causa?.code ?? null,
          operador: causa?.operator ?? null,
          mensagem: primeiraLinha(causa?.message ?? causa)
        })
      }
    } finally {
      restaurar()
    }
    Object.assign(linha, { resultado: quedas.length > 0 ? 'vermelho' : 'SOBREVIVEU', quedas })
  }
  if (linha.resultado !== 'vermelho') foraDoVermelho += 1
  writeFileSync(saida, `${JSON.stringify(linha)}\n`, { flag: 'a' })
  console.log(`${linha.resultado} ${m.nome}`)
  for (const queda of linha.quedas ?? []) console.log(`  ${queda.suite} > ${queda.teste}: ${queda.nome} ${queda.operador ?? '-'} ${queda.mensagem}`)
}
console.log(`${lista.length} mutantes em ${Math.round((Date.now() - inicio) / 1000)} s; fora do vermelho: ${foraDoVermelho}`)
process.exitCode = foraDoVermelho > 0 ? 1 : 0
```

```js rascunho=tabela-mutantes-p5.mjs
// Monta a tabela de mutantes do plano 5 a partir de <lista>.json e <lista>.saida.jsonl e grava <lista>.tabela.md.
// Uso: node tabela-mutantes-p5.mjs <lista.json>. Derruba a tabela (saída 1) se faltar linha, se um mutante não
// ficar vermelho sem estar declarado equivalente (campo equivalente da lista, com a razão), se uma queda não for
// AssertionError com ERR_ASSERTION ou se vier de suíte fora das do mutante.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [listaArg] = process.argv.slice(2)
if (!listaArg) { console.error('uso: node tabela-mutantes-p5.mjs <lista.json>'); process.exit(2) }
const caminhoLista = resolve(listaArg)
const lista = JSON.parse(readFileSync(caminhoLista, 'utf8'))
const linhas = readFileSync(caminhoLista.replace(/\.json$/, '.saida.jsonl'), 'utf8').split('\n').filter(Boolean).map((linha) => JSON.parse(linha))
const EQUIVALENTES = new Map(lista.filter((m) => typeof m.equivalente === 'string').map((m) => [m.nome, m.equivalente]))
const SIGLAS = new Map([
  ['testes/casa-loja-cofre-gestao.test.mjs', 'LG'], ['testes/casa-presenca.test.mjs', 'PR'],
  ['testes/casa-postgres-fio.test.mjs', 'PG'], ['testes/cofre-cli-gestao.test.mjs', 'CG'],
  ['testes/ilha-cofre-mao.test.mjs', 'MC'], ['testes/casa-loja-cofre.test.mjs', 'LC'],
  ['testes/casa-dpapi.test.mjs', 'DP'], ['testes/casa-testadores-cofre.test.mjs', 'TC'],
  ['testes/casa-pacote-cofre.test.mjs', 'PC'], ['testes/cofre-cli.test.mjs', 'CL'], ['testes/casa-banco.test.mjs', 'CB']
])
const PADRAO = { strictEqual: 'Expected values to be strictly equal', deepStrictEqual: 'Expected values to be strictly deep-equal', '==': 'The expression evaluated to a falsy value' }
const NOME = { strictEqual: 'equal', deepStrictEqual: 'deepEqual', '==': 'ok' }
const celula = (texto) => texto.replaceAll('|', '\\|').replaceAll('<', '&lt;')
function assercao({ operador, mensagem }) {
  if (operador === 'throws') return mensagem.startsWith('Missing expected exception') ? '`throws` sem exceção' : '`throws` com outro erro'
  if (operador === 'rejects') return mensagem.startsWith('Missing expected rejection') ? '`rejects` sem rejeição' : '`rejects` com outro erro'
  const nome = NOME[operador] ?? operador
  const propria = PADRAO[operador] && !mensagem.startsWith(PADRAO[operador])
  return propria ? `\`${nome}\` ("${celula(mensagem)}")` : `\`${nome}\``
}
const problemas = []
if (linhas.length !== lista.length) problemas.push(`saida com ${linhas.length} linhas para ${lista.length} mutantes`)
const tabela = ['| # | Mutante | Arquivo | Teste que ficou vermelho — asserção |', '|---|---|---|---|']
let vermelhos = 0
let mapeados = 0
lista.forEach((m, i) => {
  const linha = linhas[i]
  const [numero, ...descricao] = m.nome.split(' ')
  const arquivo = `\`${m.arquivo.replace(/^runtime\//, '')}\``
  if (!linha || linha.nome !== m.nome) { problemas.push(`${m.nome}: sem linha na saida`); return }
  if (linha.resultado !== 'vermelho') {
    if (linha.resultado === 'SOBREVIVEU' && EQUIVALENTES.has(m.nome)) {
      tabela.push(`| ${Number(numero)} | ${celula(descricao.join(' '))} | ${arquivo} | sobreviveu — equivalente: ${EQUIVALENTES.get(m.nome)} |`)
    } else problemas.push(`${m.nome}: ${linha.resultado}${linha.vezes === undefined ? '' : ` (trecho ${linha.vezes} vez(es))`}`)
    return
  }
  vermelhos += 1
  const mortes = linha.quedas.map((queda) => {
    if (queda.nome !== 'AssertionError' || queda.codigo !== 'ERR_ASSERTION') problemas.push(`${m.nome}: ${queda.suite} > ${queda.teste} caiu por ${queda.nome} (${queda.mensagem})`)
    if (!m.teste.includes(queda.suite)) problemas.push(`${m.nome}: ${queda.suite} fora das suites do mutante`)
    mapeados += 1
    return `${SIGLAS.get(queda.suite) ?? queda.suite} ${celula(queda.teste)} — ${assercao(queda)}`
  })
  tabela.push(`| ${Number(numero)} | ${celula(descricao.join(' '))} | ${arquivo} | ${mortes.join('<br>')} |`)
})
writeFileSync(caminhoLista.replace(/\.json$/, '.tabela.md'), `${tabela.join('\n')}\n`)
for (const problema of problemas) console.log(`PROBLEMA ${problema}`)
console.log(`${lista.length} linhas: ${vermelhos} vermelhos, ${EQUIVALENTES.size} equivalente(s); testes mapeados: ${mapeados}`)
process.exitCode = problemas.length > 0 ? 1 : 0
```

## Tarefas

### Preparação

- [x] **Passo 1: rascunho, extrator, executor de mutantes e guarda.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
New-Item -ItemType Directory -Force $rascunho | Out-Null
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --conferir --so extrair-do-plano.mjs mutantes.mjs; "saida: $LASTEXITCODE"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `igual extrair-do-plano.mjs`, `igual mutantes.mjs`, `saida: 0` e `False`. Se o extrator não estiver no `$rascunho`, ele é criado à mão com o bloco acima e conferido de novo.

Resultado (06/11): `igual extrair-do-plano.mjs`, `igual mutantes.mjs`, `saida: 0` e `False`.

### Task 1: gestão na loja

**Arquivos:** criar `testes/casa-loja-cofre-gestao.test.mjs` (LG, 12 testes) e re-emitir `runtime/casa/loja-cofre.mjs` inteiro. A LG usa a ponte de mentira da LC, acrescida da cópia para a área de transferência, e uma presença de mentira com respostas em fila e contagem de chamadas. Ela prova o dono reservado, o histórico por id, as cinco regras de saúde com as bordas exatas, a edição, a rotação, a lixeira de 30 dias, ver e copiar só com a presença confirmada e o import da pasta que não ressuscita o apagado. O bloco da loja substitui o do plano 4: daqui em diante o `--conferir` do plano 4 dá `DIVERGE` nesse arquivo, e a lista de mutantes do plano 4 fica como histórico; os dez que miram a loja voltam aqui (22 a 31).

- [x] **Passo 1: o teste.**

```js arquivo=testes/casa-loja-cofre-gestao.test.mjs
// Gestão na loja do cofre (§8.2) sobre o cofre.db de uma casa temporária, com a ponte de mentira:
// o dono reservado, o histórico por credencial, as cinco regras de saúde, edição, rotação, a lixeira
// de 30 dias, ver e copiar só com a presença confirmada, e o import que não ressuscita o apagado.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { comBancoDaCasa } from '../runtime/casa/banco.mjs'
import { apagarCredencial, cadastrarCredencial, copiarAoDono, credencialPorNome, editarCredencial, esvaziarLixeira, historicoCredencial, importarPacoteCofre, importarPastaDpapi, listarCredenciais, listarLixeira, registrarInventarioWindows, registrarTeste, restaurarCredencial, revelarAoDono, rotacionarCredencial, saudeCofre, usarCredencial } from '../runtime/casa/loja-cofre.mjs'
import { selarPacote } from '../runtime/casa/pacote-cofre.mjs'

const RAPIDO = { N: 2 ** 14, r: 8, p: 1 }
const FRASE = 'frase-mestra de teste'
const AGORA = '2026-11-06T03:00:00.000Z'
const QUANDO = { maquina: 'maquina-a', agora: AGORA }
const DIA = 86_400_000
const aos = (dias, ms = 0) => new Date(Date.parse(AGORA) + dias * DIA + ms).toISOString()   // negativo é passado

// Ponte de mentira, a mesma da LC: "sela" com uma marca e um XOR e só abre o que tem a marca dela; outra
// marca é outra máquina. A cópia para a área de transferência guarda o texto numa lista, para o teste
// ver o que foi copiado, e zera o Buffer como a ponte real faria.
function ponteFalsa(marca = 'FALSO:') {
  const chamadas = { selar: 0, abrir: 0, copiar: 0 }
  const prefixo = Buffer.from(marca)
  const xor = (bytes) => { const saida = Buffer.from(bytes); for (let i = 0; i < saida.length; i++) saida[i] ^= 0x5a; return saida }
  const abrirUm = (blob) => {
    const bytes = blob instanceof Uint8Array ? Buffer.from(blob) : null
    if (!bytes || !bytes.subarray(0, prefixo.length).equals(prefixo)) return { ok: false, erro: 'CryptographicException' }
    return { ok: true, valor: xor(bytes.subarray(prefixo.length)) }
  }
  const areaDeTransferencia = []
  return {
    chamadas, areaDeTransferencia,
    selar(valores) { chamadas.selar += 1; return valores.map((valor) => Buffer.concat([prefixo, xor(valor)])) },
    abrir(blobs) { chamadas.abrir += 1; return blobs.map(abrirUm) },
    abrirParaAreaDeTransferencia(blob) {
      chamadas.copiar += 1
      const aberto = abrirUm(blob)
      if (!aberto.ok) return aberto
      areaDeTransferencia.push(aberto.valor.toString('utf8'))
      aberto.valor.fill(0)
      return { ok: true }
    }
  }
}
// Presença de mentira: devolve as respostas na ordem dada e conta as chamadas; sem resposta, nega.
function presencaFalsa(...respostas) {
  const presenca = () => { presenca.chamadas += 1; return respostas.shift() ?? { ok: false, motivo: 'sem-resposta' } }
  presenca.chamadas = 0
  return presenca
}
function comCasa(uso) {
  const casa = mkdtempSync(join(tmpdir(), 'omni-loja-gestao-'))
  try { return uso(casa) } finally { rmSync(casa, { recursive: true, force: true }) }
}
const comCofre = (casa, uso) => comBancoDaCasa(casa, 'cofre', uso, {})
const usos = (db) => db.prepare('SELECT nome, agente, motivo, resultado FROM usos ORDER BY rowid').all().map((linha) => ({ ...linha }))
const cadastrar = (db, ponte, nome, valor, extra = {}, agora = AGORA) => cadastrarCredencial(db, ponte, { nome, tipo: 'senha', ...extra }, valor, { maquina: 'maquina-a', agora })

test('dono reservado: ninguém cadastra, edita, importa nem usa como dono', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  assert.throws(() => cadastrar(db, ponte, 'banco-a', 'valor-a', { agentes: ['omni', 'dono'] }), { code: 'agente-reservado' })
  assert.equal(ponte.chamadas.selar, 0)
  cadastrar(db, ponte, 'banco-a', 'valor-a')
  assert.throws(() => editarCredencial(db, 'banco-a', { agentes: ['dono'] }, QUANDO), { code: 'agente-reservado' })
  assert.deepEqual(credencialPorNome(db, 'banco-a').agentes, ['omni'])
  const valor_b64 = Buffer.from('valor-b').toString('base64')
  const texto = selarPacote({ formato: 'omni-cofre-conteudo', versao: 1, origem_maquina: 'maquina-a', exportado_em: AGORA, credenciais: [{ nome: 'banco-b', tipo: 'senha', agentes: ['dono'], valor_b64 }, { nome: 'banco-c', tipo: 'senha', agentes: ['omni'], valor_b64 }], recadastrar: [] }, FRASE, RAPIDO)
  assert.deepEqual(importarPacoteCofre(db, ponte, texto, FRASE, QUANDO).resultados, [{ nome: 'banco-b', resultado: 'invalida' }, { nome: 'banco-c', resultado: 'importada' }])
  db.prepare(`UPDATE credenciais SET agentes = '["omni","dono"]' WHERE nome = 'banco-a'`).run()
  assert.throws(() => usarCredencial(db, ponte, { nome: 'banco-a', agente: 'dono', motivo: 'teste' }, QUANDO), { code: 'agente-sem-acesso' })
  assert.deepEqual(usos(db).at(-1), { nome: 'banco-a', agente: 'dono', motivo: 'teste', resultado: 'recusado-agente' })
})))

test('histórico: por id, do mais novo ao mais velho, com recusas, sem o valor e depois de apagada', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  const { id } = cadastrar(db, ponte, 'banco-a', 'segredo-do-historico', {}, aos(-3))
  cadastrar(db, ponte, 'banco-b', 'outro-segredo', {}, aos(-3))
  const usar = (nome, agente, motivo, agora, sessao = null) => usarCredencial(db, ponte, { nome, agente, motivo, sessao }, { maquina: 'maquina-a', agora })
  usar('banco-a', 'omni', 'primeiro', aos(-2), 's-1').valor.fill(0)
  usar('banco-b', 'omni', 'segundo', aos(-1)).valor.fill(0)
  assert.throws(() => usar('banco-a', 'overcore', 'sem acesso', aos(-1)), { code: 'agente-sem-acesso' })
  usar('banco-a', 'omni', 'terceiro', AGORA).valor.fill(0)
  const historico = historicoCredencial(db, id)
  assert.deepEqual(historico, [
    { em: AGORA, agente: 'omni', sessao: null, motivo: 'terceiro', resultado: 'entregue' },
    { em: aos(-1), agente: 'overcore', sessao: null, motivo: 'sem acesso', resultado: 'recusado-agente' },
    { em: aos(-2), agente: 'omni', sessao: 's-1', motivo: 'primeiro', resultado: 'entregue' }
  ])
  assert.ok(!JSON.stringify(historico).includes('segredo-do-historico'), 'o histórico não leva o valor')
  assert.deepEqual(historicoCredencial(db, id, { limite: 1 }).map((uso) => uso.motivo), ['terceiro'])
  apagarCredencial(db, 'banco-a', QUANDO)
  assert.equal(historicoCredencial(db, id).length, 3)
  assert.throws(() => historicoCredencial(db, 'banco-a'), { code: 'dados-invalidos' })
  assert.throws(() => historicoCredencial(db, id, { limite: 0 }), { code: 'dados-invalidos' })
  assert.throws(() => historicoCredencial(db, '01890000-0000-7000-8000-000000000000'), { code: 'inexistente' })
})))

test('saúde, vence: até 15 dias ou já vencida, com a borda exata', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  for (const [nome, validade] of [['a-vence-em-15', aos(15)], ['b-ja-venceu', aos(-3)], ['c-vence-em-15-e-1ms', aos(15, 1)], ['d-vence-em-16', aos(16)], ['e-sem-validade', null]]) cadastrar(db, ponte, nome, `valor-${nome}`, { validade })
  assert.deepEqual(saudeCofre(db, { agora: AGORA }), { total: 5, alertas: [{ regra: 'vence', nome: 'a-vence-em-15', validade: aos(15) }, { regra: 'vence', nome: 'b-ja-venceu', validade: aos(-3) }], duplicatas: null })
})))

test('saúde, teste que falhou: só o último resultado falso', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  for (const nome of ['a-falhou', 'b-passou', 'c-sem-resultado', 'd-nunca-testada']) cadastrar(db, ponte, nome, `valor-${nome}`, {}, aos(-2))
  registrarTeste(db, 'a-falhou', { ok: false, detalhe: 'recusou o login' }, aos(-1))
  registrarTeste(db, 'b-passou', { ok: true, detalhe: 'ok' }, aos(-1))
  registrarTeste(db, 'c-sem-resultado', { ok: null, detalhe: 'sem testador para o tipo' }, aos(-1))
  assert.deepEqual(saudeCofre(db, { agora: AGORA }).alertas, [{ regra: 'teste-falhou', nome: 'a-falhou', em: aos(-1) }])
})))

test('saúde, sem uso: 90 dias contados só de entregue, revelado e copiado, e só na guarda dpapi', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  const antes = aos(-200)
  for (const nome of ['a-usada-ha-89', 'b-usada-ha-90', 'c-usada-ha-91', 'd-nunca-usada']) cadastrar(db, ponte, nome, `valor-${nome}`, {}, antes)
  for (const nome of ['e-vista-pelo-dono', 'f-copiada-pelo-dono']) cadastrar(db, ponte, nome, `valor-${nome}`, { agentes: [] }, antes)
  registrarInventarioWindows(db, [{ alvo: 'Omni/so-no-gerenciador', usuario: null }], { maquina: 'maquina-a', agora: antes })
  for (const [nome, dias] of [['a-usada-ha-89', -89], ['b-usada-ha-90', -90], ['c-usada-ha-91', -91]]) usarCredencial(db, ponte, { nome, agente: 'omni', motivo: 'uso antigo' }, { maquina: 'maquina-a', agora: aos(dias) }).valor.fill(0)
  const presente = presencaFalsa({ ok: true }, { ok: true })
  revelarAoDono(db, ponte, presente, 'e-vista-pelo-dono', { maquina: 'maquina-a', agora: aos(-10) }).valor.fill(0)
  copiarAoDono(db, ponte, presente, 'f-copiada-pelo-dono', { maquina: 'maquina-a', agora: aos(-10) })
  assert.deepEqual(saudeCofre(db, { ponte, duplicatas: true, maquina: 'maquina-a', agora: aos(-1) }).duplicatas, { pares: [], naoAbriram: [] })
  assert.deepEqual(saudeCofre(db, { agora: AGORA }).alertas, [
    { regra: 'sem-uso', nome: 'b-usada-ha-90', desde: aos(-90) },
    { regra: 'sem-uso', nome: 'c-usada-ha-91', desde: aos(-91) },
    { regra: 'sem-uso', nome: 'd-nunca-usada', desde: aos(-200) }
  ])
})))

test('saúde, agente que nunca usou: só depois de 90 dias de cadastro, e falha ao abrir não conta', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  const extra = { tipo: 'token', agentes: ['omni', 'overcore', 'oraculo'] }
  cadastrar(db, ponte, 'a-com-89-dias', 'valor-a', extra, aos(-89))
  cadastrar(db, ponte, 'b-com-90-dias', 'valor-b', extra, aos(-90))
  for (const nome of ['a-com-89-dias', 'b-com-90-dias']) usarCredencial(db, ponte, { nome, agente: 'omni', motivo: 'uso recente' }, { maquina: 'maquina-a', agora: aos(-1) }).valor.fill(0)
  assert.throws(() => usarCredencial(db, ponteFalsa('OUTRA:'), { nome: 'b-com-90-dias', agente: 'oraculo', motivo: 'outra máquina' }, { maquina: 'maquina-a', agora: aos(-1) }), { code: 'nao-abriu' })
  assert.deepEqual(saudeCofre(db, { agora: AGORA }).alertas, [
    { regra: 'agente-nunca-usou', nome: 'b-com-90-dias', agente: 'overcore' },
    { regra: 'agente-nunca-usou', nome: 'b-com-90-dias', agente: 'oraculo' }
  ])
})))

test('saúde, duplicatas: só quando pedida, abre numa chamada, compara em memória, zera e devolve só nomes', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  for (const nome of ['a-original', 'b-copia', 'd-tambem-igual']) cadastrar(db, ponte, nome, 'mesmo-valor')
  cadastrar(db, ponte, 'c-unica', 'outro-valor')
  cadastrar(db, ponteFalsa('OUTRA:'), 'e-de-outra-maquina', 'mesmo-valor')
  const entregues = []
  const espia = { ...ponte, abrir(blobs) { const abertos = ponte.abrir(blobs); for (const aberto of abertos) if (aberto.ok) entregues.push(aberto.valor); return abertos } }
  const saude = saudeCofre(db, { ponte: espia, duplicatas: true, maquina: 'maquina-a', agora: AGORA })
  assert.equal(saude.total, 5)
  assert.equal(ponte.chamadas.abrir, 1)
  assert.deepEqual(saude.duplicatas, { pares: [['a-original', 'b-copia'], ['a-original', 'd-tambem-igual'], ['b-copia', 'd-tambem-igual']], naoAbriram: ['e-de-outra-maquina'] })
  assert.ok(!JSON.stringify(saude).includes('mesmo-valor'), 'a saúde não leva o valor')
  assert.equal(entregues.length, 4)
  assert.ok(entregues.every((valor) => valor.every((byte) => byte === 0)), 'os valores abertos para comparar ficam zerados')
  assert.deepEqual(usos(db).map((u) => `${u.nome} ${u.agente} ${u.resultado}`), [
    'a-original omni conferido-saude', 'b-copia omni conferido-saude', 'c-unica omni conferido-saude',
    'd-tambem-igual omni conferido-saude', 'e-de-outra-maquina omni falhou-abrir'
  ])
  assert.throws(() => saudeCofre(db, { duplicatas: true, agora: AGORA }), { code: 'dados-invalidos' })
})))

test('editar: muda só o que foi pedido, sobe a versão uma vez e recusa campo que não se edita', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  cadastrar(db, ponte, 'banco-a', 'valor-a', { servico: 'postgres', etiquetas: ['dw'] })
  const e = editarCredencial(db, 'banco-a', { notas: 'nota de teste', agentes: ['omni', 'overcore'], validade: aos(30) }, { maquina: 'maquina-b', agora: aos(1) })
  assert.deepEqual({ versao: e.versao, servico: e.servico, etiquetas: e.etiquetas, notas: e.notas, agentes: e.agentes, validade: e.validade, origem_maquina: e.origem_maquina, atualizado_em: e.atualizado_em },
    { versao: 2, servico: 'postgres', etiquetas: ['dw'], notas: 'nota de teste', agentes: ['omni', 'overcore'], validade: aos(30), origem_maquina: 'maquina-b', atualizado_em: aos(1) })
  assert.equal(editarCredencial(db, 'banco-a', { notas: 'nota de teste' }, { maquina: 'maquina-b', agora: aos(2) }).versao, 2)
  assert.deepEqual(db.prepare("SELECT operacao || versao AS o FROM _diario WHERE tabela = 'credenciais' ORDER BY seq").all().map((linha) => linha.o), ['I1', 'U2'])
  for (const mudancas of [{ nome: 'banco-x' }, { blob: 'x' }, { tipo: 'cofre-magico' }]) assert.throws(() => editarCredencial(db, 'banco-a', mudancas, QUANDO), { code: 'dados-invalidos' })
  assert.throws(() => editarCredencial(db, 'banco-z', { notas: 'x' }, QUANDO), { code: 'inexistente' })
  assert.equal(credencialPorNome(db, 'banco-a').versao, 2)
})))

test('rotacionar: sela o valor novo, sobe a versão, zera o último teste e registra a rotação', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  const antes = cadastrar(db, ponte, 'banco-a', 'valor-velho', {}, aos(-2))
  registrarTeste(db, 'banco-a', { ok: false, detalhe: 'senha recusada' }, aos(-1))
  const depois = rotacionarCredencial(db, ponte, 'banco-a', Buffer.from('valor-novo'), { maquina: 'maquina-b', agora: AGORA })
  assert.equal(depois.versao, 2)
  assert.notEqual(depois.blob_sha256, antes.blob_sha256)
  assert.equal(depois.ultimo_teste_em, null)
  assert.equal(depois.ultimo_teste_ok, null)
  assert.equal(depois.ultimo_teste_detalhe, null)
  const { valor } = usarCredencial(db, ponte, { nome: 'banco-a', agente: 'omni', motivo: 'depois da rotação' }, QUANDO)
  assert.equal(valor.toString('utf8'), 'valor-novo')
  valor.fill(0)
  assert.deepEqual(usos(db).map((u) => `${u.agente} ${u.motivo} ${u.resultado}`), ['omni rotacao rotacionado', 'omni depois da rotação entregue'])
  assert.throws(() => rotacionarCredencial(db, ponte, 'banco-a', '', QUANDO), { code: 'valor-vazio' })
  assert.throws(() => rotacionarCredencial(db, ponte, 'banco-z', 'x', QUANDO), { code: 'inexistente' })
  registrarInventarioWindows(db, [{ alvo: 'Omni/no-gerenciador', usuario: null }], QUANDO)
  const selagens = ponte.chamadas.selar
  assert.throws(() => rotacionarCredencial(db, ponte, 'Omni/no-gerenciador', 'x', QUANDO), { code: 'gerenciador-windows' })
  assert.equal(ponte.chamadas.selar, selagens)
  assert.equal(credencialPorNome(db, 'banco-a').versao, 2)
})))

test('lixeira: apagar sobe a versão, restaurar respeita o nome vivo, esvaziar leva só o que passou de 30 dias', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  for (const nome of ['a-29-dias', 'b-30-dias', 'c-31-dias', 'd-viva', 'e-restaurada']) cadastrar(db, ponte, nome, `valor-${nome}`, {}, aos(-60))
  const idC = credencialPorNome(db, 'c-31-dias').id
  usarCredencial(db, ponte, { nome: 'c-31-dias', agente: 'omni', motivo: 'antes de apagar' }, { maquina: 'maquina-a', agora: aos(-60) }).valor.fill(0)
  for (const [nome, dias] of [['a-29-dias', -29], ['b-30-dias', -30], ['c-31-dias', -31], ['e-restaurada', -5]]) apagarCredencial(db, nome, { maquina: 'maquina-a', agora: aos(dias) })
  assert.deepEqual(listarCredenciais(db).map((c) => c.nome), ['d-viva'])
  assert.deepEqual(listarLixeira(db).map((c) => [c.nome, c.apagado_em, c.versao]), [['e-restaurada', aos(-5), 2], ['a-29-dias', aos(-29), 2], ['b-30-dias', aos(-30), 2], ['c-31-dias', aos(-31), 2]])
  assert.throws(() => usarCredencial(db, ponte, { nome: 'a-29-dias', agente: 'omni', motivo: 'apagada' }, QUANDO), { code: 'inexistente' })
  assert.throws(() => apagarCredencial(db, 'a-29-dias', QUANDO), { code: 'inexistente' })
  const idB = listarLixeira(db).find((c) => c.nome === 'b-30-dias').id
  cadastrar(db, ponte, 'b-30-dias', 'valor-novo-b')
  assert.throws(() => restaurarCredencial(db, idB, QUANDO), { code: 'ja-existe' })
  const idE = listarLixeira(db).find((c) => c.nome === 'e-restaurada').id
  assert.equal(restaurarCredencial(db, idE, QUANDO).versao, 3)
  assert.throws(() => restaurarCredencial(db, idE, QUANDO), { code: 'inexistente' })
  assert.deepEqual(esvaziarLixeira(db, { agora: AGORA }), { apagadas: 1 })
  assert.deepEqual(listarLixeira(db).map((c) => c.nome), ['a-29-dias', 'b-30-dias'])
  assert.deepEqual(listarCredenciais(db).map((c) => c.nome), ['b-30-dias', 'd-viva', 'e-restaurada'])
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM usos WHERE credencial_id = ?').get(idC).n, 1)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM _diario WHERE tabela = 'credenciais' AND operacao = 'D' AND linha = ?").get(idC).n, 1)
})))

test('ver e copiar: só com a presença confirmada a cada vez, como dono, e todo pedido vira linha', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  cadastrar(db, ponte, 'banco-a', 'valor-do-dono')
  cadastrar(db, ponteFalsa('OUTRA:'), 'banco-outra', 'valor-de-outra')
  const negada = presencaFalsa({ ok: false, motivo: 'cancelado' }, { ok: false, motivo: 'cancelado' })
  assert.throws(() => revelarAoDono(db, ponte, negada, 'banco-a', QUANDO), { code: 'sem-presenca' })
  assert.throws(() => copiarAoDono(db, ponte, negada, 'banco-a', QUANDO), { code: 'sem-presenca' })
  assert.equal(negada.chamadas, 2)
  assert.deepEqual([ponte.chamadas.abrir, ponte.chamadas.copiar], [0, 0])
  const presente = presencaFalsa({ ok: true }, { ok: true }, { ok: true }, { ok: true })
  const visto = revelarAoDono(db, ponte, presente, 'banco-a', QUANDO)
  assert.equal(visto.valor.toString('utf8'), 'valor-do-dono')
  assert.match(visto.usoId, /^[0-9a-f]{8}-/)
  visto.valor.fill(0)
  const copiado = copiarAoDono(db, ponte, presente, 'banco-a', QUANDO)
  assert.deepEqual(Object.keys(copiado).sort(), ['limpaEm', 'usoId'])
  assert.equal(copiado.limpaEm, null)
  assert.deepEqual(ponte.areaDeTransferencia, ['valor-do-dono'])
  assert.throws(() => revelarAoDono(db, ponte, presente, 'banco-outra', QUANDO), { code: 'nao-abriu' })
  assert.throws(() => copiarAoDono(db, ponte, presente, 'banco-outra', QUANDO), { code: 'nao-copiou' })
  assert.equal(presente.chamadas, 4)
  const nunca = presencaFalsa()
  assert.throws(() => revelarAoDono(db, ponte, nunca, 'banco-z', QUANDO), { code: 'inexistente' })
  registrarInventarioWindows(db, [{ alvo: 'Omni/no-gerenciador', usuario: null }], QUANDO)
  assert.throws(() => copiarAoDono(db, ponte, nunca, 'Omni/no-gerenciador', QUANDO), { code: 'gerenciador-windows' })
  assert.throws(() => revelarAoDono(db, ponte, null, 'banco-a', QUANDO), { code: 'dados-invalidos' })
  assert.equal(nunca.chamadas, 0)
  const linhas = usos(db)
  assert.ok(linhas.every((u) => u.agente === 'dono'), 'quem vê e copia é o dono')
  assert.deepEqual(linhas.map((u) => `${u.nome} ${u.motivo} ${u.resultado}`), [
    'banco-a ver recusado-presenca', 'banco-a copiar recusado-presenca',
    'banco-a ver revelado-ao-dono', 'banco-a copiar copiado-ao-dono',
    'banco-outra ver falhou-abrir', 'banco-outra copiar falhou-copiar',
    'banco-z ver recusado-inexistente', 'Omni/no-gerenciador copiar recusado-gerenciador'
  ])
  assert.ok(!JSON.stringify(linhas).includes('valor-do-dono'), 'nenhum uso leva o valor')
})))

test('import da pasta: hash já ingerido de credencial apagada não ressuscita, nem depois de esvaziar; valor novo entra', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  const pasta = join(casa, 'access')
  mkdirSync(pasta)
  const gravar = (nome, valor) => writeFileSync(join(pasta, `${nome}.dpapi`), ponte.selar([Buffer.from(valor)])[0])
  gravar('banco-a', 'valor-a')
  gravar('banco-b', 'valor-b')
  const importar = (agora) => importarPastaDpapi(db, ponte, pasta, { maquina: 'maquina-a', agora }).resultados
  assert.deepEqual(importar(aos(-40)), [{ nome: 'banco-a', resultado: 'importada' }, { nome: 'banco-b', resultado: 'importada' }])
  apagarCredencial(db, 'banco-a', { maquina: 'maquina-a', agora: aos(-35) })
  apagarCredencial(db, 'banco-b', { maquina: 'maquina-a', agora: aos(-1) })
  const apagadas = [{ nome: 'banco-a', resultado: 'apagada' }, { nome: 'banco-b', resultado: 'apagada' }]
  assert.deepEqual(importar(AGORA), apagadas)
  assert.deepEqual(esvaziarLixeira(db, { agora: AGORA }), { apagadas: 1 })
  assert.deepEqual(importar(AGORA), apagadas)
  gravar('banco-a', 'valor-a-novo')
  assert.deepEqual(importar(AGORA), [{ nome: 'banco-a', resultado: 'importada' }, { nome: 'banco-b', resultado: 'apagada' }])
  const { valor } = usarCredencial(db, ponte, { nome: 'banco-a', agente: 'omni', motivo: 'valor novo' }, QUANDO)
  assert.equal(valor.toString('utf8'), 'valor-a-novo')
  valor.fill(0)
})))
```

- [x] **Passo 2: extrair o teste e ver o vermelho.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so testes/casa-loja-cofre-gestao.test.mjs
node --test --test-concurrency=1 --test-reporter=spec testes/casa-loja-cofre-gestao.test.mjs *> "$rascunho\p5-t1-vermelho.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\p5-t1-vermelho.txt" -Pattern 'does not provide an export named', '(tests|pass|fail) \d+\s*$'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `gravado testes/casa-loja-cofre-gestao.test.mjs`, `saida: 1`, o `SyntaxError` de `../runtime/casa/loja-cofre.mjs`, que não exporta `apagarCredencial` (o primeiro nome que a LG importa e a loja do plano 4 não tem), `tests 1`, `pass 0`, `fail 1` e `False`.

Resultado (06/11): `gravado testes/casa-loja-cofre-gestao.test.mjs`, `saida: 1`, `does not provide an export named 'apagarCredencial'`, `tests 1`, `pass 0`, `fail 1` e `False`.

- [x] **Passo 3: o módulo.** A loja inteira, com o plano 4 dentro; o que muda está nas decisões 5 e 11 a 22.

```js arquivo=runtime/casa/loja-cofre.mjs
// Loja do cofre (§8.1 a §8.4): credenciais no cofre.db, com o valor selado pela DPAPI do usuário e
// só metadados em claro. Quem abre ou sela o valor é a ponte (runtime/casa/dpapi.mjs), sempre fora
// da transação; a transação só grava. Todo pedido de uso vira linha em usos, entregue ou recusado, e
// nenhuma linha leva o valor. As credenciais do Gerenciador de Credenciais do Windows entram só como
// inventário (guarda gerenciador-windows, sem blob): o cofre sabe que existem, não as abre.
// A gestão do card (§8.2) mora aqui também: histórico, saúde, edição, rotação, lixeira de 30 dias e o
// caminho do dono, que vê e copia só depois da presença confirmada (runtime/casa/presenca.mjs). O dono
// não é um agente: o nome fica reservado e nenhum agente o usa para pedir valor.
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { agoraIso, maquinaAtual, sha256, transacao, uuidv7 } from './banco.mjs'
import { abrirPacote, conferirFrase, conferirParametros, PARAMETROS_PADRAO, selarPacote } from './pacote-cofre.mjs'
import { registrarProjecao, situacaoDaProjecao } from './projecao.mjs'

export const TIPOS = Object.freeze(['senha', 'token', 'chave-api', 'conexao', 'conta-servico', 'ssh', 'outro'])
const NOME = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/
const AGENTE = /^[a-z][a-z0-9-]{0,39}$/
const ETIQUETA = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,59}$/u
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
const LIMITE_DETALHE = 300
const COLUNAS_PUBLICAS = 'id, nome, tipo, servico, url, usuario, notas, etiquetas, agentes, validade, rotacionar_dias, ultimo_teste_em, ultimo_teste_ok, ultimo_teste_detalhe, guarda, alvo_windows, blob_sha256, origem_maquina, criado_em, atualizado_em, versao'
const SEM_METADADOS = Object.freeze({ url: null, usuario: null, notas: null, etiquetas: [], agentes: ['omni'], validade: null, rotacionar_dias: null })
const DONO = 'dono'
const DIA = 86_400_000
const PRAZO_VENCE = 15 * DIA
const PRAZO_SEM_USO = 90 * DIA
const CARENCIA_AGENTE = 90 * DIA
const PRAZO_LIXEIRA = 30 * DIA
const USO_REAL = new Set(['entregue', 'revelado-ao-dono', 'copiado-ao-dono'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const EDITAVEIS = new Set(['tipo', 'servico', 'url', 'usuario', 'notas', 'etiquetas', 'agentes', 'validade', 'rotacionar_dias'])

export class CofreError extends Error {
  constructor(codigo, mensagem) {
    super(mensagem)
    this.name = 'CofreError'
    this.code = codigo
  }
}

function texto(valor, campo, { obrigatorio = false, max = 2000 } = {}) {
  if (valor === undefined || valor === null || valor === '') {
    if (obrigatorio) throw new CofreError('dados-invalidos', `Falta o campo ${campo}.`)
    return null
  }
  if (typeof valor !== 'string' || valor.length > max) throw new CofreError('dados-invalidos', `Campo ${campo} inválido.`)
  return valor
}

function lista(valor, campo, padrao, formato) {
  if (valor === undefined || valor === null) return [...padrao]
  if (!Array.isArray(valor) || valor.some((item) => typeof item !== 'string' || !formato.test(item)) || new Set(valor).size !== valor.length) {
    throw new CofreError('dados-invalidos', `Campo ${campo} inválido.`)
  }
  return [...valor]
}

function normalizarDados(dados) {
  const d = dados ?? {}
  const nome = texto(d.nome, 'nome', { obrigatorio: true, max: 200 })
  if (!NOME.test(nome)) throw new CofreError('dados-invalidos', 'Campo nome inválido.')
  if (!TIPOS.includes(d.tipo)) throw new CofreError('dados-invalidos', 'Campo tipo inválido.')
  const validade = texto(d.validade, 'validade', { max: 40 })
  if (validade !== null && Number.isNaN(Date.parse(validade))) throw new CofreError('dados-invalidos', 'Campo validade inválido.')
  const rotacionar = d.rotacionar_dias ?? null
  if (rotacionar !== null && (!Number.isInteger(rotacionar) || rotacionar < 1 || rotacionar > 3650)) throw new CofreError('dados-invalidos', 'Campo rotacionar_dias inválido.')
  const agentes = lista(d.agentes, 'agentes', ['omni'], AGENTE)
  if (agentes.includes(DONO)) throw new CofreError('agente-reservado', 'O agente dono é reservado: quem vê e copia é o dono, atrás do Windows Hello.')
  return {
    nome, tipo: d.tipo,
    servico: texto(d.servico, 'servico', { max: 100 }), url: texto(d.url, 'url'),
    usuario: texto(d.usuario, 'usuario', { max: 200 }), notas: texto(d.notas, 'notas'),
    etiquetas: lista(d.etiquetas, 'etiquetas', [], ETIQUETA), agentes,
    validade, rotacionar_dias: rotacionar
  }
}

function comoBytes(valor) {
  if (typeof valor === 'string') return Buffer.from(valor, 'utf8')
  if (valor instanceof Uint8Array) return Buffer.from(valor)
  throw new CofreError('dados-invalidos', 'O valor da credencial precisa ser texto ou bytes.')
}

// node:sqlite devolve linha com protótipo nulo e BLOB como Uint8Array; o espalhamento vira objeto comum.
function deLinha(linha) {
  if (!linha) return null
  return { ...linha, etiquetas: JSON.parse(linha.etiquetas), agentes: JSON.parse(linha.agentes), ultimo_teste_ok: linha.ultimo_teste_ok === null ? null : linha.ultimo_teste_ok === 1 }
}

const metadados = (c) => ({ nome: c.nome, tipo: c.tipo, servico: c.servico, url: c.url, usuario: c.usuario, notas: c.notas, etiquetas: c.etiquetas, agentes: c.agentes, validade: c.validade, rotacionar_dias: c.rotacionar_dias })
const porNome = (db, nome) => db.prepare('SELECT id, guarda, blob_sha256 FROM credenciais WHERE nome = ? AND apagado_em IS NULL').get(nome)
const jaExiste = (nome) => new CofreError('ja-existe', `Já existe uma credencial com o nome ${nome}.`)
const inexistente = (nome) => new CofreError('inexistente', `Não há credencial com o nome ${nome}.`)
const soNoGerenciador = (nome) => new CofreError('gerenciador-windows', `${nome} mora no Gerenciador de Credenciais do Windows; o cofre só tem o nome.`)
function exigirNome(nome) { if (typeof nome !== 'string' || !NOME.test(nome)) throw new CofreError('dados-invalidos', 'Campo nome inválido.') }
function exigirId(id) { if (typeof id !== 'string' || !UUID.test(id)) throw new CofreError('dados-invalidos', 'Campo id inválido.') }
const jaIngerido = (db, chave, sha) => Boolean(db.prepare('SELECT 1 AS sim FROM _projecoes WHERE arquivo = ? AND sha256 = ?').get(chave, sha))
function abrirRegistrando(ponte, blob, nome, registrar) {
  let aberto
  try { [aberto] = ponte.abrir([blob]) } catch (erro) { registrar('falhou-abrir'); throw erro }
  if (!aberto?.ok) { registrar('falhou-abrir'); throw new CofreError('nao-abriu', `${nome} não abriu nesta máquina (${aberto?.erro ?? 'sem resposta'}).`) }
  return aberto.valor
}
function contar(resultados) { const contagens = {}; for (const { resultado } of resultados) contagens[resultado] = (contagens[resultado] ?? 0) + 1; return contagens }

function inserir(db, c) {
  db.prepare(`INSERT INTO credenciais (id, nome, tipo, servico, url, usuario, notas, etiquetas, agentes, validade, rotacionar_dias, guarda, alvo_windows, blob, blob_sha256, origem_maquina, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(uuidv7(Date.parse(c.agora)), c.nome, c.tipo, c.servico, c.url, c.usuario, c.notas, JSON.stringify(c.etiquetas), JSON.stringify(c.agentes), c.validade, c.rotacionar_dias, c.guarda, c.alvo_windows, c.blob, c.blob === null ? null : sha256(c.blob), c.maquina, c.agora, c.agora)
}
function registrarImportacao(db, { tipo, fonte, fonteSha256, contagens, maquina, agora }) {
  db.prepare('INSERT INTO _importacoes (id, tipo, fonte, fonte_sha256, contagens, origem_maquina, feita_em) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(uuidv7(Date.parse(agora)), tipo, fonte, fonteSha256, JSON.stringify(contagens), maquina, agora)
}
function registrarUso(db, { credencialId, nome, agente, sessao, motivo, resultado, maquina, agora }) {
  const id = uuidv7(Date.parse(agora))
  db.prepare('INSERT INTO usos (id, credencial_id, nome, agente, sessao, motivo, resultado, em, origem_maquina) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, credencialId, nome, agente, sessao, motivo, resultado, agora, maquina)
  return id
}

export function listarCredenciais(db) { return db.prepare(`SELECT ${COLUNAS_PUBLICAS} FROM credenciais WHERE apagado_em IS NULL ORDER BY nome`).all().map(deLinha) }
export function credencialPorNome(db, nome) { return deLinha(db.prepare(`SELECT ${COLUNAS_PUBLICAS} FROM credenciais WHERE nome = ? AND apagado_em IS NULL`).get(nome)) }

export function cadastrarCredencial(db, ponte, dados, valor, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  const c = normalizarDados(dados)
  const bytes = comoBytes(valor)
  try {
    if (bytes.length === 0) throw new CofreError('valor-vazio', 'O valor da credencial está vazio.')
    if (porNome(db, c.nome)) throw jaExiste(c.nome)
    const [blob] = ponte.selar([bytes])
    return transacao(db, () => {
      if (porNome(db, c.nome)) throw jaExiste(c.nome)
      inserir(db, { ...c, guarda: 'dpapi', alvo_windows: null, blob, maquina, agora })
      return credencialPorNome(db, c.nome)
    })
  } finally {
    bytes.fill(0)
  }
}

export function usarCredencial(db, ponte, pedido, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  const { nome, agente, motivo, sessao = null } = pedido ?? {}
  const valido = typeof nome === 'string' && NOME.test(nome) && typeof agente === 'string' && AGENTE.test(agente) &&
    typeof motivo === 'string' && motivo.trim() !== '' && motivo.length <= 300 && (sessao === null || (typeof sessao === 'string' && sessao.length <= 200))
  if (!valido) throw new CofreError('dados-invalidos', 'Pedido de uso inválido: nome, agente e motivo são obrigatórios.')
  const registrar = (credencialId, resultado) => registrarUso(db, { credencialId, nome, agente, sessao, motivo, resultado, maquina, agora })
  const linha = db.prepare('SELECT id, agentes, guarda, blob FROM credenciais WHERE nome = ? AND apagado_em IS NULL').get(nome)
  if (!linha) { registrar(null, 'recusado-inexistente'); throw inexistente(nome) }
  // O dono não pede valor por aqui: ele vê e copia pelo caminho com presença (revelarAoDono, copiarAoDono).
  if (agente === DONO || !JSON.parse(linha.agentes).includes(agente)) {
    registrar(linha.id, 'recusado-agente')
    throw new CofreError('agente-sem-acesso', `O agente ${agente} não tem acesso a ${nome}.`)
  }
  if (linha.guarda !== 'dpapi') { registrar(linha.id, 'recusado-gerenciador'); throw soNoGerenciador(nome) }
  const valor = abrirRegistrando(ponte, linha.blob, nome, (resultado) => registrar(linha.id, resultado))
  try { return { valor, usoId: registrar(linha.id, 'entregue') } } catch (erro) { valor.fill(0); throw erro }
}

export function registrarTeste(db, nome, { ok, detalhe }, agora = agoraIso()) {
  if (ok !== true && ok !== false && ok !== null) throw new CofreError('dados-invalidos', 'Resultado de teste inválido.')
  const corte = detalhe === undefined || detalhe === null ? null : String(detalhe).slice(0, LIMITE_DETALHE)
  const r = db.prepare('UPDATE credenciais SET ultimo_teste_em = ?, ultimo_teste_ok = ?, ultimo_teste_detalhe = ? WHERE nome = ? AND apagado_em IS NULL')
    .run(agora, ok === null ? null : ok ? 1 : 0, corte, nome)
  if (r.changes !== 1) throw inexistente(nome)
}

function conferirClassificacao(classificacao) {
  if (classificacao === null || typeof classificacao !== 'object' || Array.isArray(classificacao)) throw new CofreError('classificacao-invalida', 'A classificação precisa ser um objeto nome → {tipo, servico}.')
  for (const [nome, classe] of Object.entries(classificacao)) {
    const ok = NOME.test(nome) && classe !== null && typeof classe === 'object' && TIPOS.includes(classe.tipo) &&
      (classe.servico === undefined || classe.servico === null || (typeof classe.servico === 'string' && classe.servico.length <= 100))
    if (!ok) throw new CofreError('classificacao-invalida', `Classificação inválida para ${nome}.`)
  }
}

// O ConvertFrom-SecureString do PowerShell (sem -Key) grava o blob da DPAPI como texto hex, e o valor
// selado ali dentro é UTF-16LE. Arquivo que é todo texto hex (BOM e espaço nas pontas tolerados) vem
// desse formato: o blob sai do hex, e o valor só vale se for UTF-16LE bem formado. Ele vira UTF-8 e é
// selado de novo, para o cofre guardar um formato só.
const HEX = /^(?:[0-9a-f]{2})+$/i
function blobDoTextoHex(bytes) {
  const texto = bytes.toString('latin1').replace(/^\xEF\xBB\xBF/, '').trim()
  return HEX.test(texto) ? Buffer.from(texto, 'hex') : null
}
function utf16ParaUtf8(valor) {
  if (valor.length % 2 !== 0) return null
  const texto = valor.toString('utf16le')
  return texto.isWellFormed() ? Buffer.from(texto, 'utf8') : null
}

// O .dpapi é projeção do cofre (§3.2): o hash de cada arquivo ingerido fica em _projecoes, sob
// access/<arquivo>, venha da pasta que vier. Na volta, arquivo igual ao blob guardado ou já ingerido
// é já-importada; hash nunca visto é divergente, e o banco não é sobrescrito.
export function importarPastaDpapi(db, ponte, pasta, { classificacao = {}, maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  conferirClassificacao(classificacao)
  const fonte = resolve(pasta)
  const arquivos = readdirSync(fonte, { withFileTypes: true }).filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.dpapi')).map((e) => e.name).sort()
  const resultados = []; const impressoes = []; const candidatas = []
  for (const arquivo of arquivos) {
    const nome = arquivo.slice(0, -'.dpapi'.length)
    if (!NOME.test(nome)) { resultados.push({ nome, resultado: 'nome-invalido' }); continue }
    const bruto = readFileSync(join(fonte, arquivo))
    const sha = sha256(bruto)
    const chave = `access/${arquivo}`
    impressoes.push(`${nome}:${sha}\n`)
    const atual = porNome(db, nome)
    if (atual) {
      const situacao = situacaoDaProjecao(db, chave, sha, atual.blob_sha256)
      resultados.push({ nome, resultado: situacao === 'atual' || situacao === 'defasada' ? 'ja-importada' : 'divergente' }); continue
    }
    // Hash já ingerido sem credencial viva com o nome: ela foi apagada (na lixeira ou já fora dela), e o
    // arquivo velho no disco não a traz de volta. Valor novo no arquivo é hash novo e entra.
    if (jaIngerido(db, chave, sha)) { resultados.push({ nome, resultado: 'apagada' }); continue }
    const hex = blobDoTextoHex(bruto)
    candidatas.push({ nome, chave, sha, blob: hex ?? bruto, textoHex: hex !== null })
  }
  const abertos = candidatas.length === 0 ? [] : ponte.abrir(candidatas.map((c) => c.blob))
  const convertidos = []
  candidatas.forEach((c, i) => {
    if (abertos[i]?.ok !== true) return
    const valor = abertos[i].valor
    const utf8 = c.textoHex ? utf16ParaUtf8(valor) : null
    valor.fill(0)
    if (!c.textoHex) c.abre = true
    else if (utf8) { c.abre = true; c.convertido = convertidos.push(utf8) - 1 }
  })
  try {
    const selados = convertidos.length === 0 ? [] : ponte.selar(convertidos)
    for (const c of candidatas) if (c.convertido !== undefined) c.blob = selados[c.convertido]
  } finally { for (const v of convertidos) v.fill(0) }
  const importadas = transacao(db, () => {
    let n = 0
    for (const c of candidatas) {
      if (!c.abre) { resultados.push({ nome: c.nome, resultado: 'nao-abriu' }); continue }
      if (porNome(db, c.nome)) { resultados.push({ nome: c.nome, resultado: 'ja-existe' }); continue }
      const classe = Object.hasOwn(classificacao, c.nome) ? classificacao[c.nome] : { tipo: 'outro', servico: null }
      inserir(db, { ...SEM_METADADOS, nome: c.nome, tipo: classe.tipo, servico: classe.servico ?? null, guarda: 'dpapi', alvo_windows: null, blob: c.blob, maquina, agora })
      registrarProjecao(db, c.chave, c.sha, 'ingerida')
      resultados.push({ nome: c.nome, resultado: 'importada' }); n += 1
    }
    registrarImportacao(db, { tipo: 'dpapi', fonte, fonteSha256: sha256(impressoes.sort().join('')), contagens: contar(resultados), maquina, agora })
    return n
  })
  resultados.sort((a, b) => (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0))
  return { importadas, resultados }   // nunca apaga os originais
}

const ehDoOmni = (alvo) => typeof alvo === 'string' && alvo.toLowerCase().startsWith('omni/')

export function registrarInventarioWindows(db, entradas, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  if (!Array.isArray(entradas)) throw new CofreError('dados-invalidos', 'O inventário precisa ser uma lista.')
  const doOmni = entradas.filter((entrada) => ehDoOmni(entrada?.alvo))
  const ignoradas = entradas.length - doOmni.length
  const resultados = []; const vistos = new Set()
  const { inventariadas, ausentes } = transacao(db, () => {
    let n = 0
    for (const { alvo, usuario } of doOmni) {
      vistos.add(alvo)
      if (!NOME.test(alvo)) { resultados.push({ nome: alvo, resultado: 'nome-invalido' }); continue }
      const atual = porNome(db, alvo)
      if (atual) { resultados.push({ nome: alvo, resultado: atual.guarda === 'gerenciador-windows' ? 'ja-inventariada' : 'conflito' }); continue }
      inserir(db, { ...SEM_METADADOS, nome: alvo, tipo: 'outro', servico: null, usuario: typeof usuario === 'string' && usuario.length <= 200 ? usuario : null, guarda: 'gerenciador-windows', alvo_windows: alvo, blob: null, maquina, agora })
      resultados.push({ nome: alvo, resultado: 'inventariada' }); n += 1
    }
    const fora = db.prepare("SELECT alvo_windows FROM credenciais WHERE guarda = 'gerenciador-windows' AND apagado_em IS NULL").all().filter((l) => !vistos.has(l.alvo_windows)).length
    registrarImportacao(db, { tipo: 'gerenciador-windows', fonte: 'Credential Manager', fonteSha256: sha256([...vistos].sort().join('\n')), contagens: { ...contar(resultados), ignoradas, ausentes: fora }, maquina, agora })
    return { inventariadas: n, ausentes: fora }
  })
  return { inventariadas, ausentes, ignoradas, resultados }   // ausentes contados, nunca apagados
}

export function exportarCofre(db, ponte, frase, { parametros = PARAMETROS_PADRAO, maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  conferirFrase(frase)
  conferirParametros(parametros)
  const linhas = db.prepare(`SELECT ${COLUNAS_PUBLICAS}, blob FROM credenciais WHERE apagado_em IS NULL ORDER BY nome`).all().map(deLinha)
  const doCofre = linhas.filter((linha) => linha.guarda === 'dpapi')
  const recadastrar = linhas.filter((linha) => linha.guarda === 'gerenciador-windows').map((linha) => ({ ...metadados(linha), alvo_windows: linha.alvo_windows }))
  const abertos = doCofre.length === 0 ? [] : ponte.abrir(doCofre.map((linha) => linha.blob))
  const uso = (linha, resultado) => registrarUso(db, { credencialId: linha.id, nome: linha.nome, agente: 'omni', sessao: null, motivo: 'exportacao do cofre', resultado, maquina, agora })
  try {
    const falhas = doCofre.filter((_, i) => !abertos[i]?.ok)
    if (falhas.length > 0) {
      transacao(db, () => { for (const linha of falhas) uso(linha, 'falhou-abrir') })
      throw new CofreError('nao-abriu', `${falhas.length} credencial(is) não abriram nesta máquina; nada foi exportado.`)
    }
    const conteudo = { formato: 'omni-cofre-conteudo', versao: 1, origem_maquina: maquina, exportado_em: agora,
      credenciais: doCofre.map((linha, i) => ({ ...metadados(linha), valor_b64: abertos[i].valor.toString('base64') })), recadastrar }
    const texto = selarPacote(conteudo, frase, parametros)
    transacao(db, () => { for (const linha of doCofre) uso(linha, 'exportada') })
    return { texto, credenciais: doCofre.length, recadastrar: recadastrar.length }
  } finally {
    for (const aberto of abertos) if (aberto?.ok) aberto.valor.fill(0)
  }
}

export function importarPacoteCofre(db, ponte, texto, frase, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  const conteudo = abrirPacote(texto, frase)
  if (conteudo?.formato !== 'omni-cofre-conteudo' || conteudo.versao !== 1 || !Array.isArray(conteudo.credenciais) || !Array.isArray(conteudo.recadastrar)) {
    throw new CofreError('pacote-invalido', 'O pacote não traz um cofre do Omni.')
  }
  const resultados = []; const candidatas = []
  for (const item of conteudo.credenciais) {
    let c
    try { c = normalizarDados(item) } catch (erro) {
      if (!(erro instanceof CofreError)) throw erro
      resultados.push({ nome: typeof item?.nome === 'string' ? item.nome : null, resultado: 'invalida' }); continue
    }
    const valor = typeof item.valor_b64 === 'string' && BASE64.test(item.valor_b64) ? Buffer.from(item.valor_b64, 'base64') : null
    if (!valor || valor.length === 0) { resultados.push({ nome: c.nome, resultado: 'invalida' }); continue }
    if (porNome(db, c.nome)) { valor.fill(0); resultados.push({ nome: c.nome, resultado: 'ja-existe' }); continue }
    candidatas.push({ ...c, valor })
  }
  let blobs = []
  try { blobs = candidatas.length === 0 ? [] : ponte.selar(candidatas.map((c) => c.valor)) } finally { for (const c of candidatas) c.valor.fill(0) }
  const recadastrar = conteudo.recadastrar.map((item) => ({ nome: item?.nome ?? null, alvo_windows: item?.alvo_windows ?? null, usuario: item?.usuario ?? null }))
  const importadas = transacao(db, () => {
    let n = 0
    candidatas.forEach((c, i) => {
      if (porNome(db, c.nome)) { resultados.push({ nome: c.nome, resultado: 'ja-existe' }); return }
      inserir(db, { ...c, guarda: 'dpapi', alvo_windows: null, blob: blobs[i], maquina, agora })
      resultados.push({ nome: c.nome, resultado: 'importada' }); n += 1
    })
    registrarImportacao(db, { tipo: 'pacote', fonte: 'pacote', fonteSha256: sha256(texto), contagens: contar(resultados), maquina, agora })
    return n
  })
  return { importadas, resultados, recadastrar }
}

export function historicoCredencial(db, id, { limite = 50 } = {}) {
  exigirId(id)
  if (!Number.isInteger(limite) || limite < 1 || limite > 500) throw new CofreError('dados-invalidos', 'Campo limite inválido.')
  if (!db.prepare('SELECT 1 AS sim FROM credenciais WHERE id = ?').get(id)) throw new CofreError('inexistente', 'Não há credencial com esse id.')
  return db.prepare('SELECT em, agente, sessao, motivo, resultado FROM usos WHERE credencial_id = ? ORDER BY em DESC, rowid DESC LIMIT ?').all(id, limite).map((linha) => ({ ...linha }))
}

// Saúde (§8.2), com o relógio injetado: vence em até 15 dias (ou já venceu); falhou no último teste; sem
// uso há 90 dias, contando só entregue, revelado-ao-dono e copiado-ao-dono; agente autorizado que nunca
// usou, depois de 90 dias de cadastro; e, só quando pedida, a duplicata. As três últimas valem só para a
// guarda dpapi: o cofre não vê o uso nem o valor do que mora no Gerenciador. O agente acrescentado
// depois por edição conta do criado_em, e isso fica declarado.
export function saudeCofre(db, { ponte = null, duplicatas = false, maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  const t = Date.parse(agora)
  const vivas = listarCredenciais(db)
  const ultimo = new Map(); const usaram = new Map()
  const reais = [...USO_REAL]
  for (const uso of db.prepare(`SELECT credencial_id, agente, resultado, em FROM usos WHERE credencial_id IS NOT NULL AND resultado IN (${reais.map(() => '?').join(', ')})`).all(...reais)) {
    const anterior = ultimo.get(uso.credencial_id)
    if (anterior === undefined || Date.parse(uso.em) > Date.parse(anterior)) ultimo.set(uso.credencial_id, uso.em)
    if (uso.resultado === 'entregue') usaram.set(uso.credencial_id, (usaram.get(uso.credencial_id) ?? new Set()).add(uso.agente))
  }
  const alertas = []
  for (const c of vivas) {
    if (c.validade !== null && Date.parse(c.validade) - t <= PRAZO_VENCE) alertas.push({ regra: 'vence', nome: c.nome, validade: c.validade })
    if (c.ultimo_teste_ok === false) alertas.push({ regra: 'teste-falhou', nome: c.nome, em: c.ultimo_teste_em })
    if (c.guarda !== 'dpapi') continue
    const desde = ultimo.get(c.id) ?? c.criado_em
    if (t - Date.parse(desde) >= PRAZO_SEM_USO) alertas.push({ regra: 'sem-uso', nome: c.nome, desde })
    else if (t - Date.parse(c.criado_em) >= CARENCIA_AGENTE) {
      for (const agente of c.agentes) if (!usaram.get(c.id)?.has(agente)) alertas.push({ regra: 'agente-nunca-usou', nome: c.nome, agente })
    }
  }
  return { total: vivas.length, alertas, duplicatas: duplicatas ? conferirDuplicatas(db, ponte, { maquina, agora }) : null }
}

function conferirDuplicatas(db, ponte, { maquina, agora }) {
  if (!ponte) throw new CofreError('dados-invalidos', 'A conferência de duplicatas precisa da ponte da DPAPI.')
  const linhas = db.prepare("SELECT id, nome, blob FROM credenciais WHERE apagado_em IS NULL AND guarda = 'dpapi' ORDER BY nome").all()
  const abertos = linhas.length === 0 ? [] : ponte.abrir(linhas.map((linha) => linha.blob))   // se lançar, propaga sem registrar
  try {
    const pares = []
    for (let i = 0; i < linhas.length; i += 1) for (let j = i + 1; j < linhas.length; j += 1) {
      if (abertos[i]?.ok && abertos[j]?.ok && Buffer.compare(abertos[i].valor, abertos[j].valor) === 0) pares.push([linhas[i].nome, linhas[j].nome])
    }
    const naoAbriram = linhas.filter((_, i) => !abertos[i]?.ok).map((linha) => linha.nome)
    transacao(db, () => { linhas.forEach((linha, i) => registrarUso(db, { credencialId: linha.id, nome: linha.nome, agente: 'omni', sessao: null, motivo: 'conferencia de duplicatas', resultado: abertos[i]?.ok ? 'conferido-saude' : 'falhou-abrir', maquina, agora })) })
    return { pares, naoAbriram }
  } finally {
    for (const item of abertos) if (item?.ok) item.valor.fill(0)
  }
}

export function editarCredencial(db, nome, mudancas, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  exigirNome(nome)
  if (mudancas === null || typeof mudancas !== 'object' || Array.isArray(mudancas)) throw new CofreError('dados-invalidos', 'As mudanças precisam ser um objeto.')
  const fora = Object.keys(mudancas).filter((campo) => !EDITAVEIS.has(campo))
  if (fora.length > 0) throw new CofreError('dados-invalidos', `Campo(s) que não se editam: ${fora.join(', ')}.`)
  return transacao(db, () => {
    const atual = credencialPorNome(db, nome)
    if (!atual) throw inexistente(nome)
    const antes = metadados(atual)
    const novo = normalizarDados({ ...antes, ...mudancas, nome: atual.nome })
    if (JSON.stringify(novo) === JSON.stringify(antes)) return atual
    db.prepare('UPDATE credenciais SET tipo = ?, servico = ?, url = ?, usuario = ?, notas = ?, etiquetas = ?, agentes = ?, validade = ?, rotacionar_dias = ?, origem_maquina = ?, atualizado_em = ?, versao = versao + 1 WHERE id = ?')
      .run(novo.tipo, novo.servico, novo.url, novo.usuario, novo.notas, JSON.stringify(novo.etiquetas), JSON.stringify(novo.agentes), novo.validade, novo.rotacionar_dias, maquina, agora, atual.id)
    return credencialPorNome(db, nome)
  })
}

export function rotacionarCredencial(db, ponte, nome, valor, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  exigirNome(nome)
  const bytes = comoBytes(valor)
  try {
    if (bytes.length === 0) throw new CofreError('valor-vazio', 'O valor da credencial está vazio.')
    const atual = porNome(db, nome)
    if (!atual) throw inexistente(nome)
    if (atual.guarda !== 'dpapi') throw soNoGerenciador(nome)
    const [blob] = ponte.selar([bytes])
    return transacao(db, () => {
      const r = db.prepare('UPDATE credenciais SET blob = ?, blob_sha256 = ?, ultimo_teste_em = NULL, ultimo_teste_ok = NULL, ultimo_teste_detalhe = NULL, origem_maquina = ?, atualizado_em = ?, versao = versao + 1 WHERE id = ? AND apagado_em IS NULL')
        .run(blob, sha256(blob), maquina, agora, atual.id)
      if (r.changes !== 1) throw inexistente(nome)
      registrarUso(db, { credencialId: atual.id, nome, agente: 'omni', sessao: null, motivo: 'rotacao', resultado: 'rotacionado', maquina, agora })
      return credencialPorNome(db, nome)
    })
  } finally { bytes.fill(0) }
}

export function apagarCredencial(db, nome, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  exigirNome(nome)
  return transacao(db, () => {
    const atual = porNome(db, nome)
    if (!atual) throw inexistente(nome)
    db.prepare('UPDATE credenciais SET apagado_em = ?, origem_maquina = ?, atualizado_em = ?, versao = versao + 1 WHERE id = ?').run(agora, maquina, agora, atual.id)
    return { id: atual.id, apagado_em: agora }
  })
}

export function restaurarCredencial(db, id, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  exigirId(id)
  return transacao(db, () => {
    const linha = db.prepare('SELECT nome FROM credenciais WHERE id = ? AND apagado_em IS NOT NULL').get(id)
    if (!linha) throw new CofreError('inexistente', 'Não há credencial com esse id na lixeira.')
    if (porNome(db, linha.nome)) throw jaExiste(linha.nome)
    db.prepare('UPDATE credenciais SET apagado_em = NULL, origem_maquina = ?, atualizado_em = ?, versao = versao + 1 WHERE id = ?').run(maquina, agora, id)
    return credencialPorNome(db, linha.nome)
  })
}

export function listarLixeira(db) { return db.prepare(`SELECT ${COLUNAS_PUBLICAS}, apagado_em FROM credenciais WHERE apagado_em IS NOT NULL ORDER BY apagado_em DESC, nome`).all().map(deLinha) }

// Esvaziar leva de vez só o que está na lixeira há mais de 30 dias; o registro de uso fica, e o diário
// anota a remoção. Sem secure_delete, o blob removido pode sobrar em página livre ou no WAL até ser
// reaproveitado, mas continua selado pela DPAPI do usuário.
export function esvaziarLixeira(db, { agora = agoraIso() } = {}) {
  const t = Date.parse(agora)
  return transacao(db, () => {
    const vencidas = db.prepare('SELECT id, apagado_em FROM credenciais WHERE apagado_em IS NOT NULL').all().filter((linha) => t - Date.parse(linha.apagado_em) > PRAZO_LIXEIRA)
    const apagar = db.prepare('DELETE FROM credenciais WHERE id = ?')
    for (const linha of vencidas) apagar.run(linha.id)
    return { apagadas: vencidas.length }
  })
}

// O caminho do dono: a presença (Windows Hello ou PIN, pela ponte de runtime/casa/presenca.mjs) é uma
// função síncrona que devolve { ok, motivo }. Ela só é chamada para credencial viva da guarda dpapi, para
// não pedir digital à toa, e todo pedido vira linha em usos com o agente dono.
function pedirAoDono(db, presenca, nome, motivo, { maquina, agora }) {
  exigirNome(nome)
  if (typeof presenca !== 'function') throw new CofreError('dados-invalidos', 'Falta a ponte de presença.')
  const linha = db.prepare('SELECT id, guarda, blob FROM credenciais WHERE nome = ? AND apagado_em IS NULL').get(nome)
  const registrar = (resultado) => registrarUso(db, { credencialId: linha?.id ?? null, nome, agente: DONO, sessao: null, motivo, resultado, maquina, agora })
  if (!linha) { registrar('recusado-inexistente'); throw inexistente(nome) }
  if (linha.guarda !== 'dpapi') { registrar('recusado-gerenciador'); throw soNoGerenciador(nome) }
  let presente
  try { presente = presenca() } catch (erro) { registrar('recusado-presenca'); throw erro }
  if (presente?.ok !== true) {
    registrar('recusado-presenca')
    throw new CofreError('sem-presenca', `A presença do dono não foi confirmada (${presente?.motivo ?? 'sem resposta'}).`)
  }
  return { linha, registrar }
}

export function revelarAoDono(db, ponte, presenca, nome, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  const { linha, registrar } = pedirAoDono(db, presenca, nome, 'ver', { maquina, agora })
  const valor = abrirRegistrando(ponte, linha.blob, nome, registrar)
  try { return { valor, usoId: registrar('revelado-ao-dono') } } catch (erro) { valor.fill(0); throw erro }
}

// Copiar não devolve o valor: a ponte abre o blob, grava na área de transferência fora do histórico e da
// nuvem e programa a limpeza (runtime/casa/dpapi.mjs); aqui volta só o uso e a hora da limpeza.
export function copiarAoDono(db, ponte, presenca, nome, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  const { linha, registrar } = pedirAoDono(db, presenca, nome, 'copiar', { maquina, agora })
  let copiado
  try { copiado = ponte.abrirParaAreaDeTransferencia(linha.blob) } catch (erro) { registrar('falhou-copiar'); throw erro }
  if (!copiado?.ok) { registrar('falhou-copiar'); throw new CofreError('nao-copiou', `${nome} não foi copiada (${copiado?.erro ?? 'sem resposta'}).`) }
  return { usoId: registrar('copiado-ao-dono'), limpaEm: copiado.limpaEm ?? null }
}
```

- [x] **Passo 4: extrair o módulo e ver o verde, com a LC, o CB e a CL junto.** A LC e a CL são as duas suítes que importam a loja; o CB abre o `cofre.db` com a v1 congelada.

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so runtime/casa/loja-cofre.mjs
node --test --test-concurrency=1 --test-reporter=spec testes/casa-loja-cofre-gestao.test.mjs testes/casa-loja-cofre.test.mjs testes/casa-banco.test.mjs testes/cofre-cli.test.mjs *> "$rascunho\p5-t1-verde.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\p5-t1-verde.txt" -Pattern '(tests|pass|fail) \d+\s*$'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `gravado runtime/casa/loja-cofre.mjs`, `tests 54` (LG 12, LC 10, CB 23 e CL 9), `pass 54`, `fail 0`, `saida: 0` e `False`.

Resultado (06/11): `gravado runtime/casa/loja-cofre.mjs`, `tests 54`, `pass 54`, `fail 0`, `saida: 0` e `False`. A CL rodou pela primeira vez contra a loja nova e passou inteira.

**Mutação.** Trinta e um mutantes, todos na loja. Os vinte e um primeiros são do comportamento novo e morrem na LG; os dez últimos (22 a 31) são os mutantes do plano 4 que miram a loja, que volta inteira neste plano: oito com o trecho igual e dois ajustados porque o trecho mudou (executor, item 16). Cada um tem o trecho exato (uma vez só no arquivo), a troca e as suítes que devem matá-lo. O executor aplica um por vez, roda as suítes do mutante pelo `run()` do `node:test`, restaura sempre e anota cada teste que caiu. A tabela derruba a rodada se um mutante sobreviver sem estar declarado equivalente, se uma queda não for `AssertionError` com `ERR_ASSERTION` ou se vier de suíte fora das do mutante: mutante que morre no setup não prova nada. O trecho do 18 é parte do trecho do 13, o do 30 é parte do 26 e o do 22 é o mesmo do 07, mas cada mutante é aplicado sozinho.

```json rascunho=mutantes-p5-t1.json
[
  { "nome": "01 vence com 16 dias", "arquivo": "runtime/casa/loja-cofre.mjs", "de": "const PRAZO_VENCE = 15 * DIA", "para": "const PRAZO_VENCE = 16 * DIA", "teste": ["testes/casa-loja-cofre-gestao.test.mjs"] },
  { "nome": "02 vence com <", "arquivo": "runtime/casa/loja-cofre.mjs", "de": "Date.parse(c.validade) - t <= PRAZO_VENCE", "para": "Date.parse(c.validade) - t < PRAZO_VENCE", "teste": ["testes/casa-loja-cofre-gestao.test.mjs"] },
  { "nome": "03 conferência contada como uso", "arquivo": "runtime/casa/loja-cofre.mjs", "de": "new Set(['entregue', 'revelado-ao-dono', 'copiado-ao-dono'])", "para": "new Set(['entregue', 'revelado-ao-dono', 'copiado-ao-dono', 'conferido-saude'])", "teste": ["testes/casa-loja-cofre-gestao.test.mjs"] },
  { "nome": "04 sem-uso com >", "arquivo": "runtime/casa/loja-cofre.mjs", "de": "t - Date.parse(desde) >= PRAZO_SEM_USO", "para": "t - Date.parse(desde) > PRAZO_SEM_USO", "teste": ["testes/casa-loja-cofre-gestao.test.mjs"] },
  { "nome": "05 valor da duplicata não zerado", "arquivo": "runtime/casa/loja-cofre.mjs", "de": "item.valor.fill(0)", "para": "void item", "teste": ["testes/casa-loja-cofre-gestao.test.mjs"] },
  { "nome": "06 dono aceito em agentes", "arquivo": "runtime/casa/loja-cofre.mjs", "de": "if (agentes.includes(DONO)) throw", "para": "if (false) throw", "teste": ["testes/casa-loja-cofre-gestao.test.mjs"] },
  { "nome": "07 uso sem a recusa do dono", "arquivo": "runtime/casa/loja-cofre.mjs", "de": "if (agente === DONO || !JSON.parse(linha.agentes).includes(agente)) {", "para": "if (!JSON.parse(linha.agentes).includes(agente)) {", "teste": ["testes/casa-loja-cofre-gestao.test.mjs"] },
  { "nome": "08 abrir sem a presença", "arquivo": "runtime/casa/loja-cofre.mjs", "de": "if (presente?.ok !== true) {", "para": "if (false) {", "teste": ["testes/casa-loja-cofre-gestao.test.mjs"] },
  { "nome": "09 esvaziar com 29 dias", "arquivo": "runtime/casa/loja-cofre.mjs", "de": "const PRAZO_LIXEIRA = 30 * DIA", "para": "const PRAZO_LIXEIRA = 29 * DIA", "teste": ["testes/casa-loja-cofre-gestao.test.mjs"] },
  { "nome": "10 esvaziar com >=", "arquivo": "runtime/casa/loja-cofre.mjs", "de": "t - Date.parse(linha.apagado_em) > PRAZO_LIXEIRA", "para": "t - Date.parse(linha.apagado_em) >= PRAZO_LIXEIRA", "teste": ["testes/casa-loja-cofre-gestao.test.mjs"] },
  { "nome": "11 rotação sem zerar o último teste", "arquivo": "runtime/casa/loja-cofre.mjs", "de": "ultimo_teste_em = NULL, ultimo_teste_ok = NULL, ultimo_teste_detalhe = NULL, ", "para": "", "teste": ["testes/casa-loja-cofre-gestao.test.mjs"] },
  { "nome": "12 import ressuscitando o apagado", "arquivo": "runtime/casa/loja-cofre.mjs", "de": "if (jaIngerido(db, chave, sha)) {", "para": "if (false) {", "teste": ["testes/casa-loja-cofre-gestao.test.mjs"] },
  { "nome": "13 agente-nunca-usou sem carência", "arquivo": "runtime/casa/loja-cofre.mjs", "de": "else if (t - Date.parse(c.criado_em) >= CARENCIA_AGENTE) {", "para": "else {", "teste": ["testes/casa-loja-cofre-gestao.test.mjs"] },
  { "nome": "14 teste que falhou ignorado", "arquivo": "runtime/casa/loja-cofre.mjs", "de": "if (c.ultimo_teste_ok === false) alertas.push(", "para": "if (false) alertas.push(", "teste": ["testes/casa-loja-cofre-gestao.test.mjs"] },
  { "nome": "15 restaurar por cima de nome vivo", "arquivo": "runtime/casa/loja-cofre.mjs", "de": "if (porNome(db, linha.nome)) throw jaExiste(linha.nome)", "para": "if (false) throw jaExiste(linha.nome)", "teste": ["testes/casa-loja-cofre-gestao.test.mjs"] },
  { "nome": "16 edição sem mudança sobe a versão", "arquivo": "runtime/casa/loja-cofre.mjs", "de": "if (JSON.stringify(novo) === JSON.stringify(antes)) return atual", "para": "if (false) return atual", "teste": ["testes/casa-loja-cofre-gestao.test.mjs"] },
  { "nome": "17 sem-uso também no Gerenciador", "arquivo": "runtime/casa/loja-cofre.mjs", "de": "if (c.guarda !== 'dpapi') continue", "para": "if (false) continue", "teste": ["testes/casa-loja-cofre-gestao.test.mjs"] },
  { "nome": "18 carência com >", "arquivo": "runtime/casa/loja-cofre.mjs", "de": "Date.parse(c.criado_em) >= CARENCIA_AGENTE", "para": "Date.parse(c.criado_em) > CARENCIA_AGENTE", "teste": ["testes/casa-loja-cofre-gestao.test.mjs"] },
  { "nome": "19 histórico do mais velho ao mais novo", "arquivo": "runtime/casa/loja-cofre.mjs", "de": "ORDER BY em DESC, rowid DESC LIMIT ?", "para": "ORDER BY em, rowid LIMIT ?", "teste": ["testes/casa-loja-cofre-gestao.test.mjs"] },
  { "nome": "20 Gerenciador aberto ao dono", "arquivo": "runtime/casa/loja-cofre.mjs", "de": "if (linha.guarda !== 'dpapi') { registrar('recusado-gerenciador')", "para": "if (false) { registrar('recusado-gerenciador')", "teste": ["testes/casa-loja-cofre-gestao.test.mjs"] },
  { "nome": "21 rotação no Gerenciador", "arquivo": "runtime/casa/loja-cofre.mjs", "de": "if (atual.guarda !== 'dpapi') throw soNoGerenciador(nome)", "para": "if (false) throw soNoGerenciador(nome)", "teste": ["testes/casa-loja-cofre-gestao.test.mjs"] },
  { "nome": "22 recusa do agente desligada (plano 4, 01)", "arquivo": "runtime/casa/loja-cofre.mjs", "de": "if (agente === DONO || !JSON.parse(linha.agentes).includes(agente)) {", "para": "if (agente === DONO) {", "teste": ["testes/casa-loja-cofre.test.mjs", "testes/cofre-cli.test.mjs"] },
  { "nome": "23 recusa do agente sem registro em usos (plano 4, 02)", "arquivo": "runtime/casa/loja-cofre.mjs", "de": "registrar(linha.id, 'recusado-agente')", "para": "void 'recusado-agente'", "teste": ["testes/casa-loja-cofre.test.mjs"] },
  { "nome": "24 credencial do Gerenciador entregue como DPAPI (plano 4, 03)", "arquivo": "runtime/casa/loja-cofre.mjs", "de": "if (linha.guarda !== 'dpapi') { registrar(linha.id, 'recusado-gerenciador')", "para": "if (false) { registrar(linha.id, 'recusado-gerenciador')", "teste": ["testes/casa-loja-cofre.test.mjs"] },
  { "nome": "25 inventário sem o filtro Omni/ (plano 4, 08)", "arquivo": "runtime/casa/loja-cofre.mjs", "de": "const ehDoOmni = (alvo) => typeof alvo === 'string' && alvo.toLowerCase().startsWith('omni/')", "para": "const ehDoOmni = (alvo) => typeof alvo === 'string'", "teste": ["testes/casa-loja-cofre.test.mjs"] },
  { "nome": "26 divergente contado como já importado (plano 4, 09)", "arquivo": "runtime/casa/loja-cofre.mjs", "de": "situacao === 'atual' || situacao === 'defasada' ? 'ja-importada' : 'divergente'", "para": "'ja-importada'", "teste": ["testes/casa-loja-cofre.test.mjs"] },
  { "nome": "27 pacote sem conferir o formato do conteúdo (plano 4, 14)", "arquivo": "runtime/casa/loja-cofre.mjs", "de": "conteudo?.formato !== 'omni-cofre-conteudo' ||", "para": "false ||", "teste": ["testes/casa-loja-cofre.test.mjs"] },
  { "nome": "28 texto hex do SecureString não reconhecido (plano 4, 15)", "arquivo": "runtime/casa/loja-cofre.mjs", "de": "return HEX.test(texto) ? Buffer.from(texto, 'hex') : null", "para": "return null", "teste": ["testes/casa-loja-cofre.test.mjs"] },
  { "nome": "29 texto hex gravado sem re-selar em UTF-8 (plano 4, 16)", "arquivo": "runtime/casa/loja-cofre.mjs", "de": "c.blob = selados[c.convertido]", "para": "void selados[c.convertido]", "teste": ["testes/casa-loja-cofre.test.mjs"] },
  { "nome": "30 arquivo já ingerido contado como divergente (plano 4, 17)", "arquivo": "runtime/casa/loja-cofre.mjs", "de": "situacao === 'atual' || situacao === 'defasada' ?", "para": "situacao === 'atual' ?", "teste": ["testes/casa-loja-cofre.test.mjs"] },
  { "nome": "31 UTF-16LE de tamanho ímpar aceito (plano 4, 18)", "arquivo": "runtime/casa/loja-cofre.mjs", "de": "if (valor.length % 2 !== 0) return null", "para": "if (false) return null", "teste": ["testes/casa-loja-cofre.test.mjs"] }
]
```

Mapa previsto de mutante para teste:

| Mutante | Morre em | Como cai |
|---|---|---|
| 01 | LG 3 | deepEqual dos alertas |
| 02 | LG 3 | deepEqual dos alertas (a borda exata) |
| 03 | LG 5 | deepEqual dos alertas |
| 04 | LG 5 | deepEqual dos alertas (a borda exata) |
| 05 | LG 7 | `ok` ("os valores abertos para comparar ficam zerados") |
| 06 | LG 1 | `throws` sem exceção |
| 07 | LG 1 | `throws` sem exceção |
| 08 | LG 11 | `throws` sem exceção |
| 09 | LG 10 | deepEqual |
| 10 | LG 10 | deepEqual (a borda exata) |
| 11 | LG 9 | equal |
| 12 | LG 12 | deepEqual dos resultados |
| 13 | LG 3, LG 4 e LG 6 | deepEqual dos alertas |
| 14 | LG 4 | deepEqual dos alertas |
| 15 | LG 10 | `throws` com outro erro |
| 16 | LG 8 | equal da versão |
| 17 | LG 5 | deepEqual dos alertas |
| 18 | LG 6 | deepEqual dos alertas (a borda exata) |
| 19 | LG 2 | deepEqual do histórico |
| 20 | LG 11 | `throws` com outro erro |
| 21 | LG 9 | `throws` com outro erro: sem a guarda, a rotação grava blob numa linha do Gerenciador e o CHECK da v1 recusa |
| 22 | LC 3 e CL 5 | `throws` sem exceção; no CL 5, `equal` (1≠3), como o 01 do plano 4 |
| 23 | LC 3 | deepEqual dos usos |
| 24 | LC 3 | `throws` com outro erro |
| 25 | LC 7 | deepEqual |
| 26 | LC 5 e LC 6 | deepEqual |
| 27 | LC 10 | `throws` sem exceção |
| 28 | LC 6 | equal |
| 29 | LC 6 | equal |
| 30 | LC 6 | deepEqual |
| 31 | LC 6 | equal |

- [x] **Passo 5: extrair a lista e a tabela, e anotar os hashes.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so mutantes.mjs tabela-mutantes-p5.mjs mutantes-p5-t1.json
$alvos = 'runtime/casa/loja-cofre.mjs', 'testes/casa-loja-cofre-gestao.test.mjs'
$alvos | ForEach-Object { $_ + ' ' + (Get-FileHash $_ -Algorithm SHA256).Hash.Substring(0, 12) } | Set-Content -Encoding utf8 "$rascunho\hashes-antes-p5-t1.txt"
Get-Content "$rascunho\hashes-antes-p5-t1.txt"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `igual mutantes.mjs`, `gravado tabela-mutantes-p5.mjs`, `gravado mutantes-p5-t1.json`, as duas linhas de hash e `False`. Os hashes vão para um arquivo porque o `$alvos` e os hashes não sobrevivem até o Passo 7.

Resultado (06/11): `igual mutantes.mjs`, `gravado tabela-mutantes-p5.mjs`, `gravado mutantes-p5-t1.json`, `runtime/casa/loja-cofre.mjs 96E59497055E`, `testes/casa-loja-cofre-gestao.test.mjs 998BE740238A` e `False`.

- [x] **Passo 6: rodar, em segundo plano.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
node "$rascunho\mutantes.mjs" "$rascunho\mutantes-p5-t1.json" *> "$rascunho\mutantes-p5-t1.txt"; "saida: $LASTEXITCODE"
```

Esperado: a última linha de `mutantes-p5-t1.txt` é `31 mutantes em … s; fora do vermelho: 0`, e `saida: 0`.

Resultado (06/11): `31 mutantes em 27 s; fora do vermelho: 0` e `saida: 0`.

- [x] **Passo 7: a tabela, os hashes e a guarda.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
$alvos = 'runtime/casa/loja-cofre.mjs', 'testes/casa-loja-cofre-gestao.test.mjs'
node "$rascunho\tabela-mutantes-p5.mjs" "$rascunho\mutantes-p5-t1.json"; "saida: $LASTEXITCODE"
$depois = $alvos | ForEach-Object { $_ + ' ' + (Get-FileHash $_ -Algorithm SHA256).Hash.Substring(0, 12) }
Compare-Object (Get-Content "$rascunho\hashes-antes-p5-t1.txt") $depois
git status --short
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --conferir; "saida: $LASTEXITCODE"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `31 linhas: 31 vermelhos, 0 equivalente(s); testes mapeados: 35`, nenhuma linha `PROBLEMA` e `saida: 0`; o `Compare-Object` calado (os dois arquivos voltaram byte a byte); no status, ` M runtime/casa/loja-cofre.mjs`, `?? testes/casa-loja-cofre-gestao.test.mjs` e `?? docs/superpowers/plans/2026-11-06-f1-plano-5-card-cofre.md`, além dos ` M dist/…` de fim de linha (item 15); seis `igual` (extrator, executor, tabela, LG, loja e lista) e `saida: 0`; e `False`. A tabela gerada (`$rascunho\mutantes-p5-t1.tabela.md`) entra no Apêndice A.

Resultado (06/11): `31 linhas: 31 vermelhos, 0 equivalente(s); testes mapeados: 35`, nenhuma linha `PROBLEMA` e `saida: 0`; o `Compare-Object` calado; no status, fora os ` M dist/…`, as três linhas esperadas; seis `igual` e `saida: 0`; e `False`. Os 31 caíram nos testes previstos, conferidos pelo nome, e do jeito previsto; o 22 derrubou também o CL 5. O mapa tinha sido escrito com os números da LC do plano 4 (item das siglas); depois da rodada, passou a usar a posição no arquivo: o 25 foi de LC 6 para LC 7, o 26 de LC 5 e LC 10 para LC 5 e LC 6, o 27 de LC 9 para LC 10 e o 28 a 31 de LC 10 para LC 6. Nenhum teste previsto mudou. A tabela está no Apêndice A.

### Task 2: ponte de presença e área de transferência

**Arquivos:** criar `runtime/casa/presenca.mjs` e `testes/casa-presenca.test.mjs` (PR); modificar `runtime/casa/dpapi.mjs` e `testes/casa-dpapi.test.mjs` (DP novos).

O passo 0 sonda esta máquina antes do código, sem abrir diálogo e sem tocar a área de transferência, pelo mesmo caminho das pontes (PowerShell 5.1, `-EncodedCommand` sem argumento depois, `spawnSync` com `windowsHide`). Ele responde a três perguntas de que o desenho depende:
- (a) o Hello está disponível? Só o `CheckAvailabilityAsync`, pelo `AsTask`;
- (b) um PowerShell solto pelo `Start-Process` (a limpeza dos 30 s, decisão 4) sobrevive ao pai, termina sozinho e não segura o `spawnSync`? Se o neto herdasse o pipe do stdout, o `spawnSync` da CLI esperaria por ele até o fim;
- (c) o `Start-Process` leva um `-EncodedCommand` de mais de 4000 caracteres, e o neto herda o ambiente que o pai acabou de mudar? A limpeza passa de 2000 caracteres e recebe o prazo por `OMNI_COFRE_AREA_PRAZO`.

O `RequestVerificationAsync`, o `IUserConsentVerifierInterop` com o hwnd da janela e a área de transferência real ficam para a T8, com o Weriton.

```js rascunho=sondar-t2.mjs
// Sondagem da T2 do plano 5, sem diálogo e sem área de transferência, pelo mesmo caminho das pontes
// (PowerShell 5.1, -EncodedCommand sem argumento depois, spawnSync com windowsHide):
// (a) o Hello está disponível? Só o CheckAvailabilityAsync, que não abre diálogo;
// (b) um PowerShell destacado pelo Start-Process sobrevive ao pai, termina sozinho e não segura o spawnSync?
// (c) o Start-Process leva um -EncodedCommand de mais de 4000 caracteres (a limpeza da área de transferência passa
//     de 2000) e o neto herda o ambiente que o pai acabou de mudar?
// Uso: node sondar-t2.mjs <rascunho>. Sai com 1 se alguma das três perguntas ficou sem resposta limpa.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as esperar } from 'node:timers/promises'

const [rascunho] = process.argv.slice(2)
if (!rascunho || !existsSync(rascunho)) { console.log('FALHA falta o rascunho'); process.exit(2) }
const POWERSHELL = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const codificar = (script) => Buffer.from(script, 'utf16le').toString('base64')
const problemas = []

function rodar(script, entrada, limiteMs) {
  const inicio = Date.now()
  const r = spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-EncodedCommand', codificar(script)], {
    input: entrada, encoding: 'utf8', windowsHide: true, timeout: limiteMs
  })
  const stderr = (r.stderr ?? '').split('\n').map((linha) => linha.trim()).filter(Boolean)
  return { ms: Date.now() - inicio, status: r.status, erro: r.error?.code ?? null, saida: (r.stdout ?? '').trim(), stderr }
}

// (a) Só a disponibilidade. O AsTask genérico de IAsyncOperation`1 é escolhido pelo nome do parâmetro
// (o [char]96 é a crase, que não pode aparecer neste template).
const HELLO = String.raw`$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime]
$nome = 'IAsyncOperation' + [char]96 + '1'
$comoTarefa = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq $nome } | Select-Object -First 1
$tarefa = $comoTarefa.MakeGenericMethod([Windows.Security.Credentials.UI.UserConsentVerifierAvailability]).Invoke($null, @([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()))
if (-not $tarefa.Wait(10000)) { [Console]::Out.Write('tempo' + [char]10); exit 0 }
[Console]::Out.Write('ps ' + $PSVersionTable.PSVersion + ' so ' + [Environment]::OSVersion.Version + ' apartamento ' + [Threading.Thread]::CurrentThread.GetApartmentState() + ' disponibilidade ' + $tarefa.Result + [char]10)
`
const hello = rodar(HELLO, '', 30_000)
console.log(`hello: ${hello.saida || '(nada)'} (saída ${hello.status}${hello.erro ? `, erro ${hello.erro}` : ''}, ${hello.ms} ms)`)
if (hello.status !== 0 || !/^ps \S+ so \S+ apartamento \w+ disponibilidade \w+$/.test(hello.saida)) {
  problemas.push(`a disponibilidade não voltou limpa${hello.stderr.length ? `: ${hello.stderr[0]}` : ''}`)
}

// (b) e (c) O pai lê a marca pelo stdin, põe OMNI_SONDA_T2 no próprio ambiente, solta o neto pelo Start-Process
// (ShellExecute, sem herdar o pipe) e sai. O código do neto leva um comentário de 1600 x para passar de 4000
// caracteres. O neto dorme 5 s, grava na marca o OMNI_SONDA_T2 que herdou e termina. A marca só tem o caminho do
// rascunho, nunca dado da casa.
const DESTACADO = String.raw`$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$marca = [Console]::In.ReadToEnd().Trim()
$env:OMNI_SONDA_T2 = 'herdado'
$neto = 'Start-Sleep -Seconds 5; [IO.File]::WriteAllText(''' + $marca.Replace("'", "''") + ''', $env:OMNI_SONDA_T2)' + [char]10 + '# ' + ('x' * 1600)
$codigo = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($neto))
$processo = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList '-NoProfile', '-NonInteractive', '-EncodedCommand', $codigo -WindowStyle Hidden -PassThru
[Console]::Out.Write('destacado ' + $processo.Id + ' comprimento ' + $codigo.Length + [char]10)
`
const marca = join(rascunho, 'sonda-t2-destacado.txt')
rmSync(marca, { force: true })
const inicio = Date.now()
const pai = rodar(DESTACADO, `${marca}\n`, 30_000)
const solto = /^destacado (\d+) comprimento (\d+)$/.exec(pai.saida)
const pid = Number(solto?.[1] ?? 0)
const comprimento = Number(solto?.[2] ?? 0)
let viu = null
while (Date.now() - inicio < 20_000) {
  if (existsSync(marca)) { viu = Date.now() - inicio; break }
  await esperar(100)
}
await esperar(1000)
let vivo = null
if (pid > 0) { try { process.kill(pid, 0); vivo = true } catch { vivo = false } }
const conteudo = viu === null ? null : readFileSync(marca, 'utf8')
rmSync(marca, { force: true })
console.log(`destacado: o pai saiu com ${pai.status} em ${pai.ms} ms e passou ${comprimento} caracteres ao neto; a marca ${viu === null ? 'não apareceu' : `apareceu em ${viu} ms com "${conteudo}"`}; o neto vivo 1 s depois: ${vivo}`)
if (pai.status !== 0 || pid === 0) problemas.push(`o pai não soltou o neto${pai.stderr.length ? `: ${pai.stderr[0]}` : ''}`)
if (pai.ms >= 5000) problemas.push('o spawnSync esperou o neto: ele herdou o pipe')
if (comprimento <= 4000) problemas.push('o código do neto não passou de 4000 caracteres')
if (viu === null || viu < 5000) problemas.push('o neto não sobreviveu ao pai ou não esperou os 5 s')
else if (conteudo !== 'herdado') problemas.push('o neto não herdou o ambiente do pai')
if (vivo !== false) problemas.push('o neto não terminou sozinho')

for (const problema of problemas) console.log(`PROBLEMA ${problema}`)
process.exit(problemas.length > 0 ? 1 : 0)
```

- [x] **Passo 0: sondar.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so sondar-t2.mjs; "saida: $LASTEXITCODE"
node "$rascunho\sondar-t2.mjs" $rascunho; "saida: $LASTEXITCODE"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `gravado sondar-t2.mjs` e `saida: 0`; a linha `hello:` com `ps 5.1.…`, a versão do Windows, o apartamento e a disponibilidade, com `saída 0`; a linha `destacado:` com o pai saindo com 0 em menos de 5000 ms e passando mais de 4000 caracteres ao neto, a marca aparecendo com "herdado" em 5000 ms ou mais e o neto morto 1 s depois (`false`); nenhuma linha `PROBLEMA`, `saida: 0` e `False`. Disponibilidade diferente de `Available` muda o plano: a presença real não seria provável na T8, e a decisão volta ao Weriton antes do código.

Resultado (06/11): `gravado sondar-t2.mjs` e `saida: 0`; `hello: ps 5.1.26100.9711 so 10.0.26200.0 apartamento STA disponibilidade DeviceNotPresent (saída 0, 897 ms)`; `destacado: o pai saiu com 0 em 597 ms; a marca apareceu em 5936 ms com "feito"; o neto vivo 1 s depois: false`; nenhuma linha `PROBLEMA`, `saida: 0` e `False`. Essa rodada foi com a sonda de duas perguntas, antes da (c).

Resultado (07/11), com a sonda deste plano: `gravado sondar-t2.mjs` e `saida: 0`; `hello: ps 5.1.26100.9711 so 10.0.26200.0 apartamento STA disponibilidade DeviceNotPresent (saída 0, 948 ms)`; `destacado: o pai saiu com 0 em 1270 ms e passou 4648 caracteres ao neto; a marca apareceu em 6727 ms com "herdado"; o neto vivo 1 s depois: false`; nenhuma linha `PROBLEMA`, `saida: 0` e `False`.
- As perguntas (b) e (c) fecharam como o desenho previa: a limpeza destacada da decisão 4 fica, com o prazo pelo ambiente.
- A (a) não. O Hello não está configurado para o usuário desta máquina: não há contêiner do Windows Hello nem leitor biométrico, e criar o PIN depende de quem administra a máquina, não do código.
- O desenho já cobre esse caso, sem plano B: `disponivel()` e `verificar()` devolvem `{ ok: false, motivo: 'indisponivel' }`, e a loja recusa ver e copiar com `sem-presenca` (decisão 19).
- A decisão volta ao Weriton. Ela muda a T8, cujos três toques esperam o Hello, e, se ele escolher outro fator de presença, abre uma tarefa nova.
- O código da PR e dos DP novos não muda com a resposta, porque o contrato deles vale nos dois caminhos; por isso eles seguem antes dela.

A PR tem 6 testes, e a DP passa de 8 para 13. Os novos usam o `executar` injetado, salvo três reais, que pulam fora do Windows e com `OMNI_SO_FALSOS=1` (executor, item 23):
- a PR 1, que só chama `disponivel()`, sem abrir diálogo;
- a DP 9, que manda à cópia um blob que a DPAPI não abre e recebe `CryptographicException` antes de a área de transferência ser tocada;
- a DP 10, que só faz o parse da limpeza destacada pelo `Parser::ParseInput` do 5.1, sem executá-la.

Os demais testes novos provam:
- **na PR:** cada desfecho (`ok`, `cancelado`, `indisponivel`, `tempo`, `falhou`) vira `{ ok, motivo }`, nos dois métodos; a mensagem do Hello vai pelo stdin, em base64 de UTF-8, nunca no script; o script vai por `-EncodedCommand`, sem argumento depois dele, pelo PowerShell do sistema; a resposta torta, o filho que falhou e o erro de spawn viram `falhou` ou `tempo`, nunca exceção; e a mensagem vazia ou que não é texto não chega ao PowerShell;
- **na DP:** `abrirParaAreaDeTransferencia` manda o blob só pelo stdin; o script tem os três formatos de exclusão (decisão 4), o `GetClipboardSequenceNumber` e a limpeza destacada aos 30 s, que só limpa se o número não mudou; a falha devolve o tipo de dentro do `InnerException`; a resposta é `{ ok, limpaEm?, erro? }`, e o prazo volta em ISO.

- [x] **Passo 1: os testes.** A PR inteira e a DP inteira, com os 8 testes do plano 4 dentro.

```js arquivo=testes/casa-presenca.test.mjs
// Ponte de presença do cofre (decisões 2, 3 e 19): o Windows Hello real só pela disponibilidade, que não abre
// diálogo, e a de mentira para o protocolo (a mensagem fora do argumento e do script, cada desfecho, a resposta
// torta que vira falhou e a mensagem inválida, que nem chega ao PowerShell).
import assert from 'node:assert/strict'
import test from 'node:test'

import { powershellPadrao } from '../runtime/casa/dpapi.mjs'
import { criarPontePresenca } from '../runtime/casa/presenca.mjs'

// OMNI_SO_FALSOS=1 pula o teste que abre o PowerShell de verdade: a rodada de mutantes repete a suíte em
// sequência, e só os testes com o executor falso entram nela. O real roda uma vez, no verde.
const NO_WINDOWS = { skip: process.platform !== 'win32' ? 'o Windows Hello só existe no Windows' : process.env.OMNI_SO_FALSOS === '1' ? 'OMNI_SO_FALSOS=1: só os testes falsos' : false }
function executorFalso(resposta, chamadas = []) {
  return (comando, args, opcoes) => { chamadas.push({ comando, args, opcoes }); return { status: 0, stdout: '', stderr: '', ...resposta } }
}
const decodificarScript = (args) => Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le')
const desfecho = (motivo) => ({ ok: motivo === 'ok', motivo })
const INDISPONIVEIS = ['DeviceNotPresent', 'NotConfiguredForUser', 'DisabledByPolicy', 'DeviceBusy']
function perguntar(metodo, resposta) {
  const ponte = criarPontePresenca({ executar: executorFalso(resposta) })
  return metodo === 'disponivel' ? ponte.disponivel() : ponte.verificar('Confirme que é você')
}

test('Hello real: a disponibilidade responde ok ou indisponivel, sem abrir diálogo', NO_WINDOWS, () => {
  const resposta = criarPontePresenca().disponivel()
  assert.ok(['ok', 'indisponivel'].includes(resposta.motivo), `motivo inesperado: ${resposta.motivo}`)
  assert.deepEqual(resposta, desfecho(resposta.motivo))
})

test('a mensagem do Hello vai só no stdin, em base64 de UTF-8; o script vai por -EncodedCommand, sem nada depois', () => {
  const mensagem = 'Mostrar o segredo de exemplo — ação do dono'
  const b64 = Buffer.from(mensagem, 'utf8').toString('base64')
  const chamadas = []
  const ponte = criarPontePresenca({ executar: executorFalso({ stdout: 'resultado Verified\r\n' }, chamadas), powershell: 'ps-falso.exe', limiteMs: 1234 })
  assert.deepEqual(ponte.verificar(mensagem), { ok: true, motivo: 'ok' })
  assert.equal(chamadas.length, 1)
  const { comando, args, opcoes } = chamadas[0]
  assert.equal(comando, 'ps-falso.exe')
  assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand'])
  assert.equal(args.length, 4)
  assert.ok(args.every((a) => !a.includes(mensagem) && !a.includes(b64)), 'nenhum argumento leva a mensagem')
  const script = decodificarScript(args)
  assert.ok(!script.includes(mensagem), 'a mensagem não vai no script')
  assert.ok(!script.includes(b64), 'a mensagem em base64 não vai no script')
  assert.equal(opcoes.input, `verificar\n${b64}\n`)
  assert.equal(opcoes.windowsHide, true)
  assert.equal(opcoes.timeout, 1234)
})

test('disponivel() só pergunta a disponibilidade, pelo PowerShell do sistema e com o limite padrão; cada ramo do script chama só o seu método', () => {
  const chamadas = []
  const ponte = criarPontePresenca({ executar: executorFalso({ stdout: 'disponibilidade Available\n' }, chamadas) })
  assert.deepEqual(ponte.disponivel(), { ok: true, motivo: 'ok' })
  assert.equal(chamadas.length, 1)
  const { comando, args, opcoes } = chamadas[0]
  assert.equal(comando, powershellPadrao())
  assert.equal(opcoes.input, 'disponivel\n')
  assert.equal(opcoes.timeout, 75_000)
  assert.equal(opcoes.windowsHide, true)
  const ramos = /if \(\$operacao -eq 'disponivel'\) \{([\s\S]*?)\} else \{([\s\S]*?)\n\}/.exec(decodificarScript(args))
  assert.ok(ramos, 'o script tem os dois ramos')
  const [, disponivel, verificar] = ramos
  assert.ok(disponivel.includes('CheckAvailabilityAsync()'), 'o ramo da disponibilidade pergunta a disponibilidade')
  assert.ok(!disponivel.includes('RequestVerificationAsync'), 'o ramo da disponibilidade não abre o diálogo')
  assert.ok(disponivel.includes("$prefixo = 'disponibilidade'; $limite = 10000"), 'a disponibilidade responde com o prefixo dela e espera 10 s')
  assert.ok(verificar.includes('[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($linhas[1]))'), 'a mensagem sai da segunda linha do stdin, em UTF-8')
  assert.ok(verificar.includes('RequestVerificationAsync($mensagem)'), 'o ramo da verificação abre o diálogo com a mensagem')
  assert.ok(verificar.includes("$prefixo = 'resultado'; $limite = 60000"), 'a verificação responde com o prefixo dela e espera 60 s')
})

test('cada desfecho do Hello vira { ok, motivo }, nos dois métodos', () => {
  const casos = [
    ['disponivel', 'disponibilidade Available', 'ok'],
    ...INDISPONIVEIS.map((nome) => ['disponivel', `disponibilidade ${nome}`, 'indisponivel']),
    ['disponivel', 'tempo', 'tempo'],
    ['verificar', 'resultado Verified', 'ok'],
    ['verificar', 'resultado Canceled', 'cancelado'],
    ['verificar', 'resultado RetriesExhausted', 'falhou'],
    ...INDISPONIVEIS.map((nome) => ['verificar', `resultado ${nome}`, 'indisponivel']),
    ['verificar', 'tempo', 'tempo']
  ]
  for (const [metodo, linha, motivo] of casos) {
    assert.deepEqual(perguntar(metodo, { stdout: `${linha}\r\n` }), desfecho(motivo), `${metodo} com "${linha}"`)
  }
})

test('resposta torta, filho que falhou e erro de spawn viram falhou ou tempo, nunca exceção', () => {
  const tortas = [
    ['verificar', { stdout: '' }],
    ['verificar', { stdout: 'resultado Verified\nresultado Verified\n' }],
    ['verificar', { stdout: 'disponibilidade Available\n' }],
    ['verificar', { stdout: 'disponibilidade DeviceBusy\n' }],
    ['verificar', { stdout: 'resultado Available\n' }],
    ['disponivel', { stdout: 'resultado Verified\n' }],
    ['disponivel', { stdout: 'resultado DeviceNotPresent\n' }],
    ['disponivel', { stdout: 'disponibilidade Verified\n' }],
    ['verificar', { stdout: 'resultado constructor\n' }],
    ['verificar', { stdout: 'resultado __proto__\n' }],
    ['verificar', { stdout: 'resultado Verified extra\n' }],
    ['verificar', { stdout: 'resultado verified\n' }],
    ['verificar', { status: 1, stdout: 'resultado Verified\n', stderr: 'detalhe do filho' }],
    ['verificar', { status: null, error: Object.assign(new Error('spawn falhou'), { code: 'ENOENT' }) }]
  ]
  for (const [metodo, resposta] of tortas) {
    assert.deepEqual(perguntar(metodo, resposta), desfecho('falhou'), `${metodo} com ${JSON.stringify(resposta)}`)
  }
  const estouro = { status: null, stdout: 'resultado Verified\n', error: Object.assign(new Error('spawnSync ETIMEDOUT'), { code: 'ETIMEDOUT' }) }
  assert.deepEqual(perguntar('verificar', estouro), desfecho('tempo'))
  assert.deepEqual(perguntar('disponivel', estouro), desfecho('tempo'))
})

test('mensagem do Hello vazia ou que não é texto não chega ao PowerShell', () => {
  const chamadas = []
  const ponte = criarPontePresenca({ executar: executorFalso({ stdout: 'resultado Verified\n' }, chamadas) })
  for (const mensagem of ['', '   ', undefined, null, 42, Buffer.from('texto')]) {
    assert.throws(() => ponte.verificar(mensagem), { name: 'TypeError', message: 'a mensagem do Hello precisa ser um texto não vazio' })
  }
  assert.equal(chamadas.length, 0)
})
```

```js arquivo=testes/casa-dpapi.test.mjs
// Ponte DPAPI do cofre (§8.1): a real no Windows (ida e volta, lixo, inventário, a cópia que falha antes de tocar a
// área de transferência e a limpeza que o PowerShell 5.1 aceita) e a de mentira para o protocolo (o segredo fora do
// argumento, contagem de linhas, mensagens de erro, o script da área de transferência e a limpeza destacada).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import test from 'node:test'

import { criarPonteDpapi, powershellPadrao } from '../runtime/casa/dpapi.mjs'

// OMNI_SO_FALSOS=1 pula os testes que abrem o PowerShell de verdade: a rodada de mutantes repete a suíte em
// sequência, e só os testes com o executor falso entram nela. Os reais rodam uma vez, no verde.
const NO_WINDOWS = { skip: process.platform !== 'win32' ? 'a DPAPI só existe no Windows' : process.env.OMNI_SO_FALSOS === '1' ? 'OMNI_SO_FALSOS=1: só os testes falsos' : false }
function executorFalso(resposta, chamadas) {
  return (comando, args, opcoes) => { chamadas.push({ comando, args, opcoes }); return { status: 0, stdout: '', stderr: '', ...resposta } }
}
const decodificarScript = (args) => Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le')
const erroDaPonte = (message) => ({ name: 'PonteDpapiError', code: 'OMNI_COFRE_PONTE', message })
const LIMPEZA = /Start-Process -FilePath \(Join-Path \$PSHOME 'powershell\.exe'\) -ArgumentList '-NoProfile', '-NonInteractive', '-EncodedCommand', '([A-Za-z0-9+/=]+)' -WindowStyle Hidden/
function scriptDaArea() {
  const chamadas = []
  criarPonteDpapi({ executar: executorFalso({ stdout: 'ok 1\n' }, chamadas) }).abrirParaAreaDeTransferencia(Buffer.from('blob'))
  return decodificarScript(chamadas[0].args)
}

test('DPAPI real: sela e abre de volta, com acento, ideograma e valor grande', NO_WINDOWS, () => {
  const ponte = criarPonteDpapi()
  const valores = ['abc', 'ção ü 日本 — teste', 'x'.repeat(5000)].map((v) => Buffer.from(v, 'utf8'))
  const blobs = ponte.selar(valores)
  assert.equal(blobs.length, 3)
  blobs.forEach((blob, i) => assert.ok(!blob.equals(valores[i]), `o blob ${i} não é o valor`))
  const abertos = ponte.abrir(blobs)
  assert.deepEqual(abertos.map((a) => a.ok), [true, true, true])
  abertos.forEach((a, i) => assert.ok(a.valor.equals(valores[i]), `o item ${i} volta igual`))
})

test('DPAPI real: lixo falha sozinho e não derruba o vizinho', NO_WINDOWS, () => {
  const ponte = criarPonteDpapi()
  const [blob] = ponte.selar([Buffer.from('vizinho bom')])
  const [lixo, bom] = ponte.abrir([Buffer.from([0, 0, 0]), blob])
  assert.deepEqual(lixo, { ok: false, erro: 'CryptographicException' })
  assert.equal(bom.ok, true)
  assert.equal(bom.valor.toString('utf8'), 'vizinho bom')
})

test('Gerenciador real: o inventário só traz alvos Omni/ e só metadados', NO_WINDOWS, () => {
  const itens = criarPonteDpapi().inventariarGerenciador()
  assert.ok(Array.isArray(itens))
  for (const item of itens) {
    assert.deepEqual(Object.keys(item).sort(), ['alvo', 'persistencia', 'tipo', 'usuario'])
    assert.ok(item.alvo.toLowerCase().startsWith('omni/'), 'todo alvo do inventário começa com Omni/')
  }
})

test('o segredo nunca vai no argumento nem no script: só no stdin', () => {
  const segredo = 'segredo-que-nao-pode-vazar'
  const b64 = Buffer.from(segredo, 'utf8').toString('base64')
  const chamadas = []
  const ponte = criarPonteDpapi({ executar: executorFalso({ stdout: 'ok QUJD\r\n' }, chamadas), powershell: 'ps-falso.exe' })
  const [blob] = ponte.selar([Buffer.from(segredo, 'utf8')])
  assert.equal(blob.toString('utf8'), 'ABC')
  assert.equal(chamadas.length, 1)
  const { comando, args, opcoes } = chamadas[0]
  assert.equal(comando, 'ps-falso.exe')
  assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand'])
  assert.equal(args.length, 4)
  assert.ok(args.every((a) => !a.includes(segredo) && !a.includes(b64)), 'nenhum argumento leva o valor')
  const script = decodificarScript(args)
  assert.ok(!script.includes(segredo), 'o valor não vai no script')
  assert.ok(!script.includes(b64), 'o valor em base64 não vai no script')
  assert.equal(opcoes.input, `selar\n${b64}\n`)
  assert.equal(opcoes.windowsHide, true)
})

test('listas vazias não chamam o PowerShell; o caminho padrão sai do SystemRoot', () => {
  const chamadas = []
  const ponte = criarPonteDpapi({ executar: executorFalso({}, chamadas) })
  assert.deepEqual(ponte.abrir([]), [])
  assert.deepEqual(ponte.selar([]), [])
  assert.equal(chamadas.length, 0)
  assert.equal(powershellPadrao({ SystemRoot: 'D:\\Win' }), join('D:\\Win', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
  assert.ok(powershellPadrao({}).startsWith('C:\\Windows'))
})

test('a ponte recusa resposta fora do protocolo, contagem errada e filho que falhou', () => {
  const um = [Buffer.from('a')]
  const com = (resposta) => criarPonteDpapi({ executar: executorFalso(resposta, []) })
  assert.throws(() => com({ stdout: 'talvez\n' }).abrir(um), erroDaPonte('a ponte DPAPI respondeu fora do protocolo'))
  assert.throws(() => com({ stdout: 'ok QQ==\nok QQ==\n' }).abrir(um), erroDaPonte('a ponte DPAPI devolveu 2 linha(s) para 1 item(ns)'))
  assert.throws(() => com({ status: 1, stderr: 'detalhe do filho' }).abrir(um), erroDaPonte('a ponte DPAPI saiu com 1'))
  assert.throws(() => com({ error: Object.assign(new Error('spawn falhou'), { code: 'ENOENT' }), status: null }).abrir(um), erroDaPonte('a ponte DPAPI não rodou: ENOENT'))
})

test('valor vazio não se sela, falha da DPAPI no selar vira erro e só bytes entram', () => {
  const chamadas = []
  const ponte = criarPonteDpapi({ executar: executorFalso({}, chamadas) })
  assert.throws(() => ponte.selar([Buffer.from('a'), Buffer.alloc(0)]), erroDaPonte('valor vazio não se sela'))
  assert.equal(chamadas.length, 0)
  const falha = criarPonteDpapi({ executar: executorFalso({ stdout: 'falha CryptographicException\n' }, []) })
  assert.throws(() => falha.selar([Buffer.from('a')]), erroDaPonte('a DPAPI não selou: CryptographicException'))
  assert.throws(() => ponte.abrir(['texto não é bytes']), erroDaPonte('a ponte DPAPI só aceita bytes'))
})

test('inventário: decodifica alvo e usuário, pula alvo vazio e recusa linha torta', () => {
  const b = (texto) => Buffer.from(texto, 'utf8').toString('base64')
  const chamadas = []
  const stdout = `cred ${b('Omni/um')} ${b('usuario-um')} 1 2\r\ncred ${b('Omni/dois')} - 1 3\r\ncred - - 1 2\r\n`
  const itens = criarPonteDpapi({ executar: executorFalso({ stdout }, chamadas) }).inventariarGerenciador()
  assert.deepEqual(itens, [
    { alvo: 'Omni/um', usuario: 'usuario-um', tipo: 1, persistencia: 2 },
    { alvo: 'Omni/dois', usuario: null, tipo: 1, persistencia: 3 }
  ])
  assert.equal(chamadas[0].opcoes.input, '')
  assert.ok(decodificarScript(chamadas[0].args).includes('CredEnumerateW("Omni/*", 0'))
  const torta = criarPonteDpapi({ executar: executorFalso({ stdout: 'cred um dois\n' }, []) })
  assert.throws(() => torta.inventariarGerenciador(), { name: 'PonteDpapiError', message: 'o inventário respondeu fora do protocolo' })
})

test('área de transferência real: o blob que a DPAPI não abre falha antes de tocar a área', NO_WINDOWS, () => {
  assert.deepEqual(criarPonteDpapi().abrirParaAreaDeTransferencia(Buffer.from([0, 0, 0])), { ok: false, erro: 'CryptographicException' })
})

test('a limpeza destacada é PowerShell que o 5.1 aceita', NO_WINDOWS, () => {
  const limpeza = LIMPEZA.exec(scriptDaArea())
  assert.ok(limpeza, 'o script solta a limpeza pelo Start-Process com -EncodedCommand')
  const conferir = String.raw`$codigo = [Console]::In.ReadToEnd().Trim()
$texto = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($codigo))
$fichas = $null; $erros = $null
$null = [System.Management.Automation.Language.Parser]::ParseInput($texto, [ref]$fichas, [ref]$erros)
[Console]::Out.Write('erros ' + $erros.Count + [char]10)
`
  const resultado = spawnSync(powershellPadrao(), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(conferir, 'utf16le').toString('base64')], {
    input: `${limpeza[1]}\n`, encoding: 'utf8', windowsHide: true, timeout: 30_000
  })
  assert.equal(resultado.status, 0)
  assert.equal(resultado.stdout.trim(), 'erros 0')
})

test('área de transferência: o blob vai só no stdin e o prazo da limpeza volta em ISO', () => {
  const blob = Buffer.from('blob-de-exemplo-que-nao-pode-vazar', 'utf8')
  const b64 = blob.toString('base64')
  const chamadas = []
  const ponte = criarPonteDpapi({ executar: executorFalso({ stdout: `ok ${Date.UTC(2026, 0, 2, 3, 4, 5)}\r\n` }, chamadas), powershell: 'ps-falso.exe' })
  assert.deepEqual(ponte.abrirParaAreaDeTransferencia(blob), { ok: true, limpaEm: '2026-01-02T03:04:05.000Z' })
  assert.equal(chamadas.length, 1)
  const { comando, args, opcoes } = chamadas[0]
  assert.equal(comando, 'ps-falso.exe')
  assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand'])
  assert.equal(args.length, 4)
  assert.ok(args.every((a) => !a.includes(b64) && !a.includes('blob-de-exemplo')), 'nenhum argumento leva o blob')
  const script = decodificarScript(args)
  assert.ok(!script.includes(b64) && !script.includes('blob-de-exemplo'), 'o blob não vai no script')
  assert.equal(opcoes.input, `${b64}\n`)
  assert.equal(opcoes.windowsHide, true)
})

test('o script da área: abre, copia com os três formatos de exclusão, lê o número, marca 30 s e solta a limpeza que só limpa o que é dela', () => {
  const script = scriptDaArea()
  for (const formato of ['ExcludeClipboardContentFromMonitorProcessing', 'CanIncludeInClipboardHistory', 'CanUploadToCloudClipboard']) {
    assert.ok(script.includes(`'${formato}'`), `o formato ${formato} vai junto`)
  }
  assert.ok(script.includes('$dados.SetData($formato, [System.IO.MemoryStream]::new([byte[]](0, 0, 0, 0)))'), 'cada formato leva o DWORD 0')
  const ordem = ['::Unprotect(', '$dados.SetText(', '::SetDataObject($dados, $true', '$numero = [OmniCofre.Area]::GetClipboardSequenceNumber()', 'AddSeconds(30)', '$env:OMNI_COFRE_AREA_NUMERO = [string]$numero', '$env:OMNI_COFRE_AREA_PRAZO = [string]$prazo', 'Start-Process', "[Console]::Out.Write('ok '"]
  const posicoes = ordem.map((trecho) => script.indexOf(trecho))
  ordem.forEach((trecho, i) => assert.ok(posicoes[i] >= 0, `o script tem ${trecho}`))
  assert.deepEqual([...posicoes].sort((a, b) => a - b), posicoes, 'abre, copia, lê o número, marca o prazo, solta a limpeza e só então responde')
  assert.ok(script.includes("$e = $_.Exception; if ($e.InnerException) { $e = $e.InnerException }\n  [Console]::Out.Write('falha ' + $e.GetType().Name + [char]10)"), 'a falha desembrulha o InnerException e devolve o tipo de dentro')
  const limpeza = LIMPEZA.exec(script)
  assert.ok(limpeza, 'o script solta a limpeza pelo Start-Process com -EncodedCommand')
  const texto = Buffer.from(limpeza[1], 'base64').toString('utf16le')
  for (const trecho of ['$numero = [uint32]$env:OMNI_COFRE_AREA_NUMERO', '[int64]$env:OMNI_COFRE_AREA_PRAZO', 'if ($espera -gt 0) { Start-Sleep -Milliseconds $espera }', 'OpenClipboard([IntPtr]::Zero)', 'GetClipboardSequenceNumber() -eq $numero) { $null = [OmniCofre.Area]::EmptyClipboard() }', 'finally { $null = [OmniCofre.Area]::CloseClipboard() }']) {
    assert.ok(texto.includes(trecho), `a limpeza tem ${trecho}`)
  }
})

test('área de transferência: falha da DPAPI, resposta torta, contagem errada, filho que falhou e entrada que não serve', () => {
  const blob = Buffer.from('blob')
  const com = (resposta, chamadas = []) => criarPonteDpapi({ executar: executorFalso(resposta, chamadas) })
  assert.deepEqual(com({ stdout: 'falha CryptographicException\n' }).abrirParaAreaDeTransferencia(blob), { ok: false, erro: 'CryptographicException' })
  assert.throws(() => com({ stdout: 'ok\n' }).abrirParaAreaDeTransferencia(blob), erroDaPonte('a ponte DPAPI respondeu fora do protocolo'))
  assert.throws(() => com({ stdout: 'ok 1000000000000000\n' }).abrirParaAreaDeTransferencia(blob), erroDaPonte('a ponte DPAPI respondeu fora do protocolo'))
  assert.throws(() => com({ stdout: 'ok 1\nok 1\n' }).abrirParaAreaDeTransferencia(blob), erroDaPonte('a ponte DPAPI devolveu 2 linha(s) para 1 item(ns)'))
  assert.throws(() => com({ stdout: '' }).abrirParaAreaDeTransferencia(blob), erroDaPonte('a ponte DPAPI devolveu 0 linha(s) para 1 item(ns)'))
  assert.throws(() => com({ status: 1, stderr: 'detalhe do filho' }).abrirParaAreaDeTransferencia(blob), erroDaPonte('a ponte DPAPI saiu com 1'))
  assert.throws(() => com({ error: Object.assign(new Error('spawn falhou'), { code: 'ENOENT' }), status: null }).abrirParaAreaDeTransferencia(blob), erroDaPonte('a ponte DPAPI não rodou: ENOENT'))
  const chamadas = []
  assert.throws(() => com({}, chamadas).abrirParaAreaDeTransferencia(Buffer.alloc(0)), erroDaPonte('blob vazio não se copia'))
  assert.throws(() => com({}, chamadas).abrirParaAreaDeTransferencia('texto não é bytes'), erroDaPonte('a ponte DPAPI só aceita bytes'))
  assert.equal(chamadas.length, 0)
})
```

- [x] **Passo 2: extrair os testes e ver o vermelho.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so testes/casa-presenca.test.mjs testes/casa-dpapi.test.mjs
node --test --test-concurrency=1 --test-reporter=spec testes/casa-presenca.test.mjs testes/casa-dpapi.test.mjs *> "$rascunho\p5-t2-vermelho.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\p5-t2-vermelho.txt" -Pattern 'Cannot find module', 'is not a function', '(tests|pass|fail) \d+\s*$'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado:
- `gravado testes/casa-presenca.test.mjs`, `gravado testes/casa-dpapi.test.mjs` e `saida: 1`;
- o `Cannot find module` de `runtime/casa/presenca.mjs`, que derruba a PR inteira como um teste só;
- nos 5 testes novos da DP, `abrirParaAreaDeTransferencia is not a function`, porque a ponte do plano 4 não tem o método;
- `tests 14` (PR 1 e DP 13), `pass 8` (os 8 do plano 4), `fail 6` e `False`.

Resultado (07/11): `gravado testes/casa-presenca.test.mjs`, `gravado testes/casa-dpapi.test.mjs`, `saida: 1`, o `ERR_MODULE_NOT_FOUND` de `runtime/casa/presenca.mjs`, os 5 `abrirParaAreaDeTransferencia is not a function`, `tests 14`, `pass 8`, `fail 6` e `False`.

- [x] **Passo 3: os módulos.** A presença nova e a ponte DPAPI inteira, com o plano 4 dentro; o que muda está nas decisões 4, 19 e 20.

```js arquivo=runtime/casa/presenca.mjs
// Ponte de presença do cofre (decisões 2, 3 e 19): o Windows Hello pelo UserConsentVerifier, num PowerShell 5.1
// filho, pelo mesmo caminho da ponte DPAPI (script em -EncodedCommand, sem argumento depois dele, spawnSync com
// windowsHide). disponivel() só chama o CheckAvailabilityAsync, que não abre diálogo; verificar(mensagem) chama o
// RequestVerificationAsync, que abre o diálogo do Hello. A mensagem vai pelo stdin, em base64 de UTF-8 (o stdin do
// 5.1 lê na página OEM), nunca no argumento nem no script. Todo desfecho vira { ok, motivo }, com motivo ok,
// cancelado, indisponivel, tempo ou falhou; a ponte não lança por causa do filho, e o stderr dele não sai daqui.
import { spawnSync } from 'node:child_process'

import { codificar, powershellPadrao } from './dpapi.mjs'

// O AsTask genérico de IAsyncOperation`1 é escolhido pelo nome do parâmetro; a crase do nome entra como [char]96.
const SCRIPT_PRESENCA = String.raw`$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$linhas = [Console]::In.ReadToEnd() -split "\r?\n"
$operacao = $linhas[0]
if ($operacao -ne 'disponivel' -and $operacao -ne 'verificar') { [Console]::Error.WriteLine('operacao desconhecida'); exit 2 }
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime]
$nome = 'IAsyncOperation' + [char]96 + '1'
$comoTarefa = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq $nome } | Select-Object -First 1
if ($operacao -eq 'disponivel') {
  $tarefa = $comoTarefa.MakeGenericMethod([Windows.Security.Credentials.UI.UserConsentVerifierAvailability]).Invoke($null, @([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()))
  $prefixo = 'disponibilidade'; $limite = 10000
} else {
  $mensagem = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($linhas[1]))
  $tarefa = $comoTarefa.MakeGenericMethod([Windows.Security.Credentials.UI.UserConsentVerificationResult]).Invoke($null, @([Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync($mensagem)))
  $prefixo = 'resultado'; $limite = 60000
}
if (-not $tarefa.Wait($limite)) { [Console]::Out.Write('tempo' + [char]10); exit 0 }
[Console]::Out.Write($prefixo + ' ' + $tarefa.Result + [char]10)
`

const INDISPONIVEL = ['DeviceNotPresent', 'NotConfiguredForUser', 'DisabledByPolicy', 'DeviceBusy'].map((nome) => [nome, 'indisponivel'])
const DISPONIBILIDADE = new Map([['Available', 'ok'], ...INDISPONIVEL])
const RESULTADO = new Map([['Verified', 'ok'], ['Canceled', 'cancelado'], ['RetriesExhausted', 'falhou'], ...INDISPONIVEL])
const desfecho = (motivo) => ({ ok: motivo === 'ok', motivo })

export function criarPontePresenca({ executar = spawnSync, powershell = powershellPadrao(), limiteMs = 75_000 } = {}) {
  function perguntar(entrada, prefixo, mapa) {
    const resultado = executar(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', codificar(SCRIPT_PRESENCA)], {
      input: entrada, encoding: 'utf8', windowsHide: true, timeout: limiteMs
    })
    if (resultado.error) return desfecho(resultado.error.code === 'ETIMEDOUT' ? 'tempo' : 'falhou')
    if (resultado.status !== 0) return desfecho('falhou')
    const linhas = (resultado.stdout ?? '').split(/\r?\n/).filter((linha) => linha !== '')
    if (linhas.length !== 1) return desfecho('falhou')
    if (linhas[0] === 'tempo') return desfecho('tempo')
    const achado = /^(\w+) (\w+)$/.exec(linhas[0])
    if (!achado || achado[1] !== prefixo) return desfecho('falhou')
    return desfecho(mapa.get(achado[2]) ?? 'falhou')
  }
  return {
    disponivel() { return perguntar('disponivel\n', 'disponibilidade', DISPONIBILIDADE) },
    verificar(mensagem) {
      if (typeof mensagem !== 'string' || mensagem.trim() === '') throw new TypeError('a mensagem do Hello precisa ser um texto não vazio')
      return perguntar(`verificar\n${Buffer.from(mensagem, 'utf8').toString('base64')}\n`, 'resultado', RESULTADO)
    }
  }
}
```

```js arquivo=runtime/casa/dpapi.mjs
// Ponte DPAPI do cofre (§8.1): sela e abre valores com a DPAPI do usuário do Windows
// (ProtectedData, escopo CurrentUser) num PowerShell 5.1 filho, lista os alvos Omni/* do
// Gerenciador de Credenciais do Windows sem ler o segredo deles e abre um blob direto para a área de
// transferência (decisão 4): o texto vai com os três formatos que o tiram do histórico e da nuvem, e um
// PowerShell destacado limpa a área 30 s depois, só se o número de sequência dela não mudou.
// O segredo nunca vai no argumento do processo: o script vai em -EncodedCommand e os valores
// entram pelo stdin, um por linha, em base64. A resposta vem uma linha por item, "ok <base64>" ou
// "falha <TipoDoErro>", e a ponte confere a contagem. O stderr do filho nunca entra em mensagem.
// Na cópia, o segredo aberto não volta ao Node: a resposta é "ok <prazo em ms>" ou "falha <TipoDoErro>". Os bytes
// são zerados no filho; a string do .NET que vai para a área não tem como ser zerada.
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

export class PonteDpapiError extends Error {
  constructor(mensagem) {
    super(mensagem)
    this.name = 'PonteDpapiError'
    this.code = 'OMNI_COFRE_PONTE'
  }
}

export const codificar = (script) => Buffer.from(script, 'utf16le').toString('base64')

const SCRIPT_CIFRA = String.raw`$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Security
$linhas = [Console]::In.ReadToEnd() -split "\r?\n"
$operacao = $linhas[0]
if ($operacao -ne 'selar' -and $operacao -ne 'abrir') { [Console]::Error.WriteLine('operacao desconhecida'); exit 2 }
$escopo = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
$saida = New-Object System.Text.StringBuilder
for ($i = 1; $i -lt $linhas.Length; $i++) {
  $linha = $linhas[$i]
  if ($linha -eq '') { continue }
  $entrada = $null; $resultado = $null
  try {
    $entrada = [Convert]::FromBase64String($linha)
    if ($operacao -eq 'selar') { $resultado = [System.Security.Cryptography.ProtectedData]::Protect($entrada, $null, $escopo) }
    else { $resultado = [System.Security.Cryptography.ProtectedData]::Unprotect($entrada, $null, $escopo) }
    [void]$saida.Append('ok ').Append([Convert]::ToBase64String($resultado)).Append([char]10)
  } catch {
    $e = $_.Exception; if ($e.InnerException) { $e = $e.InnerException }
    [void]$saida.Append('falha ').Append($e.GetType().Name).Append([char]10)
  } finally {
    if ($null -ne $entrada) { [Array]::Clear($entrada, 0, $entrada.Length) }
    if ($null -ne $resultado) { [Array]::Clear($resultado, 0, $resultado.Length) }
  }
}
[Console]::Out.Write($saida.ToString())
`

const SCRIPT_INVENTARIO = String.raw`$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Text;
public static class OmniInventarioCofre {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct CREDENTIAL { public int Flags; public int Type; public IntPtr TargetName; public IntPtr Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName; }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CredEnumerateW(string filter, int flags, out int count, out IntPtr credentials);
  [DllImport("advapi32.dll")] private static extern void CredFree(IntPtr buffer);
  private static string B64(IntPtr ptr) { string texto = ptr == IntPtr.Zero ? null : Marshal.PtrToStringUni(ptr); return string.IsNullOrEmpty(texto) ? "-" : Convert.ToBase64String(Encoding.UTF8.GetBytes(texto)); }
  public static string Listar() {
    int quantos; IntPtr lista;
    if (!CredEnumerateW("Omni/*", 0, out quantos, out lista)) { int erro = Marshal.GetLastWin32Error(); if (erro == 1168) return ""; throw new System.ComponentModel.Win32Exception(erro); }
    try {
      StringBuilder saida = new StringBuilder();
      for (int i = 0; i < quantos; i++) {
        IntPtr item = Marshal.ReadIntPtr(lista, i * IntPtr.Size);
        CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(item, typeof(CREDENTIAL));
        saida.Append("cred ").Append(B64(c.TargetName)).Append(' ').Append(B64(c.UserName)).Append(' ').Append(c.Type).Append(' ').Append(c.Persist).Append('\n');
      }
      return saida.ToString();
    } finally { CredFree(lista); }
  }
}
'@
[Console]::Out.Write([OmniInventarioCofre]::Listar())
`

// O que a cópia e a limpeza chamam da user32: o número de sequência da área e o abrir, esvaziar e fechar dela.
const MEMBROS_AREA = String.raw`[DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
[DllImport("user32.dll", SetLastError = true)] public static extern bool OpenClipboard(IntPtr janela);
[DllImport("user32.dll", SetLastError = true)] public static extern bool EmptyClipboard();
[DllImport("user32.dll", SetLastError = true)] public static extern bool CloseClipboard();`

// A limpeza roda num PowerShell destacado, que herda do pai o número e o prazo pelo ambiente: espera o prazo e
// só esvazia a área se o número de sequência ainda é o da cópia; se outro programa copiou depois, não mexe.
const SCRIPT_LIMPEZA = String.raw`$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -Namespace OmniCofre -Name Area -MemberDefinition '${MEMBROS_AREA}'
$numero = [uint32]$env:OMNI_COFRE_AREA_NUMERO
$espera = [int64]$env:OMNI_COFRE_AREA_PRAZO - [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
if ($espera -gt 0) { Start-Sleep -Milliseconds $espera }
for ($tentativa = 0; $tentativa -lt 50; $tentativa++) {
  if ([OmniCofre.Area]::OpenClipboard([IntPtr]::Zero)) {
    try { if ([OmniCofre.Area]::GetClipboardSequenceNumber() -eq $numero) { $null = [OmniCofre.Area]::EmptyClipboard() } }
    finally { $null = [OmniCofre.Area]::CloseClipboard() }
    break
  }
  Start-Sleep -Milliseconds 100
}
`

// A cópia: o blob entra pela primeira linha do stdin e é aberto aqui; a resposta nunca leva o valor.
const SCRIPT_AREA = String.raw`$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Security
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Namespace OmniCofre -Name Area -MemberDefinition '${MEMBROS_AREA}'
$entrada = $null; $aberto = $null
try {
  $entrada = [Convert]::FromBase64String([Console]::In.ReadLine())
  $aberto = [System.Security.Cryptography.ProtectedData]::Unprotect($entrada, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  $dados = New-Object System.Windows.Forms.DataObject
  $dados.SetText([System.Text.Encoding]::UTF8.GetString($aberto))
  foreach ($formato in 'ExcludeClipboardContentFromMonitorProcessing', 'CanIncludeInClipboardHistory', 'CanUploadToCloudClipboard') {
    $dados.SetData($formato, [System.IO.MemoryStream]::new([byte[]](0, 0, 0, 0)))
  }
  [System.Windows.Forms.Clipboard]::SetDataObject($dados, $true, 10, 100)
  $numero = [OmniCofre.Area]::GetClipboardSequenceNumber()
  $prazo = [DateTimeOffset]::UtcNow.AddSeconds(30).ToUnixTimeMilliseconds()
  $env:OMNI_COFRE_AREA_NUMERO = [string]$numero
  $env:OMNI_COFRE_AREA_PRAZO = [string]$prazo
  $null = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList '-NoProfile', '-NonInteractive', '-EncodedCommand', '${codificar(SCRIPT_LIMPEZA)}' -WindowStyle Hidden
  [Console]::Out.Write('ok ' + $prazo + [char]10)
} catch {
  $e = $_.Exception; if ($e.InnerException) { $e = $e.InnerException }
  [Console]::Out.Write('falha ' + $e.GetType().Name + [char]10)
} finally {
  if ($null -ne $entrada) { [Array]::Clear($entrada, 0, $entrada.Length) }
  if ($null -ne $aberto) { [Array]::Clear($aberto, 0, $aberto.Length) }
}
`

export function powershellPadrao(env = process.env) {
  return join(env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

const linhasDe = (saida) => saida.split('\n').map((linha) => linha.replace(/\r$/, '')).filter((linha) => linha !== '')

function comoBuffer(item) {
  if (Buffer.isBuffer(item)) return item
  if (item instanceof Uint8Array) return Buffer.from(item.buffer, item.byteOffset, item.byteLength)
  throw new PonteDpapiError('a ponte DPAPI só aceita bytes')
}

export function criarPonteDpapi({ executar = spawnSync, powershell = powershellPadrao(), limiteMs = 30_000 } = {}) {
  function rodar(script, entrada) {
    const resultado = executar(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', codificar(script)], {
      input: entrada, encoding: 'utf8', windowsHide: true, timeout: limiteMs, maxBuffer: 16 * 1024 * 1024
    })
    if (resultado.error) throw new PonteDpapiError(`a ponte DPAPI não rodou: ${resultado.error.code ?? resultado.error.name}`)
    if (resultado.status !== 0) throw new PonteDpapiError(`a ponte DPAPI saiu com ${resultado.status}`)
    return linhasDe(resultado.stdout ?? '')
  }
  function cifrar(operacao, itens) {
    const bytes = itens.map(comoBuffer)
    if (bytes.length === 0) return []
    const entrada = `${operacao}\n${bytes.map((b) => (b.length === 0 ? '-' : b.toString('base64'))).join('\n')}\n`
    const linhas = rodar(SCRIPT_CIFRA, entrada)
    if (linhas.length !== bytes.length) throw new PonteDpapiError(`a ponte DPAPI devolveu ${linhas.length} linha(s) para ${bytes.length} item(ns)`)
    return linhas.map((linha) => {
      const ok = /^ok ([A-Za-z0-9+/=]*)$/.exec(linha)
      if (ok) return { ok: true, valor: Buffer.from(ok[1], 'base64') }
      const falha = /^falha (\w+)$/.exec(linha)
      if (falha) return { ok: false, erro: falha[1] }
      throw new PonteDpapiError('a ponte DPAPI respondeu fora do protocolo')
    })
  }
  return {
    selar(valores) {
      const bytes = valores.map(comoBuffer)
      if (bytes.some((b) => b.length === 0)) throw new PonteDpapiError('valor vazio não se sela')
      const resultados = cifrar('selar', bytes)
      const falha = resultados.find((r) => !r.ok)
      if (falha) throw new PonteDpapiError(`a DPAPI não selou: ${falha.erro}`)
      return resultados.map((r) => r.valor)
    },
    abrir(blobs) { return cifrar('abrir', blobs) },
    abrirParaAreaDeTransferencia(blob) {
      const bytes = comoBuffer(blob)
      if (bytes.length === 0) throw new PonteDpapiError('blob vazio não se copia')
      const linhas = rodar(SCRIPT_AREA, `${bytes.toString('base64')}\n`)
      if (linhas.length !== 1) throw new PonteDpapiError(`a ponte DPAPI devolveu ${linhas.length} linha(s) para 1 item(ns)`)
      const ok = /^ok (\d{1,15})$/.exec(linhas[0])
      if (ok) return { ok: true, limpaEm: new Date(Number(ok[1])).toISOString() }
      const falha = /^falha (\w+)$/.exec(linhas[0])
      if (falha) return { ok: false, erro: falha[1] }
      throw new PonteDpapiError('a ponte DPAPI respondeu fora do protocolo')
    },
    inventariarGerenciador() {
      const texto = (campo) => (campo === '-' ? null : Buffer.from(campo, 'base64').toString('utf8'))
      return rodar(SCRIPT_INVENTARIO, '').flatMap((linha) => {
        const partes = /^cred ([A-Za-z0-9+/=]+|-) ([A-Za-z0-9+/=]+|-) (\d+) (\d+)$/.exec(linha)
        if (!partes) throw new PonteDpapiError('o inventário respondeu fora do protocolo')
        const alvo = texto(partes[1])
        return alvo === null ? [] : [{ alvo, usuario: texto(partes[2]), tipo: Number(partes[3]), persistencia: Number(partes[4]) }]
      })
    }
  }
}
```

- [x] **Passo 4: extrair os módulos e ver o verde, com a CL junto.** A CL chega à ponte pelo `runtime/cofre.mjs`, que importa o `criarPonteDpapi`. Esta é a rodada única dos três testes reais da T2.

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so runtime/casa/presenca.mjs runtime/casa/dpapi.mjs
node --test --test-concurrency=1 --test-reporter=spec testes/casa-presenca.test.mjs testes/casa-dpapi.test.mjs testes/cofre-cli.test.mjs *> "$rascunho\p5-t2-verde.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\p5-t2-verde.txt" -Pattern '(tests|pass|fail|skipped) \d+\s*$'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `gravado runtime/casa/presenca.mjs`, `gravado runtime/casa/dpapi.mjs`, `tests 28` (PR 6, DP 13 e CL 9), `pass 28`, `fail 0`, `skipped 0` (os reais rodaram), `saida: 0` e `False`.

Resultado (07/11): `gravado runtime/casa/presenca.mjs`, `gravado runtime/casa/dpapi.mjs`, `tests 28`, `pass 28`, `fail 0`, `skipped 0`, `saida: 0` e `False`, com o stderr vazio.

**Mutação.** São trinta mutantes, com os critérios da T1:
- de 01 a 16 na presença, que morrem na PR;
- de 17 a 30 na ponte, que morrem na DP 11, na DP 12 e na DP 13.

A rodada usa `OMNI_SO_FALSOS=1` (executor, item 23), e nenhum mutante depende de um teste real para morrer.

O 28 troca o `InnerException` pelo erro de fora. No ensaio, só a DP 9 (real) o derrubava, porque a DPAPI chega ao script embrulhada em `MethodInvocationException`. Por isso, a DP 12 confere o desembrulho no texto do script, e a DP 9 segue provando o comportamento uma vez, no verde.

```json rascunho=mutantes-p5-t2.json
[
  { "nome": "01 a mensagem vai no argumento", "arquivo": "runtime/casa/presenca.mjs", "de": "'-EncodedCommand', codificar(SCRIPT_PRESENCA)]", "para": "'-EncodedCommand', codificar(SCRIPT_PRESENCA), entrada]", "teste": ["testes/casa-presenca.test.mjs"] },
  { "nome": "02 sem windowsHide", "arquivo": "runtime/casa/presenca.mjs", "de": "windowsHide: true", "para": "windowsHide: false", "teste": ["testes/casa-presenca.test.mjs"] },
  { "nome": "03 timeout ignora o limite", "arquivo": "runtime/casa/presenca.mjs", "de": "timeout: limiteMs", "para": "timeout: 75_000", "teste": ["testes/casa-presenca.test.mjs"] },
  { "nome": "04 cancelado vira ok", "arquivo": "runtime/casa/presenca.mjs", "de": "['Canceled', 'cancelado']", "para": "['Canceled', 'ok']", "teste": ["testes/casa-presenca.test.mjs"] },
  { "nome": "05 sem conferir o prefixo", "arquivo": "runtime/casa/presenca.mjs", "de": "if (!achado || achado[1] !== prefixo) return desfecho('falhou')", "para": "if (!achado) return desfecho('falhou')", "teste": ["testes/casa-presenca.test.mjs"] },
  { "nome": "06 Available vale como verificado", "arquivo": "runtime/casa/presenca.mjs", "de": "const RESULTADO = new Map([['Verified', 'ok'],", "para": "const RESULTADO = new Map([['Available', 'ok'], ['Verified', 'ok'],", "teste": ["testes/casa-presenca.test.mjs"] },
  { "nome": "07 linha extra passa", "arquivo": "runtime/casa/presenca.mjs", "de": "if (linhas.length !== 1) return desfecho('falhou')", "para": "if (linhas.length === 0) return desfecho('falhou')", "teste": ["testes/casa-presenca.test.mjs"] },
  { "nome": "08 regex sem âncora no fim", "arquivo": "runtime/casa/presenca.mjs", "de": "/^(\\w+) (\\w+)$/", "para": "/^(\\w+) (\\w+)/", "teste": ["testes/casa-presenca.test.mjs"] },
  { "nome": "09 motivo desconhecido passa adiante", "arquivo": "runtime/casa/presenca.mjs", "de": "mapa.get(achado[2]) ?? 'falhou'", "para": "mapa.get(achado[2]) ?? achado[2]", "teste": ["testes/casa-presenca.test.mjs"] },
  { "nome": "10 erro de spawn vira tempo", "arquivo": "runtime/casa/presenca.mjs", "de": "desfecho(resultado.error.code === 'ETIMEDOUT' ? 'tempo' : 'falhou')", "para": "desfecho('tempo')", "teste": ["testes/casa-presenca.test.mjs"] },
  { "nome": "11 filho que falhou passa", "arquivo": "runtime/casa/presenca.mjs", "de": "if (resultado.status !== 0) return desfecho('falhou')", "para": "if (resultado.status === null) return desfecho('falhou')", "teste": ["testes/casa-presenca.test.mjs"] },
  { "nome": "12 mensagem só de espaços aceita", "arquivo": "runtime/casa/presenca.mjs", "de": "mensagem.trim() === ''", "para": "mensagem === ''", "teste": ["testes/casa-presenca.test.mjs"] },
  { "nome": "13 tempo do script vira ok", "arquivo": "runtime/casa/presenca.mjs", "de": "if (linhas[0] === 'tempo') return desfecho('tempo')", "para": "if (linhas[0] === 'tempo') return desfecho('ok')", "teste": ["testes/casa-presenca.test.mjs"] },
  { "nome": "14 o ramo da disponibilidade responde como resultado", "arquivo": "runtime/casa/presenca.mjs", "de": "$prefixo = 'disponibilidade'; $limite = 10000", "para": "$prefixo = 'resultado'; $limite = 10000", "teste": ["testes/casa-presenca.test.mjs"] },
  { "nome": "15 a mensagem lida na página OEM", "arquivo": "runtime/casa/presenca.mjs", "de": "[Text.Encoding]::UTF8.GetString(", "para": "[Text.Encoding]::Default.GetString(", "teste": ["testes/casa-presenca.test.mjs"] },
  { "nome": "16 PowerShell pelo PATH", "arquivo": "runtime/casa/presenca.mjs", "de": "powershell = powershellPadrao(), limiteMs = 75_000", "para": "powershell = 'powershell.exe', limiteMs = 75_000", "teste": ["testes/casa-presenca.test.mjs"] },
  { "nome": "17 o blob entra no script", "arquivo": "runtime/casa/dpapi.mjs", "de": "rodar(SCRIPT_AREA, ", "para": "rodar(SCRIPT_AREA + `# ${bytes.toString('base64')}\\n`, ", "teste": ["testes/casa-dpapi.test.mjs"] },
  { "nome": "18 sem o formato do histórico", "arquivo": "runtime/casa/dpapi.mjs", "de": "'ExcludeClipboardContentFromMonitorProcessing', 'CanIncludeInClipboardHistory', 'CanUploadToCloudClipboard'", "para": "'ExcludeClipboardContentFromMonitorProcessing', 'CanUploadToCloudClipboard'", "teste": ["testes/casa-dpapi.test.mjs"] },
  { "nome": "19 o DWORD vira 1", "arquivo": "runtime/casa/dpapi.mjs", "de": "[byte[]](0, 0, 0, 0)", "para": "[byte[]](1, 0, 0, 0)", "teste": ["testes/casa-dpapi.test.mjs"] },
  { "nome": "20 limpa sem conferir o número", "arquivo": "runtime/casa/dpapi.mjs", "de": "if ([OmniCofre.Area]::GetClipboardSequenceNumber() -eq $numero) { $null = [OmniCofre.Area]::EmptyClipboard() }", "para": "$null = [OmniCofre.Area]::EmptyClipboard()", "teste": ["testes/casa-dpapi.test.mjs"] },
  { "nome": "21 limpa sem esperar o prazo", "arquivo": "runtime/casa/dpapi.mjs", "de": "if ($espera -gt 0) { Start-Sleep -Milliseconds $espera }", "para": "$null = $espera", "teste": ["testes/casa-dpapi.test.mjs"] },
  { "nome": "22 prazo de 300 s", "arquivo": "runtime/casa/dpapi.mjs", "de": "AddSeconds(30)", "para": "AddSeconds(300)", "teste": ["testes/casa-dpapi.test.mjs"] },
  { "nome": "23 a área fica aberta", "arquivo": "runtime/casa/dpapi.mjs", "de": "finally { $null = [OmniCofre.Area]::CloseClipboard() }", "para": "finally { }", "teste": ["testes/casa-dpapi.test.mjs"] },
  { "nome": "24 limpaEm ignora o prazo", "arquivo": "runtime/casa/dpapi.mjs", "de": "limpaEm: new Date(Number(ok[1])).toISOString()", "para": "limpaEm: new Date().toISOString()", "teste": ["testes/casa-dpapi.test.mjs"] },
  { "nome": "25 prazo sem limite de dígitos", "arquivo": "runtime/casa/dpapi.mjs", "de": "/^ok (\\d{1,15})$/", "para": "/^ok (\\d+)$/", "teste": ["testes/casa-dpapi.test.mjs"] },
  { "nome": "26 linha extra passa", "arquivo": "runtime/casa/dpapi.mjs", "de": "if (linhas.length !== 1) throw", "para": "if (linhas.length === 0) throw", "teste": ["testes/casa-dpapi.test.mjs"] },
  { "nome": "27 blob vazio vai ao PowerShell", "arquivo": "runtime/casa/dpapi.mjs", "de": "if (bytes.length === 0) throw", "para": "if (bytes.length < 0) throw", "teste": ["testes/casa-dpapi.test.mjs"] },
  { "nome": "28 a falha perde o tipo", "arquivo": "runtime/casa/dpapi.mjs", "de": "[Console]::Out.Write('falha ' + $e.GetType().Name + [char]10)", "para": "[Console]::Out.Write('falha ' + $_.Exception.GetType().Name + [char]10)", "teste": ["testes/casa-dpapi.test.mjs"] },
  { "nome": "29 a limpeza não se solta", "arquivo": "runtime/casa/dpapi.mjs", "de": "'${codificar(SCRIPT_LIMPEZA)}' -WindowStyle Hidden", "para": "'${codificar(SCRIPT_LIMPEZA)}' -NoNewWindow -Wait", "teste": ["testes/casa-dpapi.test.mjs"] },
  { "nome": "30 o prazo não vai ao neto", "arquivo": "runtime/casa/dpapi.mjs", "de": "$env:OMNI_COFRE_AREA_PRAZO = [string]$prazo", "para": "$null = $prazo", "teste": ["testes/casa-dpapi.test.mjs"] }
]
```

Mapa previsto de mutante para teste:

| Mutante | Morre em | Como cai |
|---|---|---|
| 01 | PR 2 | `equal`: a mensagem aparece nos argumentos |
| 02 | PR 2 e PR 3 | `equal` do `windowsHide` |
| 03 | PR 2 | `equal` do limite |
| 04 | PR 4 | deepEqual (`resultado Canceled`) |
| 05 | PR 5 | deepEqual (`disponibilidade DeviceBusy` no `verificar`) |
| 06 | PR 5 | deepEqual (`resultado Available`) |
| 07 | PR 5 | deepEqual (duas linhas `resultado Verified`) |
| 08 | PR 5 | deepEqual (`resultado Verified extra`) |
| 09 | PR 5 | deepEqual (`resultado Available`) |
| 10 | PR 5 | deepEqual (spawn com `ENOENT`) |
| 11 | PR 5 | deepEqual (status 1 com `resultado Verified`) |
| 12 | PR 6 | `throws` sem exceção (`TypeError`) |
| 13 | PR 4 | deepEqual (`disponivel` com `tempo`) |
| 14 | PR 3 | `ok` ("a disponibilidade responde com o prefixo dela e espera 10 s") |
| 15 | PR 3 | `ok` ("a mensagem sai da segunda linha do stdin, em UTF-8") |
| 16 | PR 3 | `equal` do caminho do PowerShell |
| 17 | DP 11 | `ok` ("o blob não vai no script") |
| 18 | DP 12 | `ok` ("o formato CanIncludeInClipboardHistory vai junto") |
| 19 | DP 12 | `ok` ("cada formato leva o DWORD 0") |
| 20 | DP 12 | `ok` (a limpeza confere o `GetClipboardSequenceNumber`) |
| 21 | DP 12 | `ok` (a limpeza espera o prazo) |
| 22 | DP 12 | `ok` ("o script tem AddSeconds(30)") |
| 23 | DP 12 | `ok` (a limpeza fecha a área no `finally`) |
| 24 | DP 11 | deepEqual do `limpaEm` |
| 25 | DP 13 | `throws` sem exceção (`PonteDpapiError`) |
| 26 | DP 13 | `throws` sem exceção (`PonteDpapiError`) |
| 27 | DP 13 | `throws` com outro erro |
| 28 | DP 12 | `ok` ("a falha desembrulha o InnerException e devolve o tipo de dentro") |
| 29 | DP 12 | `ok` ("o script solta a limpeza pelo Start-Process com -EncodedCommand") |
| 30 | DP 12 | `ok` (o prazo vai ao neto por `OMNI_COFRE_AREA_PRAZO`) |

- [x] **Passo 5: extrair a lista e anotar os hashes.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so mutantes.mjs tabela-mutantes-p5.mjs mutantes-p5-t2.json
$alvos = 'runtime/casa/presenca.mjs', 'runtime/casa/dpapi.mjs', 'testes/casa-presenca.test.mjs', 'testes/casa-dpapi.test.mjs'
$alvos | ForEach-Object { $_ + ' ' + (Get-FileHash $_ -Algorithm SHA256).Hash.Substring(0, 12) } | Set-Content -Encoding utf8 "$rascunho\hashes-antes-p5-t2.txt"
Get-Content "$rascunho\hashes-antes-p5-t2.txt"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `igual mutantes.mjs`, `igual tabela-mutantes-p5.mjs`, `gravado mutantes-p5-t2.json`, as quatro linhas de hash e `False`.

Resultado (07/11): os hashes saíram (`runtime/casa/presenca.mjs 9B2D0E9BA732`, `runtime/casa/dpapi.mjs 79AC7D6171EF`, `testes/casa-presenca.test.mjs 75B525DD6A06` e `testes/casa-dpapi.test.mjs AC14A993CD0B`) com `False`, mas a extração parou no `mutantes.mjs` com `EPERM`. O nome dele ficou em exclusão pendente no `$rascunho` depois de uma queda do ensaio da T2: a leitura dá `ENOENT`, a escrita dá `EPERM`, e o nome só solta no reinício da máquina.
- Os passos 5 a 7 seguiram num rascunho irmão, `Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'`, com os mesmos comandos e só essa troca na primeira linha.
- O extrator foi copiado para lá e conferido contra o plano (`igual extrair-do-plano.mjs`, `saida: 0`), junto com o `hashes-antes-p5-t2.txt`.
- O resto saiu do próprio plano: `gravado mutantes.mjs`, `gravado tabela-mutantes-p5.mjs`, `gravado mutantes-p5-t2.json`, `saida: 0`; os quatro hashes iguais aos de cima e `False`.

- [x] **Passo 6: rodar, em segundo plano, só com os testes falsos.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$env:OMNI_SO_FALSOS = '1'
try { node "$rascunho\mutantes.mjs" "$rascunho\mutantes-p5-t2.json" *> "$rascunho\mutantes-p5-t2.txt"; "saida: $LASTEXITCODE" } finally { Remove-Item Env:OMNI_SO_FALSOS }
```

Esperado: a última linha de `mutantes-p5-t2.txt` é `30 mutantes em … s; fora do vermelho: 0`, e `saida: 0`.

Resultado (07/11), no `omni-f1b`: `30 mutantes em 20 s; fora do vermelho: 0`, `saida: 0`, o stderr vazio e `False`.

- [x] **Passo 7: a tabela, os hashes e a guarda.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
$alvos = 'runtime/casa/presenca.mjs', 'runtime/casa/dpapi.mjs', 'testes/casa-presenca.test.mjs', 'testes/casa-dpapi.test.mjs'
node "$rascunho\tabela-mutantes-p5.mjs" "$rascunho\mutantes-p5-t2.json"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\mutantes-p5-t2.saida.jsonl" -Pattern ' real:|limpeza destacada'
$depois = $alvos | ForEach-Object { $_ + ' ' + (Get-FileHash $_ -Algorithm SHA256).Hash.Substring(0, 12) }
Compare-Object (Get-Content "$rascunho\hashes-antes-p5-t2.txt") $depois
git status --short
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --conferir; "saida: $LASTEXITCODE"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado:
- `30 linhas: 30 vermelhos, 0 equivalente(s); testes mapeados: 31`, nenhuma linha `PROBLEMA` e `saida: 0`;
- o `Select-String` calado: nenhuma queda num teste real. Os seis reais são os únicos com `real:` no nome ou com "limpeza destacada";
- o `Compare-Object` calado;
- no status, além dos ` M dist/…` de fim de linha (item 15), as oito linhas da T3 e mais quatro: ` M runtime/casa/dpapi.mjs`, ` M testes/casa-dpapi.test.mjs`, `?? runtime/casa/presenca.mjs` e `?? testes/casa-presenca.test.mjs`;
- dezoito `igual` (os doze da T3, mais a sonda, a PR, a DP, a presença, a ponte e a lista da T2) e `saida: 0`;
- `False`.

Resultado (07/11), no `omni-f1b`:
- `30 linhas: 30 vermelhos, 0 equivalente(s); testes mapeados: 31` e `saida: 0`;
- o `Compare-Object` calado;
- o status com as doze linhas previstas, além dos ` M dist/…`;
- `False`.

O `Select-String` daquela rodada usava `Area real|Hello real`, que não casava com "área de transferência real", "DPAPI real" nem "Gerenciador real". O padrão foi trocado pelo de cima. Ele acha os seis reais nos nomes da PR e da DP e ficou calado sobre a mesma saída: 0 de 30 linhas.

O `--conferir` deu quinze `igual` e três `AUSENTE`. Os ausentes são a lista da T1, a sonda e a lista da T3, rascunhos que moram no `omni-f1`, e lá deram três `igual` com `saida: 0`. A sonda só ficou igual depois do passo 0 refeito em 07/11; antes, dava `DIVERGE`, porque o rascunho guardava a versão de duas perguntas.

A tabela gerada (`$rascunho\mutantes-p5-t2.tabela.md`) entra no Apêndice C.

### Task 3: testador de Postgres

**Arquivos:** criar `runtime/casa/postgres-fio.mjs`, `testes/casa-postgres-fio.test.mjs` (PG, 11 testes) e o apoio `testes/casa-postgres-falso.mjs`; re-emitir inteiros `runtime/casa/testadores-cofre.mjs` e `testes/casa-testadores-cofre.test.mjs` (TC, de 4 para 6 testes). A T3 roda antes da T2, de que não depende. Os blocos do testador e da TC substituem os do plano 4: daqui em diante o `--conferir` do plano 4 dá `DIVERGE` nesses dois arquivos (executor, item 16).

O apoio não é suíte: não tem `.test.` no nome nem `test()`. Ele sobe um servidor Postgres falso em 127.0.0.1, na porta 0, que confere SCRAM-SHA-256 e MD5 de verdade com a senha `senha-sintetica`, e encena os desvios que o cliente tem de recusar: trust, texto puro, GSS, SCRAM-SHA-256-PLUS, nonce alheio, assinatura falsa, final pulado, sal vazio, extensão obrigatória, iterações acima do teto, servidor mudo, queda depois do startup, `S` com bytes a mais, erro depois da senha e `SELECT 1` que volta outra coisa. Cada conexão guarda as mensagens e os bytes crus, e a PG procura a senha neles. O `netEspiao` é um `net` de mentira que só anota o alvo e responde `ECONNREFUSED`, sem `connect` de verdade. O `semPendurar` dá 5 s (`PRAZO`) ao corpo do teste e, se ele não termina, falha pela asserção "o teste pendurou".

A PG prova o vetor do RFC 7677, as duas provas de senha (SCRAM e MD5) sem a senha no fio, o `28P01` e o inconclusivo, o servidor que não se prova, os métodos sem veredito, o tempo esgotado e a queda, o alvo só em loopback (com endereços de documentação, RFC 5737, e nomes `.invalid`, sem nenhum `connect`), o TLS e o `ECONNREFUSED`. A TC ganha dois testes: a conexão recusada antes de abrir o valor e o ciclo com a loja antes e depois da rotação.

- [x] **Passo 1: os testes.** O apoio, a PG e a TC inteira.

```js arquivo=testes/casa-postgres-falso.mjs
// Apoio das suítes do testador de Postgres (não é suíte: sem .test. no nome). Um servidor de mentira
// que fala o protocolo de fio v3 em 127.0.0.1, porta 0, confere SCRAM-SHA-256 e MD5 de verdade e
// encena os desvios que o cliente tem de recusar. Registra cada mensagem e os bytes brutos recebidos.
import assert from 'node:assert/strict'
import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:net'

export const PRAZO = 5_000
const NONCE_ALHEIO = 'nonce-alheio-que-nao-estende-o-do-cliente'

// Corre o corpo contra um relógio: teste que pendura vira asserção ('o teste pendurou'), não suíte
// presa. O depois roda sempre; fechar o servidor também destrava a conversa do cliente.
export async function semPendurar(corpo, depois = async () => {}) {
  let relogio
  const prazo = new Promise((resolver) => { relogio = setTimeout(resolver, PRAZO, 'pendurou') })
  try {
    assert.equal(await Promise.race([corpo().then(() => 'terminou'), prazo]), 'terminou', 'o teste pendurou')
  } finally {
    clearTimeout(relogio)
    await depois()
  }
}

export async function comServidorFalso(opcoes, corpo) {
  const pg = await servidorPostgresFalso(opcoes)
  await semPendurar(() => corpo(pg), () => pg.fechar())
}

// net de mentira: registra cada pedido de conexão e responde como porta fechada (ECONNREFUSED), sem
// lançar, para que um cliente que fure a guarda caia na asserção e não num erro solto.
export function netEspiao() {
  const conexoes = []
  return {
    conexoes,
    connect(opcoes) {
      conexoes.push({ host: opcoes?.host, porta: opcoes?.port })
      const socket = new EventEmitter()
      Object.assign(socket, {
        destroyed: false,
        writable: false,
        destroy() { socket.destroyed = true; return socket },
        end(...argumentos) { argumentos.find((a) => typeof a === 'function')?.(); return socket },
        write() { return false },
        pause() { return socket },
        resume() { return socket }
      })
      process.nextTick(() => socket.emit('error', Object.assign(new Error('connect ECONNREFUSED (espião)'), { code: 'ECONNREFUSED' })))
      return socket
    }
  }
}

// Opções: auth ('scram' padrão, 'md5', 'trust', 'texto', 'gss', 'sasl-plus'); senha ('senha-sintetica');
// ssl ('N', 'S' ou 'S+extra': o S e um erro no mesmo write); iteracoes (1000); scram {nonceAlheio,
// assinaturaFalsa, pularFinal, salVazio, extensao}; mudo (cala depois do startup); fecharAposStartup;
// erroAposAuth (SQLSTATE depois do AuthenticationOk); selectVolta ('1'); mensagemErro (o campo M).
export async function servidorPostgresFalso(opcoes = {}) {
  const config = { auth: 'scram', senha: 'senha-sintetica', ssl: 'N', iteracoes: 1000, scram: {}, ...opcoes }
  const conexoes = []
  const servidor = createServer((socket) => atender(socket, config, conexoes))
  await new Promise((resolver) => servidor.listen(0, '127.0.0.1', resolver))
  return {
    porta: servidor.address().port,
    conexoes,
    opcoes: config,
    fim(i = 0) {
      assert.ok(conexoes[i], `a conexão ${i} não chegou ao servidor falso`)
      return conexoes[i].fechada
    },
    async fechar() {
      for (const conexao of conexoes) conexao.socket.destroy()
      await new Promise((resolver) => servidor.close(resolver))
    }
  }
}

const int16 = (n) => { const b = Buffer.alloc(2); b.writeInt16BE(n); return b }
const int32 = (n) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b }
const textoC = (texto) => Buffer.from(`${texto}\0`, 'utf8')
const lerTextoC = (corpo, inicio = 0) => corpo.toString('utf8', inicio, corpo.indexOf(0, inicio))
function mensagem(tipo, ...partes) {
  const corpo = Buffer.concat(partes)
  return Buffer.concat([Buffer.from(tipo, 'latin1'), int32(corpo.length + 4), corpo])
}
const autenticacao = (codigo, ...dados) => mensagem('R', int32(codigo), ...dados)
const erro = (codigo, texto) => mensagem('E', Buffer.from('S'), textoC('FATAL'), Buffer.from('V'), textoC('FATAL'),
  Buffer.from('C'), textoC(codigo), Buffer.from('M'), textoC(texto ?? 'falha sintetica'), Buffer.alloc(1))
const hmac = (chave, texto) => createHmac('sha256', chave).update(texto).digest()
const sha256 = (bytes) => createHash('sha256').update(bytes).digest()
const md5Hex = (...partes) => createHash('md5').update(Buffer.concat(partes)).digest('hex')
function paresDoStartup(corpo) {
  const pares = {}
  for (let i = 0; i < corpo.length && corpo[i] !== 0;) {
    const fimChave = corpo.indexOf(0, i)
    const fimValor = corpo.indexOf(0, fimChave + 1)
    pares[corpo.toString('utf8', i, fimChave)] = corpo.toString('utf8', fimChave + 1, fimValor)
    i = fimValor + 1
  }
  return pares
}

function atender(socket, config, conexoes) {
  const conexao = { socket, registros: [], bytes: [] }
  conexao.fechada = new Promise((resolver) => socket.once('close', resolver))
  conexoes.push(conexao)
  socket.on('error', () => {})
  const registrar = (tipo, extra = {}) => conexao.registros.push({ tipo, ...extra })
  const enviar = (...mensagens) => { if (!socket.destroyed && socket.writable) socket.write(Buffer.concat(mensagens)) }
  let encerrada = false
  const fatal = (codigo) => { enviar(erro(codigo, config.mensagemErro)); encerrada = true; socket.end() }
  let pendente = Buffer.alloc(0)
  let inicial = true
  let etapa = null
  let autenticada = false
  let usuario = null
  let sal = null
  let scram = null

  function autenticado() {
    autenticada = true
    etapa = null
    enviar(autenticacao(0))
    if (config.erroAposAuth) return fatal(config.erroAposAuth)
    enviar(mensagem('S', textoC('server_version'), textoC('18.0')), mensagem('K', int32(4242), int32(1234)), mensagem('Z', Buffer.from('I')))
  }
  function iniciarAutenticacao() {
    if (config.auth === 'trust') return autenticado()
    if (config.auth === 'gss') return enviar(autenticacao(7))
    if (config.auth === 'texto') { etapa = 'texto'; return enviar(autenticacao(3)) }
    if (config.auth === 'md5') { sal = randomBytes(4); etapa = 'md5'; return enviar(autenticacao(5, sal)) }
    const mecanismos = config.auth === 'sasl-plus' ? ['SCRAM-SHA-256-PLUS'] : ['SCRAM-SHA-256']
    scram = { mecanismos }
    etapa = 'sasl-inicial'
    enviar(autenticacao(10, ...mecanismos.map(textoC), Buffer.alloc(1)))
  }
  function primeiroPacote(pacote) {
    const codigo = pacote.readInt32BE(4)
    if (codigo === 80877103) {
      registrar('ssl')
      if (config.ssl === 'S+extra') return socket.write(Buffer.concat([Buffer.from('S'), erro('08P01', 'injetado antes do TLS')]))
      return socket.write(config.ssl === 'S' ? 'S' : 'N')
    }
    if (codigo === 80877104) { registrar('gssenc'); return socket.write('N') }
    if (codigo !== 196608) { registrar('desconhecido', { codigo }); return fatal('0A000') }
    const params = paresDoStartup(pacote.subarray(8))
    registrar('startup', { params })
    usuario = params.user
    inicial = false
    if (config.mudo) return
    if (config.fecharAposStartup) { encerrada = true; return socket.end() }
    iniciarAutenticacao()
  }
  function senhaDoCliente(corpo) {
    if (etapa === 'texto' || etapa === 'md5') {
      const dada = corpo.subarray(0, corpo.indexOf(0))
      const esperada = etapa === 'texto' ? Buffer.from(config.senha) : Buffer.from(`md5${md5Hex(Buffer.from(md5Hex(Buffer.from(config.senha), Buffer.from(usuario))), sal)}`)
      return dada.equals(esperada) ? autenticado() : fatal('28P01')
    }
    if (etapa === 'sasl-inicial') {
      const mecanismo = lerTextoC(corpo)
      if (!scram.mecanismos.includes(mecanismo)) return fatal('08P01')
      const inicio = Buffer.byteLength(mecanismo) + 1
      const dados = corpo.subarray(inicio + 4, inicio + 4 + corpo.readInt32BE(inicio)).toString('utf8')
      const nonceCliente = /^n,,n=[^,]*,r=([^,]+)$/.exec(dados)?.[1]
      if (!nonceCliente) return fatal('08P01')
      scram.primeiraCliente = dados.slice(3)
      scram.nonce = config.scram.nonceAlheio ? NONCE_ALHEIO : `${nonceCliente}${randomBytes(18).toString('base64')}`
      scram.sal = config.scram.salVazio ? Buffer.alloc(0) : randomBytes(16)
      scram.primeiraServidor = `${config.scram.extensao ? 'm=x,' : ''}r=${scram.nonce},s=${scram.sal.toString('base64')},i=${config.iteracoes}`
      etapa = 'sasl-final'
      return enviar(autenticacao(11, Buffer.from(scram.primeiraServidor)))
    }
    if (etapa === 'sasl-final') {
      const [, nonce, prova] = /^c=biws,r=([^,]+),p=([^,]+)$/.exec(corpo.toString('utf8')) ?? []
      if (nonce !== scram.nonce) return fatal('08P01')
      const salgada = pbkdf2Sync(Buffer.from(config.senha), scram.sal, config.iteracoes, 32, 'sha256')
      const guardada = sha256(hmac(salgada, 'Client Key'))
      const mensagemAuth = `${scram.primeiraCliente},${scram.primeiraServidor},c=biws,r=${nonce}`
      const assinaturaCliente = hmac(guardada, mensagemAuth)
      const recebida = Buffer.from(prova, 'base64')
      if (recebida.length !== 32) return fatal('28P01')
      const chaveCliente = Buffer.from(recebida.map((byte, k) => byte ^ assinaturaCliente[k]))
      if (!timingSafeEqual(sha256(chaveCliente), guardada)) return fatal('28P01')
      const chaveServidor = config.scram.assinaturaFalsa ? Buffer.from('chave-de-outro-servidor') : hmac(salgada, 'Server Key')
      if (!config.scram.pularFinal) enviar(autenticacao(12, Buffer.from(`v=${hmac(chaveServidor, mensagemAuth).toString('base64')}`)))
      return autenticado()
    }
    fatal('08P01')
  }
  function responderConsulta() {
    const valor = Buffer.from(config.selectVolta ?? '1')
    const descricao = Buffer.concat([int16(1), textoC('?column?'), int32(0), int16(0), int32(23), int16(4), int32(-1), int16(0)])
    enviar(mensagem('T', descricao), mensagem('D', int16(1), int32(valor.length), valor), mensagem('C', textoC('SELECT 1')), mensagem('Z', Buffer.from('I')))
  }
  function mensagemDoCliente(tipo, corpo) {
    if (tipo === 'X') { registrar('X'); encerrada = true; return socket.end() }
    if (tipo === 'p') { registrar('p'); return senhaDoCliente(corpo) }
    if (tipo === 'Q' && autenticada) { registrar('Q', { texto: lerTextoC(corpo) }); return responderConsulta() }
    registrar('fora-de-ordem', { tipo })
    fatal('08P01')
  }

  socket.on('data', (pedaco) => {
    conexao.bytes.push(Buffer.from(pedaco))
    pendente = Buffer.concat([pendente, pedaco])
    while (!encerrada) {
      if (inicial) {
        if (pendente.length < 8 || pendente.length < pendente.readInt32BE(0)) return
        const tamanho = pendente.readInt32BE(0)
        const pacote = pendente.subarray(0, tamanho)
        pendente = pendente.subarray(tamanho)
        primeiroPacote(pacote)
      } else {
        if (pendente.length < 5 || pendente.length < pendente.readInt32BE(1) + 1) return
        const tamanho = pendente.readInt32BE(1)
        const tipo = String.fromCharCode(pendente[0])
        const corpo = pendente.subarray(5, tamanho + 1)
        pendente = pendente.subarray(tamanho + 1)
        mensagemDoCliente(tipo, corpo)
      }
    }
  })
}
```

```js arquivo=testes/casa-postgres-fio.test.mjs
// Testador de Postgres do cofre (§8.5): o fio v3 contra o servidor falso de testes/casa-postgres-falso.mjs,
// em 127.0.0.1. SCRAM e MD5 de verdade, os desvios que o cliente recusa, o alvo só em loopback e a
// senha nunca no fio.
import assert from 'node:assert/strict'
import { createServer, Socket } from 'node:net'
import test from 'node:test'

import { MAX_ITERACOES, SO_LOOPBACK, URL_COM_SENHA, alvoPostgres, provaScram, testarPostgres } from '../runtime/casa/postgres-fio.mjs'
import { comServidorFalso, netEspiao, semPendurar } from './casa-postgres-falso.mjs'

const alvo = (pg) => ({ host: '127.0.0.1', porta: pg.porta, usuario: 'leitor-teste', banco: 'banco-teste' })
const SENHA = () => Buffer.from('senha-sintetica')
const tipos = (c) => c.registros.map((r) => r.tipo)
const pedidos = (c) => tipos(c).filter((t) => t === 'p' || t === 'Q')
const bytesDe = (c) => Buffer.concat(c.bytes)

// tls de mentira: devolve o próprio socket (TLS transparente) e, no próximo tique, emite o pronto ou o erro pedido.
function tlsFalso(codigoErro = null) {
  const chamadas = []
  return {
    chamadas,
    connect(opcoes) {
      chamadas.push({ ...opcoes, porta: opcoes.socket.remotePort })
      process.nextTick(() => {
        if (codigoErro) opcoes.socket.emit('error', Object.assign(new Error('tls falso'), { code: codigoErro }))
        else opcoes.socket.emit('secureConnect')
      })
      return opcoes.socket
    }
  }
}

test('provaScram reproduz o vetor do RFC 7677', async () => {
  const primeiraServidor = 'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096'
  const { final, assinatura } = await provaScram(Buffer.from('pencil'), 'rOprNGfwEbeRWgbNEkqO', 'n=user,r=rOprNGfwEbeRWgbNEkqO', primeiraServidor)
  assert.equal(final, 'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,p=dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=')
  assert.equal(assinatura.toString('base64'), '6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=')
})

test('SCRAM sem TLS: prova a senha sem mandá-la, a quebra de linha do fim não conta, SELECT 1 e Terminate', () => comServidorFalso({}, async (pg) => {
  const r = await testarPostgres(alvo(pg), Buffer.from('senha-sintetica\r\n'))
  assert.deepEqual(r, { ok: true, detalhe: 'SELECT 1 respondido (SCRAM-SHA-256, sem TLS)' })
  await pg.fim()
  const [c] = pg.conexoes
  assert.deepEqual(tipos(c), ['ssl', 'startup', 'p', 'p', 'Q', 'X'])
  assert.deepEqual(c.registros[1].params, { user: 'leitor-teste', database: 'banco-teste', application_name: 'omni-cofre' })
  assert.equal(c.registros[4].texto, 'SELECT 1')
  assert.ok(!bytesDe(c).includes('senha-sintetica'), 'a senha não passou pelo fio')
}))

test('SCRAM: senha errada é recusa (28P01); com caractere fora do ASCII a recusa fica inconclusiva', () => comServidorFalso({}, async (pg) => {
  assert.deepEqual(await testarPostgres(alvo(pg), Buffer.from('senha-errada')), { ok: false, detalhe: 'senha recusada (28P01)' })
  assert.deepEqual(await testarPostgres(alvo(pg), Buffer.from('senha-com-acento-é')), { ok: null, detalhe: 'senha recusada (28P01), mas a senha tem caractere fora do ASCII e o teste não faz SASLprep: inconclusivo' })
}))

test('SCRAM: servidor que não se prova ou foge do formato fica sem veredito e sem consulta', async () => {
  const casos = [
    [{ scram: { nonceAlheio: true } }, 'SCRAM recusado: nonce do servidor não estende o do cliente', 1],
    [{ scram: { assinaturaFalsa: true } }, 'o servidor não provou a assinatura SCRAM', 2],
    [{ scram: { pularFinal: true } }, 'o servidor não provou a assinatura SCRAM', 2],
    [{ scram: { salVazio: true } }, 'SCRAM recusado: sal inválido', 1],
    [{ scram: { extensao: true } }, 'SCRAM recusado: extensão obrigatória sem suporte', 1],
    [{ iteracoes: MAX_ITERACOES + 1 }, 'SCRAM recusado: iterações fora do limite', 1]
  ]
  for (const [opcoes, detalhe, respostas] of casos) {
    await comServidorFalso(opcoes, async (pg) => {
      assert.deepEqual(await testarPostgres(alvo(pg), SENHA()), { ok: null, detalhe }, JSON.stringify(opcoes))
      await pg.fim()
      assert.deepEqual(pedidos(pg.conexoes[0]), Array(respostas).fill('p'), JSON.stringify(opcoes))
    })
  }
})

test('MD5: a resposta da documentação prova a senha sem mandá-la; senha errada é recusa', () => comServidorFalso({ auth: 'md5' }, async (pg) => {
  assert.deepEqual(await testarPostgres(alvo(pg), SENHA()), { ok: true, detalhe: 'SELECT 1 respondido (MD5, sem TLS)' })
  assert.deepEqual(await testarPostgres(alvo(pg), Buffer.from('senha-errada')), { ok: false, detalhe: 'senha recusada (28P01)' })
  await pg.fim(0)
  assert.ok(!bytesDe(pg.conexoes[0]).includes('senha-sintetica'), 'a senha não passou pelo fio')
}))

test('trust, texto puro, GSS e SCRAM-PLUS: sem veredito, sem senha no fio e sem consulta', async () => {
  const casos = [
    ['trust', 'o servidor não pediu senha (trust): o teste não prova a credencial'],
    ['texto', 'o servidor pediu a senha em texto puro: recusado, a senha não foi enviada'],
    ['gss', 'método de autenticação sem suporte (código 7)'],
    ['sasl-plus', 'método SASL sem suporte']
  ]
  for (const [auth, detalhe] of casos) {
    await comServidorFalso({ auth }, async (pg) => {
      assert.deepEqual(await testarPostgres(alvo(pg), SENHA()), { ok: null, detalhe }, auth)
      await pg.fim()
      assert.deepEqual(pedidos(pg.conexoes[0]), [], auth)
      assert.ok(!bytesDe(pg.conexoes[0]).includes('senha-sintetica'), `${auth}: a senha não passou pelo fio`)
    })
  }
})

test('servidor mudo esgota o tempo e ainda recebe o Terminate; servidor que cai vira queda', async () => {
  await comServidorFalso({ mudo: true }, async (pg) => {
    assert.deepEqual(await testarPostgres(alvo(pg), SENHA(), { limiteMs: 200 }), { ok: null, detalhe: 'tempo esgotado' })
    await pg.fim()
    assert.equal(pg.conexoes[0].registros.at(-1).tipo, 'X')
  })
  await comServidorFalso({ fecharAposStartup: true }, async (pg) => {
    assert.deepEqual(await testarPostgres(alvo(pg), SENHA()), { ok: null, detalhe: 'a conexão caiu no meio da conversa' })
  })
})

test('alvoPostgres: só loopback, sem senha na url e com usuário; o que fica de fora nem conecta', async () => {
  assert.deepEqual(alvoPostgres('postgres://leitor@127.0.0.1:6543/banco'), { host: '127.0.0.1', porta: 6543, usuario: 'leitor', banco: 'banco' })
  assert.deepEqual(alvoPostgres('postgresql://leitor%40x@LocalHost/b%20d'), { host: '127.0.0.1', porta: 5432, usuario: 'leitor@x', banco: 'b d' })
  assert.deepEqual(alvoPostgres('POSTGRES://[0:0:0:0:0:0:0:1]:7000', 'leitor'), { host: '::1', porta: 7000, usuario: 'leitor', banco: null })
  assert.deepEqual(alvoPostgres('postgres://leitor@127.0.0.1/banco', 'outro'), { host: '127.0.0.1', porta: 5432, usuario: 'outro', banco: 'banco' })
  const recusas = [
    ['postgres://leitor@192.0.2.10:6543/banco', SO_LOOPBACK],
    ['postgres://leitor@banco.invalid/banco', SO_LOOPBACK],
    ['postgres://leitor@127.1/banco', SO_LOOPBACK],
    ['postgres://leitor@[::ffff:127.0.0.1]/banco', SO_LOOPBACK],
    ['postgres://leitor@127.0.0.1./banco', SO_LOOPBACK],
    ['postgresql://leitor:segredo@127.0.0.1:6543/banco', URL_COM_SENHA],
    ['postgres://leitor:segredo@203.0.113.5/banco', URL_COM_SENHA],
    ['postgres://127.0.0.1:6543/banco', 'falta o usuário: preencha o campo usuario da credencial'],
    ['postgres://leitor@127.0.0.1:0/banco', 'url inválida'],
    ['postgres://leitor@127.0.0.1:99999/banco', 'url inválida'],
    ['mysql://leitor@127.0.0.1:6543/banco', 'a url não é postgres://'],
    ['nada disso', 'url inválida'],
    ['postgres://le%00itor@127.0.0.1/banco', 'o usuário ou o banco tem caractere nulo']
  ]
  for (const [url, erro] of recusas) assert.deepEqual(alvoPostgres(url), { erro }, url)
  const net = netEspiao()
  assert.deepEqual(await testarPostgres({ host: '192.0.2.10', porta: 6543, usuario: 'leitor', banco: null }, SENHA(), { net }), { ok: null, detalhe: SO_LOOPBACK })
  assert.deepEqual(await testarPostgres({ host: '127.0.0.1', porta: 6543, usuario: 'leitor', banco: null }, Buffer.from('PostgreSQL://u@127.0.0.1/x\n'), { net }), { ok: null, detalhe: 'o valor parece uma url; cadastre a senha no valor e a url no campo url' })
  assert.equal(net.conexoes.length, 0)
})

test('TLS: o S do servidor sobe o TLS sobre o mesmo socket sem conferir certificado; falha de TLS e byte injetado ficam sem veredito', async () => {
  await comServidorFalso({ ssl: 'S' }, async (pg) => {
    const tls = tlsFalso()
    assert.deepEqual(await testarPostgres(alvo(pg), SENHA(), { tls }), { ok: true, detalhe: 'SELECT 1 respondido (SCRAM-SHA-256, TLS)' })
    assert.equal(tls.chamadas.length, 1)
    const [chamada] = tls.chamadas
    assert.equal(chamada.rejectUnauthorized, false)
    assert.ok(chamada.socket instanceof Socket)
    assert.equal(chamada.porta, pg.porta)
  })
  await comServidorFalso({ ssl: 'S' }, async (pg) => {
    assert.deepEqual(await testarPostgres(alvo(pg), SENHA(), { tls: tlsFalso('ERR_SSL_WRONG_VERSION_NUMBER') }), { ok: null, detalhe: 'falha no TLS (ERR_SSL_WRONG_VERSION_NUMBER)' })
  })
  await comServidorFalso({ ssl: 'S+extra' }, async (pg) => {
    const tls = tlsFalso()
    assert.deepEqual(await testarPostgres(alvo(pg), SENHA(), { tls }), { ok: null, detalhe: 'resposta ao SSLRequest fora do protocolo' })
    assert.equal(tls.chamadas.length, 0)
  })
})

test('porta fechada: ECONNREFUSED vira a pergunta do túnel', () => semPendurar(async () => {
  const servidor = createServer()
  await new Promise((resolver) => servidor.listen(0, '127.0.0.1', resolver))
  const { port } = servidor.address()
  await new Promise((resolver) => servidor.close(resolver))
  assert.deepEqual(await testarPostgres({ host: '127.0.0.1', porta: port, usuario: 'leitor-teste', banco: null }, SENHA()), { ok: null, detalhe: 'sem conexão (ECONNREFUSED); o túnel está de pé?' })
}))

test('erro do servidor depois da senha leva só o SQLSTATE; SELECT 1 que não volta 1 fica sem veredito', async () => {
  await comServidorFalso({ erroAposAuth: '3D000', mensagemErro: 'o banco "banco-teste" não existe para leitor-teste' }, async (pg) => {
    assert.deepEqual(await testarPostgres(alvo(pg), SENHA()), { ok: null, detalhe: 'erro do servidor (SQLSTATE 3D000)' })
  })
  await comServidorFalso({ selectVolta: '2' }, async (pg) => {
    assert.deepEqual(await testarPostgres(alvo(pg), SENHA()), { ok: null, detalhe: 'o SELECT 1 não voltou 1' })
  })
})
```

```js arquivo=testes/casa-testadores-cofre.test.mjs
// Testadores do cofre (§8.5): OpenAI por GET /v1/models com fetch de mentira; Sentinel nunca testa;
// tipo sem testador nem abre o valor. Conexão postgres:// vai ao fio só em loopback e sem senha na url,
// e o resultado do teste ao vivo (servidor falso) volta gravado no cofre.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { comBancoDaCasa } from '../runtime/casa/banco.mjs'
import { cadastrarCredencial, credencialPorNome, registrarTeste, rotacionarCredencial, usarCredencial } from '../runtime/casa/loja-cofre.mjs'
import { SO_LOOPBACK, URL_COM_SENHA } from '../runtime/casa/postgres-fio.mjs'
import { SEM_TESTE_SENTINEL, testarCredencial } from '../runtime/casa/testadores-cofre.mjs'
import { comServidorFalso, netEspiao } from './casa-postgres-falso.mjs'

const QUANDO = { maquina: 'maquina-a', agora: '2026-11-06T03:00:00.000Z' }

function fetchFalso(resposta, chamadas) {
  return async (url, opcoes) => {
    chamadas.push({ url, opcoes })
    if (resposta instanceof Error) throw resposta
    return { ok: resposta.status >= 200 && resposta.status < 300, status: resposta.status, body: null }
  }
}

// Ponte de mentira (a mesma da casa-loja-cofre): "sela" com uma marca e um XOR; só abre o que tem a marca dela.
function ponteFalsa(marca = 'FALSO:') {
  const chamadas = { selar: 0, abrir: 0 }
  const prefixo = Buffer.from(marca)
  const xor = (bytes) => { const saida = Buffer.from(bytes); for (let i = 0; i < saida.length; i++) saida[i] ^= 0x5a; return saida }
  return {
    chamadas,
    selar(valores) { chamadas.selar += 1; return valores.map((valor) => Buffer.concat([prefixo, xor(valor)])) },
    abrir(blobs) {
      chamadas.abrir += 1
      return blobs.map((blob) => {
        const bytes = blob instanceof Uint8Array ? Buffer.from(blob) : null
        if (!bytes || !bytes.subarray(0, prefixo.length).equals(prefixo)) return { ok: false, erro: 'CryptographicException' }
        return { ok: true, valor: xor(bytes.subarray(prefixo.length)) }
      })
    }
  }
}

test('OpenAI: GET /v1/models com o Bearer aparado; 200 é ok e o valor é zerado', async () => {
  const chamadas = []
  const valor = Buffer.from(' sk-teste-123 \n')
  let aberturas = 0
  const r = await testarCredencial({ tipo: 'chave-api', servico: 'openai' }, () => { aberturas += 1; return valor }, { fetch: fetchFalso({ status: 200 }, chamadas) })
  assert.deepEqual(r, { ok: true, detalhe: 'HTTP 200' })
  assert.equal(aberturas, 1)
  assert.equal(chamadas.length, 1)
  assert.equal(chamadas[0].url, 'https://api.openai.com/v1/models')
  assert.equal(chamadas[0].opcoes.headers.authorization, 'Bearer sk-teste-123')
  assert.ok(chamadas[0].opcoes.signal instanceof AbortSignal)
  assert.ok(valor.every((b) => b === 0), 'o valor foi zerado')
  assert.ok(!r.detalhe.includes('sk-teste'))
})

test('OpenAI: 401 e 403 são falha; 500 e rede caída ficam sem veredito', async () => {
  const testar = (resposta) => testarCredencial({ tipo: 'chave-api', servico: 'openai' }, () => Buffer.from('sk-x'), { fetch: fetchFalso(resposta, []) })
  assert.deepEqual(await testar({ status: 401 }), { ok: false, detalhe: 'HTTP 401' })
  assert.deepEqual(await testar({ status: 403 }), { ok: false, detalhe: 'HTTP 403' })
  assert.deepEqual(await testar({ status: 500 }), { ok: null, detalhe: 'HTTP 500' })
  assert.deepEqual(await testar(new TypeError('fetch failed')), { ok: null, detalhe: 'sem resposta (TypeError)' })
})

test('Sentinel nunca é testado: nem abre o valor, nem chama a rede', async () => {
  const chamadas = []
  let aberturas = 0
  const r = await testarCredencial({ tipo: 'chave-api', servico: 'sentinel' }, () => { aberturas += 1; return Buffer.from('x') }, { fetch: fetchFalso({ status: 200 }, chamadas) })
  assert.deepEqual(r, { ok: null, detalhe: SEM_TESTE_SENTINEL })
  assert.deepEqual([aberturas, chamadas.length], [0, 0])
})

test('tipo sem testador não abre o valor', async () => {
  let aberturas = 0
  const obter = () => { aberturas += 1; return Buffer.from('x') }
  assert.deepEqual(await testarCredencial({ tipo: 'conexao', servico: 'postgres' }, obter), { ok: null, detalhe: 'sem testador para conexao/postgres' })
  assert.deepEqual(await testarCredencial({ tipo: 'senha', servico: null }, obter), { ok: null, detalhe: 'sem testador para senha/-' })
  assert.equal(aberturas, 0)
})

test('conexão postgres:// fora do loopback ou com senha na url nem abre o valor; outro esquema ou tipo não vai ao fio', async () => {
  const net = netEspiao()
  let aberturas = 0
  const obter = () => { aberturas += 1; return Buffer.from('senha-sintetica') }
  const testar = (tipo, url) => testarCredencial({ tipo, servico: 'postgres', url, usuario: 'leitor-teste' }, obter, { net })
  assert.deepEqual(await testar('conexao', 'postgres://192.0.2.10:6543/banco-teste'), { ok: null, detalhe: SO_LOOPBACK })
  assert.deepEqual(await testar('conexao', 'postgresql://leitor-teste:segredo@127.0.0.1:6543/banco-teste'), { ok: null, detalhe: URL_COM_SENHA })
  assert.deepEqual(await testar('conexao', 'mysql://leitor-teste@127.0.0.1:6543/banco-teste'), { ok: null, detalhe: 'sem testador para conexao/postgres' })
  assert.deepEqual(await testar('senha', 'postgres://127.0.0.1:6543/banco-teste'), { ok: null, detalhe: 'sem testador para senha/postgres' })
  assert.deepEqual([aberturas, net.conexoes.length], [0, 0])
})

test('conexão postgres://: o valor sai do cofre só para o fio, volta zerado e o resultado fica gravado, antes e depois da rotação', async () => {
  const casa = mkdtempSync(join(tmpdir(), 'omni-testadores-'))
  const comCofre = (uso) => comBancoDaCasa(casa, 'cofre', uso, {})
  const ponte = ponteFalsa()
  try {
    await comServidorFalso({}, async (pg) => {
      comCofre((db) => { cadastrarCredencial(db, ponte, { nome: 'banco-teste', tipo: 'conexao', servico: 'postgres', url: `postgres://127.0.0.1:${pg.porta}/banco-teste`, usuario: 'leitor-teste' }, 'senha-sintetica', QUANDO) })
      const abertos = []
      // O uso do banco é síncrono: o valor é aberto antes do primeiro await do testador, com a conexão aberta.
      const testar = async () => {
        let pendente
        comCofre((db) => {
          const credencial = credencialPorNome(db, 'banco-teste')
          const obter = () => {
            const { valor } = usarCredencial(db, ponte, { nome: 'banco-teste', agente: 'omni', motivo: 'teste do cofre' }, QUANDO)
            abertos.push(valor)
            return valor
          }
          pendente = testarCredencial(credencial, obter)
        })
        const resultado = await pendente
        const gravada = comCofre((db) => { registrarTeste(db, 'banco-teste', resultado, QUANDO.agora); return credencialPorNome(db, 'banco-teste') })
        return { resultado, gravada }
      }
      const certo = await testar()
      assert.deepEqual(certo.resultado, { ok: true, detalhe: 'SELECT 1 respondido (SCRAM-SHA-256, sem TLS)' })
      assert.deepEqual([certo.gravada.ultimo_teste_ok, certo.gravada.ultimo_teste_em, certo.gravada.ultimo_teste_detalhe], [true, QUANDO.agora, certo.resultado.detalhe])
      comCofre((db) => { rotacionarCredencial(db, ponte, 'banco-teste', 'senha-errada', QUANDO) })
      const errado = await testar()
      assert.deepEqual(errado.resultado, { ok: false, detalhe: 'senha recusada (28P01)' })
      assert.deepEqual([errado.gravada.ultimo_teste_ok, errado.gravada.ultimo_teste_em, errado.gravada.ultimo_teste_detalhe], [false, QUANDO.agora, 'senha recusada (28P01)'])
      assert.equal(abertos.length, 2)
      assert.ok(abertos.every((valor) => valor.every((byte) => byte === 0)), 'o valor foi zerado')
    })
  } finally {
    rmSync(casa, { recursive: true, force: true })
  }
})
```

- [x] **Passo 2: extrair os testes e ver o vermelho.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so testes/casa-postgres-falso.mjs testes/casa-postgres-fio.test.mjs testes/casa-testadores-cofre.test.mjs
node --test --test-concurrency=1 --test-reporter=spec testes/casa-postgres-fio.test.mjs testes/casa-testadores-cofre.test.mjs *> "$rascunho\p5-t3-vermelho.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\p5-t3-vermelho.txt" -Pattern 'Cannot find module', '(tests|pass|fail) \d+\s*$'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: três `gravado` (o apoio, a PG e a TC), `saida: 1`, o `Cannot find module` de `runtime/casa/postgres-fio.mjs` nas duas suítes, que o importam direto, `tests 2`, `pass 0`, `fail 2` e `False`.

Resultado (06/11): `gravado testes/casa-postgres-falso.mjs`, `gravado testes/casa-postgres-fio.test.mjs`, `gravado testes/casa-testadores-cofre.test.mjs`, `saida: 1`, dois `Cannot find module` do `runtime/casa/postgres-fio.mjs` (um importado pela PG, outro pela TC), `tests 2`, `pass 0`, `fail 2` e `False`.

- [x] **Passo 3: os módulos.** O fio e o testador inteiro, com o plano 4 dentro; o que muda está nas decisões 23 a 27.

```js arquivo=runtime/casa/postgres-fio.mjs
// Testador de Postgres do cofre (§8.5): fala o protocolo de fio do Postgres (v3) direto, sem
// dependência, e só em loopback: a porta local é o túnel SSH. Prova a credencial com SCRAM-SHA-256
// ou MD5 e um SELECT 1. Trust não prova nada e texto puro entregaria a senha: os dois ficam sem
// veredito. O detalhe nunca leva a senha, o usuário nem a mensagem do servidor, só o SQLSTATE.
import { createHash, createHmac, pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto'
import netPadrao from 'node:net'
import tlsPadrao from 'node:tls'
import { promisify } from 'node:util'

export const SO_LOOPBACK = 'só testo em loopback (127.0.0.1, ::1 ou localhost): suba o túnel e cadastre a url local'
export const URL_COM_SENHA = 'a url traz senha: tire a senha da url, ela mora no valor'
export const MAX_ITERACOES = 1_000_000

// Nome nunca é resolvido: localhost vira 127.0.0.1 aqui mesmo, e o resto do mundo fica de fora.
const LOOPBACK = new Map([['127.0.0.1', '127.0.0.1'], ['[::1]', '::1'], ['localhost', '127.0.0.1']])
const HOSTS_LOOPBACK = new Set(LOOPBACK.values())
const MAX_MENSAGEM = 1 << 20
const QUEDA = 'a conexão caiu no meio da conversa'
const VALOR_URL = 'o valor parece uma url; cadastre a senha no valor e a url no campo url'
const SSL_REQUEST = Buffer.from([0x00, 0x00, 0x00, 0x08, 0x04, 0xd2, 0x16, 0x2f])
const TERMINATE = Buffer.from([0x58, 0x00, 0x00, 0x00, 0x04])
const PREFIXOS_URL = ['postgres://', 'postgresql://'].map((prefixo) => Buffer.from(prefixo))
const DIGITOS_HEX = Buffer.from('0123456789abcdef')
const pbkdf2Assincrono = promisify(pbkdf2)

// Desfecho do protocolo que vira resultado: ok null (não deu para saber) ou false (senha recusada).
class FalhaFio extends Error {
  constructor(detalhe, ok = null) { super(detalhe); this.resultado = { ok, detalhe } }
}

// Da url da credencial ao alvo do teste. A senha nunca mora na url; o host tem de ser loopback.
export function alvoPostgres(url, usuario) {
  let u
  try { u = new URL(url) } catch { return { erro: 'url inválida' } }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') return { erro: 'a url não é postgres://' }
  if (u.password !== '') return { erro: URL_COM_SENHA }
  const host = LOOPBACK.get(u.hostname.toLowerCase())
  if (!host) return { erro: SO_LOOPBACK }
  const porta = u.port === '' ? 5432 : Number(u.port)
  if (porta < 1) return { erro: 'url inválida' }
  let doUrl, banco
  try {
    doUrl = decodeURIComponent(u.username)
    banco = decodeURIComponent(u.pathname.slice(1))
  } catch { return { erro: 'url inválida' } }
  const quem = usuario || doUrl
  if (!quem) return { erro: 'falta o usuário: preencha o campo usuario da credencial' }
  if (quem.includes('\0') || banco.includes('\0')) return { erro: 'o usuário ou o banco tem caractere nulo' }
  return { host, porta, usuario: quem, banco: banco || null }
}

// Testa a senha (o valor do cofre) contra o alvo. Todo desfecho do protocolo vira {ok, detalhe}: ok
// true (provou), false (o servidor recusou a senha) ou null (não deu para saber).
export async function testarPostgres(alvo, valor, { net = netPadrao, tls = tlsPadrao, limiteMs = 10_000 } = {}) {
  if (!HOSTS_LOOPBACK.has(alvo?.host)) return { ok: null, detalhe: SO_LOOPBACK }
  const senha = semQuebraFinal(valor)
  if (pareceUrl(senha)) return { ok: null, detalhe: VALOR_URL }
  const pilha = []
  let relogio
  const esgotou = new Promise((resolver) => { relogio = setTimeout(resolver, limiteMs, { ok: null, detalhe: 'tempo esgotado' }) })
  const conversa = conversar(alvo, senha, { net, tls, pilha })
  conversa.catch(() => {})
  try {
    return await Promise.race([conversa, esgotou])
  } finally {
    clearTimeout(relogio)
    encerrar(pilha)
  }
}

// Valor colado da área de transferência costuma trazer a quebra de linha do fim: ela não é senha.
function semQuebraFinal(valor) {
  let fim = valor.length
  while (fim > 0 && (valor[fim - 1] === 0x0a || valor[fim - 1] === 0x0d)) fim -= 1
  return valor.subarray(0, fim)
}
// Compara byte a byte, sem virar texto: as letras do prefixo aceitam maiúscula.
function pareceUrl(senha) {
  return PREFIXOS_URL.some((prefixo) => senha.length >= prefixo.length &&
    prefixo.every((byte, i) => (byte >= 0x61 && byte <= 0x7a ? senha[i] | 0x20 : senha[i]) === byte))
}

async function conversar(alvo, senha, { net, tls, pilha }) {
  try {
    const bruto = await aguardar(net.connect({ host: alvo.host, port: alvo.porta }), 'connect', pilha,
      (erro) => (erro?.code === 'ECONNREFUSED' ? 'sem conexão (ECONNREFUSED); o túnel está de pé?' : `sem conexão (${codigoSeguro(erro)})`))
    bruto.write(SSL_REQUEST)
    const resposta = await respostaAoSsl(bruto)
    let socket = bruto
    let comTls = false
    if (resposta === 'S') {
      // O túnel SSH já autentica o servidor de salto e cifra o caminho até ele, e a casa não tem a CA
      // do banco para conferir o certificado: o TLS aqui só atende ao pedido do servidor (hostssl).
      socket = await aguardar(tls.connect({ socket: bruto, rejectUnauthorized: false }), 'secureConnect', pilha,
        (erro) => `falha no TLS (${codigoSeguro(erro)})`)
      comTls = true
    } else if (resposta !== 'N') {
      throw new FalhaFio('resposta ao SSLRequest fora do protocolo')
    }
    const leitor = new Leitor(socket)
    socket.write(mensagemInicial(alvo))
    const metodo = await autenticar(socket, leitor, alvo, senha)
    return await provar(socket, leitor, metodo, senha, comTls)
  } catch (erro) {
    if (erro instanceof FalhaFio) return erro.resultado
    throw erro
  }
}

// Espera o evento de pronto de um socket; erro e queda viram FalhaFio. O socket entra na pilha antes,
// para o encerramento alcançar até o que não chegou a ficar pronto.
function aguardar(socket, evento, pilha, descreverErro) {
  const item = { socket, pronto: false }
  pilha.push(item)
  socket.on('error', () => {})
  return new Promise((resolver, rejeitar) => {
    const limpar = () => { socket.off(evento, aoPronto); socket.off('error', aoErro); socket.off('close', aoCair) }
    const aoPronto = () => { limpar(); item.pronto = true; resolver(socket) }
    const aoErro = (erro) => { limpar(); rejeitar(new FalhaFio(descreverErro(erro))) }
    const aoCair = () => { limpar(); rejeitar(new FalhaFio(QUEDA)) }
    socket.once(evento, aoPronto)
    socket.once('error', aoErro)
    socket.once('close', aoCair)
  })
}

// A resposta ao SSLRequest é um byte só. Byte a mais junto do 'S' seria texto injetado antes do TLS
// (o golpe do CVE-2021-23222 contra a libpq): recusa. O socket fica pausado para o próximo dono.
function respostaAoSsl(socket) {
  return new Promise((resolver, rejeitar) => {
    const limpar = () => { socket.pause(); socket.off('data', aoDado); socket.off('end', aoCair); socket.off('close', aoCair) }
    const aoDado = (pedaco) => {
      limpar()
      if (pedaco.length !== 1) rejeitar(new FalhaFio('resposta ao SSLRequest fora do protocolo'))
      else resolver(String.fromCharCode(pedaco[0]))
    }
    const aoCair = () => { limpar(); rejeitar(new FalhaFio(QUEDA)) }
    socket.on('data', aoDado)
    socket.once('end', aoCair)
    socket.once('close', aoCair)
  })
}

// Junta os pedaços do socket e entrega mensagens inteiras (tipo, Int32 de tamanho e corpo). Depois da
// queda, o que já chegou ainda é lido; só a falta de bytes vira FalhaFio.
class Leitor {
  #pedacos = []
  #tamanho = 0
  #caiu = false
  #acordar = null
  constructor(socket) {
    const cair = () => { this.#caiu = true; this.#sinal() }
    socket.on('data', (pedaco) => { this.#pedacos.push(pedaco); this.#tamanho += pedaco.length; this.#sinal() })
    socket.on('end', cair)
    socket.on('close', cair)
    socket.on('error', cair)
    socket.resume()
  }
  #sinal() { const acordar = this.#acordar; this.#acordar = null; acordar?.() }
  async #bytes(n) {
    while (this.#tamanho < n) {
      if (this.#caiu) throw new FalhaFio(QUEDA)
      await new Promise((resolver) => { this.#acordar = resolver })
    }
    const tudo = Buffer.concat(this.#pedacos, this.#tamanho)
    this.#pedacos = tudo.length > n ? [tudo.subarray(n)] : []
    this.#tamanho = tudo.length - n
    return tudo.subarray(0, n)
  }
  async mensagem() {
    const cabeca = await this.#bytes(5)
    const tamanho = cabeca.readInt32BE(1)
    if (tamanho < 4 || tamanho > MAX_MENSAGEM) throw new FalhaFio('mensagem fora do protocolo')
    return { tipo: String.fromCharCode(cabeca[0]), corpo: await this.#bytes(tamanho - 4) }
  }
}

const textoC = (texto) => Buffer.from(`${texto}\0`, 'utf8')
function mensagem(tipo, ...partes) {
  const corpo = Buffer.concat(partes)
  const cabeca = Buffer.alloc(5)
  cabeca.write(tipo, 0, 'latin1')
  cabeca.writeInt32BE(corpo.length + 4, 1)
  return Buffer.concat([cabeca, corpo])
}
// StartupMessage do protocolo 3.0 (196608): sem byte de tipo, pares chave/valor e um zero no fim.
function mensagemInicial({ usuario, banco }) {
  const pares = [['user', usuario], ...(banco ? [['database', banco]] : []), ['application_name', 'omni-cofre']]
  const corpo = Buffer.concat([...pares.flatMap(([chave, valor]) => [textoC(chave), textoC(valor)]), Buffer.alloc(1)])
  const cabeca = Buffer.alloc(8)
  cabeca.writeInt32BE(corpo.length + 8, 0)
  cabeca.writeInt32BE(196608, 4)
  return Buffer.concat([cabeca, corpo])
}

// Conduz a autenticação até o AuthenticationOk e devolve o método que provou a senha.
async function autenticar(socket, leitor, alvo, senha) {
  let metodo = null
  let scram = null
  for (;;) {
    const { tipo, corpo } = await leitor.mensagem()
    if (tipo === 'E') throw falhaDoServidor(corpo, metodo, senha)
    if (tipo === 'N') continue
    if (tipo !== 'R' || corpo.length < 4) throw new FalhaFio('mensagem fora do protocolo')
    const codigo = corpo.readInt32BE(0)
    const dados = corpo.subarray(4)
    if (codigo === 0) {
      if (!metodo) throw new FalhaFio('o servidor não pediu senha (trust): o teste não prova a credencial')
      if (scram && !scram.provada) throw new FalhaFio('o servidor não provou a assinatura SCRAM')
      return metodo
    }
    if (codigo === 3) throw new FalhaFio('o servidor pediu a senha em texto puro: recusado, a senha não foi enviada')
    if (codigo === 5 && dados.length === 4) {
      metodo = 'MD5'
      socket.write(mensagem('p', respostaMd5(senha, alvo.usuario, dados)))
    } else if (codigo === 10) {
      if (!dados.toString('utf8').split('\0').includes('SCRAM-SHA-256')) throw new FalhaFio('método SASL sem suporte')
      metodo = 'SCRAM-SHA-256'
      const nonce = randomBytes(18).toString('base64')
      scram = { nonce, primeira: `n=,r=${nonce}`, assinatura: null, provada: false }
      const inicial = Buffer.from(`n,,${scram.primeira}`)
      const tamanho = Buffer.alloc(4)
      tamanho.writeInt32BE(inicial.length)
      socket.write(mensagem('p', textoC('SCRAM-SHA-256'), tamanho, inicial))
    } else if (codigo === 11 && scram && !scram.assinatura) {
      const { final, assinatura } = await provaScram(senha, scram.nonce, scram.primeira, dados.toString('utf8'))
      scram.assinatura = assinatura
      socket.write(mensagem('p', Buffer.from(final)))
    } else if (codigo === 12 && scram?.assinatura && !scram.provada) {
      const verificador = dados.toString('utf8').split(',')[0]
      const recebida = verificador.startsWith('v=') ? Buffer.from(verificador.slice(2), 'base64') : Buffer.alloc(0)
      if (recebida.length !== scram.assinatura.length || !timingSafeEqual(recebida, scram.assinatura)) throw new FalhaFio('o servidor não provou a assinatura SCRAM')
      scram.provada = true
    } else {
      throw new FalhaFio(`método de autenticação sem suporte (código ${codigo})`)
    }
  }
}

// MD5 da documentação: 'md5' + md5(md5(senha ‖ usuário) em hex ‖ sal) em hex, sem copiar a senha.
// O md5(senha ‖ usuário) vale a senha nesse método (é o que o servidor guarda): sai zerado, nas duas formas.
function respostaMd5(senha, usuario, sal) {
  const bruto = createHash('md5').update(senha).update(usuario, 'utf8').digest()
  const interno = hex(bruto)
  const externo = hex(createHash('md5').update(interno).update(sal).digest())
  for (const segredo of [bruto, interno]) segredo.fill(0)
  return Buffer.concat([Buffer.from('md5'), externo, Buffer.alloc(1)])
}
function hex(bytes) {
  const saida = Buffer.alloc(bytes.length * 2)
  for (let i = 0; i < bytes.length; i++) {
    saida[2 * i] = DIGITOS_HEX[bytes[i] >> 4]
    saida[2 * i + 1] = DIGITOS_HEX[bytes[i] & 15]
  }
  return saida
}

const hmac = (chave, texto) => createHmac('sha256', chave).update(texto).digest()
// SCRAM-SHA-256 do lado do cliente (RFC 5802 e 7677), sem channel binding (c=biws). Confere a
// primeira mensagem do servidor antes de derivar a chave e zera as chaves derivadas no fim.
export async function provaScram(senha, nonceCliente, primeiraCliente, primeiraServidor) {
  const recusa = (motivo) => new FalhaFio(`SCRAM recusado: ${motivo}`)
  if (primeiraServidor.startsWith('m=')) throw recusa('extensão obrigatória sem suporte')
  const [r, s, i] = primeiraServidor.split(',')
  if (!r?.startsWith('r=') || !s?.startsWith('s=') || !i?.startsWith('i=')) throw recusa('mensagem do servidor fora do formato')
  const nonce = r.slice(2)
  if (!nonce.startsWith(nonceCliente) || nonce.length === nonceCliente.length) throw recusa('nonce do servidor não estende o do cliente')
  const sal = Buffer.from(s.slice(2), 'base64')
  if (sal.length === 0 || sal.toString('base64') !== s.slice(2)) throw recusa('sal inválido')
  const iteracoes = i.slice(2)
  if (!/^[1-9][0-9]*$/.test(iteracoes) || Number(iteracoes) > MAX_ITERACOES) throw recusa('iterações fora do limite')
  const salgada = await pbkdf2Assincrono(senha, sal, Number(iteracoes), 32, 'sha256')
  const chaveCliente = hmac(salgada, 'Client Key')
  const guardada = createHash('sha256').update(chaveCliente).digest()
  const chaveServidor = hmac(salgada, 'Server Key')
  const semProva = `c=biws,r=${nonce}`
  const autenticacao = `${primeiraCliente},${primeiraServidor},${semProva}`
  const assinaturaCliente = hmac(guardada, autenticacao)
  const prova = Buffer.alloc(32)
  for (let k = 0; k < 32; k++) prova[k] = chaveCliente[k] ^ assinaturaCliente[k]
  const assinatura = hmac(chaveServidor, autenticacao)
  for (const chave of [salgada, chaveCliente, guardada, chaveServidor]) chave.fill(0)
  return { final: `${semProva},p=${prova.toString('base64')}`, assinatura }
}

// ErrorResponse: só o SQLSTATE (campo C) entra no detalhe; a mensagem (M) pode citar usuário e banco.
function falhaDoServidor(corpo, metodo, senha) {
  const campo = campoDoErro(corpo, 0x43)
  const sqlstate = /^[0-9A-Z]{5}$/.test(campo) ? campo : 'inválido'
  if (sqlstate !== '28P01') return new FalhaFio(`erro do servidor (SQLSTATE ${sqlstate})`)
  // No SCRAM, servidor e libpq passam a senha pelo SASLprep, que só mexe fora do ASCII; o teste não o
  // repete, então com byte acima de 0x7F a recusa pode ser só a normalização: fica inconclusiva.
  if (metodo === 'SCRAM-SHA-256' && senha.some((byte) => byte > 0x7f)) {
    return new FalhaFio('senha recusada (28P01), mas a senha tem caractere fora do ASCII e o teste não faz SASLprep: inconclusivo')
  }
  return new FalhaFio('senha recusada (28P01)', false)
}
function campoDoErro(corpo, campo) {
  for (let i = 0; i < corpo.length && corpo[i] !== 0;) {
    const fim = corpo.indexOf(0, i + 1)
    if (fim < 0) return ''
    if (corpo[i] === campo) return corpo.subarray(i + 1, fim).toString('latin1')
    i = fim + 1
  }
  return ''
}

// Depois do AuthenticationOk vêm parâmetros até o ReadyForQuery; aí vai o SELECT 1, que tem de voltar 1.
async function provar(socket, leitor, metodo, senha, comTls) {
  await ateProntoParaConsulta(leitor, metodo, senha, ['S', 'K', 'N'])
  socket.write(mensagem('Q', textoC('SELECT 1')))
  let um = false
  await ateProntoParaConsulta(leitor, metodo, senha, ['T', 'C', 'N', 'S'], (corpo) => { um = linhaComUm(corpo) })
  if (!um) return { ok: null, detalhe: 'o SELECT 1 não voltou 1' }
  return { ok: true, detalhe: `SELECT 1 respondido (${metodo}, ${comTls ? 'TLS' : 'sem TLS'})` }
}
async function ateProntoParaConsulta(leitor, metodo, senha, ignorados, aoDado = null) {
  for (;;) {
    const { tipo, corpo } = await leitor.mensagem()
    if (tipo === 'Z') return
    if (tipo === 'E') throw falhaDoServidor(corpo, metodo, senha)
    if (tipo === 'D' && aoDado) aoDado(corpo)
    else if (!ignorados.includes(tipo)) throw new FalhaFio('mensagem fora do protocolo')
  }
}
// DataRow com uma coluna de um byte: o texto '1'.
const linhaComUm = (corpo) => corpo.length === 7 && corpo.readInt16BE(0) === 1 && corpo.readInt32BE(2) === 1 && corpo[6] === 0x31

// Fecha com educação quando dá: Terminate ('X') pelo socket de cima e, depois, derruba a pilha toda.
// Socket que não ficou pronto (conectando, TLS no meio) só é derrubado.
function encerrar(pilha) {
  const derrubar = () => { for (const { socket } of pilha) socket.destroy() }
  const topo = pilha.at(-1)
  if (!topo?.pronto || topo.socket.destroyed || !topo.socket.writable) return derrubar()
  topo.socket.end(TERMINATE, derrubar)
}

const codigoSeguro = (erro) => (typeof erro?.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(erro.code) ? erro.code : 'erro')
```

```js arquivo=runtime/casa/testadores-cofre.mjs
// Testadores do cofre (§8.5): um teste ao vivo por tipo de credencial, que diz se o valor ainda abre
// a porta do serviço. O detalhe nunca leva o valor, e o valor só é aberto quando há testador. O
// Sentinel não tem teste automático: toda chamada vira log do lado deles. Conexão postgres:// vai ao
// testador de fio (postgres-fio.mjs), que recusa url fora do loopback ou com senha antes de abrir o valor.
import { alvoPostgres, testarPostgres } from './postgres-fio.mjs'

export const SEM_TESTE_SENTINEL = 'sem teste automático: toda chamada vira log do lado deles'
async function testarOpenai(valor, { fetch, limiteMs }) {
  let resposta
  try {
    resposta = await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${valor.toString('utf8').trim()}` }, signal: AbortSignal.timeout(limiteMs) })
  } catch (erro) {
    return { ok: null, detalhe: `sem resposta (${erro?.name ?? 'erro'})` }
  }
  try { await resposta.body?.cancel?.() } catch {}
  const detalhe = `HTTP ${resposta.status}`
  if (resposta.ok) return { ok: true, detalhe }
  if (resposta.status === 401 || resposta.status === 403) return { ok: false, detalhe }
  return { ok: null, detalhe }
}
const TESTADORES = new Map([['chave-api/openai', testarOpenai]])

// O valor só existe durante o teste e sai zerado, dê o que der.
async function comValor(obterValor, uso) {
  const valor = obterValor()
  try {
    return await uso(valor)
  } finally {
    valor.fill(0)
  }
}

export async function testarCredencial(credencial, obterValor, { fetch = globalThis.fetch, limiteMs = 10_000, net, tls } = {}) {
  if (credencial.servico === 'sentinel') return { ok: null, detalhe: SEM_TESTE_SENTINEL }
  if (credencial.tipo === 'conexao' && /^postgres(?:ql)?:\/\//i.test(credencial.url ?? '')) {
    const alvo = alvoPostgres(credencial.url, credencial.usuario)
    if (alvo.erro) return { ok: null, detalhe: alvo.erro }
    return comValor(obterValor, (valor) => testarPostgres(alvo, valor, { net, tls, limiteMs }))
  }
  const chave = `${credencial.tipo}/${credencial.servico ?? '-'}`
  const testador = TESTADORES.get(chave)
  if (!testador) return { ok: null, detalhe: `sem testador para ${chave}` }
  return comValor(obterValor, (valor) => testador(valor, { fetch, limiteMs }))
}
```

- [x] **Passo 4: extrair os módulos e ver o verde, com a CL junto.** A CL chega ao testador por dois caminhos: `runtime/cofre.mjs` importa o `testarCredencial`, e a própria CL importa o `SEM_TESTE_SENTINEL`. A LC não importa o testador nem o fio.

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so runtime/casa/postgres-fio.mjs runtime/casa/testadores-cofre.mjs
node --test --test-concurrency=1 --test-reporter=spec testes/casa-postgres-fio.test.mjs testes/casa-testadores-cofre.test.mjs testes/cofre-cli.test.mjs *> "$rascunho\p5-t3-verde.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\p5-t3-verde.txt" -Pattern '(tests|pass|fail) \d+\s*$'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `gravado runtime/casa/postgres-fio.mjs`, `gravado runtime/casa/testadores-cofre.mjs`, `tests 26` (PG 11, TC 6 e CL 9), `pass 26`, `fail 0`, `saida: 0` e `False`.

Resultado (06/11): `gravado runtime/casa/postgres-fio.mjs`, `gravado runtime/casa/testadores-cofre.mjs`, `tests 26`, `pass 26`, `fail 0`, `saida: 0` e `False`, com o stderr vazio e os 26 nomes conferidos (PG 11, TC 6 e CL 9). A CL passou inteira contra o testador novo.

**Mutação.** Trinta e dois mutantes: vinte e oito no fio e quatro no testador (17, 22, 27 e 29). O 17 e o 29 são o 13 e o 12 do plano 4, com o trecho igual (executor, item 16), e o 29 derruba também o CL 7. O trecho do 27 é parte do trecho do 22, mas cada mutante é aplicado sozinho. Os critérios são os da T1: derrubam a rodada o mutante que sobrevive sem estar declarado equivalente, a queda que não é `AssertionError` com `ERR_ASSERTION` e a queda em suíte fora das do mutante.

```json rascunho=mutantes-p5-t3.json
[
  { "nome": "01 host fora do loopback aceito", "arquivo": "runtime/casa/postgres-fio.mjs", "de": "LOOPBACK.get(u.hostname.toLowerCase())", "para": "(LOOPBACK.get(u.hostname.toLowerCase()) ?? u.hostname)", "teste": ["testes/casa-postgres-fio.test.mjs", "testes/casa-testadores-cofre.test.mjs"] },
  { "nome": "02 fio sem a guarda do loopback", "arquivo": "runtime/casa/postgres-fio.mjs", "de": "if (!HOSTS_LOOPBACK.has(alvo?.host)) return", "para": "if (false) return", "teste": ["testes/casa-postgres-fio.test.mjs"] },
  { "nome": "03 SSLRequest com o código do GSSENC", "arquivo": "runtime/casa/postgres-fio.mjs", "de": "0x16, 0x2f])", "para": "0x16, 0x30])", "teste": ["testes/casa-postgres-fio.test.mjs"] },
  { "nome": "04 nonce alheio aceito", "arquivo": "runtime/casa/postgres-fio.mjs", "de": "!nonce.startsWith(nonceCliente)", "para": "false", "teste": ["testes/casa-postgres-fio.test.mjs"] },
  { "nome": "05 assinatura do servidor sem conferência", "arquivo": "runtime/casa/postgres-fio.mjs", "de": " || !timingSafeEqual(recebida, scram.assinatura)", "para": "", "teste": ["testes/casa-postgres-fio.test.mjs"] },
  { "nome": "06 iterações fixas em 4096", "arquivo": "runtime/casa/postgres-fio.mjs", "de": "Number(iteracoes), 32, 'sha256'", "para": "4096, 32, 'sha256'", "teste": ["testes/casa-postgres-fio.test.mjs"] },
  { "nome": "07 iterações sem teto", "arquivo": "runtime/casa/postgres-fio.mjs", "de": " || Number(iteracoes) > MAX_ITERACOES", "para": "", "teste": ["testes/casa-postgres-fio.test.mjs"] },
  { "nome": "08 Client key minúsculo", "arquivo": "runtime/casa/postgres-fio.mjs", "de": "'Client Key'", "para": "'Client key'", "teste": ["testes/casa-postgres-fio.test.mjs"] },
  { "nome": "09 prova sem o XOR", "arquivo": "runtime/casa/postgres-fio.mjs", "de": "chaveCliente[k] ^ assinaturaCliente[k]", "para": "chaveCliente[k]", "teste": ["testes/casa-postgres-fio.test.mjs"] },
  { "nome": "10 MD5 com a ordem trocada", "arquivo": "runtime/casa/postgres-fio.mjs", "de": ".update(senha).update(usuario, 'utf8')", "para": ".update(usuario, 'utf8').update(senha)", "teste": ["testes/casa-postgres-fio.test.mjs"] },
  { "nome": "11 MD5 sem o prefixo", "arquivo": "runtime/casa/postgres-fio.mjs", "de": "Buffer.from('md5')", "para": "Buffer.from('')", "teste": ["testes/casa-postgres-fio.test.mjs"] },
  { "nome": "12 28P01 trocado", "arquivo": "runtime/casa/postgres-fio.mjs", "de": "sqlstate !== '28P01'", "para": "sqlstate !== '28P0X'", "teste": ["testes/casa-postgres-fio.test.mjs"] },
  { "nome": "13 trust aceito", "arquivo": "runtime/casa/postgres-fio.mjs", "de": "if (!metodo) throw", "para": "if (false) throw", "teste": ["testes/casa-postgres-fio.test.mjs"] },
  { "nome": "14 sem tempo-limite", "arquivo": "runtime/casa/postgres-fio.mjs", "de": "Promise.race([conversa, esgotou])", "para": "Promise.race([conversa])", "teste": ["testes/casa-postgres-fio.test.mjs"] },
  { "nome": "15 SELECT 1 sem conferir", "arquivo": "runtime/casa/postgres-fio.mjs", "de": "um = linhaComUm(corpo)", "para": "um = true", "teste": ["testes/casa-postgres-fio.test.mjs"] },
  { "nome": "16 sem Terminate", "arquivo": "runtime/casa/postgres-fio.mjs", "de": "end(TERMINATE, derrubar)", "para": "end(derrubar)", "teste": ["testes/casa-postgres-fio.test.mjs"] },
  { "nome": "17 valor do testador não zerado (plano 4, 13)", "arquivo": "runtime/casa/testadores-cofre.mjs", "de": "valor.fill(0)", "para": "void valor", "teste": ["testes/casa-testadores-cofre.test.mjs"] },
  { "nome": "18 TLS conferindo certificado", "arquivo": "runtime/casa/postgres-fio.mjs", "de": "rejectUnauthorized: false", "para": "rejectUnauthorized: true", "teste": ["testes/casa-postgres-fio.test.mjs"] },
  { "nome": "19 S ignorado", "arquivo": "runtime/casa/postgres-fio.mjs", "de": "if (resposta === 'S')", "para": "if (resposta === 'Z')", "teste": ["testes/casa-postgres-fio.test.mjs"] },
  { "nome": "20 ECONNREFUSED sem a pergunta do túnel", "arquivo": "runtime/casa/postgres-fio.mjs", "de": "erro?.code === 'ECONNREFUSED'", "para": "false", "teste": ["testes/casa-postgres-fio.test.mjs"] },
  { "nome": "21 senha em texto puro enviada", "arquivo": "runtime/casa/postgres-fio.mjs", "de": "throw new FalhaFio('o servidor pediu a senha em texto puro: recusado, a senha não foi enviada')", "para": "socket.write(mensagem('p', senha, Buffer.alloc(1)))", "teste": ["testes/casa-postgres-fio.test.mjs"] },
  { "nome": "22 conexão postgres:// fora do fio", "arquivo": "runtime/casa/testadores-cofre.mjs", "de": "credencial.tipo === 'conexao' && /^postgres", "para": "false && /^postgres", "teste": ["testes/casa-testadores-cofre.test.mjs"] },
  { "nome": "23 senha na url aceita", "arquivo": "runtime/casa/postgres-fio.mjs", "de": "if (u.password !== '') return", "para": "if (false) return", "teste": ["testes/casa-postgres-fio.test.mjs", "testes/casa-testadores-cofre.test.mjs"] },
  { "nome": "24 CR do fim conta", "arquivo": "runtime/casa/postgres-fio.mjs", "de": "valor[fim - 1] === 0x0a || valor[fim - 1] === 0x0d", "para": "valor[fim - 1] === 0x0a", "teste": ["testes/casa-postgres-fio.test.mjs"] },
  { "nome": "25 sucesso SCRAM sem a prova do servidor", "arquivo": "runtime/casa/postgres-fio.mjs", "de": "if (scram && !scram.provada) throw", "para": "if (false) throw", "teste": ["testes/casa-postgres-fio.test.mjs"] },
  { "nome": "26 resposta ao SSLRequest com lixo aceita", "arquivo": "runtime/casa/postgres-fio.mjs", "de": "pedaco.length !== 1", "para": "pedaco.length < 1", "teste": ["testes/casa-postgres-fio.test.mjs"] },
  { "nome": "27 qualquer tipo com url postgres:// vai ao fio", "arquivo": "runtime/casa/testadores-cofre.mjs", "de": "credencial.tipo === 'conexao' && ", "para": "", "teste": ["testes/casa-testadores-cofre.test.mjs"] },
  { "nome": "28 SASL sem exigir SCRAM-SHA-256", "arquivo": "runtime/casa/postgres-fio.mjs", "de": "!dados.toString('utf8').split('\\0').includes('SCRAM-SHA-256')", "para": "false", "teste": ["testes/casa-postgres-fio.test.mjs"] },
  { "nome": "29 Sentinel testado (plano 4, 12)", "arquivo": "runtime/casa/testadores-cofre.mjs", "de": "credencial.servico === 'sentinel'", "para": "false", "teste": ["testes/casa-testadores-cofre.test.mjs", "testes/cofre-cli.test.mjs"] },
  { "nome": "30 valor com cara de url aceito", "arquivo": "runtime/casa/postgres-fio.mjs", "de": "if (pareceUrl(senha)) return", "para": "if (false) return", "teste": ["testes/casa-postgres-fio.test.mjs"] },
  { "nome": "31 acento sem o inconclusivo", "arquivo": "runtime/casa/postgres-fio.mjs", "de": "senha.some((byte) => byte > 0x7f)", "para": "false", "teste": ["testes/casa-postgres-fio.test.mjs"] },
  { "nome": "32 nulo no usuário ou no banco aceito", "arquivo": "runtime/casa/postgres-fio.mjs", "de": "quem.includes('\\0') || banco.includes('\\0')", "para": "false", "teste": ["testes/casa-postgres-fio.test.mjs"] }
]
```

Mapa previsto de mutante para teste:

| Mutante | Morre em | Como cai |
|---|---|---|
| 01 | PG 8 e TC 5 | deepEqual: na PG, o caso `postgres://leitor@192.0.2.10:6543/banco`; na TC, o fio ainda recusa, mas o valor já foi aberto, e o último deepEqual dá `[1, 0]` |
| 02 | PG 8 | deepEqual: chamado direto com `192.0.2.10`, o fio tenta conectar e volta a pergunta do túnel |
| 03 | PG 2 e PG 9 | deepEqual |
| 04 | PG 4 | deepEqual (`nonceAlheio`) |
| 05 | PG 4 | deepEqual (`assinaturaFalsa`) |
| 06 | PG 2, PG 4, PG 9 e PG 11 | deepEqual; na PG 4, no caso `assinaturaFalsa` |
| 07 | PG 4 | deepEqual (`iteracoes: 1000001`) |
| 08 | PG 1, PG 2, PG 4, PG 9 e PG 11 | `equal` do vetor na PG 1; deepEqual nas outras, e na PG 4 no caso `assinaturaFalsa` |
| 09 | PG 1, PG 2, PG 4, PG 9 e PG 11 | como o 08 |
| 10 | PG 5 | deepEqual |
| 11 | PG 5 | deepEqual |
| 12 | PG 3 e PG 5 | deepEqual |
| 13 | PG 6 | deepEqual (`trust`) |
| 14 | PG 7 | `equal` ("o teste pendurou") |
| 15 | PG 11 | deepEqual |
| 16 | PG 2 e PG 7 | deepEqual na PG 2; `equal` na PG 7 |
| 17 | TC 1 e TC 6 | `ok` ("o valor foi zerado") |
| 18 | PG 9 | `equal` |
| 19 | PG 9 | deepEqual |
| 20 | PG 10 | deepEqual |
| 21 | PG 6 | deepEqual (`texto`) |
| 22 | TC 5 e TC 6 | deepEqual: a conexão cai em "sem testador para conexao/postgres" |
| 23 | PG 8 e TC 5 | deepEqual: na PG, o caso `postgresql://leitor:segredo@127.0.0.1:6543/banco`; na TC, a url com senha vai ao fio e volta a pergunta do túnel |
| 24 | PG 2 | deepEqual |
| 25 | PG 4 | deepEqual (`pularFinal`) |
| 26 | PG 9 | deepEqual |
| 27 | TC 5 | deepEqual: o tipo `senha` vai ao fio e volta a pergunta do túnel no lugar de "sem testador para senha/postgres" |
| 28 | PG 6 | deepEqual (`sasl-plus`) |
| 29 | TC 3 e CL 7 | deepEqual |
| 30 | PG 8 | deepEqual |
| 31 | PG 3 | deepEqual |
| 32 | PG 8 | deepEqual (`postgres://le%00itor@127.0.0.1/banco`) |

- [x] **Passo 5: extrair a lista e a tabela, e anotar os hashes.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so mutantes.mjs tabela-mutantes-p5.mjs mutantes-p5-t3.json
$alvos = 'runtime/casa/postgres-fio.mjs', 'runtime/casa/testadores-cofre.mjs', 'testes/casa-postgres-falso.mjs', 'testes/casa-postgres-fio.test.mjs', 'testes/casa-testadores-cofre.test.mjs'
$alvos | ForEach-Object { $_ + ' ' + (Get-FileHash $_ -Algorithm SHA256).Hash.Substring(0, 12) } | Set-Content -Encoding utf8 "$rascunho\hashes-antes-p5-t3.txt"
Get-Content "$rascunho\hashes-antes-p5-t3.txt"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `igual mutantes.mjs`, `igual tabela-mutantes-p5.mjs`, `gravado mutantes-p5-t3.json`, as cinco linhas de hash e `False`.

Resultado (06/11): `igual mutantes.mjs`, `igual tabela-mutantes-p5.mjs`, `gravado mutantes-p5-t3.json`, `runtime/casa/postgres-fio.mjs F1833675B0A3`, `runtime/casa/testadores-cofre.mjs 5EDAB3FBC942`, `testes/casa-postgres-falso.mjs 18E86B0189B5`, `testes/casa-postgres-fio.test.mjs 57469EB1E04C`, `testes/casa-testadores-cofre.test.mjs 800A2257D421` e `False`.

- [x] **Passo 6: rodar, em segundo plano.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
node "$rascunho\mutantes.mjs" "$rascunho\mutantes-p5-t3.json" *> "$rascunho\mutantes-p5-t3.txt"; "saida: $LASTEXITCODE"
```

Esperado: a última linha de `mutantes-p5-t3.txt` é `32 mutantes em … s; fora do vermelho: 0`, e `saida: 0`.

Resultado (06/11): `32 mutantes em 43 s; fora do vermelho: 0` e `saida: 0`, com o stderr vazio.

- [x] **Passo 7: a tabela, os hashes e a guarda.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
$alvos = 'runtime/casa/postgres-fio.mjs', 'runtime/casa/testadores-cofre.mjs', 'testes/casa-postgres-falso.mjs', 'testes/casa-postgres-fio.test.mjs', 'testes/casa-testadores-cofre.test.mjs'
node "$rascunho\tabela-mutantes-p5.mjs" "$rascunho\mutantes-p5-t3.json"; "saida: $LASTEXITCODE"
$depois = $alvos | ForEach-Object { $_ + ' ' + (Get-FileHash $_ -Algorithm SHA256).Hash.Substring(0, 12) }
Compare-Object (Get-Content "$rascunho\hashes-antes-p5-t3.txt") $depois
git status --short
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --conferir; "saida: $LASTEXITCODE"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `32 linhas: 32 vermelhos, 0 equivalente(s); testes mapeados: 51`, nenhuma linha `PROBLEMA` e `saida: 0`; o `Compare-Object` calado; no status, além dos ` M dist/…` de fim de linha (item 15), ` M runtime/casa/loja-cofre.mjs`, ` M runtime/casa/testadores-cofre.mjs`, ` M testes/casa-testadores-cofre.test.mjs`, `?? runtime/casa/postgres-fio.mjs`, `?? testes/casa-loja-cofre-gestao.test.mjs`, `?? testes/casa-postgres-falso.mjs`, `?? testes/casa-postgres-fio.test.mjs` e `?? docs/superpowers/plans/2026-11-06-f1-plano-5-card-cofre.md`; doze `igual` (os seis da T1, mais o apoio, a PG, a TC, o fio, o testador e a lista da T3) e `saida: 0`; e `False`. A tabela gerada (`$rascunho\mutantes-p5-t3.tabela.md`) entra no Apêndice B.

Resultado (06/11): `32 linhas: 32 vermelhos, 0 equivalente(s); testes mapeados: 51`, nenhuma linha `PROBLEMA` e `saida: 0`; o `Compare-Object` calado; no status, fora os ` M dist/…`, as oito linhas esperadas; doze `igual` e `saida: 0`; e `False`. Os 32 caíram nos testes previstos, conferidos pelo nome, e pela asserção prevista (`deepEqual`, `equal` ou `ok`, com a mensagem onde o mapa a cita); o 29 derrubou também o CL 7. Nenhuma linha do mapa mudou. O executor guarda só a primeira linha da mensagem do `deepStrictEqual`; por isso, numa conferência por fora dos passos, o 01, o 22, o 23 e o 27 foram aplicados de novo, um por vez, numa cópia de `runtime/` e `testes/`, e a TC mostrou o diff inteiro: no 01, `[1, 0]` no lugar de `[0, 0]`; no 22, "sem testador para conexao/postgres" na TC 5 e na TC 6; no 23 e no 27, a pergunta do túnel (`ECONNREFUSED`) no lugar da recusa da url com senha e de "sem testador para senha/postgres". O worktree não mudou, e a cópia foi apagada. A tabela está no Apêndice B.

### Task 4: os comandos novos da CLI

**Arquivos:** re-emitir inteiro `runtime/cofre.mjs`; modificar uma linha do `package.json`; criar `testes/cofre-cli-gestao.test.mjs` (CG, 10 testes). A partir desta tarefa, o rascunho é o `omni-f1b` desde o primeiro passo (executor, item 14). O bloco da CLI substitui o do plano 4: daqui em diante o `--conferir` do plano 4 dá `DIVERGE` em `runtime/cofre.mjs` (executor, item 16).

A CLI ganha dez comandos, cada um com a saída JSON de uma linha e os códigos de saída do plano 4: 0 no ok, 2 no erro de uso (com o texto de uso no stderr e o stdout vazio), 3 na recusa do cofre (`{ ok: false, codigo, erro }`) e 1 na falha inesperada. `historico` aceita `--id` ou `--nome`, nunca os dois; pelo nome, procura só entre as vivas, e pelo id vale também na lixeira (decisão 16). `saude` só abre blob com `--duplicatas`. `editar` recebe as mudanças num JSON (`--mudancas`), e o JSON torto é erro de uso. `rotacionar` lê o valor novo da primeira linha do stdin, como o `cadastrar`, e não aceita `--valor`. `lixeira` devolve a lista crua; os outros devolvem `ok: true` junto do que a loja devolveu.

A presença entra no `rodarCofre` injetada, como a ponte; sem injeção, a ponte do Hello (`criarPontePresenca`) só nasce no primeiro pedido. A mensagem do Hello leva o nome da credencial e diz o que vai acontecer ("mostrar" ou "copiar"), para o dono saber o que está autorizando.

O canal do dono é o descritor 3 (decisão 2), e `canalDoDono()` decide se ele está aberto pelo tipo, não só pela existência:
- conta como canal um pipe, um socket ou um arquivo; um dispositivo de caractere (o console, o nulo) não conta, nem o descritor interno do runtime, que no Linux é o epoll do libuv, sem bits de tipo;
- os bits de tipo vão por máscara (`mode & 0o170000`), porque o Node do Windows não define `S_IFIFO`: o `fstat` do pipe vem com `0o010000`, e mesmo assim o `isFIFO()` dá `false`. Com o `isFIFO()`, o revelar nunca funcionaria no Windows (mutante 11);
- escrever repete o `writeSync` até o fim (o `EAGAIN` do pipe não bloqueante espera) e fecha o descritor, para quem lê ver o fim.

O `revelar` confere o canal antes de qualquer coisa: sem ele, recusa com `sem-canal` sem pedir a digital nem abrir o blob. Com ele, a loja pede a presença e abre o valor, a CLI escreve no canal e zera o Buffer, e o stdout leva só `{ ok, nome, usoId }`. O `copiar` não toca o valor: a ponte copia, e a CLI devolve `{ ok, nome, usoId, limpaEm }`.

A CG prova cada comando numa casa temporária, com a ponte falsa (XOR com o prefixo `FALSO:`), a presença falsa e o canal falso, e prova o `canalDoDono` com um arquivo e com o dispositivo nulo. O CG 10 roda o `runtime/cofre.mjs` como processo, com a casa vazia: sem o `stdio[3]`, dá `sem-canal`; com `stdio[3] = 'pipe'`, passa do canal e para no `inexistente`, que a loja dá antes de pedir a presença (decisão 19). Nenhum Hello real é chamado.

O `package.json` fecha o furo do item 11: hoje o `npm run check` não passa `node --check` na presença nem no fio. O `mutante-sintaxe.mjs` do plano 4 mostra o furo antes da troca e o fechamento depois.

- [x] **Passo 1: o teste.**

```js arquivo=testes/cofre-cli-gestao.test.mjs
// CLI do cofre, comandos do plano 5: lixeira, edição, rotação, histórico, saúde e o caminho do dono
// (revelar pelo descritor 3 e copiar), com casa temporária, ponte, presença e canal de mentira. Nenhum
// teste chama o Windows Hello nem toca a área de transferência: os dois que rodam o arquivo direto
// param antes da presença, numa casa sem credencial.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { comBancoDaCasa } from '../runtime/casa/banco.mjs'
import { usarCredencial } from '../runtime/casa/loja-cofre.mjs'
import { canalDoDono, rodarCofre } from '../runtime/cofre.mjs'

const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const LIMPA_EM = '2026-11-07T12:00:30.000Z'

// A ponte de mentira da CL, com a cópia: abre o blob, zera o que abriu e devolve a resposta combinada.
function ponteFalsa({ copia = { ok: true, limpaEm: LIMPA_EM } } = {}) {
  const chamadas = { selar: 0, abrir: 0, copiar: 0 }
  const prefixo = Buffer.from('FALSO:')
  const xor = (bytes) => { const saida = Buffer.from(bytes); for (let i = 0; i < saida.length; i++) saida[i] ^= 0x5a; return saida }
  const abrirUm = (blob) => {
    const bytes = blob instanceof Uint8Array ? Buffer.from(blob) : null
    if (!bytes || !bytes.subarray(0, prefixo.length).equals(prefixo)) return { ok: false, erro: 'CryptographicException' }
    return { ok: true, valor: xor(bytes.subarray(prefixo.length)) }
  }
  return {
    chamadas,
    selar(valores) { chamadas.selar += 1; return valores.map((valor) => Buffer.concat([prefixo, xor(valor)])) },
    abrir(blobs) { chamadas.abrir += 1; return blobs.map(abrirUm) },
    abrirParaAreaDeTransferencia(blob) {
      chamadas.copiar += 1
      const aberto = abrirUm(blob)
      if (aberto.ok) aberto.valor.fill(0)
      return copia
    }
  }
}
function presencaFalsa(resposta = { ok: true, motivo: 'ok' }) {
  const mensagens = []
  return { mensagens, verificar(mensagem) { mensagens.push(mensagem); if (resposta instanceof Error) throw resposta; return resposta } }
}
function canalFalso(aberto) {
  const escritos = []; const originais = []
  return { escritos, originais, aberto: () => aberto, escrever(bytes) { escritos.push(Buffer.from(bytes)); originais.push(bytes) } }
}

function saidaFalsa() { return { texto: '', write(t) { this.texto += t; return true } } }
const entrada = (texto) => Readable.from([Buffer.from(texto, 'utf8')])
const ultimaLinha = (saida) => JSON.parse(saida.texto.trim().split('\n').at(-1))
async function comCasa(uso) {
  const casa = mkdtempSync(join(tmpdir(), 'omni-cofre-gestao-'))
  const env = { ...process.env, OMNI_HOME: casa, OMNI_CASA_BANCO: join(casa, 'casa') }
  try { return await uso(casa, env) } finally { rmSync(casa, { recursive: true, force: true }) }
}
async function rodar(env, argv, { stdin = '', ponte, presenca, canal = canalFalso(false) } = {}) {
  const saida = saidaFalsa(); const erro = saidaFalsa()
  const codigo = await rodarCofre(argv, { entrada: entrada(stdin), saida, erro, env, ponte, presenca, canal })
  return { codigo, saida, erro }
}
const cadastrar = (env, ponte, nome, valor) => rodar(env, ['cadastrar', '--nome', nome, '--tipo', 'senha'], { stdin: `${valor}\n`, ponte })
const noCofre = (casa, env, uso) => comBancoDaCasa(casa, 'cofre', uso, env)
const usos = (casa, env) => noCofre(casa, env, (db) => db.prepare('SELECT id, agente, motivo, resultado FROM usos ORDER BY rowid').all().map((linha) => ({ ...linha })))
async function recusa(env, argv, opcoes = {}) {
  const r = await rodar(env, argv, opcoes)
  assert.equal(r.codigo, 3, JSON.stringify(argv))
  return ultimaLinha(r.saida)
}
async function usoErrado(env, argv, opcoes = {}) {
  const r = await rodar(env, argv, opcoes)
  assert.equal(r.codigo, 2, JSON.stringify(argv))
  assert.ok(r.erro.texto.includes('uso: node runtime/cofre.mjs'))
  assert.equal(r.saida.texto, '')
  return r
}

test('apagar, lixeira, restaurar e esvaziar-lixeira', async () => comCasa(async (casa, env) => {
  const ponte = ponteFalsa()
  await cadastrar(env, ponte, 'servico-a', 'valor-a')
  const apagado = await rodar(env, ['apagar', '--nome', 'servico-a'])
  assert.equal(apagado.codigo, 0)
  const { ok, id, apagado_em: apagadoEm } = ultimaLinha(apagado.saida)
  assert.equal(ok, true)
  assert.deepEqual(ultimaLinha((await rodar(env, ['listar'])).saida), [])
  assert.deepEqual(ultimaLinha((await rodar(env, ['lixeira'])).saida).map((c) => [c.id, c.nome, c.apagado_em]), [[id, 'servico-a', apagadoEm]])
  assert.equal((await recusa(env, ['apagar', '--nome', 'servico-a'])).codigo, 'inexistente')
  assert.deepEqual(ultimaLinha((await rodar(env, ['esvaziar-lixeira'])).saida), { ok: true, apagadas: 0 })
  const volta = await rodar(env, ['restaurar', '--id', id])
  assert.equal(volta.codigo, 0)
  assert.deepEqual([ultimaLinha(volta.saida).ok, ultimaLinha(volta.saida).credencial?.id], [true, id])
  assert.deepEqual(ultimaLinha((await rodar(env, ['lixeira'])).saida), [])
  assert.equal((await recusa(env, ['restaurar', '--id', 'nao-e-id'])).codigo, 'dados-invalidos')
  await rodar(env, ['apagar', '--nome', 'servico-a'])
  noCofre(casa, env, (db) => db.prepare('UPDATE credenciais SET apagado_em = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', id))
  assert.deepEqual(ultimaLinha((await rodar(env, ['esvaziar-lixeira'])).saida), { ok: true, apagadas: 1 })
  assert.deepEqual(ultimaLinha((await rodar(env, ['lixeira'])).saida), [])
  for (const argv of [['apagar'], ['restaurar'], ['lixeira', '--tudo'], ['esvaziar-lixeira', '--forca']]) await usoErrado(env, argv)
}))

test('editar recebe as mudanças em JSON e devolve a credencial', async () => comCasa(async (casa, env) => {
  const ponte = ponteFalsa()
  await cadastrar(env, ponte, 'servico-a', 'valor-a')
  const mudancas = { servico: 'fal', agentes: ['omni', 'oraculo'], validade: '2027-01-01T00:00:00.000Z' }
  const r = await rodar(env, ['editar', '--nome', 'servico-a', '--mudancas', JSON.stringify(mudancas)])
  assert.equal(r.codigo, 0)
  const { ok, credencial } = ultimaLinha(r.saida)
  assert.deepEqual([ok, credencial.servico, credencial.agentes, credencial.validade, credencial.versao], [true, 'fal', ['omni', 'oraculo'], '2027-01-01T00:00:00.000Z', 2])
  const torto = await usoErrado(env, ['editar', '--nome', 'servico-a', '--mudancas', '{torto'])
  assert.ok(!torto.erro.texto.includes('torto'))
  await usoErrado(env, ['editar', '--nome', 'servico-a'])
  assert.equal((await recusa(env, ['editar', '--nome', 'servico-a', '--mudancas', '[]'])).codigo, 'dados-invalidos')
  assert.equal((await recusa(env, ['editar', '--nome', 'servico-a', '--mudancas', '{"nome":"outro"}'])).codigo, 'dados-invalidos')
  assert.equal((await recusa(env, ['editar', '--nome', 'servico-a', '--mudancas', '{"agentes":["dono"]}'])).codigo, 'agente-reservado')
  assert.equal((await recusa(env, ['editar', '--nome', 'nao-existe', '--mudancas', '{}'])).codigo, 'inexistente')
}))

test('rotacionar lê o valor novo só da primeira linha do stdin e não o devolve', async () => comCasa(async (casa, env) => {
  const ponte = ponteFalsa()
  await cadastrar(env, ponte, 'servico-a', 'valor-velho')
  const r = await rodar(env, ['rotacionar', '--nome', 'servico-a'], { stdin: 'valor-novo\r\nsegunda linha ignorada\n', ponte })
  assert.equal(r.codigo, 0)
  assert.ok(!r.saida.texto.includes('valor-novo'))
  assert.deepEqual([ultimaLinha(r.saida).ok, ultimaLinha(r.saida).credencial.versao], [true, 2])
  const valor = noCofre(casa, env, (db) => usarCredencial(db, ponte, { nome: 'servico-a', agente: 'omni', motivo: 'teste da rotacao' }).valor)
  assert.equal(valor.toString('utf8'), 'valor-novo')
  assert.equal((await recusa(env, ['rotacionar', '--nome', 'servico-a'], { stdin: '\n', ponte })).codigo, 'valor-vazio')
  assert.equal((await recusa(env, ['rotacionar', '--nome', 'nao-existe'], { stdin: 'v\n', ponte })).codigo, 'inexistente')
  await usoErrado(env, ['rotacionar'], { stdin: 'v\n', ponte })
  const noArgumento = await usoErrado(env, ['rotacionar', '--nome', 'servico-a', '--valor', 'segredo-no-argumento'], { ponte })
  assert.ok(!noArgumento.erro.texto.includes('segredo-no-argumento'))
}))

test('historico por nome ou por id, do mais novo ao mais velho, com limite; vale na lixeira', async () => comCasa(async (casa, env) => {
  const ponte = ponteFalsa()
  await cadastrar(env, ponte, 'servico-a', 'valor-a')
  for (const motivo of ['primeiro', 'segundo']) noCofre(casa, env, (db) => usarCredencial(db, ponte, { nome: 'servico-a', agente: 'omni', motivo }).valor.fill(0))
  const porNome = ultimaLinha((await rodar(env, ['historico', '--nome', 'servico-a'])).saida)
  assert.equal(porNome.ok, true)
  assert.deepEqual(porNome.usos.map((u) => [u.motivo, u.resultado]), [['segundo', 'entregue'], ['primeiro', 'entregue']])
  const [{ id }] = ultimaLinha((await rodar(env, ['listar'])).saida)
  assert.deepEqual(ultimaLinha((await rodar(env, ['historico', '--id', id])).saida), porNome)
  assert.deepEqual(ultimaLinha((await rodar(env, ['historico', '--id', id, '--limite', '1'])).saida).usos.map((u) => u.motivo), ['segundo'])
  for (const limite of ['0', 'abc', '501']) assert.equal((await recusa(env, ['historico', '--id', id, '--limite', limite])).codigo, 'dados-invalidos', limite)
  await rodar(env, ['apagar', '--nome', 'servico-a'])
  assert.equal((await recusa(env, ['historico', '--nome', 'servico-a'])).codigo, 'inexistente')
  assert.deepEqual(ultimaLinha((await rodar(env, ['historico', '--id', id])).saida), porNome)
  await usoErrado(env, ['historico'])
  await usoErrado(env, ['historico', '--id', id, '--nome', 'servico-a'])
}))

test('saude sem duplicata não abre blob; com --duplicatas, abre numa chamada e devolve só os nomes', async () => comCasa(async (casa, env) => {
  const ponte = ponteFalsa()
  await cadastrar(env, ponte, 'servico-a', 'mesmo-valor')
  await cadastrar(env, ponte, 'servico-b', 'mesmo-valor')
  await cadastrar(env, ponte, 'servico-c', 'outro-valor')
  const r = await rodar(env, ['saude'], { ponte })
  assert.equal(r.codigo, 0)
  assert.deepEqual(ultimaLinha(r.saida), { ok: true, total: 3, alertas: [], duplicatas: null })
  assert.equal(ponte.chamadas.abrir, 0)
  const d = await rodar(env, ['saude', '--duplicatas'], { ponte })
  assert.equal(d.codigo, 0)
  assert.deepEqual(ultimaLinha(d.saida), { ok: true, total: 3, alertas: [], duplicatas: { pares: [['servico-a', 'servico-b']], naoAbriram: [] } })
  assert.equal(ponte.chamadas.abrir, 1)
  assert.ok(!d.saida.texto.includes('mesmo-valor'))
  await usoErrado(env, ['saude', '--duplicatas=sim'], { ponte })
}))

test('revelar sem o canal recusa antes de pedir a presença e antes de abrir o blob', async () => comCasa(async (casa, env) => {
  const ponte = ponteFalsa()
  await cadastrar(env, ponte, 'teste-hello', 'valor-revelado')
  const presenca = presencaFalsa()
  const antes = usos(casa, env)
  assert.deepEqual(await recusa(env, ['revelar', '--nome', 'teste-hello'], { ponte, presenca, canal: canalFalso(false) }), {
    ok: false, codigo: 'sem-canal', erro: 'O revelar entrega o valor só pelo descritor 3, e ele não está aberto.'
  })
  assert.deepEqual(presenca.mensagens, [])
  assert.equal(ponte.chamadas.abrir, 0)
  assert.deepEqual(usos(casa, env), antes)
}))

test('revelar com o canal: o valor sai só pelo canal e é zerado; recusa, inexistente e presença que quebra', async () => comCasa(async (casa, env) => {
  const ponte = ponteFalsa()
  await cadastrar(env, ponte, 'teste-hello', 'valor-revelado')
  const presenca = presencaFalsa(); const canal = canalFalso(true)
  const r = await rodar(env, ['revelar', '--nome', 'teste-hello'], { ponte, presenca, canal })
  assert.equal(r.codigo, 0)
  const linha = ultimaLinha(r.saida)
  assert.deepEqual(Object.keys(linha), ['ok', 'nome', 'usoId'])
  assert.deepEqual([linha.ok, linha.nome], [true, 'teste-hello'])
  assert.deepEqual(canal.escritos.map((bytes) => bytes.toString('utf8')), ['valor-revelado'])
  assert.ok(canal.originais[0].every((byte) => byte === 0), 'o valor entregue ao canal foi zerado')
  assert.ok(!r.saida.texto.includes('valor-revelado') && !r.erro.texto.includes('valor-revelado'))
  assert.deepEqual(presenca.mensagens, ['Omni: mostrar a credencial teste-hello'])
  assert.deepEqual(usos(casa, env).at(-1), { id: linha.usoId, agente: 'dono', motivo: 'ver', resultado: 'revelado-ao-dono' })

  const cancelado = canalFalso(true)
  assert.deepEqual(await recusa(env, ['revelar', '--nome', 'teste-hello'], { ponte, presenca: presencaFalsa({ ok: false, motivo: 'cancelado' }), canal: cancelado }), {
    ok: false, codigo: 'sem-presenca', erro: 'A presença do dono não foi confirmada (cancelado).'
  })
  assert.deepEqual(cancelado.escritos, [])
  const ninguem = presencaFalsa()
  assert.equal((await recusa(env, ['revelar', '--nome', 'nao-existe'], { ponte, presenca: ninguem, canal: canalFalso(true) })).codigo, 'inexistente')
  assert.deepEqual(ninguem.mensagens, [])

  const quebrado = canalFalso(true)
  const q = await rodar(env, ['revelar', '--nome', 'teste-hello'], { ponte, presenca: presencaFalsa(new Error('hello quebrou')), canal: quebrado })
  assert.equal(q.codigo, 1)
  assert.ok(q.erro.texto.includes('falha inesperada no cofre: hello quebrou'))
  assert.deepEqual(quebrado.escritos, [])
  assert.equal(usos(casa, env).at(-1).resultado, 'recusado-presenca')
  const semNome = presencaFalsa()
  await usoErrado(env, ['revelar'], { ponte, presenca: semNome, canal: canalFalso(true) })
  assert.deepEqual(semNome.mensagens, [])
}))

test('copiar devolve só o uso e a hora da limpeza, nunca o valor', async () => comCasa(async (casa, env) => {
  const ponte = ponteFalsa()
  await cadastrar(env, ponte, 'teste-hello', 'valor-copiado')
  const presenca = presencaFalsa()
  const r = await rodar(env, ['copiar', '--nome', 'teste-hello'], { ponte, presenca })
  assert.equal(r.codigo, 0)
  const linha = ultimaLinha(r.saida)
  assert.deepEqual(linha, { ok: true, nome: 'teste-hello', usoId: linha.usoId, limpaEm: LIMPA_EM })
  assert.equal(typeof linha.usoId, 'string')
  assert.ok(!r.saida.texto.includes('valor-copiado') && !r.erro.texto.includes('valor-copiado'))
  assert.equal(ponte.chamadas.copiar, 1)
  assert.deepEqual(presenca.mensagens, ['Omni: copiar a credencial teste-hello'])
  assert.deepEqual(usos(casa, env).at(-1), { id: linha.usoId, agente: 'dono', motivo: 'copiar', resultado: 'copiado-ao-dono' })
  assert.deepEqual(await recusa(env, ['copiar', '--nome', 'teste-hello'], { ponte: ponteFalsa({ copia: { ok: false, erro: 'ocupada' } }), presenca }), {
    ok: false, codigo: 'nao-copiou', erro: 'teste-hello não foi copiada (ocupada).'
  })
  const naoConfirmou = ponteFalsa()
  assert.equal((await recusa(env, ['copiar', '--nome', 'teste-hello'], { ponte: naoConfirmou, presenca: presencaFalsa({ ok: false, motivo: 'tempo' }) })).codigo, 'sem-presenca')
  assert.equal(naoConfirmou.chamadas.copiar, 0)
}))

test('canalDoDono: arquivo aberto é canal, dispositivo não; escrever entrega tudo e fecha o descritor', () => comCasa(async (casa) => {
  const arquivo = join(casa, 'canal.bin')
  const canal = canalDoDono(openSync(arquivo, 'w'))
  assert.equal(canal.aberto(), true)
  canal.escrever(Buffer.from('valor pelo canal'))
  assert.equal(canal.aberto(), false, 'escrever fecha o descritor')
  assert.equal(readFileSync(arquivo, 'utf8'), 'valor pelo canal')
  const nulo = openSync(process.platform === 'win32' ? '\\\\.\\NUL' : '/dev/null', 'w')
  try { assert.equal(canalDoDono(nulo).aberto(), false, 'um dispositivo aberto, como o console, não é o canal') } finally { closeSync(nulo) }
}))

test('o arquivo roda direto: revelar sem o fd 3 dá sem-canal; com o fd 3 em pipe, chega ao cofre', () => comCasa(async (casa, env) => {
  const cofre = join(RAIZ, 'runtime', 'cofre.mjs')
  const opcoes = { env, encoding: 'utf8', windowsHide: true, timeout: 60_000 }
  const sem = spawnSync(process.execPath, [cofre, 'revelar', '--nome', 'nao-existe'], opcoes)
  assert.equal(sem.status, 3, sem.stderr)
  assert.equal(JSON.parse(sem.stdout.trim()).codigo, 'sem-canal')
  const com = spawnSync(process.execPath, [cofre, 'revelar', '--nome', 'nao-existe'], { ...opcoes, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] })
  assert.equal(com.status, 3, com.stderr)
  assert.equal(JSON.parse(com.stdout.trim()).codigo, 'inexistente')
}))
```

- [x] **Passo 2: reunir os rascunhos, extrair o teste e ver o vermelho.** A lista da T1, a da T3 e a sonda da T2 moram no `omni-f1` e vêm para o `omni-f1b`, para o `--conferir` do Passo 9 achar todos os blocos `rascunho=` num lugar só. Ler do `omni-f1` funciona; só o nome `mutantes.mjs` de lá está preso (T2, Passo 5).

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$antigo = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
foreach ($a in 'mutantes-p5-t1.json', 'mutantes-p5-t3.json', 'sondar-t2.mjs') { Copy-Item (Join-Path $antigo $a) (Join-Path $rascunho $a) }
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so testes/cofre-cli-gestao.test.mjs
node --test --test-concurrency=1 --test-reporter=spec testes/cofre-cli-gestao.test.mjs *> "$rascunho\p5-t4-vermelho.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\p5-t4-vermelho.txt" -Pattern 'does not provide an export', '(tests|pass|fail) \d+\s*$'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `gravado testes/cofre-cli-gestao.test.mjs`, `saida: 1`, `does not provide an export named 'canalDoDono'`, `tests 1`, `pass 0`, `fail 1` e `False`.

Resultado (07/11): a guarda deu `False` antes; `gravado testes/cofre-cli-gestao.test.mjs`, `saida: 1`, o `SyntaxError` de `../runtime/cofre.mjs`, que não exporta `canalDoDono`, `tests 1`, `pass 0`, `fail 1` e `False`.

- [x] **Passo 3: a CLI.** O arquivo inteiro, com o plano 4 dentro; o que muda são os imports, o `USO`, a `MENSAGEM_HELLO`, o `canalDoDono`, a presença no `rodarCofre` e os dez `case` novos.

```js arquivo=runtime/cofre.mjs
// Linha de comando do cofre do Omni (§8.1 a §8.4). Segredo nunca entra por argumento: o valor
// da credencial e a frase-mestra chegam pela primeira linha do stdin, e o executar entrega o valor
// ao processo filho numa variável de ambiente. O stdin só é tocado por quem lê; no executar ele
// fica intocado e o filho o herda. A saída é JSON numa linha e nunca leva o valor: o revelar entrega
// o valor ao dono só pelo descritor 3, e o copiar o põe na área de transferência sem passar por aqui.
// Códigos de saída: 0 ok; 2 uso errado; 3 recusa do cofre; 1 falha inesperada (vai para degradacoes.jsonl).
import { spawn } from 'node:child_process'
import { closeSync, fstatSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { comBancoDaCasa, registrarDegradacao } from './casa/banco.mjs'
import { criarPonteDpapi } from './casa/dpapi.mjs'
import {
  CofreError, apagarCredencial, cadastrarCredencial, copiarAoDono, credencialPorNome, editarCredencial, esvaziarLixeira, exportarCofre,
  historicoCredencial, importarPacoteCofre, importarPastaDpapi, listarCredenciais, listarLixeira, registrarInventarioWindows, registrarTeste,
  restaurarCredencial, revelarAoDono, rotacionarCredencial, saudeCofre, usarCredencial
} from './casa/loja-cofre.mjs'
import { PacoteCofreError } from './casa/pacote-cofre.mjs'
import { criarPontePresenca } from './casa/presenca.mjs'
import { testarCredencial } from './casa/testadores-cofre.mjs'

const USO = `uso: node runtime/cofre.mjs <comando> [opções]
  listar
  cadastrar --nome <n> --tipo <t> [--servico <s>] [--url <u>] [--usuario <u>] [--notas <n>] [--agentes <a,b>]   (valor pelo stdin)
  importar-dpapi [--pasta <pasta>] [--classificacao <arquivo.json>]
  inventario-windows
  exportar --saida <arquivo>   (frase-mestra pelo stdin)
  importar-pacote --arquivo <arquivo>   (frase-mestra pelo stdin)
  testar --nome <n>
  executar --nome <n> --variavel <VAR> --motivo <m> [--agente omni] [--sessao <s>] -- <comando> [args...]
  historico (--id <id> | --nome <n>) [--limite <1-500>]
  saude [--duplicatas]
  editar --nome <n> --mudancas <json>
  rotacionar --nome <n>   (valor novo pelo stdin)
  apagar --nome <n>
  restaurar --id <id>
  lixeira
  esvaziar-lixeira
  revelar --nome <n>   (Windows Hello; o valor sai só pelo descritor 3)
  copiar --nome <n>   (Windows Hello; a área de transferência limpa em 30 s)`
const VARIAVEL = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const LIMITE_LINHA = 64 * 1024
const MENSAGEM_HELLO = { ver: (nome) => `Omni: mostrar a credencial ${nome}`, copiar: (nome) => `Omni: copiar a credencial ${nome}` }
class UsoError extends Error {}

export function casaDoCofre(env = process.env) {
  if (env.OMNI_HOME) return resolve(env.OMNI_HOME)
  if (env.APPDATA) return join(env.APPDATA, 'omni')
  return join(homedir(), '.omni')
}

// O canal do dono é o descritor 3: quem roda a CLI num shell captura stdout e stderr, não o fd 3. Só
// conta como aberto um pipe, um socket ou um arquivo, para o descritor interno do runtime (no Linux,
// o epoll do libuv, sem bits de tipo) não passar por canal. Os bits de tipo vão por máscara porque o
// Node do Windows não define S_IFIFO, e o isFIFO() dá false para o pipe que ele mesmo marca com 0o010000.
// Escrever fecha o descritor, e quem lê vê o fim.
const TIPOS_DE_CANAL = new Set([0o010000, 0o140000, 0o100000])   // pipe, socket, arquivo
export function canalDoDono(fd = 3) {
  return {
    aberto() {
      try { return TIPOS_DE_CANAL.has(fstatSync(fd).mode & 0o170000) } catch { return false }
    },
    escrever(bytes) {
      try {
        let feito = 0; let esperas = 0
        while (feito < bytes.length) {
          try { feito += writeSync(fd, bytes, feito, bytes.length - feito) } catch (falha) {
            if (falha.code !== 'EAGAIN' || ++esperas > 10_000) throw falha
          }
        }
      } finally { try { closeSync(fd) } catch { /* já fechado */ } }
    }
  }
}

function lerOpcoes(argumentos, opcoes, obrigatorias = []) {
  let lidas
  try { lidas = parseArgs({ args: argumentos, options: opcoes, strict: true, allowPositionals: false }).values }
  catch (erro) { throw new UsoError(`opções inválidas (${erro.code ?? erro.name})`) }   // nunca ecoa o argumento
  for (const nome of obrigatorias) if (lidas[nome] === undefined || lidas[nome] === '') throw new UsoError(`falta --${nome}`)
  return lidas
}
async function linhaDaEntrada(entrada) {
  const pedacos = []; let total = 0
  try {
    for await (const pedaco of entrada) {
      const bytes = Buffer.isBuffer(pedaco) ? pedaco : Buffer.from(pedaco)
      pedacos.push(bytes); total += bytes.length
      if (bytes.includes(10)) break
      if (total > LIMITE_LINHA) throw new UsoError('a linha do stdin passou de 64 KB')
    }
    const tudo = Buffer.concat(pedacos)
    try {
      let fim = tudo.indexOf(10); if (fim === -1) fim = tudo.length
      if (fim > 0 && tudo[fim - 1] === 13) fim -= 1
      const inicio = tudo[0] === 0xef && tudo[1] === 0xbb && tudo[2] === 0xbf ? 3 : 0
      return Buffer.from(tudo.subarray(inicio, Math.max(inicio, fim)))
    } finally { tudo.fill(0) }
  } finally { for (const pedaco of pedacos) pedaco.fill(0) }
}
function lerClassificacao(arquivo) {
  if (arquivo === undefined) return {}
  try { return JSON.parse(readFileSync(arquivo, 'utf8').replace(/^﻿/, '')) } catch { throw new UsoError('não consegui ler a classificação (JSON)') }
}

export async function rodarCofre(argv, { entrada, saida = process.stdout, erro = process.stderr, env = process.env, ponte, presenca, canal = canalDoDono(), fetch = globalThis.fetch, executar = spawn } = {}) {
  const casa = casaDoCofre(env)
  let ponteViva = ponte
  let presencaViva = presenca
  const daPonte = () => (ponteViva ??= criarPonteDpapi())
  const daPresenca = (mensagem) => () => (presencaViva ??= criarPontePresenca()).verificar(mensagem)
  const comCofre = (uso) => comBancoDaCasa(casa, 'cofre', uso, env)   // uso síncrono
  const lerLinha = () => linhaDaEntrada(entrada ?? process.stdin)
  const escrever = (objeto) => saida.write(`${JSON.stringify(objeto)}\n`)
  const [comando, ...resto] = argv
  try {
    switch (comando) {
      case 'listar': { lerOpcoes(resto, {}); escrever(comCofre((db) => listarCredenciais(db))); return 0 }
      case 'cadastrar': {
        const o = lerOpcoes(resto, { nome: { type: 'string' }, tipo: { type: 'string' }, servico: { type: 'string' }, url: { type: 'string' }, usuario: { type: 'string' }, notas: { type: 'string' }, agentes: { type: 'string' } }, ['nome', 'tipo'])
        const valor = await lerLinha()
        try {
          const dados = { nome: o.nome, tipo: o.tipo, servico: o.servico, url: o.url, usuario: o.usuario, notas: o.notas, agentes: o.agentes === undefined ? undefined : o.agentes.split(',').map((a) => a.trim()).filter(Boolean) }
          escrever({ ok: true, credencial: comCofre((db) => cadastrarCredencial(db, daPonte(), dados, valor)) })
          return 0
        } finally { valor.fill(0) }
      }
      case 'importar-dpapi': {
        const o = lerOpcoes(resto, { pasta: { type: 'string' }, classificacao: { type: 'string' } })
        const classificacao = lerClassificacao(o.classificacao)
        const r = comCofre((db) => importarPastaDpapi(db, daPonte(), o.pasta ?? join(casa, 'access'), { classificacao }))
        escrever({ ok: true, importadas: r.importadas, resultados: r.resultados }); return 0
      }
      case 'inventario-windows': {
        lerOpcoes(resto, {})
        const entradas = daPonte().inventariarGerenciador()   // fora da conexão
        escrever({ ok: true, ...comCofre((db) => registrarInventarioWindows(db, entradas)) }); return 0
      }
      case 'exportar': {
        const o = lerOpcoes(resto, { saida: { type: 'string' } }, ['saida'])
        const destino = resolve(o.saida)
        const fraseBytes = await lerLinha()
        let descritor = null; let gravado = false
        try {
          try { descritor = openSync(destino, 'wx', 0o600) } catch (falha) {
            if (falha.code === 'EEXIST') throw new CofreError('saida-existe', 'O arquivo de saída já existe; o cofre não sobrescreve pacote.')
            throw falha
          }
          const r = comCofre((db) => exportarCofre(db, daPonte(), fraseBytes.toString('utf8')))
          writeSync(descritor, r.texto); gravado = true
          escrever({ ok: true, saida: destino, credenciais: r.credenciais, recadastrar: r.recadastrar }); return 0
        } finally {
          fraseBytes.fill(0)
          if (descritor !== null) closeSync(descritor)
          if (descritor !== null && !gravado) rmSync(destino, { force: true })
        }
      }
      case 'importar-pacote': {
        const o = lerOpcoes(resto, { arquivo: { type: 'string' } }, ['arquivo'])
        let texto
        try { texto = readFileSync(o.arquivo, 'utf8') } catch { throw new UsoError('não consegui ler o pacote') }
        const fraseBytes = await lerLinha()
        try { escrever({ ok: true, ...comCofre((db) => importarPacoteCofre(db, daPonte(), texto, fraseBytes.toString('utf8'))) }); return 0 }
        finally { fraseBytes.fill(0) }
      }
      case 'testar': {
        const o = lerOpcoes(resto, { nome: { type: 'string' } }, ['nome'])
        const credencial = comCofre((db) => credencialPorNome(db, o.nome))
        if (!credencial) throw new CofreError('inexistente', `Não há credencial com o nome ${o.nome}.`)
        const obterValor = () => comCofre((db) => usarCredencial(db, daPonte(), { nome: o.nome, agente: 'omni', motivo: 'teste do cofre' }).valor)
        const resultado = await testarCredencial(credencial, obterValor, { fetch })   // fetch fora da conexão
        comCofre((db) => registrarTeste(db, o.nome, resultado))
        escrever({ ok: true, nome: o.nome, teste: resultado }); return 0
      }
      case 'executar': {
        const separador = resto.indexOf('--')
        if (separador === -1 || separador === resto.length - 1) throw new UsoError('falta o comando depois de --')
        const o = lerOpcoes(resto.slice(0, separador), { nome: { type: 'string' }, variavel: { type: 'string' }, motivo: { type: 'string' }, agente: { type: 'string' }, sessao: { type: 'string' } }, ['nome', 'variavel', 'motivo'])
        if (!VARIAVEL.test(o.variavel)) throw new UsoError('variável de ambiente inválida')
        const [programa, ...argumentos] = resto.slice(separador + 1)
        const { valor } = comCofre((db) => usarCredencial(db, daPonte(), { nome: o.nome, agente: o.agente ?? 'omni', motivo: o.motivo, sessao: o.sessao ?? null }))
        let filhoEnv
        try { filhoEnv = { ...env, [o.variavel]: valor.toString('utf8') } } finally { valor.fill(0) }
        return await new Promise((resolver) => {
          const filho = executar(programa, argumentos, { stdio: 'inherit', env: filhoEnv, windowsHide: true, shell: false })
          filho.on('error', () => resolver(1))
          filho.on('exit', (codigo, sinal) => resolver(codigo ?? (sinal ? 1 : 0)))
        })
      }
      case 'historico': {
        const o = lerOpcoes(resto, { id: { type: 'string' }, nome: { type: 'string' }, limite: { type: 'string' } })
        if ((o.id === undefined) === (o.nome === undefined)) throw new UsoError('use --id ou --nome, um dos dois')
        const opcoes = o.limite === undefined ? {} : { limite: Number(o.limite) }
        const usos = comCofre((db) => {
          const id = o.id ?? credencialPorNome(db, o.nome)?.id
          if (id === undefined) throw new CofreError('inexistente', `Não há credencial com o nome ${o.nome}.`)
          return historicoCredencial(db, id, opcoes)
        })
        escrever({ ok: true, usos }); return 0
      }
      case 'saude': {
        const o = lerOpcoes(resto, { duplicatas: { type: 'boolean' } })
        const duplicatas = o.duplicatas === true
        escrever({ ok: true, ...comCofre((db) => saudeCofre(db, { ponte: duplicatas ? daPonte() : null, duplicatas })) }); return 0
      }
      case 'editar': {
        const o = lerOpcoes(resto, { nome: { type: 'string' }, mudancas: { type: 'string' } }, ['nome', 'mudancas'])
        let mudancas
        try { mudancas = JSON.parse(o.mudancas) } catch { throw new UsoError('--mudancas precisa ser um JSON') }
        escrever({ ok: true, credencial: comCofre((db) => editarCredencial(db, o.nome, mudancas)) }); return 0
      }
      case 'rotacionar': {
        const o = lerOpcoes(resto, { nome: { type: 'string' } }, ['nome'])
        const valor = await lerLinha()
        try { escrever({ ok: true, credencial: comCofre((db) => rotacionarCredencial(db, daPonte(), o.nome, valor)) }); return 0 }
        finally { valor.fill(0) }
      }
      case 'apagar': {
        const o = lerOpcoes(resto, { nome: { type: 'string' } }, ['nome'])
        escrever({ ok: true, ...comCofre((db) => apagarCredencial(db, o.nome)) }); return 0
      }
      case 'restaurar': {
        const o = lerOpcoes(resto, { id: { type: 'string' } }, ['id'])
        escrever({ ok: true, credencial: comCofre((db) => restaurarCredencial(db, o.id)) }); return 0
      }
      case 'lixeira': { lerOpcoes(resto, {}); escrever(comCofre((db) => listarLixeira(db))); return 0 }
      case 'esvaziar-lixeira': { lerOpcoes(resto, {}); escrever({ ok: true, ...comCofre((db) => esvaziarLixeira(db)) }); return 0 }
      case 'revelar': {
        const o = lerOpcoes(resto, { nome: { type: 'string' } }, ['nome'])
        // Sem o canal, recusa antes de pedir a digital: o Hello não abre à toa.
        if (!canal.aberto()) throw new CofreError('sem-canal', 'O revelar entrega o valor só pelo descritor 3, e ele não está aberto.')
        const { valor, usoId } = comCofre((db) => revelarAoDono(db, daPonte(), daPresenca(MENSAGEM_HELLO.ver(o.nome)), o.nome))
        try { canal.escrever(valor) } finally { valor.fill(0) }
        escrever({ ok: true, nome: o.nome, usoId }); return 0
      }
      case 'copiar': {
        const o = lerOpcoes(resto, { nome: { type: 'string' } }, ['nome'])
        escrever({ ok: true, nome: o.nome, ...comCofre((db) => copiarAoDono(db, daPonte(), daPresenca(MENSAGEM_HELLO.copiar(o.nome)), o.nome)) }); return 0
      }
      default: throw new UsoError(comando === undefined ? 'falta o comando' : 'comando desconhecido')
    }
  } catch (falha) {
    if (falha instanceof UsoError) { erro.write(`${falha.message}\n${USO}\n`); return 2 }
    if (falha instanceof CofreError || falha instanceof PacoteCofreError) { escrever({ ok: false, codigo: falha.code, erro: falha.message }); return 3 }
    registrarDegradacao(casa, 'cofre.cli', falha, env)
    erro.write(`falha inesperada no cofre: ${String(falha?.message ?? falha).slice(0, 300)}\n`)
    return 1
  }
}

const direto = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (direto) process.exitCode = await rodarCofre(process.argv.slice(2))
```

- [x] **Passo 4: extrair a CLI e ver o verde, com a CL junto.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so runtime/cofre.mjs
node --check runtime/cofre.mjs; "check: $LASTEXITCODE"
node --test --test-concurrency=1 --test-reporter=spec testes/cofre-cli-gestao.test.mjs testes/cofre-cli.test.mjs *> "$rascunho\p5-t4-verde.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\p5-t4-verde.txt" -Pattern '(tests|pass|fail) \d+\s*$'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `gravado runtime/cofre.mjs`, `check: 0`, `tests 19` (CG 10 e CL 9), `pass 19`, `fail 0`, `saida: 0` e `False`.

Resultado (07/11): `gravado runtime/cofre.mjs`, `check: 0`, `tests 19`, `pass 19`, `fail 0`, os dezenove ✔ no spec, `saida: 0`, o stderr vazio e `False`.

- [x] **Passo 5: o furo do `check`.** O `mutante-sintaxe.mjs` sai do plano 4, sem mudança: acrescenta `export const = 1` ao arquivo, roda o `npm run check` e restaura o arquivo sempre.

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
node "$rascunho\extrair-do-plano.mjs" docs\superpowers\plans\2026-11-06-f1-plano-4-cofre.md . $rascunho --so mutante-sintaxe.mjs
foreach ($alvo in 'runtime/casa/presenca.mjs', 'runtime/casa/postgres-fio.mjs') { node "$rascunho\mutante-sintaxe.mjs" . $alvo }
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `gravado mutante-sintaxe.mjs`; para os dois, `status 0; SyntaxError: false` e `restaurado: true`. É o furo: sintaxe quebrada passa no `check`. E `False`.

Resultado (07/11): `gravado mutante-sintaxe.mjs`; a presença e o fio deram `status 0; SyntaxError: false; aponta: (nenhuma linha cita o arquivo)`, com `restaurado: true` (`9b2d0e9ba732` e `f1833675b0a3`); e `False`. O furo existia.

- [x] **Passo 6: fechar o furo.** No `package.json`, no script `check`, trocar

```text
node --check runtime/cofre.mjs &&node --check runtime/contexto.mjs
```

por

```text
node --check runtime/cofre.mjs && node --check runtime/casa/presenca.mjs && node --check runtime/casa/postgres-fio.mjs &&node --check runtime/contexto.mjs
```

O trecho aparece uma vez só no arquivo, e o `&&node` sem espaço vem do original: a troca não o corrige, para o diff ficar numa linha.

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$alvos = 'runtime/casa/presenca.mjs', 'runtime/casa/postgres-fio.mjs'
foreach ($alvo in $alvos) { 'linhas de ' + $alvo + ': ' + (Get-Content $alvo).Count; node "$rascunho\mutante-sintaxe.mjs" . $alvo }
npm run check *> "$rascunho\p5-t4-check.txt"; "saida: $LASTEXITCODE"
git diff --numstat -- package.json
foreach ($a in @('package.json', 'runtime/cofre.mjs', 'testes/cofre-cli-gestao.test.mjs') + $alvos) { $a + ' CR: ' + ([IO.File]::ReadAllText((Resolve-Path $a)).Split([char]13).Count - 1) }
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: para os dois, `status 1; SyntaxError: true`, apontando a linha (total + 2) do próprio arquivo, e `restaurado: true` com o mesmo hash do Passo 5; o `npm run check` com `saida: 0`; numstat `1	1	package.json`; CR 0 nos cinco; e `False`.

Resultado (07/11): `linhas de runtime/casa/presenca.mjs: 59`, `status 1; SyntaxError: true`, apontando `presenca.mjs:61`, `restaurado: true (9b2d0e9ba732)`; `linhas de runtime/casa/postgres-fio.mjs: 338`, `status 1; SyntaxError: true`, apontando `postgres-fio.mjs:340`, `restaurado: true (f1833675b0a3)`; o `npm run check` com `saida: 0`, typecheck incluso; numstat `1	1	package.json`; CR 0 nos cinco; e `False`. No stderr, só o aviso de LF para CRLF do `package.json`, que é do Git e não muda o arquivo.

**Mutação.** Vinte e seis mutantes, todos na CLI, com os critérios da T1. O 13 é equivalente declarado: o `writeSync` em arquivo e no pipe do Windows escreve tudo de uma vez, e o laço só pesa no pipe não bloqueante que devolve `EAGAIN`, que a suíte não fabrica. O 11 só morre no Windows, onde o `isFIFO()` falha no pipe; a rodada oficial é no Windows. O 26 roda também a CL, que fica verde: os comandos do plano 4 não mudam.

```json rascunho=mutantes-p5-t4.json
[
  { "nome": "01 revelar sem conferir o canal", "arquivo": "runtime/cofre.mjs", "de": "if (!canal.aberto()) throw new CofreError('sem-canal'", "para": "if (false) throw new CofreError('sem-canal'", "teste": ["testes/cofre-cli-gestao.test.mjs"] },
  { "nome": "02 canal conferido depois da presença", "arquivo": "runtime/cofre.mjs", "de": "        if (!canal.aberto()) throw new CofreError('sem-canal', 'O revelar entrega o valor só pelo descritor 3, e ele não está aberto.')\n        const { valor, usoId } = comCofre((db) => revelarAoDono(db, daPonte(), daPresenca(MENSAGEM_HELLO.ver(o.nome)), o.nome))", "para": "        const { valor, usoId } = comCofre((db) => revelarAoDono(db, daPonte(), daPresenca(MENSAGEM_HELLO.ver(o.nome)), o.nome))\n        if (!canal.aberto()) throw new CofreError('sem-canal', 'O revelar entrega o valor só pelo descritor 3, e ele não está aberto.')", "teste": ["testes/cofre-cli-gestao.test.mjs"] },
  { "nome": "03 valor revelado sem zerar", "arquivo": "runtime/cofre.mjs", "de": "try { canal.escrever(valor) } finally { valor.fill(0) }", "para": "canal.escrever(valor)", "teste": ["testes/cofre-cli-gestao.test.mjs"] },
  { "nome": "04 valor revelado vai pelo stderr", "arquivo": "runtime/cofre.mjs", "de": "try { canal.escrever(valor) }", "para": "try { erro.write(valor) }", "teste": ["testes/cofre-cli-gestao.test.mjs"] },
  { "nome": "05 saída do revelar leva o valor", "arquivo": "runtime/cofre.mjs", "de": "escrever({ ok: true, nome: o.nome, usoId }); return 0", "para": "escrever({ ok: true, nome: o.nome, usoId, valor: valor.toString('utf8') }); return 0", "teste": ["testes/cofre-cli-gestao.test.mjs"] },
  { "nome": "06 mensagem do Hello sem o nome", "arquivo": "runtime/cofre.mjs", "de": "ver: (nome) => `Omni: mostrar a credencial ${nome}`", "para": "ver: () => 'Omni: mostrar a credencial'", "teste": ["testes/cofre-cli-gestao.test.mjs"] },
  { "nome": "07 copiar pede o Hello com a mensagem do ver", "arquivo": "runtime/cofre.mjs", "de": "daPresenca(MENSAGEM_HELLO.copiar(o.nome))", "para": "daPresenca(MENSAGEM_HELLO.ver(o.nome))", "teste": ["testes/cofre-cli-gestao.test.mjs"] },
  { "nome": "08 presença ignora a injetada", "arquivo": "runtime/cofre.mjs", "de": "const daPresenca = (mensagem) => () => (presencaViva ??= criarPontePresenca()).verificar(mensagem)", "para": "const daPresenca = (mensagem) => () => criarPontePresenca({ executar: () => ({ status: 0, stdout: 'resultado Verified\\n' }) }).verificar(mensagem)", "teste": ["testes/cofre-cli-gestao.test.mjs"] },
  { "nome": "09 canal padrão sempre aberto", "arquivo": "runtime/cofre.mjs", "de": "canal = canalDoDono(), fetch", "para": "canal = { aberto: () => true, escrever() {} }, fetch", "teste": ["testes/cofre-cli-gestao.test.mjs"] },
  { "nome": "10 canal aceita qualquer descritor aberto", "arquivo": "runtime/cofre.mjs", "de": "try { return TIPOS_DE_CANAL.has(fstatSync(fd).mode & 0o170000) } catch { return false }", "para": "try { fstatSync(fd); return true } catch { return false }", "teste": ["testes/cofre-cli-gestao.test.mjs"] },
  { "nome": "11 canal pelo isFIFO do Node", "arquivo": "runtime/cofre.mjs", "de": "try { return TIPOS_DE_CANAL.has(fstatSync(fd).mode & 0o170000) } catch { return false }", "para": "try { const estado = fstatSync(fd); return estado.isFIFO() || estado.isSocket() || estado.isFile() } catch { return false }", "teste": ["testes/cofre-cli-gestao.test.mjs"] },
  { "nome": "12 escrever não fecha o descritor", "arquivo": "runtime/cofre.mjs", "de": "} finally { try { closeSync(fd) } catch { /* já fechado */ } }", "para": "} finally { /* aberto */ }", "teste": ["testes/cofre-cli-gestao.test.mjs"] },
  { "nome": "13 escrever para no primeiro pedaço", "arquivo": "runtime/cofre.mjs", "de": "while (feito < bytes.length) {", "para": "if (feito < bytes.length) {", "teste": ["testes/cofre-cli-gestao.test.mjs"], "equivalente": "writeSync em arquivo e no pipe do Windows escreve tudo de uma vez; o laço só pesa em pipe não bloqueante que devolve EAGAIN, e a suíte não fabrica um" },
  { "nome": "14 historico aceita --id e --nome juntos", "arquivo": "runtime/cofre.mjs", "de": "if ((o.id === undefined) === (o.nome === undefined))", "para": "if (o.id === undefined && o.nome === undefined)", "teste": ["testes/cofre-cli-gestao.test.mjs"] },
  { "nome": "15 historico ignora o limite", "arquivo": "runtime/cofre.mjs", "de": "const opcoes = o.limite === undefined ? {} : { limite: Number(o.limite) }", "para": "const opcoes = {}", "teste": ["testes/cofre-cli-gestao.test.mjs"] },
  { "nome": "16 historico por nome sem conferir o achado", "arquivo": "runtime/cofre.mjs", "de": "if (id === undefined) throw new CofreError('inexistente'", "para": "if (false) throw new CofreError('inexistente'", "teste": ["testes/cofre-cli-gestao.test.mjs"] },
  { "nome": "17 saude abre os blobs sem --duplicatas", "arquivo": "runtime/cofre.mjs", "de": "ponte: duplicatas ? daPonte() : null, duplicatas", "para": "ponte: daPonte(), duplicatas: true", "teste": ["testes/cofre-cli-gestao.test.mjs"] },
  { "nome": "18 JSON torto do editar vira recusa", "arquivo": "runtime/cofre.mjs", "de": "catch { throw new UsoError('--mudancas precisa ser um JSON') }", "para": "catch { throw new CofreError('dados-invalidos', '--mudancas precisa ser um JSON') }", "teste": ["testes/cofre-cli-gestao.test.mjs"] },
  { "nome": "19 rotacionar aceita --valor", "arquivo": "runtime/cofre.mjs", "de": "case 'rotacionar': {\n        const o = lerOpcoes(resto, { nome: { type: 'string' } }, ['nome'])", "para": "case 'rotacionar': {\n        const o = lerOpcoes(resto, { nome: { type: 'string' }, valor: { type: 'string' } }, ['nome'])", "teste": ["testes/cofre-cli-gestao.test.mjs"] },
  { "nome": "20 apagar devolve só o ok", "arquivo": "runtime/cofre.mjs", "de": "escrever({ ok: true, ...comCofre((db) => apagarCredencial(db, o.nome)) })", "para": "comCofre((db) => apagarCredencial(db, o.nome)); escrever({ ok: true })", "teste": ["testes/cofre-cli-gestao.test.mjs"] },
  { "nome": "21 lixeira aceita opção", "arquivo": "runtime/cofre.mjs", "de": "case 'lixeira': { lerOpcoes(resto, {});", "para": "case 'lixeira': {", "teste": ["testes/cofre-cli-gestao.test.mjs"] },
  { "nome": "22 esvaziar-lixeira sem o ok", "arquivo": "runtime/cofre.mjs", "de": "escrever({ ok: true, ...comCofre((db) => esvaziarLixeira(db)) })", "para": "escrever(comCofre((db) => esvaziarLixeira(db)))", "teste": ["testes/cofre-cli-gestao.test.mjs"] },
  { "nome": "23 restaurar sem a credencial", "arquivo": "runtime/cofre.mjs", "de": "escrever({ ok: true, credencial: comCofre((db) => restaurarCredencial(db, o.id)) })", "para": "comCofre((db) => restaurarCredencial(db, o.id)); escrever({ ok: true })", "teste": ["testes/cofre-cli-gestao.test.mjs"] },
  { "nome": "24 copiar sem o nome na saída", "arquivo": "runtime/cofre.mjs", "de": "escrever({ ok: true, nome: o.nome, ...comCofre((db) => copiarAoDono(", "para": "escrever({ ok: true, ...comCofre((db) => copiarAoDono(", "teste": ["testes/cofre-cli-gestao.test.mjs"] },
  { "nome": "25 editar ignora as mudanças", "arquivo": "runtime/cofre.mjs", "de": "editarCredencial(db, o.nome, mudancas)", "para": "editarCredencial(db, o.nome, {})", "teste": ["testes/cofre-cli-gestao.test.mjs"] },
  { "nome": "26 comando novo desconhecido", "arquivo": "runtime/cofre.mjs", "de": "case 'saude': {", "para": "case 'saude-velha': {", "teste": ["testes/cofre-cli-gestao.test.mjs", "testes/cofre-cli.test.mjs"] }
]
```

Mapa previsto de mutante para teste:

| Mutante | Morre em | Como cai |
|---|---|---|
| 01 | CG 6 e CG 10 | `equal` do código de saída na CG 6: sem a conferência, o revelar segue até a presença; na CG 10, `equal` do código do cofre: a casa vazia dá `inexistente` no lugar de `sem-canal` |
| 02 | CG 6 e CG 10 | deepEqual na CG 6 (a presença foi chamada antes da recusa); na CG 10, `inexistente` no lugar de `sem-canal`, sem chegar ao Hello |
| 03 | CG 7 | `ok` ("o valor entregue ao canal foi zerado") |
| 04 | CG 7 | deepEqual: o canal não recebeu nada |
| 05 | CG 7 | deepEqual da saída |
| 06 | CG 7 | deepEqual das mensagens da presença |
| 07 | CG 8 | deepEqual das mensagens da presença |
| 08 | CG 7 e CG 8 | deepEqual: a presença injetada não foi chamada |
| 09 | CG 10 | `equal` do código do cofre: sem o fd 3, o revelar passa do canal e dá `inexistente` |
| 10 | CG 9 | `equal` ("um dispositivo aberto, como o console, não é o canal") |
| 11 | CG 10 | `equal` do código do cofre: com o fd 3 em pipe, `sem-canal` no lugar de `inexistente` |
| 12 | CG 9 | `equal` ("escrever fecha o descritor") |
| 13 | — | equivalente |
| 14 | CG 4 | `equal` do código: `--id` e `--nome` juntos passam |
| 15 | CG 4 | deepEqual dos usos |
| 16 | CG 4 | `equal` do código: o nome inexistente vira falha inesperada |
| 17 | CG 5 | deepEqual das chamadas da ponte |
| 18 | CG 2 | `equal` do código (3 no lugar de 2) |
| 19 | CG 3 | `equal` do código: `--valor` passa |
| 20 | CG 1 | deepEqual da saída |
| 21 | CG 1 | `equal` do código: `lixeira --tudo` passa |
| 22 | CG 1 | deepEqual da saída |
| 23 | CG 1 | deepEqual da saída |
| 24 | CG 8 | deepEqual da saída |
| 25 | CG 2 | deepEqual da credencial |
| 26 | CG 5 | `equal` do código (2 no lugar de 0) |

- [x] **Passo 7: extrair a lista e anotar os hashes.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so mutantes.mjs tabela-mutantes-p5.mjs mutantes-p5-t4.json
$alvos = 'runtime/cofre.mjs', 'testes/cofre-cli-gestao.test.mjs', 'package.json'
$alvos | ForEach-Object { $_ + ' ' + (Get-FileHash $_ -Algorithm SHA256).Hash.Substring(0, 12) } | Set-Content -Encoding utf8 "$rascunho\hashes-antes-p5-t4.txt"
Get-Content "$rascunho\hashes-antes-p5-t4.txt"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `igual mutantes.mjs`, `igual tabela-mutantes-p5.mjs`, `gravado mutantes-p5-t4.json`, as três linhas de hash e `False`.

Resultado (07/11): `igual mutantes.mjs`, `igual tabela-mutantes-p5.mjs`, `gravado mutantes-p5-t4.json`, os hashes `runtime/cofre.mjs 3D80FE912166`, `testes/cofre-cli-gestao.test.mjs B2EC8786C624` e `package.json C1DE714F70A9`, e `False`.

- [x] **Passo 8: rodar, em segundo plano.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
node "$rascunho\mutantes.mjs" "$rascunho\mutantes-p5-t4.json" *> "$rascunho\mutantes-p5-t4.txt"; "saida: $LASTEXITCODE"
```

Esperado: a última linha de `mutantes-p5-t4.txt` é `26 mutantes em … s; fora do vermelho: 1`, e `saida: 1`: o executor conta o equivalente fora do vermelho, e quem julga é a tabela do Passo 9.

Resultado (07/11): `26 mutantes em 44 s; fora do vermelho: 1`, `saida: 1` e `False`.

- [x] **Passo 9: a tabela, os hashes e a guarda.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
$alvos = 'runtime/cofre.mjs', 'testes/cofre-cli-gestao.test.mjs', 'package.json'
node "$rascunho\tabela-mutantes-p5.mjs" "$rascunho\mutantes-p5-t4.json"; "saida: $LASTEXITCODE"
$depois = $alvos | ForEach-Object { $_ + ' ' + (Get-FileHash $_ -Algorithm SHA256).Hash.Substring(0, 12) }
Compare-Object (Get-Content "$rascunho\hashes-antes-p5-t4.txt") $depois
git status --short
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --conferir; "saida: $LASTEXITCODE"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado:
- `26 linhas: 25 vermelhos, 1 equivalente(s); testes mapeados: 28`, nenhuma linha `PROBLEMA` e `saida: 0`;
- o `Compare-Object` calado;
- no status, além dos ` M dist/…` de fim de linha (item 15), as doze linhas da T2 e mais três: ` M package.json`, ` M runtime/cofre.mjs` e `?? testes/cofre-cli-gestao.test.mjs`;
- vinte e um `igual` (os dezoito da T2, mais a CG, a CLI e a lista da T4), nenhum `AUSENTE` e `saida: 0`;
- `False`.

A tabela gerada (`$rascunho\mutantes-p5-t4.tabela.md`) entra no Apêndice D.

Resultado (07/11): `26 linhas: 25 vermelhos, 1 equivalente(s); testes mapeados: 28`, nenhum `PROBLEMA` e `saida: 0`; o `Compare-Object` calado; no status, as quinze linhas esperadas além dos ` M dist/…`; vinte e um `igual`, nenhum `AUSENTE` e `saida: 0`; e `False`. Cada mutante caiu no teste e pelo operador do mapa, todos por `ERR_ASSERTION`, e o 13 sobreviveu como o equivalente declarado. As quedas são idênticas às do ensaio feito numa cópia antes da escrita.

### Task 5: a mão da ilha

**Arquivos:** criar `apps/omni-ilha/cofre.js` (a mão) e `testes/ilha-cofre-mao.test.mjs` (MC, 10 testes). A ilha é CommonJS (o `package.json` dela não declara `type`) e a raiz é ESM: a MC carrega a mão com `createRequire`. Nenhum arquivo existente muda.

`criarMaoCofre({ spawn, env, cli })` devolve as funções que a janela da T6 chama: `listar`, `lixeira`, `esvaziarLixeira`, `saude({ duplicatas })`, `historico({ id, nome, limite })`, `testar`, `cadastrar(dados, valor)`, `editar(nome, mudancas)`, `rotacionar(nome, valor)`, `apagar`, `restaurar(id)`, `revelar` e `copiar`. Cada uma roda a CLI da T4 num processo à parte e responde `{ ok: true, dados }` ou `{ ok: false, codigo, erro }`, a forma que as rotas `/v1/cofre/*` da F2 vão manter.

O Node (decisão 1):
- vem do `OMNI_NODE` ou, sem ele, do `node` do `PATH`; nunca do `process.execPath`, que na ilha é o Electron 33;
- uma sonda (`node -e`, que imprime `{ node, electron }`) confere uma vez por mão que ele é o 22.13 ou mais novo e que não é um Electron. Só a sonda roda com `ELECTRON_RUN_AS_NODE=1`: se o `OMNI_NODE` apontar para um Electron, ele responde como Node em vez de abrir janela, e a sonda o recusa pelo `process.versions.electron`. A CLI roda sem essa variável, tirada do ambiente que a ilha herda;
- a sonda que falha não fica guardada: o pedido seguinte sonda de novo, e o Weriton pode instalar o Node sem reabrir a ilha. Cada falha tem a sua mensagem, sempre com o código `sem-node`: não achou o Node, o Node não respondeu, a resposta veio ilegível, é um Electron, a versão é antiga.

Os pedidos:
- limites de tempo: 15 s para listar, lixeira, esvaziar, saúde sem duplicata, histórico, editar, apagar e restaurar; 30 s para testar, saúde com duplicatas, cadastrar e rotacionar; 90 s para revelar e copiar, que esperam o Hello. Passado o limite, a mão mata o processo e responde `tempo`;
- cada opção vai como `--chave=valor`, num argumento só: um valor que começa com `-` não vira opção no `parseArgs` da CLI. `agentes` em lista vira vírgulas, e `mudancas` vira JSON;
- a CLI roda com `--disable-warning=ExperimentalWarning`: o `node:sqlite` avisa no stderr, e o aviso ocuparia a primeira linha, que é a que vira o erro;
- `windowsHide: true` e `shell: false`;
- tetos: o stdout acima de 1 MB mata o processo e responde `teto`; o fd 3 acima de 1 MB também, e zera o que já tinha chegado; o stderr guarda só os primeiros 8 KB, sem matar.

As saídas da CLI: a 0 vira `{ ok: true, dados }`, com o JSON da CLI; a 3 vira a recusa da CLI, conferida a forma (`ok: false` e `codigo` em texto); a 2 vira `uso`, e a 1, `falha`, as duas com a primeira linha do stderr cortada em 300 caracteres; qualquer outra, `falha` com o código ou o sinal. JSON torto, na 0 ou na 3, vira `ilegivel`.

O segredo (executor, item 4):
- `cadastrar` e `rotacionar` recebem o valor num Buffer de uma linha, não vazio; qualquer outra coisa dá `uso` sem chamar nada. A mão manda pelo stdin uma cópia com a quebra de linha, zera a cópia no fim e zera o Buffer de quem chamou sempre, aceito ou não;
- só o `revelar` abre o fd 3. Os pedaços que chegam por ele são juntados num Buffer novo só na saída 0 e zerados em seguida; o Buffer volta em `valor` só na resposta ok, e na recusa é zerado. A mão não transforma o valor em string: quem o mostra é a janela da T6.

A MC usa um `spawn` falso, com filhos de `EventEmitter`, e prova a sonda, as respostas, os limites (com o `setTimeout` trocado por um que guarda o prazo), os argumentos e o stdio de cada função, o stdin, o fd 3 e os tetos. A MC 10 roda a CLI de verdade numa casa temporária, com `OMNI_NODE` igual ao `process.execPath` da suíte (o Node 24, ou o 22 na T8) e com `OMNI_HOME` e `OMNI_CASA_BANCO` dentro da casa: listar, lixeira, saúde, revelar sem credencial (`inexistente`, sem `valor`), histórico por um nome que começa com `-`, editar com aspas e espaço e o erro de uso do histórico sem `--id` nem `--nome`. Nenhum Hello é chamado: a loja recusa o inexistente antes da presença (decisão 19).

- [x] **Passo 1: o teste.**

```js arquivo=testes/ilha-cofre-mao.test.mjs
// A mão do cofre na ilha (F1, plano 5, T5). As nove primeiras provas usam um spawn falso: nenhum
// processo nasce, nenhum Node é procurado, nenhum valor real passa. A décima roda a CLI de verdade
// numa casa temporária, com o Node desta suíte no OMNI_NODE, e só com nomes que não existem.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { criarMaoCofre, versaoServe, LIMITES } = require('../apps/omni-ilha/cofre.js')

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(RAIZ, 'runtime', 'cofre.mjs')
const AVISO = '--disable-warning=ExperimentalWarning'
const proximo = () => new Promise((r) => setImmediate(r))
const zerado = (b) => b.every((x) => x === 0)

// Os fluxos são EventEmitters puros: o pedaço que a prova emite é o mesmo objeto que a mão recebe.
function filhoFalso(stdio) {
  const filho = new EventEmitter()
  filho.mortes = 0
  filho.fechado = false
  filho.stdin = stdio[0] === 'pipe'
    ? Object.assign(new EventEmitter(), { pedacos: [], end(b) { this.pedacos.push(b); this.recebido = Buffer.from(b) } })
    : null
  filho.stdout = new EventEmitter()
  filho.stderr = new EventEmitter()
  filho.stdio = [filho.stdin, filho.stdout, filho.stderr]
  if (stdio[3] === 'pipe') filho.stdio.push(new EventEmitter())
  filho.kill = () => {
    filho.mortes += 1
    if (!filho.fechado) { filho.fechado = true; setImmediate(() => filho.emit('close', null, 'SIGTERM')) }
    return true
  }
  return filho
}

async function responder(filho, { saida, erro, canal = [], codigo = 0 } = {}) {
  if (saida !== undefined) filho.stdout.emit('data', Buffer.from(saida))
  if (erro !== undefined) filho.stderr.emit('data', Buffer.from(erro))
  for (const pedaco of canal) {
    if (filho.stdio[3]) filho.stdio[3].emit('data', pedaco)
    await proximo()
  }
  setImmediate(() => { if (!filho.fechado) { filho.fechado = true; filho.emit('close', codigo, null) } })
}

const SONDA_BOA = { saida: JSON.stringify({ node: '22.13.0', electron: null }) }

function spawnFalso({ cli = (c) => responder(c.filho, { saida: '[]' }), sonda = (c) => responder(c.filho, SONDA_BOA) } = {}) {
  const chamadas = []
  function spawn(comando, args, opcoes) {
    const filho = filhoFalso(opcoes.stdio)
    const chamada = { comando, args, opcoes, filho }
    chamadas.push(chamada)
    setImmediate(() => (args[0] === '-e' ? sonda : cli)(chamada))
    return filho
  }
  return { spawn, chamadas, cli: () => chamadas.filter((c) => c.args[0] !== '-e'), sondas: () => chamadas.filter((c) => c.args[0] === '-e') }
}

function aUnicaChamada(f) {
  assert.equal(f.cli().length, 1, 'a CLI devia ter sido chamada uma vez')
  return f.cli()[0]
}

test('o Node vem do OMNI_NODE ou do PATH, a sonda roda uma vez e a CLI vai sem o modo Electron', async () => {
  const f = spawnFalso()
  const mao = criarMaoCofre({ spawn: f.spawn, env: { OMNI_NODE: 'C:/falso/node.exe', ELECTRON_RUN_AS_NODE: '1', OUTRA: 'x' } })
  assert.deepEqual(await mao.listar(), { ok: true, dados: [] })
  assert.deepEqual(await mao.listar(), { ok: true, dados: [] })
  assert.equal(f.sondas().length, 1)
  const [sonda] = f.sondas()
  assert.equal(sonda.comando, 'C:/falso/node.exe')
  assert.equal(sonda.args[0], '-e')
  assert.equal(sonda.opcoes.env.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(sonda.opcoes.env.OUTRA, 'x')
  assert.equal(f.cli().length, 2)
  for (const c of f.cli()) {
    assert.equal(c.comando, 'C:/falso/node.exe')
    assert.deepEqual(c.args, [AVISO, CLI, 'listar'])
    assert.equal('ELECTRON_RUN_AS_NODE' in c.opcoes.env, false)
    assert.equal(c.opcoes.env.OUTRA, 'x')
    assert.deepEqual(c.opcoes.stdio, ['ignore', 'pipe', 'pipe'])
    assert.equal(c.opcoes.windowsHide, true)
    assert.equal(c.opcoes.shell, false)
  }
  const g = spawnFalso()
  assert.deepEqual(await criarMaoCofre({ spawn: g.spawn, env: {} }).listar(), { ok: true, dados: [] })
  assert.deepEqual(g.chamadas.map((c) => c.comando), ['node', 'node'])
})

test('a sonda recusa o Node antigo e o Electron, sem chamar a CLI', async () => {
  for (const v of ['22.13.0', '22.23.4', '23.0.0', '24.11.1']) assert.equal(versaoServe(v), true, v)
  for (const v of ['22.12.9', '20.18.1', '21.99.0', '22.13', 'v22.13.0']) assert.equal(versaoServe(v), false, v)
  const casos = [
    [{ node: '20.18.1', electron: '33.2.0' }, 'o OMNI_NODE é um Electron; o cofre pede o Node do sistema, 22.13 ou mais novo'],
    [{ node: '22.12.0', electron: null }, 'o cofre pede o Node 22.13 ou mais novo; o OMNI_NODE é o 22.12.0'],
  ]
  for (const [versoes, erro] of casos) {
    const f = spawnFalso({ sonda: (c) => responder(c.filho, { saida: JSON.stringify(versoes) }) })
    const mao = criarMaoCofre({ spawn: f.spawn, env: { OMNI_NODE: 'C:/falso/node.exe' } })
    assert.deepEqual(await mao.listar(), { ok: false, codigo: 'sem-node', erro })
    assert.equal(f.cli().length, 0)
  }
})

test('a sonda que falha não fica guardada, e cada falha tem a sua mensagem', async () => {
  let vez = 0
  const f = spawnFalso({
    sonda: (c) => {
      vez += 1
      if (vez === 1) c.filho.emit('error', Object.assign(new Error('spawn node ENOENT'), { code: 'ENOENT' }))
      else responder(c.filho, SONDA_BOA)
    },
  })
  const mao = criarMaoCofre({ spawn: f.spawn, env: {} })
  assert.deepEqual(await mao.listar(), { ok: false, codigo: 'sem-node', erro: 'não achei o Node do sistema (o node do PATH)' })
  assert.equal(f.cli().length, 0)
  assert.deepEqual(await mao.listar(), { ok: true, dados: [] })
  assert.equal(f.sondas().length, 2)

  const lanca = criarMaoCofre({ spawn: () => { throw new Error('EINVAL') }, env: {} })
  assert.deepEqual(await lanca.listar(), { ok: false, codigo: 'sem-node', erro: 'não achei o Node do sistema (o node do PATH)' })

  const saiu = spawnFalso({ sonda: (c) => responder(c.filho, { codigo: 1 }) })
  assert.deepEqual(await criarMaoCofre({ spawn: saiu.spawn, env: {} }).listar(), { ok: false, codigo: 'sem-node', erro: 'o Node do sistema não respondeu à sonda (o node do PATH)' })

  const ilegivel = spawnFalso({ sonda: (c) => responder(c.filho, { saida: 'nada' }) })
  assert.deepEqual(await criarMaoCofre({ spawn: ilegivel.spawn, env: {} }).listar(), { ok: false, codigo: 'sem-node', erro: 'a sonda do Node respondeu algo ilegível' })
})

test('cada saída da CLI vira a resposta certa', async () => {
  const ILEGIVEL = { ok: false, codigo: 'ilegivel', erro: 'a resposta do cofre veio ilegível' }
  const casos = [
    [{ saida: '[{"nome":"a"}]', codigo: 0 }, { ok: true, dados: [{ nome: 'a' }] }],
    [{ saida: JSON.stringify({ ok: false, codigo: 'inexistente', erro: 'Não há credencial com o nome a.' }), codigo: 3 }, { ok: false, codigo: 'inexistente', erro: 'Não há credencial com o nome a.' }],
    [{ saida: '{"ok":true}', codigo: 3 }, ILEGIVEL],
    [{ erro: 'falta --nome\nUSO: ...', codigo: 2 }, { ok: false, codigo: 'uso', erro: 'falta --nome' }],
    [{ erro: 'falha inesperada no cofre: disco\n    at x', codigo: 1 }, { ok: false, codigo: 'falha', erro: 'falha inesperada no cofre: disco' }],
    [{ saida: 'não é json', codigo: 0 }, ILEGIVEL],
    [{ saida: '', codigo: 0 }, ILEGIVEL],
    [{ codigo: 7 }, { ok: false, codigo: 'falha', erro: 'o cofre saiu com 7' }],
  ]
  for (const [roteiro, esperado] of casos) {
    const f = spawnFalso({ cli: (c) => responder(c.filho, roteiro) })
    assert.deepEqual(await criarMaoCofre({ spawn: f.spawn, env: {} }).listar(), esperado, JSON.stringify(roteiro))
  }
})

test('cada pedido tem o seu limite de tempo e mata o processo quando passa', async (t) => {
  assert.deepEqual(LIMITES, { curto: 15000, medio: 30000, longo: 90000 })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = spawnFalso({ cli: () => { /* nunca responde */ } })
  const mao = criarMaoCofre({ spawn: f.spawn, env: {} })
  const casos = [
    [() => mao.listar(), 15000],
    [() => mao.testar('a'), 30000],
    [() => mao.saude({ duplicatas: true }), 30000],
    [() => mao.revelar('a'), 90000],
    [() => mao.copiar('a'), 90000],
  ]
  for (const [pedir, limite] of casos) {
    const antes = f.cli().length
    const resposta = pedir()
    for (let i = 0; i < 50 && f.cli().length === antes; i += 1) await proximo()
    const chamada = f.cli()[antes]
    assert.ok(chamada, 'a CLI não foi chamada')
    t.mock.timers.tick(limite - 1)
    assert.equal(chamada.filho.mortes, 0)
    t.mock.timers.tick(1)
    assert.equal(chamada.filho.mortes, 1)
    assert.deepEqual(await resposta, { ok: false, codigo: 'tempo', erro: `o cofre não respondeu em ${limite / 1000} s` })
  }
})

test('cada função monta os seus argumentos e o seu stdio', async () => {
  const f = spawnFalso()
  const mao = criarMaoCofre({ spawn: f.spawn, env: {} })
  const SO_SAIDA = ['ignore', 'pipe', 'pipe']
  const COM_ENTRADA = ['pipe', 'pipe', 'pipe']
  await mao.listar()
  await mao.lixeira()
  await mao.esvaziarLixeira()
  await mao.saude()
  await mao.saude({ duplicatas: true })
  await mao.historico({ nome: '-x', limite: 5 })
  await mao.historico({ id: 'id-1' })
  await mao.testar('a')
  await mao.cadastrar({ nome: 'n', tipo: 'token', servico: 's', url: 'https://exemplo.invalid', usuario: 'u', notas: '--y', agentes: ['omni', 'oraculo'] }, Buffer.from('v'))
  await mao.cadastrar({ nome: 'm', tipo: 'senha', agentes: [] }, Buffer.from('v'))
  await mao.editar('n', { notas: 'x', agentes: ['omni'] })
  await mao.rotacionar('n', Buffer.from('v'))
  await mao.apagar('n')
  await mao.restaurar('id-1')
  await mao.revelar('n')
  await mao.copiar('n')
  for (const c of f.cli()) assert.deepEqual(c.args.slice(0, 2), [AVISO, CLI])
  assert.deepEqual(f.cli().map((c) => [c.args.slice(2), c.opcoes.stdio]), [
    [['listar'], SO_SAIDA],
    [['lixeira'], SO_SAIDA],
    [['esvaziar-lixeira'], SO_SAIDA],
    [['saude'], SO_SAIDA],
    [['saude', '--duplicatas'], SO_SAIDA],
    [['historico', '--nome=-x', '--limite=5'], SO_SAIDA],
    [['historico', '--id=id-1'], SO_SAIDA],
    [['testar', '--nome=a'], SO_SAIDA],
    [['cadastrar', '--nome=n', '--tipo=token', '--servico=s', '--url=https://exemplo.invalid', '--usuario=u', '--notas=--y', '--agentes=omni,oraculo'], COM_ENTRADA],
    [['cadastrar', '--nome=m', '--tipo=senha', '--agentes='], COM_ENTRADA],
    [['editar', '--nome=n', '--mudancas={"notas":"x","agentes":["omni"]}'], SO_SAIDA],
    [['rotacionar', '--nome=n'], COM_ENTRADA],
    [['apagar', '--nome=n'], SO_SAIDA],
    [['restaurar', '--id=id-1'], SO_SAIDA],
    [['revelar', '--nome=n'], ['ignore', 'pipe', 'pipe', 'pipe']],
    [['copiar', '--nome=n'], SO_SAIDA],
  ])
})

test('cadastrar e rotacionar mandam o valor pelo stdin e zeram os Buffers', async () => {
  const f = spawnFalso({ cli: (c) => responder(c.filho, { saida: '{"ok":true}' }) })
  const mao = criarMaoCofre({ spawn: f.spawn, env: {} })
  const pedidos = [
    (valor) => mao.cadastrar({ nome: 'n', tipo: 'token' }, valor),
    (valor) => mao.rotacionar('n', valor),
  ]
  for (const pedir of pedidos) {
    const valor = Buffer.from('segredo-falso')
    assert.deepEqual(await pedir(valor), { ok: true, dados: { ok: true } })
    const c = f.cli().at(-1)
    assert.deepEqual(c.filho.stdin.recebido, Buffer.from('segredo-falso\n'))
    assert.equal(c.args.some((a) => a.includes('segredo-falso')), false)
    assert.ok(zerado(valor), 'o Buffer de quem chamou ficou com o valor')
    assert.equal(c.filho.stdin.pedacos.length, 1)
    assert.ok(zerado(c.filho.stdin.pedacos[0]), 'a cópia com a quebra de linha ficou com o valor')
  }
  const antes = f.chamadas.length
  const USO = { ok: false, codigo: 'uso', erro: 'o valor precisa chegar num Buffer de uma linha, não vazio' }
  for (const valor of [Buffer.alloc(0), Buffer.from('a\nb'), Buffer.from('a\rb'), 'texto', undefined]) {
    assert.deepEqual(await mao.cadastrar({ nome: 'n', tipo: 'token' }, valor), USO)
    if (Buffer.isBuffer(valor)) assert.ok(zerado(valor))
  }
  const rotacao = Buffer.from('a\nb')
  assert.deepEqual(await mao.rotacionar('n', rotacao), USO)
  assert.ok(zerado(rotacao))
  assert.equal(f.chamadas.length, antes)
})

test('o revelado volta pelo fd 3 só na saída 0, e os pedaços são zerados', async () => {
  const p1 = Buffer.from('valor-')
  const p2 = Buffer.from('falso')
  const f = spawnFalso({ cli: (c) => responder(c.filho, { saida: JSON.stringify({ ok: true, nome: 'x', usoId: 'u1' }), canal: [p1, p2] }) })
  const res = await criarMaoCofre({ spawn: f.spawn, env: {} }).revelar('x')
  assert.deepEqual(aUnicaChamada(f).opcoes.stdio, ['ignore', 'pipe', 'pipe', 'pipe'])
  const { valor, ...resto } = res
  assert.deepEqual(valor, Buffer.from('valor-falso'))
  assert.deepEqual(resto, { ok: true, dados: { ok: true, nome: 'x', usoId: 'u1' } })
  assert.ok(zerado(p1) && zerado(p2), 'os pedaços do fd 3 ficaram com o valor')

  const p3 = Buffer.from('nao-devia')
  const recusa = { ok: false, codigo: 'inexistente', erro: 'Não há credencial com o nome x.' }
  const g = spawnFalso({ cli: (c) => responder(c.filho, { saida: JSON.stringify(recusa), canal: [p3], codigo: 3 }) })
  assert.deepEqual(await criarMaoCofre({ spawn: g.spawn, env: {} }).revelar('x'), recusa)
  assert.ok(zerado(p3))
})

test('os tetos de stdout, do fd 3 e do stderr', async () => {
  // Confere o código e a ausência do valor antes do deepEqual: o diff de um Buffer de 1 MB esgota a memória.
  const TETO = { ok: false, codigo: 'teto', erro: 'a resposta do cofre passou do tamanho esperado' }
  const f = spawnFalso({ cli: (c) => responder(c.filho, { saida: 'x'.repeat(1024 * 1024 + 1) }) })
  const saida = await criarMaoCofre({ spawn: f.spawn, env: {} }).listar()
  assert.equal(saida.codigo, 'teto')
  assert.deepEqual(saida, TETO)
  assert.equal(aUnicaChamada(f).filho.mortes, 1)

  const grande = Buffer.alloc(1024 * 1024 + 1, 0x61)
  const g = spawnFalso({ cli: (c) => responder(c.filho, { saida: '{"ok":true}', canal: [grande] }) })
  const revelado = await criarMaoCofre({ spawn: g.spawn, env: {} }).revelar('x')
  assert.equal(revelado.codigo, 'teto')
  assert.equal('valor' in revelado, false)
  assert.deepEqual(revelado, TETO)
  assert.equal(aUnicaChamada(g).filho.mortes, 1)
  assert.ok(zerado(grande))

  const h = spawnFalso({ cli: (c) => responder(c.filho, { erro: 'e'.repeat(20000), codigo: 1 }) })
  const erro = await criarMaoCofre({ spawn: h.spawn, env: {} }).listar()
  assert.equal(erro.erro.length, 300)
  assert.deepEqual(erro, { ok: false, codigo: 'falha', erro: 'e'.repeat(300) })
  assert.equal(aUnicaChamada(h).filho.mortes, 0)
})

test('a CLI de verdade, numa casa temporária, responde pela mão', async () => {
  const casa = mkdtempSync(join(tmpdir(), 'omni-ilha-cofre-'))
  try {
    const mao = criarMaoCofre({ env: { ...process.env, OMNI_NODE: process.execPath, OMNI_HOME: casa, OMNI_CASA_BANCO: join(casa, 'casa') } })
    assert.deepEqual(await mao.listar(), { ok: true, dados: [] })
    assert.deepEqual(await mao.lixeira(), { ok: true, dados: [] })
    const saude = await mao.saude()
    assert.equal(saude.ok, true)
    assert.equal(saude.dados.total, 0)
    const revelado = await mao.revelar('nao-existe')
    assert.equal(revelado.codigo, 'inexistente')
    assert.equal('valor' in revelado, false)
    assert.equal((await mao.historico({ nome: '-x' })).codigo, 'inexistente')
    assert.equal((await mao.editar('nao-existe', { notas: 'com "aspas" e espaço' })).codigo, 'inexistente')
    assert.deepEqual(await mao.historico({}), { ok: false, codigo: 'uso', erro: 'use --id ou --nome, um dos dois' })
  } finally {
    rmSync(casa, { recursive: true, force: true })
  }
})
```

- [x] **Passo 2: extrair o teste e ver o vermelho.**

```powershell
Test-Path "$env:LOCALAPPDATA\omni\casa"
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so testes/ilha-cofre-mao.test.mjs
node --test --test-concurrency=1 --test-reporter=spec testes/ilha-cofre-mao.test.mjs *> "$rascunho\p5-t5-vermelho.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\p5-t5-vermelho.txt" -Pattern 'Cannot find module', '(tests|pass|fail) \d+\s*$'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `False`, `gravado testes/ilha-cofre-mao.test.mjs`, `saida: 1`, `Cannot find module '../apps/omni-ilha/cofre.js'`, `tests 1`, `pass 0`, `fail 1` e `False`.

Resultado (07/11): `False`, `gravado testes/ilha-cofre-mao.test.mjs`, `saida: 1`, `Error: Cannot find module '../apps/omni-ilha/cofre.js'`, `tests 1`, `pass 0`, `fail 1` e `False`.

- [x] **Passo 3: a mão.**

```js arquivo=apps/omni-ilha/cofre.js
'use strict';

// A mão do cofre na ilha (F1, plano 5). A ilha não abre o banco (§3.4 do desenho): cada pedido roda a
// CLI runtime/cofre.mjs num processo à parte, com o Node do sistema, porque o Electron da ilha é o 33,
// com Node 20 e sem node:sqlite. O Node vem do OMNI_NODE ou do PATH, nunca do process.execPath. Uma
// sonda confere, uma vez por sessão, que ele é o 22.13 ou mais novo e que não é um Electron; a sonda
// que falha é refeita no pedido seguinte. As respostas têm a forma que as rotas /v1/cofre/* da F2 vão
// manter: { ok: true, dados } ou { ok: false, codigo, erro }.
// Segredo: o valor do cadastro e da rotação vai pelo stdin, e os Buffers são zerados; o revelado chega
// só pelo descritor 3 e volta só a quem chamou revelar, e só com a saída 0. Nenhum caminho põe valor em
// argumento, em log ou em mensagem de erro.

const childProcess = require('child_process');
const path = require('path');

const CLI = path.join(__dirname, '..', '..', 'runtime', 'cofre.mjs');
const LIMITES = { curto: 15000, medio: 30000, longo: 90000 };
const TETOS = { saida: 1024 * 1024, erro: 8 * 1024, valor: 1024 * 1024 };
const AVISO = '--disable-warning=ExperimentalWarning';   // o aviso do node:sqlite ocuparia a 1ª linha do stderr
const SONDA = 'process.stdout.write(JSON.stringify({node:process.versions.node,electron:process.versions.electron??null}))';

function versaoServe(versao) {
  const partes = /^(\d+)\.(\d+)\.\d+$/.exec(String(versao));
  if (!partes) return false;
  const maior = Number(partes[1]);
  const menor = Number(partes[2]);
  return maior > 22 || (maior === 22 && menor >= 13);
}

function lerJson(texto) { try { return JSON.parse(texto); } catch { return undefined; } }
function primeiraLinha(texto) { return String(texto).split(/\r?\n/)[0].slice(0, 300); }
const ilegivel = () => ({ ok: false, codigo: 'ilegivel', erro: 'a resposta do cofre veio ilegível' });

// --chave=valor num argumento só: um valor que começa com - não vira opção no parseArgs da CLI.
function opcoes(pares) {
  const args = [];
  for (const [chave, valor] of pares) if (valor !== undefined && valor !== null) args.push(`--${chave}=${valor}`);
  return args;
}

function valorDeUmaLinha(valor) {
  return Buffer.isBuffer(valor) && valor.length > 0 && !valor.includes(10) && !valor.includes(13);
}

function falhaDaSonda(r, origem) {
  const sem = (erro) => ({ ok: false, codigo: 'sem-node', erro });
  if (r.motivo === 'sem-node' || r.motivo === 'nao-abriu') return sem(`não achei o Node do sistema (${origem})`);
  if (r.motivo !== null || r.codigo !== 0) return sem(`o Node do sistema não respondeu à sonda (${origem})`);
  const v = lerJson(r.stdout);
  if (!v || typeof v !== 'object') return sem('a sonda do Node respondeu algo ilegível');
  if (v.electron) return sem(`${origem} é um Electron; o cofre pede o Node do sistema, 22.13 ou mais novo`);
  if (!versaoServe(v.node)) return sem(`o cofre pede o Node 22.13 ou mais novo; ${origem} é o ${String(v.node).slice(0, 20)}`);
  return null;
}

function resposta(r, ms) {
  if (r.motivo === 'tempo') return { ok: false, codigo: 'tempo', erro: `o cofre não respondeu em ${ms / 1000} s` };
  if (r.motivo === 'teto') return { ok: false, codigo: 'teto', erro: 'a resposta do cofre passou do tamanho esperado' };
  if (r.motivo === 'sem-node') return { ok: false, codigo: 'sem-node', erro: 'o Node do sistema sumiu entre a sonda e o pedido' };
  if (r.motivo === 'nao-abriu') return { ok: false, codigo: 'falha', erro: 'não consegui abrir o processo do cofre' };
  if (r.codigo === 0) {
    const dados = lerJson(r.stdout);
    return dados === undefined ? ilegivel() : { ok: true, dados };
  }
  if (r.codigo === 3) {
    const recusa = lerJson(r.stdout);
    if (recusa && recusa.ok === false && typeof recusa.codigo === 'string') return { ok: false, codigo: recusa.codigo, erro: String(recusa.erro ?? '') };
    return ilegivel();
  }
  if (r.codigo === 2) return { ok: false, codigo: 'uso', erro: primeiraLinha(r.stderr) };
  if (r.codigo === 1) return { ok: false, codigo: 'falha', erro: primeiraLinha(r.stderr) };
  return { ok: false, codigo: 'falha', erro: `o cofre saiu com ${r.codigo ?? r.sinal}` };
}

function criarMaoCofre({ spawn = childProcess.spawn, env = process.env, cli = CLI } = {}) {
  const node = env.OMNI_NODE || 'node';
  const origem = env.OMNI_NODE ? 'o OMNI_NODE' : 'o node do PATH';
  const envCli = { ...env };
  delete envCli.ELECTRON_RUN_AS_NODE;
  const envSonda = { ...envCli, ELECTRON_RUN_AS_NODE: '1' };   // um Electron no OMNI_NODE responde como Node, sem abrir janela
  let conferindo = null;

  function executar(args, { ms, envFilho = envCli, entrada = null, canal = false }) {
    return new Promise((resolver) => {
      const saida = []; const erro = []; const valor = [];
      let tamSaida = 0; let tamErro = 0; let tamValor = 0;
      let motivo = null; let acabou = false; let filho = null; let copia = null;
      const zerarValor = () => { for (const pedaco of valor) pedaco.fill(0); valor.length = 0; };
      const matar = (porque) => { motivo ??= porque; try { filho.kill(); } catch { /* já saiu */ } };
      const limite = setTimeout(() => matar('tempo'), ms);
      const acabar = (codigo, sinal) => {
        if (acabou) return;
        acabou = true;
        clearTimeout(limite);
        if (copia) copia.fill(0);
        const bytes = canal && motivo === null ? Buffer.concat(valor) : null;
        zerarValor();
        resolver({ codigo, sinal, motivo, stdout: Buffer.concat(saida).toString('utf8'), stderr: Buffer.concat(erro).toString('utf8'), valor: bytes });
      };
      try {
        filho = spawn(node, args, { env: envFilho, windowsHide: true, shell: false, stdio: [entrada ? 'pipe' : 'ignore', 'pipe', 'pipe', ...(canal ? ['pipe'] : [])] });
      } catch { motivo = 'nao-abriu'; acabar(null, null); return; }
      filho.stdout.on('data', (pedaco) => { tamSaida += pedaco.length; if (tamSaida > TETOS.saida) matar('teto'); else saida.push(pedaco); });
      filho.stderr.on('data', (pedaco) => { if (tamErro < TETOS.erro) erro.push(pedaco.subarray(0, TETOS.erro - tamErro)); tamErro += pedaco.length; });
      const doCanal = canal ? filho.stdio[3] : null;
      if (doCanal) {
        doCanal.on('data', (pedaco) => {
          if (motivo !== null) { pedaco.fill(0); return; }
          valor.push(pedaco); tamValor += pedaco.length;
          if (tamValor > TETOS.valor) { matar('teto'); zerarValor(); }
        });
      }
      if (entrada) {
        filho.stdin.on('error', () => { /* o filho saiu sem ler: a saída dele diz o porquê */ });
        copia = Buffer.concat([entrada, Buffer.from('\n')]);
        filho.stdin.end(copia);
      }
      filho.once('error', () => { motivo ??= 'sem-node'; acabar(null, null); });
      filho.once('close', (codigo, sinal) => acabar(codigo, sinal));
    });
  }

  function conferirNode() {
    conferindo ??= executar(['-e', SONDA], { ms: LIMITES.curto, envFilho: envSonda }).then((r) => {
      const falha = falhaDaSonda(r, origem);
      if (falha) conferindo = null;
      return falha;
    });
    return conferindo;
  }

  async function pedir(args, { ms = LIMITES.curto, entrada = null, canal = false } = {}) {
    const falha = await conferirNode();
    if (falha) return falha;
    const r = await executar([AVISO, cli, ...args], { ms, entrada, canal });
    const res = resposta(r, ms);
    if (r.valor) {
      if (res.ok) res.valor = r.valor;
      else r.valor.fill(0);
    }
    return res;
  }

  // O Buffer de quem chamou é zerado sempre, aceito ou não.
  async function comValor(args, valor) {
    try {
      if (!valorDeUmaLinha(valor)) return { ok: false, codigo: 'uso', erro: 'o valor precisa chegar num Buffer de uma linha, não vazio' };
      return await pedir(args, { ms: LIMITES.medio, entrada: valor });
    } finally { if (Buffer.isBuffer(valor)) valor.fill(0); }
  }

  return {
    listar: () => pedir(['listar']),
    lixeira: () => pedir(['lixeira']),
    esvaziarLixeira: () => pedir(['esvaziar-lixeira']),
    saude: ({ duplicatas = false } = {}) => (duplicatas ? pedir(['saude', '--duplicatas'], { ms: LIMITES.medio }) : pedir(['saude'])),
    historico: ({ id, nome, limite } = {}) => pedir(['historico', ...opcoes([['id', id], ['nome', nome], ['limite', limite]])]),
    testar: (nome) => pedir(['testar', ...opcoes([['nome', nome]])], { ms: LIMITES.medio }),
    cadastrar: (dados = {}, valor) => comValor(['cadastrar', ...opcoes([
      ['nome', dados.nome], ['tipo', dados.tipo], ['servico', dados.servico], ['url', dados.url], ['usuario', dados.usuario], ['notas', dados.notas],
      ['agentes', Array.isArray(dados.agentes) ? dados.agentes.join(',') : dados.agentes],
    ])], valor),
    editar: (nome, mudancas) => pedir(['editar', ...opcoes([['nome', nome], ['mudancas', mudancas === undefined ? undefined : JSON.stringify(mudancas)]])]),
    rotacionar: (nome, valor) => comValor(['rotacionar', ...opcoes([['nome', nome]])], valor),
    apagar: (nome) => pedir(['apagar', ...opcoes([['nome', nome]])]),
    restaurar: (id) => pedir(['restaurar', ...opcoes([['id', id]])]),
    revelar: (nome) => pedir(['revelar', ...opcoes([['nome', nome]])], { ms: LIMITES.longo, canal: true }),
    copiar: (nome) => pedir(['copiar', ...opcoes([['nome', nome]])], { ms: LIMITES.longo }),
  };
}

module.exports = { criarMaoCofre, versaoServe, LIMITES };
```

- [x] **Passo 4: extrair a mão e ver o verde.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so apps/omni-ilha/cofre.js
node --check apps/omni-ilha/cofre.js; "check: $LASTEXITCODE"
node --test --test-concurrency=1 --test-reporter=spec testes/ilha-cofre-mao.test.mjs *> "$rascunho\p5-t5-verde.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\p5-t5-verde.txt" -Pattern '(tests|pass|fail) \d+\s*$'
foreach ($a in 'apps/omni-ilha/cofre.js', 'testes/ilha-cofre-mao.test.mjs') { $a + ' CR: ' + ([IO.File]::ReadAllText((Resolve-Path $a)).Split([char]13).Count - 1) }
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `gravado apps/omni-ilha/cofre.js`, `check: 0`, `tests 10`, `pass 10`, `fail 0`, `saida: 0`, CR 0 nos dois e `False`.

Resultado (07/11): `gravado apps/omni-ilha/cofre.js`, `check: 0`, `tests 10`, `pass 10`, `fail 0`, os dez ✔ no spec (a MC 10, com a CLI de verdade, em 1,5 s), `saida: 0`, o stderr vazio, CR 0 nos dois e `False`.

**Mutação.** Trinta e um mutantes, todos na mão, com os critérios da T1. Nenhum equivalente. O 05 derruba nove testes de uma vez: com o 22.13.0 da sonda falsa recusado, nenhum pedido chega à CLI, e a MC 8 e a MC 9 caem pela asserção de `aUnicaChamada` em vez de quebrar no `undefined`. O 21 cai pela asserção do código antes do deepEqual da resposta: sem o teto, o valor de 1 MB voltaria na resposta, e o diff dele esgotaria a memória do processo de teste.

```json rascunho=mutantes-p5-t5.json
[
  { "nome": "01 Node do processo da ilha", "arquivo": "apps/omni-ilha/cofre.js", "de": "const node = env.OMNI_NODE || 'node';", "para": "const node = process.execPath;", "teste": ["testes/ilha-cofre-mao.test.mjs"] },
  { "nome": "02 sonda sem o modo Node do Electron", "arquivo": "apps/omni-ilha/cofre.js", "de": "const envSonda = { ...envCli, ELECTRON_RUN_AS_NODE: '1' };", "para": "const envSonda = envCli;", "teste": ["testes/ilha-cofre-mao.test.mjs"] },
  { "nome": "03 CLI herda o modo Node do Electron", "arquivo": "apps/omni-ilha/cofre.js", "de": "delete envCli.ELECTRON_RUN_AS_NODE;", "para": "void 0;", "teste": ["testes/ilha-cofre-mao.test.mjs"] },
  { "nome": "04 sonda aceita o Electron", "arquivo": "apps/omni-ilha/cofre.js", "de": "if (v.electron) return sem(", "para": "if (false) return sem(", "teste": ["testes/ilha-cofre-mao.test.mjs"] },
  { "nome": "05 22.13 fica de fora", "arquivo": "apps/omni-ilha/cofre.js", "de": "menor >= 13", "para": "menor > 13", "teste": ["testes/ilha-cofre-mao.test.mjs"] },
  { "nome": "06 qualquer 22 serve", "arquivo": "apps/omni-ilha/cofre.js", "de": "maior > 22 ||", "para": "maior >= 22 ||", "teste": ["testes/ilha-cofre-mao.test.mjs"] },
  { "nome": "07 sonda a cada pedido", "arquivo": "apps/omni-ilha/cofre.js", "de": "conferindo ??= executar(", "para": "conferindo = executar(", "teste": ["testes/ilha-cofre-mao.test.mjs"] },
  { "nome": "08 sonda que falha fica guardada", "arquivo": "apps/omni-ilha/cofre.js", "de": "if (falha) conferindo = null;", "para": "void 0;", "teste": ["testes/ilha-cofre-mao.test.mjs"] },
  { "nome": "09 CLI sem calar o aviso do sqlite", "arquivo": "apps/omni-ilha/cofre.js", "de": "executar([AVISO, cli, ...args]", "para": "executar([cli, ...args]", "teste": ["testes/ilha-cofre-mao.test.mjs"] },
  { "nome": "10 valor sem a quebra de linha", "arquivo": "apps/omni-ilha/cofre.js", "de": "Buffer.concat([entrada, Buffer.from('\\n')])", "para": "Buffer.concat([entrada])", "teste": ["testes/ilha-cofre-mao.test.mjs"] },
  { "nome": "11 cópia do stdin sem zerar", "arquivo": "apps/omni-ilha/cofre.js", "de": "if (copia) copia.fill(0);", "para": "void 0;", "teste": ["testes/ilha-cofre-mao.test.mjs"] },
  { "nome": "12 Buffer de quem chamou sem zerar", "arquivo": "apps/omni-ilha/cofre.js", "de": "finally { if (Buffer.isBuffer(valor)) valor.fill(0); }", "para": "finally { void 0; }", "teste": ["testes/ilha-cofre-mao.test.mjs"] },
  { "nome": "13 valor de duas linhas aceito", "arquivo": "apps/omni-ilha/cofre.js", "de": "valor.length > 0 && !valor.includes(10) && ", "para": "valor.length > 0 && ", "teste": ["testes/ilha-cofre-mao.test.mjs"] },
  { "nome": "14 fd 3 aberto em todo pedido", "arquivo": "apps/omni-ilha/cofre.js", "de": "'pipe', 'pipe', ...(canal ? ['pipe'] : [])]", "para": "'pipe', 'pipe', 'pipe']", "teste": ["testes/ilha-cofre-mao.test.mjs"] },
  { "nome": "15 revelado volta na recusa", "arquivo": "apps/omni-ilha/cofre.js", "de": "if (res.ok) res.valor = r.valor;\n      else r.valor.fill(0);", "para": "res.valor = r.valor;", "teste": ["testes/ilha-cofre-mao.test.mjs"] },
  { "nome": "16 pedaços do fd 3 sem zerar", "arquivo": "apps/omni-ilha/cofre.js", "de": "        zerarValor();\n        resolver(", "para": "        resolver(", "teste": ["testes/ilha-cofre-mao.test.mjs"] },
  { "nome": "17 tempo esgotado sem matar", "arquivo": "apps/omni-ilha/cofre.js", "de": "motivo ??= porque; try { filho.kill(); } catch { /* já saiu */ }", "para": "motivo ??= porque;", "teste": ["testes/ilha-cofre-mao.test.mjs"] },
  { "nome": "18 revelar com o limite médio", "arquivo": "apps/omni-ilha/cofre.js", "de": "{ ms: LIMITES.longo, canal: true }", "para": "{ ms: LIMITES.medio, canal: true }", "teste": ["testes/ilha-cofre-mao.test.mjs"] },
  { "nome": "19 testar com o limite curto", "arquivo": "apps/omni-ilha/cofre.js", "de": "pedir(['testar', ...opcoes([['nome', nome]])], { ms: LIMITES.medio })", "para": "pedir(['testar', ...opcoes([['nome', nome]])])", "teste": ["testes/ilha-cofre-mao.test.mjs"] },
  { "nome": "20 stdout sem teto", "arquivo": "apps/omni-ilha/cofre.js", "de": "if (tamSaida > TETOS.saida) matar('teto'); else saida.push(pedaco);", "para": "saida.push(pedaco);", "teste": ["testes/ilha-cofre-mao.test.mjs"] },
  { "nome": "21 fd 3 sem teto", "arquivo": "apps/omni-ilha/cofre.js", "de": "if (tamValor > TETOS.valor) { matar('teto'); zerarValor(); }", "para": "void tamValor;", "teste": ["testes/ilha-cofre-mao.test.mjs"] },
  { "nome": "22 recusa lida na saída errada", "arquivo": "apps/omni-ilha/cofre.js", "de": "if (r.codigo === 3)", "para": "if (r.codigo === 4)", "teste": ["testes/ilha-cofre-mao.test.mjs"] },
  { "nome": "23 erro de uso vazio", "arquivo": "apps/omni-ilha/cofre.js", "de": "codigo: 'uso', erro: primeiraLinha(r.stderr) }", "para": "codigo: 'uso', erro: '' }", "teste": ["testes/ilha-cofre-mao.test.mjs"] },
  { "nome": "24 primeira linha sem corte", "arquivo": "apps/omni-ilha/cofre.js", "de": ".split(/\\r?\\n/)[0].slice(0, 300)", "para": ".split(/\\r?\\n/)[0]", "teste": ["testes/ilha-cofre-mao.test.mjs"] },
  { "nome": "25 recusa sem conferir a forma", "arquivo": "apps/omni-ilha/cofre.js", "de": "if (recusa && recusa.ok === false && typeof recusa.codigo === 'string') return", "para": "if (recusa) return", "teste": ["testes/ilha-cofre-mao.test.mjs"] },
  { "nome": "26 agentes descartados", "arquivo": "apps/omni-ilha/cofre.js", "de": "['agentes', Array.isArray(dados.agentes) ? dados.agentes.join(',') : dados.agentes],", "para": "['agentes', undefined],", "teste": ["testes/ilha-cofre-mao.test.mjs"] },
  { "nome": "27 sonda ignora a saída do Node", "arquivo": "apps/omni-ilha/cofre.js", "de": "if (r.motivo !== null || r.codigo !== 0) return sem(", "para": "if (r.motivo !== null) return sem(", "teste": ["testes/ilha-cofre-mao.test.mjs"] },
  { "nome": "28 mudanças sem virar JSON", "arquivo": "apps/omni-ilha/cofre.js", "de": "mudancas === undefined ? undefined : JSON.stringify(mudancas)", "para": "mudancas", "teste": ["testes/ilha-cofre-mao.test.mjs"] },
  { "nome": "29 saúde sem as duplicatas", "arquivo": "apps/omni-ilha/cofre.js", "de": "pedir(['saude', '--duplicatas'], { ms: LIMITES.medio })", "para": "pedir(['saude'], { ms: LIMITES.medio })", "teste": ["testes/ilha-cofre-mao.test.mjs"] },
  { "nome": "30 janela do console à mostra", "arquivo": "apps/omni-ilha/cofre.js", "de": "windowsHide: true", "para": "windowsHide: false", "teste": ["testes/ilha-cofre-mao.test.mjs"] },
  { "nome": "31 revelar sem o fd 3", "arquivo": "apps/omni-ilha/cofre.js", "de": "{ ms: LIMITES.longo, canal: true }", "para": "{ ms: LIMITES.longo }", "teste": ["testes/ilha-cofre-mao.test.mjs"] }
]
```

Mapa previsto de mutante para teste:

| Mutante | Morre em | Como cai |
|---|---|---|
| 01 | MC 1 | `equal` do comando da sonda |
| 02 | MC 1 | `equal` do `ELECTRON_RUN_AS_NODE` da sonda |
| 03 | MC 1 | `equal`: o `ELECTRON_RUN_AS_NODE` chega ao ambiente da CLI |
| 04 | MC 2 | deepEqual: o Electron passa da sonda |
| 05 | MC 1 a MC 9 | o 22.13.0 recusado: `equal` do `versaoServe` na MC 2, `ok` ("a CLI não foi chamada") na MC 5, `equal` de `aUnicaChamada` na MC 8 e na MC 9, deepEqual nas outras |
| 06 | MC 2 | `equal` do `versaoServe` ("22.12.9") |
| 07 | MC 1 | `equal` do número de sondas |
| 08 | MC 3 | deepEqual: o pedido seguinte repete a falha guardada |
| 09 | MC 1 e MC 6 | deepEqual dos argumentos |
| 10 | MC 7 | deepEqual do que o stdin recebeu |
| 11 | MC 7 | `ok` ("a cópia com a quebra de linha ficou com o valor") |
| 12 | MC 7 | `ok` ("o Buffer de quem chamou ficou com o valor") |
| 13 | MC 7 | deepEqual: o valor de duas linhas chega à CLI |
| 14 | MC 1 e MC 6 | deepEqual do stdio |
| 15 | MC 8 e MC 10 | deepEqual da recusa, com `valor`, na MC 8; `equal` de `'valor' in` na MC 10 |
| 16 | MC 8 | `ok` ("os pedaços do fd 3 ficaram com o valor") |
| 17 | MC 5 e MC 9 | `equal` das mortes |
| 18 | MC 5 | `equal` do prazo |
| 19 | MC 5 | `equal` do prazo |
| 20 | MC 9 | `equal` do código (`teto`) |
| 21 | MC 9 | `equal` do código (`teto`), antes do deepEqual |
| 22 | MC 4, MC 8 e MC 10 | a recusa vira `falha`: deepEqual na MC 4 e na MC 8, `equal` do código na MC 10 |
| 23 | MC 4 e MC 10 | deepEqual do erro de uso |
| 24 | MC 9 | `equal` do tamanho do erro (300) |
| 25 | MC 4 | deepEqual: a saída 3 com `{"ok":true}` passa como recusa |
| 26 | MC 6 | deepEqual dos argumentos |
| 27 | MC 3 | deepEqual: a sonda que saiu com 1 passa |
| 28 | MC 6 e MC 10 | deepEqual dos argumentos na MC 6; na MC 10, `equal` do código (`uso` no lugar de `inexistente`) |
| 29 | MC 6 | deepEqual dos argumentos |
| 30 | MC 1 | `equal` do `windowsHide` |
| 31 | MC 6, MC 8, MC 9 e MC 10 | deepEqual do stdio na MC 6 e na MC 8; `equal` do código na MC 9 e na MC 10 |

- [x] **Passo 5: extrair a lista e anotar os hashes.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so mutantes.mjs tabela-mutantes-p5.mjs mutantes-p5-t5.json
$alvos = 'apps/omni-ilha/cofre.js', 'testes/ilha-cofre-mao.test.mjs'
$alvos | ForEach-Object { $_ + ' ' + (Get-FileHash $_ -Algorithm SHA256).Hash.Substring(0, 12) } | Set-Content -Encoding utf8 "$rascunho\hashes-antes-p5-t5.txt"
Get-Content "$rascunho\hashes-antes-p5-t5.txt"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `igual mutantes.mjs`, `igual tabela-mutantes-p5.mjs`, `gravado mutantes-p5-t5.json`, as duas linhas de hash e `False`.

Resultado (07/11): `igual mutantes.mjs`, `igual tabela-mutantes-p5.mjs` e `igual mutantes-p5-t5.json`, e não `gravado`: o ensaio tinha deixado no `$rascunho` a mesma lista, byte a byte; os hashes `apps/omni-ilha/cofre.js 9F1E9EE15F90` e `testes/ilha-cofre-mao.test.mjs D2636CCB418B`; e `False`.

- [x] **Passo 6: rodar, em segundo plano.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
node "$rascunho\mutantes.mjs" "$rascunho\mutantes-p5-t5.json" *> "$rascunho\mutantes-p5-t5.txt"; "saida: $LASTEXITCODE"
```

Esperado: a última linha de `mutantes-p5-t5.txt` é `31 mutantes em … s; fora do vermelho: 0`, e `saida: 0`.

Resultado (07/11): `31 mutantes em 49 s; fora do vermelho: 0`, `saida: 0` e `False`.

- [x] **Passo 7: a tabela, os hashes e a guarda.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
$alvos = 'apps/omni-ilha/cofre.js', 'testes/ilha-cofre-mao.test.mjs'
node "$rascunho\tabela-mutantes-p5.mjs" "$rascunho\mutantes-p5-t5.json"; "saida: $LASTEXITCODE"
$depois = $alvos | ForEach-Object { $_ + ' ' + (Get-FileHash $_ -Algorithm SHA256).Hash.Substring(0, 12) }
Compare-Object (Get-Content "$rascunho\hashes-antes-p5-t5.txt") $depois
git status --short
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --conferir; "saida: $LASTEXITCODE"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado:
- `31 linhas: 31 vermelhos, 0 equivalente(s); testes mapeados: 50`, nenhuma linha `PROBLEMA` e `saida: 0`;
- o `Compare-Object` calado;
- no status, além dos ` M dist/…` de fim de linha (item 15), as quinze linhas da T4 e mais duas: `?? apps/omni-ilha/cofre.js` e `?? testes/ilha-cofre-mao.test.mjs`;
- vinte e quatro `igual` (os vinte e um da T4, mais a MC, a mão e a lista da T5), nenhum `AUSENTE` e `saida: 0`;
- `False`.

A tabela gerada (`$rascunho\mutantes-p5-t5.tabela.md`) entra no Apêndice E.

Resultado (07/11): `31 linhas: 31 vermelhos, 0 equivalente(s); testes mapeados: 50`, nenhum `PROBLEMA` e `saida: 0`; o `Compare-Object` calado; no status, as dezessete linhas esperadas além dos ` M dist/…`; vinte e quatro `igual`, nenhum `AUSENTE` e `saida: 0`; e `False`. Cada mutante caiu nos testes e pelo operador do mapa, todos por `ERR_ASSERTION`, e a tabela é idêntica, linha a linha, à do ensaio feito numa cópia antes da escrita.

### Task 6: a janela do cofre e os IPCs

**Arquivos:** criar `apps/omni-ilha/cofre-ipc.js` (os canais), `cofre-preload.js`, `cofre.html` e `cofre-janela.js` (a janela) e `testes/ilha-cofre-ipc.test.mjs` (IC, 9 testes); modificar `apps/omni-ilha/main.js` e `preload.js`, pela costura. Rascunhos: `costura-t6.mjs`, `semente-t6.mjs`, `bancada-t6.js` e `prova-t6.ps1`.

Os canais (`cofre-ipc.js`, CommonJS como o resto da ilha):
- `registrarIpcCofre({ ipcMain, mao, clipboard, daJanela, daIlha })` registra quinze canais da janela (`cofre:listar`, `lixeira`, `esvaziar`, `saude`, `historico`, `testar`, `cadastrar`, `cadastrar-da-area`, `editar`, `rotacionar`, `rotacionar-da-area`, `apagar`, `restaurar`, `revelar` e `copiar`) e o `cofre:resumo` da ilha, e devolve a lista deles. Os da janela atendem só a janela do cofre, e o resumo só a ilha; remetente errado recebe `null` sem chamar a mão nem ler a área, como os outros canais do `main.js`;
- cada canal converte o que vem do renderer: nome e id viram `String`; a saúde só pede duplicatas com `true` de verdade; o histórico vai com `limite: 50`; o cadastro leva só os campos que a CLI `cadastrar` aceita (`nome`, `tipo`, `servico`, `url`, `usuario`, `notas`, aparados, e os vazios fora) e os `agentes` em lista, por vírgula. Validade, etiquetas e rotação entram depois, pela edição;
- o valor digitado (cadastrar, rotacionar) vira um Buffer UTF-8, que vai à mão e é zerado no `finally`. A mão zera a cópia dela (T5);
- da área (decisão 10): o main lê a área, tira uma quebra de linha do fim (`\n` ou `\r\n`) e recusa a área vazia (`area-vazia`) e a de várias linhas (`varias-linhas`), sem pôr o texto no erro. O texto vira Buffer, como o digitado. A área só é limpa se o pedido deu certo e ela ainda guarda o mesmo texto: se o Weriton copiou outra coisa enquanto a CLI rodava, nada se apaga;
- revelar: o Buffer da mão vira texto para o renderer, com `prazoMs: 30000`, e é zerado aqui. Resposta ok sem Buffer vira `sem-valor`; a recusa passa como veio;
- o resumo do card (T7) pede a saúde sem duplicata e devolve `{ ok, total, alertas, primeiros }`: o número de alertas e só regra e nome dos três primeiros.

A janela (decisão 9):
- `cofre-preload.js` expõe `window.cofre`, só com os canais `cofre:*`, e converte cada argumento antes de mandar: texto vira `String`, o cadastro só leva os seus campos, as mudanças da edição saem como objeto simples;
- `cofre.html`: lista à esquerda, com busca e os filtros de tipo, serviço, agente e situação (com alerta, teste falhou, nunca testada, só no Gerenciador), e a ficha à direita; sem escolha, a saúde, com o botão de conferir valores repetidos. A vista da lixeira troca a lista. A família visual é a da ilha e do Overcore, com verde-água no lugar do azul. O comentário do topo declara as escalas (letra 11/13/16/22, raio 4/8 e pílula, espaço em múltiplos de 4) e a regra de um só botão cheio por tela. A CSP só aceita script de `'self'`;
- `cofre-janela.js`: ao abrir, esvazia a lixeira vencida e lê tudo; relê ao ganhar o foco, no máximo a cada 10 s, e depois de cada ação. Tudo que vem do cofre entra escapado. A ficha mostra os campos, o último teste, os avisos da saúde (no singular, `REGRA_UMA`) e as ações: ver, copiar, testar, histórico, editar, trocar o valor e apagar, este com confirmação. Na credencial do Gerenciador, ver, copiar, testar e trocar ficam desligados. O formulário de nova e o de trocar aceitam o valor digitado ou "da área"; o valor digitado sai do campo assim que é enviado. O revelado fica numa caixa só, até 30 s, e some ao trocar de credencial, ao perder o foco, com Esc, no botão esconder ou no fim do prazo. Uma ação por vez (`est.ocupado`), liberada no `finally`. `window.omniCofreDepurar()` devolve o estado sem o valor, para a bancada.

A costura (`costura-t6.mjs`, rascunho, roda da raiz): o `main.js` e o `preload.js` da ilha mudam por âncora, sem colar o arquivo inteiro no plano. Cada troca acrescenta texto logo depois de uma âncora que tem de aparecer uma vez só; se o acréscimo já está lá, a troca é pulada, e rodar de novo dá `igual`. Âncora ausente ou repetida sai com 1 sem gravar nada. O fim de linha do arquivo é preservado: no worktree os dois estão em CRLF pelo `core.autocrlf`, e o índice guarda LF. Com `--conferir`, só confere. As trocas:
- `main.js`: `clipboard` no `require('electron')`; `criarMaoCofre` e `registrarIpcCofre` depois do `require('./whatsapp')`; `janelaCofre` e `abrirCofre` na api da bancada (`OMNI_ILHA_TESTE`), ao lado de `janelaOvercore`; e, depois do `oracle:resumo`, a janela do cofre: uma só, como a do Overcore, com `contextIsolation`, `sandbox`, sem `nodeIntegration`, navegação e janela nova negadas, e `setContentProtection(true)`, que pede ao Windows para deixá-la fora da captura de tela de outros programas, porque mostra o valor revelado. O `abrir-cofre` atende só a ilha, e o `registrarIpcCofre` liga os canais com a mão da T5;
- `preload.js`: `abrirCofre` e `resumoCofre` na `window.ilha`, ao lado do `resumoOvercore`.

A IC usa um `ipcMain` que é um Map, uma mão que anota as chamadas e responde o que a prova manda, e uma área que é um objeto com texto. Nenhum processo nasce, nenhuma área real é lida e nenhum valor real passa. A janela não tem suíte: quem a prova é a prova visual (Passo 10), com 23 conferências e 9 fotos, numa cópia da ilha com a casa temporária.

- [x] **Passo 1: o teste.**

```js arquivo=testes/ilha-cofre-ipc.test.mjs
// Os canais do cofre na ilha (F1, plano 5, T6). Tudo é falso: o ipcMain é um Map, a mão anota as chamadas
// e responde o que a prova manda, a área de transferência é um objeto com texto. Nenhum processo nasce,
// nenhuma área real é lida e nenhum valor real passa.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { registrarIpcCofre, dadosDoCadastro, textoDaArea, PRAZO_REVELADO_MS } = require('../apps/omni-ilha/cofre-ipc.js')

const DA_JANELA = { sender: 'janela do cofre' }
const DA_ILHA = { sender: 'ilha' }
const DE_FORA = { sender: 'outra janela' }
const zerado = (b) => b.every((x) => x === 0)
const NOMES = ['listar', 'lixeira', 'esvaziarLixeira', 'saude', 'historico', 'testar', 'cadastrar', 'editar', 'rotacionar', 'apagar', 'restaurar', 'revelar', 'copiar']
const CANAIS_DA_JANELA = ['cofre:listar', 'cofre:lixeira', 'cofre:esvaziar', 'cofre:saude', 'cofre:historico', 'cofre:testar', 'cofre:cadastrar',
  'cofre:cadastrar-da-area', 'cofre:editar', 'cofre:rotacionar', 'cofre:rotacionar-da-area', 'cofre:apagar', 'cofre:restaurar', 'cofre:revelar', 'cofre:copiar']

// A mão anota o texto de cada Buffer no momento da chamada e guarda o próprio Buffer para a prova conferir depois.
function montar({ respostas = {}, area = '' } = {}) {
  const chamadas = []
  const mao = {}
  for (const nome of NOMES) {
    mao[nome] = async (...args) => {
      chamadas.push({ nome, args: args.map((a) => (Buffer.isBuffer(a) ? { buffer: a.toString('utf8') } : a)), buffers: args.filter(Buffer.isBuffer) })
      return respostas[nome] ? respostas[nome](...args) : { ok: true, dados: { de: nome } }
    }
  }
  const clipboard = { texto: area, leituras: 0, limpezas: 0, readText() { this.leituras += 1; return this.texto }, clear() { this.limpezas += 1; this.texto = '' } }
  const handlers = new Map()
  const ipcMain = { handle(canal, fn) { assert.equal(handlers.has(canal), false, `canal repetido: ${canal}`); handlers.set(canal, fn) } }
  const canais = registrarIpcCofre({ ipcMain, mao, clipboard, daJanela: (e) => e === DA_JANELA, daIlha: (e) => e === DA_ILHA })
  const invocar = async (canal, evento, ...args) => handlers.get(canal)(evento, ...args)
  return { chamadas, clipboard, handlers, canais, invocar }
}

test('registra os canais da janela e o resumo da ilha, e só eles', () => {
  const { canais, handlers } = montar()
  assert.deepEqual(canais, [...CANAIS_DA_JANELA, 'cofre:resumo'])
  assert.deepEqual([...handlers.keys()], canais)
})

test('remetente errado recebe null e a mão não é chamada', async () => {
  const { chamadas, clipboard, invocar } = montar({ area: 'valor-da-area' })
  for (const canal of CANAIS_DA_JANELA) {
    assert.equal(await invocar(canal, DA_ILHA, 'a', 'b'), null, `${canal} aceitou a ilha`)
    assert.equal(await invocar(canal, DE_FORA, 'a', 'b'), null, `${canal} aceitou outra janela`)
  }
  assert.equal(await invocar('cofre:resumo', DA_JANELA), null, 'o resumo aceitou a janela do cofre')
  assert.equal(await invocar('cofre:resumo', DE_FORA), null, 'o resumo aceitou outra janela')
  assert.deepEqual(chamadas, [])
  assert.equal(clipboard.leituras, 0, 'a área foi lida para um remetente errado')
})

test('cada canal da janela chama a sua função da mão com os argumentos certos', async () => {
  const casos = [
    ['cofre:listar', [], 'listar', []],
    ['cofre:lixeira', [], 'lixeira', []],
    ['cofre:esvaziar', [], 'esvaziarLixeira', []],
    ['cofre:saude', [true], 'saude', [{ duplicatas: true }]],
    ['cofre:saude', ['true'], 'saude', [{ duplicatas: false }]],
    ['cofre:saude', [], 'saude', [{ duplicatas: false }]],
    ['cofre:historico', [7], 'historico', [{ id: '7', limite: 50 }]],
    ['cofre:testar', ['omni/teste'], 'testar', ['omni/teste']],
    ['cofre:editar', ['omni/teste', { notas: 'nova' }], 'editar', ['omni/teste', { notas: 'nova' }]],
    ['cofre:apagar', ['omni/teste'], 'apagar', ['omni/teste']],
    ['cofre:restaurar', [5], 'restaurar', ['5']],
    ['cofre:copiar', ['omni/teste'], 'copiar', ['omni/teste']],
  ]
  for (const [canal, args, nome, esperado] of casos) {
    const { chamadas, invocar } = montar()
    assert.deepEqual(await invocar(canal, DA_JANELA, ...args), { ok: true, dados: { de: nome } }, canal)
    assert.deepEqual(chamadas.map((c) => ({ nome: c.nome, args: c.args })), [{ nome, args: esperado }], canal)
  }
})

test('dadosDoCadastro leva só os campos do cadastrar, aparados, e os agentes em lista', () => {
  assert.deepEqual(dadosDoCadastro({ nome: ' omni/teste ', tipo: 'token', servico: '', url: '  ', usuario: 'robo', notas: 'n', agentes: 'omni, overcore ,', validade: '2027-01-01', etiquetas: ['x'] }),
    { nome: 'omni/teste', tipo: 'token', usuario: 'robo', notas: 'n', agentes: ['omni', 'overcore'] })
  assert.deepEqual(dadosDoCadastro({ nome: 'a', agentes: '' }), { nome: 'a', agentes: [] })
  assert.deepEqual(dadosDoCadastro(null), { agentes: [] })
  assert.deepEqual(dadosDoCadastro({ nome: 12 }), { nome: '12', agentes: [] })
})

test('cadastrar e rotacionar com o valor digitado mandam um Buffer UTF-8 e o zeram', async () => {
  const { chamadas, invocar } = montar()
  await invocar('cofre:cadastrar', DA_JANELA, { nome: ' omni/teste ', agentes: 'omni' }, 'ção-1')
  await invocar('cofre:rotacionar', DA_JANELA, 'omni/teste', 'ção-2')
  assert.deepEqual(chamadas.map((c) => ({ nome: c.nome, args: c.args })), [
    { nome: 'cadastrar', args: [{ nome: 'omni/teste', agentes: ['omni'] }, { buffer: 'ção-1' }] },
    { nome: 'rotacionar', args: ['omni/teste', { buffer: 'ção-2' }] },
  ])
  for (const c of chamadas) assert.ok(zerado(c.buffers[0]), `o Buffer do ${c.nome} ficou com o valor`)
})

test('textoDaArea tira uma quebra do fim e recusa vazio e várias linhas, sem pôr o valor no erro', () => {
  assert.deepEqual(textoDaArea('abc'), { ok: true, texto: 'abc' })
  assert.deepEqual(textoDaArea('abc\n'), { ok: true, texto: 'abc' })
  assert.deepEqual(textoDaArea('abc\r\n'), { ok: true, texto: 'abc' })
  for (const vazio of ['', '\n', '\r\n', undefined]) assert.equal(textoDaArea(vazio).codigo, 'area-vazia', JSON.stringify(vazio))
  for (const varias of ['a\nb', 'a\rb', 'abc\n\n', 'abc\r']) assert.equal(textoDaArea(varias).codigo, 'varias-linhas', JSON.stringify(varias))
  for (const texto of ['segredo-1\nx', '']) {
    const r = textoDaArea(texto)
    assert.equal(r.ok, false)
    assert.equal(typeof r.erro, 'string')
    assert.equal(r.erro.includes('segredo'), false, 'o erro levou o valor')
    assert.equal('texto' in r, false, 'a recusa levou o texto')
  }
})

test('da área: lê no main, manda Buffer, zera, e limpa a área só no sucesso e só se ela não mudou', async () => {
  {
    const { chamadas, clipboard, invocar } = montar({ area: 'valor-1\r\n' })
    const r = await invocar('cofre:cadastrar-da-area', DA_JANELA, { nome: 'omni/teste', agentes: 'omni', notas: '' })
    assert.deepEqual(r, { ok: true, dados: { de: 'cadastrar' } })
    assert.deepEqual(chamadas.map((c) => c.args), [[{ nome: 'omni/teste', agentes: ['omni'] }, { buffer: 'valor-1' }]])
    assert.ok(zerado(chamadas[0].buffers[0]), 'o Buffer da área ficou com o valor')
    assert.equal(clipboard.limpezas, 1, 'a área não foi limpa depois do sucesso')
  }
  {
    const { chamadas, clipboard, invocar } = montar({ area: 'valor-2' })
    await invocar('cofre:rotacionar-da-area', DA_JANELA, 'omni/teste')
    assert.deepEqual(chamadas.map((c) => c.args), [['omni/teste', { buffer: 'valor-2' }]])
    assert.equal(clipboard.limpezas, 1, 'a área não foi limpa depois da troca')
  }
  {
    const respostas = { rotacionar: () => ({ ok: false, codigo: 'inexistente', erro: 'não há' }) }
    const { clipboard, invocar } = montar({ area: 'valor-3', respostas })
    assert.deepEqual(await invocar('cofre:rotacionar-da-area', DA_JANELA, 'omni/teste'), { ok: false, codigo: 'inexistente', erro: 'não há' })
    assert.equal(clipboard.limpezas, 0, 'a área foi limpa numa recusa')
    assert.equal(clipboard.texto, 'valor-3')
  }
  {
    let clip
    const respostas = { cadastrar: () => { clip.texto = 'outra coisa copiada'; return { ok: true, dados: {} } } }
    const montado = montar({ area: 'valor-4', respostas })
    clip = montado.clipboard
    await montado.invocar('cofre:cadastrar-da-area', DA_JANELA, { nome: 'omni/teste' })
    assert.equal(clip.limpezas, 0, 'a área foi limpa depois de mudar')
    assert.equal(clip.texto, 'outra coisa copiada')
  }
  for (const [area, codigo] of [['', 'area-vazia'], ['a\nb', 'varias-linhas']]) {
    const { chamadas, clipboard, invocar } = montar({ area })
    const r = await invocar('cofre:rotacionar-da-area', DA_JANELA, 'omni/teste')
    assert.equal(r.codigo, codigo)
    assert.deepEqual(chamadas, [], 'a mão foi chamada com a área recusada')
    assert.equal(clipboard.limpezas, 0)
  }
})

test('revelar devolve o texto com o prazo, zera o Buffer e repassa a recusa', async () => {
  assert.equal(PRAZO_REVELADO_MS, 30000)
  {
    const valor = Buffer.from('ção-revelado')
    const { invocar } = montar({ respostas: { revelar: () => ({ ok: true, dados: { ok: true, nome: 'omni/teste', usoId: 3 }, valor }) } })
    assert.deepEqual(await invocar('cofre:revelar', DA_JANELA, 'omni/teste'), { ok: true, dados: { ok: true, nome: 'omni/teste', usoId: 3 }, valor: 'ção-revelado', prazoMs: 30000 })
    assert.ok(zerado(valor), 'o Buffer revelado ficou com o valor')
  }
  {
    const { invocar } = montar({ respostas: { revelar: () => ({ ok: true, dados: {}, valor: 'texto em vez de Buffer' }) } })
    assert.deepEqual(await invocar('cofre:revelar', DA_JANELA, 'omni/teste'), { ok: false, codigo: 'sem-valor', erro: 'o cofre não devolveu o valor' })
  }
  {
    const recusa = { ok: false, codigo: 'hello-negado', erro: 'o Windows Hello não confirmou' }
    const { chamadas, invocar } = montar({ respostas: { revelar: () => recusa } })
    assert.deepEqual(await invocar('cofre:revelar', DA_JANELA, 'omni/teste'), recusa)
    assert.deepEqual(chamadas.map((c) => c.args), [['omni/teste']])
  }
})

test('o resumo da ilha conta os alertas e mostra só regra e nome dos três primeiros', async () => {
  const alertas = [
    { regra: 'vence', nome: 'a', validade: '2026-11-10' },
    { regra: 'teste-falhou', nome: 'b', em: 'x' },
    { regra: 'sem-uso', nome: 'c', desde: 'y' },
    { regra: 'agente-nunca-usou', nome: 'd', agente: 'omni' },
  ]
  {
    const { chamadas, invocar } = montar({ respostas: { saude: () => ({ ok: true, dados: { ok: true, total: 9, alertas, duplicatas: [] } }) } })
    assert.deepEqual(await invocar('cofre:resumo', DA_ILHA), { ok: true, total: 9, alertas: 4, primeiros: [{ regra: 'vence', nome: 'a' }, { regra: 'teste-falhou', nome: 'b' }, { regra: 'sem-uso', nome: 'c' }] })
    assert.deepEqual(chamadas.map((c) => c.args), [[{ duplicatas: false }]])
  }
  {
    const falha = { ok: false, codigo: 'sem-node', erro: 'não achei o Node do sistema' }
    const { invocar } = montar({ respostas: { saude: () => falha } })
    assert.deepEqual(await invocar('cofre:resumo', DA_ILHA), falha)
  }
})
```

- [x] **Passo 2: extrair o teste e ver o vermelho.**

```powershell
Test-Path "$env:LOCALAPPDATA\omni\casa"
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so testes/ilha-cofre-ipc.test.mjs
node --test --test-concurrency=1 --test-reporter=spec testes/ilha-cofre-ipc.test.mjs *> "$rascunho\p5-t6-vermelho.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\p5-t6-vermelho.txt" -Pattern 'Cannot find module', '(tests|pass|fail) \d+\s*$'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `False`, `gravado testes/ilha-cofre-ipc.test.mjs`, `saida: 1`, `Cannot find module '../apps/omni-ilha/cofre-ipc.js'`, `tests 1`, `pass 0`, `fail 1` e `False`.

Resultado (07/11): `False`, `gravado testes/ilha-cofre-ipc.test.mjs`, `saida: 1`, `Error: Cannot find module '../apps/omni-ilha/cofre-ipc.js'`, `tests 1`, `pass 0`, `fail 1` e `False`.

- [x] **Passo 3: os canais.**

```js arquivo=apps/omni-ilha/cofre-ipc.js
'use strict';

// Os canais do cofre na ilha (F1, plano 5, T6). A janela do cofre só fala com a mão por aqui, e cada canal
// confere o remetente: os da janela atendem só a janela do cofre, o resumo atende só a ilha; remetente errado
// recebe null, como os outros canais do main.js. A mão (cofre.js) roda a CLI; este módulo só converte o que
// vem do renderer (texto) no que a mão pede (Buffer) e o que a mão devolve (Buffer) no que o renderer mostra.
// Segredo: o valor digitado e o da área de transferência viram um Buffer que é zerado depois do pedido; a área
// é lida aqui no main, nunca no renderer, e só é limpa se o pedido deu certo e ela ainda guarda o mesmo texto.
// O revelado vai ao renderer como texto, com o prazo para sumir da tela, e o Buffer dele é zerado aqui.

const PRAZO_REVELADO_MS = 30000;
const CAMPOS_DO_CADASTRO = ['nome', 'tipo', 'servico', 'url', 'usuario', 'notas'];

// A CLI cadastrar recebe só estes campos; validade, etiquetas e rotação entram depois, pela edição.
function dadosDoCadastro(dados) {
  const d = dados && typeof dados === 'object' ? dados : {};
  const saida = {};
  for (const campo of CAMPOS_DO_CADASTRO) {
    const v = String(d[campo] ?? '').trim();
    if (v) saida[campo] = v;
  }
  saida.agentes = String(d.agentes ?? '').split(',').map((a) => a.trim()).filter(Boolean);
  return saida;
}

// Tira uma quebra de linha do fim (quem copia uma linha costuma levar o \n junto) e recusa o resto.
// A recusa nunca leva o texto.
function textoDaArea(texto) {
  const t = String(texto ?? '').replace(/\r?\n$/, '');
  if (t === '') return { ok: false, codigo: 'area-vazia', erro: 'a área de transferência está vazia' };
  if (/[\r\n]/.test(t)) return { ok: false, codigo: 'varias-linhas', erro: 'a área de transferência tem mais de uma linha; o valor precisa ser de uma linha só' };
  return { ok: true, texto: t };
}

const bufferDoTexto = (valor) => Buffer.from(String(valor ?? ''), 'utf8');

async function comBuffer(buf, pedido) {
  try { return await pedido(buf); } finally { buf.fill(0); }
}

async function daArea(clipboard, pedido) {
  const lido = clipboard.readText();
  const r = textoDaArea(lido);
  if (!r.ok) return r;
  const resposta = await comBuffer(bufferDoTexto(r.texto), pedido);
  if (resposta && resposta.ok && clipboard.readText() === lido) clipboard.clear();
  return resposta;
}

async function revelar(mao, nome) {
  const r = await mao.revelar(String(nome));
  if (!r || !r.ok) return r;
  const valor = r.valor;
  try {
    if (!Buffer.isBuffer(valor)) return { ok: false, codigo: 'sem-valor', erro: 'o cofre não devolveu o valor' };
    return { ok: true, dados: r.dados, valor: valor.toString('utf8'), prazoMs: PRAZO_REVELADO_MS };
  } finally { if (Buffer.isBuffer(valor)) valor.fill(0); }
}

async function resumo(mao) {
  const r = await mao.saude({ duplicatas: false });
  if (!r || !r.ok) return r;
  const alertas = Array.isArray(r.dados && r.dados.alertas) ? r.dados.alertas : [];
  return { ok: true, total: Number(r.dados.total) || 0, alertas: alertas.length, primeiros: alertas.slice(0, 3).map(({ regra, nome }) => ({ regra, nome })) };
}

function registrarIpcCofre({ ipcMain, mao, clipboard, daJanela, daIlha }) {
  const canais = [];
  const daJanelaDoCofre = (canal, fn) => {
    canais.push(canal);
    ipcMain.handle(canal, (evento, ...args) => (daJanela(evento) ? fn(...args) : null));
  };
  daJanelaDoCofre('cofre:listar', () => mao.listar());
  daJanelaDoCofre('cofre:lixeira', () => mao.lixeira());
  daJanelaDoCofre('cofre:esvaziar', () => mao.esvaziarLixeira());
  daJanelaDoCofre('cofre:saude', (duplicatas) => mao.saude({ duplicatas: duplicatas === true }));
  daJanelaDoCofre('cofre:historico', (id) => mao.historico({ id: String(id), limite: 50 }));
  daJanelaDoCofre('cofre:testar', (nome) => mao.testar(String(nome)));
  daJanelaDoCofre('cofre:cadastrar', (dados, valor) => comBuffer(bufferDoTexto(valor), (buf) => mao.cadastrar(dadosDoCadastro(dados), buf)));
  daJanelaDoCofre('cofre:cadastrar-da-area', (dados) => daArea(clipboard, (buf) => mao.cadastrar(dadosDoCadastro(dados), buf)));
  daJanelaDoCofre('cofre:editar', (nome, mudancas) => mao.editar(String(nome), mudancas));
  daJanelaDoCofre('cofre:rotacionar', (nome, valor) => comBuffer(bufferDoTexto(valor), (buf) => mao.rotacionar(String(nome), buf)));
  daJanelaDoCofre('cofre:rotacionar-da-area', (nome) => daArea(clipboard, (buf) => mao.rotacionar(String(nome), buf)));
  daJanelaDoCofre('cofre:apagar', (nome) => mao.apagar(String(nome)));
  daJanelaDoCofre('cofre:restaurar', (id) => mao.restaurar(String(id)));
  daJanelaDoCofre('cofre:revelar', (nome) => revelar(mao, nome));
  daJanelaDoCofre('cofre:copiar', (nome) => mao.copiar(String(nome)));
  canais.push('cofre:resumo');
  ipcMain.handle('cofre:resumo', (evento) => (daIlha(evento) ? resumo(mao) : null));
  return canais;
}

module.exports = { registrarIpcCofre, dadosDoCadastro, textoDaArea, PRAZO_REVELADO_MS };
```

- [x] **Passo 4: extrair os canais e ver o verde.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so apps/omni-ilha/cofre-ipc.js
node --check apps/omni-ilha/cofre-ipc.js; "check: $LASTEXITCODE"
node --test --test-concurrency=1 --test-reporter=spec testes/ilha-cofre-ipc.test.mjs *> "$rascunho\p5-t6-verde.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\p5-t6-verde.txt" -Pattern '(tests|pass|fail) \d+\s*$'
foreach ($a in 'apps/omni-ilha/cofre-ipc.js', 'testes/ilha-cofre-ipc.test.mjs') { $a + ' CR: ' + ([IO.File]::ReadAllText((Resolve-Path $a)).Split([char]13).Count - 1) }
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `gravado apps/omni-ilha/cofre-ipc.js`, `check: 0`, `tests 9`, `pass 9`, `fail 0`, `saida: 0`, CR 0 nos dois e `False`.

Resultado (07/11): `gravado apps/omni-ilha/cofre-ipc.js`, `check: 0`, `tests 9`, `pass 9`, `fail 0`, `saida: 0`, CR 0 nos dois e `False`.

- [x] **Passo 5: a janela.**

```js arquivo=apps/omni-ilha/cofre-preload.js
'use strict';

// window.cofre: a ponte da janela do cofre (F1, plano 5, T6). Só os canais cofre:*, e cada argumento sai
// convertido: texto vira String, os dados do cadastro só levam os campos do cadastro, as mudanças da edição
// saem como objeto simples. O main confere o remetente e o resto (cofre-ipc.js).
const { contextBridge, ipcRenderer } = require('electron');

const texto = (v) => String(v ?? '');
const CAMPOS_DO_CADASTRO = ['nome', 'tipo', 'servico', 'url', 'usuario', 'notas', 'agentes'];
const doCadastro = (dados) => Object.fromEntries(CAMPOS_DO_CADASTRO.map((c) => [c, texto(dados?.[c])]));
const mudancas = (m) => (m && typeof m === 'object' && !Array.isArray(m) ? JSON.parse(JSON.stringify(m)) : {});

contextBridge.exposeInMainWorld('cofre', {
  listar: () => ipcRenderer.invoke('cofre:listar'),
  lixeira: () => ipcRenderer.invoke('cofre:lixeira'),
  esvaziar: () => ipcRenderer.invoke('cofre:esvaziar'),
  saude: (duplicatas) => ipcRenderer.invoke('cofre:saude', duplicatas === true),
  historico: (id) => ipcRenderer.invoke('cofre:historico', texto(id)),
  testar: (nome) => ipcRenderer.invoke('cofre:testar', texto(nome)),
  cadastrar: (dados, valor) => ipcRenderer.invoke('cofre:cadastrar', doCadastro(dados), texto(valor)),
  cadastrarDaArea: (dados) => ipcRenderer.invoke('cofre:cadastrar-da-area', doCadastro(dados)),
  editar: (nome, m) => ipcRenderer.invoke('cofre:editar', texto(nome), mudancas(m)),
  rotacionar: (nome, valor) => ipcRenderer.invoke('cofre:rotacionar', texto(nome), texto(valor)),
  rotacionarDaArea: (nome) => ipcRenderer.invoke('cofre:rotacionar-da-area', texto(nome)),
  apagar: (nome) => ipcRenderer.invoke('cofre:apagar', texto(nome)),
  restaurar: (id) => ipcRenderer.invoke('cofre:restaurar', texto(id)),
  revelar: (nome) => ipcRenderer.invoke('cofre:revelar', texto(nome)),
  copiar: (nome) => ipcRenderer.invoke('cofre:copiar', texto(nome)),
});
```

```html arquivo=apps/omni-ilha/cofre.html
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:">
<title>Cofre</title>
<style>
/* Janela do cofre (F1, plano 5, T6): a gestão das credenciais. Lista à esquerda, ficha à direita; a lixeira
   troca a lista. Mesma família visual da ilha e do Overcore; verde-água no lugar do azul. O valor revelado
   aparece numa caixa só, com prazo, e some ao trocar de credencial, ao perder o foco ou no fim do prazo.
   Escalas: letra 11/13/16/22 (razão ~1,2 sobre 13), raio 4/8 e pílula, espaço em múltiplos de 4.
   Um só botão cheio por tela: o de confirmar o que está aberto (guardar, trocar, restaurar). */
:root {
  --fundo: #11141a; --vidro: rgba(255, 255, 255, .035); --vidro-luz: rgba(255, 255, 255, .08);
  --fio-luz: rgba(255, 255, 255, .12); --fio: rgba(255, 255, 255, .06);
  --tinta: #e8ebf2; --tinta-2: #9aa2b5; --tinta-3: #8a91a3;
  --cofre: #74d4c0; --verde: #9fe045; --laranja: #f5a35f; --vermelho: #f07b7b;
  --l-meta: 11px; --l-corpo: 13px; --l-titulo: 16px; --l-numero: 22px;
  --r-marca: 4px; --r: 8px; --r-pilula: 999px;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { font: 400 var(--l-corpo)/1.5 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; color: var(--tinta); background: var(--fundo); display: grid; grid-template-rows: 40px auto 1fr; overflow: hidden; }
button, input, select, textarea { font: inherit; color: inherit; }
button:disabled { opacity: .45; cursor: default; }
.topo { -webkit-app-region: drag; display: flex; align-items: center; gap: 12px; padding: 0 152px 0 16px; border-bottom: 1px solid var(--fio); }
.topo h1 { font-size: var(--l-corpo); font-weight: 600; margin: 0; }
.status { color: var(--tinta-2); font-size: var(--l-meta); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.status b { color: var(--laranja); font-weight: 600; }
.vistas { -webkit-app-region: no-drag; display: flex; gap: 4px; margin-left: 12px; }
.chip { border: 0; background: var(--vidro); box-shadow: inset 0 0 0 1px var(--fio); color: var(--tinta-2); font-size: var(--l-meta); padding: 4px 8px; border-radius: var(--r-pilula); cursor: pointer; white-space: nowrap; }
.chip:hover { color: var(--tinta); }
.chip.ativa { color: var(--tinta); background: rgba(116, 212, 192, .14); box-shadow: inset 0 0 0 1px rgba(116, 212, 192, .5); font-weight: 600; }
.chip .n { margin-left: 4px; font-weight: 700; }
.campo { -webkit-app-region: no-drag; height: 28px; padding: 0 8px; border: 0; border-radius: var(--r); font-size: var(--l-corpo); outline: none; background: var(--vidro); box-shadow: inset 0 0 0 1px var(--fio); }
.campo:focus { box-shadow: inset 0 0 0 1px var(--cofre); }
#busca { margin-left: auto; width: 200px; }
.barra { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 16px; border-bottom: 1px solid var(--fio); }
.barra .bt { margin-left: auto; }
.corpo { display: grid; grid-template-columns: minmax(260px, 360px) 1fr; min-height: 0; }
.lista { overflow-y: auto; padding: 8px; border-right: 1px solid var(--fio); display: flex; flex-direction: column; gap: 4px; }
.item { -webkit-app-region: no-drag; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0 8px; width: 100%; text-align: left; border: 0; border-radius: var(--r); padding: 8px 12px; background: transparent; cursor: pointer; }
.item:hover { background: var(--vidro); }
.item.sel { background: rgba(116, 212, 192, .1); box-shadow: inset 0 0 0 1px rgba(116, 212, 192, .45); }
.item .nome { font-weight: 600; font-size: var(--l-corpo); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item .sub { grid-column: 1 / -1; color: var(--tinta-3); font-size: var(--l-meta); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.marcas { display: flex; gap: 4px; align-items: center; }
.marca { font-size: var(--l-meta); font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: 0 4px; border-radius: var(--r-marca); }
.m-alerta { color: var(--laranja); box-shadow: inset 0 0 0 1px rgba(245, 163, 95, .45); }
.m-falhou { color: var(--vermelho); box-shadow: inset 0 0 0 1px rgba(240, 123, 123, .45); }
.m-gerenciador { color: var(--tinta-2); box-shadow: inset 0 0 0 1px var(--fio-luz); }
.painel { overflow-y: auto; padding: 16px 24px; }
.vazio { color: var(--tinta-3); padding: 8px 4px; }
.painel h2 { margin: 0; font-size: var(--l-titulo); font-weight: 600; word-break: break-all; }
.painel h3 { margin: 16px 0 4px; font-size: var(--l-corpo); font-weight: 600; color: var(--tinta-2); }
.linha-titulo { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.etq { font-size: var(--l-meta); color: var(--tinta-2); }
.ficha { display: grid; grid-template-columns: 128px 1fr; gap: 4px 16px; margin: 12px 0 0; }
.ficha dt { color: var(--tinta-3); font-size: var(--l-meta); line-height: 20px; }
.ficha dd { margin: 0; word-break: break-word; white-space: pre-wrap; }
.ficha dd.nada { color: var(--tinta-3); }
.teste-ok { color: var(--verde); } .teste-falhou { color: var(--vermelho); } .teste-nunca { color: var(--tinta-3); }
.acoes { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
.bt { -webkit-app-region: no-drag; border: 0; border-radius: var(--r); padding: 4px 12px; cursor: pointer; background: var(--vidro-luz); box-shadow: inset 0 0 0 1px var(--fio-luz); white-space: nowrap; }
.bt:hover:not(:disabled) { background: rgba(255, 255, 255, .14); }
.bt.forte { color: #0f1714; background: var(--cofre); box-shadow: none; font-weight: 600; }
.bt.forte:hover:not(:disabled) { background: #8fe0cf; }
.bt.perigo { background: rgba(240, 123, 123, .12); box-shadow: inset 0 0 0 1px rgba(240, 123, 123, .35); }
.nota { color: var(--tinta-3); font-size: var(--l-meta); margin-top: 8px; }
.msg { margin-top: 12px; }
.msg.ok { color: var(--verde); } .msg.erro { color: var(--vermelho); } .msg.espera { color: var(--tinta-2); }
.revelado { margin-top: 12px; padding: 12px; border-radius: var(--r); background: rgba(116, 212, 192, .07); box-shadow: inset 0 0 0 1px rgba(116, 212, 192, .35); }
.revelado code { display: block; font: var(--l-corpo)/1.5 Consolas, "Cascadia Mono", monospace; word-break: break-all; user-select: all; }
.revelado .rodape { display: flex; align-items: center; gap: 12px; margin-top: 8px; color: var(--tinta-2); font-size: var(--l-meta); }
.form { display: grid; grid-template-columns: 128px 1fr; gap: 8px 16px; align-items: center; margin-top: 12px; max-width: 620px; }
.form label { color: var(--tinta-2); }
.form .campo { width: 100%; }
.form textarea.campo { height: 64px; padding: 4px 8px; resize: vertical; }
.form .acoes { grid-column: 2; margin-top: 4px; }
.form .nota { grid-column: 2; margin-top: 0; }
.confirma { margin-top: 16px; padding: 12px; border-radius: var(--r); background: rgba(240, 123, 123, .06); box-shadow: inset 0 0 0 1px rgba(240, 123, 123, .3); }
.alertas { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.alertas button { border: 0; background: none; padding: 0; cursor: pointer; text-align: left; color: var(--tinta); }
.alertas button:hover { color: var(--cofre); }
.alertas .quando { color: var(--tinta-3); margin-left: 8px; font-size: var(--l-meta); }
.numeros { display: flex; gap: 32px; margin-top: 12px; }
.numeros div { display: flex; flex-direction: column; }
.numeros strong { font-size: var(--l-numero); font-weight: 600; font-variant-numeric: tabular-nums; }
.numeros span { color: var(--tinta-3); font-size: var(--l-meta); }
.usos { margin: 0; padding: 0; list-style: none; }
.usos li { display: grid; grid-template-columns: 120px 88px 1fr auto; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--fio); }
.usos time { font: var(--l-meta)/20px Consolas, monospace; color: var(--tinta-3); }
.usos .res { color: var(--tinta-2); }
</style>
</head>
<body>
<header class="topo">
  <h1>Cofre</h1><span class="status" id="status">lendo…</span>
  <nav class="vistas" id="vistas">
    <button class="chip ativa" data-vista="credenciais">credenciais</button>
    <button class="chip" data-vista="lixeira">lixeira</button>
  </nav>
  <input class="campo" id="busca" type="search" placeholder="Filtrar" spellcheck="false">
  <button class="bt" id="nova">+ nova</button>
</header>
<div class="barra" id="barra">
  <select class="campo" id="f-tipo" aria-label="tipo"></select>
  <select class="campo" id="f-servico" aria-label="serviço"></select>
  <select class="campo" id="f-agente" aria-label="agente"></select>
  <select class="campo" id="f-situacao" aria-label="situação">
    <option value="todas">todas as situações</option>
    <option value="alerta">com alerta</option>
    <option value="falhou">teste falhou</option>
    <option value="nunca">nunca testada</option>
    <option value="gerenciador">só no Gerenciador</option>
  </select>
  <button class="bt" id="duplicatas">conferir valores repetidos</button>
</div>
<main class="corpo">
  <section class="lista" id="lista"></section>
  <section class="painel" id="painel"></section>
</main>
<script src="cofre-janela.js"></script>
</body>
</html>
```

```js arquivo=apps/omni-ilha/cofre-janela.js
'use strict';

// Janela do cofre (F1, plano 5, T6). Lista as credenciais (ou a lixeira) à esquerda e mostra a ficha da
// escolhida à direita; sem escolha, mostra a saúde. Ao abrir, esvazia a lixeira vencida e lê tudo; relê ao
// ganhar o foco, no máximo a cada 10 s, e depois de cada ação. Texto do cofre entra escapado.
// O valor revelado fica numa variável e numa caixa só, até 30 s; some ao trocar de credencial, ao perder o
// foco, com Esc, no botão esconder ou no fim do prazo. O valor digitado sai do campo assim que é enviado.
(() => {
  const ponte = window.cofre;
  const $ = (id) => document.getElementById(id);
  const lista = $('lista');
  const painel = $('painel');
  const status = $('status');
  const busca = $('busca');
  const chips = [...document.querySelectorAll('#vistas .chip')];
  const filtro = { tipo: $('f-tipo'), servico: $('f-servico'), agente: $('f-agente'), situacao: $('f-situacao') };
  const TIPOS = ['senha', 'token', 'chave-api', 'conexao', 'conta-servico', 'ssh', 'outro'];
  const DIA_MS = 24 * 60 * 60 * 1000;
  const PRAZO_LIXEIRA_DIAS = 30;
  // Títulos das seções da saúde (várias credenciais) e o mesmo aviso dito de uma credencial só (ficha e marca).
  const REGRA = { vence: 'Vencem em breve', 'teste-falhou': 'O último teste falhou', 'sem-uso': 'Sem uso há muito tempo', 'agente-nunca-usou': 'Agente listado que nunca usou' };
  const REGRA_UMA = { vence: 'Vence em breve', 'teste-falhou': 'O último teste falhou', 'sem-uso': 'Sem uso há muito tempo', 'agente-nunca-usou': 'Um agente listado nunca usou' };

  const est = {
    vista: 'credenciais',
    creds: [],
    lixeira: [],
    saude: null,
    duplicatas: null,
    sel: null,         // o nome (credenciais) ou o id (lixeira)
    modo: null,        // null | 'nova' | 'editar' | 'trocar' | 'apagar'
    historico: null,   // { id, usos } ou { id, erro }
    revelado: null,    // { nome, valor, ate }
    ocupado: null,     // a ação em curso
    msg: null,         // { tipo: 'ok' | 'erro' | 'espera', texto }
    erroLeitura: null,
  };
  let relogio = null;
  let lidoEm = 0;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ms = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : 0; };
  const hora = (iso) => { const t = ms(iso); return t ? new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'; };
  const dia = (iso) => { const t = ms(iso); return t ? new Date(t).toLocaleDateString('pt-BR') : '—'; };
  const erroDe = (r, padrao) => String((r && (r.erro || r.codigo)) || padrao);
  const virgulas = (texto) => String(texto ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const credAtual = () => est.creds.find((c) => c.nome === est.sel) || null;
  const apagadaAtual = () => est.lixeira.find((c) => c.id === est.sel) || null;
  const alertas = () => (Array.isArray(est.saude?.alertas) ? est.saude.alertas : []);
  const alertasDe = (nome) => alertas().filter((a) => a.nome === nome);
  const restam = (iso) => Math.max(0, Math.ceil((ms(iso) + PRAZO_LIXEIRA_DIAS * DIA_MS - Date.now()) / DIA_MS));

  // ── leitura
  async function carregar() {
    let c; let l; let s;
    try { [c, l, s] = await Promise.all([ponte.listar(), ponte.lixeira(), ponte.saude(false)]); } catch { /* fica o erro abaixo */ }
    lidoEm = Date.now();
    est.erroLeitura = c?.ok && Array.isArray(c.dados) ? null : erroDe(c, 'não consegui ler o cofre');
    if (c?.ok && Array.isArray(c.dados)) est.creds = c.dados;
    if (l?.ok && Array.isArray(l.dados)) est.lixeira = l.dados;
    if (s?.ok && s.dados) est.saude = s.dados;
    if (est.modo === null && est.sel !== null && !(est.vista === 'lixeira' ? apagadaAtual() : credAtual())) selecionar(null);
    desenhar({ painel: est.modo === null });
  }

  // ── topo, filtros e lista
  function opcoes(sel, vazio, valores) {
    const atual = sel.value;
    const todos = [...new Set(valores.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    sel.innerHTML = `<option value="">${esc(vazio)}</option>${todos.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}`;
    sel.value = todos.includes(atual) ? atual : '';
  }

  function desenharTopo() {
    const n = alertas().length;
    status.innerHTML = est.erroLeitura
      ? `<b>${esc(est.erroLeitura)}</b>`
      : `${est.creds.length} credenciais${n ? ` · <b>${n} ${n === 1 ? 'alerta' : 'alertas'}</b>` : ' · sem alertas'}`;
    for (const c of chips) {
      c.classList.toggle('ativa', c.dataset.vista === est.vista);
      c.innerHTML = `${esc(c.dataset.vista)}<span class="n">${c.dataset.vista === 'lixeira' ? est.lixeira.length : est.creds.length}</span>`;
    }
    opcoes(filtro.tipo, 'todos os tipos', est.creds.map((c) => c.tipo));
    opcoes(filtro.servico, 'todos os serviços', est.creds.map((c) => c.servico));
    opcoes(filtro.agente, 'todos os agentes', est.creds.flatMap((c) => c.agentes || []));
    for (const el of [...Object.values(filtro), $('duplicatas')]) el.disabled = est.vista === 'lixeira' || (el.id === 'duplicatas' && est.ocupado !== null);
  }

  const SITUACAO = {
    todas: () => true,
    alerta: (c) => alertasDe(c.nome).length > 0,
    falhou: (c) => c.ultimo_teste_ok === false,
    nunca: (c) => !c.ultimo_teste_em,
    gerenciador: (c) => c.guarda === 'gerenciador-windows',
  };

  function visiveis() {
    const f = busca.value.trim().toLowerCase();
    const casa = (c) => !f || `${c.nome} ${c.servico ?? ''} ${c.usuario ?? ''} ${c.tipo} ${(c.etiquetas || []).join(' ')}`.toLowerCase().includes(f);
    if (est.vista === 'lixeira') return est.lixeira.filter(casa);
    return est.creds.filter(casa)
      .filter((c) => !filtro.tipo.value || c.tipo === filtro.tipo.value)
      .filter((c) => !filtro.servico.value || c.servico === filtro.servico.value)
      .filter((c) => !filtro.agente.value || (c.agentes || []).includes(filtro.agente.value))
      .filter(SITUACAO[filtro.situacao.value] || SITUACAO.todas);
  }

  function itemCred(c) {
    const marcas = [
      alertasDe(c.nome).length ? `<span class="marca m-alerta" title="${esc(alertasDe(c.nome).map((a) => REGRA_UMA[a.regra] || a.regra).join('; '))}">alerta</span>` : '',
      c.ultimo_teste_ok === false ? '<span class="marca m-falhou">falhou</span>' : '',
      c.guarda === 'gerenciador-windows' ? '<span class="marca m-gerenciador">gerenciador</span>' : '',
    ].join('');
    return `<button class="item${est.sel === c.nome ? ' sel' : ''}" data-sel="${esc(c.nome)}"><span class="nome">${esc(c.nome)}</span><span class="marcas">${marcas}</span><span class="sub">${esc([c.tipo, c.servico, c.usuario].filter(Boolean).join(' · '))}</span></button>`;
  }

  function itemApagada(c) {
    const n = restam(c.apagado_em);
    return `<button class="item${est.sel === c.id ? ' sel' : ''}" data-sel="${esc(c.id)}"><span class="nome">${esc(c.nome)}</span><span class="marcas"></span><span class="sub">apagada em ${esc(dia(c.apagado_em))} · ${n === 0 ? 'sai na próxima abertura' : `sai em ${n} ${n === 1 ? 'dia' : 'dias'}`}</span></button>`;
  }

  function desenharLista() {
    const vis = visiveis();
    const vazio = est.vista === 'lixeira' ? 'A lixeira está vazia.' : est.creds.length ? 'Nada neste filtro.' : 'Nenhuma credencial ainda.';
    lista.innerHTML = vis.map(est.vista === 'lixeira' ? itemApagada : itemCred).join('') || `<div class="vazio">${vazio}</div>`;
  }

  // ── painel
  const bt = (faz, rotulo, { desligado = false, classe = '' } = {}) => `<button class="bt${classe ? ` ${classe}` : ''}" data-faz="${faz}"${desligado ? ' data-desligado="sim"' : ''}${desligado || est.ocupado !== null ? ' disabled' : ''}>${esc(rotulo)}</button>`;
  const msgHtml = () => `<div class="msg${est.msg ? ` ${est.msg.tipo}` : ''}" id="msg">${est.msg ? esc(est.msg.texto) : ''}</div>`;
  const linha = (rotulo, valor) => `<dt>${esc(rotulo)}</dt><dd${valor ? '' : ' class="nada"'}>${valor ? esc(valor) : '—'}</dd>`;

  function quandoDoAlerta(a) {
    if (a.regra === 'vence') return `vence em ${dia(a.validade)}`;
    if (a.regra === 'teste-falhou') return `teste de ${hora(a.em)}`;
    if (a.regra === 'sem-uso') return `sem uso desde ${dia(a.desde)}`;
    if (a.regra === 'agente-nunca-usou') return `agente ${a.agente}`;
    return '';
  }

  function painelResumo() {
    const grupos = Object.keys(REGRA).map((regra) => [regra, alertas().filter((a) => a.regra === regra)]).filter(([, itens]) => itens.length);
    const dup = est.duplicatas;
    const repetidos = !dup
      ? '<p class="nota">Ainda não conferido nesta janela. A conferência abre cada valor guardado só para comparar; nada aparece na tela.</p>'
      : `${dup.pares?.length ? `<ul class="alertas">${dup.pares.map(([a, b]) => `<li><button data-sel="${esc(a)}">${esc(a)}</button><span class="quando">tem o mesmo valor que</span> <button data-sel="${esc(b)}">${esc(b)}</button></li>`).join('')}</ul>` : '<p class="nota">Nenhum valor repetido.</p>'}
         ${dup.naoAbriram?.length ? `<p class="nota">Não abriram: ${esc(dup.naoAbriram.join(', '))}.</p>` : ''}`;
    return `<h2>Saúde do cofre</h2>
      <div class="numeros"><div><strong>${est.creds.length}</strong><span>credenciais</span></div><div><strong>${alertas().length}</strong><span>alertas</span></div><div><strong>${est.lixeira.length}</strong><span>na lixeira</span></div></div>
      ${grupos.map(([regra, itens]) => `<h3>${esc(REGRA[regra])}</h3><ul class="alertas">${itens.map((a) => `<li><button data-sel="${esc(a.nome)}">${esc(a.nome)}</button><span class="quando">${esc(quandoDoAlerta(a))}</span></li>`).join('')}</ul>`).join('') || '<h3>Alertas</h3><p class="nota">Nenhum alerta.</p>'}
      <h3>Valores repetidos</h3>${repetidos}${msgHtml()}`;
  }

  function painelApagada(c) {
    return `<div class="linha-titulo"><h2>${esc(c.nome)}</h2><span class="etq">${esc(c.tipo)} · na lixeira</span></div>
      <dl class="ficha">${linha('serviço', c.servico)}${linha('usuário', c.usuario)}${linha('apagada em', hora(c.apagado_em))}${linha('sai de vez', `em ${restam(c.apagado_em)} dias`)}</dl>
      <div class="acoes">${bt('restaurar', 'restaurar', { classe: 'forte' })}</div>
      <p class="nota">Restaurar traz de volta com o mesmo nome, se nenhuma outra credencial viva o estiver usando.</p>${msgHtml()}`;
  }

  function textoDoTeste(c) {
    if (!c.ultimo_teste_em) return '<span class="teste-nunca">nunca testada</span>';
    const detalhe = c.ultimo_teste_detalhe ? `: ${esc(c.ultimo_teste_detalhe)}` : '';
    if (c.ultimo_teste_ok === true) return `<span class="teste-ok">passou</span> em ${esc(hora(c.ultimo_teste_em))}${detalhe}`;
    if (c.ultimo_teste_ok === false) return `<span class="teste-falhou">falhou</span> em ${esc(hora(c.ultimo_teste_em))}${detalhe}`;
    return `<span class="teste-nunca">sem resultado</span> em ${esc(hora(c.ultimo_teste_em))}${detalhe}`;
  }

  function painelFicha(c) {
    const gw = c.guarda === 'gerenciador-windows';
    const rev = est.revelado && est.revelado.nome === c.nome
      ? `<div class="revelado"><code id="valor-revelado">${esc(est.revelado.valor)}</code><div class="rodape"><span id="conta">${contagem()}</span>${bt('esconder', 'esconder')}</div></div>`
      : '';
    const hist = est.historico && est.historico.id === c.id
      ? `<h3>Histórico de uso</h3>${est.historico.erro ? `<p class="msg erro">${esc(est.historico.erro)}</p>` : est.historico.usos.length
        ? `<ul class="usos">${est.historico.usos.map((u) => `<li><time>${esc(hora(u.em))}</time><span>${esc(u.agente)}</span><span>${esc(u.motivo)}</span><span class="res">${esc(u.resultado)}</span></li>`).join('')}</ul>`
        : '<p class="nota">Nenhum uso registrado.</p>'}`
      : '';
    return `<div class="linha-titulo"><h2>${esc(c.nome)}</h2><span class="etq">${esc(c.tipo)}</span></div>
      <dl class="ficha">
        ${linha('serviço', c.servico)}${linha('url', c.url)}${linha('usuário', c.usuario)}
        ${linha('agentes', (c.agentes || []).join(', '))}${linha('etiquetas', (c.etiquetas || []).join(', '))}
        ${linha('validade', c.validade ? dia(c.validade) : '')}${linha('rotacionar', c.rotacionar_dias ? `a cada ${c.rotacionar_dias} dias` : '')}
        ${linha('notas', c.notas)}
        ${linha('guarda', gw ? 'Gerenciador de Credenciais do Windows' : 'DPAPI, deste usuário do Windows')}
        <dt>último teste</dt><dd>${textoDoTeste(c)}</dd>
        ${linha('criada', hora(c.criado_em))}${linha('atualizada', `${hora(c.atualizado_em)} · versão ${c.versao}`)}
      </dl>
      ${alertasDe(c.nome).length ? `<p class="msg erro">${esc(alertasDe(c.nome).map((a) => `${REGRA_UMA[a.regra] || a.regra} (${quandoDoAlerta(a)})`).join('; '))}</p>` : ''}
      <div class="acoes">
        ${bt('revelar', 'ver o valor', { desligado: gw })}${bt('copiar', 'copiar', { desligado: gw })}${bt('testar', 'testar', { desligado: gw })}
        ${bt('editar', 'editar')}${bt('trocar', 'trocar o valor', { desligado: gw })}
        ${bt('historico', est.historico?.id === c.id ? 'fechar o histórico' : 'histórico de uso')}${bt('apagar', 'apagar', { classe: 'perigo' })}
      </div>
      ${gw ? '<p class="nota">Esta mora no Gerenciador de Credenciais do Windows: o cofre só a lista. Ver, copiar, testar e trocar o valor são feitos por lá.</p>' : ''}
      ${rev}${formDoModo(c)}${msgHtml()}${hist}`;
  }

  const entrada = (id, rotulo, valor = '', extra = '') => `<label for="${id}">${esc(rotulo)}</label><input class="campo" id="${id}" value="${esc(valor)}" spellcheck="false" ${extra}>`;
  const seletorTipo = (id, atual) => `<label for="${id}">tipo</label><select class="campo" id="${id}">${TIPOS.map((t) => `<option${t === atual ? ' selected' : ''}>${t}</option>`).join('')}</select>`;

  function formNova() {
    return `<h2>Nova credencial</h2>
      <form class="form" id="form-nova" autocomplete="off">
        ${entrada('n-nome', 'nome', '', 'maxlength="200" placeholder="servico/conta"')}
        ${seletorTipo('n-tipo', 'senha')}
        ${entrada('n-servico', 'serviço', '', 'maxlength="100"')}
        ${entrada('n-url', 'url')}
        ${entrada('n-usuario', 'usuário')}
        ${entrada('n-agentes', 'agentes', 'omni', 'placeholder="separados por vírgula"')}
        <label for="n-notas">notas</label><textarea class="campo" id="n-notas"></textarea>
        ${entrada('n-valor', 'valor', '', 'type="password" autocomplete="new-password"')}
        <div class="acoes"><button class="bt forte" type="submit"${est.ocupado ? ' disabled' : ''}>guardar</button>${bt('nova-area', 'guardar com o que está na área de transferência')}${bt('cancelar', 'cancelar')}</div>
        <p class="nota">Validade, etiquetas e rotação entram depois, em editar. Pela área de transferência o valor não passa por esta janela, e a área é limpa quando o cofre guarda.</p>
      </form>${msgHtml()}`;
  }

  function formDoModo(c) {
    if (est.modo === 'editar') {
      return `<h3>Editar</h3><form class="form" id="form-editar" autocomplete="off">
        ${seletorTipo('e-tipo', c.tipo)}
        ${entrada('e-servico', 'serviço', c.servico, 'maxlength="100"')}
        ${entrada('e-url', 'url', c.url)}
        ${entrada('e-usuario', 'usuário', c.usuario)}
        ${entrada('e-agentes', 'agentes', (c.agentes || []).join(', '), 'placeholder="separados por vírgula"')}
        ${entrada('e-etiquetas', 'etiquetas', (c.etiquetas || []).join(', '), 'placeholder="separadas por vírgula"')}
        ${entrada('e-validade', 'validade', c.validade ? String(c.validade).slice(0, 10) : '', 'type="date"')}
        ${entrada('e-rotacionar', 'rotacionar (dias)', c.rotacionar_dias ?? '', 'type="number" min="1" max="3650" step="1"')}
        <label for="e-notas">notas</label><textarea class="campo" id="e-notas">${esc(c.notas)}</textarea>
        <div class="acoes"><button class="bt forte" type="submit"${est.ocupado ? ' disabled' : ''}>guardar</button>${bt('cancelar', 'cancelar')}</div>
      </form>`;
    }
    if (est.modo === 'trocar') {
      return `<h3>Trocar o valor</h3><form class="form" id="form-trocar" autocomplete="off">
        ${entrada('t-valor', 'novo valor', '', 'type="password" autocomplete="new-password"')}
        <div class="acoes"><button class="bt forte" type="submit"${est.ocupado ? ' disabled' : ''}>trocar</button>${bt('trocar-area', 'trocar pelo que está na área de transferência')}${bt('cancelar', 'cancelar')}</div>
        <p class="nota">Trocar o valor apaga o resultado do último teste; teste de novo depois.</p>
      </form>`;
    }
    if (est.modo === 'apagar') {
      return `<div class="confirma">Apagar <b>${esc(c.nome)}</b>? Ela vai para a lixeira e sai de vez em ${PRAZO_LIXEIRA_DIAS} dias; até lá dá para restaurar.
        <div class="acoes">${bt('apagar-sim', 'apagar', { classe: 'perigo' })}${bt('cancelar', 'cancelar')}</div></div>`;
    }
    return '';
  }

  function desenharPainel() {
    if (est.modo === 'nova') { painel.innerHTML = formNova(); return; }
    if (est.vista === 'lixeira') { const c = apagadaAtual(); painel.innerHTML = c ? painelApagada(c) : `<p class="vazio">Apagadas ficam aqui ${PRAZO_LIXEIRA_DIAS} dias e depois saem de vez.</p>${msgHtml()}`; return; }
    const c = credAtual();
    painel.innerHTML = c ? painelFicha(c) : painelResumo();
  }

  // Só a mensagem e os botões, sem refazer o formulário aberto.
  function atualizarMsg() {
    const el = $('msg');
    if (el) { el.className = `msg${est.msg ? ` ${est.msg.tipo}` : ''}`; el.textContent = est.msg ? est.msg.texto : ''; }
    for (const b of painel.querySelectorAll('button')) b.disabled = est.ocupado !== null || b.dataset.desligado === 'sim';
    $('duplicatas').disabled = est.vista === 'lixeira' || est.ocupado !== null;
    $('nova').disabled = est.ocupado !== null;
  }

  function desenhar({ painel: tambemPainel = true } = {}) {
    desenharTopo();
    desenharLista();
    if (tambemPainel) desenharPainel();
    atualizarMsg();
  }

  // ── o valor revelado
  function contagem() {
    const s = est.revelado ? Math.max(0, Math.ceil((est.revelado.ate - Date.now()) / 1000)) : 0;
    return `some em ${s} s`;
  }

  function mostrarRevelado(nome, valor, prazoMs) {
    esconder({ redesenhar: false });
    const prazo = Math.min(30000, Number(prazoMs) || 30000);
    est.revelado = { nome, valor, ate: Date.now() + prazo };
    relogio = setInterval(() => {
      if (!est.revelado || Date.now() >= est.revelado.ate) { esconder(); return; }
      const el = $('conta');
      if (el) el.textContent = contagem();
    }, 250);
  }

  function esconder({ redesenhar = true } = {}) {
    clearInterval(relogio);
    relogio = null;
    const tinha = est.revelado !== null;
    est.revelado = null;
    const el = $('valor-revelado');
    if (el) el.textContent = '';
    if (tinha && redesenhar && est.modo === null) desenharPainel();
  }

  // ── ações
  function selecionar(sel) {
    esconder({ redesenhar: false });
    est.sel = sel;
    est.modo = null;
    est.msg = null;
    est.historico = null;
  }

  async function agir(nome, espera, pedido, depois) {
    if (est.ocupado !== null) return;
    est.ocupado = nome;
    est.msg = espera ? { tipo: 'espera', texto: espera } : null;
    atualizarMsg();
    let r;
    try { r = await pedido(); } catch { r = { ok: false, erro: 'a janela perdeu a resposta do cofre' }; }
    // Ocupado até a recarga terminar: os botões voltam todos de uma vez, já com o que o cofre tem agora.
    try { await depois(r); } finally { est.ocupado = null; atualizarMsg(); }
  }

  const falhou = (r, padrao) => { est.msg = { tipo: 'erro', texto: erroDe(r, padrao) }; };

  function dadosDaNova() {
    const v = (id) => $(id).value.trim();
    return { nome: v('n-nome'), tipo: $('n-tipo').value, servico: v('n-servico'), url: v('n-url'), usuario: v('n-usuario'), agentes: v('n-agentes'), notas: $('n-notas').value.trim() };
  }

  function mudancasDaEdicao(c) {
    const m = {};
    const texto = (id, campo) => { const v = $(id).value.trim(); const novo = v === '' ? null : v; if (novo !== (c[campo] ?? null)) m[campo] = novo; };
    const listaDe = (id, campo) => { const novo = virgulas($(id).value); if (JSON.stringify(novo) !== JSON.stringify(c[campo] || [])) m[campo] = novo; };
    if ($('e-tipo').value !== c.tipo) m.tipo = $('e-tipo').value;
    texto('e-servico', 'servico');
    texto('e-url', 'url');
    texto('e-usuario', 'usuario');
    listaDe('e-agentes', 'agentes');
    listaDe('e-etiquetas', 'etiquetas');
    const validade = $('e-validade').value;
    if (validade !== (c.validade ? String(c.validade).slice(0, 10) : '')) m.validade = validade || null;
    const dias = $('e-rotacionar').value.trim();
    const novoDias = dias === '' ? null : Number(dias);
    if (novoDias !== (c.rotacionar_dias ?? null)) m.rotacionar_dias = novoDias;
    const notas = $('e-notas').value.trim();
    if ((notas || null) !== (c.notas ?? null)) m.notas = notas || null;
    return m;
  }

  async function guardarNova(daArea) {
    const dados = dadosDaNova();
    const campoValor = $('n-valor');
    const valor = campoValor.value;
    campoValor.value = '';
    if (!dados.nome) { est.msg = { tipo: 'erro', texto: 'falta o nome' }; atualizarMsg(); return; }
    if (!daArea && !valor) { est.msg = { tipo: 'erro', texto: 'falta o valor (ou use a área de transferência)' }; atualizarMsg(); return; }
    await agir('nova', 'guardando…', () => (daArea ? ponte.cadastrarDaArea(dados) : ponte.cadastrar(dados, valor)), async (r) => {
      if (!r?.ok) { falhou(r, 'o cofre não guardou'); return; }
      selecionar(r.dados?.credencial?.nome ?? dados.nome);
      est.msg = { tipo: 'ok', texto: daArea ? 'guardada; a área de transferência foi limpa' : 'guardada' };
      await carregar();
    });
  }

  async function trocarValor(c, daArea) {
    const campoValor = $('t-valor');
    const valor = campoValor ? campoValor.value : '';
    if (campoValor) campoValor.value = '';
    if (!daArea && !valor) { est.msg = { tipo: 'erro', texto: 'falta o novo valor (ou use a área de transferência)' }; atualizarMsg(); return; }
    await agir('trocar', 'trocando…', () => (daArea ? ponte.rotacionarDaArea(c.nome) : ponte.rotacionar(c.nome, valor)), async (r) => {
      if (!r?.ok) { falhou(r, 'o cofre não trocou o valor'); return; }
      est.modo = null;
      est.msg = { tipo: 'ok', texto: daArea ? 'valor trocado; a área de transferência foi limpa' : 'valor trocado' };
      await carregar();
    });
  }

  const ACOES = {
    cancelar: () => { est.modo = null; est.msg = null; desenharPainel(); },
    esconder: () => esconder(),
    'nova-area': () => guardarNova(true),
    'trocar-area': (c) => trocarValor(c, true),
    editar: () => { est.modo = 'editar'; est.msg = null; desenharPainel(); },
    trocar: () => { est.modo = 'trocar'; est.msg = null; desenharPainel(); },
    apagar: () => { est.modo = 'apagar'; est.msg = null; desenharPainel(); },
    revelar: (c) => agir('revelar', 'esperando o Windows Hello…', () => ponte.revelar(c.nome), async (r) => {
      if (r?.ok && typeof r.valor === 'string') { est.msg = null; mostrarRevelado(c.nome, r.valor, r.prazoMs); } else falhou(r, 'o cofre não mostrou o valor');
      desenharPainel();
    }),
    copiar: (c) => agir('copiar', 'esperando o Windows Hello…', () => ponte.copiar(c.nome), async (r) => {
      est.msg = r?.ok ? { tipo: 'ok', texto: `copiada; a área de transferência se limpa às ${new Date(ms(r.dados?.limpaEm) || Date.now()).toLocaleTimeString('pt-BR')}` } : { tipo: 'erro', texto: erroDe(r, 'o cofre não copiou') };
    }),
    testar: (c) => agir('testar', 'testando…', () => ponte.testar(c.nome), async (r) => {
      if (!r?.ok) { falhou(r, 'o teste não rodou'); return; }
      const t = r.dados?.teste || {};
      est.msg = t.ok === true ? { tipo: 'ok', texto: `o teste passou${t.detalhe ? `: ${t.detalhe}` : ''}` } : { tipo: 'erro', texto: `${t.ok === false ? 'o teste falhou' : 'sem resultado'}${t.detalhe ? `: ${t.detalhe}` : ''}` };
      await carregar();
      desenharPainel();
    }),
    historico: (c) => {
      if (est.historico?.id === c.id) { est.historico = null; desenharPainel(); return undefined; }
      return agir('historico', 'lendo o histórico…', () => ponte.historico(c.id), async (r) => {
        est.historico = r?.ok ? { id: c.id, usos: Array.isArray(r.dados?.usos) ? r.dados.usos : [] } : { id: c.id, erro: erroDe(r, 'não consegui ler o histórico') };
        est.msg = null;
        desenharPainel();
      });
    },
    'apagar-sim': (c) => agir('apagar', 'apagando…', () => ponte.apagar(c.nome), async (r) => {
      if (!r?.ok) { falhou(r, 'o cofre não apagou'); return; }
      selecionar(null);
      est.msg = { tipo: 'ok', texto: `${c.nome} foi para a lixeira` };
      await carregar();
    }),
    restaurar: (c) => agir('restaurar', 'restaurando…', () => ponte.restaurar(c.id), async (r) => {
      if (!r?.ok) { falhou(r, 'o cofre não restaurou'); return; }
      est.vista = 'credenciais';
      selecionar(r.dados?.credencial?.nome ?? c.nome);
      est.msg = { tipo: 'ok', texto: 'restaurada' };
      await carregar();
    }),
  };

  painel.addEventListener('click', (ev) => {
    const alvo = ev.target.closest('[data-sel]');
    if (alvo) { selecionar(alvo.dataset.sel); desenhar(); return; }
    const b = ev.target.closest('[data-faz]');
    if (!b || b.disabled) return;
    const acao = ACOES[b.dataset.faz];
    const c = est.vista === 'lixeira' ? apagadaAtual() : credAtual();
    if (acao) acao(c);
  });

  painel.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (est.ocupado !== null) return;
    const c = credAtual();
    if (ev.target.id === 'form-nova') { guardarNova(false); return; }
    if (ev.target.id === 'form-trocar' && c) { trocarValor(c, false); return; }
    if (ev.target.id === 'form-editar' && c) {
      const m = mudancasDaEdicao(c);
      if (Object.keys(m).length === 0) { est.msg = { tipo: 'espera', texto: 'nada mudou' }; atualizarMsg(); return; }
      agir('editar', 'guardando…', () => ponte.editar(c.nome, m), async (r) => {
        if (!r?.ok) { falhou(r, 'o cofre não guardou'); return; }
        est.modo = null;
        est.msg = { tipo: 'ok', texto: 'guardado' };
        await carregar();
      });
    }
  });

  lista.addEventListener('click', (ev) => {
    const alvo = ev.target.closest('[data-sel]');
    if (!alvo) return;
    selecionar(alvo.dataset.sel);
    desenhar();
  });

  for (const c of chips) c.addEventListener('click', () => { if (est.vista === c.dataset.vista) return; est.vista = c.dataset.vista; selecionar(null); desenhar(); });
  for (const el of Object.values(filtro)) el.addEventListener('change', () => desenharLista());
  busca.addEventListener('input', () => desenharLista());
  $('nova').addEventListener('click', () => { selecionar(null); est.vista = 'credenciais'; est.modo = 'nova'; desenhar(); $('n-nome')?.focus(); });
  $('duplicatas').addEventListener('click', () => agir('duplicatas', 'conferindo os valores…', () => ponte.saude(true), async (r) => {
    if (r?.ok && r.dados) { est.saude = r.dados; est.duplicatas = r.dados.duplicatas || { pares: [], naoAbriram: [] }; est.msg = null; } else falhou(r, 'a conferência não rodou');
    est.sel = null;
    est.modo = null;
    desenhar();
  }));

  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (est.revelado) { esconder(); return; }
    if (est.modo !== null && est.ocupado === null) { est.modo = null; est.msg = null; desenharPainel(); }
  });
  window.addEventListener('blur', () => { if (est.revelado && est.ocupado === null) esconder(); });
  window.addEventListener('focus', () => { if (est.ocupado === null && Date.now() - lidoEm > 10000) carregar(); });
  // Para a bancada: o estado sem o valor revelado.
  window.omniCofreDepurar = () => ({ vista: est.vista, sel: est.sel, modo: est.modo, ocupado: est.ocupado, msg: est.msg, total: est.creds.length, lixeira: est.lixeira.length, revelado: est.revelado !== null, erroLeitura: est.erroLeitura });

  (async () => {
    desenhar();
    try { await ponte.esvaziar(); } catch { /* a leitura abaixo mostra o erro, se houver */ }
    await carregar();
  })();
})();
```

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so apps/omni-ilha/cofre-preload.js apps/omni-ilha/cofre.html apps/omni-ilha/cofre-janela.js
foreach ($a in 'apps/omni-ilha/cofre-preload.js', 'apps/omni-ilha/cofre-janela.js') { node --check $a; $a + ' check: ' + $LASTEXITCODE }
foreach ($a in 'apps/omni-ilha/cofre-preload.js', 'apps/omni-ilha/cofre.html', 'apps/omni-ilha/cofre-janela.js') { $a + ' CR: ' + ([IO.File]::ReadAllText((Resolve-Path $a)).Split([char]13).Count - 1) }
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: os três `gravado`, `check: 0` nos dois `.js`, CR 0 nos três e `False`.

Resultado (07/11): os três `gravado`, `check: 0` nos dois `.js`, CR 0 nos três e `False`.

- [x] **Passo 6: a costura.**

```js rascunho=costura-t6.mjs
// Costura da T6 (F1, plano 5): liga a janela do cofre no main.js e na ponte da ilha (preload.js).
// Roda da raiz do repositório. Cada troca acrescenta texto logo depois de uma âncora; se o acréscimo já está
// lá (uma vez), a troca é pulada, então rodar de novo dá "igual". Âncora ausente ou repetida: sai 1 sem gravar
// nada. Preserva o fim de linha do arquivo (CRLF ou LF). --conferir: não grava; sai 1 se faltar alguma troca.
import { readFileSync, writeFileSync } from 'node:fs';

const conferir = process.argv.includes('--conferir');

const BLOCO_JANELA = `
// ── janela do cofre (F1, plano 5, T6): as credenciais da casa. Uma só, como a do Overcore. O valor nunca
// mora aqui: cofre-ipc.js converte e repassa à mão (cofre.js), que roda a CLI num processo à parte. A janela
// pede ao Windows para ficar fora de captura de tela de outros programas, porque mostra o valor revelado.
let janelaCofre = null;
function abrirCofre() {
  if (janelaCofre && !janelaCofre.isDestroyed()) {
    if (janelaCofre.isMinimized()) janelaCofre.restore();
    if (!ESCONDIDA) { janelaCofre.show(); janelaCofre.focus(); }
    return;
  }
  const area = screen.getPrimaryDisplay().workArea;
  const largura = Math.min(1080, area.width - 80);
  const altura = Math.min(720, area.height - 80);
  janelaCofre = new BrowserWindow({
    width: largura, height: altura,
    x: Math.round(area.x + (area.width - largura) / 2 + 60), y: Math.round(area.y + (area.height - altura) / 2 + 60),
    minWidth: 720, minHeight: 400, show: false, title: 'Cofre', icon: ICONE, backgroundColor: '#11141a',
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#11141a', symbolColor: '#9aa2b5', height: 40 },
    webPreferences: { preload: path.join(__dirname, 'cofre-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: ESCONDIDA },
  });
  janelaCofre.setContentProtection(true);
  janelaCofre.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  janelaCofre.webContents.on('will-navigate', (ev) => ev.preventDefault());
  janelaCofre.on('closed', () => { janelaCofre = null; });
  janelaCofre.once('ready-to-show', () => { if (!ESCONDIDA) janelaCofre?.show(); });
  janelaCofre.loadFile(path.join(__dirname, 'cofre.html'));
}
const daJanelaCofre = (evento) => janelaCofre && !janelaCofre.isDestroyed() && evento.sender === janelaCofre.webContents;
ipcMain.on('abrir-cofre', (evento) => {
  if (!daIlha(evento)) return;
  ligarEscape(false);
  abrirCofre();
});
registrarIpcCofre({ ipcMain, mao: criarMaoCofre(), clipboard, daJanela: daJanelaCofre, daIlha });`;

const COSTURAS = [
  {
    arquivo: 'apps/omni-ilha/main.js',
    trocas: [
      {
        de: "const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');",
        para: "const { app, BrowserWindow, clipboard, globalShortcut, ipcMain, screen } = require('electron');",
      },
      {
        de: "const { lerWhatsapp } = require('./whatsapp');",
        para: "const { lerWhatsapp } = require('./whatsapp');\nconst { criarMaoCofre } = require('./cofre');\nconst { registrarIpcCofre } = require('./cofre-ipc');",
      },
      {
        de: '      janelaOvercore: () => janelaOvercore,',
        para: '      janelaOvercore: () => janelaOvercore,\n      janelaCofre: () => janelaCofre,\n      abrirCofre: () => abrirCofre(),',
      },
      {
        de: "ipcMain.handle('oracle:resumo', (evento) => (daIlha(evento) ? resumoOracle() : null));",
        para: "ipcMain.handle('oracle:resumo', (evento) => (daIlha(evento) ? resumoOracle() : null));" + BLOCO_JANELA,
      },
    ],
  },
  {
    arquivo: 'apps/omni-ilha/preload.js',
    trocas: [
      {
        de: "  resumoOvercore: () => ipcRenderer.invoke('overcore:resumo'),",
        para: "  resumoOvercore: () => ipcRenderer.invoke('overcore:resumo'),\n  abrirCofre: () => ipcRenderer.send('abrir-cofre'),\n  resumoCofre: () => ipcRenderer.invoke('cofre:resumo'),",
      },
    ],
  },
];

const vezes = (texto, trecho) => texto.split(trecho).length - 1;

const prontos = [];
let faltam = 0;
for (const { arquivo, trocas } of COSTURAS) {
  const original = readFileSync(arquivo, 'utf8');
  const crlf = original.includes('\r\n');
  let texto = original.replace(/\r\n/g, '\n');
  for (const [i, { de, para }] of trocas.entries()) {
    if (vezes(texto, para) === 1) continue;
    const n = vezes(texto, de);
    if (n !== 1) {
      console.error(`${arquivo}: a âncora da troca ${i + 1} aparece ${n} vezes (esperado 1); nada foi gravado`);
      process.exit(1);
    }
    faltam += 1;
    texto = texto.replace(de, () => para);
  }
  const final = crlf ? texto.replace(/\n/g, '\r\n') : texto;
  prontos.push({ arquivo, mudou: final !== original, final });
}

if (conferir) {
  for (const { arquivo, mudou } of prontos) console.log(`${arquivo}: ${mudou ? 'FALTA' : 'costurado'}`);
  process.exit(faltam ? 1 : 0);
}
for (const { arquivo, mudou, final } of prontos) {
  if (mudou) writeFileSync(arquivo, final, 'utf8');
  console.log(`${arquivo}: ${mudou ? 'gravado' : 'igual'}`);
}
```

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so costura-t6.mjs
node "$rascunho\costura-t6.mjs" --conferir; "conferir antes: $LASTEXITCODE"
node "$rascunho\costura-t6.mjs"; "costura: $LASTEXITCODE"
node "$rascunho\costura-t6.mjs"; "de novo: $LASTEXITCODE"
node "$rascunho\costura-t6.mjs" --conferir; "conferir depois: $LASTEXITCODE"
foreach ($a in 'apps/omni-ilha/main.js', 'apps/omni-ilha/preload.js') {
  node --check $a; $t = [IO.File]::ReadAllText((Resolve-Path $a))
  $a + ' check: ' + $LASTEXITCODE + ', CR: ' + ($t.Split([char]13).Count - 1) + ', LF: ' + ($t.Split([char]10).Count - 1)
}
git ls-files --eol apps/omni-ilha/main.js apps/omni-ilha/preload.js
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado:
- `gravado costura-t6.mjs`;
- no primeiro `--conferir`, `FALTA` nos dois e `conferir antes: 1`;
- `gravado` nos dois e `costura: 0`; rodando de novo, `igual` nos dois e `de novo: 0`;
- no segundo `--conferir`, `costurado` nos dois e `conferir depois: 0`;
- `check: 0` nos dois, com CR igual a LF em cada um: 512 no `main.js` e 38 no `preload.js`;
- `i/lf    w/crlf` nos dois e `False`.

Resultado (07/11): `gravado costura-t6.mjs`; `FALTA` nos dois e `conferir antes: 1`; `gravado` nos dois e `costura: 0`; `igual` nos dois e `de novo: 0`; `costurado` nos dois e `conferir depois: 0`; `main.js check: 0, CR: 512, LF: 512` e `preload.js check: 0, CR: 38, LF: 38`; `i/lf    w/crlf` nos dois; e `False`.

**Mutação.** Vinte e cinco mutantes, todos nos canais, com os critérios da T1. Nenhum equivalente. A janela e a costura não têm mutante: o renderer não tem suíte, e quem o prova é a prova visual; o `main.js` costurado se prova pelo `--conferir`, pelo `node --check` e pela mesma prova, que abre a janela pela costura. O 08 cai em dois testes: com a área vazia aceita, o `textoDaArea('')` responde ok, e o canal da área chama a mão com um Buffer vazio. O 17 cai em três, porque o campo vazio entra nos dados de todo cadastro.

```json rascunho=mutantes-p5-t6.json
[
  { "nome": "01 janela sem guarda", "arquivo": "apps/omni-ilha/cofre-ipc.js", "de": "(daJanela(evento) ? fn(...args) : null)", "para": "(true ? fn(...args) : null)", "teste": ["testes/ilha-cofre-ipc.test.mjs"] },
  { "nome": "02 resumo sem guarda", "arquivo": "apps/omni-ilha/cofre-ipc.js", "de": "(daIlha(evento) ? resumo(mao) : null)", "para": "(true ? resumo(mao) : null)", "teste": ["testes/ilha-cofre-ipc.test.mjs"] },
  { "nome": "03 duplicatas com qualquer verdade", "arquivo": "apps/omni-ilha/cofre-ipc.js", "de": "duplicatas: duplicatas === true", "para": "duplicatas: Boolean(duplicatas)", "teste": ["testes/ilha-cofre-ipc.test.mjs"] },
  { "nome": "04 histórico sem o limite de 50", "arquivo": "apps/omni-ilha/cofre-ipc.js", "de": "limite: 50", "para": "limite: 500", "teste": ["testes/ilha-cofre-ipc.test.mjs"] },
  { "nome": "05 histórico com o id cru", "arquivo": "apps/omni-ilha/cofre-ipc.js", "de": "id: String(id),", "para": "id,", "teste": ["testes/ilha-cofre-ipc.test.mjs"] },
  { "nome": "06 CRLF da área sem tirar", "arquivo": "apps/omni-ilha/cofre-ipc.js", "de": ".replace(/\\r?\\n$/, '')", "para": ".replace(/\\n$/, '')", "teste": ["testes/ilha-cofre-ipc.test.mjs"] },
  { "nome": "07 CR no meio aceito", "arquivo": "apps/omni-ilha/cofre-ipc.js", "de": "if (/[\\r\\n]/.test(t))", "para": "if (/\\n/.test(t))", "teste": ["testes/ilha-cofre-ipc.test.mjs"] },
  { "nome": "08 área vazia aceita", "arquivo": "apps/omni-ilha/cofre-ipc.js", "de": "if (t === '') return", "para": "if (false) return", "teste": ["testes/ilha-cofre-ipc.test.mjs"] },
  { "nome": "09 área limpa mesmo mudada", "arquivo": "apps/omni-ilha/cofre-ipc.js", "de": "if (resposta && resposta.ok && clipboard.readText() === lido)", "para": "if (resposta && resposta.ok)", "teste": ["testes/ilha-cofre-ipc.test.mjs"] },
  { "nome": "10 área limpa na recusa", "arquivo": "apps/omni-ilha/cofre-ipc.js", "de": "if (resposta && resposta.ok && clipboard.readText() === lido)", "para": "if (clipboard.readText() === lido)", "teste": ["testes/ilha-cofre-ipc.test.mjs"] },
  { "nome": "11 área nunca limpa", "arquivo": "apps/omni-ilha/cofre-ipc.js", "de": "clipboard.clear();", "para": "void 0;", "teste": ["testes/ilha-cofre-ipc.test.mjs"] },
  { "nome": "12 Buffer do pedido sem zerar", "arquivo": "apps/omni-ilha/cofre-ipc.js", "de": "finally { buf.fill(0); }", "para": "finally { void 0; }", "teste": ["testes/ilha-cofre-ipc.test.mjs"] },
  { "nome": "13 revelado sem zerar", "arquivo": "apps/omni-ilha/cofre-ipc.js", "de": "finally { if (Buffer.isBuffer(valor)) valor.fill(0); }", "para": "finally { void 0; }", "teste": ["testes/ilha-cofre-ipc.test.mjs"] },
  { "nome": "14 prazo de cinco minutos", "arquivo": "apps/omni-ilha/cofre-ipc.js", "de": "const PRAZO_REVELADO_MS = 30000;", "para": "const PRAZO_REVELADO_MS = 300000;", "teste": ["testes/ilha-cofre-ipc.test.mjs"] },
  { "nome": "15 revelado sem conferir o Buffer", "arquivo": "apps/omni-ilha/cofre-ipc.js", "de": "if (!Buffer.isBuffer(valor)) return", "para": "if (false) return", "teste": ["testes/ilha-cofre-ipc.test.mjs"] },
  { "nome": "16 campos sem aparar", "arquivo": "apps/omni-ilha/cofre-ipc.js", "de": "const v = String(d[campo] ?? '').trim();", "para": "const v = String(d[campo] ?? '');", "teste": ["testes/ilha-cofre-ipc.test.mjs"] },
  { "nome": "17 campo vazio enviado", "arquivo": "apps/omni-ilha/cofre-ipc.js", "de": "if (v) saida[campo] = v;", "para": "saida[campo] = v;", "teste": ["testes/ilha-cofre-ipc.test.mjs"] },
  { "nome": "18 agentes vazios enviados", "arquivo": "apps/omni-ilha/cofre-ipc.js", "de": ".map((a) => a.trim()).filter(Boolean)", "para": ".map((a) => a.trim())", "teste": ["testes/ilha-cofre-ipc.test.mjs"] },
  { "nome": "19 campos fora do cadastrar", "arquivo": "apps/omni-ilha/cofre-ipc.js", "de": "for (const campo of CAMPOS_DO_CADASTRO)", "para": "for (const campo of Object.keys(d))", "teste": ["testes/ilha-cofre-ipc.test.mjs"] },
  { "nome": "20 resumo com todos os alertas", "arquivo": "apps/omni-ilha/cofre-ipc.js", "de": "alertas.slice(0, 3).map", "para": "alertas.map", "teste": ["testes/ilha-cofre-ipc.test.mjs"] },
  { "nome": "21 resumo vaza os detalhes", "arquivo": "apps/omni-ilha/cofre-ipc.js", "de": ".map(({ regra, nome }) => ({ regra, nome }))", "para": ".map((a) => a)", "teste": ["testes/ilha-cofre-ipc.test.mjs"] },
  { "nome": "22 resumo pede as duplicatas", "arquivo": "apps/omni-ilha/cofre-ipc.js", "de": "mao.saude({ duplicatas: false })", "para": "mao.saude({ duplicatas: true })", "teste": ["testes/ilha-cofre-ipc.test.mjs"] },
  { "nome": "23 restaurar com o id cru", "arquivo": "apps/omni-ilha/cofre-ipc.js", "de": "mao.restaurar(String(id))", "para": "mao.restaurar(id)", "teste": ["testes/ilha-cofre-ipc.test.mjs"] },
  { "nome": "24 valor digitado em latin1", "arquivo": "apps/omni-ilha/cofre-ipc.js", "de": "Buffer.from(String(valor ?? ''), 'utf8')", "para": "Buffer.from(String(valor ?? ''), 'latin1')", "teste": ["testes/ilha-cofre-ipc.test.mjs"] },
  { "nome": "25 esvaziar só lista a lixeira", "arquivo": "apps/omni-ilha/cofre-ipc.js", "de": "() => mao.esvaziarLixeira()", "para": "() => mao.lixeira()", "teste": ["testes/ilha-cofre-ipc.test.mjs"] }
]
```

Mapa previsto de mutante para teste:

| Mutante | Morre em | Como cai |
|---|---|---|
| 01 | IC 2 | `equal` do `null` ("cofre:listar aceitou a ilha") |
| 02 | IC 2 | `equal` do `null` ("o resumo aceitou a janela do cofre") |
| 03 | IC 3 | deepEqual dos argumentos (`'true'` pede duplicatas) |
| 04 | IC 3 | deepEqual dos argumentos do histórico |
| 05 | IC 3 | deepEqual dos argumentos do histórico (`7` no lugar de `'7'`) |
| 06 | IC 6 e IC 7 | deepEqual do `textoDaArea('abc\r\n')` na IC 6; na IC 7, deepEqual da resposta: `valor-1\r` vira `varias-linhas` |
| 07 | IC 6 | `equal` do código (`a\rb` aceito) |
| 08 | IC 6 e IC 7 | `equal` do código, nos dois |
| 09 | IC 7 | `equal` das limpezas ("a área foi limpa depois de mudar") |
| 10 | IC 7 | `equal` das limpezas ("a área foi limpa numa recusa") |
| 11 | IC 7 | `equal` das limpezas ("a área não foi limpa depois do sucesso") |
| 12 | IC 5 e IC 7 | `ok` ("o Buffer … ficou com o valor"), nos dois |
| 13 | IC 8 | `ok` ("o Buffer revelado ficou com o valor") |
| 14 | IC 8 | `equal` do prazo |
| 15 | IC 8 | deepEqual: o texto no lugar do Buffer passa |
| 16 | IC 4 e IC 5 | deepEqual dos dados (` omni/teste ` sem aparar) |
| 17 | IC 4, IC 5 e IC 7 | deepEqual dos dados, com os campos vazios |
| 18 | IC 4 | deepEqual dos agentes, com o vazio do fim |
| 19 | IC 4 | deepEqual dos dados, com `validade` e `etiquetas` |
| 20 | IC 9 | deepEqual do resumo, com os quatro primeiros |
| 21 | IC 9 | deepEqual do resumo, com os detalhes |
| 22 | IC 9 | deepEqual dos argumentos da saúde |
| 23 | IC 3 | deepEqual dos argumentos do restaurar |
| 24 | IC 5 | deepEqual do texto do Buffer (`ção` em latin1) |
| 25 | IC 3 | deepEqual da resposta do esvaziar (`de: 'lixeira'`) |

- [x] **Passo 7: extrair a lista e anotar os hashes.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so mutantes.mjs tabela-mutantes-p5.mjs mutantes-p5-t6.json
$alvos = 'apps/omni-ilha/cofre-ipc.js', 'testes/ilha-cofre-ipc.test.mjs'
$alvos | ForEach-Object { $_ + ' ' + (Get-FileHash $_ -Algorithm SHA256).Hash.Substring(0, 12) } | Set-Content -Encoding utf8 "$rascunho\hashes-antes-p5-t6.txt"
Get-Content "$rascunho\hashes-antes-p5-t6.txt"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `igual mutantes.mjs`, `igual tabela-mutantes-p5.mjs`, `gravado mutantes-p5-t6.json`, as duas linhas de hash e `False`.

Resultado (07/11): `igual mutantes.mjs`, `igual tabela-mutantes-p5.mjs`, `gravado mutantes-p5-t6.json` (o ensaio guardou a lista dele numa subpasta), os hashes `apps/omni-ilha/cofre-ipc.js B22932337A31` e `testes/ilha-cofre-ipc.test.mjs 956812C65BD3`, e `False`.

- [x] **Passo 8: rodar, em segundo plano.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
node "$rascunho\mutantes.mjs" "$rascunho\mutantes-p5-t6.json" *> "$rascunho\mutantes-p5-t6.txt"; "saida: $LASTEXITCODE"
```

Esperado: a última linha de `mutantes-p5-t6.txt` é `25 mutantes em … s; fora do vermelho: 0`, e `saida: 0`.

Resultado (07/11): `25 mutantes em 4 s; fora do vermelho: 0` e `saida: 0`.

- [x] **Passo 9: a tabela e os hashes.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$alvos = 'apps/omni-ilha/cofre-ipc.js', 'testes/ilha-cofre-ipc.test.mjs'
node "$rascunho\tabela-mutantes-p5.mjs" "$rascunho\mutantes-p5-t6.json"; "saida: $LASTEXITCODE"
$depois = $alvos | ForEach-Object { $_ + ' ' + (Get-FileHash $_ -Algorithm SHA256).Hash.Substring(0, 12) }
Compare-Object (Get-Content "$rascunho\hashes-antes-p5-t6.txt") $depois
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `25 linhas: 25 vermelhos, 0 equivalente(s); testes mapeados: 31`, nenhuma linha `PROBLEMA` e `saida: 0`; o `Compare-Object` calado; e `False`. A tabela gerada (`$rascunho\mutantes-p5-t6.tabela.md`) entra no Apêndice F.

Resultado (07/11): `25 linhas: 25 vermelhos, 0 equivalente(s); testes mapeados: 31`, nenhum `PROBLEMA` e `saida: 0`; o `Compare-Object` calado; e `False`. Cada mutante caiu nos testes e pelo operador do mapa, todos por `ERR_ASSERTION`, e a tabela é idêntica, linha a linha, à do ensaio feito numa cópia antes da escrita.

- [x] **Passo 10: a prova visual.**

A semente cria, numa casa temporária, nove credenciais fictícias que acendem as quatro regras da saúde, uma do Gerenciador e duas na lixeira, com valores inventados, endereços de documentação (RFC 5737) e domínios `.invalid`; a DPAPI é a do usuário, só para selar esses valores, e a casa é apagada no fim do plano. A bancada é carregada pela ilha (`OMNI_ILHA_TESTE`), abre a janela pela costura e percorre as telas: a saúde, os valores repetidos, uma ficha, o revelado e o prazo dele, o copiar, o histórico, a credencial do Gerenciador, editar, nova (digitada e da área), apagar e restaurar. Os canais que chamariam o Hello ou a área de transferência (revelar, copiar e os dois "da área") são trocados ali por respostas fictícias; o resto passa pelos canais, pela mão e pela CLI de verdade. O script copia a ilha já costurada e o `runtime` para uma pasta à parte, confere a costura na cópia, semeia a casa e roda o Electron 33 escondido (`OMNI_ILHA_ESCONDIDA`, janela fora da tela), com um `--user-data-dir` próprio: a ilha real segue rodando, sem segunda instância.

```js rascunho=semente-t6.mjs
// Semente da prova visual da T6: uma casa temporária com credenciais fictícias que acendem as quatro regras
// da saúde, uma do Gerenciador e duas na lixeira. Valores inventados, endereços de documentação (RFC 5737) e
// domínios .invalid. A DPAPI é a do usuário, só para selar os valores fictícios, e a casa é apagada no fim da
// prova. Uso: node semente-t6.mjs <raiz do repositório> <casa temporária>
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [raiz, casa] = process.argv.slice(2).map((p) => resolve(p))
if (!raiz || !casa) { console.error('uso: node semente-t6.mjs <raiz> <casa>'); process.exit(2) }
const importar = (rel) => import(pathToFileURL(join(raiz, rel)).href)
const { comBancoDaCasa } = await importar('runtime/casa/banco.mjs')
const loja = await importar('runtime/casa/loja-cofre.mjs')
const { criarPonteDpapi } = await importar('runtime/casa/dpapi.mjs')

const env = { ...process.env, OMNI_HOME: casa, OMNI_CASA_BANCO: join(casa, 'casa') }
const DIA = 24 * 60 * 60 * 1000
const ha = (dias) => new Date(Date.now() - dias * DIA).toISOString()
const daqui = (dias) => new Date(Date.now() + dias * DIA).toISOString()
const ponte = criarPonteDpapi()

const CREDENCIAIS = [
  { dias: 10, valor: 'ficticio-mapas-0001', dados: { nome: 'mapas/chave-api', tipo: 'chave-api', servico: 'mapas', url: 'https://mapas.exemplo.invalid', agentes: ['omni'] } },
  { dias: 3, valor: 'ficticio-mapas-0001', dados: { nome: 'mapas/chave-reserva', tipo: 'chave-api', servico: 'mapas', url: 'https://mapas.exemplo.invalid', notas: 'cópia de reserva para o plano B', agentes: ['omni'] } },
  { dias: 30, valor: 'ficticio-correio-77', dados: { nome: 'correio/smtp', tipo: 'senha', servico: 'correio', url: 'smtp://192.0.2.25:587', usuario: 'robo@exemplo.invalid', etiquetas: ['envio'], validade: daqui(7), agentes: ['omni'] } },
  { dias: 20, valor: 'ficticio-fila-xyz', dados: { nome: 'fila/token-ingestao', tipo: 'token', servico: 'fila', url: 'https://fila.exemplo.invalid', agentes: ['omni'] } },
  { dias: 200, valor: 'ficticio-banco-leitor', dados: { nome: 'banco-teste/leitura', tipo: 'conexao', servico: 'banco-teste', url: 'postgres://192.0.2.20:5432/teste', usuario: 'leitor', agentes: ['omni'] } },
  { dias: 120, valor: 'ficticio-relatorios-9', dados: { nome: 'relatorios/conta-servico', tipo: 'conta-servico', servico: 'relatorios', usuario: 'relatorios-bot', agentes: ['omni', 'overcore'] } },
  { dias: 40, valor: 'ficticio-ssh-deploy', dados: { nome: 'deploy/chave-ssh', tipo: 'ssh', servico: 'deploy', url: '198.51.100.7', usuario: 'deploy', rotacionar_dias: 90, etiquetas: ['servidor', 'implantação'], agentes: ['omni'] } },
  { dias: 60, valor: 'ficticio-webhook-55', dados: { nome: 'pagamentos/webhook', tipo: 'token', servico: 'pagamentos', url: 'https://pagamentos.exemplo.invalid/webhook', notas: 'assina os avisos do ambiente de teste <b>não é negrito</b>', agentes: ['omni'] } },
  { dias: 50, valor: 'ficticio-velho-1', dados: { nome: 'antigo/token-velho', tipo: 'token', servico: 'antigo', agentes: ['omni'] }, apagarHa: 5 },
  { dias: 45, valor: 'ficticio-descartavel', dados: { nome: 'teste/descartavel', tipo: 'senha', servico: 'teste', agentes: ['omni'] }, apagarHa: 26 },
]

comBancoDaCasa(casa, 'cofre', (db) => {
  for (const { dias, valor, dados } of CREDENCIAIS) loja.cadastrarCredencial(db, ponte, dados, valor, { agora: ha(dias) })
  const usar = (nome, agente, dias, motivo) => { const { valor } = loja.usarCredencial(db, ponte, { nome, agente, motivo }, { agora: ha(dias) }); valor.fill(0) }
  usar('mapas/chave-api', 'omni', 1, 'rota do relatório semanal')
  usar('mapas/chave-api', 'omni', 4, 'rota do relatório semanal')
  usar('correio/smtp', 'omni', 2, 'aviso de fim de carga')
  usar('relatorios/conta-servico', 'omni', 10, 'exportar o painel')
  usar('deploy/chave-ssh', 'omni', 6, 'publicar a versão de teste')
  usar('pagamentos/webhook', 'omni', 12, 'conferir assinatura')
  loja.registrarTeste(db, 'mapas/chave-api', { ok: true, detalhe: 'HTTP 200' }, ha(1))
  loja.registrarTeste(db, 'fila/token-ingestao', { ok: false, detalhe: 'HTTP 401' }, ha(2))
  loja.registrarTeste(db, 'deploy/chave-ssh', { ok: null, detalhe: 'sem testador para ssh' }, ha(6))
  loja.registrarInventarioWindows(db, [{ alvo: 'omni/legado-planilhas', usuario: 'planilhas' }], { agora: ha(15) })
  for (const { dados, apagarHa } of CREDENCIAIS) if (apagarHa) loja.apagarCredencial(db, dados.nome, { agora: ha(apagarHa) })
  const saude = loja.saudeCofre(db)
  console.log(JSON.stringify({ vivas: loja.listarCredenciais(db).length, lixeira: loja.listarLixeira(db).length, alertas: saude.alertas.map((a) => `${a.regra}:${a.nome}`) }))
}, env)
```

```js rascunho=bancada-t6.js
'use strict';

// Bancada da prova visual da T6, carregada pela ilha via OMNI_ILHA_TESTE. Abre a janela do cofre sobre a casa
// temporária da semente e percorre as telas, capturando cada uma. Os canais que chamariam o Windows Hello ou a
// área de transferência (revelar, copiar e os dois "da área") são trocados aqui por respostas fictícias; o
// resto passa pela mão e pela CLI de verdade. Saída: PNGs e resultado.json em OMNI_BANCADA_SAIDA.
const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');

const SAIDA = process.env.OMNI_BANCADA_SAIDA;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = (api) => {
  const conferencias = [];
  const conferir = (nome, ok, detalhe = '') => conferencias.push({ nome, ok: Boolean(ok), detalhe: String(detalhe) });
  const trocar = (canal, fn) => { ipcMain.removeHandler(canal); ipcMain.handle(canal, fn); };

  async function rodar() {
    await espera(1500);
    trocar('cofre:revelar', () => ({ ok: true, dados: { ok: true, nome: 'correio/smtp' }, valor: 'ficticio-correio-77', prazoMs: 4000 }));
    trocar('cofre:copiar', () => ({ ok: true, dados: { ok: true, nome: 'correio/smtp', limpaEm: new Date(Date.now() + 30000).toISOString() } }));
    const recusaArea = () => ({ ok: false, codigo: 'area-vazia', erro: 'a área de transferência está vazia' });
    trocar('cofre:cadastrar-da-area', recusaArea);
    trocar('cofre:rotacionar-da-area', recusaArea);

    api.abrirCofre();
    const w = api.janelaCofre();
    const wc = w.webContents;
    w.setSize(1080, 720);
    await new Promise((r) => (wc.isLoading() ? wc.once('did-finish-load', r) : r()));
    const js = (codigo) => wc.executeJavaScript(codigo, true);
    const estado = () => js('window.omniCofreDepurar()');
    const ate = async (cond, ms = 15000) => { const fim = Date.now() + ms; while (Date.now() < fim) { const e = await estado(); if (cond(e)) return e; await espera(150); } return estado(); };
    const quieto = () => ate((e) => e.ocupado === null);
    const clicar = (seletor) => js(`(() => { const el = document.querySelector(${JSON.stringify(seletor)}); if (!el) return false; el.click(); return true; })()`);
    const foto = async (nome) => { await espera(400); const img = await wc.capturePage(); fs.writeFileSync(path.join(SAIDA, `${nome}.png`), img.toPNG()); conferir(`foto ${nome}`, !img.isEmpty(), `${img.getSize().width}x${img.getSize().height}`); };

    let e = await ate((x) => x.total > 0);
    conferir('leu a casa', e.total === 9 && e.lixeira === 2 && !e.erroLeitura, JSON.stringify(e));
    await foto('1-saude');

    await clicar('#duplicatas');
    e = await quieto();
    const pares = await js("[...document.querySelectorAll('.alertas li')].filter((li) => li.textContent.includes('tem o mesmo valor')).map((li) => li.textContent.replace(/\\s+/g, ' ').trim())");
    conferir('repetidos conferidos', pares.length === 1 && pares[0].includes('mapas/chave-api') && pares[0].includes('mapas/chave-reserva'), JSON.stringify(pares));
    await foto('2-repetidos');

    await clicar('[data-sel="pagamentos/webhook"]');
    const negrito = await js("document.querySelectorAll('#painel b').length === 0 && document.getElementById('painel').textContent.includes('<b>não é negrito</b>')");
    conferir('notas escapadas', negrito);

    await clicar('[data-sel="correio/smtp"]');
    await foto('3-ficha');

    await clicar('[data-faz="revelar"]');
    e = await ate((x) => x.revelado);
    conferir('revelado na tela', e.revelado && (await js("document.getElementById('valor-revelado')?.textContent")) === 'ficticio-correio-77');
    await foto('4-revelado');
    e = await ate((x) => !x.revelado, 8000);
    conferir('revelado some no prazo', !e.revelado && (await js("document.getElementById('valor-revelado') === null && !document.body.textContent.includes('ficticio-correio-77')")));

    await clicar('[data-faz="copiar"]');
    e = await quieto();
    conferir('copiar mostra a hora da limpeza', e.msg?.tipo === 'ok' && /limpa às/.test(e.msg.texto), JSON.stringify(e.msg));

    await clicar('[data-faz="historico"]');
    await quieto();
    const usos = await js("document.querySelectorAll('.usos li').length");
    conferir('histórico do correio (o uso e a conferência)', usos === 2, String(usos));
    await foto('5-historico');

    await clicar('[data-sel="omni/legado-planilhas"]');
    const desligados = await js("['revelar','copiar','testar','trocar'].every((f) => document.querySelector(`[data-faz=\"${f}\"]`).disabled) && !document.querySelector('[data-faz=\"editar\"]').disabled");
    conferir('gerenciador desliga ver/copiar/testar/trocar', desligados);
    await foto('6-gerenciador');

    await clicar('[data-sel="fila/token-ingestao"]');
    await clicar('[data-faz="editar"]');
    await js("document.getElementById('e-servico').value = 'fila-nova'; document.getElementById('e-etiquetas').value = 'ingestão, noturna'; document.getElementById('e-rotacionar').value = '30'; true");
    await foto('7-editar');
    await js("document.getElementById('form-editar').requestSubmit(); true");
    e = await quieto();
    const ficha = await js("document.querySelector('.ficha').textContent");
    conferir('editar grava e mostra', e.msg?.tipo === 'ok' && e.modo === null && ficha.includes('fila-nova') && ficha.includes('ingestão, noturna') && ficha.includes('a cada 30 dias'), JSON.stringify(e.msg));

    await clicar('#nova');
    await js("document.getElementById('n-nome').value = 'exemplo/nova'; document.getElementById('n-servico').value = 'exemplo'; document.getElementById('n-valor').value = 'ficticio-novo'; true");
    await foto('8-nova');
    await clicar('[data-faz="nova-area"]');
    e = await quieto();
    conferir('da área recusa vazia sem limpar o formulário', e.modo === 'nova' && e.msg?.tipo === 'erro' && (await js("document.getElementById('n-nome').value")) === 'exemplo/nova', JSON.stringify(e.msg));
    conferir('valor digitado sai do campo', (await js("document.getElementById('n-valor').value")) === '');
    await js("document.getElementById('n-valor').value = 'ficticio-novo'; document.getElementById('form-nova').requestSubmit(); true");
    e = await quieto();
    conferir('nova guardada e selecionada', e.msg?.tipo === 'ok' && e.sel === 'exemplo/nova' && e.total === 10, JSON.stringify(e));

    await clicar('[data-faz="apagar"]');
    await clicar('[data-faz="apagar-sim"]');
    e = await quieto();
    conferir('apagar manda à lixeira', e.total === 9 && e.lixeira === 3 && e.sel === null, JSON.stringify(e));

    await clicar('[data-vista="lixeira"]');
    await clicar('#lista [data-sel]');
    await foto('9-lixeira');
    await clicar('[data-faz="restaurar"]');
    e = await quieto();
    conferir('restaurar volta à lista', e.vista === 'credenciais' && e.total === 10 && e.lixeira === 2 && e.sel === 'exemplo/nova', JSON.stringify(e));
  }

  rodar()
    .catch((erro) => conferir('a bancada rodou até o fim', false, erro && erro.stack))
    .finally(() => {
      fs.writeFileSync(path.join(SAIDA, 'resultado.json'), JSON.stringify(conferencias, null, 2));
      setTimeout(() => api.app.exit(0), 300);
    });
};
```

```powershell rascunho=prova-t6.ps1
# Prova visual da T6: cópia da ilha já costurada + casa temporária semeada + ilha escondida com a bancada.
# Roda da raiz do repositório, depois da costura. Nada toca a casa real nem a área de transferência: revelar,
# copiar e os dois "da área" são fictícios na bancada. O Electron é o 33 que a ilha real usa: -Electron, ou a
# variável OMNI_ELECTRON, ou o do omni-desktop no checkout principal. O PowerShell 5.1 lê este arquivo (UTF-8
# sem BOM) como ANSI: os acentos ficam só nos comentários, e o que o script imprime é ASCII.
param(
  [string]$Electron = $env:OMNI_ELECTRON
)
$ErrorActionPreference = 'Stop'
if (-not $Electron) { $Electron = Join-Path $env:USERPROFILE 'Documents\Omni\apps\omni-desktop\node_modules\electron\dist\electron.exe' }
if (-not (Test-Path -LiteralPath $Electron)) { throw ('Electron nao encontrado: ' + $Electron) }
$raiz = (Get-Location).Path
$r2 = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$sp = $PSScriptRoot
$v = Join-Path $r2 'ensaio-t6v'; $casa = Join-Path $r2 'casa-t6v'; $ud = Join-Path $r2 'ud-t6v'; $saida = Join-Path $r2 'prova-t6'
foreach ($d in $v, $casa, $ud, $saida) { if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force } }
New-Item -ItemType Directory -Force (Join-Path $v 'apps'), $casa, $ud, $saida | Out-Null
Copy-Item -Recurse (Join-Path $raiz 'apps\omni-ilha') (Join-Path $v 'apps\omni-ilha')
Copy-Item -Recurse (Join-Path $raiz 'runtime') (Join-Path $v 'runtime')

function Rodar($exe, $argumentos, $pasta, $nome) {
  $o = Join-Path $r2 ($nome + '.txt')
  $p = Start-Process $exe -ArgumentList $argumentos -WorkingDirectory $pasta -NoNewWindow -PassThru -RedirectStandardOutput $o -RedirectStandardError ($o + '.err')
  $null = $p.Handle # sem abrir o handle aqui, o PowerShell 5.1 devolve ExitCode vazio
  if (-not $p.WaitForExit(150000)) { Stop-Process -Id $p.Id -Force; throw ($nome + ': tempo esgotado') }
  $p.WaitForExit()
  ($nome + ' saida=' + $p.ExitCode)
  Get-Content $o -Encoding UTF8
  Get-Content ($o + '.err') -Encoding UTF8 | Where-Object { $_ -notmatch 'ExperimentalWarning|trace-warnings' } | Select-Object -Last 12
}

Rodar 'node' @((Join-Path $sp 'costura-t6.mjs'), '--conferir') $v 'costura'
Rodar 'node' @((Join-Path $sp 'semente-t6.mjs'), $v, $casa) $r2 'semente'

Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$env:OMNI_HOME = $casa; $env:OMNI_CASA_BANCO = (Join-Path $casa 'casa'); $env:OMNI_NODE = (Get-Command node).Source
$env:OMNI_ILHA_ESCONDIDA = '1'; $env:OMNI_ILHA_TESTE = (Join-Path $sp 'bancada-t6.js'); $env:OMNI_BANCADA_SAIDA = $saida
Rodar $Electron @((Join-Path $v 'apps\omni-ilha'), ('--user-data-dir=' + $ud)) $r2 'eletron'

$res = Get-Content (Join-Path $saida 'resultado.json') -Encoding UTF8 -Raw | ConvertFrom-Json
foreach ($c in $res) { (($(if ($c.ok) { 'ok    ' } else { 'FALHOU' })) + ' ' + $c.nome + $(if (-not $c.ok) { ' :: ' + $c.detalhe } else { '' })) }
('conferencias: ' + @($res).Count + ', falharam: ' + @($res | Where-Object { -not $_.ok }).Count)
('guarda: ' + (Test-Path "$env:LOCALAPPDATA\omni\casa"))
```

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so semente-t6.mjs bancada-t6.js prova-t6.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File "$rascunho\prova-t6.ps1"; "saida: $LASTEXITCODE"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado:
- `gravado` nos três;
- `costura saida=0`, com `costurado` nos dois;
- `semente saida=0` e `{"vivas":9,"lixeira":2,"alertas":["sem-uso:banco-teste/leitura","vence:correio/smtp","teste-falhou:fila/token-ingestao","agente-nunca-usou:relatorios/conta-servico"]}`;
- `eletron saida=0`;
- vinte e três `ok`, nenhum `FALHOU`, `conferencias: 23, falharam: 0` (sem acento: o PowerShell 5.1 lê o script sem BOM como ANSI, e o que ele imprime é ASCII) e `guarda: False`;
- `saida: 0` e `False`.

Depois, as nove fotos (`$rascunho\prova-t6\1-saude.png` a `9-lixeira.png`) passam pelo anti-slop-review, com o registro de APP: nenhuma regra violada. O contraste é calculado, não estimado: a tinta mais fraca (`#8a91a3`) sobre o fundo (`#11141a`) passa de 4,5:1.

Resultado (07/11): a primeira rodada deu as vinte e três conferências verdes e `guarda: False`, mas com `saida=` vazio nas três etapas e `conferÃªncias`: o PowerShell 5.1 devolve `ExitCode` vazio quando o handle do `Start-Process` não é aberto logo depois, e lê o script sem BOM como ANSI. O script passou a abrir o handle (`$null = $p.Handle`) e a imprimir só ASCII, o plano foi remontado e a segunda rodada deu: `gravado prova-t6.ps1` (`igual` nos outros dois); `costura saida=0` com `costurado` nos dois; `semente saida=0` e o JSON esperado; `eletron saida=0`; vinte e três `ok`, `conferencias: 23, falharam: 0` e `guarda: False`; `saida: 0` e `False`. As nove fotos são as do ensaio, que já tinha passado pelo anti-slop-review (registro APP, as escalas declaradas, um só botão cheio por tela, contraste calculado): o `cofre.html` e o `cofre-janela.js` não mudaram desde então.

- [x] **Passo 11: a guarda e o conferir.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
git status --short
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --conferir; "saida: $LASTEXITCODE"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado:
- no status, além dos ` M dist/…` de fim de linha (item 15), as dezessete linhas da T5 e mais sete: ` M apps/omni-ilha/main.js`, ` M apps/omni-ilha/preload.js`, `?? apps/omni-ilha/cofre-ipc.js`, `?? apps/omni-ilha/cofre-janela.js`, `?? apps/omni-ilha/cofre-preload.js`, `?? apps/omni-ilha/cofre.html` e `?? testes/ilha-cofre-ipc.test.mjs`;
- trinta e quatro `igual` (os vinte e quatro da T5, mais a IC, os canais, a janela em três arquivos, a lista da T6 e os quatro rascunhos da prova), nenhum `AUSENTE` e `saida: 0`;
- `False`.

Resultado (07/11): no status, as vinte e quatro linhas esperadas além dos ` M dist/…`; trinta e quatro `igual`, nenhum `AUSENTE` e `saida: 0`; e `False`.

### Task 7: o card

**Arquivos:** criar `apps/omni-ilha/cofre-card.js` (o que o card decide) e `testes/ilha-cofre-card.test.mjs` (CC, 13 testes); modificar `apps/omni-ilha/renderer.js` e `index.html`, pela costura. Rascunhos: `costura-t7.mjs`, `bancada-t7.js` e `prova-t7.ps1`; a semente é a da T6.

O que o card decide (`cofre-card.js`, puro, sem DOM e sem processo, no molde UMD do `olho.js`: `module.exports` no Node e `window.cofreCard` no renderer):
- `deveLer({ agora, lidoEm, lendo, motivo })`: nunca durante uma leitura; sempre na primeira; com o relógio que voltou (ou `lidoEm` sem número), relê em vez de esperar; ao abrir a forma (`motivo: 'abriu'`), relê se a última leitura tem 1 min ou mais (`PISO_ABERTURA_MS`); aberta, pelo relógio (`'relogio'`), a cada 5 min (`INTERVALO_MS`). Cada leitura abre um Node com a CLI do cofre, que leva segundos: o relógio de 2 s da ilha e o de 4 s do retrato do Overcore não servem aqui;
- `vistaDoCard(resumo)` traduz o `cofre:resumo` da T6 (`{ ok, total, alertas, primeiros }`) no que o card mostra: o total, `CREDENCIAL` no singular, `nada a olhar` ou `N alerta(s)`, e as duas primeiras linhas (`MAX_LINHAS`) com o nome e a regra em palavras (`sem uso`, `vence`, `teste falhou`, `agente parado`). Regra que o card não conhece passa crua. A falha da mão vira `erro`: um traço no lugar do número, o código em palavras (`sem Node`, `sem resposta`, `resposta grande`, `falhou`, `pedido recusado`, `resposta ilegível`; o desconhecido vira `sem leitura`) e o texto inteiro à parte.

O desenho falava em reler "ao focar". A ilha nunca pega o foco (`focusable: false`): o equivalente é a abertura da forma, que é quando o Weriton olha para ela. A ilha também lê uma vez ao ligar, ainda recolhida, porque o `iniciar()` chama o `atualizar()`; isso deixa o card pronto na primeira abertura. O piso de 1 min entre aberturas fica provado só pela CC: a prova visual não espera um minuto.

A costura (`costura-t7.mjs`, rascunho, roda da raiz, com o mesmo motor da T6: âncora que aparece uma vez, acréscimo que já está lá pula, `igual` na segunda rodada, `--conferir`, fim de linha preservado). As trocas:
- `renderer.js`: o glifo `cofre` (um cadeado) no `GLIFOS`; `tom-cofre` nos `TONS` e no `TOM_INICIAL`; depois do `atualizarOvercore`, o bloco do card (`atualizarCofre(motivo)`, que pergunta ao `deveLer`, chama o `ponte.resumoCofre()` e desenha só quando a vista muda, e `desenharCofre(vista)`, que troca as classes, tinge o cadeado de âmbar no alerta, de cinza no erro e de verde-água no resto, e põe o erro longo numa linha com reticências e o texto inteiro no `title`); o `atualizarCofre('abriu')` no `ir('aberta')`; o `atualizarCofre('relogio')` no relógio, sem `await`, para a CLI não segurar os outros cards; e o toque no card, que abre a janela da T6, zera o `lidoEm` (a próxima abertura relê o que mudou lá) e recolhe a ilha, como o card do Actions;
- `index.html`: a cor `--cofre` (`#74d4c0`, o verde-água da janela) e o `tom-cofre`; o estilo do card, com 108 px de altura fixa embaixo do card do Omni, no molde dos cards de integração; a marcação do card; e o `<script>` do `cofre-card.js` depois do `olho.js`. A regra e o erro usam `--dim-2` e `--dim` em vez do `--dim-3` dos outros cards, que dá 3,7:1 sobre o card: são o recado dele e precisam passar de 4,5:1.

O lugar do card é escolha visual, reversível, e vai ao Weriton como decisão: embaixo do Omni, na coluna da máquina, sem apertar o Actions nem o WhatsApp, que dividem a outra coluna.

- [x] **Passo 1: o teste.**

```js arquivo=testes/ilha-cofre-card.test.mjs
// O card do cofre na ilha (F1, plano 5, T7): quando ler e o que mostrar. Módulo puro, sem DOM e sem processo:
// o relógio é um número que a prova passa, e o resumo é o objeto que a mão devolveria.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { deveLer, vistaDoCard, INTERVALO_MS, PISO_ABERTURA_MS, MAX_LINHAS } = require('../apps/omni-ilha/cofre-card.js')

const T0 = 1_800_000_000_000
const MIN = 60 * 1000

test('CC: os prazos são 5 min aberta e 1 min entre aberturas; o card mostra 2 linhas', () => {
  assert.equal(INTERVALO_MS, 5 * MIN)
  assert.equal(PISO_ABERTURA_MS, MIN)
  assert.equal(MAX_LINHAS, 2)
})

test('CC: lendo, nunca lê de novo, nem nunca lido', () => {
  assert.equal(deveLer({ agora: T0, lidoEm: null, lendo: true, motivo: 'abriu' }), false)
  assert.equal(deveLer({ agora: T0, lidoEm: T0 - 10 * MIN, lendo: true, motivo: 'relogio' }), false)
})

test('CC: nunca lido, lê pelos dois motivos', () => {
  assert.equal(deveLer({ agora: T0, lidoEm: null, lendo: false, motivo: 'abriu' }), true)
  assert.equal(deveLer({ agora: T0, lidoEm: undefined, lendo: false, motivo: 'relogio' }), true)
})

test('CC: ao abrir, relê só depois de 1 min da última leitura', () => {
  assert.equal(deveLer({ agora: T0, lidoEm: T0 - (MIN - 1000), lendo: false, motivo: 'abriu' }), false)
  assert.equal(deveLer({ agora: T0, lidoEm: T0 - MIN, lendo: false, motivo: 'abriu' }), true)
})

test('CC: aberta, o relógio relê só a cada 5 min', () => {
  assert.equal(deveLer({ agora: T0, lidoEm: T0 - MIN, lendo: false, motivo: 'relogio' }), false)
  assert.equal(deveLer({ agora: T0, lidoEm: T0 - (5 * MIN - 1000), lendo: false, motivo: 'relogio' }), false)
  assert.equal(deveLer({ agora: T0, lidoEm: T0 - 5 * MIN, lendo: false, motivo: 'relogio' }), true)
})

test('CC: relógio que voltou ou leitura sem número relê em vez de esperar', () => {
  assert.equal(deveLer({ agora: T0, lidoEm: T0 + 10 * MIN, lendo: false, motivo: 'relogio' }), true)
  assert.equal(deveLer({ agora: T0, lidoEm: Number.NaN, lendo: false, motivo: 'relogio' }), true)
})

test('CC: sem alertas, o card mostra o total e "nada a olhar"', () => {
  assert.deepEqual(vistaDoCard({ ok: true, total: 9, alertas: 0, primeiros: [] }),
    { estado: 'ok', numero: '9', rotulo: 'CREDENCIAIS', detalhe: 'nada a olhar', erro: '', linhas: [] })
})

test('CC: uma credencial vai no singular', () => {
  const v = vistaDoCard({ ok: true, total: 1, alertas: 0, primeiros: [] })
  assert.equal(v.numero, '1')
  assert.equal(v.rotulo, 'CREDENCIAL')
  assert.equal(vistaDoCard({ ok: true, total: 0, alertas: 0, primeiros: [] }).rotulo, 'CREDENCIAIS')
})

test('CC: um alerta vira estado de alerta com a linha da regra', () => {
  assert.deepEqual(vistaDoCard({ ok: true, total: 4, alertas: 1, primeiros: [{ regra: 'vence', nome: 'correio/smtp' }] }),
    { estado: 'alerta', numero: '4', rotulo: 'CREDENCIAIS', detalhe: '1 alerta', erro: '', linhas: [{ nome: 'correio/smtp', regra: 'vence' }] })
})

test('CC: vários alertas mostram só as 2 primeiras linhas, com o rótulo de cada regra', () => {
  const v = vistaDoCard({ ok: true, total: 9, alertas: 4, primeiros: [
    { regra: 'sem-uso', nome: 'banco-teste/leitura' },
    { regra: 'teste-falhou', nome: 'fila/token-ingestao' },
    { regra: 'agente-nunca-usou', nome: 'relatorios/conta-servico' },
  ] })
  assert.equal(v.estado, 'alerta')
  assert.equal(v.detalhe, '4 alertas')
  assert.deepEqual(v.linhas, [{ nome: 'banco-teste/leitura', regra: 'sem uso' }, { nome: 'fila/token-ingestao', regra: 'teste falhou' }])
  assert.equal(vistaDoCard({ ok: true, total: 2, alertas: 1, primeiros: [{ regra: 'agente-nunca-usou', nome: 'a/b' }] }).linhas[0].regra, 'agente parado')
})

test('CC: regra que o card não conhece passa crua', () => {
  assert.deepEqual(vistaDoCard({ ok: true, total: 1, alertas: 1, primeiros: [{ regra: 'nova-regra', nome: 'x/y' }] }).linhas,
    [{ nome: 'x/y', regra: 'nova-regra' }])
})

test('CC: falha da mão vira estado de erro com o detalhe do código e o texto inteiro à parte', () => {
  assert.deepEqual(vistaDoCard({ ok: false, codigo: 'tempo', erro: 'o cofre não respondeu em 20 s' }),
    { estado: 'erro', numero: '–', rotulo: 'CREDENCIAIS', detalhe: 'sem resposta', erro: 'o cofre não respondeu em 20 s', linhas: [] })
  assert.equal(vistaDoCard({ ok: false, codigo: 'sem-node', erro: 'x' }).detalhe, 'sem Node')
  assert.equal(vistaDoCard({ ok: false, codigo: 'ilegivel', erro: 'x' }).detalhe, 'resposta ilegível')
})

test('CC: código que o card não conhece, ou resposta nula, vira "sem leitura"', () => {
  const v = vistaDoCard({ ok: false, codigo: 'novo-codigo' })
  assert.equal(v.estado, 'erro')
  assert.equal(v.detalhe, 'sem leitura')
  assert.equal(v.erro, '')
  const n = vistaDoCard(null)
  assert.equal(n.estado, 'erro')
  assert.equal(n.detalhe, 'sem leitura')
  assert.deepEqual(n.linhas, [])
})
```

- [x] **Passo 2: extrair o teste e ver o vermelho.**

```powershell
Test-Path "$env:LOCALAPPDATA\omni\casa"
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so testes/ilha-cofre-card.test.mjs
node --test --test-concurrency=1 --test-reporter=spec testes/ilha-cofre-card.test.mjs *> "$rascunho\p5-t7-vermelho.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\p5-t7-vermelho.txt" -Pattern 'Cannot find module', '(tests|pass|fail) \d+\s*$'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `False`, `gravado testes/ilha-cofre-card.test.mjs`, `saida: 1`, `Cannot find module '../apps/omni-ilha/cofre-card.js'`, `tests 1`, `pass 0`, `fail 1` e `False`.

Resultado (07/11): `False`, `gravado testes/ilha-cofre-card.test.mjs`, `saida: 1`, `Cannot find module '../apps/omni-ilha/cofre-card.js'`, `tests 1`, `pass 0`, `fail 1` e `False`.

- [x] **Passo 3: o que o card decide.**

```js arquivo=apps/omni-ilha/cofre-card.js
'use strict';

// O card do cofre na ilha (F1, plano 5, T7): quando ler o resumo e o que mostrar, sem DOM. O renderer só
// desenha o que este módulo decide. Cada leitura abre um Node com a CLI do cofre, então o card nunca lê no
// relógio de 2 s da ilha: lê ao abrir a forma (no máximo uma vez por minuto) e, com ela aberta, a cada 5 min.
// Roda no Node (a suíte CC) e no renderer, que o carrega por <script> antes do renderer.js (window.cofreCard).
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.cofreCard = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  const INTERVALO_MS = 5 * 60 * 1000;
  const PISO_ABERTURA_MS = 60 * 1000;
  const MAX_LINHAS = 2;
  const ROTULO_REGRA = { vence: 'vence', 'teste-falhou': 'teste falhou', 'sem-uso': 'sem uso', 'agente-nunca-usou': 'agente parado' };
  // os códigos da mão (cofre.js); o texto inteiro do erro vai no title e na linha do card
  const DETALHE_ERRO = { 'sem-node': 'sem Node', tempo: 'sem resposta', teto: 'resposta grande', falha: 'falhou', uso: 'pedido recusado', ilegivel: 'resposta ilegível' };

  // motivo: 'abriu' (a forma acabou de abrir) ou 'relogio' (o relógio de 2 s da ilha aberta).
  function deveLer({ agora, lidoEm, lendo, motivo }) {
    if (lendo) return false;
    if (lidoEm == null) return true;
    const idade = agora - lidoEm;
    if (!(idade >= 0)) return true; // o relógio voltou: lê de novo em vez de esperar um prazo que não fecha
    return idade >= (motivo === 'abriu' ? PISO_ABERTURA_MS : INTERVALO_MS);
  }

  function vistaDoCard(r) {
    if (!r || !r.ok) {
      const codigo = String((r && r.codigo) || '');
      return { estado: 'erro', numero: '–', rotulo: 'CREDENCIAIS', detalhe: DETALHE_ERRO[codigo] || 'sem leitura', erro: String((r && r.erro) || ''), linhas: [] };
    }
    const total = Number(r.total) || 0;
    const alertas = Number(r.alertas) || 0;
    const primeiros = Array.isArray(r.primeiros) ? r.primeiros : [];
    return {
      estado: alertas > 0 ? 'alerta' : 'ok',
      numero: String(total),
      rotulo: total === 1 ? 'CREDENCIAL' : 'CREDENCIAIS',
      detalhe: alertas === 0 ? 'nada a olhar' : alertas === 1 ? '1 alerta' : `${alertas} alertas`,
      erro: '',
      linhas: primeiros.slice(0, MAX_LINHAS).map(({ regra, nome }) => ({ nome: String(nome), regra: ROTULO_REGRA[regra] || String(regra) })),
    };
  }

  return { INTERVALO_MS, PISO_ABERTURA_MS, MAX_LINHAS, ROTULO_REGRA, DETALHE_ERRO, deveLer, vistaDoCard };
});
```

- [x] **Passo 4: extrair e ver o verde.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so apps/omni-ilha/cofre-card.js
node --check apps/omni-ilha/cofre-card.js; "check: $LASTEXITCODE"
node --test --test-concurrency=1 --test-reporter=spec testes/ilha-cofre-card.test.mjs *> "$rascunho\p5-t7-verde.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\p5-t7-verde.txt" -Pattern '(tests|pass|fail) \d+\s*$'
foreach ($a in 'apps/omni-ilha/cofre-card.js', 'testes/ilha-cofre-card.test.mjs') { $a + ' CR: ' + ([IO.File]::ReadAllText((Resolve-Path $a)).Split([char]13).Count - 1) }
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `gravado apps/omni-ilha/cofre-card.js`, `check: 0`, `tests 13`, `pass 13`, `fail 0`, `saida: 0`, CR 0 nos dois e `False`.

Resultado (07/11): `gravado apps/omni-ilha/cofre-card.js`, `check: 0`, `tests 13`, `pass 13`, `fail 0`, `saida: 0`, CR 0 nos dois e `False`.

- [x] **Passo 5: a costura.**

```js rascunho=costura-t7.mjs
// Costura da T7 (F1, plano 5): o card do cofre na ilha. No renderer.js entram o cadeado, o tom, a leitura do
// resumo (no ritmo do cofre-card.js) e o toque que abre a janela da T6; no index.html, o card embaixo do Omni,
// o estilo dele e o <script> do cofre-card.js. Roda da raiz do repositório. Cada troca acrescenta texto junto de
// uma âncora; se o acréscimo já está lá (uma vez), a troca é pulada, então rodar de novo dá "igual". Âncora
// ausente ou repetida: sai 1 sem gravar nada. Preserva o fim de linha do arquivo (CRLF ou LF).
// --conferir: não grava; sai 1 se faltar alguma troca.
import { readFileSync, writeFileSync } from 'node:fs';

const conferir = process.argv.includes('--conferir');

const FIM_OVERCORE = "    $('oc-ultima').textContent = r.ok && r.ultima ? `última atividade: ${quando(typeof r.ultima === 'number' ? r.ultima : Date.parse(r.ultima))}` : '';\n  }";

const BLOCO_CARD = `

  // ── card do cofre (F1, plano 5, T7): o total de credenciais e os primeiros alertas. Cada leitura abre um Node
  // com a CLI do cofre (segundos), então o ritmo é o do cofre-card.js, não o relógio de 2 s: ao abrir a forma
  // (no máximo 1x/min) e, aberta, a cada 5 min. Tocar abre a janela do cofre; a abertura seguinte relê.
  const cardCofre = document.getElementById('card-cofre');
  const { deveLer, vistaDoCard } = window.cofreCard;
  const cofre = { lidoEm: null, lendo: false, assinatura: '' };
  async function atualizarCofre(motivo) {
    if (!deveLer({ agora: Date.now(), lidoEm: cofre.lidoEm, lendo: cofre.lendo, motivo })) return;
    cofre.lendo = true;
    let r;
    try { r = await ponte.resumoCofre(); } catch (e) { r = { ok: false, codigo: 'falha', erro: String((e && e.message) || e) }; } finally { cofre.lendo = false; }
    if (r === null) return; // o main recusou o pedido (não veio da ilha): nada a mostrar
    cofre.lidoEm = Date.now();
    desenharCofre(vistaDoCard(r));
  }
  function desenharCofre(v) {
    const assinatura = JSON.stringify(v);
    if (assinatura === cofre.assinatura) return;
    cofre.assinatura = assinatura;
    cardCofre.classList.toggle('alerta', v.estado === 'alerta');
    cardCofre.classList.toggle('erro', v.estado === 'erro');
    const svg = cardCofre.querySelector('.icone');
    if (svg) tingir(svg, v.estado === 'alerta' ? 'tom-espera' : v.estado === 'erro' ? 'tom-ociosa' : 'tom-cofre');
    $('cofre-total').textContent = v.numero;
    $('cofre-rotulo').textContent = v.rotulo;
    $('cofre-detalhe').textContent = v.detalhe;
    $('cofre-detalhe').title = v.erro;
    const linhas = v.linhas.map(({ nome, regra }) => {
      const linha = no('div', 'int-linha');
      linha.append(no('i', 'pt st-espera'), no('span', 'int-nome', nome), no('span', 'int-quando', regra));
      return linha;
    });
    if (v.estado === 'erro' && v.erro) {
      const aviso = no('div', 'int-vazio', v.erro);
      aviso.title = v.erro; // a linha corta com reticências; o texto inteiro fica no title
      linhas.push(aviso);
    }
    $('cofre-linhas').replaceChildren(...linhas);
  }`;

const COSTURAS = [
  {
    arquivo: 'apps/omni-ilha/renderer.js',
    trocas: [
      {
        de: "      el('rect', { class: 'cheio cursor', x: 32, y: 38, width: 13, height: 4.5, rx: 2 }),\n    ],",
        para: "      el('rect', { class: 'cheio cursor', x: 32, y: 38, width: 13, height: 4.5, rx: 2 }),\n    ],\n" +
          '    // cadeado: o cofre das credenciais (T7)\n' +
          '    cofre: () => [\n' +
          "      el('path', { class: 'glifo', d: 'M24 29 V24 a8 8 0 0 1 16 0 V29' }),\n" +
          "      el('rect', { class: 'glifo', x: 18, y: 29, width: 28, height: 19, rx: 4 }),\n" +
          "      el('circle', { class: 'cheio', cx: 32, cy: 37, r: 2.8 }),\n" +
          "      el('path', { class: 'glifo', d: 'M32 39 V42' }),\n" +
          '    ],',
      },
      {
        de: "'tom-whats', 'tom-oracle'];",
        para: "'tom-whats', 'tom-oracle', 'tom-cofre'];",
      },
      {
        de: FIM_OVERCORE,
        para: FIM_OVERCORE + BLOCO_CARD,
      },
      {
        de: "    if (novo === 'aberta') { atualizar(); vigiar(true); } else vigiar(false);",
        para: "    if (novo === 'aberta') { atualizarCofre('abriu'); atualizar(); vigiar(true); } else vigiar(false);",
      },
      {
        de: '        await Promise.all([atualizarActions(), atualizarSistema(), atualizarWhats(), atualizarOracle(), atualizarOvercore()]);',
        para: "        atualizarCofre('relogio'); // sem await: a CLI do cofre pode levar segundos e não segura o relógio\n" +
          '        await Promise.all([atualizarActions(), atualizarSistema(), atualizarWhats(), atualizarOracle(), atualizarOvercore()]);',
      },
      {
        de: "  tocar(cardActions, () => {\n    if (estado !== 'aberta' || !poco.classList.contains('revelada')) return;\n    ponte.abrirActions();\n    recolherJa();\n  });",
        para: "  tocar(cardActions, () => {\n    if (estado !== 'aberta' || !poco.classList.contains('revelada')) return;\n    ponte.abrirActions();\n    recolherJa();\n  });\n" +
          '  // o card do cofre abre a janela da T6; ao voltar, a ilha relê (o que mudou lá aparece aqui)\n' +
          "  tocar(cardCofre, () => {\n    if (estado !== 'aberta' || !poco.classList.contains('revelada')) return;\n    ponte.abrirCofre();\n    cofre.lidoEm = null;\n    recolherJa();\n  });",
      },
      {
        de: "oracle: 'tom-ociosa' };",
        para: "oracle: 'tom-ociosa', cofre: 'tom-cofre' };",
      },
    ],
  },
  {
    arquivo: 'apps/omni-ilha/index.html',
    trocas: [
      {
        de: '  --violeta: #a78bfa;',
        para: '  --violeta: #a78bfa;\n  --cofre: #74d4c0; /* verde-água do cofre, o mesmo da janela dele (T6) */',
      },
      {
        de: '.tom-oracle { --tom: var(--violeta); --brilho: rgba(167, 139, 250, .4); }',
        para: '.tom-oracle { --tom: var(--violeta); --brilho: rgba(167, 139, 250, .4); }\n.tom-cofre { --tom: var(--cofre); --brilho: rgba(116, 212, 192, .38); }',
      },
      {
        de: '.coluna-maquina > .card-espaco { flex: 1 1 0; min-height: 0; }',
        para: '.coluna-maquina > .card-espaco { flex: 1 1 0; min-height: 0; }\n' +
          '/* o card do cofre (F1, plano 5, T7): altura fixa embaixo do Omni, no molde dos cards de integração; tocar abre a janela */\n' +
          '.coluna-maquina > .card-cofre { flex: none; height: 108px; cursor: pointer; transition: transform .12s, filter .12s; }\n' +
          '.card-cofre .lugar-icone { width: 64px; }\n' +
          '.card-cofre .icone { width: 40px; height: 40px; }\n' +
          '.card-cofre .int { padding: 9px 14px 8px 64px; height: 100%; }\n' +
          '.card-cofre .int-linhas { overflow: hidden; padding-top: 4px; }\n' +
          '/* a regra e o erro são o recado do card: tons que passam de 4,5:1 sobre o card (o --dim-3 dá 3,7) */\n' +
          '.card-cofre .int-quando { color: var(--dim-2); }\n' +
          '.card-cofre .int-vazio { color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n' +
          '.card-cofre:hover { filter: brightness(1.08); }\n' +
          '.card-cofre:active { transform: scale(.985); }\n' +
          '.card-cofre:hover .abre { color: var(--ink); translate: 1px -1px; }\n' +
          '.card-cofre.alerta #cofre-detalhe { color: var(--ambar); }\n' +
          '.card-cofre.erro #cofre-detalhe { color: var(--vermelho); }',
      },
      {
        de: '                <!-- 27/10: disco, CPU e RAM foram para a metade de baixo do card do Oracle (pedido dele) -->\n              </div>',
        para: '                <!-- 27/10: disco, CPU e RAM foram para a metade de baixo do card do Oracle (pedido dele) -->\n              </div>\n' +
          '              <!-- F1, plano 5, T7: o cofre das credenciais; tocar abre a janela dele -->\n' +
          '              <div class="card lava card-cofre" id="card-cofre" style="--lava: rgba(116, 212, 192, .13)" title="Abrir o cofre">\n' +
          '                <div class="lugar-icone" data-icone="cofre"></div>\n' +
          '                <div class="int">\n' +
          '                  <div class="int-cab"><i class="bolinha"></i><b>Cofre</b><span>Credenciais</span><span class="abre">↗</span></div>\n' +
          '                  <div class="int-saldo"><span id="cofre-total">–</span><i id="cofre-rotulo">CREDENCIAIS</i><em id="cofre-detalhe"></em></div>\n' +
          '                  <div class="int-linhas" id="cofre-linhas"></div>\n' +
          '                </div>\n' +
          '              </div>',
      },
      {
        de: '<script src="olho.js"></script>',
        para: '<script src="olho.js"></script>\n<script src="cofre-card.js"></script>',
      },
    ],
  },
];

const vezes = (texto, trecho) => texto.split(trecho).length - 1;

const prontos = [];
let faltam = 0;
for (const { arquivo, trocas } of COSTURAS) {
  const original = readFileSync(arquivo, 'utf8');
  const crlf = original.includes('\r\n');
  let texto = original.replace(/\r\n/g, '\n');
  for (const [i, { de, para }] of trocas.entries()) {
    if (vezes(texto, para) === 1) continue;
    const n = vezes(texto, de);
    if (n !== 1) {
      console.error(`${arquivo}: a âncora da troca ${i + 1} aparece ${n} vezes (esperado 1); nada foi gravado`);
      process.exit(1);
    }
    faltam += 1;
    texto = texto.replace(de, () => para);
  }
  const final = crlf ? texto.replace(/\n/g, '\r\n') : texto;
  prontos.push({ arquivo, mudou: final !== original, final });
}

if (conferir) {
  for (const { arquivo, mudou } of prontos) console.log(`${arquivo}: ${mudou ? 'FALTA' : 'costurado'}`);
  process.exit(faltam ? 1 : 0);
}
for (const { arquivo, mudou, final } of prontos) {
  if (mudou) writeFileSync(arquivo, final, 'utf8');
  console.log(`${arquivo}: ${mudou ? 'gravado' : 'igual'}`);
}
```

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so costura-t7.mjs
node "$rascunho\costura-t7.mjs" --conferir; "conferir antes: $LASTEXITCODE"
node "$rascunho\costura-t7.mjs"; "costura: $LASTEXITCODE"
node "$rascunho\costura-t7.mjs"; "de novo: $LASTEXITCODE"
node "$rascunho\costura-t7.mjs" --conferir; "conferir depois: $LASTEXITCODE"
node --check apps/omni-ilha/renderer.js; "check: $LASTEXITCODE"
foreach ($a in 'apps/omni-ilha/renderer.js', 'apps/omni-ilha/index.html') {
  $t = [IO.File]::ReadAllText((Resolve-Path $a))
  $a + ' CR: ' + ($t.Split([char]13).Count - 1) + ', LF: ' + ($t.Split([char]10).Count - 1)
}
git ls-files --eol apps/omni-ilha/renderer.js apps/omni-ilha/index.html
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado:
- `gravado costura-t7.mjs`;
- no primeiro `--conferir`, `FALTA` nos dois e `conferir antes: 1`;
- `gravado` nos dois e `costura: 0`; rodando de novo, `igual` nos dois e `de novo: 0`;
- no segundo `--conferir`, `costurado` nos dois e `conferir depois: 0`;
- `check: 0`, com CR igual a LF em cada um: 1256 no `renderer.js` e 719 no `index.html`;
- `i/lf    w/crlf` nos dois e `False`.

Resultado (07/11): `gravado costura-t7.mjs`; `FALTA` nos dois e `conferir antes: 1`; `gravado` nos dois e `costura: 0`; `igual` nos dois e `de novo: 0`; `costurado` nos dois e `conferir depois: 0`; `check: 0`; `renderer.js` com CR 1256 e LF 1256, `index.html` com CR 719 e LF 719; `i/lf    w/crlf` nos dois e `False`.

**Mutação.** Vinte mutantes, todos no `cofre-card.js`, com os critérios da T1. Nenhum equivalente. A costura não tem mutante: o renderer não tem suíte, e quem prova o card desenhado, o ritmo das leituras e o toque é a prova visual (Passo 9). O 01, o 02 e o 03 caem em dois testes: na constante (CC 1) e no comportamento que ela governa.

```json rascunho=mutantes-p5-t7.json
[
  { "nome": "01 intervalo de 4 min", "arquivo": "apps/omni-ilha/cofre-card.js", "de": "const INTERVALO_MS = 5 * 60 * 1000;", "para": "const INTERVALO_MS = 4 * 60 * 1000;", "teste": ["testes/ilha-cofre-card.test.mjs"] },
  { "nome": "02 piso de 30 s", "arquivo": "apps/omni-ilha/cofre-card.js", "de": "const PISO_ABERTURA_MS = 60 * 1000;", "para": "const PISO_ABERTURA_MS = 30 * 1000;", "teste": ["testes/ilha-cofre-card.test.mjs"] },
  { "nome": "03 três linhas", "arquivo": "apps/omni-ilha/cofre-card.js", "de": "const MAX_LINHAS = 2;", "para": "const MAX_LINHAS = 3;", "teste": ["testes/ilha-cofre-card.test.mjs"] },
  { "nome": "04 lê de novo durante a leitura", "arquivo": "apps/omni-ilha/cofre-card.js", "de": "if (lendo) return false;", "para": "if (false) return false;", "teste": ["testes/ilha-cofre-card.test.mjs"] },
  { "nome": "05 nunca lido não lê", "arquivo": "apps/omni-ilha/cofre-card.js", "de": "if (lidoEm == null) return true;", "para": "if (lidoEm == null) return false;", "teste": ["testes/ilha-cofre-card.test.mjs"] },
  { "nome": "06 relógio que voltou espera", "arquivo": "apps/omni-ilha/cofre-card.js", "de": "if (!(idade >= 0)) return true;", "para": "if (!(idade >= 0)) return false;", "teste": ["testes/ilha-cofre-card.test.mjs"] },
  { "nome": "07 prazo estrito", "arquivo": "apps/omni-ilha/cofre-card.js", "de": "return idade >= (", "para": "return idade > (", "teste": ["testes/ilha-cofre-card.test.mjs"] },
  { "nome": "08 prazos trocados", "arquivo": "apps/omni-ilha/cofre-card.js", "de": "motivo === 'abriu' ? PISO_ABERTURA_MS", "para": "motivo === 'relogio' ? PISO_ABERTURA_MS", "teste": ["testes/ilha-cofre-card.test.mjs"] },
  { "nome": "09 resposta sem ok vira leitura", "arquivo": "apps/omni-ilha/cofre-card.js", "de": "if (!r || !r.ok) {", "para": "if (!r) {", "teste": ["testes/ilha-cofre-card.test.mjs"] },
  { "nome": "10 erro sem o detalhe do código", "arquivo": "apps/omni-ilha/cofre-card.js", "de": "detalhe: DETALHE_ERRO[codigo] || 'sem leitura'", "para": "detalhe: 'sem leitura'", "teste": ["testes/ilha-cofre-card.test.mjs"] },
  { "nome": "11 código desconhecido vazio", "arquivo": "apps/omni-ilha/cofre-card.js", "de": "|| 'sem leitura'", "para": "|| ''", "teste": ["testes/ilha-cofre-card.test.mjs"] },
  { "nome": "12 erro sem o texto inteiro", "arquivo": "apps/omni-ilha/cofre-card.js", "de": "erro: String((r && r.erro) || ''), linhas: []", "para": "erro: '', linhas: []", "teste": ["testes/ilha-cofre-card.test.mjs"] },
  { "nome": "13 erro com zero no lugar do traço", "arquivo": "apps/omni-ilha/cofre-card.js", "de": "numero: '–'", "para": "numero: '0'", "teste": ["testes/ilha-cofre-card.test.mjs"] },
  { "nome": "14 sem Node com outro texto", "arquivo": "apps/omni-ilha/cofre-card.js", "de": "'sem-node': 'sem Node'", "para": "'sem-node': 'sem node'", "teste": ["testes/ilha-cofre-card.test.mjs"] },
  { "nome": "15 alerta só a partir de dois", "arquivo": "apps/omni-ilha/cofre-card.js", "de": "estado: alertas > 0 ? 'alerta' : 'ok'", "para": "estado: alertas > 1 ? 'alerta' : 'ok'", "teste": ["testes/ilha-cofre-card.test.mjs"] },
  { "nome": "16 singular para zero também", "arquivo": "apps/omni-ilha/cofre-card.js", "de": "rotulo: total === 1 ? 'CREDENCIAL'", "para": "rotulo: total <= 1 ? 'CREDENCIAL'", "teste": ["testes/ilha-cofre-card.test.mjs"] },
  { "nome": "17 um alerta no plural", "arquivo": "apps/omni-ilha/cofre-card.js", "de": "alertas === 1 ? '1 alerta'", "para": "alertas === 1 ? '1 alertas'", "teste": ["testes/ilha-cofre-card.test.mjs"] },
  { "nome": "18 sem alertas com outro texto", "arquivo": "apps/omni-ilha/cofre-card.js", "de": "alertas === 0 ? 'nada a olhar'", "para": "alertas === 0 ? 'tudo certo'", "teste": ["testes/ilha-cofre-card.test.mjs"] },
  { "nome": "19 regra sem rótulo", "arquivo": "apps/omni-ilha/cofre-card.js", "de": "'sem-uso': 'sem uso'", "para": "'sem-uso': 'sem-uso'", "teste": ["testes/ilha-cofre-card.test.mjs"] },
  { "nome": "20 regra desconhecida some", "arquivo": "apps/omni-ilha/cofre-card.js", "de": "ROTULO_REGRA[regra] || String(regra)", "para": "ROTULO_REGRA[regra] || ''", "teste": ["testes/ilha-cofre-card.test.mjs"] }
]
```

Mapa previsto de mutante para teste:

| Mutante | Morre em | Como cai |
|---|---|---|
| 01 | CC 1 e CC 5 | `equal` da constante; `equal` do "4:59 não relê" |
| 02 | CC 1 e CC 4 | `equal` da constante; `equal` do "59 s não relê" |
| 03 | CC 1 e CC 10 | `equal` da constante; deepEqual das linhas, com a terceira |
| 04 | CC 2 | `equal` do `false` durante a leitura |
| 05 | CC 3 | `equal` do `true` na primeira leitura |
| 06 | CC 6 | `equal` do `true` com o relógio que voltou |
| 07 | CC 4 e CC 5 | `equal` do `true` no limite exato (1 min e 5 min) |
| 08 | CC 4 e CC 5 | `equal`: a abertura espera 5 min e o relógio relê com 1 min |
| 09 | CC 12 e CC 13 | deepEqual da vista de erro; `equal` do estado da resposta nula |
| 10 | CC 12 | deepEqual da vista (`sem leitura` no lugar de `sem resposta`) |
| 11 | CC 13 | `equal` do detalhe (`''` no lugar de `sem leitura`) |
| 12 | CC 12 | deepEqual da vista, sem o texto do erro |
| 13 | CC 12 | deepEqual da vista, com `0` no lugar do traço |
| 14 | CC 12 | `equal` do detalhe do `sem-node` |
| 15 | CC 9 | deepEqual da vista: um alerta fica `ok` |
| 16 | CC 8 | `equal` do rótulo com zero credenciais |
| 17 | CC 9 | deepEqual da vista (`1 alertas`) |
| 18 | CC 7 | deepEqual da vista (`tudo certo`) |
| 19 | CC 10 | deepEqual das linhas (`sem-uso` cru) |
| 20 | CC 11 | deepEqual das linhas (regra vazia) |

- [x] **Passo 6: extrair a lista e anotar os hashes.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so mutantes.mjs tabela-mutantes-p5.mjs mutantes-p5-t7.json
$alvos = 'apps/omni-ilha/cofre-card.js', 'testes/ilha-cofre-card.test.mjs'
$alvos | ForEach-Object { $_ + ' ' + (Get-FileHash $_ -Algorithm SHA256).Hash.Substring(0, 12) } | Set-Content -Encoding utf8 "$rascunho\hashes-antes-p5-t7.txt"
Get-Content "$rascunho\hashes-antes-p5-t7.txt"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `igual mutantes.mjs`, `igual tabela-mutantes-p5.mjs`, `gravado mutantes-p5-t7.json`, as duas linhas de hash e `False`.

Resultado (07/11): `igual mutantes.mjs`, `igual tabela-mutantes-p5.mjs`, `gravado mutantes-p5-t7.json`, `apps/omni-ilha/cofre-card.js F8392C5D863F`, `testes/ilha-cofre-card.test.mjs 7A006EA75844` e `False`.

- [x] **Passo 7: rodar, em segundo plano.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
node "$rascunho\mutantes.mjs" "$rascunho\mutantes-p5-t7.json" *> "$rascunho\mutantes-p5-t7.txt"; "saida: $LASTEXITCODE"
```

Esperado: a última linha de `mutantes-p5-t7.txt` é `20 mutantes em … s; fora do vermelho: 0`, e `saida: 0`.

Resultado (07/11): `20 mutantes em 3 s; fora do vermelho: 0` e `saida: 0`.

- [x] **Passo 8: a tabela e os hashes.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$alvos = 'apps/omni-ilha/cofre-card.js', 'testes/ilha-cofre-card.test.mjs'
node "$rascunho\tabela-mutantes-p5.mjs" "$rascunho\mutantes-p5-t7.json"; "saida: $LASTEXITCODE"
$depois = $alvos | ForEach-Object { $_ + ' ' + (Get-FileHash $_ -Algorithm SHA256).Hash.Substring(0, 12) }
Compare-Object (Get-Content "$rascunho\hashes-antes-p5-t7.txt") $depois
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `20 linhas: 20 vermelhos, 0 equivalente(s); testes mapeados: 26`, nenhuma linha `PROBLEMA` e `saida: 0`; o `Compare-Object` calado; e `False`. A tabela gerada (`$rascunho\mutantes-p5-t7.tabela.md`) entra no Apêndice G.

Resultado (07/11): `20 linhas: 20 vermelhos, 0 equivalente(s); testes mapeados: 26`, nenhuma linha `PROBLEMA`, `saida: 0`, o `Compare-Object` calado e `False`. Cada mutante caiu no teste e na asserção do mapa previsto.

- [x] **Passo 9: a prova visual.**

A semente é a da T6 (nove credenciais fictícias, quatro alertas, duas na lixeira), já extraída no `$rascunho`. A bancada é carregada pela ilha (`OMNI_ILHA_TESTE`) e, já no carregamento, troca o canal `cofre:resumo` por um embrulho que conta as leituras: na primeira fase ele passa pelos canais, pela mão e pela CLI de verdade, sobre a casa temporária; depois responde o que a prova manda. O cursor de verdade fica fora da conta (`trocarCursor`), para a ilha não recolher sozinha. Os toques são `PointerEvent` no card e no poço, como o dedo. A bancada confere:
- a ilha abre revelada (`--aberta`) e o card lê a casa: `9`, `CREDENCIAIS`, `4 alertas`, o cadeado em âmbar e as duas primeiras linhas, com `banco-teste/leitura` e `sem uso`;
- o card cabe nos 108 px dele e o card do Omni, em cima, continua cabendo;
- uma leitura só ao ligar e abrir, e nenhuma a mais depois de 2,5 s de relógio;
- tocar no card abre a janela do cofre e recolhe a ilha; ao reabrir, relê: `3`, `nada a olhar`, o cadeado em verde-água, sem linhas;
- com o cofre sem resposta (`tempo`), o traço, `sem resposta`, o cadeado cinza e o texto inteiro numa linha só, com reticências e no `title`.

O script copia a ilha já costurada e o `runtime` para uma pasta à parte, confere a costura na cópia, semeia a casa e roda o Electron 33 escondido, com um `--user-data-dir` próprio, como na T6.

```js rascunho=bancada-t7.js
'use strict';

// Bancada da prova visual da T7, carregada pela ilha via OMNI_ILHA_TESTE (a ilha começa aberta, --aberta). O
// canal cofre:resumo é trocado, já no carregamento, por um embrulho que conta as leituras: na primeira fase ele
// passa pela mão e pela CLI de verdade, sobre a casa temporária da semente; depois responde o que a prova
// manda (cofre vazio de alertas, cofre sem resposta). Os toques são PointerEvent no card e no poço, como o dedo.
// Saída: PNGs e resultado.json em OMNI_BANCADA_SAIDA.
const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');

const SAIDA = process.env.OMNI_BANCADA_SAIDA;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = (api) => {
  const conferencias = [];
  const conferir = (nome, ok, detalhe = '') => conferencias.push({ nome, ok: Boolean(ok), detalhe: String(detalhe) });

  // o resumo de verdade, montado à parte com um ipcMain falso; o do main é trocado pelo embrulho que conta
  const raiz = api.app.getAppPath();
  const { registrarIpcCofre } = require(path.join(raiz, 'cofre-ipc.js'));
  const { criarMaoCofre } = require(path.join(raiz, 'cofre.js'));
  const falso = new Map();
  registrarIpcCofre({ ipcMain: { handle: (canal, fn) => falso.set(canal, fn) }, mao: criarMaoCofre(), clipboard: null, daJanela: () => false, daIlha: () => true });
  const resumoReal = falso.get('cofre:resumo');
  let leituras = 0;
  let fixo = null;
  ipcMain.removeHandler('cofre:resumo');
  ipcMain.handle('cofre:resumo', async (evento) => { leituras += 1; return fixo ? fixo : resumoReal(evento); });
  // o cursor de verdade fica fora da conta: longe da ilha, ela nunca vê "entrou/saiu" e não recolhe sozinha
  api.trocarCursor(() => ({ x: -10000, y: -10000 }));

  async function rodar() {
    const wc = api.janela.webContents;
    await new Promise((r) => (wc.isLoading() ? wc.once('did-finish-load', r) : r()));
    const js = (codigo) => wc.executeJavaScript(codigo, true);
    const ilha = () => js('window.omniIlhaDepurar()');
    const card = () => js(`(() => { const c = document.getElementById('card-cofre'); const int = c.querySelector('.int'); const esp = document.querySelector('.coluna-maquina > .card-espaco');
      return { total: document.getElementById('cofre-total').textContent, rotulo: document.getElementById('cofre-rotulo').textContent,
        detalhe: document.getElementById('cofre-detalhe').textContent, titulo: document.getElementById('cofre-detalhe').title,
        linhas: [...document.querySelectorAll('#cofre-linhas .int-linha')].map((l) => l.textContent), vazio: [...document.querySelectorAll('#cofre-linhas .int-vazio')].map((l) => l.textContent),
        alerta: c.classList.contains('alerta'), erro: c.classList.contains('erro'), tom: [...(c.querySelector('.icone')?.classList || [])].find((t) => t.startsWith('tom-')) || '',
        altura: c.offsetHeight, cabe: int.scrollHeight <= int.clientHeight, omniCabe: esp.scrollHeight <= esp.clientHeight, omniAltura: esp.offsetHeight }; })()`);
    const ate = async (fn, cond, ms = 20000) => { const fim = Date.now() + ms; while (Date.now() < fim) { const e = await fn(); if (cond(e)) return e; await espera(150); } return fn(); };
    const tocarEm = (seletor) => js(`(() => { const el = document.querySelector(${JSON.stringify(seletor)}); const b = el.getBoundingClientRect();
      el.dispatchEvent(new PointerEvent('pointerup', { button: 0, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, bubbles: true })); return true; })()`);
    const foto = async (nome, soCard) => {
      await espera(500);
      const b = soCard ? await js("(() => { const b = document.getElementById('card-cofre').getBoundingClientRect(); return { x: Math.floor(b.left) - 8, y: Math.floor(b.top) - 8, width: Math.ceil(b.width) + 16, height: Math.ceil(b.height) + 16 }; })()") : undefined;
      const img = await (b ? wc.capturePage(b) : wc.capturePage());
      fs.writeFileSync(path.join(SAIDA, `${nome}.png`), img.toPNG());
      conferir(`foto ${nome}`, !img.isEmpty(), `${img.getSize().width}x${img.getSize().height}`);
    };
    const reabrir = async () => {
      await ate(ilha, (e) => e.estado === 'recolhida' && !e.animando, 5000);
      await tocarEm('#ilha');
      return ate(ilha, (e) => e.estado === 'aberta' && e.revelada && !e.animando, 8000);
    };

    let i = await ate(ilha, (e) => e.estado === 'aberta' && e.revelada && !e.animando, 8000);
    conferir('a ilha abriu revelada', i.estado === 'aberta' && i.revelada, JSON.stringify({ estado: i.estado, revelada: i.revelada }));

    let c = await ate(card, (e) => e.total !== '–');
    conferir('o card leu a casa: 9 credenciais, 4 alertas', c.total === '9' && c.rotulo === 'CREDENCIAIS' && c.detalhe === '4 alertas' && c.alerta && !c.erro && c.tom === 'tom-espera', JSON.stringify(c));
    conferir('2 linhas, com nome e regra', c.linhas.length === 2 && c.linhas[0].includes('banco-teste/leitura') && c.linhas[0].includes('sem uso'), JSON.stringify(c.linhas));
    conferir('o card cabe na altura dele, e o Omni em cima também', c.cabe && c.omniCabe && c.altura === 108, JSON.stringify({ altura: c.altura, cabe: c.cabe, omniCabe: c.omniCabe, omniAltura: c.omniAltura }));
    conferir('uma leitura só', leituras === 1, String(leituras));
    await foto('1-card-alertas', true);
    await foto('2-ilha', false);

    await espera(2500);
    conferir('o relógio de 2 s não relê o cofre', leituras === 1, String(leituras));

    fixo = { ok: true, total: 3, alertas: 0, primeiros: [] };
    await tocarEm('#card-cofre');
    i = await ate(ilha, (e) => e.estado === 'recolhida', 5000);
    const janela = api.janelaCofre();
    conferir('tocar abre a janela do cofre e recolhe a ilha', janela && !janela.isDestroyed() && i.estado === 'recolhida', JSON.stringify({ estado: i.estado, janela: Boolean(janela) }));
    await reabrir();
    c = await ate(card, (e) => e.total === '3');
    conferir('ao voltar, relê: 3 credenciais, nada a olhar', c.total === '3' && c.detalhe === 'nada a olhar' && !c.alerta && !c.erro && c.tom === 'tom-cofre' && c.linhas.length === 0 && leituras === 2, JSON.stringify({ ...c, leituras }));
    await foto('3-card-limpo', true);

    fixo = { ok: false, codigo: 'tempo', erro: 'o cofre não respondeu em 20 s; a leitura foi abandonada e a CLI encerrada antes de responder' };
    await tocarEm('#card-cofre');
    await reabrir();
    c = await ate(card, (e) => e.erro);
    conferir('cofre sem resposta: traço, detalhe e o texto inteiro', c.total === '–' && c.detalhe === 'sem resposta' && c.titulo === fixo.erro && c.vazio[0] === fixo.erro && c.tom === 'tom-ociosa' && leituras === 3, JSON.stringify({ ...c, leituras }));
    const corte = await js("(() => { const a = document.querySelector('#cofre-linhas .int-vazio'); const fonte = parseFloat(getComputedStyle(a).fontSize); return { altura: a.clientHeight, linha: a.clientHeight < 2 * fonte + 6, reticencias: a.scrollWidth > a.clientWidth, title: a.title }; })()");
    conferir('o erro longo cabe numa linha, com reticências e o title', c.cabe && corte.linha && corte.reticencias && corte.title === fixo.erro, JSON.stringify({ cabe: c.cabe, ...corte }));
    await foto('4-card-erro', true);
  }

  rodar()
    .catch((erro) => conferir('a bancada rodou até o fim', false, erro && erro.stack))
    .finally(() => {
      fs.writeFileSync(path.join(SAIDA, 'resultado.json'), JSON.stringify(conferencias, null, 2));
      setTimeout(() => api.app.exit(0), 300);
    });
};
```

```powershell rascunho=prova-t7.ps1
# Prova visual da T7: cópia da ilha já costurada + casa temporária semeada (a semente da T6) + ilha escondida e
# aberta, com a bancada do card. Roda da raiz do repositório, depois da costura. Nada toca a casa real: o card lê
# a casa temporária pela CLI de verdade e, depois, respostas fictícias da bancada. O Electron é o 33 que a ilha
# real usa: -Electron, ou a variável OMNI_ELECTRON, ou o do omni-desktop no checkout principal. A ilha real segue
# rodando: a cópia usa outro --user-data-dir, então a trava de instância única não a derruba. O PowerShell 5.1
# lê este arquivo (UTF-8 sem BOM) como ANSI: os acentos ficam só nos comentários, e o que ele imprime é ASCII.
param(
  [string]$Electron = $env:OMNI_ELECTRON
)
$ErrorActionPreference = 'Stop'
if (-not $Electron) { $Electron = Join-Path $env:USERPROFILE 'Documents\Omni\apps\omni-desktop\node_modules\electron\dist\electron.exe' }
if (-not (Test-Path -LiteralPath $Electron)) { throw ('Electron nao encontrado: ' + $Electron) }
$raiz = (Get-Location).Path
$r2 = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$sp = $PSScriptRoot
$v = Join-Path $r2 'ensaio-t7v'; $casa = Join-Path $r2 'casa-t7v'; $ud = Join-Path $r2 'ud-t7v'; $saida = Join-Path $r2 'prova-t7'
foreach ($d in $v, $casa, $ud, $saida) { if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force } }
New-Item -ItemType Directory -Force (Join-Path $v 'apps'), $casa, $ud, $saida | Out-Null
Copy-Item -Recurse (Join-Path $raiz 'apps\omni-ilha') (Join-Path $v 'apps\omni-ilha')
Copy-Item -Recurse (Join-Path $raiz 'runtime') (Join-Path $v 'runtime')

function Rodar($exe, $argumentos, $pasta, $nome) {
  $o = Join-Path $r2 ($nome + '.txt')
  $p = Start-Process $exe -ArgumentList $argumentos -WorkingDirectory $pasta -NoNewWindow -PassThru -RedirectStandardOutput $o -RedirectStandardError ($o + '.err')
  $null = $p.Handle # sem abrir o handle aqui, o PowerShell 5.1 devolve ExitCode vazio
  if (-not $p.WaitForExit(150000)) { Stop-Process -Id $p.Id -Force; throw ($nome + ': tempo esgotado') }
  $p.WaitForExit()
  ($nome + ' saida=' + $p.ExitCode)
  Get-Content $o -Encoding UTF8
  Get-Content ($o + '.err') -Encoding UTF8 | Where-Object { $_ -notmatch 'ExperimentalWarning|trace-warnings' } | Select-Object -Last 12
}

Rodar 'node' @((Join-Path $sp 'costura-t7.mjs'), '--conferir') $v 'costura-t7'
Rodar 'node' @((Join-Path $sp 'semente-t6.mjs'), $v, $casa) $r2 'semente-t7'

Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$env:OMNI_HOME = $casa; $env:OMNI_CASA_BANCO = (Join-Path $casa 'casa'); $env:OMNI_NODE = (Get-Command node).Source
$env:OMNI_ILHA_ESCONDIDA = '1'; $env:OMNI_ILHA_TESTE = (Join-Path $sp 'bancada-t7.js'); $env:OMNI_BANCADA_SAIDA = $saida
Rodar $Electron @((Join-Path $v 'apps\omni-ilha'), '--aberta', ('--user-data-dir=' + $ud)) $r2 'eletron-t7'

$res = Get-Content (Join-Path $saida 'resultado.json') -Encoding UTF8 -Raw | ConvertFrom-Json
foreach ($c in $res) { (($(if ($c.ok) { 'ok    ' } else { 'FALHOU' })) + ' ' + $c.nome + $(if (-not $c.ok) { ' :: ' + $c.detalhe } else { '' })) }
('conferencias: ' + @($res).Count + ', falharam: ' + @($res | Where-Object { -not $_.ok }).Count)
('guarda: ' + (Test-Path "$env:LOCALAPPDATA\omni\casa"))
```

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so semente-t6.mjs costura-t7.mjs bancada-t7.js prova-t7.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File "$rascunho\prova-t7.ps1"; "saida: $LASTEXITCODE"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado:
- `igual semente-t6.mjs`, `igual costura-t7.mjs` e `gravado` nos outros dois;
- `costura-t7 saida=0`, com `costurado` nos dois;
- `semente-t7 saida=0` e `{"vivas":9,"lixeira":2,"alertas":["sem-uso:banco-teste/leitura","vence:correio/smtp","teste-falhou:fila/token-ingestao","agente-nunca-usou:relatorios/conta-servico"]}`;
- `eletron-t7 saida=0`;
- catorze `ok`, nenhum `FALHOU`, `conferencias: 14, falharam: 0` e `guarda: False`;
- `saida: 0` e `False`.

Depois, as quatro fotos (`$rascunho\prova-t7\1-card-alertas.png`, `2-ilha.png`, `3-card-limpo.png` e `4-card-erro.png`) passam pelo anti-slop-review, com o registro de APP. O contraste é calculado sobre o fundo do card (`#141518`) e sobre o ponto mais claro da lava: o âmbar do alerta dá 8,95:1 e 6,90:1; o vermelho do erro, 5,35:1 e 4,13:1, o mínimo só onde a lava encosta no detalhe; o `--dim-2` da regra, 5,92:1 e 4,56:1; o cadeado, 10,36:1 e 7,99:1.

Resultado (07/11): `igual semente-t6.mjs`, `igual costura-t7.mjs`, `gravado` na bancada e na prova; `costura-t7 saida=0` com `costurado` nos dois; `semente-t7 saida=0` e o JSON esperado; `eletron-t7 saida=0`; catorze `ok`, `conferencias: 14, falharam: 0`, `guarda: False`, `saida: 0` e `False`. O anti-slop nas quatro fotos deu poucos ajustes e nenhum na T7: o card repete a gramática dos cards do Actions e do WhatsApp (o ícone no quadrado, o número com o rótulo em caixa alta, o detalhe à direita), sem faixa lateral nem brilho, e o traço e as reticências do erro aparecem como deviam. A única coisa fora do lugar, a linha "ligada há…" encostando no brilho do avatar do Omni, já existia antes da T7. As fotos mostram dados reais da ilha e ficam só no rascunho.

- [x] **Passo 10: a guarda e o conferir.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
git status --short
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --conferir; "saida: $LASTEXITCODE"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado:
- no status, além dos ` M dist/…` de fim de linha (item 15), as vinte e quatro linhas da T6 e mais quatro: ` M apps/omni-ilha/index.html`, ` M apps/omni-ilha/renderer.js`, `?? apps/omni-ilha/cofre-card.js` e `?? testes/ilha-cofre-card.test.mjs`;
- quarenta `igual` (os trinta e quatro da T6, mais a CC, o `cofre-card.js`, a lista da T7, a costura, a bancada e a prova), nenhum `AUSENTE` e `saida: 0`;
- `False`.

Resultado (07/11): fora dos ` M dist/…`, vinte e oito linhas: as vinte e quatro da T6 e as quatro da T7; quarenta `igual`, nenhum `AUSENTE`, `saida: 0` e `False`.

### Task 8: prova real em casa temporária

**Files:**
- Create (rascunho, fora do repositório): `$rascunho\filho-p5.mjs`, `$rascunho\prova-p5.mjs`, `$rascunho\prova-dono-p5.mjs`, `$rascunho\prova-pg-p5.mjs`
- Nenhum arquivo do repositório muda nesta tarefa.

A prova tem três partes:
- **Parte A, sem o Weriton.** Ela usa a CLI de verdade com a DPAPI de verdade, numa casa temporária dentro do `$rascunho`, e valores fictícios sorteados na hora. Não chama o `RequestVerificationAsync` e não toca a área de transferência: o `revelar` vai sem o descritor 3 e para antes do Hello. A disponibilidade do Hello é consultada só pelo `CheckAvailabilityAsync`, que não abre diálogo, e sai numa linha `info` que não reprova a prova (ver a parte B). Roda nos Nodes 24 e 22, com as treze suítes que este plano criou ou tocou.
- **Parte B, com o Weriton à frente do PC.** Ela faz os três toques do item 6 do executor: ver, ver cancelado e copiar, com a conferência no Win+V e a limpeza aos 30 s. A janela do cofre chama o mesmo caminho (janela → canal → mão → CLI → ponte), provado pela IC, e por isso os toques vão direto pela CLI, sem uma segunda ilha. Se o diálogo do Hello nascer atrás das janelas, isso fica anotado no resultado. O interop com o hwnd entra num plano próprio, não neste.
- **Parte C, só com o ok do Weriton na hora.** O Postgres ao vivo, com uma credencial real, pelo túnel dele, em loopback.

As partes B e C dependem de coisas que só o Weriton tem. A parte B só roda com o Hello disponível; nesta máquina ele está `DeviceNotPresent` desde a T2 (passo 0), e a decisão volta a ele (ver o Passo 5). As duas partes não seguram a T9 nem a T10: o que faltar fica registrado aqui, com a data.

```js rascunho=filho-p5.mjs
// Filho das provas do plano 5: compara o valor recebido em OMNI_PROVA_VALOR com o base64 esperado que chega pelo stdin. Imprime só "igual" ou "diferente".
import { readFileSync } from 'node:fs'
const esperado = readFileSync(0, 'utf8').trim()
const recebido = Buffer.from(process.env.OMNI_PROVA_VALOR ?? '', 'utf8').toString('base64')
console.log(recebido === esperado && esperado !== '' ? 'igual' : 'diferente')
```

```js rascunho=prova-p5.mjs
// Prova do plano 5 com a CLI e a DPAPI de verdade, numa casa temporária dentro do rascunho. Valores
// fictícios, sorteados aqui; nenhuma credencial real. Não chama o RequestVerificationAsync nem toca a área
// de transferência: o revelar vai sem o descritor 3 e para antes do Hello. Imprime só contagens, booleanos
// e textos fixos da CLI, em ASCII; nunca valor, base64 de valor ou hash.
// Uso: node prova-p5.mjs <raiz-do-repo> <rascunho>
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [raizArg, rascunhoArg] = process.argv.slice(2)
if (!raizArg || !rascunhoArg) { console.error('uso: node prova-p5.mjs <raiz-do-repo> <rascunho>'); process.exit(2) }
const raiz = resolve(raizArg)
const rascunho = resolve(rascunhoArg)
const { criarPontePresenca } = await import(pathToFileURL(join(raiz, 'runtime', 'casa', 'presenca.mjs')).href)

const pasta = join(rascunho, `prova-p5-${Date.now()}`)
const casa = join(pasta, 'casa')
const cli = join(raiz, 'runtime', 'cofre.mjs')
const filho = join(rascunho, 'filho-p5.mjs')
const env = { ...process.env, OMNI_HOME: casa, OMNI_CASA_BANCO: join(casa, 'casa') }
const saidas = []
function cofre(args, input = '') {
  const r = spawnSync(process.execPath, [cli, ...args], { input, env, encoding: 'utf8', windowsHide: true, timeout: 120_000 })
  saidas.push(r.stdout ?? '', r.stderr ?? '')
  const ultima = ((r.stdout ?? '').trim().split('\n').at(-1) ?? '').trim()
  let json = null
  try { json = JSON.parse(ultima) } catch {}
  return { status: r.status, json, ultima }
}
const executar = (nome, esperado) => cofre(['executar', '--nome', nome, '--variavel', 'OMNI_PROVA_VALOR', '--motivo', 'prova do plano 5', '--', process.execPath, filho], Buffer.from(esperado, 'utf8').toString('base64'))

let conferidas = 0; let falharam = 0
function conferir(rotulo, condicao, detalhe = '') {
  conferidas += 1
  if (!condicao) falharam += 1
  console.log(`${condicao ? 'ok' : 'FALHOU'}  ${rotulo}${detalhe ? ` (${detalhe})` : ''}`)
}
function portaLivre() {
  return new Promise((resolver, rejeitar) => {
    const servidor = createServer()
    servidor.once('error', rejeitar)
    servidor.listen(0, '127.0.0.1', () => { const { port } = servidor.address(); servidor.close(() => resolver(port)) })
  })
}
function arquivosDe(dir) {
  return readdirSync(dir).flatMap((nome) => { const c = join(dir, nome); return statSync(c).isDirectory() ? arquivosDe(c) : [c] })
}

const valorA = randomBytes(24).toString('base64url')
const valorB = randomBytes(24).toString('base64url')
const valorP = randomBytes(24).toString('base64url')
try {
  mkdirSync(casa, { recursive: true })
  const porta = await portaLivre()
  conferir('1. porta livre em loopback, fora da 5432', porta !== 5432)

  const c1 = cofre(['cadastrar', '--nome', 'teste-hello', '--tipo', 'senha', '--servico', 'teste', '--agentes', 'omni'], `${valorA}\n`)
  const c2 = cofre(['cadastrar', '--nome', 'teste-hello-copia', '--tipo', 'senha', '--servico', 'teste', '--agentes', 'omni'], `${valorA}\n`)
  const c3 = cofre(['cadastrar', '--nome', 'teste-pg', '--tipo', 'conexao', '--servico', 'postgres', '--url', `postgres://127.0.0.1:${porta}/x`, '--usuario', 'teste'], `${valorP}\n`)
  conferir('2. cadastrar as tres', [c1, c2, c3].every((c) => c.status === 0 && c.json?.ok === true), `status ${c1.status}/${c2.status}/${c3.status}`)

  const l1 = cofre(['listar'])
  conferir('3. listar: 3, todas na guarda dpapi', l1.status === 0 && l1.json?.length === 3 && l1.json.every((c) => c.guarda === 'dpapi'), `${l1.json?.length}`)

  const e1 = executar('teste-hello', valorA)
  conferir('4. executar entrega o valor ao filho', e1.status === 0 && e1.ultima === 'igual', e1.ultima)

  const t1 = cofre(['testar', '--nome', 'teste-hello'])
  conferir('5. testar senha/teste: sem testador, ok null', t1.status === 0 && t1.json?.teste?.ok === null && t1.json?.teste?.detalhe === 'sem testador para senha/teste', t1.json?.teste?.detalhe)
  const t2 = cofre(['testar', '--nome', 'teste-pg'])
  conferir('6. testar postgres na porta fechada: ECONNREFUSED, ok null', t2.status === 0 && t2.json?.teste?.ok === null && /ECONNREFUSED/.test(t2.json?.teste?.detalhe ?? ''), t2.json?.teste?.detalhe)

  const s1 = cofre(['saude', '--duplicatas'])
  const par = s1.json?.duplicatas?.pares ?? []
  conferir('7. saude com duplicatas: 1 par, o das duas teste-hello, nenhum alerta', s1.status === 0 && s1.json?.total === 3 && s1.json?.alertas?.length === 0 && par.length === 1 && par[0].join(',') === 'teste-hello,teste-hello-copia' && s1.json?.duplicatas?.naoAbriram?.length === 0, `pares ${par.length}, alertas ${s1.json?.alertas?.length}`)

  const validade = new Date(Date.now() + 5 * 86_400_000).toISOString()
  const d1 = cofre(['editar', '--nome', 'teste-hello', '--mudancas', JSON.stringify({ validade })])
  const s2 = cofre(['saude'])
  const alertas2 = (s2.json?.alertas ?? []).map((a) => `${a.regra}:${a.nome}`)
  conferir('8. editar a validade para 5 dias: versao 2 e o alerta vence', d1.status === 0 && d1.json?.credencial?.versao === 2 && alertas2.join(',') === 'vence:teste-hello' && s2.json?.duplicatas === null, `versao ${d1.json?.credencial?.versao}, ${alertas2.join(',')}`)

  const r1 = cofre(['rotacionar', '--nome', 'teste-hello'], `${valorB}\n`)
  conferir('9. rotacionar: versao 3', r1.status === 0 && r1.json?.credencial?.versao === 3, `${r1.json?.credencial?.versao}`)
  const e2 = executar('teste-hello', valorB)
  const e3 = executar('teste-hello', valorA)
  conferir('10. depois da rotacao o filho recebe o valor novo, nao o antigo', e2.ultima === 'igual' && e3.ultima === 'diferente', `${e2.ultima}/${e3.ultima}`)
  const s3 = cofre(['saude', '--duplicatas'])
  conferir('11. saude com duplicatas: 0 pares', s3.status === 0 && s3.json?.duplicatas?.pares?.length === 0, `${s3.json?.duplicatas?.pares?.length}`)

  const a1 = cofre(['apagar', '--nome', 'teste-hello-copia'])
  const x1 = cofre(['lixeira'])
  const l2 = cofre(['listar'])
  conferir('12. apagar a copia: lixeira 1, listar 2', a1.status === 0 && x1.json?.length === 1 && l2.json?.length === 2, `${x1.json?.length}/${l2.json?.length}`)
  const v1 = cofre(['restaurar', '--id', a1.json?.id ?? '-'])
  const x2 = cofre(['lixeira'])
  const l3 = cofre(['listar'])
  conferir('13. restaurar pelo id: lixeira 0, listar 3', v1.status === 0 && v1.json?.credencial?.nome === 'teste-hello-copia' && x2.json?.length === 0 && l3.json?.length === 3, `${x2.json?.length}/${l3.json?.length}`)

  const rv = cofre(['revelar', '--nome', 'teste-hello'])
  conferir('14. revelar sem o descritor 3: recusa sem-canal, antes do Hello', rv.status === 3 && rv.json?.codigo === 'sem-canal', `status ${rv.status}, ${rv.json?.codigo}`)

  const h1 = cofre(['historico', '--nome', 'teste-hello'])
  const conta = {}
  for (const uso of h1.json?.usos ?? []) conta[uso.resultado] = (conta[uso.resultado] ?? 0) + 1
  const contagem = Object.keys(conta).sort().map((k) => `${k} ${conta[k]}`).join(', ')
  conferir('15. historico da teste-hello', h1.status === 0 && contagem === 'conferido-saude 2, entregue 3, rotacionado 1', contagem)

  const valores = [valorA, valorB, valorP].flatMap((v) => [v, Buffer.from(v, 'utf8').toString('base64')])
  const nasSaidas = valores.filter((v) => saidas.some((s) => s.includes(v))).length
  conferir('16. nenhum valor nas saidas da CLI, nem em base64', nasSaidas === 0, `${nasSaidas}`)
  const arquivos = arquivosDe(casa)
  const naCasa = valores.filter((v) => arquivos.some((a) => readFileSync(a).includes(Buffer.from(v, 'utf8')))).length
  conferir('17. nenhum valor em claro nos arquivos da casa', arquivos.length > 0 && naCasa === 0, `${arquivos.length} arquivo(s), ${naCasa}`)

  // Informativo: sem PIN nem biometria na conta o Hello responde indisponivel, e isso trava só a prova do dono.
  const disp = criarPontePresenca().disponivel()
  console.log(`info  Hello sem dialogo: ${disp.ok ? 'disponivel' : 'indisponivel'} (${disp.motivo}); a prova do dono exige disponivel`)
} finally {
  rmSync(pasta, { recursive: true, force: true })
  console.log(`limpeza: pasta da prova removida: ${!existsSync(pasta)}`)
}
console.log(`conferencias: ${conferidas}, falharam: ${falharam}`)
process.exitCode = falharam === 0 ? 0 : 1
```

```js rascunho=prova-dono-p5.mjs
// Prova do dono do plano 5: o Windows Hello e a área de transferência de verdade, só com o Weriton na frente
// do PC. Casa temporária e valor fictício, sorteado aqui. A cada pedido de Hello a prova diz antes se é para
// confirmar ou cancelar. O valor revelado chega pelo descritor 3 e o copiado é lido da área por um PowerShell
// filho; os dois são comparados aqui e nunca impressos. A área do Weriton é sobrescrita pelo copiar e limpa
// pela ponte aos 30 s. Imprime só ASCII.
// Uso: node prova-dono-p5.mjs <raiz-do-repo> <rascunho>
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout as esperar } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

const [raizArg, rascunhoArg] = process.argv.slice(2)
if (!raizArg || !rascunhoArg) { console.error('uso: node prova-dono-p5.mjs <raiz-do-repo> <rascunho>'); process.exit(2) }
const raiz = resolve(raizArg)
const rascunho = resolve(rascunhoArg)
const modulo = (relativo) => import(pathToFileURL(join(raiz, relativo)).href)
const { criarPontePresenca } = await modulo('runtime/casa/presenca.mjs')
const { powershellPadrao } = await modulo('runtime/casa/dpapi.mjs')

const pasta = join(rascunho, `prova-dono-p5-${Date.now()}`)
const casa = join(pasta, 'casa')
const cli = join(raiz, 'runtime', 'cofre.mjs')
const env = { ...process.env, OMNI_HOME: casa, OMNI_CASA_BANCO: join(casa, 'casa') }
const saidas = []
function cofre(args, input = '', stdio = ['pipe', 'pipe', 'pipe']) {
  const r = spawnSync(process.execPath, [cli, ...args], { input, env, stdio, windowsHide: true, timeout: 150_000 })
  const stdout = r.stdout?.toString('utf8') ?? ''
  saidas.push(stdout, r.stderr?.toString('utf8') ?? '')
  let json = null
  try { json = JSON.parse(stdout.trim().split('\n').at(-1) ?? '') } catch {}
  return { status: r.status, json, canal: r.output?.[3] ?? null }
}
// Lê a área como texto e devolve em base64 pelo stdout do filho; vazio vira linha vazia.
const LER_AREA = "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.Windows.Forms; $t = [System.Windows.Forms.Clipboard]::GetText(); [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($t)))"
function lerArea() {
  const r = spawnSync(powershellPadrao(), ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(LER_AREA, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, timeout: 30_000 })
  return r.status === 0 ? Buffer.from((r.stdout ?? '').trim(), 'base64') : null
}

let conferidas = 0; let falharam = 0
function conferir(rotulo, condicao, detalhe = '') {
  conferidas += 1
  if (!condicao) falharam += 1
  console.log(`${condicao ? 'ok' : 'FALHOU'}  ${rotulo}${detalhe ? ` (${detalhe})` : ''}`)
}
const avisar = (texto) => console.log(`>>> ${texto}`)

const valor = Buffer.from(randomBytes(24).toString('base64url'), 'utf8')
const presenca = criarPontePresenca()
const disp = presenca.disponivel()
conferir('1. Hello disponivel', disp.ok === true, disp.motivo)
if (falharam === 0) try {
  avisar('Weriton: CONFIRME o Hello que vai abrir ("Omni: prova do plano 5, confirme")')
  const v1 = presenca.verificar('Omni: prova do plano 5, confirme')
  conferir('2. sonda: Hello confirmado', v1.ok === true && v1.motivo === 'ok', v1.motivo)
  avisar('Weriton: CANCELE o Hello que vai abrir ("Omni: prova do plano 5, cancele")')
  const v2 = presenca.verificar('Omni: prova do plano 5, cancele')
  conferir('3. sonda: Hello cancelado', v2.ok === false && v2.motivo === 'cancelado', v2.motivo)

  mkdirSync(casa, { recursive: true })
  const c1 = cofre(['cadastrar', '--nome', 'teste-hello', '--tipo', 'senha', '--servico', 'teste'], Buffer.concat([valor, Buffer.from('\n')]))
  conferir('4. cadastrar teste-hello', c1.status === 0 && c1.json?.ok === true, `status ${c1.status}`)

  avisar('Weriton: CONFIRME o Hello ("Omni: mostrar a credencial teste-hello")')
  const r1 = cofre(['revelar', '--nome', 'teste-hello'], '', ['pipe', 'pipe', 'pipe', 'pipe'])
  conferir('5. revelar confirmado: o valor chega pelo descritor 3, e so por ele', r1.status === 0 && r1.json?.ok === true && r1.canal !== null && r1.canal.equals(valor), `status ${r1.status}`)
  r1.canal?.fill(0)

  avisar('Weriton: CANCELE o Hello ("Omni: mostrar a credencial teste-hello")')
  const r2 = cofre(['revelar', '--nome', 'teste-hello'], '', ['pipe', 'pipe', 'pipe', 'pipe'])
  conferir('6. revelar cancelado: sem-presenca e nada no descritor 3', r2.status === 3 && r2.json?.codigo === 'sem-presenca' && (r2.canal?.length ?? 0) === 0, `status ${r2.status}, ${r2.json?.codigo}`)

  avisar('Weriton: CONFIRME o Hello ("Omni: copiar a credencial teste-hello"); a sua area de transferencia vai ser trocada e limpa em 30 s')
  const p1 = cofre(['copiar', '--nome', 'teste-hello'])
  const limpaEm = Date.parse(p1.json?.limpaEm ?? '')
  const faltam = limpaEm - Date.now()
  conferir('7. copiar confirmado: limpeza marcada para daqui a ate 30 s', p1.status === 0 && p1.json?.ok === true && faltam > 0 && faltam <= 30_000, `status ${p1.status}, faltam ${Math.round(faltam / 1000)} s`)
  const area1 = lerArea()
  conferir('8. a area tem o valor', area1 !== null && area1.equals(valor))
  area1?.fill(0)
  avisar('Weriton: abra o Win+V agora e confira que o valor NAO aparece no historico da area; a prova espera a limpeza')
  await esperar(Math.max(0, limpaEm - Date.now()) + 3_000)
  const area2 = lerArea()
  conferir('9. aos 30 s a area ficou vazia', area2 !== null && area2.length === 0, `${area2?.length ?? 'sem leitura'} byte(s)`)

  const h1 = cofre(['historico', '--nome', 'teste-hello'])
  const conta = {}
  for (const uso of h1.json?.usos ?? []) conta[uso.resultado] = (conta[uso.resultado] ?? 0) + 1
  const contagem = Object.keys(conta).sort().map((k) => `${k} ${conta[k]}`).join(', ')
  conferir('10. historico: um revelado, um recusado, um copiado', h1.status === 0 && contagem === 'copiado-ao-dono 1, recusado-presenca 1, revelado-ao-dono 1', contagem)

  const texto = valor.toString('utf8')
  const nasSaidas = [texto, valor.toString('base64')].filter((v) => saidas.some((s) => s.includes(v))).length
  conferir('11. nenhum valor no stdout nem no stderr da CLI', nasSaidas === 0, `${nasSaidas}`)
} finally {
  valor.fill(0)
  rmSync(pasta, { recursive: true, force: true })
  console.log(`limpeza: pasta da prova removida: ${!existsSync(pasta)}`)
}
console.log(`conferencias: ${conferidas}, falharam: ${falharam}`)
process.exitCode = falharam === 0 ? 0 : 1
```

```js rascunho=prova-pg-p5.mjs
// Prova do Postgres ao vivo do plano 5, só com o ok do Weriton na hora e com o túnel dele de pé em loopback.
// Copia um único .dpapi real (o nome vem por argumento) para uma casa temporária, importa, põe a url local e o
// usuário pela edição e chama o testar. O original não é tocado. Nome, url e usuário chegam por argumento e
// não ficam escritos aqui. Imprime só o ok e o detalhe do testador, que nunca levam o valor.
// Uso: node prova-pg-p5.mjs <raiz-do-repo> <rascunho> <nome-do-dpapi> <url-em-loopback> <usuario>
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [raizArg, rascunhoArg, nome, url, usuario] = process.argv.slice(2)
if (!raizArg || !rascunhoArg || !nome || !url || !usuario) { console.error('uso: node prova-pg-p5.mjs <raiz-do-repo> <rascunho> <nome-do-dpapi> <url-em-loopback> <usuario>'); process.exit(2) }
const host = (() => { try { return new URL(url).hostname } catch { return '' } })()
if (host !== '127.0.0.1' && host !== 'localhost') { console.error('a url tem de apontar para o loopback (o túnel)'); process.exit(2) }
const raiz = resolve(raizArg)
const rascunho = resolve(rascunhoArg)

const pasta = join(rascunho, `prova-pg-p5-${Date.now()}`)
const casa = join(pasta, 'casa')
const cli = join(raiz, 'runtime', 'cofre.mjs')
const env = { ...process.env, OMNI_HOME: casa, OMNI_CASA_BANCO: join(casa, 'casa') }
function cofre(args) {
  const r = spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8', windowsHide: true, timeout: 120_000 })
  let json = null
  try { json = JSON.parse(((r.stdout ?? '').trim().split('\n').at(-1) ?? '')) } catch {}
  return { status: r.status, json }
}

let conferidas = 0; let falharam = 0
function conferir(rotulo, condicao, detalhe = '') {
  conferidas += 1
  if (!condicao) falharam += 1
  console.log(`${condicao ? 'ok' : 'FALHOU'}  ${rotulo}${detalhe ? ` (${detalhe})` : ''}`)
}

const origem = join(process.env.APPDATA, 'omni', 'access', `${nome}.dpapi`)
conferir('1. o .dpapi existe', existsSync(origem))
if (falharam === 0) try {
  mkdirSync(join(casa, 'access'), { recursive: true })
  copyFileSync(origem, join(casa, 'access', `${nome}.dpapi`))
  const classificacao = join(pasta, 'classificacao.json')
  writeFileSync(classificacao, JSON.stringify({ [nome]: { tipo: 'conexao', servico: 'postgres' } }))
  const imp = cofre(['importar-dpapi', '--pasta', join(casa, 'access'), '--classificacao', classificacao])
  conferir('2. importar so a copia', imp.status === 0 && imp.json?.importadas === 1, `status ${imp.status}, importadas ${imp.json?.importadas}`)
  const ed = cofre(['editar', '--nome', nome, '--mudancas', JSON.stringify({ url, usuario })])
  conferir('3. url em loopback e usuario pela edicao', ed.status === 0 && ed.json?.credencial?.url === url, `status ${ed.status}`)
  const t = cofre(['testar', '--nome', nome])
  conferir('4. testar ao vivo pelo tunel: SELECT 1', t.status === 0 && t.json?.teste?.ok === true, `ok ${t.json?.teste?.ok}, ${t.json?.teste?.detalhe}`)
  const l = cofre(['listar'])
  const c = (l.json ?? []).find((x) => x.nome === nome)
  conferir('5. o resultado ficou gravado com a data', c?.ultimo_teste_ok === true && typeof c?.ultimo_teste_em === 'string')
} finally {
  rmSync(pasta, { recursive: true, force: true })
  console.log(`limpeza: pasta da prova removida: ${!existsSync(pasta)}`)
}
console.log(`conferencias: ${conferidas}, falharam: ${falharam}`)
process.exitCode = falharam === 0 ? 0 : 1
```

- [x] **Passo 1: a guarda antes.**

```powershell
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `False`.

Resultado (07/11): `False`.

- [x] **Passo 2: a parte A no Node 24, com as suítes.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
$suites = 'casa-loja-cofre-gestao', 'casa-presenca', 'casa-dpapi', 'casa-postgres-fio', 'casa-testadores-cofre', 'cofre-cli-gestao', 'ilha-cofre-mao', 'ilha-cofre-ipc', 'ilha-cofre-card', 'casa-loja-cofre', 'cofre-cli', 'casa-pacote-cofre', 'casa-banco' | ForEach-Object { 'testes/' + $_ + '.test.mjs' }
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so filho-p5.mjs prova-p5.mjs prova-dono-p5.mjs prova-pg-p5.mjs; "saida: $LASTEXITCODE"
node --version
node "$rascunho\prova-p5.mjs" . $rascunho; "saida: $LASTEXITCODE"
node --test --test-concurrency=1 --test-reporter=spec @suites *> "$rascunho\t8-node24.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t8-node24.txt" -Pattern '(tests|pass|fail|skipped) \d+\s*$'
```

Esperado:
- `gravado` nos quatro e `saida: 0`;
- `v24.…`;
- dezessete `ok`, nenhum `FALHOU`, e os detalhes: `(status 0/0/0)`, `(3)`, `(igual)`, `(sem testador para senha/teste)`, `ECONNREFUSED` no 6, `(pares 1, alertas 0)`, `(versao 2, vence:teste-hello)`, `(3)`, `(igual/diferente)`, `(0)`, `(1/2)`, `(0/3)`, `(status 3, sem-canal)`, `(conferido-saude 2, entregue 3, rotacionado 1)`, `(0)` e `(N arquivo(s), 0)`, com N maior que 0;
- a linha `info  Hello sem dialogo: …` (`disponivel` ou `indisponivel`; ela decide só a parte B);
- `limpeza: pasta da prova removida: true`, `conferencias: 17, falharam: 0` e `saida: 0`;
- as suítes com `tests 141`, `pass 141`, `fail 0`, `skipped 0` e `saida: 0`.

Resultado (07/11): `gravado` nos quatro e `saida: 0`; `v24.17.0`; dezessete `ok` com os detalhes esperados (o 17 com `1 arquivo(s), 0`); `info  Hello sem dialogo: indisponivel (indisponivel)`; `limpeza: pasta da prova removida: true`, `conferencias: 17, falharam: 0` e `saida: 0`; as suítes com `tests 141`, `pass 141`, `fail 0`, `skipped 0` e `saida: 0`; 39 s ao todo.

No ensaio, a disponibilidade do Hello ainda era uma conferência e reprovava a prova (`conferencias: 18, falharam: 1`). Ela virou a linha `info`, porque é condição da parte B, não defeito da parte A. A sonda crua do `CheckAvailabilityAsync`, só de leitura, confirmou o motivo da T2: `DeviceNotPresent`, sem PIN nem leitor biométrico nesta conta.

- [x] **Passo 3: a parte A no Node 22, com as suítes, e a limpeza.** O zip oficial é conferido pelo sha256 (item 13 do executor), e o `finally` apaga o Node 22 mesmo se algo falhar no meio.

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$suites = 'casa-loja-cofre-gestao', 'casa-presenca', 'casa-dpapi', 'casa-postgres-fio', 'casa-testadores-cofre', 'cofre-cli-gestao', 'ilha-cofre-mao', 'ilha-cofre-ipc', 'ilha-cofre-card', 'casa-loja-cofre', 'cofre-cli', 'casa-pacote-cofre', 'casa-banco' | ForEach-Object { 'testes/' + $_ + '.test.mjs' }
$zip = Join-Path $rascunho 'node22.zip'
$pasta22 = Join-Path $rascunho 'node22'
try {
  Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.23.4/node-v22.23.4-win-x64.zip' -OutFile $zip -UseBasicParsing
  $confere = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -eq 'cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20'
  'sha256 confere: ' + $confere
  if ($confere) {
    Expand-Archive -Path $zip -DestinationPath $pasta22 -Force
    $node22 = Join-Path $pasta22 'node-v22.23.4-win-x64\node.exe'
    & $node22 --version
    & $node22 "$rascunho\prova-p5.mjs" . $rascunho; "saida: $LASTEXITCODE"
    & $node22 --test --test-concurrency=1 --test-reporter=spec @suites *> "$rascunho\t8-node22.txt"; "saida: $LASTEXITCODE"
    Select-String -Path "$rascunho\t8-node22.txt" -Pattern '(tests|pass|fail|skipped) \d+\s*$'
  }
} finally {
  Remove-Item -LiteralPath $pasta22, $zip -Recurse -Force -ErrorAction SilentlyContinue
  'node22 removido: ' + (-not (Test-Path -LiteralPath $pasta22)) + ', zip removido: ' + (-not (Test-Path -LiteralPath $zip))
}
```

Esperado: `sha256 confere: True`; `v22.23.4`; a prova com as mesmas linhas do Passo 2 e `saida: 0`; as suítes com `tests 141`, `pass 141`, `fail 0`, `skipped 0` e `saida: 0`; `node22 removido: True, zip removido: True`. Sem rede, só o 24, e isso fica declarado no resultado.

Resultado (07/11): `sha256 confere: True`; `v22.23.4`; a prova com as mesmas dezessete linhas do Passo 2, a mesma linha `info`, `conferencias: 17, falharam: 0` e `saida: 0`; as suítes com `tests 141`, `pass 141`, `fail 0`, `skipped 0` e `saida: 0`; `node22 removido: True, zip removido: True`; 189 s com o download.

- [x] **Passo 4: sobras e a guarda depois.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
Get-ChildItem $rascunho -Directory -Filter 'prova-*p5-*' | Measure-Object | Select-Object -ExpandProperty Count
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `0` e `False`.

Resultado (07/11): `0` e `False`.

- [ ] **Passo 5: a parte B, com o Weriton à frente do PC.** Só roda com a linha `info` do Passo 2 dizendo `disponivel`. Com `indisponivel`, o passo fica aberto, com a data, e a decisão volta ao Weriton. O caminho natural é ele criar o PIN do Windows Hello nesta conta, se quem administra a máquina permitir; outro fator de presença abre uma tarefa nova. A prova avisa com `>>>` antes de cada diálogo, dizendo se é para confirmar ou cancelar. A área de transferência dele é trocada pelo `copiar` e limpa pela ponte aos 30 s; durante a espera, ele abre o Win+V e confere que o valor não está no histórico.

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
node "$rascunho\prova-dono-p5.mjs" . $rascunho; "saida: $LASTEXITCODE"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado:
- onze `ok`, nenhum `FALHOU`: o Hello disponível; a sonda confirmada (`ok`) e a cancelada (`cancelado`); o cadastro; o `revelar` confirmado com o valor só no descritor 3; o `revelar` cancelado com `status 3, sem-presenca` e o descritor 3 vazio; o `copiar` com a limpeza marcada para daqui a até 30 s; a área com o valor; a área vazia depois da limpeza (`0 byte(s)`); o histórico `copiado-ao-dono 1, recusado-presenca 1, revelado-ao-dono 1`; e nenhum valor nas saídas (`0`);
- o Weriton não viu o valor no Win+V;
- `limpeza: pasta da prova removida: true`, `conferencias: 11, falharam: 0`, `saida: 0` e `False`.

Com o Hello indisponível, a saída é `FALHOU  1. Hello disponivel (indisponivel)`, `conferencias: 1, falharam: 1` e `saida: 1`, sem diálogo nenhum.

Resultado (07/11): bloqueado. `FALHOU  1. Hello disponivel (indisponivel)`, `conferencias: 1, falharam: 1`, `saida: 1` e `False`, sem diálogo. O passo fica aberto até o Weriton decidir o fator de presença.

- [ ] **Passo 6: a parte C, só com o ok do Weriton na hora.** Ela usa a credencial real do Postgres do DW e o túnel dele em loopback. O nome do `.dpapi`, a porta local, o usuário e o banco vêm das notas dele e não entram neste plano; nas linhas abaixo, o executor preenche `$pgNome`, `$pgPorta`, `$pgUsuario` e `$pgBanco` na hora. O túnel só sobe se a porta não estiver aberta, e só o `ssh` que este passo subiu é derrubado, pelo PID. Nunca o Postgres local nem a porta 5432 desta máquina. A prova copia só aquele `.dpapi` para a casa temporária, e o original não é tocado.

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$pgNome = ''      # das notas do Weriton
$pgPorta = 0      # a porta local do túnel do DW, das notas dele
$pgUsuario = ''   # das notas dele
$pgBanco = ''     # das notas dele
$aberta = (Test-NetConnection 127.0.0.1 -Port $pgPorta -WarningAction SilentlyContinue).TcpTestSucceeded
'tunel ja de pe: ' + $aberta
node "$rascunho\prova-pg-p5.mjs" . $rascunho $pgNome ('postgres://127.0.0.1:' + $pgPorta + '/' + $pgBanco) $pgUsuario; "saida: $LASTEXITCODE"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Se a porta estiver fechada, o executor sobe o túnel com o comando das notas do Weriton (`Start-Process ssh … -PassThru`, guardando o PID), espera a porta abrir, roda as duas linhas da prova e derruba só aquele PID no fim.

Esperado: cinco `ok` (o `.dpapi` existe, `importadas 1`, a edição, `ok true, SELECT 1 respondido (…)` e o resultado gravado com a data); `limpeza: pasta da prova removida: true`, `conferencias: 5, falharam: 0`, `saida: 0` e `False`.

Resultado (07/11): não rodou; espera o ok do Weriton. Só os caminhos de parada foram ensaiados, sem credencial: sem o `.dpapi`, `FALHOU  1. o .dpapi existe` e `saida: 1`; com a url fora do loopback, a recusa antes de tudo e `saida: 2`.

- [x] **Passo 7: o conferir.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
git status --short
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --conferir; "saida: $LASTEXITCODE"
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: o mesmo status do Passo 10 da T7 (a T8 não muda o repositório); quarenta e quatro `igual` (os quarenta da T7 e os quatro rascunhos desta tarefa), nenhum `AUSENTE` e `saida: 0`; `False`.

Resultado (07/11): fora dos ` M dist/…`, as mesmas vinte e oito linhas da T7; quarenta e quatro `igual`, nenhuma outra linha, `saida: 0` e `False`.

### Task 9: afetadas, verify e `.test-dist`

Uma suíte pesada por vez: o verify só começa depois que as afetadas terminam. Nenhum arquivo do repositório muda nesta tarefa; o `dist` que o build reescreve volta no fim, e só se a diferença for de fim de linha.

O rascunho é o `afetadas-p4.mjs` do plano 4 com três mudanças. Os `tocados` são os seis módulos de `runtime/` que este plano cria ou muda e os dez arquivos da ilha (os quatro que a T6 e a T7 mudam e os seis que criam). O `especificador` segue também `require('./…')`, porque as suítes da ilha (MC, IC e CC) carregam o código da janela por `createRequire`. E a citação em texto vale também para `apps/omni-ilha/*`, como já valia para `runtime/*`.

```js rascunho=afetadas-p5.mjs
// Lista as suítes testes/*.test.mjs que carregam um arquivo tocado pelo plano 5, direta ou
// indiretamente. Segue imports e requires relativos (from, import de efeito, import(), require() e
// new URL com texto literal); na suíte, um caminho runtime/*.mjs ou apps/omni-ilha/* citado em
// texto também conta. dist/ fica de fora: o plano não o muda. Uso, da raiz do repositório:
// node afetadas-p5.mjs [--lista]
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const raiz = process.cwd()
const tocados = [
  ...['casa/dpapi', 'casa/loja-cofre', 'casa/testadores-cofre', 'casa/presenca', 'casa/postgres-fio', 'cofre']
    .map((m) => resolve(raiz, 'runtime', `${m}.mjs`)),
  ...['main.js', 'preload.js', 'renderer.js', 'index.html', 'cofre.js', 'cofre-ipc.js', 'cofre-card.js', 'cofre-janela.js', 'cofre-preload.js', 'cofre.html']
    .map((n) => resolve(raiz, 'apps', 'omni-ilha', n)),
]
const especificador = /\bfrom\s*(['"])(\.{1,2}\/[^'"]+)\1|\bimport\s*\(?\s*(['"])(\.{1,2}\/[^'"]+)\3|new URL\(\s*(['"])(\.{1,2}\/[^'"]+)\5\s*,\s*import\.meta\.url|\brequire\(\s*(['"])(\.{1,2}\/[^'"]+)\7\s*\)/g
const citado = /\b(?:runtime\/[\w./-]+\.m?js|apps\/omni-ilha\/[\w.-]+\.(?:m?js|html))\b/g
const naArvore = (arquivo) => /\.(mjs|js|html)$/.test(arquivo) && existsSync(arquivo) &&
  !relative(raiz, arquivo).split(sep).some((parte) => parte === 'dist' || parte === 'node_modules' || parte === '..')
function dependencias(arquivo, comCitacoes) {
  const texto = readFileSync(arquivo, 'utf8')
  const achados = new Set()
  for (const m of texto.matchAll(especificador)) {
    achados.add(resolve(dirname(arquivo), (m[2] ?? m[4] ?? m[6] ?? m[8]).replace(/[?#].*$/, '')))
  }
  if (comCitacoes) for (const [caminho] of texto.matchAll(citado)) achados.add(resolve(raiz, caminho))
  return [...achados].filter(naArvore)
}
// O grafo inteiro a partir das suítes; depois, de trás para frente a partir dos tocados.
const suites = readdirSync(join(raiz, 'testes')).filter((n) => n.endsWith('.test.mjs')).sort()
  .map((nome) => ({ nome, deps: dependencias(join(raiz, 'testes', nome), true) }))
const quemImporta = new Map()
const visto = new Set()
const fila = suites.flatMap((s) => s.deps)
while (fila.length > 0) {
  const arquivo = fila.pop()
  if (visto.has(arquivo)) continue
  visto.add(arquivo)
  for (const dep of dependencias(arquivo, false)) {
    if (!quemImporta.has(dep)) quemImporta.set(dep, new Set())
    quemImporta.get(dep).add(arquivo)
    fila.push(dep)
  }
}
const alcancam = new Set(tocados)
const volta = [...tocados]
while (volta.length > 0) {
  for (const importador of quemImporta.get(volta.pop()) ?? []) {
    if (!alcancam.has(importador)) {
      alcancam.add(importador)
      volta.push(importador)
    }
  }
}
const diretas = suites.filter((s) => s.deps.some((d) => tocados.includes(d))).map((s) => s.nome)
const indiretas = suites.filter((s) => !diretas.includes(s.nome) && s.deps.some((d) => alcancam.has(d))).map((s) => s.nome)
if (process.argv.includes('--lista')) {
  for (const nome of [...diretas, ...indiretas]) console.log(`testes/${nome}`)
} else {
  console.log(`diretas ${diretas.length}: ${diretas.map((n) => n.replace('.test.mjs', '')).join(', ')}`)
  console.log(`indiretas ${indiretas.length}: ${indiretas.map((n) => n.replace('.test.mjs', '')).join(', ')}`)
}
```

- [x] **Passo 1: extrair e listar.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --so afetadas-p5.mjs; "saida: $LASTEXITCODE"
node "$rascunho\afetadas-p5.mjs"
```

Esperado: `gravado` e `saida: 0`; `diretas 11` (`casa-dpapi`, `casa-loja-cofre-gestao`, `casa-loja-cofre`, `casa-postgres-fio`, `casa-presenca`, `casa-testadores-cofre`, `cofre-cli-gestao`, `cofre-cli`, `ilha-cofre-card`, `ilha-cofre-ipc` e `ilha-cofre-mao`) e `indiretas 0`.

Zero indiretas é o certo, não um furo do grafo: este plano não toca o `banco.mjs`, os `esquemas.mjs` nem o `pacote-cofre.mjs`, que são o caminho pelo qual as suítes do plano 4 chegavam à casa. Quem importa os tocados são outros tocados (`cofre.mjs` importa a loja, a presença, os testadores e a ponte; a presença importa a ponte; os testadores importam o fio). Nenhuma suíte cita o `main.js`, o `preload.js`, o `renderer.js` nem o `index.html` da ilha: o que eles mudam tem a prova visual da T6 e da T7, não suíte.

Resultado (07/11): `gravado afetadas-p5.mjs` e `saida: 0`; `diretas 11`, as onze esperadas, e `indiretas 0`. No ensaio, antes de escrever a tarefa, uma busca por `omni-ilha` em `testes/` e no `package.json` confirmou que só a MC, a IC e a CC citam a ilha.

- [x] **Passo 2: rodar as afetadas, em segundo plano.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$suites = @(node "$rascunho\afetadas-p5.mjs" --lista)
'suites: ' + $suites.Count
node --test --test-concurrency=1 --test-reporter=spec @suites *> "$rascunho\t9-afetadas.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t9-afetadas.txt" -Pattern '(tests|pass|fail|cancelled|skipped|duration_ms) [\d.]+\s*$', '\.test\.mjs:\d+:\d+'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `suites: 11`; `tests 109`, `pass 109`, `fail 0`, `cancelled 0`, `skipped 0` e `saida: 0`; nenhuma linha `.test.mjs:N:N`; `False`. Os 109 são os 141 da T8 menos o `casa-banco` (23) e o `casa-pacote-cofre` (9), que este plano não alcança. A `integridade-release` não está na lista, então o vermelho de nascença `:165` não aparece aqui.

Resultado (07/11): `suites: 11`; `tests 109`, `pass 109`, `fail 0`, `cancelled 0`, `skipped 0` e `saida: 0`, em 17 s; nenhuma linha `.test.mjs:N:N`; `False`.

- [x] **Passo 3: verify, em segundo plano.**

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
npm run verify *> "$rascunho\verify-p5.txt"; "saida: $LASTEXITCODE" | Out-File -Append -Encoding utf8 "$rascunho\verify-p5.txt"
Select-String -Path "$rascunho\verify-p5.txt" -Pattern '(tests|pass|fail|cancelled|skipped|duration_ms) [\d.]+\s*$', '\.test\.mjs:\d+:\d+', '^saida: ', '^\s+(actual|expected): ', '^\{"ok"'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado:
- `tests 819`, `pass 814`, `fail 1`, `cancelled 0` e `skipped 4`; a única falha é `testes\integridade-release.test.mjs:165`, que cai na linha 173;
- `actual` e `expected` com 64 dígitos hexadecimais cada: o `actual` é o contrato (`3c60182bbef2…`, o mesmo do plano 4), o `expected` é o calculado com este plano, diferente do `07e0ba25deda…` do plano 4, porque o payload de `runtime/` mudou. Ele fica anotado no resultado para o plano 8, que grava o contrato;
- cinco linhas `{"ok":true,…}`, como no plano 4 (contratos 43 duas vezes, fontes 59 duas vezes e `distFiles` 59 com 0 dependências de runtime): este plano não muda TypeScript;
- `saida: 1`;
- `False`.

Base: o verify do plano 4, com 736 testes, mais os 5 das três correções que entraram no ramo depois dele (`1e7c9c9`, `a98899e` e `ce08319`): 741 no HEAD. Os 78 deste plano são LG 12, PG 11, PR 6, CG 10, CC 13, IC 9 e MC 10 nas suítes novas, e DP 5 e TC 2 nas que o plano 4 criou. A `testes\evolucao.test.mjs:348` já caiu uma vez por `EPERM` de outro processo (plano 3, T10); se cair de novo, ela roda sozinha três vezes, e a falha só conta se cair nas três.

Resultado (07/11): `tests 819`, `pass 814`, `fail 1`, `cancelled 0` e `skipped 4`, em 444 s. A única falha é a `testes\integridade-release.test.mjs:165`, que cai na linha 173: `actual` `3c60182bbef281d96b6782d614482b5e7459ce036468233c29eb6f1af3ef3df3` (o contrato, o mesmo do plano 4) e `expected` `bc1169aef09860a90fe397927f39236751afcc341300f4e5f06f88aa88674fc2` (o calculado com este plano, que o plano 8 grava). Saíram as cinco linhas `{"ok":true,…}`: contratos 43 duas vezes, fontes 59 duas vezes e `distFiles` 59 com 0 dependências de runtime. A `evolucao.test.mjs:348` passou. A guarda deu `False`.

A primeira versão deste passo esperava `tests 814`, a conta do item do executor, que esquecia as três correções. A diferença de 5 foi conferida nome a nome contra o `verify-p4.txt`: 83 testes novos, nenhum sumido; 78 são das suítes deste plano, e os 5 restantes são das três correções (dois de `feedback-personalidade`, dois de `memoria` e um de `varredura-diaria`).

- [x] **Passo 4: o que a falha conhecida mascara, rodado à parte.** O `npm test` para no primeiro `node --test` vermelho, então o `.test-dist`, o `test:dist` e o `verify:build` não rodam dentro do verify.

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
node --test --test-concurrency=1 .test-dist/testes/*.test.js *> "$rascunho\t9-test-dist-p5.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t9-test-dist-p5.txt" -Pattern '(tests|pass|fail) \d+\s*$'
npm run test:dist *> "$rascunho\t9-dist-production-p5.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t9-dist-production-p5.txt" -Pattern '(tests|pass|fail) \d+\s*$'
npm run verify:build *> "$rascunho\t9-verify-build-p5.txt"; "saida: $LASTEXITCODE"
Select-String -Path "$rascunho\t9-verify-build-p5.txt" -Pattern '^\{"ok"'
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: as três com `saida: 0`; `.test-dist` 55/55, `test:dist` 1/1 e `{"ok":true,"files":59}`, os mesmos números do plano 4; `False`.

Resultado (07/11): as três com `saida: 0`, em 11 s: `.test-dist` com `tests 55`, `pass 55` e `fail 0`; `test:dist` com `tests 1`, `pass 1` e `fail 0`; `verify:build` com `{"ok":true,"files":59}`; `False`.

- [x] **Passo 5: devolver o `dist`, conferir o plano e a guarda.** O `checkout` só roda se o `--stat` sem CR vier vazio: diferença de conteúdo no `dist` é defeito a investigar, não sobra a descartar.

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$plano = 'docs\superpowers\plans\2026-11-06-f1-plano-5-card-cofre.md'
$stat = @(git diff --ignore-cr-at-eol --stat -- dist)
'linhas de stat: ' + $stat.Count
if ($stat.Count -eq 0) { git checkout -- dist; 'checkout: ' + $LASTEXITCODE } else { $stat }
git status --short
node "$rascunho\extrair-do-plano.mjs" $plano . $rascunho --conferir > "$rascunho\t9-conferir.txt"; "saida: $LASTEXITCODE"
'igual: ' + @(Select-String -Path "$rascunho\t9-conferir.txt" -Pattern '^igual ').Count + ', outros: ' + @(Select-String -Path "$rascunho\t9-conferir.txt" -Pattern '^igual ' -NotMatch).Count
Test-Path "$env:LOCALAPPDATA\omni\casa"
```

Esperado: `linhas de stat: 0` e `checkout: 0`; o `status` com as vinte e oito linhas da T7 e nenhuma em `dist/`: onze `M` (`package.json`, os quatro da ilha, os quatro de `runtime/` e as duas suítes do plano 4) e dezessete `??` (este plano, os seis arquivos novos da ilha, os dois módulos novos, as sete suítes novas e o servidor falso); `igual: 45, outros: 0` (os quarenta e quatro da T8 e o `afetadas-p5.mjs`) e `saida: 0`; `False`.

Resultado (07/11): `linhas de stat: 0` e `checkout: 0`, com os avisos de LF para CRLF da cópia de trabalho; o `status` com as onze `M` e as dezessete `??` esperadas, nenhuma linha em `dist/`; `saida: 0`, `igual: 45, outros: 0` e `False`.

### Task 10: commit, push, CI e registro

Um commit só: os módulos, as suítes, a janela, o card e o `package.json` só fazem sentido juntos, e o commit leva este plano e a linha 5 do escopo no plano 1. As partes B e C da T8 não seguram esta tarefa: ficam abertas neste plano, com o motivo, até o Weriton decidir.

- [x] **Passo 1: a linha 5 do escopo.** Em `docs/superpowers/plans/2026-11-04-f1-casa-sqlite.md`, trocar

```markdown
| 5 | Card Cofre na ilha, falando pela API do Omni | §8.2, §3.4 | a escrever |
```

por

```markdown
| 5 | [Card Cofre na ilha, falando pela API do Omni](2026-11-06-f1-plano-5-card-cofre.md) | §8.2, §3.4 | entregue |
```

- [x] **Passo 2: varredura, CR e commit.** Autor e committer Weriton-DataOps, com o e-mail dos commits dela no `origin/main`, passado no comando e nunca impresso; mensagem em UTF-8 sem BOM, em `$rascunho\msg-p5.txt`. A varredura olha só as linhas adicionadas no índice e imprime o número do padrão e o arquivo, nunca a linha: o que ela acha é investigado antes do commit, e o falso positivo fica declarado no resultado. Os padrões moram em `$rascunho\padroes-p5.txt`, um por linha, fora do repositório, porque escritos aqui eles seriam o próprio vazamento: a lista do montador deste plano (redes internas, domínio e usuário da empresa, pastas de usuário, os números do WhatsApp e o provedor), mais e-mail com domínio real, celular brasileiro e o nome do antivírus da máquina. O CR é conferido no índice (`i/…` do `ls-files --eol`), que é o que vai ao repositório.

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$arquivos = 'package.json', 'runtime/casa/dpapi.mjs', 'runtime/casa/loja-cofre.mjs', 'runtime/casa/testadores-cofre.mjs', 'runtime/casa/presenca.mjs', 'runtime/casa/postgres-fio.mjs', 'runtime/cofre.mjs', 'apps/omni-ilha/index.html', 'apps/omni-ilha/main.js', 'apps/omni-ilha/preload.js', 'apps/omni-ilha/renderer.js', 'apps/omni-ilha/cofre.js', 'apps/omni-ilha/cofre-ipc.js', 'apps/omni-ilha/cofre-card.js', 'apps/omni-ilha/cofre-janela.js', 'apps/omni-ilha/cofre-preload.js', 'apps/omni-ilha/cofre.html', 'testes/casa-dpapi.test.mjs', 'testes/casa-testadores-cofre.test.mjs', 'testes/casa-loja-cofre-gestao.test.mjs', 'testes/casa-presenca.test.mjs', 'testes/casa-postgres-falso.mjs', 'testes/casa-postgres-fio.test.mjs', 'testes/cofre-cli-gestao.test.mjs', 'testes/ilha-cofre-mao.test.mjs', 'testes/ilha-cofre-ipc.test.mjs', 'testes/ilha-cofre-card.test.mjs', 'docs/superpowers/plans/2026-11-06-f1-plano-5-card-cofre.md', 'docs/superpowers/plans/2026-11-04-f1-casa-sqlite.md'
'arquivos: ' + $arquivos.Count
git add -- $arquivos
git status --short
'fora de i/lf: ' + @(git ls-files --eol -- $arquivos | Where-Object { $_ -notmatch '^i/lf\s' }).Count
$padroes = @(Get-Content "$rascunho\padroes-p5.txt" | Where-Object { $_ })
'padroes: ' + $padroes.Count
$atual = ''
$achados = foreach ($linha in (git diff --cached --unified=0 -- $arquivos)) {
  if ($linha -like '+++ b/*') { $atual = $linha.Substring(6); continue }
  if ($linha -notlike '+*') { continue }
  for ($i = 0; $i -lt $padroes.Count; $i++) { if ($linha -match $padroes[$i]) { 'padrao ' + ($i + 1) + '  em  ' + $atual } }
}
'achados: ' + @($achados).Count
$achados | Group-Object | ForEach-Object { $_.Count.ToString() + '  ' + $_.Name }
```

Esperado: `arquivos: 29`; o `status` com os 29 no índice (`M ` ou `A `) e nenhuma outra linha fora de ` M dist/…`; `fora de i/lf: 0`; `padroes:` com a contagem do arquivo, maior que 0; `achados: 0`, ou só falsos positivos explicados um a um no resultado. Com achado real, para aqui: o arquivo volta à tarefa dele, e esta tarefa recomeça.

Com a varredura limpa, o commit:

```powershell
$rascunho = Join-Path $env:LOCALAPPDATA 'Temp\omni-f1b'
$email = git log origin/main --author='Weriton-DataOps' -1 --format='%ae'
if (-not $email) { throw 'sem commit da Weriton-DataOps no origin/main' }
git -c user.name=Weriton-DataOps -c "user.email=$email" commit -F "$rascunho\msg-p5.txt"
git log -1 --format='%h %p %an %cn %s'
git show --stat --format='' HEAD | Select-Object -Last 1
git status --short
```

Esperado: autor e committer `Weriton-DataOps`; 29 arquivos; o `status` só com os ` M dist/…` de fim de linha, se houver.

Resultado (07/11): `arquivos: 29`; o `status` com os 29 no índice (doze `M` e dezessete `A`) e nenhuma outra linha; `fora de i/lf: 0`; `padroes: 14`; `achados: 0`. A primeira geração do arquivo de padrões cortou um padrão do montador na barra de dentro de uma classe de caracteres e o PowerShell recusou a regex: o gerador passou a avaliar o literal da lista e usar o `source` de cada uma, e uma sonda com um texto por padrão casou os 11 esperados antes da varredura. Na mensagem do commit, o único casamento é o e-mail do `Co-Authored-By`, falso positivo esperado. Commit `45f3977`, pai `ce08319`, autor e committer `Weriton-DataOps`, `29 files changed, 11475 insertions(+), 60 deletions(-)`; o `status` vazio.

- [x] **Passo 3: push e CI.** A conta do push é a dona do repositório; a conta que estava ativa é lida antes da troca e volta no `finally`.

```powershell
$antes = gh api user --jq .login
gh auth switch --user Weriton-DataOps; try { git push origin casa-sqlite-f1 } finally { gh auth switch --user $antes }
gh api user --jq .login
git ls-remote origin casa-sqlite-f1
git rev-parse HEAD
```

Depois, o CI do ramo pela conta Weriton-DataOps, com o token só na variável do processo e removido no `finally`. Esperado: a última linha do `gh api user` igual à primeira (a conta voltou); o mesmo SHA no `ls-remote` e no `HEAD`; o job Linux verde e o Windows vermelho só no `:165` (item 7), com o mesmo par `actual`/`expected` da T9, Passo 3, e 819 testes. O log do job vermelho vem pela API do job (executor, item 21).

Resultado (07/11): a conta lida antes da troca voltou no `finally` (a primeira e a última linha iguais); push `ce08319..45f3977`, com o mesmo SHA no `ls-remote` e no `HEAD`. No CI, o job Linux (Node 22, núcleo portátil) verde e o Windows (Node 22, verificação completa) vermelho só no `integridade-release.test.mjs:165`, que cai na linha 173, com o mesmo par `actual`/`expected` da T9, Passo 3; `tests 819`, `pass 814`, `fail 1`, `cancelled 0` e `skipped 4`. No PowerShell 5.1, um filtro jq com aspas internas chega ao `gh` sem as aspas: a execução do commit foi achada filtrando o JSON no próprio PowerShell.

- [x] **Passo 4: registrar.** A "Situação" deste plano passa a "entregue", com o hash do commit e as partes B e C da T8 pendentes do Weriton, e os resultados entram nos passos. Esse registro vai num segundo commit, `docs(plano): registra push e CI do plano 5 da F1`, como nos planos 3 e 4, com o mesmo push do Passo 3.

## Autorrevisão contra o desenho

| Desenho | Onde está |
|---|---|
| §8.2: lista com busca e filtros por tipo, serviço, agente e situação | T6 |
| §8.2: adicionar colando na janela ou pela área de transferência; nunca pelo chat nem pelo WhatsApp | Decisão 10; T6 |
| §8.2: ver exige Windows Hello ou PIN a cada vez; o valor some em 30 s | Decisão 2; T1, T2, T4 e T6; prova na T8 |
| §8.2: copiar limpa a área de transferência em 30 s | Decisões 3 e 4; T2; prova na T8 |
| §8.2: testar ao vivo por tipo, gravando ok ou falha com a data | `registrarTeste` (plano 4); Postgres na T3 (decisões 23 a 27), com a gravação provada na TC 6; ao vivo só na T8 |
| §8.2: editar, rotacionar e apagar para a lixeira de 30 dias | Decisões 7, 14 e 15; T1 |
| §8.2: histórico por credencial | Decisão 16; T1 |
| §8.2: saúde: vencendo, falhou, sem uso há 90 dias, valor repetido, agente que nunca usou | Decisões 6, 11 e 12; T1 |
| §3.4: a ilha não abre o banco | Decisão 1; T5 |
| §8.2: o card mostra o total e os alertas e abre a janela | Decisão 9; T7 |

Desvios e notas:
- Copiar também pede o Hello, mais estrito que o §8.2 (decisão 3).
- O agente acrescentado por edição conta a carência do `criado_em` (decisão 12).
- Sem `secure_delete`: o blob apagado pode sobrar em página livre ou no WAL, selado (decisão 18).
- String do JS não se zera (executor, item 4).
- Os mutantes 22 a 31 vêm do plano 4, dois deles ajustados (executor, item 16).
- O mutante 21 cai pelo CHECK da v1, sob a asserção de código da LG 9: sem a guarda, a rotação tenta gravar blob numa linha do Gerenciador.
- O testador de Postgres recusa tudo que não é loopback e não conhece endereço da casa (decisão 8).
- Os mutantes 17 e 29 da T3 vêm do plano 4 (13 e 12), com o trecho igual (executor, item 16).
- O TLS do Postgres não confere certificado: o túnel já autentica e cifra, e a casa não tem a CA (decisão 24).
- Sem SASLprep, a senha fora do ASCII deixa o `28P01` do SCRAM inconclusivo (decisão 25).
- Hello e área de transferência reais só na T8, com o Weriton (executor, item 6).
- Os mutantes da T2 rodam só com os testes falsos (`OMNI_SO_FALSOS=1`); os seis reais rodam uma vez, no verde (executor, item 23). O mutante 28, que antes só caía num teste real, ganhou a asserção de texto da DP 12.
- O canal do fd 3 se reconhece pelos bits de tipo, por máscara, e não pelo `isFIFO()`, que dá `false` no pipe do Windows; o mutante 11 da T4 só morre no Windows. O 13 da T4 é equivalente declarado: a suíte não fabrica um pipe que devolva `EAGAIN`.
- A sonda da mão roda com `ELECTRON_RUN_AS_NODE=1`, para um Electron posto no `OMNI_NODE` responder como Node e ser recusado; a CLI roda sem a variável (T5).
- A mão passa as opções como `--chave=valor`, para um nome que começa com `-` não virar opção na CLI (T5, MC 10).
- `apps/omni-ilha/cofre.js` não entra no `npm run check`, como o resto da ilha: o `node --check` dele vai no Passo 4 da T5, e a MC carrega o arquivo. O mesmo vale para os arquivos da T6, com o `node --check` nos Passos 4 a 6.
- A área de transferência do cadastro é limpa só se o pedido deu certo e ela ainda guarda o mesmo texto, mais estrito que a decisão 10: o que o Weriton copiou enquanto a CLI rodava não se apaga (T6, mutantes 09 a 11).
- A janela do cofre pede `setContentProtection(true)`, fora do §8.2: ela mostra o valor revelado, e o Windows a deixa fora da captura de tela de outros programas. A prova visual fotografa pela própria janela (`capturePage`), que não é barrada.
- O `main.js` e o `preload.js` mudam por costura, com âncora e sem colar o arquivo inteiro. No worktree eles estão em CRLF pelo `core.autocrlf`, e a costura preserva isso; o índice guarda LF, e a checagem de CR da T10 para os dois é pelo `git ls-files --eol`.
- A janela não tem suíte: a prova visual é o juiz dela, numa cópia da ilha com a casa temporária semeada, e revelar, copiar e os dois "da área" são trocados por respostas fictícias na bancada. O Hello e a área reais ficam para a T8.
- Os avisos da saúde na ficha usam o título no singular (`REGRA_UMA`), e os da tela de saúde, o plural (`REGRA`).
- O card relê ao abrir a forma, e não "ao focar": a ilha nunca pega o foco. Lê também uma vez ao ligar, ainda recolhida (T7).
- O piso de 1 min entre aberturas fica provado só pela CC; a prova visual prova o relógio de 2 s sem releitura e a releitura depois do toque (T7).
- O renderer da ilha não tem suíte: o que o card decide mora no `cofre-card.js`, puro e testado pela CC, e o desenho é provado pela prova visual (T7).
- A regra e o erro do card usam `--dim-2` e `--dim`: o `--dim-3` dá 3,7:1 sobre o card. Os outros cards da ilha usam o `--dim-3` no `int-quando` e no `int-vazio`, abaixo de 4,5:1; isso é anterior a este plano e fica registrado, sem conserto aqui (T7).
- O lugar do card (embaixo do Omni) é decisão visual do Weriton, reversível; a outra opção, um terceiro card na coluna do Actions e do WhatsApp, aperta os dois (T7).

## Apêndice A: mutantes da T1

A tabela abaixo é a saída do `tabela-mutantes-p5.mjs` na rodada oficial da T1.

| # | Mutante | Arquivo | Teste que ficou vermelho — asserção |
|---|---|---|---|
| 1 | vence com 16 dias | `casa/loja-cofre.mjs` | LG saúde, vence: até 15 dias ou já vencida, com a borda exata — `deepEqual` |
| 2 | vence com &lt; | `casa/loja-cofre.mjs` | LG saúde, vence: até 15 dias ou já vencida, com a borda exata — `deepEqual` |
| 3 | conferência contada como uso | `casa/loja-cofre.mjs` | LG saúde, sem uso: 90 dias contados só de entregue, revelado e copiado, e só na guarda dpapi — `deepEqual` |
| 4 | sem-uso com > | `casa/loja-cofre.mjs` | LG saúde, sem uso: 90 dias contados só de entregue, revelado e copiado, e só na guarda dpapi — `deepEqual` |
| 5 | valor da duplicata não zerado | `casa/loja-cofre.mjs` | LG saúde, duplicatas: só quando pedida, abre numa chamada, compara em memória, zera e devolve só nomes — `ok` ("os valores abertos para comparar ficam zerados") |
| 6 | dono aceito em agentes | `casa/loja-cofre.mjs` | LG dono reservado: ninguém cadastra, edita, importa nem usa como dono — `throws` sem exceção |
| 7 | uso sem a recusa do dono | `casa/loja-cofre.mjs` | LG dono reservado: ninguém cadastra, edita, importa nem usa como dono — `throws` sem exceção |
| 8 | abrir sem a presença | `casa/loja-cofre.mjs` | LG ver e copiar: só com a presença confirmada a cada vez, como dono, e todo pedido vira linha — `throws` sem exceção |
| 9 | esvaziar com 29 dias | `casa/loja-cofre.mjs` | LG lixeira: apagar sobe a versão, restaurar respeita o nome vivo, esvaziar leva só o que passou de 30 dias — `deepEqual` |
| 10 | esvaziar com >= | `casa/loja-cofre.mjs` | LG lixeira: apagar sobe a versão, restaurar respeita o nome vivo, esvaziar leva só o que passou de 30 dias — `deepEqual` |
| 11 | rotação sem zerar o último teste | `casa/loja-cofre.mjs` | LG rotacionar: sela o valor novo, sobe a versão, zera o último teste e registra a rotação — `equal` |
| 12 | import ressuscitando o apagado | `casa/loja-cofre.mjs` | LG import da pasta: hash já ingerido de credencial apagada não ressuscita, nem depois de esvaziar; valor novo entra — `deepEqual` |
| 13 | agente-nunca-usou sem carência | `casa/loja-cofre.mjs` | LG saúde, vence: até 15 dias ou já vencida, com a borda exata — `deepEqual`<br>LG saúde, teste que falhou: só o último resultado falso — `deepEqual`<br>LG saúde, agente que nunca usou: só depois de 90 dias de cadastro, e falha ao abrir não conta — `deepEqual` |
| 14 | teste que falhou ignorado | `casa/loja-cofre.mjs` | LG saúde, teste que falhou: só o último resultado falso — `deepEqual` |
| 15 | restaurar por cima de nome vivo | `casa/loja-cofre.mjs` | LG lixeira: apagar sobe a versão, restaurar respeita o nome vivo, esvaziar leva só o que passou de 30 dias — `throws` com outro erro |
| 16 | edição sem mudança sobe a versão | `casa/loja-cofre.mjs` | LG editar: muda só o que foi pedido, sobe a versão uma vez e recusa campo que não se edita — `equal` |
| 17 | sem-uso também no Gerenciador | `casa/loja-cofre.mjs` | LG saúde, sem uso: 90 dias contados só de entregue, revelado e copiado, e só na guarda dpapi — `deepEqual` |
| 18 | carência com > | `casa/loja-cofre.mjs` | LG saúde, agente que nunca usou: só depois de 90 dias de cadastro, e falha ao abrir não conta — `deepEqual` |
| 19 | histórico do mais velho ao mais novo | `casa/loja-cofre.mjs` | LG histórico: por id, do mais novo ao mais velho, com recusas, sem o valor e depois de apagada — `deepEqual` |
| 20 | Gerenciador aberto ao dono | `casa/loja-cofre.mjs` | LG ver e copiar: só com a presença confirmada a cada vez, como dono, e todo pedido vira linha — `throws` com outro erro |
| 21 | rotação no Gerenciador | `casa/loja-cofre.mjs` | LG rotacionar: sela o valor novo, sobe a versão, zera o último teste e registra a rotação — `throws` com outro erro |
| 22 | recusa do agente desligada (plano 4, 01) | `casa/loja-cofre.mjs` | LC uso: entrega só a agente autorizado e registra cada pedido, entregue ou recusado, sem o valor — `throws` sem exceção<br>CL executar recusa agente sem acesso antes de criar o filho — `equal` |
| 23 | recusa do agente sem registro em usos (plano 4, 02) | `casa/loja-cofre.mjs` | LC uso: entrega só a agente autorizado e registra cada pedido, entregue ou recusado, sem o valor — `deepEqual` |
| 24 | credencial do Gerenciador entregue como DPAPI (plano 4, 03) | `casa/loja-cofre.mjs` | LC uso: entrega só a agente autorizado e registra cada pedido, entregue ou recusado, sem o valor — `throws` com outro erro |
| 25 | inventário sem o filtro Omni/ (plano 4, 08) | `casa/loja-cofre.mjs` | LC inventário do Gerenciador: só Omni/, só o nome, sem blob, e ausente contado, nunca apagado — `deepEqual` |
| 26 | divergente contado como já importado (plano 4, 09) | `casa/loja-cofre.mjs` | LC importação da pasta .dpapi: abre antes de gravar, classifica, não duplica e nunca apaga o original — `deepEqual`<br>LC importação do texto hex do ConvertFrom-SecureString: abre, passa o UTF-16LE para UTF-8, re-sela e reconhece o arquivo na volta — `deepEqual` |
| 27 | pacote sem conferir o formato do conteúdo (plano 4, 14) | `casa/loja-cofre.mjs` | LC pacote importado: frase errada não grava nada, conteúdo de outro formato é recusado, item ruim é pulado — `throws` sem exceção |
| 28 | texto hex do SecureString não reconhecido (plano 4, 15) | `casa/loja-cofre.mjs` | LC importação do texto hex do ConvertFrom-SecureString: abre, passa o UTF-16LE para UTF-8, re-sela e reconhece o arquivo na volta — `equal` |
| 29 | texto hex gravado sem re-selar em UTF-8 (plano 4, 16) | `casa/loja-cofre.mjs` | LC importação do texto hex do ConvertFrom-SecureString: abre, passa o UTF-16LE para UTF-8, re-sela e reconhece o arquivo na volta — `equal` |
| 30 | arquivo já ingerido contado como divergente (plano 4, 17) | `casa/loja-cofre.mjs` | LC importação do texto hex do ConvertFrom-SecureString: abre, passa o UTF-16LE para UTF-8, re-sela e reconhece o arquivo na volta — `deepEqual` |
| 31 | UTF-16LE de tamanho ímpar aceito (plano 4, 18) | `casa/loja-cofre.mjs` | LC importação do texto hex do ConvertFrom-SecureString: abre, passa o UTF-16LE para UTF-8, re-sela e reconhece o arquivo na volta — `equal` |

## Apêndice B: mutantes da T3

A tabela abaixo é a saída do `tabela-mutantes-p5.mjs` na rodada oficial da T3.

| # | Mutante | Arquivo | Teste que ficou vermelho — asserção |
|---|---|---|---|
| 1 | host fora do loopback aceito | `casa/postgres-fio.mjs` | PG alvoPostgres: só loopback, sem senha na url e com usuário; o que fica de fora nem conecta — `deepEqual` ("postgres://leitor@192.0.2.10:6543/banco")<br>TC conexão postgres:// fora do loopback ou com senha na url nem abre o valor; outro esquema ou tipo não vai ao fio — `deepEqual` |
| 2 | fio sem a guarda do loopback | `casa/postgres-fio.mjs` | PG alvoPostgres: só loopback, sem senha na url e com usuário; o que fica de fora nem conecta — `deepEqual` |
| 3 | SSLRequest com o código do GSSENC | `casa/postgres-fio.mjs` | PG SCRAM sem TLS: prova a senha sem mandá-la, a quebra de linha do fim não conta, SELECT 1 e Terminate — `deepEqual`<br>PG TLS: o S do servidor sobe o TLS sobre o mesmo socket sem conferir certificado; falha de TLS e byte injetado ficam sem veredito — `deepEqual` |
| 4 | nonce alheio aceito | `casa/postgres-fio.mjs` | PG SCRAM: servidor que não se prova ou foge do formato fica sem veredito e sem consulta — `deepEqual` ("{"scram":{"nonceAlheio":true}}") |
| 5 | assinatura do servidor sem conferência | `casa/postgres-fio.mjs` | PG SCRAM: servidor que não se prova ou foge do formato fica sem veredito e sem consulta — `deepEqual` ("{"scram":{"assinaturaFalsa":true}}") |
| 6 | iterações fixas em 4096 | `casa/postgres-fio.mjs` | PG SCRAM sem TLS: prova a senha sem mandá-la, a quebra de linha do fim não conta, SELECT 1 e Terminate — `deepEqual`<br>PG SCRAM: servidor que não se prova ou foge do formato fica sem veredito e sem consulta — `deepEqual` ("{"scram":{"assinaturaFalsa":true}}")<br>PG TLS: o S do servidor sobe o TLS sobre o mesmo socket sem conferir certificado; falha de TLS e byte injetado ficam sem veredito — `deepEqual`<br>PG erro do servidor depois da senha leva só o SQLSTATE; SELECT 1 que não volta 1 fica sem veredito — `deepEqual` |
| 7 | iterações sem teto | `casa/postgres-fio.mjs` | PG SCRAM: servidor que não se prova ou foge do formato fica sem veredito e sem consulta — `deepEqual` ("{"iteracoes":1000001}") |
| 8 | Client key minúsculo | `casa/postgres-fio.mjs` | PG provaScram reproduz o vetor do RFC 7677 — `equal`<br>PG SCRAM sem TLS: prova a senha sem mandá-la, a quebra de linha do fim não conta, SELECT 1 e Terminate — `deepEqual`<br>PG SCRAM: servidor que não se prova ou foge do formato fica sem veredito e sem consulta — `deepEqual` ("{"scram":{"assinaturaFalsa":true}}")<br>PG TLS: o S do servidor sobe o TLS sobre o mesmo socket sem conferir certificado; falha de TLS e byte injetado ficam sem veredito — `deepEqual`<br>PG erro do servidor depois da senha leva só o SQLSTATE; SELECT 1 que não volta 1 fica sem veredito — `deepEqual` |
| 9 | prova sem o XOR | `casa/postgres-fio.mjs` | PG provaScram reproduz o vetor do RFC 7677 — `equal`<br>PG SCRAM sem TLS: prova a senha sem mandá-la, a quebra de linha do fim não conta, SELECT 1 e Terminate — `deepEqual`<br>PG SCRAM: servidor que não se prova ou foge do formato fica sem veredito e sem consulta — `deepEqual` ("{"scram":{"assinaturaFalsa":true}}")<br>PG TLS: o S do servidor sobe o TLS sobre o mesmo socket sem conferir certificado; falha de TLS e byte injetado ficam sem veredito — `deepEqual`<br>PG erro do servidor depois da senha leva só o SQLSTATE; SELECT 1 que não volta 1 fica sem veredito — `deepEqual` |
| 10 | MD5 com a ordem trocada | `casa/postgres-fio.mjs` | PG MD5: a resposta da documentação prova a senha sem mandá-la; senha errada é recusa — `deepEqual` |
| 11 | MD5 sem o prefixo | `casa/postgres-fio.mjs` | PG MD5: a resposta da documentação prova a senha sem mandá-la; senha errada é recusa — `deepEqual` |
| 12 | 28P01 trocado | `casa/postgres-fio.mjs` | PG SCRAM: senha errada é recusa (28P01); com caractere fora do ASCII a recusa fica inconclusiva — `deepEqual`<br>PG MD5: a resposta da documentação prova a senha sem mandá-la; senha errada é recusa — `deepEqual` |
| 13 | trust aceito | `casa/postgres-fio.mjs` | PG trust, texto puro, GSS e SCRAM-PLUS: sem veredito, sem senha no fio e sem consulta — `deepEqual` ("trust") |
| 14 | sem tempo-limite | `casa/postgres-fio.mjs` | PG servidor mudo esgota o tempo e ainda recebe o Terminate; servidor que cai vira queda — `equal` ("o teste pendurou") |
| 15 | SELECT 1 sem conferir | `casa/postgres-fio.mjs` | PG erro do servidor depois da senha leva só o SQLSTATE; SELECT 1 que não volta 1 fica sem veredito — `deepEqual` |
| 16 | sem Terminate | `casa/postgres-fio.mjs` | PG SCRAM sem TLS: prova a senha sem mandá-la, a quebra de linha do fim não conta, SELECT 1 e Terminate — `deepEqual`<br>PG servidor mudo esgota o tempo e ainda recebe o Terminate; servidor que cai vira queda — `equal` |
| 17 | valor do testador não zerado (plano 4, 13) | `casa/testadores-cofre.mjs` | TC OpenAI: GET /v1/models com o Bearer aparado; 200 é ok e o valor é zerado — `ok` ("o valor foi zerado")<br>TC conexão postgres://: o valor sai do cofre só para o fio, volta zerado e o resultado fica gravado, antes e depois da rotação — `ok` ("o valor foi zerado") |
| 18 | TLS conferindo certificado | `casa/postgres-fio.mjs` | PG TLS: o S do servidor sobe o TLS sobre o mesmo socket sem conferir certificado; falha de TLS e byte injetado ficam sem veredito — `equal` |
| 19 | S ignorado | `casa/postgres-fio.mjs` | PG TLS: o S do servidor sobe o TLS sobre o mesmo socket sem conferir certificado; falha de TLS e byte injetado ficam sem veredito — `deepEqual` |
| 20 | ECONNREFUSED sem a pergunta do túnel | `casa/postgres-fio.mjs` | PG porta fechada: ECONNREFUSED vira a pergunta do túnel — `deepEqual` |
| 21 | senha em texto puro enviada | `casa/postgres-fio.mjs` | PG trust, texto puro, GSS e SCRAM-PLUS: sem veredito, sem senha no fio e sem consulta — `deepEqual` ("texto") |
| 22 | conexão postgres:// fora do fio | `casa/testadores-cofre.mjs` | TC conexão postgres:// fora do loopback ou com senha na url nem abre o valor; outro esquema ou tipo não vai ao fio — `deepEqual`<br>TC conexão postgres://: o valor sai do cofre só para o fio, volta zerado e o resultado fica gravado, antes e depois da rotação — `deepEqual` |
| 23 | senha na url aceita | `casa/postgres-fio.mjs` | PG alvoPostgres: só loopback, sem senha na url e com usuário; o que fica de fora nem conecta — `deepEqual` ("postgresql://leitor:segredo@127.0.0.1:6543/banco")<br>TC conexão postgres:// fora do loopback ou com senha na url nem abre o valor; outro esquema ou tipo não vai ao fio — `deepEqual` |
| 24 | CR do fim conta | `casa/postgres-fio.mjs` | PG SCRAM sem TLS: prova a senha sem mandá-la, a quebra de linha do fim não conta, SELECT 1 e Terminate — `deepEqual` |
| 25 | sucesso SCRAM sem a prova do servidor | `casa/postgres-fio.mjs` | PG SCRAM: servidor que não se prova ou foge do formato fica sem veredito e sem consulta — `deepEqual` ("{"scram":{"pularFinal":true}}") |
| 26 | resposta ao SSLRequest com lixo aceita | `casa/postgres-fio.mjs` | PG TLS: o S do servidor sobe o TLS sobre o mesmo socket sem conferir certificado; falha de TLS e byte injetado ficam sem veredito — `deepEqual` |
| 27 | qualquer tipo com url postgres:// vai ao fio | `casa/testadores-cofre.mjs` | TC conexão postgres:// fora do loopback ou com senha na url nem abre o valor; outro esquema ou tipo não vai ao fio — `deepEqual` |
| 28 | SASL sem exigir SCRAM-SHA-256 | `casa/postgres-fio.mjs` | PG trust, texto puro, GSS e SCRAM-PLUS: sem veredito, sem senha no fio e sem consulta — `deepEqual` ("sasl-plus") |
| 29 | Sentinel testado (plano 4, 12) | `casa/testadores-cofre.mjs` | TC Sentinel nunca é testado: nem abre o valor, nem chama a rede — `deepEqual`<br>CL testar: OpenAI vai à rede com o Bearer e grava o resultado; Sentinel nunca; inexistente é recusa — `deepEqual` |
| 30 | valor com cara de url aceito | `casa/postgres-fio.mjs` | PG alvoPostgres: só loopback, sem senha na url e com usuário; o que fica de fora nem conecta — `deepEqual` |
| 31 | acento sem o inconclusivo | `casa/postgres-fio.mjs` | PG SCRAM: senha errada é recusa (28P01); com caractere fora do ASCII a recusa fica inconclusiva — `deepEqual` |
| 32 | nulo no usuário ou no banco aceito | `casa/postgres-fio.mjs` | PG alvoPostgres: só loopback, sem senha na url e com usuário; o que fica de fora nem conecta — `deepEqual` ("postgres://le%00itor@127.0.0.1/banco") |

## Apêndice C: mutantes da T2

A tabela abaixo é a saída do `tabela-mutantes-p5.mjs` na rodada oficial da T2.

| # | Mutante | Arquivo | Teste que ficou vermelho — asserção |
|---|---|---|---|
| 1 | a mensagem vai no argumento | `casa/presenca.mjs` | PR a mensagem do Hello vai só no stdin, em base64 de UTF-8; o script vai por -EncodedCommand, sem nada depois — `equal` |
| 2 | sem windowsHide | `casa/presenca.mjs` | PR a mensagem do Hello vai só no stdin, em base64 de UTF-8; o script vai por -EncodedCommand, sem nada depois — `equal`<br>PR disponivel() só pergunta a disponibilidade, pelo PowerShell do sistema e com o limite padrão; cada ramo do script chama só o seu método — `equal` |
| 3 | timeout ignora o limite | `casa/presenca.mjs` | PR a mensagem do Hello vai só no stdin, em base64 de UTF-8; o script vai por -EncodedCommand, sem nada depois — `equal` |
| 4 | cancelado vira ok | `casa/presenca.mjs` | PR cada desfecho do Hello vira { ok, motivo }, nos dois métodos — `deepEqual` ("verificar com "resultado Canceled"") |
| 5 | sem conferir o prefixo | `casa/presenca.mjs` | PR resposta torta, filho que falhou e erro de spawn viram falhou ou tempo, nunca exceção — `deepEqual` ("verificar com {"stdout":"disponibilidade DeviceBusy\n"}") |
| 6 | Available vale como verificado | `casa/presenca.mjs` | PR resposta torta, filho que falhou e erro de spawn viram falhou ou tempo, nunca exceção — `deepEqual` ("verificar com {"stdout":"resultado Available\n"}") |
| 7 | linha extra passa | `casa/presenca.mjs` | PR resposta torta, filho que falhou e erro de spawn viram falhou ou tempo, nunca exceção — `deepEqual` ("verificar com {"stdout":"resultado Verified\nresultado Verified\n"}") |
| 8 | regex sem âncora no fim | `casa/presenca.mjs` | PR resposta torta, filho que falhou e erro de spawn viram falhou ou tempo, nunca exceção — `deepEqual` ("verificar com {"stdout":"resultado Verified extra\n"}") |
| 9 | motivo desconhecido passa adiante | `casa/presenca.mjs` | PR resposta torta, filho que falhou e erro de spawn viram falhou ou tempo, nunca exceção — `deepEqual` ("verificar com {"stdout":"resultado Available\n"}") |
| 10 | erro de spawn vira tempo | `casa/presenca.mjs` | PR resposta torta, filho que falhou e erro de spawn viram falhou ou tempo, nunca exceção — `deepEqual` ("verificar com {"status":null,"error":{"code":"ENOENT"}}") |
| 11 | filho que falhou passa | `casa/presenca.mjs` | PR resposta torta, filho que falhou e erro de spawn viram falhou ou tempo, nunca exceção — `deepEqual` ("verificar com {"status":1,"stdout":"resultado Verified\n","stderr":"detalhe do filho"}") |
| 12 | mensagem só de espaços aceita | `casa/presenca.mjs` | PR mensagem do Hello vazia ou que não é texto não chega ao PowerShell — `throws` sem exceção |
| 13 | tempo do script vira ok | `casa/presenca.mjs` | PR cada desfecho do Hello vira { ok, motivo }, nos dois métodos — `deepEqual` ("disponivel com "tempo"") |
| 14 | o ramo da disponibilidade responde como resultado | `casa/presenca.mjs` | PR disponivel() só pergunta a disponibilidade, pelo PowerShell do sistema e com o limite padrão; cada ramo do script chama só o seu método — `ok` ("a disponibilidade responde com o prefixo dela e espera 10 s") |
| 15 | a mensagem lida na página OEM | `casa/presenca.mjs` | PR disponivel() só pergunta a disponibilidade, pelo PowerShell do sistema e com o limite padrão; cada ramo do script chama só o seu método — `ok` ("a mensagem sai da segunda linha do stdin, em UTF-8") |
| 16 | PowerShell pelo PATH | `casa/presenca.mjs` | PR disponivel() só pergunta a disponibilidade, pelo PowerShell do sistema e com o limite padrão; cada ramo do script chama só o seu método — `equal` |
| 17 | o blob entra no script | `casa/dpapi.mjs` | DP área de transferência: o blob vai só no stdin e o prazo da limpeza volta em ISO — `ok` ("o blob não vai no script") |
| 18 | sem o formato do histórico | `casa/dpapi.mjs` | DP o script da área: abre, copia com os três formatos de exclusão, lê o número, marca 30 s e solta a limpeza que só limpa o que é dela — `ok` ("o formato CanIncludeInClipboardHistory vai junto") |
| 19 | o DWORD vira 1 | `casa/dpapi.mjs` | DP o script da área: abre, copia com os três formatos de exclusão, lê o número, marca 30 s e solta a limpeza que só limpa o que é dela — `ok` ("cada formato leva o DWORD 0") |
| 20 | limpa sem conferir o número | `casa/dpapi.mjs` | DP o script da área: abre, copia com os três formatos de exclusão, lê o número, marca 30 s e solta a limpeza que só limpa o que é dela — `ok` ("a limpeza tem GetClipboardSequenceNumber() -eq $numero) { $null = [OmniCofre.Area]::EmptyClipboard() }") |
| 21 | limpa sem esperar o prazo | `casa/dpapi.mjs` | DP o script da área: abre, copia com os três formatos de exclusão, lê o número, marca 30 s e solta a limpeza que só limpa o que é dela — `ok` ("a limpeza tem if ($espera -gt 0) { Start-Sleep -Milliseconds $espera }") |
| 22 | prazo de 300 s | `casa/dpapi.mjs` | DP o script da área: abre, copia com os três formatos de exclusão, lê o número, marca 30 s e solta a limpeza que só limpa o que é dela — `ok` ("o script tem AddSeconds(30)") |
| 23 | a área fica aberta | `casa/dpapi.mjs` | DP o script da área: abre, copia com os três formatos de exclusão, lê o número, marca 30 s e solta a limpeza que só limpa o que é dela — `ok` ("a limpeza tem finally { $null = [OmniCofre.Area]::CloseClipboard() }") |
| 24 | limpaEm ignora o prazo | `casa/dpapi.mjs` | DP área de transferência: o blob vai só no stdin e o prazo da limpeza volta em ISO — `deepEqual` |
| 25 | prazo sem limite de dígitos | `casa/dpapi.mjs` | DP área de transferência: falha da DPAPI, resposta torta, contagem errada, filho que falhou e entrada que não serve — `throws` sem exceção |
| 26 | linha extra passa | `casa/dpapi.mjs` | DP área de transferência: falha da DPAPI, resposta torta, contagem errada, filho que falhou e entrada que não serve — `throws` sem exceção |
| 27 | blob vazio vai ao PowerShell | `casa/dpapi.mjs` | DP área de transferência: falha da DPAPI, resposta torta, contagem errada, filho que falhou e entrada que não serve — `throws` com outro erro |
| 28 | a falha perde o tipo | `casa/dpapi.mjs` | DP o script da área: abre, copia com os três formatos de exclusão, lê o número, marca 30 s e solta a limpeza que só limpa o que é dela — `ok` ("a falha desembrulha o InnerException e devolve o tipo de dentro") |
| 29 | a limpeza não se solta | `casa/dpapi.mjs` | DP o script da área: abre, copia com os três formatos de exclusão, lê o número, marca 30 s e solta a limpeza que só limpa o que é dela — `ok` ("o script solta a limpeza pelo Start-Process com -EncodedCommand") |
| 30 | o prazo não vai ao neto | `casa/dpapi.mjs` | DP o script da área: abre, copia com os três formatos de exclusão, lê o número, marca 30 s e solta a limpeza que só limpa o que é dela — `ok` ("o script tem $env:OMNI_COFRE_AREA_PRAZO = [string]$prazo") |

## Apêndice D: mutantes da T4

A tabela abaixo é a saída do `tabela-mutantes-p5.mjs` na rodada oficial da T4.

| # | Mutante | Arquivo | Teste que ficou vermelho — asserção |
|---|---|---|---|
| 1 | revelar sem conferir o canal | `cofre.mjs` | CG revelar sem o canal recusa antes de pedir a presença e antes de abrir o blob — `equal` ("["revelar","--nome","teste-hello"]")<br>CG o arquivo roda direto: revelar sem o fd 3 dá sem-canal; com o fd 3 em pipe, chega ao cofre — `equal` |
| 2 | canal conferido depois da presença | `cofre.mjs` | CG revelar sem o canal recusa antes de pedir a presença e antes de abrir o blob — `deepEqual`<br>CG o arquivo roda direto: revelar sem o fd 3 dá sem-canal; com o fd 3 em pipe, chega ao cofre — `equal` |
| 3 | valor revelado sem zerar | `cofre.mjs` | CG revelar com o canal: o valor sai só pelo canal e é zerado; recusa, inexistente e presença que quebra — `ok` ("o valor entregue ao canal foi zerado") |
| 4 | valor revelado vai pelo stderr | `cofre.mjs` | CG revelar com o canal: o valor sai só pelo canal e é zerado; recusa, inexistente e presença que quebra — `deepEqual` |
| 5 | saída do revelar leva o valor | `cofre.mjs` | CG revelar com o canal: o valor sai só pelo canal e é zerado; recusa, inexistente e presença que quebra — `deepEqual` |
| 6 | mensagem do Hello sem o nome | `cofre.mjs` | CG revelar com o canal: o valor sai só pelo canal e é zerado; recusa, inexistente e presença que quebra — `deepEqual` |
| 7 | copiar pede o Hello com a mensagem do ver | `cofre.mjs` | CG copiar devolve só o uso e a hora da limpeza, nunca o valor — `deepEqual` |
| 8 | presença ignora a injetada | `cofre.mjs` | CG revelar com o canal: o valor sai só pelo canal e é zerado; recusa, inexistente e presença que quebra — `deepEqual`<br>CG copiar devolve só o uso e a hora da limpeza, nunca o valor — `deepEqual` |
| 9 | canal padrão sempre aberto | `cofre.mjs` | CG o arquivo roda direto: revelar sem o fd 3 dá sem-canal; com o fd 3 em pipe, chega ao cofre — `equal` |
| 10 | canal aceita qualquer descritor aberto | `cofre.mjs` | CG canalDoDono: arquivo aberto é canal, dispositivo não; escrever entrega tudo e fecha o descritor — `equal` ("um dispositivo aberto, como o console, não é o canal") |
| 11 | canal pelo isFIFO do Node | `cofre.mjs` | CG o arquivo roda direto: revelar sem o fd 3 dá sem-canal; com o fd 3 em pipe, chega ao cofre — `equal` |
| 12 | escrever não fecha o descritor | `cofre.mjs` | CG canalDoDono: arquivo aberto é canal, dispositivo não; escrever entrega tudo e fecha o descritor — `equal` ("escrever fecha o descritor") |
| 13 | escrever para no primeiro pedaço | `cofre.mjs` | sobreviveu — equivalente: writeSync em arquivo e no pipe do Windows escreve tudo de uma vez; o laço só pesa em pipe não bloqueante que devolve EAGAIN, e a suíte não fabrica um |
| 14 | historico aceita --id e --nome juntos | `cofre.mjs` | CG historico por nome ou por id, do mais novo ao mais velho, com limite; vale na lixeira — `equal` ("["historico","--id","01a1b70a-ded8-7fe2-b14a-8f1bdaab5a04","--nome","servico-a"]") |
| 15 | historico ignora o limite | `cofre.mjs` | CG historico por nome ou por id, do mais novo ao mais velho, com limite; vale na lixeira — `deepEqual` |
| 16 | historico por nome sem conferir o achado | `cofre.mjs` | CG historico por nome ou por id, do mais novo ao mais velho, com limite; vale na lixeira — `equal` |
| 17 | saude abre os blobs sem --duplicatas | `cofre.mjs` | CG saude sem duplicata não abre blob; com --duplicatas, abre numa chamada e devolve só os nomes — `deepEqual` |
| 18 | JSON torto do editar vira recusa | `cofre.mjs` | CG editar recebe as mudanças em JSON e devolve a credencial — `equal` ("["editar","--nome","servico-a","--mudancas","{torto"]") |
| 19 | rotacionar aceita --valor | `cofre.mjs` | CG rotacionar lê o valor novo só da primeira linha do stdin e não o devolve — `equal` ("["rotacionar","--nome","servico-a","--valor","segredo-no-argumento"]") |
| 20 | apagar devolve só o ok | `cofre.mjs` | CG apagar, lixeira, restaurar e esvaziar-lixeira — `deepEqual` |
| 21 | lixeira aceita opção | `cofre.mjs` | CG apagar, lixeira, restaurar e esvaziar-lixeira — `equal` ("["lixeira","--tudo"]") |
| 22 | esvaziar-lixeira sem o ok | `cofre.mjs` | CG apagar, lixeira, restaurar e esvaziar-lixeira — `deepEqual` |
| 23 | restaurar sem a credencial | `cofre.mjs` | CG apagar, lixeira, restaurar e esvaziar-lixeira — `deepEqual` |
| 24 | copiar sem o nome na saída | `cofre.mjs` | CG copiar devolve só o uso e a hora da limpeza, nunca o valor — `deepEqual` |
| 25 | editar ignora as mudanças | `cofre.mjs` | CG editar recebe as mudanças em JSON e devolve a credencial — `deepEqual` |
| 26 | comando novo desconhecido | `cofre.mjs` | CG saude sem duplicata não abre blob; com --duplicatas, abre numa chamada e devolve só os nomes — `equal` |

## Apêndice E: mutantes da T5

A tabela abaixo é a saída do `tabela-mutantes-p5.mjs` na rodada oficial da T5.

| # | Mutante | Arquivo | Teste que ficou vermelho — asserção |
|---|---|---|---|
| 1 | Node do processo da ilha | `apps/omni-ilha/cofre.js` | MC o Node vem do OMNI_NODE ou do PATH, a sonda roda uma vez e a CLI vai sem o modo Electron — `equal` |
| 2 | sonda sem o modo Node do Electron | `apps/omni-ilha/cofre.js` | MC o Node vem do OMNI_NODE ou do PATH, a sonda roda uma vez e a CLI vai sem o modo Electron — `equal` |
| 3 | CLI herda o modo Node do Electron | `apps/omni-ilha/cofre.js` | MC o Node vem do OMNI_NODE ou do PATH, a sonda roda uma vez e a CLI vai sem o modo Electron — `equal` |
| 4 | sonda aceita o Electron | `apps/omni-ilha/cofre.js` | MC a sonda recusa o Node antigo e o Electron, sem chamar a CLI — `deepEqual` |
| 5 | 22.13 fica de fora | `apps/omni-ilha/cofre.js` | MC o Node vem do OMNI_NODE ou do PATH, a sonda roda uma vez e a CLI vai sem o modo Electron — `deepEqual`<br>MC a sonda recusa o Node antigo e o Electron, sem chamar a CLI — `equal` ("22.13.0")<br>MC a sonda que falha não fica guardada, e cada falha tem a sua mensagem — `deepEqual`<br>MC cada saída da CLI vira a resposta certa — `deepEqual` ("{"saida":"[{\"nome\":\"a\"}]","codigo":0}")<br>MC cada pedido tem o seu limite de tempo e mata o processo quando passa — `ok` ("a CLI não foi chamada")<br>MC cada função monta os seus argumentos e o seu stdio — `deepEqual`<br>MC cadastrar e rotacionar mandam o valor pelo stdin e zeram os Buffers — `deepEqual`<br>MC o revelado volta pelo fd 3 só na saída 0, e os pedaços são zerados — `equal` ("a CLI devia ter sido chamada uma vez")<br>MC os tetos de stdout, do fd 3 e do stderr — `equal` |
| 6 | qualquer 22 serve | `apps/omni-ilha/cofre.js` | MC a sonda recusa o Node antigo e o Electron, sem chamar a CLI — `equal` ("22.12.9") |
| 7 | sonda a cada pedido | `apps/omni-ilha/cofre.js` | MC o Node vem do OMNI_NODE ou do PATH, a sonda roda uma vez e a CLI vai sem o modo Electron — `equal` |
| 8 | sonda que falha fica guardada | `apps/omni-ilha/cofre.js` | MC a sonda que falha não fica guardada, e cada falha tem a sua mensagem — `deepEqual` |
| 9 | CLI sem calar o aviso do sqlite | `apps/omni-ilha/cofre.js` | MC o Node vem do OMNI_NODE ou do PATH, a sonda roda uma vez e a CLI vai sem o modo Electron — `deepEqual`<br>MC cada função monta os seus argumentos e o seu stdio — `deepEqual` |
| 10 | valor sem a quebra de linha | `apps/omni-ilha/cofre.js` | MC cadastrar e rotacionar mandam o valor pelo stdin e zeram os Buffers — `deepEqual` |
| 11 | cópia do stdin sem zerar | `apps/omni-ilha/cofre.js` | MC cadastrar e rotacionar mandam o valor pelo stdin e zeram os Buffers — `ok` ("a cópia com a quebra de linha ficou com o valor") |
| 12 | Buffer de quem chamou sem zerar | `apps/omni-ilha/cofre.js` | MC cadastrar e rotacionar mandam o valor pelo stdin e zeram os Buffers — `ok` ("o Buffer de quem chamou ficou com o valor") |
| 13 | valor de duas linhas aceito | `apps/omni-ilha/cofre.js` | MC cadastrar e rotacionar mandam o valor pelo stdin e zeram os Buffers — `deepEqual` |
| 14 | fd 3 aberto em todo pedido | `apps/omni-ilha/cofre.js` | MC o Node vem do OMNI_NODE ou do PATH, a sonda roda uma vez e a CLI vai sem o modo Electron — `deepEqual`<br>MC cada função monta os seus argumentos e o seu stdio — `deepEqual` |
| 15 | revelado volta na recusa | `apps/omni-ilha/cofre.js` | MC o revelado volta pelo fd 3 só na saída 0, e os pedaços são zerados — `deepEqual`<br>MC a CLI de verdade, numa casa temporária, responde pela mão — `equal` |
| 16 | pedaços do fd 3 sem zerar | `apps/omni-ilha/cofre.js` | MC o revelado volta pelo fd 3 só na saída 0, e os pedaços são zerados — `ok` ("os pedaços do fd 3 ficaram com o valor") |
| 17 | tempo esgotado sem matar | `apps/omni-ilha/cofre.js` | MC cada pedido tem o seu limite de tempo e mata o processo quando passa — `equal`<br>MC os tetos de stdout, do fd 3 e do stderr — `equal` |
| 18 | revelar com o limite médio | `apps/omni-ilha/cofre.js` | MC cada pedido tem o seu limite de tempo e mata o processo quando passa — `equal` |
| 19 | testar com o limite curto | `apps/omni-ilha/cofre.js` | MC cada pedido tem o seu limite de tempo e mata o processo quando passa — `equal` |
| 20 | stdout sem teto | `apps/omni-ilha/cofre.js` | MC os tetos de stdout, do fd 3 e do stderr — `equal` |
| 21 | fd 3 sem teto | `apps/omni-ilha/cofre.js` | MC os tetos de stdout, do fd 3 e do stderr — `equal` |
| 22 | recusa lida na saída errada | `apps/omni-ilha/cofre.js` | MC cada saída da CLI vira a resposta certa — `deepEqual` ("{"saida":"{\"ok\":false,\"codigo\":\"inexistente\",\"erro\":\"Não há credencial com o nome a.\"}","codigo":3}")<br>MC o revelado volta pelo fd 3 só na saída 0, e os pedaços são zerados — `deepEqual`<br>MC a CLI de verdade, numa casa temporária, responde pela mão — `equal` |
| 23 | erro de uso vazio | `apps/omni-ilha/cofre.js` | MC cada saída da CLI vira a resposta certa — `deepEqual` ("{"erro":"falta --nome\nUSO: ...","codigo":2}")<br>MC a CLI de verdade, numa casa temporária, responde pela mão — `deepEqual` |
| 24 | primeira linha sem corte | `apps/omni-ilha/cofre.js` | MC os tetos de stdout, do fd 3 e do stderr — `equal` |
| 25 | recusa sem conferir a forma | `apps/omni-ilha/cofre.js` | MC cada saída da CLI vira a resposta certa — `deepEqual` ("{"saida":"{\"ok\":true}","codigo":3}") |
| 26 | agentes descartados | `apps/omni-ilha/cofre.js` | MC cada função monta os seus argumentos e o seu stdio — `deepEqual` |
| 27 | sonda ignora a saída do Node | `apps/omni-ilha/cofre.js` | MC a sonda que falha não fica guardada, e cada falha tem a sua mensagem — `deepEqual` |
| 28 | mudanças sem virar JSON | `apps/omni-ilha/cofre.js` | MC cada função monta os seus argumentos e o seu stdio — `deepEqual`<br>MC a CLI de verdade, numa casa temporária, responde pela mão — `equal` |
| 29 | saúde sem as duplicatas | `apps/omni-ilha/cofre.js` | MC cada função monta os seus argumentos e o seu stdio — `deepEqual` |
| 30 | janela do console à mostra | `apps/omni-ilha/cofre.js` | MC o Node vem do OMNI_NODE ou do PATH, a sonda roda uma vez e a CLI vai sem o modo Electron — `equal` |
| 31 | revelar sem o fd 3 | `apps/omni-ilha/cofre.js` | MC cada função monta os seus argumentos e o seu stdio — `deepEqual`<br>MC o revelado volta pelo fd 3 só na saída 0, e os pedaços são zerados — `deepEqual`<br>MC os tetos de stdout, do fd 3 e do stderr — `equal`<br>MC a CLI de verdade, numa casa temporária, responde pela mão — `equal` |

## Apêndice F: mutantes da T6

A tabela abaixo é a saída do `tabela-mutantes-p5.mjs` na rodada oficial da T6.

| # | Mutante | Arquivo | Teste que ficou vermelho — asserção |
|---|---|---|---|
| 1 | janela sem guarda | `apps/omni-ilha/cofre-ipc.js` | testes/ilha-cofre-ipc.test.mjs remetente errado recebe null e a mão não é chamada — `equal` ("cofre:listar aceitou a ilha") |
| 2 | resumo sem guarda | `apps/omni-ilha/cofre-ipc.js` | testes/ilha-cofre-ipc.test.mjs remetente errado recebe null e a mão não é chamada — `equal` ("o resumo aceitou a janela do cofre") |
| 3 | duplicatas com qualquer verdade | `apps/omni-ilha/cofre-ipc.js` | testes/ilha-cofre-ipc.test.mjs cada canal da janela chama a sua função da mão com os argumentos certos — `deepEqual` ("cofre:saude") |
| 4 | histórico sem o limite de 50 | `apps/omni-ilha/cofre-ipc.js` | testes/ilha-cofre-ipc.test.mjs cada canal da janela chama a sua função da mão com os argumentos certos — `deepEqual` ("cofre:historico") |
| 5 | histórico com o id cru | `apps/omni-ilha/cofre-ipc.js` | testes/ilha-cofre-ipc.test.mjs cada canal da janela chama a sua função da mão com os argumentos certos — `deepEqual` ("cofre:historico") |
| 6 | CRLF da área sem tirar | `apps/omni-ilha/cofre-ipc.js` | testes/ilha-cofre-ipc.test.mjs textoDaArea tira uma quebra do fim e recusa vazio e várias linhas, sem pôr o valor no erro — `deepEqual`<br>testes/ilha-cofre-ipc.test.mjs da área: lê no main, manda Buffer, zera, e limpa a área só no sucesso e só se ela não mudou — `deepEqual` |
| 7 | CR no meio aceito | `apps/omni-ilha/cofre-ipc.js` | testes/ilha-cofre-ipc.test.mjs textoDaArea tira uma quebra do fim e recusa vazio e várias linhas, sem pôr o valor no erro — `equal` (""a\rb"") |
| 8 | área vazia aceita | `apps/omni-ilha/cofre-ipc.js` | testes/ilha-cofre-ipc.test.mjs textoDaArea tira uma quebra do fim e recusa vazio e várias linhas, sem pôr o valor no erro — `equal` ("""")<br>testes/ilha-cofre-ipc.test.mjs da área: lê no main, manda Buffer, zera, e limpa a área só no sucesso e só se ela não mudou — `equal` |
| 9 | área limpa mesmo mudada | `apps/omni-ilha/cofre-ipc.js` | testes/ilha-cofre-ipc.test.mjs da área: lê no main, manda Buffer, zera, e limpa a área só no sucesso e só se ela não mudou — `equal` ("a área foi limpa depois de mudar") |
| 10 | área limpa na recusa | `apps/omni-ilha/cofre-ipc.js` | testes/ilha-cofre-ipc.test.mjs da área: lê no main, manda Buffer, zera, e limpa a área só no sucesso e só se ela não mudou — `equal` ("a área foi limpa numa recusa") |
| 11 | área nunca limpa | `apps/omni-ilha/cofre-ipc.js` | testes/ilha-cofre-ipc.test.mjs da área: lê no main, manda Buffer, zera, e limpa a área só no sucesso e só se ela não mudou — `equal` ("a área não foi limpa depois do sucesso") |
| 12 | Buffer do pedido sem zerar | `apps/omni-ilha/cofre-ipc.js` | testes/ilha-cofre-ipc.test.mjs cadastrar e rotacionar com o valor digitado mandam um Buffer UTF-8 e o zeram — `ok` ("o Buffer do cadastrar ficou com o valor")<br>testes/ilha-cofre-ipc.test.mjs da área: lê no main, manda Buffer, zera, e limpa a área só no sucesso e só se ela não mudou — `ok` ("o Buffer da área ficou com o valor") |
| 13 | revelado sem zerar | `apps/omni-ilha/cofre-ipc.js` | testes/ilha-cofre-ipc.test.mjs revelar devolve o texto com o prazo, zera o Buffer e repassa a recusa — `ok` ("o Buffer revelado ficou com o valor") |
| 14 | prazo de cinco minutos | `apps/omni-ilha/cofre-ipc.js` | testes/ilha-cofre-ipc.test.mjs revelar devolve o texto com o prazo, zera o Buffer e repassa a recusa — `equal` |
| 15 | revelado sem conferir o Buffer | `apps/omni-ilha/cofre-ipc.js` | testes/ilha-cofre-ipc.test.mjs revelar devolve o texto com o prazo, zera o Buffer e repassa a recusa — `deepEqual` |
| 16 | campos sem aparar | `apps/omni-ilha/cofre-ipc.js` | testes/ilha-cofre-ipc.test.mjs dadosDoCadastro leva só os campos do cadastrar, aparados, e os agentes em lista — `deepEqual`<br>testes/ilha-cofre-ipc.test.mjs cadastrar e rotacionar com o valor digitado mandam um Buffer UTF-8 e o zeram — `deepEqual` |
| 17 | campo vazio enviado | `apps/omni-ilha/cofre-ipc.js` | testes/ilha-cofre-ipc.test.mjs dadosDoCadastro leva só os campos do cadastrar, aparados, e os agentes em lista — `deepEqual`<br>testes/ilha-cofre-ipc.test.mjs cadastrar e rotacionar com o valor digitado mandam um Buffer UTF-8 e o zeram — `deepEqual`<br>testes/ilha-cofre-ipc.test.mjs da área: lê no main, manda Buffer, zera, e limpa a área só no sucesso e só se ela não mudou — `deepEqual` |
| 18 | agentes vazios enviados | `apps/omni-ilha/cofre-ipc.js` | testes/ilha-cofre-ipc.test.mjs dadosDoCadastro leva só os campos do cadastrar, aparados, e os agentes em lista — `deepEqual` |
| 19 | campos fora do cadastrar | `apps/omni-ilha/cofre-ipc.js` | testes/ilha-cofre-ipc.test.mjs dadosDoCadastro leva só os campos do cadastrar, aparados, e os agentes em lista — `deepEqual` |
| 20 | resumo com todos os alertas | `apps/omni-ilha/cofre-ipc.js` | testes/ilha-cofre-ipc.test.mjs o resumo da ilha conta os alertas e mostra só regra e nome dos três primeiros — `deepEqual` |
| 21 | resumo vaza os detalhes | `apps/omni-ilha/cofre-ipc.js` | testes/ilha-cofre-ipc.test.mjs o resumo da ilha conta os alertas e mostra só regra e nome dos três primeiros — `deepEqual` |
| 22 | resumo pede as duplicatas | `apps/omni-ilha/cofre-ipc.js` | testes/ilha-cofre-ipc.test.mjs o resumo da ilha conta os alertas e mostra só regra e nome dos três primeiros — `deepEqual` |
| 23 | restaurar com o id cru | `apps/omni-ilha/cofre-ipc.js` | testes/ilha-cofre-ipc.test.mjs cada canal da janela chama a sua função da mão com os argumentos certos — `deepEqual` ("cofre:restaurar") |
| 24 | valor digitado em latin1 | `apps/omni-ilha/cofre-ipc.js` | testes/ilha-cofre-ipc.test.mjs cadastrar e rotacionar com o valor digitado mandam um Buffer UTF-8 e o zeram — `deepEqual` |
| 25 | esvaziar só lista a lixeira | `apps/omni-ilha/cofre-ipc.js` | testes/ilha-cofre-ipc.test.mjs cada canal da janela chama a sua função da mão com os argumentos certos — `deepEqual` ("cofre:esvaziar") |

## Apêndice G: mutantes da T7

A tabela abaixo é a saída do `tabela-mutantes-p5.mjs` na rodada oficial da T7.

| # | Mutante | Arquivo | Teste que ficou vermelho — asserção |
|---|---|---|---|
| 1 | intervalo de 4 min | `apps/omni-ilha/cofre-card.js` | testes/ilha-cofre-card.test.mjs CC: os prazos são 5 min aberta e 1 min entre aberturas; o card mostra 2 linhas — `equal`<br>testes/ilha-cofre-card.test.mjs CC: aberta, o relógio relê só a cada 5 min — `equal` |
| 2 | piso de 30 s | `apps/omni-ilha/cofre-card.js` | testes/ilha-cofre-card.test.mjs CC: os prazos são 5 min aberta e 1 min entre aberturas; o card mostra 2 linhas — `equal`<br>testes/ilha-cofre-card.test.mjs CC: ao abrir, relê só depois de 1 min da última leitura — `equal` |
| 3 | três linhas | `apps/omni-ilha/cofre-card.js` | testes/ilha-cofre-card.test.mjs CC: os prazos são 5 min aberta e 1 min entre aberturas; o card mostra 2 linhas — `equal`<br>testes/ilha-cofre-card.test.mjs CC: vários alertas mostram só as 2 primeiras linhas, com o rótulo de cada regra — `deepEqual` |
| 4 | lê de novo durante a leitura | `apps/omni-ilha/cofre-card.js` | testes/ilha-cofre-card.test.mjs CC: lendo, nunca lê de novo, nem nunca lido — `equal` |
| 5 | nunca lido não lê | `apps/omni-ilha/cofre-card.js` | testes/ilha-cofre-card.test.mjs CC: nunca lido, lê pelos dois motivos — `equal` |
| 6 | relógio que voltou espera | `apps/omni-ilha/cofre-card.js` | testes/ilha-cofre-card.test.mjs CC: relógio que voltou ou leitura sem número relê em vez de esperar — `equal` |
| 7 | prazo estrito | `apps/omni-ilha/cofre-card.js` | testes/ilha-cofre-card.test.mjs CC: ao abrir, relê só depois de 1 min da última leitura — `equal`<br>testes/ilha-cofre-card.test.mjs CC: aberta, o relógio relê só a cada 5 min — `equal` |
| 8 | prazos trocados | `apps/omni-ilha/cofre-card.js` | testes/ilha-cofre-card.test.mjs CC: ao abrir, relê só depois de 1 min da última leitura — `equal`<br>testes/ilha-cofre-card.test.mjs CC: aberta, o relógio relê só a cada 5 min — `equal` |
| 9 | resposta sem ok vira leitura | `apps/omni-ilha/cofre-card.js` | testes/ilha-cofre-card.test.mjs CC: falha da mão vira estado de erro com o detalhe do código e o texto inteiro à parte — `deepEqual`<br>testes/ilha-cofre-card.test.mjs CC: código que o card não conhece, ou resposta nula, vira "sem leitura" — `equal` |
| 10 | erro sem o detalhe do código | `apps/omni-ilha/cofre-card.js` | testes/ilha-cofre-card.test.mjs CC: falha da mão vira estado de erro com o detalhe do código e o texto inteiro à parte — `deepEqual` |
| 11 | código desconhecido vazio | `apps/omni-ilha/cofre-card.js` | testes/ilha-cofre-card.test.mjs CC: código que o card não conhece, ou resposta nula, vira "sem leitura" — `equal` |
| 12 | erro sem o texto inteiro | `apps/omni-ilha/cofre-card.js` | testes/ilha-cofre-card.test.mjs CC: falha da mão vira estado de erro com o detalhe do código e o texto inteiro à parte — `deepEqual` |
| 13 | erro com zero no lugar do traço | `apps/omni-ilha/cofre-card.js` | testes/ilha-cofre-card.test.mjs CC: falha da mão vira estado de erro com o detalhe do código e o texto inteiro à parte — `deepEqual` |
| 14 | sem Node com outro texto | `apps/omni-ilha/cofre-card.js` | testes/ilha-cofre-card.test.mjs CC: falha da mão vira estado de erro com o detalhe do código e o texto inteiro à parte — `equal` |
| 15 | alerta só a partir de dois | `apps/omni-ilha/cofre-card.js` | testes/ilha-cofre-card.test.mjs CC: um alerta vira estado de alerta com a linha da regra — `deepEqual` |
| 16 | singular para zero também | `apps/omni-ilha/cofre-card.js` | testes/ilha-cofre-card.test.mjs CC: uma credencial vai no singular — `equal` |
| 17 | um alerta no plural | `apps/omni-ilha/cofre-card.js` | testes/ilha-cofre-card.test.mjs CC: um alerta vira estado de alerta com a linha da regra — `deepEqual` |
| 18 | sem alertas com outro texto | `apps/omni-ilha/cofre-card.js` | testes/ilha-cofre-card.test.mjs CC: sem alertas, o card mostra o total e "nada a olhar" — `deepEqual` |
| 19 | regra sem rótulo | `apps/omni-ilha/cofre-card.js` | testes/ilha-cofre-card.test.mjs CC: vários alertas mostram só as 2 primeiras linhas, com o rótulo de cada regra — `deepEqual` |
| 20 | regra desconhecida some | `apps/omni-ilha/cofre-card.js` | testes/ilha-cofre-card.test.mjs CC: regra que o card não conhece passa crua — `deepEqual` |
