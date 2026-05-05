import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/history")({
  component: () => (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">Histórico</h1>
      <p className="text-muted-foreground text-sm">Próximamente.</p>
    </div>
  ),
});
