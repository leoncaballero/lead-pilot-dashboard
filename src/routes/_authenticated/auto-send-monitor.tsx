import { createFileRoute, ErrorComponent, Link, useRouter } from "@tanstack/react-router";
import { useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  getAutoSendMonitor,
  type AutoSendCandidate,
  type AutoSendVersionConfig,
} from "@/api/prompts.functions";

export const Route = createFileRoute("/_authenticated/auto-send-monitor")({
  loader: async () => await getAutoSendMonitor(),
  staleTime: 30_000,
  pendingComponent: Pending,
  errorComponent: ({ error }) => {
    const router = useRouter();
    return (
      <div className="space-y-4 p-4">
        <h1 className="text-2xl font-semibold">Auto-send Monitor</h1>
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
    <div className="space-y-4 p-4">
      <h1 className="text-2xl font-semibold">Auto-send Monitor</h1>
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

function Page() {
  const data = Route.useLoaderData();
  const { candidates, generator_versions, total_pending } = data;

  // Agrupar candidatos por versión del generator
  const groupedByVersion = useMemo(() => {
    const m = new Map<string, AutoSendCandidate[]>();
    for (const c of candidates) {
      const key = c.gen_version_label ?? "(sin versión)";
      const arr = m.get(key) ?? [];
      arr.push(c);
      m.set(key, arr);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [candidates]);

  const passRate = total_pending > 0 ? (candidates.length / total_pending) * 100 : 0;

  return (
    <div className="space-y-6 p-4 max-w-7xl">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          🤖 Auto-send Monitor
        </h1>
        <p className="text-sm text-muted-foreground">
          Casos que <strong>teóricamente pasarían</strong> el filtro de auto-send hoy (score
          ≥ threshold de su versión + sin errores críticos). Si la versión correspondiente
          tiene auto-send activado, estos casos se envían sin revisión. Si no, esperan en
          /triage.
        </p>
      </header>

      {/* Stats top */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard
          label="Candidatos auto-sendables"
          value={candidates.length.toString()}
          tone="emerald"
        />
        <StatCard
          label="Total pending review (7d)"
          value={total_pending.toString()}
          tone="muted"
        />
        <StatCard
          label="Pass rate"
          value={`${passRate.toFixed(0)}%`}
          tone={passRate >= 50 ? "emerald" : passRate >= 25 ? "amber" : "red"}
          hint="Si <25%, el threshold actual es muy estricto o el prompt produce muchos casos con errores. Si >70%, considera bajar el threshold para automatizar más."
        />
      </section>

      {/* Configuración por versión */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Versiones activas del generator
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {generator_versions.map((v) => (
            <VersionConfigCard key={v.id} v={v} />
          ))}
        </div>
      </section>

      {/* Candidatos agrupados por versión */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Candidatos a auto-send ({candidates.length})
        </h2>
        {candidates.length === 0 ? (
          <div className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            No hay candidatos que pasen los criterios actuales en los últimos 7 días.
            <br />
            Causas posibles: scores bajos, errores críticos del validator, o sin pipeline rows recientes.
          </div>
        ) : (
          groupedByVersion.map(([versionLabel, cands]) => (
            <div key={versionLabel} className="rounded-lg border bg-card">
              <div className="border-b px-3 py-2 flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs">{versionLabel}</span>
                <Badge variant="secondary" className="h-5 text-[10px]">
                  {cands.length} caso{cands.length === 1 ? "" : "s"}
                </Badge>
                {cands[0].gen_auto_send_enabled ? (
                  <Badge className="h-5 text-[10px] bg-emerald-600 hover:bg-emerald-600">
                    🤖 Auto-send ON
                  </Badge>
                ) : (
                  <Badge variant="outline" className="h-5 text-[10px]">
                    Auto-send OFF — esperan en /triage
                  </Badge>
                )}
              </div>
              <div className="divide-y">
                {cands.map((c) => (
                  <CandidateRow key={c.pipeline_id} c={c} />
                ))}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: "emerald" | "amber" | "red" | "muted";
  hint?: string;
}) {
  const toneClass = {
    emerald: "text-emerald-700 dark:text-emerald-300",
    amber: "text-amber-700 dark:text-amber-300",
    red: "text-red-700 dark:text-red-300",
    muted: "text-foreground",
  }[tone];
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[11px] text-muted-foreground uppercase tracking-wider">
        {label}
      </div>
      <div className={cn("text-3xl font-semibold tabular-nums mt-1", toneClass)}>
        {value}
      </div>
      {hint && (
        <div className="text-[10px] text-muted-foreground mt-1 italic">{hint}</div>
      )}
    </div>
  );
}

function VersionConfigCard({ v }: { v: AutoSendVersionConfig }) {
  return (
    <div
      className={cn(
        "rounded border p-2 text-xs flex items-center gap-2 flex-wrap",
        v.auto_send_enabled &&
          "border-emerald-300 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-950/20"
      )}
    >
      <Badge variant="outline" className="h-4 px-1 text-[9px]">
        {v.segmento}
      </Badge>
      {v.subgroup && (
        <Badge variant="secondary" className="h-4 px-1 text-[9px]">
          {v.subgroup}
        </Badge>
      )}
      <span className="font-mono">{v.version}</span>
      <span className="text-muted-foreground">·</span>
      <span>min score {v.auto_send_min_score}</span>
      <span className="text-muted-foreground">·</span>
      <span className="text-muted-foreground">
        {v.candidates_today} candidato{v.candidates_today === 1 ? "" : "s"} 24h
      </span>
      <span className="ml-auto">
        {v.auto_send_enabled ? (
          <Badge className="h-4 text-[9px] bg-emerald-600 hover:bg-emerald-600">
            🤖 ON
          </Badge>
        ) : (
          <Badge variant="outline" className="h-4 text-[9px]">
            OFF
          </Badge>
        )}
      </span>
    </div>
  );
}

function CandidateRow({ c }: { c: AutoSendCandidate }) {
  const score = c.score ?? 0;
  const ageMin = c.created_at
    ? Math.max(0, Math.floor((Date.now() - Date.parse(c.created_at)) / 60_000))
    : null;
  return (
    <div className="px-3 py-2 grid grid-cols-12 gap-2 items-start text-sm">
      <div className="col-span-3 min-w-0">
        <div className="truncate font-medium">{c.lead_name || c.lead_email || "—"}</div>
        <div className="text-[11px] text-muted-foreground truncate">{c.lead_email}</div>
      </div>
      <div className="col-span-1 text-center">
        <div className="text-xs tabular-nums font-semibold">{score}</div>
        <div className="text-[10px] text-muted-foreground">≥{c.gen_threshold}</div>
      </div>
      <div className="col-span-1 text-center">
        {c.has_known_store === false ? (
          <Badge variant="outline" className="h-4 text-[9px] bg-violet-50 dark:bg-violet-950/40">
            sin tienda
          </Badge>
        ) : c.has_known_store === true ? (
          <Badge variant="outline" className="h-4 text-[9px]">
            con tienda
          </Badge>
        ) : null}
      </div>
      <div className="col-span-5 min-w-0">
        <pre className="whitespace-pre-wrap text-[11px] leading-snug font-sans text-muted-foreground line-clamp-3">
          {c.turn_1_generated ?? "(sin Turn 1)"}
        </pre>
      </div>
      <div className="col-span-2 text-right text-[11px] text-muted-foreground space-y-1">
        <div>{ageMin !== null ? `hace ${formatAge(ageMin)}` : "—"}</div>
        <Link
          to="/triage"
          className="inline-block underline text-foreground hover:text-emerald-600"
        >
          Ver en /triage →
        </Link>
      </div>
    </div>
  );
}

function formatAge(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ${min % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
