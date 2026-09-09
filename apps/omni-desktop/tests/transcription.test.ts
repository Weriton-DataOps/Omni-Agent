import { test } from 'node:test'
import assert from 'node:assert/strict'
import { correctTranscript, rejectTranscript, transcriptForUse, transcriptionConfidence } from '../src/shared/transcription'

test('corrige somente confusões conhecidas de nomes do Omni', () => {
  assert.equal(correctTranscript('Palomino, como vai?'), 'Fala Omni, como vai?')
  assert.equal(correctTranscript('Oi Amy, abre o overcor'), 'Oi Omni, abre o OverCore')
  assert.equal(correctTranscript('o homem chegou'), 'o homem chegou')
})

test('descarta resíduos conhecidos de silêncio e alfabetos improváveis', () => {
  assert.match(rejectTranscript('Obrigado por assistir!') ?? '', /silêncio/)
  assert.match(rejectTranscript('안녕') ?? '', /alfabeto/)
  assert.equal(rejectTranscript('Abra o projeto Hub'), null)
})

test('confiança do Realtime descarta tokens fracos quando a API os fornece', () => {
  assert.equal(transcriptionConfidence([{ logprob: Math.log(.9) }, { logprob: Math.log(.82) }]).accepted, true)
  assert.equal(transcriptionConfidence([{ logprob: Math.log(.01) }, { logprob: Math.log(.01) }]).accepted, false)
  assert.equal(transcriptionConfidence([]).accepted, true)
  assert.deepEqual(transcriptForUse('homem, abra o overcor'), { text: 'Omni, abra o OverCore', reason: null })
})
