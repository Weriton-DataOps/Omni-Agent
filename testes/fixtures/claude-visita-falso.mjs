// claude falso para o lançador das tarefas dos agentes (plano 5c): lê o roteiro do stdin, anota o que viu
// (argv, cwd, as variáveis de ambiente que importam) e age conforme CLAUDE_FALSO_MODO:
// ok → grava <OMNI_ACTIONS>/visitas/<OMNI_VISITA_ID>.md e responde o resumo; sem-registro → responde sem
// gravar; erro → sai 2; dorme → fica 60 s (o teto do lançador mata).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const VISTAS = ['ORACULO_API', 'ORACULO_TOKEN', 'OMNI_VISITA_ID', 'OMNI_ACTIONS', 'OMNI_VISITA_SECO', 'ELECTRON_RUN_AS_NODE']

let ordem = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (parte) => { ordem += parte })
process.stdin.on('end', () => {
  const modo = process.env.CLAUDE_FALSO_MODO ?? 'ok'
  if (process.env.CLAUDE_FALSO_REGISTRO) {
    const env = Object.fromEntries(VISTAS.filter((n) => n in process.env).map((n) => [n, process.env[n]]))
    writeFileSync(process.env.CLAUDE_FALSO_REGISTRO, JSON.stringify({ ordem, argv: process.argv.slice(2), cwd: process.cwd(), env }))
  }
  if (modo === 'dorme') { setTimeout(() => {}, 60_000); return }
  if (modo === 'erro') { process.stderr.write('claude: credencial expirada\n'); process.exitCode = 2; return }
  if (modo === 'ok') {
    const pasta = join(process.env.OMNI_ACTIONS, 'visitas')
    mkdirSync(pasta, { recursive: true })
    writeFileSync(join(pasta, `${process.env.OMNI_VISITA_ID}.md`), '# visita do falso\n')
  }
  process.stdout.write(`${JSON.stringify({ type: 'result', result: 'Resumo: feito pelo falso' })}\n`)
})
