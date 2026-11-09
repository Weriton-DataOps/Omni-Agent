import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { registrarDegradacao } from '../runtime/casa/banco.mjs'
import { LIMITE_LEITURA, lerDegradacoes } from '../runtime/casa/degradacoes.mjs'

// Casa temporária e env vazio: o registro mora em <casa>\casa e a casa real nunca é tocada.
async function comCasa(uso) {
  const casa = mkdtempSync(join(tmpdir(), 'omni-degradacoes-'))
  try { await uso(casa) } finally { rmSync(casa, { recursive: true, force: true }) }
}
const registroDa = (casa) => join(casa, 'casa', 'degradacoes.jsonl')
function gravar(arquivo, linhas) {
  mkdirSync(dirname(arquivo), { recursive: true })
  writeFileSync(arquivo, linhas.map((linha) => `${typeof linha === 'string' ? linha : JSON.stringify(linha)}\n`).join(''))
}
const AGORA = new Date('2026-11-08T12:00:00.000Z')
const vazio = (registro, codigo = null) => ({ registro, codigo, bytes: 0, truncado: false, linhas: 0, linhasInvalidas: 0, nas24h: 0, ultimaEm: null, operacoes: [] })

test('registro ausente devolve o resumo vazio e nao cria a pasta do banco', () => comCasa(async (casa) => {
  assert.deepEqual(await lerDegradacoes(casa, {}), vazio('ausente'))
  assert.deepEqual(readdirSync(casa), [])
}))

test('resume por operacao com a ultima falha de cada uma e as das ultimas 24 horas', () => comCasa(async (casa) => {
  gravar(registroDa(casa), [
    { em: '2026-11-08T09:00:00.000Z', operacao: 'estado.gravar', codigo: null, erro: 'disco cheio' },
    { em: '2026-11-06T10:00:00.000Z', operacao: 'memoria.carregar', codigo: 'SQLITE_BUSY', erro: 'database is locked' },
    { em: '2026-11-08T11:00:00.000Z', operacao: 'memoria.carregar', codigo: 'SQLITE_CANTOPEN', erro: 'unable to open database file' },
    { em: '2026-11-07T11:59:59.999Z', operacao: 'estado.gravar', codigo: 'ENOSPC', erro: 'sem espaco' },
    { em: '2026-11-07T12:00:00.000Z', operacao: 'estado.gravar', codigo: 'ENOSPC', erro: 'sem espaco' },
    { em: '2026-11-08T11:00:00.000Z', operacao: 'memoria.carregar', codigo: 'SQLITE_BUSY', erro: 'database is locked' }
  ])
  assert.deepEqual(await lerDegradacoes(casa, {}, { agora: AGORA }), {
    registro: 'presente', codigo: null, bytes: statSync(registroDa(casa)).size, truncado: false,
    linhas: 6, linhasInvalidas: 0, nas24h: 4, ultimaEm: '2026-11-08T11:00:00.000Z',
    operacoes: [
      { operacao: 'memoria.carregar', total: 3, nas24h: 2, primeiraEm: '2026-11-06T10:00:00.000Z', ultimaEm: '2026-11-08T11:00:00.000Z', ultimoCodigo: 'SQLITE_BUSY', ultimoErro: 'database is locked' },
      { operacao: 'estado.gravar', total: 3, nas24h: 2, primeiraEm: '2026-11-07T11:59:59.999Z', ultimaEm: '2026-11-08T09:00:00.000Z', ultimoCodigo: null, ultimoErro: 'disco cheio' }
    ]
  })
}))

