import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { classificarFeedbackPersonalidade, observarVotoPersonalidade, resumirFeedbackPersonalidade } from '../runtime/feedback-personalidade.mjs'
import { abrirTurnoAuditoria, registrarAcaoAuditoria, auditarParada } from '../runtime/auditoria-autocorrecao.mjs'
import { analisarExperiencias } from '../runtime/pipeline-memoria.mjs'
import { TEXTO_DIRETIVA_PERSONALIDADE } from '../runtime/ajustes-personalidade.mjs'

test('A04: constância, negação e atribuição de feedback', () => {
  for (const text of ['a personalidade ainda não é constante', 'personalidade ainda não constante', 'a personalidade não é persistente', 'a personalidade está oscilando']) {
    assert.equal(classificarFeedbackPersonalidade(text)?.polarity, 'negative', text)
  }
  assert.notEqual(classificarFeedbackPersonalidade('a ironia é que nem funcionou')?.polarity, 'positive')
  assert.equal(classificarFeedbackPersonalidade('O cliente disse: "a personalidade ainda não é constante"'), null)
  assert.equal(classificarFeedbackPersonalidade('No teste use: "a resposta ficou excelente"'), null)
})

test('A04: correção de continuidade sem resposta vinculada persiste sem inventar voto', async () => {
  const home = await mkdtemp(join(tmpdir(), 'omni-september-feedback-'))
  try {
    const observed = await observarVotoPersonalidade(home, { sessionId: 'one', feedback: 'a personalidade ainda não é constante' })
    assert.equal(observed.vote, null)
    assert.equal(observed.counts.totalVotes, 0)
    assert.ok((await resumirFeedbackPersonalidade(home)).persistentAdjustment?.directives.includes('maintain-personality-continuity'))
    assert.ok(TEXTO_DIRETIVA_PERSONALIDADE['maintain-personality-continuity'], 'o avaliador precisa aceitar a mesma diretriz do hook')
    await observarVotoPersonalidade(home, { sessionId: 'two', feedback: 'Essa resposta ficou excelente.' })
    assert.ok((await resumirFeedbackPersonalidade(home)).persistentAdjustment?.directives.includes('maintain-personality-continuity'))
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('A02: pedidos naturais e devoluções indiretas mantêm o compromisso do Omni', async () => {
  const home = await mkdtemp(join(tmpdir(), 'omni-september-audit-'))
  try {
    for (const [i, prompt] of ['você consegue corrigir o Omni?', 'quero melhorar o Omni', 'ainda está me delegando tarefas, arruma isso', 'Omni, corrija esse erro'].entries()) {
      const opened = await abrirTurnoAuditoria(home, {session_id:`request-${i}`, prompt})
      assert.notEqual(opened.turn.requestKind, 'conversation', prompt)
    }
    for (const [i, answer] of ['Por favor, rode os testes.', 'Preciso que você rode os testes.', 'Valide a instalação e me avise.', 'Depois, abra o VS Code.', 'Quando puder, execute os testes.', 'A próxima etapa é você rodar os testes.'].entries()) {
      const session_id = `return-${i}`
      await abrirTurnoAuditoria(home, { session_id, prompt:'corrija o arquivo alvo.md' })
      for (const [id, tool_name] of [['edit','Edit'], ['read','Read']]) {
        await registrarAcaoAuditoria(home, {session_id, hook_event_name:'PostToolUse', tool_use_id:`${i}-${id}`, tool_name, tool_input:{file_path:'alvo.md'}})
      }
      const stopped = await auditarParada(home, { session_id, last_assistant_message:answer })
      assert.ok(stopped.turn.findings.some(f => f.code === 'authorized-work-returned-to-owner'), answer)
    }
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('sessão 04/09: fatos de projeto entram; linguagem transitória e citação não viram memória', () => {
  for (const text of ['O banco do Overcore usa PostgreSQL 18', 'O Hub fica em C:\\hub-wp', 'O Hub fica em "C:\\hub-wp"']) {
    const result = analisarExperiencias(text).find(a => a.result === 'validated')
    assert.equal(result?.type, 'semantic', text)
    assert.equal(result?.scope.type, 'project', text)
  }
  for (const text of ['quero construir um gráfico rápido aqui só pra conferir', 'A regra é simples: soma tudo e divide por dois', 'O cliente disse: "Prefiro respostas longas"']) {
    assert.equal(analisarExperiencias(text).some(a => a.result === 'validated'), false, text)
  }
})
