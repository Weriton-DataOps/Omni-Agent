import { routeContext } from './audioSettings'

/**
 * COPIADO de `src/renderer/src/omni/materia.ts` do OverCore Studio, sem
 * alteração de comportamento — é a peça visual do Realtime que o dono aprovou
 * no croqui `croquis/realtime-shaders-v1.html`, entre cinco.
 *
 * ═══ Por que CÓPIA aqui, e empréstimo em outros lugares ═══
 *
 * Isto não é regra pura nem runtime compartilhado: é a APARÊNCIA deste
 * aplicativo. A aparência do Omni pessoal vai divergir da do Studio — é
 * literalmente o motivo desta separação existir. Emprestar por alias amarraria
 * as duas telas a mudar juntas, que é o oposto do pedido.
 *
 * O que veio junto e continua valendo: os dois tempos (semente girando enquanto
 * a sessão não abre, crescimento até a forma cheia quando o canal abre), o som
 * da abertura sincronizado com a mesma curva, e os limites medidos no croqui
 * (abaixo de ~0.16 de raio a casca some do canvas).
 *
 * Origem registrada em `docs/levantamento.md`.
 */
/**
 * A MATÉRIA — a casca de arame que responde à voz do Omni.
 *
 * Saiu do croqui `croquis/realtime-shaders-v1.html`, onde ele escolheu entre
 * cinco. É a `IcosahedronGeometry` do print dele: icosaedro de 20 faces
 * subdividido, normalizado para a esfera, desenhado em ARESTAS e deslocado por
 * ruído simplex no vértice. Malha triangular uniforme — sem os polos apertados
 * de uma esfera de paralelos e meridianos, que foi a primeira tentativa e ele
 * recusou pelo print.
 *
 * O que ele pediu para a tela do Realtime, na letra:
 *
 *   "a versão singular dela fica girando até liberar a fala, quando liberar
 *    ela já cresce pra mostrar que liberou e eu já consigo falar"
 *
 * Então há dois tempos. Enquanto a sessão não abriu, a peça é uma SEMENTE —
 * uma casca pequena e fechada, girando mais rápido, que é o gesto de espera.
 * No instante em que o canal abre, ela CRESCE até o tamanho cheio e o giro
 * assenta no lento. O crescimento é o aviso: quando ela para de crescer, ele
 * pode falar. Nenhum texto precisa dizer isso.
 *
 * Sem three.js: a projeção e as rotações são escritas à mão, como no croqui.
 */



