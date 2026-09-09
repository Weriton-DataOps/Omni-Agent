$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskShell = New-Object -ComObject WScript.Shell
$taskShortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Omni Desktop.lnk'
$taskShortcut = $taskShell.CreateShortcut($taskShortcutPath)
$taskShortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$taskShortcut.Arguments = '"' + (Join-Path $PSScriptRoot 'start-omni-desktop-hidden.vbs') + '"'
$taskShortcut.WorkingDirectory = $taskRoot
$taskShortcut.Description = 'Omni — chat, voz e continuidade'
$taskShortcut.Save()
Write-Output 'Atalho Omni Desktop criado; inicializacao sem console.'
