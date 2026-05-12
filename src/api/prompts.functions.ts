import { createServerFn } from "@tanstack/react-start";

export type PromptType = "classifier" | "generator" | "validator";
export type Segmento = "MEGA" | "Genesis" | "Prosperitas" | "Polaris";
export type TurnType =
  | "turn1"
  | "turn2_generic"
  | "turn3_generic"
  | "follow_up_4h"
  | "follow_up_24h"
  | "follow_up_3d"
  | "objection_response"
  | "booking_propose";

export const PROMPT_TYPE_VALUES: PromptType[] = ["classifier", "generator", "validator"];
export const SEGMENTO_VALUES: Segmento[] = ["MEGA", "Genesis", "Prosperitas", "Polaris"];
export const TURN_TYPE_VALUES: TurnType[] = [
  "turn1",
  "turn2_generic",
  "turn3_generic",
  "follow_up_4h",
  "follow_up_24h",
  "follow_up_3d",
  "objection_response",
  "booking_propose",
];

export const DEFAULT_MODELS_BY_PROMPT_TYPE: Record<PromptType, string> = {
  classifier: "claude-haiku-4-5-20251001",
  generator: "claude-sonnet-4-6",
  validator: "claude-opus-4-7",
};

export const DEFAULT_MAX_TOKENS_BY_PROMPT_TYPE: Record<PromptType, number> = {
  classifier: 1024,
  generator: 4096,
  validator: 2048,
};

/**
 * Subgroup: sub-bifurcación dentro de un segmento. Hoy solo aplica a MEGA:
 * - 'no_store': lead sin evidencia de tienda online
 * - 'has_store': lead con evidencia de tienda online
 * - null: default del segmento (catch-all)
 *
 * Para otros segmentos (Genesis, etc.) siempre null por ahora.
 */
export type Subgroup = "no_store" | "has_store" | null;
export const SUBGROUP_VALUES_MEGA: Array<Exclude<Subgroup, null>> = ["no_store", "has_store"];

export type PromptVersion = {
  id: string;
  prompt_type: PromptType;
  segmento: Segmento;
  turn_type: TurnType;
  subgroup: Subgroup;
  version: string;
  prompt_system: string;
  model: string;
  temperature: number | null;
  max_tokens: number | null;
  is_active: boolean;
  /** Si true, este prompt puede activar el auto-send sin revisión humana
   *  cuando el validator devuelve score >= 95 y no errores críticos.
   *  Por defecto false — el SDR revisa todo. */
  auto_send_enabled: boolean;
  description: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

const TABLE = "cl001_p007_prompt_versions";
const PIPELINE_TABLE = "cl001_p007_turn1_pipeline";
const OUTCOMES_TABLE = "cl001_p007_outcomes";

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

export const listPrompts = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ prompts: PromptVersion[] }> => {
    const params = new URLSearchParams({
      select: "*",
      order: "turn_type.asc,prompt_type.asc,segmento.asc,is_active.desc,created_at.desc",
    });
    const data = (await pgrest(`${TABLE}?${params.toString()}`, {
      method: "GET",
    })) as PromptVersion[];
    return { prompts: data ?? [] };
  }
);

/**
 * Crea una nueva versión de prompt.
 *
 * Comportamiento:
 * - Auto-incrementa la versión basado en la última versión existente para
 *   (prompt_type, segmento, turn_type). v1.0 -> v1.1 -> v1.2 ...
 * - Si setActive=true: marca todas las otras versiones de la misma combinación
 *   como is_active=false antes de insertar la nueva. Solo una versión activa
 *   por combinación a la vez.
 */
