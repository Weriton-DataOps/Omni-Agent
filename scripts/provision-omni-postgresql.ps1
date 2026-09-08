param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,255}$')]
    [string]$AdminCredentialTarget,
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,255}$')]
    [string]$RuntimeCredentialTarget,
    [Parameter(Mandatory = $true)]
    [string]$ReportPath,
    [ValidatePattern('^(?:127\.0\.0\.1|localhost)$')]
    [string]$PostgreSqlHost = '127.0.0.1',
    [ValidateRange(1024, 65535)]
    [int]$Port = 5432,
    [switch]$ResumePartialBootstrap
)

# Authorized, one-shot local bootstrap. Secrets remain in the current Windows credential set
# and transient child-process memory only; this script never writes a secret to disk or output.
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskReport = [IO.Path]::GetFullPath($ReportPath)
$taskReportsRoot = [IO.Path]::GetFullPath((Join-Path $taskRoot 'out\implementation'))
if (-not $taskReport.StartsWith($taskReportsRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Report path must remain below out\\implementation.'
}
if (Test-Path -LiteralPath $taskReport) { throw 'Refusing to overwrite an existing provisioning receipt.' }
$taskPsql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
$taskMigration = Join-Path $taskRoot 'adaptadores\postgresql\migrations\001-access-foundation.sql'
if (-not (Test-Path -LiteralPath $taskPsql -PathType Leaf)) { throw 'Expected PostgreSQL 18 client is unavailable.' }
if (-not (Test-Path -LiteralPath $taskMigration -PathType Leaf)) { throw 'Access foundation migration is unavailable.' }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace Omni.Provisioning {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct Credential {
        public UInt32 Flags;
        public UInt32 Type;
        public IntPtr TargetName;
        public IntPtr Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public UInt32 CredentialBlobSize;
        public IntPtr CredentialBlob;
        public UInt32 Persist;
        public UInt32 AttributeCount;
        public IntPtr Attributes;
        public IntPtr TargetAlias;
        public IntPtr UserName;
    }
    public static class Native {
        [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential);
        [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool CredWrite(ref Credential credential, UInt32 flags);
        [DllImport("advapi32.dll")]
        public static extern void CredFree(IntPtr credential);
        public static bool WriteGeneric(string target, string username, string secret, out int error) {
            byte[] bytes = System.Text.Encoding.Unicode.GetBytes(secret);
            IntPtr blob = IntPtr.Zero;
            IntPtr targetPtr = IntPtr.Zero;
            IntPtr usernamePtr = IntPtr.Zero;
            try {
                blob = Marshal.AllocHGlobal(bytes.Length);
                Marshal.Copy(bytes, 0, blob, bytes.Length);
                targetPtr = Marshal.StringToCoTaskMemUni(target);
                usernamePtr = Marshal.StringToCoTaskMemUni(username);
                Credential credential = new Credential {
                    Type = 1, TargetName = targetPtr, CredentialBlobSize = (UInt32)bytes.Length,
                    CredentialBlob = blob, Persist = 2, UserName = usernamePtr
                };
                bool written = CredWrite(ref credential, 0);
                error = written ? 0 : Marshal.GetLastWin32Error();
                return written;
            } finally {
                Array.Clear(bytes, 0, bytes.Length);
                if (blob != IntPtr.Zero) {
                    for (int index = 0; index < bytes.Length; index++) Marshal.WriteByte(blob, index, 0);
                    Marshal.FreeHGlobal(blob);
                }
                if (targetPtr != IntPtr.Zero) Marshal.FreeCoTaskMem(targetPtr);
                if (usernamePtr != IntPtr.Zero) Marshal.FreeCoTaskMem(usernamePtr);
            }
        }
    }
}
'@

function Get-CredentialMetadata([string]$Target) {
    $taskPointer = [IntPtr]::Zero
    $taskFound = [Omni.Provisioning.Native]::CredRead($Target, 1, 0, [ref]$taskPointer)
    $taskError = if ($taskFound) { 0 } else { [Runtime.InteropServices.Marshal]::GetLastWin32Error() }
    try {
        if (-not $taskFound) { return [pscustomobject]@{ Found = $false; Error = $taskError; UserName = $null; Password = $null } }
        $taskCredential = [Runtime.InteropServices.Marshal]::PtrToStructure($taskPointer, [type][Omni.Provisioning.Credential])
        if ($taskCredential.CredentialBlobSize -eq 0 -or ($taskCredential.CredentialBlobSize % 2) -ne 0) { throw 'Credential does not contain a valid Unicode password blob.' }
        return [pscustomobject]@{
            Found = $true
            Error = 0
            UserName = [Runtime.InteropServices.Marshal]::PtrToStringUni($taskCredential.UserName)
            Password = [Runtime.InteropServices.Marshal]::PtrToStringUni($taskCredential.CredentialBlob, [int]($taskCredential.CredentialBlobSize / 2))
        }
    } finally {
        if ($taskPointer -ne [IntPtr]::Zero) { [Omni.Provisioning.Native]::CredFree($taskPointer) }
    }
}

function Write-GenericCredential([string]$Target, [string]$UserName, [string]$Password) {
    $taskError = 0
    if (-not [Omni.Provisioning.Native]::WriteGeneric($Target, $UserName, $Password, [ref]$taskError)) {
        throw "Credential write failed with Win32 error $taskError."
    }
}

function New-RuntimeSecret {
    $taskBytes = New-Object byte[] 36
    $taskGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $taskGenerator.GetBytes($taskBytes)
        return [Convert]::ToBase64String($taskBytes)
    } finally {
        [Array]::Clear($taskBytes, 0, $taskBytes.Length)
        $taskGenerator.Dispose()
    }
}

function Invoke-Psql([string]$Database, [string]$UserName, [string]$Password, [string[]]$Arguments, [string]$StandardInput = '') {
    $taskStart = New-Object Diagnostics.ProcessStartInfo
    $taskStart.FileName = $taskPsql
    $taskStart.UseShellExecute = $false
    $taskStart.CreateNoWindow = $true
    $taskStart.RedirectStandardOutput = $true
    $taskStart.RedirectStandardError = $true
    $taskStart.RedirectStandardInput = $true
    $taskStart.Environment['PGPASSWORD'] = $Password
    $taskArguments = @('-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', $PostgreSqlHost, '-p', $Port.ToString(), '-U', $UserName, '-d', $Database) + $Arguments
    # The elevated host is Windows PowerShell 5.1/.NET Framework, which has no ArgumentList.
    # Inputs are validated or fixed and never contain a double quote; quote for CreateProcess, not a shell.
    if ($taskStart.PSObject.Properties.Name -contains 'ArgumentList') {
        foreach ($taskArgument in $taskArguments) { [void]$taskStart.ArgumentList.Add($taskArgument) }
    } else {
        $taskStart.Arguments = (($taskArguments | ForEach-Object { '"' + $_ + '"' }) -join ' ')
    }
    $taskProcess = [Diagnostics.Process]::Start($taskStart)
    if ($StandardInput.Length -gt 0) { $taskProcess.StandardInput.Write($StandardInput) }
    $taskProcess.StandardInput.Close()
    $taskOutput = $taskProcess.StandardOutput.ReadToEnd()
    $taskError = $taskProcess.StandardError.ReadToEnd()
    $taskProcess.WaitForExit()
    if ($taskProcess.ExitCode -ne 0) {
        $taskCategory = if ($taskError -match '(?i)password authentication failed') { 'database-authentication-failed' } elseif ($taskError -match '(?i)connection') { 'database-connection-failed' } else { 'psql-failed' }
        throw "$taskCategory (exit $($taskProcess.ExitCode))."
    }
    return $taskOutput.Trim()
}

$taskAdmin = $null
$taskRuntimePassword = $null
$taskRuntimeSecretWritten = $false
$taskBrokerEnabled = $false
$taskDatabaseCreated = $false
$taskStage = 'preflight'
$taskOwnerId = [guid]::NewGuid().ToString()
$taskChecksum = (Get-FileHash -Algorithm SHA256 -LiteralPath $taskMigration).Hash.ToLowerInvariant()
$taskIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$taskReceipt = [ordered]@{
    schemaVersion = 1
    kind = 'omni-postgresql-bootstrap'
    mode = if ($ResumePartialBootstrap) { 'strict-resume' } else { 'new-bootstrap' }
    checkedAt = [DateTimeOffset]::UtcNow.ToString('o')
    adminCredentialTarget = $AdminCredentialTarget
    runtimeCredentialTarget = $RuntimeCredentialTarget
    database = 'omni'
    endpoint = "$PostgreSqlHost`:$Port"
    role = 'omni_access_broker'
    ownerId = $taskOwnerId
    migration = [ordered]@{ id = '001-access-foundation'; checksum = $taskChecksum; applied = $false }
    credential = [ordered]@{ written = $false; persistence = 'local-machine'; secretDecodedForBootstrap = $true; secretEmitted = $false }
    verification = [ordered]@{ adminAuthentication = $false; runtimeAuthentication = $false; ownerMapping = $false }
    changed = [ordered]@{ database = $false; roles = $false; runtimeCredential = $false }
    executor = [ordered]@{ windowsIdentity = $taskIdentity.Name; windowsSid = $taskIdentity.User.Value; elevated = $true }
    outcome = 'not-started'
}
try {
    $taskStage = 'runtime-credential-preflight'
    $taskRuntimeExisting = Get-CredentialMetadata $RuntimeCredentialTarget
    if (-not $ResumePartialBootstrap) {
        if ($taskRuntimeExisting.Found) { throw 'Runtime credential target already exists; refusing to overwrite it.' }
        if ($taskRuntimeExisting.Error -ne 1168) { throw "Runtime credential preflight failed with Win32 error $($taskRuntimeExisting.Error)." }
    } else {
        if (-not $taskRuntimeExisting.Found -or $taskRuntimeExisting.UserName -ne 'omni_access_broker' -or $taskRuntimeExisting.Password -notmatch '^[A-Za-z0-9+/=]{32,128}$') {
            throw 'Partial bootstrap runtime credential is absent or invalid; refusing resume.'
        }
        $taskRuntimePassword = $taskRuntimeExisting.Password
        $taskReceipt.credential.written = $true
    }
    $taskStage = 'administrative-credential-read'
    $taskAdmin = Get-CredentialMetadata $AdminCredentialTarget
    if (-not $taskAdmin.Found) { throw "Administrative credential not found (Win32 $($taskAdmin.Error))." }
    if ($taskAdmin.UserName -notmatch '^[a-zA-Z_][a-zA-Z0-9_]{0,62}$') { throw 'Administrative credential username is not a PostgreSQL role identifier.' }

    $taskStage = 'database-admin-authentication'
    $taskPreflight = Invoke-Psql 'postgres' $taskAdmin.UserName $taskAdmin.Password @('-At', '-c', "SELECT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)::int, EXISTS (SELECT 1 FROM pg_database WHERE datname = 'omni')::int, (SELECT count(*) FROM pg_roles WHERE rolname IN ('omni_schema_owner','omni_memory_runtime','omni_access_runtime','omni_access_admin','omni_operations_runtime','omni_access_broker'));")
    $taskParts = $taskPreflight.Split('|')
    $taskStage = 'database-collision-check'
    if ($taskParts.Count -ne 3 -or $taskParts[0] -ne '1') { throw 'Administrative database identity lacks required bootstrap authority.' }
    $taskReceipt.verification.adminAuthentication = $true
    if (-not $ResumePartialBootstrap) {
        if ($taskParts[1] -ne '0' -or $taskParts[2] -ne '0') { throw 'Omni database or role collision detected; provisioning will not take ownership.' }
        $taskStage = 'create-dedicated-database'
        [void](Invoke-Psql 'postgres' $taskAdmin.UserName $taskAdmin.Password @('-c', "CREATE DATABASE omni TEMPLATE template0 ENCODING 'UTF8';"))
        $taskDatabaseCreated = $true
        $taskReceipt.changed.database = $true
        $taskStage = 'apply-access-migration'
        [void](Invoke-Psql 'omni' $taskAdmin.UserName $taskAdmin.Password @('-v', "migration_checksum=$taskChecksum", '-f', $taskMigration))
        $taskReceipt.migration.applied = $true
        $taskStage = 'create-runtime-role-and-owner'
        [void](Invoke-Psql 'omni' $taskAdmin.UserName $taskAdmin.Password @('-c', "ALTER DATABASE omni OWNER TO omni_schema_owner; CREATE ROLE omni_access_broker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS IN ROLE omni_access_admin; INSERT INTO identity.login_owners (login_name, owner_id) VALUES ('omni_access_broker', '$taskOwnerId'::uuid);"))
        $taskReceipt.changed.roles = $true
    } else {
        if ($taskParts[1] -ne '1' -or $taskParts[2] -ne '6') { throw 'Partial bootstrap state does not exactly match the expected foundation.' }
        $taskStage = 'verify-partial-foundation'
        $taskResumeState = Invoke-Psql 'omni' $taskAdmin.UserName $taskAdmin.Password @('-At', '-c', "SELECT (SELECT checksum FROM omni_meta.schema_migrations WHERE id = '001-access-foundation') = '$taskChecksum', (SELECT owner_id::text FROM identity.login_owners WHERE login_name = 'omni_access_broker'), (SELECT NOT rolcanlogin FROM pg_roles WHERE rolname = 'omni_access_broker');")
        $taskResumeParts = $taskResumeState.Split('|')
        if ($taskResumeParts.Count -ne 3 -or $taskResumeParts[0] -ne 't' -or $taskResumeParts[1] -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' -or $taskResumeParts[2] -ne 't') { throw 'Partial foundation verification failed; refusing resume.' }
        $taskOwnerId = $taskResumeParts[1]
        $taskReceipt.ownerId = $taskOwnerId
        $taskReceipt.migration.applied = $true
    }

    if (-not $ResumePartialBootstrap) {
        $taskStage = 'write-runtime-credential'
        $taskRuntimePassword = New-RuntimeSecret
        Write-GenericCredential $RuntimeCredentialTarget 'omni_access_broker' $taskRuntimePassword
        $taskRuntimeSecretWritten = $true
        $taskReceipt.credential.written = $true
        $taskReceipt.changed.runtimeCredential = $true
    }

    $taskStage = 'set-runtime-password'
    if ($taskRuntimePassword -notmatch '^[A-Za-z0-9+/=]{32,128}$') { throw 'Generated runtime password did not meet the expected encoding policy.' }
    [void](Invoke-Psql 'omni' $taskAdmin.UserName $taskAdmin.Password @() "ALTER ROLE omni_access_broker PASSWORD '$taskRuntimePassword';`n")
    $taskStage = 'enable-runtime-role'
    [void](Invoke-Psql 'omni' $taskAdmin.UserName $taskAdmin.Password @('-c', 'ALTER ROLE omni_access_broker LOGIN;'))
    $taskBrokerEnabled = $true
    $taskStage = 'verify-runtime-login-and-owner'
    $taskRuntimeResult = Invoke-Psql 'omni' 'omni_access_broker' $taskRuntimePassword @('-At', '-c', "BEGIN; SET LOCAL ROLE omni_access_admin; SELECT (session_user = 'omni_access_broker')::int, (identity.owner_id() = '$taskOwnerId'::uuid)::int; COMMIT;")
    $taskReceipt.verification.runtimeResultSignature = ($taskRuntimeResult -replace '[^01|]', '?')
    $taskRuntimeParts = $taskRuntimeResult.Split('|')
    if ($taskRuntimeParts.Count -ne 2 -or $taskRuntimeParts[0] -ne '1' -or $taskRuntimeParts[1] -ne '1') { throw 'Runtime login or owner mapping verification failed.' }
    $taskReceipt.verification.runtimeAuthentication = $true
    $taskReceipt.verification.ownerMapping = $true
    $taskStage = 'record-runtime-credential-metadata'
    [void](Invoke-Psql 'omni' $taskAdmin.UserName $taskAdmin.Password @('-c', "INSERT INTO access.credential_versions (owner_id, credential_id, version, provider_ref, account_ref, environment_ref, secret_ref, issued_at, expires_at, expiry_kind, expiry_source, status, status_changed_at, last_checked_at, last_success_at, unusable_since, last_failure_at, failure_code, evidence_ref, revoked_at, replaced_by_id, renewal_mode, renew_before_seconds, next_check_at, next_retry_at) VALUES ('$taskOwnerId'::uuid, 'postgresql-local-access-broker', 1, 'postgresql', 'omni-access-broker', 'local', 'credential-ref:windows-omni-postgresql-local-access-broker-v1', clock_timestamp(), NULL, 'non_expiring', 'owner-attestation', 'active', clock_timestamp(), clock_timestamp(), clock_timestamp(), NULL, NULL, NULL, 'bootstrap-verified', NULL, NULL, 'none', 0, NULL, NULL); INSERT INTO audit.credential_events (owner_id, event_id, credential_id, version, observed_at, kind, evidence_ref, outcome) VALUES ('$taskOwnerId'::uuid, 'bootstrap-authenticated-v1', 'postgresql-local-access-broker', 1, clock_timestamp(), 'authenticated', 'bootstrap-verified', 'applied');"))
    $taskReceipt.outcome = 'provisioned-and-verified'
} catch {
    $taskReceipt.outcome = 'failed-closed'
    $taskReceipt.failureStage = $taskStage
    $taskReceipt.failureCategory = if ($_.Exception.Message -match 'credential|Credential') { 'credential' } elseif ($_.Exception.Message -match 'collision') { 'collision' } elseif ($_.Exception.Message -match 'authentication') { 'authentication' } else { 'bootstrap' }
    $taskReceipt.failureKind = $_.Exception.GetType().Name
    if ($taskBrokerEnabled) {
        try { [void](Invoke-Psql 'omni' $taskAdmin.UserName $taskAdmin.Password @('-c', 'ALTER ROLE omni_access_broker NOLOGIN;')) } catch {}
        $taskReceipt.brokerDisabledAfterFailure = $true
    }
} finally {
    if ($null -ne $taskAdmin -and $null -ne $taskAdmin.Password) { $taskAdmin.Password = $null }
    $taskRuntimePassword = $null
    [IO.File]::WriteAllText($taskReport, ($taskReceipt | ConvertTo-Json -Depth 8) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
    $taskIdentity.Dispose()
}
if ($taskReceipt.outcome -ne 'provisioned-and-verified') { exit 1 }
