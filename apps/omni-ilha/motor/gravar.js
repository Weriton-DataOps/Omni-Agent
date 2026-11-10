'use strict';

// gravar.js — o Electron escondido que roda o motor na GPU e grava as provas.
// Uso (Electron 33 da própria ilha, com ELECTRON_RUN_AS_NODE fora do ambiente):
//   electron.exe gravar.js <tarefa> [<tarefa> ...] [--graus=18]
// Tarefas: fidelidade desempenho rasgo giro fisica determinismo videos lado vivo  (ou "tudo")
// Cada tarefa abre provas/palco.html?tarefa=<nome> numa janela que nunca aparece; a página roda
// provas/<nome>.js e devolve o resultado por IPC. Sem disableHardwareAcceleration: a conta é da GTX 1650.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const MOTOR = __dirname;
const TODAS = ['fidelidade', 'desempenho', 'rasgo', 'giro', 'fisica', 'determinismo', 'videos', 'lado', 'vivo'];
const opcoes = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
let tarefas = process.argv.slice(2).filter((a) => !a.startsWith('-') && !a.endsWith('.js') && a !== '.');
if (!tarefas.length) { console.error('uso: gravar.js <tarefa...> | tudo   tarefas: ' + TODAS.join(' ')); process.exit(2); }
if (tarefas.includes('tudo')) tarefas = TODAS;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// os shaders moram em .vert/.frag; a página (que também abre por file://) recebe tudo embutido num .js
function embuteShaders() {
  const ler = (n) => fs.readFileSync(path.join(MOTOR, 'render', n), 'utf-8');
  const js = '// gerado por gravar.js a partir de render/*.vert e *.frag — não editar à mão\n' +
    'window.OMNI = window.OMNI || {};\nwindow.OMNI.shaders = ' + JSON.stringify({
      plateVert: ler('plate.vert'), plateFrag: ler('plate.frag'), premultiplica: ler('premultiplica.frag'),
    }, null, 1) + ';\n';
  const alvo = path.join(MOTOR, 'render', 'shaders.js');
  if (!fs.existsSync(alvo) || fs.readFileSync(alvo, 'utf-8') !== js) fs.writeFileSync(alvo, js);
}

function janelaEscondida(w, h, web) {
  return new BrowserWindow({
    width: w, height: h, useContentSize: true, show: false, paintWhenInitiallyHidden: true,
    webPreferences: Object.assign({ backgroundThrottling: false }, web || {}),
  });
}

// 6 s a 30 fps: yaw -1 -> +1 -> 0, depois pitch -1 -> +1 -> 0 (o cartão antigo não tem roll)
function posesLado() {
  const s = (x) => x * x * (3 - 2 * x);
  const chaves = (k, t) => {
    if (t <= k[0][0]) return k[0][1];
    for (let i = 1; i < k.length; i++) if (t <= k[i][0]) return k[i - 1][1] + (k[i][1] - k[i - 1][1]) * s((t - k[i - 1][0]) / (k[i][0] - k[i - 1][0]));
    return k[k.length - 1][1];
  };
  const yaw = [[0.3, 0], [1.2, -1], [1.6, -1], [2.8, 1], [3.2, 1], [3.8, 0]];
  const pitch = [[3.8, 0], [4.4, -1], [4.7, -1], [5.4, 1], [5.6, 1], [6.0, 0]];
  const poses = [];
  for (let i = 0; i < 180; i++) { const t = i / 30; poses.push([+chaves(yaw, t).toFixed(5), +chaves(pitch, t).toFixed(5)]); }
  return poses;
}

// rig antigo (cartão CSS 3D da bancada/quadrinhos), uma pose por carregamento — só leitura
async function capturaAntigo(poses, pasta) {
  fs.mkdirSync(pasta, { recursive: true });
  const j = janelaEscondida(884, 960);
  const pagina = path.join(MOTOR, '..', 'bancada', 'quadrinhos', 'quadrinhos.html');
  for (let i = 0; i < poses.length; i++) {
    // olhar vira hx = olhar*0,6 lá dentro; hx 1 = 11° de yaw, hy 1 = 7° de pitch
    const [a, b] = poses[i];
    await j.loadFile(pagina, { search: `lib=neon&grande&t=0&expr=neutro&olhar=${(a / 0.6).toFixed(5)},${(b / 0.6).toFixed(5)}` });
    for (let k = 0; k < 100; k++) {
      if (await j.webContents.executeJavaScript('document.body.dataset.pronto === "1"')) break;
      await dormir(20);
    }
    await dormir(60);
    const img = await j.webContents.capturePage();
    fs.writeFileSync(path.join(pasta, String(i).padStart(4, '0') + '.png'), img.toPNG());
  }
  j.destroy();
}

