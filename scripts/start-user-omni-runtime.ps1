$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskLogDir = Join-Path $env:APPDATA 'omni\logs'
$taskLog = Join-Path $taskLogDir 'runtime-logon.log'
$taskBrokerErrLog = Join-Path $taskLogDir 'runtime-broker.err.log'
$taskPipeName = 'omni-access-broker-v8'

function Write-OmniRuntimeLog([string]$Message) {
    try {
        New-Item -ItemType Directory -Force -Path $taskLogDir | Out-Null
        if ((Test-Path -LiteralPath $taskLog) -and ((Get-Item -LiteralPath $taskLog).Length -gt 262144)) {
            Move-Item -LiteralPath $taskLog -Destination "$taskLog.old" -Force
        }
        Add-Content -LiteralPath $taskLog -Value ('{0} pid={1} {2}' -f (Get-Date).ToString('o'), $PID, $Message) -Encoding UTF8
    } catch { }
}

function Test-OmniBrokerPipe {
    return $null -ne (Get-ChildItem -Path '\\.\pipe\' | Where-Object { $_.Name -eq $taskPipeName })
}

Write-OmniRuntimeLog 'inicio'
try {
    & (Join-Path $PSScriptRoot 'start-dedicated-omni-postgresql.ps1')
    Write-OmniRuntimeLog 'postgresql dedicado: ok'
    if (-not (Test-OmniBrokerPipe)) {
        $taskBrokerReport = Join-Path $taskRoot 'out\implementation\omni-access-broker-logon.json'
        $taskArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'start-user-omni-access-broker.ps1'), '-AllowedClientSid', 'S-1-5-21-3586522630-308224701-1554931283-4954', '-ReportPath', $taskBrokerReport)
        Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList $taskArgs -RedirectStandardError $taskBrokerErrLog | Out-Null
        Write-OmniRuntimeLog 'broker: lancado'
        $taskWaited = 0
        while ($taskWaited -lt 20 -and -not (Test-OmniBrokerPipe)) { Start-Sleep -Seconds 1; $taskWaited++ }
        if (Test-OmniBrokerPipe) { Write-OmniRuntimeLog "broker: pipe disponivel apos ${taskWaited}s" }
        else { Write-OmniRuntimeLog "broker: pipe NAO apareceu em ${taskWaited}s (ver $taskBrokerErrLog)" }
    } else {
        Write-OmniRuntimeLog 'broker: pipe ja existia'
    }
    Write-OmniRuntimeLog 'fim'
} catch {
    Write-OmniRuntimeLog ('ERRO: ' + $_.Exception.Message)
    throw
}
