param(
    [string]$DataDirectory = 'runtime\postgresql-5433\data',
    [ValidateRange(1024, 65535)]
    [int]$Port = 5433,
    [Parameter(Mandatory = $true)]
    [string]$ReportPath,
    [switch]$ResumeInitializedCluster
)

# A dedicated user-owned cluster avoids borrowing Overcore or another Windows user's vault entry.
# Passwords exist only in process memory and the current user's Credential Manager; no secret is emitted.
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskReport = [IO.Path]::GetFullPath($ReportPath)
$taskReportsRoot = [IO.Path]::GetFullPath((Join-Path $taskRoot 'out\implementation'))
if (-not $taskReport.StartsWith($taskReportsRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Report path must remain below out\\implementation.' }
if (Test-Path -LiteralPath $taskReport) { throw 'Refusing to overwrite an existing receipt.' }
$taskData = [IO.Path]::GetFullPath((Join-Path $taskRoot $DataDirectory))
$taskDataRoot = [IO.Path]::GetFullPath((Join-Path $taskRoot 'runtime\postgresql-5433'))
if (-not $taskData.StartsWith($taskDataRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Data directory must remain below runtime\\postgresql-5433.' }
if ((Test-Path -LiteralPath $taskData) -and -not $ResumeInitializedCluster) { throw 'Dedicated PostgreSQL data directory already exists; refusing to take it over.' }
$taskBin = 'C:\Program Files\PostgreSQL\18\bin'
$taskInitdb = Join-Path $taskBin 'initdb.exe'
$taskPgCtl = Join-Path $taskBin 'pg_ctl.exe'
$taskPsql = Join-Path $taskBin 'psql.exe'
if (@($taskInitdb, $taskPgCtl, $taskPsql | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) }).Count -ne 0) { throw 'PostgreSQL 18 binaries are unavailable.' }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace Omni.DedicatedProvisioning {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct Credential { public UInt32 Flags; public UInt32 Type; public IntPtr TargetName; public IntPtr Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist; public UInt32 AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName; }
    public static class Vault {
        [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool CredWrite(ref Credential credential, UInt32 flags);
        public static bool Write(string target, string username, string secret, out int error) {
            byte[] bytes = System.Text.Encoding.Unicode.GetBytes(secret); IntPtr blob = IntPtr.Zero; IntPtr targetPtr = IntPtr.Zero; IntPtr usernamePtr = IntPtr.Zero;
            try { blob = Marshal.AllocHGlobal(bytes.Length); Marshal.Copy(bytes, 0, blob, bytes.Length); targetPtr = Marshal.StringToCoTaskMemUni(target); usernamePtr = Marshal.StringToCoTaskMemUni(username); Credential credential = new Credential { Type = 1, TargetName = targetPtr, CredentialBlobSize = (UInt32)bytes.Length, CredentialBlob = blob, Persist = 2, UserName = usernamePtr }; bool written = CredWrite(ref credential, 0); error = written ? 0 : Marshal.GetLastWin32Error(); return written; }
            finally { if (blob != IntPtr.Zero) { for (int i = 0; i < bytes.Length; i++) Marshal.WriteByte(blob, i, 0); Marshal.FreeHGlobal(blob); } Array.Clear(bytes, 0, bytes.Length); if (targetPtr != IntPtr.Zero) Marshal.FreeCoTaskMem(targetPtr); if (usernamePtr != IntPtr.Zero) Marshal.FreeCoTaskMem(usernamePtr); }
        }
    }
}
'@

function New-Secret {
    $taskBytes = New-Object byte[] 36
    $taskRandom = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $taskRandom.GetBytes($taskBytes); return [Convert]::ToBase64String($taskBytes) } finally { [Array]::Clear($taskBytes, 0, $taskBytes.Length); $taskRandom.Dispose() }
}
function Invoke-TrustedPsql([string]$UserName, [string]$Query) {
    $taskStart = New-Object Diagnostics.ProcessStartInfo
    $taskStart.FileName = $taskPsql; $taskStart.UseShellExecute = $false; $taskStart.CreateNoWindow = $true; $taskStart.RedirectStandardOutput = $true; $taskStart.RedirectStandardError = $true
    $taskArguments = @('-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', $Port.ToString(), '-U', $UserName, '-d', 'postgres', '-c', $Query)
    if ($taskStart.PSObject.Properties.Name -contains 'ArgumentList') { foreach ($taskArgument in $taskArguments) { [void]$taskStart.ArgumentList.Add($taskArgument) } } else { $taskStart.Arguments = (($taskArguments | ForEach-Object { '"' + $_ + '"' }) -join ' ') }
    $taskProcess = [Diagnostics.Process]::Start($taskStart); $taskOutput = $taskProcess.StandardOutput.ReadToEnd(); $taskError = $taskProcess.StandardError.ReadToEnd(); $taskProcess.WaitForExit()
    if ($taskProcess.ExitCode -ne 0) { throw 'Dedicated bootstrap database operation failed.' }
    return $taskOutput.Trim()
}

$taskAdminTarget = 'Omni/PostgreSQL/dedicated-5433/admin/v1'
$taskRuntimeTarget = 'Omni/PostgreSQL/dedicated-5433/access-broker/v1'
$taskAdminPassword = $null
try {
    if (-not $ResumeInitializedCluster) {
        [IO.Directory]::CreateDirectory($taskDataRoot) | Out-Null
        $taskPriorPreference = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { $taskInitOutput = & $taskInitdb '-D' $taskData '-U' 'omni_bootstrap' '--encoding=UTF8' '--no-locale' '--auth-host=trust' '--auth-local=trust' 2>&1; $taskInitExit = $LASTEXITCODE } finally { $ErrorActionPreference = $taskPriorPreference }
        if ($taskInitExit -ne 0) { throw 'Dedicated PostgreSQL initialization failed.' }
        $taskPriorPreference = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { $taskStartOutput = & $taskPgCtl '-D' $taskData '-w' '-t' '30' '-o' "-p $Port -h 127.0.0.1" 'start' 2>&1; $taskStartExit = $LASTEXITCODE } finally { $ErrorActionPreference = $taskPriorPreference }
        if ($taskStartExit -ne 0) { throw 'Dedicated PostgreSQL did not start.' }
    } else {
        $taskPriorPreference = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { $taskStatusOutput = & $taskPgCtl '-D' $taskData 'status' 2>&1; $taskStatusExit = $LASTEXITCODE } finally { $ErrorActionPreference = $taskPriorPreference }
        if ($taskStatusExit -ne 0) { throw 'Initialized dedicated PostgreSQL is not running.' }
    }
    $taskAdminPassword = New-Secret
    [void](Invoke-TrustedPsql 'omni_bootstrap' "ALTER ROLE omni_bootstrap PASSWORD '$taskAdminPassword';")
    $taskWriteError = 0
    if (-not [Omni.DedicatedProvisioning.Vault]::Write($taskAdminTarget, 'omni_bootstrap', $taskAdminPassword, [ref]$taskWriteError)) { throw "Dedicated admin credential write failed (Win32 $taskWriteError)." }
    $taskHba = Join-Path $taskData 'pg_hba.conf'
    $taskLines = [IO.File]::ReadAllLines($taskHba)
    $taskChanged = $false
    $taskLines = $taskLines | ForEach-Object { if ($_ -match '^\s*host\s+all\s+all\s+(?:127\.0\.0\.1/32|::1/128)\s+trust(?:\s|$)') { $taskChanged = $true; $_ -replace '\btrust\b', 'scram-sha-256' } else { $_ } }
    if (-not $taskChanged) { throw 'Dedicated PostgreSQL authentication configuration was unexpected.' }
    [IO.File]::WriteAllText($taskHba, (($taskLines -join [Environment]::NewLine) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
    $taskPriorPreference = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $taskReloadOutput = & $taskPgCtl '-D' $taskData 'reload' 2>&1; $taskReloadExit = $LASTEXITCODE } finally { $ErrorActionPreference = $taskPriorPreference }
    if ($taskReloadExit -ne 0) { throw 'Dedicated PostgreSQL authentication configuration did not reload.' }
    & (Join-Path $PSScriptRoot 'provision-omni-postgresql.ps1') -AdminCredentialTarget $taskAdminTarget -RuntimeCredentialTarget $taskRuntimeTarget -PostgreSqlHost '127.0.0.1' -Port $Port -ReportPath $taskReport
    if ($LASTEXITCODE -ne 0) { throw 'Dedicated Omni foundation bootstrap failed.' }
} finally {
    $taskAdminPassword = $null
}
