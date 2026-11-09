// provas/fidelidade.js — (a) com tudo em 0 o render tem de ser a arte, byte por byte (tolerância 3/255).
// Dois quadros escondidos de 1254²: sobre transparente (= sobre preto, premultiplicado) e sobre branco.
// A régua (ferramentas/medir.py) compara com a base.png premultiplicada em todo pixel com alfa > 0.
window.PROVA = async function (omni, P) {
  const { W, H } = omni;
  const alvo = omni.alvo(W, H);
  omni.cena({}); // sem trilha, sem idle, sem respiração
  const quadros = {};
  for (const [nome, fundo] of [['transp', [0, 0, 0, 0]], ['branco', [1, 1, 1, 1]]]) {
    omni.render(0, { fb: alvo.fb, fundo });
    quadros[nome] = P.vira(omni.ler(alvo.fb), W, H, 4);
    P.despeja(`fid-${nome}.rgba`, quadros[nome]);
  }
  // a mesma pose pelo caminho estático (renderPose) tem de dar o mesmo quadro
  omni.renderPose({}, { fb: alvo.fb, fundo: [0, 0, 0, 0] });
  const viaPose = P.vira(omni.ler(alvo.fb), W, H, 4);
  const m = P.medir(['fidelidade', P.CRU]);
  m.renderPoseIgualRenderT = P.hash(viaPose) === P.hash(quadros.transp);
  m.placa = omni.placa();
  m.resolucao = [W, H];
  m.medidoEm = new Date().toISOString();
  P.salvaJSON('fidelidade.json', m);
  P.log('fidelidade', JSON.stringify({ preto: m.sobrePreto, branco: m.sobreBranco, passou: m.passou }));
  return { passou: m.passou, sobrePreto: m.sobrePreto.fracaoAte3, sobreBranco: m.sobreBranco.fracaoAte3 };
};
