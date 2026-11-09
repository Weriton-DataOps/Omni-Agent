// Documentos .md da memória do Claude Code (~/.claude/projects/<projeto>/memory/*.md) no omni.db
// (plano 2 da F1, §3.2 do desenho): o banco é a fonte e a pasta é projeção. A reconciliação
// compara três hashes por documento — D no disco, B vivo no banco e C, o último que os dois
// tiveram em comum nesta máquina (_documentos_no_disco) — e decide:
//   D = B                em dia (acerta C se precisar);
//   D ≠ B, C = D         o banco andou e o disco não: projeta B, relendo o hash antes de escrever;
//   D, nos demais casos  arquivo novo, ressurreição ou edição externa: ingere (o disco vence o
//                        conflito, e voltar a um texto antigo também é edição);
//   sem D, C = B         apagado com irmãos .md no mesmo memory/: lápide no banco;
//   sem D, nos demais    memory/ sem nenhum .md, ou o banco andou depois: projeta B.
// Projeto apagado inteiro fica como está; item que não é arquivo de texto UTF-8 legível fica
// intocado; a F1 nunca apaga arquivo do disco. Roda na varredura diária, depois do estado dela salvo.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { acquireLocalFileLock } from '../dist/adapters/local-json/node-local-file-lock.js'
import {
  agoraIso,
  comBancoDaCasa,
  maquinaAtual,
  mesmoCaminho,
  registrarDegradacao,
  sha256,
  sqliteDisponivel,
  transacao
} from './casa/banco.mjs'
import {
  apagarDocumento,
  confirmadosNoDisco,
  confirmarNoDisco,
  conteudoDoDocumento,
  documentosNoBanco,
  esquecerNoDisco,
  gravarDocumento,
  idDoDocumento,
  partesDoId,
  registrarImportacaoDeDocumentos,
  segmentoValido
} from './casa/loja-documentos.mjs'
import { escreverAtomico, lerSeExistir } from './casa/projecao.mjs'

// Uma reconciliação por casa de cada vez; a segunda desiste rápido e a próxima varredura refaz.
const TRAVA = {
  acquisitionTimeoutMs: 250,
  retryDelayMs: 25,
  staleLockMs: 120_000,
  heartbeatMs: 20_000,
  timeoutMessage: 'A reconciliação dos documentos .md já está em andamento.'
}

// fatal: byte inválido não vira U+FFFD (o arquivo fica intocado em vez de ingerido torto);
// ignoreBOM: o BOM fica no texto, e a projeção devolve o arquivo byte a byte.
const decodificador = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

function zeradas() {
  return { lidos: 0, atuais: 0, ingeridos: 0, apagados: 0, projetados: 0, pulados: 0 }
}

// A casa de produção (%APPDATA%\omni) reconcilia a pasta real do Claude Code; qualquer outra casa
// (teste, casa alternativa) usa <casa>\claude\projects e nunca encosta na real.
export function pastaDeProjetosDoClaude(casa, env = process.env) {
  const absoluta = resolve(casa)
  if (env.APPDATA && mesmoCaminho(absoluta, resolve(env.APPDATA, 'omni'))) return join(homedir(), '.claude', 'projects')
  return join(absoluta, 'claude', 'projects')
}

function ehPasta(caminho) {
  try {
    return statSync(caminho).isDirectory()
  } catch {
    return false
  }
}

// Fotografia do disco. projetos: nome -> { temMd }, ou null quando memory/ não pôde ser lida
// (projeto intocado). arquivos: id -> { conteudo, sha, bytes }. intocados: ids com nome .md que
// existem mas não são arquivo de texto UTF-8 legível — nem ingeridos, nem lápide, nem projetados.
function lerDisco(raiz, casa, env) {
  const projetos = new Map()
  const arquivos = new Map()
  const intocados = new Set()
  for (const entrada of readdirSync(raiz, { withFileTypes: true })) {
    if (!entrada.isDirectory() || !segmentoValido(entrada.name)) continue
    const projeto = entrada.name
    const pasta = join(raiz, projeto, 'memory')
    let itens
    try {
      itens = readdirSync(pasta, { withFileTypes: true })
    } catch (erro) {
      if (erro?.code === 'ENOENT') {
        projetos.set(projeto, { temMd: false })
      } else {
        registrarDegradacao(casa, 'documentos.ler', erro, env)
        projetos.set(projeto, null)
      }
      continue
    }
    let temMd = false
    for (const item of itens) {
      const id = idDoDocumento(projeto, item.name)
      if (!id) continue
      temMd = true
      if (!item.isFile()) {
        intocados.add(id)
        continue
      }
      let bytes
      try {
        bytes = readFileSync(join(pasta, item.name))
      } catch (erro) {
        registrarDegradacao(casa, 'documentos.ler', erro, env)
        intocados.add(id)
        continue
      }
      let conteudo
      try {
        conteudo = decodificador.decode(bytes)
      } catch (erro) {
        registrarDegradacao(casa, 'documentos.codificacao', erro, env)
        intocados.add(id)
        continue
      }
      arquivos.set(id, { conteudo, sha: sha256(bytes), bytes: bytes.length })
    }
    projetos.set(projeto, { temMd })
  }
  return { projetos, arquivos, intocados }
}

