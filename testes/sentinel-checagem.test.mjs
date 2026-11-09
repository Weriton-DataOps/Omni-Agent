// Checagem do Sentinel (05/11/2026): o cerco do Weriton em teste. Sem rede: Sentinel, WhatsApp e a sessão de
// triagem são falsos; o estado mora numa pasta temporária.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const pasta = mkdtempSync(join(tmpdir(), 'omni-sentinel-'))
process.env.OMNI_SENTINEL_PASTA = pasta
const { janela, guardar, validar, decidirPedido, pareceSegredo, extrairJson } = await import('../servicos/sentinel/triagem.mjs')
const { rodada } = await import('../servicos/sentinel/checagem.mjs')
const { lerEstado, lerPedidos, registrarResposta } = await import('../servicos/sentinel/pedidos.mjs')
const { responder } = await import('../servicos/sentinel/cliente.mjs')

beforeEach(() => { rmSync(pasta, { recursive: true, force: true }) })

// quarta-feira 05/11/2026, horário local
const quarta = (h, m = 0) => new Date(2026, 10, 5, h, m)
const DONO = '5500000006601'

function falsos({ caixa, triagem, sozinho = true, recusar } = {}) {
  const chamadas = { recados: 0, responder: [], lidos: [], tratados: [], cutucadas: [], enviados: [], triar: 0 }
  const reacoes = {}
  let n = 0
  const deps = {
    sentinel: {
      async recados() { chamadas.recados++; if (recusar) throw recusar; return { responderSozinho: { ligado: sozinho }, cutucadas: [], ...caixa } },
      async responder(c) { chamadas.responder.push(c); return { ok: true } },
      async marcarLidos(ids) { chamadas.lidos.push(...ids) },
      async marcarTratados(ids) { chamadas.tratados.push(...ids) },
      async cutucadasVistas(ids) { chamadas.cutucadas.push(...ids) },
    },
    whatsapp: {
      donoFone: DONO,
      async enviar(texto) { chamadas.enviados.push(texto); return `wa${++n}` },
      async reacoes(ids) { return Object.fromEntries(ids.map(id => [id, reacoes[id] || []])) },
    },
    async triar(lista) { chamadas.triar++; if (triagem instanceof Error) throw triagem; return typeof triagem === 'function' ? triagem(lista) : triagem },
  }
  return { deps, chamadas, reacoes }
}

const recado = (id, extra = {}) => ({ id, de: { agente: 'ari', login: 'ic.silva' }, texto: `recado ${id}`, jaLido: false, jaTratado: false, urgente: false, emRespostaA: null, missaoId: null, ...extra })

test('janela: só dia útil, às 9h/13h/17h, a última que já passou', () => {
  assert.equal(janela(new Date(2026, 10, 7, 10)), null) // sábado
  assert.equal(janela(new Date(2026, 10, 8, 10)), null) // domingo
  assert.equal(janela(quarta(8, 59)), null)
  assert.equal(janela(quarta(9, 0)), '2026-11-05@9')
  assert.equal(janela(quarta(14, 30)), '2026-11-05@13')
  assert.equal(janela(quarta(23, 0)), '2026-11-05@17')
})

test('guardas: só tiram do automático, nunca põem nele', () => {
  const r = recado(1)
  assert.equal(guardar({ id: 1, classe: 'rotina', resposta: 'O deploy é pelo workflow X (docs/deploy.md).' }, r).classe, 'rotina')
  assert.equal(guardar({ id: 1, classe: 'rotina', resposta: 'ok' }, recado(1, { missaoId: 7 })).classe, 'invasivo')
  assert.equal(guardar({ id: 1, classe: 'rotina', resposta: '' }, r).classe, 'invasivo')
  assert.equal(guardar({ id: 1, classe: 'rotina', resposta: 'a senha: hunter2' }, r).classe, 'invasivo')
  assert.equal(guardar({ id: 1, classe: 'rotina', resposta: 'x'.repeat(2001) }, r).classe, 'invasivo')
  assert.equal(guardar({ id: 1, classe: 'qualquer', resposta: 'ok' }, r).classe, 'invasivo')
  assert.equal(guardar({ id: 1, classe: 'nada', resposta: '' }, r).classe, 'nada')
  assert.equal(guardar({ id: 1, classe: 'invasivo', resposta: 'postgres://u:p@h/db', motivo: 'm' }, r).resposta, '')
})

