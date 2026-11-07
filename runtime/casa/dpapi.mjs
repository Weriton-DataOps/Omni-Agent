// Ponte DPAPI do cofre (§8.1): sela e abre valores com a DPAPI do usuário do Windows
// (ProtectedData, escopo CurrentUser) num PowerShell 5.1 filho, lista os alvos Omni/* do
// Gerenciador de Credenciais do Windows sem ler o segredo deles e abre um blob direto para a área de
// transferência (decisão 4): o texto vai com os três formatos que o tiram do histórico e da nuvem, e um
// PowerShell destacado limpa a área 30 s depois, só se o número de sequência dela não mudou.
// O segredo nunca vai no argumento do processo: o script vai em -EncodedCommand e os valores
// entram pelo stdin, um por linha, em base64. A resposta vem uma linha por item, "ok <base64>" ou
// "falha <TipoDoErro>", e a ponte confere a contagem. O stderr do filho nunca entra em mensagem.
// Na cópia, o segredo aberto não volta ao Node: a resposta é "ok <prazo em ms>" ou "falha <TipoDoErro>". Os bytes
// são zerados no filho; a string do .NET que vai para a área não tem como ser zerada.
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

export class PonteDpapiError extends Error {
  constructor(mensagem) {
    super(mensagem)
    this.name = 'PonteDpapiError'
    this.code = 'OMNI_COFRE_PONTE'
  }
}

export const codificar = (script) => Buffer.from(script, 'utf16le').toString('base64')

const SCRIPT_CIFRA = String.raw`$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Security
$linhas = [Console]::In.ReadToEnd() -split "\r?\n"
$operacao = $linhas[0]
if ($operacao -ne 'selar' -and $operacao -ne 'abrir') { [Console]::Error.WriteLine('operacao desconhecida'); exit 2 }
$escopo = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
$saida = New-Object System.Text.StringBuilder
for ($i = 1; $i -lt $linhas.Length; $i++) {
  $linha = $linhas[$i]
  if ($linha -eq '') { continue }
  $entrada = $null; $resultado = $null
  try {
    $entrada = [Convert]::FromBase64String($linha)
    if ($operacao -eq 'selar') { $resultado = [System.Security.Cryptography.ProtectedData]::Protect($entrada, $null, $escopo) }
    else { $resultado = [System.Security.Cryptography.ProtectedData]::Unprotect($entrada, $null, $escopo) }
    [void]$saida.Append('ok ').Append([Convert]::ToBase64String($resultado)).Append([char]10)
  } catch {
    $e = $_.Exception; if ($e.InnerException) { $e = $e.InnerException }
    [void]$saida.Append('falha ').Append($e.GetType().Name).Append([char]10)
  } finally {
    if ($null -ne $entrada) { [Array]::Clear($entrada, 0, $entrada.Length) }
    if ($null -ne $resultado) { [Array]::Clear($resultado, 0, $resultado.Length) }
  }
}
[Console]::Out.Write($saida.ToString())
`

const SCRIPT_INVENTARIO = String.raw`$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Text;
public static class OmniInventarioCofre {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct CREDENTIAL { public int Flags; public int Type; public IntPtr TargetName; public IntPtr Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName; }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CredEnumerateW(string filter, int flags, out int count, out IntPtr credentials);
  [DllImport("advapi32.dll")] private static extern void CredFree(IntPtr buffer);
  private static string B64(IntPtr ptr) { string texto = ptr == IntPtr.Zero ? null : Marshal.PtrToStringUni(ptr); return string.IsNullOrEmpty(texto) ? "-" : Convert.ToBase64String(Encoding.UTF8.GetBytes(texto)); }
  public static string Listar() {
    int quantos; IntPtr lista;
    if (!CredEnumerateW("Omni/*", 0, out quantos, out lista)) { int erro = Marshal.GetLastWin32Error(); if (erro == 1168) return ""; throw new System.ComponentModel.Win32Exception(erro); }
    try {
      StringBuilder saida = new StringBuilder();
      for (int i = 0; i < quantos; i++) {
        IntPtr item = Marshal.ReadIntPtr(lista, i * IntPtr.Size);
        CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(item, typeof(CREDENTIAL));
        saida.Append("cred ").Append(B64(c.TargetName)).Append(' ').Append(B64(c.UserName)).Append(' ').Append(c.Type).Append(' ').Append(c.Persist).Append('\n');
      }
      return saida.ToString();
    } finally { CredFree(lista); }
  }
}
'@
[Console]::Out.Write([OmniInventarioCofre]::Listar())
`

