$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'start-dedicated-omni-postgresql.ps1')
$taskPipeExists = Get-ChildItem -Path '\\.\pipe\' | Where-Object { $_.Name -eq 'omni-access-broker-v8' }
if ($null -eq $taskPipeExists) {
    $taskBrokerReport = Join-Path $taskRoot 'out\implementation\omni-access-broker-logon.json'
    $taskArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'start-user-omni-access-broker.ps1'), '-AllowedClientSid', 'S-1-5-21-3586522630-308224701-1554931283-4954', '-ReportPath', $taskBrokerReport)
    Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList $taskArgs | Out-Null
}
