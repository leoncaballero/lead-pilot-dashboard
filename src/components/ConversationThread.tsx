import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getSmartleadThread, stripEmailHtml, type SmartleadMessage, type SmartleadThread } from "@/api/smartlead.functions";
import { cn } from "@/lib/utils";

/**
 * Renderiza el hilo completo de la conversacion entre Consultoria.io y el lead.
 *
 * Fuente: Smartlead API (cold email + replies + nuestros sends).
 * Cache: la response del serverFn no se cachea explicitamente por nosotros, pero
 * react-router/tanstack-start mantiene el estado del componente abierto, asi que
 * abrir-cerrar-abrir el caso re-fetcha (esperado para mantener freshness).
 */
export function ConversationThread({
  smartleadLeadId,
}: {
  smartleadLeadId: string | number | null | undefined;
}) {
  const fetchFn = useServerFn(getSmartleadThread);
  const [thread, setThread] = useState<SmartleadThread | null>(null);
  const [loading, setLoading] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    if (!smartleadLeadId) {
      setThread(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchFn({ data: { smartlead_lead_id: smartleadLeadId } })
      .then((res) => {
        if (!cancelled) setThread(res);
      })
      .catch((err) => {
        if (!cancelled) {
          setThread({
            ok: false,
            campaign_id: null,
            campaign_name: null,
            lead_email: null,
            messages: [],
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [smartleadLeadId, fetchFn]);

  if (!smartleadLeadId) {
    return (
      <div className="rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
        Sin smartlead_lead_id — no podemos cargar el hilo.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-md border bg-card p-3 text-xs text-muted-foreground">
        Cargando conversación de Smartlead…
      </div>
    );
  }

  if (!thread) return null;

  if (!thread.ok) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
        No pude cargar el hilo de Smartlead: {thread.error ?? "error desconocido"}
      </div>
    );
  }

  if (thread.messages.length === 0) {
    return (
      <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        Sin mensajes en Smartlead para este lead.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {thread.messages.length} mensaje{thread.messages.length === 1 ? "" : "s"}
          {thread.campaign_name && ` · campaign ${thread.campaign_name}`}
        </p>
        <button
          type="button"
          onClick={() => setShowRaw((v) => !v)}
          className="text-[11px] underline text-muted-foreground hover:text-foreground"
        >
          {showRaw ? "Ver limpio" : "Ver con HTML"}
        </button>
      </div>
      <ol className="space-y-3">
        {thread.messages.map((m, i) => (
          <MessageBubble key={m.message_id ?? `${i}-${m.time}`} m={m} showRaw={showRaw} />
        ))}
      </ol>
    </div>
  );
}

function MessageBubble({ m, showRaw }: { m: SmartleadMessage; showRaw: boolean }) {
  const isFromUs = m.type === "SENT";
  const text = m.email_body ?? "";
  const cleaned = showRaw ? text : stripEmailHtml(text);
  return (
    <li
      className={cn(
        "rounded-lg border p-3",
        isFromUs
          ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/40 dark:bg-emerald-950/20"
          : "border-blue-200 bg-blue-50/50 dark:border-blue-900/40 dark:bg-blue-950/20"
      )}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 font-medium uppercase",
            isFromUs
              ? "bg-emerald-600 text-white"
              : "bg-blue-600 text-white"
          )}
        >
          {isFromUs ? "→ enviado" : "← reply"}
        </span>
        {typeof m.email_seq_number === "number" && m.email_seq_number > 0 && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
            seq #{m.email_seq_number}
          </span>
        )}
        <span className="text-muted-foreground">
          {m.from && <span className="font-medium">{trimEmail(m.from)}</span>}
          {" → "}
          {m.to && <span>{trimEmail(m.to)}</span>}
        </span>
        <span className="text-muted-foreground ml-auto">{formatMsgTime(m.time)}</span>
      </div>
      {m.subject && (
        <p className="mb-1 text-sm font-medium">{m.subject}</p>
      )}
      {showRaw ? (
        <div
          className="prose prose-sm dark:prose-invert max-w-none rounded bg-background/60 p-2 text-sm"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: text }}
        />
      ) : (
        <pre className="whitespace-pre-wrap rounded bg-background/60 p-2 font-sans text-sm leading-relaxed">
          {cleaned}
        </pre>
      )}
    </li>
  );
}

function trimEmail(s: string | null): string {
  if (!s) return "";
  // "John Doe <john@example.com>" → "john@example.com"; or just "john@example.com"
  const m = /<([^>]+)>/.exec(s);
  return m ? m[1] : s;
}

function formatMsgTime(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
