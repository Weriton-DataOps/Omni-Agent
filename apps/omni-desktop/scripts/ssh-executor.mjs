// Desktop SSH adapter, invoked by the trusted broker only. Secrets arrive on stdin, never argv/files/logs.
import ssh2 from 'ssh2'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const { Client } = ssh2

const atom = value => typeof value === 'string' && /^[a-zA-Z0-9_][a-zA-Z0-9_.@$-]{0,127}$/.test(value)
const equal = (a,b) => a.length === b.length && timingSafeEqual(a,b)
const quote = value => "'" + value.replace(/'/g, "'\\''") + "'"
export function trustedHostKey(host, port, key, knownHosts, pinned) {
  if (knownHosts.split(/\r?\n/).some(line => { const parts = line.trim().split(/\s+/); return parts[0] === '@revoked' && parts[3] && equal(Buffer.from(parts[3], 'base64'), key) })) return false
  const fingerprint = 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
  if (pinned) return typeof pinned === 'string' && pinned === fingerprint
  const hostname = port === 22 ? host : `[${host}]:${port}`
  for (const line of knownHosts.split(/\r?\n/)) {
    if (!line || line.startsWith('#') || line.startsWith('@')) continue // certificates/revocation are never silently accepted
    const [names, , publicKey] = line.trim().split(/\s+/)
    if (!publicKey) continue
    const match = names.split(',').some(name => {
      if (name === hostname) return true
      const parts = /^\|1\|([^|]+)\|([^|]+)$/.exec(name)
      return !!parts && equal(createHmac('sha1', Buffer.from(parts[1], 'base64')).update(hostname).digest(), Buffer.from(parts[2], 'base64'))
    })
    if (match && equal(Buffer.from(publicKey,'base64'), key)) return true
  }
  return false
}
function sanitize(value, privateValues) {
  if (typeof value === 'string') { for (const secret of privateValues) if (secret) value = value.split(secret).join('[private]'); return value }
  if (Array.isArray(value)) return value.map(item => sanitize(item, privateValues))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item]) => [sanitize(key,privateValues),sanitize(item,privateValues)]))
  return value
}
export async function executeOverSsh(input, { knownHosts, ClientClass = Client, timeoutMs = 18000 } = {}) {
  const fail = outcome => ({ outcome, operation: input?.operation, data: null })
  const ssh = input?.ssh; const db = input?.database
  if (!ssh || ssh.kind !== 'ssh' || !/^[a-zA-Z0-9][a-zA-Z0-9.:-]{0,252}$/.test(ssh.host || '') || !atom(ssh.username) || !(typeof ssh.password === 'string' && ssh.password || typeof ssh.privateKey === 'string' && ssh.privateKey) || !db || db.kind !== 'database' || !['postgres','postgresql','pg'].includes(db.engine) || !atom(db.username) || !atom(db.database) || !['password','sudo-postgres'].includes(input.mode) || !['postgres.catalog','postgres.freshness'].includes(input.operation) || typeof input.sql !== 'string' || input.sql.length > 10000) return fail('unsupported')
  // A tunnel never redirects the supplied DB credential to a different target.
  if (![ssh.host,'localhost','127.0.0.1','::1'].includes(db.host)) return fail('denied')
  const port = Number(ssh.port || 22); const dbPort = Number(db.port || 5432)
  if (![port,dbPort].every(n => Number.isInteger(n) && n >= 1 && n <= 65535)) return fail('unsupported')
  if (input.mode === 'sudo-postgres' && db.username !== 'postgres') return fail('denied')
  if (input.mode === 'password' && (typeof db.password !== 'string' || !db.password || /[\r\n\0]/.test(db.password))) return fail('unsupported')
  if (knownHosts === undefined) { try { knownHosts = await readFile(join(homedir(), '.ssh/known_hosts'), 'utf8') } catch { knownHosts = '' } }
  const privateValues = [ssh.password,ssh.privateKey,ssh.passphrase,ssh.host,ssh.username,db.password,db.host,db.username,db.database].filter(value => typeof value === 'string' && value)
  return new Promise(resolve => {
    const connection = new ClientClass(); let done = false; let hostRejected = false; let channel
    const finish = result => { if (done) return; done = true; clearTimeout(timer); channel?.destroy(); connection.end(); connection.destroy(); resolve(result) }
    const timer = setTimeout(() => finish(fail('timeout')), timeoutMs)
    connection.on('error', () => finish(fail(hostRejected ? 'host-key-required' : 'unavailable')))
    connection.on('close', () => { if (!done) finish(fail(hostRejected ? 'host-key-required' : 'unavailable')) })
    connection.on('ready', () => {
      // The command is fixed by this adapter. No executor command or shell interpolation is accepted.
      // sudo is non-interactive and relies solely on existing server permission; no sudoers change.
      const prefix = input.mode === 'sudo-postgres' ? '/usr/bin/sudo -n -u postgres ' : ''
      const environment = `/usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C PGAPPNAME=Omni-Cracha-Executor PGCONNECT_TIMEOUT=5 PGOPTIONS='-c statement_timeout=5000 -c lock_timeout=1000 -c default_transaction_read_only=on -c search_path=pg_catalog'`
      const psql = `/usr/bin/psql -X -w -q -A -t -v ON_ERROR_STOP=1 -p ${dbPort} -U ${quote(db.username)} -d ${quote(db.database)}`
      // In password mode the shell reads exactly one private line over the encrypted stdin,
      // then psql receives SQL. Password is absent even from the SSH exec command string.
      const command = input.mode === 'sudo-postgres' ? `${prefix}${environment} ${psql}`
        : `${environment} /bin/sh -c ${quote(`IFS= read -r PGPASSWORD; export PGPASSWORD; exec ${psql} -h 127.0.0.1`)}`
      connection.exec(command, { pty: false }, (error, stream) => {
        if (error) return finish(fail('unavailable'))
        if (done) { stream.destroy(); return }
        channel = stream; let output = ''; let size = 0; let errorSize = 0
        stream.on('data', chunk => { size += chunk.length; if (size > 48000) finish(fail('unavailable')); else output += chunk.toString('utf8') })
        stream.stderr.on('data', chunk => { errorSize += chunk.length; if (errorSize > 48000) finish(fail('unavailable')) })
        stream.on('error', () => finish(fail('unavailable')))
        stream.on('close', code => {
          if (code !== 0) return finish(fail('unavailable'))
          try { const data = sanitize(JSON.parse(output), privateValues); finish({ outcome: 'completed', operation: input.operation, data }) }
          catch { finish(fail('unavailable')) }
        })
        stream.end((input.mode === 'password' ? `${db.password}\n` : '') + `BEGIN READ ONLY;\n${input.sql}\nCOMMIT;\n`)
      })
    })
    connection.connect({ host: ssh.host, port, username: ssh.username, password: ssh.password, privateKey: ssh.privateKey, passphrase: ssh.passphrase,
      readyTimeout: 6000, keepaliveInterval: 3000, keepaliveCountMax: 2, tryKeyboard: false, agentForward: false,
      hostVerifier: key => { const accepted = trustedHostKey(ssh.host,port,key,knownHosts,ssh.hostKeySha256); hostRejected = !accepted; return accepted }
    })
  })
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let raw = ''; let size = 0
  try {
    for await (const chunk of process.stdin) { size += chunk.length; if (size > 20000) throw new Error(); raw += chunk.toString('utf8') }
    const input = JSON.parse(raw); raw = ''
    process.stdout.write(JSON.stringify(await executeOverSsh(input)) + '\n')
  } catch { process.stdout.write(JSON.stringify({ outcome: 'unavailable', data: null }) + '\n'); process.exitCode = 1 }
}
