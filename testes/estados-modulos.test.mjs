import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import test from 'node:test'

import { prepararAtalhos } from '../runtime/atalhos.mjs'
import { lerAutoaperfeicoamento } from '../runtime/autoaperfeicoamento.mjs'
import { sincronizarAutomacaoFalhas } from '../runtime/automacao-falhas.mjs'
import { arquivoDoBanco, comBancoDaCasa, pastaDoBanco, sha256, sqliteDisponivel } from '../runtime/casa/banco.mjs'
import { baseNoDisco, shaDoEstado } from '../runtime/casa/loja-estados.mjs'
import { lerSeExistir } from '../runtime/casa/projecao.mjs'
import { registrarFalha } from '../runtime/falhas.mjs'
import { registrarUltimaRespostaPersonalidade } from '../runtime/feedback-personalidade.mjs'
import { registrarRecibo } from '../runtime/recibos-evolucao.mjs'

// Os donos chamam a ponte com process.env, sem como receber outro; o teste olha o banco com o
// mesmo env, e numa casa temporária a pasta do banco é <casa>\casa.
const ENV = process.env
const ANTIGO = new Date('2020-01-01T00:00:00Z')
const SEM_SQLITE = !sqliteDisponivel(ENV) && 'Node sem node:sqlite: a ponte fica só no arquivo'
const RECIBO = { kind: 'procedure', summary: 'procedimento valido', reason: 'motivo', revert: { strategy: 'contract-revert', ref: 'c1' } }
const IDENTIDADE = { personaId: 'omni-persona-v3-candidate', releaseFingerprint: 'a'.repeat(64) }
const casaNova = () => mkdtempSync(join(tmpdir(), 'omni-estados-modulos-'))
const apagar = (casa) => rmSync(casa, { recursive: true, force: true })
const arquivoDe = (casa, rel) => join(casa, ...rel.split('/'))
function degradacoes(casa) {
  const texto = lerSeExistir(join(pastaDoBanco(casa, ENV), 'degradacoes.jsonl'))
  return texto === null ? [] : texto.trim().split('\n').map((linha) => JSON.parse(linha).operacao)
}
const noBanco = (casa, rel) =>
  comBancoDaCasa(casa, 'omni', (db) => ({ sha: shaDoEstado(db, rel), base: baseNoDisco(db, rel) }), ENV)

// Primeira volta: a escrita do dono passa pelo omni.db (hash do banco e base iguais ao arquivo).
// Segunda volta: com o arquivo quebrado, a carga do dono socorre pelo banco e o dono segue.
async function provarModulo(rel, escrever) {
  const casa = casaNova()
  try {
    await escrever(casa)
    const arquivo = arquivoDe(casa, rel)
    assert.ok(existsSync(arquivoDoBanco(casa, 'omni', ENV)), 'o dono gravou sem passar pelo omni.db')
    const primeiro = noBanco(casa, rel)
    assert.equal(primeiro.sha, sha256(readFileSync(arquivo, 'utf8')))
    assert.equal(primeiro.base, primeiro.sha)
    writeFileSync(arquivo, 'xx{')
    await escrever(casa)
    const texto = readFileSync(arquivo, 'utf8')
    assert.doesNotThrow(() => JSON.parse(texto))
    const depois = noBanco(casa, rel)
    assert.equal(depois.sha, sha256(texto))
    assert.equal(depois.base, depois.sha)
    const prefixo = `${basename(arquivo)}.invalida.`
    assert.equal(readdirSync(dirname(arquivo)).filter((nome) => nome.startsWith(prefixo)).length, 1)
    assert.ok(degradacoes(casa).includes('estado.arquivo-invalido'))
  } finally {
    apagar(casa)
  }
}

test('falhas: registrarFalha grava pelo omni.db e socorre o arquivo quebrado', { skip: SEM_SQLITE }, async () => {
  let n = 0
  await provarModulo('learning/failures.json', (casa) => registrarFalha(casa, {
    agent: 'omni',
    action: 'consultar disponibilidade do banco',
    failureClass: 'dependency',
    signature: 'ECONNREFUSED ao abrir conexao do Postgres',
    evidenceId: `em-${++n}`
  }))
})

test('automação de falhas: sincronizarAutomacaoFalhas grava pelo omni.db e socorre o arquivo quebrado', { skip: SEM_SQLITE }, () =>
  provarModulo('learning/failure-automation.json', (casa) => sincronizarAutomacaoFalhas(casa)))

test('autoaperfeiçoamento: lerAutoaperfeicoamento grava pelo omni.db e socorre o arquivo quebrado', { skip: SEM_SQLITE }, () =>
  provarModulo('learning/self-improvement.json', (casa) => lerAutoaperfeicoamento(casa)))

test('atalhos: prepararAtalhos grava pelo omni.db e socorre o arquivo quebrado', { skip: SEM_SQLITE }, () =>
  provarModulo('learning/shortcuts.json', (casa) => prepararAtalhos(casa)))

test('recibos: registrarRecibo grava pelo omni.db e socorre o arquivo quebrado', { skip: SEM_SQLITE }, () =>
  provarModulo('learning/evolution-receipts.json', (casa) => registrarRecibo(casa, RECIBO)))

test('feedback: registrarUltimaRespostaPersonalidade grava pelo omni.db e socorre o arquivo quebrado', { skip: SEM_SQLITE }, () =>
  provarModulo('feedback/personality-feedback.json', (casa) =>
    registrarUltimaRespostaPersonalidade(casa, { sessionId: 'sessao-em', answer: 'resposta do omni', ...IDENTIDADE })))

test('recibos: a escrita espera a trava presa', async () => {
  const casa = casaNova()
  try {
    const trava = join(casa, 'learning', 'evolution-receipts.lock')
    mkdirSync(dirname(trava), { recursive: true })
    writeFileSync(trava, '')
    let terminou = false
    const escrita = registrarRecibo(casa, RECIBO).then((recibo) => { terminou = true; return recibo })
    await new Promise((resolver) => setTimeout(resolver, 150))
    assert.equal(terminou, false, 'registrarRecibo passou por cima da trava')
    rmSync(trava)
    const recibo = await escrita
    assert.equal(existsSync(trava), false, 'a trava ficou no disco depois da escrita')
    const store = JSON.parse(readFileSync(join(casa, 'learning', 'evolution-receipts.json'), 'utf8'))
    assert.deepEqual(store.receipts.map((item) => item.id), [recibo.id])
  } finally {
    apagar(casa)
  }
})

test('recibos: trava velha é apagada e a escrita segue', async () => {
  const casa = casaNova()
  try {
    const trava = join(casa, 'learning', 'evolution-receipts.lock')
    mkdirSync(dirname(trava), { recursive: true })
    writeFileSync(trava, '')
    utimesSync(trava, ANTIGO, ANTIGO)
    await assert.doesNotReject(registrarRecibo(casa, RECIBO))
    assert.equal(existsSync(trava), false, 'a trava velha ficou no disco')
  } finally {
    apagar(casa)
  }
})
