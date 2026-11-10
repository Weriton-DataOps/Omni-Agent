// claude falso para o teste da entrega: lê a ordem do stdin, anota o que viu e responde como o
// `claude -p --output-format json` responderia, conforme CLAUDE_FALSO_MODO.
import { writeFileSync } from 'node:fs'

let ordem = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (parte) => { ordem += parte })
process.stdin.on('end', () => {
  const modo = process.env.CLAUDE_FALSO_MODO ?? 'enviado'
  if (process.env.CLAUDE_FALSO_REGISTRO) {
    writeFileSync(process.env.CLAUDE_FALSO_REGISTRO, JSON.stringify({
      ordem, argv: process.argv.slice(2), cwd: process.cwd(), electron: 'ELECTRON_RUN_AS_NODE' in process.env
    }))
  }
  if (modo === 'dorme') { setTimeout(() => {}, 60_000); return }
  if (modo === 'vazio') return
  if (modo === 'erro') { process.stderr.write('claude: credencial expirada\n'); process.exitCode = 1; return }
  const result = modo === 'falhou' ? 'FALHOU: a sessão não existe'
    : modo === 'misto' ? 'Não foi ENVIADO. FALHOU: o SendMessage recusou'
      : 'ENVIADO'
  process.stdout.write(`${JSON.stringify({ type: 'result', result })}\n`)
})
