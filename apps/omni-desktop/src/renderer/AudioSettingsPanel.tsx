import React, { useEffect, useState } from 'react'
import { microphoneId, outputId, realtimeVoice, realtimeVoices, setMicrophoneId, setOutputId, setRealtimeVoice } from './audioSettings'

type Device = { id: string; label: string }
export function AudioSettings({ onClose }: { onClose: () => void }) {
  const [inputs, setInputs] = useState<Device[]>([])
  const [outputs, setOutputs] = useState<Device[]>([])
  const [problem, setProblem] = useState('')
  const [mic, setMic] = useState(microphoneId())
  const [output, setOutput] = useState(outputId())
  const [voice, setVoice] = useState(realtimeVoice())
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const permission = await navigator.mediaDevices.getUserMedia({ audio: true })
        permission.getTracks().forEach(track => track.stop())
        const devices = await navigator.mediaDevices.enumerateDevices()
        if (!live) return
        const named = (kind: MediaDeviceKind) => devices.filter(device => device.kind === kind && device.deviceId).map((device, index) => ({ id: device.deviceId, label: device.label || `${kind === 'audioinput' ? 'Microfone' : 'Saída'} ${index + 1}` }))
        setInputs(named('audioinput')); setOutputs(named('audiooutput'))
      } catch { if (live) setProblem('Não foi possível listar o áudio. Verifique a permissão do microfone.') }
    })()
    return () => { live = false }
  }, [])
  const chooseMic = (value: string) => { setMic(value); setMicrophoneId(value) }
  const chooseOutput = (value: string) => { setOutput(value); setOutputId(value) }
  const chooseVoice = (value: string) => { setVoice(value); setRealtimeVoice(value) }
  return <section className="audio-settings" role="dialog" aria-modal="true" aria-label="Configurações de áudio">
    <div><span>Omni <b>/</b> ÁUDIO</span><button onClick={onClose} aria-label="Fechar configurações de áudio">×</button></div>
    <h2>Escutar e responder do jeito certo.</h2><p>As escolhas ficam somente neste computador e passam a valer na próxima abertura do Realtime.</p>
    {problem && <p className="audio-problem" role="alert">{problem}</p>}
    <label>Microfone<select aria-label="Microfone" value={mic} onChange={event => chooseMic(event.target.value)}><option value="">Padrão do sistema</option>{inputs.map(device => <option key={device.id} value={device.id}>{device.label}</option>)}</select></label>
    <label>Saída de áudio<select aria-label="Saída de áudio" value={output} onChange={event => chooseOutput(event.target.value)}><option value="">Padrão do sistema</option>{outputs.map(device => <option key={device.id} value={device.id}>{device.label}</option>)}</select></label>
    <label>Voz do Omni<select aria-label="Voz do Omni" value={voice} onChange={event => chooseVoice(event.target.value)}>{realtimeVoices.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    <p className="audio-note">Para calibrar o ruído do ambiente, use <kbd>Ctrl + 9</kbd> em silêncio.</p>
  </section>
}
