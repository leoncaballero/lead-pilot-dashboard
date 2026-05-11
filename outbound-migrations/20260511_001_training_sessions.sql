-- ============================================================
-- Setting Pilot — AI Coach (training sessions)
-- Ejecutar en Supabase OUTBOUND (mazhrnqztnjvppgbltuq).
-- Idempotente.
-- ============================================================

-- Una sesión de entrenamiento es un chat persistente atado a una combinación
-- (prompt_type, segmento, turn_type). El usuario va nutriendo la conversación
-- con ejemplos, feedback e imágenes; cuando quiere, "aplica" la sesión y se
-- genera una nueva versión del prompt usando todo el contexto acumulado.

CREATE TABLE IF NOT EXISTS cl001_p007_training_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  prompt_type text NOT NULL CHECK (prompt_type IN ('classifier','generator','validator')),
  segmento text NOT NULL CHECK (segmento IN ('MEGA','Genesis','Prosperitas','Polaris')),
  turn_type text NOT NULL,

  -- Conversación: array de mensajes [{role, content, attachments?, ts}]
  -- attachments: [{type: 'image', media_type, data_base64}] | [{type: 'text', name, content}]
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Tokens acumulados de Anthropic
  total_input_tokens integer NOT NULL DEFAULT 0,
  total_output_tokens integer NOT NULL DEFAULT 0,

  -- Si se aplicó a un prompt → referencia a la versión generada
  applied_to_version_id uuid NULL REFERENCES cl001_p007_prompt_versions(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cl001_p007_training_sessions_combo_idx
  ON cl001_p007_training_sessions (prompt_type, segmento, turn_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS cl001_p007_training_sessions_updated_idx
  ON cl001_p007_training_sessions (updated_at DESC);
