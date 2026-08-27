import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { lerPersonalidadeAtiva } from '../runtime/personalidade.mjs'

test('manifesto e núcleo formam uma identidade única', async () => {
  const persona = await lerPersonalidadeAtiva()
  assert.equal(persona.manifest.id, 'omni-persona-v1-candidate')
  assert.match(persona.nucleus, /PERSONALIDADE omni-persona-v1-candidate\./)
  assert.match(persona.nucleus, /personalidade não é enfeite/i)
  assert.match(persona.nucleus, /intensidade padrão ALTA/i)
  assert.match(persona.nucleus, /analogias são ferramenta central/i)
  assert.doesNotMatch(persona.nucleus, /no máximo uma/i)
  assert.doesNotMatch(persona.nucleus, /humor é zero/i)
})

test('contrato não pode escapar do diretório de personalidade', async () => {
  const pluginRoot = await mkdtemp(join(tmpdir(), 'omni-persona-'))
  const directory = join(pluginRoot, 'contratos', 'personalidade')
  try {
    await mkdir(directory, { recursive: true })
    await writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'omni-persona-v9-candidate',
        contract: '../../../fora.md'
      }),
      'utf8'
    )
    await assert.rejects(
      lerPersonalidadeAtiva({ pluginRoot, useCache: false }),
      /saiu do diretório permitido/
    )
  } finally {
    await rm(pluginRoot, { recursive: true, force: true })
  }
})
