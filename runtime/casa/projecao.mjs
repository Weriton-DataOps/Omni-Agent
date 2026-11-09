// Projeção em arquivo com reconciliação por hash (§3.2 do desenho).
//
// O banco é a fonte; o arquivo no disco é uma cópia gerada para quem ainda lê de lá (versões
// antigas do plugin no cache, scripts, o harness do Claude Code). O banco sabe o hash da sua
// versão corrente e guarda em _projecoes o hash de toda versão que já escreveu ou ingeriu.
// Comparando o arquivo com isso, sai a situação:
//   vazio        o banco nunca recebeu este dado e não há arquivo: começa do zero;
//   atual        o arquivo é exatamente a versão corrente do banco: nada a fazer;
//   sem-arquivo  o arquivo sumiu: o banco vence e reescreve a projeção;
//   defasada     o arquivo é uma versão antiga que o banco já absorveu (a escrita da projeção
//                falhou depois do commit, ou alguém pôs de volta uma cópia velha): o banco vence;
//   externa      hash nunca visto (versão antiga do Omni, mão humana, banco fora do ar na hora da
//                escrita, primeira importação): o arquivo é ingerido no banco.
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { agoraIso, esperar } from './banco.mjs'

export function lerSeExistir(caminho, codificacao = 'utf8') {
  try {
    return readFileSync(caminho, codificacao)
  } catch (erro) {
    if (erro?.code === 'ENOENT') return null
    throw erro
  }
}

export function situacaoDaProjecao(db, arquivo, shaNoDisco, shaNoBanco) {
  if (shaNoBanco === null) return shaNoDisco === null ? 'vazio' : 'externa'
  if (shaNoDisco === null) return 'sem-arquivo'
  if (shaNoDisco === shaNoBanco) return 'atual'
  const conhecida = db.prepare('SELECT 1 AS sim FROM _projecoes WHERE arquivo = ? AND sha256 = ?').get(arquivo, shaNoDisco)
  return conhecida ? 'defasada' : 'externa'
}

// Histórico completo de propósito: podar abriria a porta para uma cópia muito velha voltar
// como "externa" e ser ingerida por cima do banco.
export function registrarProjecao(db, arquivo, sha, papel) {
  db.prepare(`INSERT INTO _projecoes (arquivo, sha256, papel, em) VALUES (?, ?, ?, ?)
    ON CONFLICT (arquivo, sha256) DO NOTHING`).run(arquivo, sha, papel, agoraIso())
}

const CONTENCAO = new Set(['EPERM', 'EBUSY', 'EACCES'])

// Escrita atômica: temporário no mesmo diretório e rename. No Windows, o rename pode bater em
// antivírus ou leitor segurando o arquivo; tenta de novo por pouco tempo, como o LocalJsonStore.
export function escreverAtomico(caminho, conteudo) {
  mkdirSync(dirname(caminho), { recursive: true })
  const temporario = join(dirname(caminho), `.${basename(caminho)}.${process.pid}.${randomUUID()}.tmp`)
  writeFileSync(temporario, conteudo, { flag: 'wx', mode: 0o600 })
  try {
    const limite = Date.now() + 2_000
    for (;;) {
      try {
        renameSync(temporario, caminho)
        return
      } catch (erro) {
        if (!CONTENCAO.has(erro?.code) || Date.now() >= limite) throw erro
        esperar(15)
      }
    }
  } finally {
    rmSync(temporario, { force: true })
  }
}
