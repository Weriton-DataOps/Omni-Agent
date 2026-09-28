# Omni — sobe o serviço WhatsApp (127.0.0.1:2785) e a ponte com as sessões do Claude, em segundo plano.
# Idempotente: não abre segunda instância de nenhum dos dois.
# Código no repositório; configuração, dados e logs em %APPDATA%\omni\whatsapp; chaves no cofre do Windows.

$ErrorActionPreference = 'Stop'
$omni = $PSScriptRoot
$servico = Split-Path -Parent $omni
$main = Join-Path $servico 'dist\main.js'
$run = Join-Path $env:APPDATA 'omni\whatsapp'
$logs = Join-Path $run 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$registro = Join-Path $logs 'iniciar.log'
function Anotar([string]$texto) { Add-Content -Encoding utf8 $registro ((Get-Date -Format s) + ' ' + $texto) }
$node = (Get-Command node).Source

# 1) Serviço
$ouvindo = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 2785 -State Listen -ErrorAction SilentlyContinue
if ($ouvindo) {
    Anotar ('serviço já em execução (PID ' + $ouvindo[0].OwningProcess + ')')
} elseif (-not (Test-Path $main)) {
    Anotar ('dist\main.js ausente; rode npm run build em ' + $servico)
    exit 1
} else {
    foreach ($nome in 'servico.out.log', 'servico.err.log') {
        $atual = Join-Path $logs $nome
        if (Test-Path $atual) { Move-Item -Force $atual ($atual + '.anterior') }
    }
    $p = Start-Process -FilePath $node -ArgumentList ('"' + $main + '"') -WorkingDirectory $run -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logs 'servico.out.log') -RedirectStandardError (Join-Path $logs 'servico.err.log') -PassThru
    $p.Id | Set-Content -Encoding ascii (Join-Path $run 'servico.pid')
    Anotar ('serviço iniciado PID ' + $p.Id)
}

# Espera o serviço responder antes da ponte.
$pronto = $false
for ($i = 0; $i -lt 60 -and -not $pronto; $i++) {
    try { $pronto = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:2785/api/health').StatusCode -eq 200 } catch { Start-Sleep -Seconds 1 }
}
if (-not $pronto) { Anotar 'serviço não respondeu em 60 s; ponte não iniciada'; exit 1 }

# 2) Ponte (só com o bot pareado)
if (-not (Test-Path (Join-Path $run 'sessao-bot.id'))) { Anotar 'bot ainda não pareado; ponte não iniciada'; exit 0 }
$pidPonte = Join-Path $run 'ponte.pid'
if (Test-Path $pidPonte) {
    $vivo = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int](Get-Content $pidPonte)) -ErrorAction SilentlyContinue
    if ($vivo -and $vivo.CommandLine -like '*ponte.mjs*') { Anotar ('ponte já em execução (PID ' + $vivo.ProcessId + ')'); exit 0 }
}
$ponte = Join-Path $omni 'ponte.mjs'
$q = Start-Process -FilePath $node -ArgumentList ('"' + $ponte + '"') -WorkingDirectory $run -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logs 'ponte.out.log') -RedirectStandardError (Join-Path $logs 'ponte.err.log') -PassThru
$q.Id | Set-Content -Encoding ascii $pidPonte
Anotar ('ponte iniciada PID ' + $q.Id)
