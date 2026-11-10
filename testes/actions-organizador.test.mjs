// Actions organizador (21/10): ciclo dos pontos, mesa de decisão, escrita da tela e aprovação por reação.
// Tudo numa cópia temporária: OMNI_ACTIONS e APPDATA apontam para pastas descartáveis antes dos imports.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const raiz = mkdtempSync(join(tmpdir(), 'actions-teste-'))
const appdata = mkdtempSync(join(tmpdir(), 'appdata-teste-'))
process.env.OMNI_ACTIONS = raiz
process.env.APPDATA = appdata
mkdirSync(join(raiz, 'pontos'))
mkdirSync(join(raiz, 'visitas'))

const require = createRequire(import.meta.url)
const ilha = (n) => require(fileURLToPath(new URL(`../apps/omni-ilha/${n}`, import.meta.url)))
const pontos = ilha('pontos.js')
const escrita = ilha('escrita.js')
const { montarMesa } = ilha('mesa.js')
const aprov = await import(new URL('../servicos/whatsapp/omni/aprovacoes.mjs', import.meta.url))

const AGORA = new Date(2026, 9, 21, 9, 0).getTime() // 21/10/2026 09:00
const ponto = (slug, extra = '', historico = '- 01/10/2026 — criado') => writeFileSync(join(raiz, 'pontos', `${slug}.md`),
  `# Título ${slug}\n\n**Status:** capturado\n**Aberto em:** 01/10/2026\n**Origem:** teste\n${extra}\n## Contexto\nalgo\n\n## Histórico\n${historico}\n\n## Depois\nseção depois do histórico\n`)
const projetos = (texto) => writeFileSync(join(raiz, 'projetos.md'), texto)

test.after(() => { rmSync(raiz, { recursive: true, force: true }); rmSync(appdata, { recursive: true, force: true }) })

test('ponto: campos do ciclo, prazo vencido e ▲▲▲ sem teste rebaixado', () => {
  ponto('a', '**Estágio:** semente\n**Prazo do veredito:** 20/10/2026\n**Potencial:** ▲▲▲ — serve à bot\n')
  // relógio fixo em 21/10: com o relógio real o prazo de 30/10 vence e o teste vira bomba-relógio
  const lerEm = (slug) => pontos.resumir(slug, pontos.lerArquivo(slug).texto, 0, AGORA)
  assert.equal(pontos.lerPonto('a').estagio, 'semente')
  const p = lerEm('a')
  assert.equal(p.estagio, 'semente')
  assert.equal(p.vencido, true, 'prazo 20/10 já passou em 21/10')
  assert.equal(p.potencial.nivel, 2, '▲▲▲ sem teste vira ▲▲')
  assert.equal(p.potencial.rebaixado, true)
  assert.equal(p.potencial.motivo, 'serve à bot')
  ponto('b', '**Estágio:** em teste\n**Prazo do veredito:** 30/10/2026\n**Potencial:** ▲▲▲ — teste passou\n')
  const b = lerEm('b')
  assert.equal(b.potencial.nivel, 3, 'em teste mantém ▲▲▲')
  assert.equal(b.vencido, false)
})

test('ponto: cabeçalho sem "Aberto em" é ilegível e a escrita recusa', () => {
  writeFileSync(join(raiz, 'pontos', 'quebrado.md'), '# Quebrado\n\n**Status:** x\n')
  assert.equal(pontos.lerPonto('quebrado').ilegivel, true)
  assert.throws(() => escrita.mexerNoPonto('quebrado', { historico: 'x' }), /cabeçalho ilegível/)
  assert.equal(readFileSync(join(raiz, 'pontos', 'quebrado.md'), 'utf8'), '# Quebrado\n\n**Status:** x\n', 'arquivo intacto')
})

