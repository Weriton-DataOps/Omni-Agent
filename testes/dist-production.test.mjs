import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { ClaudeActivationStore } from '../dist/adapters/claude/activation-store.js'
import {
  isExpectedClaudeTranscript,
  isOmniActivationCommand,
  parseClaudeHookInput,
  scopeIdentity
} from '../dist/adapters/claude/host-input.js'
import { buildHookTurnContext } from '../dist/application/build-turn-context/build-hook-context.js'
import {
  assembleContextBlocks,
  RequiredContextExceedsBudgetError
} from '../dist/core/context/context-block.js'
import {
  renderCompactPersonalityInstruction,
  renderFullPersonalityInstruction
} from '../dist/core/personality/personality.js'

test('dist de producao expoe e executa os contratos criticos de personalidade e contexto', async () => {
  assert.equal(typeof ClaudeActivationStore, 'function')
  assert.equal(typeof parseClaudeHookInput, 'function')
  assert.equal(typeof scopeIdentity, 'function')
  assert.equal(typeof isExpectedClaudeTranscript, 'function')
  assert.equal(typeof assembleContextBlocks, 'function')
  assert.equal(typeof RequiredContextExceedsBudgetError, 'function')
  assert.equal(typeof buildHookTurnContext, 'function')
  assert.equal(typeof renderFullPersonalityInstruction, 'function')
  assert.equal(typeof renderCompactPersonalityInstruction, 'function')

  const assembled = assembleContextBlocks([
    { kind: 'required', id: 'dist:personality', content: 'PERSONALIDADE_DIST_OBRIGATORIA' },
    { kind: 'optional', id: 'dist:audit', content: 'AUDITORIA_DIST_DESCARTAVEL', priority: 1 }
  ], 40)
  assert.equal(assembled.text, 'PERSONALIDADE_DIST_OBRIGATORIA')
  assert.deepEqual(assembled.omitted, ['dist:audit'])

  const turn = buildHookTurnContext({
    persona: {
      manifest: { id: 'omni-persona-v3-candidate' },
      continuityAnchor: 'Inventor Cumplice permanece ativo no dist.',
      textAdapter: 'Conversa escrita.',
      learnedAdjustmentText: null
    },
    projection: '## RULES\n- REGRA_DIST_VERIFICADA'
  })
  assert.ok(turn.characters <= 9_500)
  assert.match(turn.text, /Inventor Cumplice permanece ativo no dist/)
  assert.match(turn.text, /REGRA_DIST_VERIFICADA/)

  const root = await mkdtemp(join(tmpdir(), 'omni-dist-production-'))
  const home = join(root, 'home')
  const pluginData = join(root, 'plugin-data')
  const primary = parseClaudeHookInput({
    hook_event_name: 'UserPromptSubmit',
    session_id: 'sessao-dist-producao',
    cwd: join(root, 'projeto'),
    prompt: '/omni:omni'
  })
  assert.equal(primary.ok, true)
  if (!primary.ok) return
  assert.equal(isOmniActivationCommand(primary.value), true)
  const store = new ClaudeActivationStore(home, { CLAUDE_PLUGIN_DATA: pluginData })
  try {
    assert.equal((await store.activate(primary.value, { persistScope: true })).gravados, 3)
    assert.equal((await store.isSessionActive(primary.value)).ativa, true)
    const sidechain = parseClaudeHookInput({ ...primary.value, isSidechain: true })
    assert.equal(sidechain.ok, true)
    if (sidechain.ok) {
      assert.equal(isOmniActivationCommand(sidechain.value), false)
      assert.equal((await store.isSessionActive(sidechain.value)).ativa, false)
    }
    for (const directory of [
      join(pluginData, 'active-sessions'),
      join(home, 'runtime', 'active-sessions'),
      join(home, 'runtime', 'active-scopes')
    ]) {
      assert.deepEqual((await readdir(directory)).map((name) => /\.json$/u.test(name)), [true])
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
