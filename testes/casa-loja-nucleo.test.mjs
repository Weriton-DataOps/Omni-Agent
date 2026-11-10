import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { comBancoDaCasa, sha256 } from '../runtime/casa/banco.mjs'
import {
  LIMITE_MANIFESTO,
  NucleoError,
  lerManifesto,
  listarInstalados,
  listarInterfaces,
  listarMaquinas,
  listarServidores,
  listarTarefas,
  registrarAgente,
  registrarMaquina,
  retirarAgente,
  validarManifesto
} from '../runtime/casa/loja-nucleo.mjs'

// Manifestos de exemplo no formato dos agentes da casa; nenhum é cópia de agente real.
function completo() {
  return {
    agente: 'exemplo',
    versao: '0.3.0',
    banco: 'exemplo.db',
    migracoes: 'migrations/',
    requer: { node: '>=24', agentes: ['omni>=0.26'] },
    executor: { comando: 'node executor/exemplo-executor.mjs', modos: ['instalar', 'importar', 'exportar', 'atualizar', 'verificar', 'servir'] },
    interface: {
      modulo: 'interface/index.html',
      preload: 'interface/preload.js',
      painel: 'Exemplo',
      api: 'http://127.0.0.1:{porta}/v1',
      rotas: [
        { metodo: 'GET', padrao: '^/v1/itens$', escopo: 'qualquer' },
        { metodo: 'PATCH', padrao: '^/v1/itens/[^/]+$', escopo: 'tela' }
      ]
    },
    tarefas: [
      { id: 'visita', lancador: 'omni', roteiro: 'roteiros/visita.md', variaveis: ['MOTIVO', 'HOJE'], quando: { diaria: '07:00' }, seAtrasada: true },
      { id: 'vigia', comando: 'node vigia.mjs', quando: { acada: 'PT15M' }, seAtrasada: false }
    ],
    credenciais: ['exemplo/api'],
    anotacao: { livre: 'campo a mais e tolerado' }
  }
}

function minimo() {
  return { agente: 'segundo', versao: '0.1.0', banco: null, requer: {}, tarefas: [], credenciais: [] }
}

const bytes = (objeto) => Buffer.from(JSON.stringify(objeto, null, 2), 'utf8')
const OPCOES = { maquina: 'pc', nome: 'PC', sistema: 'win32', agora: 't0' }
const RAIZ = resolve(tmpdir(), 'agentes-exemplo', 'exemplo')

function recusa(texto) {
  try {
    validarManifesto(texto)
  } catch (falha) {
    assert.ok(falha instanceof NucleoError, String(falha))
    assert.equal(falha.code, 'manifesto-invalido')
    return falha.erros
  }
  assert.fail('o manifesto deveria ter sido recusado')
}

function casaTemporaria() {
  return mkdtempSync(join(tmpdir(), 'omni-casa-nucleo-'))
}

function apagar(casa) {
  try {
    rmSync(casa, { recursive: true, force: true })
  } catch {
    // Sobra pasta temporária; a asserção que importa já falou.
  }
}

function comNucleo(uso) {
  const casa = casaTemporaria()
  try {
    return comBancoDaCasa(casa, 'nucleo', uso)
  } finally {
    apagar(casa)
  }
}

const diario = (db) => db.prepare('SELECT tabela, linha, operacao, versao FROM _diario ORDER BY seq').all()
  .map((l) => `${l.tabela}:${l.linha}:${l.operacao}:${l.versao}`)

test('manifesto completo e minimo passam; o sha e dos bytes crus e o texto gravado e o objeto lido', () => {
  const crus = bytes(completo())
  const lido = validarManifesto(crus)
  assert.equal(lido.sha256, sha256(crus))
  assert.deepEqual(lido.manifesto, completo())
  assert.equal(lido.texto, JSON.stringify(completo()))
  assert.deepEqual(validarManifesto(bytes(minimo())).manifesto, minimo())

  const comBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(completo()).replaceAll(',', ',\r\n'))])
  let outro
  assert.doesNotThrow(() => { outro = validarManifesto(comBom) })
  assert.notEqual(outro.sha256, lido.sha256)
  assert.equal(outro.texto, lido.texto)
  assert.equal(validarManifesto(JSON.stringify(minimo())).texto, JSON.stringify(minimo()))
})

