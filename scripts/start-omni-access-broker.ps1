param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^S-1-5-(?:\d+-){1,14}\d+$')]
    [string]$AllowedClientSid,
    [Parameter(Mandatory = $true)]
    [string]$ReportPath
)

# Startup wrapper records only an error category; it never captures command output or a credential.
$ErrorActionPreference = 'Stop'
try {
    & (Join-Path $PSScriptRoot 'omni-access-broker.ps1') -AllowedClientSid $AllowedClientSid -ReportPath $ReportPath
    exit 0
} catch {
    $taskReport = [IO.Path]::GetFullPath($ReportPath)
    $taskRoot = Split-Path -Parent $PSScriptRoot
    $taskReportsRoot = [IO.Path]::GetFullPath((Join-Path $taskRoot 'out\implementation'))
    if ($taskReport.StartsWith($taskReportsRoot, [StringComparison]::OrdinalIgnoreCase)) {
        $taskFailure = [ordered]@{
            schemaVersion = 1
            kind = 'omni-access-broker'
            status = 'failed-to-start'
            errorCategory = $_.Exception.GetType().Name
            errorSource = [IO.Path]::GetFileName($_.InvocationInfo.ScriptName)
            errorLine = [int]$_.InvocationInfo.ScriptLineNumber
            errorOperation = if ($null -ne $_.Exception.InnerException) { $_.Exception.InnerException.TargetSite.Name } else { $_.Exception.TargetSite.Name }
            secretEmitted = $false
            recordedAt = [DateTimeOffset]::UtcNow.ToString('o')
        } | ConvertTo-Json -Compress
        [IO.File]::WriteAllText($taskReport, $taskFailure + "`n", [Text.UTF8Encoding]::new($false))
    }
    exit 1
}
