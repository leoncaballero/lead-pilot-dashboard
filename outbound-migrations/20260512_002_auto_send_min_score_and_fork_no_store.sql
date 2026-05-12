-- 2026-05-12: rollout progresivo de auto-send para MEGA no_store
--
-- Cambios:
--   1. Nueva columna auto_send_min_score en prompt_versions. Era hardcoded a 95
--      en el WF02 v2 "Compute final status". Llevándolo a la versión permite
--      bajar/subir el threshold desde la UI sin tocar n8n. Default 95 (status quo).
--   2. Forkamos las versiones ACTIVAS MEGA generator/validator/classifier de
--      subgroup=NULL a subgroup='no_store' con contenido idéntico. Así podemos:
--        - mantener el bucket no_store independiente (auto-send sólo aquí)
--        - dejar el bucket has_store y los MEGA legacy en la versión NULL
--          (full review humano)
--      El routing del WF02 v2 ya prioriza el subgroup específico antes que el
--      catch-all NULL, así que en cuanto exista una versión no_store activa los
--      leads MEGA sin tienda caerán ahí automáticamente.
--      Inicialmente las forks salen con auto_send_enabled=false (status quo
--      sigue siendo "humano revisa todo") — el toggle se activa desde la UI
--      cuando León dé luz verde.

ALTER TABLE cl001_p007_prompt_versions
  ADD COLUMN IF NOT EXISTS auto_send_min_score integer NOT NULL DEFAULT 95;

ALTER TABLE cl001_p007_prompt_versions
  DROP CONSTRAINT IF EXISTS cl001_p007_prompt_versions_auto_send_min_score_check;
ALTER TABLE cl001_p007_prompt_versions
  ADD CONSTRAINT cl001_p007_prompt_versions_auto_send_min_score_check
  CHECK (auto_send_min_score >= 0 AND auto_send_min_score <= 100);

-- La unique constraint legacy no incluye subgroup, así que impedía forkar
-- (generator, MEGA, turn1, v1.2) con subgroup='no_store' cuando ya existe la
-- versión con subgroup=NULL. Lógicamente la "misma iteración" puede aplicarse
-- a subgrupos distintos, así que extendemos la clave con subgroup.
ALTER TABLE cl001_p007_prompt_versions
  DROP CONSTRAINT IF EXISTS cl001_p007_prompt_versions_unique_v2;
ALTER TABLE cl001_p007_prompt_versions
  ADD CONSTRAINT cl001_p007_prompt_versions_unique_v3
  UNIQUE NULLS NOT DISTINCT (prompt_type, segmento, turn_type, subgroup, version);
-- NULLS NOT DISTINCT (PG15+) hace que (… , NULL, v1.0) colisione con (… , NULL, v1.0)
-- como sería de esperar. Sin esto, la unicidad para subgroup=NULL se rompe.

-- Fork: para cada versión activa MEGA con subgroup NULL en
-- (generator, validator, classifier), crear su gemela en subgroup='no_store'
-- si todavía no existe. Reusa exactamente prompt_system, model, params, etc.
INSERT INTO cl001_p007_prompt_versions (
  prompt_type, segmento, turn_type, subgroup, version,
  prompt_system, model, temperature, max_tokens,
  is_active, auto_send_enabled, auto_send_min_score, traffic_weight,
  description, notes, created_by
)
SELECT
  src.prompt_type, src.segmento, src.turn_type,
  'no_store' AS subgroup,
  src.version,
  src.prompt_system, src.model, src.temperature, src.max_tokens,
  true  AS is_active,
  false AS auto_send_enabled,     -- arrancamos OFF; se activa desde UI cuando se aprueba el primer batch
  95    AS auto_send_min_score,   -- threshold inicial igual al hardcoded antiguo
  100   AS traffic_weight,
  COALESCE(src.description, '') || ' [fork no_store]' AS description,
  '[2026-05-12] Fork de subgroup=NULL para rollout progresivo de auto-send en MEGA sin tienda. Contenido idéntico al padre.' AS notes,
  NULL AS created_by  -- fork system-side, sin usuario asociado
FROM cl001_p007_prompt_versions src
WHERE src.segmento = 'MEGA'
  AND src.subgroup IS NULL
  AND src.is_active = true
  AND src.prompt_type IN ('generator', 'validator', 'classifier')
  AND src.turn_type = 'turn1'
  AND NOT EXISTS (
    SELECT 1 FROM cl001_p007_prompt_versions tgt
    WHERE tgt.prompt_type = src.prompt_type
      AND tgt.segmento = 'MEGA'
      AND tgt.subgroup = 'no_store'
      AND tgt.turn_type = src.turn_type
      AND tgt.is_active = true
  );
