// nucleo/relogio.js — o tempo do motor anda em passos fixos de 1/240 s.
// O instante t vira um índice inteiro de passo; o vivo e o vídeo caem no mesmo passo para o mesmo t,
// então a mesma cena dá o mesmo quadro, bit a bit, em qualquer taxa de quadros.
(function () {
  'use strict';
  const OMNI = (window.OMNI = window.OMNI || {});
  const HZ = 240;
  const DT = 1 / HZ;

  const relogio = {
    HZ, DT,
    passo(t) { return Math.round(t * HZ); },          // índice do passo que representa t
    tempo(n) { return n / HZ; },                       // instante do passo n
    // relógio de parede para o vivo: começa em 0 na primeira leitura
    parede() {
      let t0 = null;
      return { agora() { const a = performance.now() / 1000; if (t0 == null) t0 = a; return a - t0; } };
    },
  };

  // gerador pseudoaleatório com semente (mulberry32): mesma semente, mesma sequência
  function sorteio(semente) {
    let a = semente >>> 0;
    const prox = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return { prox, entre: (a_, b_) => a_ + (b_ - a_) * prox() };
  }

  OMNI.relogio = relogio;
  OMNI.sorteio = sorteio;
})();
