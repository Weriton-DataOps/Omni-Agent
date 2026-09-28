// Omni — delegar trabalho a um projeto sem depender de janela do VS Code aberta.
// Recado entre sessões pode ficar segurado numa janela esperando aprovação na tela (sessões em modos de
// permissão diferentes). Aqui a sessão de trabalho sobe em segundo plano, direto na pasta do projeto, e o
// resultado vai sozinho para o WhatsApp do Weriton, assinado pelo projeto. Responder citando o resultado
// continua a mesma sessão (livro da ponte, origem 'ponte').
//   node delegado.mjs --projeto <pasta> --tarefa <arquivo.txt> [--continuar <sessionId>]
// Volta na hora com {sessao}; o trabalho segue destacado. Permissões liberadas por decisão do Weriton
// (28/09/2026): só a ponte, acionada pelo número dele, dispara isto.
import { readFileSync, existsSync, statSync, appendFileSync, mkdirSync } from 'node:fs'
import { basename } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { arquivo, anotar, enviarAoDono } from './config.mjs'

const CLAUDE = process.env.OMNI_CLAUDE_EXE || `${process.env.APPDATA}\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`
const LIMITE_MS = 60 * 60_000
const argumento = nome => { const k = process.argv.indexOf(nome); return k > -1 ? process.argv[k + 1] : null }
mkdirSync(arquivo('logs'), { recursive: true })
const log = (...p) => appendFileSync(arquivo('logs/delegado.log'), `${new Date().toISOString()} ${p.join(' ')}\n`)

const projeto = argumento('--projeto'), tarefa = argumento('--tarefa'), continuar = argumento('--continuar')
if (!projeto || !existsSync(projeto) || !statSync(projeto).isDirectory()) { console.error(`pasta do projeto não encontrada: ${projeto}`); process.exit(1) }
if (!tarefa || !existsSync(tarefa)) { console.error(`arquivo da tarefa não encontrado: ${tarefa}`); process.exit(1) }
const nome = basename(projeto)

if (!process.argv.includes('--executar')) {
  // Lançador: dispara o executor destacado e volta na hora.
  const sid = continuar ? null : randomUUID()
  const filho = spawn(process.execPath, [fileURLToPath(import.meta.url), '--executar', '--projeto', projeto, '--tarefa', tarefa, ...(sid ? ['--sessao', sid] : []), ...(continuar ? ['--continuar', continuar] : [])], { detached: true, stdio: 'ignore', windowsHide: true })
  filho.unref()
  log(`↗ delegado a ${nome}${sid ? ` sessão ${sid.slice(0, 8)}` : ` continuando ${continuar.slice(0, 8)}`}`)
  console.log(JSON.stringify({ delegado: true, projeto: nome, sessao: sid || `cópia de ${continuar}` }))
  process.exit(0)
}

// Executor.
const SISTEMA = 'Você recebeu esta tarefa do Weriton pelo WhatsApp, por meio do Omni. Ninguém está na tela: trabalhe até terminar sem pedir confirmação para passos comuns. Ações sem volta (apagar dados, force push, mexer em produção) não faça: descreva e deixe para ele decidir. No fim, responda com um resumo curto do que fez e onde ficou o resultado (arquivos, links) — esse resumo vai para o WhatsApp dele. Se o resultado for um arquivo visual (relatório, apresentação exportada em PDF ou imagem), pode mandá-lo com enviar_arquivo_para_weriton.'
const sid = argumento('--sessao')
const args = [...(continuar ? ['--resume', continuar, '--fork-session'] : ['--session-id', sid]),
  '-p', readFileSync(tarefa, 'utf8'), '--output-format', 'json', '--permission-mode', 'bypassPermissions', '--append-system-prompt', SISTEMA]
const inicio = Date.now()
const p = spawn(CLAUDE, args, { cwd: projeto, windowsHide: true })
let saida = '', erro = ''
const limite = setTimeout(() => p.kill(), LIMITE_MS)
p.stdout.on('data', d => { saida += d })
p.stderr.on('data', d => { erro += d })
p.on('close', async codigo => {
  clearTimeout(limite)
  const minutos = Math.round((Date.now() - inicio) / 60_000)
  let r = null
  try { r = JSON.parse(saida.trim().split('\n').filter(Boolean).pop()) } catch { /* sem JSON */ }
  try {
    if (!r) {
      await enviarAoDono(`⚠️ A tarefa delegada a *${nome}* parou sem resposta (exit ${codigo}, ${minutos} min). ${erro.trim().slice(-300)}`)
      log(`✘ ${nome}: sem resposta (exit ${codigo})`)
      return
    }
    const identidade = `Omni · ${nome}`
    const texto = String(r.result || '').trim() || '(a sessão terminou sem resumo)'
    const waId = await enviarAoDono(`🤖 *${identidade}* · sessão ${String(r.session_id).slice(0, 8)}${r.is_error ? ' · ⚠️ terminou com erro' : ''}\n\n${texto.slice(0, 4000)}`)
    anotar({ waMessageId: waId, sessionId: r.session_id, cwd: projeto, projeto: nome, identidade, origem: 'ponte' })
    log(`← ${nome} sessão ${String(r.session_id).slice(0, 8)} · ${minutos} min · ${texto.length} chars${r.is_error ? ' [erro]' : ''}`)
  } catch (e) { log(`✘ ${nome}: não consegui avisar o Weriton: ${e.message}`) }
})
