import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  caminhoDoFeedbackPersonalidade,
  classificarFeedbackPersonalidade,
  lerFeedbackPersonalidade,
  observarVotoPersonalidade,
  registrarUltimaRespostaPersonalidade,
  resumirFeedbackPersonalidade
} from '../runtime/feedback-personalidade.mjs'
import { observarParada, observarPrompt } from '../runtime/observador.mjs'

const IDENTITY = {
  personaId: 'omni-persona-v3-candidate',
  releaseFingerprint: 'a'.repeat(64)
}

async function home() {
  return mkdtemp(join(tmpdir(), 'omni-personality-feedback-'))
}

async function response(casa, sessionId, answer = `Resposta da sessao ${sessionId}`) {
  return registrarUltimaRespostaPersonalidade(casa, {
    sessionId,
    answer,
    ...IDENTITY
  })
}

test('Stop local guarda somente fingerprints e identidade da release, nunca conversa bruta', async () => {
  const casa = await home()
  const sessionId = 'sessao-privada-que-nao-pode-vazar'
  const answer = 'RESPOSTA_BRUTA_NUNCA_PODE_APARECER_NO_ARQUIVO'
  try {
    const recorded = await response(casa, sessionId, answer)
    assert.equal(recorded.result, 'recorded')
    assert.match(recorded.response.sessionFingerprint, /^[a-f0-9]{64}$/)
    assert.match(recorded.response.turnFingerprint, /^[a-f0-9]{64}$/)
    assert.match(recorded.response.answerFingerprint, /^[a-f0-9]{64}$/)
    assert.equal(recorded.response.personaId, IDENTITY.personaId)
    assert.equal(recorded.response.releaseFingerprint, IDENTITY.releaseFingerprint)

    const raw = await readFile(caminhoDoFeedbackPersonalidade(casa), 'utf8')
    assert.equal(raw.includes(sessionId), false)
    assert.equal(raw.includes(answer), false)
    assert.equal(raw.includes('answer"'), false)
    assert.equal(raw.includes('prompt"'), false)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('classificador exige avaliacao explicita e separa positivo, negativo e misto', () => {
  assert.equal(classificarFeedbackPersonalidade('Quero entender o contrato de personalidade.'), null)
  assert.equal(classificarFeedbackPersonalidade('Use humor na proxima explicacao.'), null)
  assert.equal(classificarFeedbackPersonalidade('A personalidade e um conceito importante.'), null)
  assert.equal(classificarFeedbackPersonalidade('Quero uma resposta seca e sem humor para este comunicado.'), null)
  assert.equal(classificarFeedbackPersonalidade('Explique por que uma conversa generica pode falhar.'), null)
  assert.equal(classificarFeedbackPersonalidade('Use uma voz generica no exemplo de teste.'), null)
  assert.equal(classificarFeedbackPersonalidade('Nao diga que a resposta ficou seca no exemplo.'), null)

  const positive = classificarFeedbackPersonalidade(
    'Essa resposta ficou excelente; gostei do humor e a analogia funcionou.'
  )
  assert.equal(positive.polarity, 'positive')
  assert.ok(positive.reasonCodes.includes('overall-approved'))
  assert.ok(positive.reasonCodes.includes('humor-effective'))
  assert.ok(positive.reasonCodes.includes('analogy-effective'))

  const shortPositive = classificarFeedbackPersonalidade('Gostei da analogia; ela funcionou muito bem.')
  assert.equal(shortPositive.polarity, 'positive')
  assert.ok(shortPositive.reasonCodes.includes('analogy-effective'))

  const negative = classificarFeedbackPersonalidade(
    'A resposta ficou seca e generica; faltou humor e faltou analogia.'
  )
  assert.equal(negative.polarity, 'negative')
  assert.ok(negative.reasonCodes.includes('tone-too-dry'))
  assert.ok(negative.reasonCodes.includes('voice-generic'))
  assert.ok(negative.reasonCodes.includes('humor-missing'))
  assert.ok(negative.reasonCodes.includes('analogy-missing'))

  const negatedPraise = classificarFeedbackPersonalidade('A resposta nao ficou boa e precisa melhorar.')
  assert.equal(negatedPraise.polarity, 'negative')
  assert.equal(negatedPraise.reasonCodes.includes('overall-approved'), false)
  assert.ok(negatedPraise.reasonCodes.includes('overall-rejected'))

  const mixed = classificarFeedbackPersonalidade(
    'A resposta ficou excelente e o humor funcionou, mas faltou analogia.'
  )
  assert.equal(mixed.polarity, 'mixed')
  assert.ok(mixed.reasonCodes.includes('humor-effective'))
  assert.ok(mixed.reasonCodes.includes('analogy-missing'))

  const negated = classificarFeedbackPersonalidade(
    'Agora a resposta nao esta seca; esse tom ficou otimo.'
  )
  assert.equal(negated.polarity, 'positive')
  assert.equal(negated.reasonCodes.includes('tone-too-dry'), false)
  assert.ok(negated.reasonCodes.includes('tone-approved'))

  const coordinatedNegation = classificarFeedbackPersonalidade('A resposta nao ficou seca nem generica.')
  assert.equal(coordinatedNegation.polarity, 'positive')
  assert.equal(coordinatedNegation.reasonCodes.includes('overall-rejected'), false)
  assert.equal(coordinatedNegation.reasonCodes.includes('voice-generic'), false)
  assert.ok(coordinatedNegation.reasonCodes.includes('tone-approved'))
  assert.ok(coordinatedNegation.reasonCodes.includes('voice-distinct'))

  const praisedWithNegation = classificarFeedbackPersonalidade(
    'Essa resposta ficou boa e nao ficou fria nem generica.'
  )
  assert.equal(praisedWithNegation.polarity, 'positive')
  assert.equal(praisedWithNegation.reasonCodes.includes('overall-rejected'), false)
  assert.equal(praisedWithNegation.reasonCodes.includes('presence-too-cold'), false)
  assert.equal(praisedWithNegation.reasonCodes.includes('voice-generic'), false)
})

test('proximo prompt do proprietario vira voto ligado a ultima resposta e ajuste de um turno', async () => {
  const casa = await home()
  const feedback = 'Essa resposta ficou seca e generica; faltou humor e analogia.'
  try {
    await response(casa, 's-vote', 'conteudo confidencial da resposta')
    const observed = await observarVotoPersonalidade(casa, {
      sessionId: 's-vote',
      origin: 'owner-live',
      feedback
    })
    assert.equal(observed.result, 'recorded')
    assert.equal(observed.vote.polarity, 'negative')
    assert.match(observed.vote.turnFingerprint, /^[a-f0-9]{64}$/)
    assert.equal(observed.vote.turnFingerprint, observed.adjustment.turnFingerprint)
    assert.equal(observed.adjustment.scope, 'next-response')
    assert.equal(observed.adjustment.reversible, true)
    assert.equal(observed.adjustment.expiresAfterTurns, 1)
    assert.ok(observed.adjustment.directives.includes('increase-contextual-humor'))
    assert.ok(observed.adjustment.directives.includes('increase-useful-analogies'))
    assert.ok(observed.candidateSignals.length >= 4)
    assert.ok(observed.candidateSignals.every((item) => item.state === 'observing'))
    assert.ok(observed.candidateSignals.every((item) => /^[a-f0-9]{64}$/.test(item.voteFingerprint)))
    assert.equal(observed.counts.totalVotes, 1)

    const raw = await readFile(caminhoDoFeedbackPersonalidade(casa), 'utf8')
    assert.equal(raw.includes(feedback), false)
    assert.equal(raw.includes('conteudo confidencial da resposta'), false)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('frase neutra, origem externa e feedback sem resposta anterior nao fabricam voto', async () => {
  const casa = await home()
  try {
    await response(casa, 's-neutral')
    const neutral = await observarVotoPersonalidade(casa, {
      sessionId: 's-neutral', origin: 'owner-live', feedback: 'Vamos para a proxima tarefa.'
    })
    assert.equal(neutral.result, 'neutral')

    const external = await observarVotoPersonalidade(casa, {
      sessionId: 's-neutral', origin: 'system', feedback: 'A resposta ficou seca.'
    })
    assert.equal(external.result, 'ignored-origin')

    const unbound = await observarVotoPersonalidade(casa, {
      sessionId: 'outra-sessao', origin: 'owner-transcript', feedback: 'A resposta ficou excelente.'
    })
    assert.equal(unbound.result, 'unbound')
    assert.equal((await lerFeedbackPersonalidade(casa)).votes.length, 0)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('sinal repetido permanece candidata local revisavel e nao altera galeria', async () => {
  const casa = await home()
  try {
    for (const sessionId of ['s-repeat-1', 's-repeat-2']) {
      await response(casa, sessionId)
      await observarVotoPersonalidade(casa, {
        sessionId,
        origin: 'owner-live',
        feedback: 'A resposta ficou seca; faltou humor.'
      })
    }
    const summary = await resumirFeedbackPersonalidade(casa)
    const humor = summary.candidates.find((item) => item.reasonCode === 'humor-missing')
    assert.equal(humor.status, 'reviewable')
    assert.equal(humor.occurrences, 2)
    assert.equal(summary.counts.reviewableCandidates >= 2, true)
    assert.ok(summary.persistentAdjustment.directives.includes('increase-contextual-humor'))
    assert.ok(summary.persistentAdjustment.directives.includes('increase-tone-presence'))
    assert.deepEqual(await readdir(casa), ['feedback'])
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('dois comentarios sobre o mesmo turno nao fabricam recorrencia', async () => {
  const casa = await home()
  try {
    await response(casa, 's-same-turn')
    await observarVotoPersonalidade(casa, {
      sessionId: 's-same-turn',
      origin: 'owner-live',
      feedback: 'A resposta ficou seca.'
    })
    await observarVotoPersonalidade(casa, {
      sessionId: 's-same-turn',
      origin: 'owner-live',
      feedback: 'O tom ainda esta muito seco.'
    })
    let summary = await resumirFeedbackPersonalidade(casa)
    assert.equal(summary.counts.totalVotes, 2)
    assert.equal(summary.candidates.some((item) => item.reasonCode === 'tone-too-dry'), false)

    await response(casa, 's-second-turn')
    await observarVotoPersonalidade(casa, {
      sessionId: 's-second-turn',
      origin: 'owner-live',
      feedback: 'A resposta ficou seca.'
    })
    summary = await resumirFeedbackPersonalidade(casa)
    assert.equal(
      summary.candidates.find((item) => item.reasonCode === 'tone-too-dry').occurrences,
      2
    )
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('voto identico no mesmo turno e idempotente', async () => {
  const casa = await home()
  const input = {
    sessionId: 's-duplicate',
    origin: 'owner-live',
    feedback: 'A resposta ficou excelente.'
  }
  try {
    await response(casa, input.sessionId)
    const recorded = await observarVotoPersonalidade(casa, input)
    const duplicate = await observarVotoPersonalidade(casa, input)
    assert.equal(recorded.result, 'recorded')
    assert.equal(duplicate.result, 'duplicate')
    assert.deepEqual(duplicate.candidateSignals, recorded.candidateSignals)
    assert.equal((await lerFeedbackPersonalidade(casa)).votes.length, 1)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('direcao persistente exige recorrencia e muda com contraprova recorrente de polaridade oposta', async () => {
  const casa = await home()
  try {
    for (const sessionId of ['negative-1', 'negative-2']) {
      await response(casa, sessionId)
      await observarVotoPersonalidade(casa, {
        sessionId,
        origin: 'owner-live',
        feedback: 'A resposta ficou seca.'
      })
    }
    let summary = await resumirFeedbackPersonalidade(casa)
    assert.ok(summary.persistentAdjustment.directives.includes('change-overall-voice'))
    assert.ok(summary.persistentAdjustment.directives.includes('increase-tone-presence'))

    for (const sessionId of ['positive-1', 'positive-2']) {
      await response(casa, sessionId)
      await observarVotoPersonalidade(casa, {
        sessionId,
        origin: 'owner-live',
        feedback: 'Agora a resposta nao esta seca; esse tom ficou otimo.'
      })
    }
    summary = await resumirFeedbackPersonalidade(casa)
    assert.equal(summary.persistentAdjustment.directives.includes('change-overall-voice'), false)
    assert.equal(summary.persistentAdjustment.directives.includes('increase-tone-presence'), false)
    assert.ok(summary.persistentAdjustment.directives.includes('preserve-overall-voice'))
    assert.ok(summary.persistentAdjustment.directives.includes('preserve-tone'))
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('contraprova substitui somente a propria dimensao', async () => {
  const casa = await home()
  try {
    for (const sessionId of ['humor-negative-1', 'humor-negative-2']) {
      await response(casa, sessionId)
      await observarVotoPersonalidade(casa, {
        sessionId,
        origin: 'owner-live',
        feedback: 'Faltou humor nessa resposta.'
      })
    }
    for (const sessionId of ['analogy-positive-1', 'analogy-positive-2']) {
      await response(casa, sessionId)
      await observarVotoPersonalidade(casa, {
        sessionId,
        origin: 'owner-live',
        feedback: 'A analogia funcionou nessa resposta.'
      })
    }

    const summary = await resumirFeedbackPersonalidade(casa)
    assert.ok(summary.persistentAdjustment.directives.includes('increase-contextual-humor'))
    assert.ok(summary.persistentAdjustment.directives.includes('preserve-analogy-level'))
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('escrita concorrente e atomica e retencao limita respostas por sessao', async () => {
  const casa = await home()
  try {
    await Promise.all(Array.from({ length: 12 }, (_, index) => response(casa, `parallel-${index}`)))
    for (let index = 0; index < 100; index += 1) await response(casa, `retention-${index}`)
    const store = await lerFeedbackPersonalidade(casa)
    assert.equal(store.lastResponses.length, 100)
    assert.equal(store.retention.evictedLastResponses, 12)
    assert.equal(store.retention.evictedVotes, 0)
    assert.equal(new Set(store.lastResponses.map((item) => item.sessionFingerprint)).size, 100)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('schema futuro falha fechado sem sobrescrever o arquivo', async () => {
  const casa = await home()
  const path = caminhoDoFeedbackPersonalidade(casa)
  const future = '{"schemaVersion":2,"conversation":"nao tocar"}\n'
  try {
    await mkdir(join(casa, 'feedback'), { recursive: true })
    await writeFile(path, future, 'utf8')
    await assert.rejects(() => lerFeedbackPersonalidade(casa), /mais novo que este plugin/)
    await assert.rejects(() => response(casa, 'future'), /mais novo que este plugin/)
    const promptObserved = await observarPrompt(casa, {
      session_id: 'future-observer',
      origin: 'owner-live',
      prompt: 'Essa resposta ficou seca e genérica.'
    })
    assert.equal(promptObserved.personalityFeedback.result, 'failed')
    const stopObserved = await observarParada(casa, {
      hook_event_name: 'Stop',
      session_id: 'future-observer',
      last_assistant_message: 'Resposta que continua mesmo com o store incompatível.'
    })
    assert.equal(stopObserved.personalityResponse.result, 'failed')
    assert.equal(await readFile(path, 'utf8'), future)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('lock antigo nunca e roubado nem removido por outro escritor', async () => {
  const casa = await home()
  const lockPath = join(casa, 'feedback', 'personality-feedback.lock')
  try {
    await mkdir(join(casa, 'feedback'), { recursive: true })
    await writeFile(lockPath, 'writer-original\n', 'utf8')
    const old = new Date(Date.now() - 60_000)
    await utimes(lockPath, old, old)
    await assert.rejects(() => response(casa, 'locked-session'), /ocupado por outra escrita/)
    assert.equal(await readFile(lockPath, 'utf8'), 'writer-original\n')
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('observador integra Stop e prompt sem expor texto bruto', async () => {
  const casa = await home()
  try {
    const stopped = await observarParada(casa, {
      hook_event_name: 'Stop',
      session_id: 's-observer-integration',
      last_assistant_message: 'Resposta viva que nao deve ficar gravada.'
    })
    assert.equal(stopped.personalityResponse.result, 'recorded')

    const prompted = await observarPrompt(casa, {
      session_id: 's-observer-integration',
      origin: 'owner-live',
      prompt: 'Essa resposta ficou excelente e o humor funcionou.'
    })
    assert.equal(prompted.personalityFeedback.result, 'recorded')
    assert.equal(prompted.personalityFeedback.vote.polarity, 'positive')

    const responsesBeforeFailure = (await lerFeedbackPersonalidade(casa)).lastResponses.length
    const failedStop = await observarParada(casa, {
      hook_event_name: 'StopFailure',
      session_id: 's-failed-stop',
      last_assistant_message: 'parcial'
    })
    assert.equal(failedStop.personalityResponse.result, 'ignored')
    assert.equal((await lerFeedbackPersonalidade(casa)).lastResponses.length, responsesBeforeFailure)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('falha do observador operacional não engole o voto nem o ajuste do proprietário', async () => {
  const casa = await home()
  try {
    await response(casa, 's-observer-degraded', 'Resposta anterior sem a voz esperada.')
    await writeFile(join(casa, 'runs'), 'arquivo bloqueando o store operacional', 'utf8')

    const observed = await observarPrompt(casa, {
      session_id: 's-observer-degraded',
      origin: 'owner-live',
      prompt: 'Essa resposta ficou seca e genérica; faltou humor e analogia.'
    })
    assert.equal(observed.personalityFeedback.result, 'recorded')
    assert.equal(observed.personalityFeedback.adjustment.scope, 'next-response')
    assert.equal(observed.observationFailure.result, 'failed')
    assert.equal((await lerFeedbackPersonalidade(casa)).votes.length, 1)
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})
