'use strict';

// Plano 4c: o que falta para o WhatsApp do Omni estar pronto, na ordem do §4.1 (pessoal, bot, prova).
// Os arquivos decidem primeiro: numa máquina nova a sonda não enxerga sessão nenhuma, porque a chave de
// leitura só nasce no "fechar". Depois da prova, a sonda confirma que as duas sessões seguem de pé e que
// o número pessoal é o mesmo que foi provado só leitura.
//   w = lerWhatsapp(): { instalado, servico, ids: {pessoal, bot}, pareamento, saude }
//   →  { estado, acao: 'parear' | null, texto }
const PRONTO = 'ready';

function vistaPareamento(w) {
  const falta = (estado, texto) => ({ estado, acao: 'parear', texto });
  if (!w || !w.instalado) return { estado: 'ausente', acao: null, texto: 'WhatsApp não instalado' };
  if (!w.servico) return { estado: 'sem-servico', acao: null, texto: 'serviço do WhatsApp parado' };

  const ids = w.ids || {};
  if (!ids.pessoal) return falta('falta-pessoal', 'falta parear o seu WhatsApp (1 de 2)');
  if (!ids.bot) return falta('falta-bot', 'falta parear o número do Omni (2 de 2)');

  const prova = w.pareamento;
  if (!prova || !prova.soLeitura || prova.soLeitura.ok !== true) {
    return falta('falta-prova', 'o seu número ainda não foi provado só leitura');
  }

  const sessoes = w.saude && w.saude.sessoes;
  if (!sessoes) return { estado: 'conferindo', acao: null, texto: 'conferindo as duas sessões' };
  const pessoal = sessoes.pessoal || {};
  const bot = sessoes.bot || {};
  if (pessoal.status !== PRONTO) return falta('falta-pessoal', 'o seu WhatsApp desconectou (1 de 2)');
  if (bot.status !== PRONTO) return falta('falta-bot', 'o número do Omni desconectou (2 de 2)');
  if (!prova.pessoal || pessoal.fone !== prova.pessoal.fone4) {
    return falta('falta-prova', 'o número pessoal mudou depois da prova');
  }
  return { estado: 'pareado', acao: null, texto: '' };
}

module.exports = { vistaPareamento };
