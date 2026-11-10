<#
  Desligamento do PostgreSQL 5433 (F2, plano 6a, T3). O 5433 só sai depois que o omni.db da casa tem o
  recibo da importação (omni-importar-5433.mjs). Sem -Executar, nada muda: o roteiro só mostra, em JSON,
  o que faria. Com -Executar, na ordem que mantém o caminho de volta aberto até o fim:
    1. para o broker (processo cuja linha de comando tem <Broker>.ps1), que é cliente do PG;
    2. pg_ctl stop -m fast -w e espera a porta fechar e o postmaster.pid sumir;
    3. copia a pasta data para <Backup>\postgresql-5433-<yyyyMMdd-HHmmss> e confere contagem e tamanho;
    4. só então guarda o atalho "Omni Runtime.lnk" da pasta Inicializar em <Desativados>.
  A pasta data original nunca é apagada aqui. Se a cópia não conferir, o atalho fica onde está e o
  próximo logon sobe tudo de novo.
  Trava fechado: qualquer erro inesperado encerra com saída 1 antes do passo seguinte. Por isso as pastas
  -Dados, -Backup e -Inicializar não têm padrão: quem roda diz onde, sempre.
  Saída: 0 ok; 1 falha num passo; 2 uso errado; 3 sem recibo da importação.
#>
param(
  [string]$Dados,
  [string]$Backup,
  [string]$Inicializar,
  [string]$Desativados = (Join-Path $env:APPDATA 'omni\atalhos-desativados'),
  [string]$Casa,
  [string]$PgCtl,
  [int]$Porta = 5433,
  [string]$Broker = 'omni-access-broker',
  [switch]$Executar
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false) } catch { }
$ATALHO = 'Omni Runtime.lnk'

function Write-Relatorio($relatorio) {
  [Console]::Out.WriteLine(($relatorio | ConvertTo-Json -Depth 6 -Compress))
}

trap {
  Write-Relatorio @{ ok = $false; erro = 'falha inesperada: ' + $_.Exception.Message }
  exit 1
}

function Exit-Relatorio([int]$codigo, $relatorio) {
  Write-Relatorio $relatorio
  exit $codigo
}

# Programa externo: o código de saída decide, e o stderr dele não vira exceção do PowerShell 5.1.
function Invoke-Nativo([string]$programa, [string[]]$argumentos) {
  $ErrorActionPreference = 'Continue'
  $saida = (& $programa @argumentos 2>$null | Out-String).Trim()
  return @{ codigo = $LASTEXITCODE; saida = $saida }
}

function Test-PortaAberta([int]$p) {
  $cliente = New-Object Net.Sockets.TcpClient
  try {
    $tentativa = $cliente.BeginConnect('127.0.0.1', $p, $null, $null)
    if (-not $tentativa.AsyncWaitHandle.WaitOne(500)) { return $false }
    $cliente.EndConnect($tentativa)
    return $true
  } catch { return $false } finally { $cliente.Close() }
}

function Measure-Pasta([string]$pasta) {
  $arquivos = @(Get-ChildItem -LiteralPath $pasta -Recurse -File -Force)
  $bytes = [long]0
  foreach ($a in $arquivos) { $bytes += $a.Length }
  return @{ arquivos = $arquivos.Count; bytes = $bytes }
}

function Get-ProcessosBroker {
  $marca = $Broker + '.ps1'
  return @(Get-CimInstance Win32_Process | Where-Object {
      $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.IndexOf($marca, [StringComparison]::OrdinalIgnoreCase) -ge 0
    } | ForEach-Object { [int]$_.ProcessId })
}

function Find-PgCtl {
  $dadosCheio = [IO.Path]::GetFullPath($Dados)
  foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name = 'postgres.exe'")) {
    if ($p.CommandLine -and $p.ExecutablePath -and $p.CommandLine.IndexOf($dadosCheio, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
      $candidato = Join-Path (Split-Path -Parent $p.ExecutablePath) 'pg_ctl.exe'
      if (Test-Path -LiteralPath $candidato) { return $candidato }
    }
  }
  return $null
}

if (-not $Dados -or -not $Backup -or -not $Inicializar) { Exit-Relatorio 2 @{ ok = $false; erro = 'informe -Dados, -Backup e -Inicializar' } }
if (-not (Test-Path -LiteralPath (Join-Path $Dados 'PG_VERSION'))) { Exit-Relatorio 2 @{ ok = $false; erro = 'a pasta -Dados não é uma pasta data do PostgreSQL'; dados = $Dados } }

