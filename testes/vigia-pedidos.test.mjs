// Vigia de pedidos parados (relatório de 04/11/2026): registro, dona morta, sem progresso, trava de
// morta e repetição de hora em hora. Tudo em pastas descartáveis; nada toca C:\tmp nem o WhatsApp.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, utimesSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const SCRIPT = fileURLToPath(new URL('../servicos/whatsapp/omni/vigia-pedidos.mjs', import.meta.url))
const v = await import(new URL('../servicos/whatsapp/omni/vigia-pedidos.mjs', import.meta.url))
const MIN = 60_000
const AGORA = Date.parse('2026-11-04T14:00:00Z')

const linha = o => JSON.stringify(o) + '\n'
const prompt = (texto, ts, promptId) => linha({ type: 'user', promptId, uuid: promptId, timestamp: ts, cwd: 'C:\\x', gitBranch: 'feat/x', message: { role: 'user', content: texto } })
const bg = (id, ts) => linha({ type: 'user', timestamp: ts, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: `Command running in background with ID: ${id}. Output is being written to: x` }] } })
const notif = (id, ts) => linha({ type: 'user', timestamp: ts, message: { role: 'user', content: `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n</task-notification>` } })
const par = (de, texto, ts) => linha({ type: 'user', timestamp: ts, message: { role: 'user', content: `Another Claude session sent a message:\n<cross-session-message from="uds:x" from-name="${de}" from-mode="prompting">\n${texto}\n</cross-session-message>` } })

test('textoDoPrompt: só o que o Weriton digitou entra; ruído de sistema e de par fica fora', () => {
  assert.equal(v.textoDoPrompt({ type: 'user', message: { content: 'sobe a tela da lista' } }), 'sobe a tela da lista')
  assert.equal(v.textoDoPrompt({ type: 'user', message: { content: '<task-notification>x</task-notification>' } }), null)
  assert.equal(v.textoDoPrompt({ type: 'user', message: { content: 'Another Claude session sent a message: oi' } }), null)
  assert.equal(v.textoDoPrompt({ type: 'user', isMeta: true, message: { content: 'meta' } }), null)
  assert.equal(v.textoDoPrompt({ type: 'user', message: { content: [{ type: 'tool_result', content: 'x' }] } }), null)
  assert.equal(v.textoDoPrompt({ type: 'user', message: { content: '<system-reminder>r</system-reminder>\nfaz o deploy' } }), null, 'começa com system-reminder: é injeção, não prompt')
  assert.equal(v.textoDoPrompt({ type: 'user', message: { content: [{ type: 'text', text: 'faz o deploy <ide_selection>sel</ide_selection>' }] } }), 'faz o deploy')
})

test('delegacaoDePar: trabalho que a coordenadora manda vira pedido com o nome de quem mandou', () => {
  const r = JSON.parse(par('reengenharia-station-growth-2a', 'faz a lista em 5 seções', '2026-11-03T19:00:00Z'))
  assert.deepEqual(v.delegacaoDePar(r), { de: 'reengenharia-station-growth-2a', texto: 'faz a lista em 5 seções' })
})

test('lerTranscricao: tarefa em segundo plano sem retorno fica pendente; com retorno sai; leitura é incremental', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vp-tr-'))
  const arq = join(dir, 'aaaa1111.jsonl')
  writeFileSync(arq, prompt('sobe a tela', '2026-11-03T19:00:00Z', 'p1') + bg('b1', '2026-11-03T20:00:00Z') + bg('b2', '2026-11-03T20:10:00Z') + notif('b1', '2026-11-03T20:20:00Z'))
  const m1 = v.lerTranscricao(arq, {})
  assert.deepEqual([...m1.pendentes], ['b2'])
  assert.equal(m1.prompts.length, 1)
  assert.equal(m1.ramo, 'feat/x')
  appendFileSync(arq, notif('b2', '2026-11-03T20:30:00Z') + '{"type":"user","mess')   // última linha incompleta
  const m2 = v.lerTranscricao(arq, { offset: m1.offset, pendentes: [...m1.pendentes] })
  assert.deepEqual([...m2.pendentes], [], 'retorno do b2 lido só na parte nova')
  assert.equal(m2.prompts.length, 0, 'prompt antigo não é relido')
  assert.ok(m2.offset < readFileSync(arq).length, 'linha incompleta fica para a próxima passada')
})

