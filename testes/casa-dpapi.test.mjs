// Ponte DPAPI do cofre (§8.1): a real no Windows (ida e volta, lixo, inventário, a cópia que falha antes de tocar a
// área de transferência e a limpeza que o PowerShell 5.1 aceita) e a de mentira para o protocolo (o segredo fora do
// argumento, contagem de linhas, mensagens de erro, o script da área de transferência e a limpeza destacada).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import test from 'node:test'

import { criarPonteDpapi, powershellPadrao } from '../runtime/casa/dpapi.mjs'

// OMNI_SO_FALSOS=1 pula os testes que abrem o PowerShell de verdade: a rodada de mutantes repete a suíte em
// sequência, e só os testes com o executor falso entram nela. Os reais rodam uma vez, no verde.
const NO_WINDOWS = { skip: process.platform !== 'win32' ? 'a DPAPI só existe no Windows' : process.env.OMNI_SO_FALSOS === '1' ? 'OMNI_SO_FALSOS=1: só os testes falsos' : false }
function executorFalso(resposta, chamadas) {
  return (comando, args, opcoes) => { chamadas.push({ comando, args, opcoes }); return { status: 0, stdout: '', stderr: '', ...resposta } }
}
const decodificarScript = (args) => Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le')
const erroDaPonte = (message) => ({ name: 'PonteDpapiError', code: 'OMNI_COFRE_PONTE', message })
const LIMPEZA = /Start-Process -FilePath \(Join-Path \$PSHOME 'powershell\.exe'\) -ArgumentList '-NoProfile', '-NonInteractive', '-EncodedCommand', '([A-Za-z0-9+/=]+)' -WindowStyle Hidden/
function scriptDaArea() {
  const chamadas = []
  criarPonteDpapi({ executar: executorFalso({ stdout: 'ok 1\n' }, chamadas) }).abrirParaAreaDeTransferencia(Buffer.from('blob'))
  return decodificarScript(chamadas[0].args)
}

test('DPAPI real: sela e abre de volta, com acento, ideograma e valor grande', NO_WINDOWS, () => {
  const ponte = criarPonteDpapi()
  const valores = ['abc', 'ção ü 日本 — teste', 'x'.repeat(5000)].map((v) => Buffer.from(v, 'utf8'))
  const blobs = ponte.selar(valores)
  assert.equal(blobs.length, 3)
  blobs.forEach((blob, i) => assert.ok(!blob.equals(valores[i]), `o blob ${i} não é o valor`))
  const abertos = ponte.abrir(blobs)
  assert.deepEqual(abertos.map((a) => a.ok), [true, true, true])
  abertos.forEach((a, i) => assert.ok(a.valor.equals(valores[i]), `o item ${i} volta igual`))
})

test('DPAPI real: lixo falha sozinho e não derruba o vizinho', NO_WINDOWS, () => {
  const ponte = criarPonteDpapi()
  const [blob] = ponte.selar([Buffer.from('vizinho bom')])
  const [lixo, bom] = ponte.abrir([Buffer.from([0, 0, 0]), blob])
  assert.deepEqual(lixo, { ok: false, erro: 'CryptographicException' })
  assert.equal(bom.ok, true)
  assert.equal(bom.valor.toString('utf8'), 'vizinho bom')
})

test('Gerenciador real: o inventário só traz alvos Omni/ e só metadados', NO_WINDOWS, () => {
  const itens = criarPonteDpapi().inventariarGerenciador()
  assert.ok(Array.isArray(itens))
  for (const item of itens) {
    assert.deepEqual(Object.keys(item).sort(), ['alvo', 'persistencia', 'tipo', 'usuario'])
    assert.ok(item.alvo.toLowerCase().startsWith('omni/'), 'todo alvo do inventário começa com Omni/')
  }
})

