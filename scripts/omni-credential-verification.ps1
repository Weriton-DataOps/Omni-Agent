# Trusted verification helpers. Never emit a secret or a provider response body.
# Fixed token endpoints: https://vercel.com/docs/rest-api/reference/endpoints/user/get-the-user
# https://docs.github.com/en/rest/users/users#get-the-authenticated-user

function New-CredentialVerification([string]$Outcome, [string]$Method) {
    $taskSummaries = @{
        authenticated = 'Autenticacao confirmada. O teste confirma o acesso; permissoes de outras operacoes dependem do escopo.'
        'invalid-token' = 'O servico recusou a credencial. Confira o valor e a validade.'
        'insufficient-scope' = 'O servico recusou esta consulta por falta de permissao. A credencial nao foi marcada como invalida.'
        timeout = 'O servico nao respondeu dentro do prazo. Nenhuma conclusao sobre a credencial.'
        unavailable = 'Nao foi possivel concluir a conexao com o servico. Tente novamente.'
        'rate-limited' = 'O servico limitou as consultas. Aguarde antes de testar novamente.'
        unsupported = 'Este tipo de acesso ainda nao tem um teste seguro implementado. Nada foi armazenado.'
    }
    return [pscustomobject]@{ outcome = $Outcome; checkedAt = [DateTimeOffset]::UtcNow.ToString('o'); method = $Method; summary = $taskSummaries[$Outcome] }
}

function Invoke-CredentialHttpProbe([string]$Provider, [string]$Token) {
    $taskEndpoint = switch ($Provider) { vercel { 'https://api.vercel.com/v2/user' } github { 'https://api.github.com/user' } default { throw 'Unsupported credential provider.' } }
    $taskResponse = $null
    $taskHttp = $null
    $taskRequest = $null
    try {
        Add-Type -AssemblyName System.Net.Http
        $taskHandler = New-Object Net.Http.HttpClientHandler
        $taskHandler.AllowAutoRedirect = $false
        $taskHttp = New-Object Net.Http.HttpClient($taskHandler)
        $taskHttp.Timeout = [TimeSpan]::FromSeconds(7)
        $taskHttp.MaxResponseContentBufferSize = 32768
        $taskRequest = New-Object Net.Http.HttpRequestMessage([Net.Http.HttpMethod]::Get, $taskEndpoint)
        $taskRequest.Headers.UserAgent.ParseAdd('Omni-Cracha-Verification/1.0')
        $taskRequest.Headers.Accept.ParseAdd('application/json')
        $taskRequest.Headers.Authorization = New-Object Net.Http.Headers.AuthenticationHeaderValue('Bearer', $Token)
        if ($Provider -eq 'github') { $taskRequest.Headers.Add('X-GitHub-Api-Version', '2022-11-28') }
        # ResponseContentRead applies the deadline to the complete bounded body, not each chunk.
        $taskResponse = $taskHttp.SendAsync($taskRequest, [Net.Http.HttpCompletionOption]::ResponseContentRead).GetAwaiter().GetResult()
        $taskStatus = [int]$taskResponse.StatusCode
        $taskBody = $null
        try { $taskBody = $taskResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json -ErrorAction Stop } catch { }
        if ($taskStatus -eq 200) {
            $taskHasIdentity = if ($Provider -eq 'vercel') { $null -ne $taskBody.user -and -not [string]::IsNullOrWhiteSpace([string]$taskBody.user.id) } else { $null -ne $taskBody.id -and -not [string]::IsNullOrWhiteSpace([string]$taskBody.login) }
            return @{ outcome = if ($taskHasIdentity) { 'authenticated' } else { 'unavailable' } }
        }
        if ($taskStatus -eq 429 -or ($Provider -eq 'github' -and $taskStatus -eq 403 -and $taskResponse.Headers.Contains('X-RateLimit-Remaining') -and @($taskResponse.Headers.GetValues('X-RateLimit-Remaining')) -contains '0')) { return @{ outcome = 'rate-limited' } }
        if ($taskStatus -eq 401) { return @{ outcome = 'invalid-token' } }
        if ($taskStatus -eq 403) {
            # Vercel's generic forbidden can mean missing scope; only specific rejection proves invalidity.
            $taskErrorCode = [string]$taskBody.error.code
            return @{ outcome = if ($taskErrorCode -in @('invalid_token', 'token_expired', 'token_revoked')) { 'invalid-token' } else { 'insufficient-scope' } }
        }
        return @{ outcome = 'unavailable' }
    } catch {
        $taskFailure = $_.Exception
        while ($null -ne $taskFailure) {
            if ($taskFailure -is [OperationCanceledException] -or $taskFailure -is [TimeoutException]) { return @{ outcome = 'timeout' } }
            $taskFailure = $taskFailure.InnerException
        }
        return @{ outcome = 'unavailable' }
    }
    finally {
        if ($null -ne $taskResponse) { $taskResponse.Dispose() }
        $Token = $null; $taskBody = $null
        if ($null -ne $taskRequest) { $taskRequest.Headers.Authorization = $null; $taskRequest.Dispose() }
        if ($null -ne $taskHttp) { $taskHttp.Dispose() }
    }
}