const pedido = (id, sessao, estado, at, extra = {}) => [id, { id, sessao, estado, at, texto: `pedido ${id}`, ultimoSinal: at, eventos: [], ...extra }]
const base = over => ({ agora: AGORA, pedidos: new Map(), sessoes: new Map(), transcricoes: new Map(), vivos: new Set(), travas: [], sinalGit: () => 0, ...over })

test('avaliar: dona morta só com tarefa em segundo plano pendurada NÃO avisa (sessão encerrou o expediente, não abandonou pedido)', () => {
  const a = v.avaliar(base({
    pedidos: new Map([pedido('p-1', 's1', 'nao_classificado', AGORA - 18 * 60 * MIN)]),
    transcricoes: new Map([['s1', { mtime: AGORA - 17 * 60 * MIN, pendentes: new Set(['byx']) }]]),
  }))
  assert.deepEqual(a, [], 'marcador de subagente pendurado de sessão morta é ruído, não pedido parado')
})

test('avaliar: dona morta com pedido CLASSIFICADO vira aviso com o id do pedido', () => {
  const a = v.avaliar(base({
    pedidos: new Map([pedido('p-1', 's1', 'aberto', AGORA - 18 * 60 * MIN)]),
    transcricoes: new Map([['s1', { mtime: AGORA - 17 * 60 * MIN, pendentes: new Set(['byx']) }]]),
  }))
  assert.equal(a.length, 1)
  assert.equal(a[0].tipo, 'dona-morta')
  assert.match(a[0].texto, /p-1/)
  assert.match(a[0].texto, /\?$/, 'termina numa pergunta só')
})

test('avaliar: dona morta que fechou o turno sem nada pendurado é conversa encerrada, sem aviso', () => {
  const a = v.avaliar(base({
    pedidos: new Map([pedido('p-1', 's1', 'nao_classificado', AGORA - 3 * 60 * MIN)]),
    transcricoes: new Map([['s1', { mtime: AGORA - 2 * 60 * MIN, pendentes: new Set() }]]),
  }))
  assert.deepEqual(a, [])
})

test('avaliar: processo vivo segura a sessão mesmo com transcrição parada', () => {
  const a = v.avaliar(base({
    pedidos: new Map([pedido('p-1', 's1', 'nao_classificado', AGORA - 60 * MIN)]),
    sessoes: new Map([['s1', { sessionId: 's1', pid: 4242, name: 'x-aa' }]]),
    vivos: new Set([4242]),
    transcricoes: new Map([['s1', { mtime: AGORA - 50 * MIN, pendentes: new Set(['b']) }]]),
  }))
  assert.deepEqual(a, [])
})

test('avaliar: sem lista de processos não afirma morte', () => {
  const a = v.avaliar(base({
    vivos: null,
    pedidos: new Map([pedido('p-1', 's1', 'aberto', AGORA - 30 * MIN)]),
    sessoes: new Map([['s1', { sessionId: 's1', pid: 1 }]]),
    transcricoes: new Map([['s1', { mtime: AGORA - 25 * MIN, pendentes: new Set(['b']) }]]),
  }))
  assert.deepEqual(a, [])
})

test('avaliar: trava no nome de dona morta avisa e pergunta se pode anular', () => {
  const a = v.avaliar(base({
    pedidos: new Map([pedido('p-9', 'sz', 'nao_classificado', AGORA - 40 * MIN, { nomeSessao: 'simulacao-zz' })]),
    transcricoes: new Map([['sz', { mtime: AGORA - 30 * MIN, pendentes: new Set() }]]),
    travas: [{ caminho: 'C:\\teste\\x.lock', texto: '-zz/teste', tag: 'zz', mtime: AGORA - 35 * MIN, hash: 'h1' }],
  }))
  assert.equal(a.length, 1)
  assert.equal(a[0].tipo, 'trava-de-morta')
  assert.match(a[0].texto, /p-9/)
  assert.match(a[0].texto, /Posso anular a trava da -zz/)
})

