import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const file = (path) => new URL(path, root)

test('marketplace usa o plugin do próprio repositório e versão semântica', async () => {
  const marketplace = JSON.parse(await readFile(file('.claude-plugin/marketplace.json'), 'utf8'))
  const manifest = JSON.parse(await readFile(file('.claude-plugin/plugin.json'), 'utf8'))
  assert.equal(marketplace.plugins[0].source, './')
  assert.equal(manifest.name, 'omni')
  assert.equal(manifest.version, '0.5.1')
})

test('runtime, schema e manifesto concordam sobre as versões', async () => {
  const schema = JSON.parse(await readFile(file('contratos/memoria/schema.json'), 'utf8'))
  const migrations = JSON.parse(await readFile(file('contratos/memoria/migrations.json'), 'utf8'))
  assert.equal(schema.properties.schemaVersion.const, 3)
  assert.equal(migrations.currentSchemaVersion, 3)
  assert.deepEqual(
    migrations.migrations.map((migration) => [migration.from, migration.to]),
    [[1, 2], [2, 3]]
  )
})

test('plugin contém somente o núcleo declarado', async () => {
  await assert.rejects(stat(file('app')), { code: 'ENOENT' })
  await assert.rejects(stat(file('cerebro')), { code: 'ENOENT' })
  await assert.rejects(stat(file('plugin')), { code: 'ENOENT' })
  await assert.rejects(stat(file('.claude')), { code: 'ENOENT' })
  await assert.rejects(stat(file('memory')), { code: 'ENOENT' })
  await stat(file('runtime/cli.mjs'))
  await stat(file('runtime/hook-contexto.mjs'))
  await stat(file('runtime/pipeline-memoria.mjs'))
  await stat(file('runtime/versao.mjs'))
  await stat(file('hooks/hooks.json'))
  await stat(file('contratos/personalidade/omni-persona-v1.md'))
})

test('hook injeta contexto por turno somente após ativação do Omni', async () => {
  const hooks = JSON.parse(await readFile(file('hooks/hooks.json'), 'utf8'))
  assert.ok(hooks.hooks.UserPromptSubmit)
  assert.ok(hooks.hooks.UserPromptExpansion)
  assert.ok(hooks.hooks.SessionEnd)
  const command = hooks.hooks.UserPromptSubmit[0].hooks[0]
  assert.equal(command.type, 'command')
  assert.equal(command.command, 'node')
  assert.deepEqual(command.args, ['${CLAUDE_PLUGIN_ROOT}/runtime/hook-contexto.mjs'])
})

test('personalidade v1 é a fonte aprovada e canais externos continuam planejados', async () => {
  const persona = JSON.parse(await readFile(file('contratos/personalidade/manifest.json'), 'utf8'))
  const contract = await readFile(file('contratos/personalidade/omni-persona-v1.md'), 'utf8')
  assert.equal(persona.id, 'omni-persona-v1-candidate')
  assert.equal(persona.channels.plugin, 'active')
  assert.equal(persona.channels.chat, 'planned')
  assert.equal(persona.channels.realtime, 'planned')
  assert.match(contract, /Inventor Cúmplice/)
  assert.match(contract, /INDEPENDÊNCIA INTELECTUAL/)
})

test('contexto ativo não carrega nomes ou caminhos estranhos ao Omni', async () => {
  const activeFiles = [
    'skills/omni/SKILL.md',
    'runtime/cli.mjs',
    'runtime/contexto.mjs',
    'runtime/hook-contexto.mjs',
    'runtime/pipeline-memoria.mjs',
    'runtime/versao.mjs',
    'runtime/memoria.mjs',
    'contratos/capacidades/catalogo.json',
    'contratos/personalidade/omni-persona-v1.md'
  ]
  const active = (
    await Promise.all(activeFiles.map((path) => readFile(file(path), 'utf8')))
  ).join('\n').toLowerCase()
  const forbidden = [
    ['over', 'core'].join(''),
    ['ora', 'cle'].join(''),
    ['over', 'core', ' studio'].join(''),
    ['omni', '-pessoal'].join('')
  ]
  for (const name of forbidden) assert.equal(active.includes(name), false, `referência ativa indevida: ${name}`)
})

test('skill começa em pt-BR e não despeja diagnóstico quando chamada vazia', async () => {
  const skill = await readFile(file('skills/omni/SKILL.md'), 'utf8')
  assert.match(skill, /Toda saída visível deve estar em português do Brasil desde a primeira linha/)
  assert.match(skill, /execute `estado` uma única vez e silenciosamente/)
  assert.match(skill, /`outdated`, avise em uma frase/)
  assert.match(skill, /não apresente\s+diagnóstico técnico sem que seja pedido/is)
})
