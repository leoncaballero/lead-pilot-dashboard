import { createServerFn } from "@tanstack/react-start";

/**
 * System Health — observabilidad de los workflows n8n productivos.
 *
 * Devuelve, por workflow:
 * - executions totales, success/error counts en ventanas (1h, 24h, 7d)
 * - top 5 errores recientes con nodo que falló + mensaje + lead afectado
 *
 * Requiere env vars en Lovable Cloud:
 *   N8N_BASE_URL  (ej. https://cion8napp.nexau.es/api/v1)
 *   N8N_API_KEY   (PAT — header X-N8N-API-KEY)
 *
 * Sin las env vars, devuelve `error` y la página muestra un mensaje claro
 * indicando qué configurar en Lovable Cloud.
 */

// Workflows GTM productivos a monitorizar. Si añadimos uno nuevo, hay que
// registrarlo aquí. IDs estáticos — coinciden con la documentación interna.
const MONITORED_WORKFLOWS: Array<{ id: string; label: string; description: string }> = [
  {
    id: "Gs1bLYpaMktZ1M5D",
    label: "WF[01]",
    description: "Clasificador inicial de replies entrantes (Smartlead webhook)",
  },
  {
    id: "Y0k0uh5KX2TvDzFf",
    label: "WF02 v2",
    description: "Turn 1 Pipeline — generación + validación del primer reply",
  },
  {
    id: "nwY6oykHHKZmg5TA",
    label: "WF02b",
    description: "Turn 2 Generator — subsequent replies (2ª, 3ª, 4ª)",
  },
  {
    id: "epJZXeTq4HVKtsvC",
    label: "WF04",
    description: "Cron Booking Detector — cada 30 min, busca meetings en HubSpot",
  },
  {
    id: "5HQJUXNtkUOpuiNb",
    label: "WF03 FU 4h",
    description: "Cron Follow-Up 4h",
  },
];

export type WorkflowErrorSample = {
  execution_id: string;
  started_at: string;
  failed_node: string | null;
  error_message: string | null;
  lead_email: string | null;
};

export type WorkflowWindow = {
  total: number;
  errors: number;
  success: number;
  error_rate: number;
};

export type WorkflowHealth = {
  workflow_id: string;
  label: string;
  description: string;
  active: boolean | null;
  windows: {
    last_1h: WorkflowWindow;
    last_24h: WorkflowWindow;
    last_7d: WorkflowWindow;
  };
  recent_errors: WorkflowErrorSample[];
};

export type SystemHealthResult = {
  ok: boolean;
  error?: string;
  fetched_at: string;
  workflows: WorkflowHealth[];
};

