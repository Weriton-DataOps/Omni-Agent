param(
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,255}$')]
    [string]$RuntimeCredentialTarget = 'Omni/PostgreSQL/local/access-broker/v1',
    [Parameter(Mandatory = $true)]
    [string]$OutputFile
)

# This is a one-time bridge from the administrator's Credential Manager entry to
# a LocalMachine DPAPI blob used only by the SYSTEM-owned local broker.
$ErrorActionPreference = 'Stop'
$taskOutput = [IO.Path]::GetFullPath($OutputFile)
$taskProgramData = [IO.Path]::GetFullPath((Join-Path $env:ProgramData 'Omni\access-broker'))
if (-not $taskOutput.StartsWith($taskProgramData, [StringComparison]::OrdinalIgnoreCase)) { throw 'Protected credential must remain below ProgramData\\Omni\\access-broker.' }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace Omni.AccessBroker {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct StoredCredential {
        public UInt32 Flags; public UInt32 Type; public IntPtr TargetName; public IntPtr Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public UInt32 CredentialBlobSize;
        public IntPtr CredentialBlob; public UInt32 Persist; public UInt32 AttributeCount; public IntPtr Attributes;
        public IntPtr TargetAlias; public IntPtr UserName;
    }
    public static class CredentialStore {
        [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential);
        [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr credential);
    }
}
'@

$taskPointer = [IntPtr]::Zero
$taskPlain = $null
try {
    if (-not [Omni.AccessBroker.CredentialStore]::CredRead($RuntimeCredentialTarget, 1, 0, [ref]$taskPointer)) { throw 'Runtime credential is unavailable to the administrator identity.' }
    $taskCredential = [Runtime.InteropServices.Marshal]::PtrToStructure($taskPointer, [type][Omni.AccessBroker.StoredCredential])
    $taskUser = if ($taskCredential.UserName -eq [IntPtr]::Zero) { $null } else { [Runtime.InteropServices.Marshal]::PtrToStringUni($taskCredential.UserName) }
    if ($taskUser -ne 'omni_access_broker' -or $taskCredential.CredentialBlobSize -eq 0 -or ($taskCredential.CredentialBlobSize % 2) -ne 0) { throw 'Runtime credential metadata is invalid.' }
    $taskPassword = [Runtime.InteropServices.Marshal]::PtrToStringUni($taskCredential.CredentialBlob, [int]($taskCredential.CredentialBlobSize / 2))
    $taskPlain = [Text.Encoding]::UTF8.GetBytes(([ordered]@{ userName = $taskUser; password = $taskPassword } | ConvertTo-Json -Compress))
    $taskCipher = [Security.Cryptography.ProtectedData]::Protect($taskPlain, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
    try {
        [IO.Directory]::CreateDirectory($taskProgramData) | Out-Null
        [IO.File]::WriteAllBytes($taskOutput, $taskCipher)
        $taskSecurity = New-Object Security.AccessControl.FileSecurity
        $taskSystem = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
        $taskAdmins = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')
        $taskSecurity.SetAccessRuleProtection($true, $false)
        $taskSecurity.SetOwner($taskSystem)
        $taskSecurity.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($taskSystem, 'FullControl', 'Allow')))
        $taskSecurity.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($taskAdmins, 'FullControl', 'Allow')))
        [IO.File]::SetAccessControl($taskOutput, $taskSecurity)
    } finally {
        [Array]::Clear($taskCipher, 0, $taskCipher.Length)
    }
} finally {
    if ($null -ne $taskPlain) { [Array]::Clear($taskPlain, 0, $taskPlain.Length) }
    if ($taskPointer -ne [IntPtr]::Zero) { [Omni.AccessBroker.CredentialStore]::CredFree($taskPointer) }
    $taskPassword = $null
}

[pscustomobject]@{ protectedCredentialCreated = $true; target = $RuntimeCredentialTarget; secretEmitted = $false } | ConvertTo-Json -Compress
