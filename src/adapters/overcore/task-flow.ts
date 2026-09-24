import { readFile, readdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { createHash } from 'node:crypto'
import { canonicalJson, type JsonObject, type JsonValue } from '../../core/shared/json.js'
import { NodeDocumentFingerprinter } from '../node/node-document-fingerprinter.js'
import { NodeLocalJsonStore } from '../local-json/node-local-json-store.js'
import { NodeLocalFileLock } from '../local-json/node-local-file-lock.js'

const fingerprints = new NodeDocumentFingerprinter()
const metadata = new Set(['contractVersion', 'draftId', 'revision', 'idempotencyKey', 'executionIdempotencyKey', 'correlationId', 'createdAt', 'client', 'decisionAnswers'])
const editable = new Set(['objective', 'context', 'knownConstraints', 'knownAcceptanceCriteria', 'discoveryAuthority', 'availableExecutionAuthority', 'executionBudget', 'preflightBudget', 'executionHints', 'execution'])
const terminal = new Set(['succeeded', 'failed', 'cancelled'])
const defaultBudget = { maxDurationMs: 300_000, maxAttempts: 1, maxParallelism: 1, maxCostUsd: 0.75 }
const object = (value: unknown, label: string): JsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} deve ser um objeto.`)
  return value as JsonObject
}
const text = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 4000) throw new Error(`${label} inválido.`)
  return value
}
const objects = (value: unknown, label: string): JsonObject[] => {
  if (!Array.isArray(value)) throw new Error(`${label} deve ser uma lista.`)
  return value.map(item => object(item, label))
}
function safeDocument(value: unknown): JsonObject {
  const result = object(value, 'Documento')
  const encoded = canonicalJson(result)
  if (encoded.length > 250_000) throw new Error('Documento de tarefa excede o limite do cliente.')
  if (/\b(?:sk-(?:ant-)?[a-z0-9_-]{20,}|gh[pousr]_[a-z0-9]{20,})\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|[a-z][a-z0-9+.-]*:\/\/[^\s/:]+:[^\s@]+@/iu.test(encoded)) {
    throw new Error('Use referências de acesso; o fluxo de tarefa não transporta credenciais.')
  }
  return structuredClone(result)
}
function changes(value: unknown): JsonObject {
  const result = safeDocument(value)
  for (const key of Object.keys(result)) if (!editable.has(key) || metadata.has(key)) throw new Error(`Campo não editável da revisão: ${key}.`)
  return result
}

export interface TaskFlowTransport {
  readonly identity: string
  request(path: string, method: 'POST' | 'GET', body?: JsonObject): Promise<JsonObject>
}

/** Only the protocol adapter knows this product. No task engine is imported. */
export class OvercoreHttpClient implements TaskFlowTransport {
  readonly identity: string
  constructor(endpoint: string, private readonly token: string, private readonly transport: typeof fetch = fetch) {
    const url = new URL(endpoint)
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Endpoint do Overcore precisa ser HTTP loopback literal, sem credencial ou caminho.')
    }
    if (token.length < 16 || /[\r\n]/u.test(token)) throw new Error('Token local do Overcore ausente ou inválido.')
    this.identity = url.origin
  }
  async request(path: string, method: 'POST' | 'GET', body?: JsonObject): Promise<JsonObject> {
    if (!/^\/v1\/(?:capabilities|validation-evidence|preflight(?:\/[A-Za-z0-9._:-]+\/admit)?|tasks\/[A-Za-z0-9._:-]+(?:\/(?:cancel|resume))?)$/u.test(path)) throw new Error('Rota externa inválida.')
    if (['/v1/capabilities', '/v1/validation-evidence'].includes(path) && (method !== 'GET' || body !== undefined)) throw new Error('Capacidades e evidências aceitam somente consulta GET.')
    let response: Response
    try {
      response = await this.transport(`${this.identity}${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(method === 'GET' ? 5000 : 125_000),
        headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
      })
    } catch { throw new Error('Overcore indisponível ou tempo esgotado. Retome o mesmo fluxo; não crie outro pedido.') }
    const raw = await response.text()
    if (raw.length > 2_000_000) throw new Error('Resposta externa excedeu o limite.')
    if (!response.ok) {
      let detail = ''
      try {
        const error = object(JSON.parse(raw), 'Erro remoto')
        // Validation messages contain schema paths/reasons, not arbitrary remote output.
        if (error.error === 'ContractValidationError' && typeof error.message === 'string') {
          const message = error.message.split(this.token).join('[redacted]').slice(0, 2000)
          safeDocument({ message })
          detail = ` ${message.replace(/[\r\n\u0000-\u001f]/gu, ' ')}`
        }
      } catch { /* HTML and secret-bearing errors never reach the conversation. */ }
      throw new Error(`Overcore respondeu HTTP ${response.status}.${detail} O vínculo foi preservado; consulte o mesmo fluxo para confirmar o estado remoto.`)
    }
    try { return safeDocument(JSON.parse(raw)) }
    catch { throw new Error('Overcore devolveu documento inválido; o vínculo foi preservado.') }
  }
}

