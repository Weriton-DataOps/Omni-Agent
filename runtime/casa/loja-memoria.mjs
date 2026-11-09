// Memória do Omni no SQLite (F1 do desenho). Cada registro das raias vira uma linha de
// `memorias`; o resto do documento (schemaVersion, store e a ordem das chaves) fica no esqueleto
// em memoria_meta. Remontar devolve exatamente o texto de JSON.stringify(memória, null, 2), então
// a projeção memory.json continua byte a byte igual à que o Omni sempre escreveu.
//
// gravarMemoriaNoBanco não abre transação: quem chama a envolve. salvarMemoria (gravação do
// Omni) e ingerirMemoria (arquivo escrito por fora) são as transações prontas que o runtime usa.
import { agoraIso, maquinaAtual, sha256, transacao, uuidv7 } from './banco.mjs'
import { registrarProjecao } from './projecao.mjs'

export const ARQUIVO_MEMORIA = 'memory/memory.json'
export const RAIAS = Object.freeze(['confirmed', 'candidates', 'archive'])

export function textoDaMemoria(memoria) {
  return `${JSON.stringify(memoria, null, 2)}\n`
}

function lerMeta(db, chave) {
  return db.prepare('SELECT valor FROM memoria_meta WHERE chave = ?').get(chave)?.valor ?? null
}

function gravarMeta(db, chave, valor) {
  db.prepare(`INSERT INTO memoria_meta (chave, valor) VALUES (?, ?)
    ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor`).run(chave, valor)
}

// Hash do texto canônico da versão corrente; null quando o banco ainda não recebeu memória.
export function shaDaMemoriaNoBanco(db) {
  return lerMeta(db, 'texto_sha256')
}

export function lerMemoriaDoBanco(db) {
  const esqueleto = lerMeta(db, 'esqueleto')
  if (esqueleto === null) return null
  const memoria = JSON.parse(esqueleto)
  const daRaia = db.prepare('SELECT corpo FROM memorias WHERE raia = ? AND apagado_em IS NULL ORDER BY ordem')
  for (const raia of RAIAS) {
    // Atribuir a uma chave que já existe mantém a posição dela: a ordem das chaves sobrevive.
    if (Object.hasOwn(memoria, raia)) memoria[raia] = daRaia.all(raia).map((linha) => JSON.parse(linha.corpo))
  }
  return memoria
}

export function contarMemoriaNoBanco(db) {
  const contagens = Object.fromEntries(RAIAS.map((raia) => [raia, 0]))
  for (const linha of db.prepare('SELECT raia, COUNT(*) AS n FROM memorias WHERE apagado_em IS NULL GROUP BY raia').all()) {
    contagens[linha.raia] = linha.n
  }
  return contagens
}

function linhasDesejadas(memoria) {
  const linhas = new Map()
  for (const raia of RAIAS) {
    if (!Object.hasOwn(memoria, raia)) continue
    const itens = memoria[raia]
    if (!Array.isArray(itens)) throw new Error(`Raia ${raia} da memória não é lista.`)
    itens.forEach((item, ordem) => {
      // Dentro de lista, o JSON.stringify do documento escreve null onde o item não é JSON.
      const corpo = JSON.stringify(item) ?? 'null'
      const proprio = typeof item?.id === 'string' && item.id.length > 0 ? item.id : null
      let id = proprio ?? `${raia}#${sha256(corpo).slice(0, 16)}`
      // Id repetido não derruba a gravação: a cópia ganha identidade derivada e nada se perde.
      for (let n = 2; linhas.has(id); n += 1) id = `${proprio ?? raia}#${n}`
      const base = raia === 'archive' ? item?.snapshot : item
      linhas.set(id, {
        id,
        raia,
        ordem,
        corpo,
        tipo: typeof base?.type === 'string' ? base.type : null,
        texto: typeof base?.text === 'string' ? base.text : null
      })
    })
  }
  return linhas
}