/** Icosaedro subdividido `subdiv` vezes, em ARESTAS (pares de vértices). */
function icosaedro(subdiv: number): Float32Array {
  const t = (1 + Math.sqrt(5)) / 2
  const v: number[][] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]
  ].map((p) => {
    const n = Math.hypot(p[0], p[1], p[2])
    return [p[0] / n, p[1] / n, p[2] / n]
  })
  let f: number[][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
  ]

  /*
   * ═══ A CASCA SE TECE — pedido dele, 16/ago ═══
   *
   *   "a fase singular deve ter menos ligações; ao crescer ela aumenta as
   *    ligações até virar o que é... por hoje ela é menor mas com muitos
   *    pontos ligados. quando crescer ele aumenta até ficar com várias"
   *
   * A primeira tentativa sorteava arestas soltas para esconder — e virou
   * CONFETE: riscos sem ponta em comum, porque tirar arestas ao acaso destrói
   * justamente o que faz uma teia ser teia, os pontos compartilhados.
   *
   * O certo estava na própria geometria. Um icosaedro subdividido não é um
   * bloco só: é uma sequência de poliedros, cada um o refinamento do anterior.
   * Então guardo as arestas de TODOS os níveis — 20 faces, depois 80, 320,
   * 1280, 5120 — e o crescimento simplesmente ANDA por eles. A semente é o
   * icosaedro cru: 30 arestas, poucas e francamente ligadas. No fim é a malha
   * que ele aprovou. No meio, cada nível se dissolve no seguinte.
   */
  const saida: number[] = []
  const guardar = (verts: number[][], faces: number[][], nivel: number): void => {
    const vistas = new Set<string>()
    for (const [a, b, c] of faces) {
      for (const [x, y] of [[a, b], [b, c], [c, a]]) {
        const k = x < y ? `${x}_${y}` : `${y}_${x}`
        if (vistas.has(k)) continue
        vistas.add(k)
        // 4 flutuantes por vértice: posição + o nível da aresta (igual nas duas
        // pontas, senão meia linha apareceria antes da outra metade)
        out(verts[x], nivel)
        out(verts[y], nivel)
      }
    }
  }
  const out = (p: number[], nivel: number): void => {
    saida.push(p[0], p[1], p[2], nivel)
  }
  guardar(v, f, 0)

  for (let s = 0; s < subdiv; s++) {
    const meio = new Map<string, number>()
    const novo: number[][] = []
    const acha = (a: number, b: number): number => {
      const k = a < b ? `${a}_${b}` : `${b}_${a}`
      const ja = meio.get(k)
      if (ja !== undefined) return ja
      const p = [(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2]
      const n = Math.hypot(p[0], p[1], p[2])
      v.push([p[0] / n, p[1] / n, p[2] / n])
      meio.set(k, v.length - 1)
      return v.length - 1
    }
    for (const [a, b, c] of f) {
      const ab = acha(a, b)
      const bc = acha(b, c)
      const ca = acha(c, a)
      novo.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca])
    }
    f = novo
    guardar(v, f, s + 1)
  }
  return new Float32Array(saida)
}

/* O snoise que ele mandou, inteiro, no vertex shader — como no original. */
const SUBDIV = 4
const VS = `precision highp float;
#define NIVEIS ${SUBDIV}.0
attribute vec3 pos;
attribute float ordem;
uniform mat4 u_mvp;
uniform float u_time;
uniform float u_amp;
uniform float u_pulso;
uniform float u_nasce;
varying float v_rel;
varying float v_vivo;
varying vec3 v_pos;
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m*m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
void main(){
  /* o deslocamento do original; a VOZ aumenta a amplitude — a massa incha. */
  float d = snoise(pos*2.0 + u_time*0.5) * (0.2 + u_amp*0.5);
  /* o TREMOR: ruído de alta frequência pesado pelo PULSO (o ataque da sílaba),
     não pelo volume — a casca estremece na batida e assenta entre as palavras.
     Frequência espacial alta (7.0) para virar arrepio miúdo, não uma segunda
     deformação grande. */
  float tremor = u_pulso * snoise(pos*7.0 + u_time*9.0) * 0.16;
  /* O NASCIMENTO: a semente é uma casca fechada a 22% do raio; ao liberar,
     cresce até o tamanho cheio e o relevo entra junto.
     MEDIDO no croqui: abaixo de ~0.16 a casca some — as arestas viram
     sub-pixel e o canvas fica literalmente preto (0,0% de pixel aceso). Ela
     ainda precisa ser lida como um CORPO QUE GIRA, não como um grão, então
     fica acima desse limite.
     Ele viu na tela e pediu "um pouco menor": 0.30 -> 0.22, que é a metade do
     caminho até o limite do sumiço, e não o encosto nele. */
  float cresc = mix(0.22, 1.0, u_nasce);
  vec3 np = pos * 1.2 * cresc + pos * (d + tremor) * u_nasce;
  /* AS LIGAÇÕES CHEGAM AOS POUCOS — andando pelos níveis de subdivisão.
     A janela é triangular: o nível N acende no seu instante e se apaga quando
     o N+1 chega inteiro. Em u_nasce=0 vive só o nível 0 (o icosaedro cru, 30
     arestas); em 1, só o nível mais fino, que é a malha aprovada. */
  float passo = u_nasce * NIVEIS;
  v_vivo = 1.0 - clamp(abs(passo - ordem), 0.0, 1.0);
  v_rel = d;
  v_pos = np;
  gl_Position = u_mvp * vec4(np, 1.0);
}`

