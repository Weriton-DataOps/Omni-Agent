// Repo git de mentira com o payload do Omni selado: a impressão digital do integridade.json é calculada
// sobre a própria cópia, então o `executor.mjs release` dela sai 0 mesmo num ramo que ainda não fez bump.
// Leva também os arquivos da ilha e do WhatsApp que o omni-instalar.ps1 usa (sem node_modules).
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { calcularFingerprintPayload } from '../../runtime/integridade-release.mjs'

const RAIZ = resolve(import.meta.dirname, '..', '..')
const PASTAS = ['.claude-plugin', 'adaptadores', 'contratos', 'dist', 'executor', 'hooks', 'runtime', 'scripts', 'skills']
const AVULSOS = [
  'package.json',
  'apps/omni-ilha/package.json',
  'apps/omni-ilha/iniciar.ps1',
  'servicos/whatsapp/package.json',
  'servicos/whatsapp/omni/iniciar.ps1',
  'servicos/whatsapp/omni/vigia-servico.vbs',
  'servicos/whatsapp/omni/vigia-servico.mjs',
  'servicos/whatsapp/omni/cofre.ps1'
]

export async function selar(raiz) {
  const contrato = join(raiz, 'contratos', 'atualizacao', 'integridade.json')
  const json = JSON.parse(readFileSync(contrato, 'utf8'))
  json.identity.releaseFingerprint = (await calcularFingerprintPayload(raiz)).fingerprint
  writeFileSync(contrato, `${JSON.stringify(json, null, 2)}\n`)
}

export async function copiarPayloadSelado(destino) {
  for (const pasta of PASTAS) {
    if (existsSync(join(RAIZ, pasta))) cpSync(join(RAIZ, pasta), join(destino, pasta), { recursive: true, filter: (o) => !o.includes('postgresql-5433') })
  }
  for (const arquivo of AVULSOS) {
    if (!existsSync(join(RAIZ, arquivo))) continue
    mkdirSync(dirname(join(destino, arquivo)), { recursive: true })
    cpSync(join(RAIZ, arquivo), join(destino, arquivo))
  }
  await selar(destino)
  return destino
}

function git(repo, ...argumentos) {
  const r = spawnSync('git', ['-c', 'user.name=teste', '-c', 'user.email=teste@exemplo.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...argumentos], { cwd: repo, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${argumentos[0]} saiu ${r.status}: ${r.stderr}`)
  return r.stdout.trim()
}

// commitar(mudar, { selar }) aplica `mudar(repo)`, sela de novo (ou não, para simular adulteração) e
// devolve o sha do commit novo.
export async function criarOrigem() {
  const repo = mkdtempSync(join(tmpdir(), 'omni-origem-'))
  await copiarPayloadSelado(repo)
  git(repo, 'init', '-q')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'origem selada')
  return {
    repo,
    sha: git(repo, 'rev-parse', 'HEAD'),
    async commitar(mudar, { selar: reselar = true } = {}) {
      mudar(repo)
      if (reselar) await selar(repo)
      git(repo, 'add', '-A')
      git(repo, 'commit', '-q', '-m', 'mudanca')
      return git(repo, 'rev-parse', 'HEAD')
    },
    apagar() { rmSync(repo, { recursive: true, force: true }) }
  }
}
