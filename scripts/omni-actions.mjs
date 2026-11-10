#!/usr/bin/env node
// Omni — o WhatsApp da visita do Actions. O depósito (pontos, mesa, projetos, execuções) mora no Oráculo
// desde a F2 (plano 5c) e é mexido pelo omni-actions.mjs dele; aqui ficam só os limites do WhatsApp,
// que não dependem da boa vontade da visita:
//   - no máximo 2 avisos de decisão madura por dia; 1 pedido de risco por visita
//   - aprovação vale uma vez, para o mesmo commit e comando
// Uso: node scripts/omni-actions.mjs <comando> [argumentos]   (saída em JSON)
//   avisar <texto>                               WhatsApp de decisão madura (2 por dia)
//   risco --titulo --repo --commit --comando --toca --nivel   pedido de risco (1 por visita)
//   aprovacao <waId> --commit --comando          estado do pedido (não consome)
//   usar <waId> --commit --comando               consome a aprovação: só "sim" libera, e uma vez só
//     nos três, --comando-arquivo <caminho|-> troca o --comando: o texto exato vai em bytes, sem o
//     shell comer as aspas (furo medido em 27/10, ponto claude-duet-agente-proativo)
//   explicar <waId> <texto>                      resposta ao ❓ dele
//   pendentes                                    pedidos de risco ainda abertos
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const RAIZ = process.env.OMNI_ACTIONS || join(homedir(), 'Documents', 'Actions')
const COTA = join(RAIZ, 'visitas', 'cota.json')
const LIMITE = { propostas: 2, avisos: 2 }
const DEPOSITO = new Set(['mesa', 'ponto', 'campo', 'propor-veredito', 'historico', 'propor-item'])
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

// cota do dia (o mesmo cota.json que o Oráculo usa para as propostas): zera quando a data muda
const doisDigitos = (n) => String(n).padStart(2, '0')
function hoje() {
  const d = new Date()
  return `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)}/${d.getFullYear()}`
}
function gastar(tipo) {
  const dia = hoje()
  let c = {}
  try { c = JSON.parse(readFileSync(COTA, 'utf8')) } catch { /* primeira do dia */ }
  if (c.dia !== dia) c = { dia, propostas: 0, avisos: 0 }
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
  if (DEPOSITO.has(cmd)) throw new Error('comando do depósito: use o omni-actions.mjs do Oráculo')
  switch (cmd) {
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
    case 'pendentes': {
      const { pendentes } = await zap()
      sair({ ok: true, pendentes: pendentes().map(({ waId, titulo, commit, comando, expiraEm, explicadoEm, resposta }) => ({ waId, titulo, commit, comando, expiraEm: new Date(expiraEm).toISOString(), explicado: !!explicadoEm, resposta: resposta?.texto || null })) })
      break
    }
    default:
      falhar('comando desconhecido; veja o cabeçalho de scripts/omni-actions.mjs')
  }
} catch (e) { falhar(e) }
