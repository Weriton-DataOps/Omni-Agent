$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$taskApp = Split-Path -Parent $PSScriptRoot
$taskVersion = (Get-Content -Raw -LiteralPath (Join-Path $taskApp 'vscode\package.json') | ConvertFrom-Json).version
$taskOutput = Join-Path $taskApp "out\omni-desktop-bridge-$taskVersion.vsix"
[IO.Directory]::CreateDirectory((Join-Path $taskApp 'out')) | Out-Null
$taskStream = [IO.File]::Open($taskOutput, [IO.FileMode]::Create)
$taskZip = New-Object IO.Compression.ZipArchive($taskStream, [IO.Compression.ZipArchiveMode]::Create)
function Add-TextEntry($name, $content) {
    $taskEntry = $taskZip.CreateEntry($name)
    $taskWriter = New-Object IO.StreamWriter($taskEntry.Open())
    try { $taskWriter.Write($content) } finally { $taskWriter.Dispose() }
}
try {
    Add-TextEntry '[Content_Types].xml' '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="cjs" ContentType="application/javascript"/><Default Extension="vsixmanifest" ContentType="text/xml"/></Types>'
    Add-TextEntry 'extension.vsixmanifest' "<?xml version=`"1.0`"?><PackageManifest Version=`"2.0.0`" xmlns=`"http://schemas.microsoft.com/developer/vsx-schema/2011`"><Metadata><Identity Language=`"en-US`" Id=`"omni-desktop-bridge`" Version=`"$taskVersion`" Publisher=`"omni-local`"/><DisplayName>Omni Desktop</DisplayName><Description xml:space=`"preserve`">Sessao Claude do Omni no VS Code.</Description><Properties><Property Id=`"Microsoft.VisualStudio.Code.Engine`" Value=`"^1.90.0`"/></Properties></Metadata><Installation><InstallationTarget Id=`"Microsoft.VisualStudio.Code`"/></Installation><Dependencies/><Assets><Asset Type=`"Microsoft.VisualStudio.Code.Manifest`" Path=`"extension/package.json`" Addressable=`"true`"/></Assets></PackageManifest>"
    foreach ($taskName in @('package.json', 'main.cjs')) { Add-TextEntry "extension/$taskName" ([IO.File]::ReadAllText((Join-Path $taskApp "vscode\$taskName"))) }
} finally { $taskZip.Dispose(); $taskStream.Dispose() }
Write-Output $taskOutput
