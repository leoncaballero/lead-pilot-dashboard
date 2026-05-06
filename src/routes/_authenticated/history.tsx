import { createFileRoute, ErrorComponent, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { getHistoryCases, type HistoryCase } from "@/api/history.functions";
import { ConversationThread } from "@/components/ConversationThread";

const STATUS_OPTIONS = [
  "pending_review",
  "needs_deep_review",
  "ready_to_send",
  "sending",
  "sent",
  "dry_run_only",
  "auto_rejected",
  "rejected",
  "error_send",
  "error_generation",
];

const SEGMENTO_OPTIONS = ["MEGA", "Genesis", "Prosperitas", "Polaris"];
const PATRON_OPTIONS = ["A", "B", "C"];

export const Route = createFileRoute("/_authenticated/history")({
  loader: async () => {
    const res = await getHistoryCases({ data: { limit: 100 } });
    return res;
  },
  staleTime: 10_000,
  pendingComponent: HistoryPending,
  errorComponent: ({ error }) => {
    const router = useRouter();
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Histórico</h1>
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
  component: HistoryPage,
});

function HistoryPending() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Histórico</h1>
      <Skeleton className="h-9 w-full" />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

function HistoryPage() {
  const initial = Route.useLoaderData();
  const router = useRouter();
  const fetchFn = useServerFn(getHistoryCases);

  const [cases, setCases] = useState<HistoryCase[]>(initial.cases);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState<Set<string>>(new Set());
  const [segmentos, setSegmentos] = useState<Set<string>>(new Set());
  const [patrones, setPatrones] = useState<Set<string>>(new Set());
  const [selectedCase, setSelectedCase] = useState<HistoryCase | null>(null);

  async function applyFilters() {
    setLoading(true);
    try {
      const res = await fetchFn({
        data: {
          search: search.trim() || undefined,
          statuses: statuses.size > 0 ? Array.from(statuses) : undefined,
          segmentos: segmentos.size > 0 ? Array.from(segmentos) : undefined,
          patrones: patrones.size > 0 ? Array.from(patrones) : undefined,
          limit: 200,
        },
      });
      setCases(res.cases);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function toggleSet(set: Set<string>, setter: (s: Set<string>) => void, value: string) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  }

  function clearFilters() {
    setSearch("");
    setStatuses(new Set());
    setSegmentos(new Set());
    setPatrones(new Set());
  }

  // Auto-aplica filtros con debounce cuando cambian
  useEffect(() => {
    const id = setTimeout(() => {
      applyFilters();
    }, 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statuses, segmentos, patrones]);

  // Polling cada 30s para refrescar datos
  useEffect(() => {
    const id = setInterval(() => {
      router.invalidate();
    }, 30000);
    return () => clearInterval(id);
  }, [router]);

  const statusCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of cases) {
      const s = c.status ?? "null";
      map.set(s, (map.get(s) ?? 0) + 1);
    }
    return map;
  }, [cases]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Histórico</h1>
        <p className="text-sm text-muted-foreground">
          Todos los casos del pipeline. Read-only.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[260px]">
            <Input
              placeholder="Buscar por email, nombre o smartlead lead id..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Limpiar filtros
          </Button>
        </div>

        <FilterRow
          label="Status"
          options={STATUS_OPTIONS}
          selected={statuses}
          onToggle={(v) => toggleSet(statuses, setStatuses, v)}
        />
        <FilterRow
          label="Segmento"
          options={SEGMENTO_OPTIONS}
          selected={segmentos}
          onToggle={(v) => toggleSet(segmentos, setSegmentos, v)}
        />
        <FilterRow
          label="Patrón"
          options={PATRON_OPTIONS}
          selected={patrones}
          onToggle={(v) => toggleSet(patrones, setPatrones, v)}
        />
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {loading ? "Cargando..." : `${cases.length} caso${cases.length === 1 ? "" : "s"}`}
        </span>
        <span className="text-xs">
          {Array.from(statusCounts.entries())
            .map(([s, c]) => `${s}: ${c}`)
            .join("  ·  ")}
        </span>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr className="text-left">
              <th className="px-3 py-2 text-xs font-medium uppercase text-muted-foreground">Cuándo</th>
              <th className="px-3 py-2 text-xs font-medium uppercase text-muted-foreground">Lead</th>
              <th className="px-3 py-2 text-xs font-medium uppercase text-muted-foreground">Segmento</th>
              <th className="px-3 py-2 text-xs font-medium uppercase text-muted-foreground">Patrón</th>
              <th className="px-3 py-2 text-xs font-medium uppercase text-muted-foreground text-right">Score</th>
              <th className="px-3 py-2 text-xs font-medium uppercase text-muted-foreground">Status</th>
              <th className="px-3 py-2 text-xs font-medium uppercase text-muted-foreground">Acción SDR</th>
              <th className="px-3 py-2 text-xs font-medium uppercase text-muted-foreground">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {cases.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Ningún caso coincide con los filtros.
                </td>
              </tr>
            ) : (
              cases.map((c) => (
                <tr
                  key={c.id}
                  className="border-b last:border-b-0 cursor-pointer hover:bg-accent/50"
                  onClick={() => setSelectedCase(c)}
                >
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">
                    {formatTime(c.created_at)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{c.lead_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{c.lead_email ?? c.smartlead_lead_id ?? "—"}</div>
                  </td>
                  <td className="px-3 py-2">{c.segmento ?? "—"}</td>
                  <td className="px-3 py-2">
                    {c.patron ? (
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{c.patron}</Badge>
                    ) : "—"}
                  </td>
                  <td className={cn("px-3 py-2 text-right font-medium", scoreColor(c.score))}>
                    {c.score ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill status={c.status} />
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {c.sdr_action ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {c.outcome ?? c.sent_via ?? "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Sheet open={!!selectedCase} onOpenChange={(o) => !o && setSelectedCase(null)}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-2xl overflow-y-auto p-0"
        >
          {selectedCase && (
            <>
              <SheetHeader className="border-b p-6">
                <SheetTitle className="truncate text-base">
                  {selectedCase.lead_name ?? selectedCase.lead_email ?? selectedCase.id}
                </SheetTitle>
                {selectedCase.lead_email && selectedCase.lead_name && (
                  <p className="truncate text-xs text-muted-foreground text-left">
                    {selectedCase.lead_email}
                  </p>
                )}
              </SheetHeader>
              <div className="p-6">
                <CaseDetailDialogBody c={selectedCase} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function FilterRow({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onToggle: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium uppercase text-muted-foreground w-20">{label}:</span>
      {options.map((opt) => {
        const active = selected.has(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition-colors",
              active
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background hover:bg-accent text-foreground"
            )}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function CaseDetailDialogBody({ c }: { c: HistoryCase }) {
  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <Field label="Email" value={c.lead_email} />
        <Field label="Smartlead lead id" value={c.smartlead_lead_id} />
        <Field label="Segmento" value={c.segmento} />
        <Field label="Patrón" value={c.patron} />
        <Field label="Score" value={c.score?.toString()} />
        <Field label="Status" value={c.status} />
        <Field label="SDR Action" value={c.sdr_action} />
        <Field label="Sent at" value={c.sent_at ? formatTime(c.sent_at) : "—"} />
        <Field label="Sent via" value={c.sent_via} />
        <Field label="Outcome" value={c.outcome} />
      </div>

      <div>
        <div className="text-xs font-medium uppercase text-muted-foreground mb-2">Conversación completa (Smartlead)</div>
        <ConversationThread smartleadLeadId={c.smartlead_lead_id ?? null} />
      </div>

      {(c.turn_1_final || c.turn_1_generated) && (
        <div>
          <div className="text-xs font-medium uppercase text-muted-foreground mb-1">
            Turn 1 {c.turn_1_final ? "(final - editado)" : "(generado)"}
          </div>
          <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
            {c.turn_1_final ?? c.turn_1_generated}
          </pre>
        </div>
      )}

      {c.edit_reason && (
        <div>
          <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Razón de edición</div>
          <div className="text-foreground">{c.edit_reason}</div>
        </div>
      )}

      {c.errores_criticos && c.errores_criticos.length > 0 && (
        <div>
          <div className="text-xs font-medium uppercase text-red-600 dark:text-red-400 mb-1">Errores críticos</div>
          <ul className="list-disc pl-5">
            {c.errores_criticos.map((e, i) => (
              <li key={i} className="text-red-600 dark:text-red-400">{e}</li>
            ))}
          </ul>
        </div>
      )}

      {c.razones_fallo && c.razones_fallo.length > 0 && (
        <div>
          <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Razones de fallo</div>
          <ul className="list-disc pl-5 text-muted-foreground">
            {c.razones_fallo.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}

      {c.outcome_details && Object.keys(c.outcome_details).length > 0 && (
        <div>
          <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Outcome details</div>
          <pre className="whitespace-pre-wrap rounded bg-muted p-2 text-[11px] font-mono">
            {JSON.stringify(c.outcome_details, null, 2)}
          </pre>
        </div>
      )}

      <div className="text-[11px] text-muted-foreground">
        ID: <code>{c.id}</code> · Created: {formatTime(c.created_at)} · Updated: {formatTime(c.updated_at)}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-[11px] uppercase text-muted-foreground">{label}</div>
      <div className="font-medium break-words">{value ?? "—"}</div>
    </div>
  );
}

function StatusPill({ status }: { status?: string | null }) {
  if (!status) return <span className="text-muted-foreground text-xs">—</span>;
  const cls = statusColor(status);
  return (
    <span className={cn("inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase", cls)}>
      {status}
    </span>
  );
}

function statusColor(status: string): string {
  switch (status) {
    case "sent":
    case "ready_to_send":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
    case "dry_run_only":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
    case "pending_review":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
    case "needs_deep_review":
      return "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300";
    case "auto_rejected":
    case "rejected":
    case "error_send":
    case "error_generation":
      return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
    case "sending":
      return "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function scoreColor(score?: number | null): string {
  if (typeof score !== "number") return "text-muted-foreground";
  if (score >= 95) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 85) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function formatTime(ts?: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return "ahora";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
