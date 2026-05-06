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
  checks?: Record<string, boolean>;
  errores_criticos?: string[];
  razones_fallo?: string[];
  comentarios_adicionales?: string | null;
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
  created_at?: string | null;
  // Defensa progresiva: estos campos llegan tras ejecutar el ALTER TABLE
  // de extender pipeline (setting-pilot-extend-turns.sql). Mientras no exista
  // la columna en DB, vienen undefined → fallback a 'turn1' / 1 en la UI.
  turn_number?: number | null;
  turn_type?: string | null;
};

const TABLE = "cl001_p007_turn1_pipeline";
const ACTIVITY_TABLE = "cl001_p007_activity_events";
const EDIT_REASONS_TABLE = "cl001_p007_edit_reasons";

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

/**
 * Disparar el envío vía Smartlead llamando al webhook n8n del WF02 v2.
 * Endpoint: POST /webhook/turn1-send-from-lovable con { pipeline_id }.
 * Mientras el WF02 v2 esté en modo dry_run, marcará status='dry_run_only'
 * y NO enviará nada por Smartlead. Cuando se desactive dry_run, enviará real.
 *
 * Configurable via env var OUTBOUND_TURN1_SEND_WEBHOOK_URL.
 * Si no está configurada, usa el endpoint productivo conocido.
 */
async function triggerSendWebhook(pipelineId: string): Promise<void> {
  const webhookUrl =
    process.env.OUTBOUND_TURN1_SEND_WEBHOOK_URL ??
    "https://cion8napp.nexau.es/webhook/turn1-send-from-lovable";
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pipeline_id: pipelineId }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(
        `triggerSendWebhook failed [${res.status}] for pipeline ${pipelineId}: ${body}`
      );
      // No lanzamos error aquí: el row ya quedó en ready_to_send y el WF03 housekeeping
      // (cuando exista) podrá retomarlo, o el operador desde el dashboard.
    }
  } catch (err) {
    console.error(`triggerSendWebhook network error for pipeline ${pipelineId}:`, err);
  }
}

export const getTriageCases = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ cases: TriageCase[] }> => {
    // Modo "humano siempre revisa": mostrar TODOS los casos pending_review,
    // sin filtrar por score. La UI los agrupa visualmente por nivel de confianza.
    // Orden: más recientes primero (en lugar del antiguo asc por antigüedad).
    // select=* para resiliencia ante columnas nuevas (turn_number, turn_type, ...)
    // que se añadan a cl001_p007_turn1_pipeline. Si la lista hardcodeada incluye
    // una columna inexistente, PostgREST falla. Con * el componente las recoge
    // si están y falla a undefined si no.
    const params = new URLSearchParams({
      select: "*",
      status: "eq.pending_review",
      order: "created_at.desc.nullslast",
    });
    const data = (await pgrest(`${TABLE}?${params.toString()}`, {
      method: "GET",
    })) as TriageCase[];
    return { cases: data ?? [] };
  }
);

export const getRealtimeConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ url: string; anonKey: string } | null> => {
    const url = process.env.OUTBOUND_SUPABASE_URL;
    const anonKey = process.env.OUTBOUND_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return null;
    return { url: url.replace(/\/$/, ""), anonKey };
  }
);

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
    // Disparar el envío vía n8n WF02 v2 (Trigger B humano-en-loop)
    await triggerSendWebhook(data.id);
    return { ok: true };
  });

export const rejectCase = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { id: string; reasons?: string[]; otherReason?: string }) => data
  )
  .handler(async ({ data }) => {
    const allReasons = [
      ...(data.reasons ?? []),
      ...(data.otherReason ? [`otro: ${data.otherReason}`] : []),
    ];
    await updateCase(data.id, {
      sdr_action: "rejected",
      sdr_user_id: null,
      sdr_action_timestamp: new Date().toISOString(),
      status: "rejected",
      // Guardamos las razones en edit_reason (mismo campo que ediciones — generico
      // de "feedback del SDR sobre este caso") para no anadir columna nueva.
      edit_reason: allReasons.length > 0 ? allReasons.join(", ") : null,
    });

    // Persistimos cada razon individual en edit_reasons para analytics
    if (allReasons.length > 0) {
      try {
        await pgrest(EDIT_REASONS_TABLE, {
          method: "POST",
          prefer: "return=minimal",
          body: JSON.stringify(
            allReasons.map((reason) => ({
              pipeline_id: data.id,
              reason: `reject: ${reason}`,
            }))
          ),
        });
      } catch (err) {
        console.error("edit_reasons insert failed (reject):", err);
      }
    }

    await logEvent(data.id, "turn_1_rejected", { reasons: allReasons });
    // No se invoca el webhook: el caso queda como rejected sin envío.
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
    // No se invoca el webhook: el caso queda en revisión profunda hasta acción posterior.
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
            allReasons.map((reason) => ({ pipeline_id: data.id, reason }))
          ),
        });
      } catch (err) {
        console.error("edit_reasons insert failed:", err);
      }
    }

    await logEvent(data.id, "turn_1_edited", { reasons: allReasons });
    // Disparar el envío vía n8n WF02 v2 (Trigger B humano-en-loop)
    await triggerSendWebhook(data.id);
    return { ok: true };
  });
