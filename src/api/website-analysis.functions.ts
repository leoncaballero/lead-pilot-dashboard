import { createServerFn } from "@tanstack/react-start";

/**
 * Análisis web del dominio del lead para personalizar Turn 1.
 *
 * Flujo:
 *   1. Lead responde → tenemos su email (ej: ana@mibrand.com)
 *   2. Llamamos a analyzeLeadWebsite con email/domain → devuelve análisis
 *   3. Cacheamos por dominio (cl001_p007_website_analyses) — los 5 leads de
 *      mibrand.com que respondan en los próximos 30d comparten el análisis
 *   4. El generador Turn 1 usa el análisis para personalizar el hook
 *
 * Modelo usado: claude-haiku-4-5-20251001 (rápido + barato, ~$0.001/análisis).
 * Si Anthropic o el fetch fallan, devolvemos analysis con business_summary
 * "No se pudo analizar" y los otros campos null — el generador seguirá funcionando
 * sin contexto web (degradación graceful).
 */

const TABLE = "cl001_p007_website_analyses";
const TTL_DAYS = 30;
const MAX_HTML_BYTES = 250_000; // 250KB cap antes de stripping
const MAX_TEXT_FOR_CLAUDE = 5_000; // chars de texto limpio que enviamos a Claude
const MODEL = "claude-haiku-4-5-20251001";

function getCreds() {
  const url = process.env.OUTBOUND_SUPABASE_URL;
  const key = process.env.OUTBOUND_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Outbound Supabase no configurado");
  return { url: url.replace(/\/$/, ""), key };
}

async function pgrest<T>(
  path: string,
  init: RequestInit & { prefer?: string } = {}
): Promise<T> {
  const { url, key } = getCreds();
  const headers: Record<string, string> = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  if (init.prefer) headers.Prefer = init.prefer;
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string>) },
  });
  if (!res.ok) {
    throw new Error(`pgrest ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const t = await res.text();
  return (t ? JSON.parse(t) : null) as T;
}

export type WebsiteAnalysis = {
  business_summary: string;
  sector:
    | "fashion"
    | "beauty"
    | "home"
    | "health"
    | "electronics"
    | "food"
    | "b2b_services"
    | "software"
    | "other"
    | "unknown";
  apparent_size: "solo_founder" | "small_team" | "mid" | "enterprise" | "unknown";
  is_ecommerce: boolean | null;
  ecommerce_platform_hint:
    | "shopify"
    | "woocommerce"
    | "prestashop"
    | "magento"
    | "custom"
    | "unknown";
  products_or_services: string[];
  tone: "formal" | "casual" | "technical" | "luxury" | "playful" | "unknown";
  personalization_hook: string | null;
  warnings: string[];
};

export type WebsiteAnalysisRecord = {
  domain: string;
  analysis: WebsiteAnalysis;
  raw_text_preview: string | null;
  fetch_status: number | null;
  fetch_url: string | null;
  model_used: string | null;
  fetched_at: string;
  refreshed_at: string;
};

export type AnalyzeWebsiteResult = {
  ok: boolean;
  cached: boolean;
  record?: WebsiteAnalysisRecord;
  error?: string;
};

export type ListWebsiteAnalysesResult = {
  records: WebsiteAnalysisRecord[];
  total: number;
};

/**
 * Normalizes a lead-derived input (email or url) to a canonical domain:
 *   "Ana@MiBrand.com"          → "mibrand.com"
 *   "https://www.mibrand.com/" → "mibrand.com"
 *   "mibrand.com/about"        → "mibrand.com"
 * Returns null for things we can't extract a domain from.
 */
export function normalizeDomain(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase();

  // Email
  const at = trimmed.lastIndexOf("@");
  let host = at >= 0 ? trimmed.slice(at + 1) : trimmed;

  // Strip protocol
  host = host.replace(/^https?:\/\//, "");

  // Strip path + query
  host = host.split("/")[0].split("?")[0].split("#")[0];

  // Strip www.
  host = host.replace(/^www\./, "");

  // Basic sanity: must contain a dot + TLD must be alpha (rules out bare IPs
  // like "10.0.0.1" — important SSRF guard, since fetch later targets this).
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return null;
  // Belt-and-suspenders: explicit blocklist of obvious internal hosts
  // (the regex above already rules these out, but spelling them helps a future
  // reader understand the intent).
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  )
    return null;

  // Filter genericos / freemail (no aportan análisis útil)
  const FREEMAIL = new Set([
    "gmail.com",
    "googlemail.com",
    "yahoo.com",
    "yahoo.es",
    "hotmail.com",
    "hotmail.es",
    "outlook.com",
    "outlook.es",
    "live.com",
    "icloud.com",
    "me.com",
    "aol.com",
    "protonmail.com",
    "pm.me",
    "msn.com",
    "telefonica.net",
    "movistar.es",
    "orange.es",
  ]);
  if (FREEMAIL.has(host)) return null;

  return host;
}

function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<br\s*\/?>(?!\n)/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/(h[1-6]|li|div|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function tryFetchHomepage(
  domain: string
): Promise<{ url: string; status: number; html: string }> {
  // Probamos https primero, luego http, luego /about como fallback
  const candidates = [
    `https://${domain}/`,
    `https://www.${domain}/`,
    `http://${domain}/`,
  ];
  let lastStatus = 0;
  let lastUrl = candidates[0];
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        redirect: "follow",
        headers: {
          // Algunos sites bloquean fetch sin User-Agent
          "User-Agent":
            "Mozilla/5.0 (compatible; SettingPilotBot/1.0; +https://consultoria.io)",
          Accept: "text/html",
        },
        signal: AbortSignal.timeout(10_000),
      });
      lastStatus = res.status;
      lastUrl = res.url || url;
      if (!res.ok) continue;
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html")) continue;

      // Lectura cap por tamaño para no inflar memoria si la home es enorme
      const reader = res.body?.getReader();
      if (!reader) {
        const html = await res.text();
        return {
          url: lastUrl,
          status: res.status,
          html: html.slice(0, MAX_HTML_BYTES),
        };
      }
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      const decoder = new TextDecoder("utf-8", { fatal: false });
      while (bytes < MAX_HTML_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          bytes += value.byteLength;
        }
      }
      try {
        reader.cancel();
      } catch {
        // ignore
      }
      const combined = new Uint8Array(bytes);
      let offset = 0;
      for (const c of chunks) {
        combined.set(c.subarray(0, Math.min(c.byteLength, MAX_HTML_BYTES - offset)), offset);
        offset += c.byteLength;
        if (offset >= MAX_HTML_BYTES) break;
      }
      const html = decoder.decode(combined.subarray(0, Math.min(offset, MAX_HTML_BYTES)));
      return { url: lastUrl, status: res.status, html };
    } catch {
      // siguiente candidato
    }
  }
  return { url: lastUrl, status: lastStatus || 0, html: "" };
}

