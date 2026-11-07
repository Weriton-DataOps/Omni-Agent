// Ponte de presença do cofre (decisões 2, 3 e 19): o Windows Hello real só pela disponibilidade, que não abre
// diálogo, e a de mentira para o protocolo (a mensagem fora do argumento e do script, cada desfecho, a resposta
// torta que vira falhou e a mensagem inválida, que nem chega ao PowerShell).
import assert from 'node:assert/strict'
import test from 'node:test'

import { powershellPadrao } from '../runtime/casa/dpapi.mjs'
import { criarPontePresenca } from '../runtime/casa/presenca.mjs'

// OMNI_SO_FALSOS=1 pula o teste que abre o PowerShell de verdade: a rodada de mutantes repete a suíte em
// sequência, e só os testes com o executor falso entram nela. O real roda uma vez, no verde.
const NO_WINDOWS = { skip: process.platform !== 'win32' ? 'o Windows Hello só existe no Windows' : process.env.OMNI_SO_FALSOS === '1' ? 'OMNI_SO_FALSOS=1: só os testes falsos' : false }
function executorFalso(resposta, chamadas = []) {
  return (comando, args, opcoes) => { chamadas.push({ comando, args, opcoes }); return { status: 0, stdout: '', stderr: '', ...resposta } }
}
const decodificarScript = (args) => Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le')
const desfecho = (motivo) => ({ ok: motivo === 'ok', motivo })
const INDISPONIVEIS = ['DeviceNotPresent', 'NotConfiguredForUser', 'DisabledByPolicy', 'DeviceBusy']
function perguntar(metodo, resposta) {
  const ponte = criarPontePresenca({ executar: executorFalso(resposta) })
  return metodo === 'disponivel' ? ponte.disponivel() : ponte.verificar('Confirme que é você')
}

test('Hello real: a disponibilidade responde ok ou indisponivel, sem abrir diálogo', NO_WINDOWS, () => {
  const resposta = criarPontePresenca().disponivel()
  assert.ok(['ok', 'indisponivel'].includes(resposta.motivo), `motivo inesperado: ${resposta.motivo}`)
  assert.deepEqual(resposta, desfecho(resposta.motivo))
})

test('a mensagem do Hello vai só no stdin, em base64 de UTF-8; o script vai por -EncodedCommand, sem nada depois', () => {
  const mensagem = 'Mostrar o segredo de exemplo — ação do dono'
  const b64 = Buffer.from(mensagem, 'utf8').toString('base64')
  const chamadas = []
  const ponte = criarPontePresenca({ executar: executorFalso({ stdout: 'resultado Verified\r\n' }, chamadas), powershell: 'ps-falso.exe', limiteMs: 1234 })
  assert.deepEqual(ponte.verificar(mensagem), { ok: true, motivo: 'ok' })
  assert.equal(chamadas.length, 1)
  const { comando, args, opcoes } = chamadas[0]
  assert.equal(comando, 'ps-falso.exe')
  assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand'])
  assert.equal(args.length, 4)
  assert.ok(args.every((a) => !a.includes(mensagem) && !a.includes(b64)), 'nenhum argumento leva a mensagem')
  const script = decodificarScript(args)
  assert.ok(!script.includes(mensagem), 'a mensagem não vai no script')
  assert.ok(!script.includes(b64), 'a mensagem em base64 não vai no script')
  assert.equal(opcoes.input, `verificar\n${b64}\n`)
  assert.equal(opcoes.windowsHide, true)
  assert.equal(opcoes.timeout, 1234)
})

