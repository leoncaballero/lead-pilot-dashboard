import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getSmartleadThread,
  stripEmailHtml,
  stripQuotedReply,
  type SmartleadMessage,
  type SmartleadThread,
} from "@/api/smartlead.functions";
import { cn } from "@/lib/utils";

/**
 * Forma del snapshot que guarda WF02 v2 en pipeline.thread_snapshot:
 * [{ type, seq, time, subject, body_text }]
 *
 * Cuando se le pasa como prop, ConversationThread renderiza desde aquí sin
 * llamar a Smartlead (0 latencia, datos sellados en el momento de la ingesta).
 */
export type ThreadSnapshotMessage = {
  type?: string;
  seq?: number | null;
  time?: string | null;
  subject?: string | null;
  body_text?: string;
};

/**
 * Renderiza el hilo de la conversación.
 *
 * Estrategia de datos (en orden de preferencia):
 *  1. snapshot prop (datos del pipeline row, instantáneo)
 *  2. fallback a Smartlead live fetch (cold email + replies + sends)
 *
 * Modo compacto (defaultCompact=true): muestra solo el ultimo REPLY del lead
 * + el ultimo SENT nuestro. Para Triage donde el SDR necesita decidir rapido
 * sin perderse en histórico antiguo. Toggle para expandir al hilo completo.
 */
export function ConversationThread({
  smartleadLeadId,
  campaignId,
  snapshot,
  leadEmail,
  defaultCompact = false,
}: {
  smartleadLeadId: string | number | null | undefined;
  /** campaign_id guardado en el pipeline row. Si lo pasamos, evitamos la
   *  ambigüedad cuando el lead está en varias campañas Smartlead. */
  campaignId?: string | number | null;
  snapshot?: ThreadSnapshotMessage[] | null;
  leadEmail?: string | null;
  defaultCompact?: boolean;
}) {
  const fetchFn = useServerFn(getSmartleadThread);
  const [thread, setThread] = useState<SmartleadThread | null>(null);
  const [loading, setLoading] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [compact, setCompact] = useState(defaultCompact);
  const hasSnapshot = Array.isArray(snapshot) && snapshot.length > 0;

  useEffect(() => {
    // Si tenemos snapshot, construimos el thread localmente — sin red.
    if (hasSnapshot) {
      const messages: SmartleadMessage[] = (snapshot ?? []).map((s) => ({
        type: (s.type as "SENT" | "REPLY") ?? "SENT",
        time: s.time ?? null,
        subject: s.subject ?? null,
        email_seq_number: s.seq ?? null,
        // body_text del snapshot ya viene plain-text (HTML stripped en ingesta).
        // Lo metemos como email_body para que MessageBubble lo trate igual.
        // stripEmailHtml es no-op sobre texto plano.
        email_body: s.body_text ?? "",
        message_id: null,
        from: null,
        to: leadEmail ?? null,
      } as SmartleadMessage));
      // Ordenar por time desc (Smartlead las devuelve así)
      messages.sort((a, b) => {
        const ta = a.time ? Date.parse(a.time) : 0;
        const tb = b.time ? Date.parse(b.time) : 0;
        return tb - ta;
      });
      setThread({
        ok: true,
        campaign_id: null,
        campaign_name: null,
        lead_email: leadEmail ?? null,
        messages,
      });
      setLoading(false);
      return;
    }

    // Fallback: si no hay snapshot, fetch a Smartlead
    if (!smartleadLeadId) {
      setThread(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchFn({ data: { smartlead_lead_id: smartleadLeadId, campaign_id: campaignId ?? null } })
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
  }, [smartleadLeadId, campaignId, fetchFn, hasSnapshot, snapshot, leadEmail]);

  if (!smartleadLeadId && !hasSnapshot) {
    return (
      <div className="rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
        Sin smartlead_lead_id y sin snapshot — no podemos cargar el hilo.
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

  // En modo compacto: ultimo REPLY + ultimo SENT (los mensajes ya vienen DESC).
  // El primer item es siempre el mas reciente (cualquiera que sea su type),
  // luego buscamos el primero del tipo opuesto.
  const visibleMessages = (() => {
    if (!compact) return thread.messages;
    const head = thread.messages[0];
    if (!head) return [];
    const opposite = thread.messages.find((m) => m.type !== head.type);
    return opposite ? [head, opposite] : [head];
  })();
  const hiddenCount = thread.messages.length - visibleMessages.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-muted-foreground">
          {compact ? (
            <>
              Mostrando últimos {visibleMessages.length} de {thread.messages.length}
            </>
          ) : (
            <>
              {thread.messages.length} mensaje{thread.messages.length === 1 ? "" : "s"}
            </>
          )}
          {thread.campaign_name && ` · campaign ${thread.campaign_name}`}
        </p>
        <div className="flex items-center gap-3">
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setCompact(false)}
              className="text-[11px] underline text-muted-foreground hover:text-foreground"
            >
              Ver hilo completo (+{hiddenCount})
            </button>
          )}
          {!compact && thread.messages.length > 2 && (
            <button
              type="button"
              onClick={() => setCompact(true)}
              className="text-[11px] underline text-muted-foreground hover:text-foreground"
            >
              Compactar
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="text-[11px] underline text-muted-foreground hover:text-foreground"
          >
            {showRaw ? "Ver limpio" : "Ver con HTML"}
          </button>
        </div>
      </div>
      <ol className="space-y-3">
        {visibleMessages.map((m, i) => (
          <MessageBubble key={m.message_id ?? `${i}-${m.time}`} m={m} showRaw={showRaw} />
        ))}
      </ol>
    </div>
  );
}

function MessageBubble({ m, showRaw }: { m: SmartleadMessage; showRaw: boolean }) {
  const isFromUs = m.type === "SENT";
  const text = m.email_body ?? "";
  const baseCleaned = showRaw ? text : stripEmailHtml(text);
  const [showQuoted, setShowQuoted] = useState(false);
  // Solo aplicamos el stripping del citado a REPLIES no-raw
  const replyStripped = !isFromUs && !showRaw ? stripQuotedReply(baseCleaned) : baseCleaned;
  const hasHiddenQuote = !isFromUs && !showRaw && replyStripped !== baseCleaned;
  const displayed = !isFromUs && !showRaw && !showQuoted ? replyStripped : baseCleaned;
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
        <>
          <pre className="whitespace-pre-wrap rounded bg-background/60 p-2 font-sans text-sm leading-relaxed">
            {displayed}
          </pre>
          {hasHiddenQuote && (
            <button
              type="button"
              onClick={() => setShowQuoted((v) => !v)}
              className="mt-1 text-[11px] underline text-muted-foreground hover:text-foreground"
            >
              {showQuoted ? "Ocultar texto citado" : "Mostrar texto citado"}
            </button>
          )}
        </>
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