const RECUSAS = [
  ['agente ausente', (m) => { delete m.agente }, 'agente'],
  ['agente maiusculo', (m) => { m.agente = 'Exemplo'; m.banco = 'Exemplo.db' }, 'agente'],
  ['agente reservado', (m) => { m.agente = 'cofre'; m.banco = 'cofre.db' }, 'agente'],
  ['versao fora do semver', (m) => { m.versao = '1.0' }, 'versao'],
  ['banco de outro agente', (m) => { m.banco = 'outro.db' }, 'banco'],
  ['banco ausente', (m) => { delete m.banco }, 'banco'],
  ['banco sem migracoes', (m) => { delete m.migracoes }, 'migracoes'],
  ['migracoes sem banco', (m) => { m.banco = null }, 'migracoes'],
  ['migracoes absoluta', (m) => { m.migracoes = '/migrations/' }, 'migracoes'],
  ['migracoes que sobe', (m) => { m.migracoes = 'a/../../fora/' }, 'migracoes'],
  ['migracoes com barra invertida', (m) => { m.migracoes = 'a\\b' }, 'migracoes'],
  ['migracoes com unidade', (m) => { m.migracoes = 'C:migrations/' }, 'migracoes'],
  ['requer ausente', (m) => { delete m.requer }, 'requer'],
  ['node fora do formato', (m) => { m.requer.node = '^24' }, 'requer.node'],
  ['agente requerido sem versao', (m) => { m.requer.agentes = ['omni'] }, 'requer.agentes'],
  ['agente requerido repetido', (m) => { m.requer.agentes = ['omni>=0.26', 'omni>=0.27'] }, 'requer.agentes'],
  ['executor sem comando', (m) => { m.executor.comando = '' }, 'executor.comando'],
  ['modo desconhecido', (m) => { m.executor.modos = ['instalar', 'apagar'] }, 'executor.modos'],
  ['modos vazio', (m) => { m.executor.modos = [] }, 'executor.modos'],
  ['modo repetido', (m) => { m.executor.modos = ['instalar', 'instalar'] }, 'executor.modos'],
  ['modulo que nao e html', (m) => { m.interface.modulo = 'interface/index.js' }, 'interface.modulo'],
  ['modulo absoluto', (m) => { m.interface.modulo = '/interface/index.html' }, 'interface.modulo'],
  ['preload que nao e js', (m) => { m.interface.preload = 'interface/preload.ts' }, 'interface.preload'],
  ['painel longo', (m) => { m.interface.painel = 'x'.repeat(41) }, 'interface.painel'],
  ['api em localhost', (m) => { m.interface.api = 'http://localhost:{porta}/v1' }, 'interface.api'],
  ['rotas sem api', (m) => { delete m.interface.api }, 'interface.api'],
  ['rota sem ancora final', (m) => { m.interface.rotas[0].padrao = '^/v1/itens' }, 'interface.rotas[0].padrao'],
  ['rota fora do v1', (m) => { m.interface.rotas[0].padrao = '^/v2/itens$' }, 'interface.rotas[0].padrao'],
  ['rota que nao compila', (m) => { m.interface.rotas[1].padrao = '^/v1/(itens$' }, 'interface.rotas[1].padrao'],
  ['metodo desconhecido', (m) => { m.interface.rotas[0].metodo = 'HEAD' }, 'interface.rotas[0].metodo'],
  ['escopo desconhecido', (m) => { m.interface.rotas[1].escopo = 'todos' }, 'interface.rotas[1].escopo'],
  ['tarefas ausente', (m) => { delete m.tarefas }, 'tarefas'],
  ['tarefa sem id', (m) => { delete m.tarefas[0].id }, 'tarefas[0].id'],
  ['tarefa com id fora do formato', (m) => { m.tarefas[0].id = 'Visita' }, 'tarefas[0].id'],
  ['tarefa com id repetido', (m) => { m.tarefas[1].id = 'visita' }, 'tarefas[1].id'],
  ['tarefa com diaria e acada', (m) => { m.tarefas[0].quando = { diaria: '07:00', acada: 'PT1H' } }, 'tarefas[0].quando'],
  ['tarefa sem quando', (m) => { delete m.tarefas[1].quando }, 'tarefas[1].quando'],
  ['hora fora do relogio', (m) => { m.tarefas[0].quando = { diaria: '24:00' } }, 'tarefas[0].quando'],
  ['intervalo zero', (m) => { m.tarefas[1].quando = { acada: 'PT0M' } }, 'tarefas[1].quando'],
  ['intervalo em segundos', (m) => { m.tarefas[1].quando = { acada: 'PT30S' } }, 'tarefas[1].quando'],
  ['seAtrasada que nao e booleano', (m) => { m.tarefas[0].seAtrasada = 'sim' }, 'tarefas[0].seAtrasada'],
  ['tarefa com comando e lancador', (m) => { m.tarefas[0].comando = 'node x.mjs' }, 'tarefas[0]'],
  ['tarefa sem comando nem lancador', (m) => { delete m.tarefas[1].comando }, 'tarefas[1]'],
  ['lancador que nao e o omni', (m) => { m.tarefas[0].lancador = 'outro' }, 'tarefas[0].lancador'],
  ['roteiro absoluto', (m) => { m.tarefas[0].roteiro = 'C:/roteiros/visita.md' }, 'tarefas[0].roteiro'],
  ['variavel minuscula', (m) => { m.tarefas[0].variaveis = ['hoje'] }, 'tarefas[0].variaveis'],
  ['variavel repetida', (m) => { m.tarefas[0].variaveis = ['HOJE', 'HOJE'] }, 'tarefas[0].variaveis'],
  ['credenciais ausente', (m) => { delete m.credenciais }, 'credenciais'],
  ['credencial fora do formato', (m) => { m.credenciais = ['-exemplo'] }, 'credenciais'],
  ['credencial repetida', (m) => { m.credenciais = ['a', 'a'] }, 'credenciais']
]

