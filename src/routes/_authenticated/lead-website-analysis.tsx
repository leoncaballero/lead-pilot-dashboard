import { createFileRoute, ErrorComponent, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  analyzeLeadWebsite,
  listWebsiteAnalyses,
  type WebsiteAnalysisRecord,
  type WebsiteAnalysis,
} from "@/api/website-analysis.functions";

export const Route = createFileRoute("/_authenticated/lead-website-analysis")({
  loader: async () => await listWebsiteAnalyses({ data: { limit: 100 } }),
  staleTime: 60_000,
  pendingComponent: Pending,
  errorComponent: ({ error }) => {
    const router = useRouter();
    return (
      <div className="p-4 space-y-4">
        <h1 className="text-2xl font-semibold">Análisis web de leads</h1>
        <ErrorComponent error={error} />
        <button className="text-sm underline" onClick={() => router.invalidate()}>
          Reintentar
        </button>
      </div>
    );
  },
  component: Page,
});

function Pending() {
  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-semibold">Análisis web de leads</h1>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

function Page() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const analyzeFn = useServerFn(analyzeLeadWebsite);

  const [input, setInput] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [lastResult, setLastResult] = useState<WebsiteAnalysisRecord | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastCached, setLastCached] = useState<boolean>(false);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);

  async function handleAnalyze(force: boolean) {
    if (!input.trim() || analyzing) return;
    setAnalyzing(true);
    setLastError(null);
    try {
      const res = await analyzeFn({ data: { input: input.trim(), force } });
      if (!res.ok) {
        setLastError(res.error ?? "Error desconocido");
        setLastResult(null);
      } else {
        setLastResult(res.record ?? null);
        setLastCached(res.cached);
        if (res.record) setSelectedDomain(res.record.domain);
        await router.invalidate();
      }
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  }

  const selected =
    lastResult ?? data.records.find((r) => r.domain === selectedDomain) ?? null;

  return (
    <div className="p-4 space-y-6 max-w-7xl">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          🔬 Análisis web de leads
        </h1>
        <p className="text-sm text-muted-foreground">
          Cache estructurado del análisis de la home del lead — usado para
          personalizar el Turn 1. Si el dominio ya está analizado y la fecha es
          reciente (&lt;30d), devuelve cache. Si no, hace fetch + Claude Haiku
          y guarda.
        </p>
      </header>

      {/* Input */}
      <section className="rounded-lg border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Analizar dominio
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAnalyze(false);
          }}
          className="flex gap-2 flex-wrap"
        >
          <Input
            type="text"
            placeholder="ana@mibrand.com  ó  mibrand.com  ó  https://mibrand.com"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 min-w-[280px]"
            disabled={analyzing}
            autoFocus
          />
          <Button type="submit" disabled={analyzing || !input.trim()}>
            {analyzing ? "Analizando…" : "Analizar"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={analyzing || !input.trim()}
            onClick={() => handleAnalyze(true)}
            title="Forzar re-análisis (ignora cache)"
          >
            ↻ Force
          </Button>
        </form>
        {lastError && (
          <div className="rounded border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-3 text-xs text-red-900 dark:text-red-200">
            <strong>Error:</strong> {lastError}
          </div>
        )}
        {lastResult && (
          <div className="text-[11px] text-muted-foreground">
            {lastCached ? (
              <span>
                ⚡ Devuelto desde cache · refrescado{" "}
                {formatAgo(lastResult.refreshed_at)} · usa Force para regenerar
              </span>
            ) : (
              <span className="text-emerald-700 dark:text-emerald-300">
                ✓ Análisis nuevo · guardado en cache · {lastResult.model_used}
              </span>
            )}
          </div>
        )}
      </section>

      {/* Detalle del seleccionado */}
      {selected && <AnalysisCard record={selected} />}

      {/* Lista de analizados recientes */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Recientes ({data.records.length})
        </h2>
        {data.records.length === 0 ? (
          <div className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            Sin análisis todavía. Prueba con un dominio en el input de arriba.
          </div>
        ) : (
          <div className="rounded-lg border bg-card divide-y">
            {data.records.map((r) => (
              <button
                key={r.domain}
                type="button"
                onClick={() => {
                  setSelectedDomain(r.domain);
                  setLastResult(null);
                  setLastError(null);
                  setInput(r.domain);
                }}
                className={cn(
                  "w-full text-left px-4 py-3 transition-colors hover:bg-accent/50",
                  selectedDomain === r.domain && "bg-accent"
                )}
              >
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-mono text-sm font-semibold">{r.domain}</span>
                  <Badge variant="outline" className="h-4 px-1 text-[9px]">
                    {r.analysis.sector ?? "unknown"}
                  </Badge>
                  <Badge variant="outline" className="h-4 px-1 text-[9px]">
                    {r.analysis.apparent_size ?? "unknown"}
                  </Badge>
                  {r.analysis.is_ecommerce === true && (
                    <Badge className="h-4 px-1 text-[9px] bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200 hover:bg-emerald-100">
                      ecommerce
                    </Badge>
                  )}
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {formatAgo(r.refreshed_at)}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground truncate">
                  {r.analysis.business_summary}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function AnalysisCard({ record }: { record: WebsiteAnalysisRecord }) {
  const a = record.analysis;
  return (
    <section className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-base font-semibold font-mono">{record.domain}</h2>
        <Badge variant="outline" className="text-[10px]">
          {a.sector}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {a.apparent_size}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          tono: {a.tone}
        </Badge>
        {a.is_ecommerce === true && (
          <Badge className="text-[10px] bg-emerald-600 hover:bg-emerald-600">
            ecommerce
          </Badge>
        )}
        {a.ecommerce_platform_hint && a.ecommerce_platform_hint !== "unknown" && (
          <Badge variant="outline" className="text-[10px]">
            {a.ecommerce_platform_hint}
          </Badge>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">
          Analizado {formatAgo(record.refreshed_at)} · fetch_status={" "}
          {record.fetch_status ?? "—"}
        </span>
      </div>

      <div>
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
          Resumen
        </h3>
        <p className="text-sm">{a.business_summary}</p>
      </div>

      {a.personalization_hook && (
        <div className="rounded border border-blue-200 dark:border-blue-900/50 bg-blue-50/40 dark:bg-blue-950/20 p-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-blue-900 dark:text-blue-200 mb-1">
            🎯 Hook de personalización
          </h3>
          <p className="text-sm italic text-blue-900 dark:text-blue-100">
            {a.personalization_hook}
          </p>
        </div>
      )}

      {a.warnings.length > 0 && (
        <div className="rounded border border-amber-200 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/20 p-3 space-y-1">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-amber-900 dark:text-amber-200">
            ⚠️ Avisos para el SDR
          </h3>
          <ul className="list-disc pl-5 text-xs text-amber-900 dark:text-amber-100">
            {a.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {a.products_or_services.length > 0 && (
        <div>
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Productos / servicios detectados
          </h3>
          <div className="flex flex-wrap gap-1">
            {a.products_or_services.map((p, i) => (
              <span
                key={i}
                className="rounded-full border px-2 py-0.5 text-[11px] bg-muted/40"
              >
                {p}
              </span>
            ))}
          </div>
        </div>
      )}

      {record.fetch_url && record.fetch_url !== `https://${record.domain}/` && (
        <div className="text-[10px] text-muted-foreground">
          URL real fetcheada:{" "}
          <a
            href={record.fetch_url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {record.fetch_url}
          </a>
        </div>
      )}

      {record.raw_text_preview && (
        <details className="text-[11px]">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Texto extraído (preview)
          </summary>
          <pre className="mt-2 rounded bg-muted/40 p-2 whitespace-pre-wrap font-mono text-[10px] max-h-64 overflow-auto">
            {record.raw_text_preview}
          </pre>
        </details>
      )}
    </section>
  );
}

function formatAgo(iso: string): string {
  const d = new Date(iso);
  const min = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h}h`;
  const days = Math.floor(h / 24);
  return `hace ${days}d`;
}