# Pré-condição: o recibo da importação no omni.db.
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { Exit-Relatorio 1 @{ ok = $false; erro = 'node.exe não encontrado' } }
$argumentos = @((Join-Path $PSScriptRoot 'omni-importar-5433.mjs'), '--recibo')
if ($Casa) { $argumentos += @('--casa', $Casa) }
$lido = Invoke-Nativo $node $argumentos
if ($lido.codigo -eq 3) { Exit-Relatorio 3 @{ ok = $false; erro = 'o omni.db não tem o recibo da importação do 5433; rode o omni-importar-5433.mjs antes' } }
$recibo = $null
try { $recibo = $lido.saida | ConvertFrom-Json } catch { }
if ($lido.codigo -ne 0 -or -not $recibo) { Exit-Relatorio 1 @{ ok = $false; erro = 'não deu para ler o recibo da importação'; codigo = $lido.codigo } }

if (-not $PgCtl) { $PgCtl = Find-PgCtl }
$carimbo = Get-Date -Format 'yyyyMMdd-HHmmss'
$destino = Join-Path $Backup ('postgresql-5433-' + $carimbo)
$lnk = Join-Path $Inicializar $ATALHO
$guardado = Join-Path $Desativados $ATALHO
if (Test-Path -LiteralPath $guardado) { $guardado = Join-Path $Desativados ('Omni Runtime-' + $carimbo + '.lnk') }
# Nome próprio: no PowerShell $broker e $Broker são a mesma variável, e o [string] do parâmetro achataria a lista.
$processosBroker = [int[]]@(Get-ProcessosBroker)
$aberta = Test-PortaAberta $Porta

if (-not $Executar) {
  Exit-Relatorio 0 @{ ok = $true; modo = 'plano'; recibo = $recibo; dados = $Dados; pgCtl = $PgCtl; porta = $Porta; portaAberta = $aberta
    broker = $processosBroker; copiaPara = $destino; atalho = @{ de = $lnk; existe = (Test-Path -LiteralPath $lnk); para = $guardado } }
}

$relatorio = @{ ok = $false; modo = 'executado'; recibo = $recibo; broker = $processosBroker }

# 1. Broker.
foreach ($id in $processosBroker) {
  Invoke-Nativo 'taskkill.exe' @('/PID', [string]$id, '/T', '/F') | Out-Null
  try { Wait-Process -Id $id -Timeout 15 } catch { }
}
$sobrou = @($processosBroker | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
if ($sobrou.Count -gt 0) { $relatorio.erro = 'o broker não parou'; $relatorio.sobrou = $sobrou; Exit-Relatorio 1 $relatorio }

# 2. PostgreSQL.
$codigoPg = $null
if ($PgCtl) {
  $codigoPg = (Invoke-Nativo $PgCtl @('stop', '-D', $Dados, '-m', 'fast', '-w')).codigo
} elseif ($aberta) {
  $relatorio.erro = 'a porta segue aberta e não achei o pg_ctl do processo; informe -PgCtl'; Exit-Relatorio 1 $relatorio
}
$espera = 0
while ((Test-PortaAberta $Porta) -and $espera -lt 60) { Start-Sleep -Seconds 1; $espera++ }
if (Test-PortaAberta $Porta) { $relatorio.erro = 'a porta ' + $Porta + ' não fechou'; $relatorio.pgCtl = $codigoPg; Exit-Relatorio 1 $relatorio }
if (Test-Path -LiteralPath (Join-Path $Dados 'postmaster.pid')) { $relatorio.erro = 'o postmaster.pid continua lá: o PG não terminou'; Exit-Relatorio 1 $relatorio }
$relatorio.pg = 'ja-parado'
if ($codigoPg -eq 0) { $relatorio.pg = 'parado' }

# 3. Cópia datada, conferida.
if (Test-Path -LiteralPath $destino) { $relatorio.erro = 'a cópia de destino já existe'; $relatorio.destino = $destino; Exit-Relatorio 1 $relatorio }
New-Item -ItemType Directory -Force -Path $Backup | Out-Null
Copy-Item -LiteralPath $Dados -Destination $destino -Recurse -Force
$origem = Measure-Pasta $Dados
$copia = Measure-Pasta $destino
$relatorio.copia = @{ destino = $destino; arquivos = $copia.arquivos; bytes = $copia.bytes }
if ($origem.arquivos -ne $copia.arquivos -or $origem.bytes -ne $copia.bytes) {
  $relatorio.erro = 'a cópia não confere com a origem; o atalho ficou onde estava'; $relatorio.origem = $origem; Exit-Relatorio 1 $relatorio
}

# 4. Atalho do logon, guardado (reversível: é só mover de volta).
if (Test-Path -LiteralPath $lnk) {
  New-Item -ItemType Directory -Force -Path $Desativados | Out-Null
  [IO.File]::Move($lnk, $guardado)
  $relatorio.atalho = @{ de = $lnk; para = $guardado }
} else {
  $relatorio.atalho = @{ de = $lnk; ausente = $true }
}

$relatorio.dadosOriginais = 'mantidos'
$relatorio.ok = $true
Exit-Relatorio 0 $relatorio
