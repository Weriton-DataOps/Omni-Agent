// Gestão na loja do cofre (§8.2) sobre o cofre.db de uma casa temporária, com a ponte de mentira:
// o dono reservado, o histórico por credencial, as cinco regras de saúde, edição, rotação, a lixeira
// de 30 dias, ver e copiar só com a presença confirmada, e o import que não ressuscita o apagado.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { comBancoDaCasa } from '../runtime/casa/banco.mjs'
import { apagarCredencial, cadastrarCredencial, copiarAoDono, credencialPorNome, editarCredencial, esvaziarLixeira, historicoCredencial, importarPacoteCofre, importarPastaDpapi, listarCredenciais, listarLixeira, registrarInventarioWindows, registrarTeste, restaurarCredencial, revelarAoDono, rotacionarCredencial, saudeCofre, usarCredencial } from '../runtime/casa/loja-cofre.mjs'
import { selarPacote } from '../runtime/casa/pacote-cofre.mjs'

const RAPIDO = { N: 2 ** 14, r: 8, p: 1 }
const FRASE = 'frase-mestra de teste'
const AGORA = '2026-11-06T03:00:00.000Z'
const QUANDO = { maquina: 'maquina-a', agora: AGORA }
const DIA = 86_400_000
const aos = (dias, ms = 0) => new Date(Date.parse(AGORA) + dias * DIA + ms).toISOString()   // negativo é passado

// Ponte de mentira, a mesma da LC: "sela" com uma marca e um XOR e só abre o que tem a marca dela; outra
// marca é outra máquina. A cópia para a área de transferência guarda o texto numa lista, para o teste
// ver o que foi copiado, e zera o Buffer como a ponte real faria.
function ponteFalsa(marca = 'FALSO:') {
  const chamadas = { selar: 0, abrir: 0, copiar: 0 }
  const prefixo = Buffer.from(marca)
  const xor = (bytes) => { const saida = Buffer.from(bytes); for (let i = 0; i < saida.length; i++) saida[i] ^= 0x5a; return saida }
  const abrirUm = (blob) => {
    const bytes = blob instanceof Uint8Array ? Buffer.from(blob) : null
    if (!bytes || !bytes.subarray(0, prefixo.length).equals(prefixo)) return { ok: false, erro: 'CryptographicException' }
    return { ok: true, valor: xor(bytes.subarray(prefixo.length)) }
  }
  const areaDeTransferencia = []
  return {
    chamadas, areaDeTransferencia,
    selar(valores) { chamadas.selar += 1; return valores.map((valor) => Buffer.concat([prefixo, xor(valor)])) },
    abrir(blobs) { chamadas.abrir += 1; return blobs.map(abrirUm) },
    abrirParaAreaDeTransferencia(blob) {
      chamadas.copiar += 1
      const aberto = abrirUm(blob)
      if (!aberto.ok) return aberto
      areaDeTransferencia.push(aberto.valor.toString('utf8'))
      aberto.valor.fill(0)
      return { ok: true }
    }
  }
}
// Presença de mentira: devolve as respostas na ordem dada e conta as chamadas; sem resposta, nega.
function presencaFalsa(...respostas) {
  const presenca = () => { presenca.chamadas += 1; return respostas.shift() ?? { ok: false, motivo: 'sem-resposta' } }
  presenca.chamadas = 0
  return presenca
}
function comCasa(uso) {
  const casa = mkdtempSync(join(tmpdir(), 'omni-loja-gestao-'))
  try { return uso(casa) } finally { rmSync(casa, { recursive: true, force: true }) }
}
const comCofre = (casa, uso) => comBancoDaCasa(casa, 'cofre', uso, {})
const usos = (db) => db.prepare('SELECT nome, agente, motivo, resultado FROM usos ORDER BY rowid').all().map((linha) => ({ ...linha }))
const cadastrar = (db, ponte, nome, valor, extra = {}, agora = AGORA) => cadastrarCredencial(db, ponte, { nome, tipo: 'senha', ...extra }, valor, { maquina: 'maquina-a', agora })

