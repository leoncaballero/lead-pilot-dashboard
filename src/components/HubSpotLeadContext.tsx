import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getHubSpotLeadContext,
  type HubSpotLeadContext,
} from "@/api/hubspot.functions";

/**
 * Tarjeta compacta con el contexto del lead en HubSpot. Ayuda al SDR a decidir
 * si tiene sentido avanzar y de qué forma:
 * - Empresa asociada (info esencial para registrar el caso)
 * - Si tiene reunión futura programada → NO enviar FU 4h
 * - Última llamada → contexto del SDR si ya hubo contacto
 * - Web del lead → contexto extra de relevancia
 */
export function HubSpotLeadContextCard({
  hubspotContactId,
}: {
  hubspotContactId: string | number | null | undefined;
}) {
  const fetchFn = useServerFn(getHubSpotLeadContext);
  const [data, setData] = useState<HubSpotLeadContext | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!hubspotContactId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchFn({ data: { hubspot_contact_id: hubspotContactId } })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) {
          setData({
            ok: false,
            contact: null,
            company: null,
            lastMeeting: null,
            upcomingMeeting: null,
            recentCalls: [],
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
  }, [hubspotContactId, fetchFn]);

  if (!hubspotContactId) {
    return (
      <div className="rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
        Sin hubspot_contact_id — no podemos cargar el contexto.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-md border bg-card p-3 text-xs text-muted-foreground">
        Cargando datos de HubSpot…
      </div>
    );
  }

  if (!data) return null;

  if (!data.ok) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
        No pude cargar HubSpot: {data.error ?? "error desconocido"}
      </div>
    );
  }

  const { contact, company, lastMeeting, upcomingMeeting, recentCalls } = data;

  return (
    <div className="rounded-md border bg-card p-3 text-xs space-y-2.5">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-semibold uppercase text-muted-foreground">
          Contexto HubSpot
        </h4>
        <a
          href={`https://app-eu1.hubspot.com/contacts/${
            contact?.id ? "" : ""
          }contact/${contact?.id ?? hubspotContactId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-muted-foreground underline hover:text-foreground"
        >
          Abrir en HubSpot ↗
        </a>
      </div>

      {/* Aviso destacado: reunión próxima — el sistema NO debería enviar FU */}
      {upcomingMeeting && (
        <div className="rounded border border-emerald-300 bg-emerald-50/60 p-2 dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <p className="font-semibold text-emerald-700 dark:text-emerald-300">
            🗓 Reunión programada {formatDateTime(upcomingMeeting.hs_meeting_start_time)}
          </p>
          {upcomingMeeting.hs_meeting_title && (
            <p className="text-muted-foreground">{upcomingMeeting.hs_meeting_title}</p>
          )}
          <p className="mt-0.5 text-[10px] text-emerald-700/80 dark:text-emerald-400/80">
            Si llega FU 4h, conviene saltarlo manualmente — ya hay engagement.
          </p>
        </div>
      )}

      {/* Lead datos */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <KV label="Lifecycle" value={contact?.lifecyclestage} />
        <KV label="Estado" value={contact?.hs_lead_status} />
        <KV label="Segmento" value={contact?.gtm__avatar_segment} />
        <KV label="Cargo" value={contact?.jobtitle} />
        {contact?.website && (
          <div className="col-span-2">
            <span className="text-muted-foreground">Web:</span>{" "}
            <a
              href={ensureProtocol(contact.website)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline hover:text-foreground"
            >
              {trimUrl(contact.website)} ↗
            </a>
          </div>
        )}
        {contact?.phone && (
          <div className="col-span-2">
            <span className="text-muted-foreground">Tel:</span>{" "}
            <span className="font-medium">{contact.phone}</span>
          </div>
        )}
      </div>

      {/* Empresa */}
      {company && (company.name || company.domain) && (
        <div className="border-t pt-2">
          <h5 className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
            Empresa
          </h5>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <div className="col-span-2 font-medium">
              {company.name ?? "—"}
              {company.domain && (
                <a
                  href={ensureProtocol(company.domain)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-1.5 text-muted-foreground underline hover:text-foreground text-[10px]"
                >
                  {company.domain} ↗
                </a>
              )}
            </div>
            <KV label="Industria" value={company.industry} />
            <KV label="Empleados" value={company.numberofemployees} />
            <KV label="País" value={company.country} />
          </div>
        </div>
      )}

      {/* Última reunión pasada */}
      {lastMeeting && !upcomingMeeting && (
        <div className="border-t pt-2">
          <h5 className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
            Última reunión
          </h5>
          <p className="font-medium">
            {lastMeeting.hs_meeting_title ?? "Sin título"}
          </p>
          <p className="text-muted-foreground">
            {formatDateTime(lastMeeting.hs_meeting_start_time)}
            {lastMeeting.hs_meeting_outcome && ` · ${lastMeeting.hs_meeting_outcome}`}
          </p>
        </div>
      )}

      {/* Llamadas recientes */}
      {recentCalls.length > 0 && (
        <div className="border-t pt-2">
          <h5 className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
            Llamadas recientes ({recentCalls.length})
          </h5>
          <ul className="space-y-1">
            {recentCalls.map((call) => (
              <li key={call.id} className="flex items-center justify-between gap-2">
                <span className="truncate">
                  <span className="text-muted-foreground">
                    {call.hs_call_direction === "OUTBOUND" ? "→" : "←"}{" "}
                  </span>
                  {call.hs_call_title ?? "Llamada sin título"}
                  {call.hs_call_disposition && (
                    <span className="text-muted-foreground">
                      {" "}· {humanCallDisposition(call.hs_call_disposition)}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-muted-foreground text-[10px]">
                  {formatDateTime(call.hs_timestamp)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!company && !lastMeeting && !upcomingMeeting && recentCalls.length === 0 && (
        <p className="text-muted-foreground italic">
          Sin asociaciones en HubSpot (empresa, reuniones, llamadas).
        </p>
      )}
    </div>
  );
}

function KV({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <span className="text-muted-foreground">{label}:</span>{" "}
      <span className="font-medium">{value}</span>
    </div>
  );
}

function formatDateTime(ts?: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    year: sameYear ? undefined : "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ensureProtocol(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

function trimUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

// HubSpot guarda call dispositions como UUIDs internos; mapeamos los más
// comunes a labels legibles. Si no encaja, devolvemos el valor crudo.
const CALL_DISPOSITION_MAP: Record<string, string> = {
  "f240bbac-87c9-4f6e-bf70-924b57d47db7": "Conectado",
  "73a0d17f-1163-4015-bdd5-ec830791da20": "No contesta",
  "b2cf5968-551e-4856-9783-52b3da59a7d0": "Buzón",
  "17b47fee-58de-441e-a44c-c6300d46f273": "Número erróneo",
  "9d9162e7-6cf3-4944-bf63-4dff82258764": "Ocupado",
  "a4c4c377-d246-4b32-a13b-75a56a4cd0ff": "Reunión agendada",
};

function humanCallDisposition(d: string): string {
  return CALL_DISPOSITION_MAP[d] ?? d;
}
