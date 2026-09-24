import type { Supervision } from './supervision'
export type Phase = 'idle' | 'running' | 'needs-input' | 'completed' | 'interrupted' | 'failed' | 'editor'
export interface Attachment { id: string; kind: 'image' | 'text'; name: string; mime: string; size: number; preview?: string }
export interface CredentialRegistrationInput { credentialId: string; providerRef: string; accountRef: string; environmentRef: string; token: string; expiresAt: string | null; renewalMode: 'none' | 'refresh' | 'rotate' | 'reauthenticate' }
export interface CredentialReceipt { credentialId: string; version: number; providerRef: string; accountRef: string; environmentRef: string; expiresAt: string | null; status: string; secretRef: string }
/** Safe Crachá inventory projection. It never includes a secret or vault reference. */
export interface CredentialInventoryItem { credentialId: string; version: number; providerRef: string; accountRef: string; environmentRef: string; expiresAt: string | null; status: string }
export interface CredentialVerification { outcome: 'authenticated' | 'invalid-token' | 'insufficient-scope' | 'timeout' | 'unavailable' | 'rate-limited' | 'unsupported'; checkedAt: string; method: string; summary: string }
/** A temporary handle and safe projection only. Raw credentials never return to the renderer. */
export interface CredentialDraft { id: string; service: string; kind: string; expiresAt: string | null; missing: string[]; existing: { version: number; status: string } | null; matches: CredentialInventoryItem[] }
export interface CredentialSaved { version: number; status: string; disposition: 'created' | 'reused' | 'pending'; checkedAt: string | null }
/** Safe projection of a private Crachá document. Its text never returns to the renderer. */
export interface PrivateCredentialAttachment { id: string; size: number }
export interface PrivateAttachmentReceipt extends PrivateCredentialAttachment { status: 'received' | 'considered' | 'stored' | 'needs-input' | 'unavailable' | 'failed' | 'access-ready' | 'access-used' | 'access-failed' }
/** Safe result of a private file inspection. It contains no credential value. */
export interface PrivateCredentialDocumentInspection {
  kind: 'google-service-account' | 'unsupported-json'
  service: string
  providerRef: string | null
  accountRef: string | null
  projectRef: string | null
  hasPrivateKey: boolean
  canStore: boolean
  missing: string[]
}
/** Raw attachment content crosses only the desktop IPC boundary and is never stored in chat history. */
/** Renderer-only image dimensions help identify a draft before it is sent. */
export interface AttachmentInput { kind: 'image' | 'text'; name?: string; mime?: string; data?: string; text?: string; width?: number; height?: number }
export interface Message { id: string; role: 'user' | 'assistant'; text: string; at: string; channel: 'text' | 'voice'; author?: string; origin?: 'owner' | 'omni' | 'editor'; requestId?: string; attachments?: Attachment[]; privateAttachment?: PrivateAttachmentReceipt; streaming?: boolean; interrupted?: boolean }
export interface ResultDelivery { deliveryState?: 'ready' | 'delivering' | 'delivered'; deliveryError?: boolean; preparedDelivery?: { fingerprint: string; text: string; at: string; original?: boolean } }
/** A response written directly in the linked editor, not proof that a Desktop request completed. */
export interface EditorSessionReturn extends ResultDelivery { id: string; sessionId: string; turnId: string; evidenceId: string; at: string; objective: string; report: string; acknowledgedAt?: string }
export interface EditorRequest extends ResultDelivery {
  attachments?: Attachment[]; attachmentConversationId?: string;
  supervision?: Supervision; followupOf?: string;
  id: string; text: string; at: string; status: 'sending' | 'sent' | 'received' | 'reported' | 'blocked' | 'uncertain' | 'summarizing' | 'completed';
  /** Original owner conversation (authorization provenance), independent of where the return is displayed. */
  originConversationId?: string; deliveryConversationId?: string; targetSessionId?: string; targetName?: string; lastObservedAt?: string;
  report?: string; evidenceId?: string; summary?: string; reportOutcome?: 'completed' | 'blocked';
  summaryAttempted?: boolean; summaryError?: string; disconnected?: boolean; acknowledgedAt?: string;
}
export interface CoordinationTurn { id: string; text: string; at: string; state: 'queued' | 'planning' | 'planned' | 'done' | 'failed'; memoryCaptured?: boolean; attachments?: Attachment[]; privateAttachment?: PrivateAttachmentReceipt; plan?: { reply: string; action: 'reply' | 'local' | 'project' | 'overcore'; sessionId: string | null; instruction: string | null; privateAccess?: import('./private-action').PrivateAction | null; /** Existing local worker which must receive this as a continuation, never a second task. */ taskId?: string | null }; error?: string }
/**
 * A privacy-safe projection of an execution step. `input` and `output` are
 * already redacted before they are persisted or sent to the renderer.
 */