for (const [caso, mexer, campo] of RECUSAS) {
  test(`manifesto recusado: ${caso}`, () => {
    const m = completo()
    mexer(m)
    const erros = recusa(bytes(m))
    assert.equal(erros.length, 1, erros.join(' | '))
    assert.ok(erros[0].startsWith(`${campo}:`), erros[0])
  })
}

test('manifesto que nao e objeto JSON e recusado sem ecoar o conteudo', () => {
  for (const texto of ['{"agente":', '[]', 'null', '"exemplo"']) {
    assert.deepEqual(recusa(texto), ['manifesto: precisa ser um objeto JSON'], texto)
  }
  const m = completo()
  m.agente = 'VALOR-QUE-NAO-VOLTA'
  m.executor.comando = 42
  const erros = recusa(bytes(m))
  assert.deepEqual(erros.map((e) => e.split(':')[0]), ['agente', 'executor.comando'])
  assert.ok(!erros.join(' ').includes('VALOR-QUE-NAO-VOLTA'))
})

test('lerManifesto le executor/agente.json da raiz absoluta e recusa o que nao serve', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'omni-raiz-agente-'))
  try {
    assert.throws(() => lerManifesto(raiz), (falha) => falha instanceof NucleoError && falha.code === 'sem-manifesto')
    mkdirSync(join(raiz, 'executor'))
    writeFileSync(join(raiz, 'executor', 'agente.json'), bytes(completo()))
    assert.deepEqual(lerManifesto(raiz), bytes(completo()))
    assert.throws(() => lerManifesto('relativa/exemplo'), (falha) => falha instanceof NucleoError && falha.code === 'dados-invalidos')
    writeFileSync(join(raiz, 'executor', 'agente.json'), Buffer.alloc(LIMITE_MANIFESTO + 1, 0x20))
    assert.throws(() => lerManifesto(raiz), (falha) => falha instanceof NucleoError && falha.code === 'manifesto-grande')
  } finally {
    apagar(raiz)
  }
})

test('registrar e idempotente: o mesmo manifesto na mesma raiz nao sobe versao nem gera diario', () => {
  comNucleo((db) => {
    const primeiro = registrarAgente(db, bytes(completo()), { ...OPCOES, raiz: RAIZ })
    assert.deepEqual(primeiro, { agente: 'exemplo', versao: '0.3.0', maquina: 'pc', mudou: { agente: true, instalacao: true } })
    const antes = diario(db)
    assert.deepEqual(antes, ['maquinas:pc:I:1', 'agentes:exemplo:I:1', 'instalacoes:pc/exemplo:I:1'])

    const segundo = registrarAgente(db, bytes(completo()), { ...OPCOES, raiz: RAIZ, agora: 't1' })
    assert.deepEqual(segundo.mudou, { agente: false, instalacao: false })
    assert.deepEqual(diario(db), antes)
    assert.equal(db.prepare('SELECT visto_em FROM maquinas WHERE id = ?').get('pc').visto_em, 't1')

    const catalogo = db.prepare('SELECT * FROM agentes WHERE id = ?').get('exemplo')
    assert.equal(catalogo.banco, 'exemplo.db')
    assert.equal(catalogo.manifesto, JSON.stringify(completo()))
    assert.equal(catalogo.manifesto_sha256, sha256(bytes(completo())))
    assert.equal(catalogo.origem_maquina, 'pc')
  })
})

