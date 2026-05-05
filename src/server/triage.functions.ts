import { createServerFn } from "@tanstack/react-start";

export type TriageCase = {
  id: string;
  smartlead_lead_id?: string | null;
  smartlead_thread_id?: string | null;
  status?: string | null;
  score?: number | null;
  pattern?: string | null;
  lead_name?: string | null;
  lead_email?: string | null;
  original_reply?: string | null;
  generated_reply?: string | null;
  created_at?: string | null;
  attended_at?: string | null;
  attended_by?: string | null;
  [key: string]: string | number | boolean | null | undefined;
};

const TABLE = "cl001_p007_turn1_pipeline";

export const getTriageCases = createServerFn({ method: "GET" }).handler(
  async () => {
    const url = process.env.OUTBOUND_SUPABASE_URL;
    const key = process.env.OUTBOUND_SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "Outbound Supabase credentials are not configured. Add OUTBOUND_SUPABASE_URL and OUTBOUND_SUPABASE_SERVICE_ROLE_KEY as secrets."
      );
    }

    const params = new URLSearchParams({
      select: "*",
      status: "eq.pending_review",
      "score": "gte.85",
      order: "created_at.asc",
    });
    // PostgREST allows repeating filters on the same column
    params.append("score", "lte.94");

    const endpoint = `${url.replace(/\/$/, "")}/rest/v1/${TABLE}?${params.toString()}`;
    const res = await fetch(endpoint, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Accept-Profile": "public",
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Outbound DB request failed [${res.status}]: ${body}`);
    }

    const data = (await res.json()) as TriageCase[];
    return { cases: data };
  }
);
