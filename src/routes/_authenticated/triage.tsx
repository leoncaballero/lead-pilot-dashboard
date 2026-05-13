import { createFileRoute, ErrorComponent, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
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
  getCanaryMetrics,
  getRealtimeConfig,
  getTriageCases,
  regenerateCase,
  rejectCase,
  rescueCase,
  setHasKnownStore,
  undoSdrAction,
  type CanaryMetrics,
  type ClassificationOutput,
  type TriageCase,
} from "@/api/triage.functions";
import { ConversationThread } from "@/components/ConversationThread";
import { getHubSpotLastContactedBatch } from "@/api/hubspot.functions";
import { stripQuotedReply } from "@/api/smartlead.functions";
import { HubSpotLeadContextCard } from "@/components/HubSpotLeadContext";

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

/**
 * "IA habría aprobado y enviado solo": score >= 95 AND no errores críticos.
 * Ese es el umbral del routing original (antes de "humano siempre revisa").
 * Saberlo nos ayuda a preparar el momento en que apaguemos dry_run y dejemos
 * pasar los high-confidence sin revisión humana.
 */
function aiWouldAutoApprove(c: TriageCase): boolean {
  const score = typeof c.score === "number" ? c.score : 0;
  const criticos = c.errores_criticos?.length ?? 0;
  return score >= 95 && criticos === 0;
}

/**
 * Tier de confianza para scanning visual rápido en el triage:
 * - 'auto'   → score ≥ 95 sin críticos. Listo para auto-send si flag activo.
 * - 'margin' → score 85-94 sin críticos. Revisión rápida, sin alarmas.
 * - 'low'    → score < 85 sin críticos. Requiere atención.
 * - 'critical' → al menos 1 error crítico. Revisión profunda obligatoria.
 */
type AiTier = "auto" | "margin" | "low" | "critical";
function aiConfidenceTier(c: TriageCase): AiTier {
  const score = typeof c.score === "number" ? c.score : 0;
  const criticos = c.errores_criticos?.length ?? 0;
  if (criticos >= 1) return "critical";
  if (score >= 95) return "auto";
  if (score >= 85) return "margin";
  return "low";
}

/**
 * Severidad SLA escalada:
 *  - normal    : ≤ 1h. Estado saludable.
 *  - slow      : 1-4h. Aviso suave (borde tenue).
 *  - urgent    : 4-24h. Borde ámbar + chip URGENTE.
 *  - critical  : > 24h. Borde rojo + chip RIESGO.
 */
type SlaSev = "normal" | "slow" | "urgent" | "critical";
function slaSeverity(min: number | null): SlaSev {
  if (min === null) return "normal";
  if (min > 60 * 24) return "critical";
  if (min > 60 * 4) return "urgent";
  if (min > 60) return "slow";
  return "normal";
}

function slaBorderClass(sev: SlaSev): string {
  switch (sev) {
    case "critical":
      return "border-red-500 dark:border-red-700 border-2";
    case "urgent":
      return "border-amber-500 dark:border-amber-600 border-2";
    case "slow":
      return "border-amber-300/60 dark:border-amber-800/40";
    default:
      return "";
  }
}

/**
 * Detecta el bug en el que el Validador devuelve score alto pero el Generador
 * no produjo turn_1_generated (output vacio o falló parsing). Probable causa:
 * Generador devolvió JSON malformado y safeParseJson cayó al fallback {}.
 */
