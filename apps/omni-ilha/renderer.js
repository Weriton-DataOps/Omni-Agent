'use strict';

// Omni · ilha — comportamento da forma. A janela tem tamanho fixo (main.js); aqui a casca anima largura,
// altura e raio num relógio só (requestAnimationFrame), e o main decide o clique-passante com o
// retângulo da forma visível que este arquivo manda a cada quadro em que ela muda.
//
// Estados:  recolhida ──entrou──▶ espiando ──(200 ms parado em cima | clique)──▶ aberta
//               ▲                    │ saiu (150 ms)                                │ saiu (500 ms hover, 1 s clique)
//               └────────────────────┴───────────────────── Escape ─────────────────┘
// Crescer é mola (passa um pouco do ponto); encolher é cubic-bezier(.45, 0, .2, 1). Interromper no meio
// parte de onde a forma está, com a velocidade que ela tem.
//
// Tudo dentro de uma IIFE: o preload publica window.ilha (contextBridge, não-configurável) e um global
// chamado `ilha` derrubaria o script com SyntaxError. A ponte aqui se chama `ponte`, o poço, `poco`.
(() => {
  const ponte = window.ilha;
  const casca = document.getElementById('casca');
  const poco = document.getElementById('ilha');
  const fechar = document.getElementById('fechar');
  const cardActions = document.getElementById('card-actions');

  const parametros = new URLSearchParams(location.search);
  const FAIXA = Number(parametros.get('faixa')) || 180;
  const FOLGA = Number(parametros.get('folga')) || 24;
  const LARGURA_ABERTA = Number(parametros.get('largura')) || 1200;
  const COMECA_ABERTA = parametros.get('aberta') === '1';
  const FOLGA_BAIXO = 36; // sombra de baixo (16 px) + o quanto a mola passa do ponto na altura
  const REDUZIDO = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── tempos e curvas ──────────────────────────────────────────────────────────────────────────────
  const TEMPO = {
    intencao: 200,        // parado em cima do ícone por isto = quer abrir
    reintencao: 80,       // ainda se movendo rápido: olha de novo daqui a pouco
    // Saídas curtas (Weriton, 19/10: "ao sair deve recolher mais rápido"). Escorregar para fora sem querer
    // continua barato: voltar sobre a forma que ainda encolhe reabre de onde ela está (entrou()).
    saidaEspiando: 100,   // saiu do ícone espiado
    carenciaHover: 120,   // saiu do painel aberto por hover
    carenciaClique: 350,  // saiu do painel aberto por clique (ou depois de clicar dentro)
  };
  const VELOCIDADE_MAXIMA = 0.4; // px/ms nos últimos 100 ms: acima disso o ponteiro só está passando
  const MOLA_ABRIR = { resposta: 0.36, amortecimento: 0.8 }; // passa ~1% do ponto, assenta em ~0,47 s
  const MOLA_ESPIAR = { resposta: 0.3, amortecimento: 0.8 };
  const FECHAR_MS = { aberta: 230, espiando: 160 };
  const REDUZIDO_MS = 120;
  // As pastilhas só entram quando o poço já passou disto da largura aberta: antes disso elas apareceriam
  // cortadas a seco pelas laterais retas do poço, sem as pontas arredondadas.
  const REVELAR_EM = 0.88;
  const ORDEM = { recolhida: 0, espiando: 1, aberta: 2 };
  const FORMAS = {
    recolhida: { w: 36, h: 34, r: 17 }, // justo na face de 32 px (21/10: o bico de 44×40 sobrava em volta)
    espiando: { w: 60, h: 43, r: 21 },
    aberta: { w: LARGURA_ABERTA, h: 190, r: 24 }, // h é o da vista ligada (ALTURAS, medidas em iniciar())
  };
  const ALTURA_TOPO = 40;  // cabeçalho: abas | face | ações
  const MARGEM_BASE = 10;  // do card até a borda de baixo do poço
  const ALTURAS = {};      // altura do poço aberto para cada vista

  // A chama é enfeite: se ela não carregou, a ilha abre e fecha do mesmo jeito.
  function acenderChama(v) {
    try { if (typeof window.fumaca?.liberar === 'function') window.fumaca.liberar(v); } catch (e) { console.error('chama', e); }
  }

  // ── a faixa (modelo "Hoje + faixa" da bancada/casca.js) ───────────────────────────────────────────
  // Concordância côncava (quarto de elipse) que começa RAIO px antes da lateral do corpo e desce QUEDA px
  // até encostar nela, e uma película de ESPESSURA px que afina até zero em FAIXA px, com
  // espessura(s) = t0·(1 − s/L)^CURVA. O lado direito é o esquerdo espelhado. RAIO e QUEDA vêm do traço
  // que o Weriton desenhou em 19/10: a curva começa ~16 px fora e encosta no corpo em y ≈ 19, logo antes
  // de o canto de baixo do corpo recolhido (raio 20) começar a dobrar.
  const ESPESSURA = 4;
  const CURVA = 1.3;
  const RAIO = 16;
  const QUEDA = 15;
  const ALTURA_FAIXA = 24; // tem que caber ESPESSURA + QUEDA e o traço de 1 px
  // o preenchimento é o mesmo degradê do poço (--poco-* do index.html, ancorado em px; desde a linguagem
  // do notch, preto puro): em cada y a faixa tem a cor do corpo ao lado, então a concordância não mostra
  // degrau. Uma máscara deixa a película mais transparente da concordância até a ponta (30% na ponta); a
  // concordância fica inteira, para a emenda continuar igual ao corpo.
  const css = getComputedStyle(document.documentElement);
  const POCO = {
    topo: css.getPropertyValue('--poco-topo').trim(),
    fundo: css.getPropertyValue('--poco-fundo').trim(),
    altura: parseFloat(css.getPropertyValue('--poco-altura')),
  };

  function desenharFaixa(svg, id) {
    const L = FAIXA;
    const rj = Math.min(RAIO, L);
    const espessura = (s) => ESPESSURA * Math.pow(Math.max(0, 1 - s / L), CURVA);
    const f = (n) => Math.round(n * 100) / 100;
    const N = 36;
    const pontos = [];
    for (let i = N; i >= 0; i--) {
      const s = rj + (L - rj) * (i / N);
      pontos.push(`${f(L - s)} ${f(espessura(s))}`);
    }
    // borda de baixo: da ponta (x = 0) até a lateral do corpo (x = L), descendo pela concordância. Os
    // controles do cúbico puxam para o canto (L, y0) com k = 0,5523: tangente horizontal ao sair da
    // película e vertical ao encostar no corpo, sem quina em nenhuma das duas emendas.
    const y0 = espessura(rj);
    const k = 0.5523;
    const borda = `M ${pontos.join(' L ')} C ${f(L - rj + rj * k)} ${f(y0)} ${L} ${f(y0 + QUEDA - QUEDA * k)} ${L} ${f(y0 + QUEDA)}`;
    const forma = `M 0 0 L ${borda.slice(2)} L ${L} 0 Z`;
    svg.setAttribute('viewBox', `0 0 ${L} ${ALTURA_FAIXA}`);
    svg.innerHTML = `
      <defs><linearGradient id="${id}-poco" x1="0" x2="0" y1="0" y2="${POCO.altura}" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="${POCO.topo}"/>
        <stop offset="1" stop-color="${POCO.fundo}"/>
      </linearGradient><linearGradient id="${id}-clara" x1="0" x2="0" y1="0" y2="${FORMAS.recolhida.h}" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#1c1f26"/>
        <stop offset="1" stop-color="#2b2f38"/>
      </linearGradient><linearGradient id="${id}-some" x1="0" x2="${L}" y1="0" y2="0" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#fff" stop-opacity=".3"/>
        <stop offset="${f((L - rj) / L)}" stop-color="#fff" stop-opacity="1"/>
      </linearGradient><mask id="${id}-m" maskUnits="userSpaceOnUse" x="0" y="0" width="${L}" height="${ALTURA_FAIXA}">
        <rect width="${L}" height="${ALTURA_FAIXA}" fill="url(#${id}-some)"/>
      </mask></defs>
      <path d="${forma}" fill="url(#${id}-poco)" mask="url(#${id}-m)"/>
      <path d="${forma}" fill="url(#${id}-clara)" mask="url(#${id}-m)" style="opacity: var(--clara, 0)"/>`;
  }

  // ── animação: trilhas com mola ou curva ───────────────────────────────────────────────────────────
  function cubicBezier(x1, y1, x2, y2) {
    const cx = 3 * x1; const bx = 3 * (x2 - x1) - cx; const ax = 1 - cx - bx;
    const cy = 3 * y1; const by = 3 * (y2 - y1) - cy; const ay = 1 - cy - by;
    const sx = (t) => ((ax * t + bx) * t + cx) * t;
    const sy = (t) => ((ay * t + by) * t + cy) * t;
    const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 8; i++) {
        const erro = sx(t) - x;
        if (Math.abs(erro) < 1e-6) return sy(t);
        const d = dx(t);
        if (Math.abs(d) < 1e-6) break;
        t -= erro / d;
      }
      let lo = 0; let hi = 1; t = x;
      while (hi - lo > 1e-6) { if (sx(t) < x) lo = t; else hi = t; t = (lo + hi) / 2; }
      return sy(t);
    };
  }
  const curvaFechar = cubicBezier(0.45, 0, 0.2, 1);
  const curvaReduzida = cubicBezier(0.25, 0.1, 0.25, 1);

  const trilha = (v) => ({ v, vel: 0, modo: 'parada', alvo: v });
  const largura = trilha(FORMAS.recolhida.w);
  const altura = trilha(FORMAS.recolhida.h);
  const raio = trilha(FORMAS.recolhida.r);
  const trilhas = [largura, altura, raio];

  function mola(t, alvo, { resposta, amortecimento }) {
    t.modo = 'mola'; t.alvo = alvo;
    t.w0 = (2 * Math.PI) / resposta; t.zeta = amortecimento;
    // Mantém a velocidade se ela já aponta para o alvo novo (interromper não dá tranco). Se aponta para o
    // outro lado (voltou no meio do fechamento), zera: senão a forma continuaria murchando antes de crescer.
    if ((alvo - t.v) * t.vel < 0) t.vel = 0;
  }
  function curva(t, alvo, duracao, agora, easing) {
    t.modo = 'curva'; t.de = t.v; t.alvo = alvo; t.t0 = agora; t.duracao = duracao; t.easing = easing;
  }
  function passo(t, dt, agora) {
    if (t.modo === 'mola') {
      const k = t.w0 * t.w0; const c = 2 * t.zeta * t.w0;
      for (let resto = dt; resto > 1e-9; resto -= 1 / 240) { // sub-passos de 1/240 s: estável com quadro perdido
        const h = Math.min(1 / 240, resto);
        t.vel += (-k * (t.v - t.alvo) - c * t.vel) * h;
        t.v += t.vel * h;
      }
      // parada abaixo do que se vê (a largura é arredondada a 2 px e a altura a 1 px)
      if (Math.abs(t.v - t.alvo) < 0.2 && Math.abs(t.vel) < 4) { t.v = t.alvo; t.vel = 0; t.modo = 'parada'; }
    } else if (t.modo === 'curva') {
      const p = Math.min(1, (agora - t.t0) / t.duracao);
      const novo = t.de + (t.alvo - t.de) * t.easing(p);
      t.vel = dt > 0 ? (novo - t.v) / dt : 0;
      t.v = novo;
      if (p >= 1) { t.v = t.alvo; t.vel = 0; t.modo = 'parada'; }
    }
    return t.modo !== 'parada';
  }

  // ── máquina de estados (variáveis; a lógica vem depois da animação) ──────────────────────────────
  let estado = 'recolhida';
  let dentro = false;      // o main diz (borda com histerese de 6 px)
  let porClique = false;   // abriu por clique ou houve clique dentro: carência maior
  let bloqueada = false;   // depois do Escape com o ponteiro em cima: não reabre até ele sair
  let fixada = false;      // começou aberta (--aberta): só recolhe depois de o ponteiro entrar e sair
  let timer = null;
  let entradaEm = -Infinity;
  let ultimoMovimento = -Infinity;
  const rastro = [];       // amostras de mousemove (só chegam com o ponteiro sobre o corpo)

  let animando = false;
  let ultimoQuadro = 0;
  let quadros = 0;
  let alvoEnviado = '';

  // Largura sempre par: casca.left = W/2 − w/2 e o conteúdo dentro dela = w/2 − 370 somam um valor
  // constante. O ícone e as pastilhas não andam nem 1 px enquanto o poço cresce ou encolhe.
  function aplicar(forcar) {
    const W = document.documentElement.clientWidth;
    const w = Math.max(2, 2 * Math.round(largura.v / 2));
    const h = Math.max(1, Math.round(altura.v));
    casca.style.left = `${W / 2 - w / 2}px`;
    casca.style.width = `${w}px`;
    casca.style.height = `${h}px`;
    poco.style.setProperty('--raio', `${Math.max(0, raio.v).toFixed(2)}px`);
    // grafite recolhida → preto quando alarga (some nos primeiros ~160 px); na casca, para poço e faixas
    casca.style.setProperty('--clara', Math.max(0, Math.min(1, 1 - (w - FORMAS.recolhida.w) / 160)).toFixed(3));
    // as pastilhas entram quando a forma já está quase inteira; saem na hora em que ela deixa de ser aberta
    const revelar = estado === 'aberta' && w >= LARGURA_ABERTA * REVELAR_EM;
    if (revelar !== poco.classList.contains('revelada')) poco.classList.toggle('revelada', revelar);
    // o clique-passante do main segue a forma visível, não o destino
    const chave = `${W / 2 - w / 2}|${w}|${h}|${estado}`;
    if (forcar || chave !== alvoEnviado) {
      alvoEnviado = chave;
      ponte.alvo({ x: W / 2 - w / 2, y: 0, w, h, estado });
    }
    posicionarFace(); // barato: sai na hora se a face já está onde deve
  }

  function quadro(agora) {
    const dt = Math.min(0.05, Math.max(0, (agora - ultimoQuadro) / 1000));
    ultimoQuadro = agora;
    let vivo = false;
    for (const t of trilhas) vivo = passo(t, dt, agora) || vivo;
    aplicar(false);
    quadros += 1;
    if (vivo) requestAnimationFrame(quadro);
    else animando = false;
  }

  function acordar() {
    if (animando) return;
    animando = true;
    ultimoQuadro = performance.now();
    requestAnimationFrame(quadro);
  }

  function animarPara(novo, anterior) {
    const f = FORMAS[novo];
    const agora = performance.now();
    const cresce = ORDEM[novo] > ORDEM[anterior];
    for (const [t, valor] of [[largura, f.w], [altura, f.h], [raio, f.r]]) {
      if (REDUZIDO) curva(t, valor, REDUZIDO_MS, agora, curvaReduzida);
      else if (cresce) mola(t, valor, novo === 'aberta' ? MOLA_ABRIR : MOLA_ESPIAR);
      else curva(t, valor, FECHAR_MS[anterior] || FECHAR_MS.espiando, agora, curvaFechar);
    }
    acordar();
  }

  // ── máquina de estados ────────────────────────────────────────────────────────────────────────────
  function atualizarEscape() {
    ponte.escape(estado === 'aberta' && dentro);
  }

  function ir(novo) {
    if (novo === estado) return;
    const anterior = estado;
    estado = novo;
    if (novo === 'recolhida') { porClique = false; fixada = false; }
    if (novo !== 'aberta') poco.classList.remove('revelada'); // o conteúdo some antes de a forma encolher
    animarPara(novo, anterior);
    aplicar(true); // o main fica sabendo do estado novo no mesmo instante
    atualizarEscape();
    acenderChama(novo !== 'recolhida'); // espiar já acorda a chama
    if (novo === 'aberta') { atualizarCofre('abriu'); atualizar(); vigiar(true); } else vigiar(false);
  }

  // ── vistas (abas do cabeçalho) ────────────────────────────────────────────────────────────────────
  // Cada vista tem a sua altura; trocar com a ilha aberta leva o poço até ela na mesma mola de abrir.
  let vista = 'inicio';
  const abas = [...document.querySelectorAll('#abas .tab')];
  const vistas = [...document.querySelectorAll('.vista')];

  function trocarVista(nome) {
    if (!ALTURAS[nome]) return;
    vista = nome;
    for (const a of abas) a.classList.toggle('on', a.dataset.vista === nome);
    for (const v of vistas) v.classList.toggle('on', v.dataset.vista === nome);
    FORMAS.aberta.h = ALTURAS[nome];
    if (estado === 'aberta') {
      if (REDUZIDO) curva(altura, ALTURAS[nome], REDUZIDO_MS, performance.now(), curvaReduzida);
      else mola(altura, ALTURAS[nome], MOLA_ABRIR);
      acordar();
    }
    atualizar();
    posicionarFace();
  }

  // ── a face é uma só (21/10): recolhida mora no notch; com a Início revelada ela voa até a coluna da
  // máquina, inclinada para o lado do destino e com vento atrás, e pousa com anel e faíscas. Fechar ou ir
  // para o Chat a traz de volta. Quem voa é um clone por cima das vistas; as duas faces de verdade ficam
  // escondidas enquanto ele está no ar.
  const conteudo = document.getElementById('conteudo');
  const faceNotch = document.querySelector('.face-notch');
  const ancoraNotch = document.querySelector('.ancora-notch'); // o lugar da face do notch no .conteudo
  const faceColuna = document.querySelector('.card-espaco .face');
  const voo = document.getElementById('voo');
  const vooVento = voo.querySelector('.vento-giro');
  const curvaIda = cubicBezier(0.6, 0, 0.2, 1);
  const curvaVolta = cubicBezier(0.2, 0.7, 0.3, 1); // volta rápida: ganha do poço que encolhe
  const TAM_VOO = 62;
  let faceEm = 'notch';
  let voando = null;

  // centro do elemento no sistema do .conteudo, pelo layout (sem os transforms da vista e do flutuar)
  function centroEm(elem, ancestral) {
    let x = 0; let y = 0;
    for (let n = elem; n && n !== ancestral; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; }
    for (let n = elem.parentElement; n && n !== ancestral; n = n.parentElement) { x -= n.scrollLeft; y -= n.scrollTop; }
    return { x: x + elem.offsetWidth / 2, y: y + elem.offsetHeight / 2, tam: elem.offsetWidth };
  }

  function colunaAVista() {
    const c = faceColuna.closest('.coluna').getBoundingClientRect();
    const f = faceColuna.getBoundingClientRect();
    return f.bottom > c.top + 8 && f.top < c.bottom - 8;
  }

  function marcarFaces() {
    faceNotch.classList.toggle('fora', !!voando || faceEm !== 'notch');
    faceColuna.classList.toggle('fora', !!voando || faceEm !== 'coluna');
  }

  function posicionarFace() {
    const destino = poco.classList.contains('revelada') && vista === 'inicio' ? 'coluna' : 'notch';
    if (destino === (voando ? voando.destino : faceEm)) return;
    let de;
    if (voando) {
      // mudou de ideia no meio do voo: parte de onde o clone está
      const v = voo.getBoundingClientRect(); const c = conteudo.getBoundingClientRect();
      de = { x: v.left + v.width / 2 - c.left, y: v.top + v.height / 2 - c.top, tam: voando.tam };
      voando.cancelar();
    } else {
      de = centroEm(faceEm === 'coluna' ? faceColuna : ancoraNotch, conteudo);
    }
    const alvo = destino === 'coluna' ? faceColuna : faceNotch;
    if (REDUZIDO || !colunaAVista()) { faceEm = destino; voando = null; marcarFaces(); return; }
    voar(de, centroEm(destino === 'coluna' ? faceColuna : ancoraNotch, conteudo), destino, alvo);
  }

  function voar(de, ate, destino, alvo) {
    const ida = destino === 'coluna';
    const duracao = ida ? 480 : 240;
    const curvaVoo = ida ? curvaIda : curvaVolta;
    const lado = Math.sign(ate.x - de.x) || 1;
    // arco: na ida desce no fim (sai na horizontal do notch e mergulha); na volta sobe primeiro
    const C = { x: de.x + (ate.x - de.x) * (ida ? 0.7 : 0.3), y: ida ? de.y : ate.y };
    const N = 24;
    const pontos = [];
    for (let i = 0; i <= N; i++) {
      const p = i / N; const t = curvaVoo(p); const u = 1 - t;
      pontos.push({
        p, t,
        x: u * u * de.x + 2 * u * t * C.x + t * t * ate.x,
        y: u * u * de.y + 2 * u * t * C.y + t * t * ate.y,
        dx: 2 * u * (C.x - de.x) + 2 * t * (ate.x - C.x),
        dy: 2 * u * (C.y - de.y) + 2 * t * (ate.y - C.y),
      });
    }
    // força do vento = velocidade de verdade de cada trecho, normalizada
    const vel = pontos.map((q, i) => (i ? Math.hypot(q.x - pontos[i - 1].x, q.y - pontos[i - 1].y) : 0));
    vel[0] = vel[1];
    const vmax = Math.max(...vel) || 1;
    const inclinar = (p) => {
      if (p < 0.18) return 14 * (p / 0.18);
      if (p < 0.7) return 14;
      if (p < 0.88) return 14 + (-4 - 14) * ((p - 0.7) / 0.18); // passa um tiquinho do zero
      return -4 + 4 * ((p - 0.88) / 0.12);
    };
    let anguloAntes = null;
    const quadrosVoo = []; const quadrosVento = [];
    for (const [i, q] of pontos.entries()) {
      const s = ((de.tam + (ate.tam - de.tam) * q.t) / TAM_VOO) * (1 + 0.1 * Math.sin(Math.PI * q.t));
      const k = q.p > 0.82 ? Math.sin(Math.PI * ((q.p - 0.82) / 0.18)) : 0; // amassa ao tocar o chão
      const giro = lado * inclinar(q.p);
      quadrosVoo.push({
        offset: q.p,
        transform: `translate(${(q.x - TAM_VOO / 2).toFixed(2)}px, ${(q.y - TAM_VOO / 2).toFixed(2)}px) rotate(${giro.toFixed(2)}deg) scale(${(s * (1 + 0.1 * k)).toFixed(4)}, ${(s * (1 - 0.12 * k)).toFixed(4)})`,
      });
      // o vento aponta para trás do movimento; desconta o giro do corpo, que ele herda
      let ang = (Math.atan2(q.dy, q.dx) * 180) / Math.PI + 180;
      if (anguloAntes !== null) while (ang - anguloAntes > 180) ang -= 360;
      if (anguloAntes !== null) while (ang - anguloAntes < -180) ang += 360;
      anguloAntes = ang;
      const forca = q.p >= 1 ? 0 : Math.min(1, vel[i] / vmax) ** 0.8;
      quadrosVento.push({
        offset: q.p,
        transform: `rotate(${(ang - giro).toFixed(2)}deg) scaleX(${(0.4 + 0.6 * forca).toFixed(3)})`,
        opacity: forca.toFixed(3),
      });
    }
    const opcoes = { duration: duracao, easing: 'linear', fill: 'forwards' };
    voo.classList.add('on');
    const animacoes = [voo.animate(quadrosVoo, opcoes), vooVento.animate(quadrosVento, opcoes)];
    const este = {
      destino, tam: ate.tam,
      cancelar() { for (const a of animacoes) a.cancel(); voo.classList.remove('on'); voando = null; },
    };
    voando = este;
    marcarFaces();
    animacoes[0].finished.then(() => {
      if (voando !== este) return;
      voo.classList.remove('on');
      for (const a of animacoes) a.cancel();
      voando = null;
      faceEm = destino;
      marcarFaces();
      pousar(alvo, ida);
    }, () => {});
  }

  // chegada: um anel que abre, faíscas que espirram e a face acendendo e voltando ao brilho normal
  function pousar(alvo, grande) {
    const casa = grande ? alvo.closest('.card') : alvo.parentElement; // o card recorta o anel; no notch é a casca
    const c = centroEm(alvo, casa);
    const pouso = document.createElement('div');
    pouso.className = 'pouso';
    pouso.style.left = `${c.x}px`;
    pouso.style.top = `${c.y}px`;
    const anel = document.createElement('div');
    anel.className = 'anel';
    pouso.append(anel);
    const animacoes = [anel.animate(
      [{ transform: `scale(${grande ? 0.45 : 0.25})`, opacity: 1 }, { transform: `scale(${grande ? 1.5 : 0.75})`, opacity: 0 }],
      { duration: grande ? 520 : 360, easing: 'cubic-bezier(.2,.7,.3,1)' },
    )];
    const n = grande ? 8 : 5; const r = grande ? 40 : 20;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI + 0.3;
      const f = document.createElement('i');
      f.className = 'faisca';
      pouso.append(f);
      animacoes.push(f.animate(
        [{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${(Math.cos(a) * r).toFixed(1)}px, ${(Math.sin(a) * r).toFixed(1)}px) scale(.3)`, opacity: 0 }],
        { duration: grande ? 480 : 320, easing: 'cubic-bezier(.1,.6,.3,1)' },
      ));
    }
    casa.append(pouso);
    const normal = getComputedStyle(alvo).filter;
    alvo.animate([{ filter: 'drop-shadow(0 0 22px rgba(170, 202, 255, .9)) brightness(1.35)' }, { filter: normal }], { duration: 600, easing: 'ease-out' });
    Promise.all(animacoes.map((a) => a.finished)).finally(() => pouso.remove());
  }

  // ── o ícone de cada card: placa na cor do estado + o glifo do que ele é (a face fica só para o Omni) ─
  const SVG = 'http://www.w3.org/2000/svg';
  function el(tag, atributos) {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(atributos || {})) n.setAttribute(k, v);
    return n;
  }
  const GLIFOS = {
    // caixa de arquivo: o depósito
    actions: () => [
      el('rect', { class: 'glifo', x: 17, y: 19, width: 30, height: 9, rx: 2.5 }),
      el('path', { class: 'glifo', d: 'M20 28 V43 a3 3 0 0 0 3 3 H41 a3 3 0 0 0 3 -3 V28' }),
      el('path', { class: 'glifo', d: 'M28 35 H36' }),
    ],
    // balão com reticências (genérico, sem marca): os pontos "digitam" quando chegou mensagem há pouco
    whats: () => [
      el('path', { class: 'glifo', d: 'M32 17 C42 17 48 23 48 31 C48 39 42 45 32 45 C29.5 45 27.2 44.6 25.2 43.9 L18 47 L20 40.5 C17.5 38 16 34.8 16 31 C16 23 22 17 32 17 Z' }),
      el('circle', { class: 'cheio digita', cx: 25, cy: 31, r: 2.6 }),
      el('circle', { class: 'cheio digita', cx: 32, cy: 31, r: 2.6 }),
      el('circle', { class: 'cheio digita', cx: 39, cy: 31, r: 2.6 }),
    ],
    // três nós ligados: a orquestração de agentes do Overcore
    overcore: () => [
      el('path', { class: 'glifo', d: 'M32 22 L21 40 M32 22 L43 40 M21 40 H43' }),
      el('circle', { class: 'cheio', cx: 32, cy: 21, r: 4.2 }),
      el('circle', { class: 'cheio', cx: 20.5, cy: 41, r: 4.2 }),
      el('circle', { class: 'cheio', cx: 43.5, cy: 41, r: 4.2 }),
    ],
    // um olho: o Oracle, que vigia a operação e lê os dados
    oracle: () => [
      el('path', { class: 'glifo', d: 'M14 32 C20 22 26 19 32 19 C38 19 44 22 50 32 C44 42 38 45 32 45 C26 45 20 42 14 32 Z' }),
      el('circle', { class: 'cheio', cx: 32, cy: 32, r: 6 }),
    ],
    // prompt de terminal: a sessão; o cursor pisca, mais rápido quando ela está rodando
    sessao: () => [
      el('path', { class: 'glifo', d: 'M20 23 L29 32 L20 41' }),
      el('rect', { class: 'cheio cursor', x: 32, y: 38, width: 13, height: 4.5, rx: 2 }),
    ],
    // cadeado: o cofre das credenciais (T7)
    cofre: () => [
      el('path', { class: 'glifo', d: 'M24 29 V24 a8 8 0 0 1 16 0 V29' }),
      el('rect', { class: 'glifo', x: 18, y: 29, width: 28, height: 19, rx: 4 }),
      el('circle', { class: 'cheio', cx: 32, cy: 37, r: 2.8 }),
      el('path', { class: 'glifo', d: 'M32 39 V42' }),
    ],
  };
  function icone(tipo, tom) {
    const svg = el('svg', { viewBox: '0 0 64 64', class: `icone ${tom}`, 'aria-hidden': 'true' });
    svg.append(el('rect', { class: 'placa', x: 5, y: 5, width: 54, height: 54, rx: 17 }), ...GLIFOS[tipo]());
    return svg;
  }
  const TONS = ['tom-rodando', 'tom-espera', 'tom-concluiu', 'tom-ociosa', 'tom-actions', 'tom-whats', 'tom-oracle', 'tom-cofre'];
  function tingir(svg, tom) {
    for (const t of TONS) svg.classList.toggle(t, t === tom);
  }
  const tomDe = (estadoSessao) => `tom-${['rodando', 'espera', 'concluiu'].includes(estadoSessao) ? estadoSessao : 'ociosa'}`;

  // ── helpers de DOM: texto de transcript entra só por textContent ──────────────────────────────────
  function no(tag, classe, texto) {
    const n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texto != null) n.textContent = texto;
    return n;
  }
  function quando(ms) {
    const d = Date.now() - ms;
    if (!(d >= 0)) return '';
    if (d < 60e3) return 'agora';
    if (d < 3600e3) return `${Math.floor(d / 60e3)}min`;
    if (d < 86400e3) return `${Math.floor(d / 3600e3)}h`;
    if (d < 172800e3) return 'ontem';
    return `${Math.floor(d / 86400e3)}d`;
  }
  // os status dos pontos são texto livre: a cor sai das palavras
  function classeStatus(status) {
    const s = String(status || '').toLowerCase();
    if (/andamento|ativo|rodando/.test(s)) return 'st-andamento';
    if (/aguard|esperando|pendente/.test(s)) return 'st-espera';
    if (/captur/.test(s)) return 'st-captura';
    if (/verde|pronto|conclu|entreg|instalado/.test(s)) return 'st-pronto';
    if (/guardado|refer/.test(s)) return 'st-parado';
    return 'st-outro';
  }

  // ── card Actions ──────────────────────────────────────────────────────────────────────────────────
  const actionsTotal = document.getElementById('actions-total');
  const actionsRotulo = document.getElementById('actions-rotulo');
  const actionsLinhas = document.getElementById('actions-linhas');
  let assinaturaActions = '';
  let pendentesActions = 0;
  const ROTULO_PEDIDO = { veredito: 'veredito', teste: 'olhar', entrega: 'venceu', 'item-proposto': 'item', conserto: 'conserto' };
  // a olhada de novidade: com a ilha aberta, a cara vira para o card e volta. Fechada, nada sinaliza
  // (pedido dele, 21/10). Não compete com o cursor dentro da forma (lá quem manda é o ponteiro).
  function novidadeActions() {
    if (!relogio || dentro || typeof olharPara !== 'function') return;
    const b = cardActions.getBoundingClientRect();
    olharPara({ x: b.left + b.width / 2 || 0, y: b.top + b.height / 2 || 400, longe: true });
    setTimeout(() => { if (!dentro) olharPara(null); }, 1400);
  }
  async function atualizarActions() {
    let r = null;
    try { r = await ponte.resumoActions(); } catch { /* fica o que estava */ }
    if (!r) return;
    // F2 (plano 4b): o depósito é do Oráculo e chega pela casa. Sem Oráculo instalado o card apaga e não
    // abre nada; com a casa ou o Oráculo fora, mostra o motivo no lugar das linhas.
    if (r.ausente || r.ok === false) {
      const assinatura = JSON.stringify(['fora', !!r.ausente, r.erro]);
      if (assinatura === assinaturaActions) return;
      assinaturaActions = assinatura;
      pendentesActions = 0;
      cardActions.classList.remove('pede');
      cardActions.classList.toggle('ausente', !!r.ausente);
      actionsTotal.textContent = '–';
      actionsRotulo.textContent = r.ausente ? 'INSTALAR' : 'FORA DO AR';
      actionsLinhas.replaceChildren(no('div', 'int-vazio', r.ausente ? 'Oráculo não instalado' : r.erro || 'Oráculo fora do ar'));
      return;
    }
    cardActions.classList.remove('ausente');
    // a cada 2 s chega o mesmo resumo: só refaz as linhas quando algo mudou (nem o "há 3 min" muda tão rápido)
    const praVoce = Number(r.praVoce) || 0;
    const recentes = Array.isArray(r.recentes) ? r.recentes : [];
    const assinatura = JSON.stringify([r.total, praVoce, r.pedidos, recentes.map((p) => [p.titulo, p.status, quando(p.alteradoEm), Date.now() - p.alteradoEm < 3600e3])]);
    if (assinatura === assinaturaActions) return;
    assinaturaActions = assinatura;
    // decisão pendente acende o card e a cara dá uma olhada de novidade; nada pendente, o card é o depósito
    if (praVoce > pendentesActions) novidadeActions();
    pendentesActions = praVoce;
    cardActions.classList.toggle('pede', praVoce > 0);
    if (praVoce > 0) {
      actionsTotal.textContent = String(praVoce);
      actionsRotulo.textContent = 'PRA VOCÊ';
      const linhas = (r.pedidos || []).map((p) => {
        const linha = no('div', 'int-linha');
        linha.append(no('i', 'pt st-espera pulsa'), no('span', 'int-nome', p.titulo), no('span', 'int-quando', ROTULO_PEDIDO[p.tipo] || ''));
        linha.lastChild.title = p.texto;
        return linha;
      });
      actionsLinhas.replaceChildren(...linhas);
      return;
    }
    actionsTotal.textContent = String(r.total);
    actionsRotulo.textContent = r.total === 1 ? 'PONTO' : 'PONTOS';
    const linhas = recentes.map((p, i) => {
      const linha = no('div', 'int-linha');
      const pt = no('i', `pt ${classeStatus(p.status)}`);
      if (i === 0 && Date.now() - p.alteradoEm < 3600e3) pt.classList.add('pulsa');
      const nome = no('span', 'int-nome', p.titulo);
      nome.title = p.status;
      linha.append(pt, nome, no('span', 'int-quando', quando(p.alteradoEm)));
      return linha;
    });
    actionsLinhas.replaceChildren(...(linhas.length ? linhas : [no('div', 'int-vazio', 'depósito vazio')]));
  }

  // ── card Oracle (27/10, no lugar do Overcore): os projetos que ele acompanha e a idade da última vigia ─
  const cardOracle = document.getElementById('card-oracle');
  let assinaturaOracle = '';
  async function atualizarOracle() {
    let r = null;
    try { r = await ponte.resumoOracle(); } catch { /* fica o que estava */ }
    if (!r) return;
    // F2 (plano 4b): o resumo vem do Oráculo pela casa; sem ele instalado, o card apaga (ausente)
    const ausente = !!r.ausente;
    const ok = !ausente && r.ok === true;
    const projetos = ok && Array.isArray(r.projetos) ? r.projetos : [];
    const assinatura = JSON.stringify([ausente, ok, r.erro, r.vigiando, r.total, quando(r.ultimaVigia), projetos.map((p) => [p.nome, quando(p.alteradoEm)])]);
    if (assinatura === assinaturaOracle) return;
    assinaturaOracle = assinatura;
    cardOracle.classList.toggle('ausente', ausente);
    cardOracle.classList.toggle('vigiando', ok && !!r.vigiando);
    $('oracle-estado').textContent = ausente ? 'NÃO INSTALADO' : !ok ? 'FORA DO AR' : r.vigiando ? 'VIGIANDO' : 'PARADO';
    $('oracle-total').textContent = ok ? String(r.total) : '–';
    $('oracle-rotulo').textContent = ausente ? 'INSTALAR' : r.total === 1 ? 'PROJETO' : 'PROJETOS';
    $('oracle-detalhe').textContent = !ok ? '' : r.ultimaVigia ? `vigia ${quando(r.ultimaVigia)}` : 'nunca vigiou';
    const linhas = projetos.map((p) => {
      const linha = no('div', 'int-linha');
      linha.append(no('i', 'pt st-outro'), no('span', 'int-nome', p.nome), no('span', 'int-quando', quando(p.alteradoEm)));
      return linha;
    });
    const vazio = ausente ? 'Oráculo não instalado' : !ok ? r.erro || 'Oráculo fora do ar' : 'nenhum projeto';
    $('oracle-linhas').replaceChildren(...(linhas.length ? linhas : [no('div', 'int-vazio', vazio)]));
  }

  // ── Overcore na coluna da direita (27/10): só as execuções que não terminaram, como pílulas de sessão ─
  const cardOc = document.getElementById('card-oc');
  const ocPilulas = document.getElementById('oc-pilulas');
  const ESTADO_OC = { admitted: 'admitida', planning: 'planejando', running: 'rodando', blocked: 'pede você', cancelling: 'cancelando', succeeded: 'concluída', failed: 'falhou', cancelled: 'cancelada' };
  let assinaturaOvercore = '';
  async function atualizarOvercore() {
    let r = null;
    try { r = await ponte.resumoOvercore(); } catch { /* fica o que estava */ }
    if (!r) return;
    const assinatura = JSON.stringify([r.ok, r.desligado, r.erro, r.sessoes, r.total, r.concluidas, r.ultima]);
    if (assinatura === assinaturaOvercore) return;
    assinaturaOvercore = assinatura;
    const sessoesOc = r.ok ? r.sessoes || [] : [];
    const pedem = sessoesOc.filter((e) => e.pede).length;
    cardOc.classList.toggle('no-ar', !!r.ok);
    cardOc.classList.toggle('pede', pedem > 0);
    const lista = sessoesOc.map((e) => {
      const estadoSes = e.pede ? 'espera' : e.estado === 'running' ? 'rodando' : 'ociosa';
      const p = no('button', `pilula ${estadoSes} ${tomDe(estadoSes)}`);
      p.tabIndex = -1;
      p.title = `${e.titulo} — ${ESTADO_OC[e.estado] || e.estado}`;
      const rosto = no('span', 'rosto');
      const ic = icone('overcore', tomDe(estadoSes));
      rosto.append(ic);
      p.append(rosto, no('span', 'rot', e.titulo), no('span', 'faz', ESTADO_OC[e.estado] || e.estado), no('i', 'pt'));
      tocar(p, abrirOvercoreInteiro);
      return p;
    });
    if (!lista.length) {
      const vazia = no('div', 'pilula vazia');
      vazia.append(no('span', 'rot', r.ok ? 'nenhuma sessão ativa' : r.desligado ? 'Overcore desligado' : 'Overcore sem resposta'));
      lista.push(vazia);
    }
    ocPilulas.replaceChildren(...lista);
    const rodando = sessoesOc.filter((e) => e.estado === 'running').length;
    const partes = [];
    if (rodando) partes.push(`${rodando} rodando`);
    if (pedem) partes.push(`${pedem} pede${pedem > 1 ? 'm' : ''} você`);
    const ociosas = sessoesOc.length - rodando - pedem;
    if (ociosas > 0) partes.push(`${ociosas} ociosa${ociosas > 1 ? 's' : ''}`);
    $('oc-estado').textContent = r.ok ? 'no ar' : r.desligado ? 'desligado' : 'sem resposta';
    $('oc-resumo').textContent = r.ok ? partes.join(' · ') || 'nenhuma sessão ativa' : r.erro || '–';
    $('oc-total').textContent = r.ok ? `${r.total || 0} execuç${r.total === 1 ? 'ão' : 'ões'} · ${r.concluidas || 0} concluída${r.concluidas === 1 ? '' : 's'}` : '–';
    $('oc-ultima').textContent = r.ok && r.ultima ? `última atividade: ${quando(typeof r.ultima === 'number' ? r.ultima : Date.parse(r.ultima))}` : '';
  }

  // ── card do cofre (F1, plano 5, T7): o total de credenciais e os primeiros alertas. Cada leitura abre um Node
  // com a CLI do cofre (segundos), então o ritmo é o do cofre-card.js, não o relógio de 2 s: ao abrir a forma
  // (no máximo 1x/min) e, aberta, a cada 5 min. Tocar abre a janela do cofre; a abertura seguinte relê.
  const cardCofre = document.getElementById('card-cofre');
  const { deveLer, vistaDoCard } = window.cofreCard;
  const cofre = { lidoEm: null, lendo: false, assinatura: '' };
  async function atualizarCofre(motivo) {
    if (!deveLer({ agora: Date.now(), lidoEm: cofre.lidoEm, lendo: cofre.lendo, motivo })) return;
    cofre.lendo = true;
    let r;
    try { r = await ponte.resumoCofre(); } catch (e) { r = { ok: false, codigo: 'falha', erro: String((e && e.message) || e) }; } finally { cofre.lendo = false; }
    if (r === null) return; // o main recusou o pedido (não veio da ilha): nada a mostrar
    cofre.lidoEm = Date.now();
    desenharCofre(vistaDoCard(r));
  }
  function desenharCofre(v) {
    const assinatura = JSON.stringify(v);
    if (assinatura === cofre.assinatura) return;
    cofre.assinatura = assinatura;
    cardCofre.classList.toggle('alerta', v.estado === 'alerta');
    cardCofre.classList.toggle('erro', v.estado === 'erro');
    const svg = cardCofre.querySelector('.icone');
    if (svg) tingir(svg, v.estado === 'alerta' ? 'tom-espera' : v.estado === 'erro' ? 'tom-ociosa' : 'tom-cofre');
    $('cofre-total').textContent = v.numero;
    $('cofre-rotulo').textContent = v.rotulo;
    $('cofre-detalhe').textContent = v.detalhe;
    $('cofre-detalhe').title = v.erro;
    const linhas = v.linhas.map(({ nome, regra }) => {
      const linha = no('div', 'int-linha');
      linha.append(no('i', 'pt st-espera'), no('span', 'int-nome', nome), no('span', 'int-quando', regra));
      return linha;
    });
    if (v.estado === 'erro' && v.erro) {
      const aviso = no('div', 'int-vazio', v.erro);
      aviso.title = v.erro; // a linha corta com reticências; o texto inteiro fica no title
      linhas.push(aviso);
    }
    $('cofre-linhas').replaceChildren(...linhas);
  }

  // ── coluna da máquina (o que o Gerenciador de Tarefas mostra de relance) ─────────────────────────
  const $ = (id) => document.getElementById(id);
  const gb = (bytes) => (bytes / 2 ** 30).toFixed(1);
  const mb = (n) => (n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${n} MB`);
  function duracao(s) {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}min` : `${m}min`;
  }
  function encher(barra, pct) {
    barra.style.width = `${Math.max(0, Math.min(100, pct)).toFixed(1)}%`;
    barra.parentElement.classList.toggle('alta', pct >= 75 && pct < 90);
    barra.parentElement.classList.toggle('critica', pct >= 90);
  }
  const HISTORICO_CPU = 40; // 40 leituras de 2 s: o último minuto e pouco
  const cpuHistorico = [];
  function desenharCpu() {
    const n = cpuHistorico.length;
    if (!n) return;
    const pontos = cpuHistorico.map((v, i) => {
      const x = n === 1 ? 100 : (100 * (HISTORICO_CPU - n + i)) / (HISTORICO_CPU - 1);
      return `${x.toFixed(2)},${(21 - (v / 100) * 20).toFixed(2)}`;
    });
    const x0 = pontos[0].split(',')[0];
    $('cpu-linha').setAttribute('points', pontos.join(' '));
    $('cpu-area').setAttribute('points', `${pontos.join(' ')} 100,22 ${x0},22`);
  }
  async function atualizarSistema() {
    let s = null;
    try { s = await ponte.sistema(); } catch { /* fica o que estava */ }
    if (!s) return;
    $('sis-maquina').textContent = s.maquina;
    $('sis-ligada').textContent = `ligada há ${duracao(s.ligadaHa)}`;
    $('sis-proc').textContent = `${s.processos || '…'} processos${s.ilhaMb != null ? ` · ilha ${s.ilhaMb} MB` : ''}`;
    const usada = s.memoria.total - s.memoria.livre;
    const pctMem = (100 * usada) / s.memoria.total;
    $('mem-valor').textContent = `${gb(usada)} / ${gb(s.memoria.total)} GB`;
    $('mem-pct').textContent = `${Math.round(pctMem)}%`;
    encher($('mem-barra'), pctMem);
    $('cpu-nucleos').textContent = `${s.nucleos} núcleos`;
    if (s.cpu != null) {
      $('cpu-valor').textContent = `${Math.round(s.cpu)}%`;
      cpuHistorico.push(s.cpu);
      if (cpuHistorico.length > HISTORICO_CPU) cpuHistorico.shift();
      desenharCpu();
    }
    if (s.disco) {
      const pctDisco = (100 * (s.disco.total - s.disco.livre)) / s.disco.total;
      $('disco-rot').textContent = `DISCO ${s.disco.raiz.replace(/\\$/, '')}`;
      $('disco-valor').textContent = `${gb(s.disco.livre)} GB livres`;
      $('disco-pct').textContent = `${Math.round(pctDisco)}%`;
      encher($('disco-barra'), pctDisco);
    }
    const maior = Math.max(1, ...s.pesados.map((p) => p.mb));
    const linhas = s.pesados.map((p) => {
      const linha = no('div', 'pesado');
      linha.style.setProperty('--p', `${((100 * p.mb) / maior).toFixed(1)}%`);
      linha.title = `${p.nome}: ${p.n} processo${p.n > 1 ? 's' : ''}`;
      linha.append(no('span', 'nm', p.nome));
      if (p.n > 1) linha.append(no('span', 'n', `×${p.n}`));
      linha.append(no('span', 'mb', mb(p.mb)));
      return linha;
    });
    $('pesados').replaceChildren(...(linhas.length ? linhas : [no('div', 'int-vazio', 'lendo os processos…')]));
  }

  // ── card WhatsApp: serviço, ponte e o movimento do dia (sem conteúdo de mensagem) ────────────────
  const cardWhats = $('card-whats');
  function linhaWhats(rotulo, valor, aviso) {
    const linha = no('div', `int-linha${aviso ? ' aviso' : ''}`);
    linha.append(no('span', 'rotulo', rotulo), no('span', 'valor', valor));
    return linha;
  }
  // as duas conexões moram fixas na primeira linha: o número do Omni e o WhatsApp dele. Na lista comum
  // elas ficavam atrás do "último sinal", e o dele passou de 14/10 a 24/10 desconectado sem ninguém ver
  const ESTADO_SESSAO = {
    ready: ['ok', ''], qr_ready: ['espera', 'QR'], created: ['espera', 'ligando'], initializing: ['espera', 'ligando'],
    authenticating: ['espera', 'ligando'], disconnected: ['caiu', 'caiu'], failed: ['caiu', 'falhou'], action_required: ['caiu', 'ação'],
  };
  const CONEXOES = [['bot', 'Omni', 'número do Omni'], ['pessoal', 'você', 'seu WhatsApp']];
  function linhaConexoes(s) {
    const linha = no('div', `int-linha conexoes${s && s.velha ? ' velha' : ''}`);
    for (const [nome, curto] of CONEXOES) {
      const c = s && s.sessoes && s.sessoes[nome];
      const [tom, estado] = (c && ESTADO_SESSAO[c.status]) || ['nada', '?'];
      const chip = no('span', `conexao c-${tom}`);
      chip.append(no('i', `pt${tom === 'caiu' ? ' pulsa' : ''}`), no('b', null, curto));
      if (c && c.fone) chip.append(no('span', 'fone', `·${c.fone}`));
      if (estado) chip.append(no('span', 'est', estado));
      linha.append(chip);
    }
    return linha;
  }
  function detalheConexoes(s) {
    return CONEXOES.map(([nome, , rotulo]) => {
      const c = s && s.sessoes && s.sessoes[nome];
      if (!c) return `${rotulo}: sem leitura`;
      const fone = c.fone ? ` (${c.fone})` : '';
      if (c.status === 'ready') return `${rotulo}${fone}: conectado${c.conectadaEm ? ` há ${quando(Date.parse(c.conectadaEm))}` : ''}`;
      return `${rotulo}${fone}: ${c.status}${c.ativaEm ? ` · última atividade há ${quando(Date.parse(c.ativaEm))}` : ''}`;
    });
  }
  async function atualizarWhats() {
    let w = null;
    try { w = await ponte.whatsapp(); } catch { /* fica o que estava */ }
    if (!w) return;
    const noAr = w.instalado && w.servico && w.ponte;
    // plano 4c: verde só com os dois números pareados e o pessoal provado só leitura (w.vista vem do main)
    const vista = w.vista || { estado: 'ausente', acao: null, texto: '' };
    const condicao = !w.instalado || !noAr ? 'parada' : vista.estado !== 'pareado' ? 'falta' : w.pausada ? 'pausada' : 'ligada';
    for (const c of ['ligada', 'pausada', 'parada', 'falta']) cardWhats.classList.toggle(c, c === condicao);
    cardWhats.dataset.acao = vista.acao || '';
    const rotuloFalta = vista.estado === 'conferindo' ? 'CONFERINDO' : 'PAREAR';
    $('whats-estado').textContent = !w.instalado ? 'AUSENTE' : { ligada: 'NO AR', pausada: 'PAUSADA', parada: 'PARADA', falta: rotuloFalta }[condicao];
    const svg = $('whats-icone').firstElementChild;
    if (svg) {
      tingir(svg, noAr ? 'tom-whats' : 'tom-ociosa');
      svg.classList.toggle('agitado', !!w.ultima && Date.now() - w.ultima < 120e3);
    }
    if (!w.instalado) {
      $('whats-total').textContent = '–';
      $('whats-detalhe').textContent = '';
      $('whats-linhas').replaceChildren(no('div', 'int-vazio', 'WhatsApp do Omni não instalado aqui'));
      return;
    }
    // s = saude.json da sonda (conexões, chaves, crédito, contagem pela API); sem ela fica o que o ponte.log diz
    const s = w.saude;
    const m = s && s.mensagens;
    const enviadas = m ? m.enviadas : w.enviadas;
    const recebidas = m ? m.recebidas : w.recebidas;
    $('whats-total').textContent = String(enviadas + recebidas);
    const terceiros = m && m.terceiros ? ` →${m.terceiros}` : '';
    const sessoes = s && s.mcp != null ? ` · ${s.mcp} ${s.mcp === 1 ? 'sessão' : 'sessões'}` : '';
    $('whats-detalhe').textContent = `↑${enviadas} ↓${recebidas}${terceiros}${sessoes}`;
    // altura padronizada: a coluna mostra 2 linhas por card. A primeira é das conexões; a outra vai para o
    // aviso (o que pede ação nunca fica de fora) e, sem aviso, para o último sinal; o resto no title
    const avisos = [];
    const linhas = [];
    const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (!w.servico) avisos.push(linhaWhats('serviço parado', '✗', true));
    if (!w.ponte) avisos.push(linhaWhats('ponte parada', '✗', true));
    if (s && s.ponte && s.ponte.cegaDesde) avisos.push(linhaWhats('ponte sem ver mensagens', quando(s.ponte.cegaDesde), true));
    if (s) {
      const ch = s.chaves;
      if (ch) {
        const ruins = ['leitura', 'envio', 'terceiros'].filter((p) => ch[p] !== 'ativa');
        if (ruins.length) avisos.push(linhaWhats('chave do serviço', ruins.map((p) => `${p} ${ch[p]}`).join(' · '), true));
        else linhas.push(linhaWhats('chaves do serviço', '3/3 ativas'));
      }
      const o = s.openai;
      if (o) {
        if (o.chave !== 'ativa') avisos.push(linhaWhats('chave OpenAI', o.chave, true));
        if (o.credito === 'sem') {
          const d = new Date(o.semCreditoDesde || w.vozAte || Date.now());
          const dia = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
          avisos.push(linhaWhats('OpenAI sem crédito',d.toDateString() === new Date().toDateString() ? hhmm(d) : `${dia} ${hhmm(d)}`, true));
          if (o.transcricaoLocal) linhas.push(linhaWhats('transcrição', 'local, sem voz'));
          else avisos.push(linhaWhats('transcrição', 'parada', true));
        } else if (o.chave === 'ativa') linhas.push(linhaWhats('OpenAI', o.credito === 'ok' ? 'ativa · com crédito' : 'ativa'));
      }
      if (s.ponte && s.ponte.falhasHoje) avisos.push(linhaWhats('falhas hoje', String(s.ponte.falhasHoje), true));
      if (s.velha) avisos.push(linhaWhats('saúde sem atualizar', quando(Date.parse(s.em)), true));
    } else if (w.vozAte) avisos.push(linhaWhats('voz sem crédito até', hhmm(new Date(w.vozAte)), true));
    linhas.unshift(linhaWhats('último sinal', w.ultima ? quando(w.ultima) : '—'));
    // o que falta parear passa na frente de qualquer aviso: sem os dois números o resto nem funciona
    if (vista.acao === 'parear') avisos.unshift(linhaWhats(vista.texto, 'parear ›', true));
    else if (vista.estado === 'conferindo') linhas.unshift(linhaWhats(vista.texto, '…'));
    const vaga = avisos.length > 1
      ? linhaWhats(avisos[0].firstChild.textContent, `+${avisos.length - 1} avisos`, true)
      : avisos[0] || linhas[0];
    cardWhats.title = [`hoje: ↑${enviadas} enviadas · ↓${recebidas} recebidas${m && m.terceiros ? ` · →${m.terceiros} a terceiros` : ''}`,
      ...detalheConexoes(s),
      ...[...avisos, ...linhas].map((l) => `${l.firstChild.textContent}: ${l.lastChild.textContent}`)].join('\n');
    $('whats-linhas').replaceChildren(linhaConexoes(s), vaga);
  }

  // ── card Sessões ──────────────────────────────────────────────────────────────────────────────────
  const pilulas = document.getElementById('pilulas');
  const sesResumo = document.getElementById('ses-resumo');
  let sessoes = [];
  let escolhida = null; // arquivo da sessão que o chat mostra
  const MAX_PILULAS = 12; // a coluna rola: 12 cabem com folga sem virar lista telefônica

  function desenharPilulas() {
    if (!pilulas) return; // 27/10: o card Sessões saiu da Início; a lista segue lida para a vista Chat
    const lista = sessoes.slice(0, MAX_PILULAS).map((s) => {
      const p = no('button', `pilula ${s.estado}`);
      p.tabIndex = -1;
      // o nome entre sessões ("overcore-3e") é o que ele usa para mandar trabalho; a pasta fica no title
      p.title = `${s.nome || s.projeto} · ${s.projeto} · ${s.id} — ${s.fazendo || s.estado}`;
      const rosto = no('span', 'rosto');
      const ic = icone('sessao', tomDe(s.estado));
      ic.classList.toggle('agitado', s.estado === 'rodando');
      rosto.append(ic);
      const pt = no('i', 'pt');
      p.classList.add(tomDe(s.estado));
      p.append(rosto, no('span', 'rot', s.nome || s.projeto));
      if (s.fazendo) p.append(no('span', 'faz', s.fazendo));
      p.append(pt);
      tocar(p, () => {
        if (estado !== 'aberta') return;
        escolhida = s.arquivo;
        trocarVista('chat');
      });
      return p;
    });
    while (lista.length < MAX_PILULAS && lista.length < 2) {
      const vazia = no('div', 'pilula vazia');
      vazia.append(no('span', 'rot', lista.length ? '—' : 'nenhuma sessão'));
      lista.push(vazia);
    }
    pilulas.replaceChildren(...lista);
    const conta = {};
    for (const s of sessoes) conta[s.estado] = (conta[s.estado] || 0) + 1;
    const partes = [];
    if (conta.rodando) partes.push(`${conta.rodando} rodando`);
    if (conta.espera) partes.push(`${conta.espera} esperando`);
    if (conta.concluiu) partes.push(`${conta.concluiu} pronta${conta.concluiu > 1 ? "s" : ""}`);
    if (!partes.length) partes.push(sessoes.length ? `${sessoes.length} ociosa${sessoes.length > 1 ? 's' : ''}` : 'nenhuma');
    sesResumo.textContent = partes.join(' · ');
  }

  // ── vista Chat ────────────────────────────────────────────────────────────────────────────────────
  const chatIcone = document.getElementById('chat-icone');
  const chatProj = document.getElementById('chat-proj');
  const chatTroca = document.getElementById('chat-troca');
  const chatFazendo = document.getElementById('chat-fazendo');
  const chatPassos = document.getElementById('chat-passos');
  const chatCodigo = document.getElementById('chat-codigo');

  function sessaoDoChat() {
    return sessoes.find((s) => s.arquivo === escolhida) || sessoes[0] || null;
  }

  function itemPasso(classe, ic, nome, alvo) {
    const li = no('li', `passo ${classe}`);
    li.append(no('span', 'ic', ic), no('b', classe === 'agora' ? 'brilho-texto' : '', nome));
    if (alvo) li.append(no('span', 'alvo', alvo));
    return li;
  }

  function desenharPassos(s, lista) {
    // só ferramentas; um 'erro' logo depois marca a ferramenta anterior
    const ferramentas = [];
    for (const p of lista) {
      if (p.tipo === 'ferramenta') ferramentas.push({ texto: p.texto, erro: false });
      else if (p.tipo === 'erro' && ferramentas.length) ferramentas[ferramentas.length - 1].erro = true;
    }
    const ultimas = ferramentas.slice(-4);
    const itens = ultimas.map((f, i) => {
      const [nome, ...resto] = f.texto.split(' · ');
      const alvo = resto.join(' · ');
      const ultima = i === ultimas.length - 1;
      if (f.erro) return itemPasso('erro', '✗', nome, alvo);
      if (!ultima) return itemPasso('feito', '✓', nome, alvo);
      if (s.estado === 'rodando') return itemPasso('agora', '', nome, alvo);
      if (s.estado === 'espera') return itemPasso('espera', '!', nome, alvo);
      if (s.estado === 'ociosa') return itemPasso('parado', '·', nome, alvo);
      return itemPasso('feito', '✓', nome, alvo);
    });
    if (s.estado === 'concluiu') itens.push(itemPasso('pronto', '✓', 'Pronto', ''));
    if (!itens.length) itens.push(itemPasso('parado', '·', 'sem ferramentas', 'ainda'));
    chatPassos.replaceChildren(...itens.slice(-4));
  }

  function desenharDiff(d) {
    if (!d) { chatCodigo.replaceChildren(no('div', 'codigo-vazio', 'nenhuma edição recente')); return; }
    const cab = no('div', 'codigo-cab');
    const arq = no('span', 'arq', d.arquivo);
    arq.title = `${d.ferramenta} · ${d.arquivo}`;
    cab.append(arq);
    if (!d.oculto) cab.append(no('span', 'cont-mais', `+${d.mais}`), no('span', 'cont-menos', `−${d.menos}`));
    if (d.hora) cab.append(no('span', 'cont-hora', quando(Date.parse(d.hora))));
    if (d.oculto) { chatCodigo.replaceChildren(cab, no('div', 'codigo-vazio', 'conteúdo oculto (arquivo sensível)')); return; }
    const corpo = no('div', 'codigo-corpo');
    for (const l of d.linhas) {
      const dl = no('div', `dl${l.t === '+' ? ' mais' : l.t === '-' ? ' menos' : ''}`);
      dl.append(no('span', 'sim', l.t === ' ' ? '' : l.t === '-' ? '−' : '+'), no('span', 'tx', l.s));
      corpo.append(dl);
    }
    if (d.cortadas) corpo.append(no('div', 'dl', `   … +${d.cortadas} linhas`));
    chatCodigo.replaceChildren(cab, corpo);
  }

  async function atualizarChat() {
    const s = sessaoDoChat();
    const svg = chatIcone.firstElementChild;
    if (!s) {
      chatProj.textContent = 'sem sessão';
      chatTroca.textContent = '0/0';
      chatFazendo.textContent = 'nenhuma sessão do Claude Code aberta';
      chatPassos.replaceChildren();
      desenharDiff(null);
      if (svg) { tingir(svg, 'tom-ociosa'); svg.classList.remove('agitado'); }
      return;
    }
    const i = sessoes.indexOf(s);
    chatProj.textContent = s.nome ? `${s.nome} · ${s.projeto}` : `${s.projeto} · ${s.id}`;
    chatTroca.textContent = `${i + 1}/${sessoes.length} ›`;
    chatFazendo.textContent = s.fazendo;
    chatFazendo.title = s.fazendo;
    if (svg) { tingir(svg, tomDe(s.estado)); svg.classList.toggle('agitado', s.estado === 'rodando'); }
    const [lista, d] = await Promise.all([
      ponte.passos(s.arquivo).catch(() => []),
      ponte.diff(s.arquivo).catch(() => null),
    ]);
    if (sessaoDoChat() !== s) return; // trocou de sessão enquanto lia
    desenharPassos(s, lista || []);
    desenharDiff(d);
  }

  tocar(chatTroca, () => {
    if (estado !== 'aberta' || sessoes.length < 2) return;
    const i = sessoes.indexOf(sessaoDoChat());
    escolhida = sessoes[(i + 1) % sessoes.length].arquivo;
    atualizarChat();
  });

  // ── atualização: ao abrir e a cada 2 s enquanto aberta (só a vista ligada) ────────────────────────
  let lendo = false;
  async function atualizar() {
    if (lendo) return;
    lendo = true;
    try {
      try { sessoes = (await ponte.sessoes()) || []; } catch { /* mantém a última leitura */ }
      if (vista === 'inicio') {
        desenharPilulas();
        atualizarCofre('relogio'); // sem await: a CLI do cofre pode levar segundos e não segura o relógio
        await Promise.all([atualizarActions(), atualizarSistema(), atualizarWhats(), atualizarOracle(), atualizarOvercore()]);
      } else await atualizarChat();
    } finally { lendo = false; }
  }
  let relogio = null;
  function vigiar(ligar) {
    clearInterval(relogio);
    relogio = ligar ? setInterval(atualizar, 2000) : null;
  }

  function agendar(fn, ms) {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  }

  function velocidade() {
    const agora = performance.now();
    while (rastro.length && agora - rastro[0].t > 100) rastro.shift();
    if (rastro.length < 2) return 0;
    let caminho = 0;
    for (let i = 1; i < rastro.length; i++) caminho += Math.hypot(rastro[i].x - rastro[i - 1].x, rastro[i].y - rastro[i - 1].y);
    return caminho / Math.max(16, agora - rastro[0].t);
  }

  // Abrir por hover exige duas coisas: o ponteiro parou, e o mouse é da ilha. Num arrasto (janela levada
  // ao topo para o Snap, aba do navegador, arquivo do Explorer) quem tem a captura é outro app e nenhum
  // mousemove chega aqui: a ilha só espia e não abre por cima do que ele está soltando.
  function verificarIntencao() {
    if (estado !== 'espiando' || !dentro) return;
    const doMouse = ultimoMovimento >= entradaEm;
    if (!doMouse || velocidade() > VELOCIDADE_MAXIMA) { agendar(verificarIntencao, TEMPO.reintencao); return; }
    ir('aberta');
  }

  function entrou() {
    clearTimeout(timer);
    // o mousemove pode chegar um pouco antes do aviso do main (a captura liga no mesmo tick da sonda)
    entradaEm = performance.now() - 60;
    if (bloqueada) return;
    fixada = false;
    if (estado === 'recolhida') {
      // Voltou para a forma que ainda encolhia: desfaz o fechamento em vez de murchar até o ícone e crescer.
      if (animando && largura.v > FORMAS.espiando.w + 40) { ir('aberta'); return; }
      ir('espiando');
      agendar(verificarIntencao, TEMPO.intencao);
    } else if (estado === 'espiando') {
      agendar(verificarIntencao, TEMPO.intencao);
    }
    // aberta: só cancela a carência (clearTimeout acima)
  }

  function saiu() {
    bloqueada = false;
    rastro.length = 0;
    if (estado === 'espiando') agendar(() => ir('recolhida'), TEMPO.saidaEspiando);
    else if (estado === 'aberta' && !fixada) agendar(() => ir('recolhida'), porClique ? TEMPO.carenciaClique : TEMPO.carenciaHover);
  }

  function clicou() {
    clearTimeout(timer);
    bloqueada = false;
    fixada = false;
    porClique = true;
    if (estado !== 'aberta') ir('aberta');
  }

  function recolherJa() {
    clearTimeout(timer);
    if (estado === 'recolhida') return;
    bloqueada = dentro; // Escape com o ponteiro em cima: não reabre debaixo dele
    ir('recolhida');
  }

  // ── a face olha o cursor (21/10): vira a cabeça de verdade. As poses saem do giro curto aprovado
  // (vira\curto\, renderizado sobre preto e sobre branco para ter alfa), numa grade de guinada −20°..20° a
  // cada 2,5° por aceno −12°..12° a cada 3°: giro\g_<i>_<j>.png. A face troca de pose; o flutuar e o pouso
  // seguem no transform dela, sem briga. Sem ponteiro, volta para a frente.
  const GIRO = { yMax: 20, pMax: 12, passoY: 2.5, passoP: 3 };
  const pose = (i, j) => `giro/g_${i}_${j}.png`;
  const FRENTE = pose(GIRO.yMax / GIRO.passoY, GIRO.pMax / GIRO.passoP);
  const prontas = new Set([FRENTE]);
  if (!REDUZIDO) {
    for (let j = 0; j <= 2 * GIRO.pMax / GIRO.passoP; j++) for (let i = 0; i <= 2 * GIRO.yMax / GIRO.passoY; i++) {
      const im = new Image(); im.src = pose(i, j);
      im.decode().then(() => prontas.add(im.getAttribute('src')), () => {});
    }
  }
  const olhar = { alvo: null, yaw: 0, pit: 0, rodando: false };
  function vestir(face, src) { if (prontas.has(src) && face.getAttribute('src') !== src) face.setAttribute('src', src); }
  function olharPara(alvo) {
    if (REDUZIDO) return;
    olhar.alvo = alvo;
    if (!olhar.rodando) { olhar.rodando = true; requestAnimationFrame(passoOlhar); }
  }
  function passoOlhar() {
    const face = faceEm === 'coluna' ? faceColuna : faceNotch;
    vestir(face === faceColuna ? faceNotch : faceColuna, FRENTE);
    let yaw = 0; let pit = 0;
    if (olhar.alvo && !voando) {
      const b = face.getBoundingClientRect();
      // cursor pela tela (fora da forma) tem alcance maior: senão qualquer ponto abaixo do notch é "olhar pro chão"
      const [ax, ay] = olhar.alvo.longe ? [520, 360] : [150, 120];
      const nx = Math.max(-1, Math.min(1, (olhar.alvo.x - (b.left + b.width / 2)) / ax));
      const ny = Math.max(-1, Math.min(1, (olhar.alvo.y - (b.top + b.height / 2)) / ay));
      yaw = GIRO.yMax * nx; pit = -GIRO.pMax * ny; // no curto, aceno positivo levanta o rosto: cursor embaixo pede aceno negativo
    }
    const k = 0.18; // cada quadro anda 18% do que falta: a cabeça acompanha sem teleportar
    olhar.yaw += (yaw - olhar.yaw) * k; olhar.pit += (pit - olhar.pit) * k;
    if (!olhar.alvo && Math.abs(olhar.yaw) < 0.5 && Math.abs(olhar.pit) < 0.5) {
      vestir(face, FRENTE);
      Object.assign(olhar, { yaw: 0, pit: 0, rodando: false });
      return;
    }
    // chegou na pose do alvo: o laço dorme até o próximo movimento (o cursor da tela é um alvo permanente)
    if (olhar.alvo && !voando && Math.abs(yaw - olhar.yaw) < 0.3 && Math.abs(pit - olhar.pit) < 0.3) {
      vestir(face, pose(Math.round((yaw + GIRO.yMax) / GIRO.passoY), Math.round((pit + GIRO.pMax) / GIRO.passoP)));
      olhar.rodando = false;
      return;
    }
    vestir(face, pose(Math.round((olhar.yaw + GIRO.yMax) / GIRO.passoY), Math.round((olhar.pit + GIRO.pMax) / GIRO.passoP)));
    requestAnimationFrame(passoOlhar);
  }

  // ── eventos ───────────────────────────────────────────────────────────────────────────────────────
  ponte.aoPonteiro(({ dentro: d }) => {
    if (d === dentro) return;
    dentro = d;
    if (dentro) entrou(); else saiu();
    atualizarEscape();
  });

  // Fora da forma, o cursor vem da sonda do main (coordenadas da janela, as mesmas do clientX/Y).
  ponte.aoCursor(({ x, y }) => { if (!dentro) olharPara({ x, y, longe: true }); });

  // Escape vem do main (atalho global): a ilha nunca tem o foco do teclado.
  ponte.aoTecla((tecla) => { if (tecla === 'escape') recolherJa(); });

  // Só chega com o ponteiro sobre o corpo (fora dele a janela ignora o mouse). clientX/Y e não screenX/Y: a
  // janela nunca se move, e o screenX vem 0 em eventos sintéticos (sendInputEvent), o que zerava a velocidade.
  document.addEventListener('mousemove', (ev) => {
    ultimoMovimento = performance.now();
    rastro.push({ t: ultimoMovimento, x: ev.clientX, y: ev.clientY });
    if (rastro.length > 32) rastro.shift();
    // só com o ponteiro dentro: um mousemove atrasado depois do "saiu" reacendia o alvo e a face estacionava virada
    if (dentro) olharPara({ x: ev.clientX, y: ev.clientY });
  });

  // Toque = soltar o botão em cima do elemento, e não 'click'. Com a janela Actions aberta (mesmo
  // minimizada), o Windows engole o botão-baixo na ilha, que não ativa: só chega o pointerup, e sem o par
  // não há click (bancada ao vivo, 21/10). O teste é pelo retângulo, não pelo nó: o refresh de 2 s troca as
  // linhas por baixo do ponteiro. stopPropagation: o poço não pode tratar o mesmo toque como "abrir".
  function tocar(el, fn) {
    el.addEventListener('pointerup', (ev) => {
      if (ev.button !== 0) return;
      const b = el.getBoundingClientRect();
      if (ev.clientX < b.left || ev.clientX >= b.right || ev.clientY < b.top || ev.clientY >= b.bottom) return;
      ev.stopPropagation();
      fn(ev);
    });
  }

  for (const tipo of ['pointerdown', 'pointerup']) {
    poco.addEventListener(tipo, (ev) => {
      if (ev.button !== 0 || ev.target.closest('#fechar')) return;
      clicou();
    });
  }

  // o card Actions abre o depósito (a janela do Oráculo) e a ilha recolhe (sem reabrir debaixo do
  // ponteiro); o cabeçalho do card do Oráculo (olho, nome, números; a máquina embaixo não) abre o painel
  // dele. Card apagado (agente não instalado) vira o INSTALAR (plano 5c): a ilha recolhe para a escolha da
  // pasta não nascer embaixo dela, o rótulo mostra o andamento e a falha vai para a linha do card. O próximo
  // resumo depois da instalação acende o card sozinho (a casa reinicia e passa a ver o agente).
  let instalandoAgente = false;
  async function instalarDoCard(rotulo, linhas) {
    if (instalandoAgente) return;
    instalandoAgente = true;
    rotulo.textContent = 'INSTALANDO…';
    recolherJa();
    let r = null;
    try { r = await ponte.instalarAgente('oraculo'); } catch { r = { ok: false, erro: 'a ilha não conseguiu pedir a instalação' }; }
    instalandoAgente = false;
    if (!r || r.cancelado) { rotulo.textContent = 'INSTALAR'; return; }
    rotulo.textContent = r.ok ? 'INSTALADO' : 'FALHOU';
    if (!r.ok) linhas.replaceChildren(no('div', 'int-vazio', r.erro || 'a instalação falhou'));
  }
  tocar(cardActions, () => {
    if (estado !== 'aberta' || !poco.classList.contains('revelada')) return;
    if (cardActions.classList.contains('ausente')) { instalarDoCard(actionsRotulo, actionsLinhas); return; }
    ponte.abrirActions();
    recolherJa();
  });
  tocar(cardOracle.querySelector('.or-cab'), () => {
    if (estado !== 'aberta' || !poco.classList.contains('revelada')) return;
    if (cardOracle.classList.contains('ausente')) { instalarDoCard($('oracle-rotulo'), $('oracle-linhas')); return; }
    ponte.abrirOraculo();
    recolherJa();
  });
  // o card do cofre abre a janela da T6; ao voltar, a ilha relê (o que mudou lá aparece aqui)
  tocar(cardCofre, () => {
    if (estado !== 'aberta' || !poco.classList.contains('revelada')) return;
    ponte.abrirCofre();
    cofre.lidoEm = null;
    recolherJa();
  });
  // plano 4c: com pareamento faltando, o card do WhatsApp inteiro é o "parear" (as linhas mudam a cada 2 s,
  // botão dentro delas trocaria de nó embaixo do ponteiro). Card verde ou parado não abre nada.
  tocar(cardWhats, () => {
    if (estado !== 'aberta' || !poco.classList.contains('revelada') || cardWhats.dataset.acao !== 'parear') return;
    if (typeof ponte.abrirPareamento !== 'function') return;
    ponte.abrirPareamento();
    recolherJa();
  });

  // o ⤢ do card Overcore (e as pílulas dele) abre a janela própria do Overcore, a tela inteira
  function abrirOvercoreInteiro() {
    if (estado !== 'aberta' || !poco.classList.contains('revelada')) return;
    ponte.abrirOvercore();
    recolherJa();
  }
  tocar(document.getElementById('oc-expandir'), abrirOvercoreInteiro);

  // o balão do cabeçalho abre a janela de chat com o Omni (a ilha não pega foco; a janela pega)
  tocar(document.getElementById('abrir-chat'), () => {
    if (estado !== 'aberta' || !poco.classList.contains('revelada')) return;
    ponte.abrirChat();
    recolherJa();
  });

  tocar(fechar, () => { if (estado === 'aberta') ponte.fechar(); });

  for (const a of abas) {
    if (!a.dataset.vista) continue; // o balão do chat abre janela, não troca de vista
    tocar(a, () => {
      if (estado === 'aberta' && poco.classList.contains('revelada')) trocarVista(a.dataset.vista);
    });
  }

  // A janela só muda de tamanho uma vez (quando o main aplica a medida) ou quando a tela muda.
  window.addEventListener('resize', () => aplicar(true));

  // ── início ────────────────────────────────────────────────────────────────────────────────────────
  function iniciar() {
    document.documentElement.style.setProperty('--faixa', `${FAIXA}px`);
    document.documentElement.style.setProperty('--largura-aberta', `${LARGURA_ABERTA}px`);
    desenharFaixa(document.getElementById('faixa-esq'), 'aro-esq');
    desenharFaixa(document.getElementById('faixa-dir'), 'aro-dir');
    const TOM_INICIAL = { actions: 'tom-actions', whats: 'tom-whats', sessao: 'tom-ociosa', overcore: 'tom-ociosa', oracle: 'tom-ociosa', cofre: 'tom-cofre' };
    for (const lugar of document.querySelectorAll('[data-icone]')) {
      lugar.replaceChildren(icone(lugar.dataset.icone, TOM_INICIAL[lugar.dataset.icone]));
    }
    // a altura de cada vista é a do card dela (as vistas são absolutas: o conteúdo não cresce com elas)
    for (const v of vistas) ALTURAS[v.dataset.vista] = ALTURA_TOPO + v.firstElementChild.offsetHeight + MARGEM_BASE;
    FORMAS.aberta.h = ALTURAS[vista];
    if (COMECA_ABERTA) {
      estado = 'aberta';
      fixada = true;
      for (const [t, valor] of [[largura, FORMAS.aberta.w], [altura, FORMAS.aberta.h], [raio, FORMAS.aberta.r]]) t.v = t.alvo = valor;
    }
    aplicar(true);
    ponte.pronta({ largura: LARGURA_ABERTA + 2 * (FAIXA + FOLGA), altura: Math.max(...Object.values(ALTURAS)) + FOLGA_BAIXO });
    if (COMECA_ABERTA) { acenderChama(true); vigiar(true); }
    atualizar();
  }
  iniciar();

  // Para a bancada de testes (leitura só; não muda nada).
  window.omniIlhaDepurar = () => ({
    estado, vista, dentro, porClique, bloqueada, fixada, animando, quadros, alturas: { ...ALTURAS },
    revelada: poco.classList.contains('revelada'), faceEm, voando: !!voando,
    w: largura.v, h: altura.v, r: raio.v, formas: JSON.parse(JSON.stringify(FORMAS)),
  });
})();
