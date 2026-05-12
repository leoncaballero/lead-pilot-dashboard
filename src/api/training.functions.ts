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

export type TrainingAttachment =
  | {
      type: "image";
      media_type: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
      data_base64: string;
      filename?: string;
    }
  | {
      type: "text";
      filename: string;
      content: string;
    };

export type TrainingMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: TrainingAttachment[];
  ts: string;
};

export type TrainingSession = {
  id: string;
  title: string;
  prompt_type: PromptType;
  segmento: Segmento;
  turn_type: TurnType;
  messages: TrainingMessage[];
  total_input_tokens: number;
  total_output_tokens: number;
  applied_to_version_id: string | null;
  created_at: string;
  updated_at: string;
};

const TABLE = "cl001_p007_training_sessions";
const PROMPTS_TABLE = "cl001_p007_prompt_versions";

function getCreds() {
  const url = process.env.OUTBOUND_SUPABASE_URL;
  const key = process.env.OUTBOUND_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Outbound Supabase no configurado");
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

function isMissingRelation(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message;
  return (
    m.includes("PGRST205") ||
    m.includes("42P01") ||
    m.includes("does not exist") ||
    m.includes("[404]")
  );
}

export type ListTrainingResult = {
  sessions: TrainingSession[];
  needs_migration?: boolean;
};

export const listTrainingSessions = createServerFn({ method: "GET" }).handler(
  async (): Promise<ListTrainingResult> => {
    try {
      const params = new URLSearchParams({
        select: "*",
        order: "updated_at.desc",
        limit: "200",
      });
      const rows = (await pgrest(`${TABLE}?${params.toString()}`, {
        method: "GET",
      })) as TrainingSession[];
      return { sessions: rows ?? [] };
    } catch (err) {
      if (isMissingRelation(err)) {
        return { sessions: [], needs_migration: true };
      }
      throw err;
    }
  }
);

export const getTrainingSession = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<TrainingSession | null> => {
    const params = new URLSearchParams({
      id: `eq.${data.id}`,
      select: "*",
      limit: "1",
    });
    const rows = (await pgrest(`${TABLE}?${params.toString()}`, {
      method: "GET",
    })) as TrainingSession[];
    return rows?.[0] ?? null;
  });

export const createTrainingSession = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      title: string;
      prompt_type: PromptType;
      segmento: Segmento;
      turn_type: TurnType;
    }) => data
  )
  .handler(async ({ data }): Promise<{ session: TrainingSession }> => {
    const inserted = (await pgrest(TABLE, {
      method: "POST",
      prefer: "return=representation",
      body: JSON.stringify([
        {
          title: data.title,
          prompt_type: data.prompt_type,
          segmento: data.segmento,
          turn_type: data.turn_type,
          messages: [],
        },
      ]),
    })) as TrainingSession[];
    return { session: inserted[0] };
  });

export const deleteTrainingSession = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    await pgrest(`${TABLE}?id=eq.${encodeURIComponent(data.id)}`, {
      method: "DELETE",
      prefer: "return=minimal",
    });
    return { ok: true };
  });

