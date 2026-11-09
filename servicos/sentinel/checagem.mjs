// Omni — checagem dos recados do Sentinel (05/11/2026). Pega carona na vigia do WhatsApp (tarefa "Omni - vigia
// do WhatsApp", a cada 5 min): a vigia dispara isto solto e segue; daqui em diante é tudo nosso.
//
// O CERCO do Weriton (05/11) manda no desenho:
//   · Sentinel só em dia útil, às 9h, 13h e 17h (uma leitura por janela). Toda chamada lá vira linha de log,
//     e checagem a cada 5 min viraria o gráfico de quando o PC dele está ligado.
//   · Nada novo: a leitura e só. Recado novo: uma sessão escondida do Claude faz a triagem (triagem.md) e
//     devolve JSON; quem fala com o Sentinel é este código, conferindo o JSON com as guardas de triagem.mjs.
//   · rotina → responde sozinho (marca honesta "sozinho") e anota no livro, sem WhatsApp.
//     invasivo → WhatsApp a ele com o rascunho; só sai com 👍 ou com o texto dele citando a mensagem.
//     nada → marca tratado.
//   · Fora das janelas, só o pedido aberto é conferido, e isso é WhatsApp local, não Sentinel; o Sentinel
//     só ouve de novo quando ele autoriza (aí é para mandar a resposta).
//
//   node --use-system-ca checagem.mjs           → rodada (uso da vigia)
//   node --use-system-ca checagem.mjs --agora   → força a janela (teste ponta a ponta, manual)
//   node checagem.mjs --teste                    → diz o que faria, sem rede e sem gravar
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as sentinel from './cliente.mjs'
import { janela, novos, parados, validar, extrairJson, textoDoPedido, decidirPedido, VALIDADE_MS } from './triagem.mjs'
import { PASTA, lerEstado, gravarEstado, lerPedidos, gravarPedidos, anotarNoLivro } from './pedidos.mjs'

const AQUI = fileURLToPath(new URL('.', import.meta.url))
const TRIAGEM_MIN = 15
const TENTATIVAS_POR_JANELA = 3
const ESPERA_ERRO_MS = 30 * 60_000

