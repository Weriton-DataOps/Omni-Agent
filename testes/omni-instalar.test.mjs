// O executor do Windows (F2, plano 5b-2): scripts/omni-instalar.ps1 de verdade, com pasta base, casa e
// programas de fora trocados por temporários e falsos. Só roda no Windows.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, test } from 'node:test'

import { comBancoDaCasa } from '../runtime/casa/banco.mjs'
import { listarInstalados } from '../runtime/casa/loja-nucleo.mjs'
import { agenteFalso } from './fixtures/agente-falso.mjs'
import { criarOrigem } from './fixtures/origem-selada.mjs'

const RAIZ = resolve(import.meta.dirname, '..')
const SCRIPT = join(RAIZ, 'scripts', 'omni-instalar.ps1')
const VERSAO = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')).version
const MAJOR = process.versions.node.split('.')[0]
const windows = process.platform === 'win32'

// Tudo que mexe no Windows de verdade fica desligado por padrão; cada teste liga o que examina.
const BASICO = ['-SemIlha', '-SemWhatsApp', '-SemTarefas', '-SemPlugin', '-NaoAbrir', '-SemWinget']

// A tarefa de verdade desta máquina se chama "Omni - vigia do WhatsApp". Todo teste roda com um prefixo
// OmniTeste, para nenhum descuido (um -SemTarefas esquecido, um mutante) sobrescrever a real, e o after
// varre qualquer OmniTeste que tenha sobrado.
const PREFIXO_TESTE = 'OmniTeste'
function powershell(comando, env = {}) {
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', comando], { encoding: 'utf8', env: { ...process.env, ...env } })
}
const varrerTarefasDeTeste = () => powershell(`Get-ScheduledTask -TaskName '${PREFIXO_TESTE}*' -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false`)

let origem
before(async () => { if (windows) origem = await criarOrigem() })
after(() => { origem?.apagar(); if (windows) varrerTarefasDeTeste() })

function pastaTemp(t, prefixo) {
  const pasta = mkdtempSync(join(tmpdir(), prefixo))
  t.after(() => rmSync(pasta, { recursive: true, force: true }))
  return pasta
}

// Cofre falso com os parâmetros do servicos/whatsapp/omni/cofre.ps1: guarda em cofre\<nome>.txt ao lado
// dele, ler sai 2 quando não existe, e cada chamada anota a linha de comando inteira em chamadas.log
// (para provar que o segredo nunca vai por argumento).
const COFRE_FALSO = `param([string]$Acao, [string]$Nome)
[IO.File]::AppendAllText((Join-Path $PSScriptRoot 'chamadas.log'), [Environment]::CommandLine + [Environment]::NewLine)
$pasta = Join-Path $PSScriptRoot 'cofre'
$arquivo = Join-Path $pasta (($Nome -replace '/', '_') + '.txt')
switch ($Acao) {
  'gravar' { $s = [Console]::In.ReadToEnd().Trim(); if (-not $s) { exit 1 }; [IO.Directory]::CreateDirectory($pasta) | Out-Null; [IO.File]::WriteAllText($arquivo, $s); 'ok' }
  'ler' { if (-not (Test-Path -LiteralPath $arquivo)) { exit 2 }; [Console]::Out.Write([IO.File]::ReadAllText($arquivo)) }
  'apagar' { if (Test-Path -LiteralPath $arquivo) { Remove-Item -LiteralPath $arquivo; 'ok' } else { exit 2 } }
}
`
function cofreFalso(t) {
  const pasta = pastaTemp(t, 'omni-cofre-')
  writeFileSync(join(pasta, 'cofre.ps1'), COFRE_FALSO)
  const admin = join(pasta, 'cofre', 'omni_whatsapp_admin.txt')
  const log = join(pasta, 'chamadas.log')
  return { cofre: join(pasta, 'cofre.ps1'), admin, chamadas: () => (existsSync(log) ? readFileSync(log, 'utf8') : '') }
}

