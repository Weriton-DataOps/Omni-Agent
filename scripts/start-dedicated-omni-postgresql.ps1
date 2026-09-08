$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskData = Join-Path $taskRoot 'runtime\postgresql-5433\data'
$taskPgCtl = 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe'
if (-not (Test-Path -LiteralPath $taskData -PathType Container) -or -not (Test-Path -LiteralPath $taskPgCtl -PathType Leaf)) { throw 'Dedicated Omni PostgreSQL is not installed.' }
$taskPriorPreference = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
try { $taskStatus = & $taskPgCtl '-D' $taskData 'status' 2>&1; $taskStatusExit = $LASTEXITCODE } finally { $ErrorActionPreference = $taskPriorPreference }
if ($taskStatusExit -eq 0) { exit 0 }
$taskPriorPreference = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
try { $taskStart = & $taskPgCtl '-D' $taskData '-w' '-t' '30' '-o' '-p 5433 -h 127.0.0.1' 'start' 2>&1; $taskStartExit = $LASTEXITCODE } finally { $ErrorActionPreference = $taskPriorPreference }
if ($taskStartExit -ne 0) { throw 'Dedicated Omni PostgreSQL did not start.' }
