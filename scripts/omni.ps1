[CmdletBinding()]
param(
  [ValidateSet('estado', 'personalidade', 'atualizar', 'contexto', 'experiencia', 'candidatas', 'arquivo', 'manutencao', 'lembrar', 'licao', 'confirmar', 'descartar', 'atualizar-memoria', 'obsoleta', 'consolidar', 'atalhos', 'atalho-observar', 'atalho-validar', 'melhorias', 'melhoria-propor', 'melhoria-avaliar', 'melhoria-aprovar', 'melhoria-rejeitar', 'melhoria-promover', 'melhoria-operacional-promover', 'falhas', 'falha-registrar', 'falha-analisar', 'falha-testar', 'falha-avaliar', 'eval-suite', 'eval-historico', 'eval-registrar', 'eval-comparar', 'checkpoints', 'checkpoint-registrar', 'backlog', 'descoberta-registrar', 'ciclo', 'delegacoes', 'delegacao-preparar', 'delegacao-estado', 'repo-configurar', 'repo-status')]
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

& node --no-warnings $cli $Acao @Argumentos
if ($LASTEXITCODE -ne 0) {
  throw "O operador do Omni falhou com codigo $LASTEXITCODE."
}
