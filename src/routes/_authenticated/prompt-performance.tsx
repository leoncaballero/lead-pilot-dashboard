import { createFileRoute, ErrorComponent, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  listAllPromptStats,
  type PromptComparisonRow,
  type PromptVersionStats,
  type PromptType,
  type Segmento,
  type TurnType,
} from "@/api/prompts.functions";

const TURN_TYPE_LABELS: Record<TurnType, string> = {
  turn1: "Turn 1",
  turn2_generic: "Turn 2",
  turn3_generic: "Turn 3",
  follow_up_4h: "FU 4h",
  follow_up_24h: "FU 24h",
  follow_up_3d: "FU 3d",
  objection_response: "Objeción",
  booking_propose: "Propuesta hora",
};

const PROMPT_TYPE_LABELS: Record<PromptType, string> = {
  classifier: "Clasificador",
  generator: "Generador",
  validator: "Validador",
};

export const Route = createFileRoute("/_authenticated/prompt-performance")({
  loader: async () => await listAllPromptStats(),
  staleTime: 30_000,
  pendingComponent: PerfPending,
  errorComponent: ({ error }) => {
    const router = useRouter();
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Prompt Performance</h1>
        <ErrorComponent error={error} />
        <button className="text-sm underline" onClick={() => router.invalidate()}>
          Reintentar
        </button>
      </div>
    );
  },
  component: PerfPage,
});

function PerfPending() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Prompt Performance</h1>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

type FlatRow = {
  combo_key: string;
  turn_type: TurnType;
  prompt_type: PromptType;
  segmento: Segmento;
  stats: PromptVersionStats;
};

type SortKey =
  | "version"
  | "generated_count"
  | "replied_count"
  | "reply_rate"
  | "booked_count"
  | "booking_rate"
  | "closed_won_count"
  | "win_rate"
  | "created_at";

