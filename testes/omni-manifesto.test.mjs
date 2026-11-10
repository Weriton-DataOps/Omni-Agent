// O manifesto do próprio Omni (F2, plano 5b-1): é por ele que o instalar registra o Omni no núcleo.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { lerManifesto, validarManifesto } from '../runtime/casa/loja-nucleo.mjs'

const RAIZ = resolve(import.meta.dirname, '..')

test('o executor/agente.json do Omni passa na validação do núcleo', () => {
  const { manifesto } = validarManifesto(lerManifesto(RAIZ))
  assert.equal(manifesto.agente, 'omni')
  assert.equal(manifesto.banco, 'omni.db')
  assert.equal(manifesto.executor.comando, 'node runtime/executor.mjs')
  assert.deepEqual(manifesto.executor.modos, ['instalar', 'importar', 'exportar', 'verificar'])
  assert.equal(manifesto.executor.modos.includes('servir'), false, 'o Omni não se supervisiona')
})

test('a versão do manifesto acompanha a do package.json', () => {
  const pacote = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8'))
  assert.equal(validarManifesto(lerManifesto(RAIZ)).manifesto.versao, pacote.version)
})
