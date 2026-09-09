import React, { useEffect, useRef, useState } from 'react'
import { materia, type Materia } from './materia'
export function RealtimePanel({ status, amplitude, muted, onMute, onClose }: {
  status: string; amplitude: React.MutableRefObject<number>; muted: boolean; onMute: () => void; onClose: () => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const shape = useRef<Materia | null>(null)
  const close = useRef<HTMLButtonElement>(null)
  const [fallback, setFallback] = useState(false)
  const ready = status.startsWith('Voz ligada') || status.startsWith('Omni está')
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    close.current?.focus()
    shape.current = materia(canvas.current!)
    setFallback(!shape.current)
    let frame = 0
    const update = () => { shape.current?.voz(amplitude.current); frame = requestAnimationFrame(update) }
    update()
    return () => { cancelAnimationFrame(frame); shape.current?.desligar(); shape.current = null; previous?.focus() }
  }, [])
  useEffect(() => { if (ready) shape.current?.liberar() }, [ready])
  return <section className="realtime" role="dialog" aria-modal="false" aria-label="Conversa Realtime" data-ready={ready} onKeyDown={e => {
    if (e.key !== 'Tab') return
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    e.preventDefault(); buttons[(index + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus()
  }}>
    <div className="realtime-top"><span>Omni <b>/</b> REALTIME</span><button ref={close} onClick={onClose} aria-label="Fechar Realtime">×</button></div>
    <div className="matter-stage"><canvas ref={canvas} aria-label="Forma tridimensional que responde à voz do Omni" />{fallback && <div className="matter-fallback">◯</div>}</div>
    <div className="realtime-caption"><h2>{ready ? 'Estou com você.' : 'Um instante…'}</h2><p role="status">{muted && ready ? 'Microfone pausado' : status}</p></div>
    <div className="realtime-actions"><button disabled={!ready} aria-pressed={muted} onClick={onMute}>{muted ? 'Ativar microfone' : 'Pausar microfone'}</button><button onClick={onClose}>Voltar à escrita <kbd>Esc</kbd></button></div>
    <small className="realtime-hint">O mesmo Omni. A mesma conversa. <kbd>Ctrl</kbd> + <kbd>0</kbd></small>
  </section>
}
