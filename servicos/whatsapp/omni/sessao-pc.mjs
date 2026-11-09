// Omni — leitura dos turnos HUMANOS das sessões do Claude Code no PC.
// A autorização de um envio a terceiros por sessão do PC se ancora AQUI, e só aqui: a única coisa que o
// modelo NÃO consegue forjar é uma mensagem escrita pelo próprio Weriton. O Claude Code grava cada turno
// em ~/.claude/projects/<slug>/<sessionId>.jsonl; um turno HUMANO legítimo é escrito pelo Claude Code com
// origin.kind="human" e turnOrigin="human" — marcas que o modelo não põe. Conteúdo lido de arquivo, banco
// ou grupo entra como turno 'user' TAMBÉM, mas com toolUseResult/tool_result e SEM origin/turnOrigin: não
// é turno humano. Trechos colados, seleção do editor e lembretes do harness aparecem DENTRO do texto do
// turno humano — são removidos antes de casar verbo+destinatário, senão uma ordem "colada" como dado
// autorizaria envio. (Formato real conferido no transcript: o fechamento carrega o id, </pasted_content id="..">.)
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const RAIZ_PROJETOS = join(homedir(), '.claude', 'projects')

// Regiões NÃO digitadas pelo Weriton, ainda que caiam no texto do turno dele. Fechamento com [^>]* porque
// o Claude Code repete o id na tag de fechamento (</pasted_content id="ba32">).
const INJETADO = /<(pasted_content|ide_selection|system-reminder)\b[^>]*>[\s\S]*?<\/\1[^>]*>/gi
// Qualquer resquício de abertura desses wrappers depois do strip = região que não deu para excisar limpo.
const RESIDUO = /<(pasted_content|ide_selection|system-reminder)\b/i

function textoHumano(msg) {
  const c = msg?.content
  if (typeof c === 'string') return c
  if (!Array.isArray(c)) return ''
  return c.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n')
}

// Turno humano genuíno: escrito pela pessoa no Claude Code, não pelo modelo nem por uma ferramenta.
export function ehTurnoHumano(o) {
  return Boolean(o) &&
    o.type === 'user' &&
    o.message?.role === 'user' &&
    o.isSidechain === false &&
    o.origin?.kind === 'human' &&
    o.turnOrigin === 'human' &&
    o.toolUseResult === undefined &&
    !(Array.isArray(o.message?.content) && o.message.content.some(b => b?.type === 'tool_result'))
}

// Só o que o Weriton de fato digitou: strip dos wrappers injetados; se sobrar abertura de wrapper, o texto
// não deu para limpar e a gente NÃO confia nele (fail-closed) — devolve vazio.
export function textoDigitado(o) {
  const limpo = textoHumano(o.message).replace(INJETADO, ' ')
  if (RESIDUO.test(limpo)) return ''
  return limpo.replace(/\s+/g, ' ').trim()
}

export function turnosHumanosDoArquivo(caminho) {
  const turnos = []
  let bruto
  try { bruto = readFileSync(caminho, 'utf8') } catch { return turnos }
  for (const linha of bruto.split('\n')) {
    if (!linha.trim()) continue
    let o
    try { o = JSON.parse(linha) } catch { continue }
    if (!ehTurnoHumano(o)) continue
    const texto = textoDigitado(o)
    if (!texto) continue
    turnos.push({ text: texto, at: Date.parse(o.timestamp) || 0, sessao: o.sessionId || null, caminho })
  }
  return turnos
}

// Turnos humanos de TODAS as sessões do PC (qualquer projeto), dentro da janela. Só arquivos cujo mtime
// cabe na janela: se existe um turno válido, o arquivo foi escrito nesse turno ou depois, então mtime >=
// começo da janela. Mais novos primeiro; teto de arquivos e turnos para não varrer o disco inteiro.
export function turnosHumanosRecentes(janelaMs, { raiz = RAIZ_PROJETOS, agora = Date.now() } = {}) {
  const corte = agora - janelaMs - 5 * 60_000 // folga de 5 min para resolução/skew de relógio
  const arquivos = []
  let slugs = []
  try { slugs = readdirSync(raiz) } catch { return [] }
  for (const slug of slugs) {
    let itens = []
    try { itens = readdirSync(join(raiz, slug)) } catch { continue }
    for (const f of itens) {
      if (!f.endsWith('.jsonl')) continue
      const caminho = join(raiz, slug, f)
      let mtime
      try { mtime = statSync(caminho).mtimeMs } catch { continue }
      if (mtime < corte) continue
      arquivos.push({ caminho, mtime })
    }
  }
  arquivos.sort((a, b) => b.mtime - a.mtime)
  const turnos = []
  const limiteTurno = agora - janelaMs
  for (const { caminho } of arquivos.slice(0, 40)) {
    for (const t of turnosHumanosDoArquivo(caminho)) if (t.at >= limiteTurno) turnos.push(t)
    if (turnos.length > 400) break
  }
  return turnos.sort((a, b) => b.at - a.at)
}
