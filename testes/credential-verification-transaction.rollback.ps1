param(
    [ValidateRange(1024,65535)][int]$PostgreSqlPort = 5433,
    [string]$RuntimeCredentialTarget = 'Omni/PostgreSQL/dedicated-5433/access-broker/v1',
    [string]$ProtectedCredentialFile = ''
)
# Explicit diagnostic: synthetic SQL only; whole write transaction ROLLBACKs.
# Uses the trusted broker's bootstrap internally; emits no secret or provider request.
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskPsql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
. (Join-Path $taskRoot 'scripts/omni-credential-verification.ps1')
$taskTokens = $null; $taskErrors = $null
$taskAst = [Management.Automation.Language.Parser]::ParseFile((Join-Path $taskRoot 'scripts/omni-access-broker.ps1'), [ref]$taskTokens, [ref]$taskErrors)
if ($taskErrors.Count -ne 0) { throw 'Broker parse failed.' }
# Load its native credential reader, never its server/startup/report loop.
$taskAddType = $taskAst.Find({ param($node) $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Add-Type' }, $true)
. ([scriptblock]::Create($taskAddType.Extent.Text))
foreach ($taskFunction in $taskAst.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $true)) {
    . ([scriptblock]::Create($taskFunction.Extent.Text))
    if ($taskFunction.Name -eq 'Invoke-BrokerQuery') { . ([scriptblock]::Create(($taskFunction.Extent.Text -replace '^function Invoke-BrokerQuery', 'function Invoke-RollbackDiagnosticQuery'))) }
}
$script:taskCapturedQuery = ''
function Invoke-BrokerQuery([string]$Query) {
    $script:taskCapturedQuery = $Query
    return '{"outcome":"recorded","credential":{"credentialId":"probe","version":1,"providerRef":"vercel","accountRef":"synthetic","environmentRef":"test","secretRef":"credential-ref:windows-synthetic","expiresAt":null,"status":"active"}}'
}
function Get-LatestBrokerCredential([string]$CredentialId) { return $null }
function Set-OwnerCredentialSecret([string]$Target, [string]$UserName, [string]$Token) { }
function Remove-OwnerCredentialSecret([string]$Target) { throw 'Diagnostic must never mutate the vault.' }
function Invoke-CredentialVerification($Registration) { return New-CredentialVerification 'authenticated' 'synthetic-transaction-test' }
$taskId = 'omni-rollback-probe-' + [guid]::NewGuid().ToString('N')
$taskInput = @{ credentialId = $taskId; providerRef = 'vercel'; accountRef = 'synthetic'; environmentRef = 'test'; token = '{"kind":"token","token":"synthetic-never-network"}'; expiresAt = $null; renewalMode = 'none' }
$taskEncoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($taskInput | ConvertTo-Json -Compress)))
$taskCapture = Invoke-Request (@{ operation = 'credential.register-verified'; registrationBase64 = $taskEncoded; expectedVersion = $null } | ConvertTo-Json -Compress)
if (-not $taskCapture.ok -or -not $script:taskCapturedQuery.StartsWith('BEGIN;') -or ([regex]::Matches($script:taskCapturedQuery, 'COMMIT;')).Count -ne 1) { throw 'Diagnostic capture failed.' }
$taskRollbackQuery = $script:taskCapturedQuery.Replace('COMMIT;', 'ROLLBACK;')
$taskCreationSql = $script:taskCapturedQuery
$taskResult = (Invoke-RollbackDiagnosticQuery $taskRollbackQuery) | ConvertFrom-Json -ErrorAction Stop
if ($taskResult.outcome -ne 'recorded' -or $taskResult.credential.status -ne 'active' -or $taskResult.credential.expiryKind -ne 'unknown' -or $null -eq $taskResult.credential.lastSuccessAt) { throw 'Rollback transaction verification failed.' }
# Reuse the exact same version, applying an owner's newly supplied expiry and a second audit observation.
# Match the Desktop contract's ISO millisecond precision; .NET ticks exceed PostgreSQL microseconds.
$taskOwnerExpiry = [DateTimeOffset]::UtcNow.AddDays(90).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")
$taskReuseStart = [DateTimeOffset]::UtcNow.ToString('o')
$taskReuseVerification = New-CredentialVerification 'authenticated' 'synthetic-transaction-test'
$null = Save-BrokerCredentialVerification $taskResult.credential $taskReuseStart $taskReuseVerification 1 $taskOwnerExpiry
$taskReuseSql = $script:taskCapturedQuery.Replace('BEGIN;', '').Replace('SET LOCAL ROLE omni_access_admin;', '').Replace('COMMIT;', '')
$taskOpenCreation = $taskCreationSql.Replace("SELECT current_setting('omni.credential_result');", '').Replace('COMMIT;', '')
$taskCombinedSql = $taskOpenCreation + "`n" + $taskReuseSql + "`nROLLBACK;"
$taskReused = (Invoke-RollbackDiagnosticQuery $taskCombinedSql) | ConvertFrom-Json -ErrorAction Stop
if ($taskReused.outcome -ne 'recorded' -or $taskReused.credential.status -ne 'active' -or $taskReused.credential.expiryKind -ne 'known' -or [long]$taskReused.credential.version -ne 1 -or [long]$taskReused.credential.revision -ne 3 -or [DateTimeOffset]::Parse([string]$taskReused.credential.expiresAt) -ne [DateTimeOffset]::Parse($taskOwnerExpiry)) {
    $taskSafeDiagnostic = @{ outcome = $taskReused.outcome; status = $taskReused.credential.status; expiryKind = $taskReused.credential.expiryKind; version = $taskReused.credential.version; revision = $taskReused.credential.revision; actualExpiry = $taskReused.credential.expiresAt; expectedExpiry = $taskOwnerExpiry } | ConvertTo-Json -Compress
    throw "Rollback duplicate expiry verification failed: $taskSafeDiagnostic"
}
$taskRemaining = Invoke-RollbackDiagnosticQuery "BEGIN; SET LOCAL ROLE omni_access_admin; SELECT (SELECT count(*) FROM access.credential_versions WHERE owner_id = identity.owner_id() AND credential_id = '$taskId') + (SELECT count(*) FROM audit.credential_events WHERE owner_id = identity.owner_id() AND credential_id = '$taskId'); COMMIT;"
if ($taskRemaining -ne '0') { throw 'Rollback diagnostic left synthetic records.' }
Write-Output 'Rollback diagnostic passed: verified creation activated with audit; duplicate reused version and updated expiry with audit; zero credentials/events persisted; vault untouched.'
