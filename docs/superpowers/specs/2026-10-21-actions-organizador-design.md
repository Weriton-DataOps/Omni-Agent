# Actions: organizador vivo — design

Data: 21/10/2026 · Aprovado por: Weriton (sessão do PC, 21/10/2026)

## Problema

O Actions (`%USERPROFILE%\Documents\Actions\`) é um depósito de pontos: um `.md` por assunto. Em 21/10 tinha 11 pontos. Seis estavam parados em "capturado", quatro bloqueados nele e um ativo. Nenhum ponto tinha saída definida, então as ideias morriam por falta de um próximo passo pequeno e testável e de um veredito.

## Objetivo

Transformar o Actions num organizador em que:

- toda ideia anda até um veredito, com prazo;
- as ideias se ligam aos projetos reais do Weriton ou abrem projetos novos;
- os projetos têm entregas com data e checklist;
- o Omni visita o espaço todo dia, cruza, testa e cobra, sem precisar ser lembrado.

Nomes: "Actions" e "visita". Nunca "ateliê", que é o nome do agente de design dele.

## 1. As duas metades

| Metade | Onde | O que guarda |
|---|---|---|
| Ideias | `Actions\pontos\<slug>.md` (+ `pontos\<slug>\` para material) | os pontos, como hoje, com os campos novos da seção 2 |
| Projetos | `Actions\projetos.md` (novo) | um bloco por projeto: fase, dor do momento, entregas datadas, checklist, ideias ligadas |

O Omni não mora no Actions. Ele visita (seção 4).

## 2. Ciclo de um ponto

Estágios: **Semente → Em teste → Veredito**.

Vereditos possíveis:

- **vira projeto**: ganha bloco no `projetos.md` e, quando fizer sentido, pasta e repositório próprios;
- **entra em projeto**: vira item do checklist do projeto escolhido;
- **arquivado**: exige motivo e a evidência do teste que o matou;
- **dormente**: exige data de revisita.

Campos novos no cabeçalho do ponto. Eles se somam ao modelo atual (Status / Aberto em / Origem / Material / Contexto / Instruções / Histórico):

```
Estágio: semente | em teste | veredito
Prazo do veredito: dd/mm/aaaa
Próximo passo: <ação pequena e testável>
Potencial: ▲ | ▲▲ | ▲▲▲ — <motivo em uma linha>
Projeto ligado: <nome no projetos.md> | novo | —
Veredito: vira projeto | entra em <projeto> | arquivado | dormente até dd/mm/aaaa — <motivo>
```

Regras:

- **Prazo de 14 dias** a partir de "Aberto em". Vencido o prazo sem veredito, a visita é obrigada a levar ao Weriton uma proposta de veredito com o motivo. A proposta fica no PRA VOCÊ até ele decidir.
- **Pontos já existentes**: o prazo de 14 dias conta a partir do dia em que o sistema ligar.
- **Propostas de veredito**: no máximo 2 por dia.
- **Arquivado pode ressuscitar**: se um projeto mudar e reabrir a chance de um ponto arquivado, a visita o reabre como Semente e registra o porquê no Histórico.
- **Potencial** é a soma de três critérios:
  - evidência: um teste rodou e deu certo;
  - encaixe: serve à dor do momento de um projeto ou abre um projeto novo;
  - custo do próximo passo: quanto mais barato, mais pontos.

  O motivo acompanha a nota. ▲▲▲ sem nenhum teste é proibido.
- O Histórico continua só de acréscimo e datado.

## 3. Projetos (`projetos.md`)

Formato de cada bloco:

```
## <Nome do projeto>
Fase: <texto curto>
Dor do momento: <texto curto>
Plano de origem: <caminho do plano próprio> | —
Entregas:
- [ ] <entrega> — dd/mm/aaaa
- [x] <entrega> — dd/mm/aaaa
Ideias ligadas: <slug> (▲▲), …
```

Lista inicial: Reengenharia/Station, bot vendedora, Omni, Gaia, Michael, Overcore, agent-skills-hub e o site do Barretos Country.

Regras:

- **Fonte da verdade.**
  - Projeto com plano próprio, como a Reengenharia/Station, é **espelhado**. O card lê o plano de origem e mostra a origem, e marcar um item grava no plano de origem. Nunca existem duas listas do mesmo projeto.
  - Projeto sem plano próprio mora só no `projetos.md`.
- **Itens e datas novos** são propostos pelo Omni a partir dos repositórios e da memória. Só entram com o ✓ do Weriton. Editar o arquivo à mão também vale.
- **Alertas.**
  - Entrega a 7 dias ou menos ganha ⚠.
  - Entrega vencida sobe para o PRA VOCÊ.
  - Projeto sem nenhuma entrega datada ganha ⚠.
- **Ponto com o veredito "entra em projeto"** vira item do checklist daquele projeto e aparece em "Ideias ligadas".

## 4. A visita

- **Gatilhos**:
  - visita fixa às **7h**, por tarefa agendada do Windows. Se o PC estiver desligado, roda assim que ele ligar ("executar assim que possível");
  - visita extra no mesmo dia quando entra ponto novo.
- **Execução**: a tarefa abre uma sessão do Claude Code sem janela. Todo processo filho também é escondido (windowsHide). Isso evita repetir o episódio das 284 janelas de CMD.
- **Teto**: cerca de 30 minutos e poucos pontos por visita. Uma visita só por vez (trava de arquivo).
- **Roteiro**:
  1. ler o `projetos.md` e os pontos;
  2. cruzar ideias com projetos;
  3. testar o que estiver liberado (seção 5);
  4. atualizar Estágio, Potencial e Próximo passo;
  5. propor vereditos vencidos;
  6. escrever no Histórico de cada ponto mexido;
  7. atualizar o estado que a ilha lê;
  8. falar no WhatsApp só se houver risco ou decisão madura.
- **Registro**: cada visita grava um arquivo curto em `Actions\visitas\AAAA-MM-DD-HHMM.md`, com o que viu, o que testou e o que propôs. É desse registro que sai a seção "Última visita" da tela.

## 5. Limites de autonomia

| | O que entra |
|---|---|
| Sozinho | código próprio na bancada, pesquisa, cruzamento de ideias, branch local em repositório do Weriton (sem push) |
| Pergunta antes, pelo WhatsApp | código de terceiro (install, clone e rodar, pip/npm) e qualquer coisa paga |
| Nunca, nem com aprovação | push ou publicação, produção HostDime, ler ou usar credencial |

**Quantidade:** no máximo um pedido de risco por visita.

**Conteúdo do pedido de risco** (mensagem no WhatsApp):
- o que é: repositório e commit;
- o que vai rodar;
- o que pode tocar;
- o nível de risco.

A mensagem termina com "👍 roda / 👎 não / ❓ explica / responda pra outra coisa".

## 6. Avisos

**Ilha**
- O card Actions mostra "N pra você" e só acende quando há decisão pendente: veredito vencido, teste pronto ou entrega vencida.
- A cara dá uma olhada para o card quando o número sobe, só com a ilha aberta. **Com a ilha fechada, nada sinaliza** (pedido dele, 21/10).
- Datas em dd/mm/aaaa, o formato da casa.
- Ponto que andou sozinho não acende nada.

**WhatsApp**
- Usado só para risco e decisão madura.
- No máximo cerca de 2 toques por dia. Pedido de risco não conta nesse teto.
- A maioria das visitas termina em silêncio.

**Aprovação por reação** na mensagem de risco:

| Reação | Efeito |
|---|---|
| 👍 | roda |
| 👎 | não roda |
| ❓ | o Omni manda o detalhe e espera nova reação |
| resposta em texto citando a mensagem | "outra resposta": o Omni lê e segue |

Validade:
- só vale vindo do 6601;
- só vale naquele id de mensagem;
- vale uma vez;
- expira em poucas horas;
- cobre só o commit e o comando descritos. Se o código mudar, é preciso um pedido novo.

Mudanças na reação:
- reação retirada antes do início cancela;
- reação trocada vale a última;
- emoji fora da tabela não autoriza nada.

Requisito técnico: hoje o motor já recebe o `reactionMessage` (`servicos/whatsapp/src/engine/adapters/baileys-events.ts`, por volta da linha 466). Falta a ponte do Omni (`servicos/whatsapp/omni/ponte.mjs`) encaminhar esse evento ao registro de aprovações. Botões interativos não funcionam no número do bot, e o voto em enquete não é decifrado, por isso a escolha foi a reação.

## 7. A tela (janela Actions da ilha)

Duas abas.

**Ideias**, de cima para baixo:
1. **PRA VOCÊ (N)**: vereditos vencidos com a proposta e os botões [vira projeto] [entra em…] [arquiva] [dorme], testes prontos para olhar e entregas vencidas. Os botões gravam no ponto (Veredito + Histórico).
2. **Com potencial**: pontos ordenados por ▲, cada um com o motivo e o projeto ligado.
3. **Em andamento**: Semente, Em teste e Dormente, com idade, próximo passo e projeto.
4. **Não deram certo**: arquivados, com data, motivo e link para a evidência.
5. **Última visita**: hora e resumo do registro mais recente.

**Projetos**
- Um card por projeto: nome, próximo marco e quantos dias faltam.
- Checklist clicável: marca no `projetos.md` ou no plano de origem, conforme a seção 3.
- Entregas com data e ⚠.
- Ideias ligadas, com o ▲ de cada uma.

Clicar num ponto abre o detalhe renderizado, como hoje.

**Escrita**: a janela deixa de ser só leitura. Toda escrita passa pelo main do Electron, que:
- valida o caminho, aceitando só arquivos dentro de `Actions\` ou de um plano de origem listado;
- grava de forma atômica (arquivo temporário e depois renomeia);
- acrescenta ao Histórico.

O renderer não escreve em disco.

## 8. Erros

- Visita que estoura o teto de tempo é encerrada e registra "interrompida" no registro da visita.
- Ponto com cabeçalho ilegível não é reescrito. A visita marca o problema no registro e mostra o ponto no PRA VOCÊ como "precisa de conserto".
- Escrita concorrente (visita e clique ao mesmo tempo): trava de arquivo. Quem perde tenta de novo uma vez e, se falhar, avisa na tela.
- WhatsApp fora do ar: o pedido de risco fica pendente, e nada de terceiro roda sem aprovação.
- Plano de origem que sumiu ou mudou de formato: o card mostra o aviso e não grava.

## 9. Testes

- **Bancada escondida da ilha** (molde atual: `OMNI_ILHA_ESCONDIDA`, `OMNI_ILHA_TESTE`), cobrindo:
  - abrir as duas abas;
  - clicar em ☐ e conferir a gravação no arquivo;
  - clicar num botão de veredito e conferir Veredito e Histórico;
  - card aceso com N certo;
  - ⚠ nas datas.
- **Roteamento de reação**: nenhum destes casos autoriza:
  - número errado;
  - mensagem errada;
  - reação repetida;
  - reação expirada;
  - emoji fora da tabela;
  - commit diferente;
  - reação retirada.

  Casos que devem funcionar: 👍 válido autoriza uma vez, e a troca de reação vale a última.
- **Visita a seco** sobre uma cópia de `Actions\`, verificando que:
  - o Histórico ganha entradas e nada anterior muda;
  - o registro da visita é criado;
  - o limite de 2 propostas por dia é respeitado;
  - nenhum processo com janela é criado.
- Todo teste só conta depois de lido o nome, a saída e o total (metodologia "verde e prova").

## 10. Ordem de construção

Cada etapa entrega algo usável sozinha:

1. Formato novo dos pontos e o `projetos.md`, com migração dos 11 pontos para os campos novos e a lista inicial de projetos.
2. A tela: as duas abas, os botões e a escrita pelo main.
3. A visita: a tarefa agendada, a sessão escondida, o roteiro e o registro.
4. Aprovação por reação no WhatsApp: roteamento do `reactionMessage` na ponte e o registro de aprovações.

## Fora do escopo

- Push, publicação ou deploy feitos pela visita.
- Varrer o disco inteiro em cada visita. A visita lê o `projetos.md` e os planos de origem listados.
- Botões interativos ou enquetes no WhatsApp.