export const renameTrainingSession = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; title: string }) => data)
  .handler(async ({ data }) => {
    await pgrest(`${TABLE}?id=eq.${encodeURIComponent(data.id)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: JSON.stringify({ title: data.title, updated_at: new Date().toISOString() }),
    });
    return { ok: true };
  });

/**
 * Añade un mensaje del usuario a la sesión y obtiene la respuesta del coach AI.
 * Llama a Anthropic con el system prompt de coach + historial completo.
 * Persiste tanto el user message como la respuesta.
 */
export const appendTrainingMessage = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      session_id: string;
      content: string;
      attachments?: TrainingAttachment[];
    }) => data
  )
  .handler(
    async ({
      data,
    }): Promise<{
      ok: boolean;
      session?: TrainingSession;
      error?: string;
    }> => {
      const anthKey = process.env.ANTHROPIC_API_KEY;
      if (!anthKey) {
        return { ok: false, error: "ANTHROPIC_API_KEY no configurado" };
      }
      const sParams = new URLSearchParams({
        id: `eq.${data.session_id}`,
        select: "*",
        limit: "1",
      });
      const sessions = (await pgrest(`${TABLE}?${sParams.toString()}`, {
        method: "GET",
      })) as TrainingSession[];
      if (!sessions || sessions.length === 0) {
        return { ok: false, error: "Sesión no encontrada" };
      }
      const session = sessions[0];

      const pParams = new URLSearchParams({
        prompt_type: `eq.${session.prompt_type}`,
        segmento: `eq.${session.segmento}`,
        turn_type: `eq.${session.turn_type}`,
        is_active: "eq.true",
        select: "id,version,prompt_system",
        limit: "1",
      });
      const prompts = (await pgrest(`${PROMPTS_TABLE}?${pParams.toString()}`, {
        method: "GET",
      })) as Array<{ id: string; version: string; prompt_system: string }>;
      const activePrompt = prompts?.[0] ?? null;

      const systemPrompt = buildCoachSystemPrompt({
        prompt_type: session.prompt_type,
        segmento: session.segmento,
        turn_type: session.turn_type,
        active_version: activePrompt?.version ?? "(ninguna)",
        active_prompt_text: activePrompt?.prompt_system ?? "(sin prompt activo aún)",
      });

      const userMessage: TrainingMessage = {
        role: "user",
        content: data.content,
        attachments: data.attachments,
        ts: new Date().toISOString(),
      };

      // Construir mensajes para Anthropic — historial + nuevo user msg
      const anthropicMessages: Array<{
        role: "user" | "assistant";
        content: AnthropicContentBlock[] | string;
      }> = [
        ...session.messages.map((m) => toAnthropicMessage(m)),
        toAnthropicMessage(userMessage),
      ];

      // Tool-use loop. Max 5 iteraciones para evitar bucles infinitos.
      // En cada iteración: llamamos a Anthropic con tools, si stop_reason=tool_use
      // ejecutamos las tools, append tool_results, repetimos. Si end_turn → tomamos el texto.
      let finalText = "";
      let totalIn = 0;
      let totalOut = 0;
      const toolCallsSummary: string[] = [];
      for (let iter = 0; iter < 5; iter++) {
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": anthKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 4096,
            system: systemPrompt,
            tools: COACH_TOOLS,
            messages: anthropicMessages,
          }),
        });
        if (!resp.ok) {
          const txt = await resp.text();
          return { ok: false, error: `Anthropic ${resp.status}: ${txt.slice(0, 300)}` };
        }
        const aj = (await resp.json()) as {
          stop_reason?: string;
          content?: AnthropicContentBlock[];
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        totalIn += aj.usage?.input_tokens ?? 0;
        totalOut += aj.usage?.output_tokens ?? 0;
        const contentBlocks = aj.content ?? [];
        // Anexamos el turno del asistente al historial (necesario para tool_use)
        anthropicMessages.push({ role: "assistant", content: contentBlocks });

        if (aj.stop_reason === "tool_use") {
          // Recoger tool_use blocks y ejecutarlos
          const toolUseBlocks = contentBlocks.filter(
            (b): b is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
              b.type === "tool_use"
          );
          const toolResults: Array<{
            type: "tool_result";
            tool_use_id: string;
            content: string;
          }> = [];
          for (const tu of toolUseBlocks) {
            try {
              const result = await executeCoachTool(tu.name, tu.input, session);
              toolResults.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: typeof result === "string" ? result : JSON.stringify(result),
              });
              toolCallsSummary.push(`${tu.name}(${formatToolInput(tu.input)})`);
            } catch (e) {
              toolResults.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: `Error: ${e instanceof Error ? e.message : String(e)}`,
              });
            }
          }
          anthropicMessages.push({ role: "user", content: toolResults });
          // Loop al siguiente iter para que el asistente responda con los resultados
          continue;
        }

        // end_turn (o stop_sequence / max_tokens) → extraer texto y salir
        for (const b of contentBlocks) {
          if (b.type === "text") finalText += b.text;
        }
        break;
      }

      if (!finalText) finalText = "(sin respuesta)";

      // Si hubo tool calls, anteponer un resumen pequeño al texto guardado
      // (para que en el chat se vea "🔍 Consultó X casos del pipeline" sin tener
      // que parsear la API). Si solo hubo una sin filtros, simplificamos.
      const summaryPrefix = toolCallsSummary.length > 0
        ? `_🔍 ${toolCallsSummary.join(" · ")}_\n\n`
        : "";

      const assistantMessage: TrainingMessage = {
        role: "assistant",
        content: summaryPrefix + finalText,
        ts: new Date().toISOString(),
      };
      const inTok = totalIn;
      const outTok = totalOut;

      // 6. Persistir ambos
      const updatedMessages = [...session.messages, userMessage, assistantMessage];
      const patchBody = {
        messages: updatedMessages,
        total_input_tokens: session.total_input_tokens + inTok,
        total_output_tokens: session.total_output_tokens + outTok,
        updated_at: new Date().toISOString(),
      };
      const updated = (await pgrest(`${TABLE}?id=eq.${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        prefer: "return=representation",
        body: JSON.stringify(patchBody),
      })) as TrainingSession[];
      return { ok: true, session: updated?.[0] ?? { ...session, ...patchBody } as TrainingSession };
    }
  );

