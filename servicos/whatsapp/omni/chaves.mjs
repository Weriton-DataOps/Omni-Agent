// Omni — cria as chaves com escopo do serviço WhatsApp, grava no cofre e prova cada uma pelos dois lados.
// A lógica e as provas moram em chaves-escopo.mjs; aqui só a ligação com o cofre, o serviço e o console.
// Revoga as chaves anteriores com os mesmos nomes. Nunca imprime chave. Admin vem do cofre.
//   node omni/chaves.mjs              recria todas
//   node omni/chaves.mjs --terceiros  recria só a de terceiros
// Saída: 0 com todas as provas ok, 2 com alguma prova falhando, 1 se não deu para criar.
import { gravarSegredo, lerSegredo, NOMES } from './cofre.mjs'
import { BASE, sessaoPessoal, sessaoBot, donoJid } from './config.mjs'
import { provisionarChaves } from './chaves-escopo.mjs'

const admin = lerSegredo(NOMES.admin)
const api = async (metodo, caminho, corpo, chave = admin) => {
  const r = await fetch(BASE + caminho, { method: metodo, headers: { 'X-API-Key': chave, 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined })
  const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t }
  return { status: r.status, j: j && typeof j === 'object' && 'data' in j && !Array.isArray(j) ? j.data : j }
}

const r = await provisionarChaves({
  api, pessoal: sessaoPessoal(), bot: sessaoBot(), dono: donoJid(),
  segredos: { gravar: gravarSegredo, ler: lerSegredo }, nomes: NOMES,
  log: (linha) => console.log(linha), so: process.argv.includes('--terceiros') ? 'terceiros' : 'todas',
})
if (r.motivo) console.log(`FALHA: ${r.motivo}`)
process.exitCode = r.motivo ? 1 : r.ok ? 0 : 2
