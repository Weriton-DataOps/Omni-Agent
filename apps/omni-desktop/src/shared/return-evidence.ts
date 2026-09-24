/** Facts about tool invocations, not their secrets, output or hidden reasoning. */
export interface ExecutionEvidence {
  source: 'transcript' | 'hooks'
  complete: boolean
  calls: { id: string; tool: string; operation: 'publish' | 'push' | 'commit' | 'inspect' | 'other'; outcome: 'requested' | 'returned' | 'failed' | 'denied'; failureKind?: 'permission' | 'application'; at: string }[]
}

export function toolResultState(content: string, isError = false): Pick<ExecutionEvidence['calls'][number], 'outcome' | 'failureKind'> {
  const permission = /permission.*(?:denied|refused)|auto mode classifier|permiss[aã]o.*negada|\bnot authorized\b|\bunauthorized\b|\bforbidden\b/i.test(content)
  const application = isError || /\bEXIT:\s*[1-9]\d*\b|"status"\s*:\s*"error"|\bexit(?:ed)? (?:code|with code)\s*[1-9]\d*\b/i.test(content)
  return permission ? { outcome: 'denied', failureKind: 'permission' } : application ? { outcome: 'failed', failureKind: 'application' } : { outcome: 'returned' }
}

export function toolOperation(tool: string, input: unknown): ExecutionEvidence['calls'][number]['operation'] {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const command = String(value.command || '')
    // Printed examples are not invocations. Never classify by a description.
    .replace(/\b(?:echo|printf|Write-Host|Write-Output)\s+(?:"[^"\n]*"|'[^'\n]*')/gi, '')
  if (/(?:^|[;&|\n])\s*(?:npx\s+(?:--[\w-]+\s+)*)?vercel\s+(?=[^;&|\n]*--prod\b)/i.test(command)) return 'publish'
  if (/\bgh\s+workflow\s+run\s+["']?[^\s"']*deploy[^\s"']*/i.test(command)) return 'publish'
  if (/\bgit\s+(?:-C\s+(?:"[^"]*"|'[^']*'|\S+)\s+)?push\b/i.test(command)) return 'push'
  if (/\bgit\s+(?:-C\s+(?:"[^"]*"|'[^']*'|\S+)\s+)?commit\b/i.test(command)) return 'commit'
  if (/^(?:Read|Glob|Grep|WebFetch|WebSearch)$/i.test(tool) || /\b(?:inspect|ls-remote|rev-parse|status|branch\s+-r|curl|Get-Content)\b/i.test(command)) return 'inspect'
  return 'other'
}

/** A mismatched operation label must never become evidence of execution. */
export function reportEvidenceGaps(report: string, evidence?: ExecutionEvidence, previous: ExecutionEvidence[] = []): string[] {
  if (!evidence?.complete) return [] // Absence in an incomplete trace proves nothing.
  const saysPublishDenied = /(?:vercel\s+--prod|deploy|publica[cç][aã]o)[^\n.]{0,100}(?:barrad|recusad|negad)|(?:recusa|negativa)[^\n.]{0,70}(?:deploy|vercel)/i.test(report)
  // Only a positive claim about THIS round permits an absence-based check.
  // Historic references, negations and incomplete older traces are not lies.
  const currentClaim = /(?:recusa|negativa|barrad\w*|recusad\w*|negad\w*)[^\n.]{0,100}\b(?:nesta|nessa|desta) rodada\b/i.test(report)
  const historic = /\b(?:anterior|anteriores|hist[oó]ric[oa]|n[aã]o houve|sem nova recusa|n[aã]o foi recusad)/i.test(report)
  const publish = [...evidence.calls, ...previous.flatMap(trace => trace.calls)].filter(call => call.operation === 'publish')
  if (saysPublishDenied && currentClaim && !historic && !publish.some(call => ['denied', 'failed', 'returned'].includes(call.outcome))) {
    return ['O relato atribui uma recusa à publicação, mas esta rodada não tem chamada de publicação recusada na trilha disponível. Separe bloqueios anteriores das consultas desta rodada; não conte uma consulta negada como tentativa de deploy.']
  }
  return []
}