/**
 * A partir de la conversación, pide a Anthropic que sintetice una nueva versión
 * del prompt activo + descripción. NO la activa todavía — devuelve el draft para
 * que el usuario lo revise y decida si crear/activar.
 */
export const synthesizePromptFromTraining = createServerFn({ method: "POST" })
  .inputValidator((data: { session_id: string }) => data)
  .handler(
    async ({
      data,
    }): Promise<{
      ok: boolean;
      proposed_prompt?: string;
      proposed_description?: string;
      reasoning?: string;
      error?: string;
    }> => {
      const anthKey = process.env.ANTHROPIC_API_KEY;
      if (!anthKey) return { ok: false, error: "ANTHROPIC_API_KEY no configurado" };

      const sParams = new URLSearchParams({
        id: `eq.${data.session_id}`,
        select: "*",
        limit: "1",
      });
      const sessions = (await pgrest(`${TABLE}?${sParams.toString()}`, {
        method: "GET",
      })) as TrainingSession[];
      if (!sessions || sessions.length === 0) {
        return { ok: false, error: "Sesión no encontrada" };
      }
      const session = sessions[0];
      if (session.messages.length === 0) {
        return { ok: false, error: "La sesión no tiene conversación todavía" };
      }

      const pParams = new URLSearchParams({
        prompt_type: `eq.${session.prompt_type}`,
        segmento: `eq.${session.segmento}`,
        turn_type: `eq.${session.turn_type}`,
        is_active: "eq.true",
        select: "version,prompt_system",
        limit: "1",
      });
      const prompts = (await pgrest(`${PROMPTS_TABLE}?${pParams.toString()}`, {
        method: "GET",
      })) as Array<{ version: string; prompt_system: string }>;
      const activePrompt = prompts?.[0] ?? null;

      const synthSystem = `Eres un asistente experto en prompt engineering para Setting Pilot (sistema de cold email reply management).

Acabas de tener una conversación de entrenamiento con León (CRO) sobre cómo mejorar el prompt:
- prompt_type: ${session.prompt_type}
- segmento: ${session.segmento}
- turn_type: ${session.turn_type}

Prompt actual activo (versión ${activePrompt?.version ?? "ninguna"}):
"""
${activePrompt?.prompt_system ?? "(sin prompt activo, empezamos de cero)"}
"""

Tu tarea AHORA: tomar toda la conversación + adjuntos (ejemplos, imágenes, feedback) y sintetizar una NUEVA versión del prompt que integre las mejoras que se discutieron.

Reglas:
- Conserva la estructura general del prompt actual (sections, formato de output JSON si aplica). No reescribas desde cero salvo que esté justificado.
- Aplica TODOS los aprendizajes acumulados en la conversación.
- Si la conversación discutió ejemplos concretos (entradas/salidas deseadas), incorpóralos como few-shot o como reglas explícitas según corresponda.
- Si hay imágenes, asume que ilustran casos del flujo real y úsalas como inspiración (no las describas literalmente en el prompt).

Devuelve ESTRICTAMENTE JSON con esta forma:
{
  "proposed_prompt": "<texto completo del nuevo prompt_system>",
  "proposed_description": "<descripción corta, 1 línea, qué cambió>",
  "reasoning": "<2-4 líneas explicando los cambios principales y por qué>"
}

Sin markdown, sin prosa fuera del JSON.`;

      // Construir el historial: solo los mensajes (Anthropic con system separado)
      const anthropicMessages = session.messages.map((m) => toAnthropicMessage(m));
      // Cerrar con una instrucción final
      anthropicMessages.push({
        role: "user",
        content: [
          {
            type: "text",
            text: "Sintetiza ahora la nueva versión del prompt. Responde SOLO con el JSON pedido.",
          },
        ],
      });

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": anthKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-opus-4-7",
          max_tokens: 8000,
          system: synthSystem,
          messages: anthropicMessages,
        }),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        return { ok: false, error: `Anthropic ${resp.status}: ${txt.slice(0, 300)}` };
      }
      const aj = (await resp.json()) as {
        content?: Array<{ text?: string }>;
      };
      const raw = aj.content?.[0]?.text ?? "";
      // Strip fences si los hay
      const cleaned = raw
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```\s*$/i, "")
        .trim();
      try {
        const parsed = JSON.parse(cleaned) as {
          proposed_prompt: string;
          proposed_description: string;
          reasoning: string;
        };
        return {
          ok: true,
          proposed_prompt: parsed.proposed_prompt,
          proposed_description: parsed.proposed_description,
          reasoning: parsed.reasoning,
        };
      } catch (e) {
        return {
          ok: false,
          error: `Anthropic no devolvió JSON parseable: ${(e as Error).message}`,
        };
      }
    }
  );

// ===================== helpers =====================

function buildCoachSystemPrompt(args: {
  prompt_type: PromptType;
  segmento: Segmento;
  turn_type: TurnType;
  active_version: string;
  active_prompt_text: string;
}): string {
  return `Eres un coach de IA para Setting Pilot. León (CRO de Consultoria.io) te está usando para entrenar y refinar prompts de su sistema de cold email reply management.

