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
  /** Outcome a nivel de lead (no de pipeline row). Enriquecido en getTriageCases.
   *  Valores: booked, closed_won, closed_lost, attended, no_show, unsubscribe, null.
   *  Cuando un lead tiene varios outcomes, prevalece el más informativo
   *  (closed_won > closed_lost > attended > no_show > booked > unsubscribe). */
  lead_outcome?: string | null;
  /** Si el lead tiene una meeting agendada en el futuro (start_time > now),
   *  exponemos los datos mínimos para mostrar la bandera "ya tiene reunión
   *  próxima — no responder" en la tarjeta de Triage. Cubre tanto bookings
   *  atribuibles (outcome=booked) como los que entraron por otro canal
   *  (outcome=booked_other). Una meeting pasada NO popula este campo. */
  upcoming_meeting?: {
    start_time: string;
    title: string | null;
    outcome_type: "booked" | "booked_other";
  } | null;
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
    // Pending review: sin límite, todo lo que esté esperando revisión.
    const params = new URLSearchParams({
      select: "*",
      status: "eq.pending_review",
      order: "created_at.desc.nullslast",
    });
    const pendingData = ((await pgrest(`${TABLE}?${params.toString()}`, {
      method: "GET",
    })) ?? []) as TriageCase[];

    // Auto-rejected: solo últimos 7 días (acotado para no saturar). Sirve para
    // que el SDR pueda rescatar casos que el sistema descartó por error.
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const rejectedParams = new URLSearchParams({
      select: "*",
      status: "eq.auto_rejected",
      order: "created_at.desc.nullslast",
      limit: "200",
    });
    rejectedParams.append("created_at", `gte.${since}`);
    const rejectedData = ((await pgrest(`${TABLE}?${rejectedParams.toString()}`, {
      method: "GET",
    })) ?? []) as TriageCase[];

    const data = [...pendingData, ...rejectedData];

    // Enriquecer con outcome a nivel de LEAD (no de pipeline row):
    // Un lead se considera booked / won / lost si CUALQUIERA de sus filas
    // de pipeline (Turn 1, Turn 2, FU, etc.) tiene ese outcome registrado.
    // Importante: el outcome aquí refleja el ESTADO ACTUAL del lead, no
    // necesariamente del row mostrado en /triage.
    const emails = Array.from(
      new Set(
        data
          .map((c) => c.lead_email)
          .filter((x): x is string => !!x && x.length > 0)
      )
    );
    const leadOutcomes = new Map<string, string>();
    if (emails.length > 0) {
      // Chunk para evitar URLs gigantes
      const chunks: string[][] = [];
      for (let i = 0; i < emails.length; i += 80) chunks.push(emails.slice(i, i + 80));
      for (const chunk of chunks) {
        const idsList = chunk.map((e) => `"${e}"`).join(",");
        const opParams = new URLSearchParams({
          select:
            "outcome,occurred_at,cl001_p007_turn1_pipeline!inner(lead_email)",
          outcome: "in.(booked,closed_won,closed_lost,attended,no_show,unsubscribe)",
          order: "occurred_at.desc",
          limit: "1000",
        });
        opParams.append("cl001_p007_turn1_pipeline.lead_email", `in.(${idsList})`);
        try {
          type Row = {
            outcome: string;
            occurred_at: string;
            cl001_p007_turn1_pipeline: { lead_email: string } | null;
          };
          const rows = ((await pgrest(`${OUTCOMES_TABLE_FOR_TRIAGE}?${opParams.toString()}`, {
            method: "GET",
          })) ?? []) as Row[];
          // Prioridad: closed_won > closed_lost > attended > no_show > booked > unsubscribe
          // (queremos quedarnos con el más informativo si hay varios por lead)
          const priority: Record<string, number> = {
            closed_won: 6,
            closed_lost: 5,
            attended: 4,
            no_show: 3,
            booked: 2,
            unsubscribe: 1,
          };
          for (const r of rows) {
            const em = r.cl001_p007_turn1_pipeline?.lead_email;
            if (!em) continue;
            const prev = leadOutcomes.get(em);
            if (!prev || (priority[r.outcome] ?? 0) > (priority[prev] ?? 0)) {
              leadOutcomes.set(em, r.outcome);
            }
          }
        } catch (e) {
          // Si falla la enriquecimiento no rompe el endpoint
          console.error("triage outcomes enrichment failed:", e);
        }
      }
    }
    for (const c of data) {
      if (c.lead_email && leadOutcomes.has(c.lead_email)) {
        c.lead_outcome = leadOutcomes.get(c.lead_email) ?? null;
      }
    }

    // Enriquecimiento #2: meeting PRÓXIMA (start_time > now) por lead.
    // Indica que el lead ya tiene reunión pendiente (cualquier fuente) y el
    // SDR no debería responder. Una reunión pasada NO entra aquí porque el
    // lead vuelve a ser contactable si la cita ya quedó atrás.
    const upcomingByEmail = new Map<
      string,
      { start_time: string; title: string | null; outcome_type: "booked" | "booked_other" }
    >();
    if (emails.length > 0) {
      const nowIso = new Date().toISOString();
      const chunks2: string[][] = [];
      for (let i = 0; i < emails.length; i += 80) chunks2.push(emails.slice(i, i + 80));
      for (const chunk of chunks2) {
        const idsList = chunk.map((e) => `"${e}"`).join(",");
        const opParams = new URLSearchParams({
          select:
            "outcome,meeting_start_time,details,cl001_p007_turn1_pipeline!inner(lead_email)",
          outcome: "in.(booked,booked_other)",
          meeting_start_time: `gt.${nowIso}`,
          order: "meeting_start_time.asc",
          limit: "1000",
        });
        opParams.append("cl001_p007_turn1_pipeline.lead_email", `in.(${idsList})`);
        try {
          type Row = {
            outcome: "booked" | "booked_other";
            meeting_start_time: string | null;
            details: Record<string, unknown> | null;
            cl001_p007_turn1_pipeline: { lead_email: string } | null;
          };
          const rows = ((await pgrest(
            `${OUTCOMES_TABLE_FOR_TRIAGE}?${opParams.toString()}`,
            { method: "GET" }
          )) ?? []) as Row[];
          // Las filas vienen ordenadas asc por meeting_start_time, así que la
          // primera que veamos por lead = la próxima en el calendario.
          for (const r of rows) {
            const em = r.cl001_p007_turn1_pipeline?.lead_email;
            if (!em || !r.meeting_start_time) continue;
            if (upcomingByEmail.has(em)) continue;
            const title =
              r.details && typeof r.details["meeting_title"] === "string"
                ? (r.details["meeting_title"] as string)
                : null;
            upcomingByEmail.set(em, {
              start_time: r.meeting_start_time,
              title,
              outcome_type: r.outcome,
            });
          }
        } catch (e) {
          console.error("triage upcoming_meeting enrichment failed:", e);
        }
      }
    }
    for (const c of data) {
      if (c.lead_email && upcomingByEmail.has(c.lead_email)) {
        c.upcoming_meeting = upcomingByEmail.get(c.lead_email) ?? null;
      }
    }

    return { cases: data };
  }
);

