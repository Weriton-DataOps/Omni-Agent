import type { DesktopApi } from '../shared/contracts'
import { microphoneConstraints } from './audioSettings'

/** Local capture only. Releasing the shortcut transcribes into the draft, never auto-sends. */
export class Dictation {
  private epoch = 0
  private stream?: MediaStream
  private context?: AudioContext
  private recorder?: MediaRecorder
  private timer?: ReturnType<typeof setTimeout>
  private warming: Promise<MediaStream | null> | null = null
  private mode: 'idle' | 'capture' | 'calibrate' | 'transcribe' = 'idle'
  get active() { return this.mode !== 'idle' }
  constructor(private api: DesktopApi, private status: (s: string) => void, private text: (s: string) => void, private level: (n: number) => void = () => {}) {}
  warm() {
    if (this.warming !== null) return
    this.warming = navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints(), video: false }).catch(() => null)
  }
  discardWarm() {
    const warming = this.warming
    this.warming = null
    void warming?.then(stream => stream?.getTracks().forEach(track => track.stop()))
  }
  async start(calibrate = false) {
    if (this.active) return
    const epoch = ++this.epoch
    this.mode = calibrate ? 'calibrate' : 'capture'
    this.status(calibrate ? 'Fique em silêncio por 1,5 s…' : 'Abrindo microfone…')
    try {
      const warmed = this.warming; this.warming = null
      const stream = (warmed === null ? null : await warmed) ?? await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints(), video: false })
      if (epoch !== this.epoch) { stream.getTracks().forEach(t => t.stop()); return }
      this.stream = stream
      const context = this.context = new AudioContext()
      await context.resume()
      if (epoch !== this.epoch) return
      const analyser = context.createAnalyser(); analyser.fftSize = 512
      context.createMediaStreamSource(stream).connect(analyser)
      const values = new Uint8Array(analyser.fftSize)
      let peak = 0, sum = 0, count = 0
      const meter = setInterval(() => {
        analyser.getByteTimeDomainData(values)
        const rms = Math.sqrt(values.reduce((n, v) => n + ((v - 128) / 128) ** 2, 0) / values.length)
        peak = Math.max(peak, rms); sum += rms; count++
        this.level(Math.min(1, rms * 8))
      }, 25)
      const release = () => { clearInterval(meter); this.level(0); stream.getTracks().forEach(t => t.stop()); void context.close().catch(() => {}) }
      this.cleanup = release
      if (calibrate) {
        this.timer = setTimeout(() => {
          release(); if (epoch !== this.epoch) return
          const floor = sum / Math.max(count, 1)
          localStorage.setItem('omni.noise-floor', String(floor))
          this.mode = 'idle'; this.status('')
        }, 1500)
        // Cancel also clears the meter (including a closed window).
        this.cleanup = release
        return
      }
      const chunks: Blob[] = []
      const recorder = this.recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 128000 })
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
      recorder.onstop = () => {
        release(); clearTimeout(this.timer)
        if (epoch !== this.epoch) return
        const floor = Number(localStorage.getItem('omni.noise-floor')) || 0
        if (peak < Math.max(.02, floor * 2) || new Blob(chunks).size < 1200) { this.mode = 'idle'; this.status(''); return }
        this.mode = 'transcribe'; this.status('Transcrevendo…')
        void new Blob(chunks, { type: 'audio/webm' }).arrayBuffer().then(b => this.api.transcribe(b)).then(text => {
          if (epoch === this.epoch) { this.text(text); this.status('') }
        }).catch(() => { if (epoch === this.epoch) this.status('Não foi possível transcrever o ditado.') }).finally(() => { if (epoch === this.epoch) this.mode = 'idle' })
      }
      this.cleanup = release
      recorder.start(); this.status('Gravando · solte Ctrl+0 para transcrever')
      this.timer = setTimeout(() => this.finish(), 60000)
    } catch { if (epoch === this.epoch) { this.cancel(); this.status('Microfone indisponível.') } }
  }
  private cleanup = () => {}
  finish() {
    if (this.mode !== 'capture') return
    if (this.recorder?.state === 'recording') this.recorder.stop()
    else this.cancel()
  }
  cancel() {
    this.epoch++; clearTimeout(this.timer)
    if (this.recorder?.state === 'recording') this.recorder.stop()
    this.cleanup(); this.cleanup = () => {}
    this.stream?.getTracks().forEach(t => t.stop())
    void this.context?.close().catch(() => {})
    this.level(0); this.recorder = undefined; this.mode = 'idle'
    this.discardWarm()
  }
}
