// Guarda da trava (relatório 04/11, itens 3.3 e 3.4). Tudo em pasta temporária com trava de teste;
// a trava real C:\tmp\suite-pesada.lock nunca é tocada.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const raiz = mkdtempSync(join(tmpdir(), 'omni-trava-guarda-'))
const TRAVA = join(raiz, 'trava-teste.lock')
process.env.OMNI_TRAVA = TRAVA
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'omni-trava-guarda.mjs')
const g = await import('../scripts/omni-trava-guarda.mjs')

const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
function repo(nome) {
  const remoto = join(raiz, `${nome}.git`)
  const dir = join(raiz, nome)
  execFileSync('git', ['init', '--bare', '-b', 'main', remoto], { windowsHide: true, stdio: 'ignore' })
  execFileSync('git', ['init', '-b', 'main', dir], { windowsHide: true, stdio: 'ignore' })
  git(dir, 'config', 'user.email', 'teste@exemplo.invalid'); git(dir, 'config', 'user.name', 'teste')
  git(dir, 'config', 'commit.gpgsign', 'false')
  git(dir, 'remote', 'add', 'origin', remoto)
  writeFileSync(join(dir, 'README.md'), 'x\n')
  git(dir, 'add', '.'); git(dir, 'commit', '-m', 'inicio'); git(dir, 'push', '-u', 'origin', 'main')
  return dir
}
const pegaTrava = `$f=[System.IO.File]::Open('${TRAVA}','CreateNew','Write'); $f.Close(); Add-Content '${join(raiz, 'fila.txt')}' 'x'`

let limpo, sujo, semPush, tela
before(() => {
  limpo = repo('limpo')
  sujo = repo('sujo'); writeFileSync(join(sujo, 'README.md'), 'mudou\n')
  semPush = repo('sempush'); writeFileSync(join(semPush, 'a.txt'), 'a\n'); git(semPush, 'add', '.'); git(semPush, 'commit', '-m', 'local')
  tela = repo('tela')
  git(tela, 'checkout', '-b', 'feat/tela-x')
  mkdirSync(join(tela, 'apps', 'web', 'components'), { recursive: true })
  writeFileSync(join(tela, 'apps', 'web', 'components', 'Lista.tsx'), 'export {}\n')
  git(tela, 'add', '.'); git(tela, 'commit', '-m', 'tela'); git(tela, 'push', '-u', 'origin', 'feat/tela-x')
})
after(() => rmSync(raiz, { recursive: true, force: true }))

test('só gravação NA trava conta: soltar, conferir e ler passam', () => {
  assert.equal(g.querGravarTrava('PowerShell', { command: pegaTrava }), true)
  assert.equal(g.querGravarTrava('Bash', { command: `echo "-13/x" > '${TRAVA.replace(/\\/g, '/')}'` }), true)
  assert.equal(g.querGravarTrava('Write', { file_path: TRAVA }), true)
  assert.equal(g.querGravarTrava('PowerShell', { command: `Remove-Item '${TRAVA}'` }), false)
  assert.equal(g.querGravarTrava('PowerShell', { command: `while (Test-Path '${TRAVA}') { Start-Sleep 5 }` }), false)
  assert.equal(g.querGravarTrava('PowerShell', { command: `Get-Content '${TRAVA}'` }), false)
  assert.equal(g.querGravarTrava('PowerShell', { command: `Set-Content '${join(raiz, 'outro.txt')}' x` }), false)
  assert.equal(g.querGravarTrava('Read', { file_path: TRAVA }), false)
})

test('worktree com arquivo modificado: pegar a trava é recusado com a frase do relatório', () => {
  const d = g.decidir({ tool_name: 'PowerShell', tool_input: { command: pegaTrava }, cwd: sujo })
  assert.equal(d.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(d.hookSpecificOutput.permissionDecisionReason, /^faça commit WIP e push antes de pegar a trava\./)
  assert.match(d.hookSpecificOutput.permissionDecisionReason, /1 arquivo\(s\) sem commit \(README\.md\)/)
})

test('commit sem push também recusa; Write direto no arquivo da trava também', () => {
  const d = g.decidir({ tool_name: 'PowerShell', tool_input: { command: pegaTrava }, cwd: semPush })
  assert.match(d.hookSpecificOutput.permissionDecisionReason, /1 commit\(s\) sem push/)
  const w = g.decidir({ tool_name: 'Write', tool_input: { file_path: TRAVA, content: '-13/x' }, cwd: sujo })
  assert.equal(w.hookSpecificOutput.permissionDecision, 'deny')
})

test('sessão fora do repo: acha a worktree pelo git -C / Set-Location do comando', () => {
  const cmd = `Set-Location '${sujo}'; ${pegaTrava}`
  const d = g.decidir({ tool_name: 'PowerShell', tool_input: { command: cmd }, cwd: raiz })
  assert.equal(d?.hookSpecificOutput?.permissionDecision, 'deny')
})

test('worktree limpa e com push: passa sem decisão', () => {
  assert.equal(g.decidir({ tool_name: 'PowerShell', tool_input: { command: pegaTrava }, cwd: limpo }), null)
})

test('3.4: ramo só de tela listando 5 specs gera aviso, não bloqueio; 2 specs passam calados', () => {
  const muitos = `${pegaTrava}; npx playwright test w11-lista.spec.ts w12-busca.spec.ts w13-filtro.spec.ts w14-card.spec.ts w15-menu.spec.ts`
  const d = g.decidir({ tool_name: 'PowerShell', tool_input: { command: muitos }, cwd: tela })
  assert.equal(d.hookSpecificOutput.permissionDecision, undefined)
  assert.match(d.systemMessage, /Prova proporcional \(regra de 02\/11\).*5 specs.*É aviso, não bloqueio\./)
  const poucos = `${pegaTrava}; npx playwright test w11-lista.spec.ts w12-busca.spec.ts`
  assert.equal(g.decidir({ tool_name: 'PowerShell', tool_input: { command: poucos }, cwd: tela }), null)
})

test('como hook de verdade (stdin → stdout): recusa no sujo, silêncio no limpo, entrada torta não trava', () => {
  const roda = entrada => execFileSync(process.execPath, [SCRIPT, '--trava', TRAVA], { input: entrada, encoding: 'utf8', windowsHide: true })
  const neg = JSON.parse(roda(JSON.stringify({ tool_name: 'PowerShell', tool_input: { command: pegaTrava }, cwd: sujo })))
  assert.equal(neg.hookSpecificOutput.permissionDecision, 'deny')
  assert.equal(roda(JSON.stringify({ tool_name: 'PowerShell', tool_input: { command: pegaTrava }, cwd: limpo })), '')
  assert.equal(roda('isso não é json'), '')
})
