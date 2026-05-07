-- ============================================================
-- Setting Pilot — Estrategias de FU configurables
-- Ejecutar en Supabase OUTBOUND (mazhrnqztnjvppgbltuq).
-- Idempotente.
-- ============================================================

-- 1) Tabla cl001_p007_strategies
-- Cada estrategia es un set de offsets para los 3 niveles de follow-up (post Turn 1).
-- Solo una activa por segmento a la vez.
CREATE TABLE IF NOT EXISTS cl001_p007_strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  segmento text NOT NULL CHECK (segmento IN ('MEGA','Genesis','Prosperitas','Polaris')),

  -- Follow-up 1 (default 4h después de enviar Turn 1)
  fu1_enabled boolean NOT NULL DEFAULT true,
  fu1_offset_hours numeric NOT NULL DEFAULT 4,

  -- Follow-up 2 (default 24h)
  fu2_enabled boolean NOT NULL DEFAULT true,
  fu2_offset_hours numeric NOT NULL DEFAULT 24,

  -- Follow-up 3 (default 72h = 3 días)
  fu3_enabled boolean NOT NULL DEFAULT true,
  fu3_offset_hours numeric NOT NULL DEFAULT 72,

  is_active boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Solo una estrategia activa por segmento
CREATE UNIQUE INDEX IF NOT EXISTS cl001_p007_strategies_active_per_segment
  ON cl001_p007_strategies (segmento)
  WHERE is_active = true;

-- 2) Columna strategy_id en pipeline (para sellar la estrategia al crear el lead)
-- Nullable: leads existentes quedan en NULL → workflows usan fallback (4h/24h/72h hardcoded)
ALTER TABLE cl001_p007_turn1_pipeline
  ADD COLUMN IF NOT EXISTS strategy_id uuid NULL REFERENCES cl001_p007_strategies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS cl001_p007_turn1_pipeline_strategy_idx
  ON cl001_p007_turn1_pipeline (strategy_id) WHERE strategy_id IS NOT NULL;

-- 3) Seed: una estrategia "default" por cada segmento, espejando el comportamiento actual
INSERT INTO cl001_p007_strategies (name, description, segmento, fu1_enabled, fu1_offset_hours, fu2_enabled, fu2_offset_hours, fu3_enabled, fu3_offset_hours, is_active)
VALUES
  ('Default — 4h/24h/3d', 'Cadencia original: FU a las 4h, 24h y 3d post Turn 1.', 'MEGA',        true, 4, true, 24, true, 72, true),
  ('Default — 4h/24h/3d', 'Cadencia original: FU a las 4h, 24h y 3d post Turn 1.', 'Genesis',     true, 4, true, 24, true, 72, true),
  ('Default — 4h/24h/3d', 'Cadencia original: FU a las 4h, 24h y 3d post Turn 1.', 'Prosperitas', true, 4, true, 24, true, 72, true),
  ('Default — 4h/24h/3d', 'Cadencia original: FU a las 4h, 24h y 3d post Turn 1.', 'Polaris',     true, 4, true, 24, true, 72, true)
ON CONFLICT DO NOTHING;
