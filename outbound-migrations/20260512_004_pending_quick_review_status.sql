-- 2026-05-12: añade pending_quick_review al constraint de status del pipeline
--
-- Este status nuevo es para los casos que el WF02 v2 detecta como aptos para
-- auto-send (MEGA sin tienda, score>=90, sin errores críticos) pero antes de
-- activar auto-send full queremos un quick-gate humano: el operador da Sí/No
-- desde /auto-send-monitor. NO entran a /triage por defecto.
--
-- Ya aplicado en producción vía Management API (DDL). Este archivo es solo
-- para tener referencia histórica del cambio.

ALTER TABLE cl001_p007_turn1_pipeline
  DROP CONSTRAINT IF EXISTS cl001_p007_turn1_pipeline_status_check;

ALTER TABLE cl001_p007_turn1_pipeline
  ADD CONSTRAINT cl001_p007_turn1_pipeline_status_check
  CHECK (status IS NULL OR status = ANY (ARRAY[
    'pending_classification',
    'pending_review',
    'pending_quick_review',  -- NUEVO: esperando Sí/No del operador en /auto-send-monitor
    'needs_deep_review',
    'ready_to_send',
    'sending',
    'sent',
    'fu_4h_sent',
    'auto_rejected',
    'rejected',
    'error_generation',
    'error_send',
    'dry_run_only'
  ]));