const FS = `precision highp float;
varying float v_rel;
varying float v_vivo;
varying vec3 v_pos;
uniform float u_amp;
uniform float u_nasce;
void main(){
  /* fresnel pela profundidade: o que está de frente some, a borda acende — é
     o que dá o volume do print sem luz nenhuma na cena. */
  float prof = clamp((v_pos.z + 1.6) / 3.2, 0.0, 1.0);
  float borda = pow(1.0 - abs(v_pos.z) / 1.7, 2.0);
  vec3 frio = vec3(0.37, 0.55, 0.86);
  vec3 quente = vec3(0.85, 0.65, 0.40);
  vec3 cor = mix(frio, quente, clamp(v_rel*2.2 + u_amp*0.6, 0.0, 1.0));
  float a = (0.12 + prof*0.55 + borda*0.35) * (0.75 + u_amp*0.6);
  /* a semente é mais densa: menos arestas ocupando menos pixels ficariam
     apagadas, e é justo nela que ele precisa ver que a coisa está viva. */
  /* v_vivo apaga a aresta que ainda não chegou. Zera o RGB, não o alfa: a
     mistura é aditiva (SRC_ALPHA, ONE) e o brilho mora na cor. */
  gl_FragColor = vec4(cor * a * (1.0 + (1.0 - u_nasce) * 0.9) * v_vivo, 1.0);
}`

/**
 * MVP à mão: perspectiva × translação × duas rotações.
 * `giro` multiplica a velocidade — a semente gira mais rápido (espera), a
 * forma cheia assenta no lento que ele aprovou.
 */
function mvp(aspect: number, t: number, giro: number): Float32Array {
  const f = 1 / Math.tan(0.9 / 2)
  const znear = 0.1
  const zfar = 100
  const ry = t * 0.09 * giro
  const rx = t * 0.035 * giro
  const cy = Math.cos(ry)
  const sy = Math.sin(ry)
  const cx = Math.cos(rx)
  const sx = Math.sin(rx)
  return new Float32Array([
    (f / aspect) * cy, f * sy * sx, -sy * cx, -sy * cx,
    0, f * cx, sx, sx,
    (f / aspect) * sy, -f * cy * sx, cy * cx, cy * cx,
    0, 0, (-3 * (zfar + znear)) / (zfar - znear) - (2 * zfar * znear) / (zfar - znear), 3
  ])
}

/** Quanto dura o nascimento. O som usa o MESMO número — daí a trilha casar. */
const CRESCIMENTO_MS = 1700

/**
 * O SOM DA ABERTURA — "Subdivisão", o que ele escolheu entre quatro
 * (croquis/abertura-materia-som-v1.html).
 *
 * A ideia é que o som faça o que a malha faz. Ele começa em UMA nota — o
 * poliedro cru, as trinta arestas da semente — e a cada nível de subdivisão
 * entra um harmônico novo, no MESMO instante em que aquelas arestas aparecem
 * na tela. Termina num acorde largo, que é a malha inteira.
 *
 * Os instantes não são escolhidos a ouvido: saem da própria curva do desenho.
 * O crescimento é 1-(1-p)^3, então o nível N aparece quando essa curva vale
 * N/4 — invertendo, p = 1 - (1 - N/4)^(1/3). É por isso que os harmônicos
 * chegam apertados no começo e o último demora: é exatamente o ritmo com que
 * a casca se tece. Se alguém mudar a curva do desenho, tem de mudar aqui, e
 * está no mesmo arquivo de propósito.
 *
 * O som ACABA quando ela para de crescer. O fim é o aviso de que pode falar —
 * no lugar de um rótulo dizendo isso.
 */
