import { createFileRoute, ErrorComponent, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
  listTrainingSessions,
  createTrainingSession,
  deleteTrainingSession,
  renameTrainingSession,
  getTrainingSession,
  appendTrainingMessage,
  synthesizePromptFromTraining,
  type TrainingSession,
  type TrainingMessage,
  type TrainingAttachment,
  type PromptType,
  type Segmento,
  type TurnType,
} from "@/api/training.functions";
import { createPromptVersion } from "@/api/prompts.functions";

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

const PROMPT_TYPES: PromptType[] = ["classifier", "generator", "validator"];
const SEGMENTS: Segmento[] = ["MEGA", "Genesis", "Prosperitas"];
const TURN_TYPES: TurnType[] = [
  "turn1",
  "turn2_generic",
  "turn3_generic",
  "follow_up_4h",
  "follow_up_24h",
  "follow_up_3d",
  "objection_response",
  "booking_propose",
];

export const Route = createFileRoute("/_authenticated/training")({
  loader: async () => await listTrainingSessions(),
  staleTime: 5_000,
  pendingComponent: TrainingPending,
  errorComponent: ({ error }) => {
    const router = useRouter();
    return (
      <div className="space-y-4 p-4">
        <h1 className="text-2xl font-semibold">AI Coach</h1>
        <ErrorComponent error={error} />
        <button className="text-sm underline" onClick={() => router.invalidate()}>
          Reintentar
        </button>
      </div>
    );
  },
  component: TrainingPage,
});

function TrainingPending() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">AI Coach</h1>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

function TrainingPage() {
  const data = Route.useLoaderData();
  const router = useRouter();

  const [selectedId, setSelectedId] = useState<string | null>(
    data.sessions[0]?.id ?? null
  );
  const [creating, setCreating] = useState(false);
  const [filterSegment, setFilterSegment] = useState<Segmento | "all">("all");
  const [filterType, setFilterType] = useState<PromptType | "all">("all");

  const filtered = useMemo(() => {
    return data.sessions.filter((s) => {
      if (filterSegment !== "all" && s.segmento !== filterSegment) return false;
      if (filterType !== "all" && s.prompt_type !== filterType) return false;
      return true;
    });
  }, [data.sessions, filterSegment, filterType]);

  useEffect(() => {
    // Si el seleccionado se filtró fuera, reseleccionar el primero visible
    if (selectedId && !filtered.find((s) => s.id === selectedId)) {
      setSelectedId(filtered[0]?.id ?? null);
    }
  }, [filtered, selectedId]);

  if (data.needs_migration) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">AI Coach</h1>
        <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-6 space-y-3 dark:border-amber-800 dark:bg-amber-950/30">
          <h2 className="text-base font-semibold text-amber-900 dark:text-amber-200">
            ⚠️ Migración SQL pendiente
          </h2>
          <p className="text-sm text-amber-900/80 dark:text-amber-200/80">
            La tabla <code className="text-xs">cl001_p007_training_sessions</code> no existe.
            Ejecuta en Supabase OUTBOUND:
          </p>
          <code className="block rounded bg-amber-100 dark:bg-amber-900/40 p-2 text-xs">
            outbound-migrations/20260511_001_training_sessions.sql
          </code>
          <button
            type="button"
            onClick={() => router.invalidate()}
            className="text-sm underline text-amber-900 hover:text-amber-700 dark:text-amber-200"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-6rem)] gap-3">
      {/* Sidebar de sesiones */}
      <aside className="w-72 shrink-0 rounded-lg border bg-card overflow-hidden flex flex-col">
        <div className="p-3 border-b space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-sm">Sesiones</h2>
            <Button size="sm" onClick={() => setCreating(true)}>
              + Nueva
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <select
              value={filterSegment}
              onChange={(e) => setFilterSegment(e.target.value as Segmento | "all")}
              className="h-7 rounded border bg-background px-1.5 text-[11px]"
            >
              <option value="all">Todos los segmentos</option>
              {SEGMENTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as PromptType | "all")}
              className="h-7 rounded border bg-background px-1.5 text-[11px]"
            >
              <option value="all">Todos los tipos</option>
              {PROMPT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PROMPT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-4 text-xs text-muted-foreground text-center">
              {data.sessions.length === 0
                ? 'Crea tu primera sesión para empezar a entrenar a la IA con ejemplos y feedback.'
                : "Ninguna sesión con esos filtros."}
            </div>
          ) : (
            <ul className="divide-y">
              {filtered.map((s) => (
                <SessionItem
                  key={s.id}
                  s={s}
                  active={s.id === selectedId}
                  onSelect={() => setSelectedId(s.id)}
                />
              ))}
            </ul>
          )}
        </div>
        <div className="border-t p-2 text-[10px] text-muted-foreground">
          {data.sessions.length} sesion{data.sessions.length === 1 ? "" : "es"} totales
        </div>
      </aside>

      {/* Chat principal */}
      <main className="flex-1 min-w-0 rounded-lg border bg-card overflow-hidden flex flex-col">
        {selectedId ? (
          <ChatPanel sessionId={selectedId} key={selectedId} onChanged={() => router.invalidate()} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Selecciona una sesión o crea una nueva.
          </div>
        )}
      </main>

      {creating && (
        <CreateSessionDialog
          onClose={() => setCreating(false)}
          onCreated={async (id) => {
            setCreating(false);
            await router.invalidate();
            setSelectedId(id);
          }}
        />
      )}
    </div>
  );
}

