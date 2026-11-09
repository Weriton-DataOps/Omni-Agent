import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { comBancoDaCasa } from '../runtime/casa/banco.mjs'
import {
  encerrarMissoesPodadas,
  gravarAchados,
  gravarMissoes,
  importarDoPostgres,
  listarMissoesAtivas,
  verificarImportacao
} from '../runtime/casa/loja-operacao.mjs'

const MAQ = 'maquina-teste'
const h = (texto) => createHash('sha256').update(texto).digest('hex')
const md5 = (texto) => createHash('md5').update(texto).digest('hex')

// Casa temporária com o banco dentro dela; env vazio para nenhum OMNI_CASA_BANCO desviar o banco.
function comCasa(uso) {
  const casa = mkdtempSync(join(tmpdir(), 'omni-loja-operacao-'))
  try {
    return comBancoDaCasa(casa, 'omni', uso, {})
  } finally {
    rmSync(casa, { recursive: true, force: true })
  }
}

function missao(extra = {}) {
  return {
    id: 'mission-a1',
    objective: 'fechar a F2',
    state: 'in-progress',
    priority: 70,
    payload: { sessionId: 'session-a1', currentStep: 'plano 1' },
    createdAt: '2026-11-09T10:00:00.000Z',
    updatedAt: '2026-11-09T11:00:00.000Z',
    closedAt: null,
    ...extra
  }
}

function achado(extra = {}) {
  return {
    eventId: `learning-event-${'a'.repeat(32)}`,
    findingId: 'improvement-x1',
    candidateFingerprint: h('cand'),
    category: 'routing',
    destination: 'procedure',
    state: 'observing',
    occurrences: 2,
    statementFingerprint: h('enunciado'),
    sourceFingerprint: h('fonte'),
    artifactFingerprint: null,
    releaseVersion: '0.26.2',
    observedAt: '2026-11-09T11:00:00.000Z',
    ...extra
  }
}

const eventosDe = (db, id) => db.prepare('SELECT id, tipo FROM missao_eventos WHERE missao_id = ? ORDER BY em').all(id).map((linha) => ({ ...linha }))
const linhaMissao = (db, id) => ({ ...db.prepare('SELECT estado, versao, atualizado_em, fechada_em FROM missoes WHERE id = ?').get(id) })

test('v4 do omni.db: quatro tabelas e o vínculo entre estado fechado e fechada_em', () => {
  comCasa((db) => {
    assert.ok(db.prepare('SELECT 1 FROM _migracoes WHERE versao = 4').get(), 'v4 aplicada')
    for (const tabela of ['missoes', 'missao_eventos', 'aprendizado_achados', 'aprendizado_eventos']) {
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tabela), tabela)
    }
    assert.throws(() => db.prepare(`INSERT INTO missoes (id, objetivo, estado, prioridade, corpo, fechada_em, origem_maquina, criado_em, atualizado_em)
      VALUES ('mission-z', 'xyz', 'completed', 1, '{}', NULL, 'm', 't', 't')`).run(), /CHECK/)
  })
})

test('gravarMissoes: insere com evento, duplicata não mexe, mais nova atualiza, mais velha é ignorada', () => {
  comCasa((db) => {
    assert.deepEqual(gravarMissoes(db, [missao()], { maquina: MAQ }), { aplicadas: 1, duplicadas: 0, invalidas: 0 })
    assert.deepEqual(eventosDe(db, 'mission-a1'), [{ id: `mission-event-${md5('mission-a1' + '2026-11-09T11:00:00.000Z')}`, tipo: 'resumed' }])
    assert.equal(linhaMissao(db, 'mission-a1').versao, 1)

    assert.deepEqual(gravarMissoes(db, [missao()], { maquina: MAQ }), { aplicadas: 0, duplicadas: 1, invalidas: 0 })
    assert.equal(linhaMissao(db, 'mission-a1').versao, 1)
    assert.equal(eventosDe(db, 'mission-a1').length, 1)

    const fechada = missao({ state: 'completed', updatedAt: '2026-11-09T12:00:00.000Z', closedAt: '2026-11-09T12:00:00.000Z' })
    assert.deepEqual(gravarMissoes(db, [fechada], { maquina: MAQ }), { aplicadas: 1, duplicadas: 0, invalidas: 0 })
    assert.deepEqual(linhaMissao(db, 'mission-a1'), { estado: 'completed', versao: 2, atualizado_em: '2026-11-09T12:00:00.000Z', fechada_em: '2026-11-09T12:00:00.000Z' })
    assert.deepEqual(eventosDe(db, 'mission-a1').map((e) => e.tipo), ['resumed', 'completed'])

    assert.deepEqual(gravarMissoes(db, [missao({ updatedAt: '2026-11-09T10:30:00.000Z' })], { maquina: MAQ }), { aplicadas: 0, duplicadas: 1, invalidas: 0 })
    assert.equal(linhaMissao(db, 'mission-a1').estado, 'completed')
  })
})

