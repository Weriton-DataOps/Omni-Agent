import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  lerRecibos,
  marcarRevertido,
  registrarRecibo,
  vetarRecibo
} from '../runtime/recibos-evolucao.mjs'
import { INSTRUCAO_REVERSAO_GIT, reverterRecibo } from '../runtime/reversao-recibos.mjs'
import { lembrarExplicitamente, lerMemoria } from '../runtime/memoria.mjs'

async function casaTemp() {
  return mkdtemp(join(tmpdir(), 'omni-veto-'))
}

test('memory-unconfirm arquiva a memoria confirmada e fecha o recibo', async () => {
  const casa = await casaTemp()
  try {
    const mem = await lembrarExplicitamente(casa, 'prefiro relatorios curtos com uma analogia concreta')
    const recibo = await registrarRecibo(casa, {
      kind: 'memory-confirm',
      summary: 'auto-confirmei preferencia de relatorios',
      reason: 'duas ocorrencias sem contraevidencia',
      subjectId: mem.memory.id,
      revert: { strategy: 'memory-unconfirm', ref: mem.memory.id }
    })
    const veto = await vetarRecibo(casa, recibo.id)
    assert.equal(veto.result, 'vetoed')

    const reversal = await reverterRecibo(casa, veto.recibo, { pluginRoot: casa, repoRoot: casa })
    assert.equal(reversal.strategy, 'memory-unconfirm')
    assert.equal(reversal.reverted, true)

    assert.equal((await marcarRevertido(casa, recibo.id)).result, 'reverted')
    const memory = await lerMemoria(casa)
    assert.equal(memory.confirmed.length, 0)
    assert.ok(memory.archive.some((item) => item.memoryId === mem.memory.id && item.action === 'obsolete'))
    const store = await lerRecibos(casa)
    assert.equal(store.receipts[0].status, 'reverted')
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('personality-supersede usa o reversor injetado e fecha o ciclo', async () => {
  const casa = await casaTemp()
  try {
    const recibo = await registrarRecibo(casa, {
      kind: 'personality',
      summary: 'promovi a personalidade candidata apos gates verdes',
      reason: 'rodada controlada passou em todos os gates',
      revert: { strategy: 'personality-supersede', ref: 'omni-persona-v3-candidate' }
    })
    const chamadas = []
    const reversal = await reverterRecibo(casa, recibo, {
      pluginRoot: casa,
      deps: {
        reverterPersonalidade: async (root, ref) => {
          chamadas.push([root, ref])
          return { result: 'reverted', id: ref }
        }
      }
    })
    assert.equal(reversal.reverted, true)
    assert.equal(reversal.result, 'reverted')
    assert.deepEqual(chamadas, [[casa, 'omni-persona-v3-candidate']])
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('personality-supersede sem contrato da candidata exige reversao manual', async () => {
  const casa = await casaTemp()
  try {
    const recibo = await registrarRecibo(casa, {
      kind: 'personality',
      summary: 'promovi a personalidade candidata',
      reason: 'gates verdes',
      revert: { strategy: 'personality-supersede', ref: 'omni-persona-v2-candidate' }
    })
    const reversal = await reverterRecibo(casa, recibo, {
      pluginRoot: casa,
      deps: {
        reverterPersonalidade: async () => ({ result: 'manual-revert-required', reason: 'contrato-da-candidata-ausente' })
      }
    })
    assert.equal(reversal.reverted, false)
    assert.equal(reversal.result, 'manual-revert-required')
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})

test('capability-remove remove a skill e a entrada do catalogo de um repo temporario', async () => {
  const casa = await casaTemp()
  const repo = await casaTemp()
  try {
    await mkdir(join(repo, 'skills', 'relatorio-paginado'), { recursive: true })
    await writeFile(join(repo, 'skills', 'relatorio-paginado', 'SKILL.md'), '# skill de teste\n', 'utf8')
    await mkdir(join(repo, 'contratos', 'capacidades'), { recursive: true })
    await writeFile(
      join(repo, 'contratos', 'capacidades', 'catalogo.json'),
      `${JSON.stringify({ schemaVersion: 1, capabilities: [{ name: 'relatorio-paginado' }, { name: 'outra' }] }, null, 2)}\n`,
      'utf8'
    )
    const recibo = await registrarRecibo(casa, {
      kind: 'capability',
      summary: 'proposta de capacidade relatorio-paginado',
      reason: 'evidencia repetida em quatro execucoes',
      revert: { strategy: 'capability-remove', ref: 'relatorio-paginado' }
    })
    const reversal = await reverterRecibo(casa, recibo, { repoRoot: repo })
    assert.equal(reversal.result, 'removed')
    assert.equal(reversal.reverted, true)
    const catalog = JSON.parse(await readFile(join(repo, 'contratos', 'capacidades', 'catalogo.json'), 'utf8'))
    assert.deepEqual(catalog.capabilities.map((item) => item.name), ['outra'])
    await assert.rejects(stat(join(repo, 'skills', 'relatorio-paginado')))
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})

test('capability-remove sem skill materializada apenas encerra a proposta', async () => {
  const casa = await casaTemp()
  const repo = await casaTemp()
  try {
    await mkdir(join(repo, 'contratos', 'capacidades'), { recursive: true })
    await writeFile(
      join(repo, 'contratos', 'capacidades', 'catalogo.json'),
      `${JSON.stringify({ schemaVersion: 1, capabilities: [] }, null, 2)}\n`,
      'utf8'
    )
    const recibo = await registrarRecibo(casa, {
      kind: 'capability',
      summary: 'proposta de capacidade ainda nao admitida',
      reason: 'evidencia repetida',
      revert: { strategy: 'capability-remove', ref: 'ainda-nao-admitida' }
    })
    const reversal = await reverterRecibo(casa, recibo, { repoRoot: repo })
    assert.equal(reversal.result, 'nothing-to-remove')
    assert.equal(reversal.reverted, true)
  } finally {
    await rm(casa, { recursive: true, force: true })
    await rm(repo, { recursive: true, force: true })
  }
})

test('git-revert e contract-revert nao rodam git: devolvem o commit e a instrucao do portao humano', async () => {
  const casa = await casaTemp()
  try {
    for (const strategy of ['git-revert', 'contract-revert']) {
      const recibo = await registrarRecibo(casa, {
        kind: strategy === 'git-revert' ? 'operational-rule' : 'eval',
        summary: `incorporei via ${strategy}`,
        reason: 'evidencia repetida materializada',
        revert: { strategy, ref: 'contratos/operacao/regras-aprendidas.json#improvement-xyz' }
      })
      const reversal = await reverterRecibo(casa, recibo, { pluginRoot: casa, repoRoot: casa })
      assert.equal(reversal.reverted, false)
      assert.equal(reversal.result, 'manual-git-required')
      assert.equal(reversal.commit, 'contratos/operacao/regras-aprendidas.json#improvement-xyz')
      assert.equal(reversal.instruction, INSTRUCAO_REVERSAO_GIT)
    }
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
})
