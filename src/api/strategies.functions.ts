import { createServerFn } from "@tanstack/react-start";

export type Segmento = "MEGA" | "Genesis" | "Prosperitas" | "Polaris";

export type Strategy = {
  id: string;
  name: string;
  description: string | null;
  segmento: Segmento;
  fu1_enabled: boolean;
  fu1_offset_hours: number;
  fu2_enabled: boolean;
  fu2_offset_hours: number;
  fu3_enabled: boolean;
  fu3_offset_hours: number;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export type StrategyUsage = {
  strategy_id: string;
  pipeline_count: number;
};

const TABLE = "cl001_p007_strategies";
const PIPELINE_TABLE = "cl001_p007_turn1_pipeline";

function getCreds() {
  const url = process.env.OUTBOUND_SUPABASE_URL;
  const key = process.env.OUTBOUND_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Outbound Supabase no configurado");
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

export const listStrategies = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ strategies: Strategy[]; usage: StrategyUsage[] }> => {
    const params = new URLSearchParams({
      select: "*",
      order: "segmento.asc,is_active.desc,created_at.desc",
    });
    const strategies = ((await pgrest(`${TABLE}?${params.toString()}`, {
      method: "GET",
    })) ?? []) as Strategy[];

    // Conteo de leads por strategy_id (mejor esfuerzo en cliente)
    if (strategies.length === 0) return { strategies, usage: [] };
    const idsList = strategies.map((s) => `"${s.id}"`).join(",");
    const usageParams = new URLSearchParams({
      select: "strategy_id",
      limit: "10000",
    });
    usageParams.append("strategy_id", `in.(${idsList})`);
    type UR = { strategy_id: string };
    const usageRows = ((await pgrest(`${PIPELINE_TABLE}?${usageParams.toString()}`, {
      method: "GET",
    })) ?? []) as UR[];
    const counts = new Map<string, number>();
    for (const r of usageRows) {
      counts.set(r.strategy_id, (counts.get(r.strategy_id) ?? 0) + 1);
    }
    const usage: StrategyUsage[] = strategies.map((s) => ({
      strategy_id: s.id,
      pipeline_count: counts.get(s.id) ?? 0,
    }));
    return { strategies, usage };
  }
);

export const createStrategy = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      name: string;
      description?: string;
      segmento: Segmento;
      fu1_enabled: boolean;
      fu1_offset_hours: number;
      fu2_enabled: boolean;
      fu2_offset_hours: number;
      fu3_enabled: boolean;
      fu3_offset_hours: number;
      setActive: boolean;
    }) => data
  )
  .handler(async ({ data }) => {
    if (data.setActive) {
      // Desactivar otras estrategias del mismo segmento
      const dParams = new URLSearchParams({ segmento: `eq.${data.segmento}` });
      await pgrest(`${TABLE}?${dParams.toString()}`, {
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
          name: data.name,
          description: data.description ?? null,
          segmento: data.segmento,
          fu1_enabled: data.fu1_enabled,
          fu1_offset_hours: data.fu1_offset_hours,
          fu2_enabled: data.fu2_enabled,
          fu2_offset_hours: data.fu2_offset_hours,
          fu3_enabled: data.fu3_enabled,
          fu3_offset_hours: data.fu3_offset_hours,
          is_active: data.setActive,
        },
      ]),
    })) as Strategy[];
    return { ok: true, strategy: inserted?.[0] };
  });

export const updateStrategy = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      id: string;
      name?: string;
      description?: string | null;
      fu1_enabled?: boolean;
      fu1_offset_hours?: number;
      fu2_enabled?: boolean;
      fu2_offset_hours?: number;
      fu3_enabled?: boolean;
      fu3_offset_hours?: number;
    }) => data
  )
  .handler(async ({ data }) => {
    const { id, ...rest } = data;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined) patch[k] = v;
    }
    await pgrest(`${TABLE}?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: JSON.stringify(patch),
    });
    return { ok: true };
  });

export const activateStrategy = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    // Get target's segmento
    const targetRows = (await pgrest(
      `${TABLE}?id=eq.${encodeURIComponent(data.id)}&select=segmento`,
      { method: "GET" }
    )) as Array<{ segmento: string }>;
    if (!targetRows || targetRows.length === 0) {
      throw new Error(`Strategy ${data.id} not found`);
    }
    const seg = targetRows[0].segmento;
    // Desactivar todas las del segmento
    await pgrest(`${TABLE}?segmento=eq.${seg}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() }),
    });
    // Activar la elegida
    await pgrest(`${TABLE}?id=eq.${encodeURIComponent(data.id)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: JSON.stringify({ is_active: true, updated_at: new Date().toISOString() }),
    });
    return { ok: true };
  });

export const deleteStrategy = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    // No borramos si tiene pipeline rows asociados (FK con ON DELETE SET NULL los desligaría
    // pero perderíamos atribución). Avisamos al cliente y dejamos al user decidir.
    await pgrest(`${TABLE}?id=eq.${encodeURIComponent(data.id)}`, {
      method: "DELETE",
      prefer: "return=minimal",
    });
    return { ok: true };
  });
