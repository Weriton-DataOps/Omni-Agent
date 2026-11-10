// Sessões do Claude Code que podem receber trabalho (F2, plano 4a, T5). O nome que as sessões usam entre
// si ("omni-a0", "overcore-3e") mora em ~/.claude/sessions/<pid>.json, junto com a pasta e o estado.
// Só valem as interativas de processo vivo; arquivo no meio da escrita é ignorado. Porte da ilha.
import { readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const PASTA_SESSOES = join(homedir(), '.claude', 'sessions')

export function processoVivo(pid) {
  try { process.kill(pid, 0); return true } catch (erro) { return erro.code === 'EPERM' }
}

export function sessoesVivas({ pasta = PASTA_SESSOES, vivo = processoVivo } = {}) {
  let nomes = []
  try { nomes = readdirSync(pasta).filter((n) => /^\d+\.json$/.test(n)) } catch { return [] }
  const vivas = []
  for (const n of nomes) {
    let j
    try { j = JSON.parse(readFileSync(join(pasta, n), 'utf8')) } catch { continue }
    if (!j || !j.sessionId || !j.name || j.kind !== 'interactive' || !vivo(Number(j.pid))) continue
    vivas.push({
      sessionId: String(j.sessionId),
      nome: String(j.name),
      cwd: String(j.cwd || ''),
      status: String(j.status || ''),
      pid: Number(j.pid),
      kind: String(j.kind),
      startedAt: Number(j.startedAt) || 0
    })
  }
  return vivas
}
