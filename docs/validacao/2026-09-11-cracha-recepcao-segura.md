# Crachá: recepção privada, teste e registro

O Crachá é o catálogo de identidades, acessos e concessões do Omni. Esta tela cuida
da entrada de credenciais usadas pelo Omni; cadastrar uma conexão não concede
automaticamente permissão para publicar, alterar dados ou delegar o segredo.
O PostgreSQL guarda referências, escopo, versão, validade e observações. O valor
reutilizável permanece no Gerenciador de Credenciais do Windows.

## Fluxo da interface

1. O proprietário informa um acesso no campo visível, para revisar antes de enviar. Não há envio ao Claude.
2. Ao enviar, o campo é limpo. A conversa recebe somente a indicação de dados
   recebidos; o texto original não é reproduzido nem submetido ao histórico.
3. O processo principal interpreta os dados localmente, procura o cadastro e
   retorna um identificador temporário com projeção sem segredo.
4. A interface mostra o teste em andamento e o resultado real. Dados incompletos,
   erro de rede ou conector indisponível não habilitam o armazenamento.
5. Após sucesso, “Guardar no Crachá” / “Atualizar acesso” aciona a fronteira confiável,
   que verifica novamente antes de escrever. A revisão esperada protege contra
   atualização concorrente; uma credencial idêntica pode reutilizar sua versão.
6. O resultado devolve versão, estado e instante da conferência. O valor não volta
   à interface. Fechar, limpar, ocultar ou expirar a sessão descarta os dados pendentes.

## Proteções e limites

- A tela tem layout próprio vertical, sem herdar o flex horizontal das configurações
  de áudio. A conversa rola verticalmente e mantém a posição de leitura.
- Dados brutos não entram em `Store`, snapshots, memória, chamadas de modelo, logs,
  argumentos de processo, testes visuais ou relatórios.
- O campo permanece visível por preferência do proprietário; a aplicação não grava
  seu conteúdo nos logs nem guarda a conversa do Crachá.
  Strings em memória de processos gerenciados não têm apagamento físico garantido.
- Rascunhos no processo principal expiram em dez minutos. Chamadas atrasadas de uma
  sessão fechada não podem reabrir o rascunho nem liberar o botão de salvar.
- Ausência de data significa validade desconhecida. Prazo relativo informado pelo
  proprietário tem origem declarada, não prova de expiração obtida no provedor.
- Um teste de autenticação não comprova autorização para todas as operações.
- Tipos sem conector de autenticação implementado ficam claramente pendentes;
  interpretar um PEM ou abrir uma porta não é prova de login.

## Verificação

As suítes `credential-parser` e `credential-intake` usam dados sintéticos e cobrem
privacidade da projeção, bloqueio de gravação sem teste, validade, escopo, descarte
e concorrência. `scripts/credential-smoke.mjs` usa renderer/preload reais com um
processo principal isolado e respostas simuladas, sem acessar cofre nem provedores.
Ele mede o empilhamento vertical e limites de largura e verifica falha/sucesso,
cadastro existente, fechamento e ausência de segredo no histórico.

O teste visual é distinto de autenticação real. A verificação de uma credencial
existente usa somente `verifyStoredCredential(id)` no broker; a saída é metadado
e resultado sanitizado, nunca o conteúdo do cofre.

Resultado em 11/09/2026: build e arquitetura aprovadas; 47 testes Desktop e 27
verificações sintéticas do broker passaram. Teste visual inspecionado em 1320×850
e 960×700. Criação, reutilização e atualização de vencimento verificadas no
PostgreSQL com rollback integral (zero credenciais/eventos de teste persistidos).
Broker reiniciado e saudável; Desktop reiniciado às 08:53:43, horário local.

Conectores de teste implementados: identidade autenticada Vercel/GitHub, consulta
PostgreSQL somente leitura com autenticação por senha exigida, e logon de rede AD.
MySQL, SQL Server, login genérico e certificados ainda não têm verificadores neste
corte; ficam impedidos de armazenamento, com resultado explícito de não suportado.

O teste do token Vercel existente **não foi executado**: a revisão automática de
permissões bloqueou o envio ao endpoint oficial por exigir autorização explícita
da credencial/destino. Não há prova de autenticação desse token nesta entrega.
