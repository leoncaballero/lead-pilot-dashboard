import {
  createFileRoute,
  ErrorComponent,
  useRouter,
} from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, AlertTriangle, RefreshCcw, Info } from "lucide-react";
import {
  getVisibilityFunnel,
  type FunnelCounts,
} from "@/api/visibility.functions";

const DAILY_CAPACITY = 18000;

export const Route = createFileRoute("/_authenticated/visibility")({
  loader: async () => await getVisibilityFunnel(),
  staleTime: 5 * 60_000, // 5 min — HS rate-limit friendly
  pendingComponent: Pending,
  errorComponent: ({ error }) => {
    const router = useRouter();
    return (
      <div className="p-4 space-y-4">
        <h1 className="text-2xl font-semibold">Visibility</h1>
        <ErrorComponent error={error} />
        <button
          className="text-sm underline"
          onClick={() => router.invalidate()}
        >
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
      <h1 className="text-2xl font-semibold">Visibility</h1>
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-56 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

function fmtNumber(n: number): string {
  return n.toLocaleString("es-ES");
}

function fmtPct(p: number, digits = 0): string {
  return `${p.toFixed(digits)}%`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function Page() {
  const data: FunnelCounts = Route.useLoaderData();
  const router = useRouter();

  const tiers = [
    {
      id: "t0",
      label: "T0 · Queue",
      sublabel: "Lo que dice HubSpot",
      value: data.t0_queue,
      barClass: "bg-slate-400",
    },
    {
      id: "t1",
      label: "T1 · + tiene avatar",
      sublabel: "Se puede enrutar a campaña",
      value: data.t1_with_avatar,
      barClass: "bg-blue-500",
    },
    {
      id: "t2",
      label: "T2 · + sin opt-outs",
      sublabel: "Deliverable legalmente",
      value: data.t2_deliverable,
      barClass: "bg-emerald-500",
    },
    {
      id: "t3",
      label: "T3 · + activity ≤ 90d",
      sublabel: "Engaged-eligible (estricto)",
      value: data.t3_engaged_90d,
      barClass: "bg-amber-500",
    },
  ];

  const avatars = [
    {
      key: "mega" as const,
      label: "MEGA",
      data: data.perAvatar.mega,
    },
    {
      key: "genesis" as const,
      label: "Genesis",
      data: data.perAvatar.genesis,
    },
    {
      key: "prosperitas" as const,
      label: "Prosperitas",
      data: data.perAvatar.prosperitas,
    },
  ];

  return (
    <div className="p-4 space-y-6 max-w-6xl">
      <header className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">
            Visibility — Lead Allocation
          </h1>
          <p className="text-sm text-muted-foreground">
            ¿Cuántos leads están realmente listos para impactar? · Lee HubSpot
            directo, sin sync intermedio
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground tabular-nums">
            Actualizado: {fmtTime(data.computedAt)}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.invalidate()}
          >
            <RefreshCcw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
        </div>
      </header>

      {/* ===== FUNNEL ===== */}
      <Card>
        <CardHeader>
          <CardTitle>Funnel — definición de "listo para impactar"</CardTitle>
          <CardDescription>
            El número que dice HubSpot ({fmtNumber(data.t0_queue)} en{" "}
            <code className="font-mono">Queue</code>) sobreestima lo que
            realmente puedes mandar. Cada tier añade un criterio operativo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {tiers.map((tier, i) => {
            const pctOfT0 =
              data.t0_queue > 0 ? (tier.value / data.t0_queue) * 100 : 0;
            const prevValue = i > 0 ? tiers[i - 1].value : tier.value;
            const lostFromPrev = i > 0 ? prevValue - tier.value : 0;
            const lostPct =
              i > 0 && prevValue > 0 ? (lostFromPrev / prevValue) * 100 : 0;
            const days = tier.value / DAILY_CAPACITY;
            return (
              <div key={tier.id}>
                <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between mb-1.5 gap-0.5">
                  <div>
                    <span className="font-medium text-sm">{tier.label}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {tier.sublabel}
                    </span>
                  </div>
                  <div className="text-sm tabular-nums flex items-center gap-3">
                    <strong>{fmtNumber(tier.value)}</strong>
                    {i > 0 && (
                      <span className="text-rose-600 dark:text-rose-400">
                        −{fmtPct(lostPct)} ({fmtNumber(lostFromPrev)})
                      </span>
                    )}
                    <span className="text-muted-foreground">
                      ≈ {days.toFixed(1)} días a {fmtNumber(DAILY_CAPACITY)}/día
                    </span>
                  </div>
                </div>
                <div className="h-3 bg-muted rounded-sm overflow-hidden">
                  <div
                    className={`h-full ${tier.barClass} transition-all`}
                    style={{ width: `${pctOfT0}%` }}
                  />
                </div>
              </div>
            );
          })}
          <div className="pt-2 text-xs text-muted-foreground">
            <strong>Lectura</strong>: de {fmtNumber(data.t0_queue)} que dice HS
            están listos, realmente solo{" "}
            <strong>{fmtNumber(data.t2_deliverable)}</strong> se pueden mandar
            sin problema (
            {fmtPct((data.t2_deliverable / data.t0_queue) * 100)} del Queue).
          </div>
        </CardContent>
      </Card>

      {/* ===== AVATAR BREAKDOWN ===== */}
      <Card>
        <CardHeader>
          <CardTitle>Distribución por avatar — nivel T2 (deliverable)</CardTitle>
          <CardDescription>
            Cómo se reparte el pool ready entre tus 3 avatars.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground text-left text-xs uppercase tracking-wide">
                <th className="pb-2 font-medium">Avatar</th>
                <th className="pb-2 font-medium text-right">T1 con avatar</th>
                <th className="pb-2 font-medium text-right">T2 deliverable</th>
                <th className="pb-2 font-medium text-right">Pérdida T1→T2</th>
                <th className="pb-2 font-medium text-right">% del ready pool</th>
              </tr>
            </thead>
            <tbody>
              {avatars.map((av) => {
                const lostPct =
                  av.data.t1 > 0
                    ? ((av.data.t1 - av.data.t2) / av.data.t1) * 100
                    : 0;
                const sharePct =
                  data.t2_deliverable > 0
                    ? (av.data.t2 / data.t2_deliverable) * 100
                    : 0;
                return (
                  <tr key={av.key} className="border-t">
                    <td className="py-2 font-medium">{av.label}</td>
                    <td className="py-2 text-right tabular-nums">
                      {fmtNumber(av.data.t1)}
                    </td>
                    <td className="py-2 text-right tabular-nums font-semibold">
                      {fmtNumber(av.data.t2)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">
                      −{fmtPct(lostPct)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {sharePct >= 70 && (
                        <Badge
                          variant="default"
                          className="mr-2 align-middle text-[10px]"
                        >
                          dominante
                        </Badge>
                      )}
                      {fmtPct(sharePct, 1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* ===== INCONSISTENCIES ===== */}
      <Card>
        <CardHeader>
          <CardTitle>Inconsistencias detectadas en Queue</CardTitle>
          <CardDescription>
            Contactos marcados como listos pero que no deberían estarlo, o que
            no se pueden enrutar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.inconsistencies.queue_hs_optout > 0 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>
                {fmtNumber(data.inconsistencies.queue_hs_optout)} contactos en
                Queue con opt-out de HubSpot marketing
              </AlertTitle>
              <AlertDescription>
                Riesgo de compliance GDPR. Si tu flow Smartlead no respeta
                <code className="font-mono mx-1">hs_email_optout</code>,
                podrías estar enviando a personas que pidieron darse de baja.
                Acción: verificar el handoff Queue → Smartlead.
              </AlertDescription>
            </Alert>
          )}

          {data.inconsistencies.queue_without_avatar > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>
                {fmtNumber(data.inconsistencies.queue_without_avatar)} contactos
                en Queue sin avatar asignado
              </AlertTitle>
              <AlertDescription>
                No pueden enrutarse a la campaña correcta. Necesitan
                clasificación (manual, por regla, o por enrichment).
              </AlertDescription>
            </Alert>
          )}

          {data.inconsistencies.queue_bounced > 0 && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>
                {fmtNumber(data.inconsistencies.queue_bounced)} contactos en
                Queue con bounce previo
              </AlertTitle>
              <AlertDescription>
                Riesgo de deliverability si reintentas. Considerar política
                explícita sobre cuándo (o si) reimpactar emails que bouncearon.
              </AlertDescription>
            </Alert>
          )}

          {data.inconsistencies.queue_cold_optout > 0 && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>
                {fmtNumber(data.inconsistencies.queue_cold_optout)} contactos en
                Queue con opt-out de cold email outbound
              </AlertTitle>
              <AlertDescription>
                Estos pidieron explícitamente NO recibir cold email. Sacar de
                Queue.
              </AlertDescription>
            </Alert>
          )}

          {data.inconsistencies.queue_hs_optout === 0 &&
            data.inconsistencies.queue_without_avatar === 0 &&
            data.inconsistencies.queue_bounced === 0 &&
            data.inconsistencies.queue_cold_optout === 0 && (
              <p className="text-sm text-muted-foreground">
                ✅ No se detectaron inconsistencias en este momento.
              </p>
            )}
        </CardContent>
      </Card>
    </div>
  );
}
