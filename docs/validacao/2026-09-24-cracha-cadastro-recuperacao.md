# Crachá: cadastro e recuperação sem reenviar acesso

## Falha corrigida

O anexo privado dependia de memória temporária com expiração. Receber o anexo não criava cadastro durável, e o planejamento não recuperava o inventário cadastrado quando a nova mensagem vinha sem anexo. Assim, o relato de que os acessos estavam guardados não era evidência de gravação, e a execução podia ficar sem a fonte privada.

## Mudança aplicada

- Antes do recibo de recebimento, o texto privado é persistido com DPAPI CurrentUser; nenhuma cópia em texto claro é gravada. A confirmação falha se a proteção ou a gravação falhar.
- Contexto não cadastrado sobrevive ao reinício por até 30 dias. Ocultar/fechar o Desktop limpa buffers temporários, não os arquivos protegidos. Remover explicitamente o anexo descarta esse contexto; não revoga cadastros já existentes.
- Pedido de guardar ou usar, interpretado no plano semântico, cadastra sem exigir teste de conexão. O pedido expresso de uso temporário pode escolher `persist: false`. Cadastro recebe estado não validado; não se declara conexão a partir dele.
- Senhas cadastradas ficam no Gerenciador de Credenciais do Windows. PostgreSQL mantém metadados e referências. O contexto protegido passa a conter apenas referências e vínculos após o cadastro completo.
- Componentes SSH/PostgreSQL têm identificadores estáveis por anexo. Falha parcial preserva o original protegido e permite completar o componente faltante após reinício, sem duplicar o já confirmado.
- O coordenador recebe as fontes disponíveis e o estado da consulta de inventário. Um acesso cadastrado pode ser selecionado sem novo anexo. Vínculos são mantidos no mesmo projeto; a credencial interna do broker do Omni não é oferecida como credencial de tarefa.
- O Controller confirma cadastro e prepara a capacidade limitada antes de delegar. O executor recebe referência temporária, nunca a senha. Revogação, versão e expiração são conferidas antes do uso.
- O relato de falta de adaptador distingue cadastro de conexão: não nega um cadastro que já recebeu recibo.

## Provas executadas

`npm.cmd test` no desktop: **250 testes aprovados**, zero falhas ou testes ignorados. `npm.cmd run build`: tipos e bundles aprovados. Integridade do núcleo **0.24.1: verified**; não houve alteração do núcleo nesta correção.

Build final `a9f1db3a04e9`: o recibo de atualização automática registrou aplicação em **24/09/2026 12:46:38 UTC (09:46:38 local)**. A impressão digital do recibo coincide com os arquivos compilados; o processo principal do Omni foi reaberto nesse horário (PID 31376). Não houve encerramento forçado de sessões do proprietário.

`node scripts/private-context-smoke.mjs`: DPAPI real em **dois processos Electron separados**. O primeiro recebe/grava e encerra; o segundo restaura o contexto. Resultados: `encrypted: true`, `restored: true`, `secretInPublicMetadata: false`, `vaultOrNetworkCalls: 0`. Credenciais exclusivamente fictícias; fixtures removidas pelo próprio teste.

`node scripts/document-ui.mjs --private-context`: prova da interface Electron aprovada. Crachá → envio → IPC → contexto por mensagem → recibo. Valores privados ausentes do chat, prompt e histórico; próximo rascunho preservado; falha de anexo não apaga a mensagem. Artefatos desta execução em `apps/omni-desktop/out/document-ui-sqlkJk`.

`tests/private-persistence.test.ts` cobre:

1. Cadastro do par sem teste de conexão, recuperação após recriar intake, remoção do texto original após cadastro e ausência de duplicação.
2. Cadastro parcial retomado após reinício.
3. Falha de criptografia sem falso recibo e chave errada sem falso inventário vazio.
4. Rollback de envio preservando o próximo rascunho.
5. Seleção de cadastro PostgreSQL preexistente por referência, sem novo anexo, excluindo infraestrutura interna.
6. **Controller real e ponte real, broker simulado:** cadastrar, preparar capacidade, usar somente referências, encerrar, reabrir e executar novamente sem reenviar o anexo. Dois componentes cadastrados uma vez cada; zero testes de conexão; duas chamadas ao broker simulado. Segredos ausentes de Store e briefing.

O planejador real foi executado em `scripts/eval-private-intent.ts`, sem ferramentas de execução e com credenciais/portas simuladas. Os quatro casos passaram:

- Executar leitura T1.1.1 e não DW.2–DW.6 → delegação com uso, catálogo e freshness.
- Explicar sem conectar/testar/guardar → resposta, nenhuma execução.
- Confirmação contextual após anexo anterior → delegação usando a fonte anterior.
- Usar acesso já cadastrado sem novo anexo → delegação usando a referência cadastrada.

Essas são observações do modelo, não garantia de acerto universal. Os testes do runtime verificam as fronteiras independentemente da resposta probabilística.

## Limite factual

Não houve conexão com o servidor .7/PG7 do proprietário nesta validação. Os acessos antigos não encontrados no inventário nem no contexto persistido não podem ser reconstruídos: a versão anterior os descartava. A correção preserva os novos recebimentos e recupera cadastros existentes; não inventa uma senha ausente. Operações remotas continuam limitadas a catálogo e atualização por coluna temporal, sem SQL livre ou escrita DW.2–DW.6.
