import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DocumentLinks, MessageText } from './MessageText'
import type { MarkdownDocument } from '../shared/document-reference'
import './document.css'

function DocumentReader() {
  const [document, setDocument] = useState<MarkdownDocument | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const [source, setSource] = useState(false)
  const act = async (action: () => Promise<unknown>) => {
    setError('')
    try { await action() } catch (error) { setError((error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')) }
  }
  const read = async () => {
    setBusy(true)
    await act(async () => { const result = await window.omniDocument.read(); setDocument(result); window.document.title = `${result.name} · Omni` })
    setBusy(false)
  }
  useEffect(() => {
    void read()
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') window.close() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [])
  useEffect(() => {
    if (document?.fragment && !source) window.document.getElementById(document.fragment)?.scrollIntoView()
  }, [document, source])
  return <DocumentLinks.Provider value={{ openDocument: reference => void act(() => window.omniDocument.openReference(reference)), openUrl: url => void act(() => window.omniDocument.openUrl(url)) }}>
    <header className="document-toolbar"><div><span>OMNI · DOCUMENTO</span><h1>{document?.name || 'Abrindo documento…'}</h1><p title={document?.path}>{document?.path || 'Leitura local · somente consulta'}</p></div><nav aria-label="Documento"><button onClick={() => setSource(!source)} aria-pressed={source}>{source ? 'Ver formatado' : 'Ver Markdown'}</button><button disabled={busy} onClick={() => void read()}>Atualizar</button><button onClick={() => window.close()}>Fechar</button></nav></header>
    {error && <p role="alert" className="document-error">{error}</p>}
    <main className="document-content" aria-busy={busy}>
      {document && (source ? <pre className="document-source">{document.text}</pre> : <MessageText text={document.text} />)}
      {!document && !error && <p role="status">Lendo documento…</p>}
    </main>
    {document && <footer>Somente leitura · arquivo local · modificado em {new Date(document.modifiedAt).toLocaleString('pt-BR')}</footer>}
  </DocumentLinks.Provider>
}
createRoot(document.getElementById('root')!).render(<DocumentReader />)
