// Peças puras do carteiro (F2, plano 4a, T5): onde o trabalho mora, o pedido que a sessão recebe e quais
// sessões do Claude Code estão vivas. Portadas da ilha; o ponto e a devolução passam pelas mãos do Actions.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { escolherDestino, montarPedido } from '../runtime/casa/pedido-execucao.mjs'
import { sessoesVivas } from '../runtime/casa/sessoes-vivas.mjs'

test('destino: sessão da pasta do projeto; senão Actions; senão a ociosa mais nova do Omni', () => {
  const S = [
    { nome: 'omni-a0', cwd: 'C:\\Users\\x\\Omni', status: 'busy', startedAt: 1 },
    { nome: 'omni-24', cwd: 'c:\\users\\x\\omni', status: 'idle', startedAt: 5 },
    { nome: 'omni-old', cwd: 'C:\\Users\\x\\Omni', status: 'idle', startedAt: 2 },
    { nome: 'station-1', cwd: 'C:\\Users\\x\\Station\\sub', status: 'busy', startedAt: 3 },
    { nome: 'station-2', cwd: 'C:\\Users\\x\\Station', status: 'idle', startedAt: 1 }
  ]
  const base = { pastaActions: 'C:\\Users\\x\\Actions', pastaOmni: 'C:\\Users\\x\\Omni' }
  const projeto = escolherDestino(S, { ...base, pastaProjeto: 'C:\\Users\\x\\Station' })
  assert.equal(projeto.nome, 'station-2', 'ociosa da pasta do projeto primeiro')
  assert.equal(projeto.motivo, 'sessão aberta na pasta do projeto')
  assert.equal(escolherDestino([{ nome: 'irma', cwd: 'C:\\Users\\x\\StationNova', status: 'idle', startedAt: 9 }, S[1]], { ...base, pastaProjeto: 'C:\\Users\\x\\Station' }).nome, 'omni-24', 'pasta irmã com prefixo igual não conta')
  const actions = escolherDestino([...S, { nome: 'actions-9', cwd: 'C:\\Users\\x\\Actions', status: 'busy', startedAt: 0 }], base)
  assert.equal(actions.nome, 'actions-9')
  assert.equal(actions.motivo, 'sessão aberta no Actions')
  const omni = escolherDestino(S, base)
  assert.equal(omni.nome, 'omni-24', 'a ociosa mais nova do Omni')
  assert.equal(omni.motivo, 'sessão ociosa mais nova no Omni')
  assert.equal(escolherDestino(S, { ...base, excluir: ['omni-24'] }).nome, 'omni-old', 'nunca a sessão excluída')
  assert.equal(escolherDestino(S.filter((s) => s.status === 'busy' && !s.cwd.includes('Station')), base), null, 'Omni ocupado não recebe')
  assert.equal(escolherDestino(undefined, base), null)
})

test('pedido: instrução, contexto, regras e a devolução pelas mãos do Actions', () => {
  const ex = { id: '20261022-101010-abcd', instrucao: 'migra o card', eventos: [] }
  const pr = { nome: 'Omni', pasta: 'C:\\O', fase: 'f', dor: 'd', itens: [{ titulo: 'Alfa', data: '01/12/2026' }, { titulo: 'Beta', proposto: true }, { titulo: 'Gama', feito: true }] }
  const t = montarPedido(ex, { projeto: pr, ponto: { slug: 'exe', titulo: 'T', proximoPasso: 'rodar', potencial: { nivel: 2, motivo: 'm' } }, maos: 'M.mjs' })
  for (const trecho of [
    'migra o card', '## Projeto: Omni', 'Pasta: C:\\O', 'Fase: f', 'Dor do momento: d', '- Alfa — 01/12/2026',
    '## Ponto do Actions: T (exe)', 'node "M.mjs" ponto exe', 'Próximo passo registrado: rodar', 'Potencial: ▲▲ — m', 'Sem push',
    'node "M.mjs" execucao 20261022-101010-abcd --estado andando', 'node "M.mjs" execucao 20261022-101010-abcd --estado concluida',
    'node "M.mjs" execucao 20261022-101010-abcd --estado bloqueada', 'node "M.mjs" execucao 20261022-101010-abcd --estado falhou'
  ]) assert.ok(t.includes(trecho), trecho)
  assert.ok(!t.includes('Beta'), 'item só proposto não vira entrega')
  assert.ok(!t.includes('Gama'), 'item feito não vira entrega')
  assert.ok(!/pontos[\\/]exe\.md/.test(t), 'o ponto mora no banco do Oráculo, não num arquivo')
  const r = montarPedido(ex, { maos: 'M.mjs', resposta: 'usa o banco de homolog' })
  assert.match(r, /^Resposta do Weriton à execução 20261022-101010-abcd/)
  assert.match(r, /usa o banco de homolog/)
  assert.ok(!r.includes('## O que ele pediu'), 'resposta não repete o pedido inteiro')
  assert.ok(r.includes('node "M.mjs" execucao 20261022-101010-abcd --estado concluida'))
})

test('sessões vivas: só as interativas de processo vivo, ignorando arquivo meio escrito', (t) => {
  const pasta = mkdtempSync(join(tmpdir(), 'omni-sessoes-'))
  t.after(() => rmSync(pasta, { recursive: true, force: true }))
  const gravar = (pid, dados) => writeFileSync(join(pasta, `${pid}.json`), typeof dados === 'string' ? dados : JSON.stringify(dados))
  gravar(101, { pid: 101, sessionId: 'aaa', name: 'omni-a0', cwd: 'C:\\O', status: 'idle', kind: 'interactive', startedAt: 7 })
  gravar(102, { pid: 102, sessionId: 'bbb', name: 'morta', cwd: 'C:\\O', status: 'idle', kind: 'interactive', startedAt: 8 })
  gravar(103, '{"pid": 103, "sessionId": "ccc", "na')
  gravar(104, { pid: 104, sessionId: 'ddd', name: 'fundo', cwd: 'C:\\O', status: 'busy', kind: 'background', startedAt: 9 })
  gravar(105, { pid: 105, sessionId: 'eee', cwd: 'C:\\O', kind: 'interactive' })
  writeFileSync(join(pasta, 'outro.json'), JSON.stringify({ pid: 101, sessionId: 'fff', name: 'intrusa', kind: 'interactive' }))
  const vivos = new Set([101, 103, 104, 105])
  assert.deepEqual(sessoesVivas({ pasta, vivo: (pid) => vivos.has(pid) }), [
    { sessionId: 'aaa', nome: 'omni-a0', cwd: 'C:\\O', status: 'idle', pid: 101, kind: 'interactive', startedAt: 7 }
  ])
  assert.deepEqual(sessoesVivas({ pasta: join(pasta, 'nao-existe'), vivo: () => true }), [])
})
