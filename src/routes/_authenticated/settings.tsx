import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/settings")({
  component: () => (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="text-muted-foreground text-sm">Próximamente.</p>
    </div>
  ),
});
