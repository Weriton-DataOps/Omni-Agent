// omni.js — o motor: carrega o modelo assado, monta a malha e desenha.
// render(t) é puro: o mesmo t (e a mesma cena) dá o mesmo quadro, porque o estado vem do simulador
// de passo fixo re-simulado desde o começo da cena, nunca do relógio de parede.
//
//   const omni = await OMNI.criar({ canvas });
//   omni.cena({ duracao: 10, laco: true, idle: { periodo: 10 } });
//   omni.render(2.5);                 // um instante exato
//   omni.renderPose({ AnguloX: 1 });  // pose estática, sem molas
//   omni.rodar();                     // vivo, pelo relógio de parede
(function () {
  'use strict';
  const OMNI = (window.OMNI = window.OMNI || {});

  // Grade NxN cobrindo a arte; vértices de dentro nos centros de texel (k*W/(N-1) arredondado + 0,5),
  // os da borda em 0 e W para a malha cobrir todo pixel.
  function grade(W, H, nx, ny) {
    const xs = [], ys = [];
    for (let k = 0; k < nx; k++) xs.push(k === 0 ? 0 : k === nx - 1 ? W : Math.floor(k * W / (nx - 1)) + 0.5);
    for (let k = 0; k < ny; k++) ys.push(k === 0 ? 0 : k === ny - 1 ? H : Math.floor(k * H / (ny - 1)) + 0.5);
    const pos = new Float32Array(nx * ny * 2);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { pos[(j * nx + i) * 2] = xs[i]; pos[(j * nx + i) * 2 + 1] = ys[j]; }
    const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
    let o = 0;
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx.set([a, b, c, b, d, c], o); o += 6;
    }
    return { nx, ny, xs, ys, pos, idx };
  }

  async function criar(opcoes) {
    opcoes = opcoes || {};
    const modelo = JSON.parse(JSON.stringify(opcoes.modelo || window.OMNI_MODELO));
    const pacote = opcoes.texturas || window.OMNI_TEXTURAS;
    const S = OMNI.shaders;
    const G = OMNI.gl;
    const [W, H] = modelo.tamanho;
    const gl = opcoes.gl || G.contexto(opcoes.canvas, opcoes.contexto);

    // ---------- texturas ----------
    const bm = {};
    for (const nome of ['base', 'campos', 'pesos', 'regioes']) bm[nome] = await G.bitmapDeDataURL(pacote[nome]);
    const fonte = G.textura(gl, bm.base, { filtro: 'nearest' });
    const niveis = Math.floor(Math.log2(Math.max(W, H))) + 1;
    const base = G.alvo(gl, W, H, { niveis, filtro: 'linear' });
    const premult = G.passeTela(gl, S.premultiplica, 'premultiplica');
    premult.prog.usa();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fonte.t);
    premult.prog.define('u_fonte', { i: 0 });
    premult.desenha(base.fb, W, H);
    gl.bindTexture(gl.TEXTURE_2D, base.t);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    let mipLigado = false;
    const campos = G.textura(gl, bm.campos, { filtro: 'nearest' });
    const pesos = G.textura(gl, bm.pesos, { filtro: 'nearest' });
    const regioes = G.textura(gl, bm.regioes, { filtro: 'linear' });
    gl.deleteTexture(fonte.t);

    // ---------- malha e programa ----------
    const [nx, ny] = modelo.malhas[0].grade;
    const gr = grade(W, H, nx, ny);
    const prog = G.programa(gl, S.plateVert, S.plateFrag, { nome: 'plate', atributos: { a_pos: 0 }, tf: ['v_tela', 'v_info'] });
    const m = G.malha(gl, gr.pos, gr.idx);
    const tf = G.capturador(gl, m.nVertices, 6);
    const P = modelo.profundidade, RS = modelo.rig.respira;

    function uniformes(e) {
      prog.usa();
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, base.t);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, campos.t);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, pesos.t);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, regioes.t);
      gl.activeTexture(gl.TEXTURE0);
      prog.define('u_base', { i: 0 }).define('u_campos', { i: 1 }).define('u_pesos', { i: 2 }).define('u_regioes', { i: 3 });
      prog.define('u_tamanho', [W, H]).define('u_pivo', modelo.geometria.pivo).define('u_prof', [P.zmin, P.escala]);
      prog.define('u_cabeca', e.cabeca).define('u_cabelo', e.cabelo).define('u_pescoco', e.pescoco).define('u_ombros', e.ombros);
      prog.define('u_respira', e.respira).define('u_respAmp', [RS.ombros, RS.gola, RS.cabeca]);
    }

    // por vértice, pela mesma conta do desenho: x, y na tela (px da arte), z girado, ponta, peso da cabeça, alfa
    function tela(e, saida) {
      // sem framebuffer preso: se o FBO da base premultiplicada estiver ligado, amostrar u_base vira laço
      // de realimentação e o WebGL recusa o drawArrays (INVALID_OPERATION, captura em zeros)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      uniformes(e);
      prog.define('u_saida', [2 / W, -2 / H, -1, 1]).define('u_vista', { i: 0 });
      return tf.captura(m, saida);
    }

    // ordem do pintor: triângulos do fundo (z menor em repouso) primeiro; em pose neutra nada se sobrepõe.
    // A cabeça de frente (peso de cabeça 1 e z > 0: rosto e orelhas) vai por último: no giro o queixo
    // escorrega por cima do pescoço, e o pescoço (z até 70) não pode cobri-lo.
    const zRep = tela(OMNI.rig.estadoPose(modelo, {}));
    const nTri = gr.idx.length / 3;
    const zTri = new Float32Array(nTri), ordem = new Uint32Array(nTri);
    for (let k = 0; k < nTri; k++) {
      ordem[k] = k;
      let z = 0, frente = true;
      for (let v = 0; v < 3; v++) {
        const i = gr.idx[k * 3 + v] * 6;
        z += zRep[i + 2] / 3;
        if (!(zRep[i + 4] > 0.99 && zRep[i + 2] > 0)) frente = false;
      }
      zTri[k] = z + (frente ? 1000 : 0);
    }
    ordem.sort((a, b) => (zTri[a] - zTri[b]) || (a - b));
    const idxOrdenado = new Uint32Array(gr.idx.length);
    for (let k = 0; k < nTri; k++) idxOrdenado.set(gr.idx.subarray(ordem[k] * 3, ordem[k] * 3 + 3), k * 3);
    m.reordena(idxOrdenado);

    // ---------- desenho ----------
    // op: fb (null = canvas), largura/altura do alvo, viewport [x,y,w,h], recorte [x0,y0,w,h] em px da arte,
    //     fundo [r,g,b,a] premultiplicado (0..1), vista 0..3, limpar (padrão true)
    function desenha(e, op) {
      op = op || {};
      const lw = op.largura || (op.fb ? W : gl.drawingBufferWidth), lh = op.altura || (op.fb ? H : gl.drawingBufferHeight);
      const vp = op.viewport || [0, 0, lw, lh];
      const rc = op.recorte || [0, 0, W, H];
      const vista = op.vista || 0;
      gl.bindFramebuffer(gl.FRAMEBUFFER, op.fb || null);
      gl.viewport(vp[0], vp[1], vp[2], vp[3]);
      if (op.limpar !== false) {
        const f = op.fundo || [0, 0, 0, 0];
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(vp[0], vp[1], vp[2], vp[3]);
        gl.clearColor(f[0], f[1], f[2], f[3]);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.disable(gl.SCISSOR_TEST);
      }
      // minificação pede mipmap; em escala 1 só o nível 0, senão a pose neutra perde o byte exato
      const querMip = vp[2] / rc[2] < 0.99;
      if (querMip !== mipLigado) {
        gl.bindTexture(gl.TEXTURE_2D, base.t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, querMip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
        mipLigado = querMip;
      }
      uniformes(e);
      prog.define('u_saida', [2 / rc[2], -2 / rc[3], -1 - 2 * rc[0] / rc[2], 1 + 2 * rc[1] / rc[3]]);
      prog.define('u_vista', { i: vista });
      if (vista === 0) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); } else gl.disable(gl.BLEND);
      m.desenha();
      gl.disable(gl.BLEND);
    }

    // ---------- cena ----------
    const tab = OMNI.rig.parametros(modelo);
    let cenaAtual = null, sim = null;
    function cena(def) {
      def = Object.assign({ duracao: 0, laco: false, idle: false, respira: false }, def || {});
      const T = def.duracao;
      const tr = typeof def.trilha === 'function' ? def.trilha : def.trilha ? OMNI.rig.trilha(def.trilha) : () => ({});
      const id = def.idle ? OMNI.rig.idle(modelo, Object.assign({ periodo: def.laco ? T : 120 }, def.idle === true ? {} : def.idle)) : null;
      const ciclo = def.laco && T > 0 ? T / Math.max(1, Math.round(T / RS.ciclo)) : RS.ciclo;
      const resp = def.respira && !id ? (t) => ({ Respira: 0.5 - 0.5 * Math.cos(2 * Math.PI * t / ciclo) }) : null;
      const fonte = (t) => {
        const tl = def.laco && T > 0 ? ((t % T) + T) % T : t;
        return tab.alvo([tr(tl), id ? id.em(t) : null, resp ? resp(t) : null]);
      };
      const n0 = def.laco && T > 0 ? -2 * OMNI.relogio.passo(T) : 0;
      sim = OMNI.rig.simulador(modelo, fonte, n0);
      cenaAtual = Object.assign({}, def, { idleInfo: id, cicloRespira: id ? id.cicloRespira : ciclo, n0 });
      return cenaAtual;
    }
    cena({});

    // ---------- vivo ----------
    let rodando = null;
    function rodar(op) {
      parar();
      const parede = OMNI.relogio.parede();
      const quadro = () => {
        const t = parede.agora();
        desenha(sim.em(t), op);
        if (op && op.aoQuadro) op.aoQuadro(t);
        rodando = requestAnimationFrame(quadro);
      };
      rodando = requestAnimationFrame(quadro);
    }
    function parar() { if (rodando != null) cancelAnimationFrame(rodando); rodando = null; }

    return {
      gl, modelo, W, H, malha: { grade: gr, nVertices: m.nVertices, nTriangulos: nTri, idxOrdenado },
      alvo: (w, h, o) => G.alvo(gl, w || W, h || H, o),
      ler: (fb, w, h, buf) => G.ler(gl, fb, 0, 0, w || W, h || H, buf),
      cronometro: () => G.cronometro(gl),
      placa: () => G.placa(gl),
      cena, get cenaAtual() { return cenaAtual; },
      definir: (id, v) => tab.definir(id, v),
      estado: (t) => sim.em(t),
      estadoPose: (v) => OMNI.rig.estadoPose(modelo, v || {}),
      render: (t, op) => desenha(sim.em(t), op),
      renderPose: (v, op) => desenha(OMNI.rig.estadoPose(modelo, v || {}), op),
      desenha, tela, rodar, parar,
    };
  }

  OMNI.criar = criar;
  OMNI.grade = grade;
})();
