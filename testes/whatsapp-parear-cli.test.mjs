// Plano 4c, T3: a CLI parear.mjs contra um serviço WhatsApp FALSO (node:http, porta aleatória) e um
// APPDATA temporário. Com --chave-stdin a CLI não toca o cofre do Windows em nenhuma direção.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

const CLI = fileURLToPath(new URL('../servicos/whatsapp/omni/parear.mjs', import.meta.url))
const ADMIN = 'admin-' + randomBytes(8).toString('hex')
const FONE = { 'omni-pessoal': '5562999991234', 'omni-bot': '5562988885678' }
const QR_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk'

// Serviço falso: sessões criadas por nome, 'qr_ready' na 1ª leitura de estado após o start e 'ready'
// na seguinte; chaves com papel e escopo; respostas embrulhadas em { data } como o de verdade.
function servico({ vazaPessoal = false, mesmoNumero = false } = {}) {
  const sessoes = new Map(); const chaves = []; const emitidas = []
  const srv = http.createServer(async (req, res) => {
    let corpo = ''; for await (const c of req) corpo += c
    corpo = corpo ? JSON.parse(corpo) : null
    const chave = req.headers['x-api-key']
    const responder = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data })) }
    const url = new URL(req.url, 'http://x'); const p = url.pathname
    if (chave === ADMIN) {
      if (req.method === 'GET' && p === '/api/sessions') return responder(200, [...sessoes.values()].map(({ id, name }) => ({ id, name })))
      if (req.method === 'POST' && p === '/api/sessions') {
        const id = `s-${corpo.name}`; sessoes.set(id, { id, name: corpo.name, status: 'created', leituras: 0 }); return responder(201, { id, name: corpo.name })
      }
      if (req.method === 'GET' && p === '/api/auth/api-keys') return responder(200, chaves.map(({ apiKey, ...k }) => k))
      if (req.method === 'POST' && p === '/api/auth/api-keys') {
        const apiKey = `chave-${corpo.name}-${randomBytes(8).toString('hex')}`; emitidas.push(apiKey)
        chaves.push({ id: `k${chaves.length}`, isActive: true, apiKey, ...corpo }); return responder(201, { id: `k${chaves.length - 1}`, name: corpo.name, role: corpo.role, apiKey })
      }
      const m = /^\/api\/sessions\/([^/]+)(\/[a-z-]+)?$/.exec(p)
      if (m) {
        const s = sessoes.get(m[1]); if (!s) return responder(404, null)
        if (req.method === 'POST' && m[2] === '/start') { if (s.status !== 'ready') s.status = 'initializing'; return responder(200, {}) }
        if (req.method === 'POST' && m[2] === '/logout') { s.status = 'disconnected'; return responder(200, {}) }
        if (req.method === 'GET' && m[2] === '/qr') return responder(200, { qrCode: QR_PNG })
        if (req.method === 'GET' && !m[2]) {
          if (s.status === 'initializing') s.status = 'qr_ready'; else if (s.status === 'qr_ready') s.status = 'ready'
          const fone = mesmoNumero && s.name === 'omni-bot' ? FONE['omni-pessoal'] : FONE[s.name]
          return responder(200, { status: s.status, phone: s.status === 'ready' ? fone : null })
        }
      }
      return responder(404, null)
    }
    const k = chaves.find((c) => c.apiKey === chave && c.isActive)
    if (!k) return responder(401, null)
    const m = /^\/api\/sessions\/([^/]+)\/messages/.exec(p)
    if (vazaPessoal && req.method === 'POST' && m[1] === 's-omni-pessoal') return responder(201, {})
    if (k.allowedSessions && !k.allowedSessions.includes(m[1])) return responder(401, null)
    if (req.method === 'GET') return responder(200, [])
    if (k.role === 'viewer') return responder(403, null)
    if (k.allowedChats && !k.allowedChats.includes(corpo.chatId)) return responder(403, null)
    return responder(201, {})
  })
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, sessoes, emitidas, base: `http://127.0.0.1:${srv.address().port}` })))
}

