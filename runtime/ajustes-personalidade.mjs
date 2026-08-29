import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = dirname(dirname(fileURLToPath(import.meta.url)))

export const TEXTO_DIRETIVA_PERSONALIDADE = Object.freeze({
  'preserve-overall-voice': 'Preserve a entrega geral aprovada sem transformar a voz em formula repetida.',
  'change-overall-voice': 'Mude a voz geral de forma perceptivel; nao repita o padrao rejeitado.',
  'preserve-tone': 'Preserve o tom aprovado com a mesma naturalidade e proporcao.',
  'increase-tone-presence': 'Diminua a secura e aumente presenca humana sem perder objetividade.',
  'preserve-presence': 'Preserve a presenca humana aprovada sem aumentar cerimonia.',
  'increase-human-presence': 'Converse como companhia inteligente e ativa, nao como formulario corporativo.',
  'preserve-distinctive-voice': 'Preserve a voz propria reconhecida sem depender de bordao.',
  'increase-distinctive-voice': 'Use uma voz reconhecivel do Omni desde a primeira frase.',
  'preserve-personality-intensity': 'Preserve a intensidade aprovada da personalidade durante todo o raciocinio.',
  'increase-personality-intensity': 'Aumente a intensidade da personalidade em todo o raciocinio, inclusive sob carga tecnica.',
  'preserve-humor-level': 'Preserve o nivel de humor contextual aprovado sem forcar uma tirada.',
  'increase-contextual-humor': 'Use humor contextual quando a situacao oferecer material real; nao conte piada pronta.',
  'preserve-sarcasm-level': 'Preserve o nivel de sarcasmo contextual aprovado e dirigido ao problema.',
  'increase-contextual-sarcasm': 'Use sarcasmo contextual e respeitoso para iluminar contradicoes reais.',
  'preserve-analogy-level': 'Preserve a forca das imagens e analogias que ajudam a entender o raciocinio.',
  'increase-useful-analogies': 'Integre analogias que ensinem e reduzam a complexidade sem rotula-las.',
  'preserve-reasoning-density': 'Preserve a densidade do raciocinio e o angulo inteligente aprovados.',
  'increase-reasoning-density': 'Mostre inteligencia por conexoes causais, opiniao fundamentada e um angulo original.'
})

function validar(document) {
  if (document?.schemaVersion !== 1 ||
    document.contract !== 'omni-learned-personality-adjustments-v1' ||
    !Array.isArray(document.adjustments)) {
    throw new Error('Contrato de ajustes aprendidos da personalidade e invalido.')
  }
  const ids = new Set()
  for (const item of document.adjustments) {
    if (typeof item?.directiveId !== 'string' || !TEXTO_DIRETIVA_PERSONALIDADE[item.directiveId] ||
      ids.has(item.directiveId) || typeof item?.evalRoundId !== 'string' ||
      !/^[a-f0-9]{64}$/.test(item?.evidenceFingerprint ?? '') ||
      !Number.isFinite(Date.parse(item?.approvedAt))) {
      throw new Error('Ajuste aprendido da personalidade e invalido ou duplicado.')
    }
    ids.add(item.directiveId)
  }
  return document
}

export async function lerAjustesAprendidosPersonalidade({ pluginRoot = raiz } = {}) {
  try {
    return validar(JSON.parse(await readFile(
      join(pluginRoot, 'contratos', 'personalidade', 'ajustes-aprendidos.json'),
      'utf8'
    )))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    return {
      schemaVersion: 1,
      contract: 'omni-learned-personality-adjustments-v1',
      adjustments: []
    }
  }
}

export function formatarAjustesAprendidos(document) {
  const lines = (document?.adjustments ?? [])
    .map((item) => TEXTO_DIRETIVA_PERSONALIDADE[item.directiveId])
    .filter(Boolean)
  return lines.length > 0 ? `AJUSTES APRENDIDOS E APROVADOS:\n${lines.map((line) => `- ${line}`).join('\n')}` : null
}