function instalar(t, argumentos, { base = pastaTemp(t, 'omni-base-'), casa = pastaTemp(t, 'omni-casa-'), env = {} } = {}) {
  // E o cinto do segredo: nenhum teste lê ou grava o Gerenciador de Credenciais de verdade.
  const cofrePadrao = env.OMNI_INSTALAR_COFRE ? {} : { OMNI_INSTALAR_COFRE: cofreFalso(t).cofre }
  const dadosPadrao = env.OMNI_INSTALAR_WHATSAPP_DADOS ? {} : { OMNI_INSTALAR_WHATSAPP_DADOS: pastaTemp(t, 'omni-wa-') }
  // Mesmo cinto para os atalhos: sem pasta dada, nunca a Área de Trabalho nem o Inicializar de verdade.
  const cintos = [
    ...(argumentos.includes('-PrefixoTarefa') ? [] : ['-PrefixoTarefa', `${PREFIXO_TESTE}Nunca`]),
    ...(argumentos.includes('-PastaAtalhos') ? [] : ['-PastaAtalhos', pastaTemp(t, 'omni-atalhos-')]),
    ...(argumentos.includes('-PastaInicializar') ? [] : ['-PastaInicializar', pastaTemp(t, 'omni-inicializar-')])
  ]
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...argumentos, ...cintos, '-Base', base], {
    encoding: 'utf8',
    timeout: 180_000,
    env: {
      ...process.env,
      OMNI_HOME: casa,
      OMNI_CASA_BANCO: join(casa, 'banco'),
      OMNI_INSTALAR_NODE: process.execPath,
      OMNI_INSTALAR_NODE_MINIMO: MAJOR, // o CI roda Node 22; o mínimo de produção (24) tem teste próprio abaixo
      ...cofrePadrao,
      ...dadosPadrao,
      ...env
    }
  })
  const ultima = r.stdout.trim().split(/\r?\n/).pop()
  let json = null
  try { json = ultima ? JSON.parse(ultima) : null } catch { /* saída sem JSON */ }
  return { status: r.status, json, saida: r.stdout, erro: r.stderr, base, casa }
}

const passo = (json, nome) => json?.passos?.find((p) => p.passo === nome)
const versoes = (base) => (existsSync(join(base, 'versoes')) ? readdirSync(join(base, 'versoes')) : [])

test('instalar busca o commit, confere a impressão digital e promove para versoes\\<sha>', { skip: !windows }, (t) => {
  const r = instalar(t, ['instalar', '-Origem', origem.repo, '-Sha', origem.sha, ...BASICO])
  assert.equal(r.status, 0, r.erro)
  assert.equal(r.json.ok, true)
  assert.equal(r.json.sha, origem.sha)
  assert.equal(r.json.versao, VERSAO)
  assert.equal(passo(r.json, 'versao').ok, true)
  assert.ok(existsSync(join(r.base, 'versoes', origem.sha, 'runtime', 'executor.mjs')))
  const atual = JSON.parse(readFileSync(join(r.base, 'versoes', 'atual.json'), 'utf8'))
  assert.equal(atual.sha, origem.sha)
  assert.equal(atual.versao, VERSAO)
  assert.deepEqual(versoes(r.base).sort(), [origem.sha, 'atual.json'].sort(), 'nenhuma pasta temporária sobra')
  assert.equal(passo(r.json, 'tarefas'), undefined, '-SemTarefas não registra nada')
})

test('a mesma versão de novo não baixa nem reescreve', { skip: !windows }, (t) => {
  const primeira = instalar(t, ['instalar', '-Origem', origem.repo, '-Sha', origem.sha, ...BASICO])
  assert.equal(primeira.status, 0, primeira.erro)
  const arquivo = join(primeira.base, 'versoes', origem.sha, 'runtime', 'executor.mjs')
  const antes = statSync(arquivo).mtimeMs
  const segunda = instalar(t, ['instalar', '-Origem', origem.repo, '-Sha', origem.sha, ...BASICO], { base: primeira.base })
  assert.equal(segunda.status, 0, segunda.erro)
  assert.equal(passo(segunda.json, 'versao').detalhe, 'já instalada')
  assert.equal(statSync(arquivo).mtimeMs, antes)
})

test('commit com o payload adulterado não vira versão instalada', { skip: !windows }, async (t) => {
  const adulterado = await origem.commitar((repo) => appendFileSync(join(repo, 'runtime', 'servir.mjs'), '\n// adulterado\n'), { selar: false })
  const r = instalar(t, ['instalar', '-Origem', origem.repo, '-Sha', adulterado, ...BASICO])
  assert.equal(r.status, 1, r.erro)
  assert.equal(r.json.ok, false)
  assert.equal(passo(r.json, 'versao').ok, false)
  assert.match(passo(r.json, 'versao').detalhe, /integridade/)
  assert.deepEqual(versoes(r.base), [], 'nem a pasta da versão nem atual.json nem temporária')
})

test('commit que não existe na origem falha sem deixar rastro', { skip: !windows }, (t) => {
  const r = instalar(t, ['instalar', '-Origem', origem.repo, '-Sha', 'f'.repeat(40), ...BASICO])
  assert.equal(r.status, 1, r.erro)
  assert.equal(passo(r.json, 'versao').ok, false)
  assert.deepEqual(versoes(r.base), [])
})

test('Node abaixo do mínimo para antes de baixar qualquer coisa', { skip: !windows }, (t) => {
  const r = instalar(t, ['instalar', '-Origem', origem.repo, '-Sha', origem.sha, ...BASICO], { env: { OMNI_INSTALAR_NODE_MINIMO: '99' } })
  assert.equal(r.status, 1, r.erro)
  assert.equal(passo(r.json, 'prerequisitos').ok, false)
  assert.match(passo(r.json, 'prerequisitos').detalhe, /node/i)
  assert.equal(passo(r.json, 'versao'), undefined)
  assert.deepEqual(versoes(r.base), [])
})