test('gravarMissoes: datas em outro formato viram ISO com Z antes de comparar', () => {
  comCasa((db) => {
    gravarMissoes(db, [missao({ updatedAt: '2026-11-09T08:00:00-03:00' })], { maquina: MAQ })
    assert.equal(linhaMissao(db, 'mission-a1').atualizado_em, '2026-11-09T11:00:00.000Z')
    assert.deepEqual(gravarMissoes(db, [missao()], { maquina: MAQ }), { aplicadas: 0, duplicadas: 1, invalidas: 0 })
  })
})

test('gravarMissoes: missão inválida conta e não derruba o lote', () => {
  comCasa((db) => {
    const lote = [missao({ id: 'tarefa-1' }), missao({ id: 'mission-b', objective: 'xy' }), missao({ id: 'mission-c', state: 'completed', closedAt: null }), missao({ id: 'mission-d' })]
    assert.deepEqual(gravarMissoes(db, lote, { maquina: MAQ }), { aplicadas: 1, duplicadas: 0, invalidas: 3 })
  })
})

test('listarMissoesAtivas: só ativas, por prioridade e depois pela mais recente, no formato do broker', () => {
  comCasa((db) => {
    gravarMissoes(db, [
      missao({ id: 'mission-baixa', priority: 10 }),
      missao({ id: 'mission-velha', updatedAt: '2026-11-09T10:30:00.000Z' }),
      missao({ id: 'mission-nova' }),
      missao({ id: 'mission-feita', state: 'completed', closedAt: '2026-11-09T11:00:00.000Z' }),
      missao({ id: 'mission-parada', state: 'blocked', priority: 90 })
    ], { maquina: MAQ })
    const ativas = listarMissoesAtivas(db)
    assert.deepEqual(ativas.map((m) => m.id), ['mission-parada', 'mission-nova', 'mission-velha', 'mission-baixa'])
    assert.deepEqual(ativas[1], {
      id: 'mission-nova', objective: 'fechar a F2', state: 'in-progress', priority: 70,
      payload: { sessionId: 'session-a1', currentStep: 'plano 1' },
      createdAt: '2026-11-09T10:00:00.000Z', updatedAt: '2026-11-09T11:00:00.000Z', closedAt: null
    })
    assert.equal(listarMissoesAtivas(db, 2).length, 2)
  })
})

test('encerrarMissoesPodadas: cancela só a ativa podada, com evento reconciled', () => {
  comCasa((db) => {
    gravarMissoes(db, [
      missao({ id: 'mission-podada', createdAt: '2026-10-01T00:00:00.000Z' }),
      missao({ id: 'mission-viva', createdAt: '2026-10-01T00:00:00.000Z' }),
      missao({ id: 'mission-recente', createdAt: '2026-11-09T09:00:00.000Z' })
    ], { maquina: MAQ })
    const agora = '2026-11-09T13:00:00.000Z'
    const r = encerrarMissoesPodadas(db, { idsVivos: ['mission-viva'], maisAntiga: '2026-11-01T00:00:00.000Z', agora, maquina: MAQ })
    assert.deepEqual(r, { encerradas: 1 })
    assert.deepEqual(linhaMissao(db, 'mission-podada'), { estado: 'cancelled', versao: 2, atualizado_em: agora, fechada_em: agora })
    assert.deepEqual(eventosDe(db, 'mission-podada').map((e) => e.tipo), ['resumed', 'reconciled'])
    assert.equal(linhaMissao(db, 'mission-viva').estado, 'in-progress')
    assert.equal(linhaMissao(db, 'mission-recente').estado, 'in-progress')
  })
})

