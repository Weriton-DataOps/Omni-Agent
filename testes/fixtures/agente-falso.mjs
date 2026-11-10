// Agente falso de verdade: grava em recebido.json o argv e o stdin, ou sai com FALSO_SAIR (para simular
// um agente que recusa o instalar). Usado pelo executor-instalar e pelo omni-instalar.ps1.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const FALSO = `import { readFileSync, writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
if (process.env.FALSO_SAIR) { process.stderr.write('recusei'); process.exit(Number(process.env.FALSO_SAIR)) }
const entrada = args.includes('--stdin') ? readFileSync(0, 'utf8') : null
writeFileSync('recebido.json', JSON.stringify({ args, entrada }))
process.stdout.write('{"ok":true}\\n')
`

// O requisito de Node acompanha quem roda o teste: o CI usa Node 22 e o PC usa 24. Fixar ">=24" aqui
// faria o requer recusar o agente no CI antes de qualquer asserção sobre tokens ou núcleo.
export const NODE_ATUAL = `>=${process.versions.node.split('.')[0]}`

export function agenteFalso(t, mudar = (m) => m) {
  const raiz = mkdtempSync(join(tmpdir(), 'omni-agente-falso-'))
  t.after(() => rmSync(raiz, { recursive: true, force: true }))
  mkdirSync(join(raiz, 'executor'))
  writeFileSync(join(raiz, 'executor', 'falso.mjs'), FALSO)
  const manifesto = mudar({
    agente: 'falso', versao: '1.0.0', banco: null, requer: { node: NODE_ATUAL, agentes: ['omni>=0.26'] },
    executor: { comando: 'node executor/falso.mjs', modos: ['instalar', 'servir'] }, tarefas: [], credenciais: []
  })
  writeFileSync(join(raiz, 'executor', 'agente.json'), JSON.stringify(manifesto, null, 2))
  return raiz
}
