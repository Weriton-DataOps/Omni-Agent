import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ExecutorAccessBridge } from '../src/main/executor-access'
import { privateExecutionSources } from '../src/main/private-execution-sources'
import { validatePrivateAction, validatePrivateActionContext } from '../src/shared/private-action'
import { useCracha } from '../scripts/use-cracha.mjs'
import { Coordinator } from '../src/main/coordinator'
import { CredentialIntake } from '../src/main/credential-intake'
import { Store } from '../src/main/store'
import type { query, Options } from '@anthropic-ai/claude-agent-sdk'
const secret = 'SYNTHETIC-CRED-NEVER-IN-PUBLIC-123'
const raw = JSON.stringify({ kind: 'database', engine: 'postgresql', host: 'private.invalid', username: 'tester', database: 'private_db', password: secret })
const lookup = async () => { throw Error('No implicit vault access') }

test('fonte privada: SSH + PostgreSQL, par explícito, sem gravação e sem escolher outro host', async () => {
  const ssh = { kind:'ssh', host:'private.invalid', username:'root', password: secret }
  const database = JSON.parse(raw)
  const sources = await privateExecutionSources(JSON.stringify({ ssh, database, mode: 'sudo-postgres' }), lookup)
  assert.equal(sources.accesses.length, 1); assert.ok('ssh' in sources.accesses[0].source)
  await assert.rejects(privateExecutionSources(JSON.stringify({ credentials: [ssh, {...database, host:'other.invalid'}] }), lookup), /Associe explicitamente/)
  await assert.rejects(privateExecutionSources('PostgreSQL\nhost: first\nhost: second\nusuario: u\nsenha: x\nbanco: db', lookup), /mais de um destino/)
  const natural = await privateExecutionSources('SSH\nhost: private.invalid\nusuario: root\nsenha: secretSSH\n\nPostgreSQL\nhost: private.invalid\nusuario: postgres\nsenha: secretPG\nbanco: db', lookup)
  assert.equal(natural.accesses.length, 1); assert.ok('ssh' in natural.accesses[0].source)
})

test('contrato valida operação/fonte/autoridade, não decide intenção por palavras', () => {
  assert.equal(validatePrivateAction(undefined), null)
  const action = validatePrivateAction({ action:'use',sourceTurnId:'source',operations:['postgres.catalog'],authorizationQuote:'Pode seguir' })!
  validatePrivateActionContext(action,'Pode seguir; não execute DW.2–DW.6.',['source'])
  assert.throws(()=>validatePrivateAction({...action,operations:['shell.exec']}))
  assert.throws(()=>validatePrivateAction({...action,operations:[]}))
  assert.throws(()=>validatePrivateActionContext(action,'Explique como funciona.',['source']))
  assert.throws(()=>validatePrivateActionContext(action,'Pode seguir',['another-conversation']))
})

