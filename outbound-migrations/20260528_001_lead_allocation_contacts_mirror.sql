-- 2026-05-28: Lead Allocation Fase 1 — espejo de contactos outbound HubSpot
--
-- Contexto:
--   Fase 1 del proyecto Lead Allocation = visibilidad. HubSpot sigue siendo
--   source of truth de TODO; esta tabla solo replica las propiedades de los
--   contactos outbound (los que tienen gtm__avatar_segment o gtm__lead_stage
--   poblados, ~254k según audit del 2026-05-28).
--
--   NO se crean propiedades nuevas en HubSpot. NO se calcula nada en HS
--   workflows. Toda derivación (recency_band, data_quality, etc.) se hace
--   como vistas SQL en este mismo proyecto, leyendo de la tabla espejo.
--
-- Propósito:
--   Habilitar el dashboard /visibility en lead-pilot-dashboard sin tocar la
--   instancia HubSpot productiva. Sync incremental cada 30 min via n8n.
--
-- Decisiones de modelo:
--   - Prefijo cl001_p007_la_ (la = Lead Allocation), consistente con tablas
--     existentes del proyecto.
--   - hs_contact_id como PK (HubSpot id, no UUID — facilita debug).
--   - Solo propiedades HS existentes; ninguna calculada en esta tabla.
--   - Las propiedades casi-vacías (industry, jobtitle, intent_score) se
--     mantienen igualmente para soportar futuras vistas.
--   - hs_email_optout y outbound__cold_email__optout son BOOLEAN para
--     uso directo en WHERE; los TIMESTAMPTZ se preservan donde aplique.
--
-- Apply manualmente en:
--   https://supabase.com/dashboard/project/mazhrnqztnjvppgbltuq/sql/new

