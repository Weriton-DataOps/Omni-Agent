Option Explicit

' Runs the user runtime without exposing a PowerShell console at logon.
Dim shell, fileSystem, powerShell, scriptPath, command
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")
powerShell = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
scriptPath = fileSystem.BuildPath(fileSystem.GetParentFolderName(WScript.ScriptFullName), "start-user-omni-runtime.ps1")
command = Chr(34) & powerShell & Chr(34) & " -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & scriptPath & Chr(34)
shell.Run command, 0, False
