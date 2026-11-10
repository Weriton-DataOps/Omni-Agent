// Plano 4c, T5: o pareador da ilha roda parear.mjs em três passos (pessoal → bot → fechar), um processo por
// vez, pausa depois de cada passo bem-sucedido até a janela pedir o seguinte e só repassa à janela os
// eventos e campos de uma lista fechada. O processo-filho é falso: nenhum teste roda o parear.mjs de verdade.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

const require = createRequire(import.meta.url)
const { criarPareador } = require('../apps/omni-ilha/pareamento-ilha.js')

const QR = 'data:image/png;base64,iVBORw0KGgo='
const tique = () => new Promise((ok) => setTimeout(ok, 5))

function montar(extra = {}) {
  const chamadas = []
  const enviados = []
  const gerar = (node, args, opcoes) => {
    const p = new EventEmitter()
    p.stdout = new PassThrough()
    p.stdin = new PassThrough()
    p.entrada = ''
    p.stdin.on('data', (d) => { p.entrada += d })
    p.mortes = 0
    p.kill = () => { p.mortes += 1; setImmediate(() => p.emit('close', null)) }
    chamadas.push({ node, args, opcoes, p })
    return p
  }
  const pareador = criarPareador({ gerar, node: 'C:\\node\\node.exe', script: 'C:\\omni\\parear.mjs', env: { PATH: 'x', OMNI_API_TOKEN: 'segredo-da-casa' }, enviar: (e) => enviados.push(e), ...extra })
  return { pareador, chamadas, enviados }
}
async function linhas(p, ...objs) {
  for (const o of objs) p.stdout.write(typeof o === 'string' ? o + '\n' : JSON.stringify(o) + '\n')
  await tique()
}
async function sair(p, codigo = 0) {
  p.stdout.end()
  await tique()
  p.emit('close', codigo)
  await tique()
}
const papelDe = (c) => c.args[c.args.indexOf('--papel') + 1]

test('roda pessoal, bot e fechar em ordem, sempre com --json, esperando o continuar() entre eles', async () => {
  const { pareador, chamadas, enviados } = montar()
  assert.equal(pareador.iniciar(), true)
  assert.equal(chamadas.length, 1)
  assert.equal(papelDe(chamadas[0]), 'pessoal')
  await linhas(chamadas[0].p, { evento: 'fim', papel: 'pessoal', ok: true })
  await sair(chamadas[0].p)
  assert.equal(chamadas.length, 1, 'o bot só roda com o continuar()')
  assert.equal(pareador.estado().proximo, 'bot')
  assert.equal(pareador.continuar(), true)
  assert.equal(papelDe(chamadas[1]), 'bot')
  await linhas(chamadas[1].p, { evento: 'fim', papel: 'bot', ok: true })
  await sair(chamadas[1].p)
  pareador.continuar()
  assert.equal(papelDe(chamadas[2]), 'fechar')
  await linhas(chamadas[2].p, { evento: 'fim', papel: 'fechar', ok: true })
  await sair(chamadas[2].p)
  assert.equal(pareador.continuar(), false, 'depois do fechar não há passo seguinte')
  assert.equal(chamadas.length, 3)
  for (const c of chamadas) {
    assert.equal(c.node, 'C:\\node\\node.exe')
    assert.equal(c.args[0], 'C:\\omni\\parear.mjs')
    assert.ok(c.args.includes('--json'))
    assert.equal(c.opcoes.windowsHide, true)
  }
  assert.deepEqual(enviados.filter((e) => e.evento === 'fim').map((e) => [e.papel, e.ok]), [['pessoal', true], ['bot', true], ['fechar', true]])
  assert.equal(pareador.estado().rodando, false)
})

test('continuar() antes do processo sair espera ele fechar: nunca dois de uma vez', async () => {
  const { pareador, chamadas } = montar()
  pareador.iniciar()
  await linhas(chamadas[0].p, { evento: 'fim', papel: 'pessoal', ok: true })
  assert.equal(pareador.continuar(), true)
  assert.equal(chamadas.length, 1, 'o pessoal ainda não fechou')
  await sair(chamadas[0].p)
  assert.equal(chamadas.length, 2)
  assert.equal(papelDe(chamadas[1]), 'bot')
})

