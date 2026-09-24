import type { Conversation } from './contracts'

/** Preserve the executor's project when its report is displayed in another chat. */
export function documentConversationId(current: Conversation, messageId: string, conversations: Conversation[]): string {
  if (messageId.startsWith('report:')) {
    const child = conversations.find(c => c.id === messageId.slice(7) && c.parentConversationId === current.id)
    if (child) return child.id
  }
  if (messageId.startsWith('editor-report:')) {
    const requestId = messageId.split(':')[1]
    const owner = conversations.find(c => c.editorRequests?.some(r => r.id === requestId && (r.deliveryConversationId || c.id) === current.id))
    if (owner) return owner.id
  }
  return current.id
}

/** A local Markdown reference, never a URL, command, UNC share or device path. */
export function documentReference(value: unknown): { path: string; fragment: string } | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  let input = value.trim().replace(/^<(.+)>$/, '$1')
  try { input = decodeURIComponent(input) } catch { return null }
  if (/[\u0000-\u001f\u007f<>"|?*]/.test(input) || /^(?:[\\/]{2}|[a-z][a-z\d+.-]*:)/i.test(input.replace(/^[a-z]:[\\/]/i, ''))) return null
  const match = input.match(/^(.+\.(?:md|markdown))(?::\d+(?::\d+)?)?(?:#([^#]*))?$/i)
  if (!match || /:/.test(match[1].replace(/^[a-z]:[\\/]/i, ''))) return null
  return { path: match[1], fragment: match[2] || '' }
}

export interface MarkdownDocument {
  path: string;
  relativePath: string;
  workspace: string;
  name: string;
  text: string;
  modifiedAt: string;
  fragment: string;
}
export interface DocumentReaderApi {
  read(): Promise<MarkdownDocument>;
  openReference(reference: string): Promise<void>;
  openUrl(url: string): Promise<void>;
}
declare global { interface Window { omniDocument: DocumentReaderApi } }
