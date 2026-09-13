import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Activity, Conversation, RuntimeState } from '../shared/contracts'
import { root } from './runtime'

type RawSurface = { id: string; purpose: string; actions: string[] }
export interface BodyContract {
  schemaVersion: 1
  contract: 'omni-desktop-body-v1'
  identity: { name: string; role: string; sourceOfTruth: string; notSourceOfTruth: string[] }
  surfaces: RawSurface[]
  routing: { centralOwns: string[]; externalOwns: string[]; reportDestination: string; correlation: string }
  guardrails: string[]
  projection: { maximumActivities: number; maximumCharacters: number; exclude: string[] }
}

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} invalido.`)
  return value as Record<string, unknown>
}
const asText = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} invalido.`)
  return value
}
const asTexts = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value)) throw new Error(`${label} invalido.`)
  return value.map((item, index) => asText(item, `${label}[${index}]`))
}
const asPositiveInteger = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error(`${label} invalido.`)
  return value
}

export function parseBodyContract(value: unknown): BodyContract {
  const raw = asRecord(value, 'Contrato do corpo')
  if (raw.schemaVersion !== 1 || raw.contract !== 'omni-desktop-body-v1') throw new Error('Contrato do corpo incompativel.')
  const identity = asRecord(raw.identity, 'Contrato do corpo.identity')
  const routing = asRecord(raw.routing, 'Contrato do corpo.routing')
  const projection = asRecord(raw.projection, 'Contrato do corpo.projection')
  if (!Array.isArray(raw.surfaces) || raw.surfaces.length === 0) throw new Error('Contrato do corpo sem superficies.')
  const surfaces = raw.surfaces.map((item, index) => {
    const surface = asRecord(item, `Contrato do corpo.surfaces[${index}]`)
    return { id: asText(surface.id, 'surface.id'), purpose: asText(surface.purpose, 'surface.purpose'), actions: asTexts(surface.actions, 'surface.actions') }
  })
  if (!surfaces.some(surface => surface.id === 'central-chat') || !surfaces.some(surface => surface.id === 'vscode-session-chat')) throw new Error('Contrato do corpo sem superficies obrigatorias.')
  const maximumActivities = asPositiveInteger(projection.maximumActivities, 'projection.maximumActivities')
  const maximumCharacters = asPositiveInteger(projection.maximumCharacters, 'projection.maximumCharacters')
  if (maximumCharacters < 500) throw new Error('Limites do corpo invalidos.')
  return {
    schemaVersion: 1, contract: 'omni-desktop-body-v1',
    identity: { name: asText(identity.name, 'identity.name'), role: asText(identity.role, 'identity.role'), sourceOfTruth: asText(identity.sourceOfTruth, 'identity.sourceOfTruth'), notSourceOfTruth: asTexts(identity.notSourceOfTruth, 'identity.notSourceOfTruth') },
    surfaces,
    routing: { centralOwns: asTexts(routing.centralOwns, 'routing.centralOwns'), externalOwns: asTexts(routing.externalOwns, 'routing.externalOwns'), reportDestination: asText(routing.reportDestination, 'routing.reportDestination'), correlation: asText(routing.correlation, 'routing.correlation') },
    guardrails: asTexts(raw.guardrails, 'guardrails'),
    projection: { maximumActivities, maximumCharacters, exclude: asTexts(projection.exclude, 'projection.exclude') }
  }
}

let cached: Promise<BodyContract> | undefined
export function loadBodyContract(): Promise<BodyContract> {
  cached ||= readFile(join(root, 'contratos', 'interface', 'omni-desktop.json'), 'utf8').then(JSON.parse).then(parseBodyContract)
  return cached
}

const kindLabel: Record<Conversation['kind'], string> = { central: 'chat central', task: 'fila de subagente', external: 'chat de sessao VS Code' }
export function bodyContext(contract: BodyContract, conversation: Conversation, state: RuntimeState): string {
  const relevant = state.activities.filter(activity => activity.conversationId === conversation.id || activity.parentConversationId === conversation.id)
  const visible = relevant.slice(0, contract.projection.maximumActivities).map(activity => ({ source: activity.source, status: activity.status, title: activity.title, detail: activity.detail, outcome: activity.outcome || null }))
  const requests = (conversation.editorRequests || []).map(request => ({ target: request.targetName || 'sessao vinculada', status: request.status, hasReport: Boolean(request.report), hasSummary: Boolean(request.summary) }))
  const payload = {
    body: contract.identity, currentSurface: kindLabel[conversation.kind], conversation: { id: conversation.id, kind: conversation.kind, linkedVsCodeSession: conversation.sessionId !== null, workspace: conversation.workspace, editorOnline: conversation.editorOnline ?? null },
    capabilities: contract.surfaces.map(surface => ({ id: surface.id, purpose: surface.purpose, actions: surface.actions })),
    state: { voiceAvailable: state.voice, activities: visible, requests }, routing: contract.routing, guardrails: contract.guardrails
  }
  const text = `CORPO DO OMNI DESKTOP (contrato ${contract.contract}; estado tipado desta rodada):\n${JSON.stringify(payload)}`
  if (text.length > contract.projection.maximumCharacters) throw new Error('Projecao do corpo excedeu o limite do contrato.')
  return text
}
