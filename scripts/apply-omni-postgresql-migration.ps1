param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,255}$')]
    [string]$AdminCredentialTarget,
    [Parameter(Mandatory = $true)]
    [string]$MigrationPath,
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d{3}-[a-z0-9-]+\.sql$')]
    [string]$MigrationFileName,
    [Parameter(Mandatory = $true)]
    [string]$ReportPath,
    [ValidatePattern('^(?:127\.0\.0\.1|localhost)$')]
    [string]$PostgreSqlHost = '127.0.0.1',
    [ValidateRange(1024, 65535)]
    [int]$Port = 5433
)

# The administrator credential is used only in memory to apply an immutable, checksummed migration.
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskReport = [IO.Path]::GetFullPath($ReportPath)
$taskReportsRoot = [IO.Path]::GetFullPath((Join-Path $taskRoot 'out\implementation'))
if (-not $taskReport.StartsWith($taskReportsRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Report path must remain below out\\implementation.' }
if (Test-Path -LiteralPath $taskReport) { throw 'Refusing to overwrite an existing migration receipt.' }
$taskMigration = [IO.Path]::GetFullPath($MigrationPath)
$taskMigrationsRoot = [IO.Path]::GetFullPath((Join-Path $taskRoot 'adaptadores\postgresql\migrations'))
if (-not $taskMigration.StartsWith($taskMigrationsRoot, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($taskMigration) -ne $MigrationFileName) { throw 'Migration path is outside the approved directory.' }
$taskPsql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
if (-not (Test-Path -LiteralPath $taskPsql -PathType Leaf) -or -not (Test-Path -LiteralPath $taskMigration -PathType Leaf)) { throw 'Migration prerequisites are unavailable.' }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace Omni.Migration {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct Credential { public UInt32 Flags; public UInt32 Type; public IntPtr TargetName; public IntPtr Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist; public UInt32 AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName; }
  public static class Vault { [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential); [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr credential); }
}
'@

$taskPointer = [IntPtr]::Zero
$taskPassword = $null
$taskReceipt = [ordered]@{ schemaVersion = 1; kind = 'omni-postgresql-migration'; migration = $MigrationFileName; checksum = (Get-FileHash -Algorithm SHA256 -LiteralPath $taskMigration).Hash.ToLowerInvariant(); endpoint = "$PostgreSqlHost`:$Port"; outcome = 'not-started'; secretEmitted = $false; appliedAt = [DateTimeOffset]::UtcNow.ToString('o') }
try {
  if (-not [Omni.Migration.Vault]::CredRead($AdminCredentialTarget, 1, 0, [ref]$taskPointer)) { throw 'Administrative migration credential is unavailable.' }
  $taskCredential = [Runtime.InteropServices.Marshal]::PtrToStructure($taskPointer, [type][Omni.Migration.Credential])
  $taskUser = [Runtime.InteropServices.Marshal]::PtrToStringUni($taskCredential.UserName)
  $taskPassword = [Runtime.InteropServices.Marshal]::PtrToStringUni($taskCredential.CredentialBlob, [int]($taskCredential.CredentialBlobSize / 2))
  if ($taskUser -notmatch '^[a-zA-Z_][a-zA-Z0-9_]{0,62}$' -or [string]::IsNullOrEmpty($taskPassword)) { throw 'Administrative migration credential metadata is invalid.' }
  $taskStart = New-Object Diagnostics.ProcessStartInfo
  $taskStart.FileName = $taskPsql; $taskStart.UseShellExecute = $false; $taskStart.CreateNoWindow = $true; $taskStart.RedirectStandardOutput = $true; $taskStart.RedirectStandardError = $true
  $taskStart.Environment['PGPASSWORD'] = $taskPassword
  $taskArguments = @('-X','-q','-v','ON_ERROR_STOP=1','-v',"migration_checksum=$($taskReceipt.checksum)",'-h',$PostgreSqlHost,'-p',$Port.ToString(),'-U',$taskUser,'-d','omni','-f',$taskMigration)
  if ($taskStart.PSObject.Properties.Name -contains 'ArgumentList') { foreach ($taskArgument in $taskArguments) { [void]$taskStart.ArgumentList.Add($taskArgument) } } else { $taskStart.Arguments = (($taskArguments | ForEach-Object { '"' + $_ + '"' }) -join ' ') }
  $taskProcess = [Diagnostics.Process]::Start($taskStart); $taskOutput = $taskProcess.StandardOutput.ReadToEnd(); $taskError = $taskProcess.StandardError.ReadToEnd(); $taskProcess.WaitForExit()
  if ($taskProcess.ExitCode -ne 0) { throw 'Checksummed database migration failed.' }
  $taskReceipt.outcome = 'applied'
} catch {
  $taskReceipt.outcome = 'failed-closed'; $taskReceipt.failureCategory = $_.Exception.GetType().Name
} finally {
  if ($null -ne $taskPointer -and $taskPointer -ne [IntPtr]::Zero) { [Omni.Migration.Vault]::CredFree($taskPointer) }
  $taskPassword = $null
  [IO.File]::WriteAllText($taskReport, ($taskReceipt | ConvertTo-Json -Compress) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
}
if ($taskReceipt.outcome -ne 'applied') { exit 1 }