function hasMissingTurn1Bug(c: TriageCase): boolean {
  const score = typeof c.score === "number" ? c.score : 0;
  const hasContent = !!(c.turn_1_generated && c.turn_1_generated.trim().length > 0);
  return !hasContent && score >= 50;
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

function formatUpcomingMeeting(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = Date.now();
  const diffMs = d.getTime() - now;
  const diffHours = diffMs / 36e5;
  // <24h: "hoy 18:30" / "mañana 10:00"; <7d: "jue 10:30"; resto: "14 mar"
  const time = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  if (diffHours < 24) {
    const isTomorrow = d.getDate() !== new Date().getDate();
    return isTomorrow ? `mañana ${time}` : `hoy ${time}`;
  }
  if (diffHours < 24 * 7) {
    return `${d.toLocaleDateString("es-ES", { weekday: "short" })} ${time}`;
  }
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}

const EDIT_REASONS = [
  "Halago disfrazado",
  "Jerga consultor",
  "Tono no encaja",
  "Estructura incorrecta",
  "Saludo incorrecto",
];

const REJECT_REASONS = [
  "Lead no es MEGA real (tiene tienda activa)",
  "Reply OOO / autoreply / no es interés real",
  "Lead hostil / pide unsubscribe",
  "Idioma o contexto incorrecto",
  "Reply ambiguo, prefiero no responder",
  "Mejor llamada directa por SDR",
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
  const { cases: allCases, realtime } = Route.useLoaderData();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmRejectOpen, setConfirmRejectOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkApproveOpen, setBulkApproveOpen] = useState(false);
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);

  // Filtros de la sidebar (clickables)
  const [turnTypeFilter, setTurnTypeFilter] = useState<string | null>(null);
  const [segmentoFilter, setSegmentoFilter] = useState<string | null>(null);
  const [confidenceFilter, setConfidenceFilter] = useState<
    "high" | "medium" | "low" | null
  >(null);
  // Filtro por antigüedad en cola (basado en reply_timestamp del caso)
  type DateFilterKey = "1h" | "4h" | "24h" | "3d" | "7d" | null;
  const [dateFilter, setDateFilter] = useState<DateFilterKey>(null);

  // Filtro por subgroup (MEGA bifurcado por has_known_store)
  type SubgroupFilterKey = "no_store" | "has_store" | "default_unknown" | null;
  const [subgroupFilter, setSubgroupFilter] = useState<SubgroupFilterKey>(null);

  // Filtro por outcome del lead (booked, won, lost, none)
  type OutcomeFilterKey = "none" | "booked" | "closed_won" | "closed_lost" | "attended" | "no_show" | null;
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilterKey>(null);

  // Filtro "sin contacto >Nd" basado en HubSpot notes_last_contacted.
  // Fetch lazy en background al montar — si falla, el filtro queda inerte.
  type StaleFilterKey = "7d" | "14d" | "30d" | "60d" | null;
  const [staleFilter, setStaleFilter] = useState<StaleFilterKey>(null);
  const [lastContactedMap, setLastContactedMap] = useState<Record<
    string,
    string | null
  > | null>(null);
  const hubspotBatchFn = useServerFn(getHubSpotLastContactedBatch);
  useEffect(() => {
    const ids = Array.from(
      new Set(
        (allCases as TriageCase[])
          .map((c) => c.hubspot_contact_id)
          .filter((x): x is string => !!x && x !== "null")
      )
    );
    if (ids.length === 0) {
      setLastContactedMap({});
      return;
    }
    let cancelled = false;
    hubspotBatchFn({ data: { contact_ids: ids } })
      .then((res) => {
        if (cancelled) return;
        const flat: Record<string, string | null> = {};
        for (const [id, v] of Object.entries(res.map)) {
          flat[id] = v.notes_last_contacted ?? v.notes_last_updated ?? null;
        }
        setLastContactedMap(flat);
      })
      .catch(() => {
        if (!cancelled) setLastContactedMap({});
      });
    return () => {
      cancelled = true;
    };
    // Solo correr cuando cambia el set de ids (no cuando cambia ref por polling)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(allCases as TriageCase[]).map((c) => c.hubspot_contact_id).filter(Boolean).join(",")]);

  const cases = useMemo(() => {
    const now = Date.now();
    const thresholds: Record<Exclude<DateFilterKey, null>, number> = {
      "1h": 1 * 60 * 60 * 1000,
      "4h": 4 * 60 * 60 * 1000,
      "24h": 24 * 60 * 60 * 1000,
      "3d": 3 * 24 * 60 * 60 * 1000,
      "7d": 7 * 24 * 60 * 60 * 1000,
    };
    const staleThresholds: Record<Exclude<StaleFilterKey, null>, number> = {
      "7d": 7 * 24 * 60 * 60 * 1000,
      "14d": 14 * 24 * 60 * 60 * 1000,
      "30d": 30 * 24 * 60 * 60 * 1000,
      "60d": 60 * 24 * 60 * 60 * 1000,
    };
    return (allCases as TriageCase[]).filter((c) => {
      if (turnTypeFilter && (c.turn_type ?? "turn1") !== turnTypeFilter)
        return false;
      if (segmentoFilter && c.segmento !== segmentoFilter) return false;
      if (confidenceFilter && confidenceLevel(c).level !== confidenceFilter)
        return false;
      if (subgroupFilter) {
        const hks = c.has_known_store;
        if (subgroupFilter === "no_store" && hks !== false) return false;
        if (subgroupFilter === "has_store" && hks !== true) return false;
        if (subgroupFilter === "default_unknown" && hks !== null && hks !== undefined) return false;
      }
      if (outcomeFilter) {
        const lo = c.lead_outcome ?? null;
        if (outcomeFilter === "none" && lo !== null) return false;
        if (outcomeFilter !== "none" && lo !== outcomeFilter) return false;
      }
      if (dateFilter) {
        const ts = c.reply_timestamp ? Date.parse(c.reply_timestamp) : NaN;
        if (Number.isNaN(ts)) return false;
        const age = now - ts;
        if (age < thresholds[dateFilter]) return false;
      }
      if (staleFilter && lastContactedMap) {
        const cid = c.hubspot_contact_id;
        if (!cid) return false;
        const lastIso = lastContactedMap[cid];
        // Si nunca se ha contactado, lo consideramos "stale" infinito → pasa el filtro
        if (lastIso === null || lastIso === undefined) return true;
        const ts = Date.parse(lastIso);
        if (Number.isNaN(ts)) return true;
        const since = now - ts;
        if (since < staleThresholds[staleFilter]) return false;
      }
      return true;
    });
  }, [
    allCases,
    turnTypeFilter,
    segmentoFilter,
    confidenceFilter,
    subgroupFilter,
    outcomeFilter,
    dateFilter,
    staleFilter,
    lastContactedMap,
  ]);

  const [selectedId, setSelectedId] = useState<string | null>(
    cases[0]?.id ?? null
  );

  const approveFn = useServerFn(approveCase);
  const rejectFn = useServerFn(rejectCase);
  const deepFn = useServerFn(deepReviewCase);
  const undoFn = useServerFn(undoSdrAction);
  const editFn = useServerFn(editCase);
  const regenFn = useServerFn(regenerateCase);
  const setStoreFn = useServerFn(setHasKnownStore);
  const rescueFn = useServerFn(rescueCase);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [settingStore, setSettingStore] = useState<string | null>(null);
  const [rescuing, setRescuing] = useState<string | null>(null);

  async function handleRescue(caseId: string) {
    setRescuing(caseId);
    try {
      const res = await rescueFn({ data: { id: caseId } });
      if (!res.ok) {
        alert(`Rescatar falló: ${res.error}`);
      } else {
        await router.invalidate();
      }
    } catch (e) {
      alert(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRescuing(null);
    }
  }

  async function handleRegenerate(caseId: string) {
    setRegenerating(caseId);
    try {
      const res = await regenFn({ data: { id: caseId } });
      if (!res.ok) {
        alert(`Regenerar falló: ${res.error}`);
      } else {
        await router.invalidate();
      }
    } catch (e) {
      alert(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRegenerating(null);
    }
  }

  async function handleSetStore(
    caseId: string,
    value: boolean | null,
    regenerateAfter: boolean
  ) {
    setSettingStore(caseId);
    try {
      const res = await setStoreFn({ data: { id: caseId, has_known_store: value } });
      if (!res.ok) {
        alert(`Cambiar tienda falló: ${res.error ?? "error desconocido"}`);
        return;
      }
      if (regenerateAfter) {
        const r = await regenFn({ data: { id: caseId } });
        if (!r.ok) {
          alert(`Tienda cambiada, pero regenerar falló: ${r.error}`);
        }
      }
      await router.invalidate();
    } catch (e) {
      alert(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSettingStore(null);
    }
  }

  // Mantener selección válida cuando la lista cambia (por filtro o realtime)
  useEffect(() => {
    if (cases.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!cases.find((c: TriageCase) => c.id === selectedId)) {
      setSelectedId(cases[0].id);
    }
  }, [cases, selectedId]);

  function clearFilters() {
    setTurnTypeFilter(null);
    setSegmentoFilter(null);
    setConfidenceFilter(null);
    setDateFilter(null);
    setStaleFilter(null);
    setSubgroupFilter(null);
    setOutcomeFilter(null);
  }
  const anyFilterActive =
    turnTypeFilter !== null ||
    segmentoFilter !== null ||
    confidenceFilter !== null ||
    subgroupFilter !== null ||
    outcomeFilter !== null ||
    dateFilter !== null ||
    staleFilter !== null;

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

  // Polling de respaldo cada 10s. Se pausa cuando un dialog está abierto
  // (editando / rechazando / etc.) para no interrumpir lo que está escribiendo
  // el SDR.
  const blockedByDialog = editOpen || confirmRejectOpen || bulkApproveOpen || bulkRejectOpen;
  useEffect(() => {
    if (blockedByDialog) return;
    const id = setInterval(() => {
      router.invalidate();
    }, 10000);
    return () => clearInterval(id);
  }, [router, blockedByDialog]);

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
    currentId: string,
    options?: { undoable?: boolean }
  ) {
    setPending(true);
    try {
      await fn();
      if (options?.undoable) {
        // Toast con botón "Deshacer" — solo para acciones que no disparan envío real
        // (reject, deep review). Aprobar y editar disparan Smartlead inmediatamente.
        toast.success(label, {
          action: {
            label: "Deshacer",
            onClick: async () => {
              try {
                await undoFn({ data: { id: currentId } });
                toast.message("Acción deshecha — caso devuelto a pending_review");
                await router.invalidate();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Error al deshacer");
              }
            },
          },
          duration: 8000,
        });
      } else {
        toast.success(label);
      }
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
      // Cmd/Ctrl+Shift+A — bulk select todos los IA-auto + abrir confirm
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "a") {
        if (editOpen || confirmRejectOpen || bulkApproveOpen || bulkRejectOpen) return;
        e.preventDefault();
        const aiCases = (cases as TriageCase[]).filter(
          (c) => aiWouldAutoApprove(c) && !hasMissingTurn1Bug(c)
        );
        if (aiCases.length === 0) {
          toast.message("No hay casos AI-auto disponibles");
          return;
        }
        setSelectedIds(new Set(aiCases.map((c) => c.id)));
        setBulkApproveOpen(true);
        return;
      }
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
          <SlaIndicator cases={cases as TriageCase[]} />
          <ConfidenceLegend
            cases={allCases as TriageCase[]}
            activeFilter={confidenceFilter}
            onFilterChange={setConfidenceFilter}
          />
          <button
            type="button"
            onClick={() => setShortcutsOpen(true)}
            className="rounded border px-2 py-1 text-xs hover:bg-accent"
            title="Atajos de teclado"
          >
            ? Atajos
          </button>
          <span>
            {anyFilterActive
              ? `${cases.length} de ${(allCases as TriageCase[]).length}`
              : `${cases.length} caso${cases.length === 1 ? "" : "s"}`}
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

      {selectedIds.size === 0 && (() => {
        const aiAutoCases = (cases as TriageCase[]).filter(
          (c) => aiWouldAutoApprove(c) && !hasMissingTurn1Bug(c)
        );
        if (aiAutoCases.length === 0) return null;
        return (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-2 dark:border-emerald-900/40 dark:bg-emerald-950/20">
            <div className="text-sm">
              <span className="font-medium text-emerald-700 dark:text-emerald-300">
                {aiAutoCases.length} caso{aiAutoCases.length === 1 ? "" : "s"}
              </span>{" "}
              <span className="text-muted-foreground">
                {aiAutoCases.length === 1
                  ? "que la IA habría aprobado y enviado sin revisión"
                  : "que la IA habría aprobado y enviado sin revisión"}
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="border-emerald-300 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/40 dark:text-emerald-300"
              onClick={() => {
                setSelectedIds(new Set(aiAutoCases.map((c) => c.id)));
              }}
            >
              Seleccionar los {aiAutoCases.length} para revisión rápida
            </Button>
          </div>
        );
      })()}

      <div className="flex flex-1 min-h-0 gap-4">
        {/* Sidebar lista */}
        <aside className="w-[30%] min-w-[260px] flex flex-col gap-2 overflow-hidden pr-1">
          <SegmentTabs
            cases={allCases as TriageCase[]}
            segmentoFilter={segmentoFilter}
            onChange={setSegmentoFilter}
          />
          <StageTabs
            cases={(allCases as TriageCase[]).filter(
              (c) => !segmentoFilter || c.segmento === segmentoFilter
            )}
            turnTypeFilter={turnTypeFilter}
            onChange={setTurnTypeFilter}
          />
          <FilterBar
            cases={allCases as TriageCase[]}
            turnTypeFilter={turnTypeFilter}
            subgroupFilter={subgroupFilter}
            outcomeFilter={outcomeFilter}
            dateFilter={dateFilter}
            staleFilter={staleFilter}
            lastContactedMap={lastContactedMap}
            onTurnTypeChange={setTurnTypeFilter}
            onSubgroupChange={setSubgroupFilter}
            onOutcomeChange={setOutcomeFilter}
            onDateChange={setDateFilter}
            onStaleChange={setStaleFilter}
            anyFilterActive={anyFilterActive}
            onClearFilters={clearFilters}
          />
          {/* Canary widget when filtering MEGA + no_store */}
          {segmentoFilter === "MEGA" && subgroupFilter === "no_store" && (
            <CanaryWidget segmento="MEGA" subgroup="no_store" />
          )}
          <div className="flex flex-col gap-2 overflow-y-auto pr-1 flex-1">
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
          </div>
        </aside>

        {/* Panel detalle */}
        <section className="flex-1 min-w-0 overflow-hidden rounded-lg border bg-card flex flex-col">
          {selected ? (
            <>
              <div className="flex-1 min-h-0">
                <CaseDetail
                  case={selected}
                  index={selectedIndex}
                  total={cases.length}
                  onRegenerate={() => handleRegenerate(selected.id)}
                  regenerating={regenerating === selected.id}
                  onSetStore={(value, regenerateAfter) =>
                    handleSetStore(selected.id, value, regenerateAfter)
                  }
                  settingStore={settingStore === selected.id}
                  onRescue={() => handleRescue(selected.id)}
                  rescuing={rescuing === selected.id}
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
                    selected.id,
                    { undoable: true }
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
      {selected && (
        <RejectDialog
          key={`reject-${selected.id}`}
          open={confirmRejectOpen}
          onOpenChange={setConfirmRejectOpen}
          caseItem={selected}
          disabled={pending}
          onConfirm={async ({ reasons, otherReason }) => {
            await runAction(
              "Caso rechazado",
              () => rejectFn({ data: { id: selected.id, reasons, otherReason } }),
              selected.id,
              { undoable: true }
            );
            setConfirmRejectOpen(false);
          }}
        />
      )}

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
            <ShortcutRow keys="⌘⇧A" label="Aprobar TODOS los AI-auto en bloque" />
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
  const tier = aiConfidenceTier(c);
  const sla = slaSeverity(min);
  const missingTurn1 = hasMissingTurn1Bug(c);
  const isAutoRejected = c.status === "auto_rejected";
  return (
    <div
      className={cn(
        "flex gap-2 w-full rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/50 cursor-pointer",
        conf.borderClasses,
        // SLA prima sobre confidence cuando es urgent/critical (más importante actuar rápido)
        slaBorderClass(sla),
        active && "border-primary bg-accent",
        // Auto-rejected: borde naranja distintivo + ligeramente opacado
        isAutoRejected && "border-orange-300 bg-orange-50/30 opacity-90 dark:border-orange-900/60 dark:bg-orange-950/20"
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
            <div className="flex items-center gap-1.5 flex-wrap">
              {isAutoRejected && (
                <span
                  className="inline-flex items-center gap-0.5 rounded-sm bg-orange-500 px-1 py-0 text-[9px] font-bold uppercase leading-none text-white"
                  title="Caso auto-rechazado por el sistema — rescátalo si el lead es válido"
                >
                  ⚠ AUTO-RECHAZADO
                </span>
              )}
              {!isAutoRejected && tier === "auto" && !missingTurn1 && (
                <span
                  className="inline-flex items-center gap-0.5 rounded-sm bg-emerald-100 px-1 py-0 text-[9px] font-bold uppercase leading-none text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                  title="🟢 AUTO — score ≥95 sin críticos. Cumple criterio auto-send."
                >
                  🟢 AUTO
                </span>
              )}
              {tier === "margin" && !missingTurn1 && (
                <span
                  className="inline-flex items-center gap-0.5 rounded-sm bg-amber-100 px-1 py-0 text-[9px] font-bold uppercase leading-none text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                  title="🟡 MARGIN — score 85-94. Validación pasa pero merece vistazo rápido."
                >
                  🟡 MARGIN
                </span>
              )}
              {sla === "urgent" && (
                <span
                  className="inline-flex items-center gap-0.5 rounded-sm bg-amber-500 px-1.5 py-0 text-[9px] font-bold uppercase leading-none text-white"
                  title="Caso lleva más de 4h en cola — atender pronto"
                >
                  ⚠ URGENTE
                </span>
              )}
              {sla === "critical" && (
                <span
                  className="inline-flex items-center gap-0.5 rounded-sm bg-red-600 px-1.5 py-0 text-[9px] font-bold uppercase leading-none text-white"
                  title="Caso lleva más de 24h en cola — RIESGO de perder al lead"
                >
                  🔥 RIESGO
                </span>
              )}
              {c.has_known_store === false && (
                <span
                  className="inline-flex items-center justify-center rounded-sm bg-blue-100 px-1 py-0 text-[9px] font-bold uppercase leading-none text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                  title="Detección: SIN tienda online (subgroup=no_store)"
                >
                  TIENDA NO
                </span>
              )}
              {c.has_known_store === true && (
                <span
                  className="inline-flex items-center justify-center rounded-sm bg-violet-100 px-1 py-0 text-[9px] font-bold uppercase leading-none text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                  title="Detección: CON tienda online (subgroup=has_store)"
                >
                  TIENDA SÍ
                </span>
              )}
              {c.upcoming_meeting && (
                <span
                  className="inline-flex items-center justify-center rounded-sm bg-red-600 px-1.5 py-0 text-[10px] font-bold uppercase leading-none text-white shadow-sm"
                  title={`Ya tiene reunión agendada${
                    c.upcoming_meeting.title ? ` — ${c.upcoming_meeting.title}` : ""
                  } el ${formatUpcomingMeeting(c.upcoming_meeting.start_time)}${
                    c.upcoming_meeting.outcome_type === "booked_other"
                      ? ". Fuente: canal externo, no atribuible al outbound."
                      : ". Fuente: atribuible al outbound."
                  } NO responder al lead.`}
                >
                  🗓 RX {formatUpcomingMeeting(c.upcoming_meeting.start_time)} · NO RESPONDER
                </span>
              )}
              {c.lead_outcome === "booked" && !c.upcoming_meeting && (
                <span
                  className="inline-flex items-center justify-center rounded-sm bg-amber-200 px-1 py-0 text-[9px] font-bold uppercase leading-none text-amber-900 dark:bg-amber-900/60 dark:text-amber-200"
                  title="Lead reservó reunión en algún momento — sin meeting futura agendada actualmente"
                >
                  🗓 BOOKED
                </span>
              )}
              {c.lead_outcome === "attended" && (
                <span
                  className="inline-flex items-center justify-center rounded-sm bg-emerald-200 px-1 py-0 text-[9px] font-bold uppercase leading-none text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-200"
                  title="Lead asistió a la reunión"
                >
                  ✓ ASIST
                </span>
              )}
              {c.lead_outcome === "closed_won" && (
                <span
                  className="inline-flex items-center justify-center rounded-sm bg-emerald-600 px-1 py-0 text-[9px] font-bold uppercase leading-none text-white"
                  title="Cliente cerrado WON"
                >
                  🏆 WON
                </span>
              )}
              {c.lead_outcome === "closed_lost" && (
                <span
                  className="inline-flex items-center justify-center rounded-sm bg-red-200 px-1 py-0 text-[9px] font-bold uppercase leading-none text-red-900 dark:bg-red-900/60 dark:text-red-200"
                  title="Cerrado LOST"
                >
                  ❌ LOST
                </span>
              )}
              {c.lead_outcome === "no_show" && (
                <span
                  className="inline-flex items-center justify-center rounded-sm bg-orange-200 px-1 py-0 text-[9px] font-bold uppercase leading-none text-orange-900 dark:bg-orange-900/60 dark:text-orange-200"
                  title="No-show a la reunión agendada"
                >
                  ✗ NO-SHOW
                </span>
              )}
              {missingTurn1 && (
                <span
                  className="inline-flex items-center justify-center rounded-sm bg-amber-100 px-1 py-0 text-[9px] font-bold uppercase leading-none text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
                  title="Score alto pero sin Turn 1 generado — bug del Generador/Validador"
                >
                  ⚠
                </span>
              )}
              <div className="truncate text-sm font-medium">
                {c.lead_name || c.lead_email || c.smartlead_lead_id || c.id}
              </div>
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
        {c.reply_original && (
          <div className="mt-1.5 text-[11px] text-muted-foreground line-clamp-2 leading-snug italic">
            <span className="not-italic opacity-60">↩ </span>
            {previewText(stripQuotedReply(c.reply_original), 140)}
          </div>
        )}
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

function previewText(s: string, max: number): string {
  // Saltos de línea -> espacios, colapsa whitespace, recorta
  const cleaned = s.replace(/\s+/g, " ").trim();
  return cleaned.length <= max ? cleaned : cleaned.slice(0, max - 1) + "…";
}

function SlaIndicator({ cases }: { cases: TriageCase[] }) {
  // Cuenta de cases con SLA atrasado (>15 min en cola = amber, >25 min = red)
  let amber = 0;
  let red = 0;
  for (const c of cases) {
    const min = minutesSince(c.reply_timestamp);
    if (min === null) continue;
    if (min > 25) red += 1;
    else if (min > 15) amber += 1;
  }
  if (red === 0 && amber === 0) {
    return (
      <span
        className="hidden md:inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400"
        title="Todos los casos dentro del SLA (≤15 min)"
      >
        ⏱ SLA OK
      </span>
    );
  }
  return (
    <span className="hidden md:inline-flex items-center gap-2 text-[11px]">
      {red > 0 && (
        <span
          className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 font-medium"
          title={`${red} caso${red === 1 ? "" : "s"} con >25 min en cola`}
        >
          ⏰ {red} críticos
        </span>
      )}
      {amber > 0 && (
        <span
          className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium"
          title={`${amber} caso${amber === 1 ? "" : "s"} con 15-25 min en cola`}
        >
          ⏱ {amber} a tiempo justo
        </span>
      )}
    </span>
  );
}

function ConfidenceLegend({
  cases,
  activeFilter,
  onFilterChange,
}: {
  cases: TriageCase[];
  activeFilter: "high" | "medium" | "low" | null;
  onFilterChange: (filter: "high" | "medium" | "low" | null) => void;
}) {
  const counts = { high: 0, medium: 0, low: 0 };
  for (const c of cases) {
    counts[confidenceLevel(c).level] += 1;
  }
  function toggle(level: "high" | "medium" | "low") {
    onFilterChange(activeFilter === level ? null : level);
  }
  const items: Array<{
    level: "high" | "medium" | "low";
    label: string;
    color: string;
  }> = [
    { level: "high", label: "alta", color: "bg-emerald-500" },
    { level: "medium", label: "media", color: "bg-amber-500" },
    { level: "low", label: "baja", color: "bg-red-500" },
  ];
  return (
    <div className="hidden md:flex items-center gap-1 text-[11px]">
      {items.map(({ level, label, color }) => {
        const active = activeFilter === level;
        return (
          <button
            key={level}
            type="button"
            onClick={() => toggle(level)}
            className={cn(
              "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 transition-colors",
              active
                ? "border-foreground bg-accent text-foreground"
                : "border-transparent hover:bg-accent"
            )}
            title={`Filtrar por confianza ${label}`}
          >
            <span className={cn("h-2 w-2 rounded-full", color)} />
            <span>
              {counts[level]} {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------- filter bar (sidebar) ----------

function SegmentTabs({
  cases,
  segmentoFilter,
  onChange,
}: {
  cases: TriageCase[];
  segmentoFilter: string | null;
  onChange: (v: string | null) => void;
}) {
  // Counts en vivo por segmento sobre el dataset completo (no filtrado)
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cases) {
      const s = c.segmento ?? "(sin)";
      m.set(s, (m.get(s) ?? 0) + 1);
    }
    return m;
  }, [cases]);

  const total = cases.length;
  // Mostrar solo segmentos con casos. Orden: MEGA primero, luego alfabético
  const segments = Array.from(counts.entries())
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => {
      if (a === "MEGA") return -1;
      if (b === "MEGA") return 1;
      return a.localeCompare(b);
    });

  if (segments.length <= 1 && total === 0) return null;

  return (
    <div className="rounded-lg border bg-card p-1.5 flex items-center gap-1.5 overflow-x-auto">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={cn(
          "rounded-md px-3 py-2 text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap",
          segmentoFilter === null
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
        )}
      >
        <span>Todos</span>
        <span
          className={cn(
            "rounded-full px-1.5 text-[10px] tabular-nums",
            segmentoFilter === null
              ? "bg-primary-foreground/20 text-primary-foreground"
              : "bg-muted text-muted-foreground"
          )}
        >
          {total}
        </span>
      </button>
      <span className="text-muted-foreground text-xs">│</span>
      {segments.map(([seg, n]) => {
        const active = segmentoFilter === seg;
        return (
          <button
            key={seg}
            type="button"
            onClick={() => onChange(active ? null : seg)}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <span>{seg}</span>
            <span
              className={cn(
                "rounded-full px-1.5 text-[10px] tabular-nums",
                active
                  ? "bg-primary-foreground/20 text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {n}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function StageTabs({
  cases,
  turnTypeFilter,
  onChange,
}: {
  cases: TriageCase[];
  turnTypeFilter: string | null;
  onChange: (v: string | null) => void;
}) {
  // Agrupa los turn_types en 3 buckets para que la barra sea legible:
  // Turn 1, Turn 2, Otros (FU + booking_propose + objection_response + turn 3+)
  const counts = useMemo(() => {
    const m = { turn1: 0, turn2: 0, otros: 0 };
    for (const c of cases) {
      const t = c.turn_type ?? "turn1";
      if (t === "turn1") m.turn1++;
      else if (t === "turn2_generic" || t === "turn2") m.turn2++;
      else m.otros++;
    }
    return m;
  }, [cases]);

  const total = counts.turn1 + counts.turn2 + counts.otros;
  if (total === 0) return null;

  const TABS: Array<{ key: string | null; label: string; count: number; predicate?: (t: string) => boolean }> = [
    { key: null, label: "Todos", count: total },
    { key: "turn1", label: "Turn 1 (1ª respuesta)", count: counts.turn1 },
    { key: "turn2_generic", label: "Turn 2 (2ª respuesta)", count: counts.turn2 },
  ];
  // Botón Otros — comportamiento especial: si activamos "otros", limpiamos turn1/turn2 y NO setteamos turnTypeFilter (sería un superset)
  // pero como turnTypeFilter es un valor único, lo encapsulamos en un pseudo-key 'otros'
  // Para no complicar, omitimos "Otros" por ahora; el usuario puede usar el chip filter más fino abajo si lo necesita
  const isOtros = !!turnTypeFilter && turnTypeFilter !== "turn1" && turnTypeFilter !== "turn2_generic" && turnTypeFilter !== "turn2";

  return (
    <div className="rounded-lg border bg-card p-1 flex items-center gap-1 overflow-x-auto">
      {TABS.map((t) => {
        const active = t.key === turnTypeFilter || (t.key === null && turnTypeFilter === null && !isOtros);
        return (
          <button
            key={t.key ?? "all"}
            type="button"
            onClick={() => onChange(t.key)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <span>{t.label}</span>
            <span
              className={cn(
                "rounded-full px-1.5 text-[10px] tabular-nums",
                active
                  ? "bg-primary-foreground/20 text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {t.count}
            </span>
          </button>
        );
      })}
      {counts.otros > 0 && (
        <span className="text-[10px] text-muted-foreground ml-2 whitespace-nowrap">
          + {counts.otros} otros (usa chip Tipo abajo)
        </span>
      )}
    </div>
  );
}

function CanaryWidget({ segmento, subgroup }: { segmento: string; subgroup: "no_store" | "has_store" | "default_unknown" }) {
  const fn = useServerFn(getCanaryMetrics);
  const [m, setM] = useState<CanaryMetrics | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Map default_unknown del filtro UI a "default" del backend
  const backendSubgroup: "no_store" | "has_store" | "default" =
    subgroup === "default_unknown" ? "default" : subgroup;
  useEffect(() => {
    let cancelled = false;
    setErr(null);
    fn({ data: { segmento, subgroup: backendSubgroup, limit: 50 } })
      .then((r) => { if (!cancelled) setM(r); })
      .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [segmento, backendSubgroup, fn]);

  if (err) {
    return (
      <div className="rounded-md border border-red-300 bg-red-50/70 p-2 text-[10px] text-red-700">
        Canary metrics error: {err}
      </div>
    );
  }
  if (!m) {
    return (
      <div className="rounded-md border bg-card p-2 text-[10px] text-muted-foreground italic">
        Calculando canary metrics…
      </div>
    );
  }

  const pctApproval = (m.approval_rate * 100).toFixed(0);
  const pctScore = (m.score_ge_95_rate * 100).toFixed(0);
  const tone = m.ready_to_flip
    ? "border-emerald-400 bg-emerald-50/70 dark:bg-emerald-950/30"
    : "border-amber-300 bg-amber-50/40 dark:bg-amber-950/20";

  return (
    <div className={cn("rounded-md border p-2.5 space-y-1.5 text-[11px]", tone)}>
      <div className="flex items-center gap-2 flex-wrap font-semibold">
        <span>🎯 {segmento} · {subgroup === "no_store" ? "Sin tienda" : subgroup === "has_store" ? "Con tienda" : "Sin clasif."}</span>
        <span className="text-muted-foreground font-normal">·</span>
        <span className="font-normal">{m.pending_count} en cola</span>
        {m.ready_to_flip ? (
          <span className="ml-auto rounded bg-emerald-600 text-white px-1.5 py-0.5 text-[10px]">
            🟢 LISTO PARA AUTO-SEND
          </span>
        ) : (
          <span className="ml-auto text-[10px] text-amber-700 dark:text-amber-300">
            🟠 todavía no
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 flex-wrap text-[10px]">
        <span className="text-muted-foreground">Últimos {m.processed_count} procesados:</span>
        <span>✅ <strong>{m.approved_no_edit_count}</strong> sin editar</span>
        <span>✏️ <strong>{m.edited_count}</strong> editados</span>
        <span>🚫 <strong>{m.rejected_count}</strong> rechazados</span>
        {m.deep_review_count > 0 && <span>🔍 {m.deep_review_count} deep</span>}
      </div>
      <div className="flex items-center gap-3 flex-wrap text-[10px]">
        <span>Approval-no-edit: <strong>{pctApproval}%</strong> <span className="text-muted-foreground">(min 80%)</span></span>
        <span>Score≥95: <strong>{pctScore}%</strong> <span className="text-muted-foreground">(min 90%)</span></span>
        <span>Consecutivas: <strong>{m.consecutive_approved_no_edit}</strong> <span className="text-muted-foreground">(min 8)</span></span>
      </div>
      <div className="text-[10px] italic text-muted-foreground">
        {m.ready_reason}
      </div>
    </div>
  );
}

function FilterBar({
  cases,
  turnTypeFilter,
  subgroupFilter,
  outcomeFilter,
  dateFilter,
  staleFilter,
  lastContactedMap,
  onTurnTypeChange,
  onSubgroupChange,
  onOutcomeChange,
  onDateChange,
  onStaleChange,
  anyFilterActive,
  onClearFilters,
}: {
  cases: TriageCase[];
  turnTypeFilter: string | null;
  subgroupFilter: "no_store" | "has_store" | "default_unknown" | null;
  outcomeFilter: "none" | "booked" | "closed_won" | "closed_lost" | "attended" | "no_show" | null;
  dateFilter: "1h" | "4h" | "24h" | "3d" | "7d" | null;
  staleFilter: "7d" | "14d" | "30d" | "60d" | null;
  lastContactedMap: Record<string, string | null> | null;
  onTurnTypeChange: (v: string | null) => void;
  onSubgroupChange: (v: "no_store" | "has_store" | "default_unknown" | null) => void;
  onOutcomeChange: (v: "none" | "booked" | "closed_won" | "closed_lost" | "attended" | "no_show" | null) => void;
  onDateChange: (v: "1h" | "4h" | "24h" | "3d" | "7d" | null) => void;
  onStaleChange: (v: "7d" | "14d" | "30d" | "60d" | null) => void;
  anyFilterActive: boolean;
  onClearFilters: () => void;
}) {
  // Counts dinamicos sobre el dataset completo
  const turnTypeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cases) {
      const k = c.turn_type ?? "turn1";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [cases]);
  const turnTypes = Array.from(turnTypeCounts.entries())
    .filter(([, n]) => n > 0)
    .sort((a, b) => a[0].localeCompare(b[0]));

  // Counts dinámicos para el filtro de antigüedad (sobre el dataset sin filtrar)
  const ageCounts = useMemo(() => {
    const now = Date.now();
    const buckets = { "1h": 0, "4h": 0, "24h": 0, "3d": 0, "7d": 0 };
    for (const c of cases) {
      const ts = c.reply_timestamp ? Date.parse(c.reply_timestamp) : NaN;
      if (Number.isNaN(ts)) continue;
      const ageH = (now - ts) / (60 * 60 * 1000);
      if (ageH >= 1) buckets["1h"]++;
      if (ageH >= 4) buckets["4h"]++;
      if (ageH >= 24) buckets["24h"]++;
      if (ageH >= 72) buckets["3d"]++;
      if (ageH >= 168) buckets["7d"]++;
    }
    return buckets;
  }, [cases]);
  const dateOptions: Array<{ value: "1h" | "4h" | "24h" | "3d" | "7d"; label: string }> = [
    { value: "1h", label: ">1h" },
    { value: "4h", label: ">4h" },
    { value: "24h", label: ">1d" },
    { value: "3d", label: ">3d" },
    { value: "7d", label: ">7d" },
  ];

  if (turnTypes.length <= 1 && cases.length < 5 && !anyFilterActive) {
    return null;
  }

  return (
    <div className="space-y-2 rounded-lg border bg-card p-2">
      {turnTypes.length > 1 && (
        <FilterChipRow
          label="Tipo"
          options={turnTypes.map(([k, n]) => ({
            value: k,
            label: TURN_TYPE_LABELS[k]?.label ?? k,
            count: n,
          }))}
          activeValue={turnTypeFilter}
          onChange={onTurnTypeChange}
        />
      )}
      {/* Segmento chip removido — ahora vive como tabs prominentes arriba. */}
      {(() => {
        // Subgroup filter — counts en vivo sobre los casos cargados
        const counts = { no_store: 0, has_store: 0, default_unknown: 0 };
        for (const c of cases) {
          const hks = c.has_known_store;
          if (hks === false) counts.no_store++;
          else if (hks === true) counts.has_store++;
          else counts.default_unknown++;
        }
        const total = counts.no_store + counts.has_store + counts.default_unknown;
        if (total === 0) return null;
        return (
          <FilterChipRow
            label="Tienda"
            options={[
              { value: "no_store", label: "Sin tienda", count: counts.no_store },
              { value: "has_store", label: "Con tienda", count: counts.has_store },
              { value: "default_unknown", label: "Sin clasif.", count: counts.default_unknown },
            ]}
            activeValue={subgroupFilter}
            onChange={(v) => onSubgroupChange(v as "no_store" | "has_store" | "default_unknown" | null)}
          />
        );
      })()}
      {(() => {
        // Outcome filter — solo aparece si hay leads con outcomes para no añadir ruido
        const counts: Record<string, number> = {
          none: 0, booked: 0, closed_won: 0, closed_lost: 0, attended: 0, no_show: 0
        };
        for (const c of cases) {
          const o = c.lead_outcome ?? null;
          if (o === null) counts.none++;
          else if (counts[o] !== undefined) counts[o]++;
        }
        const hasOutcomes = counts.booked + counts.closed_won + counts.closed_lost + counts.attended + counts.no_show > 0;
        if (!hasOutcomes) return null;
        return (
          <FilterChipRow
            label="Estado"
            options={[
              { value: "none", label: "Sin outcome", count: counts.none },
              { value: "booked", label: "🗓 Booked", count: counts.booked },
              { value: "attended", label: "✓ Asistió", count: counts.attended },
              { value: "no_show", label: "✗ No-show", count: counts.no_show },
              { value: "closed_won", label: "🏆 Won", count: counts.closed_won },
              { value: "closed_lost", label: "❌ Lost", count: counts.closed_lost },
            ]}
            activeValue={outcomeFilter}
            onChange={(v) => onOutcomeChange(v as "none" | "booked" | "closed_won" | "closed_lost" | "attended" | "no_show" | null)}
          />
        );
      })()}
      <FilterChipRow
        label="Cola"
        options={dateOptions.map((o) => ({
          value: o.value,
          label: o.label,
          count: ageCounts[o.value],
        }))}
        activeValue={dateFilter}
        onChange={(v) => onDateChange(v as "1h" | "4h" | "24h" | "3d" | "7d" | null)}
      />
      {lastContactedMap !== null && (() => {
        const now = Date.now();
        const buckets = { "7d": 0, "14d": 0, "30d": 0, "60d": 0 };
        for (const c of cases) {
          const cid = c.hubspot_contact_id;
          if (!cid) continue;
          const iso = lastContactedMap[cid];
          if (iso === undefined) continue;
          if (iso === null) {
            buckets["7d"]++;
            buckets["14d"]++;
            buckets["30d"]++;
            buckets["60d"]++;
            continue;
          }
          const sinceDays = (now - Date.parse(iso)) / (24 * 60 * 60 * 1000);
          if (sinceDays >= 7) buckets["7d"]++;
          if (sinceDays >= 14) buckets["14d"]++;
          if (sinceDays >= 30) buckets["30d"]++;
          if (sinceDays >= 60) buckets["60d"]++;
        }
        const has = Object.values(lastContactedMap).length > 0;
        if (!has) return null;
        const staleOptions: Array<{ value: "7d" | "14d" | "30d" | "60d"; label: string }> = [
          { value: "7d", label: ">7d sin contacto" },
          { value: "14d", label: ">14d" },
          { value: "30d", label: ">30d" },
          { value: "60d", label: ">60d" },
        ];
        return (
          <FilterChipRow
            label="HS"
            options={staleOptions.map((o) => ({
              value: o.value,
              label: o.label,
              count: buckets[o.value],
            }))}
            activeValue={staleFilter}
            onChange={(v) => onStaleChange(v as "7d" | "14d" | "30d" | "60d" | null)}
          />
        );
      })()}
      {anyFilterActive && (
        <button
          type="button"
          onClick={onClearFilters}
          className="text-[11px] text-muted-foreground hover:text-foreground underline"
        >
          Limpiar filtros
        </button>
      )}
    </div>
  );
}

function FilterChipRow({
  label,
  options,
  activeValue,
  onChange,
}: {
  label: string;
  options: Array<{ value: string; label: string; count: number }>;
  activeValue: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] font-medium uppercase text-muted-foreground w-10 shrink-0">
        {label}
      </span>
      {options.map(({ value, label: optLabel, count }) => {
        const active = activeValue === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onChange(active ? null : value)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
              active
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background hover:bg-accent text-foreground"
            )}
          >
            {optLabel}
            <span className={cn("ml-1", active ? "opacity-80" : "text-muted-foreground")}>
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------- auto-rejected banner ----------

function AutoRejectedBanner({
  case: c,
  onRescue,
  rescuing,
}: {
  case: TriageCase;
  onRescue: () => void;
  rescuing: boolean;
}) {
  const val = c.validation_output ?? {};
  // Razón principal — del razones_fallo o errores_criticos
  const razones = Array.isArray(val.razones_fallo) ? val.razones_fallo : [];
  const errores = Array.isArray(val.errores_criticos) ? val.errores_criticos : [];
  const mainReason = razones[0] ?? errores[0] ?? "Sin razón registrada";
  const isSkipFromClassifier = errores.some((e: string) =>
    typeof e === "string" && e.startsWith("skip: STOP_LEAD_INVALIDO")
  );
  return (
    <div className="rounded-md border-2 border-orange-400 bg-orange-50/60 dark:bg-orange-950/30 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-orange-900 dark:text-orange-200">
          ⚠ Caso auto-rechazado por el sistema
        </h3>
      </div>
      <p className="text-[11px] text-orange-900/80 dark:text-orange-200/80">
        {isSkipFromClassifier ? (
          <>
            El <strong>clasificador</strong> marcó este reply como{" "}
            <code className="bg-orange-100 dark:bg-orange-900/50 px-1 rounded">
              es_lead_valido=false
            </code>{" "}
            y se saltó la generación del Turn 1. Si crees que el lead es válido,
            rescátalo y regenera.
          </>
        ) : (
          <>
            El <strong>validator</strong> rechazó el output con ≥3 errores
            críticos antes de mostrarlo al SDR.
          </>
        )}
      </p>
      <div className="text-[11px] text-orange-900 dark:text-orange-200 rounded bg-orange-100/60 dark:bg-orange-900/40 p-2 font-mono">
        {mainReason}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          variant="default"
          onClick={onRescue}
          disabled={rescuing}
          className="h-7 text-xs bg-orange-600 hover:bg-orange-700"
        >
          {rescuing ? "🛟 Rescatando…" : "🛟 Rescatar a Pending Review"}
        </Button>
        <span className="text-[10px] text-muted-foreground italic">
          Tras rescatar, usa "🔄 Regenerar con IA" abajo si necesitas un Turn 1
          nuevo.
        </span>
      </div>
    </div>
  );
}

// ---------- store classifier control ----------

function StoreClassifierControl({
  current,
  busy,
  onChange,
}: {
  current: boolean | null;
  busy: boolean;
  onChange: (value: boolean | null) => void;
}) {
  const options: Array<{
    value: boolean | null;
    label: string;
    hint: string;
  }> = [
    {
      value: true,
      label: "🛒 Tiene tienda",
      hint: "Lead con tienda → segmento pasa a Genesis (empresa establecida) y usa el prompt Genesis.",
    },
    {
      value: false,
      label: "🚫 Sin tienda",
      hint: "Lead sin tienda → segmento pasa a MEGA (aspiracional) y usa el prompt MEGA/no_store.",
    },
    {
      value: null,
      label: "❓ Sin clasificar",
      hint: "Sin certeza → segmento se queda como está, usa el prompt catch-all del segmento actual.",
    },
  ];
  return (
    <div className="rounded-md border bg-card/60 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium uppercase text-muted-foreground">
          Clasificación tienda (manual)
        </h3>
        {busy && (
          <span className="text-[11px] text-muted-foreground italic">
            Actualizando…
          </span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Cambiar aquí <strong>actualiza el segmento</strong> del lead (MEGA ↔ Genesis)
        y <strong>regenera el Turn 1</strong> con el prompt apropiado.
        Útil si el detector automático se equivocó.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = current === opt.value;
          return (
            <button
              key={String(opt.value)}
              type="button"
              disabled={busy || active}
              onClick={() => onChange(opt.value)}
              title={opt.hint}
              className={cn(
                "rounded-md border px-2 py-1 text-[11px] transition-colors",
                active
                  ? "bg-primary text-primary-foreground border-primary cursor-default"
                  : "bg-background hover:bg-accent text-foreground",
                busy && !active && "opacity-60 cursor-wait"
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------- detail ----------

function CaseDetail({
  case: c,
  index,
  total,
  onRegenerate,
  regenerating,
  onSetStore,
  settingStore,
  onRescue,
  rescuing,
}: {
  case: TriageCase;
  index: number;
  total: number;
  onRegenerate: () => void;
  regenerating: boolean;
  onSetStore: (value: boolean | null, regenerateAfter: boolean) => void;
  settingStore: boolean;
  onRescue: () => void;
  rescuing: boolean;
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

  const hasCriticos = (c.errores_criticos?.length ?? 0) > 0;
  const hasRazonesFallo = (c.razones_fallo?.length ?? 0) > 0;
  const hasChecksDetail = checks && Object.keys(checks).length > 0;
  const hasValidationDetail = hasRazonesFallo || hasChecksDetail || comentariosValidador;
  const tier = aiConfidenceTier(c);
  const sla = slaSeverity(min);
  const missingTurn1 = hasMissingTurn1Bug(c);

  return (
    <div className="flex flex-col h-full">
      {/* Header compacto: una linea con todos los chips + lead + SLA */}
      <div className="border-b px-5 py-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium text-muted-foreground">
            {index + 1}/{total}
          </span>
          <span className="text-muted-foreground">·</span>
          <span className={cn("rounded-full px-2 py-0.5 font-medium", conf.pillClasses)}>
            {conf.label}
          </span>
          <span className={cn("rounded-full px-2 py-0.5 font-medium", turnTypeMeta(c).classes)}>
            {turnTypeMeta(c).label}
          </span>
          {c.patron && (
            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
              Patrón {c.patron}
            </Badge>
          )}
          {tier === "auto" && !missingTurn1 && (
            <span
              className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
              title="🟢 AUTO — score ≥95 sin críticos. Cumple criterio auto-send."
            >
              🟢 Auto
            </span>
          )}
          {tier === "margin" && !missingTurn1 && (
            <span
              className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
              title="🟡 MARGIN — score 85-94. Validación pasa pero merece vistazo rápido."
            >
              🟡 Margin
            </span>
          )}
          {sla === "urgent" && (
            <span
              className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold uppercase text-white"
              title="Caso lleva más de 4h en cola"
            >
              ⚠ Urgente
            </span>
          )}
          {sla === "critical" && (
            <span
              className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white"
              title="Caso lleva más de 24h en cola — RIESGO de perder al lead"
            >
              🔥 Riesgo
            </span>
          )}
          <span className="ml-auto flex items-center gap-2">
            <span className={cn("font-medium", slaColor(min))}>
              {min === null ? "—" : `${min} min en cola`}
            </span>
          </span>
        </div>
        <div className="mt-1.5 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold leading-tight">
              {c.lead_name || c.lead_email || c.smartlead_lead_id || c.id}
            </h2>
            {c.lead_email && c.lead_name && (
              <p className="truncate text-[11px] text-muted-foreground">
                {c.lead_email}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Body: 2 columnas. Izq conversacion (60%), der Turn 1 + validacion (40%) */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[3fr_2fr]">
        {/* Columna izquierda: conversacion (scrollable independiente) */}
        <div className="min-h-0 overflow-y-auto border-b lg:border-b-0 lg:border-r p-5">
          <h3 className="mb-3 text-xs font-medium uppercase text-muted-foreground">
            Conversación · último reply {formatRel(min)}
          </h3>
          <ConversationThread
            smartleadLeadId={c.smartlead_lead_id ?? null}
            snapshot={c.thread_snapshot ?? null}
            leadEmail={c.lead_email ?? null}
            defaultCompact
          />
        </div>

        {/* Columna derecha: Turn 1 destacado + score + acciones (scrollable) */}
        <div className="min-h-0 overflow-y-auto p-5 space-y-5">
          {/* Banner auto-rejected — rescatar si el lead era válido */}
          {c.status === "auto_rejected" && (
            <AutoRejectedBanner case={c} onRescue={onRescue} rescuing={rescuing} />
          )}

          {/* Contexto HubSpot del lead — ayuda a juzgar si avanzar y cómo */}
          <HubSpotLeadContextCard hubspotContactId={c.hubspot_contact_id ?? null} />

          {c.lead_email && (
            <Link
              to="/lead/$email"
              params={{ email: encodeURIComponent(c.lead_email) }}
              className="inline-flex items-center gap-1 text-[11px] underline text-muted-foreground hover:text-foreground"
            >
              🔍 Ver timeline completo de este lead
            </Link>
          )}

          {/* Clasificación manual de tienda + regenerar — útil cuando el detector
              automático se equivocó (ej. dominio comercial que no matcheó la regex). */}
          <StoreClassifierControl
            current={c.has_known_store ?? null}
            busy={settingStore || regenerating}
            onChange={(value) => onSetStore(value, true)}
          />

          {/* Turn 1: lo más importante, primero, en font sans para lectura natural */}
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-medium uppercase text-muted-foreground">
                  Respuesta propuesta
                </h3>
                <button
                  type="button"
                  onClick={onRegenerate}
                  disabled={regenerating}
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-[11px] transition-colors flex items-center gap-1",
                    regenerating
                      ? "border-muted bg-muted/40 text-muted-foreground cursor-wait"
                      : "border-foreground/20 hover:bg-accent text-foreground"
                  )}
                  title="Vuelve a clasificar + generar + validar usando los prompts actualmente activos. Útil si has editado un prompt y quieres ver la nueva salida."
                >
                  {regenerating ? "🔄 Regenerando…" : "🔄 Regenerar con IA"}
                </button>
              </div>
              <ScoreCompact
                score={c.score}
                checksPasados={checksPasados}
                checksFallidos={checksFallidos}
                validado={c.validado}
              />
            </div>
            {missingTurn1 && (
              <div className="mb-2 rounded-md border border-amber-300 bg-amber-50/70 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
                <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                  ⚠ Score alto pero sin Turn 1 generado
                </p>
                <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                  Bug del Generador o Validador (probable JSON malformado). Edita o
                  rechaza este caso — NO lo apruebes tal cual.
                </p>
              </div>
            )}
            {c.turn_1_generated ? (
              <div className="rounded-md border bg-card p-4 text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                {c.turn_1_generated}
              </div>
            ) : (
              <Empty />
            )}
          </div>

          {/* Errores críticos: solo si los hay, destacados */}
          {hasCriticos && (
            <div className="rounded-md border border-red-300 bg-red-50/70 p-3 dark:border-red-900/60 dark:bg-red-950/20">
              <h4 className="mb-1 text-[11px] font-semibold uppercase text-red-700 dark:text-red-300">
                Errores críticos · {c.errores_criticos?.length}
              </h4>
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-red-700 dark:text-red-300">
                {c.errores_criticos!.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Resumen de clasificación: compacto */}
          <ClassificationCompact c={c} cls={cls} />

          {/* Detalle de validación: colapsado por defecto, expandible */}
          {hasValidationDetail && (
            <details className="group rounded-md border bg-card">
              <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 flex items-center justify-between">
                <span>Detalle de validación (12 checks · razones · comentarios)</span>
                <span className="text-muted-foreground transition-transform group-open:rotate-180">
                  ▾
                </span>
              </summary>
              <div className="space-y-3 border-t p-3">
                {hasRazonesFallo && (
                  <div>
                    <h4 className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">
                      Razones de fallo
                    </h4>
                    <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                      {c.razones_fallo!.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {hasChecksDetail && (
                  <div>
                    <h4 className="mb-2 text-[11px] font-semibold uppercase text-muted-foreground">
                      Detalle de los 12 checks
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
                      {Object.entries(CHECK_LABELS).map(([key, label]) => {
                        const passed = checks![key];
                        const known = passed !== undefined;
                        return (
                          <div
                            key={key}
                            className={cn(
                              "flex items-center gap-1.5 text-[11px]",
                              !known && "text-muted-foreground",
                              known && passed && "text-emerald-700 dark:text-emerald-400",
                              known && !passed && "text-red-700 dark:text-red-400"
                            )}
                          >
                            <span
                              className={cn(
                                "inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold leading-none shrink-0",
                                known && passed && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40",
                                known && !passed && "bg-red-100 text-red-700 dark:bg-red-900/40",
                                !known && "bg-muted text-muted-foreground"
                              )}
                            >
                              {known ? (passed ? "✓" : "✗") : "?"}
                            </span>
                            <span className="truncate">{label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {comentariosValidador && (
                  <div>
                    <h4 className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">
                      Comentarios del validador
                    </h4>
                    <p className="text-xs text-foreground whitespace-pre-wrap">
                      {comentariosValidador}
                    </p>
                  </div>
                )}
              </div>
            </details>
          )}

          <p className="text-[11px] text-muted-foreground italic">
            {conf.hint}
          </p>
        </div>
      </div>
    </div>
  );
}

function ScoreCompact({
  score,
  checksPasados,
  checksFallidos,
  validado,
}: {
  score?: number | null;
  checksPasados: number | null;
  checksFallidos: number | null;
  validado?: boolean | null;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={cn("text-2xl font-bold leading-none", scoreColor(score))}>
        {typeof score === "number" ? score : "—"}
      </span>
      <span className="text-muted-foreground">/100</span>
      {(checksPasados !== null || checksFallidos !== null) && (
        <span className="text-muted-foreground">
          ·{" "}
          <span className="text-emerald-600 dark:text-emerald-400 font-medium">
            {checksPasados ?? "—"}
          </span>
          {"/"}
          <span className="text-red-600 dark:text-red-400 font-medium">
            {checksFallidos ?? "—"}
          </span>
        </span>
      )}
      {validado === true && (
        <Badge variant="secondary" className="h-4 px-1.5 text-[9px]">
          Validado
        </Badge>
      )}
    </div>
  );
}

function ClassificationCompact({
  c,
  cls,
}: {
  c: TriageCase;
  cls: ClassificationOutput;
}) {
  const items: Array<{ label: string; value: string | null | undefined }> = [
    { label: "Patrón", value: (cls.patron as string | undefined) ?? c.patron },
    { label: "Tono", value: cls.tono_lead as string | undefined },
    typeof cls.es_lead_valido === "boolean"
      ? { label: "Válido", value: cls.es_lead_valido ? "Sí" : "No" }
      : { label: "", value: null },
    { label: "Canal pedido", value: cls.canal_pedido as string | undefined },
  ].filter((i) => i.value);
  if (items.length === 0 && !cls.notas) return null;
  return (
    <div className="rounded-md border bg-muted/30 p-3 text-xs">
      <h4 className="mb-1.5 text-[10px] font-semibold uppercase text-muted-foreground">
        Clasificación IA
      </h4>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {items.map((i, idx) => (
          <span key={idx}>
            <span className="text-muted-foreground">{i.label}:</span>{" "}
            <span className="font-medium">{i.value}</span>
          </span>
        ))}
      </div>
      {typeof cls.notas === "string" && cls.notas && (
        <p className="mt-1.5 text-muted-foreground">{cls.notas}</p>
      )}
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
  const original = caseItem.turn_1_generated ?? "";
  const [text, setText] = useState(original);
  const [reasons, setReasons] = useState<string[]>([]);
  const [otherChecked, setOtherChecked] = useState(false);
  const [otherText, setOtherText] = useState("");

  // Solo re-inicializa cuando el dialog se ABRE o cambia el CASO (por id).
  // No usar `caseItem` como dep porque el polling de router.invalidate()
  // recrea el objeto cada 10s y borraría lo que el SDR esté escribiendo.
  useEffect(() => {
    if (open) {
      setText(caseItem.turn_1_generated ?? "");
      setReasons([]);
      setOtherChecked(false);
      setOtherText("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, caseItem.id]);

  const lines = text.split("\n").length;
  const chars = text.length;
  const origLines = original.split("\n").length;
  const origChars = original.length;
  const charsDelta = chars - origChars;

  // Diff line-a-linea para resaltar cambios visualmente
  const diff = useMemo(() => computeLineDiff(original, text), [original, text]);

  function toggle(reason: string, checked: boolean) {
    setReasons((prev) =>
      checked ? [...prev, reason] : prev.filter((r) => r !== reason)
    );
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    // Cmd/Ctrl+Enter para guardar rapidamente
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (!disabled && text.trim().length > 0) {
        onSave({
          edited: text,
          reasons,
          otherReason: otherChecked ? otherText.trim() || undefined : undefined,
        });
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            Editar Turn 1 — {caseItem.lead_name || caseItem.lead_email || caseItem.id}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-medium uppercase text-muted-foreground">
                  Original (IA)
                </h4>
                <span className="text-[10px] text-muted-foreground">
                  {origChars} chars · {origLines} líneas
                </span>
              </div>
              <div className="h-[320px] overflow-y-auto rounded-md border bg-muted/40 p-3 font-mono text-sm leading-relaxed">
                {diff.left.map((row, i) => (
                  <div
                    key={i}
                    className={cn(
                      "whitespace-pre-wrap",
                      row.changed && "bg-red-100/70 line-through decoration-red-400 dark:bg-red-950/30"
                    )}
                  >
                    {row.text || " "}
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-medium uppercase text-muted-foreground">
                  Tu versión
                </h4>
                <span className="text-[10px] text-muted-foreground">
                  {chars} chars · {lines} líneas{" "}
                  {charsDelta !== 0 && (
                    <span className={cn(charsDelta > 0 ? "text-emerald-600" : "text-amber-600")}>
                      ({charsDelta > 0 ? "+" : ""}
                      {charsDelta})
                    </span>
                  )}
                </span>
              </div>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                className="h-[320px] resize-none font-mono text-sm leading-relaxed"
              />
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

        <DialogFooter className="items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground">
            <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono">⌘ + Enter</kbd>{" "}
            para guardar rápido
          </span>
          <div className="flex gap-2">
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
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({
  open,
  onOpenChange,
  caseItem,
  disabled,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  caseItem: TriageCase;
  disabled: boolean;
  onConfirm: (data: {
    reasons: string[];
    otherReason?: string;
  }) => Promise<void> | void;
}) {
  const [reasons, setReasons] = useState<string[]>([]);
  const [otherChecked, setOtherChecked] = useState(false);
  const [otherText, setOtherText] = useState("");

  useEffect(() => {
    if (open) {
      setReasons([]);
      setOtherChecked(false);
      setOtherText("");
    }
  }, [open, caseItem]);

  function toggle(reason: string, checked: boolean) {
    setReasons((prev) =>
      checked ? [...prev, reason] : prev.filter((r) => r !== reason)
    );
  }

  const hasReason =
    reasons.length > 0 || (otherChecked && otherText.trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            Rechazar caso — {caseItem.lead_name || caseItem.lead_email || caseItem.id}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            El caso queda <code>rejected</code> y no se enviará respuesta. Selecciona
            la razón principal — alimenta los analytics para mejorar prompts.
          </p>
          <div className="space-y-2">
            {REJECT_REASONS.map((r) => (
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
            <label className="flex items-center gap-2 text-sm">
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
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={disabled}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={disabled || !hasReason}
            onClick={() =>
              onConfirm({
                reasons,
                otherReason: otherChecked ? otherText.trim() || undefined : undefined,
              })
            }
          >
            🚫 Rechazar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Diff línea-a-línea simple (LCS). Devuelve para CADA lado un array de líneas
 * con flag `changed` cuando la línea no aparece en el otro lado.
 *
 * Es más útil para textos cortos como un Turn 1 (3-8 líneas) que un diff
 * por palabras, que se vuelve ruidoso.
 */
type DiffRow = { text: string; changed: boolean };
type LineDiffResult = { left: DiffRow[]; right: DiffRow[] };

function computeLineDiff(original: string, edited: string): LineDiffResult {
  const a = original.split("\n");
  const b = edited.split("\n");
  // LCS table de longitudes (limitado a ~200 lineas; un Turn 1 nunca llega cerca)
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const inLcs: boolean[] = new Array(m).fill(false);
  const inLcsB: boolean[] = new Array(n).fill(false);
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      inLcs[i] = true;
      inLcsB[j] = true;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return {
    left: a.map((text, idx) => ({ text, changed: !inLcs[idx] })),
    right: b.map((text, idx) => ({ text, changed: !inLcsB[idx] })),
  };
}

// ---------- shared ----------

function Empty() {
  return <p className="text-sm italic text-muted-foreground">Sin contenido.</p>;
}

