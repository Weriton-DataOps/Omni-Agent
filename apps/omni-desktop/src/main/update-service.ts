import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { LocalUpdateStatus } from '../shared/contracts'

type Preferences = { autoApply?: boolean; lastApplied?: Sample }
type Sample = { version: string; at: string }
type FileStat = { size: number; mtimeMs: number }
type Dependencies = {
  stat?: (path: string) => Promise<FileStat>;
  readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
  writeFile?: (path: string, data: string, options?: { mode?: number }) => Promise<void>;
  rename?: (oldPath: string, newPath: string) => Promise<void>;
  mkdir?: (path: string, options: { recursive: true }) => Promise<void>;
  now?: () => Date;
}

const versionLabel = (at: string) => new Date(at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
const unavailable = 'Build local indisponível para conferência.'

/** Watches compiled assets already on disk. It never downloads an update. */
export class LocalUpdateService {
  private current?: Sample
  private candidate?: Sample
  private stableCandidate?: string
  private autoApply = false
  private lastApplied?: Sample
  private checkedAt = new Date(0).toISOString()
  private applying = false
  private blockedDetail = ''
  private lastError = ''
  constructor(private assets: string[], private preferencesPath: string, private dependencies: Dependencies = {}) {}
  private get now() { return this.dependencies.now || (() => new Date()) }
  private async fingerprint(): Promise<Sample> {
    const statFile = this.dependencies.stat || stat
    const files = await Promise.all(this.assets.map(async path => ({ path, ...(await statFile(path)) })))
    const raw = files.sort((a, b) => a.path.localeCompare(b.path)).map(file => `${file.path}:${file.size}:${Math.floor(file.mtimeMs)}`).join('|')
    const newest = Math.max(...files.map(file => file.mtimeMs))
    return { version: createHash('sha256').update(raw).digest('hex').slice(0, 12), at: new Date(newest).toISOString() }
  }
  private status(): LocalUpdateStatus {
    const current = this.current
    if (!current) return { state: 'current', currentVersion: 'indisponível', autoApply: this.autoApply, checkedAt: this.checkedAt, detail: this.lastError || unavailable }
    const available = this.candidate?.version !== current.version ? this.candidate : undefined
    const state: LocalUpdateStatus['state'] = this.applying ? 'applying' : this.blockedDetail ? 'blocked' : available ? 'available' : 'current'
    const applied = this.lastApplied?.version === current.version ? this.lastApplied : undefined
    return { state, currentVersion: versionLabel(current.at), ...(available ? { availableVersion: versionLabel(available.at) } : {}), ...(applied ? { lastAppliedAt: applied.at } : {}), autoApply: this.autoApply, checkedAt: this.checkedAt, detail: this.applying ? 'Reabrindo o Omni com a build local nova…' : this.blockedDetail || (available ? 'Uma build local nova está pronta para ser aplicada.' : applied ? 'A nova build foi aplicada e esta janela já foi reaberta nela.' : this.lastError || 'Esta é a build local em uso.') }
  }
  private async savePreferences() {
    const makeDir = this.dependencies.mkdir || mkdir, save = this.dependencies.writeFile || writeFile, move = this.dependencies.rename || rename
    await makeDir(dirname(this.preferencesPath), { recursive: true })
    const temporary = `${this.preferencesPath}.${randomUUID()}.tmp`
    await save(temporary, JSON.stringify({ autoApply: this.autoApply, ...(this.lastApplied ? { lastApplied: this.lastApplied } : {}) }), { mode: 0o600 })
    await move(temporary, this.preferencesPath)
  }
  async initialize() {
    const load = this.dependencies.readFile || readFile
    try {
      const preferences = JSON.parse(await load(this.preferencesPath, 'utf8')) as Preferences
      this.autoApply = preferences.autoApply === true
      if (typeof preferences.lastApplied?.version === 'string' && typeof preferences.lastApplied.at === 'string') this.lastApplied = preferences.lastApplied
    } catch { /* First use starts manual. */ }
    try { this.current = await this.fingerprint(); this.lastError = '' } catch { this.lastError = unavailable }
    this.checkedAt = this.now().toISOString()
    return this.status()
  }
  async check() {
    this.checkedAt = this.now().toISOString()
    try {
      const sample = await this.fingerprint(); this.lastError = ''
      if (!this.current) { this.current = sample; this.candidate = undefined; this.stableCandidate = undefined; this.blockedDetail = ''; return this.status() }
      if (sample.version === this.current.version) { this.candidate = undefined; this.stableCandidate = undefined; this.blockedDetail = ''; return this.status() }
      if (this.stableCandidate !== sample.version) { this.stableCandidate = sample.version; this.candidate = undefined; return this.status() }
      this.candidate = sample
    } catch { this.lastError = unavailable }
    return this.status()
  }
  async setAutoApply(enabled: boolean) { this.autoApply = enabled; await this.savePreferences(); return this.status() }
  async recordApplying() {
    if (!this.candidate) throw new Error('Não há uma atualização local pronta para registrar.')
    this.lastApplied = { version: this.candidate.version, at: this.now().toISOString() }
    await this.savePreferences()
  }
  canApply() { return Boolean(this.candidate) && !this.applying }
  markBlocked(detail: string) { this.blockedDetail = detail; return this.status() }
  clearBlocked() { this.blockedDetail = ''; return this.status() }
  markApplying() { if (!this.canApply()) throw new Error('Não há uma atualização local pronta para aplicar.'); this.applying = true; return this.status() }
}
