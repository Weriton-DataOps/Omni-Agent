// provas/desempenho.js — (e) <= 3 ms por quadro a 512x512 na GTX 1650.
// Cena do giro (laço de 8 s) desenhada num alvo 512x512 (mipmap ligado: é minificação de 1254 para 512).
// Tempo de GPU por timer query (EXT_disjoint_timer_query_webgl2) em volta do desenho de cada quadro;
// 30 quadros de aquecimento e 300 medidos. Vai junto o tempo de CPU do quadro (simulação + envio dos comandos)
// e, só como referência, a mesma medida na resolução cheia da arte.
window.PROVA = async function (omni, P) {
  const gl = omni.gl;
  const cr = omni.cronometro();
  if (!cr) throw new Error('sem EXT_disjoint_timer_query_webgl2: não dá para medir GPU');
  omni.cena(P.GIRO);
  const estat = (v) => {
    const s = v.slice().sort((a, b) => a - b);
    const m = s.reduce((a, b) => a + b, 0) / s.length;
    const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    return { n: s.length, media: +m.toFixed(4), mediana: +q(0.5).toFixed(4), p95: +q(0.95).toFixed(4), max: +s[s.length - 1].toFixed(4), min: +s[0].toFixed(4) };
  };
  async function mede(lado, aquece, quadros) {
    const alvo = omni.alvo(lado, lado);
    const op = { fb: alvo.fb, largura: lado, altura: lado, fundo: P.FUNDO };
    const gpu = [], cpu = [];
    let perdidos = 0;
    for (let q = 0; q < aquece + quadros; q++) {
      const t = q / 30;
      const t0 = performance.now();
      const e = omni.estado(t);                      // simulação até t (passo fixo, 240 Hz)
      if (q < aquece) omni.desenha(e, op);
      else cr.mede(() => omni.desenha(e, op));
      cpu.push(performance.now() - t0);
      gl.flush();
      if (q % 10 === 9) await P.espera(0);           // deixa as queries ficarem prontas sem travar a fila
      for (const ms of cr.colhe()) { if (ms == null) perdidos++; else gpu.push(ms); }
    }
    for (let k = 0; k < 400 && cr.pendentes; k++) {
      await P.espera(5);
      for (const ms of cr.colhe()) { if (ms == null) perdidos++; else gpu.push(ms); }
    }
    return { lado, quadrosMedidos: gpu.length, perdidosPorDisjuncao: perdidos, gpuMs: estat(gpu), cpuMs: estat(cpu.slice(aquece)) };
  }
  // teto pela parede: cada quadro termina com a leitura de 1 px (força a GPU a acabar o quadro);
  // inclui simulação, envio, espera da fila e a volta da leitura: é limite superior, não o custo da GPU
  function parede(lado, aquece, quadros) {
    const alvo = omni.alvo(lado, lado);
    const op = { fb: alvo.fb, largura: lado, altura: lado, fundo: P.FUNDO };
    const px = new Uint8Array(4), ms = [];
    for (let q = 0; q < aquece + quadros; q++) {
      const t0 = performance.now();
      omni.desenha(omni.estado(q / 30), op);
      gl.bindFramebuffer(gl.FRAMEBUFFER, alvo.fb);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (q >= aquece) ms.push(performance.now() - t0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return estat(ms);
  }
  const r512Frio = await mede(512, 30, 300);         // primeira passada: GPU ainda subindo o clock
  const rCheia = await mede(omni.W, 30, 300);
  const r512 = await mede(512, 30, 300);            // a medida do critério: GPU já aquecida
  r512.primeiraPassadaFria = { gpuMs: r512Frio.gpuMs };
  omni.cena(P.GIRO);
  const parede512 = parede(512, 30, 300);
  r512.paredeComSincroniaMs = parede512;
  const placa = omni.placa();
  const m = {
    placa, gtx1650: /GTX 1650/.test(placa),
    criterio: 'média do tempo de GPU (timer query) de 300 quadros da cena do giro a 512x512 <= 3 ms, na GTX 1650',
    malha: { vertices: omni.malha.nVertices, triangulos: omni.malha.nTriangulos },
    a512: r512, resolucaoCheia: rCheia,
    passou: /GTX 1650/.test(placa) && r512.quadrosMedidos >= 300 && r512.gpuMs.media <= 3,
    medidoEm: new Date().toISOString(),
  };
  P.salvaJSON('desempenho.json', m);
  P.log('desempenho', JSON.stringify({ placa, gpu512: r512.gpuMs, cpu512: r512.cpuMs, parede512, gpuCheia: rCheia.gpuMs, passou: m.passou }));
  return { passou: m.passou, gpuMediaMs512: r512.gpuMs.media, gpuP95Ms512: r512.gpuMs.p95 };
};
