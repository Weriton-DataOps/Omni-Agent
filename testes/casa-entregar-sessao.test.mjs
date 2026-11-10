// Entrega à sessão (F2, plano 4a, T6): um `claude -p` de vida curta lê o pedido gravado e manda pelo
// SendMessage para a sessão escolhida. Aqui o claude é falso, mas o spawn, o stdin, o ambiente e o prazo
// são os de verdade.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { entregar } from '../runtime/casa/entregar-sessao.mjs'

const FALSO = fileURLToPath(new URL('./fixtures/claude-falso.mjs', import.meta.url))

function preparar(t, modo) {
  const pasta = mkdtempSync(join(tmpdir(), 'omni-entrega-'))
  t.after(() => rmSync(pasta, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }))
  const registro = join(pasta, 'registro.json')
  const chamadas = []
  const opcoes = {
    claude: 'claude.exe',
    pastaPedidos: pasta,
    env: { ...process.env, CLAUDE_FALSO_MODO: modo, CLAUDE_FALSO_REGISTRO: registro, ELECTRON_RUN_AS_NODE: '1' },
    iniciar: (comando, args, extra) => { chamadas.push({ comando, args, extra }); return spawn(process.execPath, [FALSO, ...args], extra) }
  }
  return { pasta, opcoes, chamadas, visto: () => JSON.parse(readFileSync(registro, 'utf8')) }
}

test('ENVIADO é sucesso; a ordem cita o arquivo e o nome; o filho não herda ELECTRON_RUN_AS_NODE', async (t) => {
  const { pasta, opcoes, chamadas, visto } = preparar(t, 'enviado')
  const arquivo = join(pasta, '20261109-120000-abcd.md')
  assert.deepEqual(await entregar('omni-a0', arquivo, opcoes), { ok: true })
  const v = visto()
  assert.ok(v.ordem.includes(arquivo), 'a ordem cita o arquivo do pedido')
  assert.ok(v.ordem.includes('"omni-a0"'), 'a ordem cita a sessão')
  assert.match(v.ordem, /ENVIADO/)
  assert.equal(v.electron, false)
  assert.equal(chamadas[0].comando, 'claude.exe')
  assert.deepEqual(chamadas[0].args, ['-p', '--output-format', 'json', '--allowedTools', 'Read', 'SendMessage', 'ListAgents', '--add-dir', pasta])
  assert.equal(chamadas[0].extra.windowsHide, true)
  assert.equal(opcoes.env.ELECTRON_RUN_AS_NODE, '1', 'o ambiente de quem chamou fica intacto')
})

test('FALHOU, saída vazia e erro do claude viram motivo', async (t) => {
  const falhou = preparar(t, 'falhou')
  assert.deepEqual(await entregar('x', join(falhou.pasta, 'p.md'), falhou.opcoes), { ok: false, motivo: 'FALHOU: a sessão não existe' })
  const misto = preparar(t, 'misto')
  assert.deepEqual(await entregar('x', join(misto.pasta, 'p.md'), misto.opcoes), { ok: false, motivo: 'Não foi ENVIADO. FALHOU: o SendMessage recusou' }, 'ENVIADO com FALHOU não é sucesso')
  const vazio = preparar(t, 'vazio')
  assert.deepEqual(await entregar('x', join(vazio.pasta, 'p.md'), vazio.opcoes), { ok: false, motivo: 'saída vazia da entrega' })
  const erro = preparar(t, 'erro')
  assert.deepEqual(await entregar('x', join(erro.pasta, 'p.md'), erro.opcoes), { ok: false, motivo: 'claude: credencial expirada' })
})

test('claude que não existe vira motivo, sem exceção', async (t) => {
  const { pasta, opcoes } = preparar(t, 'enviado')
  const r = await entregar('x', join(pasta, 'p.md'), { ...opcoes, iniciar: spawn, claude: join(pasta, 'nao-existe.exe') })
  assert.equal(r.ok, false)
  assert.match(r.motivo, /ENOENT/)
})

test('passou do prazo: mata a árvore e diz quanto esperou', async (t) => {
  const { pasta, opcoes } = preparar(t, 'dorme')
  let filho
  const iniciar = (...args) => { filho = opcoes.iniciar(...args); return filho }
  const inicio = Date.now()
  const r = await entregar('x', join(pasta, 'p.md'), { ...opcoes, iniciar, limiteMs: 300 })
  assert.deepEqual(r, { ok: false, motivo: 'a entrega passou de 300 ms' })
  // O falso dorme 60 s: se fechar em poucos segundos, foi a morte da árvore, não o fim natural.
  const morreu = await new Promise((resolver) => {
    if (filho.exitCode !== null || filho.signalCode !== null) return resolver(true)
    const espera = setTimeout(() => resolver(false), 5000)
    filho.on('close', () => { clearTimeout(espera); resolver(true) })
  })
  assert.equal(morreu, true, 'o filho morreu pelo prazo')
  assert.ok(Date.now() - inicio < 6000)
})
