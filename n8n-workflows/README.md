# n8n workflow snapshots

JSON exports of the productive n8n workflows under `Personal / CL001_P007_Data-Intelligence / GTM`. Tracked in git so we can diff changes over time, recover from accidental edits, and code-review breaking changes through PRs.

## Files

| File | Workflow ID | Purpose |
|---|---|---|
| `WF01-classify-replies.json` | `Gs1bLYpaMktZ1M5D` | Smartlead reply webhook → classifier (interested / not interested / pause / OOO) → routes to WF02 or HubSpot |
| `WF02-turn1-pipeline.json` | `Y0k0uh5KX2TvDzFf` | Turn 1 generator + validator. MEGA / mid / low segments. Writes to `cl001_p007_turn1_pipeline` |
| `WF02b-turn2-generator.json` | `nwY6oykHHKZmg5TA` | Subsequent turns (2ª, 3ª…). Loads previous turn context |
| `WF03-cron-fu-4h.json` | `5HQJUXNtkUOpuiNb` | Cron 4h follow-up |
| `WF04-cron-booking-detector.json` | `epJZXeTq4HVKtsvC` | Cron 30min — detects HubSpot meetings, writes outcomes |
| `WF08-auto-retry-error-send.json` | `RAVhnYHki4LmCUle` | Cron 5min — retries `error_send` rows, Slack alert at 3 fails |
| `WF09-whatsapp-group-nurturing.json` | `sDMTEdFiM3p20yoE` | Webhook HubSpot → crea grupo WhatsApp via Evolution API + foto + envía mensajes SOP o invite 1-1 si lead/closer no entraron. Persiste estado en `cl001_p007_precall_nurturing_wa_groups`. **Inactivo** hasta validación. |
| `WF09b-whatsapp-group-on-join.json` | `Edym4K7xzDh1J0K5` | Webhook EvoAPI `GROUP_PARTICIPANTS_UPDATE` → si era un grupo en `awaiting_join` y entró el último pending, envía los mensajes SOP guardados + marca `messages_sent`. **Inactivo** hasta validación. |
| `WF09c-whatsapp-group-followup-cron.json` | `JJqg4f5pAFhhA9j0` | Cron 30min sobre rows `awaiting_join`. 4h → re-invite 1-1. 24h → Slack al SDR. 72h → marca `failed_no_join_72h` + Slack final. **Inactivo** hasta validación. |

## How to re-export

When you edit a workflow in n8n, re-run the export to update the tracked snapshot:

```bash
export N8N_PAT="<your n8n personal access token>"
./scripts/export-n8n-workflows.sh
git diff n8n-workflows/
```

If the diff is intentional, commit it. If it isn't, somebody else edited the workflow and you should investigate before committing.

## Sanitization

The export script replaces these hardcoded secrets with placeholders before writing to disk:

| Secret pattern | Placeholder |
|---|---|
| `hooks.slack.com/services/T*/B*/*` | `hooks.slack.com/services/__SLACK_WEBHOOK_REDACTED__` |
| HubSpot App Token `cQF...` | `__HUBSPOT_APP_TOKEN_REDACTED__` |
| HubSpot PAT `pat-eu1-*` | `__HUBSPOT_PAT_REDACTED__` |
| Anthropic key `sk-ant-*` | `__ANTHROPIC_KEY_REDACTED__` |
| Smartlead API key | `__SMARTLEAD_API_KEY_REDACTED__` |
| Supabase PAT `sbp_*` | `__SUPABASE_PAT_REDACTED__` |
| GitHub PAT `github_pat_*` | `__GITHUB_PAT_REDACTED__` |

If you add a new secret to a workflow node parameter, **add it to the sanitizer in `scripts/export-n8n-workflows.sh` BEFORE the next export**, or it will leak into the repo. Better: move the secret to an n8n credential and reference it by `credentials.<type>.id` (already a separate object that only holds IDs).

Also stripped: volatile metadata (`updatedAt`, `versionId`, `triggerCount`, `pinData`, `staticData`, `meta`, etc.) so diffs only show meaningful changes.

## How to restore a workflow from a snapshot

Snapshots are not 1:1 importable — n8n's import expects the unstripped format, and the secret placeholders need to be substituted back. If you need to roll back:

1. Open the snapshot file in this repo
2. Find the relevant node parameters / connections
3. Apply changes manually in the n8n UI (safer — preserves credentials and other live state)

For full disaster recovery, n8n has its own backup/restore (DB-level), and we keep one PAT in the credentials memory for it. This repo is the source of truth for "what should the workflow look like", not for "how to literally restore it".
