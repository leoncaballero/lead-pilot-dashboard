-- ============================================================
-- Setting Pilot — Extender follow-ups: añadir FU 24h y FU 3d
-- ============================================================
-- Cambios:
-- 1. Añade columna fu_3d_sent_at en cl001_p007_turn1_pipeline
--    (fu_4h_sent_at y fu_24h_sent_at ya existen del migration 20260506_001)
-- 2. Extiende el CHECK de turn_type en cl001_p007_prompt_versions
--    para incluir los nuevos turn_types
-- 3. Extiende el CHECK de turn_type en cl001_p007_turn1_pipeline
--
-- Idempotente: usa IF NOT EXISTS / IF EXISTS / DROP+ADD según corresponda.
-- ============================================================

-- 1. Columna fu_3d_sent_at + index parcial
ALTER TABLE cl001_p007_turn1_pipeline
  ADD COLUMN IF NOT EXISTS fu_3d_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_pipeline_fu3d_pending
  ON cl001_p007_turn1_pipeline (sent_at, fu_3d_sent_at)
  WHERE status = 'sent' AND fu_3d_sent_at IS NULL;


-- 2. Extender turn_type CHECK en prompt_versions
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


-- 3. Extender turn_type CHECK en pipeline
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
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'cl001_p007_turn1_pipeline'
  AND column_name IN ('fu_4h_sent_at', 'fu_24h_sent_at', 'fu_3d_sent_at')
ORDER BY column_name;
