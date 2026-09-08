param(
    [ValidatePattern('^[a-zA-Z0-9._-]{1,120}$')]
    [string]$PipeName = 'omni-access-broker-v8',
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^S-1-5-(?:\d+-){1,14}\d+$')]
    [string]$AllowedClientSid,
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,255}$')]
    [string]$RuntimeCredentialTarget = 'Omni/PostgreSQL/dedicated-5433/access-broker/v1',
    [ValidateRange(1024, 65535)]
    [int]$PostgreSqlPort = 5433,
    [string]$ProtectedCredentialFile = '',
    [Parameter(Mandatory = $true)]
    [string]$ReportPath,
    [switch]$InstalledService
)

# Trusted local boundary: Windows ACL authenticates the client SID; requests are typed and no secret is returned.
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskPsql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
$taskReport = [IO.Path]::GetFullPath($ReportPath)
$taskReportsRoot = if ($InstalledService) { [IO.Path]::GetFullPath($PSScriptRoot) } else { [IO.Path]::GetFullPath((Join-Path $taskRoot 'out\implementation')) }
if (-not $taskReport.StartsWith($taskReportsRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Report path must remain below out\\implementation.' }
if (-not (Test-Path -LiteralPath $taskPsql -PathType Leaf)) { throw 'Expected PostgreSQL 18 client is unavailable.' }

Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
namespace Omni.AccessBroker {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct Credential {
        public UInt32 Flags; public UInt32 Type; public IntPtr TargetName; public IntPtr Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public UInt32 CredentialBlobSize;
        public IntPtr CredentialBlob; public UInt32 Persist; public UInt32 AttributeCount; public IntPtr Attributes;
        public IntPtr TargetAlias; public IntPtr UserName;
    }
    public static class Native {
        [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential);
        [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr credential);
        public static NamedPipeServerStream CreatePipe(string name, string allowedClientSid) {
            WindowsIdentity current = WindowsIdentity.GetCurrent();
            PipeSecurity security = new PipeSecurity();
            security.SetOwner(current.User);
            security.AddAccessRule(new PipeAccessRule(current.User, PipeAccessRights.FullControl, AccessControlType.Allow));
            PipeAccessRights clientRights = PipeAccessRights.Read | PipeAccessRights.Write;
            security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(allowedClientSid), clientRights, AccessControlType.Allow));
            return new NamedPipeServerStream(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous, 65536, 65536, security, HandleInheritability.None);
        }
    }
}
'@

