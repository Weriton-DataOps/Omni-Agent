// Estados de aprendizado e feedback no omni.db (plano 3 da F1, §4.2 e §6 do desenho).
// Cada estado (learning/*.json, feedback/*.json) vira uma linha de `estados`, com o esqueleto (o
// documento com as coleções vazias e o relógio zerado), e uma linha de `estado_registros` por
// item de coleção. Só a forma canônica (JSON.stringify(doc, null, 2) + '\n') entra e sai:
// recompor confere o sha256 do texto inteiro e recusa divergência.
import { agoraIso, maquinaAtual, sha256, transacao, uuidv7 } from './banco.mjs'

// p2: o dono passa pela ponte (runtime/estados.mjs). espelho: o dono é a loja TS do dist, e o
// banco a acompanha na varredura. chaves: coleção cujo item tem chave natural própria.
export const CATALOGO = Object.freeze({
  'learning/failures.json': { modo: 'p2' },
  'learning/failure-automation.json': { modo: 'p2' },
  'learning/self-improvement.json': { modo: 'p2' },
  'learning/shortcuts.json': { modo: 'p2' },
  'learning/evolution-receipts.json': { modo: 'p2' },
  'feedback/personality-feedback.json': { modo: 'p2', chaves: { lastResponses: 'sessionFingerprint' } },
  'feedback/personality-continuity.json': { modo: 'espelho', chaves: { observations: 'fingerprint' } },
  'feedback/personality-owner-directions.json': { modo: 'espelho', chaves: { observations: 'fingerprint' } }
})

function definicaoDo(rel) {
  if (!Object.hasOwn(CATALOGO, rel)) throw new Error(`Estado fora do catálogo: ${rel}`)
  return CATALOGO[rel]
}

function objetoSimples(valor) {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor)
}

const idDoRegistro = (rel, colecao, chave) => `${rel}|${colecao}|${chave}`

// Esqueleto: o documento com cada coleção (valor de topo que é array) trocada por [] e o
// store.updatedAt texto trocado por null. O relógio sai à parte: é local de cada máquina.
export function decompor(doc) {
  if (!objetoSimples(doc)) throw new Error('Estado precisa ser objeto JSON.')
  const colecoes = []
  const esqueleto = Object.fromEntries(Object.entries(doc).map(([chave, valor]) => {
    if (!Array.isArray(valor)) return [chave, valor]
    if (chave.includes('|')) throw new Error(`Coleção com "|" no nome não vira registro: ${chave}`)
    colecoes.push([chave, valor])
    return [chave, []]
  }))
  const relogio = typeof doc.store?.updatedAt === 'string' ? doc.store.updatedAt : null
  if (relogio !== null) esqueleto.store = { ...doc.store, updatedAt: null }
  return { esqueleto: JSON.stringify(esqueleto), relogio, colecoes }
}

// Chave natural do item: o campo do catálogo; senão o id texto; senão o próprio texto (até 200
// caracteres); senão h: + 32 hex do sha256 do item. Repetida ganha #1, #2… até achar uma livre
// (['x','x','x#1'] → x, x#1, x#1#1), então a chave é única na coleção.
export function linhasDe(itens, campoChave) {
  const usadas = new Set()
  return itens.map((item) => {
    const corpo = JSON.stringify(item) // os itens vêm de JSON.parse: sempre serializam
    let base
    if (campoChave && typeof item?.[campoChave] === 'string') base = item[campoChave]
    else if (typeof item?.id === 'string') base = item.id
    else if (typeof item === 'string' && item.length <= 200) base = item
    else base = `h:${sha256(corpo).slice(0, 32)}`
    let chave = base
    for (let n = 1; usadas.has(chave); n += 1) chave = `${base}#${n}`
    usadas.add(chave)
    return { chave, corpo }
  })
}

// Regra da cauda: enquanto a ordem gravada cresce, o item a mantém; da primeira quebra em diante,
// maior+1, maior+2… Append no fim não mexe em ninguém.
export function planejarOrdem(gravadas) {
  let maior = -1
  for (const ordem of gravadas) if (ordem !== undefined && ordem > maior) maior = ordem
  let ultima = -Infinity
  let quebrou = false
  return gravadas.map((ordem) => {
    if (!quebrou && ordem !== undefined && ordem > ultima) {
      ultima = ordem
      return ordem
    }
    quebrou = true
    maior += 1
    return maior
  })
}

