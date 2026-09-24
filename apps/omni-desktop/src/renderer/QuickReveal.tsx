import React, { useEffect, useRef, useState } from 'react'
import { MessageText } from './MessageText'

/** Presentation only: the complete, persisted summary exists before this mounts. */
export function QuickReveal({ text, onComplete }: { text: string; onComplete: () => void }) {
  const [length, setLength] = useState(0)
  const callbacks = useRef({ onComplete }); callbacks.current = { onComplete }
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { callbacks.current.onComplete(); return }
    const duration = Math.min(3200, Math.max(650, text.length / 1.2))
    let frame: number, started: number | undefined
    const tick = (time: number) => {
      started ??= time
      const next = Math.min(text.length, Math.max(1, Math.ceil(text.length * (time - started) / duration)))
      // Do not split a UTF-16 surrogate pair while revealing emoji.
      setLength(next < text.length && /[\uD800-\uDBFF]/.test(text[next - 1]) ? next + 1 : next)
      if (time - started < duration) frame = requestAnimationFrame(tick)
      else callbacks.current.onComplete()
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [text])
  return <div className="quick-reveal" aria-label="Exibindo resumo pronto"><MessageText text={text.slice(0, length)} streaming /></div>
}