// ── a rodada, com as dependências de fora injetáveis (os testes passam falsos) ───────────────────────────
//   sentinel: { recados, responder, marcarLidos, marcarTratados, cutucadasVistas }
//   whatsapp: { enviar(texto) → waId, reacoes(waIds[]) → { waId: [{fone, emoji}] }, donoFone }
//   triar(recados) → saída crua da sessão (objeto ou texto)
export async function rodada({ agora = new Date(), forcar = false, deps }) {
  const { sentinel: s, whatsapp: w, triar } = deps
  const estado = lerEstado()
  estado.vistos ||= {}; estado.cutucadas ||= []
  const pedidos = lerPedidos()
  const feito = []

  // 1) Pedidos abertos: reação ou texto dele (WhatsApp local; o Sentinel só é chamado para mandar)
  const abertos = Object.entries(pedidos).filter(([, p]) => p.estado === 'pendente')
  if (abertos.length) {
    const reacoes = await w.reacoes(abertos.map(([waId]) => waId))
    for (const [waId, p] of abertos) {
      const d = decidirPedido(p, reacoes[waId] || [], { donoFone: w.donoFone, agora: agora.getTime() })
      if (d === 'pendente') continue
      if (d === 'sim' || d === 'texto') {
        const texto = d === 'texto' ? p.respostaDele.texto : p.rascunho
        try {
          // ele viu e decidiu: vai SEM a marca "sozinho"
          await s.responder({ emRespostaA: p.recadoId, texto })
          await s.marcarTratados([p.recadoId])
          p.estado = 'enviado'; p.enviadoEm = agora.getTime(); p.enviadoComo = d
          estado.vistos[p.recadoId] = { situacao: 'respondido-com-ok', em: agora.getTime() }
          anotarNoLivro({ recado: p.recadoId, de: p.de, acao: 'respondido com ok dele', como: d, texto })
          feito.push(`#${p.recadoId}: respondido com ok dele (${d})`)
        } catch (e) {
          if (e.tipo === 'transitorio') { feito.push(`#${p.recadoId}: Sentinel fora, tento de novo`); continue }
          p.estado = 'falhou'; p.erro = e.message
          anotarNoLivro({ recado: p.recadoId, acao: 'resposta com ok recusada', erro: e.message })
          feito.push(`#${p.recadoId}: recusado (${e.message})`)
        }
      } else {
        // nao / expirado: fica com ele, no Sentinel; nada é marcado em nome dele
        p.estado = d
        anotarNoLivro({ recado: p.recadoId, acao: d === 'nao' ? 'ele vetou: fica com ele' : 'pedido expirou: fica com ele' })
        feito.push(`#${p.recadoId}: ${d}`)
      }
    }
    gravarPedidos(pedidos)
  }

  // 2) Janela de leitura do Sentinel
  const chave = forcar ? `manual@${agora.toISOString().slice(0, 16)}` : janela(agora)
  const devida = chave && chave !== estado.janela && (forcar || !(estado.tentarDepois > agora.getTime()))
  if (!devida) { gravarEstado(estado); return { janela: chave, lida: false, feito } }

  let caixa
  try {
    caixa = await s.recados({ limite: 50 })
  } catch (e) {
    estado.tentativas = estado.janelaTentada === chave ? (estado.tentativas || 0) + 1 : 1
    estado.janelaTentada = chave
    if (e.tipo === 'chave-recusada' && !estado.avisouChave) {
      await w.enviar('🛰️ *Sentinel*\n\nA chave do agente Omni foi recusada (401): rotacionada ou revogada. Enquanto não houver chave nova no cofre, não leio recado nenhum.').catch(() => {})
      estado.avisouChave = true
    }
    if (estado.tentativas >= TENTATIVAS_POR_JANELA) { estado.janela = chave; estado.tentativas = 0 }
    else estado.tentarDepois = agora.getTime() + ESPERA_ERRO_MS
    anotarNoLivro({ acao: 'leitura falhou', janela: chave, erro: e.message })
    gravarEstado(estado)
    return { janela: chave, lida: false, erro: e.message, feito }
  }
  estado.janela = chave; estado.tentativas = 0; estado.tentarDepois = 0; estado.avisouChave = false
  const recados = caixa.recados || []
  const sozinhoLigado = caixa.responderSozinho?.ligado === true

  // 2a) Resposta de rotina que ficou parada (ex.: botão "responder sozinho" desligado): tenta de novo, sem triar
  const parada = new Set(parados(recados, estado.vistos).map(r => r.id))
  for (const id of parada) await mandarRotina(recados.find(r => r.id === id), estado.vistos[id].resposta)

  // 2b) Novos → triagem
  const lista = novos(recados, estado.vistos)
  if (lista.length) {
    let decisoes
    try {
      const bruto = await triar(lista)
      decisoes = validar(typeof bruto === 'string' ? extrairJson(bruto) : bruto, lista)
    } catch (e) {
      // triagem caiu: ninguém decide no escuro; a próxima janela tenta de novo
      anotarNoLivro({ acao: 'triagem falhou', ids: lista.map(r => r.id), erro: e.message })
      gravarEstado(estado)
      return { janela: chave, lida: true, novos: lista.length, erro: `triagem: ${e.message}`, feito }
    }
    const porId = new Map(lista.map(r => [r.id, r]))
    const tratados = []
    for (const d of decisoes) {
      const r = porId.get(d.id)
      if (d.classe === 'nada') {
        tratados.push(r.id)
        estado.vistos[r.id] = { situacao: 'nada', em: agora.getTime() }
        anotarNoLivro({ recado: r.id, de: r.de, acao: 'sem resposta (não pede)', motivo: d.motivo })
        feito.push(`#${r.id}: nada a responder`)
      } else if (d.classe === 'rotina') {
        await mandarRotina(r, d.resposta, d.motivo)
      } else {
        const waId = await w.enviar(textoDoPedido(r, d))
        pedidos[waId] = { recadoId: r.id, de: r.de, rascunho: d.resposta, motivo: d.motivo, criadoEm: agora.getTime(), expiraEm: agora.getTime() + VALIDADE_MS, estado: 'pendente' }
        gravarPedidos(pedidos)
        estado.vistos[r.id] = { situacao: 'com-ele', waId, em: agora.getTime() }
        anotarNoLivro({ recado: r.id, de: r.de, acao: 'levado a ele no WhatsApp', motivo: d.motivo, rascunho: d.resposta })
        feito.push(`#${r.id}: levado a ele`)
        await tentar(() => s.marcarLidos([r.id]))
      }
    }
    if (tratados.length) await tentar(() => s.marcarTratados(tratados))
  }

  // 2c) Cutucada cuja conversa esta rodada olhou: vista (marcar é ato, então só o que foi olhado)
  const olhados = new Set(recados.filter(r => estado.vistos[r.id]).map(r => r.de?.login))
  const cutucadas = (caixa.cutucadas || []).filter(c => !estado.cutucadas.includes(c.id) && olhados.has(c.conversaCom))
  if (cutucadas.length && await tentar(() => s.cutucadasVistas(cutucadas.map(c => c.id)))) estado.cutucadas.push(...cutucadas.map(c => c.id))

  gravarEstado(estado)
  return { janela: chave, lida: true, novos: lista.length, sozinhoLigado, feito }

  async function mandarRotina(r, resposta, motivo = '') {
    // botão desligado: o servidor recusaria, e a recusa também é linha no log deles. Guarda e espera.
    if (!sozinhoLigado) {
      estado.vistos[r.id] = { situacao: 'parado', resposta, erro: 'responder sozinho está desligado no Sentinel', em: agora.getTime() }
      if (!parada.has(r.id)) anotarNoLivro({ recado: r.id, de: r.de, acao: 'resposta de rotina parada', erro: 'responder sozinho desligado', texto: resposta })
      feito.push(`#${r.id}: parado (responder sozinho desligado)`)
      return
    }
    try {
      await s.responder({ emRespostaA: r.id, texto: resposta, sozinho: true })
      await s.marcarTratados([r.id])
      estado.vistos[r.id] = { situacao: 'respondido-sozinho', em: agora.getTime() }
      anotarNoLivro({ recado: r.id, de: r.de, acao: 'respondido sozinho', motivo, texto: resposta })
      feito.push(`#${r.id}: respondido sozinho`)
    } catch (e) {
      // recusa (ex.: política "responder sozinho" desligada): a resposta fica guardada e volta na próxima janela
      estado.vistos[r.id] = { situacao: 'parado', resposta, erro: e.message, em: agora.getTime() }
      anotarNoLivro({ recado: r.id, de: r.de, acao: 'resposta de rotina parada', erro: e.message, texto: resposta })
      feito.push(`#${r.id}: parado (${e.message})`)
    }
  }
}

