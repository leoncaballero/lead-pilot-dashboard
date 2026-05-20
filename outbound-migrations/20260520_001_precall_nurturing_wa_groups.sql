-- 2026-05-20: tabla de estado para grupos WhatsApp de Pre-Call Nurturing
--
-- WF09 crea un grupo de WhatsApp por cada lead cualificado por SDR (booking
-- confirmado). El problema: WhatsApp no siempre añade directamente al lead/
-- closer al grupo si tienen la privacy "Who can add me to groups" en "My
-- Contacts" o "Nobody". Cuando eso pasa hay que:
--   1. NO mandar los mensajes del SOP hasta que esa persona entre.
--   2. Mandarle un invite link 1-1.
--   3. Hacer follow-up si no entra en X horas.
--
-- Esta tabla guarda el estado por grupo para que WF09b (webhook desde EvoAPI
-- GROUP_PARTICIPANTS_UPDATE) y WF09c (cron 30min) puedan completar el flujo
-- sin reconstruir contexto.
--
-- State machine:
--   awaiting_join → (todos dentro) → messages_sent
--   awaiting_join → (>72h sin entrar) → failed_no_join_72h
--   awaiting_join puede recibir reintentos de invite a las 4h y un alert
--   Slack al SDR a las 24h (sin cambiar de estado).
--
-- Ya aplicada en producción vía Supabase Management API + service_role.

CREATE TABLE IF NOT EXISTS cl001_p007_precall_nurturing_wa_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- HubSpot context (para correlacionar con la pipeline outbound)
  hubspot_lead_id TEXT NOT NULL,

  -- Group metadata
  group_jid TEXT NOT NULL UNIQUE,
  group_subject TEXT NOT NULL,
  invite_url TEXT,

  -- Participants
  lead_phone TEXT NOT NULL,
  lead_name TEXT NOT NULL,
  lead_company TEXT NOT NULL,
  closer_phone TEXT,
  closer_name TEXT,
  stakeholder_phones JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Para el state-machine de entrada al grupo:
  --   expected_participants: [{phone, role: 'lead'|'closer'|'stakeholder'}, ...]
  --     calculado al crear el grupo. NO incluye al SDR (es el creador).
  --   pending_participants:  subset de expected que NO ha entrado aún.
  --     Se va vaciando a medida que llegan eventos GROUP_PARTICIPANTS_UPDATE.
  --   joined_at: { phone: timestamp_iso } por cada entrada confirmada.
  expected_participants JSONB NOT NULL,
  pending_participants JSONB NOT NULL DEFAULT '[]'::jsonb,
  joined_at JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Meeting context
  meeting_url TEXT NOT NULL,
  meeting_at TIMESTAMPTZ NOT NULL,
  segment TEXT NOT NULL CHECK (segment IN ('genesis', 'mega')),
  video_url TEXT NOT NULL,

  -- SOP messages a enviar cuando todos hayan entrado.
  -- Array de strings, ya con interpolaciones (lead.name, closer.name, meeting.url,
  -- video_url) resueltas al crear el grupo. WF09b las envía tal cual.
  messages JSONB NOT NULL,
  messages_sent_at TIMESTAMPTZ,
  sent_results JSONB,

  -- State machine
  state TEXT NOT NULL DEFAULT 'awaiting_join' CHECK (state IN (
    'awaiting_join',
    'messages_sent',
    'failed_no_join_72h'
  )),

  -- Follow-up tracking (idempotencia: nunca reenviar el mismo follow-up)
  invite_sent_at TIMESTAMPTZ,
  followup_4h_sent_at TIMESTAMPTZ,
  slack_alert_24h_sent_at TIMESTAMPTZ,

  last_check_at TIMESTAMPTZ
);

-- Hot path: WF09c cron lee awaiting_join cada 30min. Index parcial es óptimo
-- porque la mayoría de rows estarán en messages_sent (estado terminal feliz).
CREATE INDEX IF NOT EXISTS idx_wagroups_awaiting_join
  ON cl001_p007_precall_nurturing_wa_groups(created_at)
  WHERE state = 'awaiting_join';

-- WF09b webhook handler busca por group_jid en cada evento de EvoAPI.
CREATE INDEX IF NOT EXISTS idx_wagroups_group_jid
  ON cl001_p007_precall_nurturing_wa_groups(group_jid);

-- Trigger para updated_at automático.
CREATE OR REPLACE FUNCTION cl001_p007_precall_nurturing_wa_groups_updated_at_trigger()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_whatsapp_groups_updated_at ON cl001_p007_precall_nurturing_wa_groups;
CREATE TRIGGER trg_whatsapp_groups_updated_at
  BEFORE UPDATE ON cl001_p007_precall_nurturing_wa_groups
  FOR EACH ROW EXECUTE FUNCTION cl001_p007_precall_nurturing_wa_groups_updated_at_trigger();