// O que a cópia e a limpeza chamam da user32: o número de sequência da área e o abrir, esvaziar e fechar dela.
const MEMBROS_AREA = String.raw`[DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
[DllImport("user32.dll", SetLastError = true)] public static extern bool OpenClipboard(IntPtr janela);
[DllImport("user32.dll", SetLastError = true)] public static extern bool EmptyClipboard();
[DllImport("user32.dll", SetLastError = true)] public static extern bool CloseClipboard();`

// A limpeza roda num PowerShell destacado, que herda do pai o número e o prazo pelo ambiente: espera o prazo e
// só esvazia a área se o número de sequência ainda é o da cópia; se outro programa copiou depois, não mexe.
const SCRIPT_LIMPEZA = String.raw`$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -Namespace OmniCofre -Name Area -MemberDefinition '${MEMBROS_AREA}'
$numero = [uint32]$env:OMNI_COFRE_AREA_NUMERO
$espera = [int64]$env:OMNI_COFRE_AREA_PRAZO - [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
if ($espera -gt 0) { Start-Sleep -Milliseconds $espera }
for ($tentativa = 0; $tentativa -lt 50; $tentativa++) {
  if ([OmniCofre.Area]::OpenClipboard([IntPtr]::Zero)) {
    try { if ([OmniCofre.Area]::GetClipboardSequenceNumber() -eq $numero) { $null = [OmniCofre.Area]::EmptyClipboard() } }
    finally { $null = [OmniCofre.Area]::CloseClipboard() }
    break
  }
  Start-Sleep -Milliseconds 100
}
`

// A cópia: o blob entra pela primeira linha do stdin e é aberto aqui; a resposta nunca leva o valor.
const SCRIPT_AREA = String.raw`$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Security
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Namespace OmniCofre -Name Area -MemberDefinition '${MEMBROS_AREA}'
$entrada = $null; $aberto = $null
try {
  $entrada = [Convert]::FromBase64String([Console]::In.ReadLine())
  $aberto = [System.Security.Cryptography.ProtectedData]::Unprotect($entrada, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  $dados = New-Object System.Windows.Forms.DataObject
  $dados.SetText([System.Text.Encoding]::UTF8.GetString($aberto))
  foreach ($formato in 'ExcludeClipboardContentFromMonitorProcessing', 'CanIncludeInClipboardHistory', 'CanUploadToCloudClipboard') {
    $dados.SetData($formato, [System.IO.MemoryStream]::new([byte[]](0, 0, 0, 0)))
  }
  [System.Windows.Forms.Clipboard]::SetDataObject($dados, $true, 10, 100)
  $numero = [OmniCofre.Area]::GetClipboardSequenceNumber()
  $prazo = [DateTimeOffset]::UtcNow.AddSeconds(30).ToUnixTimeMilliseconds()
  $env:OMNI_COFRE_AREA_NUMERO = [string]$numero
  $env:OMNI_COFRE_AREA_PRAZO = [string]$prazo
  $null = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList '-NoProfile', '-NonInteractive', '-EncodedCommand', '${codificar(SCRIPT_LIMPEZA)}' -WindowStyle Hidden
  [Console]::Out.Write('ok ' + $prazo + [char]10)
} catch {
  $e = $_.Exception; if ($e.InnerException) { $e = $e.InnerException }
  [Console]::Out.Write('falha ' + $e.GetType().Name + [char]10)
} finally {
  if ($null -ne $entrada) { [Array]::Clear($entrada, 0, $entrada.Length) }
  if ($null -ne $aberto) { [Array]::Clear($aberto, 0, $aberto.Length) }
}
`

