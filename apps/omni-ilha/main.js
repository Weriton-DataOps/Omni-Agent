// Omni · ilha — maquete: ícone pequeno pendurado no topo da tela; o hover espia e, com intenção, abre o menu.
// Electron puro, sem build.
//
// Arquitetura (decidida pelas medições de 18/10/2026, ver o ponto omni-desktop.md):
//  - A janela tem TAMANHO FIXO, o do painel aberto mais folga, e só recebe setBounds ao nascer e quando a
//    tela muda. Abrir e fechar é a forma da ilha animando dentro dela (renderer.js), num relógio só.
//    Animar o setBounds tremia: o x andava até 80 px por passo e o conteúdo chegava 25–55 ms atrasado.
//  - O clique-passante é decidido AQUI, por sondagem do cursor (screen.getCursorScreenPoint) contra o
//    retângulo que o renderer informa: a forma VISÍVEL, quadro a quadro. Sem { forward: true }: o forward
//    do Electron 33 perde enter/leave no Windows, e uma ida e volta de IPC por evento de mouse perde cliques.
//  - A janela nunca pega foco (focusable:false = WS_EX_NOACTIVATE): o clique chega sem ativar. Nada de
//    blur() para "devolver" o teclado: no Windows ele vai para a próxima janela visível na ordem Z, que
//    acima do nível screen-saver é uma janela invisível do explorer, e o que o usuário digitar some.
//    O Escape é um atalho global registrado só enquanto a ilha está aberta com o ponteiro em cima.
'use strict';

const { app, BrowserWindow, clipboard, globalShortcut, ipcMain, screen } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { lerSessoes, lerPassos, lerDiff } = require('./sessoes');
const { listarPontos, lerPonto } = require('./pontos');
const { montarMesa } = require('./mesa');
const { spawn } = require('child_process');
const { resumo: resumoOvercore, lerAgora: lerOvercoreAgora, agir: agirOvercore, ligar: ligarOvercore } = require('./overcore');
const { resumo: resumoOracle } = require('./oracle');
const { registrarVeredito, dispensarPraVoce, mexerNoItem } = require('./escrita');
const { criar: criarExecucao, responder: responderExecucao, atualizar: atualizarExecucao, visto: execucaoVista } = require('./execucoes');
const { lerSistema, processos } = require('./sistema');
const { lerWhatsapp } = require('./whatsapp');
const { criarMaoCofre } = require('./cofre');
const { registrarIpcCofre } = require('./cofre-ipc');
const ICONE = path.join(__dirname, 'omni.ico'); // a face do Omni (b2-arte.png recortada)

// FAIXA px de cada lado para a faixa que escorre pela borda de cima da tela; FOLGA px a mais de cada lado
// para a mola passar um pouco do ponto sem cortar a ponta da faixa. A altura vem do renderer (ele mede o
// menu) e já inclui a folga de baixo para a sombra e o passar-do-ponto.
const FAIXA = 180;
const FOLGA = 24;
// 19/10 nasceu com 640 (a largura do notch do Coucou); 21/10 abriu para 900, três colunas na Início:
// sistema com a face do Omni | cards (Actions, WhatsApp) | sessões
const LARGURA_ABERTA = 1200; // 27/10: quatro colunas (o Oracle ganhou a dele)
const TAMANHO_INICIAL = { largura: LARGURA_ABERTA + 2 * (FAIXA + FOLGA), altura: 300 };
// Histerese: para contar como "saiu", o ponteiro precisa passar MARGEM_SAIDA px além do corpo. O
// clique-passante usa o retângulo exato: a faixa e a folga nunca pegam clique.
const MARGEM_SAIDA = 6;
// Sondagem adaptativa. O timer do Windows tem grão de 15,6 ms: pedir 16 dá ~31 ms de fato (medido em
// 18/10, p50 30,6 ms) e pedir 50 dá ~62. É isso que o "perto" e o "longe" valem na prática.
const PERTO = 140;
const SONDA_PERTO = 16;
const SONDA_LONGE = 50;
const ARQUIVO_LIMITES = path.join(os.tmpdir(), 'omni-ilha-limites.json');
// OMNI_ILHA_ESCONDIDA=1: nunca mostra a janela (testes com capturePage). OMNI_ILHA_TESTE=<arquivo.js>:
// módulo de teste que recebe a janela e pode trocar a fonte do cursor. Os dois só servem para bancada.
const ESCONDIDA = process.env.OMNI_ILHA_ESCONDIDA === '1';
const COMECA_ABERTA = process.argv.includes('--aberta');