CONTEXTO DE ESTA SESIÓN:
- prompt_type: ${args.prompt_type}
- segmento: ${args.segmento}
- turn_type: ${args.turn_type}
- versión activa: ${args.active_version}

PROMPT ACTIVO ACTUAL:
"""
${args.active_prompt_text}
"""

HERRAMIENTAS DISPONIBLES (tool use):
Tienes acceso a estas tools para consultar el historial real del pipeline de León — úsalas proactivamente cuando él te pida casos reales o cuando lo necesites para iterar mejor:

1. **get_recent_cases** — Trae N casos reales recientes del pipeline. Filtros: segmento, turn_type, solo válidos, solo con respuesta generada, score mínimo. Devuelve para cada caso: lead_name, lead_email, segmento, reply_original, turn_1_generated, classification_output (patrón, tono, válido…), score, status, fecha.

2. **get_case_full_context** — Para hacer "zoom in" en un caso concreto. Devuelve el contexto rico de HubSpot (lifecycle, empresa, última reunión, llamadas recientes) y el hilo completo de Smartlead.

León típicamente te pedirá algo como "mándame 10 casos reales MEGA Turn 1" — llama a get_recent_cases con los filtros adecuados (segmento=MEGA, turn_type=turn1, only_with_response=true por defecto). Presenta los casos numerados, con la info esencial: lead, segmento+patrón+score, reply del lead, propuesta IA. Luego espera su input por cada caso.

Por defecto los filtros: usa los de la sesión (prompt_type, segmento, turn_type) salvo que León pida otra cosa.

