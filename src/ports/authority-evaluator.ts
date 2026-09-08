import type { AuthorityEvaluation } from '../core/authority/types.js'

export interface AuthorityEvaluator {
  evaluate(input: unknown): AuthorityEvaluation
}
