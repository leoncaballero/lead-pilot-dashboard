import { createFileRoute, ErrorComponent, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  listPrompts,
  createPromptVersion,
  activatePromptVersion,
  type PromptVersion,
  type PromptType,
  type Segmento,
  type TurnType,
} from "@/api/prompts.functions";

const TURN_TYPE_LABELS: Record<TurnType, string> = {
  turn1: "Turn 1",
  turn2_generic: "Turn 2",
  follow_up_4h: "FU 4h",
};

const PROMPT_TYPE_LABELS: Record<PromptType, string> = {
  classifier: "Clasificador",
  generator: "Generador",
  validator: "Validador",
};

export const Route = createFileRoute("/_authenticated/prompts")({
  loader: async () => {
    const res = await listPrompts();
    return res;
  },
  staleTime: 10_000,
  pendingComponent: PromptsPending,
  errorComponent: ({ error }) => {
    const router = useRouter();
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Prompts</h1>
        <ErrorComponent error={error} />
        <button className="text-sm underline text-muted-foreground" onClick={() => router.invalidate()}>
          Reintentar
        </button>
      </div>
    );
  },
  component: PromptsPage,
});

function PromptsPending() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Prompts</h1>
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

function PromptsPage() {
  const initial = Route.useLoaderData();
  const router = useRouter();
  const createFn = useServerFn(createPromptVersion);
  const activateFn = useServerFn(activatePromptVersion);

  const [editing, setEditing] = useState<PromptVersion | null>(null);
  const [viewing, setViewing] = useState<PromptVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Agrupar por (turn_type, prompt_type, segmento) y separar activas vs versiones anteriores
  const groups = useMemo(() => groupPrompts(initial.prompts), [initial.prompts]);

  async function handleSaveNew(input: {
    base: PromptVersion;
    new_prompt: string;
    description: string;
    setActive: boolean;
  }) {
    setBusy(true);
    setErrorMsg(null);
    try {
      await createFn({
        data: {
          prompt_type: input.base.prompt_type,
          segmento: input.base.segmento,
          turn_type: input.base.turn_type,
          prompt_system: input.new_prompt,
          model: input.base.model,
          temperature: input.base.temperature ?? 0,
          max_tokens: input.base.max_tokens ?? 2048,
          description: input.description,
          setActive: input.setActive,
        },
      });
      setEditing(null);
      await router.invalidate();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Error guardando");
    } finally {
      setBusy(false);
    }
  }

  async function handleActivate(p: PromptVersion) {
    setBusy(true);
    setErrorMsg(null);
    try {
      await activateFn({ data: { id: p.id } });
      await router.invalidate();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Error activando");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Prompts</h1>
        <p className="text-sm text-muted-foreground">
          Versiones activas y previas. Cada edición guarda una versión nueva (v1.0 → v1.1 → ...) y
          opcionalmente la activa. Los workflows leen la versión activa en cada generación.
        </p>
      </div>

      {errorMsg && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          {errorMsg}
        </div>
      )}

      {groups.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
          No hay prompts en la tabla. Ejecuta la migración SQL primero.
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.key} className="rounded-lg border bg-card overflow-hidden">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                  {TURN_TYPE_LABELS[g.turn_type] ?? g.turn_type}
                </Badge>
                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                  {PROMPT_TYPE_LABELS[g.prompt_type] ?? g.prompt_type}
                </Badge>
                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                  {g.segmento}
                </Badge>
              </div>
              {g.active && (
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => setEditing(g.active!)}
                  disabled={busy}
                >
                  Editar / nueva versión
                </Button>
              )}
            </div>

            {g.active && (
              <div className="px-4 py-3 bg-emerald-50/50 dark:bg-emerald-950/10 border-b">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-emerald-600 hover:bg-emerald-600">Activa</Badge>
                    <span className="font-mono text-sm">{g.active.version}</span>
                    <span className="text-xs text-muted-foreground">
                      {g.active.model} · temp {g.active.temperature ?? 0} · max {g.active.max_tokens ?? "?"}
                    </span>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setViewing(g.active!)}>
                    Ver completo
                  </Button>
                </div>
                {g.active.description && (
                  <div className="text-xs text-muted-foreground">{g.active.description}</div>
                )}
                <div className="text-xs text-muted-foreground mt-1">
                  {g.active.prompt_system.length} chars · actualizada {formatTime(g.active.updated_at)}
                </div>
                <pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap rounded bg-muted/60 p-2 text-[11px] font-mono leading-relaxed text-muted-foreground">
                  {g.active.prompt_system.slice(0, 500)}
                  {g.active.prompt_system.length > 500 ? "..." : ""}
                </pre>
              </div>
            )}

            {g.history.length > 0 && (
              <details className="px-4 py-2">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  {g.history.length} versión{g.history.length === 1 ? "" : "es"} anterior{g.history.length === 1 ? "" : "es"}
                </summary>
                <ul className="mt-2 space-y-1">
                  {g.history.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs">{p.version}</span>
                        <span className="text-xs text-muted-foreground">
                          {p.description ?? "—"}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          ({p.prompt_system.length} chars · {formatTime(p.updated_at)})
                        </span>
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setViewing(p)}>
                          Ver
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleActivate(p)} disabled={busy}>
                          Activar
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))
      )}

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-3xl">
          {viewing && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {TURN_TYPE_LABELS[viewing.turn_type]} · {PROMPT_TYPE_LABELS[viewing.prompt_type]} · {viewing.segmento} · {viewing.version}
                </DialogTitle>
              </DialogHeader>
              <pre className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs font-mono leading-relaxed">
                {viewing.prompt_system}
              </pre>
            </>
          )}
        </DialogContent>
      </Dialog>

      {editing && (
        <EditDialog
          base={editing}
          onClose={() => setEditing(null)}
          onSave={handleSaveNew}
          busy={busy}
        />
      )}
    </div>
  );
}