let janela = null;
let tamanho = { ...TAMANHO_INICIAL };
let caixa = null; // getBounds() real da janela (em DIP), atualizado a cada posicionar()
let alvo = null; // retângulo do corpo visível, relativo à janela: { x, y, w, h }
let estadoIlha = 'recolhida';
let ignorando = true;
let dentro = false;
let sonda = null;
let cursorEnviado = { x: -1e6, y: -1e6 }; // última posição repassada para a face olhar (só fora da forma)
let escapeLigado = false;
let quedas = [];
let lerCursor = () => screen.getCursorScreenPoint();

// Instância única: a segunda sai sem criar janela nem sonda (o whenReady dispara mesmo depois do quit).
const trava = app.requestSingleInstanceLock();
if (!trava) app.quit();

// Sempre colada na borda de cima da área de trabalho e centralizada: a ilha pende do topo.
function limites({ largura, altura }) {
  const area = screen.getPrimaryDisplay().workArea;
  return { x: Math.round(area.x + (area.width - largura) / 2), y: area.y, width: largura, height: altura };
}

function registrarLimites() {
  if (!janela || janela.isDestroyed()) return;
  const dados = { ...janela.getBounds(), escala: screen.getPrimaryDisplay().scaleFactor, estado: estadoIlha, aberta: estadoIlha === 'aberta', corpo: alvo };
  try { fs.writeFileSync(ARQUIVO_LIMITES, JSON.stringify(dados)); } catch { /* só serve para capturas */ }
}

// Um setBounds só quando o lugar muda (nascer, medida nova, tela trocada); nunca para animar.
function posicionar() {
  if (!janela || janela.isDestroyed()) return;
  const desejado = limites(tamanho);
  const atual = janela.getBounds();
  if (atual.x !== desejado.x || atual.y !== desejado.y || atual.width !== desejado.width || atual.height !== desejado.height) {
    janela.setBounds(desejado);
  }
  caixa = janela.getBounds(); // em escala fracionária o Windows pode devolver ±1 px: vale o real
  janela.setAlwaysOnTop(true, 'screen-saver');
  registrarLimites();
}

// Vigia do topo (04/11): o Windows rebaixou a ilha pra baixo do VS Code/Teams/Chrome com a marca TOPMOST ainda
// acesa (pilha medida: ilha na 24ª, abaixo de janelas normais). O setAlwaysOnTop só rodava ao nascer e ao trocar
// de tela, então nada a puxava de volta. A cada 2 s reafirma (SetWindowPos HWND_TOPMOST, sem ativar nem mover).
const TOPO_MS = 2000;
function reafirmarTopo() {
  if (!janela || janela.isDestroyed() || !janela.isVisible()) return;
  janela.setAlwaysOnTop(true, 'screen-saver');
}

function definirIgnorar(valor) {
  ignorando = valor;
  if (janela && !janela.isDestroyed()) janela.setIgnoreMouseEvents(valor);
}

function dentroDe(x, y, r, m) {
  return x >= r.x - m && x < r.x + r.w + m && y >= r.y - m && y < r.y + r.h + m;
}

