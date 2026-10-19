// Omni — envio a terceiros autorizado pela SESSÃO DO PC (Claude Code do Weriton), não pelo chat do bot.
// Weriton pediu esta via em 30/09/2026: só o número dele (6601) autoriza pelo WhatsApp, mas a mesma ordem
// pode sair de uma sessão do PC. A checagem anti-injeção do bot-chat continua intacta em terceiros.mjs.
// A mensagem sai do número do bot, abre com "Aqui é o Omni, assistente do Weriton." e é espelhada ao dono.
//
// A autorização é a instrução LITERAL que o Weriton digitou numa sessão do Claude Code: terceiros.mjs a
// confere no transcript (turno humano genuíno, com verbo de envio + destinatário na mesma frase, ≤ 2 h,
// uso único). Sem --autorizacao não sai nada — o CLI não é um atalho para pular a trava.
//
// Uso (qualquer sessão do PC):
//   node omni/enviar-pc.mjs --para "<nome ou numero>" --autorizacao "<texto exato do pedido dele>" --texto-arquivo <caminho.txt> [--motivo "<...>"]
//   node omni/enviar-pc.mjs --para "62 8143-2028" --autorizacao "manda pro 62 8143-2028: o acesso tá pronto" --texto "o acesso tá pronto" --motivo "acesso DW da Iasmin"
import { readFileSync } from 'node:fs'
import { enviarParaContatoPC } from './terceiros.mjs'

const arg = n => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined }
const texto = arg('--texto-arquivo') ? readFileSync(arg('--texto-arquivo'), 'utf8') : arg('--texto')
const para = arg('--para')
const autorizacao = arg('--autorizacao')
if (!para) { console.error('faltou --para (nome da agenda ou número)'); process.exit(1) }
if (!autorizacao) { console.error('faltou --autorizacao (o texto exato do pedido que o Weriton digitou na sessão)'); process.exit(1) }

try {
  const r = await enviarParaContatoPC({ destinatario: para, texto, audio: arg('--audio'), autorizacao, motivo: arg('--motivo'), sessao: arg('--sessao') })
  console.log('OK · enviado para ' + (r.contato.nome || r.contato.numero) + ' (…' + r.contato.numero.slice(-4) + ') · ' + r.enviados.length + ' mensagem(ns)')
} catch (e) {
  console.error('FALHOU: ' + e.message)
  process.exit(1)
}
