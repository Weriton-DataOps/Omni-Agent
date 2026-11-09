#version 300 es
// render/plate.vert — a arte inteira numa malha 96x96 que gira em 3D.
// Cada vértice lê o próprio z (campos.png) e os pesos (pesos.png) no texel onde mora, mistura os ângulos
// de cabeça / pescoço / ombros pelos pesos, gira (yaw -> pitch -> roll) em torno do pivô e projeta
// em ortográfica. Com todos os ângulos em 0 a posição sai idêntica à de repouso: fidelidade por construção.
precision highp float;
precision highp int;

layout(location = 0) in vec2 a_pos;      // px na arte em repouso (0..1254)

uniform sampler2D u_campos;   // R,G = z em 16 bits (alto, baixo); B = raiz->ponta do cabelo
uniform sampler2D u_pesos;    // R cabeça, G pescoço, B respiração do corpo (fração de ombros)
uniform sampler2D u_base;     // premultiplicada: só o alfa, para as provas saberem onde há tinta
uniform vec2 u_tamanho;       // 1254, 1254
uniform vec2 u_pivo;          // 612, 930
uniform vec2 u_prof;          // zmin, escala do campo de 16 bits
uniform vec3 u_cabeca;        // yaw, pitch, roll (rad)
uniform vec3 u_cabelo;        // atraso do cabelo sobre a cabeça (rad), já vezes CabeloAtraso
uniform vec3 u_pescoco;
uniform vec3 u_ombros;
uniform vec2 u_respira;       // fase do corpo (0..1), fase atrasada da cabeça (0..1)
uniform vec3 u_respAmp;       // px: ombros, gola, cabeça
uniform vec4 u_saida;         // px da arte -> NDC: escala xy, deslocamento zw

out vec2 v_uv;
out vec3 v_tela;              // capturado por transform feedback: x, y na tela (px da arte) e z girado
out vec3 v_info;              // idem: ponta do cabelo, peso da cabeça, alfa da arte no vértice

// ângulo exatamente 0 pula a conta: o cos aproximado da GPU não pode mover nem meio ulp a pose neutra
vec3 gira(vec3 p, vec3 a) {
  float c, s;
  if (a.x != 0.0) {                          // yaw: z positivo anda para +x
    c = cos(a.x); s = sin(a.x);
    p = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
  }
  if (a.y != 0.0) {                          // pitch: positivo baixa o queixo (z positivo desce)
    c = cos(a.y); s = sin(a.y);
    p = vec3(p.x, p.y * c + p.z * s, -p.y * s + p.z * c);
  }
  if (a.z != 0.0) {                          // roll: positivo tomba o topo para +x
    c = cos(a.z); s = sin(a.z);
    p = vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z);
  }
  return p;
}

void main() {
  ivec2 tx = clamp(ivec2(floor(a_pos)), ivec2(0), ivec2(u_tamanho) - 1);
  vec4 c = texelFetch(u_campos, tx, 0);
  vec4 w = texelFetch(u_pesos, tx, 0);
  float z = (round(c.r * 255.0) * 256.0 + round(c.g * 255.0)) / u_prof.y + u_prof.x;
  float ponta = c.b;
  float wc = w.r, wn = w.g, ws = max(0.0, 1.0 - wc - wn);

  vec3 ang = wc * (u_cabeca + ponta * u_cabelo) + wn * u_pescoco + ws * u_ombros;
  vec3 p = gira(vec3(a_pos - u_pivo, z), ang);
  float sobe = ws * w.b * u_respAmp.x * u_respira.x + wn * u_respAmp.y * u_respira.x + wc * u_respAmp.z * u_respira.y;
  vec2 tela = u_pivo + p.xy - vec2(0.0, sobe);

  v_uv = a_pos / u_tamanho;
  v_tela = vec3(tela, p.z);
  v_info = vec3(ponta, wc, texelFetch(u_base, tx, 0).a);
  gl_Position = vec4(tela * u_saida.xy + u_saida.zw, 0.0, 1.0);
}
