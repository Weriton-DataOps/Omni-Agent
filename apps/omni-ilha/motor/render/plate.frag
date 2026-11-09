#version 300 es
// render/plate.frag — amostra a base já premultiplicada (passe 0) com LINEAR.
// Sem conversão sRGB<->linear nesta fatia: o byte que entra é o byte que sai em pose neutra.
// u_vista troca a saída por uma máscara deformada, para as provas medirem na mesma malha:
//   0 final · 1 rosto · 2 núcleo do sigilo · 3 fonte opaca (alfa >= 200)
precision highp float;

in vec2 v_uv;

uniform sampler2D u_base;      // premultiplicada
uniform sampler2D u_regioes;   // R rosto, G núcleo do sigilo, B opaco
uniform int u_vista;

out vec4 cor;

void main() {
  if (u_vista == 0) { cor = texture(u_base, v_uv); return; }
  vec4 r = texture(u_regioes, v_uv);
  float m = u_vista == 1 ? r.r : (u_vista == 2 ? r.g : r.b);
  cor = vec4(m, m, m, 1.0);
}