function PerfPage() {
  const data = Route.useLoaderData();
  const router = useRouter();

  const [filterTurn, setFilterTurn] = useState<TurnType | "all">("all");
  const [filterType, setFilterType] = useState<PromptType | "all">("all");
  const [filterSegmento, setFilterSegmento] = useState<Segmento | "all">("all");
  const [showInactive, setShowInactive] = useState(true);
  const [hideZero, setHideZero] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("generated_count");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    const id = setInterval(() => router.invalidate(), 60_000);
    return () => clearInterval(id);
  }, [router]);

  const flatRows = useMemo<FlatRow[]>(() => {
    const out: FlatRow[] = [];
    for (const row of data.rows) {
      for (const s of row.versions) {
        out.push({
          combo_key: row.combo_key,
          turn_type: row.turn_type,
          prompt_type: row.prompt_type,
          segmento: row.segmento,
          stats: s,
        });
      }
    }
    return out;
  }, [data.rows]);

  const filtered = useMemo(() => {
    return flatRows.filter((r) => {
      if (filterTurn !== "all" && r.turn_type !== filterTurn) return false;
      if (filterType !== "all" && r.prompt_type !== filterType) return false;
      if (filterSegmento !== "all" && r.segmento !== filterSegmento) return false;
      if (!showInactive && !r.stats.is_active) return false;
      if (hideZero && r.stats.generated_count === 0) return false;
      return true;
    });
  }, [flatRows, filterTurn, filterType, filterSegmento, showInactive, hideZero]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      let cmp: number;
      if (typeof va === "string" && typeof vb === "string") cmp = va.localeCompare(vb);
      else cmp = (va as number) - (vb as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const totals = useMemo(() => {
    let generated = 0;
    let replied = 0;
    let booked = 0;
    let won = 0;
    for (const r of filtered) {
      generated += r.stats.generated_count;
      replied += r.stats.replied_count;
      booked += r.stats.booked_count;
      won += r.stats.closed_won_count;
    }
    return { generated, replied, booked, won };
  }, [filtered]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setSortDir("desc");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Prompt Performance</h1>
        <p className="text-sm text-muted-foreground">
          Comparativa por versión: leads ingresados, replies, bookings y ventas. Atribución por
          ventana temporal entre creaciones de versión. Refresca cada 60s.
        </p>
      </div>

      {/* Totales del filtro actual */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Leads atribuidos" value={totals.generated.toString()} />
        <KpiCard
          label="Replies"
          value={totals.replied.toString()}
          sub={
            totals.generated > 0
              ? `${pct(totals.replied / totals.generated)} reply rate`
              : "—"
          }
          tone="blue"
        />
        <KpiCard
          label="Bookings"
          value={totals.booked.toString()}
          sub={
            totals.generated > 0
              ? `${pct(totals.booked / totals.generated)} booking rate`
              : "—"
          }
          tone="amber"
        />
        <KpiCard
          label="Ventas (closed_won)"
          value={totals.won.toString()}
          sub={
            totals.generated > 0 ? `${pct(totals.won / totals.generated)} win rate` : "—"
          }
          tone="green"
        />
      </div>

      {/* Filtros */}
      <div className="rounded-lg border bg-card p-3 flex flex-wrap items-center gap-3 text-xs">
        <FilterSelect
          label="Turn"
          value={filterTurn}
          onChange={(v) => setFilterTurn(v as TurnType | "all")}
          options={[
            ["all", "Todos"],
            ...(Array.from(new Set(flatRows.map((r) => r.turn_type))).map((t) => [
              t,
              TURN_TYPE_LABELS[t] ?? t,
            ]) as [string, string][]),
          ]}
        />
        <FilterSelect
          label="Tipo"
          value={filterType}
          onChange={(v) => setFilterType(v as PromptType | "all")}
          options={[
            ["all", "Todos"],
            ["classifier", "Clasificador"],
            ["generator", "Generador"],
            ["validator", "Validador"],
          ]}
        />
        <FilterSelect
          label="Segmento"
          value={filterSegmento}
          onChange={(v) => setFilterSegmento(v as Segmento | "all")}
          options={[
            ["all", "Todos"],
            ...(Array.from(new Set(flatRows.map((r) => r.segmento))).sort().map((s) => [
              s,
              s,
            ]) as [string, string][]),
          ]}
        />
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          <span>Incluir versiones anteriores</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={hideZero}
            onChange={(e) => setHideZero(e.target.checked)}
          />
          <span>Ocultar sin datos</span>
        </label>
        <span className="ml-auto text-muted-foreground">
          {sorted.length} fila{sorted.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Tabla */}
      <div className="rounded-lg border bg-card overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/30 text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
            <tr>
              <Th sticky>Combinación</Th>
              <Th onSort={() => toggleSort("version")} active={sortKey === "version"} dir={sortDir}>
                Versión
              </Th>
              <Th
                align="right"
                onSort={() => toggleSort("generated_count")}
                active={sortKey === "generated_count"}
                dir={sortDir}
              >
                Leads
              </Th>
              <Th
                align="right"
                onSort={() => toggleSort("replied_count")}
                active={sortKey === "replied_count"}
                dir={sortDir}
              >
                Replies
              </Th>
              <Th
                align="right"
                onSort={() => toggleSort("reply_rate")}
                active={sortKey === "reply_rate"}
                dir={sortDir}
              >
                Reply %
              </Th>
              <Th
                align="right"
                onSort={() => toggleSort("booked_count")}
                active={sortKey === "booked_count"}
                dir={sortDir}
              >
                Bookings
              </Th>
              <Th
                align="right"
                onSort={() => toggleSort("booking_rate")}
                active={sortKey === "booking_rate"}
                dir={sortDir}
              >
                Booking %
              </Th>
              <Th
                align="right"
                onSort={() => toggleSort("closed_won_count")}
                active={sortKey === "closed_won_count"}
                dir={sortDir}
              >
                Ventas
              </Th>
              <Th
                align="right"
                onSort={() => toggleSort("win_rate")}
                active={sortKey === "win_rate"}
                dir={sortDir}
              >
                Win %
              </Th>
              <Th
                align="right"
                onSort={() => toggleSort("created_at")}
                active={sortKey === "created_at"}
                dir={sortDir}
              >
                Creada
              </Th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={10} className="text-center py-8 text-muted-foreground">
                  Sin resultados con estos filtros.
                </td>
              </tr>
            ) : (
              sorted.map((r) => <Row key={`${r.combo_key}|${r.stats.version_id}`} r={r} />)
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground italic">
        Atribución best-effort: cada lead se asigna a la versión activa en el momento de
        creación del pipeline row. Si activaste manualmente una versión vieja, los números
        pueden desplazarse.
      </p>
    </div>
  );
}

function sortValue(r: FlatRow, k: SortKey): number | string {
  switch (k) {
    case "version":
      return r.stats.version;
    case "generated_count":
      return r.stats.generated_count;
    case "replied_count":
      return r.stats.replied_count;
    case "reply_rate":
      return r.stats.reply_rate;
    case "booked_count":
      return r.stats.booked_count;
    case "booking_rate":
      return r.stats.booking_rate;
    case "closed_won_count":
      return r.stats.closed_won_count;
    case "win_rate":
      return r.stats.win_rate;
    case "created_at":
      return r.stats.created_at ?? "";
  }
}

function Row({ r }: { r: FlatRow }) {
  const s = r.stats;
  return (
    <tr
      className={cn(
        "border-t",
        s.is_active ? "bg-emerald-50/30 dark:bg-emerald-950/10" : "bg-card"
      )}
    >
      <td className="px-3 py-2 sticky left-0 bg-inherit">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="secondary" className="h-4 px-1 text-[9px]">
            {TURN_TYPE_LABELS[r.turn_type] ?? r.turn_type}
          </Badge>
          <Badge variant="outline" className="h-4 px-1 text-[9px]">
            {PROMPT_TYPE_LABELS[r.prompt_type]}
          </Badge>
          <Badge variant="outline" className="h-4 px-1 text-[9px]">
            {r.segmento}
          </Badge>
        </div>
      </td>
      <td className="px-3 py-2 font-mono">
        <div className="flex items-center gap-1.5">
          <span>{s.version}</span>
          {s.is_active && (
            <span
              className="h-1.5 w-1.5 rounded-full bg-emerald-500"
              title="Activa actualmente"
            />
          )}
        </div>
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{s.generated_count || "—"}</td>
      <td className="px-3 py-2 text-right tabular-nums">{s.replied_count || "—"}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        <RateChip rate={s.reply_rate} count={s.generated_count} tone="blue" />
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{s.booked_count || "—"}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        <RateChip rate={s.booking_rate} count={s.generated_count} tone="amber" />
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{s.closed_won_count || "—"}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        <RateChip rate={s.win_rate} count={s.generated_count} tone="green" />
      </td>
      <td className="px-3 py-2 text-right text-[10px] text-muted-foreground">
        {formatDate(s.created_at)}
      </td>
    </tr>
  );
}

function Th({
  children,
  align = "left",
  sticky = false,
  onSort,
  active,
  dir,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  sticky?: boolean;
  onSort?: () => void;
  active?: boolean;
  dir?: "asc" | "desc";
}) {
  return (
    <th
      className={cn(
        "px-3 py-2 select-none",
        align === "right" ? "text-right" : "text-left",
        sticky && "sticky left-0 bg-muted/30 z-10",
        onSort && "cursor-pointer hover:text-foreground"
      )}
      onClick={onSort}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {active && <span className="text-[8px]">{dir === "asc" ? "▲" : "▼"}</span>}
      </span>
    </th>
  );
}

function RateChip({
  rate,
  count,
  tone,
}: {
  rate: number;
  count: number;
  tone: "blue" | "amber" | "green";
}) {
  if (count === 0) return <span className="text-muted-foreground">—</span>;
  const toneClass = {
    blue: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  }[tone];
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 tabular-nums text-[11px] inline-block min-w-[42px]",
        toneClass
      )}
    >
      {(rate * 100).toFixed(rate >= 0.1 ? 0 : 1)}%
    </span>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-muted-foreground">{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 rounded border bg-background px-1.5 text-xs"
      >
        {options.map(([v, lbl]) => (
          <option key={v} value={v}>
            {lbl}
          </option>
        ))}
      </select>
    </label>
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
  tone?: "blue" | "amber" | "green";
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">
        {label}
      </div>
      <div
        className={cn(
          "text-2xl font-bold mt-1 tabular-nums",
          tone === "blue" && "text-blue-600 dark:text-blue-400",
          tone === "amber" && "text-amber-600 dark:text-amber-400",
          tone === "green" && "text-emerald-600 dark:text-emerald-400"
        )}
      >
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function pct(r: number): string {
  return `${(r * 100).toFixed(r >= 0.1 ? 0 : 1)}%`;
}

function formatDate(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
  });
}
