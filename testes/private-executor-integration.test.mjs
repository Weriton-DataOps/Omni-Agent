import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { NodeAccessBrokerClient } from '../dist/adapters/windows/node-access-broker-client.js'
let ssh2
try { ssh2 = createRequire(new URL('../apps/omni-desktop/package.json', import.meta.url))('ssh2') }
catch(error) { if (error.code !== 'MODULE_NOT_FOUND') throw error }

test('cadeia real: cliente Node → pipe Windows autenticado → broker PowerShell → worker → SSH', {skip:process.platform !== 'win32'||!ssh2,timeout:30000}, async t => {
  const root=resolve(import.meta.dirname,'..')
  const reportRoot=join(root,'out','implementation'); await mkdir(reportRoot,{recursive:true})
  const directory=await mkdtemp(join(reportRoot,'private-executor-test-'))
  t.after(()=>rm(directory,{recursive:true,force:true}))
  const sid=execFileSync('whoami.exe',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true}).match(/S-1-5-[0-9-]+/)[0]
  const name=`omni-private-test-${randomUUID()}`
  const process=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'scripts/omni-access-broker.ps1'),'-PipeName',name,'-AllowedClientSid',sid,'-ReportPath',join(directory,'receipt.json')],{windowsHide:true,stdio:'ignore'})
  t.after(()=>{process.kill()})
  const client=new NodeAccessBrokerClient(`\\\\.\\pipe\\${name}`,500)
  const end=Date.now()+15000
  while(true){try {assert.deepEqual(await client.executionCapabilities(),['postgres.catalog','postgres.freshness']);break}catch {if(Date.now()>end)throw Error('Synthetic broker startup failed');await new Promise(r=>setTimeout(r,100))}}
  const keys=ssh2.utils.generateKeyPairSync('ed25519')
  const fingerprint='SHA256:'+createHash('sha256').update(ssh2.utils.parseKey(keys.private).getPublicSSH()).digest('base64').replace(/=+$/,'')
  let receivedSql='',receivedCommand=''
  const secret='SYNTHETIC-FOR-INTEGRATION-ONLY'
  const server=new ssh2.Server({hostKeys:[keys.private]},remote=>{
    remote.on('error',()=>{})
    remote.on('authentication',ctx=>ctx.method==='password'&&ctx.password===secret?ctx.accept():ctx.reject())
    remote.on('ready',()=>remote.on('session',accept=>accept().on('exec',(accept,_,info)=>{
      receivedCommand=info.command;const stream=accept()
      stream.on('data',chunk=>receivedSql+=chunk)
      stream.on('end',()=>{stream.write('[{"schema":"analytics","table":"facts","column":"updated_at","type":"timestamp","temporal":true}]');stream.exit(0);stream.end()})
    })))
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)))
  const registration=(provider,payload)=>({registration:{credentialId:`fixture-${provider}`,providerRef:provider,accountRef:'synthetic',environmentRef:'test',token:JSON.stringify(payload),expiresAt:null,renewalMode:'none'}})
  const source={ssh:registration('ssh',{kind:'ssh',host:'127.0.0.1',port:server.address().port,username:'fixture',password:secret,hostKeySha256:fingerprint}),database:registration('postgresql',{kind:'database',engine:'postgresql',host:'127.0.0.1',port:5432,username:'postgres',database:'synthetic',password:'SYNTHETIC-PG'}),mode:'sudo-postgres'}
  const result=await client.executeCredential(source,{kind:'postgres.catalog',page:0})
  assert.equal(result.outcome,'completed');assert.equal(result.data[0].table,'facts')
  assert.match(receivedCommand,/sudo -n -u postgres/);assert.match(receivedSql,/pg_catalog.pg_class/);assert.match(receivedSql,/BEGIN READ ONLY/)
  assert.ok(!receivedCommand.includes(secret));assert.ok(!receivedSql.includes(secret));assert.ok(!JSON.stringify(result).includes(secret))
  assert.ok(!receivedSql.includes('SYNTHETIC-PG'))
})
