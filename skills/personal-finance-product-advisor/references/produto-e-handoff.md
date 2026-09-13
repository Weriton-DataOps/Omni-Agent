# Produto financeiro e handoff para codigo

O aplicativo financeiro e um produto separado do Omni. A skill o ajuda a nascer bem, mas nao decide
infraestrutura final, banco ou integracao bancaria antes de haver necessidade comprovada.

## Briefing minimo para implementacao

Antes de delegar codigo, produza um briefing objetivo com:

- problema e resultado desejado para o usuario;
- escopo desta entrega e nao-objetivos;
- fluxos de usuario e estados de erro;
- entidades, campos e relacoes necessarios;
- regras que precisam ser deterministicas, incluindo arredondamento, moeda e datas;
- origem de cada dado e classificacao de sensibilidade;
- autorizacoes necessarias e operacoes proibidas;
- criterios de aceite verificaveis e Definition of Done.

Se uma dessas lacunas impedir uma implementacao segura, pergunte apenas o que muda o desenho. Nao
trave uma primeira versao por uma escolha de infraestrutura futura: comece com importacao/manual e
contratos portaveis; banco remoto, celular e Open Finance sao expansoes posteriores.

## Regras de arquitetura

- O LLM interpreta linguagem e orquestra; calculos, saldos e consolidacoes pertencem a codigo
  deterministico auditavel.
- Separe dados financeiros transacionais de memoria conversacional. Conversa pode explicar uma
  decisao; nao deve ser a fonte contabil de saldo ou patrimonio.
- Interfaces nunca acessam o banco diretamente quando o produto ganhar web ou celular: use uma API
  autenticada com autorizacao por proprietario.
- Importacoes devem ser idempotentes, rastreaveis e reversiveis. Nunca registre como transacao um
  valor que o parser nao conseguiu classificar com confianca.
- Segredos e dados bancarios nao entram em logs, fixtures, screenshots, prompts de agentes ou Git.

## Entrega ao agente de codigo

O prompt de delegacao deve conter somente o briefing e dados sinteticos necessarios para testar.
Exija testes para calculos e regras de negocio, migracao reversivel quando houver banco e um relatorio
que diferencie o que foi implementado, validado e ainda depende de decisao do proprietario.
