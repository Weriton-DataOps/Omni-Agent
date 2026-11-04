' Lanca o vigia de pedidos (relatorio de 04/11/2026) sem piscar janela de console a cada 15 min.
' O Agendador chama ESTE arquivo. Saida vai para %APPDATA%\omni\whatsapp\vigia-pedidos.log e o
' codigo de saida volta para o Agendador.
Dim shell, script, log, codigo
Set shell = CreateObject("WScript.Shell")
script = "C:\Users\wp.santos\Documents\Omni\servicos\whatsapp\omni\vigia-pedidos.mjs"
log = shell.ExpandEnvironmentStrings("%APPDATA%") & "\omni\whatsapp\vigia-pedidos.log"
codigo = shell.Run("cmd.exe /d /c """"C:\Program Files\nodejs\node.exe"" """ & script & """ >> """ & log & """ 2>&1""", 0, True)
WScript.Quit codigo
