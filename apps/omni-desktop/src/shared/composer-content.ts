import type { AttachmentInput } from './contracts'

// Only clipboard content belongs in this attachment. Never pass the draft here:
// native paste would otherwise merge it (or replace a selection) before we act.
export function pastedTextAttachments(pastedText: string, attachments: AttachmentInput[]) {
  if (pastedText.trim().length <= 6000) return null
  return normalizeComposer(pastedText, attachments).attachments
}

export function normalizeComposer(text: string, attachments: AttachmentInput[]) {
  if (text.length > 256000) throw new Error('O texto excede o limite de 256 mil caracteres. Divida em anexos menores.')
  if (text.trim().length <= 6000) return { text, attachments }
  if (attachments.length >= 8) throw new Error('Remova um anexo para adicionar este texto. O rascunho foi preservado.')
  return { text: '', attachments: [...attachments, { kind: 'text' as const, name: 'mensagem-longa.txt', mime: 'text/plain', text }] }
}