test('dono reservado: ninguém cadastra, edita, importa nem usa como dono', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  assert.throws(() => cadastrar(db, ponte, 'banco-a', 'valor-a', { agentes: ['omni', 'dono'] }), { code: 'agente-reservado' })
  assert.equal(ponte.chamadas.selar, 0)
  cadastrar(db, ponte, 'banco-a', 'valor-a')
  assert.throws(() => editarCredencial(db, 'banco-a', { agentes: ['dono'] }, QUANDO), { code: 'agente-reservado' })
  assert.deepEqual(credencialPorNome(db, 'banco-a').agentes, ['omni'])
  const valor_b64 = Buffer.from('valor-b').toString('base64')
  const texto = selarPacote({ formato: 'omni-cofre-conteudo', versao: 1, origem_maquina: 'maquina-a', exportado_em: AGORA, credenciais: [{ nome: 'banco-b', tipo: 'senha', agentes: ['dono'], valor_b64 }, { nome: 'banco-c', tipo: 'senha', agentes: ['omni'], valor_b64 }], recadastrar: [] }, FRASE, RAPIDO)
  assert.deepEqual(importarPacoteCofre(db, ponte, texto, FRASE, QUANDO).resultados, [{ nome: 'banco-b', resultado: 'invalida' }, { nome: 'banco-c', resultado: 'importada' }])
  db.prepare(`UPDATE credenciais SET agentes = '["omni","dono"]' WHERE nome = 'banco-a'`).run()
  assert.throws(() => usarCredencial(db, ponte, { nome: 'banco-a', agente: 'dono', motivo: 'teste' }, QUANDO), { code: 'agente-sem-acesso' })
  assert.deepEqual(usos(db).at(-1), { nome: 'banco-a', agente: 'dono', motivo: 'teste', resultado: 'recusado-agente' })
})))

test('histórico: por id, do mais novo ao mais velho, com recusas, sem o valor e depois de apagada', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  const { id } = cadastrar(db, ponte, 'banco-a', 'segredo-do-historico', {}, aos(-3))
  cadastrar(db, ponte, 'banco-b', 'outro-segredo', {}, aos(-3))
  const usar = (nome, agente, motivo, agora, sessao = null) => usarCredencial(db, ponte, { nome, agente, motivo, sessao }, { maquina: 'maquina-a', agora })
  usar('banco-a', 'omni', 'primeiro', aos(-2), 's-1').valor.fill(0)
  usar('banco-b', 'omni', 'segundo', aos(-1)).valor.fill(0)
  assert.throws(() => usar('banco-a', 'overcore', 'sem acesso', aos(-1)), { code: 'agente-sem-acesso' })
  usar('banco-a', 'omni', 'terceiro', AGORA).valor.fill(0)
  const historico = historicoCredencial(db, id)
  assert.deepEqual(historico, [
    { em: AGORA, agente: 'omni', sessao: null, motivo: 'terceiro', resultado: 'entregue' },
    { em: aos(-1), agente: 'overcore', sessao: null, motivo: 'sem acesso', resultado: 'recusado-agente' },
    { em: aos(-2), agente: 'omni', sessao: 's-1', motivo: 'primeiro', resultado: 'entregue' }
  ])
  assert.ok(!JSON.stringify(historico).includes('segredo-do-historico'), 'o histórico não leva o valor')
  assert.deepEqual(historicoCredencial(db, id, { limite: 1 }).map((uso) => uso.motivo), ['terceiro'])
  apagarCredencial(db, 'banco-a', QUANDO)
  assert.equal(historicoCredencial(db, id).length, 3)
  assert.throws(() => historicoCredencial(db, 'banco-a'), { code: 'dados-invalidos' })
  assert.throws(() => historicoCredencial(db, id, { limite: 0 }), { code: 'dados-invalidos' })
  assert.throws(() => historicoCredencial(db, '01890000-0000-7000-8000-000000000000'), { code: 'inexistente' })
})))

test('saúde, vence: até 15 dias ou já vencida, com a borda exata', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  for (const [nome, validade] of [['a-vence-em-15', aos(15)], ['b-ja-venceu', aos(-3)], ['c-vence-em-15-e-1ms', aos(15, 1)], ['d-vence-em-16', aos(16)], ['e-sem-validade', null]]) cadastrar(db, ponte, nome, `valor-${nome}`, { validade })
  assert.deepEqual(saudeCofre(db, { agora: AGORA }), { total: 5, alertas: [{ regra: 'vence', nome: 'a-vence-em-15', validade: aos(15) }, { regra: 'vence', nome: 'b-ja-venceu', validade: aos(-3) }], duplicatas: null })
})))