test('referência isola sessão/tarefa/pasta, expira e chamadas são idempotentes inclusive na falha', async t => {
  const workspace = await mkdtemp(join(tmpdir(),'omni-grant-'))
  t.after(() => rm(workspace,{recursive:true,force:true}))
  const scope = { workspace, sessionId:randomUUID(), taskId:randomUUID(), conversationId:randomUUID() }
  let time = 10000; let calls = 0; let live = true
  const receipts: unknown[] = []
  const bridge = new ExecutorAccessBridge({ live: async () => live, receipt: (...args) => { receipts.push(args) }, execute: async () => { calls++; return {outcome:'completed',operation:'postgres.catalog',data:[]} } }, () => time)
  t.after(() => bridge.close())
  const { accesses } = await privateExecutionSources(raw,lookup)
  const brief = await bridge.issue(scope,accesses,'C:\\client.mjs',1000)
  assert.ok(!brief.includes(secret)); assert.ok(!brief.includes('private.invalid')); assert.ok(!brief.includes('private_db'))
  const grant = /--grant ([a-f0-9]{64})/.exec(brief)![1]
  const request = { grant, sessionId:scope.sessionId, taskId:scope.taskId, workspace, access:'access-1', callId:randomUUID(), action:{kind:'postgres.catalog',page:0} }
  await assert.rejects(bridge.use({...request,sessionId:randomUUID()}))
  await assert.rejects(bridge.use({...request,taskId:randomUUID()}))
  await assert.rejects(bridge.use({...request,workspace:tmpdir()}))
  await assert.rejects(bridge.use({...request,action:{kind:'postgres.catalog',page:0,sql:'DROP DATABASE x'}}))
  assert.equal(calls,0)
  assert.equal((await bridge.use(request)).replayed,false)
  assert.equal((await bridge.use(request)).replayed,true); assert.equal(calls,1)
  await assert.rejects(bridge.use({...request,action:{kind:'postgres.catalog',page:1}}))
  const limited = await bridge.issue(scope,accesses,'C:\\client.mjs',undefined,['postgres.catalog'])
  await assert.rejects(bridge.use({...request,grant:/--grant ([a-f0-9]{64})/.exec(limited)![1],callId:randomUUID(),action:{kind:'postgres.freshness',schema:'public',table:'facts',column:'at'}}))
  assert.equal(calls,1, 'operação fora do plano é recusada antes de acessar credenciais')
  bridge.revokeTask(scope.taskId)
  time += 1001; await assert.rejects(bridge.use({...request,callId:randomUUID()})); assert.equal(calls,1)
  const second = await bridge.issue(scope,accesses,'C:\\client.mjs')
  live = false; await assert.rejects(bridge.use({...request,grant:/--grant ([a-f0-9]{64})/.exec(second)![1]})); assert.equal(bridge.hasGrants,false)
  assert.ok(!JSON.stringify(receipts).includes(secret))
})

test('cliente executor real usa named pipe e não recebe senha; revogação encerra o acesso', {skip:process.platform !== 'win32'}, async t => {
  const workspace = await mkdtemp(join(tmpdir(),'omni-pipe-')); t.after(() => rm(workspace,{recursive:true,force:true}))
  let calls = 0
  const scope = {workspace,sessionId:randomUUID(),taskId:randomUUID(),conversationId:randomUUID()}
  const bridge = new ExecutorAccessBridge({live:async()=>true,receipt:()=>{},execute:async()=>{calls++; throw Error(secret)}})
  t.after(()=>bridge.close())
  const brief = await bridge.issue(scope,(await privateExecutionSources(raw,lookup)).accesses,'C:\\client.mjs')
  const args = ['--pipe',/--pipe '([^']+)'/.exec(brief)![1], '--grant',/--grant ([a-f0-9]{64})/.exec(brief)![1], '--session',scope.sessionId,'--task',scope.taskId,'--access','access-1','--operation','postgres.catalog','--call',randomUUID()]
  const first = await useCracha(args,workspace); assert.equal(first.result.outcome,'unavailable')
  const second = await useCracha(args,workspace); assert.equal(second.replayed,true); assert.equal(calls,1)
  assert.ok(!JSON.stringify([first,second]).includes(secret))
  bridge.revokeTask(scope.taskId); await assert.rejects(useCracha(args,workspace))
})

