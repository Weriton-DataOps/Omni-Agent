import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { createRequire } from 'node:module'
let ssh2, executeOverSsh, trustedHostKey
try {
  ssh2 = createRequire(new URL('../apps/omni-desktop/package.json', import.meta.url))('ssh2')
  ;({ executeOverSsh, trustedHostKey } = await import('../apps/omni-desktop/scripts/ssh-executor.mjs'))
} catch (error) { if (!['MODULE_NOT_FOUND','ERR_MODULE_NOT_FOUND'].includes(error.code)) throw error }
const { Server, utils } = ssh2 || {}
// ssh2 accepts OpenSSH-format keys; its built-in generator yields a supported host key.
const keys = utils?.generateKeyPairSync('ed25519')
const publicKey = keys && utils.parseKey(keys.private).getPublicSSH()
const fingerprint = publicKey && 'SHA256:' + createHash('sha256').update(publicKey).digest('base64').replace(/=+$/,'')
const secret = 'ONLY-SYNTHETIC-SSH-PASSWORD'
const pgSecret = 'ONLY-SYNTHETIC-PG-PASSWORD'

test('host SSH: known_hosts normal/hash, pin e revogação', {skip:!ssh2}, () => {
  const encoded = publicKey.toString('base64')
  assert.equal(trustedHostKey('host',22,publicKey,`host ssh-ed25519 ${encoded}`),true)
  const salt = Buffer.from('synthetic-salt')
  const hash = createHmac('sha1',salt).update('[host]:2222').digest('base64')
  assert.equal(trustedHostKey('host',2222,publicKey,`|1|${salt.toString('base64')}|${hash} ssh-ed25519 ${encoded}`),true)
  assert.equal(trustedHostKey('host',22,publicKey,'',fingerprint),true)
  assert.equal(trustedHostKey('host',22,publicKey,''),false)
  assert.equal(trustedHostKey('host',22,publicKey,`@revoked * ssh-ed25519 ${encoded}`,fingerprint),false)
})

for (const mode of ['sudo-postgres','password']) test(`SSH real local: autentica e envia comando psql (${mode}), sem senha no comando/retorno`, {skip:!ssh2}, async t => {
  let commands = []; let received = ''; let authentications = 0
  const server = new Server({hostKeys:[keys.private]}, client => {
    client.on('error',()=>{})
    client.on('authentication', ctx => { authentications++; ctx.method === 'password' && ctx.password === secret ? ctx.accept() : ctx.reject() })
    client.on('ready',()=>client.on('session',accept=>accept().on('exec',(accept,_,info)=>{
      commands.push(info.command); const stream=accept(); stream.on('data',chunk=>{ received+=chunk })
      stream.on('end',()=>{stream.write(JSON.stringify([{schema:'analytics',table:'events',column:'created_at',type:'timestamp',temporal:true}]));stream.exit(0);stream.end()})
    })))
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); t.after(()=>new Promise(resolve=>server.close(resolve)))
  const input = {ssh:{kind:'ssh',host:'127.0.0.1',port:server.address().port,username:'synthetic',password:secret,hostKeySha256:fingerprint},database:{kind:'database',engine:'postgresql',host:'127.0.0.1',port:5432,username:'postgres',database:'fixture',password:pgSecret},mode,operation:'postgres.catalog',sql:'SELECT 1;'}
  const result = await executeOverSsh(input,{knownHosts:''})
  assert.equal(result.outcome,'completed'); assert.equal(result.data[0].table,'events')
  assert.equal(commands.length,1); assert.match(commands[0],/\/usr\/bin\/psql/)
  assert.equal(commands[0].includes(secret)||commands[0].includes(pgSecret),false)
  assert.match(received,/BEGIN READ ONLY;/)
  assert.equal(received.includes(pgSecret),mode==='password')
  if(mode==='sudo-postgres') assert.match(commands[0],/sudo -n -u postgres/)
  assert.equal(JSON.stringify(result).includes(secret)||JSON.stringify(result).includes(pgSecret),false)
  const before=authentications
  const rejected=await executeOverSsh({...input,ssh:{...input.ssh,hostKeySha256:'SHA256:wrong'}},{knownHosts:''})
  assert.equal(rejected.outcome,'host-key-required'); assert.equal(authentications,before)
  const wrongTarget=await executeOverSsh({...input,database:{...input.database,host:'other.invalid'}},{knownHosts:''})
  assert.equal(wrongTarget.outcome,'denied'); assert.equal(commands.length,1)
})
