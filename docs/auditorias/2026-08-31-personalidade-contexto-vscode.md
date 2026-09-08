# Auditoria de 31/08/2026 — personalidade, contexto e incidente Hub

## Veredito

A falha de hoje não foi uma única pane. Três contratos se combinaram:

1. a ativação persistia por sessão, não entre sessões novas;
2. o hook entregava a v3, mas cortava memória, projeto e continuidade no limite de 9.500 caracteres;
3. uma instrução antiga e explicitamente não testada prevaleceu sobre o pedido literal de abrir o Hub
   no VS Code.

A fonte 0.22.1 foi corrigida e passou pelos gates locais. Ela ainda não foi publicada, instalada nem
comprovada como carregada pelo host; as sessões auditadas continuavam executando a 0.22.0.

## Escopo desde sexta-feira

Janela auditada: 28/08/2026 a 31/08/2026.

- seis commits chegaram ao `main` entre sexta e sábado;
- não houve commit no domingo ou na segunda antes desta auditoria;
- a 0.22.1 local era uma transação interrompida, com arquivos modificados e uma alegação prematura de
  gates/readback instalado;
- não houve auditoria manual registrada no período, mas 44 varreduras automáticas haviam sido
  executadas pelos hooks. Portanto, houve coleta automática sem o fechamento humano desta rodada.

## Evidência do incidente Hub

O pedido literal apontava para `C:\hub-wp`. A execução:

- substituiu o alvo por outro workspace sem autorização;
- abriu terminal externo apesar de a memória consultada dizer que esse caminho era não testado e não
  correspondia ao VS Code;
- tentou executar prompt como PowerShell, encontrou CLI fora do `PATH` e caiu em fluxo de primeiro uso;
- inferiu incorretamente o estado da janela por `MainWindowTitle`;
- só depois usou `code.cmd --status`, que mostrou que o workspace já estava aberto;
- precisou da intervenção do proprietário para abrir o Claude e concluir a sessão.

O resultado exigido só foi alcançado depois dessa intervenção. Logo, a primeira alegação de execução
não possuía readback suficiente.

## Causa comprovada da perda de personalidade/contexto

Nos anexos de contexto da sessão real:

- 40 continham a personalidade v3;
- 35 de 40 foram truncados (87,5%);
- 33 dos 35 truncados já não continham nem o rótulo de contexto recuperado;
- o adaptador textual continuava presente, criando um falso verde: a persona parecia entregue, mas o
  estado relevante havia sumido.

O runtime concatenava núcleo completo, ajustes, auditorias e projeção e aplicava `slice` bruto. Como a
projeção vinha por último, era o primeiro bloco material a desaparecer. A memória persistente local já
continha o procedimento correto de cockpit e era selecionada pela recuperação; ela não chegou ao
modelo no turno do incidente.

## Correções aplicadas na fonte

- ativação opt-in persistente por hash do `cwd`, sem guardar caminho bruto;
- reativação no `SessionStart` para `startup`, `clear`, `resume` e `compact`, com fallback no primeiro
  `UserPromptSubmit`;
- sidechains, subagentes, executores e outros cwd permanecem neutros;
- sessões já explicitamente ativadas migram para o escopo persistente quando voltam a apresentar cwd;
- persona completa na ativação/retomada e âncora compacta nos turnos comuns;
- reserva estrutural do contexto recuperado antes de truncar blocos auxiliares;
- projeção rápida durante briefing obrigatório de automação, evitando o produto explosivo de dois
  payloads grandes;
- regras aprendidas ganham precedência, e procedimentos entram apenas quando relevantes à intenção;
- regra de alta severidade para correção explícita/CAIXA ALTA;
- procedimento VS Code que preserva alvo literal, proíbe terminal externo, valida `code.cmd` apenas
  para resolver `Code.exe` + `cli.js`, executa `--status` sem shell e separa janela, painel, sessão
  visível e briefing entregue;
- caso canônico de eval para executar a próxima ação segura em vez de encerrar com oferta genérica;
- texto pré-gates da release não antecipa publicação, instalação ou readback.

## Verificação

- gates locais de contratos, arquitetura, typecheck, pacote e sintaxe passaram no snapshot integrado;
- regressões focadas de personalidade/contexto, abertura do Hub, release operacional e integridade
  passaram sem executar GUI real;
- o teste de concorrência confirma duas chaves preservadas e impede regressão da mesma chave por CAS;
- o E2E local executa o hook de uma cópia instalada com integridade real e só então chega a
  `loaded-verified`;
- não se registra aqui total global de testes nem fingerprint final: ambos pertencem à rodada integrada
  de fechamento, depois do último build.

Não há base para classificar `EPERM` como flake. Contenção de arquivo no Windows é tratada como cenário
operacional pelo lock compartilhado, com token, retry, stale recovery e CAS; qualquer nova ocorrência
precisa de evidência própria.

## Limite da prova

Esta rodada prova a fonte, seus contratos locais e o carregamento a partir de uma cópia instalada de
teste. Não prova que a sessão Claude real carregou a 0.22.1. A próxima transação externa deve
publicar/instalar o fingerprint exato, recarregar o host e obter handshake do hook carregado, conforme o
[backlog de TypeScript, contexto e personalidade](../backlog/typescript-e-personalidade.md).