test('le o que o registrarDegradacao grava, sem trecho do texto lido', () => comCasa(async (casa) => {
  registrarDegradacao(casa, 'memoria.carregar', Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' }), {})
  let quebra
  try { JSON.parse('{"segredo-ficticio": ') } catch (erro) { quebra = erro }
  registrarDegradacao(casa, 'estado.gravar', quebra, {})
  // Uma linha antiga que só fica fora das 24 horas se o relógio padrão for o de agora.
  writeFileSync(registroDa(casa), `${JSON.stringify({ em: '2020-01-01T00:00:00.000Z', operacao: 'nucleo.cli', codigo: null, erro: 'antiga' })}\n`, { flag: 'a' })
  const resumo = await lerDegradacoes(casa, {})
  assert.deepEqual([resumo.registro, resumo.linhas, resumo.linhasInvalidas, resumo.nas24h], ['presente', 3, 0, 2])
  const porNome = resumo.operacoes.map(({ operacao, total, ultimoCodigo, ultimoErro }) => ({ operacao, total, ultimoCodigo, ultimoErro }))
  porNome.sort((a, b) => a.operacao.localeCompare(b.operacao))
  assert.deepEqual(porNome, [
    { operacao: 'estado.gravar', total: 1, ultimoCodigo: null, ultimoErro: 'JSON inválido' },
    { operacao: 'memoria.carregar', total: 1, ultimoCodigo: 'SQLITE_BUSY', ultimoErro: 'database is locked' },
    { operacao: 'nucleo.cli', total: 1, ultimoCodigo: null, ultimoErro: 'antiga' }
  ])
  assert.equal(JSON.stringify(resumo).includes('segredo-ficticio'), false)
}))

test('linha fora do formato do gravador conta como invalida e nada alem dos quatro campos sai', () => comCasa(async (casa) => {
  const opLonga = `a.${'b'.repeat(58)}`
  gravar(registroDa(casa), [
    '{quebrado',
    '[1]',
    'null',
    { em: 'ontem', operacao: 'memoria.carregar', codigo: null, erro: '' },
    { em: '2026-13-01T00:00:00.000Z', operacao: 'memoria.carregar', codigo: null, erro: '' },
    { em: '2026-11-08T10:00:00Z', operacao: 'memoria.carregar', codigo: null, erro: '' },
    { em: '2026-11-08T10:00:00.000Z', operacao: 'Memoria.carregar', codigo: null, erro: '' },
    { em: '2026-11-08T10:00:00.000Z', operacao: 'memoria', codigo: null, erro: '' },
    { em: '2026-11-08T10:00:00.000Z', operacao: `${opLonga}b`, codigo: null, erro: '' },
    { em: '2026-11-08T10:00:00.000Z', operacao: ['estado.gravar'], codigo: null, erro: '' },
    '',
    '   ',
    { em: '2026-11-08T10:00:00.000Z', operacao: 'estado.gravar', codigo: 'minusculo', erro: 'x'.repeat(400), trecho: 'segredo-ficticio' },
    { em: '2026-11-08T09:00:00.000Z', operacao: 'estado.copia', codigo: ['SQLITE_BUSY'], erro: { texto: 'segredo-ficticio' } },
    { em: '2026-11-08T08:00:00.000Z', operacao: opLonga, codigo: `S${'Q'.repeat(39)}`, erro: 'ok' },
    { em: '2026-11-08T07:00:00.000Z', operacao: 'estado.projetar', codigo: `E${'X'.repeat(40)}`, erro: 'longo' }
  ])
  // Linha ruim nunca derruba a leitura: ela só é contada.
  const leitura = lerDegradacoes(casa, {}, { agora: AGORA })
  await assert.doesNotReject(leitura)
  const resumo = await leitura
  assert.deepEqual([resumo.linhas, resumo.linhasInvalidas, resumo.nas24h, resumo.ultimaEm], [4, 10, 4, '2026-11-08T10:00:00.000Z'])
  const uma = (operacao, em, ultimoCodigo, ultimoErro) => ({ operacao, total: 1, nas24h: 1, primeiraEm: em, ultimaEm: em, ultimoCodigo, ultimoErro })
  assert.deepEqual(resumo.operacoes, [
    uma('estado.gravar', '2026-11-08T10:00:00.000Z', null, 'x'.repeat(300)),
    uma('estado.copia', '2026-11-08T09:00:00.000Z', null, ''),
    uma(opLonga, '2026-11-08T08:00:00.000Z', `S${'Q'.repeat(39)}`, 'ok'),
    uma('estado.projetar', '2026-11-08T07:00:00.000Z', null, 'longo')
  ])
  const texto = JSON.stringify(resumo)
  assert.equal(texto.includes('segredo-ficticio') || texto.includes('quebrado'), false)
}))

test('registro maior que o limite le so a cauda e descarta a linha cortada', () => comCasa(async (casa) => {
  assert.equal(LIMITE_LEITURA, 256 * 1024)
  const linhas = [{ em: '2026-11-08T08:00:00.000Z', operacao: 'memoria.carregar', codigo: null, erro: 'x'.repeat(LIMITE_LEITURA) }]
  for (let i = 0; i < 3; i++) linhas.push({ em: `2026-11-08T1${i}:00:00.000Z`, operacao: 'estado.gravar', codigo: null, erro: `falha ${i}` })
  gravar(registroDa(casa), linhas)
  const resumo = await lerDegradacoes(casa, {}, { agora: AGORA })
  assert.deepEqual([resumo.bytes, resumo.truncado, resumo.linhas, resumo.linhasInvalidas], [statSync(registroDa(casa)).size, true, 3, 0])
  assert.deepEqual(resumo.operacoes.map(({ operacao, total, ultimoErro }) => [operacao, total, ultimoErro]), [['estado.gravar', 3, 'falha 2']])
}))

test('cauda que comeca no inicio de uma linha nao perde essa linha', () => comCasa(async (casa) => {
  const TAMANHO = 128
  assert.equal(LIMITE_LEITURA % TAMANHO, 0)
  const base = { em: '2026-11-08T10:00:00.000Z', operacao: 'estado.gravar', codigo: null }
  const vaga = TAMANHO - 1 - JSON.stringify({ ...base, erro: '' }).length
  const linhas = [{ em: '2026-11-08T09:00:00.000Z', operacao: 'memoria.carregar', codigo: null, erro: 'antes da cauda' }]
  for (let i = 0; i < LIMITE_LEITURA / TAMANHO; i++) linhas.push({ ...base, erro: String(i).padStart(vaga, '0') })
  gravar(registroDa(casa), linhas)
  const resumo = await lerDegradacoes(casa, {}, { agora: AGORA })
  assert.deepEqual([resumo.truncado, resumo.linhas, resumo.linhasInvalidas], [true, LIMITE_LEITURA / TAMANHO, 0])
  assert.deepEqual(resumo.operacoes.map(({ operacao, total }) => [operacao, total]), [['estado.gravar', LIMITE_LEITURA / TAMANHO]])
}))

test('ultima linha maior que o limite e sem quebra nao vira linha invalida', () => comCasa(async (casa) => {
  gravar(registroDa(casa), [{ em: '2026-11-08T09:00:00.000Z', operacao: 'memoria.carregar', codigo: null, erro: 'inteira' }])
  writeFileSync(registroDa(casa), 'x'.repeat(LIMITE_LEITURA + 10), { flag: 'a' })
  assert.deepEqual(await lerDegradacoes(casa, {}, { agora: AGORA }),
    { ...vazio('presente'), bytes: statSync(registroDa(casa)).size, truncado: true })
}))

test('registro que nao e arquivo fica ilegivel e a leitura nao lanca', () => comCasa(async (casa) => {
  mkdirSync(registroDa(casa), { recursive: true })
  assert.deepEqual(await lerDegradacoes(casa, {}), vazio('ilegivel', 'EISDIR'))
}))

test('OMNI_CASA_BANCO aponta a pasta do registro', () => comCasa(async (casa) => {
  const outra = join(casa, 'outra')
  gravar(join(outra, 'degradacoes.jsonl'), [{ em: '2026-11-08T09:00:00.000Z', operacao: 'cofre.cli', codigo: null, erro: 'falha' }])
  const resumo = await lerDegradacoes(casa, { OMNI_CASA_BANCO: outra }, { agora: AGORA })
  assert.deepEqual([resumo.registro, resumo.linhas, resumo.operacoes.map((op) => op.operacao)], ['presente', 1, ['cofre.cli']])
  assert.equal((await lerDegradacoes(casa, {})).registro, 'ausente')
}))
