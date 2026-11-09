param([string]$Saida)
$ErrorActionPreference = 'Stop'
# Exporta do PostgreSQL 5433 as missões, o livro de aprendizado e os ids de memória para o
# importador da casa (scripts/omni-importar-5433.mjs). Só leitura: transação READ ONLY e
# default_transaction_read_only no servidor. O psql grava o JSON direto no arquivo (\o); a
# saída deste script é só a contagem. A senha nunca aparece: vai no ambiente do psql e sai dele.
if (-not $Saida) {
 $taskPasta = Join-Path $env:LOCALAPPDATA 'omni\backup'
 $Saida = Join-Path $taskPasta ('5433-{0}.json' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
}
$Saida = [IO.Path]::GetFullPath($Saida)
if ($Saida.Contains("'")) { throw 'Caminho de saída com aspas simples não é aceito.' }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Saida) | Out-Null
$taskDestino = $Saida.Replace('\', '/')

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace Omni.Export5433 {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct Credential { public UInt32 Flags; public UInt32 Type; public IntPtr TargetName; public IntPtr Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist; public UInt32 AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName; }
 public static class Vault { [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential); [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr credential); }
}
'@

$taskSql = @'
BEGIN TRANSACTION READ ONLY;
DO $$ BEGIN
 IF (SELECT count(*) FROM (
   SELECT owner_id FROM operations.missions UNION SELECT owner_id FROM operations.mission_events
   UNION SELECT owner_id FROM learning.improvement_findings UNION SELECT owner_id FROM learning.improvement_events
   UNION SELECT owner_id FROM memory.entries) donos) > 1
 THEN RAISE EXCEPTION 'mais de um dono no 5433; exportacao abortada'; END IF;
END $$;
\o '__DESTINO__'
SELECT jsonb_build_object(
 'missoes', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', mission_id, 'objective', objective, 'state', state, 'priority', priority,
   'payload', payload, 'version', version, 'createdAt', created_at, 'updatedAt', updated_at, 'closedAt', closed_at) ORDER BY mission_id)
   FROM operations.missions), '[]'::jsonb),
 'missaoEventos', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', event_id, 'missionId', mission_id, 'kind', kind,
   'observedAt', observed_at, 'payload', payload) ORDER BY event_id) FROM operations.mission_events), '[]'::jsonb),
 'achados', COALESCE((SELECT jsonb_agg(jsonb_build_object('findingId', finding_id, 'candidateFingerprint', candidate_fingerprint,
   'category', category, 'destination', destination, 'state', state, 'occurrences', occurrences,
   'statementFingerprint', statement_fingerprint, 'sourceFingerprint', source_fingerprint, 'artifactFingerprint', artifact_fingerprint,
   'releaseVersion', release_version, 'firstObservedAt', first_observed_at, 'lastObservedAt', last_observed_at) ORDER BY finding_id)
   FROM learning.improvement_findings), '[]'::jsonb),
 'achadoEventos', COALESCE((SELECT jsonb_agg(jsonb_build_object('eventId', event_id, 'findingId', finding_id, 'observedAt', observed_at,
   'state', state, 'occurrences', occurrences, 'sourceFingerprint', source_fingerprint, 'artifactFingerprint', artifact_fingerprint,
   'releaseVersion', release_version) ORDER BY event_id) FROM learning.improvement_events), '[]'::jsonb),
 'memorias', COALESCE((SELECT jsonb_agg(memory_id ORDER BY memory_id) FROM memory.entries), '[]'::jsonb)
);
\o
SELECT json_build_object('missoes', (SELECT count(*) FROM operations.missions), 'missaoEventos', (SELECT count(*) FROM operations.mission_events),
 'achados', (SELECT count(*) FROM learning.improvement_findings), 'achadoEventos', (SELECT count(*) FROM learning.improvement_events),
 'memorias', (SELECT count(*) FROM memory.entries));
ROLLBACK;
'@
$taskSql = $taskSql.Replace('__DESTINO__', $taskDestino)

$taskPointer = [IntPtr]::Zero
try {
 if (-not [Omni.Export5433.Vault]::CredRead('Omni/PostgreSQL/dedicated-5433/admin/v1', 1, 0, [ref]$taskPointer)) { throw 'Credencial administrativa não disponível no cofre desta conta.' }
 $taskCredential = [Runtime.InteropServices.Marshal]::PtrToStructure($taskPointer, [type][Omni.Export5433.Credential])
 $taskUser = [Runtime.InteropServices.Marshal]::PtrToStringUni($taskCredential.UserName)
 if ($taskUser -notmatch '^[a-zA-Z_][a-zA-Z0-9_]*$') { throw 'Identidade inválida.' }
 $taskStart = New-Object Diagnostics.ProcessStartInfo
 $taskStart.FileName = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
 $taskStart.UseShellExecute = $false; $taskStart.CreateNoWindow = $true
 $taskStart.RedirectStandardInput = $true; $taskStart.RedirectStandardOutput = $true; $taskStart.RedirectStandardError = $true
 $taskStart.StandardOutputEncoding = [Text.Encoding]::UTF8
 $taskStart.Environment['PGPASSWORD'] = [Runtime.InteropServices.Marshal]::PtrToStringUni($taskCredential.CredentialBlob, [int]($taskCredential.CredentialBlobSize / 2))
 $taskStart.Environment['PGOPTIONS'] = '-c default_transaction_read_only=on -c statement_timeout=120000'
 $taskStart.Environment['PGCLIENTENCODING'] = 'UTF8'
 $taskStart.Arguments = "-X -q -A -t -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5433 -U $taskUser -d omni"
 $taskProcess = [Diagnostics.Process]::Start($taskStart)
 [void]$taskStart.Environment.Remove('PGPASSWORD')
 $taskStdin = New-Object IO.StreamWriter($taskProcess.StandardInput.BaseStream, (New-Object Text.UTF8Encoding($false)))
 $taskStdin.Write($taskSql)
 $taskStdin.Close()
 $taskOutput = $taskProcess.StandardOutput.ReadToEnd()
 $taskError = $taskProcess.StandardError.ReadToEnd()
 $taskProcess.WaitForExit()
 if ($taskProcess.ExitCode -ne 0) {
   if (Test-Path -LiteralPath $Saida) { Remove-Item -LiteralPath $Saida -Force }
   if ($taskError -match 'mais de um dono') { throw 'Mais de um dono no 5433; exportação abortada.' }
   throw 'A exportação somente leitura não concluiu.'
 }
 [Console]::OutputEncoding = [Text.Encoding]::UTF8
 Write-Output ([ordered]@{ arquivo = (Split-Path -Leaf $Saida); contagens = ($taskOutput.Trim() | ConvertFrom-Json) } | ConvertTo-Json -Compress)
} finally {
 if ($taskPointer -ne [IntPtr]::Zero) { [Omni.Export5433.Vault]::CredFree($taskPointer) }
}