test('disponivel() só pergunta a disponibilidade, pelo PowerShell do sistema e com o limite padrão; cada ramo do script chama só o seu método', () => {
  const chamadas = []
  const ponte = criarPontePresenca({ executar: executorFalso({ stdout: 'disponibilidade Available\n' }, chamadas) })
  assert.deepEqual(ponte.disponivel(), { ok: true, motivo: 'ok' })
  assert.equal(chamadas.length, 1)
  const { comando, args, opcoes } = chamadas[0]
  assert.equal(comando, powershellPadrao())
  assert.equal(opcoes.input, 'disponivel\n')
  assert.equal(opcoes.timeout, 75_000)
  assert.equal(opcoes.windowsHide, true)
  const ramos = /if \(\$operacao -eq 'disponivel'\) \{([\s\S]*?)\} else \{([\s\S]*?)\n\}/.exec(decodificarScript(args))
  assert.ok(ramos, 'o script tem os dois ramos')
  const [, disponivel, verificar] = ramos
  assert.ok(disponivel.includes('CheckAvailabilityAsync()'), 'o ramo da disponibilidade pergunta a disponibilidade')
  assert.ok(!disponivel.includes('RequestVerificationAsync'), 'o ramo da disponibilidade não abre o diálogo')
  assert.ok(disponivel.includes("$prefixo = 'disponibilidade'; $limite = 10000"), 'a disponibilidade responde com o prefixo dela e espera 10 s')
  assert.ok(verificar.includes('[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($linhas[1]))'), 'a mensagem sai da segunda linha do stdin, em UTF-8')
  assert.ok(verificar.includes('RequestVerificationAsync($mensagem)'), 'o ramo da verificação abre o diálogo com a mensagem')
  assert.ok(verificar.includes("$prefixo = 'resultado'; $limite = 60000"), 'a verificação responde com o prefixo dela e espera 60 s')
})

test('cada desfecho do Hello vira { ok, motivo }, nos dois métodos', () => {
  const casos = [
    ['disponivel', 'disponibilidade Available', 'ok'],
    ...INDISPONIVEIS.map((nome) => ['disponivel', `disponibilidade ${nome}`, 'indisponivel']),
    ['disponivel', 'tempo', 'tempo'],
    ['verificar', 'resultado Verified', 'ok'],
    ['verificar', 'resultado Canceled', 'cancelado'],
    ['verificar', 'resultado RetriesExhausted', 'falhou'],
    ...INDISPONIVEIS.map((nome) => ['verificar', `resultado ${nome}`, 'indisponivel']),
    ['verificar', 'tempo', 'tempo']
  ]
  for (const [metodo, linha, motivo] of casos) {
    assert.deepEqual(perguntar(metodo, { stdout: `${linha}\r\n` }), desfecho(motivo), `${metodo} com "${linha}"`)
  }
})

test('resposta torta, filho que falhou e erro de spawn viram falhou ou tempo, nunca exceção', () => {
  const tortas = [
    ['verificar', { stdout: '' }],
    ['verificar', { stdout: 'resultado Verified\nresultado Verified\n' }],
    ['verificar', { stdout: 'disponibilidade Available\n' }],
    ['verificar', { stdout: 'disponibilidade DeviceBusy\n' }],
    ['verificar', { stdout: 'resultado Available\n' }],
    ['disponivel', { stdout: 'resultado Verified\n' }],
    ['disponivel', { stdout: 'resultado DeviceNotPresent\n' }],
    ['disponivel', { stdout: 'disponibilidade Verified\n' }],
    ['verificar', { stdout: 'resultado constructor\n' }],
    ['verificar', { stdout: 'resultado __proto__\n' }],
    ['verificar', { stdout: 'resultado Verified extra\n' }],
    ['verificar', { stdout: 'resultado verified\n' }],
    ['verificar', { status: 1, stdout: 'resultado Verified\n', stderr: 'detalhe do filho' }],
    ['verificar', { status: null, error: Object.assign(new Error('spawn falhou'), { code: 'ENOENT' }) }]
  ]
  for (const [metodo, resposta] of tortas) {
    assert.deepEqual(perguntar(metodo, resposta), desfecho('falhou'), `${metodo} com ${JSON.stringify(resposta)}`)
  }
  const estouro = { status: null, stdout: 'resultado Verified\n', error: Object.assign(new Error('spawnSync ETIMEDOUT'), { code: 'ETIMEDOUT' }) }
  assert.deepEqual(perguntar('verificar', estouro), desfecho('tempo'))
  assert.deepEqual(perguntar('disponivel', estouro), desfecho('tempo'))
})

test('mensagem do Hello vazia ou que não é texto não chega ao PowerShell', () => {
  const chamadas = []
  const ponte = criarPontePresenca({ executar: executorFalso({ stdout: 'resultado Verified\n' }, chamadas) })
  for (const mensagem of ['', '   ', undefined, null, 42, Buffer.from('texto')]) {
    assert.throws(() => ponte.verificar(mensagem), { name: 'TypeError', message: 'a mensagem do Hello precisa ser um texto não vazio' })
  }
  assert.equal(chamadas.length, 0)
})
