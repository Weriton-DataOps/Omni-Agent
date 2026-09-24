/** A factual receipt, not a generated promise of execution. */
export function externalTaskNoticeId(value: Record<string, unknown>): string | null {
  if (!['succeeded', 'failed', 'blocked', 'cancelled'].includes(String(value.status))) return null
  const result = value.result && typeof value.result === 'object' ? value.result as Record<string, unknown> : null
  return `external-return:${String(value.flowId)}:${String(result?.resultId || value.status)}`
}
export function externalTaskReceipt(value: Record<string, unknown>): string {
  const decisions = Array.isArray(value.decisions) ? value.decisions as Record<string, unknown>[] : []
  if (value.status === 'decisions-required') return [
    'O Overcore juntou estas decisões antes de executar:',
    ...decisions.map((decision, index) => {
      const options = Array.isArray(decision.options) ? decision.options as Record<string, unknown>[] : []
      return `\n${index + 1}. ${String(decision.question)}\n${options.map(option => `   - ${String(option.label)}`).join('\n')}`
    }),
    '\nResponda aqui; eu continuo o mesmo pedido com suas escolhas.'
  ].join('\n')
  const states: Record<string, string> = {
    accepted: 'O Overcore recebeu a tarefa.', planning: 'O Overcore está preparando o plano.',
    ready: 'O plano está pronto.', running: 'A tarefa foi admitida no Overcore e entrou em execução.',
    verifying: 'O Overcore está verificando o resultado.', blocked: 'A tarefa encontrou um impedimento.',
    succeeded: 'O Overcore concluiu e verificou a tarefa.', failed: 'A execução falhou.',
    cancelling: 'O cancelamento está em andamento.', cancelled: 'A tarefa foi cancelada.',
    'not-feasible': 'O Preflight encontrou uma condição que precisa ser resolvida antes da execução.'
  }
  const result = value.result && typeof value.result === 'object' ? value.result as Record<string, unknown> : null
  return [states[String(value.status)] || 'O vínculo foi preservado para acompanhamento.',
    value.taskId ? `Tarefa: ${String(value.taskId)}.` : '',
    typeof result?.summary === 'string' ? result.summary : '',
    result && Array.isArray(result.evidence) ? `Evidências registradas: ${result.evidence.length}.` : '',
    value.status === 'not-feasible' ? JSON.stringify(value.checks).slice(0, 4000) : ''
  ].filter(Boolean).join('\n\n')
}
