import { createServerFn } from "@tanstack/react-start";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type ClassificationOutput = {
  patron?: string;
  tono_lead?: string;
  es_lead_valido?: boolean;
  pidio_canal_directo?: boolean;
  canal_pedido?: string;
  notas?: string;
  [key: string]: JsonValue | undefined;
};

export type ValidationOutput = {
  score?: number;
  validado?: boolean;
  checks_pasados?: number;
  checks_fallidos?: number;
  [key: string]: JsonValue | undefined;
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
const ACTIVITY_TABLE = "activity_events";
const EDIT_REASONS_TABLE = "edit_reasons";

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

async function pgrest(
  path: string,
  init: RequestInit & { prefer?: string } = {}
) {
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

export const getTriageCases = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ cases: TriageCase[] }> => {
    const params = new URLSearchParams({
      select:
        "id,smartlead_lead_id,smartlead_thread_id,lead_name,lead_email,reply_original,reply_timestamp,segmento,patron,turn_1_generated,classification_output,validation_output,score,validado,errores_criticos,razones_fallo,status",
      status: "eq.pending_review",
      score: "gte.85",
      order: "reply_timestamp.asc.nullslast",
    });
    params.append("score", "lte.94");
    const data = (await pgrest(`${TABLE}?${params.toString()}`, {
      method: "GET",
    })) as TriageCase[];
    return { cases: data ?? [] };
  }
);

async function logEvent(
  caseId: string,
  eventType: string,
  payload: Record<string, JsonValue> = {}
) {
  try {
    await pgrest(ACTIVITY_TABLE, {
      method: "POST",
      body: JSON.stringify({
        case_id: caseId,
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

export const approveCase = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; turn_1_generated: string }) => data)
  .handler(async ({ data }) => {
    await updateCase(data.id, {
      sdr_action: "approved_as_is",
      sdr_user_id: null,
      sdr_action_timestamp: new Date().toISOString(),
      turn_1_final: data.turn_1_generated,
      status: "ready_to_send",
    });
    await logEvent(data.id, "turn_1_approved");
    return { ok: true };
  });

export const rejectCase = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await updateCase(data.id, {
      sdr_action: "rejected",
      sdr_user_id: null,
      sdr_action_timestamp: new Date().toISOString(),
      status: "rejected",
    });
    await logEvent(data.id, "turn_1_rejected");
    return { ok: true };
  });

export const deepReviewCase = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await updateCase(data.id, {
      sdr_action: "sent_to_deep_review",
      sdr_user_id: null,
      sdr_action_timestamp: new Date().toISOString(),
    });
    await logEvent(data.id, "turn_1_sent_to_deep_review");
    return { ok: true };
  });

export const editCase = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      id: string;
      original: string;
      edited: string;
      reasons: string[];
      otherReason?: string;
    }) => data
  )
  .handler(async ({ data }) => {
    const allReasons = [
      ...data.reasons,
      ...(data.otherReason ? [`otro: ${data.otherReason}`] : []),
    ];
    await updateCase(data.id, {
      sdr_action: "edited_and_sent",
      sdr_user_id: null,
      sdr_action_timestamp: new Date().toISOString(),
      turn_1_final: data.edited,
      edit_reason: allReasons.join(", "),
      edit_diff: { original: data.original, edited: data.edited },
      status: "ready_to_send",
    });

    if (allReasons.length > 0) {
      try {
        await pgrest(EDIT_REASONS_TABLE, {
          method: "POST",
          prefer: "return=minimal",
          body: JSON.stringify(
            allReasons.map((reason) => ({ case_id: data.id, reason }))
          ),
        });
      } catch (err) {
        console.error("edit_reasons insert failed:", err);
      }
    }

    await logEvent(data.id, "turn_1_edited", { reasons: allReasons });
    return { ok: true };
  });
