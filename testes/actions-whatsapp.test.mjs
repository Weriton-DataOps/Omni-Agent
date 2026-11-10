// O que sobrou do Actions do lado do Omni (F2, plano 5c, T6): o WhatsApp. O depósito (pontos, mesa,
// projetos, execuções) mora no Oráculo; aqui ficam a aprovação por reação, a cota de avisos e a ponte
// que acorda a visita — agora pela tarefa do agente, não mais pelo .ps1 velho.
// Tudo numa cópia temporária: OMNI_ACTIONS e APPDATA apontam para pastas descartáveis antes dos imports.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const raiz = mkdtempSync(join(tmpdir(), 'actions-zap-teste-'))
const appdata = mkdtempSync(join(tmpdir(), 'appdata-zap-teste-'))
process.env.OMNI_ACTIONS = raiz
process.env.APPDATA = appdata

const aprov = await import(new URL('../servicos/whatsapp/omni/aprovacoes.mjs', import.meta.url))
const { comandoDaVisita } = await import(new URL('../servicos/whatsapp/omni/visita.mjs', import.meta.url))
const SCRIPT = fileURLToPath(new URL('../scripts/omni-actions.mjs', import.meta.url))
const RAIZ_OMNI = fileURLToPath(new URL('..', import.meta.url))

test.after(() => { rmSync(raiz, { recursive: true, force: true }); rmSync(appdata, { recursive: true, force: true }) })

const rodar = (args, env = {}) => {
  try { return JSON.parse(execFileSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, ...env }, encoding: 'utf8', windowsHide: true })) }
  catch (e) { return JSON.parse(e.stdout) }
}

// ── a ponte acorda a visita ───────────────────────────────────────────────────────────────────────────
test('visita: a ponte chama a tarefa actions-visita do Oráculo, pelo node que está rodando', () => {
  const [comando, args] = comandoDaVisita('aprovacao')
  assert.equal(comando, process.execPath)
  assert.deepEqual(args, [join(RAIZ_OMNI, 'runtime', 'tarefa-agente.mjs'), 'rodar', 'oraculo', 'actions-visita', '--motivo', 'aprovacao'])
  assert.equal(existsSync(args[0]), true, 'o tarefa-agente.mjs existe nessa raiz')
})

test('visita: o motivo vai como um argumento só, sem passar por shell', () => {
  const [, args] = comandoDaVisita('resposta "x" & calc')
  assert.equal(args.at(-1), 'resposta "x" & calc')
  assert.equal(args.length, 6)
})

// ── aprovação por reação ──────────────────────────────────────────────────────────────────────────────
const AGORA = new Date(2026, 9, 21, 9, 0).getTime() // 21/10/2026 09:00
const DONO = '5500999990000'
const pedido = (extra = {}) => ({ estado: 'pendente', expiraEm: AGORA + 3600e3, assinatura: aprov.assinatura('abc123', 'npm test'), ...extra })
const ctx = { donoFone: DONO, agora: AGORA, commit: 'abc123', comando: 'npm test' }

test('reação: 👍 do dono autoriza (com tom de pele também)', () => {
  assert.equal(aprov.decidir(pedido(), [{ fone: DONO, emoji: '👍' }], ctx).estado, 'sim')
  assert.equal(aprov.decidir(pedido(), [{ fone: DONO, emoji: '👍🏽' }], ctx).estado, 'sim')
})

test('reação: nada autoriza fora das regras', () => {
  const casos = {
    'número errado': [pedido(), [{ fone: '5511000000000', emoji: '👍' }], ctx],
    'pedido desconhecido': [undefined, [{ fone: DONO, emoji: '👍' }], ctx],
    'repetida (já usada)': [pedido({ estado: 'usado' }), [{ fone: DONO, emoji: '👍' }], ctx],
    'expirada': [pedido({ expiraEm: AGORA - 1 }), [{ fone: DONO, emoji: '👍' }], ctx],
    'emoji fora da tabela': [pedido(), [{ fone: DONO, emoji: '❤️' }], ctx],
    'commit diferente': [pedido(), [{ fone: DONO, emoji: '👍' }], { ...ctx, commit: 'def456' }],
    'comando diferente': [pedido(), [{ fone: DONO, emoji: '👍' }], { ...ctx, comando: 'npm test && curl x' }],
    'reação retirada': [pedido(), [], ctx],
    '👎': [pedido(), [{ fone: DONO, emoji: '👎' }], ctx],
  }
  for (const [nome, [p, r, c]] of Object.entries(casos)) assert.notEqual(aprov.decidir(p, r, c).estado, 'sim', nome)
  assert.equal(aprov.decidir(...casos['👎']).estado, 'nao')
  assert.equal(aprov.decidir(...casos['emoji fora da tabela']).estado, 'pendente')
})

