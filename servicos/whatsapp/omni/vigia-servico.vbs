' Lança o vigia do serviço WhatsApp sem piscar janela de console a cada 5 minutos.
' (Mesmo molde do vigia-sessoes.vbs: o Agendador chama ESTE arquivo, não o node direto.)
Dim shell, script
Set shell = CreateObject("WScript.Shell")
script = "C:\Users\wp.santos\Documents\Omni\servicos\whatsapp\omni\vigia-servico.mjs"
shell.Run """C:\Program Files\nodejs\node.exe"" """ & script & """", 0, False
