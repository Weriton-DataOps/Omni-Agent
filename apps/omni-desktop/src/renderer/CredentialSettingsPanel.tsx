import React, { useRef, useState } from 'react'
import type { PrivateCredentialAttachment } from '../shared/contracts'

const cleanError = (cause: unknown) => cause instanceof Error
  ? cause.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
  : 'Não foi possível anexar o dado privado. Tente novamente.'

type Props = {
  conversationId: string
  conversationTitle: string
  onAttach: (attachment: PrivateCredentialAttachment) => void
  onClose: () => void
}

/** Private intake only: no parsing, validation, test or save happens here. */
export function CredentialSettings({ conversationId, conversationTitle, onAttach, onClose }: Props) {
  const input = useRef<HTMLTextAreaElement>(null)
  const [hasInput, setHasInput] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const finish = (attachment: PrivateCredentialAttachment) => {
    onAttach(attachment)
    if (input.current) input.current.value = ''
    onClose()
  }
  const attachText = async () => {
    const text = input.current?.value || ''
    if (busy || !text.trim()) return
    setBusy(true); setError('')
    try { finish(await window.omni.stageCredentialAttachment(conversationId, text)) }
    catch (cause) { setError(cleanError(cause)) }
    finally { setBusy(false) }
  }
  const attachJson = async () => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const attachment = await window.omni.pickCredentialAttachment(conversationId)
      if (attachment) finish(attachment)
    } catch (cause) { setError(cleanError(cause)) }
    finally { setBusy(false) }
  }

  return <section className="credential-popover" role="dialog" aria-modal="true" aria-label="Anexo privado do Crachá">
    <header><span>CRACHÁ · anexo privado <small>{conversationTitle}</small></span><button type="button" onClick={onClose} aria-label="Fechar anexo privado">×</button></header>
    <p className="credential-popover-notice">Anexe um texto ou JSON como contexto privado da próxima mensagem. O Omni recebe e trata esse contexto sem expor os valores no chat. Anexar não valida nem cadastra automaticamente.</p>
    <p className="credential-popover-notice">SSH + PostgreSQL: separe os acessos em blocos ou use JSON com ssh, database e mode. No modo sudo-postgres, a ponte executa psql dentro do servidor com a permissão já existente. Depois, peça o uso na mensagem; nenhuma senha vai para a sessão.</p>
    {error && <p className="credential-popover-notice problem" role="alert">{error}</p>}
    <form className="credential-composer-area" onSubmit={event => { event.preventDefault(); void attachText() }}>
      <div className="credential-chat-composer credential-popover-input">
        <textarea ref={input} aria-label="Anexo privado para o Omni" placeholder="Ex.: é o token da Vercel para eu usar depois nos sites; valor: …" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} maxLength={12000} data-1p-ignore onInput={() => setHasInput(Boolean(input.current?.value.trim()))} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void attachText() } }} />
        <button type="button" onClick={() => void attachJson()} disabled={busy}>Selecionar JSON</button>
        <button type="submit" disabled={!hasInput || busy}>{busy ? 'Anexando…' : 'Anexar ao Omni'}</button>
      </div>
      <small>O contexto fica criptografado pela sua conta Windows e sobrevive ao reinício, por até 30 dias antes do cadastro. Ao autorizar guardar ou usar, o Omni cadastra os acessos sem teste obrigatório e os vincula à tarefa. Senhas não aparecem no chat, histórico ou VS Code. Cadastro não significa conexão validada.</small>
    </form>
  </section>
}
