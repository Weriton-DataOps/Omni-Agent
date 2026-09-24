# Trusted, closed adapters. No arbitrary SQL, shell, credentials or provider errors in the result.
function Resolve-ExecutionCredential($Source) {
    if ($null -eq $Source) { throw 'Missing source.' }
    if ($Source.PSObject.Properties.Name -contains 'registrationBase64') {
        if ($Source.PSObject.Properties.Name -contains 'credentialId') { throw 'Ambiguous source.' }
        return Read-VerifiedRegistration ([string]$Source.registrationBase64)
    }
    if ([string]$Source.credentialId -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$') { throw 'Invalid source.' }
    $taskStored = Get-LatestBrokerCredential ([string]$Source.credentialId)
    if ($null -eq $taskStored -or $taskStored.version -ne $Source.version -or $taskStored.status -notin @('active','unverified')) { throw 'Credential blocked or replaced.' }
    if ($null -ne $taskStored.expiresAt -and [DateTimeOffset]::Parse([string]$taskStored.expiresAt) -le [DateTimeOffset]::UtcNow) { throw 'Expired credential.' }
    return [pscustomobject]@{ token = Get-OwnerCredentialSecret $taskStored.secretRef; expiresAt = $taskStored.expiresAt }
}

function Invoke-CredentialSshExecution($SshRegistration, $DatabaseRegistration, $Operation, [string]$Mode) {
    $taskResult = @{ outcome = 'unavailable'; operation = [string]$Operation.kind; data = $null }
    $taskProcess = $null; $taskStart = $null
    try {
        if ($Mode -notin @('password','sudo-postgres')) { throw 'Invalid SSH database mode.' }
        $taskSql = Get-CredentialExecutionSql $Operation
        $taskInput = @{ ssh = ($SshRegistration.token | ConvertFrom-Json); database = ($DatabaseRegistration.token | ConvertFrom-Json); mode = $Mode; sql = $taskSql; operation = $Operation.kind } | ConvertTo-Json -Compress -Depth 6
        $taskStart = New-Object Diagnostics.ProcessStartInfo
        $taskStart.FileName = 'C:\Program Files\nodejs\node.exe'
        $taskWorker = Join-Path (Split-Path -Parent $PSScriptRoot) 'apps/omni-desktop/scripts/ssh-executor.mjs'
        $taskStart.Arguments = '"' + $taskWorker + '"'
        $taskStart.UseShellExecute = $false; $taskStart.CreateNoWindow = $true
        $taskStart.RedirectStandardInput = $true; $taskStart.RedirectStandardOutput = $true; $taskStart.RedirectStandardError = $true
        $taskStart.StandardOutputEncoding = [Text.Encoding]::UTF8
        # Do not permit inherited Node loaders or debugging to intercept the trusted private worker.
        foreach ($taskKey in @('NODE_OPTIONS','NODE_PATH')) { [void]$taskStart.Environment.Remove($taskKey) }
        $taskProcess = [Diagnostics.Process]::Start($taskStart)
        $taskOutputTask = $taskProcess.StandardOutput.ReadToEndAsync(); $taskErrorTask = $taskProcess.StandardError.ReadToEndAsync()
        # Windows PowerShell/.NET Framework has no StandardInputEncoding setter.
        $taskInputBytes = [Text.Encoding]::UTF8.GetBytes($taskInput)
        try { $taskProcess.StandardInput.BaseStream.Write($taskInputBytes,0,$taskInputBytes.Length); $taskProcess.StandardInput.BaseStream.Flush(); $taskProcess.StandardInput.Close() }
        finally { [Array]::Clear($taskInputBytes,0,$taskInputBytes.Length); $taskInput = $null }
        if (-not $taskProcess.WaitForExit(21000)) { $taskProcess.Kill(); $taskResult.outcome = 'timeout'; return $taskResult }
        $taskOutput = $taskOutputTask.GetAwaiter().GetResult(); $null = $taskErrorTask.GetAwaiter().GetResult()
        if ($taskProcess.ExitCode -ne 0 -or [Text.Encoding]::UTF8.GetByteCount($taskOutput) -gt 50000) { return $taskResult }
        $taskReceipt = $taskOutput | ConvertFrom-Json -ErrorAction Stop
        if ($taskReceipt.operation -ne $Operation.kind -or $taskReceipt.outcome -notin @('completed','unsupported','unavailable','timeout','denied','host-key-required')) { return $taskResult }
        return $taskReceipt
    } catch { return $taskResult }
    finally { if ($null -ne $taskProcess) { $taskProcess.Dispose() }; $taskInput = $null; $taskOutput = $null }
}

function Get-CredentialExecutionSql($Operation) {
    $taskNames = @($Operation.PSObject.Properties.Name)
    if ($Operation.kind -eq 'postgres.catalog') {
        if (@($taskNames | Where-Object { $_ -notin @('kind', 'page') }).Count -gt 0 -or $null -eq $Operation.page -or [string]$Operation.page -notmatch '^(?:[0-9]|[1-4][0-9])$') { throw 'Invalid operation.' }
        $taskOffset = [int]$Operation.page * 100
        return @"
SELECT COALESCE(json_agg(t), '[]'::json) FROM (
 SELECT n.nspname AS schema, c.relname AS table, a.attname AS column,
        pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
        a.atttypid IN (1082,1114,1184) AS temporal
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
 WHERE c.relkind IN ('r','p','m') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
 ORDER BY n.nspname,c.relname,a.attnum LIMIT 100 OFFSET $taskOffset
) t;
"@
    }
    if ($Operation.kind -ne 'postgres.freshness' -or $taskNames.Count -ne 4) { throw 'Unsupported operation.' }
    foreach ($taskName in @('schema','table','column')) {
        if ([string]$Operation.$taskName -cnotmatch '^[a-zA-Z_][a-zA-Z0-9_]{0,62}$') { throw 'Invalid identifier.' }
    }
    $taskSchema = [string]$Operation.schema; $taskTable = [string]$Operation.table; $taskColumn = [string]$Operation.column
    if ($taskSchema -in @('pg_catalog','information_schema') -or $taskSchema.StartsWith('pg_')) { throw 'System relation is outside scope.' }
    # No views/functions/expressions, only a real date/timestamp column in a table.
    return @"
DO `$private_check`$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
 WHERE n.nspname='$taskSchema' AND c.relname='$taskTable' AND c.relkind IN ('r','p','m') AND a.attname='$taskColumn' AND NOT a.attisdropped AND a.atttypid IN (1082,1114,1184))
 THEN RAISE EXCEPTION 'Unsupported relation or column'; END IF;
END `$private_check`$;
SELECT pg_catalog.json_build_object('latest',pg_catalog.max("$taskColumn"),'observedAt',pg_catalog.clock_timestamp()) FROM "$taskSchema"."$taskTable";
"@
}

