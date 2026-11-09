# Omni — pega uma chave de API da AREA DE TRANSFERENCIA e guarda cifrada no cofre (DPAPI/CurrentUser),
# sem que o valor passe pelo modelo, pelo WhatsApp, por um .env solto ou pela tela.
#
# Motivo: a chave da Anthropic (e qualquer outra) so nasce no console do provedor, no navegador do Weriton.
# Do console ao cofre o caminho curto e o Ctrl+C: ele clica em "Copy", eu leio o clipboard aqui e cifro.
# A saida e so nome, tamanho, impressao digital SHA256 truncada e o resultado do teste ao vivo — nunca o valor.
#
#   .\omni-guardar-chave-da-area-de-transferencia.ps1 -Nome anthropic-gerry-homolog
#   .\omni-guardar-chave-da-area-de-transferencia.ps1 -Nome anthropic-gerry-homolog -SemTeste
#   .\omni-guardar-chave-da-area-de-transferencia.ps1 -Nome x -Padrao '^sk-[A-Za-z0-9_\-]{20,}$'  (outro provedor)
#
# Depois de gravar, o clipboard e limpo (a nao ser com -ManterClipboard): chave em area de transferencia
# e segredo em cima da mesa — qualquer programa do usuario le isso sem pedir licenca.
param(
  [Parameter(Mandatory)][string]$Nome,
  [string]$Padrao = '^sk-ant-(api03|admin01)-[A-Za-z0-9_\-]{30,}$',
  [switch]$SemTeste,
  [switch]$ManterClipboard
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

if ($Nome -notmatch '^[a-z0-9][a-z0-9._-]{0,63}$') { throw "Nome de cofre invalido: use [a-z0-9._-]" }
$cofre = Join-Path $env:APPDATA 'omni\access'
if (-not (Test-Path -LiteralPath $cofre)) { throw "Cofre nao encontrado: $cofre" }

$valor = (Get-Clipboard -Raw -ErrorAction Stop)
if ($null -ne $valor) { $valor = $valor.Trim() }
if ([string]::IsNullOrWhiteSpace($valor)) { throw 'A area de transferencia esta vazia: copie a chave no console antes.' }
if ($valor -notmatch $Padrao) {
  throw ("O que esta na area de transferencia nao tem a forma de chave esperada (" + $valor.Length + " caracteres). Nada foi gravado e nada foi exibido.")
}

# Teste ao vivo antes de gravar: chave recusada nao entra no cofre fingindo que serve.
$teste = 'pulado (-SemTeste)'
if (-not $SemTeste) {
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $r = Invoke-RestMethod -Method Get -Uri 'https://api.anthropic.com/v1/models?limit=1' -TimeoutSec 30 `
      -Headers @{ 'x-api-key' = $valor; 'anthropic-version' = '2023-06-01' }
    $teste = 'aceita pela API (GET /v1/models respondeu, ' + @($r.data).Count + ' modelo listado)'
  } catch {
    $st = $null
    if ($_.Exception.Response) { $st = [int]$_.Exception.Response.StatusCode }
    $valor = $null
    throw ("A API recusou a chave (HTTP " + $st + "): nada foi gravado. Gere de novo no console e copie inteira.")
  }
}

$bytes = [Text.Encoding]::UTF8.GetBytes($valor)
$cifrado = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
$destino = Join-Path $cofre ($Nome + '.dpapi')
[IO.File]::WriteAllBytes($destino, $cifrado)

$fp = [BitConverter]::ToString(([Security.Cryptography.SHA256]::Create().ComputeHash($bytes))[0..5]).Replace('-', '').ToLower()
$tam = $valor.Length
[Array]::Clear($bytes, 0, $bytes.Length); $valor = $null

# Prova que decifra e casa, sem imprimir.
$volta = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($destino), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
$fp2 = [BitConverter]::ToString(([Security.Cryptography.SHA256]::Create().ComputeHash($volta))[0..5]).Replace('-', '').ToLower()
[Array]::Clear($volta, 0, $volta.Length)

if (-not $ManterClipboard) { Set-Clipboard -Value ' ' }

'gravado: ' + $destino + ' (' + (Get-Item $destino).Length + ' bytes; a chave tem ' + $tam + ' caracteres)'
'impressao digital: ' + $fp + '  | decifra e casa: ' + ($fp -eq $fp2)
'teste: ' + $teste
'area de transferencia: ' + ($(if ($ManterClipboard) { 'mantida (-ManterClipboard)' } else { 'limpa' }))
