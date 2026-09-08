import { parseAuthorityEnvelope } from '../contracts/authority-envelope.js';
import { evaluateAuthority } from '../core/authority/evaluate.js';
import { systemClock } from '../ports/clock.js';
export class AuthorityService {
    clock;
    constructor(clock = systemClock) {
        this.clock = clock;
    }
    evaluate(input) {
        return evaluateAuthority(parseAuthorityEnvelope(input), this.clock.now());
    }
}
export function evaluateAuthorityEnvelope(input, options = {}) {
    const at = options.at ?? new Date();
    return new AuthorityService({ now: () => at }).evaluate(input);
}
export const avaliarEnvelopeAutoridade = evaluateAuthorityEnvelope;