// Roda dentro da transação; as contagens só valem para quem chama depois do commit.
function decidir(db, disco, carimbo) {
  const contagens = { atuais: 0, ingeridos: 0, apagados: 0 }
  const noBanco = documentosNoBanco(db)
  const confirmados = confirmadosNoDisco(db, carimbo.maquina)
  const projecoes = []
  const ids = [...new Set([...disco.arquivos.keys(), ...noBanco.keys(), ...confirmados.keys()])].sort()
  for (const id of ids) {
    const partes = partesDoId(id)
    const projeto = partes ? disco.projetos.get(partes.projeto) : null
    if (!projeto || disco.intocados.has(id)) continue
    const arquivo = disco.arquivos.get(id)
    const banco = noBanco.get(id)
    const B = banco?.vivo ? banco.sha : null
    const C = confirmados.get(id) ?? null
    if (arquivo) {
      const D = arquivo.sha
      if (D === B) {
        contagens.atuais += 1
        if (C !== D) confirmarNoDisco(db, id, D, carimbo)
      } else if (B !== null && C === D) {
        projecoes.push({ id, ...partes, esperado: D, sha: B })
      } else {
        gravarDocumento(db, { id, ...arquivo }, carimbo)
        confirmarNoDisco(db, id, D, carimbo)
        contagens.ingeridos += 1
      }
    } else if (B === null) {
      if (C !== null) esquecerNoDisco(db, id, carimbo)
    } else if (projeto.temMd && C === B) {
      apagarDocumento(db, id, carimbo)
      esquecerNoDisco(db, id, carimbo)
      contagens.apagados += 1
    } else {
      projecoes.push({ id, ...partes, esperado: null, sha: B })
    }
  }
  if (contagens.ingeridos + contagens.apagados > 0) {
    const fonteSha = sha256(JSON.stringify([...disco.arquivos.keys()].sort().map((id) => [id, disco.arquivos.get(id).sha])))
    registrarImportacaoDeDocumentos(db, {
      fonteSha,
      contagens: { lidos: disco.arquivos.size, ingeridos: contagens.ingeridos, apagados: contagens.apagados },
      ...carimbo
    })
  }
  for (const projecao of projecoes) projecao.conteudo = conteudoDoDocumento(db, projecao.id)
  return { projecoes, contagens }
}

// Escreve no disco as versões do banco. Antes de cada escrita relê o arquivo: se o hash não é
// mais o que a decisão viu (alguém escreveu no meio-tempo), pula, e a próxima passada decide de
// novo. Falha de disco vira degradação anotada e pulo, nunca exceção.
export function projetarDocumentos(raiz, projecoes, casa, env = process.env) {
  const feitas = []
  let pulados = 0
  for (const projecao of projecoes) {
    const caminho = join(raiz, projecao.projeto, 'memory', projecao.nome)
    try {
      const atual = lerSeExistir(caminho, null)
      if ((atual === null ? null : sha256(atual)) !== projecao.esperado) {
        pulados += 1
        continue
      }
      escreverAtomico(caminho, projecao.conteudo)
      feitas.push(projecao)
    } catch (erro) {
      registrarDegradacao(casa, 'documentos.projetar', erro, env)
      pulados += 1
    }
  }
  return { feitas, pulados }
}

// Nunca rejeita por falha de disco ou de banco: devolve o resultado e anota a degradação.
// projectsRoot só existe para teste; sem ele, a pasta vem da casa (pastaDeProjetosDoClaude).
export async function reconciliarDocumentosMd(casa, { projectsRoot, env = process.env } = {}) {
  const contagens = zeradas()
  if (!sqliteDisponivel(env)) return { resultado: 'sem-banco', contagens }
  const raiz = resolve(projectsRoot ?? pastaDeProjetosDoClaude(casa, env))
  if (!ehPasta(raiz)) return { resultado: 'sem-projetos', contagens }
  let trava
  try {
    trava = await acquireLocalFileLock(join(casa, 'runs', 'documentos-md.lock'), TRAVA)
  } catch (erro) {
    if (erro?.name === 'LocalJsonLockTimeoutError') return { resultado: 'em-andamento', contagens }
    throw erro
  }
  try {
    let disco
    try {
      disco = lerDisco(raiz, casa, env)
    } catch (erro) {
      registrarDegradacao(casa, 'documentos.ler', erro, env)
      return { resultado: 'degradada', contagens }
    }
    contagens.lidos = disco.arquivos.size
    contagens.pulados = disco.intocados.size
    try {
      comBancoDaCasa(casa, 'omni', (db) => {
        const carimbo = { maquina: maquinaAtual(), agora: agoraIso() }
        const decisao = transacao(db, () => decidir(db, disco, carimbo))
        Object.assign(contagens, decisao.contagens)
        const { feitas, pulados } = projetarDocumentos(raiz, decisao.projecoes, casa, env)
        contagens.projetados = feitas.length
        contagens.pulados += pulados
        if (feitas.length > 0) {
          transacao(db, () => {
            for (const feita of feitas) confirmarNoDisco(db, feita.id, feita.sha, { maquina: carimbo.maquina, agora: agoraIso() })
          })
        }
      }, env)
    } catch (erro) {
      registrarDegradacao(casa, 'documentos.banco', erro, env)
      return { resultado: 'degradada', contagens }
    }
    return { resultado: 'concluida', contagens }
  } finally {
    await trava.release()
  }
}
