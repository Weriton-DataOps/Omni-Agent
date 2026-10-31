// rig/idle.js — trilhas por chaves e o idle sempre ligado.
// Idle: deriva lenta (~0,13 Hz; yaw 2,5°, pitch 1,5°, roll 1°), sacadas de atenção de 4–8° a cada 2–5 s
// alternando o lado, antecipação de 4% em 80 ms antes de viradas > 10°, roll acompanhando o yaw de leve,
// e respiração. Tudo periódico no período P (frequências múltiplas de 1/P, sacadas repetidas a cada P):
// num laço de P segundos o primeiro quadro e o último emendam sem salto.
(function () {
  'use strict';
  const OMNI = (window.OMNI = window.OMNI || {});
  const suave = (x) => x * x * (3 - 2 * x);

  // chaves: {Param: [[t, valor, 'suave'|'linear'|'degrau'], ...]}; o modo vale do ponto anterior até este
  function trilha(chaves) {
    const ids = Object.keys(chaves);
    return function (t) {
      const v = {};
      for (const id of ids) {
        const k = chaves[id];
        if (t <= k[0][0]) { v[id] = k[0][1]; continue; }
        if (t >= k[k.length - 1][0]) { v[id] = k[k.length - 1][1]; continue; }
        let i = 1;
        while (k[i][0] < t) i++;
        const [ta, va] = k[i - 1], [tb, vb, modo] = k[i];
        const x = tb > ta ? (t - ta) / (tb - ta) : 1;
        const e = modo === 'degrau' ? (x >= 1 ? 1 : 0) : modo === 'linear' ? x : suave(x);
        v[id] = va + (vb - va) * e;
      }
      return v;
    };
  }

  function idle(modelo, opcoes) {
    opcoes = opcoes || {};
    const P = opcoes.periodo || 120;
    const s = OMNI.sorteio(opcoes.semente == null ? 7 : opcoes.semente);
    const graus = {};
    for (const p of modelo.parametros) graus[p.id] = p.graus;
    const TAU = Math.PI * 2;

    // harmônicos de 1/P perto de 0,13 / 0,21 / 0,07 Hz, distintos entre si
    const ms = [];
    for (const hz of [0.13, 0.21, 0.07]) {
      let m = Math.max(1, Math.round(hz * P));
      while (ms.includes(m)) m++;
      ms.push(m);
    }
    const pesos = [0.62, 0.26, 0.12];
    const deriva = {};
    for (const [id, amp] of [['AnguloX', 2.5], ['AnguloY', 1.5], ['AnguloZ', 1.0]]) {
      deriva[id] = { amp, fases: ms.map(() => s.entre(0, TAU)) };
    }
    const ruido = (id, t) => {
      const d = deriva[id];
      let v = 0;
      for (let i = 0; i < ms.length; i++) v += pesos[i] * Math.sin(TAU * ms[i] * t / P + d.fases[i]);
      return d.amp * v;
    };

    // sacadas: instantes em [0, P), lado alternado; antes da primeira vale a última (emenda do laço)
    const sacadas = [];
    let ts = s.entre(0.6, 2.0), lado = s.prox() < 0.5 ? -1 : 1;
    while (ts < P - 1.5) {
      sacadas.push({ t: ts, yaw: lado * s.entre(4, 8), pitch: s.entre(-2, 2) });
      lado = -lado;
      ts += s.entre(2, 5);
    }
    if (!sacadas.length) sacadas.push({ t: 0, yaw: 0, pitch: 0 });
    for (let i = 0; i < sacadas.length; i++) {
      const ant = sacadas[(i - 1 + sacadas.length) % sacadas.length];
      sacadas[i].salto = sacadas[i].yaw - ant.yaw;
    }
    const ANTEC = 0.08, FRACAO = 0.04;
    function sacadaEm(tm) {
      let atual = sacadas[sacadas.length - 1];
      for (const sc of sacadas) if (sc.t <= tm) atual = sc;
      let yaw = atual.yaw, pitch = atual.pitch;
      // antecipação: recua 4% do salto nos 80 ms antes de uma virada grande
      for (const sc of sacadas) {
        if (Math.abs(sc.salto) <= 10) continue;
        let dt = sc.t - tm;
        if (dt < 0) dt += P;
        if (dt > 0 && dt <= ANTEC) yaw -= FRACAO * sc.salto * suave(1 - dt / ANTEC);
      }
      return { yaw, pitch };
    }

    const ciclo = modelo.rig.respira.ciclo;
    const Pr = opcoes.cicloRespira || P / Math.max(1, Math.round(P / ciclo));
    return {
      periodo: P, cicloRespira: Pr, sacadas,
      em(t) {
        const tm = ((t % P) + P) % P;
        const sc = sacadaEm(tm);
        const yaw = ruido('AnguloX', tm) + sc.yaw;
        const pitch = ruido('AnguloY', tm) + sc.pitch;
        const roll = ruido('AnguloZ', tm) + 0.12 * sc.yaw;
        const v = { AnguloX: yaw / graus.AnguloX, AnguloY: pitch / graus.AnguloY, AnguloZ: roll / graus.AnguloZ };
        if (opcoes.respira !== false) v.Respira = 0.5 - 0.5 * Math.cos(TAU * tm / Pr);
        return v;
      },
    };
  }

  OMNI.rig = OMNI.rig || {};
  Object.assign(OMNI.rig, { trilha, idle });
})();