async function callClaude(
  text: string,
  domain: string,
  anthKey: string
): Promise<{ ok: boolean; analysis?: WebsiteAnalysis; error?: string }> {
  const system = `Eres un analista de negocios B2B trabajando para Setting Pilot, un servicio de SDR/cold email para ecommerce. Recibes el texto plano extraído de la home (o página principal accesible) de un dominio y debes devolver un JSON ESTRUCTURADO que un generador AI usará para personalizar la primera respuesta comercial que se envíe a un lead de esa empresa.

REGLAS:
- Devuelve EXACTAMENTE este JSON, sin markdown, sin texto adicional, sin comentarios:

{
  "business_summary": "1-2 frases que describan qué hace la empresa, en español",
  "sector": "fashion | beauty | home | health | electronics | food | b2b_services | software | other | unknown",
  "apparent_size": "solo_founder | small_team | mid | enterprise | unknown",
  "is_ecommerce": true | false | null,
  "ecommerce_platform_hint": "shopify | woocommerce | prestashop | magento | custom | unknown",
  "products_or_services": ["máximo 5 strings cortos"],
  "tone": "formal | casual | technical | luxury | playful | unknown",
  "personalization_hook": "una frase específica que un SDR usaría para personalizar el primer email — referencia algo concreto del negocio (producto destacado, claim de la web, lanzamiento, valor diferencial visible). Máximo 25 palabras. Null si el texto no da suficiente para esto.",
  "warnings": ["lista de cosas que el SDR debe EVITAR. Ej: 'Web muy descuidada — no halagues la marca'. Vacía si no aplica."]
}

- Sé conservador: si dudas, "unknown" o null.
- Si el texto es página de error / login / cookies banner / texto vacío / 404: business_summary="No se pudo analizar la web", el resto en defaults conservadores ("unknown" / null / []).
- NO inventes información que no esté en el texto. Es mejor null que alucinar.

Dominio que estás analizando: ${domain}`;

  const userText = `TEXTO EXTRAÍDO DE LA WEB:\n\n${text.slice(0, MAX_TEXT_FOR_CLAUDE)}`;

  let resp;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system,
        messages: [{ role: "user", content: userText }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    return { ok: false, error: `Fetch Anthropic: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!resp.ok) {
    return { ok: false, error: `Anthropic ${resp.status}: ${(await resp.text()).slice(0, 300)}` };
  }
  const json = (await resp.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text2 = json.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
  // Algunos modelos rodean con ```json ``` aun cuando pides "sin markdown"
  const cleaned = text2.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  let parsed: WebsiteAnalysis;
  try {
    parsed = JSON.parse(cleaned) as WebsiteAnalysis;
  } catch {
    return { ok: false, error: `JSON parse falló. Output: ${text2.slice(0, 200)}` };
  }
  return { ok: true, analysis: parsed };
}

export const analyzeLeadWebsite = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { input: string; force?: boolean }) => data
  )
  .handler(async ({ data }): Promise<AnalyzeWebsiteResult> => {
    const domain = normalizeDomain(data.input);
    if (!domain) {
      return {
        ok: false,
        cached: false,
        error: `No se pudo extraer un dominio analizable de "${data.input}" (¿es freemail?)`,
      };
    }

    // 1. Mirar cache si no es force
    if (!data.force) {
      try {
        const rows = await pgrest<WebsiteAnalysisRecord[]>(
          `${TABLE}?domain=eq.${encodeURIComponent(domain)}&select=*&limit=1`,
          { method: "GET" }
        );
        const row = rows?.[0];
        if (row) {
          const ageDays =
            (Date.now() - Date.parse(row.refreshed_at)) / (1000 * 60 * 60 * 24);
          if (ageDays < TTL_DAYS) {
            return { ok: true, cached: true, record: row };
          }
        }
      } catch {
        // Si el read falla, seguimos hacia el análisis fresh
      }
    }

    // 2. Fetch web
    const anthKey = process.env.ANTHROPIC_API_KEY;
    if (!anthKey) {
      return {
        ok: false,
        cached: false,
        error: "ANTHROPIC_API_KEY no configurado en Lovable Cloud",
      };
    }

    const fetched = await tryFetchHomepage(domain);
    const text = stripHtml(fetched.html);
    const preview = text.slice(0, MAX_TEXT_FOR_CLAUDE);

    let analysis: WebsiteAnalysis;
    if (!fetched.html || text.length < 50) {
      // Fallback sin pegarle a Claude — degradación graceful
      analysis = {
        business_summary: "No se pudo analizar la web (fetch falló o contenido vacío)",
        sector: "unknown",
        apparent_size: "unknown",
        is_ecommerce: null,
        ecommerce_platform_hint: "unknown",
        products_or_services: [],
        tone: "unknown",
        personalization_hook: null,
        warnings: [`fetch_status=${fetched.status}, text_len=${text.length}`],
      };
    } else {
      const claudeRes = await callClaude(text, domain, anthKey);
      if (!claudeRes.ok || !claudeRes.analysis) {
        return {
          ok: false,
          cached: false,
          error: claudeRes.error ?? "Claude no devolvió análisis",
        };
      }
      analysis = claudeRes.analysis;
    }

    // 3. Upsert
    const now = new Date().toISOString();
    const upserted = await pgrest<WebsiteAnalysisRecord[]>(`${TABLE}`, {
      method: "POST",
      prefer: "return=representation,resolution=merge-duplicates",
      body: JSON.stringify([
        {
          domain,
          analysis,
          raw_text_preview: preview,
          fetch_status: fetched.status,
          fetch_url: fetched.url,
          model_used: MODEL,
          fetched_at: now,
          refreshed_at: now,
        },
      ]),
    });

    return { ok: true, cached: false, record: upserted[0] };
  });

export const listWebsiteAnalyses = createServerFn({ method: "GET" })
  .inputValidator((data: { limit?: number } | undefined) => data ?? {})
  .handler(async ({ data }): Promise<ListWebsiteAnalysesResult> => {
    const limit = Math.min(Math.max(data?.limit ?? 100, 1), 500);
    const records = await pgrest<WebsiteAnalysisRecord[]>(
      `${TABLE}?select=*&order=refreshed_at.desc&limit=${limit}`,
      { method: "GET" }
    );
    return { records: records ?? [], total: (records ?? []).length };
  });
