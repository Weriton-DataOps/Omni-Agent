// Omni — guarda da trava da suíte pesada (hook PreToolUse; relatório de 04/11/2026, itens 3.3 e 3.4).
//
// 3.3  Trabalho nunca só no disco: pegar C:\tmp\suite-pesada.lock com mudança sem commit ou sem push
//      na worktree é recusado. Foi assim que a -b9 morreu em 03/11 com 18 arquivos só no disco.
// 3.4  Prova proporcional: mudança só de tela, sem migração, roda só os specs da tela. Lista maior
//      gera AVISO (não bloqueio) na hora de pegar a trava.
//
// Entrada: JSON do hook no stdin ({ tool_name, tool_input, cwd }). Saída: JSON de decisão do hook.
// Só olha gravação NA trava: soltar (Remove-Item), conferir (Test-Path) e ler passam direto.
//   node omni-trava-guarda.mjs [--trava <caminho do lock>]     (padrão C:\tmp\suite-pesada.lock)
import { readFileSync, existsSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const iTrava = args.indexOf('--trava')
const TRAVA = iTrava >= 0 ? args[iTrava + 1] : (process.env.OMNI_TRAVA || 'C:\\tmp\\suite-pesada.lock')
const NOME = basename(TRAVA.replace(/\\/g, '/'))
const escapa = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const RE_NOME = new RegExp(escapa(NOME), 'i')
const ESCRITA = /CreateNew|OpenOrCreate|FileMode\]::Create|WriteAll(Text|Bytes|Lines)|Set-Content|Add-Content|Out-File|New-Item|Copy-Item|Move-Item|\btee\b|>{1,2}\s*["']?[^\s"';|]*NOME/i
const SOLTURA = /^\s*(Remove-Item|rm|del|erase|ri)\b/i

export function querGravarTrava(tool, input) {
  if (!input) return false
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) return basename(String(input.file_path || '').replace(/\\/g, '/')).toLowerCase() === NOME.toLowerCase()
  if (tool !== 'Bash' && tool !== 'PowerShell') return false
  const cmd = String(input.command || '')
  if (!RE_NOME.test(cmd)) return false
  const escrita = new RegExp(ESCRITA.source.replace('NOME', escapa(NOME)), 'i')
  return cmd.split(/;|&&|\|\||\r?\n/).some(seg => RE_NOME.test(seg) && !SOLTURA.test(seg) && escrita.test(seg))
}

function git(cwd, a) {
  return execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', windowsHide: true, timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}
const ehRepo = d => { try { return !!d && existsSync(d) && git(d, ['rev-parse', '--is-inside-work-tree']) === 'true' } catch { return false } }

// Onde está o trabalho: a pasta da sessão, as pastas que o comando cita (git -C, cd, Set-Location,
// Push-Location) e a worktree do ramo escrito no texto da trava ("…; feat/lista-cinco-secoes)").
export function worktreesCandidatas(cwd, cmd) {
  const c = new Set()
  if (ehRepo(cwd)) c.add(resolve(cwd))
  for (const m of String(cmd || '').matchAll(/(?:git\s+-C|\bcd|Set-Location|Push-Location|-Path|-LiteralPath)\s+["']?([A-Za-z]:[\\/][^"';|\s]+|\/[a-z]\/[^"';|\s]+)/gi)) {
    let p = m[1]
    if (/^\/[a-z]\//i.test(p)) p = `${p[1]}:${p.slice(2)}`.replace(/\//g, '\\')
    if (RE_NOME.test(p) || !isAbsolute(p)) continue
    if (ehRepo(p)) c.add(resolve(p))
  }
  const ramos = [...String(cmd || '').matchAll(/[;(]\s*((?:feat|fix|chore|docs|refactor|test|perf|wip|hotfix)\/[A-Za-z0-9._\/-]+)\s*\)/g)].map(m => m[1])
  for (const base of [...c]) {
    if (!ramos.length) break
    let lista = ''
    try { lista = git(base, ['worktree', 'list', '--porcelain']) } catch { continue }
    let atual = null
    for (const l of lista.split(/\r?\n/)) {
      if (l.startsWith('worktree ')) atual = l.slice(9)
      if (l.startsWith('branch ') && ramos.includes(l.slice(7).replace('refs/heads/', '')) && atual && ehRepo(atual)) c.add(resolve(atual))
    }
  }
  return [...c]
}

// Pendência: arquivo modificado/novo, commit sem push, ou ramo que nunca subiu.
export function pendencias(dir) {
  const out = []
  // porcelain cru: o trim() comeria o espaço de " M arq" e o slice(3) levaria a 1ª letra do nome
  const status = execFileSync('git', ['-C', dir, 'status', '--porcelain=v1', '--untracked-files=normal'],
    { encoding: 'utf8', windowsHide: true, timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] })
  const sujos = status.split(/\r?\n/).filter(l => l.trim())
  if (sujos.length) out.push(`${sujos.length} arquivo(s) sem commit (${sujos.slice(0, 3).map(l => l.slice(3)).join(', ')}${sujos.length > 3 ? ', …' : ''})`)
  let semPush = 0
  try { semPush = Number(git(dir, ['rev-list', '--count', '@{u}..HEAD'])) }
  catch { try { semPush = Number(git(dir, ['rev-list', '--count', 'HEAD', '--not', '--remotes'])) } catch { semPush = 0 } }
  if (semPush > 0) out.push(`${semPush} commit(s) sem push`)
  return out
}