test('manifesto novo sobe a versao do catalogo e da instalacao; raiz nova sobe so a instalacao', () => {
  comNucleo((db) => {
    registrarAgente(db, bytes(completo()), { ...OPCOES, raiz: RAIZ })
    const novo = completo()
    novo.versao = '0.3.1'
    assert.deepEqual(registrarAgente(db, bytes(novo), { ...OPCOES, raiz: RAIZ, agora: 't1' }).mudou, { agente: true, instalacao: true })
    const outraRaiz = resolve(tmpdir(), 'agentes-exemplo', 'movido')
    assert.deepEqual(registrarAgente(db, bytes(novo), { ...OPCOES, raiz: outraRaiz, agora: 't2' }).mudou, { agente: false, instalacao: true })
    assert.equal(db.prepare('SELECT atualizado_em FROM agentes WHERE id = ?').get('exemplo').atualizado_em, 't1')
    // Mesmo semver, manifesto diferente: o sha muda e as duas linhas sobem.
    novo.credenciais = ['exemplo/api', 'exemplo/outra']
    assert.deepEqual(registrarAgente(db, bytes(novo), { ...OPCOES, raiz: outraRaiz, agora: 't3' }).mudou, { agente: true, instalacao: true })
    assert.deepEqual(diario(db).slice(3), [
      'agentes:exemplo:U:2', 'instalacoes:pc/exemplo:U:2', 'instalacoes:pc/exemplo:U:3', 'agentes:exemplo:U:3', 'instalacoes:pc/exemplo:U:4'
    ])
    const [instalado] = listarInstalados(db, { maquina: 'pc' })
    assert.equal(instalado.raiz, outraRaiz)
    assert.equal(instalado.versao, '0.3.1')
    assert.equal(instalado.catalogoDiverge, false)
  })
})

test('cada maquina tem a propria instalacao; o catalogo e de todas e o ultimo registrado vence', () => {
  comNucleo((db) => {
    registrarAgente(db, bytes(completo()), { ...OPCOES, raiz: RAIZ })
    const novo = completo()
    novo.versao = '0.4.0'
    const notebook = { maquina: 'notebook', nome: 'Notebook', sistema: 'linux', agora: 't1', raiz: '/opt/agentes/exemplo' }
    assert.equal(registrarAgente(db, bytes(novo), notebook).maquina, 'notebook')
    registrarAgente(db, bytes(minimo()), notebook)

    assert.deepEqual(listarInstalados(db, { maquina: 'pc' }), [
      { agente: 'exemplo', raiz: RAIZ, versao: '0.3.0', banco: 'exemplo.db', versaoNoCatalogo: '0.4.0', catalogoDiverge: true, atualizado_em: 't0' }
    ])
    assert.deepEqual(listarInstalados(db, { maquina: 'notebook' }).map((i) => [i.agente, i.versao, i.catalogoDiverge]), [
      ['exemplo', '0.4.0', false],
      ['segundo', '0.1.0', false]
    ])
    assert.deepEqual(listarMaquinas(db), [
      { id: 'notebook', nome: 'Notebook', sistema: 'linux', visto_em: 't1', agentes: 2 },
      { id: 'pc', nome: 'PC', sistema: 'win32', visto_em: 't0', agentes: 1 }
    ])
  })
})

