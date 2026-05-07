import { createFileRoute, ErrorComponent, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
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
  suggestPromptImprovements,
  refinePromptWithFeedback,
  evalPrompt,
  getEvalSamples,
  PROMPT_TYPE_VALUES,
  SEGMENTO_VALUES,
  TURN_TYPE_VALUES,
  DEFAULT_MODELS_BY_PROMPT_TYPE,
  DEFAULT_MAX_TOKENS_BY_PROMPT_TYPE,
  type PromptVersion,
  type PromptType,
  type Segmento,
  type TurnType,
  type SuggestPromptResponse,
  type ConversationTurn,
  type EvalTestCase,
  type EvalResult,
} from "@/api/prompts.functions";

const TURN_TYPE_LABELS: Record<TurnType, string> = {
  turn1: "Turn 1",
  turn2_generic: "Turn 2",
  turn3_generic: "Turn 3",
  follow_up_4h: "FU 4h",
  follow_up_24h: "FU 24h",
  follow_up_3d: "FU 3d",
  objection_response: "Objeción",
  booking_propose: "Propuesta hora",
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
  const [suggesting, setSuggesting] = useState<PromptVersion | null>(null);
  const [suggestion, setSuggestion] = useState<SuggestPromptResponse | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [refining, setRefining] = useState<PromptVersion | null>(null);
  const [evaluating, setEvaluating] = useState<PromptVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const suggestFn = useServerFn(suggestPromptImprovements);
  const refineFn = useServerFn(refinePromptWithFeedback);
  const evalFn = useServerFn(evalPrompt);
  const samplesFn = useServerFn(getEvalSamples);

  // Combos existentes — usado por el dialog de crear nuevo para mostrar duplicados
  const existingCombos = useMemo(() => {
    const set = new Set<string>();
    for (const p of initial.prompts) {
      set.add(`${p.prompt_type}|${p.segmento}|${p.turn_type}`);
    }
    return set;
  }, [initial.prompts]);

  async function handleCreateNew(input: {
    prompt_type: PromptType;
    segmento: Segmento;
    turn_type: TurnType;
    prompt_system: string;
    description?: string;
    model?: string;
    temperature?: number;
    max_tokens?: number;
    setActive: boolean;
  }) {
    setBusy(true);
    setErrorMsg(null);
    try {
      await createFn({ data: input });
      setCreatingNew(false);
      await router.invalidate();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Error creando prompt");
    } finally {
      setBusy(false);
    }
  }

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

  async function handleSuggest(active: PromptVersion) {
    setSuggesting(active);
    setSuggestion(null);
    setErrorMsg(null);
    try {
      const res = await suggestFn({
        data: {
          prompt_type: active.prompt_type,
          segmento: active.segmento,
          turn_type: active.turn_type,
        },
      });
      setSuggestion(res);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Error sugiriendo");
      setSuggesting(null);
    }
  }

  async function handleAcceptSuggestion(active: PromptVersion) {
    if (!suggestion?.suggested_prompt) return;
    setBusy(true);
    try {
      await createFn({
        data: {
          prompt_type: active.prompt_type,
          segmento: active.segmento,
          turn_type: active.turn_type,
          prompt_system: suggestion.suggested_prompt,
          model: active.model,
          temperature: active.temperature ?? 0,
          max_tokens: active.max_tokens ?? 2048,
          description:
            "IA-suggested · " +
            (suggestion.summary?.slice(0, 120) ?? "ajustes basados en feedback humano"),
          setActive: true,
        },
      });
      setSuggesting(null);
      setSuggestion(null);
      await router.invalidate();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Error guardando sugerencia");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Prompts</h1>
          <p className="text-sm text-muted-foreground">
            Versiones activas y previas. Cada edición guarda una versión nueva (v1.0 → v1.1 → ...) y
            opcionalmente la activa. Los workflows leen la versión activa en cada generación.
          </p>
        </div>
        <Button onClick={() => setCreatingNew(true)} disabled={busy}>
          + Crear prompt nuevo
        </Button>
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
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEvaluating(g.active!)}
                    disabled={busy || evaluating !== null}
                    title="Probar el prompt contra N samples reales antes de iterar"
                  >
                    🧪 Evaluar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setRefining(g.active!)}
                    disabled={busy || refining !== null}
                    title="Conversa con la IA dándole feedback en lenguaje natural para iterar el prompt"
                  >
                    💬 Refinar con feedback
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleSuggest(g.active!)}
                    disabled={busy || suggesting !== null}
                    title="Analiza ediciones y rechazos humanos recientes y propone una v2 del prompt"
                  >
                    🤖 Sugerir auto
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => setEditing(g.active!)}
                    disabled={busy}
                  >
                    Editar
                  </Button>
                </div>
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

      {suggesting && (
        <SuggestionDialog
          base={suggesting}
          suggestion={suggestion}
          onClose={() => {
            setSuggesting(null);
            setSuggestion(null);
          }}
          onAccept={() => handleAcceptSuggestion(suggesting)}
          busy={busy}
        />
      )}

      {refining && (
        <RefineDialog
          base={refining}
          refineFn={refineFn}
          onClose={() => setRefining(null)}
          onSave={async (newPrompt: string, summary: string) => {
            setBusy(true);
            try {
              await createFn({
                data: {
                  prompt_type: refining.prompt_type,
                  segmento: refining.segmento,
                  turn_type: refining.turn_type,
                  prompt_system: newPrompt,
                  model: refining.model,
                  temperature: refining.temperature ?? 0,
                  max_tokens: refining.max_tokens ?? 2048,
                  description: "Refinado conversacionalmente · " + summary.slice(0, 120),
                  setActive: true,
                },
              });
              setRefining(null);
              await router.invalidate();
            } catch (e) {
              setErrorMsg(e instanceof Error ? e.message : "Error guardando");
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {evaluating && (
        <EvalDialog
          base={evaluating}
          evalFn={evalFn}
          samplesFn={samplesFn}
          onClose={() => setEvaluating(null)}
        />
      )}

      {creatingNew && (
        <CreateNewDialog
          existingCombos={existingCombos}
          existingPrompts={initial.prompts}
          onClose={() => setCreatingNew(false)}
          onSave={handleCreateNew}
          busy={busy}
        />
      )}
    </div>
  );
}

function RefineDialog({
  base,
  refineFn,
  onClose,
  onSave,
}: {
  base: PromptVersion;
  refineFn: (input: { data: {
    current_prompt: string;
    prompt_type: PromptType;
    segmento: Segmento;
    turn_type: TurnType;
    history: ConversationTurn[];
    user_message: string;
  } }) => Promise<{ ok: boolean; refined_prompt?: string; assistant_message?: string; unchanged?: boolean; error?: string; cost_tokens?: { input: number; output: number } }>;
  onClose: () => void;
  onSave: (newPrompt: string, summary: string) => Promise<void>;
}) {
  const [currentPrompt, setCurrentPrompt] = useState(base.prompt_system);
  const [history, setHistory] = useState<ConversationTurn[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showCurrentPrompt, setShowCurrentPrompt] = useState(false);

  async function handleSend() {
    if (!input.trim()) return;
    const userMsg: ConversationTurn = { role: "user", content: input.trim() };
    setHistory((h) => [...h, userMsg]);
    setInput("");
    setThinking(true);
    setErrorMsg(null);
    try {
      const res = await refineFn({
        data: {
          current_prompt: currentPrompt,
          prompt_type: base.prompt_type,
          segmento: base.segmento,
          turn_type: base.turn_type,
          history,
          user_message: userMsg.content,
        },
      });
      if (!res.ok) {
        setErrorMsg(res.error ?? "Error desconocido");
        // Quitar el último user msg al fallar para que pueda reintentar
        setHistory((h) => h.slice(0, -1));
        setInput(userMsg.content);
        return;
      }
      const assistantMsg: ConversationTurn = {
        role: "assistant",
        content: res.assistant_message ?? "(sin mensaje)",
      };
      setHistory((h) => [...h, assistantMsg]);
      if (res.refined_prompt && !res.unchanged) {
        setCurrentPrompt(res.refined_prompt);
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Error inesperado");
      setHistory((h) => h.slice(0, -1));
      setInput(userMsg.content);
    } finally {
      setThinking(false);
    }
  }

  function handleKeyDown(e: import("react").KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  }

  const promptChanged = currentPrompt !== base.prompt_system;
  const lastAssistant = [...history].reverse().find((t) => t.role === "assistant");
  const summaryForSave = lastAssistant?.content ?? "Refinado vía conversación";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            💬 Refinar con feedback — {TURN_TYPE_LABELS[base.turn_type] ?? base.turn_type} · {PROMPT_TYPE_LABELS[base.prompt_type]} · {base.segmento} · {base.version}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 h-[500px]">
          {/* Izquierda: chat */}
          <div className="flex flex-col h-full min-h-0 rounded-md border bg-muted/20">
            <div className="flex-1 overflow-y-auto p-3 space-y-3 text-sm">
              {history.length === 0 && !thinking && (
                <p className="text-xs text-muted-foreground italic text-center py-8">
                  Escribe feedback en lenguaje natural sobre cómo quieres que cambie
                  el prompt. Ej: "el Turn 1 está muy formal, quiero más cercano",
                  "no menciones llamada de 15 min, ofrece info por email primero",
                  "añade ejemplo de respuesta a Genesis".
                </p>
              )}
              {history.map((t, i) => (
                <div
                  key={i}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm whitespace-pre-wrap",
                    t.role === "user"
                      ? "bg-blue-100/60 ml-6 dark:bg-blue-950/30"
                      : "bg-emerald-100/60 mr-6 dark:bg-emerald-950/30"
                  )}
                >
                  <div className="text-[10px] font-semibold uppercase mb-1 opacity-70">
                    {t.role === "user" ? "Tú" : "Claude"}
                  </div>
                  {t.content}
                </div>
              ))}
              {thinking && (
                <div className="rounded-md bg-emerald-100/40 px-3 py-2 mr-6 text-sm italic text-muted-foreground dark:bg-emerald-950/20">
                  Claude pensando...
                </div>
              )}
              {errorMsg && (
                <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {errorMsg}
                </div>
              )}
            </div>
            <div className="border-t p-2 space-y-1">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Tu feedback..."
                className="min-h-[60px] text-sm"
                disabled={thinking}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-muted-foreground">
                  <kbd className="rounded border bg-background px-1">⌘ Enter</kbd> para enviar
                </span>
                <Button size="sm" onClick={handleSend} disabled={thinking || !input.trim()}>
                  Enviar
                </Button>
              </div>
            </div>
          </div>

          {/* Derecha: prompt actual con cambios */}
          <div className="flex flex-col h-full min-h-0">
            <div className="mb-1 flex items-center justify-between">
              <h4 className="text-xs font-medium uppercase text-muted-foreground">
                {promptChanged ? (
                  <span className="text-emerald-700 dark:text-emerald-400">
                    Prompt actualizado · {currentPrompt.length} chars
                    {currentPrompt.length !== base.prompt_system.length && (
                      <span className="ml-1">
                        ({currentPrompt.length > base.prompt_system.length ? "+" : ""}
                        {currentPrompt.length - base.prompt_system.length})
                      </span>
                    )}
                  </span>
                ) : (
                  <>Prompt actual ({currentPrompt.length} chars)</>
                )}
              </h4>
              <button
                type="button"
                onClick={() => setShowCurrentPrompt((v) => !v)}
                className="text-[10px] underline text-muted-foreground hover:text-foreground"
              >
                {showCurrentPrompt ? "Ocultar" : "Ver completo"}
              </button>
            </div>
            <pre
              className={cn(
                "flex-1 overflow-y-auto whitespace-pre-wrap rounded-md border p-3 font-mono text-[11px] leading-relaxed",
                promptChanged
                  ? "border-emerald-300 bg-emerald-50/30 dark:border-emerald-900/40 dark:bg-emerald-950/10"
                  : "bg-muted/40"
              )}
            >
              {showCurrentPrompt
                ? currentPrompt
                : currentPrompt.slice(0, 1500) +
                  (currentPrompt.length > 1500 ? "\n\n...(usa 'Ver completo' para ver todo)" : "")}
            </pre>
          </div>
        </div>

        <DialogFooter className="items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {promptChanged
              ? "El prompt ha cambiado en esta conversación. Al guardar se crea v" +
                nextMinor(base.version) +
                " y se activa."
              : "Aún no hay cambios. Itera con feedback hasta que estés satisfecho."}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cerrar sin guardar
            </Button>
            {promptChanged && (
              <Button onClick={() => onSave(currentPrompt, summaryForSave)}>
                Guardar y activar v{nextMinor(base.version)}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EvalDialog({
  base,
  evalFn,
  samplesFn,
  onClose,
}: {
  base: PromptVersion;
  evalFn: (input: {
    data: {
      prompt_system: string;
      model: string;
      temperature?: number;
      max_tokens?: number;
      test_cases: EvalTestCase[];
    };
  }) => Promise<{
    ok: boolean;
    results: EvalResult[];
    total_tokens: { input: number; output: number };
    total_duration_ms: number;
    error?: string;
  }>;
  samplesFn: (input: {
    data: { prompt_type: PromptType; segmento?: Segmento; turn_type: TurnType; limit?: number };
  }) => Promise<{
    samples: Array<{
      pipeline_id: string;
      lead_name: string | null;
      lead_email: string | null;
      segmento: string | null;
      reply_text: string;
      suggested_user_message: string;
    }>;
  }>;
  onClose: () => void;
}) {
  const [promptSystem, setPromptSystem] = useState(base.prompt_system);
  const [testCases, setTestCases] = useState<EvalTestCase[]>([
    { id: crypto.randomUUID(), user_message: "", label: "Test 1" },
  ]);
  const [results, setResults] = useState<EvalResult[]>([]);
  const [running, setRunning] = useState(false);
  const [loadingSamples, setLoadingSamples] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [tokenSummary, setTokenSummary] = useState<{
    input: number;
    output: number;
    duration_ms: number;
  } | null>(null);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [sampleSegmento, setSampleSegmento] = useState<Segmento | undefined>(
    base.segmento === "MEGA" ? undefined : base.segmento
  );

  const promptChanged = promptSystem !== base.prompt_system;

  function addTestCase() {
    setTestCases((cs) => [
      ...cs,
      { id: crypto.randomUUID(), user_message: "", label: `Test ${cs.length + 1}` },
    ]);
  }

  function updateTestCase(id: string, patch: Partial<EvalTestCase>) {
    setTestCases((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function removeTestCase(id: string) {
    setTestCases((cs) => (cs.length === 1 ? cs : cs.filter((c) => c.id !== id)));
  }

  async function loadSamples(n: number) {
    setLoadingSamples(true);
    setErrorMsg(null);
    try {
      const res = await samplesFn({
        data: {
          prompt_type: base.prompt_type,
          segmento: sampleSegmento,
          turn_type: base.turn_type,
          limit: n,
        },
      });
      if (!res.samples.length) {
        setErrorMsg(
          `No hay replies recientes en el pipeline para segmento ${sampleSegmento ?? "(cualquiera)"}.`
        );
        return;
      }
      setTestCases(
        res.samples.map((s, i) => ({
          id: crypto.randomUUID(),
          user_message: s.suggested_user_message,
          label: `${s.lead_name ?? s.lead_email ?? "lead"} · ${s.segmento ?? "?"} #${i + 1}`,
        }))
      );
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Error cargando samples");
    } finally {
      setLoadingSamples(false);
    }
  }

  async function runAll() {
    const valid = testCases.filter((tc) => tc.user_message.trim().length > 0);
    if (valid.length === 0) {
      setErrorMsg("Añade al menos un test case con user_message no vacío.");
      return;
    }
    setRunning(true);
    setErrorMsg(null);
    setResults([]);
    setTokenSummary(null);
    try {
      const res = await evalFn({
        data: {
          prompt_system: promptSystem,
          model: base.model,
          temperature: base.temperature ?? undefined,
          max_tokens: base.max_tokens ?? undefined,
          test_cases: valid,
        },
      });
      if (!res.ok) {
        setErrorMsg(res.error ?? "Eval falló");
        return;
      }
      setResults(res.results);
      setTokenSummary({
        input: res.total_tokens.input,
        output: res.total_tokens.output,
        duration_ms: res.total_duration_ms,
      });
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>
            🧪 Evaluar — {TURN_TYPE_LABELS[base.turn_type] ?? base.turn_type} ·{" "}
            {PROMPT_TYPE_LABELS[base.prompt_type]} · {base.segmento} · {base.version}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Modelo:</span>
          <code className="rounded bg-muted px-1.5 py-0.5">{base.model}</code>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">temp {base.temperature ?? 0}</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">max {base.max_tokens ?? "?"}</span>
          <span className="text-muted-foreground ml-3">Samples reales del segmento:</span>
          <select
            value={sampleSegmento ?? ""}
            onChange={(e) =>
              setSampleSegmento((e.target.value || undefined) as Segmento | undefined)
            }
            disabled={loadingSamples || running}
            className="h-7 rounded border bg-background px-1.5 text-xs"
            title={
              base.segmento === "MEGA"
                ? "MEGA es fallback — elige qué segmento real probar"
                : "El segmento del prompt"
            }
          >
            {base.segmento === "MEGA" && <option value="">cualquiera</option>}
            {(["MEGA", "Genesis", "Prosperitas"] as Segmento[]).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            onClick={() => loadSamples(3)}
            disabled={loadingSamples || running}
          >
            3
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => loadSamples(5)}
            disabled={loadingSamples || running}
          >
            5
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => loadSamples(10)}
            disabled={loadingSamples || running}
          >
            10
          </Button>
          {loadingSamples && <span className="text-muted-foreground italic">Cargando...</span>}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowPromptEditor((v) => !v)}
            className="ml-auto"
          >
            {showPromptEditor ? "Ocultar" : "Editar"} prompt {promptChanged && "✏️"}
          </Button>
        </div>

        {showPromptEditor && (
          <div className="space-y-1">
            <Label className="text-xs">Prompt system (cambios solo se aplican a esta evaluación)</Label>
            <Textarea
              value={promptSystem}
              onChange={(e) => setPromptSystem(e.target.value)}
              className="min-h-[160px] font-mono text-[11px]"
              spellCheck={false}
            />
            {promptChanged && (
              <button
                type="button"
                onClick={() => setPromptSystem(base.prompt_system)}
                className="text-[11px] underline text-muted-foreground"
              >
                ↺ Restaurar prompt original
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 h-[480px]">
          <div className="flex flex-col h-full min-h-0 rounded-md border bg-muted/10">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                Test cases ({testCases.length})
              </h3>
              <Button size="sm" variant="ghost" onClick={addTestCase} disabled={running}>
                + Añadir
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {testCases.map((tc, i) => (
                <div key={tc.id} className="rounded border bg-card p-2 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <Input
                      value={tc.label ?? ""}
                      onChange={(e) => updateTestCase(tc.id, { label: e.target.value })}
                      placeholder={`Test ${i + 1}`}
                      className="h-7 text-xs flex-1"
                      disabled={running}
                    />
                    <button
                      type="button"
                      onClick={() => removeTestCase(tc.id)}
                      disabled={running || testCases.length === 1}
                      className="text-xs text-muted-foreground hover:text-red-600 disabled:opacity-30"
                      title="Eliminar test case"
                    >
                      ✕
                    </button>
                  </div>
                  <Textarea
                    value={tc.user_message}
                    onChange={(e) => updateTestCase(tc.id, { user_message: e.target.value })}
                    placeholder="User message que recibirá el prompt..."
                    className="min-h-[80px] text-[11px] font-mono"
                    spellCheck={false}
                    disabled={running}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col h-full min-h-0 rounded-md border bg-muted/10">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                Resultados ({results.length})
              </h3>
              {tokenSummary && (
                <span className="text-[10px] text-muted-foreground">
                  {tokenSummary.input + tokenSummary.output} tokens · {tokenSummary.duration_ms}ms
                </span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {results.length === 0 && !running && (
                <p className="text-xs text-muted-foreground italic text-center py-8">
                  Click "Run all" para ejecutar el prompt contra todos los test cases.
                  Los resultados aparecerán aquí.
                </p>
              )}
              {running && (
                <p className="text-xs text-muted-foreground italic text-center py-8">
                  Ejecutando {testCases.filter((tc) => tc.user_message.trim()).length} test cases
                  en paralelo...
                </p>
              )}
              {results.map((r) => (
                <EvalResultCard
                  key={r.test_case_id}
                  result={r}
                  promptType={base.prompt_type}
                  turnType={base.turn_type}
                />
              ))}
            </div>
          </div>
        </div>

        {errorMsg && (
          <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
            {errorMsg}
          </div>
        )}

        <DialogFooter>
          <div className="flex w-full items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              Eval no guarda nada ni modifica el prompt activo. Solo prueba.
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose} disabled={running}>
                Cerrar
              </Button>
              <Button onClick={runAll} disabled={running}>
                {running ? "Ejecutando..." : `▶ Run all (${testCases.filter((tc) => tc.user_message.trim()).length})`}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Saca de un JSON parseado el campo principal con el contenido del email
 * (turn_1, turn_2, follow_up_*, mensaje, respuesta, body...) si existe y
 * es un string lo bastante largo. Devuelve también el resto del JSON sin
 * ese campo, para mostrar la metadata abajo.
 */
function extractEmailBody(
  parsed: Record<string, unknown>,
  turnType: string
): { body: string | null; rest: Record<string, unknown> } {
  const candidates = [
    turnType, // ej "turn1" → mira "turn1"
    turnType.replace(/_generic$/, ""), // turn2_generic → turn2
    turnType.replace(/^turn(\d)$/, "turn_$1"), // turn1 → turn_1
    "turn_1",
    "turn_2",
    "turn_3",
    "follow_up_4h",
    "follow_up_24h",
    "follow_up_3d",
    "objection_response",
    "booking_propose",
    "respuesta",
    "mensaje",
    "body",
    "email",
    "content",
  ];
  for (const k of candidates) {
    const v = parsed[k];
    if (typeof v === "string" && v.trim().length > 30) {
      const rest = { ...parsed };
      delete rest[k];
      return { body: v, rest };
    }
  }
  return { body: null, rest: parsed };
}

function humanizeKey(k: string): string {
  const lower = k.replace(/_/g, " ");
  // Auto-cuestión para keys booleanas comunes
  if (/^(es|tiene|pidio|puede|hay|fue|debe|debería)\b/i.test(lower)) {
    return "¿" + lower.charAt(0).toUpperCase() + lower.slice(1) + "?";
  }
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function renderFieldValue(v: unknown): import("react").ReactNode {
  if (v === null || v === undefined || v === "") {
    return <span className="text-muted-foreground italic">—</span>;
  }
  if (typeof v === "boolean") {
    return v ? (
      <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
        ✓ Sí
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-800 dark:bg-red-900/40 dark:text-red-300">
        ✗ No
      </span>
    );
  }
  if (typeof v === "number") {
    return <span className="font-mono tabular-nums">{v}</span>;
  }
  if (typeof v === "string") {
    return (
      <span className="whitespace-pre-wrap break-words leading-relaxed">{v}</span>
    );
  }
  // arrays / objetos: pretty JSON
  return (
    <pre className="mt-0.5 rounded bg-muted/40 p-1.5 text-[10px] font-mono whitespace-pre-wrap leading-snug max-h-32 overflow-y-auto">
      {JSON.stringify(v, null, 2)}
    </pre>
  );
}

function StructuredFieldsView({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return <p className="text-[11px] italic text-muted-foreground">(JSON vacío)</p>;
  }
  return (
    <dl className="rounded border bg-emerald-50/30 divide-y dark:bg-emerald-950/10">
      {entries.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[160px_1fr] gap-3 px-3 py-1.5 text-[12px]">
          <dt className="text-muted-foreground font-medium">{humanizeKey(k)}</dt>
          <dd className="min-w-0">{renderFieldValue(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function EvalResultCard({
  result,
  promptType,
  turnType,
}: {
  result: EvalResult;
  promptType: PromptType;
  turnType: TurnType;
}) {
  const [showInput, setShowInput] = useState(false);
  const [showRest, setShowRest] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);
  const hasError = !!result.output_error;

  const extracted =
    !hasError && result.output_parsed && promptType !== "classifier"
      ? extractEmailBody(result.output_parsed, turnType)
      : null;
  const hasRenderedBody = !!extracted?.body;
  const restEntries = extracted ? Object.entries(extracted.rest) : [];

  return (
    <div
      className={cn(
        "rounded border p-2 space-y-1.5 text-xs",
        hasError ? "border-red-300 bg-red-50/50 dark:bg-red-950/20" : "bg-card"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold truncate" title={result.test_case_label}>
          {result.test_case_label ?? result.test_case_id.slice(0, 8)}
        </span>
        <span className="text-[10px] text-muted-foreground shrink-0">
          {result.duration_ms}ms
          {result.tokens && ` · ${result.tokens.input}+${result.tokens.output} tok`}
        </span>
      </div>
      <button
        type="button"
        onClick={() => setShowInput((v) => !v)}
        className="text-[10px] underline text-muted-foreground"
      >
        {showInput ? "Ocultar input" : "Ver input"}
      </button>
      {showInput && (
        <pre className="rounded bg-muted/40 p-1.5 text-[10px] font-mono whitespace-pre-wrap leading-snug max-h-32 overflow-y-auto">
          {result.test_case_input}
        </pre>
      )}

      {hasError ? (
        <pre className="rounded bg-red-100/60 p-1.5 text-[10px] font-mono whitespace-pre-wrap leading-snug text-red-800 dark:bg-red-950/40 dark:text-red-300">
          {result.output_error}
        </pre>
      ) : hasRenderedBody ? (
        <>
          <div className="rounded border bg-emerald-50/40 px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap dark:bg-emerald-950/20 dark:text-emerald-50">
            {extracted!.body}
          </div>
          {restEntries.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowRest((v) => !v)}
                className="text-[10px] underline text-muted-foreground"
              >
                {showRest ? "Ocultar metadata" : `Ver metadata (${restEntries.length})`}
              </button>
              {showRest && <StructuredFieldsView data={extracted!.rest} />}
            </>
          )}
        </>
      ) : result.output_parsed ? (
        <>
          <StructuredFieldsView data={result.output_parsed} />
          <button
            type="button"
            onClick={() => setShowRawJson((v) => !v)}
            className="text-[10px] underline text-muted-foreground"
          >
            {showRawJson ? "Ocultar JSON crudo" : "Ver JSON crudo"}
          </button>
          {showRawJson && (
            <pre className="rounded bg-muted/40 p-1.5 text-[10px] font-mono whitespace-pre-wrap leading-snug max-h-64 overflow-y-auto">
              {JSON.stringify(result.output_parsed, null, 2)}
            </pre>
          )}
        </>
      ) : (
        <pre className="rounded bg-muted/40 p-1.5 text-[11px] font-mono whitespace-pre-wrap leading-snug max-h-64 overflow-y-auto">
          {result.output_raw}
        </pre>
      )}
    </div>
  );
}

function CreateNewDialog({
  existingCombos,
  existingPrompts,
  onClose,
  onSave,
  busy,
}: {
  existingCombos: Set<string>;
  existingPrompts: PromptVersion[];
  onClose: () => void;
  onSave: (input: {
    prompt_type: PromptType;
    segmento: Segmento;
    turn_type: TurnType;
    prompt_system: string;
    description?: string;
    model?: string;
    temperature?: number;
    max_tokens?: number;
    setActive: boolean;
  }) => Promise<void>;
  busy: boolean;
}) {
  const [promptType, setPromptType] = useState<PromptType>("generator");
  const [segmento, setSegmento] = useState<Segmento>("Genesis");
  const [turnType, setTurnType] = useState<TurnType>("turn1");
  const [text, setText] = useState("");
  const [description, setDescription] = useState("");
  const [model, setModel] = useState<string>(DEFAULT_MODELS_BY_PROMPT_TYPE.generator);
  const [temperature, setTemperature] = useState<string>("0");
  const [maxTokens, setMaxTokens] = useState<string>(String(DEFAULT_MAX_TOKENS_BY_PROMPT_TYPE.generator));
  const [setActive, setSetActive] = useState(true);
  const [copyFrom, setCopyFrom] = useState<string>("");

  const isDuplicate = existingCombos.has(`${promptType}|${segmento}|${turnType}`);

  // Cuando el user cambia prompt_type, ajustar defaults de model + max_tokens
  function handlePromptTypeChange(t: PromptType) {
    setPromptType(t);
    setModel(DEFAULT_MODELS_BY_PROMPT_TYPE[t]);
    setMaxTokens(String(DEFAULT_MAX_TOKENS_BY_PROMPT_TYPE[t]));
    if (t === "validator") setTemperature("0");
  }

  function handleCopyFrom(id: string) {
    setCopyFrom(id);
    if (!id) return;
    const src = existingPrompts.find((p) => p.id === id);
    if (src) {
      setText(src.prompt_system);
      setModel(src.model);
      setTemperature(String(src.temperature ?? 0));
      setMaxTokens(String(src.max_tokens ?? DEFAULT_MAX_TOKENS_BY_PROMPT_TYPE[promptType]));
    }
  }

  // Sugerir prompts para copiar: misma combinación pero otro segmento (ej. MEGA → Genesis)
  const copyCandidates = existingPrompts.filter(
    (p) =>
      p.prompt_type === promptType &&
      p.turn_type === turnType &&
      p.segmento !== segmento
  );

  const canSave = text.trim().length > 0 && !isDuplicate;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>+ Crear prompt nuevo</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="ptype">Tipo de prompt</Label>
              <select
                id="ptype"
                value={promptType}
                onChange={(e) => handlePromptTypeChange(e.target.value as PromptType)}
                className="w-full h-9 rounded-md border bg-background px-2 text-sm"
              >
                {PROMPT_TYPE_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="seg">Segmento</Label>
              <select
                id="seg"
                value={segmento}
                onChange={(e) => setSegmento(e.target.value as Segmento)}
                className="w-full h-9 rounded-md border bg-background px-2 text-sm"
              >
                {SEGMENTO_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="tt">Turn type</Label>
              <select
                id="tt"
                value={turnType}
                onChange={(e) => setTurnType(e.target.value as TurnType)}
                className="w-full h-9 rounded-md border bg-background px-2 text-sm"
              >
                {TURN_TYPE_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {isDuplicate && (
            <div className="rounded-md border border-amber-300 bg-amber-50/70 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              Ya existe un prompt para esta combinación. Si quieres modificarlo, usa
              "Editar / nueva versión" en su card. Si lo guardas igualmente, se creará
              v1.X+1.
            </div>
          )}

          {copyCandidates.length > 0 && !text && (
            <div>
              <Label htmlFor="copyfrom">Copiar desde (opcional)</Label>
              <select
                id="copyfrom"
                value={copyFrom}
                onChange={(e) => handleCopyFrom(e.target.value)}
                className="w-full h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="">— ninguno (empezar en blanco) —</option>
                {copyCandidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.segmento} · {p.version} · {p.prompt_system.slice(0, 50)}…
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Útil para arrancar con un prompt similar (ej. copiar MEGA y adaptarlo a Genesis).
              </p>
            </div>
          )}

          <div>
            <Label htmlFor="text">Prompt system</Label>
            <Textarea
              id="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Eres un setter especializado de... Tu trabajo es..."
              className="font-mono text-xs leading-relaxed min-h-[300px]"
            />
            <div className="mt-1 text-[11px] text-muted-foreground">{text.length} chars</div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="model">Modelo</Label>
              <select
                id="model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="claude-haiku-4-5-20251001">claude-haiku-4-5</option>
                <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
                <option value="claude-opus-4-7">claude-opus-4-7</option>
              </select>
            </div>
            <div>
              <Label htmlFor="temp">Temperature</Label>
              <Input
                id="temp"
                type="number"
                step="0.1"
                min="0"
                max="1"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
              />
              {model.includes("opus") && (
                <p className="mt-0.5 text-[10px] text-amber-600">
                  Opus extended thinking ignora este parámetro.
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="maxt">Max tokens</Label>
              <Input
                id="maxt"
                type="number"
                step="256"
                min="256"
                max="16384"
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="desc">Descripción (opcional)</Label>
            <Input
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="ej: prompt inicial Genesis turn1, basado en MEGA con ajustes para tienda existente"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={setActive}
              onChange={(e) => setSetActive(e.target.checked)}
              className="h-4 w-4"
            />
            Activar inmediatamente (los workflows lo usarán en la próxima ejecución)
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button
            onClick={() =>
              onSave({
                prompt_type: promptType,
                segmento,
                turn_type: turnType,
                prompt_system: text,
                description: description || undefined,
                model,
                temperature: parseFloat(temperature) || 0,
                max_tokens: parseInt(maxTokens, 10) || 2048,
                setActive,
              })
            }
            disabled={busy || !canSave}
          >
            {busy ? "Guardando..." : "Crear prompt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SuggestionDialog({
  base,
  suggestion,
  onClose,
  onAccept,
  busy,
}: {
  base: PromptVersion;
  suggestion: SuggestPromptResponse | null;
  onClose: () => void;
  onAccept: () => void;
  busy: boolean;
}) {
  const loading = !suggestion;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            🤖 Sugerencia IA — {TURN_TYPE_LABELS[base.turn_type]} · {PROMPT_TYPE_LABELS[base.prompt_type]} · {base.segmento}
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Analizando ediciones y rechazos humanos recientes con Opus...
            <div className="text-xs mt-2">Suele tardar 15-30 segundos.</div>
          </div>
        )}

        {!loading && suggestion && !suggestion.ok && (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
            {suggestion.error ?? "Error desconocido"}
          </div>
        )}

        {!loading && suggestion && suggestion.ok && (
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/40 p-3 space-y-2">
              <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                <span>
                  Analizados:{" "}
                  <span className="font-medium text-foreground">
                    {suggestion.num_edits_analyzed} edits
                  </span>{" "}
                  ·{" "}
                  <span className="font-medium text-foreground">
                    {suggestion.num_rejects_analyzed} rejects
                  </span>
                </span>
                {suggestion.cost_tokens && (
                  <span>
                    · {suggestion.cost_tokens.input + suggestion.cost_tokens.output} tokens
                  </span>
                )}
              </div>
              {suggestion.summary && (
                <p className="text-sm font-medium">{suggestion.summary}</p>
              )}
              {suggestion.patterns_detected && suggestion.patterns_detected.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-semibold uppercase text-muted-foreground mb-1">
                    Patrones detectados
                  </h4>
                  <ul className="list-disc pl-5 text-xs space-y-0.5">
                    {suggestion.patterns_detected.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
              {suggestion.patterns_detected && suggestion.patterns_detected.length === 0 && (
                <p className="text-xs text-muted-foreground italic">
                  No se detectaron patrones suficientemente claros — sugerencia idéntica al actual.
                </p>
              )}
            </div>

            {suggestion.suggested_prompt &&
              suggestion.suggested_prompt !== suggestion.current_prompt && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <h4 className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                      Actual ({base.version}) — {(suggestion.current_prompt ?? "").length} chars
                    </h4>
                    <pre className="h-[400px] overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
                      {suggestion.current_prompt}
                    </pre>
                  </div>
                  <div>
                    <h4 className="mb-1 text-xs font-medium uppercase text-emerald-700 dark:text-emerald-400">
                      Propuesta IA — {(suggestion.suggested_prompt ?? "").length} chars
                    </h4>
                    <pre className="h-[400px] overflow-y-auto whitespace-pre-wrap rounded-md border border-emerald-300 bg-emerald-50/40 p-3 font-mono text-[11px] leading-relaxed dark:border-emerald-900/40 dark:bg-emerald-950/20">
                      {suggestion.suggested_prompt}
                    </pre>
                  </div>
                </div>
              )}
          </div>
        )}

        <DialogFooter className="items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground">
            Aceptar guarda como v{nextMinor(base.version)} y la activa.
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              {loading ? "Cancelar" : "Cerrar"}
            </Button>
            {!loading &&
              suggestion?.ok &&
              suggestion.suggested_prompt &&
              suggestion.suggested_prompt !== suggestion.current_prompt && (
                <Button onClick={onAccept} disabled={busy}>
                  {busy ? "Guardando..." : "Aceptar y activar"}
                </Button>
              )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function nextMinor(version: string): string {
  const m = /^v(\d+)\.(\d+)$/.exec(version);
  if (!m) return "vN+1";
  return `v${m[1]}.${Number(m[2]) + 1}`;
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

