-- ============================================================
-- Setting Pilot — Extender cl001_p007_turn1_pipeline para soportar Turn N
-- Cambio aditivo, no destructivo. Todos los rows existentes mantienen
-- turn_number=1, turn_type='turn1', previous_turn_id=NULL.
--
-- Ejecutar en Supabase SQL Editor del proyecto outbound (mazhrnqztnjvppgbltuq).
-- ============================================================

-- 1. Añadir columnas con defaults (no rompe nada)
ALTER TABLE cl001_p007_turn1_pipeline
  ADD COLUMN IF NOT EXISTS turn_number     int          NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS turn_type       text         NOT NULL DEFAULT 'turn1',
  ADD COLUMN IF NOT EXISTS previous_turn_id uuid        REFERENCES cl001_p007_turn1_pipeline(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fu_4h_sent_at   timestamptz,
  ADD COLUMN IF NOT EXISTS fu_24h_sent_at  timestamptz;

-- 2. Check constraint para turn_type (ampliable después)
DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'cl001_p007_turn1_pipeline'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%turn_type%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE cl001_p007_turn1_pipeline DROP CONSTRAINT %I', constraint_name);
  END IF;
  ALTER TABLE cl001_p007_turn1_pipeline
    ADD CONSTRAINT cl001_p007_turn1_pipeline_turn_type_check
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
END $$;

-- 3. Índice para queries de "siguiente turn" y "FU pending"
CREATE INDEX IF NOT EXISTS idx_pipeline_turn_lookup
  ON cl001_p007_turn1_pipeline (smartlead_lead_id, turn_number DESC);

CREATE INDEX IF NOT EXISTS idx_pipeline_fu_pending
  ON cl001_p007_turn1_pipeline (status, sent_at)
  WHERE status IN ('sent', 'dry_run_only')
    AND fu_4h_sent_at IS NULL;

-- 4. UNIQUE constraint para idempotencia (issue identificado en auditoría):
-- evita duplicados si Smartlead reenvía el mismo webhook
DO $$
DECLARE constraint_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'cl001_p007_turn1_pipeline'::regclass
      AND conname = 'cl001_p007_turn1_pipeline_unique_turn'
  ) INTO constraint_exists;

  IF NOT constraint_exists THEN
    -- Solo añade si no había duplicados previos. Si los había, fallaría aquí
    -- (intencionalmente, para no esconder bugs de duplicación existentes).
    ALTER TABLE cl001_p007_turn1_pipeline
      ADD CONSTRAINT cl001_p007_turn1_pipeline_unique_turn
      UNIQUE (smartlead_lead_id, turn_number);
  END IF;
END $$;

-- 5. Verificación
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'cl001_p007_turn1_pipeline'
  AND column_name IN ('turn_number', 'turn_type', 'previous_turn_id', 'fu_4h_sent_at', 'fu_24h_sent_at')
ORDER BY ordinal_position;

SELECT turn_type, turn_number, COUNT(*)
FROM cl001_p007_turn1_pipeline
GROUP BY turn_type, turn_number
ORDER BY turn_number, turn_type;
