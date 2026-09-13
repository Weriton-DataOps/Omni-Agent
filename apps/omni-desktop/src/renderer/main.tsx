import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AttachmentInput, Snapshot, Activity, EditorRequest, LocalUpdateStatus, ResultTicket } from '../shared/contracts'
import { Voice } from './voice'
import { pendingCoordinationTurns } from '../shared/coordination-state'
import { RealtimePanel } from './RealtimePanel'
import { Dictation } from './dictation'
import { AudioSettings } from './AudioSettingsPanel'
import { CredentialSettings } from './CredentialSettingsPanel'
import { MessageText } from './MessageText'
import { UpdatePanel } from './UpdatePanel'
import './style.css'
import './heritage.css'
const labels: Record<string, string> = { idle: 'Pronto', running: 'Trabalhando', 'needs-input': 'Sua decisão', completed: 'Rodada concluída', interrupted: 'Interrompida', failed: 'Precisa de atenção', editor: 'No VS Code' }
function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [selected, select] = useState('')
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<AttachmentInput[]>([])
  const [error, setError] = useState('')
  const [voiceStatus, setVoiceStatus] = useState('Voz desligada')
  const [realtime, setRealtime] = useState(false)
  const [muted, setMuted] = useState(false)
  const [dictationStatus, setDictationStatus] = useState('')
  const [dictationLevel, setDictationLevel] = useState(0)
  const [help, setHelp] = useState(false)
  const [audioSettings, setAudioSettings] = useState(false)
  const [credentialSettings, setCredentialSettings] = useState(false)
  const [updateSettings, setUpdateSettings] = useState(false)
  const [conversationMenu, setConversationMenu] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [followingLatest, setFollowingLatest] = useState(true)
  const [runningSeconds, setRunningSeconds] = useState(0)
  const [submitting, setSubmitting] = useState<Record<string, number>>({})
  const submit = async (id: string, text: string, channel: 'text' | 'voice', outgoing?: AttachmentInput[]) => {
    setSubmitting(previous => ({ ...previous, [id]: (previous[id] || 0) + 1 }))
    try {
      await window.omni.send(id, text, channel, outgoing)
      setSnapshot(await window.omni.snapshot())
    } finally {
      setSubmitting(previous => ({ ...previous, [id]: Math.max(0, (previous[id] || 0) - 1) }))
    }
  }
  const [releasing, setReleasing] = useState<string[]>([])
  const amplitude = useRef(0)
  const dictation = useRef<Dictation | null>(null)
  const stateRef = useRef(snapshot); stateRef.current = snapshot
  const messages = useRef<HTMLDivElement>(null)
  const composerInput = useRef<HTMLTextAreaElement>(null)
  const attachmentPicker = useRef<HTMLInputElement>(null)
  const followLatestRef = useRef(true)
  const displayedConversation = useRef('')
  const navigationEpoch = useRef(0)
  const voice = useRef<Voice | null>(null)
  const act = async (action: () => Promise<unknown>) => { setError(''); try { await action() } catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')) } }
  useEffect(() => {
    const pasteImage = (event: ClipboardEvent) => {
      if (document.activeElement !== composerInput.current) return
      const files = Array.from(event.clipboardData?.files || []).filter(file => file.type.startsWith('image/'))
      if (!files.length) return
      event.preventDefault()
      void addImageFiles(files)
    }
    window.addEventListener('paste', pasteImage)
    return () => window.removeEventListener('paste', pasteImage)
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
  const busy = current ? ['running', 'needs-input'].includes(current.phase) : false
  const pendingTurns = pendingCoordinationTurns(current, snapshot?.conversations || [])
  const pendingCoordination = pendingTurns.length > 0 || !!(current && submitting[current.id])
  const streamingReply = current?.messages.findLast(message => message.role === 'assistant' && message.streaming && !message.interrupted)
  const receivingResult = (snapshot?.results || []).some(result => result.deliveryConversationId === current?.id && result.state === 'delivering')
  const thinking = busy || pendingCoordination || !!streamingReply || receivingResult
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
  const release = (result: ResultTicket) => { void act(async () => {
    const intent = ++navigationEpoch.current
    setReleasing(ids => [...ids, result.id])
    try {
      const destinationId = await window.omni.releaseResult(result.id)
      setSnapshot(await window.omni.snapshot())
      if (intent !== navigationEpoch.current) return
      if (visibleId.current !== destinationId) change(destinationId)
      else setHistoryOpen(false)
      window.setTimeout(scrollToLatest, 0)
    } finally { setReleasing(ids => ids.filter(id => id !== result.id)) }
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
    const result = snapshot?.results?.find(item => item.source === activity.source && item.conversationId === activity.conversationId)
    if (activity.source === 'omni' && activity.parentConversationId) {
      if (result?.state === 'ready') release(result)
      else change(activity.parentConversationId)
      return
    }
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
  }, [current?.id, current?.messages.at(-1)?.text, thinking])
  const change = (id: string) => { navigationEpoch.current++; closeVoice(); dictation.current?.cancel(); setError(''); setHistoryOpen(false); setDictationStatus(''); setDictationLevel(0); followLatestRef.current = true; setFollowingLatest(true); select(id); setConversationMenu(false); setDraft(''); setAttachments([]); void window.omni.acknowledgeReturns(id).catch(() => {}) }
  useLayoutEffect(() => {
    if (historyOpen) { followLatestRef.current = false; setFollowingLatest(false); messages.current?.scrollTo({ top: 0 }) }
    else if (followLatestRef.current) messages.current?.scrollTo({ top: messages.current.scrollHeight })
  }, [historyOpen])
  const addImageFiles = async (files: File[]) => {
    const eligible = files.filter(file => file.type.startsWith('image/') && file.size <= 5 * 1024 * 1024).slice(0, Math.max(0, 8 - attachments.length))
    if (eligible.length !== files.length) setError('Use imagens de no mÃ¡ximo 5 MB; o limite Ã© oito anexos por mensagem.')
    const items = await Promise.all(eligible.map(file => new Promise<AttachmentInput>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve({ kind: 'image', name: file.name, mime: file.type, data: String(reader.result) })
      reader.onerror = () => reject(new Error('NÃ£o foi possÃ­vel ler a imagem.'))
      reader.readAsDataURL(file)
    })))
    setAttachments(previous => [...previous, ...items].slice(0, 8))
  }
  const send = () => {
    if (!current) return
    const outgoing = [...attachments]
    let text = draft
    if (text.trim().length > 6000) {
      outgoing.push({ kind: 'text', name: 'mensagem-longa.txt', mime: 'text/plain', text })
      text = 'Texto longo enviado como anexo.'
    }
    if (!text.trim() && !outgoing.length) return
    setDraft('')
    setAttachments([])
    const originId = current.id
    setError('')
    void submit(originId, text, 'text', outgoing).catch(e => {
      if (visibleId.current === originId) setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
    })
  }
  const closeVoice = () => { voice.current?.stop(); setRealtime(false); setMuted(false) }
  const toggleVoice = () => {
    if (realtime) { closeVoice(); return }
    if (!current || !snapshot?.state.voice || dictation.current?.active) return
    setMuted(false); setRealtime(true); void voice.current?.start(current.id)
  }
  const shortcuts = useRef({ toggleVoice, realtime, help, audioSettings, conversationMenu })
  shortcuts.current = { toggleVoice, realtime, help, audioSettings, conversationMenu }
  useEffect(() => {
    let tap: ReturnType<typeof setTimeout> | undefined
    let pressed = false, held = false
    const down = (e: KeyboardEvent) => {
      if (e.isComposing) return
      if (e.key === 'Escape') {
        e.preventDefault()
        if (shortcuts.current.audioSettings) setAudioSettings(false)
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
  // A finished return remains reachable even when its editor session is offline.
  for (const result of snapshot.results || []) {
    if (!['ready', 'delivering'].includes(result.state) || activities.some(a => a.source === result.source && a.conversationId === result.conversationId)) continue
    const owner = snapshot.conversations.find(c => c.id === result.conversationId)
    activities.push({ id: `result-card:${result.source}:${result.conversationId}`, source: result.source, status: 'ready', conversationId: result.conversationId, title: owner?.title || result.title, detail: 'Retorno disponível · sessão desconectada', ...(result.source === 'omni' ? { parentConversationId: result.deliveryConversationId } : {}) })
  }
  const selectedKey = current.kind === 'external' ? current.sessionId || current.id : current.id
  const displayMessages = historyOpen ? current.editorHistory || [] : current.messages
  const requests = snapshot.conversations.flatMap(c => (c.editorRequests || []).filter(r => (r.deliveryConversationId || c.id) === current.id))
  const showThinking = thinking && !historyOpen
  return <div className="app">
    <aside className="sidebar"><div className="brand"><span className="sigil">◯</span><div>Omni<small>SEU ESPAÇO DE CONTINUIDADE</small></div></div>
      <div className="conversation-controls"><button className="new" onClick={() => void act(async () => change(await window.omni.create()))}>＋ Nova sessão</button><button className="conversation-toggle" aria-label="Todas as conversas" aria-expanded={conversationMenu} title="Todas as conversas" onClick={() => setConversationMenu(value => !value)}>⌄</button></div>
      <button className={'conversation current-conversation ' + (current.id === primaryConversation?.id ? 'selected' : '')} aria-current={current.id === primaryConversation?.id ? 'page' : undefined} onClick={() => change(primaryConversation?.id || current.id)}><span>Chat central</span><small><i className={primaryConversation?.phase === 'running' ? 'dot live' : 'dot'} />{current.id === primaryConversation?.id ? 'Você está aqui' : 'Voltar ao Omni'}</small></button>
      {conversationMenu && <nav className="conversation-menu" aria-label="Todas as conversas">{snapshot.conversations.filter(c => c.kind !== 'task').map(c => <button key={c.id} className={'conversation ' + (c.id === current.id ? 'selected' : '')} onClick={() => change(c.id)}><span>{c.title}</span><small><i className={c.phase === 'running' ? 'dot live' : 'dot'} />{labels[c.phase]}</small></button>)}</nav>}
      <div className="execution-panel"><div className="section-label">EXECUÇÕES</div><ActivityGroup label="OMNI" source="omni" activities={activities} selectedKey={selectedKey} onSelect={openActivity} results={snapshot.results || []} releasing={releasing} onRelease={release} /><ActivityGroup label="VS CODE" source="vscode" activities={activities} selectedKey={selectedKey} onSelect={openActivity} results={snapshot.results || []} releasing={releasing} onRelease={release} /><ActivityGroup label="OVERCORE" source="overcore" activities={activities} selectedKey={selectedKey} onSelect={openActivity} results={snapshot.results || []} releasing={releasing} onRelease={release} /><ActivityGroup label="ORACLE" source="oracle" activities={activities} selectedKey={selectedKey} onSelect={openActivity} results={snapshot.results || []} releasing={releasing} onRelease={release} /></div>
      <div className="health"><i className={'dot ' + (snapshot.state.broker === 'ready' ? 'live' : 'warning')} />{snapshot.state.broker === 'ready' ? 'Continuidade conectada' : 'Continuidade local'}<small>{snapshot.state.synchronization}</small></div>
    </aside>
    <main><div className="chat-context"><span>{current.kind === 'external' ? current.title : 'Omni · Chat central'}{current.kind === 'external' && <small> · {current.sessionId?.slice(0, 8)} · {current.editorOnline === false ? 'sessão desconectada' : 'sessão vinculada'}</small>}</span>{current.kind === 'external' && <button onClick={() => setHistoryOpen(!historyOpen)} aria-pressed={historyOpen}>{historyOpen ? 'Voltar à conversa com o Omni' : `Histórico do VS Code (${current.editorHistory?.length || 0})`}</button>}</div>
    <div className="messages" ref={messages} onScroll={event => { const element = event.currentTarget; const follows = element.scrollHeight - element.scrollTop - element.clientHeight < 60; followLatestRef.current = follows; setFollowingLatest(follows) }}>{displayMessages.length === 0 && <div className="welcome"><div className="orb">◯</div><span>{current.kind === 'external' ? 'OMNI · COORDENAÇÃO DO PROJETO' : 'ESTOU POR AQUI'}</span><h1>O que vamos fazer?</h1><p>{current.kind === 'external' ? 'Converse comigo sobre esta sessão. Eu encaminho o trabalho e acompanho o retorno.' : 'Continue um assunto, abra um projeto ou me conte o que está pensando.'}</p></div>}{historyOpen && <p className="history-notice">Histórico anterior do editor · somente consulta. Resumos internos e mensagens do sistema foram ocultados.</p>}{displayMessages.map(m => <article key={m.id} className={m.role}><div className="speaker">{m.author || (m.role === 'user' ? 'VOCÊ' : 'Omni')}{m.channel === 'voice' ? ' · VOZ' : ''}{historyOpen && m.at && <time> · {new Date(m.at).toLocaleString('pt-BR')}</time>}</div>{/^(report|editor-report):/.test(m.id)
      ? <DeliveredReport text={m.text} streaming={m.streaming} interrupted={m.interrupted} />
      : <MessageText text={m.text || (!m.streaming && busy ? 'Preparando a resposta…' : '')} streaming={m.streaming} />}</article>)}{showThinking && <div className="thinking-indicator" role="status" aria-label={current.phase === 'needs-input' ? 'Aguardando decisão' : pendingCoordination ? 'Omni entendendo o pedido' : receivingResult ? 'Omni preparando o retorno' : 'Omni trabalhando'}><span className="thinking-ring" /><span>{current.phase === 'needs-input' ? 'Aguardando uma decisão necessária' : streamingReply?.text.trim() ? 'Omni respondendo…' : receivingResult ? `Omni preparando o retorno · ${runningSeconds}s` : pendingCoordination ? `Omni entendendo o pedido e definindo a execução · ${runningSeconds}s` : `Omni trabalhando · ${runningSeconds}s`}</span>{busy && <button onClick={() => void act(() => window.omni.cancel(current.id))} title="Interromper">■</button>}</div>}</div>
      {!followingLatest && <button className="scroll-to-latest" onClick={scrollToLatest}>↓ Acompanhar resposta</button>}
      <div className="composer-area">{requests.length > 0 && <details className="request-tracker"><summary>Pedidos acompanhados · {requests.filter(r => !['completed', 'blocked'].includes(r.status)).length} em acompanhamento</summary>{requests.slice(-8).map(r => <RequestProgress key={r.id} request={r} />)}</details>}{snapshot.conversations.filter(c => c.kind === 'task' && c.parentConversationId === current.id && c.acknowledgedAt).length > 0 && <details className="task-evidence"><summary>Relatórios originais dos subagentes</summary>{snapshot.conversations.filter(c => c.parentConversationId === current.id && c.acknowledgedAt).map(c => <details key={c.id}><summary>{c.title}</summary><MessageText text={c.resultText || c.messages.filter(m => m.role === 'assistant').at(-1)?.text || 'Sem relato.'} /></details>)}</details>}{error && <div role="alert" className="error">{error}</div>}{snapshot.permissions.filter(p => p.conversationId === current.id).map(p => <div className="permission" key={p.id}><strong>Permitir {p.tool} nesta ação?</strong><pre>{p.detail}</pre><button onClick={() => void act(() => window.omni.decide(p.id, true))}>Permitir</button><button onClick={() => void act(() => window.omni.decide(p.id, false))}>Recusar</button></div>)}
        <div className={'composer ' + (dictating ? 'dictating' : '')} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void addImageFiles(Array.from(event.dataTransfer.files)) }}>
          <input ref={attachmentPicker} className="attachment-picker" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={event => { void addImageFiles(Array.from(event.currentTarget.files || [])); event.currentTarget.value = '' }} />
          {(attachments.length > 0 || draft.trim().length > 6000) && <div className="attachment-strip" aria-label="Anexos prontos para envio">
            {attachments.map((attachment, index) => <div className="attachment-chip" key={`${attachment.name}-${index}`}><span className="attachment-number">#{index + 1}</span>{attachment.kind === 'image' && attachment.data ? <img src={attachment.data} alt="PrÃ©via do anexo" /> : <span className="text-attachment">TXT</span>}<span className="attachment-name">{attachment.name || 'imagem'}</span><button type="button" aria-label={`Remover anexo ${index + 1}`} onClick={() => setAttachments(items => items.filter((_, itemIndex) => itemIndex !== index))}>Ã—</button></div>)}
            {draft.trim().length > 6000 && <div className="attachment-chip long-draft"><span className="attachment-number">#{attachments.length + 1}</span><span className="text-attachment">TXT</span><span className="attachment-name">mensagem-longa.txt</span><small>serÃ¡ enviada como anexo</small></div>}
          </div>}
          {!dictating && attachments.length > 0 && <div className="composer-tools"><small>{attachments.length}/8</small></div>}
          {dictating ? <DictationFeedback status={dictationStatus} level={dictationLevel} /> : <textarea ref={composerInput} rows={1} spellCheck={false} aria-label="Mensagem para o Omni" placeholder={current.kind === 'external' ? `Fale com o Omni sobre ${current.title.replace(/^VS Code · /, '')}…` : 'Escreva, ou segure Ctrl + 0 para falar…'} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); setHistoryOpen(false); send() } }} />}
        </div>
      </div>
      {help && <div className="shortcut-help"><button onClick={() => setHelp(false)} aria-label="Fechar atalhos">×</button><h2>Do seu jeito.</h2><p><kbd>Ctrl + Enter</kbd> Mostrar / recolher Omni</p><p><kbd>Ctrl + 0</kbd> Toque: abrir / fechar Realtime</p><p><kbd>Ctrl + 0</kbd> Segurar: ditar · soltar: transcrever no rascunho</p><p><kbd>Ctrl + 9</kbd> Calibrar ruído do ditado</p><p><kbd>Enter</kbd> Enviar · <kbd>Shift + Enter</kbd> Nova linha</p><p><kbd>Esc</kbd> Fechar painel / cancelar ditado / recolher Omni</p><small>Voz e ditado usam a OpenAI. O chat continua na sua sessão Claude.</small></div>}
      {audioSettings && <AudioSettings onClose={() => setAudioSettings(false)} onCredentials={() => { setAudioSettings(false); setCredentialSettings(true) }} />}
      {credentialSettings && <CredentialSettings onClose={() => setCredentialSettings(false)} />}
      {updateSettings && <UpdatePanel status={updateStatus} onClose={() => setUpdateSettings(false)} onCheck={checkForUpdate} onAuto={setAutoUpdate} onApply={applyUpdate} />}
      {realtime && <RealtimePanel status={voiceStatus} amplitude={amplitude} muted={muted} onMute={() => { voice.current?.mute(!muted); setMuted(!muted) }} onClose={closeVoice} />}
    </main>
    <aside className="inspector settings-panel"><div className="section-label">CONFIGURAÇÕES</div><div className="inspector-actions"><button onClick={() => setAudioSettings(true)} aria-label="Configurações de áudio" title="Áudio — microfone, saída e voz">⚙ Áudio</button><button onClick={() => setCredentialSettings(true)} aria-label="Crachá de acessos" title="Crachá — acessos e tokens">◉ Crachá</button><button className={updateStatus.state === 'available' || updateStatus.state === 'blocked' ? 'update-ready' : ''} onClick={() => setUpdateSettings(true)} aria-label="Atualizar o Omni" title="Atualizar o Omni">↻ Atualizar{updateStatus.state === 'available' ? ' · pronta' : ''}</button></div></aside>
  </div>
}
function DeliveredReport({ text, streaming = false, interrupted = false }: { text: string; streaming?: boolean; interrupted?: boolean }) {
  return <div className={'report-delivery ' + (interrupted ? 'delivery-interrupted' : streaming ? 'writing' : 'delivered')}>
    {(!streaming || interrupted) && <div className="delivery-status"><span role="status">{interrupted ? 'Entrega interrompida · disponível para retomar' : 'Resultado recebido nesta conversa'}</span></div>}
    {text.trim() && <MessageText text={text} streaming={streaming && !interrupted} />}
  </div>
}
function DictationFeedback({ status, level }: { status: string; level: number }) {
  const listening = !status.startsWith('Transcrevendo')
  const label = status.startsWith('Abrindo') ? 'Preparando microfone…' : listening ? 'Ouvindo… solte Ctrl + 0 quando terminar' : 'Transcrevendo…'
  return <div className={'dictation-feedback ' + (listening ? 'listening' : 'transcribing')} role="status" aria-live="polite">
    <span className="dictation-indicator" aria-hidden="true">{listening ? '●' : '◌'}</span>
    <span className="voice-wave" style={{ '--voice-level': String(level) } as React.CSSProperties} aria-hidden="true">{[0, 1, 2, 3, 4, 5, 6].map(i => <i key={i} />)}</span>
    <span className="dictation-label">{label}</span>
  </div>
}
function RequestProgress({ request }: { request: EditorRequest }) {
  const status = { sending: 'Encaminhando', sent: 'Enviado · aguardando recebimento', received: 'Recebido · aguardando relato', reported: 'Relato disponível', summarizing: 'Omni preparando síntese', completed: 'Relato sintetizado', blocked: 'Decisão ou bloqueio', uncertain: 'Entrega não confirmada' }[request.status]
  return <details className="request-progress"><summary>{request.targetName || 'Sessão do projeto'} · {status}{request.disconnected && !request.summary ? ' · sessão desconectada' : ''}</summary><p>{request.text}</p>{request.summaryError && <p>{request.summaryError}</p>}{request.report && <><small>Relato do executor · {request.evidenceId?.slice(0, 8)} · não é verificação independente</small><MessageText text={request.report} /></>}</details>
}
function ActivityGroup({ label, source, activities, selectedKey, onSelect, results, releasing, onRelease }: { label: string; source: Activity['source']; activities: Activity[]; selectedKey: string; onSelect: (activity: Activity) => void; results: ResultTicket[]; releasing: string[]; onRelease: (result: ResultTicket) => void }) {
  const items = activities.filter(activity => activity.source === source)
  return <section className="activity-group"><h3>{label}</h3>{items.length === 0 ? <p className="empty-activity">Nada em execução.</p> : items.map(activity => {
    const returns = results.filter(result => result.source === source && result.conversationId === activity.conversationId && ['ready', 'delivering'].includes(result.state))
    const selected = (activity.sessionId || activity.conversationId) === selectedKey
    return <div key={activity.id} className={'activity-card' + (returns.length ? ' with-returns' : '')}>
      <button className={'activity source-' + activity.source + ' ' + activity.status + (activity.parentConversationId ? ' subagent' : '') + (activity.child ? ' has-child' : '') + (activity.attention ? ' attention-' + activity.attention : '') + (selected ? ' selected' : '')} aria-current={selected ? 'page' : undefined} onClick={() => onSelect(activity)} disabled={activity.status === 'unavailable'}>
        <i className={'activity-status ' + activity.status} aria-hidden="true" />
        <span className="activity-parent-copy">{activity.title}<small>{selected ? 'Selecionado · ' : ''}{activity.detail}</small></span>
        {activity.child && <span className={'activity-child ' + activity.child.status} aria-label={`${activity.child.title}: ${activity.child.status === 'running' ? 'em execução' : 'concluído'}`}><i aria-hidden="true" /><small>{activity.child.title}</small></span>}
        {activity.attention === 'return' && <i className="activity-return" aria-label="Retorno aguardando leitura" title="Retorno aguardando leitura" />}
        {activity.outcome && <i className={'activity-outcome ' + activity.outcome} aria-label={activity.outcome === 'completed' ? 'Concluído' : 'Não concluído'} />}
      </button>
      {returns.length > 0 && <div className="activity-card-returns" aria-label={`Retornos de ${activity.title}`}>{returns.map(result => <div className="activity-card-return" key={result.id}>
        {(source !== 'omni' || returns.length > 1) && <span title={result.title}>{result.title}</span>}
        <button type="button" className="receive-result" disabled={result.state === 'delivering' || releasing.includes(result.id)} onClick={() => onRelease(result)} aria-label={`Receber retorno: ${result.title}`}>
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {result.state === 'delivering' || releasing.includes(result.id) ? 'Recebendo…' : 'Receber retorno'}
        </button>
      </div>)}</div>}
    </div>
  })}</section>
}
createRoot(document.getElementById('root')!).render(<App />)
