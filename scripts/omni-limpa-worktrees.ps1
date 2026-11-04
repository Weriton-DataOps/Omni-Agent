<#
.SYNOPSIS
  Vassoura dos fosseis de scratch (worktrees / clones / caches) do time.

.DESCRIPTION
  Varre as subpastas imediatas de -Raiz (padrao C:\tmp) e remove SO o que e
  seguro e reversivel:
    - worktree/clone git LIMPO (sem mudanca) E com HEAD em algum branch remoto
      (recuperavel por 'git worktree add' / clone);
    - cache reinstalavel conhecido (ms-playwright, portal-ref, ...).
  NUNCA remove o irreversivel:
    - working tree SUJO (mudanca nao commitada);
    - HEAD so-local (commit nao empurrado);
    - pasta nao-git desconhecida; junction/symlink.

  Padrao e PREVIEW (nao apaga nada). So apaga de verdade com -Apaga.
  -Dias N limita aos fosseis parados ha mais de N dias (padrao 0 = todos).

  Regra do dono (Weriton, 18/10/2026): limpar o fossil ao fim de cada tarefa,
  nas tres especies. O trabalho que ainda nao terminou (sujo / so-local) fica.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File omni-limpa-worktrees.ps1
  # preview: mostra o que cairia, sem apagar

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File omni-limpa-worktrees.ps1 -Apaga
  # apaga os fosseis seguros, poupa sujo/so-local/desconhecido
#>
[CmdletBinding()]
param(
  [string]$Raiz = 'C:\tmp',
  [switch]$Apaga,
  [int]$Dias = 0
)

$ErrorActionPreference = 'Stop'
$cacheAllow = @('ms-playwright', 'portal-ref')

if (-not (Test-Path -LiteralPath $Raiz)) {
  Write-Output ("Raiz nao existe: " + $Raiz)
  return
}

$cim = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
$before = [double]$cim.FreeSpace

# source vazio p/ purge robusto (robocopy /MIR lida com node_modules de caminho longo)
$empty = Join-Path ([IO.Path]::GetTempPath()) ('omni_empty_' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $empty | Out-Null

function Remove-Tree($path) {
  & robocopy $empty $path /MIR /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
  Remove-Item -LiteralPath $path -Recurse -Force
}

$apagar = New-Object System.Collections.Generic.List[object]
$poupar = New-Object System.Collections.Generic.List[object]

# git com aviso no stderr (node_modules quebrado, caminho longo) nao pode derrubar a varredura:
# no PS 5.1 o stderr de exe nativo vira erro e, com Stop, aborta tudo (04/11).
function GitQ {
  $ErrorActionPreference = 'Continue'
  $o = & git @args 2>$null
  $o
}

# cwd das sessoes Claude vivas (~/.claude/sessions/<pid>.json com processo de pe)
$cwdsVivos = @(Get-ChildItem -LiteralPath (Join-Path $env:USERPROFILE '.claude\sessions') -Filter '*.json' -ErrorAction SilentlyContinue | ForEach-Object {
  try { $s = Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json } catch { return }
  if ($s.cwd -and (Get-Process -Id $s.pid -ErrorAction SilentlyContinue)) { ([string]$s.cwd).TrimEnd('\').ToLower() }
})

$corteData = (Get-Date).AddDays(-$Dias)
$dirs = @(Get-ChildItem -LiteralPath $Raiz -Directory)

foreach ($dir in $dirs) {
  $d = $dir.FullName
  $name = $dir.Name

  if ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    $poupar.Add([pscustomobject]@{ Pasta = $name; Motivo = 'junction/symlink' }); continue
  }
  if ($Dias -gt 0 -and $dir.LastWriteTime -gt $corteData) {
    $poupar.Add([pscustomobject]@{ Pasta = $name; Motivo = ('recente (< ' + $Dias + 'd)') }); continue
  }

  $isGit = GitQ -C $d rev-parse --is-inside-work-tree

  if ($isGit -eq 'true') {
    # sessão viva com cwd aqui, ou git mexido nas últimas 24 h: trabalho em curso, mesmo limpo (04/11)
    if ($cwdsVivos | Where-Object { $_ -eq $d.ToLower() -or $_.StartsWith($d.ToLower() + '\') }) {
      $poupar.Add([pscustomobject]@{ Pasta = $name; Motivo = 'sessao viva aqui' }); continue
    }
    $gd = GitQ -C $d rev-parse --absolute-git-dir
    $toque = @('index', 'HEAD', 'logs\HEAD') | ForEach-Object { if ($gd) { Get-Item -LiteralPath (Join-Path $gd $_) -Force -ErrorAction SilentlyContinue } } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($toque -and $toque.LastWriteTime -gt (Get-Date).AddHours(-24)) {
      $poupar.Add([pscustomobject]@{ Pasta = $name; Motivo = 'git mexido < 24h' }); continue
    }
    $st = GitQ -C $d status --porcelain
    $dirty = [bool]$st
    $rem = GitQ -C $d branch -r --contains HEAD
    $pushed = [bool]$rem
    if ((-not $dirty) -and $pushed) {
      $apagar.Add([pscustomobject]@{ Pasta = $name; Motivo = 'git limpo+remoto'; Caminho = $d })
    }
    else {
      $motivo = if ($dirty) { 'SUJO - nao commitado' } else { 'so-local - nao empurrado' }
      $poupar.Add([pscustomobject]@{ Pasta = $name; Motivo = $motivo })
    }
  }
  else {
    if ($cacheAllow -contains $name) {
      $apagar.Add([pscustomobject]@{ Pasta = $name; Motivo = 'cache reinstalavel'; Caminho = $d })
    }
    else {
      $poupar.Add([pscustomobject]@{ Pasta = $name; Motivo = 'nao-git desconhecido' })
    }
  }
}

$feitos = New-Object System.Collections.Generic.List[object]
if ($Apaga) {
  foreach ($item in $apagar) {
    try {
      Remove-Tree $item.Caminho
      $feitos.Add([pscustomobject]@{ Pasta = $item.Pasta; Resultado = 'apagado' })
    }
    catch {
      $feitos.Add([pscustomobject]@{ Pasta = $item.Pasta; Resultado = ('ERRO: ' + $_.Exception.Message) })
    }
  }
}

Remove-Item -LiteralPath $empty -Recurse -Force -ErrorAction SilentlyContinue

$cim2 = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
$after = [double]$cim2.FreeSpace
$freedGB = [math]::Round(($after - $before) / 1GB, 2)
$freeGB = [math]::Round($after / 1GB, 2)
$modo = if ($Apaga) { 'APAGANDO' } else { 'PREVIEW (nada apagado - rode com -Apaga)' }

Write-Output ('=== Vassoura de fosseis | modo: ' + $modo + ' | raiz: ' + $Raiz + ' ===')
Write-Output ''
Write-Output ('-- Fosseis seguros (' + $apagar.Count + ') --')
$apagar | Select-Object Pasta, Motivo | Format-Table -AutoSize
if ($Apaga) { Write-Output '-- Execucao --'; $feitos | Format-Table -AutoSize }
Write-Output ('-- Poupados (' + $poupar.Count + ') --')
$poupar | Format-Table -AutoSize
$resumo = [pscustomobject]@{
  Seguros      = $apagar.Count
  Poupados     = $poupar.Count
  LiberadoGB   = $freedGB
  LivreAgoraGB = $freeGB
}
Write-Output '-- Resumo --'
$resumo | Format-Table -AutoSize

# git contra worktree quebrado (caminho de rede morto) devolve 255 e vaza no exit;
# o relatorio acima e a verdade. Fecha limpo.
exit 0
