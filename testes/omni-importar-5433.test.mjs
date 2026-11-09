import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const script = join(dirname(dirname(fileURLToPath(import.meta.url))), 'scripts', 'omni-importar-5433.mjs')

const missao = {
  id: 'mission-cli-1', objective: 'missão do dump', state: 'in-progress', priority: 70, payload: { sessionId: 'session-cli-1' },
  version: 3, createdAt: '2026-11-01T10:00:00+00:00', updatedAt: '2026-11-02T10:00:00+00:00', closedAt: null
}
const evento = { id: 'mission-event-cli-1', missionId: 'mission-cli-1', kind: 'created', observedAt: '2026-11-01T10:00:00+00:00', payload: {} }

async function rodar(dump) {
  const casa = await mkdtemp(join(tmpdir(), 'omni-importar-5433-'))
  try {
    const arquivo = join(casa, 'dump.json')
    await writeFile(arquivo, JSON.stringify(dump))
    const env = { ...process.env }
    delete env.OMNI_CASA_BANCO
    const r = spawnSync(process.execPath, [script, '--arquivo', arquivo, '--casa', casa], { env, encoding: 'utf8' })
    return { codigo: r.status, saida: r.stdout, erro: r.stderr, casa }
  } finally {
    await rm(casa, { recursive: true, force: true })
  }
}

test('importador: dump bom entra, a conferência fecha e a saída tem só contagens', async () => {
  const r = await rodar({ missoes: [missao], missaoEventos: [evento], achados: [], achadoEventos: [], memorias: [] })
  assert.equal(r.codigo, 0, r.erro)
  const saida = JSON.parse(r.saida)
  assert.equal(saida.importacao.missoes, 1)
  assert.equal(saida.importacao.missaoEventos, 1)
  assert.equal(saida.verificacao.ok, true)
  assert.ok(!r.saida.includes('missão do dump'), 'conteúdo do dump não vai para a saída')
  assert.ok(!r.saida.includes(r.casa), 'caminho da casa não vai para a saída')
})

test('importador: linha que o banco recusa deixa faltando e sai com 1', async () => {
  const quebrada = { ...missao, id: 'mission-cli-2', objective: 'x' }
  const r = await rodar({ missoes: [missao, quebrada], missaoEventos: [], achados: [], achadoEventos: [], memorias: [] })
  assert.equal(r.codigo, 1)
  const saida = JSON.parse(r.saida)
  assert.equal(saida.verificacao.ok, false)
  assert.equal(saida.verificacao.tabelas.missoes.faltando, 1)
})

test('importador: sem --arquivo recusa sem tocar em banco', async () => {
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8' })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /--arquivo/)
})