function rodar(args, { base, appdata, chave = ADMIN }) {
  assert.ok(!/:2785\b/.test(base), 'a prova nunca aponta para o serviço real (porta 2785)')
  return new Promise((ok) => {
    const filho = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, APPDATA: appdata, OMNI_WHATSAPP_BASE: base }, windowsHide: true })
    let out = ''; let err = ''
    filho.stdout.on('data', (c) => { out += c }); filho.stderr.on('data', (c) => { err += c })
    filho.stdin.end(chave + '\n')
    filho.on('close', (codigo) => ok({ codigo, out, err, linhas: out.split('\n').filter(Boolean) }))
  })
}
const eventos = (r) => r.linhas.map((l) => JSON.parse(l))
const pasta = () => mkdtempSync(join(tmpdir(), 'omni-p4c-'))
const run = (appdata) => join(appdata, 'omni', 'whatsapp')
const lerTudo = (dir) => readdirSync(dir).map((n) => readFileSync(join(dir, n), 'utf8')).join('\n')

test('pessoal --json: sessao, qr, pareado e fim; sessao.id e dono.txt gravados', async () => {
  const s = await servico(); const appdata = pasta()
  try {
    const r = await rodar(['--json', '--chave-stdin', '--papel', 'pessoal'], { base: s.base, appdata })
    assert.equal(r.codigo, 0, r.err)
    const ev = eventos(r)
    assert.deepEqual(ev.filter((e) => ['sessao', 'pareado', 'fim'].includes(e.evento)), [
      { evento: 'sessao', papel: 'pessoal' }, { evento: 'pareado', papel: 'pessoal', fone4: '1234' }, { evento: 'fim', papel: 'pessoal', ok: true },
    ])
    assert.ok(ev.some((e) => e.evento === 'qr' && e.qr === QR_PNG))
    assert.equal(readFileSync(join(run(appdata), 'sessao.id'), 'utf8').trim(), 's-omni-pessoal')
    assert.equal(readFileSync(join(run(appdata), 'dono.txt'), 'utf8').trim(), FONE['omni-pessoal'])
    assert.ok(!/\d{8,}/.test(r.out), 'número inteiro na saída')
  } finally { s.srv.close(); rmSync(appdata, { recursive: true, force: true }) }
})

test('bot depois do pessoal, fechar e o pareamento.json sem chave nenhuma', async () => {
  const s = await servico(); const appdata = pasta()
  try {
    assert.equal((await rodar(['--json', '--chave-stdin', '--papel', 'pessoal'], { base: s.base, appdata })).codigo, 0)
    const b = await rodar(['--json', '--chave-stdin', '--bot'], { base: s.base, appdata })
    assert.equal(b.codigo, 0, b.err)
    assert.deepEqual(eventos(b).at(-1), { evento: 'fim', papel: 'bot', ok: true })
    assert.equal(readFileSync(join(run(appdata), 'sessao-bot.id'), 'utf8').trim(), 's-omni-bot')
    const f = await rodar(['--json', '--chave-stdin', '--papel', 'fechar'], { base: s.base, appdata })
    assert.equal(f.codigo, 0, f.err)
    assert.deepEqual(eventos(f), [
      { evento: 'fechado', soLeitura: { ok: true, recusas: 5, falhas: [] } }, { evento: 'fim', papel: 'fechar', ok: true },
    ])
    const pj = JSON.parse(readFileSync(join(run(appdata), 'pareamento.json'), 'utf8'))
    assert.deepEqual(pj.pessoal, { fone4: '1234' }); assert.deepEqual(pj.bot, { fone4: '5678' })
    assert.equal(pj.soLeitura.ok, true); assert.equal(pj.soLeitura.recusas, 5)
    assert.equal(s.emitidas.length, 3)
    const tudo = lerTudo(run(appdata)) + f.out + f.err + b.out
    for (const chave of [...s.emitidas, ADMIN]) assert.ok(!tudo.includes(chave), 'chave vazou para arquivo ou saída')
  } finally { s.srv.close(); rmSync(appdata, { recursive: true, force: true }) }
})