// Grava o documento como diferença: linha nova entra, linha mudada sobe a versao, linha que
// saiu vira lápide (apagado_em), lápide que volta ressuscita. Mudança só de ordem não sobe a
// versao: é arrumação local, não tráfego de sincronização.
export function gravarMemoriaNoBanco(db, memoria, {
  texto = textoDaMemoria(memoria),
  maquina = maquinaAtual(),
  agora = agoraIso()
} = {}) {
  const esqueleto = {}
  for (const [chave, valor] of Object.entries(memoria)) {
    esqueleto[chave] = RAIAS.includes(chave) ? [] : valor
  }
  const desejadas = linhasDesejadas(memoria)
  const existentes = new Map(
    db.prepare('SELECT id, raia, ordem, corpo, apagado_em FROM memorias').all().map((linha) => [linha.id, linha])
  )
  const inserir = db.prepare(`INSERT INTO memorias
    (id, raia, ordem, tipo, texto, corpo, origem_maquina, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const alterar = db.prepare(`UPDATE memorias SET raia = ?, ordem = ?, tipo = ?, texto = ?, corpo = ?,
    origem_maquina = ?, atualizado_em = ?, versao = versao + 1, apagado_em = NULL WHERE id = ?`)
  const reordenar = db.prepare('UPDATE memorias SET ordem = ? WHERE id = ?')
  const apagar = db.prepare(`UPDATE memorias SET apagado_em = ?, atualizado_em = ?, origem_maquina = ?,
    versao = versao + 1 WHERE id = ?`)

  const contagens = { inseridas: 0, alteradas: 0, reordenadas: 0, apagadas: 0 }
  for (const linha of desejadas.values()) {
    const atual = existentes.get(linha.id)
    if (!atual) {
      inserir.run(linha.id, linha.raia, linha.ordem, linha.tipo, linha.texto, linha.corpo, maquina, agora, agora)
      contagens.inseridas += 1
    } else if (atual.apagado_em !== null || atual.raia !== linha.raia || atual.corpo !== linha.corpo) {
      alterar.run(linha.raia, linha.ordem, linha.tipo, linha.texto, linha.corpo, maquina, agora, linha.id)
      contagens.alteradas += 1
    } else if (atual.ordem !== linha.ordem) {
      reordenar.run(linha.ordem, linha.id)
      contagens.reordenadas += 1
    }
  }
  for (const atual of existentes.values()) {
    if (atual.apagado_em === null && !desejadas.has(atual.id)) {
      apagar.run(agora, agora, maquina, atual.id)
      contagens.apagadas += 1
    }
  }
  const sha = sha256(texto)
  gravarMeta(db, 'esqueleto', JSON.stringify(esqueleto))
  gravarMeta(db, 'texto_sha256', sha)
  return { texto, sha, contagens }
}

// Gravação do Omni: a versão nova vira a corrente e o hash dela fica conhecido como projeção
// escrita, na mesma transação. O arquivo é escrito depois, já fora da trava do banco.
export function salvarMemoria(db, memoria, texto = textoDaMemoria(memoria)) {
  return transacao(db, () => {
    const gravada = gravarMemoriaNoBanco(db, memoria, { texto })
    registrarProjecao(db, ARQUIVO_MEMORIA, gravada.sha, 'escrita')
    return gravada
  })
}

// Arquivo escrito por fora (versão antiga do plugin, mão humana, gravação feita com o banco fora
// do ar): o que ele traz vira a versão corrente. O hash da origem entra como ingerido antes do
// hash canônico, para a mesma cópia voltando depois ser reconhecida como defasada e não reentrar.
export function ingerirMemoria(db, memoria, { texto = textoDaMemoria(memoria), fonteSha }) {
  return transacao(db, () => {
    const gravada = gravarMemoriaNoBanco(db, memoria, { texto })
    registrarProjecao(db, ARQUIVO_MEMORIA, fonteSha, 'ingerida')
    registrarProjecao(db, ARQUIVO_MEMORIA, gravada.sha, 'escrita')
    const raias = Object.fromEntries(RAIAS.map((raia) => [raia, Array.isArray(memoria[raia]) ? memoria[raia].length : 0]))
    db.prepare(`INSERT INTO _importacoes (id, tipo, fonte, fonte_sha256, contagens, origem_maquina, feita_em)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      uuidv7(), 'memoria', ARQUIVO_MEMORIA, fonteSha,
      JSON.stringify({ ...raias, ...gravada.contagens }), maquinaAtual(), agoraIso()
    )
    return gravada
  })
}
