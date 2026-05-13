import { createFileRoute, ErrorComponent, Link, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  getAutoSendMonitor,
  type AutoSendCandidate,
  type AutoSendVersionConfig,
  type ScoreBucket,
  type ThresholdScenario,
  type HumanReviewByScore,
  type TopCriticalError,
} from "@/api/prompts.functions";
import { approveQuick, approveQuickWithEdit, rejectQuick } from "@/api/triage.functions";
import { ConversationThread } from "@/components/ConversationThread";
import { HubSpotLeadContextCard } from "@/components/HubSpotLeadContext";

// Mismas razones que /triage (consistencia de feedback)
const COACHING_REASONS = [
  "Halago disfrazado",
  "Jerga consultor",
  "Tono no encaja",
  "Estructura incorrecta",
  "Saludo incorrecto",
  "Firma incorrecta",
  "No respeta el reply del lead",
];

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
  const router = useRouter();
  const data = Route.useLoaderData();
  const {
    candidates,
    generator_versions,
    score_distribution,
    threshold_scenarios,
    human_review_by_score,
    top_critical_errors,
    reviewed_total_14d,
  } = data;
  const approveFn = useServerFn(approveQuick);
  const editApproveFn = useServerFn(approveQuickWithEdit);
  const rejectFn = useServerFn(rejectQuick);
  const [pending, setPending] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);

  // Agrupar candidatos por versión del generator (para la lista sidebar)
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

  // Auto-select: si no hay nada seleccionado o el seleccionado ya no existe,
  // saltar al primer candidato disponible.
  useEffect(() => {
    if (candidates.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    const stillExists = selectedId && candidates.some((c) => c.pipeline_id === selectedId);
    if (!stillExists) setSelectedId(candidates[0].pipeline_id);
  }, [candidates, selectedId]);

  const selected = useMemo(
    () => candidates.find((c) => c.pipeline_id === selectedId) ?? null,
    [candidates, selectedId]
  );

  const handleApprove = useCallback(
    async (id: string) => {
      setPending(id);
      try {
        const res = await approveFn({ data: { id } });
        if (!res.ok) alert(`Enviar falló: ${res.error}`);
        await router.invalidate();
      } catch (e) {
        alert(`Error: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setPending(null);
      }
    },
    [approveFn, router]
  );

  const handleReject = useCallback(
    async (id: string) => {
      setPending(id);
      try {
        const res = await rejectFn({ data: { id } });
        if (!res.ok) alert(`Mover a triage falló: ${res.error}`);
        await router.invalidate();
      } catch (e) {
        alert(`Error: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setPending(null);
      }
    },
    [rejectFn, router]
  );

  const handleEditAndApprove = useCallback(
    async (id: string, original: string, edited: string, reasons: string[], otherReason?: string) => {
      setPending(id);
      try {
        const res = await editApproveFn({
          data: { id, original, edited, reasons, otherReason },
        });
        if (!res.ok) alert(`Editar y enviar falló: ${res.error}`);
        await router.invalidate();
      } catch (e) {
        alert(`Error: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setPending(null);
      }
    },
    [editApproveFn, router]
  );

  // Atajos de teclado: j/k navegar, y aprobar, n rechazar
  useEffect(() => {
    function isTyping(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return (
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable
      );
    }
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      const idx = selected ? candidates.findIndex((c) => c.pipeline_id === selected.pipeline_id) : -1;
      if (k === "j") {
        e.preventDefault();
        if (candidates.length === 0) return;
        const next = idx < 0 ? 0 : Math.min(candidates.length - 1, idx + 1);
        setSelectedId(candidates[next].pipeline_id);
        return;
      }
      if (k === "k") {
        e.preventDefault();
        if (candidates.length === 0) return;
        const prev = idx < 0 ? 0 : Math.max(0, idx - 1);
        setSelectedId(candidates[prev].pipeline_id);
        return;
      }
      if (!selected || pending) return;
      if (k === "y") {
        e.preventDefault();
        void handleApprove(selected.pipeline_id);
      } else if (k === "n") {
        e.preventDefault();
        void handleReject(selected.pipeline_id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [candidates, selected, pending, handleApprove, handleReject]);

  const edit95 = human_review_by_score.find((x) => x.label === "95+");
  const edit95Pct = edit95 ? `${(edit95.edit_rate * 100).toFixed(0)}%` : "—";
  const edit95Tone = !edit95
    ? "muted"
    : edit95.edit_rate < 0.2
    ? "emerald"
    : edit95.edit_rate < 0.4
    ? "amber"
    : "red";

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* === Header compacto === */}
      <header className="space-y-2">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              🚪 Quick-gate · Auto-send Monitor
            </h1>
            <p className="text-xs text-muted-foreground">
              MEGA sin tienda · score ≥90 · sin errores críticos.{" "}
              <strong>NO entran a /triage.</strong> Tu Sí/No alimenta el ratio que mide
              si el prompt está listo para auto-send completo.
            </p>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <kbd className="rounded border px-1.5 py-0.5 font-mono">j/k</kbd> navegar
            <kbd className="rounded border px-1.5 py-0.5 font-mono">y</kbd> sí
            <kbd className="rounded border px-1.5 py-0.5 font-mono">n</kbd> no
          </div>
        </div>

        {/* KPI strip compacta */}
        <div className="grid grid-cols-3 gap-2">
          <KpiChip
            label="🚪 Esperando"
            value={candidates.length.toString()}
            tone={candidates.length > 0 ? "emerald" : "muted"}
          />
          <KpiChip
            label="Revisados 14d"
            value={reviewed_total_14d.toString()}
            tone="muted"
          />
          <KpiChip
            label="Edit-rate 95+"
            value={edit95Pct}
            tone={edit95Tone}
            hint={edit95Tone === "emerald" ? "🟢 listo para auto-send full" : edit95Tone === "amber" ? "🟡 cap diario bajo" : edit95Tone === "red" ? "🔴 no activar todavía" : undefined}
          />
        </div>
      </header>

      {/* === Split layout: list + detail === */}
      <div className="flex h-[calc(100vh-16rem)] min-h-[600px] gap-4">
        {/* Sidebar lista de casos */}
        <aside className="w-[320px] flex-shrink-0 flex flex-col gap-2 overflow-hidden">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Casos ({candidates.length})
            </h2>
            <span className="text-[10px] text-muted-foreground">
              {groupedByVersion.length} versión{groupedByVersion.length === 1 ? "" : "es"}
            </span>
          </div>
          <div className="flex flex-col gap-3 overflow-y-auto pr-1 flex-1">
            {candidates.length === 0 ? (
              <div className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-xs text-muted-foreground">
                Sin casos en quick-gate.
                <br />
                <span className="italic">
                  Refrescará automáticamente cuando entre uno.
                </span>
              </div>
            ) : (
              groupedByVersion.map(([versionLabel, cands]) => (
                <div key={versionLabel} className="space-y-1">
                  <div className="flex items-center gap-1.5 px-1">
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {versionLabel}
                    </span>
                    <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                      {cands.length}
                    </Badge>
                  </div>
                  <div className="flex flex-col gap-1">
                    {cands.map((c) => (
                      <CandidateListItem
                        key={c.pipeline_id}
                        c={c}
                        active={c.pipeline_id === selectedId}
                        onClick={() => setSelectedId(c.pipeline_id)}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Panel detalle */}
        <section className="flex-1 min-w-0 overflow-hidden rounded-lg border bg-card">
          {selected ? (
            <CandidateDetail
              key={selected.pipeline_id}
              c={selected}
              pending={pending === selected.pipeline_id}
              disabled={pending !== null && pending !== selected.pipeline_id}
              onApprove={() => handleApprove(selected.pipeline_id)}
              onReject={() => handleReject(selected.pipeline_id)}
              onEditAndApprove={(edited, reasons, otherReason) =>
                handleEditAndApprove(
                  selected.pipeline_id,
                  selected.turn_1_generated ?? "",
                  edited,
                  reasons,
                  otherReason
                )
              }
            />
          ) : (
            <div className="flex h-full items-center justify-center p-12 text-sm text-muted-foreground text-center">
              {candidates.length === 0 ? (
                <div>
                  🎉 Cero casos en quick-gate.
                  <br />
                  <span className="text-xs italic">
                    Mientras tanto, revisa la sección Analytics más abajo para calibrar
                    el threshold.
                  </span>
                </div>
              ) : (
                "Selecciona un caso de la lista"
              )}
            </div>
          )}
        </section>
      </div>

      {/* === Analytics colapsable (debajo del split) === */}
      <Collapsible open={analyticsOpen} onOpenChange={setAnalyticsOpen}>
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border bg-card px-4 py-2 text-sm hover:bg-accent/30 transition-colors">
          <div className="flex items-center gap-2">
            <span className="font-semibold">📊 Analytics & calibración del prompt</span>
            <span className="text-xs text-muted-foreground">
              versiones · edit-rate · histograma · errores críticos
            </span>
          </div>
          <span className="text-muted-foreground text-xs">
            {analyticsOpen ? "Ocultar ▴" : "Mostrar ▾"}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-6 pt-4">
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
          <HumanReviewSection rows={human_review_by_score} total={reviewed_total_14d} />
          <CalibrationSection buckets={score_distribution} scenarios={threshold_scenarios} />
          <TopErrorsSection errors={top_critical_errors} />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// ---------- Sidebar list item compacto ----------

function CandidateListItem({
  c,
  active,
  onClick,
}: {
  c: AutoSendCandidate;
  active: boolean;
  onClick: () => void;
}) {
  const score = c.score ?? 0;
  const ageMin = c.created_at
    ? Math.max(0, Math.floor((Date.now() - Date.parse(c.created_at)) / 60_000))
    : null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-left rounded-md border bg-card p-2 transition-colors hover:bg-accent/50",
        active && "border-primary bg-accent"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium truncate">
            {c.lead_name || c.lead_email || "—"}
          </div>
          <div className="text-[10px] text-muted-foreground truncate">{c.lead_email}</div>
        </div>
        <Badge className="h-4 px-1 text-[9px] bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-200">
          {score}
        </Badge>
      </div>
      <div className="mt-1 flex items-center gap-1 flex-wrap text-[9px] text-muted-foreground">
        {c.patron && (
          <span className="rounded border px-1 py-0">P{c.patron}</span>
        )}
        {c.has_known_store === false && (
          <span className="rounded border bg-violet-50 dark:bg-violet-950/40 px-1 py-0">
            sin tienda
          </span>
        )}
        {c.has_known_store === null && (
          <span className="rounded border bg-slate-50 dark:bg-slate-950/40 px-1 py-0">
            tienda?
          </span>
        )}
        {ageMin !== null && <span className="ml-auto">{formatAge(ageMin)}</span>}
      </div>
    </button>
  );
}

// ---------- Panel detalle (la UX rica que ya teníamos) ----------

function CandidateDetail({
  c,
  pending,
  disabled,
  onApprove,
  onReject,
  onEditAndApprove,
}: {
  c: AutoSendCandidate;
  pending: boolean;
  disabled: boolean;
  onApprove: () => void;
  onReject: () => void;
  onEditAndApprove: (edited: string, reasons: string[], otherReason?: string) => void;
}) {
  const score = c.score ?? 0;
  const original = c.turn_1_generated ?? "";
  const [edited, setEdited] = useState(original);
  const [reasons, setReasons] = useState<string[]>([]);
  const [otherReason, setOtherReason] = useState("");
  const [coachOpen, setCoachOpen] = useState(false);
  const isEdited = edited.trim() !== original.trim();
  const ageMin = c.created_at
    ? Math.max(0, Math.floor((Date.now() - Date.parse(c.created_at)) / 60_000))
    : null;

  function toggleReason(r: string) {
    setReasons((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]
    );
  }

  function handleSendEdited() {
    onEditAndApprove(edited, reasons, otherReason.trim() || undefined);
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header sticky con lead + meta */}
      <div className="border-b px-4 py-3 flex items-center justify-between gap-2 flex-wrap text-sm bg-card">
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">
            {c.lead_name || c.lead_email || "—"}
          </div>
          <div className="text-[11px] text-muted-foreground truncate">{c.lead_email}</div>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground flex-wrap">
          <Badge className="h-5 text-[10px] bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200 hover:bg-emerald-100">
            score {score}
          </Badge>
          {c.patron && (
            <Badge variant="outline" className="h-5 text-[10px]">
              Patrón {c.patron}
            </Badge>
          )}
          {c.has_known_store === false && (
            <Badge variant="outline" className="h-5 text-[10px] bg-violet-50 dark:bg-violet-950/40">
              sin tienda
            </Badge>
          )}
          {c.has_known_store === null && (
            <Badge variant="outline" className="h-5 text-[10px] bg-slate-50 dark:bg-slate-950/40">
              tienda?
            </Badge>
          )}
          <span>{ageMin !== null ? `hace ${formatAge(ageMin)}` : "—"}</span>
        </div>
      </div>

      {/* Cuerpo scrollable: thread + textarea + HubSpot */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
          {/* Columna principal */}
          <div className="space-y-3 min-w-0">
            <div>
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                💬 Conversación
              </h4>
              <ConversationThread
                smartleadLeadId={c.smartlead_lead_id}
                snapshot={c.thread_snapshot}
                leadEmail={c.lead_email}
                defaultCompact
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  ✍️ Respuesta propuesta {isEdited && <span className="text-amber-600 normal-case">· editada</span>}
                </h4>
                {isEdited && (
                  <button
                    type="button"
                    onClick={() => setEdited(original)}
                    className="text-[10px] underline text-muted-foreground hover:text-foreground"
                  >
                    ↺ Revertir
                  </button>
                )}
              </div>
              <Textarea
                value={edited}
                onChange={(e) => setEdited(e.target.value)}
                rows={Math.max(6, Math.min(16, edited.split("\n").length + 1))}
                className="font-sans text-sm leading-relaxed"
                disabled={pending || disabled}
              />
            </div>

            {(isEdited || coachOpen) && (
              <div className="rounded-md border border-blue-200 dark:border-blue-900/50 bg-blue-50/40 dark:bg-blue-950/20 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-[10px] font-semibold uppercase tracking-wider text-blue-900 dark:text-blue-200">
                    🎓 Feedback al coach IA {isEdited && <span className="text-amber-700 dark:text-amber-300 normal-case">· requerido</span>}
                  </h4>
                  {!isEdited && (
                    <button
                      type="button"
                      onClick={() => setCoachOpen(false)}
                      className="text-[10px] underline text-muted-foreground"
                    >
                      Cerrar
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-blue-900/80 dark:text-blue-200/80">
                  Marca qué falló para que la próxima vez el prompt lo evite. Las
                  razones se guardan en <code>edit_reasons</code> y alimentan el
                  AI Coach.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {COACHING_REASONS.map((r) => {
                    const active = reasons.includes(r);
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => toggleReason(r)}
                        disabled={pending || disabled}
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                          active
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-background hover:bg-accent text-foreground"
                        )}
                      >
                        {r}
                      </button>
                    );
                  })}
                </div>
                <Textarea
                  value={otherReason}
                  onChange={(e) => setOtherReason(e.target.value)}
                  placeholder="Otro motivo o detalle específico (opcional)…"
                  rows={2}
                  disabled={pending || disabled}
                  className="text-xs"
                />
              </div>
            )}

            {!isEdited && !coachOpen && (
              <button
                type="button"
                onClick={() => setCoachOpen(true)}
                className="text-[11px] underline text-muted-foreground hover:text-foreground"
              >
                🎓 Dejar feedback al coach sin editar
              </button>
            )}
          </div>

          {/* Columna lateral: HubSpot context */}
          <div className="space-y-2 min-w-0">
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              🏢 Contexto HubSpot
            </h4>
            <HubSpotLeadContextCard hubspotContactId={c.hubspot_contact_id} />
            {c.setter_name && (
              <div className="text-[11px] text-muted-foreground">
                Setter: <span className="font-medium text-foreground">{c.setter_name}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer sticky con acciones */}
      <div className="border-t bg-card px-4 py-3 flex gap-2 flex-wrap items-center">
        {!isEdited ? (
          <Button
            onClick={onApprove}
            disabled={pending || disabled}
            className="flex-1 h-10 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
          >
            {pending ? "Enviando…" : "✅ Sí, enviar tal cual (y)"}
          </Button>
        ) : (
          <Button
            onClick={handleSendEdited}
            disabled={pending || disabled || edited.trim().length === 0}
            className="flex-1 h-10 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
            title={
              reasons.length === 0 && !otherReason.trim()
                ? "Considera marcar al menos una razón para entrenar al coach"
                : "Enviar la versión editada"
            }
          >
            {pending ? "Enviando editada…" : "✅ Enviar editada"}
          </Button>
        )}
        <Button
          onClick={onReject}
          disabled={pending || disabled}
          variant="outline"
          className="flex-1 h-10 border-amber-300 text-amber-900 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-200 text-sm font-semibold"
        >
          {pending ? "Moviendo…" : "❌ No, a /triage (n)"}
        </Button>
        <Link
          to="/triage"
          className="self-center text-[11px] underline text-muted-foreground hover:text-foreground"
        >
          Abrir en /triage
        </Link>
        {c.lead_email && (
          <Link
            to="/lead/$email"
            params={{ email: encodeURIComponent(c.lead_email) }}
            className="self-center text-[11px] underline text-muted-foreground hover:text-foreground"
          >
            🔍 Timeline
          </Link>
        )}
      </div>
    </div>
  );
}

// ---------- KPI chip compacta (1 línea) ----------

function KpiChip({
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
    <div className="rounded-md border bg-card px-3 py-2 flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">
          {label}
        </div>
        {hint && (
          <div className="text-[10px] text-muted-foreground italic truncate">{hint}</div>
        )}
      </div>
      <div className={cn("text-xl font-semibold tabular-nums", toneClass)}>{value}</div>
    </div>
  );
}

// ---------- Version config card (inalterado, vive ahora en collapsible) ----------

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

// ---------- Human review (la métrica que decide cuándo activar auto-send) ----------

function HumanReviewSection({
  rows,
  total,
}: {
  rows: HumanReviewByScore[];
  total: number;
}) {
  const headlineBucket = rows.find((r) => r.label === "95+");
  const headlineEditRate = headlineBucket
    ? (headlineBucket.edit_rate * 100).toFixed(0)
    : "—";
  const headlineN = headlineBucket
    ? headlineBucket.approved_as_is + headlineBucket.edited_and_sent
    : 0;
  const tone =
    !headlineBucket || headlineN === 0
      ? "muted"
      : headlineBucket.edit_rate < 0.2
      ? "emerald"
      : headlineBucket.edit_rate < 0.4
      ? "amber"
      : "red";
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        ⚖️ Calidad real con humano · score ≥95 · {total} revisados en 14d
      </h2>
      <div className="rounded-lg border bg-card p-3 space-y-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <div className="text-[11px] text-muted-foreground">
            Edit-rate score 95+ (% que el SDR edita antes de aprobar):
          </div>
          <div
            className={cn(
              "text-3xl font-semibold tabular-nums",
              tone === "emerald" && "text-emerald-700 dark:text-emerald-300",
              tone === "amber" && "text-amber-700 dark:text-amber-300",
              tone === "red" && "text-red-700 dark:text-red-300"
            )}
          >
            {headlineEditRate}%
          </div>
          <div className="text-[11px] text-muted-foreground italic">n={headlineN}</div>
        </div>
        <div className="text-[11px] text-muted-foreground italic">
          Regla: si edit-rate del bucket {">= "}40% → el threshold actual NO está
          listo para auto-send. Si {"<"}20% → seguro de activar. Entre 20-40% →
          puedes activar con cap diario bajo y vigilar.
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-1 font-medium">Score</th>
              <th className="py-1 font-medium text-right">Aprobado tal cual</th>
              <th className="py-1 font-medium text-right">Editado antes</th>
              <th className="py-1 font-medium text-right">Rechazado</th>
              <th className="py-1 font-medium text-right">Edit-rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const ratePct = (r.edit_rate * 100).toFixed(0);
              const rateColor =
                r.edit_rate < 0.2
                  ? "text-emerald-600 dark:text-emerald-400"
                  : r.edit_rate < 0.4
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-red-600 dark:text-red-400";
              const sent = r.approved_as_is + r.edited_and_sent;
              return (
                <tr key={r.label} className="border-b last:border-0">
                  <td className="py-1 font-mono">{r.label}</td>
                  <td className="py-1 text-right tabular-nums">{r.approved_as_is}</td>
                  <td className="py-1 text-right tabular-nums">{r.edited_and_sent}</td>
                  <td className="py-1 text-right tabular-nums">{r.rejected}</td>
                  <td
                    className={cn(
                      "py-1 text-right tabular-nums font-semibold",
                      sent > 0 ? rateColor : "text-muted-foreground"
                    )}
                  >
                    {sent > 0 ? `${ratePct}%` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------- Calibración: histograma + scenarios "what-if" ----------

function CalibrationSection({
  buckets,
  scenarios,
}: {
  buckets: ScoreBucket[];
  scenarios: ThresholdScenario[];
}) {
  const maxBucket = Math.max(...buckets.map((b) => b.total), 1);
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        📊 Calibración del threshold (14d)
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-lg border bg-card p-3 space-y-2">
          <div className="text-[11px] text-muted-foreground">
            Distribución de scores. Barra clara = total. Barra oscura = sin
            errores críticos (auto-sendable si threshold lo permite).
          </div>
          <div className="space-y-1">
            {buckets.map((b) => {
              const totalPct = (b.total / maxBucket) * 100;
              const cleanPct = (b.without_critical_errors / maxBucket) * 100;
              return (
                <div key={b.label} className="flex items-center gap-2 text-[11px]">
                  <div className="w-12 font-mono tabular-nums text-muted-foreground">
                    {b.label}
                  </div>
                  <div className="flex-1 h-5 bg-muted/40 rounded relative overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 bg-slate-300 dark:bg-slate-700"
                      style={{ width: `${totalPct}%` }}
                    />
                    <div
                      className="absolute inset-y-0 left-0 bg-emerald-500/70"
                      style={{ width: `${cleanPct}%` }}
                    />
                  </div>
                  <div className="w-20 text-right tabular-nums text-muted-foreground">
                    {b.without_critical_errors}/{b.total}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3 space-y-2">
          <div className="text-[11px] text-muted-foreground">
            Si bajaras/subieras el threshold, cuántos casos cumplirían criterios
            (score ≥ threshold AND sin errores críticos) en los últimos 14d.
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1 font-medium">Threshold</th>
                <th className="py-1 font-medium text-right">Candidatos 14d</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s) => (
                <tr key={s.threshold} className="border-b last:border-0">
                  <td className="py-1 font-mono">≥{s.threshold}</td>
                  <td className="py-1 text-right tabular-nums">{s.n_candidates}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[10px] text-muted-foreground italic">
            Cruza esto con la tabla de edit-rate arriba: el threshold ideal es
            el más bajo donde edit-rate {"<"} 20%.
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------- Top errores críticos ----------

function TopErrorsSection({ errors }: { errors: TopCriticalError[] }) {
  if (errors.length === 0) return null;
  const max = Math.max(...errors.map((e) => e.count), 1);
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        🔴 Errores críticos más comunes (14d)
      </h2>
      <div className="rounded-lg border bg-card p-3 space-y-2">
        <div className="text-[11px] text-muted-foreground">
          Los errores que más bajan score y bloquean candidatos. Arreglar el
          prompt para eliminar estos = más volumen pasaría el filtro de auto-send.
        </div>
        <div className="space-y-1.5">
          {errors.map((e, i) => {
            const pct = (e.count / max) * 100;
            return (
              <div key={i} className="space-y-0.5">
                <div className="flex items-baseline gap-2 text-[11px]">
                  <span className="font-mono tabular-nums w-8 text-right text-muted-foreground">
                    {e.count}×
                  </span>
                  <span className="flex-1 truncate" title={e.error_text}>
                    {e.error_text}
                  </span>
                </div>
                <div className="h-1.5 bg-muted/40 rounded overflow-hidden">
                  <div className="h-full bg-red-500/60" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function formatAge(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ${min % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
