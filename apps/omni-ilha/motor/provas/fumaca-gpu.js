'use strict';
// Passo 0 do motor: confirma que o Electron escondido sobe WebGL2 na GTX 1650 (ANGLE D3D11)
// e que o timer query de GPU existe. Sem isso, nenhuma outra prova vale.
// Uso (ELECTRON_RUN_AS_NODE removido do ambiente):
//   electron.exe provas/fumaca-gpu.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('force_high_performance_gpu');
app.whenReady().then(async () => {
  const janela = new BrowserWindow({ width: 256, height: 256, show: false, paintWhenInitiallyHidden: true });
  await janela.loadURL('data:text/html,<canvas id=c width=256 height=256></canvas>');
  const r = await janela.webContents.executeJavaScript(`(() => {
    const gl = document.getElementById('c').getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: true });
    if (!gl) return JSON.stringify({ erro: 'sem webgl2' });
    const d = gl.getExtension('WEBGL_debug_renderer_info');
    const ren = d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?';
    gl.clearColor(0.2, 0.4, 0.6, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    const p = new Uint8Array(4); gl.readPixels(5, 5, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
    return JSON.stringify({ ren, px: Array.from(p), timer: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'),
      maxTextura: gl.getParameter(gl.MAX_TEXTURE_SIZE), vtf: gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) });
  })()`);
  const res = JSON.parse(r);
  res.gtx1650 = /GTX 1650/.test(res.ren || '');
  res.passou = res.gtx1650 && res.timer && res.px.join(',') === '51,102,153,255';
  console.log('RESULTADO ' + JSON.stringify(res));
  fs.writeFileSync(path.join(__dirname, 'fumaca-gpu.json'), JSON.stringify(res, null, 2));
  app.exit(res.passou ? 0 : 1);
});
