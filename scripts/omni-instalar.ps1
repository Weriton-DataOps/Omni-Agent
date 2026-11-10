#Requires -Version 5.1
<#
.SYNOPSIS
  Instala, atualiza ou confere o Omni nesta máquina a partir de um commit (F2, plano 5b-2).

.DESCRIPTION
  Casca do Windows sobre o runtime/executor.mjs. A versão é baixada (ou empacotada de -Origem), conferida
  pela impressão digital do próprio payload e só então promovida para <Base>\versoes\<sha>; atual.json
  aponta para ela. O log vai para o stderr; a última linha do stdout é um JSON
  {ok, modo, sha, versao, passos:[{passo, ok, detalhe}]}. Saída 0 ok, 1 falha, 2 uso errado.

  Programas de fora podem ser trocados por variável de ambiente (os testes usam isso):
  OMNI_INSTALAR_NODE, OMNI_INSTALAR_NODE_MINIMO (padrão 24) e OMNI_INSTALAR_URL (molde com {sha}).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File omni-instalar.ps1 instalar -Sha <sha de 40 dígitos>
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][ValidateSet('instalar', 'atualizar', 'importar', 'exportar', 'verificar')][string]$Modo = 'instalar',
  [string]$Sha,
  [string]$Origem,
  [string]$Base = (Join-Path $env:LOCALAPPDATA 'omni'),
  [string[]]$Agente = @(),
  [string]$Pacote,
  [string]$Saida,
  [string]$PrefixoTarefa = 'Omni',
  [string]$PastaAtalhos,
  [string]$PastaInicializar,
  [switch]$SemIlha,
  [switch]$SemWhatsApp,
  [switch]$SemTarefas,
  [switch]$SemPlugin,
  [switch]$NaoAbrir,
  [switch]$SemWinget
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

$script:passos = New-Object System.Collections.ArrayList
$script:shaInstalado = $null
$script:versaoInstalada = $null
$script:node = $null
$FALHOU = 'omni-instalar: passo falhou'

function Log([string]$texto) { [Console]::Error.WriteLine('omni-instalar: ' + $texto) }

function Passo([string]$nome, [bool]$ok, [string]$detalhe, $resultado = $null) {
  $registro = [ordered]@{ passo = $nome; ok = $ok; detalhe = $detalhe }
  if ($null -ne $resultado) { $registro.resultado = $resultado }
  [void]$script:passos.Add($registro)
  $marca = if ($ok) { 'ok' } else { 'FALHOU' }
  Log ($marca + ' ' + $nome + ': ' + $detalhe)
}

function Falhar([string]$nome, [string]$detalhe) {
  Passo $nome $false $detalhe
  throw $FALHOU
}

function Terminar([int]$codigo) {
  $resultado = [ordered]@{ ok = ($codigo -eq 0); modo = $Modo; sha = $script:shaInstalado; versao = $script:versaoInstalada; passos = @($script:passos) }
  [Console]::Out.WriteLine(($resultado | ConvertTo-Json -Compress -Depth 12))
  exit $codigo
}

function Uso([string]$motivo) {
  Log ('uso errado: ' + $motivo)
  Log 'uso: omni-instalar.ps1 [instalar|atualizar|importar|exportar|verificar] -Sha <sha> [-Origem <repo git>] [-Base <pasta>] [-Agente <raiz>...]'
  exit 2
}

# Programa de fora com stdout capturado e stderr repassado ao nosso stderr. O EAP local fica em Continue
# porque o PowerShell 5.1 transforma stderr de programa nativo em ErrorRecord, e com Stop isso derruba o script.
function Rodar([string]$exe, [string[]]$argumentos, [string]$pasta) {
  $antes = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $linhas = @()
  try {
    if ($pasta) { Push-Location -LiteralPath $pasta }
    $linhas = @(& $exe @argumentos 2>&1 | ForEach-Object {
        if ($_ -is [System.Management.Automation.ErrorRecord]) { [Console]::Error.WriteLine($_.ToString()) } else { [string]$_ }
      })
    $codigo = $LASTEXITCODE
  } finally {
    if ($pasta) { Pop-Location }
    $ErrorActionPreference = $antes
  }
  return [pscustomobject]@{ codigo = $codigo; saida = $linhas }
}

function UltimoJson($r) {
  $linhas = @($r.saida | Where-Object { $_ -and $_.Trim().StartsWith('{') })
  if ($linhas.Count -eq 0) { return $null }
  try { return ($linhas[-1] | ConvertFrom-Json) } catch { return $null }
}

