// Omni — as chaves com escopo do serviço WhatsApp e as provas de cada uma, pelos dois lados.
//   leitura   : papel viewer, presa às duas sessões (pessoal e bot). A API recusa envio a viewer.
//   envio     : papel operator, presa à sessão do BOT e à conversa com o dono.
//   terceiros : papel operator, presa à sessão do BOT, qualquer conversa (envio a terceiros com
//               autorização pontual do Weriton, em terceiros.mjs). Também não alcança a sessão pessoal.
// "Pessoal só leitura" é o resumo destas provas: nenhuma chave do Omni envia pela sessão pessoal.
// Nada aqui imprime chave nem número inteiro. Quem chama: chaves.mjs (CLI) e parear.mjs --papel fechar.
//
// api(metodo, caminho, corpo?, chave?) → { status, j }   (sem chave = admin)
// segredos: { gravar(nome, valor), ler(nome) }           nomes: { leitura, envio, terceiros } do cofre

// Recusa pode vir como 401 (chave não vale para aquela sessão) ou 403 (vale, sem permissão): ambas bastam.
const RECUSA = [401, 403]
const ANTIGAS = ['omni-mcp', 'omni-leitura', 'omni-envio-proprio', 'omni-envio-dono']

class FalhaCriar extends Error {}

const passou = (status, esperado) => (Array.isArray(esperado) ? esperado.includes(status) : status === esperado)
const mascararFone = (f) => { const d = String(f ?? '').replace(/\D/g, ''); return d ? `…${d.slice(-4)}` : '?' }

export function resumoSoLeitura(provas) {
  const recusas = provas.filter((p) => Array.isArray(p.esperado) && p.ok).length
  const falhas = provas.filter((p) => !p.ok).map((p) => p.rotulo)
  return { ok: provas.length > 0 && falhas.length === 0, recusas, falhas }
}

export async function provisionarChaves({ api, pessoal, bot, dono, segredos, nomes, log = () => {}, so = 'todas' }) {
  const provas = []
  const provar = (rotulo, status, esperado) => {
    const ok = passou(status, esperado)
    provas.push({ rotulo, status, esperado, ok })
    log(`${rotulo.padEnd(38)} HTTP ${status} ${ok ? (Array.isArray(esperado) ? '✔ recusado' : '✔') : '✘ esperado ' + esperado}`)
  }
  const criar = async (corpo) => {
    const r = await api('POST', '/api/auth/api-keys', corpo)
    if (r.status >= 300 || !r.j?.apiKey) throw new FalhaCriar(`criar ${corpo.name}: HTTP ${r.status}`)
    return r.j
  }
  const revogar = async (alvos) => {
    const { j } = await api('GET', '/api/auth/api-keys')
    for (const k of (Array.isArray(j) ? j : j?.items || []).filter((k) => alvos.includes(k.name) && k.isActive !== false)) {
      log(`revogada: ${k.name} (${k.role}) → HTTP ${(await api('POST', `/api/auth/api-keys/${k.id}/revoke`)).status}`)
    }
  }
  const mensagens = (sessao) => `/api/sessions/${sessao}/messages?limit=1`
  const enviar = (sessao) => `/api/sessions/${sessao}/messages/send-text`

  async function terceiros() {
    await revogar(['omni-envio-terceiros'])
    const t = await criar({ name: 'omni-envio-terceiros', role: 'operator', allowedSessions: [bot] })
    segredos.gravar(nomes.terceiros, t.apiKey)
    log(`criada no cofre: omni-envio-terceiros papel=${t.role} sessões=bot conversas=todas`)
    const kt = segredos.ler(nomes.terceiros)
    provar('[terceiros lê a sessão do bot]', (await api('GET', mensagens(bot), null, kt)).status, 200)
    provar('[terceiros envia pela sessão pessoal]', (await api('POST', enviar(pessoal), { chatId: dono, text: 'isto não deveria sair (terceiros na sessão pessoal)' }, kt)).status, RECUSA)
    provar('[terceiros lê a sessão pessoal]', (await api('GET', mensagens(pessoal), null, kt)).status, RECUSA)
  }

  try {
    for (const [nome, id] of [['pessoal', pessoal], ['bot', bot]]) {
      const { j } = await api('GET', `/api/sessions/${id}`)
      if (j?.status !== 'ready') return { ok: false, motivo: `sessão ${nome} não está pronta (${j?.status ?? '?'})`, provas }
      log(`sessão ${nome}: ready · ${mascararFone(j.phone)}`)
    }

    if (so === 'terceiros') {
      await terceiros()
      return { ok: provas.every((p) => p.ok), provas }
    }

    await revogar(ANTIGAS)
    const leitura = await criar({ name: 'omni-leitura', role: 'viewer', allowedSessions: [pessoal, bot] })
    const envio = await criar({ name: 'omni-envio-dono', role: 'operator', allowedSessions: [bot], allowedChats: [dono] })
    segredos.gravar(nomes.leitura, leitura.apiKey)
    segredos.gravar(nomes.envio, envio.apiKey)
    log(`criada no cofre: omni-leitura papel=${leitura.role} sessões=2`)
    log(`criada no cofre: omni-envio-dono papel=${envio.role} sessões=bot conversas=dono`)

    // Provas com as chaves lidas de volta do cofre: prova o que ficou guardado, não o que veio na resposta.
    const k = { leitura: segredos.ler(nomes.leitura), envio: segredos.ler(nomes.envio) }
    provar('[leitura lê a sessão pessoal]', (await api('GET', mensagens(pessoal), null, k.leitura)).status, 200)
    provar('[leitura lê a sessão do bot]', (await api('GET', mensagens(bot), null, k.leitura)).status, 200)
    provar('[leitura tenta enviar]', (await api('POST', enviar(bot), { chatId: dono, text: 'isto não deveria sair (chave de leitura)' }, k.leitura)).status, RECUSA)
    provar('[envio: bot → dono]', (await api('POST', enviar(bot), { chatId: dono, text: '🔐 Omni: este é o número do bot. É por aqui que a gente conversa.' }, k.envio)).status, 201)
    provar('[envio: bot → outro destino]', (await api('POST', enviar(bot), { chatId: '0@c.us', text: 'isto não deveria sair (fora do escopo)' }, k.envio)).status, RECUSA)
    provar('[envio pela sessão pessoal]', (await api('POST', enviar(pessoal), { chatId: dono, text: 'isto não deveria sair (sessão pessoal)' }, k.envio)).status, RECUSA)
    await terceiros()
    return { ok: provas.every((p) => p.ok), provas }
  } catch (erro) {
    if (erro instanceof FalhaCriar) return { ok: false, motivo: erro.message, provas }
    throw erro
  }
}
