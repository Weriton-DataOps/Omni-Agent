'use strict';

// Os canais do cofre na ilha (F1, plano 5, T6). A janela do cofre só fala com a mão por aqui, e cada canal
// confere o remetente: os da janela atendem só a janela do cofre, o resumo atende só a ilha; remetente errado
// recebe null, como os outros canais do main.js. A mão (cofre.js) roda a CLI; este módulo só converte o que
// vem do renderer (texto) no que a mão pede (Buffer) e o que a mão devolve (Buffer) no que o renderer mostra.
// Segredo: o valor digitado e o da área de transferência viram um Buffer que é zerado depois do pedido; a área
// é lida aqui no main, nunca no renderer, e só é limpa se o pedido deu certo e ela ainda guarda o mesmo texto.
// O revelado vai ao renderer como texto, com o prazo para sumir da tela, e o Buffer dele é zerado aqui.

const PRAZO_REVELADO_MS = 30000;
const CAMPOS_DO_CADASTRO = ['nome', 'tipo', 'servico', 'url', 'usuario', 'notas'];

// A CLI cadastrar recebe só estes campos; validade, etiquetas e rotação entram depois, pela edição.
function dadosDoCadastro(dados) {
  const d = dados && typeof dados === 'object' ? dados : {};
  const saida = {};
  for (const campo of CAMPOS_DO_CADASTRO) {
    const v = String(d[campo] ?? '').trim();
    if (v) saida[campo] = v;
  }
  saida.agentes = String(d.agentes ?? '').split(',').map((a) => a.trim()).filter(Boolean);
  return saida;
}

// Tira uma quebra de linha do fim (quem copia uma linha costuma levar o \n junto) e recusa o resto.
// A recusa nunca leva o texto.
function textoDaArea(texto) {
  const t = String(texto ?? '').replace(/\r?\n$/, '');
  if (t === '') return { ok: false, codigo: 'area-vazia', erro: 'a área de transferência está vazia' };
  if (/[\r\n]/.test(t)) return { ok: false, codigo: 'varias-linhas', erro: 'a área de transferência tem mais de uma linha; o valor precisa ser de uma linha só' };
  return { ok: true, texto: t };
}

const bufferDoTexto = (valor) => Buffer.from(String(valor ?? ''), 'utf8');

async function comBuffer(buf, pedido) {
  try { return await pedido(buf); } finally { buf.fill(0); }
}

async function daArea(clipboard, pedido) {
  const lido = clipboard.readText();
  const r = textoDaArea(lido);
  if (!r.ok) return r;
  const resposta = await comBuffer(bufferDoTexto(r.texto), pedido);
  if (resposta && resposta.ok && clipboard.readText() === lido) clipboard.clear();
  return resposta;
}

async function revelar(mao, nome) {
  const r = await mao.revelar(String(nome));
  if (!r || !r.ok) return r;
  const valor = r.valor;
  try {
    if (!Buffer.isBuffer(valor)) return { ok: false, codigo: 'sem-valor', erro: 'o cofre não devolveu o valor' };
    return { ok: true, dados: r.dados, valor: valor.toString('utf8'), prazoMs: PRAZO_REVELADO_MS };
  } finally { if (Buffer.isBuffer(valor)) valor.fill(0); }
}

async function resumo(mao) {
  const r = await mao.saude({ duplicatas: false });
  if (!r || !r.ok) return r;
  const alertas = Array.isArray(r.dados && r.dados.alertas) ? r.dados.alertas : [];
  return { ok: true, total: Number(r.dados.total) || 0, alertas: alertas.length, primeiros: alertas.slice(0, 3).map(({ regra, nome }) => ({ regra, nome })) };
}

function registrarIpcCofre({ ipcMain, mao, clipboard, daJanela, daIlha }) {
  const canais = [];
  const daJanelaDoCofre = (canal, fn) => {
    canais.push(canal);
    ipcMain.handle(canal, (evento, ...args) => (daJanela(evento) ? fn(...args) : null));
  };
  daJanelaDoCofre('cofre:listar', () => mao.listar());
  daJanelaDoCofre('cofre:lixeira', () => mao.lixeira());
  daJanelaDoCofre('cofre:esvaziar', () => mao.esvaziarLixeira());
  daJanelaDoCofre('cofre:saude', (duplicatas) => mao.saude({ duplicatas: duplicatas === true }));
  daJanelaDoCofre('cofre:historico', (id) => mao.historico({ id: String(id), limite: 50 }));
  daJanelaDoCofre('cofre:testar', (nome) => mao.testar(String(nome)));
  daJanelaDoCofre('cofre:cadastrar', (dados, valor) => comBuffer(bufferDoTexto(valor), (buf) => mao.cadastrar(dadosDoCadastro(dados), buf)));
  daJanelaDoCofre('cofre:cadastrar-da-area', (dados) => daArea(clipboard, (buf) => mao.cadastrar(dadosDoCadastro(dados), buf)));
  daJanelaDoCofre('cofre:editar', (nome, mudancas) => mao.editar(String(nome), mudancas));
  daJanelaDoCofre('cofre:rotacionar', (nome, valor) => comBuffer(bufferDoTexto(valor), (buf) => mao.rotacionar(String(nome), buf)));
  daJanelaDoCofre('cofre:rotacionar-da-area', (nome) => daArea(clipboard, (buf) => mao.rotacionar(String(nome), buf)));
  daJanelaDoCofre('cofre:apagar', (nome) => mao.apagar(String(nome)));
  daJanelaDoCofre('cofre:restaurar', (id) => mao.restaurar(String(id)));
  daJanelaDoCofre('cofre:revelar', (nome) => revelar(mao, nome));
  daJanelaDoCofre('cofre:copiar', (nome) => mao.copiar(String(nome)));
  canais.push('cofre:resumo');
  ipcMain.handle('cofre:resumo', (evento) => (daIlha(evento) ? resumo(mao) : null));
  return canais;
}

module.exports = { registrarIpcCofre, dadosDoCadastro, textoDaArea, PRAZO_REVELADO_MS };
