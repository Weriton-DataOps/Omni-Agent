// As tarefas dos agentes no Agendador do Windows (F2, plano 5c, T3): scripts/omni-tarefas.ps1 de verdade,
// contra uma casa temporária com agentes falsos, e o scripts/omni-tarefa.vbs rodando uma tarefa comando de
// ponta a ponta. Só roda no Windows.
//
// O prefixo é OmniTT<aleatório>, não OmniTeste: o teste do instalador varre OmniTeste* no after dele e,
// com os arquivos rodando em paralelo, apagaria as tarefas deste no meio da rodada. O after daqui varre
// só OmniTT*.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, test } from 'node:test'

import { comBancoDaCasa } from '../runtime/casa/banco.mjs'
import { registrarAgente } from '../runtime/casa/loja-nucleo.mjs'

const RAIZ = resolve(import.meta.dirname, '..')
const SCRIPT = join(RAIZ, 'scripts', 'omni-tarefas.ps1')
const VBS = join(RAIZ, 'scripts', 'omni-tarefa.vbs')
const windows = process.platform === 'win32'
const PREFIXO_TESTE = 'OmniTT'
// 267011 = 0x41303, SCHED_S_TASK_HAS_NOT_RUN: registrar não pode disparar a tarefa.
const NUNCA_RODOU = 267011

function powershell(comando, env = {}) {
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', comando], { encoding: 'utf8', env: { ...process.env, ...env } })
}
after(() => { if (windows) powershell(`Get-ScheduledTask -TaskName '${PREFIXO_TESTE}*' -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false`) })

const VISITA = { id: 'actions-visita', lancador: 'omni', roteiro: 'roteiros/visita.md', variaveis: ['MOTIVO'], quando: { diaria: '07:00' }, seAtrasada: true }
const VIGIA = { id: 'vigia', comando: 'node -e "require(\'fs\').writeFileSync(\'feito.txt\', process.argv.length + \'\')"', quando: { acada: 'PT15M' }, seAtrasada: false }
const NOTURNA = { id: 'noturna', comando: 'echo noite', quando: { diaria: '23:30' }, seAtrasada: false }

function manifesto(agente, versao, tarefas) {
  return JSON.stringify({ agente, versao, banco: null, requer: { node: '>=24' }, executor: { comando: 'node executor/x.mjs', modos: ['servir'] }, tarefas, credenciais: [] })
}

function preparar(t) {
  const pasta = mkdtempSync(join(tmpdir(), 'omni-tarefas-ps1-'))
  t.after(() => rmSync(pasta, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }))
  const prefixo = `${PREFIXO_TESTE}${randomBytes(4).toString('hex')}`
  t.after(() => powershell(`Get-ScheduledTask -TaskName '${prefixo}*' -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false`))
  const env = { OMNI_HOME: pasta, OMNI_CASA_BANCO: join(pasta, 'banco'), OMNI_NODE: process.execPath }
  const raizDe = (agente) => { const r = join(pasta, agente); mkdirSync(r, { recursive: true }); return r }
  const registrar = (agente, versao, tarefas, extra = {}) =>
    comBancoDaCasa(pasta, 'nucleo', (db) => registrarAgente(db, manifesto(agente, versao, tarefas), { raiz: raizDe(agente), ...extra }), { ...process.env, ...env })
  registrar('oraculo', '0.0.1', [VISITA])
  registrar('sentinela', '0.0.1', [VIGIA])
  // instalado aqui na 0.0.1, mas o catálogo já tem a 0.0.2 vinda de outra máquina: divergente
  registrar('atrasado', '0.0.1', [NOTURNA])
  registrar('atrasado', '0.0.2', [NOTURNA], { maquina: 'outra', nome: 'OUTRA', sistema: 'win32' })
  const tarefas = (modo, extra = []) => {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Modo', modo, '-Prefixo', prefixo, '-Raiz', RAIZ, ...extra],
      { encoding: 'utf8', timeout: 120_000, env: { ...process.env, ...env } })
    const linhas = (r.stdout ?? '').trim().split(/\r?\n/)
    let json = null
    try { json = JSON.parse(linhas.pop()) } catch { /* fica null */ }
    return { status: r.status, json, erro: `${r.stdout}\n${r.stderr}` }
  }
  const nome = (agente, id) => `${prefixo} - ${agente} - ${id}`
  return { pasta, prefixo, env, tarefas, nome, raiz: (agente) => join(pasta, agente) }
}

