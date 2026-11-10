'use strict';

// Plano 4c: o pareador da ilha. Roda servicos/whatsapp/omni/parear.mjs em três passos, na ordem do §4.1
// (pessoal → bot → fechar), um processo por vez, e pausa depois de cada passo bem-sucedido até a janela
// pedir o seguinte com continuar(): é assim que a janela explica o papel do número antes do próximo QR.
// O filho fala por linhas JSON no stdout; só passa para a janela o que está na lista fechada abaixo, com
// tipos conferidos, e o papel é sempre o do passo em curso. Chave nenhuma sai daqui.
//   criarPareador({ gerar, node, script, env, enviar, chaveStdin? }) → { iniciar(desde?), continuar(), cancelar(), estado() }
//   gerar(node, args, opcoes) → processo-filho (o spawn, injetado); enviar(evento) → janela
const PASSOS = ['pessoal', 'bot', 'fechar'];
const LIMITE_LINHA = 1024 * 1024;
const QR_PNG = 'data:image/png;base64,';
const EVENTOS = new Set(['sessao', 'qr', 'estado', 'pareado', 'fechado', 'fim']);

const mascarar = (t) => String(t).replace(/\d{8,}/g, (n) => `…${n.slice(-4)}`);
const texto = (v, max) => (typeof v === 'string' && v.length <= max ? v : undefined);

// devolve o evento limpo, ou null quando nada dele pode chegar à janela
function filtrar(bruto, papel) {
  if (!bruto || typeof bruto !== 'object' || !EVENTOS.has(bruto.evento)) return null;
  const e = { evento: bruto.evento, papel };
  if (bruto.evento === 'qr') {
    if (typeof bruto.qr !== 'string' || !bruto.qr.startsWith(QR_PNG) || !/^[A-Za-z0-9+/=]*$/.test(bruto.qr.slice(QR_PNG.length))) return null;
    e.qr = bruto.qr;
  }
  const estado = texto(bruto.estado, 40);
  if (estado && /^[a-z_]+$/.test(estado)) e.estado = estado;
  if (typeof bruto.fone4 === 'string' && /^\d{4}$/.test(bruto.fone4)) e.fone4 = bruto.fone4;
  if (typeof bruto.ok === 'boolean') e.ok = bruto.ok;
  const motivo = texto(bruto.motivo, 40);
  if (motivo && /^[a-z-]+$/.test(motivo)) e.motivo = motivo;
  const detalhe = texto(bruto.detalhe, 400);
  if (detalhe) e.detalhe = mascarar(detalhe).slice(0, 200);
  const s = bruto.soLeitura;
  if (bruto.evento === 'fechado' && s && typeof s === 'object') {
    e.soLeitura = {
      ok: s.ok === true,
      recusas: Number.isInteger(s.recusas) && s.recusas >= 0 ? s.recusas : 0,
      falhas: Array.isArray(s.falhas) ? s.falhas.filter((f) => typeof f === 'string').slice(0, 20).map((f) => mascarar(f).slice(0, 100)) : [],
    };
  }
  return e;
}

function criarPareador({ gerar, node, script, env = {}, enviar, chaveStdin = null }) {
  const envFilho = { ...env };
  delete envFilho.OMNI_API_TOKEN;

  let atual = null;      // { processo, papel, fim, erro }
  let proximo = null;    // passo que espera o continuar()
  let pedido = false;    // continuar() chegou antes do processo fechar

  function rodar(papel) {
    proximo = null;
    pedido = false;
    const args = [script, '--papel', papel, '--json', ...(chaveStdin ? ['--chave-stdin'] : [])];
    const passo = { papel, fim: null, erro: false, cancelado: false };
    const processo = gerar(node, args, { env: envFilho, windowsHide: true, stdio: [chaveStdin ? 'pipe' : 'ignore', 'pipe', 'ignore'] });
    passo.processo = processo;
    atual = passo;

    let acumulado = '';
    let descartando = false;
    const linha = (l) => {
      if (passo.cancelado || !l.trim()) return;
      let bruto;
      try { bruto = JSON.parse(l); } catch { return; }
      const e = filtrar(bruto, papel);
      if (!e) return;
      if (e.evento === 'fim') {
        if (passo.fim) return;
        passo.fim = e;
      }
      enviar(e);
    };
    processo.stdout.on('data', (pedaco) => {
      let resto = acumulado + pedaco.toString('utf8');
      let i;
      while ((i = resto.indexOf('\n')) >= 0) {
        const l = resto.slice(0, i);
        resto = resto.slice(i + 1);
        if (descartando) { descartando = false; continue; }
        linha(l);
      }
      if (resto.length > LIMITE_LINHA) { descartando = true; resto = ''; }
      acumulado = descartando ? '' : resto;
    });
    processo.once('error', () => { passo.erro = true; });
    processo.once('close', () => {
      if (!descartando && acumulado) linha(acumulado);
      acumulado = '';
      if (atual === passo) atual = null;
      if (passo.cancelado) return;
      if (!passo.fim) {
        passo.fim = { evento: 'fim', papel, ok: false, motivo: passo.erro ? 'sem-node' : 'saiu' };
        enviar(passo.fim);
      }
      if (passo.fim.ok !== true) return;
      const seguinte = PASSOS[PASSOS.indexOf(papel) + 1] || null;
      proximo = seguinte;
      if (seguinte && pedido) rodar(seguinte);
    });
    if (chaveStdin && processo.stdin) processo.stdin.end(`${chaveStdin}\n`);
  }

  return {
    iniciar(desde = 'pessoal') {
      if (atual || !PASSOS.includes(desde)) return false;
      rodar(desde);
      return true;
    },
    // pede o passo seguinte; se o atual ainda não fechou, ele nasce quando fechar
    continuar() {
      if (atual && atual.fim && atual.fim.ok === true && PASSOS.indexOf(atual.papel) < PASSOS.length - 1) { pedido = true; return true; }
      if (atual || !proximo) return false;
      rodar(proximo);
      return true;
    },
    cancelar() {
      proximo = null;
      pedido = false;
      if (!atual) return;
      const passo = atual;
      passo.cancelado = true;
      atual = null;
      try { passo.processo.kill(); } catch { /* já saiu */ }
    },
    estado() {
      return { rodando: !!atual, papel: atual ? atual.papel : null, proximo };
    },
  };
}

// A janela só sabe dizer "quero o passo X". Daqui sai iniciar() ou continuar(): o mesmo passo já rodando
// responde sim sem outro processo; o seguinte ao que ainda roda espera ele fechar; pular passo é recusado.
// Parado, é sempre iniciar(passo): ele recusa passo desconhecido e faz o mesmo que o continuar().
function pedirPasso(pareador, passo) {
  const { rodando, papel } = pareador.estado();
  if (!rodando) return pareador.iniciar(passo);
  if (papel === passo) return true;
  return PASSOS[PASSOS.indexOf(papel) + 1] === passo ? pareador.continuar() : false;
}

module.exports = { criarPareador, filtrar, pedirPasso };