test('fim sem sucesso para a sequência: o passo seguinte não roda', async () => {
  const { pareador, chamadas, enviados } = montar()
  pareador.iniciar()
  await linhas(chamadas[0].p, { evento: 'fim', papel: 'pessoal', ok: false, motivo: 'prazo' })
  await sair(chamadas[0].p, 2)
  assert.equal(pareador.continuar(), false)
  assert.equal(chamadas.length, 1)
  assert.deepEqual(enviados.at(-1), { evento: 'fim', papel: 'pessoal', ok: false, motivo: 'prazo' })
})

test('iniciar(desde) recomeça no passo pedido; passo desconhecido é recusado', async () => {
  const { pareador, chamadas } = montar()
  assert.equal(pareador.iniciar('nada'), false)
  assert.equal(chamadas.length, 0)
  assert.equal(pareador.iniciar('bot'), true)
  assert.equal(papelDe(chamadas[0]), 'bot')
})

test('lista fechada: só eventos e campos conhecidos chegam à janela', async () => {
  const { pareador, chamadas, enviados } = montar()
  pareador.iniciar()
  const p = chamadas[0].p
  await linhas(p,
    'isto não é JSON',
    { evento: 'segredo', chave: 'x' },
    { evento: 'qr', papel: 'pessoal', qr: QR, estado: 'qr_ready', chave: 'x', apiKey: 'y' },
    { evento: 'qr', papel: 'pessoal', qr: 'https://exemplo.invalid/qr.png' },
    { evento: 'qr', papel: 'pessoal', qr: 'data:text/html;base64,PHNjcmlwdD4=' },
    { evento: 'estado', papel: 'pessoal', estado: 'authenticating', telefone: '5511999998888' },
    { evento: 'pareado', papel: 'pessoal', fone4: '1234', phone: '5511999991234' },
    { evento: 'pareado', papel: 'pessoal', fone4: '5511999991234' },
    { evento: 'sessao', papel: 'pessoal', id: 'sessao-abc' },
    { evento: 'fechado', soLeitura: { ok: true, recusas: 5, falhas: [], chave: 'z' }, chaves: { leitura: 'k' } },
    { evento: 'fim', papel: 'pessoal', ok: false, motivo: 'acao-necessaria', detalhe: 'fone 5511999998888 caiu' },
  )
  assert.deepEqual(enviados, [
    { evento: 'qr', papel: 'pessoal', qr: QR, estado: 'qr_ready' },
    { evento: 'estado', papel: 'pessoal', estado: 'authenticating' },
    { evento: 'pareado', papel: 'pessoal', fone4: '1234' },
    { evento: 'pareado', papel: 'pessoal' },
    { evento: 'sessao', papel: 'pessoal' },
    { evento: 'fechado', papel: 'pessoal', soLeitura: { ok: true, recusas: 5, falhas: [] } },
    { evento: 'fim', papel: 'pessoal', ok: false, motivo: 'acao-necessaria', detalhe: 'fone …8888 caiu' },
  ])
})

test('o papel do evento é o do passo em curso, não o que o filho diz', async () => {
  const { pareador, chamadas, enviados } = montar()
  pareador.iniciar()
  await linhas(chamadas[0].p, { evento: 'estado', papel: 'bot', estado: 'ready' })
  assert.equal(enviados[0].papel, 'pessoal')
})

test('linha gigante (> 1 MB) é descartada inteira e a seguinte ainda chega', async () => {
  const { pareador, chamadas, enviados } = montar()
  pareador.iniciar()
  const p = chamadas[0].p
  p.stdout.write('{"evento":"qr","papel":"pessoal","qr":"' + QR + 'A'.repeat(1.2 * 1024 * 1024))
  await tique()
  // a cauda da mesma linha parece um evento válido, e mesmo assim é resto da linha gigante: some junto
  p.stdout.write('{"evento":"estado","estado":"cauda"}\n')
  await linhas(p, { evento: 'estado', papel: 'pessoal', estado: 'qr_ready' })
  assert.deepEqual(enviados, [{ evento: 'estado', papel: 'pessoal', estado: 'qr_ready' }])
})