function Invoke-CredentialExecution($Registration, $Operation) {
    $taskResult = @{ outcome = 'unavailable'; operation = [string]$Operation.kind; data = $null }
    $taskProcess = $null; $taskStart = $null; $taskPayload = $null
    try {
        $taskSql = Get-CredentialExecutionSql $Operation
        $taskPayload = [string]$Registration.token | ConvertFrom-Json -ErrorAction Stop
        if ($taskPayload.kind -ne 'database' -or $taskPayload.engine -notin @('postgresql','postgres','pg')) { $taskResult.outcome = 'unsupported'; return $taskResult }
        if ([string]$taskPayload.host -notmatch '^[a-zA-Z0-9][a-zA-Z0-9.:-]{0,252}$' -or [string]$taskPayload.database -notmatch '^[a-zA-Z0-9_][a-zA-Z0-9_.@$-]{0,127}$' -or [string]$taskPayload.username -notmatch '^[a-zA-Z0-9_][a-zA-Z0-9_.@$-]{0,127}$' -or [string]::IsNullOrWhiteSpace([string]$taskPayload.password)) { $taskResult.outcome = 'unsupported'; return $taskResult }
        $taskPort = 5432
        if ($taskPayload.port -and (-not [int]::TryParse([string]$taskPayload.port, [ref]$taskPort) -or $taskPort -lt 1 -or $taskPort -gt 65535)) { $taskResult.outcome = 'unsupported'; return $taskResult }
        $taskStart = New-Object Diagnostics.ProcessStartInfo
        $taskStart.FileName = $taskPsql
        $taskStart.UseShellExecute = $false; $taskStart.CreateNoWindow = $true
        $taskStart.RedirectStandardInput = $true; $taskStart.RedirectStandardOutput = $true; $taskStart.RedirectStandardError = $true
        $taskStart.StandardOutputEncoding = [Text.Encoding]::UTF8
        $taskStart.Arguments = '-X -w -q -A -t -v ON_ERROR_STOP=1'
        foreach ($taskKey in @($taskStart.Environment.Keys)) { if ($taskKey -match '^PG') { [void]$taskStart.Environment.Remove($taskKey) } }
        $taskStart.Environment['PGHOST'] = [string]$taskPayload.host
        $taskStart.Environment['PGPORT'] = [string]$taskPort
        $taskStart.Environment['PGDATABASE'] = [string]$taskPayload.database
        $taskStart.Environment['PGUSER'] = [string]$taskPayload.username
        $taskStart.Environment['PGPASSWORD'] = [string]$taskPayload.password
        $taskStart.Environment['PGCONNECT_TIMEOUT'] = '5'
        $taskStart.Environment['PGREQUIREAUTH'] = 'scram-sha-256,md5,password'
        $taskStart.Environment['PGPASSFILE'] = 'NUL'
        $taskStart.Environment['PGOPTIONS'] = '-c statement_timeout=5000 -c lock_timeout=1000 -c default_transaction_read_only=on -c search_path=pg_catalog'
        $taskStart.Environment['PGSSLMODE'] = if ([string]$taskPayload.host -in @('localhost','127.0.0.1','::1')) { 'prefer' } else { 'verify-full' }
        $taskStart.Environment['PGAPPNAME'] = 'Omni-Cracha-Executor'
        $taskStart.Environment['PGCLIENTENCODING'] = 'UTF8'
        $taskProcess = [Diagnostics.Process]::Start($taskStart)
        $taskOutputTask = $taskProcess.StandardOutput.ReadToEndAsync(); $taskErrorTask = $taskProcess.StandardError.ReadToEndAsync()
        $taskProcess.StandardInput.WriteLine("BEGIN READ ONLY;`n$taskSql`nCOMMIT;"); $taskProcess.StandardInput.Close()
        if (-not $taskProcess.WaitForExit(9000)) { $taskProcess.Kill(); $taskResult.outcome = 'timeout'; return $taskResult }
        $taskOutput = $taskOutputTask.GetAwaiter().GetResult(); $null = $taskErrorTask.GetAwaiter().GetResult()
        if ($taskProcess.ExitCode -ne 0) { return $taskResult }
        if ([Text.Encoding]::UTF8.GetByteCount($taskOutput) -gt 48000) { return $taskResult }
        # Exact values and common escaped encodings are redacted even if a database identifier imitates a secret.
        foreach ($taskSensitive in @([string]$taskPayload.password,[string]$taskPayload.host,[string]$taskPayload.username,[string]$taskPayload.database)) {
            if ($taskSensitive) {
                $taskEncoded = ConvertTo-Json -InputObject $taskSensitive -Compress
                $taskOutput = $taskOutput.Replace($taskEncoded.Substring(1,$taskEncoded.Length-2),'[private]').Replace($taskSensitive,'[private]')
            }
        }
        $taskData = ConvertFrom-Json -InputObject $taskOutput -ErrorAction Stop
        $taskResult.data = if ($Operation.kind -eq 'postgres.catalog') { @($taskData) } else { $taskData }
        $taskResult.outcome = 'completed'
        return $taskResult
    } catch { return $taskResult }
    finally {
        if ($null -ne $taskStart) { [void]$taskStart.Environment.Remove('PGPASSWORD') }
        if ($null -ne $taskProcess) { $taskProcess.Dispose() }
        $taskPayload = $null; $taskOutput = $null
    }
}
