param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^S-1-5-(?:\d+-){1,14}\d+$')]
    [string]$AllowedClientSid,
    [ValidatePattern('^[a-zA-Z0-9._-]{1,120}$')]
    [string]$PipeName = 'omni-access-broker-v2',
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,255}$')]
    [string]$RuntimeCredentialTarget = 'Omni/PostgreSQL/local/access-broker/v1',
    [Parameter(Mandatory = $true)]
    [string]$ReportPath
)

$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskReport = [IO.Path]::GetFullPath($ReportPath)
$taskReportsRoot = [IO.Path]::GetFullPath((Join-Path $taskRoot 'out\implementation'))
if (-not $taskReport.StartsWith($taskReportsRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Report path must remain below out\\implementation.' }
$taskInstallRoot = Join-Path $env:ProgramData 'Omni\access-broker'
$taskBroker = Join-Path $taskInstallRoot 'omni-access-broker.ps1'
$taskCredential = Join-Path $taskInstallRoot 'postgresql-local-access-broker.v1.dpapi'
$taskStatus = Join-Path $taskInstallRoot 'broker-status.json'

[IO.Directory]::CreateDirectory($taskInstallRoot) | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'omni-access-broker.ps1') -Destination $taskBroker -Force
& (Join-Path $PSScriptRoot 'protect-omni-access-broker-credential.ps1') -RuntimeCredentialTarget $RuntimeCredentialTarget -OutputFile $taskCredential | Out-Null

$taskAction = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$taskBroker`" -PipeName $PipeName -AllowedClientSid $AllowedClientSid -ProtectedCredentialFile `"$taskCredential`" -ReportPath `"$taskStatus`" -InstalledService"
& schtasks.exe /Create /TN 'OmniAccessBroker' /TR $taskAction /SC ONSTART /RU 'SYSTEM' /RL HIGHEST /F | Out-Null
& schtasks.exe /Run /TN 'OmniAccessBroker' | Out-Null

$taskDeadline = [DateTime]::UtcNow.AddSeconds(30)
do {
    Start-Sleep -Milliseconds 500
    if (Test-Path -LiteralPath $taskStatus) {
        $taskBrokerStatus = Get-Content -Raw -LiteralPath $taskStatus | ConvertFrom-Json
        if ($taskBrokerStatus.status -eq 'starting' -and $taskBrokerStatus.secretEmitted -eq $false) {
            [pscustomobject]@{ schemaVersion = 1; kind = 'omni-access-broker-install'; status = 'installed-and-started'; taskName = 'OmniAccessBroker'; pipe = $PipeName; credentialProtection = 'DPAPI-LocalMachine'; secretEmitted = $false; installedAt = [DateTimeOffset]::UtcNow.ToString('o') } | ConvertTo-Json -Compress | Set-Content -LiteralPath $taskReport -Encoding utf8
            Get-Content -Raw -LiteralPath $taskReport
            exit 0
        }
    }
} while ([DateTime]::UtcNow -lt $taskDeadline)
throw 'Scheduled broker did not produce a valid sanitized status receipt.'
