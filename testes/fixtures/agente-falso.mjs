// Agente de mentira para os testes do supervisor e do servir. O comportamento vem de AGENTE_FALSO_MODO:
//   no-ar (padrão) escuta de verdade, anuncia a porta e só sai quando o stdin fecha;
//   uso sai 2; recusa anuncia {"recusa":true} e sai 1; cai sai 1 sem anunciar; mudo nunca anuncia.
// AGENTE_FALSO_REGISTRO recebe uma linha por subida (argumentos, OMNI_API, se veio token e a pasta).
// AGENTE_FALSO_CAMPAINHA: antes de anunciar, toca POST {OMNI_API}/despachos com essa execução.
import { appendFileSync } from 'node:fs'
import { createServer } from 'node:http'

const modo = process.env.AGENTE_FALSO_MODO ?? 'no-ar'
const registro = process.env.AGENTE_FALSO_REGISTRO
if (registro) {
  appendFileSync(registro, `${JSON.stringify({ argv: process.argv.slice(2), api: process.env.OMNI_API ?? null, token: Boolean(process.env.OMNI_API_TOKEN), cwd: process.cwd() })}\n`)
}
const anunciar = (linha) => process.stdout.write(`${JSON.stringify(linha)}\n`)

if (process.argv.slice(2).join(' ') !== 'servir --porta 0' || modo === 'uso') {
  process.stderr.write('uso: agente-falso servir --porta 0\n')
  process.exit(2)
} else if (modo === 'recusa') {
  anunciar({ ok: false, erro: 'sem credencial da api', recusa: true })
  process.exit(1)
} else if (modo === 'cai') {
  process.stderr.write('caiu de propósito\n')
  process.exit(1)
} else if (modo === 'mudo') {
  process.stdin.resume()
  process.stdin.on('end', () => process.exit(0))
  setInterval(() => {}, 1_000)
} else {
  const servidor = createServer((_req, res) => res.end('{}'))
  servidor.listen(0, '127.0.0.1', async () => {
    const execucao = process.env.AGENTE_FALSO_CAMPAINHA
    if (execucao) {
      const resposta = await fetch(`${process.env.OMNI_API}/despachos`, {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.OMNI_API_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ agente: 'falso', execucao })
      })
      process.stderr.write(`campainha ${resposta.status}\n`)
    }
    anunciar({ ok: true, porta: servidor.address().port, extra: 'campo a mais é tolerado' })
  })
  process.stdin.resume()
  process.stdin.on('end', () => {
    servidor.close()
    process.exit(0)
  })
}