test('encerrarMissoesPodadas: ciclo vazio (máquina nova) não toca em nada', () => {
  comCasa((db) => {
    gravarMissoes(db, [missao({ createdAt: '2026-10-01T00:00:00.000Z' })], { maquina: MAQ })
    assert.deepEqual(encerrarMissoesPodadas(db, { idsVivos: [], maisAntiga: null, agora: '2026-11-09T13:00:00.000Z', maquina: MAQ }), { encerradas: 0 })
    assert.equal(linhaMissao(db, 'mission-a1').estado, 'in-progress')
  })
})

test('gravarAchados: registra, duplica pelo eventId, avança com o mais novo e não regride com o mais velho', () => {
  comCasa((db) => {
    const linha = () => ({ ...db.prepare('SELECT estado, ocorrencias, versao, primeiro_visto_em, ultimo_visto_em FROM aprendizado_achados WHERE id = ?').get('improvement-x1') })
    const eventos = () => db.prepare('SELECT COUNT(*) AS n FROM aprendizado_eventos').get().n

    assert.deepEqual(gravarAchados(db, [achado()], { maquina: MAQ }), { registrados: 1, duplicados: 0, invalidos: 0 })
    assert.deepEqual(gravarAchados(db, [achado()], { maquina: MAQ }), { registrados: 0, duplicados: 1, invalidos: 0 })
    assert.equal(eventos(), 1)

    gravarAchados(db, [achado({ eventId: `learning-event-${'b'.repeat(32)}`, state: 'ready', occurrences: 3, observedAt: '2026-11-09T12:00:00.000Z' })], { maquina: MAQ })
    assert.deepEqual(linha(), { estado: 'ready', ocorrencias: 3, versao: 2, primeiro_visto_em: '2026-11-09T11:00:00.000Z', ultimo_visto_em: '2026-11-09T12:00:00.000Z' })

    assert.deepEqual(gravarAchados(db, [achado({ eventId: `learning-event-${'c'.repeat(32)}`, state: 'observing', observedAt: '2026-11-09T10:00:00.000Z' })], { maquina: MAQ }), { registrados: 1, duplicados: 0, invalidos: 0 })
    assert.equal(eventos(), 3)
    assert.deepEqual(linha(), { estado: 'ready', ocorrencias: 3, versao: 2, primeiro_visto_em: '2026-11-09T11:00:00.000Z', ultimo_visto_em: '2026-11-09T12:00:00.000Z' })
  })
})

test('gravarAchados: achado inválido conta e não derruba o lote', () => {
  comCasa((db) => {
    const lote = [achado({ eventId: 'learning-event-xyz' }), achado({ destination: 'qualquer' }), achado({ occurrences: 0 }), achado({ releaseVersion: 'v1' }), achado()]
    assert.deepEqual(gravarAchados(db, lote, { maquina: MAQ }), { registrados: 1, duplicados: 0, invalidos: 4 })
  })
})

