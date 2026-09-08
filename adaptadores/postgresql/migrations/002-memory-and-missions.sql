-- Dedicated Omni PostgreSQL only. Applies durable two-layer memory and mission records.
-- psql: ON_ERROR_STOP=1 and migration_checksum=SHA256 of this exact file.
BEGIN;
SELECT pg_advisory_xact_lock(724189302);
SELECT set_config('omni.migration_checksum', :'migration_checksum', true);

DO $migration$
DECLARE previous_checksum text;
BEGIN
  SELECT checksum INTO previous_checksum FROM omni_meta.schema_migrations WHERE id = '002-memory-and-missions';
  IF previous_checksum IS NOT NULL THEN
    IF previous_checksum <> current_setting('omni.migration_checksum') THEN RAISE EXCEPTION 'Migration checksum changed'; END IF;
    RETURN;
  END IF;

  CREATE TABLE memory.entries (
    owner_id uuid NOT NULL,
    memory_id text NOT NULL CHECK (memory_id ~ '^mem-[a-zA-Z0-9-]{1,160}$'),
    lane text NOT NULL CHECK (lane IN ('confirmed', 'candidate', 'archive')),
    memory_type text NOT NULL CHECK (memory_type IN ('preference', 'episodic', 'semantic', 'procedural', 'objective', 'capability')),
    scope_type text NOT NULL CHECK (scope_type IN ('user', 'project', 'task', 'environment')),
    scope_id text,
    project_id text,
    text_fingerprint text NOT NULL CHECK (text_fingerprint ~ '^[a-f0-9]{64}$'),
    payload jsonb NOT NULL,
    source_updated_at timestamptz NOT NULL,
    imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
    PRIMARY KEY (owner_id, memory_id),
    CHECK ((scope_type = 'user' AND scope_id IS NULL AND project_id IS NULL) OR (scope_type <> 'user' AND scope_id IS NOT NULL)),
    CHECK ((scope_type = 'project' AND project_id = scope_id) OR scope_type <> 'project')
  );
  ALTER TABLE memory.entries OWNER TO omni_schema_owner;
  ALTER TABLE memory.entries ENABLE ROW LEVEL SECURITY;
  ALTER TABLE memory.entries FORCE ROW LEVEL SECURITY;
  CREATE POLICY own_memory_entries ON memory.entries USING (owner_id = identity.owner_id()) WITH CHECK (owner_id = identity.owner_id());
  CREATE INDEX memory_entries_retrieval_idx ON memory.entries (owner_id, lane, memory_type, source_updated_at DESC);
  GRANT SELECT, INSERT, UPDATE (lane, memory_type, scope_type, scope_id, project_id, text_fingerprint, payload, source_updated_at, imported_at, revision)
    ON memory.entries TO omni_memory_runtime;

  CREATE TABLE memory.import_receipts (
    owner_id uuid NOT NULL,
    import_id text NOT NULL CHECK (import_id ~ '^memory-import-[a-zA-Z0-9-]{1,160}$'),
    source_fingerprint text NOT NULL CHECK (source_fingerprint ~ '^[a-f0-9]{64}$'),
    imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    result text NOT NULL CHECK (result IN ('applied', 'duplicate')),
    PRIMARY KEY (owner_id, import_id)
  );
  ALTER TABLE memory.import_receipts OWNER TO omni_schema_owner;
  ALTER TABLE memory.import_receipts ENABLE ROW LEVEL SECURITY;
  ALTER TABLE memory.import_receipts FORCE ROW LEVEL SECURITY;
  CREATE POLICY own_memory_import_receipts ON memory.import_receipts USING (owner_id = identity.owner_id()) WITH CHECK (owner_id = identity.owner_id());
  GRANT SELECT, INSERT ON memory.import_receipts TO omni_memory_runtime;

  CREATE TABLE operations.missions (
    owner_id uuid NOT NULL,
    mission_id text NOT NULL CHECK (mission_id ~ '^mission-[a-zA-Z0-9-]{1,160}$'),
    objective text NOT NULL CHECK (char_length(objective) BETWEEN 3 AND 800),
    state text NOT NULL CHECK (state IN ('open', 'in-progress', 'blocked', 'completed', 'cancelled')),
    priority smallint NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
    payload jsonb NOT NULL,
    version bigint NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 9007199254740991),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    closed_at timestamptz,
    PRIMARY KEY (owner_id, mission_id),
    CHECK ((state IN ('completed', 'cancelled')) = (closed_at IS NOT NULL))
  );
  ALTER TABLE operations.missions OWNER TO omni_schema_owner;
  ALTER TABLE operations.missions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE operations.missions FORCE ROW LEVEL SECURITY;
  CREATE POLICY own_missions ON operations.missions USING (owner_id = identity.owner_id()) WITH CHECK (owner_id = identity.owner_id());
  CREATE INDEX missions_active_idx ON operations.missions (owner_id, state, priority DESC, updated_at DESC);
  GRANT SELECT, INSERT, UPDATE (objective, state, priority, payload, version, updated_at, closed_at) ON operations.missions TO omni_operations_runtime;

  CREATE TABLE operations.mission_events (
    owner_id uuid NOT NULL,
    event_id text NOT NULL CHECK (event_id ~ '^mission-event-[a-zA-Z0-9-]{1,160}$'),
    mission_id text NOT NULL,
    observed_at timestamptz NOT NULL,
    kind text NOT NULL CHECK (kind IN ('created', 'updated', 'blocked', 'resumed', 'completed', 'cancelled', 'reconciled')),
    payload jsonb NOT NULL,
    PRIMARY KEY (owner_id, event_id),
    FOREIGN KEY (owner_id, mission_id) REFERENCES operations.missions (owner_id, mission_id)
  );
  ALTER TABLE operations.mission_events OWNER TO omni_schema_owner;
  ALTER TABLE operations.mission_events ENABLE ROW LEVEL SECURITY;
  ALTER TABLE operations.mission_events FORCE ROW LEVEL SECURITY;
  CREATE POLICY own_mission_events ON operations.mission_events USING (owner_id = identity.owner_id()) WITH CHECK (owner_id = identity.owner_id());
  GRANT SELECT, INSERT ON operations.mission_events TO omni_operations_runtime;

  GRANT omni_memory_runtime, omni_operations_runtime TO omni_access_broker;
  INSERT INTO omni_meta.schema_migrations (id, checksum) VALUES ('002-memory-and-missions', current_setting('omni.migration_checksum'));
END
$migration$;
COMMIT;
