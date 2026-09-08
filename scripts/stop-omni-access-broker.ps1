param(
    [Parameter(Mandatory = $true)]
    [int]$BrokerProcessId
)

$ErrorActionPreference = 'Stop'
$task = Get-Process -Id $BrokerProcessId -ErrorAction Stop
if ($task.ProcessName -ne 'powershell') { throw 'Target is not the expected PowerShell broker process.' }
Stop-Process -Id $BrokerProcessId -Force -ErrorAction Stop
