// Desligamento do 5433 (F2, plano 6a, T3). Tudo falso: pasta data, pg_ctl, broker, atalho e casa
// temporários. O broker falso tem marca aleatória e o roteiro só procura essa marca, então o broker
// real desta máquina nunca entra no alcance; a porta é uma livre, não a 5433.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

import { comBancoDaCasa } from '../runtime/casa/banco.mjs'
import { importarDoPostgres } from '../runtime/casa/loja-operacao.mjs'

const SCRIPT = fileURLToPath(new URL('../scripts/omni-desligar-5433.ps1', import.meta.url))
const VAZIO = { missoes: [], missaoEventos: [], achados: [], achadoEventos: [] }

function vivo(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}

function processoFalso(t, marca) {
  const filho = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)', marca], { stdio: 'ignore', windowsHide: true })
  t.after(() => { if (vivo(filho.pid)) filho.kill() })
  return filho.pid
}

async function portaLivre() {
  const servidor = createServer()
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok))
  const { port } = servidor.address()
  await new Promise((ok) => servidor.close(ok))
  return port
}

async function cenario(t, { recibo = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'omni-5433-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const dados = join(base, 'data')
  mkdirSync(join(dados, 'base', '1'), { recursive: true })
  writeFileSync(join(dados, 'PG_VERSION'), '18\n')
  writeFileSync(join(dados, 'postgresql.conf'), 'port = 5433\n')
  writeFileSync(join(dados, 'base', '1', '1259'), randomBytes(4096))
  const inicializar = join(base, 'Inicializar')
  mkdirSync(inicializar)
  writeFileSync(join(inicializar, 'Omni Runtime.lnk'), 'atalho falso')
  writeFileSync(join(inicializar, 'Outro.lnk'), 'atalho de outro programa')
  const pgCtl = join(base, 'pg_ctl.cmd')
  writeFileSync(pgCtl, '@echo off\r\necho %*>> "%~dp0pg_ctl.log"\r\nexit /b 0\r\n')
  const casa = join(base, 'casa')
  mkdirSync(casa)
  if (recibo) comBancoDaCasa(casa, 'omni', (db) => importarDoPostgres(db, VAZIO, { fonte: 'dump.json', fonteSha256: 'a'.repeat(64) }))
  const marca = 'omni-access-broker-prova-' + randomBytes(6).toString('hex')
  const broker = processoFalso(t, marca + '.ps1')
  const outro = processoFalso(t, 'nao-relacionado-' + randomBytes(6).toString('hex'))
  const argumentos = [
    '-Dados', dados, '-Backup', join(base, 'backup'), '-Inicializar', inicializar, '-Desativados', join(base, 'desativados'),
    '-Casa', casa, '-PgCtl', pgCtl, '-Porta', String(await portaLivre()), '-Broker', marca
  ]
  return { base, dados, inicializar, pgCtl, broker, outro, argumentos }
}

function rodar(argumentos) {
  const env = { ...process.env }
  delete env.OMNI_CASA_BANCO
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...argumentos], { encoding: 'utf8', env, timeout: 180_000, windowsHide: true })
  return { ...r, saida: r.stdout.trim() ? JSON.parse(r.stdout) : null }
}

test('sem -Executar só mostra o plano: pasta, atalho e processos ficam como estavam', async (t) => {
  const c = await cenario(t)
  const r = rodar(c.argumentos)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.saida.modo, 'plano')
  assert.deepEqual(r.saida.broker, [c.broker])
  assert.equal(existsSync(join(c.inicializar, 'Omni Runtime.lnk')), true)
  assert.equal(existsSync(join(c.base, 'pg_ctl.log')), false)
  assert.equal(existsSync(join(c.base, 'backup')), false)
  assert.equal(vivo(c.broker), true)
  assert.equal(vivo(c.outro), true)
})

test('uso errado trava fechado: -Dados que não é pasta data, ou pasta faltando, sai 2 sem tocar em nada, nem com -Executar', async (t) => {
  const c = await cenario(t)
  const i = c.argumentos.indexOf('-Dados')
  const errado = [...c.argumentos]
  errado[i + 1] = join(c.base, 'nao-existe')
  const sem = c.argumentos.filter((_, j) => j !== c.argumentos.indexOf('-Inicializar') && j !== c.argumentos.indexOf('-Inicializar') + 1)
  for (const argumentos of [errado, [...errado, '-Executar'], [...sem, '-Executar']]) {
    const r = rodar(argumentos)
    assert.equal(r.status, 2, r.stderr + r.stdout)
    assert.equal(r.saida.ok, false)
  }
  assert.equal(existsSync(join(c.inicializar, 'Omni Runtime.lnk')), true)
  assert.equal(existsSync(join(c.base, 'pg_ctl.log')), false)
  assert.equal(existsSync(join(c.base, 'backup')), false)
  assert.equal(vivo(c.broker), true)
})

test('sem o recibo da importação do 5433 no omni.db, recusa com saída 3 e não mexe em nada', async (t) => {
  const c = await cenario(t, { recibo: false })
  const r = rodar([...c.argumentos, '-Executar'])
  assert.equal(r.status, 3, r.stderr)
  assert.equal(r.saida.ok, false)
  assert.match(r.saida.erro, /recibo/)
  assert.equal(existsSync(join(c.inicializar, 'Omni Runtime.lnk')), true)
  assert.equal(existsSync(join(c.base, 'pg_ctl.log')), false)
  assert.equal(vivo(c.broker), true)
})

test('com -Executar: broker parado, PG parado, cópia datada conferida, atalho guardado e o resto intocado', async (t) => {
  const c = await cenario(t)
  const r = rodar([...c.argumentos, '-Executar'])
  assert.equal(r.status, 0, r.stderr + r.stdout)
  assert.equal(r.saida.ok, true)

  assert.equal(vivo(c.broker), false)
  assert.equal(vivo(c.outro), true)

  const pg = readFileSync(join(c.base, 'pg_ctl.log'), 'utf8')
  assert.match(pg, /^stop -D .+ -m fast -w\s*$/m)
  assert.ok(pg.includes(c.dados), pg)

  const copias = readdirSync(join(c.base, 'backup'))
  assert.equal(copias.length, 1)
  assert.match(copias[0], /^postgresql-5433-\d{8}-\d{6}$/)
  const copia = join(c.base, 'backup', copias[0])
  assert.deepEqual(readFileSync(join(copia, 'base', '1', '1259')), readFileSync(join(c.dados, 'base', '1', '1259')))
  assert.equal(r.saida.copia.arquivos, 3)
  assert.equal(r.saida.copia.destino, copia)

  assert.equal(existsSync(join(c.inicializar, 'Omni Runtime.lnk')), false)
  assert.equal(existsSync(join(c.base, 'desativados', 'Omni Runtime.lnk')), true)
  assert.equal(existsSync(join(c.inicializar, 'Outro.lnk')), true)
  assert.equal(existsSync(join(c.dados, 'PG_VERSION')), true)
})
