-- 2026-05-12: v1.3 del Generator MEGA turn1 — refuerzo regla de firma
--
-- Por qué:
--   Hoy el validator detectó 5+ casos con firma incorrecta:
--     setter input "Laura" → firmas generadas "Clara", "Nuria", "Andrea",
--     "Paula", "Leon". Causa: el modelo copia nombres de los EJEMPLOS del
--     prompt o del hilo previo (cold email original firmado por otra persona).
--
-- Cambio quirúrgico:
--   Solo la sección "8. NOMBRES Y FIRMAS" del prompt_system. Resto idéntico.
--   Forkamos las dos versiones activas (subgroup=NULL y subgroup='no_store'),
--   activamos las v1.3, desactivamos las v1.2.
--
-- IMPORTANTE: ejecutar en Supabase SQL Editor (dashboard.supabase.com)
-- porque el Management API tiene WAF que bloquea INSERTs con payload grande.

BEGIN;

-- Paso 1: insertar v1.3 con el prompt actualizado, una por subgroup activo
INSERT INTO cl001_p007_prompt_versions (
  prompt_type, segmento, turn_type, subgroup, version,
  prompt_system, model, temperature, max_tokens,
  is_active, auto_send_enabled, auto_send_min_score, traffic_weight,
  description, notes, created_by
)
SELECT
  src.prompt_type, src.segmento, src.turn_type, src.subgroup,
  'v1.3' AS version,
  -- Reemplazo de la sección 8 dentro del prompt_system. Si la sección antigua
  -- no aparece (porque ya se actualizó manualmente), no se modifica y la
  -- inserción simplemente clona el prompt actual sin cambios.
  replace(
    src.prompt_system,
    E'   FIRMA DEL SETTER:\n   - SIEMPRE debe coincidir con el setter real del hilo de Smartlead (campo del input).\n   - JAMÁS hardcodear un nombre (no usar "Laura" por defecto).\n   - Si el setter NO está identificado, NO firmar. Mejor sin firma que con firma incorrecta.\n   - Solo nombre de pila, guion simple delante.',
    E'   FIRMA DEL SETTER — REGLA ABSOLUTA E INVIOLABLE:\n   - La firma DEBE ser EXACTAMENTE el valor del campo `setter` del input del usuario.\n   - IGNORA cualquier nombre que aparezca en los EJEMPLOS de este prompt (Laura, Nuria, Clara, Andrea, Paula, Maria, Carmen, Miriam, etc.). Esos nombres son ilustrativos; NUNCA son la firma a usar.\n   - IGNORA cualquier nombre que aparezca en el HILO PREVIO de la conversación. El cold email original puede estar firmado por otra persona — ese NO es tu setter.\n   - IGNORA cualquier nombre del lead, del clasificador o de otros mensajes. Solo cuenta el campo `setter` del input.\n   - Si el campo `setter` del input NO está identificado (vacío, null), NO firmar. Mejor sin firma que con firma incorrecta.\n   - Solo nombre de pila, guion simple delante: `- {valor exacto de setter}`\n\n   ANTI-PATRÓN OBSERVADO EN PRODUCCIÓN (corregir antes de devolver el JSON):\n   ✗ input.setter="Laura" → firma generada "- Clara" / "- Nuria" / "- Andrea" / "- Paula" / "- Leon"\n      Causa: el modelo copió un nombre de los ejemplos del prompt o del hilo previo.\n      Corrección obligatoria: ANTES de emitir el JSON, verifica que la firma del turn_1 coincida EXACTAMENTE letra por letra con el campo `setter` del input. Si no coincide, reescríbela.\n   ✓ CORRECTO: si input.setter="Laura" → firma "- Laura". Si input.setter="Marta" → firma "- Marta". Si input.setter es null o vacío → SIN firma.'
  ) AS prompt_system,
  src.model, src.temperature, src.max_tokens,
  true  AS is_active,
  false AS auto_send_enabled,
  src.auto_send_min_score,
  src.traffic_weight,
  COALESCE(src.description, '') || ' [v1.3 firma blindada]',
  '[2026-05-12] v1.3 refuerza la regla de firma con anti-patrones observados en producción. El validator detectó 5+ casos hoy donde el modelo copiaba nombres de los ejemplos del prompt (Laura→Clara/Nuria/Andrea/Paula). Cambio quirúrgico solo en sección 8.',
  NULL::uuid
FROM cl001_p007_prompt_versions src
WHERE src.prompt_type = 'generator'
  AND src.segmento = 'MEGA'
  AND src.turn_type = 'turn1'
  AND src.version = 'v1.2'
  AND src.is_active = true;

-- Paso 2: desactivar las v1.2 correspondientes (para que el routing solo coja v1.3)
UPDATE cl001_p007_prompt_versions
SET is_active = false, updated_at = now()
WHERE prompt_type = 'generator'
  AND segmento = 'MEGA'
  AND turn_type = 'turn1'
  AND version = 'v1.2'
  AND is_active = true;

-- Paso 3: verificar
SELECT segmento, subgroup, version, is_active, length(prompt_system) AS len
FROM cl001_p007_prompt_versions
WHERE prompt_type = 'generator'
  AND segmento = 'MEGA'
  AND turn_type = 'turn1'
ORDER BY subgroup NULLS FIRST, version DESC;

COMMIT;
