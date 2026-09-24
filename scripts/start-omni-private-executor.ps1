$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskPipeName = 'omni-private-executor-v1'
if (Get-ChildItem -Path '\\.\pipe\' | Where-Object { $_.Name -eq $taskPipeName }) { exit 0 }
$taskSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$taskReport = Join-Path $taskRoot 'out\implementation\omni-private-executor.json'
[IO.Directory]::CreateDirectory((Split-Path -Parent $taskReport)) | Out-Null
# Separate broker: a slow SSH operation never blocks memory or chat inventory requests.
$taskArguments = @('-NoProfile','-ExecutionPolicy','Bypass','-File', ('"' + (Join-Path $PSScriptRoot 'omni-access-broker.ps1') + '"'), '-PipeName', $taskPipeName, '-AllowedClientSid', $taskSid, '-ReportPath', ('"' + $taskReport + '"'))
Start-Process -FilePath 'powershell.exe' -ArgumentList $taskArguments -WindowStyle Hidden | Out-Null
