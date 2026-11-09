# Omni — a chave da OpenAI (a mesma do voz.ps1) ainda abre a porta? GET /v1/models não cobra nada.
# Crédito não tem consulta gratuita com chave de API: quem diz se acabou é o uso real (saude.mjs lê isso do log).
# A chave nunca sai deste processo nem vai para log. Saída: {"ok":true,"status":200} ou {"ok":false,"erro":"..."}
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Security
Add-Type -AssemblyName System.Net.Http
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$chave = $null; $cliente = $null
try {
    $arquivo = Join-Path $env:APPDATA 'omni\access\openai-realtime.dpapi'
    if (-not (Test-Path -LiteralPath $arquivo)) { @{ ok = $false; erro = 'ausente' } | ConvertTo-Json -Compress; return }
    $chave = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($arquivo), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $cliente = [Net.Http.HttpClient]::new()
    $cliente.Timeout = [TimeSpan]::FromSeconds(15)
    $cliente.DefaultRequestHeaders.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', [Text.Encoding]::UTF8.GetString($chave))
    $r = $cliente.GetAsync('https://api.openai.com/v1/models').GetAwaiter().GetResult()
    @{ ok = $true; status = [int]$r.StatusCode } | ConvertTo-Json -Compress
} catch {
    @{ ok = $false; erro = 'sem rede' } | ConvertTo-Json -Compress
} finally {
    if ($null -ne $chave) { [Array]::Clear($chave, 0, $chave.Length) }
    if ($null -ne $cliente) { $cliente.Dispose() }
}