function Escrever-Json([string]$arquivo, $objeto) {
  $temporario = $arquivo + '.novo'
  [IO.File]::WriteAllText($temporario, ($objeto | ConvertTo-Json -Depth 6), $utf8)
  Move-Item -LiteralPath $temporario -Destination $arquivo -Force
}

# O Move-Item e o Remove-Item do PowerShell 5.1 se perdem em caminho curto 8.3 (o perfil FULANO~1, que é
# como o %TEMP% costuma chegar) e lançam erro terminal até com SilentlyContinue: a pasta base vira a forma
# longa logo no começo.
function Caminho-Longo([string]$pasta) {
  if (-not ('OmniInstalar.Caminho' -as [type])) {
    Add-Type -Namespace OmniInstalar -Name Caminho -MemberDefinition @'
[DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern uint GetLongPathName(string curto, System.Text.StringBuilder longo, uint tamanho);
'@
  }
  $longo = New-Object Text.StringBuilder 32768
  $n = [OmniInstalar.Caminho]::GetLongPathName([IO.Path]::GetFullPath($pasta), $longo, [uint32]$longo.Capacity)
  if ($n -eq 0) { return [IO.Path]::GetFullPath($pasta) }
  return $longo.ToString()
}

function Apagar-Pasta([string]$pasta) {
  if ([IO.Directory]::Exists($pasta)) { [IO.Directory]::Delete($pasta, $true) }
}

function Atualizar-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

function Instalar-PorWinget([string]$id) {
  if ($SemWinget -or -not (Get-Command winget -ErrorAction SilentlyContinue)) { return $false }
  Log ('instalando ' + $id + ' pelo winget')
  $r = Rodar 'winget' @('install', '--id', $id, '-e', '--silent', '--accept-source-agreements', '--accept-package-agreements') $null
  Atualizar-Path
  return ($r.codigo -eq 0)
}

function Achar-Node {
  if ($env:OMNI_INSTALAR_NODE) { return $env:OMNI_INSTALAR_NODE }
  $c = Get-Command node -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  return $null
}

function Versao-DoNode([string]$node) {
  if (-not $node) { return $null }
  $r = Rodar $node @('-p', 'process.versions.node') $null
  if ($r.codigo -ne 0 -or $r.saida.Count -eq 0) { return $null }
  return $r.saida[-1].Trim()
}

function Conferir-Prerequisitos {
  $minimo = if ($env:OMNI_INSTALAR_NODE_MINIMO) { [int]$env:OMNI_INSTALAR_NODE_MINIMO } else { 24 }
  $node = Achar-Node
  $versao = Versao-DoNode $node
  if (-not $versao -or [int]($versao.Split('.')[0]) -lt $minimo) {
    if (-not $env:OMNI_INSTALAR_NODE -and (Instalar-PorWinget 'OpenJS.NodeJS.LTS')) { $node = Achar-Node; $versao = Versao-DoNode $node }
  }
  if (-not $versao) { Falhar 'prerequisitos' ('node não encontrado (precisa de Node ' + $minimo + ' ou mais)') }
  if ([int]($versao.Split('.')[0]) -lt $minimo) { Falhar 'prerequisitos' ('node ' + $versao + ' abaixo do mínimo ' + $minimo) }
  $script:node = $node
  $faltam = @()
  if ($Origem -and -not (Get-Command git -ErrorAction SilentlyContinue)) {
    if (-not (Instalar-PorWinget 'Git.Git') -or -not (Get-Command git -ErrorAction SilentlyContinue)) { $faltam += 'git' }
  }
  if ($faltam.Count -gt 0) { Falhar 'prerequisitos' ('falta: ' + ($faltam -join ', ')) }
  Passo 'prerequisitos' $true ('node ' + $versao)
}

# `executor.mjs release` da própria pasta: a impressão digital do payload contra o contrato dela.
function Conferir-Release([string]$raiz) {
  $r = Rodar $script:node @((Join-Path $raiz 'runtime\executor.mjs'), 'release') $null
  $json = UltimoJson $r
  if ($r.codigo -eq 0 -and $json -and $json.ok) { return $json }
  $estado = if ($json -and ($json.PSObject.Properties.Name -contains 'estado')) { $json.estado } else { 'saida ' + $r.codigo }
  return [pscustomobject]@{ ok = $false; estado = $estado }
}

function Resolver-Sha {
  if (-not $Sha) { Uso 'falta -Sha' }
  if ($Origem) {
    $r = Rodar 'git' @('-C', $Origem, 'rev-parse', '--verify', '--quiet', ($Sha + '^{commit}')) $null
    if ($r.codigo -ne 0 -or $r.saida.Count -eq 0) { Falhar 'versao' ('commit ' + $Sha + ' não existe na origem') }
    return $r.saida[-1].Trim()
  }
  if ($Sha -notmatch '^[0-9a-f]{40}$') { Uso '-Sha precisa ser o sha completo (40 dígitos hexadecimais) sem -Origem' }
  return $Sha
}

# Baixa (ou empacota) numa pasta temporária, confere e só então promove; qualquer falha apaga a temporária.
function Obter-Versao {
  $sha = Resolver-Sha
  $script:shaInstalado = $sha
  $versoes = Join-Path $Base 'versoes'
  $destino = Join-Path $versoes $sha
  if (Test-Path -LiteralPath $destino) {
    $conferida = Conferir-Release $destino
    if ($conferida.ok) {
      $script:versaoInstalada = $conferida.versao
      Escrever-Atual $versoes $sha $conferida.versao
      Passo 'versao' $true 'já instalada'
      return $destino
    }
    Log ('versão ' + $sha + ' no disco não confere (' + $conferida.estado + '); baixando de novo')
    Apagar-Pasta $destino
  }
  $temporaria = Join-Path $versoes ('.' + $sha + '.baixando')
  Apagar-Pasta $temporaria
  New-Item -ItemType Directory -Force -Path $temporaria | Out-Null
  try {
    $zip = Join-Path $temporaria 'versao.zip'
    if ($Origem) {
      $r = Rodar 'git' @('-C', $Origem, 'archive', '--format=zip', ('--prefix=Omni-Agent-' + $sha + '/'), '-o', $zip, $sha) $null
      if ($r.codigo -ne 0) { Falhar 'versao' ('git archive saiu com ' + $r.codigo) }
    } else {
      $molde = if ($env:OMNI_INSTALAR_URL) { $env:OMNI_INSTALAR_URL } else { 'https://codeload.github.com/Weriton-DataOps/Omni-Agent/zip/{sha}' }
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      $ProgressPreference = 'SilentlyContinue'
      Invoke-WebRequest -UseBasicParsing -Uri $molde.Replace('{sha}', $sha) -OutFile $zip
    }
    # O tar.exe do Windows abre zip; o do Git (MSYS), se vier antes no PATH, não.
    $r = Rodar (Join-Path $env:SystemRoot 'System32\tar.exe') @('-xf', $zip, '-C', $temporaria) $null
    $extraida = Join-Path $temporaria ('Omni-Agent-' + $sha)
    if ($r.codigo -ne 0 -or -not (Test-Path -LiteralPath $extraida)) { Falhar 'versao' 'o pacote da versão não abriu' }
    $conferida = Conferir-Release $extraida
    if (-not $conferida.ok) { Falhar 'versao' ('integridade: ' + $conferida.estado) }
    [IO.Directory]::Move($extraida, $destino)
  } finally {
    try { Apagar-Pasta $temporaria } catch { Log ('não consegui apagar ' + $temporaria + ': ' + $_.Exception.Message) }
  }
  $script:versaoInstalada = $conferida.versao
  Escrever-Atual $versoes $sha $conferida.versao
  Passo 'versao' $true ($conferida.versao + ' em versoes\' + $sha)
  return $destino
}

# O executor.mjs da versão instalada: a regra (casa, agentes, tokens) é dele; aqui só se lê a última linha JSON.
function Rodar-Executor([string]$raiz, [string[]]$argumentos) {
  $r = Rodar $script:node (@((Join-Path $raiz 'runtime\executor.mjs')) + $argumentos) $null
  return [pscustomobject]@{ codigo = $r.codigo; json = (UltimoJson $r) }
}

function Executor-Aceitou($e) {
  return ($e.codigo -eq 0 -and $e.json -and $e.json.ok)
}

function Detalhe-DaRecusa($e) {
  if ($e.json -and ($e.json.PSObject.Properties.Name -contains 'codigo')) {
    $texto = [string]$e.json.codigo
    if ($e.json.PSObject.Properties.Name -contains 'erro') { $texto += ': ' + $e.json.erro }
    return $texto
  }
  return 'executor saiu com ' + $e.codigo
}

function Instalar-Casa([string]$raiz) {
  $e = Rodar-Executor $raiz @('instalar')
  if (-not (Executor-Aceitou $e)) { Falhar 'casa' (Detalhe-DaRecusa $e) }
  $mudou = $e.json.omni.mudou
  $estado = if ($mudou.agente -or $mudou.instalacao) { 'registrado' } else { 'sem mudança' }
  Passo 'casa' $true ('omni ' + $e.json.omni.versao + ': ' + $estado)
}

function Nome-DoAgente([string]$pasta) {
  try {
    $manifesto = Get-Content -LiteralPath (Join-Path $pasta 'executor\agente.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifesto.agente) { return [string]$manifesto.agente }
  } catch { }
  return Split-Path -Leaf $pasta
}

function Instalar-Agentes([string]$raiz) {
  if (-not $Agente) { return }
  foreach ($informada in $Agente) {
    $pasta = Caminho-Longo $informada
    $passo = 'agente:' + (Nome-DoAgente $pasta)
    $e = Rodar-Executor $raiz @('instalar-agente', '--raiz', $pasta)
    if (-not (Executor-Aceitou $e)) { Falhar $passo (Detalhe-DaRecusa $e) }
    $mudou = $e.json.mudou
    $detalhe = if ($mudou.agente -or $mudou.instalacao) { 'instalado ' + $e.json.versao } else { $e.json.versao + ': sem mudança' }
    if ($e.json.tokens -and @($e.json.tokens.novos).Count -gt 0) { $detalhe += ' (tokens novos: ' + (@($e.json.tokens.novos) -join ', ') + ')' }
    Passo $passo $true $detalhe
  }
}

function Achar-Npm {
  if ($env:OMNI_INSTALAR_NPM) { return $env:OMNI_INSTALAR_NPM }
  $c = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  return $null
}

function Rodar-Npm([string]$passo, [string]$pasta, [string[]]$argumentos) {
  $npm = Achar-Npm
  if (-not $npm) { Falhar $passo 'npm não encontrado (vem com o Node)' }
  Log ('npm ' + ($argumentos -join ' ') + ' em ' + $pasta)
  $r = Rodar $npm $argumentos $pasta
  foreach ($linha in $r.saida) { [Console]::Error.WriteLine($linha) }
  if ($r.codigo -ne 0) { Falhar $passo ('npm ' + ($argumentos -join ' ') + ' saiu com ' + $r.codigo) }
}

# Mesmo molde do atalho do WhatsApp que já roda nesta casa: conhost sem janela chamando o PowerShell.
function Criar-Atalho([string]$pasta, [string]$nome, [string]$ps1, [string]$icone) {
  [IO.Directory]::CreateDirectory($pasta) | Out-Null
  $pasta = Caminho-Longo $pasta
  $atalho = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $pasta ($nome + '.lnk')))
  $atalho.TargetPath = Join-Path $env:SystemRoot 'System32\conhost.exe'
  $atalho.Arguments = '--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $ps1 + '"'
  $atalho.WorkingDirectory = Split-Path -Parent $ps1
  if ($icone -and (Test-Path -LiteralPath $icone)) { $atalho.IconLocation = $icone }
  $atalho.Save()
  return (Join-Path $pasta ($nome + '.lnk'))
}

function Preparar-Ilha([string]$raiz) {
  $ilha = Join-Path $raiz 'apps\omni-ilha'
  Rodar-Npm 'ilha' $ilha @('ci')
  # O postinstall do Electron morre calado no Node 24; o -SoPreparar termina a extração pelo cache.
  $r = Rodar 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $ilha 'iniciar.ps1'), '-SoPreparar') $null
  if ($r.codigo -ne 0) { Falhar 'ilha' ('o Electron da ilha não ficou pronto (saída ' + $r.codigo + ')') }
  $pastas = if ($PastaAtalhos) { @($PastaAtalhos) } else { @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs')) }
  $criados = foreach ($pasta in $pastas) { Criar-Atalho $pasta 'Omni Ilha' (Join-Path $ilha 'iniciar.ps1') (Join-Path $ilha 'omni.ico') }
  Passo 'ilha' $true ('Electron pronto; atalho em ' + (@($criados) -join ', '))
}