test('linha que chega em pedaços é remontada', async () => {
  const { pareador, chamadas, enviados } = montar()
  pareador.iniciar()
  const p = chamadas[0].p
  p.stdout.write('{"evento":"esta')
  await tique()
  p.stdout.write('do","estado":"qr_ready"}\n{"evento":"estado","estado":"ready"}\n')
  await tique()
  assert.deepEqual(enviados.map((e) => e.estado), ['qr_ready', 'ready'])
})

test('um por vez: iniciar() com pareamento em curso não abre outro processo', async () => {
  const { pareador, chamadas } = montar()
  assert.equal(pareador.iniciar(), true)
  assert.equal(pareador.iniciar(), false)
  assert.equal(chamadas.length, 1)
  assert.equal(pareador.estado().rodando, true)
})

test('cancelar() mata o processo em curso e a sequência não continua', async () => {
  const { pareador, chamadas, enviados } = montar()
  pareador.iniciar()
  await linhas(chamadas[0].p, { evento: 'fim', papel: 'pessoal', ok: true })
  pareador.continuar()
  pareador.cancelar()
  assert.equal(chamadas[0].p.mortes, 1)
  await tique()
  assert.equal(chamadas.length, 1, 'o bot não pode nascer depois do cancelar')
  assert.equal(pareador.estado().rodando, false)
  assert.equal(enviados.filter((e) => e.motivo === 'saiu').length, 0, 'cancelado não é "saiu"')
  await linhas(chamadas[0].p, { evento: 'estado', estado: 'ready' })
  assert.equal(enviados.filter((e) => e.evento === 'estado').length, 0, 'linha depois do cancelar não chega')
  assert.equal(pareador.iniciar(), true, 'depois de cancelar dá para começar de novo')
})

test('processo que sai sem "fim" vira fim com motivo "saiu"', async () => {
  const { pareador, chamadas, enviados } = montar()
  pareador.iniciar()
  await linhas(chamadas[0].p, { evento: 'estado', estado: 'qr_ready' })
  await sair(chamadas[0].p, 1)
  assert.deepEqual(enviados.at(-1), { evento: 'fim', papel: 'pessoal', ok: false, motivo: 'saiu' })
  assert.equal(pareador.continuar(), false)
})

test('node que não existe vira fim com motivo "sem-node"', async () => {
  const { pareador, chamadas, enviados } = montar()
  pareador.iniciar()
  chamadas[0].p.emit('error', new Error('spawn ENOENT'))
  chamadas[0].p.emit('close', -2)
  await tique()
  assert.deepEqual(enviados.filter((e) => e.evento === 'fim'), [{ evento: 'fim', papel: 'pessoal', ok: false, motivo: 'sem-node' }])
  assert.equal(pareador.estado().rodando, false)
})

test('o filho não herda o token da casa', () => {
  const { pareador, chamadas } = montar()
  pareador.iniciar()
  assert.equal('OMNI_API_TOKEN' in chamadas[0].opcoes.env, false)
  assert.equal(chamadas[0].opcoes.env.PATH, 'x')
})

test('chaveStdin (só a prova usa): a chave vai pela 1ª linha do stdin com --chave-stdin', async () => {
  const { pareador, chamadas } = montar({ chaveStdin: 'chave-falsa' })
  pareador.iniciar()
  await tique()
  assert.ok(chamadas[0].args.includes('--chave-stdin'))
  assert.equal(chamadas[0].p.entrada, 'chave-falsa\n')
  assert.ok(!chamadas[0].args.some((a) => a.includes('chave-falsa')), 'a chave não vai em argumento')
  const sem = montar()
  sem.pareador.iniciar()
  assert.ok(!sem.chamadas[0].args.includes('--chave-stdin'))
})
