// nucleo/gl.js — WebGL2 cru, sem biblioteca: contexto, programas, texturas, alvos (FBO),
// malha em grade, transform feedback, leitura de pixels e cronômetro de GPU.
// Script clássico (não módulo): file:// barra import, então tudo pendura em window.OMNI.
(function () {
  'use strict';
  const OMNI = (window.OMNI = window.OMNI || {});

  // ---------- contexto ----------
  function contexto(canvas, opcoes) {
    const gl = canvas.getContext('webgl2', Object.assign({
      alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false,
      preserveDrawingBuffer: false, powerPreference: 'high-performance',
    }, opcoes || {}));
    if (!gl) throw new Error('WebGL2 indisponível neste navegador');
    // a arte entra como está: sem premultiplicar no upload e sem gestão de cor
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
    return gl;
  }

  function placa(gl) {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  }

  // ---------- programas ----------
  function compila(gl, tipo, fonte, nome) {
    const s = gl.createShader(tipo);
    gl.shaderSource(s, fonte);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(`shader ${nome} não compilou:\n${log}`);
    }
    return s;
  }

  // opcoes.tf: varyings capturados por transform feedback (intercalados)
  // opcoes.atributos: {nome: local} fixados antes do link
  function programa(gl, vert, frag, opcoes) {
    opcoes = opcoes || {};
    const p = gl.createProgram();
    gl.attachShader(p, compila(gl, gl.VERTEX_SHADER, vert, (opcoes.nome || '') + '.vert'));
    gl.attachShader(p, compila(gl, gl.FRAGMENT_SHADER, frag, (opcoes.nome || '') + '.frag'));
    for (const [n, l] of Object.entries(opcoes.atributos || {})) gl.bindAttribLocation(p, l, n);
    if (opcoes.tf) gl.transformFeedbackVaryings(p, opcoes.tf, gl.INTERLEAVED_ATTRIBS);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`programa ${opcoes.nome} não ligou:\n${gl.getProgramInfoLog(p)}`);
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name);
    }
    return {
      p, u,
      usa() { gl.useProgram(p); return this; },
      // define(nome, valor): número -> float; array 2/3/4 -> vecN; {i: n} -> int
      define(nome, v) {
        const l = u[nome];
        if (l == null) return this; // uniforme otimizado fora pelo compilador
        if (typeof v === 'number') gl.uniform1f(l, v);
        else if (v && v.i != null) gl.uniform1i(l, v.i);
        else if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
        else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
        else if (v.length === 4) gl.uniform4f(l, v[0], v[1], v[2], v[3]);
        else throw new Error('uniforme sem tipo: ' + nome);
        return this;
      },
    };
  }

  // ---------- texturas ----------
  // data URL -> ImageBitmap sem premultiplicar e sem converter cor (bytes exatos do PNG)
  async function bitmapDeDataURL(url) {
    const b64 = url.slice(url.indexOf(',') + 1);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return createImageBitmap(new Blob([bytes], { type: 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  }

  function aplicaFiltro(gl, filtro, mip) {
    const f = filtro === 'linear' ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  function textura(gl, fonte, opcoes) {
    opcoes = opcoes || {};
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, fonte);
    aplicaFiltro(gl, opcoes.filtro || 'nearest', false);
    return { t, w: fonte.width, h: fonte.height };
  }

  // ---------- alvos de render ----------
  // FBO RGBA8. opcoes.niveis > 1 reserva a pirâmide de mipmaps (texStorage imutável).
  function alvo(gl, w, h, opcoes) {
    opcoes = opcoes || {};
    const niveis = opcoes.niveis || 1;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, niveis, gl.RGBA8, w, h);
    aplicaFiltro(gl, opcoes.filtro || 'nearest', false);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('FBO incompleto: 0x' + st.toString(16));
    return { fb, t, w, h, niveis };
  }

  // passe de tela cheia (triângulo único gerado por gl_VertexID, sem buffer)
  const VERT_TELA = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
  function passeTela(gl, frag, nome) {
    const prog = programa(gl, VERT_TELA, frag, { nome });
    const vao = gl.createVertexArray();
    return {
      prog,
      desenha(fb, w, h) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.viewport(0, 0, w, h);
        gl.disable(gl.BLEND);
        gl.bindVertexArray(vao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);
      },
    };
  }

  // ---------- malha ----------
  // posicoes: Float32Array [x,y,...] em px; indices: Uint32Array de triângulos.
  function malha(gl, posicoes, indices) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, posicoes, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);
    return {
      vao, vb, ib, nVertices: posicoes.length / 2, nIndices: indices.length,
      reordena(novos) { // nova ordem de desenho (mesmo tamanho)
        gl.bindVertexArray(vao);
        gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, novos);
        gl.bindVertexArray(null);
      },
      desenha() {
        gl.bindVertexArray(vao);
        gl.drawElements(gl.TRIANGLES, this.nIndices, gl.UNSIGNED_INT, 0);
        gl.bindVertexArray(null);
      },
    };
  }

  // ---------- transform feedback ----------
  // Roda o vertex shader sobre todos os vértices (pontos, rasterização desligada) e devolve
  // os varyings capturados. É a mesma conta que desenha a tela, então as provas medem o que se vê.
  function capturador(gl, nVertices, floatsPorVertice) {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, buf);
    gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, nVertices * floatsPorVertice * 4, gl.STREAM_READ);
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null);
    const tf = gl.createTransformFeedback();
    return {
      captura(m, saida) {
        saida = saida || new Float32Array(nVertices * floatsPorVertice);
        gl.enable(gl.RASTERIZER_DISCARD);
        gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf);
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, buf);
        gl.beginTransformFeedback(gl.POINTS);
        gl.bindVertexArray(m.vao);
        gl.drawArrays(gl.POINTS, 0, nVertices);
        gl.bindVertexArray(null);
        gl.endTransformFeedback();
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
        gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
        gl.disable(gl.RASTERIZER_DISCARD);
        gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, buf);
        gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, saida);
        gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null);
        return saida;
      },
    };
  }

  // ---------- leitura ----------
  function ler(gl, fb, x, y, w, h, saida) {
    saida = saida || new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, saida);
    return saida; // linha 0 = de baixo (ordem do GL)
  }

  // ---------- cronômetro de GPU (EXT_disjoint_timer_query_webgl2) ----------
  function cronometro(gl) {
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) return null;
    const pendentes = [];
    return {
      ext,
      mede(fn) { // enfileira uma medida de tempo de GPU em torno de fn()
        const q = gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
        fn();
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        pendentes.push(q);
      },
      // devolve os ms já disponíveis, na ordem; null marca medida perdida por disjunção
      colhe() {
        const prontos = [];
        const disjunto = gl.getParameter(ext.GPU_DISJOINT_EXT);
        while (pendentes.length && gl.getQueryParameter(pendentes[0], gl.QUERY_RESULT_AVAILABLE)) {
          const q = pendentes.shift();
          const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
          gl.deleteQuery(q);
          prontos.push(disjunto ? null : ns / 1e6);
        }
        return prontos;
      },
      get pendentes() { return pendentes.length; },
    };
  }

  OMNI.gl = { contexto, placa, programa, bitmapDeDataURL, textura, alvo, passeTela, malha, capturador, ler, cronometro, aplicaFiltro };
})();