test('segredo: credencial, conexão e IP interno têm cara de segredo; texto comum não', () => {
  for (const s of ['sk_ag_abcdefghij123', 'token=abc', 'postgresql://x@y/z', 'host 172.20.13.20', 'ghp_' + 'a'.repeat(30)]) assert.ok(pareceSegredo(s), s)
  assert.ok(!pareceSegredo('O catálogo fica em docs/catalogo.md; quem cuida é o time de dados.'))
})

test('validar: id estranho e repetido somem; recado esquecido sobe para ele', () => {
  const lista = [recado(1), recado(2)]
  const d = validar({ decisoes: [{ id: 1, classe: 'nada' }, { id: 1, classe: 'rotina', resposta: 'x' }, { id: 99, classe: 'rotina', resposta: 'x' }] }, lista)
  assert.deepEqual(d.map(x => [x.id, x.classe]), [[1, 'nada'], [2, 'invasivo']])
  assert.deepEqual(validar(null, lista).map(x => x.classe), ['invasivo', 'invasivo'])
  assert.deepEqual(extrairJson('olha:\n```json\n{"decisoes":[]}\n```'), { decisoes: [] })
})

test('pedido: só a reação do dono vale, 👍 sem rascunho não manda nada, texto dele vence', () => {
  const p = { estado: 'pendente', expiraEm: Date.now() + 1000, rascunho: 'r' }
  assert.equal(decidirPedido(p, [{ fone: '5511999999999', emoji: '👍' }], { donoFone: DONO }), 'pendente')
  assert.equal(decidirPedido(p, [{ fone: DONO, emoji: '👍🏽' }], { donoFone: DONO }), 'sim')
  assert.equal(decidirPedido({ ...p, rascunho: '' }, [{ fone: DONO, emoji: '👍' }], { donoFone: DONO }), 'pendente')
  assert.equal(decidirPedido(p, [{ fone: DONO, emoji: '👎' }], { donoFone: DONO }), 'nao')
  assert.equal(decidirPedido(p, [{ fone: DONO, emoji: '❤️' }], { donoFone: DONO }), 'pendente')
  assert.equal(decidirPedido({ ...p, respostaDele: { texto: 'manda assim' } }, [{ fone: DONO, emoji: '👎' }], { donoFone: DONO }), 'texto')
  assert.equal(decidirPedido({ ...p, expiraEm: 0 }, [{ fone: DONO, emoji: '👍' }], { donoFone: DONO }), 'expirado')
})

test('fora da janela e sem pedido aberto: o Sentinel não ouve nada', async () => {
  const { deps, chamadas } = falsos({ caixa: { recados: [recado(1)] } })
  await rodada({ agora: new Date(2026, 10, 7, 10), deps })
  await rodada({ agora: quarta(8), deps })
  assert.equal(chamadas.recados, 0)
})

