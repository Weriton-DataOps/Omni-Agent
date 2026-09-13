-- Dedicated Omni PostgreSQL only. Sanitized operational-learning ledger; raw conversation and tool output are forbidden.
-- psql: ON_ERROR_STOP=1 and migration_checksum=SHA256 of this exact file.
BEGIN;
SELECT pg_advisory_xact_lock(724189304);
SELECT set_config('omni.migration_checksum', :'migration_checksum', true);

DO $migration$
DECLARE previous_checksum text;
BEGIN
  SELECT checksum INTO previous_checksum FROM omni_meta.schema_migrations WHERE id = '004-operational-learning-ledger';
  IF previous_checksum IS NOT NULL THEN
    IF previous_checksum <> current_setting('omni.migration_checksum') THEN RAISE EXCEPTION 'Migration checksum changed'; END IF;
    RETURN;
  END IF;

  CREATE SCHEMA learning AUTHORIZATION omni_schema_owner;
  REVOKE ALL ON SCHEMA learning FROM PUBLIC;
  GRANT USAGE ON SCHEMA learning TO omni_operations_runtime;

  CREATE TABLE learning.improvement_findings (
    owner_id uuid NOT NULL,
    finding_id text NOT NULL CHECK (finding_id ~ '^improvement-[a-zA-Z0-9-]{1,160}$'),
    candidate_fingerprint text NOT NULL CHECK (candidate_fingerprint ~ '^[a-f0-9]{64}$'),
    category text NOT NULL CHECK (category ~ '^[a-z][a-z0-9-]{1,79}$'),
    destination text NOT NULL CHECK (destination IN ('operational-rule', 'procedure', 'routing', 'hook', 'runtime-fix', 'personality', 'eval', 'capability')),
    state text NOT NULL CHECK (state IN ('observing', 'ready', 'implementation-required', 'materialized-pending-release', 'installed-verified', 'loaded-verified', 'superseded')),
    occurrences integer NOT NULL CHECK (occurrences BETWEEN 1 AND 1000000),
    statement_fingerprint text NOT NULL CHECK (statement_fingerprint ~ '^[a-f0-9]{64}$'),
    source_fingerprint text NOT NULL CHECK (source_fingerprint ~ '^[a-f0-9]{64}$'),
    artifact_fingerprint text CHECK (artifact_fingerprint ~ '^[a-f0-9]{64}$'),
    release_version text CHECK (release_version ~ '^v?[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$'),
    first_observed_at timestamptz NOT NULL,
    last_observed_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (owner_id, finding_id),
    CHECK (last_observed_at >= first_observed_at)
  );
  ALTER TABLE learning.improvement_findings OWNER TO omni_schema_owner;
  ALTER TABLE learning.improvement_findings ENABLE ROW LEVEL SECURITY;
  ALTER TABLE learning.improvement_findings FORCE ROW LEVEL SECURITY;
  CREATE POLICY own_improvement_findings ON learning.improvement_findings USING (owner_id = identity.owner_id()) WITH CHECK (owner_id = identity.owner_id());
  CREATE INDEX improvement_findings_state_idx ON learning.improvement_findings (owner_id, state, last_observed_at DESC);

  CREATE TABLE learning.improvement_events (
    owner_id uuid NOT NULL,
    event_id text NOT NULL CHECK (event_id ~ '^learning-event-[a-f0-9]{24,64}$'),
    finding_id text NOT NULL,
    observed_at timestamptz NOT NULL,
    state text NOT NULL CHECK (state IN ('observing', 'ready', 'implementation-required', 'materialized-pending-release', 'installed-verified', 'loaded-verified', 'superseded')),
    occurrences integer NOT NULL CHECK (occurrences BETWEEN 1 AND 1000000),
    source_fingerprint text NOT NULL CHECK (source_fingerprint ~ '^[a-f0-9]{64}$'),
    artifact_fingerprint text CHECK (artifact_fingerprint ~ '^[a-f0-9]{64}$'),
    release_version text CHECK (release_version ~ '^v?[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$'),
    PRIMARY KEY (owner_id, event_id),
    FOREIGN KEY (owner_id, finding_id) REFERENCES learning.improvement_findings (owner_id, finding_id)
  );
  ALTER TABLE learning.improvement_events OWNER TO omni_schema_owner;
  ALTER TABLE learning.improvement_events ENABLE ROW LEVEL SECURITY;
  ALTER TABLE learning.improvement_events FORCE ROW LEVEL SECURITY;
  CREATE POLICY own_improvement_events ON learning.improvement_events USING (owner_id = identity.owner_id()) WITH CHECK (owner_id = identity.owner_id());
  CREATE INDEX improvement_events_finding_idx ON learning.improvement_events (owner_id, finding_id, observed_at DESC);

  CREATE FUNCTION learning.record_improvement_finding(p_finding jsonb)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, identity, learning
  AS $function$
  DECLARE
    v_owner uuid := identity.owner_id();
    v_event_id text := p_finding->>'eventId';
    v_finding_id text := p_finding->>'findingId';
    v_candidate_fingerprint text := p_finding->>'candidateFingerprint';
    v_category text := p_finding->>'category';
    v_destination text := p_finding->>'destination';
    v_state text := p_finding->>'state';
    v_occurrences integer := (p_finding->>'occurrences')::integer;
    v_statement_fingerprint text := p_finding->>'statementFingerprint';
    v_source_fingerprint text := p_finding->>'sourceFingerprint';
    v_artifact_fingerprint text := NULLIF(p_finding->>'artifactFingerprint', '');
    v_release_version text := NULLIF(p_finding->>'releaseVersion', '');
    v_observed_at timestamptz := (p_finding->>'observedAt')::timestamptz;
  BEGIN
    IF v_event_id !~ '^learning-event-[a-f0-9]{24,64}$'
      OR v_finding_id !~ '^improvement-[a-zA-Z0-9-]{1,160}$'
      OR v_candidate_fingerprint !~ '^[a-f0-9]{64}$'
      OR v_category !~ '^[a-z][a-z0-9-]{1,79}$'
      OR v_destination NOT IN ('operational-rule', 'procedure', 'routing', 'hook', 'runtime-fix', 'personality', 'eval', 'capability')
      OR v_state NOT IN ('observing', 'ready', 'implementation-required', 'materialized-pending-release', 'installed-verified', 'loaded-verified', 'superseded')
      OR v_occurrences IS NULL OR v_occurrences NOT BETWEEN 1 AND 1000000
      OR v_statement_fingerprint !~ '^[a-f0-9]{64}$'
      OR v_source_fingerprint !~ '^[a-f0-9]{64}$'
      OR (v_artifact_fingerprint IS NOT NULL AND v_artifact_fingerprint !~ '^[a-f0-9]{64}$')
      OR (v_release_version IS NOT NULL AND v_release_version !~ '^v?[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$')
      OR v_observed_at IS NULL
    THEN RAISE EXCEPTION 'Invalid sanitized operational learning finding'; END IF;

    IF EXISTS (SELECT 1 FROM learning.improvement_events WHERE owner_id = v_owner AND event_id = v_event_id) THEN
      RETURN jsonb_build_object('outcome', 'duplicate');
    END IF;

    INSERT INTO learning.improvement_findings (
      owner_id, finding_id, candidate_fingerprint, category, destination, state, occurrences,
      statement_fingerprint, source_fingerprint, artifact_fingerprint, release_version,
      first_observed_at, last_observed_at
    ) VALUES (
      v_owner, v_finding_id, v_candidate_fingerprint, v_category, v_destination, v_state, v_occurrences,
      v_statement_fingerprint, v_source_fingerprint, v_artifact_fingerprint, v_release_version,
      v_observed_at, v_observed_at
    ) ON CONFLICT (owner_id, finding_id) DO UPDATE SET
      candidate_fingerprint = EXCLUDED.candidate_fingerprint,
      category = EXCLUDED.category,
      destination = EXCLUDED.destination,
      state = EXCLUDED.state,
      occurrences = EXCLUDED.occurrences,
      statement_fingerprint = EXCLUDED.statement_fingerprint,
      source_fingerprint = EXCLUDED.source_fingerprint,
      artifact_fingerprint = EXCLUDED.artifact_fingerprint,
      release_version = EXCLUDED.release_version,
      last_observed_at = EXCLUDED.last_observed_at,
      updated_at = clock_timestamp()
    WHERE learning.improvement_findings.last_observed_at <= EXCLUDED.last_observed_at;

    INSERT INTO learning.improvement_events (
      owner_id, event_id, finding_id, observed_at, state, occurrences, source_fingerprint, artifact_fingerprint, release_version
    ) VALUES (
      v_owner, v_event_id, v_finding_id, v_observed_at, v_state, v_occurrences, v_source_fingerprint, v_artifact_fingerprint, v_release_version
    );
    RETURN jsonb_build_object('outcome', 'recorded');
  END
  $function$;
  ALTER FUNCTION learning.record_improvement_finding(jsonb) OWNER TO omni_schema_owner;
  REVOKE ALL ON FUNCTION learning.record_improvement_finding(jsonb) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION learning.record_improvement_finding(jsonb) TO omni_operations_runtime;
  INSERT INTO omni_meta.schema_migrations (id, checksum) VALUES ('004-operational-learning-ledger', current_setting('omni.migration_checksum'));
END
$migration$;
COMMIT;
