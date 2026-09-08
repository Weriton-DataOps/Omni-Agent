-- Run only through an authorized migration identity in the dedicated omni database.
-- psql: ON_ERROR_STOP=1 and migration_checksum=SHA256 of this exact file.
BEGIN;
SELECT pg_advisory_xact_lock(724189301);
DO $guard$
BEGIN
  IF current_database() <> 'omni' THEN RAISE EXCEPTION 'Dedicated omni database required'; END IF;
END
$guard$;
SELECT set_config('omni.migration_checksum', :'migration_checksum', true);
CREATE SCHEMA IF NOT EXISTS omni_meta;
REVOKE ALL ON SCHEMA omni_meta FROM PUBLIC;
CREATE TABLE IF NOT EXISTS omni_meta.schema_migrations (
  id text PRIMARY KEY, checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON omni_meta.schema_migrations FROM PUBLIC;

DO $migration$
DECLARE previous_checksum text; role_name text;
BEGIN
  SELECT checksum INTO previous_checksum FROM omni_meta.schema_migrations WHERE id = '001-access-foundation';
  IF previous_checksum IS NOT NULL THEN
    IF previous_checksum <> current_setting('omni.migration_checksum') THEN RAISE EXCEPTION 'Migration checksum changed'; END IF;
    RETURN;
  END IF;
  -- Never take over pre-existing roles/schemas: provisioner must resolve a collision explicitly.
  FOREACH role_name IN ARRAY ARRAY['omni_schema_owner', 'omni_memory_runtime', 'omni_access_runtime', 'omni_access_admin', 'omni_operations_runtime'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN RAISE EXCEPTION 'Omni role already exists before first migration'; END IF;
    EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS', role_name);
  END LOOP;
  CREATE SCHEMA identity AUTHORIZATION omni_schema_owner;
  CREATE SCHEMA memory AUTHORIZATION omni_schema_owner;
  CREATE SCHEMA operations AUTHORIZATION omni_schema_owner;
  CREATE SCHEMA access AUTHORIZATION omni_schema_owner;
  CREATE SCHEMA audit AUTHORIZATION omni_schema_owner;
  REVOKE ALL ON SCHEMA identity, memory, operations, access, audit FROM PUBLIC;

  -- Bootstrap/admin binds a dedicated authenticated DB login to an owner. A client cannot SET a custom GUC to impersonate one.
  CREATE TABLE identity.login_owners (login_name name PRIMARY KEY, owner_id uuid NOT NULL);
  ALTER TABLE identity.login_owners OWNER TO omni_schema_owner;
  CREATE FUNCTION identity.owner_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
    AS $function$ SELECT owner_id FROM identity.login_owners WHERE login_name = session_user $function$;
  ALTER FUNCTION identity.owner_id() OWNER TO omni_schema_owner;
  REVOKE ALL ON FUNCTION identity.owner_id() FROM PUBLIC;
  GRANT USAGE ON SCHEMA identity TO omni_memory_runtime, omni_access_runtime, omni_access_admin, omni_operations_runtime;
  GRANT EXECUTE ON FUNCTION identity.owner_id() TO omni_memory_runtime, omni_access_runtime, omni_access_admin, omni_operations_runtime;
  GRANT USAGE ON SCHEMA memory TO omni_memory_runtime;
  GRANT USAGE ON SCHEMA operations TO omni_operations_runtime;
  GRANT USAGE ON SCHEMA access, audit TO omni_access_runtime, omni_access_admin;

  CREATE TABLE access.credential_versions (
    owner_id uuid NOT NULL, credential_id text NOT NULL CHECK (credential_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$'),
    version bigint NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
    provider_ref text NOT NULL, account_ref text NOT NULL, environment_ref text NOT NULL,
    secret_ref text NOT NULL CHECK (secret_ref ~ '^credential-ref:[a-zA-Z0-9._:-]{1,140}$'),
    issued_at timestamptz, expires_at timestamptz,
    expiry_kind text NOT NULL CHECK (expiry_kind IN ('known', 'non_expiring', 'unknown')),
    expiry_source text NOT NULL CHECK (expiry_source IN ('provider', 'owner-attestation', 'unknown')),
    status text NOT NULL CHECK (status IN ('unverified', 'active', 'expired', 'suspect', 'invalid', 'revoked', 'disabled', 'replaced')),
    status_changed_at timestamptz NOT NULL,
    last_checked_at timestamptz, last_success_at timestamptz, unusable_since timestamptz,
    last_failure_at timestamptz, failure_code text, evidence_ref text,
    revoked_at timestamptz, replaced_by_id text,
    renewal_mode text NOT NULL CHECK (renewal_mode IN ('none', 'refresh', 'rotate', 'reauthenticate')),
    renew_before_seconds integer NOT NULL DEFAULT 0 CHECK (renew_before_seconds BETWEEN 0 AND 31536000),
    next_check_at timestamptz, next_retry_at timestamptz,
    PRIMARY KEY (owner_id, credential_id, version),
    CHECK ((expiry_kind = 'known') = (expires_at IS NOT NULL)),
    CHECK (expiry_kind = 'unknown' OR expiry_source <> 'unknown'),
    CHECK (issued_at IS NULL OR expires_at IS NULL OR expires_at > issued_at),
    CHECK (status <> 'active' OR last_success_at IS NOT NULL),
    CHECK (status <> 'revoked' OR revoked_at IS NOT NULL),
    CHECK (status <> 'replaced' OR (replaced_by_id IS NOT NULL AND replaced_by_id <> credential_id)),
    CHECK (failure_code IS NULL OR failure_code IN ('invalid-token', 'revoked', 'insufficient-scope', 'timeout', 'unavailable', 'rate-limited', 'reported-not-working', 'disabled', 'replaced')),
    CHECK (provider_ref ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$' AND account_ref ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$' AND environment_ref ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$'),
    CHECK (evidence_ref IS NULL OR evidence_ref ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$'),
    CHECK (replaced_by_id IS NULL OR replaced_by_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$')
  );
  ALTER TABLE access.credential_versions OWNER TO omni_schema_owner;
  ALTER TABLE access.credential_versions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE access.credential_versions FORCE ROW LEVEL SECURITY;
  CREATE POLICY own_credentials ON access.credential_versions USING (owner_id = identity.owner_id()) WITH CHECK (owner_id = identity.owner_id());
  GRANT SELECT ON access.credential_versions TO omni_access_runtime, omni_access_admin;
  GRANT INSERT, UPDATE ON access.credential_versions TO omni_access_admin;
  -- Runtime does not create identities, rotate secrets or change expiration; the trusted admin path does that.
  GRANT UPDATE (revision, status, status_changed_at, last_checked_at, last_success_at, unusable_since, last_failure_at, failure_code, evidence_ref, revoked_at, next_check_at, next_retry_at)
    ON access.credential_versions TO omni_access_runtime;

  CREATE TABLE audit.credential_events (
    owner_id uuid NOT NULL, event_id text NOT NULL CHECK (event_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$'), credential_id text NOT NULL, version bigint NOT NULL,
    observed_at timestamptz NOT NULL, kind text NOT NULL,
    evidence_ref text NOT NULL CHECK (evidence_ref ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$'),
    outcome text NOT NULL CHECK (outcome IN ('applied', 'stale', 'conflict')),
    PRIMARY KEY (owner_id, event_id),
    FOREIGN KEY (owner_id, credential_id, version) REFERENCES access.credential_versions (owner_id, credential_id, version),
    CHECK (kind IN ('authenticated', 'invalid-token', 'revoked', 'insufficient-scope', 'timeout', 'unavailable', 'rate-limited', 'reported-not-working', 'disabled', 'replaced'))
  );
  ALTER TABLE audit.credential_events OWNER TO omni_schema_owner;
  ALTER TABLE audit.credential_events ENABLE ROW LEVEL SECURITY;
  ALTER TABLE audit.credential_events FORCE ROW LEVEL SECURITY;
  CREATE POLICY own_credential_events ON audit.credential_events USING (owner_id = identity.owner_id()) WITH CHECK (owner_id = identity.owner_id());
  GRANT SELECT, INSERT ON audit.credential_events TO omni_access_runtime, omni_access_admin;

  -- No application role is a schema owner, can grant authority, or receives a password here.
  REVOKE ALL ON identity.login_owners FROM PUBLIC, omni_memory_runtime, omni_access_runtime, omni_access_admin, omni_operations_runtime;
  ALTER DEFAULT PRIVILEGES FOR ROLE omni_schema_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
  INSERT INTO omni_meta.schema_migrations (id, checksum) VALUES ('001-access-foundation', current_setting('omni.migration_checksum'));
END
$migration$;
COMMIT;
