import { createServerFn } from "@tanstack/react-start";

const PIPELINE_TABLE = "cl001_p007_turn1_pipeline";
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

export type AnalyticsSummary = {
  total_cases: number;
  by_status: Record<string, number>;
  decisions: {
    approved_as_is: number;
    edited_and_sent: number;
    rejected: number;
    sent_to_deep_review: number;
    returned_to_triage: number;
    pending: number;
  };
  rates: {
    approved_no_edit_rate: number;
    edit_rate: number;
    reject_rate: number;
    decisions_total: number;
  };
  by_score_band: { high: number; mid: number; low: number; null_score: number };
  by_patron: Record<string, number>;
  by_tono: Record<string, number>;
  by_segmento: Record<string, number>;
  avg_score: number | null;
  avg_pipeline_duration_seconds: number | null;
  generated_at: string;
};

type PipelineRowLite = {
  status: string | null;
  sdr_action: string | null;
  patron: string | null;
  score: number | null;
  classification_output: { tono_lead?: string } | null;
  segmento: string | null;
  pipeline_duration_seconds: number | null;
};

export const getAnalyticsSummary = createServerFn({ method: "GET" }).handler(
  async (): Promise<AnalyticsSummary> => {
    const params = new URLSearchParams({
      select:
        "status,sdr_action,patron,score,classification_output,segmento,pipeline_duration_seconds",
      limit: "5000",
    });
    const rows = (await pgrest(`${PIPELINE_TABLE}?${params.toString()}`, {
      method: "GET",
    })) as PipelineRowLite[];

    const total = rows.length;
    const by_status: Record<string, number> = {};
    const by_patron: Record<string, number> = {};
    const by_tono: Record<string, number> = {};
    const by_segmento: Record<string, number> = {};
    const by_score_band = { high: 0, mid: 0, low: 0, null_score: 0 };
    const decisions = {
      approved_as_is: 0,
      edited_and_sent: 0,
      rejected: 0,
      sent_to_deep_review: 0,
      returned_to_triage: 0,
      pending: 0,
    };
    let scoreSum = 0;
    let scoreCount = 0;
    let durationSum = 0;
    let durationCount = 0;

    for (const r of rows) {
      const status = r.status ?? "null";
      by_status[status] = (by_status[status] ?? 0) + 1;
      if (r.patron) by_patron[r.patron] = (by_patron[r.patron] ?? 0) + 1;
      if (r.segmento) by_segmento[r.segmento] = (by_segmento[r.segmento] ?? 0) + 1;
      const tono = r.classification_output?.tono_lead;
      if (tono) by_tono[tono] = (by_tono[tono] ?? 0) + 1;

      if (typeof r.score === "number") {
        scoreSum += r.score;
        scoreCount += 1;
        if (r.score >= 95) by_score_band.high += 1;
        else if (r.score >= 85) by_score_band.mid += 1;
        else by_score_band.low += 1;
      } else {
        by_score_band.null_score += 1;
      }

      if (typeof r.pipeline_duration_seconds === "number") {
        durationSum += r.pipeline_duration_seconds;
        durationCount += 1;
      }

      switch (r.sdr_action) {
        case "approved_as_is":
          decisions.approved_as_is += 1;
          break;
        case "edited_and_sent":
          decisions.edited_and_sent += 1;
          break;
        case "rejected":
          decisions.rejected += 1;
          break;
        case "sent_to_deep_review":
          decisions.sent_to_deep_review += 1;
          break;
        case "returned_to_triage":
          decisions.returned_to_triage += 1;
          break;
        default:
          decisions.pending += 1;
      }
    }

    const decisionsTotal =
      decisions.approved_as_is +
      decisions.edited_and_sent +
      decisions.rejected;

    return {
      total_cases: total,
      by_status,
      decisions,
      rates: {
        approved_no_edit_rate:
          decisionsTotal > 0 ? decisions.approved_as_is / decisionsTotal : 0,
        edit_rate:
          decisionsTotal > 0 ? decisions.edited_and_sent / decisionsTotal : 0,
        reject_rate:
          decisionsTotal > 0 ? decisions.rejected / decisionsTotal : 0,
        decisions_total: decisionsTotal,
      },
      by_score_band,
      by_patron,
      by_tono,
      by_segmento,
      avg_score: scoreCount > 0 ? Math.round((scoreSum / scoreCount) * 10) / 10 : null,
      avg_pipeline_duration_seconds:
        durationCount > 0 ? Math.round((durationSum / durationCount) * 10) / 10 : null,
      generated_at: new Date().toISOString(),
    };
  }
);

export type TopEditReason = { reason: string; count: number };

export const getTopEditReasons = createServerFn({ method: "GET" }).handler(
  async (): Promise<TopEditReason[]> => {
    const rows = (await pgrest(
      `${EDIT_REASONS_TABLE}?select=reason&limit=5000`,
      { method: "GET" }
    )) as { reason: string }[];
    const counts = new Map<string, number>();
    for (const r of rows ?? []) {
      const key = (r.reason ?? "").trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }
);

export type DailyVolumePoint = { date: string; total: number; sent: number; rejected: number };

export const getDailyVolume = createServerFn({ method: "GET" }).handler(
  async (): Promise<DailyVolumePoint[]> => {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const params = new URLSearchParams({
      select: "created_at,status",
      limit: "5000",
      order: "created_at.asc",
    });
    params.append("created_at", `gte.${since}`);
    const rows = (await pgrest(
      `${PIPELINE_TABLE}?${params.toString()}`,
      { method: "GET" }
    )) as { created_at: string; status: string | null }[];

    const byDay = new Map<string, { total: number; sent: number; rejected: number }>();
    for (const r of rows ?? []) {
      const day = (r.created_at ?? "").slice(0, 10); // YYYY-MM-DD
      if (!day) continue;
      const cur = byDay.get(day) ?? { total: 0, sent: 0, rejected: 0 };
      cur.total += 1;
      if (r.status === "sent" || r.status === "dry_run_only") cur.sent += 1;
      if (r.status === "rejected" || r.status === "auto_rejected") cur.rejected += 1;
      byDay.set(day, cur);
    }
    return Array.from(byDay.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
);
