[CmdletBinding()]
param(
    [switch]$Rotate
)

# Creates or rotates a human, read-only database login.  The bootstrap
# credential is consumed only inside this process and is never displayed,
# written to disk, or put on a command line.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$taskAdminTarget = 'Omni/PostgreSQL/dedicated-5433/admin/v1'
$taskRole = 'omni_observer'
$taskPsql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'

if (-not (Test-Path -LiteralPath $taskPsql -PathType Leaf)) {
    throw 'Cliente PostgreSQL 18 não está disponível nesta máquina.'
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace Omni.DatabaseObserver {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct Credential {
    public UInt32 Flags; public UInt32 Type; public IntPtr TargetName; public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob; public UInt32 Persist; public UInt32 AttributeCount; public IntPtr Attributes;
    public IntPtr TargetAlias; public IntPtr UserName;
  }
  public static class Vault {
    [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential);
    [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr credential);
  }
}
'@

function Read-AdminCredential {
    $taskPointer = [IntPtr]::Zero
    try {
        if (-not [Omni.DatabaseObserver.Vault]::CredRead($taskAdminTarget, 1, 0, [ref]$taskPointer)) {
            throw 'A credencial administrativa do PostgreSQL não está disponível no cofre desta conta.'
        }
        $taskCredential = [Runtime.InteropServices.Marshal]::PtrToStructure($taskPointer, [type][Omni.DatabaseObserver.Credential])
        $taskUser = [Runtime.InteropServices.Marshal]::PtrToStringUni($taskCredential.UserName)
        $taskPassword = [Runtime.InteropServices.Marshal]::PtrToStringUni($taskCredential.CredentialBlob, [int]($taskCredential.CredentialBlobSize / 2))
        if ($taskUser -ne 'omni_bootstrap' -or [string]::IsNullOrWhiteSpace($taskPassword)) {
            throw 'A credencial administrativa do PostgreSQL é inválida.'
        }
        return [pscustomobject]@{ UserName = $taskUser; Password = $taskPassword }
    } finally {
        if ($taskPointer -ne [IntPtr]::Zero) { [Omni.DatabaseObserver.Vault]::CredFree($taskPointer) }
    }
}

function Read-PlainSecret([securestring]$Secret) {
    $taskPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secret)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer) }
}

