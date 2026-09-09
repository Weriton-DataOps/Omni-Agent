# Fixed-purpose dictation broker. Audio only on stdin/in memory; credentials never leave.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Security
Add-Type -AssemblyName System.Net.Http
$taskPlain = $null
$taskClient = $null
$taskForm = $null
try {
    $taskInput = [Console]::In.ReadToEnd()
    if ($taskInput.Length -gt 5592408) { throw 'Audio too large' }
    $taskAudio = [Convert]::FromBase64String($taskInput)
    if ($taskAudio.Length -lt 32 -or $taskAudio.Length -gt 4194304) { throw 'Invalid audio' }
    $taskPlain = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes((Join-Path $env:APPDATA 'omni\access\openai-realtime.dpapi')), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $taskClient = [Net.Http.HttpClient]::new()
    $taskClient.Timeout = [TimeSpan]::FromSeconds(30)
    $taskClient.DefaultRequestHeaders.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', [Text.Encoding]::UTF8.GetString($taskPlain))
    $taskForm = [Net.Http.MultipartFormDataContent]::new()
    $taskForm.Add([Net.Http.StringContent]::new('gpt-4o-transcribe'), 'model')
    $taskForm.Add([Net.Http.StringContent]::new('pt'), 'language')
    $taskPart = [Net.Http.ByteArrayContent]::new($taskAudio)
    $taskPart.Headers.ContentType = [Net.Http.Headers.MediaTypeHeaderValue]::new('audio/webm')
    $taskForm.Add($taskPart, 'file', 'ditado.webm')
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $taskResponse = $taskClient.PostAsync('https://api.openai.com/v1/audio/transcriptions', $taskForm).GetAwaiter().GetResult()
    if (-not $taskResponse.IsSuccessStatusCode) { throw 'Transcription unavailable' }
    $taskResult = $taskResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
    @{ ok = $true; text = [string]$taskResult.text } | ConvertTo-Json -Compress
} catch {
    @{ ok = $false; error = 'Ditado indisponivel.' } | ConvertTo-Json -Compress
} finally {
    if ($null -ne $taskPlain) { [Array]::Clear($taskPlain, 0, $taskPlain.Length) }
    if ($null -ne $taskForm) { $taskForm.Dispose() }
    if ($null -ne $taskClient) { $taskClient.Dispose() }
}