test('reação: trocada vale a última; ❓ pede explicação; texto citado é "outra resposta"', () => {
  assert.equal(aprov.decidir(pedido(), [{ fone: DONO, emoji: '👍' }, { fone: DONO, emoji: '👎' }], ctx).estado, 'nao')
  const e = aprov.decidir(pedido(), [{ fone: DONO, emoji: '❓' }], ctx)
  assert.equal(e.estado, 'explica')
  assert.equal(e.jaExplicado, false)
  const o = aprov.decidir(pedido({ resposta: { texto: 'roda só o lint' } }), [], ctx)
  assert.deepEqual(o, { estado: 'outra', texto: 'roda só o lint' })
})

test('reação: registro guarda resposta só de pedido pendente e dentro da validade', () => {
  mkdirSync(join(appdata, 'omni', 'whatsapp'), { recursive: true })
  writeFileSync(join(appdata, 'omni', 'whatsapp', 'aprovacoes.json'), JSON.stringify({ pedidos: {
    VIVO: pedido({ expiraEm: Date.now() + 3600e3 }),
    VELHO: pedido({ expiraEm: Date.now() - 1 }),
    USADO: pedido({ estado: 'usado', expiraEm: Date.now() + 3600e3 }),
  } }))
  assert.equal(aprov.registrarResposta('VIVO', 'só o lint'), true)
  assert.equal(aprov.registrarResposta('VELHO', 'x'), false)
  assert.equal(aprov.registrarResposta('USADO', 'x'), false)
  assert.equal(aprov.registrarResposta('NAO-EXISTE', 'x'), false)
  assert.equal(aprov.carregar().pedidos.VIVO.resposta.texto, 'só o lint')
  assert.deepEqual(aprov.pendentes().map((p) => p.waId), ['VIVO'])
})

// ── o script: só WhatsApp; depósito é do Oráculo ──────────────────────────────────────────────────────
test('script: os comandos do depósito respondem que agora são do Oráculo, sem tocar no Actions', () => {
  for (const cmd of ['mesa', 'ponto', 'campo', 'propor-veredito', 'historico', 'propor-item']) {
    const r = rodar([cmd, 'x', 'y'])
    assert.deepEqual(r, { ok: false, erro: 'comando do depósito: use o omni-actions.mjs do Oráculo' }, cmd)
  }
  assert.equal(existsSync(join(raiz, 'visitas')), false, 'nada foi criado no Actions')
})

test('script: avisar a seco não sai para o WhatsApp nem gasta cota', () => {
  const r = rodar(['avisar', 'oi'], { OMNI_VISITA_SECO: '1' })
  assert.equal(r.ok, false)
  assert.match(r.erro, /a seco/)
  assert.equal(existsSync(join(raiz, 'visitas', 'cota.json')), false)
})

test('script: avisar com a cota de hoje esgotada recusa antes de chamar o WhatsApp', () => {
  const d = new Date()
  const hoje = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
  mkdirSync(join(raiz, 'visitas'), { recursive: true })
  writeFileSync(join(raiz, 'visitas', 'cota.json'), JSON.stringify({ dia: hoje, propostas: 0, avisos: 2 }))
  const r = rodar(['avisar', 'oi'])
  assert.equal(r.ok, false)
  assert.match(r.erro, /cota de hoje esgotada: 2 avisos por dia/)
  assert.equal(JSON.parse(readFileSync(join(raiz, 'visitas', 'cota.json'), 'utf8')).avisos, 2, 'a cota não andou')
  rmSync(join(raiz, 'visitas'), { recursive: true, force: true })
})

test('script: comando desconhecido aponta o cabeçalho', () => {
  assert.match(rodar(['nada']).erro, /comando desconhecido/)
})
