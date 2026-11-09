// provas/giro.js — (b) o rosto vira de verdade: o sigilo (z alto) anda muito, o contorno do rosto
// (z baixo na borda) quase não anda, e a bochecha do lado do giro se comprime.
// Poses estáticas yaw -1, 0, +1 (pitch e roll 0). Despeja a máscara do sigilo e do rosto deformadas
// e as posições dos vértices; a régua é ferramentas/medir.py giro.
window.PROVA = async function (omni, P) {
  const { W, H } = omni;
  const alvo = omni.alvo(W, H);
  for (const [nome, yaw] of [['menos', -1], ['zero', 0], ['mais', 1]]) {
    const pose = { AnguloX: yaw };
    omni.renderPose(pose, { fb: alvo.fb, vista: 2 });
    P.despeja(`giro-${nome}-sig.u8`, P.canal(P.vira(omni.ler(alvo.fb), W, H, 4), 0));
    omni.renderPose(pose, { fb: alvo.fb, vista: 1 });
    P.despeja(`giro-${nome}-rosto.u8`, P.canal(P.vira(omni.ler(alvo.fb), W, H, 4), 0));
    P.despeja(`giro-${nome}-tf.f32`, omni.tela(omni.estadoPose(pose)));
  }
  P.fs.writeFileSync(P.path.join(P.CRU, 'giro-manifesto.json'), JSON.stringify({
    W, H, xs: omni.malha.grade.xs, ys: omni.malha.grade.ys, bochecha: [700, 728], pivo: omni.modelo.geometria.pivo,
  }));
  const m = P.medir(['giro', P.CRU]);
  m.yawGraus = omni.modelo.parametros.find((p) => p.id === 'AnguloX').graus;
  m.medidoEm = new Date().toISOString();
  P.salvaJSON('giro.json', m);
  P.log('giro', JSON.stringify({ sigilo: m.sigilo, silhueta: m.silhueta, bochecha: m.bochecha, passou: m.passou }));
  return { passou: m.passou, sigiloPx: m.sigilo.andaPx, silhuetaHausdorffPx: m.silhueta.hausdorffPx, silhuetaPorLinhaMaxPx: m.silhueta.porLinha.bordaMaxPx };
};
