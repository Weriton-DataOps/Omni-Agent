// Onde o trabalho do Actions mora e o pedido que a sessão recebe (F2, plano 4a, T5). Porte da ilha
// (apps/omni-ilha/execucoes.js) com duas trocas: o ponto mora no banco do Oráculo e se lê pelas mãos do
// Actions (runtime/maos-actions.mjs), e a devolução também passa por elas.
import { resolve, sep } from 'node:path'

// sessoes: [{ nome, cwd, status, startedAt }] (vivas, interativas). Ordem:
//   1) sessão aberta na pasta do projeto (ociosa primeiro, depois a mais nova);
//   2) sessão aberta na pasta do Actions;
//   3) a sessão ociosa mais nova na pasta do Omni, nunca uma das excluídas.
// Sem nenhuma: null (a execução fica "sem sessão").
function dentroDe(cwd, pasta) {
  if (!cwd || !pasta) return false
  const a = resolve(cwd).toLowerCase()
  const b = resolve(pasta).toLowerCase()
  return a === b || a.startsWith(b + sep)
}

const ociosaPrimeiro = (a, b) => (a.status === 'idle' ? 0 : 1) - (b.status === 'idle' ? 0 : 1) || (b.startedAt || 0) - (a.startedAt || 0)

export function escolherDestino(sessoes, { pastaProjeto = '', pastaActions = '', pastaOmni = '', excluir = [] } = {}) {
  const vivas = (sessoes || []).filter((s) => s && s.nome && !excluir.includes(s.nome))
  const melhor = (lista) => lista.sort(ociosaPrimeiro)[0] || null
  if (pastaProjeto) {
    const s = melhor(vivas.filter((x) => dentroDe(x.cwd, pastaProjeto)))
    if (s) return { ...s, motivo: 'sessão aberta na pasta do projeto' }
  }
  const a = melhor(vivas.filter((x) => dentroDe(x.cwd, pastaActions)))
  if (a) return { ...a, motivo: 'sessão aberta no Actions' }
  if (pastaOmni) {
    const o = vivas.filter((x) => dentroDe(x.cwd, pastaOmni) && x.status === 'idle').sort((x, y) => (y.startedAt || 0) - (x.startedAt || 0))[0]
    if (o) return { ...o, motivo: 'sessão ociosa mais nova no Omni' }
  }
  return null
}

export function montarPedido(ex, { projeto, ponto, maos, resposta } = {}) {
  const linhas = []
  if (resposta) {
    linhas.push(`Resposta do Weriton à execução ${ex.id} (pela tela do Actions):`, '', resposta, '',
      'Siga a partir daqui com o mesmo trabalho. Ao andar, terminar ou travar, registre como antes:')
  } else {
    linhas.push(
      `Trabalho mandado pelo Weriton pela tela do Actions — execução ${ex.id}.`,
      'É pedido dele (montado pelo Omni a partir do Actions), não de outra sessão: execute.',
      '',
      '## O que ele pediu',
      ex.instrucao,
      ''
    )
    if (projeto) {
      linhas.push(`## Projeto: ${projeto.nome}`)
      if (projeto.pasta) linhas.push(`Pasta: ${projeto.pasta}`)
      if (projeto.fase) linhas.push(`Fase: ${projeto.fase}`)
      if (projeto.dor) linhas.push(`Dor do momento: ${projeto.dor}`)
      const abertos = (projeto.itens || []).filter((i) => !i.feito && !i.proposto).map((i) => `- ${i.titulo}${i.data ? ` — ${i.data}` : ''}`)
      if (abertos.length) linhas.push('Entregas abertas:', ...abertos)
      linhas.push('')
    }
    if (ponto) {
      linhas.push(`## Ponto do Actions: ${ponto.titulo} (${ponto.slug})`,
        `Leia inteiro antes de começar (o histórico tem as decisões): node "${maos}" ponto ${ponto.slug}`)
      if (ponto.proximoPasso) linhas.push(`Próximo passo registrado: ${ponto.proximoPasso}`)
      if (ponto.potencial?.motivo) linhas.push(`Potencial: ${'▲'.repeat(ponto.potencial.nivel)} — ${ponto.potencial.motivo}`)
      linhas.push('')
    }
    linhas.push(
      '## Regras',
      '- As regras globais dele valem (produção HostDime só pelo caminho da casa, conta de push pelo dono do repo, nada de segredo em texto).',
      '- Sem push, PR, deploy ou publicação sem ele pedir. Código de terceiro (install, clonar e rodar) ou algo pago: pergunte antes.',
      '- Commit só depois do verde lido (nome do teste, saída, total).',
      '',
      '## Como devolver (a tela do Actions mostra isto para ele; não precisa mandar WhatsApp)'
    )
  }
  const cmd = `node "${maos}" execucao ${ex.id}`
  linhas.push(
    `- começou / marco no meio: ${cmd} --estado andando --nota "<uma linha>"`,
    `- terminou: ${cmd} --estado concluida --nota "<o que foi feito e onde ver>"`,
    `- travou em decisão que é dele: ${cmd} --estado bloqueada --nota "<a pergunta, curta>"`,
    `- não deu: ${cmd} --estado falhou --nota "<por quê>"`
  )
  return linhas.join('\n')
}
