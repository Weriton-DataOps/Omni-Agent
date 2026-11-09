// Missões e livro de aprendizado operacional no omni.db (v4, plano 1 da F2). Substitui o broker do
// Postgres 5433 com as mesmas regras:
// - missão só muda com versão mais nova (atualizado_em maior) e cada mudança deixa um evento de id
//   natural (md5 de id + atualizado_em);
// - achado não regride (ultimo_visto_em), e o evento é idempotente pelo id que o sincronizador
//   já calcula.
// Tudo síncrono, dentro de transacao(): o hook não segura a trava esperando nada externo.

import { createHash } from 'node:crypto'

import { agoraIso, maquinaAtual, transacao, uuidv7 } from './banco.mjs'

const ESTADOS_MISSAO = new Set(['open', 'in-progress', 'blocked', 'completed', 'cancelled'])
const ESTADOS_ATIVOS = ['open', 'in-progress', 'blocked']
const FECHADOS = new Set(['completed', 'cancelled'])
const TIPOS_EVENTO_MISSAO = new Set(['created', 'updated', 'blocked', 'resumed', 'completed', 'cancelled', 'reconciled'])
const DESTINOS = new Set(['operational-rule', 'procedure', 'routing', 'hook', 'runtime-fix', 'personality', 'eval', 'capability'])
const ESTADOS_ACHADO = new Set(['observing', 'ready', 'implementation-required', 'materialized-pending-release', 'installed-verified', 'loaded-verified', 'superseded'])

