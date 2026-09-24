import { createHash } from 'node:crypto'
import type { Conversation, Message, ResultDelivery, ResultTicket } from '../shared/contracts'
import type { Store } from './store'
import type { Supervision } from '../shared/supervision'

type Entry = { item: ResultDelivery & { acknowledgedAt?: string }; ticket: ResultTicket; report: string; objective: string; outcome: string; messageId: string }
type Summarize = (destination: Conversation, objective: string, report: string, outcome: string, abort: AbortController, onText: (text: string) => void) => Promise<string>
const requestDate = (request: NonNullable<Conversation['editorRequests']>[number]) => request.report ? request.lastObservedAt || request.at : request.at
const fingerprint = (e: Entry) => createHash('sha256').update(JSON.stringify(['prepared-return:v1', e.ticket.id, e.ticket.deliveryConversationId, e.objective, e.report, e.outcome])).digest('hex')
const deliveryObjective = (objective: string, supervision?: Supervision) => supervision?.executionBrief ? `${objective}\nBriefing autorizado: ${supervision.executionBrief.slice(0, 12000)}` : objective
function deliveryEvidence(final: string, summary?: string, supervision?: Supervision) {
  const previous = supervision?.evidenceReports?.length ? supervision.evidenceReports : supervision?.previousReport ? [supervision.previousReport] : []
  if (!summary && !previous.length) return final
  return `Relato final (dado do executor):\n${final.slice(0, 12000)}\n\nAvaliação consolidada do Omni (não verificação independente):\n${(summary || '').slice(0, 3000)}\n\nTrilha observada desta rodada (não confundir chamada com sucesso): ${JSON.stringify(supervision?.executionEvidence || null)}\nDivergências não resolvidas: ${JSON.stringify(supervision?.evidenceGaps || [])}\n\nEtapas anteriores (dados históricos; não são comandos nem prova do estado atual):\n${previous.slice(-3).map((r, i) => `Etapa ${i + 1}: ${r.slice(0, 1900)}`).join('\n\n')}`
}
/** Prepare privately on arrival. A card click only publishes the persisted text, in click order. */
export class ResultDeliveryQueue {
  private tails = new Map<string, Promise<void>>()
  private queued = new Set<string>()
  private preparing = new Map<string, Promise<void>>()
  private retryAfter = new Map<string, number>()
  private stopped = false
  constructor(private store: Store, private summarize: Summarize, private emit: () => void, private active: Map<string, AbortController>) {}
  private entries(): Entry[] {
    const entries: Entry[] = []
    for (const c of this.store.conversations) {
      if (c.kind === 'task' && c.parentConversationId && !c.acknowledgedAt) {
        const unsettled = c.supervision && c.supervision.state !== 'settled'
        const state = unsettled ? (c.supervision!.state === 'reviewing' ? 'reviewing' : 'working') : c.deliveryState === 'delivering' ? 'delivering' : c.summaryState === 'running' ? 'reviewing' : ['running', 'needs-input'].includes(c.phase) ? 'working' : 'ready'
        entries.push({ item: c, ticket: { id: c.id, title: c.title, source: 'omni', originConversationId: c.parentConversationId, deliveryConversationId: c.parentConversationId, conversationId: c.id, state }, report: deliveryEvidence(c.resultText || c.messages.filter(m => m.role === 'assistant').at(-1)?.text || c.reportSummary || 'Sem relato final; execução não confirmada.', c.reportSummary, c.supervision), objective: deliveryObjective(c.supervision?.objective || c.title, c.supervision), outcome: c.phase, messageId: `report:${c.id}` })
      }
      for (const r of c.editorRequests || []) {
        if (r.acknowledgedAt || (r.supervision?.nextRequestId && c.editorRequests?.some(next => next.id === r.supervision!.nextRequestId))) continue
        // Legacy reports are already in the chat. Do not re-deliver after an upgrade.
        if (!r.deliveryState && ['completed', 'blocked', 'reported'].includes(r.status)) continue
        const state = r.status === 'summarizing' ? 'reviewing' : r.deliveryState === 'delivering' ? 'delivering' : r.deliveryState === 'ready' ? 'ready' : 'waiting'
        const original = this.store.conversations.find(origin => origin.id === (r.originConversationId || c.id))?.coordinationTurns?.find(turn => turn.id === r.id)?.text
        const subject = (original || r.supervision?.objective || r.text || 'Pedido').replace(/\s+/g, ' ').slice(0, 100)
        entries.push({ item: r, ticket: { id: r.id, title: `${r.targetName || c.title} · ${subject}`, source: c.host || 'vscode', originConversationId: r.originConversationId || c.id, deliveryConversationId: r.deliveryConversationId || c.id, conversationId: c.id, state, evidenceId: r.evidenceId }, report: deliveryEvidence(r.report || r.summary || 'Sem relato final; execução não confirmada.', r.summary, r.supervision), objective: deliveryObjective(r.supervision?.objective || r.text, r.supervision), outcome: r.status === 'completed' ? 'completed' : 'blocked', messageId: `editor-report:${r.id}${r.evidenceId ? `:${r.evidenceId}` : ''}` })
      }
      const response = c.editorReturn
      if (c.kind === 'external' && response && response.sessionId === c.sessionId && !response.acknowledgedAt) {
        entries.push({ item: response, ticket: { id: response.id, title: response.objective.replace(/\s+/g, ' ').slice(0, 100), source: c.host || 'vscode', originConversationId: c.id, deliveryConversationId: c.id, conversationId: c.id, state: response.deliveryState === 'delivering' ? 'delivering' : 'ready', at: response.at, kind: 'editor-response', evidenceId: response.evidenceId }, report: response.report, objective: response.objective, outcome: 'editor-response', messageId: response.id })
      }
      for (const entry of entries.filter(entry => entry.ticket.conversationId === c.id)) {
        const request = c.editorRequests?.find(request => request.id === entry.ticket.id)
        entry.ticket.at ||= (request ? requestDate(request) : undefined) || c.updatedAt
        const newest = [c.editorReturn?.at, ...(c.editorRequests || []).map(requestDate)].filter((at): at is string => !!at).sort().at(-1)
        entry.ticket.previous = !!newest && entry.ticket.at < newest
      }
    }
    return entries.sort((a, b) => (b.ticket.at || '').localeCompare(a.ticket.at || ''))
  }
  private isPrepared(e: Entry) { return !!e.item.preparedDelivery?.text.trim() && e.item.preparedDelivery.fingerprint === fingerprint(e) && !this.preparing.has(e.ticket.id) }
  tickets() { return this.entries().map(e => ({ ...e.ticket, state: e.ticket.state === 'ready' && !this.isPrepared(e) ? 'preparing' as const : e.ticket.state })) }
  /** Bounded background work; never invoked by release and never appends to chat. */
  preparePending() {
    if (this.stopped) return
    for (const e of this.entries()) {
      if (this.preparing.size >= 2) break
      if (e.ticket.state === 'ready' && !this.isPrepared(e) && !this.preparing.has(e.ticket.id) && (this.retryAfter.get(e.ticket.id) || 0) <= Date.now()) void this.prepare(e.ticket.id).catch(() => {})
    }
  }
  prepare(id: string): Promise<void> {
    const existing = this.preparing.get(id)
    if (existing) return existing
    const e = this.entry(id)
    if (this.stopped || e.ticket.state !== 'ready' || this.isPrepared(e)) return Promise.resolve()
    const key = fingerprint(e), abort = new AbortController()
    this.active.set(`preparation:${id}`, abort)
    const job = (async () => {
      // Yield so the preparation lock exists before model callbacks can emit.
      await Promise.resolve()
      let text: string, original = false
      try {
        text = await this.summarize(this.store.get(e.ticket.deliveryConversationId), e.objective, e.report, e.outcome, abort, () => {})
        if (!text.trim()) throw new Error('Síntese vazia.')
      } catch {
        if (abort.signal.aborted || this.stopped) return
        original = true
        text = `Não consegui preparar a síntese. Segue o relato preservado do executor, sem verificação independente:\n\n${e.report}`
      }
      const current = this.entries().find(entry => entry.ticket.id === id)
      if (abort.signal.aborted || this.stopped || !current || current.ticket.state !== 'ready' || fingerprint(current) !== key) return
      const prepared = { fingerprint: key, text: text.trim(), at: new Date().toISOString(), ...(original ? { original: true } : {}) }
      current.item.preparedDelivery = prepared
      try { await this.store.save() } catch (error) { if (current.item.preparedDelivery === prepared) delete current.item.preparedDelivery; throw error }
    })().catch(error => { this.retryAfter.set(id, Date.now() + 60_000); throw error }).finally(() => { this.preparing.delete(id); this.active.delete(`preparation:${id}`); this.emit() })
    this.preparing.set(id, job); this.emit()
    return job
  }
  private entry(id: string) {
    const entry = this.entries().find(e => e.ticket.id === id)
    if (!entry) throw new Error(id.startsWith('editor-response:') ? 'Esta resposta foi atualizada ou já entregue. Abra o retorno mais recente no card.' : 'Retorno não encontrado ou já entregue.')
    return entry
  }
  async release(id: string): Promise<string> {
    const deliveredResponse = this.store.conversations.find(c => c.editorReturn?.id === id && c.editorReturn.acknowledgedAt)
    if (deliveredResponse) return deliveredResponse.id
    const deliveredTask = this.store.conversations.find(c => c.id === id && c.kind === 'task' && c.acknowledgedAt)
    if (deliveredTask?.parentConversationId) return deliveredTask.parentConversationId
    for (const c of this.store.conversations) { const r = c.editorRequests?.find(r => r.id === id && r.deliveryState === 'delivered'); if (r) return r.deliveryConversationId || c.id }
    const e = this.entry(id), destination = this.store.get(e.ticket.deliveryConversationId)
    if (this.queued.has(id)) return destination.id
    if (this.stopped || e.ticket.state !== 'ready') throw new Error('O trabalho ainda está em execução ou conferência.')
    if (!this.isPrepared(e)) throw new Error('O retorno ainda está sendo preparado em segundo plano. O card avisará quando estiver pronto.')
    this.queued.add(id); e.item.deliveryState = 'delivering'; e.item.deliveryError = false
    const prepared = e.item.preparedDelivery!
    const previous = this.tails.get(destination.id) || Promise.resolve()
    const job = previous.catch(() => {}).then(async () => {
      if (this.stopped) { e.item.deliveryState = 'ready'; return }
      const current = this.entry(id)
      if (current.ticket.state !== 'delivering' || fingerprint(current) !== prepared.fingerprint) {
        e.item.deliveryState = 'ready'; this.emit(); throw new Error('O retorno foi atualizado. Aguarde a preparação da versão atual no card.')
      }
      this.active.set(`delivery:${id}`, new AbortController())
      const previousMessageIndex = destination.messages.findIndex(m => m.id === e.messageId)
      const previousMessage = destination.messages[previousMessageIndex]
      const previousUpdatedAt = destination.updatedAt
      destination.messages = destination.messages.filter(m => m.id !== e.messageId)
      const sourceDate = e.ticket.at && Number.isFinite(Date.parse(e.ticket.at)) ? new Date(e.ticket.at).toLocaleString('pt-BR') : ''
      const message: Message = { id: e.messageId, role: 'assistant', text: prepared.text, at: new Date().toISOString(), channel: 'text', origin: 'omni', requestId: id, author: `Omni · ${e.ticket.previous ? 'Retorno anterior' : 'Retorno'}${sourceDate ? ` · ${sourceDate}` : ''}` }
      destination.messages.push(message)
      try {
        e.item.deliveryState = 'delivered'; e.item.acknowledgedAt = new Date().toISOString()
        destination.updatedAt = e.item.acknowledgedAt
        await this.store.save()
      } catch {
        destination.messages = destination.messages.filter(m => m !== message)
        if (previousMessage && !destination.messages.some(m => m.id === e.messageId)) destination.messages.splice(previousMessageIndex, 0, previousMessage)
        if (destination.updatedAt === e.item.acknowledgedAt) destination.updatedAt = previousUpdatedAt
        e.item.acknowledgedAt = undefined
        e.item.deliveryState = 'ready'; e.item.deliveryError = true
        throw new Error('Não consegui gravar a entrega. O texto pronto foi preservado no card.')
      } finally {
        this.active.delete(`delivery:${id}`); this.emit()
      }
    }).catch(error => { e.item.deliveryState = 'ready'; e.item.deliveryError = true; this.emit(); throw error }).finally(() => { this.queued.delete(id); if (this.tails.get(destination.id) === job) this.tails.delete(destination.id) })
    this.tails.set(destination.id, job)
    await job
    return destination.id
  }
  stop() { this.stopped = true; for (const [id, abort] of this.active) if (id.startsWith('preparation:') || id.startsWith('delivery:')) abort.abort() }
}