const OUTCOMES_TABLE_FOR_TRIAGE = "cl001_p007_outcomes";

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
        subgroup: string | null;
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
          "id,prompt_type,segmento,subgroup,prompt_system,model,temperature,max_tokens,version",
      });
      const prompts = ((await pgrest(`${PROMPTS_TABLE}?${pParams.toString()}`, {
        method: "GET",
      })) ?? []) as PromptRow[];
      // Subgroup según has_known_store del row (mismo criterio que routing del WF02 v2)
      const subgroupKey: "has_store" | "no_store" | null =
        caseRow.has_known_store === true
          ? "has_store"
          : caseRow.has_known_store === false
          ? "no_store"
          : null;
      function pick(type: "classifier" | "generator" | "validator"): PromptRow | null {
        const candidates = prompts.filter((p) => p.prompt_type === type);
        // Orden: exact (seg+subgroup) > seg+null > MEGA+subgroup > MEGA+null
        return (
          (subgroupKey &&
            candidates.find(
              (p) => p.segmento === segmento && p.subgroup === subgroupKey
            )) ||
          candidates.find(
            (p) => p.segmento === segmento && (p.subgroup === null || p.subgroup === undefined)
          ) ||
          (subgroupKey &&
            candidates.find((p) => p.segmento === "MEGA" && p.subgroup === subgroupKey)) ||
          candidates.find(
            (p) => p.segmento === "MEGA" && (p.subgroup === null || p.subgroup === undefined)
          ) ||
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

      // 2) Generator — preferimos lead_resolved_name (de Smartlead) y el setter
      // real del hilo (no hardcoded Laura). Sin setter_name, dejamos al modelo
      // sin firma — el prompt v1.3 ya está blindado para no inventarse uno.
      const leadName =
        caseRow.lead_resolved_name ||
        caseRow.lead_name ||
        "(sin nombre — saluda sin nombre, NUNCA uses Lead como placeholder)";
      const setterFirstName = caseRow.setter_name
        ? caseRow.setter_name.trim().split(/\s+/)[0]
        : "";
      const generatorUserMsg =
        `Datos del lead:\n- nombre: ${leadName}\n- setter (la persona que firma este email): ${
          setterFirstName || "(no identificado — NO firmar)"
        }\n\n` +
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
        // Atribución exacta para A/B testing y stats.
        classifier_version_id: clsP.id,
        generator_version_id: genP.id,
        validator_version_id: valP.id,
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

/**
 * Override manual del has_known_store de un pipeline row. Útil cuando el
 * detector heurístico se equivocó (ej. dominio comercial que no matcheó la
 * regex) y queremos corregir antes de regenerar el Turn 1.
 *
 * Semántica del negocio:
 *   - MEGA    = lead sin tienda (aspiracional)
 *   - Genesis = lead con tienda (empresa establecida)
 *
 * Así que cambiar la flag implica también cambiar el segmento para mantener
 * coherencia con el resto del sistema (routing de prompts, stats, A/B):
 *   - has_known_store=true  → segmento='Genesis'  → usa prompt Genesis
 *   - has_known_store=false → segmento='MEGA'     → usa prompt MEGA/no_store
 *   - has_known_store=null  → segmento sin tocar  (no sabemos)
 *
 * Tras esto, normalmente se llama a regenerateCase para reconstruir el Turn 1
 * con el prompt apropiado al nuevo segmento+subgroup.
 */
export const setHasKnownStore = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { id: string; has_known_store: boolean | null }) => data
  )
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    // Cargar row para saber segmento previo (para log)
    const before = (await pgrest(
      `${TABLE}?id=eq.${encodeURIComponent(data.id)}&select=segmento,has_known_store&limit=1`,
      { method: "GET" }
    )) as Array<{ segmento: string | null; has_known_store: boolean | null }>;
    const prevSegment = before?.[0]?.segmento ?? null;
    const prevStore = before?.[0]?.has_known_store ?? null;

    const patch: Record<string, unknown> = {
      has_known_store: data.has_known_store,
    };
    let newSegment = prevSegment;
    if (data.has_known_store === true) {
      newSegment = "Genesis";
      patch.segmento = "Genesis";
    } else if (data.has_known_store === false) {
      newSegment = "MEGA";
      patch.segmento = "MEGA";
    }
    // null → segmento sin tocar (no sabemos qué es)

    await pgrest(`${TABLE}?id=eq.${encodeURIComponent(data.id)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: JSON.stringify(patch),
    });
    await logEvent(data.id, "has_known_store_manual_override", {
      new_value: data.has_known_store,
      previous_value: prevStore,
      segment_before: prevSegment,
      segment_after: newSegment,
    });
    return { ok: true };
  });

/**
 * Rescata un caso auto_rejected devolviéndolo a pending_review.
 *
 * Útil cuando el clasificador o validator descartó por error un lead que el
 * humano considera válido. Limpia los errores críticos del validation_output
 * (sin borrar el histórico — sólo vacía el array) para que el caso aparezca
 * "limpio" en /triage. Si quieres un nuevo Turn 1, tras rescatar llama a
 * regenerateCase desde la UI.
 */
export const rescueCase = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const before = (await pgrest(
      `${TABLE}?id=eq.${encodeURIComponent(data.id)}&select=status,validation_output&limit=1`,
      { method: "GET" }
    )) as Array<{ status: string | null; validation_output: Record<string, unknown> | null }>;
    if (!before?.[0]) return { ok: false, error: "Caso no encontrado" };
    if (before[0].status !== "auto_rejected") {
      return { ok: false, error: `El caso no está auto_rejected (status=${before[0].status})` };
    }
    // Limpia los flags de rechazo (mantenemos errores_criticos viejos en una
    // copia para auditoría, pero los vaciamos para que /triage no lo marque
    // rojo).
    const oldValidation = before[0].validation_output ?? {};
    const newValidation: Record<string, unknown> = {
      ...oldValidation,
      errores_criticos: [],
      razones_fallo: [],
      rescued_from_auto_rejected_at: new Date().toISOString(),
      original_errores_criticos: (oldValidation as Record<string, unknown>).errores_criticos ?? [],
      original_razones_fallo: (oldValidation as Record<string, unknown>).razones_fallo ?? [],
    };
    await pgrest(`${TABLE}?id=eq.${encodeURIComponent(data.id)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: JSON.stringify({
        status: "pending_review",
        validation_output: newValidation,
      }),
    });
    await logEvent(data.id, "case_rescued_from_auto_rejected");
    return { ok: true };
  });

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

