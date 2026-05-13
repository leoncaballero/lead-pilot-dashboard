import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  analyzeLeadWebsite,
  normalizeDomain,
  type WebsiteAnalysisRecord,
} from "@/api/website-analysis.functions";

/**
 * Mini-card que vive en /lead/$email y dispara analyzeLeadWebsite on-demand.
 * No corre automáticamente al cargar el timeline para no encarecer cada navegación
 * con un fetch + Claude. Si el dominio ya está en cache (<30d), la respuesta
 * es instantánea y casi gratis.
 */
export function LeadWebsiteAnalysisCard({ leadEmail }: { leadEmail: string }) {
  const domain = normalizeDomain(leadEmail);
  const analyzeFn = useServerFn(analyzeLeadWebsite);
  const [loading, setLoading] = useState(false);
  const [record, setRecord] = useState<WebsiteAnalysisRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);

  if (!domain) {
    return (
      <div className="rounded-md border bg-card/60 p-3 text-[11px] text-muted-foreground italic">
        Email es freemail o no analizable — sin web propia.
      </div>
    );
  }

  async function trigger(force: boolean) {
    setLoading(true);
    setError(null);
    try {
      const res = await analyzeFn({ data: { input: leadEmail, force } });
      if (!res.ok) {
        setError(res.error ?? "Error desconocido");
        setRecord(null);
      } else {
        setRecord(res.record ?? null);
        setCached(res.cached);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-md border bg-card/60 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          🔬 Análisis web
        </h3>
        <code className="text-[10px] text-muted-foreground truncate">{domain}</code>
      </div>

      {!record && !error && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => trigger(false)}
          disabled={loading}
          className="w-full h-7 text-xs"
        >
          {loading ? "Analizando…" : "Analizar web"}
        </Button>
      )}

      {error && (
        <div className="text-[11px] text-red-700 dark:text-red-300">
          <strong>Error:</strong> {error}
          <button
            type="button"
            onClick={() => trigger(false)}
            disabled={loading}
            className="ml-2 underline text-muted-foreground hover:text-foreground"
          >
            Reintentar
          </button>
        </div>
      )}

      {record && (
        <div className="space-y-2 text-[11px]">
          <div className="flex flex-wrap gap-1">
            <Badge variant="outline" className="h-4 px-1 text-[9px]">
              {record.analysis.sector}
            </Badge>
            <Badge variant="outline" className="h-4 px-1 text-[9px]">
              {record.analysis.apparent_size}
            </Badge>
            {record.analysis.is_ecommerce === true && (
              <Badge className="h-4 px-1 text-[9px] bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200 hover:bg-emerald-100">
                ecommerce
              </Badge>
            )}
            <Badge variant="outline" className="h-4 px-1 text-[9px]">
              {record.analysis.tone}
            </Badge>
          </div>

          <p>{record.analysis.business_summary}</p>

          {record.analysis.personalization_hook && (
            <div className="rounded border border-blue-200 dark:border-blue-900/50 bg-blue-50/40 dark:bg-blue-950/20 p-2 italic text-blue-900 dark:text-blue-100">
              🎯 {record.analysis.personalization_hook}
            </div>
          )}

          {record.analysis.warnings.length > 0 && (
            <div className="rounded border border-amber-200 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/20 p-2 text-amber-900 dark:text-amber-100">
              <div className="font-semibold mb-0.5 text-[10px] uppercase tracking-wider">
                ⚠️ Avisos
              </div>
              <ul className="list-disc pl-4 space-y-0.5">
                {record.analysis.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>
              {cached
                ? `⚡ cache (${formatAgo(record.refreshed_at)})`
                : `✓ nuevo (${record.model_used})`}
            </span>
            <button
              type="button"
              onClick={() => trigger(true)}
              disabled={loading}
              className="underline hover:text-foreground disabled:opacity-50"
              title="Forzar re-análisis ignorando cache"
            >
              ↻ regenerar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatAgo(iso: string): string {
  const min = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
