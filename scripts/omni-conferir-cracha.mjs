// Conferência do Crachá (F2, plano 6a, T2), só leitura. O PG 5433 guarda as versões de credencial do
// Crachá como metadado; o segredo de cada uma mora no Gerenciador de Credenciais do Windows, no alvo
// Omni/UserCredential/<x>, citado no PG como credential-ref:windows-<x> (scripts/omni-access-broker.ps1).
// Antes de desligar o 5433, cada versão viva precisa existir no Gerenciador; o relatório diz também se o
// cofre.db da casa já a inventaria. Nenhum valor passa por aqui: a exportação não tem coluna de segredo
// nem de conta, e o relatório só leva id, serviço, status e alvo.
//
//   node scripts/omni-conferir-cracha.mjs --consulta
//       imprime a consulta só leitura; no 6b ela roda por psql -At e a saída vira o --exportacao.
//   node scripts/omni-conferir-cracha.mjs --exportacao <arquivo.json> [--inventario <arquivo.json>]
//       sem --inventario, lê o Gerenciador pela ponte DPAPI da casa.
// Saída: 0 tudo no Gerenciador; 1 falta versão viva ou referência fora do formato; 2 uso errado.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { comBancoDaCasa } from '../runtime/casa/banco.mjs'
import { criarPonteDpapi } from '../runtime/casa/dpapi.mjs'
import { casaDoCofre } from '../runtime/cofre.mjs'

export const CONSULTA = `select coalesce(json_agg(json_build_object(
  'credential_id', v.credential_id, 'version', v.version, 'provider_ref', v.provider_ref,
  'secret_ref', v.secret_ref, 'status', v.status, 'expires_at', v.expires_at,
  'eventos', (select count(*) from audit.credential_events e where e.credential_id = v.credential_id and e.version = v.version)
) order by v.credential_id, v.version), '[]'::json) from access.credential_versions v;`

const REFERENCIA = /^credential-ref:windows-([a-zA-Z0-9._:-]{1,180})$/
const APOSENTADAS = new Set(['revoked', 'replaced', 'disabled'])

export function alvoDoSecretRef(ref) {
  const achado = typeof ref === 'string' ? REFERENCIA.exec(ref) : null
  return achado ? 'Omni/UserCredential/' + achado[1] : null
}

const chave = (alvo) => String(alvo).toLowerCase()

export function conferirCracha({ versoes, inventario, noCofre }) {
  const noGerenciador = new Set(inventario.map((entrada) => chave(entrada?.alvo)))
  const inventariadas = new Set(noCofre.map(chave))
  const linhas = versoes.map((v) => {
    const alvo = alvoDoSecretRef(v.secret_ref)
    const aposentada = APOSENTADAS.has(v.status)
    const gerenciador = alvo === null ? 'formato-desconhecido' : noGerenciador.has(chave(alvo)) ? 'no-gerenciador' : 'ausente'
    const cofre = alvo !== null && inventariadas.has(chave(alvo)) ? 'no-cofre.db' : 'fora'
    const reprovada = gerenciador === 'formato-desconhecido' || (gerenciador === 'ausente' && !aposentada)
    return { credencial: v.credential_id, versao: v.version, servico: v.provider_ref ?? null, status: v.status ?? null, eventos: Number(v.eventos ?? 0), alvo, gerenciador, cofre, aposentada, reprovada }
  })
  const reprovadas = linhas.filter((l) => l.reprovada).map((l) => `${l.credencial} v${l.versao}`)
  return { ok: reprovadas.length === 0, total: linhas.length, reprovadas, linhas }
}

function lerJson(arquivo, rotulo) {
  const valor = JSON.parse(readFileSync(arquivo, 'utf8').replace(/^﻿/, ''))
  if (!Array.isArray(valor)) throw new Error(`${rotulo} precisa ser uma lista JSON.`)
  return valor
}

export function rodarConferencia(argv, { env = process.env, saida = process.stdout, erro = process.stderr } = {}) {
  let o
  try {
    o = parseArgs({ args: argv, options: { consulta: { type: 'boolean' }, exportacao: { type: 'string' }, inventario: { type: 'string' } }, strict: true }).values
  } catch (falha) {
    erro.write(`${falha.message}\n`); return 2
  }
  if (o.consulta) { saida.write(CONSULTA + '\n'); return 0 }
  if (!o.exportacao) { erro.write('uso: --consulta | --exportacao <arquivo.json> [--inventario <arquivo.json>]\n'); return 2 }

  const versoes = lerJson(o.exportacao, 'A exportação')
  const inventario = o.inventario ? lerJson(o.inventario, 'O inventário') : criarPonteDpapi().inventariarGerenciador()
  const noCofre = comBancoDaCasa(casaDoCofre(env), 'cofre', (db) =>
    db.prepare("SELECT alvo_windows FROM credenciais WHERE guarda = 'gerenciador-windows' AND apagado_em IS NULL").all().map((l) => l.alvo_windows), env)
  const relatorio = conferirCracha({ versoes, inventario, noCofre })
  saida.write(JSON.stringify(relatorio, null, 2) + '\n')
  return relatorio.ok ? 0 : 1
}

const direto = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (direto) process.exitCode = rodarConferencia(process.argv.slice(2))