function lerTarefa(nome) {
  const r = powershell(`$t = Get-ScheduledTask -TaskName $env:NOME_TAREFA -ErrorAction SilentlyContinue
if (-not $t) { 'null' } else {
  $g = $t.Triggers[0]
  [ordered]@{ execute = $t.Actions[0].Execute; argumentos = $t.Actions[0].Arguments; tipo = $g.CimClass.CimClassName;
    inicio = [string]$g.StartBoundary; intervalo = $g.Repetition.Interval; atrasada = $t.Settings.StartWhenAvailable;
    limite = $t.Settings.ExecutionTimeLimit; instancias = [string]$t.Settings.MultipleInstances;
    logon = [string]$t.Principal.LogonType; nivel = [string]$t.Principal.RunLevel; resultado = ($t | Get-ScheduledTaskInfo).LastTaskResult } | ConvertTo-Json -Compress
}`, { NOME_TAREFA: nome })
  return JSON.parse(r.stdout.trim().split(/\r?\n/).pop())
}

const acao = (agente, id) => `"${VBS}" ${agente} ${id} agendada`.toLowerCase()

test('registrar põe as tarefas dos agentes no agendador, sem disparar, e pula o divergente', { skip: !windows }, (t) => {
  const p = preparar(t)
  const r = p.tarefas('registrar')
  assert.equal(r.status, 0, r.erro)
  assert.equal(r.json.ok, true)
  assert.equal(r.json.modo, 'registrar')
  assert.deepEqual([...r.json.registradas].sort(), [p.nome('oraculo', 'actions-visita'), p.nome('sentinela', 'vigia')].sort())
  assert.deepEqual(r.json.puladas, [p.nome('atrasado', 'noturna')])
  assert.deepEqual(r.json.podadas, [])

  const diaria = lerTarefa(p.nome('oraculo', 'actions-visita'))
  assert.equal(diaria.execute.toLowerCase(), 'wscript.exe')
  assert.equal(diaria.argumentos.toLowerCase(), acao('oraculo', 'actions-visita'))
  assert.equal(diaria.tipo, 'MSFT_TaskDailyTrigger')
  assert.match(diaria.inicio, /T07:00:00/)
  assert.equal(diaria.atrasada, true)
  assert.equal(diaria.limite, 'PT45M', 'roteiro tem 45 min')
  assert.equal(diaria.instancias, 'IgnoreNew')
  assert.deepEqual([diaria.logon, diaria.nivel], ['Interactive', 'Limited'])
  assert.equal(diaria.resultado, NUNCA_RODOU)

  const repetida = lerTarefa(p.nome('sentinela', 'vigia'))
  assert.equal(repetida.argumentos.toLowerCase(), acao('sentinela', 'vigia'))
  assert.equal(repetida.tipo, 'MSFT_TaskTimeTrigger')
  assert.equal(repetida.intervalo, 'PT15M')
  assert.equal(repetida.atrasada, false)
  assert.equal(repetida.limite, 'PT10M', 'comando tem 10 min')
  assert.equal(repetida.resultado, NUNCA_RODOU)

  assert.equal(lerTarefa(p.nome('atrasado', 'noturna')), null, 'o divergente não entra')

  const v = p.tarefas('verificar')
  assert.equal(v.status, 0, v.erro)
  assert.equal(v.json.ok, true)
  assert.equal(v.json.modo, 'verificar')
  assert.deepEqual(v.json.divergencias, [])
  assert.deepEqual(v.json.puladas, [p.nome('atrasado', 'noturna')])
})

test('registrar poda só a órfã do lançador do mesmo prefixo e deixa o vigia do WhatsApp', { skip: !windows }, (t) => {
  const p = preparar(t)
  const orfa = p.nome('velho', 'x')
  const vigia = `${p.prefixo} - vigia do WhatsApp`
  // mesmo formato de nome, mas a ação é de outro dono: não é do lançador, fica
  const alheia = p.nome('alheio', 'y')
  const criada = powershell(`$a = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument $env:ARG_ORFA
Register-ScheduledTask -TaskName $env:ORFA -Action $a -Trigger (New-ScheduledTaskTrigger -Daily -At '03:00') -Force | Out-Null
$b = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument '"C:\\x\\vigia-servico.vbs"'
Register-ScheduledTask -TaskName $env:VIGIA -Action $b -Trigger (New-ScheduledTaskTrigger -Daily -At '03:00') -Force | Out-Null
$c = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument '"C:\\x\\outro.vbs" alheio y'
Register-ScheduledTask -TaskName $env:ALHEIA -Action $c -Trigger (New-ScheduledTaskTrigger -Daily -At '03:00') -Force | Out-Null
'ok'`, { ORFA: orfa, VIGIA: vigia, ALHEIA: alheia, ARG_ORFA: `"${VBS}" velho x agendada` })
  assert.match(criada.stdout, /ok/, criada.stderr)
  const r = p.tarefas('registrar')
  assert.equal(r.status, 0, r.erro)
  assert.deepEqual(r.json.podadas, [orfa])
  assert.equal(lerTarefa(orfa), null, 'a órfã saiu')
  assert.ok(lerTarefa(vigia), 'o vigia do WhatsApp ficou')
  assert.ok(lerTarefa(alheia), 'a de outro dono ficou')
})