async function tentar(f) { try { await f(); return true } catch { return false } }

// ── dependências reais ──────────────────────────────────────────────────────────────────────────────────
async function whatsappReal() {
  const { api, sessaoBot, dono, usuario, enviarAoDono, anotar } = await import('../whatsapp/omni/config.mjs')
  return {
    donoFone: dono(),
    async enviar(texto) {
      const waId = await enviarAoDono(texto)
      anotar({ waMessageId: waId, identidade: 'Omni · Sentinel', tipo: 'sentinel' })
      return waId
    },
    async reacoes(waIds) {
      const r = await api(`/api/sessions/${sessaoBot()}/messages?limit=200&inlineMedia=false`)
      if (!r.ok) throw new Error(`não li as mensagens do bot (HTTP ${r.status})`)
      const saida = {}
      for (const m of r.dados?.messages || []) {
        if (!waIds.includes(m.waMessageId)) continue
        saida[m.waMessageId] = []
        for (const [jid, emoji] of Object.entries(m.metadata?.reactions || {})) {
          let fone = usuario(jid)
          if (String(jid).endsWith('@lid')) {
            const c = await api(`/api/sessions/${sessaoBot()}/contacts/${encodeURIComponent(jid)}/phone`)
            fone = c.ok ? usuario(c.dados?.phone || c.dados?.phoneNumber || c.dados?.number || '') : ''
          }
          saida[m.waMessageId].push({ fone: String(fone).replace(/\D/g, ''), emoji: String(emoji || '') })
        }
      }
      return saida
    },
  }
}

