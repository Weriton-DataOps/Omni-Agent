# Omni — voz do WhatsApp: transcreve o áudio que o Weriton manda e sintetiza áudio de resposta, pela OpenAI.
# Usa a mesma chave do Omni desktop (DPAPI da conta, %APPDATA%\omni\access\openai-realtime.dpapi).
# Entrada e saída só por stdin/stdout, em base64; a chave nunca sai deste processo nem vai para log.
#   transcrever: stdin = áudio (base64)        → {"ok":true,"texto64":"<texto UTF-8 em base64>"}
#   falar:       stdin = texto UTF-8 (base64)  → {"ok":true,"audio64":"<ogg/opus em base64>"}
param(
    [Parameter(Mandatory = $true)][ValidateSet('transcrever', 'falar')][string]$Acao,
    [string]$Tipo = 'audio/ogg',
    [double]$Velocidade = 1.25  # medido: 1,25 encurta ~23% sem distorcer; o Weriton achou 1,0 com cara de leitura
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Security
Add-Type -AssemblyName System.Net.Http
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$VOZ = 'verse'
$JEITO = @'
Português do Brasil, sotaque brasileiro natural. Você é o Omni: um amigo gênio, direto e irreverente, com energia e bom humor.
Fale como quem grava um áudio de WhatsApp para um amigo, não como quem lê um texto: ritmo rápido e solto de conversa, emendando as frases, com micro-pausas curtas de respiração só entre as ideias.
Varie a entonação de frase para frase: suba um pouco no achado ou na boa notícia, desça na conclusão. Nada de cadência uniforme nem de pausa igual em toda vírgula.
Coloquial e caloroso, com leve sorriso na voz. Em assunto de risco ou erro, baixe a energia e fale mais sério e claro.
'@

$chave = $null; $cliente = $null; $conteudo = $null
try {
    $entrada = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
    $chave = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $env:APPDATA 'omni\access\openai-realtime.dpapi')), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $cliente = [Net.Http.HttpClient]::new()
    # Síntese de uma resposta curta leva segundos; se a OpenAI travar, melhor desistir cedo e tentar de novo.
    $cliente.Timeout = [TimeSpan]::FromSeconds($(if ($Acao -eq 'falar') { 45 } else { 120 }))
    $cliente.DefaultRequestHeaders.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', [Text.Encoding]::UTF8.GetString($chave))
    if ($Acao -eq 'transcrever') {
        if ($entrada.Length -lt 32 -or $entrada.Length -gt 24MB) { throw 'áudio vazio ou maior que 24 MB' }
        $mime = ($Tipo -split ';')[0].Trim()
        $ext = switch -Wildcard ($mime) { '*ogg*' { 'ogg' } '*mpeg*' { 'mp3' } '*mp4*' { 'm4a' } '*aac*' { 'm4a' } '*wav*' { 'wav' } '*webm*' { 'webm' } default { 'ogg' } }
        $conteudo = [Net.Http.MultipartFormDataContent]::new()
        $conteudo.Add([Net.Http.StringContent]::new('gpt-4o-transcribe'), 'model')
        $conteudo.Add([Net.Http.StringContent]::new('pt'), 'language')
        $parte = [Net.Http.ByteArrayContent]::new($entrada)
        $parte.Headers.ContentType = [Net.Http.Headers.MediaTypeHeaderValue]::new($mime)
        $conteudo.Add($parte, 'file', "audio.$ext")
        $r = $cliente.PostAsync('https://api.openai.com/v1/audio/transcriptions', $conteudo).GetAwaiter().GetResult()
        if (-not $r.IsSuccessStatusCode) { throw "transcrição recusada pela OpenAI (HTTP $([int]$r.StatusCode))" }
        $texto = [string]($r.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json).text
        @{ ok = $true; texto64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($texto)) } | ConvertTo-Json -Compress
    } else {
        $texto = [Text.Encoding]::UTF8.GetString($entrada).Trim()
        if (-not $texto -or $texto.Length -gt 4096) { throw 'texto vazio ou maior que 4096 caracteres' }
        $pedido = @{ model = 'gpt-4o-mini-tts'; voice = $VOZ; input = $texto; instructions = $JEITO; response_format = 'opus'; speed = $Velocidade } | ConvertTo-Json -Compress
        $conteudo = [Net.Http.StringContent]::new($pedido, [Text.Encoding]::UTF8, 'application/json')
        $r = $cliente.PostAsync('https://api.openai.com/v1/audio/speech', $conteudo).GetAwaiter().GetResult()
        if (-not $r.IsSuccessStatusCode) { throw "síntese recusada pela OpenAI (HTTP $([int]$r.StatusCode))" }
        $audio = $r.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
        @{ ok = $true; audio64 = [Convert]::ToBase64String($audio) } | ConvertTo-Json -Compress
    }
} catch {
    $erro = $_.Exception.Message
    if ($erro -match 'cancel') { $erro = 'a OpenAI não respondeu a tempo' }
    @{ ok = $false; erro = $erro } | ConvertTo-Json -Compress
} finally {
    if ($null -ne $chave) { [Array]::Clear($chave, 0, $chave.Length) }
    if ($null -ne $conteudo) { $conteudo.Dispose() }
    if ($null -ne $cliente) { $cliente.Dispose() }
}