test('retirar poe lapide so na instalacao desta maquina; reinstalar revive a linha', () => {
  comNucleo((db) => {
    registrarAgente(db, bytes(completo()), { ...OPCOES, raiz: RAIZ })
    registrarAgente(db, bytes(completo()), { maquina: 'notebook', nome: 'Notebook', sistema: 'linux', agora: 't0', raiz: '/opt/agentes/exemplo' })
    assert.deepEqual(retirarAgente(db, 'exemplo', { maquina: 'pc', agora: 't1' }), { agente: 'exemplo', maquina: 'pc', retirado: true })
    assert.deepEqual(listarInstalados(db, { maquina: 'pc' }), [])
    assert.equal(listarInstalados(db, { maquina: 'notebook' }).length, 1)
    assert.equal(listarMaquinas(db).find((m) => m.id === 'pc').agentes, 0)
    const lapide = db.prepare('SELECT apagado_em, versao FROM instalacoes WHERE id = ?').get('pc/exemplo')
    assert.deepEqual({ ...lapide }, { apagado_em: 't1', versao: 2 })
    assert.equal(db.prepare('SELECT apagado_em FROM agentes WHERE id = ?').get('exemplo').apagado_em, null)

    assert.throws(() => retirarAgente(db, 'exemplo', { maquina: 'pc', agora: 't2' }), (falha) => falha instanceof NucleoError && falha.code === 'inexistente')
    assert.throws(() => retirarAgente(db, 'nunca-houve', { maquina: 'pc' }), (falha) => falha instanceof NucleoError && falha.code === 'inexistente')
    assert.throws(() => retirarAgente(db, 'Errado', { maquina: 'pc' }), (falha) => falha instanceof NucleoError && falha.code === 'dados-invalidos')

    assert.deepEqual(registrarAgente(db, bytes(completo()), { ...OPCOES, raiz: RAIZ, agora: 't3' }).mudou, { agente: false, instalacao: true })
    const revivida = db.prepare('SELECT apagado_em, versao FROM instalacoes WHERE id = ?').get('pc/exemplo')
    assert.deepEqual({ ...revivida }, { apagado_em: null, versao: 3 })
  })
})

test('lapide no catalogo vinda de outra maquina e revivida quando alguem registra de novo', () => {
  comNucleo((db) => {
    registrarAgente(db, bytes(completo()), { ...OPCOES, raiz: RAIZ })
    db.prepare("UPDATE agentes SET apagado_em = 't1', versao = versao + 1 WHERE id = 'exemplo'").run()
    assert.equal(listarInstalados(db, { maquina: 'pc' })[0].versaoNoCatalogo, null)
    assert.deepEqual(registrarAgente(db, bytes(completo()), { ...OPCOES, raiz: RAIZ, agora: 't2' }).mudou, { agente: true, instalacao: false })
    const catalogo = db.prepare('SELECT apagado_em, versao FROM agentes WHERE id = ?').get('exemplo')
    assert.deepEqual({ ...catalogo }, { apagado_em: null, versao: 3 })
    assert.equal(listarInstalados(db, { maquina: 'pc' })[0].versaoNoCatalogo, '0.3.0')
  })
})

test('registrar recusa raiz relativa e manifesto invalido sem gravar nada', () => {
  comNucleo((db) => {
    assert.throws(() => registrarAgente(db, bytes(completo()), { ...OPCOES, raiz: 'agentes/exemplo' }), (falha) => falha instanceof NucleoError && falha.code === 'dados-invalidos')
    const m = completo()
    m.versao = 'x'
    assert.throws(() => registrarAgente(db, bytes(m), { ...OPCOES, raiz: RAIZ }), (falha) => falha instanceof NucleoError && falha.code === 'manifesto-invalido')
    assert.deepEqual(diario(db), [])
  })
})

test('registrarMaquina so sobe a versao quando nome ou sistema mudam', () => {
  comNucleo((db) => {
    assert.deepEqual(registrarMaquina(db, OPCOES), { maquina: 'pc', mudou: true })
    assert.deepEqual(registrarMaquina(db, { ...OPCOES, agora: 't1' }), { maquina: 'pc', mudou: false })
    assert.deepEqual(registrarMaquina(db, { ...OPCOES, sistema: 'linux', agora: 't2' }), { maquina: 'pc', mudou: true })
    assert.deepEqual(registrarMaquina(db, { ...OPCOES, sistema: 'linux', nome: 'PC-NOVO', agora: 't3' }), { maquina: 'pc', mudou: true })
    assert.deepEqual(diario(db), ['maquinas:pc:I:1', 'maquinas:pc:U:2', 'maquinas:pc:U:3'])
    assert.deepEqual(listarMaquinas(db), [{ id: 'pc', nome: 'PC-NOVO', sistema: 'linux', visto_em: 't3', agentes: 0 }])
    assert.throws(() => registrarMaquina(db, { ...OPCOES, maquina: 'PC' }), (falha) => falha instanceof NucleoError && falha.code === 'dados-invalidos')
  })
})

