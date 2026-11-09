' Lança o vigia de sessões sem piscar janela de console a cada 5 minutos.
' (O Agendador do Windows chama ESTE arquivo, não o node direto: janela de CMD aparecendo
'  na tela dele de 5 em 5 minutos já foi problema antes.)
Dim shell, script
Set shell = CreateObject("WScript.Shell")
script = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\vigia-sessoes.mjs"
shell.Run """C:\Program Files\nodejs\node.exe"" """ & script & """", 0, False
