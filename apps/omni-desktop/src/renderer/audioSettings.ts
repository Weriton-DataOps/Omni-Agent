const MIC = 'omni.desktop.microphone'
const OUTPUT = 'omni.desktop.output'
const VOICE = 'omni.desktop.realtime-voice'

export const realtimeVoices = [
  ['cedar', 'Cedar — grave'], ['marin', 'Marin — clara'], ['ballad', 'Ballad — quente'],
  ['sage', 'Sage — calma'], ['ash', 'Ash — firme'], ['coral', 'Coral — animada'],
  ['verse', 'Verse — conversada'], ['alloy', 'Alloy — neutra'], ['echo', 'Echo — lisa'], ['shimmer', 'Shimmer — leve']
] as const

const read = (key: string) => typeof localStorage === 'undefined' ? '' : localStorage.getItem(key) ?? ''
const write = (key: string, value: string) => { if (typeof localStorage !== 'undefined') localStorage.setItem(key, value) }
export const microphoneId = () => read(MIC)
export const outputId = () => read(OUTPUT)
export const realtimeVoice = () => read(VOICE) || 'cedar'
export const setMicrophoneId = (id: string) => write(MIC, id)
export const setOutputId = (id: string) => write(OUTPUT, id)
export const setRealtimeVoice = (id: string) => write(VOICE, id)

export function microphoneConstraints(): MediaTrackConstraints {
  const base: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
  const id = microphoneId()
  return id ? { ...base, deviceId: { exact: id } } : base
}

export async function routeAudio(audio: HTMLAudioElement): Promise<void> {
  const id = outputId()
  const sink = audio as HTMLAudioElement & { setSinkId?: (value: string) => Promise<void> }
  if (id && sink.setSinkId) await sink.setSinkId(id).catch(() => undefined)
}

export async function routeContext(context: AudioContext): Promise<void> {
  const id = outputId()
  const sink = context as AudioContext & { setSinkId?: (value: string) => Promise<void> }
  if (id && sink.setSinkId) await sink.setSinkId(id).catch(() => undefined)
}
