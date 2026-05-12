-- 2026-05-12: tracking de bookings con atribución y meeting_start_time
--
-- Por qué:
--   El WF04 detectaba como 'booked' solo meetings creadas DESPUÉS del sent_at.
--   Si un lead ya tenía meeting agendada antes (otro canal, otro SDR, etc) o
--   agendó por un canal externo, era invisible. Esto mezclaba dos cosas:
--     (1) la métrica del A/B (¿el prompt funcionó?)
--     (2) la realidad operativa (¿este lead ya tiene reunión pendiente?)
--
-- Cambios:
--   1. Añadimos 'booked_other' al constraint de outcome. Significa "tiene
--      meeting asociada pero NO es atribuíble al outbound de este pipeline".
--   2. Añadimos meeting_start_time como columna explícita (en lugar de leer
--      details->>'meeting_start_time') para poder filtrar "futuras" en SQL
--      sin parsear JSON. Se rellena solo para outcomes 'booked' y 'booked_other'.
--   3. Índice para queries "tiene meeting futura" sobre un set de pipelines.

ALTER TABLE cl001_p007_outcomes
  DROP CONSTRAINT IF EXISTS cl001_p007_outcomes_outcome_check;

ALTER TABLE cl001_p007_outcomes
  ADD CONSTRAINT cl001_p007_outcomes_outcome_check
  CHECK (outcome = ANY (ARRAY[
    'replied'::text,
    'booked'::text,
    'booked_other'::text,
    'rescheduled'::text,
    'no_show'::text,
    'attended'::text,
    'closed_won'::text,
    'closed_lost'::text,
    'unsubscribe'::text,
    'bounce'::text,
    'do_not_contact'::text
  ]));

ALTER TABLE cl001_p007_outcomes
  ADD COLUMN IF NOT EXISTS meeting_start_time timestamptz NULL;

CREATE INDEX IF NOT EXISTS cl001_p007_outcomes_meeting_start_time_idx
  ON cl001_p007_outcomes (meeting_start_time)
  WHERE outcome IN ('booked', 'booked_other');