function somDaAbertura(): (() => void) {
  let ac: AudioContext
  try {
    ac = new AudioContext()
  } catch {
    return () => {} // sem áudio, a abertura continua muda; nada quebra
  }
  /*
   * A SAÍDA ESCOLHIDA, antes de agendar qualquer nota.
   *
   * Ele configurou o alto-falante e o som saiu no fone: `setSinkId` de elemento
   * de áudio não alcança um `AudioContext`, e este som é síntese pura. Trocar o
   * destino DEPOIS de agendar deixaria os primeiros milissegundos no
   * dispositivo errado, então o `await` vem primeiro.
   *
   * O custo é a troca de dispositivo, que atrasa o som em relação ao desenho.
   * NÃO MEDI esse atraso — não tenho como cronometrar a troca de sink daqui — e
   * está dito assim de propósito. Se a abertura passar a soar fora de sincronia
   * com o crescimento, é aqui que se olha primeiro.
   */

  // A preferência de saída é local; se o dispositivo sumiu, continua no padrão.
  void routeContext(ac)
  void ac.resume()
  const t = ac.currentTime + 0.03
  const DUR = CRESCIMENTO_MS / 1000
  const BASE = 174.6 // fá3 — grave o bastante para ter corpo em caixa pequena

  const voz = (freq: number, quando: number, dur: number, pico: number, detune = 0): void => {
    const o = ac.createOscillator()
    const g = ac.createGain()
    o.type = 'sine'
    o.frequency.value = freq
    o.detune.value = detune
    g.gain.setValueAtTime(0.0001, quando)
    g.gain.exponentialRampToValueAtTime(pico, quando + Math.min(0.09, dur * 0.25))
    g.gain.exponentialRampToValueAtTime(0.0001, quando + dur)
    o.connect(g).connect(ac.destination)
    o.start(quando)
    o.stop(quando + dur + 0.05)
  }

  // harmônicos com a quinta no meio: largo, sem adoçar
  const RAZOES = [1, 2, 3, 4.5, 6]
  RAZOES.forEach((r, i) => {
    const alvo = i / (RAZOES.length - 1)
    const quando = t + (1 - Math.pow(1 - alvo, 1 / 3)) * DUR
    const sobra = Math.max(0.5, t + DUR + 0.85 - quando)
    voz(BASE * r, quando, sobra, 0.16 / (1 + i * 0.55), i * 3)
    // o par levemente desafinado dá brilho de metal sem virar sino
    if (i > 0) voz(BASE * r, quando, sobra, 0.05 / (1 + i * 0.6), i * -7)
  })
  voz(BASE / 2, t, DUR + 0.9, 0.1) // o chão, presente desde o primeiro instante

  // fecha o contexto depois da cauda: um por abertura, e nenhum vazando
  const timer = setTimeout(() => void ac.close().catch(() => undefined), (DUR + 1.6) * 1000)
  return () => { clearTimeout(timer); void ac.close().catch(() => undefined) }
}

export type Materia = {
  /** amplitude da voz, 0..1 — a massa incha */
  voz: (a: number) => void
  /** solta a semente: ela cresce até a forma cheia */
  liberar: () => void
  desligar: () => void
}

