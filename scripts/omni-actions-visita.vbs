' Lança a visita do Actions sem piscar janela de console (o Agendador chama ESTE arquivo).
' Argumento opcional: o motivo (padrão: diaria).
Dim shell, motivo, pasta
Set shell = CreateObject("WScript.Shell")
motivo = "diaria"
If WScript.Arguments.Count > 0 Then motivo = WScript.Arguments(0)
pasta = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & pasta & "\omni-actions-visita.ps1"" -Motivo " & motivo, 0, False
