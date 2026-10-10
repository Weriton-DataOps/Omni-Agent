// Reversão dos recibos de autoevolução (recibo-com-veto, 10/10/2026).
//
// Modelo decidido pelo dono: cada evolução automática grava um recibo visível no ledger
// (runtime/recibos-evolucao.mjs). Quando o dono veta um recibo, este módulo executa a reversão
// própria da estratégia declarada em `revert.strategy`. As reversões locais (memória, personalidade,
// capacidade) acontecem aqui; as de git/contrato NÃO rodam git — ficam no portão humano e devolvem
// a instrução para o dono confirmar a publicação da reversão.

import { readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve, sep } from 'node:path'

import { marcarMemoriaObsoleta } from './memoria.mjs'
import { reverterManifestoParaCandidata } from './personalidade.mjs'

export const INSTRUCAO_REVERSAO_GIT = [
  'Reversão sob confirmação humana: o veto foi registrado, mas a publicação do revert aguarda o dono.',
  'Prepare localmente `git revert <commit>` (sem push) e confirme com o dono antes de publicar.'
].join(' ')

function nomeSkillSeguro(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{1,80}$/.test(value)
}

async function dentroDaRaiz(root, ...segmentos) {
  const canonicalRoot = await realpath(resolve(root))
  const alvo = await realpath(join(canonicalRoot, ...segmentos))
  if (alvo !== canonicalRoot && !alvo.startsWith(`${canonicalRoot}${sep}`)) {
    throw new Error('A reversão recusou um caminho fora da raiz canônica.')
  }
  return alvo
}

// Remoção local de uma capacidade admitida: apaga a skill e a entrada do catálogo. Quando a proposta
// ainda não foi admitida (nada materializado), devolve 'nothing-to-remove' — o veto encerra a proposta.
async function removerCapacidadeLocal(repoRoot, name) {
  if (!isAbsolute(repoRoot ?? '')) throw new Error('A remoção de capacidade exige repositório absoluto.')
  if (!nomeSkillSeguro(name)) return { result: 'invalid-name', name }
  let skillDir = null
  try {
    skillDir = await dentroDaRaiz(repoRoot, 'skills', name)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  let removed = false
  if (skillDir) {
    await rm(skillDir, { recursive: true, force: true })
    removed = true
  }
  const catalogPath = join(repoRoot, 'contratos', 'capacidades', 'catalogo.json')
  try {
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
    if (Array.isArray(catalog.capabilities)) {
      const antes = catalog.capabilities.length
      catalog.capabilities = catalog.capabilities.filter((item) => item?.name !== name && item?.id !== name)
      if (catalog.capabilities.length !== antes) {
        const temp = `${catalogPath}.${process.pid}.novo`
        await writeFile(temp, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
        await rename(temp, catalogPath)
        removed = true
      }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return { result: removed ? 'removed' : 'nothing-to-remove', name }
}

/**
 * Executa a reversão de um recibo vetado. Retorna { strategy, result, reverted, ... }.
 * `reverted:true` sinaliza ao chamador que pode fechar o ciclo com `marcarRevertido`.
 * As dependências são injetáveis para teste com mocks (sem tocar git, personalidade ou catálogo reais).
 */
export async function reverterRecibo(casa, recibo, {
  pluginRoot,
  repoRoot,
  deps = {}
} = {}) {
  const strategy = recibo?.revert?.strategy
  const ref = recibo?.revert?.ref
  const raizPersonalidade = pluginRoot ?? repoRoot
  const raizCapacidade = repoRoot ?? pluginRoot

  if (strategy === 'memory-unconfirm') {
    const desconfirmar = deps.desconfirmarMemoria ??
      ((home, id) => marcarMemoriaObsoleta(home, id, `owner-veto:${recibo.id}`))
    const outcome = await desconfirmar(casa, ref)
    // 'not-found' também encerra: a memória já não está confirmada, logo já não é injetada.
    const reverted = ['obsolete', 'not-found'].includes(outcome?.result)
    return { strategy, result: outcome?.result ?? 'unknown', reverted, detail: outcome }
  }

  if (strategy === 'personality-supersede') {
    if (!raizPersonalidade) throw new Error('A reversão de personalidade exige pluginRoot.')
    const reverter = deps.reverterPersonalidade ?? reverterManifestoParaCandidata
    const outcome = await reverter(raizPersonalidade, ref)
    const reverted = ['reverted', 'already-active'].includes(outcome?.result)
    return { strategy, result: outcome?.result ?? 'unknown', reverted, detail: outcome }
  }

  if (strategy === 'capability-remove') {
    if (!raizCapacidade) throw new Error('A reversão de capacidade exige repoRoot.')
    const remover = deps.removerCapacidade ?? removerCapacidadeLocal
    const outcome = await remover(raizCapacidade, ref)
    const reverted = ['removed', 'nothing-to-remove'].includes(outcome?.result)
    return { strategy, result: outcome?.result ?? 'unknown', reverted, detail: outcome }
  }

  if (strategy === 'git-revert' || strategy === 'contract-revert') {
    // TODO-reversão-git-sob-confirmação: a publicação do revert fica no portão humano (gate 1).
    // NÃO rodamos git aqui; devolvemos o commit/ref e a instrução para o dono confirmar.
    return {
      strategy,
      result: 'manual-git-required',
      reverted: false,
      commit: ref,
      instruction: INSTRUCAO_REVERSAO_GIT
    }
  }

  throw new Error(`Estratégia de reversão não suportada no veto: ${strategy}.`)
}
