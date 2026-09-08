param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^S-1-5-(?:\d+-){1,14}\d+$')]
    [string]$AllowedClientSid,
    [Parameter(Mandatory = $true)]
    [string]$ReportPath
)

$ErrorActionPreference = 'Stop'
$taskInstaller = Join-Path $PSScriptRoot 'start-install-omni-access-broker-service.ps1'
$taskArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $taskInstaller, '-AllowedClientSid', $AllowedClientSid, '-ReportPath', $ReportPath)
$taskProcess = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $taskArgs -Wait -PassThru
exit $taskProcess.ExitCode
