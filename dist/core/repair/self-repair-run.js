export const SELF_REPAIR_STAGE_IDS = [
    'daily-scan',
    'failure-automation',
    'delegation-reconciliation',
    'historical-turn-reconciliation',
    'system-audit',
    'personality-eval',
    'operational-release'
];
export const SELF_REPAIR_PROFILES = {
    reconciliation: [
        'failure-automation',
        'delegation-reconciliation',
        'historical-turn-reconciliation'
    ],
    maintenance: [
        'daily-scan',
        'system-audit',
        'personality-eval',
        'operational-release'
    ]
};
const KNOWN_STAGE_IDS = new Set(SELF_REPAIR_STAGE_IDS);
export function summarizeSelfRepairRun(profile, stages) {
    const expectedStages = SELF_REPAIR_PROFILES[profile];
    if (!expectedStages)
        throw new Error(`Perfil de autocorrecao desconhecido: ${String(profile)}.`);
    const seen = new Set();
    const observed = new Map();
    for (const item of stages) {
        if (!KNOWN_STAGE_IDS.has(item.stage))
            throw new Error(`Etapa de autocorrecao desconhecida: ${item.stage}.`);
        if (!expectedStages.includes(item.stage)) {
            throw new Error(`Etapa ${item.stage} nao pertence ao perfil ${profile}.`);
        }
        if (seen.has(item.stage))
            throw new Error(`Etapa de autocorrecao duplicada: ${item.stage}.`);
        seen.add(item.stage);
        if (!['fulfilled', 'rejected'].includes(item.status)) {
            throw new Error(`Estado de etapa de autocorrecao desconhecido: ${String(item.status)}.`);
        }
        observed.set(item.stage, item.status);
    }
    const missingStageIds = expectedStages.filter((stage) => !observed.has(stage));
    if (missingStageIds.length > 0) {
        throw new Error(`Perfil ${profile} sem etapas obrigatorias: ${missingStageIds.join(', ')}.`);
    }
    const failedStageIds = expectedStages.filter((stage) => observed.get(stage) === 'rejected');
    const completedStages = expectedStages.length - failedStageIds.length;
    return {
        profile,
        status: failedStageIds.length === 0 ? 'healthy' : 'degraded',
        completedStages,
        failedStages: failedStageIds.length,
        failedStageIds
    };
}
