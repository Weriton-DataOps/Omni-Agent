<#
  As tarefas dos agentes no Agendador do Windows (F2, plano 5c).

  omni-tarefas.ps1 -Modo registrar|verificar -Prefixo <p> [-Raiz <versao do Omni>]

  A lista vem de `node <Raiz>\runtime\tarefa-agente.mjs listar` (o que está instalado nesta máquina, pelo
  nucleo.db). Cada tarefa vira "<Prefixo> - <agente> - <id>", com a ação
  wscript.exe "<Raiz>\scripts\omni-tarefa.vbs" <agente> <id> agendada.
  - registrar: cria ou atualiza (-Force) cada tarefa não divergente e poda as órfãs do mesmo prefixo cuja
    ação aponta para o omni-tarefa.vbs. O vigia do WhatsApp e qualquer outra tarefa ficam onde estão.
  - verificar: confere ação, gatilho e "se atrasada" de cada tarefa não divergente.
  A última linha do stdout é o JSON {ok, modo, registradas, podadas, puladas, divergencias[, erro]};
  sai 0 com ok e 1 sem.
#>
param(
  [string]$Modo,
  [string]$Prefixo,
  [string]$Raiz = (Split-Path -Parent $PSScriptRoot)
)
$ErrorActionPreference = 'Stop'

$registradas = New-Object System.Collections.Generic.List[string]
$podadas = New-Object System.Collections.Generic.List[string]
$puladas = New-Object System.Collections.Generic.List[string]
$divergencias = New-Object System.Collections.Generic.List[string]

function Responder([bool]$ok, [string]$erro) {
  $r = [ordered]@{ ok = $ok; modo = $Modo; registradas = $registradas.ToArray(); podadas = $podadas.ToArray(); puladas = $puladas.ToArray(); divergencias = $divergencias.ToArray() }
  if ($erro) { $r.erro = $erro }
  [Console]::Out.WriteLine(($r | ConvertTo-Json -Compress))
  if ($ok) { exit 0 } else { exit 1 }
}

function Listar-Tarefas {
  $node = if ($env:OMNI_NODE) { $env:OMNI_NODE } else { 'node' }
  $lancador = Join-Path $Raiz 'runtime\tarefa-agente.mjs'
  $antes = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $linhas = @(& $node $lancador 'listar' 2>$null | ForEach-Object { [string]$_ })
    $codigo = $LASTEXITCODE
  } catch {
    throw ('o listar não rodou: ' + $_.Exception.Message)
  } finally { $ErrorActionPreference = $antes }
  $json = $null
  if ($linhas.Count -gt 0) { try { $json = $linhas[-1] | ConvertFrom-Json } catch { } }
  if ($codigo -ne 0 -or -not $json -or -not $json.ok) {
    $motivo = if ($json -and $json.erro) { $json.erro } else { 'saiu com ' + $codigo }
    throw ('o listar recusou: ' + $motivo)
  }
  return @($json.tarefas)
}

function Nome-DaTarefa($t) { return $Prefixo + ' - ' + $t.agente + ' - ' + $t.id }
function Acao-Esperada($t) { return '"' + (Join-Path $Raiz 'scripts\omni-tarefa.vbs') + '" ' + $t.agente + ' ' + $t.id + ' agendada' }

# PT15M, PT2H: o Agendador guarda a repetição no mesmo formato ISO 8601.
function Intervalo([string]$texto) { return [System.Xml.XmlConvert]::ToTimeSpan($texto) }

