import { createFileRoute, ErrorComponent, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  listStrategies,
  createStrategy,
  updateStrategy,
  activateStrategy,
  deleteStrategy,
  type Strategy,
  type Segmento,
} from "@/api/strategies.functions";

const SEGMENTOS: Segmento[] = ["MEGA", "Genesis", "Prosperitas"];

export const Route = createFileRoute("/_authenticated/strategies")({
  loader: async () => await listStrategies(),
  staleTime: 10_000,
  pendingComponent: StrategiesPending,
  errorComponent: ({ error }) => {
    const router = useRouter();
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Estrategias</h1>
        <ErrorComponent error={error} />
        <button className="text-sm underline" onClick={() => router.invalidate()}>
          Reintentar
        </button>
      </div>
    );
  },
  component: StrategiesPage,
});

function StrategiesPending() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Estrategias</h1>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

function StrategiesPage() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const createFn = useServerFn(createStrategy);
  const updateFn = useServerFn(updateStrategy);
  const activateFn = useServerFn(activateStrategy);
  const deleteFn = useServerFn(deleteStrategy);

  const [editing, setEditing] = useState<Strategy | null>(null);
  const [creatingForSegment, setCreatingForSegment] = useState<Segmento | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const usageMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of data.usage) m.set(u.strategy_id, u.pipeline_count);
    return m;
  }, [data.usage]);

  const bySegment = useMemo(() => {
    const m = new Map<Segmento, Strategy[]>();
    for (const seg of SEGMENTOS) m.set(seg, []);
    for (const s of data.strategies) {
      if (!m.has(s.segmento)) m.set(s.segmento, []);
      m.get(s.segmento)!.push(s);
    }
    // Active first
    for (const arr of m.values()) {
      arr.sort((a, b) => {
        if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
        return (b.created_at ?? "").localeCompare(a.created_at ?? "");
      });
    }
    return m;
  }, [data.strategies]);

  async function handleSave(input: {
    name: string;
    description: string;
    segmento: Segmento;
    fu1_enabled: boolean;
    fu1_offset_hours: number;
    fu2_enabled: boolean;
    fu2_offset_hours: number;
    fu3_enabled: boolean;
    fu3_offset_hours: number;
    setActive: boolean;
  }) {
    setBusy(true);
    setErrorMsg(null);
    try {
      if (editing) {
        await updateFn({
          data: {
            id: editing.id,
            name: input.name,
            description: input.description || null,
            fu1_enabled: input.fu1_enabled,
            fu1_offset_hours: input.fu1_offset_hours,
            fu2_enabled: input.fu2_enabled,
            fu2_offset_hours: input.fu2_offset_hours,
            fu3_enabled: input.fu3_enabled,
            fu3_offset_hours: input.fu3_offset_hours,
          },
        });
        if (input.setActive && !editing.is_active) {
          await activateFn({ data: { id: editing.id } });
        }
      } else {
        await createFn({
          data: {
            name: input.name,
            description: input.description || undefined,
            segmento: input.segmento,
            fu1_enabled: input.fu1_enabled,
            fu1_offset_hours: input.fu1_offset_hours,
            fu2_enabled: input.fu2_enabled,
            fu2_offset_hours: input.fu2_offset_hours,
            fu3_enabled: input.fu3_enabled,
            fu3_offset_hours: input.fu3_offset_hours,
            setActive: input.setActive,
          },
        });
      }
      setEditing(null);
      setCreatingForSegment(null);
      await router.invalidate();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Error guardando");
    } finally {
      setBusy(false);
    }
  }

  async function handleActivate(s: Strategy) {
    setBusy(true);
    try {
      await activateFn({ data: { id: s.id } });
      await router.invalidate();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Error activando");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(s: Strategy) {
    if (s.is_active) {
      setErrorMsg("No puedes borrar la estrategia activa. Activa otra primero.");
      return;
    }
    const used = usageMap.get(s.id) ?? 0;
    if (used > 0) {
      const ok = confirm(
        `Esta estrategia tiene ${used} leads atribuidos. Si la borras esos leads pierden la referencia (strategy_id queda NULL pero los datos históricos se mantienen). ¿Continuar?`
      );
      if (!ok) return;
    } else {
      const ok = confirm(`¿Borrar la estrategia "${s.name}"?`);
      if (!ok) return;
    }
    setBusy(true);
    try {
      await deleteFn({ data: { id: s.id } });
      await router.invalidate();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Error borrando");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Estrategias de Follow-Up</h1>
        <p className="text-sm text-muted-foreground">
          Define cadencias distintas por segmento (timing y on/off de cada FU). Solo una activa
          por segmento. Los leads sellan la estrategia al entrar al pipeline. ⚠️ La integración
          con n8n se activa después — hoy los workflows usan los hardcodes (4h/24h/3d).
        </p>
      </div>

      {errorMsg && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          {errorMsg}
        </div>
      )}

      {data.needs_migration && (
        <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-6 space-y-3 dark:border-amber-800 dark:bg-amber-950/30">
          <h2 className="text-base font-semibold text-amber-900 dark:text-amber-200">
            ⚠️ Migración SQL pendiente
          </h2>
          <p className="text-sm text-amber-900/80 dark:text-amber-200/80">
            La tabla <code className="text-xs">cl001_p007_strategies</code> todavía no existe en
            Supabase OUTBOUND. Para activar esta sección:
          </p>
          <ol className="list-decimal list-inside text-sm space-y-1 text-amber-900/80 dark:text-amber-200/80">
            <li>Abre el SQL Editor de Supabase OUTBOUND (mazhrnqztnjvppgbltuq)</li>
            <li>
              Ejecuta el contenido de{" "}
              <code className="text-xs rounded bg-amber-100 px-1 py-0.5 dark:bg-amber-900/40">
                outbound-migrations/20260507_002_strategies.sql
              </code>
            </li>
            <li>Recarga esta página</li>
          </ol>
          <p className="text-xs text-amber-900/60 dark:text-amber-200/60 italic">
            La migración crea la tabla + añade la columna <code>strategy_id</code> a pipeline y
            siembra una estrategia "Default 4h/24h/3d" activa por cada segmento.
          </p>
          <button
            type="button"
            onClick={() => router.invalidate()}
            className="text-sm underline text-amber-900 hover:text-amber-700 dark:text-amber-200"
          >
            Reintentar
          </button>
        </div>
      )}

      {data.pipeline_missing_column && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          La tabla strategies existe pero la columna <code>strategy_id</code> en pipeline aún no.
          Los conteos de leads aparecerán como 0 hasta que ejecutes la parte 2 de la migración.
        </div>
      )}

      {data.strategies.length === 0 && !data.needs_migration && (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground space-y-2">
          <p>No hay estrategias creadas todavía. Crea la primera para un segmento.</p>
        </div>
      )}

      {!data.needs_migration && SEGMENTOS.map((seg) => {
        const strategies = bySegment.get(seg) ?? [];
        return (
          <div key={seg} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">{seg}</h2>
                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                  {strategies.length} estrateg{strategies.length === 1 ? "ia" : "ias"}
                </Badge>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCreatingForSegment(seg)}
                disabled={busy}
              >
                + Nueva estrategia para {seg}
              </Button>
            </div>
            {strategies.length === 0 ? (
              <div className="rounded-lg border bg-card p-4 text-center text-xs text-muted-foreground">
                Sin estrategias para {seg}.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {strategies.map((s) => (
                  <StrategyCard
                    key={s.id}
                    s={s}
                    pipelineCount={usageMap.get(s.id) ?? 0}
                    onEdit={() => setEditing(s)}
                    onActivate={() => handleActivate(s)}
                    onDelete={() => handleDelete(s)}
                    busy={busy}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {(editing || creatingForSegment) && (
        <StrategyDialog
          base={editing}
          fixedSegmento={creatingForSegment ?? editing?.segmento}
          onClose={() => {
            setEditing(null);
            setCreatingForSegment(null);
          }}
          onSave={handleSave}
          busy={busy}
        />
      )}
    </div>
  );
}

function StrategyCard({
  s,
  pipelineCount,
  onEdit,
  onActivate,
  onDelete,
  busy,
}: {
  s: Strategy;
  pipelineCount: number;
  onEdit: () => void;
  onActivate: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-4 space-y-3",
        s.is_active && "ring-2 ring-emerald-500/50 border-emerald-500/30 bg-emerald-50/20 dark:bg-emerald-950/10"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="font-semibold text-sm">{s.name}</h3>
            {s.is_active && (
              <Badge className="bg-emerald-600 hover:bg-emerald-600 h-4 px-1.5 text-[10px]">
                Activa
              </Badge>
            )}
            <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
              {pipelineCount} leads
            </Badge>
          </div>
          {s.description && (
            <p className="text-xs text-muted-foreground line-clamp-2">{s.description}</p>
          )}
        </div>
      </div>

      <div className="rounded border bg-muted/20 p-2">
        <div className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider mb-1.5">
          Cadencia FU post Turn 1
        </div>
        <div className="grid grid-cols-3 gap-1 text-[11px]">
          <FuStep label="FU 1" enabled={s.fu1_enabled} hours={s.fu1_offset_hours} />
          <FuStep label="FU 2" enabled={s.fu2_enabled} hours={s.fu2_offset_hours} />
          <FuStep label="FU 3" enabled={s.fu3_enabled} hours={s.fu3_offset_hours} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        {!s.is_active && (
          <Button size="sm" variant="default" onClick={onActivate} disabled={busy}>
            Activar
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onEdit} disabled={busy}>
          Editar
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDelete}
          disabled={busy || s.is_active}
          className="ml-auto text-red-600 hover:text-red-700"
        >
          Borrar
        </Button>
      </div>
    </div>
  );
}

function FuStep({
  label,
  enabled,
  hours,
}: {
  label: string;
  enabled: boolean;
  hours: number;
}) {
  return (
    <div
      className={cn(
        "rounded border px-2 py-1.5 text-center",
        enabled
          ? "bg-emerald-50/60 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-900"
          : "bg-muted/40 border-dashed text-muted-foreground"
      )}
    >
      <div className="text-[9px] uppercase font-semibold opacity-70">{label}</div>
      {enabled ? (
        <div className="font-mono tabular-nums">{formatHours(hours)}</div>
      ) : (
        <div className="text-[10px] italic">off</div>
      )}
    </div>
  );
}

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h}h`;
  const days = h / 24;
  if (Number.isInteger(days)) return `${days}d`;
  return `${days.toFixed(1)}d`;
}

function StrategyDialog({
  base,
  fixedSegmento,
  onClose,
  onSave,
  busy,
}: {
  base: Strategy | null;
  fixedSegmento?: Segmento;
  onClose: () => void;
  onSave: (input: {
    name: string;
    description: string;
    segmento: Segmento;
    fu1_enabled: boolean;
    fu1_offset_hours: number;
    fu2_enabled: boolean;
    fu2_offset_hours: number;
    fu3_enabled: boolean;
    fu3_offset_hours: number;
    setActive: boolean;
  }) => Promise<void>;
  busy: boolean;
}) {
  const [name, setName] = useState(base?.name ?? "");
  const [description, setDescription] = useState(base?.description ?? "");
  const [segmento, setSegmento] = useState<Segmento>(
    base?.segmento ?? fixedSegmento ?? "MEGA"
  );
  const [fu1Enabled, setFu1Enabled] = useState(base?.fu1_enabled ?? true);
  const [fu1Hours, setFu1Hours] = useState<string>(String(base?.fu1_offset_hours ?? 4));
  const [fu2Enabled, setFu2Enabled] = useState(base?.fu2_enabled ?? true);
  const [fu2Hours, setFu2Hours] = useState<string>(String(base?.fu2_offset_hours ?? 24));
  const [fu3Enabled, setFu3Enabled] = useState(base?.fu3_enabled ?? true);
  const [fu3Hours, setFu3Hours] = useState<string>(String(base?.fu3_offset_hours ?? 72));
  const [setActive, setSetActive] = useState(base?.is_active ?? true);

  const canSave =
    name.trim().length > 0 &&
    Number(fu1Hours) >= 0 &&
    Number(fu2Hours) >= 0 &&
    Number(fu3Hours) >= 0;

  async function handleSubmit() {
    await onSave({
      name: name.trim(),
      description: description.trim(),
      segmento,
      fu1_enabled: fu1Enabled,
      fu1_offset_hours: Number(fu1Hours),
      fu2_enabled: fu2Enabled,
      fu2_offset_hours: Number(fu2Hours),
      fu3_enabled: fu3Enabled,
      fu3_offset_hours: Number(fu3Hours),
      setActive,
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {base ? `Editar estrategia · ${base.name}` : `Nueva estrategia · ${segmento}`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="name">Nombre</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Agresiva 2h+8h, sin 3d"
              />
            </div>
            <div>
              <Label htmlFor="seg">Segmento</Label>
              <select
                id="seg"
                value={segmento}
                onChange={(e) => setSegmento(e.target.value as Segmento)}
                disabled={!!base}
                className="w-full h-9 rounded-md border bg-background px-2 text-sm disabled:opacity-60"
              >
                {SEGMENTOS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              {base && (
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  No se puede cambiar el segmento al editar.
                </p>
              )}
            </div>
          </div>

          <div>
            <Label htmlFor="desc">Descripción</Label>
            <Textarea
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Hipótesis o motivo del experimento…"
              className="min-h-[60px]"
            />
          </div>

          <div className="space-y-2 rounded border bg-muted/20 p-3">
            <Label className="text-xs uppercase font-semibold tracking-wider">
              Cadencia FU post Turn 1
            </Label>
            <p className="text-[11px] text-muted-foreground">
              Offset en horas desde que se envió el Turn 1 al lead. Acepta decimales (0.5 = 30
              min).
            </p>
            <FuRow
              label="FU 1"
              enabled={fu1Enabled}
              setEnabled={setFu1Enabled}
              hours={fu1Hours}
              setHours={setFu1Hours}
            />
            <FuRow
              label="FU 2"
              enabled={fu2Enabled}
              setEnabled={setFu2Enabled}
              hours={fu2Hours}
              setHours={setFu2Hours}
            />
            <FuRow
              label="FU 3"
              enabled={fu3Enabled}
              setEnabled={setFu3Enabled}
              hours={fu3Hours}
              setHours={setFu3Hours}
            />
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={setActive}
              onChange={(e) => setSetActive(e.target.checked)}
            />
            <span>
              {base?.is_active
                ? "Mantener como activa"
                : `Activar en ${segmento} (desactiva la actual)`}
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={busy || !canSave}>
            {busy ? "Guardando…" : base ? "Guardar cambios" : "Crear estrategia"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FuRow({
  label,
  enabled,
  setEnabled,
  hours,
  setHours,
}: {
  label: string;
  enabled: boolean;
  setEnabled: (b: boolean) => void;
  hours: string;
  setHours: (s: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="flex items-center gap-1.5 cursor-pointer w-20">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span className="text-sm font-medium">{label}</span>
      </label>
      <Input
        type="number"
        step="0.5"
        min="0"
        value={hours}
        onChange={(e) => setHours(e.target.value)}
        disabled={!enabled}
        className="w-24 h-8 text-sm"
      />
      <span className="text-xs text-muted-foreground">horas</span>
      {enabled && Number(hours) > 0 && (
        <span className="text-[11px] text-muted-foreground italic ml-auto">
          ≈ {formatHours(Number(hours))}
        </span>
      )}
    </div>
  );
}

