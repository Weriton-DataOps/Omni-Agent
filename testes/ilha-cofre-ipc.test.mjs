// Os canais do cofre na ilha (F1, plano 5, T6). Tudo é falso: o ipcMain é um Map, a mão anota as chamadas
// e responde o que a prova manda, a área de transferência é um objeto com texto. Nenhum processo nasce,
// nenhuma área real é lida e nenhum valor real passa.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { registrarIpcCofre, dadosDoCadastro, textoDaArea, PRAZO_REVELADO_MS } = require('../apps/omni-ilha/cofre-ipc.js')

const DA_JANELA = { sender: 'janela do cofre' }
const DA_ILHA = { sender: 'ilha' }
const DE_FORA = { sender: 'outra janela' }
const zerado = (b) => b.every((x) => x === 0)
const NOMES = ['listar', 'lixeira', 'esvaziarLixeira', 'saude', 'historico', 'testar', 'cadastrar', 'editar', 'rotacionar', 'apagar', 'restaurar', 'revelar', 'copiar']
const CANAIS_DA_JANELA = ['cofre:listar', 'cofre:lixeira', 'cofre:esvaziar', 'cofre:saude', 'cofre:historico', 'cofre:testar', 'cofre:cadastrar',
  'cofre:cadastrar-da-area', 'cofre:editar', 'cofre:rotacionar', 'cofre:rotacionar-da-area', 'cofre:apagar', 'cofre:restaurar', 'cofre:revelar', 'cofre:copiar']

// A mão anota o texto de cada Buffer no momento da chamada e guarda o próprio Buffer para a prova conferir depois.
function montar({ respostas = {}, area = '' } = {}) {
  const chamadas = []
  const mao = {}
  for (const nome of NOMES) {
    mao[nome] = async (...args) => {
      chamadas.push({ nome, args: args.map((a) => (Buffer.isBuffer(a) ? { buffer: a.toString('utf8') } : a)), buffers: args.filter(Buffer.isBuffer) })
      return respostas[nome] ? respostas[nome](...args) : { ok: true, dados: { de: nome } }
    }
  }
  const clipboard = { texto: area, leituras: 0, limpezas: 0, readText() { this.leituras += 1; return this.texto }, clear() { this.limpezas += 1; this.texto = '' } }
  const handlers = new Map()
  const ipcMain = { handle(canal, fn) { assert.equal(handlers.has(canal), false, `canal repetido: ${canal}`); handlers.set(canal, fn) } }
  const canais = registrarIpcCofre({ ipcMain, mao, clipboard, daJanela: (e) => e === DA_JANELA, daIlha: (e) => e === DA_ILHA })
  const invocar = async (canal, evento, ...args) => handlers.get(canal)(evento, ...args)
  return { chamadas, clipboard, handlers, canais, invocar }
}

test('registra os canais da janela e o resumo da ilha, e só eles', () => {
  const { canais, handlers } = montar()
  assert.deepEqual(canais, [...CANAIS_DA_JANELA, 'cofre:resumo'])
  assert.deepEqual([...handlers.keys()], canais)
})

test('remetente errado recebe null e a mão não é chamada', async () => {
  const { chamadas, clipboard, invocar } = montar({ area: 'valor-da-area' })
  for (const canal of CANAIS_DA_JANELA) {
    assert.equal(await invocar(canal, DA_ILHA, 'a', 'b'), null, `${canal} aceitou a ilha`)
    assert.equal(await invocar(canal, DE_FORA, 'a', 'b'), null, `${canal} aceitou outra janela`)
  }
  assert.equal(await invocar('cofre:resumo', DA_JANELA), null, 'o resumo aceitou a janela do cofre')
  assert.equal(await invocar('cofre:resumo', DE_FORA), null, 'o resumo aceitou outra janela')
  assert.deepEqual(chamadas, [])
  assert.equal(clipboard.leituras, 0, 'a área foi lida para um remetente errado')
})

