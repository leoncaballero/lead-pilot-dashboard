import { createFileRoute, ErrorComponent, Link, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  getOutcomesFunnel,
  getAnalyticsSummary,
  type AnalyticsSummary,
  type OutcomesFunnel,
} from "@/api/analytics.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  loader: async () => {
    const [funnel, summary] = await Promise.all([getOutcomesFunnel(), getAnalyticsSummary()]);
    return { funnel, summary };
  },
  staleTime: 30_000,
  pendingComponent: DashboardPending,
  errorComponent: ({ error }) => {
    const router = useRouter();
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <ErrorComponent error={error} />
        <button className="text-sm underline" onClick={() => router.invalidate()}>
          Reintentar
        </button>
      </div>
    );
  },
  component: DashboardPage,
});

function DashboardPending() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-48" />
    </div>
  );
}

function DashboardPage() {
  const { funnel, summary } = Route.useLoaderData();
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.invalidate(), 60_000);
    return () => clearInterval(id);
  }, [router]);

  const pending = summary.decisions.pending;
  const sentTotal = funnel.sent_total;
  const replyRate = funnel.reply_rate;
  const bookingRate = funnel.booking_rate;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Vista panorámica del pipeline. Refresca cada 60s.
          </p>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {summary.total_cases} casos totales · datos últimos 30 días
        </span>
      </div>

      {/* KPI principales */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Pendientes en cola"
          value={pending.toString()}
          sub={pending > 0 ? "necesitan tu atención" : "cola vacía 🎉"}
          tone={pending > 10 ? "red" : pending > 3 ? "amber" : "green"}
          link="/triage"
        />
        <KpiCard
          label="Turn 1 enviados (30d)"
          value={sentTotal.toString()}
          sub="cohort base del funnel"
          link="/history"
        />
        <KpiCard
          label="Tasa respuesta"
          value={pct(replyRate)}
          sub={`${funnel.replied_total} / ${sentTotal}`}
          tone={
            sentTotal === 0
              ? undefined
              : replyRate >= 0.3
              ? "green"
              : replyRate >= 0.15
              ? "amber"
              : "red"
          }
          link="/analytics"
        />
        <KpiCard
          label="Tasa booking"
          value={pct(bookingRate)}
          sub={
            funnel.replied_total > 0
              ? `${pct(funnel.booking_rate_of_replied)} de los que respondieron`
              : "—"
          }
          tone={
            sentTotal === 0
              ? undefined
              : bookingRate >= 0.05
              ? "green"
              : bookingRate >= 0.02
              ? "amber"
              : "red"
          }
          link="/analytics"
        />
      </div>

      {/* Acciones rápidas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <ActionCard
          title="Triage Rápido"
          description={
            pending > 0
              ? `${pending} caso${pending === 1 ? "" : "s"} esperando revisión humana`
              : "Sin casos pendientes ahora"
          }
          link="/triage"
          icon="📥"
        />
        <ActionCard
          title="Pipeline kanban"
          description="Vista por etapas: pending → sent → replied → booked"
          link="/pipeline"
          icon="📊"
        />
        <ActionCard
          title="Prompts"
          description="Editar prompts, sugerencias IA, refinamiento conversacional"
          link="/prompts"
          icon="📝"
        />
      </div>

      {/* Stats secundarias */}
      <DecisionStats summary={summary} />

      {/* Distribuciones */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <DistributionPanel
          title="Por segmento"
          data={summary.by_segmento}
        />
        <DistributionPanel
          title="Por status"
          data={summary.by_status}
          colorMap={STATUS_COLORS}
        />
      </div>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  pending_review: "bg-amber-500",
  ready_to_send: "bg-blue-500",
  sent: "bg-emerald-500",
  dry_run_only: "bg-blue-400",
  auto_rejected: "bg-red-500",
  rejected: "bg-red-400",
  needs_deep_review: "bg-orange-500",
  error_send: "bg-red-600",
  error_generation: "bg-red-600",
};

function DecisionStats({ summary }: { summary: AnalyticsSummary }) {
  const r = summary.rates;
  if (r.decisions_total === 0) return null;
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <h2 className="text-xs font-semibold uppercase text-muted-foreground">
        Decisiones humanas en /triage
      </h2>
      <div className="grid grid-cols-3 gap-4">
        <Stat
          label="Aprobado sin editar"
          value={pct(r.approved_no_edit_rate)}
          sub={`${summary.decisions.approved_as_is} casos`}
          good
        />
        <Stat
          label="Editado y enviado"
          value={pct(r.edit_rate)}
          sub={`${summary.decisions.edited_and_sent} casos`}
        />
        <Stat
          label="Rechazado"
          value={pct(r.reject_rate)}
          sub={`${summary.decisions.rejected} casos`}
        />
      </div>
      <p className="text-[11px] text-muted-foreground italic">
        Cuanto más alto el "aprobado sin editar", más confianza en el prompt actual.
        Cuando suba >70% sostenido, se puede plantear auto-aprobar los AI-auto sin SDR.
      </p>
    </div>
  );
}

function DistributionPanel({
  title,
  data,
  colorMap,
}: {
  title: string;
  data: Record<string, number>;
  colorMap?: Record<string, string>;
}) {
  const total = Object.values(data).reduce((s, n) => s + n, 0);
  const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return null;
  return (
    <div className="rounded-lg border bg-card p-4 space-y-2">
      <h3 className="text-xs font-semibold uppercase text-muted-foreground">{title}</h3>
      <div className="space-y-1.5">
        {sorted.slice(0, 8).map(([key, count]) => {
          const pct = total > 0 ? (count / total) * 100 : 0;
          return (
            <div key={key} className="flex items-center gap-2 text-xs">
              <span className="w-32 truncate" title={key}>
                {key}
              </span>
              <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    colorMap?.[key] ?? "bg-primary"
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-12 text-right tabular-nums">{count}</span>
              <span className="w-12 text-right text-muted-foreground tabular-nums">
                {pct.toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  tone,
  link,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "green" | "amber" | "red";
  link?: string;
}) {
  const card = (
    <div
      className={cn(
        "rounded-lg border bg-card p-4 transition-colors",
        link && "hover:bg-accent cursor-pointer"
      )}
    >
      <div className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</div>
      <div
        className={cn(
          "text-3xl font-bold mt-1",
          tone === "green" && "text-emerald-600 dark:text-emerald-400",
          tone === "amber" && "text-amber-600 dark:text-amber-400",
          tone === "red" && "text-red-600 dark:text-red-400"
        )}
      >
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
  if (link) return <Link to={link}>{card}</Link>;
  return card;
}

function ActionCard({
  title,
  description,
  link,
  icon,
}: {
  title: string;
  description: string;
  link: string;
  icon: string;
}) {
  return (
    <Link
      to={link}
      className="rounded-lg border bg-card p-4 hover:bg-accent transition-colors block"
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl">{icon}</span>
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
      </div>
    </Link>
  );
}

function Stat({
  label,
  value,
  sub,
  good,
}: {
  label: string;
  value: string;
  sub?: string;
  good?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className={cn("text-2xl font-semibold", good && "text-emerald-600 dark:text-emerald-400")}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(0)}%`;
}
