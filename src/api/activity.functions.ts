import { createServerFn } from "@tanstack/react-start";

/**
 * Audit feed: timeline unificado de eventos del pipeline.
 *
 * Combina:
 * - cl001_p007_activity_events: acciones humanas en /triage (approve, edit,
 *   reject, deep review, undo) + eventos de sistema
 * - cl001_p007_outcomes: replied (Smartlead webhook), booked (cron HubSpot)
 *
 * Cada item se enriquece con info del lead (join a turn1_pipeline).
 */

export type ActivityEvent = {
  /** Composite id: prefijo + uuid (para keys de React) */
  id: string;
  /** Origen: activity_events o outcomes */
  source: "activity" | "outcome";
  /** Tipo de evento */
  event_type: string;
  /** Timestamp del evento */
  occurred_at: string;
  /** Info del lead (join) */
  pipeline_id: string;
  lead_name: string | null;
  lead_email: string | null;
  segmento: string | null;
  turn_type: string | null;
  /** Payload arbitrario del evento (para detalles en hover/expand) */
  payload: Record<string, unknown> | null;
};

export type ActivityFeedResponse = {
  events: ActivityEvent[];
  generated_at: string;
};

const PIPELINE_TABLE = "cl001_p007_turn1_pipeline";
const ACTIVITY_TABLE = "cl001_p007_activity_events";
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

export const getActivityFeed = createServerFn({ method: "GET" })
  .inputValidator((data: { limit?: number } | undefined) => data ?? {})
  .handler(async ({ data }): Promise<ActivityFeedResponse> => {
    const limit = data?.limit ?? 100;

    // 1. Activity events (acciones humanas)
    type ActivityRow = {
      id: string;
      pipeline_id: string;
      event_type: string;
      payload: Record<string, unknown> | null;
      created_at: string;
    };
    const aParams = new URLSearchParams({
      select: "id,pipeline_id,event_type,payload,created_at",
      order: "created_at.desc.nullslast",
      limit: String(limit),
    });
    const activityRows = await pgrest<ActivityRow[]>(`${ACTIVITY_TABLE}?${aParams.toString()}`);

    // 2. Outcomes (replied / booked / etc.)
    type OutcomeRow = {
      id: string;
      pipeline_id: string;
      outcome: string;
      outcome_source: string;
      occurred_at: string;
      details: Record<string, unknown> | null;
    };
    const oParams = new URLSearchParams({
      select: "id,pipeline_id,outcome,outcome_source,occurred_at,details",
      order: "occurred_at.desc.nullslast",
      limit: String(limit),
    });
    const outcomeRows = await pgrest<OutcomeRow[]>(`${OUTCOMES_TABLE}?${oParams.toString()}`);

    // 3. Resolver lead info para todos los pipeline_ids únicos
    const allPids = new Set<string>([
      ...(activityRows ?? []).map((r) => r.pipeline_id),
      ...(outcomeRows ?? []).map((r) => r.pipeline_id),
    ].filter(Boolean));
    type PipelineRow = {
      id: string;
      lead_name: string | null;
      lead_email: string | null;
      segmento: string | null;
      turn_type: string | null;
    };
    const leadMap = new Map<string, PipelineRow>();
    if (allPids.size > 0) {
      const idsList = Array.from(allPids).map((i) => `"${i}"`).join(",");
      const pParams = new URLSearchParams({
        select: "id,lead_name,lead_email,segmento,turn_type",
        limit: "500",
      });
      pParams.append("id", `in.(${idsList})`);
      const pipelineRows = await pgrest<PipelineRow[]>(`${PIPELINE_TABLE}?${pParams.toString()}`);
      for (const p of pipelineRows ?? []) leadMap.set(p.id, p);
    }

    // 4. Merge + sort por occurred_at
    const events: ActivityEvent[] = [];
    for (const r of activityRows ?? []) {
      const lead = leadMap.get(r.pipeline_id);
      events.push({
        id: `act-${r.id}`,
        source: "activity",
        event_type: r.event_type,
        occurred_at: r.created_at,
        pipeline_id: r.pipeline_id,
        lead_name: lead?.lead_name ?? null,
        lead_email: lead?.lead_email ?? null,
        segmento: lead?.segmento ?? null,
        turn_type: lead?.turn_type ?? null,
        payload: r.payload,
      });
    }
    for (const r of outcomeRows ?? []) {
      const lead = leadMap.get(r.pipeline_id);
      events.push({
        id: `out-${r.id}`,
        source: "outcome",
        event_type: `outcome_${r.outcome}`,
        occurred_at: r.occurred_at,
        pipeline_id: r.pipeline_id,
        lead_name: lead?.lead_name ?? null,
        lead_email: lead?.lead_email ?? null,
        segmento: lead?.segmento ?? null,
        turn_type: lead?.turn_type ?? null,
        payload: { ...r.details, _outcome_source: r.outcome_source },
      });
    }
    events.sort((a, b) => {
      const ta = a.occurred_at ? Date.parse(a.occurred_at) : 0;
      const tb = b.occurred_at ? Date.parse(b.occurred_at) : 0;
      return tb - ta;
    });

    return {
      events: events.slice(0, limit),
      generated_at: new Date().toISOString(),
    };
  });