test('saúde, teste que falhou: só o último resultado falso', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  for (const nome of ['a-falhou', 'b-passou', 'c-sem-resultado', 'd-nunca-testada']) cadastrar(db, ponte, nome, `valor-${nome}`, {}, aos(-2))
  registrarTeste(db, 'a-falhou', { ok: false, detalhe: 'recusou o login' }, aos(-1))
  registrarTeste(db, 'b-passou', { ok: true, detalhe: 'ok' }, aos(-1))
  registrarTeste(db, 'c-sem-resultado', { ok: null, detalhe: 'sem testador para o tipo' }, aos(-1))
  assert.deepEqual(saudeCofre(db, { agora: AGORA }).alertas, [{ regra: 'teste-falhou', nome: 'a-falhou', em: aos(-1) }])
})))

test('saúde, sem uso: 90 dias contados só de entregue, revelado e copiado, e só na guarda dpapi', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  const antes = aos(-200)
  for (const nome of ['a-usada-ha-89', 'b-usada-ha-90', 'c-usada-ha-91', 'd-nunca-usada']) cadastrar(db, ponte, nome, `valor-${nome}`, {}, antes)
  for (const nome of ['e-vista-pelo-dono', 'f-copiada-pelo-dono']) cadastrar(db, ponte, nome, `valor-${nome}`, { agentes: [] }, antes)
  registrarInventarioWindows(db, [{ alvo: 'Omni/so-no-gerenciador', usuario: null }], { maquina: 'maquina-a', agora: antes })
  for (const [nome, dias] of [['a-usada-ha-89', -89], ['b-usada-ha-90', -90], ['c-usada-ha-91', -91]]) usarCredencial(db, ponte, { nome, agente: 'omni', motivo: 'uso antigo' }, { maquina: 'maquina-a', agora: aos(dias) }).valor.fill(0)
  const presente = presencaFalsa({ ok: true }, { ok: true })
  revelarAoDono(db, ponte, presente, 'e-vista-pelo-dono', { maquina: 'maquina-a', agora: aos(-10) }).valor.fill(0)
  copiarAoDono(db, ponte, presente, 'f-copiada-pelo-dono', { maquina: 'maquina-a', agora: aos(-10) })
  assert.deepEqual(saudeCofre(db, { ponte, duplicatas: true, maquina: 'maquina-a', agora: aos(-1) }).duplicatas, { pares: [], naoAbriram: [] })
  assert.deepEqual(saudeCofre(db, { agora: AGORA }).alertas, [
    { regra: 'sem-uso', nome: 'b-usada-ha-90', desde: aos(-90) },
    { regra: 'sem-uso', nome: 'c-usada-ha-91', desde: aos(-91) },
    { regra: 'sem-uso', nome: 'd-nunca-usada', desde: aos(-200) }
  ])
})))

test('saúde, agente que nunca usou: só depois de 90 dias de cadastro, e falha ao abrir não conta', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  const extra = { tipo: 'token', agentes: ['omni', 'overcore', 'oraculo'] }
  cadastrar(db, ponte, 'a-com-89-dias', 'valor-a', extra, aos(-89))
  cadastrar(db, ponte, 'b-com-90-dias', 'valor-b', extra, aos(-90))
  for (const nome of ['a-com-89-dias', 'b-com-90-dias']) usarCredencial(db, ponte, { nome, agente: 'omni', motivo: 'uso recente' }, { maquina: 'maquina-a', agora: aos(-1) }).valor.fill(0)
  assert.throws(() => usarCredencial(db, ponteFalsa('OUTRA:'), { nome: 'b-com-90-dias', agente: 'oraculo', motivo: 'outra máquina' }, { maquina: 'maquina-a', agora: aos(-1) }), { code: 'nao-abriu' })
  assert.deepEqual(saudeCofre(db, { agora: AGORA }).alertas, [
    { regra: 'agente-nunca-usou', nome: 'b-com-90-dias', agente: 'overcore' },
    { regra: 'agente-nunca-usou', nome: 'b-com-90-dias', agente: 'oraculo' }
  ])
})))

