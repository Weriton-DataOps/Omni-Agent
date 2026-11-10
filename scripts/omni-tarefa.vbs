' Lança uma tarefa de agente sem piscar janela (F2, plano 5c). O Agendador chama ESTE arquivo:
'   wscript.exe "<versao>\scripts\omni-tarefa.vbs" <agente> <id> <motivo>
' e ele roda, escondido, node "<versao>\runtime\tarefa-agente.mjs" rodar <agente> <id> --motivo <motivo>.
' Sem caminho chumbado: o lançador é o da versão onde este arquivo mora, e o node vem do OMNI_NODE ou,
' sem ele, do PATH. Espera o lançador acabar e sai com o código dele, para o Agendador mostrar o
' resultado de verdade (0 concluída ou pulada, 1 falhou, 3 interrompida pelo teto).
Dim shell, fso, versao, node, args
If WScript.Arguments.Count <> 3 Then WScript.Quit 2
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
versao = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
node = shell.ExpandEnvironmentStrings("%OMNI_NODE%")
If node = "%OMNI_NODE%" Or node = "" Then node = "node.exe"
args = " rodar """ & WScript.Arguments(0) & """ """ & WScript.Arguments(1) & """ --motivo """ & WScript.Arguments(2) & """"
WScript.Quit shell.Run("""" & node & """ """ & versao & "\runtime\tarefa-agente.mjs""" & args, 0, True)
