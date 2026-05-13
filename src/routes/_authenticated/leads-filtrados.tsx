import { createFileRoute, ErrorComponent, useRouter, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ConversationThread } from "@/components/ConversationThread";
import {
  getFilteredLeads,
  type FilteredLeadRow,
  type FilteredLeadsResult,
} from "@/api/filtered-leads.functions";

type FilterParams = { window: number };

export const Route = createFileRoute("/_authenticated/leads-filtrados")({
  validateSearch: (s: Record<string, unknown>): FilterParams => ({
    window: typeof s.window === "number" ? s.window : 14,
  }),
  loaderDeps: ({ search: { window } }) => ({ window }),
  loader: async ({ deps: { window } }) =>
    await getFilteredLeads({ data: { sinceDays: window } }),
  staleTime: 60_000,
  pendingComponent: Pending,
  errorComponent: ({ error }) => {
    const router = useRouter();
    return (
      <div className="p-4 space-y-4">
        <h1 className="text-2xl font-semibold">Leads filtrados</h1>
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
      <h1 className="text-2xl font-semibold">Leads filtrados</h1>
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

const CATEGORIES = [
  "Not interested",
  "Wrong person",
  "Do Not Contact",
  "Manual Review",
] as const;

const CATEGORY_STYLE: Record<string, { badge: string; row: string }> = {
  "Not interested": {
    badge: "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
    row: "",
  },
  "Wrong person": {
    badge: "bg-blue-200 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200",
    row: "",
  },
  "Do Not Contact": {
    badge: "bg-red-200 text-red-900 dark:bg-red-900/40 dark:text-red-200",
    row: "bg-red-50/40 dark:bg-red-950/20",
  },
  "Manual Review": {
    badge: "bg-amber-200 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
    row: "bg-amber-50/40 dark:bg-amber-950/20",
  },
};

function Page() {
  const data: FilteredLeadsResult = Route.useLoaderData();
  const { window } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [lowConfOnly, setLowConfOnly] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const filtered = useMemo(() => {
    return data.rows.filter((r) => {
      if (categoryFilter && r.categoria !== categoryFilter) return false;
      if (lowConfOnly && (r.confidence ?? 100) >= 70) return false;
      return true;
    });
  }, [data.rows, categoryFilter, lowConfOnly]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of data.rows) {
      if (r.categoria) m[r.categoria] = (m[r.categoria] ?? 0) + 1;
    }
    return m;
  }, [data.rows]);

  return (
    <div className="p-4 space-y-4 max-w-7xl">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          🚫 Leads filtrados por el clasificador
        </h1>
        <p className="text-sm text-muted-foreground">
          Replies que WF[01] clasificó como NO Interested. Aquí puedes auditar si el
          clasificador acertó — sobre todo casos con <strong>confidence &lt; 70</strong>{" "}
          o categorías limítrofes. Si encuentras un falso negativo, dale rescate
          desde el thread (botón &quot;Ver en Smartlead&quot;) y marca el caso para
          mejorar el prompt.
        </p>
      </header>

      {/* Stats top */}
      <section className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <KpiCard
          label={`Total ${data.window_days}d`}
          value={data.rows.length.toString()}
          tone="muted"
          active={categoryFilter === null}
          onClick={() => setCategoryFilter(null)}
        />
        {CATEGORIES.map((c) => (
          <KpiCard
            key={c}
            label={c}
            value={(counts[c] ?? 0).toString()}
            tone={
              c === "Do Not Contact" ? "red" : c === "Manual Review" ? "amber" : "muted"
            }
            active={categoryFilter === c}
            onClick={() => setCategoryFilter(categoryFilter === c ? null : c)}
          />
        ))}
      </section>

      {/* Filtros */}
      <section className="flex items-center gap-3 flex-wrap text-xs">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={lowConfOnly}
            onChange={(e) => setLowConfOnly(e.target.checked)}
            className="rounded"
          />
          <span>Solo confidence &lt; 70 (candidatos a auditar)</span>
        </label>
        <span className="text-muted-foreground">·</span>
        <span>Ventana:</span>
        {[7, 14, 30, 60].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => navigate({ search: { window: d } })}
            className={cn(
              "rounded border px-2 py-0.5",
              window === d
                ? "bg-primary text-primary-foreground"
                : "bg-background hover:bg-accent"
            )}
          >
            {d}d
          </button>
        ))}
        <span className="ml-auto text-muted-foreground">
          {filtered.length} mostrad{filtered.length === 1 ? "o" : "os"} de{" "}
          {data.rows.length}
          {data.truncated && " (truncado a 500)"}
        </span>
      </section>

      {/* Lista de leads filtrados */}
      <section>
        {filtered.length === 0 ? (
          <div className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            Sin leads que coincidan con el filtro.
          </div>
        ) : (
          <div className="rounded-lg border bg-card divide-y">
            {filtered.map((r) => (
              <FilteredLeadRowItem
                key={r.lead_map_id}
                r={r}
                expanded={expandedId === r.lead_map_id}
                onToggle={() =>
                  setExpandedId(expandedId === r.lead_map_id ? null : r.lead_map_id)
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function FilteredLeadRowItem({
  r,
  expanded,
  onToggle,
}: {
  r: FilteredLeadRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const cat = r.categoria ?? "(sin categoría)";
  const style = CATEGORY_STYLE[cat] ?? { badge: "bg-muted text-foreground", row: "" };
  const conf = r.confidence ?? 0;
  const lowConf = conf < 70;
  const ageHours = r.created_at
    ? Math.max(0, Math.floor((Date.now() - Date.parse(r.created_at)) / (60 * 60 * 1000)))
    : null;
  return (
    <div className={cn("px-4 py-3", style.row)}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left flex items-center gap-3 flex-wrap"
      >
        <Badge className={cn("h-5 text-[10px]", style.badge, "hover:opacity-100")}>
          {cat}
        </Badge>
        <span
          className={cn(
            "text-xs font-mono tabular-nums",
            lowConf ? "text-amber-700 dark:text-amber-300 font-semibold" : "text-muted-foreground"
          )}
          title={lowConf ? "Confidence bajo — vale la pena revisar" : ""}
        >
          {conf}%
        </span>
        {r.categoria_secundaria && r.categoria_secundaria !== cat && (
          <span className="text-[10px] text-muted-foreground">
            (2ª: {r.categoria_secundaria})
          </span>
        )}
        <span className="flex-1 min-w-0 text-xs italic text-foreground/80 truncate">
          {r.razon ?? "—"}
        </span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {ageHours !== null ? formatAge(ageHours) : "—"}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {expanded ? "▴" : "▾"}
        </span>
      </button>

      {expanded && (
        <ExpandedThread leadId={r.lead_id} leadMapId={r.lead_map_id} />
      )}
    </div>
  );
}

function ExpandedThread({
  leadId,
  leadMapId,
}: {
  leadId: number | null;
  leadMapId: number;
}) {
  if (leadId == null) {
    return (
      <div className="mt-2 rounded border bg-muted/30 p-3 text-[11px] text-muted-foreground">
        Sin Smartlead lead_id para resolver el thread. Lead_map_id: {leadMapId}
      </div>
    );
  }
  return (
    <div className="mt-2 space-y-2">
      <ConversationThread smartleadLeadId={leadId} defaultCompact={false} />
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>
          smartlead_lead_id: <code>{leadId}</code> · lead_map_id: <code>{leadMapId}</code>
        </span>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: string;
  tone: "emerald" | "amber" | "red" | "muted";
  active: boolean;
  onClick: () => void;
}) {
  const toneClass = {
    emerald: "text-emerald-700 dark:text-emerald-300",
    amber: "text-amber-700 dark:text-amber-300",
    red: "text-red-700 dark:text-red-300",
    muted: "text-foreground",
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border bg-card p-2 text-left transition-colors hover:bg-accent/50",
        active && "border-primary bg-accent"
      )}
    >
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">
        {label}
      </div>
      <div className={cn("text-2xl font-semibold tabular-nums mt-0.5", toneClass)}>
        {value}
      </div>
    </button>
  );
}

function formatAge(hours: number): string {
  if (hours < 24) return `${hours}h`;
  const d = Math.floor(hours / 24);
  return `${d}d`;
}
