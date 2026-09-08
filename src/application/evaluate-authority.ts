import { parseAuthorityEnvelope } from '../contracts/authority-envelope.js'
import { evaluateAuthority } from '../core/authority/evaluate.js'
import type { AuthorityEvaluation } from '../core/authority/types.js'
import type { AuthorityEvaluator } from '../ports/authority-evaluator.js'
import { systemClock, type Clock } from '../ports/clock.js'

export class AuthorityService implements AuthorityEvaluator {
  constructor(private readonly clock: Clock = systemClock) {}

  evaluate(input: unknown): AuthorityEvaluation {
    return evaluateAuthority(parseAuthorityEnvelope(input), this.clock.now())
  }
}

export function evaluateAuthorityEnvelope(
  input: unknown,
  options: { at?: Date } = {}
): AuthorityEvaluation {
  const at = options.at ?? new Date()
  return new AuthorityService({ now: () => at }).evaluate(input)
}

export const avaliarEnvelopeAutoridade = evaluateAuthorityEnvelope