// 3.4: arquivos do ramo contra a main; tela pura = nenhum arquivo de banco/servidor e algum de tela.
const BACK = /(migra|\.sql$|schema|drizzle|prisma|(^|\/)(server|api|backend|worker|db)\/)/i
const TELA = /\.(tsx|jsx|vue|svelte|css|scss)$|(^|\/)(apps\/web|web|front|frontend|ui|telas?|components|pages)\//i
export function avisoProporcional(dir, cmd) {
  let arquivos = []
  for (const base of ['origin/main', 'main', 'origin/master']) {
    try { arquivos = git(dir, ['diff', '--name-only', `${base}...HEAD`]).split(/\r?\n/).filter(Boolean); break } catch {}
  }
  if (!arquivos.length) return null
  if (arquivos.some(f => BACK.test(f)) || !arquivos.some(f => TELA.test(f))) return null
  const specs = new Set([...String(cmd || '').matchAll(/[\w./-]*?(w\d+[a-z]?[\w-]*)\.spec\.[tj]sx?/gi)].map(m => m[1].toLowerCase()))
  for (const m of String(cmd || '').matchAll(/\b(w\d+[a-z]?(?:-[\w-]+)?)\b/gi)) specs.add(m[1].toLowerCase())
  const daTela = new Set(arquivos.filter(f => /\.spec\.[tj]sx?$/.test(f)).map(f => basename(f).replace(/\.spec\.[tj]sx?$/, '').toLowerCase()))
  const limite = Math.max(3, daTela.size)
  if (specs.size <= limite) return null
  return `Prova proporcional (regra de 02/11): o ramo mexe só em tela (${arquivos.length} arquivo(s), sem migração), mas a rodada lista ${specs.size} specs (${[...specs].slice(0, 6).join(', ')}${specs.size > 6 ? ', …' : ''}). Mudança só de tela pede só os specs da tela${daTela.size ? ` (${[...daTela].join(', ')})` : ''}. É aviso, não bloqueio.`
}

export function decidir(entrada) {
  const { tool_name: tool, tool_input: input, cwd } = entrada || {}
  if (!querGravarTrava(tool, input)) return null
  const cmd = input?.command || ''
  const dirs = worktreesCandidatas(cwd, cmd)
  const problemas = []
  for (const d of dirs) { const p = pendencias(d); if (p.length) problemas.push(`${d}: ${p.join('; ')}`) }
  if (problemas.length) {
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
      permissionDecisionReason: `faça commit WIP e push antes de pegar a trava. ${problemas.join(' | ')}` } }
  }
  const aviso = dirs.map(d => avisoProporcional(d, cmd)).find(Boolean)
  if (aviso) return { systemMessage: aviso, hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: aviso } }
  return null
}

const direto = process.argv[1] && import.meta.url.toLowerCase().endsWith(basename(process.argv[1]).toLowerCase())
if (direto) {
  let entrada = {}
  try { entrada = JSON.parse(readFileSync(0, 'utf8') || '{}') } catch { process.exit(0) }   // entrada estranha: não atrapalha
  try {
    const d = decidir(entrada)
    if (d) process.stdout.write(JSON.stringify(d))
  } catch (e) {
    // falha da própria guarda não pode travar a sessão: deixa passar e diz por quê
    process.stdout.write(JSON.stringify({ systemMessage: `guarda da trava falhou e deixou passar: ${e.message}` }))
  }
  process.exit(0)
}