function Registrar-Uma($t) {
  $vbs = Join-Path $Raiz 'scripts\omni-tarefa.vbs'
  $acao = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument (Acao-Esperada $t) -WorkingDirectory (Split-Path -Parent $vbs)
  if ($t.quando.diaria) {
    $gatilho = New-ScheduledTaskTrigger -Daily -At ([string]$t.quando.diaria)
  } else {
    $passo = Intervalo ([string]$t.quando.acada)
    $gatilho = New-ScheduledTaskTrigger -Once -At (Get-Date).Add($passo) -RepetitionInterval $passo
  }
  $limite = if ($t.lancador) { New-TimeSpan -Minutes 45 } else { New-TimeSpan -Minutes 10 }
  $opcoes = @{ AllowStartIfOnBatteries = $true; DontStopIfGoingOnBatteries = $true; ExecutionTimeLimit = $limite; MultipleInstances = 'IgnoreNew' }
  if ($t.seAtrasada) { $opcoes.StartWhenAvailable = $true }
  $regras = New-ScheduledTaskSettingsSet @opcoes
  $quem = New-ScheduledTaskPrincipal -UserId ($env:USERDOMAIN + '\' + $env:USERNAME) -LogonType Interactive -RunLevel Limited
  $descricao = 'Tarefa ' + $t.id + ' do agente ' + $t.agente + ' (Omni).'
  Register-ScheduledTask -TaskName (Nome-DaTarefa $t) -Action $acao -Trigger $gatilho -Settings $regras -Principal $quem -Description $descricao -Force | Out-Null
}

function Problema-Da($t) {
  $nome = Nome-DaTarefa $t
  $tarefa = Get-ScheduledTask -TaskPath '\' -TaskName $nome -ErrorAction SilentlyContinue
  if (-not $tarefa) { return 'não existe' }
  $acao = [string]$tarefa.Actions[0].Arguments
  if ([string]$tarefa.Actions[0].Execute -ne 'wscript.exe' -or $acao -ne (Acao-Esperada $t)) { return 'a ação é ' + $tarefa.Actions[0].Execute + ' ' + $acao }
  $g = $tarefa.Triggers[0]
  if ($t.quando.diaria) {
    $hora = if ([string]$g.StartBoundary -match 'T(\d\d:\d\d)') { $Matches[1] } else { '?' }
    if ($g.CimClass.CimClassName -ne 'MSFT_TaskDailyTrigger' -or $hora -ne [string]$t.quando.diaria) { return 'o gatilho devia ser diário às ' + $t.quando.diaria + ' e é ' + $g.CimClass.CimClassName + ' às ' + $hora }
  } else {
    $tem = if ($g.Repetition.Interval) { Intervalo ([string]$g.Repetition.Interval) } else { $null }
    if ($tem -ne (Intervalo ([string]$t.quando.acada))) { return 'o gatilho devia repetir a cada ' + $t.quando.acada + ' e repete a cada ' + $g.Repetition.Interval }
  }
  if ([bool]$tarefa.Settings.StartWhenAvailable -ne [bool]$t.seAtrasada) { return 'se atrasada devia ser ' + $t.seAtrasada }
  return $null
}

try {
  if ($Modo -ne 'registrar' -and $Modo -ne 'verificar') { Responder $false 'uso: -Modo registrar ou verificar' }
  if ($Prefixo -notmatch '^[A-Za-z][A-Za-z0-9]*$') { Responder $false 'uso: -Prefixo com letras e dígitos' }
  $tarefas = Listar-Tarefas
  $conhecidas = @{}
  foreach ($t in $tarefas) {
    $nome = Nome-DaTarefa $t
    $conhecidas[$nome] = $true
    if ($t.divergente) { $puladas.Add($nome); continue }
    if ($Modo -eq 'registrar') {
      try { Registrar-Uma $t; $registradas.Add($nome) }
      catch { $divergencias.Add($nome + ': não registrou: ' + $_.Exception.Message) }
    } else {
      $problema = Problema-Da $t
      if ($problema) { $divergencias.Add($nome + ': ' + $problema) }
    }
  }
  if ($Modo -eq 'registrar') {
    $padrao = '^' + [regex]::Escape($Prefixo) + ' - [a-z][a-z0-9-]* - [a-z][a-z0-9-]*$'
    foreach ($velha in @(Get-ScheduledTask -TaskPath '\' -ErrorAction SilentlyContinue)) {
      if ($velha.TaskName -cnotmatch $padrao -or $conhecidas.ContainsKey($velha.TaskName)) { continue }
      if (-not (@($velha.Actions) | Where-Object { [string]$_.Arguments -match 'omni-tarefa\.vbs' })) { continue }
      try { Unregister-ScheduledTask -TaskPath '\' -TaskName $velha.TaskName -Confirm:$false; $podadas.Add($velha.TaskName) }
      catch { $divergencias.Add($velha.TaskName + ': não podou: ' + $_.Exception.Message) }
    }
  }
  Responder ($divergencias.Count -eq 0) $null
} catch {
  Responder $false $_.Exception.Message
}
