// Gerado por scripts/generate-authority-contract.mjs. Não edite manualmente.
export const authorizationContractV1 = {
  "requestSchemaSha256": "sha256:0289ed8e713cbb1d8a9e143c5c6fa164fc98c824353a75ab6fc46a8258ab3e99",
  "decisionSchemaSha256": "sha256:5e8b0827ee35377395dda872bde8d1794672a90329f20dc4f57c148b81e617a5",
  "requestKeys": [
    "contractVersion",
    "authorizationRequestId",
    "createdAt",
    "requester",
    "authorityProvider",
    "requestBinding",
    "planBinding",
    "authorityCeiling",
    "actions",
    "riskSummary",
    "authorizationRequestFingerprint"
  ],
  "actionKeys": [
    "actionId",
    "stepRef",
    "position",
    "scope",
    "resourceRef",
    "operation",
    "effectMode",
    "effectKey",
    "effectClass",
    "riskLevel",
    "requestedControls"
  ],
  "identifierPattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$",
  "operationPattern": "^[a-z][a-z0-9]*(?:[.-][a-z][a-z0-9]*)+$",
  "effectKeyPattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]{7,255}$",
  "controls": [
    "checkpoint-before-mutation",
    "verify-after-effect",
    "reconcile-before-retry",
    "revocation-check-before-effect",
    "sanitize-output",
    "no-secret-materialization"
  ],
  "boundaries": [
    "destructive",
    "irreversible",
    "financial",
    "privilege-expansion",
    "external-publication",
    "secret-access"
  ],
  "risks": [
    "low",
    "medium",
    "high",
    "critical"
  ],
  "effectClasses": [
    "runtime-internal",
    "read-only",
    "reversible-change",
    "irreversible-change",
    "external-publication",
    "financial",
    "privilege-change",
    "secret-access"
  ]
} as const