test('saúde, duplicatas: só quando pedida, abre numa chamada, compara em memória, zera e devolve só nomes', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  for (const nome of ['a-original', 'b-copia', 'd-tambem-igual']) cadastrar(db, ponte, nome, 'mesmo-valor')
  cadastrar(db, ponte, 'c-unica', 'outro-valor')
  cadastrar(db, ponteFalsa('OUTRA:'), 'e-de-outra-maquina', 'mesmo-valor')
  const entregues = []
  const espia = { ...ponte, abrir(blobs) { const abertos = ponte.abrir(blobs); for (const aberto of abertos) if (aberto.ok) entregues.push(aberto.valor); return abertos } }
  const saude = saudeCofre(db, { ponte: espia, duplicatas: true, maquina: 'maquina-a', agora: AGORA })
  assert.equal(saude.total, 5)
  assert.equal(ponte.chamadas.abrir, 1)
  assert.deepEqual(saude.duplicatas, { pares: [['a-original', 'b-copia'], ['a-original', 'd-tambem-igual'], ['b-copia', 'd-tambem-igual']], naoAbriram: ['e-de-outra-maquina'] })
  assert.ok(!JSON.stringify(saude).includes('mesmo-valor'), 'a saúde não leva o valor')
  assert.equal(entregues.length, 4)
  assert.ok(entregues.every((valor) => valor.every((byte) => byte === 0)), 'os valores abertos para comparar ficam zerados')
  assert.deepEqual(usos(db).map((u) => `${u.nome} ${u.agente} ${u.resultado}`), [
    'a-original omni conferido-saude', 'b-copia omni conferido-saude', 'c-unica omni conferido-saude',
    'd-tambem-igual omni conferido-saude', 'e-de-outra-maquina omni falhou-abrir'
  ])
  assert.throws(() => saudeCofre(db, { duplicatas: true, agora: AGORA }), { code: 'dados-invalidos' })
})))

test('editar: muda só o que foi pedido, sobe a versão uma vez e recusa campo que não se edita', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  cadastrar(db, ponte, 'banco-a', 'valor-a', { servico: 'postgres', etiquetas: ['dw'] })
  const e = editarCredencial(db, 'banco-a', { notas: 'nota de teste', agentes: ['omni', 'overcore'], validade: aos(30) }, { maquina: 'maquina-b', agora: aos(1) })
  assert.deepEqual({ versao: e.versao, servico: e.servico, etiquetas: e.etiquetas, notas: e.notas, agentes: e.agentes, validade: e.validade, origem_maquina: e.origem_maquina, atualizado_em: e.atualizado_em },
    { versao: 2, servico: 'postgres', etiquetas: ['dw'], notas: 'nota de teste', agentes: ['omni', 'overcore'], validade: aos(30), origem_maquina: 'maquina-b', atualizado_em: aos(1) })
  assert.equal(editarCredencial(db, 'banco-a', { notas: 'nota de teste' }, { maquina: 'maquina-b', agora: aos(2) }).versao, 2)
  assert.deepEqual(db.prepare("SELECT operacao || versao AS o FROM _diario WHERE tabela = 'credenciais' ORDER BY seq").all().map((linha) => linha.o), ['I1', 'U2'])
  for (const mudancas of [{ nome: 'banco-x' }, { blob: 'x' }, { tipo: 'cofre-magico' }]) assert.throws(() => editarCredencial(db, 'banco-a', mudancas, QUANDO), { code: 'dados-invalidos' })
  assert.throws(() => editarCredencial(db, 'banco-z', { notas: 'x' }, QUANDO), { code: 'inexistente' })
  assert.equal(credencialPorNome(db, 'banco-a').versao, 2)
})))

test('rotacionar: sela o valor novo, sobe a versão, zera o último teste e registra a rotação', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  const antes = cadastrar(db, ponte, 'banco-a', 'valor-velho', {}, aos(-2))
  registrarTeste(db, 'banco-a', { ok: false, detalhe: 'senha recusada' }, aos(-1))
  const depois = rotacionarCredencial(db, ponte, 'banco-a', Buffer.from('valor-novo'), { maquina: 'maquina-b', agora: AGORA })
  assert.equal(depois.versao, 2)
  assert.notEqual(depois.blob_sha256, antes.blob_sha256)
  assert.equal(depois.ultimo_teste_em, null)
  assert.equal(depois.ultimo_teste_ok, null)
  assert.equal(depois.ultimo_teste_detalhe, null)
  const { valor } = usarCredencial(db, ponte, { nome: 'banco-a', agente: 'omni', motivo: 'depois da rotação' }, QUANDO)
  assert.equal(valor.toString('utf8'), 'valor-novo')
  valor.fill(0)
  assert.deepEqual(usos(db).map((u) => `${u.agente} ${u.motivo} ${u.resultado}`), ['omni rotacao rotacionado', 'omni depois da rotação entregue'])
  assert.throws(() => rotacionarCredencial(db, ponte, 'banco-a', '', QUANDO), { code: 'valor-vazio' })
  assert.throws(() => rotacionarCredencial(db, ponte, 'banco-z', 'x', QUANDO), { code: 'inexistente' })
  registrarInventarioWindows(db, [{ alvo: 'Omni/no-gerenciador', usuario: null }], QUANDO)
  const selagens = ponte.chamadas.selar
  assert.throws(() => rotacionarCredencial(db, ponte, 'Omni/no-gerenciador', 'x', QUANDO), { code: 'gerenciador-windows' })
  assert.equal(ponte.chamadas.selar, selagens)
  assert.equal(credencialPorNome(db, 'banco-a').versao, 2)
})))

