'use strict';

// O card do cofre na ilha (F1, plano 5, T7): quando ler o resumo e o que mostrar, sem DOM. O renderer só
// desenha o que este módulo decide. Cada leitura abre um Node com a CLI do cofre, então o card nunca lê no
// relógio de 2 s da ilha: lê ao abrir a forma (no máximo uma vez por minuto) e, com ela aberta, a cada 5 min.
// Roda no Node (a suíte CC) e no renderer, que o carrega por <script> antes do renderer.js (window.cofreCard).
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.cofreCard = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  const INTERVALO_MS = 5 * 60 * 1000;
  const PISO_ABERTURA_MS = 60 * 1000;
  const MAX_LINHAS = 2;
  const ROTULO_REGRA = { vence: 'vence', 'teste-falhou': 'teste falhou', 'sem-uso': 'sem uso', 'agente-nunca-usou': 'agente parado' };
  // os códigos da mão (cofre.js); o texto inteiro do erro vai no title e na linha do card
  const DETALHE_ERRO = { 'sem-node': 'sem Node', tempo: 'sem resposta', teto: 'resposta grande', falha: 'falhou', uso: 'pedido recusado', ilegivel: 'resposta ilegível' };

  // motivo: 'abriu' (a forma acabou de abrir) ou 'relogio' (o relógio de 2 s da ilha aberta).
  function deveLer({ agora, lidoEm, lendo, motivo }) {
    if (lendo) return false;
    if (lidoEm == null) return true;
    const idade = agora - lidoEm;
    if (!(idade >= 0)) return true; // o relógio voltou: lê de novo em vez de esperar um prazo que não fecha
    return idade >= (motivo === 'abriu' ? PISO_ABERTURA_MS : INTERVALO_MS);
  }

  function vistaDoCard(r) {
    if (!r || !r.ok) {
      const codigo = String((r && r.codigo) || '');
      return { estado: 'erro', numero: '–', rotulo: 'CREDENCIAIS', detalhe: DETALHE_ERRO[codigo] || 'sem leitura', erro: String((r && r.erro) || ''), linhas: [] };
    }
    const total = Number(r.total) || 0;
    const alertas = Number(r.alertas) || 0;
    const primeiros = Array.isArray(r.primeiros) ? r.primeiros : [];
    return {
      estado: alertas > 0 ? 'alerta' : 'ok',
      numero: String(total),
      rotulo: total === 1 ? 'CREDENCIAL' : 'CREDENCIAIS',
      detalhe: alertas === 0 ? 'nada a olhar' : alertas === 1 ? '1 alerta' : `${alertas} alertas`,
      erro: '',
      linhas: primeiros.slice(0, MAX_LINHAS).map(({ regra, nome }) => ({ nome: String(nome), regra: ROTULO_REGRA[regra] || String(regra) })),
    };
  }

  return { INTERVALO_MS, PISO_ABERTURA_MS, MAX_LINHAS, ROTULO_REGRA, DETALHE_ERRO, deveLer, vistaDoCard };
});
