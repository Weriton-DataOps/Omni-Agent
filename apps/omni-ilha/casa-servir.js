'use strict';

// A ilha sobe a casa (F2, plano 4b). O Electron 33 da ilha não abre banco (§3.4 do desenho): quem serve
// o omni.db, o nucleo.db e o cofre.db é o runtime/servir.mjs, num processo à parte com o Node do sistema
// (OMNI_NODE ou o do PATH), conferido pela mesma sonda do cofre. O token da API nasce aqui, aleatório a
// cada subida, e vive só neste processo: não vai ao renderer, ao estado() nem a log.
// O servir sai sozinho quando o stdin fecha, então a morte da ilha leva a casa junto.

const childProcess = require('child_process');
const crypto = require('crypto');
const http = require('http');
const path = require('path');

const { AVISO, SONDA, falhaDaSonda } = require('./cofre.js');

const LIMITE_SUBIDA = 15000;
const LIMITE_PEDIDO = 30000;
const LIMITE_SONDA = 15000;
const TETO_RESPOSTA = 2 * 1024 * 1024;
const TETO_LINHA = 4096;

function criarCasa({ spawn = childProcess.spawn, env = process.env, raiz = path.join(__dirname, '..', '..'), limiteMs = LIMITE_SUBIDA, pedidoMs = LIMITE_PEDIDO } = {}) {
  const node = env.OMNI_NODE || 'node';
  const origem = env.OMNI_NODE ? 'o OMNI_NODE' : 'o node do PATH';
  const servir = path.join(raiz, 'runtime', 'servir.mjs');
  const envBase = { ...env };
  delete envBase.ELECTRON_RUN_AS_NODE;
  delete envBase.OMNI_API_TOKEN;
  const envSonda = { ...envBase, ELECTRON_RUN_AS_NODE: '1' };

  let sondaBoa = false;
  let subindo = null;          // promessa memoizada de iniciar()
  let filho = null;
  let porta = null;
  let token = null;
  let erro = null;

  function sondar() {
    return new Promise((resolver) => {
      const saida = [];
      let motivo = null; let acabou = false; let p = null;
      const acabar = (codigo) => { if (acabou) return; acabou = true; clearTimeout(prazo); resolver({ codigo, motivo, stdout: Buffer.concat(saida).toString('utf8') }); };
      const prazo = setTimeout(() => { motivo = 'tempo'; try { p.kill(); } catch { /* já saiu */ } }, LIMITE_SONDA);
      try {
        p = spawn(node, ['-e', SONDA], { env: envSonda, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch { motivo = 'nao-abriu'; acabar(null); return; }
      p.stdout.on('data', (pedaco) => { if (saida.length < 16) saida.push(pedaco); });
      p.stderr.on('data', () => { /* a sonda não tem o que dizer no stderr */ });
      p.once('error', () => { motivo ??= 'sem-node'; acabar(null); });
      p.once('close', (codigo) => acabar(codigo));
    });
  }

  function subir() {
    return new Promise((resolver) => {
      const novoToken = crypto.randomBytes(32).toString('base64url');
      let linha = '';
      let respondeu = false;
      let p;
      const responder = (r) => {
        if (respondeu) return;
        respondeu = true;
        clearTimeout(prazo);
        if (r.ok) { filho = p; porta = r.porta; token = novoToken; erro = null; } else { erro = r.erro; }
        resolver(r);
      };
      const prazo = setTimeout(() => {
        responder({ ok: false, erro: `a casa não respondeu em ${limiteMs / 1000} s` });
        try { p.kill(); } catch { /* já saiu */ }
      }, limiteMs);
      try {
        p = spawn(node, [AVISO, servir, '--porta', '0'], {
          env: { ...envBase, OMNI_API_TOKEN: novoToken }, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch {
        responder({ ok: false, erro: 'não consegui abrir o processo da casa' });
        return;
      }
      p.stdin.on('error', () => { /* a casa saiu: o close diz o porquê */ });
      p.stderr.on('data', () => { /* o log da casa fica com ela; a ilha não guarda */ });
      p.stdout.on('data', (pedaco) => {
        if (respondeu) return;   // depois da 1ª linha, o stdout é drenado e ignorado
        linha += pedaco.toString('utf8');
        const fim = linha.indexOf('\n');
        if (fim < 0) {
          if (linha.length > TETO_LINHA) responder({ ok: false, erro: 'a 1ª linha da casa veio grande demais' });
          return;
        }
        let r;
        try { r = JSON.parse(linha.slice(0, fim)); } catch { r = null; }
        if (r && r.ok === true && Number.isInteger(r.porta) && r.porta > 0 && r.porta < 65536) responder({ ok: true, porta: r.porta });
        else responder({ ok: false, erro: r && typeof r.erro === 'string' ? r.erro.slice(0, 300) : 'a 1ª linha da casa veio ilegível' });
      });
      p.once('error', () => responder({ ok: false, erro: `não achei o Node do sistema (${origem})` }));
      p.once('close', (codigo, sinal) => {
        responder({ ok: false, erro: `a casa saiu com ${codigo ?? sinal} antes de responder` });
        if (filho === p) {
          filho = null; porta = null; token = null;
          erro = `a casa saiu com ${codigo ?? sinal}`;
          subindo = null;
        }
      });
    });
  }

  async function iniciarUmaVez() {
    if (!sondaBoa) {
      const falha = falhaDaSonda(await sondar(), origem, 'a casa');
      if (falha) { erro = falha.erro; return { ok: false, erro: falha.erro }; }
      sondaBoa = true;
    }
    return subir();
  }

  function iniciar() {
    subindo ??= iniciarUmaVez().then((r) => {
      if (!r.ok) subindo = null;
      return r;
    });
    return subindo;
  }

  function pedir(metodo, rota, corpo) {
    return new Promise((resolver) => {
      const texto = corpo === undefined ? null : JSON.stringify(corpo);
      const cabecalhos = { authorization: `Bearer ${token}`, accept: 'application/json' };
      if (texto !== null) Object.assign(cabecalhos, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(texto) });
      const falhou = (motivo) => resolver({ status: 0, corpo: { ok: false, erro: motivo } });
      const req = http.request({ host: '127.0.0.1', port: porta, method: metodo, path: rota, headers: cabecalhos, timeout: pedidoMs }, (res) => {
        const partes = [];
        let total = 0;
        res.on('data', (pedaco) => {
          total += pedaco.length;
          if (total > TETO_RESPOSTA) { req.destroy(); falhou('a resposta da casa passou do tamanho esperado'); return; }
          partes.push(pedaco);
        });
        res.on('end', () => {
          if (total > TETO_RESPOSTA) return;
          const bruto = Buffer.concat(partes).toString('utf8');
          let dados;
          try { dados = bruto === '' ? null : JSON.parse(bruto); } catch { falhou('a resposta da casa veio ilegível'); return; }
          resolver({ status: res.statusCode, corpo: dados });
        });
        res.on('error', () => falhou('a resposta da casa foi cortada'));
      });
      req.on('timeout', () => { req.destroy(); falhou(`a casa não respondeu em ${pedidoMs / 1000} s`); });
      req.on('error', () => falhou('a casa não atendeu'));
      req.end(texto ?? undefined);
    });
  }

  async function chamar(metodo, rota, corpo) {
    const r = await iniciar();
    if (!r.ok) return { status: 0, corpo: { ok: false, erro: r.erro } };
    return pedir(metodo, rota, corpo);
  }

  function parar() {
    const p = filho;
    subindo = null;
    if (!p || p.exitCode !== null) { filho = null; porta = null; token = null; return Promise.resolve(p ? p.exitCode : null); }
    return new Promise((resolver) => {
      const prazo = setTimeout(() => { try { p.kill(); } catch { /* já saiu */ } }, 5000);
      p.once('close', (codigo) => { clearTimeout(prazo); resolver(codigo); });
      try { p.stdin.end(); } catch { /* stdin já fechado */ }
    }).finally(() => {
      if (filho === p) { filho = null; porta = null; token = null; }
    });
  }

  const estado = () => ({ porta, pid: filho ? filho.pid ?? null : null, erro });

  return { iniciar, chamar, parar, estado };
}

module.exports = { criarCasa, LIMITE_SUBIDA, LIMITE_PEDIDO };