function Preparar-WhatsApp([string]$raiz) {
  $servico = Join-Path $raiz 'servicos\whatsapp'
  Rodar-Npm 'whatsapp' $servico @('ci')
  Rodar-Npm 'whatsapp' $servico @('run', 'build')
  $pasta = if ($PastaInicializar) { $PastaInicializar } else { [Environment]::GetFolderPath('Startup') }
  $criado = Criar-Atalho $pasta 'Omni WhatsApp' (Join-Path $servico 'omni\iniciar.ps1') $null
  Passo 'whatsapp' $true ('serviço compilado; sobe no logon por ' + $criado)
}

# O vigia do WhatsApp roda pela versão instalada, de 5 em 5 minutos, mesmo molde do omni-actions-agendar.ps1.
# O primeiro disparo fica 5 minutos à frente: registrar nunca acorda o vigia na hora (ele mexe no WhatsApp
# de verdade), e o -StartWhenAvailable não tem início perdido para recuperar. -Force substitui a anterior.
function Registrar-Tarefas([string]$raiz) {
  $nome = $PrefixoTarefa + ' - vigia do WhatsApp'
  $vbs = Join-Path $raiz 'servicos\whatsapp\omni\vigia-servico.vbs'
  try {
    $acao = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + $vbs + '"') -WorkingDirectory (Split-Path -Parent $vbs)
    $gatilho = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Minutes 5)
    $regras = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew
    $quem = New-ScheduledTaskPrincipal -UserId ($env:USERDOMAIN + '\' + $env:USERNAME) -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $nome -Action $acao -Trigger $gatilho -Settings $regras -Principal $quem -Description 'Vigia do serviço WhatsApp do Omni (versão instalada).' -Force -ErrorAction Stop | Out-Null
  } catch { Falhar 'tarefas' ('não registrou ' + $nome + ': ' + $_.Exception.Message) }
  Passo 'tarefas' $true ($nome + ': a cada 5 min')
  $r = Rodar-TarefasDosAgentes $raiz 'registrar'
  if (-not $r.ok) { Falhar 'tarefas-agentes' (Detalhe-DasTarefas $r) }
  $feito = [string]@($r.json.registradas).Count + ' registrada(s)'
  if (@($r.json.podadas).Count) { $feito += ', podadas: ' + (@($r.json.podadas) -join ', ') }
  if (@($r.json.puladas).Count) { $feito += ', puladas por divergência: ' + (@($r.json.puladas) -join ', ') }
  Passo 'tarefas-agentes' $true $feito $r.json
}

