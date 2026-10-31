# Sobe a demo da ilha do Omni usando o Electron que já está instalado no omni-desktop.
# Uso: .\iniciar.ps1            (começa como faixa fechada)
#      .\iniciar.ps1 -Aberta    (começa com o painel aberto)
param([switch]$Aberta)
$electron = Join-Path $PSScriptRoot '..\omni-desktop\node_modules\electron\dist\electron.exe'
if (-not (Test-Path -LiteralPath $electron)) { throw "Electron não encontrado em $electron" }
# Terminais do VS Code herdam ELECTRON_RUN_AS_NODE=1, que faz o Electron rodar como Node puro, sem janela.
$env:ELECTRON_RUN_AS_NODE = $null
$argumentos = @('"' + $PSScriptRoot + '"')
if ($Aberta) { $argumentos += '--aberta' }
Start-Process -FilePath $electron -ArgumentList $argumentos
