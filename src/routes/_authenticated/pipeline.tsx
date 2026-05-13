import { createFileRoute, ErrorComponent, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  getPipelineKanban,
  type PipelineCard,
  type PipelineStage,
} from "@/api/pipeline.functions";
import { ConversationThread } from "@/components/ConversationThread";
import { HubSpotLeadContextCard } from "@/components/HubSpotLeadContext";

const STAGE_META: Record<
  PipelineStage,
  { label: string; emoji: string; color: string; description: string }
> = {
  pending: {
    label: "Pendiente revisión",
    emoji: "🔍",
    color: "border-amber-300 bg-amber-50/30 dark:border-amber-900/40 dark:bg-amber-950/10",
    description: "Esperando humano",
  },
  sending: {
    label: "Enviando",
    emoji: "📤",
    color: "border-blue-300 bg-blue-50/30 dark:border-blue-900/40 dark:bg-blue-950/10",
    description: "En camino a Smartlead",
  },
  sent: {
    label: "Enviados",
    emoji: "✅",
    color: "border-emerald-300 bg-emerald-50/30 dark:border-emerald-900/40 dark:bg-emerald-950/10",
    description: "Sin respuesta aún",
  },
  replied: {
    label: "Respondieron",
    emoji: "↩",
    color: "border-purple-300 bg-purple-50/30 dark:border-purple-900/40 dark:bg-purple-950/10",
    description: "Engagement activo",
  },
  booked: {
    label: "Agendaron",
    emoji: "🗓",
    color: "border-emerald-500 bg-emerald-100/40 dark:border-emerald-700 dark:bg-emerald-950/30",
    description: "Reunión en HubSpot",
  },
  closed: {
    label: "Cerrados",
    emoji: "✕",
    color: "border-muted bg-muted/30",
    description: "Rechazados o errores",
  },
};

const STAGE_ORDER: PipelineStage[] = [
  "pending",
  "sending",
  "sent",
  "replied",
  "booked",
  "closed",
];

const TURN_TYPE_LABELS: Record<string, string> = {
  turn1: "T1",
  turn2_generic: "T2",
  turn3_generic: "T3",
  follow_up_4h: "FU4h",
  follow_up_24h: "FU24h",
  follow_up_3d: "FU3d",
  objection_response: "Obj",
  booking_propose: "Booking",
};

export const Route = createFileRoute("/_authenticated/pipeline")({
  loader: async () => {
    return await getPipelineKanban({ data: { lookback_days: 30 } });
  },
  staleTime: 30_000,
  pendingComponent: PipelinePending,
  errorComponent: ({ error }) => {
    const router = useRouter();
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Pipeline</h1>
        <ErrorComponent error={error} />
        <button className="text-sm underline" onClick={() => router.invalidate()}>
          Reintentar
        </button>
      </div>
    );
  },
  component: PipelinePage,
});

function PipelinePending() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Pipeline</h1>
      <div className="grid grid-cols-6 gap-3">
        {STAGE_ORDER.map((s) => (
          <Skeleton key={s} className="h-[600px] w-full" />
        ))}
      </div>
    </div>
  );
}

