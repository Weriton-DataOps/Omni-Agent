// Memória do Omni com a casa em SQLite (F1): o banco é a fonte e memory.json é projeção
// reconciliada por hash. Estes testes cobrem a costura em runtime/memoria.mjs. O comportamento
// de sempre (inicializar, migrar, recusar versão futura e segredo, escrita concorrente) continua
// em memoria.test.mjs, que roda sem mudança nenhuma.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { arquivoDoBanco, comBancoDaCasa, pastaDoBanco, sha256 } from '../runtime/casa/banco.mjs'
import { contarMemoriaNoBanco, lerMemoriaDoBanco, salvarMemoria, shaDaMemoriaNoBanco } from '../runtime/casa/loja-memoria.mjs'
import { lerSeExistir } from '../runtime/casa/projecao.mjs'
import { caminhoDaMemoria, lembrarExplicitamente, lerMemoria, prepararMemoria } from '../runtime/memoria.mjs'

const URL_DA_MEMORIA = new URL('../runtime/memoria.mjs', import.meta.url).href

async function casaNova() {
  return mkdtemp(join(tmpdir(), 'omni-memoria-casa-'))
}

// Faxina de melhor esforço: erro aqui mascararia a asserção que falhou.
async function apagar(casa) {
  try {
    await rm(casa, { recursive: true, force: true })
  } catch {
    // Sobra pasta temporária; o teste que importa já disse o motivo.
  }
}

// Fatos gravados e a manutenção automática já feita: daqui em diante, ler não regrava sozinho.
async function semear(casa, ...fatos) {
  for (const fato of fatos) await lembrarExplicitamente(casa, fato)
  await lerMemoria(casa)
}

const noBanco = (casa, uso) => comBancoDaCasa(casa, 'omni', uso)
const shaNoBanco = (casa) => noBanco(casa, shaDaMemoriaNoBanco)
const confirmadasNoBanco = (casa) => noBanco(casa, (db) => contarMemoriaNoBanco(db).confirmed)
const lerArquivo = (casa) => readFile(caminhoDaMemoria(casa), 'utf8')
const textos = (memoria) => memoria.confirmed.map((item) => item.text)
const invalidasGuardadas = async (casa) =>
  (await readdir(dirname(caminhoDaMemoria(casa)))).filter((nome) => nome.startsWith('memory.json.invalida.'))

function projecoes(casa) {
  return noBanco(casa, (db) => new Map(db.prepare('SELECT sha256, papel FROM _projecoes').all().map((linha) => [linha.sha256, linha.papel])))
}

function importacoes(casa) {
  return noBanco(casa, (db) => db.prepare('SELECT tipo, fonte, fonte_sha256, contagens FROM _importacoes ORDER BY id').all()
    .map((linha) => ({ ...linha, contagens: JSON.parse(linha.contagens) })))
}

// Onde o contrato é "não falha", a rejeição vira asserção, não tropeço: o erro que vaza aparece
// como violação do contrato, com a mensagem dele, e não como teste quebrado no meio do caminho.
async function semRejeitar(promessa) {
  let valor
  await assert.doesNotReject(async () => { valor = await promessa })
  return valor
}

function degradacoes(casa) {
  const texto = lerSeExistir(join(pastaDoBanco(casa), 'degradacoes.jsonl'))
  return texto === null ? [] : texto.trim().split('\n').map((linha) => JSON.parse(linha))
}

