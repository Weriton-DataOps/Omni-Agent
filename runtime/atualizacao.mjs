import { spawnSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { compararVersoes, verificarVersao } from './versao.mjs'

const raiz = dirname(dirname(fileURLToPath(import.meta.url)))
const PLUGIN_ID = 'omni@omni-hub'
const MARKETPLACE = 'omni-hub'
const REPOSITORIO = 'https://github.com/Weriton-DataOps/Omni-Agent'

function normalizarRepositorio(value) {
  return String(value ?? '')
    .trim()
    .replace(/\.git\/?$/i, '')
    .replace(/\/$/, '')
    .toLowerCase()
}

function executarProcesso(executable, args) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error
  }
}

function exigirSucesso(result, etapa) {
  if (result?.status === 0) return result.stdout
  const detail = result?.error?.message || result?.stderr?.trim() || result?.stdout?.trim()
  throw new Error(`${etapa} falhou${detail ? `: ${detail}` : '.'}`)
}

function lerJsonSaida(result, etapa) {
  const raw = exigirSucesso(result, etapa)
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error(`${etapa} retornou JSON inválido.`)
  }
}

function pluginDaLista(list) {
  if (!Array.isArray(list)) throw new Error('A lista de plugins do Claude é inválida.')
  return list.find((item) => item?.id === PLUGIN_ID) ?? null
}

async function candidatosDaExtensao(home = homedir()) {
  if (process.platform !== 'win32') return []
  const bases = ['.vscode', '.vscode-insiders', '.cursor', '.windsurf']
  const candidates = []
  for (const base of bases) {
    const extensions = join(home, base, 'extensions')
    try {
      const entries = await readdir(extensions, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory() && /^anthropic\.claude-code-/i.test(entry.name)) {
          candidates.push(
            join(extensions, entry.name, 'resources', 'native-binary', 'claude.exe')
          )
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  return candidates.sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
}

export async function localizarClaudeCli({ env = process.env, run = executarProcesso } = {}) {
  const candidates = [env.OMNI_CLAUDE_CLI, 'claude', ...(await candidatosDaExtensao())].filter(Boolean)
  for (const candidate of [...new Set(candidates)]) {
    const probe = run(candidate, ['--version'])
    if (probe?.status === 0) return candidate
  }
  throw new Error(
    'Claude Code CLI não encontrado. Instale o CLI ou defina OMNI_CLAUDE_CLI com o caminho do executável.'
  )
}

async function versaoCarregada(pluginRoot) {
  const manifest = JSON.parse(
    await readFile(join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8')
  )
  if (manifest?.name !== 'omni' || typeof manifest.version !== 'string') {
    throw new Error('Manifest carregado do Omni é inválido.')
  }
  return manifest.version
}

export async function atualizarPlugin({
  casa,
  pluginRoot = raiz,
  run = executarProcesso,
  resolveCli = localizarClaudeCli,
  checkVersion = verificarVersao
} = {}) {
  const executable = await resolveCli({ run })
  const loadedVersion = await versaoCarregada(pluginRoot)

  const marketplaces = lerJsonSaida(
    run(executable, ['plugin', 'marketplace', 'list', '--json']),
    'A validação do marketplace'
  )
  const marketplace = Array.isArray(marketplaces)
    ? marketplaces.find((item) => item?.name === MARKETPLACE)
    : null
  if (!marketplace) throw new Error(`Marketplace ${MARKETPLACE} não está instalado.`)
  const source = marketplace.url ?? marketplace.repo
  if (normalizarRepositorio(source) !== normalizarRepositorio(REPOSITORIO)) {
    throw new Error(`Marketplace ${MARKETPLACE} não aponta para o repositório oficial do Omni.`)
  }

  const before = pluginDaLista(
    lerJsonSaida(run(executable, ['plugin', 'list', '--json']), 'A leitura do plugin instalado')
  )
  if (!before) throw new Error(`Plugin ${PLUGIN_ID} não está instalado.`)

  exigirSucesso(
    run(executable, ['plugin', 'marketplace', 'update', MARKETPLACE]),
    'A atualização do marketplace'
  )
  exigirSucesso(
    run(executable, ['plugin', 'update', PLUGIN_ID, '--scope', before.scope ?? 'user', '--yes']),
    'A atualização do plugin'
  )

  const after = pluginDaLista(
    lerJsonSaida(run(executable, ['plugin', 'list', '--json']), 'A validação final do plugin')
  )
  if (!after || typeof after.version !== 'string') {
    throw new Error(`Claude não confirmou a instalação de ${PLUGIN_ID}.`)
  }

  const remote = await checkVersion({ casa, pluginRoot })
  if (
    remote.latestVersion &&
    compararVersoes(after.version, remote.latestVersion) < 0
  ) {
    throw new Error(
      `Atualização incompleta: instalada ${after.version}, publicada ${remote.latestVersion}.`
    )
  }

  const changed = compararVersoes(before.version, after.version) !== 0
  const reloadRequired = compararVersoes(loadedVersion, after.version) !== 0
  return {
    status: changed ? 'updated' : reloadRequired ? 'awaiting-reload' : 'current',
    plugin: PLUGIN_ID,
    repository: REPOSITORIO,
    loadedVersion,
    previousInstalledVersion: before.version,
    installedVersion: after.version,
    latestVersion: remote.latestVersion,
    verifiedBy: remote.latestVersion ? ['claude-plugin-list', 'github-manifest'] : ['claude-plugin-list'],
    reloadRequired,
    applyInstructions: reloadRequired
      ? {
          vscode: { command: '/plugin', action: 'Clique em Restart.' },
          terminal: { command: '/reload-plugins' },
          preservesSession: true
        }
      : null
  }
}
