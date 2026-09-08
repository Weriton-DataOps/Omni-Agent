import authorizationDecisionV1 from './authorization-decision-v1.schema.json' with { type: 'json' };
import authorizationRequestV1 from './authorization-request-v1.schema.json' with { type: 'json' };
export { authorizationDecisionV1, authorizationRequestV1 };
export const authorizationContractProvenance = {
    capturedAt: '2026-08-31',
    upstreamRepository: 'Overcore',
    upstreamRequestPath: 'contratos/authorization-request.schema.json',
    upstreamDecisionPath: 'contratos/authorization-decision.schema.json',
    upstreamRequestSchemaSha256: 'sha256:77175cc0858550268a1a37854b88b8dc9a0baa39140671394b6359f06a72b4ae',
    upstreamDecisionSchemaSha256: 'sha256:37be6e95b3a58044bbf8b4614f2c1f5d4faf962c1289d3a08a4dfcfc47abb55c',
    requestSchemaSha256: 'sha256:0289ed8e713cbb1d8a9e143c5c6fa164fc98c824353a75ab6fc46a8258ab3e99',
    decisionSchemaSha256: 'sha256:5e8b0827ee35377395dda872bde8d1794672a90329f20dc4f57c148b81e617a5',
    generation: 'generated contract tables plus dependency-free decoder, verified against schemas by parity tests'
};
