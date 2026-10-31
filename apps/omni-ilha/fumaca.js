'use strict';

// A chama viva do Omni na ilha. É a variante F da bancada ("A arte, viva"), escolhida pelo Weriton em
// 18/10/2026 com chama acesa 0, densidade 0, tamanho 1,00 e cor #2f6bff. O arquivo dela é carregado
// tal como foi aprovado (bancada/variantes/escolhida/), com o mesmo nucleo.js e a mesma chama extraída
// da arte; aqui só se monta o palco de 44×40, igual ao da ilha na bancada, e o laço.
//
// Recolhida, a chama fica na energia 0; no hover (liberar) ela sobe até 1, como o hover dos cartões.
(() => {
  const cv = document.getElementById('fumaca-cv');
  const B = window.OmniBancada;
  if (!cv || typeof cv.getContext !== 'function' || !B) return;
  const variante = B.variantes.find((v) => v.id === 'f');
  const ctx = cv.getContext('2d');
  if (!variante || !ctx) return;

  const W = 44;
  const H = 40;
  const CONFIG = { densidade: 0, escala: 1, cor: '#2f6bff' };
  const reduzido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function dimensionar() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  dimensionar();
  window.addEventListener('resize', dimensionar);

  const chama = variante.criar({ ctx, W, H });
  let energia = 0;
  let alvo = 0;
  let ultimo = performance.now();
  const laco = (agora) => {
    const dt = Math.min(50, agora - ultimo);
    ultimo = agora;
    energia += (alvo - energia) * 0.08;
    try {
      chama.quadro(dt, agora, { ...CONFIG, energia, reduzido });
    } catch (e) {
      console.error('chama F', e);
      return; // erro de desenho não vira tempestade de exceções a 60 quadros por segundo
    }
    requestAnimationFrame(laco);
  };
  requestAnimationFrame(laco);

  // o renderer chama isto ao espiar: liberar(true) = a chama acorda. O canvas se chama fumaca-cv, e não
  // fumaca, para window.fumaca nunca resolver para o elemento se este arquivo sair antes de chegar aqui.
  window.fumaca = { liberar: (v) => { alvo = v ? 1 : 0; } };
})();
