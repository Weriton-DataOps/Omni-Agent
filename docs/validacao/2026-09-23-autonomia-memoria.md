# Validação de autonomia, comunicação e memória — 23/09/2026

## Resultado

Correções implementadas e carregadas no Omni Desktop local. O atualizador, já habilitado pelo proprietário, registrou a build `e36ebcbdc15b` às 08:46:36 (America/Sao_Paulo); os processos do Desktop reiniciaram às 08:46:37. Não houve publicação de projetos, mudança de permissões do executor ou reenvio de demandas antigas.

## Causas verificadas e correções

| Falha | Correção | Evidência |
| --- | --- | --- |
| O coordenador usava o início do próprio template como consulta de memória e podia aprender briefings sintéticos como declarações do proprietário. | Captura da mensagem integral uma vez por turno; consultas internas usam o objetivo real e não produzem novas memórias do proprietário. Recibo de gravação vinculado ao turno. | Testes do coordenador e do hook, incluindo mensagem posterior na fila e não contaminação por texto sintético. |
| Caminhos de projeto inválidos como identificadores interrompiam a sincronização durável. | Identificador canônico estável, com o caminho original preservado no conteúdo; falhas individuais ficam pendentes e não impedem os demais registros. Recibos locais evitam reimportações desnecessárias. | Sincronização real com 60 registros, zero falhas e zero pendências; consulta SQL independente encontrou os mesmos 60 IDs. |
| Preferências recentes perdiam lugar para memórias antigas frequentemente recuperadas; o contador marcava como usadas memórias cortadas pelo orçamento. | Priorização limitada das diretrizes explícitas atuais de comunicação e condução; orçamento rápido ajustado; contabilização apenas dos IDs efetivamente incluídos. | As duas diretrizes novas aparecem integralmente em duas projeções reais do contexto rápido. Testes comprovam que preferências alheias não são fixadas e que escopos Windows equivalentes são reconhecidos sem misturar projetos homônimos. |
| Um relato de recusa de publicação era tratado como prova de que a publicação fora tentada naquela rodada. | Evidência estruturada das ferramentas por pedido; distinção entre consulta, publicação, erro e negativa. Divergência devolve conferência somente leitura ao mesmo executor, sem pedir ao proprietário que investigue. | Reprodução local da rodada real do Tracking: 9 chamadas, nenhuma publicação; decisão `retry`, `needsOwner=false`. |
| Um bloqueio técnico podia virar decisão do proprietário sem tentativa de solução. | Recuperação técnica limitada dentro do escopo, com supervisão e evidências. Negativa de permissão não é contornada; repetição tem limite. | Teste automatizado e avaliação com modelo real usando somente caso fictício: investigação/correção delegada, sem decisão desnecessária. |
| Resumos repetiam histórico e listas de não-ações, com limites rígidos em algumas respostas. | Conclusão, causa e encaminhamento primeiro; detalhes quando necessários, importantes ou solicitados. Sem corte rígido do texto final, metáfora obrigatória ou oferta automática de nova tarefa ao concluir. | Teste de resposta longa sem truncamento; avaliação fictícia real produziu resumo de 322 caracteres, com resultado, evidência e ausência de pendência. |

## Memória: comprovação e distinções

- PostgreSQL real: banco `omni`, porta local 5433; leitura de conferência em modo somente leitura, sem exibir senha.
- Conjunto ativo local: **52 memórias confirmadas e 8 candidatas**. Todas as 60 existem no PostgreSQL. Candidata persistida não equivale a fato confirmado.
- Diretrizes registradas a partir do pedido real: comunicação curta por padrão sem proibir detalhes; condução da solução com delegação, conferência e decisões indispensáveis.
- IDs dessas diretrizes: `mem-413537d7-4f1a-41f6-bcc1-0046b53a4004` e `mem-aa749161-7410-4407-8730-061b6983217a`.
- A recuperação operacional atual lê o cache local persistente. O PostgreSQL mantém a cópia durável. Esta validação comprovou persistência SQL **e** inclusão no contexto; não afirma que toda resposta consulta diretamente o PostgreSQL.
- O inventário histórico tinha duplicações: inicialmente 256 linhas e 52 textos distintos. A contagem bruta de linhas não mede inteligência nem uso. Nenhum histórico foi apagado para melhorar esses números.
- Sincronização pendente não é mais apresentada como sucesso; o contexto do coordenador recebe o recibo factual correspondente à mensagem.

## Verificações executadas

Na raiz:

```powershell
node --test testes/memoria-coordenador.test.mjs testes/sincronizacao-memoria-duravel.test.mjs testes/recuperacao.test.mjs
node node_modules/typescript/bin/tsc -p tsconfig.json
node scripts/validate-omni-memory.mjs --live
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/read-omni-database.ps1 -ActiveMemory
```

Resultado final: **12 testes focados aprovados**, compilação sem erros, sincronização de 60/60 e ambas as diretrizes presentes nas duas consultas de contexto. O script `--live` reutiliza as diretrizes já cadastradas; não insere dados fictícios.

Em `apps/omni-desktop`:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
node scripts/validate-resolution.mjs
node scripts/validate-synthetic-resolution.mjs
```

Resultado: **211/211 testes do Desktop**, build concluída, reprodução local do caso real e avaliação de comportamento com casos fictícios aprovadas. Também passaram as suítes de hook, memória, manutenção, recuperação, personalidade e compilação TypeScript executadas durante a implementação.

## Limites da prova

A reprodução da sessão real foi estritamente local, sem enviar seu histórico a um modelo externo, sem despachar mensagens e sem executar comandos do projeto. A avaliação com modelo utilizou uma história inteiramente fictícia e sem ferramentas de execução. Não se simulou uma publicação bem-sucedida nem se alterou a permissão do Claude: uma negativa real continua sendo um bloqueio que deve ser explicado com causa e encaminhamento concreto.

Essas verificações comprovam os fluxos descritos; não são uma promessa de que todo futuro relato de um modelo estará correto. O supervisor agora possui verificação adicional e recuperação delimitada, em vez de depender apenas do texto do executor.