CÓMO COMPORTARTE:
1. León te enviará ejemplos (mensajes reales, capturas de pantalla, casos), feedback en lenguaje natural, e ideas sueltas sobre cómo debería comportarse este prompt.
2. Tu trabajo es:
   - Escuchar y entender. Hacer preguntas clarificadoras si algo está ambiguo.
   - Cuando pida casos reales, usa get_recent_cases inmediatamente — no inventes, no propongas casos simulados. Si la herramienta devuelve menos de los pedidos, di "solo hay N en el historial".
   - Conectar lo que dice con el prompt actual: "esto chocaría con la regla X que tienes ahora", "esto sería una sección nueva", etc.
   - Proponer ediciones concretas cuando el feedback sea claro. Muestra antes/después en bloques de código cuando edites secciones.
   - Cuando León pida "guarda esto" o "aplica los cambios" o similar, NO intentes generar el prompt completo en el chat — limítate a confirmarle que use el botón "🪄 Sintetizar nueva versión" abajo a la derecha, que lo hará en un solo paso usando toda la conversación.
3. Si recibes imágenes, asume que son capturas reales del flujo (replies de leads, pantallas de triage, etc.). Coméntalas como contexto.

ESTILO:
- Responde en español.
- Conciso. Frases cortas. Evita prosa innecesaria.
- Marca propuestas concretas con un emoji ✏️ y el texto exacto a añadir/cambiar.`;
}

// ===== Tool use =====

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

const COACH_TOOLS = [
  {
    name: "get_recent_cases",
    description:
      "Trae casos REALES recientes del pipeline para que el coach los presente a León y trabajen sobre ellos. Devuelve lead info + reply + turn_1 generado + classification + score. Por defecto filtra por la sesión actual.",
    input_schema: {
      type: "object",
      properties: {
        segmento: {
          type: "string",
          enum: ["MEGA", "Genesis", "Prosperitas", "Polaris"],
          description: "Filtrar por segmento. Si se omite usa el de la sesión.",
        },
        turn_type: {
          type: "string",
          description:
            "turn1 | turn2_generic | follow_up_4h | etc. Si se omite usa el de la sesión.",
        },
        limit: {
          type: "integer",
          description: "Cuántos casos traer (1-20). Por defecto 10.",
          minimum: 1,
          maximum: 20,
        },
        only_with_response: {
          type: "boolean",
          description:
            "Si true, solo casos donde turn_1_generated no es null (default true).",
        },
        only_valid: {
          type: "boolean",
          description:
            "Si true, solo casos donde la IA clasificó es_lead_valido=true.",
        },
        min_score: {
          type: "integer",
          description: "Score mínimo del validador (0-100). Omitir si no filtra.",
          minimum: 0,
          maximum: 100,
        },
        max_score: {
          type: "integer",
          description: "Score máximo del validador (0-100). Útil para casos problemáticos.",
          minimum: 0,
          maximum: 100,
        },
      },
    },
  },
  {
    name: "get_case_full_context",
    description:
      "Zoom in en un caso concreto. Devuelve contexto rico de HubSpot (contacto, empresa, última reunión, llamadas) + hilo completo de Smartlead.",
    input_schema: {
      type: "object",
      properties: {
        case_id: {
          type: "string",
          description: "UUID del caso (id de la fila en cl001_p007_turn1_pipeline).",
        },
      },
      required: ["case_id"],
    },
  },
];

async function executeCoachTool(
  name: string,
  input: Record<string, unknown>,
  session: TrainingSession
): Promise<unknown> {
  if (name === "get_recent_cases") return toolGetRecentCases(input, session);
  if (name === "get_case_full_context") return toolGetCaseFullContext(input);
  return { error: `Tool desconocida: ${name}` };
}

type PipelineRowForCoach = {
  id: string;
  created_at: string | null;
  segmento: string | null;
  turn_type: string | null;
  lead_name: string | null;
  lead_email: string | null;
  reply_original: string | null;
  turn_1_generated: string | null;
  classification_output: Record<string, unknown> | null;
  validation_output: Record<string, unknown> | null;
  score: number | null;
  validado: boolean | null;
  status: string | null;
  patron: string | null;
};

async function toolGetRecentCases(
  input: Record<string, unknown>,
  session: TrainingSession
): Promise<{
  count: number;
  cases: Array<Record<string, unknown>>;
  note?: string;
}> {
  const segmento = (input.segmento as string) ?? session.segmento;
  const turnType = (input.turn_type as string) ?? session.turn_type;
  const limit = Math.min(Math.max(Number(input.limit ?? 10), 1), 20);
  const onlyWithResponse = input.only_with_response !== false; // default true
  const onlyValid = input.only_valid === true;
  const minScore = typeof input.min_score === "number" ? input.min_score : null;
  const maxScore = typeof input.max_score === "number" ? input.max_score : null;

  const params = new URLSearchParams({
    select:
      "id,created_at,segmento,turn_type,lead_name,lead_email,reply_original,turn_1_generated,classification_output,validation_output,score,validado,status,patron",
    order: "created_at.desc",
    limit: String(limit * 3), // sobre-fetch para filtrar bien
    segmento: `eq.${segmento}`,
    turn_type: `eq.${turnType}`,
  });
  if (onlyWithResponse) params.append("turn_1_generated", "not.is.null");
  if (onlyValid) params.append("validado", "eq.true");
  if (minScore !== null) params.append("score", `gte.${minScore}`);
  if (maxScore !== null) params.append("score", `lte.${maxScore}`);

  const PIPELINE_TABLE = "cl001_p007_turn1_pipeline";
  const rows = ((await pgrest(`${PIPELINE_TABLE}?${params.toString()}`, {
    method: "GET",
  })) ?? []) as PipelineRowForCoach[];

  const sliced = rows.slice(0, limit).map((r) => ({
    case_id: r.id,
    created_at: r.created_at,
    lead_name: r.lead_name,
    lead_email: r.lead_email,
    segmento: r.segmento,
    turn_type: r.turn_type,
    patron: r.patron,
    status: r.status,
    score: r.score,
    validado: r.validado,
    reply_original_truncated: truncate(r.reply_original ?? "", 500),
    turn_1_generated_truncated: truncate(r.turn_1_generated ?? "", 800),
    classification_output: r.classification_output,
    validation_summary: summarizeValidation(r.validation_output),
  }));

  const note =
    rows.length < limit
      ? `Solo había ${rows.length} casos en el historial con esos filtros (pediste hasta ${limit}).`
      : undefined;

  return { count: sliced.length, cases: sliced, note };
}

async function toolGetCaseFullContext(
  input: Record<string, unknown>
): Promise<{
  case_id: string;
  case?: PipelineRowForCoach;
  hubspot?: unknown;
  smartlead_thread?: unknown;
  errors?: string[];
}> {
  const caseId = String(input.case_id ?? "");
  if (!caseId) return { case_id: caseId, errors: ["case_id requerido"] };

  const PIPELINE_TABLE = "cl001_p007_turn1_pipeline";
  const params = new URLSearchParams({
    id: `eq.${caseId}`,
    select: "*",
    limit: "1",
  });
  const rows = ((await pgrest(`${PIPELINE_TABLE}?${params.toString()}`, {
    method: "GET",
  })) ?? []) as Array<
    PipelineRowForCoach & {
      hubspot_contact_id?: string | null;
      smartlead_lead_id?: string | null;
    }
  >;
  if (!rows || rows.length === 0) {
    return { case_id: caseId, errors: ["Caso no encontrado"] };
  }
  const caseRow = rows[0];

  const errors: string[] = [];
  let hubspot: unknown = null;
  let smartleadThread: unknown = null;

  // HubSpot context si tenemos contact_id
  if (caseRow.hubspot_contact_id) {
    try {
      const hsKey = process.env.HUBSPOT_API_KEY;
      if (hsKey) {
        const res = await fetch(
          `https://api.hubapi.com/crm/v3/objects/contacts/${caseRow.hubspot_contact_id}?properties=email,firstname,lastname,company,jobtitle,lifecyclestage,hs_lead_status,gtm__avatar_segment,notes_last_contacted,notes_last_updated&associations=companies`,
          { headers: { Authorization: `Bearer ${hsKey}` } }
        );
        if (res.ok) {
          hubspot = await res.json();
        } else {
          errors.push(`HubSpot ${res.status}`);
        }
      } else {
        errors.push("HUBSPOT_API_KEY no configurado");
      }
    } catch (e) {
      errors.push(`HubSpot fetch error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Smartlead thread si tenemos smartlead_lead_id
  if (caseRow.smartlead_lead_id) {
    try {
      const smKey = process.env.SMARTLEAD_API_KEY;
      if (smKey) {
        const campResp = await fetch(
          `https://server.smartlead.ai/api/v1/leads/${caseRow.smartlead_lead_id}/campaigns?api_key=${smKey}`
        );
        if (campResp.ok) {
          // El endpoint /leads/{id}/campaigns devuelve [{id, status, name}]
          // (el campaign id está en `id`, NO en `campaign_id`).
          // Si el lead está en varias campañas, preferimos la ACTIVE; si no hay
          // ACTIVE caemos a la primera disponible.
          const camps = (await campResp.json()) as Array<{
            id?: number;
            status?: string;
            name?: string;
          }>;
          const activeCamp = camps?.find((c) => c.status === "ACTIVE");
          const cid = activeCamp?.id ?? camps?.[0]?.id;
          if (cid) {
            const histResp = await fetch(
              `https://server.smartlead.ai/api/v1/campaigns/${cid}/leads/${caseRow.smartlead_lead_id}/message-history?api_key=${smKey}`
            );
            if (histResp.ok) {
              const hist = (await histResp.json()) as {
                history?: Array<{
                  type?: string;
                  time?: string;
                  email_body?: string;
                  email_seq_number?: number;
                }>;
              };
              // Truncar bodies para no inflar el tool result
              smartleadThread = (hist.history ?? []).map((m) => ({
                type: m.type,
                time: m.time,
                email_seq_number: m.email_seq_number,
                email_body_preview: truncate(stripHtml(m.email_body ?? ""), 800),
              }));
            } else {
              errors.push(`Smartlead message-history ${histResp.status}`);
            }
          } else {
            errors.push("Smartlead lead sin campañas asociadas");
          }
        } else {
          errors.push(`Smartlead /campaigns ${campResp.status}`);
        }
      } else {
        errors.push("SMARTLEAD_API_KEY no configurado");
      }
    } catch (e) {
      errors.push(`Smartlead fetch error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    case_id: caseId,
    case: caseRow,
    hubspot,
    smartlead_thread: smartleadThread,
    errors: errors.length > 0 ? errors : undefined,
  };
}

function summarizeValidation(v: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!v) return null;
  return {
    score: v.score ?? null,
    validado: v.validado ?? null,
    checks_pasados: v.checks_pasados ?? null,
    errores_criticos: Array.isArray(v.errores_criticos)
      ? (v.errores_criticos as string[]).slice(0, 5)
      : [],
    razones_fallo: Array.isArray(v.razones_fallo)
      ? (v.razones_fallo as string[]).slice(0, 5)
      : [],
  };
}

function truncate(s: string, max: number): string {
  if (!s) return "";
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>(?!\n)/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatToolInput(input: Record<string, unknown>): string {
  // Compacto: solo keys con valor
  const entries = Object.entries(input).filter(
    ([, v]) => v !== undefined && v !== null && v !== ""
  );
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ");
}

function toAnthropicMessage(m: TrainingMessage): {
  role: "user" | "assistant";
  content: Array<
    | { type: "text"; text: string }
    | {
        type: "image";
        source: { type: "base64"; media_type: string; data: string };
      }
  >;
} {
  const content: Array<
    | { type: "text"; text: string }
    | {
        type: "image";
        source: { type: "base64"; media_type: string; data: string };
      }
  > = [];
  // Las attachments van DELANTE del texto (mejor para visión)
  for (const att of m.attachments ?? []) {
    if (att.type === "image") {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: att.media_type,
          data: att.data_base64,
        },
      });
    } else if (att.type === "text") {
      content.push({
        type: "text",
        text: `[Adjunto: ${att.filename}]\n${att.content}`,
      });
    }
  }
  if (m.content) {
    content.push({ type: "text", text: m.content });
  }
  if (content.length === 0) {
    content.push({ type: "text", text: "(mensaje vacío)" });
  }
  return { role: m.role, content };
}
