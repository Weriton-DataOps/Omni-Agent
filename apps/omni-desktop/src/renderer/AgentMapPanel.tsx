import React, { useEffect, useRef, useState } from 'react'
import type { AgentMap, AgentNode, AgentState } from '../shared/contracts'
import { MessageText } from './MessageText'
import './agent-map.css'

const labels: Record<AgentState, string> = { running: 'Em execução', waiting: 'Aguardando', completed: 'Resposta pronta', failed: 'Falhou', interrupted: 'Interrompido', unknown: 'Estado não confirmado' }
const duration = (node: AgentNode, clock: number) => {
  const ms = node.durationMs ?? (node.startedAt && (node.endedAt || node.state === 'running') ? (node.endedAt ? Date.parse(node.endedAt) : clock) - Date.parse(node.startedAt) : undefined)
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return undefined
  const seconds = Math.floor(ms / 1000)
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
export function AgentMapPanel({ map, onClose }: { map: AgentMap; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [selected, setSelected] = useState(map.rootId), [clock, setClock] = useState(Date.now())
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => { clearInterval(timer); dialog.current?.close(); previous?.focus() }
  }, [])
  const node = map.nodes.find(n => n.id === selected) || map.nodes.find(n => n.id === map.rootId)!
  const renderBranch = (id: string, ancestors: string[] = []): React.ReactNode => {
    const item = map.nodes.find(n => n.id === id)
    if (!item || ancestors.includes(id)) return null
    const children = map.nodes.filter(n => n.parentId === id)
    return <li key={id}><button className={'agent-node ' + item.state + (node.id === id ? ' selected' : '')} aria-pressed={node.id === id} onClick={() => setSelected(id)}>
      <span className={'agent-node-dot ' + item.state} aria-hidden="true" /><strong>{item.title}</strong>
      <span className="agent-node-status">{item.progress === 'Sessão ociosa' && item.state !== 'running' ? 'Sessão ociosa' : labels[item.state]}</span>
      <small>{[duration(item, clock), item.tokens !== undefined ? `${new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(item.tokens)} tokens${item.tokenScope === 'last-call' ? ' · última chamada' : ' informados'}` : undefined].filter(Boolean).join(' · ')}</small>
    </button>{children.length > 0 && <ul>{children.map(child => renderBranch(child.id, [...ancestors, id]))}</ul>}</li>
  }
  return <dialog ref={dialog} className="agent-map-panel" aria-labelledby="agent-map-title" onCancel={event => { event.preventDefault(); onClose() }} onKeyDown={event => event.stopPropagation()} onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose() } }}>
    <header><div><h2 id="agent-map-title">Mapa de agentes</h2><p>{map.nodes.length - 1} subagente(s) · {map.nodes.filter(n => n.parentId && n.state === 'running').length} em execução</p></div><button autoFocus aria-label="Fechar mapa de agentes" onClick={onClose}>×</button></header>
    <p className="agent-map-notice">Somente consulta. A sessão principal consolida os resultados; abrir este mapa não envia comandos nem libera o resumo do card.</p>
    <div className="agent-map-tree" aria-label="Relação entre agentes"><ul>{renderBranch(map.rootId)}</ul></div>
    <section className="agent-map-details" aria-label="Detalhes do agente"><h3>{node.title}</h3><p>{labels[node.state]}{node.model ? ` · ${node.model}` : ''}</p>
      {node.progress && <p>{node.progress}</p>}
      <dl>{node.startedAt && <><dt>Início</dt><dd>{new Date(node.startedAt).toLocaleString('pt-BR')}</dd></>}{node.lastActivityAt && <><dt>Último evento</dt><dd>{new Date(node.lastActivityAt).toLocaleString('pt-BR')}</dd></>}{node.tokens !== undefined && <><dt>Tokens registrados</dt><dd>{node.tokens.toLocaleString('pt-BR')} · {node.tokenScope === 'last-call' ? 'última chamada: entrada, cache e saída, sem somar o contexto repetido das rodadas anteriores' : 'total informado pelo executor'}; não é valor de cobrança</dd></>}{node.evidenceId && <><dt>Evidência</dt><dd>{node.evidenceId}</dd></>}</dl>
      {node.objective && <><h4>Objetivo recebido</h4><MessageText text={node.objective} /></>}
      {node.result ? <><h4>Resposta do agente</h4><MessageText text={node.result} /><p className="agent-map-notice">Resposta registrada do executor; não equivale a verificação independente nem à conclusão de todo o pedido.</p></> : <p className="agent-map-notice">Sem resposta final disponível neste nó. Raciocínio interno e saídas brutas de ferramentas não são exibidos.</p>}
    </section>
  </dialog>
}