export function materia(cv: HTMLCanvasElement): Materia | null {
  const gl = cv.getContext('webgl', { antialias: true })
  if (gl === null) return null

  const comp = (tipo: number, fonte: string): WebGLShader | null => {
    const s = gl.createShader(tipo)
    if (s === null) return null
    gl.shaderSource(s, fonte)
    gl.compileShader(s)
    if (gl.getShaderParameter(s, gl.COMPILE_STATUS) !== true) {
      console.error('[materia] shader não compilou:', gl.getShaderInfoLog(s))
      return null
    }
    return s
  }
  const vs = comp(gl.VERTEX_SHADER, VS)
  const fs = comp(gl.FRAGMENT_SHADER, FS)
  const prog = gl.createProgram()
  if (vs === null || fs === null || prog === null) return null
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  if (gl.getProgramParameter(prog, gl.LINK_STATUS) !== true) {
    console.error('[materia] programa não linkou:', gl.getProgramInfoLog(prog))
    return null
  }
  gl.useProgram(prog)

  const dados = icosaedro(SUBDIV)
  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, dados, gl.STATIC_DRAW)
  // 4 flutuantes por vértice: x, y, z e a vez da aresta — 16 bytes de passo
  const PASSO = 4 * Float32Array.BYTES_PER_ELEMENT
  const loc = gl.getAttribLocation(prog, 'pos')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, PASSO, 0)
  const locOrdem = gl.getAttribLocation(prog, 'ordem')
  gl.enableVertexAttribArray(locOrdem)
  gl.vertexAttribPointer(locOrdem, 1, gl.FLOAT, false, PASSO, 3 * Float32Array.BYTES_PER_ELEMENT)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE)

  const uMvp = gl.getUniformLocation(prog, 'u_mvp')
  const uTime = gl.getUniformLocation(prog, 'u_time')
  const uAmp = gl.getUniformLocation(prog, 'u_amp')
  const uPulso = gl.getUniformLocation(prog, 'u_pulso')
  const uNasce = gl.getUniformLocation(prog, 'u_nasce')
  const vertices = dados.length / 4 // 4 flutuantes por vértice, não 3

  const tam = (): void => {
    const d = Math.min(window.devicePixelRatio, 2)
    cv.width = cv.clientWidth * d
    cv.height = cv.clientHeight * d
    gl.viewport(0, 0, cv.width, cv.height)
  }
  tam()
  window.addEventListener('resize', tam)

  const t0 = Date.now()
  let soltaEm: number | null = null
  let amp = 0.04
  let alvo = 0.04
  let pulso = 0
  let raf = 0
  let vivo = true
  let silence = () => {}
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  /* O crescimento em 1,7 s com curva que sai rápido e assenta devagar: é o
     gesto de algo que se ABRE, não de algo que infla. */
  const quanto = (): number => {
    if (soltaEm === null) return 0
    if (reduced) return 1
    const p = Math.min((Date.now() - soltaEm) / CRESCIMENTO_MS, 1)
    return 1 - Math.pow(1 - p, 3)
  }

  const quadro = (): void => {
    if (!vivo) return
    amp += (alvo - amp) * 0.2
    // o pulso é a DERIVADA da voz: sobe no ataque da sílaba e decai
    pulso += (Math.max(0, amp - 0.12) - pulso) * (amp > pulso ? 0.5 : 0.06)
    const n = quanto()
    const t = reduced ? 0 : (Date.now() - t0) / 1000
    // semente girando mais rápido (espera); ao crescer, assenta no lento
    const giro = 1 + (1 - n) * 2.2
    gl.viewport(0, 0, cv.width, cv.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.uniformMatrix4fv(uMvp, false, mvp(cv.width / Math.max(cv.height, 1), t, giro))
    gl.uniform1f(uTime, t)
    gl.uniform1f(uAmp, amp * n) // em semente a voz não mexe: ela ainda não abriu
    gl.uniform1f(uPulso, pulso * n)
    gl.uniform1f(uNasce, n)
    gl.drawArrays(gl.LINES, 0, vertices)
    raf = requestAnimationFrame(quadro)
  }
  quadro()

  return {
    voz: (a) => {
      alvo = a
    },
    liberar: () => {
      if (soltaEm !== null) return
      soltaEm = Date.now()
      // O som sai NO MESMO instante e dura o mesmo tempo — é a mesma abertura,
      // uma vista e outra ouvida. Chamar daqui é o que garante isso.
      silence = somDaAbertura()
    },
    desligar: () => {
      if (!vivo) return
      vivo = false
      silence()
      gl.deleteBuffer(buf); gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs)
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', tam)
    }
  }
}
