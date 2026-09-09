import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { transcriptForUse } from '../shared/transcription'
const exec = promisify(execFile)
export const root = process.env.OMNI_SOURCE_ROOT || join(import.meta.dirname, '../../../..')
export const home = process.env.OMNI_HOME || join(process.env.APPDATA!, 'omni')
export async function moduleAt(relative: string) {
  return import(/* @vite-ignore */ pathToFileURL(join(root, relative)).href)
}
export async function broker() {
  const { NodeAccessBrokerClient } = await moduleAt('dist/adapters/windows/node-access-broker-client.js')
  return new NodeAccessBrokerClient(undefined, 10000)
}
export async function startRuntime(): Promise<void> {
  try { if ((await (await broker()).health()).status === 'ready') return } catch { /* start below */ }
  await exec('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts/start-user-omni-runtime.ps1')], { windowsHide: true, timeout: 30000 })
  for (let i = 0; i < 10; i++) {
    try { if ((await (await broker()).health()).status === 'ready') return } catch { /* bounded readiness */ }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error('O banco ainda não respondeu. A conversa permanece disponível; a sincronização será tentada novamente.')
}
export async function claudeExecutable(): Promise<string> {
  const base = join(homedir(), '.vscode/extensions')
  const versions = (await readdir(base)).filter(n => /^anthropic\.claude-code-\d/.test(n)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  for (const version of versions) {
    const path = join(base, version, 'resources/native-binary/claude.exe')
    try { await access(path); return path } catch { /* next installed version */ }
  }
  throw new Error('Não encontrei o executável Claude da extensão instalada no VS Code.')
}
export async function voiceAvailable() {
  try { await access(join(process.env.APPDATA!, 'omni/access/openai-realtime.dpapi')); return true } catch { return false }
}
export async function mintVoiceToken() {
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts/omni-realtime-token.ps1')], { windowsHide: true, timeout: 25000, maxBuffer: 65536 })
  const result = JSON.parse(stdout)
  if (!result.ok) throw new Error(result.error || 'Não foi possível iniciar a voz.')
  return { value: String(result.value), expiresAt: Number(result.expiresAt) }
}

let transcribing = false
export async function transcribeAudio(audio: unknown): Promise<string> {
  if (!(audio instanceof ArrayBuffer) || audio.byteLength < 32 || audio.byteLength > 4 * 1024 * 1024) throw new Error('Áudio inválido ou acima do limite de 4 MB.')
  const bytes = Buffer.from(audio)
  if (bytes.readUInt32BE(0) !== 0x1a45dfa3) throw new Error('Formato de áudio inválido: esperado WebM.')
  if (transcribing) throw new Error('Já existe um ditado em transcrição.')
  transcribing = true
  try {
    return await new Promise<string>((resolve, reject) => {
      const child = execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts/omni-transcribe.ps1')], { windowsHide: true, timeout: 40000, maxBuffer: 65536 }, (error, stdout) => {
        if (error) { reject(new Error('Não foi possível transcrever o ditado.')); return }
        try {
          const result = JSON.parse(stdout); if (!result.ok) throw new Error(result.error)
          const transcript = transcriptForUse(result.text)
          if (transcript.reason) throw new Error(transcript.reason)
          resolve(transcript.text)
        } catch { reject(new Error('Não entendi esse ditado com segurança. Repita, por favor.')) }
      })
      child.stdin?.on('error', () => {})
      child.stdin?.end(bytes.toString('base64'))
    })
  } finally { transcribing = false }
}