test('avaliar: trava com dona viva não avisa; parada há só 10 min também não', () => {
  const tr = { caminho: 'C:\\t.lock', texto: '-zz/x', tag: 'zz', mtime: AGORA - 90 * MIN, hash: 'h' }
  const viva = v.avaliar(base({ sessoes: new Map([['sz', { sessionId: 'sz', pid: 7, name: 'proj-zz' }]]), vivos: new Set([7]), travas: [tr],
    transcricoes: new Map([['sz', { mtime: AGORA - 80 * MIN, pendentes: new Set() }]]) }))
  assert.deepEqual(viva, [])
  const recente = v.avaliar(base({ sessoes: new Map([['sz', { sessionId: 'sz', pid: 7, name: 'proj-zz' }]]), travas: [tr],
    transcricoes: new Map([['sz', { mtime: AGORA - 10 * MIN, pendentes: new Set() }]]) }))
  assert.deepEqual(recente, [])
})

test('avaliar: pedido classificado com dona viva e 61 min sem sinal avisa; commit recente segura', () => {
  const entrada = { pedidos: new Map([pedido('p-2', 's2', 'em_prova', AGORA - 3 * 60 * MIN)]),
    sessoes: new Map([['s2', { sessionId: 's2', pid: 9, name: 'p-q2' }]]), vivos: new Set([9]),
    transcricoes: new Map([['s2', { mtime: AGORA - MIN, pendentes: new Set(), cwd: 'C:\\w', ramo: 'feat/y' }]]) }
  const parado = v.avaliar(base({ ...entrada, sinalGit: () => AGORA - 61 * MIN }))
  assert.equal(parado.length, 1)
  assert.equal(parado[0].tipo, 'sem-progresso')
  assert.match(parado[0].texto, /O pedido p-2 ainda vale/)
  const andando = v.avaliar(base({ ...entrada, sinalGit: () => AGORA - 5 * MIN }))
  assert.deepEqual(andando, [])
})

test('filtrarRepeticao: mesmo achado só volta depois de 1 h', () => {
  const achados = [{ chave: 'k' }]
  assert.equal(v.filtrarRepeticao(achados, {}, AGORA).length, 1)
  assert.equal(v.filtrarRepeticao(achados, { k: { ultimo: AGORA - 59 * MIN } }, AGORA).length, 0)
  assert.equal(v.filtrarRepeticao(achados, { k: { ultimo: AGORA - 60 * MIN } }, AGORA).length, 1)
})

test('ponta a ponta: dona fictícia + .jsonl parado + trava falsa → aviso com o id, repetido só depois de 1 h, some ao dispensar', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'vp-e2e-'))
  const projetos = join(raiz, 'projects'); const proj = join(projetos, 'proj-teste'); mkdirSync(proj, { recursive: true })
  const sessoes = join(raiz, 'sessions'); mkdirSync(sessoes)
  const registro = join(raiz, 'pedidos.jsonl'); const estado = join(raiz, 'estado.json'); const saida = join(raiz, 'saida.jsonl')
  const feed = join(raiz, 'feed.jsonl'); const config = join(raiz, 'config.json'); const trava = join(raiz, 'trava-teste.lock')
  const sid = 'dead0000-0000-0000-0000-000000000001'
  const tr = join(proj, `${sid}.jsonl`)
  const t0 = AGORA - 40 * MIN
  writeFileSync(tr, prompt('simulação: sobe a tela X', new Date(t0).toISOString(), 'pp1') + bg('bzz', new Date(t0 + 5 * MIN).toISOString()))
  utimesSync(tr, new Date(AGORA - 30 * MIN), new Date(AGORA - 30 * MIN))
  writeFileSync(join(sessoes, '999991.json'), JSON.stringify({ pid: 999991, sessionId: sid, name: 'simulacao-zz', updatedAt: t0 }))
  writeFileSync(trava, '-zz/simulacao 2026-11-04 13:25Z (e2e falso; feat/simulacao)')
  utimesSync(trava, new Date(AGORA - 35 * MIN), new Date(AGORA - 35 * MIN))
  writeFileSync(config, JSON.stringify({ travas: [trava] }))
  const roda = (agora, ...extra) => execFileSync(process.execPath, [SCRIPT, ...extra, '--registro', registro, '--projetos', projetos, '--sessoes', sessoes,
    '--estado', estado, '--config', config, '--feed', feed, '--envio', `arquivo:${saida}`, '--agora', String(agora)], { encoding: 'utf8' })

  const r1 = JSON.parse(roda(AGORA))
  assert.equal(r1.novosNoRegistro, 1)
  const ids = readFileSync(registro, 'utf8').trim().split('\n').map(l => JSON.parse(l).id)
  const msgs = readFileSync(saida, 'utf8').trim().split('\n').map(l => JSON.parse(l))
  assert.equal(msgs.length, 1, 'só o aviso da trava; tarefa em segundo plano pendurada de dona morta não gera aviso')
  assert.ok(msgs.every(m => m.texto.includes(ids[0])), 'o aviso leva o id do pedido')
  assert.ok(msgs.some(m => /Posso anular a trava da -zz\?/.test(m.texto)))
  assert.ok(existsSync(feed))

  roda(AGORA + 30 * MIN)
  assert.equal(readFileSync(saida, 'utf8').trim().split('\n').length, 1, '30 min depois: não repete')
  roda(AGORA + 61 * MIN)
  assert.equal(readFileSync(saida, 'utf8').trim().split('\n').length, 2, '61 min depois: repete o da trava')

  roda(AGORA + 62 * MIN, 'dispensar', ids[0], 'era simulação')
  rmSync(trava)   // quem decide soltou a trava: some o achado dela
  const r3 = JSON.parse(roda(AGORA + 130 * MIN))
  assert.equal(r3.achados, 0, 'pedido dispensado e trava solta: nada mais a avisar')
  assert.equal(readFileSync(saida, 'utf8').trim().split('\n').length, 2)
})

