import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Dictation } from '../src/renderer/dictation'
import { transcribeAudio } from '../src/main/runtime'
import type { DesktopApi } from '../src/shared/contracts'

test('broker rejeita payload inválido antes de abrir processo ou acessar credencial', async () => {
  for (const value of [null, 'secret', new ArrayBuffer(10), new ArrayBuffer(33), new ArrayBuffer(4 * 1024 * 1024 + 1)]) {
    await assert.rejects(transcribeAudio(value), /[Áá]udio|Formato/)
  }
})

test('soltar durante abertura do microfone descarta captura atrasada', async () => {
  let release!: (s: MediaStream) => void
  let stopped = 0, sent = 0
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: () => new Promise<MediaStream>(r => { release = r }) } } })
  try {
    const dictation = new Dictation({ transcribe: async () => { sent++; return 'texto' } } as DesktopApi, () => {}, () => { sent++ })
    const opening = dictation.start()
    assert.equal(dictation.active, true)
    dictation.finish()
    release({ getTracks: () => [{ stop: () => { stopped++ } }] } as unknown as MediaStream)
    await opening
    assert.equal(stopped, 1); assert.equal(sent, 0); assert.equal(dictation.active, false)
  } finally { if (original) Object.defineProperty(globalThis, 'navigator', original) }
})

test('permissão negada libera estado para nova tentativa', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => { throw new Error('denied') } } } })
  try {
    const statuses: string[] = []
    const dictation = new Dictation({} as DesktopApi, s => statuses.push(s), () => assert.fail('Não deve haver texto'))
    await dictation.start(); assert.equal(dictation.active, false)
    assert.equal(statuses.at(-1), 'Microfone indisponível.')
    await dictation.start(); assert.equal(dictation.active, false)
  } finally { if (original) Object.defineProperty(globalThis, 'navigator', original) }
})