function distancia(x, y, r) {
  const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
  const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

// Lê o cursor, decide o clique-passante no mesmo tick (sem ida e volta de IPC) e avisa o renderer só nas
// bordas (entrou/saiu). O retângulo é a forma visível: encolhendo, o painel que ainda aparece continua
// pegando clique e o ponteiro que volta para ele reabre; crescendo, a área ainda vazia não engole clique.
function sondar() {
  sonda = null;
  if (!janela || janela.isDestroyed() || !caixa) return;
  let perto = estadoIlha === 'aberta';
  if (alvo) {
    const p = lerCursor();
    const x = p.x - caixa.x;
    const y = p.y - caixa.y;
    const capturar = dentroDe(x, y, alvo, 0);
    if (capturar === ignorando) definirIgnorar(!capturar);
    const agora = dentroDe(x, y, alvo, dentro ? MARGEM_SAIDA : 0);
    if (agora !== dentro) {
      dentro = agora;
      janela.webContents.send('ponteiro', { dentro });
    }
    // Fora da forma a janela ignora o mouse e o renderer não vê mousemove: a face segue o cursor pela tela
    // com a leitura que a sonda já faz. Só quando ele anda 3 px ou mais, para não acordar o renderer à toa.
    if (!dentro && (Math.abs(x - cursorEnviado.x) >= 3 || Math.abs(y - cursorEnviado.y) >= 3)) {
      cursorEnviado = { x, y };
      janela.webContents.send('cursor', cursorEnviado);
    }
    perto = perto || dentro || distancia(x, y, alvo) < PERTO;
  }
  sonda = setTimeout(sondar, perto ? SONDA_PERTO : SONDA_LONGE);
}

function sondarJa() {
  clearTimeout(sonda);
  sondar();
}

function numero(v, min, max) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
}

// Escape global só enquanto faz sentido (aberta e ponteiro em cima): fora disso o Esc é do app do usuário.
function ligarEscape(ligar) {
  if (ligar === escapeLigado) return;
  escapeLigado = ligar;
  if (ESCONDIDA) return; // a bancada não sequestra o Esc de quem está usando a máquina
  if (ligar) {
    const ok = globalShortcut.register('Escape', () => {
      if (janela && !janela.isDestroyed()) janela.webContents.send('tecla', 'escape');
    });
    if (!ok) escapeLigado = false; // outro programa já tem o Esc global: a ilha fica sem ele
  } else {
    globalShortcut.unregister('Escape');
  }
}

// Renderer caiu: volta transparente ao clique e recarrega, no máximo 3 vezes em 30 s. Depois disso fica
// escondida e transparente (melhor uma ilha ausente que um laço de reload a toda velocidade).
function aoCair(_evento, detalhes) {
  if (!janela || janela.isDestroyed() || detalhes?.reason === 'clean-exit') return;
  alvo = null;
  dentro = false;
  definirIgnorar(true);
  ligarEscape(false);
  const agora = Date.now();
  quedas = quedas.filter((t) => agora - t < 30000);
  quedas.push(agora);
  if (quedas.length > 3) { janela.hide(); return; }
  setTimeout(() => { if (janela && !janela.isDestroyed()) janela.webContents.reload(); }, 500 * quedas.length);
}

if (trava) app.whenReady().then(() => {
  janela = new BrowserWindow({
    ...limites(tamanho),
    show: false, // mostrada com showInactive() quando o renderer mediu e posicionou
    type: 'toolbar', // WS_EX_TOOLWINDOW: fora do Alt-Tab
    focusable: false, // WS_EX_NOACTIVATE: clique chega sem ativar; a ilha nunca pega nem devolve foco
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    thickFrame: false,
    backgroundColor: '#00000000',
    icon: ICONE,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // a animação e a chama não podem ser estranguladas
      // Só na bancada escondida: janela escondida não recebe quadros do compositor, e sem quadros não há
      // requestAnimationFrame. Fora da tela (offscreen) o Chromium gera os quadros no ritmo de setFrameRate.
      offscreen: ESCONDIDA,
    },
  });
  // Transparente ao clique desde o primeiro instante: uma janela de 1148 px no topo nunca pode engolir
  // clique, nem antes de o renderer carregar. Sem forward, a ordem antes do loadFile não importa.
  definirIgnorar(true);
  janela.setAlwaysOnTop(true, 'screen-saver');
  caixa = janela.getBounds();
  if (ESCONDIDA) janela.webContents.setFrameRate(60);

  if (process.env.OMNI_ILHA_TESTE) {
    require(process.env.OMNI_ILHA_TESTE)({
      app,
      janela,
      trocarCursor: (fn) => { lerCursor = fn; },
      janelaActions: () => janelaActions,
      janelaOvercore: () => janelaOvercore,
      janelaCofre: () => janelaCofre,
      abrirCofre: () => abrirCofre(),
      estado: () => ({ ignorando, dentro, alvo, estadoIlha, caixa, tamanho, escapeLigado }),
      // a bancada não aperta teclas de verdade: simula o atalho global (só se estivesse registrado)
      apertarEscape: () => { if (escapeLigado) janela.webContents.send('tecla', 'escape'); return escapeLigado; },
    });
  }

  const vigiaTopo = ESCONDIDA ? null : setInterval(reafirmarTopo, TOPO_MS);
  janela.on('closed', () => { clearTimeout(sonda); clearInterval(vigiaTopo); janela = null; });
  janela.webContents.on('render-process-gone', aoCair);

  const query = { faixa: String(FAIXA), folga: String(FOLGA), largura: String(LARGURA_ABERTA) };
  if (COMECA_ABERTA) query.aberta = '1';
  janela.loadFile(path.join(__dirname, 'index.html'), { query });

  // Resolução, escala, barra de tarefas ou monitor primário mudaram: recentraliza uma vez.
  for (const evento of ['display-metrics-changed', 'display-added', 'display-removed']) {
    screen.on(evento, () => { posicionar(); sondarJa(); });
  }
});

