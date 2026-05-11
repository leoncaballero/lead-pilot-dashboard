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
      // 1. Cargar sesión
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

      // 2. Cargar el prompt activo de la combinación (para que el coach lo conozca)
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

      // 3. Construir system prompt del coach
      const systemPrompt = buildCoachSystemPrompt({
        prompt_type: session.prompt_type,
        segmento: session.segmento,
        turn_type: session.turn_type,
        active_version: activePrompt?.version ?? "(ninguna)",
        active_prompt_text: activePrompt?.prompt_system ?? "(sin prompt activo aún)",
      });

      // 4. Construir historial para Anthropic (incluir el nuevo user message)
      const userMessage: TrainingMessage = {
        role: "user",
        content: data.content,
        attachments: data.attachments,
        ts: new Date().toISOString(),
      };
      const fullHistory = [...session.messages, userMessage];
      const anthropicMessages = fullHistory.map((m) => toAnthropicMessage(m));

      // 5. Llamar Anthropic
      const body = {
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        system: systemPrompt,
        messages: anthropicMessages,
      };
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
        const txt = await resp.text();
        return { ok: false, error: `Anthropic ${resp.status}: ${txt.slice(0, 300)}` };
      }
      const aj = (await resp.json()) as {
        content?: Array<{ text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const assistantText = aj.content?.[0]?.text ?? "(sin respuesta)";
      const inTok = aj.usage?.input_tokens ?? 0;
      const outTok = aj.usage?.output_tokens ?? 0;

      const assistantMessage: TrainingMessage = {
        role: "assistant",
        content: assistantText,
        ts: new Date().toISOString(),
      };

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

CÓMO COMPORTARTE:
1. León te enviará ejemplos (mensajes reales, capturas de pantalla, casos), feedback en lenguaje natural, e ideas sueltas sobre cómo debería comportarse este prompt.
2. Tu trabajo es:
   - Escuchar y entender. Hacer preguntas clarificadoras si algo está ambiguo.
   - Conectar lo que dice con el prompt actual: "esto chocaría con la regla X que tienes ahora", "esto sería una sección nueva", etc.
   - Proponer ediciones concretas cuando el feedback sea claro. Muestra antes/después en bloques de código cuando edites secciones.
   - Cuando León pida "guarda esto" o "aplica los cambios" o similar, NO intentes generar el prompt completo en el chat — limítate a confirmarle que use el botón "🪄 Sintetizar nueva versión" abajo a la derecha, que lo hará en un solo paso usando toda la conversación.
3. Si recibes imágenes, asume que son capturas reales del flujo (replies de leads, pantallas de triage, etc.). Coméntalas como contexto.

ESTILO:
- Responde en español.
- Conciso. Frases cortas. Evita prosa innecesaria.
- Marca propuestas concretas con un emoji ✏️ y el texto exacto a añadir/cambiar.`;
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
