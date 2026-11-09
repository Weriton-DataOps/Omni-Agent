#!/usr/bin/env node
// Omni — as mãos da visita do Actions (21/10). A visita (sessão escondida do Claude Code) mexe no depósito
// por aqui, e não editando à mão, porque aqui ficam os limites que não dependem da boa vontade dela:
//   - campos do ponto só da lista permitida; histórico só de acréscimo
//   - no máximo 2 propostas de veredito por dia
//   - WhatsApp: no máximo 2 avisos de decisão madura por dia; 1 pedido de risco por visita
//   - aprovação vale uma vez, para o mesmo commit e comando
// Uso: node scripts/omni-actions.mjs <comando> [argumentos]   (saída em JSON)
//   mesa                                         o que a tela mostra (pra você, potencial, projetos…)
//   ponto <slug>                                 o ponto inteiro
//   campo <slug> <Campo> <valor|--apagar>        Estágio, Próximo passo, Potencial, Projeto ligado, Pra você, Status
//   propor-veredito <slug> <texto>               ex.: "arquivar — backtest perdeu do acaso" (2 por dia)
//   historico <slug> <texto>                     linha datada no ## Histórico
//   propor-item <projeto> <texto> [dd/mm/aaaa]   item novo no projetos.md, esperando o ✓ dele
//   avisar <texto>                               WhatsApp de decisão madura (2 por dia)
//   risco --titulo --repo --commit --comando --toca --nivel   pedido de risco (1 por visita)
//   aprovacao <waId> --commit --comando          estado do pedido (não consome)
//   usar <waId> --commit --comando               consome a aprovação: só "sim" libera, e uma vez só
//     nos três, --comando-arquivo <caminho|-> troca o --comando: o texto exato vai em bytes, sem o
//     shell comer as aspas (furo medido em 27/10, ponto claude-duet-agente-proativo)
//   explicar <waId> <texto>                      resposta ao ❓ dele
//   pendentes                                    pedidos de risco ainda abertos
//   execucao <id> --estado andando|concluida|bloqueada|falhou --nota <texto>   (a sessão executora devolve)
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ilha = (nome) => require(fileURLToPath(new URL(`../apps/omni-ilha/${nome}`, import.meta.url)))
const { lerPonto, RAIZ, formatarData, hojeMs } = ilha('pontos.js')
const { montarMesa } = ilha('mesa.js')
const { mexerNoPonto, proporItem } = ilha('escrita.js')

const CAMPOS = new Set(['Estágio', 'Próximo passo', 'Potencial', 'Projeto ligado', 'Pra você', 'Status'])
const ESTAGIOS = new Set(['semente', 'em teste'])
const COTA = join(RAIZ, 'visitas', 'cota.json')
const LIMITE = { propostas: 2, avisos: 2 }
const visita = process.env.OMNI_VISITA_ID || ''

const [, , cmd, ...args] = process.argv
const opcao = (nome) => { const i = args.indexOf(`--${nome}`); return i >= 0 ? args[i + 1] : undefined }
// O comando do pedido de risco é assinado com o commit, então uma aspa comida pelo shell no caminho de
// volta vira "o código ou o comando mudou" — falso alarme que gasta a atenção dele. Com --comando-arquivo
// o texto exato vai e volta em bytes: nada passa por escape. "-" lê da entrada padrão.
const comandoDoPedido = () => {
  const caminho = opcao('comando-arquivo')
  if (caminho === undefined) return opcao('comando')
  if (opcao('comando') !== undefined) throw new Error('use --comando ou --comando-arquivo, não os dois')
  if (!String(caminho || '').trim()) throw new Error('--comando-arquivo: falta o caminho (ou "-" para a entrada padrão)')
  const bruto = readFileSync(caminho === '-' ? 0 : caminho, 'utf8')
  return bruto.replace(/^﻿/, '').replace(/\r?\n$/, '')  // BOM e quebra final são do arquivo, não do comando
}
const sair = (obj, codigo = 0) => { console.log(JSON.stringify(obj, null, 1)); process.exit(codigo) }
const falhar = (erro) => sair({ ok: false, erro: String(erro?.message || erro) }, 1)

// cota do dia: zera quando a data muda
function cota() {
  const hoje = formatarData(hojeMs())
  let c = {}
  try { c = JSON.parse(readFileSync(COTA, 'utf8')) } catch { /* primeira do dia */ }
  if (c.dia !== hoje) c = { dia: hoje, propostas: 0, avisos: 0 }
  return c
}
function gastar(tipo) {
  const c = cota()
  if (c[tipo] >= LIMITE[tipo]) throw new Error(`cota de hoje esgotada: ${LIMITE[tipo]} ${tipo} por dia`)
  c[tipo]++
  mkdirSync(join(RAIZ, 'visitas'), { recursive: true })
  writeFileSync(COTA, JSON.stringify(c))
  return c
}

// visita a seco (cópia do Actions): nada sai para o WhatsApp
const seco = () => { if (process.env.OMNI_VISITA_SECO === '1') throw new Error('visita a seco: WhatsApp desligado') }
const zap = () => import(new URL('../servicos/whatsapp/omni/aprovacoes.mjs', import.meta.url))
const cfg = () => import(new URL('../servicos/whatsapp/omni/config.mjs', import.meta.url))