function SessionItem({
  s,
  active,
  onSelect,
}: {
  s: TrainingSession;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <li
      className={cn(
        "px-3 py-2 cursor-pointer transition-colors",
        active ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-accent/40"
      )}
      onClick={onSelect}
    >
      <div className="flex items-center gap-1.5 flex-wrap mb-1">
        <Badge variant="secondary" className="h-4 px-1 text-[9px]">
          {TURN_TYPE_LABELS[s.turn_type as TurnType] ?? s.turn_type}
        </Badge>
        <Badge variant="outline" className="h-4 px-1 text-[9px]">
          {PROMPT_TYPE_LABELS[s.prompt_type]}
        </Badge>
        <Badge variant="outline" className="h-4 px-1 text-[9px]">
          {s.segmento}
        </Badge>
      </div>
      <p className="text-sm font-medium truncate">{s.title}</p>
      <div className="flex items-center justify-between mt-0.5 text-[10px] text-muted-foreground">
        <span>{s.messages.length} mensajes</span>
        <span>{formatRel(s.updated_at)}</span>
      </div>
    </li>
  );
}

function ChatPanel({
  sessionId,
  onChanged,
}: {
  sessionId: string;
  onChanged: () => void;
}) {
  const fetchFn = useServerFn(getTrainingSession);
  const appendFn = useServerFn(appendTrainingMessage);
  const synthFn = useServerFn(synthesizePromptFromTraining);
  const createPromptFn = useServerFn(createPromptVersion);
  const deleteFn = useServerFn(deleteTrainingSession);
  const renameFn = useServerFn(renameTrainingSession);

  const [session, setSession] = useState<TrainingSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<TrainingAttachment[]>([]);
  const [thinking, setThinking] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [synth, setSynth] = useState<{
    proposed_prompt: string;
    proposed_description: string;
    reasoning: string;
  } | null>(null);
  const [synthing, setSynthing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorMsg(null);
    fetchFn({ data: { id: sessionId } })
      .then((s) => {
        if (!cancelled) setSession(s);
      })
      .catch((e) => {
        if (!cancelled)
          setErrorMsg(e instanceof Error ? e.message : "Error cargando sesión");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [sessionId, fetchFn]);

  useEffect(() => {
    // Scroll al final cuando aparezcan mensajes nuevos
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [session?.messages.length, thinking]);

  async function handleSend() {
    if (!session) return;
    if (!input.trim() && attachments.length === 0) return;
    setThinking(true);
    setErrorMsg(null);
    try {
      const res = await appendFn({
        data: {
          session_id: session.id,
          content: input.trim(),
          attachments: attachments.length > 0 ? attachments : undefined,
        },
      });
      if (!res.ok) {
        setErrorMsg(res.error ?? "Error desconocido");
      } else if (res.session) {
        setSession(res.session);
        setInput("");
        setAttachments([]);
        onChanged();
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      setThinking(false);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    const added: TrainingAttachment[] = [];
    for (const f of Array.from(files)) {
      if (f.type.startsWith("image/")) {
        const data = await readAsBase64(f);
        const media = (["image/png", "image/jpeg", "image/gif", "image/webp"].includes(f.type)
          ? f.type
          : "image/png") as "image/png" | "image/jpeg" | "image/gif" | "image/webp";
        added.push({ type: "image", media_type: media, data_base64: data, filename: f.name });
      } else if (f.type === "text/plain" || f.name.endsWith(".md") || f.name.endsWith(".txt")) {
        const text = await f.text();
        added.push({ type: "text", filename: f.name, content: text.slice(0, 50_000) });
      } else {
        setErrorMsg(`Tipo no soportado: ${f.type || f.name}. Soportado: imágenes (.png/.jpg/.gif/.webp) y texto plano.`);
      }
    }
    if (added.length > 0) setAttachments((prev) => [...prev, ...added]);
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData.items;
    const files: File[] = [];
    for (const it of Array.from(items)) {
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      const dt = new DataTransfer();
      files.forEach((f) => dt.items.add(f));
      handleFiles(dt.files);
    }
  }

  async function handleSynthesize() {
    if (!session) return;
    setSynthing(true);
    setErrorMsg(null);
    try {
      const res = await synthFn({ data: { session_id: session.id } });
      if (!res.ok || !res.proposed_prompt) {
        setErrorMsg(res.error ?? "Síntesis falló");
      } else {
        setSynth({
          proposed_prompt: res.proposed_prompt,
          proposed_description: res.proposed_description ?? "",
          reasoning: res.reasoning ?? "",
        });
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      setSynthing(false);
    }
  }

  async function handleSaveSynth(setActive: boolean) {
    if (!session || !synth) return;
    try {
      await createPromptFn({
        data: {
          prompt_type: session.prompt_type,
          segmento: session.segmento,
          turn_type: session.turn_type,
          prompt_system: synth.proposed_prompt,
          description: `AI Coach · ${synth.proposed_description}`.slice(0, 240),
          setActive,
        },
      });
      setSynth(null);
      onChanged();
      // Mensaje feedback en el chat
      setSession((prev) =>
        prev
          ? {
              ...prev,
              messages: [
                ...prev.messages,
                {
                  role: "assistant",
                  content: `✅ Nueva versión del prompt creada${
                    setActive ? " y activada" : " (no activada)"
                  }. Puedes revisarla en /prompts.`,
                  ts: new Date().toISOString(),
                },
              ],
            }
          : prev
      );
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Error guardando prompt");
    }
  }

  async function handleDeleteSession() {
    if (!session) return;
    const ok = confirm(`Borrar la sesión "${session.title}"? Esta acción es definitiva.`);
    if (!ok) return;
    await deleteFn({ data: { id: session.id } });
    onChanged();
  }

  async function handleRename() {
    if (!session || !renameValue.trim()) {
      setRenaming(false);
      return;
    }
    await renameFn({ data: { id: session.id, title: renameValue.trim() } });
    setSession((s) => (s ? { ...s, title: renameValue.trim() } : s));
    setRenaming(false);
    onChanged();
  }

  if (loading) {
    return (
      <div className="p-4 space-y-2">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="p-4 text-sm text-muted-foreground">Sesión no encontrada.</div>
    );
  }

  return (
    <>
      {/* Header */}
      <header className="border-b px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <div className="flex items-center gap-2">
              <Input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRename()}
                className="h-7 text-sm"
                autoFocus
              />
              <Button size="sm" onClick={handleRename}>
                ✓
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRenaming(false)}>
                ✕
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-semibold truncate">{session.title}</h2>
              <button
                type="button"
                onClick={() => {
                  setRenameValue(session.title);
                  setRenaming(true);
                }}
                className="text-[11px] text-muted-foreground hover:text-foreground underline"
              >
                renombrar
              </button>
            </div>
          )}
          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
            <Badge variant="secondary" className="h-4 px-1 text-[9px]">
              {TURN_TYPE_LABELS[session.turn_type] ?? session.turn_type}
            </Badge>
            <Badge variant="outline" className="h-4 px-1 text-[9px]">
              {PROMPT_TYPE_LABELS[session.prompt_type]}
            </Badge>
            <Badge variant="outline" className="h-4 px-1 text-[9px]">
              {session.segmento}
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              {session.total_input_tokens + session.total_output_tokens} tokens usados
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="default"
            onClick={handleSynthesize}
            disabled={synthing || session.messages.length === 0}
            title="Sintetiza la conversación en una nueva versión del prompt"
          >
            {synthing ? "Sintetizando…" : "🪄 Sintetizar nueva versión"}
          </Button>
          <button
            type="button"
            onClick={handleDeleteSession}
            className="text-xs text-muted-foreground hover:text-red-600"
            title="Borrar sesión"
          >
            🗑
          </button>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollerRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {session.messages.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-8 space-y-2">
            <p>💬 Conversación vacía</p>
            <p className="text-xs">
              Manda un mensaje, sube una imagen o pega una captura para empezar a nutrir
              al coach. Usará el prompt activo de esta combinación como contexto.
            </p>
          </div>
        )}
        {session.messages.map((m, i) => (
          <MessageBubble key={i} m={m} />
        ))}
        {thinking && (
          <div className="rounded-md bg-emerald-100/40 px-3 py-2 mr-12 text-sm italic text-muted-foreground dark:bg-emerald-950/20">
            Coach pensando…
          </div>
        )}
        {errorMsg && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
            {errorMsg}
          </div>
        )}
      </div>

      {/* Composer */}
      <footer className="border-t p-3 space-y-2">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((a, i) => (
              <AttachmentChip
                key={i}
                a={a}
                onRemove={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
              />
            ))}
          </div>
        )}
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          onPaste={handlePaste}
          placeholder='Escribe feedback, pega una captura, sube ejemplos… ⌘+Enter para enviar'
          className="min-h-[80px] text-sm"
          disabled={thinking}
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,text/plain,.md,.txt"
              multiple
              className="hidden"
              onChange={(e) => {
                handleFiles(e.target.files);
                if (fileRef.current) fileRef.current.value = "";
              }}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={thinking}
            >
              📎 Adjuntar
            </Button>
            <span className="text-[10px] text-muted-foreground">
              imágenes (png/jpg/gif/webp) + texto plano
            </span>
          </div>
          <Button onClick={handleSend} disabled={thinking || (!input.trim() && attachments.length === 0)}>
            Enviar
          </Button>
        </div>
      </footer>

      {synth && session && (
        <SynthDialog
          synth={synth}
          session={session}
          onClose={() => setSynth(null)}
          onSave={handleSaveSynth}
        />
      )}
    </>
  );
}

