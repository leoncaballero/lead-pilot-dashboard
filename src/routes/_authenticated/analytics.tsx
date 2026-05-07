import { createFileRoute, ErrorComponent, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  getAnalyticsSummary,
  getTopEditReasons,
  getDailyVolume,
  getOutcomesFunnel,
  getRecentOutcomes,
  type AnalyticsSummary,
  type TopEditReason,
  type DailyVolumePoint,
  type OutcomesFunnel,
  type RecentOutcome,
} from "@/api/analytics.functions";

export const Route = createFileRoute("/_authenticated/analytics")({
  loader: async () => {
    const [summary, topReasons, daily, funnel, recentOutcomes] =
      await Promise.all([
        getAnalyticsSummary(),
        getTopEditReasons(),
        getDailyVolume(),
        getOutcomesFunnel(),
        getRecentOutcomes(),
      ]);
    return { summary, topReasons, daily, funnel, recentOutcomes };
  },
  staleTime: 30_000,
  pendingComponent: AnalyticsPending,
  errorComponent: ({ error }) => {
    const router = useRouter();
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <ErrorComponent error={error} />
        <button
          className="text-sm underline text-muted-foreground"
          onClick={() => router.invalidate()}
        >
          Reintentar
        </button>
      </div>
    );
  },
  component: AnalyticsPage,
});

function AnalyticsPending() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Analytics</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-48 w-full" />)}
      </div>
    </div>
  );
}

function AnalyticsPage() {
  const { summary, topReasons, daily, funnel, recentOutcomes } = Route.useLoaderData();
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.invalidate(), 60_000);
    return () => clearInterval(id);
  }, [router]);

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Métricas de calidad y volumen del pipeline. Refresco automático cada 60s.
          </p>
        </div>
        <div className="text-xs text-muted-foreground">
          Generado {formatTime(summary.generated_at)} · {summary.total_cases} casos totales
        </div>
      </div>

      <OutcomesFunnelSection funnel={funnel} />

      <DecisionRatesSection summary={summary} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ScoreBandPanel summary={summary} />
        <PatronTonoPanel summary={summary} />
        <StatusPanel summary={summary} />
        <TopReasonsPanel reasons={topReasons} />
      </div>

      <DailyVolumePanel daily={daily} />

      <RecentOutcomesPanel outcomes={recentOutcomes} />
    </div>
  );
}

function OutcomesFunnelSection({ funnel }: { funnel: OutcomesFunnel }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Funnel — últimos 30 días
        </h2>
        <span className="text-[11px] text-muted-foreground">
          desde {new Date(Date.now() - 30 * 86400000).toLocaleDateString("es-ES", {day: "2-digit", month: "short"})}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard
          label="Turn 1 enviados"
          value={funnel.sent_total.toString()}
          sub="cohort base del funnel"
        />
        <KpiCard
          label="Respondieron al Turn 1"
          value={`${funnel.replied_total} · ${pct(funnel.reply_rate)}`}
          sub={
            funnel.sent_total === 0
              ? "—"
              : `${funnel.replied_total} de ${funnel.sent_total}`
          }
          tone={
            funnel.sent_total === 0
              ? undefined
              : funnel.reply_rate >= 0.3
              ? "green"
              : funnel.reply_rate >= 0.15
              ? "amber"
              : "red"
          }
        />
        <KpiCard
          label="Agendaron reunión"
          value={`${funnel.booked_total} · ${pct(funnel.booking_rate)}`}
          sub={
            funnel.replied_total > 0
              ? `${pct(funnel.booking_rate_of_replied)} de los que respondieron`
              : "—"
          }
          tone={
            funnel.sent_total === 0
              ? undefined
              : funnel.booking_rate >= 0.05
              ? "green"
              : funnel.booking_rate >= 0.02
              ? "amber"
              : "red"
          }
        />
      </div>
    </div>
  );
}

