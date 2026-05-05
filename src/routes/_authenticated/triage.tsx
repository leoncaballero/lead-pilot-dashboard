import { createFileRoute, ErrorComponent, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  getTriageCases,
  type TriageCase,
} from "@/server/triage.functions";

export const Route = createFileRoute("/_authenticated/triage")({
  loader: () => getTriageCases(),
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
  if (score >= 92) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 85) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function formatRel(min: number | null): string {
  if (min === null) return "—";
  if (min < 1) return "hace menos de 1 min";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return `hace ${h}h ${min % 60}m`;
}

// ---------- skeletons ----------

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
  const { cases } = Route.useLoaderData();
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(
    cases[0]?.id ?? null
  );

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

  // Polling cada 5s
  useEffect(() => {
    const id = setInterval(() => {
      router.invalidate();
    }, 5000);
    return () => clearInterval(id);
  }, [router]);

  const selectedIndex = useMemo(
    () => cases.findIndex((c: TriageCase) => c.id === selectedId),
    [cases, selectedId]
  );
  const selected = selectedIndex >= 0 ? cases[selectedIndex] : null;

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Triage Rápido</h1>
          <p className="text-sm text-muted-foreground">
            Casos pendientes con score 85–94, ordenados por antigüedad.
          </p>
        </div>
        <div className="text-sm text-muted-foreground">
          {cases.length} caso{cases.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="flex flex-1 min-h-0 gap-4">
        {/* Sidebar lista */}
        <aside className="w-[30%] min-w-[260px] flex flex-col gap-2 overflow-y-auto pr-1">
          {cases.length === 0 ? (
            <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
              No hay casos pendientes.
            </div>
          ) : (
            cases.map((c: TriageCase) => (
              <CaseListItem
                key={c.id}
                case={c}
                active={c.id === selectedId}
                onClick={() => setSelectedId(c.id)}
              />
            ))
          )}
        </aside>

        {/* Panel detalle */}
        <section className="flex-1 min-w-0 overflow-y-auto rounded-lg border bg-card">
          {selected ? (
            <CaseDetail
              case={selected}
              index={selectedIndex}
              total={cases.length}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-12 text-sm text-muted-foreground">
              Selecciona un caso
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ---------- list item ----------

function CaseListItem({
  case: c,
  active,
  onClick,
}: {
  case: TriageCase;
  active: boolean;
  onClick: () => void;
}) {
  const min = minutesSince(c.reply_timestamp);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/50",
        active && "border-primary bg-accent"
      )}
    >
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
          {c.patron && (
            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
              {c.patron}
            </Badge>
          )}
        </div>
      </div>
      <div className={cn("mt-2 text-xs", slaColor(min))}>{formatRel(min)}</div>
    </button>
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

  return (
    <div className="flex h-full flex-col">
      {/* Top */}
      <div className="border-b p-6">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-muted-foreground">
            {index + 1}/{total}
          </div>
          {c.patron && (
            <Badge variant="outline">Patrón {c.patron}</Badge>
          )}
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
      </div>

      {/* Sections */}
      <div className="flex-1 space-y-6 p-6">
        {/* Reply original */}
        <Section title="Reply original">
          {c.reply_original ? (
            <blockquote className="border-l-4 border-muted-foreground/30 pl-4 text-sm italic text-foreground">
              {c.reply_original}
            </blockquote>
          ) : (
            <Empty />
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Respondió {formatRel(min)}
          </p>
        </Section>

        {/* Clasificación IA */}
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

        {/* Turn 1 generado */}
        <Section title="Turn 1 Generado">
          {c.turn_1_generated ? (
            <pre className="whitespace-pre-wrap rounded-md bg-muted p-4 font-mono text-sm leading-relaxed text-foreground">
              {c.turn_1_generated}
            </pre>
          ) : (
            <Empty />
          )}
        </Section>

        {/* Validación IA */}
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
        </Section>
      </div>

      {/* Footer */}
      <div className="border-t bg-muted/30 px-6 py-4 text-xs text-muted-foreground">
        Acciones próximas: Aprobar / Editar / Rechazar / Revisión profunda
      </div>
    </div>
  );
}

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
