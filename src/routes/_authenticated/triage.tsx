import { createFileRoute, ErrorComponent, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useServerFn } from "@tanstack/react-start";
import {
  approveCase,
  deepReviewCase,
  editCase,
  getRealtimeConfig,
  getTriageCases,
  rejectCase,
  type TriageCase,
} from "@/api/triage.functions";

export const Route = createFileRoute("/_authenticated/triage")({
  loader: async () => {
    const [cases, realtime] = await Promise.all([
      getTriageCases(),
      getRealtimeConfig(),
    ]);
    return { ...cases, realtime };
  },
  staleTime: 5_000,
  pendingComponent: TriagePending,
  errorComponent: ({ error }) => {
    const router = useRouter();
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Triage Rápido</h1>
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
  notFoundComponent: () => <div>No encontrado</div>,
  component: TriagePage,
});

// ---------- helpers ----------

function minutesSince(ts?: string | null): number | null {
  if (!ts) return null;
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 60_000));
}

function slaColor(min: number | null): string {
  if (min === null) return "text-muted-foreground";
  if (min < 15) return "text-emerald-600 dark:text-emerald-400";
  if (min <= 25) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function scoreColor(score?: number | null): string {
  if (typeof score !== "number") return "text-muted-foreground";
  if (score >= 95) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 85) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

type Confidence = {
  level: "high" | "medium" | "low";
  label: string;
  short: string;
  hint: string;
  pillClasses: string;
  borderClasses: string;
};

function confidenceLevel(c: TriageCase): Confidence {
  const score = typeof c.score === "number" ? c.score : 0;
  const criticos = c.errores_criticos?.length ?? 0;
  if (criticos >= 1) {
    return {
      level: "low",
      label: "Confianza baja",
      short: "Revisar a fondo",
      hint: `${criticos} error${criticos === 1 ? "" : "es"} crítico${criticos === 1 ? "" : "s"} detectado${criticos === 1 ? "" : "s"}`,
      pillClasses: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border border-red-200 dark:border-red-800",
      borderClasses: "border-red-200 dark:border-red-800/60",
    };
  }
  if (score >= 95) {
    return {
      level: "high",
      label: "Confianza alta",
      short: "Revisión rápida",
      hint: "Score ≥95 sin críticos. Listo para enviar tras vistazo rápido.",
      pillClasses: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800",
      borderClasses: "border-emerald-200 dark:border-emerald-800/60",
    };
  }
  return {
    level: "medium",
    label: "Confianza media",
    short: "Revisar",
    hint: "Score entre 85 y 94. Cumple validación pero merece atención.",
    pillClasses: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800",
    borderClasses: "border-amber-200 dark:border-amber-800/60",
  };
}

// Etiquetas y colores por turn_type. Defensa progresiva: si la columna
// turn_type aun no existe en la DB (antes del DDL setting-pilot-extend-turns.sql),
// los rows tendran turn_type=undefined y se renderizan como turn1 (default).
const TURN_TYPE_LABELS: Record<string, { label: string; classes: string }> = {
  turn1: {
    label: "Turn 1",
    classes: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  },
  turn2_generic: {
    label: "Turn 2",
    classes: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  },
  turn3_generic: {
    label: "Turn 3",
    classes: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  },
  follow_up_4h: {
    label: "FU 4h",
    classes: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  },
  follow_up_24h: {
    label: "FU 24h",
    classes: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  },
  follow_up_3d: {
    label: "FU 3d",
    classes: "bg-orange-200 text-orange-900 dark:bg-orange-900/60 dark:text-orange-200",
  },
  objection_response: {
    label: "Objecion",
    classes: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  },
  booking_propose: {
    label: "Propuesta hora",
    classes: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
};

function turnTypeMeta(c: TriageCase) {
  const key = c.turn_type ?? "turn1";
  return TURN_TYPE_LABELS[key] ?? { label: key, classes: "bg-muted text-muted-foreground" };
}

const CHECK_LABELS: Record<string, string> = {
  personalizacion_funcional: "Personalización funcional",
  sin_halago_disfrazado: "Sin halago disfrazado",
  lenguaje_cotidiano: "Lenguaje cotidiano",
  patron_correcto_segun_clasificacion: "Patrón correcto",
  cuerpo_emocional_aspiracional_correcto: "Cuerpo emocional MEGA",
  punto_salto_linea: "Saltos de línea (\\n\\n)",
  longitud_apropiada: "Longitud apropiada",
  sin_jerga_consultor: "Sin jerga de consultor",
  status_frame_alto: "Status frame alto",
  sin_construcciones_lista_negra: "Sin construcciones prohibidas",
  tratamiento_singular_correcto: "Tratamiento singular",
  formato_firma_correcto: "Firma correcta",
};

function formatRel(min: number | null): string {
  if (min === null) return "—";
  if (min < 1) return "hace menos de 1 min";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return `hace ${h}h ${min % 60}m`;
}

const EDIT_REASONS = [
  "Halago disfrazado",
  "Jerga consultor",
  "Tono no encaja",
  "Estructura incorrecta",
  "Saludo incorrecto",
];

// ---------- skeleton ----------

function TriagePending() {
  return (
    <div className="flex h-[calc(100vh-7rem)] gap-4">
      <div className="w-[30%] space-y-2">
        <Skeleton className="h-9 w-full" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
      <div className="flex-1">
        <Skeleton className="h-full w-full" />
      </div>
    </div>
  );
}

// ---------- page ----------

function TriagePage() {
  const { cases, realtime } = Route.useLoaderData();
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(
    cases[0]?.id ?? null
  );
  const [pending, setPending] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmRejectOpen, setConfirmRejectOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkApproveOpen, setBulkApproveOpen] = useState(false);
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);

  const approveFn = useServerFn(approveCase);
  const rejectFn = useServerFn(rejectCase);
  const deepFn = useServerFn(deepReviewCase);
  const editFn = useServerFn(editCase);

  // Mantener selección válida cuando la lista cambia
  useEffect(() => {
    if (cases.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!cases.find((c: TriageCase) => c.id === selectedId)) {
      setSelectedId(cases[0].id);
    }
  }, [cases, selectedId]);

  // Realtime: escuchar cambios y refrescar el loader
  useEffect(() => {
    if (!realtime) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      const { createClient } = await import("@supabase/supabase-js");
      if (cancelled) return;
      const client = createClient(realtime.url, realtime.anonKey, {
        auth: { persistSession: false },
      });
      const channel = client
        .channel("triage-pipeline")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "cl001_p007_turn1_pipeline",
          },
          () => router.invalidate()
        )
        .subscribe();

      cleanup = () => {
        client.removeChannel(channel);
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [realtime, router]);

  // Polling de respaldo cada 10s
  useEffect(() => {
    const id = setInterval(() => {
      router.invalidate();
    }, 10000);
    return () => clearInterval(id);
  }, [router]);

  const selectedIndex = useMemo(
    () => cases.findIndex((c: TriageCase) => c.id === selectedId),
    [cases, selectedId]
  );
  const selected = selectedIndex >= 0 ? cases[selectedIndex] : null;

  function advanceAfter(currentId: string) {
    const idx = cases.findIndex((c: TriageCase) => c.id === currentId);
    const next =
      cases[idx + 1] ?? cases.find((c: TriageCase) => c.id !== currentId) ?? null;
    setSelectedId(next?.id ?? null);
  }

  async function runAction(
    label: string,
    fn: () => Promise<unknown>,
    currentId: string
  ) {
    setPending(true);
    try {
      await fn();
      toast.success(label);
      advanceAfter(currentId);
      await router.invalidate();
    } catch (err) {
      console.error(err);
      toast.error(
        err instanceof Error ? err.message : "Error al ejecutar la acción"
      );
    } finally {
      setPending(false);
    }
  }

  function navigate(delta: number) {
    if (cases.length === 0) return;
    const idx = cases.findIndex((c: TriageCase) => c.id === selectedId);
    const next = (idx + delta + cases.length) % cases.length;
    setSelectedId(cases[next].id);
  }

  function toggleSelect(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function runBulk(
    label: string,
    ids: string[],
    fn: (id: string) => Promise<unknown>
  ) {
    setPending(true);
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      try {
        await fn(id);
        ok++;
      } catch (err) {
        console.error(err);
        fail++;
      }
    }
    if (ok > 0) toast.success(`${label}: ${ok} ok${fail ? ` · ${fail} fallidos` : ""}`);
    if (ok === 0 && fail > 0) toast.error(`${label}: todos fallaron (${fail})`);
    clearSelection();
    await router.invalidate();
    setPending(false);
  }

  // Atajos de teclado
  useEffect(() => {
    function isTyping(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target.isContentEditable
      );
    }
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;
      if (editOpen || confirmRejectOpen || bulkApproveOpen || bulkRejectOpen) return;

      const k = e.key.toLowerCase();
      if (k === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }
      if (k === "j") {
        e.preventDefault();
        navigate(1);
        return;
      }
      if (k === "k") {
        e.preventDefault();
        navigate(-1);
        return;
      }
      if (!selected || pending) return;
      if (k === "a") {
        e.preventDefault();
        runAction(
          "Caso aprobado",
          () =>
            approveFn({
              data: {
                id: selected.id,
                turn_1_generated: selected.turn_1_generated ?? "",
              },
            }),
          selected.id
        );
      } else if (k === "e") {
        e.preventDefault();
        setEditOpen(true);
      } else if (k === "r") {
        e.preventDefault();
        setConfirmRejectOpen(true);
      } else if (k === "d") {
        e.preventDefault();
        runAction(
          "Enviado a Revisión Profunda",
          () => deepFn({ data: { id: selected.id } }),
          selected.id
        );
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Triage Rápido</h1>
          <p className="text-sm text-muted-foreground">
            Todos los casos pendientes de revisión humana. Ordenados por más recientes.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <ConfidenceLegend cases={cases} />
          <button
            type="button"
            onClick={() => setShortcutsOpen(true)}
            className="rounded border px-2 py-1 text-xs hover:bg-accent"
            title="Atajos de teclado"
          >
            ? Atajos
          </button>
          <span>
            {cases.length} caso{cases.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-accent/40 px-4 py-2">
          <div className="text-sm font-medium">
            {selectedIds.size} caso{selectedIds.size === 1 ? "" : "s"} seleccionado
            {selectedIds.size === 1 ? "" : "s"}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={pending}
              onClick={() => setBulkApproveOpen(true)}
            >
              ✅ Aprobar todos
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={() => setBulkRejectOpen(true)}
            >
              🚫 Rechazar todos
            </Button>
            <Button size="sm" variant="ghost" onClick={clearSelection}>
              Deseleccionar
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-1 min-h-0 gap-4">
        {/* Sidebar lista */}
        <aside className="w-[30%] min-w-[260px] flex flex-col gap-2 overflow-y-auto pr-1">
          {cases.length === 0 ? (
            <EmptyQueue />
          ) : (
            cases.map((c: TriageCase) => (
              <CaseListItem
                key={c.id}
                case={c}
                active={c.id === selectedId}
                selected={selectedIds.has(c.id)}
                onToggleSelect={(checked) => toggleSelect(c.id, checked)}
                onClick={() => setSelectedId(c.id)}
              />
            ))
          )}
        </aside>

        {/* Panel detalle */}
        <section className="flex-1 min-w-0 overflow-hidden rounded-lg border bg-card flex flex-col">
          {selected ? (
            <>
              <div className="flex-1 overflow-y-auto">
                <CaseDetail
                  case={selected}
                  index={selectedIndex}
                  total={cases.length}
                />
              </div>
              <ActionsFooter
                disabled={pending}
                onApprove={() =>
                  runAction(
                    "Caso aprobado",
                    () =>
                      approveFn({
                        data: {
                          id: selected.id,
                          turn_1_generated: selected.turn_1_generated ?? "",
                        },
                      }),
                    selected.id
                  )
                }
                onEdit={() => setEditOpen(true)}
                onReject={() => setConfirmRejectOpen(true)}
                onDeepReview={() =>
                  runAction(
                    "Enviado a Revisión Profunda",
                    () => deepFn({ data: { id: selected.id } }),
                    selected.id
                  )
                }
              />
            </>
          ) : cases.length === 0 ? (
            <div className="flex h-full items-center justify-center p-12">
              <EmptyQueue large />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-12 text-sm text-muted-foreground">
              Selecciona un caso
            </div>
          )}
        </section>
      </div>

      {/* Modal confirm reject */}
      <AlertDialog open={confirmRejectOpen} onOpenChange={setConfirmRejectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Rechazar este caso?</AlertDialogTitle>
            <AlertDialogDescription>
              El caso quedará marcado como rechazado y no se enviará respuesta.
              Esta acción no se puede deshacer desde aquí.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!selected) return;
                runAction(
                  "Caso rechazado",
                  () => rejectFn({ data: { id: selected.id } }),
                  selected.id
                );
              }}
            >
              Sí, rechazar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal edit */}
      {selected && (
        <EditDialog
          key={selected.id}
          open={editOpen}
          onOpenChange={setEditOpen}
          caseItem={selected}
          disabled={pending}
          onSave={async ({ edited, reasons, otherReason }) => {
            await runAction(
              "Caso editado y enviado",
              () =>
                editFn({
                  data: {
                    id: selected.id,
                    original: selected.turn_1_generated ?? "",
                    edited,
                    reasons,
                    otherReason,
                  },
                }),
              selected.id
            );
            setEditOpen(false);
          }}
        />
      )}

      {/* Bulk approve */}
      <AlertDialog open={bulkApproveOpen} onOpenChange={setBulkApproveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Aprobar {selectedIds.size} casos sin revisarlos individualmente?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se marcarán como aprobados con el Turn 1 generado tal cual y pasarán
              al estado <code>ready_to_send</code>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => {
                const ids = Array.from(selectedIds);
                const map = new Map<string, TriageCase>(
                  cases.map((c: TriageCase) => [c.id, c])
                );
                runBulk("Aprobados", ids, (id) => {
                  const c = map.get(id);
                  return approveFn({
                    data: { id, turn_1_generated: c?.turn_1_generated ?? "" },
                  });
                });
              }}
            >
              Sí, aprobar todos
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk reject */}
      <AlertDialog open={bulkRejectOpen} onOpenChange={setBulkRejectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Rechazar {selectedIds.size} casos? Esta acción es destructiva.
            </AlertDialogTitle>
            <AlertDialogDescription>
              Todos los casos seleccionados quedarán marcados como rechazados y no
              se enviará respuesta. No se puede deshacer desde aquí.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const ids = Array.from(selectedIds);
                runBulk("Rechazados", ids, (id) =>
                  rejectFn({ data: { id } })
                );
              }}
            >
              Sí, rechazar todos
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Shortcuts overlay */}
      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Atajos de teclado</DialogTitle>
          </DialogHeader>
          <ul className="space-y-2 text-sm">
            <ShortcutRow keys="J" label="Siguiente caso" />
            <ShortcutRow keys="K" label="Caso anterior" />
            <ShortcutRow keys="A" label="Aprobar caso actual" />
            <ShortcutRow keys="E" label="Editar caso actual" />
            <ShortcutRow keys="R" label="Rechazar caso actual" />
            <ShortcutRow keys="D" label="Revisión profunda" />
            <ShortcutRow keys="?" label="Mostrar/ocultar esta ayuda" />
          </ul>
          <p className="text-xs text-muted-foreground">
            Los atajos se desactivan mientras escribes en un campo de texto.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ShortcutRow({ keys, label }: { keys: string; label: string }) {
  return (
    <li className="flex items-center justify-between">
      <span>{label}</span>
      <kbd className="rounded border bg-muted px-2 py-0.5 text-xs font-mono">
        {keys}
      </kbd>
    </li>
  );
}

