import { parseAuthorityEnvelope } from '../../contracts/authority-envelope.js';
import { ContractValidationError, array, closedRecord, dateTime, integer, matchingString, oneOf, uniqueStrings } from '../../contracts/validation.js';
import {} from '../../core/authority/types.js';
import { canonicalJson } from '../../core/shared/json.js';
import { NodeDocumentFingerprinter } from '../node/node-document-fingerprinter.js';
import { AuthorityService } from '../../application/evaluate-authority.js';
import { authorizationContractV1 } from './generated/authorization-contract-v1.js';
const IDENTIFIER = new RegExp(authorizationContractV1.identifierPattern);
const OPERATION = new RegExp(authorizationContractV1.operationPattern);
const EFFECT_KEY = new RegExp(authorizationContractV1.effectKeyPattern);
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const EFFECT_CLASSES = authorizationContractV1.effectClasses;
function identifier(value, path) {
    return matchingString(value, path, IDENTIFIER);
}
function parseFingerprint(value, path) {
    const input = closedRecord(value, path, ['algorithm', 'value']);
    if (input.algorithm !== 'sha256-jcs-v1') {
        throw new ContractValidationError(`${path}.algorithm`, 'algoritmo desconhecido');
    }
    return {
        algorithm: 'sha256-jcs-v1',
        value: matchingString(input.value, `${path}.value`, SHA256)
    };
}
function parseRequestBinding(value) {
    const input = closedRecord(value, 'authorizationRequest.requestBinding', [
        'requestId',
        'requestFingerprint',
        'clientId'
    ]);
    return {
        requestId: identifier(input.requestId, 'authorizationRequest.requestBinding.requestId'),
        requestFingerprint: parseFingerprint(input.requestFingerprint, 'authorizationRequest.requestBinding.requestFingerprint'),
        clientId: identifier(input.clientId, 'authorizationRequest.requestBinding.clientId')
    };
}
function parsePlanBinding(value) {
    const input = closedRecord(value, 'authorizationRequest.planBinding', [
        'planId',
        'planRevision',
        'planFingerprint',
        'strategyFingerprint'
    ]);
    return {
        planId: identifier(input.planId, 'authorizationRequest.planBinding.planId'),
        planRevision: integer(input.planRevision, 'authorizationRequest.planBinding.planRevision', { min: 1, max: 20 }),
        planFingerprint: parseFingerprint(input.planFingerprint, 'authorizationRequest.planBinding.planFingerprint'),
        strategyFingerprint: parseFingerprint(input.strategyFingerprint, 'authorizationRequest.planBinding.strategyFingerprint')
    };
}
function parseExternalAction(value, index) {
    const path = `authorizationRequest.actions[${index}]`;
    const input = closedRecord(value, path, authorizationContractV1.actionKeys);
    identifier(input.stepRef, `${path}.stepRef`);
    integer(input.position, `${path}.position`, { min: 1, max: 256 });
    const scope = oneOf(input.scope, `${path}.scope`, ['request-resource', 'runtime-internal']);
    const effectMode = oneOf(input.effectMode, `${path}.effectMode`, ['none', 'journaled']);
    const effectClass = oneOf(input.effectClass, `${path}.effectClass`, EFFECT_CLASSES);
    const resourceRef = input.resourceRef === undefined ? undefined : identifier(input.resourceRef, `${path}.resourceRef`);
    const effectKey = input.effectKey === undefined
        ? undefined
        : matchingString(input.effectKey, `${path}.effectKey`, EFFECT_KEY);
    if (scope === 'request-resource' && resourceRef === undefined) {
        throw new ContractValidationError(`${path}.resourceRef`, 'obrigatório para recurso solicitado');
    }
    if (scope === 'runtime-internal' && resourceRef !== undefined) {
        throw new ContractValidationError(`${path}.resourceRef`, 'não permitido para ação interna');
    }
    if (scope === 'runtime-internal' && (effectMode !== 'none' || effectClass !== 'runtime-internal')) {
        throw new ContractValidationError(path, 'ação interna precisa ser sem efeito e de classe interna');
    }
    if ((effectMode === 'journaled') !== (effectKey !== undefined)) {
        throw new ContractValidationError(`${path}.effectKey`, 'precisa existir exatamente para efeito journaled');
    }
    return {
        actionId: identifier(input.actionId, `${path}.actionId`),
        scope,
        ...(resourceRef === undefined ? {} : { resourceRef }),
        operation: matchingString(input.operation, `${path}.operation`, OPERATION),
        effectMode,
        ...(effectKey === undefined ? {} : { effectKey }),
        effectClass,
        riskLevel: oneOf(input.riskLevel, `${path}.riskLevel`, authorizationContractV1.risks),
        requestedControls: uniqueStrings(input.requestedControls, `${path}.requestedControls`, {
            max: 8,
            allowed: authorizationContractV1.controls
        })
    };
}
function parseCeiling(value) {
    const path = 'authorizationRequest.authorityCeiling';
    const input = closedRecord(value, path, ['mode', 'grants', 'expansionBoundaries', 'expiresAt']);
    if (input.mode !== 'proceed-within-scope') {
        throw new ContractValidationError(`${path}.mode`, 'modo de autoridade desconhecido');
    }
    const grants = array(input.grants, `${path}.grants`, { max: 64 }).map((value, index) => {
        const grantPath = `${path}.grants[${index}]`;
        const grant = closedRecord(value, grantPath, ['resourceRef', 'operations']);
        return {
            resourceRef: identifier(grant.resourceRef, `${grantPath}.resourceRef`),
            operations: uniqueStrings(grant.operations, `${grantPath}.operations`, {
                min: 1,
                max: 64,
                pattern: OPERATION
            })
        };
    });
    const expansionBoundaries = uniqueStrings(input.expansionBoundaries, `${path}.expansionBoundaries`, {
        max: 8,
        allowed: authorizationContractV1.boundaries
    });
    return {
        mode: 'proceed-within-scope',
        grants,
        expansionBoundaries,
        ...(input.expiresAt === undefined ? {} : { expiresAt: dateTime(input.expiresAt, `${path}.expiresAt`) })
    };
}
function assertRequestFingerprint(input, fingerprinter) {
    const declared = parseFingerprint(input.authorizationRequestFingerprint, 'authorizationRequest.authorizationRequestFingerprint');
    const basis = structuredClone(input);
    delete basis.authorizationRequestFingerprint;
    if (canonicalJson(declared) !== canonicalJson(fingerprinter.fingerprint(basis))) {
        throw new ContractValidationError('authorizationRequest.authorizationRequestFingerprint', 'fingerprint nao corresponde ao conteúdo');
    }
}
function parseAuthorizationRequest(value, fingerprinter) {
    const input = closedRecord(value, 'authorizationRequest', authorizationContractV1.requestKeys);
    if (input.contractVersion !== '1.0') {
        throw new ContractValidationError('authorizationRequest.contractVersion', 'versão desconhecida');
    }
    dateTime(input.createdAt, 'authorizationRequest.createdAt');
    const requester = closedRecord(input.requester, 'authorizationRequest.requester', ['id', 'kind']);
    if (requester.kind !== 'execution-environment') {
        throw new ContractValidationError('authorizationRequest.requester.kind', 'tipo de solicitante inválido');
    }
    const provider = closedRecord(input.authorityProvider, 'authorizationRequest.authorityProvider', ['id', 'kind']);
    if (provider.id !== 'omni-authority-provider' || provider.kind !== 'assistant') {
        throw new ContractValidationError('authorizationRequest.authorityProvider', 'pedido destinado a outro provedor');
    }
    assertRequestFingerprint(input, fingerprinter);
    const actions = array(input.actions, 'authorizationRequest.actions', { min: 1, max: 256 })
        .map((action, index) => parseExternalAction(action, index));
    const actionIds = actions.map((action) => action.actionId);
    if (new Set(actionIds).size !== actionIds.length) {
        throw new ContractValidationError('authorizationRequest.actions', 'actionId duplicado');
    }
    const risk = closedRecord(input.riskSummary, 'authorizationRequest.riskSummary', [
        'maximumRisk',
        'triggeredBoundaries',
        'requestResourceActionCount',
        'journaledEffectCount'
    ]);
    const requestResourceActionCount = integer(risk.requestResourceActionCount, 'authorizationRequest.riskSummary.requestResourceActionCount', { min: 0, max: 256 });
    const journaledEffectCount = integer(risk.journaledEffectCount, 'authorizationRequest.riskSummary.journaledEffectCount', { min: 0, max: 256 });
    if (requestResourceActionCount !== actions.filter((action) => action.scope === 'request-resource').length) {
        throw new ContractValidationError('authorizationRequest.riskSummary.requestResourceActionCount', 'contagem diverge das ações');
    }
    if (journaledEffectCount !== actions.filter((action) => action.effectMode === 'journaled').length) {
        throw new ContractValidationError('authorizationRequest.riskSummary.journaledEffectCount', 'contagem diverge das ações');
    }
    const authorizationRequestId = identifier(input.authorizationRequestId, 'authorizationRequest.authorizationRequestId');
    const envelope = parseAuthorityEnvelope({
        requestRef: authorizationRequestId,
        ceiling: parseCeiling(input.authorityCeiling),
        actions,
        maximumRisk: oneOf(risk.maximumRisk, 'authorizationRequest.riskSummary.maximumRisk', authorizationContractV1.risks),
        triggeredBoundaries: uniqueStrings(risk.triggeredBoundaries, 'authorizationRequest.riskSummary.triggeredBoundaries', { max: 8, allowed: authorizationContractV1.boundaries })
    });
    return {
        authorizationRequestId,
        requesterId: identifier(requester.id, 'authorizationRequest.requester.id'),
        requestBinding: parseRequestBinding(input.requestBinding),
        planBinding: parsePlanBinding(input.planBinding),
        envelope
    };
}
function parseEffectRevalidation(value, fingerprinter) {
    const input = closedRecord(value, 'effectRevalidation', ['contractVersion', 'authorizationRequest', 'effect']);
    if (input.contractVersion !== '1.0') {
        throw new ContractValidationError('effectRevalidation.contractVersion', 'versao desconhecida');
    }
    const effect = closedRecord(input.effect, 'effectRevalidation.effect', [
        'actionId', 'effectKey', 'resourceRef', 'operation'
    ]);
    const parsed = {
        actionId: identifier(effect.actionId, 'effectRevalidation.effect.actionId'),
        effectKey: matchingString(effect.effectKey, 'effectRevalidation.effect.effectKey', EFFECT_KEY),
        resourceRef: identifier(effect.resourceRef, 'effectRevalidation.effect.resourceRef'),
        operation: matchingString(effect.operation, 'effectRevalidation.effect.operation', OPERATION)
    };
    const request = parseAuthorizationRequest(input.authorizationRequest, fingerprinter);
    const action = request.envelope.actions.find((candidate) => candidate.actionId === parsed.actionId);
    if (action === undefined ||
        action.scope !== 'request-resource' ||
        action.effectMode !== 'journaled' ||
        action.effectClass !== 'reversible-change' ||
        action.effectKey !== parsed.effectKey ||
        action.resourceRef !== parsed.resourceRef ||
        action.operation !== parsed.operation) {
        throw new ContractValidationError('effectRevalidation.effect', 'efeito nao corresponde a uma acao reversivel autorizavel');
    }
    return { request, effect: parsed };
}
export class OvercoreAuthorityAdapter {
    evaluator;
    fingerprinter;
    constructor(evaluator, fingerprinter) {
        this.evaluator = evaluator;
        this.fingerprinter = fingerprinter;
    }
    evaluate(input) {
        const request = parseAuthorizationRequest(input, this.fingerprinter);
        const evaluation = this.evaluator.evaluate(request.envelope);
        const base = {
            contractVersion: '1.0',
            decisionId: this.fingerprinter.stableId('authdec', request.authorizationRequestId),
            authorizationRequestId: request.authorizationRequestId,
            issuedAt: evaluation.limits.notBefore,
            issuer: {
                providerId: 'omni-authority-provider',
                providerKind: 'assistant',
                authorityBasisRef: 'omni-owner-authority-v1'
            },
            audience: {
                executionEnvironmentId: request.requesterId,
                kind: 'execution-environment'
            },
            requestBinding: request.requestBinding,
            planBinding: request.planBinding,
            outcome: evaluation.outcome,
            actionDecisions: evaluation.actionDecisions,
            limits: evaluation.limits,
            revocation: {
                mode: 'check-before-journaled-effect',
                statusRef: this.fingerprinter.stableId('revocation-status', request.authorizationRequestId),
                failMode: 'fail-closed'
            },
            attestationRef: this.fingerprinter.stableId('attestation-omni-local', request.authorizationRequestId)
        };
        return { ...base, decisionFingerprint: this.fingerprinter.fingerprint(base) };
    }
    revalidateEffect(input) {
        const revalidation = parseEffectRevalidation(input, this.fingerprinter);
        const evaluation = this.evaluator.evaluate(revalidation.request.envelope);
        const actionDecision = evaluation.actionDecisions.find((item) => item.actionId === revalidation.effect.actionId);
        const active = evaluation.outcome !== 'deny' && actionDecision?.outcome === 'permit';
        const base = {
            contractVersion: '1.0',
            revalidationId: this.fingerprinter.stableId('effect-revalidation', `${revalidation.request.authorizationRequestId}:${revalidation.effect.effectKey}:${evaluation.limits.notBefore}`),
            checkedAt: evaluation.limits.notBefore,
            status: active ? 'active' : 'revoked',
            reasonCode: active
                ? 'within-delegated-authority'
                : actionDecision?.reasonCode ?? 'plan-mismatch',
            authorizationRequestId: revalidation.request.authorizationRequestId,
            requestBinding: revalidation.request.requestBinding,
            effectBinding: revalidation.effect
        };
        return { ...base, evidenceFingerprint: this.fingerprinter.fingerprint(base) };
    }
}
export function evaluateOvercoreAuthorizationRequest(input, options = {}) {
    const at = options.at ?? new Date();
    return new OvercoreAuthorityAdapter(new AuthorityService({ now: () => at }), new NodeDocumentFingerprinter()).evaluate(input);
}
export const avaliarPedidoOvercore = evaluateOvercoreAuthorizationRequest;
