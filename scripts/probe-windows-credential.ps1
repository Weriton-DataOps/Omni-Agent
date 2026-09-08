param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,255}$')]
    [string]$Target
)

# Read-only bootstrap diagnostic. The password is never copied, decoded or emitted.
$ErrorActionPreference = 'Stop'
$taskCredentialTarget = $Target
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace Omni.BootstrapDiagnostics {
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
        [DllImport("advapi32.dll")]
        public static extern void CredFree(IntPtr credential);
    }
}
'@

$taskPointer = [IntPtr]::Zero
$taskFound = [Omni.BootstrapDiagnostics.Native]::CredRead($taskCredentialTarget, 1, 0, [ref]$taskPointer)
$taskWin32Error = if ($taskFound) { 0 } else { [Runtime.InteropServices.Marshal]::GetLastWin32Error() }
$taskIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$taskResult = [ordered]@{
    checkedAt = [DateTimeOffset]::UtcNow.ToString('o')
    target = $taskCredentialTarget
    windowsIdentity = $taskIdentity.Name
    windowsSid = $taskIdentity.User.Value
    found = $taskFound
    win32Error = $taskWin32Error
    status = if ($taskFound) { 'credential-metadata-present' } elseif ($taskWin32Error -eq 1168) { 'credential-not-found' } elseif ($taskWin32Error -eq 1312) { 'credential-store-unavailable' } else { 'credential-read-error' }
    databaseAuthenticationVerified = $false
    bootstrapReady = $false
    secretDecoded = $false
    secretEmitted = $false
}
try {
    if ($taskFound) {
        $taskCredential = [Runtime.InteropServices.Marshal]::PtrToStructure($taskPointer, [type][Omni.BootstrapDiagnostics.Credential])
        $taskResult['credentialType'] = $taskCredential.Type
        $taskResult['persistence'] = $taskCredential.Persist
        $taskResult['username'] = [Runtime.InteropServices.Marshal]::PtrToStringUni($taskCredential.UserName)
        $taskResult['hasSecret'] = $taskCredential.CredentialBlobSize -gt 0
    }
} finally {
    if ($taskPointer -ne [IntPtr]::Zero) { [Omni.BootstrapDiagnostics.Native]::CredFree($taskPointer) }
    $taskIdentity.Dispose()
}
$taskResult | ConvertTo-Json -Compress
# Existence is not a successful database login. Absence must fail the diagnostic gate.
if (-not $taskFound) {
    if ($taskWin32Error -eq 1168) { exit 2 }
    if ($taskWin32Error -eq 1312) { exit 3 }
    exit 1
}
