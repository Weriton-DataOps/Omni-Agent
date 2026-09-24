import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resultId } from '../src/main/ipc-identifiers'
const session = '7820293f-a250-448c-b336-a2c7ee59bd70'
const evidence = '3b082f0f-f197-4da7-bab2-60ba7a86c623'
test('IPC aceita identificadores emitidos para pedidos e respostas diretas do VS Code', () => {
  assert.equal(resultId(session), session)
  const direct = `editor-response:${session}:${evidence}`
  assert.equal(resultId(direct), direct)
})
test('IPC não alarga retorno para caminhos, prefixos arbitrários ou IDs truncados', () => {
  for (const input of [null, 1, {}, '', '../arquivo', `other:${session}:${evidence}`, `editor-response:${session}`, `editor-response:${session}:${evidence}:extra`, '------------------------------------', ` ${session}`, session + '\n']) assert.throws(() => resultId(input), /inválido/)
})
