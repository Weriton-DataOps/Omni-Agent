import { AUTHORITY_BOUNDARIES, AUTHORITY_CONTROLS, AUTHORITY_RISKS } from '../core/authority/types.js';
import { ContractValidationError, array, closedRecord, dateTime, nonEmptyString, oneOf, uniqueStrings } from './validation.js';
const OPERATION = /^[a-z][a-z0-9]*(?:[.-][a-z][a-z0-9]*)+$/;
const EFFECT_CLASSES = [
    'runtime-internal',
    'read-only',
    'reversible-change',
    'irreversible-change',
    'external-publication',
    'financial',
    'privilege-change',
    'secret-access'
];
function parseGrant(value, path) {
    const input = closedRecord(value, path, ['resourceRef', 'operations']);
    return {
        resourceRef: nonEmptyString(input.resourceRef, `${path}.resourceRef`),
        operations: uniqueStrings(input.operations, `${path}.operations`, { min: 1, max: 64, pattern: OPERATION })
    };
}
function parseCeiling(value, path) {
    const input = closedRecord(value, path, ['mode', 'grants', 'expansionBoundaries', 'expiresAt']);
    if (input.mode !== 'proceed-within-scope') {
        throw new ContractValidationError(`${path}.mode`, 'modo de autoridade desconhecido');
    }
    const result = {
        mode: 'proceed-within-scope',
        grants: array(input.grants, `${path}.grants`, { max: 64 }).map((grant, index) => parseGrant(grant, `${path}.grants[${index}]`)),
        expansionBoundaries: uniqueStrings(input.expansionBoundaries ?? [], `${path}.expansionBoundaries`, {
            max: 8,
            allowed: AUTHORITY_BOUNDARIES
        })
    };
    if (input.expiresAt !== undefined)
        result.expiresAt = dateTime(input.expiresAt, `${path}.expiresAt`);
    return result;
}
function parseAction(value, path) {
    const input = closedRecord(value, path, [
        'actionId',
        'scope',
        'resourceRef',
        'operation',
        'effectMode',
        'effectKey',
        'effectClass',
        'riskLevel',
        'requestedControls'
    ]);
    const scope = oneOf(input.scope, `${path}.scope`, ['request-resource', 'runtime-internal']);
    const effectMode = oneOf(input.effectMode, `${path}.effectMode`, ['none', 'journaled']);
    const effectClass = oneOf(input.effectClass, `${path}.effectClass`, EFFECT_CLASSES);
    const resourceRef = input.resourceRef === undefined
        ? undefined
        : nonEmptyString(input.resourceRef, `${path}.resourceRef`);
    const effectKey = input.effectKey === undefined
        ? undefined
        : nonEmptyString(input.effectKey, `${path}.effectKey`);
    if (scope === 'request-resource' && resourceRef === undefined) {
        throw new ContractValidationError(`${path}.resourceRef`, 'obrigatório para recurso solicitado');
    }
    if (scope === 'runtime-internal' && resourceRef !== undefined) {
        throw new ContractValidationError(`${path}.resourceRef`, 'não permitido para ação interna');
    }
    if (scope === 'runtime-internal' && (effectMode !== 'none' || effectClass !== 'runtime-internal')) {
        throw new ContractValidationError(path, 'ação interna precisa ser sem efeito e de classe interna');
    }
    return {
        actionId: nonEmptyString(input.actionId, `${path}.actionId`),
        scope,
        ...(resourceRef === undefined ? {} : { resourceRef }),
        operation: uniqueStrings([input.operation], `${path}.operation`, { min: 1, max: 1, pattern: OPERATION })[0],
        effectMode,
        ...(effectKey === undefined ? {} : { effectKey }),
        effectClass,
        riskLevel: oneOf(input.riskLevel, `${path}.riskLevel`, AUTHORITY_RISKS),
        requestedControls: uniqueStrings(input.requestedControls, `${path}.requestedControls`, {
            max: 8,
            allowed: AUTHORITY_CONTROLS
        })
    };
}
export function parseAuthorityEnvelope(value) {
    const input = closedRecord(value, 'authorityEnvelope', [
        'requestRef',
        'ceiling',
        'actions',
        'maximumRisk',
        'triggeredBoundaries'
    ]);
    const actions = array(input.actions, 'authorityEnvelope.actions', { min: 1, max: 256 })
        .map((action, index) => parseAction(action, `authorityEnvelope.actions[${index}]`));
    const actionIds = actions.map((action) => action.actionId);
    if (new Set(actionIds).size !== actionIds.length) {
        throw new ContractValidationError('authorityEnvelope.actions', 'actionId duplicado');
    }
    const requestRef = input.requestRef === undefined
        ? undefined
        : nonEmptyString(input.requestRef, 'authorityEnvelope.requestRef');
    return {
        ...(requestRef === undefined ? {} : { requestRef }),
        ceiling: parseCeiling(input.ceiling, 'authorityEnvelope.ceiling'),
        actions,
        maximumRisk: oneOf(input.maximumRisk, 'authorityEnvelope.maximumRisk', AUTHORITY_RISKS),
        triggeredBoundaries: uniqueStrings(input.triggeredBoundaries, 'authorityEnvelope.triggeredBoundaries', {
            max: 8,
            allowed: AUTHORITY_BOUNDARIES
        })
    };
}
