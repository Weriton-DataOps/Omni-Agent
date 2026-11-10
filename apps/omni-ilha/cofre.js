'use strict';

// A mão do cofre na ilha (F1, plano 5). A ilha não abre o banco (§3.4 do desenho): cada pedido roda a
// CLI runtime/cofre.mjs num processo à parte, com o Node do sistema, porque o Electron da ilha é o 33,
// com Node 20 e sem node:sqlite. O Node vem do OMNI_NODE ou do PATH, nunca do process.execPath. Uma
// sonda confere, uma vez por sessão, que ele é o 22.13 ou mais novo e que não é um Electron; a sonda
// que falha é refeita no pedido seguinte. As respostas têm a forma que as rotas /v1/cofre/* da F2 vão
// manter: { ok: true, dados } ou { ok: false, codigo, erro }.
// Segredo: o valor do cadastro e da rotação vai pelo stdin, e os Buffers são zerados; o revelado chega
// só pelo descritor 3 e volta só a quem chamou revelar, e só com a saída 0. Nenhum caminho põe valor em
// argumento, em log ou em mensagem de erro.

const childProcess = require('child_process');
const path = require('path');

const CLI = path.join(__dirname, '..', '..', 'runtime', 'cofre.mjs');
const LIMITES = { curto: 15000, medio: 30000, longo: 90000 };
const TETOS = { saida: 1024 * 1024, erro: 8 * 1024, valor: 1024 * 1024 };
const AVISO = '--disable-warning=ExperimentalWarning';   // o aviso do node:sqlite ocuparia a 1ª linha do stderr
const SONDA = 'process.stdout.write(JSON.stringify({node:process.versions.node,electron:process.versions.electron??null}))';

function versaoServe(versao) {
  const partes = /^(\d+)\.(\d+)\.\d+$/.exec(String(versao));
  if (!partes) return false;
  const maior = Number(partes[1]);
  const menor = Number(partes[2]);
  return maior > 22 || (maior === 22 && menor >= 13);
}

function lerJson(texto) { try { return JSON.parse(texto); } catch { return undefined; } }
function primeiraLinha(texto) { return String(texto).split(/\r?\n/)[0].slice(0, 300); }
const ilegivel = () => ({ ok: false, codigo: 'ilegivel', erro: 'a resposta do cofre veio ilegível' });

// --chave=valor num argumento só: um valor que começa com - não vira opção no parseArgs da CLI.
function opcoes(pares) {
  const args = [];
  for (const [chave, valor] of pares) if (valor !== undefined && valor !== null) args.push(`--${chave}=${valor}`);
  return args;
}

function valorDeUmaLinha(valor) {
  return Buffer.isBuffer(valor) && valor.length > 0 && !valor.includes(10) && !valor.includes(13);
}

// A mesma sonda serve à casa (casa-servir.js, plano 4b): só muda quem pede o Node.
function falhaDaSonda(r, origem, quem = 'o cofre') {
  const sem = (erro) => ({ ok: false, codigo: 'sem-node', erro });
  if (r.motivo === 'sem-node' || r.motivo === 'nao-abriu') return sem(`não achei o Node do sistema (${origem})`);
  if (r.motivo !== null || r.codigo !== 0) return sem(`o Node do sistema não respondeu à sonda (${origem})`);
  const v = lerJson(r.stdout);
  if (!v || typeof v !== 'object') return sem('a sonda do Node respondeu algo ilegível');
  if (v.electron) return sem(`${origem} é um Electron; ${quem} pede o Node do sistema, 22.13 ou mais novo`);
  if (!versaoServe(v.node)) return sem(`${quem} pede o Node 22.13 ou mais novo; ${origem} é o ${String(v.node).slice(0, 20)}`);
  return null;
}

function resposta(r, ms) {
  if (r.motivo === 'tempo') return { ok: false, codigo: 'tempo', erro: `o cofre não respondeu em ${ms / 1000} s` };
  if (r.motivo === 'teto') return { ok: false, codigo: 'teto', erro: 'a resposta do cofre passou do tamanho esperado' };
  if (r.motivo === 'sem-node') return { ok: false, codigo: 'sem-node', erro: 'o Node do sistema sumiu entre a sonda e o pedido' };
  if (r.motivo === 'nao-abriu') return { ok: false, codigo: 'falha', erro: 'não consegui abrir o processo do cofre' };
  if (r.codigo === 0) {
    const dados = lerJson(r.stdout);
    return dados === undefined ? ilegivel() : { ok: true, dados };
  }
  if (r.codigo === 3) {
    const recusa = lerJson(r.stdout);
    if (recusa && recusa.ok === false && typeof recusa.codigo === 'string') return { ok: false, codigo: recusa.codigo, erro: String(recusa.erro ?? '') };
    return ilegivel();
  }
  if (r.codigo === 2) return { ok: false, codigo: 'uso', erro: primeiraLinha(r.stderr) };
  if (r.codigo === 1) return { ok: false, codigo: 'falha', erro: primeiraLinha(r.stderr) };
  return { ok: false, codigo: 'falha', erro: `o cofre saiu com ${r.codigo ?? r.sinal}` };
}

