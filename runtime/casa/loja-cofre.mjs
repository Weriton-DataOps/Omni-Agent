// Loja do cofre (§8.1 a §8.4): credenciais no cofre.db, com o valor selado pela DPAPI do usuário e
// só metadados em claro. Quem abre ou sela o valor é a ponte (runtime/casa/dpapi.mjs), sempre fora
// da transação; a transação só grava. Todo pedido de uso vira linha em usos, entregue ou recusado, e
// nenhuma linha leva o valor. As credenciais do Gerenciador de Credenciais do Windows entram só como
// inventário (guarda gerenciador-windows, sem blob): o cofre sabe que existem, não as abre.
// A gestão do card (§8.2) mora aqui também: histórico, saúde, edição, rotação, lixeira de 30 dias e o
// caminho do dono, que vê e copia só depois da presença confirmada (runtime/casa/presenca.mjs). O dono
// não é um agente: o nome fica reservado e nenhum agente o usa para pedir valor.
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { agoraIso, maquinaAtual, sha256, transacao, uuidv7 } from './banco.mjs'
import { abrirPacote, conferirFrase, conferirParametros, PARAMETROS_PADRAO, selarPacote } from './pacote-cofre.mjs'
import { registrarProjecao, situacaoDaProjecao } from './projecao.mjs'