# As tarefas que os agentes instalados declaram (scripts\omni-tarefas.ps1 da versão), com o mesmo node do
# instalador; o JSON da última linha volta inteiro.
function Rodar-TarefasDosAgentes([string]$raiz, [string]$modo) {
  if (-not $env:OMNI_NODE -and $script:node) { $env:OMNI_NODE = $script:node }
  $ps1 = Join-Path $raiz 'scripts\omni-tarefas.ps1'
  $r = Rodar 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $ps1, '-Modo', $modo, '-Prefixo', $PrefixoTarefa, '-Raiz', $raiz) $null
  $json = UltimoJson $r
  return [pscustomobject]@{ ok = ($r.codigo -eq 0 -and $json -and $json.ok); json = $json; codigo = $r.codigo }
}

function Detalhe-DasTarefas($r) {
  if (-not $r.json) { return 'omni-tarefas.ps1 saiu com ' + $r.codigo }
  $partes = @(@($r.json.divergencias) | Where-Object { $_ })
  if ($r.json.PSObject.Properties.Name -contains 'erro') { $partes = @([string]$r.json.erro) + $partes }
  if ($partes.Count -eq 0) { return 'omni-tarefas.ps1 saiu com ' + $r.codigo }
  return ($partes -join '; ')
}

# O claude da extensão do VS Code não entra no PATH; o do npm global mora em %APPDATA%\npm.
function Achar-Claude {
  if ($env:OMNI_INSTALAR_CLAUDE) {
    if (Test-Path -LiteralPath $env:OMNI_INSTALAR_CLAUDE) { return $env:OMNI_INSTALAR_CLAUDE }
    return $null
  }
  $c = Get-Command claude -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $npm = Join-Path $env:APPDATA 'npm\claude.cmd'
  if (Test-Path -LiteralPath $npm) { return $npm }
  return $null
}