export function powershellPadrao(env = process.env) {
  return join(env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

const linhasDe = (saida) => saida.split('\n').map((linha) => linha.replace(/\r$/, '')).filter((linha) => linha !== '')

function comoBuffer(item) {
  if (Buffer.isBuffer(item)) return item
  if (item instanceof Uint8Array) return Buffer.from(item.buffer, item.byteOffset, item.byteLength)
  throw new PonteDpapiError('a ponte DPAPI só aceita bytes')
}

export function criarPonteDpapi({ executar = spawnSync, powershell = powershellPadrao(), limiteMs = 30_000 } = {}) {
  function rodar(script, entrada) {
    const resultado = executar(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', codificar(script)], {
      input: entrada, encoding: 'utf8', windowsHide: true, timeout: limiteMs, maxBuffer: 16 * 1024 * 1024
    })
    if (resultado.error) throw new PonteDpapiError(`a ponte DPAPI não rodou: ${resultado.error.code ?? resultado.error.name}`)
    if (resultado.status !== 0) throw new PonteDpapiError(`a ponte DPAPI saiu com ${resultado.status}`)
    return linhasDe(resultado.stdout ?? '')
  }
  function cifrar(operacao, itens) {
    const bytes = itens.map(comoBuffer)
    if (bytes.length === 0) return []
    const entrada = `${operacao}\n${bytes.map((b) => (b.length === 0 ? '-' : b.toString('base64'))).join('\n')}\n`
    const linhas = rodar(SCRIPT_CIFRA, entrada)
    if (linhas.length !== bytes.length) throw new PonteDpapiError(`a ponte DPAPI devolveu ${linhas.length} linha(s) para ${bytes.length} item(ns)`)
    return linhas.map((linha) => {
      const ok = /^ok ([A-Za-z0-9+/=]*)$/.exec(linha)
      if (ok) return { ok: true, valor: Buffer.from(ok[1], 'base64') }
      const falha = /^falha (\w+)$/.exec(linha)
      if (falha) return { ok: false, erro: falha[1] }
      throw new PonteDpapiError('a ponte DPAPI respondeu fora do protocolo')
    })
  }
  return {
    selar(valores) {
      const bytes = valores.map(comoBuffer)
      if (bytes.some((b) => b.length === 0)) throw new PonteDpapiError('valor vazio não se sela')
      const resultados = cifrar('selar', bytes)
      const falha = resultados.find((r) => !r.ok)
      if (falha) throw new PonteDpapiError(`a DPAPI não selou: ${falha.erro}`)
      return resultados.map((r) => r.valor)
    },
    abrir(blobs) { return cifrar('abrir', blobs) },
    abrirParaAreaDeTransferencia(blob) {
      const bytes = comoBuffer(blob)
      if (bytes.length === 0) throw new PonteDpapiError('blob vazio não se copia')
      const linhas = rodar(SCRIPT_AREA, `${bytes.toString('base64')}\n`)
      if (linhas.length !== 1) throw new PonteDpapiError(`a ponte DPAPI devolveu ${linhas.length} linha(s) para 1 item(ns)`)
      const ok = /^ok (\d{1,15})$/.exec(linhas[0])
      if (ok) return { ok: true, limpaEm: new Date(Number(ok[1])).toISOString() }
      const falha = /^falha (\w+)$/.exec(linhas[0])
      if (falha) return { ok: false, erro: falha[1] }
      throw new PonteDpapiError('a ponte DPAPI respondeu fora do protocolo')
    },
    inventariarGerenciador() {
      const texto = (campo) => (campo === '-' ? null : Buffer.from(campo, 'base64').toString('utf8'))
      return rodar(SCRIPT_INVENTARIO, '').flatMap((linha) => {
        const partes = /^cred ([A-Za-z0-9+/=]+|-) ([A-Za-z0-9+/=]+|-) (\d+) (\d+)$/.exec(linha)
        if (!partes) throw new PonteDpapiError('o inventário respondeu fora do protocolo')
        const alvo = texto(partes[1])
        return alvo === null ? [] : [{ alvo, usuario: texto(partes[2]), tipo: Number(partes[3]), persistencia: Number(partes[4]) }]
      })
    }
  }
}
