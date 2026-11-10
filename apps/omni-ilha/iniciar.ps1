# Sobe a ilha do Omni com o Electron proprio da pasta (apps\omni-ilha\node_modules, via npm ci).
# Uso: .\iniciar.ps1                (comeca como faixa fechada)
#      .\iniciar.ps1 -Aberta        (comeca com o painel aberto)
#      .\iniciar.ps1 -SoPreparar    (so garante o binario do Electron e sai; o instalador usa)
param([switch]$Aberta, [switch]$SoPreparar)
$ErrorActionPreference = 'Stop'

$pacote = Join-Path $PSScriptRoot 'node_modules\electron'
$electron = Join-Path $pacote 'dist\electron.exe'

# No Node 24 o postinstall do electron 33 (extract-zip) morre calado no meio da extracao: o zip ja foi
# baixado e conferido no cache, mas a dist fica so com o LICENSES. Aqui a extracao termina pelo tar.exe
# do Windows, igual ao install.js do pacote (dist + path.txt).
function Completar-Electron {
  $manifesto = Join-Path $pacote 'package.json'
  if (-not (Test-Path -LiteralPath $manifesto)) {
    throw "Electron da ilha ausente: rode 'npm ci' em $PSScriptRoot"
  }
  $versao = (Get-Content -LiteralPath $manifesto -Raw | ConvertFrom-Json).version
  $nome = "electron-v$versao-win32-x64.zip"
  $cache = if ($env:electron_config_cache) { $env:electron_config_cache } else { Join-Path $env:LOCALAPPDATA 'electron\Cache' }
  $zip = Get-ChildItem -LiteralPath $cache -Recurse -Filter $nome -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $zip) { throw "Electron $versao sem binario e sem $nome no cache: rode 'npm ci' de novo em $PSScriptRoot" }
  $dist = Join-Path $pacote 'dist'
  New-Item -ItemType Directory -Force -Path $dist | Out-Null
  & tar.exe -xf $zip.FullName -C $dist
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $electron)) { throw "falha ao extrair $nome em $dist" }
  [IO.File]::WriteAllText((Join-Path $pacote 'path.txt'), 'electron.exe')
}

if (-not (Test-Path -LiteralPath $electron)) { Completar-Electron }
if ($SoPreparar) { return }

# Terminais do VS Code herdam ELECTRON_RUN_AS_NODE=1, que faz o Electron rodar como Node puro, sem janela.
$env:ELECTRON_RUN_AS_NODE = $null
$argumentos = @('"' + $PSScriptRoot + '"')
if ($Aberta) { $argumentos += '--aberta' }
Start-Process -FilePath $electron -ArgumentList $argumentos