test('o mínimo de produção é Node 24', { skip: !windows }, () => {
  assert.match(readFileSync(SCRIPT, 'utf8'), /OMNI_INSTALAR_NODE_MINIMO[^\n]*\b24\b/)
})

const instalados = (casa) => comBancoDaCasa(casa, 'nucleo', (db) => listarInstalados(db), { OMNI_HOME: casa, OMNI_CASA_BANCO: join(casa, 'banco') })
  .map((i) => [i.agente, i.raiz])

test('instalar cria a casa com o Omni da versão e instala os agentes pedidos', { skip: !windows }, (t) => {
  const falso = agenteFalso(t)
  const r = instalar(t, ['instalar', '-Origem', origem.repo, '-Sha', origem.sha, '-Agente', falso, ...BASICO])
  assert.equal(r.status, 0, r.erro)
  assert.equal(passo(r.json, 'casa').ok, true)
  assert.equal(passo(r.json, 'agente:falso').ok, true)
  assert.deepEqual(instalados(r.casa), [
    ['falso', realpathSync.native(falso)],
    ['omni', realpathSync.native(join(r.base, 'versoes', origem.sha))]
  ])

  const segunda = instalar(t, ['instalar', '-Origem', origem.repo, '-Sha', origem.sha, '-Agente', falso, ...BASICO], { base: r.base, casa: r.casa })
  assert.equal(segunda.status, 0, segunda.erro)
  assert.equal(passo(segunda.json, 'casa').ok, true)
  assert.equal(passo(segunda.json, 'agente:falso').ok, true)
  assert.match(passo(segunda.json, 'agente:falso').detalhe, /sem mudança/)
})

test('agente que recusa o instalar para o script com o código do executor', { skip: !windows }, (t) => {
  const falso = agenteFalso(t)
  const r = instalar(t, ['instalar', '-Origem', origem.repo, '-Sha', origem.sha, '-Agente', falso, ...BASICO], { env: { FALSO_SAIR: '3' } })
  assert.equal(r.status, 1, r.erro)
  assert.equal(r.json.ok, false)
  assert.equal(passo(r.json, 'casa').ok, true)
  assert.equal(passo(r.json, 'agente:falso').ok, false)
  assert.match(passo(r.json, 'agente:falso').detalhe, /agente-recusou/)
  assert.deepEqual(instalados(r.casa).map(([agente]) => agente), ['omni'])
})

// npm falso: anota "<pasta> | <argumentos>" em npm.log ao lado dele e, no ci, deixa um electron.exe vazio
// (o iniciar.ps1 -SoPreparar da ilha só completa o Electron quando ele falta).
const NPM_FALSO = `@echo off
>>"%~dp0npm.log" echo %CD% ^| %*
if defined FALSO_NPM_SAIR exit /b %FALSO_NPM_SAIR%
if "%1"=="ci" (
  if not exist node_modules\\electron\\dist mkdir node_modules\\electron\\dist
  type nul > node_modules\\electron\\dist\\electron.exe
)
exit /b 0
`

function npmFalso(t) {
  const pasta = pastaTemp(t, 'omni-npm-')
  writeFileSync(join(pasta, 'npm.cmd'), NPM_FALSO)
  return { npm: join(pasta, 'npm.cmd'), chamadas: () => (existsSync(join(pasta, 'npm.log')) ? readFileSync(join(pasta, 'npm.log'), 'utf8') : '')
    .split(/\r?\n/).filter(Boolean).map((l) => { const [cd, args] = l.split(' | '); return { cd: cd.trim(), args: (args ?? '').trim() } }) }
}

function lerAtalho(arquivo) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    `$l = (New-Object -ComObject WScript.Shell).CreateShortcut('${arquivo.replaceAll("'", "''")}'); [pscustomobject]@{ alvo = $l.TargetPath; argumentos = $l.Arguments } | ConvertTo-Json -Compress`], { encoding: 'utf8' })
  return JSON.parse(r.stdout)
}

const SEM_ILHA_E_WHATSAPP = BASICO.filter((a) => a !== '-SemIlha' && a !== '-SemWhatsApp')

