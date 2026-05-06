import { createServerFn } from "@tanstack/react-start";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type HistoryCase = {
  id: string;
  smartlead_lead_id?: string | null;
  smartlead_thread_id?: string | null;
  hubspot_contact_id?: string | null;
  lead_name?: string | null;
  lead_email?: string | null;
  reply_original?: string | null;
  reply_timestamp?: string | null;
  segmento?: string | null;
  patron?: string | null;
  turn_1_generated?: string | null;
  turn_1_final?: string | null;
  classification_output?: Record<string, JsonValue> | null;
  validation_output?: Record<string, JsonValue> | null;
  score?: number | null;
  validado?: boolean | null;
  errores_criticos?: string[] | null;
  razones_fallo?: string[] | null;
  status?: string | null;
  sdr_action?: string | null;
  sdr_action_timestamp?: string | null;
  edit_reason?: string | null;
  sent_at?: string | null;
  sent_via?: string | null;
  outcome?: string | null;
  outcome_timestamp?: string | null;
  outcome_details?: Record<string, JsonValue> | null;
  created_at?: string | null;
  updated_at?: string | null;
};

const TABLE = "cl001_p007_turn1_pipeline";

function getCreds() {
  const url = process.env.OUTBOUND_SUPABASE_URL;
  const key = process.env.OUTBOUND_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Outbound Supabase credentials are not configured. Add OUTBOUND_SUPABASE_URL and OUTBOUND_SUPABASE_SERVICE_ROLE_KEY as secrets."
    );
  }
  return { url: url.replace(/\/$/, ""), key };
}

async function pgrest(path: string, init: RequestInit & { prefer?: string } = {}) {
  const { url, key } = getCreds();
  const headers: Record<string, string> = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  if (init.prefer) headers["Prefer"] = init.prefer;
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string>) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Outbound DB request failed [${res.status}]: ${body}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export type HistoryFilters = {
  statuses?: string[];
  segmentos?: string[];
  patrones?: string[];
  search?: string;
  limit?: number;
  offset?: number;
};

export const getHistoryCases = createServerFn({ method: "GET" })
  .inputValidator((data: HistoryFilters) => data)
  .handler(async ({ data }) => {
    const limit = Math.min(Math.max(data.limit ?? 100, 1), 500);
    const offset = Math.max(data.offset ?? 0, 0);

    const params = new URLSearchParams();
    params.set(
      "select",
      "id,smartlead_lead_id,smartlead_thread_id,hubspot_contact_id,lead_name,lead_email,reply_original,reply_timestamp,segmento,patron,turn_1_generated,turn_1_final,score,validado,status,sdr_action,sdr_action_timestamp,edit_reason,sent_at,sent_via,outcome,outcome_timestamp,outcome_details,errores_criticos,razones_fallo,created_at,updated_at"
    );
    params.set("order", "created_at.desc");
    params.set("limit", String(limit));
    params.set("offset", String(offset));

    if (data.statuses && data.statuses.length > 0) {
      const list = data.statuses.map((s) => `"${s.replace(/"/g, "")}"`).join(",");
      params.append("status", `in.(${list})`);
    }
    if (data.segmentos && data.segmentos.length > 0) {
      const list = data.segmentos.map((s) => `"${s.replace(/"/g, "")}"`).join(",");
      params.append("segmento", `in.(${list})`);
    }
    if (data.patrones && data.patrones.length > 0) {
      const list = data.patrones.map((p) => `"${p.replace(/"/g, "")}"`).join(",");
      params.append("patron", `in.(${list})`);
    }
    if (data.search && data.search.trim().length > 0) {
      const q = data.search.trim().replace(/[*%]/g, "");
      params.append("or", `(lead_email.ilike.*${q}*,lead_name.ilike.*${q}*,smartlead_lead_id.ilike.*${q}*)`);
    }

    const cases = (await pgrest(`${TABLE}?${params.toString()}`, {
      method: "GET",
      prefer: "count=exact",
    })) as HistoryCase[];

    return { cases: cases ?? [], total: null };
  });

export const getHistoryStatusBreakdown = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ status: string; count: number }[]> => {
    // Cuenta por status agrupado vía PostgREST con `select=status,count` no es directo;
    // usamos el endpoint RPC genérico de PostgreSQL con un select agregado simulado.
    // Como PostgREST no soporta GROUP BY directamente, fetcheamos id+status y agregamos en JS.
    const rows = (await pgrest(
      `${TABLE}?select=status&limit=10000`,
      { method: "GET" }
    )) as { status: string | null }[];

    const counts = new Map<string, number>();
    for (const r of rows ?? []) {
      const s = r.status ?? "null";
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);
  }
);
