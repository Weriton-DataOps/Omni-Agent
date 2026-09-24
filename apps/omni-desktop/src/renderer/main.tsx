import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Attachment, AttachmentInput, Snapshot, Activity, EditorRequest, LocalUpdateStatus, ResultTicket, AgentMap, PrivateCredentialAttachment, RunEvent } from '../shared/contracts'
import { Voice } from './voice'
import { pendingCoordinationTurns } from '../shared/coordination-state'
import { RealtimePanel } from './RealtimePanel'
import { Dictation } from './dictation'
import { AudioSettings } from './AudioSettingsPanel'
import { CredentialSettings } from './CredentialSettingsPanel'
import { MessageText, DocumentLinks } from './MessageText'
import { documentConversationId } from '../shared/document-reference'
import { QuickReveal } from './QuickReveal'
import { AttachmentImage } from './AttachmentImage'
import { AgentMapPanel } from './AgentMapPanel'
import { AgoraPanel } from './AgoraPanel'
import { cardMessageId, cardReturnBatch, currentCardReturn, pendingEditorRequests } from '../shared/card-return'
import { normalizeComposer, pastedTextAttachments } from '../shared/composer-content'
import { UpdatePanel } from './UpdatePanel'
import { canApproveBlocker } from '../shared/supervision'
import './style.css'
import './heritage.css'
const labels: Record<string, string> = { idle: 'Pronto', running: 'Trabalhando', 'needs-input': 'Sua decisão', completed: 'Rodada concluída', interrupted: 'Interrompida', failed: 'Precisa de atenção', editor: 'No VS Code' }
function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [selected, select] = useState('')
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<AttachmentInput[]>([])
  const draftRevision = useRef(0)
  const updateDraft = (value: string) => {
    draftRevision.current++
    setDraft(value)
  }
  const [error, setError] = useState('')
  const [voiceStatus, setVoiceStatus] = useState('Voz desligada')
  const [realtime, setRealtime] = useState(false)
  const [muted, setMuted] = useState(false)
  const [dictationStatus, setDictationStatus] = useState('')
  const [dictationLevel, setDictationLevel] = useState(0)
  const [help, setHelp] = useState(false)
  const [audioSettings, setAudioSettings] = useState(false)
  const [agentMapId, setAgentMapId] = useState('')
  const selectedMap = snapshot?.agentMaps?.find(map => map.conversationId === agentMapId)
  const [credentialSettings, setCredentialSettings] = useState(false)
  const [credentialAttachment, setCredentialAttachment] = useState<PrivateCredentialAttachment | null>(null)
  const [updateSettings, setUpdateSettings] = useState(false)
  const [conversationMenu, setConversationMenu] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [agora, setAgora] = useState(false)
  const [followingLatest, setFollowingLatest] = useState(true)
  const [runningSeconds, setRunningSeconds] = useState(0)
  const [submitting, setSubmitting] = useState<Record<string, number>>({})
  const submit = async (id: string, text: string, channel: 'text' | 'voice', outgoing?: AttachmentInput[], privateAttachmentId?: string) => {
    setSubmitting(previous => ({ ...previous, [id]: (previous[id] || 0) + 1 }))
    try {
      await window.omni.send(id, text, channel, outgoing, privateAttachmentId)
      // A failed readback must never restore a message already accepted by main.
      const remaining = await window.omni.credentialAttachment(id).catch(() => undefined)
      if (visibleId.current === id && remaining !== undefined) setCredentialAttachment(previous => !privateAttachmentId || previous?.id === privateAttachmentId ? remaining : previous)
      const latest = await window.omni.snapshot().catch(() => null)
      if (latest) setSnapshot(latest)
    } finally {
      setSubmitting(previous => ({ ...previous, [id]: Math.max(0, (previous[id] || 0) - 1) }))
    }
  }
  const releasing = useRef(new Set<string>())
  const [revealing, setRevealing] = useState<string[]>([])
  const amplitude = useRef(0)
  const dictation = useRef<Dictation | null>(null)
  const stateRef = useRef(snapshot); stateRef.current = snapshot
  const messages = useRef<HTMLDivElement>(null)
  const revealTarget = useRef<HTMLElement | null>(null)
  const composerInput = useRef<HTMLTextAreaElement>(null)
  const attachmentPicker = useRef<HTMLInputElement>(null)
  const followLatestRef = useRef(true)
  const displayedConversation = useRef('')
  const navigationEpoch = useRef(0)
  const voice = useRef<Voice | null>(null)
  const act = async (action: () => Promise<unknown>) => { setError(''); try { await action() } catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')) } }
  useEffect(() => {
    const pasteContent = (event: ClipboardEvent) => {
      if (!composerInput.current || composerInput.current.disabled || document.activeElement !== composerInput.current) return
      const files = Array.from(event.clipboardData?.files || []).filter(file => file.type.startsWith('image/'))
      if (files.length) {
        event.preventDefault()
        void addImageFiles(files)
        return
      }
      const pastedText = event.clipboardData?.getData('text/plain') || ''
      if (pastedText.trim().length <= 6000) return // Keep native caret/selection behavior for short text.
      event.preventDefault()
      try {
        const next = pastedTextAttachments(pastedText, attachments)
        if (next) { draftRevision.current++; setAttachments(next); setError('') }
      } catch (error) {
        setError(`${(error as Error).message} O texto colado não foi anexado; a mensagem anterior continua na caixa.`)
      }
    }
    window.addEventListener('paste', pasteContent)
    return () => window.removeEventListener('paste', pasteContent)
  })
  useEffect(() => {
    void window.omni.snapshot().then(setSnapshot)
    const off = window.omni.onChange(setSnapshot)
    voice.current = new Voice(window.omni, setVoiceStatus, async (id, text) => {
      await submit(id, text, 'voice')
      const updated = await window.omni.snapshot()
      const conversation = updated.conversations.find(c => c.id === id)
      if (conversation?.kind === 'external' || conversation?.kind === 'central') return 'Pedido recebido. Vou organizar o encaminhamento e acompanhar por esta conversa.'
      return conversation?.messages.filter(m => m.role === 'assistant').at(-1)?.text || 'Não recebi uma resposta.'
    }, n => { amplitude.current = n })
    dictation.current = new Dictation(window.omni, setDictationStatus, text => setDraft(previous => [previous, text].filter(Boolean).join(' ')), setDictationLevel)
    const unload = () => { voice.current?.stop(); dictation.current?.cancel() }
    window.addEventListener('beforeunload', unload)
    return () => { off(); unload(); window.removeEventListener('beforeunload', unload) }
  }, [])
  const primaryConversation = snapshot?.conversations.find(c => c.kind === 'central' && c.primary) || snapshot?.conversations.find(c => c.kind === 'central')
  const current = snapshot?.conversations.find(c => c.id === selected && c.kind !== 'task') || primaryConversation || snapshot?.conversations[0]
  const visibleId = useRef(current?.id); visibleId.current = current?.id
  useEffect(() => {
    let active = true
    if (!current) { setCredentialAttachment(null); return () => { active = false } }
    void window.omni.credentialAttachment(current.id).then(attachment => { if (active) setCredentialAttachment(attachment) }).catch(() => { if (active) setCredentialAttachment(null) })
    return () => { active = false }
  }, [current?.id, current?.messages.at(-1)?.id])
  const busy = current ? ['running', 'needs-input'].includes(current.phase) : false
  const pendingTurns = pendingCoordinationTurns(current, snapshot?.conversations || [])
  const pendingCoordination = pendingTurns.length > 0 || !!(current && submitting[current.id])
  const streamingReply = current?.messages.findLast(message => message.role === 'assistant' && message.streaming && !message.interrupted)
  const thinking = busy || pendingCoordination || !!streamingReply
  useEffect(() => {
    if (!thinking) { setRunningSeconds(0); return }
    setRunningSeconds(0)
    const timer = window.setInterval(() => setRunningSeconds(seconds => seconds + 1), 1000)
    return () => window.clearInterval(timer)
  }, [thinking, current?.id, pendingTurns[0]?.id])
  useEffect(() => {
    const input = composerInput.current
    if (!input) return
    input.style.height = 'auto'
    const cap = 21 * 8
    input.style.height = `${Math.min(input.scrollHeight, cap)}px`
    input.style.overflowY = input.scrollHeight > cap ? 'auto' : 'hidden'
  }, [draft])
  const scrollToLatest = () => {
    followLatestRef.current = true; setFollowingLatest(true)
    messages.current?.scrollTo({ top: messages.current.scrollHeight, behavior: 'smooth' })
  }
  /** Keep the first line of a prepared return in view while its already-saved text is revealed. */
  const pinRevealToTop = () => {
    const container = messages.current, target = revealTarget.current
    if (!container || !target) return
    followLatestRef.current = false; setFollowingLatest(false)
    const top = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
    // Begin the short upward glide together with the type-on animation. The
    // tail spacer makes the destination reachable even before enough text has
    // appeared to overflow the viewport.
    container.scrollTo({ top: Math.max(0, top - 8), behavior: 'smooth' })
  }
  const release = (result: ResultTicket) => { void act(async () => {
    if (releasing.current.has(result.id)) return
    releasing.current.add(result.id)
    if (visibleId.current !== result.deliveryConversationId) change(result.deliveryConversationId)
    else setHistoryOpen(false)
    const intent = navigationEpoch.current
    const batch = cardReturnBatch(stateRef.current?.results || [], result.conversationId, result.source, result.id)
    const messageId = cardMessageId(batch[0] || result)
    // Arm presentation before IPC can publish its snapshot. Never flash full text.
    if (!stateRef.current?.conversations.find(c => c.id === result.deliveryConversationId)?.messages.some(m => m.id === messageId)) setRevealing(ids => [...ids, messageId])
    try {
      await window.omni.releaseResult(result.id)
      setSnapshot(await window.omni.snapshot())
      if (intent !== navigationEpoch.current) return
      // The reveal needs a tail spacer and a committed React layout before its
      // first line can be placed at the top rather than at the bottom edge.
      window.requestAnimationFrame(() => window.requestAnimationFrame(pinRevealToTop))
    } catch (error) { setRevealing(ids => ids.filter(id => id !== messageId)); throw error }
    finally { releasing.current.delete(result.id) }
  }) }
  const updateStatus: LocalUpdateStatus = snapshot?.state.update || {
    state: 'current', currentVersion: 'carregando', autoApply: false,
    checkedAt: new Date(0).toISOString(), detail: 'Conferindo a build local.'
  }
  const checkForUpdate = async () => {
    await window.omni.checkForUpdate()
    setSnapshot(await window.omni.snapshot())
  }
  const setAutoUpdate = async (enabled: boolean) => {
    await window.omni.setAutoUpdate(enabled)
    setSnapshot(await window.omni.snapshot())
  }
  const applyUpdate = async () => { await window.omni.applyUpdate() }
  const openActivity = (activity: Activity) => {
    const result = currentCardReturn(snapshot?.results || [], activity.conversationId, activity.source)
    if (activity.status !== 'running' && result?.state === 'ready' && (activity.source !== 'vscode' || activity.attention === 'return')) { release(result); return }
    if (activity.source === 'omni' && activity.parentConversationId) {
      change(activity.parentConversationId)
      return
    }
    // Already-observed sessions open immediately; a click never rebinds or starts work.
    if (activity.conversationId) { if (visibleId.current !== activity.conversationId) change(activity.conversationId); else setHistoryOpen(false); return }
    void act(async () => {
    const intent = ++navigationEpoch.current
    if (activity.source === 'vscode' && activity.workspace) {
      const id = await window.omni.openVsCodeWorkspace(activity.workspace, activity.title, activity.sessionId)
      setSnapshot(await window.omni.snapshot()); if (intent === navigationEpoch.current) change(id)
    } else if (activity.conversationId) change(activity.conversationId)
    })
  }
  useEffect(() => {
    if (!current) return
    if (displayedConversation.current !== current.id) {
      displayedConversation.current = current.id
      followLatestRef.current = true; setFollowingLatest(true)
    }
    if (followLatestRef.current) messages.current?.scrollTo({ top: messages.current.scrollHeight })
  }, [current?.id, current?.messages.at(-1)?.text, current?.messages.at(-1)?.attachments?.map(attachment => attachment.id).join(','), thinking])
  const change = (id: string) => { navigationEpoch.current++; closeVoice(); dictation.current?.cancel(); setError(''); setHistoryOpen(false); setDictationStatus(''); setDictationLevel(0); setCredentialAttachment(null); followLatestRef.current = true; setFollowingLatest(true); select(id); setConversationMenu(false); setDraft(''); setAttachments([]); void window.omni.acknowledgeReturns(id).catch(() => {}) }
  useLayoutEffect(() => {
    if (historyOpen) { followLatestRef.current = false; setFollowingLatest(false); messages.current?.scrollTo({ top: 0 }) }
    else if (followLatestRef.current) messages.current?.scrollTo({ top: messages.current.scrollHeight })
  }, [historyOpen])
  const addImageFiles = async (files: File[]) => {
    const originId = visibleId.current
    const navigation = navigationEpoch.current
    draftRevision.current++
    const eligible = files.filter(file => file.type.startsWith('image/') && file.size <= 5 * 1024 * 1024).slice(0, Math.max(0, 8 - attachments.length))
    if (eligible.length !== files.length) setError('Use imagens de no mÃ¡ximo 5 MB; o limite Ã© oito anexos por mensagem.')
    const items = await Promise.all(eligible.map(file => new Promise<AttachmentInput>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const data = String(reader.result)
        const image = new Image()
        image.onload = () => resolve({ kind: 'image', name: file.name, mime: file.type, data, width: image.naturalWidth, height: image.naturalHeight })
        image.onerror = () => resolve({ kind: 'image', name: file.name, mime: file.type, data })
        image.src = data
      }
      reader.onerror = () => reject(new Error('NÃ£o foi possÃ­vel ler a imagem.'))
      reader.readAsDataURL(file)
    })))
    if (visibleId.current !== originId || navigationEpoch.current !== navigation) return
    draftRevision.current++
    setAttachments(previous => [...previous, ...items].slice(0, 8))
  }
  const send = () => {
    if (!current) return
    if (current.kind === 'external' && current.editorOnline === false) {
      setError('Esta sessão do VS Code está fechada. Abra o projeto novamente ou continue no chat central.')
      return
    }
    const outgoing = [...attachments]
    let text = draft
    try { const next = normalizeComposer(text, outgoing); text = next.text; outgoing.splice(0, outgoing.length, ...next.attachments) }
    catch (error) { setError((error as Error).message); return }
    if (!text.trim() && !outgoing.length && !credentialAttachment) return
    setDraft('')
    setAttachments([])
    const originId = current.id
    const revision = ++draftRevision.current
    const navigation = navigationEpoch.current
    setError('')
    void submit(originId, text, 'text', outgoing, credentialAttachment?.id).catch(e => {
      if (visibleId.current === originId && navigationEpoch.current === navigation && draftRevision.current === revision) { setDraft(text); setAttachments(outgoing) }
      if (visibleId.current === originId) setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
    })
  }
  const closeVoice = () => { voice.current?.stop(); setRealtime(false); setMuted(false) }
  const toggleVoice = () => {
    if (realtime) { closeVoice(); return }
    if (!current || !snapshot?.state.voice || current.editorOnline === false || dictation.current?.active) return
    setMuted(false); setRealtime(true); void voice.current?.start(current.id)
  }
  const shortcuts = useRef({ toggleVoice, realtime, help, audioSettings, credentialSettings, conversationMenu })
  shortcuts.current = { toggleVoice, realtime, help, audioSettings, credentialSettings, conversationMenu }
  useEffect(() => {
    let tap: ReturnType<typeof setTimeout> | undefined
    let pressed = false, held = false
    const down = (e: KeyboardEvent) => {
      if (e.isComposing) return
      if (e.key === 'Escape') {
        e.preventDefault()
        if (shortcuts.current.credentialSettings) setCredentialSettings(false)
        else if (shortcuts.current.audioSettings) setAudioSettings(false)
        else if (shortcuts.current.help) setHelp(false)
        else if (shortcuts.current.conversationMenu) setConversationMenu(false)
        else if (shortcuts.current.realtime) closeVoice()
        else if (dictation.current?.active) { dictation.current.cancel(); setDictationStatus('') }
        else void window.omni.hide()
        return
      }
      if (e.ctrlKey && ['Digit9', 'Numpad9'].includes(e.code)) {
        e.preventDefault()
        if (!e.repeat && !shortcuts.current.realtime) void dictation.current?.start(true)
      }
      if (!e.ctrlKey || !['Digit0', 'Numpad0'].includes(e.code)) return
      e.preventDefault()
      if (e.repeat || pressed) return
      pressed = true
      if (!shortcuts.current.realtime && stateRef.current?.state.voice) dictation.current?.warm()
      if (!shortcuts.current.realtime) tap = setTimeout(() => {
        tap = undefined; held = true
        if (stateRef.current?.state.voice) void dictation.current?.start()
      }, 250)
    }
    const up = (e: KeyboardEvent) => {
      if (!pressed || !(['Digit0', 'Numpad0'].includes(e.code) || e.key === 'Control')) return
      e.preventDefault(); pressed = false
      clearTimeout(tap); tap = undefined
      if (held) { held = false; dictation.current?.finish() }
      else { dictation.current?.discardWarm(); shortcuts.current.toggleVoice() }
    }
    const blur = () => {
      clearTimeout(tap); tap = undefined; pressed = false; held = false
      dictation.current?.cancel()
    }
    const visibility = () => { if (document.hidden) { blur(); closeVoice() } }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up)
    window.addEventListener('blur', blur); document.addEventListener('visibilitychange', visibility)
    return () => { blur(); window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility) }
  }, [])
  if (!snapshot || !current) return <div className="loading">◯ Preparando o Omni…</div>
  const dictating = /^(Abrindo microfone|Gravando|Transcrevendo)/.test(dictationStatus)
  const activities = [...(snapshot.state.activities || [])]
  // VS Code cards represent open Claude sessions. Closed-session history remains
  // in the conversation menu; do not resurrect an offline card from old tickets.
  for (const result of snapshot.results || []) {
    if (result.source === 'vscode' || result.previous || !['ready', 'delivering'].includes(result.state) || activities.some(a => a.source === result.source && a.conversationId === result.conversationId)) continue
    const owner = snapshot.conversations.find(c => c.id === result.conversationId)
    activities.push({ id: `result-card:${result.source}:${result.conversationId}`, source: result.source, status: 'ready', attention: 'return', conversationId: result.conversationId, title: owner?.title || result.title, detail: 'Resumo pronto · sessão desconectada', ...(result.source === 'omni' ? { parentConversationId: result.deliveryConversationId } : {}) })
  }
  const selectedKey = current.kind === 'external' ? current.sessionId || current.id : current.id
  const disconnectedEditor = current.kind === 'external' && current.editorOnline === false
  const openVsCodeActivities = activities.filter(activity => activity.source === 'vscode' && activity.online === true)
  const displayMessages = historyOpen ? current.editorHistory || [] : current.messages
  const requests = snapshot.conversations.flatMap(c => (c.editorRequests || []).filter(r => (r.deliveryConversationId || c.id) === current.id))
  const showThinking = thinking && !historyOpen
  const activeTraceTurnId = current.coordinationTurns?.find(turn => turn.state === 'planning')?.id || pendingTurns[0]?.id || (showThinking ? displayMessages.findLast(message => message.role === 'user')?.id : undefined)
  const traceForTurn = (turnId: string) => current.events.filter(event => event.turnId === turnId)
  const documentActions = (conversationId: string) => ({ openDocument: (reference: string) => void act(() => window.omni.openDocument(conversationId, reference)) })
  return <DocumentLinks.Provider value={documentActions(current.id)}><div className="app">
    <aside className="sidebar"><div className="brand"><span className="sigil">◯</span><div>Omni<small>SEU ESPAÇO DE CONTINUIDADE</small></div></div>
      <div className="conversation-controls"><button className="new" onClick={() => void act(async () => change(await window.omni.create()))}>＋ Nova sessão</button><button className="conversation-toggle" aria-label="Todas as conversas" aria-expanded={conversationMenu} title="Todas as conversas" onClick={() => setConversationMenu(value => !value)}>⌄</button></div>
      <button className={'conversation current-conversation ' + (current.id === primaryConversation?.id ? 'selected' : '')} aria-current={current.id === primaryConversation?.id ? 'page' : undefined} onClick={() => change(primaryConversation?.id || current.id)}><span>Chat central</span><small><i className={primaryConversation?.phase === 'running' ? 'dot live' : 'dot'} />{current.id === primaryConversation?.id ? 'Você está aqui' : 'Voltar ao Omni'}</small></button>
      {conversationMenu && <nav className="conversation-menu" aria-label="Todas as conversas">{snapshot.conversations.filter(c => c.kind !== 'task').map(c => <button key={c.id} className={'conversation ' + (c.id === current.id ? 'selected' : '')} onClick={() => change(c.id)}><span>{c.title}</span><small><i className={c.phase === 'running' && c.editorOnline !== false ? 'dot live' : 'dot'} />{c.kind === 'external' && c.editorOnline === false ? 'Sessão desconectada' : labels[c.phase]}</small></button>)}</nav>}
      <button className="agora-trigger" onClick={() => setAgora(true)} aria-label="Abrir o Agora">◐ Agora</button>
      {snapshot.agentMaps?.find(map => map.conversationId === primaryConversation?.id) && <button className="agent-map-trigger" onClick={() => setAgentMapId(primaryConversation!.id)} aria-label="Mapa de agentes do Omni">⑂ Mapa de agentes do Omni</button>}
      <div className="execution-panel"><div className="section-label">EXECUÇÕES</div>
        <ActivityGroup label="OMNI" source="omni" activities={activities} selectedKey={selectedKey} onSelect={openActivity} maps={snapshot.agentMaps || []} onMap={setAgentMapId} />
        <ActivityGroup label="VS CODE · ABERTAS" source="vscode" activities={openVsCodeActivities} selectedKey={selectedKey} onSelect={openActivity} maps={snapshot.agentMaps || []} onMap={setAgentMapId} />
        <ActivityGroup label="OVERCORE" source="overcore" activities={activities} selectedKey={selectedKey} onSelect={openActivity} maps={snapshot.agentMaps || []} onMap={setAgentMapId} />
        <ActivityGroup label="ORACLE" source="oracle" activities={activities} selectedKey={selectedKey} onSelect={openActivity} maps={snapshot.agentMaps || []} onMap={setAgentMapId} />
      </div>
      <div className="health"><i className={'dot ' + (snapshot.state.broker === 'ready' ? 'live' : 'warning')} />{snapshot.state.broker === 'ready' ? 'Continuidade conectada' : 'Continuidade local'}<small>{snapshot.state.synchronization}</small></div>
    </aside>
    <main><div className="chat-context"><span>{current.kind === 'external' ? current.title : 'Omni · Chat central'}{current.kind === 'external' && <small> · {current.sessionId?.slice(0, 8)} · {current.editorOnline === false ? 'sessão desconectada' : 'sessão vinculada'}</small>}</span>{current.kind === 'external' && <button onClick={() => setHistoryOpen(!historyOpen)} aria-pressed={historyOpen}>{historyOpen ? 'Voltar à conversa com o Omni' : `Histórico do VS Code (${current.editorHistory?.length || 0})`}</button>}</div>
    <div className="messages" ref={messages} onScroll={event => { const element = event.currentTarget; const follows = element.scrollHeight - element.scrollTop - element.clientHeight < 60; followLatestRef.current = follows; setFollowingLatest(follows) }}>
      {displayMessages.length === 0 && <div className="welcome"><div className="orb">◯</div><span>{current.kind === 'external' ? 'OMNI · COORDENAÇÃO DO PROJETO' : 'ESTOU POR AQUI'}</span><h1>O que vamos fazer?</h1><p>{current.kind === 'external' ? 'Converse comigo sobre esta sessão. Eu encaminho o trabalho e acompanho o retorno.' : 'Continue um assunto, abra um projeto ou me conte o que está pensando.'}</p></div>}
      {historyOpen && <p className="history-notice">Histórico anterior do editor · somente consulta. Resumos internos e mensagens do sistema foram ocultados.</p>}
      {displayMessages.map(m => <DocumentLinks.Provider key={m.id} value={documentActions(documentConversationId(current, m.id, snapshot.conversations))}>
        <article className={m.role} ref={revealing.includes(m.id) ? element => { revealTarget.current = element } : undefined}><div className="speaker">{m.author || (m.role === 'user' ? 'VOCÊ' : 'Omni')}{m.channel === 'voice' ? ' · VOZ' : ''}{historyOpen && m.at && <time> · {new Date(m.at).toLocaleString('pt-BR')}</time>}</div>{revealing.includes(m.id)
          ? <QuickReveal text={m.text} onComplete={() => setRevealing(ids => ids.filter(id => id !== m.id))} />
          : /^(report|editor-report|editor-response):/.test(m.id)
          ? <DeliveredReport text={m.text} streaming={m.streaming} interrupted={m.interrupted} />
: <><MessageText text={m.text || (!m.streaming && busy && !m.attachments?.length && !m.privateAttachment ? 'Preparando a resposta…' : '')} streaming={m.streaming} /><MessageAttachments conversationId={current.id} attachments={m.attachments} /></>}{m.privateAttachment && <div className="private-attachment-receipt" role="status">Crachá · {({ received: 'recebido pelo Omni · privado', considered: 'contexto considerado · conteúdo privado', stored: 'gravação confirmada no cofre', 'needs-input': 'precisa de complemento', unavailable: 'conteúdo temporário indisponível', failed: 'tratamento não concluído', 'access-ready': 'ponte preparada para o executor · ainda sem uso', 'access-used': 'uso confirmado pelo broker · credencial privada', 'access-failed': 'ponte acionada · operação não concluída' } as const)[m.privateAttachment.status]}</div>}</article>
        {!historyOpen && m.role === 'user' && <ExecutionTrace events={traceForTurn(m.id)} active={showThinking && activeTraceTurnId === m.id} seconds={runningSeconds} onCancel={busy && activeTraceTurnId === m.id ? () => void act(() => window.omni.cancel(current.id)) : undefined} />}
        {revealing.includes(m.id) && <div className="reveal-tail-spacer" aria-hidden="true" />}
      </DocumentLinks.Provider>)}
    </div>
      {!followingLatest && <button className="scroll-to-latest" onClick={scrollToLatest}>↓ Acompanhar resposta</button>}
