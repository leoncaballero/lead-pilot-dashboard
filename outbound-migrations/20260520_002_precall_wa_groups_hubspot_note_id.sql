-- 2026-05-20: añadir hubspot_note_id a la tabla de Pre-Call Nurturing WA Groups.
--
-- WF10 (nuevo) sincroniza los mensajes de los grupos WhatsApp como una Note en
-- HubSpot, anclada al contact (lead). Para appendear cada nuevo mensaje a la
-- misma Note (estilo TimelinesAI), necesitamos guardar el note_id devuelto por
-- HubSpot en la primera creación.
--
-- Lógica de WF10:
--   if row.hubspot_note_id IS NULL:
--     POST /crm/v3/objects/notes  → guardar response.id en hubspot_note_id
--   else:
--     GET note → append text → PATCH note
--
-- Non-destructive: ADD COLUMN IF NOT EXISTS. Aplicado en producción vía SQL
-- editor de Supabase (api.supabase.com tiene Cloudflare WAF que bloquea curl).

ALTER TABLE cl001_p007_precall_nurturing_wa_groups
  ADD COLUMN IF NOT EXISTS hubspot_note_id TEXT;

COMMENT ON COLUMN cl001_p007_precall_nurturing_wa_groups.hubspot_note_id
  IS 'HubSpot engagement/note ID en el que WF10 agrega los mensajes del grupo. NULL hasta el primer mensaje.';