test('instalar prepara a ilha e o WhatsApp dentro da versão e cria os atalhos para lá', { skip: !windows }, (t) => {
  const { npm, chamadas } = npmFalso(t)
  const atalhos = pastaTemp(t, 'omni-atalhos-')
  const inicializar = pastaTemp(t, 'omni-inicializar-')
  const r = instalar(t, ['instalar', '-Origem', origem.repo, '-Sha', origem.sha, ...SEM_ILHA_E_WHATSAPP, '-PastaAtalhos', atalhos, '-PastaInicializar', inicializar],
    { env: { OMNI_INSTALAR_NPM: npm } })
  assert.equal(r.status, 0, r.erro)
  assert.equal(passo(r.json, 'ilha').ok, true)
  assert.equal(passo(r.json, 'whatsapp').ok, true)

  const versao = realpathSync.native(join(r.base, 'versoes', origem.sha))
  const ilha = join(versao, 'apps', 'omni-ilha')
  const whatsapp = join(versao, 'servicos', 'whatsapp')
  const feitas = chamadas().map((c) => `${c.cd.toLowerCase()} | ${c.args}`)
  assert.deepEqual(feitas, [`${ilha.toLowerCase()} | ci`, `${whatsapp.toLowerCase()} | ci`, `${whatsapp.toLowerCase()} | run build`])

  const atalhoIlha = lerAtalho(join(atalhos, 'Omni Ilha.lnk'))
  assert.match(atalhoIlha.alvo, /\\System32\\conhost\.exe$/i)
  assert.ok(atalhoIlha.argumentos.startsWith('--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File '), atalhoIlha.argumentos)
  assert.ok(atalhoIlha.argumentos.toLowerCase().includes(`"${join(ilha, 'iniciar.ps1').toLowerCase()}"`), atalhoIlha.argumentos)
  const atalhoWhatsapp = lerAtalho(join(inicializar, 'Omni WhatsApp.lnk'))
  assert.match(atalhoWhatsapp.alvo, /\\System32\\conhost\.exe$/i)
  assert.ok(atalhoWhatsapp.argumentos.toLowerCase().includes(`"${join(whatsapp, 'omni', 'iniciar.ps1').toLowerCase()}"`), atalhoWhatsapp.argumentos)
  for (const a of [atalhoIlha, atalhoWhatsapp]) assert.doesNotMatch(a.argumentos, /Documents\\Omni/i)
  assert.deepEqual(readdirSync(atalhos), ['Omni Ilha.lnk'])
  assert.deepEqual(readdirSync(inicializar), ['Omni WhatsApp.lnk'])
})

test('npm que falha para a instalação no passo da ilha, sem atalho', { skip: !windows }, (t) => {
  const { npm } = npmFalso(t)
  const atalhos = pastaTemp(t, 'omni-atalhos-')
  const inicializar = pastaTemp(t, 'omni-inicializar-')
  const r = instalar(t, ['instalar', '-Origem', origem.repo, '-Sha', origem.sha, ...SEM_ILHA_E_WHATSAPP, '-PastaAtalhos', atalhos, '-PastaInicializar', inicializar],
    { env: { OMNI_INSTALAR_NPM: npm, FALSO_NPM_SAIR: '1' } })
  assert.equal(r.status, 1, r.erro)
  assert.equal(passo(r.json, 'ilha').ok, false)
  assert.match(passo(r.json, 'ilha').detalhe, /npm ci/)
  assert.equal(passo(r.json, 'whatsapp'), undefined)
  assert.deepEqual(readdirSync(atalhos), [])
  assert.deepEqual(readdirSync(inicializar), [])
})

// 267011 = 0x41303, SCHED_S_TASK_HAS_NOT_RUN: o registro não pode acordar o vigia (que mexe no WhatsApp real).
const NUNCA_RODOU = 267011
function lerTarefa(nome) {
  const r = powershell(`$t = Get-ScheduledTask -TaskName $env:NOME_TAREFA -ErrorAction SilentlyContinue
if (-not $t) { 'null' } else {
  $i = $t | Get-ScheduledTaskInfo
  [ordered]@{ execute = $t.Actions[0].Execute; argumentos = $t.Actions[0].Arguments; intervalo = $t.Triggers[0].Repetition.Interval;
    limite = $t.Settings.ExecutionTimeLimit; logon = [string]$t.Principal.LogonType; nivel = [string]$t.Principal.RunLevel; resultado = $i.LastTaskResult } | ConvertTo-Json -Compress
}`, { NOME_TAREFA: nome })
  return JSON.parse(r.stdout.trim().split(/\r?\n/).pop())
}
const removerTarefa = (nome) => powershell('Unregister-ScheduledTask -TaskName $env:NOME_TAREFA -Confirm:$false -ErrorAction SilentlyContinue', { NOME_TAREFA: nome })

