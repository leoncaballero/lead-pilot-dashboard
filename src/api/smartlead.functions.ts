import { createServerFn } from "@tanstack/react-start";

/**
 * Smartlead message-history integration.
 *
 * Smartlead expone /api/v1/campaigns/{cid}/leads/{lid}/message-history que requiere
 * conocer el campaign_id. Como no lo guardamos en el pipeline (todavia), primero
 * resolvemos campaign_id via /api/v1/leads/{id}/campaigns. Despues juntamos toda
 * la conversacion (cold email inicial + replies + nuestros sends).
 *
 * Nota seguridad: el SMARTLEAD_API_KEY es plaintext en el endpoint de Smartlead.
 * Lo manejamos solo en el server (createServerFn), nunca llega al cliente.
 */

export type SmartleadMessage = {
  type: "SENT" | "REPLY" | string;
  message_id: string | null;
  stats_id: string | null;
  from: string | null;
  to: string | null;
  subject: string | null;
  email_body: string | null;
  time: string | null;
  email_seq_number: number | null;
  open_count: number | null;
  click_count: number | null;
};

export type SmartleadThread = {
  ok: boolean;
  campaign_id: number | null;
  campaign_name: string | null;
  lead_email: string | null;
  messages: SmartleadMessage[];
  error?: string;
};

const SMARTLEAD_BASE = "https://server.smartlead.ai/api/v1";

function getApiKey(): string | null {
  return process.env.SMARTLEAD_API_KEY ?? null;
}

async function smartleadGet<T>(path: string): Promise<T> {
  const key = getApiKey();
  if (!key) {
    throw new Error(
      "SMARTLEAD_API_KEY is not configured. Add it as a secret in Lovable Cloud."
    );
  }
  const sep = path.includes("?") ? "&" : "?";
  const url = `${SMARTLEAD_BASE}${path}${sep}api_key=${encodeURIComponent(key)}`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Smartlead ${res.status}: ${body.slice(0, 200)}`);
  }
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export const getSmartleadThread = createServerFn({ method: "GET" })
  .inputValidator((data: { smartlead_lead_id: string | number }) => data)
  .handler(async ({ data }): Promise<SmartleadThread> => {
    const leadId = String(data.smartlead_lead_id);
    if (!leadId) {
      return { ok: false, campaign_id: null, campaign_name: null, lead_email: null, messages: [], error: "smartlead_lead_id missing" };
    }

    try {
      // 1. Resolver campaign_id
      const campaigns = await smartleadGet<Array<{ id: number; status: string; name: string }>>(
        `/leads/${encodeURIComponent(leadId)}/campaigns`
      );
      if (!Array.isArray(campaigns) || campaigns.length === 0) {
        return { ok: false, campaign_id: null, campaign_name: null, lead_email: null, messages: [], error: "Lead no encontrado en ningun campaign" };
      }
      const active = campaigns.find((c) => c.status === "ACTIVE") ?? campaigns[0];
      const campaignId = active.id;
      const campaignName = active.name;

      // 2. Fetch message history
      type HistoryResp = { history: SmartleadMessage[]; from?: string; to?: string };
      const history = await smartleadGet<HistoryResp>(
        `/campaigns/${campaignId}/leads/${encodeURIComponent(leadId)}/message-history`
      );
      // Orden DESC por time: lo MAS RECIENTE primero (UX: ver el ultimo
      // mensaje sin tener que scrollear hasta abajo).
      const messages = (history.history ?? []).slice().sort((a, b) => {
        const ta = a.time ? Date.parse(a.time) : 0;
        const tb = b.time ? Date.parse(b.time) : 0;
        return tb - ta;
      });

      return {
        ok: true,
        campaign_id: campaignId,
        campaign_name: campaignName,
        lead_email: history.to ?? null,
        messages,
      };
    } catch (err) {
      return {
        ok: false,
        campaign_id: null,
        campaign_name: null,
        lead_email: null,
        messages: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

/**
 * Strip HTML tags + decode common entities for a clean text rendering.
 * Used when we want plain-text display of email bodies (no XSS risk).
 */
/**
 * Saca el texto citado de una respuesta (lo que el lead respondió encima de
 * nuestro email previo). Detecta separadores típicos de Gmail/Outlook en
 * español, inglés y francés. Si el stripping deja el texto vacío (caso raro:
 * todo el cuerpo es citado), devolvemos el original.
 *
 * Aplicar SOLO a mensajes type=REPLY. Los SENT son nuestros, no tienen quote.
 */
export function stripQuotedReply(text: string): string {
  if (!text) return text;
  const markers: RegExp[] = [
    // Gmail español: "El jue, 5 mar 2026, 9:25, Nombre <email> escribió:"
    /^[ \t]*El .{0,300}?escribió:\s*$/m,
    // Gmail inglés: "On Thu, Mar 5, 2026 at 9:25, Name <email> wrote:"
    /^[ \t]*On .{0,300}?wrote:\s*$/m,
    // Gmail francés
    /^[ \t]*Le .{0,300}?a écrit\s*:\s*$/m,
    // Outlook separator
    /^[ \t]*-{2,}\s*Original Message\s*-{2,}.*$/im,
    /^[ \t]*-{2,}\s*Mensaje original\s*-{2,}.*$/im,
    // Outlook block ES
    /^[ \t]*De:\s.+$/m,
    // Outlook block EN
    /^[ \t]*From:\s.+$/m,
  ];
  let earliestIdx = text.length;
  for (const re of markers) {
    const m = re.exec(text);
    if (m && m.index < earliestIdx) earliestIdx = m.index;
  }
  let result = text.slice(0, earliestIdx);
  // Quitar lineas con prefijo > (quoted lines sin header)
  result = result
    .split("\n")
    .filter((line) => !/^[ \t]*>/.test(line))
    .join("\n");
  result = result.replace(/\n{3,}/g, "\n\n").trim();
  // Si nos quedamos sin nada (reply era solo quote), volvemos al original
  if (result.length === 0) return text.trim();
  return result;
}

export function stripEmailHtml(html: string): string {
  if (!html) return "";
  let text = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>(?!\n)/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[a-zA-Z]+;/g, " ");
  // Collapse 3+ newlines to 2
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}
