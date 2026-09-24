// Opt-in live planner evaluation. No real credentials, tools, project relay or database connection.
import assert from 'node:assert/strict'
import { query, type Options } from '@anthropic-ai/claude-agent-sdk'
import { mkdtemp, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Coordinator } from '../src/main/coordinator'
import { Store } from '../src/main/store'
import { CredentialIntake } from '../src/main/credential-intake'
import { claudeExecutable } from '../src/main/runtime'

const cases: { name: string; text: string; expected: string | null; prior: boolean; saved?: boolean }[] = [
  { name: 'execute-read-not-write', text: 'Use os acessos do Crachá e delegue à sessão vinculada a execução da T1.1.1, somente leitura. A ponte SSH foi implementada no Omni: forneça ao executor a referência temporária e o cliente de uso, sem colocar senhas no briefing.\nConsulte o catálogo com postgres.catalog e meça a atualização das colunas temporais com postgres.freshness. Confira quais objetos previstos na T1.1.1 essas operações conseguem atender; informe qualquer lacuna sem declarar a etapa completa.\nNão execute DW.2–DW.6 nem altere dados ou permissões. Conduza a execução e me devolva um resumo: o que foi verificado, se os dados estão atualizados e qualquer impedimento concreto.', expected: 'use', prior: false },
  { name: 'explain-not-connect', text: 'Explique como usar esse acesso para ler o catálogo. Não conecte, não teste nem guarde; quero só entender primeiro.', expected: null, prior: false },
  { name: 'contextual-followup', text: 'Pode seguir com essa leitura; deixe as alterações para depois.', expected: 'use', prior: true },
  { name: 'registered-without-attachment', text: 'Use o acesso já cadastrado deste projeto e mande executar a leitura da T1.1.1. Não vou anexar de novo. Não altere dados.', expected: 'use', prior: false, saved: true }
]
const base = resolve('out')
for (const scenario of cases) {
  const directory = await mkdtemp(join(base, 'private-intent-live-'))
  const store = new Store(directory); await store.load()
  const c = store.get(await store.create(directory, 'external')); c.sessionId = randomUUID()
  const active = new Map<string, AbortController>()
  const intake = new CredentialIntake(async () => { throw Error('No vault in evaluation') })
  let relays = 0, grants = 0, lookups = 0
  const model = (async function* (args: { prompt: string; options: Options }) {
    if (args.options.outputFormat) yield* query(args)
    else yield { type: 'result', subtype: 'success', is_error: false, result: 'Resposta de conversa: nenhuma execução.' }
  }) as typeof query
  const session = { sessionId: c.sessionId, name: 'Reengenharia_station_growth', cwd: directory, pid: 1, address: 'fixture' }
  const savedId = randomUUID()
  const coordinator = new Coordinator(store, () => {}, {
    context: async () => 'Ambiente de avaliação com dados fictícios. T1.1.1 mede atualização em PostgreSQL; DW.2–DW.6 alteram dados. Não há autorização de escrita.',
    executable: claudeExecutable, sessions: async () => [session], open: async () => c.id,
    relay: async () => { relays++ }, local: async () => { throw Error('Unexpected local task') },
    badgeLookup: async () => { lookups++; return [] },
    badgeClaimAttachment: (...args) => intake.claimAttachment(...args),
    badgeReuseAttachment: (...args) => scenario.saved ? { id: savedId, size: 0 } : intake.reuseAttachment(...args),
    ...(scenario.saved ? { badgeSources: () => [{ turnId: 'access:' + savedId, status: 'stored', label: 'SSH + PostgreSQL deste projeto' }], badgeSourceStatus: () => 'ready' } : {}),
    badgeAttachment: async (...args) => intake.attachmentContext(...args),
    badgeExecutorBrief: async () => { grants++; return 'Synthetic capability; no connection.' }
  }, model, active)
  const attachment = intake.stageAttachment(c.id, JSON.stringify({ kind: 'database', engine: 'postgresql', host: 'fixture.invalid', username: 'fixture', database: 'fixture', password: 'SYNTHETIC-EVAL-ONLY' }))
  if (scenario.saved) intake.discardAttachment(c.id)
  if (scenario.prior) {
    const priorId = randomUUID()
    intake.claimAttachment(c.id, priorId, attachment.id)
    c.messages.push({ id: priorId, role: 'user', text: 'Aqui está o acesso privado para a T1.1.1.', at: new Date().toISOString(), channel: 'text', privateAttachment: { ...attachment, status: 'considered' } })
    c.messages.push({ id: randomUUID(), role: 'assistant', text: 'A próxima etapa é consultar o catálogo e medir a atualização por SSH, somente leitura. As alterações DW.2–DW.6 ficam fora desta rodada.', at: new Date().toISOString(), channel: 'text' })
  }
  const deadline = setTimeout(() => { for (const controller of active.values()) controller.abort() }, 90000)
  try {
    await coordinator.enqueue(c, scenario.text, 'text', [], scenario.text, scenario.prior || scenario.saved ? undefined : attachment.id)
    while (active.size || !['done', 'failed'].includes(c.coordinationTurns![0].state)) await new Promise(r => setTimeout(r, 50))
    const turn = c.coordinationTurns![0]
    console.log(JSON.stringify({ case: scenario.name, state: turn.state, action: turn.plan?.action, privateAction: turn.plan?.privateAccess?.action || null, operations: turn.plan?.privateAccess?.operations || [], grants, relays, lookups, error: turn.error }))
    assert.equal(turn.state, 'done')
    assert.equal(turn.plan?.privateAccess?.action || null, scenario.expected)
    assert.equal(lookups, 0)
    assert.equal(grants, scenario.expected === 'use' ? 1 : 0)
    assert.equal(relays, scenario.expected === 'use' ? 1 : 0)
  } finally {
    clearTimeout(deadline); coordinator.stop(); intake.discard()
    for (const controller of active.values()) controller.abort()
    while (active.size) await new Promise(r => setTimeout(r, 50))
    await store.save()
    assert.equal(resolve(directory).startsWith(base + '\\'), true)
    await rm(directory, { recursive: true, force: true })
  }
}