function Invoke-CredentialPostgresProbe($Payload) {
    if ([string]$Payload.engine -and [string]$Payload.engine -notin @('postgresql', 'postgres', 'pg')) { return @{ outcome = 'unsupported' } }
    if ([string]$Payload.host -notmatch '^[a-zA-Z0-9][a-zA-Z0-9.:-]{0,252}$' -or [string]$Payload.database -notmatch '^[a-zA-Z0-9_][a-zA-Z0-9_.@$-]{0,127}$' -or [string]$Payload.username -notmatch '^[a-zA-Z0-9_][a-zA-Z0-9_.@$-]{0,127}$' -or [string]::IsNullOrWhiteSpace([string]$Payload.password)) { return @{ outcome = 'unsupported' } }
    $taskPort = 5432
    if ($Payload.port -and (-not [int]::TryParse([string]$Payload.port, [ref]$taskPort) -or $taskPort -lt 1 -or $taskPort -gt 65535)) { return @{ outcome = 'unsupported' } }
    $taskProcess = $null
    $taskStart = $null
    try {
        $taskStart = New-Object Diagnostics.ProcessStartInfo
        $taskStart.FileName = $taskPsql
        $taskStart.UseShellExecute = $false
        $taskStart.CreateNoWindow = $true
        $taskStart.RedirectStandardOutput = $true
        $taskStart.RedirectStandardError = $true
        $taskStart.Arguments = '-X -w -q -A -t -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -c "SELECT 1;"'
        # No credential value is placed on the command line or in a temporary file.
        foreach ($taskKey in @($taskStart.Environment.Keys)) { if ($taskKey -match '^PG') { [void]$taskStart.Environment.Remove($taskKey) } }
        $taskStart.Environment['PGHOST'] = [string]$Payload.host
        $taskStart.Environment['PGPORT'] = [string]$taskPort
        $taskStart.Environment['PGDATABASE'] = [string]$Payload.database
        $taskStart.Environment['PGUSER'] = [string]$Payload.username
        $taskStart.Environment['PGPASSWORD'] = [string]$Payload.password
        $taskStart.Environment['PGCONNECT_TIMEOUT'] = '5'
        # PostgreSQL 18 libpq refuses trust/peer/SSPI: success must use the supplied password.
        # https://www.postgresql.org/docs/18/libpq-connect.html#LIBPQ-CONNECT-REQUIRE-AUTH
        $taskStart.Environment['PGREQUIREAUTH'] = 'scram-sha-256,md5,password'
        $taskStart.Environment['PGPASSFILE'] = 'NUL'
        $taskStart.Environment['PGOPTIONS'] = '-c statement_timeout=5000 -c default_transaction_read_only=on'
        $taskStart.Environment['PGSSLMODE'] = if ([string]$Payload.host -in @('localhost', '127.0.0.1', '::1')) { 'prefer' } else { 'verify-full' }
        $taskStart.Environment['PGAPPNAME'] = 'Omni-Cracha-Verification'
        $taskStart.Environment['LC_MESSAGES'] = 'C'
        $taskProcess = [Diagnostics.Process]::Start($taskStart)
        $taskOutputTask = $taskProcess.StandardOutput.ReadToEndAsync()
        $taskErrorTask = $taskProcess.StandardError.ReadToEndAsync()
        if (-not $taskProcess.WaitForExit(8000)) { $taskProcess.Kill(); return @{ outcome = 'timeout' } }
        $taskOutput = $taskOutputTask.GetAwaiter().GetResult()
        $taskErrorText = $taskErrorTask.GetAwaiter().GetResult()
        if ($taskProcess.ExitCode -eq 0 -and $taskOutput.Trim() -eq '1') { return @{ outcome = 'authenticated' } }
        if ($taskErrorText -match 'require_auth|authentication method requirement|did not complete authentication|did not request authentication') { return @{ outcome = 'unsupported' } }
        if ($taskErrorText -match '28P01|password authentication failed') { return @{ outcome = 'invalid-token' } }
        if ($taskErrorText -match '42501|permission denied|no pg_hba.conf entry') { return @{ outcome = 'insufficient-scope' } }
        if ($taskErrorText -match 'timeout expired|timed out') { return @{ outcome = 'timeout' } }
        return @{ outcome = 'unavailable' }
    } catch { return @{ outcome = 'unavailable' } }
    finally {
        if ($null -ne $taskStart) { [void]$taskStart.Environment.Remove('PGPASSWORD') }
        if ($null -ne $taskProcess) { $taskProcess.Dispose() }
        $taskErrorText = $null; $taskOutput = $null
    }
}

