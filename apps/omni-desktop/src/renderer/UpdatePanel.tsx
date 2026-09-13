import React, { useState } from 'react'
import type { LocalUpdateStatus } from '../shared/contracts'

export function UpdatePanel({ status, onClose, onCheck, onAuto, onApply }: {
  status: LocalUpdateStatus
  onClose: () => void
  onCheck: () => Promise<void>
  onAuto: (enabled: boolean) => Promise<void>
  onApply: () => Promise<void>
}) {
  const [working, setWorking] = useState<'check' | 'auto' | 'apply' | ''>('')
  const [error, setError] = useState('')
  const run = async (kind: typeof working, action: () => Promise<void>) => {
    setWorking(kind); setError('')
    try { await action() } catch (reason) { setError((reason as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')) } finally { setWorking('') }
  }
  const canApply = status.state === 'available' || status.state === 'blocked'
  const label = status.state === 'available' ? 'Build nova pronta' : status.state === 'blocked' ? 'Build pronta · aguardando' : status.state === 'applying' ? 'Atualizando agora' : 'Tudo em dia'
  return <section className="update-settings" role="dialog" aria-modal="true" aria-label="Atualização do Omni">
    <div className="update-settings__top"><span>Omni <b>/</b> ATUALIZAÇÃO LOCAL</span><button onClick={onClose} aria-label="Fechar atualização do Omni">×</button></div>
    <h2>Atualizar o Omni.</h2>
    <p>Eu observo apenas a build local já criada por você. Não baixo pacotes nem envio código ou conversas para fora.</p>
    <div className={'update-status ' + status.state} aria-live="polite"><i aria-hidden="true" /><div><strong>{label}</strong><p>{status.detail}</p><small>Em uso: {status.currentVersion}{status.availableVersion ? ` · nova: ${status.availableVersion}` : ''}{status.lastAppliedAt ? ` · aplicada: ${new Date(status.lastAppliedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : ''}</small></div></div>
    {error && <p className="update-problem" role="alert">{error}</p>}
    <label className="update-auto"><input type="checkbox" checked={status.autoApply} disabled={working === 'auto' || working === 'apply'} onChange={event => void run('auto', () => onAuto(event.target.checked))} /><span>Aplicar automaticamente quando o Omni estiver livre</span><small>Nunca interrompe uma resposta, encaminhamento ou entrega em andamento.</small></label>
    <div className="update-actions"><button type="button" onClick={() => void run('check', onCheck)} disabled={Boolean(working)}>Conferir agora</button>{canApply && <button type="button" className="update-primary" onClick={() => void run('apply', onApply)} disabled={Boolean(working)}>{working === 'apply' ? 'Aplicando…' : 'Atualizar agora'}</button>}</div>
  </section>
}
