import { createServerFn } from "@tanstack/react-start";

export type PromptType = "classifier" | "generator" | "validator";
export type Segmento = "MEGA" | "Genesis" | "Prosperitas" | "Polaris";
export type TurnType = "turn1" | "turn2_generic" | "follow_up_4h";

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