// O renderer mediu o menu e diz de que tamanho a janela precisa ser. É o único setBounds da vida normal.
ipcMain.on('pronta', (evento, medidas) => {
  if (!janela || evento.sender !== janela.webContents) return;
  const area = screen.getPrimaryDisplay().workArea;
  const largura = numero(medidas?.largura, 200, area.width) ?? TAMANHO_INICIAL.largura;
  const altura = numero(medidas?.altura, 60, Math.min(800, area.height)) ?? TAMANHO_INICIAL.altura;
  tamanho = { largura: Math.round(largura / 2) * 2, altura: Math.round(altura) }; // largura par: centro inteiro
  dentro = false;
  definirIgnorar(true);
  posicionar();
  if (!ESCONDIDA && !janela.isVisible()) {
    janela.showInactive();
    janela.setAlwaysOnTop(true, 'screen-saver');
  }
  sondarJa();
});

// Retângulo do corpo visível. Chega a cada troca de estado e, durante a animação, a cada quadro que muda.
ipcMain.on('alvo', (evento, r) => {
  if (!janela || evento.sender !== janela.webContents) return;
  const x = numero(r?.x, -10000, 10000);
  const y = numero(r?.y, -10000, 10000);
  const w = numero(r?.w, 0, 10000);
  const h = numero(r?.h, 0, 10000);
  if (x === null || y === null || w === null || h === null) return;
  alvo = { x, y, w, h };
  if (['recolhida', 'espiando', 'aberta'].includes(r?.estado)) {
    if (r.estado !== estadoIlha) { estadoIlha = r.estado; registrarLimites(); }
  }
  sondarJa(); // o retângulo encolheu sob o ponteiro? o clique volta a passar já neste tick
});

ipcMain.on('escape', (evento, ligar) => {
  if (!janela || evento.sender !== janela.webContents) return;
  ligarEscape(!!ligar);
});

// Sessões do Claude Code: a vista Início (pílulas) e a vista Chat (passos e a última edição como diff).
// Só a ilha pergunta; a janela Actions não lê transcript.
const daIlha = (evento) => janela && evento.sender === janela.webContents;
ipcMain.handle('sessoes', (evento) => (daIlha(evento) ? lerSessoes() : []));
ipcMain.handle('passos', (evento, arquivo) => (daIlha(evento) ? lerPassos(arquivo) : []));
ipcMain.handle('diff', (evento, arquivo) => (daIlha(evento) ? lerDiff(arquivo) : null));
ipcMain.handle('fechar', (evento) => { if (daIlha(evento)) app.quit(); });
// coluna da esquerda (memória, CPU, disco, processos) e o card Omni WhatsApp da coluna do meio
ipcMain.handle('sistema', (evento) => (daIlha(evento) ? lerSistema(app) : null));
ipcMain.handle('whatsapp', (evento) => (daIlha(evento) ? lerWhatsapp(processos()) : null));

// ── janela Actions (19/10): o único card do menu abre o depósito Documents\Actions numa janela normal ──
// Ao contrário da ilha, esta tem foco, Alt-Tab e barra de tarefas: é onde se lê e, depois, se mexe. Uma só:
// clicar de novo traz a que já existe. Na bancada (ESCONDIDA) ela nasce fora da tela e nunca aparece.
let janelaActions = null;

