'use strict';

// Janela do Overcore (22/10): separada do Actions. Lista as execuções (o que pede ele primeiro, depois o
// que roda, depois as terminadas, mais recente primeiro), com a pergunta do bloqueio e os botões. Relê a
// cada 4 s com a janela em foco. Texto da API entra escapado.
(() => {
  const ponte = window.overcore;
  const lista = document.getElementById('lista');
  const led = document.getElementById('led');
  const status = document.getElementById('status');
  const busca = document.getElementById('busca');
  const chips = [...document.querySelectorAll('#filtros .chip')];
  let dados = null;
  let filtro = 'todas';
  let aviso = '';
  let erro = null;
  const detalhes = new Map();

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ms = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : 0; };
  const hora = (t) => (t ? new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
  const ESTADO = { accepted: 'aceita', ready: 'pronta para rodar', verifying: 'verificando', admitted: 'admitida', planning: 'planejando', running: 'rodando', blocked: 'pede você', cancelling: 'cancelando', succeeded: 'concluída', failed: 'falhou', cancelled: 'cancelada' };
  const FILTRO = {
    ativas: (e) => !e.terminal && !e.needsAnswer,
    pede: (e) => e.needsAnswer,
    terminadas: (e) => e.terminal,
    todas: () => true,
  };
  const peso = (e) => (e.needsAnswer ? 0 : !e.terminal ? 1 : 2);

  function cartao(e) {
    const b = e.block;
    const d = detalhes.get(e.executionId);
    const pergunta = b ? `<div class="pergunta">${esc(b.question || 'precisa de você')}${(b.options || []).length ? `<ul>${b.options.map((o) => `<li>${esc(o.label || o.description || o.id)}</li>`).join('')}</ul>` : ''}</div>` : '';
    const acoes = [
      b?.answer?.resume ? `<button class="bt forte" data-faz="retomar" data-id="${esc(e.executionId)}">liberei, pode retomar</button>` : '',
      !e.terminal ? `<button class="bt perigo" data-faz="cancelar" data-id="${esc(e.executionId)}">cancelar</button>` : '',
      `<button class="bt" data-faz="detalhe" data-id="${esc(e.executionId)}">${d ? 'fechar detalhe' : 'detalhe'}</button>`,
    ].join('');
    const det = d ? `<div class="detalhe">${d.erro ? esc(d.erro) : `
      <ol>${(d.transitions || []).map((t) => `<li><time>${hora(ms(t.at))}</time>${esc(ESTADO[t.to] || t.to)} <span style="color:var(--tinta-3)">(${esc(t.triggerKind || '')})</span></li>`).join('')}</ol>
      ${(d.evidence || []).length ? `<ul>${d.evidence.map((v) => `<li>${esc(v.summary)}</li>`).join('')}</ul>` : ''}`}</div>` : '';
    return `<article class="exec${e.needsAnswer ? ' pede' : ''}">
      <header><h3 title="${esc(e.title)}">${esc(e.title)}</h3><span class="estado e-${esc(e.state)}">${esc(ESTADO[e.state] || e.state)}</span></header>
      <div class="onde">${esc(e.kind)} · ${esc(e.repository?.uri || '')}${e.repository?.targetBranch ? ` → ${esc(e.repository.targetBranch)}` : ''} · ${esc(e.currentStep || '')}${(e.activeExecutors || []).length ? ` · agentes: ${esc(e.activeExecutors.join(', '))}` : ''} · ${hora(ms(e.lastActivityAt))}</div>
      ${e.resultSummary ? `<div class="resumo">${esc(e.resultSummary)}</div>` : ''}
      ${pergunta}<div class="acoes">${acoes}</div>${det}
      ${erro?.id === e.executionId ? `<div class="erro">${esc(erro.texto)}</div>` : ''}
    </article>`;
  }

  function desenhar() {
    if (!dados) { lista.innerHTML = '<div class="vazio">Lendo o Overcore…</div>'; return; }
    led.classList.toggle('no-ar', !!dados.ok);
    status.textContent = dados.ok ? `no ar · porta ${dados.runtime?.porta} · desde ${hora(ms(dados.runtime?.desde))}` : (dados.erro || 'indisponível');
    const todas = dados.executions || [];
    for (const c of chips) {
      c.classList.toggle('ativa', c.dataset.filtro === filtro);
      const n = todas.filter(FILTRO[c.dataset.filtro]).length;
      c.innerHTML = `${esc(c.dataset.filtro === 'ativas' ? 'em andamento' : c.dataset.filtro === 'pede' ? 'pede você' : c.dataset.filtro)}<span class="n">${n}</span>`;
    }
    const f = busca.value.trim().toLowerCase();
    const vis = todas.filter(FILTRO[filtro]).filter((e) => !f || `${e.title} ${e.state} ${e.repository?.uri} ${e.resultSummary}`.toLowerCase().includes(f))
      .sort((a, b) => peso(a) - peso(b) || ms(b.lastActivityAt) - ms(a.lastActivityAt));
    const topo = dados.ok ? '' : `<div class="acoes">${dados.desligado ? '<button class="bt forte" data-faz="ligar">ligar o Overcore</button>' : ''}</div>`;
    lista.innerHTML = `${topo}${aviso ? `<div class="aviso">${esc(aviso)}</div>` : ''}${vis.map(cartao).join('') || `<div class="vazio">${dados.ok ? (todas.length ? 'Nada neste filtro.' : 'Nenhuma execução ainda.') : ''}</div>`}`;
  }

  async function carregar() {
    try { dados = await ponte.lista(); } catch { dados = { ok: false, erro: 'não consegui ler o Overcore' }; }
    desenhar();
  }

  lista.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-faz]');
    if (!b) return;
    const { faz, id } = b.dataset;
    if (faz === 'ligar') { const r = await ponte.ligar(); aviso = r?.ok ? (r.aviso || 'ligando') : (r?.erro || 'não consegui ligar'); desenhar(); setTimeout(carregar, 22000); return; }
    if (faz === 'detalhe') {
      if (detalhes.has(id)) detalhes.delete(id);
      else { const r = await ponte.acao('detalhe', id); detalhes.set(id, r?.ok ? r.execucao : { erro: r?.erro || 'sem detalhe' }); }
      desenhar();
      return;
    }
    const r = await ponte.acao(faz, id);
    erro = r?.ok ? null : { id, texto: r?.erro || 'o Overcore recusou' };
    aviso = r?.ok && r.aviso ? r.aviso : '';
    await carregar();
  });
  for (const c of chips) c.addEventListener('click', () => { filtro = c.dataset.filtro; desenhar(); });
  busca.addEventListener('input', desenhar);
  window.addEventListener('focus', carregar);
  setInterval(() => { if (document.hasFocus()) carregar(); }, 4000);
  window.omniOvercoreDepurar = () => ({ dados, filtro, erro });
  carregar();
})();
