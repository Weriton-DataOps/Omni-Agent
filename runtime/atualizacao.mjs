import { spawnSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { compararVersoes, verificarVersao } from './versao.mjs'
import { registrarReadbackInstalado } from './autoaperfeicoamento.mjs'
import { registrarReadbackOperacionalInstalado } from './evolucao.mjs'
import { verificarIntegridadeRelease } from './integridade-release.mjs'

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

export async function lerMudancasAtualizacao(pluginRoot, previousVersion, installedVersion) {
  if (!isAbsolute(pluginRoot ?? '')) throw new Error('A raiz do plugin atualizado precisa ser absoluta.')
  const manifest = JSON.parse(
    await readFile(join(pluginRoot, 'contratos', 'atualizacao', 'releases.json'), 'utf8')
  )
  if (
    manifest?.schemaVersion !== 1 ||
    !Array.isArray(manifest.releases) ||
    manifest.releases.some((release) =>
      typeof release?.version !== 'string' ||
      !Array.isArray(release.changes) ||
      release.changes.length === 0 ||
      release.changes.some((change) => typeof change !== 'string' || change.trim().length < 3)
    )
  ) {
    throw new Error('Registro de mudanças do Omni é inválido.')
  }
  const versions = manifest.releases.map((release) => release.version)
  if (new Set(versions).size !== versions.length) throw new Error('Registro de mudanças possui versão duplicada.')
  return manifest.releases
    .filter((release) =>
      compararVersoes(previousVersion, release.version) < 0 &&
      compararVersoes(release.version, installedVersion) <= 0
    )
    .flatMap((release) => release.changes.map((change) => ({ version: release.version, change: change.trim() })))
}

export function resumirAtualizacaoPublica(update) {
  if (update?.status === 'current') {
    return { status: 'current', message: 'Nenhuma atualização disponível.' }
  }
  const summary = {
    status: update.status,
    transition: `${update.previousInstalledVersion} → ${update.installedVersion}`,
    changes: (update.changes ?? []).map((item) => item.change)
  }
  if (update.reloadRequired) {
    summary.reload = {
      vscode: '/plugin → Restart',
      terminal: '/reload-plugins',
      preservesSession: true
    }
  }
  return summary
}

export async function atualizarPlugin({
  casa,
  pluginRoot = raiz,
  run = executarProcesso,
  resolveCli = localizarClaudeCli,
  checkVersion = verificarVersao,
  readChanges = lerMudancasAtualizacao,
  recordInstalledReadback = registrarReadbackInstalado,
  recordOperationalReadback = registrarReadbackOperacionalInstalado,
  verifyInstalledIntegrity = verificarIntegridadeRelease
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

  const updatedRoot = after.installPath ?? (
    compararVersoes(after.version, loadedVersion) === 0 ? pluginRoot : null
  )
  if (!isAbsolute(updatedRoot ?? '')) {
    throw new Error('Claude informou uma versão instalada, mas não expôs uma raiz verificável para ela.')
  }
  const installedIntegrity = await verifyInstalledIntegrity(updatedRoot)
  if (
    installedIntegrity.status !== 'verified' ||
    installedIntegrity.versionMatchesManifest !== true ||
    installedIntegrity.releaseVersion !== after.version ||
    !/^[a-f0-9]{64}$/.test(installedIntegrity.fingerprint ?? '') ||
    installedIntegrity.declaredFingerprint !== installedIntegrity.fingerprint
  ) {
    throw new Error(`A raiz realmente instalada não comprovou a versão ${after.version} com integridade.`)
  }
  const remote = await checkVersion({ casa, pluginRoot: updatedRoot })
  if (
    remote.latestVersion &&
    compararVersoes(after.version, remote.latestVersion) < 0
  ) {
    throw new Error(
      `Atualização incompleta: instalada ${after.version}, publicada ${remote.latestVersion}.`
    )
  }
  if (['drifted', 'diverged'].includes(remote.status)) {
    throw new Error(
      `Atualização sem paridade de payload: versão ${after.version}, estado ${remote.status}.`
    )
  }
  if (remote.latestVersion && remote.status === 'legacy-unverifiable') {
    throw new Error('Atualização instalada sem fingerprint verificável da release.')
  }
  if (remote.installedVersion && remote.installedVersion !== after.version) {
    throw new Error('A consulta remota leu uma raiz diferente da versão realmente instalada.')
  }
  if (remote.installedFingerprint && remote.installedFingerprint !== installedIntegrity.fingerprint) {
    throw new Error('A consulta remota divergiu do fingerprint da raiz realmente instalada.')
  }
  const readbackInput = {
    pluginRoot: updatedRoot,
    version: after.version,
    payloadFingerprint: installedIntegrity.fingerprint
  }
  const [learningReadback, operationalReadback] = await Promise.all([
    recordInstalledReadback(casa, readbackInput),
    recordOperationalReadback(casa, readbackInput)
  ])

  const changed = compararVersoes(before.version, after.version) !== 0
  const reloadRequired = compararVersoes(loadedVersion, after.version) !== 0
  const changes = changed ? await readChanges(updatedRoot, before.version, after.version) : []
  if (changed && changes.length === 0) {
    throw new Error(`A versão ${after.version} foi instalada sem registrar o que mudou.`)
  }
  return {
    status: changed ? 'updated' : reloadRequired ? 'awaiting-reload' : 'current',
    plugin: PLUGIN_ID,
    repository: REPOSITORIO,
    loadedVersion,
    previousInstalledVersion: before.version,
    installedVersion: after.version,
    latestVersion: remote.latestVersion,
    changes,
    verifiedBy: remote.latestVersion
      ? ['claude-plugin-list', 'installed-root-integrity', 'github-release-contract', 'payload-fingerprint']
      : ['claude-plugin-list', 'installed-root-integrity'],
    learningReadback: {
      verifiedArtifacts: (learningReadback.verified ?? 0) + (operationalReadback.verified ?? 0),
      capabilityArtifacts: learningReadback.verified ?? 0,
      operationalArtifacts: operationalReadback.verified ?? 0
    },
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