test('lixeira: apagar sobe a versão, restaurar respeita o nome vivo, esvaziar leva só o que passou de 30 dias', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  for (const nome of ['a-29-dias', 'b-30-dias', 'c-31-dias', 'd-viva', 'e-restaurada']) cadastrar(db, ponte, nome, `valor-${nome}`, {}, aos(-60))
  const idC = credencialPorNome(db, 'c-31-dias').id
  usarCredencial(db, ponte, { nome: 'c-31-dias', agente: 'omni', motivo: 'antes de apagar' }, { maquina: 'maquina-a', agora: aos(-60) }).valor.fill(0)
  for (const [nome, dias] of [['a-29-dias', -29], ['b-30-dias', -30], ['c-31-dias', -31], ['e-restaurada', -5]]) apagarCredencial(db, nome, { maquina: 'maquina-a', agora: aos(dias) })
  assert.deepEqual(listarCredenciais(db).map((c) => c.nome), ['d-viva'])
  assert.deepEqual(listarLixeira(db).map((c) => [c.nome, c.apagado_em, c.versao]), [['e-restaurada', aos(-5), 2], ['a-29-dias', aos(-29), 2], ['b-30-dias', aos(-30), 2], ['c-31-dias', aos(-31), 2]])
  assert.throws(() => usarCredencial(db, ponte, { nome: 'a-29-dias', agente: 'omni', motivo: 'apagada' }, QUANDO), { code: 'inexistente' })
  assert.throws(() => apagarCredencial(db, 'a-29-dias', QUANDO), { code: 'inexistente' })
  const idB = listarLixeira(db).find((c) => c.nome === 'b-30-dias').id
  cadastrar(db, ponte, 'b-30-dias', 'valor-novo-b')
  assert.throws(() => restaurarCredencial(db, idB, QUANDO), { code: 'ja-existe' })
  const idE = listarLixeira(db).find((c) => c.nome === 'e-restaurada').id
  assert.equal(restaurarCredencial(db, idE, QUANDO).versao, 3)
  assert.throws(() => restaurarCredencial(db, idE, QUANDO), { code: 'inexistente' })
  assert.deepEqual(esvaziarLixeira(db, { agora: AGORA }), { apagadas: 1 })
  assert.deepEqual(listarLixeira(db).map((c) => c.nome), ['a-29-dias', 'b-30-dias'])
  assert.deepEqual(listarCredenciais(db).map((c) => c.nome), ['b-30-dias', 'd-viva', 'e-restaurada'])
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM usos WHERE credencial_id = ?').get(idC).n, 1)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM _diario WHERE tabela = 'credenciais' AND operacao = 'D' AND linha = ?").get(idC).n, 1)
})))

