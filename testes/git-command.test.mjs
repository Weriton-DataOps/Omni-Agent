import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { analisarComandoGit } from '../runtime/git-command.mjs'
import { abrirTurnoAuditoria, registrarAcaoAuditoria } from '../runtime/auditoria-autocorrecao.mjs'

test('Git global options preserve subcommand and literal targets', () => {
  for (const command of ['git -C "C:/repo with spaces" log -1', 'git --git-dir=Y:/repo/.git rev-parse HEAD',
    'git -c core.preloadindex=true --no-pager -C C:/repo diff --cached', 'GIT_DIR=Y:/repo/.git git log -1']) {
    assert.equal(analisarComandoGit(command).effect, 'verification', command)
    assert.ok(analisarComandoGit(command).targets.length)
  }
  for (const command of ['git -C C:/repo reset --hard', 'git -c core.preloadindex=true push',
    'git --git-dir=repo/.git branch new-branch', 'git log --output=out.txt']) {
    assert.equal(analisarComandoGit(command).effect, 'mutation', command)
  }
  for (const command of ['git -C', 'git -c alias.foo=log foo', 'git -c core.sshCommand=evil log',
    'git -C "$repo" log', 'git diff --ext-diff', 'git --unknown log']) {
    assert.equal(analisarComandoGit(command).effect, 'execution', command)
  }
  assert.equal(analisarComandoGit('git log; git -C C:/repo reset --hard'), null)
  assert.equal(analisarComandoGit('git -C "unterminated log'), null)
})

test('audit links global-option Git reads to repository evidence; opaque chains cannot prove reads', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-git-audit-'))
  try {
    await abrirTurnoAuditoria(casa, { session_id: 'git-read', prompt: 'verifique o repositorio' })
    for (const [i, command] of ['git -C "C:/repo" log -1', 'git log; git -C C:/repo reset --hard',
      'echo "git log"', 'git -c alias.foo=log foo'].entries()) {
      const result = await registrarAcaoAuditoria(casa, { session_id: 'git-read', hook_event_name: 'PostToolUse',
        tool_name: 'Bash', tool_use_id: `git-${i}`, tool_input: { command }, cwd: 'C:/repo' })
      if (i === 0) {
        assert.equal(result.action.effect, 'verification')
        assert.equal(result.action.actionFamily, 'repository')
      } else assert.notEqual(result.action.effect, 'verification')
    }
  } finally { await rm(casa, { recursive: true, force: true }) }
})
