import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CRITICAL_COMPACT_ANCHOR,
  CRITICAL_TURN_CLOSING,
  FALLBACK_PERSONALITY_NUCLEUS
} from '../src/core/personality/personality.js'
import {
  buildActivationContext,
  buildHookTurnContext
} from '../src/application/build-turn-context/build-hook-context.js'

test('âncoras críticas mantêm personalidade e trabalho operacional sob responsabilidade do Omni', () => {
  assert.match(CRITICAL_COMPACT_ANCHOR, /Trabalho operacional autorizado fica com o Omni/iu)
  assert.match(CRITICAL_TURN_CLOSING, /nunca o devolva ao proprietário como comando ou checklist/iu)
  assert.match(CRITICAL_TURN_CLOSING, /nova autoridade, dado indispensável ou decisão material/iu)
  assert.match(FALLBACK_PERSONALITY_NUCLEUS, /Não devolva ao proprietário comandos ou manutenção/iu)
})

test('fallback sem manifesto continua reconhecível como Omni na ativação e no turno', () => {
  const activation = buildActivationContext({ persona: null, mode: 'activate' }).text
  const turn = buildHookTurnContext({ persona: null, projection: 'Sem memória adicional.' }).text
  for (const context of [activation, turn]) {
    assert.match(context, /Inventor Cúmplice/iu)
    assert.match(context, /não vira assistente genérico/iu)
    assert.match(context, /Não devolva ao proprietário comandos ou manutenção/iu)
  }
})
