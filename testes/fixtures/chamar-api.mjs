// Auxiliares dos testes da API: chamar com host e token explícitos (o cliente da casa sempre fala
// com 127.0.0.1) e esperar uma condição sem dormir um tempo fixo.
import assert from 'node:assert/strict'
import { request } from 'node:http'

export function chamar(porta, metodo, rota, { corpo, token, host = `127.0.0.1:${porta}` } = {}) {
  return new Promise((resolver, rejeitar) => {
    const dados = corpo === undefined ? undefined : Buffer.from(typeof corpo === 'string' ? corpo : JSON.stringify(corpo))
    const headers = { host, connection: 'close' }
    if (token) headers.authorization = `Bearer ${token}`
    if (dados) {
      headers['content-type'] = 'application/json'
      headers['content-length'] = dados.length
    }
    const req = request({ host: '127.0.0.1', port: porta, method: metodo, path: rota, headers, agent: false }, (res) => {
      const partes = []
      res.on('data', (parte) => partes.push(parte))
      res.on('end', () => {
        const texto = Buffer.concat(partes).toString('utf8')
        let json = null
        try { json = JSON.parse(texto) } catch { /* corpo não JSON fica em texto */ }
        resolver({ status: res.statusCode, corpo: json, texto, headers: res.headers })
      })
    })
    req.on('error', rejeitar)
    if (dados) req.write(dados)
    req.end()
  })
}

export async function ate(condicao, ms = 8_000) {
  const limite = Date.now() + ms
  while (Date.now() < limite) {
    if (await condicao()) return
    await new Promise((resolver) => setTimeout(resolver, 25))
  }
  assert.fail('a condição não chegou no prazo')
}