function PipelinePage() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const [selected, setSelected] = useState<PipelineCard | null>(null);
  const [filterSegment, setFilterSegment] = useState<string | null>(null);
  const [filterTurn, setFilterTurn] = useState<string | null>(null);

  // Polling cada 30s
  useEffect(() => {
    const id = setInterval(() => router.invalidate(), 30_000);
    return () => clearInterval(id);
  }, [router]);

  // Aplicar filtros a las columnas
  const filteredColumns = useMemo(() => {
    const out: Record<PipelineStage, PipelineCard[]> = {
      pending: [],
      sending: [],
      sent: [],
      replied: [],
      booked: [],
      closed: [],
    };
    for (const stage of STAGE_ORDER) {
      out[stage] = data.columns[stage].filter((c) => {
        if (filterSegment && c.segmento !== filterSegment) return false;
        if (filterTurn && (c.turn_type ?? "turn1") !== filterTurn) return false;
        return true;
      });
    }
    return out;
  }, [data.columns, filterSegment, filterTurn]);

  // Counts derivados
  const filteredCounts = useMemo(() => {
    const out: Record<PipelineStage, number> = {
      pending: 0,
      sending: 0,
      sent: 0,
      replied: 0,
      booked: 0,
      closed: 0,
    };
    for (const stage of STAGE_ORDER) out[stage] = filteredColumns[stage].length;
    return out;
  }, [filteredColumns]);

  // Build distinct segmento y turn_type values del dataset completo
  const allSegments = useMemo(() => {
    const set = new Set<string>();
    for (const stage of STAGE_ORDER)
      for (const c of data.columns[stage]) if (c.segmento) set.add(c.segmento);
    return Array.from(set).sort();
  }, [data.columns]);
  const allTurns = useMemo(() => {
    const set = new Set<string>();
    for (const stage of STAGE_ORDER)
      for (const c of data.columns[stage]) set.add(c.turn_type ?? "turn1");
    return Array.from(set).sort();
  }, [data.columns]);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            Vista por etapas, últimos 30 días. Refresca cada 30s.
          </p>
        </div>
        <div className="text-xs text-muted-foreground">
          {STAGE_ORDER.reduce((acc, s) => acc + filteredCounts[s], 0)} casos
          {(filterSegment || filterTurn) && ` (filtrados)`}
        </div>
      </div>

      {/* Filtros */}
      {(allSegments.length > 1 || allTurns.length > 1) && (
        <div className="rounded-lg border bg-card p-3 space-y-2">
          {allSegments.length > 1 && (
            <FilterRow
              label="Segmento"
              options={allSegments}
              selected={filterSegment}
              onChange={setFilterSegment}
            />
          )}
          {allTurns.length > 1 && (
            <FilterRow
              label="Tipo"
              options={allTurns}
              selected={filterTurn}
              onChange={setFilterTurn}
              labelMap={TURN_TYPE_LABELS}
            />
          )}
        </div>
      )}

      {/* Columnas */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 min-h-0">
        {STAGE_ORDER.map((stage) => {
          const meta = STAGE_META[stage];
          const cards = filteredColumns[stage];
          return (
            <div
              key={stage}
              className={cn(
                "rounded-lg border flex flex-col h-[calc(100vh-15rem)] min-h-0",
                meta.color
              )}
            >
              <div className="p-3 border-b shrink-0">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-sm font-semibold">
                    {meta.emoji} {meta.label}
                  </h3>
                  <span className="text-xs font-medium text-muted-foreground">
                    {cards.length}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {meta.description}
                </p>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {cards.length === 0 ? (
                  <div className="text-center text-[11px] text-muted-foreground italic py-6">
                    sin casos
                  </div>
                ) : (
                  cards.map((c) => (
                    <PipelineCardItem key={c.id} card={c} onClick={() => setSelected(c)} />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto p-0">
          {selected && (
            <>
              <SheetHeader className="border-b p-6">
                <SheetTitle className="truncate text-base">
                  {selected.lead_name ?? selected.lead_email ?? selected.id}
                </SheetTitle>
                {selected.lead_email && selected.lead_name && (
                  <p className="truncate text-xs text-muted-foreground text-left">
                    {selected.lead_email}
                  </p>
                )}
              </SheetHeader>
              <div className="p-6 space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  <Field label="Etapa" value={STAGE_META[selected.stage].label} />
                  <Field label="Status raw" value={selected.status} />
                  <Field label="Segmento" value={selected.segmento} />
                  <Field
                    label="Turn type"
                    value={TURN_TYPE_LABELS[selected.turn_type ?? "turn1"] ?? selected.turn_type}
                  />
                  <Field label="Patrón" value={selected.patron} />
                  <Field label="Score" value={selected.score?.toString()} />
                  <Field label="SDR action" value={selected.sdr_action} />
                  <Field label="Sent at" value={selected.sent_at ? formatTime(selected.sent_at) : "—"} />
                  <Field label="Replied at" value={selected.replied_at ? formatTime(selected.replied_at) : "—"} />
                  <Field label="Booked at" value={selected.booked_at ? formatTime(selected.booked_at) : "—"} />
                </div>

                <HubSpotLeadContextCard hubspotContactId={selected.hubspot_contact_id} />

                <div>
                  <div className="text-xs font-medium uppercase text-muted-foreground mb-2">
                    Conversación (Smartlead)
                  </div>
                  <ConversationThread
                    smartleadLeadId={selected.smartlead_lead_id}
                    campaignId={selected.campaign_id}
                    defaultCompact
                  />
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function PipelineCardItem({ card, onClick }: { card: PipelineCard; onClick: () => void }) {
  const ageLabel = formatAge(card.created_at);
  const turn = card.turn_type ?? "turn1";
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-md border bg-background p-2 text-left hover:bg-accent transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">
            {card.lead_name || card.lead_email || card.smartlead_lead_id || card.id.slice(0, 8)}
          </div>
          {card.lead_email && card.lead_name && (
            <div className="truncate text-[10px] text-muted-foreground">
              {card.lead_email}
            </div>
          )}
        </div>
        {typeof card.score === "number" && (
          <span
            className={cn(
              "text-[10px] font-semibold shrink-0",
              card.score >= 95
                ? "text-emerald-600 dark:text-emerald-400"
                : card.score >= 85
                ? "text-amber-600 dark:text-amber-400"
                : "text-red-600 dark:text-red-400"
            )}
          >
            {card.score}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center gap-1 flex-wrap">
        <span className="rounded bg-muted px-1 py-0 text-[9px] uppercase">
          {TURN_TYPE_LABELS[turn] ?? turn}
        </span>
        {card.segmento && (
          <Badge variant="outline" className="h-4 px-1 text-[9px]">
            {card.segmento}
          </Badge>
        )}
        {card.patron && (
          <Badge variant="outline" className="h-4 px-1 text-[9px]">
            {card.patron}
          </Badge>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">{ageLabel}</span>
      </div>
    </button>
  );
}

function FilterRow({
  label,
  options,
  selected,
  onChange,
  labelMap,
}: {
  label: string;
  options: string[];
  selected: string | null;
  onChange: (value: string | null) => void;
  labelMap?: Record<string, string>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] uppercase text-muted-foreground w-16 shrink-0">{label}:</span>
      {options.map((opt) => {
        const active = selected === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(active ? null : opt)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
              active
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background hover:bg-accent"
            )}
          >
            {labelMap?.[opt] ?? opt}
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="font-medium break-words text-sm">{value ?? "—"}</div>
    </div>
  );
}

function formatAge(ts?: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "ahora";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d`;
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