test('fechar exige sha e run; classificar não aceita "fechado" sem prova', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'vp-fecha-'))
  const registro = join(raiz, 'pedidos.jsonl')
  writeFileSync(registro, linha({ ev: 'novo', id: 'p-x', texto: 't', at: '2026-11-04T10:00:00Z', sessao: 's', estado: 'nao_classificado' }))
  const roda = (...a) => execFileSync(process.execPath, [SCRIPT, ...a, '--registro', registro], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  assert.throws(() => roda('classificar', 'p-x', 'fechado'), /fechar só com "fechar"/)
  assert.throws(() => roda('fechar', 'p-x'), /exige --sha/)
  roda('classificar', 'p-x', 'aberto', '--ramo', 'feat/z')
  const p = v.lerRegistro(registro).get('p-x')
  assert.equal(p.estado, 'aberto')
  assert.equal(p.ramo, 'feat/z')
})

test('proximaDaFila: com a fila real de 04/11, a próxima depois da -13 é a -66/P1-13', () => {
  const fila = [
    '2026-11-04 12:36Z -b9/lista-cinco-secoes: ANULADO por ordem do Weriton',
    '2026-11-04 12:36Z 2026-11-04 12:36Z (node:test api-agente; fix/gerry-propor-registra-pedido, migracao 151) -66/P1-20: INICIO, lock na mao',
    '2026-11-04 12:55Z -13/lista-cinco-secoes: NA FILA, proxima depois da -66/P1-20',
    '2026-11-04 13:11Z -66/P1-20: FIM, lock devolvido',
    '2026-11-04 13:11Z -66/P1-13: NA FILA, depois da -13/lista-cinco-secoes (feat/gerry-fora-do-horario-card, migracao 152)',
    '2026-11-04 13:12Z -13/lista-cinco-secoes: INICIO, lock na mao',
  ].join('\n')
  assert.equal(v.proximaDaFila(fila, '13')?.chave, '-66/P1-13')
  assert.equal(v.proximaDaFila(fila + '\n2026-11-04 14:00Z -66/P1-13: INICIO', '13'), null)
  assert.equal(v.proximaDaFila('', '13'), null)
})