function rodarFilho(codigo, env) {
  return new Promise((resolver, rejeitar) => {
    const filho = spawn(process.execPath, ['--input-type=module', '-e', codigo], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    let erro = ''
    filho.stderr.on('data', (pedaco) => { erro += pedaco })
    filho.on('error', rejeitar)
    filho.on('close', (codigoDeSaida) => resolver({ codigo: codigoDeSaida, erro }))
  })
}

// Os filhos esperam até o mesmo instante: a largada sai junta de verdade.
const LARGADA = `const espera = Number(process.env.OMNI_TESTE_LARGADA) - Date.now()
if (espera > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, espera)`

test('gravar leva a memoria ao banco e o arquivo vira projecao exata da versao do banco', async () => {
  const casa = await casaNova()
  try {
    await lembrarExplicitamente(casa, 'prefiro mapas antes de textos longos', 'preference')
    const texto = await lerArquivo(casa)
    const [sha, doBanco] = noBanco(casa, (db) => [shaDaMemoriaNoBanco(db), lerMemoriaDoBanco(db)])
    assert.equal(sha, sha256(texto))
    assert.equal(`${JSON.stringify(doBanco, null, 2)}\n`, texto)
    assert.equal(confirmadasNoBanco(casa), 1)
    assert.equal(projecoes(casa).get(sha), 'escrita')
    assert.deepEqual(importacoes(casa), [])
    assert.deepEqual(degradacoes(casa), [])
  } finally {
    await apagar(casa)
  }
})

test('memoria em dia carrega sem reescrever o arquivo', async () => {
  const casa = await casaNova()
  try {
    await semear(casa, 'fato A')
    const antes = await stat(caminhoDaMemoria(casa))
    await new Promise((pronto) => setTimeout(pronto, 25))
    assert.equal((await prepararMemoria(casa)).result, 'ready')
    assert.equal((await stat(caminhoDaMemoria(casa))).mtimeMs, antes.mtimeMs)
  } finally {
    await apagar(casa)
  }
})

test('escrita de versao antiga do plugin direto no arquivo e ingerida e sobrevive a gravacao seguinte', async () => {
  const casa = await casaNova()
  try {
    await semear(casa, 'fato A')
    const antiga = JSON.parse(await lerArquivo(casa))
    antiga.confirmed.push({ ...structuredClone(antiga.confirmed[0]), id: 'mem-escrito-pela-versao-antiga', text: 'fato B do plugin antigo' })
    const textoAntigo = `${JSON.stringify(antiga, null, 2)}\n`
    await writeFile(caminhoDaMemoria(casa), textoAntigo, 'utf8')

    assert.deepEqual(textos(await lerMemoria(casa)), ['fato A', 'fato B do plugin antigo'])
    assert.equal(await lerArquivo(casa), textoAntigo, 'texto já canônico não é reescrito')
    assert.equal(shaNoBanco(casa), sha256(textoAntigo))
    assert.equal(projecoes(casa).get(sha256(textoAntigo)), 'ingerida')
    const [importacao, ...outras] = importacoes(casa)
    assert.deepEqual(outras, [])
    assert.equal(importacao.tipo, 'memoria')
    assert.equal(importacao.fonte, 'memory/memory.json')
    assert.equal(importacao.fonte_sha256, sha256(textoAntigo))
    assert.equal(importacao.contagens.confirmed, 2)
    assert.equal(importacao.contagens.inseridas, 1)

    await lembrarExplicitamente(casa, 'fato C')
    assert.deepEqual(textos(await lerMemoria(casa)), ['fato A', 'fato B do plugin antigo', 'fato C'])
    assert.equal(confirmadasNoBanco(casa), 3)
  } finally {
    await apagar(casa)
  }
})

test('arquivo editado fora do formato canonico e ingerido e reescrito; a copia velha que volta nao reentra', async () => {
  const casa = await casaNova()
  try {
    await semear(casa, 'fato A')
    const editada = JSON.parse(await lerArquivo(casa))
    editada.confirmed[0].text = 'fato A corrigido a mao'
    const compacta = JSON.stringify(editada)
    await writeFile(caminhoDaMemoria(casa), compacta, 'utf8')

    assert.deepEqual(textos(await lerMemoria(casa)), ['fato A corrigido a mao'])
    const canonica = await lerArquivo(casa)
    assert.equal(canonica, `${JSON.stringify(editada, null, 2)}\n`)
    assert.equal(shaNoBanco(casa), sha256(canonica))
    assert.equal(projecoes(casa).get(sha256(compacta)), 'ingerida')
    assert.equal(projecoes(casa).get(sha256(canonica)), 'escrita')

    await lembrarExplicitamente(casa, 'fato B')
    await writeFile(caminhoDaMemoria(casa), compacta, 'utf8')
    assert.deepEqual(textos(await semRejeitar(lerMemoria(casa))), ['fato A corrigido a mao', 'fato B'])
    assert.equal(sha256(await lerArquivo(casa)), shaNoBanco(casa))
    assert.equal(importacoes(casa).length, 1)
  } finally {
    await apagar(casa)
  }
})

test('projecao velha que o proprio banco escreveu volta e o banco vence', async () => {
  const casa = await casaNova()
  try {
    await semear(casa, 'fato A')
    const velha = await lerArquivo(casa)
    await lembrarExplicitamente(casa, 'fato B')
    const atual = await lerArquivo(casa)
    await writeFile(caminhoDaMemoria(casa), velha, 'utf8')

    assert.deepEqual(textos(await semRejeitar(lerMemoria(casa))), ['fato A', 'fato B'])
    assert.equal(await lerArquivo(casa), atual)
    assert.deepEqual(importacoes(casa), [])
  } finally {
    await apagar(casa)
  }
})

test('arquivo apagado volta do banco byte a byte', async () => {
  const casa = await casaNova()
  try {
    await semear(casa, 'fato A', 'fato B')
    const texto = await lerArquivo(casa)
    await rm(caminhoDaMemoria(casa))

    const lida = await semRejeitar(prepararMemoria(casa))
    assert.equal(lida.result, 'ready')
    assert.deepEqual(textos(lida.memory), ['fato A', 'fato B'])
    assert.equal(await lerArquivo(casa), texto)
  } finally {
    await apagar(casa)
  }
})

for (const [caso, invalido] of [
  ['JSON quebrado', '{ "confirmed": [ quebrado'],
  ['fora do contrato', '{"schemaVersion":4,"confirmed":"nao e lista"}\n']
]) {
  test(`arquivo invalido (${caso}) com banco populado: o banco vence e o invalido fica guardado ao lado`, async () => {
    const casa = await casaNova()
    try {
      await semear(casa, 'fato A')
      const bom = await lerArquivo(casa)
      await writeFile(caminhoDaMemoria(casa), invalido, 'utf8')

      assert.deepEqual(textos(await lerMemoria(casa)), ['fato A'])
      assert.equal(await lerArquivo(casa), bom)
      const guardadas = await invalidasGuardadas(casa)
      assert.equal(guardadas.length, 1)
      assert.equal(await readFile(join(dirname(caminhoDaMemoria(casa)), guardadas[0]), 'utf8'), invalido)
      assert.deepEqual(degradacoes(casa).map((linha) => linha.operacao), ['memoria.arquivo-invalido'])
      assert.doesNotMatch(JSON.stringify(degradacoes(casa)), /quebrado|nao e lista/)
    } finally {
      await apagar(casa)
    }
  })
}

test('arquivo invalido sem memoria no banco continua sendo erro e nada e tocado', async () => {
  const casa = await casaNova()
  const arquivo = caminhoDaMemoria(casa)
  try {
    await mkdir(dirname(arquivo), { recursive: true })
    await writeFile(arquivo, '{ quebrado', 'utf8')
    await assert.rejects(prepararMemoria(casa), SyntaxError)
    assert.equal(await readFile(arquivo, 'utf8'), '{ quebrado')
    assert.deepEqual(await invalidasGuardadas(casa), [])
    assert.equal(shaNoBanco(casa), null)
  } finally {
    await apagar(casa)
  }
})

test('versao futura no arquivo com banco populado e recusada sem tocar arquivo nem banco', async () => {
  const casa = await casaNova()
  try {
    await semear(casa, 'fato A')
    const sha = shaNoBanco(casa)
    assert.notEqual(sha, null)
    const futura = '{"schemaVersion":99,"sentinel":"preservar"}\n'
    await writeFile(caminhoDaMemoria(casa), futura, 'utf8')

    await assert.rejects(prepararMemoria(casa), /mais nova que este plugin/)
    assert.equal(await lerArquivo(casa), futura)
    assert.equal(shaNoBanco(casa), sha)
    assert.deepEqual(await invalidasGuardadas(casa), [])
  } finally {
    await apagar(casa)
  }
})

test('com OMNI_CASA_SEM_SQLITE=1 a memoria volta ao arquivo puro e o banco ingere quando volta', async () => {
  const casa = await casaNova()
  const anterior = process.env.OMNI_CASA_SEM_SQLITE
  try {
    process.env.OMNI_CASA_SEM_SQLITE = '1'
    try {
      assert.equal((await prepararMemoria(casa)).result, 'initialized')
      await lembrarExplicitamente(casa, 'fato gravado sem banco')
      await assert.rejects(stat(pastaDoBanco(casa)), { code: 'ENOENT' })
    } finally {
      if (anterior === undefined) delete process.env.OMNI_CASA_SEM_SQLITE
      else process.env.OMNI_CASA_SEM_SQLITE = anterior
    }
    assert.deepEqual(textos(await lerMemoria(casa)), ['fato gravado sem banco'])
    assert.equal(confirmadasNoBanco(casa), 1)
    assert.equal(importacoes(casa).length, 1)
  } finally {
    await apagar(casa)
  }
})

test('banco quebrado nao derruba a memoria: grava no arquivo, anota a degradacao e o banco consertado ingere', async () => {
  const casa = await casaNova()
  try {
    await semear(casa, 'fato A')
    const banco = arquivoDoBanco(casa, 'omni')
    await copyFile(banco, `${banco}.bom`)
    await writeFile(banco, 'isto nao e um banco sqlite. '.repeat(100), 'utf8')

    assert.equal((await semRejeitar(lembrarExplicitamente(casa, 'fato B com banco quebrado'))).result, 'confirmed')
    assert.deepEqual(textos(JSON.parse(await lerArquivo(casa))), ['fato A', 'fato B com banco quebrado'])
    assert.deepEqual(degradacoes(casa).map((linha) => linha.operacao), ['memoria.carregar', 'memoria.gravar'])

    await copyFile(`${banco}.bom`, banco)
    assert.deepEqual(textos(await lerMemoria(casa)), ['fato A', 'fato B com banco quebrado'])
    assert.equal(confirmadasNoBanco(casa), 2)
    assert.equal(importacoes(casa).length, 1)
  } finally {
    await apagar(casa)
  }
})

test('memoria v1 migra com banco: um backup so, banco com a versao migrada e importacao registrada', async () => {
  const casa = await casaNova()
  const arquivo = caminhoDaMemoria(casa)
  const instante = '2026-08-25T12:00:00.000Z'
  const v1 = `${JSON.stringify({
    schemaVersion: 1,
    confirmed: [{
      id: 'mem-v1-casa',
      type: 'preference',
      scope: { type: 'user' },
      text: 'prefiro mapas antes de textos longos',
      source: 'legacy-test',
      status: 'confirmed',
      confidence: 1,
      evidence: [{ kind: 'explicit-request', recordedAt: instante }],
      createdAt: instante,
      updatedAt: instante,
      lastValidatedAt: instante,
      usageCount: 0,
      expiresAt: null
    }],
    candidates: []
  }, null, 2)}\n`
  const backups = async () => (await readdir(dirname(arquivo))).filter((nome) => nome.endsWith('.backup'))
  try {
    await mkdir(dirname(arquivo), { recursive: true })
    await writeFile(arquivo, v1, 'utf8')

    assert.equal((await prepararMemoria(casa)).result, 'migrated')
    assert.equal((await backups()).length, 1)
    const [importacao] = importacoes(casa)
    assert.equal(importacao.fonte_sha256, sha256(v1))
    assert.equal(importacao.contagens.confirmed, 1)
    assert.equal(projecoes(casa).get(sha256(v1)), 'ingerida')
    assert.equal(shaNoBanco(casa), sha256(await readFile(arquivo, 'utf8')))

    assert.equal((await prepararMemoria(casa)).result, 'ready')
    assert.equal((await backups()).length, 1)
  } finally {
    await apagar(casa)
  }
})

test('sessoes em processos separados gravando juntas nao perdem registro e o arquivo fecha com o banco', async () => {
  const casa = await casaNova()
  const codigo = [
    LARGADA,
    `const { lembrarExplicitamente } = await import(${JSON.stringify(URL_DA_MEMORIA)})`,
    'for (let n = 0; n < 3; n += 1) {',
    "  await lembrarExplicitamente(process.env.OMNI_TESTE_CASA, 'processo ' + process.pid + ' fato ' + n)",
    '}'
  ].join('\n')
  try {
    const env = { OMNI_TESTE_CASA: casa, OMNI_TESTE_LARGADA: String(Date.now() + 1_500) }
    const filhos = await Promise.all(Array.from({ length: 3 }, () => rodarFilho(codigo, env)))
    for (const filho of filhos) assert.equal(filho.codigo, 0, filho.erro)

    assert.equal((await lerMemoria(casa)).confirmed.length, 9)
    assert.equal(confirmadasNoBanco(casa), 9)
    assert.equal(sha256(await lerArquivo(casa)), shaNoBanco(casa))
  } finally {
    await apagar(casa)
  }
})

for (const [caso, preparar] of [
  ['projecao em dia', (arquivo, texto) => writeFile(arquivo, texto, 'utf8')],
  ['sem arquivo', async () => {}],
  ['arquivo quebrado', (arquivo) => writeFile(arquivo, '{ quebrado', 'utf8')]
]) {
  test(`memoria de plugin mais novo no banco (${caso}) e recusada sem reescrever projecao nem banco`, async () => {
    const casa = await casaNova()
    const arquivo = caminhoDaMemoria(casa)
    const instante = '2026-12-01T12:00:00.000Z'
    const doPluginNovo = {
      schemaVersion: 5,
      store: { id: 'omni-local-memory', createdAt: instante, updatedAt: instante, lastMigrationAt: null, lastMaintenanceAt: null },
      confirmed: [{ id: 'mem-v5', text: 'registro do plugin novo', formatoNovo: { campo: true } }],
      candidates: [],
      archive: []
    }
    try {
      const { texto, sha } = noBanco(casa, (db) => salvarMemoria(db, doPluginNovo))
      await mkdir(dirname(arquivo), { recursive: true })
      await preparar(arquivo, texto)
      const antes = lerSeExistir(arquivo)

      await assert.rejects(prepararMemoria(casa), /mais nova que este plugin/)
      assert.equal(lerSeExistir(arquivo), antes)
      assert.equal(shaNoBanco(casa), sha)
      assert.deepEqual(await invalidasGuardadas(casa), [])
    } finally {
      await apagar(casa)
    }
  })
}

test('ingestao que falha carrega do arquivo, anota a degradacao e tenta de novo na carga seguinte', async () => {
  const casa = await casaNova()
  try {
    await semear(casa, 'fato A')
    const shaAntes = shaNoBanco(casa)
    const externa = JSON.parse(await lerArquivo(casa))
    externa.confirmed.push({ ...structuredClone(externa.confirmed[0]), id: 'mem-externo', text: 'fato B escrito por fora' })
    await writeFile(caminhoDaMemoria(casa), `${JSON.stringify(externa, null, 2)}\n`, 'utf8')
    noBanco(casa, (db) => db.exec(`CREATE TRIGGER teste_recusa_importacao BEFORE INSERT ON _importacoes
      BEGIN SELECT RAISE(ABORT, 'importacao recusada pelo teste'); END`))

    assert.deepEqual(textos(await semRejeitar(lerMemoria(casa))), ['fato A', 'fato B escrito por fora'])
    assert.equal(shaNoBanco(casa), shaAntes, 'ingestão desfeita por inteiro')
    assert.equal(confirmadasNoBanco(casa), 1)
    assert.deepEqual(degradacoes(casa).map((linha) => linha.operacao), ['memoria.ingerir'])

    noBanco(casa, (db) => db.exec('DROP TRIGGER teste_recusa_importacao'))
    assert.deepEqual(textos(await lerMemoria(casa)), ['fato A', 'fato B escrito por fora'])
    assert.equal(confirmadasNoBanco(casa), 2)
    assert.equal(importacoes(casa).length, 1)
    assert.equal(shaNoBanco(casa), sha256(await lerArquivo(casa)))
  } finally {
    await apagar(casa)
  }
})

test('gravacao que falha no meio desfaz o banco inteiro e o arquivo leva a versao ate o banco voltar', async () => {
  const casa = await casaNova()
  try {
    await semear(casa, 'fato A')
    const shaAntes = shaNoBanco(casa)
    noBanco(casa, (db) => db.exec(`CREATE TRIGGER teste_recusa_projecao BEFORE INSERT ON _projecoes
      BEGIN SELECT RAISE(ABORT, 'projecao recusada pelo teste'); END`))

    assert.equal((await semRejeitar(lembrarExplicitamente(casa, 'fato B'))).result, 'confirmed')
    assert.equal(shaNoBanco(casa), shaAntes, 'gravação desfeita por inteiro')
    assert.equal(confirmadasNoBanco(casa), 1)
    assert.deepEqual(textos(JSON.parse(await lerArquivo(casa))), ['fato A', 'fato B'])
    assert.deepEqual(degradacoes(casa).map((linha) => linha.operacao), ['memoria.gravar'])

    noBanco(casa, (db) => db.exec('DROP TRIGGER teste_recusa_projecao'))
    assert.deepEqual(textos(await lerMemoria(casa)), ['fato A', 'fato B'])
    assert.equal(confirmadasNoBanco(casa), 2)
    assert.equal(shaNoBanco(casa), sha256(await lerArquivo(casa)))
  } finally {
    await apagar(casa)
  }
})

// No Windows, arquivo somente leitura não aceita rename por cima: a projeção falha de verdade.
const SO_NO_WINDOWS = process.platform !== 'win32' && 'rename sobre arquivo somente leitura só falha no Windows'

test('projecao que nao sai nao perde a gravacao: o banco guarda e a carga seguinte reescreve o arquivo', { skip: SO_NO_WINDOWS }, async () => {
  const casa = await casaNova()
  const arquivo = caminhoDaMemoria(casa)
  try {
    await semear(casa, 'fato A')
    await chmod(arquivo, 0o444)
    assert.equal((await semRejeitar(lembrarExplicitamente(casa, 'fato B com arquivo travado'))).result, 'confirmed')
    assert.deepEqual(textos(JSON.parse(await lerArquivo(casa))), ['fato A'])
    assert.equal(confirmadasNoBanco(casa), 2)
    assert.deepEqual(degradacoes(casa).map((linha) => linha.operacao), ['memoria.projetar'])

    await chmod(arquivo, 0o666)
    assert.deepEqual(textos(await semRejeitar(lerMemoria(casa))), ['fato A', 'fato B com arquivo travado'])
    assert.equal(sha256(await lerArquivo(casa)), shaNoBanco(casa))
  } finally {
    await chmod(arquivo, 0o666).catch(() => {})
    await apagar(casa)
  }
})

test('sem banco e sem projecao a gravacao falha para quem chamou', { skip: SO_NO_WINDOWS }, async () => {
  const casa = await casaNova()
  const arquivo = caminhoDaMemoria(casa)
  try {
    await semear(casa, 'fato A')
    await writeFile(arquivoDoBanco(casa, 'omni'), 'isto nao e um banco sqlite. '.repeat(100), 'utf8')
    await chmod(arquivo, 0o444)
    await assert.rejects(lembrarExplicitamente(casa, 'fato B sem onde guardar'), (erro) => ['EPERM', 'EACCES'].includes(erro?.code))
    assert.deepEqual(degradacoes(casa).map((linha) => linha.operacao), ['memoria.carregar', 'memoria.gravar'])
    assert.deepEqual(textos(JSON.parse(await lerArquivo(casa))), ['fato A'])
  } finally {
    await chmod(arquivo, 0o666).catch(() => {})
    await apagar(casa)
  }
})
