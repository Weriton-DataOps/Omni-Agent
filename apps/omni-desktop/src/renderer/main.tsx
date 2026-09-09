import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Snapshot } from '../shared/contracts'
import { Voice } from './voice'
import { RealtimePanel } from './RealtimePanel'
import { Dictation } from './dictation'
import { AudioSettings } from './AudioSettingsPanel'
import './style.css'
import './heritage.css'
const labels: Record<string, string> = { idle: 'Pronto', running: 'Trabalhando', 'needs-input': 'Sua decisão', completed: 'Rodada concluída', interrupted: 'Interrompida', failed: 'Precisa de atenção', editor: 'No VS Code' }
function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [selected, select] = useState('')
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [voiceStatus, setVoiceStatus] = useState('Voz desligada')
  const [realtime, setRealtime] = useState(false)
  const [muted, setMuted] = useState(false)
  const [dictationStatus, setDictationStatus] = useState('')
  const [dictationLevel, setDictationLevel] = useState(0)
  const [help, setHelp] = useState(false)
  const [audioSettings, setAudioSettings] = useState(false)
  const [conversationMenu, setConversationMenu] = useState(false)
  const amplitude = useRef(0)
  const dictation = useRef<Dictation | null>(null)
  const [sessions, setSessions] = useState<{ id: string; title: string }[] | null>(null)
  const stateRef = useRef(snapshot); stateRef.current = snapshot
  const tail = useRef<HTMLDivElement>(null)
  const voice = useRef<Voice | null>(null)
  const act = async (action: () => Promise<unknown>) => { setError(''); try { await action() } catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')) } }
  useEffect(() => {
    void window.omni.snapshot().then(setSnapshot)
    const off = window.omni.onChange(setSnapshot)
    voice.current = new Voice(window.omni, setVoiceStatus, async (id, text) => {
      await window.omni.send(id, text, 'voice')
      const updated = await window.omni.snapshot()
      return updated.conversations.find(c => c.id === id)?.messages.filter(m => m.role === 'assistant').at(-1)?.text || 'Não recebi uma resposta.'
    }, n => { amplitude.current = n })
    dictation.current = new Dictation(window.omni, setDictationStatus, text => setDraft(previous => [previous, text].filter(Boolean).join(' ')), setDictationLevel)
    const unload = () => { voice.current?.stop(); dictation.current?.cancel() }
    window.addEventListener('beforeunload', unload)
    return () => { off(); unload(); window.removeEventListener('beforeunload', unload) }
  }, [])
  const current = snapshot?.conversations.find(c => c.id === selected) || snapshot?.conversations[0]
  useEffect(() => { tail.current?.scrollIntoView({ behavior: 'smooth' }) }, [current?.messages.at(-1)?.text])
  const change = (id: string) => { closeVoice(); dictation.current?.cancel(); setDictationStatus(''); setDictationLevel(0); select(id); setSessions(null); setConversationMenu(false); setDraft('') }
  const send = () => {
    if (!current || !draft.trim()) return
    const text = draft
    setDraft('')
    if (['running', 'needs-input'].includes(current.phase)) {
      void act(async () => change(await window.omni.delegate(current.id, text)))
      return
    }
    void act(() => window.omni.send(current.id, text))
  }
  const closeVoice = () => { voice.current?.stop(); setRealtime(false); setMuted(false) }
  const toggleVoice = () => {
    if (realtime) { closeVoice(); return }
    if (!current || !snapshot?.state.voice || dictation.current?.active) return
    setMuted(false); setRealtime(true); void voice.current?.start(current.id)
  }
  const shortcuts = useRef({ toggleVoice, realtime, sessions, help, audioSettings, conversationMenu })
  shortcuts.current = { toggleVoice, realtime, sessions, help, audioSettings, conversationMenu }
  useEffect(() => {
    let tap: ReturnType<typeof setTimeout> | undefined
    let pressed = false, held = false
    const down = (e: KeyboardEvent) => {
      if (e.isComposing) return
      if (e.key === 'Escape') {
        e.preventDefault()
        if (shortcuts.current.audioSettings) setAudioSettings(false)
        else if (shortcuts.current.help) setHelp(false)
        else if (shortcuts.current.sessions) setSessions(null)
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
  const busy = ['running', 'needs-input'].includes(current.phase)
  const dictating = /^(Abrindo microfone|Gravando|Transcrevendo)/.test(dictationStatus)
  const activities = snapshot.state.activities || []
  return <div className="app">
    <aside className="sidebar"><div className="brand"><span className="sigil">◯</span><div>Omni<small>SEU ESPAÇO DE CONTINUIDADE</small></div></div>
      <div className="conversation-controls"><button className="new" onClick={() => void act(async () => change(await window.omni.create()))}>＋ Nova sessão</button><button className="conversation-toggle" aria-label="Todas as conversas" aria-expanded={conversationMenu} title="Todas as conversas" onClick={() => setConversationMenu(value => !value)}>⌄</button></div>
      <button className="conversation current-conversation" onClick={() => setConversationMenu(value => !value)}><span>{current.title}</span><small><i className={current.phase === 'running' ? 'dot live' : 'dot'} />{labels[current.phase]}</small></button>
      {conversationMenu && <nav className="conversation-menu" aria-label="Todas as conversas">{snapshot.conversations.map(c => <button key={c.id} className={'conversation ' + (c.id === current.id ? 'selected' : '')} onClick={() => change(c.id)}><span>{c.title}</span><small><i className={c.phase === 'running' ? 'dot live' : 'dot'} />{labels[c.phase]}</small></button>)}</nav>}
      <div className="execution-panel"><div className="section-label">EXECUÇÕES</div><ActivityGroup label="OMNI" source="omni" activities={activities} onOpen={change} /><ActivityGroup label="VS CODE" source="vscode" activities={activities} onOpen={change} /><ActivityGroup label="OVERCORE" source="overcore" activities={activities} onOpen={change} /><ActivityGroup label="ORACLE" source="oracle" activities={activities} onOpen={change} /></div>
      <div className="health"><i className={'dot ' + (snapshot.state.broker === 'ready' ? 'live' : 'warning')} />{snapshot.state.broker === 'ready' ? 'Continuidade conectada' : 'Continuidade local'}<small>{snapshot.state.synchronization}</small></div>
    </aside>
    <main><header><div className="breadcrumbs">ESPAÇO PESSOAL <span>/</span> CONVERSA</div><div className="header-actions"><button onClick={() => setAudioSettings(true)} aria-label="Configurações de áudio" title="Áudio — microfone, saída e voz">⚙ Áudio</button><button onClick={() => void act(() => window.omni.openEditor(current.id))}>Abrir sessão no VS Code ↗</button></div></header>
      <div className="project"><button disabled={!!current.sessionId || busy} onClick={() => void act(() => window.omni.chooseWorkspace(current.id))}>▱ {current.workspace.split(/[\\/]/).at(-1)} <span>⌄</span></button><button disabled={busy} onClick={() => void act(async () => setSessions(await window.omni.listSessions(current.id)))}>Retomar sessão Claude</button></div>
      {sessions && <div className="session-picker"><button onClick={() => setSessions(null)}>Fechar ×</button><p>Sessões deste projeto</p>{sessions.length === 0 && <small>Nenhuma sessão encontrada.</small>}{sessions.map(s => <button key={s.id} onClick={() => void act(async () => { await window.omni.resume(current.id, s.id); setSessions(null) })}>{s.title}</button>)}</div>}
      <div className="messages">{current.messages.length === 0 && <div className="welcome"><div className="orb">◯</div><span>ESTOU POR AQUI</span><h1>O que vamos fazer?</h1><p>Continue um assunto, abra um projeto<br/>ou me conte o que está pensando.</p></div>}{current.messages.map(m => <article key={m.id} className={m.role}><div className="speaker">{m.role === 'user' ? 'VOCÊ' : 'Omni'}{m.channel === 'voice' ? ' · VOZ' : ''}</div><div className="message-text">{m.text || (busy ? 'Preparando a resposta…' : '')}</div></article>)}<div ref={tail} /></div>
      <div className="composer-area">{error && <div role="alert" className="error">{error}</div>}{snapshot.permissions.filter(p => p.conversationId === current.id).map(p => <div className="permission" key={p.id}><strong>Permitir {p.tool} nesta ação?</strong><pre>{p.detail}</pre><button onClick={() => void act(() => window.omni.decide(p.id, true))}>Permitir</button><button onClick={() => void act(() => window.omni.decide(p.id, false))}>Recusar</button></div>)}
        <div className={'composer ' + (dictating ? 'dictating' : '')}>
          {dictating ? <DictationFeedback status={dictationStatus} level={dictationLevel} /> : <textarea aria-label="Mensagem para o Omni" placeholder={busy ? 'Envie uma nova instrução para abrir uma tarefa paralela…' : 'Fale comigo…'} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }} />}
          {busy && <div className="composer-actions composer-stop"><button className="send" onClick={() => void act(() => window.omni.cancel(current.id))}>■ Parar</button></div>}
        </div><div className="shortcut-strip"><button onClick={() => setHelp(!help)}>Atalhos <kbd>Ctrl + 0</kbd></button></div><div className="footnote">Claude · {labels[current.phase]} <span>Seu contexto acompanha a conversa</span></div>
      </div>
      {help && <div className="shortcut-help"><button onClick={() => setHelp(false)} aria-label="Fechar atalhos">×</button><h2>Do seu jeito.</h2><p><kbd>Ctrl + Enter</kbd> Mostrar / recolher Omni</p><p><kbd>Ctrl + 0</kbd> Toque: abrir / fechar Realtime</p><p><kbd>Ctrl + 0</kbd> Segurar: ditar · soltar: transcrever no rascunho</p><p><kbd>Ctrl + 9</kbd> Calibrar ruído do ditado</p><p><kbd>Enter</kbd> Enviar · <kbd>Shift + Enter</kbd> Nova linha</p><p><kbd>Esc</kbd> Fechar painel / cancelar ditado / recolher Omni</p><small>Voz e ditado usam a OpenAI. O chat continua na sua sessão Claude.</small></div>}
      {audioSettings && <AudioSettings onClose={() => setAudioSettings(false)} />}
      {realtime && <RealtimePanel status={voiceStatus} amplitude={amplitude} muted={muted} onMute={() => { voice.current?.mute(!muted); setMuted(!muted) }} onClose={closeVoice} />}
    </main>
    <aside className="inspector"><div className="section-label">CONTINUIDADE</div><h2>O que fica com você</h2><div className="memory-card"><span>Memória compartilhada</span><strong>{snapshot.state.memory.confirmed} <small>confirmadas</small></strong><p>{snapshot.state.memory.candidates} candidatas em avaliação</p></div><div className="section-label">MISSÕES ATIVAS</div>{snapshot.state.missions.length === 0 ? <p className="muted">As missões aparecem aqui quando disponíveis.</p> : snapshot.state.missions.slice(0, 8).map(m => <div className="mission" key={m.id}><i className="dot" /><span>{m.objective}<small>{m.state}</small></span></div>)}<div className="section-label timeline-label">NESTA CONVERSA</div><div className="timeline">{current.events.length === 0 ? <p className="muted">As ações e verificações aparecem durante o trabalho.</p> : current.events.slice(-12).reverse().map((e, i) => <div key={i}><small>{new Date(e.at).toLocaleTimeString('pt-BR')}</small><span>{e.text}</span></div>)}</div><div className="workspace-path" title={current.workspace}>{current.workspace}<small>{current.sessionId ? `Sessão ${current.sessionId.slice(0, 8)}` : 'Sessão criada no primeiro envio'}</small></div></aside>
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
function ActivityGroup({ label, source, activities, onOpen }: { label: string; source: 'omni' | 'vscode' | 'overcore' | 'oracle'; activities: Snapshot['state']['activities']; onOpen: (id: string) => void }) {
  const items = activities.filter(activity => activity.source === source)
  return <section className="activity-group"><h3>{label}</h3>{items.length === 0 ? <p className="empty-activity">Nada em execução.</p> : items.map(activity => <button className={'activity ' + activity.status} key={activity.id} onClick={() => activity.conversationId && onOpen(activity.conversationId)} disabled={!activity.conversationId && activity.status === 'unavailable'}><i className={'activity-status ' + activity.status} /><span>{activity.title}<small>{activity.detail}</small></span></button>)}</section>
}
createRoot(document.getElementById('root')!).render(<App />)