# As listagens do claude marcam cada item com "  > nome"; a linha inteira precisa ser o nome.
function Listagem-Tem($r, [string]$nome) {
  foreach ($linha in @($r.saida)) { if ($linha -match ('^\s*>\s*' + [regex]::Escape($nome) + '\s*$')) { return $true } }
  return $false
}

function Rodar-Claude([string]$claude, [string[]]$argumentos) {
  Log ('claude ' + ($argumentos -join ' '))
  $r = Rodar $claude $argumentos $null
  if ($r.codigo -ne 0) {
    foreach ($linha in $r.saida) { [Console]::Error.WriteLine($linha) }
    Falhar 'plugin' ('claude ' + ($argumentos -join ' ') + ' saiu com ' + $r.codigo)
  }
  return $r
}

function Instalar-Plugin {
  $claude = Achar-Claude
  if (-not $claude) { Passo 'plugin' $false 'claude não encontrado: instale o Claude Code e rode de novo'; return }
  $mercados = Rodar-Claude $claude @('plugin', 'marketplace', 'list')
  if (Listagem-Tem $mercados 'omni-hub') { Rodar-Claude $claude @('plugin', 'marketplace', 'update', 'omni-hub') | Out-Null }
  else { Rodar-Claude $claude @('plugin', 'marketplace', 'add', 'https://github.com/Weriton-DataOps/Omni-Agent.git') | Out-Null }
  $plugins = Rodar-Claude $claude @('plugin', 'list')
  if (Listagem-Tem $plugins 'omni@omni-hub') {
    Rodar-Claude $claude @('plugin', 'update', 'omni@omni-hub', '--scope', 'user') | Out-Null
    Passo 'plugin' $true 'omni@omni-hub atualizado'
  } else {
    Rodar-Claude $claude @('plugin', 'install', 'omni@omni-hub', '--scope', 'user') | Out-Null
    Passo 'plugin' $true 'omni@omni-hub instalado'
  }
}

