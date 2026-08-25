[CmdletBinding()]
param(
  [ValidateSet('estado', 'atualizar', 'contexto', 'experiencia', 'candidatas', 'lembrar', 'licao', 'confirmar', 'descartar')]
  [string]$Acao = 'estado',
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Argumentos
)

$ErrorActionPreference = 'Stop'
$raiz = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$cli = [System.IO.Path]::GetFullPath((Join-Path $raiz 'runtime\cli.mjs'))

if (-not $cli.StartsWith($raiz, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'O operador saiu da raiz verificada do plugin.'
}
if (-not (Test-Path -LiteralPath $cli)) {
  throw "Runtime do plugin ausente: $cli"
}

$texto = $Argumentos -join ' '
& node --no-warnings $cli $Acao $texto
if ($LASTEXITCODE -ne 0) {
  throw "O operador do Omni falhou com codigo $LASTEXITCODE."
}
