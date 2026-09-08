export const AUTHORITY_CONTROLS = [
    'checkpoint-before-mutation',
    'verify-after-effect',
    'reconcile-before-retry',
    'revocation-check-before-effect',
    'sanitize-output',
    'no-secret-materialization'
];
export const AUTHORITY_RISKS = ['low', 'medium', 'high', 'critical'];
export const AUTHORITY_BOUNDARIES = [
    'destructive',
    'irreversible',
    'financial',
    'privilege-expansion',
    'external-publication',
    'secret-access'
];
