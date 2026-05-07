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

export type PromptVersion = {
  id: string;
  prompt_type: PromptType;
  segmento: Segmento;
  turn_type: TurnType;
  version: string;
  prompt_system: string;
  model: string;
  temperature: number | null;
  max_tokens: number | null;
  is_active: boolean;
  description: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

const TABLE = "cl001_p007_prompt_versions";

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
      prompt_system: string;
      model?: string;
      temperature?: number;
      max_tokens?: number;
      description?: string;
      notes?: string;
      setActive: boolean;
    }) => data
  )
  .handler(async ({ data }) => {
    const filterParams = new URLSearchParams({
      prompt_type: `eq.${data.prompt_type}`,
      segmento: `eq.${data.segmento}`,
      turn_type: `eq.${data.turn_type}`,
      select: "version,model,temperature,max_tokens",
      order: "created_at.desc",
      limit: "100",
    });
    const existing = (await pgrest(`${TABLE}?${filterParams.toString()}`, {
      method: "GET",
    })) as Array<{ version: string; model: string; temperature: number | null; max_tokens: number | null }>;

    const nextVersion = computeNextVersion(existing.map((e) => e.version));
    const fallbackTemplate = existing[0];

    if (data.setActive && existing.length > 0) {
      const deactivateParams = new URLSearchParams({
        prompt_type: `eq.${data.prompt_type}`,
        segmento: `eq.${data.segmento}`,
        turn_type: `eq.${data.turn_type}`,
      });
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
          version: nextVersion,
          prompt_system: data.prompt_system,
          model: data.model ?? fallbackTemplate?.model ?? "claude-sonnet-4-6",
          temperature: data.temperature ?? fallbackTemplate?.temperature ?? 0,
          max_tokens: data.max_tokens ?? fallbackTemplate?.max_tokens ?? 2048,
          is_active: data.setActive,
          description: data.description ?? null,
          notes: data.notes ?? null,
        },
      ]),
    })) as PromptVersion[];

    return { ok: true, prompt: inserted?.[0] };
  });

/**
 * Activar una versión existente. Desactiva todas las otras de la misma
 * combinación (prompt_type, segmento, turn_type) y activa esta.
 */
export const activatePromptVersion = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const targetRows = (await pgrest(
      `${TABLE}?id=eq.${encodeURIComponent(data.id)}&select=prompt_type,segmento,turn_type`,
      { method: "GET" }
    )) as Array<{ prompt_type: string; segmento: string; turn_type: string }>;
    if (!targetRows || targetRows.length === 0) {
      throw new Error(`Prompt version ${data.id} not found`);
    }
    const target = targetRows[0];

    const deactivateParams = new URLSearchParams({
      prompt_type: `eq.${target.prompt_type}`,
      segmento: `eq.${target.segmento}`,
      turn_type: `eq.${target.turn_type}`,
    });
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

const PIPELINE_TABLE = "cl001_p007_turn1_pipeline";
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
