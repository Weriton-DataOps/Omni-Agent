export type Phase = 'idle' | 'running' | 'needs-input' | 'completed' | 'interrupted' | 'failed' | 'editor'
export interface Message { id: string; role: 'user' | 'assistant'; text: string; at: string; channel: 'text' | 'voice' }
export interface RunEvent { at: string; kind: string; text: string }
export interface Conversation {
  id: string; title: string; workspace: string; sessionId: string | null;
  messages: Message[]; events: RunEvent[]; phase: Phase; updatedAt: string
}
export interface Permission { id: string; conversationId: string; tool: string; detail: string }
export type ActivitySource = 'omni' | 'vscode' | 'overcore' | 'oracle'
export type ActivityStatus = 'running' | 'waiting' | 'ready' | 'unavailable'
export interface Activity { id: string; source: ActivitySource; status: ActivityStatus; title: string; detail: string; conversationId?: string }
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
  delegate(id: string, text: string): Promise<string>;
  chooseWorkspace(id: string): Promise<void>;
  send(id: string, text: string, channel?: 'text' | 'voice'): Promise<void>;
  cancel(id: string): Promise<void>;
  decide(id: string, allow: boolean): Promise<void>;
  openEditor(id: string): Promise<void>;
  listSessions(id: string): Promise<{ id: string; title: string }[]>;
  resume(id: string, sessionId: string): Promise<void>;
  voiceToken(id: string): Promise<{ value: string; expiresAt: number }>;
  transcribe(audio: ArrayBuffer): Promise<string>;
  hide(): Promise<void>;
  onChange(callback: (snapshot: Snapshot) => void): () => void;
}
declare global { interface Window { omni: DesktopApi } }
