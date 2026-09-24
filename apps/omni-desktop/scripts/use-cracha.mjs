// Public executor client. It never reads a credential, file with secrets, or environment credential.
import { connect } from 'node:net'
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
export async function useCracha(args, cwd = process.cwd()) {
  const options = {}
  const allowed = new Set(['pipe','grant','session','task','access','operation','page','schema','table','column','call'])
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i]?.slice(2)
    if (!args[i]?.startsWith('--') || !allowed.has(name) || !args[i + 1] || options[name]) throw new Error('Argumentos inválidos do cliente Crachá.')
    options[name] = args[i + 1]
  }
  if (!/^\\\\\.\\pipe\\omni-cracha-[a-f0-9-]{36}$/i.test(options.pipe || '')) throw new Error('Ponte local inválida.')
  const action = options.operation === 'postgres.catalog' ? { kind: options.operation, page: Number(options.page || 0) }
    : { kind: options.operation, schema: options.schema, table: options.table, column: options.column }
  const request = { grant: options.grant, sessionId: options.session, taskId: options.task, workspace: await realpath(cwd), access: options.access, callId: options.call || randomUUID(), action }
  return new Promise((resolve, reject) => {
    const socket = connect(options.pipe); let buffer = ''; let done = false
    const finish = (error, result) => { if (done) return; done = true; clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve({ callId: request.callId, ...result }) }
    const timer = setTimeout(() => finish(new Error('A ponte não respondeu. Não repita automaticamente a operação.')), 30_000)
    socket.setEncoding('utf8')
    socket.once('connect', () => socket.write(JSON.stringify(request) + '\n'))
    socket.on('data', chunk => {
      buffer += chunk
      if (Buffer.byteLength(buffer) > 60_000) return finish(new Error('Resposta privada acima do limite.'))
      const end = buffer.indexOf('\n'); if (end < 0) return
      try { const response = JSON.parse(buffer.slice(0, end)); if (response.ok !== true) throw new Error(); finish(null, response) }
      catch { finish(new Error('Uso privado recusado. Consulte o vínculo e a validade no Omni.')) }
    })
    socket.once('error', () => finish(new Error('Ponte privada indisponível; mantenha o Omni aberto.')))
    socket.once('end', () => { if (!done) finish(new Error('Ponte encerrada sem recibo. Não repita automaticamente.')) })
  })
}
if (process.argv[1]?.replace(/\\/g, '/').endsWith('/use-cracha.mjs')) {
  try { const response = await useCracha(process.argv.slice(2)); process.stdout.write(JSON.stringify(response) + '\n'); if (response.result?.outcome !== 'completed') process.exitCode = 2 }
  catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1 }
}
