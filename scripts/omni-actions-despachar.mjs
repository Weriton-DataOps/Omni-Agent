#!/usr/bin/env node
// Omni — despacho de uma execução do Actions (22/10). A tela grava a execução "na fila" e chama isto,
// escondido. Aqui o Omni escolhe onde o trabalho mora (sessão do VS Code aberta na pasta do projeto, ou
// a do Actions, ou a ociosa mais nova do Omni), monta o pedido com o contexto do ponto e do projeto e o
// entrega pelo canal entre sessões. O Overcore entra no lugar da sessão quando estiver pronto.
//
// A entrega usa uma sessão curta do Claude Code só com Read + SendMessage: o canal entre sessões não é
// uma API pública, e é assim que a ponte do WhatsApp já fala com as sessões abertas (provado em 28/09).
// Uso: node scripts/omni-actions-despachar.mjs <id> [--seco]   (--seco: escolhe e monta, não entrega)
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const ilha = (nome) => require(fileURLToPath(new URL(`../apps/omni-ilha/${nome}`, import.meta.url)))
const { lerPonto, RAIZ } = ilha('pontos.js')
const { lerProjetos } = ilha('projetos.js')
const { sessoesVivas } = ilha('sessoes.js')
const ex$ = ilha('execucoes.js')

const OMNI = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '')
const SCRIPT_ACTIONS = fileURLToPath(new URL('./omni-actions.mjs', import.meta.url))
const CLAUDE = process.env.OMNI_CLAUDE_EXE || join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
const ESTADO = join(process.env.APPDATA, 'omni', 'actions')
mkdirSync(join(ESTADO, 'pedidos'), { recursive: true })
mkdirSync(join(ESTADO, 'logs'), { recursive: true })
const log = (t) => appendFileSync(join(ESTADO, 'logs', 'despacho.log'), `${new Date().toISOString()} ${t}\n`)

delete process.env.ELECTRON_RUN_AS_NODE // veio da ilha; o claude.exe e os hooks dele não podem herdar
const id = process.argv[2]
const seco = process.argv.includes('--seco')

function entregar(nome, arquivoPedido) {
  const ordem = [
    `Leia com a ferramenta Read o arquivo ${arquivoPedido} e envie o conteúdo EXATO dele, sem mudar nem acrescentar nada,`,
    `com a ferramenta SendMessage para "${nome}" (to: "${nome}").`,
    'Depois responda só ENVIADO — ou FALHOU: <motivo>, se a ferramenta recusar.',
  ].join(' ')
  return new Promise((resolve) => {
    const p = spawn(CLAUDE, ['-p', '--output-format', 'json', '--allowedTools', 'Read', 'SendMessage', 'ListAgents', '--add-dir', ESTADO], { cwd: RAIZ, windowsHide: true })
    let saida = ''; let erro = ''
    const limite = setTimeout(() => {
      try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true }) } catch { /* já saiu */ }
      resolve({ ok: false, motivo: 'a entrega passou de 10 min' })
    }, 10 * 60_000)
    p.stdout.on('data', (d) => { saida += d })
    p.stderr.on('data', (d) => { erro += d })
    p.on('error', (e) => { clearTimeout(limite); resolve({ ok: false, motivo: e.message }) })
    p.on('close', () => {
      clearTimeout(limite)
      let r = ''
      try { r = String(JSON.parse(saida.trim().split('\n').filter(Boolean).pop()).result || '') } catch { r = erro.trim().slice(-300) }
      resolve(/ENVIADO/.test(r) && !/FALHOU/.test(r) ? { ok: true } : { ok: false, motivo: r.slice(0, 300) || 'saída vazia da entrega' })
    })
    p.stdin.end(ordem)
  })
}

try {
  const ex = ex$.ler(id)
  if (!ex) throw new Error(`execução ${id} não existe`)
  if (ex.estado !== 'na fila') { log(`${id}: estado ${ex.estado}, nada a despachar`); process.exit(0) }
  const projeto = ex.projeto ? lerProjetos().projetos.find((p) => p.nome.toLowerCase() === ex.projeto.toLowerCase()) : null
  const ponto = ex.slug ? lerPonto(ex.slug) : null
  const vivas = sessoesVivas()
  // resposta a uma execução já entregue: volta para a mesma sessão, se ela ainda estiver aberta
  const ultimo = ex.eventos[ex.eventos.length - 1]
  const resposta = ultimo?.resposta || ''
  let destino = ex.destino && vivas.find((s) => s.nome === ex.destino.nome) ? { ...vivas.find((s) => s.nome === ex.destino.nome), motivo: 'a mesma sessão que já está no trabalho' } : null
  if (!destino) destino = ex$.escolherDestino(vivas, { pastaProjeto: projeto?.pasta || '', pastaActions: RAIZ, pastaOmni: OMNI })
  if (!destino) {
    const onde = projeto?.pasta || RAIZ
    ex$.atualizar(id, { estado: 'sem sessão', nota: `nenhuma sessão do VS Code aberta para receber; abra uma em ${onde} e mande de novo` })
    log(`${id}: sem sessão (${onde})`)
    process.exit(0)
  }
  const pedido = ex$.montarPedido(ex, { projeto, ponto, scriptActions: SCRIPT_ACTIONS, resposta: resposta && ex.destino ? resposta : '' })
  const arquivoPedido = join(ESTADO, 'pedidos', `${id}-${ex.eventos.length}.md`)
  writeFileSync(arquivoPedido, pedido, 'utf8')
  if (seco) { console.log(JSON.stringify({ destino, arquivoPedido }, null, 1)); process.exit(0) }
  log(`${id}: entregando a ${destino.nome} (${destino.motivo})`)
  const r = await entregar(destino.nome, arquivoPedido)
  if (r.ok) ex$.atualizar(id, { estado: 'enviada', nota: `entregue a ${destino.nome} (${destino.motivo})`, destino: { nome: destino.nome, cwd: destino.cwd, motivo: destino.motivo } })
  else ex$.atualizar(id, { estado: 'falhou', nota: `a entrega para ${destino.nome} falhou: ${r.motivo}` })
  log(`${id}: ${r.ok ? 'enviada' : `falhou — ${r.motivo}`}`)
} catch (e) {
  log(`${id}: erro — ${e.message}`)
  try { ex$.atualizar(id, { estado: 'falhou', nota: `despacho: ${e.message}` }) } catch { /* execução ilegível */ }
  process.exit(1)
}
