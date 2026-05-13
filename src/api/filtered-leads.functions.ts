import { createServerFn } from "@tanstack/react-start";

/**
 * Auditoría de leads filtrados por WF[01]: replies clasificados como
 * "Not interested", "Wrong person" o "Do Not Contact" (es decir, NO Interested).
 *
 * Estos leads nunca entran al pipeline ni a /triage, así que sin esta vista
 * son invisibles. La página /leads-filtrados existe para que un humano
 * pueda muestrear las clasificaciones y detectar:
 *   - Falsos negativos: leads que el clasificador marcó Not Interested pero
 *     en realidad estaban abiertos a continuar (sobre todo en confidence 60-80)
 *   - Patrones de redacción del lead que el prompt no maneja bien
 *   - Si necesitamos relajar/endurecer el criterio del prompt
 */

const TABLE = "lead_classifications";

const NEGATIVE_CATEGORIES = [
  "Not interested",
  "Wrong person",
  "Do Not Contact",
  "Manual Review",
] as const;

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
  if (!res.ok) {
    throw new Error(`pgrest ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const t = await res.text();
  return (t ? JSON.parse(t) : null) as T;
}

export type FilteredLeadRow = {
  lead_map_id: number;
  lead_id: number | null;
  campaign_id: number | null;
  categoria: string | null;
  categoria_secundaria: string | null;
  confidence: number | null;
  razon: string | null;
  needs_review: boolean | null;
  created_at: string | null;
};

export type FilteredLeadsResult = {
  rows: FilteredLeadRow[];
  total_in_window: number;
  truncated: boolean;
  window_days: number;
  fetched_at: string;
};

export const getFilteredLeads = createServerFn({ method: "GET" })
  .inputValidator(
    (data: { sinceDays?: number; limit?: number } | undefined) => data ?? {}
  )
  .handler(async ({ data }): Promise<FilteredLeadsResult> => {
    const limit = Math.min(Math.max(data?.limit ?? 500, 1), 1000);
    const sinceDays = data?.sinceDays ?? 14;
    const sinceIso = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();

    const categoryList = NEGATIVE_CATEGORIES.map((c) => `"${c}"`).join(",");
    const params = new URLSearchParams({
      select:
        "lead_map_id,lead_id,campaign_id,categoria,categoria_secundaria,confidence,razon,needs_review,created_at",
      order: "created_at.desc.nullslast",
      limit: String(limit + 1),
    });
    params.append("created_at", `gte.${sinceIso}`);
    const url = `${TABLE}?${params.toString()}&categoria=in.(${categoryList})`;
    const rowsPlus = await pgrest<FilteredLeadRow[]>(url);

    const truncated = rowsPlus.length > limit;
    const rows = truncated ? rowsPlus.slice(0, limit) : rowsPlus;

    return {
      rows,
      total_in_window: rows.length,
      truncated,
      window_days: sinceDays,
      fetched_at: new Date().toISOString(),
    };
  });