export const createPromptVersion = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      prompt_type: PromptType;
      segmento: Segmento;
      turn_type: TurnType;
      subgroup?: Subgroup;
      prompt_system: string;
      model?: string;
      temperature?: number;
      max_tokens?: number;
      description?: string;
      notes?: string;
      setActive: boolean;
      auto_send_enabled?: boolean;
    }) => data
  )
  .handler(async ({ data }) => {
    const subgroup = data.subgroup ?? null;
    const filterParams = new URLSearchParams({
      prompt_type: `eq.${data.prompt_type}`,
      segmento: `eq.${data.segmento}`,
      turn_type: `eq.${data.turn_type}`,
      select: "version,model,temperature,max_tokens,subgroup",
      order: "created_at.desc",
      limit: "100",
    });
    // Filtro por subgroup: si subgroup es null, filtramos las que también lo tienen null (is.null)
    if (subgroup === null) {
      filterParams.append("subgroup", "is.null");
    } else {
      filterParams.append("subgroup", `eq.${subgroup}`);
    }
    const existing = (await pgrest(`${TABLE}?${filterParams.toString()}`, {
      method: "GET",
    })) as Array<{ version: string; model: string; temperature: number | null; max_tokens: number | null }>;

    const nextVersion = computeNextVersion(existing.map((e) => e.version));
    const fallbackTemplate = existing[0];

    if (data.setActive && existing.length > 0) {
      // Desactivar otras versiones del MISMO (prompt_type, segmento, turn_type, subgroup)
      const deactivateParams = new URLSearchParams({
        prompt_type: `eq.${data.prompt_type}`,
        segmento: `eq.${data.segmento}`,
        turn_type: `eq.${data.turn_type}`,
      });
      if (subgroup === null) deactivateParams.append("subgroup", "is.null");
      else deactivateParams.append("subgroup", `eq.${subgroup}`);
      await pgrest(`${TABLE}?${deactivateParams.toString()}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() }),
      });
    }

    const inserted = (await pgrest(TABLE, {
      method: "POST",
      prefer: "return=representation",
      body: JSON.stringify([
        {
          prompt_type: data.prompt_type,
          segmento: data.segmento,
          turn_type: data.turn_type,
          subgroup: subgroup,
          version: nextVersion,
          prompt_system: data.prompt_system,
          model: data.model ?? fallbackTemplate?.model ?? "claude-sonnet-4-6",
          temperature: data.temperature ?? fallbackTemplate?.temperature ?? 0,
          max_tokens: data.max_tokens ?? fallbackTemplate?.max_tokens ?? 2048,
          is_active: data.setActive,
          auto_send_enabled: data.auto_send_enabled ?? false,
          description: data.description ?? null,
          notes: data.notes ?? null,
        },
      ]),
    })) as PromptVersion[];

    return { ok: true, prompt: inserted?.[0] };
  });

/**
 * Activar una versión existente. Desactiva todas las otras de la misma
 * combinación (prompt_type, segmento, turn_type, subgroup) y activa esta.
 */
export const activatePromptVersion = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const targetRows = (await pgrest(
      `${TABLE}?id=eq.${encodeURIComponent(data.id)}&select=prompt_type,segmento,turn_type,subgroup`,
      { method: "GET" }
    )) as Array<{ prompt_type: string; segmento: string; turn_type: string; subgroup: string | null }>;
    if (!targetRows || targetRows.length === 0) {
      throw new Error(`Prompt version ${data.id} not found`);
    }
    const target = targetRows[0];

    const deactivateParams = new URLSearchParams({
      prompt_type: `eq.${target.prompt_type}`,
      segmento: `eq.${target.segmento}`,
      turn_type: `eq.${target.turn_type}`,
    });
    if (target.subgroup === null) deactivateParams.append("subgroup", "is.null");
    else deactivateParams.append("subgroup", `eq.${target.subgroup}`);
    await pgrest(`${TABLE}?${deactivateParams.toString()}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() }),
    });
    await pgrest(`${TABLE}?id=eq.${encodeURIComponent(data.id)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: JSON.stringify({ is_active: true, updated_at: new Date().toISOString() }),
    });
    return { ok: true };
  });

/**
 * Toggle auto_send_enabled de una versión. Útil para kill-switch rápido.
 */
export const setPromptAutoSend = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; auto_send_enabled: boolean }) => data)
  .handler(async ({ data }) => {
    await pgrest(`${TABLE}?id=eq.${encodeURIComponent(data.id)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: JSON.stringify({ auto_send_enabled: data.auto_send_enabled, updated_at: new Date().toISOString() }),
    });
    return { ok: true };
  });

/**
 * Sugerir mejoras al prompt activo basado en feedback humano reciente.
 *
 * Lee:
 * - El prompt actual de la combinación dada
 * - Los últimos N (default 30) edits con sus razones + diff (original vs editado)
 * - Los últimos N rejects con sus razones (prefijo "reject:")
 *
 * Llama a Claude Opus para que proponga una v2 del prompt con cambios mínimos
 * coherentes con los patrones de corrección humana detectados. NO sustituye al
 * humano: devuelve la sugerencia y un análisis, el humano decide si la guarda
 * como nueva versión.
 *
 * Necesita ANTHROPIC_API_KEY como secret en Lovable Cloud.
 */
export type SuggestPromptResponse = {
  ok: boolean;
  current_prompt?: string;
  suggested_prompt?: string;
  summary?: string;
  patterns_detected?: string[];
  num_edits_analyzed?: number;
  num_rejects_analyzed?: number;
  cost_tokens?: { input: number; output: number };
  error?: string;
};

const EDIT_REASONS_TABLE = "cl001_p007_edit_reasons";

