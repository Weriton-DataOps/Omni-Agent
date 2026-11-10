// Entrega de um pedido a uma sessão viva do Claude Code (F2, plano 4a, T6). Um `claude -p` de vida curta,
// só com Read, SendMessage e ListAgents, lê o pedido gravado e manda o texto exato para a sessão pelo nome.
// A ordem vai pelo stdin (nada de texto do pedido na linha de comando). Sucesso é ENVIADO sem FALHOU.
// O filho nunca herda ELECTRON_RUN_AS_NODE (a ilha roda no Electron e os hooks do claude quebrariam).
import { spawn } from 'node:child_process'
import { join } from 'node:path'

export const LIMITE_ENTREGA_MS = 10 * 60_000

export function claudePadrao(env = process.env) {
  return env.OMNI_CLAUDE_EXE || join(env.APPDATA ?? '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
}

function matarArvore(filho) {
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/PID', String(filho.pid), '/T', '/F'], { windowsHide: true }).on('error', () => {}) } catch { /* já saiu */ }
  } else {
    try { filho.kill('SIGKILL') } catch { /* já saiu */ }
  }
}

function resultado(saida, erro) {
  const ultima = saida.trim().split('\n').filter(Boolean).pop()
  if (ultima) {
    try { return String(JSON.parse(ultima).result ?? '') } catch { /* cai no stderr */ }
  }
  return erro.trim().slice(-300)
}

export function entregar(nome, arquivoPedido, { claude, pastaPedidos, cwd = pastaPedidos, limiteMs = LIMITE_ENTREGA_MS, iniciar = spawn, env = process.env } = {}) {
  const ordem = [
    `Leia com a ferramenta Read o arquivo ${arquivoPedido} e envie o conteúdo EXATO dele, sem mudar nem acrescentar nada,`,
    `com a ferramenta SendMessage para "${nome}" (to: "${nome}").`,
    'Depois responda só ENVIADO — ou FALHOU: <motivo>, se a ferramenta recusar.'
  ].join(' ')
  const ambiente = { ...env }
  delete ambiente.ELECTRON_RUN_AS_NODE
  return new Promise((resolver) => {
    let fechado = false
    const fim = (r) => { if (!fechado) { fechado = true; clearTimeout(limite); resolver(r) } }
    let filho
    try {
      filho = iniciar(claude ?? claudePadrao(env), ['-p', '--output-format', 'json', '--allowedTools', 'Read', 'SendMessage', 'ListAgents', '--add-dir', pastaPedidos],
        { cwd, env: ambiente, windowsHide: true })
    } catch (erro) {
      resolver({ ok: false, motivo: String(erro.message).slice(0, 300) })
      return
    }
    const limite = setTimeout(() => {
      matarArvore(filho)
      fim({ ok: false, motivo: `a entrega passou de ${limiteMs} ms` })
    }, limiteMs)
    let saida = ''
    let erro = ''
    filho.stdout.setEncoding('utf8').on('data', (d) => { saida += d })
    filho.stderr.setEncoding('utf8').on('data', (d) => { erro += d })
    filho.stdin.on('error', () => { /* o filho morreu antes de ler a ordem; o close conta a história */ })
    filho.on('error', (e) => fim({ ok: false, motivo: String(e.message).slice(0, 300) }))
    filho.on('close', () => {
      const r = resultado(saida, erro)
      fim(/ENVIADO/.test(r) && !/FALHOU/.test(r) ? { ok: true } : { ok: false, motivo: r.slice(0, 300) || 'saída vazia da entrega' })
    })
    filho.stdin.end(ordem)
  })
}
