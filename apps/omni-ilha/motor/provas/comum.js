// provas/comum.js — ferramentas das provas, do lado da página de palco (Node ligado no renderer).
// Despejo cru para o Python medir, ffmpeg por stdin, JSON de resultado, hash e cenas de referência.
(function () {
  'use strict';
  const fs = require('fs');
  const path = require('path');
  const cp = require('child_process');
  const crypto = require('crypto');
  const os = require('os');
  const { fileURLToPath } = require('url');

  const PROVAS = path.dirname(fileURLToPath(location.href));
  const MOTOR = path.dirname(PROVAS);
  const FFMPEG = 'C:\\Users\\wp.santos\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0.2-full_build\\bin\\ffmpeg.exe';
  const CRU = path.join(os.tmpdir(), 'omni-motor-cru');
  fs.mkdirSync(CRU, { recursive: true });
  const consulta = new URLSearchParams(location.search);

  const log = (...a) => { console.log('[prova]', ...a); };

  // fundo escuro dos vídeos (premultiplicado, opaco)
  const FUNDO = [8 / 255, 10 / 255, 16 / 255, 1];

  // A cena da prova de giro, 8 s: yaw -1 -> +1 -> -1, varredura de pitch, roll, repouso e o estalo de yaw.
  const GIRO = {
    duracao: 8, laco: true, respira: true,
    trilha: {
      AnguloX: [[0.2, 0], [0.8, -1], [2.0, 1], [2.8, -1], [3.2, 0], [5.9, 0], [5.9, 0.8, 'degrau'], [7.6, 0.8], [8.0, 0]],
      AnguloY: [[3.2, 0], [3.5, -1], [4.1, 1], [4.4, 0]],
      AnguloZ: [[4.4, 0], [4.7, -1], [5.0, 1], [5.2, 0]],
    },
  };
  const ESTALO = { t: 5.9, ate: 7.6, alvo: 0.8 };

  // linha 0 do GL é a de baixo: vira para a ordem da imagem
  function vira(buf, w, h, canais) {
    const out = new Uint8Array(buf.length), linha = w * canais;
    for (let y = 0; y < h; y++) out.set(buf.subarray((h - 1 - y) * linha, (h - y) * linha), y * linha);
    return out;
  }
  function canal(buf, k) {
    const out = new Uint8Array(buf.length / 4);
    for (let i = 0; i < out.length; i++) out[i] = buf[i * 4 + k];
    return out;
  }
  function despeja(nome, dados) {
    const f = path.join(CRU, nome);
    fs.writeFileSync(f, Buffer.from(dados.buffer, dados.byteOffset, dados.byteLength));
    return f;
  }
  function salvaJSON(nome, obj) {
    const f = path.isAbsolute(nome) ? nome : path.join(PROVAS, nome);
    fs.writeFileSync(f, JSON.stringify(obj, null, 2) + '\n');
    return f;
  }
  function hash(dados) { return crypto.createHash('sha256').update(Buffer.from(dados.buffer, dados.byteOffset, dados.byteLength)).digest('hex'); }
  function hashArquivo(f) { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); }

  // roda ferramentas/medir.py e devolve o JSON que ele imprime na última linha
  function medir(args) {
    const r = cp.spawnSync('python', ['-I', path.join(MOTOR, 'ferramentas', 'medir.py'), ...args], { encoding: 'utf-8', maxBuffer: 64 << 20, windowsHide: true });
    if (r.status !== 0) throw new Error('medir.py falhou: ' + (r.stderr || r.stdout || r.error));
    const linhas = r.stdout.trim().split(/\r?\n/);
    return JSON.parse(linhas[linhas.length - 1]);
  }

  // ffmpeg lendo quadros RGBA crus pelo stdin (linha de baixo primeiro, por isso o vflip)
  function video(saida, w, h, fps, opcoes) {
    opcoes = opcoes || {};
    const cod = opcoes.codec === 'x264'
      ? ['-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-threads', '1']
      : ['-c:v', 'h264_nvenc', '-rc', 'vbr', '-cq', '18', '-b:v', '0', '-preset', 'p5'];
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-r', String(fps), '-i', '-',
      '-vf', 'vflip,format=yuv420p', ...cod, '-fflags', '+bitexact', '-flags:v', '+bitexact', '-map_metadata', '-1', '-movflags', '+faststart', saida];
    const p = cp.spawn(FFMPEG, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    let erro = '';
    p.stderr.on('data', (d) => { erro += d; });
    const fim = new Promise((ok, falha) => p.on('close', (c) => (c === 0 ? ok() : falha(new Error('ffmpeg ' + c + ': ' + erro)))));
    return {
      async quadro(buf) {
        if (!p.stdin.write(Buffer.from(buf))) await new Promise((ok) => p.stdin.once('drain', ok));
      },
      async fim() { p.stdin.end(); await fim; return saida; },
    };
  }

  function ffmpeg(args) {
    const r = cp.spawnSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf-8', windowsHide: true, maxBuffer: 64 << 20 });
    if (r.status !== 0) throw new Error('ffmpeg falhou: ' + r.stderr);
  }

  const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));

  window.PROVAS = { fs, path, cp, MOTOR, PROVAS, CRU, FFMPEG, FUNDO, GIRO, ESTALO, consulta, log, vira, canal, despeja, salvaJSON, hash, hashArquivo, medir, video, ffmpeg, espera };
})();