export function shaDoEstado(db, rel) {
  return db.prepare('SELECT texto_sha256 FROM estados WHERE id = ? AND apagado_em IS NULL').get(rel)?.texto_sha256 ?? null
}

export function baseNoDisco(db, rel, maquina = maquinaAtual()) {
  return db.prepare('SELECT sha256 FROM _estados_no_disco WHERE maquina = ? AND id = ?').get(maquina, rel)?.sha256 ?? null
}

export function confirmarEstadoNoDisco(db, rel, sha, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  db.prepare(`INSERT INTO _estados_no_disco (maquina, id, sha256, em) VALUES (?, ?, ?, ?)
    ON CONFLICT (maquina, id) DO UPDATE SET sha256 = excluded.sha256, em = excluded.em`).run(maquina, rel, sha, agora)
}

// Grava um documento já validado; texto é a forma canônica dele. Sem transação própria (transacao
// não é reentrante): quem chama segura o BEGIN IMMEDIATE. Sobe versão só o que mudou: registro
// novo, mudado, movido ou apagado, e o esqueleto. Mudança só do relógio não vai ao diário.
export function escreverEstado(db, rel, doc, texto, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  const definicao = definicaoDo(rel)
  const { esqueleto, relogio, colecoes } = decompor(doc)
  const vivos = new Map(db.prepare('SELECT id, ordem, sha256 FROM estado_registros WHERE arquivo = ? AND apagado_em IS NULL')
    .all(rel).map((linha) => [linha.id, linha]))
  const inserir = db.prepare(`INSERT INTO estado_registros (id, arquivo, colecao, ordem, sha256, corpo, origem_maquina, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET ordem = excluded.ordem, sha256 = excluded.sha256, corpo = excluded.corpo,
      origem_maquina = excluded.origem_maquina, atualizado_em = excluded.atualizado_em, versao = versao + 1, apagado_em = NULL`)
  const mudar = db.prepare(`UPDATE estado_registros SET ordem = ?, sha256 = ?, corpo = ?, origem_maquina = ?, atualizado_em = ?,
    versao = versao + 1 WHERE id = ?`)
  const apagar = db.prepare(`UPDATE estado_registros SET corpo = '', sha256 = '', origem_maquina = ?, atualizado_em = ?, apagado_em = ?,
    versao = versao + 1 WHERE id = ?`)
  const vistos = new Set()
  for (const [colecao, itens] of colecoes) {
    const linhas = linhasDe(itens, definicao.chaves?.[colecao]).map((linha) => ({ ...linha, id: idDoRegistro(rel, colecao, linha.chave) }))
    const ordens = planejarOrdem(linhas.map((linha) => vivos.get(linha.id)?.ordem))
    linhas.forEach((linha, i) => {
      vistos.add(linha.id)
      const sha = sha256(linha.corpo)
      const atual = vivos.get(linha.id)
      // Sem linha viva: registro novo ou lápide que ressuscita (o upsert preserva criado_em).
      if (!atual) inserir.run(linha.id, rel, colecao, ordens[i], sha, linha.corpo, maquina, agora, agora)
      else if (atual.sha256 !== sha || atual.ordem !== ordens[i]) mudar.run(ordens[i], sha, linha.corpo, maquina, agora, linha.id)
    })
  }
  for (const id of vivos.keys()) if (!vistos.has(id)) apagar.run(maquina, agora, agora, id)
  const textoSha = sha256(texto)
  const linha = db.prepare('SELECT esqueleto, apagado_em FROM estados WHERE id = ?').get(rel)
  if (!linha) {
    db.prepare(`INSERT INTO estados (id, esqueleto, texto_sha256, relogio, origem_maquina, criado_em, atualizado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(rel, esqueleto, textoSha, relogio, maquina, agora, agora)
  } else if (linha.esqueleto !== esqueleto || linha.apagado_em !== null) {
    db.prepare(`UPDATE estados SET esqueleto = ?, texto_sha256 = ?, relogio = ?, origem_maquina = ?, atualizado_em = ?,
      versao = versao + 1, apagado_em = NULL WHERE id = ?`).run(esqueleto, textoSha, relogio, maquina, agora, rel)
  } else {
    // Mesmo esqueleto: hash e relógio acompanham, sem versão e sem diário.
    db.prepare('UPDATE estados SET texto_sha256 = ?, relogio = ? WHERE id = ?').run(textoSha, relogio, rel)
  }
}

// Remonta o documento (esqueleto, relógio e registros por coleção e ordem) e confere o sha256 do
// texto inteiro contra texto_sha256: divergência lança, nunca devolve texto que o banco não gravou.
export function recomporEstado(db, rel) {
  const linha = db.prepare('SELECT esqueleto, relogio, texto_sha256 FROM estados WHERE id = ? AND apagado_em IS NULL').get(rel)
  if (!linha) throw new Error(`Estado ${rel} não está no banco.`)
  const doc = JSON.parse(linha.esqueleto)
  if (linha.relogio !== null) doc.store.updatedAt = linha.relogio
  const registros = db.prepare('SELECT colecao, corpo FROM estado_registros WHERE arquivo = ? AND apagado_em IS NULL ORDER BY colecao, ordem')
    .all(rel)
  for (const registro of registros) {
    if (!Array.isArray(doc[registro.colecao])) {
      throw new Error(`Registro de ${rel} aponta coleção que o esqueleto não tem: ${registro.colecao}.`)
    }
    doc[registro.colecao].push(JSON.parse(registro.corpo))
  }
  const texto = `${JSON.stringify(doc, null, 2)}\n`
  if (sha256(texto) !== linha.texto_sha256) throw new Error(`Recomposição de ${rel} divergiu do texto gravado.`)
  return texto
}

// Itens vivos por coleção; coleção vazia no esqueleto conta 0.
export function contarEstado(db, rel) {
  const { esqueleto } = db.prepare('SELECT esqueleto FROM estados WHERE id = ?').get(rel)
  const contagens = new Map(Object.entries(JSON.parse(esqueleto)).filter(([, valor]) => Array.isArray(valor)).map(([chave]) => [chave, 0]))
  const porColecao = db.prepare('SELECT colecao, COUNT(*) AS n FROM estado_registros WHERE arquivo = ? AND apagado_em IS NULL GROUP BY colecao')
    .all(rel)
  for (const { colecao, n } of porColecao) contagens.set(colecao, n)
  return Object.fromEntries(contagens)
}

export function registrarImportacaoDeEstado(db, rel, { fonteSha, contagens, maquina = maquinaAtual(), agora = agoraIso() }) {
  db.prepare('INSERT INTO _importacoes (id, tipo, fonte, fonte_sha256, contagens, origem_maquina, feita_em) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(uuidv7(), 'estados', rel, fonteSha, JSON.stringify(contagens), maquina, agora)
}

// Primeira carga de um estado. Sem transação própria. A fonte original pode vir compacta: o banco
// guarda a forma canônica, a base desta máquina vira o hash dela e _importacoes anota o hash da
// fonte original. Estado já presente não é reimportado.
export function importarEstado(db, rel, fonte, opcoes = {}) {
  if (shaDoEstado(db, rel) !== null) return 'presente'
  const doc = JSON.parse(fonte)
  const canonica = `${JSON.stringify(doc, null, 2)}\n`
  escreverEstado(db, rel, doc, canonica, opcoes)
  recomporEstado(db, rel) // lança se a ida e volta divergir
  registrarImportacaoDeEstado(db, rel, { fonteSha: sha256(fonte), contagens: contarEstado(db, rel), ...opcoes })
  confirmarEstadoNoDisco(db, rel, sha256(canonica), opcoes)
  return 'importada'
}

// Só a forma canônica entra: os seis módulos e a loja TS já gravam assim, e só com ela o hash
// da recomposição fecha.
export function docCanonico(rel, texto) {
  const doc = JSON.parse(texto)
  if (`${JSON.stringify(doc, null, 2)}\n` !== texto) throw new Error(`Estado ${rel} fora da forma canônica.`)
  return doc
}

// Escrita direta, em transação própria (testes e prova). A ponte usa escreverEstado dentro da
// transação dela, junto com a projeção.
export function gravarEstado(db, rel, texto, opcoes = {}) {
  const doc = docCanonico(rel, texto)
  transacao(db, () => escreverEstado(db, rel, doc, texto, opcoes))
}
