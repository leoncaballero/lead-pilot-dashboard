import { createFileRoute, ErrorComponent, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getTriageCases, type TriageCase } from "@/server/triage.functions";

export const Route = createFileRoute("/_authenticated/triage")({
  loader: () => getTriageCases(),
  staleTime: 5_000,
  pendingComponent: TriagePending,
  errorComponent: ({ error }) => {
    const router = useRouter();
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Triage Rápido</h1>
        <ErrorComponent error={error} />
        <button
          className="text-sm underline text-muted-foreground"
          onClick={() => router.invalidate()}
        >
          Reintentar
        </button>
      </div>
    );
  },
  notFoundComponent: () => <div>No encontrado</div>,
  component: TriagePage,
});

function TriagePending() {
  return (
    <div className="space-y-4">
      <Header count={null} />
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    </div>
  );
}

function Header({ count }: { count: number | null }) {
  return (
    <div className="flex items-baseline justify-between">
      <div>
        <h1 className="text-2xl font-semibold">Triage Rápido</h1>
        <p className="text-sm text-muted-foreground">
          Casos pendientes con score 85–94, ordenados por antigüedad.
        </p>
      </div>
      <div className="text-sm text-muted-foreground">
        {count === null ? "—" : `${count} caso${count === 1 ? "" : "s"}`}
      </div>
    </div>
  );
}

function TriagePage() {
  const { cases } = Route.useLoaderData();
  const router = useRouter();

  // Polling cada 5s para refrescar la lista
  useEffect(() => {
    const id = setInterval(() => {
      router.invalidate();
    }, 5000);
    return () => clearInterval(id);
  }, [router]);

  return (
    <div className="space-y-4">
      <Header count={cases.length} />
      {cases.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No hay casos pendientes en este rango.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {cases.map((c: TriageCase) => (
            <CaseCard key={c.id} case={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function CaseCard({ case: c }: { case: TriageCase }) {
  return (
    <Card className="cursor-pointer transition-shadow hover:shadow-md">
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="min-w-0">
          <CardTitle className="text-base truncate">
            {c.lead_name || c.lead_email || c.smartlead_lead_id || c.id}
          </CardTitle>
          {c.lead_email && (
            <p className="text-xs text-muted-foreground truncate">{c.lead_email}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {typeof c.score === "number" && (
            <Badge variant="secondary">Score {c.score}</Badge>
          )}
          {c.patron && <Badge variant="outline">Patrón {c.patron}</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {c.reply_original && (
          <p className="text-sm line-clamp-2 text-foreground">
            <span className="text-muted-foreground">Lead: </span>
            {c.reply_original}
          </p>
        )}
        {c.turn_1_generated && (
          <p className="text-sm line-clamp-2 text-muted-foreground">
            <span className="font-medium">Sugerida: </span>
            {c.turn_1_generated}
          </p>
        )}
        {c.reply_timestamp && (
          <p className="text-xs text-muted-foreground">
            {new Date(String(c.reply_timestamp)).toLocaleString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
