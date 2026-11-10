'use strict';

// Plano 4c: a máquina de telas da janela "Parear WhatsApp", pura. Serve a janela (por <script>, vira
// window.PareamentoTelas) e o teste (por require). aplicar(estado, entrada) devolve o estado seguinte;
// entrada é um evento do pareador ({ evento, papel, ... }) ou um clique ({ clique: 'mostrar-qr' | 'tentar' }).
// `efeito` diz à janela qual passo pedir ao main ({ passo }) e vale só uma vez: a entrada seguinte limpa.
// Regra do §4.1: cada número é apresentado antes do QR dele, e o QR só aparece depois do clique.
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.PareamentoTelas = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  const MOTIVOS = {
    'mesmo-numero': 'Você escaneou o QR do número do Omni com o seu próprio celular. Desfiz esse pareamento: escaneie de novo com o celular do número do Omni, o outro chip.',
    'servico-fora': 'O serviço do WhatsApp não respondeu. Ele precisa estar ligado para parear.',
    'admin-ausente': 'Falta a chave de administração do serviço no cofre. A instalação é que cria essa chave.',
    prazo: 'O código venceu sem ser escaneado: o pareamento espera 10 minutos.',
    caiu: 'A conexão caiu três vezes seguidas durante o pareamento.',
    'acao-necessaria': 'O WhatsApp pediu uma ação no celular antes de conectar.',
    'sem-pessoal': 'O seu WhatsApp precisa estar pareado antes do número do Omni.',
    'falta-pareamento': 'Falta um dos dois números para a prova do "só leitura".',
    'nao-provado': 'Não consegui provar que o seu número é só leitura: o serviço aceitou algo que devia recusar. O card não fica verde assim.',
    chaves: 'O serviço recusou criar as chaves com escopo.',
    saiu: 'O pareamento terminou sem dar resposta.',
    'sem-node': 'Não achei o Node nesta máquina (OMNI_NODE ou o do PATH).',
    erro: 'Erro inesperado no pareamento.',
    ocupado: 'Outro passo do pareamento ainda está rodando. Espere ele terminar e tente de novo.',
  };
  const textoDoMotivo = (motivo) => MOTIVOS[motivo] || `O pareamento não terminou (${motivo || 'sem motivo'}).`;

  const inicial = () => ({
    tela: 'apresentar-pessoal', qr: null, efeito: null, fone4: {}, soLeitura: null,
    estadoSessao: null, motivo: null, detalhe: null, papelErro: null,
  });

  function erro(est, papel, motivo, detalhe) {
    return { ...est, tela: 'erro', qr: null, motivo, detalhe: detalhe || null, papelErro: papel };
  }

  function clique(est, qual) {
    if (qual === 'mostrar-qr' && est.tela === 'apresentar-pessoal') return { ...est, tela: 'qr-pessoal', qr: null, estadoSessao: null, efeito: { passo: 'pessoal' } };
    if (qual === 'mostrar-qr' && est.tela === 'apresentar-bot') return { ...est, tela: 'qr-bot', qr: null, estadoSessao: null, efeito: { passo: 'bot' } };
    // voltar: a janela cancela o processo e a tela volta a apresentar o mesmo número
    if (qual === 'voltar' && est.tela === 'qr-pessoal') return { ...est, tela: 'apresentar-pessoal', qr: null, estadoSessao: null };
    if (qual === 'voltar' && est.tela === 'qr-bot') return { ...est, tela: 'apresentar-bot', qr: null, estadoSessao: null };
    if (qual === 'tentar' && est.tela === 'erro') {
      const limpo = { ...est, motivo: null, detalhe: null, papelErro: null, soLeitura: null };
      if (est.papelErro === 'fechar') return { ...limpo, tela: 'provando', efeito: { passo: 'fechar' } };
      return { ...limpo, tela: est.papelErro === 'bot' ? 'apresentar-bot' : 'apresentar-pessoal' };
    }
    return est;
  }

  function aplicar(anterior, entrada) {
    const est = { ...anterior, efeito: null };
    if (!entrada || typeof entrada !== 'object') return est;
    if (entrada.clique) return clique(est, entrada.clique);
    const { evento, papel } = entrada;
    if (evento === 'qr') return est.tela === `qr-${papel}` ? { ...est, qr: entrada.qr } : est;
    if (evento === 'estado') return { ...est, estadoSessao: entrada.estado || null };
    if (evento === 'pareado') return { ...est, qr: null, fone4: { ...est.fone4, [papel]: entrada.fone4 } };
    if (evento === 'fechado') return { ...est, soLeitura: entrada.soLeitura || null };
    if (evento !== 'fim') return est;
    if (!entrada.ok) return erro(est, papel, entrada.motivo, entrada.detalhe);
    if (papel === 'pessoal') return { ...est, tela: 'apresentar-bot', qr: null };
    if (papel === 'bot') return { ...est, tela: 'provando', qr: null, efeito: { passo: 'fechar' } };
    if (papel === 'fechar') return est.soLeitura && est.soLeitura.ok === true ? { ...est, tela: 'pronto' } : erro(est, 'fechar', 'nao-provado');
    return est;
  }

  return { inicial, aplicar, textoDoMotivo, MOTIVOS };
});