test('janela: uma leitura só; rotina sai sozinha, invasivo vai ao WhatsApp, nada fica tratado', async () => {
  const caixa = { recados: [recado(1), recado(2), recado(3), recado(4, { jaTratado: true })] }
  const triagem = { decisoes: [
    { id: 1, classe: 'rotina', resposta: 'Está em docs/catalogo.md.', motivo: 'pergunta técnica' },
    { id: 2, classe: 'invasivo', resposta: 'Topo, entrego sexta.', motivo: 'compromisso com prazo', resumo: 'pede entrega até sexta' },
    { id: 3, classe: 'nada', motivo: 'boas-vindas' },
  ] }
  const { deps, chamadas } = falsos({ caixa, triagem })
  const r = await rodada({ agora: quarta(9, 5), deps })
  assert.equal(chamadas.recados, 1)
  assert.deepEqual(chamadas.responder, [{ emRespostaA: 1, texto: 'Está em docs/catalogo.md.', sozinho: true }])
  assert.equal(chamadas.enviados.length, 1)
  assert.match(chamadas.enviados[0], /Topo, entrego sexta\./)
  assert.match(chamadas.enviados[0], /ref sentinel#2/)
  assert.deepEqual(chamadas.lidos, [2])
  assert.deepEqual(chamadas.tratados.sort(), [1, 3])
  assert.equal(lerPedidos().wa1.recadoId, 2)
  assert.equal(r.novos, 3)
  await rodada({ agora: quarta(12, 55), deps })
  assert.equal(chamadas.recados, 1, 'mesma janela não lê de novo')
  await rodada({ agora: quarta(13, 0), deps })
  assert.equal(chamadas.recados, 2)
  assert.equal(chamadas.triar, 1, 'recado já decidido não volta para triagem')
})

test('responder sozinho desligado: nenhuma resposta sai, fica parada e sai quando ligar, sem nova triagem', async () => {
  const caixa = { recados: [recado(1)] }
  const triagem = { decisoes: [{ id: 1, classe: 'rotina', resposta: 'Veja docs/x.md.' }] }
  const desligado = falsos({ caixa, triagem, sozinho: false })
  await rodada({ agora: quarta(9), deps: desligado.deps })
  assert.equal(desligado.chamadas.responder.length, 0)
  assert.equal(desligado.chamadas.tratados.length, 0)
  assert.equal(lerEstado().vistos[1].situacao, 'parado')
  const ligado = falsos({ caixa, triagem: new Error('não devia triar'), sozinho: true })
  await rodada({ agora: quarta(13), deps: ligado.deps })
  assert.equal(ligado.chamadas.triar, 0)
  assert.deepEqual(ligado.chamadas.responder, [{ emRespostaA: 1, texto: 'Veja docs/x.md.', sozinho: true }])
  assert.equal(lerEstado().vistos[1].situacao, 'respondido-sozinho')
})

test('pedido: 👍 do dono manda o rascunho SEM a marca sozinho; 👎 não manda nada', async () => {
  const caixa = { recados: [recado(5), recado(6)] }
  const triagem = { decisoes: [{ id: 5, classe: 'invasivo', resposta: 'Aceito.' }, { id: 6, classe: 'invasivo', resposta: 'Não.' }] }
  const { deps, chamadas, reacoes } = falsos({ caixa, triagem })
  await rodada({ agora: quarta(9), deps })
  reacoes.wa1 = [{ fone: DONO, emoji: '👍' }]
  reacoes.wa2 = [{ fone: DONO, emoji: '👎' }]
  await rodada({ agora: quarta(10), deps })
  assert.deepEqual(chamadas.responder, [{ emRespostaA: 5, texto: 'Aceito.' }])
  assert.equal(chamadas.responder[0].sozinho, undefined)
  assert.deepEqual(chamadas.tratados, [5])
  assert.equal(chamadas.recados, 1, 'conferir reação não lê o Sentinel')
  assert.equal(lerPedidos().wa2.estado, 'nao')
  await rodada({ agora: quarta(11), deps })
  assert.equal(chamadas.responder.length, 1, 'pedido fechado não manda de novo')
})

test('texto dele citando o pedido vai literal', async () => {
  const { deps, chamadas } = falsos({ caixa: { recados: [recado(8)] }, triagem: { decisoes: [{ id: 8, classe: 'invasivo', resposta: 'rascunho' }] } })
  await rodada({ agora: quarta(9), deps })
  assert.equal(registrarResposta('wa1', '  Só semana que vem.  '), 8)
  assert.equal(registrarResposta('wa-desconhecido', 'x'), null)
  await rodada({ agora: quarta(10), deps })
  assert.deepEqual(chamadas.responder, [{ emRespostaA: 8, texto: 'Só semana que vem.' }])
})

test('triagem caiu: nada sai e a próxima janela tenta de novo', async () => {
  const caixa = { recados: [recado(1)] }
  const caiu = falsos({ caixa, triagem: new Error('timeout') })
  const r = await rodada({ agora: quarta(9), deps: caiu.deps })
  assert.match(r.erro, /triagem/)
  assert.equal(caiu.chamadas.responder.length + caiu.chamadas.enviados.length + caiu.chamadas.tratados.length, 0)
  const volta = falsos({ caixa, triagem: { decisoes: [{ id: 1, classe: 'nada' }] } })
  await rodada({ agora: quarta(13), deps: volta.deps })
  assert.equal(volta.chamadas.triar, 1)
})

test('chave recusada: avisa uma vez e para de insistir na janela', async () => {
  const erro = Object.assign(new Error('401'), { tipo: 'chave-recusada' })
  const { deps, chamadas } = falsos({ recusar: erro })
  await rodada({ agora: quarta(9), deps })
  await rodada({ agora: quarta(9, 5), deps })
  assert.equal(chamadas.recados, 1, 'espera antes de tentar de novo')
  await rodada({ agora: quarta(9, 40), deps })
  await rodada({ agora: quarta(10, 20), deps })
  assert.equal(chamadas.recados, 3)
  assert.equal(chamadas.enviados.length, 1)
  await rodada({ agora: quarta(11, 0), deps })
  assert.equal(chamadas.recados, 3, 'três tentativas e a janela fecha')
})

test('cliente: resposta passa do teto ou sem id é recusada antes de sair', () => {
  assert.throws(() => responder({ emRespostaA: 1, texto: 'x'.repeat(2001) }), /2000/)
  assert.throws(() => responder({ emRespostaA: 0, texto: 'ok' }), /emRespostaA/)
  assert.throws(() => responder({ emRespostaA: 1, texto: '  ' }), /vazio/)
})

test('cliente: leitura da caixa nunca consome e a chave vai só no cabeçalho', async () => {
  process.env.OMNI_SENTINEL_CHAVE_TESTE = 'sk_ag_teste_falsa_0000000000'
  const { recados } = await import('../servicos/sentinel/cliente.mjs')
  let pedido
  await recados({ limite: 5 }, { buscar: async (url, o) => { pedido = { url, o }; return new Response('{"recados":[]}', { status: 200 }) } })
  assert.match(pedido.url, /consumir=0/)
  assert.doesNotMatch(pedido.url, /sk_ag_/)
  assert.equal(pedido.o.headers.authorization, 'Bearer sk_ag_teste_falsa_0000000000')
  const corpos = []
  const buscar = async (url, o) => { corpos.push(JSON.parse(o.body)); return new Response('{"ok":true}', { status: 200 }) }
  await responder({ emRespostaA: 5, texto: 'Aceito.' }, { buscar })
  await responder({ emRespostaA: 6, texto: 'Veja docs/x.md.', sozinho: true }, { buscar })
  assert.deepEqual(corpos, [{ emRespostaA: 5, texto: 'Aceito.' }, { emRespostaA: 6, texto: 'Veja docs/x.md.', sozinho: true }], 'o que ele aprovou nunca sai marcado como sozinho')
  await assert.rejects(recados({}, { buscar: async () => new Response('{"erro":"x"}', { status: 401 }) }), e => e.tipo === 'chave-recusada')
  await assert.rejects(recados({}, { buscar: async () => new Response('{"erro":"credencial-nao-verificavel"}', { status: 503 }) }), e => e.tipo === 'transitorio')
  delete process.env.OMNI_SENTINEL_CHAVE_TESTE
})
