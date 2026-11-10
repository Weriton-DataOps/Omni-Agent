'use strict';

// A janela "Parear WhatsApp" (F2, plano 4c): desenha o estado da máquina de telas (pareamento-telas.js) e
// faz o que o `efeito` pede ao main. Tudo por nós do DOM com textContent: nada do pareador vira HTML.
(() => {
  const T = window.PareamentoTelas;
  const api = window.pareamento;
  const raiz = document.getElementById('tela');
  const trilha = document.getElementById('trilha');
  let est = T.inicial();

  function no(tag, props, ...filhos) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'aoClicar') el.addEventListener('click', v);
      else if (k === 'classe') el.className = v;
      else el.setAttribute(k, v);
    }
    for (const f of filhos.flat()) if (f !== null && f !== undefined && f !== false) el.append(typeof f === 'string' ? document.createTextNode(f) : f);
    return el;
  }
  const botao = (rotulo, aoClicar, forte) => no('button', { classe: forte ? 'bt forte' : 'bt', type: 'button', aoClicar }, rotulo);
  const final = (fone4) => (fone4 ? `final ${fone4}` : 'pareado');

  function passar(entrada) {
    est = T.aplicar(est, entrada);
    const efeito = est.efeito;
    if (efeito) {
      api.iniciar(efeito.passo).then((ok) => {
        if (!ok) passar({ evento: 'fim', papel: efeito.passo, ok: false, motivo: 'ocupado' });
      }, () => passar({ evento: 'fim', papel: efeito.passo, ok: false, motivo: 'erro' }));
    }
    desenhar();
  }
  const clicar = (qual) => () => passar({ clique: qual });
  const voltar = () => { api.cancelar(); passar({ clique: 'voltar' }); };

  const ETAPAS = [
    ['pessoal', 'seu número', ['apresentar-pessoal', 'qr-pessoal']],
    ['bot', 'número do Omni', ['apresentar-bot', 'qr-bot']],
    ['prova', 'prova', ['provando', 'pronto']],
  ];
  function desenharTrilha() {
    const papelErro = est.tela === 'erro' ? (est.papelErro === 'fechar' ? 'prova' : est.papelErro) : null;
    const indice = ETAPAS.findIndex(([id, , telas]) => telas.includes(est.tela) || id === papelErro);
    trilha.replaceChildren(...ETAPAS.map(([, nome], i) => no('span', {
      classe: i === indice ? 'atual' : i < indice || est.tela === 'pronto' ? 'feito' : '',
    }, `${i + 1} · ${nome}`)));
  }

  function caixaQr(papel) {
    if (est.qr) return no('div', { classe: 'qr pronto' }, no('img', { src: est.qr, alt: 'código QR para escanear', width: '280', height: '280' }));
    const fone4 = est.fone4[papel];
    const texto = fone4 ? `Conectado ao ${final(fone4)}. Terminando…`
      : est.estadoSessao === 'connecting' || est.estadoSessao === 'authenticating' ? 'Conectando…' : 'Gerando o código…';
    return no('div', { classe: 'qr espera', role: 'status' }, texto);
  }

  const TELAS = {
    'apresentar-pessoal': () => [
      no('div', { classe: 'passo' }, '1 de 2'),
      no('h2', {}, 'O seu WhatsApp'),
      no('p', {}, 'O Omni lê as suas conversas para ter contexto. Por este número ele nunca envia nada: no fim, eu provo isso tentando enviar e conferindo que o serviço recusa.'),
      no('p', { classe: 'forte-txt' }, 'Escaneie com o SEU celular, o do seu número pessoal.'),
      no('div', { classe: 'acoes' }, botao('mostrar o QR', clicar('mostrar-qr'), true)),
    ],
    'qr-pessoal': () => [
      no('div', { classe: 'passo' }, '1 de 2 · o seu WhatsApp'),
      no('h2', {}, 'Escaneie com o SEU celular'),
      no('p', { classe: 'caminho' }, 'No SEU celular: WhatsApp → Aparelhos conectados → Conectar um aparelho'),
      caixaQr('pessoal'),
      no('p', { classe: 'nota' }, 'O código se renova sozinho. O pareamento espera até 10 minutos.'),
      no('div', { classe: 'acoes' }, botao('voltar', voltar)),
    ],
    'apresentar-bot': () => [
      no('p', { classe: 'feito-linha' }, `Seu WhatsApp: ${final(est.fone4.pessoal)}.`),
      no('div', { classe: 'passo' }, '2 de 2'),
      no('h2', {}, 'O número do Omni'),
      no('p', {}, 'É por este número que o Omni fala com você no WhatsApp. Ele é outro chip, não o seu.'),
      no('p', { classe: 'forte-txt' }, 'Escaneie com o celular do NÚMERO DO OMNI, não com o seu.'),
      no('div', { classe: 'acoes' }, botao('mostrar o QR', clicar('mostrar-qr'), true)),
    ],
    'qr-bot': () => [
      no('div', { classe: 'passo' }, '2 de 2 · o número do Omni'),
      no('h2', {}, 'Escaneie com o celular do número do Omni'),
      no('p', { classe: 'caminho' }, 'No celular do NÚMERO DO OMNI: WhatsApp → Aparelhos conectados → Conectar um aparelho'),
      caixaQr('bot'),
      no('p', { classe: 'nota' }, 'O código se renova sozinho. O pareamento espera até 10 minutos.'),
      no('div', { classe: 'acoes' }, botao('voltar', voltar)),
    ],
    provando: () => [
      no('div', { classe: 'passo' }, 'prova'),
      no('h2', {}, 'Conferindo que o seu número é só leitura'),
      no('p', { role: 'status' }, 'Tento enviar pelo seu número com as chaves do Omni e confiro que cada tentativa é recusada.'),
    ],
    pronto: () => [
      no('h2', {}, 'Pareado'),
      no('dl', { classe: 'ficha' },
        no('dt', {}, 'seu WhatsApp'), no('dd', {}, `${final(est.fone4.pessoal)} · só leitura, provado (${est.soLeitura ? est.soLeitura.recusas : 0} recusas)`),
        no('dt', {}, 'número do Omni'), no('dd', {}, final(est.fone4.bot))),
      no('p', { classe: 'nota' }, 'O card do WhatsApp na ilha fica verde quando as duas sessões responderem.'),
      no('div', { classe: 'acoes' }, botao('fechar', () => window.close(), true)),
    ],
    erro: () => [
      no('h2', {}, 'O pareamento parou'),
      no('p', { classe: 'erro-txt', role: 'alert' }, T.textoDoMotivo(est.motivo)),
      est.detalhe ? no('p', { classe: 'nota' }, est.detalhe) : null,
      no('div', { classe: 'acoes' }, botao('tentar de novo', clicar('tentar'), true), botao('fechar', () => window.close())),
    ],
  };

  function desenhar() {
    desenharTrilha();
    raiz.replaceChildren(no('section', { classe: 'tela', 'data-tela': est.tela }, (TELAS[est.tela] || TELAS.erro)()));
  }

  api.aoEvento(passar);
  desenhar();
})();
