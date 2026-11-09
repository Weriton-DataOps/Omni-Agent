// Ponte de presença do cofre (decisões 2, 3 e 19): o Windows Hello pelo UserConsentVerifier, num PowerShell 5.1
// filho, pelo mesmo caminho da ponte DPAPI (script em -EncodedCommand, sem argumento depois dele, spawnSync com
// windowsHide). disponivel() só chama o CheckAvailabilityAsync, que não abre diálogo; verificar(mensagem) chama o
// RequestVerificationAsync, que abre o diálogo do Hello. A mensagem vai pelo stdin, em base64 de UTF-8 (o stdin do
// 5.1 lê na página OEM), nunca no argumento nem no script. Todo desfecho vira { ok, motivo }, com motivo ok,
// cancelado, indisponivel, tempo ou falhou; a ponte não lança por causa do filho, e o stderr dele não sai daqui.
import { spawnSync } from 'node:child_process'

import { codificar, powershellPadrao } from './dpapi.mjs'

// O AsTask genérico de IAsyncOperation`1 é escolhido pelo nome do parâmetro; a crase do nome entra como [char]96.
const SCRIPT_PRESENCA = String.raw`$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$linhas = [Console]::In.ReadToEnd() -split "\r?\n"
$operacao = $linhas[0]
if ($operacao -ne 'disponivel' -and $operacao -ne 'verificar') { [Console]::Error.WriteLine('operacao desconhecida'); exit 2 }
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime]
$nome = 'IAsyncOperation' + [char]96 + '1'
$comoTarefa = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq $nome } | Select-Object -First 1
if ($operacao -eq 'disponivel') {
  $tarefa = $comoTarefa.MakeGenericMethod([Windows.Security.Credentials.UI.UserConsentVerifierAvailability]).Invoke($null, @([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()))
  $prefixo = 'disponibilidade'; $limite = 10000
} else {
  $mensagem = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($linhas[1]))
  $tarefa = $comoTarefa.MakeGenericMethod([Windows.Security.Credentials.UI.UserConsentVerificationResult]).Invoke($null, @([Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync($mensagem)))
  $prefixo = 'resultado'; $limite = 60000
}
if (-not $tarefa.Wait($limite)) { [Console]::Out.Write('tempo' + [char]10); exit 0 }
[Console]::Out.Write($prefixo + ' ' + $tarefa.Result + [char]10)
`

const INDISPONIVEL = ['DeviceNotPresent', 'NotConfiguredForUser', 'DisabledByPolicy', 'DeviceBusy'].map((nome) => [nome, 'indisponivel'])
const DISPONIBILIDADE = new Map([['Available', 'ok'], ...INDISPONIVEL])
const RESULTADO = new Map([['Verified', 'ok'], ['Canceled', 'cancelado'], ['RetriesExhausted', 'falhou'], ...INDISPONIVEL])
const desfecho = (motivo) => ({ ok: motivo === 'ok', motivo })

export function criarPontePresenca({ executar = spawnSync, powershell = powershellPadrao(), limiteMs = 75_000 } = {}) {
  function perguntar(entrada, prefixo, mapa) {
    const resultado = executar(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', codificar(SCRIPT_PRESENCA)], {
      input: entrada, encoding: 'utf8', windowsHide: true, timeout: limiteMs
    })
    if (resultado.error) return desfecho(resultado.error.code === 'ETIMEDOUT' ? 'tempo' : 'falhou')
    if (resultado.status !== 0) return desfecho('falhou')
    const linhas = (resultado.stdout ?? '').split(/\r?\n/).filter((linha) => linha !== '')
    if (linhas.length !== 1) return desfecho('falhou')
    if (linhas[0] === 'tempo') return desfecho('tempo')
    const achado = /^(\w+) (\w+)$/.exec(linhas[0])
    if (!achado || achado[1] !== prefixo) return desfecho('falhou')
    return desfecho(mapa.get(achado[2]) ?? 'falhou')
  }
  return {
    disponivel() { return perguntar('disponivel\n', 'disponibilidade', DISPONIBILIDADE) },
    verificar(mensagem) {
      if (typeof mensagem !== 'string' || mensagem.trim() === '') throw new TypeError('a mensagem do Hello precisa ser um texto não vazio')
      return perguntar(`verificar\n${Buffer.from(mensagem, 'utf8').toString('base64')}\n`, 'resultado', RESULTADO)
    }
  }
}
