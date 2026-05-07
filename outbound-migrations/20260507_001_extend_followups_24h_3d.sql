-- ============================================================
-- Setting Pilot — Extender follow-ups: añadir FU 24h y FU 3d
-- ============================================================
-- Cambios:
-- 1. Añade columna fu_3d_sent_at en cl001_p007_turn1_pipeline
--    (fu_4h_sent_at y fu_24h_sent_at ya existen del migration 001)
-- 2. Extiende el CHECK de turn_type en cl001_p007_prompt_versions
--    para incluir 'follow_up_24h' y 'follow_up_3d'
-- 3. Extiende el CHECK de turn_type en cl001_p007_turn1_pipeline (si lo tiene)
--    para incluir los nuevos turn_types
--
-- Idempotente: usa IF NOT EXISTS donde se puede, DROP+ADD constraint donde no.
-- ============================================================

-- 1. Columna fu_3d_sent_at
ALTER TABLE cl001_p007_turn1_pipeline
  ADD COLUMN IF NOT EXISTS fu_3d_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_pipeline_fu3d_pending
  ON cl001_p007_turn1_pipeline (sent_at, fu_3d_sent_at)
  WHERE status = 'sent' AND fu_3d_sent_at IS NULL;


-- 2. Extender turn_type CHECK en prompt_versions
DO $migration$
DECLARE con_name text;
BEGIN
  -- Buscar el constraint actual
  SELECT conname INTO con_name FROM pg_constraint
    WHERE conrelid = 'cl001_p007_prompt_versions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%turn_type%'
      AND pg_get_constraintdef(oid) ILIKE '%follow_up_4h%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE cl001_p007_prompt_versions DROP CONSTRAINT %I', con_name);
  END IF;
END $migration$;

ALTER TABLE cl001_p007_prompt_versions
  DROP CONSTRAINT IF EXISTS cl001_p007_prompt_versions_turn_type_check;

ALTER TABLE cl001_p007_prompt_versions
  ADD CONSTRAINT cl001_p007_prompt_versions_turn_type_check
  CHECK (turn_type IN (
    'turn1',
    'turn2_generic',
    'turn3_generic',
    'follow_up_4h',
    'follow_up_24h',
    'follow_up_3d',
    'objection_response',
    'booking_propose'
  ));


-- 3. Extender turn_type CHECK en pipeline (si el migration 001 lo creó)
DO $migration$
DECLARE con_name text;
BEGIN
  SELECT conname INTO con_name FROM pg_constraint
    WHERE conrelid = 'cl001_p007_turn1_pipeline'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%turn_type%'
      AND pg_get_constraintdef(oid) ILIKE '%follow_up_4h%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE cl001_p007_turn1_pipeline DROP CONSTRAINT %I', con_name);
  END IF;
END $migration$;

-- (Re-)añadir el constraint con los nuevos turn_types
ALTER TABLE cl001_p007_turn1_pipeline
  DROP CONSTRAINT IF EXISTS cl001_p007_turn1_pipeline_turn_type_check;

ALTER TABLE cl001_p007_turn1_pipeline
  ADD CONSTRAINT cl001_p007_turn1_pipeline_turn_type_check
  CHECK (turn_type IS NULL OR turn_type IN (
    'turn1',
    'turn2_generic',
    'turn3_generic',
    'follow_up_4h',
    'follow_up_24h',
    'follow_up_3d',
    'objection_response',
    'booking_propose'
  ));


-- ============================================================
-- VERIFICACIÓN
-- ============================================================
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'cl001_p007_turn1_pipeline'
  AND column_name IN ('fu_4h_sent_at', 'fu_24h_sent_at', 'fu_3d_sent_at')
ORDER BY column_name;

SELECT pg_get_constraintdef(oid) AS turn_type_check
FROM pg_constraint
WHERE conrelid = 'cl001_p007_prompt_versions'::regclass
  AND contype = 'c'
  AND pg_get_constraintdef(oid) ILIKE '%turn_type%';

SELECT pg_get_constraintdef(oid) AS pipeline_turn_type_check
FROM pg_constraint
WHERE conrelid = 'cl001_p007_turn1_pipeline'::regclass
  AND contype = 'c'
  AND pg_get_constraintdef(oid) ILIKE '%turn_type%';
