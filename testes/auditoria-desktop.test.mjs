import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { achadosDesktop, auditarDesktop } from '../runtime/auditoria-desktop.mjs'
import { lerCicloOperacional } from '../runtime/ciclo-operacional.mjs'
import { criarAchadoOperacionalSanitizado } from '../runtime/sincronizacao-aprendizado-operacional.mjs'

test('auditoria do Desktop registra achados deduplicados e ledger sem dados privados', async () => {
  const casa = await mkdtemp(join(tmpdir(), 'omni-audit-desktop-'))
  try {
    const conversations = [{ id: 'private-id', messages: [{ text: 'SEGREDO-TESTE' }], coordinationTurns: [{ id: 'turn', state: 'done', attachments: [{ id: 'private-image' }] }], editorRequests: [{ id: 'turn', summaryError: 'C:\\privado\\SEGREDO-TESTE', status: 'uncertain' }], editorReturn: { id: 'return', objective: '<task-notification>SEGREDO-TESTE</task-notification>' } }]
    assert.equal(achadosDesktop(conversations).length, 3)
    assert.doesNotMatch(JSON.stringify(achadosDesktop(conversations)), /SEGREDO-TESTE|private-id|private-image|privado/)
    await mkdir(join(casa, 'desktop')); await writeFile(join(casa, 'desktop', 'conversations.json'), JSON.stringify({ version: 1, conversations }))
    assert.equal((await auditarDesktop(casa)).recorded, 3)
    assert.equal((await auditarDesktop(casa)).recorded, 0)
    const cycle = await lerCicloOperacional(casa)
    assert.equal(cycle.improvementCandidates.length, 3)
    for (const candidate of cycle.improvementCandidates) {
      assert.equal(candidate.occurrences, 1)
      assert.doesNotMatch(JSON.stringify(criarAchadoOperacionalSanitizado(candidate)), /SEGREDO-TESTE|private-id|privado/)
    }
  } finally { await rm(casa, { recursive: true, maxRetries: 8, retryDelay: 25 }) }
})
