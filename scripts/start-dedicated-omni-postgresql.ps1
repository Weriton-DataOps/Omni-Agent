$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskData = Join-Path $taskRoot 'runtime\postgresql-5433\data'
$taskPgCtl = 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe'
if (-not (Test-Path -LiteralPath $taskData -PathType Container) -or -not (Test-Path -LiteralPath $taskPgCtl -PathType Leaf)) { throw 'Dedicated Omni PostgreSQL is not installed.' }
$taskPriorPreference = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
try { $taskStatus = & $taskPgCtl '-D' $taskData 'status' 2>&1; $taskStatusExit = $LASTEXITCODE } finally { $ErrorActionPreference = $taskPriorPreference }
if ($taskStatusExit -eq 0) { exit 0 }
# The postmaster inherits pg_ctl's output handles; capturing them through the PowerShell pipeline keeps the caller blocked until the server exits.
$taskLogDir = Join-Path $env:APPDATA 'omni\logs'
New-Item -ItemType Directory -Force -Path $taskLogDir | Out-Null
$taskStartArgs = '-D "{0}" -w -t 30 -l "{1}" -o "-p 5433 -h 127.0.0.1" start' -f $taskData, (Join-Path $taskLogDir 'postgresql-5433.log')
$taskStartProcess = Start-Process -FilePath $taskPgCtl -ArgumentList $taskStartArgs -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskLogDir 'postgresql-5433-start.out.log') -RedirectStandardError (Join-Path $taskLogDir 'postgresql-5433-start.err.log') -PassThru
$null = $taskStartProcess.Handle
if (-not $taskStartProcess.WaitForExit(45000)) { try { $taskStartProcess.Kill() } catch { }; throw 'Dedicated Omni PostgreSQL start timed out.' }
if ($taskStartProcess.ExitCode -ne 0) { throw 'Dedicated Omni PostgreSQL did not start.' }
