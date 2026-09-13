$ErrorActionPreference = 'Stop'
# Fixed, read-only inventory; no supplied SQL, no secret values in output.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace Omni.ReadOnlyInventory {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct Credential { public UInt32 Flags; public UInt32 Type; public IntPtr TargetName; public IntPtr Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist; public UInt32 AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName; }
 public static class Vault { [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential); [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr credential); }
}
'@
$taskPointer = [IntPtr]::Zero
try {
 if (-not [Omni.ReadOnlyInventory.Vault]::CredRead('Omni/PostgreSQL/dedicated-5433/admin/v1',1,0,[ref]$taskPointer)) { throw 'Credencial administrativa não disponível no cofre desta conta.' }
 $taskCredential=[Runtime.InteropServices.Marshal]::PtrToStructure($taskPointer,[type][Omni.ReadOnlyInventory.Credential])
 $taskStart=New-Object Diagnostics.ProcessStartInfo
 $taskStart.FileName='C:\Program Files\PostgreSQL\18\bin\psql.exe'
 $taskStart.UseShellExecute=$false; $taskStart.CreateNoWindow=$true
 $taskStart.RedirectStandardInput=$true; $taskStart.RedirectStandardOutput=$true; $taskStart.RedirectStandardError=$true
 $taskStart.StandardOutputEncoding=[Text.Encoding]::UTF8
 $taskStart.Environment['PGPASSWORD']=[Runtime.InteropServices.Marshal]::PtrToStringUni($taskCredential.CredentialBlob,[int]($taskCredential.CredentialBlobSize/2))
 $taskStart.Environment['PGOPTIONS']='-c default_transaction_read_only=on -c statement_timeout=10000'
 $taskUser=[Runtime.InteropServices.Marshal]::PtrToStringUni($taskCredential.UserName)
 if($taskUser -notmatch '^[a-zA-Z_][a-zA-Z0-9_]*$'){throw 'Identidade inválida.'}
 $taskStart.Arguments="-X -q -A -t -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5433 -U $taskUser -d omni"
 $taskProcess=[Diagnostics.Process]::Start($taskStart)
 [void]$taskStart.Environment.Remove('PGPASSWORD')
 $taskProcess.StandardInput.WriteLine(@'
BEGIN TRANSACTION READ ONLY;
SELECT json_build_object('database',current_database(),'port',inet_server_port(),'readOnly',current_setting('transaction_read_only'),'size',pg_size_pretty(pg_database_size(current_database())));
SELECT json_agg(t) FROM (SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1,2) t;
SELECT json_build_object('memory', (SELECT count(*) FROM memory.entries), 'imports',(SELECT count(*) FROM memory.import_receipts),'missions',(SELECT count(*) FROM operations.missions),'missionEvents',(SELECT count(*) FROM operations.mission_events),'credentialVersions',(SELECT count(*) FROM access.credential_versions),'credentialEvents',(SELECT count(*) FROM audit.credential_events));
SELECT json_agg(t) FROM (SELECT lane,memory_type,count(*) AS total FROM memory.entries GROUP BY lane,memory_type ORDER BY 1,2) t;
SELECT json_agg(t) FROM (SELECT mission_id,objective,state,updated_at FROM operations.missions ORDER BY updated_at DESC LIMIT 15) t;
SELECT json_agg(t) FROM (SELECT provider_ref,status,expiry_kind,expires_at,count(*) AS total FROM access.credential_versions GROUP BY 1,2,3,4) t;
SELECT json_agg(t) FROM (SELECT id FROM omni_meta.schema_migrations ORDER BY id) t;
SELECT json_agg(t) FROM (SELECT lane,memory_type,left(payload->>'text',240) AS sample FROM memory.entries WHERE memory_type IN ('preference','procedural','semantic') ORDER BY source_updated_at DESC LIMIT 12) t;
ROLLBACK;
'@)
 $taskProcess.StandardInput.Close()
 $taskOutput=$taskProcess.StandardOutput.ReadToEnd()
 $taskError=$taskProcess.StandardError.ReadToEnd()
 $taskProcess.WaitForExit()
 if($taskProcess.ExitCode -ne 0){throw 'A consulta somente leitura não concluiu.'}
 [Console]::OutputEncoding=[Text.Encoding]::UTF8
 Write-Output $taskOutput
} finally {
 if($taskPointer -ne [IntPtr]::Zero){[Omni.ReadOnlyInventory.Vault]::CredFree($taskPointer)}
}