test('instalar registra o vigia do WhatsApp da versão, de 5 em 5 minutos, sem disparar na hora', { skip: !windows }, (t) => {
  const prefixo = `${PREFIXO_TESTE}${randomBytes(4).toString('hex')}`
  const nome = `${prefixo} - vigia do WhatsApp`
  t.after(() => { removerTarefa(nome); assert.equal(lerTarefa(nome), null, 'a tarefa de teste sumiu') })
  const r = instalar(t, ['instalar', '-Origem', origem.repo, '-Sha', origem.sha, ...BASICO.filter((a) => a !== '-SemTarefas'), '-PrefixoTarefa', prefixo])
  assert.equal(r.status, 0, r.erro)
  assert.equal(passo(r.json, 'tarefas')?.ok, true, 'passo tarefas')
  assert.match(passo(r.json, 'tarefas').detalhe, new RegExp(prefixo))
  const tarefa = lerTarefa(nome)
  assert.ok(tarefa, 'a tarefa existe')
  assert.equal(tarefa.execute.toLowerCase(), 'wscript.exe')
  const vbs = join(realpathSync.native(r.base), 'versoes', origem.sha, 'servicos', 'whatsapp', 'omni', 'vigia-servico.vbs')
  assert.equal(tarefa.argumentos.toLowerCase(), `"${vbs}"`.toLowerCase())
  assert.equal(tarefa.intervalo, 'PT5M')
  assert.equal(tarefa.limite, 'PT10M')
  assert.deepEqual([tarefa.logon, tarefa.nivel], ['Interactive', 'Limited'])
  assert.equal(tarefa.resultado, NUNCA_RODOU)
  const segunda = instalar(t, ['instalar', '-Origem', origem.repo, '-Sha', origem.sha, ...BASICO.filter((a) => a !== '-SemTarefas'), '-PrefixoTarefa', prefixo], { base: r.base, casa: r.casa })
  assert.equal(segunda.status, 0, segunda.erro)
  assert.equal(lerTarefa(nome).argumentos, tarefa.argumentos, 'registrar de novo substitui sem duplicar')
})

// claude falso com as listagens no formato do claude de verdade ("  > nome"), com um vizinho de isca.
const CLAUDE_FALSO = `import { appendFileSync } from 'node:fs'
const args = process.argv.slice(2).join(' ')
appendFileSync(new URL('./claude.log', import.meta.url), args + '\\n')
const tem = process.env.FALSO_CLAUDE_TEM ?? ''
if (args === 'plugin marketplace list') {
  process.stdout.write('Configured marketplaces:\\n\\n  > outro-hub\\n    Source: Git (https://example.invalid/outro.git)\\n')
  if (tem.includes('marketplace')) process.stdout.write('\\n  > omni-hub\\n    Source: Git (https://github.com/Weriton-DataOps/Omni-Agent.git)\\n')
} else if (args === 'plugin list') {
  process.stdout.write('Installed plugins:\\n\\n  > outro@outro-hub\\n    Version: 1.0.0\\n    Scope: user\\n')
  if (tem.includes('plugin')) process.stdout.write('\\n  > omni@omni-hub\\n    Version: 0.32.0\\n    Scope: user\\n')
} else if (process.env.FALSO_CLAUDE_SAIR) {
  process.exit(Number(process.env.FALSO_CLAUDE_SAIR))
}
`
function claudeFalso(t) {
  const pasta = pastaTemp(t, 'omni-claude-')
  writeFileSync(join(pasta, 'claude-falso.mjs'), CLAUDE_FALSO)
  writeFileSync(join(pasta, 'claude.cmd'), `@"${process.execPath}" "%~dp0claude-falso.mjs" %*\r\n`)
  const arquivo = join(pasta, 'claude.log')
  return {
    claude: join(pasta, 'claude.cmd'),
    // só o que muda alguma coisa: as listagens são consulta
    mudancas: () => (existsSync(arquivo) ? readFileSync(arquivo, 'utf8').split(/\r?\n/).filter((l) => l && !l.endsWith(' list')) : []),
    zerar: () => rmSync(arquivo, { force: true })
  }
}
const COM_PLUGIN = BASICO.filter((a) => a !== '-SemPlugin')

test('plugin: adiciona o marketplace e instala, ou só atualiza o que já existe', { skip: !windows }, (t) => {
  const { claude, mudancas, zerar } = claudeFalso(t)
  const base = pastaTemp(t, 'omni-base-')
  const casa = pastaTemp(t, 'omni-casa-')
  const casos = [
    ['', ['plugin marketplace add https://github.com/Weriton-DataOps/Omni-Agent.git', 'plugin install omni@omni-hub --scope user']],
    ['marketplace', ['plugin marketplace update omni-hub', 'plugin install omni@omni-hub --scope user']],
    ['marketplace plugin', ['plugin marketplace update omni-hub', 'plugin update omni@omni-hub --scope user']]
  ]
  for (const [tem, esperado] of casos) {
    zerar()
    const r = instalar(t, ['instalar', '-Origem', origem.repo, '-Sha', origem.sha, ...COM_PLUGIN], { base, casa, env: { OMNI_INSTALAR_CLAUDE: claude, FALSO_CLAUDE_TEM: tem } })
    assert.equal(r.status, 0, r.erro)
    assert.equal(passo(r.json, 'plugin')?.ok, true, `passo plugin com "${tem}"`)
    assert.deepEqual(mudancas(), esperado, `com "${tem}" já presente`)
  }
})