test('cada canal da janela chama a sua função da mão com os argumentos certos', async () => {
  const casos = [
    ['cofre:listar', [], 'listar', []],
    ['cofre:lixeira', [], 'lixeira', []],
    ['cofre:esvaziar', [], 'esvaziarLixeira', []],
    ['cofre:saude', [true], 'saude', [{ duplicatas: true }]],
    ['cofre:saude', ['true'], 'saude', [{ duplicatas: false }]],
    ['cofre:saude', [], 'saude', [{ duplicatas: false }]],
    ['cofre:historico', [7], 'historico', [{ id: '7', limite: 50 }]],
    ['cofre:testar', ['omni/teste'], 'testar', ['omni/teste']],
    ['cofre:editar', ['omni/teste', { notas: 'nova' }], 'editar', ['omni/teste', { notas: 'nova' }]],
    ['cofre:apagar', ['omni/teste'], 'apagar', ['omni/teste']],
    ['cofre:restaurar', [5], 'restaurar', ['5']],
    ['cofre:copiar', ['omni/teste'], 'copiar', ['omni/teste']],
  ]
  for (const [canal, args, nome, esperado] of casos) {
    const { chamadas, invocar } = montar()
    assert.deepEqual(await invocar(canal, DA_JANELA, ...args), { ok: true, dados: { de: nome } }, canal)
    assert.deepEqual(chamadas.map((c) => ({ nome: c.nome, args: c.args })), [{ nome, args: esperado }], canal)
  }
})

test('dadosDoCadastro leva só os campos do cadastrar, aparados, e os agentes em lista', () => {
  assert.deepEqual(dadosDoCadastro({ nome: ' omni/teste ', tipo: 'token', servico: '', url: '  ', usuario: 'robo', notas: 'n', agentes: 'omni, overcore ,', validade: '2027-01-01', etiquetas: ['x'] }),
    { nome: 'omni/teste', tipo: 'token', usuario: 'robo', notas: 'n', agentes: ['omni', 'overcore'] })
  assert.deepEqual(dadosDoCadastro({ nome: 'a', agentes: '' }), { nome: 'a', agentes: [] })
  assert.deepEqual(dadosDoCadastro(null), { agentes: [] })
  assert.deepEqual(dadosDoCadastro({ nome: 12 }), { nome: '12', agentes: [] })
})

test('cadastrar e rotacionar com o valor digitado mandam um Buffer UTF-8 e o zeram', async () => {
  const { chamadas, invocar } = montar()
  await invocar('cofre:cadastrar', DA_JANELA, { nome: ' omni/teste ', agentes: 'omni' }, 'ção-1')
  await invocar('cofre:rotacionar', DA_JANELA, 'omni/teste', 'ção-2')
  assert.deepEqual(chamadas.map((c) => ({ nome: c.nome, args: c.args })), [
    { nome: 'cadastrar', args: [{ nome: 'omni/teste', agentes: ['omni'] }, { buffer: 'ção-1' }] },
    { nome: 'rotacionar', args: ['omni/teste', { buffer: 'ção-2' }] },
  ])
  for (const c of chamadas) assert.ok(zerado(c.buffers[0]), `o Buffer do ${c.nome} ficou com o valor`)
})

test('textoDaArea tira uma quebra do fim e recusa vazio e várias linhas, sem pôr o valor no erro', () => {
  assert.deepEqual(textoDaArea('abc'), { ok: true, texto: 'abc' })
  assert.deepEqual(textoDaArea('abc\n'), { ok: true, texto: 'abc' })
  assert.deepEqual(textoDaArea('abc\r\n'), { ok: true, texto: 'abc' })
  for (const vazio of ['', '\n', '\r\n', undefined]) assert.equal(textoDaArea(vazio).codigo, 'area-vazia', JSON.stringify(vazio))
  for (const varias of ['a\nb', 'a\rb', 'abc\n\n', 'abc\r']) assert.equal(textoDaArea(varias).codigo, 'varias-linhas', JSON.stringify(varias))
  for (const texto of ['segredo-1\nx', '']) {
    const r = textoDaArea(texto)
    assert.equal(r.ok, false)
    assert.equal(typeof r.erro, 'string')
    assert.equal(r.erro.includes('segredo'), false, 'o erro levou o valor')
    assert.equal('texto' in r, false, 'a recusa levou o texto')
  }
})

