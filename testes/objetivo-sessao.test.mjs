import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { observarPrompt } from '../runtime/observador.mjs'
import { lerCicloOperacional } from '../runtime/ciclo-operacional.mjs'

const home = () => mkdtemp(join(tmpdir(), 'omni-objetivo-sessao-'))

async function objetivoDaSessao(casa, sessionId) {
  const cycle = await lerCicloOperacional(casa)
  return cycle.sessions.find((s) => s.sessionFingerprint)?.objective ?? null
}

async function prompt(casa, sessionId, text) {
  await observarPrompt(casa, { session_id: sessionId, prompt: text, cwd: 'C:\\repo', origin: 'owner-live' })
}

test('primeiro pedido real da sessao vira objetivo', async () => {
  const casa = await home()
  const sessionId = 'sessao-pedido-comum'
  try {
    await prompt(casa, sessionId, 'preciso encontrar a senha do superuser do postgres')
    assert.match(await objetivoDaSessao(casa, sessionId), /senha do superuser do postgres/)
  } finally { await rm(casa, { recursive: true, force: true }) }
})

test('aceite curto nao vira objetivo nem sobrescreve o primeiro pedido', async () => {
  const casa = await home()
  const sessionId = 'sessao-aceite'
  try {
    await prompt(casa, sessionId, 'faca uma leitura do projeto do omni desktop e proponha a agenda')
    await prompt(casa, sessionId, 'pode fazer')
    await prompt(casa, sessionId, 'ok')
    const objetivo = await objetivoDaSessao(casa, sessionId)
    assert.match(objetivo, /leitura do projeto do omni desktop/)
    assert.doesNotMatch(objetivo, /pode fazer|^ok/i)
  } finally { await rm(casa, { recursive: true, force: true }) }
})

test('objetivo declarado explicitamente manda por cima do primeiro pedido', async () => {
  const casa = await home()
  const sessionId = 'sessao-declarado'
  try {
    await prompt(casa, sessionId, 'me ajuda a organizar as tarefas de hoje')
    await prompt(casa, sessionId, 'na verdade meu objetivo e lancar o painel Agora do Omni ate sexta')
    assert.match(await objetivoDaSessao(casa, sessionId), /lancar o painel Agora do Omni/)
  } finally { await rm(casa, { recursive: true, force: true }) }
})

test('sessao so com aceite curto nao inventa objetivo a partir do ack', async () => {
  const casa = await home()
  const sessionId = 'sessao-so-ack'
  try {
    await prompt(casa, sessionId, 'ok')
    assert.equal(await objetivoDaSessao(casa, sessionId), null)
  } finally { await rm(casa, { recursive: true, force: true }) }
})
