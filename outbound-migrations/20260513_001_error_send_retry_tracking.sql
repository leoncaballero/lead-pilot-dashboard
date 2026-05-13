-- 2026-05-13: tracking de reintentos automáticos para status='error_send'
--
-- WF08 (RAVhnYHki4LmCUle) corre cada 5 minutos y reintenta los envíos que
-- quedaron en error_send. Necesitamos columnas para:
--   - contar cuántos reintentos lleva (max 3 antes de claudicar)
--   - cuándo fue el último reintento (debounce: no retry < 5 min después del anterior)
--   - cuándo se envió alerta a Slack (idempotencia: una alerta por fallo final)
--
-- Flujo:
--   1) status=error_send se setea por el sender cuando Smartlead rechaza el envío
--   2) WF08 busca cada 5min rows con retry_count < 3 y last_retry > 5min atrás
--   3) Por cada uno: PATCH retry_count+1, last_retry=now y POST al webhook turn1-send-from-lovable
--   4) Si el envío vuelve a fallar, retry_count sube hasta 3
--   5) Cuando retry_count>=3 y status sigue siendo error_send y alerted_at IS NULL,
--      WF08 envía Slack alert + setea alerted_at=now (no se vuelve a alertar)
--
-- Ya aplicado en producción vía PostgREST + service_role. Este archivo es solo
-- para tener referencia histórica del cambio.

ALTER TABLE cl001_p007_turn1_pipeline
  ADD COLUMN IF NOT EXISTS error_send_retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_send_last_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS error_send_alerted_at timestamptz;

-- Index parcial para acelerar el filtro del cron: solo rows en error_send que
-- todavía no han agotado reintentos. El cron se ejecuta cada 5 min, así que
-- el lookup tiene que ser O(1).
CREATE INDEX IF NOT EXISTS idx_pipeline_error_send_retriable
  ON cl001_p007_turn1_pipeline (error_send_last_retry_at)
  WHERE status = 'error_send' AND error_send_retry_count < 3;
