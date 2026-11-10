// O carteiro (F2, plano 4a, §3.5): a fila de execuções mora no agente (o Oráculo, no E3); o Omni tira
// dela, escolhe a sessão do VS Code, assume (o agente devolve 409 se outra mão levou), grava o pedido e
// entrega por um `claude -p` de vida curta. Tudo pelo `chamar`, com o token de visita. Cada execução
// termina num recibo (assumido, recusado ou falhou) que vira a linha do despacho no omni.db.
import { rotaDeclarada } from './chamar-agente.mjs'
import { escolherDestino, montarPedido } from './pedido-execucao.mjs'

const AMOSTRA_ASSUMIR = '/v1/actions/execucoes/20261109-120000-abcd/assumir'
const VISITA = { papel: 'visita' }

export function temFila(rotas) {
  return rotaDeclarada(rotas, 'POST', AMOSTRA_ASSUMIR)?.escopo === 'visita'
}

const erroDe = (r) => r?.corpo?.erro || `status ${r?.status}`

export function criarCarteiro({
  chamar, agentes, sessoes, entregar, gravarPedido, marcar, maos,
  pastaActions = '', pastaOmni = '', log = () => {}, intervaloMs = 60_000
}) {
  const corridas = new Map() // agente -> { promessa, repetir }
  let parado = false
  let timer = null

  async function estado(agente, id, corpo) {
    const r = await chamar(agente, 'POST', `/v1/actions/execucoes/${id}/estado`, corpo, VISITA)
    if (r.status !== 200) log(`${agente}/${id}: o estado ${corpo.estado} não foi gravado (${erroDe(r)})`)
  }

  async function despachar(agente, id, mesa) {
    const lida = await chamar(agente, 'GET', `/v1/actions/execucoes/${id}`, undefined, VISITA)
    if (lida.status !== 200) return { estado: 'falhou', detalhe: `leitura: ${erroDe(lida)}` }
    const ex = lida.corpo
    if (ex.estado !== 'na fila') return { estado: 'recusado', detalhe: `fora da fila (${ex.estado})` }

    const projeto = ex.projeto ? mesa.projetos.find((p) => String(p?.nome).toLowerCase() === ex.projeto.toLowerCase()) ?? null : null
    let ponto = null
    if (ex.slug) {
      const r = await chamar(agente, 'GET', `/v1/actions/pontos/${ex.slug}`, undefined, VISITA)
      if (r.status === 200) ponto = r.corpo
    }
    const resposta = ex.destino ? (ex.eventos?.at(-1)?.resposta || '') : ''
    const vivas = sessoes()
    const mesma = ex.destino && vivas.find((s) => s.nome === ex.destino.nome)
    const destino = mesma
      ? { ...mesma, motivo: 'a mesma sessão que já está no trabalho' }
      : escolherDestino(vivas, { pastaProjeto: projeto?.pasta || '', pastaActions: mesa.raiz, pastaOmni })
    if (!destino) {
      const onde = projeto?.pasta || mesa.raiz
      await estado(agente, id, { estado: 'sem sessão', nota: `nenhuma sessão do VS Code aberta para receber; abra uma em ${onde} e mande de novo` })
      return { estado: 'falhou', detalhe: 'sem sessão' }
    }

    const assumida = await chamar(agente, 'POST', `/v1/actions/execucoes/${id}/assumir`, { sessao: destino.nome }, VISITA)
    if (assumida.status === 409) return { estado: 'recusado', detalhe: erroDe(assumida) }
    if (assumida.status !== 200) return { estado: 'falhou', detalhe: `assumir: ${erroDe(assumida)}` }

    const texto = montarPedido(ex, { projeto, ponto, maos, resposta })
    const arquivo = await gravarPedido(id, texto, ex.eventos?.length ?? 0)
    log(`${agente}/${id}: entregando a ${destino.nome} (${destino.motivo})`)
    const r = await entregar(destino.nome, arquivo)
    if (r.ok) {
      await estado(agente, id, { estado: 'enviada', nota: `entregue a ${destino.nome} (${destino.motivo})`, destino: { nome: destino.nome, cwd: destino.cwd, motivo: destino.motivo } })
      return { estado: 'assumido', detalhe: `entregue a ${destino.nome}` }
    }
    await estado(agente, id, { estado: 'falhou', nota: `a entrega para ${destino.nome} falhou: ${r.motivo}` })
    return { estado: 'falhou', detalhe: r.motivo }
  }

  async function rodada(agente) {
    const fila = await chamar(agente, 'GET', '/v1/actions/execucoes?estado=pendente', undefined, VISITA)
    if (fila.status !== 200 || !Array.isArray(fila.corpo?.execucoes)) { log(`${agente}: a fila não abriu (${erroDe(fila)})`); return }
    if (fila.corpo.execucoes.length === 0) return
    const m = await chamar(agente, 'GET', '/v1/actions/mesa', undefined, VISITA)
    const mesa = {
      raiz: (m.status === 200 && typeof m.corpo?.raiz === 'string' && m.corpo.raiz) || pastaActions,
      projetos: m.status === 200 && Array.isArray(m.corpo?.projetos) ? m.corpo.projetos : []
    }
    for (const { id } of fila.corpo.execucoes) {
      if (parado) break
      let recibo
      try {
        recibo = await despachar(agente, id, mesa)
      } catch (e) {
        log(`${agente}/${id}: carteiro: ${e.message}`)
        try { await estado(agente, id, { estado: 'falhou', nota: `carteiro: ${e.message}` }) } catch { /* o agente caiu junto */ }
        recibo = { estado: 'falhou', detalhe: `carteiro: ${e.message}` }
      }
      log(`${agente}/${id}: ${recibo.estado} (${recibo.detalhe})`)
      try { await marcar({ agente, execucao: id, ...recibo }) } catch (e) { log(`${agente}/${id}: recibo não gravado (${e.message})`) }
    }
  }

  function tocar(agente) {
    if (parado) return Promise.resolve()
    if (!agentes().includes(agente)) { log(`toque de ${agente} ignorado: não é agente com fila`); return Promise.resolve() }
    const atual = corridas.get(agente)
    if (atual) { atual.repetir = true; return atual.promessa }
    const corrida = { repetir: false, promessa: null }
    corrida.promessa = (async () => {
      try {
        do {
          corrida.repetir = false
          try { await rodada(agente) } catch (e) { log(`${agente}: rodada caiu (${e.message})`) }
        } while (corrida.repetir && !parado)
      } finally {
        corridas.delete(agente)
      }
    })()
    corridas.set(agente, corrida)
    return corrida.promessa
  }

  const varrer = () => Promise.all(agentes().map((a) => tocar(a)))

  return {
    tocar,
    agentes,
    iniciar() {
      if (parado || timer) return
      varrer()
      timer = setInterval(varrer, intervaloMs)
      timer.unref?.()
    },
    async parar() {
      parado = true
      if (timer) { clearInterval(timer); timer = null }
      await Promise.all([...corridas.values()].map((c) => c.promessa))
    }
  }
}