const ABAS = new Set(['ideias', 'projetos', 'execucoes']);
function abrirActions(aba = '') {
  aba = ABAS.has(aba) ? aba : '';
  if (janelaActions && !janelaActions.isDestroyed()) {
    if (janelaActions.isMinimized()) janelaActions.restore();
    if (!ESCONDIDA) { janelaActions.show(); janelaActions.focus(); }
    if (aba) janelaActions.webContents.send('aba', aba);
    return;
  }
  const area = screen.getPrimaryDisplay().workArea;
  const largura = Math.min(1180, area.width - 80);
  const altura = Math.min(760, area.height - 80);
  janelaActions = new BrowserWindow({
    width: largura,
    height: altura,
    x: Math.round(area.x + (area.width - largura) / 2),
    y: Math.round(area.y + (area.height - altura) / 2),
    minWidth: 640,
    minHeight: 400,
    show: false,
    title: 'Actions',
    icon: ICONE,
    backgroundColor: '#121419',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#121419', symbolColor: '#9aa2b5', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'actions-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: ESCONDIDA,
    },
  });
  // a janela só mostra o depósito: link nenhum navega nem abre outra janela
  janelaActions.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  janelaActions.webContents.on('will-navigate', (ev) => ev.preventDefault());
  janelaActions.on('closed', () => { janelaActions = null; });
  janelaActions.once('ready-to-show', () => { if (!ESCONDIDA) janelaActions?.show(); });
  janelaActions.loadFile(path.join(__dirname, 'actions.html'), aba ? { hash: aba } : undefined);
}

const daJanelaActions = (evento) => janelaActions && !janelaActions.isDestroyed() && evento.sender === janelaActions.webContents;

