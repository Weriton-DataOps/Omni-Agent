// provas/rasgo.js — (c) a malha não rasga nem dobra nas poses extremas.
// Para cada uma das 27 poses {-1,0,1}³ (yaw, pitch, roll; os eixos isolados estão entre elas):
//   - alfa final e a máscara da fonte opaca (alfa >= 200) deformada pela mesma malha;
//   - posições dos vértices na tela (transform feedback) para a razão de área por triângulo.
// A régua (ferramentas/medir.py rasgo) erode a máscara 4 px, conta alfa < 200 lá dentro e calcula as razões.
window.PROVA = async function (omni, P) {
  const { W, H } = omni;
  const alvo = omni.alvo(W, H);
  const poses = [];
  for (const y of [-1, 0, 1]) for (const p of [-1, 0, 1]) for (const r of [-1, 0, 1]) poses.push({ AnguloX: y, AnguloY: p, AnguloZ: r });
  poses.forEach((pose, k) => {
    omni.renderPose(pose, { fb: alvo.fb, fundo: [0, 0, 0, 0] });
    P.despeja(`rasgo-${k}-alfa.u8`, P.canal(P.vira(omni.ler(alvo.fb), W, H, 4), 3));
    omni.renderPose(pose, { fb: alvo.fb, fundo: [0, 0, 0, 0], vista: 3 });
    P.despeja(`rasgo-${k}-opaco.u8`, P.canal(P.vira(omni.ler(alvo.fb), W, H, 4), 0));
    P.despeja(`rasgo-${k}-tf.f32`, omni.tela(omni.estadoPose(pose)));
  });
  // dinâmico: as cenas que viram vídeo (giro com o estalo e o cabelo atrasado; idle), quadro a quadro a 30 fps.
  // Só posições dos vértices (x, y): a régua confere a razão de área em todo quadro, não só nas 27 poses.
  const nV = omni.malha.nVertices;
  for (const [nome, def, quadros] of [['giro', P.GIRO, 240], ['idle', { duracao: 10, laco: true, idle: { periodo: 10 } }, 300]]) {
    omni.cena(def);
    const xy = new Float32Array(quadros * nV * 2);
    for (let q = 0; q < quadros; q++) {
      const tf = omni.tela(omni.estado(q / 30));
      for (let v = 0; v < nV; v++) { xy[(q * nV + v) * 2] = tf[v * 6]; xy[(q * nV + v) * 2 + 1] = tf[v * 6 + 1]; }
    }
    P.despeja(`rasgo-dinamico-${nome}.f32`, xy);
  }
  omni.cena({});
  const graus = omni.modelo.parametros.find((p) => p.id === 'AnguloX').graus;
  P.fs.writeFileSync(P.path.join(P.CRU, 'rasgo-manifesto.json'), JSON.stringify({ W, H, xs: omni.malha.grade.xs, ys: omni.malha.grade.ys, poses, graus }));
  const m = P.medir(['rasgo', P.CRU]);
  m.faixaGraus = { AnguloX: graus, AnguloY: omni.modelo.parametros.find((p) => p.id === 'AnguloY').graus, AnguloZ: omni.modelo.parametros.find((p) => p.id === 'AnguloZ').graus };
  m.medidoEm = new Date().toISOString();
  P.salvaJSON(P.consulta.get('graus') ? `rasgo-${graus}graus.json` : 'rasgo.json', m);
  P.log('rasgo', JSON.stringify(m.resumo));
  return m.resumo;
};