function Pasta-DadosWhatsApp {
  if ($env:OMNI_INSTALAR_WHATSAPP_DADOS) { return $env:OMNI_INSTALAR_WHATSAPP_DADOS }
  return (Join-Path $env:APPDATA 'omni\whatsapp')
}

# O segredo só entra pelo stdin do cofre e nada que o cofre escreve é guardado ou repassado: o ler devolve
# o valor no stdout, e aqui só interessa a saída (0 existe, 2 não existe).
function Rodar-Cofre([string]$cofre, [string]$acao, [string]$segredo) {
  $argumentos = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $cofre, '-Acao', $acao, '-Nome', 'omni/whatsapp/admin')
  $antes = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    if ($segredo) { $segredo | & powershell.exe @argumentos 2>$null | Out-Null }
    else { & powershell.exe @argumentos 2>$null | Out-Null }
    return $LASTEXITCODE
  } finally { $ErrorActionPreference = $antes }
}

function Guardar-ChaveAdmin([string]$raiz, [bool]$esperar) {
  $cofre = if ($env:OMNI_INSTALAR_COFRE) { $env:OMNI_INSTALAR_COFRE } else { Join-Path $raiz 'servicos\whatsapp\omni\cofre.ps1' }
  if ((Rodar-Cofre $cofre 'ler' $null) -eq 0) { Passo 'chave-admin' $true 'já no cofre'; return }
  $arquivo = Join-Path (Pasta-DadosWhatsApp) 'data\.api-key'
  # O serviço gera a chave na primeira subida; só vale esperar se ele foi iniciado agora.
  $espera = if ($esperar) { 180 } else { 0 }
  $ate = (Get-Date).AddSeconds($espera)
  while (-not (Test-Path -LiteralPath $arquivo) -and (Get-Date) -lt $ate) { Start-Sleep -Seconds 2 }
  if (-not (Test-Path -LiteralPath $arquivo)) { Passo 'chave-admin' $false 'serviço ainda não gerou a chave'; return }
  $codigo = Rodar-Cofre $cofre 'gravar' ([IO.File]::ReadAllText($arquivo).Trim())
  if ($codigo -ne 0) { Falhar 'chave-admin' ('o cofre não gravou a chave (saída ' + $codigo + ')') }
  Passo 'chave-admin' $true 'guardada no cofre do Windows'
}

function Subir-WhatsApp([string]$raiz) {
  $r = Rodar 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $raiz 'servicos\whatsapp\omni\iniciar.ps1')) $null
  $ok = ($r.codigo -eq 0)
  $detalhe = if ($ok) { 'serviço no ar' } else { 'o iniciar.ps1 saiu com ' + $r.codigo + '; detalhe em logs\iniciar.log' }
  Passo 'whatsapp-no-ar' $ok $detalhe
}

# A ilha abre já pedindo o pareamento (OMNI_ILHA_PAREAR, main.js); o processo filho herda a variável.
function Abrir-Ilha([string]$raiz) {
  $env:OMNI_ILHA_PAREAR = '1'
  $ps1 = Join-Path $raiz 'apps\omni-ilha\iniciar.ps1'
  Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $ps1 + '"'))
  Passo 'ilha-aberta' $true 'ilha aberta pedindo o pareamento'
}