function Get-RuntimeCredential {
    if (-not [string]::IsNullOrWhiteSpace($ProtectedCredentialFile)) {
        $taskProtected = [IO.File]::ReadAllBytes($ProtectedCredentialFile)
        $taskPlain = $null
        try {
            $taskPlain = [Security.Cryptography.ProtectedData]::Unprotect($taskProtected, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
            $taskPayload = [Text.Encoding]::UTF8.GetString($taskPlain) | ConvertFrom-Json -ErrorAction Stop
            $taskUser = [string]$taskPayload.userName
            $taskPassword = [string]$taskPayload.password
            if ($taskUser -ne 'omni_access_broker' -or [string]::IsNullOrEmpty($taskPassword)) { throw 'Protected runtime credential metadata is invalid.' }
            return [pscustomobject]@{ UserName = $taskUser; Password = $taskPassword }
        } finally {
            if ($null -ne $taskPlain) { [Array]::Clear($taskPlain, 0, $taskPlain.Length) }
            if ($null -ne $taskProtected) { [Array]::Clear($taskProtected, 0, $taskProtected.Length) }
        }
    }
    $taskPointer = [IntPtr]::Zero
    if (-not [Omni.AccessBroker.Native]::CredRead($RuntimeCredentialTarget, 1, 0, [ref]$taskPointer)) {
        throw 'Runtime credential is unavailable to the trusted broker identity.'
    }
    try {
        $taskCredential = [Runtime.InteropServices.Marshal]::PtrToStructure($taskPointer, [type][Omni.AccessBroker.Credential])
        if ($taskCredential.UserName -ne [IntPtr]::Zero) { $taskUser = [Runtime.InteropServices.Marshal]::PtrToStringUni($taskCredential.UserName) } else { $taskUser = $null }
        if ($taskUser -ne 'omni_access_broker' -or $taskCredential.CredentialBlobSize -eq 0 -or ($taskCredential.CredentialBlobSize % 2) -ne 0) {
            throw 'Runtime credential metadata is invalid.'
        }
        return [pscustomobject]@{
            UserName = $taskUser
            Password = [Runtime.InteropServices.Marshal]::PtrToStringUni($taskCredential.CredentialBlob, [int]($taskCredential.CredentialBlobSize / 2))
        }
    } finally {
        if ($taskPointer -ne [IntPtr]::Zero) { [Omni.AccessBroker.Native]::CredFree($taskPointer) }
    }
}

function Invoke-BrokerQuery([string]$Query) {
    $taskCredential = Get-RuntimeCredential
    try {
        $taskStart = New-Object Diagnostics.ProcessStartInfo
        $taskStart.FileName = $taskPsql
        $taskStart.UseShellExecute = $false
        $taskStart.CreateNoWindow = $true
        $taskStart.RedirectStandardOutput = $true
        $taskStart.RedirectStandardError = $true
        # PostgreSQL emits UTF-8.  Do not let the active Windows code page corrupt
        # durable Portuguese text while it crosses the local broker boundary.
        $taskStart.StandardOutputEncoding = [Text.Encoding]::UTF8
        $taskStart.StandardErrorEncoding = [Text.Encoding]::UTF8
        $taskStart.Environment['PGPASSWORD'] = $taskCredential.Password
        $taskArguments = @('-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', $PostgreSqlPort.ToString(), '-U', 'omni_access_broker', '-d', 'omni', '-c', $Query)
        if ($taskStart.PSObject.Properties.Name -contains 'ArgumentList') {
            foreach ($taskArgument in $taskArguments) { [void]$taskStart.ArgumentList.Add($taskArgument) }
        } else {
            $taskStart.Arguments = (($taskArguments | ForEach-Object { '"' + $_ + '"' }) -join ' ')
        }
        $taskProcess = [Diagnostics.Process]::Start($taskStart)
        $taskOutput = $taskProcess.StandardOutput.ReadToEnd()
        $taskError = $taskProcess.StandardError.ReadToEnd()
        $taskProcess.WaitForExit()
        if ($taskProcess.ExitCode -ne 0) { throw 'Trusted database operation failed.' }
        return $taskOutput.Trim()
    } finally {
        if ($null -ne $taskCredential) { $taskCredential.Password = $null }
    }
}

function New-Response([hashtable]$Value) { return ($Value | ConvertTo-Json -Compress -Depth 6) + "`n" }
function Invoke-Request([string]$Raw) {
    if ($Raw.Length -gt 32768) { return @{ ok = $false; code = 'request-too-large' } }
    try { $taskRequest = $Raw | ConvertFrom-Json -ErrorAction Stop } catch { return @{ ok = $false; code = 'invalid-json' } }
    if ($null -eq $taskRequest -or $taskRequest.PSObject.Properties.Name -notcontains 'operation') { return @{ ok = $false; code = 'invalid-request' } }
    if ($taskRequest.operation -eq 'health') {
        try {
            $taskHealth = Invoke-BrokerQuery "BEGIN; SET LOCAL ROLE omni_access_admin; SELECT 1; COMMIT;"
            return @{ ok = $true; protocol = 'omni-access-broker-v1'; status = if ($taskHealth -match '1') { 'ready' } else { 'degraded' } }
        } catch { return @{ ok = $true; protocol = 'omni-access-broker-v1'; status = 'degraded' } }
    }
    if ($taskRequest.operation -eq 'memory.import') {
        if ($taskRequest.PSObject.Properties.Name -notcontains 'importId' -or $taskRequest.PSObject.Properties.Name -notcontains 'sourceFingerprint' -or $taskRequest.PSObject.Properties.Name -notcontains 'entriesBase64') {
            return @{ ok = $false; code = 'invalid-request' }
        }
        $taskImportId = [string]$taskRequest.importId
        $taskSourceFingerprint = [string]$taskRequest.sourceFingerprint
        $taskEntriesBase64 = [string]$taskRequest.entriesBase64
        if ($taskImportId -notmatch '^memory-import-[a-zA-Z0-9-]{1,160}$' -or $taskSourceFingerprint -notmatch '^[a-f0-9]{64}$' -or $taskEntriesBase64 -notmatch '^[A-Za-z0-9+/=]{4,12000}$') {
            return @{ ok = $false; code = 'invalid-request' }
        }
        try {
            [void][Convert]::FromBase64String($taskEntriesBase64)
            $taskQuery = @"
BEGIN;
SET LOCAL ROLE omni_memory_runtime;
WITH source AS (
  SELECT convert_from(decode('$taskEntriesBase64', 'base64'), 'UTF8')::jsonb AS entries
), receipt AS (
  INSERT INTO memory.import_receipts (owner_id, import_id, source_fingerprint, result)
  VALUES (identity.owner_id(), '$taskImportId', '$taskSourceFingerprint', 'applied')
  ON CONFLICT (owner_id, import_id) DO NOTHING
  RETURNING 1
), upserted AS (
  INSERT INTO memory.entries (owner_id, memory_id, lane, memory_type, scope_type, scope_id, project_id, text_fingerprint, payload, source_updated_at)
  SELECT identity.owner_id(), entry.id, entry.lane, entry.type, entry.scope_type, entry.scope_id, entry.project_id, entry.text_fingerprint, entry.payload, entry.source_updated_at
  FROM receipt CROSS JOIN source CROSS JOIN LATERAL jsonb_to_recordset(source.entries) AS entry(
    id text, lane text, type text, scope_type text, scope_id text, project_id text, text_fingerprint text, payload jsonb, source_updated_at timestamptz
  )
  ON CONFLICT (owner_id, memory_id) DO UPDATE SET
    lane = EXCLUDED.lane, memory_type = EXCLUDED.memory_type, scope_type = EXCLUDED.scope_type, scope_id = EXCLUDED.scope_id,
    project_id = EXCLUDED.project_id, text_fingerprint = EXCLUDED.text_fingerprint, payload = EXCLUDED.payload,
    source_updated_at = EXCLUDED.source_updated_at, imported_at = clock_timestamp(), revision = memory.entries.revision + 1
  WHERE memory.entries.source_updated_at <= EXCLUDED.source_updated_at
  RETURNING 1
)
SELECT CASE WHEN EXISTS (SELECT 1 FROM receipt) THEN 'applied' ELSE 'duplicate' END;
COMMIT;
"@
            $taskResult = Invoke-BrokerQuery $taskQuery
            if ($taskResult -notmatch '^(applied|duplicate)$') { throw 'Unexpected memory import result.' }
            return @{ ok = $true; result = $taskResult }
        } catch { return @{ ok = $false; code = 'trusted-operation-failed' } }
    }
    if ($taskRequest.operation -eq 'mission.upsert') {
        if ($taskRequest.PSObject.Properties.Name -notcontains 'missionBase64') { return @{ ok = $false; code = 'invalid-request' } }
        $taskMissionBase64 = [string]$taskRequest.missionBase64
        if ($taskMissionBase64 -notmatch '^[A-Za-z0-9+/=]{4,12000}$') { return @{ ok = $false; code = 'invalid-request' } }
        try {
            [void][Convert]::FromBase64String($taskMissionBase64)
            $taskQuery = @"
BEGIN;
SET LOCAL ROLE omni_operations_runtime;
WITH source AS (SELECT convert_from(decode('$taskMissionBase64', 'base64'), 'UTF8')::jsonb AS mission),
upserted AS (
 INSERT INTO operations.missions (owner_id, mission_id, objective, state, priority, payload, created_at, updated_at, closed_at)
 SELECT identity.owner_id(), mission->>'id', mission->>'objective', mission->>'state', (mission->>'priority')::smallint,
        mission->'payload', (mission->>'createdAt')::timestamptz, (mission->>'updatedAt')::timestamptz,
        CASE WHEN mission->>'closedAt' IS NULL THEN NULL ELSE (mission->>'closedAt')::timestamptz END FROM source
 ON CONFLICT (owner_id, mission_id) DO UPDATE SET objective=EXCLUDED.objective, state=EXCLUDED.state, priority=EXCLUDED.priority,
   payload=EXCLUDED.payload, updated_at=EXCLUDED.updated_at, closed_at=EXCLUDED.closed_at, version=operations.missions.version+1
 WHERE operations.missions.updated_at < EXCLUDED.updated_at
 RETURNING mission_id, state, payload, updated_at
), evented AS (
 INSERT INTO operations.mission_events (owner_id, event_id, mission_id, observed_at, kind, payload)
 SELECT identity.owner_id(), 'mission-event-' || md5(mission_id || updated_at::text), mission_id, updated_at,
   CASE state WHEN 'completed' THEN 'completed' WHEN 'cancelled' THEN 'cancelled' WHEN 'blocked' THEN 'blocked' WHEN 'in-progress' THEN 'resumed' ELSE 'updated' END, payload FROM upserted
 ON CONFLICT (owner_id, event_id) DO NOTHING RETURNING 1
)
SELECT CASE WHEN EXISTS (SELECT 1 FROM upserted) THEN 'applied' ELSE 'duplicate' END;
COMMIT;
"@
            $taskResult = Invoke-BrokerQuery $taskQuery
            if ($taskResult -notmatch '^(applied|duplicate)$') { throw 'Unexpected mission result.' }
            return @{ ok = $true; result = $taskResult }
        } catch { return @{ ok = $false; code = 'trusted-operation-failed' } }
    }
    if ($taskRequest.operation -eq 'mission.list-active') {
        try {
            $taskQuery = "BEGIN; SET LOCAL ROLE omni_operations_runtime; SELECT COALESCE(json_agg(json_build_object('id', mission_id, 'objective', objective, 'state', state, 'priority', priority, 'payload', payload, 'createdAt', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') || 'T' || to_char(created_at AT TIME ZONE 'UTC', 'HH24:MI:SS.MS') || 'Z', 'updatedAt', to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') || 'T' || to_char(updated_at AT TIME ZONE 'UTC', 'HH24:MI:SS.MS') || 'Z', 'closedAt', NULL) ORDER BY priority DESC, updated_at DESC), '[]'::json)::text FROM (SELECT mission_id, objective, state, priority, payload, created_at, updated_at FROM operations.missions WHERE owner_id = identity.owner_id() AND state IN ('open', 'in-progress', 'blocked') ORDER BY priority DESC, updated_at DESC LIMIT 20) mission; COMMIT;"
            $taskJson = Invoke-BrokerQuery $taskQuery
            # Keep database JSON opaque here: PowerShell may nest a JSON array when serializing it again.
            if ($taskJson.Length -gt 48000) { throw 'Mission response exceeds broker limit.' }
            return @{ ok = $true; missionsJson = $taskJson }
        } catch { return @{ ok = $false; code = 'trusted-operation-failed' } }
    }
    if ($taskRequest.operation -eq 'credential.observe') {
        if ($taskRequest.PSObject.Properties.Name -notcontains 'expectedRevision' -or $taskRequest.PSObject.Properties.Name -notcontains 'eventBase64') {
            return @{ ok = $false; code = 'invalid-request' }
        }
        $taskExpectedRevision = [string]$taskRequest.expectedRevision
        $taskEventBase64 = [string]$taskRequest.eventBase64
        if ($taskExpectedRevision -notmatch '^[1-9][0-9]{0,15}$' -or [long]$taskExpectedRevision -gt 9007199254740991 -or $taskEventBase64 -notmatch '^[A-Za-z0-9+/=]{4,12000}$') {
            return @{ ok = $false; code = 'invalid-request' }
        }
        try {
            $taskEventBytes = [Convert]::FromBase64String($taskEventBase64)
            if ($taskEventBytes.Length -gt 9000) { throw 'Credential observation is too large.' }
            $taskEventText = [Text.Encoding]::UTF8.GetString($taskEventBytes)
            $null = $taskEventText | ConvertFrom-Json -ErrorAction Stop
            $taskQuery = "BEGIN; SET LOCAL ROLE omni_access_admin; SELECT access.record_credential_observation(convert_from(decode('$taskEventBase64', 'base64'), 'UTF8')::jsonb, $taskExpectedRevision)::text; COMMIT;"
            $taskJson = Invoke-BrokerQuery $taskQuery
            $taskResult = $taskJson | ConvertFrom-Json -ErrorAction Stop
            if ($taskResult.outcome -eq 'conflict' -or $taskResult.outcome -eq 'version-not-found') { return @{ ok = $true; outcome = $taskResult.outcome } }
            if (($taskResult.outcome -ne 'recorded' -and $taskResult.outcome -ne 'duplicate') -or $null -eq $taskResult.credential) { throw 'Unexpected observation result.' }
            $taskCredentialJson = $taskResult.credential | ConvertTo-Json -Compress -Depth 4
            if ($taskCredentialJson.Length -gt 24000) { throw 'Credential observation response exceeds broker limit.' }
            return @{ ok = $true; outcome = $taskResult.outcome; credentialJson = $taskCredentialJson }
        } catch { return @{ ok = $false; code = 'trusted-operation-failed' } }
    }
    if ($taskRequest.operation -ne 'credential.read' -or $taskRequest.PSObject.Properties.Name -notcontains 'credentialId' -or $taskRequest.PSObject.Properties.Name -notcontains 'version') {
        return @{ ok = $false; code = 'unsupported-operation' }
    }
    $taskCredentialId = [string]$taskRequest.credentialId
    $taskVersion = [string]$taskRequest.version
    if ($taskCredentialId -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$' -or $taskVersion -notmatch '^[1-9][0-9]{0,15}$' -or [long]$taskVersion -gt 9007199254740991) {
        return @{ ok = $false; code = 'invalid-request' }
    }
    try {
        $taskQuery = @"
BEGIN;
SET LOCAL ROLE omni_access_admin;
SELECT json_build_object(
  'credentialId', credential_id, 'version', version, 'revision', revision,
  'providerRef', provider_ref, 'accountRef', account_ref, 'environmentRef', environment_ref,
  'secretRef', secret_ref, 'issuedAt', CASE WHEN issued_at IS NULL THEN NULL ELSE to_char(issued_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') || 'T' || to_char(issued_at AT TIME ZONE 'UTC', 'HH24:MI:SS.MS') || 'Z' END,
  'expiryKind', expiry_kind, 'expirySource', expiry_source, 'expiresAt', CASE WHEN expires_at IS NULL THEN NULL ELSE to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') || 'T' || to_char(expires_at AT TIME ZONE 'UTC', 'HH24:MI:SS.MS') || 'Z' END,
  'status', status, 'statusChangedAt', to_char(status_changed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') || 'T' || to_char(status_changed_at AT TIME ZONE 'UTC', 'HH24:MI:SS.MS') || 'Z',
  'lastCheckedAt', CASE WHEN last_checked_at IS NULL THEN NULL ELSE to_char(last_checked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') || 'T' || to_char(last_checked_at AT TIME ZONE 'UTC', 'HH24:MI:SS.MS') || 'Z' END,
  'lastSuccessAt', CASE WHEN last_success_at IS NULL THEN NULL ELSE to_char(last_success_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') || 'T' || to_char(last_success_at AT TIME ZONE 'UTC', 'HH24:MI:SS.MS') || 'Z' END,
  'unusableSince', CASE WHEN unusable_since IS NULL THEN NULL ELSE to_char(unusable_since AT TIME ZONE 'UTC', 'YYYY-MM-DD') || 'T' || to_char(unusable_since AT TIME ZONE 'UTC', 'HH24:MI:SS.MS') || 'Z' END,
  'lastFailureAt', CASE WHEN last_failure_at IS NULL THEN NULL ELSE to_char(last_failure_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') || 'T' || to_char(last_failure_at AT TIME ZONE 'UTC', 'HH24:MI:SS.MS') || 'Z' END,
  'failureCode', failure_code, 'evidenceRef', evidence_ref,
  'revokedAt', CASE WHEN revoked_at IS NULL THEN NULL ELSE to_char(revoked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') || 'T' || to_char(revoked_at AT TIME ZONE 'UTC', 'HH24:MI:SS.MS') || 'Z' END,
  'replacedById', replaced_by_id, 'renewalMode', renewal_mode, 'renewBeforeSeconds', renew_before_seconds,
  'nextCheckAt', CASE WHEN next_check_at IS NULL THEN NULL ELSE to_char(next_check_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') || 'T' || to_char(next_check_at AT TIME ZONE 'UTC', 'HH24:MI:SS.MS') || 'Z' END,
  'nextRetryAt', CASE WHEN next_retry_at IS NULL THEN NULL ELSE to_char(next_retry_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') || 'T' || to_char(next_retry_at AT TIME ZONE 'UTC', 'HH24:MI:SS.MS') || 'Z' END
)::text
FROM access.credential_versions
WHERE owner_id = identity.owner_id() AND credential_id = '$taskCredentialId' AND version = $taskVersion;
COMMIT;
"@
        $taskJson = Invoke-BrokerQuery $taskQuery
        if ($taskJson.Length -eq 0) { return @{ ok = $true; found = $false } }
        return @{ ok = $true; found = $true; credential = ($taskJson | ConvertFrom-Json -ErrorAction Stop) }
    } catch { return @{ ok = $false; code = 'trusted-operation-failed' } }
}

$taskIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
try {
    [IO.File]::WriteAllText($taskReport, (New-Response @{ schemaVersion = 1; kind = 'omni-access-broker'; pipe = $PipeName; allowedClientSid = $AllowedClientSid; executorSid = $taskIdentity.User.Value; status = 'starting'; secretEmitted = $false; startedAt = [DateTimeOffset]::UtcNow.ToString('o') }), [Text.UTF8Encoding]::new($false))
    while ($true) {
        $taskPipe = [Omni.AccessBroker.Native]::CreatePipe($PipeName, $AllowedClientSid)
        try {
            $taskPipe.WaitForConnection()
            $taskReader = New-Object IO.StreamReader($taskPipe, [Text.UTF8Encoding]::new($false), $false, 65536, $true)
            $taskWriter = New-Object IO.StreamWriter($taskPipe, [Text.UTF8Encoding]::new($false), 65536, $true)
            $taskWriter.AutoFlush = $true
            try {
                $taskRaw = $taskReader.ReadLine()
                if ($null -ne $taskRaw) { $taskWriter.Write((New-Response (Invoke-Request $taskRaw))) }
            } finally {
                $taskWriter.Dispose()
                $taskReader.Dispose()
            }
        } catch {
            # Per-request failures are deliberately not emitted as raw errors or secrets.
        } finally {
            $taskPipe.Dispose()
        }
    }
} finally {
    $taskIdentity.Dispose()
}
