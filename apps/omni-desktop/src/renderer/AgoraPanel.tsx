import React, { useEffect, useState } from 'react'
import type { AgoraItem, AgoraView } from '../shared/agora'

const CATEGORIA: Record<AgoraItem['category'], { rotulo: string; cor: string }> = {
  overdue: { rotulo: 'Atrasada', cor: '#e5484d' },
  blocked: { rotulo: 'Bloqueada', cor: '#f5a623' },
  'due-soon': { rotulo: 'Prazo perto', cor: '#f2c744' },
  scheduled: { rotulo: 'Agendada', cor: '#8aa0ff' },
  active: { rotulo: 'Em andamento', cor: '#3fb950' },
  stale: { rotulo: 'Parada', cor: '#8b8b8b' }
}

function Item({ item }: { item: AgoraItem }) {
  const c = CATEGORIA[item.category]
  return (
    <div className="agora-item">
      <span className="agora-tag" style={{ background: c.cor }}>{c.rotulo}</span>
      <div className="agora-item-corpo">
        <div className="agora-objetivo">{item.objective}</div>
        <div className="agora-motivo">{item.reason}</div>
        {item.nextAction ? <div className="agora-proxima">Próxima ação: {item.nextAction}</div> : null}
      </div>
    </div>
  )
}

export function AgoraPanel({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<AgoraView | null>(null)
  const [erro, setErro] = useState(false)
  useEffect(() => {
    let vivo = true
    window.omni.agoraView().then(v => { if (vivo) setView(v) }).catch(() => { if (vivo) setErro(true) })
    return () => { vivo = false }
  }, [])

  return (
    <div className="agora-overlay" onClick={onClose}>
      <div className="agora-painel" onClick={e => e.stopPropagation()}>
        <header className="agora-cabecalho">
          <h2>Agora</h2>
          <button className="agora-fechar" onClick={onClose} aria-label="Fechar">×</button>
        </header>
        {erro ? <p className="agora-vazio">Não consegui ler as missões agora.</p>
          : !view ? <p className="agora-vazio">Carregando…</p>
          : view.items.length === 0 ? <p className="agora-vazio">Nada exige sua atenção agora. Respira. ☕</p>
          : (
            <>
              <p className="agora-resumo">
                {view.counts.overdue > 0 ? `${view.counts.overdue} atrasada(s) · ` : ''}
                {view.counts.blocked > 0 ? `${view.counts.blocked} bloqueada(s) · ` : ''}
                {view.counts['due-soon'] > 0 ? `${view.counts['due-soon']} com prazo perto · ` : ''}
                {view.counts.total} no total
              </p>
              <div className="agora-lista">{view.items.map(item => <Item key={item.missionId} item={item} />)}</div>
            </>
          )}
      </div>
    </div>
  )
}
