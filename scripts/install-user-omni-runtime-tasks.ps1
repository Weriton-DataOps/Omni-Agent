param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^S-1-5-(?:\d+-){1,14}\d+$')]
    [string]$AllowedClientSid,
    [Parameter(Mandatory = $true)]
    [string]$ReportPath
)

# Interactive logon tasks use the signed-in user's token, so no Windows password is stored in Task Scheduler.
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskReport = [IO.Path]::GetFullPath($ReportPath)
$taskReportsRoot = [IO.Path]::GetFullPath((Join-Path $taskRoot 'out\implementation'))
if (-not $taskReport.StartsWith($taskReportsRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Report path must remain below out\\implementation.' }
$taskIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$taskAccount = $taskIdentity.Name
$taskPostgresScript = Join-Path $PSScriptRoot 'start-dedicated-omni-postgresql.ps1'
$taskBrokerScript = Join-Path $PSScriptRoot 'start-user-omni-access-broker.ps1'
$taskBrokerReport = Join-Path $taskRoot 'out\implementation\omni-access-broker-logon.json'
$taskPostgresAction = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$taskPostgresScript`""
$taskBrokerAction = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$taskBrokerScript`" -AllowedClientSid $AllowedClientSid -ReportPath `"$taskBrokerReport`""
& schtasks.exe /Create /TN 'OmniPostgreSQL5433' /TR $taskPostgresAction /SC ONLOGON /RU $taskAccount /IT /RL LIMITED /F | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not register the dedicated PostgreSQL logon task.' }
& schtasks.exe /Create /TN 'OmniAccessBroker' /TR $taskBrokerAction /SC ONLOGON /RU $taskAccount /IT /RL LIMITED /F | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not register the broker logon task.' }
[pscustomobject]@{ schemaVersion = 1; kind = 'omni-user-runtime-tasks'; status = 'registered'; account = $taskAccount; tasks = @('OmniPostgreSQL5433', 'OmniAccessBroker'); credentialStoredInTaskScheduler = $false; secretEmitted = $false; registeredAt = [DateTimeOffset]::UtcNow.ToString('o') } | ConvertTo-Json -Compress | Set-Content -LiteralPath $taskReport -Encoding utf8
Get-Content -Raw -LiteralPath $taskReport
