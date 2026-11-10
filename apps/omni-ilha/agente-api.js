'use strict';

// O porteiro do IPC agente:api (F2, plano 4b). A janela de um agente só fala com aquele agente: o main
// passa o `permitido` tirado da janela que pediu, nunca do que o renderer declara. O pedido vai à casa
// como POST /v1/agentes/<agente>/chamar, que confere a rota no manifesto e põe o token tela. A volta é
// sempre { status, corpo }; status 0 quer dizer que nada chegou ao agente (recusa aqui ou na casa).

const NOME = /^[a-z][a-z0-9-]{0,39}$/;
const METODOS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);
const ROTA = /^\/(?!\/)[\x21-\x7e]{0,2047}$/;
const LIMITE_CORPO = 60 * 1024;

const recusa = (erro) => ({ status: 0, corpo: { ok: false, erro } });

function validar(entrada, permitido) {
  if (typeof permitido !== 'string' || !NOME.test(permitido)) return 'esta janela não pertence a nenhum agente';
  if (entrada === null || typeof entrada !== 'object' || Array.isArray(entrada)) return 'o pedido precisa ser um objeto';
  if (entrada.agente !== permitido) return 'esta janela só fala com o próprio agente';
  if (!METODOS.has(entrada.metodo)) return 'método não aceito';
  if (typeof entrada.rota !== 'string' || !ROTA.test(entrada.rota)) return 'rota fora do formato';
  const corpo = entrada.corpo;
  if (corpo === null || corpo === undefined) return null;
  if (typeof corpo !== 'object') return 'o corpo precisa ser um objeto JSON';
  let texto;
  try { texto = JSON.stringify(corpo); } catch { return 'o corpo não vira JSON'; }
  if (Buffer.byteLength(texto) > LIMITE_CORPO) return `corpo acima de ${LIMITE_CORPO} bytes`;
  return null;
}

function criarAgenteApi({ chamar }) {
  async function pedir(entrada, { permitido } = {}) {
    const problema = validar(entrada, permitido);
    if (problema) return recusa(problema);
    const envio = { metodo: entrada.metodo, rota: entrada.rota };
    if (entrada.corpo !== null && entrada.corpo !== undefined) envio.corpo = entrada.corpo;
    let r;
    try {
      r = await chamar('POST', `/v1/agentes/${entrada.agente}/chamar`, envio);
    } catch {
      return recusa('a casa falhou ao repassar o pedido');
    }
    if (r && r.status === 200 && r.corpo && Number.isInteger(r.corpo.status)) return { status: r.corpo.status, corpo: r.corpo.corpo ?? null };
    const erro = r && r.corpo && typeof r.corpo.erro === 'string' ? r.corpo.erro : `a casa respondeu ${r ? r.status : 'nada'}`;
    return recusa(erro);
  }
  return { pedir };
}

module.exports = { criarAgenteApi, LIMITE_CORPO, NOME };