ipcMain.on('abrir-actions', (evento, aba) => {
  if (!janela || evento.sender !== janela.webContents) return;
  // o Esc global da ilha engoliria o Esc da janela nova: o renderer já o solta ao recolher, aqui é o cinto
  ligarEscape(false);
  abrirActions(String(aba || ''));
});
// ── janela do Overcore (22/10): própria, separada do Actions (pedido dele). Uma só; clicar de novo traz a
// que existe. O token nunca entra aqui: overcore.js chama scripts/omni-overcore.mjs num processo à parte.
let janelaOvercore = null;
function abrirOvercore() {
  if (janelaOvercore && !janelaOvercore.isDestroyed()) {
    if (janelaOvercore.isMinimized()) janelaOvercore.restore();
    if (!ESCONDIDA) { janelaOvercore.show(); janelaOvercore.focus(); }
    return;
  }
  const area = screen.getPrimaryDisplay().workArea;
  const largura = Math.min(1080, area.width - 80);
  const altura = Math.min(720, area.height - 80);
  janelaOvercore = new BrowserWindow({
    width: largura, height: altura,
    x: Math.round(area.x + (area.width - largura) / 2 + 30), y: Math.round(area.y + (area.height - altura) / 2 + 30),
    minWidth: 600, minHeight: 360, show: false, title: 'Overcore', icon: ICONE, backgroundColor: '#11141a',
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#11141a', symbolColor: '#9aa2b5', height: 40 },
    webPreferences: { preload: path.join(__dirname, 'overcore-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: ESCONDIDA },
  });
  janelaOvercore.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  janelaOvercore.webContents.on('will-navigate', (ev) => ev.preventDefault());
  janelaOvercore.on('closed', () => { janelaOvercore = null; });
  janelaOvercore.once('ready-to-show', () => { if (!ESCONDIDA) janelaOvercore?.show(); });
  janelaOvercore.loadFile(path.join(__dirname, 'overcore.html'));
}
const daJanelaOvercore = (evento) => janelaOvercore && !janelaOvercore.isDestroyed() && evento.sender === janelaOvercore.webContents;
ipcMain.on('abrir-overcore', (evento) => {
  if (!janela || evento.sender !== janela.webContents) return;
  ligarEscape(false);
  abrirOvercore();
});
ipcMain.handle('overcore:resumo', (evento) => (daIlha(evento) ? resumoOvercore() : null));
ipcMain.handle('oracle:resumo', (evento) => (daIlha(evento) ? resumoOracle() : null));
// ── janela do cofre (F1, plano 5, T6): as credenciais da casa. Uma só, como a do Overcore. O valor nunca
// mora aqui: cofre-ipc.js converte e repassa à mão (cofre.js), que roda a CLI num processo à parte. A janela
// pede ao Windows para ficar fora de captura de tela de outros programas, porque mostra o valor revelado.
let janelaCofre = null;
function abrirCofre() {
  if (janelaCofre && !janelaCofre.isDestroyed()) {
    if (janelaCofre.isMinimized()) janelaCofre.restore();
    if (!ESCONDIDA) { janelaCofre.show(); janelaCofre.focus(); }
    return;
  }
  const area = screen.getPrimaryDisplay().workArea;
  const largura = Math.min(1080, area.width - 80);
  const altura = Math.min(720, area.height - 80);
  janelaCofre = new BrowserWindow({
    width: largura, height: altura,
    x: Math.round(area.x + (area.width - largura) / 2 + 60), y: Math.round(area.y + (area.height - altura) / 2 + 60),
    minWidth: 720, minHeight: 400, show: false, title: 'Cofre', icon: ICONE, backgroundColor: '#11141a',
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#11141a', symbolColor: '#9aa2b5', height: 40 },
    webPreferences: { preload: path.join(__dirname, 'cofre-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: ESCONDIDA },
  });
  janelaCofre.setContentProtection(true);
  janelaCofre.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  janelaCofre.webContents.on('will-navigate', (ev) => ev.preventDefault());
  janelaCofre.on('closed', () => { janelaCofre = null; });
  janelaCofre.once('ready-to-show', () => { if (!ESCONDIDA) janelaCofre?.show(); });
  janelaCofre.loadFile(path.join(__dirname, 'cofre.html'));
}
const daJanelaCofre = (evento) => janelaCofre && !janelaCofre.isDestroyed() && evento.sender === janelaCofre.webContents;
ipcMain.on('abrir-cofre', (evento) => {
  if (!daIlha(evento)) return;
  ligarEscape(false);
  abrirCofre();
});
registrarIpcCofre({ ipcMain, mao: criarMaoCofre(), clipboard, daJanela: daJanelaCofre, daIlha });

// ── janela do chat com o Omni (27/10): a ilha não pega foco, então a conversa mora numa janela normal.
// Por enquanto é só a forma (pedido dele): a caixa escreve e a bolha aparece, mas nada sai daqui. Uma só.
let janelaChat = null;
function abrirChat() {
  if (janelaChat && !janelaChat.isDestroyed()) {
    if (janelaChat.isMinimized()) janelaChat.restore();
    if (!ESCONDIDA) { janelaChat.show(); janelaChat.focus(); }
    return;
  }
  const area = screen.getPrimaryDisplay().workArea;
  const largura = Math.min(460, area.width - 80);
  const altura = Math.min(680, area.height - 80);
  janelaChat = new BrowserWindow({
    width: largura, height: altura,
    x: Math.round(area.x + area.width - largura - 40), y: Math.round(area.y + 60),
    minWidth: 360, minHeight: 420, show: false, title: 'Omni', icon: ICONE, backgroundColor: '#0e0f11',
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#0e0f11', symbolColor: '#9aa2b5', height: 40 },
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: ESCONDIDA },
  });
  janelaChat.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  janelaChat.webContents.on('will-navigate', (ev) => ev.preventDefault());
  janelaChat.on('closed', () => { janelaChat = null; });
  janelaChat.once('ready-to-show', () => { if (!ESCONDIDA) janelaChat?.show(); });
  janelaChat.loadFile(path.join(__dirname, 'chat.html'));
}
ipcMain.on('abrir-chat', (evento) => {
  if (!janela || evento.sender !== janela.webContents) return;
  ligarEscape(false);
  abrirChat();
});
ipcMain.handle('overcore:lista', async (evento) => (daJanelaOvercore(evento) ? lerOvercoreAgora() : null));
ipcMain.handle('overcore:acao', async (evento, acao, id) => (daJanelaOvercore(evento) ? agirOvercore(String(acao), String(id)) : null));
ipcMain.handle('overcore:ligar', (evento) => (daJanelaOvercore(evento) ? ligarOvercore() : null));
// o card Actions da ilha: quantos pontos há, quantas decisões esperam por ele e as linhas do card (o que
// pede ele, ou os três mais mexidos quando nada pede). O texto dos pontos continua só na janela Actions.
ipcMain.handle('actions:resumo', (evento) => {
  if (!daIlha(evento)) return null;
  const { pontos } = listarPontos();
  let praVoce = [];
  try { praVoce = montarMesa().praVoce; } catch { /* projetos.md quebrado não apaga o card */ }
  return {
    total: pontos.length,
    praVoce: praVoce.length,
    pedidos: praVoce.slice(0, 3).map((p) => ({ tipo: p.tipo, titulo: p.titulo, texto: String(p.texto).slice(0, 80) })),
    recentes: pontos.slice(0, 3).map((p) => ({ slug: p.slug, titulo: p.titulo, status: p.status.slice(0, 80), alteradoEm: p.alteradoEm })),
  };
});
ipcMain.handle('actions:listar', (evento) => (daJanelaActions(evento) ? listarPontos() : null));
ipcMain.handle('actions:ler', (evento, slug) => (daJanelaActions(evento) ? lerPonto(slug) : null));
ipcMain.handle('actions:mesa', (evento) => (daJanelaActions(evento) ? montarMesa() : null));
// escrita: só a janela Actions pede, e o main valida tudo (escrita.js recusa caminho fora do depósito)
const escrever = (fn) => { try { return { ok: true, dados: fn() ?? null }; } catch (e) { return { ok: false, erro: String(e?.message || e) }; } };
ipcMain.handle('actions:veredito', (evento, slug, dados) => (daJanelaActions(evento)
  ? escrever(() => { registrarVeredito(String(slug), { tipo: String(dados?.tipo || ''), motivo: String(dados?.motivo || ''), projeto: String(dados?.projeto || ''), ate: String(dados?.ate || '') }); })
  : null));
ipcMain.handle('actions:visto', (evento, slug) => (daJanelaActions(evento) ? escrever(() => { dispensarPraVoce(String(slug)); }) : null));
// executar: a tela grava a execução e o despacho (processo à parte, escondido) leva até a sessão certa
const DESPACHO = path.join(__dirname, '..', '..', 'scripts', 'omni-actions-despachar.mjs');
function despachar(id) {
  if (process.env.OMNI_ACTIONS_SEM_DESPACHO === '1') return; // bancada: grava, não entrega
  // o electron da ilha vira node (mesmo jeito da sonda do WhatsApp); destacado, sobrevive à ilha fechar
  const p = spawn(process.execPath, [DESPACHO, id], {
    cwd: path.dirname(DESPACHO), windowsHide: true, detached: true, stdio: 'ignore',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  p.on('error', () => { /* a execução fica na fila e a tela mostra */ });
  p.unref();
}
ipcMain.handle('actions:executar', (evento, dados) => (daJanelaActions(evento)
  ? escrever(() => { const ex = criarExecucao({ slug: String(dados?.slug || ''), projeto: String(dados?.projeto || ''), instrucao: String(dados?.instrucao || '') }); despachar(ex.id); return ex.id; })
  : null));
ipcMain.handle('actions:responder', (evento, id, texto) => (daJanelaActions(evento)
  ? escrever(() => { responderExecucao(String(id), String(texto || '')); despachar(String(id)); })
  : null));
ipcMain.handle('actions:reenviar', (evento, id) => (daJanelaActions(evento)
  ? escrever(() => { atualizarExecucao(String(id), { estado: 'na fila', nota: 'reenviada pela tela' }); despachar(String(id)); })
  : null));
ipcMain.handle('actions:execucao-vista', (evento, id) => (daJanelaActions(evento) ? escrever(() => { execucaoVista(String(id)); }) : null));
ipcMain.handle('actions:item', (evento, ref, acao) => (daJanelaActions(evento)
  ? escrever(() => mexerNoItem({ arquivo: String(ref?.arquivo || ''), linha: Number(ref?.linha), bruto: String(ref?.bruto ?? '') }, String(acao)))
  : null));

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
