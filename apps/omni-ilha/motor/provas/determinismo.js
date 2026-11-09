// provas/determinismo.js — (f) duas gravações idênticas byte a byte e o laço fecha sem salto.
// Grava a cena do giro (8 s, 30 fps, 240 quadros, resolução cheia, fundo escuro) duas vezes seguidas,
// cada uma do zero (cena nova, simulador reiniciado). Compara o sha256 de cada quadro RGBA lido da GPU
// e o sha256 dos dois mp4 (x264 com 1 thread e bitexact: o codificador também precisa ser determinístico).
// Guarda os hashes em determinismo-anterior.json (pasta crua) e compara com a execução anterior, se houver:
// é o teste entre processos diferentes, não só dentro da mesma página.
// Laço: render(0) contra render(8) (o quadro que viria depois do último) e o salto 239 -> 0 contra
// os saltos entre quadros vizinhos do resto do vídeo; e o estado do rig em t = 0 contra t = 8.
window.PROVA = async function (omni, P) {
  const { W, H } = omni;
  const alvo = omni.alvo(W, H);
  const op = { fb: alvo.fb, fundo: P.FUNDO };
  const N = 240, FPS = 30;
  const dif = (a, b) => { let mx = 0, s = 0, n = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d) { n++; s += d; if (d > mx) mx = d; } } return { max: mx, media: s / a.length, diferentes: n }; };

  async function grava(nome) {
    omni.cena(P.GIRO);
    const arq = P.path.join(P.CRU, `determinismo-${nome}.mp4`);
    const v = P.video(arq, W, H, FPS, { codec: 'x264' });
    const hashes = [], saltos = [];
    let ant = null, q0 = null, qUlt = null;
    for (let q = 0; q < N; q++) {
      omni.render(q / FPS, op);
      const buf = omni.ler(alvo.fb);
      hashes.push(P.hash(buf));
      if (ant) saltos.push(dif(ant, buf).media);
      if (q === 0) q0 = buf.slice();
      if (q === N - 1) qUlt = buf.slice();
      ant = buf;
      await v.quadro(buf);
    }
    await v.fim();
    return { arq, hashes, saltos, q0, qUlt, mp4: P.hashArquivo(arq) };
  }

  const a = await grava('a');
  const b = await grava('b');
  let quadrosIguais = 0;
  for (let q = 0; q < N; q++) if (a.hashes[q] === b.hashes[q]) quadrosIguais++;

  // laço: o quadro em t = 8 s (que seria o 240) deve ser o quadro 0
  omni.cena(P.GIRO);
  omni.render(8, op);
  const q240 = omni.ler(alvo.fb).slice();
  const fecha = dif(a.q0, q240);
  const salto = dif(a.qUlt, a.q0).media;
  const ord = a.saltos.slice().sort((x, y) => x - y);
  const med = ord[Math.floor(ord.length / 2)], p95 = ord[Math.floor(ord.length * 0.95)], mx = ord[ord.length - 1];

  const e0 = omni.estado(0), e8 = omni.estado(8);
  let estadoDifMax = 0;
  for (const k of ['cabeca', 'pescoco', 'ombros', 'cabelo', 'respira']) for (let i = 0; i < e0[k].length; i++) estadoDifMax = Math.max(estadoDifMax, Math.abs(e0[k][i] - e8[k][i]));

  // o laço do idle (prova-idle.mp4, 10 s) também fecha: t = 10 s igual a t = 0
  omni.cena({ duracao: 10, laco: true, idle: { periodo: 10 } });
  omni.render(0, op);
  const i0 = omni.ler(alvo.fb).slice();
  omni.render(10, op);
  const fechaIdle = dif(i0, omni.ler(alvo.fb));

  // entre processos: compara com a execução anterior
  const fAnt = P.path.join(P.CRU, 'determinismo-anterior.json');
  let anterior = null;
  if (P.fs.existsSync(fAnt)) {
    const x = JSON.parse(P.fs.readFileSync(fAnt, 'utf-8'));
    let iguais = 0;
    for (let q = 0; q < N; q++) if (x.hashes[q] === a.hashes[q]) iguais++;
    anterior = { gravadoEm: x.gravadoEm, quadrosIguais: iguais, mp4Igual: x.mp4 === a.mp4 };
  }
  P.fs.writeFileSync(fAnt, JSON.stringify({ gravadoEm: new Date().toISOString(), hashes: a.hashes, mp4: a.mp4 }));

  const m = {
    criterio: 'duas gravações da cena do giro idênticas byte a byte (quadros RGBA e mp4) e laço fechado: quadro em t = 8 s igual ao quadro 0',
    cena: { duracaoS: 8, fps: FPS, quadros: N, resolucao: [W, H], codificador: 'libx264 crf 16, 1 thread, bitexact' },
    gravacoes: {
      quadrosIguais, de: N,
      mp4: { a: a.mp4, b: b.mp4, iguais: a.mp4 === b.mp4 },
      primeiroQuadro: a.hashes[0], ultimoQuadro: a.hashes[N - 1],
    },
    execucaoAnterior: anterior,
    laco: {
      quadro240VsQuadro0: { difMax: fecha.max, difMedia: +fecha.media.toFixed(6), pixelsDiferentes: fecha.diferentes, iguais: fecha.max === 0 },
      estadoRigDifMax_t0_t8: estadoDifMax,
      saltoUltimoParaPrimeiro: +salto.toFixed(4),
      saltoEntreVizinhos: { mediana: +med.toFixed(4), p95: +p95.toFixed(4), max: +mx.toFixed(4) },
      idle10sVsQuadro0: { difMax: fechaIdle.max, pixelsDiferentes: fechaIdle.diferentes, iguais: fechaIdle.max === 0 },
    },
  };
  m.passou = quadrosIguais === N && m.gravacoes.mp4.iguais && fecha.max === 0 && fechaIdle.max === 0 && (anterior == null || (anterior.quadrosIguais === N && anterior.mp4Igual)) && salto <= mx;
  m.medidoEm = new Date().toISOString();
  P.salvaJSON('determinismo.json', m);
  P.log('determinismo', JSON.stringify({ gravacoes: m.gravacoes, anterior, laco: m.laco, passou: m.passou }));
  return { passou: m.passou, quadrosIguais, mp4Iguais: m.gravacoes.mp4.iguais, lacoFecha: fecha.max === 0, anterior };
};