function RecentOutcomesPanel({ outcomes }: { outcomes: RecentOutcome[] }) {
  if (outcomes.length === 0) {
    return (
      <Panel title="Outcomes recientes" sub="Replies y bookings detectados">
        <p className="text-sm text-muted-foreground italic">
          Aún no hay outcomes registrados. En cuanto un lead responda a un Turn 1
          enviado o agende reunión, aparecerá aquí.
        </p>
      </Panel>
    );
  }
  return (
    <Panel
      title="Outcomes recientes"
      sub={`Últimos ${outcomes.length} eventos · replies y bookings`}
    >
      <ul className="divide-y">
        {outcomes.map((o) => (
          <li key={o.id} className="py-2 flex items-start gap-3 text-sm">
            <span
              className={cn(
                "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                o.outcome === "replied" &&
                  "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
                o.outcome === "booked" &&
                  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
                o.outcome !== "replied" && o.outcome !== "booked" &&
                  "bg-muted text-muted-foreground"
              )}
              title={o.outcome}
            >
              {o.outcome === "replied" ? "↩" : o.outcome === "booked" ? "🗓" : "•"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium truncate">
                  {o.lead_name || o.lead_email || o.pipeline_id.slice(0, 8)}
                </span>
                {o.segmento && (
                  <span className="rounded bg-muted px-1.5 py-0 text-[10px] uppercase">
                    {o.segmento}
                  </span>
                )}
                <span className="text-[11px] text-muted-foreground">
                  {humanOutcome(o.outcome)} · {o.outcome_source.replace("_", " ")}
                </span>
              </div>
              {o.lead_email && o.lead_name && (
                <div className="text-[11px] text-muted-foreground truncate">
                  {o.lead_email}
                </div>
              )}
            </div>
            <span className="text-[11px] text-muted-foreground shrink-0">
              {formatRelTime(o.occurred_at)}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function humanOutcome(outcome: string): string {
  switch (outcome) {
    case "replied":
      return "respondió";
    case "booked":
      return "agendó reunión";
    case "rescheduled":
      return "reagendó";
    case "no_show":
      return "no asistió";
    case "attended":
      return "asistió";
    case "closed_won":
      return "cerrado win";
    case "closed_lost":
      return "cerrado lost";
    default:
      return outcome;
  }
}

function formatRelTime(ts?: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "ahora";
  if (diff < 3600) return `${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} d`;
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}

function DecisionRatesSection({ summary }: { summary: AnalyticsSummary }) {
  const r = summary.rates;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <KpiCard
        label="Decisiones humanas"
        value={r.decisions_total.toString()}
        sub={`${summary.decisions.pending} pendientes en cola`}
      />
      <KpiCard
        label="Aprobado sin editar"
        value={pct(r.approved_no_edit_rate)}
        sub={`${summary.decisions.approved_as_is} de ${r.decisions_total}`}
        tone={
          r.decisions_total === 0
            ? undefined
            : r.approved_no_edit_rate >= 0.7
            ? "green"
            : r.approved_no_edit_rate >= 0.4
            ? "amber"
            : "red"
        }
      />
      <KpiCard
        label="Editado antes de enviar"
        value={pct(r.edit_rate)}
        sub={`${summary.decisions.edited_and_sent} de ${r.decisions_total}`}
        tone={
          r.decisions_total === 0
            ? undefined
            : r.edit_rate <= 0.3
            ? "green"
            : r.edit_rate <= 0.5
            ? "amber"
            : "red"
        }
      />
      <KpiCard
        label="Rechazados"
        value={pct(r.reject_rate)}
        sub={`${summary.decisions.rejected} de ${r.decisions_total}`}
      />
    </div>
  );
}

function ScoreBandPanel({ summary }: { summary: AnalyticsSummary }) {
  const b = summary.by_score_band;
  const total = b.high + b.mid + b.low + b.null_score;
  return (
    <Panel title="Distribución por score" sub={`Score medio: ${summary.avg_score ?? "—"}`}>
      <BarRow label="≥95 (alta confianza)" value={b.high} total={total} colorClass="bg-emerald-500" />
      <BarRow label="85–94 (media)" value={b.mid} total={total} colorClass="bg-amber-500" />
      <BarRow label="<85 (deep review)" value={b.low} total={total} colorClass="bg-red-500" />
      {b.null_score > 0 && (
        <BarRow label="sin score" value={b.null_score} total={total} colorClass="bg-muted-foreground/40" />
      )}
    </Panel>
  );
}

function PatronTonoPanel({ summary }: { summary: AnalyticsSummary }) {
  const totalP = sumValues(summary.by_patron);
  const totalT = sumValues(summary.by_tono);
  return (
    <Panel title="Patrones y tonos">
      <div className="mb-3">
        <h4 className="text-xs uppercase text-muted-foreground mb-1">Por patrón</h4>
        {totalP === 0 ? (
          <Empty />
        ) : (
          ["A", "B", "C"].map((k) => (
            <BarRow
              key={k}
              label={`Patrón ${k}`}
              value={summary.by_patron[k] ?? 0}
              total={totalP}
              colorClass={k === "A" ? "bg-blue-500" : k === "B" ? "bg-pink-500" : "bg-purple-500"}
            />
          ))
        )}
      </div>
      <div>
        <h4 className="text-xs uppercase text-muted-foreground mb-1">Por tono del lead</h4>
        {totalT === 0 ? (
          <Empty />
        ) : (
          Object.entries(summary.by_tono)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => (
              <BarRow key={k} label={k} value={v} total={totalT} colorClass="bg-blue-400" />
            ))
        )}
      </div>
    </Panel>
  );
}

function StatusPanel({ summary }: { summary: AnalyticsSummary }) {
  const total = summary.total_cases;
  const order = [
    "pending_review",
    "needs_deep_review",
    "ready_to_send",
    "sent",
    "dry_run_only",
    "auto_rejected",
    "rejected",
    "error_send",
    "error_generation",
  ];
  const seen = new Set<string>();
  const entries: Array<[string, number]> = [];
  for (const s of order) {
    if (summary.by_status[s] !== undefined) {
      entries.push([s, summary.by_status[s]]);
      seen.add(s);
    }
  }
  for (const [s, c] of Object.entries(summary.by_status)) {
    if (!seen.has(s)) entries.push([s, c]);
  }
  return (
    <Panel title="Distribución por status" sub={`${total} casos · duración media ${summary.avg_pipeline_duration_seconds ?? "—"}s`}>
      {entries.length === 0 ? (
        <Empty />
      ) : (
        entries.map(([status, count]) => (
          <BarRow
            key={status}
            label={status}
            value={count}
            total={total}
            colorClass={statusColor(status)}
          />
        ))
      )}
    </Panel>
  );
}

function TopReasonsPanel({ reasons }: { reasons: TopEditReason[] }) {
  const max = reasons[0]?.count ?? 1;
  return (
    <Panel title="Top razones de edición" sub="Lo que el SDR cambia más">
      {reasons.length === 0 ? (
        <Empty />
      ) : (
        reasons.slice(0, 7).map((r) => (
          <BarRow
            key={r.reason}
            label={r.reason.length > 60 ? r.reason.slice(0, 57) + "…" : r.reason}
            value={r.count}
            total={max}
            colorClass="bg-amber-500"
          />
        ))
      )}
    </Panel>
  );
}

function DailyVolumePanel({ daily }: { daily: DailyVolumePoint[] }) {
  const max = Math.max(1, ...daily.map((d) => d.total));
  return (
    <Panel title="Volumen últimos 30 días" sub={`${daily.reduce((a, d) => a + d.total, 0)} casos en ventana`}>
      {daily.length === 0 ? (
        <Empty />
      ) : (
        <div className="flex items-end gap-1 h-32 mt-2 pb-6">
          {daily.map((d) => (
            <div
              key={d.date}
              className="flex-1 flex flex-col items-center group min-w-0"
              title={`${d.date}: ${d.total} casos (${d.sent} sent/dry, ${d.rejected} rejected)`}
            >
              <div className="w-full flex flex-col-reverse h-full">
                <div
                  className="bg-emerald-500"
                  style={{ height: `${(d.sent / max) * 100}%`, minHeight: d.sent > 0 ? "1px" : 0 }}
                />
                <div
                  className="bg-red-500"
                  style={{ height: `${(d.rejected / max) * 100}%`, minHeight: d.rejected > 0 ? "1px" : 0 }}
                />
                <div
                  className="bg-blue-400"
                  style={{
                    height: `${((d.total - d.sent - d.rejected) / max) * 100}%`,
                    minHeight: d.total - d.sent - d.rejected > 0 ? "1px" : 0,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex gap-3 text-[11px] text-muted-foreground">
        <Legend color="bg-blue-400" label="Otros" />
        <Legend color="bg-emerald-500" label="Enviados / dry-run" />
        <Legend color="bg-red-500" label="Rechazados" />
      </div>
    </Panel>
  );
}

function KpiCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "green" | "amber" | "red" }) {
  const toneCls =
    tone === "green"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "amber"
      ? "text-amber-600 dark:text-amber-400"
      : tone === "red"
      ? "text-red-600 dark:text-red-400"
      : "text-foreground";
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className={cn("text-3xl font-bold mt-1", toneCls)}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function Panel({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function BarRow({ label, value, total, colorClass }: { label: string; value: number; total: number; colorClass: string }) {
  const pctVal = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-44 truncate text-foreground" title={label}>
        {label}
      </span>
      <span className="flex-1 h-2 bg-muted rounded overflow-hidden">
        <span
          className={cn("block h-full", colorClass)}
          style={{ width: `${pctVal}%` }}
        />
      </span>
      <span className="w-16 text-right text-muted-foreground tabular-nums">
        {value} <span className="opacity-60">({pctVal.toFixed(0)}%)</span>
      </span>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("inline-block h-2 w-3", color)} />
      {label}
    </span>
  );
}

function Empty() {
  return <p className="text-xs text-muted-foreground italic">Sin datos.</p>;
}

function statusColor(status: string): string {
  switch (status) {
    case "sent":
    case "ready_to_send":
      return "bg-emerald-500";
    case "dry_run_only":
      return "bg-blue-500";
    case "pending_review":
      return "bg-amber-500";
    case "needs_deep_review":
      return "bg-orange-500";
    case "auto_rejected":
    case "rejected":
    case "error_send":
    case "error_generation":
      return "bg-red-500";
    case "sending":
      return "bg-purple-500";
    default:
      return "bg-muted-foreground/40";
  }
}

function pct(v: number): string {
  if (!isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function sumValues(o: Record<string, number>): number {
  return Object.values(o).reduce((a, b) => a + b, 0);
}

function formatTime(ts?: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}
