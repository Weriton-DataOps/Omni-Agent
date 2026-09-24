-- Dedicated Omni PostgreSQL only. Adds the time axis to missions: due, scheduled and last movement.
-- psql: ON_ERROR_STOP=1 and migration_checksum=SHA256 of this exact file.
BEGIN;
SELECT pg_advisory_xact_lock(724189305);
SELECT set_config('omni.migration_checksum', :'migration_checksum', true);

DO $migration$
DECLARE previous_checksum text;
BEGIN
  SELECT checksum INTO previous_checksum FROM omni_meta.schema_migrations WHERE id = '005-mission-time-axis';
  IF previous_checksum IS NOT NULL THEN
    IF previous_checksum <> current_setting('omni.migration_checksum') THEN RAISE EXCEPTION 'Migration checksum changed'; END IF;
    RETURN;
  END IF;

  -- due_at: prazo declarado. scheduled_at: quando o proprietario planeja tocar.
  -- last_movement_at: ultima evidencia de avanco; base do aging ("parado ha N dias").
  ALTER TABLE operations.missions ADD COLUMN due_at timestamptz;
  ALTER TABLE operations.missions ADD COLUMN scheduled_at timestamptz;
  ALTER TABLE operations.missions ADD COLUMN last_movement_at timestamptz;
  UPDATE operations.missions SET last_movement_at = updated_at WHERE last_movement_at IS NULL;
  ALTER TABLE operations.missions ALTER COLUMN last_movement_at SET DEFAULT clock_timestamp();
  ALTER TABLE operations.missions ADD CONSTRAINT missions_scheduled_before_due
    CHECK (scheduled_at IS NULL OR due_at IS NULL OR scheduled_at <= due_at);

  -- Prazo e agendamento: proximos alvos das missoes abertas.
  CREATE INDEX missions_due_idx ON operations.missions (owner_id, due_at)
    WHERE closed_at IS NULL AND due_at IS NOT NULL;
  CREATE INDEX missions_scheduled_idx ON operations.missions (owner_id, scheduled_at)
    WHERE closed_at IS NULL AND scheduled_at IS NOT NULL;
  -- Aging: missoes abertas ordenadas pela ultima movimentacao (ideia morrendo).
  CREATE INDEX missions_aging_idx ON operations.missions (owner_id, last_movement_at)
    WHERE closed_at IS NULL;

  GRANT UPDATE (due_at, scheduled_at, last_movement_at) ON operations.missions TO omni_operations_runtime;
  INSERT INTO omni_meta.schema_migrations (id, checksum) VALUES ('005-mission-time-axis', current_setting('omni.migration_checksum'));
END
$migration$;
COMMIT;
