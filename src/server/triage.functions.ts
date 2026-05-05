import { createServerFn } from "@tanstack/react-start";

export type ClassificationOutput = {
  patron?: string;
  tono_lead?: string;
  es_lead_valido?: boolean;
  pidio_canal_directo?: boolean;
  canal_pedido?: string;
  notas?: string;
  [key: string]: unknown;
};

export type ValidationOutput = {
  score?: number;
  validado?: boolean;
  checks_pasados?: number;
  checks_fallidos?: number;
  [key: string]: unknown;
};

export type TriageCase = {
  id: string;
  smartlead_lead_id?: string | null;
  smartlead_thread_id?: string | null;
  lead_name?: string | null;
  lead_email?: string | null;
  reply_original?: string | null;
  reply_timestamp?: string | null;
  segmento?: string | null;
  patron?: string | null;
  turn_1_generated?: string | null;
  classification_output?: ClassificationOutput | null;
  validation_output?: ValidationOutput | null;
  score?: number | null;
  validado?: boolean | null;
  errores_criticos?: string[] | null;
  razones_fallo?: string[] | null;
  status?: string | null;
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
      select:
        "id,smartlead_lead_id,smartlead_thread_id,lead_name,lead_email,reply_original,reply_timestamp,segmento,patron,turn_1_generated,classification_output,validation_output,score,validado,errores_criticos,razones_fallo,status",
      status: "eq.pending_review",
      score: "gte.85",
      order: "reply_timestamp.asc.nullslast",
    });
    params.append("score", "lte.94");

    const endpoint = `${url.replace(/\/$/, "")}/rest/v1/${TABLE}?${params.toString()}`;
    const res = await fetch(endpoint, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
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
