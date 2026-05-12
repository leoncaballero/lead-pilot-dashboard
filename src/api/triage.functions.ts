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
  hubspot_contact_id?: string | null;
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
  turn_number?: number | null;
  turn_type?: string | null;
  // Snapshot del hilo Smartlead capturado en ingesta (WF02 v2)
  thread_snapshot?: Array<{
    type?: string;
    seq?: number | null;
    time?: string | null;
    subject?: string | null;
    body_text?: string;
  }> | null;
  setter_email?: string | null;
  setter_name?: string | null;
  lead_resolved_name?: string | null;
  has_known_store?: boolean | null;
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

/**
 * Deshacer una acción de SDR (reject o deep review). Reset el caso a
 * pending_review limpiando sdr_action + edit_reason. Solo segura para
 * acciones que NO disparan envío real (reject, deep review). Aprobar y editar
 * disparan Smartlead inmediatamente — no hay forma de desenviar un email.
 */
export const undoSdrAction = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await updateCase(data.id, {
      sdr_action: null,
      sdr_user_id: null,
      sdr_action_timestamp: null,
      status: "pending_review",
      edit_reason: null,
    });
    await logEvent(data.id, "sdr_action_undone");
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

/**
 * Regenerar la respuesta de un caso con los prompts actualmente activos.
 *
 * Útil cuando editas un prompt en /prompts (nueva versión activa) y quieres
 * ver cómo respondería la IA AHORA para un caso ya clasificado con la versión
 * anterior, sin esperar a que entre un lead nuevo.
 *
 * Flujo:
 * 1. Carga el caso existente
 * 2. Carga prompts activos para (segmento, turn_type) — fallback a MEGA si no
 *    hay segment-specific
 * 3. Llama Anthropic 3 veces (serie): classifier → generator → validator
 * 4. UPDATE de la fila con nuevos outputs. Status vuelve a 'pending_review'
 *    y sdr_action a null (sin auto-send, requiere revisión humana otra vez)
 * 5. Loguea 'turn_1_regenerated' en activity_events
 */
