-- 2026-05-13: cache de análisis web por dominio
--
-- Antes de generar un Turn 1, queremos enriquecer el prompt con un análisis
-- estructurado de la web del lead (sector, tamaño, productos, hook personalizable).
-- Para no pagar el coste de fetch + Claude en CADA reply, cacheamos el análisis
-- por dominio: 5 leads de mismaempresa.com responden → 1 sólo análisis compartido.
--
-- Schema:
--   - domain: clave canónica, lowercase, sin www, sin protocolo (ej: "mibrand.com")
--   - analysis: JSON estructurado (business_summary, sector, apparent_size,
--     is_ecommerce, products_or_services, tone, personalization_hook, warnings)
--   - raw_text_preview: primeros ~5000 chars del texto extraído del HTML
--     (para debug, sin PII esperada)
--   - fetch_status: HTTP status del fetch original (200/404/etc)
--   - fetch_url: URL real que se acabó pidiendo (puede diferir de domain si hubo redirect)
--   - model_used: id del modelo Claude usado (para auditar coste y migrar versiones)
--   - fetched_at: cuándo se hizo el fetch + análisis original
--   - refreshed_at: bump cada vez que se re-analiza (refresh manual o cache miss)
--
-- TTL: 30 días. Re-análisis automático si refreshed_at < NOW() - 30d.
--
-- Ya aplicado en producción vía PostgREST + service_role. Este archivo es solo
-- para tener referencia histórica del cambio.

CREATE TABLE IF NOT EXISTS cl001_p007_website_analyses (
  domain TEXT PRIMARY KEY,
  analysis JSONB NOT NULL,
  raw_text_preview TEXT,
  fetch_status INTEGER,
  fetch_url TEXT,
  model_used TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_website_analyses_refreshed_at
  ON cl001_p007_website_analyses (refreshed_at);
