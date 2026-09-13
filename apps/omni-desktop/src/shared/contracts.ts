import type { Supervision } from './supervision'
export type Phase = 'idle' | 'running' | 'needs-input' | 'completed' | 'interrupted' | 'failed' | 'editor'
export interface Attachment { id: string; kind: 'image' | 'text'; name: string; mime: string; size: number; preview?: string }
export interface CredentialRegistrationInput { credentialId: string; providerRef: string; accountRef: string; environmentRef: string; token: string; expiresAt: string | null; renewalMode: 'none' | 'refresh' | 'rotate' | 'reauthenticate' }
export interface CredentialReceipt { credentialId: string; version: number; providerRef: string; accountRef: string; environmentRef: string; expiresAt: string | null; status: string; secretRef: string }
export interface CredentialVerification { outcome: 'authenticated' | 'invalid-token' | 'insufficient-scope' | 'timeout' | 'unavailable' | 'rate-limited' | 'unsupported'; checkedAt: string; method: string; summary: string }
/** A temporary handle and safe projection only. Raw credentials never return to the renderer. */
export interface CredentialDraft { id: string; service: string; kind: string; expiresAt: string | null; missing: string[]; existing: { version: number; status: string } | null }
export interface CredentialSaved { version: number; status: string; disposition: 'created' | 'reused'; checkedAt: string }
/** Raw attachment content crosses only the desktop IPC boundary and is never stored in chat history. */
export interface AttachmentInput { kind: 'image' | 'text'; name?: string; mime?: string; data?: string; text?: string }
export interface Message { id: string; role: 'user' | 'assistant'; text: string; at: string; channel: 'text' | 'voice'; author?: string; origin?: 'owner' | 'omni' | 'editor'; requestId?: string; attachments?: Attachment[] }
export interface EditorRequest {
  supervision?: Supervision; followupOf?: string;
  id: string; text: string; at: string; status: 'sending' | 'sent' | 'received' | 'reported' | 'blocked' | 'uncertain' | 'summarizing' | 'completed';
  originConversationId?: string; targetSessionId?: string; targetName?: string; lastObservedAt?: string;
  report?: string; evidenceId?: string; summary?: string; reportOutcome?: 'completed' | 'blocked';
  summaryAttempted?: boolean; summaryError?: string; disconnected?: boolean; acknowledgedAt?: string;
}
export interface CoordinationTurn { id: string; text: string; at: string; state: 'queued' | 'planning' | 'planned' | 'done' | 'failed'; attachments?: Attachment[]; plan?: { reply: string; action: 'reply' | 'local' | 'project'; sessionId: string | null; instruction: string | null }; error?: string }
export interface RunEvent { at: string; kind: string; text: string }
export interface Conversation {
  supervision?: Supervision;
  id: string; title: string; workspace: string; sessionId: string | null;
  messages: Message[]; events: RunEvent[]; phase: Phase; updatedAt: string
  kind: 'central' | 'task' | 'external'; host?: 'vscode'; parentConversationId?: string; acknowledgedAt?: string; primary?: boolean
  editorRequests?: EditorRequest[]
  coordinationTurns?: CoordinationTurn[]; coordinationSessionId?: string;
  editorHistory?: Message[]; archivedMessages?: Message[]; editorProjectionVersion?: number; editorOnline?: boolean;
  reportSummary?: string; summaryState?: 'running' | 'ready' | 'failed'; originTurnId?: string;
  resultText?: string
}
export interface Permission { id: string; conversationId: string; tool: string; detail: string }
export type ActivitySource = 'omni' | 'vscode' | 'overcore' | 'oracle'
export type ActivityStatus = 'running' | 'waiting' | 'ready' | 'unavailable'
export interface Activity { id: string; source: ActivitySource; status: ActivityStatus; title: string; detail: string; conversationId?: string; parentConversationId?: string; workspace?: string; sessionId?: string; outcome?: 'completed' | 'failed' | 'interrupted'; attention?: 'return'; child?: { id: string; title: string; status: 'running' | 'completed' } }
export interface RuntimeState {
  broker: 'starting' | 'ready' | 'degraded'; voice: boolean;
  memory: { confirmed: number; candidates: number }; missions: { id: string; objective: string; state: string }[];
  synchronization: string; error?: string
  activities: Activity[]
}
export interface Snapshot { conversations: Conversation[]; state: RuntimeState; permissions: Permission[] }
export interface DesktopApi {
  snapshot(): Promise<Snapshot>;
  create(): Promise<string>;
  openVsCodeWorkspace(workspace: string, title: string, sessionId?: string): Promise<string>;
  delegate(id: string, text: string): Promise<string>;
  consumeTask(id: string): Promise<string>;
  acknowledgeReturns(id: string): Promise<void>;
  chooseWorkspace(id: string): Promise<void>;
  send(id: string, text: string, channel?: 'text' | 'voice', attachments?: AttachmentInput[]): Promise<void>;
  cancel(id: string): Promise<void>;
  decide(id: string, allow: boolean): Promise<void>;
  openEditor(id: string): Promise<void>;
  listSessions(id: string): Promise<{ id: string; title: string }[]>;
  resume(id: string, sessionId: string): Promise<void>;
  voiceToken(id: string): Promise<{ value: string; expiresAt: number }>;
  transcribe(audio: ArrayBuffer): Promise<string>;
  prepareCredential(text: string): Promise<CredentialDraft>;
  testCredential(id: string): Promise<CredentialVerification>;
  saveCredential(id: string): Promise<CredentialSaved>;
  discardCredentials(): Promise<void>;
  openUrl(url: string): Promise<void>;
  hide(): Promise<void>;
  onChange(callback: (snapshot: Snapshot) => void): () => void;
}
declare global { interface Window { omni: DesktopApi } }
