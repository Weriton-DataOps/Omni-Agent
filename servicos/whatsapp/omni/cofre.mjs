// Omni — acesso ao cofre (Gerenciador de Credenciais do Windows) a partir do Node.
// O segredo trafega só por stdin/stdout do processo filho, nunca por argumento.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const script = join(fileURLToPath(new URL('.', import.meta.url)), 'cofre.ps1')
const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

export const NOMES = {
  admin: 'omni/whatsapp/admin',
  leitura: 'omni/whatsapp/leitura',
  envio: 'omni/whatsapp/envio',
}

function rodar(acao, nome, entrada) {
  return spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Acao', acao, '-Nome', nome], {
    input: entrada ?? '', encoding: 'utf8', windowsHide: true, timeout: 30_000,
  })
}

// Cache no processo: MCP e ponte vivem muito e não devem abrir o cofre a cada chamada.
const cache = new Map()
export function lerSegredo(nome) {
  if (cache.has(nome)) return cache.get(nome)
  const r = rodar('ler', nome)
  if (r.status === 2) throw new Error(`segredo ${nome} não está no cofre; rode omni/chaves.mjs`)
  if (r.status !== 0) throw new Error(`cofre indisponível ao ler ${nome}: ${String(r.stderr).trim().slice(0, 200)}`)
  const valor = String(r.stdout).trim()
  cache.set(nome, valor)
  return valor
}

export function gravarSegredo(nome, valor) {
  const r = rodar('gravar', nome, valor)
  if (r.status !== 0) throw new Error(`cofre recusou gravar ${nome}: ${String(r.stderr).trim().slice(0, 200)}`)
  cache.delete(nome)
}

export function apagarSegredo(nome) {
  cache.delete(nome)
  return rodar('apagar', nome).status === 0
}