function Invoke-CredentialAdProbe($Payload) {
    if ([string]$Payload.domain -notmatch '^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$' -or [string]::IsNullOrWhiteSpace([string]$Payload.username) -or [string]::IsNullOrWhiteSpace([string]$Payload.password)) { return @{ outcome = 'unsupported' } }
    if (-not ('Omni.AccessBroker.DomainProbe' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
namespace Omni.AccessBroker {
  public static class DomainProbe {
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool LogonUser(string user, string domain, string password, int type, int provider, out IntPtr token);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    public static int Verify(string user, string domain, string password) {
      var work = Task.Run(() => {
        IntPtr token = IntPtr.Zero;
        try { return LogonUser(user, domain, password, 3, 0, out token) ? 0 : Marshal.GetLastWin32Error(); }
        finally { if (token != IntPtr.Zero) CloseHandle(token); }
      });
      return work.Wait(8000) ? work.Result : -1;
    }
  }
}
'@
    }
    try {
        $taskCode = [Omni.AccessBroker.DomainProbe]::Verify([string]$Payload.username, [string]$Payload.domain, [string]$Payload.password)
        return @{ outcome = switch ($taskCode) { 0 { 'authenticated' } -1 { 'timeout' } 1326 { 'invalid-token' } 1330 { 'invalid-token' } 1909 { 'invalid-token' } 1385 { 'insufficient-scope' } default { 'unavailable' } } }
    } catch { return @{ outcome = 'unavailable' } }
}

function Invoke-CredentialVerification($Registration) {
    $taskPayload = $null
    $taskMethod = 'unsupported'
    try {
        try { $taskPayload = [string]$Registration.token | ConvertFrom-Json -ErrorAction Stop } catch { $taskPayload = [pscustomobject]@{ kind = 'token'; token = [string]$Registration.token } }
        if ($null -eq $taskPayload -or $taskPayload -is [array]) { return New-CredentialVerification 'unsupported' $taskMethod }
        $taskProvider = ([string]$Registration.providerRef).ToLowerInvariant()
        if ($taskProvider -eq 'verecel') { $taskProvider = 'vercel' }
        $taskKind = [string]$taskPayload.kind
        if ($taskKind -eq 'token' -and $taskProvider -in @('vercel', 'github')) {
            $taskMethod = "$taskProvider-authenticated-user"
            if ([string]::IsNullOrWhiteSpace([string]$taskPayload.token) -or [string]$taskPayload.token -match '[\r\n]') { return New-CredentialVerification 'invalid-token' $taskMethod }
            $taskResult = Invoke-CredentialHttpProbe $taskProvider ([string]$taskPayload.token)
        } elseif ($taskKind -in @('database', 'banco') -and ($taskProvider -in @('postgres', 'postgresql', 'pg') -or [string]$taskPayload.engine -in @('postgres', 'postgresql', 'pg'))) {
            $taskMethod = 'postgresql-read-only-select'
            $taskResult = Invoke-CredentialPostgresProbe $taskPayload
        } elseif ($taskKind -in @('ad', 'active-directory')) {
            $taskMethod = 'windows-domain-network-logon'
            $taskResult = Invoke-CredentialAdProbe $taskPayload
        } else { return New-CredentialVerification 'unsupported' $taskMethod }
        return New-CredentialVerification ([string]$taskResult.outcome) $taskMethod
    } catch { return New-CredentialVerification 'unavailable' $taskMethod }
    finally { $taskPayload = $null }
}

function Test-CredentialPayloadEqual([string]$Left, [string]$Right) {
    if ($Left -ceq $Right) { return $true }
    try {
        $taskLeft = $Left | ConvertFrom-Json -ErrorAction Stop
        $taskRight = $Right | ConvertFrom-Json -ErrorAction Stop
        $taskLeftNames = @($taskLeft.PSObject.Properties.Name | Sort-Object)
        $taskRightNames = @($taskRight.PSObject.Properties.Name | Sort-Object)
        if (($taskLeftNames -join ',') -cne ($taskRightNames -join ',')) { return $false }
        foreach ($taskName in $taskLeftNames) { if ([string]$taskLeft.$taskName -cne [string]$taskRight.$taskName) { return $false } }
        return $true
    } catch { return $false }
    finally { $Left = $null; $Right = $null; $taskLeft = $null; $taskRight = $null }
}
