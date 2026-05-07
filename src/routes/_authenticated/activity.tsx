import { createFileRoute, ErrorComponent, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getActivityFeed, type ActivityEvent } from "@/api/activity.functions";

export const Route = createFileRoute("/_authenticated/activity")({
  loader: async () => await getActivityFeed({ data: { limit: 200 } }),
  staleTime: 15_000,
  pendingComponent: ActivityPending,
  errorComponent: ({ error }) => {
    const router = useRouter();
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Activity</h1>
        <ErrorComponent error={error} />
        <button className="text-sm underline" onClick={() => router.invalidate()}>
          Reintentar
        </button>
      </div>
    );
  },
  component: ActivityPage,
});

function ActivityPending() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Activity</h1>
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

const EVENT_LABELS: Record<string, { label: string; icon: string; tone: string }> = {
  turn_1_approved: { label: "Aprobó Turn 1", icon: "✅", tone: "emerald" },
  turn_1_edited: { label: "Editó y envió Turn 1", icon: "✏️", tone: "blue" },
  turn_1_rejected: { label: "Rechazó Turn 1", icon: "🚫", tone: "red" },
  turn_1_sent_to_deep_review: { label: "→ Revisión profunda", icon: "🔍", tone: "amber" },
  sdr_action_undone: { label: "↶ Deshizo acción", icon: "↶", tone: "muted" },
  outcome_replied: { label: "Lead respondió", icon: "↩", tone: "blue" },
  outcome_booked: { label: "Lead agendó reunión", icon: "🗓", tone: "emerald" },
  outcome_attended: { label: "Lead asistió a reunión", icon: "✓", tone: "emerald" },
  outcome_no_show: { label: "No-show", icon: "✗", tone: "amber" },
  outcome_closed_won: { label: "Closed WON", icon: "🏆", tone: "emerald" },
  outcome_closed_lost: { label: "Closed LOST", icon: "✕", tone: "red" },
  outcome_unsubscribe: { label: "Unsubscribe", icon: "🚷", tone: "red" },
};

const TONE_CLASSES: Record<string, string> = {
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  red: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  muted: "bg-muted text-muted-foreground",
};

function ActivityPage() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const [filter, setFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Polling 30s
  useEffect(() => {
    const id = setInterval(() => router.invalidate(), 30_000);
    return () => clearInterval(id);
  }, [router]);

  const eventTypes = useMemo(() => {
    const set = new Set<string>();
    for (const e of data.events) set.add(e.event_type);
    return Array.from(set).sort();
  }, [data.events]);

  const filteredEvents = useMemo(() => {
    if (!filter) return data.events;
    return data.events.filter((e) => e.event_type === filter);
  }, [data.events, filter]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Activity</h1>
        <p className="text-sm text-muted-foreground">
          Audit feed de acciones humanas + outcomes detectados. Refresca cada 30s.
        </p>
      </div>

      {/* Filtros por tipo */}
      <div className="flex flex-wrap items-center gap-1 rounded-lg border bg-card p-2">
        <span className="text-[10px] uppercase text-muted-foreground mr-2">Filtro:</span>
        <button
          type="button"
          onClick={() => setFilter(null)}
          className={cn(
            "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
            !filter ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"
          )}
        >
          Todos · {data.events.length}
        </button>
        {eventTypes.map((t) => {
          const count = data.events.filter((e) => e.event_type === t).length;
          const meta = EVENT_LABELS[t] ?? { label: t, icon: "•", tone: "muted" };
          const active = filter === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setFilter(active ? null : t)}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] transition-colors flex items-center gap-1",
                active ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"
              )}
            >
              <span>{meta.icon}</span>
              <span>{meta.label}</span>
              <span className={active ? "opacity-80" : "text-muted-foreground"}>{count}</span>
            </button>
          );
        })}
      </div>

      {filteredEvents.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
          {filter
            ? "No hay eventos de este tipo en los últimos 200."
            : "Aún no hay eventos registrados."}
        </div>
      ) : (
        <ol className="divide-y rounded-lg border bg-card">
          {filteredEvents.map((e) => (
            <ActivityItem
              key={e.id}
              event={e}
              expanded={expanded.has(e.id)}
              onToggle={() => {
                const next = new Set(expanded);
                if (next.has(e.id)) next.delete(e.id);
                else next.add(e.id);
                setExpanded(next);
              }}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function ActivityItem({
  event,
  expanded,
  onToggle,
}: {
  event: ActivityEvent;
  expanded: boolean;
  onToggle: () => void;
}) {
  const meta = EVENT_LABELS[event.event_type] ?? {
    label: event.event_type,
    icon: "•",
    tone: "muted",
  };
  const hasPayload = event.payload && Object.keys(event.payload).length > 0;

  return (
    <li className="px-4 py-2.5 hover:bg-accent/30 cursor-pointer" onClick={onToggle}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs",
            TONE_CLASSES[meta.tone] ?? TONE_CLASSES.muted
          )}
          title={event.event_type}
        >
          {meta.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap text-sm">
            <span className="font-medium">{meta.label}</span>
            <span className="text-muted-foreground">·</span>
            <span className="truncate">
              {event.lead_name ?? event.lead_email ?? event.pipeline_id?.slice(0, 8) ?? "—"}
            </span>
            {event.segmento && (
              <span className="rounded bg-muted px-1 py-0 text-[10px] uppercase">
                {event.segmento}
              </span>
            )}
            {event.turn_type && event.turn_type !== "turn1" && (
              <span className="rounded bg-muted px-1 py-0 text-[10px]">{event.turn_type}</span>
            )}
            <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
              {formatRelTime(event.occurred_at)}
            </span>
          </div>
          {hasPayload && (
            <>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {expanded
                  ? null
                  : Object.entries(event.payload!)
                      .filter(([k]) => !k.startsWith("_"))
                      .slice(0, 1)
                      .map(([k, v]) => `${k}: ${truncate(String(v), 80)}`)
                      .join(" · ")}
              </div>
              {expanded && (
                <pre className="mt-1.5 rounded bg-muted/40 p-2 text-[10px] font-mono whitespace-pre-wrap leading-relaxed">
                  {JSON.stringify(event.payload, null, 2)}
                </pre>
              )}
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
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
  return d.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