test('verificar aponta a tarefa adulterada e a que sumiu', { skip: !windows }, (t) => {
  const p = preparar(t)
  assert.equal(p.tarefas('registrar').status, 0)
  const adulterada = p.nome('oraculo', 'actions-visita')
  powershell(`$a = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument '"C:\\outro\\qualquer.vbs" oraculo actions-visita agendada'
Set-ScheduledTask -TaskName $env:NOME_TAREFA -Action $a | Out-Null`, { NOME_TAREFA: adulterada })
  const v = p.tarefas('verificar')
  assert.equal(v.status, 1, v.erro)
  assert.equal(v.json.ok, false)
  assert.equal(v.json.divergencias.length, 1)
  assert.match(v.json.divergencias[0], new RegExp(`^${adulterada}: `))
  assert.match(v.json.divergencias[0], /qualquer\.vbs/)

  powershell('Unregister-ScheduledTask -TaskName $env:NOME_TAREFA -Confirm:$false', { NOME_TAREFA: p.nome('sentinela', 'vigia') })
  const sumiu = p.tarefas('verificar')
  assert.equal(sumiu.status, 1)
  assert.ok(sumiu.json.divergencias.some((d) => d.startsWith(`${p.nome('sentinela', 'vigia')}: `) && /não existe/.test(d)), sumiu.erro)
})

test('verificar pega o gatilho mexido', { skip: !windows }, (t) => {
  const p = preparar(t)
  assert.equal(p.tarefas('registrar').status, 0)
  const nome = p.nome('oraculo', 'actions-visita')
  powershell("Set-ScheduledTask -TaskName $env:NOME_TAREFA -Trigger (New-ScheduledTaskTrigger -Daily -At '08:15') | Out-Null", { NOME_TAREFA: nome })
  const v = p.tarefas('verificar')
  assert.equal(v.status, 1, v.erro)
  assert.match(v.json.divergencias.join('\n'), new RegExp(`${nome}: .*07:00`))

  const outra = p.nome('sentinela', 'vigia')
  powershell('Set-ScheduledTask -TaskName $env:NOME_TAREFA -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10)) | Out-Null', { NOME_TAREFA: outra })
  const atrasada = p.tarefas('verificar')
  assert.match(atrasada.json.divergencias.join('\n'), new RegExp(`${outra}: se atrasada`), atrasada.erro)
})

test('modo desconhecido e lançador que falha saem 1 com o erro no JSON', { skip: !windows }, (t) => {
  const p = preparar(t)
  const ruim = p.tarefas('apagar')
  assert.equal(ruim.status, 1, ruim.erro)
  assert.equal(ruim.json.ok, false)
  assert.match(ruim.json.erro, /registrar ou verificar/)
  // -Raiz numa pasta sem o lançador: o listar não roda
  const semNode = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Modo', 'registrar', '-Prefixo', p.prefixo, '-Raiz', p.pasta],
    { encoding: 'utf8', timeout: 60_000, env: { ...process.env, ...p.env } })
  assert.equal(semNode.status, 1)
  const json = JSON.parse(semNode.stdout.trim().split(/\r?\n/).pop())
  assert.equal(json.ok, false)
  assert.match(json.erro, /listar/)
})

test('o .vbs roda a tarefa pela versão onde mora e devolve o código do lançador', { skip: !windows }, (t) => {
  const p = preparar(t)
  const r = spawnSync('wscript.exe', [VBS, 'sentinela', 'vigia', 'teste'], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, ...p.env } })
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`)
  assert.ok(existsSync(join(p.raiz('sentinela'), 'feito.txt')), 'o comando rodou na raiz do agente')
  const log = readFileSync(join(p.pasta, 'banco', 'tarefas', 'tarefas.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.deepEqual(log.map((l) => [l.agente, l.id, l.motivo, l.estado]), [['sentinela', 'vigia', 'teste', 'concluida']])
  const recusa = spawnSync('wscript.exe', [VBS, 'atrasado', 'noturna', 'teste'], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, ...p.env } })
  assert.equal(recusa.status, 1, 'o divergente volta como falha do lançador')
  const semArgs = spawnSync('wscript.exe', [VBS, 'sentinela'], { encoding: 'utf8', timeout: 60_000 })
  assert.equal(semArgs.status, 2)
})
