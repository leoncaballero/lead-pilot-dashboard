import { createFileRoute, ErrorComponent, Link, useRouter } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  getLeadTimeline,
  type LeadTimeline,
  type LeadTimelineRow,
} from "@/api/triage.functions";
import { HubSpotLeadContextCard } from "@/components/HubSpotLeadContext";

export const Route = createFileRoute("/_authenticated/lead/$email")({
  loader: async ({ params }) =>
    await getLeadTimeline({ data: { email: decodeURIComponent(params.email) } }),
  staleTime: 10_000,
  pendingComponent: Pending,
  errorComponent: ({ error }) => {
    const router = useRouter();
    return (
      <div className="space-y-4 p-4">
        <h1 className="text-2xl font-semibold">Lead Timeline</h1>
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
      <h1 className="text-2xl font-semibold">Lead Timeline</h1>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-32 w-full" />
      ))}
    </div>
  );
}

function Page() {
  const data: LeadTimeline = Route.useLoaderData();

  if (!data.found) {
    return (
      <div className="p-4 space-y-3 max-w-4xl">
        <h1 className="text-2xl font-semibold">Lead Timeline</h1>
        <div className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          No hay ningún pipeline row para <code>{data.lead_email}</code>.
          <br />
          <span className="text-[11px] italic">
            Posibles causas: el reply no llegó al webhook de Smartlead, el WF[01]
            lo filtró como "no interesado" antes de crear row, o el email está mal
            escrito. Mira las executions de n8n en WF[01] para más contexto.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6 max-w-6xl">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">
          {data.lead_name || data.lead_email}
        </h1>
        <p className="text-sm text-muted-foreground">
          {data.lead_email} ·{" "}
          <strong>{data.rows.length}</strong> pipeline row
          {data.rows.length === 1 ? "" : "s"} · cronología end-to-end
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Timeline principal */}
        <div className="space-y-4 min-w-0">
          {data.rows.map((row, idx) => (
            <PipelineRowCard key={row.pipeline_id} row={row} idx={idx} total={data.rows.length} />
          ))}
        </div>

        {/* Sidebar HubSpot */}
        <div className="space-y-3 min-w-0">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Contexto HubSpot
          </h3>
          <HubSpotLeadContextCard hubspotContactId={data.hubspot_contact_id} />
          <div className="rounded-md border bg-card/60 p-3 text-[11px] space-y-1">
            <div>
              <span className="text-muted-foreground">smartlead_thread_id:</span>{" "}
              <code className="text-[10px]">
                {data.rows[0].smartlead_thread_id ?? "—"}
              </code>
            </div>
            <div>
              <span className="text-muted-foreground">setter:</span>{" "}
              <span className="font-medium">{data.rows[0].setter_name ?? "—"}</span>
            </div>
          </div>
          <Link
            to="/triage"
            className="block text-[11px] underline text-muted-foreground hover:text-foreground"
          >
            Volver a /triage
          </Link>
        </div>
      </div>
    </div>
  );
}

