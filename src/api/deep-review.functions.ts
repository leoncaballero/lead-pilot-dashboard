import { createServerFn } from "@tanstack/react-start";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

// Tipo local del row del pipeline tal y como lo retornamos en getDeepReviewCases.
// Se evita re-exportar desde triage.functions porque el import-protection plugin
// de Vite bloquea imports cross-/server/ desde el bundle cliente.
export type DeepReviewCase = {
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
  classification_output?: Record<string, JsonValue> | null;
  validation_output?: Record<string, JsonValue> | null;
  score?: number | null;
  validado?: boolean | null;
  errores_criticos?: string[] | null;
  razones_fallo?: string[] | null;
  status?: string | null;
};

const TABLE = "cl001_p007_turn1_pipeline";
const ACTIVITY_TABLE = "cl001_p007_activity_events";

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

async function logEvent(
  pipelineId: string,
  eventType: string,
  payload: Record<string, JsonValue> = {}
) {
  try {
    await pgrest(ACTIVITY_TABLE, {
      method: "POST",
      body: JSON.stringify({
        pipeline_id: pipelineId,
        event_type: eventType,
        payload,
      }),
    });
  } catch (err) {
    console.error("logEvent failed:", err);
  }
}

async function updateCase(caseId: string, patch: Record<string, JsonValue>) {
  await pgrest(`${TABLE}?id=eq.${encodeURIComponent(caseId)}`, {
    method: "PATCH",
    prefer: "return=minimal",
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

export const getDeepReviewCases = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ cases: DeepReviewCase[] }> => {
    // Casos en revisión profunda:
    //   - status='needs_deep_review' (score <85, ruteo automático del WF02 v2)
    //   - sdr_action='sent_to_deep_review' (mandados manualmente desde Triage)
    const params = new URLSearchParams({
      select:
        "id,smartlead_lead_id,smartlead_thread_id,lead_name,lead_email,reply_original,reply_timestamp,segmento,patron,turn_1_generated,classification_output,validation_output,score,validado,errores_criticos,razones_fallo,status",
      order: "reply_timestamp.asc.nullslast",
      or: "(status.eq.needs_deep_review,sdr_action.eq.sent_to_deep_review)",
      limit: "200",
    });
    const data = (await pgrest(`${TABLE}?${params.toString()}`, {
      method: "GET",
    })) as DeepReviewCase[];
    return { cases: data ?? [] };
  }
);

/**
 * Devolver caso a Triage Rápido. Útil cuando un caso fue mandado a Deep Review
 * por error o ya se ha refinado lo suficiente para volver al flujo estándar.
 */
export const returnToTriage = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await updateCase(data.id, {
      status: "pending_review",
      sdr_action: "returned_to_triage",
      sdr_action_timestamp: new Date().toISOString(),
    });
    await logEvent(data.id, "turn_1_returned_to_triage");
    return { ok: true };
  });
