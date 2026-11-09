// Documentos .md da memória do Claude Code no omni.db (plano 2 da F1, §3.2 do desenho).
// Id = caminho relativo à pasta de projetos do Claude: claude-projects/<projeto>/memory/<nome>.md.
// _documentos_no_disco guarda, por máquina, o hash que banco e disco tinham em comum na última
// reconciliação: a base do merge de três vias (disco, banco, base).
import { agoraIso, maquinaAtual, uuidv7 } from './banco.mjs'

export const PREFIXO = 'claude-projects'

// Documento é .md e não é oculto (".md" sozinho também é oculto).
export function nomeDeDocumentoMd(nome) {
  return typeof nome === 'string' && nome.endsWith('.md') && !nome.startsWith('.')
}

// Segmento que, juntado a um caminho, não sai dele nem troca de raiz: sem separador (/ ou \),
// sem dois-pontos (unidade, ou fluxo alternativo do NTFS), sem nulo, e nunca . ou ..
export function segmentoValido(segmento) {
  return typeof segmento === 'string' && segmento.length > 0 && segmento !== '.' && segmento !== '..' &&
    !/[\\/:\0]/.test(segmento)
}

export function idDoDocumento(projeto, nome) {
  return segmentoValido(projeto) && segmentoValido(nome) && nomeDeDocumentoMd(nome)
    ? `${PREFIXO}/${projeto}/memory/${nome}`
    : null
}

// Id vindo do banco só vira caminho se for exatamente o que idDoDocumento produziria.
export function partesDoId(id) {
  if (typeof id !== 'string') return null
  const partes = id.split('/')
  if (partes.length !== 4 || partes[0] !== PREFIXO || partes[2] !== 'memory') return null
  return idDoDocumento(partes[1], partes[3]) === id ? { projeto: partes[1], nome: partes[3] } : null
}

// id -> { projeto, nome, sha, vivo } dos documentos da memória do Claude; o resto é ignorado.
export function documentosNoBanco(db) {
  const mapa = new Map()
  for (const linha of db.prepare('SELECT id, sha256, apagado_em FROM documentos WHERE id LIKE ?').all(`${PREFIXO}/%`)) {
    const partes = partesDoId(linha.id)
    if (partes) mapa.set(linha.id, { ...partes, sha: linha.sha256, vivo: linha.apagado_em === null })
  }
  return mapa
}

export function confirmadosNoDisco(db, maquina = maquinaAtual()) {
  return new Map(
    db.prepare('SELECT id, sha256 FROM _documentos_no_disco WHERE maquina = ?').all(maquina).map((linha) => [linha.id, linha.sha256])
  )
}

export function conteudoDoDocumento(db, id) {
  return db.prepare('SELECT conteudo FROM documentos WHERE id = ?').get(id)?.conteudo ?? null
}

// Grava a versão lida do disco. Mesmo hash vivo não é mudança; texto de lápide que volta é
// ressurreição. Toda mudança sobe a versão, e o gatilho anota no diário.
export function gravarDocumento(db, { id, conteudo, sha, bytes }, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  const atual = db.prepare('SELECT sha256, apagado_em FROM documentos WHERE id = ?').get(id)
  if (!atual) {
    db.prepare(`INSERT INTO documentos (id, formato, conteudo, sha256, bytes, origem_maquina, criado_em, atualizado_em)
      VALUES (?, 'md', ?, ?, ?, ?, ?, ?)`).run(id, conteudo, sha, bytes, maquina, agora, agora)
    return 'novo'
  }
  if (atual.apagado_em === null && atual.sha256 === sha) return 'igual'
  db.prepare(`UPDATE documentos SET formato = 'md', conteudo = ?, sha256 = ?, bytes = ?, origem_maquina = ?,
    atualizado_em = ?, versao = versao + 1, apagado_em = NULL WHERE id = ?`).run(conteudo, sha, bytes, maquina, agora, id)
  return atual.apagado_em === null ? 'alterado' : 'ressuscitado'
}

// Lápide: o conteúdo fica, só a marca muda; apagar o que já está apagado não é mudança.
export function apagarDocumento(db, id, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  return db.prepare(`UPDATE documentos SET apagado_em = ?, atualizado_em = ?, origem_maquina = ?, versao = versao + 1
    WHERE id = ? AND apagado_em IS NULL`).run(agora, agora, maquina, id).changes > 0
}

export function confirmarNoDisco(db, id, sha, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  db.prepare(`INSERT INTO _documentos_no_disco (maquina, id, sha256, em) VALUES (?, ?, ?, ?)
    ON CONFLICT (maquina, id) DO UPDATE SET sha256 = excluded.sha256, em = excluded.em`).run(maquina, id, sha, agora)
}

export function esquecerNoDisco(db, id, { maquina = maquinaAtual() } = {}) {
  db.prepare('DELETE FROM _documentos_no_disco WHERE maquina = ? AND id = ?').run(maquina, id)
}

export function registrarImportacaoDeDocumentos(db, { fonteSha, contagens, maquina = maquinaAtual(), agora = agoraIso() }) {
  db.prepare(`INSERT INTO _importacoes (id, tipo, fonte, fonte_sha256, contagens, origem_maquina, feita_em)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(uuidv7(), 'documentos-md', PREFIXO, fonteSha, JSON.stringify(contagens), maquina, agora)
}