export async function taskFlowClient(env: NodeJS.ProcessEnv = process.env): Promise<OvercoreHttpClient> {
  let token = env.OVERCORE_LOCAL_TOKEN
  if (!token && env.LOCALAPPDATA) {
    try {
      const configuration = object(JSON.parse(await readFile(join(env.LOCALAPPDATA, 'Overcore', 'client-private.json'), 'utf8')), 'Configuração privada')
      if (configuration.schemaVersion === 1 && typeof configuration.localToken === 'string') token = configuration.localToken
    } catch { /* The caller receives a configuration error, never the file or secret. */ }
  }
  if (!token) throw new Error('Integração ainda sem token local no ambiente ou na configuração privada do Omni.')
  let endpoint = env.OVERCORE_URL
  if (!endpoint) {
    if (!env.LOCALAPPDATA) throw new Error('Descritor do Overcore indisponível.')
    const descriptor = object(JSON.parse(await readFile(join(env.LOCALAPPDATA, 'Overcore', 'runtime.json'), 'utf8')), 'Descritor')
    if (descriptor.host !== '127.0.0.1' || !Number.isInteger(descriptor.port) || Number(descriptor.port) < 1 || Number(descriptor.port) > 65535) throw new Error('Descritor local do Overcore inválido.')
    endpoint = `http://127.0.0.1:${descriptor.port}`
  }
  return new OvercoreHttpClient(endpoint, token)
}

export async function taskFlowConfigured(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  try { await taskFlowClient(env); return true } catch { return false }
}

interface Flow extends JsonObject {
  schemaVersion: 1
  flowId: string
  sessionKey: string
  inputDigest: string
  draft: JsonObject
  report: JsonObject | null
  taskId: string | null
  observation: JsonObject | null
  answerDigest: string | null
  answerReportId: string | null
}

export class OvercoreTaskFlow {
  private readonly directory: string
  private readonly store = new NodeLocalJsonStore()
  // Lock only this flow, never memory or other conversations. Heartbeat survives network waits.
  private readonly lock = new NodeLocalFileLock({ acquisitionTimeoutMs: 2000 })
  constructor(home: string, private readonly api: TaskFlowTransport) {
    if (!isAbsolute(home)) throw new Error('Casa do Omni deve ser absoluta.')
    this.directory = join(home, 'runtime', 'external-task-flows')
  }
  private path(flowId: string): string {
    if (!/^flow-[a-f0-9]{24}$/u.test(flowId)) throw new Error('Identidade do fluxo inválida.')
    return join(this.directory, `${flowId}.json`)
  }
  private async read(sessionId: string, flowId: string): Promise<Flow> {
    const flow = object(await this.store.read(this.path(flowId)), 'Fluxo') as Flow
    if (flow.schemaVersion !== 1 || flow.flowId !== flowId || flow.sessionKey !== fingerprints.fingerprint(sessionId).value) throw new Error('Fluxo ausente, incompatível ou pertencente a outra conversa.')
    return flow
  }
  private async save(flow: Flow): Promise<void> { await this.store.write(this.path(flow.flowId), flow) }

