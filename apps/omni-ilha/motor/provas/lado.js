// provas/lado.js — lado-a-lado.mp4: rig antigo (cartão CSS 3D da bancada/quadrinhos) contra a malha nova,
// mesma pose normalizada em cada quadro (yaw -1 -> +1 -> 0, depois pitch -1 -> +1 -> 0), 6 s a 30 fps.
// O gravar.js já capturou o antigo (CRU/lado-antigo/NNNN.png, 884x960) e escreveu CRU/lado-poses.json.
// Aqui a malha nova desenha o mesmo recorte da arte (x 170, y 40, 884x960) e o ffmpeg junta os dois.
// Pose normalizada: 1 = alcance máximo de cada rig (antigo 11° de yaw e 7° de pitch; novo 22° e 14°).
window.PROVA = async function (omni, P) {
  const RW = 884, RH = 960, REC = [170, 40, RW, RH];
  const { fps, poses } = JSON.parse(P.fs.readFileSync(P.path.join(P.CRU, 'lado-poses.json'), 'utf-8'));
  const alvo = omni.alvo(RW, RH);
  const novo = P.path.join(P.CRU, 'lado-novo.mp4');
  const v = P.video(novo, RW, RH, fps, { codec: 'x264' });
  for (const [yaw, pitch] of poses) {
    omni.renderPose({ AnguloX: yaw, AnguloY: pitch }, { fb: alvo.fb, largura: RW, altura: RH, recorte: REC, fundo: P.FUNDO });
    await v.quadro(omni.ler(alvo.fb, RW, RH));
  }
  await v.fim();
  const gx = omni.modelo.parametros.find((p) => p.id === 'AnguloX').graus;
  const gy = omni.modelo.parametros.find((p) => p.id === 'AnguloY').graus;
  // rótulos por arquivo (evita escapar vírgula e dois-pontos dentro do filtro)
  const txtA = P.path.join(P.CRU, 'lado-rotulo-antigo.txt'), txtN = P.path.join(P.CRU, 'lado-rotulo-novo.txt');
  P.fs.writeFileSync(txtA, 'antes: cartão CSS 3D  (yaw ±11°, pitch ±7°)');
  P.fs.writeFileSync(txtN, `agora: malha 2,5D  (yaw ±${gx}°, pitch ±${gy}°)`);
  const esc = (f) => f.replace(/\\/g, '/').replace(/:/g, '\\:');
  const fonte = esc('C:/Windows/Fonts/arial.ttf');
  const rot = (txt) => `drawtext=fontfile='${fonte}':textfile='${esc(txt)}':fontcolor=0xC8D2E1:fontsize=26:x=24:y=h-48:box=1:boxcolor=0x000000@0.45:boxborderw=8`;
  const saida = P.path.join(P.PROVAS, 'lado-a-lado.mp4');
  P.ffmpeg([
    '-framerate', String(fps), '-i', P.path.join(P.CRU, 'lado-antigo', '%04d.png'), '-i', novo,
    '-filter_complex', `[0:v]scale=${RW}:${RH}:flags=lanczos,format=rgb24,${rot(txtA)}[a];[1:v]format=rgb24,${rot(txtN)}[b];[a][b]hstack=inputs=2,format=yuv420p[s]`,
    '-map', '[s]', '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-threads', '1',
    '-fflags', '+bitexact', '-flags:v', '+bitexact', '-map_metadata', '-1', '-movflags', '+faststart', saida,
  ]);
  const r = { arquivo: saida, quadros: poses.length, fps, sha256: P.hashArquivo(saida) };
  P.log('lado', JSON.stringify(r));
  return r;
};