function Invoke-OmniPsql([string]$UserName, [string]$Password, [string]$Sql) {
    $taskStart = [Diagnostics.ProcessStartInfo]::new()
    $taskStart.FileName = $taskPsql
    $taskStart.UseShellExecute = $false
    $taskStart.CreateNoWindow = $true
    $taskStart.RedirectStandardInput = $true
    $taskStart.RedirectStandardOutput = $true
    $taskStart.RedirectStandardError = $true
    $taskStart.StandardOutputEncoding = [Text.Encoding]::UTF8
    $taskStart.Environment['PGPASSWORD'] = $Password
    $taskArgs = @('-X', '-q', '-A', '-t', '-w', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', '5433', '-U', $UserName, '-d', 'omni')
    if ($taskStart.PSObject.Properties.Name -contains 'ArgumentList') {
        foreach ($taskArg in $taskArgs) { [void]$taskStart.ArgumentList.Add($taskArg) }
    } else {
        $taskStart.Arguments = (($taskArgs | ForEach-Object { '"' + $_ + '"' }) -join ' ')
    }
    $taskProcess = [Diagnostics.Process]::Start($taskStart)
    [void]$taskStart.Environment.Remove('PGPASSWORD')
    try {
        $taskProcess.StandardInput.Write($Sql)
        $taskProcess.StandardInput.Close()
        $taskOutput = $taskProcess.StandardOutput.ReadToEnd()
        $taskError = $taskProcess.StandardError.ReadToEnd()
        $taskProcess.WaitForExit()
        if ($taskProcess.ExitCode -ne 0) { throw "A operação PostgreSQL não foi concluída (exit $($taskProcess.ExitCode))." }
        return $taskOutput.Trim()
    } finally {
        $taskProcess.Dispose()
    }
}

$taskAdmin = $null
$taskPassword = $null
try {
    $taskAdmin = Read-AdminCredential
    $taskExisting = Invoke-OmniPsql $taskAdmin.UserName $taskAdmin.Password "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$taskRole');"
    if ($taskExisting -eq 't' -and -not $Rotate) {
        throw "O usuário $taskRole já existe. Para trocar sua senha de consulta, execute este mesmo script com -Rotate."
    }

    $taskSecret = Read-Host -AsSecureString 'Defina a senha do seu usuário somente-leitura (mínimo 16 caracteres)'
    $taskConfirmation = Read-Host -AsSecureString 'Repita a senha'
    $taskPassword = Read-PlainSecret $taskSecret
    $taskRepeat = Read-PlainSecret $taskConfirmation
    if ($taskPassword -cne $taskRepeat) { throw 'As senhas não coincidem.' }
    if ($taskPassword.Length -lt 16 -or $taskPassword.Length -gt 128 -or $taskPassword -notmatch '[A-Z]' -or $taskPassword -notmatch '[a-z]' -or $taskPassword -notmatch '\d' -or $taskPassword -notmatch '[^A-Za-z0-9\s]') {
        throw 'Use de 16 a 128 caracteres, com maiúscula, minúscula, número e símbolo.'
    }
    $taskPasswordSql = "'" + $taskPassword.Replace("'", "''") + "'"
    $taskSetup = @'
BEGIN;
DO $observer$
DECLARE v_owner uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omni_observer') THEN
    CREATE ROLE omni_observer LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS CONNECTION LIMIT 2;
  END IF;
  SELECT owner_id INTO v_owner FROM identity.login_owners WHERE login_name = 'omni_access_broker';
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Omni runtime owner mapping is unavailable'; END IF;
  INSERT INTO identity.login_owners (login_name, owner_id) VALUES ('omni_observer', v_owner)
    ON CONFLICT (login_name) DO UPDATE SET owner_id = EXCLUDED.owner_id;
END
$observer$;
ALTER ROLE omni_observer LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD
'@ + ' ' + $taskPasswordSql + @'
;
ALTER ROLE omni_observer SET default_transaction_read_only = 'on';
ALTER ROLE omni_observer SET statement_timeout = '10s';
ALTER ROLE omni_observer SET lock_timeout = '2s';
REVOKE ALL ON SCHEMA identity, memory, operations, access, audit, learning, omni_meta FROM omni_observer;
REVOKE ALL ON ALL TABLES IN SCHEMA identity, memory, operations, access, audit, learning, omni_meta FROM omni_observer;
GRANT CONNECT ON DATABASE omni TO omni_observer;
GRANT USAGE ON SCHEMA identity, memory, operations, access, audit, learning, omni_meta TO omni_observer;
GRANT EXECUTE ON FUNCTION identity.owner_id() TO omni_observer;
GRANT SELECT ON memory.entries, memory.import_receipts, operations.missions, operations.mission_events,
  access.credential_versions, audit.credential_events, learning.improvement_findings,
  learning.improvement_events, omni_meta.schema_migrations TO omni_observer;
COMMIT;
'@
    [void](Invoke-OmniPsql $taskAdmin.UserName $taskAdmin.Password $taskSetup)

    $taskVerification = Invoke-OmniPsql $taskRole $taskPassword @'
BEGIN READ ONLY;
SELECT json_build_object(
  'role', session_user,
  'database', current_database(),
  'readOnly', current_setting('transaction_read_only'),
  'ownerMapped', identity.owner_id() IS NOT NULL,
  'memoryEntries', (SELECT count(*) FROM memory.entries),
  'canInsertMemory', has_table_privilege('memory.entries', 'INSERT'),
  'isSuperuser', (SELECT rolsuper FROM pg_roles WHERE rolname = session_user),
  'canCreateRole', (SELECT rolcreaterole FROM pg_roles WHERE rolname = session_user)
)::text;
ROLLBACK;
'@
    $taskResult = $taskVerification | ConvertFrom-Json
    if ($taskResult.role -ne $taskRole -or $taskResult.database -ne 'omni' -or $taskResult.readOnly -ne 'on' -or -not $taskResult.ownerMapped -or $taskResult.canInsertMemory -or $taskResult.isSuperuser -or $taskResult.canCreateRole) {
        throw 'A verificação recusou o acesso: o usuário não ficou limitado a leitura.'
    }
    [pscustomobject]@{
        outcome = if ($taskExisting -eq 't') { 'password-rotated' } else { 'created' }
        role = $taskRole
        host = '127.0.0.1'
        port = 5433
        database = 'omni'
        access = 'read-only'
        visibleMemoryEntries = [int]$taskResult.memoryEntries
        passwordEmitted = $false
    } | ConvertTo-Json -Compress
} finally {
    $taskPassword = $null
    if ($null -ne $taskAdmin) { $taskAdmin.Password = $null; $taskAdmin = $null }
}