CREATE TABLE IF NOT EXISTS cl001_p007_la_contacts_mirror (
  -- Identidad
  hs_contact_id                       TEXT PRIMARY KEY,
  email                               TEXT,
  full_name                           TEXT,
  company                             TEXT,

  -- Firmografía (mayormente vacía en outbound según audit, pero se mantiene
  -- por si hay subset poblado o se enriquece a futuro)
  industry                            TEXT,
  country                             TEXT,
  jobtitle                            TEXT,
  numemployees                        INTEGER,

  -- GTM segmentación (núcleo del dashboard)
  gtm__avatar_segment                 TEXT,    -- 'MEGA' | 'Genesis' | 'Prosperitas' | NULL
  gtm__lead_stage                     TEXT,    -- 'Queue' | 'In Campaign' | 'Cooling Off' | 'Unqualified' | 'On Hold' | 'SDR Sequence' | 'Nurturing' | 'Pre-call Nurture' | NULL
  segmentos_outbound_database         TEXT,    -- legacy: 'MEGA' | 'Prosperitas' | 'General' | NULL — para detectar inconsistencias
  outbound_intent_score               INTEGER, -- scoring legacy, mayormente NULL (960 contactos)
  qualified                           BOOLEAN, -- "Indica si un contacto es cualificado"

  -- Lifecycle nativo HS
  lifecyclestage                      TEXT,

  -- Exclusiones / opt-outs
  outbound__cold_email__optout        BOOLEAN, -- específico de cold email outbound
  hs_email_optout                     BOOLEAN, -- unsubscribe global de marketing
  hs_email_hard_bounced               BOOLEAN, -- hard bounce email marketing

  -- Engagement email (HS nativo)
  hs_email_last_reply_date            TIMESTAMPTZ,
  hs_email_first_reply_date           TIMESTAMPTZ,
  hs_email_replied                    INTEGER, -- count de marketing emails replied

  -- Engagement cold email (sistema custom)
  cold_email___last_reply_date        TIMESTAMPTZ,
  cold_email_campaign__last_          TEXT,    -- última campaña cold recibida
  cold_email___link_smarlead          TEXT,    -- link al lead en Smartlead UI

  -- LinkedIn outbound (canal paralelo, descubierto en audit)
  cold_linkedin___last_reply_date     TIMESTAMPTZ,
  cold_linkedin__last_engaged_campaign TEXT,

  -- Activity / recency
  hs_last_sales_activity_timestamp    TIMESTAMPTZ, -- último engagement sales (site, form, doc, meeting)
  notes_last_updated                  TIMESTAMPTZ, -- "Last Activity Date" — última nota/log
  num_conversion_events               INTEGER,     -- forms submitted total
  num_unique_conversion_events        INTEGER,     -- forms únicos submitted
  recent_conversion_date              TIMESTAMPTZ, -- último form submission

  -- Meta HS
  hs_createdate                       TIMESTAMPTZ,
  hs_lastmodifieddate                 TIMESTAMPTZ,

  -- Meta sync (interno)
  synced_at                           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Comentarios de tabla para autoexplicación en Supabase Studio
COMMENT ON TABLE cl001_p007_la_contacts_mirror IS
  'Espejo read-only de contactos outbound de HubSpot. Sync incremental cada 30min via n8n (WF GTM-Lead-Allocation). HubSpot es source of truth.';

COMMENT ON COLUMN cl001_p007_la_contacts_mirror.gtm__avatar_segment IS
  'Segmento avatar gestionado en HubSpot. Distribución a 2026-05-28: MEGA 59,606 / Genesis 191,452 / Prosperitas 3,223.';

COMMENT ON COLUMN cl001_p007_la_contacts_mirror.gtm__lead_stage IS
  'Pipeline stage outbound gestionado en HubSpot. 5 estados activos a 2026-05-28: In Campaign 111k / Unqualified 51k / Queue 47k / Cooling Off 2.5k / NULL 41k.';

COMMENT ON COLUMN cl001_p007_la_contacts_mirror.outbound_intent_score IS
  'Score legacy infrautilizado (960 contactos a 2026-05-28). Pendiente decidir si revivir o deprecar.';

-- Índices para los cortes principales del dashboard
CREATE INDEX IF NOT EXISTS idx_la_contacts_avatar_stage
  ON cl001_p007_la_contacts_mirror (gtm__avatar_segment, gtm__lead_stage);

CREATE INDEX IF NOT EXISTS idx_la_contacts_stage
  ON cl001_p007_la_contacts_mirror (gtm__lead_stage)
  WHERE gtm__lead_stage IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_la_contacts_avatar
  ON cl001_p007_la_contacts_mirror (gtm__avatar_segment)
  WHERE gtm__avatar_segment IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_la_contacts_last_modified
  ON cl001_p007_la_contacts_mirror (hs_lastmodifieddate);

CREATE INDEX IF NOT EXISTS idx_la_contacts_synced
  ON cl001_p007_la_contacts_mirror (synced_at);

CREATE INDEX IF NOT EXISTS idx_la_contacts_email
  ON cl001_p007_la_contacts_mirror (email);

CREATE INDEX IF NOT EXISTS idx_la_contacts_last_activity
  ON cl001_p007_la_contacts_mirror (hs_last_sales_activity_timestamp);

CREATE INDEX IF NOT EXISTS idx_la_contacts_intent_score
  ON cl001_p007_la_contacts_mirror (outbound_intent_score)
  WHERE outbound_intent_score IS NOT NULL;

-- =====================================================================
-- VISTAS DERIVADAS — toda la lógica de clasificación vive aquí, NO en HS
-- =====================================================================

-- Vista 1: Pipeline Matrix (Avatar × Stage) — la vista principal del dashboard
CREATE OR REPLACE VIEW cl001_p007_la_vw_pipeline_matrix AS
SELECT
  COALESCE(gtm__avatar_segment, 'Sin avatar') AS avatar,
  COALESCE(gtm__lead_stage, 'Sin stage')      AS stage,
  COUNT(*)                                     AS count
FROM cl001_p007_la_contacts_mirror
GROUP BY 1, 2;

COMMENT ON VIEW cl001_p007_la_vw_pipeline_matrix IS
  'Conteos por (avatar, stage) — corte principal del dashboard /visibility.';

-- Vista 2: Recency band — derivada al vuelo desde timestamps de actividad
CREATE OR REPLACE VIEW cl001_p007_la_vw_recency_band AS
SELECT
  hs_contact_id,
  email,
  gtm__avatar_segment,
  gtm__lead_stage,
  GREATEST(
    COALESCE(hs_last_sales_activity_timestamp, '1970-01-01'::timestamptz),
    COALESCE(notes_last_updated,               '1970-01-01'::timestamptz),
    COALESCE(hs_email_last_reply_date,         '1970-01-01'::timestamptz),
    COALESCE(cold_email___last_reply_date,     '1970-01-01'::timestamptz),
    COALESCE(recent_conversion_date,           '1970-01-01'::timestamptz)
  ) AS last_activity_at,
  CASE
    WHEN GREATEST(
      COALESCE(hs_last_sales_activity_timestamp, '1970-01-01'::timestamptz),
      COALESCE(notes_last_updated,               '1970-01-01'::timestamptz),
      COALESCE(hs_email_last_reply_date,         '1970-01-01'::timestamptz),
      COALESCE(cold_email___last_reply_date,     '1970-01-01'::timestamptz),
      COALESCE(recent_conversion_date,           '1970-01-01'::timestamptz)
    ) = '1970-01-01'::timestamptz THEN 'never_engaged'
    WHEN GREATEST(
      COALESCE(hs_last_sales_activity_timestamp, '1970-01-01'::timestamptz),
      COALESCE(notes_last_updated,               '1970-01-01'::timestamptz),
      COALESCE(hs_email_last_reply_date,         '1970-01-01'::timestamptz),
      COALESCE(cold_email___last_reply_date,     '1970-01-01'::timestamptz),
      COALESCE(recent_conversion_date,           '1970-01-01'::timestamptz)
    ) >= now() - INTERVAL '30 days'  THEN 'active_30d'
    WHEN GREATEST(
      COALESCE(hs_last_sales_activity_timestamp, '1970-01-01'::timestamptz),
      COALESCE(notes_last_updated,               '1970-01-01'::timestamptz),
      COALESCE(hs_email_last_reply_date,         '1970-01-01'::timestamptz),
      COALESCE(cold_email___last_reply_date,     '1970-01-01'::timestamptz),
      COALESCE(recent_conversion_date,           '1970-01-01'::timestamptz)
    ) >= now() - INTERVAL '90 days'  THEN 'engaged_31_90d'
    WHEN GREATEST(
      COALESCE(hs_last_sales_activity_timestamp, '1970-01-01'::timestamptz),
      COALESCE(notes_last_updated,               '1970-01-01'::timestamptz),
      COALESCE(hs_email_last_reply_date,         '1970-01-01'::timestamptz),
      COALESCE(cold_email___last_reply_date,     '1970-01-01'::timestamptz),
      COALESCE(recent_conversion_date,           '1970-01-01'::timestamptz)
    ) >= now() - INTERVAL '180 days' THEN 'engaged_91_180d'
    ELSE 'dormant_180d_plus'
  END AS recency_band
FROM cl001_p007_la_contacts_mirror;

COMMENT ON VIEW cl001_p007_la_vw_recency_band IS
  'Banda de recency derivada del máximo timestamp de actividad relevante.';

-- Vista 3: Data quality flags
CREATE OR REPLACE VIEW cl001_p007_la_vw_data_quality AS
SELECT
  hs_contact_id,
  email,
  gtm__avatar_segment,
  gtm__lead_stage,
  -- email obviamente inválido
  (email IS NULL
   OR email = ''
   OR email NOT LIKE '%@%.%'
   OR email LIKE '%xjijk%'
   OR email LIKE '%test%'
  ) AS has_invalid_email,
  -- nombre obviamente basura
  (full_name IS NULL
   OR full_name = ''
   OR full_name ILIKE '%test%'
   OR full_name ILIKE '%Fdfsafaf%'
   OR full_name ILIKE 'Aircall New Contact'
   OR full_name ~ '^[+0-9 ]+$'  -- solo números/+/espacios
  ) AS has_invalid_name,
  -- lifecyclestage corrupto (IDs numéricos en lugar de etiquetas)
  (lifecyclestage ~ '^[0-9]+$') AS has_corrupt_lifecycle,
  -- proxy de B2B (email corporativo vs personal)
  (email IS NOT NULL
   AND email NOT ILIKE '%@gmail.com'
   AND email NOT ILIKE '%@hotmail.%'
   AND email NOT ILIKE '%@yahoo.%'
   AND email NOT ILIKE '%@outlook.%'
   AND email NOT ILIKE '%@live.%'
   AND email NOT ILIKE '%@me.com'
   AND email NOT ILIKE '%@icloud.%'
  ) AS has_corporate_email,
  -- clasificación general
  CASE
    WHEN email IS NULL OR email = '' THEN 'missing_critical'
    WHEN email NOT LIKE '%@%.%' THEN 'missing_critical'
    WHEN full_name IS NULL OR full_name = '' THEN 'missing_optional'
    ELSE 'complete'
  END AS data_quality
FROM cl001_p007_la_contacts_mirror;

COMMENT ON VIEW cl001_p007_la_vw_data_quality IS
  'Flags de calidad: email/nombre inválidos, lifecycle corrupto, B2B proxy via dominio corporativo.';

-- Vista 4: Contactos outbound sin clasificar (gap del audit: 41k contactos)
CREATE OR REPLACE VIEW cl001_p007_la_vw_sin_clasificar AS
SELECT
  hs_contact_id,
  email,
  full_name,
  gtm__avatar_segment,
  country,
  hs_createdate,
  hs_lastmodifieddate
FROM cl001_p007_la_contacts_mirror
WHERE gtm__avatar_segment IS NOT NULL  -- está en outbound universe
  AND gtm__lead_stage IS NULL;          -- pero sin stage asignado

COMMENT ON VIEW cl001_p007_la_vw_sin_clasificar IS
  'Contactos outbound (con avatar) que NO tienen lead_stage. Detectado en audit: ~41k.';

-- Vista 5: Segmentación inconsistente (avatar vs segmentos_outbound_database)
CREATE OR REPLACE VIEW cl001_p007_la_vw_segmentacion_inconsistente AS
SELECT
  hs_contact_id,
  email,
  gtm__avatar_segment,
  segmentos_outbound_database,
  CASE
    WHEN gtm__avatar_segment IS NOT NULL
     AND segmentos_outbound_database IS NOT NULL
     AND segmentos_outbound_database <> ''
     AND gtm__avatar_segment <> segmentos_outbound_database
      THEN 'mismatch'
    WHEN gtm__avatar_segment IS NULL
     AND segmentos_outbound_database IS NOT NULL
     AND segmentos_outbound_database <> ''
      THEN 'only_legacy'
    WHEN gtm__avatar_segment IS NOT NULL
     AND (segmentos_outbound_database IS NULL OR segmentos_outbound_database = '')
      THEN 'only_new'
    ELSE 'consistent'
  END AS consistency
FROM cl001_p007_la_contacts_mirror
WHERE gtm__avatar_segment IS NOT NULL
   OR (segmentos_outbound_database IS NOT NULL AND segmentos_outbound_database <> '');

COMMENT ON VIEW cl001_p007_la_vw_segmentacion_inconsistente IS
  'Diff entre gtm__avatar_segment (nuevo) y segmentos_outbound_database (legacy). Detecta migración a medias.';

-- Vista 6: Intent score recovery (los 960 contactos con score)
CREATE OR REPLACE VIEW cl001_p007_la_vw_intent_score_recovery AS
SELECT
  hs_contact_id,
  email,
  gtm__avatar_segment,
  gtm__lead_stage,
  outbound_intent_score,
  hs_lastmodifieddate
FROM cl001_p007_la_contacts_mirror
WHERE outbound_intent_score IS NOT NULL;

COMMENT ON VIEW cl001_p007_la_vw_intent_score_recovery IS
  'Subset con outbound_intent_score poblado. ~960 contactos a 2026-05-28. Pendiente decidir si revivir.';

-- =====================================================================
-- VALIDACIONES — ejecutar al final del SQL editor para verificar
-- =====================================================================

-- 1. Confirmar que la tabla existe y los índices están creados
SELECT
  schemaname,
  tablename,
  (SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'cl001_p007_la_contacts_mirror') AS index_count
FROM pg_tables
WHERE tablename = 'cl001_p007_la_contacts_mirror';

-- 2. Confirmar que las 6 vistas existen
SELECT viewname
FROM pg_views
WHERE viewname LIKE 'cl001_p007_la_vw_%'
ORDER BY viewname;

-- 3. Sanity: la tabla está vacía (todavía no hicimos backfill)
SELECT COUNT(*) AS rows_in_mirror FROM cl001_p007_la_contacts_mirror;