// ---------- empty state ----------

function EmptyQueue({ large = false }: { large?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card text-center text-muted-foreground",
        large ? "p-12" : "p-6"
      )}
    >
      <div className={cn("font-semibold", large ? "text-2xl" : "text-base")}>
        🎉 Cola vacía
      </div>
      <p className="mt-2 text-sm">No hay casos pendientes ahora mismo.</p>
    </div>
  );
}

// ---------- list item ----------

function CaseListItem({
  case: c,
  active,
  selected,
  onToggleSelect,
  onClick,
}: {
  case: TriageCase;
  active: boolean;
  selected: boolean;
  onToggleSelect: (checked: boolean) => void;
  onClick: () => void;
}) {
  const min = minutesSince(c.reply_timestamp);
  const conf = confidenceLevel(c);
  return (
    <div
      className={cn(
        "flex gap-2 w-full rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/50 cursor-pointer",
        conf.borderClasses,
        active && "border-primary bg-accent"
      )}
      onClick={onClick}
    >
      <div
        className="flex items-start pt-0.5"
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox
          checked={selected}
          onCheckedChange={(v) => onToggleSelect(v === true)}
          aria-label="Seleccionar caso"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              {c.lead_name || c.lead_email || c.smartlead_lead_id || c.id}
            </div>
            {c.lead_email && (
              <div className="truncate text-xs text-muted-foreground">
                {c.lead_email}
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {typeof c.score === "number" && (
              <span className={cn("text-xs font-semibold", scoreColor(c.score))}>
                {c.score}
              </span>
            )}
            <div className="flex items-center gap-1">
              <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", turnTypeMeta(c).classes)}>
                {turnTypeMeta(c).label}
              </span>
              {c.patron && (
                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                  {c.patron}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", conf.pillClasses)}>
            {conf.short}
          </span>
          <span className={cn("text-xs", slaColor(min))}>{formatRel(min)}</span>
        </div>
      </div>
    </div>
  );
}

function ConfidenceLegend({ cases }: { cases: TriageCase[] }) {
  const counts = { high: 0, medium: 0, low: 0 };
  for (const c of cases) {
    counts[confidenceLevel(c).level] += 1;
  }
  return (
    <div className="hidden md:flex items-center gap-2 text-[11px]">
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        <span>{counts.high} alta</span>
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-2 rounded-full bg-amber-500" />
        <span>{counts.medium} media</span>
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-2 rounded-full bg-red-500" />
        <span>{counts.low} baja</span>
      </span>
    </div>
  );
}

// ---------- detail ----------

function CaseDetail({
  case: c,
  index,
  total,
}: {
  case: TriageCase;
  index: number;
  total: number;
}) {
  const min = minutesSince(c.reply_timestamp);
  const cls = c.classification_output ?? {};
  const val = c.validation_output ?? {};
  const checksPasados =
    typeof val.checks_pasados === "number" ? val.checks_pasados : null;
  const checksFallidos =
    typeof val.checks_fallidos === "number"
      ? val.checks_fallidos
      : checksPasados !== null
      ? Math.max(0, 12 - checksPasados)
      : null;

  const conf = confidenceLevel(c);
  const checks = (val.checks ?? null) as Record<string, boolean> | null;
  const comentariosValidador = typeof val.comentarios_adicionales === "string" ? val.comentarios_adicionales : null;

  return (
    <div className="flex flex-col">
      <div className="border-b p-6">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-muted-foreground">
            {index + 1}/{total}
          </div>
          <div className="flex items-center gap-2">
            <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", conf.pillClasses)}>
              {conf.label}
            </span>
            <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", turnTypeMeta(c).classes)}>
              {turnTypeMeta(c).label}
            </span>
            {c.patron && <Badge variant="outline">Patrón {c.patron}</Badge>}
          </div>
        </div>
        <div className="mt-2 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-semibold">
              {c.lead_name || c.lead_email || c.smartlead_lead_id || c.id}
            </h2>
            {c.lead_email && (
              <p className="truncate text-xs text-muted-foreground">
                {c.lead_email}
              </p>
            )}
          </div>
          <div className={cn("text-sm font-medium", slaColor(min))}>
            En cola: {min === null ? "—" : `${min} min`}
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{conf.hint}</p>
      </div>

      <div className="space-y-6 p-6">
        <Section title="Reply original">
          {c.reply_original ? (
            <blockquote className="border-l-4 border-muted-foreground/30 pl-4 text-sm italic text-foreground whitespace-pre-wrap">
              {c.reply_original}
            </blockquote>
          ) : (
            <Empty />
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Respondió {formatRel(min)}
          </p>
        </Section>

        <Section title="Clasificación IA">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Field label="Patrón" value={cls.patron ?? c.patron ?? "—"} />
            <Field label="Tono" value={cls.tono_lead ?? "—"} />
            {typeof cls.es_lead_valido === "boolean" && (
              <Field
                label="Lead válido"
                value={cls.es_lead_valido ? "Sí" : "No"}
              />
            )}
            {cls.canal_pedido && (
              <Field label="Canal pedido" value={cls.canal_pedido} />
            )}
          </dl>
          {typeof cls.notas === "string" && cls.notas && (
            <p className="mt-3 text-sm text-muted-foreground">{cls.notas}</p>
          )}
        </Section>

        <Section title="Turn 1 Generado">
          {c.turn_1_generated ? (
            <pre className="whitespace-pre-wrap rounded-md bg-muted p-4 font-mono text-sm leading-relaxed text-foreground">
              {c.turn_1_generated}
            </pre>
          ) : (
            <Empty />
          )}
        </Section>

        <Section title="Validación IA">
          <div className="flex items-baseline gap-3">
            <span className={cn("text-4xl font-bold", scoreColor(c.score))}>
              {typeof c.score === "number" ? c.score : "—"}
            </span>
            <span className="text-sm text-muted-foreground">/ 100</span>
            {c.validado === true && (
              <Badge variant="secondary" className="ml-2">
                Validado
              </Badge>
            )}
          </div>

          {(checksPasados !== null || checksFallidos !== null) && (
            <div className="mt-3 flex gap-4 text-sm">
              <span>
                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                  {checksPasados ?? "—"}
                </span>
                <span className="text-muted-foreground"> pasados</span>
              </span>
              <span>
                <span className="font-medium text-red-600 dark:text-red-400">
                  {checksFallidos ?? "—"}
                </span>
                <span className="text-muted-foreground"> fallidos</span>
              </span>
              <span className="text-muted-foreground">de 12</span>
            </div>
          )}

          {c.errores_criticos && c.errores_criticos.length > 0 && (
            <div className="mt-4">
              <h4 className="mb-1 text-xs font-semibold uppercase text-red-600 dark:text-red-400">
                Errores críticos
              </h4>
              <ul className="list-disc space-y-1 pl-5 text-sm text-red-600 dark:text-red-400">
                {c.errores_criticos.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          {c.razones_fallo && c.razones_fallo.length > 0 && (
            <div className="mt-4">
              <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                Razones de fallo
              </h4>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {c.razones_fallo.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {checks && Object.keys(checks).length > 0 && (
            <div className="mt-4">
              <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                Detalle de los 12 checks
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                {Object.entries(CHECK_LABELS).map(([key, label]) => {
                  const passed = checks[key];
                  const known = passed !== undefined;
                  return (
                    <div
                      key={key}
                      className={cn(
                        "flex items-center gap-2 text-xs",
                        !known && "text-muted-foreground",
                        known && passed && "text-emerald-700 dark:text-emerald-400",
                        known && !passed && "text-red-700 dark:text-red-400"
                      )}
                    >
                      <span
                        className={cn(
                          "inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold leading-none",
                          known && passed && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40",
                          known && !passed && "bg-red-100 text-red-700 dark:bg-red-900/40",
                          !known && "bg-muted text-muted-foreground"
                        )}
                      >
                        {known ? (passed ? "✓" : "✗") : "?"}
                      </span>
                      <span>{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {comentariosValidador && (
            <div className="mt-4 rounded-md bg-muted/40 p-3">
              <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                Comentarios del Validador
              </h4>
              <p className="text-sm text-foreground whitespace-pre-wrap">
                {comentariosValidador}
              </p>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

// ---------- actions footer ----------

function ActionsFooter({
  disabled,
  onApprove,
  onEdit,
  onReject,
  onDeepReview,
}: {
  disabled: boolean;
  onApprove: () => void;
  onEdit: () => void;
  onReject: () => void;
  onDeepReview: () => void;
}) {
  return (
    <div className="border-t bg-muted/30">
      <div className="grid grid-cols-4 gap-2 p-4">
        <Button
          size="lg"
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
          onClick={onApprove}
          disabled={disabled}
        >
          ✅ Aprobar
        </Button>
        <Button size="lg" variant="secondary" onClick={onEdit} disabled={disabled}>
          ✏️ Editar
        </Button>
        <Button
          size="lg"
          variant="destructive"
          onClick={onReject}
          disabled={disabled}
        >
          🚫 Rechazar
        </Button>
        <Button size="lg" variant="outline" onClick={onDeepReview} disabled={disabled}>
          🔍 Revisión Profunda
        </Button>
      </div>
      <div className="border-t px-4 py-2 text-xs text-muted-foreground">
        Atajos: <kbd className="rounded border bg-background px-1">J/K</kbd> navegar ·{" "}
        <kbd className="rounded border bg-background px-1">A</kbd> aprobar ·{" "}
        <kbd className="rounded border bg-background px-1">E</kbd> editar ·{" "}
        <kbd className="rounded border bg-background px-1">R</kbd> rechazar ·{" "}
        <kbd className="rounded border bg-background px-1">D</kbd> profunda ·{" "}
        <kbd className="rounded border bg-background px-1">?</kbd> ayuda
      </div>
    </div>
  );
}

// ---------- edit dialog ----------

function EditDialog({
  open,
  onOpenChange,
  caseItem,
  disabled,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  caseItem: TriageCase;
  disabled: boolean;
  onSave: (data: {
    edited: string;
    reasons: string[];
    otherReason?: string;
  }) => Promise<void> | void;
}) {
  const [text, setText] = useState(caseItem.turn_1_generated ?? "");
  const [reasons, setReasons] = useState<string[]>([]);
  const [otherChecked, setOtherChecked] = useState(false);
  const [otherText, setOtherText] = useState("");

  useEffect(() => {
    if (open) {
      setText(caseItem.turn_1_generated ?? "");
      setReasons([]);
      setOtherChecked(false);
      setOtherText("");
    }
  }, [open, caseItem]);

  const lines = text.split("\n").length;
  const chars = text.length;

  function toggle(reason: string, checked: boolean) {
    setReasons((prev) =>
      checked ? [...prev, reason] : prev.filter((r) => r !== reason)
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Editar Turn 1 — {caseItem.lead_name || caseItem.lead_email || caseItem.id}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={12}
              className="font-mono text-sm"
            />
            <div className="mt-1 flex justify-end gap-3 text-xs text-muted-foreground">
              <span>{chars} caracteres</span>
              <span>{lines} líneas</span>
            </div>
          </div>

          <div>
            <h4 className="mb-2 text-sm font-medium">Razones de edición</h4>
            <div className="grid grid-cols-2 gap-2">
              {EDIT_REASONS.map((r) => (
                <label
                  key={r}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <Checkbox
                    checked={reasons.includes(r)}
                    onCheckedChange={(v) => toggle(r, v === true)}
                  />
                  {r}
                </label>
              ))}
              <label className="col-span-2 flex items-center gap-2 text-sm">
                <Checkbox
                  checked={otherChecked}
                  onCheckedChange={(v) => setOtherChecked(v === true)}
                />
                <span className="shrink-0">Otro:</span>
                <Input
                  value={otherText}
                  onChange={(e) => setOtherText(e.target.value)}
                  disabled={!otherChecked}
                  placeholder="Especifica…"
                  className="h-8"
                />
              </label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={disabled || text.trim().length === 0}
            onClick={() =>
              onSave({
                edited: text,
                reasons,
                otherReason: otherChecked ? otherText.trim() || undefined : undefined,
              })
            }
          >
            Guardar y enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- shared ----------

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function Empty() {
  return <p className="text-sm italic text-muted-foreground">Sin contenido.</p>;
}

