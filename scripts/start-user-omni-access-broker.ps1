param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^S-1-5-(?:\d+-){1,14}\d+$')]
    [string]$AllowedClientSid,
    [Parameter(Mandatory = $true)]
    [string]$ReportPath
)

# Runs as the signed-in Omni user. The runtime credential remains scoped to that same user's vault.
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'omni-access-broker.ps1') -AllowedClientSid $AllowedClientSid -ReportPath $ReportPath
