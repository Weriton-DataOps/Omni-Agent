// provas/fisica.js — (d) no estalo de yaw as pontas do cabelo atrasam 100–250 ms e assentam em até 1,5 s.
// Cena do giro, estalo em t = 5,9 s (alvo de yaw 0 -> 0,8 num degrau, mantido até 7,6 s).
// A cada passo do simulador (1/240 s) de 5,8 a 7,6 s lê as posições dos vértices (transform feedback):
//   cabeça = vértice da malha mais perto do centro do sigilo;
//   pontas = vértices com ponta >= 0,9, peso de cabeça >= 0,9 e alfa da arte >= 0,25.
// Progresso p(t) = (x(t) - x(5,9)) / (x final - x(5,9)), x final = pose estática AnguloX 0,8.
// Atraso = t50 das pontas - t50 da cabeça; assentamento = último instante fora da faixa de 5% (e 2%, 1 px).
window.PROVA = async function (omni, P) {
  const E = P.ESTALO, HZ = 240;
  const rep = omni.tela(omni.estadoPose({}));
  const fim = omni.tela(omni.estadoPose({ AnguloX: E.alvo }));
  const nV = omni.malha.nVertices;
  let iSig = 0, dMin = 1e9;
  const pontas = [];
  for (let v = 0; v < nV; v++) {
    const x = rep[v * 6], y = rep[v * 6 + 1];
    const d = Math.hypot(x - 610.15, y - 574.04);
    if (d < dMin) { dMin = d; iSig = v; }
    if (rep[v * 6 + 3] >= 0.9 && rep[v * 6 + 4] >= 0.9 && rep[v * 6 + 5] >= 0.25) pontas.push(v);
  }
  if (!pontas.length) throw new Error('nenhuma ponta de cabelo passou nos filtros (ponta, peso da cabeça e alfa >= limites)');
  omni.cena(P.GIRO);
  const n0 = Math.round(5.8 * HZ), n1 = Math.round(E.ate * HZ);
  const ts = [], xSig = [], xPontas = [], porPonta = pontas.map(() => []);
  for (let n = n0; n <= n1; n++) {
    const t = n / HZ;
    const tf = omni.tela(omni.estado(t));
    ts.push(t);
    xSig.push(tf[iSig * 6]);
    let s = 0;
    pontas.forEach((v, k) => { s += tf[v * 6]; porPonta[k].push(tf[v * 6]); });
    xPontas.push(s / pontas.length);
  }
  const kE = Math.round((E.t - 5.8) * HZ);           // índice do estalo
  const xFimSig = fim[iSig * 6];
  let xFimP = 0; pontas.forEach((v) => { xFimP += fim[v * 6]; }); xFimP /= pontas.length;
  const progresso = (xs, x1) => { const x0 = xs[kE]; return xs.map((x) => (x - x0) / (x1 - x0)); };
  const t50 = (p) => {
    for (let k = kE + 1; k < p.length; k++) if (p[k] >= 0.5) { const f = (0.5 - p[k - 1]) / (p[k] - p[k - 1]); return ts[k - 1] + f / HZ - E.t; }
    return null;
  };
  const assenta = (p, faixa) => { let u = kE; for (let k = kE; k < p.length; k++) if (Math.abs(p[k] - 1) > faixa) u = k; return u + 1 < p.length ? ts[u + 1] - E.t : null; };
  const assentaPx = (xs, x1, px) => { let u = kE; for (let k = kE; k < xs.length; k++) if (Math.abs(xs[k] - x1) > px) u = k; return u + 1 < xs.length ? ts[u + 1] - E.t : null; };
  const pS = progresso(xSig, xFimSig), pP = progresso(xPontas, xFimP);
  const lags = porPonta.map((xs, k) => { const a = t50(progresso(xs, fim[pontas[k] * 6])); const b = t50(pS); return a == null || b == null ? null : a - b; }).filter((v) => v != null).sort((a, b) => a - b);
  const q = (p) => lags[Math.min(lags.length - 1, Math.floor(p * lags.length))];
  const ms = (s) => (s == null ? null : Math.round(s * 10000) / 10);
  const m = {
    estalo: E, passoHz: HZ, verticeCabeca: { indice: iSig, repouso: [rep[iSig * 6], rep[iSig * 6 + 1]] }, pontas: pontas.length,
    andaPx: { cabeca: +(xFimSig - xSig[kE]).toFixed(2), pontas: +(xFimP - xPontas[kE]).toFixed(2) },
    t50ms: { cabeca: ms(t50(pS)), pontas: ms(t50(pP)) },
    atrasoMs: ms(t50(pP) - t50(pS)),
    atrasoPorPontaMs: { p10: ms(q(0.1)), mediana: ms(q(0.5)), p90: ms(q(0.9)) },
    passaDoPonto: { cabeca: +(Math.max(...pS.slice(kE)) - 1).toFixed(4), pontas: +(Math.max(...pP.slice(kE)) - 1).toFixed(4) },
    assentaS: {
      pontas5pct: assenta(pP, 0.05), pontas2pct: assenta(pP, 0.02), pontas1px: assentaPx(xPontas, xFimP, 1),
      cabeca5pct: assenta(pS, 0.05), cabeca2pct: assenta(pS, 0.02),
    },
    curva: ts.filter((_, k) => k % 6 === 0).map((t, j) => [+t.toFixed(4), +pS[j * 6].toFixed(4), +pP[j * 6].toFixed(4)]),
    criterio: 'atraso das pontas do cabelo (t50 pontas - t50 cabeça) entre 100 e 250 ms e pontas assentadas (faixa de 5% do curso) em até 1,5 s após o estalo',
  };
  for (const k of Object.keys(m.assentaS)) m.assentaS[k] = m.assentaS[k] == null ? null : +m.assentaS[k].toFixed(4);
  m.passou = m.atrasoMs >= 100 && m.atrasoMs <= 250 && m.assentaS.pontas5pct != null && m.assentaS.pontas5pct <= 1.5;
  m.erroGL = omni.gl.getError();                      // 0 = nenhuma chamada recusada (captura válida)
  if (m.erroGL !== 0) m.passou = false;
  m.medidoEm = new Date().toISOString();
  P.salvaJSON('fisica.json', m);
  P.log('fisica', JSON.stringify({ atrasoMs: m.atrasoMs, porPonta: m.atrasoPorPontaMs, assentaS: m.assentaS, passaDoPonto: m.passaDoPonto, pontas: m.pontas, passou: m.passou }));
  return { passou: m.passou, atrasoMs: m.atrasoMs, assentaS: m.assentaS.pontas5pct };
};