test('listarServidores entrega quem tem o modo servir nesta máquina, marca divergência e deixa o omni de fora', () => {
  comNucleo((db) => {
    const quieto = { ...minimo(), agente: 'quieto', executor: { comando: 'node q.mjs', modos: ['instalar'] } }
    const omni = { ...minimo(), agente: 'omni', executor: { comando: 'node runtime/servir.mjs', modos: ['servir'] } }
    for (const manifesto of [completo(), quieto, omni]) registrarAgente(db, bytes(manifesto), { ...OPCOES, raiz: RAIZ })
    assert.deepEqual(listarServidores(db, { maquina: 'pc' }), [
      { agente: 'exemplo', raiz: RAIZ, comando: 'node executor/exemplo-executor.mjs', divergente: false, rotas: completo().interface.rotas }
    ])
    // Sem interface, sem rotas: o chamar recusa tudo desse agente.
    registrarAgente(db, bytes({ ...minimo(), agente: 'mudo', executor: { comando: 'node m.mjs', modos: ['servir'] } }), { ...OPCOES, raiz: RAIZ })
    assert.deepEqual(listarServidores(db, { maquina: 'pc' }).find((s) => s.agente === 'mudo').rotas, [])
    assert.deepEqual(listarServidores(db, { maquina: 'outra' }), [])
    // Outra máquina registra uma versão nova: o catálogo muda e a instalação daqui fica para trás.
    registrarAgente(db, bytes({ ...completo(), versao: '0.4.0' }), { ...OPCOES, maquina: 'outra', raiz: RAIZ, agora: 't1' })
    assert.deepEqual(listarServidores(db, { maquina: 'pc' }).map((s) => [s.agente, s.divergente]), [['exemplo', true], ['mudo', false]])
  })
})

test('listarInterfaces entrega os instalados com interface, sem o omni, com versão e divergência', () => {
  comNucleo((db) => {
    const semTela = { ...minimo(), agente: 'semtela', executor: { comando: 'node s.mjs', modos: ['servir'] } }
    const omni = { ...minimo(), agente: 'omni', interface: { modulo: 'x.html' } }
    const nua = { ...minimo(), agente: 'nua', interface: { modulo: 'tela/nua.html' } }
    for (const m of [completo(), semTela, omni, nua]) registrarAgente(db, bytes(m), { ...OPCOES, raiz: RAIZ })
    assert.deepEqual(listarInterfaces(db, { maquina: 'pc' }), [
      { agente: 'exemplo', versao: '0.3.0', raiz: RAIZ, modulo: 'interface/index.html', preload: 'interface/preload.js', painel: 'Exemplo', divergente: false },
      { agente: 'nua', versao: '0.1.0', raiz: RAIZ, modulo: 'tela/nua.html', preload: null, painel: null, divergente: false }
    ])
    assert.deepEqual(listarInterfaces(db, { maquina: 'outra' }), [])
    // Outra máquina registra uma versão nova: a tela daqui pode não ser a que o catálogo descreve.
    registrarAgente(db, bytes({ ...completo(), versao: '0.4.0' }), { ...OPCOES, maquina: 'outra', raiz: RAIZ, agora: 't1' })
    assert.deepEqual(listarInterfaces(db, { maquina: 'pc' }).map((i) => [i.agente, i.versao, i.divergente]), [['exemplo', '0.3.0', true], ['nua', '0.1.0', false]])
  })
})

test('listarTarefas entrega as tarefas dos instalados nesta máquina, com raiz e divergência', () => {
  comNucleo((db) => {
    // Um campo a mais na tarefa chamado agente ou raiz não engana o agendador sobre quem roda onde.
    const atrevido = { ...minimo(), agente: 'atrevido', tarefas: [{ id: 'x', comando: 'node x.mjs', quando: { acada: 'PT1H' }, seAtrasada: false, agente: 'outro', raiz: 'C:\\outra' }] }
    for (const m of [completo(), minimo(), atrevido]) registrarAgente(db, bytes(m), { ...OPCOES, raiz: RAIZ })
    const [visita, vigia] = completo().tarefas
    assert.deepEqual(listarTarefas(db, { maquina: 'pc' }), [
      { ...atrevido.tarefas[0], agente: 'atrevido', raiz: RAIZ, divergente: false },
      { ...visita, agente: 'exemplo', raiz: RAIZ, divergente: false },
      { ...vigia, agente: 'exemplo', raiz: RAIZ, divergente: false }
    ])
    assert.deepEqual(listarTarefas(db, { maquina: 'outra' }), [])
    registrarAgente(db, bytes({ ...completo(), versao: '0.4.0' }), { ...OPCOES, maquina: 'outra', raiz: RAIZ, agora: 't1' })
    assert.deepEqual(listarTarefas(db, { maquina: 'pc' }).map((t) => [t.agente, t.id, t.divergente]), [['atrevido', 'x', false], ['exemplo', 'visita', true], ['exemplo', 'vigia', true]])
  })
})