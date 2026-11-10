// Omni — o laço de UM pareamento do WhatsApp (pessoal ou bot), puro: a API, o relógio, a espera, o
// gerador de QR e os gravadores vêm de fora. Quem o usa: parear.mjs (CLI, página HTML ou linhas JSON).
//
// Eventos emitidos (lista fechada; o pareador da ilha descarta o resto):
//   { evento: 'sessao', papel }
//   { evento: 'estado', papel, estado }                       quando o estado muda
//   { evento: 'qr', papel, qr: 'data:image/png;base64,…', estado }
//   { evento: 'pareado', papel, fone4 }
//   { evento: 'fim', papel, ok, motivo?, detalhe? }
// Motivos: servico-fora, sem-pessoal, mesmo-numero, caiu, acao-necessaria, prazo.
// Nenhum evento leva o número inteiro: só os 4 últimos dígitos.

const NOME_SESSAO = { pessoal: 'omni-pessoal', bot: 'omni-bot' }
const QUEDAS = ['disconnected', 'failed']
const REINICIOS_MAX = 3
const PAUSA_MS = 3000

class ServicoFora extends Error {}

const digitos = (v) => String(v ?? '').replace(/\D/g, '')
// Texto vindo do serviço pode citar um JID; corta qualquer sequência longa de dígitos.
const mascarar = (t) => String(t ?? '').replace(/\d{8,}/g, (d) => `…${d.slice(-4)}`)

async function chamar(api, metodo, caminho, corpo) {
  let r
  try { r = await api(metodo, caminho, corpo) } catch { throw new ServicoFora() }
  if (!r || r.status === 0) throw new ServicoFora()
  return r
}

async function sessaoDoPapel(api, papel, ids) {
  const gravado = ids.ler(papel)
  if (gravado) {
    const r = await chamar(api, 'GET', `/api/sessions/${gravado}`)
    if (r.status !== 404) return { id: gravado, atual: r.dados }
  }
  const { dados: lista } = await chamar(api, 'GET', '/api/sessions')
  const itens = Array.isArray(lista) ? lista : lista?.items || []
  let id = itens.find((s) => s.name === NOME_SESSAO[papel])?.id
  if (!id) id = (await chamar(api, 'POST', '/api/sessions', { name: NOME_SESSAO[papel] })).dados?.id
  if (!id) throw new ServicoFora()
  ids.gravar(papel, id)
  return { id, atual: (await chamar(api, 'GET', `/api/sessions/${id}`)).dados }
}

export async function parearSessao({ api, papel, ids, dono, emitir, esperar, agora, qrImagem, prazoMs = 10 * 60_000 }) {
  const encerrar = (resultado, extraFim = {}) => {
    emitir({ evento: 'fim', papel, ok: resultado.ok, ...(resultado.motivo ? { motivo: resultado.motivo } : {}), ...extraFim })
    return resultado
  }
  try {
    // O bot só pareia depois do pessoal: é a ordem do §4.1, e é o número do pessoal que pega o celular trocado.
    let fonePessoal = null
    if (papel === 'bot') {
      const idPessoal = ids.ler('pessoal')
      if (!idPessoal) return encerrar({ ok: false, motivo: 'sem-pessoal' })
      const { dados } = await chamar(api, 'GET', `/api/sessions/${idPessoal}`)
      if (dados?.status !== 'ready') return encerrar({ ok: false, motivo: 'sem-pessoal' })
      fonePessoal = digitos(dados.phone)
    }

    const { id, atual } = await sessaoDoPapel(api, papel, ids)
    emitir({ evento: 'sessao', papel })
    const inicio = agora()
    if (atual?.status !== 'ready') await chamar(api, 'POST', `/api/sessions/${id}/start`)

    let ultimoQr = ''
    let ultimoEstado = null
    let reinicios = 0
    while (agora() - inicio < prazoMs) {
      const { dados: s } = await chamar(api, 'GET', `/api/sessions/${id}`)
      const estado = String(s?.status || '')
      if (estado !== ultimoEstado) { ultimoEstado = estado; emitir({ evento: 'estado', papel, estado }) }

      if (estado === 'ready') {
        const fone = digitos(s.phone)
        if (papel === 'bot' && fone && fone === fonePessoal) {
          // Escaneou o QR do bot com o celular pessoal: desfaz, senão o pessoal fica conectado duas vezes.
          await chamar(api, 'POST', `/api/sessions/${id}/logout`)
          return encerrar({ ok: false, motivo: 'mesmo-numero' })
        }
        const fone4 = fone.slice(-4)
        emitir({ evento: 'pareado', papel, fone4 })
        if (papel === 'pessoal' && fone && !dono.ler()) dono.gravar(fone)
        emitir({ evento: 'fim', papel, ok: true })
        return { ok: true, fone4 }
      }

      if (QUEDAS.includes(estado)) {
        if (reinicios >= REINICIOS_MAX) return encerrar({ ok: false, motivo: 'caiu' })
        reinicios++
        ultimoQr = ''
        await chamar(api, 'POST', `/api/sessions/${id}/start`)
        await esperar(PAUSA_MS)
        continue
      }

      if (estado === 'action_required') {
        const detalhe = mascarar(s?.lastError || 'ver o log do serviço').slice(0, 200)
        return encerrar({ ok: false, motivo: 'acao-necessaria', detalhe }, { detalhe })
      }

      const { dados: q } = await chamar(api, 'GET', `/api/sessions/${id}/qr`)
      const codigo = q?.qrCode
      if (codigo && codigo !== ultimoQr) {
        ultimoQr = codigo
        const qr = codigo.startsWith('data:image') ? codigo : await qrImagem(codigo)
        emitir({ evento: 'qr', papel, qr, estado })
      }
      await esperar(PAUSA_MS)
    }
    return encerrar({ ok: false, motivo: 'prazo' })
  } catch (erro) {
    if (erro instanceof ServicoFora) return encerrar({ ok: false, motivo: 'servico-fora' })
    throw erro
  }
}