try {
  switch (cmd) {
    case 'mesa': {
      const m = montarMesa()
      sair({ ok: true, cota: cota(), ...m, ultimaVisita: m.ultimaVisita && { ...m.ultimaVisita, texto: undefined } })
      break
    }
    case 'ponto': {
      const p = lerPonto(args[0])
      if (!p) throw new Error('ponto não encontrado')
      sair({ ok: true, ponto: p })
      break
    }
    case 'campo': {
      const [slug, nome, valor] = args
      // prazo: só preenche o que faltou (ponto criado fora do modelo); prazo existente não se mexe
      if (nome === 'Prazo do veredito') {
        if (!/^\d{2}\/\d{2}\/\d{4}$/.test(String(valor))) throw new Error('Prazo do veredito: dd/mm/aaaa')
        if (lerPonto(slug)?.prazo) throw new Error('o ponto já tem prazo; prazo não se mexe pela visita')
        mexerNoPonto(slug, { campos: { [nome]: valor }, historico: `Visita: prazo do veredito que faltava → ${valor}` })
        sair({ ok: true })
        break
      }
      if (!CAMPOS.has(nome)) throw new Error(`campo não permitido. Use: ${[...CAMPOS].join(', ')}, Prazo do veredito (só se faltar)`)
      if (nome === 'Estágio' && !ESTAGIOS.has(String(valor))) throw new Error('Estágio: semente ou em teste (veredito só pela tela, por ele)')
      if (nome === 'Potencial' && !/^▲{1,3}\s+—\s+\S/.test(String(valor))) throw new Error('Potencial: "▲▲ — motivo" (o motivo é obrigatório)')
      const apagar = valor === '--apagar'
      const r = mexerNoPonto(slug, { campos: { [nome]: apagar ? null : valor }, historico: `Visita: ${nome} ${apagar ? 'limpo' : `→ ${valor}`}` })
      sair({ ok: true, ponto: { slug, estagio: r.estagio, potencial: r.potencial } })
      break
    }
    case 'propor-veredito': {
      const [slug, texto] = args
      if (!/^(vira projeto|entra em .+|arquivar|dormente até \d{2}\/\d{2}\/\d{4})\s+—\s+\S/i.test(String(texto))) throw new Error('proposta: "arquivar — motivo", "dormente até dd/mm/aaaa — motivo", "vira projeto — motivo" ou "entra em <projeto> — motivo"')
      const p = lerPonto(slug)
      if (!p) throw new Error('ponto não encontrado')
      if (p.veredito && p.veredito.tipo !== 'dormente') throw new Error('o ponto já tem veredito')
      if (p.proposta) throw new Error('o ponto já tem proposta esperando por ele')
      const c = gastar('propostas')
      mexerNoPonto(slug, { campos: { 'Proposta de veredito': texto }, historico: `Visita propôs veredito: ${texto}` })
      sair({ ok: true, cota: c })
      break
    }
    case 'historico': {
      const [slug, texto] = args
      if (!String(texto || '').trim()) throw new Error('texto vazio')
      mexerNoPonto(slug, { historico: texto })
      sair({ ok: true })
      break
    }
    case 'propor-item': {
      const [projeto, texto, data] = args
      proporItem(projeto, texto, data)
      sair({ ok: true })
      break
    }
    case 'avisar': {
      seco()
      const texto = String(args[0] || '').trim()
      if (!texto) throw new Error('texto vazio')
      const c = gastar('avisos')
      const { enviarAoDono, anotar } = await cfg()
      const waId = await enviarAoDono(`🧪 *Actions* — ${texto}`)
      anotar({ waMessageId: waId, identidade: 'Actions · visita', tipo: 'aviso' })
      sair({ ok: true, waId, cota: c })
      break
    }
    case 'risco': {
      seco()
      const { pedir } = await zap()
      const r = await pedir({ titulo: opcao('titulo'), repo: opcao('repo'), commit: opcao('commit'), comando: comandoDoPedido(), toca: opcao('toca'), nivel: opcao('nivel'), visita })
      sair({ ok: true, ...r })
      break
    }
    case 'aprovacao': {
      const { consultar } = await zap()
      sair({ ok: true, ...(await consultar(args[0], { commit: opcao('commit'), comando: comandoDoPedido() })) })
      break
    }
    case 'usar': {
      const { consumir } = await zap()
      const r = await consumir(args[0], { commit: opcao('commit'), comando: comandoDoPedido() })
      sair({ ok: r.estado === 'sim', ...r }, r.estado === 'sim' ? 0 : 2)
      break
    }
    case 'explicar': {
      seco()
      const { explicar } = await zap()
      await explicar(args[0], args[1])
      sair({ ok: true })
      break
    }
    case 'execucao': {
      // a sessão que recebeu o trabalho devolve o andamento; a tela do Actions mostra
      const estado = opcao('estado')
      if (!['andando', 'concluida', 'bloqueada', 'falhou'].includes(estado)) throw new Error('--estado andando|concluida|bloqueada|falhou')
      const ex = ilha('execucoes.js').atualizar(args[0], { estado, nota: opcao('nota') || '' })
      sair({ ok: true, id: ex.id, estado: ex.estado })
      break
    }
    case 'pendentes': {
      const { pendentes } = await zap()
      sair({ ok: true, pendentes: pendentes().map(({ waId, titulo, commit, comando, expiraEm, explicadoEm, resposta }) => ({ waId, titulo, commit, comando, expiraEm: new Date(expiraEm).toISOString(), explicado: !!explicadoEm, resposta: resposta?.texto || null })) })
      break
    }
    default:
      falhar('comando desconhecido; veja o cabeçalho de scripts/omni-actions.mjs')
  }
} catch (e) { falhar(e) }
