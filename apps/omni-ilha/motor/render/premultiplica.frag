#version 300 es
// render/premultiplica.frag — passe 0: base RGBA (alfa reto) -> RGBA8 premultiplicada, texel a texel.
// Filtrar depois de premultiplicar é o que impede a franja escura nos fios semitransparentes.
precision highp float;

uniform sampler2D u_fonte;     // alfa reto, NEAREST

out vec4 cor;

void main() {
  vec4 c = texelFetch(u_fonte, ivec2(gl_FragCoord.xy), 0);
  cor = vec4(c.rgb * c.a, c.a);
}