test('o segredo nunca vai no argumento nem no script: só no stdin', () => {
  const segredo = 'segredo-que-nao-pode-vazar'
  const b64 = Buffer.from(segredo, 'utf8').toString('base64')
  const chamadas = []
  const ponte = criarPonteDpapi({ executar: executorFalso({ stdout: 'ok QUJD\r\n' }, chamadas), powershell: 'ps-falso.exe' })
  const [blob] = ponte.selar([Buffer.from(segredo, 'utf8')])
  assert.equal(blob.toString('utf8'), 'ABC')
  assert.equal(chamadas.length, 1)
  const { comando, args, opcoes } = chamadas[0]
  assert.equal(comando, 'ps-falso.exe')
  assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand'])
  assert.equal(args.length, 4)
  assert.ok(args.every((a) => !a.includes(segredo) && !a.includes(b64)), 'nenhum argumento leva o valor')
  const script = decodificarScript(args)
  assert.ok(!script.includes(segredo), 'o valor não vai no script')
  assert.ok(!script.includes(b64), 'o valor em base64 não vai no script')
  assert.equal(opcoes.input, `selar\n${b64}\n`)
  assert.equal(opcoes.windowsHide, true)
})

test('listas vazias não chamam o PowerShell; o caminho padrão sai do SystemRoot', () => {
  const chamadas = []
  const ponte = criarPonteDpapi({ executar: executorFalso({}, chamadas) })
  assert.deepEqual(ponte.abrir([]), [])
  assert.deepEqual(ponte.selar([]), [])
  assert.equal(chamadas.length, 0)
  assert.equal(powershellPadrao({ SystemRoot: 'D:\\Win' }), join('D:\\Win', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
  assert.ok(powershellPadrao({}).startsWith('C:\\Windows'))
})

test('a ponte recusa resposta fora do protocolo, contagem errada e filho que falhou', () => {
  const um = [Buffer.from('a')]
  const com = (resposta) => criarPonteDpapi({ executar: executorFalso(resposta, []) })
  assert.throws(() => com({ stdout: 'talvez\n' }).abrir(um), erroDaPonte('a ponte DPAPI respondeu fora do protocolo'))
  assert.throws(() => com({ stdout: 'ok QQ==\nok QQ==\n' }).abrir(um), erroDaPonte('a ponte DPAPI devolveu 2 linha(s) para 1 item(ns)'))
  assert.throws(() => com({ status: 1, stderr: 'detalhe do filho' }).abrir(um), erroDaPonte('a ponte DPAPI saiu com 1'))
  assert.throws(() => com({ error: Object.assign(new Error('spawn falhou'), { code: 'ENOENT' }), status: null }).abrir(um), erroDaPonte('a ponte DPAPI não rodou: ENOENT'))
})

test('valor vazio não se sela, falha da DPAPI no selar vira erro e só bytes entram', () => {
  const chamadas = []
  const ponte = criarPonteDpapi({ executar: executorFalso({}, chamadas) })
  assert.throws(() => ponte.selar([Buffer.from('a'), Buffer.alloc(0)]), erroDaPonte('valor vazio não se sela'))
  assert.equal(chamadas.length, 0)
  const falha = criarPonteDpapi({ executar: executorFalso({ stdout: 'falha CryptographicException\n' }, []) })
  assert.throws(() => falha.selar([Buffer.from('a')]), erroDaPonte('a DPAPI não selou: CryptographicException'))
  assert.throws(() => ponte.abrir(['texto não é bytes']), erroDaPonte('a ponte DPAPI só aceita bytes'))
})

test('inventário: decodifica alvo e usuário, pula alvo vazio e recusa linha torta', () => {
  const b = (texto) => Buffer.from(texto, 'utf8').toString('base64')
  const chamadas = []
  const stdout = `cred ${b('Omni/um')} ${b('usuario-um')} 1 2\r\ncred ${b('Omni/dois')} - 1 3\r\ncred - - 1 2\r\n`
  const itens = criarPonteDpapi({ executar: executorFalso({ stdout }, chamadas) }).inventariarGerenciador()
  assert.deepEqual(itens, [
    { alvo: 'Omni/um', usuario: 'usuario-um', tipo: 1, persistencia: 2 },
    { alvo: 'Omni/dois', usuario: null, tipo: 1, persistencia: 3 }
  ])
  assert.equal(chamadas[0].opcoes.input, '')
  assert.ok(decodificarScript(chamadas[0].args).includes('CredEnumerateW("Omni/*", 0'))
  const torta = criarPonteDpapi({ executar: executorFalso({ stdout: 'cred um dois\n' }, []) })
  assert.throws(() => torta.inventariarGerenciador(), { name: 'PonteDpapiError', message: 'o inventário respondeu fora do protocolo' })
})

test('área de transferência real: o blob que a DPAPI não abre falha antes de tocar a área', NO_WINDOWS, () => {
  assert.deepEqual(criarPonteDpapi().abrirParaAreaDeTransferencia(Buffer.from([0, 0, 0])), { ok: false, erro: 'CryptographicException' })
})

test('a limpeza destacada é PowerShell que o 5.1 aceita', NO_WINDOWS, () => {
  const limpeza = LIMPEZA.exec(scriptDaArea())
  assert.ok(limpeza, 'o script solta a limpeza pelo Start-Process com -EncodedCommand')
  const conferir = String.raw`$codigo = [Console]::In.ReadToEnd().Trim()
$texto = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($codigo))
$fichas = $null; $erros = $null
$null = [System.Management.Automation.Language.Parser]::ParseInput($texto, [ref]$fichas, [ref]$erros)
[Console]::Out.Write('erros ' + $erros.Count + [char]10)
`
  const resultado = spawnSync(powershellPadrao(), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(conferir, 'utf16le').toString('base64')], {
    input: `${limpeza[1]}\n`, encoding: 'utf8', windowsHide: true, timeout: 30_000
  })
  assert.equal(resultado.status, 0)
  assert.equal(resultado.stdout.trim(), 'erros 0')
})

test('área de transferência: o blob vai só no stdin e o prazo da limpeza volta em ISO', () => {
  const blob = Buffer.from('blob-de-exemplo-que-nao-pode-vazar', 'utf8')
  const b64 = blob.toString('base64')
  const chamadas = []
  const ponte = criarPonteDpapi({ executar: executorFalso({ stdout: `ok ${Date.UTC(2026, 0, 2, 3, 4, 5)}\r\n` }, chamadas), powershell: 'ps-falso.exe' })
  assert.deepEqual(ponte.abrirParaAreaDeTransferencia(blob), { ok: true, limpaEm: '2026-01-02T03:04:05.000Z' })
  assert.equal(chamadas.length, 1)
  const { comando, args, opcoes } = chamadas[0]
  assert.equal(comando, 'ps-falso.exe')
  assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand'])
  assert.equal(args.length, 4)
  assert.ok(args.every((a) => !a.includes(b64) && !a.includes('blob-de-exemplo')), 'nenhum argumento leva o blob')
  const script = decodificarScript(args)
  assert.ok(!script.includes(b64) && !script.includes('blob-de-exemplo'), 'o blob não vai no script')
  assert.equal(opcoes.input, `${b64}\n`)
  assert.equal(opcoes.windowsHide, true)
})

test('o script da área: abre, copia com os três formatos de exclusão, lê o número, marca 30 s e solta a limpeza que só limpa o que é dela', () => {
  const script = scriptDaArea()
  for (const formato of ['ExcludeClipboardContentFromMonitorProcessing', 'CanIncludeInClipboardHistory', 'CanUploadToCloudClipboard']) {
    assert.ok(script.includes(`'${formato}'`), `o formato ${formato} vai junto`)
  }
  assert.ok(script.includes('$dados.SetData($formato, [System.IO.MemoryStream]::new([byte[]](0, 0, 0, 0)))'), 'cada formato leva o DWORD 0')
  const ordem = ['::Unprotect(', '$dados.SetText(', '::SetDataObject($dados, $true', '$numero = [OmniCofre.Area]::GetClipboardSequenceNumber()', 'AddSeconds(30)', '$env:OMNI_COFRE_AREA_NUMERO = [string]$numero', '$env:OMNI_COFRE_AREA_PRAZO = [string]$prazo', 'Start-Process', "[Console]::Out.Write('ok '"]
  const posicoes = ordem.map((trecho) => script.indexOf(trecho))
  ordem.forEach((trecho, i) => assert.ok(posicoes[i] >= 0, `o script tem ${trecho}`))
  assert.deepEqual([...posicoes].sort((a, b) => a - b), posicoes, 'abre, copia, lê o número, marca o prazo, solta a limpeza e só então responde')
  assert.ok(script.includes("$e = $_.Exception; if ($e.InnerException) { $e = $e.InnerException }\n  [Console]::Out.Write('falha ' + $e.GetType().Name + [char]10)"), 'a falha desembrulha o InnerException e devolve o tipo de dentro')
  const limpeza = LIMPEZA.exec(script)
  assert.ok(limpeza, 'o script solta a limpeza pelo Start-Process com -EncodedCommand')
  const texto = Buffer.from(limpeza[1], 'base64').toString('utf16le')
  for (const trecho of ['$numero = [uint32]$env:OMNI_COFRE_AREA_NUMERO', '[int64]$env:OMNI_COFRE_AREA_PRAZO', 'if ($espera -gt 0) { Start-Sleep -Milliseconds $espera }', 'OpenClipboard([IntPtr]::Zero)', 'GetClipboardSequenceNumber() -eq $numero) { $null = [OmniCofre.Area]::EmptyClipboard() }', 'finally { $null = [OmniCofre.Area]::CloseClipboard() }']) {
    assert.ok(texto.includes(trecho), `a limpeza tem ${trecho}`)
  }
})

test('área de transferência: falha da DPAPI, resposta torta, contagem errada, filho que falhou e entrada que não serve', () => {
  const blob = Buffer.from('blob')
  const com = (resposta, chamadas = []) => criarPonteDpapi({ executar: executorFalso(resposta, chamadas) })
  assert.deepEqual(com({ stdout: 'falha CryptographicException\n' }).abrirParaAreaDeTransferencia(blob), { ok: false, erro: 'CryptographicException' })
  assert.throws(() => com({ stdout: 'ok\n' }).abrirParaAreaDeTransferencia(blob), erroDaPonte('a ponte DPAPI respondeu fora do protocolo'))
  assert.throws(() => com({ stdout: 'ok 1000000000000000\n' }).abrirParaAreaDeTransferencia(blob), erroDaPonte('a ponte DPAPI respondeu fora do protocolo'))
  assert.throws(() => com({ stdout: 'ok 1\nok 1\n' }).abrirParaAreaDeTransferencia(blob), erroDaPonte('a ponte DPAPI devolveu 2 linha(s) para 1 item(ns)'))
  assert.throws(() => com({ stdout: '' }).abrirParaAreaDeTransferencia(blob), erroDaPonte('a ponte DPAPI devolveu 0 linha(s) para 1 item(ns)'))
  assert.throws(() => com({ status: 1, stderr: 'detalhe do filho' }).abrirParaAreaDeTransferencia(blob), erroDaPonte('a ponte DPAPI saiu com 1'))
  assert.throws(() => com({ error: Object.assign(new Error('spawn falhou'), { code: 'ENOENT' }), status: null }).abrirParaAreaDeTransferencia(blob), erroDaPonte('a ponte DPAPI não rodou: ENOENT'))
  const chamadas = []
  assert.throws(() => com({}, chamadas).abrirParaAreaDeTransferencia(Buffer.alloc(0)), erroDaPonte('blob vazio não se copia'))
  assert.throws(() => com({}, chamadas).abrirParaAreaDeTransferencia('texto não é bytes'), erroDaPonte('a ponte DPAPI só aceita bytes'))
  assert.equal(chamadas.length, 0)
})
