# Omni — visita ao Actions (21/10). Dispara uma sessão escondida do Claude Code com o roteiro de
# scripts/omni-actions-visita.md. Quem chama: a tarefa agendada "Omni Actions - visita" (7h, e "assim que
# possível" se o PC estava desligado), a ponte do WhatsApp (reação a um pedido de risco) e quem criar ponto
# novo. Uma visita por vez (trava); teto de 30 min, depois a árvore inteira cai e o registro diz
# "interrompida". Nada abre janela: o claude.exe nasce escondido e o roteiro exige windowsHide.
#
#   -Motivo diaria|ponto-novo|aprovacao|explicar|resposta|manual
#   -Raiz <pasta>   visita a seco sobre uma cópia do Actions (OMNI_ACTIONS); não manda WhatsApp
#   -Minutos <n>    teto (padrão 30)
param(
  [string]$Motivo = 'manual',
  [string]$Raiz = '',
  [int]$Minutos = 30
)
$ErrorActionPreference = 'Stop'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

$omni = Split-Path -Parent $PSScriptRoot
$actions = if ($Raiz) { (Resolve-Path $Raiz).Path } else { Join-Path $env:USERPROFILE 'Documents\Actions' }
$estado = Join-Path $env:APPDATA 'omni\actions'
New-Item -ItemType Directory -Force (Join-Path $estado 'logs') | Out-Null
New-Item -ItemType Directory -Force (Join-Path $actions 'visitas') | Out-Null
$log = Join-Path $estado 'logs\visitas.log'
function Anotar([string]$texto) { Add-Content -Path $log -Encoding UTF8 -Value ((Get-Date -Format 's') + ' ' + $texto) }

# ── trava: uma visita por vez. Trava de processo morto é lixo.
$trava = Join-Path $estado 'visita.trava'
if (Test-Path $trava) {
  $dono = (Get-Content $trava -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($dono -and (Get-Process -Id ([int]$dono) -ErrorAction SilentlyContinue)) { Anotar "pulada ($Motivo): visita $dono em andamento"; exit 0 }
  Remove-Item $trava -Force
}
Set-Content -Path $trava -Value $PID -Encoding ASCII

try {
  $id = Get-Date -Format 'yyyy-MM-dd-HHmm'
  $registro = Join-Path $actions "visitas\$id.md"
  if (Test-Path $registro) { $id = $id + '-' + (Get-Date -Format 'ss'); $registro = Join-Path $actions "visitas\$id.md" }
  $roteiro = Get-Content (Join-Path $PSScriptRoot 'omni-actions-visita.md') -Raw -Encoding UTF8
  $roteiro = $roteiro.Replace('{{MOTIVO}}', $Motivo).Replace('{{VISITA}}', $id).Replace('{{HOJE}}', (Get-Date -Format 'dd/MM/yyyy'))
  $roteiro = $roteiro.Replace('{{ACTIONS}}', (Join-Path $env:USERPROFILE 'Documents\Actions')).Replace('{{MAOS}}', (Join-Path $PSScriptRoot 'omni-actions.mjs'))
  if ($Raiz) { $roteiro = "VISITA A SECO: trabalhe só em $actions (cópia). Não use avisar nem risco.`n`n" + $roteiro }
  $entrada = Join-Path $estado "entrada-$id.txt"
  $saida = Join-Path $estado "logs\saida-$id.json"
  $erros = Join-Path $estado "logs\erro-$id.txt"
  [System.IO.File]::WriteAllText($entrada, $roteiro, (New-Object System.Text.UTF8Encoding $false))

  $claude = if ($env:OMNI_CLAUDE_EXE) { $env:OMNI_CLAUDE_EXE } else { Join-Path $env:APPDATA 'npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe' }
  $permitidas = 'Read Glob Grep Edit Write Bash PowerShell WebSearch WebFetch'
  $proibidas = '"Bash(git push:*)" "Bash(gh:*)" "Bash(ssh:*)" "Bash(scp:*)" "Bash(npm publish:*)" "Bash(vercel:*)" "Bash(pm2:*)"'
  $argumentos = "-p --output-format json --allowedTools $permitidas --disallowedTools $proibidas --add-dir `"$actions`" --add-dir `"$omni`""

  $env:OMNI_VISITA_ID = $id
  if ($Raiz) { $env:OMNI_ACTIONS = $actions; $env:OMNI_VISITA_SECO = '1' }
  else { Remove-Item Env:OMNI_ACTIONS -ErrorAction SilentlyContinue; Remove-Item Env:OMNI_VISITA_SECO -ErrorAction SilentlyContinue }
  Anotar "início $id ($Motivo) em $actions"
  $p = Start-Process -FilePath $claude -ArgumentList $argumentos -WorkingDirectory $actions -WindowStyle Hidden -PassThru `
    -RedirectStandardInput $entrada -RedirectStandardOutput $saida -RedirectStandardError $erros
  $null = $p.Handle # guarda o handle: sem isso o ExitCode volta vazio
  $terminou = $p.WaitForExit($Minutos * 60 * 1000)
  if (-not $terminou) {
    & taskkill.exe /PID $p.Id /T /F | Out-Null
    Anotar "interrompida ${id}: passou de $Minutos min"
    $nota = "# Visita $id`n**Motivo:** $Motivo`n**Situação:** interrompida`n**Resumo:** passou do teto de $Minutos min e foi encerrada`n"
    if (Test-Path $registro) { Add-Content -Path $registro -Encoding UTF8 -Value "`n**Situação:** interrompida (passou de $Minutos min)" }
    else { [System.IO.File]::WriteAllText($registro, $nota, (New-Object System.Text.UTF8Encoding $false)) }
    exit 3
  }
  if (-not (Test-Path $registro)) {
    # a sessão terminou sem registro: o registro diz isso, em vez de a tela mostrar a visita de ontem
    $fim = ''
    try { $fim = ((Get-Content $saida -Raw -Encoding UTF8) | ConvertFrom-Json).result } catch { }
    if (-not $fim) { $fim = 'a sessão terminou sem registro (ver logs em %APPDATA%\omni\actions\logs)' }
    $fim = ($fim -replace '[\r\n]+', ' ')
    if ($fim.Length -gt 300) { $fim = $fim.Substring(0, 300) }
    $nota = "# Visita $id`n**Motivo:** $Motivo`n**Situação:** sem registro`n**Resumo:** $fim`n"
    [System.IO.File]::WriteAllText($registro, $nota, (New-Object System.Text.UTF8Encoding $false))
  }
  Anotar "fim $id (exit $($p.ExitCode))"
  Remove-Item $entrada -Force -ErrorAction SilentlyContinue
} finally {
  Remove-Item $trava -Force -ErrorAction SilentlyContinue
}