function dump() {
  return {
    missoes: [
      { ...missao({ id: 'mission-pg1', state: 'completed', closedAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', createdAt: '2026-10-30T00:00:00.000Z' }), version: 4 },
      { ...missao({ id: 'mission-pg2', updatedAt: '2026-11-02T00:00:00.000Z', createdAt: '2026-11-02T00:00:00.000Z' }), version: 1 }
    ],
    missaoEventos: [
      { id: 'mission-event-1', missionId: 'mission-pg1', kind: 'created', observedAt: '2026-10-30T00:00:00.000Z', payload: {} },
      { id: 'mission-event-2', missionId: 'mission-pg1', kind: 'completed', observedAt: '2026-11-01T00:00:00.000Z', payload: {} },
      { id: 'mission-event-3', missionId: 'mission-pg2', kind: 'resumed', observedAt: '2026-11-02T00:00:00.000Z', payload: {} }
    ],
    achados: [{
      findingId: 'improvement-pg', candidateFingerprint: h('c'), category: 'routing', destination: 'hook', state: 'ready', occurrences: 5,
      statementFingerprint: h('s'), sourceFingerprint: h('f'), artifactFingerprint: null, releaseVersion: null,
      firstObservedAt: '2026-10-01T00:00:00.000Z', lastObservedAt: '2026-11-01T00:00:00.000Z'
    }],
    achadoEventos: [{
      eventId: `learning-event-${'d'.repeat(32)}`, findingId: 'improvement-pg', observedAt: '2026-11-01T00:00:00.000Z', state: 'ready', occurrences: 5,
      sourceFingerprint: h('f'), artifactFingerprint: null, releaseVersion: null
    }],
    memorias: ['mem-1', 'mem-2']
  }
}

test('importarDoPostgres: 1ª vez traz tudo e registra a importação; 2ª vez não traz nada', () => {
  comCasa((db) => {
    const primeira = importarDoPostgres(db, dump(), { fonte: 'dump.json', fonteSha256: h('dump'), maquina: MAQ })
    assert.deepEqual(primeira, { missoes: 2, missaoEventos: 3, achados: 1, achadoEventos: 1, invalidas: 0 })
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM _importacoes WHERE tipo = 'postgres-5433'").get().n, 1)
    assert.equal(linhaMissao(db, 'mission-pg1').versao, 4)
    assert.deepEqual(eventosDe(db, 'mission-pg1').map((e) => e.id), ['mission-event-1', 'mission-event-2'])

    const segunda = importarDoPostgres(db, dump(), { fonte: 'dump.json', fonteSha256: h('dump'), maquina: MAQ })
    assert.deepEqual(segunda, { missoes: 0, missaoEventos: 0, achados: 0, achadoEventos: 0, invalidas: 0 })
  })
})

test('importarDoPostgres: missão local mais nova não é sobrescrita pelo dump', () => {
  comCasa((db) => {
    gravarMissoes(db, [missao({ id: 'mission-pg2', updatedAt: '2026-11-05T00:00:00.000Z', createdAt: '2026-11-02T00:00:00.000Z' })], { maquina: MAQ })
    importarDoPostgres(db, dump(), { fonte: 'dump.json', fonteSha256: h('dump'), maquina: MAQ })
    assert.equal(linhaMissao(db, 'mission-pg2').atualizado_em, '2026-11-05T00:00:00.000Z')
  })
})

test('verificarImportacao: zero faltando depois de importar; apagar uma linha acusa', () => {
  comCasa((db) => {
    db.prepare(`INSERT INTO memorias (id, raia, ordem, corpo, origem_maquina, criado_em, atualizado_em) VALUES ('mem-1', 'confirmed', 0, '{}', 'm', 't', 't')`).run()
    importarDoPostgres(db, dump(), { fonte: 'dump.json', fonteSha256: h('dump'), maquina: MAQ })
    const ok = verificarImportacao(db, dump())
    assert.equal(ok.ok, true)
    assert.deepEqual(ok.tabelas.missoes, { esperadas: 2, faltando: 0, atrasadas: 0 })
    assert.deepEqual(ok.tabelas.missaoEventos, { esperadas: 3, faltando: 0, atrasadas: 0 })
    assert.deepEqual(ok.tabelas.achados, { esperadas: 1, faltando: 0, atrasadas: 0 })
    assert.deepEqual(ok.tabelas.achadoEventos, { esperadas: 1, faltando: 0, atrasadas: 0 })
    assert.equal(ok.memoriasSoNoPostgres, 1)

    db.prepare("DELETE FROM missao_eventos WHERE id = 'mission-event-3'").run()
    db.prepare("UPDATE aprendizado_achados SET ultimo_visto_em = '2026-10-15T00:00:00.000Z' WHERE id = 'improvement-pg'").run()
    const ruim = verificarImportacao(db, dump())
    assert.equal(ruim.ok, false)
    assert.equal(ruim.tabelas.missaoEventos.faltando, 1)
    assert.equal(ruim.tabelas.achados.atrasadas, 1)
  })
})