async function rodaTarefa(nome) {
  const j = janelaEscondida(64, 64, { nodeIntegration: true, contextIsolation: false, sandbox: false });
  const erros = [];
  j.webContents.on('console-message', (_e, nivel, msg) => {
    // o aviso de desempenho da leitura do transform feedback é esperado (a prova lê na hora, de propósito)
    if (nivel >= 2 && !/^performance warning: READ-usage buffer/.test(msg)) erros.push(msg);
    if (/^\[prova\]/.test(msg)) console.log(msg);
  });
  const fim = new Promise((ok) => ipcMain.once('fim', (_e, r) => ok(r)));
  const busca = new URLSearchParams(Object.assign({ tarefa: nome }, opcoes)).toString();
  await j.loadFile(path.join(MOTOR, 'provas', 'palco.html'), { search: busca });
  const r = await fim;
  j.destroy();
  return Object.assign({ tarefa: nome }, r, erros.length ? { avisos: erros.slice(0, 20) } : {});
}

app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
// entre uma tarefa e outra não sobra janela; sem isto o Electron sai sozinho no meio da fila
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  embuteShaders();
  let falhou = false;
  for (const t of tarefas) {
    const t0 = Date.now();
    if (t === 'lado') {
      // as mesmas poses para os dois rigs; a página do motor lê o mesmo arquivo
      const cru = path.join(require('os').tmpdir(), 'omni-motor-cru');
      fs.mkdirSync(cru, { recursive: true });
      const poses = posesLado();
      fs.writeFileSync(path.join(cru, 'lado-poses.json'), JSON.stringify({ fps: 30, poses }));
      await capturaAntigo(poses, path.join(cru, 'lado-antigo'));
    }
    const r = t === 'vivo' ? await provaVivo() : await rodaTarefa(t);
    r.segundos = Math.round((Date.now() - t0) / 100) / 10;
    console.log('RESULTADO ' + JSON.stringify(r));
    if (!r.ok) falhou = true;
  }
  app.exit(falhou ? 1 : 0);
});

// a página viva abre escondida, roda 2 s de idle e tira um retrato (prova de que sobe sem erro)
async function provaVivo() {
  const j = janelaEscondida(720, 720);
  const erros = [];
  j.webContents.on('console-message', (_e, nivel, msg) => { if (nivel >= 2 && !/^performance warning: READ-usage buffer/.test(msg)) erros.push(msg); });
  await j.loadFile(path.join(MOTOR, 'vivo.html'));
  const leEstado = async () => JSON.parse(await j.webContents.executeJavaScript('JSON.stringify(window.OMNI_VIVO_ESTADO || null)'));
  await dormir(2000);
  const e1 = await leEstado();
  await dormir(1000);
  const e2 = await leEstado();
  const img = await j.webContents.capturePage();
  const saida = path.join(require('os').tmpdir(), 'omni-motor-cru', 'vivo.png');
  fs.writeFileSync(saida, img.toPNG());
  const bmp = img.toBitmap();
  let acesos = 0;
  for (let i = 0; i < bmp.length; i += 4) if (bmp[i] + bmp[i + 1] + bmp[i + 2] > 60) acesos++;
  j.destroy();
  // vivo de verdade: o relógio andou entre as duas leituras e a cabeça mudou de ângulo (idle)
  const anda = !!(e1 && e2 && e2.t > e1.t && e2.quadros > e1.quadros);
  const mexe = !!(anda && e1.cabecaGraus.some((g, i) => g !== e2.cabecaGraus[i]));
  return { tarefa: 'vivo', ok: erros.length === 0 && acesos > 1000 && anda && mexe, r: { retrato: saida, pixelsAcesos: acesos, anda, mexe, estado1: e1, estado2: e2 }, avisos: erros };
}
