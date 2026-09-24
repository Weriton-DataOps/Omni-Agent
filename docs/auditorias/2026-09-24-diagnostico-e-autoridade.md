# Diagnóstico atual e pedidos de autoridade — 0.24.4

## Evidência que motivou a correção

A conversa carregou 0.24.3, mas repetiu uma falha histórica da inspeção como
diagnóstico atual e afirmou que quatro jobs exigiam autorização sem recuperar
seus motivos. Os registros continham hashes, insuficientes para explicar um
pedido ao proprietário. A consulta `estado` sincronizava a fila; um pipeline
com `node -e` era classificado automaticamente como mutação.

## Correções

- `diagnostico --sessao ID` é somente leitura: separa identidade do operador,
  última observação do hook daquela sessão e capacidades do processo Overcore.
  Não cria stores, não migra, não despacha, não consulta modelo pago. Uma
  observação antiga do hook não é confirmação de recarga presente.
- `estado` e `falhas` deixam de sincronizar a automação de falhas. `estado`
  continua sendo um agregado legado com manutenção de outros caches; para uma
  consulta estritamente sem escrita, usar `diagnostico`.
- O Overcore expõe GET autenticado `/v1/capabilities`. Capacidade presente não
  transforma tarefa antiga em sucesso. Endpoint indisponível significa
  desconhecido, não regressão comprovada. A prova de não mutação permanece
  limitada às entradas diretas e telemetria, não monitoramento contínuo.
- `needs-owner` exige recibo local com efeito, alvo, limite, razão e evidência
  auditada da tentativa. O store portável guarda hashes; detalhes privados
  ficam em `runtime/failure-authority`, fora do Git e da memória exportável.
- Registros legados sem recibo voltam uma vez para diagnóstico de leitura.
  Contadores e hashes anteriores são preservados. Não liberam efeitos
  históricos, não contam como correção concluída e não ganham testes fictícios.
  O store migra de v4 para v5 com backup e preservação de jobs/bindings. Um
  hook antigo não pode assumir esses jobs usando o envelope antigo de execução;
  requer o runtime novo, em vez de reinterpretar silenciosamente a fila.
- Retry técnico mantém a mesma geração, exige estratégia diferente e, após
  três tentativas, recebe intervalo exponencial de 5 minutos até 24 horas.
  Exaustão técnica não equivale a necessidade de nova permissão.
- `node -e` opaco é execução de efeito não comprovado, não prova de escrita
  nem leitura. APIs explícitas de escrita continuam exigindo readback.
  A classificação de shell permanece heurística, não sandbox. A consulta
  oficial só recebe classificação de leitura com caminho absoluto exato do
  operador da raiz atual e integridade do payload verificada. Scripts homônimos,
  pipelines e comandos anexados não recebem essa exceção.

## Validação comportamental ainda necessária

O próximo turno real deve identificar sua raiz executada, distinguir tarefa
histórica de capacidade atual e encaminhar os diagnósticos pelo adaptador.
Fila preparada não prova início de subagente; início exige evento `started`.
Conclusão continua exigindo causa, dois testes reais consistentes e eval.
Não reabrir tarefa paga do Overcore só para consultar uma versão.

Esta release foi isolada das mudanças simultâneas de agenda/painel e hooks
da outra sessão. Não publica automaticamente trabalho concorrente.

## Resultado da validação

- Omni: 472 casos JavaScript, 468 aprovados e 4 dependentes de ambiente
  ignorados; 54 casos TypeScript aprovados. Nenhuma falha.
- Overcore: 105 casos aprovados; endpoint real autenticado consultado após
  reiniciar somente o serviço ocioso, sem repetir tarefa paga.
- Build limpa determinística: duas compilações, 59 artefatos iguais.
- Diagnóstico sobre o store real manteve seus bytes intactos e identificou
  quatro alegações de autorização sem justificativa recuperável.
- Gate de release liberado, mas auditoria geral ainda registra 47 achados
  recuperáveis de turnos, 14 melhorias prontas sem materialização e avisos
  de validação comportamental/personalidade. Isso não equivale a DoD geral.
