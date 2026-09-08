param(
    [Parameter(Mandatory = $true)]
    [string]$ReportPath
)

$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskReport = [IO.Path]::GetFullPath($ReportPath)
$taskReportsRoot = [IO.Path]::GetFullPath((Join-Path $taskRoot 'out\implementation'))
if (-not $taskReport.StartsWith($taskReportsRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Report path must remain below out\\implementation.' }
$taskStartup = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
$taskLinkPath = Join-Path $taskStartup 'Omni Runtime.lnk'
$taskShell = New-Object -ComObject WScript.Shell
$taskLink = $taskShell.CreateShortcut($taskLinkPath)
$taskLink.TargetPath = 'powershell.exe'
$taskLink.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $PSScriptRoot 'start-user-omni-runtime.ps1')`""
$taskLink.WorkingDirectory = $taskRoot
$taskLink.Description = 'Inicia o PostgreSQL dedicado e o broker local seguro do Omni.'
$taskLink.Save()
[pscustomobject]@{ schemaVersion = 1; kind = 'omni-user-startup'; status = 'installed'; startupLink = $taskLinkPath; starts = @('OmniPostgreSQL5433', 'OmniAccessBroker'); credentialStoredInStartup = $false; secretEmitted = $false; installedAt = [DateTimeOffset]::UtcNow.ToString('o') } | ConvertTo-Json -Compress | Set-Content -LiteralPath $taskReport -Encoding utf8
Get-Content -Raw -LiteralPath $taskReport
