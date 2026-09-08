param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^S-1-5-(?:\d+-){1,14}\d+$')]
    [string]$AllowedClientSid,
    [Parameter(Mandatory = $true)]
    [string]$ReportPath
)

$ErrorActionPreference = 'Stop'
Write-Host 'Autentique-se como GR\dados nesta janela. A senha nao sera exibida nem gravada.'
$taskCredential = Get-Credential -UserName 'GR\dados' -Message 'Credencial Windows para migrar o broker local do Omni'
if ($null -eq $taskCredential) { throw 'Administrator authentication was cancelled.' }
$taskElevator = Join-Path $PSScriptRoot 'elevate-install-omni-access-broker-service.ps1'
$taskArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $taskElevator, '-AllowedClientSid', $AllowedClientSid, '-ReportPath', $ReportPath)
$taskProcess = Start-Process -FilePath 'powershell.exe' -Credential $taskCredential -LoadUserProfile -ArgumentList $taskArgs -Wait -PassThru
if ($taskProcess.ExitCode -ne 0) { throw "Broker migration exited with code $($taskProcess.ExitCode)." }
Write-Host 'Migracao concluida. Esta janela pode ser fechada.'
