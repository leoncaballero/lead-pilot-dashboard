import { createFileRoute, ErrorComponent, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
import { approveCase, editCase, rejectCase, type TriageCase } from "@/server/triage.functions";
import { getDeepReviewCases, returnToTriage } from "@/server/deep-review.functions";

const EDIT_REASONS = [
  "Halago disfrazado",
  "Jerga consultor",
  "Tono no encaja",
  "Estructura incorrecta",
  "Saludo incorrecto",
  "Pregunta cualificadora inadecuada",
  "Cuerpo emocional incorrecto",
];

export const Route = createFileRoute("/_authenticated/deep-review")({
  loader: async () => {
    const res = await getDeepReviewCases();
    return res;
  },
  staleTime: 5_000,
  pendingComponent: DeepReviewPending,
  errorComponent: ({ error }) => {
    const router = useRouter();
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Deep Review</h1>
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
  component: DeepReviewPage,
});

function DeepReviewPending() {
  return (
    <div className="flex h-[calc(100vh-7rem)] gap-4">
      <div className="w-[28%] space-y-2">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
      <div className="flex-1">
        <Skeleton className="h-full w-full" />
      </div>
    </div>
  );
}

function DeepReviewPage() {
  const { cases } = Route.useLoaderData();
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(cases[0]?.id ?? null);
  const [pending, setPending] = useState(false);
  const [confirmRejectOpen, setConfirmRejectOpen] = useState(false);
  const [confirmReturnOpen, setConfirmReturnOpen] = useState(false);
  const [editText, setEditText] = useState("");
  const [editReasons, setEditReasons] = useState<string[]>([]);
  const [otherChecked, setOtherChecked] = useState(false);
  const [otherText, setOtherText] = useState("");

  const approveFn = useServerFn(approveCase);
  const rejectFn = useServerFn(rejectCase);
  const editFn = useServerFn(editCase);
  const returnFn = useServerFn(returnToTriage);

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

  // Cuando cambia el caso seleccionado, prellenar el editor con el copy generado
  useEffect(() => {
    const c = cases.find((c: TriageCase) => c.id === selectedId);
    if (c) {
      setEditText(c.turn_1_generated ?? "");
      setEditReasons([]);
      setOtherChecked(false);
      setOtherText("");
    }
  }, [selectedId, cases]);

  // Polling de respaldo cada 15s
  useEffect(() => {
    const id = setInterval(() => {
      router.invalidate();
    }, 15000);
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

  async function runAction(label: string, fn: () => Promise<unknown>, currentId: string) {
    setPending(true);
    try {
      await fn();
      toast.success(label);
      advanceAfter(currentId);
      await router.invalidate();
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Error al ejecutar la acción");
    } finally {
      setPending(false);
    }
  }

  async function handleApproveAsIs() {
    if (!selected) return;
    await runAction(
      "Caso aprobado",
      () => approveFn({ data: { id: selected.id, turn_1_generated: selected.turn_1_generated ?? "" } }),
      selected.id
    );
  }

  async function handleSaveAndSend() {
    if (!selected) return;
    const reasons = [
      ...editReasons,
      ...(otherChecked && otherText.trim() ? [`otro: ${otherText.trim()}`] : []),
    ];
    if (editText.trim().length === 0) {
      toast.error("El copy no puede estar vacío");
      return;
    }
    await runAction(
      "Caso editado y enviado",
      () => editFn({
        data: {
          id: selected.id,
          original: selected.turn_1_generated ?? "",
          edited: editText,
          reasons,
        },
      }),
      selected.id
    );
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Revisión Profunda</h1>
          <p className="text-sm text-muted-foreground">
            Casos con score &lt;85 o derivados manualmente desde Triage. Editor amplio.
          </p>
        </div>
        <span className="text-sm text-muted-foreground">
          {cases.length} caso{cases.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex flex-1 min-h-0 gap-4">
        {/* Sidebar lista */}
        <aside className="w-[28%] min-w-[240px] flex flex-col gap-2 overflow-y-auto pr-1">
          {cases.length === 0 ? (
            <EmptyState />
          ) : (
            cases.map((c: TriageCase) => (
              <CaseListItem
                key={c.id}
                c={c}
                active={c.id === selectedId}
                onClick={() => setSelectedId(c.id)}
              />
            ))
          )}
        </aside>

        {/* Panel detalle + editor */}
        <section className="flex-1 min-w-0 overflow-hidden rounded-lg border bg-card flex flex-col">
          {selected ? (
            <>
              <div className="border-b p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">
                      {selected.lead_name || selected.lead_email || selected.id}
                    </h2>
                    {selected.lead_email && (
                      <p className="text-xs text-muted-foreground">{selected.lead_email}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {selected.patron && <Badge variant="outline">Patrón {selected.patron}</Badge>}
                    {typeof selected.score === "number" && (
                      <span className={cn("text-2xl font-bold", scoreColor(selected.score))}>
                        {selected.score}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                {/* Reply original */}
                <Section title="Reply original">
                  {selected.reply_original ? (
                    <blockquote className="border-l-2 border-muted-foreground/30 pl-3 italic whitespace-pre-wrap text-sm">
                      {selected.reply_original}
                    </blockquote>
                  ) : <Empty />}
                </Section>

                {/* Razones de fallo + errores críticos */}
                {(selected.errores_criticos?.length || selected.razones_fallo?.length) ? (
                  <Section title="Por qué llegó aquí">
                    {selected.errores_criticos && selected.errores_criticos.length > 0 && (
                      <div className="mb-2">
                        <div className="text-xs font-semibold uppercase text-red-600 dark:text-red-400 mb-1">
                          Errores críticos
                        </div>
                        <ul className="list-disc pl-5 text-sm text-red-600 dark:text-red-400">
                          {selected.errores_criticos.map((e, i) => <li key={i}>{e}</li>)}
                        </ul>
                      </div>
                    )}
                    {selected.razones_fallo && selected.razones_fallo.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                          Razones de fallo
                        </div>
                        <ul className="list-disc pl-5 text-sm text-muted-foreground">
                          {selected.razones_fallo.map((r, i) => <li key={i}>{r}</li>)}
                        </ul>
                      </div>
                    )}
                  </Section>
                ) : null}

                {/* Editor amplio */}
                <Section title="Editor del Turn 1">
                  <Textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={12}
                    className="font-mono text-sm"
                    placeholder="Copy del Turn 1 (editable)"
                  />
                  <div className="flex justify-between mt-1 text-xs text-muted-foreground">
                    <span>{editText.length} caracteres · {editText.split("\n").length} líneas</span>
                    {selected.turn_1_generated && editText !== selected.turn_1_generated && (
                      <button
                        type="button"
                        className="underline"
                        onClick={() => setEditText(selected.turn_1_generated ?? "")}
                      >
                        Restaurar generado
                      </button>
                    )}
                  </div>

                  <div className="mt-3">
                    <h4 className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                      Razones de edición (si editas)
                    </h4>
                    <div className="grid grid-cols-2 gap-2">
                      {EDIT_REASONS.map((r) => (
                        <label key={r} className="flex items-center gap-2 text-sm cursor-pointer">
                          <Checkbox
                            checked={editReasons.includes(r)}
                            onCheckedChange={(v) => {
                              if (v === true) setEditReasons((prev) => [...prev, r]);
                              else setEditReasons((prev) => prev.filter((x) => x !== r));
                            }}
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
                          placeholder="Especifica..."
                          className="h-8"
                        />
                      </label>
                    </div>
                  </div>
                </Section>
              </div>

              {/* Acciones footer */}
              <div className="border-t bg-muted/30">
                <div className="grid grid-cols-4 gap-2 p-4">
                  <Button
                    size="lg"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={handleSaveAndSend}
                    disabled={pending || editText.trim().length === 0}
                  >
                    💾 Editar y enviar
                  </Button>
                  <Button
                    size="lg"
                    variant="secondary"
                    onClick={handleApproveAsIs}
                    disabled={pending}
                  >
                    ✅ Aprobar tal cual
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={() => setConfirmReturnOpen(true)}
                    disabled={pending}
                  >
                    ↩️ Devolver a Triage
                  </Button>
                  <Button
                    size="lg"
                    variant="destructive"
                    onClick={() => setConfirmRejectOpen(true)}
                    disabled={pending}
                  >
                    🚫 Rechazar
                  </Button>
                </div>
              </div>
            </>
          ) : cases.length === 0 ? (
            <div className="flex h-full items-center justify-center p-12">
              <EmptyState large />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-12 text-sm text-muted-foreground">
              Selecciona un caso
            </div>
          )}
        </section>
      </div>

      {/* Confirm reject */}
      <AlertDialog open={confirmRejectOpen} onOpenChange={setConfirmRejectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Rechazar este caso?</AlertDialogTitle>
            <AlertDialogDescription>
              Quedará marcado como rechazado y NO se enviará respuesta. Esta acción no se puede deshacer desde aquí.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!selected) return;
                runAction("Caso rechazado", () => rejectFn({ data: { id: selected.id } }), selected.id);
              }}
            >
              Sí, rechazar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm return to triage */}
      <AlertDialog open={confirmReturnOpen} onOpenChange={setConfirmReturnOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Devolver a Triage?</AlertDialogTitle>
            <AlertDialogDescription>
              El caso volverá a la cola de Triage Rápido (status pending_review). Útil si fue derivado a Deep Review por error.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!selected) return;
                runAction("Devuelto a Triage", () => returnFn({ data: { id: selected.id } }), selected.id);
              }}
            >
              Sí, devolver
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CaseListItem({
  c,
  active,
  onClick,
}: {
  c: TriageCase;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "w-full rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/50",
        active && "border-primary bg-accent"
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {c.lead_name || c.lead_email || c.smartlead_lead_id || c.id}
          </div>
          {c.lead_email && (
            <div className="truncate text-xs text-muted-foreground">{c.lead_email}</div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {typeof c.score === "number" && (
            <span className={cn("text-xs font-semibold", scoreColor(c.score))}>
              {c.score}
            </span>
          )}
          {c.patron && (
            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{c.patron}</Badge>
          )}
        </div>
      </div>
      {c.errores_criticos && c.errores_criticos.length > 0 && (
        <div className="mt-1 text-[10px] text-red-600 dark:text-red-400">
          {c.errores_criticos.length} crítico{c.errores_criticos.length === 1 ? "" : "s"}
        </div>
      )}
    </button>
  );
}

function EmptyState({ large = false }: { large?: boolean }) {
  return (
    <div className={cn(
      "rounded-lg border bg-card text-center text-muted-foreground",
      large ? "p-12" : "p-6"
    )}>
      <div className={cn("font-semibold", large ? "text-2xl" : "text-base")}>
        Sin casos en revisión profunda
      </div>
      <p className="mt-2 text-sm">No hay casos con score &lt;85 ni derivados desde Triage.</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Empty() {
  return <p className="text-sm italic text-muted-foreground">Sin contenido.</p>;
}

function scoreColor(score?: number | null): string {
  if (typeof score !== "number") return "text-muted-foreground";
  if (score >= 95) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 85) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}