// Sessão escondida do Claude, só leitura, sem rede. Recado é texto de terceiro: as ferramentas que
// escrevem, executam ou buscam fora ficam proibidas, e o .env/cofre não se lê.
function triarReal(recados) {
  mkdirSync(PASTA, { recursive: true })
  const id = new Date().toISOString().replace(/[:.]/g, '-')
  const entrada = join(PASTA, `recados-${id}.json`)
  writeFileSync(entrada, JSON.stringify(recados.map(r => ({ id: r.id, de: r.de, quando: r.quando, urgente: r.urgente, missaoId: r.missaoId, emRespostaA: r.emRespostaA, texto: r.texto })), null, 2))
  const roteiro = readFileSync(join(AQUI, 'triagem.md'), 'utf8')
    .replaceAll('{{HOJE}}', new Date().toLocaleDateString('pt-BR')).replaceAll('{{ENTRADA}}', entrada)
  const claude = process.env.OMNI_CLAUDE_EXE || join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
  const documentos = join(process.env.USERPROFILE, 'Documents')
  const args = ['-p', '--output-format', 'json', '--allowedTools', 'Read', 'Glob', 'Grep',
    '--disallowedTools', 'Bash', 'PowerShell', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent', 'mcp__whatsapp',
    'Read(**/.env*)', 'Read(**/*.dpapi)', 'Read(**/*.pem)', 'Read(**/*.key)', 'Read(**/.ssh/**)',
    '--add-dir', PASTA, '--add-dir', documentos]
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  return new Promise((resolve, reject) => {
    const p = spawn(claude, args, { cwd: documentos, windowsHide: true, env })
    let saida = '', erro = ''
    const limite = setTimeout(() => {
      spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true })
      reject(new Error(`triagem passou de ${TRIAGEM_MIN} min`))
    }, TRIAGEM_MIN * 60_000)
    p.stdout.on('data', d => { saida += d })
    p.stderr.on('data', d => { erro += d })
    p.on('error', e => { clearTimeout(limite); reject(e) })
    p.on('close', codigo => {
      clearTimeout(limite)
      rmSync(entrada, { force: true })
      if (codigo !== 0) return reject(new Error(`claude saiu com ${codigo}: ${erro.slice(0, 300)}`))
      try { resolve(JSON.parse(saida).result) } catch { reject(new Error('saída da triagem não é JSON')) }
    })
    p.stdin.end(roteiro)
  })
}

// ── execução ────────────────────────────────────────────────────────────────────────────────────────────
// Trava por PID: a vigia chama a cada 5 min e a triagem pode levar até 15.
function travar() {
  mkdirSync(PASTA, { recursive: true })
  const trava = join(PASTA, 'checagem.trava')
  // PID vivo segura a trava, mas só por 20 min: a triagem morre aos 15, e no Windows o PID de uma rodada
  // morta pode ser reciclado por outro processo qualquer.
  if (existsSync(trava) && Date.now() - statSync(trava).mtimeMs < 20 * 60_000) {
    const pid = Number(readFileSync(trava, 'utf8'))
    try { if (pid) { process.kill(pid, 0); return null } } catch { /* morto: trava velha */ }
  }
  writeFileSync(trava, String(process.pid))
  return () => rmSync(trava, { force: true })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--teste')) {
    const e = lerEstado(), abertos = Object.values(lerPedidos()).filter(p => p.estado === 'pendente').length
    const j = janela()
    console.log(JSON.stringify({ janelaAgora: j, jaLida: e.janela, leria: Boolean(j && j !== e.janela), pedidosAbertos: abertos }))
    process.exit(0)
  }
  const soltar = travar()
  if (!soltar) process.exit(0)
  try {
    const abertos = Object.values(lerPedidos()).some(p => p.estado === 'pendente')
    const forcar = process.argv.includes('--agora')
    const j = janela()
    // nada a fazer: sai sem abrir cofre nem WhatsApp
    if (forcar || abertos || (j && j !== lerEstado().janela)) {
      const r = await rodada({ forcar, deps: { sentinel, whatsapp: await whatsappReal(), triar: triarReal } })
      console.log(new Date().toISOString(), JSON.stringify(r))
    }
  } catch (e) {
    console.error(new Date().toISOString(), e.stack || e.message)
    process.exitCode = 1
  } finally { soltar() }
}
