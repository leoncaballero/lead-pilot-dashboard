# Outbound DB migrations

Estas migrations apuntan al proyecto Supabase **outbound** (`mazhrnqztnjvppgbltuq`),
donde vive la tabla `cl001_p007_turn1_pipeline` y todas las tablas de operaciones del
Setting Pilot. **NO** se aplican automáticamente — se ejecutan manualmente en el SQL
Editor de Supabase para tener trazabilidad en git.

El otro folder `supabase/migrations/` apunta al proyecto **auth** (`vcenkyoutvzepylqsveo`),
gestionado por Lovable Cloud, donde viven la tabla de usuarios `users` y las funciones
de roles.

## Naming

`YYYYMMDD_NNN_short_description.sql` (con `NNN` zero-padded y descriptivo en `snake_case`).

## Cómo aplicar

1. Copiar el contenido del .sql
2. Pegar en https://supabase.com/dashboard/project/mazhrnqztnjvppgbltuq/sql/new
3. Run
4. Verificar el output (las migrations incluyen `SELECT` finales para validar)

## Migrations actuales

- `20260506_001_extend_pipeline_for_turn_n.sql` — Añade `turn_number`, `turn_type`,
  `previous_turn_id`, `fu_4h_sent_at`, `fu_24h_sent_at` + check constraint + índices
  + UNIQUE para idempotencia. Backward-compatible: rows existentes mantienen
  `turn_number=1`, `turn_type='turn1'`.
- `20260506_002_dynamic_prompts.sql` — Añade `turn_type` a `cl001_p007_prompt_versions`,
  reemplaza UNIQUE constraint para incluir turn_type, seedea los 7 prompts reales
  (Turn 1 + Turn 2 + FU 4h × classifier/generator/validator MEGA) extraídos de
  los workflows. Soporte para edición desde la app `/prompts`.

- `20260507_001_extend_followups_24h_3d.sql` — Añade columna fu_3d_sent_at
  + extiende CHECK de turn_type en prompt_versions y pipeline para incluir
  follow_up_24h, follow_up_3d, turn3_generic, objection_response, booking_propose.

## Env vars necesarias en Lovable Cloud

Settings → Project → Secrets:

- `OUTBOUND_SUPABASE_URL` — URL del proyecto outbound
- `OUTBOUND_SUPABASE_SERVICE_ROLE_KEY` — service_role key del outbound (RLS bypass)
- `OUTBOUND_SUPABASE_ANON_KEY` — anon key del outbound (para realtime opcional)
- `OUTBOUND_TURN1_SEND_WEBHOOK_URL` — webhook n8n del WF02 v2 para aprobar Turn 1
  (default: `https://cion8napp.nexau.es/webhook/turn1-send-from-lovable`)
- `SMARTLEAD_API_KEY` — API key de Smartlead para cargar el hilo completo de
  conversaciones. La misma que está hardcodeada en los workflows de n8n. Sin ella,
  la sección "Conversación completa" muestra un error.
- `HUBSPOT_API_KEY` — Private App PAT de HubSpot (region EU1, scopes: contacts,
  companies, engagements/meetings, engagements/calls — todos read). Usado por la
  tarjeta "Contexto HubSpot" en Triage y History detail. Sin él, la tarjeta
  muestra un error pero el resto sigue funcionando.
- `ANTHROPIC_API_KEY` — API key de Anthropic. Usada por el botón "Sugerir
  mejoras" en `/prompts` (analiza edits + rejects con Opus y propone v2 del
  prompt). Sin él, el botón devuelve error pero el resto de la app funciona.
  Reusable la misma que está en n8n credentials.