for (const binding of ['current', 'prior'] as const) test(`delegação com fonte ${binding}: entrega a ponte, não o documento privado`, async t => {
  const directory=await mkdtemp(join(tmpdir(),'omni-delegate-access-'));const store=new Store(directory);await store.load()
  const c=store.get(await store.create(directory,'external'));c.sessionId=randomUUID()
  const intake=new CredentialIntake(async()=>{throw Error('Sem cadastro/teste automático')})
  let relayed='';let operations=0;const prompts:string[]=[];const active=new Map<string,AbortController>()
  const bridge=new ExecutorAccessBridge({live:async()=>true,receipt:()=>{},execute:async()=>{operations++;return {outcome:'completed',operation:'postgres.catalog',data:[]}}})
  t.after(async()=>{bridge.close();intake.discard();await store.save();await rm(directory,{recursive:true,force:true})})
  const session={sessionId:c.sessionId,cwd:directory,name:'fixture',pid:1,address:'fixture'}
  let sourceTurnId = ''
  const agent=(async function*({prompt,options}:{prompt:string;options:Options}){
    prompts.push(prompt)
    yield {type:'result',subtype:'success',is_error:false,result:'',structured_output:{action:'project',sessionId:c.sessionId,instruction:'Consulte o catálogo pela ponte privada e devolva a evidência. Não execute DW.2–DW.6.',reply:'Encaminhar a consulta autorizada.',privateAccess:{action:'use',sourceTurnId:sourceTurnId || c.coordinationTurns![0].id,operations:['postgres.catalog'],authorizationQuote:binding === 'prior' ? 'Pode seguir' : 'Use os acessos do Crachá'}}}
  }) as unknown as typeof query
  const coordinator=new Coordinator(store,()=>{}, {context:async()=>'',executable:async()=>'',sessions:async()=>[session],open:async()=>c.id,local:async()=>{throw Error()},relay:async(_,text)=>{relayed=text},badgeReuseAttachment:(...args)=>intake.reuseAttachment(...args),badgeClaimAttachment:(...args)=>intake.claimAttachment(...args),badgeAttachment:async(id,turn)=>intake.attachmentContext(id,turn),badgeExecutorBrief:async(id,turn,target)=>bridge.issue({conversationId:id,taskId:turn,sessionId:target.sessionId,workspace:target.cwd},(await intake.executorSources(id,turn)).accesses,'C:\\client.mjs',undefined,c.coordinationTurns!.find(t=>t.id===turn)!.plan!.privateAccess!.operations),badgeRevokeTask:id=>bridge.revokeTask(id)},agent,active)
  const attachment=intake.stageAttachment(c.id,raw)
  const ownerText = 'Use os acessos do Crachá e delegue à sessão vinculada a execução da T1.1.1, somente leitura. A ponte SSH foi implementada no Omni: forneça ao executor a referência temporária e o cliente de uso, sem colocar senhas no briefing.\nConsulte o catálogo com postgres.catalog e meça a atualização das colunas temporais com postgres.freshness. Confira quais objetos previstos na T1.1.1 essas operações conseguem atender; informe qualquer lacuna sem declarar a etapa completa.\nNão execute DW.2–DW.6 nem altere dados ou permissões. Conduza a execução e me devolva um resumo: o que foi verificado, se os dados estão atualizados e qualquer impedimento concreto.'
  if (binding === 'prior') {
    sourceTurnId = randomUUID()
    intake.claimAttachment(c.id,sourceTurnId,attachment.id)
    c.messages.push({id:sourceTurnId,role:'user',at:new Date().toISOString(),channel:'text',text:'Segue o acesso para a leitura.',privateAttachment:{...attachment,status:'considered'}})
    c.messages.push({id:randomUUID(),role:'assistant',at:new Date().toISOString(),channel:'text',text:'A próxima etapa é consultar o catálogo somente leitura.'})
  }
  const requestText = binding === 'prior' ? 'Pode seguir; não execute as alterações.' : ownerText
  await coordinator.enqueue(c,requestText,'text',[],requestText,binding === 'current' ? attachment.id : undefined)
  const end=Date.now()+4000;while(!relayed||active.size){if(Date.now()>end)throw Error('Delegation timeout');await new Promise(r=>setTimeout(r,5))}
  assert.match(relayed,/CRACHÁ — PONTE EXECUTÁVEL PRIVADA/)
  assert.equal(operations,0)
  const grant=/--grant ([a-f0-9]{64})/.exec(relayed)![1]
  await bridge.use({grant,sessionId:session.sessionId,taskId:c.coordinationTurns![0].id,workspace:directory,access:'access-1',callId:randomUUID(),action:{kind:'postgres.catalog',page:0}})
  assert.equal(operations,1)
  for(const text of [...prompts,relayed,JSON.stringify(c)]) {assert.ok(!text.includes(secret));assert.ok(!text.includes('private.invalid'))}
  assert.ok(!JSON.stringify(c).includes(grant))
})
