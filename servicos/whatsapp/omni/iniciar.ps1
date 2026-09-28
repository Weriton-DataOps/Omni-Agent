# Omni — sobe o serviço WhatsApp em segundo plano, só na própria máquina (127.0.0.1:2785).
# Idempotente: se já houver instância escutando na porta, não faz nada.
# Código no repositório; configuração, dados, chaves e logs em %APPDATA%\omni\whatsapp.

$ErrorActionPreference = 'Stop'
$servico = Split-Path -Parent $PSScriptRoot
$main = Join-Path $servico 'dist\main.js'
$run = Join-Path $env:APPDATA 'omni\whatsapp'
$logs = Join-Path $run 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null

$ouvindo = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 2785 -State Listen -ErrorAction SilentlyContinue
if ($ouvindo) {
    Add-Content -Encoding utf8 (Join-Path $logs 'iniciar.log') ((Get-Date -Format s) + ' já em execução (PID ' + $ouvindo[0].OwningProcess + '); nada a fazer')
    exit 0
}
if (-not (Test-Path $main)) {
    Add-Content -Encoding utf8 (Join-Path $logs 'iniciar.log') ((Get-Date -Format s) + ' dist\main.js ausente; rode npm run build em ' + $servico)
    exit 1
}

# Guarda o log anterior em vez de sobrescrever.
foreach ($nome in 'servico.out.log', 'servico.err.log') {
    $atual = Join-Path $logs $nome
    if (Test-Path $atual) { Move-Item -Force $atual ($atual + '.anterior') }
}

$node = (Get-Command node).Source
$argumento = '"' + $main + '"'
$p = Start-Process -FilePath $node -ArgumentList $argumento -WorkingDirectory $run -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logs 'servico.out.log') -RedirectStandardError (Join-Path $logs 'servico.err.log') -PassThru
$p.Id | Set-Content -Encoding ascii (Join-Path $run 'servico.pid')
Add-Content -Encoding utf8 (Join-Path $logs 'iniciar.log') ((Get-Date -Format s) + ' iniciado PID ' + $p.Id)