test('plugin: install que falha para o script; claude ausente só avisa', { skip: !windows }, (t) => {
  const { claude } = claudeFalso(t)
  const falhou = instalar(t, ['instalar', '-Origem', origem.repo, '-Sha', origem.sha, ...COM_PLUGIN], { env: { OMNI_INSTALAR_CLAUDE: claude, FALSO_CLAUDE_SAIR: '1' } })
  assert.equal(falhou.status, 1, falhou.erro)
  assert.equal(passo(falhou.json, 'plugin')?.ok, false)
  assert.match(passo(falhou.json, 'plugin').detalhe, /saiu com 1/)
  const ausente = instalar(t, ['instalar', '-Origem', origem.repo, '-Sha', origem.sha, ...COM_PLUGIN], { env: { OMNI_INSTALAR_CLAUDE: join(tmpdir(), 'nao-existe', 'claude.cmd') } })
  assert.equal(ausente.status, 0, ausente.erro)
  assert.equal(passo(ausente.json, 'plugin')?.ok, false)
  assert.match(passo(ausente.json, 'plugin').detalhe, /claude não encontrado/)
})

const SEM_WHATSAPP = BASICO.filter((a) => a !== '-SemWhatsApp')

test('a chave admin vai do .api-key para o cofre só pelo stdin, uma vez, sem aparecer em lugar nenhum', { skip: !windows }, (t) => {
  const { npm } = npmFalso(t)
  const { cofre, admin, chamadas } = cofreFalso(t)
  const dados = pastaTemp(t, 'omni-wa-')
  const valor = `chave-de-teste-${randomBytes(12).toString('hex')}`
  mkdirSync(join(dados, 'data'))
  writeFileSync(join(dados, 'data', '.api-key'), `${valor}\n`)
  const env = { OMNI_INSTALAR_NPM: npm, OMNI_INSTALAR_COFRE: cofre, OMNI_INSTALAR_WHATSAPP_DADOS: dados }
  const r = instalar(t, ['instalar', '-Origem', origem.repo, '-Sha', origem.sha, ...SEM_WHATSAPP], { env })
  assert.equal(r.status, 0, r.erro)
  assert.equal(passo(r.json, 'chave-admin')?.ok, true, 'passo chave-admin')
  assert.equal(readFileSync(admin, 'utf8'), valor)
  assert.ok(!r.saida.includes(valor) && !r.erro.includes(valor), 'o valor não sai no stdout nem no stderr')
  assert.ok(chamadas().length > 0 && !chamadas().includes(valor), 'nem na linha de comando do cofre')
  const gravadaEm = statSync(admin).mtimeMs
  const segunda = instalar(t, ['instalar', '-Origem', origem.repo, '-Sha', origem.sha, ...SEM_WHATSAPP], { base: r.base, casa: r.casa, env })
  assert.equal(segunda.status, 0, segunda.erro)
  assert.match(passo(segunda.json, 'chave-admin').detalhe, /já no cofre/)
  assert.equal(statSync(admin).mtimeMs, gravadaEm, 'não regrava')
  assert.ok(!segunda.saida.includes(valor) && !segunda.erro.includes(valor), 'nem quando lê o cofre para conferir')
})

test('sem .api-key o passo avisa e a instalação segue', { skip: !windows }, (t) => {
  const { npm } = npmFalso(t)
  const { admin } = cofreFalso(t)
  const r = instalar(t, ['instalar', '-Origem', origem.repo, '-Sha', origem.sha, ...SEM_WHATSAPP], { env: { OMNI_INSTALAR_NPM: npm } })
  assert.equal(r.status, 0, r.erro)
  assert.equal(passo(r.json, 'chave-admin')?.ok, false, 'passo chave-admin')
  assert.equal(passo(r.json, 'chave-admin').detalhe, 'serviço ainda não gerou a chave')
  assert.equal(existsSync(admin), false)
})

// Os modos de manutenção (T8) leem a versão atual do atual.json; os cintos de atalho e tarefa precisam ser
// os mesmos do instalar que os criou.
function cintosFixos(t, prefixo = `${PREFIXO_TESTE}Nunca`) {
  return ['-PrefixoTarefa', prefixo, '-PastaAtalhos', pastaTemp(t, 'omni-atalhos-'), '-PastaInicializar', pastaTemp(t, 'omni-inicializar-')]
}
const lerAtual = (base) => JSON.parse(readFileSync(join(base, 'versoes', 'atual.json'), 'utf8'))
const pastasDeVersao = (base) => versoes(base).filter((n) => /^[0-9a-f]{40}$/.test(n)).sort()