function MessageBubble({ m }: { m: TrainingMessage }) {
  const isUser = m.role === "user";
  return (
    <div
      className={cn(
        "rounded-md px-3 py-2 text-sm whitespace-pre-wrap",
        isUser
          ? "bg-blue-50 ml-12 dark:bg-blue-950/20"
          : "bg-emerald-50/60 mr-12 dark:bg-emerald-950/20"
      )}
    >
      <div className="flex items-center justify-between text-[10px] uppercase font-semibold opacity-70 mb-1">
        <span>{isUser ? "Tú" : "Coach"}</span>
        <span className="font-normal">{formatRel(m.ts)}</span>
      </div>
      {m.attachments && m.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {m.attachments.map((a, i) => (
            <AttachmentChip key={i} a={a} />
          ))}
        </div>
      )}
      <div className="leading-relaxed">{m.content}</div>
    </div>
  );
}

function AttachmentChip({
  a,
  onRemove,
}: {
  a: TrainingAttachment;
  onRemove?: () => void;
}) {
  if (a.type === "image") {
    return (
      <div className="relative">
        <img
          src={`data:${a.media_type};base64,${a.data_base64}`}
          alt={a.filename ?? "img"}
          className="h-20 rounded border object-cover"
        />
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="absolute -top-1.5 -right-1.5 rounded-full bg-background border w-5 h-5 text-[10px] flex items-center justify-center hover:bg-red-100"
            title="Quitar"
          >
            ✕
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="relative inline-flex items-center gap-1.5 rounded border bg-background px-2 py-1 text-[11px] max-w-xs">
      <span>📄</span>
      <span className="truncate">{a.filename}</span>
      <span className="text-muted-foreground">({a.content.length}c)</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-1 text-muted-foreground hover:text-red-600"
        >
          ✕
        </button>
      )}
    </div>
  );
}

function CreateSessionDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const createFn = useServerFn(createTrainingSession);
  const [title, setTitle] = useState("");
  const [promptType, setPromptType] = useState<PromptType>("generator");
  const [segmento, setSegmento] = useState<Segmento>("MEGA");
  const [turnType, setTurnType] = useState<TurnType>("turn1");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleCreate() {
    if (!title.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await createFn({
        data: {
          title: title.trim(),
          prompt_type: promptType,
          segmento,
          turn_type: turnType,
        },
      });
      onCreated(res.session.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error creando sesión");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nueva sesión de entrenamiento</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="title">Título</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej: Generador Genesis · más cercano y menos formal"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Tipo</Label>
              <select
                value={promptType}
                onChange={(e) => setPromptType(e.target.value as PromptType)}
                className="w-full h-9 rounded border bg-background px-2 text-sm"
              >
                {PROMPT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PROMPT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">Segmento</Label>
              <select
                value={segmento}
                onChange={(e) => setSegmento(e.target.value as Segmento)}
                className="w-full h-9 rounded border bg-background px-2 text-sm"
              >
                {SEGMENTS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">Turn</Label>
              <select
                value={turnType}
                onChange={(e) => setTurnType(e.target.value as TurnType)}
                className="w-full h-9 rounded border bg-background px-2 text-sm"
              >
                {TURN_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TURN_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {err && (
            <p className="text-xs text-red-700 dark:text-red-300">{err}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={handleCreate} disabled={busy || !title.trim()}>
            {busy ? "Creando…" : "Crear y empezar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SynthDialog({
  synth,
  session,
  onClose,
  onSave,
}: {
  synth: { proposed_prompt: string; proposed_description: string; reasoning: string };
  session: TrainingSession;
  onClose: () => void;
  onSave: (setActive: boolean) => Promise<void>;
}) {
  const [editedPrompt, setEditedPrompt] = useState(synth.proposed_prompt);
  const [busy, setBusy] = useState(false);

  async function save(setActive: boolean) {
    setBusy(true);
    try {
      await onSave(setActive);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            🪄 Síntesis de nueva versión —{" "}
            {PROMPT_TYPE_LABELS[session.prompt_type]} · {session.segmento} ·{" "}
            {TURN_TYPE_LABELS[session.turn_type]}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded border bg-muted/30 p-3 text-sm">
            <div className="text-[10px] uppercase font-semibold text-muted-foreground mb-1">
              Razonamiento
            </div>
            <p className="whitespace-pre-wrap">{synth.reasoning}</p>
          </div>
          <div className="rounded border bg-blue-50/40 p-3 text-sm dark:bg-blue-950/20">
            <div className="text-[10px] uppercase font-semibold text-muted-foreground mb-1">
              Descripción
            </div>
            <p>{synth.proposed_description}</p>
          </div>
          <div>
            <Label className="text-xs">Prompt propuesto (editable antes de guardar)</Label>
            <Textarea
              value={editedPrompt}
              onChange={(e) => setEditedPrompt(e.target.value)}
              className="font-mono text-[11px] min-h-[300px] max-h-[50vh]"
              spellCheck={false}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              {editedPrompt.length} chars
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="outline" onClick={() => save(false)} disabled={busy}>
            Guardar sin activar
          </Button>
          <Button onClick={() => save(true)} disabled={busy}>
            {busy ? "Guardando…" : "Guardar y activar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const result = r.result as string;
      // strip data:...;base64, prefix
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function formatRel(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "ahora";
  if (diff < 3600) return `${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} d`;
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}