function EditDialog({
  base,
  onClose,
  onSave,
  busy,
}: {
  base: PromptVersion;
  onClose: () => void;
  onSave: (input: {
    base: PromptVersion;
    new_prompt: string;
    description: string;
    setActive: boolean;
  }) => Promise<void>;
  busy: boolean;
}) {
  const [text, setText] = useState(base.prompt_system);
  const [description, setDescription] = useState("");
  const [setActive, setSetActive] = useState(true);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            Nueva versión: {TURN_TYPE_LABELS[base.turn_type]} · {PROMPT_TYPE_LABELS[base.prompt_type]} · {base.segmento}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="prompt-text">Prompt system</Label>
            <Textarea
              id="prompt-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="font-mono text-xs leading-relaxed min-h-[400px]"
            />
            <div className="text-xs text-muted-foreground mt-1">
              {text.length} chars · {text.length !== base.prompt_system.length ? `(${text.length - base.prompt_system.length >= 0 ? '+' : ''}${text.length - base.prompt_system.length} vs base)` : "(sin cambios)"}
            </div>
          </div>
          <div>
            <Label htmlFor="description">Descripción del cambio (opcional)</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="ej: ablandar el tono, añadir frase X..."
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={setActive}
              onChange={(e) => setSetActive(e.target.checked)}
              className="h-4 w-4"
            />
            Activar esta versión inmediatamente (reemplaza la actual {base.version})
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button
            onClick={() =>
              onSave({
                base,
                new_prompt: text,
                description,
                setActive,
              })
            }
            disabled={busy || text === base.prompt_system}
          >
            {busy ? "Guardando..." : "Guardar nueva versión"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Group = {
  key: string;
  prompt_type: PromptType;
  segmento: Segmento;
  turn_type: TurnType;
  active: PromptVersion | null;
  history: PromptVersion[];
};

function groupPrompts(prompts: PromptVersion[]): Group[] {
  const map = new Map<string, Group>();
  for (const p of prompts) {
    const key = `${p.turn_type}|${p.prompt_type}|${p.segmento}`;
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        prompt_type: p.prompt_type,
        segmento: p.segmento,
        turn_type: p.turn_type,
        active: null,
        history: [],
      };
      map.set(key, g);
    }
    if (p.is_active && !g.active) g.active = p;
    else g.history.push(p);
  }
  // Orden: turn1 -> turn2_generic -> follow_up_4h, luego classifier -> generator -> validator
  const turnOrder: Record<TurnType, number> = { turn1: 0, turn2_generic: 1, follow_up_4h: 2 };
  const typeOrder: Record<PromptType, number> = { classifier: 0, generator: 1, validator: 2 };
  return Array.from(map.values()).sort((a, b) => {
    const t = (turnOrder[a.turn_type] ?? 9) - (turnOrder[b.turn_type] ?? 9);
    if (t !== 0) return t;
    const p = (typeOrder[a.prompt_type] ?? 9) - (typeOrder[b.prompt_type] ?? 9);
    if (p !== 0) return p;
    return a.segmento.localeCompare(b.segmento);
  });
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