export interface RunEvent {
  id?: string
  /** Owner message / coordination turn this status belongs to. */
  turnId?: string
  at: string
  kind: string
  text: string
  input?: string
  output?: string
  durationMs?: number
}
export interface Conversation extends ResultDelivery {
  externalResultNotices?: string[];
  supervision?: Supervision;
  id: string; title: string; workspace: string; sessionId: string | null;
  messages: Message[]; events: RunEvent[]; phase: Phase; updatedAt: string
  kind: 'central' | 'task' | 'external'; host?: 'vscode'; parentConversationId?: string; acknowledgedAt?: string; primary?: boolean
  editorRequests?: EditorRequest[]
  editorReturn?: EditorSessionReturn
  coordinationTurns?: CoordinationTurn[]; coordinationSessionId?: string;
  editorHistory?: Message[]; archivedMessages?: Message[]; editorProjectionVersion?: number; editorOnline?: boolean;
  reportSummary?: string; summaryState?: 'running' | 'ready' | 'failed'; originTurnId?: string;
  resultText?: string
}
export interface Permission { id: string; conversationId: string; tool: string; detail: string }
export type ActivitySource = 'omni' | 'vscode' | 'overcore' | 'oracle'
export type ActivityStatus = 'running' | 'waiting' | 'ready' | 'unavailable'
export interface Activity { id: string; source: ActivitySource; status: ActivityStatus; title: string; detail: string; conversationId?: string; parentConversationId?: string; workspace?: string; sessionId?: string; online?: boolean; outcome?: 'completed' | 'failed' | 'interrupted'; attention?: 'return'; child?: { id: string; title: string; status: 'running' | 'completed' } }
export interface RuntimeState {
  broker: 'starting' | 'ready' | 'degraded'; voice: boolean;
  memory: { confirmed: number; candidates: number }; missions: { id: string; objective: string; state: string }[];
  synchronization: string; error?: string
  activities: Activity[]
  update: LocalUpdateStatus
}
/** Local build update only: no package download and no project code is executed by the renderer. */
export interface LocalUpdateStatus {
  state: 'current' | 'available' | 'applying' | 'blocked';
  currentVersion: string;
  availableVersion?: string;
  /** Present only after a local update restarted into the detected build. */
  lastAppliedAt?: string;
  /** Identity of the Omni payload this Desktop process verified at startup. */
  releaseVersion?: string;
  releaseFingerprint?: string;
  releaseIntegrity?: 'verified' | 'drifted' | 'unavailable';
  autoApply: boolean;
  checkedAt: string;
  detail: string;
}
/** Provider-neutral delivery contract; unavailable adapters do not create tickets. */
export interface ResultTicket { id: string; title: string; source: ActivitySource; originConversationId: string; deliveryConversationId: string; conversationId: string; state: 'waiting' | 'working' | 'reviewing' | 'preparing' | 'ready' | 'delivering'; at?: string; previous?: boolean; kind?: 'editor-response'; evidenceId?: string }
export type AgentState = 'running' | 'waiting' | 'completed' | 'failed' | 'interrupted' | 'unknown'
export interface AgentNode { id: string; parentId?: string; title: string; state: AgentState; objective?: string; result?: string; model?: string; startedAt?: string; lastActivityAt?: string; endedAt?: string; durationMs?: number; tokens?: number; tokenScope?: 'last-call' | 'reported-total'; evidenceId?: string; progress?: string }
export interface AgentMap { conversationId: string; rootId: string; source: 'omni' | 'vscode'; nodes: AgentNode[] }
export interface Snapshot { conversations: Conversation[]; state: RuntimeState; permissions: Permission[]; results?: ResultTicket[]; agentMaps?: AgentMap[] }
export interface DesktopApi {
  openDocument(conversationId: string, reference: string): Promise<void>;
  attachmentPreview(conversationId: string, attachmentId: string): Promise<string>;
  snapshot(): Promise<Snapshot>;
  agoraView(): Promise<import('./agora').AgoraView>;
  create(): Promise<string>;
  openVsCodeWorkspace(workspace: string, title: string, sessionId?: string): Promise<string>;
  delegate(id: string, text: string): Promise<string>;
  consumeTask(id: string): Promise<string>;
  releaseResult(id: string): Promise<string>;
  acknowledgeReturns(id: string): Promise<void>;
  chooseWorkspace(id: string): Promise<void>;
  send(id: string, text: string, channel?: 'text' | 'voice', attachments?: AttachmentInput[], privateAttachmentId?: string): Promise<void>;
  cancel(id: string): Promise<void>;
  decide(id: string, allow: boolean): Promise<void>;
  resolveEditorBlock(requestId: string, allow: boolean): Promise<void>;
  openEditor(id: string): Promise<void>;
  listSessions(id: string): Promise<{ id: string; title: string }[]>;
  resume(id: string, sessionId: string): Promise<void>;
  voiceToken(id: string): Promise<{ value: string; expiresAt: number }>;
  transcribe(audio: ArrayBuffer): Promise<string>;
  prepareCredential(text: string): Promise<CredentialDraft>;
  prepareCredentialPath(path: string): Promise<CredentialDraft>;
  pickCredentialDocument(): Promise<CredentialDraft | null>;
  pickCredentialAttachment(conversationId: string): Promise<PrivateCredentialAttachment | null>;
  lookupCredentials(text: string): Promise<CredentialInventoryItem[]>;
  testCredential(id: string): Promise<CredentialVerification>;
  saveCredential(id: string): Promise<CredentialSaved>;
  savePendingCredential(id: string): Promise<CredentialSaved>;
  discardCredentials(): Promise<void>;
  stageCredentialAttachment(conversationId: string, text: string): Promise<PrivateCredentialAttachment>;
  credentialAttachment(conversationId: string): Promise<PrivateCredentialAttachment | null>;
  discardCredentialAttachment(conversationId: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  hide(): Promise<void>;
  checkForUpdate(): Promise<LocalUpdateStatus>;
  setAutoUpdate(enabled: boolean): Promise<LocalUpdateStatus>;
  applyUpdate(): Promise<void>;
  onChange(callback: (snapshot: Snapshot) => void): () => void;
}
declare global { interface Window { omni: DesktopApi } }