function PipelineRowCard({
  row,
  idx,
  total,
}: {
  row: LeadTimelineRow;
  idx: number;
  total: number;
}) {
  // Construir lista cronológica de eventos del row:
  // [reply del lead → row creado → eventos → outcomes → estado final]
  const items: Array<TimelineItem> = [];

  if (row.reply_timestamp) {
    items.push({
      kind: "reply",
      at: row.reply_timestamp,
      title: "Reply del lead",
      detail: row.reply_original,
    });
  }
  if (row.created_at) {
    items.push({
      kind: "row_created",
      at: row.created_at,
      title: `Row creada (Turn ${row.turn_number ?? "?"}, ${row.turn_type ?? "?"})`,
      detail: `segmento=${row.segmento ?? "?"} · has_known_store=${
        row.has_known_store === true ? "true" : row.has_known_store === false ? "false" : "null"
      } · status inicial=${row.status ?? "?"} · score=${row.score ?? "—"}`,
    });
  }
  for (const e of row.events) {
    items.push({
      kind: "event",
      at: e.created_at,
      title: prettyEvent(e.event_type),
      detail: e.payload ? JSON.stringify(e.payload) : null,
    });
  }
  if (row.sent_at) {
    items.push({
      kind: "sent",
      at: row.sent_at,
      title: "Enviado vía Smartlead",
      detail: row.campaign_id ? `campaign_id=${row.campaign_id}` : null,
    });
  }
  for (const o of row.outcomes) {
    items.push({
      kind: "outcome",
      at: o.occurred_at,
      title: `Outcome: ${o.outcome}`,
      detail: [
        o.outcome_source && `source=${o.outcome_source}`,
        o.meeting_start_time && `meeting=${o.meeting_start_time}`,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }
  items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  return (
    <section className="rounded-lg border bg-card overflow-hidden">
      {/* Header del row */}
      <header
        className={cn(
          "px-4 py-3 border-b flex items-center gap-2 flex-wrap",
          row.status === "sent" && "bg-emerald-50/40 dark:bg-emerald-950/20",
          row.status === "error_send" && "bg-red-50/40 dark:bg-red-950/20",
          row.status === "auto_rejected" && "bg-orange-50/40 dark:bg-orange-950/20",
          row.status === "rejected" && "bg-amber-50/40 dark:bg-amber-950/20",
          (row.status === "pending_review" || row.status === "pending_quick_review") &&
            "bg-blue-50/40 dark:bg-blue-950/20"
        )}
      >
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {idx + 1}/{total}
        </span>
        <Badge variant="outline" className="h-5 text-[10px]">
          Turn {row.turn_number ?? "?"}
        </Badge>
        <Badge variant="outline" className="h-5 text-[10px]">
          {row.turn_type ?? "?"}
        </Badge>
        <Badge variant="outline" className="h-5 text-[10px]">
          {row.segmento ?? "?"}
        </Badge>
        {row.patron && (
          <Badge variant="outline" className="h-5 text-[10px]">
            Patrón {row.patron}
          </Badge>
        )}
        <StatusBadge status={row.status} />
        {row.sdr_action && (
          <Badge variant="secondary" className="h-5 text-[10px]">
            SDR: {row.sdr_action}
          </Badge>
        )}
        {row.score !== null && (
          <Badge className="h-5 text-[10px] bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200 hover:bg-emerald-100">
            score {row.score}
          </Badge>
        )}
        {row.edit_reasons.length > 0 && (
          <Badge variant="outline" className="h-5 text-[10px] bg-amber-50 dark:bg-amber-950/40">
            {row.edit_reasons.length} edit reason{row.edit_reasons.length === 1 ? "" : "s"}
          </Badge>
        )}
      </header>

      {/* Timeline cronológico vertical */}
      <ol className="relative px-4 py-3 space-y-3">
        {items.length === 0 ? (
          <li className="text-[12px] text-muted-foreground italic">Sin eventos.</li>
        ) : (
          items.map((it, i) => <TimelineItemRow key={i} item={it} />)
        )}
      </ol>

      {/* Detalle texto: reply original + turn_1 generated/final */}
      {(row.reply_original || row.turn_1_generated || row.turn_1_final) && (
        <div className="px-4 py-3 border-t space-y-2 bg-muted/10">
          {row.reply_original && (
            <details className="rounded border bg-card px-2 py-1 text-[11px]">
              <summary className="cursor-pointer font-medium text-muted-foreground">
                💬 Reply del lead
              </summary>
              <pre className="mt-1 whitespace-pre-wrap font-sans text-foreground/90 max-h-40 overflow-y-auto">
                {row.reply_original}
              </pre>
            </details>
          )}
          {row.turn_1_generated && (
            <details className="rounded border bg-card px-2 py-1 text-[11px]">
              <summary className="cursor-pointer font-medium text-muted-foreground">
                🤖 Turn generado (lo que produjo la IA)
              </summary>
              <pre className="mt-1 whitespace-pre-wrap font-sans text-foreground/90 max-h-40 overflow-y-auto">
                {row.turn_1_generated}
              </pre>
            </details>
          )}
          {row.turn_1_final && row.turn_1_final !== row.turn_1_generated && (
            <details
              open
              className="rounded border bg-card px-2 py-1 text-[11px]"
            >
              <summary className="cursor-pointer font-medium text-emerald-700 dark:text-emerald-300">
                ✍️ Turn enviado (post-edición SDR)
              </summary>
              <pre className="mt-1 whitespace-pre-wrap font-sans text-foreground/90 max-h-40 overflow-y-auto">
                {row.turn_1_final}
              </pre>
            </details>
          )}
          {row.edit_reasons.length > 0 && (
            <div className="rounded border bg-amber-50/40 dark:bg-amber-950/20 px-2 py-1 text-[11px]">
              <div className="font-medium text-amber-900 dark:text-amber-200 mb-0.5">
                🎓 Razones de edición (feedback para coach)
              </div>
              <ul className="list-disc list-inside space-y-0.5 text-foreground/80">
                {row.edit_reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

type TimelineItem = {
  kind: "reply" | "row_created" | "event" | "sent" | "outcome";
  at: string;
  title: string;
  detail: string | null;
};

function TimelineItemRow({ item }: { item: TimelineItem }) {
  const palette: Record<TimelineItem["kind"], { dot: string; text: string }> = {
    reply: { dot: "bg-blue-500", text: "text-blue-900 dark:text-blue-200" },
    row_created: { dot: "bg-slate-400", text: "text-foreground" },
    event: { dot: "bg-violet-500", text: "text-foreground" },
    sent: { dot: "bg-emerald-500", text: "text-emerald-900 dark:text-emerald-200" },
    outcome: { dot: "bg-amber-500", text: "text-amber-900 dark:text-amber-200" },
  };
  const p = palette[item.kind];
  return (
    <li className="flex gap-3 items-start text-[12px]">
      <div className="flex flex-col items-center pt-0.5 shrink-0">
        <div className={cn("h-2.5 w-2.5 rounded-full", p.dot)} />
      </div>
      <div className="flex-1 min-w-0 pb-1">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <span className={cn("font-medium", p.text)}>{item.title}</span>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {formatTime(item.at)}
          </span>
        </div>
        {item.detail && (
          <div className="text-[11px] text-muted-foreground break-words">
            {item.detail}
          </div>
        )}
      </div>
    </li>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const map: Record<string, { tone: string; label?: string }> = {
    pending_review: { tone: "bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-200" },
    pending_quick_review: {
      tone: "bg-purple-100 text-purple-900 dark:bg-purple-950/60 dark:text-purple-200",
      label: "quick_review",
    },
    auto_rejected: {
      tone: "bg-orange-100 text-orange-900 dark:bg-orange-950/60 dark:text-orange-200",
    },
    rejected: { tone: "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200" },
    sent: { tone: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200" },
    ready_to_send: { tone: "bg-cyan-100 text-cyan-900 dark:bg-cyan-950/60 dark:text-cyan-200" },
    error_send: { tone: "bg-red-100 text-red-900 dark:bg-red-950/60 dark:text-red-200" },
    dry_run_only: { tone: "bg-slate-100 text-slate-900 dark:bg-slate-950/60 dark:text-slate-200" },
  };
  const m = map[status] ?? { tone: "bg-muted text-foreground" };
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", m.tone)}>
      {m.label ?? status}
    </span>
  );
}

function prettyEvent(et: string): string {
  const map: Record<string, string> = {
    turn_1_approved: "✅ SDR aprobó (sin editar)",
    turn_1_approved_via_quick_gate: "✅ Aprobado vía quick-gate",
    turn_1_rejected: "❌ SDR rechazó",
    turn_1_edited: "✏️ SDR editó antes de enviar",
    turn_1_edited_via_quick_gate: "✏️ Editado vía quick-gate",
    turn_1_regenerated: "🔄 Regenerado con IA",
    turn_1_sent_to_deep_review: "🔍 Enviado a deep review",
    has_known_store_manual_override: "🛒 SDR cambió has_known_store manualmente",
    quick_gate_sent_to_triage: "↩️ Movido de quick-gate a /triage",
    case_rescued_from_auto_rejected: "🛟 Rescatado de auto_rejected",
  };
  return map[et] ?? `· ${et}`;
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