<div className="composer-area">{requests.length > 0 && <details className="request-tracker"><summary>Pedidos acompanhados · {pendingEditorRequests(requests).length} em acompanhamento</summary>{requests.slice(-8).map(r => <RequestProgress key={r.id} request={r} onResolveBlock={(id, allow) => void act(() => window.omni.resolveEditorBlock(id, allow))} />)}</details>}{snapshot.conversations.filter(c => c.kind === 'task' && c.parentConversationId === current.id && c.acknowledgedAt).length > 0 && <details className="task-evidence"><summary>Relatórios originais dos subagentes</summary>{snapshot.conversations.filter(c => c.parentConversationId === current.id && c.acknowledgedAt).map(c => <details key={c.id}><summary>{c.title}</summary><MessageText onOpenDocument={documentActions(c.id).openDocument} text={c.resultText || c.messages.filter(m => m.role === 'assistant').at(-1)?.text || 'Sem relato.'} /></details>)}</details>}{error && <div role="alert" className="error">{error}</div>}{snapshot.permissions.filter(p => p.conversationId === current.id).map(p => <div className="permission" key={p.id}><strong>Permitir {p.tool} nesta ação?</strong><pre>{p.detail}</pre><button onClick={() => void act(() => window.omni.decide(p.id, true))}>Permitir</button><button onClick={() => void act(() => window.omni.decide(p.id, false))}>Recusar</button></div>)}
        {disconnectedEditor && <div className="offline-composer-notice" role="status">Esta sessão do VS Code está fechada. O histórico e as pendências seguem visíveis, mas nenhum comando será enviado. <button type="button" onClick={() => change(primaryConversation?.id || current.id)}>Continuar no chat central</button></div>}
        <div className={'composer ' + (dictating ? 'dictating' : '')} onDragOver={event => { if (!disconnectedEditor) event.preventDefault() }} onDrop={event => { event.preventDefault(); if (!disconnectedEditor) void addImageFiles(Array.from(event.dataTransfer.files)) }}>
          <input ref={attachmentPicker} className="attachment-picker" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple disabled={disconnectedEditor} onChange={event => { if (!disconnectedEditor) void addImageFiles(Array.from(event.currentTarget.files || [])); event.currentTarget.value = '' }} />
          {(credentialAttachment || attachments.length > 0 || draft.trim().length > 6000) && <div className="attachment-strip" aria-label="Anexos da conversa">
            {credentialAttachment && <div className="attachment-chip credential-attachment"><span className="text-attachment">CRACHÁ</span><span className="attachment-name">anexo privado · {Math.max(1, Math.ceil(credentialAttachment.size / 1024))} KB</span><button type="button" aria-label="Remover anexo privado do Crachá" onClick={() => { if (!current) return; void window.omni.discardCredentialAttachment(current.id).then(() => setCredentialAttachment(null)).catch(error => setError((error as Error).message)) }}>×</button></div>}
            {attachments.map((attachment, index) => <div className={'attachment-chip ' + attachment.kind} key={`${attachment.name}-${index}`}>
              <span className="attachment-file-icon" aria-hidden="true">{attachment.kind === 'image' ? '▣' : '‹/›'}</span>
              <span className="attachment-copy"><strong>{attachment.kind === 'text' ? attachment.name || 'anexo.txt' : attachment.name || 'imagem'}</strong><small>{attachment.kind === 'image' && attachment.width && attachment.height ? `${attachment.width}×${attachment.height}` : attachment.kind === 'text' ? 'texto anexado' : 'imagem anexada'}</small></span>
              <button type="button" aria-label={`Remover anexo ${index + 1}`} onClick={() => { draftRevision.current++; setAttachments(items => items.filter((_, itemIndex) => itemIndex !== index)) }}>×</button>
            </div>)}
            {draft.trim().length > 6000 && <div className="attachment-chip long-draft"><span className="attachment-number">#{attachments.length + 1}</span><span className="text-attachment">TXT</span><span className="attachment-name">mensagem-longa.txt</span><small>serÃ¡ enviada como anexo</small></div>}
          </div>}
          {!dictating && attachments.length > 0 && <div className="composer-tools"><small>{attachments.length}/8</small></div>}
          {dictating ? <DictationFeedback status={dictationStatus} level={dictationLevel} /> : <textarea ref={composerInput} rows={1} spellCheck={false} disabled={disconnectedEditor} aria-label="Mensagem para o Omni" placeholder={disconnectedEditor ? 'Sessão VS Code fechada · abra o projeto ou continue no chat central.' : current.kind === 'external' ? `Fale com o Omni sobre ${current.title.replace(/^VS Code · /, '')}…` : 'Escreva, ou segure Ctrl + 0 para falar…'} value={draft} onChange={e => updateDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); setHistoryOpen(false); send() } }} />}
          {!dictating && <div className="composer-private-action"><button type="button" className="composer-attachment-action" disabled={disconnectedEditor} onClick={() => attachmentPicker.current?.click()} title="Anexar imagem">⌁ Anexar</button><button type="button" className="composer-badge" disabled={disconnectedEditor} onClick={() => setCredentialSettings(true)} title="Adicionar dado privado pelo Crachá">◉ Crachá</button>{credentialSettings && !disconnectedEditor && <CredentialSettings key={current.id} conversationId={current.id} conversationTitle={current.title.replace(/^VS Code · /, '')} onAttach={attachment => setCredentialAttachment(attachment)} onClose={() => setCredentialSettings(false)} />}</div>}
        </div>
      </div>
      {help && <div className="shortcut-help"><button onClick={() => setHelp(false)} aria-label="Fechar atalhos">×</button><h2>Do seu jeito.</h2><p><kbd>Ctrl + Enter</kbd> Mostrar / recolher Omni</p><p><kbd>Ctrl + 0</kbd> Toque: abrir / fechar Realtime</p><p><kbd>Ctrl + 0</kbd> Segurar: ditar · soltar: transcrever no rascunho</p><p><kbd>Ctrl + 9</kbd> Calibrar ruído do ditado</p><p><kbd>Enter</kbd> Enviar · <kbd>Shift + Enter</kbd> Nova linha</p><p><kbd>Esc</kbd> Fechar painel / cancelar ditado / recolher Omni</p><small>Voz e ditado usam a OpenAI. O chat continua na sua sessão Claude.</small></div>}
      {selectedMap && <AgentMapPanel key={selectedMap.conversationId} map={selectedMap} onClose={() => setAgentMapId('')} />}
      {agora && <AgoraPanel onClose={() => setAgora(false)} />}
      {audioSettings && <AudioSettings onClose={() => setAudioSettings(false)} />}
      {updateSettings && <UpdatePanel status={updateStatus} onClose={() => setUpdateSettings(false)} onCheck={checkForUpdate} onAuto={setAutoUpdate} onApply={applyUpdate} />}
      {realtime && <RealtimePanel status={voiceStatus} amplitude={amplitude} muted={muted} onMute={() => { voice.current?.mute(!muted); setMuted(!muted) }} onClose={closeVoice} />}
    </main>
    <aside className="inspector settings-panel"><div className="section-label">CONFIGURAÇÕES</div><div className="inspector-actions"><button onClick={() => setAudioSettings(true)} aria-label="Configurações de áudio" title="Áudio — microfone, saída e voz">⚙ Áudio</button><button className={updateStatus.state === 'available' || updateStatus.state === 'blocked' ? 'update-ready' : ''} onClick={() => setUpdateSettings(true)} aria-label="Atualizar o Omni" title="Atualizar o Omni">↻ Atualizar{updateStatus.state === 'available' ? ' · pronta' : ''}</button></div></aside>
  </div></DocumentLinks.Provider>
}
function DeliveredReport({ text, streaming = false, interrupted = false }: { text: string; streaming?: boolean; interrupted?: boolean }) {
  return <div className={'report-delivery ' + (interrupted ? 'delivery-interrupted' : streaming ? 'writing' : 'delivered')}>
    {(!streaming || interrupted) && <div className="delivery-status"><span role="status">{interrupted ? 'Entrega interrompida · disponível para retomar' : 'Resultado recebido nesta conversa'}</span></div>}
    {text.trim() && <MessageText text={text} streaming={streaming && !interrupted} />}
  </div>
}
function ExecutionTrace({ events, active, seconds, onCancel }: { events: RunEvent[]; active: boolean; seconds: number; onCancel?: () => void }) {
  const visible = events.filter(event => ['context', 'planning', 'plan', 'answer', 'dispatch', 'tool-running', 'tool-complete', 'tool-failed', 'error', 'delegated', 'delegated-followup', 'owner-addendum'].includes(event.kind)).slice(-16)
  if (!visible.length && !active) return null
  const activeIndex = active ? visible.length - 1 : -1
  return <section className="execution-trace" aria-label="Rastro de execução do Omni">
    {active && !visible.length && <div className="trace-thinking" role="status"><i aria-hidden="true" /><span>Analisando e preparando a próxima ação · {seconds}s</span>{onCancel && <button type="button" onClick={onCancel} title="Interromper execução">■</button>}</div>}
    {visible.map((event, index) => {
      const current = index === activeIndex
      const state = event.kind === 'tool-running' ? 'executando' : event.kind === 'tool-failed' ? 'não concluiu' : event.durationMs ? formatDuration(event.durationMs) : 'concluído'
      return event.kind.startsWith('tool-')
      ? <article className={'trace-tool ' + event.kind + (current ? ' trace-active' : '')} key={`${event.id || event.at}-${index}`}>
          <header><i aria-hidden="true" /><strong>{event.text}</strong><small>{current ? `${state} · ${seconds}s` : state}</small>{current && onCancel && <button type="button" onClick={onCancel} title="Interromper execução">■</button>}</header>
          {event.input && <TracePayload label="IN" value={event.input} />}
          {event.output && <TracePayload label="OUT" value={event.output} />}
        </article>
      : <div className={'trace-note ' + event.kind + (current ? ' trace-active' : '')} key={`${event.at}-${index}`}><i aria-hidden="true" /><span>{event.kind === 'context' ? 'Contexto persistente carregado' : event.kind === 'error' ? 'A etapa encontrou um erro' : event.text}{current && ` · ${seconds}s`}</span>{current && onCancel && <button type="button" onClick={onCancel} title="Interromper execução">■</button>}{event.kind === 'error' && <small>{event.text}</small>}</div>
    })}
  </section>
}
function TracePayload({ label, value }: { label: 'IN' | 'OUT'; value: string }) {
  return <div className="trace-payload"><span>{label}</span><pre>{value}</pre></div>
}
function formatDuration(duration: number) { return duration < 1000 ? `${duration} ms` : `${(duration / 1000).toFixed(duration < 10_000 ? 1 : 0)} s` }
function MessageAttachments({ conversationId, attachments }: { conversationId: string; attachments?: Attachment[] }) {
  if (!attachments?.length) return null
  return <div className="message-attachments" aria-label="Anexos da mensagem">{attachments.map(attachment => attachment.kind === 'image'
    ? <AttachmentImage key={attachment.id} conversationId={conversationId} attachment={attachment} />
    : <section className="message-attachment" key={attachment.id}>
      <header><span className="text-attachment">TXT</span><span><strong>{attachment.name}</strong><small>{formatBytes(attachment.size)}</small></span></header>
      {attachment.preview && <p title={attachment.preview}>{attachment.preview}</p>}
    </section>)}</div>
}
function formatBytes(bytes: number) { return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB` }
function DictationFeedback({ status, level }: { status: string; level: number }) {
  const listening = !status.startsWith('Transcrevendo')
  const label = status.startsWith('Abrindo') ? 'Preparando microfone…' : listening ? 'Ouvindo… solte Ctrl + 0 quando terminar' : 'Transcrevendo…'
  return <div className={'dictation-feedback ' + (listening ? 'listening' : 'transcribing')} role="status" aria-live="polite">
    <span className="dictation-indicator" aria-hidden="true">{listening ? '●' : '◌'}</span>
    <span className="voice-wave" style={{ '--voice-level': String(level) } as React.CSSProperties} aria-hidden="true">{[0, 1, 2, 3, 4, 5, 6].map(i => <i key={i} />)}</span>
    <span className="dictation-label">{label}</span>
  </div>
}
function RequestProgress({ request, onResolveBlock }: { request: EditorRequest; onResolveBlock: (id: string, allow: boolean) => void }) {
  const status = { sending: 'Encaminhando', sent: 'Enviado · aguardando recebimento', received: 'Recebido · aguardando relato', reported: 'Relato disponível', summarizing: 'Omni preparando síntese', completed: 'Relato sintetizado', blocked: 'Decisão ou bloqueio', uncertain: 'Entrega não confirmada' }[request.status]
  const blocker = request.supervision?.review?.blocker || request.supervision?.blocker
  return <details className="request-progress"><summary>{request.targetName || 'Sessão do projeto'} · {status}{request.disconnected && !request.summary ? ' · sessão desconectada' : ''}</summary><p>{request.text}</p>{request.summaryError && <p>{request.summaryError}</p>}{blocker && <section className={'blocker-notice blocker-' + blocker.kind} aria-label={`Bloqueio: ${blocker.title}`}><header><b>{({ security: '◈ Segurança', scope: '⌑ Escopo', irreversible: '◆ Irreversível', access: '◉ Acesso', technical: '◌ Execução' } as Record<string, string>)[blocker.kind]}</b><span>{blocker.resolution === 'approved' ? 'Aprovado no Desktop' : blocker.resolution === 'rejected' ? 'Mantido bloqueado' : 'Decisão no Desktop'}</span></header><strong>{blocker.title}</strong><p><b>Motivo:</b> {blocker.cause}</p><p><b>Risco:</b> {blocker.risk}</p><p><b>Correção:</b> {blocker.remedy}</p>{canApproveBlocker(blocker) && <div className="blocker-actions"><button onClick={() => onResolveBlock(request.id, true)}>Aprovar no Omni</button><button onClick={() => onResolveBlock(request.id, false)}>Manter bloqueado</button></div>}</section>}{request.report && <><small>Relato do executor · {request.evidenceId?.slice(0, 8)} · não é verificação independente</small><MessageText text={request.report} /></>}</details>
}
function ActivityGroup({ label, source, activities, selectedKey, onSelect, maps, onMap, emptyText = 'Nenhuma sessão aberta.' }: { label: string; source: Activity['source']; activities: Activity[]; selectedKey: string; onSelect: (activity: Activity) => void; maps: AgentMap[]; onMap: (id: string) => void; emptyText?: string }) {
  const items = activities.filter(activity => activity.source === source)
  return <section className="activity-group"><h3>{label}</h3>{items.length === 0 ? <p className="empty-activity">{emptyText}</p> : items.map(activity => {
    const map = maps.find(map => map.conversationId === activity.conversationId) || maps.find(map => map.conversationId === activity.parentConversationId)
    const selected = (activity.sessionId || activity.conversationId) === selectedKey
    return <div key={activity.id} className="activity-card">
      <button className={'activity source-' + activity.source + ' ' + activity.status + (activity.parentConversationId ? ' subagent' : '') + (activity.child ? ' has-child' : '') + (activity.attention ? ' attention-' + activity.attention : '') + (selected ? ' selected' : '')} aria-current={selected ? 'page' : undefined} onClick={() => onSelect(activity)} disabled={activity.status === 'unavailable'}>
        <i className={'activity-status ' + activity.status} aria-hidden="true" />
        <span className="activity-parent-copy">{activity.title}<small>{selected ? 'Selecionado · ' : ''}{activity.detail}</small></span>
        {activity.child && <span className={'activity-child ' + activity.child.status} aria-label={`${activity.child.title}: ${activity.child.status === 'running' ? 'em execução' : 'concluído'}`}><i aria-hidden="true" /><small>{activity.child.title}</small></span>}
        {activity.attention === 'return' && activity.status !== 'running' && <i className="activity-return" aria-label="Resumo pronto para leitura" title="Resumo pronto · clique no card" />}
        {activity.source !== 'vscode' && activity.outcome && <i className={'activity-outcome ' + activity.outcome} aria-label={activity.outcome === 'completed' ? 'Concluído' : 'Não concluído'} />}
      </button>
      {map && <button className="agent-map-trigger activity-map-icon" aria-label={`Mapa de agentes: ${activity.title}`} title={`Mapa de ${map.nodes.length - 1} subagente(s)`} onClick={() => onMap(map.conversationId)}>⑂</button>}
    </div>
  })}</section>
}
createRoot(document.getElementById('root')!).render(<App />)