test('da área: lê no main, manda Buffer, zera, e limpa a área só no sucesso e só se ela não mudou', async () => {
  {
    const { chamadas, clipboard, invocar } = montar({ area: 'valor-1\r\n' })
    const r = await invocar('cofre:cadastrar-da-area', DA_JANELA, { nome: 'omni/teste', agentes: 'omni', notas: '' })
    assert.deepEqual(r, { ok: true, dados: { de: 'cadastrar' } })
    assert.deepEqual(chamadas.map((c) => c.args), [[{ nome: 'omni/teste', agentes: ['omni'] }, { buffer: 'valor-1' }]])
    assert.ok(zerado(chamadas[0].buffers[0]), 'o Buffer da área ficou com o valor')
    assert.equal(clipboard.limpezas, 1, 'a área não foi limpa depois do sucesso')
  }
  {
    const { chamadas, clipboard, invocar } = montar({ area: 'valor-2' })
    await invocar('cofre:rotacionar-da-area', DA_JANELA, 'omni/teste')
    assert.deepEqual(chamadas.map((c) => c.args), [['omni/teste', { buffer: 'valor-2' }]])
    assert.equal(clipboard.limpezas, 1, 'a área não foi limpa depois da troca')
  }
  {
    const respostas = { rotacionar: () => ({ ok: false, codigo: 'inexistente', erro: 'não há' }) }
    const { clipboard, invocar } = montar({ area: 'valor-3', respostas })
    assert.deepEqual(await invocar('cofre:rotacionar-da-area', DA_JANELA, 'omni/teste'), { ok: false, codigo: 'inexistente', erro: 'não há' })
    assert.equal(clipboard.limpezas, 0, 'a área foi limpa numa recusa')
    assert.equal(clipboard.texto, 'valor-3')
  }
  {
    let clip
    const respostas = { cadastrar: () => { clip.texto = 'outra coisa copiada'; return { ok: true, dados: {} } } }
    const montado = montar({ area: 'valor-4', respostas })
    clip = montado.clipboard
    await montado.invocar('cofre:cadastrar-da-area', DA_JANELA, { nome: 'omni/teste' })
    assert.equal(clip.limpezas, 0, 'a área foi limpa depois de mudar')
    assert.equal(clip.texto, 'outra coisa copiada')
  }
  for (const [area, codigo] of [['', 'area-vazia'], ['a\nb', 'varias-linhas']]) {
    const { chamadas, clipboard, invocar } = montar({ area })
    const r = await invocar('cofre:rotacionar-da-area', DA_JANELA, 'omni/teste')
    assert.equal(r.codigo, codigo)
    assert.deepEqual(chamadas, [], 'a mão foi chamada com a área recusada')
    assert.equal(clipboard.limpezas, 0)
  }
})

test('revelar devolve o texto com o prazo, zera o Buffer e repassa a recusa', async () => {
  assert.equal(PRAZO_REVELADO_MS, 30000)
  {
    const valor = Buffer.from('ção-revelado')
    const { invocar } = montar({ respostas: { revelar: () => ({ ok: true, dados: { ok: true, nome: 'omni/teste', usoId: 3 }, valor }) } })
    assert.deepEqual(await invocar('cofre:revelar', DA_JANELA, 'omni/teste'), { ok: true, dados: { ok: true, nome: 'omni/teste', usoId: 3 }, valor: 'ção-revelado', prazoMs: 30000 })
    assert.ok(zerado(valor), 'o Buffer revelado ficou com o valor')
  }
  {
    const { invocar } = montar({ respostas: { revelar: () => ({ ok: true, dados: {}, valor: 'texto em vez de Buffer' }) } })
    assert.deepEqual(await invocar('cofre:revelar', DA_JANELA, 'omni/teste'), { ok: false, codigo: 'sem-valor', erro: 'o cofre não devolveu o valor' })
  }
  {
    const recusa = { ok: false, codigo: 'hello-negado', erro: 'o Windows Hello não confirmou' }
    const { chamadas, invocar } = montar({ respostas: { revelar: () => recusa } })
    assert.deepEqual(await invocar('cofre:revelar', DA_JANELA, 'omni/teste'), recusa)
    assert.deepEqual(chamadas.map((c) => c.args), [['omni/teste']])
  }
})

test('o resumo da ilha conta os alertas e mostra só regra e nome dos três primeiros', async () => {
  const alertas = [
    { regra: 'vence', nome: 'a', validade: '2026-11-10' },
    { regra: 'teste-falhou', nome: 'b', em: 'x' },
    { regra: 'sem-uso', nome: 'c', desde: 'y' },
    { regra: 'agente-nunca-usou', nome: 'd', agente: 'omni' },
  ]
  {
    const { chamadas, invocar } = montar({ respostas: { saude: () => ({ ok: true, dados: { ok: true, total: 9, alertas, duplicatas: [] } }) } })
    assert.deepEqual(await invocar('cofre:resumo', DA_ILHA), { ok: true, total: 9, alertas: 4, primeiros: [{ regra: 'vence', nome: 'a' }, { regra: 'teste-falhou', nome: 'b' }, { regra: 'sem-uso', nome: 'c' }] })
    assert.deepEqual(chamadas.map((c) => c.args), [[{ duplicatas: false }]])
  }
  {
    const falha = { ok: false, codigo: 'sem-node', erro: 'não achei o Node do sistema' }
    const { invocar } = montar({ respostas: { saude: () => falha } })
    assert.deepEqual(await invocar('cofre:resumo', DA_ILHA), falha)
  }
})