function getN8nCreds() {
  const url = process.env.N8N_BASE_URL;
  const key = process.env.N8N_API_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

async function n8nGet<T = unknown>(
  path: string,
  creds: { url: string; key: string }
): Promise<T> {
  const res = await fetch(`${creds.url}${path}`, {
    headers: {
      "X-N8N-API-KEY": creds.key,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`n8n ${path} → ${res.status} ${await res.text().catch(() => "")}`);
  }
  return (await res.json()) as T;
}

type N8nExecutionListItem = {
  id: string;
  startedAt: string;
  finished: boolean;
  status: string | null;
  mode: string;
  workflowId: string;
};

type N8nExecutionDetail = {
  data?: {
    resultData?: {
      error?: {
        node?: { name?: string } | string;
        message?: string;
      };
      runData?: Record<
        string,
        Array<{ data?: { main?: Array<Array<{ json?: Record<string, unknown> }>> } }>
      >;
    };
  };
};

function emptyWindow(): WorkflowWindow {
  return { total: 0, errors: 0, success: 0, error_rate: 0 };
}

function bucketExecution(
  ts: number,
  status: string | null | undefined,
  now: number,
  windows: { last_1h: WorkflowWindow; last_24h: WorkflowWindow; last_7d: WorkflowWindow }
) {
  const ms1h = 60 * 60 * 1000;
  const ms24h = 24 * ms1h;
  const ms7d = 7 * ms24h;
  const age = now - ts;
  const isError = status === "error" || status === "crashed";

  function bump(w: WorkflowWindow) {
    w.total += 1;
    if (isError) w.errors += 1;
    else w.success += 1;
  }

  if (age <= ms7d) bump(windows.last_7d);
  if (age <= ms24h) bump(windows.last_24h);
  if (age <= ms1h) bump(windows.last_1h);
}

function finalizeRate(w: WorkflowWindow) {
  w.error_rate = w.total > 0 ? w.errors / w.total : 0;
}

function extractLeadEmail(detail: N8nExecutionDetail): string | null {
  const run = detail.data?.resultData?.runData;
  if (!run) return null;
  // Buscar en el trigger node (varios nombres conocidos)
  const candidates = [
    "When Executed by Another Workflow",
    "Webhook",
    "Schedule Trigger",
    "Trigger B - From Lovable",
  ];
  for (const name of candidates) {
    const runs = run[name];
    if (!runs?.[0]) continue;
    const items = runs[0].data?.main?.[0];
    if (!items?.[0]?.json) continue;
    const j = items[0].json as Record<string, unknown>;
    const direct = (j["sl_lead_email"] as string) || (j["lead_email"] as string);
    if (direct) return direct;
    const body = j["body"] as Record<string, unknown> | undefined;
    if (body) {
      const e = (body["sl_lead_email"] as string) || (body["lead_email"] as string);
      if (e) return e;
    }
  }
  return null;
}

async function fetchWorkflowHealth(
  wf: (typeof MONITORED_WORKFLOWS)[number],
  creds: { url: string; key: string }
): Promise<WorkflowHealth> {
  // 1. Status (active?) — usamos el workflow GET con includeData=false
  let active: boolean | null = null;
  try {
    const w = await n8nGet<{ active?: boolean }>(`/workflows/${wf.id}`, creds);
    active = w.active ?? null;
  } catch {
    // sigue, active queda null
  }

  // 2. Últimas 100 executions (las suficientes para llenar la ventana 7d en
  //    workflows medio-altos volumen; los cron menos volumen tienen historia más larga)
  type ListResp = { data?: N8nExecutionListItem[] };
  let executions: N8nExecutionListItem[] = [];
  try {
    const r = await n8nGet<ListResp>(
      `/executions?workflowId=${wf.id}&limit=100`,
      creds
    );
    executions = r.data ?? [];
  } catch (e) {
    return {
      workflow_id: wf.id,
      label: wf.label,
      description: wf.description,
      active,
      windows: {
        last_1h: emptyWindow(),
        last_24h: emptyWindow(),
        last_7d: emptyWindow(),
      },
      recent_errors: [],
    };
  }

  // 3. Bucketing por ventana
  const now = Date.now();
  const windows = {
    last_1h: emptyWindow(),
    last_24h: emptyWindow(),
    last_7d: emptyWindow(),
  };
  for (const e of executions) {
    const ts = Date.parse(e.startedAt);
    if (Number.isNaN(ts)) continue;
    bucketExecution(ts, e.status, now, windows);
  }
  finalizeRate(windows.last_1h);
  finalizeRate(windows.last_24h);
  finalizeRate(windows.last_7d);

  // 4. Top 5 errores más recientes con detalle enriquecido
  const errorCandidates = executions
    .filter((e) => e.status === "error" || e.status === "crashed")
    .slice(0, 5);

  const recent_errors: WorkflowErrorSample[] = await Promise.all(
    errorCandidates.map(async (e) => {
      try {
        const detail = await n8nGet<N8nExecutionDetail>(
          `/executions/${e.id}?includeData=true`,
          creds
        );
        const err = detail.data?.resultData?.error;
        const nodeName =
          err && typeof err.node === "object" && err.node
            ? err.node.name ?? null
            : typeof err?.node === "string"
            ? err.node
            : null;
        return {
          execution_id: e.id,
          started_at: e.startedAt,
          failed_node: nodeName ?? null,
          error_message: err?.message ?? null,
          lead_email: extractLeadEmail(detail),
        };
      } catch {
        return {
          execution_id: e.id,
          started_at: e.startedAt,
          failed_node: null,
          error_message: null,
          lead_email: null,
        };
      }
    })
  );

  return {
    workflow_id: wf.id,
    label: wf.label,
    description: wf.description,
    active,
    windows,
    recent_errors,
  };
}

export const getSystemHealth = createServerFn({ method: "GET" }).handler(
  async (): Promise<SystemHealthResult> => {
    const creds = getN8nCreds();
    if (!creds) {
      return {
        ok: false,
        error:
          "Faltan env vars en Lovable Cloud: N8N_BASE_URL (ej. https://cion8napp.nexau.es/api/v1) y N8N_API_KEY (PAT n8n).",
        fetched_at: new Date().toISOString(),
        workflows: [],
      };
    }
    const workflows = await Promise.all(
      MONITORED_WORKFLOWS.map((wf) => fetchWorkflowHealth(wf, creds))
    );
    return {
      ok: true,
      fetched_at: new Date().toISOString(),
      workflows,
    };
  }
);
