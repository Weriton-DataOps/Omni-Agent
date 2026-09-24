import React, { useEffect, useState } from 'react'
import type { Attachment } from '../shared/contracts'

export function AttachmentImage({ conversationId, attachment }: { conversationId: string; attachment: Attachment }) {
  const [source, setSource] = useState('')
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    let alive = true
    void window.omni.attachmentPreview(conversationId, attachment.id).then(value => { if (alive) setSource(value) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [conversationId, attachment.id])
  useEffect(() => {
    if (!expanded) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [expanded])
  if (!source) return failed ? <small>Prévia indisponível; imagem preservada no pedido.</small> : null
  return <><button type="button" className="message-image-trigger" onClick={() => setExpanded(true)} aria-label={`Ampliar ${attachment.name}`}><img className="message-image" src={source} alt={attachment.name} /></button>
    {expanded && <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={attachment.name} onClick={() => setExpanded(false)}>
      <div className="image-lightbox-content" onClick={event => event.stopPropagation()}><button type="button" onClick={() => setExpanded(false)} aria-label="Fechar imagem">×</button><img src={source} alt={attachment.name} /></div>
    </div>}</>
}
