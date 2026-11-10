// Omni — pareamento do WhatsApp, em dois números e na ordem do §4.1: primeiro o pessoal (o Omni só lê),
// depois o do bot (por onde o Omni conversa), e por fim a prova de que o pessoal é só leitura.
//   node omni/parear.mjs                    → sessão pessoal (cria "omni-pessoal" se faltar; grava sessao.id)
//   node omni/parear.mjs --bot              → sessão do bot (= --papel bot; grava sessao-bot.id)
//   node omni/parear.mjs --papel fechar     → cria as chaves com escopo, prova o "só leitura" e grava
//                                             pareamento.json (sem chave e sem número inteiro)
//   --json         uma linha JSON por evento no stdout (é assim que a ilha conversa com este script);
//                  sem ele, a página %APPDATA%\omni\whatsapp\pareamento.html com o QR sempre atual
//   --chave-stdin  a chave admin vem da 1ª linha do stdin. Nesse modo o cofre do Windows não é tocado em
//                  nenhuma direção: as chaves criadas pelo "fechar" vivem só na memória deste processo
//                  (é o caminho das provas com serviço falso).
// Saída: 0 com sucesso, 2 sem sucesso (o motivo vai no evento "fim"), 1 em erro inesperado.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { createRequire } from 'node:module'
import { lerSegredo, gravarSegredo, NOMES } from './cofre.mjs'
import { BASE, RUN, arquivo } from './config.mjs'
import { parearSessao } from './pareamento.mjs'
import { provisionarChaves, resumoSoLeitura } from './chaves-escopo.mjs'

const args = process.argv.slice(2)
const depois = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null }
const papel = args.includes('--bot') ? 'bot' : depois('--papel') || 'pessoal'
const json = args.includes('--json')
const chaveStdin = args.includes('--chave-stdin')

if (!['pessoal', 'bot', 'fechar'].includes(papel)) {
  console.error(`papel desconhecido: ${papel} (use pessoal, bot ou fechar)`)
  process.exit(1)
}
mkdirSync(RUN, { recursive: true })

