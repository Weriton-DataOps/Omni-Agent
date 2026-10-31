// rig/fisica.js — o cabelo atrasa sobre a cabeça.
// Duas molas na CPU (yaw e pitch), f 1,2 Hz e zeta 0,35, perseguindo o ângulo da cabeça.
// O que sai é o atraso (mola - cabeça); o vertex shader soma esse atraso pesado pela máscara A
// (raiz 0 -> ponta 1), então a raiz gira com o crânio e a ponta chega depois e passa do ponto.
(function () {
  'use strict';
  const OMNI = (window.OMNI = window.OMNI || {});

  function cabelo(modelo) {
    const c = modelo.rig.cabelo;
    const m = [OMNI.rig.mola(c.f, c.zeta, 0), OMNI.rig.mola(c.f, c.zeta, 0)];
    return {
      reinicia(cabeca) { m[0].reinicia(cabeca[0]); m[1].reinicia(cabeca[1]); },
      passo(dt, cabeca) {
        return [m[0].passo(dt, cabeca[0]) - cabeca[0], m[1].passo(dt, cabeca[1]) - cabeca[1], 0];
      },
    };
  }

  OMNI.fisica = { cabelo };
})();
