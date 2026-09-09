param([switch]$FromStudio)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$taskDirectory = Join-Path $env:APPDATA 'omni\access'
$taskTarget = Join-Path $taskDirectory 'openai-realtime.dpapi'
if (Test-Path -LiteralPath $taskTarget) {
    [pscustomobject]@{ outcome = 'already-protected'; secretEmitted = $false } | ConvertTo-Json -Compress
    exit 0
}
if (-not $FromStudio) { throw 'Escolha explicitamente a importacao da credencial existente.' }
$taskSource = Join-Path $env:APPDATA 'overcore-studio\segredos.json'
$taskBytes = $null
try {
    $taskStore = [IO.File]::ReadAllText($taskSource) | ConvertFrom-Json
    $taskEntry = $taskStore.contas.openai
    $taskValue = if ($taskEntry -is [string]) { $taskEntry } else { [string]$taskEntry.valor }
    if ([string]::IsNullOrWhiteSpace($taskValue) -or $taskValue.StartsWith('gh:')) { throw 'Credencial OpenAI utilizavel nao encontrada.' }
    [IO.Directory]::CreateDirectory($taskDirectory) | Out-Null
    $taskSecurity = New-Object Security.AccessControl.DirectorySecurity
    $taskSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $taskSecurity.SetAccessRuleProtection($true, $false)
    $taskSecurity.SetOwner($taskSid)
    $taskSecurity.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($taskSid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
    [IO.Directory]::SetAccessControl($taskDirectory, $taskSecurity)
    $taskBytes = [Text.Encoding]::UTF8.GetBytes($taskValue)
    $taskCipher = [Security.Cryptography.ProtectedData]::Protect($taskBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    [IO.File]::WriteAllBytes($taskTarget, $taskCipher)
    [pscustomobject]@{ outcome = 'protected'; scope = 'CurrentUser'; secretEmitted = $false } | ConvertTo-Json -Compress
} finally {
    if ($null -ne $taskBytes) { [Array]::Clear($taskBytes, 0, $taskBytes.Length) }
    $taskValue = $null; $taskStore = $null; $taskEntry = $null
}
