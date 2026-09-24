import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Coordinator } from '../src/main/coordinator'
import { Store } from '../src/main/store'
import { canApproveBlocker, validateReview } from '../src/shared/supervision'

async function until(check: () => boolean) {
  const end = Date.now() + 2000
  while (!check()) {
    if (Date.now() > end) throw new Error('Timeout')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

test('somente bloqueio de segurança rotineiro e limitado fica aprovável no Desktop', () => {
  const safe = validateReview({
    action: 'decision', message: 'O classificador pediu confirmação para a mesma leitura.', instruction: null, withinScope: true, needsOwner: true,
    blocker: { kind: 'security', title: 'Segurança · leitura limitada', cause: 'O classificador pediu confirmação.', risk: 'A leitura não começa sem mandato.', remedy: 'Executar somente a leitura prevista.', continuation: 'Execute somente a leitura prevista no briefing e confira o resultado.', desktopApproval: true }
  })
  assert.equal(canApproveBlocker(safe.blocker), true)
  const secret = validateReview({
    action: 'decision', message: 'Token ausente.', instruction: null, withinScope: true, needsOwner: true,
    blocker: { kind: 'security', title: 'Segurança · token', cause: 'O token não está disponível.', risk: 'O segredo não pode sair do Crachá.', remedy: 'Use o Crachá.', continuation: 'Use o token da conta.', desktopApproval: true }
  })
  assert.equal(canApproveBlocker(secret.blocker), false)
  const privilege = validateReview({
    action: 'decision', message: 'Administrative privilege requested.', instruction: null, withinScope: true, needsOwner: true,
    blocker: { kind: 'security', title: 'Security privilege', cause: 'The task requests an administrator role.', risk: 'Privilege elevation expands access.', remedy: 'Define a new mandate with the necessary role.', continuation: 'Grant admin to the session.', desktopApproval: true }
  })
  assert.equal(canApproveBlocker(privilege.blocker), false)
})

test('aprovação no Desktop retoma somente a sessão VS Code que devolveu o bloqueio', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-desktop-approval-'))
  try {
    const store = new Store(dir); await store.load()
    const origin = store.get(await store.create(dir)); const target = store.get(await store.create(dir, 'external'))
    const session = { sessionId: 'executor', cwd: dir, name: 'project', pid: 1, address: 'uds:executor' }
    target.sessionId = session.sessionId
    const request = {
      id: 'blocked-request', text: 'Conferir o relatório.', at: new Date().toISOString(), status: 'blocked' as const,
      originConversationId: origin.id, deliveryConversationId: target.id, targetSessionId: session.sessionId, targetName: session.name,
      supervision: { objective: 'Conferir o relatório.', executionBrief: 'Conferir o relatório.', retries: 0, state: 'settled' as const, review: {
        action: 'decision' as const, message: 'O classificador pediu confirmação.', instruction: null, withinScope: true, needsOwner: true,
        blocker: { kind: 'security' as const, title: 'Segurança · leitura limitada', cause: 'Confirmação do classificador.', risk: 'A leitura não começa sem mandato.', remedy: 'Executar apenas a leitura.', continuation: 'Execute somente a leitura já prevista e confira o resultado.', desktopApproval: true, resolution: 'pending' as const }
      } }
    }
    target.editorRequests = [request]
    const relays: string[] = []
    const coordinator = new Coordinator(store, () => {}, { sessions: async () => [session], relay: async (_session, text) => { relays.push(text) }, open: async () => target.id, local: async () => { throw new Error('Não criar subagente local.') }, context: async () => 'Omni', executable: async () => 'test.exe' })
    await coordinator.resolveEditorBlock(request.id, true)
    assert.equal(request.supervision.blocker?.resolution, 'approved')
    assert.equal(target.editorRequests?.length, 2)
    assert.equal(target.editorRequests?.[1]?.targetSessionId, session.sessionId)
    assert.equal(target.editorRequests?.[1]?.followupOf, request.id)
    await until(() => relays.length === 1)
    assert.match(relays[0]!, /Execute somente a leitura já prevista/)
  } finally { await rm(dir, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
})