test('verificar confere release, casa, atalhos e tarefa da versão atual', { skip: !windows }, (t) => {
  const { npm } = npmFalso(t)
  const prefixo = `${PREFIXO_TESTE}${randomBytes(4).toString('hex')}`
  t.after(() => removerTarefa(`${prefixo} - vigia do WhatsApp`))
  const cintos = cintosFixos(t, prefixo)
  const env = { OMNI_INSTALAR_NPM: npm }
  const sem = SEM_ILHA_E_WHATSAPP.filter((a) => a !== '-SemTarefas')
  const r = instalar(t, ['instalar', '-Origem', origem.repo, '-Sha', origem.sha, ...sem, ...cintos], { env })
  assert.equal(r.status, 0, r.erro)

  const v = instalar(t, ['verificar', ...cintos], { base: r.base, casa: r.casa, env })
  assert.equal(v.status, 0, v.erro)
  assert.equal(v.json.ok, true)
  assert.equal(v.json.sha, origem.sha)
  for (const nome of ['release', 'casa', 'atalhos', 'tarefas']) assert.equal(passo(v.json, nome)?.ok, true, `passo ${nome}: ${passo(v.json, nome)?.detalhe}`)

  // Atalho apontando para fora da versão atual é falha, não aviso.
  const outra = cintosFixos(t, prefixo)
  const fora = instalar(t, ['verificar', '-PrefixoTarefa', prefixo, '-PastaAtalhos', outra[3], '-PastaInicializar', cintos[5]], { base: r.base, casa: r.casa, env })
  assert.equal(passo(fora.json, 'atalhos')?.ok, true, 'pasta sem atalho nenhum não reprova')
  const lnk = join(cintos[3], 'Omni Ilha.lnk')
  powershell(`$l = (New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK); $l.Arguments = '--headless powershell.exe -File "C:\\outra\\iniciar.ps1"'; $l.Save()`, { LNK: lnk })
  const torto = instalar(t, ['verificar', ...cintos], { base: r.base, casa: r.casa, env })
  assert.equal(torto.status, 1, torto.erro)
  assert.equal(passo(torto.json, 'atalhos')?.ok, false)
  assert.match(passo(torto.json, 'atalhos').detalhe, /Omni Ilha/)
})

test('verificar com atual.json apontando para um sha sem pasta sai 1', { skip: !windows }, (t) => {
  const r = instalar(t, ['instalar', '-Origem', origem.repo, '-Sha', origem.sha, ...BASICO])
  assert.equal(r.status, 0, r.erro)
  const atual = lerAtual(r.base)
  writeFileSync(join(r.base, 'versoes', 'atual.json'), JSON.stringify({ ...atual, sha: 'e'.repeat(40) }))
  const v = instalar(t, ['verificar', ...BASICO], { base: r.base, casa: r.casa })
  assert.equal(v.status, 1, v.erro)
  assert.equal(v.json.ok, false)
  assert.equal(passo(v.json, 'release')?.ok, false)
  assert.match(passo(v.json, 'release').detalhe, /eeeeeeee/)
})

test('verificar sem nada instalado sai 1', { skip: !windows }, (t) => {
  const v = instalar(t, ['verificar', ...BASICO])
  assert.equal(v.status, 1, v.erro)
  assert.equal(passo(v.json, 'versao')?.ok, false)
})

