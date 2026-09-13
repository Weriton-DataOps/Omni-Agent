$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $taskRoot 'scripts/omni-credential-verification.ps1')
# Import function definitions only: no server, process, credential read, database, or network.
$taskTokens = $null; $taskErrors = $null
$taskAst = [Management.Automation.Language.Parser]::ParseFile((Join-Path $taskRoot 'scripts/omni-access-broker.ps1'), [ref]$taskTokens, [ref]$taskErrors)
if ($taskErrors.Count -ne 0) { throw 'Broker script parse failed.' }
foreach ($taskFunction in $taskAst.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $true)) {
    . ([scriptblock]::Create($taskFunction.Extent.Text))
}
$script:taskChecks = 0
function Assert-Check([bool]$Value, [string]$Label) { if (-not $Value) { throw "Failed: $Label" }; $script:taskChecks++ }
$script:taskOrder = New-Object 'System.Collections.Generic.List[string]'
$script:taskLatest = $null
$script:taskProviderOutcome = 'authenticated'
$script:taskSavedQuery = ''
$script:taskQueryConflict = $false
function Get-LatestBrokerCredential([string]$CredentialId) { $script:taskOrder.Add('lookup'); return $script:taskLatest }
function Get-OwnerCredentialSecret([string]$SecretRef) { return '{"kind":"token","token":"synthetic-value-never-real"}' }
function Set-OwnerCredentialSecret([string]$Target, [string]$UserName, [string]$Token) { $script:taskOrder.Add('vault-write') }
function Remove-OwnerCredentialSecret([string]$Target) { $script:taskOrder.Add('vault-cleanup') }
function Invoke-CredentialHttpProbe([string]$Provider, [string]$Token) { $script:taskOrder.Add('remote-test'); return @{ outcome = $script:taskProviderOutcome } }
function Invoke-BrokerQuery([string]$Query) {
    $script:taskOrder.Add('database')
    $script:taskSavedQuery = $Query
    if ($script:taskQueryConflict) { return '{"outcome":"conflict"}' }
    return '{"outcome":"recorded","credential":{"credentialId":"vercel-test","version":1,"providerRef":"vercel","accountRef":"pessoal","environmentRef":"unspecified","secretRef":"credential-ref:windows-fake","expiresAt":null,"status":"active"}}'
}
$taskInput = [ordered]@{ credentialId = 'vercel-test'; providerRef = 'vercel'; accountRef = 'pessoal'; environmentRef = 'unspecified'; token = '{"kind":"token","token":"synthetic-value-never-real"}'; expiresAt = $null; renewalMode = 'rotate' }
function Request-Test([string]$Operation, $Expected = $null) {
    $taskEncoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($taskInput | ConvertTo-Json -Compress)))
    return Invoke-Request (@{ operation = $Operation; registrationBase64 = $taskEncoded; expectedVersion = $Expected } | ConvertTo-Json -Compress)
}
$taskResult = Request-Test 'credential.verify'
Assert-Check ($taskResult.ok -and $taskResult.verification.outcome -eq 'authenticated') 'test returns provider authentication'
Assert-Check (($script:taskOrder -join ',') -eq 'remote-test') 'test does not store'
$script:taskOrder.Clear()
$taskResult = Request-Test 'credential.register-verified'
Assert-Check ($taskResult.ok -and $taskResult.disposition -eq 'created' -and $taskResult.credential.status -eq 'active') 'verified registration succeeds'
Assert-Check (($script:taskOrder -join ',') -eq 'lookup,remote-test,vault-write,database') 'authenticate before storage'
Assert-Check (-not $script:taskSavedQuery.Contains('synthetic-value-never-real')) 'secret never enters SQL'
Assert-Check ($script:taskSavedQuery.Contains('record_credential_observation') -and $script:taskSavedQuery.Contains('pg_advisory_xact_lock')) 'atomic append observation and concurrent version guard'
Assert-Check (-not (($taskResult | ConvertTo-Json -Depth 5).Contains('synthetic-value-never-real'))) 'secret never in result'
$script:taskOrder.Clear(); $script:taskProviderOutcome = 'invalid-token'
$taskResult = Request-Test 'credential.register-verified'
Assert-Check (-not $taskResult.ok -and $taskResult.code -eq 'credential-verification-failed') 'invalid authentication blocks registration'
Assert-Check (($script:taskOrder -join ',') -eq 'lookup,remote-test') 'rejected credentials never stored'
$script:taskOrder.Clear(); $script:taskProviderOutcome = 'authenticated'
$script:taskLatest = [pscustomobject]@{ credentialId = 'vercel-test'; version = 1; revision = 1; providerRef = 'vercel'; accountRef = 'pessoal'; environmentRef = 'unspecified'; secretRef = 'credential-ref:windows-fake'; status = 'unverified'; expiresAt = $null }
$taskResult = Request-Test 'credential.register-verified'
Assert-Check (-not $taskResult.ok -and $taskResult.code -eq 'credential-version-conflict') 'stale prepare blocks save'
Assert-Check (($script:taskOrder -join ',') -eq 'lookup') 'stale prepare has no remote or vault effect'
$script:taskOrder.Clear()
$taskResult = Request-Test 'credential.register-verified' 1
Assert-Check ($taskResult.ok -and $taskResult.disposition -eq 'reused') 'same credential and secret reuse version'
Assert-Check (($script:taskOrder -join ',') -eq 'lookup,remote-test,database') 'duplicate does not write vault'
Assert-Check (-not $script:taskSavedQuery.Contains('SET expires_at')) 'unspecified duplicate expiry preserves known metadata'
$taskInput.expiresAt = [DateTimeOffset]::UtcNow.AddDays(90).ToString('o')
$taskResult = Request-Test 'credential.register-verified' 1
Assert-Check ($taskResult.ok -and $script:taskSavedQuery.Contains('SET expires_at') -and $script:taskSavedQuery.Contains("expiry_kind = 'known'")) 'supplied duplicate expiry updates inside observed transaction'
$taskInput.expiresAt = $null
foreach ($taskStatus in @('invalid', 'expired', 'revoked', 'disabled', 'replaced')) {
    $script:taskLatest.status = $taskStatus
    $script:taskOrder.Clear()
    $taskResult = Request-Test 'credential.register-verified' 1
    Assert-Check (-not $taskResult.ok -and $taskResult.code -eq 'credential-blocked' -and -not $script:taskOrder.Contains('vault-write') -and -not $script:taskOrder.Contains('database')) "terminal $taskStatus is not reactivated"
}
$script:taskOrder.Clear(); $script:taskLatest = $null; $script:taskQueryConflict = $true
$taskResult = Request-Test 'credential.register-verified'
Assert-Check (-not $taskResult.ok -and $taskResult.code -eq 'credential-version-conflict') 'concurrent insert reports conflict'
Assert-Check (($script:taskOrder -join ',') -eq 'lookup,remote-test,vault-write,database,lookup,vault-cleanup') 'conflict reconciles then cleans only newly-created vault item'
$script:taskQueryConflict = $false
$taskInput.providerRef = 'unknown-provider'; $script:taskOrder.Clear()
$taskResult = Request-Test 'credential.verify'
Assert-Check ($taskResult.ok -and $taskResult.verification.outcome -eq 'unsupported') 'unsupported provider is explicit'
Assert-Check ($script:taskOrder.Count -eq 0) 'unsupported provider has no network effect'
Assert-Check (Test-CredentialPayloadEqual '{"kind":"token","token":"synthetic"}' '{"token":"synthetic","kind":"token"}') 'JSON order does not create new credential version'
Assert-Check (-not (Test-CredentialPayloadEqual '{"kind":"token","token":"old"}' '{"kind":"token","token":"new"}')) 'different values are distinct'
$taskInput.token = '{"kind":"token","token":"' + ('x' * 2401) + '"}'
$taskResult = Request-Test 'credential.verify'
Assert-Check (-not $taskResult.ok) 'vault byte limit enforced before network'
Write-Output "Credential broker verification: $script:taskChecks security and lifecycle checks passed (synthetic fixtures only)."