test('escrita: campo novo entra no cabeçalho e histórico entra no fim da seção, sem mexer no resto', () => {
  ponto('c')
  const antes = readFileSync(join(raiz, 'pontos', 'c.md'), 'utf8')
  escrita.mexerNoPonto('c', { campos: { 'Próximo passo': 'rodar o exemplo' }, historico: 'visita testou' })
  const depois = readFileSync(join(raiz, 'pontos', 'c.md'), 'utf8')
  assert.match(depois, /\*\*Origem:\*\* teste\n\*\*Próximo passo:\*\* rodar o exemplo\n/)
  assert.match(depois, /- 01\/10\/2026 — criado\n- \d{2}\/\d{2}\/\d{4} — visita testou\n\n## Depois/)
  // nada do que existia sumiu: o antes, sem as duas linhas novas, é igual
  const semNovas = depois.split('\n').filter((l) => !l.startsWith('**Próximo passo:**') && !/— visita testou$/.test(l)).join('\n')
  assert.equal(semNovas, antes)
})

test('escrita: preserva CRLF do arquivo', () => {
  writeFileSync(join(raiz, 'pontos', 'crlf.md'), '# T\r\n\r\n**Status:** x\r\n**Aberto em:** 01/10/2026\r\n\r\n## Histórico\r\n- 01/10/2026 — criado\r\n')
  escrita.mexerNoPonto('crlf', { campos: { 'Estágio': 'semente' }, historico: 'ok' })
  const t = readFileSync(join(raiz, 'pontos', 'crlf.md'), 'utf8')
  assert.equal(t.split('\n').every((l, i, a) => i === a.length - 1 || l.endsWith('\r')), true)
})

test('veredito: arquivar exige motivo; arquivado vai para "não deram certo" e limpa proposta', () => {
  ponto('d', '**Proposta de veredito:** arquivar — perdeu do acaso\n**Pra você:** olhar o backtest\n')
  assert.throws(() => escrita.registrarVeredito('d', { tipo: 'arquivado', motivo: ' ' }), /motivo/)
  escrita.registrarVeredito('d', { tipo: 'arquivado', motivo: 'perdeu do acaso' })
  const p = pontos.lerPonto('d')
  assert.equal(p.veredito.tipo, 'arquivado')
  assert.equal(p.proposta, '')
  assert.equal(p.praVoce, '')
  assert.match(p.texto, /— Veredito: arquivado\. Motivo: perdeu do acaso \(pela tela do Actions\)/)
})

test('veredito "entra em": item no checklist do projeto e ideia ligada; projeto inexistente não escreve nada', () => {
  projetos('# Projetos\n\n## Bot vendedora\n**Fase:** x\n**Plano de origem:** —\n**Ideias ligadas:** —\n**Entregas:**\n- [ ] Primeira — 01/12/2026\n\n## Omni\n**Fase:** y\n')
  ponto('e')
  const antes = readFileSync(join(raiz, 'pontos', 'e.md'), 'utf8')
  assert.throws(() => escrita.registrarVeredito('e', { tipo: 'entra', projeto: 'Não existe' }), /não está no projetos\.md/)
  assert.equal(readFileSync(join(raiz, 'pontos', 'e.md'), 'utf8'), antes, 'ponto intacto quando o projeto não existe')
  escrita.registrarVeredito('e', { tipo: 'entra', projeto: 'Bot vendedora', motivo: 'qualifica lead' })
  const pr = readFileSync(join(raiz, 'projetos.md'), 'utf8')
  assert.match(pr, /- \[ \] Primeira — 01\/12\/2026\n- \[ \] Integrar "Título e" \(ponto e\)\n/)
  assert.match(pr, /\*\*Ideias ligadas:\*\* e\n/)
  assert.equal(pontos.lerPonto('e').projetoLigado, 'Bot vendedora')
})

test('dormente: exige data; volta a pedir veredito quando a data passa', () => {
  ponto('f')
  assert.throws(() => escrita.registrarVeredito('f', { tipo: 'dormente', ate: '' }), /data/)
  escrita.registrarVeredito('f', { tipo: 'dormente', ate: '15/10/2026' })
  assert.equal(pontos.resumir('f', readFileSync(join(raiz, 'pontos', 'f.md'), 'utf8'), 0, AGORA).vencido, true)
})

test('item: marcar, linha mudou no meio recusa, proposto aceita e recusa, caminho de fora recusa', () => {
  projetos('# P\n\n## Omni\n**Plano de origem:** —\n**Entregas:**\n- [ ] Alfa — 10/10/2026\n- [ ] Beta (proposto pelo Omni)\n')
  const arquivo = join(raiz, 'projetos.md')
  const { projetos: lista } = ilha('projetos.js').lerProjetos(AGORA)
  const [alfa, beta] = lista[0].itens
  assert.equal(alfa.dias < 0, true)
  assert.equal(beta.proposto, true)
  escrita.mexerNoItem(alfa, 'marcar')
  assert.match(readFileSync(arquivo, 'utf8'), /- \[x\] Alfa — 10\/10\/2026/)
  assert.throws(() => escrita.mexerNoItem(alfa, 'desmarcar'), /mudou/, 'a tela tinha a linha antiga')
  escrita.mexerNoItem(beta, 'aceitar')
  assert.match(readFileSync(arquivo, 'utf8'), /- \[ \] Beta\n?$/m)
  assert.throws(() => escrita.mexerNoItem({ arquivo: join(appdata, 'x.md'), linha: 0, bruto: '' }, 'marcar'), /fora do Actions/)
  escrita.proporItem('Omni', 'Gama', '01/12/2026')
  const gama = ilha('projetos.js').lerProjetos(AGORA).projetos[0].itens.find((i) => i.titulo === 'Gama')
  escrita.mexerNoItem(gama, 'recusar')
  assert.doesNotMatch(readFileSync(arquivo, 'utf8'), /Gama/)
})

test('plano de origem: espelha checkbox de lá; sumido fica só leitura com aviso', () => {
  const plano = join(raiz, 'plano-station.md')
  writeFileSync(plano, '# Plano\n- [ ] Go-live — 05/11/2026\n')
  projetos(`# P\n\n## Station\n**Plano de origem:** ${plano}\n**Entregas:**\n\n## Fantasma\n**Plano de origem:** ${join(raiz, 'nao-existe.md')}\n`)
  const [st, fa] = ilha('projetos.js').lerProjetos(AGORA).projetos
  assert.equal(st.itens.length, 1)
  assert.equal(st.itens[0].fonte, 'origem')
  escrita.mexerNoItem(st.itens[0], 'marcar')
  assert.match(readFileSync(plano, 'utf8'), /- \[x\] Go-live/, 'o check gravou no plano de origem')
  assert.equal(fa.somenteLeitura, true)
  assert.match(fa.aviso, /sumiu/)
})

test('mesa: pra você junta conserto, entrega vencida, veredito, teste e item proposto', () => {
  for (const n of ['a', 'b', 'c', 'crlf', 'd', 'e', 'f', 'quebrado']) rmSync(join(raiz, 'pontos', `${n}.md`), { force: true })
  ponto('venceu', '**Prazo do veredito:** 01/10/2026\n**Proposta de veredito:** arquivar — sem uso\n')
  ponto('teste', '**Estágio:** em teste\n**Pra você:** olhar pontos/teste/testes/saida.txt\n**Potencial:** ▲▲ — passou no exemplo\n')
  ponto('morto', '**Veredito:** arquivado — margem negativa\n')
  writeFileSync(join(raiz, 'pontos', 'torto.md'), '# Torto\n')
  projetos('# P\n\n## Omni\n**Entregas:**\n- [ ] Atrasada — 01/10/2026\n- [ ] Nova (proposto pelo Omni)\n')
  writeFileSync(join(raiz, 'visitas', '2026-10-21-0704.md'), '# Visita\n**Situação:** concluída\n**Resumo:** cruzei 2, testei 1\n')
  const m = montarMesa(Date.now())
  assert.deepEqual(m.praVoce.map((p) => p.tipo), ['conserto', 'entrega', 'veredito', 'teste', 'item-proposto'])
  assert.equal(m.praVoce.find((p) => p.tipo === 'veredito').texto, 'arquivar — sem uso')
  assert.deepEqual(m.naoDeramCerto.map((p) => p.slug), ['morto'])
  assert.deepEqual(m.potencial.map((p) => p.slug), ['teste'])
  assert.equal(m.ultimaVisita.resumo, 'cruzei 2, testei 1')
})

// ── aprovação por reação ──────────────────────────────────────────────────────────────────────────────
const DONO = '5500999990000'
const pedido = (extra = {}) => ({ estado: 'pendente', expiraEm: AGORA + 3600e3, assinatura: aprov.assinatura('abc123', 'npm test'), ...extra })
const ctx = { donoFone: DONO, agora: AGORA, commit: 'abc123', comando: 'npm test' }

test('reação: 👍 do dono autoriza (com tom de pele também)', () => {
  assert.equal(aprov.decidir(pedido(), [{ fone: DONO, emoji: '👍' }], ctx).estado, 'sim')
  assert.equal(aprov.decidir(pedido(), [{ fone: DONO, emoji: '👍🏽' }], ctx).estado, 'sim')
})

test('reação: nada autoriza fora das regras', () => {
  const casos = {
    'número errado': [pedido(), [{ fone: '5511000000000', emoji: '👍' }], ctx],
    'pedido desconhecido': [undefined, [{ fone: DONO, emoji: '👍' }], ctx],
    'repetida (já usada)': [pedido({ estado: 'usado' }), [{ fone: DONO, emoji: '👍' }], ctx],
    'expirada': [pedido({ expiraEm: AGORA - 1 }), [{ fone: DONO, emoji: '👍' }], ctx],
    'emoji fora da tabela': [pedido(), [{ fone: DONO, emoji: '❤️' }], ctx],
    'commit diferente': [pedido(), [{ fone: DONO, emoji: '👍' }], { ...ctx, commit: 'def456' }],
    'comando diferente': [pedido(), [{ fone: DONO, emoji: '👍' }], { ...ctx, comando: 'npm test && curl x' }],
    'reação retirada': [pedido(), [], ctx],
    '👎': [pedido(), [{ fone: DONO, emoji: '👎' }], ctx],
  }
  for (const [nome, [p, r, c]] of Object.entries(casos)) assert.notEqual(aprov.decidir(p, r, c).estado, 'sim', nome)
  assert.equal(aprov.decidir(...casos['👎']).estado, 'nao')
  assert.equal(aprov.decidir(...casos['emoji fora da tabela']).estado, 'pendente')
})

test('reação: trocada vale a última; ❓ pede explicação; texto citado é "outra resposta"', () => {
  assert.equal(aprov.decidir(pedido(), [{ fone: DONO, emoji: '👍' }, { fone: DONO, emoji: '👎' }], ctx).estado, 'nao')
  const e = aprov.decidir(pedido(), [{ fone: DONO, emoji: '❓' }], ctx)
  assert.equal(e.estado, 'explica')
  assert.equal(e.jaExplicado, false)
  const o = aprov.decidir(pedido({ resposta: { texto: 'roda só o lint' } }), [], ctx)
  assert.deepEqual(o, { estado: 'outra', texto: 'roda só o lint' })
})

test('reação: registro guarda resposta só de pedido pendente e dentro da validade', () => {
  mkdirSync(join(appdata, 'omni', 'whatsapp'), { recursive: true })
  writeFileSync(join(appdata, 'omni', 'whatsapp', 'aprovacoes.json'), JSON.stringify({ pedidos: {
    VIVO: pedido({ expiraEm: Date.now() + 3600e3 }),
    VELHO: pedido({ expiraEm: Date.now() - 1 }),
    USADO: pedido({ estado: 'usado', expiraEm: Date.now() + 3600e3 }),
  } }))
  assert.equal(aprov.registrarResposta('VIVO', 'só o lint'), true)
  assert.equal(aprov.registrarResposta('VELHO', 'x'), false)
  assert.equal(aprov.registrarResposta('USADO', 'x'), false)
  assert.equal(aprov.registrarResposta('NAO-EXISTE', 'x'), false)
  assert.equal(aprov.carregar().pedidos.VIVO.resposta.texto, 'só o lint')
  assert.deepEqual(aprov.pendentes().map((p) => p.waId), ['VIVO'])
})

test('cota: terceira proposta de veredito do dia é recusada pelo script da visita', async () => {
  const { execFileSync } = await import('node:child_process')
  const script = fileURLToPath(new URL('../scripts/omni-actions.mjs', import.meta.url))
  for (const s of ['p1', 'p2', 'p3']) ponto(s)
  const rodar = (...a) => { try { return JSON.parse(execFileSync(process.execPath, [script, ...a], { env: { ...process.env }, encoding: 'utf8', windowsHide: true })) } catch (e) { return JSON.parse(e.stdout) } }
  assert.equal(rodar('propor-veredito', 'p1', 'arquivar — sem uso').ok, true)
  assert.equal(rodar('propor-veredito', 'p2', 'arquivar — sem uso').ok, true)
  const terceira = rodar('propor-veredito', 'p3', 'arquivar — sem uso')
  assert.equal(terceira.ok, false)
  assert.match(terceira.erro, /cota de hoje esgotada/)
  assert.equal(pontos.lerPonto('p3').proposta, '', 'a terceira não escreveu')
  assert.match(rodar('campo', 'p1', 'Estágio', 'veredito').erro, /só pela tela/)
  assert.match(rodar('campo', 'p1', 'Veredito', 'x').erro, /não permitido/)
  process.env.OMNI_VISITA_SECO = '1'
  assert.match(rodar('avisar', 'oi').erro, /a seco/)
  delete process.env.OMNI_VISITA_SECO
})

// ── execuções (22/10): mandar executar pela tela, escolher onde o trabalho mora, devolver andamento ────
test('execução: criar exige instrução e origem; herda o projeto ligado do ponto; deixa rastro no ponto', () => {
  const ex$ = ilha('execucoes.js')
  projetos('# P\n\n## Omni\n**Pasta:** C:\\Users\\x\\Omni\n**Fase:** f\n**Entregas:**\n- [ ] Alfa — 01/12/2026\n')
  ponto('exe', '**Projeto ligado:** Omni\n**Próximo passo:** rodar o protótipo\n')
  assert.throws(() => ex$.criar({ slug: 'exe', instrucao: '  ' }), /o que é para fazer/)
  assert.throws(() => ex$.criar({ instrucao: 'x' }), /ponto ou de um projeto/)
  const ex = ex$.criar({ slug: 'exe', instrucao: 'faz o protótipo com teste' })
  assert.equal(ex.projeto, 'Omni')
  assert.equal(ex.estado, 'na fila')
  assert.match(pontos.lerPonto('exe').texto, new RegExp(`Execução ${ex.id}: mandada executar`))
  const r = ex$.responder(ex.id, 'usa a pasta testes/')
  assert.equal(r.eventos.at(-1).resposta, 'usa a pasta testes/')
  ex$.atualizar(ex.id, { estado: 'bloqueada', nota: 'qual banco?' })
  const m = montarMesa(Date.now())
  const pede = m.praVoce.find((p) => p.execucao === ex.id)
  assert.equal(pede.tipo, 'execucao')
  assert.match(pede.texto, /qual banco\?/)
  ex$.visto(ex.id)
  assert.equal(montarMesa(Date.now()).praVoce.some((p) => p.execucao === ex.id), false)
  assert.throws(() => ex$.atualizar(ex.id, { estado: 'inventado' }), /estado/)
  assert.equal(ex$.ler('../../etc'), null, 'id fora do formato não vira caminho')
  assert.throws(() => ex$.atualizar('../../etc', { estado: 'andando' }), /inválida/)
})

test('execução: destino é a sessão da pasta do projeto; senão Actions; senão a ociosa mais nova do Omni', () => {
  const { escolherDestino } = ilha('execucoes.js')
  const S = [
    { nome: 'omni-a0', cwd: 'C:\\Users\\x\\Omni', status: 'busy', startedAt: 1 },
    { nome: 'omni-24', cwd: 'c:\\users\\x\\omni', status: 'idle', startedAt: 5 },
    { nome: 'omni-old', cwd: 'C:\\Users\\x\\Omni', status: 'idle', startedAt: 2 },
    { nome: 'station-1', cwd: 'C:\\Users\\x\\Station\\sub', status: 'busy', startedAt: 3 },
    { nome: 'station-2', cwd: 'C:\\Users\\x\\Station', status: 'idle', startedAt: 1 },
  ]
  const base = { pastaActions: 'C:\\Users\\x\\Actions', pastaOmni: 'C:\\Users\\x\\Omni' }
  assert.equal(escolherDestino(S, { ...base, pastaProjeto: 'C:\\Users\\x\\Station' }).nome, 'station-2', 'ociosa da pasta do projeto primeiro')
  assert.equal(escolherDestino([{ nome: 'irma', cwd: 'C:\\Users\\x\\StationNova', status: 'idle', startedAt: 9 }, S[1]], { ...base, pastaProjeto: 'C:\\Users\\x\\Station' }).nome, 'omni-24', 'sessão em pasta irmã com prefixo igual não conta')
  assert.equal(escolherDestino([...S, { nome: 'actions-9', cwd: 'C:\\Users\\x\\Actions', status: 'busy', startedAt: 0 }], { ...base }).nome, 'actions-9')
  assert.equal(escolherDestino(S.filter((s) => s.status === 'busy' && !s.cwd.includes('Station')), base), null, 'Omni ocupado não recebe')
})

test('execução: o pedido montado leva instrução, contexto, regras e o jeito de devolver', () => {
  const ex$ = ilha('execucoes.js')
  const ex = { id: '20261022-101010-abcd', instrucao: 'migra o card', eventos: [] }
  const pr = { nome: 'Omni', pasta: 'C:\\O', fase: 'f', dor: 'd', itens: [{ titulo: 'Alfa', data: '01/12/2026' }, { titulo: 'Beta', proposto: true }] }
  const t = ex$.montarPedido(ex, { projeto: pr, ponto: { slug: 'exe', titulo: 'T', proximoPasso: 'rodar', potencial: { nivel: 2, motivo: 'm' } }, scriptActions: 'S.mjs' })
  for (const trecho of ['migra o card', 'Pasta: C:\\O', '- Alfa — 01/12/2026', 'Próximo passo registrado: rodar', 'Sem push', 'node "S.mjs" execucao 20261022-101010-abcd --estado concluida'])
    assert.ok(t.includes(trecho), trecho)
  assert.ok(!t.includes('Beta'), 'item só proposto não vira entrega')
  const r = ex$.montarPedido(ex, { scriptActions: 'S.mjs', resposta: 'usa o banco de homolog' })
  assert.match(r, /^Resposta do Weriton/)
  assert.match(r, /usa o banco de homolog/)
})