test('atualizar troca a versão atual, repontua os atalhos e guarda só a anterior como volta', { skip: !windows }, async (t) => {
  const { npm } = npmFalso(t)
  const cintos = cintosFixos(t)
  const env = { OMNI_INSTALAR_NPM: npm }
  const marcar = (n) => (repo) => appendFileSync(join(repo, 'runtime', 'servir.mjs'), `\n// versao de teste ${n}\n`)
  const shaA = origem.sha
  const shaB = await origem.commitar(marcar('B'))
  const shaC = await origem.commitar(marcar('C'))

  const r = instalar(t, ['instalar', '-Origem', origem.repo, '-Sha', shaA, ...SEM_ILHA_E_WHATSAPP, ...cintos], { env })
  assert.equal(r.status, 0, r.erro)
  const atalhoDaIlha = () => lerAtalho(join(cintos[3], 'Omni Ilha.lnk')).argumentos.toLowerCase()
  const atalhoDoWhatsapp = () => lerAtalho(join(cintos[5], 'Omni WhatsApp.lnk')).argumentos.toLowerCase()
  const versao = (sha) => realpathSync.native(join(r.base, 'versoes', sha)).toLowerCase()

  const b = instalar(t, ['atualizar', '-Origem', origem.repo, '-Sha', shaB, ...SEM_ILHA_E_WHATSAPP, ...cintos], { base: r.base, casa: r.casa, env })
  assert.equal(b.status, 0, b.erro)
  assert.equal(b.json.modo, 'atualizar')
  assert.equal(lerAtual(r.base).sha, shaB)
  assert.equal(lerAtual(r.base).anterior, shaA)
  assert.deepEqual(pastasDeVersao(r.base), [shaA, shaB].sort(), 'a anterior fica como caminho de volta')
  assert.ok(atalhoDaIlha().includes(versao(shaB)), atalhoDaIlha())
  assert.ok(atalhoDoWhatsapp().includes(versao(shaB)), atalhoDoWhatsapp())
  for (const nome of ['casa', 'ilha', 'whatsapp', 'poda']) assert.equal(passo(b.json, nome)?.ok, true, `passo ${nome}`)
  assert.equal(passo(b.json, 'ilha-aberta'), undefined, 'atualizar não reabre a ilha')
  assert.equal(passo(b.json, 'whatsapp-no-ar'), undefined, 'nem sobe o serviço')
  assert.deepEqual(instalados(r.casa).find(([agente]) => agente === 'omni'), ['omni', realpathSync.native(join(r.base, 'versoes', shaB))])

  const c = instalar(t, ['atualizar', '-Origem', origem.repo, '-Sha', shaC, ...SEM_ILHA_E_WHATSAPP, ...cintos], { base: r.base, casa: r.casa, env })
  assert.equal(c.status, 0, c.erro)
  assert.deepEqual(pastasDeVersao(r.base), [shaB, shaC].sort(), 'a mais antiga some; ficam a atual e a anterior')
  assert.match(passo(c.json, 'poda').detalhe, new RegExp(shaA.slice(0, 12)))
  assert.deepEqual(versoes(r.base).filter((n) => n.startsWith('.')), [], 'nenhuma pasta temporária sobra')
  assert.ok(atalhoDaIlha().includes(versao(shaC)), atalhoDaIlha())

  // Voltar para a anterior é só atualizar para ela: nada é baixado de novo e ela continua guardada.
  const volta = instalar(t, ['atualizar', '-Origem', origem.repo, '-Sha', shaB, ...SEM_ILHA_E_WHATSAPP, ...cintos], { base: r.base, casa: r.casa, env })
  assert.equal(volta.status, 0, volta.erro)
  assert.equal(passo(volta.json, 'versao').detalhe, 'já instalada')
  assert.deepEqual([lerAtual(r.base).sha, lerAtual(r.base).anterior], [shaB, shaC])
  assert.deepEqual(pastasDeVersao(r.base), [shaB, shaC].sort())
})

test('exportar e importar repassam ao executor da versão atual e devolvem o JSON dele', { skip: !windows }, (t) => {
  const r = instalar(t, ['instalar', '-Origem', origem.repo, '-Sha', origem.sha, ...BASICO])
  assert.equal(r.status, 0, r.erro)
  const saida = join(pastaTemp(t, 'omni-pacote-'), 'casa.omnicasa')
  const e = instalar(t, ['exportar', '-Saida', saida, ...BASICO], { base: r.base, casa: r.casa })
  assert.equal(e.status, 0, e.erro)
  assert.equal(passo(e.json, 'exportar')?.ok, true)
  assert.equal(passo(e.json, 'exportar').resultado.ok, true)
  assert.ok(existsSync(saida), 'o pacote foi escrito')

  const outraCasa = pastaTemp(t, 'omni-casa-')
  const i = instalar(t, ['importar', '-Pacote', saida, ...BASICO], { base: r.base, casa: outraCasa })
  assert.equal(i.status, 0, i.erro)
  assert.equal(passo(i.json, 'importar')?.ok, true)
  assert.equal(passo(i.json, 'importar').resultado.ok, true)
  assert.deepEqual(instalados(outraCasa), instalados(r.casa))

  // A casa já ocupada recusa sem --substituir: o código do executor chega no passo e a saída é 1.
  const de_novo = instalar(t, ['importar', '-Pacote', saida, ...BASICO], { base: r.base, casa: outraCasa })
  assert.equal(de_novo.status, 1, de_novo.erro)
  assert.equal(passo(de_novo.json, 'importar')?.ok, false)
  assert.equal(passo(de_novo.json, 'importar').resultado.ok, false)
})

test('exportar sem -Saida e importar sem -Pacote são uso errado', { skip: !windows }, (t) => {
  assert.equal(instalar(t, ['exportar', ...BASICO]).status, 2)
  assert.equal(instalar(t, ['importar', ...BASICO]).status, 2)
})

test('instalar sem -Sha é uso errado', { skip: !windows }, (t) => {
  const r = instalar(t, ['instalar', ...BASICO])
  assert.equal(r.status, 2)
  assert.match(r.erro, /-Sha/)
})