test('ver e copiar: só com a presença confirmada a cada vez, como dono, e todo pedido vira linha', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  cadastrar(db, ponte, 'banco-a', 'valor-do-dono')
  cadastrar(db, ponteFalsa('OUTRA:'), 'banco-outra', 'valor-de-outra')
  const negada = presencaFalsa({ ok: false, motivo: 'cancelado' }, { ok: false, motivo: 'cancelado' })
  assert.throws(() => revelarAoDono(db, ponte, negada, 'banco-a', QUANDO), { code: 'sem-presenca' })
  assert.throws(() => copiarAoDono(db, ponte, negada, 'banco-a', QUANDO), { code: 'sem-presenca' })
  assert.equal(negada.chamadas, 2)
  assert.deepEqual([ponte.chamadas.abrir, ponte.chamadas.copiar], [0, 0])
  const presente = presencaFalsa({ ok: true }, { ok: true }, { ok: true }, { ok: true })
  const visto = revelarAoDono(db, ponte, presente, 'banco-a', QUANDO)
  assert.equal(visto.valor.toString('utf8'), 'valor-do-dono')
  assert.match(visto.usoId, /^[0-9a-f]{8}-/)
  visto.valor.fill(0)
  const copiado = copiarAoDono(db, ponte, presente, 'banco-a', QUANDO)
  assert.deepEqual(Object.keys(copiado).sort(), ['limpaEm', 'usoId'])
  assert.equal(copiado.limpaEm, null)
  assert.deepEqual(ponte.areaDeTransferencia, ['valor-do-dono'])
  assert.throws(() => revelarAoDono(db, ponte, presente, 'banco-outra', QUANDO), { code: 'nao-abriu' })
  assert.throws(() => copiarAoDono(db, ponte, presente, 'banco-outra', QUANDO), { code: 'nao-copiou' })
  assert.equal(presente.chamadas, 4)
  const nunca = presencaFalsa()
  assert.throws(() => revelarAoDono(db, ponte, nunca, 'banco-z', QUANDO), { code: 'inexistente' })
  registrarInventarioWindows(db, [{ alvo: 'Omni/no-gerenciador', usuario: null }], QUANDO)
  assert.throws(() => copiarAoDono(db, ponte, nunca, 'Omni/no-gerenciador', QUANDO), { code: 'gerenciador-windows' })
  assert.throws(() => revelarAoDono(db, ponte, null, 'banco-a', QUANDO), { code: 'dados-invalidos' })
  assert.equal(nunca.chamadas, 0)
  const linhas = usos(db)
  assert.ok(linhas.every((u) => u.agente === 'dono'), 'quem vê e copia é o dono')
  assert.deepEqual(linhas.map((u) => `${u.nome} ${u.motivo} ${u.resultado}`), [
    'banco-a ver recusado-presenca', 'banco-a copiar recusado-presenca',
    'banco-a ver revelado-ao-dono', 'banco-a copiar copiado-ao-dono',
    'banco-outra ver falhou-abrir', 'banco-outra copiar falhou-copiar',
    'banco-z ver recusado-inexistente', 'Omni/no-gerenciador copiar recusado-gerenciador'
  ])
  assert.ok(!JSON.stringify(linhas).includes('valor-do-dono'), 'nenhum uso leva o valor')
})))

test('import da pasta: hash já ingerido de credencial apagada não ressuscita, nem depois de esvaziar; valor novo entra', () => comCasa((casa) => comCofre(casa, (db) => {
  const ponte = ponteFalsa()
  const pasta = join(casa, 'access')
  mkdirSync(pasta)
  const gravar = (nome, valor) => writeFileSync(join(pasta, `${nome}.dpapi`), ponte.selar([Buffer.from(valor)])[0])
  gravar('banco-a', 'valor-a')
  gravar('banco-b', 'valor-b')
  const importar = (agora) => importarPastaDpapi(db, ponte, pasta, { maquina: 'maquina-a', agora }).resultados
  assert.deepEqual(importar(aos(-40)), [{ nome: 'banco-a', resultado: 'importada' }, { nome: 'banco-b', resultado: 'importada' }])
  apagarCredencial(db, 'banco-a', { maquina: 'maquina-a', agora: aos(-35) })
  apagarCredencial(db, 'banco-b', { maquina: 'maquina-a', agora: aos(-1) })
  const apagadas = [{ nome: 'banco-a', resultado: 'apagada' }, { nome: 'banco-b', resultado: 'apagada' }]
  assert.deepEqual(importar(AGORA), apagadas)
  assert.deepEqual(esvaziarLixeira(db, { agora: AGORA }), { apagadas: 1 })
  assert.deepEqual(importar(AGORA), apagadas)
  gravar('banco-a', 'valor-a-novo')
  assert.deepEqual(importar(AGORA), [{ nome: 'banco-a', resultado: 'importada' }, { nome: 'banco-b', resultado: 'apagada' }])
  const { valor } = usarCredencial(db, ponte, { nome: 'banco-a', agente: 'omni', motivo: 'valor novo' }, QUANDO)
  assert.equal(valor.toString('utf8'), 'valor-a-novo')
  valor.fill(0)
})))
