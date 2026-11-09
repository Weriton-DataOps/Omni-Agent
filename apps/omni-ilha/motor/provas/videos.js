// provas/videos.js — os vídeos e a folha que o Weriton olha.
//   prova-giro.mp4     8 s a 30 fps, cena do giro (yaw -1 -> +1 -> -1, pitch, roll, estalo de yaw), 1254x1254
//   prova-idle.mp4     10 s a 30 fps de idle (ruído lento em yaw/pitch/roll, sacadas de atenção, respiração), laço fechado
//   folha-pose-3x3.png yaw -1/0/+1 nas colunas, pitch -1/0/+1 nas linhas, 418 px por célula, rotulada
// Codificador x264 com 1 thread e bitexact: regravar dá o mesmo arquivo.
window.PROVA = async function (omni, P) {
  const { W, H } = omni;
  const alvo = omni.alvo(W, H);
  const op = { fb: alvo.fb, fundo: P.FUNDO };
  const graus = (id) => omni.modelo.parametros.find((p) => p.id === id).graus;

  async function grava(nome, def, quadros) {
    omni.cena(def);
    const v = P.video(P.path.join(P.PROVAS, nome), W, H, 30, { codec: 'x264' });
    for (let q = 0; q < quadros; q++) {
      omni.render(q / 30, op);
      await v.quadro(omni.ler(alvo.fb));
    }
    await v.fim();
    return { arquivo: P.path.join(P.PROVAS, nome), quadros, sha256: P.hashArquivo(P.path.join(P.PROVAS, nome)) };
  }

  const giro = await grava('prova-giro.mp4', P.GIRO, 240);
  const idle = await grava('prova-idle.mp4', { duracao: 10, laco: true, idle: { periodo: 10 } }, 300);

  // folha 3x3: uma pose estática por célula (viewport de 418 px no mesmo alvo; minificação liga o mipmap)
  const C = W / 3, gx = graus('AnguloX'), gy = graus('AnguloY');
  const celulas = [];
  for (let lin = 0; lin < 3; lin++) {
    for (let col = 0; col < 3; col++) {
      const yaw = col - 1, pitch = lin - 1;
      omni.renderPose({ AnguloX: yaw, AnguloY: pitch }, { fb: alvo.fb, largura: W, altura: H, viewport: [col * C, (2 - lin) * C, C, C], fundo: P.FUNDO, limpar: true });
      const fmt = (v, g) => (v === 0 ? '0' : (v > 0 ? '+' : '-') + g) + ' deg';
      celulas.push({ caixa: [col * C, lin * C, C, C], rotulo: `yaw ${fmt(yaw, gx)}  pitch ${fmt(pitch, gy)}`, pose: { AnguloX: yaw, AnguloY: pitch } });
    }
  }
  P.despeja('folha.rgba', P.vira(omni.ler(alvo.fb), W, H, 4));
  const saidaFolha = P.path.join(P.PROVAS, 'folha-pose-3x3.png');
  P.fs.writeFileSync(P.path.join(P.CRU, 'folha-manifesto.json'), JSON.stringify({ W, H, celulas, saida: saidaFolha }));
  P.medir(['folha', P.CRU]);

  const r = { giro, idle, folha: saidaFolha };
  P.log('videos', JSON.stringify(r));
  return r;
};
