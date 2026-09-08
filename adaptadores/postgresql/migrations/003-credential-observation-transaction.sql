-- Dedicated Omni PostgreSQL only. Atomic, audited credential-observation transition.
-- psql: ON_ERROR_STOP=1 and migration_checksum=SHA256 of this exact file.
BEGIN;
SELECT pg_advisory_xact_lock(724189303);
SELECT set_config('omni.migration_checksum', :'migration_checksum', true);

DO $migration$
DECLARE previous_checksum text;
BEGIN
  SELECT checksum INTO previous_checksum FROM omni_meta.schema_migrations WHERE id = '003-credential-observation-transaction';
  IF previous_checksum IS NOT NULL THEN
    IF previous_checksum <> current_setting('omni.migration_checksum') THEN RAISE EXCEPTION 'Migration checksum changed'; END IF;
    RETURN;
  END IF;

  CREATE FUNCTION access.record_credential_observation(p_event jsonb, p_expected_revision bigint)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, identity, access, audit
  AS $function$
  DECLARE
    v_owner uuid := identity.owner_id();
    v_row access.credential_versions%ROWTYPE;
    v_event_id text := p_event->>'eventId';
    v_credential_id text := p_event->>'credentialId';
    v_version bigint := (p_event->>'version')::bigint;
    v_provider_ref text := p_event->>'providerRef';
    v_account_ref text := p_event->>'accountRef';
    v_environment_ref text := p_event->>'environmentRef';
    v_started_at timestamptz := (p_event->>'startedAt')::timestamptz;
    v_completed_at timestamptz := (p_event->>'completedAt')::timestamptz;
    v_kind text := p_event->>'kind';
    v_evidence_ref text := p_event->>'evidenceRef';
    v_replaced_by_id text := NULLIF(p_event->>'replacedById', '');
    v_status text;
    v_unusable_since timestamptz;
    v_revoked_at timestamptz;
    v_replaced_by text;
    v_is_failure boolean;
    v_is_newest_failure boolean;
    v_is_verification boolean;
    v_metadata jsonb;
  BEGIN
    IF p_expected_revision < 1 OR v_event_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$'
       OR v_credential_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$'
       OR v_version < 1 OR v_version > 9007199254740991
       OR v_provider_ref !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$'
       OR v_account_ref !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$'
       OR v_environment_ref !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$'
       OR v_evidence_ref !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$'
       OR v_kind NOT IN ('authenticated', 'invalid-token', 'revoked', 'insufficient-scope', 'timeout', 'unavailable', 'rate-limited', 'reported-not-working', 'disabled', 'replaced')
       OR v_started_at > v_completed_at
       OR (v_kind = 'replaced' AND (v_replaced_by_id IS NULL OR v_replaced_by_id = v_credential_id))
    THEN RAISE EXCEPTION 'Invalid credential observation'; END IF;

    SELECT * INTO v_row FROM access.credential_versions
      WHERE owner_id = v_owner AND credential_id = v_credential_id AND version = v_version FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'version-not-found'); END IF;

    IF EXISTS (SELECT 1 FROM audit.credential_events WHERE owner_id = v_owner AND event_id = v_event_id) THEN
      SELECT jsonb_build_object(
        'credentialId', credential_id, 'version', version, 'revision', revision, 'providerRef', provider_ref, 'accountRef', account_ref, 'environmentRef', environment_ref, 'secretRef', secret_ref,
        'issuedAt', issued_at, 'expiryKind', expiry_kind, 'expirySource', expiry_source, 'expiresAt', expires_at, 'status', status, 'statusChangedAt', status_changed_at,
        'lastCheckedAt', last_checked_at, 'lastSuccessAt', last_success_at, 'unusableSince', unusable_since, 'lastFailureAt', last_failure_at, 'failureCode', failure_code, 'evidenceRef', evidence_ref,
        'revokedAt', revoked_at, 'replacedById', replaced_by_id, 'renewalMode', renewal_mode, 'renewBeforeSeconds', renew_before_seconds, 'nextCheckAt', next_check_at, 'nextRetryAt', next_retry_at
      ) INTO v_metadata FROM access.credential_versions WHERE owner_id = v_owner AND credential_id = v_credential_id AND version = v_version;
      RETURN jsonb_build_object('outcome', 'duplicate', 'credential', v_metadata);
    END IF;

    IF v_row.revision <> p_expected_revision THEN
      INSERT INTO audit.credential_events (owner_id, event_id, credential_id, version, observed_at, kind, evidence_ref, outcome)
        VALUES (v_owner, v_event_id, v_credential_id, v_version, v_completed_at, v_kind, v_evidence_ref, 'conflict');
      RETURN jsonb_build_object('outcome', 'conflict');
    END IF;
    IF v_row.provider_ref <> v_provider_ref OR v_row.account_ref <> v_account_ref OR v_row.environment_ref <> v_environment_ref THEN
      RAISE EXCEPTION 'Credential observation target mismatch';
    END IF;

    v_status := v_row.status; v_unusable_since := v_row.unusable_since; v_revoked_at := v_row.revoked_at; v_replaced_by := v_row.replaced_by_id;
    IF v_status NOT IN ('revoked', 'disabled', 'replaced') THEN
      IF v_kind = 'revoked' THEN v_status := 'revoked'; v_revoked_at := v_completed_at;
      ELSIF v_kind = 'disabled' THEN v_status := 'disabled';
      ELSIF v_kind = 'replaced' THEN v_status := 'replaced'; v_replaced_by := v_replaced_by_id;
      ELSIF v_kind = 'invalid-token' THEN v_status := 'invalid';
      ELSIF v_status NOT IN ('expired', 'invalid', 'revoked', 'disabled', 'replaced') AND v_started_at >= v_row.status_changed_at THEN
        IF v_kind = 'reported-not-working' THEN v_status := 'suspect';
        ELSIF v_kind = 'authenticated' THEN
          IF v_row.expires_at IS NOT NULL AND v_row.expires_at <= v_completed_at THEN v_status := 'expired'; ELSE v_status := 'active'; v_unusable_since := NULL; END IF;
        END IF;
      END IF;
    END IF;
    IF v_status IN ('expired', 'invalid', 'revoked', 'disabled', 'replaced', 'suspect') THEN v_unusable_since := COALESCE(v_unusable_since, v_completed_at); END IF;
    v_is_failure := v_kind <> 'authenticated';
    v_is_newest_failure := v_is_failure AND (v_row.last_failure_at IS NULL OR v_completed_at >= v_row.last_failure_at);
    v_is_verification := v_kind NOT IN ('reported-not-working', 'disabled', 'replaced');

    UPDATE access.credential_versions SET
      revision = v_row.revision + 1,
      status = v_status,
      status_changed_at = CASE WHEN v_status = v_row.status THEN v_row.status_changed_at ELSE GREATEST(v_row.status_changed_at, v_completed_at) END,
      unusable_since = v_unusable_since,
      revoked_at = v_revoked_at,
      replaced_by_id = v_replaced_by,
      last_checked_at = CASE WHEN v_is_verification THEN GREATEST(COALESCE(v_row.last_checked_at, v_completed_at), v_completed_at) ELSE v_row.last_checked_at END,
      last_success_at = CASE WHEN v_kind = 'authenticated' THEN GREATEST(COALESCE(v_row.last_success_at, v_completed_at), v_completed_at) ELSE v_row.last_success_at END,
      last_failure_at = CASE WHEN v_is_newest_failure THEN v_completed_at ELSE v_row.last_failure_at END,
      failure_code = CASE WHEN v_is_newest_failure THEN v_kind ELSE v_row.failure_code END,
      evidence_ref = CASE WHEN v_is_newest_failure OR v_row.evidence_ref IS NULL THEN v_evidence_ref ELSE v_row.evidence_ref END
      WHERE owner_id = v_owner AND credential_id = v_credential_id AND version = v_version;
    INSERT INTO audit.credential_events (owner_id, event_id, credential_id, version, observed_at, kind, evidence_ref, outcome)
      VALUES (v_owner, v_event_id, v_credential_id, v_version, v_completed_at, v_kind, v_evidence_ref, 'applied');
    SELECT jsonb_build_object(
      'credentialId', credential_id, 'version', version, 'revision', revision, 'providerRef', provider_ref, 'accountRef', account_ref, 'environmentRef', environment_ref, 'secretRef', secret_ref,
      'issuedAt', issued_at, 'expiryKind', expiry_kind, 'expirySource', expiry_source, 'expiresAt', expires_at, 'status', status, 'statusChangedAt', status_changed_at,
      'lastCheckedAt', last_checked_at, 'lastSuccessAt', last_success_at, 'unusableSince', unusable_since, 'lastFailureAt', last_failure_at, 'failureCode', failure_code, 'evidenceRef', evidence_ref,
      'revokedAt', revoked_at, 'replacedById', replaced_by_id, 'renewalMode', renewal_mode, 'renewBeforeSeconds', renew_before_seconds, 'nextCheckAt', next_check_at, 'nextRetryAt', next_retry_at
    ) INTO v_metadata FROM access.credential_versions WHERE owner_id = v_owner AND credential_id = v_credential_id AND version = v_version;
    RETURN jsonb_build_object('outcome', 'recorded', 'credential', v_metadata);
  END
  $function$;
  ALTER FUNCTION access.record_credential_observation(jsonb, bigint) OWNER TO omni_schema_owner;
  REVOKE ALL ON FUNCTION access.record_credential_observation(jsonb, bigint) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION access.record_credential_observation(jsonb, bigint) TO omni_access_admin;
  INSERT INTO omni_meta.schema_migrations (id, checksum) VALUES ('003-credential-observation-transaction', current_setting('omni.migration_checksum'));
END
$migration$;
COMMIT;
