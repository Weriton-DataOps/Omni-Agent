import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Attachment } from '../shared/contracts'
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

const maxAttachmentPromptLength = 24000

export function attachmentPath(directory: string, conversationId: string, attachment: Attachment) {
  if (![conversationId, attachment.id].every(value => /^[a-zA-Z0-9_-]{1,100}$/.test(value))) throw new Error('Referência de anexo inválida.')
  const extension = attachment.kind === 'text' ? 'txt' : ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' } as Record<string, string>)[attachment.mime]
  if (!extension) throw new Error('Formato de anexo inválido.')
  return join(directory, 'attachments', conversationId, `${attachment.id}.${extension}`)
}

export function attachmentNotice(attachments: Attachment[]) {
  if (attachments.length === 1) {
    const attachment = attachments[0]
    return attachment.kind === 'text'
      ? `O proprietario enviou um texto no anexo ${attachment.name}. Leia o anexo antes de responder.`
      : `O proprietario enviou a imagem ${attachment.name} como anexo.`
  }
  return `O proprietario enviou ${attachments.length} anexos. Consulte-os antes de responder.`
}

/** Attachment bytes stay outside Message history; this projection exists only for inference. */
export async function attachmentPrompt(directory: string, conversationId: string, attachments: Attachment[] = [], mode: 'executor' | 'model' = 'executor') {
  const sections: string[] = []
  let remaining = maxAttachmentPromptLength
  for (const attachment of attachments) {
    const path = attachmentPath(directory, conversationId, attachment)
    try {
      const bytes = await readFile(path)
      if (attachment.kind === 'image') {
        sections.push(`[Imagem privada ${JSON.stringify(attachment.name)}: ${JSON.stringify(path)}. Leia este arquivo com Read antes de executar; não é apenas um nome de imagem.]`)
        continue
      }
      const raw = bytes.toString('utf8')
      if (mode === 'model' && raw.length > 256000) throw new Error('Texto excede o limite de processamento.')
      const content = mode === 'model' ? raw : raw.slice(0, Math.max(0, remaining))
      remaining -= content.length
      sections.push(`[Anexo privado: ${JSON.stringify(attachment.name)}; arquivo integral: ${JSON.stringify(path)}]\n${content}${content.length < raw.length ? '\n[Prévia parcial. Leia o arquivo integral com Read antes de executar. Não descarte o restante.]' : ''}`)
    } catch {
      throw new Error('Não foi possível ler um anexo. O pedido não será encaminhado sem seu conteúdo.')
    }
  }
  return sections.join('\n\n')
}

/** Images go as vision blocks to the tool-free coordinator, not as empty labels. */
export async function modelPrompt(prompt: string, directory: string, conversationId: string, attachments: Attachment[] = []): Promise<string | AsyncIterable<SDKUserMessage>> {
  const images = attachments.filter(a => a.kind === 'image')
  if (!images.length) return prompt
  const content: SDKUserMessage['message']['content'] = [{ type: 'text', text: prompt }]
  for (const attachment of images) {
    const data = await readFile(attachmentPath(directory, conversationId, attachment))
    content.push({ type: 'image', source: { type: 'base64', media_type: attachment.mime as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif', data: data.toString('base64') } })
  }
  return (async function* (): AsyncGenerator<SDKUserMessage> {
    yield { type: 'user', session_id: '', parent_tool_use_id: null, message: { role: 'user', content } }
  })()
}
