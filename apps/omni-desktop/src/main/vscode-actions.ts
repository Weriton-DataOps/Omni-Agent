import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

const pause = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

/** Opens a validated project through the installed Omni VS Code bridge. */
export async function openVsCodeWorkspace(workspace: string) {
  if (!(await stat(workspace)).isDirectory()) throw new Error('O projeto informado não está disponível.')
  // Loading Electron only at the UI boundary keeps controller tests independent
  // from the Electron runtime while preserving the same production command.
  const { shell } = await import('electron')
  await shell.openExternal(`vscode://omni-local.omni-desktop-bridge/workspace?path=${encodeURIComponent(workspace)}`)
}

/** Dispatches a small, idempotent UI verb to the Omni bridge in one exact VS Code workspace. */
export async function openClaudePanel(workspace: string, directory: string) {
  const id = randomUUID()
  const actions = join(directory, 'vscode-actions')
  const actionPath = join(actions, `open-claude-${id}.json`)
  const receiptPath = join(actions, `receipt-${id}.json`)
  await mkdir(actions, { recursive: true })
  const temporary = `${actionPath}.tmp`
  await writeFile(temporary, JSON.stringify({ id, command: 'open-claude', workspace, at: new Date().toISOString() }), { mode: 0o600 })
  await rename(temporary, actionPath)
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    try {
      const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
      if (receipt?.id !== id) throw new Error('Recibo de janela invalido.')
      if (receipt.status === 'opened') return
      throw new Error(typeof receipt.error === 'string' ? receipt.error : 'O VS Code nao conseguiu abrir o Claude.')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await pause(120)
  }
  const present: string[] = await readdir(actions).catch((): string[] => [])
  if (present.includes(`open-claude-${id}.json`)) throw new Error('A janela do VS Code desse projeto nao confirmou o comando rapido.')
  throw new Error('A confirmacao de abertura do Claude expirou.')
}
