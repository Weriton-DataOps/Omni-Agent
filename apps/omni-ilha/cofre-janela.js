'use strict';

// Janela do cofre (F1, plano 5, T6). Lista as credenciais (ou a lixeira) à esquerda e mostra a ficha da
// escolhida à direita; sem escolha, mostra a saúde. Ao abrir, esvazia a lixeira vencida e lê tudo; relê ao
// ganhar o foco, no máximo a cada 10 s, e depois de cada ação. Texto do cofre entra escapado.
// O valor revelado fica numa variável e numa caixa só, até 30 s; some ao trocar de credencial, ao perder o
// foco, com Esc, no botão esconder ou no fim do prazo. O valor digitado sai do campo assim que é enviado.
(() => {
  const ponte = window.cofre;
  const $ = (id) => document.getElementById(id);
  const lista = $('lista');
  const painel = $('painel');
  const status = $('status');
  const busca = $('busca');
  const chips = [...document.querySelectorAll('#vistas .chip')];
  const filtro = { tipo: $('f-tipo'), servico: $('f-servico'), agente: $('f-agente'), situacao: $('f-situacao') };
  const TIPOS = ['senha', 'token', 'chave-api', 'conexao', 'conta-servico', 'ssh', 'outro'];
  const DIA_MS = 24 * 60 * 60 * 1000;
  const PRAZO_LIXEIRA_DIAS = 30;
  // Títulos das seções da saúde (várias credenciais) e o mesmo aviso dito de uma credencial só (ficha e marca).
  const REGRA = { vence: 'Vencem em breve', 'teste-falhou': 'O último teste falhou', 'sem-uso': 'Sem uso há muito tempo', 'agente-nunca-usou': 'Agente listado que nunca usou' };
  const REGRA_UMA = { vence: 'Vence em breve', 'teste-falhou': 'O último teste falhou', 'sem-uso': 'Sem uso há muito tempo', 'agente-nunca-usou': 'Um agente listado nunca usou' };

  const est = {
    vista: 'credenciais',
    creds: [],
    lixeira: [],
    saude: null,
    duplicatas: null,
    sel: null,         // o nome (credenciais) ou o id (lixeira)
    modo: null,        // null | 'nova' | 'editar' | 'trocar' | 'apagar'
    historico: null,   // { id, usos } ou { id, erro }
    revelado: null,    // { nome, valor, ate }
    ocupado: null,     // a ação em curso
    msg: null,         // { tipo: 'ok' | 'erro' | 'espera', texto }
    erroLeitura: null,
  };
  let relogio = null;
  let lidoEm = 0;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ms = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : 0; };
  const hora = (iso) => { const t = ms(iso); return t ? new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'; };
  const dia = (iso) => { const t = ms(iso); return t ? new Date(t).toLocaleDateString('pt-BR') : '—'; };
  const erroDe = (r, padrao) => String((r && (r.erro || r.codigo)) || padrao);
  const virgulas = (texto) => String(texto ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const credAtual = () => est.creds.find((c) => c.nome === est.sel) || null;
  const apagadaAtual = () => est.lixeira.find((c) => c.id === est.sel) || null;
  const alertas = () => (Array.isArray(est.saude?.alertas) ? est.saude.alertas : []);
  const alertasDe = (nome) => alertas().filter((a) => a.nome === nome);
  const restam = (iso) => Math.max(0, Math.ceil((ms(iso) + PRAZO_LIXEIRA_DIAS * DIA_MS - Date.now()) / DIA_MS));

  // ── leitura
  async function carregar() {
    let c; let l; let s;
    try { [c, l, s] = await Promise.all([ponte.listar(), ponte.lixeira(), ponte.saude(false)]); } catch { /* fica o erro abaixo */ }
    lidoEm = Date.now();
    est.erroLeitura = c?.ok && Array.isArray(c.dados) ? null : erroDe(c, 'não consegui ler o cofre');
    if (c?.ok && Array.isArray(c.dados)) est.creds = c.dados;
    if (l?.ok && Array.isArray(l.dados)) est.lixeira = l.dados;
    if (s?.ok && s.dados) est.saude = s.dados;
    if (est.modo === null && est.sel !== null && !(est.vista === 'lixeira' ? apagadaAtual() : credAtual())) selecionar(null);
    desenhar({ painel: est.modo === null });
  }

  // ── topo, filtros e lista
  function opcoes(sel, vazio, valores) {
    const atual = sel.value;
    const todos = [...new Set(valores.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    sel.innerHTML = `<option value="">${esc(vazio)}</option>${todos.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}`;
    sel.value = todos.includes(atual) ? atual : '';
  }

  function desenharTopo() {
    const n = alertas().length;
    status.innerHTML = est.erroLeitura
      ? `<b>${esc(est.erroLeitura)}</b>`
      : `${est.creds.length} credenciais${n ? ` · <b>${n} ${n === 1 ? 'alerta' : 'alertas'}</b>` : ' · sem alertas'}`;
    for (const c of chips) {
      c.classList.toggle('ativa', c.dataset.vista === est.vista);
      c.innerHTML = `${esc(c.dataset.vista)}<span class="n">${c.dataset.vista === 'lixeira' ? est.lixeira.length : est.creds.length}</span>`;
    }
    opcoes(filtro.tipo, 'todos os tipos', est.creds.map((c) => c.tipo));
    opcoes(filtro.servico, 'todos os serviços', est.creds.map((c) => c.servico));
    opcoes(filtro.agente, 'todos os agentes', est.creds.flatMap((c) => c.agentes || []));
    for (const el of [...Object.values(filtro), $('duplicatas')]) el.disabled = est.vista === 'lixeira' || (el.id === 'duplicatas' && est.ocupado !== null);
  }

  const SITUACAO = {
    todas: () => true,
    alerta: (c) => alertasDe(c.nome).length > 0,
    falhou: (c) => c.ultimo_teste_ok === false,
    nunca: (c) => !c.ultimo_teste_em,
    gerenciador: (c) => c.guarda === 'gerenciador-windows',
  };

  function visiveis() {
    const f = busca.value.trim().toLowerCase();
    const casa = (c) => !f || `${c.nome} ${c.servico ?? ''} ${c.usuario ?? ''} ${c.tipo} ${(c.etiquetas || []).join(' ')}`.toLowerCase().includes(f);
    if (est.vista === 'lixeira') return est.lixeira.filter(casa);
    return est.creds.filter(casa)
      .filter((c) => !filtro.tipo.value || c.tipo === filtro.tipo.value)
      .filter((c) => !filtro.servico.value || c.servico === filtro.servico.value)
      .filter((c) => !filtro.agente.value || (c.agentes || []).includes(filtro.agente.value))
      .filter(SITUACAO[filtro.situacao.value] || SITUACAO.todas);
  }

  function itemCred(c) {
    const marcas = [
      alertasDe(c.nome).length ? `<span class="marca m-alerta" title="${esc(alertasDe(c.nome).map((a) => REGRA_UMA[a.regra] || a.regra).join('; '))}">alerta</span>` : '',
      c.ultimo_teste_ok === false ? '<span class="marca m-falhou">falhou</span>' : '',
      c.guarda === 'gerenciador-windows' ? '<span class="marca m-gerenciador">gerenciador</span>' : '',
    ].join('');
    return `<button class="item${est.sel === c.nome ? ' sel' : ''}" data-sel="${esc(c.nome)}"><span class="nome">${esc(c.nome)}</span><span class="marcas">${marcas}</span><span class="sub">${esc([c.tipo, c.servico, c.usuario].filter(Boolean).join(' · '))}</span></button>`;
  }

  function itemApagada(c) {
    const n = restam(c.apagado_em);
    return `<button class="item${est.sel === c.id ? ' sel' : ''}" data-sel="${esc(c.id)}"><span class="nome">${esc(c.nome)}</span><span class="marcas"></span><span class="sub">apagada em ${esc(dia(c.apagado_em))} · ${n === 0 ? 'sai na próxima abertura' : `sai em ${n} ${n === 1 ? 'dia' : 'dias'}`}</span></button>`;
  }

  function desenharLista() {
    const vis = visiveis();
    const vazio = est.vista === 'lixeira' ? 'A lixeira está vazia.' : est.creds.length ? 'Nada neste filtro.' : 'Nenhuma credencial ainda.';
    lista.innerHTML = vis.map(est.vista === 'lixeira' ? itemApagada : itemCred).join('') || `<div class="vazio">${vazio}</div>`;
  }

  // ── painel
  const bt = (faz, rotulo, { desligado = false, classe = '' } = {}) => `<button class="bt${classe ? ` ${classe}` : ''}" data-faz="${faz}"${desligado ? ' data-desligado="sim"' : ''}${desligado || est.ocupado !== null ? ' disabled' : ''}>${esc(rotulo)}</button>`;
  const msgHtml = () => `<div class="msg${est.msg ? ` ${est.msg.tipo}` : ''}" id="msg">${est.msg ? esc(est.msg.texto) : ''}</div>`;
  const linha = (rotulo, valor) => `<dt>${esc(rotulo)}</dt><dd${valor ? '' : ' class="nada"'}>${valor ? esc(valor) : '—'}</dd>`;

  function quandoDoAlerta(a) {
    if (a.regra === 'vence') return `vence em ${dia(a.validade)}`;
    if (a.regra === 'teste-falhou') return `teste de ${hora(a.em)}`;
    if (a.regra === 'sem-uso') return `sem uso desde ${dia(a.desde)}`;
    if (a.regra === 'agente-nunca-usou') return `agente ${a.agente}`;
    return '';
  }

  function painelResumo() {
    const grupos = Object.keys(REGRA).map((regra) => [regra, alertas().filter((a) => a.regra === regra)]).filter(([, itens]) => itens.length);
    const dup = est.duplicatas;
    const repetidos = !dup
      ? '<p class="nota">Ainda não conferido nesta janela. A conferência abre cada valor guardado só para comparar; nada aparece na tela.</p>'
      : `${dup.pares?.length ? `<ul class="alertas">${dup.pares.map(([a, b]) => `<li><button data-sel="${esc(a)}">${esc(a)}</button><span class="quando">tem o mesmo valor que</span> <button data-sel="${esc(b)}">${esc(b)}</button></li>`).join('')}</ul>` : '<p class="nota">Nenhum valor repetido.</p>'}
         ${dup.naoAbriram?.length ? `<p class="nota">Não abriram: ${esc(dup.naoAbriram.join(', '))}.</p>` : ''}`;
    return `<h2>Saúde do cofre</h2>
      <div class="numeros"><div><strong>${est.creds.length}</strong><span>credenciais</span></div><div><strong>${alertas().length}</strong><span>alertas</span></div><div><strong>${est.lixeira.length}</strong><span>na lixeira</span></div></div>
      ${grupos.map(([regra, itens]) => `<h3>${esc(REGRA[regra])}</h3><ul class="alertas">${itens.map((a) => `<li><button data-sel="${esc(a.nome)}">${esc(a.nome)}</button><span class="quando">${esc(quandoDoAlerta(a))}</span></li>`).join('')}</ul>`).join('') || '<h3>Alertas</h3><p class="nota">Nenhum alerta.</p>'}
      <h3>Valores repetidos</h3>${repetidos}${msgHtml()}`;
  }

  function painelApagada(c) {
    return `<div class="linha-titulo"><h2>${esc(c.nome)}</h2><span class="etq">${esc(c.tipo)} · na lixeira</span></div>
      <dl class="ficha">${linha('serviço', c.servico)}${linha('usuário', c.usuario)}${linha('apagada em', hora(c.apagado_em))}${linha('sai de vez', `em ${restam(c.apagado_em)} dias`)}</dl>
      <div class="acoes">${bt('restaurar', 'restaurar', { classe: 'forte' })}</div>
      <p class="nota">Restaurar traz de volta com o mesmo nome, se nenhuma outra credencial viva o estiver usando.</p>${msgHtml()}`;
  }

  function textoDoTeste(c) {
    if (!c.ultimo_teste_em) return '<span class="teste-nunca">nunca testada</span>';
    const detalhe = c.ultimo_teste_detalhe ? `: ${esc(c.ultimo_teste_detalhe)}` : '';
    if (c.ultimo_teste_ok === true) return `<span class="teste-ok">passou</span> em ${esc(hora(c.ultimo_teste_em))}${detalhe}`;
    if (c.ultimo_teste_ok === false) return `<span class="teste-falhou">falhou</span> em ${esc(hora(c.ultimo_teste_em))}${detalhe}`;
    return `<span class="teste-nunca">sem resultado</span> em ${esc(hora(c.ultimo_teste_em))}${detalhe}`;
  }

  function painelFicha(c) {
    const gw = c.guarda === 'gerenciador-windows';
    const rev = est.revelado && est.revelado.nome === c.nome
      ? `<div class="revelado"><code id="valor-revelado">${esc(est.revelado.valor)}</code><div class="rodape"><span id="conta">${contagem()}</span>${bt('esconder', 'esconder')}</div></div>`
      : '';
    const hist = est.historico && est.historico.id === c.id
      ? `<h3>Histórico de uso</h3>${est.historico.erro ? `<p class="msg erro">${esc(est.historico.erro)}</p>` : est.historico.usos.length
        ? `<ul class="usos">${est.historico.usos.map((u) => `<li><time>${esc(hora(u.em))}</time><span>${esc(u.agente)}</span><span>${esc(u.motivo)}</span><span class="res">${esc(u.resultado)}</span></li>`).join('')}</ul>`
        : '<p class="nota">Nenhum uso registrado.</p>'}`
      : '';
    return `<div class="linha-titulo"><h2>${esc(c.nome)}</h2><span class="etq">${esc(c.tipo)}</span></div>
      <dl class="ficha">
        ${linha('serviço', c.servico)}${linha('url', c.url)}${linha('usuário', c.usuario)}
        ${linha('agentes', (c.agentes || []).join(', '))}${linha('etiquetas', (c.etiquetas || []).join(', '))}
        ${linha('validade', c.validade ? dia(c.validade) : '')}${linha('rotacionar', c.rotacionar_dias ? `a cada ${c.rotacionar_dias} dias` : '')}
        ${linha('notas', c.notas)}
        ${linha('guarda', gw ? 'Gerenciador de Credenciais do Windows' : 'DPAPI, deste usuário do Windows')}
        <dt>último teste</dt><dd>${textoDoTeste(c)}</dd>
        ${linha('criada', hora(c.criado_em))}${linha('atualizada', `${hora(c.atualizado_em)} · versão ${c.versao}`)}
      </dl>
      ${alertasDe(c.nome).length ? `<p class="msg erro">${esc(alertasDe(c.nome).map((a) => `${REGRA_UMA[a.regra] || a.regra} (${quandoDoAlerta(a)})`).join('; '))}</p>` : ''}
      <div class="acoes">
        ${bt('revelar', 'ver o valor', { desligado: gw })}${bt('copiar', 'copiar', { desligado: gw })}${bt('testar', 'testar', { desligado: gw })}
        ${bt('editar', 'editar')}${bt('trocar', 'trocar o valor', { desligado: gw })}
        ${bt('historico', est.historico?.id === c.id ? 'fechar o histórico' : 'histórico de uso')}${bt('apagar', 'apagar', { classe: 'perigo' })}
      </div>
      ${gw ? '<p class="nota">Esta mora no Gerenciador de Credenciais do Windows: o cofre só a lista. Ver, copiar, testar e trocar o valor são feitos por lá.</p>' : ''}
      ${rev}${formDoModo(c)}${msgHtml()}${hist}`;
  }

  const entrada = (id, rotulo, valor = '', extra = '') => `<label for="${id}">${esc(rotulo)}</label><input class="campo" id="${id}" value="${esc(valor)}" spellcheck="false" ${extra}>`;
  const seletorTipo = (id, atual) => `<label for="${id}">tipo</label><select class="campo" id="${id}">${TIPOS.map((t) => `<option${t === atual ? ' selected' : ''}>${t}</option>`).join('')}</select>`;

  function formNova() {
    return `<h2>Nova credencial</h2>
      <form class="form" id="form-nova" autocomplete="off">
        ${entrada('n-nome', 'nome', '', 'maxlength="200" placeholder="servico/conta"')}
        ${seletorTipo('n-tipo', 'senha')}
        ${entrada('n-servico', 'serviço', '', 'maxlength="100"')}
        ${entrada('n-url', 'url')}
        ${entrada('n-usuario', 'usuário')}
        ${entrada('n-agentes', 'agentes', 'omni', 'placeholder="separados por vírgula"')}
        <label for="n-notas">notas</label><textarea class="campo" id="n-notas"></textarea>
        ${entrada('n-valor', 'valor', '', 'type="password" autocomplete="new-password"')}
        <div class="acoes"><button class="bt forte" type="submit"${est.ocupado ? ' disabled' : ''}>guardar</button>${bt('nova-area', 'guardar com o que está na área de transferência')}${bt('cancelar', 'cancelar')}</div>
        <p class="nota">Validade, etiquetas e rotação entram depois, em editar. Pela área de transferência o valor não passa por esta janela, e a área é limpa quando o cofre guarda.</p>
      </form>${msgHtml()}`;
  }

  function formDoModo(c) {
    if (est.modo === 'editar') {
      return `<h3>Editar</h3><form class="form" id="form-editar" autocomplete="off">
        ${seletorTipo('e-tipo', c.tipo)}
        ${entrada('e-servico', 'serviço', c.servico, 'maxlength="100"')}
        ${entrada('e-url', 'url', c.url)}
        ${entrada('e-usuario', 'usuário', c.usuario)}
        ${entrada('e-agentes', 'agentes', (c.agentes || []).join(', '), 'placeholder="separados por vírgula"')}
        ${entrada('e-etiquetas', 'etiquetas', (c.etiquetas || []).join(', '), 'placeholder="separadas por vírgula"')}
        ${entrada('e-validade', 'validade', c.validade ? String(c.validade).slice(0, 10) : '', 'type="date"')}
        ${entrada('e-rotacionar', 'rotacionar (dias)', c.rotacionar_dias ?? '', 'type="number" min="1" max="3650" step="1"')}
        <label for="e-notas">notas</label><textarea class="campo" id="e-notas">${esc(c.notas)}</textarea>
        <div class="acoes"><button class="bt forte" type="submit"${est.ocupado ? ' disabled' : ''}>guardar</button>${bt('cancelar', 'cancelar')}</div>
      </form>`;
    }
    if (est.modo === 'trocar') {
      return `<h3>Trocar o valor</h3><form class="form" id="form-trocar" autocomplete="off">
        ${entrada('t-valor', 'novo valor', '', 'type="password" autocomplete="new-password"')}
        <div class="acoes"><button class="bt forte" type="submit"${est.ocupado ? ' disabled' : ''}>trocar</button>${bt('trocar-area', 'trocar pelo que está na área de transferência')}${bt('cancelar', 'cancelar')}</div>
        <p class="nota">Trocar o valor apaga o resultado do último teste; teste de novo depois.</p>
      </form>`;
    }
    if (est.modo === 'apagar') {
      return `<div class="confirma">Apagar <b>${esc(c.nome)}</b>? Ela vai para a lixeira e sai de vez em ${PRAZO_LIXEIRA_DIAS} dias; até lá dá para restaurar.
        <div class="acoes">${bt('apagar-sim', 'apagar', { classe: 'perigo' })}${bt('cancelar', 'cancelar')}</div></div>`;
    }
    return '';
  }

  function desenharPainel() {
    if (est.modo === 'nova') { painel.innerHTML = formNova(); return; }
    if (est.vista === 'lixeira') { const c = apagadaAtual(); painel.innerHTML = c ? painelApagada(c) : `<p class="vazio">Apagadas ficam aqui ${PRAZO_LIXEIRA_DIAS} dias e depois saem de vez.</p>${msgHtml()}`; return; }
    const c = credAtual();
    painel.innerHTML = c ? painelFicha(c) : painelResumo();
  }

  // Só a mensagem e os botões, sem refazer o formulário aberto.
  function atualizarMsg() {
    const el = $('msg');
    if (el) { el.className = `msg${est.msg ? ` ${est.msg.tipo}` : ''}`; el.textContent = est.msg ? est.msg.texto : ''; }
    for (const b of painel.querySelectorAll('button')) b.disabled = est.ocupado !== null || b.dataset.desligado === 'sim';
    $('duplicatas').disabled = est.vista === 'lixeira' || est.ocupado !== null;
    $('nova').disabled = est.ocupado !== null;
  }

  function desenhar({ painel: tambemPainel = true } = {}) {
    desenharTopo();
    desenharLista();
    if (tambemPainel) desenharPainel();
    atualizarMsg();
  }

  // ── o valor revelado
  function contagem() {
    const s = est.revelado ? Math.max(0, Math.ceil((est.revelado.ate - Date.now()) / 1000)) : 0;
    return `some em ${s} s`;
  }

  function mostrarRevelado(nome, valor, prazoMs) {
    esconder({ redesenhar: false });
    const prazo = Math.min(30000, Number(prazoMs) || 30000);
    est.revelado = { nome, valor, ate: Date.now() + prazo };
    relogio = setInterval(() => {
      if (!est.revelado || Date.now() >= est.revelado.ate) { esconder(); return; }
      const el = $('conta');
      if (el) el.textContent = contagem();
    }, 250);
  }

  function esconder({ redesenhar = true } = {}) {
    clearInterval(relogio);
    relogio = null;
    const tinha = est.revelado !== null;
    est.revelado = null;
    const el = $('valor-revelado');
    if (el) el.textContent = '';
    if (tinha && redesenhar && est.modo === null) desenharPainel();
  }

  // ── ações
  function selecionar(sel) {
    esconder({ redesenhar: false });
    est.sel = sel;
    est.modo = null;
    est.msg = null;
    est.historico = null;
  }

  async function agir(nome, espera, pedido, depois) {
    if (est.ocupado !== null) return;
    est.ocupado = nome;
    est.msg = espera ? { tipo: 'espera', texto: espera } : null;
    atualizarMsg();
    let r;
    try { r = await pedido(); } catch { r = { ok: false, erro: 'a janela perdeu a resposta do cofre' }; }
    // Ocupado até a recarga terminar: os botões voltam todos de uma vez, já com o que o cofre tem agora.
    try { await depois(r); } finally { est.ocupado = null; atualizarMsg(); }
  }

  const falhou = (r, padrao) => { est.msg = { tipo: 'erro', texto: erroDe(r, padrao) }; };

  function dadosDaNova() {
    const v = (id) => $(id).value.trim();
    return { nome: v('n-nome'), tipo: $('n-tipo').value, servico: v('n-servico'), url: v('n-url'), usuario: v('n-usuario'), agentes: v('n-agentes'), notas: $('n-notas').value.trim() };
  }

  function mudancasDaEdicao(c) {
    const m = {};
    const texto = (id, campo) => { const v = $(id).value.trim(); const novo = v === '' ? null : v; if (novo !== (c[campo] ?? null)) m[campo] = novo; };
    const listaDe = (id, campo) => { const novo = virgulas($(id).value); if (JSON.stringify(novo) !== JSON.stringify(c[campo] || [])) m[campo] = novo; };
    if ($('e-tipo').value !== c.tipo) m.tipo = $('e-tipo').value;
    texto('e-servico', 'servico');
    texto('e-url', 'url');
    texto('e-usuario', 'usuario');
    listaDe('e-agentes', 'agentes');
    listaDe('e-etiquetas', 'etiquetas');
    const validade = $('e-validade').value;
    if (validade !== (c.validade ? String(c.validade).slice(0, 10) : '')) m.validade = validade || null;
    const dias = $('e-rotacionar').value.trim();
    const novoDias = dias === '' ? null : Number(dias);
    if (novoDias !== (c.rotacionar_dias ?? null)) m.rotacionar_dias = novoDias;
    const notas = $('e-notas').value.trim();
    if ((notas || null) !== (c.notas ?? null)) m.notas = notas || null;
    return m;
  }

  async function guardarNova(daArea) {
    const dados = dadosDaNova();
    const campoValor = $('n-valor');
    const valor = campoValor.value;
    campoValor.value = '';
    if (!dados.nome) { est.msg = { tipo: 'erro', texto: 'falta o nome' }; atualizarMsg(); return; }
    if (!daArea && !valor) { est.msg = { tipo: 'erro', texto: 'falta o valor (ou use a área de transferência)' }; atualizarMsg(); return; }
    await agir('nova', 'guardando…', () => (daArea ? ponte.cadastrarDaArea(dados) : ponte.cadastrar(dados, valor)), async (r) => {
      if (!r?.ok) { falhou(r, 'o cofre não guardou'); return; }
      selecionar(r.dados?.credencial?.nome ?? dados.nome);
      est.msg = { tipo: 'ok', texto: daArea ? 'guardada; a área de transferência foi limpa' : 'guardada' };
      await carregar();
    });
  }

  async function trocarValor(c, daArea) {
    const campoValor = $('t-valor');
    const valor = campoValor ? campoValor.value : '';
    if (campoValor) campoValor.value = '';
    if (!daArea && !valor) { est.msg = { tipo: 'erro', texto: 'falta o novo valor (ou use a área de transferência)' }; atualizarMsg(); return; }
    await agir('trocar', 'trocando…', () => (daArea ? ponte.rotacionarDaArea(c.nome) : ponte.rotacionar(c.nome, valor)), async (r) => {
      if (!r?.ok) { falhou(r, 'o cofre não trocou o valor'); return; }
      est.modo = null;
      est.msg = { tipo: 'ok', texto: daArea ? 'valor trocado; a área de transferência foi limpa' : 'valor trocado' };
      await carregar();
    });
  }

  const ACOES = {
    cancelar: () => { est.modo = null; est.msg = null; desenharPainel(); },
    esconder: () => esconder(),
    'nova-area': () => guardarNova(true),
    'trocar-area': (c) => trocarValor(c, true),
    editar: () => { est.modo = 'editar'; est.msg = null; desenharPainel(); },
    trocar: () => { est.modo = 'trocar'; est.msg = null; desenharPainel(); },
    apagar: () => { est.modo = 'apagar'; est.msg = null; desenharPainel(); },
    revelar: (c) => agir('revelar', 'esperando o Windows Hello…', () => ponte.revelar(c.nome), async (r) => {
      if (r?.ok && typeof r.valor === 'string') { est.msg = null; mostrarRevelado(c.nome, r.valor, r.prazoMs); } else falhou(r, 'o cofre não mostrou o valor');
      desenharPainel();
    }),
    copiar: (c) => agir('copiar', 'esperando o Windows Hello…', () => ponte.copiar(c.nome), async (r) => {
      est.msg = r?.ok ? { tipo: 'ok', texto: `copiada; a área de transferência se limpa às ${new Date(ms(r.dados?.limpaEm) || Date.now()).toLocaleTimeString('pt-BR')}` } : { tipo: 'erro', texto: erroDe(r, 'o cofre não copiou') };
    }),
    testar: (c) => agir('testar', 'testando…', () => ponte.testar(c.nome), async (r) => {
      if (!r?.ok) { falhou(r, 'o teste não rodou'); return; }
      const t = r.dados?.teste || {};
      est.msg = t.ok === true ? { tipo: 'ok', texto: `o teste passou${t.detalhe ? `: ${t.detalhe}` : ''}` } : { tipo: 'erro', texto: `${t.ok === false ? 'o teste falhou' : 'sem resultado'}${t.detalhe ? `: ${t.detalhe}` : ''}` };
      await carregar();
      desenharPainel();
    }),
    historico: (c) => {
      if (est.historico?.id === c.id) { est.historico = null; desenharPainel(); return undefined; }
      return agir('historico', 'lendo o histórico…', () => ponte.historico(c.id), async (r) => {
        est.historico = r?.ok ? { id: c.id, usos: Array.isArray(r.dados?.usos) ? r.dados.usos : [] } : { id: c.id, erro: erroDe(r, 'não consegui ler o histórico') };
        est.msg = null;
        desenharPainel();
      });
    },
    'apagar-sim': (c) => agir('apagar', 'apagando…', () => ponte.apagar(c.nome), async (r) => {
      if (!r?.ok) { falhou(r, 'o cofre não apagou'); return; }
      selecionar(null);
      est.msg = { tipo: 'ok', texto: `${c.nome} foi para a lixeira` };
      await carregar();
    }),
    restaurar: (c) => agir('restaurar', 'restaurando…', () => ponte.restaurar(c.id), async (r) => {
      if (!r?.ok) { falhou(r, 'o cofre não restaurou'); return; }
      est.vista = 'credenciais';
      selecionar(r.dados?.credencial?.nome ?? c.nome);
      est.msg = { tipo: 'ok', texto: 'restaurada' };
      await carregar();
    }),
  };

  painel.addEventListener('click', (ev) => {
    const alvo = ev.target.closest('[data-sel]');
    if (alvo) { selecionar(alvo.dataset.sel); desenhar(); return; }
    const b = ev.target.closest('[data-faz]');
    if (!b || b.disabled) return;
    const acao = ACOES[b.dataset.faz];
    const c = est.vista === 'lixeira' ? apagadaAtual() : credAtual();
    if (acao) acao(c);
  });

  painel.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (est.ocupado !== null) return;
    const c = credAtual();
    if (ev.target.id === 'form-nova') { guardarNova(false); return; }
    if (ev.target.id === 'form-trocar' && c) { trocarValor(c, false); return; }
    if (ev.target.id === 'form-editar' && c) {
      const m = mudancasDaEdicao(c);
      if (Object.keys(m).length === 0) { est.msg = { tipo: 'espera', texto: 'nada mudou' }; atualizarMsg(); return; }
      agir('editar', 'guardando…', () => ponte.editar(c.nome, m), async (r) => {
        if (!r?.ok) { falhou(r, 'o cofre não guardou'); return; }
        est.modo = null;
        est.msg = { tipo: 'ok', texto: 'guardado' };
        await carregar();
      });
    }
  });

  lista.addEventListener('click', (ev) => {
    const alvo = ev.target.closest('[data-sel]');
    if (!alvo) return;
    selecionar(alvo.dataset.sel);
    desenhar();
  });

  for (const c of chips) c.addEventListener('click', () => { if (est.vista === c.dataset.vista) return; est.vista = c.dataset.vista; selecionar(null); desenhar(); });
  for (const el of Object.values(filtro)) el.addEventListener('change', () => desenharLista());
  busca.addEventListener('input', () => desenharLista());
  $('nova').addEventListener('click', () => { selecionar(null); est.vista = 'credenciais'; est.modo = 'nova'; desenhar(); $('n-nome')?.focus(); });
  $('duplicatas').addEventListener('click', () => agir('duplicatas', 'conferindo os valores…', () => ponte.saude(true), async (r) => {
    if (r?.ok && r.dados) { est.saude = r.dados; est.duplicatas = r.dados.duplicatas || { pares: [], naoAbriram: [] }; est.msg = null; } else falhou(r, 'a conferência não rodou');
    est.sel = null;
    est.modo = null;
    desenhar();
  }));

  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (est.revelado) { esconder(); return; }
    if (est.modo !== null && est.ocupado === null) { est.modo = null; est.msg = null; desenharPainel(); }
  });
  window.addEventListener('blur', () => { if (est.revelado && est.ocupado === null) esconder(); });
  window.addEventListener('focus', () => { if (est.ocupado === null && Date.now() - lidoEm > 10000) carregar(); });
  // Para a bancada: o estado sem o valor revelado.
  window.omniCofreDepurar = () => ({ vista: est.vista, sel: est.sel, modo: est.modo, ocupado: est.ocupado, msg: est.msg, total: est.creds.length, lixeira: est.lixeira.length, revelado: est.revelado !== null, erroLeitura: est.erroLeitura });

  (async () => {
    desenhar();
    try { await ponte.esvaziar(); } catch { /* a leitura abaixo mostra o erro, se houver */ }
    await carregar();
  })();
})();