// ---- saída: linhas JSON ou a página de sempre ----
const ROTULO = { pessoal: 'o seu WhatsApp pessoal', bot: 'o número do bot do Omni' }
const pagina = arquivo('pareamento.html')
const html = (corpo) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="refresh" content="3"><title>Omni · parear WhatsApp</title>
<style>body{font-family:system-ui,sans-serif;background:#0f1115;color:#e8e8e8;display:grid;place-items:center;min-height:100vh;margin:0}
main{text-align:center;max-width:420px;padding:16px}img{width:320px;height:320px;background:#fff;padding:12px;border-radius:12px}
p{color:#b5b9c2;line-height:1.5}h1{font-size:20px}</style></head><body><main>${corpo}</main></body></html>`
let qrMostrado = false
function emitir(e) {
  if (json) { process.stdout.write(JSON.stringify(e) + '\n'); return }
  const rotulo = ROTULO[e.papel] ?? ''
  if (e.evento === 'sessao') console.log(`sessão ${e.papel}`)
  else if (e.evento === 'estado' && !qrMostrado) writeFileSync(pagina, html(`<h1>Preparando o código…</h1><p>Estado: ${e.estado || 'iniciando'}</p>`))
  else if (e.evento === 'qr') {
    qrMostrado = true
    writeFileSync(pagina, html(`<h1>Parear ${rotulo}</h1><img src="${e.qr}" alt="QR de pareamento"><p>No celular de ${rotulo}: WhatsApp → Aparelhos conectados → Conectar um aparelho → aponte para este código.</p><p>O código se renova sozinho. Estado: ${e.estado || 'aguardando'}</p>`))
    console.log(`QR novo · estado=${e.estado} · ${new Date().toLocaleTimeString('pt-BR')}`)
  } else if (e.evento === 'pareado') {
    writeFileSync(pagina, html(`<h1>✅ Pareado</h1><p>${rotulo} está conectado (final ${e.fone4}). Pode fechar esta janela.</p>`))
    console.log(`PAREADO status=ready fone=…${e.fone4}`)
  } else if (e.evento === 'fechado') {
    console.log(`pessoal só leitura: ${e.soLeitura.ok ? `provado (${e.soLeitura.recusas} recusas)` : `NÃO provado: ${e.soLeitura.falhas.join(', ')}`}`)
  } else if (e.evento === 'fim' && !e.ok) console.log(`ENCERRADO sem sucesso: ${e.motivo}${e.detalhe ? ` (${e.detalhe})` : ''}`)
}

// ---- chave admin e segredos ----
async function lerAdmin() {
  if (chaveStdin) {
    let entrada = ''
    for await (const pedaco of process.stdin) { entrada += pedaco; if (entrada.includes('\n')) break }
    return entrada.split('\n')[0].trim() || null
  }
  try { return lerSegredo(NOMES.admin) } catch { return null }
}
const memoria = new Map()
const segredos = chaveStdin
  ? { gravar: (n, v) => memoria.set(n, v), ler: (n) => memoria.get(n) }
  : { gravar: gravarSegredo, ler: lerSegredo }

// ---- arquivos de estado ----
const ID = { pessoal: 'sessao.id', bot: 'sessao-bot.id' }
const lerTexto = (nome) => (existsSync(arquivo(nome)) ? readFileSync(arquivo(nome), 'utf8').trim() || null : null)
const ids = { ler: (p) => lerTexto(ID[p]), gravar: (p, id) => writeFileSync(arquivo(ID[p]), id) }
const dono = { ler: () => lerTexto('dono.txt')?.replace(/\D/g, '') || null, gravar: (n) => writeFileSync(arquivo('dono.txt'), n) }
function gravarAtomico(nome, dados) {
  const tmp = arquivo(`${nome}.tmp`)
  writeFileSync(tmp, JSON.stringify(dados, null, 2))
  renameSync(tmp, arquivo(nome))
}

// ---- QR: o serviço costuma mandar data URL pronta; só carrega o qrcode quando não manda ----
async function qrImagem(codigo) {
  const QR = createRequire(new URL('../package.json', import.meta.url))('qrcode')
  return QR.toDataURL(codigo, { margin: 1, width: 640 })
}

async function principal() {
  const admin = await lerAdmin()
  if (!admin) { emitir({ evento: 'fim', papel, ok: false, motivo: 'admin-ausente' }); return 2 }

  const pedir = async (metodo, caminho, corpo, chave = admin) => {
    const r = await fetch(BASE + caminho, { method: metodo, headers: { 'X-API-Key': chave, 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined })
    const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t }
    return { ok: r.ok, status: r.status, dados: j && typeof j === 'object' && 'data' in j && !Array.isArray(j) ? j.data : j }
  }

  if (papel !== 'fechar') {
    const r = await parearSessao({
      api: (m, c, corpo) => pedir(m, c, corpo), papel, ids, dono, emitir,
      esperar: (ms) => new Promise((ok) => setTimeout(ok, ms)), agora: () => Date.now(), qrImagem,
    })
    return r.ok ? 0 : 2
  }

  // fechar: os dois números pareados → chaves com escopo → prova do "só leitura" → pareamento.json
  const pessoal = ids.ler('pessoal'); const bot = ids.ler('bot'); const numeroDono = dono.ler()
  if (!pessoal || !bot || !numeroDono) { emitir({ evento: 'fim', papel, ok: false, motivo: 'falta-pareamento' }); return 2 }
  let fone4
  try {
    const ler = async (id) => String((await pedir('GET', `/api/sessions/${id}`)).dados?.phone ?? '').replace(/\D/g, '').slice(-4)
    fone4 = { pessoal: await ler(pessoal), bot: await ler(bot) }
  } catch { emitir({ evento: 'fim', papel, ok: false, motivo: 'servico-fora' }); return 2 }
  const r = await provisionarChaves({
    api: async (m, c, corpo, chave) => { const x = await pedir(m, c, corpo, chave); return { status: x.status, j: x.dados } },
    pessoal, bot, dono: `${numeroDono}@c.us`, segredos, nomes: NOMES, log: json ? () => {} : (l) => console.log(l),
  })
  const resumo = resumoSoLeitura(r.provas)
  const soLeitura = { ok: resumo.ok && !r.motivo, recusas: resumo.recusas, falhas: resumo.falhas }
  const em = new Date().toISOString()
  gravarAtomico('pareamento.json', { em, pessoal: { fone4: fone4.pessoal }, bot: { fone4: fone4.bot }, soLeitura: { ...soLeitura, em } })
  emitir({ evento: 'fechado', soLeitura })
  if (soLeitura.ok) { emitir({ evento: 'fim', papel, ok: true }); return 0 }
  emitir({ evento: 'fim', papel, ok: false, motivo: r.motivo ? 'chaves' : 'nao-provado', ...(r.motivo ? { detalhe: r.motivo.slice(0, 200) } : {}) })
  return 2
}

try {
  process.exitCode = await principal()
} catch (erro) {
  emitir({ evento: 'fim', papel, ok: false, motivo: 'erro' })
  console.error(`erro inesperado: ${String(erro?.message ?? erro).replace(/\d{8,}/g, '…').slice(0, 300)}`)
  process.exitCode = 1
}
