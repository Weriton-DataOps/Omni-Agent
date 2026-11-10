// Plano 4c, T4: o card do WhatsApp só fica verde com os dois números pareados e o pessoal provado só
// leitura. Numa máquina nova a sonda não vê sessão nenhuma (a chave de leitura nasce no "fechar"), então a
// vista decide primeiro pelos arquivos (sessao.id, sessao-bot.id, pareamento.json) e a sonda confirma.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { vistaPareamento } = require('../apps/omni-ilha/whatsapp-vista.js')

const provado = { em: '2026-11-10T10:00:00Z', pessoal: { fone4: '1234' }, bot: { fone4: '5678' }, soLeitura: { ok: true, recusas: 5, falhas: [] } }
const sessoes = (pessoal, bot, fone = '1234') => ({ sessoes: { pessoal: { status: pessoal, fone }, bot: { status: bot, fone: '5678' } } })
const w = (extra) => ({ instalado: true, servico: true, ponte: true, ids: { pessoal: true, bot: true }, pareamento: provado, saude: sessoes('ready', 'ready'), ...extra })

const casos = [
  ['não instalado', { instalado: false }, 'ausente', null],
  ['serviço parado', { servico: false }, 'sem-servico', null],
  ['sem sessao.id', { ids: { pessoal: false, bot: false }, pareamento: null, saude: null }, 'falta-pessoal', 'parear'],
  ['só o pessoal', { ids: { pessoal: true, bot: false }, pareamento: null, saude: null }, 'falta-bot', 'parear'],
  ['os dois, sem pareamento.json', { pareamento: null, saude: null }, 'falta-prova', 'parear'],
  ['pareamento.json não provado', { pareamento: { ...provado, soLeitura: { ok: false, recusas: 4, falhas: ['[envio pela sessão pessoal]'] } } }, 'falta-prova', 'parear'],
  ['provado e a sonda ainda sem ler', { saude: null }, 'conferindo', null],
  ['provado, pessoal caiu', { saude: sessoes('disconnected', 'ready') }, 'falta-pessoal', 'parear'],
  ['provado, bot caiu', { saude: sessoes('ready', 'failed') }, 'falta-bot', 'parear'],
  ['os dois caíram: o pessoal vem primeiro', { saude: sessoes('disconnected', 'disconnected') }, 'falta-pessoal', 'parear'],
  ['pessoal trocado depois da prova', { saude: sessoes('ready', 'ready', '9999') }, 'falta-prova', 'parear'],
  ['tudo certo', {}, 'pareado', null],
]
for (const [nome, extra, estado, acao] of casos) {
  test(`vista: ${nome} → ${estado}`, () => {
    const v = vistaPareamento(w(extra))
    assert.equal(v.estado, estado)
    assert.equal(v.acao, acao)
    assert.equal(typeof v.texto, 'string')
    if (estado !== 'pareado') assert.ok(v.texto.length > 0, 'estado sem texto')
  })
}

test('textos dizem o passo: 1 de 2 e 2 de 2', () => {
  assert.match(vistaPareamento(w({ ids: { pessoal: false, bot: false }, pareamento: null, saude: null })).texto, /1 de 2/)
  assert.match(vistaPareamento(w({ ids: { pessoal: true, bot: false }, pareamento: null, saude: null })).texto, /2 de 2/)
})

test('lerWhatsapp devolve ids e pareamento lidos da pasta do WhatsApp', () => {
  const appdata = mkdtempSync(join(tmpdir(), 'omni-p4c-vista-'))
  const anterior = process.env.APPDATA
  try {
    const run = join(appdata, 'omni', 'whatsapp')
    mkdirSync(run, { recursive: true })
    // saude.json fresca: a ilha não dispara a sonda (que leria o cofre e o serviço de verdade)
    writeFileSync(join(run, 'saude.json'), JSON.stringify({ em: new Date().toISOString() }))
    writeFileSync(join(run, 'sessao.id'), 's1')
    writeFileSync(join(run, 'pareamento.json'), JSON.stringify(provado))
    process.env.APPDATA = appdata
    const caminho = require.resolve('../apps/omni-ilha/whatsapp.js')
    delete require.cache[caminho]
    const { lerWhatsapp } = require(caminho)
    writeFileSync(join(run, 'servico.pid'), '4242')
    const r = lerWhatsapp([{ pid: 4242, nome: 'node.exe' }])
    assert.deepEqual(r.ids, { pessoal: true, bot: false })
    assert.deepEqual(r.pareamento, provado)
    // o renderer não tem require: a vista já chega pronta do processo principal
    assert.equal(r.vista.estado, 'falta-bot')
    assert.equal(lerWhatsapp([]).vista.estado, 'sem-servico')
    writeFileSync(join(run, 'pareamento.json'), '{quebrado')
    assert.equal(lerWhatsapp([]).pareamento, null)
  } finally {
    process.env.APPDATA = anterior
    rmSync(appdata, { recursive: true, force: true })
  }
})
