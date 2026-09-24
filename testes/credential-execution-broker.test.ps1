$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $taskRoot 'scripts/omni-credential-execution.ps1')
$taskTokens = $null; $taskErrors = $null
$taskAst = [Management.Automation.Language.Parser]::ParseFile((Join-Path $taskRoot 'scripts/omni-access-broker.ps1'),[ref]$taskTokens,[ref]$taskErrors)
if ($taskErrors.Count) { throw 'Broker parse failure.' }
foreach ($taskFunction in $taskAst.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]},$true)) { . ([scriptblock]::Create($taskFunction.Extent.Text)) }
$script:checks = 0; $script:executions = 0; $script:reads = 0
function Assert-Check([bool]$Value,[string]$Name) { if (-not $Value) { throw "Failed: $Name" }; $script:checks++ }
function Invoke-CredentialExecution($Registration,$Operation) { $script:executions++; return @{outcome='completed';operation=$Operation.kind;data=@()} }
function Invoke-CredentialSshExecution($Ssh,$Db,$Operation,[string]$Mode) { $script:executions++; return @{outcome='completed';operation=$Operation.kind;data=@()} }
$script:stored = [pscustomobject]@{credentialId='fixture';version=2;status='active';expiresAt=$null;secretRef='credential-ref:windows-fixture'}
function Get-LatestBrokerCredential([string]$Id) { return $script:stored }
function Get-OwnerCredentialSecret([string]$Ref) { $script:reads++; return '{"kind":"database","password":"SYNTHETIC-ONLY"}' }
$taskAction = @{kind='postgres.catalog';page=0}
function Send-Execution($Source,$Action) { return Invoke-Request (@{operation='credential.execute';source=$Source;action=$Action}|ConvertTo-Json -Compress -Depth 7) }
$taskSource = @{credentialId='fixture';version=2}
Assert-Check ((Send-Execution $taskSource $taskAction).result.outcome -eq 'completed') 'stored version executes'
foreach ($taskStatus in @('revoked','disabled','expired','invalid','replaced','suspect')) {
    $script:stored.status=$taskStatus
    Assert-Check (-not (Send-Execution $taskSource $taskAction).ok) "blocks $taskStatus"
}
$script:stored.status='active'
Assert-Check (-not (Send-Execution @{credentialId='fixture';version=1} $taskAction).ok) 'replaced version blocked'
$script:stored.expiresAt=[DateTimeOffset]::UtcNow.AddMinutes(-1).ToString('o')
Assert-Check (-not (Send-Execution $taskSource $taskAction).ok) 'expiry blocked'
$script:stored.expiresAt=$null
$taskReads=$script:reads
foreach ($taskInvalid in @(@{kind='shell';command='whoami'},@{kind='postgres.catalog';page=0;sql='DROP TABLE x'},@{kind='postgres.freshness';schema='public';table='x; SELECT 1';column='created_at'})) {
    Assert-Check (-not (Send-Execution $taskSource $taskInvalid).ok) 'operation rejected before secret read'
}
Assert-Check ($script:reads -eq $taskReads) 'no secret resolution on invalid operation'
$taskResult=Send-Execution @{ssh=$taskSource;database=$taskSource;mode='sudo-postgres'} $taskAction
Assert-Check ($taskResult.ok -and $taskResult.result.outcome -eq 'completed') 'composite SSH and DB resolve privately'
Assert-Check (-not (($taskResult|ConvertTo-Json -Depth 5).Contains('SYNTHETIC'))) 'no raw credential in receipt'
$taskSql=Get-CredentialExecutionSql ([pscustomobject]@{kind='postgres.freshness';schema='analytics';table='facts';column='updated_at'})
Assert-Check ($taskSql.Contains('a.atttypid IN (1082,1114,1184)') -and $taskSql.Contains('pg_catalog.max')) 'typed temporal column only'
Assert-Check ($script:executions -eq 2) 'only authorized operations executed'
Write-Output "Private execution broker: $script:checks checks passed; synthetic only."
