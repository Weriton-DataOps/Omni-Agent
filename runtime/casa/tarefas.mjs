// Os puros das tarefas dos agentes (F2, plano 5c): o nome no agendador do Windows, as variáveis que o
// lançador põe no roteiro e a linha de comando do claude que roda o roteiro. Sem disco, cofre nem processo.

export class ErroDeTarefa extends Error {
  constructor(codigo, mensagem) {
    super(mensagem)
    this.name = 'ErroDeTarefa'
    this.codigo = codigo
  }
}

// As mesmas ferramentas da visita velha (o .ps1 aposentado no plano 5c): trabalha no Actions, nunca
// publica, nunca entra em servidor.
const LIBERADAS = ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash', 'PowerShell', 'WebSearch', 'WebFetch']
const BARRADAS = ['Bash(git push:*)', 'Bash(gh:*)', 'Bash(ssh:*)', 'Bash(scp:*)', 'Bash(npm publish:*)', 'Bash(vercel:*)', 'Bash(pm2:*)']

const dois = (n) => String(n).padStart(2, '0')

export const nomeDaTarefa = (prefixo, agente, id) => `${prefixo} - ${agente} - ${id}`

export const variavelDoAgente = (agente) => agente.toUpperCase().replaceAll('-', '_')

export const idDaVisita = (d) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}-${dois(d.getHours())}${dois(d.getMinutes())}`

export const hojeBr = (d) => `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}`

// Uma passada só: o valor posto não é relido, então um motivo que traga {{OMNI}} chega literal.
export function preencherRoteiro(texto, variaveis, valores) {
  const declaradas = new Set(variaveis)
  for (const nome of declaradas) {
    if (typeof valores[nome] !== 'string' || valores[nome] === '') throw new ErroDeTarefa('variavel-sem-valor', `a variável ${nome} do roteiro ficou sem valor`)
  }
  return texto.replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, (inteiro, nome) => (declaradas.has(nome) ? valores[nome] : inteiro))
}

export function argumentosDoClaude(pastas) {
  return ['-p', '--output-format', 'json', '--allowedTools', ...LIBERADAS, '--disallowedTools', ...BARRADAS, ...pastas.flatMap((p) => ['--add-dir', p])]
}
