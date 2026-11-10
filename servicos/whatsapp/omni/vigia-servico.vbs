' Lança o vigia do serviço WhatsApp sem piscar janela de console a cada 5 minutos.
' (Mesmo molde do vigia-sessoes.vbs: o Agendador chama ESTE arquivo, não o node direto.)
' Sem caminho chumbado: o vigia-servico.mjs é o que está ao lado deste arquivo (a versão instalada em
' versoes\<sha>), e o node vem do OMNI_NODE ou, sem ele, do PATH.
Dim shell, fso, pasta, node
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
pasta = fso.GetParentFolderName(WScript.ScriptFullName)
node = shell.ExpandEnvironmentStrings("%OMNI_NODE%")
If node = "%OMNI_NODE%" Or node = "" Then node = "node.exe"
shell.Run """" & node & """ """ & pasta & "\vigia-servico.mjs""", 0, False
