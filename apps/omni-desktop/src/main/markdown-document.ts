import { open, realpath } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import { documentReference, type MarkdownDocument } from '../shared/document-reference'

export const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024
function inside(root: string, target: string) {
  const path = relative(root, target)
  return path !== '..' && !path.startsWith('..\\') && !path.startsWith('../') && !isAbsolute(path)
}

/** Read-only, scoped to the owning conversation. No search in neighboring projects. */
export async function readMarkdownDocument(workspace: string, reference: unknown, base = workspace): Promise<MarkdownDocument> {
  const parsed = documentReference(reference)
  if (!parsed) throw new Error('Este link não aponta para um documento Markdown local (.md).')
  const root = await realpath(workspace).catch(() => { throw new Error('A pasta desta sessão não está disponível.') })
  const target = resolve(base, parsed.path)
  if (!inside(resolve(workspace), target) && !inside(root, target)) throw new Error('O documento está fora da pasta desta sessão.')
  const path = await realpath(target).catch(() => { throw new Error(`Documento não encontrado nesta sessão: ${parsed.path}`) })
  if (!inside(root, path)) throw new Error('O documento aponta para fora da pasta desta sessão.')
  if (!documentReference(path)) throw new Error('O destino real não é um arquivo Markdown.')
  const file = await open(path, 'r')
  try {
    const info = await file.stat()
    if (!info.isFile()) throw new Error('O caminho não é um arquivo Markdown.')
    if (info.size > MAX_MARKDOWN_BYTES) throw new Error('Documento muito grande para o leitor (limite: 2 MB).')
    // Bounded even if another process appends while we are reading.
    const buffer = Buffer.alloc(MAX_MARKDOWN_BYTES + 1)
    let count = 0
    while (count < buffer.length) {
      const chunk = await file.read(buffer, count, buffer.length - count, null)
      if (!chunk.bytesRead) break
      count += chunk.bytesRead
    }
    if (count > MAX_MARKDOWN_BYTES) throw new Error('Documento muito grande para o leitor (limite: 2 MB).')
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, count))
    if (text.includes('\0')) throw new Error('Este arquivo não contém texto Markdown válido.')
    return { path, relativePath: relative(root, path), workspace: root, name: basename(path), text, modifiedAt: info.mtime.toISOString(), fragment: parsed.fragment }
  } finally { await file.close() }
}