test('queda automática: dona morta → linha na fila, trava some, aviso diz de quem era e a próxima; trava fora da lista só avisa', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'vp-queda-'))
  const projetos = join(raiz, 'projects'); const proj = join(projetos, 'p'); mkdirSync(proj, { recursive: true })
  const sessoes = join(raiz, 'sessions'); mkdirSync(sessoes)
  const sid = 'dead0000-0000-0000-0000-000000000002'
  const tr = join(proj, `${sid}.jsonl`)
  writeFileSync(tr, prompt('simulação: tela Y', new Date(AGORA - 40 * MIN).toISOString(), 'pq1'))
  utimesSync(tr, new Date(AGORA - 30 * MIN), new Date(AGORA - 30 * MIN))
  writeFileSync(join(sessoes, '999992.json'), JSON.stringify({ pid: 999992, sessionId: sid, name: 'simulacao-zy', updatedAt: AGORA - 40 * MIN }))
  const trava = join(raiz, 'trava-teste.lock'); const outra = join(raiz, 'outra.lock')
  const fila = join(raiz, 'fila.txt'); const saida = join(raiz, 'saida.jsonl')
  writeFileSync(trava, '-zy/tela-y 2026-11-04 13:20Z (e2e falso; feat/tela-y)')
  writeFileSync(outra, '-zy/tela-y 2026-11-04 13:20Z (outra trava)')
  for (const f of [trava, outra]) utimesSync(f, new Date(AGORA - 35 * MIN), new Date(AGORA - 35 * MIN))
  writeFileSync(fila, '2026-11-04 13:20Z -zy/tela-y: INICIO, lock na mao\n2026-11-04 13:25Z -ab/P9: NA FILA, depois da -zy\n')
  const config = join(raiz, 'config.json')
  writeFileSync(config, JSON.stringify({ travas: [trava, outra], quedaAutomatica: [trava], fila }))
  const roda = (agora, ...extra) => execFileSync(process.execPath, [SCRIPT, ...extra, '--registro', join(raiz, 'r.jsonl'), '--projetos', projetos, '--sessoes', sessoes,
    '--estado', join(raiz, 'e.json'), '--config', config, '--feed', join(raiz, 'feed.jsonl'), '--envio', `arquivo:${saida}`, '--agora', String(agora)], { encoding: 'utf8' })

  const seco = roda(AGORA, '--teste')
  assert.match(seco, /SERIA derrubada/)
  assert.ok(existsSync(trava), '--teste não derruba')

  const r = JSON.parse(roda(AGORA))
  assert.ok(!existsSync(trava), 'trava aprovada caiu')
  assert.ok(existsSync(outra), 'trava fora de quedaAutomatica fica')
  const ult = readFileSync(fila, 'utf8').trim().split('\n').pop()
  assert.match(ult, /^2026-11-04 14:00Z vigia: QUEDA AUTOMATICA da trava de -zy\/tela-y \(motivo: sem processo vivo e transcrição parada há 30 min; /)
  const msgs = readFileSync(saida, 'utf8').trim().split('\n').map(l => JSON.parse(l))
  const queda = msgs.find(m => /derrubada sozinha/.test(m.texto))
  assert.ok(queda, 'aviso da queda enviado')
  assert.match(queda.texto, /Era da -zy\/tela-y/)
  assert.match(queda.texto, /Próxima da fila: -ab\/P9/)
  assert.ok(msgs.some(m => /Posso anular a trava da -zy\?/.test(m.texto) && m.texto.includes(outra)), 'a outra só pergunta')
  assert.ok(r.avisos.some(a => a.tipo === 'queda-automatica'))

  roda(AGORA + 5 * MIN)
  assert.equal(readFileSync(fila, 'utf8').trim().split('\n').filter(l => /QUEDA/.test(l)).length, 1, 'não cai duas vezes')
})

test('queda automática: trava trocada entre a leitura e a queda não é tocada', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'vp-corrida-'))
  const trava = join(raiz, 't.lock'); const fila = join(raiz, 'fila.txt')
  writeFileSync(trava, '-zz/x 2026-11-04 13:00Z (a)')
  const lida = v.lerTrava(trava)
  writeFileSync(trava, '-qq/y 2026-11-04 13:59Z (nova dona pegou)')
  const t = v.derrubarTrava({ trava: lida, motivoQueda: 'teste', ultimoPedido: null }, { fila, agora: AGORA })
  assert.equal(t, null)
  assert.ok(existsSync(trava)); assert.ok(!existsSync(fila))
})
