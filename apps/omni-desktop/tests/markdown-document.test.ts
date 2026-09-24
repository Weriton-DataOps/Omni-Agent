import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readMarkdownDocument, MAX_MARKDOWN_BYTES } from '../src/main/markdown-document'
import { documentReference, documentConversationId } from '../src/shared/document-reference'
import type { Conversation } from '../src/shared/contracts'

test('referências Markdown aceitam caminhos com espaços, codificação, linha e fragmento', () => {
  assert.deepEqual(documentReference('planejamentos/fase1-station.md'), { path: 'planejamentos/fase1-station.md', fragment: '' })
  assert.deepEqual(documentReference('<C:\\Projeto novo\\plano.md:12>'), { path: 'C:\\Projeto novo\\plano.md', fragment: '' })
  assert.deepEqual(documentReference('docs/vis%C3%A3o%20geral.md#etapa-1'), { path: 'docs/visão geral.md', fragment: 'etapa-1' })
  for (const path of ['https://example.com/x.md', 'file:///x.md', 'javascript:x.md', '//host/x.md', '\\\\host\\x.md', 'C:\\x.md:secret', 'x.json', 'x.md\0', 'x%00.md', 'bad%q.md']) assert.equal(documentReference(path), null, path)
})

test('abre apenas Markdown do projeto da conversa, sem adivinhar outro destino', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'omni-document-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const workspace = join(directory, 'project'), docs = join(workspace, 'planejamentos')
  await mkdir(docs, { recursive: true })
  const path = join(docs, 'fase1-station.md')
  await writeFile(path, '# Plano\n\nConteúdo com acentuação.')
  const result = await readMarkdownDocument(workspace, 'planejamentos/fase1-station.md#plano')
  assert.equal(result.name, 'fase1-station.md')
  assert.equal(result.text, '# Plano\n\nConteúdo com acentuação.')
  assert.equal(result.fragment, 'plano')
  assert.equal((await readMarkdownDocument(workspace, './fase1-station.md', docs)).path, result.path)
  assert.equal((await readMarkdownDocument(workspace, path + ':12')).path, result.path)
  await assert.rejects(readMarkdownDocument(workspace, 'README.md'), /não encontrado/)
  await writeFile(join(directory, 'outside.md'), 'fora')
  await assert.rejects(readMarkdownDocument(workspace, '../outside.md'), /fora da pasta/)
  await assert.rejects(readMarkdownDocument(workspace, '%2E%2E/outside.md'), /fora da pasta/)
  await assert.rejects(readMarkdownDocument(workspace, join(directory, 'outside.md')), /fora da pasta/)
  await symlink(directory, join(workspace, 'escape'), 'junction')
  await assert.rejects(readMarkdownDocument(workspace, 'escape/outside.md'), /fora da pasta/)
  await writeFile(join(workspace, 'large.md'), Buffer.alloc(MAX_MARKDOWN_BYTES + 1))
  await assert.rejects(readMarkdownDocument(workspace, 'large.md'), /2 MB/)
  await mkdir(join(workspace, 'directory.md'))
  await assert.rejects(readMarkdownDocument(workspace, 'directory.md'), /não é um arquivo/)
  await writeFile(join(workspace, 'binary.md'), 'texto\0binário')
  await assert.rejects(readMarkdownDocument(workspace, 'binary.md'), /texto Markdown válido/)
  await assert.rejects(readMarkdownDocument(workspace, 'secret.json'), /não aponta/)
})

test('relatório devolvido no chat central abre no projeto de origem do executor', () => {
  const central = { id: 'central' } as Conversation
  const task = { id: 'child', parentConversationId: 'central' } as Conversation
  const editor = { id: 'editor', editorRequests: [{ id: 'request', deliveryConversationId: 'central' }] } as Conversation
  const conversations = [central, task, editor]
  assert.equal(documentConversationId(central, 'report:child', conversations), 'child')
  assert.equal(documentConversationId(central, 'editor-report:request:evidence', conversations), 'editor')
  assert.equal(documentConversationId(central, 'report:unknown', conversations), 'central')
  assert.equal(documentConversationId(editor, 'report:child', conversations), 'editor')
})
