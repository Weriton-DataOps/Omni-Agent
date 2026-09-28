# Omni — cofre de segredos do serviço WhatsApp no Gerenciador de Credenciais do Windows (DPAPI da conta).
# ler:    escreve o segredo em stdout (exit 2 se não existir)
# gravar: lê o segredo de stdin — nunca por argumento, que apareceria na lista de processos
# apagar: remove a entrada
param(
    [Parameter(Mandatory = $true)][ValidateSet('ler', 'gravar', 'apagar')][string]$Acao,
    [Parameter(Mandatory = $true)][string]$Nome
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class OmniCofre {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL {
        public uint Flags; public uint Type; public string TargetName; public string Comment;
        public long LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob;
        public uint Persist; public uint AttributeCount; public IntPtr Attributes;
        public string TargetAlias; public string UserName;
    }
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool CredWrite(ref CREDENTIAL c, uint flags);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool CredRead(string target, uint type, uint flags, out IntPtr c);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool CredDelete(string target, uint type, uint flags);
    [DllImport("advapi32.dll")] private static extern void CredFree(IntPtr p);
    public static void Gravar(string alvo, string segredo) {
        byte[] b = Encoding.UTF8.GetBytes(segredo);
        IntPtr p = Marshal.AllocHGlobal(b.Length);
        try {
            Marshal.Copy(b, 0, p, b.Length);
            CREDENTIAL c = new CREDENTIAL();
            c.Type = 1; c.TargetName = alvo; c.CredentialBlobSize = (uint)b.Length; c.CredentialBlob = p; c.Persist = 2; c.UserName = "omni";
            if (!CredWrite(ref c, 0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        } finally {
            for (int i = 0; i < b.Length; i++) Marshal.WriteByte(p, i, 0);
            Marshal.FreeHGlobal(p); Array.Clear(b, 0, b.Length);
        }
    }
    public static string Ler(string alvo) {
        IntPtr p;
        if (!CredRead(alvo, 1, 0, out p)) return null;
        try {
            CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
            byte[] b = new byte[c.CredentialBlobSize];
            Marshal.Copy(c.CredentialBlob, b, 0, b.Length);
            return Encoding.UTF8.GetString(b);
        } finally { CredFree(p); }
    }
    public static bool Apagar(string alvo) { return CredDelete(alvo, 1, 0); }
}
'@
switch ($Acao) {
    'gravar' {
        $segredo = [Console]::In.ReadToEnd().Trim()
        if (-not $segredo) { throw 'segredo vazio; nada gravado' }
        [OmniCofre]::Gravar($Nome, $segredo)
        'ok'
    }
    'ler' {
        $valor = [OmniCofre]::Ler($Nome)
        if ($null -eq $valor) { exit 2 }
        [Console]::Out.Write($valor)
    }
    'apagar' {
        if ([OmniCofre]::Apagar($Nome)) { 'ok' } else { exit 2 }
    }
}