  async start(sessionId: string, idempotencyKey: string, input: unknown): Promise<JsonObject> {
    text(sessionId, 'Conversa'); text(idempotencyKey, 'Chave do pedido')
    const fields = changes(input)
    for (const key of ['objective', 'context', 'discoveryAuthority', 'availableExecutionAuthority']) {
      if (fields[key] === undefined) throw new Error(`Pedido sem ${key}; o Omni deve estruturar o que já foi autorizado.`)
    }
    text(fields.objective, 'Objetivo')
    const flowId = fingerprints.stableId('flow', `${sessionId}:${idempotencyKey}`)
    return this.lock.run(`${this.path(flowId)}.operation.lock`, async () => {
      const digest = fingerprints.fingerprint(fields).value
      if (await this.store.read(this.path(flowId))) {
        const existing = await this.read(sessionId, flowId)
        if (existing.inputDigest !== digest) throw new Error('A mesma chave do pedido recebeu outro conteúdo. Use a resposta do fluxo existente ou uma nova intenção.')
        return this.advance(existing)
      }
      const flow: Flow = {
        schemaVersion: 1, flowId, sessionKey: fingerprints.fingerprint(sessionId).value,
        inputDigest: digest, report: null, taskId: null, observation: null, answerDigest: null, answerReportId: null,
        draft: {
          knownConstraints: [], knownAcceptanceCriteria: [], preflightBudget: { maxDurationMs: 60_000, maxInspectionOperations: 10 },
          executionBudget: { source: { kind: 'policy-default', sourceId: 'policy-omni-task', sourceVersion: '1.0', sourceDigest: fingerprints.fingerprint(defaultBudget).value }, limits: defaultBudget },
          ...fields, contractVersion: '1.0', draftId: fingerprints.stableId('draft', flowId), revision: 1,
          idempotencyKey: `prepare-${flowId}`, executionIdempotencyKey: `execute-${flowId}`,
          correlationId: fingerprints.stableId('corr', flowId), createdAt: new Date().toISOString(),
          client: { id: 'client-omni-assistant', kind: 'assistant' }, decisionAnswers: []
        }
      }
      await this.save(flow) // Durable intent before the first HTTP request.
      return this.advance(flow)
    })
  }

  async answer(sessionId: string, flowId: string, input: unknown): Promise<JsonObject> {
    const reply = safeDocument(input)
    const reportId = text(reply.reportId, 'Relatório respondido')
    const selected = objects(reply.answers, 'Respostas')
    const patch = changes(reply.changes)
    const digest = fingerprints.fingerprint(reply).value
    return this.lock.run(`${this.path(flowId)}.operation.lock`, async () => {
      const flow = await this.read(sessionId, flowId)
      if (flow.answerReportId === reportId) {
        if (flow.answerDigest !== digest) throw new Error('Este relatório já foi respondido com outro conteúdo.')
        return this.advance(flow)
      }
      const report = flow.report
      if (flow.taskId || !report || report.status !== 'decisions-required' || report.reportId !== reportId) throw new Error('Resposta não corresponde ao pacote pendente desta conversa.')
      const decisions = objects(report.requiredDecisions, 'Decisões')
      if (selected.length !== decisions.length || new Set(selected.map(a => a.decisionId)).size !== selected.length) throw new Error('Responda cada decisão do pacote uma única vez.')
      const at = new Date().toISOString()
      const answers = selected.map(selection => {
        const decision = decisions.find(d => d.decisionId === selection.decisionId)
        if (!decision || !objects(decision.options, 'Opções').some(option => option.optionId === selection.optionId)) throw new Error('Decisão/opção não pertence ao relatório pendente.')
        return {
          answerId: fingerprints.stableId('answer', `${reportId}:${String(selection.decisionId)}`), decisionId: selection.decisionId!,
          selectedOptionId: selection.optionId!, answeredAt: at, answeredBy: 'omni-owner-dialogue',
          sourceReport: { reportId, draftRevision: report.draftRevision!, draftFingerprint: report.draftFingerprint!, reportFingerprint: fingerprints.fingerprint(report) as unknown as JsonValue }
        }
      })
      flow.draft = { ...flow.draft, ...patch, revision: Number(flow.draft.revision) + 1, createdAt: at, decisionAnswers: [...objects(flow.draft.decisionAnswers, 'Respostas anteriores'), ...answers] }
      flow.report = null; flow.answerDigest = digest; flow.answerReportId = reportId
      await this.save(flow) // A timeout replays this exact revision, including dates.
      return this.advance(flow)
    })
  }

