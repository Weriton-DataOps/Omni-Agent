'use strict';

// Janela Actions — mesa de decisão (21/10). Aba Ideias: à esquerda a mesa (pra você, com potencial, em
// andamento, não deram certo, última visita); à direita o ponto aberto, com os botões de veredito em cima.
// Aba Projetos: cards com checklist clicável. Toda escrita vai ao main (window.actions), que valida; aqui só
// se desenha. Texto dos pontos entra escapado; links viram texto: a janela não navega para lugar nenhum.
(() => {
  const ponte = window.actions;
  const mesaEl = document.getElementById('mesa');
  const pontoEl = document.getElementById('ponto');
  const projetosEl = document.getElementById('tela-projetos');
  const telaIdeias = document.getElementById('tela-ideias');
  const conta = document.getElementById('conta');
  const busca = document.getElementById('busca');
  const abaIdeias = document.getElementById('aba-ideias');
  const abaProjetos = document.getElementById('aba-projetos');
  const abaExecucoes = document.getElementById('aba-execucoes');
  const execsEl = document.getElementById('tela-execucoes');
  let execProjeto = null; // card de projeto com a caixa de executar aberta  let mesa = null;
  let ativo = null;
  let aba = 'ideias';
  let aberto = null; // formulário de veredito aberto: `${lugar}:${slug}:${tipo}`
  let erro = null; // { lugar, texto }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tri = (n) => '▲'.repeat(Math.max(0, Math.min(3, n)));

  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '<span class="link">$1</span>');
  }

  function markdown(texto) {
    const saida = [];
    let emLista = false;
    let codigo = null;
    const fecharLista = () => { if (emLista) { saida.push('</ul>'); emLista = false; } };
    for (const linha of texto.split(/\r?\n/)) {
      if (codigo !== null) {
        if (/^```/.test(linha)) { saida.push(`<pre>${esc(codigo.join('\n'))}</pre>`); codigo = null; } else codigo.push(linha);
        continue;
      }
      if (/^```/.test(linha)) { fecharLista(); codigo = []; continue; }
      const h = /^(#{1,3})\s+(.*)$/.exec(linha);
      if (h) { fecharLista(); saida.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
      const li = /^\s*[-*]\s+(.*)$/.exec(linha);
      if (li) { if (!emLista) { saida.push('<ul>'); emLista = true; } saida.push(`<li>${inline(li[1])}</li>`); continue; }
      if (/^\s{2,}\S/.test(linha) && emLista) { saida[saida.length - 1] = saida[saida.length - 1].replace(/<\/li>$/, ` ${inline(linha.trim())}</li>`); continue; }
      fecharLista();
      // linha em branco separa blocos: o '' impede a costura abaixo
      if (!linha.trim()) { saida.push(''); continue; }
      if (/^\|/.test(linha)) { saida.push(`<pre>${esc(linha)}</pre>`); continue; }
      const cit = /^>\s?(.*)$/.exec(linha);
      if (cit) { saida.push(cit[1].trim() ? `<blockquote>${inline(cit[1])}</blockquote>` : ''); continue; }
      // os campos do cabeçalho (**Status:**, **Aberto em:** ...) ficam um por linha, fora da costura
      if (/^\*\*[^*]+:\*\*/.test(linha)) { saida.push(`<div class="cab">${inline(linha)}</div>`); continue; }
      saida.push(`<p>${inline(linha)}</p>`);
    }
    fecharLista();
    if (codigo) saida.push(`<pre>${esc(codigo.join('\n'))}</pre>`);
    // os pontos são escritos com quebra manual: linhas seguidas do mesmo bloco viram um bloco só
    return saida.join('\n')
      .replace(/<\/pre>\n<pre>/g, '\n')
      .replace(/<\/p>\n<p>/g, ' ')
      .replace(/<\/blockquote>\n<blockquote>/g, ' ');
  }

  // ── veredito: os quatro botões e o formulário de cada um ──────────────────────────────────────────
  const daquiA = (dias) => { const d = new Date(Date.now() + dias * 86400e3); return d.toISOString().slice(0, 10); };
  const paraBr = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
  // "arquivar — porque X" → "porque X": a proposta da visita já vem como motivo
  const motivoDa = (proposta) => String(proposta || '').split(/\s+—\s+/).slice(1).join(' — ').trim();

  function botoesVeredito(lugar, slug, proposta) {
    const chave = (t) => `${lugar}:${slug}:${t}`;
    const b = (t, rotulo, classe = '') => `<button class="bt ${classe}" data-acao="abrir-veredito" data-slug="${esc(slug)}" data-lugar="${esc(lugar)}" data-tipo="${t}">${rotulo}</button>`;
    let html = `<div class="acoes">${b('projeto', 'vira projeto', 'forte')}${b('entra', 'entra em…', 'forte')}${b('arquivado', 'arquiva', 'perigo')}${b('dormente', 'dorme')}</div>`;
    const tipo = ['projeto', 'entra', 'arquivado', 'dormente'].find((t) => aberto === chave(t));
    if (tipo) {
      const motivo = esc(motivoDa(proposta));
      const projetos = (mesa?.projetos || []).map((p) => `<option>${esc(p.nome)}</option>`).join('');
      const campos = {
        projeto: `<input data-campo="motivo" placeholder="por quê (opcional)" value="${motivo}">`,
        entra: `<select data-campo="projeto">${projetos}</select><input data-campo="motivo" placeholder="por quê (opcional)" value="${motivo}">`,
        arquivado: `<input data-campo="motivo" placeholder="motivo (obrigatório)" value="${motivo}">`,
        dormente: `<input type="date" data-campo="ate" value="${daquiA(30)}"><input data-campo="motivo" placeholder="por quê (opcional)" value="${motivo}">`,
      }[tipo];
      html += `<div class="form" data-slug="${esc(slug)}" data-tipo="${tipo}">${campos}<button class="bt forte" data-acao="confirmar-veredito">confirmar</button><button class="bt" data-acao="fechar-veredito">cancelar</button></div>`;
    }
    if (erro?.lugar === lugar && erro.slug === slug) html += `<div class="erro">${esc(erro.texto)}</div>`;
    return html;
  }

  // ── executar: a caixa onde ele diz o que fazer e como conduzir. Quem monta o pedido é o Omni (despacho),
  // e o trabalho vai para a sessão do VS Code aberta na pasta do projeto (o Overcore, quando estiver pronto).
  function caixaExecutar(lugar, { slug = '', projeto = '' }, dica) {
    const k = `${lugar}:${slug}:${projeto}`;
    return `<div class="executar" data-exec="${esc(k)}">
      <textarea data-exec-texto placeholder="O que fazer e como conduzir — aprovar, ajustar o sugerido ou dizer o caminho"></textarea>
      <div class="linha-bt"><button class="bt forte" data-acao="executar" data-slug="${esc(slug)}" data-projeto="${esc(projeto)}" data-lugar="${esc(k)}">mandar executar</button>
      <span class="dica">${esc(dica)}</span></div>
      ${erro?.lugar === k ? `<div class="erro">${esc(erro.texto)}</div>` : ''}</div>`;
  }
  const ondeRoda = (projeto) => {
    const pr = (mesa?.projetos || []).find((p) => p.nome === projeto);
    return pr?.pasta ? `roda numa sessão aberta em ${pr.pasta}` : 'roda na sessão aberta do Actions/Omni';
  };

  // ── a mesa ─────────────────────────────────────────────────────────────────────────────────────────
  const ROTULO = { veredito: 'veredito', teste: 'pra olhar', entrega: 'entrega vencida', 'item-proposto': 'item proposto', conserto: 'conserto', execucao: 'execução', 'execucao-ok': 'execução' };
  const bate = (...partes) => { const f = busca.value.trim().toLowerCase(); return !f || partes.join(' ').toLowerCase().includes(f); };

  // ── período e ordem (22/10: "quero ver o que mandei hoje"). Lembrados por janela (localStorage).
  let { periodo = 'tudo', ordem = 'novos' } = (() => { try { return JSON.parse(localStorage.getItem('actions-filtro')) || {}; } catch { return {}; } })();
  const lembrar = () => { try { localStorage.setItem('actions-filtro', JSON.stringify({ periodo, ordem })); } catch { /* sem storage */ } };
  const brMs = (d) => { const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(d || ''); return m ? new Date(+m[3], +m[2] - 1, +m[1]).getTime() : null; };
  const hoje0 = () => new Date().setHours(0, 0, 0, 0);
  const novo = (p) => { const ab = brMs(p?.abertoEm); return ab !== null && ab >= hoje0() - 864e5; }; // chegou hoje ou ontem
  function noPeriodo(p, quando) {
    if (periodo === 'tudo') return true;
    if (!p && !quando) return false; // sem data não entra em período nenhum
    const ab = brMs(p?.abertoEm);
    if (periodo === 'hoje') return p ? ab !== null && ab >= hoje0() : (quando || 0) >= hoje0();
    if (periodo === 'semana') return p ? ab !== null && ab >= hoje0() - 6 * 864e5 : (quando || 0) >= hoje0() - 6 * 864e5;
    return ((p ? p.alteradoEm : quando) || 0) >= hoje0(); // mexido hoje
  }
  const CHAVE = {
    novos: (p) => -((brMs(p.abertoEm) || 0) + (p.alteradoEm || 0) / 1e13),
    mexidos: (p) => -(p.alteradoEm || 0),
    prazo: (p) => (p.diasParaPrazo ?? 1e9),
    potencial: (p) => -(p.potencial?.nivel || 0) * 1e13 - (p.alteradoEm || 0) / 1e3,
  };
  if (!(ordem in CHAVE)) ordem = 'novos';
  if (!['hoje', 'mexido', 'semana', 'tudo'].includes(periodo)) periodo = 'tudo';
  const ordenar = (lista) => [...lista].sort((a, b) => CHAVE[ordem](a) - CHAVE[ordem](b));
  const selo = (p) => (novo(p) ? '<span class="novo">NOVO</span>' : '');

  function cartaoPedido(p, i) {
    const abre = p.slug ? ` data-abre="${esc(p.slug)}"` : '';
    let acoes = '';
    if (p.tipo === 'veredito') acoes = botoesVeredito('mesa', p.slug, p.proposta);
    else if (p.tipo === 'teste') acoes = `<div class="acoes"><button class="bt" data-abre-bt="${esc(p.slug)}">ver</button><button class="bt forte" data-acao="visto" data-slug="${esc(p.slug)}">já olhei</button></div>`;
    else if (p.tipo === 'entrega') acoes = `<div class="acoes"><button class="bt forte" data-acao="item" data-i="${i}" data-faz="marcar">feito</button><button class="bt" data-aba-bt="projetos">ver projeto</button></div>`;
    else if (p.tipo === 'item-proposto') acoes = `<div class="acoes"><button class="bt forte" data-acao="item" data-i="${i}" data-faz="aceitar">aceitar</button><button class="bt perigo" data-acao="item" data-i="${i}" data-faz="recusar">recusar</button></div>`;
    else if (p.tipo === 'execucao-ok') acoes = `<div class="acoes"><button class="bt" data-aba-bt="execucoes">ver</button><button class="bt forte" data-acao="exec-vista" data-id="${esc(p.execucao)}">já olhei</button></div>`;
    else if (p.tipo === 'execucao' && p.estadoExecucao === 'bloqueada') acoes = respostaExec(p.execucao);
    else if (p.tipo === 'execucao') acoes = `<div class="acoes"><button class="bt forte" data-acao="reenviar" data-id="${esc(p.execucao)}">mandar de novo</button><button class="bt" data-acao="exec-vista" data-id="${esc(p.execucao)}">deixa</button></div>`;
    if (p.tipo.startsWith('execucao') && erro?.lugar === `exec-${p.execucao}`) acoes += `<div class="erro">${esc(erro.texto)}</div>`;
    if (p.tipo !== 'veredito' && erro?.lugar === `pedido-${i}`) acoes += `<div class="erro">${esc(erro.texto)}</div>`;
    return `<div class="cartao pede${p.slug === ativo ? ' ativo' : ''}"${abre}>
      <b><span class="tipo t-${p.tipo}">${ROTULO[p.tipo]}</span>${esc(p.titulo)}</b>
      <p>${esc(p.texto)}</p>${acoes}</div>`;
  }

  function respostaExec(id) {
    return `<div class="executar"><textarea data-resp-texto="${esc(id)}" placeholder="Sua resposta — vai para a mesma sessão"></textarea>
      <div class="linha-bt"><button class="bt forte" data-acao="responder" data-id="${esc(id)}">responder</button></div></div>`;
  }

  function mini(p, linha2) {
    return `<div class="mini${p.slug === ativo ? ' ativo' : ''}" data-abre="${esc(p.slug)}">${esc(p.titulo)}${selo(p)}<small>${esc(linha2)}</small></div>`;
  }
  const idade = (p) => (p.idadeDias == null ? '' : `${p.idadeDias}d`);
  const prazo = (p) => (p.diasParaPrazo == null ? 'sem prazo' : p.diasParaPrazo < 0 ? `venceu há ${-p.diasParaPrazo}d` : `veredito em ${p.diasParaPrazo}d`);

  function desenharMesa() {
    if (!mesa) return;
    const partes = [];
    const ponto$ = new Map((mesa.todos || []).map((p) => [p.slug, p]));
    const cartaoChegou = (p) => `<div class="cartao${p.slug === ativo ? ' ativo' : ''}" data-abre="${esc(p.slug)}">
        <b>${esc(p.titulo)}${selo(p)}</b><p>${esc(p.origem || '')}</p><div class="meta"><span>aberto ${esc(p.abertoEm)}</span><span>${esc(p.estagio)}</span></div></div>`;
    // com período escolhido, a primeira coisa é a lista do que entrou nele (é o que ele veio procurar)
    if (periodo !== 'tudo') {
      const ROT = { hoje: 'Chegaram hoje', semana: 'Chegaram em 7 dias', mexido: 'Mexidos hoje' };
      const lista = ordenar((mesa.todos || []).filter((p) => noPeriodo(p) && bate(p.titulo, p.origem, p.proximoPasso)));
      partes.push(`<div class="secao quente">${ROT[periodo]} <span class="n">${lista.length}</span></div>`);
      partes.push(lista.length ? lista.map(cartaoChegou).join('') : '<div class="vazio">Nada neste período.</div>');
    }
    const pedidos = mesa.praVoce.map((p, i) => ({ p, i })).filter(({ p }) => bate(p.titulo, p.texto) && noPeriodo(p.slug ? ponto$.get(p.slug) : null, p.quando));
    partes.push(`<div class="secao${periodo === 'tudo' ? ' quente' : ''}">Pra você <span class="n">${pedidos.length}${pedidos.length !== mesa.praVoce.length ? ` de ${mesa.praVoce.length}` : ''}</span></div>`);
    partes.push(pedidos.length ? pedidos.map(({ p, i }) => cartaoPedido(p, i)).join('') : '<div class="vazio">Nada esperando você neste período.</div>');

    // o que acabou de chegar nunca fica enterrado: seção própria (hoje e ontem), na visão "tudo"
    const novos = ordenar((mesa.todos || []).filter((p) => novo(p) && bate(p.titulo, p.origem)));
    if (periodo === 'tudo' && novos.length) {
      partes.push(`<div class="secao">Chegaram agora <span class="n">${novos.length}</span></div>`);
      partes.push(novos.map(cartaoChegou).join(''));
    }

    const pot = ordenar(mesa.potencial.filter((p) => bate(p.titulo, p.potencial.motivo, p.projetoLigado) && noPeriodo(p)));
    if (ordem !== 'potencial') pot.sort((a, b) => b.potencial.nivel - a.potencial.nivel); // a seção é de potencial: nível manda, a ordem desempata
    partes.push(`<div class="secao">Com potencial <span class="n">${pot.length}</span></div>`);
    partes.push(pot.length ? pot.map((p) => `<div class="cartao${p.slug === ativo ? ' ativo' : ''}" data-abre="${esc(p.slug)}">
      <b><span class="pot">${tri(p.potencial.nivel)}</span>${esc(p.titulo)}${p.projetoLigado ? ` → ${esc(p.projetoLigado)}` : ''}${selo(p)}</b>
      <p>${esc(p.potencial.motivo || 'sem motivo registrado')}</p></div>`).join('') : '<div class="vazio">Nenhum ponto com nota neste filtro.</div>');

    const a = mesa.andamento;
    // na visão "tudo", até 6 por coluna na ordem escolhida; com período, tudo aparece
    const col = (titulo, lista, linha2) => {
      const vis = ordenar(lista.filter((p) => bate(p.titulo, p.proximoPasso) && noPeriodo(p)));
      const teto = periodo === 'tudo' ? 6 : Infinity;
      const resto = vis.length - teto;
      return `<div class="coluna"><h4>${titulo} (${vis.length})</h4>${vis.slice(0, teto).map((p) => mini(p, linha2(p))).join('') || '<div class="vazio">—</div>'}${resto > 0 ? `<div class="vazio">+${resto} (escolha um período ou mude a ordem)</div>` : ''}</div>`;
    };
    partes.push('<div class="secao">Em andamento</div>');
    partes.push(`<div class="colunas">${col('Semente', a.semente, (p) => `${idade(p)} · ${prazo(p)}`)}${col('Em teste', a.emTeste, (p) => p.proximoPasso || prazo(p))}${col('Dormente', a.dormente, (p) => `volta ${p.veredito?.ate || '—'}`)}</div>`);

    const mortos = ordenar(mesa.naoDeramCerto.filter((p) => bate(p.titulo, p.veredito?.motivo) && noPeriodo(p)));
    partes.push(`<div class="secao">Não deram certo <span class="n">${mesa.naoDeramCerto.length}</span></div>`);
    partes.push(mortos.length ? mortos.map((p) => `<div class="cartao morto" data-abre="${esc(p.slug)}"><b>✕ ${esc(p.titulo)}</b>
      <p>${esc(p.veredito?.motivo || '')}</p><div class="meta"><span>arquivado ${esc(p.quando || '')}</span><span>ver evidência ↗</span></div></div>`).join('') : '<div class="vazio">Nenhum arquivado ainda.</div>');

    const v = mesa.ultimaVisita;
    partes.push('<div class="secao">Última visita</div>');
    partes.push(v ? `<div class="cartao"><b>${esc(v.quando)}${v.interrompida ? ' · interrompida' : ''}</b><p>${esc(v.resumo || 'sem resumo')}</p></div>` : '<div class="vazio">Nenhuma visita registrada ainda.</div>');
    mesaEl.innerHTML = partes.join('');
  }

  // ── o ponto aberto ───────────────────────────────────────────────────────────────────────────────
  async function abrir(slug, rolar = true) {
    ativo = slug;
    desenharMesa();
    const p = await ponte.ler(slug);
    if (!p) { pontoEl.innerHTML = '<div class="md vazio">Não consegui ler esse ponto.</div>'; return; }
    const decidido = p.veredito && p.veredito.tipo !== 'dormente';
    const linha = [
      `<span>estágio <b>${esc(p.estagio)}</b></span>`,
      p.potencial?.nivel ? `<span>potencial <b class="pot">${tri(p.potencial.nivel)}</b>${p.potencial.rebaixado ? ' (▲▲▲ sem teste vira ▲▲)' : ''}</span>` : '',
      p.prazo ? `<span>prazo <b>${esc(p.prazo)}</b></span>` : '',
      p.projetoLigado ? `<span>projeto <b>${esc(p.projetoLigado)}</b></span>` : '',
    ].join('');
    const decisao = `<div class="decisao"><div class="linha">${linha}</div>
      ${p.proximoPasso ? `<div class="linha" style="margin-top:4px"><span>próximo passo: <b>${esc(p.proximoPasso)}</b></span></div>` : ''}
      ${p.proposta ? `<div class="linha" style="margin-top:4px"><span>proposta da visita: <b>${esc(p.proposta)}</b></span></div>` : ''}
      ${decidido ? `<div class="linha" style="margin-top:6px"><span>veredito: <b>${esc(p.veredito.tipo)}</b> ${esc(p.veredito.motivo || '')}</span></div>` : botoesVeredito('ponto', slug, p.proposta)}
      ${caixaExecutar('ponto', { slug }, ondeRoda(p.projetoLigado))}</div>`;
    pontoEl.innerHTML = `${decisao}<div class="md">${markdown(p.texto)}</div>`;
    if (rolar) pontoEl.scrollTop = 0;
  }

  // ── projetos ─────────────────────────────────────────────────────────────────────────────────────
  function desenharProjetos() {
    if (!mesa) return;
    const itensRef = [];
    const cards = mesa.projetos.filter((pr) => bate(pr.nome, pr.fase, pr.dor, pr.itens.map((i) => i.titulo).join(' '))).map((pr) => {
      const marco = pr.proximo ? `${esc(pr.proximo.titulo)} · ${pr.proximo.dias < 0 ? `venceu há ${-pr.proximo.dias}d` : `${pr.proximo.dias}d`}` : '';
      const itens = pr.itens.map((it) => {
        const k = itensRef.push(it) - 1;
        const cls = it.dias == null || it.feito ? '' : it.dias < 0 ? 'venceu' : it.dias <= 7 ? 'perto' : '';
        const alerta = cls ? ' ⚠' : '';
        const extra = it.proposto
          ? `<button class="mini-bt" title="aceitar" data-acao="item-proj" data-k="${k}" data-faz="aceitar">✓</button><button class="mini-bt" title="recusar" data-acao="item-proj" data-k="${k}" data-faz="recusar">✕</button>`
          : '';
        return `<li class="item${it.feito ? ' feito' : ''}${it.proposto ? ' proposto' : ''}">
          <input type="checkbox" data-acao="check" data-k="${k}"${it.feito ? ' checked' : ''}${pr.somenteLeitura || it.proposto ? ' disabled' : ''}>
          <span class="tx">${esc(it.titulo)}${it.proposto ? ' (proposto pelo Omni)' : ''}</span>
          ${it.data ? `<span class="dt ${cls}">${esc(it.data)}${alerta}</span>` : ''}${extra}</li>`;
      }).join('');
      const pontos = new Map([...mesa.potencial, ...mesa.decididos, ...mesa.andamento.semente, ...mesa.andamento.emTeste].map((p) => [p.slug, p]));
      const ligadas = pr.ideias.map((s) => { const p = pontos.get(s); return `<span data-abre-ideia="${esc(s)}">${esc(p?.titulo || s)}${p?.potencial?.nivel ? ` ${tri(p.potencial.nivel)}` : ''}</span>`; }).join('');
      return `<article class="proj">
        <header><h3>${esc(pr.nome)}</h3><span class="marco">${marco || (pr.semData ? '<span style="color:var(--laranja)">sem data ⚠</span>' : '')}</span></header>
        ${pr.fase ? `<div class="fase">${esc(pr.fase)}</div>` : ''}${pr.dor ? `<div class="dor">dor do momento: ${esc(pr.dor)}</div>` : ''}
        ${pr.aviso ? `<div class="aviso">⚠ ${esc(pr.aviso)}</div>` : ''}
        ${pr.origem ? `<div class="origem">espelha ${esc(pr.origem)}</div>` : ''}
        <ul class="itens">${itens || '<li class="vazio">nenhuma entrega ainda</li>'}</ul>
        ${ligadas ? `<div class="ligadas">ideias: ${ligadas}</div>` : ''}
        ${erro?.lugar === `proj-${pr.nome}` ? `<div class="erro">${esc(erro.texto)}</div>` : ''}
        ${execProjeto === pr.nome ? caixaExecutar('projeto', { projeto: pr.nome }, ondeRoda(pr.nome)) : `<div class="acoes"><button class="bt" data-acao="abrir-exec-proj" data-projeto="${esc(pr.nome)}">executar…</button></div>`}
      </article>`;
    }).join('');
    projetosEl.innerHTML = cards || '<div class="vazio">Nenhum projeto no projetos.md.</div>';
    projetosEl._itens = itensRef;
    projetosEl._donos = mesa.projetos.flatMap((pr) => pr.itens.map(() => pr.nome));
  }

  // ── execuções (o embrião da janela do Overcore): o que ele mandou rodar, onde e como está ────────────
  const hora = (ms) => new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  function desenharExecucoes() {
    const lista = (mesa?.execucoes || []).filter((e) => bate(e.titulo, e.instrucao, e.destino?.nome, e.estado) && noPeriodo(null, periodo === 'mexido' ? e.atualizadoEm : e.criadoEm));
    execsEl.innerHTML = lista.length ? lista.map((e) => `<article class="exec">
      <header><h3>${esc(e.titulo)}</h3><span class="estado e-${e.estado.replace(/\s+/g, '-').replace('ã', 'a')}">${esc(e.estado)}</span></header>
      <div class="onde">${e.destino ? `na sessão <b>${esc(e.destino.nome)}</b> · ${esc(e.destino.motivo || '')}` : 'ainda sem sessão'} · ${esc(e.id)}</div>
      <div class="pedido">${esc(e.instrucao)}</div>
      <ol>${e.eventos.map((v) => `<li><time>${hora(v.em)}</time>${esc(v.estado)}${v.nota ? ` — ${esc(v.nota)}` : ''}</li>`).join('')}</ol>
      ${e.estado === 'bloqueada' ? respostaExec(e.id) : ''}
      ${['sem sessão', 'falhou'].includes(e.estado) ? `<div class="acoes"><button class="bt forte" data-acao="reenviar" data-id="${esc(e.id)}">mandar de novo</button></div>` : ''}
      ${['andando', 'enviada', 'concluida'].includes(e.estado) ? `<div class="acoes"><button class="bt" data-acao="abrir-resp" data-id="${esc(e.id)}">ajustar / complementar…</button></div>` : ''}
      ${respAberta === e.id && e.estado !== 'bloqueada' ? respostaExec(e.id) : ''}
      ${erro?.lugar === `exec-${e.id}` ? `<div class="erro">${esc(erro.texto)}</div>` : ''}
    </article>`).join('') : '<div class="vazio">Nada mandado para executar ainda. A caixa "mandar executar" fica no ponto aberto e no card de cada projeto.</div>';
  }
  let respAberta = null;

  function desenhar() {
    if (!mesa) return;
    conta.textContent = `${mesa.total} pontos`;
    abaIdeias.innerHTML = `Ideias${mesa.praVoce.length ? `<span class="n">${mesa.praVoce.length}</span>` : ''}`;
    const rodando = (mesa.execucoes || []).filter((e) => ['na fila', 'enviada', 'andando'].includes(e.estado)).length;
    abaExecucoes.innerHTML = `Execuções${rodando ? `<span class="n" style="background:var(--azul)">${rodando}</span>` : ''}`;
    if (aba === 'ideias') desenharMesa(); else if (aba === 'projetos') desenharProjetos(); else desenharExecucoes();
  }

  function trocarAba(nova) {
    aba = nova;
    abaIdeias.classList.toggle('ativa', aba === 'ideias');
    abaProjetos.classList.toggle('ativa', aba === 'projetos');
    abaExecucoes.classList.toggle('ativa', aba === 'execucoes');
    telaIdeias.hidden = aba !== 'ideias';
    projetosEl.hidden = aba !== 'projetos';
    execsEl.hidden = aba !== 'execucoes';
    desenhar();
    // as execuções andam no disco (a sessão executora escreve): entrar na aba relê
    if (aba === 'execucoes' && !digitando()) carregar();
  }

  // ── cliques ──────────────────────────────────────────────────────────────────────────────────────
  async function resultado(r, lugar, slug) {
    if (r && r.ok) { erro = null; aberto = null; await carregar(); if (ativo) abrir(ativo, false); return; }
    erro = { lugar, slug, texto: r?.erro || 'não deu para gravar' };
    desenhar();
    if (ativo) abrir(ativo, false);
  }

  document.addEventListener('click', async (ev) => {
    const alvo = ev.target.closest('[data-acao],[data-abre],[data-abre-bt],[data-aba],[data-aba-bt],[data-abre-ideia]');
    if (!alvo) return;
    const d = alvo.dataset;
    if (d.aba) { trocarAba(d.aba); return; }
    if (d.abaBt) { trocarAba(d.abaBt); return; }
    if (d.abreIdeia) { trocarAba('ideias'); abrir(d.abreIdeia); return; }
    if (d.abreBt) { abrir(d.abreBt); return; }
    if (d.acao === 'abrir-veredito') { aberto = `${d.lugar}:${d.slug}:${d.tipo}`; erro = null; desenhar(); if (ativo) abrir(ativo, false); return; }
    if (d.acao === 'fechar-veredito') { aberto = null; erro = null; desenhar(); if (ativo) abrir(ativo, false); return; }
    if (d.acao === 'confirmar-veredito') {
      const form = alvo.closest('.form');
      const v = (c) => form.querySelector(`[data-campo="${c}"]`)?.value || '';
      const lugar = aberto?.split(':')[0] || 'mesa';
      const r = await ponte.veredito(form.dataset.slug, { tipo: form.dataset.tipo, motivo: v('motivo'), projeto: v('projeto'), ate: paraBr(v('ate')) });
      await resultado(r, lugar, form.dataset.slug);
      return;
    }
    if (d.acao === 'visto') { await resultado(await ponte.visto(d.slug), 'mesa', d.slug); return; }
    if (d.acao === 'executar') {
      const caixa = alvo.closest('.executar');
      const texto = caixa.querySelector('[data-exec-texto]').value;
      const r = await ponte.executar({ slug: d.slug, projeto: d.projeto, instrucao: texto });
      if (r?.ok) { caixa.querySelector('[data-exec-texto]').value = ''; execProjeto = null; trocarAba('execucoes'); }
      await resultado(r, d.lugar);
      return;
    }
    if (d.acao === 'abrir-exec-proj') { execProjeto = d.projeto; desenhar(); projetosEl.querySelector('[data-exec-texto]')?.focus(); return; }
    if (d.acao === 'abrir-resp') { respAberta = d.id; desenhar(); return; }
    if (d.acao === 'responder') {
      const t = document.querySelector(`[data-resp-texto="${CSS.escape(d.id)}"]`)?.value || '';
      const r = await ponte.responder(d.id, t);
      if (r?.ok) respAberta = null;
      await resultado(r, `exec-${d.id}`);
      return;
    }
    if (d.acao === 'reenviar') { await resultado(await ponte.reenviar(d.id), `exec-${d.id}`); return; }
    if (d.acao === 'exec-vista') { await resultado(await ponte.execucaoVista(d.id), `exec-${d.id}`); return; }
    if (d.acao === 'item') {
      const p = mesa.praVoce[Number(d.i)];
      await resultado(await ponte.item(p.item, d.faz), `pedido-${d.i}`);
      return;
    }
    if (d.acao === 'item-proj') {
      const k = Number(d.k);
      await resultado(await ponte.item(projetosEl._itens[k], d.faz), `proj-${projetosEl._donos[k]}`);
      return;
    }
    if (d.abre && !ev.target.closest('button, input, select')) abrir(d.abre);
  });
  // o checkbox muda no 'change' (o clique já trocou o visual; se a gravação falhar, a releitura desfaz)
  projetosEl.addEventListener('change', async (ev) => {
    const c = ev.target.closest('[data-acao="check"]');
    if (!c) return;
    const k = Number(c.dataset.k);
    await resultado(await ponte.item(projetosEl._itens[k], c.checked ? 'marcar' : 'desmarcar'), `proj-${projetosEl._donos[k]}`);
  });
  busca.addEventListener('input', desenhar);
  const chips = [...document.querySelectorAll('#filtros .chip')];
  const seletorOrdem = document.getElementById('ordem');
  const marcarFiltros = () => { for (const c of chips) c.classList.toggle('ativa', c.dataset.periodo === periodo); seletorOrdem.value = ordem; };
  for (const c of chips) c.addEventListener('click', () => { periodo = c.dataset.periodo; lembrar(); marcarFiltros(); desenhar(); });
  seletorOrdem.addEventListener('change', () => { ordem = seletorOrdem.value in CHAVE ? seletorOrdem.value : 'novos'; lembrar(); desenhar(); });
  marcarFiltros();

  async function carregar() {
    mesa = await ponte.mesa();
    desenhar();
    if (!ativo && aba === 'ideias') {
      const primeiro = mesa?.praVoce.find((p) => p.slug)?.slug || mesa?.potencial[0]?.slug || mesa?.andamento.semente[0]?.slug;
      if (primeiro) abrir(primeiro);
    }
  }
  // voltou para a janela: relê (a visita ou outra sessão pode ter mexido). Com formulário aberto, não
  // redesenha — senão o motivo que ele está digitando some.
  // só a caixa visível conta: a de uma aba escondida não pode travar a releitura
  const digitando = () => [...document.querySelectorAll('textarea')].some((t) => t.offsetParent !== null && t.value.trim());
  window.addEventListener('focus', () => { if (!aberto && !digitando()) carregar(); });
  // a aba Execuções acompanha o andamento sozinha (a sessão executora escreve no disco)
  setInterval(() => { if (aba === 'execucoes' && !digitando() && document.hasFocus()) carregar(); }, 5000);
  window.omniActionsDepurar = () => ({ mesa, ativo, aba, aberto, erro });
  ponte.aoTrocarAba((nova) => trocarAba(nova));
  carregar().then(() => {
    const inicial = location.hash.slice(1);
    if (['projetos', 'execucoes'].includes(inicial)) trocarAba(inicial);
  });
})();