function criarMaoCofre({ spawn = childProcess.spawn, env = process.env, cli = CLI } = {}) {
  const node = env.OMNI_NODE || 'node';
  const origem = env.OMNI_NODE ? 'o OMNI_NODE' : 'o node do PATH';
  const envCli = { ...env };
  delete envCli.ELECTRON_RUN_AS_NODE;
  const envSonda = { ...envCli, ELECTRON_RUN_AS_NODE: '1' };   // um Electron no OMNI_NODE responde como Node, sem abrir janela
  let conferindo = null;

  function executar(args, { ms, envFilho = envCli, entrada = null, canal = false }) {
    return new Promise((resolver) => {
      const saida = []; const erro = []; const valor = [];
      let tamSaida = 0; let tamErro = 0; let tamValor = 0;
      let motivo = null; let acabou = false; let filho = null; let copia = null;
      const zerarValor = () => { for (const pedaco of valor) pedaco.fill(0); valor.length = 0; };
      const matar = (porque) => { motivo ??= porque; try { filho.kill(); } catch { /* já saiu */ } };
      const limite = setTimeout(() => matar('tempo'), ms);
      const acabar = (codigo, sinal) => {
        if (acabou) return;
        acabou = true;
        clearTimeout(limite);
        if (copia) copia.fill(0);
        const bytes = canal && motivo === null ? Buffer.concat(valor) : null;
        zerarValor();
        resolver({ codigo, sinal, motivo, stdout: Buffer.concat(saida).toString('utf8'), stderr: Buffer.concat(erro).toString('utf8'), valor: bytes });
      };
      try {
        filho = spawn(node, args, { env: envFilho, windowsHide: true, shell: false, stdio: [entrada ? 'pipe' : 'ignore', 'pipe', 'pipe', ...(canal ? ['pipe'] : [])] });
      } catch { motivo = 'nao-abriu'; acabar(null, null); return; }
      filho.stdout.on('data', (pedaco) => { tamSaida += pedaco.length; if (tamSaida > TETOS.saida) matar('teto'); else saida.push(pedaco); });
      filho.stderr.on('data', (pedaco) => { if (tamErro < TETOS.erro) erro.push(pedaco.subarray(0, TETOS.erro - tamErro)); tamErro += pedaco.length; });
      const doCanal = canal ? filho.stdio[3] : null;
      if (doCanal) {
        doCanal.on('data', (pedaco) => {
          if (motivo !== null) { pedaco.fill(0); return; }
          valor.push(pedaco); tamValor += pedaco.length;
          if (tamValor > TETOS.valor) { matar('teto'); zerarValor(); }
        });
      }
      if (entrada) {
        filho.stdin.on('error', () => { /* o filho saiu sem ler: a saída dele diz o porquê */ });
        copia = Buffer.concat([entrada, Buffer.from('\n')]);
        filho.stdin.end(copia);
      }
      filho.once('error', () => { motivo ??= 'sem-node'; acabar(null, null); });
      filho.once('close', (codigo, sinal) => acabar(codigo, sinal));
    });
  }

  function conferirNode() {
    conferindo ??= executar(['-e', SONDA], { ms: LIMITES.curto, envFilho: envSonda }).then((r) => {
      const falha = falhaDaSonda(r, origem);
      if (falha) conferindo = null;
      return falha;
    });
    return conferindo;
  }

  async function pedir(args, { ms = LIMITES.curto, entrada = null, canal = false } = {}) {
    const falha = await conferirNode();
    if (falha) return falha;
    const r = await executar([AVISO, cli, ...args], { ms, entrada, canal });
    const res = resposta(r, ms);
    if (r.valor) {
      if (res.ok) res.valor = r.valor;
      else r.valor.fill(0);
    }
    return res;
  }

  // O Buffer de quem chamou é zerado sempre, aceito ou não.
  async function comValor(args, valor) {
    try {
      if (!valorDeUmaLinha(valor)) return { ok: false, codigo: 'uso', erro: 'o valor precisa chegar num Buffer de uma linha, não vazio' };
      return await pedir(args, { ms: LIMITES.medio, entrada: valor });
    } finally { if (Buffer.isBuffer(valor)) valor.fill(0); }
  }

  return {
    listar: () => pedir(['listar']),
    lixeira: () => pedir(['lixeira']),
    esvaziarLixeira: () => pedir(['esvaziar-lixeira']),
    saude: ({ duplicatas = false } = {}) => (duplicatas ? pedir(['saude', '--duplicatas'], { ms: LIMITES.medio }) : pedir(['saude'])),
    historico: ({ id, nome, limite } = {}) => pedir(['historico', ...opcoes([['id', id], ['nome', nome], ['limite', limite]])]),
    testar: (nome) => pedir(['testar', ...opcoes([['nome', nome]])], { ms: LIMITES.medio }),
    cadastrar: (dados = {}, valor) => comValor(['cadastrar', ...opcoes([
      ['nome', dados.nome], ['tipo', dados.tipo], ['servico', dados.servico], ['url', dados.url], ['usuario', dados.usuario], ['notas', dados.notas],
      ['agentes', Array.isArray(dados.agentes) ? dados.agentes.join(',') : dados.agentes],
    ])], valor),
    editar: (nome, mudancas) => pedir(['editar', ...opcoes([['nome', nome], ['mudancas', mudancas === undefined ? undefined : JSON.stringify(mudancas)]])]),
    rotacionar: (nome, valor) => comValor(['rotacionar', ...opcoes([['nome', nome]])], valor),
    apagar: (nome) => pedir(['apagar', ...opcoes([['nome', nome]])]),
    restaurar: (id) => pedir(['restaurar', ...opcoes([['id', id]])]),
    revelar: (nome) => pedir(['revelar', ...opcoes([['nome', nome]])], { ms: LIMITES.longo, canal: true }),
    copiar: (nome) => pedir(['copiar', ...opcoes([['nome', nome]])], { ms: LIMITES.longo }),
  };
}

module.exports = { criarMaoCofre, versaoServe, falhaDaSonda, LIMITES, SONDA, AVISO };
