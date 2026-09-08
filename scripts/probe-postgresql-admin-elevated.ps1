param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,255}$')]
    [string]$Target,
    [Parameter(Mandatory = $true)]
    [string]$ReportPath
)

# This wrapper is intentionally elevation-safe: it calls the metadata-only probe and
# persists a sanitized receipt. It never receives or serializes CredentialBlob.
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskProbe = Join-Path $PSScriptRoot 'probe-windows-credential.ps1'
$taskReport = [IO.Path]::GetFullPath($ReportPath)
if (-not $taskReport.StartsWith([IO.Path]::GetFullPath((Join-Path $taskRoot 'out\implementation')), [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Report path must remain below out\\implementation.'
}

$taskProbeOutput = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $taskProbe -Target $Target
$taskProbeExit = $LASTEXITCODE
$taskProbeDocument = $taskProbeOutput | ConvertFrom-Json
$taskIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
try {
    $taskReceipt = [ordered]@{
        schemaVersion = 1
        kind = 'elevated-windows-credential-metadata-probe'
        checkedAt = [DateTimeOffset]::UtcNow.ToString('o')
        target = $taskProbeDocument.target
        probe = [ordered]@{
            found = $taskProbeDocument.found
            win32Error = $taskProbeDocument.win32Error
            status = $taskProbeDocument.status
            databaseAuthenticationVerified = $false
            bootstrapReady = $false
        }
        executor = [ordered]@{
            windowsIdentity = $taskIdentity.Name
            windowsSid = $taskIdentity.User.Value
            elevated = $true
        }
        secretDecoded = $false
        secretEmitted = $false
        sharedServerChanged = $false
        credentialChanged = $false
    }
    [IO.File]::WriteAllText($taskReport, ($taskReceipt | ConvertTo-Json -Depth 6) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
} finally {
    $taskIdentity.Dispose()
}
exit $taskProbeExit
