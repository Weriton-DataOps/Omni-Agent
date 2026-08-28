import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { lerPersonalidadeAtiva } from '../runtime/personalidade.mjs'

test('manifesto e núcleo formam uma identidade única', async () => {
  const persona = await lerPersonalidadeAtiva()
  assert.equal(persona.manifest.id, 'omni-persona-v3-candidate')
  assert.match(persona.nucleus, /PERSONALIDADE omni-persona-v3-candidate\./)
  assert.match(persona.nucleus, /Motor Rick/i)
  assert.match(persona.nucleus, /torre de Jenga/i)
  assert.match(persona.nucleus, /gênio bêbado.*não um bêbado gritando/is)
  assert.match(persona.textAdapter, /CANAL: conversa escrita/i)
  assert.match(persona.textAdapter, /Entregue evidência e resultado/i)
  assert.doesNotMatch(persona.nucleus, /no máximo uma/i)
  assert.doesNotMatch(persona.nucleus, /humor é zero/i)
})

test('loader expõe adaptador textual e âncora de continuidade quando declarados', async () => {
  const pluginRoot = await mkdtemp(join(tmpdir(), 'omni-persona-blocos-'))
  const directory = join(pluginRoot, 'contratos', 'personalidade')
  try {
    await mkdir(directory, { recursive: true })
    await writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'omni-persona-v9-candidate',
        status: 'active-candidate-pending-evals',
        contract: './persona.md',
        promotion: null
      }),
      'utf8'
    )
    await writeFile(
      join(directory, 'persona.md'),
      [
        '## Núcleo textual',
        '```text',
        'PERSONALIDADE omni-persona-v9-candidate.',
        'Núcleo de teste.',
        '```',
        '',
        '### Adaptador textual v1',
        '```text',
        'CANAL: conversa escrita de teste.',
        '```',
        '',
        '## Âncora de continuidade',
        '```text',
        'Retome a voz de teste sem repetir o núcleo.',
        '```'
      ].join('\n'),
      'utf8'
    )

    const persona = await lerPersonalidadeAtiva({ pluginRoot, useCache: false })
    assert.equal(persona.textAdapter, 'CANAL: conversa escrita de teste.')
    assert.equal(persona.continuityAnchor, 'Retome a voz de teste sem repetir o núcleo.')
  } finally {
    await rm(pluginRoot, { recursive: true, force: true })
  }
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
