#!/usr/bin/env bash
#
# Export n8n productive workflows as JSON snapshots to ./n8n-workflows/
#
# Why: GitHub-tracked workflow definitions so we can diff changes, recover
# from accidental edits, code-review breaking changes in PRs.
#
# Usage:
#   export N8N_PAT="<n8n personal access token>"
#   ./scripts/export-n8n-workflows.sh
#
# Sanitization: hardcoded secrets in workflow node parameters (Slack webhooks,
# HubSpot app tokens, etc.) are replaced with placeholders before writing to
# disk. The originals stay in n8n; this repo only holds the structural
# definition. To re-import: substitute the placeholders back with real values.
#
set -euo pipefail

if [[ -z "${N8N_PAT:-}" ]]; then
  echo "ERROR: set N8N_PAT env var (n8n Personal Access Token)" >&2
  exit 1
fi

export BASE="${N8N_BASE_URL:-https://cion8napp.nexau.es/api/v1}"
export OUT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/n8n-workflows"
mkdir -p "$OUT_DIR"

# id|label tuples — keep in sync with src/api/system-health.functions.ts
export WORKFLOWS_FLAT="Gs1bLYpaMktZ1M5D|WF01-classify-replies
Y0k0uh5KX2TvDzFf|WF02-turn1-pipeline
nwY6oykHHKZmg5TA|WF02b-turn2-generator
epJZXeTq4HVKtsvC|WF04-cron-booking-detector
5HQJUXNtkUOpuiNb|WF03-cron-fu-4h
RAVhnYHki4LmCUle|WF08-auto-retry-error-send
sDMTEdFiM3p20yoE|WF09-whatsapp-group-nurturing
Edym4K7xzDh1J0K5|WF09b-whatsapp-group-on-join
JJqg4f5pAFhhA9j0|WF09c-whatsapp-group-followup-cron"

# Python helper does the fetch + sanitization + pretty-print
python3 - <<PYEOF
import json, os, re, sys, urllib.request

base = os.environ["BASE"]
pat = os.environ["N8N_PAT"]
out_dir = os.environ["OUT_DIR"]

wfs = [tuple(s.split("|", 1)) for s in os.environ["WORKFLOWS_FLAT"].split("\n") if s]

# (pattern, placeholder). Patterns are intentionally specific — we don't want
# to scrub things that look like JWTs but are actually node IDs or position
# coords. If you add a new secret here, document it in n8n-workflows/README.md.
SANITIZERS = [
    (r"hooks\.slack\.com/services/[A-Z0-9]+/[A-Z0-9]+/[A-Za-z0-9_]+",
     "hooks.slack.com/services/__SLACK_WEBHOOK_REDACTED__"),
    (r"cQFDbCaanWjvs5GO", "__HUBSPOT_APP_TOKEN_REDACTED__"),
    (r"pat-eu1-[a-f0-9-]{36}", "__HUBSPOT_PAT_REDACTED__"),
    (r"sk-ant-[A-Za-z0-9_-]{40,}", "__ANTHROPIC_KEY_REDACTED__"),
    (r"8edd7827-[a-f0-9-]+_ueu6kv0", "__SMARTLEAD_API_KEY_REDACTED__"),
    (r"sbp_[a-f0-9]+", "__SUPABASE_PAT_REDACTED__"),
    (r"github_pat_[A-Za-z0-9_]+", "__GITHUB_PAT_REDACTED__"),
]

# Volatile fields that change on every read but are not part of the meaningful
# definition. Stripping them keeps diffs focused on real edits.
VOLATILE_KEYS = {
    "updatedAt", "createdAt", "versionId", "versionCounter", "triggerCount",
    "activeVersionId", "activeVersion", "shared", "isArchived", "pinData",
    "staticData", "meta",
}

def sanitize(obj):
    s = json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True)
    for pat_re, repl in SANITIZERS:
        s = re.sub(pat_re, repl, s)
    return s

for wid, label in wfs:
    req = urllib.request.Request(
        f"{base}/workflows/{wid}",
        headers={"X-N8N-API-KEY": pat, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req) as r:
            d = json.loads(r.read())
    except Exception as e:
        print(f"  ✗ {label}: fetch failed → {e}", file=sys.stderr)
        continue
    for k in VOLATILE_KEYS:
        d.pop(k, None)
    out_path = os.path.join(out_dir, f"{label}.json")
    with open(out_path, "w") as f:
        f.write(sanitize(d))
        f.write("\n")
    print(f"  ✓ {label} ({len(d.get('nodes', []))} nodes) → n8n-workflows/{label}.json")
PYEOF
echo "Done. Review the diff and commit if it looks right."