export const regenerateCase = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(
    async ({
      data,
    }): Promise<{
      ok: boolean;
      error?: string;
    }> => {
      const anthKey = process.env.ANTHROPIC_API_KEY;
      if (!anthKey) return { ok: false, error: "ANTHROPIC_API_KEY no configurado" };

      const cParams = new URLSearchParams({
        id: `eq.${data.id}`,
        select: "*",
        limit: "1",
      });
      const cases = (await pgrest(`${TABLE}?${cParams.toString()}`, {
        method: "GET",
      })) as TriageCase[];
      if (!cases || cases.length === 0) {
        return { ok: false, error: "Caso no encontrado" };
      }
      const caseRow = cases[0];
      const segmento = caseRow.segmento ?? "MEGA";
      const turnType = caseRow.turn_type ?? "turn1";
      if (!caseRow.reply_original) {
        return { ok: false, error: "El caso no tiene reply_original — no se puede regenerar" };
      }

      const PROMPTS_TABLE = "cl001_p007_prompt_versions";
      type PromptRow = {
        id: string;
        prompt_type: string;
        segmento: string;
        prompt_system: string;
        model: string;
        temperature: number | null;
        max_tokens: number | null;
        version: string;
      };
      const pParams = new URLSearchParams({
        turn_type: `eq.${turnType}`,
        is_active: "eq.true",
        segmento: `in.(${segmento},MEGA)`,
        select:
          "id,prompt_type,segmento,prompt_system,model,temperature,max_tokens,version",
      });
      const prompts = ((await pgrest(`${PROMPTS_TABLE}?${pParams.toString()}`, {
        method: "GET",
      })) ?? []) as PromptRow[];
      function pick(type: "classifier" | "generator" | "validator"): PromptRow | null {
        const candidates = prompts.filter((p) => p.prompt_type === type);
        return (
          candidates.find((p) => p.segmento === segmento) ??
          candidates.find((p) => p.segmento === "MEGA") ??
          null
        );
      }
      const clsP = pick("classifier");
      const genP = pick("generator");
      const valP = pick("validator");
      if (!clsP || !genP || !valP) {
        return {
          ok: false,
          error: `Faltan prompts activos: classifier=${!!clsP}, generator=${!!genP}, validator=${!!valP} para turn_type=${turnType}`,
        };
      }

      // 1) Classifier
      const classifierUserMsg =
        `Asunto del hilo: "(no disponible en regenerate manual)"\n\n` +
        `Respuesta del lead:\n"""\n${caseRow.reply_original}\n"""`;
      const clsResp = await callAnthropic(anthKey, clsP, classifierUserMsg);
      if (!clsResp.ok) return { ok: false, error: `Classifier: ${clsResp.error}` };
      const classification = parseJsonish(clsResp.text);
      if (!classification) {
        return {
          ok: false,
          error: `Classifier devolvió texto no parseable como JSON: ${clsResp.text.slice(0, 200)}`,
        };
      }

      // 2) Generator
      const generatorUserMsg =
        `Datos del lead:\n- nombre: ${caseRow.lead_name ?? "Lead"}\n- email: ${
          caseRow.lead_email ?? "?"
        }\n- segmento: ${segmento}\n- setter: Laura\n\n` +
        `Reply original del lead:\n"""\n${caseRow.reply_original}\n"""\n\n` +
        `Output del clasificador:\n${JSON.stringify(classification, null, 2)}`;
      const genResp = await callAnthropic(anthKey, genP, generatorUserMsg);
      if (!genResp.ok) return { ok: false, error: `Generator: ${genResp.error}` };
      let turnGenerated: string;
      const genParsed = parseJsonish(genResp.text);
      if (genParsed && typeof genParsed.turn_1 === "string") {
        turnGenerated = genParsed.turn_1 as string;
      } else if (genParsed && typeof genParsed.turn_2 === "string") {
        turnGenerated = genParsed.turn_2 as string;
      } else if (
        genParsed &&
        typeof (genParsed as Record<string, unknown>).respuesta === "string"
      ) {
        turnGenerated = (genParsed as Record<string, unknown>).respuesta as string;
      } else {
        turnGenerated = genResp.text.trim();
      }

      // 3) Validator
      const validatorUserMsg =
        `Datos del lead:\n- nombre: ${caseRow.lead_name ?? "Lead"}\n- segmento: ${segmento}\n\n` +
        `Output del clasificador:\n${JSON.stringify(classification, null, 2)}\n\n` +
        `Output del generador (turn_1):\n"""\n${turnGenerated}\n"""`;
      const valResp = await callAnthropic(anthKey, valP, validatorUserMsg);
      if (!valResp.ok) return { ok: false, error: `Validator: ${valResp.error}` };
      const validation = parseJsonish(valResp.text);
      if (!validation) {
        return {
          ok: false,
          error: `Validator devolvió texto no parseable: ${valResp.text.slice(0, 200)}`,
        };
      }

      const patch = {
        classification_output: classification,
        patron: (classification as Record<string, unknown>).patron ?? null,
        turn_1_generated: turnGenerated,
        validation_output: validation,
        score: (validation as Record<string, unknown>).score ?? null,
        validado: (validation as Record<string, unknown>).validado ?? null,
        errores_criticos:
          (validation as Record<string, unknown>).errores_criticos ?? [],
        razones_fallo: (validation as Record<string, unknown>).razones_fallo ?? [],
        status: "pending_review",
        sdr_action: null,
      };
      await pgrest(`${TABLE}?id=eq.${encodeURIComponent(data.id)}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: JSON.stringify(patch),
      });

      await logEvent(data.id, "turn_1_regenerated", {
        classifier_version: clsP.version,
        generator_version: genP.version,
        validator_version: valP.version,
      });

      return { ok: true };
    }
  );

async function callAnthropic(
  apiKey: string,
  prompt: {
    prompt_system: string;
    model: string;
    temperature: number | null;
    max_tokens: number | null;
  },
  userMessage: string
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const includeTemp = !prompt.model.toLowerCase().includes("opus");
  const body: Record<string, unknown> = {
    model: prompt.model,
    max_tokens: prompt.max_tokens ?? 2048,
    system: prompt.prompt_system,
    messages: [{ role: "user", content: userMessage }],
  };
  if (includeTemp && typeof prompt.temperature === "number") {
    body.temperature = prompt.temperature;
  }
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const t = await resp.text();
      return { ok: false, error: `Anthropic ${resp.status}: ${t.slice(0, 200)}` };
    }
    const json = (await resp.json()) as { content?: Array<{ text?: string }> };
    return { ok: true, text: json.content?.[0]?.text ?? "" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function parseJsonish(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const t = text.trim();
  if (t.startsWith("{")) {
    try {
      return JSON.parse(t);
    } catch {
      /* sigue */
    }
  }
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* sigue */
    }
  }
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(t.slice(first, last + 1));
    } catch {
      return null;
    }
  }
  return null;
}