test('serviço que deixa enviar pela pessoal: fechar sai com 2 e soLeitura.ok false', async () => {
  const s = await servico({ vazaPessoal: true }); const appdata = pasta()
  try {
    await rodar(['--json', '--chave-stdin', '--papel', 'pessoal'], { base: s.base, appdata })
    await rodar(['--json', '--chave-stdin', '--papel', 'bot'], { base: s.base, appdata })
    const f = await rodar(['--json', '--chave-stdin', '--papel', 'fechar'], { base: s.base, appdata })
    assert.equal(f.codigo, 2)
    const fechado = eventos(f).find((e) => e.evento === 'fechado')
    assert.equal(fechado.soLeitura.ok, false)
    assert.ok(fechado.soLeitura.falhas.includes('[envio pela sessão pessoal]'))
    assert.equal(JSON.parse(readFileSync(join(run(appdata), 'pareamento.json'), 'utf8')).soLeitura.ok, false)
  } finally { s.srv.close(); rmSync(appdata, { recursive: true, force: true }) }
})

test('bot escaneado com o celular pessoal: mesmo-numero, saída 2 e logout no serviço', async () => {
  const s = await servico({ mesmoNumero: true }); const appdata = pasta()
  try {
    await rodar(['--json', '--chave-stdin', '--papel', 'pessoal'], { base: s.base, appdata })
    const b = await rodar(['--json', '--chave-stdin', '--papel', 'bot'], { base: s.base, appdata })
    assert.equal(b.codigo, 2)
    assert.deepEqual(eventos(b).at(-1), { evento: 'fim', papel: 'bot', ok: false, motivo: 'mesmo-numero' })
    assert.equal(s.sessoes.get('s-omni-bot').status, 'disconnected')
  } finally { s.srv.close(); rmSync(appdata, { recursive: true, force: true }) }
})

test('sem --json: escreve a página pareamento.html e nenhuma linha JSON', async () => {
  const s = await servico(); const appdata = pasta()
  try {
    const r = await rodar(['--chave-stdin'], { base: s.base, appdata })
    assert.equal(r.codigo, 0, r.err)
    const html = readFileSync(join(run(appdata), 'pareamento.html'), 'utf8')
    assert.ok(html.includes('✅ Pareado'), html.slice(0, 300))
    assert.ok(r.linhas.every((l) => !l.startsWith('{')), r.out)
    assert.ok(r.out.includes('PAREADO'))
  } finally { s.srv.close(); rmSync(appdata, { recursive: true, force: true }) }
})

test('fechar sem os dois pareados: fim falta-pareamento, saída 2, sem tocar em chave', async () => {
  const s = await servico(); const appdata = pasta()
  try {
    const f = await rodar(['--json', '--chave-stdin', '--papel', 'fechar'], { base: s.base, appdata })
    assert.equal(f.codigo, 2)
    assert.deepEqual(eventos(f).at(-1), { evento: 'fim', papel: 'fechar', ok: false, motivo: 'falta-pareamento' })
    assert.equal(s.emitidas.length, 0)
  } finally { s.srv.close(); rmSync(appdata, { recursive: true, force: true }) }
})

test('papel desconhecido: saída 1, sem chamar o serviço', async () => {
  const s = await servico(); const appdata = pasta()
  try {
    const r = await rodar(['--json', '--chave-stdin', '--papel', 'outro'], { base: s.base, appdata })
    assert.equal(r.codigo, 1)
    assert.equal(s.sessoes.size, 0)
  } finally { s.srv.close(); rmSync(appdata, { recursive: true, force: true }) }
})