/**
 * Canary metrics para un subgrupo (típicamente MEGA + no_store).
 * Devuelve los KPIs necesarios para saber si está listo para activar auto-send:
 * - approval-no-edit rate
 * - score≥95 hit rate
 * - aprobaciones consecutivas (proxy de estabilidad)
 *
 * Subgroup encoding:
 *   no_store: has_known_store === false
 *   has_store: has_known_store === true
 *   default: has_known_store IS NULL (todos sin clasificar todavía)
 */
export type CanaryMetrics = {
  segmento: string;
  subgroup: "no_store" | "has_store" | "default" | "all";
  pending_count: number;
  processed_count: number;
  approved_no_edit_count: number;
  edited_count: number;
  rejected_count: number;
  deep_review_count: number;
  score_ge_95_count: number;
  approval_rate: number;
  score_ge_95_rate: number;
  consecutive_approved_no_edit: number;
  ready_to_flip: boolean;
  ready_reason: string;
};

export const getCanaryMetrics = createServerFn({ method: "GET" })
  .inputValidator(
    (data: {
      segmento: string;
      subgroup: "no_store" | "has_store" | "default" | "all";
      limit?: number;
    }) => data
  )
  .handler(async ({ data }): Promise<CanaryMetrics> => {
    const limit = data.limit ?? 50;

    // 1. Count pending
    const pendingParams = new URLSearchParams({
      segmento: `eq.${data.segmento}`,
      status: "eq.pending_review",
      select: "id",
    });
    if (data.subgroup === "no_store") pendingParams.append("has_known_store", "is.false");
    else if (data.subgroup === "has_store") pendingParams.append("has_known_store", "is.true");
    else if (data.subgroup === "default") pendingParams.append("has_known_store", "is.null");
    const pendingRows = ((await pgrest(
      `${TABLE}?${pendingParams.toString()}`,
      { method: "GET" }
    )) ?? []) as Array<{ id: string }>;
    const pending_count = pendingRows.length;

    // 2. Last N processed (sdr_action not null)
    const processedParams = new URLSearchParams({
      segmento: `eq.${data.segmento}`,
      sdr_action: "not.is.null",
      select: "id,sdr_action,score,errores_criticos,sdr_action_timestamp",
      order: "sdr_action_timestamp.desc.nullslast",
      limit: String(limit),
    });
    if (data.subgroup === "no_store") processedParams.append("has_known_store", "is.false");
    else if (data.subgroup === "has_store") processedParams.append("has_known_store", "is.true");
    else if (data.subgroup === "default") processedParams.append("has_known_store", "is.null");
    type Row = {
      id: string;
      sdr_action: string | null;
      score: number | null;
      errores_criticos: string[] | null;
    };
    const processed = ((await pgrest(
      `${TABLE}?${processedParams.toString()}`,
      { method: "GET" }
    )) ?? []) as Row[];

    const processed_count = processed.length;
    let approved_no_edit_count = 0;
    let edited_count = 0;
    let rejected_count = 0;
    let deep_review_count = 0;
    let score_ge_95_count = 0;

    for (const r of processed) {
      if (r.sdr_action === "approved_as_is") approved_no_edit_count++;
      else if (r.sdr_action === "edited_and_sent") edited_count++;
      else if (r.sdr_action === "rejected") rejected_count++;
      else if (r.sdr_action === "sent_to_deep_review") deep_review_count++;
      if (typeof r.score === "number" && r.score >= 95) score_ge_95_count++;
    }

    // Consecutive approved-no-edit desde el más reciente hacia atrás
    let consecutive = 0;
    for (const r of processed) {
      if (r.sdr_action === "approved_as_is" && (r.errores_criticos?.length ?? 0) === 0) consecutive++;
      else break;
    }

    const approval_rate = processed_count > 0 ? approved_no_edit_count / processed_count : 0;
    const score_ge_95_rate = processed_count > 0 ? score_ge_95_count / processed_count : 0;

    // Criterios:
    // - approved_no_edit_count >= 20 absoluto
    // - approval_rate >= 0.8
    // - score_ge_95_rate >= 0.9
    // - consecutive >= 8 (estabilidad reciente)
    let ready_to_flip = false;
    let ready_reason = "";
    if (approved_no_edit_count < 20) {
      ready_reason = `Faltan ${20 - approved_no_edit_count} aprobaciones-sin-editar para llegar al mínimo de 20`;
    } else if (approval_rate < 0.8) {
      ready_reason = `Approval rate ${(approval_rate * 100).toFixed(0)}% < 80% mínimo`;
    } else if (score_ge_95_rate < 0.9) {
      ready_reason = `Score≥95 rate ${(score_ge_95_rate * 100).toFixed(0)}% < 90% mínimo`;
    } else if (consecutive < 8) {
      ready_reason = `Solo ${consecutive} aprobaciones consecutivas (mínimo 8)`;
    } else {
      ready_to_flip = true;
      ready_reason = "Todos los criterios cumplidos — listo para activar auto-send";
    }

    return {
      segmento: data.segmento,
      subgroup: data.subgroup,
      pending_count,
      processed_count,
      approved_no_edit_count,
      edited_count,
      rejected_count,
      deep_review_count,
      score_ge_95_count,
      approval_rate,
      score_ge_95_rate,
      consecutive_approved_no_edit: consecutive,
      ready_to_flip,
      ready_reason,
    };
  });
