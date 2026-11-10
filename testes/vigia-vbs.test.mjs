// Os lançadores da versão instalada (F2, plano 5b-2) não podem ter caminho de usuário nem de Node chumbado:
// a mesma versão roda em versoes\<sha> de qualquer máquina. O vigia-servico.vbs acha o .mjs ao lado dele e
// o node pelo OMNI_NODE ou pelo PATH.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

const RAIZ = resolve(import.meta.dirname, '..')
const LANCADORES = [
  'servicos/whatsapp/omni/vigia-servico.vbs',
  'servicos/whatsapp/omni/iniciar.ps1',
  'apps/omni-ilha/iniciar.ps1',
  'scripts/omni-instalar.ps1'
]

test('nenhum lançador da versão tem caminho de usuário ou de Node chumbado', () => {
  for (const arquivo of LANCADORES) {
    const texto = readFileSync(join(RAIZ, arquivo), 'utf8')
    for (const proibido of [/[A-Z]:\\Users\\/i, /Documents\\Omni/i, /Program Files\\nodejs/i]) {
      assert.doesNotMatch(texto, proibido, `${arquivo} tem ${proibido}`)
    }
  }
})

// Cópia do .vbs numa pasta com um vigia-servico.mjs falso ao lado: ele anota quem o chamou.
function rodarVbs(t, env) {
  const pasta = mkdtempSync(join(tmpdir(), 'omni-vigia-vbs-'))
  t.after(() => rmSync(pasta, { recursive: true, force: true }))
  copyFileSync(join(RAIZ, 'servicos/whatsapp/omni/vigia-servico.vbs'), join(pasta, 'vigia-servico.vbs'))
  writeFileSync(join(pasta, 'vigia-servico.mjs'),
    "import { writeFileSync } from 'node:fs'\nwriteFileSync(new URL('./chamado.json', import.meta.url), JSON.stringify({ node: process.execPath, script: process.argv[1] }))\n")
  const r = spawnSync('wscript.exe', ['//B', '//Nologo', join(pasta, 'vigia-servico.vbs')], { env, timeout: 30_000 })
  assert.equal(r.status, 0)
  const marca = join(pasta, 'chamado.json')
  const ate = Date.now() + 20_000
  while (!existsSync(marca) && Date.now() < ate) spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 200)'])
  assert.ok(existsSync(marca), 'o .vbs não chamou o vigia-servico.mjs ao lado dele')
  return { pasta, chamado: JSON.parse(readFileSync(marca, 'utf8')) }
}

test('o .vbs chama o vigia-servico.mjs da própria pasta com o node do OMNI_NODE', { skip: process.platform !== 'win32' }, (t) => {
  // Sem node no PATH: só o OMNI_NODE leva ao node, então um .vbs que o ignorasse não chamaria nada.
  const env = { ...process.env, OMNI_NODE: process.execPath, PATH: `${process.env.SystemRoot}\\System32` }
  delete env.Path
  const { pasta, chamado } = rodarVbs(t, env)
  assert.equal(chamado.node.toLowerCase(), process.execPath.toLowerCase())
  assert.equal(dirname(chamado.script).toLowerCase(), pasta.toLowerCase())
})

test('sem OMNI_NODE o .vbs usa o node do PATH', { skip: process.platform !== 'win32' }, (t) => {
  const env = { ...process.env, PATH: `${dirname(process.execPath)};${process.env.SystemRoot}\\System32` }
  delete env.OMNI_NODE
  delete env.Path
  const { chamado } = rodarVbs(t, env)
  assert.equal(chamado.node.toLowerCase(), process.execPath.toLowerCase())
})