export const suggestPromptImprovements = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      prompt_type: PromptType;
      segmento: Segmento;
      turn_type: TurnType;
      lookback_days?: number;
    }) => data
  )
  .handler(async ({ data }): Promise<SuggestPromptResponse> => {
    const anthKey = process.env.ANTHROPIC_API_KEY;
    if (!anthKey) {
      return {
        ok: false,
        error:
          "ANTHROPIC_API_KEY no configurado en Lovable Cloud. Añade el secret para usar 'Sugerir mejoras'.",
      };
    }

    const lookbackDays = data.lookback_days ?? 30;
    const since = new Date(
      Date.now() - lookbackDays * 24 * 3600 * 1000
    ).toISOString();

    // 1. Prompt activo actual
    const activePromptRows = (await pgrest(
      `${TABLE}?prompt_type=eq.${data.prompt_type}&segmento=eq.${data.segmento}&turn_type=eq.${data.turn_type}&is_active=eq.true&select=id,version,prompt_system&limit=1`,
      { method: "GET" }
    )) as Array<{ id: string; version: string; prompt_system: string }>;
    if (!activePromptRows || activePromptRows.length === 0) {
      return {
        ok: false,
        error: `No hay prompt activo para ${data.prompt_type}/${data.segmento}/${data.turn_type}`,
      };
    }
    const activePrompt = activePromptRows[0];

    // 2. Last N edits con turn_1 generado, turn_1 final, edit_reason, diff
    // Filtramos por segmento + sdr_action='edited_and_sent' + lookback
    type PipelineEditRow = {
      id: string;
      segmento: string | null;
      turn_type: string | null;
      turn_1_generated: string | null;
      turn_1_final: string | null;
      edit_reason: string | null;
      sdr_action_timestamp: string | null;
    };
    const editParams = new URLSearchParams({
      select:
        "id,segmento,turn_type,turn_1_generated,turn_1_final,edit_reason,sdr_action_timestamp",
      sdr_action: "eq.edited_and_sent",
      segmento: `eq.${data.segmento}`,
      order: "sdr_action_timestamp.desc.nullslast",
      limit: "30",
    });
    editParams.append("sdr_action_timestamp", `gte.${since}`);
    // Solo del mismo turn_type (los rejects de turn1 no informan al prompt de turn2)
    editParams.append("turn_type", `eq.${data.turn_type}`);
    const editRows = (await pgrest(
      `${PIPELINE_TABLE}?${editParams.toString()}`,
      { method: "GET" }
    )) as PipelineEditRow[];

    // 3. Last N rejects (con razones)
    type RejectReasonRow = { pipeline_id: string; reason: string; created_at: string | null };
    const rejectReasonsRows = (await pgrest(
      `${EDIT_REASONS_TABLE}?select=pipeline_id,reason,created_at&reason=like.reject:%25&order=created_at.desc.nullslast&limit=30&created_at=gte.${since}`,
      { method: "GET" }
    )) as RejectReasonRow[];

    // Filtrar reject reasons a sólo casos del mismo turn_type+segmento
    const rejectIds = (rejectReasonsRows ?? []).map((r) => r.pipeline_id);
    let rejectsBySegmentTurn: Set<string> = new Set();
    if (rejectIds.length > 0) {
      const inList = `(${rejectIds.map((i) => `"${i}"`).join(",")})`;
      const rejectPipelineRows = (await pgrest(
        `${PIPELINE_TABLE}?select=id&segmento=eq.${data.segmento}&turn_type=eq.${data.turn_type}&id=in.${inList}`,
        { method: "GET" }
      )) as Array<{ id: string }>;
      rejectsBySegmentTurn = new Set(rejectPipelineRows.map((r) => r.id));
    }
    const filteredRejects = (rejectReasonsRows ?? []).filter((r) =>
      rejectsBySegmentTurn.has(r.pipeline_id)
    );

    // 4. Construir el contexto para Claude
    const editsSummary = (editRows ?? [])
      .filter((e) => e.turn_1_generated && e.turn_1_final)
      .slice(0, 15)
      .map((e, i) => {
        const orig = (e.turn_1_generated ?? "").slice(0, 600);
        const final = (e.turn_1_final ?? "").slice(0, 600);
        return `--- Edit #${i + 1} (razones: ${e.edit_reason ?? "—"}) ---\nORIGINAL IA:\n${orig}\n\nVERSIÓN HUMANA:\n${final}`;
      })
      .join("\n\n");

    const rejectsSummary = filteredRejects
      .slice(0, 20)
      .map((r) => `- ${r.reason.replace(/^reject:\s*/, "")}`)
      .join("\n");

    const userPrompt = `Eres un experto en prompt engineering iterativo basado en feedback humano. Te paso:

1. El PROMPT actual del sistema (versión ${activePrompt.version})
2. ${editRows.length} ediciones humanas recientes del output del prompt (con la versión IA original y la versión humana corregida + razones citadas por el editor)
3. ${filteredRejects.length} rechazos humanos con sus razones

Tu trabajo: detectar PATRONES en las correcciones y proponer una versión mejorada del prompt (v2) que aborde esos patrones con cambios MÍNIMOS y QUIRÚRGICOS. NO reescribas todo. NO añadas reglas hipotéticas no fundamentadas en el feedback.

# PROMPT ACTUAL (v${activePrompt.version})

${activePrompt.prompt_system}

# EDICIONES HUMANAS RECIENTES (${editRows.length})

${editsSummary || "(ninguna en el periodo)"}

# RECHAZOS HUMANOS RECIENTES (${filteredRejects.length})

${rejectsSummary || "(ninguno en el periodo)"}

# FORMATO DE RESPUESTA

Devuelve EXCLUSIVAMENTE un JSON con esta estructura, sin markdown ni texto extra:

{
  "patterns_detected": ["patrón 1 corto y concreto", "patrón 2", ...],
  "summary": "Resumen 2-3 frases de qué cambio propones y por qué",
  "suggested_prompt": "<el prompt nuevo COMPLETO, listo para reemplazar al actual>"
}

Si no detectas patrones suficientemente fuertes (ej. <3 ediciones, ningún patrón claro repetido en al menos 2 casos), devuelve patterns_detected: [] y suggested_prompt igual al actual con summary explicando por qué no propones cambios.`;

    // 5. Llamar a Claude Opus
    let resp;
    try {
      resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": anthKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-opus-4-7",
          max_tokens: 8192,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });
    } catch (err) {
      return {
        ok: false,
        error: `Error llamando Anthropic: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (!resp.ok) {
      const body = await resp.text();
      return { ok: false, error: `Anthropic ${resp.status}: ${body.slice(0, 300)}` };
    }
    const respJson = (await resp.json()) as {
      content?: Array<{ text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = respJson.content?.[0]?.text ?? "";

    // Parse del JSON respuesta
    let parsed: {
      patterns_detected: string[];
      summary: string;
      suggested_prompt: string;
    };
    try {
      const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return {
        ok: false,
        error: `No pude parsear la respuesta de Claude. Texto: ${text.slice(0, 300)}`,
      };
    }

    return {
      ok: true,
      current_prompt: activePrompt.prompt_system,
      suggested_prompt: parsed.suggested_prompt,
      summary: parsed.summary,
      patterns_detected: parsed.patterns_detected ?? [],
      num_edits_analyzed: editRows.length,
      num_rejects_analyzed: filteredRejects.length,
      cost_tokens: {
        input: respJson.usage?.input_tokens ?? 0,
        output: respJson.usage?.output_tokens ?? 0,
      },
    };
  });

/**
 * Refinamiento conversacional de un prompt activo. Como una conversación con
 * Claude: el humano da feedback en lenguaje natural ("hazlo más informal",
 * "no menciones llamada de 15 min", "añade ejemplo de respuesta a Genesis"),
 * y Claude devuelve un prompt actualizado + explicación.
 *
 * Mantiene un thread de conversación (las turnos previos se incluyen como
 * contexto en cada llamada) para que el humano pueda iterar varias rondas
 * antes de guardar.
 */
export type ConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

export type RefinePromptResponse = {
  ok: boolean;
  /** Prompt resultante de la última iteración (si Claude lo modificó) */
  refined_prompt?: string;
  /** Texto explicativo de Claude sobre qué cambió y por qué */
  assistant_message?: string;
  /** Si el prompt no cambió respecto al input (Claude sólo respondió texto) */
  unchanged?: boolean;
  cost_tokens?: { input: number; output: number };
  error?: string;
};

export const refinePromptWithFeedback = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      /** Prompt actual sobre el que iterar (puede ser el activo o uno editado in-flight) */
      current_prompt: string;
      /** Identificación del prompt para contexto en el system prompt de Claude */
      prompt_type: PromptType;
      segmento: Segmento;
      turn_type: TurnType;
      /** Historia de conversación (roles user/assistant alternados, máx 20 turnos) */
      history: ConversationTurn[];
      /** Mensaje nuevo del usuario en este turno */
      user_message: string;
    }) => data
  )
  .handler(async ({ data }): Promise<RefinePromptResponse> => {
    const anthKey = process.env.ANTHROPIC_API_KEY;
    if (!anthKey) {
      return {
        ok: false,
        error: "ANTHROPIC_API_KEY no configurado en Lovable Cloud secrets",
      };
    }

    const systemPrompt = `Eres un experto en prompt engineering colaborando con un humano para refinar un prompt productivo. El prompt vive en una pipeline AI que genera/clasifica/valida emails outbound (segmento ${data.segmento}, turn_type ${data.turn_type}, prompt_type ${data.prompt_type}).

REGLAS DE TRABAJO

1. El humano te da feedback en lenguaje natural sobre cómo quiere que cambie el prompt.
2. Tu trabajo: aplicar ese feedback al prompt actual con cambios MÍNIMOS y QUIRÚRGICOS. No reescribas todo. No añadas reglas hipotéticas.
3. Si el feedback es ambiguo, pide clarificación EN VEZ DE editar el prompt.
4. Si el feedback ya está cubierto por el prompt actual, dilo y NO modifiques.
5. NUNCA elimines secciones críticas del prompt (FORMATO DE SALIDA, ESTRUCTURA JSON, COBERTURA TOTAL si existe).

FORMATO DE RESPUESTA (siempre JSON, sin markdown):

{
  "assistant_message": "Mensaje conversacional para el humano. Explicas qué cambiaste y por qué, o pides clarificación si dudas. 1-3 frases.",
  "refined_prompt": "<prompt completo con los cambios aplicados, listo para reemplazar al actual>",
  "unchanged": false
}

Si NO modificas el prompt (porque pides clarificación o el feedback no aplica):

{
  "assistant_message": "...",
  "refined_prompt": "<el mismo prompt, sin cambios>",
  "unchanged": true
}

PROMPT ACTUAL DEL HUMANO:

\`\`\`
${data.current_prompt}
\`\`\`

Responde SOLO con el JSON. No incluyas markdown ni texto extra.`;

    // Construir mensajes alternados user/assistant
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
    for (const t of data.history.slice(-20)) {
      // Aceptar solo turnos válidos en orden
      messages.push({ role: t.role, content: t.content });
    }
    messages.push({ role: "user", content: data.user_message });

    let resp;
    try {
      resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": anthKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-opus-4-7",
          max_tokens: 8192,
          system: systemPrompt,
          messages,
        }),
      });
    } catch (err) {
      return {
        ok: false,
        error: `Error llamando Anthropic: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (!resp.ok) {
      const body = await resp.text();
      return { ok: false, error: `Anthropic ${resp.status}: ${body.slice(0, 300)}` };
    }
    const respJson = (await resp.json()) as {
      content?: Array<{ text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = respJson.content?.[0]?.text ?? "";
    let parsed: { assistant_message?: string; refined_prompt?: string; unchanged?: boolean };
    try {
      const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return {
        ok: false,
        error: `No pude parsear la respuesta de Claude. Texto: ${text.slice(0, 300)}`,
      };
    }

    return {
      ok: true,
      refined_prompt: parsed.refined_prompt,
      assistant_message: parsed.assistant_message,
      unchanged: parsed.unchanged ?? parsed.refined_prompt === data.current_prompt,
      cost_tokens: {
        input: respJson.usage?.input_tokens ?? 0,
        output: respJson.usage?.output_tokens ?? 0,
      },
    };
  });

/**
 * Eval mode: ejecuta un prompt contra N test cases (samples reales o custom)
 * y devuelve los outputs para que el humano evalúe ANTES de activar el prompt.
 *
 * Flujo:
 * 1. Usuario edita/refina un prompt
 * 2. Antes de guardar, click "🧪 Evaluar" → eval contra N samples
 * 3. Ve outputs, decide si guardar/iterar
 *
 * Cada test case se ejecuta en paralelo (con max concurrency 5 para evitar
 * rate limit de Anthropic).
 */
/**
 * Intenta parsear como JSON un texto que podría venir envuelto en markdown
 * (```json ... ```), con prosa antes/después, o limpio. Si no encuentra JSON
 * válido, devuelve null.
 */
function tryParseJsonish(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const t = text.trim();
  // 1. ¿Es JSON limpio?
  if (t.startsWith("{")) {
    try {
      return JSON.parse(t);
    } catch {
      // sigue intentando
    }
  }
  // 2. Bloque markdown ```json...```
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // sigue intentando
    }
  }
  // 3. Buscar primer { y último } y probar
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

export type EvalTestCase = {
  id: string;
  /** El user message que se manda a Claude (lo que vería como input en el flujo real) */
  user_message: string;
  /** Etiqueta opcional para mostrar en la UI */
  label?: string;
};

export type EvalResult = {
  test_case_id: string;
  test_case_label?: string;
  test_case_input: string;
  output_raw: string;
  /** Si el prompt produce JSON parseable, lo expongo pretty-printed */
  output_parsed?: Record<string, unknown> | null;
  output_error?: string;
  duration_ms: number;
  tokens?: { input: number; output: number };
};

export type EvalResponse = {
  ok: boolean;
  results: EvalResult[];
  total_tokens: { input: number; output: number };
  total_duration_ms: number;
  error?: string;
};

export const evalPrompt = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      prompt_system: string;
      model: string;
      temperature?: number;
      max_tokens?: number;
      test_cases: EvalTestCase[];
    }) => data
  )
  .handler(async ({ data }): Promise<EvalResponse> => {
    const anthKey = process.env.ANTHROPIC_API_KEY;
    if (!anthKey) {
      return {
        ok: false,
        results: [],
        total_tokens: { input: 0, output: 0 },
        total_duration_ms: 0,
        error: "ANTHROPIC_API_KEY no configurado en Lovable Cloud secrets",
      };
    }
    if (data.test_cases.length === 0) {
      return {
        ok: true,
        results: [],
        total_tokens: { input: 0, output: 0 },
        total_duration_ms: 0,
      };
    }

    const includeTemperature = !data.model.toLowerCase().includes("opus");
    const start = Date.now();

    // Concurrencia 5 para no saturar rate limit
    const CONCURRENCY = 5;
    const results: EvalResult[] = [];

    async function runOne(tc: EvalTestCase): Promise<EvalResult> {
      const t0 = Date.now();
      try {
        const body: Record<string, unknown> = {
          model: data.model,
          max_tokens: data.max_tokens ?? 2048,
          system: data.prompt_system,
          messages: [{ role: "user", content: tc.user_message }],
        };
        if (includeTemperature && typeof data.temperature === "number") {
          body.temperature = data.temperature;
        }
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": anthKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        });
        if (!resp.ok) {
          const errText = await resp.text();
          return {
            test_case_id: tc.id,
            test_case_label: tc.label,
            test_case_input: tc.user_message,
            output_raw: "",
            output_error: `Anthropic ${resp.status}: ${errText.slice(0, 200)}`,
            duration_ms: Date.now() - t0,
          };
        }
        const json = (await resp.json()) as {
          content?: Array<{ text?: string }>;
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        const text = json.content?.[0]?.text ?? "";
        const parsed = tryParseJsonish(text);
        return {
          test_case_id: tc.id,
          test_case_label: tc.label,
          test_case_input: tc.user_message,
          output_raw: text,
          output_parsed: parsed,
          duration_ms: Date.now() - t0,
          tokens: {
            input: json.usage?.input_tokens ?? 0,
            output: json.usage?.output_tokens ?? 0,
          },
        };
      } catch (err) {
        return {
          test_case_id: tc.id,
          test_case_label: tc.label,
          test_case_input: tc.user_message,
          output_raw: "",
          output_error: err instanceof Error ? err.message : String(err),
          duration_ms: Date.now() - t0,
        };
      }
    }

    // Pool de concurrencia simple
    const queue = [...data.test_cases];
    async function worker() {
      while (queue.length > 0) {
        const tc = queue.shift();
        if (!tc) break;
        const r = await runOne(tc);
        results.push(r);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, data.test_cases.length) }, worker));

    // Reordenar resultados al orden original de test_cases
    const order = new Map(data.test_cases.map((tc, i) => [tc.id, i]));
    results.sort((a, b) => (order.get(a.test_case_id) ?? 0) - (order.get(b.test_case_id) ?? 0));

    const totalTokens = results.reduce(
      (acc, r) => ({
        input: acc.input + (r.tokens?.input ?? 0),
        output: acc.output + (r.tokens?.output ?? 0),
      }),
      { input: 0, output: 0 }
    );

    return {
      ok: true,
      results,
      total_tokens: totalTokens,
      total_duration_ms: Date.now() - start,
    };
  });

/**
 * Carga muestras de test cases desde el pipeline para usar en el eval.
 * Para classifier: replies originales recientes.
 * Para generator/validator: necesitan más contexto (clasificación + lead),
 * por ahora devolvemos sólo replies + el SDR construye el contexto manualmente
 * o copia del que vió en /history.
 */
export type EvalSample = {
  pipeline_id: string;
  lead_name: string | null;
  lead_email: string | null;
  segmento: string | null;
  reply_text: string;
  /** User message construido según el prompt_type (formato real que usaría n8n) */
  suggested_user_message: string;
};

export const getEvalSamples = createServerFn({ method: "GET" })
  .inputValidator(
    (data: {
      prompt_type: PromptType;
      segmento?: Segmento;
      turn_type: TurnType;
      limit?: number;
    }) => data
  )
  .handler(async ({ data }): Promise<{ samples: EvalSample[] }> => {
    const limit = data.limit ?? 10;
    const params = new URLSearchParams({
      select: "id,lead_name,lead_email,segmento,reply_original,classification_output,turn_1_generated",
      order: "created_at.desc.nullslast",
      limit: String(limit * 3), // sobre-fetch para filtrar
    });
    if (data.segmento) params.append("segmento", `eq.${data.segmento}`);
    type Row = {
      id: string;
      lead_name: string | null;
      lead_email: string | null;
      segmento: string | null;
      reply_original: string | null;
      classification_output: Record<string, unknown> | null;
      turn_1_generated: string | null;
    };
    const rows = (await pgrest(`${PIPELINE_TABLE}?${params.toString()}`, {
      method: "GET",
    })) as Row[];

    const filtered = (rows ?? []).filter((r) => r.reply_original && r.reply_original.trim().length > 5);
    const samples: EvalSample[] = filtered.slice(0, limit).map((r) => {
      let userMsg = "";
      if (data.prompt_type === "classifier") {
        // Mismo formato que usa el WF[01]
        userMsg = `Asunto del hilo: "(asunto del cold email)"\n\nRespuesta del lead:\n"""\n${r.reply_original}\n"""`;
      } else if (data.prompt_type === "generator") {
        // Generator necesita lead info + clasificación
        const clasif = r.classification_output ?? {};
        userMsg =
          `Datos del lead:\n- nombre: ${r.lead_name ?? "Lead"}\n- setter: Laura\n\n` +
          `Output del clasificador:\n${JSON.stringify(clasif, null, 2)}`;
      } else {
        // Validator necesita generator + classifier outputs
        userMsg =
          `Datos del lead:\n- nombre: ${r.lead_name ?? "Lead"}\n- setter: Laura\n\n` +
          `Output del clasificador:\n${JSON.stringify(r.classification_output ?? {}, null, 2)}\n\n` +
          `Output del generador:\n${r.turn_1_generated ?? "(no disponible)"}`;
      }
      return {
        pipeline_id: r.id,
        lead_name: r.lead_name,
        lead_email: r.lead_email,
        segmento: r.segmento,
        reply_text: r.reply_original ?? "",
        suggested_user_message: userMsg,
      };
    });

    return { samples };
  });

/**
 * Stats por versión: cuántas generaciones la usaron + outcomes (replied, booked).
 *
 * Atribución best-effort por ventana temporal:
 * Como el pipeline NO guarda qué prompt_version_id se usó, asumimos que cada
 * pipeline_row creado en (segmento, turn_type) entre [v.created_at, v_next.created_at)
 * fue procesado con la versión `v` (la activa en ese momento de esa combinación).
 *
 * Limitaciones:
 * - Si activas manualmente una versión vieja (botón "Activar" sobre una v anterior),
 *   las generaciones posteriores se atribuirán incorrectamente a la versión más reciente.
 * - Para precisión absoluta habría que añadir la columna prompt_version_id en pipeline
 *   y que n8n la rellene. Esto es la versión MVP que funciona retroactivamente sin
 *   tocar n8n.
 */
export type PromptVersionStats = {
  version_id: string;
  version: string;
  is_active: boolean;
  created_at: string | null;
  /** Pipeline rows atribuidos a esta versión */
  generated_count: number;
  /** De los atribuidos, cuántos replied */
  replied_count: number;
  /** De los atribuidos, cuántos booked */
  booked_count: number;
  /** Cerrado WON (venta) */
  closed_won_count: number;
  /** Cerrado LOST */
  closed_lost_count: number;
  reply_rate: number;
  booking_rate: number;
  win_rate: number;
};

export const getPromptStats = createServerFn({ method: "GET" })
  .inputValidator(
    (data: { prompt_type: PromptType; segmento: Segmento; turn_type: TurnType }) => data
  )
  .handler(async ({ data }): Promise<{ stats: PromptVersionStats[] }> => {
    // 1. Versiones de la combinación, en orden cronológico
    const vParams = new URLSearchParams({
      prompt_type: `eq.${data.prompt_type}`,
      segmento: `eq.${data.segmento}`,
      turn_type: `eq.${data.turn_type}`,
      select: "id,version,is_active,created_at",
      order: "created_at.asc",
    });
    type VRow = { id: string; version: string; is_active: boolean; created_at: string | null };
    const versions = ((await pgrest(`${TABLE}?${vParams.toString()}`, {
      method: "GET",
    })) ?? []) as VRow[];
    if (versions.length === 0) return { stats: [] };

    // 2. Pipeline rows de la misma (segmento, turn_type), creados desde el primer prompt
    const earliest = versions[0].created_at ?? new Date(0).toISOString();
    const pParams = new URLSearchParams({
      segmento: `eq.${data.segmento}`,
      turn_type: `eq.${data.turn_type}`,
      select: "id,created_at",
      order: "created_at.asc",
      limit: "5000",
    });
    pParams.append("created_at", `gte.${earliest}`);
    type PRow = { id: string; created_at: string };
    const pipelineRows = ((await pgrest(`${PIPELINE_TABLE}?${pParams.toString()}`, {
      method: "GET",
    })) ?? []) as PRow[];

    // 3. Outcomes de esos pipeline_ids
    const outcomeMap = await fetchOutcomeSetsForPipelines(pipelineRows.map((r) => r.id));

    // 4. Para cada versión calculamos la ventana [v.created_at, v_next.created_at)
    const stats: PromptVersionStats[] = versions.map((v, i) => {
      return computeStatsForVersion(v, i, versions, pipelineRows, outcomeMap);
    });

    return { stats };
  });

type OutcomeSets = {
  replied: Set<string>;
  booked: Set<string>;
  closed_won: Set<string>;
  closed_lost: Set<string>;
};

async function fetchOutcomeSetsForPipelines(pipelineIds: string[]): Promise<OutcomeSets> {
  const sets: OutcomeSets = {
    replied: new Set(),
    booked: new Set(),
    closed_won: new Set(),
    closed_lost: new Set(),
  };
  if (pipelineIds.length === 0) return sets;
  // PostgREST IN() limit prudent — chunkear en lotes de 200
  const chunks: string[][] = [];
  for (let i = 0; i < pipelineIds.length; i += 200) chunks.push(pipelineIds.slice(i, i + 200));
  for (const chunk of chunks) {
    const idsList = chunk.map((i) => `"${i}"`).join(",");
    const oParams = new URLSearchParams({
      select: "pipeline_id,outcome",
      outcome: "in.(replied,booked,closed_won,closed_lost)",
      limit: "10000",
    });
    oParams.append("pipeline_id", `in.(${idsList})`);
    type ORow = { pipeline_id: string; outcome: string };
    const outcomes = ((await pgrest(`${OUTCOMES_TABLE}?${oParams.toString()}`, {
      method: "GET",
    })) ?? []) as ORow[];
    for (const o of outcomes) {
      if (o.outcome === "replied") sets.replied.add(o.pipeline_id);
      else if (o.outcome === "booked") sets.booked.add(o.pipeline_id);
      else if (o.outcome === "closed_won") sets.closed_won.add(o.pipeline_id);
      else if (o.outcome === "closed_lost") sets.closed_lost.add(o.pipeline_id);
    }
  }
  return sets;
}

function computeStatsForVersion(
  v: { id: string; version: string; is_active: boolean; created_at: string | null },
  index: number,
  allVersions: Array<{ created_at: string | null }>,
  pipelineRows: Array<{ id: string; created_at: string }>,
  outcomes: OutcomeSets
): PromptVersionStats {
  const start = v.created_at ? Date.parse(v.created_at) : 0;
  const end =
    index + 1 < allVersions.length && allVersions[index + 1].created_at
      ? Date.parse(allVersions[index + 1].created_at!)
      : Number.POSITIVE_INFINITY;
  let generated = 0;
  let replied = 0;
  let booked = 0;
  let won = 0;
  let lost = 0;
  for (const r of pipelineRows) {
    const t = r.created_at ? Date.parse(r.created_at) : 0;
    if (t < start || t >= end) continue;
    generated++;
    if (outcomes.replied.has(r.id)) replied++;
    if (outcomes.booked.has(r.id)) booked++;
    if (outcomes.closed_won.has(r.id)) won++;
    if (outcomes.closed_lost.has(r.id)) lost++;
  }
  return {
    version_id: v.id,
    version: v.version,
    is_active: v.is_active,
    created_at: v.created_at,
    generated_count: generated,
    replied_count: replied,
    booked_count: booked,
    closed_won_count: won,
    closed_lost_count: lost,
    reply_rate: generated > 0 ? replied / generated : 0,
    booking_rate: generated > 0 ? booked / generated : 0,
    win_rate: generated > 0 ? won / generated : 0,
  };
}

/**
 * Stats de TODAS las versiones agrupadas por (turn_type, prompt_type, segmento).
 * Pensado para el dashboard de comparativa de prompts (`/prompt-performance`).
 *
 * Optimización: una sola query bulk de versions + una de pipeline (todas) +
 * una de outcomes (todas), sin viajar a la red por cada combinación.
 */
export type PromptComparisonRow = {
  combo_key: string;
  turn_type: TurnType;
  prompt_type: PromptType;
  segmento: Segmento;
  versions: PromptVersionStats[];
};

export const listAllPromptStats = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ rows: PromptComparisonRow[] }> => {
    // 1. Todas las versiones, ordenadas
    const vParams = new URLSearchParams({
      select: "id,version,is_active,created_at,prompt_type,segmento,turn_type",
      order: "turn_type.asc,prompt_type.asc,segmento.asc,created_at.asc",
      limit: "5000",
    });
    type VRow = {
      id: string;
      version: string;
      is_active: boolean;
      created_at: string | null;
      prompt_type: PromptType;
      segmento: Segmento;
      turn_type: TurnType;
    };
    const versions = ((await pgrest(`${TABLE}?${vParams.toString()}`, {
      method: "GET",
    })) ?? []) as VRow[];
    if (versions.length === 0) return { rows: [] };

    // 2. Set de (segmento, turn_type) que tienen alguna versión → pedimos solo esos
    const segTurnPairs = new Set(versions.map((v) => `${v.segmento}|${v.turn_type}`));

    // 3. Pipeline rows de TODOS esos (segmento, turn_type) en una query.
    // Agrupamos por (segmento, turn_type) en JS después.
    const earliestByCombo = new Map<string, string>();
    for (const v of versions) {
      const key = `${v.segmento}|${v.turn_type}`;
      const cur = earliestByCombo.get(key);
      if (!cur || (v.created_at && v.created_at < cur)) {
        earliestByCombo.set(key, v.created_at ?? new Date(0).toISOString());
      }
    }
    const earliestOverall =
      Array.from(earliestByCombo.values()).sort()[0] ?? new Date(0).toISOString();

    const pParams = new URLSearchParams({
      select: "id,created_at,segmento,turn_type",
      order: "created_at.asc",
      limit: "10000",
    });
    pParams.append("created_at", `gte.${earliestOverall}`);
    type PRow = {
      id: string;
      created_at: string;
      segmento: string;
      turn_type: string;
    };
    const allPipelineRows = ((await pgrest(`${PIPELINE_TABLE}?${pParams.toString()}`, {
      method: "GET",
    })) ?? []) as PRow[];

    // 4. Filter pipeline rows a los pares relevantes y agrupar
    const pipelineByCombo = new Map<string, Array<{ id: string; created_at: string }>>();
    for (const r of allPipelineRows) {
      const key = `${r.segmento}|${r.turn_type}`;
      if (!segTurnPairs.has(key)) continue;
      if (!pipelineByCombo.has(key)) pipelineByCombo.set(key, []);
      pipelineByCombo.get(key)!.push({ id: r.id, created_at: r.created_at });
    }

    // 5. Outcomes una sola vez, para todos los pipeline_ids relevantes
    const allRelevantIds = new Set<string>();
    for (const arr of pipelineByCombo.values()) {
      for (const r of arr) allRelevantIds.add(r.id);
    }
    const outcomes = await fetchOutcomeSetsForPipelines(Array.from(allRelevantIds));

    // 6. Agrupar versions por (turn_type, prompt_type, segmento) y computar stats
    const rowsMap = new Map<string, PromptComparisonRow>();
    for (const v of versions) {
      const key = `${v.turn_type}|${v.prompt_type}|${v.segmento}`;
      let row = rowsMap.get(key);
      if (!row) {
        row = {
          combo_key: key,
          turn_type: v.turn_type,
          prompt_type: v.prompt_type,
          segmento: v.segmento,
          versions: [],
        };
        rowsMap.set(key, row);
      }
    }
    // Para cada combo, ordenar versions cronológicamente y calcular stats
    for (const row of rowsMap.values()) {
      const versionsForCombo = versions
        .filter(
          (v) =>
            v.turn_type === row.turn_type &&
            v.prompt_type === row.prompt_type &&
            v.segmento === row.segmento
        )
        .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
      const segTurnKey = `${row.segmento}|${row.turn_type}`;
      const pipelineRows = pipelineByCombo.get(segTurnKey) ?? [];
      row.versions = versionsForCombo.map((v, i) =>
        computeStatsForVersion(v, i, versionsForCombo, pipelineRows, outcomes)
      );
    }

    return { rows: Array.from(rowsMap.values()) };
  }
);

function computeNextVersion(existing: string[]): string {
  if (existing.length === 0) return "v1.0";
  const nums = existing
    .map((v) => /^v(\d+)\.(\d+)$/.exec(v))
    .filter((m): m is RegExpExecArray => m != null)
    .map((m) => ({ major: Number(m[1]), minor: Number(m[2]) }));
  if (nums.length === 0) return "v1.0";
  const max = nums.reduce((a, b) =>
    a.major !== b.major ? (a.major > b.major ? a : b) : a.minor > b.minor ? a : b
  );
  return `v${max.major}.${max.minor + 1}`;
}
