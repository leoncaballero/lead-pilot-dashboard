import { createServerFn } from "@tanstack/react-start";

/**
 * Pipeline kanban data: agrupa pipeline rows por etapa de funnel y combina
 * con outcomes (cl001_p007_outcomes) para detectar replied / booked.
 *
 * Etapas:
 * 1. pending  — status=pending_review (esperando humano)
 * 2. sending  — status=ready_to_send | sending (en camino)
 * 3. sent     — status=sent | dry_run_only SIN outcome 'replied' (pendiente respuesta)
 * 4. replied  — sent + outcome=replied SIN outcome=booked
 * 5. booked   — sent + outcome=booked
 * 6. closed   — auto_rejected | rejected | error_send | needs_deep_review
 */

export type PipelineStage =
  | "pending"
  | "sending"
  | "sent"
  | "replied"
  | "booked"
  | "closed";

export type PipelineCard = {
  id: string;
  smartlead_lead_id: string | null;
  campaign_id: string | null;
  hubspot_contact_id: string | null;
  lead_name: string | null;
  lead_email: string | null;
  segmento: string | null;
  turn_type: string | null;
  patron: string | null;
  score: number | null;
  status: string | null;
  sdr_action: string | null;
  created_at: string | null;
  sent_at: string | null;
  // Stage assignment
  stage: PipelineStage;
  // Latest outcome timestamps for replied/booked
  replied_at: string | null;
  booked_at: string | null;
};

export type PipelineKanbanResponse = {
  columns: Record<PipelineStage, PipelineCard[]>;
  counts: Record<PipelineStage, number>;
  generated_at: string;
};

const PIPELINE_TABLE = "cl001_p007_turn1_pipeline";
const OUTCOMES_TABLE = "cl001_p007_outcomes";

function getCreds() {
  const url = process.env.OUTBOUND_SUPABASE_URL;
  const key = process.env.OUTBOUND_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Outbound Supabase no configurado");
  return { url: url.replace(/\/$/, ""), key };
}

async function pgrest<T>(path: string): Promise<T> {
  const { url, key } = getCreds();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: "GET",
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`pgrest ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const t = await res.text();
  return (t ? JSON.parse(t) : null) as T;
}

export const getPipelineKanban = createServerFn({ method: "GET" })
  .inputValidator((data: { lookback_days?: number }) => data ?? {})
  .handler(async ({ data }): Promise<PipelineKanbanResponse> => {
    const lookback = data?.lookback_days ?? 30;
    const since = new Date(Date.now() - lookback * 24 * 3600 * 1000).toISOString();

    type Row = {
      id: string;
      smartlead_lead_id: string | null;
      campaign_id: string | null;
      hubspot_contact_id: string | null;
      lead_name: string | null;
      lead_email: string | null;
      segmento: string | null;
      turn_type: string | null;
      patron: string | null;
      score: number | null;
      status: string | null;
      sdr_action: string | null;
      created_at: string | null;
      sent_at: string | null;
    };
    const params = new URLSearchParams({
      select:
        "id,smartlead_lead_id,campaign_id,hubspot_contact_id,lead_name,lead_email,segmento,turn_type,patron,score,status,sdr_action,created_at,sent_at",
      order: "created_at.desc.nullslast",
      limit: "500",
    });
    params.append("created_at", `gte.${since}`);
    const rows = await pgrest<Row[]>(`${PIPELINE_TABLE}?${params.toString()}`);

    // Outcomes para los rows del cohort
    type OutcomeRow = {
      pipeline_id: string;
      outcome: string;
      occurred_at: string | null;
    };
    const outcomeMap = new Map<string, { replied_at?: string; booked_at?: string }>();
    if ((rows ?? []).length > 0) {
      const ids = rows.map((r) => `"${r.id}"`).join(",");
      const oParams = new URLSearchParams({
        select: "pipeline_id,outcome,occurred_at",
        order: "occurred_at.asc.nullslast",
        limit: "5000",
      });
      oParams.append("pipeline_id", `in.(${ids})`);
      const outcomes = await pgrest<OutcomeRow[]>(`${OUTCOMES_TABLE}?${oParams.toString()}`);
      for (const o of outcomes ?? []) {
        const cur = outcomeMap.get(o.pipeline_id) ?? {};
        if (o.outcome === "replied" && !cur.replied_at) cur.replied_at = o.occurred_at ?? undefined;
        if (o.outcome === "booked" && !cur.booked_at) cur.booked_at = o.occurred_at ?? undefined;
        outcomeMap.set(o.pipeline_id, cur);
      }
    }

    function classify(r: Row): PipelineStage {
      const o = outcomeMap.get(r.id);
      if (o?.booked_at) return "booked";
      if (o?.replied_at) return "replied";
      const s = r.status;
      if (!s) return "pending";
      if (s === "pending_review" || s === "needs_deep_review") return "pending";
      if (s === "ready_to_send" || s === "sending") return "sending";
      if (s === "sent" || s === "dry_run_only") return "sent";
      if (s === "auto_rejected" || s === "rejected" || s === "error_send" || s === "error_generation")
        return "closed";
      return "pending";
    }

    const columns: Record<PipelineStage, PipelineCard[]> = {
      pending: [],
      sending: [],
      sent: [],
      replied: [],
      booked: [],
      closed: [],
    };

    for (const r of rows ?? []) {
      const stage = classify(r);
      const o = outcomeMap.get(r.id) ?? {};
      columns[stage].push({
        ...r,
        stage,
        replied_at: o.replied_at ?? null,
        booked_at: o.booked_at ?? null,
      });
    }

    const counts = Object.fromEntries(
      Object.entries(columns).map(([k, v]) => [k, v.length])
    ) as Record<PipelineStage, number>;

    return {
      columns,
      counts,
      generated_at: new Date().toISOString(),
    };
  });
