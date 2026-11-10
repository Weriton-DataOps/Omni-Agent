// Supervisor do `servir` dos agentes (contratos de 05/11). Para cada agente que o núcleo diz instalado
// aqui com o modo servir, sobe `<executor.comando> servir --porta 0` na raiz dele, com OMNI_API e
// OMNI_API_TOKEN no ambiente, lê a 1ª linha do stdout e mantém o processo de pé:
// - {"ok":true,"porta":n} põe no ar; campo a mais é tolerado;
// - saída 2 (uso), {"recusa":true} ou comando inexistente é recusa permanente: tentar de novo não
//   conserta configuração, e a ilha mostra o erro;
// - qualquer outra queda volta com espera dobrada até o teto; quem ficou de pé o bastante zera a conta;
// - parar fecha o stdin (o pedido de parada do contrato) e só mata quem passar do prazo.
import { spawn } from 'node:child_process'

export const ESTADOS = Object.freeze(['subindo', 'no-ar', 'esperando', 'recusado', 'manifesto-divergente', 'parando', 'parado'])
const LIMITE_LINHA = 4096
const LIMITE_ERRO = 300

export function esperaDoBackoff(falhas, baseMs, tetoMs) {
  return Math.min(baseMs * 2 ** Math.max(falhas - 1, 0), tetoMs)
}

// O comando do manifesto é "programa arg1 arg2", sem aspas (caminho com espaço não cabe aqui).
// "node" vira o executável que roda o Omni: a mesma versão, sem depender do PATH.
export function partirComando(comando, execPath = process.execPath) {
  const partes = String(comando ?? '').trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) throw new TypeError('Comando vazio.')
  return { programa: partes[0] === 'node' ? execPath : partes[0], argumentos: partes.slice(1) }
}

const curto = (texto) => String(texto ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITE_ERRO)