const RE_MISSAO = /^mission-[a-zA-Z0-9-]{1,160}$/u
const RE_EVENTO_MISSAO = /^mission-event-[a-zA-Z0-9-]{1,160}$/u
const RE_ACHADO = /^improvement-[a-zA-Z0-9-]{1,160}$/u
const RE_EVENTO_ACHADO = /^learning-event-[a-f0-9]{24,64}$/u
const RE_CATEGORIA = /^[a-z][a-z0-9-]{1,79}$/u
const RE_IMPRESSAO = /^[a-f0-9]{64}$/u
const RE_RELEASE = /^v?[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/u

const md5 = (texto) => createHash('md5').update(texto, 'utf8').digest('hex')

// ISO UTC com milissegundos e Z, ou null se não for data.
function iso(valor) {
  if (typeof valor !== 'string' || !valor) return null
  const ms = Date.parse(valor)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

const objeto = (valor) => valor !== null && typeof valor === 'object' && !Array.isArray(valor)

// Mesmo CASE do broker: o tipo do evento sai do estado novo.
function tipoDoEvento(estado) {
  if (estado === 'completed' || estado === 'cancelled' || estado === 'blocked') return estado
  return estado === 'in-progress' ? 'resumed' : 'updated'
}

export function normalizarMissao(m) {
  if (!objeto(m) || typeof m.id !== 'string' || !RE_MISSAO.test(m.id)) return null
  if (typeof m.objective !== 'string' || m.objective.length < 3 || m.objective.length > 800) return null
  if (!ESTADOS_MISSAO.has(m.state)) return null
  if (!Number.isInteger(m.priority) || m.priority < 0 || m.priority > 100) return null
  const payload = m.payload ?? {}
  if (!objeto(payload)) return null
  const criadoEm = iso(m.createdAt)
  const atualizadoEm = iso(m.updatedAt)
  if (!criadoEm || !atualizadoEm) return null
  const fechadaEm = m.closedAt == null ? null : iso(m.closedAt)
  if (m.closedAt != null && !fechadaEm) return null
  if (FECHADOS.has(m.state) !== (fechadaEm !== null)) return null
  return { id: m.id, objetivo: m.objective, estado: m.state, prioridade: m.priority, corpo: JSON.stringify(payload), criadoEm, atualizadoEm, fechadaEm }
}

function preparadasDeMissao(db) {
  return {
    atual: db.prepare('SELECT atualizado_em, versao FROM missoes WHERE id = ?'),
    inserir: db.prepare(`INSERT INTO missoes (id, objetivo, estado, prioridade, corpo, fechada_em, origem_maquina, criado_em, atualizado_em, versao)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    atualizar: db.prepare(`UPDATE missoes SET objetivo = ?, estado = ?, prioridade = ?, corpo = ?, fechada_em = ?, atualizado_em = ?,
      versao = versao + 1, apagado_em = NULL WHERE id = ?`),
    evento: db.prepare(`INSERT OR IGNORE INTO missao_eventos (id, missao_id, tipo, corpo, em, origem_maquina) VALUES (?, ?, ?, ?, ?, ?)`)
  }
}

// Grava uma missão normalizada. Devolve 'aplicada' ou 'duplicada'. versaoInicial só serve à
// importação, que preserva a versão do PG; comEvento=false também (o dump traz os eventos).
function gravarUmaMissao(p, n, maquina, { versaoInicial = 1, comEvento = true } = {}) {
  const atual = p.atual.get(n.id)
  if (atual && atual.atualizado_em >= n.atualizadoEm) return 'duplicada'
  if (atual) p.atualizar.run(n.objetivo, n.estado, n.prioridade, n.corpo, n.fechadaEm, n.atualizadoEm, n.id)
  else p.inserir.run(n.id, n.objetivo, n.estado, n.prioridade, n.corpo, n.fechadaEm, maquina, n.criadoEm, n.atualizadoEm, versaoInicial)
  if (comEvento) p.evento.run(`mission-event-${md5(n.id + n.atualizadoEm)}`, n.id, tipoDoEvento(n.estado), n.corpo, n.atualizadoEm, maquina)
  return 'aplicada'
}

export function gravarMissoes(db, missoes, { maquina = maquinaAtual() } = {}) {
  const contagem = { aplicadas: 0, duplicadas: 0, invalidas: 0 }
  transacao(db, () => {
    const p = preparadasDeMissao(db)
    for (const m of missoes) {
      const n = normalizarMissao(m)
      if (!n) { contagem.invalidas += 1; continue }
      contagem[gravarUmaMissao(p, n, maquina) === 'aplicada' ? 'aplicadas' : 'duplicadas'] += 1
    }
  })
  return contagem
}

// Mesmo formato e ordem do list-active do broker.
export function listarMissoesAtivas(db, limite = 20) {
  return db.prepare(`SELECT id, objetivo, estado, prioridade, corpo, criado_em, atualizado_em FROM missoes
    WHERE apagado_em IS NULL AND estado IN ('open', 'in-progress', 'blocked')
    ORDER BY prioridade DESC, atualizado_em DESC LIMIT ?`).all(limite)
    .map((l) => ({ id: l.id, objective: l.objetivo, state: l.estado, priority: l.prioridade, payload: JSON.parse(l.corpo), createdAt: l.criado_em, updatedAt: l.atualizado_em, closedAt: null }))
}

// Missão que o arquivo local já podou (retenção por ordem de chegada) e ficou ativa no banco vira
// fantasma no contexto. Só é encerrada a comprovadamente podada: ativa, fora do ciclo e criada antes
// da sessão mais antiga que sobrou. Ciclo vazio (máquina nova) não prova poda de nada.
export function encerrarMissoesPodadas(db, { idsVivos, maisAntiga, agora = agoraIso(), maquina = maquinaAtual() }) {
  const limite = iso(maisAntiga)
  if (!limite || !Array.isArray(idsVivos) || idsVivos.length === 0) return { encerradas: 0 }
  const quando = iso(agora)
  const vivos = new Set(idsVivos)
  let encerradas = 0
  transacao(db, () => {
    const candidatas = db.prepare(`SELECT id, corpo FROM missoes WHERE apagado_em IS NULL
      AND estado IN (${ESTADOS_ATIVOS.map(() => '?').join(', ')}) AND criado_em < ?`).all(...ESTADOS_ATIVOS, limite)
    const encerrar = db.prepare(`UPDATE missoes SET estado = 'cancelled', fechada_em = ?, atualizado_em = ?, versao = versao + 1 WHERE id = ?`)
    const evento = db.prepare(`INSERT OR IGNORE INTO missao_eventos (id, missao_id, tipo, corpo, em, origem_maquina) VALUES (?, ?, 'reconciled', ?, ?, ?)`)
    for (const c of candidatas) {
      if (vivos.has(c.id)) continue
      encerrar.run(quando, quando, c.id)
      evento.run(`mission-event-${md5(c.id + quando)}`, c.id, c.corpo, quando, maquina)
      encerradas += 1
    }
  })
  return { encerradas }
}

export function normalizarAchado(a) {
  if (!objeto(a)) return null
  if (typeof a.eventId !== 'string' || !RE_EVENTO_ACHADO.test(a.eventId)) return null
  if (typeof a.findingId !== 'string' || !RE_ACHADO.test(a.findingId)) return null
  if (typeof a.candidateFingerprint !== 'string' || !RE_IMPRESSAO.test(a.candidateFingerprint)) return null
  if (typeof a.category !== 'string' || !RE_CATEGORIA.test(a.category)) return null
  if (!DESTINOS.has(a.destination) || !ESTADOS_ACHADO.has(a.state)) return null
  if (!Number.isSafeInteger(a.occurrences) || a.occurrences < 1 || a.occurrences > 1_000_000) return null
  if (typeof a.statementFingerprint !== 'string' || !RE_IMPRESSAO.test(a.statementFingerprint)) return null
  if (typeof a.sourceFingerprint !== 'string' || !RE_IMPRESSAO.test(a.sourceFingerprint)) return null
  const artefato = a.artifactFingerprint ?? null
  if (artefato !== null && (typeof artefato !== 'string' || !RE_IMPRESSAO.test(artefato))) return null
  const release = a.releaseVersion ?? null
  if (release !== null && (typeof release !== 'string' || !RE_RELEASE.test(release))) return null
  const vistoEm = iso(a.observedAt)
  if (!vistoEm) return null
  return {
    eventoId: a.eventId, id: a.findingId, candidato: a.candidateFingerprint, categoria: a.category, destino: a.destination,
    estado: a.state, ocorrencias: a.occurrences, enunciado: a.statementFingerprint, fonte: a.sourceFingerprint,
    artefato, release, vistoEm
  }
}

function preparadasDeAchado(db) {
  return {
    eventoExiste: db.prepare('SELECT 1 FROM aprendizado_eventos WHERE id = ?'),
    atual: db.prepare('SELECT ultimo_visto_em FROM aprendizado_achados WHERE id = ?'),
    inserir: db.prepare(`INSERT INTO aprendizado_achados (id, impressao_candidato, categoria, destino, estado, ocorrencias, impressao_enunciado,
      impressao_fonte, impressao_artefato, versao_release, primeiro_visto_em, ultimo_visto_em, origem_maquina, criado_em, atualizado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    atualizar: db.prepare(`UPDATE aprendizado_achados SET impressao_candidato = ?, categoria = ?, destino = ?, estado = ?, ocorrencias = ?,
      impressao_enunciado = ?, impressao_fonte = ?, impressao_artefato = ?, versao_release = ?, ultimo_visto_em = ?, atualizado_em = ?,
      versao = versao + 1, apagado_em = NULL WHERE id = ?`),
    evento: db.prepare(`INSERT OR IGNORE INTO aprendizado_eventos (id, achado_id, estado, ocorrencias, impressao_fonte, impressao_artefato,
      versao_release, em, origem_maquina) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  }
}

// Replica learning.record_improvement_finding: evento conhecido é duplicado; senão o achado
// avança só se o evento não for mais velho que o último visto, e o evento entra sempre.
export function gravarAchados(db, achados, { maquina = maquinaAtual(), agora = agoraIso() } = {}) {
  const contagem = { registrados: 0, duplicados: 0, invalidos: 0 }
  transacao(db, () => {
    const p = preparadasDeAchado(db)
    for (const a of achados) {
      const n = normalizarAchado(a)
      if (!n) { contagem.invalidos += 1; continue }
      if (p.eventoExiste.get(n.eventoId)) { contagem.duplicados += 1; continue }
      const atual = p.atual.get(n.id)
      if (!atual) {
        p.inserir.run(n.id, n.candidato, n.categoria, n.destino, n.estado, n.ocorrencias, n.enunciado, n.fonte, n.artefato, n.release, n.vistoEm, n.vistoEm, maquina, agora, agora)
      } else if (atual.ultimo_visto_em <= n.vistoEm) {
        p.atualizar.run(n.candidato, n.categoria, n.destino, n.estado, n.ocorrencias, n.enunciado, n.fonte, n.artefato, n.release, n.vistoEm, agora, n.id)
      }
      p.evento.run(n.eventoId, n.id, n.estado, n.ocorrencias, n.fonte, n.artefato, n.release, n.vistoEm, maquina)
      contagem.registrados += 1
    }
  })
  return contagem
}

const lista = (valor) => (Array.isArray(valor) ? valor : [])

// Importa o dump JSON do 5433 (scripts/omni-exportar-5433.ps1). Idempotente: missão e achado só
// entram se forem mais novos que o que já está aqui; eventos entram pelo id do PG, sem gerar
// evento novo. Devolve só o que entrou de fato.
export function importarDoPostgres(db, dump, { fonte, fonteSha256, maquina = maquinaAtual(), agora = agoraIso() }) {
  const r = { missoes: 0, missaoEventos: 0, achados: 0, achadoEventos: 0, invalidas: 0 }
  transacao(db, () => {
    const pm = preparadasDeMissao(db)
    for (const m of lista(dump.missoes)) {
      const n = normalizarMissao(m)
      if (!n) { r.invalidas += 1; continue }
      const versao = Number.isSafeInteger(m.version) && m.version >= 1 ? m.version : 1
      if (gravarUmaMissao(pm, n, maquina, { versaoInicial: versao, comEvento: false }) === 'aplicada') r.missoes += 1
    }
    for (const e of lista(dump.missaoEventos)) {
      const em = iso(e?.observedAt)
      if (typeof e?.id !== 'string' || !RE_EVENTO_MISSAO.test(e.id) || !TIPOS_EVENTO_MISSAO.has(e.kind) || !em) { r.invalidas += 1; continue }
      r.missaoEventos += Number(pm.evento.run(e.id, e.missionId, e.kind, JSON.stringify(e.payload ?? {}), em, maquina).changes)
    }
    const pa = preparadasDeAchado(db)
    for (const a of lista(dump.achados)) {
      const n = normalizarAchado({ ...a, eventId: `learning-event-${'0'.repeat(32)}`, observedAt: a?.lastObservedAt })
      const primeiro = iso(a?.firstObservedAt)
      if (!n || !primeiro || primeiro > n.vistoEm) { r.invalidas += 1; continue }
      const atual = pa.atual.get(n.id)
      if (atual && atual.ultimo_visto_em >= n.vistoEm) continue
      if (atual) pa.atualizar.run(n.candidato, n.categoria, n.destino, n.estado, n.ocorrencias, n.enunciado, n.fonte, n.artefato, n.release, n.vistoEm, agora, n.id)
      else pa.inserir.run(n.id, n.candidato, n.categoria, n.destino, n.estado, n.ocorrencias, n.enunciado, n.fonte, n.artefato, n.release, primeiro, n.vistoEm, maquina, agora, agora)
      r.achados += 1
    }
    for (const e of lista(dump.achadoEventos)) {
      const em = iso(e?.observedAt)
      if (typeof e?.eventId !== 'string' || !RE_EVENTO_ACHADO.test(e.eventId) || !ESTADOS_ACHADO.has(e.state) || !em) { r.invalidas += 1; continue }
      r.achadoEventos += Number(pa.evento.run(e.eventId, e.findingId, e.state, e.occurrences, e.sourceFingerprint, e.artifactFingerprint ?? null, e.releaseVersion ?? null, em, maquina).changes)
    }
    db.prepare('INSERT INTO _importacoes (id, tipo, fonte, fonte_sha256, contagens, origem_maquina, feita_em) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(uuidv7(), 'postgres-5433', String(fonte ?? ''), String(fonteSha256 ?? ''), JSON.stringify(r), maquina, agora)
  })
  return r
}

// Prova da importação: todo id do dump está aqui e nada aqui é mais velho que o dump.
export function verificarImportacao(db, dump) {
  const conferir = (itens, idDe, consulta, quandoDe, coluna) => {
    const buscar = db.prepare(consulta)
    const t = { esperadas: itens.length, faltando: 0, atrasadas: 0 }
    for (const item of itens) {
      const linha = buscar.get(idDe(item))
      if (!linha) { t.faltando += 1; continue }
      if (coluna && linha[coluna] < iso(quandoDe(item))) t.atrasadas += 1
    }
    return t
  }
  const tabelas = {
    missoes: conferir(lista(dump.missoes), (m) => m.id, 'SELECT atualizado_em FROM missoes WHERE id = ?', (m) => m.updatedAt, 'atualizado_em'),
    missaoEventos: conferir(lista(dump.missaoEventos), (e) => e.id, 'SELECT 1 AS x FROM missao_eventos WHERE id = ?'),
    achados: conferir(lista(dump.achados), (a) => a.findingId, 'SELECT ultimo_visto_em FROM aprendizado_achados WHERE id = ?', (a) => a.lastObservedAt, 'ultimo_visto_em'),
    achadoEventos: conferir(lista(dump.achadoEventos), (e) => e.eventId, 'SELECT 1 AS x FROM aprendizado_eventos WHERE id = ?')
  }
  const memoria = db.prepare('SELECT 1 FROM memorias WHERE id = ?')
  const memoriasSoNoPostgres = lista(dump.memorias).filter((id) => !memoria.get(id)).length
  const ok = Object.values(tabelas).every((t) => t.faltando === 0 && t.atrasadas === 0)
  return { ok, tabelas, memoriasSoNoPostgres }
}
