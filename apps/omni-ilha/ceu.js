'use strict';

// O céu estrelado dos cards (21/10; 27/10 virou um por canvas). Cada canvas.ceu ganha o seu: estrelas que
// cintilam e, de vez em quando, uma estrela cadente. A paleta vem do data-ceu (o da máquina é frio, o do
// Overcore é brasa). Só desenha com a ilha aberta e revelada (fechada, ninguém vê e o relógio para); com
// movimento reduzido, desenha uma vez e fica parado.
(() => {
  const poco = document.getElementById('ilha');
  if (!poco) return;
  const REDUZIDO = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const QUADRO_MS = 50; // ~20 fps: cintilar não precisa de 60

  const PALETAS = {
    frio: { semente: 20261021, cores: ['255,255,255', '200,214,255', '255,226,200', '180,240,255'], rastro: '255,255,255' },
    violeta: { semente: 20261127, cores: ['236,230,255', '205,190,255', '180,160,245', '220,214,250'], rastro: '215,200,255', brilho: 0.75 },
    agua: { semente: 20261127, cores: ['225,255,246', '185,242,226', '150,226,206', '212,250,240'], rastro: '195,250,232', brilho: 0.75 },
    brasa: { semente: 20261027, cores: ['240,228,214', '230,196,150', '215,165,115', '235,214,184'], rastro: '230,200,160', brilho: 0.7 },
  };

  function ceu(tela) {
    const ctx = tela.getContext('2d');
    const paleta = PALETAS[tela.dataset.ceu] || PALETAS.frio;

    // posições fixas (sorteio com semente): redimensionar o card não embaralha o céu
    let semente = paleta.semente;
    const sorteio = () => ((semente = (semente * 1664525 + 1013904223) >>> 0) / 4294967296);
    const estrelas = Array.from({ length: 78 }, () => ({
      x: sorteio(),
      y: sorteio(),
      r: 0.35 + Math.pow(sorteio(), 3) * 1.1,
      a: (0.25 + sorteio() * 0.6) * (paleta.brilho || 1),
      vel: 0.6 + sorteio() * 2.2,
      fase: sorteio() * Math.PI * 2,
      cor: paleta.cores[Math.floor(sorteio() * paleta.cores.length)],
    }));

    let w = 0;
    let h = 0;
    function medir() {
      const dpr = window.devicePixelRatio || 1;
      const caixa = tela.getBoundingClientRect();
      w = Math.max(1, Math.round(caixa.width));
      h = Math.max(1, Math.round(caixa.height));
      tela.width = Math.round(w * dpr);
      tela.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    let cadente = null;
    let proximaCadente = 4000 + Math.random() * 4000;
    function desenhar(t) {
      ctx.clearRect(0, 0, w, h);
      for (const e of estrelas) {
        const brilho = REDUZIDO ? e.a : e.a * (0.55 + 0.45 * Math.sin(t / 1000 * e.vel + e.fase));
        ctx.fillStyle = `rgba(${e.cor},${brilho.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(e.x * w, e.y * h, e.r, 0, Math.PI * 2);
        ctx.fill();
        if (e.r > 1.1) { // as maiores ganham um halo
          ctx.fillStyle = `rgba(${e.cor},${(brilho * 0.12).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(e.x * w, e.y * h, e.r * 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (REDUZIDO) return;
      if (!cadente && t > proximaCadente) {
        cadente = { t0: t, x: w * (0.3 + Math.random() * 0.6), y: h * Math.random() * 0.4, dur: 700 };
      }
      if (cadente) {
        const p = (t - cadente.t0) / cadente.dur;
        if (p >= 1) { cadente = null; proximaCadente = t + 7000 + Math.random() * 9000; return; }
        const x = cadente.x - p * 90;
        const y = cadente.y + p * 45;
        const rastro = ctx.createLinearGradient(x, y, x + 34, y - 17);
        const alfa = Math.sin(p * Math.PI) * 0.8;
        rastro.addColorStop(0, `rgba(${paleta.rastro},${alfa.toFixed(3)})`);
        rastro.addColorStop(1, `rgba(${paleta.rastro},0)`);
        ctx.strokeStyle = rastro;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 34, y - 17);
        ctx.stroke();
      }
    }

    let relogio = null;
    const inicio = performance.now();
    function ligar(sim) {
      if (sim && !relogio) {
        medir();
        desenhar(performance.now() - inicio);
        if (!REDUZIDO) relogio = setInterval(() => desenhar(performance.now() - inicio), QUADRO_MS);
      } else if (!sim && relogio) {
        clearInterval(relogio);
        relogio = null;
      }
    }

    new MutationObserver(() => ligar(poco.classList.contains('revelada'))).observe(poco, { attributes: true, attributeFilter: ['class'] });
    new ResizeObserver(() => { if (relogio || REDUZIDO) { medir(); desenhar(performance.now() - inicio); } }).observe(tela);
    ligar(poco.classList.contains('revelada'));
  }

  document.querySelectorAll('canvas.ceu').forEach(ceu);
})();