export function criarSupervisor({
  agentes, omniApi, env = process.env, iniciar = spawn, log = () => {}, aoMudar = null,
  baseMs = 1_000, tetoMs = 60_000, estavelMs = 60_000, subidaMs = 15_000, paradaMs = 5_000, relogio = Date.now
}) {
  // Quem precisa do mapa de portas (o servir.json) ouve aqui: entrou no ar ou saiu dele.
  const avisar = () => {
    if (!aoMudar) return
    try { aoMudar() } catch (falha) { log(`aoMudar: ${curto(falha?.message ?? falha)}`) }
  }
  const vigias = agentes.map((a) => ({
    agente: a.agente, raiz: a.raiz, comando: a.comando,
    estado: a.divergente ? 'manifesto-divergente' : 'parado',
    porta: null, pid: null, falhas: 0, erro: null, desde: null, filho: null, timer: null
  }))
  let parando = false

  function recusar(v, motivo) {
    v.estado = 'recusado'
    v.erro = curto(motivo)
    v.desde = relogio()
    log(`${v.agente}: recusado (${v.erro}); sem nova tentativa`)
  }

  function subir(v) {
    v.timer = null
    if (parando) return
    v.estado = 'subindo'
    v.porta = null
    v.desde = relogio()
    let comando
    try {
      comando = partirComando(v.comando)
    } catch {
      recusar(v, 'comando vazio no manifesto')
      return
    }
    let filho
    try {
      filho = iniciar(comando.programa, [...comando.argumentos, 'servir', '--porta', '0'], {
        cwd: v.raiz,
        env: { ...env, OMNI_API: omniApi.url, OMNI_API_TOKEN: omniApi.token },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })
    } catch (erro) {
      recusar(v, `não subiu: ${erro?.message ?? erro}`)
      return
    }
    v.filho = filho
    v.pid = filho.pid ?? null

    let leu = false
    let buffer = ''
    let recusa = null
    let motivo = null
    let encerrado = false
    const prazo = setTimeout(() => {
      if (leu) return
      motivo = 'sem a 1ª linha no prazo'
      filho.kill()
    }, subidaMs)

    filho.stdout.setEncoding('utf8')
    filho.stdout.on('data', (pedaco) => {
      if (leu) return
      buffer += pedaco
      const fim = buffer.indexOf('\n')
      if (fim < 0) {
        if (buffer.length > LIMITE_LINHA) {
          leu = true
          motivo = '1ª linha grande demais'
          filho.kill()
        }
        return
      }
      leu = true
      clearTimeout(prazo)
      let linha = null
      try {
        linha = JSON.parse(buffer.slice(0, fim))
      } catch {
        linha = null
      }
      buffer = ''
      if (linha?.ok === true && Number.isInteger(linha.porta) && linha.porta > 0 && linha.porta < 65536) {
        v.estado = 'no-ar'
        v.porta = linha.porta
        v.erro = null
        v.desde = relogio()
        log(`${v.agente}: no ar na porta ${linha.porta}`)
        avisar()
        return
      }
      if (linha?.recusa === true) recusa = typeof linha.erro === 'string' ? linha.erro : 'recusou a subida'
      else motivo = linha === null ? '1ª linha não é JSON' : curto(linha.erro ?? '1ª linha sem ok')
      filho.kill()
    })

    let resto = ''
    filho.stderr.setEncoding('utf8')
    filho.stderr.on('data', (pedaco) => {
      resto += pedaco
      const linhas = resto.split(/\r?\n/)
      resto = linhas.pop() ?? ''
      for (const linha of linhas) if (linha.trim()) log(`${v.agente}: ${curto(linha)}`)
    })
    filho.stdin.on('error', () => {})

    const encerrar = (codigo, erroDeSubida) => {
      if (encerrado) return
      encerrado = true
      clearTimeout(prazo)
      const estavaNoAr = v.porta !== null // o parar já trocou o estado; a porta só existe no ar
      v.filho = null
      v.pid = null
      v.porta = null
      decidir(codigo, erroDeSubida, estavaNoAr)
      if (estavaNoAr) avisar()
    }
    const decidir = (codigo, erroDeSubida, estavaNoAr) => {
      if (parando) {
        v.estado = 'parado'
        return
      }
      if (erroDeSubida?.code === 'ENOENT') { recusar(v, 'comando do executor não encontrado'); return }
      if (recusa !== null) { recusar(v, recusa); return }
      if (codigo === 2) { recusar(v, 'saída 2: uso inválido do servir'); return }
      const ficouDePe = estavaNoAr && relogio() - (v.desde ?? 0) >= estavelMs
      v.falhas = ficouDePe ? 1 : v.falhas + 1
      v.erro = motivo ?? (erroDeSubida ? curto(erroDeSubida.message) : `saiu com código ${codigo}`)
      const espera = esperaDoBackoff(v.falhas, baseMs, tetoMs)
      v.estado = 'esperando'
      v.desde = relogio()
      log(`${v.agente}: caiu (${v.erro}); nova tentativa em ${espera} ms`)
      v.timer = setTimeout(() => subir(v), espera)
    }
    filho.on('error', (erro) => encerrar(null, erro))
    filho.on('close', (codigo) => encerrar(codigo, null))
  }

  return {
    iniciar() {
      for (const v of vigias) if (v.estado === 'parado') subir(v)
    },
    parar() {
      parando = true
      return Promise.all(vigias.map((v) => {
        if (v.timer) {
          clearTimeout(v.timer)
          v.timer = null
        }
        if (v.estado === 'esperando' || v.estado === 'subindo' || v.estado === 'no-ar') v.estado = 'parado'
        const filho = v.filho
        if (!filho) return undefined
        v.estado = 'parando'
        return new Promise((resolver) => {
          const prazo = setTimeout(() => filho.kill(), paradaMs)
          filho.once('close', () => {
            clearTimeout(prazo)
            resolver(undefined)
          })
          filho.stdin.end()
        })
      }))
    },
    estado() {
      return vigias.map((v) => ({
        agente: v.agente, estado: v.estado, porta: v.porta, pid: v.pid, falhas: v.falhas, erro: v.erro,
        desde: v.desde === null ? null : new Date(v.desde).toISOString()
      }))
    }
  }
}
