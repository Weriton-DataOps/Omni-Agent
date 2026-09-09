# One-shot credential broker: only a short-lived Realtime secret leaves this process.
# Fixed destination and model; caller cannot request arbitrary URLs or retrieve the key.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Security
$taskDirectory = Join-Path $env:APPDATA 'omni\access'
$taskKeyPath = Join-Path $taskDirectory 'openai-realtime.dpapi'
$taskPlain = $null
$taskOutcome = 'unavailable'
try {
    $taskPlain = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($taskKeyPath), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $taskKey = [Text.Encoding]::UTF8.GetString($taskPlain)
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $taskBody = @{ expires_after = @{ anchor = 'created_at'; seconds = 60 }; session = @{ type = 'realtime'; model = 'gpt-realtime-2.1-mini'; instructions = 'Leia somente o texto recebido do Omni. Nao execute acoes nem invente resultados.'; audio = @{ input = @{ turn_detection = @{ type = 'server_vad'; create_response = $false; interrupt_response = $true } } } } } | ConvertTo-Json -Depth 8 -Compress
    $taskResponse = Invoke-RestMethod -Uri 'https://api.openai.com/v1/realtime/client_secrets' -Method Post -Headers @{ Authorization = "Bearer $taskKey" } -ContentType 'application/json' -Body $taskBody -TimeoutSec 20
    if ([string]::IsNullOrWhiteSpace($taskResponse.value)) { throw 'Invalid ephemeral credential response.' }
    $taskOutcome = 'issued'
    @{ ok = $true; value = $taskResponse.value; expiresAt = $taskResponse.expires_at } | ConvertTo-Json -Compress
} catch {
    $taskCode = if ($null -ne $_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    $taskOutcome = if ($taskCode -eq 401) { 'invalid-token' } elseif ($taskCode -eq 429) { 'rate-limited' } else { 'unavailable' }
    @{ ok = $false; error = "Voz indisponivel ($taskOutcome)." } | ConvertTo-Json -Compress
} finally {
    if ($null -ne $taskPlain) { [Array]::Clear($taskPlain, 0, $taskPlain.Length) }
    $taskKey = $null
    # Metadata only; no credentials or response body in the audit log.
    if (Test-Path -LiteralPath $taskDirectory) {
        $taskAudit = @{ at = [DateTime]::UtcNow.ToString('o'); operation = 'realtime.mint'; outcome = $taskOutcome } | ConvertTo-Json -Compress
        [IO.File]::AppendAllText((Join-Path $taskDirectory 'realtime-audit.jsonl'), $taskAudit + [Environment]::NewLine)
    }
}
