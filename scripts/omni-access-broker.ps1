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
. (Join-Path $PSScriptRoot 'omni-credential-verification.ps1')
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
        [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool CredWrite(ref Credential credential, UInt32 flags);
        [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool CredDelete(string target, UInt32 type, UInt32 flags);
        [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr credential);
        public static bool WriteOwnerSecret(string target, string userName, byte[] secret) {
            IntPtr targetPtr = IntPtr.Zero, userPtr = IntPtr.Zero, secretPtr = IntPtr.Zero;
            try {
                targetPtr = Marshal.StringToCoTaskMemUni(target); userPtr = Marshal.StringToCoTaskMemUni(userName);
                secretPtr = Marshal.AllocHGlobal(secret.Length); Marshal.Copy(secret, 0, secretPtr, secret.Length);
                Credential credential = new Credential { Type = 1, TargetName = targetPtr, UserName = userPtr, CredentialBlob = secretPtr, CredentialBlobSize = (UInt32)secret.Length, Persist = 2 };
                return CredWrite(ref credential, 0);
            } finally { if (targetPtr != IntPtr.Zero) Marshal.FreeCoTaskMem(targetPtr); if (userPtr != IntPtr.Zero) Marshal.FreeCoTaskMem(userPtr); if (secretPtr != IntPtr.Zero) { for (int i = 0; i < secret.Length; i++) Marshal.WriteByte(secretPtr, i, 0); Marshal.FreeHGlobal(secretPtr); } }
        }
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

function Set-OwnerCredentialSecret([string]$Target, [string]$UserName, [string]$Token) {
    if ($Target -notmatch '^Omni/UserCredential/[a-zA-Z0-9._:-]{1,180}$' -or $UserName -notmatch '^[a-zA-Z0-9._:-]{1,160}$') { throw 'Credential vault target is invalid.' }
    $taskBytes = $null
    try {
        $taskBytes = [Text.Encoding]::UTF8.GetBytes($Token)
        if ($taskBytes.Length -lt 1 -or $taskBytes.Length -gt 2400) { throw 'Credential secret is invalid or too large.' }
        if (-not [Omni.AccessBroker.Native]::WriteOwnerSecret($Target, $UserName, $taskBytes)) { throw 'Windows credential vault write failed.' }
    } finally {
        if ($null -ne $taskBytes) { [Array]::Clear($taskBytes, 0, $taskBytes.Length) }
    }
}

function Remove-OwnerCredentialSecret([string]$Target) {
    [void][Omni.AccessBroker.Native]::CredDelete($Target, 1, 0)
}

function Get-OwnerCredentialSecret([string]$SecretRef) {
    if ($SecretRef -notmatch '^credential-ref:windows-([a-zA-Z0-9._:-]{1,180})$') { throw 'Credential vault reference is invalid.' }
    $taskVaultTarget = 'Omni/UserCredential/' + $Matches[1]
    $taskPointer = [IntPtr]::Zero
    $taskSecretBytes = $null
    try {
        if (-not [Omni.AccessBroker.Native]::CredRead($taskVaultTarget, 1, 0, [ref]$taskPointer)) { throw 'Credential is unavailable to the broker identity.' }
        $taskCredential = [Runtime.InteropServices.Marshal]::PtrToStructure($taskPointer, [type][Omni.AccessBroker.Credential])
        if ($taskCredential.CredentialBlobSize -lt 1 -or $taskCredential.CredentialBlobSize -gt 2400) { throw 'Credential vault content is invalid.' }
        $taskSecretBytes = New-Object byte[] ([int]$taskCredential.CredentialBlobSize)
        [Runtime.InteropServices.Marshal]::Copy($taskCredential.CredentialBlob, $taskSecretBytes, 0, $taskSecretBytes.Length)
        return [Text.Encoding]::UTF8.GetString($taskSecretBytes)
    } finally {
        if ($null -ne $taskSecretBytes) { [Array]::Clear($taskSecretBytes, 0, $taskSecretBytes.Length) }
        if ($taskPointer -ne [IntPtr]::Zero) { [Omni.AccessBroker.Native]::CredFree($taskPointer) }
    }
}

function Read-VerifiedRegistration([string]$Encoded) {
    if ($Encoded -notmatch '^[A-Za-z0-9+/=]{4,12000}$') { throw 'Invalid credential registration.' }
    $taskBytes = $null
    try {
        $taskBytes = [Convert]::FromBase64String($Encoded)
        $taskRegistration = [Text.Encoding]::UTF8.GetString($taskBytes) | ConvertFrom-Json -ErrorAction Stop
        foreach ($taskName in @('credentialId', 'providerRef', 'accountRef', 'environmentRef')) {
            if ([string]$taskRegistration.$taskName -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$') { throw 'Invalid credential identifier.' }
        }
        if (([string]$taskRegistration.credentialId).Length -gt 80 -or [string]::IsNullOrWhiteSpace([string]$taskRegistration.token) -or [Text.Encoding]::UTF8.GetByteCount([string]$taskRegistration.token) -gt 2400) { throw 'Invalid credential payload.' }
        if ([string]$taskRegistration.renewalMode -notin @('none', 'refresh', 'rotate', 'reauthenticate')) { throw 'Invalid credential renewal.' }
        if ($null -ne $taskRegistration.expiresAt) {
            $taskExpiry = [DateTimeOffset]::Parse([string]$taskRegistration.expiresAt).ToUniversalTime()
            if ($taskExpiry -le [DateTimeOffset]::UtcNow) { throw 'Credential expiry is in the past.' }
            $taskRegistration.expiresAt = $taskExpiry.ToString('o')
        }
        return $taskRegistration
    } finally { if ($null -ne $taskBytes) { [Array]::Clear($taskBytes, 0, $taskBytes.Length) } }
}

function Get-LatestBrokerCredential([string]$CredentialId) {
    $taskLatest = Invoke-Request (@{ operation = 'credential.latest'; credentialId = $CredentialId } | ConvertTo-Json -Compress)
    if (-not $taskLatest.ok) { throw 'Credential lookup failed.' }
    if (-not $taskLatest.found) { return $null }
    $taskReceipt = $taskLatest.credentialJson | ConvertFrom-Json -ErrorAction Stop
    $taskRead = Invoke-Request (@{ operation = 'credential.read'; credentialId = $CredentialId; version = $taskReceipt.version } | ConvertTo-Json -Compress)
    if (-not $taskRead.ok -or -not $taskRead.found) { throw 'Credential lookup failed.' }
    return $taskRead.credential
}

function New-BrokerCredentialEvent($Registration, [long]$Version, [string]$StartedAt, $Verification) {
    return [ordered]@{ eventId = 'credential-test-' + [guid]::NewGuid().ToString('N'); credentialId = $Registration.credentialId; version = $Version; providerRef = $Registration.providerRef; accountRef = $Registration.accountRef; environmentRef = $Registration.environmentRef; startedAt = $StartedAt; completedAt = $Verification.checkedAt; kind = $Verification.outcome; evidenceRef = 'credential-probe-' + [guid]::NewGuid().ToString('N') }
}

function Save-BrokerCredentialVerification($Credential, [string]$StartedAt, $Verification, [long]$ExpectedLatest = 0, [string]$OwnerExpiresAt = '') {
    if ($Verification.outcome -eq 'unsupported') { return $Credential }
    $taskEvent = New-BrokerCredentialEvent $Credential $Credential.version $StartedAt $Verification
    $taskEventBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($taskEvent | ConvertTo-Json -Compress)))
    if ($ExpectedLatest -gt 0) {
        $taskId = [string]$Credential.credentialId
        $taskRevision = [long]$Credential.revision
        $taskExpiryUpdate = ''
        if (-not [string]::IsNullOrWhiteSpace($OwnerExpiresAt)) {
            $taskExpiryInstant = [DateTimeOffset]::Parse($OwnerExpiresAt).ToUniversalTime().ToString('o')
            $taskExpiryUpdate = "UPDATE access.credential_versions SET expires_at = '$taskExpiryInstant'::timestamptz, expiry_kind = 'known', expiry_source = 'owner-attestation' WHERE owner_id = identity.owner_id() AND credential_id = '$taskId' AND version = $ExpectedLatest AND revision = $taskRevision AND status NOT IN ('revoked', 'disabled', 'replaced', 'invalid', 'expired') AND (SELECT MAX(version) FROM access.credential_versions WHERE owner_id = identity.owner_id() AND credential_id = '$taskId') = $ExpectedLatest;"
        }
        $taskQuery = "BEGIN; SET LOCAL ROLE omni_access_admin; SELECT pg_advisory_xact_lock(hashtextextended(identity.owner_id()::text || ':$taskId', 0)); $taskExpiryUpdate SELECT CASE WHEN (SELECT MAX(version) FROM access.credential_versions WHERE owner_id = identity.owner_id() AND credential_id = '$taskId') = $ExpectedLatest THEN access.record_credential_observation(convert_from(decode('$taskEventBase64', 'base64'), 'UTF8')::jsonb, $taskRevision) ELSE jsonb_build_object('outcome', 'conflict') END; COMMIT;"
        $taskResult = (Invoke-BrokerQuery $taskQuery) | ConvertFrom-Json -ErrorAction Stop
        if ($taskResult.outcome -notin @('recorded', 'duplicate')) { throw 'Credential changed while verification was running.' }
        return $taskResult.credential
    }
    $taskObserved = Invoke-Request (@{ operation = 'credential.observe'; eventBase64 = $taskEventBase64; expectedRevision = $Credential.revision } | ConvertTo-Json -Compress)
    if (-not $taskObserved.ok -or $taskObserved.outcome -notin @('recorded', 'duplicate')) { throw 'Credential observation could not be persisted.' }
    return ($taskObserved.credentialJson | ConvertFrom-Json -ErrorAction Stop)
}

function New-BrokerCredentialReceipt($Credential) {
    return [ordered]@{ credentialId = $Credential.credentialId; version = $Credential.version; providerRef = $Credential.providerRef; accountRef = $Credential.accountRef; environmentRef = $Credential.environmentRef; secretRef = $Credential.secretRef; expiresAt = $Credential.expiresAt; status = $Credential.status }
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
    if ($taskRequest.operation -eq 'learning.record-improvement') {
        if ($taskRequest.PSObject.Properties.Name -notcontains 'findingBase64') { return @{ ok = $false; code = 'invalid-request' } }
        $taskFindingBase64 = [string]$taskRequest.findingBase64
        if ($taskFindingBase64 -notmatch '^[A-Za-z0-9+/=]{4,12000}$') { return @{ ok = $false; code = 'invalid-request' } }
        try {
            $taskFindingBytes = [Convert]::FromBase64String($taskFindingBase64)
            if ($taskFindingBytes.Length -gt 9000) { throw 'Operational learning finding is too large.' }
            $taskFindingText = [Text.Encoding]::UTF8.GetString($taskFindingBytes)
            $null = $taskFindingText | ConvertFrom-Json -ErrorAction Stop
            $taskQuery = "BEGIN; SET LOCAL ROLE omni_operations_runtime; SELECT learning.record_improvement_finding(convert_from(decode('$taskFindingBase64', 'base64'), 'UTF8')::jsonb)::text; COMMIT;"
            $taskJson = Invoke-BrokerQuery $taskQuery
            $taskResult = $taskJson | ConvertFrom-Json -ErrorAction Stop
            if ($taskResult.outcome -notin @('recorded', 'duplicate')) { throw 'Unexpected operational learning result.' }
            return @{ ok = $true; outcome = $taskResult.outcome }
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
    if ($taskRequest.operation -eq 'credential.latest') {
        if ($taskRequest.PSObject.Properties.Name -notcontains 'credentialId') { return @{ ok = $false; code = 'invalid-request' } }
        $taskCredentialId = [string]$taskRequest.credentialId
        if ($taskCredentialId -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$') { return @{ ok = $false; code = 'invalid-request' } }
        try {
            $taskQuery = @"
BEGIN;
SET LOCAL ROLE omni_access_admin;
SELECT json_build_object('credentialId', credential_id, 'version', version, 'providerRef', provider_ref, 'accountRef', account_ref, 'environmentRef', environment_ref, 'secretRef', secret_ref, 'expiresAt', CASE WHEN expires_at IS NULL THEN NULL ELSE to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') || 'T' || to_char(expires_at AT TIME ZONE 'UTC', 'HH24:MI:SS.MS') || 'Z' END, 'status', status)::text
FROM access.credential_versions WHERE owner_id = identity.owner_id() AND credential_id = '$taskCredentialId' ORDER BY version DESC LIMIT 1;
COMMIT;
"@
            $taskJson = Invoke-BrokerQuery $taskQuery
            if ($taskJson.Length -eq 0) { return @{ ok = $true; found = $false } }
            return @{ ok = $true; found = $true; credentialJson = $taskJson }
        } catch { return @{ ok = $false; code = 'trusted-operation-failed' } }
    }
    if ($taskRequest.operation -in @('credential.verify', 'credential.register-verified', 'credential.verify-stored')) {
        $taskRegistration = $null
        $taskSecretTarget = $null
        $taskPriorSecret = $null
        $taskStored = $null
        $taskCommitted = $false
        try {
            if ($taskRequest.operation -eq 'credential.verify-stored') {
                if ([string]$taskRequest.credentialId -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$') { return @{ ok = $false; code = 'invalid-request' } }
                $taskStored = Get-LatestBrokerCredential ([string]$taskRequest.credentialId)
                if ($null -eq $taskStored) { return @{ ok = $false; code = 'credential-not-found' } }
                if ($taskStored.status -in @('revoked', 'disabled', 'replaced', 'invalid', 'expired') -or ($null -ne $taskStored.expiresAt -and [DateTimeOffset]::Parse([string]$taskStored.expiresAt) -le [DateTimeOffset]::UtcNow)) { return @{ ok = $false; code = 'credential-blocked' } }
                $taskRegistration = [pscustomobject]@{ credentialId = $taskStored.credentialId; providerRef = $taskStored.providerRef; accountRef = $taskStored.accountRef; environmentRef = $taskStored.environmentRef; token = Get-OwnerCredentialSecret $taskStored.secretRef }
            } else {
                $taskRegistration = Read-VerifiedRegistration ([string]$taskRequest.registrationBase64)
            }
            if ($taskRequest.operation -eq 'credential.register-verified') {
                if ($taskRequest.PSObject.Properties.Name -notcontains 'expectedVersion' -or ($null -ne $taskRequest.expectedVersion -and ([string]$taskRequest.expectedVersion -notmatch '^[1-9][0-9]{0,15}$' -or [long]$taskRequest.expectedVersion -gt 9007199254740991))) { return @{ ok = $false; code = 'invalid-request' } }
                $taskStored = Get-LatestBrokerCredential $taskRegistration.credentialId
                $taskExpected = if ($null -eq $taskRequest.expectedVersion) { 0L } else { [long]$taskRequest.expectedVersion }
                $taskCurrentVersion = if ($null -eq $taskStored) { 0L } else { [long]$taskStored.version }
                if ($taskExpected -ne $taskCurrentVersion) { return @{ ok = $false; code = 'credential-version-conflict' } }
                if ($null -ne $taskStored -and ($taskStored.providerRef -cne $taskRegistration.providerRef -or $taskStored.accountRef -cne $taskRegistration.accountRef -or $taskStored.environmentRef -cne $taskRegistration.environmentRef)) { return @{ ok = $false; code = 'credential-scope-conflict' } }
            }
            $taskStartedAt = [DateTimeOffset]::UtcNow.ToString('o')
            $taskVerification = Invoke-CredentialVerification $taskRegistration
            if ($taskRequest.operation -eq 'credential.verify') { return @{ ok = $true; verification = $taskVerification } }
            if ($taskRequest.operation -eq 'credential.verify-stored') {
                $taskObserved = Save-BrokerCredentialVerification $taskStored $taskStartedAt $taskVerification
                return @{ ok = $true; credential = (New-BrokerCredentialReceipt $taskObserved); verification = $taskVerification }
            }
            if ($taskVerification.outcome -ne 'authenticated') { return @{ ok = $false; code = 'credential-verification-failed' } }
            if ($null -ne $taskStored) {
                $taskPriorSecret = Get-OwnerCredentialSecret $taskStored.secretRef
                if (Test-CredentialPayloadEqual $taskPriorSecret ([string]$taskRegistration.token)) {
                    if ($taskStored.status -in @('revoked', 'disabled', 'replaced', 'invalid', 'expired') -or ($null -ne $taskStored.expiresAt -and [DateTimeOffset]::Parse([string]$taskStored.expiresAt) -le [DateTimeOffset]::UtcNow)) { return @{ ok = $false; code = 'credential-blocked' } }
                    $taskObserved = Save-BrokerCredentialVerification $taskStored $taskStartedAt $taskVerification $taskExpected ([string]$taskRegistration.expiresAt)
                    return @{ ok = $true; credential = (New-BrokerCredentialReceipt $taskObserved); verification = $taskVerification; disposition = 'reused' }
                }
            }
            $taskNonce = [guid]::NewGuid().ToString('N')
            $taskSecretRef = "credential-ref:windows-$($taskRegistration.credentialId)-$taskNonce"
            $taskSecretTarget = "Omni/UserCredential/$($taskRegistration.credentialId)-$taskNonce"
            Set-OwnerCredentialSecret $taskSecretTarget 'Omni-Cracha' ([string]$taskRegistration.token)
            $taskEvent = New-BrokerCredentialEvent $taskRegistration ($taskExpected + 1) $taskStartedAt $taskVerification
            $taskMetadata = [ordered]@{ credentialId = $taskRegistration.credentialId; providerRef = $taskRegistration.providerRef; accountRef = $taskRegistration.accountRef; environmentRef = $taskRegistration.environmentRef; secretRef = $taskSecretRef; expiresAt = $taskRegistration.expiresAt; expiryKind = if ($null -eq $taskRegistration.expiresAt) { 'unknown' } else { 'known' }; expirySource = if ($null -eq $taskRegistration.expiresAt) { 'unknown' } else { 'owner-attestation' }; renewalMode = $taskRegistration.renewalMode; startedAt = $taskStartedAt; event = $taskEvent }
            $taskMetadataBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($taskMetadata | ConvertTo-Json -Compress -Depth 5)))
            # Only safe metadata enters SQL. Insert and append-only observation commit together.
            # status_changed_at precedes the remote attempt so that its success can activate this version.
            $taskQuery = @"
BEGIN;
SET LOCAL ROLE omni_access_admin;
DO `$omni_verified`$
DECLARE
 v_data jsonb := convert_from(decode('$taskMetadataBase64', 'base64'), 'UTF8')::jsonb;
 v_version bigint;
 v_observation jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(identity.owner_id()::text || ':' || (v_data->>'credentialId'), 0));
 SELECT COALESCE(MAX(version), 0) INTO v_version FROM access.credential_versions WHERE owner_id = identity.owner_id() AND credential_id = v_data->>'credentialId';
 IF v_version <> $taskExpected THEN
   PERFORM set_config('omni.credential_result', jsonb_build_object('outcome', 'conflict')::text, true);
   RETURN;
 END IF;
 INSERT INTO access.credential_versions (owner_id, credential_id, version, provider_ref, account_ref, environment_ref, secret_ref, expires_at, expiry_kind, expiry_source, status, status_changed_at, renewal_mode)
 VALUES (identity.owner_id(), v_data->>'credentialId', v_version + 1, v_data->>'providerRef', v_data->>'accountRef', v_data->>'environmentRef', v_data->>'secretRef', (v_data->>'expiresAt')::timestamptz, v_data->>'expiryKind', v_data->>'expirySource', 'unverified', (v_data->>'startedAt')::timestamptz, v_data->>'renewalMode');
 v_observation := access.record_credential_observation(v_data->'event', 1);
 IF v_observation->>'outcome' <> 'recorded' OR v_observation->'credential'->>'status' <> 'active' THEN RAISE EXCEPTION 'Credential verification transaction failed'; END IF;
 PERFORM set_config('omni.credential_result', v_observation::text, true);
END
`$omni_verified`$;
SELECT current_setting('omni.credential_result');
COMMIT;
"@
            $taskSaved = (Invoke-BrokerQuery $taskQuery) | ConvertFrom-Json -ErrorAction Stop
            if ($taskSaved.outcome -eq 'conflict') { return @{ ok = $false; code = 'credential-version-conflict' } }
            if ($taskSaved.outcome -ne 'recorded' -or $null -eq $taskSaved.credential) { throw 'Credential verification transaction failed.' }
            $taskCommitted = $true
            return @{ ok = $true; credential = (New-BrokerCredentialReceipt $taskSaved.credential); verification = $taskVerification; disposition = 'created' }
        } catch { return @{ ok = $false; code = 'credential-operation-failed' } }
        finally {
            if ($null -ne $taskSecretTarget -and -not $taskCommitted) {
                # If a response was lost after COMMIT, preserve the referenced vault entry.
                # An unavailable database cannot prove rollback; leave the protected value for reconciliation.
                try {
                    $taskReconciled = Get-LatestBrokerCredential ([string]$taskRegistration.credentialId)
                    if ($null -eq $taskReconciled -or $taskReconciled.secretRef -cne $taskSecretRef) { Remove-OwnerCredentialSecret $taskSecretTarget }
                } catch { }
            }
            if ($null -ne $taskRegistration) { $taskRegistration.token = $null }
            $taskPriorSecret = $null
        }
    }
    if ($taskRequest.operation -eq 'credential.register') {
        if ($taskRequest.PSObject.Properties.Name -notcontains 'registrationBase64') { return @{ ok = $false; code = 'invalid-request' } }
        $taskRegistrationBase64 = [string]$taskRequest.registrationBase64
        if ($taskRegistrationBase64 -notmatch '^[A-Za-z0-9+/=]{4,12000}$') { return @{ ok = $false; code = 'invalid-request' } }
        $taskSecretTarget = $null
        $taskToken = $null
        try {
            $taskRegistrationBytes = [Convert]::FromBase64String($taskRegistrationBase64)
            if ($taskRegistrationBytes.Length -gt 9000) { throw 'Credential registration is too large.' }
            $taskRegistration = ([Text.Encoding]::UTF8.GetString($taskRegistrationBytes) | ConvertFrom-Json -ErrorAction Stop)
            foreach ($taskName in @('credentialId', 'providerRef', 'accountRef', 'environmentRef')) {
                if ($taskRegistration.PSObject.Properties.Name -notcontains $taskName -or [string]$taskRegistration.$taskName -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$' -or ($taskName -eq 'credentialId' -and ([string]$taskRegistration.$taskName).Length -gt 80)) { throw 'Credential registration identifiers are invalid.' }
            }
            $taskToken = [string]$taskRegistration.token
            if ([string]::IsNullOrWhiteSpace($taskToken) -or $taskToken.Length -gt 2400) { throw 'Credential token is invalid.' }
            $taskRenewal = [string]$taskRegistration.renewalMode
            if ($taskRenewal -notin @('none', 'refresh', 'rotate', 'reauthenticate')) { throw 'Credential renewal mode is invalid.' }
            $taskExpiresAt = if ($null -eq $taskRegistration.expiresAt -or [string]::IsNullOrWhiteSpace([string]$taskRegistration.expiresAt)) { $null } else { ([DateTimeOffset]::Parse([string]$taskRegistration.expiresAt)).ToUniversalTime().ToString('o') }
            $taskExpiryKind = if ($null -eq $taskExpiresAt) { 'unknown' } else { 'known' }
            $taskNonce = [guid]::NewGuid().ToString('N')
            $taskSecretRef = "credential-ref:windows-$($taskRegistration.credentialId)-$taskNonce"
            $taskSecretTarget = "Omni/UserCredential/$($taskRegistration.credentialId)-$taskNonce"
            Set-OwnerCredentialSecret $taskSecretTarget "$($taskRegistration.providerRef):$($taskRegistration.accountRef)" $taskToken
            $taskMetadata = [ordered]@{ credentialId = [string]$taskRegistration.credentialId; providerRef = [string]$taskRegistration.providerRef; accountRef = [string]$taskRegistration.accountRef; environmentRef = [string]$taskRegistration.environmentRef; secretRef = $taskSecretRef; expiresAt = $taskExpiresAt; expiryKind = $taskExpiryKind; renewalMode = $taskRenewal }
            $taskMetadataBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($taskMetadata | ConvertTo-Json -Compress)))
            $taskQuery = @"
BEGIN;
SET LOCAL ROLE omni_access_admin;
WITH source AS (SELECT convert_from(decode('$taskMetadataBase64', 'base64'), 'UTF8')::jsonb AS data),
next_version AS (SELECT COALESCE(MAX(version), 0) + 1 AS version FROM access.credential_versions WHERE owner_id = identity.owner_id() AND credential_id = (SELECT data->>'credentialId' FROM source)),
inserted AS (
  INSERT INTO access.credential_versions (owner_id, credential_id, version, provider_ref, account_ref, environment_ref, secret_ref, expires_at, expiry_kind, expiry_source, status, status_changed_at, renewal_mode)
  SELECT identity.owner_id(), data->>'credentialId', next_version.version, data->>'providerRef', data->>'accountRef', data->>'environmentRef', data->>'secretRef',
         CASE WHEN data->>'expiresAt' IS NULL THEN NULL ELSE (data->>'expiresAt')::timestamptz END, data->>'expiryKind', 'owner-attestation', 'unverified', clock_timestamp(), data->>'renewalMode'
  FROM source CROSS JOIN next_version RETURNING credential_id, version, provider_ref, account_ref, environment_ref, secret_ref, expires_at, status
)
SELECT json_build_object('credentialId', credential_id, 'version', version, 'providerRef', provider_ref, 'accountRef', account_ref, 'environmentRef', environment_ref, 'secretRef', secret_ref, 'expiresAt', CASE WHEN expires_at IS NULL THEN NULL ELSE to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') || 'T' || to_char(expires_at AT TIME ZONE 'UTC', 'HH24:MI:SS.MS') || 'Z' END, 'status', status)::text FROM inserted;
COMMIT;
"@
            $taskReceiptJson = Invoke-BrokerQuery $taskQuery
            $taskReceipt = $taskReceiptJson | ConvertFrom-Json -ErrorAction Stop
            if ($null -eq $taskReceipt -or [string]$taskReceipt.credentialId -ne [string]$taskRegistration.credentialId -or [long]$taskReceipt.version -lt 1) { throw 'Credential registration receipt is invalid.' }
            return @{ ok = $true; credentialJson = $taskReceiptJson }
        } catch {
            if ($null -ne $taskSecretTarget) { Remove-OwnerCredentialSecret $taskSecretTarget }
            return @{ ok = $false; code = 'credential-registration-failed' }
        } finally {
            $taskToken = $null
            if ($null -ne $taskRegistrationBytes) { [Array]::Clear($taskRegistrationBytes, 0, $taskRegistrationBytes.Length) }
        }
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
