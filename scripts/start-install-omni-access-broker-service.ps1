param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^S-1-5-(?:\d+-){1,14}\d+$')]
    [string]$AllowedClientSid,
    [Parameter(Mandatory = $true)]
    [string]$ReportPath
)

$ErrorActionPreference = 'Stop'
try {
    & (Join-Path $PSScriptRoot 'install-omni-access-broker-service.ps1') -AllowedClientSid $AllowedClientSid -ReportPath $ReportPath
    exit 0
} catch {
    $taskReport = [IO.Path]::GetFullPath($ReportPath)
    $taskRoot = Split-Path -Parent $PSScriptRoot
    $taskReportsRoot = [IO.Path]::GetFullPath((Join-Path $taskRoot 'out\implementation'))
    if ($taskReport.StartsWith($taskReportsRoot, [StringComparison]::OrdinalIgnoreCase)) {
        [ordered]@{
            schemaVersion = 1
            kind = 'omni-access-broker-install'
            status = 'failed'
            errorCategory = $_.Exception.GetType().Name
            errorOperation = if ($null -ne $_.Exception.InnerException) { $_.Exception.InnerException.TargetSite.Name } else { $_.Exception.TargetSite.Name }
            executorSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
            secretEmitted = $false
            recordedAt = [DateTimeOffset]::UtcNow.ToString('o')
        } | ConvertTo-Json -Compress | Set-Content -LiteralPath $taskReport -Encoding utf8
    }
    exit 1
}