function Ler-Atual {
  $arquivo = Join-Path $Base 'versoes\atual.json'
  if (-not (Test-Path -LiteralPath $arquivo)) { return $null }
  try { return (Get-Content -LiteralPath $arquivo -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
}

# atual.json de antes do campo `anterior` não o tem, e o StrictMode não deixa ler propriedade ausente.
function Campo($objeto, [string]$nome) {
  if ($null -eq $objeto -or -not ($objeto.PSObject.Properties.Name -contains $nome)) { return $null }
  return $objeto.$nome
}

# `anterior` é o caminho de volta: a versão que era a atual até esta troca. A poda nunca a apaga.
function Escrever-Atual([string]$versoes, [string]$sha, [string]$versao) {
  $atual = Ler-Atual
  if ((Campo $atual 'sha') -eq $sha) { return }
  $anterior = Campo $atual 'sha'
  Escrever-Json (Join-Path $versoes 'atual.json') ([ordered]@{ sha = $sha; versao = $versao; anterior = $anterior; instalada_em = (Get-Date).ToUniversalTime().ToString('o') })
}

# Ficam a atual e a anterior. Cada pasta velha é renomeada antes de ir embora: se algum processo ainda
# roda dela, o Windows recusa a troca de nome e ela fica inteira, em vez de meio apagada.
function Podar-Versoes {
  $versoes = Join-Path $Base 'versoes'
  $atual = Ler-Atual
  $manter = @((Campo $atual 'sha'), (Campo $atual 'anterior')) | Where-Object { $_ }
  $apagadas = @(); $presas = @()
  foreach ($pasta in @(Get-ChildItem -LiteralPath $versoes -Directory)) {
    $nome = $pasta.Name
    if ($nome -match '^\.[0-9a-f]{40}\.podando$') { try { Apagar-Pasta $pasta.FullName } catch { }; continue }
    if ($nome -notmatch '^[0-9a-f]{40}$' -or $manter -contains $nome) { continue }
    $lixo = Join-Path $versoes ('.' + $nome + '.podando')
    try { [IO.Directory]::Move($pasta.FullName, $lixo) } catch { $presas += $nome.Substring(0, 12); continue }
    try { Apagar-Pasta $lixo } catch { Log ('sobrou ' + $lixo + ': ' + $_.Exception.Message) }
    $apagadas += $nome.Substring(0, 12)
  }
  $detalhe = if ($apagadas.Count -gt 0) { 'apagadas: ' + ($apagadas -join ', ') } else { 'nada a apagar' }
  if ($presas.Count -gt 0) { $detalhe += '; em uso, ficaram: ' + ($presas -join ', ') }
  Passo 'poda' $true $detalhe
}

# Os passos que o instalar e o atualizar dividem; todos podem rodar de novo sem estrago.
function Instalar-Comum([string]$raiz) {
  Instalar-Casa $raiz
  Instalar-Agentes $raiz
  if (-not $SemIlha) { Preparar-Ilha $raiz }
  if (-not $SemWhatsApp) { Preparar-WhatsApp $raiz }
  if (-not $SemTarefas) { Registrar-Tarefas $raiz }
  if (-not $SemPlugin) { Instalar-Plugin }
}

# A versão que o atual.json aponta, para os modos que não baixam nada.
function Raiz-Atual([string]$passo) {
  $atual = Ler-Atual
  if (-not (Campo $atual 'sha')) { Falhar 'versao' 'nada instalado: falta versoes\atual.json' }
  $script:shaInstalado = [string]$atual.sha
  $script:versaoInstalada = [string](Campo $atual 'versao')
  $raiz = Join-Path $Base ('versoes\' + $atual.sha)
  if (-not (Test-Path -LiteralPath (Join-Path $raiz 'runtime\executor.mjs'))) { Falhar $passo ('a versão atual ' + $atual.sha + ' não está em versoes') }
  return $raiz
}

function Verificar-Release([string]$raiz) {
  $conferida = Conferir-Release $raiz
  if ($conferida.ok) { $script:versaoInstalada = $conferida.versao; Passo 'release' $true ($conferida.versao + ' confere') }
  else { Passo 'release' $false ('integridade: ' + $conferida.estado) }
}

function Verificar-Casa([string]$raiz) {
  $e = Rodar-Executor $raiz @('verificar')
  $ok = Executor-Aceitou $e
  $detalhe = if ($ok) { 'bancos íntegros' } elseif ($e.json -and ($e.json.PSObject.Properties.Name -contains 'codigo')) { Detalhe-DaRecusa $e } else { 'executor verificar saiu com ' + $e.codigo }
  Passo 'casa' $ok $detalhe $e.json
}

# Cada atalho que existe precisa chamar o iniciar.ps1 da versão atual; pasta sem atalho não reprova.
function Verificar-Atalhos([string]$raiz) {
  $pastasIlha = if ($PastaAtalhos) { @($PastaAtalhos) } else { @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs')) }
  $inicializar = if ($PastaInicializar) { $PastaInicializar } else { [Environment]::GetFolderPath('Startup') }
  $esperados = @()
  foreach ($pasta in $pastasIlha) { $esperados += , @((Join-Path $pasta 'Omni Ilha.lnk'), (Join-Path $raiz 'apps\omni-ilha\iniciar.ps1')) }
  $esperados += , @((Join-Path $inicializar 'Omni WhatsApp.lnk'), (Join-Path $raiz 'servicos\whatsapp\omni\iniciar.ps1'))
  $shell = New-Object -ComObject WScript.Shell
  $vistos = 0; $tortos = @()
  foreach ($par in $esperados) {
    if (-not (Test-Path -LiteralPath $par[0])) { continue }
    $vistos++
    $argumentos = [string]$shell.CreateShortcut($par[0]).Arguments
    if ($argumentos.IndexOf('"' + $par[1] + '"', [StringComparison]::OrdinalIgnoreCase) -lt 0) { $tortos += $par[0] }
  }
  if ($vistos -eq 0) { return }
  if ($tortos.Count -gt 0) { Passo 'atalhos' $false ('fora da versão atual: ' + ($tortos -join ', ')) }
  else { Passo 'atalhos' $true ($vistos.ToString() + ' na versão atual') }
}

function Verificar-Tarefas([string]$raiz) {
  $nome = $PrefixoTarefa + ' - vigia do WhatsApp'
  $tarefa = $null
  try { $tarefa = Get-ScheduledTask -TaskName $nome -ErrorAction Stop } catch { }
  if (-not $tarefa) { return }
  $vbs = '"' + (Join-Path $raiz 'servicos\whatsapp\omni\vigia-servico.vbs') + '"'
  $argumentos = [string]$tarefa.Actions[0].Arguments
  if ($argumentos -eq $vbs) { Passo 'tarefas' $true ($nome + ' na versão atual') }
  else { Passo 'tarefas' $false ($nome + ' aponta para ' + $argumentos) }
  $r = Rodar-TarefasDosAgentes $raiz 'verificar'
  if ($r.ok) { Passo 'tarefas-agentes' $true 'as tarefas dos agentes apontam para a versão atual' $r.json }
  else { Passo 'tarefas-agentes' $false (Detalhe-DasTarefas $r) $r.json }
}

# exportar e importar são do executor.mjs da versão atual; o JSON dele volta inteiro no passo.
function Repassar-Executor([string]$raiz, [string]$passo, [string[]]$argumentos, [string]$feito) {
  $e = Rodar-Executor $raiz $argumentos
  if (Executor-Aceitou $e) { Passo $passo $true $feito $e.json; return }
  Passo $passo $false (Detalhe-DaRecusa $e) $e.json
  throw $FALHOU
}

function Caminho-Absoluto([string]$caminho) {
  return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($caminho)
}

try {
  [IO.Directory]::CreateDirectory($Base) | Out-Null
  $Base = Caminho-Longo $Base
  switch ($Modo) {
    'instalar' {
      if (-not $Sha) { Uso 'falta -Sha' }
      Conferir-Prerequisitos
      $raiz = Obter-Versao
      Instalar-Comum $raiz
      if (-not $SemWhatsApp) {
        if (-not $NaoAbrir) { Subir-WhatsApp $raiz }
        Guardar-ChaveAdmin $raiz (-not $NaoAbrir)
      }
      if (-not $SemIlha -and -not $NaoAbrir) { Abrir-Ilha $raiz }
    }
    # Sem abrir a ilha nem subir o serviço: quem já está rodando segue na versão dele até o próximo logon.
    'atualizar' {
      if (-not $Sha) { Uso 'falta -Sha' }
      Conferir-Prerequisitos
      $raiz = Obter-Versao
      Instalar-Comum $raiz
      if (-not $SemWhatsApp) { Guardar-ChaveAdmin $raiz $false }
      Podar-Versoes
    }
    'verificar' {
      Conferir-Prerequisitos
      $raiz = Raiz-Atual 'release'
      Verificar-Release $raiz
      Verificar-Casa $raiz
      Verificar-Atalhos $raiz
      Verificar-Tarefas $raiz
      if (@($script:passos | Where-Object { -not $_.ok }).Count -gt 0) { Terminar 1 }
    }
    'exportar' {
      if (-not $Saida) { Uso 'falta -Saida' }
      Conferir-Prerequisitos
      $raiz = Raiz-Atual 'exportar'
      $destino = Caminho-Absoluto $Saida
      Repassar-Executor $raiz 'exportar' @('exportar', '--saida', $destino) ('pacote em ' + $destino)
    }
    'importar' {
      if (-not $Pacote) { Uso 'falta -Pacote' }
      Conferir-Prerequisitos
      $raiz = Raiz-Atual 'importar'
      Repassar-Executor $raiz 'importar' @('importar', '--pacote', (Caminho-Absoluto $Pacote)) 'casa importada'
    }
  }
  Terminar 0
} catch {
  if ($_.Exception.Message -ne $FALHOU) {
    Log ($_.InvocationInfo.PositionMessage)
    Passo 'erro' $false ($_.Exception.Message)
  }
  Terminar 1
}
