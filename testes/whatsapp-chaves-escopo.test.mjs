// Plano 4c, T2: as chaves com escopo do WhatsApp viram módulo e devolvem as provas.
// "Pessoal só leitura" é isto: nenhuma chave do Omni consegue enviar pela sessão pessoal.
// O serviço é falso e aplica papel, allowedSessions e allowedChats como o de verdade.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

const { provisionarChaves, resumoSoLeitura } = await import(new URL('../servicos/whatsapp/omni/chaves-escopo.mjs', import.meta.url))

const ADMIN = 'admin-' + randomBytes(6).toString('hex')
const NOMES = { leitura: 'omni/whatsapp/leitura', envio: 'omni/whatsapp/envio', terceiros: 'omni/whatsapp/terceiros' }
const PESSOAL = 'sess-pessoal'
const BOT = 'sess-bot'
const DONO = '5562999991234@c.us'

function servicoFalso({ vazaPessoal = false, existentes = [] } = {}) {
  const chaves = existentes.map((k, i) => ({ id: `antiga-${i}`, isActive: true, apiKey: `antiga-${i}`, ...k }))
  const revogadas = []
  const emitidas = []
  const api = async (metodo, caminho, corpo, chave = ADMIN) => {
    if (chave === ADMIN) {
      if (metodo === 'GET' && caminho === '/api/auth/api-keys') return { status: 200, j: chaves.map(({ apiKey, ...k }) => k) }
      const rev = /^\/api\/auth\/api-keys\/([^/]+)\/revoke$/.exec(caminho)
      if (metodo === 'POST' && rev) { const k = chaves.find((c) => c.id === rev[1]); k.isActive = false; revogadas.push(k.name); return { status: 200, j: {} } }
      if (metodo === 'POST' && caminho === '/api/auth/api-keys') {
        const apiKey = `chave-${corpo.name}-${randomBytes(8).toString('hex')}`
        emitidas.push(apiKey)
        const k = { id: `k${chaves.length}`, isActive: true, apiKey, ...corpo }
        chaves.push(k)
        return { status: 201, j: { id: k.id, name: k.name, role: k.role, apiKey } }
      }
      const s = /^\/api\/sessions\/([^/?]+)$/.exec(caminho)
      if (metodo === 'GET' && s) return { status: 200, j: { status: 'ready', phone: s[1] === PESSOAL ? '5562999991234' : '5562988885678' } }
    }
    const k = chaves.find((c) => c.apiKey === chave && c.isActive)
    if (!k && chave !== ADMIN) return { status: 401, j: {} }
    const m = /^\/api\/sessions\/([^/]+)\/messages(\/send-text)?/.exec(caminho)
    const sessao = m[1]
    // O serviço que vaza é o que ignora o escopo de sessão no envio pela pessoal.
    if (vazaPessoal && metodo === 'POST' && sessao === PESSOAL) return { status: 201, j: {} }
    if (k.allowedSessions && !k.allowedSessions.includes(sessao)) return { status: 401, j: {} }
    if (metodo === 'GET') return { status: 200, j: [] }
    if (k.role === 'viewer') return { status: 403, j: {} }
    if (k.allowedChats && !k.allowedChats.includes(corpo.chatId)) return { status: 403, j: {} }
    return { status: 201, j: {} }
  }
  return { api, revogadas, emitidas }
}

function cofreFalso() {
  const guardado = {}
  return { guardado, segredos: { gravar: (n, v) => { guardado[n] = v }, ler: (n) => guardado[n] } }
}

test('serviço certo: 9 provas ok, 3 chaves no cofre e o pessoal provado só leitura', async () => {
  const { api } = servicoFalso()
  const { guardado, segredos } = cofreFalso()
  const r = await provisionarChaves({ api, pessoal: PESSOAL, bot: BOT, dono: DONO, segredos, nomes: NOMES })
  assert.equal(r.ok, true)
  assert.equal(r.provas.length, 9)
  assert.ok(r.provas.every((p) => p.ok), JSON.stringify(r.provas.filter((p) => !p.ok)))
  assert.deepEqual(Object.keys(guardado).sort(), Object.values(NOMES).sort())
  assert.deepEqual(resumoSoLeitura(r.provas), { ok: true, recusas: 5, falhas: [] })
})

test('serviço que deixa enviar pela sessão pessoal: ok false e a falha nomeada', async () => {
  const { api } = servicoFalso({ vazaPessoal: true })
  const { segredos } = cofreFalso()
  const r = await provisionarChaves({ api, pessoal: PESSOAL, bot: BOT, dono: DONO, segredos, nomes: NOMES })
  assert.equal(r.ok, false)
  const resumo = resumoSoLeitura(r.provas)
  assert.equal(resumo.ok, false)
  assert.ok(resumo.falhas.includes('[envio pela sessão pessoal]'), resumo.falhas.join(', '))
  assert.ok(resumo.falhas.includes('[terceiros envia pela sessão pessoal]'), resumo.falhas.join(', '))
})

test('nenhum log e nenhuma prova carrega o valor de uma chave', async () => {
  const { api, emitidas } = servicoFalso()
  const { segredos } = cofreFalso()
  const linhas = []
  const r = await provisionarChaves({ api, pessoal: PESSOAL, bot: BOT, dono: DONO, segredos, nomes: NOMES, log: (l) => linhas.push(l) })
  assert.ok(linhas.length >= 9, `linhas de log: ${linhas.length}`)
  assert.equal(emitidas.length, 3)
  const texto = linhas.join('\n') + JSON.stringify(r)
  for (const chave of [...emitidas, ADMIN]) assert.ok(!texto.includes(chave), 'chave vazou no log ou nas provas')
  assert.ok(!/\d{8,}/.test(linhas.join('\n')), 'número inteiro no log')
})

test('chaves antigas com os mesmos nomes são revogadas antes de criar', async () => {
  const { api, revogadas } = servicoFalso({ existentes: [
    { name: 'omni-leitura', role: 'viewer' }, { name: 'omni-envio-dono', role: 'operator' },
    { name: 'omni-envio-terceiros', role: 'operator' }, { name: 'outra-coisa', role: 'admin' },
  ] })
  const { segredos } = cofreFalso()
  await provisionarChaves({ api, pessoal: PESSOAL, bot: BOT, dono: DONO, segredos, nomes: NOMES })
  assert.deepEqual(revogadas.sort(), ['omni-envio-dono', 'omni-envio-terceiros', 'omni-leitura'])
})

test('so terceiros: recria só a de terceiros, com as 3 provas dela', async () => {
  const { api, emitidas } = servicoFalso()
  const { guardado, segredos } = cofreFalso()
  const r = await provisionarChaves({ api, pessoal: PESSOAL, bot: BOT, dono: DONO, segredos, nomes: NOMES, so: 'terceiros' })
  assert.equal(r.ok, true)
  assert.equal(emitidas.length, 1)
  assert.deepEqual(Object.keys(guardado), [NOMES.terceiros])
  assert.equal(r.provas.length, 3)
})

test('resumoSoLeitura sem provas não é ok', () => {
  assert.deepEqual(resumoSoLeitura([]), { ok: false, recusas: 0, falhas: [] })
})
