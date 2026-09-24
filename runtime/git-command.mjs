// Audit classification only: this parser never grants tool permissions.
// Unsupported shell syntax remains opaque rather than becoming read evidence.
function tokens(source) {
  const result = []
  let value = '', quote = null, active = false
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (quote) {
      if (c === quote) quote = null
      else value += c
      continue
    }
    if (c === '"' || c === "'") { quote = c; active = true; continue }
    if (c === '#' && !active) break
    if (';&|<>\n\r'.includes(c)) return null
    if (/\s/.test(c)) {
      if (active) result.push(value)
      value = ''; active = false
    } else { value += c; active = true }
  }
  if (quote) return null
  if (active) result.push(value)
  return result
}

export function analisarComandoGit(command) {
  const parts = tokens(String(command ?? ''))
  if (!parts) return null
  let i = 0
  const targets = []
  let opaque = false
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(parts[i] ?? '')) {
    const [key, ...rest] = parts[i++].split('=')
    const value = rest.join('=')
    if (!['GIT_DIR', 'GIT_WORK_TREE', 'GIT_OPTIONAL_LOCKS'].includes(key)) opaque = true
    if (['GIT_DIR', 'GIT_WORK_TREE'].includes(key)) targets.push(value)
  }
  if (!/^git(?:\.exe)?$/i.test(parts[i++] ?? '')) return null
  if (parts.some(token => /[$`]/.test(token))) opaque = true
  for (; i < parts.length; i++) {
    const option = parts[i]
    if (!option.startsWith('-')) break
    if (['--no-pager', '--no-optional-locks', '--bare'].includes(option)) continue
    if (['-C', '--git-dir', '--work-tree', '-c'].includes(option)) {
      const value = parts[++i]
      if (!value || value.startsWith('-')) return { effect: 'execution', subcommand: null, targets: [] }
      if (option === '-c') {
        if (!/^(?:core\.(?:quotepath|preloadindex|fscache)|color\.ui|safe\.directory)=/i.test(value)) opaque = true
      } else targets.push(value)
      continue
    }
    const path = option.match(/^--(?:git-dir|work-tree)=(.+)$/)
    if (path) { targets.push(path[1]); continue }
    return { effect: 'execution', subcommand: null, targets: [] }
  }
  const subcommand = parts[i++] ?? null
  const args = parts.slice(i)
  let effect = 'execution'
  const writes = new Set(['add', 'apply', 'am', 'commit', 'push', 'pull', 'fetch', 'clone', 'checkout',
    'switch', 'restore', 'reset', 'merge', 'rebase', 'cherry-pick', 'revert', 'clean', 'gc', 'init', 'update-ref'])
  if (writes.has(subcommand)) effect = 'mutation'
  else if (['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'ls-tree', 'show-ref', 'rev-list'].includes(subcommand)) effect = 'verification'
  else if (subcommand === 'branch' || subcommand === 'tag') {
    effect = args.length === 0 || args.every(arg => /^(?:--list|--show-current|--all|--remotes|-a|-r|-v|-vv|-l)$/.test(arg))
      ? 'verification' : 'mutation'
  }
  if (args.some(arg => /^--output(?:=|$)/.test(arg))) effect = 'mutation'
  if (effect === 'verification' && (opaque || args.some(arg => ['--ext-diff', '--textconv'].includes(arg)))) effect = 'execution'
  // A configuration override can invoke external commands, never prove a read.
  return { effect, subcommand, targets: targets.filter(path => !/[$`]/.test(path)) }
}
