// Os puros das tarefas dos agentes (F2, plano 5c, T1): nome no agendador, variáveis do roteiro e a linha
// de comando do claude da visita. Nada aqui toca disco, cofre ou agendador.
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ErroDeTarefa,
  argumentosDoClaude,
  hojeBr,
  idDaVisita,
  nomeDaTarefa,
  preencherRoteiro,
  variavelDoAgente
} from '../runtime/casa/tarefas.mjs'

test('nome da tarefa no agendador: prefixo, agente e id separados por " - "', () => {
  assert.equal(nomeDaTarefa('Omni', 'oraculo', 'actions-visita'), 'Omni - oraculo - actions-visita')
  assert.equal(nomeDaTarefa('OmniProva', 'meu-agente', 'vigia'), 'OmniProva - meu-agente - vigia')
})

test('a variável do agente é o nome em maiúsculas com hífen virando sublinhado', () => {
  assert.equal(variavelDoAgente('oraculo'), 'ORACULO')
  assert.equal(variavelDoAgente('meu-agente2'), 'MEU_AGENTE2')
})

test('id da visita e o hoje saem da hora local, com zero à esquerda', () => {
  const quando = new Date(2026, 10, 10, 7, 5, 9)
  assert.equal(idDaVisita(quando), '2026-11-10-0705')
  assert.equal(hojeBr(quando), '10/11/2026')
  assert.equal(idDaVisita(new Date(2026, 0, 2, 23, 59, 0)), '2026-01-02-2359')
})

test('preencherRoteiro troca só as variáveis declaradas e não reprocessa o valor', () => {
  assert.equal(preencherRoteiro('a {{X}} b {{Y}} {{Z}} {{X}}', ['X', 'Y'], { X: '1', Y: '2' }), 'a 1 b 2 {{Z}} 1')
  // Um valor que contém outra variável chega literal: o motivo vindo do WhatsApp não injeta caminho.
  assert.equal(preencherRoteiro('{{MOTIVO}} em {{OMNI}}', ['MOTIVO', 'OMNI'], { MOTIVO: '{{OMNI}}', OMNI: 'C:\\o' }), '{{OMNI}} em C:\\o')
  assert.equal(preencherRoteiro('nada', [], {}), 'nada')
  // $ no valor não vira padrão de substituição.
  assert.equal(preencherRoteiro('x={{X}}', ['X'], { X: "$& $' $1" }), "x=$& $' $1")
})

test('variável declarada sem valor é recusa com o nome dela', () => {
  assert.throws(() => preencherRoteiro('{{X}} {{Y}}', ['X', 'Y'], { X: '1' }), (falha) => {
    assert.ok(falha instanceof ErroDeTarefa)
    assert.equal(falha.codigo, 'variavel-sem-valor')
    assert.match(falha.message, /\bY\b/)
    return true
  })
  assert.throws(() => preencherRoteiro('{{X}}', ['X'], { X: '' }), (falha) => falha instanceof ErroDeTarefa && falha.codigo === 'variavel-sem-valor')
})

test('o claude da visita roda com as ferramentas da visita velha e um --add-dir por pasta', () => {
  const args = argumentosDoClaude(['C:\\Actions', 'C:\\omni', 'C:\\oraculo'])
  assert.deepEqual(args.slice(0, 3), ['-p', '--output-format', 'json'])
  const liberadas = args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--disallowedTools'))
  assert.deepEqual(liberadas, ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash', 'PowerShell', 'WebSearch', 'WebFetch'])
  const barradas = args.slice(args.indexOf('--disallowedTools') + 1, args.indexOf('--add-dir'))
  assert.deepEqual(barradas, ['Bash(git push:*)', 'Bash(gh:*)', 'Bash(ssh:*)', 'Bash(scp:*)', 'Bash(npm publish:*)', 'Bash(vercel:*)', 'Bash(pm2:*)'])
  assert.deepEqual(args.slice(args.indexOf('--add-dir')), ['--add-dir', 'C:\\Actions', '--add-dir', 'C:\\omni', '--add-dir', 'C:\\oraculo'])
})
