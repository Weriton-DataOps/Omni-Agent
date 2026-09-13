import React, { useEffect, useRef, useState } from 'react'
import type { CredentialDraft, CredentialVerification } from '../shared/contracts'

type Message = { role: 'owner' | 'omni'; text: string; state?: 'success' | 'problem' }
const welcome: Message = { role: 'omni', text: 'Cole ou escreva os dados de um acesso. Vou identificar o serviço, conferir se já está cadastrado e testar a conexão. Você pode revisar o texto antes de enviar; ele não entra nos logs nem no histórico.' }
const cleanError = (cause: unknown) => cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Não foi possível concluir. Tente novamente.'
const time = (value: string) => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

export function CredentialSettings({ onClose }: { onClose: () => void }) {
  const input = useRef<HTMLTextAreaElement>(null)
  const thread = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const generation = useRef(0)
  const [hasInput, setHasInput] = useState(false)
  const [messages, setMessages] = useState<Message[]>([welcome])
  const [plan, setPlan] = useState<CredentialDraft | null>(null)
  const [verification, setVerification] = useState<CredentialVerification | null>(null)
  const [busy, setBusy] = useState<'checking' | 'testing' | 'saving' | null>(null)

  const eraseInput = () => { if (input.current) input.current.value = ''; setHasInput(false) }
  const discard = () => { generation.current++; eraseInput(); void window.omni.discardCredentials().catch(() => {}) }
  const reset = () => { discard(); setMessages([welcome]); setPlan(null); setVerification(null); setBusy(null); follow.current = true }
  useEffect(() => {
    const hide = () => { if (document.hidden) reset() }
    document.addEventListener('visibilitychange', hide)
    return () => { generation.current++; if (input.current) input.current.value = ''; void window.omni.discardCredentials().catch(() => {}); document.removeEventListener('visibilitychange', hide) }
  }, [])
  useEffect(() => { if (follow.current && thread.current) thread.current.scrollTop = thread.current.scrollHeight }, [messages, plan, verification, busy])
  const append = (message: Message) => setMessages(items => [...items.slice(-29), message])

  const test = async (draft: CredentialDraft, epoch: number) => {
    setBusy('testing'); setVerification(null)
    try {
      const result = await window.omni.testCredential(draft.id)
      if (epoch !== generation.current) return
      setVerification(result)
      append({ role: 'omni', state: result.outcome === 'authenticated' ? 'success' : 'problem', text: result.summary + '\nVerificação: ' + time(result.checkedAt) + '.' })
    } catch (cause) {
      if (epoch === generation.current) append({ role: 'omni', state: 'problem', text: cleanError(cause) })
    } finally { if (epoch === generation.current) setBusy(null) }
  }

  const send = async () => {
    if (busy || !input.current?.value.trim()) return
    const raw = input.current.value
    eraseInput()
    const epoch = ++generation.current
    setPlan(null); setVerification(null); setBusy('checking'); follow.current = true
    append({ role: 'owner', text: 'Dados do acesso enviados de forma privada.' })
    try {
      const draft = await window.omni.prepareCredential(raw)
      if (epoch !== generation.current) return
      setPlan(draft)
      const expiry = draft.expiresAt ? ' Vencimento informado: ' + new Date(draft.expiresAt).toLocaleDateString('pt-BR') + '.' : ' Vencimento não informado.'
      const existing = draft.existing ? ' Já há um cadastro, versão ' + draft.existing.version + '. Vou conferir os dados recebidos antes de qualquer atualização.' : ' Nenhum cadastro com essa identidade foi encontrado.'
      append({ role: 'omni', text: draft.service + '.' + existing + expiry })
      if (draft.missing.length) { append({ role: 'omni', state: 'problem', text: 'Preciso completar: ' + draft.missing.join(', ') + '. Reenvie os dados completos no campo protegido.' }); setBusy(null); return }
      await test(draft, epoch)
    } catch (cause) {
      if (epoch === generation.current) { append({ role: 'omni', state: 'problem', text: cleanError(cause) }); setBusy(null) }
    }
  }

  const save = async () => {
    if (!plan || busy || verification?.outcome !== 'authenticated') return
    const epoch = generation.current
    setBusy('saving')
    try {
      const saved = await window.omni.saveCredential(plan.id)
      if (epoch !== generation.current) return
      setPlan(null); setVerification(null)
      setMessages([{ role: 'omni', state: 'success', text: saved.disposition === 'reused' ? 'Esse acesso já estava guardado. O teste foi registrado na versão ' + saved.version + ', sem criar uma cópia.' : 'Acesso testado e guardado no Crachá. Versão ' + saved.version + '. Os dados temporários foram descartados.' }])
      void window.omni.discardCredentials().catch(() => {})
    } catch (cause) {
      if (epoch === generation.current) { setVerification(null); append({ role: 'omni', state: 'problem', text: cleanError(cause) }) }
    } finally { if (epoch === generation.current) setBusy(null) }
  }

  return <section className="credential-settings credential-chat" role="dialog" aria-modal="true" aria-label="Crachá de acessos">
    <div className="credential-top"><div><span>CRACHÁ</span><small>Conversa privada · sem histórico</small></div><div className="credential-top-actions"><button onClick={reset} disabled={busy === 'saving'}>Limpar conversa</button><button onClick={() => { discard(); onClose() }} aria-label="Fechar Crachá">×</button></div></div>
    <div className="credential-thread" ref={thread} role="log" aria-live="polite" onScroll={() => { const el = thread.current; if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }}>
      {messages.map((message, index) => <article className={'credential-message ' + message.role + ' ' + (message.state || '')} key={index}><small>{message.role === 'owner' ? 'VOCÊ' : 'Omni'}</small><p>{message.text}</p></article>)}
      {busy && <article className="credential-message omni credential-progress" role="status"><span className="credential-spinner" /><p>{busy === 'checking' ? 'Conferindo o Crachá…' : busy === 'testing' ? 'Testando o acesso…' : 'Conferindo e guardando…'}</p></article>}
      {plan && !busy && !plan.missing.length && <div className="credential-actions">
        {verification?.outcome === 'authenticated'
          ? <button className="credential-primary" onClick={() => void save()}>{plan.existing ? 'Atualizar acesso' : 'Guardar no Crachá'}</button>
          : <button onClick={() => void test(plan, generation.current)}>Tentar teste novamente</button>}
        <button onClick={reset}>Descartar</button>
      </div>}
    </div>
    <form className="credential-composer-area" onSubmit={event => { event.preventDefault(); void send() }}>
      <div className="credential-chat-composer"><textarea ref={input} aria-label="Dados do acesso" placeholder="Cole ou escreva os dados do acesso…" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} maxLength={12000} data-1p-ignore onInput={() => setHasInput(Boolean(input.current?.value.trim()))} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} /><button type="submit" disabled={!hasInput || !!busy}>Conferir acesso</button></div>
      <small>O texto não entra nos logs nem no histórico. Ao guardar, o segredo fica no cofre.</small>
    </form>
  </section>
}