export const TIPOS = Object.freeze(['senha', 'token', 'chave-api', 'conexao', 'conta-servico', 'ssh', 'outro'])
const NOME = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/
const AGENTE = /^[a-z][a-z0-9-]{0,39}$/
const ETIQUETA = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,59}$/u
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
const LIMITE_DETALHE = 300
const COLUNAS_PUBLICAS = 'id, nome, tipo, servico, url, usuario, notas, etiquetas, agentes, validade, rotacionar_dias, ultimo_teste_em, ultimo_teste_ok, ultimo_teste_detalhe, guarda, alvo_windows, blob_sha256, origem_maquina, criado_em, atualizado_em, versao'
const SEM_METADADOS = Object.freeze({ url: null, usuario: null, notas: null, etiquetas: [], agentes: ['omni'], validade: null, rotacionar_dias: null })
const DONO = 'dono'
const DIA = 86_400_000
const PRAZO_VENCE = 15 * DIA
const PRAZO_SEM_USO = 90 * DIA
const CARENCIA_AGENTE = 90 * DIA
const PRAZO_LIXEIRA = 30 * DIA
const USO_REAL = new Set(['entregue', 'revelado-ao-dono', 'copiado-ao-dono'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const EDITAVEIS = new Set(['tipo', 'servico', 'url', 'usuario', 'notas', 'etiquetas', 'agentes', 'validade', 'rotacionar_dias'])

export class CofreError extends Error {
  constructor(codigo, mensagem) {
    super(mensagem)
    this.name = 'CofreError'
    this.code = codigo
  }
}

function texto(valor, campo, { obrigatorio = false, max = 2000 } = {}) {
  if (valor === undefined || valor === null || valor === '') {
    if (obrigatorio) throw new CofreError('dados-invalidos', `Falta o campo ${campo}.`)
    return null
  }
  if (typeof valor !== 'string' || valor.length > max) throw new CofreError('dados-invalidos', `Campo ${campo} inválido.`)
  return valor
}

function lista(valor, campo, padrao, formato) {
  if (valor === undefined || valor === null) return [...padrao]
  if (!Array.isArray(valor) || valor.some((item) => typeof item !== 'string' || !formato.test(item)) || new Set(valor).size !== valor.length) {
    throw new CofreError('dados-invalidos', `Campo ${campo} inválido.`)
  }
  return [...valor]
}

function normalizarDados(dados) {
  const d = dados ?? {}
  const nome = texto(d.nome, 'nome', { obrigatorio: true, max: 200 })
  if (!NOME.test(nome)) throw new CofreError('dados-invalidos', 'Campo nome inválido.')
  if (!TIPOS.includes(d.tipo)) throw new CofreError('dados-invalidos', 'Campo tipo inválido.')
  const validade = texto(d.validade, 'validade', { max: 40 })
  if (validade !== null && Number.isNaN(Date.parse(validade))) throw new CofreError('dados-invalidos', 'Campo validade inválido.')
  const rotacionar = d.rotacionar_dias ?? null
  if (rotacionar !== null && (!Number.isInteger(rotacionar) || rotacionar < 1 || rotacionar > 3650)) throw new CofreError('dados-invalidos', 'Campo rotacionar_dias inválido.')
  const agentes = lista(d.agentes, 'agentes', ['omni'], AGENTE)
  if (agentes.includes(DONO)) throw new CofreError('agente-reservado', 'O agente dono é reservado: quem vê e copia é o dono, atrás do Windows Hello.')
  return {
    nome, tipo: d.tipo,
    servico: texto(d.servico, 'servico', { max: 100 }), url: texto(d.url, 'url'),
    usuario: texto(d.usuario, 'usuario', { max: 200 }), notas: texto(d.notas, 'notas'),
    etiquetas: lista(d.etiquetas, 'etiquetas', [], ETIQUETA), agentes,
    validade, rotacionar_dias: rotacionar
  }
}

function comoBytes(valor) {
  if (typeof valor === 'string') return Buffer.from(valor, 'utf8')
  if (valor instanceof Uint8Array) return Buffer.from(valor)
  throw new CofreError('dados-invalidos', 'O valor da credencial precisa ser texto ou bytes.')
}

// node:sqlite devolve linha com protótipo nulo e BLOB como Uint8Array; o espalhamento vira objeto comum.
function deLinha(linha) {
  if (!linha) return null
  return { ...linha, etiquetas: JSON.parse(linha.etiquetas), agentes: JSON.parse(linha.agentes), ultimo_teste_ok: linha.ultimo_teste_ok === null ? null : linha.ultimo_teste_ok === 1 }
}

const metadados = (c) => ({ nome: c.nome, tipo: c.tipo, servico: c.servico, url: c.url, usuario: c.usuario, notas: c.notas, etiquetas: c.etiquetas, agentes: c.agentes, validade: c.validade, rotacionar_dias: c.rotacionar_dias })
const porNome = (db, nome) => db.prepare('SELECT id, guarda, blob_sha256 FROM credenciais WHERE nome = ? AND apagado_em IS NULL').get(nome)
const jaExiste = (nome) => new CofreError('ja-existe', `Já existe uma credencial com o nome ${nome}.`)
const inexistente = (nome) => new CofreError('inexistente', `Não há credencial com o nome ${nome}.`)
const soNoGerenciador = (nome) => new CofreError('gerenciador-windows', `${nome} mora no Gerenciador de Credenciais do Windows; o cofre só tem o nome.`)
function exigirNome(nome) { if (typeof nome !== 'string' || !NOME.test(nome)) throw new CofreError('dados-invalidos', 'Campo nome inválido.') }
function exigirId(id) { if (typeof id !== 'string' || !UUID.test(id)) throw new CofreError('dados-invalidos', 'Campo id inválido.') }
const jaIngerido = (db, chave, sha) => Boolean(db.prepare('SELECT 1 AS sim FROM _projecoes WHERE arquivo = ? AND sha256 = ?').get(chave, sha))
function abrirRegistrando(ponte, blob, nome, registrar) {
  let aberto
  try { [aberto] = ponte.abrir([blob]) } catch (erro) { registrar('falhou-abrir'); throw erro }
  if (!aberto?.ok) { registrar('falhou-abrir'); throw new CofreError('nao-abriu', `${nome} não abriu nesta máquina (${aberto?.erro ?? 'sem resposta'}).`) }
  return aberto.valor
}
function contar(resultados) { const contagens = {}; for (const { resultado } of resultados) contagens[resultado] = (contagens[resultado] ?? 0) + 1; return contagens }

function inserir(db, c) {
  db.prepare(`INSERT INTO credenciais (id, nome, tipo, servico, url, usuario, notas, etiquetas, agentes, validade, rotacionar_dias, guarda, alvo_windows, blob, blob_sha256, origem_maquina, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(uuidv7(Date.parse(c.agora)), c.nome, c.tipo, c.servico, c.url, c.usuario, c.notas, JSON.stringify(c.etiquetas), JSON.stringify(c.agentes), c.validade, c.rotacionar_dias, c.guarda, c.alvo_windows, c.blob, c.blob === null ? null : sha256(c.blob), c.maquina, c.agora, c.agora)
}
function registrarImportacao(db, { tipo, fonte, fonteSha256, contagens, maquina, agora }) {
  db.prepare('INSERT INTO _importacoes (id, tipo, fonte, fonte_sha256, contagens, origem_maquina, feita_em) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(uuidv7(Date.parse(agora)), tipo, fonte, fonteSha256, JSON.stringify(contagens), maquina, agora)
}
function registrarUso(db, { credencialId, nome, agente, sessao, motivo, resultado, maquina, agora }) {
  const id = uuidv7(Date.parse(agora))
  db.prepare('INSERT INTO usos (id, credencial_id, nome, agente, sessao, motivo, resultado, em, origem_maquina) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, credencialId, nome, agente, sessao, motivo, resultado, agora, maquina)
  return id
}

export function listarCredenciais(db) { return db.prepare(`SELECT ${COLUNAS_PUBLICAS} FROM credenciais WHERE apagado_em IS NULL ORDER BY nome`).all().map(deLinha) }
export function credencialPorNome(db, nome) { return deLinha(db.prepare(`SELECT ${COLUNAS_PUBLICAS} FROM credenciais WHERE nome = ? AND apagado_em IS NULL`).get(nome)) }

export function cadastrarCredencial(db, ponte, dados, valor, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  const c = normalizarDados(dados)
  const bytes = comoBytes(valor)
  try {
    if (bytes.length === 0) throw new CofreError('valor-vazio', 'O valor da credencial está vazio.')
    if (porNome(db, c.nome)) throw jaExiste(c.nome)
    const [blob] = ponte.selar([bytes])
    return transacao(db, () => {
      if (porNome(db, c.nome)) throw jaExiste(c.nome)
      inserir(db, { ...c, guarda: 'dpapi', alvo_windows: null, blob, maquina, agora })
      return credencialPorNome(db, c.nome)
    })
  } finally {
    bytes.fill(0)
  }
}

export function usarCredencial(db, ponte, pedido, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  const { nome, agente, motivo, sessao = null } = pedido ?? {}
  const valido = typeof nome === 'string' && NOME.test(nome) && typeof agente === 'string' && AGENTE.test(agente) &&
    typeof motivo === 'string' && motivo.trim() !== '' && motivo.length <= 300 && (sessao === null || (typeof sessao === 'string' && sessao.length <= 200))
  if (!valido) throw new CofreError('dados-invalidos', 'Pedido de uso inválido: nome, agente e motivo são obrigatórios.')
  const registrar = (credencialId, resultado) => registrarUso(db, { credencialId, nome, agente, sessao, motivo, resultado, maquina, agora })
  const linha = db.prepare('SELECT id, agentes, guarda, blob FROM credenciais WHERE nome = ? AND apagado_em IS NULL').get(nome)
  if (!linha) { registrar(null, 'recusado-inexistente'); throw inexistente(nome) }
  // O dono não pede valor por aqui: ele vê e copia pelo caminho com presença (revelarAoDono, copiarAoDono).
  if (agente === DONO || !JSON.parse(linha.agentes).includes(agente)) {
    registrar(linha.id, 'recusado-agente')
    throw new CofreError('agente-sem-acesso', `O agente ${agente} não tem acesso a ${nome}.`)
  }
  if (linha.guarda !== 'dpapi') { registrar(linha.id, 'recusado-gerenciador'); throw soNoGerenciador(nome) }
  const valor = abrirRegistrando(ponte, linha.blob, nome, (resultado) => registrar(linha.id, resultado))
  try { return { valor, usoId: registrar(linha.id, 'entregue') } } catch (erro) { valor.fill(0); throw erro }
}

export function registrarTeste(db, nome, { ok, detalhe }, agora = agoraIso()) {
  if (ok !== true && ok !== false && ok !== null) throw new CofreError('dados-invalidos', 'Resultado de teste inválido.')
  const corte = detalhe === undefined || detalhe === null ? null : String(detalhe).slice(0, LIMITE_DETALHE)
  const r = db.prepare('UPDATE credenciais SET ultimo_teste_em = ?, ultimo_teste_ok = ?, ultimo_teste_detalhe = ? WHERE nome = ? AND apagado_em IS NULL')
    .run(agora, ok === null ? null : ok ? 1 : 0, corte, nome)
  if (r.changes !== 1) throw inexistente(nome)
}

function conferirClassificacao(classificacao) {
  if (classificacao === null || typeof classificacao !== 'object' || Array.isArray(classificacao)) throw new CofreError('classificacao-invalida', 'A classificação precisa ser um objeto nome → {tipo, servico}.')
  for (const [nome, classe] of Object.entries(classificacao)) {
    const ok = NOME.test(nome) && classe !== null && typeof classe === 'object' && TIPOS.includes(classe.tipo) &&
      (classe.servico === undefined || classe.servico === null || (typeof classe.servico === 'string' && classe.servico.length <= 100))
    if (!ok) throw new CofreError('classificacao-invalida', `Classificação inválida para ${nome}.`)
  }
}

// O ConvertFrom-SecureString do PowerShell (sem -Key) grava o blob da DPAPI como texto hex, e o valor
// selado ali dentro é UTF-16LE. Arquivo que é todo texto hex (BOM e espaço nas pontas tolerados) vem
// desse formato: o blob sai do hex, e o valor só vale se for UTF-16LE bem formado. Ele vira UTF-8 e é
// selado de novo, para o cofre guardar um formato só.
const HEX = /^(?:[0-9a-f]{2})+$/i
function blobDoTextoHex(bytes) {
  const texto = bytes.toString('latin1').replace(/^\xEF\xBB\xBF/, '').trim()
  return HEX.test(texto) ? Buffer.from(texto, 'hex') : null
}
function utf16ParaUtf8(valor) {
  if (valor.length % 2 !== 0) return null
  const texto = valor.toString('utf16le')
  return texto.isWellFormed() ? Buffer.from(texto, 'utf8') : null
}

// O .dpapi é projeção do cofre (§3.2): o hash de cada arquivo ingerido fica em _projecoes, sob
// access/<arquivo>, venha da pasta que vier. Na volta, arquivo igual ao blob guardado ou já ingerido
// é já-importada; hash nunca visto é divergente, e o banco não é sobrescrito.
export function importarPastaDpapi(db, ponte, pasta, { classificacao = {}, maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  conferirClassificacao(classificacao)
  const fonte = resolve(pasta)
  const arquivos = readdirSync(fonte, { withFileTypes: true }).filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.dpapi')).map((e) => e.name).sort()
  const resultados = []; const impressoes = []; const candidatas = []
  for (const arquivo of arquivos) {
    const nome = arquivo.slice(0, -'.dpapi'.length)
    if (!NOME.test(nome)) { resultados.push({ nome, resultado: 'nome-invalido' }); continue }
    const bruto = readFileSync(join(fonte, arquivo))
    const sha = sha256(bruto)
    const chave = `access/${arquivo}`
    impressoes.push(`${nome}:${sha}\n`)
    const atual = porNome(db, nome)
    if (atual) {
      const situacao = situacaoDaProjecao(db, chave, sha, atual.blob_sha256)
      resultados.push({ nome, resultado: situacao === 'atual' || situacao === 'defasada' ? 'ja-importada' : 'divergente' }); continue
    }
    // Hash já ingerido sem credencial viva com o nome: ela foi apagada (na lixeira ou já fora dela), e o
    // arquivo velho no disco não a traz de volta. Valor novo no arquivo é hash novo e entra.
    if (jaIngerido(db, chave, sha)) { resultados.push({ nome, resultado: 'apagada' }); continue }
    const hex = blobDoTextoHex(bruto)
    candidatas.push({ nome, chave, sha, blob: hex ?? bruto, textoHex: hex !== null })
  }
  const abertos = candidatas.length === 0 ? [] : ponte.abrir(candidatas.map((c) => c.blob))
  const convertidos = []
  candidatas.forEach((c, i) => {
    if (abertos[i]?.ok !== true) return
    const valor = abertos[i].valor
    const utf8 = c.textoHex ? utf16ParaUtf8(valor) : null
    valor.fill(0)
    if (!c.textoHex) c.abre = true
    else if (utf8) { c.abre = true; c.convertido = convertidos.push(utf8) - 1 }
  })
  try {
    const selados = convertidos.length === 0 ? [] : ponte.selar(convertidos)
    for (const c of candidatas) if (c.convertido !== undefined) c.blob = selados[c.convertido]
  } finally { for (const v of convertidos) v.fill(0) }
  const importadas = transacao(db, () => {
    let n = 0
    for (const c of candidatas) {
      if (!c.abre) { resultados.push({ nome: c.nome, resultado: 'nao-abriu' }); continue }
      if (porNome(db, c.nome)) { resultados.push({ nome: c.nome, resultado: 'ja-existe' }); continue }
      const classe = Object.hasOwn(classificacao, c.nome) ? classificacao[c.nome] : { tipo: 'outro', servico: null }
      inserir(db, { ...SEM_METADADOS, nome: c.nome, tipo: classe.tipo, servico: classe.servico ?? null, guarda: 'dpapi', alvo_windows: null, blob: c.blob, maquina, agora })
      registrarProjecao(db, c.chave, c.sha, 'ingerida')
      resultados.push({ nome: c.nome, resultado: 'importada' }); n += 1
    }
    registrarImportacao(db, { tipo: 'dpapi', fonte, fonteSha256: sha256(impressoes.sort().join('')), contagens: contar(resultados), maquina, agora })
    return n
  })
  resultados.sort((a, b) => (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0))
  return { importadas, resultados }   // nunca apaga os originais
}

const ehDoOmni = (alvo) => typeof alvo === 'string' && alvo.toLowerCase().startsWith('omni/')

export function registrarInventarioWindows(db, entradas, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  if (!Array.isArray(entradas)) throw new CofreError('dados-invalidos', 'O inventário precisa ser uma lista.')
  const doOmni = entradas.filter((entrada) => ehDoOmni(entrada?.alvo))
  const ignoradas = entradas.length - doOmni.length
  const resultados = []; const vistos = new Set()
  const { inventariadas, ausentes } = transacao(db, () => {
    let n = 0
    for (const { alvo, usuario } of doOmni) {
      vistos.add(alvo)
      if (!NOME.test(alvo)) { resultados.push({ nome: alvo, resultado: 'nome-invalido' }); continue }
      const atual = porNome(db, alvo)
      if (atual) { resultados.push({ nome: alvo, resultado: atual.guarda === 'gerenciador-windows' ? 'ja-inventariada' : 'conflito' }); continue }
      inserir(db, { ...SEM_METADADOS, nome: alvo, tipo: 'outro', servico: null, usuario: typeof usuario === 'string' && usuario.length <= 200 ? usuario : null, guarda: 'gerenciador-windows', alvo_windows: alvo, blob: null, maquina, agora })
      resultados.push({ nome: alvo, resultado: 'inventariada' }); n += 1
    }
    const fora = db.prepare("SELECT alvo_windows FROM credenciais WHERE guarda = 'gerenciador-windows' AND apagado_em IS NULL").all().filter((l) => !vistos.has(l.alvo_windows)).length
    registrarImportacao(db, { tipo: 'gerenciador-windows', fonte: 'Credential Manager', fonteSha256: sha256([...vistos].sort().join('\n')), contagens: { ...contar(resultados), ignoradas, ausentes: fora }, maquina, agora })
    return { inventariadas: n, ausentes: fora }
  })
  return { inventariadas, ausentes, ignoradas, resultados }   // ausentes contados, nunca apagados
}

export function exportarCofre(db, ponte, frase, { parametros = PARAMETROS_PADRAO, maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  conferirFrase(frase)
  conferirParametros(parametros)
  const linhas = db.prepare(`SELECT ${COLUNAS_PUBLICAS}, blob FROM credenciais WHERE apagado_em IS NULL ORDER BY nome`).all().map(deLinha)
  const doCofre = linhas.filter((linha) => linha.guarda === 'dpapi')
  const recadastrar = linhas.filter((linha) => linha.guarda === 'gerenciador-windows').map((linha) => ({ ...metadados(linha), alvo_windows: linha.alvo_windows }))
  const abertos = doCofre.length === 0 ? [] : ponte.abrir(doCofre.map((linha) => linha.blob))
  const uso = (linha, resultado) => registrarUso(db, { credencialId: linha.id, nome: linha.nome, agente: 'omni', sessao: null, motivo: 'exportacao do cofre', resultado, maquina, agora })
  try {
    const falhas = doCofre.filter((_, i) => !abertos[i]?.ok)
    if (falhas.length > 0) {
      transacao(db, () => { for (const linha of falhas) uso(linha, 'falhou-abrir') })
      throw new CofreError('nao-abriu', `${falhas.length} credencial(is) não abriram nesta máquina; nada foi exportado.`)
    }
    const conteudo = { formato: 'omni-cofre-conteudo', versao: 1, origem_maquina: maquina, exportado_em: agora,
      credenciais: doCofre.map((linha, i) => ({ ...metadados(linha), valor_b64: abertos[i].valor.toString('base64') })), recadastrar }
    const texto = selarPacote(conteudo, frase, parametros)
    transacao(db, () => { for (const linha of doCofre) uso(linha, 'exportada') })
    return { texto, credenciais: doCofre.length, recadastrar: recadastrar.length }
  } finally {
    for (const aberto of abertos) if (aberto?.ok) aberto.valor.fill(0)
  }
}

export function importarPacoteCofre(db, ponte, texto, frase, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  const conteudo = abrirPacote(texto, frase)
  if (conteudo?.formato !== 'omni-cofre-conteudo' || conteudo.versao !== 1 || !Array.isArray(conteudo.credenciais) || !Array.isArray(conteudo.recadastrar)) {
    throw new CofreError('pacote-invalido', 'O pacote não traz um cofre do Omni.')
  }
  const resultados = []; const candidatas = []
  for (const item of conteudo.credenciais) {
    let c
    try { c = normalizarDados(item) } catch (erro) {
      if (!(erro instanceof CofreError)) throw erro
      resultados.push({ nome: typeof item?.nome === 'string' ? item.nome : null, resultado: 'invalida' }); continue
    }
    const valor = typeof item.valor_b64 === 'string' && BASE64.test(item.valor_b64) ? Buffer.from(item.valor_b64, 'base64') : null
    if (!valor || valor.length === 0) { resultados.push({ nome: c.nome, resultado: 'invalida' }); continue }
    if (porNome(db, c.nome)) { valor.fill(0); resultados.push({ nome: c.nome, resultado: 'ja-existe' }); continue }
    candidatas.push({ ...c, valor })
  }
  let blobs = []
  try { blobs = candidatas.length === 0 ? [] : ponte.selar(candidatas.map((c) => c.valor)) } finally { for (const c of candidatas) c.valor.fill(0) }
  const recadastrar = conteudo.recadastrar.map((item) => ({ nome: item?.nome ?? null, alvo_windows: item?.alvo_windows ?? null, usuario: item?.usuario ?? null }))
  const importadas = transacao(db, () => {
    let n = 0
    candidatas.forEach((c, i) => {
      if (porNome(db, c.nome)) { resultados.push({ nome: c.nome, resultado: 'ja-existe' }); return }
      inserir(db, { ...c, guarda: 'dpapi', alvo_windows: null, blob: blobs[i], maquina, agora })
      resultados.push({ nome: c.nome, resultado: 'importada' }); n += 1
    })
    registrarImportacao(db, { tipo: 'pacote', fonte: 'pacote', fonteSha256: sha256(texto), contagens: contar(resultados), maquina, agora })
    return n
  })
  return { importadas, resultados, recadastrar }
}

export function historicoCredencial(db, id, { limite = 50 } = {}) {
  exigirId(id)
  if (!Number.isInteger(limite) || limite < 1 || limite > 500) throw new CofreError('dados-invalidos', 'Campo limite inválido.')
  if (!db.prepare('SELECT 1 AS sim FROM credenciais WHERE id = ?').get(id)) throw new CofreError('inexistente', 'Não há credencial com esse id.')
  return db.prepare('SELECT em, agente, sessao, motivo, resultado FROM usos WHERE credencial_id = ? ORDER BY em DESC, rowid DESC LIMIT ?').all(id, limite).map((linha) => ({ ...linha }))
}

// Saúde (§8.2), com o relógio injetado: vence em até 15 dias (ou já venceu); falhou no último teste; sem
// uso há 90 dias, contando só entregue, revelado-ao-dono e copiado-ao-dono; agente autorizado que nunca
// usou, depois de 90 dias de cadastro; e, só quando pedida, a duplicata. As três últimas valem só para a
// guarda dpapi: o cofre não vê o uso nem o valor do que mora no Gerenciador. O agente acrescentado
// depois por edição conta do criado_em, e isso fica declarado.
export function saudeCofre(db, { ponte = null, duplicatas = false, maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  const t = Date.parse(agora)
  const vivas = listarCredenciais(db)
  const ultimo = new Map(); const usaram = new Map()
  const reais = [...USO_REAL]
  for (const uso of db.prepare(`SELECT credencial_id, agente, resultado, em FROM usos WHERE credencial_id IS NOT NULL AND resultado IN (${reais.map(() => '?').join(', ')})`).all(...reais)) {
    const anterior = ultimo.get(uso.credencial_id)
    if (anterior === undefined || Date.parse(uso.em) > Date.parse(anterior)) ultimo.set(uso.credencial_id, uso.em)
    if (uso.resultado === 'entregue') usaram.set(uso.credencial_id, (usaram.get(uso.credencial_id) ?? new Set()).add(uso.agente))
  }
  const alertas = []
  for (const c of vivas) {
    if (c.validade !== null && Date.parse(c.validade) - t <= PRAZO_VENCE) alertas.push({ regra: 'vence', nome: c.nome, validade: c.validade })
    if (c.ultimo_teste_ok === false) alertas.push({ regra: 'teste-falhou', nome: c.nome, em: c.ultimo_teste_em })
    if (c.guarda !== 'dpapi') continue
    const desde = ultimo.get(c.id) ?? c.criado_em
    if (t - Date.parse(desde) >= PRAZO_SEM_USO) alertas.push({ regra: 'sem-uso', nome: c.nome, desde })
    else if (t - Date.parse(c.criado_em) >= CARENCIA_AGENTE) {
      for (const agente of c.agentes) if (!usaram.get(c.id)?.has(agente)) alertas.push({ regra: 'agente-nunca-usou', nome: c.nome, agente })
    }
  }
  return { total: vivas.length, alertas, duplicatas: duplicatas ? conferirDuplicatas(db, ponte, { maquina, agora }) : null }
}

function conferirDuplicatas(db, ponte, { maquina, agora }) {
  if (!ponte) throw new CofreError('dados-invalidos', 'A conferência de duplicatas precisa da ponte da DPAPI.')
  const linhas = db.prepare("SELECT id, nome, blob FROM credenciais WHERE apagado_em IS NULL AND guarda = 'dpapi' ORDER BY nome").all()
  const abertos = linhas.length === 0 ? [] : ponte.abrir(linhas.map((linha) => linha.blob))   // se lançar, propaga sem registrar
  try {
    const pares = []
    for (let i = 0; i < linhas.length; i += 1) for (let j = i + 1; j < linhas.length; j += 1) {
      if (abertos[i]?.ok && abertos[j]?.ok && Buffer.compare(abertos[i].valor, abertos[j].valor) === 0) pares.push([linhas[i].nome, linhas[j].nome])
    }
    const naoAbriram = linhas.filter((_, i) => !abertos[i]?.ok).map((linha) => linha.nome)
    transacao(db, () => { linhas.forEach((linha, i) => registrarUso(db, { credencialId: linha.id, nome: linha.nome, agente: 'omni', sessao: null, motivo: 'conferencia de duplicatas', resultado: abertos[i]?.ok ? 'conferido-saude' : 'falhou-abrir', maquina, agora })) })
    return { pares, naoAbriram }
  } finally {
    for (const item of abertos) if (item?.ok) item.valor.fill(0)
  }
}

export function editarCredencial(db, nome, mudancas, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  exigirNome(nome)
  if (mudancas === null || typeof mudancas !== 'object' || Array.isArray(mudancas)) throw new CofreError('dados-invalidos', 'As mudanças precisam ser um objeto.')
  const fora = Object.keys(mudancas).filter((campo) => !EDITAVEIS.has(campo))
  if (fora.length > 0) throw new CofreError('dados-invalidos', `Campo(s) que não se editam: ${fora.join(', ')}.`)
  return transacao(db, () => {
    const atual = credencialPorNome(db, nome)
    if (!atual) throw inexistente(nome)
    const antes = metadados(atual)
    const novo = normalizarDados({ ...antes, ...mudancas, nome: atual.nome })
    if (JSON.stringify(novo) === JSON.stringify(antes)) return atual
    db.prepare('UPDATE credenciais SET tipo = ?, servico = ?, url = ?, usuario = ?, notas = ?, etiquetas = ?, agentes = ?, validade = ?, rotacionar_dias = ?, origem_maquina = ?, atualizado_em = ?, versao = versao + 1 WHERE id = ?')
      .run(novo.tipo, novo.servico, novo.url, novo.usuario, novo.notas, JSON.stringify(novo.etiquetas), JSON.stringify(novo.agentes), novo.validade, novo.rotacionar_dias, maquina, agora, atual.id)
    return credencialPorNome(db, nome)
  })
}

export function rotacionarCredencial(db, ponte, nome, valor, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  exigirNome(nome)
  const bytes = comoBytes(valor)
  try {
    if (bytes.length === 0) throw new CofreError('valor-vazio', 'O valor da credencial está vazio.')
    const atual = porNome(db, nome)
    if (!atual) throw inexistente(nome)
    if (atual.guarda !== 'dpapi') throw soNoGerenciador(nome)
    const [blob] = ponte.selar([bytes])
    return transacao(db, () => {
      const r = db.prepare('UPDATE credenciais SET blob = ?, blob_sha256 = ?, ultimo_teste_em = NULL, ultimo_teste_ok = NULL, ultimo_teste_detalhe = NULL, origem_maquina = ?, atualizado_em = ?, versao = versao + 1 WHERE id = ? AND apagado_em IS NULL')
        .run(blob, sha256(blob), maquina, agora, atual.id)
      if (r.changes !== 1) throw inexistente(nome)
      registrarUso(db, { credencialId: atual.id, nome, agente: 'omni', sessao: null, motivo: 'rotacao', resultado: 'rotacionado', maquina, agora })
      return credencialPorNome(db, nome)
    })
  } finally { bytes.fill(0) }
}

export function apagarCredencial(db, nome, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  exigirNome(nome)
  return transacao(db, () => {
    const atual = porNome(db, nome)
    if (!atual) throw inexistente(nome)
    db.prepare('UPDATE credenciais SET apagado_em = ?, origem_maquina = ?, atualizado_em = ?, versao = versao + 1 WHERE id = ?').run(agora, maquina, agora, atual.id)
    return { id: atual.id, apagado_em: agora }
  })
}

export function restaurarCredencial(db, id, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  exigirId(id)
  return transacao(db, () => {
    const linha = db.prepare('SELECT nome FROM credenciais WHERE id = ? AND apagado_em IS NOT NULL').get(id)
    if (!linha) throw new CofreError('inexistente', 'Não há credencial com esse id na lixeira.')
    if (porNome(db, linha.nome)) throw jaExiste(linha.nome)
    db.prepare('UPDATE credenciais SET apagado_em = NULL, origem_maquina = ?, atualizado_em = ?, versao = versao + 1 WHERE id = ?').run(maquina, agora, id)
    return credencialPorNome(db, linha.nome)
  })
}

export function listarLixeira(db) { return db.prepare(`SELECT ${COLUNAS_PUBLICAS}, apagado_em FROM credenciais WHERE apagado_em IS NOT NULL ORDER BY apagado_em DESC, nome`).all().map(deLinha) }

// Esvaziar leva de vez só o que está na lixeira há mais de 30 dias; o registro de uso fica, e o diário
// anota a remoção. Sem secure_delete, o blob removido pode sobrar em página livre ou no WAL até ser
// reaproveitado, mas continua selado pela DPAPI do usuário.
export function esvaziarLixeira(db, { agora = agoraIso() } = {}) {
  const t = Date.parse(agora)
  return transacao(db, () => {
    const vencidas = db.prepare('SELECT id, apagado_em FROM credenciais WHERE apagado_em IS NOT NULL').all().filter((linha) => t - Date.parse(linha.apagado_em) > PRAZO_LIXEIRA)
    const apagar = db.prepare('DELETE FROM credenciais WHERE id = ?')
    for (const linha of vencidas) apagar.run(linha.id)
    return { apagadas: vencidas.length }
  })
}

// O caminho do dono: a presença (Windows Hello ou PIN, pela ponte de runtime/casa/presenca.mjs) é uma
// função síncrona que devolve { ok, motivo }. Ela só é chamada para credencial viva da guarda dpapi, para
// não pedir digital à toa, e todo pedido vira linha em usos com o agente dono.
function pedirAoDono(db, presenca, nome, motivo, { maquina, agora }) {
  exigirNome(nome)
  if (typeof presenca !== 'function') throw new CofreError('dados-invalidos', 'Falta a ponte de presença.')
  const linha = db.prepare('SELECT id, guarda, blob FROM credenciais WHERE nome = ? AND apagado_em IS NULL').get(nome)
  const registrar = (resultado) => registrarUso(db, { credencialId: linha?.id ?? null, nome, agente: DONO, sessao: null, motivo, resultado, maquina, agora })
  if (!linha) { registrar('recusado-inexistente'); throw inexistente(nome) }
  if (linha.guarda !== 'dpapi') { registrar('recusado-gerenciador'); throw soNoGerenciador(nome) }
  let presente
  try { presente = presenca() } catch (erro) { registrar('recusado-presenca'); throw erro }
  if (presente?.ok !== true) {
    registrar('recusado-presenca')
    throw new CofreError('sem-presenca', `A presença do dono não foi confirmada (${presente?.motivo ?? 'sem resposta'}).`)
  }
  return { linha, registrar }
}

export function revelarAoDono(db, ponte, presenca, nome, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  const { linha, registrar } = pedirAoDono(db, presenca, nome, 'ver', { maquina, agora })
  const valor = abrirRegistrando(ponte, linha.blob, nome, registrar)
  try { return { valor, usoId: registrar('revelado-ao-dono') } } catch (erro) { valor.fill(0); throw erro }
}

// Copiar não devolve o valor: a ponte abre o blob, grava na área de transferência fora do histórico e da
// nuvem e programa a limpeza (runtime/casa/dpapi.mjs); aqui volta só o uso e a hora da limpeza.
export function copiarAoDono(db, ponte, presenca, nome, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  const { linha, registrar } = pedirAoDono(db, presenca, nome, 'copiar', { maquina, agora })
  let copiado
  try { copiado = ponte.abrirParaAreaDeTransferencia(linha.blob) } catch (erro) { registrar('falhou-copiar'); throw erro }
  if (!copiado?.ok) { registrar('falhou-copiar'); throw new CofreError('nao-copiou', `${nome} não foi copiada (${copiado?.erro ?? 'sem resposta'}).`) }
  return { usoId: registrar('copiado-ao-dono'), limpaEm: copiado.limpaEm ?? null }
}
