import { createFileRoute, ErrorComponent, Link, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  getSystemHealth,
  type SystemHealthResult,
  type WorkflowHealth,
  type WorkflowWindow,
} from "@/api/system-health.functions";

export const Route = createFileRoute("/_authenticated/system-health")({
  loader: async () => await getSystemHealth(),
  staleTime: 30_000,
  pendingComponent: Pending,
  errorComponent: ({ error }) => {
    const router = useRouter();
    return (
      <div className="p-4 space-y-4">
        <h1 className="text-2xl font-semibold">System Health</h1>
        <ErrorComponent error={error} />
        <button className="text-sm underline" onClick={() => router.invalidate()}>
          Reintentar
        </button>
      </div>
    );
  },
  component: Page,
});

function Pending() {
  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-semibold">System Health</h1>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-32 w-full" />
      ))}
    </div>
  );
}

function Page() {
  const data: SystemHealthResult = Route.useLoaderData();
  const router = useRouter();

  // Auto-refresh cada 60s
  useEffect(() => {
    const id = setInterval(() => router.invalidate(), 60_000);
    return () => clearInterval(id);
  }, [router]);

  if (!data.ok) {
    return (
      <div className="p-4 space-y-4 max-w-4xl">
        <h1 className="text-2xl font-semibold">⚙️ System Health</h1>
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <p className="font-semibold mb-1">Configuración pendiente</p>
          <p className="text-[13px]">{data.error}</p>
          <p className="text-[12px] mt-2 italic">
            Añade los secrets en Lovable Cloud y recarga. La key del PAT está en
            tu vault de credenciales.
          </p>
        </div>
      </div>
    );
  }

  // Totales agregados
  const total1h = data.workflows.reduce((a, w) => a + w.windows.last_1h.total, 0);
  const errors1h = data.workflows.reduce((a, w) => a + w.windows.last_1h.errors, 0);
  const rate1h = total1h > 0 ? (errors1h / total1h) * 100 : 0;
  const total24h = data.workflows.reduce((a, w) => a + w.windows.last_24h.total, 0);
  const errors24h = data.workflows.reduce((a, w) => a + w.windows.last_24h.errors, 0);
  const rate24h = total24h > 0 ? (errors24h / total24h) * 100 : 0;

  // Errores cross-workflow recientes (top 10)
  const allErrors = data.workflows
    .flatMap((w) =>
      w.recent_errors.map((e) => ({ ...e, workflow_label: w.label, workflow_id: w.workflow_id }))
    )
    .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))
    .slice(0, 10);

  return (
    <div className="p-4 space-y-6 max-w-7xl">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          ⚙️ System Health
        </h1>
        <p className="text-sm text-muted-foreground">
          Salud de los workflows n8n productivos. Refresca cada 60s. Última actualización{" "}
          <span className="tabular-nums">{formatTime(data.fetched_at)}</span>.
        </p>
      </header>

      {/* Stats top */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard
          label="Ejecuciones 1h"
          value={total1h.toString()}
          sub={`${errors1h} errores · ${rate1h.toFixed(1)}% rate`}
          tone={rate1h > 5 ? "red" : rate1h > 2 ? "amber" : "emerald"}
        />
        <KpiCard
          label="Ejecuciones 24h"
          value={total24h.toString()}
          sub={`${errors24h} errores · ${rate24h.toFixed(1)}% rate`}
          tone={rate24h > 5 ? "red" : rate24h > 2 ? "amber" : "muted"}
        />
        <KpiCard
          label="Workflows activos"
          value={data.workflows.filter((w) => w.active).length.toString()}
          sub={`${data.workflows.length} monitorizados`}
          tone="muted"
        />
      </section>

      {/* Tabla por workflow */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Workflows ({data.workflows.length})
        </h2>
        <div className="rounded-lg border bg-card overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/30 text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left">Workflow</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2 text-right">1h</th>
                <th className="px-3 py-2 text-right">24h</th>
                <th className="px-3 py-2 text-right">7d</th>
              </tr>
            </thead>
            <tbody>
              {data.workflows.map((w) => (
                <WorkflowRow key={w.workflow_id} w={w} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Errores recientes cross-workflow */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          🔴 Errores recientes (top 10)
        </h2>
        {allErrors.length === 0 ? (
          <div className="rounded-md border border-dashed bg-emerald-50/40 dark:bg-emerald-950/20 p-4 text-center text-sm text-emerald-900 dark:text-emerald-200">
            🎉 Sin errores recientes en ningún workflow monitorizado.
          </div>
        ) : (
          <ul className="space-y-2">
            {allErrors.map((e) => (
              <li
                key={e.execution_id}
                className="rounded-md border border-red-200/60 bg-red-50/40 dark:border-red-900/40 dark:bg-red-950/20 px-3 py-2 text-xs"
              >
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge variant="outline" className="h-4 px-1 text-[9px]">
                      {e.workflow_label}
                    </Badge>
                    {e.failed_node && (
                      <span className="font-mono text-[11px] text-red-900 dark:text-red-200">
                        @ {e.failed_node}
                      </span>
                    )}
                    {e.lead_email && (
                      <Link
                        to="/lead/$email"
                        params={{ email: encodeURIComponent(e.lead_email) }}
                        className="underline text-[11px] text-foreground/80 hover:text-foreground"
                      >
                        {e.lead_email}
                      </Link>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {formatTime(e.started_at)} · exec {e.execution_id}
                  </span>
                </div>
                {e.error_message && (
                  <div className="mt-1 text-[11px] text-red-900/80 dark:text-red-200/80 font-mono break-words">
                    {e.error_message}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function WorkflowRow({ w }: { w: WorkflowHealth }) {
  return (
    <tr className="border-t">
      <td className="px-3 py-2">
        <div className="font-semibold">{w.label}</div>
        <div className="text-[10px] text-muted-foreground">{w.description}</div>
      </td>
      <td className="px-3 py-2 text-center">
        {w.active === true ? (
          <Badge className="h-5 text-[10px] bg-emerald-600 hover:bg-emerald-600">activo</Badge>
        ) : w.active === false ? (
          <Badge variant="outline" className="h-5 text-[10px]">
            inactivo
          </Badge>
        ) : (
          <Badge variant="outline" className="h-5 text-[10px] text-muted-foreground">
            —
          </Badge>
        )}
      </td>
      <WindowCell w={w.windows.last_1h} />
      <WindowCell w={w.windows.last_24h} />
      <WindowCell w={w.windows.last_7d} />
    </tr>
  );
}

function WindowCell({ w }: { w: WorkflowWindow }) {
  const tone =
    w.total === 0
      ? "text-muted-foreground"
      : w.error_rate >= 0.05
      ? "text-red-600 dark:text-red-400"
      : w.error_rate >= 0.02
      ? "text-amber-600 dark:text-amber-400"
      : "text-emerald-600 dark:text-emerald-400";
  return (
    <td className="px-3 py-2 text-right tabular-nums">
      <div className="text-sm font-semibold">{w.total || "—"}</div>
      {w.total > 0 && (
        <div className={cn("text-[10px]", tone)}>
          {w.errors}× err · {(w.error_rate * 100).toFixed(1)}%
        </div>
      )}
    </td>
  );
}

function KpiCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: "emerald" | "amber" | "red" | "muted";
}) {
  const toneClass = {
    emerald: "text-emerald-700 dark:text-emerald-300",
    amber: "text-amber-700 dark:text-amber-300",
    red: "text-red-700 dark:text-red-300",
    muted: "text-foreground",
  }[tone];
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className={cn("text-3xl font-semibold tabular-nums mt-1", toneClass)}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
