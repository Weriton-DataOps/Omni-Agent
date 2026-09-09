Option Explicit
Dim fso, sh, root, launcher
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
launcher = root & "\apps\omni-desktop\scripts\start.mjs"
sh.Run """C:\Program Files\nodejs\node.exe"" """ & launcher & """", 0, False