  async follow(sessionId: string, flowId: string): Promise<JsonObject> {
    return this.lock.run(`${this.path(flowId)}.operation.lock`, async () => this.advance(await this.read(sessionId, flowId)))
  }
  async cancel(sessionId: string, flowId: string): Promise<JsonObject> {
    return this.lock.run(`${this.path(flowId)}.operation.lock`, async () => {
      const flow = await this.read(sessionId, flowId)
      if (!flow.taskId) throw new Error('Este fluxo ainda não possui tarefa admitida.')
      await this.api.request(`/v1/tasks/${flow.taskId}/cancel`, 'POST')
      return this.advance(flow)
    })
  }
  private async advance(flow: Flow): Promise<JsonObject> {
    if (!flow.report) {
      const report = await this.api.request('/v1/preflight', 'POST', { draft: flow.draft })
      if (report.draftId !== flow.draft.draftId || report.draftRevision !== flow.draft.revision ||
          canonicalJson(report.draftFingerprint) !== canonicalJson(fingerprints.fingerprint(flow.draft)) ||
          !['ready', 'decisions-required', 'not-feasible'].includes(String(report.status)) ||
          !/^[A-Za-z0-9._:-]+$/u.test(text(report.reportId, 'Report ID'))) throw new Error('Relatório devolvido não corresponde à revisão enviada.')
      objects(report.requiredDecisions, 'Decisões')
      if (report.status === 'ready' && (report.requiredDecisions as JsonValue[]).length) throw new Error('Relatório ready contradiz decisões pendentes.')
      flow.report = report
      await this.save(flow)
    }
    if (flow.report.status === 'ready' && !flow.taskId) {
      const receipt = await this.api.request(`/v1/preflight/${String(flow.report.reportId)}/admit`, 'POST')
      if (receipt.reportId !== flow.report.reportId || !/^[A-Za-z0-9._:-]+$/u.test(text(receipt.taskId, 'Task ID'))) throw new Error('Recibo não corresponde ao relatório admitido.')
      flow.taskId = String(receipt.taskId)
      await this.save(flow)
    }
    if (flow.taskId) {
      const task = await this.api.request(`/v1/tasks/${flow.taskId}`, 'GET')
      const request = object(task.request, 'Request persistido')
      if (task.taskId !== flow.taskId || request.idempotencyKey !== flow.draft.executionIdempotencyKey ||
          canonicalJson(request.client) !== canonicalJson(flow.draft.client) ||
          request.correlationId !== flow.draft.correlationId) throw new Error('Estado devolvido não pertence ao pedido da conversa.')
      if (!['accepted', 'planning', 'ready', 'running', 'verifying', 'blocked', 'cancelling', 'cancelled', 'succeeded', 'failed'].includes(String(task.status))) throw new Error('Estado remoto desconhecido.')
      if (terminal.has(String(task.status)) || task.status === 'blocked') {
        const result = object(task.result, 'Resultado verificado')
        if (result.taskId !== flow.taskId || result.status !== task.status || result.requestId !== request.requestId ||
            canonicalJson(result.requestFingerprint) !== canonicalJson(fingerprints.fingerprint(request))) throw new Error('Resultado não corresponde à tarefa/estado consultados.')
        text(result.resultId, 'Resultado ID'); text(result.summary, 'Resumo do resultado')
        objects(result.criteria, 'Critérios'); objects(result.evidence, 'Evidências')
        if (result.report !== undefined) {
          const report = object(result.report, 'Relatório entregue')
          if (typeof report.content !== 'string' || !report.content.trim() || report.content.length > 200_000 ||
              !['text/markdown', 'application/json'].includes(String(report.mediaType)) ||
              report.digest !== `sha256:${createHash('sha256').update(report.content, 'utf8').digest('hex')}`) {
            throw new Error('Relatório entregue sem integridade verificável; não declare a entrega concluída.')
          }
        }
      }
      flow.observation = { status: text(task.status, 'Estado'), stateRevision: task.stateRevision ?? null, checkedAt: new Date().toISOString(), result: task.result ?? null }
      await this.save(flow)
    }
    return flowView(flow)
  }
}

function flowView(flow: Flow): JsonObject {
  return {
    flowId: flow.flowId, draftId: flow.draft.draftId!, revision: flow.draft.revision!,
    reportId: flow.report?.reportId ?? null, taskId: flow.taskId,
    status: flow.observation?.status ?? flow.report?.status ?? 'preparing',
    decisions: flow.report?.requiredDecisions ?? [],
    checks: flow.report?.checks ?? [], result: flow.observation?.result ?? null,
    checkedAt: flow.observation?.checkedAt ?? null,
    next: flow.taskId ? (terminal.has(String(flow.observation?.status)) ? 'report-result' : 'follow-same-task') : flow.report?.status === 'decisions-required' ? 'ask-grouped-decisions' : 'resume-same-flow'
  }
}

/** Local cache is a conversation bookmark; only HTTP readback claims current task state. */
export async function listTaskFlows(home: string, sessionId: string): Promise<JsonObject[]> {
  const directory = join(home, 'runtime', 'external-task-flows')
  let names: string[]
  try { names = await readdir(directory) } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return []
    throw error
  }
  const key = fingerprints.fingerprint(sessionId).value
  const flows: JsonObject[] = []
  for (const name of names.filter(name => /^flow-[a-f0-9]{24}\.json$/u.test(name))) {
    const flow = object(JSON.parse(await readFile(join(directory, name), 'utf8')), 'Fluxo') as Flow
    if (flow.schemaVersion === 1 && flow.sessionKey === key) flows.push(flowView(flow))
  }
  return flows
}
